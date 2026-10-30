#!/usr/bin/env node
/**
 * hotfix 合进 main 之后的收尾：把 main 同步到镜像远端，再把 main 合回 stage，保证 stage >= main。
 *
 *   node scripts/hotfix-sync.mjs plan  [--source gitlab] [--mirror origin] [--close-window <n>] [--preview-tag]
 *   node scripts/hotfix-sync.mjs apply [--source gitlab] [--mirror origin] [--issue <n>] [--preview-tag --tag-approval "<所有者批准摘要>"]
 *                                      [--close-window <n> --evidence "<合回 stage 的提交与线上核对>"]
 *
 * apply 的步骤（任何一步不满足就停下，不强推、不覆盖）：
 *   1. 取两个远端的 main、stage。镜像的 main 必须是源的祖先，才快进推过去；两边分叉就停，交给人处理。
 *   2. 在唯一命名的临时 task 分支中准备合并；冲突都是生成物时重生成，否则放弃，不推送任何 ref。
 *   3. 给了 --close-window：从 main 单独提交窗口关闭，再把这个提交合回 stage；不把 stage 的未发布功能带进 main。
 *   4. 全部本地检查成功后，先推两个远端的 stage，再推 main；保留正常 Git 钩子。
 *   5. 给了 --preview-tag 且这次有新提交进了 stage：在新的 stage 提交上打附注 tag，先推 origin（GitHub，触发预发布部署）再推 source。
 *      打发布 tag 要所有者对这次打 tag 的批准摘要（--tag-approval，至少 8 个字，写进 tag 说明）；hotfix 窗口的批准不自动包含打 tag。
 *      种类：--close-window 带来的收尾提交打 vX.Y.Z-stable.N；合进来的 main 提交里有开着的 hotfix 窗口归属打 vX.Y.Z-hf.N；其它不打。
 *      X.Y.Z 是合并后 stage 的 package.json version；N 是同一 X.Y.Z、同一种类里已用的最大值加一（两个远端与本地的 tag 合起来看）。
 *      tag 的规则（release-policy 的 hotfixTagProblems）在推送之前核对，不通过就什么都不推。
 *   --preview-tag 只能在 source 与 origin（GitHub 镜像）两个不同远端之间用：tag 触发部署在 origin 上，pre-push 也只按 origin/stage 判断。
 * 不改 refs 以外的任何东西：不 reset、不删分支（临时分支除外）、不动已有的发布 tag。重复运行是幂等的。
 */
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { WINDOWS_FILE, activeWindows, readRegistryAt } from './hotfix-windows.mjs';
import { judgeAhead } from './promotion-windows.mjs';
import { displayBodyOf, hotfixTagProblems, nextPreviewNumber, packageVersionAt, parseReleaseTag } from './release-policy.mjs';

/** 冲突时可以重生成的文件：命令在合并的 worktree 里运行，成功后这些文件按重生成的结果提交。 */
export const GENERATED = Object.freeze([
  { paths: ['docs/INDEX.md'], command: ['node', 'scripts/docs-index.mjs'] },
  { paths: ['notes/INDEX.md'], command: ['node', 'scripts/note.mjs', 'index'] },
]);

const SHA_RE = /^[a-f0-9]{40}$/;
const NAME_RE = /^[A-Za-z0-9._-]+$/;
/** tag 触发的预发布部署在 origin（GitHub）上；pre-push 的 tag 规则也只认 origin/stage。两者以外的组合不打 tag。 */
const PREVIEW_REMOTE_MESSAGE = '--preview-tag 只能在 source 与 origin（GitHub 镜像）两个不同远端之间使用：tag 触发预发布部署在 origin 上，pre-push 也只按 origin/stage 判断 tag 所在的提交。';
/** 发布 tag 要对该版本的明确授权（AGENTS.md §3、docs/conventions/RELEASES.md）；批准摘要写进 tag 说明，事后可查。 */
const TAG_APPROVAL_MESSAGE = '--preview-tag 要带 --tag-approval "<所有者对这次打 tag 的批准摘要>"（至少 8 个字）：发布 tag 要对该版本的明确授权，hotfix 窗口的批准不自动包含打 tag。没有批准摘要就去掉 --preview-tag，只同步不打 tag。';

function run(cwd, command, args, options = {}) {
  const result = spawnSync(command, args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], timeout: 120000, maxBuffer: 16 * 1024 * 1024, ...options });
  if (result.error) throw new Error(`无法执行 ${command} ${args.join(' ')}：${result.error.message}`);
  return result;
}
const git = (cwd, ...args) => run(cwd, 'git', ['-c', 'commit.gpgSign=false', '-c', 'tag.gpgSign=false', ...args]);
const gitOk = (cwd, ...args) => {
  const result = git(cwd, ...args);
  if (result.status !== 0) throw new Error(`git ${args.join(' ')} 失败：${(result.stderr || result.stdout).trim()}`);
  return result.stdout.trim();
};
const revParse = (cwd, ref) => { const r = git(cwd, 'rev-parse', '--verify', '--quiet', `${ref}^{commit}`); return r.status === 0 && SHA_RE.test(r.stdout.trim()) ? r.stdout.trim() : null; };
const isAncestor = (cwd, a, b) => git(cwd, 'merge-base', '--is-ancestor', a, b).status === 0;
const hasRemote = (cwd, name) => git(cwd, 'remote', 'get-url', name).status === 0;

/** 北京时间，和 notes、同构清单同一写法。 */
export function beijingNow(date = new Date()) {
  const parts = new Intl.DateTimeFormat('sv-SE', { timeZone: 'Asia/Shanghai', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23' }).format(date);
  return `${parts.replace(' ', 'T')}+08:00`;
}

function fetchBranches(repo, remote) {
  const result = git(repo, 'fetch', '--quiet', remote, `+refs/heads/main:refs/remotes/${remote}/main`, `+refs/heads/stage:refs/remotes/${remote}/stage`);
  if (result.status !== 0) throw new Error(`无法从 ${remote} 取 main、stage：${(result.stderr || '').trim()}`);
  return { main: revParse(repo, `refs/remotes/${remote}/main`), stage: revParse(repo, `refs/remotes/${remote}/stage`) };
}

/** 只读：现状与打算做的事。 */
export function planSync({ repo = process.cwd(), source = 'gitlab', mirror = 'origin' } = {}) {
  for (const name of [source, mirror]) if (!NAME_RE.test(name) || !hasRemote(repo, name)) throw new Error(`找不到远端 ${name}`);
  const src = fetchBranches(repo, source);
  const mir = mirror === source ? src : fetchBranches(repo, mirror);
  const steps = [];
  const problems = [];
  if (mirror !== source && mir.main !== src.main) {
    if (isAncestor(repo, mir.main, src.main)) steps.push(`把 ${mirror}/main 快进到 ${src.main.slice(0, 12)}`);
    else problems.push(`${mirror}/main（${mir.main.slice(0, 12)}）不是 ${source}/main（${src.main.slice(0, 12)}）的祖先：两边分叉，不强推，交给人处理`);
  }
  const needMerge = !isAncestor(repo, src.main, src.stage);
  if (mirror !== source && needMerge && mir.stage !== src.stage
    && !isAncestor(repo, mir.stage, src.stage) && !isAncestor(repo, mir.stage, src.main)) {
    problems.push(`${mirror}/stage（${mir.stage.slice(0, 12)}）不包含在 ${source}/stage 或 ${source}/main 中：合并后也无法快进，推送前停止，不强推`);
  }
  if (needMerge) steps.push(`把 ${source}/main 合进 ${source}/stage（${src.stage.slice(0, 12)}），再推 ${source} 与 ${mirror} 的 stage`);
  else if (mirror !== source && mir.stage !== src.stage) {
    if (isAncestor(repo, mir.stage, src.stage)) steps.push(`把 ${mirror}/stage 快进到 ${src.stage.slice(0, 12)}`);
    else problems.push(`${mirror}/stage（${mir.stage.slice(0, 12)}）不是 ${source}/stage 的祖先：两边分叉，不强推`);
  }
  return { source, mirror, src, mir, needMerge, steps, problems, inSync: !steps.length && !problems.length };
}

function resolveGenerated(worktree, conflicts, generated) {
  const resolvable = new Map(generated.flatMap(entry => entry.paths.map(path => [path, entry])));
  const unresolved = conflicts.filter(path => !resolvable.has(path));
  if (unresolved.length) return { ok: false, unresolved };
  for (const entry of new Set(conflicts.map(path => resolvable.get(path)))) {
    // 先让冲突文件取 stage 一侧，生成命令按合并后的整棵树重新写出这些文件
    for (const path of entry.paths) if (conflicts.includes(path)) gitOk(worktree, 'checkout', '--ours', '--', path);
    const result = run(worktree, entry.command[0], entry.command.slice(1));
    if (result.status !== 0) return { ok: false, unresolved: entry.paths.filter(path => conflicts.includes(path)), reason: `${entry.command.join(' ')} 失败：${(result.stderr || result.stdout).trim().split('\n')[0]}` };
  }
  gitOk(worktree, 'add', '--', ...conflicts);
  return { ok: true, unresolved: [] };
}

function closeWindowFile(worktree, issue, evidence, now) {
  const file = join(worktree, WINDOWS_FILE);
  const registry = JSON.parse(readFileSync(file, 'utf8'));
  const window = registry.windows.find(item => item.issue === issue && item.status === 'open');
  if (!window) throw new Error(`${WINDOWS_FILE} 里没有 #${issue} 开着的窗口，不能关闭`);
  window.status = 'closed';
  window.closedAt = beijingNow(now);
  window.evidence = evidence;
  delete window.expiresAt;
  writeFileSync(file, `${JSON.stringify(registry, null, 2)}\n`);
  gitOk(worktree, 'add', '--', WINDOWS_FILE);
  gitOk(worktree, 'commit', '--quiet', '-m', `chore(deploy): 关闭 hotfix 窗口 #${issue}`);
}

const push = (repo, remote, ref, branch) => gitOk(repo, 'push', '--quiet', remote, `${ref}:refs/heads/${branch}`);

/** 两个远端与本地现有的 tag 名（ls-remote 不改任何 ref）。挑 N 时两边合起来看，不复用任何一边已有的号。 */
export function existingTagNames(repo, remotes) {
  const names = new Set(gitOk(repo, 'tag', '--list').split('\n').filter(Boolean));
  for (const remote of new Set(remotes)) {
    for (const line of gitOk(repo, 'ls-remote', '--tags', remote).split('\n')) {
      const ref = line.split('\t')[1] ?? '';
      if (ref.startsWith('refs/tags/')) names.add(ref.slice('refs/tags/'.length).replace(/\^\{\}$/, ''));
    }
  }
  return [...names];
}

/** 只读预测：stage 与 main 合并之后根 package.json 的 version（只写临时对象，不动 refs 与工作区；冲突或读不到返回 null）。 */
export function mergedVersion(repo, stageSha, mainSha) {
  const merged = git(repo, 'merge-tree', '--write-tree', stageSha, mainSha);
  if (merged.status !== 0) return null;
  const tree = (merged.stdout ?? '').split('\n')[0].trim();
  if (!/^[a-f0-9]{40,64}$/.test(tree)) return null;
  const manifest = git(repo, 'show', `${tree}:package.json`);
  if (manifest.status !== 0) return null;
  try {
    const { version } = JSON.parse(manifest.stdout);
    return typeof version === 'string' ? version : null;
  } catch {
    return null;
  }
}

/**
 * 这次运行要打的预发布 tag；没有新提交进 stage 就不打。stableRun（用了 --close-window）打 stable；
 * 否则合进来的 main 提交里有开着的 hotfix 窗口归属就打 hf；其它（比如只挑 pick 的晋升）不打。N 由 nextPreviewNumber 给出。
 */
export function previewTagOf({ moved, stableRun, hotfixMerged, version, tagNames }) {
  if (!moved) return null;
  const kind = stableRun ? 'stable' : hotfixMerged ? 'hf' : null;
  if (!kind) return null;
  const number = nextPreviewNumber(tagNames, { version, kind });
  return { kind, tag: `v${version}-${kind}.${number}`, version, number, display: displayBodyOf({ kind, version, number }) };
}

/** 合进 stage 的那段 main 提交里，有没有归属开着的 hotfix 窗口（晋升窗口挑进来的不算）。 */
function hotfixAheadOf(repo, src, now) {
  return judgeAhead({ repo, mainSha: src.main, stageSha: src.stage, now }).attributed.some(item => item.kind === 'hotfix');
}

/** --close-window 是否真的要在 main 上登记收尾（已经关闭过就不再写）。 */
const closeNeeded = (registry, closeWindow) => closeWindow !== undefined && !(registry?.windows ?? []).some(item => item.issue === closeWindow && item.status === 'closed');
/** 登记读不出来就当作没有窗口（与原先一致）。 */
const registryOf = (repo, rev) => { try { return readRegistryAt(repo, rev); } catch { return null; } };

/** plan 里预告 --preview-tag 会打的 tag（只读）。 */
function previewLine({ repo, plan, closeWindow, source, mirror }) {
  const moved = plan.needMerge || closeNeeded(registryOf(repo, plan.src.main), closeWindow);
  if (!moved) return '预发布 tag：不打，stage 没有新提交。';
  const version = mergedVersion(repo, plan.src.stage, plan.src.main);
  if (!version) return '预发布 tag：不打，合并后读不到 package.json 的 version（合并冲突，或版本不是 X.Y.Z），apply 会在推送前停下。';
  const candidate = previewTagOf({
    moved, stableRun: closeNeeded(registryOf(repo, plan.src.main), closeWindow), hotfixMerged: hotfixAheadOf(repo, plan.src, new Date()), version, tagNames: existingTagNames(repo, [source, mirror]),
  });
  if (!candidate) return '预发布 tag：不打，这次合进 stage 的不是热修复，也没有收尾登记。';
  return `预发布 tag：将打 ${candidate.tag}（${candidate.kind}，展示 ${candidate.display}@<stage 提交前 12 位>）；apply 推送前核对，通过后推 ${mirror}（触发部署）再推 ${source}。`;
}

/** 执行同步。冲突无法自动取舍时返回 { ok: false, code: 3 }，什么都没推。 */
export function applySync({ repo = process.cwd(), source = 'gitlab', mirror = 'origin', issue, closeWindow, evidence, previewTag = false, tagApproval, generated = GENERATED, now = new Date(), log = () => {} } = {}) {
  const plan = planSync({ repo, source, mirror });
  if (plan.problems.length) return { ok: false, code: 2, plan, messages: plan.problems };
  if (closeWindow !== undefined && (!Number.isInteger(closeWindow) || !String(evidence ?? '').trim() || String(evidence).trim().length < 8)) {
    return { ok: false, code: 2, plan, messages: ['--close-window 要带窗口 issue 和 --evidence（合回 stage 的提交与线上核对结果）'] };
  }
  if (previewTag && (mirror === source || mirror !== 'origin')) return { ok: false, code: 2, plan, messages: [PREVIEW_REMOTE_MESSAGE] };
  if (previewTag && String(tagApproval ?? '').trim().length < 8) return { ok: false, code: 2, plan, messages: [TAG_APPROVAL_MESSAGE] };
  const { src } = plan;
  let mainSha = src.main;
  let stageSha = src.stage;
  let temporary = null;
  const worktrees = [];
  const branches = [];
  const registry = registryOf(repo, src.main);
  const windows = registry ? activeWindows(registry, now) : [];
  const issueNumber = issue ?? closeWindow ?? (windows.length === 1 ? windows[0].issue : 0);
  const wantsClose = closeNeeded(registry, closeWindow);
  try {
    const prepare = (name, start) => {
      temporary ??= mkdtempSync(join(tmpdir(), 'hotfix-sync-'));
      const suffix = basename(temporary).slice('hotfix-sync-'.length).toLowerCase();
      const branch = `task/${issueNumber}/hotfix_sync_${name}_${suffix}`;
      const worktree = join(temporary, name);
      gitOk(repo, 'worktree', 'add', '--quiet', '-b', branch, worktree, start);
      worktrees.push(worktree);
      branches.push(branch);
      return { branch, worktree };
    };
    if (wantsClose) {
      const main = prepare('main', src.main);
      closeWindowFile(main.worktree, closeWindow, String(evidence).trim(), now);
      mainSha = gitOk(main.worktree, 'rev-parse', 'HEAD');
    }
    let stageBranch = null;
    if (plan.needMerge || wantsClose || (mirror !== source && plan.mir.stage !== src.stage)) {
      const stage = prepare('stage', src.stage);
      stageBranch = stage.branch;
      if (!isAncestor(repo, mainSha, src.stage)) {
        const merged = git(stage.worktree, 'merge', '--no-ff', '--no-edit', '-m', `Merge branch 'main' into 'stage' (hotfix #${issueNumber})`, mainSha);
        if (merged.status !== 0) {
          const conflicts = gitOk(stage.worktree, 'diff', '--name-only', '--diff-filter=U').split('\n').filter(Boolean);
          const outcome = conflicts.length ? resolveGenerated(stage.worktree, conflicts, generated) : { ok: false, unresolved: [], reason: (merged.stderr || merged.stdout).trim() };
          if (!outcome.ok) {
            git(stage.worktree, 'merge', '--abort');
            return { ok: false, code: 3, plan, messages: [`main 合进 stage 有冲突，不是生成物，没有推送任何东西：${outcome.unresolved.join('、') || outcome.reason}`, ...(outcome.reason ? [outcome.reason] : []), '人工处理：在获批任务的独立 worktree 中解决冲突，审查后合回 stage'] };
          }
          gitOk(stage.worktree, 'commit', '--quiet', '--no-edit');
        }
      }
      stageSha = gitOk(stage.worktree, 'rev-parse', 'HEAD');
    }
    if (!isAncestor(repo, mainSha, stageSha)) return { ok: false, code: 2, plan, messages: ['合并之后 stage 仍不包含 main：不推送'] };
    if (mirror !== source && !isAncestor(repo, plan.mir.stage, stageSha)) return { ok: false, code: 2, plan, messages: [`${mirror}/stage 不是新的 stage 的祖先：两边分叉，不推送`] };

    // 预发布 tag 在推送之前算好、核对好：规则不过就什么都不推。先把两个远端的 tag 拉到本地，pre-push 看到的 tag 集合才一致。
    let tag = null;
    if (previewTag && stageSha !== src.stage) {
      try {
        for (const remote of [source, mirror]) gitOk(repo, 'fetch', '--quiet', '--tags', remote);
        const version = packageVersionAt(repo, stageSha);
        const tagNames = existingTagNames(repo, [source, mirror]);
        const candidate = previewTagOf({ moved: true, stableRun: wantsClose, hotfixMerged: hotfixAheadOf(repo, src, now), version, tagNames });
        if (candidate) {
          const problems = hotfixTagProblems({ repo, release: parseReleaseTag(candidate.tag), commit: stageSha, tagNames, isNew: true, mainSha });
          if (problems.length) return { ok: false, code: 2, plan, messages: problems.map(problem => `预发布 tag ${candidate.tag} 没有打，也没有推送任何东西：${problem}`) };
          tag = candidate;
        }
      } catch (error) {
        return { ok: false, code: 2, plan, messages: [`预发布 tag 准备失败，没有推送任何东西：${error.message}`] };
      }
    }
    if (stageSha !== src.stage) { push(repo, source, stageBranch, 'stage'); log(`${source}/stage → ${stageSha.slice(0, 12)}`); }
    if (mirror !== source && plan.mir.stage !== stageSha) { push(repo, mirror, stageBranch, 'stage'); log(`${mirror}/stage → ${stageSha.slice(0, 12)}`); }
    for (const remote of new Set([source, mirror])) {
      const previous = remote === source ? src.main : plan.mir.main;
      if (previous !== mainSha) { push(repo, remote, mainSha, 'main'); log(`${remote}/main → ${mainSha.slice(0, 12)}`); }
    }
    if (tag) {
      try {
        // 附注 tag 打在新的 stage 提交上；推送顺序：origin（GitHub，触发预发布部署）在前，source 在后。
        gitOk(repo, 'tag', '-a', tag.tag, '-m', `预发布 ${tag.tag}（${tag.display}@${stageSha.slice(0, 12)}）\n\n授权：${String(tagApproval).trim()}`, stageSha);
        for (const remote of [mirror, source]) {
          gitOk(repo, 'push', '--quiet', remote, `refs/tags/${tag.tag}:refs/tags/${tag.tag}`);
          log(`${remote}/tag ${tag.tag} → ${stageSha.slice(0, 12)}`);
        }
      } catch (error) {
        return {
          ok: false, code: 1, plan, main: mainSha, stage: stageSha,
          messages: [`stage 与 main 已经推送，但预发布 tag ${tag.tag} 没有完整完成：${error.message}`, '不要换名字，也不要移动已推送的 tag：用 git ls-remote --tags 看两个远端，缺的那个再手工推送同一个 tag。'],
        };
      }
    }
    return { ok: true, code: 0, plan, main: mainSha, stage: stageSha, tag, messages: [] };
  } finally {
    for (const worktree of worktrees.reverse()) git(repo, 'worktree', 'remove', '--force', worktree);
    for (const branch of branches.reverse()) git(repo, 'branch', '-D', branch);
    if (temporary) rmSync(temporary, { recursive: true, force: true });
  }
}

function option(argv, name) {
  const index = argv.indexOf(`--${name}`);
  return index >= 0 ? argv[index + 1] : undefined;
}

export function main(argv) {
  const [command, ...rest] = argv;
  const repo = process.cwd();
  const source = option(rest, 'source') ?? (hasRemote(repo, 'gitlab') ? 'gitlab' : 'origin');
  const mirror = option(rest, 'mirror') ?? 'origin';
  const previewTag = rest.includes('--preview-tag');
  if (command === 'plan') {
    const plan = planSync({ repo, source, mirror });
    console.log(`${source}/main ${plan.src.main.slice(0, 12)}  ${source}/stage ${plan.src.stage.slice(0, 12)}  ${mirror}/main ${plan.mir.main.slice(0, 12)}  ${mirror}/stage ${plan.mir.stage.slice(0, 12)}`);
    if (plan.inSync) console.log('已同步：stage 包含 main，两个远端一致。');
    for (const step of plan.steps) console.log(`要做：${step}`);
    if (previewTag) {
      const closeWindow = option(rest, 'close-window');
      if (mirror === source || mirror !== 'origin') plan.problems.push(PREVIEW_REMOTE_MESSAGE);
      else if (closeWindow !== undefined && !Number.isInteger(Number(closeWindow))) plan.problems.push('--close-window 需要窗口 issue 号');
      else console.log(previewLine({ repo, plan, closeWindow: closeWindow === undefined ? undefined : Number(closeWindow), source, mirror }));
    } else console.log('预发布 tag：不指定 --preview-tag，apply 不打 tag。');
    for (const problem of plan.problems) console.error(`停：${problem}`);
    return plan.problems.length ? 2 : 0;
  }
  if (command === 'apply') {
    const closeWindow = option(rest, 'close-window');
    const issue = option(rest, 'issue');
    const result = applySync({
      repo, source, mirror,
      issue: issue === undefined ? undefined : Number(issue),
      closeWindow: closeWindow === undefined ? undefined : Number(closeWindow),
      evidence: option(rest, 'evidence'),
      previewTag,
      tagApproval: option(rest, 'tag-approval'),
      log: line => console.log(`推送 ${line}`),
    });
    for (const message of result.messages) console.error(message);
    if (result.ok) console.log(result.plan.inSync && !result.stage ? '已同步，没有要做的事。' : `完成：stage ${result.stage.slice(0, 12)} 包含 main。`);
    if (result.ok && previewTag) {
      console.log(result.tag
        ? `预发布 tag ${result.tag.tag} 已打在 stage ${result.stage.slice(0, 12)} 上，展示 ${result.tag.display}@${result.stage.slice(0, 12)}，已推到 ${mirror} 与 ${source}。`
        : '预发布 tag：没有打，这次没有新的热修复或收尾提交进 stage。');
    }
    return result.code;
  }
  console.error('用法：node scripts/hotfix-sync.mjs plan|apply [--source gitlab] [--mirror origin] [--issue n] [--close-window n --evidence "…"] [--preview-tag --tag-approval "<所有者批准摘要>"]');
  return 2;
}

if (process.argv[1] && pathToFileURL(realpathSync(process.argv[1])).href === import.meta.url) {
  try { process.exitCode = main(process.argv.slice(2)); } catch (error) { console.error(error.message); process.exitCode = 1; }
}

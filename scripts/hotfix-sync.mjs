#!/usr/bin/env node
/**
 * hotfix 合进 main 之后的收尾：把 main 同步到镜像远端，再把 main 合回 stage，保证 stage >= main。
 *
 *   node scripts/hotfix-sync.mjs plan  [--source gitlab] [--mirror origin]   只读：列出要做的事
 *   node scripts/hotfix-sync.mjs apply [--source gitlab] [--mirror origin] [--issue <n>]
 *                                      [--close-window <n> --evidence "<合回 stage 的提交与线上核对>"]
 *
 * apply 的步骤（任何一步不满足就停下，不强推、不覆盖）：
 *   1. 取两个远端的 main、stage。镜像的 main 必须是源的祖先，才快进推过去；两边分叉就停，交给人处理。
 *   2. 在唯一命名的临时 task 分支中准备合并；冲突都是生成物时重生成，否则放弃，不推送任何 ref。
 *   3. 给了 --close-window：从 main 单独提交窗口关闭，再把这个提交合回 stage；不把 stage 的未发布功能带进 main。
 *   4. 全部本地检查成功后，先推两个远端的 stage，再推 main；保留正常 Git 钩子。
 * 不改 refs 以外的任何东西：不 reset、不删分支（临时分支除外）、不动发布 tag。重复运行是幂等的。
 */
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { WINDOWS_FILE, activeWindows, readRegistryAt } from './hotfix-windows.mjs';

/** 冲突时可以重生成的文件：命令在合并的 worktree 里运行，成功后这些文件按重生成的结果提交。 */
export const GENERATED = Object.freeze([
  { paths: ['docs/INDEX.md'], command: ['node', 'scripts/docs-index.mjs'] },
  { paths: ['notes/INDEX.md'], command: ['node', 'scripts/note.mjs', 'index'] },
]);

const SHA_RE = /^[a-f0-9]{40}$/;
const NAME_RE = /^[A-Za-z0-9._-]+$/;

function run(cwd, command, args, options = {}) {
  const result = spawnSync(command, args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], timeout: 120000, maxBuffer: 16 * 1024 * 1024, ...options });
  if (result.error) throw new Error(`无法执行 ${command} ${args.join(' ')}：${result.error.message}`);
  return result;
}
const git = (cwd, ...args) => run(cwd, 'git', ['-c', 'commit.gpgSign=false', ...args]);
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

/** 执行同步。冲突无法自动取舍时返回 { ok: false, code: 3 }，什么都没推。 */
export function applySync({ repo = process.cwd(), source = 'gitlab', mirror = 'origin', issue, closeWindow, evidence, generated = GENERATED, now = new Date(), log = () => {} } = {}) {
  const plan = planSync({ repo, source, mirror });
  if (plan.problems.length) return { ok: false, code: 2, plan, messages: plan.problems };
  if (closeWindow !== undefined && (!Number.isInteger(closeWindow) || !String(evidence ?? '').trim() || String(evidence).trim().length < 8)) {
    return { ok: false, code: 2, plan, messages: ['--close-window 要带窗口 issue 和 --evidence（合回 stage 的提交与线上核对结果）'] };
  }
  const { src } = plan;
  let mainSha = src.main;
  let stageSha = src.stage;
  let temporary = null;
  const worktrees = [];
  const branches = [];
  const registry = (() => { try { return readRegistryAt(repo, src.main); } catch { return null; } })();
  const windows = registry ? activeWindows(registry, now) : [];
  const issueNumber = issue ?? closeWindow ?? (windows.length === 1 ? windows[0].issue : 0);
  const wantsClose = closeWindow !== undefined && !(registry?.windows ?? []).some(item => item.issue === closeWindow && item.status === 'closed');
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
    if (stageSha !== src.stage) { push(repo, source, stageBranch, 'stage'); log(`${source}/stage → ${stageSha.slice(0, 12)}`); }
    if (mirror !== source && plan.mir.stage !== stageSha) { push(repo, mirror, stageBranch, 'stage'); log(`${mirror}/stage → ${stageSha.slice(0, 12)}`); }
    for (const remote of new Set([source, mirror])) {
      const previous = remote === source ? src.main : plan.mir.main;
      if (previous !== mainSha) { push(repo, remote, mainSha, 'main'); log(`${remote}/main → ${mainSha.slice(0, 12)}`); }
    }
    return { ok: true, code: 0, plan, main: mainSha, stage: stageSha, messages: [] };
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
  if (command === 'plan') {
    const plan = planSync({ repo, source, mirror });
    console.log(`${source}/main ${plan.src.main.slice(0, 12)}  ${source}/stage ${plan.src.stage.slice(0, 12)}  ${mirror}/main ${plan.mir.main.slice(0, 12)}  ${mirror}/stage ${plan.mir.stage.slice(0, 12)}`);
    if (plan.inSync) console.log('已同步：stage 包含 main，两个远端一致。');
    for (const step of plan.steps) console.log(`要做：${step}`);
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
      log: line => console.log(`推送 ${line}`),
    });
    for (const message of result.messages) console.error(message);
    if (result.ok) console.log(result.plan.inSync && !result.stage ? '已同步，没有要做的事。' : `完成：stage ${result.stage.slice(0, 12)} 包含 main。`);
    return result.code;
  }
  console.error('用法：node scripts/hotfix-sync.mjs plan|apply [--source gitlab] [--mirror origin] [--issue n] [--close-window n --evidence "…"]');
  return 2;
}

if (process.argv[1] && pathToFileURL(realpathSync(process.argv[1])).href === import.meta.url) {
  try { process.exitCode = main(process.argv.slice(2)); } catch (error) { console.error(error.message); process.exitCode = 1; }
}

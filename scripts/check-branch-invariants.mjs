#!/usr/bin/env node
/**
 * 分支模型门禁：main/stage 硬不变量 + 分支命名卫生 + pre-push 守卫。
 *
 * 只读 Git 证据：不 fetch、不改 refs、不删分支、不创建提交、不连接远端。
 *
 * 硬不变量（任何模式违反即 exit 1）：
 *   I1  `stage` 必须包含 `main`：`git merge-base --is-ancestor origin/main origin/stage` 必须为真（即 stage ≥ main）。
 *   I2  `main` 不得领先 `stage`：任何写入 `main` 的提交都必须已经存在于 `stage`（只允许把 stage 快进/合并进 main）。
 *
 * 分支命名规范（2026-09-23 起分支名一律不用 `-`，只用 `/` 分层；每段只含小写字母与数字，段内多个词用 `_` 连接）：
 *   main / stage         长期分支，只允许这两条
 *   task/<issue>/<slug>  从 stage 拉出，PR 回 stage，合并后删除；例：task/12/portal_redesign
 *   dev/<username>       个人自由开发分支：只做验证、不部署，也不得作为进入 stage 的凭据；例：dev/crosery
 *   其它名字             违规（含旧的 task/<issue>-<slug> 与 dev-<username>）。默认只告警（CI 上不硬失败），
 *                        --strict-long-lived 时升级为失败。
 *
 * 用法：
 *   node scripts/check-branch-invariants.mjs [--repo <path>] [--require-remote-refs] [--strict-long-lived] [--json] [--push]
 *
 * --push 模式从 stdin 读 pre-push 的四段行：`<local ref> <local sha> <remote ref> <remote sha>`，
 * 并额外断言：推 refs/heads/main 的提交必须已经存在于 stage；推 refs/heads/stage 只能来自
 * stage 自身或 task/<issue>/<slug> 分支，且必须已经包含 origin/main；不得删除远端 main/stage。
 *
 * 发布 tag（发版只靠打 tag，规则唯一实现见 scripts/release-policy.mjs）在 --push 模式下：
 *   v 开头且紧跟数字的 tag 都按发布 tag 判定，格式不是 vX.Y.Z-rc.N / vX.Y.Z → 违规
 *   vX.Y.Z-rc.N 的提交不在 stage / origin/stage 里 → 违规
 *   vX.Y.Z 的提交不在 main / origin/main 里 → 违规；同一提交本地没有 vX.Y.Z-rc.N → 告警（以 CI 证据为准）
 *   X.Y.Z 与该提交 package.json 的 version 不一致、或给已正式发布的版本再打 rc → 违规
 *   删除或移动（force）发布 tag → 违规（删除格式不合规的 v 开头 tag 只告警，属于清理）
 *   其它 tag 只告警：不参与发版。
 */

import { spawnSync } from 'node:child_process';
import { readFileSync, realpathSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { RELEASE_TAG_RE, listTagCommits, packageVersionAt, parseReleaseTag, previewTagsFor } from './release-policy.mjs';

/** 两条硬不变量原文（失败时必须原样打印）。 */
export const INVARIANTS = Object.freeze([
  '`stage` 必须包含 `main`：`git merge-base --is-ancestor origin/main origin/stage` 必须为真（即 stage ≥ main）。',
  '`main` 不得领先 `stage`：任何写入 `main` 的提交都必须已经存在于 `stage`（只允许把 stage 快进/合并进 main）。',
]);
export const LONG_LIVED_BRANCHES = Object.freeze(['main', 'stage']);
// 段规则 [a-z0-9]+(?:_[a-z0-9]+)*：不允许 `-`、大写、首尾或连续的 `_`。GitHub 用户名里的 `-` 写成 `_`。
export const TASK_BRANCH_RE = /^task\/[0-9]+\/[a-z0-9]+(?:_[a-z0-9]+)*$/;
export const DEV_BRANCH_RE = /^dev\/[a-z0-9]+(?:_[a-z0-9]+)*$/;
const ZERO_SHA = /^0{40}$/;
const SHA_RE = /^[a-f0-9]{40}$/;
/** v（或 V）后紧跟数字的 tag 都在声称自己是发布 tag，必须完全符合 RELEASE_TAG_RE。 */
const RELEASE_SHAPED_TAG_RE = /^[vV][0-9]/;

const FIX_MAIN = [
  '  修复：先把 main 上的提交合回 stage，再让 main 只做快进：',
  '    git switch stage && git merge --no-ff <main 上的提交> && git push origin stage',
  '    git switch main && git merge --ff-only stage && git push origin main',
].join('\n');
const FIX_STAGE = [
  '  修复：只在 stage 上合并任务分支，再推送 stage：',
  '    git switch stage && git merge --no-ff task/<issue>/<slug> && git push origin stage',
].join('\n');

/** 旧的 `task-…` / `dev-…` 前缀也归到对应的 malformed，让告警直接指出新写法。 */
export function classifyBranch(name) {
  if (LONG_LIVED_BRANCHES.includes(name)) return 'long-lived';
  if (name.startsWith('task/') || name.startsWith('task-')) return TASK_BRANCH_RE.test(name) ? 'task' : 'task-malformed';
  if (name.startsWith('dev/') || name.startsWith('dev-')) return DEV_BRANCH_RE.test(name) ? 'personal' : 'personal-malformed';
  return 'unexpected';
}

function git(repo, args) {
  const result = spawnSync('git', ['-c', 'core.hooksPath=/dev/null', ...args], {
    cwd: repo,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
    timeout: 20000,
    maxBuffer: 8 * 1024 * 1024,
  });
  if (result.error) throw new Error(`无法执行 git ${args.join(' ')}：${result.error.message}`);
  return result;
}

export function resolveCommit(repo, ref) {
  const result = git(repo, ['rev-parse', '--verify', '--quiet', `${ref}^{commit}`]);
  const value = (result.stdout ?? '').trim();
  return result.status === 0 && SHA_RE.test(value) ? value : null;
}

export function isAncestor(repo, earlier, later) {
  const result = git(repo, ['merge-base', '--is-ancestor', earlier, later]);
  if (result.status === 0) return true;
  if (result.status === 1) return false;
  throw new Error(`无法判定祖先关系（${earlier} → ${later}）：${(result.stderr ?? '').trim()}`);
}

/** 取某条分支的证据：优先远端跟踪分支（origin），CI 用 --require-remote-refs 禁止回落本地。 */
export function resolveBranchEvidence({ repo, branch, requireRemote = false }) {
  const remoteRef = `refs/remotes/origin/${branch}`;
  const localRef = `refs/heads/${branch}`;
  const remote = resolveCommit(repo, remoteRef);
  if (remote) return { branch, ref: remoteRef, sha: remote, scope: 'remote' };
  if (requireRemote) {
    throw new Error(`找不到 ${remoteRef}：判定不变量需要远端证据（checkout 请使用 fetch-depth: 0），不会回落到本地分支。`);
  }
  const local = resolveCommit(repo, localRef);
  if (local) return { branch, ref: localRef, sha: local, scope: 'local' };
  throw new Error(`找不到 ${remoteRef} 或 ${localRef}：缺少判定不变量所需的 Git 证据。`);
}

export function collectBranches(repo) {
  const result = git(repo, ['for-each-ref', '--format=%(refname)', 'refs/heads', 'refs/remotes/origin']);
  if (result.status !== 0) throw new Error(`无法枚举分支：${(result.stderr ?? '').trim()}`);
  const branches = new Map();
  for (const ref of (result.stdout ?? '').trim().split('\n').filter(Boolean)) {
    let name = null;
    let scope = null;
    if (ref.startsWith('refs/heads/')) {
      name = ref.slice('refs/heads/'.length);
      scope = 'local';
    } else if (ref.startsWith('refs/remotes/origin/')) {
      name = ref.slice('refs/remotes/origin/'.length);
      if (name === 'HEAD') continue;
      scope = 'remote';
    }
    if (!name || !scope) continue;
    const entry = branches.get(name) ?? { name, local: false, remote: false };
    entry[scope] = true;
    branches.set(name, entry);
  }
  return [...branches.values()].sort((left, right) => left.name.localeCompare(right.name));
}

function branchNamingMessage(branch) {
  const kind = classifyBranch(branch.name);
  const where = [branch.remote ? 'origin' : null, branch.local ? '本地' : null].filter(Boolean).join('+') || '未知来源';
  if (kind === 'unexpected') {
    return `分支 ${branch.name}（${where}）不是长期分支 main/stage，也不是 task/<issue>/<slug> 或 dev/<username>：长期分支只允许 main 与 stage，请合并后删除。`;
  }
  if (kind === 'task-malformed') {
    return `分支 ${branch.name}（${where}）不符合 task/<issue>/<slug> 命名（分支名不用 -，只用 / 分层，slug 词间用 _，例：task/12/portal_redesign）：请按 docs/conventions/ISSUES.md 先开 issue 再改名。`;
  }
  if (kind === 'personal-malformed') {
    return `分支 ${branch.name}（${where}）不符合 dev/<github-username> 命名（分支名不用 -，例：dev/crosery；旧名用 git branch -m 改名）：个人分支不部署，也不能作为进入 stage 的凭据。`;
  }
  return null;
}

/** 默认模式：两条硬不变量 + 分支命名卫生。 */
export function checkInvariants({ repo = process.cwd(), requireRemote = false, strictLongLived = false } = {}) {
  const violations = [];
  const warnings = [];
  const notes = [];
  const main = resolveBranchEvidence({ repo, branch: 'main', requireRemote });
  const stage = resolveBranchEvidence({ repo, branch: 'stage', requireRemote });
  notes.push(`证据：main=${main.ref}@${main.sha.slice(0, 12)}，stage=${stage.ref}@${stage.sha.slice(0, 12)}。`);
  if (main.scope === 'local' || stage.scope === 'local') {
    notes.push('提示：使用了本地分支作为证据；CI 必须用 --require-remote-refs 强制远端证据。');
  }
  if (!isAncestor(repo, main.sha, stage.sha)) {
    violations.push(`${INVARIANTS[0]}\n  证据：${main.sha.slice(0, 12)} 不是 ${stage.sha.slice(0, 12)} 的祖先，stage 缺少 main 的提交。`);
  }
  const aheadResult = git(repo, ['rev-list', '--max-count=50', `${stage.ref}..${main.ref}`]);
  const ahead = aheadResult.status === 0 ? (aheadResult.stdout ?? '').trim().split('\n').filter(Boolean) : [];
  if (ahead.length) {
    violations.push(`${INVARIANTS[1]}\n  证据：main 领先 stage 的提交 ${ahead.map(sha => sha.slice(0, 12)).join(' ')}`);
  }
  for (const branch of collectBranches(repo)) {
    const message = branchNamingMessage(branch);
    if (!message) continue;
    (strictLongLived ? violations : warnings).push(message);
  }
  return { ok: violations.length === 0, violations, warnings, notes, main, stage };
}

/** 解析 pre-push 传给 stdin 的四段行。 */
export function parsePushLines(text) {
  return String(text)
    .split('\n')
    .map(line => line.trim())
    .filter(Boolean)
    .map((line, index) => {
      const parts = line.split(/\s+/);
      if (parts.length !== 4) {
        throw new Error(`pre-push 第 ${index + 1} 行不是「<local ref> <local sha> <remote ref> <remote sha>」四段格式：${line}`);
      }
      const [localRef, localSha, remoteRef, remoteSha] = parts;
      return { localRef, localSha, remoteRef, remoteSha };
    });
}

function pickStageRef(repo) {
  for (const ref of ['refs/heads/stage', 'refs/remotes/origin/stage']) {
    const sha = resolveCommit(repo, ref);
    if (sha) return { ref, sha };
  }
  return null;
}

function pickMainRef(repo) {
  for (const ref of ['refs/remotes/origin/main', 'refs/heads/main']) {
    const sha = resolveCommit(repo, ref);
    if (sha) return { ref, sha };
  }
  return null;
}

/** pre-push 模式：main/stage 与发布 tag 的推送规则。 */
export function checkPushes({ repo = process.cwd(), pushes }) {
  const violations = [];
  const warnings = [];
  const notes = [];
  for (const push of pushes) {
    const { localRef, localSha, remoteRef, remoteSha } = push;
    const target = `${localRef} → ${remoteRef}`;
    if (remoteRef.startsWith('refs/tags/')) {
      checkTagPush({ repo, push, violations, warnings, notes });
      continue;
    }
    // githooks(5)：删除时 <local ref> 为 `(delete)`、<local sha> 全 0；<remote sha> 全 0 只表示远端还没有这个 ref
    // （首次推送新分支），不是删除，必须照常判定命名与不变量。
    if (localRef === '(delete)' || ZERO_SHA.test(localSha)) {
      if (remoteRef === 'refs/heads/main' || remoteRef === 'refs/heads/stage') {
        violations.push(`拒绝删除远端长期分支 ${remoteRef}：长期分支只允许 main 与 stage，删除会破坏分支模型。`);
      }
      continue;
    }
    if (!SHA_RE.test(localSha)) {
      warnings.push(`${target} 的本地 SHA 不是 40 位 commit（${localSha}）：跳过校验。`);
      continue;
    }
    if (remoteRef === 'refs/heads/main') {
      const stage = pickStageRef(repo);
      if (!stage) {
        violations.push(
          `拒绝推送到 refs/heads/main：本地既没有 refs/heads/stage 也没有 refs/remotes/origin/stage，无法确认被推提交已经在 stage 里。\n`
            + '  修复：git fetch origin stage && git switch stage（或先执行 git fetch 取回 origin/stage）。',
        );
        continue;
      }
      if (!isAncestor(repo, localSha, stage.sha)) {
        violations.push(
          `${INVARIANTS[1]}\n  证据：被推的 main tip ${localSha.slice(0, 12)} 不在 ${stage.ref}@${stage.sha.slice(0, 12)} 的历史里。\n${FIX_MAIN}`,
        );
        continue;
      }
      notes.push(`${target}：main tip ${localSha.slice(0, 12)} 已存在于 ${stage.ref}，允许推送（main 只做 stage 的快进）。`);
      continue;
    }
    if (remoteRef === 'refs/heads/stage') {
      const fromStage = localRef === 'refs/heads/stage';
      const fromTask = localRef.startsWith('refs/heads/task/') && TASK_BRANCH_RE.test(localRef.slice('refs/heads/'.length));
      if (!fromStage && !fromTask) {
        violations.push(
          `拒绝推送到 refs/heads/stage：来源 ${localRef} 既不是 stage 自身，也不是 task/<issue>/<slug> 分支（dev/<username> 与其它分支不得进入 stage）。\n${FIX_STAGE}`,
        );
      }
      const main = pickMainRef(repo);
      if (!main) {
        warnings.push('本地找不到 main 或 origin/main：无法在推送前确认 stage ≥ main，交由 CI 的 branch-guard 再判定。');
      } else if (!isAncestor(repo, main.sha, localSha)) {
        violations.push(
          `${INVARIANTS[0]}\n  证据：被推的 stage tip ${localSha.slice(0, 12)} 不包含 ${main.ref}@${main.sha.slice(0, 12)}。\n`
            + '  修复：git switch stage && git merge --no-ff origin/main && git push origin stage',
        );
      } else {
        notes.push(`${target}：stage ≥ main 成立，允许推送。`);
      }
      continue;
    }
    if (remoteRef.startsWith('refs/heads/')) {
      const name = remoteRef.slice('refs/heads/'.length);
      if (classifyBranch(name) !== 'task' && classifyBranch(name) !== 'personal' && classifyBranch(name) !== 'long-lived') {
        warnings.push(`${remoteRef} 不在 main、stage、task/<issue>/<slug>、dev/<username> 命名规范内（分支名不用 -）：CI 只做验证，该分支也不会被部署。`);
      }
      continue;
    }
  }
  return { ok: violations.length === 0, violations, warnings, notes };
}

function firstContaining(repo, commit, refs) {
  const available = refs.map(ref => ({ ref, sha: resolveCommit(repo, ref) })).filter(entry => entry.sha);
  return { available, container: available.find(entry => isAncestor(repo, commit, entry.sha)) ?? null };
}

/** pre-push 模式：refs/tags/* 的推送规则（发布 tag 不可删、不可移、只能打在对应长期分支的提交上）。 */
export function checkTagPush({ repo, push, violations, warnings, notes }) {
  const { localRef, localSha, remoteRef, remoteSha } = push;
  const name = remoteRef.slice('refs/tags/'.length);
  const releaseShaped = RELEASE_SHAPED_TAG_RE.test(name);
  if (localRef === '(delete)' || ZERO_SHA.test(localSha)) {
    if (parseReleaseTag(name)) {
      violations.push(`拒绝删除发布 tag ${remoteRef}：发布 tag 不可删除、不可重建；发错了就在新提交上打下一个 rc，或先升版本号。`);
    } else if (releaseShaped) {
      warnings.push(`${remoteRef}：删除的是格式不合规的 v 开头 tag（它从来不会触发部署），允许清理。`);
    } else warnings.push(`${remoteRef}：删除的是非发布 tag，不影响发版。`);
    return;
  }
  const moving = !ZERO_SHA.test(remoteSha) && remoteSha !== localSha;
  if (!releaseShaped) {
    warnings.push(
      `${remoteRef} 不是发布 tag（只有 vX.Y.Z-rc.N 与 vX.Y.Z 会触发部署）${moving ? '，并且这次推送会移动远端已有的同名 tag' : ''}。`,
    );
    return;
  }
  if (moving) {
    violations.push(
      `拒绝移动发布 tag ${remoteRef}：远端现有对象 ${remoteSha.slice(0, 12)}，这次要换成 ${localSha.slice(0, 12)}。`
        + '发布 tag 不可移动；要发新内容就打下一个 rc。',
    );
    return;
  }
  const release = parseReleaseTag(name);
  if (!release) {
    violations.push(`发布 tag ${name} 格式不对：只接受 vX.Y.Z-rc.N（预发布，N 从 1 开始）或 vX.Y.Z（正式），正则 ${RELEASE_TAG_RE}。`);
    return;
  }
  const commit = SHA_RE.test(localSha) ? resolveCommit(repo, localSha) : null;
  if (!commit) {
    violations.push(`发布 tag ${name} 没有指向一个本地能解析的提交（${localSha}）。`);
    return;
  }
  const short = commit.slice(0, 12);
  const refs = release.kind === 'rc'
    ? ['refs/heads/stage', 'refs/remotes/origin/stage']
    : ['refs/heads/main', 'refs/remotes/origin/main'];
  const { available, container } = firstContaining(repo, commit, refs);
  if (!available.length) {
    violations.push(`拒绝推送 ${name}：本地既没有 ${refs.join(' 也没有 ')}，确认不了它打在 ${release.branch} 的提交上。\n  修复：git fetch origin ${release.branch}`);
    return;
  }
  if (!container) {
    const where = available.map(entry => `${entry.ref}@${entry.sha.slice(0, 12)}`).join('、');
    violations.push(
      release.kind === 'rc'
        ? `预发布 tag ${name} 必须打在 stage 的提交上：${short} 不在 ${where} 的历史里。先把改动经 task PR 合进 stage，再在 stage 的提交上打 tag。`
        : `正式 tag ${name} 必须打在 main 的提交上：${short} 不在 ${where} 的历史里。先把 main 快进到验收过的 rc 提交（git merge --ff-only v${release.version}-rc.<N>），再打正式 tag。`,
    );
    return;
  }
  let version;
  try {
    version = packageVersionAt(repo, commit);
  } catch (error) {
    violations.push(`拒绝推送 ${name}：${error.message}`);
    return;
  }
  if (version !== release.version) {
    violations.push(`发布 tag ${name} 的版本 ${release.version} 与提交 ${short} 里 package.json 的 version ${version} 不一致：先经 task PR 改 version，再打 tag。`);
    return;
  }
  if (release.kind === 'rc') {
    if (listTagCommits(repo).some(entry => entry.name === `v${release.version}`)) {
      violations.push(`v${release.version} 已有正式 tag：同一版本不能再发预发布 ${name}，先经 task PR 升 package.json 的 version。`);
      return;
    }
    notes.push(`${name}：${short} 在 ${container.ref} 里，version ${version} 一致，推送后触发预发布部署（开关打开时）。`);
    return;
  }
  const previews = previewTagsFor(repo, release.version, commit);
  if (!previews.length) {
    warnings.push(`正式 tag ${name} 所在提交 ${short} 本地没有 v${release.version}-rc.N：正式部署的证据 job 会拒绝它（本地缺 tag 时先 git fetch --tags 再确认）。`);
  } else notes.push(`${name}：${short} 在 ${container.ref} 里，同一提交的预发布 tag ${previews.join('、')}。`);
}

const USAGE = `分支模型门禁：
  node scripts/check-branch-invariants.mjs [--repo <path>] [--require-remote-refs] [--strict-long-lived] [--json]
  node scripts/check-branch-invariants.mjs --push [--repo <path>] < pre-push-stdin
    pre-push 行格式：<local ref> <local sha> <remote ref> <remote sha>

不变量：\n  1. ${INVARIANTS[0]}\n  2. ${INVARIANTS[1]}

分支命名（不用 -，只用 / 分层，段内词间用 _）：
  main | stage
  task/<issue>/<slug>  ${TASK_BRANCH_RE}
  dev/<username>       ${DEV_BRANCH_RE}

发布 tag（--push 模式判定）：
  vX.Y.Z-rc.N 打在 stage 的提交上，vX.Y.Z 打在 main 的提交上  ${RELEASE_TAG_RE}`;

function annotationEscape(text) {
  return text.replaceAll('%', '%25').replaceAll('\r', '%0D').replaceAll('\n', '%0A');
}

function emit(level, message) {
  if (process.env.GITHUB_ACTIONS === 'true') {
    console.log(`::${level}::${annotationEscape(message)}`);
    return;
  }
  console.log(`[${level === 'error' ? '违规' : '警告'}] ${message}`);
}

function report(result, { json }) {
  if (json) {
    console.log(JSON.stringify(result, null, 2));
    return;
  }
  for (const note of result.notes ?? []) console.log(`[证据] ${note}`);
  for (const warning of result.warnings) emit('warning', warning);
  if (!result.ok) {
    // 只有违规涉及两条不变量时才打印原文：发布 tag 的违规与它们无关，打印出来只会误导。
    if (result.violations.some(violation => INVARIANTS.some(text => violation.includes(text)))) {
      console.log('[不变量原文]');
      INVARIANTS.forEach((text, index) => console.log(`  ${index + 1}. ${text}`));
    }
    for (const violation of result.violations) emit('error', violation);
  }
}

function main(argv) {
  const options = { repo: process.cwd(), push: false, requireRemote: false, strictLongLived: false, json: false };
  for (let index = 0; index < argv.length; index++) {
    const arg = argv[index];
    if (arg === '--help' || arg === '-h') {
      console.log(USAGE);
      return;
    }
    if (arg === '--push') options.push = true;
    else if (arg === '--require-remote-refs') options.requireRemote = true;
    else if (arg === '--strict-long-lived') options.strictLongLived = true;
    else if (arg === '--json') options.json = true;
    else if (arg === '--repo') {
      const value = argv[++index];
      if (!value || value.startsWith('--')) throw new Error('--repo 需要目录路径');
      options.repo = resolve(value);
    } else throw new Error(`未知参数：${arg}`);
  }
  const result = options.push
    ? checkPushes({ repo: options.repo, pushes: parsePushLines(readFileSync(0, 'utf8')) })
    : checkInvariants({ repo: options.repo, requireRemote: options.requireRemote, strictLongLived: options.strictLongLived });
  report(result, options);
  if (result.ok) {
    console.log(options.push ? 'pre-push 分支与发布 tag 规则通过。' : '分支不变量通过：stage ≥ main，且没有 main 领先 stage 的提交。');
    return;
  }
  process.exitCode = 1;
}

// 入口判定必须走 realpath：脚本经符号链接路径启动时，直接比较 resolve(process.argv[1]) 会不相等，
// 导致 CLI 静默不执行却返回 0，被误当作不变量通过。
function isDirectRun() {
  if (!process.argv[1]) return false;
  try {
    return pathToFileURL(realpathSync(resolve(process.argv[1]))).href === import.meta.url;
  } catch {
    return false;
  }
}
if (isDirectRun()) {
  try {
    main(process.argv.slice(2));
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}

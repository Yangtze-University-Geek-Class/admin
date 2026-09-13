#!/usr/bin/env node
/** Read-only release planning. Never grants approval, writes tags or deploys. */
import { execFileSync, spawnSync } from 'node:child_process';
import { realpathSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { deploymentTarget } from './deployment-environment.mjs';

const SHA = /^[a-f0-9]{40}$/;
const VERSION = /^(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)$/;
const MAIN_REFS = new Set(['refs/heads/main', 'refs/remotes/origin/main']);

export function parseVersion(value) {
  if (typeof value !== 'string' || value.length > 96 || /\s/.test(value) || !VERSION.test(value)) {
    throw new Error('版本必须为无前导零的 X.Y.Z；不接受 v、@、rc 或 build 后缀。');
  }
  return value.split('.').map(part => BigInt(part));
}
export function compareVersions(a, b) {
  const left = parseVersion(a); const right = parseVersion(b);
  for (let index = 0; index < 3; index++) {
    if (left[index] !== right[index]) return left[index] < right[index] ? -1 : 1;
  }
  return 0;
}
export function parseReleaseTag(value) {
  if (typeof value !== 'string') throw new Error('Missing tag');
  const prefix = value.startsWith('release-') ? 'release' : value.startsWith('prev-') ? 'prev' : null;
  if (!prefix) throw new Error('只允许 release-X.Y.Z 或 prev-X.Y.Z。');
  const version = value.slice(prefix.length + 1);
  parseVersion(version);
  return { tag: value, version, environment: prefix === 'release' ? 'production' : 'preview' };
}
export function previewVersion(baseTag, commit) {
  const base = parseReleaseTag(baseTag);
  if (base.environment !== 'preview') throw new Error('预发布增量只能使用 prev- 基准。');
  if (typeof commit !== 'string' || !SHA.test(commit) || /\s/.test(commit)) throw new Error('必须提供准确的 40 位小写 commit SHA。');
  return `${base.version}@${commit.slice(0, 12)}`;
}

function git(cwd, args) {
  try {
    return execFileSync('git', ['-c', 'core.hooksPath=/dev/null', ...args], {
      cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], timeout: 5000, maxBuffer: 1024 * 1024,
    }).trim();
  } catch { throw new Error('本地 Git 证据缺失或命令失败；不会自动 fetch、改 refs 或猜测版本。'); }
}
function commitOf(cwd, ref) {
  const value = git(cwd, ['rev-parse', '--verify', '--end-of-options', `${ref}^{commit}`]);
  if (!SHA.test(value)) throw new Error('Unsupported or unresolved commit object');
  return value;
}
function ancestor(cwd, earlier, later) {
  const result = spawnSync('git', ['merge-base', '--is-ancestor', earlier, later], {
    cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], timeout: 5000,
  });
  if (result.error || ![0, 1].includes(result.status)) throw new Error('Cannot verify Git ancestry');
  return result.status === 0;
}
function versionTags(cwd) {
  return git(cwd, ['for-each-ref', '--format=%(refname:short)', 'refs/tags']).split('\n').filter(Boolean).flatMap(tag => {
    try { return [parseReleaseTag(tag)]; } catch { return []; }
  });
}

export function inspectRelease({ cwd = process.cwd(), mode, tag, baseTag, commit, targetOrigin, mainRef = 'refs/remotes/origin/main' }) {
  if (!MAIN_REFS.has(mainRef)) throw new Error('发布主线必须是 main；next/功能分支不是发布主线。');
  if (!['tag', 'preview'].includes(mode)) throw new Error('Mode must be tag or preview');
  const mainCommit = commitOf(cwd, mainRef);
  let result;
  if (mode === 'tag') {
    if (baseTag !== undefined || commit !== undefined) throw new Error('Tag 模式只从实际 tag 解析提交，不接受覆盖 SHA 或基准。');
    const parsed = parseReleaseTag(tag);
    const selected = commitOf(cwd, `refs/tags/${parsed.tag}`);
    if (!ancestor(cwd, selected, mainCommit)) throw new Error('Tag 提交不属于 main 历史。');
    const newer = versionTags(cwd).filter(item => item.environment === parsed.environment && compareVersions(item.version, parsed.version) > 0);
    if (newer.length) throw new Error('拒绝将旧版本作为新发版；回滚必须走独立人工流程。');
    result = { mode, environment: parsed.environment, tag: parsed.tag, baseVersion: parsed.version, displayVersion: parsed.version, commit: selected, requiresHumanAcceptanceForExactArtifact: true };
  } else {
    if (tag !== undefined) throw new Error('预发布增量不创建或携带发版 tag。');
    const displayVersion = previewVersion(baseTag, commit);
    const selected = commitOf(cwd, commit);
    if (selected !== commit || !ancestor(cwd, selected, mainCommit)) throw new Error('增量 commit 不属于 main 历史。');
    const baseline = commitOf(cwd, `refs/tags/${baseTag}`);
    if (!ancestor(cwd, baseline, selected)) throw new Error('prev 基准不在候选提交历史上。');
    const base = parseReleaseTag(baseTag);
    const newer = versionTags(cwd).filter(item => item.environment === 'preview' && compareVersions(item.version, base.version) > 0 && ancestor(cwd, commitOf(cwd, `refs/tags/${item.tag}`), selected));
    if (newer.length) throw new Error('不能跳过可达的新预发布基准；请核对可信人工发布记录。');
    result = { mode, environment: 'preview', tag: null, baseTag, baseVersion: base.version, displayVersion, commit: selected, baselineCommit: baseline, requiresTrustedBaselineAcceptance: true, bumpsVersion: false };
  }
  const target = deploymentTarget(result.environment, targetOrigin);
  return {
    ...result, target, publicOrigin: target.origin, mainRef, mainCommit, shortCommit: result.commit.slice(0, 12),
    evidence: 'local-git-only', deploymentAuthorized: false,
    warning: '命名和本地 Git 来源通过不代表人工试用、审批、产物或部署通过。CI 必须另外核对可信来源和批准记录。',
  };
}

function main(argv) {
  const [mode, ...rest] = argv;
  if (!mode || mode === '--help') {
    console.log('只读规划，不发版：\n  node scripts/release-policy.mjs tag --tag release-X.Y.Z [--main-ref refs/remotes/origin/main] [--target-origin https://yangtzeu.work]\n  node scripts/release-policy.mjs preview --base-tag prev-X.Y.Z --commit <40位SHA> [--main-ref refs/remotes/origin/main]');
    return;
  }
  const allowed = new Map([['--tag', 'tag'], ['--base-tag', 'baseTag'], ['--commit', 'commit'], ['--main-ref', 'mainRef'], ['--target-origin', 'targetOrigin']]);
  const options = { mode };
  for (let index = 0; index < rest.length; index += 2) {
    const key = allowed.get(rest[index]); const value = rest[index + 1];
    if (!key || !value || value.startsWith('--') || key in options) throw new Error('Unknown, duplicate or missing option；不接受 --approved 等批准开关。');
    options[key] = value;
  }
  console.log(JSON.stringify(inspectRelease(options), null, 2));
}
// 入口判定必须走 realpath：脚本经符号链接路径启动时，Node 解析出的 import.meta.url 是真实路径，
// 直接比较 resolve(process.argv[1]) 会不相等，导致 CLI 静默不执行却返回 0。
function isDirectRun() {
  if (!process.argv[1]) return false;
  try { return pathToFileURL(realpathSync(resolve(process.argv[1]))).href === import.meta.url; } catch { return false; }
}
if (isDirectRun()) {
  try { main(process.argv.slice(2)); } catch (error) { console.error(error.message); process.exitCode = 1; }
}

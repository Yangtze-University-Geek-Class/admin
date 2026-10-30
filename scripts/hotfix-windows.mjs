// P0 hotfix 窗口登记：main 在窗口内可以领先 stage，领先的每个提交都要归属于一个已登记、未过期的窗口。
// 登记写在 main 上的 deploy/hotfix/windows.json，规则见 docs/conventions/BRANCHING.md「线上紧急修复（Hotfix）规约」。
// 分支门禁（scripts/check-branch-invariants.mjs）和 hotfix 计划（scripts/hotfix-policy.mjs）共用这里的判定。
import { spawnSync } from 'node:child_process';
import { TIME_RE, text, validateLegacyOwnerApproval, validateOwnerApproval } from './owner-approval.mjs';

export const WINDOWS_FILE = 'deploy/hotfix/windows.json';
/** 窗口从所有者批准起最长开多久；超期还开着，分支门禁就失败，逼着收尾。 */
export const MAX_WINDOW_DAYS = 7;
const DAY = 24 * 60 * 60 * 1000;
const SHA_RE = /^[a-f0-9]{40}$/;
const TAG_RE = /^v\d+\.\d+\.\d+$/;
const STATUSES = Object.freeze(['open', 'closed']);
const parseTime = value => Date.parse(String(value).length === 10 ? `${value}T00:00:00+08:00` : value);

/**
 * 校验登记，返回问题列表（空 = 格式正确）。legacy 只给读提交里的登记用（readRegistryAt）：兼容只为下次正式发布前的过渡，
 * 接受迁移前的署名与 quote 字段；正式发布把 main 换成新格式后删掉 legacy 分支（见 owner-approval.mjs 的 validateLegacyOwnerApproval）。
 */
export function validateWindows(registry, { legacy = false } = {}) {
  if (!registry || registry.schemaVersion !== 1 || !Array.isArray(registry.windows)) return ['登记必须是 { schemaVersion: 1, windows: [] }'];
  const problems = [];
  const issues = new Set();
  for (const item of registry.windows) {
    const at = `#${item?.issue ?? '?'}`;
    if (!Number.isInteger(item?.issue) || item.issue < 1) problems.push(`${at}：issue 必须是正整数`);
    if (issues.has(item?.issue)) problems.push(`${at}：同一个 issue 只能登记一个窗口`);
    issues.add(item?.issue);
    if (!TAG_RE.test(item?.tag ?? '')) problems.push(`${at}：tag 必须是既有正式版本（形如 v0.1.1）`);
    if (!STATUSES.includes(item?.status)) problems.push(`${at}：status 只能是 ${STATUSES.join('、')}`);
    const approved = legacy
      ? validateLegacyOwnerApproval({ by: item?.approvedBy, at: item?.approvedAt, approval: item?.approval, quote: item?.quote })
      : validateOwnerApproval({ by: item?.approvedBy, at: item?.approvedAt, approval: item?.approval });
    if (!approved) problems.push(`${at}：要有所有者的 approvedBy、approvedAt 和批准摘要 approval`);
    if (item?.commits !== undefined && !(Array.isArray(item.commits) && item.commits.every(sha => SHA_RE.test(sha)))) problems.push(`${at}：commits 必须是 40 位提交 SHA 的数组`);
    if (item?.status === 'open') {
      const approved = parseTime(item?.approvedAt ?? '');
      const expires = parseTime(item?.expiresAt ?? '');
      if (!TIME_RE.test(item?.expiresAt ?? '') || Number.isNaN(expires)) problems.push(`${at}：open 的窗口要有 expiresAt`);
      else if (!Number.isNaN(approved) && expires - approved > MAX_WINDOW_DAYS * DAY) problems.push(`${at}：窗口最长 ${MAX_WINDOW_DAYS} 天，expiresAt 超过了批准时间 + ${MAX_WINDOW_DAYS} 天`);
    }
    if (item?.status === 'closed' && !(TIME_RE.test(item?.closedAt ?? '') && text(item?.evidence))) problems.push(`${at}：closed 要有 closedAt 和 evidence（合回 stage 的提交与线上核对）`);
  }
  return problems;
}

/** 已登记、仍开着、没过期的窗口。 */
export function activeWindows(registry, now = new Date()) {
  return (registry?.windows ?? []).filter(item => item.status === 'open' && parseTime(item.expiresAt) > now.getTime());
}

/** 仍标 open 却已经过期的窗口：要么收尾，要么由所有者重新登记。 */
export function expiredWindows(registry, now = new Date()) {
  return (registry?.windows ?? []).filter(item => item.status === 'open' && !(parseTime(item.expiresAt) > now.getTime()));
}

/** 说明里是否引用了这个 issue：#N 或 task/N/，N 后面不能再接数字（#5 不匹配 #50）。 */
export function referencesIssue(message, issue) {
  return new RegExp(`(?:#|task/)${issue}(?![0-9])`).test(message);
}

/**
 * 归属到窗口的两条路：窗口的 commits 显式列出了这个 SHA（批准之前的提交只能这样放行）；
 * 或者说明引用了窗口 issue，且提交者时间落在 approvedAt 与 expiresAt 之间。committedAt 是提交者时间（epoch 毫秒），拿不到时只认 commits。
 */
export function windowOf(sha, message, windows, committedAt) {
  return windows.find(item => (item.commits ?? []).includes(sha)
    || (Number.isFinite(committedAt) && committedAt >= parseTime(item.approvedAt) && committedAt <= parseTime(item.expiresAt) && referencesIssue(message, item.issue))) ?? null;
}

/** 不归属任何窗口时告诉操作者原因和下一步（只用于拒绝信息，不参与判定）。 */
export function explainUnattributed(sha, message, committedAt, registry, now = new Date()) {
  const next = `把 ${sha} 写进窗口 commits，或者不要把它推进 main`;
  const item = (registry?.windows ?? []).find(window => referencesIssue(message, window.issue));
  if (!item) {
    const open = activeWindows(registry ?? { windows: [] }, now).map(window => `#${window.issue}`).join('、') || '无';
    return `说明里没有引用开着的 hotfix 窗口 issue（#N 或 task/N/），当前开着的窗口：${open}。${next}。`;
  }
  if (item.status !== 'open') return `说明引用了 #${item.issue}，但该窗口已经 ${item.status}：${next}。`;
  if (!(parseTime(item.expiresAt) > now.getTime())) return `说明引用了 #${item.issue}，但该窗口已过 expiresAt（${item.expiresAt}）：先收尾或由所有者重新批准；${next}。`;
  if (!(committedAt >= parseTime(item.approvedAt))) return `提交时间早于 #${item.issue} 的批准时间（${item.approvedAt}）：${next}。`;
  return `提交时间晚于 #${item.issue} 的 expiresAt（${item.expiresAt}）：${next}。`;
}

/** 读某个提交里的登记；文件不存在返回 null（没有任何窗口），读到但不是合法 JSON 抛错。 */
export function readRegistryAt(repo, rev) {
  const result = spawnSync('git', ['-c', 'core.hooksPath=/dev/null', 'show', `${rev}:${WINDOWS_FILE}`], { cwd: repo, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], timeout: 20000, maxBuffer: 1024 * 1024 });
  if (result.status !== 0) return null;
  try { return JSON.parse(result.stdout); } catch { throw new Error(`${WINDOWS_FILE} 不是合法 JSON`); }
}

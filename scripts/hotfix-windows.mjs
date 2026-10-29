// P0 hotfix 窗口登记：main 在窗口内可以领先 stage，领先的每个提交都要归属于一个已登记、未过期的窗口。
// 登记写在 main 上的 deploy/hotfix/windows.json，规则见 docs/conventions/BRANCHING.md「线上紧急修复（Hotfix）规约」。
// 分支门禁（scripts/check-branch-invariants.mjs）和 hotfix 计划（scripts/hotfix-policy.mjs）共用这里的判定。
import { spawnSync } from 'node:child_process';

export const WINDOWS_FILE = 'deploy/hotfix/windows.json';
/** 窗口从所有者批准起最长开多久；超期还开着，分支门禁就失败，逼着收尾。 */
export const MAX_WINDOW_DAYS = 7;
const DAY = 24 * 60 * 60 * 1000;
const SHA_RE = /^[a-f0-9]{40}$/;
const TAG_RE = /^v\d+\.\d+\.\d+$/;
const TIME_RE = /^\d{4}-\d{2}-\d{2}(?:T\d{2}:\d{2}:\d{2}(?:\+08:00)?)?$/;
const STATUSES = Object.freeze(['open', 'closed']);
const text = (value, min = 8) => typeof value === 'string' && value.trim().length >= min;
const parseTime = value => Date.parse(String(value).length === 10 ? `${value}T00:00:00+08:00` : value);

/** 校验登记，返回问题列表（空 = 格式正确）。 */
export function validateWindows(registry) {
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
    if (!(item?.approvedBy === 'Crosery' && TIME_RE.test(item?.approvedAt ?? '') && text(item?.quote))) problems.push(`${at}：要有所有者的 approvedBy、approvedAt 和批准原话 quote`);
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

/** 提交说明里引用了窗口 issue（#N 或 task/N/），或者窗口显式列出了这个 SHA。 */
export function windowOf(sha, message, windows) {
  return windows.find(item => (item.commits ?? []).includes(sha) || new RegExp(`(?:#|task/)${item.issue}(?![0-9])`).test(message)) ?? null;
}

/** 读某个提交里的登记；文件不存在返回 null（没有任何窗口），读到但不是合法 JSON 抛错。 */
export function readRegistryAt(repo, rev) {
  const result = spawnSync('git', ['-c', 'core.hooksPath=/dev/null', 'show', `${rev}:${WINDOWS_FILE}`], { cwd: repo, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], timeout: 20000, maxBuffer: 1024 * 1024 });
  if (result.status !== 0) return null;
  try { return JSON.parse(result.stdout); } catch { throw new Error(`${WINDOWS_FILE} 不是合法 JSON`); }
}

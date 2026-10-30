#!/usr/bin/env node
/**
 * 部分晋升窗口：只把 stage 上已有的个别提交（picks）经 git cherry-pick -x 挑进 main，其余留在 stage。
 * 与 hotfix 窗口（scripts/hotfix-windows.mjs）并列；登记写在 main 上的 deploy/promotion/windows.json。
 * 分支门禁（scripts/check-branch-invariants.mjs）与只读检查共用这里的判定。
 * 登记提交本身也要能归属：main 独有、非合并、只改了 deploy/promotion/windows.json 一个文件、只新增窗口或把窗口标 closed、
 * 说明引用了窗口 issue（#N 或 task/N/），且提交者时间在 approvedAt 与 expiresAt 之间（registrationOf）。
 * 窗口登记后内容不能改：picks、excludes、时间与批准摘要要改就关掉，由所有者批准后另登一个。窗口只在它的登记提交是 main 独有时可用。
 *
 *   node scripts/promotion-windows.mjs check [--main <rev>] [--stage <rev>]
 *
 * check 只读 Git 证据：不 fetch、不改 refs、不建提交、不连远端。--main 默认 origin/main（没有则 main），
 * --stage 默认 origin/stage（没有则 stage）。退出码 0 = main 领先 stage 的提交全部归属于开着的窗口，且没有 excludes 进了 main。
 */
import { spawnSync } from 'node:child_process';
import { realpathSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { TIME_RE, text, validateOwnerApproval } from './owner-approval.mjs';
import { WINDOWS_FILE, activeWindows, expiredWindows, explainUnattributed, readRegistryAt, referencesIssue, validateWindows, windowOf } from './hotfix-windows.mjs';

export const PROMOTION_FILE = 'deploy/promotion/windows.json';
/** 晋升窗口从所有者批准起最长开多久；超期还开着，分支门禁就失败。 */
export const MAX_PROMOTION_DAYS = 3;
const DAY = 24 * 60 * 60 * 1000;
const AHEAD_LIMIT = 500;
const SHA_RE = /^[a-f0-9]{40}$/;
const STATUSES = Object.freeze(['open', 'closed']);
/** git cherry-pick -x 追加的痕迹行：(cherry picked from commit <sha>)，必须独占一行。 */
const TRAILER_RE = /^\(cherry picked from commit ([a-f0-9]{40})\)\s*$/gm;
/** 收尾写全了：closedAt 是登记用的时间写法，evidence 至少 8 个字。登记校验与「关过才能删」用同一个口径。 */
const closedProperly = item => item?.status === 'closed' && TIME_RE.test(item?.closedAt ?? '') && text(item?.evidence);
const parseTime = value => Date.parse(String(value).length === 10 ? `${value}T00:00:00+08:00` : value);
const short = sha => String(sha).slice(0, 12);

function gitRun(repo, args, input = '') {
  const result = spawnSync('git', ['-c', 'core.hooksPath=/dev/null', ...args], { cwd: repo, encoding: 'utf8', input, stdio: ['pipe', 'pipe', 'pipe'], timeout: 20000, maxBuffer: 16 * 1024 * 1024 });
  if (result.error) throw new Error(`无法执行 git ${args.join(' ')}：${result.error.message}`);
  return result;
}

/** 祖先关系：true / false；对象找不到等判不出来时返回 null，调用方一律按不通过处理。 */
function isAncestorOf(repo, ancestor, descendant) {
  const result = gitRun(repo, ['merge-base', '--is-ancestor', ancestor, descendant]);
  if (result.status === 0) return true;
  return result.status === 1 ? false : null;
}

export function resolveRev(repo, rev) {
  const result = gitRun(repo, ['rev-parse', '--verify', '--quiet', `${rev}^{commit}`]);
  const value = (result.stdout ?? '').trim();
  return result.status === 0 && SHA_RE.test(value) ? value : null;
}

/** 校验晋升窗口登记，返回问题列表（空 = 格式正确）。 */
export function validatePromotions(registry) {
  if (!registry || registry.schemaVersion !== 1 || !Array.isArray(registry.windows)) return ['登记必须是 { schemaVersion: 1, windows: [] }'];
  const problems = [];
  const issues = new Set();
  for (const item of registry.windows) {
    const at = `#${item?.issue ?? '?'}`;
    const picks = Array.isArray(item?.picks) ? item.picks : [];
    const excludes = item?.excludes ?? [];
    if (!Number.isInteger(item?.issue) || item.issue < 1) problems.push(`${at}：issue 必须是正整数`);
    if (issues.has(item?.issue)) problems.push(`${at}：同一个 issue 只能登记一个晋升窗口`);
    issues.add(item?.issue);
    if (!STATUSES.includes(item?.status)) problems.push(`${at}：status 只能是 ${STATUSES.join('、')}`);
    if (!validateOwnerApproval({ by: item?.approvedBy, at: item?.approvedAt, approval: item?.approval })) problems.push(`${at}：要有所有者的 approvedBy（字面值「所有者」）、approvedAt 和批准摘要 approval（至少 8 个字）`);
    if (!text(item?.reason)) problems.push(`${at}：reason 要写清为什么不能用功能开关或前缀快进（至少 8 个字）`);
    if (!SHA_RE.test(item?.stageBase ?? '')) problems.push(`${at}：stageBase 必须是登记时 stage 的 40 位提交 SHA`);
    if (!(picks.length > 0 && picks.every(sha => SHA_RE.test(sha)) && new Set(picks).size === picks.length)) problems.push(`${at}：picks 必须是非空、不重复的 40 位 stage 提交 SHA 数组`);
    if (!(Array.isArray(excludes) && excludes.every(entry => SHA_RE.test(entry?.sha ?? '') && Number.isInteger(entry?.issue) && entry.issue > 0))) problems.push(`${at}：excludes 必须是 { sha, issue } 的数组`);
    else if (excludes.some(entry => picks.includes(entry.sha))) problems.push(`${at}：excludes 与 picks 不能有同一个提交`);
    if (item && 'conflictResolved' in item) problems.push(`${at}：不再支持 conflictResolved：挑的时候有冲突，就在 stage 上把冲突处理成新提交，经预发布后登记挑它`);
    if (item?.status === 'open') {
      const approved = parseTime(item?.approvedAt ?? '');
      const expires = parseTime(item?.expiresAt ?? '');
      if (!TIME_RE.test(item?.expiresAt ?? '') || Number.isNaN(expires)) problems.push(`${at}：open 的窗口要有 expiresAt`);
      else if (!(expires > approved)) problems.push(`${at}：expiresAt 必须晚于 approvedAt`);
      else if (expires - approved > MAX_PROMOTION_DAYS * DAY) problems.push(`${at}：晋升窗口最长 ${MAX_PROMOTION_DAYS} 天，expiresAt 超过了 approvedAt + ${MAX_PROMOTION_DAYS} 天`);
    }
    if (item?.status === 'closed' && !closedProperly(item)) problems.push(`${at}：closed 要有 closedAt 和 evidence（合回 stage 的提交与线上核对）`);
  }
  return problems;
}

/** 已登记、仍开着、没过期的晋升窗口。 */
export function activePromotions(registry, now = new Date()) {
  return (registry?.windows ?? []).filter(item => item.status === 'open' && parseTime(item.expiresAt) > now.getTime());
}

/** 仍标 open 却已经过期的晋升窗口：要么收尾，要么由所有者重新登记。 */
export function expiredPromotions(registry, now = new Date()) {
  return (registry?.windows ?? []).filter(item => item.status === 'open' && !(parseTime(item.expiresAt) > now.getTime()));
}

/** 读某个提交里的晋升登记；文件不存在返回 null（没有任何窗口），读到但不是合法 JSON 抛错。 */
export function readPromotionsAt(repo, rev) {
  const result = gitRun(repo, ['show', `${rev}:${PROMOTION_FILE}`]);
  if (result.status !== 0) return null;
  try { return JSON.parse(result.stdout); } catch { throw new Error(`${PROMOTION_FILE} 不是合法 JSON`); }
}

/** main 上的两份登记：读不出来或格式不对都记进 problems，并当作没有窗口（领先的提交全部算未归属）。 */
export function readWindowsAt(repo, rev, problems) {
  let hotfix = null;
  let promotion = null;
  try { hotfix = readRegistryAt(repo, rev); } catch (error) { problems.push(error.message); }
  if (hotfix) {
    const invalid = validateWindows(hotfix, { legacy: true });
    if (invalid.length) { problems.push(`${WINDOWS_FILE} 格式有误：${invalid.join('；')}`); hotfix = null; }
  }
  try { promotion = readPromotionsAt(repo, rev); } catch (error) { problems.push(error.message); }
  if (promotion) {
    const invalid = validatePromotions(promotion);
    if (invalid.length) { problems.push(`${PROMOTION_FILE} 格式有误：${invalid.join('；')}`); promotion = null; }
  }
  return { hotfix, promotion };
}

/** 提交说明里的 cherry-pick 痕迹：被挑的源提交 SHA（按出现顺序，去重）。 */
export function trailerShas(message) {
  return [...new Set([...String(message).matchAll(TRAILER_RE)].map(match => match[1]))];
}

/** 提交改动的文件路径（不含重命名），拿不到返回 null。 */
function changedFiles(repo, sha) {
  const result = gitRun(repo, ['diff-tree', '--root', '--no-commit-id', '--name-only', '-r', '--no-renames', sha]);
  return result.status === 0 ? (result.stdout ?? '').split('\n').filter(Boolean) : null;
}

/**
 * git patch-id --verbatim（git 2.39 起；它本身就是 stable 算法，git 2.54 不许再同时写 --stable）：只看补丁内容，
 * 行号不计、空白照算，cherry-pick 到别的基线后不变；不加 --verbatim 时删掉字符串里的一个空格也算同一个补丁。
 * 空提交、找不到的提交或 git 不支持这个参数时返回 null（按不归属处理）。
 */
function patchIdOf(repo, sha) {
  const diff = gitRun(repo, ['show', '--format=', '--no-color', '--no-ext-diff', '--no-textconv', sha]);
  if (diff.status !== 0 || !diff.stdout.trim()) return null;
  const id = gitRun(repo, ['patch-id', '--verbatim'], diff.stdout);
  const [value] = (id.stdout ?? '').trim().split(/\s+/);
  return id.status === 0 && SHA_RE.test(value ?? '') ? value : null;
}

/** 提交说明里每个 cherry-pick 来源，连同它自己的 patch-id（来源在本仓库里找不到时为 null）。 */
function sourcesOf(repo, message) {
  return trailerShas(message).map(sha => ({ sha, patchId: patchIdOf(repo, sha) }));
}

/**
 * main 独有的一个提交是否被晋升窗口覆盖：说明里有 `(cherry picked from commit P)`，P 在窗口的 picks 里，
 * 且本提交的 patch-id 与 P 相同。合并提交从不被覆盖；提交引用了窗口的 excludes 也不覆盖。windows 必须是可用的窗口。
 * cherryPickedFrom 为 [{ sha, patchId }]，patchId 为本提交的 patch-id。
 */
export function promotionOf(sha, { cherryPickedFrom = [], patchId = null, merge = false } = {}, windows = []) {
  if (merge) return null;
  for (const item of windows) {
    const excluded = (item.excludes ?? []).map(entry => entry.sha);
    if (excluded.includes(sha) || cherryPickedFrom.some(source => excluded.includes(source.sha))) continue;
    const covered = patchId !== null && cherryPickedFrom.some(source => (item.picks ?? []).includes(source.sha) && source.patchId === patchId);
    if (covered) return item;
  }
  return null;
}

/** 窗口里登记后不能改的字段：状态与收尾字段（status、closedAt、evidence）之外的全部。 */
const frozen = item => JSON.stringify(Object.fromEntries(Object.entries(item ?? {}).filter(([key]) => !['status', 'closedAt', 'evidence'].includes(key)).sort(([a], [b]) => a.localeCompare(b))));

/**
 * 一次登记文件改动做了什么：新增的窗口、由 open 改成 closed 的窗口；改了已有窗口的其它字段、删窗口、把 closed 改回 open 都记进 altered。
 * before / after 是改动前后的登记（文件不存在时传 null）。
 */
export function registryChange(before, after) {
  const prior = new Map((before?.windows ?? []).map(item => [item?.issue, item]));
  const next = new Map((after?.windows ?? []).map(item => [item?.issue, item]));
  const added = [];
  const closed = [];
  const altered = [];
  for (const [issue, item] of next) {
    const old = prior.get(issue);
    if (!old) { added.push(item); continue; }
    if (frozen(old) !== frozen(item)) { altered.push(item); continue; }
    if (old.status === item.status) { if (JSON.stringify(old) !== JSON.stringify(item)) altered.push(item); continue; }
    if (old.status === 'open' && item.status === 'closed') closed.push(item);
    else altered.push(item);
  }
  for (const [issue, item] of prior) if (!next.has(issue)) altered.push(item);
  return { added, closed, altered };
}

/** 一个只改了 PROMOTION_FILE 的非合并提交对登记做了什么；不是这种提交、或读不出前后两版时返回 null。 */
function registryCommit(repo, entry) {
  if (entry.parents.length !== 1) return null;
  const files = changedFiles(repo, entry.sha);
  if (!files || files.length !== 1 || files[0] !== PROMOTION_FILE) return null;
  try {
    const after = readPromotionsAt(repo, entry.sha);
    if (!after || validatePromotions(after).length) return null;
    return registryChange(readPromotionsAt(repo, entry.parents[0]), after);
  } catch {
    return null;
  }
}

/**
 * 窗口登记提交：main 独有、非合并，只改了 PROMOTION_FILE 这一个文件，只新增窗口或把窗口标 closed（不改已有窗口的内容），
 * 说明引用了窗口 issue，且提交者时间在该窗口 approvedAt 与 expiresAt 之间。登记本身没有 cherry-pick 痕迹，所以单独放行。
 * 返回新增的那个窗口（收尾提交返回被关的窗口），否则 null。
 */
export function registrationOf(repo, entry) {
  const change = registryCommit(repo, entry);
  if (!change || change.altered.length || change.added.length + change.closed.length !== 1) return null;
  const item = change.added[0] ?? change.closed[0];
  const inTime = entry.committedAt >= parseTime(item.approvedAt) && entry.committedAt <= parseTime(item.expiresAt);
  return referencesIssue(entry.message, item.issue) && (change.closed.length || inTime) ? { item, kind: change.added.length ? 'registration' : 'closing' } : null;
}

/**
 * 可用的晋升窗口：开着、没过期，登记它的那次提交在 main 独有的提交里（stage 上带进来的登记不算），
 * 并且 main 上这一版和登记提交里的一字不差（收尾字段除外）。登记之后被改过的窗口整体不可用。
 */
export function usablePromotions(repo, promotions, ahead) {
  const registered = registeredOn(repo, ahead);
  return promotions.filter(item => registered.has(item.issue) && frozen(registered.get(item.issue)) === frozen(item));
}

/** main 独有提交里的登记：issue → 登记提交里的那一版窗口。 */
function registeredOn(repo, ahead) {
  return new Map(ahead.map(entry => registrationOf(repo, entry)).filter(hit => hit?.kind === 'registration').map(hit => [hit.item.issue, hit.item]));
}

/**
 * 开着的晋升窗口只能标 closed，不能删、不能改。before 是某一版里开着的窗口，after 是另一版登记：
 * 返回在 after 里被删掉或改过（收尾字段之外）的窗口。absentOk(item) 为真时，after 里没有它不算删（例如登记还没合回 stage）。
 */
export function droppedPromotions(before, after, absentOk = () => false) {
  const next = new Map(windowsIn(after).map(item => [item?.issue, item]));
  return before.filter(item => {
    const later = next.get(item.issue);
    return later ? frozen(later) !== frozen(item) : !absentOk(item);
  });
}

const windowsIn = registry => (Array.isArray(registry?.windows) ? registry.windows : []);

/**
 * 登记文件的历史（--full-history：合并时丢掉的那一边也要看到）里出现过的晋升窗口，到 tip 这一版只能是原样、只改过收尾字段：
 * - 同一个 issue 在历史里有两版不同的登记（收尾字段之外），不管哪一版在前，都算改过；
 * - 标过 open 的窗口，tip 里没有了，只有历史上有它按登记校验写好 closedAt 与 evidence 的 closed 版本才算正常删除。
 * 返回被删或被改的窗口，同一个 issue 的每一版都返回，excludes 按每一版核对。tip 的登记读不出或格式不对，等于窗口全被删了。
 */
export function lostPromotions(repo, tipSha) {
  const listed = gitRun(repo, ['rev-list', '--full-history', tipSha, '--', PROMOTION_FILE]);
  if (listed.status !== 0) throw new Error(`读不出 ${short(tipSha)} 上 ${PROMOTION_FILE} 的历史：${(listed.stderr ?? '').trim()}`);
  const versions = new Map();
  const opened = new Set();
  const closed = new Set();
  for (const sha of listed.stdout.split('\n').filter(Boolean)) {
    let registry = null;
    try { registry = readPromotionsAt(repo, sha); } catch { continue; }
    for (const item of windowsIn(registry)) {
      if (!Number.isInteger(item?.issue)) continue;
      const seen = versions.get(item.issue) ?? new Map();
      if (!seen.has(frozen(item))) seen.set(frozen(item), item);
      versions.set(item.issue, seen);
      if (item.status === 'open') opened.add(item.issue);
      if (closedProperly(item)) closed.add(item.issue);
    }
  }
  let tip = null;
  try { tip = readPromotionsAt(repo, tipSha); } catch { tip = null; }
  const current = new Map(windowsIn(tip).map(item => [item?.issue, item]));
  const lost = [];
  for (const [issue, seen] of versions) {
    if (!opened.has(issue)) continue;
    const later = current.get(issue);
    const intact = seen.size === 1 && (later ? seen.has(frozen(later)) : closed.has(issue));
    if (!intact) lost.push(...seen.values());
  }
  return lost;
}

/** 开着却不能放行的晋升窗口，以及为什么（只用于说明，不参与判定）。 */
export function blockedPromotions(repo, open, usable, ahead) {
  const registered = registeredOn(repo, ahead);
  return open.filter(item => !usable.includes(item)).map(item => ({
    item,
    reason: registered.has(item.issue)
      ? `晋升窗口 #${item.issue} 登记之后被改过：登记后不能改，整个窗口不再放行；要改由所有者批准后另登一个`
      : `晋升窗口 #${item.issue} 的登记提交不在 main 独有的提交里（登记先进了 stage，或者不是合规的登记提交）：晋升窗口只认随晋升 MR 进 main 的登记`,
  }));
}

/** 一个 main 独有提交被哪个晋升窗口覆盖；合并提交与没有 cherry-pick 痕迹的提交一律 null。 */
export function coverageOf(repo, entry, windows) {
  if (entry.parents.length > 1 || !windows.length) return null;
  const cherryPickedFrom = sourcesOf(repo, entry.message);
  if (!cherryPickedFrom.length) return null;
  return promotionOf(entry.sha, { cherryPickedFrom, patchId: patchIdOf(repo, entry.sha) }, windows);
}

/** 归属判定：改了晋升登记的提交只看登记与收尾；其余先看 hotfix 窗口（commits 列出，或说明引用 issue 且提交时间在批准与过期之间），再看晋升窗口的挑选。 */
export function attributeCommit(repo, entry, { hotfix = [], promotion = [] } = {}) {
  // 改了晋升登记的提交只按登记或收尾放行：hotfix 窗口不能顺带放行对登记的改动。
  if (entry.parents.length === 1 && (changedFiles(repo, entry.sha) ?? []).includes(PROMOTION_FILE)) {
    const registering = registrationOf(repo, entry);
    // 收尾只会收紧，窗口关了也照样放行；登记要窗口可用（登记在 main 独有提交里、登记后没改过）。
    const allowed = registering && (registering.kind === 'closing' || promotion.some(item => item.issue === registering.item.issue));
    return allowed ? { kind: registering.kind, issue: registering.item.issue } : null;
  }
  const owner = windowOf(entry.sha, entry.message, hotfix, entry.committedAt);
  if (owner) return { kind: 'hotfix', issue: owner.issue };
  const covering = coverageOf(repo, entry, promotion);
  return covering ? { kind: 'promotion', issue: covering.issue } : null;
}

/** 改了晋升登记却没归属：说清是改了已登记的内容、没引用 issue、提交时间不对，还是窗口已经不能放行。没改登记返回 null。 */
function explainRegistration(repo, entry, blocked = []) {
  if (entry.parents.length !== 1 || !(changedFiles(repo, entry.sha) ?? []).includes(PROMOTION_FILE)) return null;
  const change = registryCommit(repo, entry);
  if (!change) return `这个提交改了 ${PROMOTION_FILE}，但不是合规的登记或收尾提交：只改这一个文件、改完的登记要合规；hotfix 窗口也不放行对晋升登记的改动。`;
  if (change.altered.length) return `这个提交改了已登记的晋升窗口 #${change.altered[0].issue} 的内容（picks、excludes、时间或批准摘要），或删了窗口：登记后不能改，要改就把它标 closed，由所有者批准后另登一个。`;
  if (change.added.length + change.closed.length !== 1) return '一个登记提交只能新增或关闭一个晋升窗口：拆成每个窗口一个提交。';
  const item = change.added[0] ?? change.closed[0];
  if (!referencesIssue(entry.message, item.issue)) return `登记提交的说明要引用晋升窗口的 issue（#${item.issue} 或 task/${item.issue}/）。`;
  if (!(entry.committedAt >= parseTime(item.approvedAt) && entry.committedAt <= parseTime(item.expiresAt))) {
    return `登记提交引用了晋升窗口 #${item.issue}，但提交者时间不在它的批准与过期之间（${item.approvedAt} 至 ${item.expiresAt}）：窗口只认这段时间内的登记提交。`;
  }
  const hit = blocked.find(entry => entry.item.issue === item.issue);
  return hit ? `${hit.reason}。` : `晋升窗口 #${item.issue} 在 main 上已经不开着（过期或已关闭）：这次登记不再放行。`;
}

/** 带 cherry-pick 痕迹却没归属时，说清它和晋升窗口哪一点不符，以及下一步。没有痕迹返回 null。 */
function explainPromotion(repo, entry, promotion, blocked = []) {
  const sources = sourcesOf(repo, entry.message);
  if (!sources.length) return null;
  for (const item of promotion) {
    const source = sources.find(candidate => (item.excludes ?? []).some(excluded => excluded.sha === candidate.sha));
    if (source) return `cherry-pick 的来源 ${short(source.sha)} 在晋升窗口 #${item.issue} 的 excludes 里：不要把它推进 main。`;
  }
  if (entry.parents.length > 1) return '合并提交不能由晋升窗口放行：改用 git cherry-pick -x 挑单个 pick，或者不要把它推进 main。';
  for (const item of promotion) {
    const source = sources.find(candidate => (item.picks ?? []).includes(candidate.sha));
    if (!source) continue;
    if (source.patchId === null) return `cherry-pick 的来源 ${short(source.sha)} 在本仓库里找不到或没有内容，无法核对 patch-id：先 git fetch 后再判定。`;
    return `cherry-pick 的来源 ${short(source.sha)} 是晋升窗口 #${item.issue} 的 pick，但提交内容与它的 patch-id 不一致（内容被改过，或挑的时候解决过冲突）：用 git cherry-pick -x ${short(source.sha)} 原样重做；有冲突就在 stage 上把冲突处理成新提交，经预发布后另登窗口挑它。`;
  }
  for (const { item, reason } of blocked) {
    const source = sources.find(candidate => (item.picks ?? []).includes(candidate.sha));
    if (source) return `cherry-pick 的来源 ${short(source.sha)} 在晋升窗口 #${item.issue} 的 picks 里，但这个窗口现在不放行：${reason}。`;
  }
  return `cherry-pick 的来源 ${short(sources[0].sha)} 不在任何开着的晋升窗口 picks 里：要挑它就先由所有者批准并登记进 picks，否则不要把它推进 main。`;
}

/** 不归属时的原因：说明引用了 hotfix 窗口就按 hotfix 说；带 cherry-pick 痕迹就按晋升窗口说。 */
export function explainCommit(repo, entry, { hotfix = null, promotion = [], blocked = [], now = new Date() } = {}) {
  const citesHotfix = (hotfix?.windows ?? []).some(item => referencesIssue(entry.message, item.issue));
  // 改了晋升登记的提交按登记说明，哪怕说明引用了 hotfix 窗口：hotfix 窗口不放行它。
  const promotionReason = explainRegistration(repo, entry, blocked) ?? (citesHotfix ? null : explainPromotion(repo, entry, promotion, blocked));
  return promotionReason ?? explainUnattributed(entry.sha, entry.message, entry.committedAt, hotfix ?? { windows: [] }, now);
}

/** 窗口的 stageBase 与 picks 必须是登记时已在 stage 上的提交：挑不在 stage 上的提交等于绕过 stage。 */
export function promotionProblems(repo, item, stageSha) {
  const problems = [];
  const base = item.stageBase;
  if (isAncestorOf(repo, base, stageSha) !== true) problems.push(`晋升窗口 #${item.issue} 的 stageBase ${short(base)} 不在 stage（${short(stageSha)}）的历史里：stageBase 必须是登记时 stage 的提交，登记写错就重新登记。`);
  for (const sha of item.picks) {
    if (isAncestorOf(repo, sha, base) !== true) problems.push(`晋升窗口 #${item.issue} 的 pick ${short(sha)} 不在 stageBase ${short(base)}（登记时的 stage）的历史里：只能挑登记时已经在 stage 上的提交；把它移出 picks，或者不要把它推进 main。`);
  }
  return problems;
}

/** 窗口排除的提交是否已经进了 main：本身是 main 的祖先，或 main 独有提交带着它的 cherry-pick 痕迹。 */
export function excludedOnMain({ repo, mainSha, windows, ahead }) {
  const hits = [];
  for (const item of windows) {
    for (const { sha } of item.excludes ?? []) {
      if (isAncestorOf(repo, sha, mainSha) === true) {
        hits.push({ sha, issue: item.issue, via: 'main 的祖先' });
        continue;
      }
      const carrier = ahead.find(entry => trailerShas(entry.message).includes(sha));
      if (carrier) hits.push({ sha, issue: item.issue, via: `main 独有提交 ${short(carrier.sha)} 的 cherry-pick 痕迹` });
    }
  }
  return hits;
}

/** from..to 上 to 独有的提交（新在前）。超过 AHEAD_LIMIT 个不逐个核对，直接失败。 */
export function commitsBetween(repo, from, to) {
  const result = gitRun(repo, ['log', '--format=%H%x00%P%x00%ct%x00%B%x01', `${from}..${to}`]);
  if (result.status !== 0) throw new Error(`无法列出 ${from}..${to}：${(result.stderr ?? '').trim()}`);
  const entries = (result.stdout ?? '').split('\x01').map(entry => entry.replace(/^\n/, '')).filter(Boolean).map(entry => {
    const [sha, parents = '', committed = '', message = ''] = entry.split('\x00');
    return { sha, parents: parents.split(' ').filter(Boolean), committedAt: Number(committed) * 1000, message };
  });
  if (entries.length > AHEAD_LIMIT) throw new Error(`main 领先 stage ${entries.length} 个提交，超过 ${AHEAD_LIMIT} 个，无法逐个核对归属：先让 main 与 stage 对齐再判定。`);
  return entries;
}

/**
 * main 领先 stage 的判定，分支门禁与 check 命令共用：逐个提交归属（hotfix 窗口或晋升窗口），再查窗口本身
 * （过期、picks 与 stageBase 是否在 stage 上、excludes 是否进了 main）。只读，登记读 mainSha 那一版。
 * main 不领先 stage 时也照读登记：开着的晋升窗口里排除的提交，不能随 main 快进到 stage 而进 main。登记不合法就当作没有窗口。
 */
export function judgeAhead({ repo, mainSha, stageSha, priorMainSha = null, now = new Date() }) {
  const ahead = commitsBetween(repo, stageSha, mainSha);
  const problems = [];
  const { hotfix, promotion } = readWindowsAt(repo, mainSha, problems);
  for (const item of hotfix ? expiredWindows(hotfix, now) : []) problems.push(`hotfix 窗口 #${item.issue} 已超过 expiresAt（${item.expiresAt}）还没收尾：合回 stage 并把窗口标 closed，或由所有者重新批准。`);
  for (const item of promotion ? expiredPromotions(promotion, now) : []) problems.push(`晋升窗口 #${item.issue} 已超过 expiresAt（${item.expiresAt}）还没收尾：picks 合回 stage 后把窗口标 closed（写 closedAt 与 evidence），或由所有者重新批准。`);
  const windows = hotfix ? activeWindows(hotfix, now) : [];
  const open = promotion ? activePromotions(promotion, now) : [];
  const promotions = usablePromotions(repo, open, ahead);
  const blocked = blockedPromotions(repo, open, promotions, ahead);
  for (const item of promotions) problems.push(...promotionProblems(repo, item, stageSha));
  // 登记过的窗口只能标 closed，不能删改：main 与 stage 各按自己的历史核对（登记还只在 main 独有提交里时，stage 的历史里没有它）。
  const tampered = [];
  // stage 那一版直接对照 main 上开着的窗口：历史里只有 stage 自己写的那一版时，靠这一条认出它和 main 的登记不同。
  const registered = registeredOn(repo, ahead);
  let stageRegistry = null;
  try { stageRegistry = readPromotionsAt(repo, stageSha); } catch { stageRegistry = null; }
  for (const item of droppedPromotions(open, stageRegistry, window => registered.has(window.issue))) {
    tampered.push(`stage 这一版删了或改了 main 上开着的晋升窗口 #${item.issue}：登记后不能删改，只能标 closed（写 closedAt 与 evidence）。`);
  }
  const mainLost = lostPromotions(repo, mainSha);
  for (const item of mainLost) tampered.push(`main 的历史上登记过的晋升窗口 #${item.issue}，到 main 这一版被删了或改了：登记后不能删改，只能标 closed（写 closedAt 与 evidence）；它登记时的 excludes 照旧核对。`);
  for (const item of lostPromotions(repo, stageSha)) tampered.push(`stage 的历史上登记过的晋升窗口 #${item.issue}，到 stage 这一版被删了或改了：登记后不能删改，只能标 closed（写 closedAt 与 evidence）。`);
  // 推送前的远端 main 上标 open 的窗口（过期的也算），强推换掉历史后也只能是原样或已标 closed。
  let carried = [];
  if (priorMainSha && priorMainSha !== mainSha) {
    if (!resolveRev(repo, priorMainSha)) {
      tampered.push(`推送前的远端 main ${short(priorMainSha)} 不在本地，核对不了它上面开着的晋升窗口：先 git fetch 再推。`);
    } else {
      let prior = null;
      try { prior = readPromotionsAt(repo, priorMainSha); } catch { prior = null; }
      carried = droppedPromotions(windowsIn(prior).filter(item => item.status === 'open'), promotion);
      for (const item of carried) tampered.push(`推送前的 main（${short(priorMainSha)}）上开着的晋升窗口 #${item.issue}，这次推送后被删了或改了：登记后不能删改，只能标 closed；它的 excludes 照旧核对。`);
    }
  }
  problems.push(...new Set(tampered));
  // 被删改的窗口按原来那一版核对 excludes：改了登记不等于解除排除。
  const seen = new Set();
  const excluded = excludedOnMain({ repo, mainSha, windows: [...open, ...mainLost, ...carried], ahead }).filter(hit => !seen.has(`${hit.issue}:${hit.sha}`) && seen.add(`${hit.issue}:${hit.sha}`));
  for (const hit of excluded) problems.push(`晋升窗口 #${hit.issue} 排除的提交 ${short(hit.sha)} 已经在 main 上（${hit.via}）：排除的提交不能进 main，先由所有者确认再处理。`);
  const attributed = [];
  const unattributed = [];
  for (const entry of ahead) {
    const owner = attributeCommit(repo, entry, { hotfix: windows, promotion: promotions });
    if (owner) attributed.push({ sha: entry.sha, ...owner });
    else unattributed.push({ sha: entry.sha, reason: explainCommit(repo, entry, { hotfix, promotion: promotions, blocked, now }) });
  }
  return { ahead, problems, tampered: [...new Set(tampered)], hotfix, promotion, windows, open, promotions, blocked, carried, excluded, attributed, unattributed };
}

function pickLine(repo, sha, item, mainSha, ahead) {
  if (isAncestorOf(repo, sha, mainSha) === true) return `pick ${short(sha)} 已在 main（main 的祖先）`;
  const carrier = ahead.find(entry => trailerShas(entry.message).includes(sha) && coverageOf(repo, entry, [item]) === item);
  if (carrier) return `pick ${short(sha)} 已在 main（cherry-pick ${short(carrier.sha)}，patch-id 一致）`;
  const seen = ahead.find(entry => trailerShas(entry.message).includes(sha));
  return seen ? `pick ${short(sha)} 尚未挑进 main：${short(seen.sha)} 带有它的 cherry-pick 痕迹，但 patch-id 与它不一致` : `pick ${short(sha)} 尚未挑进 main`;
}

const firstRev = (repo, candidates) => candidates.find(rev => resolveRev(repo, rev)) ?? null;

/** check：返回逐行的 Chinese 说明与违规列表；ok 为 false 时命令退出码为 1。 */
export function promotionCheck({ repo = process.cwd(), main, stage, now = new Date() } = {}) {
  const mainRev = main ?? firstRev(repo, ['origin/main', 'main']);
  const stageRev = stage ?? firstRev(repo, ['origin/stage', 'stage']);
  const mainSha = mainRev ? resolveRev(repo, mainRev) : null;
  const stageSha = stageRev ? resolveRev(repo, stageRev) : null;
  if (!mainSha || !stageSha) throw new Error(`找不到 ${!mainSha ? `main 提交（${mainRev ?? 'origin/main 或 main'}）` : `stage 提交（${stageRev ?? 'origin/stage 或 stage'}）`}：先 git fetch，或用 --main/--stage 指定存在的提交。`);
  const judged = judgeAhead({ repo, mainSha, stageSha, now });
  const lines = [`晋升窗口检查：main ${mainRev}（${short(mainSha)}），stage ${stageRev}（${short(stageSha)}），main 领先 stage ${judged.ahead.length} 个提交。`];
  for (const item of judged.windows) lines.push(`hotfix 窗口 #${item.issue}：开着，归属 ${judged.attributed.filter(hit => hit.kind === 'hotfix' && hit.issue === item.issue).length} 个 main 独有提交。`);
  for (const { item, reason } of judged.blocked) lines.push(`晋升窗口 #${item.issue}：开着，但不能用来放行（${reason}）；它的 excludes 照样核对。`);
  for (const item of judged.promotions) {
    lines.push(`晋升窗口 #${item.issue}：批准于 ${item.approvedAt}，expiresAt ${item.expiresAt}，归属 ${judged.attributed.filter(hit => hit.kind !== 'hotfix' && hit.issue === item.issue).length} 个 main 独有提交（含登记提交）。`);
    for (const sha of item.picks) lines.push(`  ${pickLine(repo, sha, item, mainSha, judged.ahead)}`);
    for (const { sha } of item.excludes ?? []) {
      const hit = judged.excluded.find(entry => entry.sha === sha && entry.issue === item.issue);
      lines.push(hit ? `  排除的 ${short(sha)} 已进 main（${hit.via}）。` : `  排除的 ${short(sha)} 未进 main。`);
    }
  }
  if (!judged.open.length) lines.push('没有开着的晋升窗口。');
  const failures = [...judged.problems, ...judged.unattributed.map(item => `main 独有提交 ${short(item.sha)} 不归属任何开着的窗口：${item.reason}`)];
  return { ok: failures.length === 0, lines, failures };
}

const USAGE = `部分晋升窗口（只读）：
  node scripts/promotion-windows.mjs check [--main <rev>] [--stage <rev>]
    --main 默认 origin/main（没有则 main），--stage 默认 origin/stage（没有则 stage）。
    退出码 0：main 领先 stage 的提交全部归属于开着的窗口，且没有 excludes 进了 main。`;

function main(argv) {
  const [command, ...rest] = argv;
  if (!command || command === '--help' || command === '-h') {
    console.log(USAGE);
    return;
  }
  if (command !== 'check') throw new Error(`未知命令：${command}\n${USAGE}`);
  const options = {};
  for (let index = 0; index < rest.length; index++) {
    const arg = rest[index];
    if (arg !== '--main' && arg !== '--stage') throw new Error(`未知参数：${arg}`);
    const value = rest[++index];
    if (!value || value.startsWith('--')) throw new Error(`${arg} 需要提交或分支名`);
    options[arg.slice(2)] = value;
  }
  const result = promotionCheck(options);
  for (const line of result.lines) console.log(line);
  for (const failure of result.failures) console.log(`[违规] ${failure}`);
  if (result.ok) {
    console.log('晋升窗口检查通过。');
    return;
  }
  process.exitCode = 1;
}

// 入口判定走 realpath，理由同 check-branch-invariants.mjs：符号链接启动时直接比较路径会静默不执行。
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

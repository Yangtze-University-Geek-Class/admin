#!/usr/bin/env node
// 只加载同步模块的设置存储，不建库、不迁移、不播种资料、不启动任何循环。
// Node 22 用 --experimental-transform-types；CI 分发同一提交的本文件、迁移工具和 gitlab-sync.ts。
import { readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { assertSector, loadDatabase } from './migrate-oidc-subjects.mjs';
import { readGitlabSyncSettings, writeGitlabSyncSettings } from '../../app/server/src/lib/gitlab-sync.ts';

function configuration(db, env) {
  const stored = readGitlabSyncSettings(db);
  const settings = { mode: stored?.mode ?? env.GITLAB_SYNC ?? 'off', group: stored?.group ?? env.GITLAB_GROUP ?? 'geek', interval_minutes: stored?.interval_minutes ?? 10 };
  if (!['off', 'dry-run', 'on'].includes(settings.mode) || !/^[A-Za-z0-9_.\/-]+$/.test(settings.group) || !Number.isInteger(settings.interval_minutes) || settings.interval_minutes < 5 || settings.interval_minutes > 1440) throw new Error('invalid_sync_settings');
  return { ...settings, env_mode: env.GITLAB_SYNC ?? 'off', persisted_mode: stored?.mode ?? null, token_configured: Boolean(env.GITLAB_API_TOKEN) };
}

function accountsForVerification(db, sector, now) {
  return db.prepare(`SELECT u.id AS account_id, s.sub, g.gitlab_user_id, g.state, g.access_level, g.last_error,
    CASE WHEN EXISTS(SELECT 1 FROM perm_members owner WHERE owner.account_id=u.id AND owner.group_id='title.site.owner' AND (owner.expires_at IS NULL OR owner.expires_at > @now)) THEN 50 ELSE 30 END AS expected_access
    FROM users u LEFT JOIN oauth_subjects s ON s.user_id=u.id AND s.sector_id=@sector
    LEFT JOIN gitlab_accounts g ON g.account_id=u.id
    WHERE u.status='active' AND EXISTS(SELECT 1 FROM perm_members m WHERE m.account_id=u.id AND m.group_id IN ('level.member','level.alumni') AND (m.expires_at IS NULL OR m.expires_at > @now))
    ORDER BY u.id`).all({ sector, now });
}

function identityLabels(db, accountId) {
  return db.prepare("SELECT provider, provider_uid FROM identities WHERE user_id=? AND provider IN ('github','google') ORDER BY provider, provider_uid")
    .all(accountId).map(id => `${id.provider}:${id.provider_uid}`);
}

export function readSyncReport(db, env, sector, now = Date.now()) {
  assertSector(sector);
  const accounts = accountsForVerification(db, sector, now);
  const bindings = accounts.map(account => ({ identities: identityLabels(db, account.account_id), gitlab_id: account.gitlab_user_id, has_subject: Boolean(account.sub), state: account.state, access_level: account.access_level, expected_access: account.expected_access, last_error: account.last_error }));
  return {
    scope: 'persisted-configuration', configuration: configuration(db, env),
    accounts: db.prepare("SELECT COUNT(*) AS n FROM users WHERE status <> 'merged'").get().n,
    eligible_members: accounts.length, mapped_members: bindings.filter(binding => binding.gitlab_id !== null).length,
    missing_subjects: bindings.filter(binding => !binding.has_subject).length, bindings,
  };
}

export function compareBaseline(report, baseline) {
  if (!Array.isArray(baseline?.bindings)) throw new Error('baseline_invalid');
  const failures = [];
  for (const binding of baseline.bindings) {
    if (binding.gitlab_id === null) continue;
    const current = report.bindings.filter(candidate => candidate.identities.some(identity => binding.identities.includes(identity)));
    if (current.length !== 1) failures.push({ identities: binding.identities, gitlab_id: binding.gitlab_id, reason: 'baseline_member_missing' });
    else if (current[0].gitlab_id !== null && current[0].gitlab_id !== binding.gitlab_id) failures.push({ identities: binding.identities, gitlab_id: binding.gitlab_id, reason: 'existing_gitlab_id_changed' });
  }
  return failures;
}

/** @typedef {{bindings: Array<{identities: string[], gitlab_id: number|null}>}} SyncBaseline */
/** @typedef {{fetcher?: import('../../app/server/src/lib/gitlab-sync.ts').FetchLike, baseline?: SyncBaseline|null, now?: number}} SyncVerificationOptions */
/** @param {SyncVerificationOptions} [options] */
export async function verifyAccounts(db, env, sector, options = {}) {
  const { fetcher = fetch, baseline = null, now = Date.now() } = options;
  const report = readSyncReport(db, env, sector, now);
  const config = report.configuration;
  if (!env.GITLAB_URL || !env.GITLAB_API_TOKEN) throw new Error('gitlab_configuration_missing');
  const origin = new URL(env.GITLAB_URL);
  if (origin.protocol !== 'https:' || origin.username || origin.password || origin.search || origin.hash) throw new Error('invalid_gitlab_origin');
  const base = `${origin.origin}${origin.pathname.replace(/\/+$/, '')}`;
  const accounts = accountsForVerification(db, sector, now);
  const seen = new Set();
  const failures = baseline ? compareBaseline(report, baseline) : [];
  let verified = 0;
  async function get(path) {
    const result = await fetcher(`${base}/api/v4${path}`, { headers: { 'PRIVATE-TOKEN': env.GITLAB_API_TOKEN }, redirect: 'error', signal: AbortSignal.timeout(15_000) });
    if (result.status !== 200) throw new Error(`gitlab_http_${result.status}`);
    return result.json();
  }
  for (const account of accounts) {
    const identities = identityLabels(db, account.account_id);
    let reason = null;
    try {
      if (!account.sub || !Number.isSafeInteger(account.gitlab_user_id) || account.gitlab_user_id <= 0) throw new Error('mapping_missing');
      if (seen.has(account.gitlab_user_id)) throw new Error('duplicate_gitlab_id');
      seen.add(account.gitlab_user_id);
      const user = await get(`/users/${account.gitlab_user_id}`);
      const oidc = Array.isArray(user.identities) ? user.identities.filter(identity => identity.provider === 'openid_connect') : [];
      if (user.id !== account.gitlab_user_id || user.state !== 'active' || user.is_admin !== false || user.bot === true || (user.user_type && user.user_type !== 'human') || ['root', 'geek-sync'].includes(user.username?.toLowerCase())) throw new Error('gitlab_user_not_managed_active');
      if (oidc.length !== 1 || oidc[0].extern_uid !== account.sub) throw new Error('oidc_binding_mismatch');
      const membership = await get(`/groups/${encodeURIComponent(config.group)}/members/all/${account.gitlab_user_id}`);
      if (membership.id !== account.gitlab_user_id || membership.access_level !== account.expected_access) throw new Error('group_access_mismatch');
      verified += 1;
    } catch (error) {
      // 网络异常不能把包含请求头、响应体或 sub 的对象写进 CI 日志。
      reason = error instanceof Error && /^(mapping_missing|duplicate_gitlab_id|existing_gitlab_id_changed|gitlab_user_not_managed_active|oidc_binding_mismatch|group_access_mismatch|gitlab_http_[0-9]{3})$/.test(error.message) ? error.message : 'gitlab_unreachable';
    }
    if (reason) failures.push({ identities, gitlab_id: account.gitlab_user_id, reason });
  }
  return { ...report, verified_members: verified, failures };
}

const REPAIR_REASON = /^(source_sub_taken|identities_unreadable|account_repeated|duplicate_repeated|original_repeated|duplicate_unmapped|original_missing|original_ambiguous|original_not_managed|original_already_mapped|original_username_taken|mapping_inconsistent|duplicate_identity_unexpected|duplicate_not_managed|duplicate_activity_unknown|duplicate_used|gitlab_http_[0-9]{3})$/;

/**
 * 改接之前正式同步已经开过（2026-10-29 15:43–16:18），给 GitLab 上已有号的成员又建了一个号：正式库给这个账号生成了新的 sub，
 * GitLab 原来的号绑着预发布的 sub，于是主体迁移报「目标库该账号已有不同的 sub」。这里只修这一种形状：
 * 原号按预发布的 sub 能唯一找到、是受管的普通成员、正式库没有别的账号映射它；重复号是正式库这一行映射的号、
 * 只绑着正式的 sub（或上次修到一半已经解绑）、从没登录过。有一条对不上就整批拒绝，什么也不写。
 * 写入时每个账号先在 GitLab 上解绑并封禁重复号（只封不删），再把正式库的 sub 换成预发布的、映射换成原号；
 * 中途失败重跑会从剩下的那步接着做。输出只有计数、provider_uid 和 GitLab 数字 id，不含 sub、邮箱或令牌。
 */
export async function repairDuplicates(db, env, sector, payload, options = {}) {
  const { fetcher = fetch, apply = false, now = Date.now() } = options;
  assertSector(sector);
  if (payload?.sector !== sector || !Array.isArray(payload.entries)) throw new Error('输入不是同一个 sector 的 export 结果');
  if (!env.GITLAB_URL || !env.GITLAB_API_TOKEN) throw new Error('gitlab_configuration_missing');
  const origin = new URL(env.GITLAB_URL);
  if (origin.protocol !== 'https:' || origin.username || origin.password || origin.search || origin.hash) throw new Error('invalid_gitlab_origin');
  const base = `${origin.origin}${origin.pathname.replace(/\/+$/, '')}`;
  async function call(method, path) {
    const result = await fetcher(`${base}/api/v4${path}`, { method, headers: { 'PRIVATE-TOKEN': env.GITLAB_API_TOKEN }, redirect: 'error', signal: AbortSignal.timeout(15_000) });
    const text = await result.text();
    let data = null;
    try { data = text ? JSON.parse(text) : null; } catch { data = null; }
    return { status: result.status, data };
  }
  async function get(path) {
    const result = await call('GET', path);
    if (result.status !== 200) throw new Error(`gitlab_http_${result.status}`);
    return result.data;
  }
  // 读不到身份列表不能当成「已解绑」
  const oidcOf = user => {
    if (!Array.isArray(user?.identities)) throw new Error('identities_unreadable');
    return user.identities.filter(identity => identity?.provider === 'openid_connect');
  };
  const managed = user => user && user.is_admin === false && user.bot !== true && (!user.user_type || user.user_type === 'human')
    && typeof user.username === 'string' && !['root', 'geek-sync'].includes(user.username.toLowerCase());
  const findUser = db.prepare('SELECT user_id FROM identities WHERE provider = ? AND provider_uid = ?');
  const currentSub = db.prepare('SELECT sub FROM oauth_subjects WHERE sector_id = ? AND user_id = ?');
  const subOwner = db.prepare('SELECT user_id FROM oauth_subjects WHERE sector_id = ? AND sub = ?');
  const rowOf = db.prepare('SELECT gitlab_user_id FROM gitlab_accounts WHERE account_id = ?');
  const mappedTo = db.prepare('SELECT account_id FROM gitlab_accounts WHERE gitlab_user_id = ?');
  const usernameOwner = db.prepare('SELECT account_id FROM gitlab_accounts WHERE username = ? COLLATE NOCASE');

  const plan = [];
  const refused = [];
  for (const entry of payload.entries) {
    const users = new Set();
    for (const id of entry.identities ?? []) {
      const user = findUser.get(id.provider, String(id.provider_uid));
      if (user) users.add(user.user_id);
    }
    // 对不上或对到多个账号的，归主体迁移去报，这里不管
    if (users.size !== 1) continue;
    const [accountId] = users;
    const existing = currentSub.get(sector, accountId)?.sub;
    if (!existing || existing === entry.sub) continue;
    const label = entry.identities.map(id => `${id.provider}:${id.provider_uid}`).join(',');
    try {
      const owner = subOwner.get(sector, entry.sub)?.user_id;
      if (owner && owner !== accountId) throw new Error('source_sub_taken');
      const duplicateId = rowOf.get(accountId)?.gitlab_user_id;
      if (!Number.isSafeInteger(duplicateId) || duplicateId <= 0) throw new Error('duplicate_unmapped');
      const found = await get(`/users?extern_uid=${encodeURIComponent(entry.sub)}&provider=openid_connect&per_page=100`);
      if (!Array.isArray(found) || found.length === 0) throw new Error('original_missing');
      if (found.length > 1) throw new Error('original_ambiguous');
      const original = await get(`/users/${found[0].id}`);
      const originalOidc = oidcOf(original);
      if (original?.id !== found[0].id || !managed(original) || !['active', 'blocked'].includes(original.state)
        || originalOidc.length !== 1 || originalOidc[0].extern_uid !== entry.sub) throw new Error('original_not_managed');
      if (original.id === duplicateId) throw new Error('mapping_inconsistent');
      const mapped = mappedTo.get(original.id)?.account_id;
      if (mapped && mapped !== accountId) throw new Error('original_already_mapped');
      const named = usernameOwner.get(original.username)?.account_id;
      if (named && named !== accountId) throw new Error('original_username_taken');
      const duplicate = await get(`/users/${duplicateId}`);
      const duplicateOidc = oidcOf(duplicate);
      if (duplicate?.id !== duplicateId || !managed(duplicate)) throw new Error('duplicate_not_managed');
      if (!(duplicateOidc.length === 0 || (duplicateOidc.length === 1 && duplicateOidc[0].extern_uid === existing))) throw new Error('duplicate_identity_unexpected');
      if (!('last_sign_in_at' in duplicate) || !('current_sign_in_at' in duplicate)) throw new Error('duplicate_activity_unknown');
      if (duplicate.last_sign_in_at !== null || duplicate.current_sign_in_at !== null) throw new Error('duplicate_used');
      plan.push({ label, accountId, existing, sub: entry.sub, original: { id: original.id, username: original.username, state: original.state },
        duplicate: { id: duplicateId, linked: duplicateOidc.length === 1, blocked: duplicate.state === 'blocked' } });
    } catch (error) {
      // 网络异常的对象可能带请求头或 sub，只报固定的原因码
      refused.push({ label, reason: error instanceof Error && REPAIR_REASON.test(error.message) ? error.message : 'gitlab_unreachable' });
    }
  }

  // 同一个正式账号、同一个重复号或原号出现两次（例如两个预发布账号在正式库已合并）：先写哪条取决于导出顺序，整批拒绝
  for (const [field, reason] of [['accountId', 'account_repeated'], ['duplicate', 'duplicate_repeated'], ['original', 'original_repeated']]) {
    const keyOf = item => (field === 'accountId' ? item.accountId : item[field].id);
    const seen = new Map();
    for (const item of plan) seen.set(keyOf(item), (seen.get(keyOf(item)) ?? 0) + 1);
    for (const item of plan) if (seen.get(keyOf(item)) > 1) refused.push({ label: item.label, reason });
  }

  const repaired = [];
  if (apply && refused.length === 0) {
    const swapSub = db.prepare('UPDATE oauth_subjects SET sub = ? WHERE sector_id = ? AND user_id = ? AND sub = ?');
    const remap = db.prepare(`UPDATE gitlab_accounts SET gitlab_user_id = ?, username = ?, state = ?, access_level = NULL, avatar_source = NULL,
      emails_source = NULL, last_error = NULL, last_error_at = NULL, updated_at = ? WHERE account_id = ? AND gitlab_user_id = ?`);
    for (const item of plan) {
      if (item.duplicate.linked) {
        const unlinked = await call('DELETE', `/users/${item.duplicate.id}/identities/openid_connect`);
        if (![204, 404].includes(unlinked.status)) throw new Error(`repair_unlink_${unlinked.status}`);
      }
      if (!item.duplicate.blocked) {
        const blocked = await call('POST', `/users/${item.duplicate.id}/block`);
        if (![201, 403].includes(blocked.status)) throw new Error(`repair_block_${blocked.status}`);
      }
      const after = await get(`/users/${item.duplicate.id}`);
      if (oidcOf(after).length !== 0 || after.state !== 'blocked') throw new Error('repair_duplicate_not_closed');
      db.transaction(() => {
        if (swapSub.run(item.sub, sector, item.accountId, item.existing).changes !== 1) throw new Error('repair_subject_changed');
        const state = item.original.state === 'blocked' ? 'blocked' : 'active';
        if (remap.run(item.original.id, item.original.username, state, now, item.accountId, item.duplicate.id).changes !== 1) throw new Error('repair_mapping_changed');
      })();
      repaired.push(item);
    }
  }
  const view = item => ({ label: item.label, duplicate: item.duplicate.id, original: item.original.id });
  return { plan: plan.map(view), refused, repaired: repaired.map(view) };
}

async function main(argv) {
  const [command, mode] = argv;
  if (!['status', 'set-mode', 'verify', 'check-baseline', 'repair-duplicates'].includes(command)) throw new Error('usage: sync-control.mjs status|set-mode off|on|verify|check-baseline|repair-duplicates --sector <host> [--apply] [--baseline-stdin|--source-stdin]');
  const sectorIndex = argv.indexOf('--sector');
  if (sectorIndex < 0) throw new Error('sector_required');
  const sector = assertSector(argv[sectorIndex + 1]);
  const apply = ['set-mode', 'repair-duplicates'].includes(command) && argv.includes('--apply');
  const Database = loadDatabase();
  const db = new Database(process.env.DB_PATH || '/data/data.db', { readonly: !apply, fileMustExist: true });
  try {
    db.pragma('busy_timeout = 5000');
    if (command === 'status') console.log(JSON.stringify(readSyncReport(db, process.env, sector)));
    if (command === 'check-baseline') {
      const report = readSyncReport(db, process.env, sector);
      const failures = compareBaseline(report, JSON.parse(readFileSync(0, 'utf8')));
      console.log(JSON.stringify({ ...report, failures }));
      return failures.length === 0 ? 0 : 1;
    }
    if (command === 'verify') {
      const baseline = argv.includes('--baseline-stdin') ? JSON.parse(readFileSync(0, 'utf8')) : null;
      const report = await verifyAccounts(db, process.env, sector, { baseline });
      console.log(JSON.stringify(report));
      return report.failures.length === 0 ? 0 : 1;
    }
    if (command === 'repair-duplicates') {
      if (!argv.includes('--source-stdin')) throw new Error('source_required');
      const result = await repairDuplicates(db, process.env, sector, JSON.parse(readFileSync(0, 'utf8')), { apply });
      const lines = [
        `${apply ? '写入' : '演算'} sector=${sector}：重复号 ${result.plan.length}，拒绝 ${result.refused.length}${apply ? `，已修复 ${result.repaired.length}` : ''}`,
        ...result.plan.map(item => `重复号 ${item.label}：正式库映射 GitLab ${item.duplicate}，原号 GitLab ${item.original}`),
        ...result.refused.map(item => `拒绝 ${item.label}：${item.reason}`),
        ...result.repaired.map(item => `已修复 ${item.label}：GitLab ${item.duplicate} 已解绑并封禁，正式库改映射 GitLab ${item.original}`),
      ];
      console.log(lines.join('\n'));
      return result.refused.length === 0 ? 0 : 1;
    }
    if (command === 'set-mode') {
      if (!['off', 'on'].includes(mode)) throw new Error('invalid_sync_mode');
      const before = configuration(db, process.env);
      if (mode === 'on' && (!before.token_configured || !process.env.GITLAB_URL)) throw new Error('gitlab_configuration_missing');
      if (apply) writeGitlabSyncSettings(db, { mode, group: before.group, interval_minutes: before.interval_minutes });
      console.log(JSON.stringify({ scope: 'persistent-only', applied: apply, before: before.mode, after: apply ? mode : before.mode, planned: mode, restart_required: true }));
    }
    return 0;
  } finally { db.close(); }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try { process.exitCode = await main(process.argv.slice(2)); }
  catch (error) { console.error(error instanceof Error ? error.message : 'sync_control_failed'); process.exitCode = 1; }
}

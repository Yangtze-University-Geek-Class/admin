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

async function main(argv) {
  const [command, mode] = argv;
  if (!['status', 'set-mode', 'verify', 'check-baseline'].includes(command)) throw new Error('usage: sync-control.mjs status|set-mode off|on|verify|check-baseline --sector <host> [--apply] [--baseline-stdin]');
  const sectorIndex = argv.indexOf('--sector');
  if (sectorIndex < 0) throw new Error('sector_required');
  const sector = assertSector(argv[sectorIndex + 1]);
  const apply = command === 'set-mode' && argv.includes('--apply');
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

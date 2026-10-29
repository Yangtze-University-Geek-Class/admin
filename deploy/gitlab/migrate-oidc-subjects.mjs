#!/usr/bin/env node
// GitLab 改接另一个环境的统一登录前，把已经在用的 `sub` 带过去，GitLab 里的账号才不会变成新人。
// 对账只认不可变身份（identities 里的 provider + provider_uid），不按邮箱或昵称，也不抄内部账号 ID（两个库的 ID 不同）。
//
//   docker cp migrate-oidc-subjects.mjs <容器>:/tmp/                                    两个容器各复制一次，用完删掉
//   docker exec <源环境 server 容器> node /tmp/migrate-oidc-subjects.mjs export --sector <GitLab 主机名>      → stdout 一行 JSON
//   docker exec -i <目标环境 server 容器> node /tmp/migrate-oidc-subjects.mjs import --sector <GitLab 主机名> [--apply] < 上一步的 JSON
//                                                                                    缺省只演算，--apply 才写
//
// import 只新增（INSERT）：目标库里该账号在该 sector 已有不同的 sub、或这个 sub 已属于别人，都记为冲突并拒绝整批写入，
// 不覆盖任何已有行。输出只含计数和 provider_uid，不含邮箱、昵称或 sub 的值。
import { createRequire } from 'node:module';
import { readFileSync, readdirSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

const SECTOR_RE = /^[a-z0-9]([a-z0-9.-]*[a-z0-9])?$/;
const PROVIDERS = new Set(['github', 'google']);

export function loadDatabase() {
  const require = createRequire(import.meta.url);
  try { return require('better-sqlite3'); } catch { /* 容器里依赖在 pnpm 目录下 */ }
  const store = '/app/node_modules/.pnpm';
  const dir = readdirSync(store).find(name => name.startsWith('better-sqlite3@'));
  if (!dir) throw new Error('找不到 better-sqlite3');
  return createRequire(`${store}/${dir}/node_modules/`)('better-sqlite3');
}

export function assertSector(sector) {
  if (!SECTOR_RE.test(sector ?? '') || sector.length > 253) throw new Error('--sector 必须是 GitLab 的主机名');
  return sector;
}

/** 源环境：这个 sector 下每个账号的不可变身份和 sub。没有可对账身份的账号只计数。 */
export function exportSubjects(db, sector) {
  assertSector(sector);
  const rows = db.prepare('SELECT user_id, sub FROM oauth_subjects WHERE sector_id = ?').all(sector);
  const identitiesOf = db.prepare('SELECT provider, provider_uid FROM identities WHERE user_id = ? ORDER BY provider');
  const entries = [];
  let withoutIdentity = 0;
  for (const row of rows) {
    const ids = identitiesOf.all(row.user_id).filter(id => PROVIDERS.has(id.provider));
    if (ids.length === 0) { withoutIdentity += 1; continue; }
    entries.push({ sub: row.sub, identities: ids.map(id => ({ provider: id.provider, provider_uid: String(id.provider_uid) })) });
  }
  return { sector, entries, withoutIdentity };
}

/** 目标环境：演算（或写入）。返回 { plan, conflicts, unmatched, applied }。 */
export function importSubjects(db, payload, { sector, apply = false, now = Date.now() } = {}) {
  assertSector(sector);
  if (payload?.sector !== sector || !Array.isArray(payload.entries)) throw new Error('输入不是同一个 sector 的 export 结果');
  const findUser = db.prepare('SELECT user_id FROM identities WHERE provider = ? AND provider_uid = ?');
  const currentSub = db.prepare('SELECT sub FROM oauth_subjects WHERE sector_id = ? AND user_id = ?');
  const subOwner = db.prepare('SELECT user_id FROM oauth_subjects WHERE sector_id = ? AND sub = ?');
  const plan = [];
  const conflicts = [];
  const unmatched = [];
  const claimed = new Map();
  for (const entry of payload.entries) {
    const users = new Set();
    for (const id of entry.identities) {
      const user = findUser.get(id.provider, String(id.provider_uid));
      if (user) users.add(user.user_id);
    }
    const label = entry.identities.map(id => `${id.provider}:${id.provider_uid}`).join(',');
    if (users.size === 0) { unmatched.push(label); continue; }
    if (users.size > 1) { conflicts.push(`${label}：同一个源账号对到目标库的多个账号`); continue; }
    const [userId] = users;
    const existing = currentSub.get(sector, userId);
    if (existing) {
      if (existing.sub !== entry.sub) conflicts.push(`${label}：目标库该账号已有不同的 sub`);
      continue;
    }
    const owner = subOwner.get(sector, entry.sub)?.user_id ?? claimed.get(entry.sub);
    if (owner && owner !== userId) { conflicts.push(`${label}：这个 sub 已属于目标库的另一个账号`); continue; }
    claimed.set(entry.sub, userId);
    plan.push({ userId, sub: entry.sub, label });
  }
  let applied = 0;
  if (apply && conflicts.length === 0 && plan.length > 0) {
    const insert = db.prepare('INSERT INTO oauth_subjects(sector_id, user_id, sub, created_at) VALUES(?, ?, ?, ?)');
    db.transaction(() => { for (const item of plan) { insert.run(sector, item.userId, item.sub, now); applied += 1; } })();
  }
  return { plan, conflicts, unmatched, applied };
}

function option(argv, name) {
  const index = argv.indexOf(`--${name}`);
  return index >= 0 ? argv[index + 1] : undefined;
}

function main(argv) {
  const [mode] = argv;
  const sector = option(argv, 'sector');
  const Database = loadDatabase();
  const dbPath = process.env.DB_PATH || '/data/data.db';
  if (mode === 'export') {
    const db = new Database(dbPath, { readonly: true, fileMustExist: true });
    process.stdout.write(`${JSON.stringify(exportSubjects(db, sector))}\n`);
    return 0;
  }
  if (mode === 'import') {
    const apply = argv.includes('--apply');
    const db = new Database(dbPath, { fileMustExist: true });
    db.pragma('busy_timeout = 5000');
    const result = importSubjects(db, JSON.parse(readFileSync(0, 'utf8')), { sector, apply });
    const lines = [
      `${apply ? '写入' : '演算'} sector=${sector}：可迁 ${result.plan.length}，冲突 ${result.conflicts.length}，目标库对不上 ${result.unmatched.length}${apply ? `，已写入 ${result.applied}` : ''}`,
      ...result.conflicts.map(item => `冲突 ${item}`),
      ...result.unmatched.map(item => `对不上 ${item}`),
      ...(apply && result.applied > 0 ? [`回滚：DELETE FROM oauth_subjects WHERE sector_id='${sector}' AND user_id IN (${result.plan.map(item => `'${item.userId}'`).join(',')})`] : []),
    ];
    process.stdout.write(`${lines.join('\n')}\n`);
    return result.conflicts.length > 0 ? 1 : 0;
  }
  process.stderr.write('用法：migrate-oidc-subjects.mjs export|import --sector <主机名> [--apply]\n');
  return 2;
}

// 不调用 process.exit：stdout 是管道且对端读得慢时，立即退出会截断超过 64KB 的 export JSON
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) process.exitCode = main(process.argv.slice(2));

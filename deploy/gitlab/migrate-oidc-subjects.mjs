#!/usr/bin/env node
// GitLab 改接另一个环境的统一登录前，把已经在用的 `sub` 带过去，GitLab 里的账号才不会变成新人。
// 对账只认不可变身份（identities 里的 provider + provider_uid），不按邮箱或昵称，也不抄内部账号 ID（两个库的 ID 不同）。
//
//   docker cp migrate-oidc-subjects.mjs <容器>:/tmp/                                    两个容器各复制一次，用完删掉
//   docker exec <源环境 server 容器> node /tmp/migrate-oidc-subjects.mjs export --sector <GitLab 主机名>      → stdout 一行 JSON
//   docker exec -i <目标环境 server 容器> node /tmp/migrate-oidc-subjects.mjs import --sector <GitLab 主机名> [--apply] [--provision-unmatched] < 上一步的 JSON
//                                                                                    缺省只演算，--apply 才写
//
// import 只新增（INSERT）：目标库里该账号在该 sector 已有不同的 sub、或这个 sub 已属于别人，都记为冲突并拒绝整批写入，
// 不覆盖任何已有行。目标身份缺失或源账号无可对账身份时整批拒绝写入；只有显式 --provision-unmatched 才按 GitHub UID
// 最小补建（建号失败或 sub 冲突就回滚这个账号，不留下半条迁移）；演算时带它，能补建的单独计为「可最小补建」，不算对不上。
// 输出只含计数和 provider_uid，不含邮箱、昵称或 sub 的值。
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';

const SECTOR_RE = /^[a-z0-9]([a-z0-9.-]*[a-z0-9])?$/;
const PROVIDERS = new Set(['github', 'google']);

export function loadDatabase() {
  // 工作区与容器都从 server 包解析；运维脚本可能挂在 /ops 或复制到 /tmp。
  for (const anchor of [new URL('../../app/server/package.json', import.meta.url), new URL('file:///app/app/server/package.json')]) {
    const require = createRequire(anchor);
    let resolved;
    try { resolved = require.resolve('better-sqlite3'); }
    catch (error) {
      if (error.code === 'MODULE_NOT_FOUND') continue;
      throw error;
    }
    return require(resolved);
  }
  throw new Error('找不到 server 的 better-sqlite3 依赖');
}

export function assertSector(sector) {
  if (!SECTOR_RE.test(sector ?? '') || sector.length > 253) throw new Error('--sector 必须是 GitLab 的主机名');
  return sector;
}

/** 源环境：这个 sector 下每个账号的不可变身份和 sub。没有可对账身份的账号只计数。 */
export function exportSubjects(db, sector) {
  assertSector(sector);
  const rows = db.prepare('SELECT user_id, sub FROM oauth_subjects WHERE sector_id = ?').all(sector);
  const identitiesOf = db.prepare('SELECT provider, provider_uid, login FROM identities WHERE user_id = ? ORDER BY provider');
  const accountOf = db.prepare('SELECT status, org_state, org_role FROM users WHERE id = ?');
  const entries = [];
  let withoutIdentity = 0;
  for (const row of rows) {
    const ids = identitiesOf.all(row.user_id).filter(id => PROVIDERS.has(id.provider));
    if (ids.length === 0) { withoutIdentity += 1; continue; }
    const account = accountOf.get(row.user_id);
    const github = ids.find(id => id.provider === 'github');
    entries.push({
      sub: row.sub,
      identities: ids.map(id => ({ provider: id.provider, provider_uid: String(id.provider_uid) })),
      ...(github && account?.status === 'active' && account?.org_state === 'active' && (account.org_role === 'admin' || account.org_role === 'member')
        ? { provision: { github_login: github.login || `github-${github.provider_uid}`, org_role: account.org_role } }
        : {}),
    });
  }
  return { sector, entries, withoutIdentity };
}

/** 目标环境：演算（或写入）。返回 { plan, conflicts, unmatched, withoutIdentity, applied, provisioned, provisionable }。 */
export function importSubjects(db, payload, { sector, apply = false, now = Date.now(), provisionUnmatched = false, provisionAccount = null } = {}) {
  assertSector(sector);
  if (payload?.sector !== sector || !Array.isArray(payload.entries)) throw new Error('输入不是同一个 sector 的 export 结果');
  const withoutIdentity = payload.withoutIdentity ?? 0;
  if (!Number.isSafeInteger(withoutIdentity) || withoutIdentity < 0) throw new Error('输入的无身份计数无效');
  const findUser = db.prepare('SELECT user_id FROM identities WHERE provider = ? AND provider_uid = ?');
  const currentSub = db.prepare('SELECT sub FROM oauth_subjects WHERE sector_id = ? AND user_id = ?');
  const subOwner = db.prepare('SELECT user_id FROM oauth_subjects WHERE sector_id = ? AND sub = ?');
  const plan = [];
  const conflicts = [];
  const unmatched = [];
  const provisioned = [];
  const provisionable = [];
  const claimed = new Map();
  for (const entry of payload.entries) {
    db.prepare('SAVEPOINT subject_entry').run();
    let keepEntry = true;
    const rollbackEntry = () => {
      if (!keepEntry) return;
      keepEntry = false;
      db.prepare('ROLLBACK TO subject_entry').run();
      db.prepare('RELEASE subject_entry').run();
    };
    const users = new Set();
    for (const id of entry.identities) {
      const user = findUser.get(id.provider, String(id.provider_uid));
      if (user) users.add(user.user_id);
    }
    const label = entry.identities.map(id => `${id.provider}:${id.provider_uid}`).join(',');
    if (users.size === 0) {
      const github = entry.identities.find(id => id.provider === 'github');
      const provision = apply && provisionUnmatched && entry.provision && github && provisionAccount;
      // 演算时带 --provision-unmatched：写入时能按 GitHub UID 最小补建的单独计数，不当成对不上（停预发布写者之前要先知道）
      if (!apply && provisionUnmatched && entry.provision && github && entry.identities.every(id => id.provider === 'github')) {
        provisionable.push(label);
        rollbackEntry();
        continue;
      }
      if (!provision) { unmatched.push(label); rollbackEntry(); continue; }
      if (entry.identities.some(id => id.provider !== 'github')) {
        conflicts.push(`${label}：目标库缺失账号还有其它身份，不做最小补建`);
        rollbackEntry();
        continue;
      }
      db.prepare('SAVEPOINT provision_unmatched').run();
      try {
        const created = provisionAccount({ githubId: Number(github.provider_uid), githubLogin: entry.provision.github_login, orgRole: entry.provision.org_role });
        const user = findUser.get('github', String(github.provider_uid));
        if (!user) throw new Error('最小补建后仍找不到 GitHub 身份');
        users.add(user.user_id);
        provisioned.push({ label, accountId: user.user_id, created: created.created });
        db.prepare('RELEASE provision_unmatched').run();
      } catch (error) {
        db.prepare('ROLLBACK TO provision_unmatched').run();
        db.prepare('RELEASE provision_unmatched').run();
        conflicts.push(`${label}：最小补建失败（${error instanceof Error ? error.message : String(error)}）`);
        rollbackEntry();
        continue;
      }
    }
    if (users.size > 1) { conflicts.push(`${label}：同一个源账号对到目标库的多个账号`); rollbackEntry(); continue; }
    const [userId] = users;
    const existing = currentSub.get(sector, userId);
    if (existing) {
      if (existing.sub !== entry.sub) { conflicts.push(`${label}：目标库该账号已有不同的 sub`); rollbackEntry(); }
      else db.prepare('RELEASE subject_entry').run();
      continue;
    }
    const owner = subOwner.get(sector, entry.sub)?.user_id ?? claimed.get(entry.sub);
    if (owner && owner !== userId) {
      conflicts.push(`${label}：这个 sub 已属于目标库的另一个账号`);
      rollbackEntry();
      const provisionIndex = provisioned.findIndex(item => item.accountId === userId);
      if (provisionIndex >= 0) provisioned.splice(provisionIndex, 1);
      continue;
    }
    claimed.set(entry.sub, userId);
    plan.push({ userId, sub: entry.sub, label });
    db.prepare('RELEASE subject_entry').run();
  }
  let applied = 0;
  if (apply && conflicts.length === 0 && unmatched.length === 0 && withoutIdentity === 0 && plan.length > 0) {
    const insert = db.prepare('INSERT INTO oauth_subjects(sector_id, user_id, sub, created_at) VALUES(?, ?, ?, ?)');
    db.transaction(() => { for (const item of plan) { insert.run(sector, item.userId, item.sub, now); applied += 1; } })();
  }
  return { plan, conflicts, unmatched, withoutIdentity, applied, provisioned, provisionable };
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
    const provisionUnmatched = argv.includes('--provision-unmatched');
    const db = new Database(dbPath, { readonly: !apply, fileMustExist: true });
    db.pragma('busy_timeout = 5000');
    const provisionAccount = ({ githubId, githubLogin, orgRole }) => JSON.parse(execFileSync(process.execPath, [
      'app/server/dist/cli/account.js', 'provision-github', '--github-id', String(githubId), '--github-login', githubLogin, '--org-role', orgRole,
    ], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }));
    const result = importSubjects(db, JSON.parse(readFileSync(0, 'utf8')), { sector, apply, provisionUnmatched, provisionAccount });
    const lines = [
      `${apply ? '写入' : '演算'} sector=${sector}：可迁 ${result.plan.length}，冲突 ${result.conflicts.length}，目标库对不上 ${result.unmatched.length}，源账号无可对账身份 ${result.withoutIdentity}${apply ? `，已写入 ${result.applied}` : ''}${result.provisioned.length ? `，最小补建 ${result.provisioned.length}` : ''}${result.provisionable.length ? `，可最小补建 ${result.provisionable.length}` : ''}`,
      ...result.conflicts.map(item => `冲突 ${item}`),
      ...result.unmatched.map(item => `对不上 ${item}`),
      ...result.provisioned.map(item => `最小补建 ${item.label}（${item.created ? '新建' : '已存在'}）`),
      ...result.provisionable.map(item => `可最小补建 ${item}`),
      ...(apply && result.applied > 0 ? [`回滚：DELETE FROM oauth_subjects WHERE sector_id='${sector}' AND user_id IN (${result.plan.map(item => `'${item.userId}'`).join(',')})`] : []),
    ];
    process.stdout.write(`${lines.join('\n')}\n`);
    return result.conflicts.length > 0 || result.unmatched.length > 0 || result.withoutIdentity > 0 ? 1 : 0;
  }
  process.stderr.write('用法：migrate-oidc-subjects.mjs export|import --sector <主机名> [--apply] [--provision-unmatched]\n');
  return 2;
}

// 不调用 process.exit：stdout 是管道且对端读得慢时，立即退出会截断超过 64KB 的 export JSON
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) process.exitCode = main(process.argv.slice(2));

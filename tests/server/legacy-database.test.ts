import { mkdtempSync, rmSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { buildApp } from '../../app/server/src/app';
import { createConfig } from '../../app/server/src/config';
import { createCrypto } from '../../app/server/src/lib/crypto';
import { CAPABILITY_IDS, DEFAULT_DEPARTMENTS } from '../../app/server/src/lib/roles';
import type { ServiceOverrides } from '../../app/server/src/services';

// better-sqlite3 只装在 app/server 下；用同一个库造旧库文件，行为与生产一致。
const Database = createRequire(new URL('../../app/server/package.json', import.meta.url))('better-sqlite3') as typeof import('better-sqlite3');

const CONSOLE_ORG = 'Yangtze-University-Geek-Class';
const ENCRYPTION_KEY = Buffer.alloc(32, 7).toString('base64');
const NOW = Date.now();
const DAY = 24 * 60 * 60 * 1000;

/**
 * 生产 data.db 现有的表：app_state、sessions、invite_links、invitations、feedback、audit_logs
 * （外加 AUTOINCREMENT 自动建的 sqlite_sequence）。建表语句逐字取自 882435e 的
 * app/server/src/lib/db.ts，去掉当时还不在生产库里的 applications 与 invite_attempts。
 */
const LEGACY_SCHEMA = `
CREATE TABLE IF NOT EXISTS app_state (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS sessions (
  id TEXT PRIMARY KEY,
  login TEXT NOT NULL,
  user_id INTEGER,
  avatar_url TEXT,
  access_token_encrypted TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_sessions_login ON sessions(login);

CREATE TABLE IF NOT EXISTS invite_links (
  token TEXT PRIMARY KEY,
  org TEXT NOT NULL,
  created_by TEXT NOT NULL,
  created_by_token_encrypted TEXT NOT NULL,
  note TEXT,
  max_uses INTEGER NOT NULL,
  current_uses INTEGER NOT NULL DEFAULT 0,
  expires_at INTEGER NOT NULL,
  team_slug TEXT,
  disabled INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_invite_links_org ON invite_links(org);

CREATE TABLE IF NOT EXISTS invitations (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  org TEXT NOT NULL,
  invite_link_token TEXT,
  github_login TEXT,
  email TEXT,
  note TEXT,
  source_ip TEXT,
  user_agent TEXT,
  github_invitation_id INTEGER,
  status TEXT NOT NULL,
  error_message TEXT,
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_invitations_org_created ON invitations(org, created_at DESC);

CREATE TABLE IF NOT EXISTS feedback (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  org TEXT NOT NULL,
  content TEXT NOT NULL,
  category TEXT,
  contact TEXT,
  submitter_login TEXT,
  submitter_id INTEGER,
  source_ip TEXT,
  user_agent TEXT,
  status TEXT NOT NULL DEFAULT 'open',
  reply TEXT,
  replied_by TEXT,
  replied_at INTEGER,
  votes INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_feedback_org_status ON feedback(org, status, created_at DESC);

CREATE TABLE IF NOT EXISTS audit_logs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  org TEXT,
  actor TEXT NOT NULL,
  action TEXT NOT NULL,
  target TEXT,
  details TEXT,
  ip TEXT,
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_audit_org_created ON audit_logs(org, created_at DESC);
`;

const LEGACY_TABLES = ['app_state', 'audit_logs', 'feedback', 'invitations', 'invite_links', 'sessions', 'sqlite_sequence'];
const CONSOLE_TABLES = ['applications', 'application_reviews', 'departments', 'invite_attempts', 'role_assignments'];

const dirs: string[] = [];
const apps: { close: () => Promise<unknown> }[] = [];
afterEach(async () => {
  for (const app of apps.splice(0)) await app.close();
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

/** 在临时目录造一份「生产旧库」：只有旧表，带几行虚构数据；返回文件路径与建好的会话 id。 */
function legacyDatabase() {
  const dir = mkdtempSync(join(tmpdir(), 'geek-legacy-db-'));
  dirs.push(dir);
  const path = join(dir, 'data.db');
  const db = new Database(path);
  db.pragma('journal_mode = WAL');
  db.exec(LEGACY_SCHEMA);
  const { encrypt } = createCrypto(ENCRYPTION_KEY);
  const session = (id: string, login: string, userId: number) =>
    db.prepare('INSERT INTO sessions(id, login, user_id, avatar_url, access_token_encrypted, created_at, expires_at) VALUES(?, ?, ?, ?, ?, ?, ?)')
      .run(id, login, userId, null, encrypt(`token-${login}`), NOW - DAY, NOW + DAY);
  session('legacy-session-alice', 'alice', 101);
  session('legacy-session-bob', 'bob', 102);
  db.prepare("INSERT INTO app_state(key, value, updated_at) VALUES('fixture', 'kept', ?)").run(NOW - 3 * DAY);
  db.prepare('INSERT INTO invite_links(token, org, created_by, created_by_token_encrypted, note, max_uses, current_uses, expires_at, team_slug, disabled, created_at) VALUES(?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)')
    .run('legacy-link-token', CONSOLE_ORG, 'alice', encrypt('token-alice'), '旧邀请链接', 10, 2, NOW + 7 * DAY, null, 0, NOW - 2 * DAY);
  db.prepare("INSERT INTO invitations(org, invite_link_token, github_login, email, note, source_ip, user_agent, github_invitation_id, status, error_message, created_at) VALUES(?, ?, ?, NULL, NULL, '203.0.113.9', 'fixture-agent', 9001, 'sent', NULL, ?)")
    .run(CONSOLE_ORG, 'legacy-link-token', 'newcomer', NOW - DAY);
  const feedback = db.prepare("INSERT INTO feedback(org, content, category, contact, submitter_login, submitter_id, source_ip, user_agent, status, created_at, updated_at) VALUES(?, ?, '建议', NULL, NULL, NULL, '203.0.113.10', 'fixture-agent', ?, ?, ?)");
  feedback.run(CONSOLE_ORG, '希望增加周末的线下分享。', 'open', NOW - 2 * DAY, NOW - 2 * DAY);
  feedback.run(CONSOLE_ORG, '论坛能不能支持代码高亮？', 'done', NOW - DAY, NOW - DAY);
  feedback.run('other-org', '别的组织的意见不应出现在控制台。', 'open', NOW - DAY, NOW - DAY);
  const audit = db.prepare("INSERT INTO audit_logs(org, actor, action, target, details, ip, created_at) VALUES(?, ?, ?, ?, ?, '10.0.0.8', ?)");
  audit.run(null, 'alice', 'auth.signin', 'alice', null, NOW - 3 * DAY);
  audit.run(CONSOLE_ORG, 'alice', 'invite_link.create', 'legacy-link-token', JSON.stringify({ hours: 168, max_uses: 10 }), NOW - 2 * DAY);
  audit.run(CONSOLE_ORG, 'alice', 'feedback.update', '2', JSON.stringify({ status: 'done', has_reply: false }), NOW - DAY);
  db.close();
  return path;
}

function snapshot(path: string) {
  const db = new Database(path, { readonly: true });
  try {
    const tables = (db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name").all() as { name: string }[]).map(row => row.name);
    const rows = Object.fromEntries(['app_state', 'sessions', 'invite_links', 'invitations', 'feedback', 'audit_logs']
      .map(table => [table, db.prepare(`SELECT * FROM ${table} ORDER BY rowid`).all()]));
    return { tables, rows };
  } finally { db.close(); }
}

/** 模拟 GitHub：alice 是组织管理员，bob 是普通成员，carol 只用于被指派。 */
const ROLES: Record<string, 'admin' | 'member'> = { alice: 'admin', bob: 'member' };
const USERS: Record<string, number> = { alice: 101, bob: 102, carol: 103 };
const octokitFactory = (() => ({
  request: async (route: string, params: Record<string, string>) => {
    if (route === 'GET /orgs/{org}/memberships/{username}') {
      const role = params.org === CONSOLE_ORG ? ROLES[params.username.toLowerCase()] : undefined;
      if (!role) throw Object.assign(new Error('stub not found'), { status: 404 });
      return { data: { state: 'active', role } };
    }
    if (route === 'GET /users/{username}') {
      const id = USERS[params.username.toLowerCase()];
      if (!id) throw Object.assign(new Error('stub not found'), { status: 404 });
      return { data: { login: params.username, id } };
    }
    throw new Error(`Unexpected GitHub call ${route}`);
  },
})) as unknown as ServiceOverrides['octokitFactory'];

async function boot(dbPath: string) {
  const config = createConfig({
    NODE_ENV: 'test',
    PUBLIC_ORIGIN: 'https://example.test', DB_PATH: dbPath,
    FORUM_DB_PATH: '/nonexistent/never-open-legacy-forum.db',
    SESSION_SECRET: 'isolated-core-test-secret-at-least-32',
    ENCRYPTION_KEY,
    OAUTH_CLIENT_ID: 'test-client', OAUTH_CLIENT_SECRET: 'test-only-placeholder', POW_DIFFICULTY: '0',
    CONSOLE_ORG,
  });
  const deny = (() => { throw new Error('Unexpected external network request in legacy database test'); }) as unknown as ServiceOverrides['httpRequest'];
  const app = await buildApp({ config, staticRoot: false, overrides: { httpRequest: deny, octokitFactory } });
  await app.ready();
  apps.push(app);
  return app;
}
const as = (sid: string) => ({ cookie: `sid=${sid}` });

describe('booting on the existing production data.db (legacy schema, no applications table)', () => {
  it('keeps every legacy row, adds the console tables and serves the console without column errors', async () => {
    const path = legacyDatabase();
    const before = snapshot(path);
    expect(before.tables).toEqual(LEGACY_TABLES);

    const app = await boot(path);
    const { db } = app.services.storage;

    // 新表全部建好；旧表一行不少、一列不变。
    const tables = (db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name").all() as { name: string }[]).map(row => row.name);
    expect(tables).toEqual([...new Set([...LEGACY_TABLES, ...CONSOLE_TABLES])].sort());
    for (const [table, rows] of Object.entries(before.rows)) {
      expect(db.prepare(`SELECT * FROM ${table} ORDER BY rowid`).all(), table).toEqual(rows);
    }
    const indexes = (db.prepare("SELECT name FROM sqlite_master WHERE type = 'index' AND name NOT LIKE 'sqlite_%'").all() as { name: string }[]).map(row => row.name);
    expect(indexes).toEqual(expect.arrayContaining(['idx_applications_status_created', 'idx_application_reviews_app', 'uq_role_assignments_captain', 'idx_role_assignments_login']));
    expect(db.prepare('SELECT id FROM departments ORDER BY sort_order').all()).toEqual(DEFAULT_DEPARTMENTS.map(({ id }) => ({ id })));
    expect(db.pragma('integrity_check', { simple: true })).toBe('ok');

    // 旧会话仍然有效；没有显式班长时 GitHub 组织管理员临时代任班长。
    const me = await app.inject({ url: '/api/console/me', headers: as('legacy-session-alice') });
    expect(me.statusCode).toBe(200);
    expect(me.json()).toMatchObject({ login: 'alice', github_role: 'admin', bootstrap: true, capabilities: CAPABILITY_IDS });
    expect(me.json().title).toMatchObject({ id: 'captain', source: 'bootstrap' });

    const summary = await app.inject({ url: '/api/console/summary', headers: as('legacy-session-alice') });
    expect(summary.statusCode).toBe(200);
    expect(summary.json()).toMatchObject({
      applications: { total: 0, last_7d: 0 },
      feedback: { total: 2, open: 1 },
      people: { assignments: 0, departments: DEFAULT_DEPARTMENTS.length },
    });

    // 旧意见箱、旧审计按 CONSOLE_ORG 原样可读，别的组织与全局事件不外泄。
    const feedback = (await app.inject({ url: '/api/console/feedback', headers: as('legacy-session-alice') })).json();
    expect(feedback.items.map((item: { content: string }) => item.content)).toEqual(['论坛能不能支持代码高亮？', '希望增加周末的线下分享。']);
    const audit = (await app.inject({ url: '/api/console/audit', headers: as('legacy-session-alice') })).json();
    expect(audit.logs.map((row: { action: string }) => row.action)).toEqual(['feedback.update', 'invite_link.create']);
    expect(audit.logs[1].details).toEqual({ hours: 168, max_uses: 10 });

    // 新建的 applications / application_reviews 真能写：投递、列表、审核（外键指向刚建的 applications）。
    const apply = await app.inject({
      method: 'POST', url: '/api/portal/apply',
      payload: { name: '测试同学', className: '计科2301', email: 'student@example.test', strengths: '做过课程设计的前后端，愿意参与社区维护。', pow: { timestamp: Date.now(), nonce: 'x' } },
    });
    expect(apply.statusCode).toBe(201);
    const applicationId = apply.json().id as string;
    const list = (await app.inject({ url: '/api/console/applications', headers: as('legacy-session-alice') })).json();
    expect(list).toMatchObject({ total: 1, counts: { received: 1 } });
    const review = await app.inject({
      method: 'PATCH', url: `/api/console/applications/${applicationId}`, headers: as('legacy-session-alice'),
      payload: { status: 'reviewing', note: '周四面试' },
    });
    expect(review.statusCode).toBe(200);
    expect(review.json().application.status).toBe('reviewing');
    expect(db.pragma('foreign_key_check')).toEqual([]);

    // 普通组织成员只是极客班成员。
    const bob = (await app.inject({ url: '/api/console/me', headers: as('legacy-session-bob') })).json();
    expect(bob).toMatchObject({ github_role: 'member', bootstrap: false, capabilities: ['console.access', 'github.org.read'] });
    expect(bob.title).toMatchObject({ id: 'member', source: 'github' });

    // 临时代任的班长指定正式班长后，临时代任立即结束。
    const assign = await app.inject({
      method: 'POST', url: '/api/console/assignments', headers: as('legacy-session-alice'),
      payload: { github_login: 'carol', role: 'captain' },
    });
    expect(assign.statusCode).toBe(201);
    const after = (await app.inject({ url: '/api/console/me', headers: as('legacy-session-alice') })).json();
    expect(after.bootstrap).toBe(false);
    expect(after.title).toMatchObject({ id: 'member', source: 'github' });
    expect(after.capabilities).not.toContain('roles.manage');
  });

  it('boots twice on the same upgraded file without touching data (restart / rollback-forward)', async () => {
    const path = legacyDatabase();
    const first = await boot(path);
    first.services.roles.insertAssignment({ github_login: 'carol', github_user_id: 103, role: 'captain', department_id: '', note: '第三届班长', granted_by: 'alice' });
    first.services.roles.updateDepartment('tech', { description: '班长改过的描述' });
    await first.close();
    apps.splice(apps.indexOf(first), 1);
    const upgraded = snapshot(path);

    const second = await boot(path);
    const { db } = second.services.storage;
    for (const [table, rows] of Object.entries(upgraded.rows)) {
      expect(db.prepare(`SELECT * FROM ${table} ORDER BY rowid`).all(), table).toEqual(rows);
    }
    // 默认部门是 INSERT OR IGNORE：班长改过的不会被启动覆盖；显式班长仍在，管理员不再临时代任。
    expect(second.services.roles.getDepartment('tech')?.description).toBe('班长改过的描述');
    expect(second.services.roles.captain()).toMatchObject({ github_login: 'carol', role: 'captain' });
    const me = (await second.inject({ url: '/api/console/me', headers: as('legacy-session-alice') })).json();
    expect(me).toMatchObject({ github_role: 'admin', bootstrap: false });
  });
});

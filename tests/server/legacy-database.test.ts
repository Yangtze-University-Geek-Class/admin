import { STATIC_CDN_ORIGIN as CDN_ORIGIN } from '../static-cdn-fixture';
import { mkdtempSync, rmSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { buildApp } from '../../app/server/src/app';
import { testConfig } from './helpers';
import { createCrypto } from '../../app/server/src/lib/crypto';
import { createDatabase } from '../../app/server/src/lib/db';
import { DEFAULT_DEPARTMENTS } from '../../app/server/src/lib/roles';
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
const CONSOLE_TABLES = ['applications', 'application_reviews', 'console_seeds', 'departments', 'invite_attempts', 'role_assignments', 'titles'];
/** 论坛（#57）新增的表：同样只新增、不改旧表。 */
const FORUM_TABLES = [
  'forum_avatars', 'forum_bookmarks', 'forum_counters', 'forum_follows', 'forum_likes', 'forum_notifications',
  'forum_posts', 'forum_rate_events', 'forum_tags', 'forum_topic_views', 'forum_topics', 'forum_users',
];
/** 发信队列（#148）：同样只新增。 */
const MAIL_TABLES = ['mail_outbox'];
/** 投递次数（#169）：同样只新增，`applications` 不改。 */
const APPLY_TABLES = ['application_limits'];
/** 比赛（#238）与报名、组队、积分（#239）、官网托管、贡献收集、规则、定榜与奖项（#278）：同样只新增，`competitions` 不改任何旧表。 */
const COMPETITION_TABLES = [
  'competition_score_events', 'competition_signup_settings', 'competition_signups',
  'competition_team_members', 'competition_teams', 'competitions',
  'competition_site_versions', 'competition_sites', 'competition_gitlab_sources', 'competition_score_candidates',
  'competition_rules', 'competition_finals', 'competition_prizes',
];
/** 极客班账号（#262）：新表之外，只给 sessions、role_assignments、forum_users、audit_logs 加可空列，旧列不动。 */
const IDENTITY_TABLES = ['identities', 'identity_audit', 'users', 'invite_codes', 'email_challenges'];
/** 命令行设备授权（#262，RFC 8628）：同样只新增。 */
const DEVICE_TABLES = ['device_grants'];
/** 对外授权与 GitLab 账号同步（#270）：同样只新增。 */
const OIDC_TABLES = ['oauth_clients', 'oauth_subjects', 'oauth_grants', 'oidc_payloads', 'gitlab_accounts'];
/** 账号、权限、操作记录统一（#274）：同样只新增，forum_topics 加了可空列 visibility（默认 public）。 */
const YUGC_V2_TABLES = [
  'perm_nodes', 'perm_groups', 'perm_group_parents', 'perm_entries', 'perm_members', 'perm_state', 'perm_seed_applied',
  'account_profiles', 'account_avatars', 'activity_events', 'limit_events',
];
/** 论坛 v2（#276）：分级可见、表情、反应、图片上传，同样只新增；forum_topics.visibility 改成可空列。 */
const FORUM_V2_TABLES = [
  'forum_category_settings', 'forum_sticker_packs', 'forum_sticker_files', 'forum_stickers', 'forum_reactions', 'forum_upload_files',
];
/** 招聘邮件模板（#285）：同样只新增；首次启动把四类信现在的内容种成默认模板，另加一套面试邀请的简短版。 */
const MAIL_TEMPLATE_TABLES = ['mail_templates'];
// 访问防护（#333，lib/shield.ts 与 lib/rate-store.ts）：封禁表、信号表与接口限流计数表
const ABUSE_SHIELD_TABLES = ['ip_blocks', 'rate_limit_counters', 'shield_signals'];
/** 统一头像（#343）：GitHub 头像的像素图识别结论，同样只新增。 */
const AVATAR_TABLES = ['github_avatar_checks'];

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

/** 表里最前面的 rows.length 行、只取旧行有的列：升级加的列（#262）和之后新写的行不算改动。 */
function legacyColumns(db: import('better-sqlite3').Database, table: string, rows: Record<string, unknown>[]) {
  const columns = Object.keys(rows[0] ?? {});
  return (db.prepare(`SELECT * FROM ${table} ORDER BY rowid LIMIT ?`).all(rows.length) as Record<string, unknown>[])
    .map(row => Object.fromEntries(columns.map(column => [column, row[column]])));
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
  const config = testConfig({
    NODE_ENV: 'test',
    PUBLIC_ORIGIN: 'https://example.test', STATIC_CDN_ORIGIN: CDN_ORIGIN, DB_PATH: dbPath,
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

    // 新表全部建好；旧表一行不少、旧列一字不变（#262 加的列和启动回填写的那条审计另外核对）。
    const tables = (db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name").all() as { name: string }[]).map(row => row.name);
    expect(tables).toEqual([...new Set([...LEGACY_TABLES, ...CONSOLE_TABLES, ...FORUM_TABLES, ...MAIL_TABLES, ...APPLY_TABLES, ...COMPETITION_TABLES, ...IDENTITY_TABLES, ...DEVICE_TABLES, ...OIDC_TABLES, ...YUGC_V2_TABLES, ...FORUM_V2_TABLES, ...MAIL_TEMPLATE_TABLES, ...ABUSE_SHIELD_TABLES, ...AVATAR_TABLES])].sort());
    for (const [table, rows] of Object.entries(before.rows)) {
      expect(legacyColumns(db, table, rows), table).toEqual(rows);
    }
    expect(db.prepare("SELECT actor, action FROM audit_logs WHERE id > 3").all()).toEqual([{ actor: 'system', action: 'identity.backfill' }]);
    const indexes = (db.prepare("SELECT name FROM sqlite_master WHERE type = 'index' AND name NOT LIKE 'sqlite_%'").all() as { name: string }[]).map(row => row.name);
    expect(indexes).toEqual(expect.arrayContaining(['idx_applications_status_created', 'idx_application_reviews_app', 'uq_role_assignments_captain', 'idx_role_assignments_login', 'idx_audit_signin_actor']));
    // 登录过的人的查询（auth.signedInLogins）只读部分索引，不扫整张审计表。
    const plan = db.prepare("EXPLAIN QUERY PLAN SELECT actor AS login FROM audit_logs WHERE action = 'auth.signin' UNION SELECT login FROM sessions").all() as { detail: string }[];
    expect(plan.map(row => row.detail)).toEqual(expect.arrayContaining([expect.stringContaining('USING COVERING INDEX idx_audit_signin_actor')]));
    expect(db.prepare('SELECT id FROM departments ORDER BY sort_order').all()).toEqual(DEFAULT_DEPARTMENTS.map(({ id }) => ({ id })));
    expect(db.pragma('integrity_check', { simple: true })).toBe('ok');

    // 论坛表在旧库上建好并已播种；旧会话的成员能读到自己的论坛身份（这里只是普通成员，还没有管理能力）。
    const forum = await app.inject({ url: '/api/forum/state', headers: as('legacy-session-alice') });
    expect(forum.statusCode).toBe(200);
    expect(forum.json().state.topics.map((topic: { id: string }) => topic.id)).toEqual(['t9', 't73']);
    expect(forum.json().state.viewer).toMatchObject({ kind: 'member', capabilities: [] });

    // #274 review round 1（blocker）：站内角色不再靠「调用过某个接口，借会话自带的令牌实时查一次 GitHub 组织
    // 角色」自动回填——那条路径（access.resolve() 的 GitHub 调用）已经整段删掉，见 lib/access.ts 和
    // identity-store.ts 的 syncPermissionLevel 注释。旧库里的「GitHub 组织管理员」现在只是一个普通注册成员，
    // 要不要继续当站长，变成运维要显式决定的事：这里用新的、唯一的途径——identity.setSiteRole（控制台
    // 「成员与权限」页改角色走的也是这个函数）——把 alice 显式提成管理员，模拟升级后运维重新确认她的站长身份。
    const aliceAccountId = app.services.identity.accountForGithub(101);
    if (!aliceAccountId) throw new Error('alice should already have an account from the startup backfill');
    const grantAlice = app.services.identity.setSiteRole({ accountId: aliceAccountId, role: 'admin', actor: 'system' });
    if (!grantAlice.ok) throw new Error(`setSiteRole unexpectedly failed: ${grantAlice.reason}`);
    // 旧会话是建库时插进去的，created_at 是一天前，写接口要求的 step-up（刚登录过）过不了；这里用同一个
    // GitHub id 再登录一次换个新会话（这时 identities 表已经有这个 GitHub id，走的是「老账号登录」分支，
    // 不需要再传 orgRole），读接口两种会话都能用，写接口（PATCH 审核）只能用新会话。
    const me = await app.inject({ url: '/api/console/me', headers: as('legacy-session-alice') });
    expect(me.statusCode).toBe(200);
    expect(me.json()).toMatchObject({ login: 'alice', level: 'member', level_name: '极客班成员' });
    expect(me.json().titles).toEqual([expect.objectContaining({ id: 'title.site.owner' })]);
    expect(me.json().permissions).toEqual(expect.arrayContaining(['console.access', 'users.manage', 'apply.review']));
    const aliceLogin = app.services.identity.signInWithGithub({ github: { id: 101, login: 'alice', avatarUrl: null }, accessToken: 'token-alice' });
    if (!aliceLogin.ok) throw new Error('alice sign-in unexpectedly denied');

    const summary = await app.inject({ url: '/api/console/summary', headers: as('legacy-session-alice') });
    expect(summary.statusCode).toBe(200);
    expect(summary.json()).toMatchObject({ applications: { total: 0, last_7d: 0 }, feedback: { total: 2, open: 1 } });

    // 旧意见箱按 CONSOLE_ORG 原样可读，别的组织不外泄（feedback.ts 的鉴权节点变了，表和数据没变）。
    const feedback = (await app.inject({ url: '/api/console/feedback', headers: as('legacy-session-alice') })).json();
    expect(feedback.items.map((item: { content: string }) => item.content)).toEqual(['论坛能不能支持代码高亮？', '希望增加周末的线下分享。']);
    // 旧的 GET /api/console/audit 已删除（新的 /api/console/activity 读另一张表 activity_events，#274 Step D
    // 才开始写）；旧审计数据本身没丢、按 org 没有外泄，直接查库确认。
    const legacyAudit = db.prepare('SELECT action, details FROM audit_logs WHERE org = ? ORDER BY id DESC').all(CONSOLE_ORG) as { action: string; details: string | null }[];
    expect(legacyAudit.map(row => row.action)).toEqual(['feedback.update', 'invite_link.create']);
    expect(JSON.parse(legacyAudit[1].details!)).toEqual({ hours: 168, max_uses: 10 });

    // 新建的 applications / application_reviews 真能写：投递、列表、审核（外键指向刚建的 applications）。
    // #274：投递要登录、要有 apply.submit 权限，不再接受匿名投递；借用上面已经在线的旧会话。
    const apply = await app.inject({
      method: 'POST', url: '/api/portal/apply', headers: as('legacy-session-alice'),
      payload: { name: '测试同学', className: '计科2301', email: 'student@example.test', strengths: '做过课程设计的前后端，愿意参与社区维护。', pow: { timestamp: Date.now(), nonce: 'x' } },
    });
    expect(apply.statusCode).toBe(201);
    const applicationId = apply.json().id as string;
    const list = (await app.inject({ url: '/api/console/applications', headers: as('legacy-session-alice') })).json();
    expect(list).toMatchObject({ total: 1, counts: { received: 1 } });
    const review = await app.inject({
      method: 'PATCH', url: `/api/console/applications/${applicationId}`, headers: as(aliceLogin.sid),
      payload: { status: 'interview', expected_status: 'received', expected_review_id: 0, note: '周四面试', letter: { time: '9 月 30 日 19:00', place: '东校区 3 教 301' } },
    });
    expect(review.statusCode).toBe(200);
    expect(review.json().application.status).toBe('interview');
    // 测试没有配置发信商：信照样记一行，写成 mail_disabled，不留地址和正文
    expect(review.json().review.mail).toMatchObject({ status: 'skipped', skip_reason: 'mail_disabled' });
    expect(db.prepare('SELECT COUNT(*) AS n FROM mail_outbox WHERE recipient IS NOT NULL OR html IS NOT NULL').get()).toEqual({ n: 0 });
    expect(db.pragma('foreign_key_check')).toEqual([]);

    // 普通组织成员：和 alice 一样，站内角色现在只能显式设置，不再靠某个接口顺带触发的同步。
    const bobAccountId = app.services.identity.accountForGithub(102);
    if (!bobAccountId) throw new Error('bob should already have an account from the startup backfill');
    app.services.identity.setSiteRole({ accountId: bobAccountId, role: 'member', actor: 'system' });
    const bob = (await app.inject({ url: '/api/console/me', headers: as('legacy-session-bob') })).json();
    expect(bob).toMatchObject({ login: 'bob', level: 'member', titles: [] });
    expect(bob.permissions).not.toContain('console.access');

    // 站长按账号授权（#274 不再支持给「还没登录过的 GitHub 用户名」预先指派称号）：carol 先登录一次建好账号
    // （没有邀请码的全新 GitHub 账号，和旧库的 org_role 迁移无关），站长再把站长称号也给她——这一步替换旧的
    // 「指定舰长」，验证的是同一件事：提督授权之后自己仍是提督。
    const carolLogin = app.services.identity.signInWithGithub({ github: { id: 103, login: 'carol', avatarUrl: null }, accessToken: 'token-carol' });
    if (!carolLogin.ok) throw new Error('carol sign-in unexpectedly denied');
    const promote = await app.inject({
      method: 'PATCH', url: `/api/console/users/${carolLogin.accountId}`, headers: as(aliceLogin.sid), payload: { titles: ['title.site.owner'] },
    });
    expect(promote.statusCode).toBe(200);
    const after = (await app.inject({ url: '/api/console/me', headers: as(aliceLogin.sid) })).json();
    expect(after.titles).toEqual([expect.objectContaining({ id: 'title.site.owner' })]);
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
    // 默认部门与称号是 INSERT OR IGNORE：改过的不会被启动覆盖；显式舰长仍在，组织 owner 仍是提督。
    expect(second.services.roles.getDepartment('tech')?.description).toBe('班长改过的描述');
    expect(second.services.roles.captain()).toMatchObject({ github_login: 'carol', role: 'captain' });
    // #274 review round 1（blocker）：站长身份不再自动回填（见上面「keeps every legacy row」那条用例的说明），
    // 这里显式设一次，再用同一个旧会话查 /api/console/me。
    const aliceAccountId = second.services.identity.accountForGithub(101);
    if (!aliceAccountId) throw new Error('alice should already have an account from the startup backfill');
    second.services.identity.setSiteRole({ accountId: aliceAccountId, role: 'admin', actor: 'system' });
    const me = (await second.inject({ url: '/api/console/me', headers: as('legacy-session-alice') })).json();
    expect(me.titles).toEqual([expect.objectContaining({ id: 'title.site.owner' })]);
  });

  it('moves applications left in the retired 评估中 status back to 已收到 and keeps the review history', async () => {
    const path = legacyDatabase();
    const first = await boot(path);
    const { db } = first.services.storage;
    // #148 之前的库：一份投递停在 reviewing，审核记录里也有 reviewing
    const id = '0f1e2d3c-4b5a-4968-8776-a5b4c3d2e1f0';
    db.prepare("INSERT INTO applications(id, name, class_name, email, strengths, status, created_at) VALUES(?, '旧投递', '计科2301', 'old@example.test', '以前投的报名信，停在评估中。', 'reviewing', ?)").run(id, NOW - DAY);
    db.prepare("INSERT INTO application_reviews(application_id, from_status, to_status, note, reviewer, created_at) VALUES(?, 'received', 'reviewing', NULL, 'alice', ?)").run(id, NOW - DAY);
    await first.close();
    apps.splice(apps.indexOf(first), 1);

    const second = await boot(path);
    const upgraded = second.services.storage.db;
    expect(upgraded.prepare('SELECT status FROM applications WHERE id = ?').get(id)).toEqual({ status: 'received' });
    expect(upgraded.prepare('SELECT from_status, to_status FROM application_reviews WHERE application_id = ?').all(id)).toEqual([{ from_status: 'received', to_status: 'reviewing' }]);
    // #274 review round 1（blocker）：站长身份要显式设，见「keeps every legacy row」那条用例的说明。
    const aliceAccountId = second.services.identity.accountForGithub(101);
    if (!aliceAccountId) throw new Error('alice should already have an account from the startup backfill');
    second.services.identity.setSiteRole({ accountId: aliceAccountId, role: 'admin', actor: 'system' });
    const counts = (await second.inject({ url: '/api/console/applications', headers: as('legacy-session-alice') })).json().counts;
    expect(counts).toEqual({ received: 1, interview: 0, accepted: 0, rejected: 0, cancelled: 0 });
    // 再启动一次什么也不改
    await second.close();
    apps.splice(apps.indexOf(second), 1);
    const third = await boot(path);
    expect(third.services.storage.db.prepare('SELECT status FROM applications WHERE id = ?').get(id)).toEqual({ status: 'received' });
  });

  it('upgrades a stage-era database (departments, no seed marker) without re-adding deleted defaults', async () => {
    const path = legacyDatabase();
    const first = await boot(path);
    const { db } = first.services.storage;
    // 模拟本功能上线前的库：部门已经有了（删掉一个默认部门、加一个自建部门），但还没有 console_seeds 标记。
    first.services.roles.deleteDepartment('projects');
    first.services.roles.insertDepartment({ id: 'design', name: '设计部', tag: 'DESIGN', icon: 'idea', tone: 'rose', head_capabilities: [] });
    db.prepare("DELETE FROM console_seeds").run();
    await first.close();
    apps.splice(apps.indexOf(first), 1);

    const second = await boot(path);
    const ids = second.services.roles.listDepartments().map(item => item.id).sort();
    expect(ids).toEqual(['community', 'design', 'recruitment', 'tech']);
    expect(second.services.storage.db.prepare("SELECT name FROM console_seeds ORDER BY name").all()).toEqual([
      { name: 'competition_oss_2026_1' }, { name: 'competition_oss_2026_1_rules' }, { name: 'departments' }, { name: 'identity_v1' }, { name: 'legacy_github_v1' }, { name: 'legacy_github_v1_levels' }, { name: 'mail_templates_v1' },
    ]);
  });

  it('keeps cancelled applications and their complete review history across restarts', async () => {
    const path = legacyDatabase();
    const first = await boot(path);
    const id = '3b4c5d6e-7f80-4123-9456-7890abcdef12';
    first.services.storage.db.prepare("INSERT INTO applications(id, name, class_name, email, strengths, status, created_at) VALUES(?, '撤回同学', '计科2401', 'cancelled@example.test', '撤回的报名信也需要完整保留。', 'received', ?)").run(id, NOW - DAY);
    first.services.storage.db.prepare("INSERT INTO application_reviews(application_id, from_status, to_status, note, reviewer, created_at) VALUES(?, 'reviewing', 'received', '旧的审核历史', 'alice', ?)").run(id, NOW - DAY);
    const reviewId = (first.services.storage.db.prepare('SELECT MAX(id) AS id FROM application_reviews WHERE application_id = ?').get(id) as { id: number }).id;
    // #274 review round 1（blocker）：站长身份要显式设，见「keeps every legacy row」那条用例的说明。
    const aliceAccountId = first.services.identity.accountForGithub(101);
    if (!aliceAccountId) throw new Error('alice should already have an account from the startup backfill');
    first.services.identity.setSiteRole({ accountId: aliceAccountId, role: 'admin', actor: 'system' });
    // 旧会话建库时插的 created_at 是一天前，写接口要求的 step-up 过不了；用同一个 GitHub id 再登录一次换新会话。
    const firstLogin = first.services.identity.signInWithGithub({ github: { id: 101, login: 'alice', avatarUrl: null }, accessToken: 'token-alice' });
    if (!firstLogin.ok) throw new Error('alice sign-in unexpectedly denied');
    const result = await first.inject({
      method: 'PATCH', url: `/api/console/applications/${id}`, headers: as(firstLogin.sid),
      payload: { status: 'cancelled', expected_status: 'received', expected_review_id: reviewId, note: '投递人撤回' },
    });
    expect(result.statusCode).toBe(200);
    expect(result.json().review.mail).toBeNull();
    const application = first.services.storage.db.prepare('SELECT * FROM applications WHERE id = ?').get(id);
    const reviews = first.services.storage.db.prepare('SELECT * FROM application_reviews WHERE application_id = ? ORDER BY id').all(id);
    await first.close();
    apps.splice(apps.indexOf(first), 1);
    for (let restart = 0; restart < 2; restart++) {
      const current = await boot(path);
      const { db } = current.services.storage;
      expect(db.prepare('SELECT * FROM applications WHERE id = ?').get(id)).toEqual(application);
      expect(db.prepare('SELECT * FROM application_reviews WHERE application_id = ? ORDER BY id').all(id)).toEqual(reviews);
      await current.inject({ url: '/auth/me', headers: as('legacy-session-alice') });
      const list = await current.inject({ url: '/api/console/applications?status=cancelled', headers: as('legacy-session-alice') });
      expect(list.statusCode).toBe(200);
      expect(list.json()).toMatchObject({ total: 1, counts: { cancelled: 1 }, items: [{ id, status: 'cancelled' }] });
      expect(db.prepare('SELECT * FROM mail_outbox').all()).toEqual([]);
      expect(db.pragma('integrity_check', { simple: true })).toBe('ok');
      await current.close();
      apps.splice(apps.indexOf(current), 1);
    }
  });
});

/** 交付 1 的五条核对 SQL（docs/plan/UNIFIED-LOGIN.md「交付 1：回填」），PR 里贴的是同一份查询在升级前后的输出。 */
function identityChecks(db: import('better-sqlite3').Database, now: number) {
  const n = (sql: string, ...params: unknown[]) => (db.prepare(sql).get(...params) as { n: number }).n;
  return {
    sessions_unmapped: n('SELECT COUNT(*) AS n FROM sessions WHERE expires_at > ? AND openid IS NULL', now),
    assignments_left: n(`SELECT COUNT(*) AS n FROM role_assignments r JOIN identities i
      ON i.provider = 'github' AND CAST(i.provider_uid AS INTEGER) = r.github_user_id WHERE r.account_id IS NULL`),
    forum_left: n(`SELECT COUNT(*) AS n FROM forum_users f JOIN identities i
      ON i.provider = 'github' AND CAST(i.provider_uid AS INTEGER) = f.github_user_id WHERE f.account_id IS NULL`),
    duplicated_github: db.prepare("SELECT user_id FROM identities WHERE provider = 'github' GROUP BY user_id HAVING COUNT(*) <> 1").all(),
    accounts_without_github: n(`SELECT COUNT(*) AS n FROM users u WHERE NOT EXISTS
      (SELECT 1 FROM identities i WHERE i.user_id = u.id AND i.provider = 'github')`),
  };
}
const backfillReports = (db: import('better-sqlite3').Database) =>
  (db.prepare("SELECT actor, details FROM audit_logs WHERE action = 'identity.backfill' ORDER BY id").all() as { actor: string; details: string }[])
    .map(row => ({ actor: row.actor, ...JSON.parse(row.details) }));

describe('maps the existing sessions, titles and forum users to 极客班 accounts at boot (#262)', () => {
  it('backfills on upgrade, fills in what a rolled-back image wrote, and reruns without changes', async () => {
    const path = legacyDatabase();
    const legacy = new Database(path);
    const { encrypt } = createCrypto(ENCRYPTION_KEY);
    const oldSession = legacy.prepare('INSERT INTO sessions(id, login, user_id, avatar_url, access_token_encrypted, created_at, expires_at) VALUES(?, ?, ?, NULL, ?, ?, ?)');
    oldSession.run('legacy-session-no-id', 'ghost', null, encrypt('token-ghost'), NOW - DAY, NOW + DAY);     // 很早以前没有 GitHub id 的会话
    oldSession.run('legacy-session-expired', 'erin', 105, encrypt('token-erin'), NOW - 9 * DAY, NOW - DAY); // 已过期：不建号
    legacy.close();

    const first = await boot(path);
    const db1 = first.services.storage.db;
    // 每个未过期、有 GitHub id 的会话的主人各一个账号和一条 GitHub 身份；会话写上账号
    expect(backfillReports(db1)).toEqual([{ actor: 'system', users: 2, identities: 2, sessions_mapped: 2, sessions_unmapped: 1, assignments_claimed: 0, assignments_unclaimed: 0, forum_claimed: 0 }]);
    expect(db1.prepare("SELECT login, provider_uid FROM identities ORDER BY provider_uid").all()).toEqual([{ login: 'alice', provider_uid: '101' }, { login: 'bob', provider_uid: '102' }]);
    expect(db1.prepare("SELECT id, provider FROM sessions WHERE openid IS NOT NULL ORDER BY id").all()).toEqual([
      { id: 'legacy-session-alice', provider: 'github' }, { id: 'legacy-session-bob', provider: 'github' },
    ]);
    expect(identityChecks(db1, Date.now())).toEqual({ sessions_unmapped: 1, assignments_left: 0, forum_left: 0, duplicated_github: [], accounts_without_github: 0 });
    // 映射到账号的旧会话照常有效，三端读到同一个 account_id；没有 GitHub id 的旧会话按未登录处理并删掉
    const me = (await first.inject({ url: '/auth/me', headers: as('legacy-session-alice') })).json();
    expect(me).toMatchObject({ signed_in: true, login: 'alice', user_id: 101, provider: 'github' });
    expect(me.account_id).toBe((db1.prepare("SELECT user_id FROM identities WHERE provider_uid = '101'").get() as { user_id: string }).user_id);
    // 没有 GitHub id 映射不到账号，按访客处理（#274），不再是裸 { signed_in: false }
    expect((await first.inject({ url: '/auth/me', headers: as('legacy-session-no-id') })).json()).toMatchObject({ signed_in: false, level: 'visitor' });
    expect(db1.prepare("SELECT COUNT(*) AS n FROM sessions WHERE id = 'legacy-session-no-id'").get()).toEqual({ n: 0 });
    expect((await first.inject({ url: '/api/forum/state', headers: as('legacy-session-alice') })).statusCode).toBe(200);

    // 模拟回滚到旧镜像期间写的数据：旧代码只写旧列（新列都可空，插入不会失败）
    db1.prepare('INSERT INTO sessions(id, login, user_id, avatar_url, access_token_encrypted, created_at, expires_at) VALUES(?, ?, ?, NULL, ?, ?, ?)')
      .run('rollback-session-carol', 'carol', 103, encrypt('token-carol'), NOW, NOW + DAY);
    first.services.roles.insertAssignment({ github_login: 'carol', github_user_id: 103, role: 'head', department_id: 'tech', note: null, granted_by: 'alice' });
    first.services.roles.insertAssignment({ github_login: 'dave', github_user_id: null, role: 'member', department_id: '', note: null, granted_by: 'alice' });
    db1.prepare("UPDATE forum_users SET account_id = NULL WHERE github_user_id = 101").run();
    await first.close();
    apps.splice(apps.indexOf(first), 1);

    const second = await boot(path);
    const db2 = second.services.storage.db;
    // 再上线时同一段回填补上：carol 建号、会话映射、称号按 GitHub id 认领、论坛用户认领；没有 GitHub id 的称号不认领
    expect(backfillReports(db2).slice(1)).toEqual([{ actor: 'system', users: 1, identities: 1, sessions_mapped: 1, sessions_unmapped: 0, assignments_claimed: 1, assignments_unclaimed: 1, forum_claimed: 1 }]);
    expect(db2.prepare("SELECT github_login, account_id IS NOT NULL AS claimed FROM role_assignments ORDER BY github_login").all()).toEqual([
      { github_login: 'carol', claimed: 1 }, { github_login: 'dave', claimed: 0 },
    ]);
    expect(identityChecks(db2, Date.now())).toEqual({ sessions_unmapped: 0, assignments_left: 0, forum_left: 0, duplicated_github: [], accounts_without_github: 0 });
    await second.close();
    apps.splice(apps.indexOf(second), 1);
    const upgraded = snapshot(path);

    // 第三次启动没有可补的：不再写审计，identity_v1 只有一行，数据一行不变
    const third = await boot(path);
    const db3 = third.services.storage.db;
    expect(backfillReports(db3)).toHaveLength(2);
    expect(db3.prepare("SELECT COUNT(*) AS n FROM console_seeds WHERE name = 'identity_v1'").get()).toEqual({ n: 1 });
    for (const [table, rows] of Object.entries(upgraded.rows)) {
      expect(db3.prepare(`SELECT * FROM ${table} ORDER BY rowid`).all(), table).toEqual(rows);
    }
    expect(db3.prepare('SELECT COUNT(*) AS n FROM users').get()).toEqual({ n: 3 });
  });
});

describe('site roles of earlier accounts (#262 第四期)', () => {
  it('records invite-registered members of delivery 3 as site members at boot and leaves everyone else alone', async () => {
    const path = legacyDatabase();
    const first = await boot(path);
    const db1 = first.services.storage.db;
    const invite = first.services.invites.create({ code: 'yugc-legacy-2026', max_uses: null }, 'test');
    const insert = db1.prepare("INSERT INTO users(id, status, org_state, org_role, org_checked_at, handle, invite_code_id, created_at, updated_at) VALUES(?, 'active', ?, NULL, 0, ?, ?, 0, 0)");
    insert.run('01JINVITEDMEMBERAAAAAAAAAA', 'active', 'yz_invited1', invite.id);    // 第三期邀请码注册、还没记站内角色
    insert.run('01JINVITEDREMOVEDAAAAAAAAA', 'not_member', 'yz_invited2', invite.id); // 已被移出：不补
    insert.run('01JGITHUBUNRECORDEDAAAAAAA', 'active', 'yz_github01', null);         // 回填的老账号：等下次 GitHub 会话补记
    await first.close();
    apps.splice(apps.indexOf(first), 1);

    const second = await boot(path);
    expect(second.services.storage.db.prepare("SELECT id, org_state, org_role FROM users WHERE id LIKE '01J%' ORDER BY id").all()).toEqual([
      { id: '01JGITHUBUNRECORDEDAAAAAAA', org_state: 'active', org_role: null },
      { id: '01JINVITEDMEMBERAAAAAAAAAA', org_state: 'active', org_role: 'member' },
      { id: '01JINVITEDREMOVEDAAAAAAAAA', org_state: 'not_member', org_role: null },
    ]);
  });
});

describe('several emails per account (#272)', () => {
  it('redefines the one-login-per-provider index of #262 so an account can keep several emails, and keeps its name for a rolled-back image', async () => {
    const path = legacyDatabase();
    const first = await boot(path);
    const db1 = first.services.storage.db;
    // 上一个版本（#262）建的索引：每个账号每种登录方式只能一个，连邮箱也只能一个
    db1.exec('DROP INDEX uq_identities_user_provider; CREATE UNIQUE INDEX uq_identities_user_provider ON identities(user_id, provider);');
    db1.prepare("INSERT INTO users(id, status, org_state, created_at, updated_at) VALUES('01JEMAILSAAAAAAAAAAAAAAAAA', 'active', 'active', 0, 0)").run();
    const identity = db1.prepare("INSERT INTO identities(id, user_id, provider, provider_uid, email, email_verified, created_at) VALUES(?, '01JEMAILSAAAAAAAAAAAAAAAAA', ?, ?, ?, 1, 0)");
    identity.run('01JEMAILID1AAAAAAAAAAAAAAA', 'email', 'first@example.test', 'first@example.test');
    await first.close();
    apps.splice(apps.indexOf(first), 1);

    const second = await boot(path);
    const db2 = second.services.storage.db;
    const indexes = db2.prepare("SELECT name, sql FROM sqlite_master WHERE type = 'index' AND name LIKE 'uq_identities_%' ORDER BY name").all() as { name: string; sql: string }[];
    expect(indexes.map(row => row.name)).toEqual(['uq_identities_github_user', 'uq_identities_user_provider']);
    expect(indexes[1].sql).toMatch(/WHERE provider <> 'email'$/);
    const again = db2.prepare("INSERT INTO identities(id, user_id, provider, provider_uid, email, email_verified, created_at) VALUES(?, '01JEMAILSAAAAAAAAAAAAAAAAA', ?, ?, ?, 1, 0)");
    again.run('01JEMAILID2AAAAAAAAAAAAAAA', 'email', 'second@example.test', 'second@example.test');
    again.run('01JGOOGLEID1AAAAAAAAAAAAAA', 'google', 'google-sub-1', 'g@example.test');
    expect(() => again.run('01JGOOGLEID2AAAAAAAAAAAAAA', 'google', 'google-sub-2', 'h@example.test')).toThrow(/UNIQUE constraint failed/);
    expect(db2.prepare("SELECT COUNT(*) AS n FROM identities WHERE user_id = '01JEMAILSAAAAAAAAAAAAAAAAA' AND provider = 'email'").get()).toEqual({ n: 2 });
    // 换回 #262 的镜像：它的建索引语句因为同名索引已经在而跳过，两个邮箱都留着也能启动
    expect(() => db2.exec('CREATE UNIQUE INDEX IF NOT EXISTS uq_identities_user_provider ON identities(user_id, provider);')).not.toThrow();
  });
});

describe('relaxing forum_topics.visibility to a nullable column (#276)', () => {
  it('rebuilds the table without tripping the foreign key check, even with posts already pointing at the topic', () => {
    // 这是预发布库真实数据的样子：#274 建的 forum_topics.visibility 是 NOT NULL DEFAULT 'public'，
    // forum_posts.topic_id 是它的外键子表且已经有真实行引用——演练迁移时在这种数据上第一次跑就撞上
    // FOREIGN KEY constraint failed（SQLite 的已知限制：FK 检查开着时父表被 DROP，哪怕马上建回同名新表，
    // 子表还在引用也会被挡住）；db.ts 现在重建前先关 FK 检查、重建后用 foreign_key_check 核对没有悬空引用。
    const dir = mkdtempSync(join(tmpdir(), 'geek-legacy-forum-v2-'));
    dirs.push(dir);
    const path = join(dir, 'data.db');
    const raw = new Database(path);
    raw.pragma('foreign_keys = ON');
    raw.exec(`
      CREATE TABLE forum_users (
        id TEXT PRIMARY KEY, kind TEXT NOT NULL CHECK (kind IN ('member','guest','official')),
        github_user_id INTEGER UNIQUE, username TEXT NOT NULL UNIQUE COLLATE NOCASE, display_name TEXT NOT NULL,
        bio TEXT NOT NULL DEFAULT '', location TEXT NOT NULL DEFAULT '', website TEXT NOT NULL DEFAULT '',
        avatar_color TEXT NOT NULL, github_avatar_url TEXT, avatar_hash TEXT,
        role TEXT NOT NULL DEFAULT 'member' CHECK (role IN ('admin','moderator','member')), title TEXT,
        notify_reply INTEGER NOT NULL DEFAULT 1, notify_like INTEGER NOT NULL DEFAULT 1, notify_follow INTEGER NOT NULL DEFAULT 1,
        joined_at INTEGER NOT NULL, updated_at INTEGER NOT NULL
      );
      CREATE TABLE forum_topics (
        id TEXT PRIMARY KEY, slug TEXT NOT NULL, title TEXT NOT NULL, category_id TEXT NOT NULL,
        tag_ids TEXT NOT NULL DEFAULT '[]', author_id TEXT NOT NULL REFERENCES forum_users(id),
        created_at INTEGER NOT NULL, last_activity_at INTEGER NOT NULL, views INTEGER NOT NULL DEFAULT 0,
        pinned INTEGER NOT NULL DEFAULT 0, closed INTEGER NOT NULL DEFAULT 0,
        visibility TEXT NOT NULL DEFAULT 'public' CHECK (visibility IN ('public', 'registered', 'member'))
      );
      CREATE TABLE forum_posts (
        id TEXT PRIMARY KEY, topic_id TEXT NOT NULL REFERENCES forum_topics(id), author_id TEXT NOT NULL,
        content TEXT NOT NULL, created_at INTEGER NOT NULL
      );
      INSERT INTO forum_users(id, kind, username, display_name, avatar_color, joined_at, updated_at)
        VALUES('u-geekclass', 'official', 'geekclass', '极客班', '#2f6fed', 0, 0);
      INSERT INTO forum_topics(id, slug, title, category_id, author_id, created_at, last_activity_at)
        VALUES('t1', 'topic-1', '旧话题', 'c-ai', 'u-geekclass', 0, 0);
      INSERT INTO forum_posts(id, topic_id, author_id, content, created_at) VALUES('p1', 't1', 'u-geekclass', '正文', 0);
    `);
    raw.close();

    expect(() => createDatabase(path)).not.toThrow();
    const after = new Database(path, { readonly: true });
    const column = (after.pragma('table_info(forum_topics)') as { name: string; notnull: number }[]).find(c => c.name === 'visibility')!;
    expect(column.notnull).toBe(0);
    // 原来落了默认值 'public' 的行改成 NULL（跟随分类），不是继续显示一个没人真的设置过的 'public'。
    expect(after.prepare("SELECT visibility FROM forum_topics WHERE id = 't1'").get()).toEqual({ visibility: null });
    expect(after.prepare("SELECT id, topic_id FROM forum_posts WHERE id = 'p1'").get()).toEqual({ id: 'p1', topic_id: 't1' });
    expect(after.pragma('foreign_key_check')).toEqual([]);
    after.close();
  });
});

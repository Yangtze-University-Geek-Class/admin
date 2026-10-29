import { randomUUID } from 'node:crypto';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { computeAccess, DEFAULT_DEPARTMENTS, DEFAULT_TITLE_CONFIGS, LEGACY_TITLE_DESCRIPTIONS } from '../../app/server/src/lib/roles';
import { createRoleStore } from '../../app/server/src/lib/role-store';
import { accountIdOf, activityRows, grantPermGroup, grantPermNode, signIn, testApp } from './helpers';

const CONSOLE_ORG = 'Yangtze-University-Geek-Class';
const contexts: Awaited<ReturnType<typeof testApp>>[] = [];
afterEach(async () => { for (const c of contexts.splice(0)) await c.close(); });

function insertApplication(db: import('better-sqlite3').Database, patch: Record<string, unknown> = {}) {
  const row = {
    id: randomUUID(), name: '测试候选人', class_name: '计科2301', email: 'candidate@example.test',
    strengths: '熟悉 TypeScript，维护过一个开源小工具，愿意参与社区。', source_ip: '203.0.113.7', user_agent: 'fixture-agent/1.0',
    status: 'received', created_at: Date.now(), ...patch,
  };
  db.prepare('INSERT INTO applications(id, name, class_name, email, strengths, source_ip, user_agent, status, created_at) VALUES(@id, @name, @class_name, @email, @strengths, @source_ip, @user_agent, @status, @created_at)').run(row);
  return row;
}

/** #274 新权限体系的测试夹具：没有 GitHub 角色桩，权限直接用 grantPermNode/grantPermGroup 写进 perm_entries/perm_members。 */
const CONSOLE_USERS: Record<string, number> = { alice: 901, bob: 902, carol: 903, dave: 904, erin: 905, frank: 906, gina: 907 };
async function setupConsole() {
  const context = await testApp();
  contexts.push(context);
  const { app } = context;
  const sids = new Map<string, string>();
  const as = (login: string) => {
    if (!sids.has(login)) sids.set(login, signIn(app, login, CONSOLE_USERS[login]));
    return { cookie: `sid=${sids.get(login)}` };
  };
  // 先确保登录过（grantPermNode/grantPermGroup 按账号 id 写，账号 id 来自 sessions 表），再查账号 id。
  const accountId = (login: string) => { as(login); return accountIdOf(app, login); };
  // #274 item I：audit_logs 不再有人写，操作记录改读 activity_events；org 这一列对应的 GitHub 组织概念已经删掉，
  // 不再有等价字段（CONSOLE_ORG 之后只是个常量，不写进每一行操作记录里）。
  const audits = () => activityRows(app).map(row => ({ account_id: row.account_id, action: row.action, target: row.target_id, meta: row.meta }));
  return { app, as, accountId, audits, db: app.services.storage.db };
}

describe('GET /api/console/me、/api/console/summary（CONTRACT-274 §5、§7：按权限节点判定，取代旧的 site_role/capabilities 形状）', () => {
  it('rejects anonymous callers with 401', async () => {
    const { app } = await setupConsole();
    for (const url of ['/api/console/me', '/api/console/applications', '/api/console/feedback']) {
      const response = await app.inject(url);
      expect(response.statusCode).toBe(401);
      expect(response.json().error).toBe('not_signed_in');
    }
    // /api/console/users 没有单独挂 requireAuth 钩子，直接靠 requireScopedPermission 兜底判定登录态，回的 error 不一样。
    const users = await app.inject('/api/console/users');
    expect(users.statusCode).toBe(401);
    expect(users.json().error).toBe('unauthenticated');
  });

  it('刚登录、还没用邀请码的账号：注册等级、没有称号、拿不到 console.access', async () => {
    const { app, as } = await setupConsole();
    const me = (await app.inject({ url: '/api/console/me', headers: as('dave') })).json();
    expect(me).toMatchObject({ login: 'dave', level: 'registered', level_name: '注册用户', department: null, titles: [] });
    expect(me.permissions).not.toContain('console.access');
    const denied = await app.inject({ url: '/api/console/applications', headers: as('dave') });
    expect(denied.statusCode).toBe(403);
    expect(denied.json()).toEqual({ error: 'forbidden', node: 'apply.view', message: '需要「apply.view」权限' });
  });

  it('部门部长的 /me 带着范围内的节点，部门信息来自单独的部门分组（和称号分组是两回事）', async () => {
    const { app, as, accountId } = await setupConsole();
    const erinId = accountId('erin');
    grantPermGroup(app, erinId, 'dept.ai');
    grantPermGroup(app, erinId, 'title.ai.head');
    const me = (await app.inject({ url: '/api/console/me', headers: as('erin') })).json();
    expect(me.department).toMatchObject({ id: 'dept.ai', name: 'AI部门', tone: 'y' });
    expect(me.titles).toEqual([expect.objectContaining({ id: 'title.ai.head', department_id: 'dept.ai' })]);
    // console.access 是全站授权；users.view/apply.view/apply.review/activity.read 只在本部门范围内授权，
    // /me 靠 SCOPE_AWARE_NODES 把它们也并进 permissions，供前端判断导航显隐（见 routes/console/me.ts）。
    // dept.manage 不在这张清单里（#274 残留修复 J）：种子发了这个节点，但没有任何接口按它判定，放进
    // SCOPE_AWARE_NODES 只会让前端多出一个没有对应功能的导航项。
    expect(me.permissions).toEqual(expect.arrayContaining(['console.access', 'users.view', 'apply.view', 'apply.review', 'activity.read']));
    expect(me.permissions).not.toContain('apply.export');
    expect(me.permissions).not.toContain('dept.manage');
  });

  it('summary 只给有权限看的键', async () => {
    const { app, as, accountId, db } = await setupConsole();
    insertApplication(db);
    grantPermNode(app, accountId('alice'), 'apply.view');
    const ownerSummary = (await app.inject({ url: '/api/console/summary', headers: as('alice') })).json();
    expect(Object.keys(ownerSummary)).toEqual(['applications']);
    expect(ownerSummary.applications).toMatchObject({ total: 1, last_7d: 1 });

    expect((await app.inject({ url: '/api/console/summary', headers: as('bob') })).json()).toEqual({});

    grantPermNode(app, accountId('gina'), 'feedback.view');
    expect(Object.keys((await app.inject({ url: '/api/console/summary', headers: as('gina') })).json())).toEqual(['feedback']);
  });
});

describe('/auth/me console_link（CONTRACT-274 §1，review round 1 blocker：直接查 permissions.check(account, "console.access")，不再查 GitHub）', () => {
  it('shows the console link to accounts holding console.access (站长、部门部长), not to plain members or fresh registrations', async () => {
    const { app, as, accountId } = await setupConsole();
    grantPermGroup(app, accountId('alice'), 'title.site.owner');
    grantPermGroup(app, accountId('carol'), 'dept.ai');
    grantPermGroup(app, accountId('carol'), 'title.ai.head');
    // 普通舰员：用 setSiteRole 走真实的升级路径（直接塞 perm_members 会和 signIn() 默认给的 level.registered 并存）。
    app.services.identity.setSiteRole({ accountId: accountId('dave'), role: 'member', actor: 'system' });
    const me = async (login: string) => (await app.inject({ url: '/auth/me', headers: as(login) })).json();
    expect(await me('alice')).toMatchObject({ signed_in: true, login: 'alice', console_link: true });
    expect((await me('carol')).console_link).toBe(true);
    // 普通舰员（没有任何称号）、刚登录还没用邀请码的人都没有 console.access，看不到控制台入口。
    expect((await me('dave')).console_link).toBe(false);
    expect((await me('frank')).console_link).toBe(false);
    // 没登录按访客处理：仍是 200，带 level/permissions/quota，不再是裸 { signed_in: false }
    expect((await app.inject('/auth/me')).json()).toMatchObject({ signed_in: false, level: 'visitor' });
  });
});

describe('GET /api/console/applications 与审核（CONTRACT-274 §5：apply.view / apply.review / apply.export）', () => {
  it('lists applications with an exact field set and no source IP or user agent', async () => {
    const { app, as, accountId, db } = await setupConsole();
    grantPermNode(app, accountId('erin'), 'apply.view');
    insertApplication(db, { strengths: '长'.repeat(300), created_at: Date.now() - 1000 });
    insertApplication(db, { name: '另一位', email: 'other_1@example.test', status: 'interview' });
    const response = await app.inject({ url: '/api/console/applications', headers: as('erin') });
    expect(response.statusCode).toBe(200);
    const body = response.json();
    expect(body.total).toBe(2);
    expect(body.counts).toEqual({ received: 1, interview: 1, accepted: 0, rejected: 0, cancelled: 0 });
    expect(Object.keys(body.items[0]).sort()).toEqual(['class_name', 'created_at', 'email', 'id', 'last_review', 'name', 'status', 'strengths_excerpt']);
    expect(body.items[1].strengths_excerpt).toHaveLength(121);
    expect(response.body).not.toMatch(/203\.0\.113\.7|fixture-agent/);

    const searched = (await app.inject({ url: `/api/console/applications?q=${encodeURIComponent('other_')}`, headers: as('erin') })).json();
    expect(searched.items.map((item: { name: string }) => item.name)).toEqual(['另一位']);
    expect((await app.inject({ url: '/api/console/applications?q=%25', headers: as('erin') })).json().total).toBe(0);
    expect((await app.inject({ url: '/api/console/applications?status=interview&limit=1', headers: as('erin') })).json().items).toHaveLength(1);
  });

  it('部门部长（只有按部门限定的 apply.view/apply.review）能看列表、详情，也能审核（#274 残留修复 J.1）', async () => {
    const { app, as, accountId, db } = await setupConsole();
    grantPermGroup(app, accountId('dave'), 'title.ai.head'); // 种子只给这个节点按部门限定，没有任何人直接持有不限定的 apply.view/apply.review（除了站长的通配 `*`）
    const row = insertApplication(db);
    const list = await app.inject({ url: '/api/console/applications', headers: as('dave') });
    expect(list.statusCode).toBe(200); // 改之前 requirePermission 一律 403，部长完全看不到投递
    expect(list.json().total).toBe(1);
    expect((await app.inject({ url: `/api/console/applications/${row.id}`, headers: as('dave') })).statusCode).toBe(200);
    const review = await app.inject({
      method: 'PATCH', url: `/api/console/applications/${row.id}`, headers: as('dave'),
      payload: { status: 'interview', expected_status: 'received', expected_review_id: 0, notify: false },
    });
    expect(review.statusCode).toBe(200);
  });

  it('records a review in a transaction and keeps the note out of the audit log', async () => {
    const { app, as, accountId, audits, db } = await setupConsole();
    grantPermNode(app, accountId('erin'), 'apply.view');
    grantPermNode(app, accountId('erin'), 'apply.review');
    const row = insertApplication(db);
    const url = `/api/console/applications/${row.id}`;
    expect((await app.inject({ method: 'PATCH', url, headers: as('erin'), payload: { status: 'received' } })).json().error).toBe('no_change');

    const note = '一面表现不错，约二面时间';
    const response = await app.inject({ method: 'PATCH', url, headers: as('erin'), payload: { status: 'interview', expected_status: 'received', expected_review_id: 0, note, notify: false } });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({ application: { id: row.id, status: 'interview' }, review: { from_status: 'received', to_status: 'interview', note, reviewer: 'erin', mail: null } });
    const detail = (await app.inject({ url, headers: as('erin') })).json();
    expect(detail.application.strengths).toBe(row.strengths);
    expect(detail.application.source_ip).toBeUndefined();
    expect(detail.reviews).toHaveLength(1);

    const reviewAudit = audits().find(item => item.action === 'application.review')!;
    expect(reviewAudit.meta).toEqual({ from: 'received', to: 'interview', has_note: true, mail: false });
    expect(JSON.stringify(audits())).not.toContain(note);
    expect(audits().some(item => item.action === 'application.view')).toBe(true);
    expect((await app.inject({ url: `/api/console/applications/${randomUUID()}`, headers: as('erin') })).statusCode).toBe(404);
  });

  it('includes cancelled applications in filters, counts, summary and CSV', async () => {
    const { app, as, accountId, audits, db } = await setupConsole();
    grantPermNode(app, accountId('erin'), 'apply.view');
    grantPermNode(app, accountId('erin'), 'apply.review');
    grantPermNode(app, accountId('erin'), 'apply.export');
    const older = insertApplication(db, { name: '撤回甲', email: 'cancel_a@example.test', created_at: Date.now() - 1000 });
    const newer = insertApplication(db, { name: '撤回乙', email: 'cancel_b@example.test' });
    insertApplication(db, { name: '保留投递', email: 'active@example.test' });
    const headers = as('erin');
    for (const row of [older, newer]) {
      const result = await app.inject({
        method: 'PATCH', url: `/api/console/applications/${row.id}`, headers,
        payload: { status: 'cancelled', expected_status: 'received', expected_review_id: 0 },
      });
      expect(result.statusCode).toBe(200);
      expect(result.json().review.mail).toBeNull();
    }
    const counts = { received: 1, interview: 0, accepted: 0, rejected: 0, cancelled: 2 };
    const all = await app.inject({ url: '/api/console/applications', headers });
    expect(all.statusCode).toBe(200);
    expect(all.json()).toMatchObject({ total: 3, counts });
    const filtered = await app.inject({ url: '/api/console/applications?status=cancelled&limit=1&offset=1', headers });
    expect(filtered.statusCode).toBe(200);
    expect(filtered.json()).toMatchObject({ total: 2, counts, items: [{ id: older.id, status: 'cancelled', last_review: { to_status: 'cancelled', reviewer: 'erin' } }] });
    const searched = await app.inject({ url: '/api/console/applications?status=cancelled&q=cancel_b', headers });
    expect(searched.statusCode).toBe(200);
    expect(searched.json().items.map((item: { id: string }) => item.id)).toEqual([newer.id]);
    expect(searched.json().total).toBe(1);
    // summary 的 by_status 和列表接口的 counts 不是一回事：summary 只按实际出现的状态分组（不补 0），这里只有
    // received 和 cancelled 两种状态被用到。
    const summary = await app.inject({ url: '/api/console/summary', headers });
    expect(summary.statusCode).toBe(200);
    expect(summary.json().applications).toEqual({ total: 3, last_7d: 3, by_status: { received: 1, cancelled: 2 } });
    const csv = await app.inject({ url: '/api/console/applications/export.csv?status=cancelled', headers });
    expect(csv.statusCode).toBe(200);
    expect(csv.body).toContain('cancel_a@example.test');
    expect(csv.body).toContain('cancel_b@example.test');
    expect(csv.body).not.toContain('active@example.test');
    expect(csv.body.match(/,cancelled,/g)).toHaveLength(2);
    expect(audits().find(item => item.action === 'application.export')!.meta).toEqual({ count: 2, status: 'cancelled' });
  });

  it('requires review permission and the correct origin to cancel without changing data on denial', async () => {
    const { app, as, accountId, audits, db } = await setupConsole();
    grantPermNode(app, accountId('gina'), 'apply.view');
    as('bob');
    const row = insertApplication(db);
    const url = `/api/console/applications/${row.id}`;
    const payload = { status: 'cancelled', expected_status: 'received', expected_review_id: 0 };
    expect((await app.inject({ method: 'PATCH', url, payload })).statusCode).toBe(401);
    for (const login of ['bob', 'gina']) {
      const denied = await app.inject({ method: 'PATCH', url, payload, headers: as(login) });
      expect(denied.statusCode).toBe(403);
      expect(denied.json()).toMatchObject({ error: 'forbidden', node: 'apply.review' });
    }
    expect((await app.inject({ url, headers: as('gina') })).statusCode).toBe(200);
    const origin = await app.inject({ method: 'PATCH', url, payload, headers: { ...as('gina'), origin: 'https://foreign.example.test' } });
    expect(origin.statusCode).toBe(403);
    expect(origin.json().error).toBe('invalid_origin');
    expect(db.prepare('SELECT status FROM applications WHERE id = ?').get(row.id)).toEqual({ status: 'received' });
    expect(db.prepare('SELECT * FROM application_reviews').all()).toEqual([]);
    expect(db.prepare('SELECT * FROM mail_outbox').all()).toEqual([]);
    expect(audits().filter(item => item.action === 'application.review')).toEqual([]);
  });

  it('exports CSV with a BOM and neutralises spreadsheet formulas', async () => {
    const { app, as, accountId, audits, db } = await setupConsole();
    grantPermNode(app, accountId('gina'), 'apply.view');
    grantPermNode(app, accountId('erin'), 'apply.export');
    // 北京时间 9 月 27 日 01:05 投递的：CSV 里写北京时间，不写 UTC 的 26 日 17:05
    insertApplication(db, { name: '=cmd', strengths: '@SUM(A1), "quoted" 的特长描述', created_at: Date.UTC(2026, 8, 26, 17, 5) });
    expect((await app.inject({ url: '/api/console/applications/export.csv', headers: as('gina') })).json()).toMatchObject({ error: 'forbidden', node: 'apply.export' });
    // 文件名的日期也按北京时间：UTC 26 日 23:30 是北京时间 27 日 07:30
    const saved = process.env.TZ;
    process.env.TZ = 'UTC';
    const realNow = Date.now.bind(Date);
    let exporting = false;
    vi.spyOn(Date, 'now').mockImplementation(() => (exporting ? Date.UTC(2026, 8, 26, 23, 30) : realNow()));
    let response: Awaited<ReturnType<typeof app.inject>>;
    try {
      exporting = true;
      response = await app.inject({ url: '/api/console/applications/export.csv', headers: as('erin') });
    } finally {
      exporting = false;
      if (saved === undefined) delete process.env.TZ;
      else process.env.TZ = saved;
    }
    expect(response.statusCode).toBe(200);
    expect(response.headers['content-type']).toBe('text/csv; charset=utf-8');
    expect(response.headers['content-disposition']).toBe('attachment; filename="applications-20260927.csv"');
    expect(response.body.startsWith('﻿name,class_name,email,strengths,status,created_at_beijing\r\n')).toBe(true);
    expect(response.body).toContain(',received,2026-09-27 01:05:00\r\n');
    expect(response.body).toContain("'=cmd,");
    expect(response.body).toContain('"\'@SUM(A1), ""quoted"" 的特长描述"');
    expect(response.body).not.toContain('203.0.113.7');
    const exported = audits().find(item => item.action === 'application.export')!;
    expect(exported.meta).toEqual({ count: 1, status: null });
  });
});

describe('控制台意见箱（CONTRACT-274 §5：feedback.view / feedback.handle）', () => {
  it('serves the console feedback box for CONSOLE_ORG only and audits every write under it', async () => {
    const { app, as, accountId, audits, db } = await setupConsole();
    const now = Date.now();
    const insert = db.prepare('INSERT INTO feedback(org, content, status, source_ip, user_agent, created_at, updated_at) VALUES(?, ?, ?, ?, ?, ?, ?)');
    const ours = Number(insert.run(CONSOLE_ORG, '希望多一些项目复盘', 'open', '203.0.113.9', 'agent', now, now).lastInsertRowid);
    const theirs = Number(insert.run('other-org', '别的组织', 'open', null, null, now, now).lastInsertRowid);
    grantPermNode(app, accountId('gina'), 'feedback.view');
    grantPermNode(app, accountId('alice'), 'feedback.view');
    grantPermNode(app, accountId('alice'), 'feedback.handle');
    const listed = (await app.inject({ url: '/api/console/feedback', headers: as('gina') })).json();
    expect(listed.items.map((item: { id: number }) => item.id)).toEqual([ours]);
    expect(JSON.stringify(listed)).not.toContain('203.0.113.9');
    expect((await app.inject({ method: 'PATCH', url: `/api/console/feedback/${ours}`, headers: as('gina'), payload: { status: 'done' } })).statusCode).toBe(403);
    expect((await app.inject({ method: 'PATCH', url: `/api/console/feedback/${theirs}`, headers: as('alice'), payload: { status: 'done' } })).statusCode).toBe(404);
    expect((await app.inject({ method: 'PATCH', url: `/api/console/feedback/${ours}`, headers: as('alice'), payload: { status: 'done', reply: '已安排' } })).statusCode).toBe(200);
    expect((await app.inject({ method: 'DELETE', url: `/api/console/feedback/${ours}`, headers: as('alice') })).statusCode).toBe(200);
    // feedback.handle 那一条是上面 gina 那次 403（她没有这个权限）：http-policy.ts 的全局钩子记的，不是本条用例的写操作，
    // 但它也进同一张 activity_events（#274 残留修复 F），这里一并断言在，不单独过滤掉。
    expect(audits().filter(row => row.action.startsWith('feedback.')).map(row => row.action)).toEqual(['feedback.handle', 'feedback.update', 'feedback.delete']);
  });
});

describe('GET /api/console/departments 已删除（没有任何页面调用，部门名册由 /api/public/departments 提供）', () => {
  it('有 console.access 的账号也只得到 404', async () => {
    const { app, as, accountId } = await setupConsole();
    grantPermNode(app, accountId('bob'), 'console.access');
    expect((await app.inject({ url: '/api/console/departments', headers: as('bob') })).statusCode).toBe(404);
  });
});

describe('旧的 computeAccess（#274 范围外：/auth/me 的 console_link 和论坛旧能力展示仍在用，见上面的 console_link 块）', () => {
  it('keeps explicit alumni from also deriving the member title', () => {
    const access = computeAccess({
      login: 'gina', siteRole: 'member', departments: DEFAULT_DEPARTMENTS.map(item => ({ ...item, archived: false })),
      assignments: [{ id: 1, github_login: 'gina', github_user_id: 107, account_id: null, role: 'alumni', department_id: '', note: null, granted_by: 'x', created_at: 0 }],
    });
    expect(access.titles.map(title => title.label)).toEqual(['领航员']);
    // #276 挪来的 #274 清理：github.org.read 已经从 ROLE_BASE.alumni 删掉（github.* 能力整组零读者）。
    expect([...access.capabilities]).toEqual(['console.access', 'feedback.read']);
  });
});

describe('旧 titles 表的启动播种（#274 范围外：这张表只给旧能力系统的说明文案用，和权限节点的 title.* 分组无关）', () => {
  it('renews the old GitHub wording of the 提督 and 舰员 descriptions on boot and keeps edited ones (#262 第四期)', async () => {
    const { db } = await setupConsole();
    db.prepare("UPDATE titles SET description = ? WHERE id = 'admin'").run(LEGACY_TITLE_DESCRIPTIONS.admin);
    db.prepare("UPDATE titles SET description = '班长改过的说明' WHERE id = 'member'").run();
    createRoleStore(db);
    expect(db.prepare("SELECT id, description FROM titles WHERE id IN ('admin', 'member') ORDER BY id").all()).toEqual([
      { id: 'admin', description: DEFAULT_TITLE_CONFIGS.admin.description },
      { id: 'member', description: '班长改过的说明' },
    ]);
    expect(DEFAULT_TITLE_CONFIGS.admin.description).not.toMatch(/GitHub/);
  });
});

// #276 挪来的 #274 清理：原来这里的 describe('configuration') 测 CONSOLE_ORG 的环境变量读取与校验
// （含「部署可以配别的组织」这条能力）；CONSOLE_ORG 改成 config.ts 的固定常量 DEFAULT_CONSOLE_ORG 之后，
// 不再读环境变量、不再校验、也不可能配别的值，这条测试测的能力已经不存在，删掉而不是放宽断言。

import { randomUUID } from 'node:crypto';
import { afterEach, describe, expect, it } from 'vitest';
import type { ServiceOverrides } from '../../app/server/src/services';
import { createConfig } from '../../app/server/src/config';
import { CAPABILITY_IDS, computeAccess, DEFAULT_DEPARTMENTS } from '../../app/server/src/lib/roles';
import { testApp } from './helpers';

const CONSOLE_ORG = 'Yangtze-University-Geek-Class';
const contexts: Awaited<ReturnType<typeof testApp>>[] = [];
afterEach(async () => { for (const c of contexts.splice(0)) await c.close(); });

type Role = 'admin' | 'member';
/** 模拟 GitHub：成员角色表 + 用户 id 表；其它路由一律视为测试漏洞。 */
function github(roles: Record<string, Role>, users: Record<string, number> = {}, calls: string[] = []) {
  return (() => ({
    request: async (route: string, params: Record<string, string>) => {
      calls.push(`${route} ${params.org ?? ''} ${params.username}`);
      if (route === 'GET /orgs/{org}/memberships/{username}') {
        const role = params.org === CONSOLE_ORG ? roles[params.username.toLowerCase()] : undefined;
        if (!role) throw Object.assign(new Error('stub not found'), { status: 404 });
        return { data: { state: 'active', role } };
      }
      if (route === 'GET /orgs/{org}/members') {
        if (params.org !== CONSOLE_ORG) throw Object.assign(new Error('stub not found'), { status: 404 });
        const data = Object.entries(roles).filter(([, role]) => role === params.role)
          .map(([login]) => ({ login, id: users[login] ?? 0, avatar_url: `https://avatars.example.test/${login}` }));
        return { data };
      }
      if (route === 'GET /users/{username}') {
        const id = users[params.username.toLowerCase()];
        if (!id) throw Object.assign(new Error('stub not found'), { status: 404 });
        return { data: { login: params.username, id } };
      }
      throw new Error(`Unexpected GitHub call ${route}`);
    },
  })) as unknown as ServiceOverrides['octokitFactory'];
}

const USERS: Record<string, number> = { alice: 101, bob: 102, carol: 103, dave: 104, erin: 105, frank: 106, gina: 107 };
async function setup(roles: Record<string, Role> = {}, calls: string[] = []) {
  const context = await testApp({ octokitFactory: github(roles, USERS, calls) });
  contexts.push(context);
  const { app } = context;
  const as = (login: string) => ({ cookie: `sid=${app.services.auth.createSession(login, USERS[login] ?? null, null, `token-${login}`)}` });
  const assign = (login: string, role: 'captain' | 'head' | 'member' | 'alumni', department_id = '') =>
    app.services.roles.insertAssignment({ github_login: login, github_user_id: USERS[login] ?? null, role, department_id, note: null, granted_by: 'fixture' });
  const audits = () => app.services.storage.db.prepare('SELECT org, actor, action, target, details FROM audit_logs ORDER BY id').all() as { org: string | null; actor: string; action: string; target: string; details: string | null }[];
  return { app, as, assign, audits, db: app.services.storage.db };
}
function insertApplication(db: import('better-sqlite3').Database, patch: Record<string, unknown> = {}) {
  const row = {
    id: randomUUID(), name: '测试候选人', class_name: '计科2301', email: 'candidate@example.test',
    strengths: '熟悉 TypeScript，维护过一个开源小工具，愿意参与社区。', source_ip: '203.0.113.7', user_agent: 'fixture-agent/1.0',
    status: 'received', created_at: Date.now(), ...patch,
  };
  db.prepare('INSERT INTO applications(id, name, class_name, email, strengths, source_ip, user_agent, status, created_at) VALUES(@id, @name, @class_name, @email, @strengths, @source_ip, @user_agent, @status, @created_at)').run(row);
  return row;
}

describe('identity and capabilities', () => {
  it('rejects anonymous callers with 401 not_signed_in', async () => {
    const { app } = await setup();
    for (const url of ['/api/console/me', '/api/console/applications', '/api/console/catalogue']) {
      const response = await app.inject(url);
      expect(response.statusCode).toBe(401);
      expect(response.json().error).toBe('not_signed_in');
    }
  });

  it('makes a GitHub org owner the 提督 with every capability', async () => {
    const calls: string[] = [];
    const { app, as } = await setup({ alice: 'admin' }, calls);
    const response = await app.inject({ url: '/api/console/me', headers: as('alice') });
    expect(response.statusCode).toBe(200);
    const me = response.json();
    expect(me).toMatchObject({ login: 'alice', org: CONSOLE_ORG, github_role: 'admin', blocked: [] });
    expect(me).not.toHaveProperty('bootstrap');
    expect(me.title).toMatchObject({ id: 'admin', label: '提督', tag: 'ADMIRAL', tone: 'violet', source: 'github', assignment_id: null });
    expect(me.capabilities).toEqual(CAPABILITY_IDS);
    expect(calls.every(call => call.includes(CONSOLE_ORG))).toBe(true);
  });

  it('keeps org owners as 提督 above the explicitly appointed 舰长', async () => {
    const { app, as, assign } = await setup({ alice: 'admin', bob: 'admin', carol: 'member' });
    assign('carol', 'captain');
    const bob = (await app.inject({ url: '/api/console/me', headers: as('bob') })).json();
    expect(bob.title).toMatchObject({ id: 'admin', label: '提督' });
    expect(bob.capabilities).toEqual(CAPABILITY_IDS);
    const carol = (await app.inject({ url: '/api/console/me', headers: as('carol') })).json();
    expect(carol.title).toMatchObject({ id: 'captain', label: '舰长', source: 'assignment' });
  });

  it('gives a plain org member only console access and org read', async () => {
    const { app, as } = await setup({ bob: 'member' });
    const me = (await app.inject({ url: '/api/console/me', headers: as('bob') })).json();
    expect(me.capabilities).toEqual(['console.access', 'github.org.read']);
    expect(me.titles.map((title: { id: string }) => title.id)).toEqual(['member']);
  });

  it('treats a non-member without titles as a guest with no capabilities', async () => {
    const { app, as } = await setup();
    const me = (await app.inject({ url: '/api/console/me', headers: as('dave') })).json();
    expect(me).toMatchObject({ github_role: null, capabilities: [], blocked: [] });
    expect(me.title).toMatchObject({ id: 'guest', label: '乘客', source: 'none' });
    const denied = await app.inject({ url: '/api/console/catalogue', headers: as('dave') });
    expect(denied.statusCode).toBe(403);
    expect(denied.json()).toMatchObject({ error: 'missing_capability', capability: 'console.access' });
  });

  it('lets a non-admin recruitment head review applications while GitHub invites stay blocked', async () => {
    const { app, as, assign } = await setup({ erin: 'member' });
    assign('erin', 'head', 'recruitment');
    const me = (await app.inject({ url: '/api/console/me', headers: as('erin') })).json();
    expect(me.title).toMatchObject({ id: 'head', label: '招新部 · 队长', tone: 'coral', icon: 'user-follow', source: 'assignment' });
    expect(me.title.department).toMatchObject({ id: 'recruitment', name: '招新部' });
    expect(me.capabilities).toEqual(expect.arrayContaining(['applications.read', 'applications.review', 'applications.export', 'feedback.read', 'roles.department.manage']));
    expect(me.capabilities).not.toContain('github.invites.manage');
    expect(me.blocked).toEqual([{ capability: 'github.invites.manage', reason: 'github_admin_required' }]);
    expect(me.head_of).toEqual(['recruitment']);
  });

  it('blocks all GitHub capabilities for a head who is not in the organization', async () => {
    const { app, as, assign } = await setup();
    assign('frank', 'head', 'tech');
    const me = (await app.inject({ url: '/api/console/me', headers: as('frank') })).json();
    expect(me.capabilities).toEqual(['console.access', 'feedback.read', 'audit.read', 'roles.department.manage']);
    expect(me.blocked).toEqual(['github.org.read', 'github.repos.manage', 'github.teams.manage']
      .map(capability => ({ capability, reason: 'github_membership_required' })));
  });

  it('answers 403 missing_capability with the Chinese label and never treats a GitHub failure as non-membership', async () => {
    const { app, as } = await setup({ bob: 'member' });
    const denied = await app.inject({ url: '/api/console/applications', headers: as('bob') });
    expect(denied.statusCode).toBe(403);
    expect(denied.json()).toMatchObject({ error: 'missing_capability', capability: 'applications.read', any_of: ['applications.read'], message: '需要「查看投递」权限' });
    expect(denied.json().reason).toBeUndefined();

    const failing = (() => ({ request: async () => { throw Object.assign(new Error('upstream down'), { status: 502 }); } })) as unknown as ServiceOverrides['octokitFactory'];
    const broken = await testApp({ octokitFactory: failing }); contexts.push(broken);
    const sid = broken.app.services.auth.createSession('alice', 101, null, 'token');
    const response = await broken.app.inject({ url: '/api/console/me', headers: { cookie: `sid=${sid}` } });
    expect(response.statusCode).toBe(502);
    expect(response.json().error).toBe('internal_error');
  });

  it('keeps explicit alumni from also deriving the member title', () => {
    const access = computeAccess({
      login: 'gina', orgRole: 'member', captainExists: true, departments: DEFAULT_DEPARTMENTS.map(item => ({ ...item, archived: false })),
      assignments: [{ id: 1, github_login: 'gina', github_user_id: 107, role: 'alumni', department_id: '', note: null, granted_by: 'x', created_at: 0 }],
    });
    expect(access.titles.map(title => title.label)).toEqual(['领航员']);
    expect([...access.capabilities]).toEqual(['console.access', 'github.org.read', 'feedback.read']);
  });
});

describe('assignments', () => {
  it('rejects unknown fields and malformed bodies before persistence', async () => {
    const { app, as } = await setup({ alice: 'admin' });
    const headers = as('alice');
    const extra = await app.inject({ method: 'POST', url: '/api/console/assignments', headers, payload: { github_login: 'bob', role: 'member', admin: true } });
    expect(extra.statusCode).toBe(400);
    expect(extra.json().error).toBe('validation_error');
    expect((await app.inject({ url: '/api/console/applications?unexpected=1', headers })).statusCode).toBe(400);
    expect((await app.inject({ method: 'POST', url: '/api/console/assignments', headers, payload: { github_login: '-bad-', role: 'member' } })).statusCode).toBe(400);
    expect((await app.inject({ url: '/api/console/applications/not-a-uuid', headers })).statusCode).toBe(400);
  });

  it('reports department_required, department_not_allowed, unknown_department, github_user_not_found and assignment_exists', async () => {
    const { app, as, audits } = await setup({ alice: 'admin' });
    const headers = as('alice');
    const post = (payload: Record<string, unknown>) => app.inject({ method: 'POST', url: '/api/console/assignments', headers, payload });
    expect((await post({ github_login: 'bob', role: 'head' })).json().error).toBe('department_required');
    expect((await post({ github_login: 'bob', role: 'alumni', department_id: 'tech' })).json().error).toBe('department_not_allowed');
    expect((await post({ github_login: 'bob', role: 'head', department_id: 'marketing' })).json().error).toBe('unknown_department');
    expect((await post({ github_login: 'nobody', role: 'member' })).json().error).toBe('github_user_not_found');

    const created = await post({ github_login: 'Bob', role: 'head', department_id: 'tech', note: '技术部新负责人' });
    expect(created.statusCode).toBe(201);
    expect(created.json().assignment).toMatchObject({ github_login: 'bob', github_user_id: 102, role: 'head', department_id: 'tech', granted_by: 'alice' });
    const duplicate = await post({ github_login: 'bob', role: 'head', department_id: 'tech' });
    expect(duplicate.statusCode).toBe(409);
    expect(duplicate.json().error).toBe('assignment_exists');

    const assigned = audits().filter(row => row.action === 'role.assign');
    expect(assigned).toHaveLength(1);
    expect(assigned[0]).toMatchObject({ org: CONSOLE_ORG, actor: 'alice', target: 'bob' });
    expect(JSON.parse(assigned[0].details!)).toEqual({ role: 'head', department_id: 'tech', note_length: 7 });
  });

  it('transfers the captain in one transaction and enforces a single explicit captain', async () => {
    const { app, as, audits, db } = await setup({ alice: 'admin', bob: 'member' });
    const post = (headers: Record<string, string>, login: string) => app.inject({ method: 'POST', url: '/api/console/assignments', headers, payload: { github_login: login, role: 'captain' } });
    expect((await post(as('bob'), 'bob')).json().error).toBe('missing_capability');

    // 提督（组织 owner）指定舰长；有了舰长以后，提督照样可以换人。
    expect((await post(as('alice'), 'carol')).statusCode).toBe(201);
    expect((await app.inject({ url: '/api/console/me', headers: as('alice') })).json().title.id).toBe('admin');

    const transfer = await post(as('carol'), 'dave');
    expect(transfer.statusCode).toBe(201);
    expect(db.prepare("SELECT github_login FROM role_assignments WHERE role = 'captain'").all()).toEqual([{ github_login: 'dave' }]);
    const moved = audits().find(row => row.action === 'role.captain.transfer')!;
    expect(moved).toMatchObject({ org: CONSOLE_ORG, actor: 'carol' });
    expect(JSON.parse(moved.details!)).toEqual({ from: 'carol', to: 'dave' });
    expect(() => db.prepare("INSERT INTO role_assignments(github_login, role, department_id, granted_by, created_at) VALUES('erin', 'captain', '', 'x', 0)").run()).toThrow(/UNIQUE/);
  });

  it('lets the 提督 or the 舰长 themself remove the captain row, and nobody else', async () => {
    const { app, as, assign } = await setup({ alice: 'admin', bob: 'member', carol: 'member' });
    const captain = assign('carol', 'captain')!;
    assign('bob', 'head', 'tech');
    // 队长有 roles.department.manage，但撤不了舰长。
    const byHead = await app.inject({ method: 'DELETE', url: `/api/console/assignments/${captain.id}`, headers: as('bob') });
    expect(byHead.json().error).toBe('captain_transfer_required');
    const bySelf = await app.inject({ method: 'DELETE', url: `/api/console/assignments/${captain.id}`, headers: as('carol') });
    expect(bySelf.statusCode).toBe(200);
    const again = assign('carol', 'captain')!;
    const byAdmiral = await app.inject({ method: 'DELETE', url: `/api/console/assignments/${again.id}`, headers: as('alice') });
    expect(byAdmiral.statusCode).toBe(200);
    expect((await app.inject({ url: '/api/console/me', headers: as('carol') })).json().title.id).toBe('member');
  });

  it('confines a department head to appointing and removing crew of their own department', async () => {
    const { app, as, assign, audits } = await setup({ erin: 'member' });
    assign('erin', 'head', 'recruitment');
    const other = assign('gina', 'member', 'tech')!;
    const headers = as('erin');
    const post = (payload: Record<string, unknown>) => app.inject({ method: 'POST', url: '/api/console/assignments', headers, payload });

    const crew = await post({ github_login: 'frank', role: 'member', department_id: 'recruitment' });
    expect(crew.statusCode).toBe(201);
    expect((await post({ github_login: 'frank', role: 'member', department_id: 'tech' })).json().error).toBe('out_of_department_scope');
    expect((await post({ github_login: 'frank', role: 'head', department_id: 'recruitment' })).json()).toMatchObject({ error: 'missing_capability', capability: 'roles.manage' });
    expect((await post({ github_login: 'frank', role: 'member' })).json().error).toBe('out_of_department_scope');

    const listed = (await app.inject({ url: '/api/console/assignments', headers })).json();
    expect(listed.assignments.map((row: { department_id: string }) => row.department_id)).toEqual(['recruitment', 'recruitment']);
    expect((await app.inject({ url: '/api/console/assignments?department_id=tech', headers })).statusCode).toBe(403);

    expect((await app.inject({ method: 'DELETE', url: `/api/console/assignments/${other.id}`, headers })).json().error).toBe('out_of_department_scope');
    expect((await app.inject({ method: 'DELETE', url: `/api/console/assignments/${crew.json().assignment.id}`, headers })).statusCode).toBe(200);
    expect(audits().filter(row => row.action.startsWith('role.')).map(row => [row.org, row.action])).toEqual([[CONSOLE_ORG, 'role.assign'], [CONSOLE_ORG, 'role.revoke']]);
  });
});

describe('departments', () => {
  it('seeds four default departments and lets the captain add one without code changes', async () => {
    const { app, as, audits } = await setup({ alice: 'admin', bob: 'member' });
    const listed = (await app.inject({ url: '/api/console/departments', headers: as('bob') })).json().departments;
    expect(listed.map((item: { id: string }) => item.id)).toEqual(['recruitment', 'tech', 'community', 'projects']);
    expect(listed[0]).toMatchObject({ name: '招新部', heads: [], crew_count: 0, archived: false });

    const payload = { id: 'publicity', name: '宣传部', tag: 'PR', icon: 'bullhorn', tone: 'rose', head_capabilities: ['forum.topic.pin', 'forum.topic.pin', 'feedback.manage'] };
    expect((await app.inject({ method: 'POST', url: '/api/console/departments', headers: as('bob'), payload })).statusCode).toBe(403);
    const captainOnly = await app.inject({ method: 'POST', url: '/api/console/departments', headers: as('alice'), payload: { ...payload, head_capabilities: ['roles.manage'] } });
    expect(captainOnly.json().error).toBe('captain_only_capability');
    const created = await app.inject({ method: 'POST', url: '/api/console/departments', headers: as('alice'), payload });
    expect(created.statusCode).toBe(201);
    expect(created.json().department.head_capabilities).toEqual(['forum.topic.pin', 'feedback.manage']);
    expect((await app.inject({ method: 'POST', url: '/api/console/departments', headers: as('alice'), payload })).json().error).toBe('department_exists');
    expect((await app.inject({ method: 'POST', url: '/api/console/departments', headers: as('alice'), payload: { ...payload, id: 'x2', icon: 'crown' } })).statusCode).toBe(400);

    const patched = await app.inject({ method: 'PATCH', url: '/api/console/departments/publicity', headers: as('alice'), payload: { archived: true, name: '宣传部' } });
    expect(patched.statusCode).toBe(200);
    expect((await app.inject({ method: 'PATCH', url: '/api/console/departments/missing', headers: as('alice'), payload: { archived: true } })).statusCode).toBe(404);
    const update = audits().find(row => row.action === 'department.update')!;
    expect(update.org).toBe(CONSOLE_ORG);
    expect(JSON.parse(update.details!)).toEqual({ changed: ['archived'] });
    const after = (await app.inject({ url: '/api/console/departments', headers: as('bob') })).json().departments;
    expect(after.at(-1)).toMatchObject({ id: 'publicity', archived: true });
  });
});

describe('applications', () => {
  it('lists applications with an exact field set and no source IP or user agent', async () => {
    const { app, as, assign, db } = await setup({ erin: 'member' });
    assign('erin', 'head', 'recruitment');
    insertApplication(db, { strengths: '长'.repeat(300), created_at: Date.now() - 1000 });
    insertApplication(db, { name: '另一位', email: 'other_1@example.test', status: 'interview' });
    const response = await app.inject({ url: '/api/console/applications', headers: as('erin') });
    expect(response.statusCode).toBe(200);
    const body = response.json();
    expect(body.total).toBe(2);
    expect(body.counts).toEqual({ received: 1, reviewing: 0, interview: 1, accepted: 0, rejected: 0 });
    expect(Object.keys(body.items[0]).sort()).toEqual(['class_name', 'created_at', 'email', 'id', 'last_review', 'name', 'status', 'strengths_excerpt']);
    expect(body.items[1].strengths_excerpt).toHaveLength(121);
    expect(response.body).not.toMatch(/203\.0\.113\.7|fixture-agent/);

    const searched = (await app.inject({ url: `/api/console/applications?q=${encodeURIComponent('other_')}`, headers: as('erin') })).json();
    expect(searched.items.map((item: { name: string }) => item.name)).toEqual(['另一位']);
    expect((await app.inject({ url: '/api/console/applications?q=%25', headers: as('erin') })).json().total).toBe(0);
    expect((await app.inject({ url: '/api/console/applications?status=interview&limit=1', headers: as('erin') })).json().items).toHaveLength(1);
  });

  it('records a review in a transaction and keeps the note out of the audit log', async () => {
    const { app, as, assign, audits, db } = await setup({ erin: 'member' });
    assign('erin', 'head', 'recruitment');
    const row = insertApplication(db);
    const url = `/api/console/applications/${row.id}`;
    expect((await app.inject({ method: 'PATCH', url, headers: as('erin'), payload: { status: 'received' } })).json().error).toBe('no_change');

    const note = '一面表现不错，约二面时间';
    const response = await app.inject({ method: 'PATCH', url, headers: as('erin'), payload: { status: 'interview', note } });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({ application: { id: row.id, status: 'interview' }, review: { from_status: 'received', to_status: 'interview', note, reviewer: 'erin' } });
    const detail = (await app.inject({ url, headers: as('erin') })).json();
    expect(detail.application.strengths).toBe(row.strengths);
    expect(detail.application.source_ip).toBeUndefined();
    expect(detail.reviews).toHaveLength(1);

    const reviewAudit = audits().find(item => item.action === 'application.review')!;
    expect(reviewAudit.org).toBe(CONSOLE_ORG);
    expect(JSON.parse(reviewAudit.details!)).toEqual({ from: 'received', to: 'interview', has_note: true });
    expect(JSON.stringify(audits())).not.toContain(note);
    expect(audits().some(item => item.action === 'application.view' && item.org === CONSOLE_ORG)).toBe(true);
    expect((await app.inject({ url: `/api/console/applications/${randomUUID()}`, headers: as('erin') })).statusCode).toBe(404);
  });

  it('exports CSV with a BOM and neutralises spreadsheet formulas', async () => {
    const { app, as, assign, audits, db } = await setup({ gina: 'member', erin: 'member' });
    assign('gina', 'member', 'recruitment');
    assign('erin', 'head', 'recruitment');
    insertApplication(db, { name: '=cmd', strengths: '@SUM(A1), "quoted" 的特长描述' });
    expect((await app.inject({ url: '/api/console/applications/export.csv', headers: as('gina') })).json()).toMatchObject({ error: 'missing_capability', capability: 'applications.export' });
    const response = await app.inject({ url: '/api/console/applications/export.csv', headers: as('erin') });
    expect(response.statusCode).toBe(200);
    expect(response.headers['content-type']).toBe('text/csv; charset=utf-8');
    expect(response.headers['content-disposition']).toMatch(/^attachment; filename="applications-\d{8}\.csv"$/);
    expect(response.body.startsWith('﻿name,class_name,email,strengths,status,created_at\r\n')).toBe(true);
    expect(response.body).toContain("'=cmd,");
    expect(response.body).toContain('"\'@SUM(A1), ""quoted"" 的特长描述"');
    expect(response.body).not.toContain('203.0.113.7');
    const exported = audits().find(item => item.action === 'application.export')!;
    expect(exported.org).toBe(CONSOLE_ORG);
    expect(JSON.parse(exported.details!)).toEqual({ count: 1, status: null });
  });
});

describe('summary, feedback and audit', () => {
  it('returns only the summary keys the caller may read', async () => {
    const { app, as, assign, db } = await setup({ alice: 'admin', bob: 'member' });
    insertApplication(db);
    assign('gina', 'alumni');
    const captain = (await app.inject({ url: '/api/console/summary', headers: as('alice') })).json();
    expect(Object.keys(captain).sort()).toEqual(['applications', 'feedback', 'people']);
    expect(captain.applications).toMatchObject({ total: 1, last_7d: 1 });
    expect((await app.inject({ url: '/api/console/summary', headers: as('bob') })).json()).toEqual({});
    expect(Object.keys((await app.inject({ url: '/api/console/summary', headers: as('gina') })).json())).toEqual(['feedback']);
  });

  it('serves the console feedback box for CONSOLE_ORG only and audits every write under it', async () => {
    const { app, as, assign, audits, db } = await setup({ alice: 'admin' });
    const now = Date.now();
    const insert = db.prepare('INSERT INTO feedback(org, content, status, source_ip, user_agent, created_at, updated_at) VALUES(?, ?, ?, ?, ?, ?, ?)');
    const ours = Number(insert.run(CONSOLE_ORG, '希望多一些项目复盘', 'open', '203.0.113.9', 'agent', now, now).lastInsertRowid);
    const theirs = Number(insert.run('other-org', '别的组织', 'open', null, null, now, now).lastInsertRowid);
    assign('gina', 'alumni');
    const listed = (await app.inject({ url: '/api/console/feedback', headers: as('gina') })).json();
    expect(listed.items.map((item: { id: number }) => item.id)).toEqual([ours]);
    expect(JSON.stringify(listed)).not.toContain('203.0.113.9');
    expect((await app.inject({ method: 'PATCH', url: `/api/console/feedback/${ours}`, headers: as('gina'), payload: { status: 'done' } })).statusCode).toBe(403);
    expect((await app.inject({ method: 'PATCH', url: `/api/console/feedback/${theirs}`, headers: as('alice'), payload: { status: 'done' } })).statusCode).toBe(404);
    expect((await app.inject({ method: 'PATCH', url: `/api/console/feedback/${ours}`, headers: as('alice'), payload: { status: 'done', reply: '已安排' } })).statusCode).toBe(200);
    expect((await app.inject({ method: 'DELETE', url: `/api/console/feedback/${ours}`, headers: as('alice') })).statusCode).toBe(200);
    expect(audits().filter(row => row.action.startsWith('feedback.')).map(row => [row.org, row.action])).toEqual([[CONSOLE_ORG, 'feedback.update'], [CONSOLE_ORG, 'feedback.delete']]);
  });

  it('shows only CONSOLE_ORG audit rows and filters by action prefix', async () => {
    const { app, as, assign, db } = await setup({ alice: 'admin' });
    app.services.storage.audit(CONSOLE_ORG, 'alice', 'role.assign', 'bob', { role: 'member' }, '127.0.0.1');
    app.services.storage.audit(CONSOLE_ORG, 'alice', 'application.export', 'all', { count: 0 }, '127.0.0.1');
    app.services.storage.audit('other-org', 'mallory', 'role.assign', 'x', undefined, '198.51.100.1');
    app.services.storage.audit(null, 'alice', 'auth.signin', 'alice', undefined, '127.0.0.1');
    const logs = (await app.inject({ url: '/api/console/audit', headers: as('alice') })).json().logs;
    expect(logs.map((row: { action: string }) => row.action).sort()).toEqual(['application.export', 'role.assign']);
    expect((await app.inject({ url: '/api/console/audit?action=role.', headers: as('alice') })).json().logs).toHaveLength(1);
    expect((await app.inject({ url: '/api/console/audit?action=%25', headers: as('alice') })).json().logs).toHaveLength(0);
    assign('erin', 'head', 'recruitment');
    expect((await app.inject({ url: '/api/console/audit', headers: as('erin') })).statusCode).toBe(403);
    expect(db.prepare('SELECT COUNT(*) AS n FROM audit_logs').get()).toEqual({ n: 4 });
  });

  it('never hands a live invite-link token to an audit reader who is not a GitHub org admin', async () => {
    // frank 是技术部负责人（部门包里有 audit.read），但不在 GitHub 组织里：控制台不能让他拿到可用的邀请凭据。
    const { app, as, assign } = await setup({ alice: 'admin' });
    const created = await app.inject({ method: 'POST', url: `/api/admin/${CONSOLE_ORG}/invite-links`, headers: as('alice'), payload: { hours: 24, max_uses: 5 } });
    expect(created.statusCode).toBe(200);
    const token = created.json().token as string;
    app.services.storage.audit(CONSOLE_ORG, `public:${token}`, 'invite.sent', 'newcomer', { invitation_id: 7 }, '203.0.113.5');
    assign('frank', 'head', 'tech');

    const response = await app.inject({ url: '/api/console/audit', headers: as('frank') });
    expect(response.statusCode).toBe(200);
    const logs = response.json().logs as { action: string; actor: string; target: string }[];
    expect(logs.map(row => row.action).sort()).toEqual(['invite.sent', 'invite_link.create']);
    expect(response.body).not.toContain(token);
    expect(logs.find(row => row.action === 'invite_link.create')!.target).toBe(`${token.slice(0, 6)}…`);
    expect(logs.find(row => row.action === 'invite.sent')!.actor).toBe(`public:${token.slice(0, 6)}…`);
    // 旧入口只给组织管理员，他们本来就能列出链接，行为不变。
    expect((await app.inject({ url: `/api/admin/${CONSOLE_ORG}/logs`, headers: as('alice') })).body).toContain(token);
  });

  it('publishes the catalogue with the captain-only list and the navigator title', async () => {
    const { app, as } = await setup({ bob: 'member' });
    const catalogue = (await app.inject({ url: '/api/console/catalogue', headers: as('bob') })).json();
    expect(catalogue.captain_only).toEqual(['roles.manage']);
    expect(catalogue.titles.find((title: { id: string }) => title.id === 'alumni')).toMatchObject({ label: '领航员', tag: 'NAVIGATOR', icon: 'compass', tone: 'jade' });
    expect(catalogue.titles.find((title: { id: string }) => title.id === 'admin')).toMatchObject({ label: '提督', tag: 'ADMIRAL', rank: 0 });
    expect(catalogue.capabilities).toHaveLength(CAPABILITY_IDS.length);
    expect(catalogue.department_icons).not.toContain('crown');
  });
});

describe('titles are data the 提督 can edit', () => {
  it('renames a title and changes its permissions without touching code', async () => {
    const { app, as, assign, audits } = await setup({ alice: 'admin', bob: 'member' });
    assign('bob', 'alumni');
    const patch = (headers: Record<string, string>, id: string, payload: Record<string, unknown>) =>
      app.inject({ method: 'PATCH', url: `/api/console/titles/${id}`, headers, payload });
    const renamed = await patch(as('alice'), 'alumni', { label: '老船长', capabilities: ['console.access', 'github.org.read', 'feedback.read', 'audit.read'] });
    expect(renamed.statusCode).toBe(200);
    expect(renamed.json().title).toMatchObject({ id: 'alumni', label: '老船长' });
    const bob = (await app.inject({ url: '/api/console/me', headers: as('bob') })).json();
    expect(bob.title).toMatchObject({ id: 'alumni', label: '老船长' });
    expect(bob.capabilities).toContain('audit.read');
    const catalogue = (await app.inject({ url: '/api/console/catalogue', headers: as('bob') })).json();
    expect(catalogue.titles.find((title: { id: string }) => title.id === 'alumni').label).toBe('老船长');
    expect(catalogue.role_base.alumni).toContain('audit.read');
    const logged = audits().find(row => row.action === 'title.update')!;
    expect(logged).toMatchObject({ org: CONSOLE_ORG, actor: 'alice', target: 'alumni' });
    expect(JSON.parse(logged.details!)).toEqual({ changed: ['label', 'capabilities'] });
    // 公开的组织架构跟着变，不需要登录。
    const org = (await app.inject('/api/public/org')).json();
    expect(org.titles.find((title: { id: string }) => title.id === 'alumni')).toMatchObject({ label: '老船长', rank: 4 });
    expect(org.titles[0]).toMatchObject({ id: 'admin', label: '提督' });
    expect(org.titles[0]).not.toHaveProperty('capabilities');
    expect(org.tones.jade).toBe('#18694A');
    expect(org.departments.map((department: { id: string }) => department.id)).toEqual(['recruitment', 'tech', 'community', 'projects']);
  });

  it('keeps the 提督 at every capability, the 乘客 at none, and 管理称号 in the 舰长 bundle only', async () => {
    const { app, as, assign } = await setup({ alice: 'admin', carol: 'member' });
    assign('carol', 'captain');
    const patch = (id: string, payload: Record<string, unknown>) =>
      app.inject({ method: 'PATCH', url: `/api/console/titles/${id}`, headers: as('alice'), payload });
    expect((await patch('admin', { capabilities: ['console.access'] })).json().error).toBe('title_capabilities_fixed');
    expect((await patch('guest', { capabilities: ['console.access'] })).json().error).toBe('title_capabilities_fixed');
    expect((await patch('head', { capabilities: ['roles.manage'] })).json().error).toBe('captain_only_capability');
    // 提督的名字可以改，权限不会变少。
    expect((await patch('admin', { label: '总督' })).statusCode).toBe(200);
    const me = (await app.inject({ url: '/api/console/me', headers: as('alice') })).json();
    expect(me.title.label).toBe('总督');
    expect(me.capabilities).toEqual(CAPABILITY_IDS);
    // 舰长的权限由提督决定：拿掉「管理称号与部门」后，舰长就不能再改称号。
    expect((await patch('captain', { capabilities: ['console.access', 'github.org.read', 'feedback.read'] })).statusCode).toBe(200);
    const carol = (await app.inject({ url: '/api/console/me', headers: as('carol') })).json();
    expect(carol.title.id).toBe('captain');
    expect(carol.capabilities).not.toContain('roles.manage');
    const byCaptain = await app.inject({ method: 'PATCH', url: '/api/console/titles/member', headers: as('carol'), payload: { label: '水手' } });
    expect(byCaptain.statusCode).toBe(403);
  });

  it('refuses title edits without roles.manage and rejects unknown titles or fields', async () => {
    const { app, as, assign } = await setup({ alice: 'admin', bob: 'member' });
    assign('bob', 'head', 'tech');
    const byHead = await app.inject({ method: 'PATCH', url: '/api/console/titles/member', headers: as('bob'), payload: { label: '水手' } });
    expect(byHead.statusCode).toBe(403);
    expect(byHead.json()).toMatchObject({ error: 'missing_capability', capability: 'roles.manage' });
    expect((await app.inject({ method: 'PATCH', url: '/api/console/titles/pirate', headers: as('alice'), payload: { label: '海盗' } })).statusCode).toBe(400);
    expect((await app.inject({ method: 'PATCH', url: '/api/console/titles/member', headers: as('alice'), payload: { rank: 0 } })).statusCode).toBe(400);
    expect((await app.inject({ method: 'PATCH', url: '/api/console/titles/member', headers: as('alice'), payload: { label: '这个名字实在是太长了不行' } })).statusCode).toBe(400);
  });

  it('lists every org member with the title they would see, plus title holders who left the org', async () => {
    const { app, as, assign } = await setup({ alice: 'admin', bob: 'member', carol: 'member', dave: 'member' });
    assign('bob', 'head', 'tech');
    assign('carol', 'captain');
    assign('gina', 'alumni'); // 已不在组织里
    await app.inject({ method: 'PATCH', url: '/api/console/titles/member', headers: as('alice'), payload: { label: '水手' } });
    const response = await app.inject({ url: '/api/console/people', headers: as('alice') });
    expect(response.statusCode).toBe(200);
    const people = response.json().people as { login: string; github_role: string | null; titles: { id: string; label: string }[] }[];
    expect(people.map(p => [p.login, p.github_role, p.titles[0].id, p.titles[0].label])).toEqual([
      ['alice', 'admin', 'admin', '提督'],
      ['carol', 'member', 'captain', '舰长'],
      ['bob', 'member', 'head', '技术部 · 队长'],
      ['gina', null, 'alumni', '领航员'],
      ['dave', 'member', 'member', '水手'],
    ]);
    // 队长能看名单（任免本部门舰员要挑人）；只有组织成员身份的舰员不能。
    expect((await app.inject({ url: '/api/console/people', headers: as('bob') })).statusCode).toBe(200);
    expect((await app.inject({ url: '/api/console/people', headers: as('dave') })).statusCode).toBe(403);
  });

  it('keeps an edited title across a restart because defaults only fill empty rows', async () => {
    const { app, as } = await setup({ alice: 'admin' });
    await app.inject({ method: 'PATCH', url: '/api/console/titles/member', headers: as('alice'), payload: { label: '水手' } });
    // 重新建一次 role store（等于重启时的播种）不会把改过的名字盖回默认值。
    const { createRoleStore } = await import('../../app/server/src/lib/role-store');
    expect(createRoleStore(app.services.storage.db).titleConfigs().member.label).toBe('水手');
  });
});

describe('configuration', () => {
  const env = {
    NODE_ENV: 'test', PUBLIC_ORIGIN: 'https://example.test', DB_PATH: ':memory:',
    SESSION_SECRET: 'console-config-test-secret-at-least-32', ENCRYPTION_KEY: Buffer.alloc(32, 3).toString('base64'),
    OAUTH_CLIENT_ID: 'test-client', OAUTH_CLIENT_SECRET: 'test-secret',
  };
  it('defaults CONSOLE_ORG, validates its shape and requires it inside ALLOWED_ORGS', () => {
    expect(createConfig(env).consoleOrg).toBe(CONSOLE_ORG);
    expect(createConfig({ ...env, CONSOLE_ORG: 'other-org', ALLOWED_ORGS: 'Other-Org' }).consoleOrg).toBe('other-org');
    expect(() => createConfig({ ...env, CONSOLE_ORG: 'bad org' })).toThrow('CONSOLE_ORG');
    expect(() => createConfig({ ...env, ALLOWED_ORGS: 'someone-else' })).toThrow('ALLOWED_ORGS must include CONSOLE_ORG');
  });
});

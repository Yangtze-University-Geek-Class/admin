// 比赛（#238）：公开列表与控制台维护。公开接口不带成员信息，写入只在服务端按能力判定。
import { afterEach, describe, expect, it } from 'vitest';
import type { ServiceOverrides } from '../../app/server/src/services';
import { competitionStatus, compareCompetitions } from '../../app/server/src/lib/competition-store';
import { formFrom, formPayload } from '../../app/console/src/lib/competitions';
import { buildApp, type BuildAppOptions } from '../../app/server/src/app';
import { signIn, testApp, testConfig } from './helpers';

const CONSOLE_ORG = 'Yangtze-University-Geek-Class';
const contexts: Awaited<ReturnType<typeof testApp>>[] = [];
afterEach(async () => { for (const c of contexts.splice(0)) await c.close(); });

const USERS: Record<string, number> = { alice: 101, bob: 102 };
/** 只回答登录门槛要用的成员关系，别的调用一律视为测试漏洞。 */
function github(roles: Record<string, 'admin' | 'member'>) {
  return (() => ({
    request: async (route: string, params: Record<string, string>) => {
      if (route === 'GET /orgs/{org}/memberships/{username}') {
        const role = params.org === CONSOLE_ORG ? roles[params.username.toLowerCase()] : undefined;
        if (!role) throw Object.assign(new Error('stub not found'), { status: 404 });
        return { data: { state: 'active', role } };
      }
      throw new Error(`Unexpected GitHub call ${route}`);
    },
  })) as unknown as ServiceOverrides['octokitFactory'];
}

/** alice 是提督（全部能力），bob 是没登录管理的舰员（有 console.access，没有 competitions.manage）。 */
async function setup() {
  const context = await testApp({ octokitFactory: github({ alice: 'admin', bob: 'member' }) });
  contexts.push(context);
  const { app } = context;
  const as = (login: string) => ({ cookie: `sid=${signIn(app, login, USERS[login], null, `token-${login}`)}` });
  return { app, as };
}

const HOUR = 3600_000;
const BASE = Date.now() + 7 * 24 * HOUR;
const DRAFT = {
  name: '极客班算法赛', kind: 'internal' as const,
  start_at: BASE, end_at: BASE + 3 * HOUR,
  signup_deadline: BASE - 24 * HOUR, url: null as string | null, description: '班内选拔',
};

it('registers response contracts for competition and capability configuration operations', async () => {
  const routes: Parameters<NonNullable<BuildAppOptions['observeRoute']>>[0][] = [];
  const deny = () => { throw new Error('Unexpected external request'); };
  const app = await buildApp({
    config: testConfig({
      NODE_ENV: 'test', PUBLIC_ORIGIN: 'https://example.test', DB_PATH: ':memory:',
      SESSION_SECRET: 'isolated-core-test-secret-at-least-32', ENCRYPTION_KEY: Buffer.alloc(32, 1).toString('base64'),
      OAUTH_CLIENT_ID: 'test-client', OAUTH_CLIENT_SECRET: 'test-only-placeholder',
    }),
    staticRoot: false, observeRoute: route => { routes.push(route); },
    overrides: { octokitFactory: deny, httpRequest: deny, mailFetch: deny },
  });
  try {
    await app.ready();
    for (const [method, path, status] of [
      ['GET', '/api/public/competitions', 200],
      ['GET', '/api/console/competitions', 200],
      ['POST', '/api/console/competitions', 201],
      ['PATCH', '/api/console/competitions/:competition_id', 200],
      ['DELETE', '/api/console/competitions/:competition_id', 200],
      ['POST', '/api/console/departments', 201],
      ['PATCH', '/api/console/departments/:department_id', 200],
      ['PATCH', '/api/console/titles/:title_id', 200],
    ] as const) {
      const route = routes.find(item => item.url === path && [item.method].flat().includes(method));
      expect(route?.schema, `${method} ${path}`).toHaveProperty(`response.${status}`);
    }
  } finally {
    await app.close();
  }
});

describe('competition status and ordering', () => {
  const at = (start: number, end: number, deadline: number | null) => ({ start_at: start, end_at: end, signup_deadline: deadline });
  const NOW = 1_800_000_000_000;

  it('reads the phase off the clock, not off a stored column', () => {
    expect(competitionStatus(at(NOW + HOUR, NOW + 2 * HOUR, NOW + 30 * 60_000), NOW)).toBe('registering');
    // 报名截止了但还没开场：报不了名，还没开始
    expect(competitionStatus(at(NOW + HOUR, NOW + 2 * HOUR, NOW - 60_000), NOW)).toBe('closed');
    // 已开场、还能补报：报名中要压过进行中
    expect(competitionStatus(at(NOW - HOUR, NOW + HOUR, NOW + 30 * 60_000), NOW)).toBe('registering');
    expect(competitionStatus(at(NOW - HOUR, NOW + HOUR, NOW - 60_000), NOW)).toBe('ongoing');
    // 没有报名信息不能宣称正在接受报名；开赛前显示未开始。
    expect(competitionStatus(at(NOW + HOUR, NOW + 2 * HOUR, null), NOW)).toBe('upcoming');
  });

  it('treats the end timestamp as the boundary of "ended"', () => {
    expect(competitionStatus(at(NOW - 2 * HOUR, NOW, null), NOW)).toBe('ongoing');
    expect(competitionStatus(at(NOW - 2 * HOUR, NOW - 1, null), NOW)).toBe('ended');
  });

  it('puts what you can still catch above what is over, and is stable on ties', () => {
    const soon = { id: 'b', start_at: NOW + HOUR, end_at: NOW + 2 * HOUR };
    const later = { id: 'a', start_at: NOW + 10 * HOUR, end_at: NOW + 11 * HOUR };
    const over = { id: 'c', start_at: NOW - 5 * HOUR, end_at: NOW - HOUR };
    const justOver = { id: 'd', start_at: NOW - 2 * HOUR, end_at: NOW - HOUR };
    expect([later, over, soon, justOver].sort((x, y) => compareCompetitions(x, y, NOW)).map(r => r.id)).toEqual(['b', 'a', 'd', 'c']);
    expect(compareCompetitions(soon, { ...soon }, NOW)).toBe(0);
  });
});

describe('public list', () => {
  it('answers anonymous callers and hides offline competitions', async () => {
    const { app, as } = await setup();
    const created = await app.inject({ method: 'POST', url: '/api/console/competitions', headers: as('alice'), payload: DRAFT });
    expect(created.statusCode).toBe(201);
    // 给第二条更晚的开始时间：顺序就由时间决定，不靠 id 兜底，断言才是确定的
    const second = await app.inject({
      method: 'POST', url: '/api/console/competitions', headers: as('alice'),
      payload: {
        ...DRAFT, name: '校外赛', kind: 'external', url: 'https://example.test/contest',
        start_at: DRAFT.start_at + 30 * 24 * HOUR, end_at: DRAFT.end_at + 30 * 24 * HOUR, signup_deadline: DRAFT.signup_deadline + 30 * 24 * HOUR,
      },
    });
    expect(second.statusCode).toBe(201);

    const listed = await app.inject({ url: '/api/public/competitions' });
    expect(listed.statusCode).toBe(200);
    expect(listed.json().competitions.map((row: { name: string }) => row.name)).toEqual(['极客班算法赛', '校外赛']);
    // 公开形状里没有内部字段，也没有任何成员信息
    const row = listed.json().competitions[0];
    expect(Object.keys(row).sort()).toEqual(['description', 'end_at', 'id', 'kind', 'name', 'signup_deadline', 'start_at', 'status', 'url']);
    expect(JSON.stringify(listed.json())).not.toMatch(/offline|created_at|login|user_id/);

    // 下线之后公开列表不再返回，控制台仍看得到
    const id = created.json().competition.id;
    const offline = await app.inject({ method: 'PATCH', url: `/api/console/competitions/${id}`, headers: as('alice'), payload: { offline: true } });
    expect(offline.statusCode).toBe(200);
    const after = await app.inject({ url: '/api/public/competitions' });
    expect(after.json().competitions.map((row: { name: string }) => row.name)).toEqual(['校外赛']);
    const consoleList = await app.inject({ url: '/api/console/competitions', headers: as('alice') });
    expect(consoleList.json().competitions.map((row: { id: string }) => row.id)).toContain(id);
  });
});

describe('console writes need competitions.manage', () => {
  it('keeps capability configuration responses complete and grants competition access explicitly', async () => {
    const { app, as } = await setup();
    const before = await app.inject({ method: 'POST', url: '/api/console/competitions', headers: as('bob'), payload: DRAFT });
    expect(before.statusCode).toBe(403);
    const catalogue = (await app.inject({ url: '/api/console/catalogue', headers: as('alice') })).json();
    const granted = await app.inject({
      method: 'PATCH', url: '/api/console/titles/member', headers: as('alice'),
      payload: { capabilities: [...catalogue.role_base.member, 'competitions.manage'] },
    });
    expect(granted.statusCode).toBe(200);
    expect(Object.keys(granted.json().title).sort()).toEqual(['capabilities', 'description', 'icon', 'id', 'label', 'tag', 'tone']);
    expect(granted.json().title.capabilities).toContain('competitions.manage');
    expect((await app.inject({ method: 'POST', url: '/api/console/competitions', headers: as('bob'), payload: DRAFT })).statusCode).toBe(201);

    const created = await app.inject({
      method: 'POST', url: '/api/console/departments', headers: as('alice'),
      payload: { id: 'contests', name: '赛事部', tag: 'CONTEST', icon: 'trophy', tone: 'cobalt', head_capabilities: ['competitions.manage'] },
    });
    expect(created.statusCode).toBe(201);
    const readDepartment = async () => (await app.inject({ url: '/api/console/departments', headers: as('alice') })).json().departments.find((row: { id: string }) => row.id === 'contests');
    expect(created.json().department).toEqual(await readDepartment());
    expect(created.json().department).toMatchObject({ archived: false, heads: [], crew_count: 0, created_at: expect.any(Number), updated_at: expect.any(Number) });
    const updated = await app.inject({
      method: 'PATCH', url: '/api/console/departments/contests', headers: as('alice'),
      payload: { member_capabilities: ['competitions.manage'] },
    });
    expect(updated.statusCode).toBe(200);
    expect(updated.json().department).toEqual(await readDepartment());
    expect(updated.json().department.created_at).toBe(created.json().department.created_at);
  });

  it('rolls back competition writes when their audit record cannot be saved', async () => {
    const { app, as } = await setup();
    const created = await app.inject({ method: 'POST', url: '/api/console/competitions', headers: as('alice'), payload: DRAFT });
    const original = created.json().competition;
    app.services.storage.db.exec(`
      CREATE TRIGGER reject_competition_audit BEFORE INSERT ON audit_logs
      WHEN NEW.action LIKE 'competition.%'
      BEGIN SELECT RAISE(ABORT, 'injected audit failure'); END;
    `);
    for (const request of [
      { method: 'POST' as const, url: '/api/console/competitions', payload: { ...DRAFT, name: '不应留下的比赛' } },
      { method: 'PATCH' as const, url: `/api/console/competitions/${original.id}`, payload: { name: '不应生效的改名' } },
      { method: 'DELETE' as const, url: `/api/console/competitions/${original.id}` },
    ]) {
      expect((await app.inject({ ...request, headers: as('alice') })).statusCode).toBe(500);
      const listed = await app.inject({ url: '/api/public/competitions' });
      expect(listed.json().competitions).toEqual([expect.objectContaining({ id: original.id, name: original.name })]);
    }
  });

  it('preserves exact timestamps when the console edits only the description', async () => {
    const { app, as } = await setup();
    const created = await app.inject({ method: 'POST', url: '/api/console/competitions', headers: as('alice'), payload: {
      ...DRAFT,
      start_at: Date.parse('2026-10-18T19:00:00+08:00'),
      end_at: Date.parse('2026-10-18T21:00:00+08:00'),
      signup_deadline: Date.parse('2026-10-18T18:00:00+08:00'),
    } });
    const original = created.json().competition;
    const form = { ...formFrom(original), description: '更新场地说明' };
    const patch = formPayload(form, original);
    expect(patch).toEqual({ description: '更新场地说明' });
    const saved = await app.inject({ method: 'PATCH', url: `/api/console/competitions/${original.id}`, headers: as('alice'), payload: patch });
    expect(saved.statusCode).toBe(200);
    expect(saved.json().competition).toMatchObject({
      start_at: original.start_at, end_at: original.end_at, signup_deadline: original.signup_deadline,
      description: '更新场地说明',
    });
  });

  it('rejects invisible names and timestamps that cannot be displayed in Beijing time', async () => {
    const { app, as } = await setup();
    for (const payload of [
      { ...DRAFT, name: '   ' },
      { ...DRAFT, name: '  赛  ' },
      { ...DRAFT, name: '  𠮷  ' },
      { ...DRAFT, start_at: Number.MAX_SAFE_INTEGER, end_at: Number.MAX_SAFE_INTEGER },
      { ...DRAFT, end_at: 8_640_000_000_000_000 },
      { ...DRAFT, signup_deadline: Number.MAX_SAFE_INTEGER },
    ]) {
      const rejected = await app.inject({ method: 'POST', url: '/api/console/competitions', headers: as('alice'), payload });
      expect(rejected.statusCode).toBe(400);
    }
    expect((await app.inject({ url: '/api/public/competitions' })).json().competitions).toEqual([]);
    const created = await app.inject({ method: 'POST', url: '/api/console/competitions', headers: as('alice'), payload: { ...DRAFT, name: '  极客班算法赛  ' } });
    expect(created.json().competition.name).toBe('极客班算法赛');
    const id = created.json().competition.id;
    for (const payload of [{ name: '   ' }, { end_at: Number.MAX_SAFE_INTEGER }]) {
      expect((await app.inject({ method: 'PATCH', url: `/api/console/competitions/${id}`, headers: as('alice'), payload })).statusCode).toBe(400);
    }
    const renamed = await app.inject({ method: 'PATCH', url: `/api/console/competitions/${id}`, headers: as('alice'), payload: { name: '  极客班新比赛  ' } });
    expect(renamed.json().competition.name).toBe('极客班新比赛');
  });

  it('rejects malformed HTTPS links on creation and update for either kind', async () => {
    const { app, as } = await setup();
    for (const kind of ['internal', 'external']) {
      for (const url of ['https://?', 'https://#', 'https://[bad-host]']) {
        const rejected = await app.inject({ method: 'POST', url: '/api/console/competitions', headers: as('alice'), payload: { ...DRAFT, kind, url } });
        expect(rejected.statusCode).toBe(400);
        expect(rejected.json().error).toBe('bad_url');
      }
    }
    const created = await app.inject({ method: 'POST', url: '/api/console/competitions', headers: as('alice'), payload: { ...DRAFT, url: 'https://example.test/contest' } });
    const id = created.json().competition.id;
    const rejected = await app.inject({ method: 'PATCH', url: `/api/console/competitions/${id}`, headers: as('alice'), payload: { url: 'https://?' } });
    expect(rejected.statusCode).toBe(400);
    expect(rejected.json().error).toBe('bad_url');
    const listed = await app.inject({ url: '/api/public/competitions' });
    expect(listed.json().competitions).toHaveLength(1);
    expect(listed.json().competitions[0].url).toBe('https://example.test/contest');
  });

  it('refuses an unauthenticated caller and a member without the capability', async () => {
    const { app, as } = await setup();
    const anonymous = await app.inject({ method: 'POST', url: '/api/console/competitions', payload: DRAFT });
    expect(anonymous.statusCode).toBe(401);
    expect(anonymous.json().error).toBe('not_signed_in');

    const member = await app.inject({ method: 'POST', url: '/api/console/competitions', headers: as('bob'), payload: DRAFT });
    expect(member.statusCode).toBe(403);
    expect(member.json()).toMatchObject({ error: 'missing_capability', capability: 'competitions.manage' });
    // 舰员连读都要 console.access，这里他确实有；确认没有写入发生
    expect((await app.inject({ url: '/api/console/competitions', headers: as('bob') })).json().competitions).toEqual([]);
  });

  it('rejects an end before the start and a deadline after the end', async () => {
    const { app, as } = await setup();
    const badRange = await app.inject({ method: 'POST', url: '/api/console/competitions', headers: as('alice'), payload: { ...DRAFT, start_at: DRAFT.end_at, end_at: DRAFT.start_at } });
    expect(badRange.statusCode).toBe(400);
    expect(badRange.json().error).toBe('bad_range');

    const badDeadline = await app.inject({ method: 'POST', url: '/api/console/competitions', headers: as('alice'), payload: { ...DRAFT, signup_deadline: DRAFT.end_at + HOUR } });
    expect(badDeadline.statusCode).toBe(400);
    expect(badDeadline.json().error).toBe('deadline_after_end');
  });

  it('judges the range against the merged record, not just the patch', async () => {
    const { app, as } = await setup();
    const created = await app.inject({ method: 'POST', url: '/api/console/competitions', headers: as('alice'), payload: DRAFT });
    const id = created.json().competition.id;
    // 只改开始时间、且推到结束时间之后：结束时间取库里的，应当被拒
    const bad = await app.inject({ method: 'PATCH', url: `/api/console/competitions/${id}`, headers: as('alice'), payload: { start_at: DRAFT.end_at + HOUR } });
    expect(bad.statusCode).toBe(400);
    expect(bad.json().error).toBe('bad_range');
    // 合法的一次改动：改名
    const ok = await app.inject({ method: 'PATCH', url: `/api/console/competitions/${id}`, headers: as('alice'), payload: { name: '极客班算法赛（第二届）' } });
    expect(ok.statusCode).toBe(200);
    expect(ok.json().competition).toMatchObject({ name: '极客班算法赛（第二届）', kind: 'internal' });
  });

  it('keeps the url across a kind change: every competition may have its own site', async () => {
    const { app, as } = await setup();
    // 内部比赛也能挂自己的比赛官网（#238）：kind 与 url 互不影响
    const internal = await app.inject({ method: 'POST', url: '/api/console/competitions', headers: as('alice'), payload: { ...DRAFT, kind: 'internal', url: 'https://example.test/internal-site' } });
    expect(internal.statusCode).toBe(201);
    expect(internal.json().competition).toMatchObject({ kind: 'internal', url: 'https://example.test/internal-site' });
    const id = internal.json().competition.id;
    const changed = await app.inject({ method: 'PATCH', url: `/api/console/competitions/${id}`, headers: as('alice'), payload: { kind: 'external' } });
    expect(changed.json().competition).toMatchObject({ kind: 'external', url: 'https://example.test/internal-site' });
    // 表上只约束「填了必须是 https」
    expect((await app.inject({ method: 'POST', url: '/api/console/competitions', headers: as('alice'), payload: { ...DRAFT, kind: 'internal', url: 'http://example.test/x' } })).statusCode).toBe(400);
  });

  it('clears the url with an explicit null, and keeps it when the patch omits it', async () => {
    const { app, as } = await setup();
    const created = await app.inject({ method: 'POST', url: '/api/console/competitions', headers: as('alice'), payload: { ...DRAFT, kind: 'external', url: 'https://example.test/contest' } });
    const id = created.json().competition.id;
    // 合同允许显式传 null：外部比赛要能清掉官方链接，而不是把 null 当成「没给」
    const cleared = await app.inject({ method: 'PATCH', url: `/api/console/competitions/${id}`, headers: as('alice'), payload: { url: null } });
    expect(cleared.json().competition.url).toBeNull();
    // 别的字段：没给就保持原值，不会被同一次改动顺手清掉
    const renamed = await app.inject({ method: 'PATCH', url: `/api/console/competitions/${id}`, headers: as('alice'), payload: { name: '改个名' } });
    expect(renamed.json().competition).toMatchObject({ name: '改个名', kind: 'external', url: null });
  });

  it('deletes for real, answers 404 the second time, and audits every write', async () => {
    const { app, as } = await setup();
    const created = await app.inject({ method: 'POST', url: '/api/console/competitions', headers: as('alice'), payload: DRAFT });
    const id = created.json().competition.id;
    const first = await app.inject({ method: 'DELETE', url: `/api/console/competitions/${id}`, headers: as('alice') });
    expect(first.statusCode).toBe(200);
    expect(first.json()).toEqual({ ok: true });
    expect((await app.inject({ method: 'DELETE', url: `/api/console/competitions/${id}`, headers: as('alice') })).statusCode).toBe(404);

    const actions = (app.services.storage.db.prepare("SELECT action FROM audit_logs WHERE action LIKE 'competition.%' ORDER BY id").all() as { action: string }[]).map(row => row.action);
    expect(actions).toEqual(['competition.create', 'competition.delete']);
  });

  it('rejects unknown fields and a non-https url', async () => {
    const { app, as } = await setup();
    expect((await app.inject({ method: 'POST', url: '/api/console/competitions', headers: as('alice'), payload: { ...DRAFT, offline: true } })).statusCode).toBe(400);
    expect((await app.inject({ method: 'POST', url: '/api/console/competitions', headers: as('alice'), payload: { ...DRAFT, kind: 'external', url: 'http://example.test/x' } })).statusCode).toBe(400);
  });
});

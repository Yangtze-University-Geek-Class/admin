import { STATIC_CDN_ORIGIN as CDN_ORIGIN } from '../static-cdn-fixture';
// 比赛（#238）：公开列表与控制台维护。公开接口不带成员信息，写入只在服务端按能力判定。
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import type { ServiceOverrides } from '../../app/server/src/services';
import { competitionStatus, compareCompetitions, createCompetitionStore, newCompetitionId } from '../../app/server/src/lib/competition-store';
import { createDatabase } from '../../app/server/src/lib/db';
import { formFrom, formPayload } from '../../app/console/src/lib/competitions';
import { buildApp, type BuildAppOptions } from '../../app/server/src/app';
import { accountIdOf, activityRows, grantPermGroup, signIn, testApp, testConfig } from './helpers';

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

/** alice 是提督（全部能力），bob 是没登录管理的舰员（有 console.access，没有 competitions.manage）。
 * #274：站长身份按新权限体系的 perm_members 判定，不再靠 GitHub 组织角色桩动态认出，显式放进 title.site.owner。 */
async function setup() {
  const context = await testApp({ octokitFactory: github({ alice: 'admin', bob: 'member' }) });
  contexts.push(context);
  const { app } = context;
  const as = (login: string) => ({ cookie: `sid=${signIn(app, login, USERS[login], null, `token-${login}`)}` });
  signIn(app, 'alice', USERS.alice); // 先建号，才能查到 account_id 去加站长组
  grantPermGroup(app, accountIdOf(app, 'alice'), 'title.site.owner');
  return { app, as };
}

const HOUR = 3600_000;
const BASE = Date.now() + 7 * 24 * HOUR;
const DRAFT = {
  name: '极客班算法赛', kind: 'internal' as const,
  start_at: BASE, end_at: BASE + 3 * HOUR,
  signup_deadline: BASE - 24 * HOUR, url: null as string | null, description: '班内选拔',
};

/** #239 的种子比赛（报名与积分演练用）：这里只关心本用例造的比赛，按 id 排除，不删用例。 */
const SEED_COMPETITION_ID = 'oss-challenge-2026-1';
const own = <T extends { id: string }>(rows: T[]) => rows.filter(row => row.id !== SEED_COMPETITION_ID);

it('registers response contracts for competition and capability configuration operations', async () => {
  const routes: Parameters<NonNullable<BuildAppOptions['observeRoute']>>[0][] = [];
  const deny = () => { throw new Error('Unexpected external request'); };
  const app = await buildApp({
    config: testConfig({
      NODE_ENV: 'test', PUBLIC_ORIGIN: 'https://example.test', STATIC_CDN_ORIGIN: CDN_ORIGIN, DB_PATH: ':memory:',
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
      // #274 删掉了 /api/console/departments 的写路由和 /api/console/titles/:title_id；换成同样「创建/编辑一个
      // 控制台配置资源」形状的权限组与用户接口，验证同一套 registerContracts 合并机制。
      ['POST', '/api/console/permission-groups', 201],
      ['PATCH', '/api/console/permission-groups/:id', 200],
      ['PATCH', '/api/console/users/:id', 200],
    ] as const) {
      const route = routes.find(item => item.url === path && [item.method].flat().includes(method));
      expect(route?.schema, `${method} ${path}`).toHaveProperty(`response.${status}`);
    }
  } finally {
    await app.close();
  }
});

describe('competition status and ordering', () => {
  const at = (start: number, end: number, deadline: number | null, planning = false) => ({ start_at: start, end_at: end, signup_deadline: deadline, planning });
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

  // 规划中（#278，所有者 2026-10-25 01:03）：开赛前压过未开始/报名中/报名已截止；一过开赛时间就不再生效，
  // 照原有规则走进行中/已结束，不会把已经开赛的比赛卡在「规划中」。
  it('planning overrides the pre-start phases, but stops mattering once the start time passes', () => {
    // 开赛前：即使报名截止时间还没到（本来该是「报名中」），规划中照样压过去
    expect(competitionStatus(at(NOW + HOUR, NOW + 2 * HOUR, NOW + 30 * 60_000, true), NOW)).toBe('planning');
    // 开赛前、没登记报名截止（本来该是「未开始」），规划中照样压过去
    expect(competitionStatus(at(NOW + HOUR, NOW + 2 * HOUR, null, true), NOW)).toBe('planning');
    // 到了开赛那一刻，规划中就不再生效了：按原有规则算成进行中
    expect(competitionStatus(at(NOW - HOUR, NOW + HOUR, null, true), NOW)).toBe('ongoing');
    // 已经结束：同样按原有规则，不会被规划中标记卡住
    expect(competitionStatus(at(NOW - 2 * HOUR, NOW - HOUR, null, true), NOW)).toBe('ended');
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
    expect(own(listed.json().competitions).map((row: { name: string }) => row.name)).toEqual(['极客班算法赛', '校外赛']);
    // 公开形状里没有内部字段，也没有任何成员信息；每场多一个报名摘要（#239），不含报名人数；
    // #278 加官网地址、门户深链、奖项、年级系数、两档计分表与定榜时间；规划中（#278 重开）要给，官网本地重算
    // 状态要用到它
    const row = own(listed.json().competitions)[0];
    expect(Object.keys(row).sort()).toEqual([
      'app_url', 'description', 'end_at', 'finalized_at', 'grade_factors', 'id', 'kind', 'name', 'planning', 'prizes',
      'scoring', 'signup', 'signup_deadline', 'site_url', 'start_at', 'status', 'url',
    ]);
    expect(row).toMatchObject({ site_url: null, prizes: [], finalized_at: null, planning: false });
    expect(row.app_url).toBe(`/?open=competitions&competition=${encodeURIComponent(row.id)}`);
    expect(row.signup).toEqual({ enabled: false, participation: 'individual', team_min: 1, team_max: 1, scoring: 'none' });
    expect(JSON.stringify(listed.json())).not.toMatch(/offline|created_at|login|user_id/);

    // 下线之后公开列表不再返回，控制台仍看得到
    const id = created.json().competition.id;
    const offline = await app.inject({ method: 'PATCH', url: `/api/console/competitions/${id}`, headers: as('alice'), payload: { offline: true } });
    expect(offline.statusCode).toBe(200);
    const after = await app.inject({ url: '/api/public/competitions' });
    expect(own(after.json().competitions).map((row: { name: string }) => row.name)).toEqual(['校外赛']);
    const consoleList = await app.inject({ url: '/api/console/competitions', headers: as('alice') });
    expect(consoleList.json().competitions.map((row: { id: string }) => row.id)).toContain(id);
  });
});

describe('console writes need competitions.manage', () => {
  it('keeps permission group responses complete and grants competition access through a custom group, not a blanket title edit', async () => {
    const { app, as } = await setup();
    const before = await app.inject({ method: 'POST', url: '/api/console/competitions', headers: as('bob'), payload: DRAFT });
    expect(before.statusCode).toBe(403);
    expect(before.json()).toMatchObject({ error: 'forbidden', node: 'competition.manage' });

    // #274：称号的权限包（旧 PATCH /api/console/titles/:title_id）已经删掉，新系统按权限组授权；
    // 自定义组 + 一条 competition.manage 条目，只加给 bob，不像旧的「给 member 称号整体加能力」那样影响所有成员。
    const created = await app.inject({
      method: 'POST', url: '/api/console/permission-groups', headers: as('alice'),
      payload: { id: 'custom.contest_crew', name: '赛事干事', weight: 10 },
    });
    expect(created.statusCode).toBe(201);
    expect(Object.keys(created.json()).sort()).toEqual([
      'department_id', 'description', 'entries', 'icon', 'id', 'kind', 'member_count', 'name', 'parents', 'sort', 'system', 'tone', 'weight',
    ]);
    expect(created.json()).toMatchObject({ id: 'custom.contest_crew', kind: 'custom', name: '赛事干事', member_count: 0, entries: [] });

    const granted = await app.inject({
      method: 'PATCH', url: '/api/console/permission-groups/custom.contest_crew', headers: as('alice'),
      payload: { entries: { add: [{ node: 'competition.manage', value: true }] } },
    });
    expect(granted.statusCode).toBe(200);
    expect(granted.json().entries).toEqual([expect.objectContaining({ node: 'competition.manage', value: true })]);

    const bobId = accountIdOf(app, 'bob');
    const addedMember = await app.inject({
      method: 'POST', url: '/api/console/permission-groups/custom.contest_crew/members', headers: as('alice'),
      payload: { account_id: bobId },
    });
    expect(addedMember.statusCode).toBe(201);

    expect((await app.inject({ method: 'POST', url: '/api/console/competitions', headers: as('bob'), payload: DRAFT })).statusCode).toBe(201);
    // 没拿到这个组的人仍然没有这个权限
    const carol = { cookie: `sid=${signIn(app, 'carol', 103, null, 'token-carol')}` };
    expect((await app.inject({ method: 'POST', url: '/api/console/competitions', headers: carol, payload: DRAFT })).statusCode).toBe(403);
  });

  it('rolls back competition writes when their activity record cannot be saved', async () => {
    const { app, as } = await setup();
    const created = await app.inject({ method: 'POST', url: '/api/console/competitions', headers: as('alice'), payload: DRAFT });
    const original = created.json().competition;
    // #274 item I：recordActivity 写 activity_events，和比赛写入在同一个 db.transaction() 里，原来对 audit_logs
    // 下的这个触发器改成对它，验证的是同一件事——操作记录写不进去，比赛写入也要整体回滚。
    app.services.storage.db.exec(`
      CREATE TRIGGER reject_competition_audit BEFORE INSERT ON activity_events
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
      expect(own(listed.json().competitions)).toEqual([expect.objectContaining({ id: original.id, name: original.name })]);
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

  // 规划中（#278）：创建、修改都能带上这个字段；DRAFT 的报名截止时间还没到，不规划的话本该是「报名中」，
  // 规划中要压过去；关掉之后状态照旧按时间算。
  it('round-trips planning through create and update, and it overrides the registering phase', async () => {
    const { app, as } = await setup();
    const created = await app.inject({ method: 'POST', url: '/api/console/competitions', headers: as('alice'), payload: { ...DRAFT, planning: true } });
    expect(created.statusCode).toBe(201);
    expect(created.json().competition).toMatchObject({ planning: true, status: 'planning' });
    const id = created.json().competition.id;

    const closed = await app.inject({ method: 'PATCH', url: `/api/console/competitions/${id}`, headers: as('alice'), payload: { planning: false } });
    expect(closed.statusCode).toBe(200);
    // 关掉规划中之后，状态照常按时间算：DRAFT 的报名截止时间还没到，变回报名中
    expect(closed.json().competition).toMatchObject({ planning: false, status: 'registering' });

    // 没填 planning 的创建按不规划处理（默认值 false，不是漏填就报错）
    const withoutPlanning = await app.inject({ method: 'POST', url: '/api/console/competitions', headers: as('alice'), payload: { ...DRAFT, name: '另一场比赛' } });
    expect(withoutPlanning.statusCode).toBe(201);
    expect(withoutPlanning.json().competition).toMatchObject({ planning: false });
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
    expect(own((await app.inject({ url: '/api/public/competitions' })).json().competitions)).toEqual([]);
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
    expect(own(listed.json().competitions)).toHaveLength(1);
    expect(own(listed.json().competitions)[0].url).toBe('https://example.test/contest');
  });

  it('refuses an unauthenticated caller and a member without the capability', async () => {
    const { app, as } = await setup();
    const anonymous = await app.inject({ method: 'POST', url: '/api/console/competitions', payload: DRAFT });
    expect(anonymous.statusCode).toBe(401);
    expect(anonymous.json().error).toBe('not_signed_in');

    const member = await app.inject({ method: 'POST', url: '/api/console/competitions', headers: as('bob'), payload: DRAFT });
    expect(member.statusCode).toBe(403);
    expect(member.json()).toMatchObject({ error: 'forbidden', node: 'competition.manage' });
    // #274：console.access 只默认发给部门部长和站长（CONTRACT-274 §5），普通成员进不了控制台，连列表都读不到；确认没有写入发生。
    const listAsMember = await app.inject({ url: '/api/console/competitions', headers: as('bob') });
    expect(listAsMember.statusCode).toBe(403);
    expect(listAsMember.json()).toMatchObject({ error: 'forbidden', node: 'console.access' });
    expect(own((await app.inject({ url: '/api/console/competitions', headers: as('alice') })).json().competitions)).toEqual([]);
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

    const actions = activityRows(app, { actionLike: 'competition.%' }).map(row => row.action);
    expect(actions).toEqual(['competition.create', 'competition.delete']);
  });

  it('rejects unknown fields and a non-https url', async () => {
    const { app, as } = await setup();
    expect((await app.inject({ method: 'POST', url: '/api/console/competitions', headers: as('alice'), payload: { ...DRAFT, offline: true } })).statusCode).toBe(400);
    expect((await app.inject({ method: 'POST', url: '/api/console/competitions', headers: as('alice'), payload: { ...DRAFT, kind: 'external', url: 'http://example.test/x' } })).statusCode).toBe(400);
  });
});

describe('planning column migration (#278)', () => {
  // 迁移要能重复跑：`db.ts` 的 `addColumn` 先看 PRAGMA table_info 再决定要不要 ALTER TABLE，这里用真实文件
  // 模拟「进程重启、createDatabase 再跑一次」，确认不会因为列已经存在而报错，也不会把列加出两份、丢掉已有数据。
  it('adds the planning column once, and a second createDatabase() on the same file does not throw or duplicate it', () => {
    const dir = mkdtempSync(join(tmpdir(), 'geek-competitions-migration-'));
    const path = join(dir, 'data.db');
    try {
      const first = createDatabase(path);
      const id = newCompetitionId();
      createCompetitionStore(first.db).insert(id, { ...DRAFT, planning: true }, Date.now());
      first.db.close();

      let second: ReturnType<typeof createDatabase> | undefined;
      expect(() => { second = createDatabase(path); }).not.toThrow();
      const planningColumns = (second!.db.pragma('table_info(competitions)') as { name: string }[]).filter(c => c.name === 'planning');
      expect(planningColumns).toHaveLength(1);
      expect(second!.db.prepare('SELECT planning FROM competitions WHERE id = ?').get(id)).toEqual({ planning: 1 });
      second!.db.close();
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe('first-period description is rewritten to individual play (#288)', () => {
  // 第一期最初按团队赛种库，描述第三行写着「1–3 人组队」；赛制改成个人赛后，库里的描述要跟着改，且只改种子原文那一行。
  const TEAM_LINE = '1–3 人组队（一个人也可以自成一队），队伍积分是在队成员积分之和。比赛时间 2026-10-21 至 2026-11-15 23:59:59（北京时间）。';
  const SEED_ID = 'oss-challenge-2026-1';

  it('replaces the seeded team line once, keeps what organisers edited, and is a no-op on the second boot', () => {
    const dir = mkdtempSync(join(tmpdir(), 'geek-competition-description-'));
    const path = join(dir, 'data.db');
    try {
      const first = createDatabase(path);
      const original = (first.db.prepare('SELECT description FROM competitions WHERE id = ?').get(SEED_ID) as { description: string }).description;
      expect(original).not.toContain('组队');
      // 还原成上线时的团队赛文案，外加组织者自己在前面补的一句
      const legacy = `组织者补充：欢迎大一同学。\n${original.split('\n').slice(0, 2).join('\n')}\n${TEAM_LINE}`;
      first.db.prepare('UPDATE competitions SET description = ? WHERE id = ?').run(legacy, SEED_ID);
      first.db.close();

      const second = createDatabase(path);
      const fixed = (second.db.prepare('SELECT description FROM competitions WHERE id = ?').get(SEED_ID) as { description: string }).description;
      expect(fixed).not.toContain('组队');
      expect(fixed).toContain('个人赛，按个人合入结果计分。');
      expect(fixed.startsWith('组织者补充：欢迎大一同学。')).toBe(true);
      const updatedAt = (second.db.prepare('SELECT updated_at FROM competitions WHERE id = ?').get(SEED_ID) as { updated_at: number }).updated_at;
      second.db.close();

      const third = createDatabase(path);
      expect(third.db.prepare('SELECT description, updated_at FROM competitions WHERE id = ?').get(SEED_ID)).toEqual({ description: fixed, updated_at: updatedAt });
      third.db.close();
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('leaves a description alone when organisers rewrote the team line', () => {
    const dir = mkdtempSync(join(tmpdir(), 'geek-competition-description-'));
    const path = join(dir, 'data.db');
    try {
      const first = createDatabase(path);
      const edited = '组织者改写：1–3 人组队，具体规则以群公告为准。';
      first.db.prepare('UPDATE competitions SET description = ? WHERE id = ?').run(edited, SEED_ID);
      first.db.close();
      const second = createDatabase(path);
      expect(second.db.prepare('SELECT description FROM competitions WHERE id = ?').get(SEED_ID)).toEqual({ description: edited });
      second.db.close();
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

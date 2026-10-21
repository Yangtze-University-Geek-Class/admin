// 比赛报名与组队（#239）：真实 HTTP 走完报名 → 建队 → 申请 / 邀请 → 确认参赛，以及控制台的设置、名单与导出。
// 认人是会话里的极客班账号（#262）；组织成员资格由假 GitHub 回答，非成员回 404，守卫据此回 403 not_member。
import { afterEach, describe, expect, it } from 'vitest';
import type { ServiceOverrides } from '../../app/server/src/services';
import { signIn, testApp } from './helpers';

/** 测试里只需要 `app.inject`；不直接依赖 fastify 的类型（测试包没有装它）。 */
type TestServer = Awaited<ReturnType<typeof testApp>>['app'];

const CONSOLE_ORG = 'Yangtze-University-Geek-Class';
const contexts: Awaited<ReturnType<typeof testApp>>[] = [];
afterEach(async () => { for (const c of contexts.splice(0)) await c.close(); });

const USERS: Record<string, number> = { alice: 101, bob: 102, carol: 103, dave: 104, erin: 105 };
/** erin 不是组织成员：她的资格查询回 404，守卫必须回 403 not_member 而不是放行。 */
const MEMBERS = new Set(['alice', 'bob', 'carol', 'dave']);
const HOUR = 3600_000;
const DAY = 24 * HOUR;

function github() {
  return (() => ({
    request: async (route: string, params: Record<string, string>) => {
      if (route !== 'GET /orgs/{org}/memberships/{username}' || params.org !== CONSOLE_ORG) {
        throw new Error(`Unexpected GitHub call ${route}`);
      }
      if (!MEMBERS.has(params.username)) throw Object.assign(new Error('Not Found'), { status: 404 });
      return { data: { state: 'active', role: params.username === 'alice' ? 'admin' : 'member' } };
    },
  })) as unknown as ServiceOverrides['octokitFactory'];
}

const TEAM_SETTINGS = { enabled: true, participation: 'team', team_min: 1, team_max: 3, scoring: 'none' };
type Headers = { cookie: string };

async function setup() {
  const context = await testApp({ octokitFactory: github() });
  contexts.push(context);
  const { app } = context;
  const sessions = new Map<string, string>();
  const sign = (login: string) => {
    if (!sessions.has(login)) sessions.set(login, signIn(app, login, USERS[login], `https://avatars.test/${login}.png`));
    return sessions.get(login)!;
  };
  const as = (login: string): Headers => ({ cookie: `sid=${sign(login)}` });
  const accountId = (login: string) => app.services.auth.getSession(sign(login))!.account_id;
  let seq = 0;
  const makeCompetition = async (input: Record<string, unknown> = {}) => {
    const now = Date.now();
    const created = await app.inject({
      method: 'POST', url: '/api/console/competitions', headers: as('alice'),
      payload: {
        name: `报名测试 ${++seq}`, kind: 'internal', start_at: now - HOUR, end_at: now + 30 * DAY,
        signup_deadline: now + 7 * DAY, url: null, description: '',
        ...input,
      },
    });
    expect(created.statusCode).toBe(201);
    return created.json().competition.id as string;
  };
  const configure = (id: string, settings: Record<string, unknown> = {}) => app.inject({
    method: 'PUT', url: `/api/console/competitions/${id}/signup-settings`, headers: as('alice'),
    payload: { ...TEAM_SETTINGS, ...settings },
  });
  /** 建一场已开放报名的团队赛（默认 1–3 人），返回比赛 id。 */
  const teamCompetition = async (settings: Record<string, unknown> = {}) => {
    const id = await makeCompetition();
    expect((await configure(id, settings)).statusCode).toBe(200);
    return id;
  };
  const signUp = (id: string, login: string, payload: Record<string, unknown> = {}) =>
    app.inject({ method: 'POST', url: `/api/competitions/${id}/signup`, headers: as(login), payload });
  const myStatus = async (id: string, login: string) => {
    const res = await app.inject({ url: `/api/competitions/${id}/my-status`, headers: as(login) });
    expect(res.statusCode).toBe(200);
    return res.json();
  };
  const createTeam = (id: string, login: string, payload: Record<string, unknown>) =>
    app.inject({ method: 'POST', url: `/api/competitions/${id}/teams`, headers: as(login), payload });
  const apply = (teamId: string, login: string, payload: Record<string, unknown> = {}) =>
    app.inject({ method: 'POST', url: `/api/teams/${teamId}/apply`, headers: as(login), payload });
  const respond = (teamId: string, login: string, membershipId: string, action: string) =>
    app.inject({ method: 'POST', url: `/api/teams/${teamId}/respond`, headers: as(login), payload: { membership_id: membershipId, action } });
  const teams = async (id: string, login: string) => {
    const res = await app.inject({ url: `/api/competitions/${id}/teams`, headers: as(login) });
    expect(res.statusCode).toBe(200);
    return res.json().teams;
  };
  return { app, as, accountId, makeCompetition, configure, teamCompetition, signUp, myStatus, createTeam, apply, respond, teams };
}

/** 领队把某人加进队伍：对方申请、领队同意。 */
async function join(app: TestServer, as: (login: string) => Headers, competitionId: string, teamId: string, leader: string, login: string) {
  const applied = await app.inject({ method: 'POST', url: `/api/teams/${teamId}/apply`, headers: as(login), payload: {} });
  expect(applied.statusCode, `${login} 的申请`).toBe(201);
  const pending = (await app.inject({ url: `/api/competitions/${competitionId}/my-status`, headers: as(leader) })).json().pending;
  const application = pending.find((item: { person: { login: string } }) => item.person.login === login);
  expect(application, `${login} 的申请`).toBeTruthy();
  const accepted = await app.inject({
    method: 'POST', url: `/api/teams/${teamId}/respond`, headers: as(leader),
    payload: { membership_id: application.membership_id, action: 'accept' },
  });
  expect(accepted.statusCode).toBe(200);
}

describe('membership gate', () => {
  it('answers anonymous callers with 401 and non-members with 403 not_member', async () => {
    const { app, as, teamCompetition } = await setup();
    const id = await teamCompetition();

    const anonymous = await app.inject({ url: '/api/me/competitions' });
    expect(anonymous.statusCode).toBe(401);
    expect(anonymous.json()).toMatchObject({ error: 'not_signed_in' });

    const outsider = await app.inject({ url: '/api/me/competitions', headers: as('erin') });
    expect(outsider.statusCode).toBe(403);
    expect(outsider.json().error).toBe('not_member');
    expect(outsider.json().message).toContain('极客班');

    const outsiderWrite = await app.inject({ method: 'POST', url: `/api/competitions/${id}/signup`, headers: as('erin'), payload: {} });
    expect(outsiderWrite.statusCode).toBe(403);
    expect(outsiderWrite.json().error).toBe('not_member');

    const member = await app.inject({ url: '/api/me/competitions', headers: as('bob') });
    expect(member.statusCode).toBe(200);
    expect(member.json()).toEqual({ items: [], pending_total: 0 });
  });
});

describe('public competition endpoints', () => {
  it('adds the signup summary without counts and opens the single read to other origins', async () => {
    const { app, as, teamCompetition } = await setup();
    const id = await teamCompetition({ team_min: 2, team_max: 4 });

    const list = (await app.inject({ url: '/api/public/competitions' })).json().competitions;
    const row = list.find((item: { id: string }) => item.id === id);
    expect(row.signup).toEqual({ enabled: true, participation: 'team', team_min: 2, team_max: 4, scoring: 'none' });
    expect(JSON.stringify(row)).not.toMatch(/account_id|member_count|signups|stats/);

    const single = await app.inject({ url: `/api/public/competitions/${id}` });
    expect(single.statusCode).toBe(200);
    expect(single.headers['access-control-allow-origin']).toBe('*');
    expect(single.json()).toEqual(row);

    const missing = await app.inject({ url: '/api/public/competitions/not-a-competition' });
    expect(missing.statusCode).toBe(404);
    expect(missing.json().error).toBe('not_found');

    // 下线后单场也 404，门户成员接口同样当不存在
    await app.inject({ method: 'PATCH', url: `/api/console/competitions/${id}`, headers: as('alice'), payload: { offline: true } });
    expect((await app.inject({ url: `/api/public/competitions/${id}` })).statusCode).toBe(404);
    expect((await app.inject({ url: `/api/competitions/${id}/my-status`, headers: as('bob') })).statusCode).toBe(404);
  });

  it('refuses signups before the settings are enabled and after the deadline', async () => {
    const { configure, makeCompetition, myStatus, signUp } = await setup();
    const disabled = await makeCompetition();
    const refused = await signUp(disabled, 'bob');
    expect(refused.statusCode).toBe(409);
    expect(refused.json().error).toBe('signup_not_enabled');

    const now = Date.now();
    const past = await makeCompetition({ start_at: now - 2 * HOUR, signup_deadline: now - HOUR, end_at: now + HOUR });
    expect((await configure(past)).statusCode).toBe(200);
    const late = await signUp(past, 'bob');
    expect(late.statusCode).toBe(409);
    expect(late.json().error).toBe('signup_closed');

    const status = await myStatus(past, 'bob');
    expect(status.writable).toBe(false);
    expect(status.actions).toEqual([]);
    expect(status.state).toBe('none');
  });
});

describe('signup', () => {
  it('is idempotent, keeps created_at, and restores a cancelled signup', async () => {
    const { app, as, signUp, teamCompetition } = await setup();
    const id = await teamCompetition();
    const created = (await signUp(id, 'alice', { note: '第一次', looking_for_team: true })).json();
    expect(created.signup).toMatchObject({ status: 'active', note: '第一次', looking_for_team: true });
    expect(created.state).toBe('signed_up');

    const again = (await signUp(id, 'alice', { note: '改主意了', looking_for_team: false })).json();
    expect(again.signup).toMatchObject({
      status: 'active', note: '改主意了', looking_for_team: false, created_at: created.signup.created_at,
    });

    const cancelled = await app.inject({ method: 'DELETE', url: `/api/competitions/${id}/signup`, headers: as('alice') });
    expect(cancelled.statusCode).toBe(200);
    expect(cancelled.json().signup.status).toBe('cancelled');
    expect(cancelled.json().state).toBe('none');
    expect(cancelled.json().actions).toEqual(['signup']);

    const restored = (await signUp(id, 'alice', { note: '回来' })).json();
    expect(restored.signup).toMatchObject({ status: 'active', note: '回来', created_at: created.signup.created_at });
    expect(restored.state).toBe('signed_up');
  });

  it('closes the pending application when the applicant cancels', async () => {
    const { app, as, apply, signUp, teamCompetition, createTeam, myStatus, respond } = await setup();
    const id = await teamCompetition();
    for (const login of ['alice', 'bob']) await signUp(id, login);
    const teamId = (await createTeam(id, 'alice', { name: '待处理队' })).json().team.id;
    expect((await apply(teamId, 'bob')).statusCode).toBe(201);
    const application = (await myStatus(id, 'bob')).pending[0];
    expect(application.kind).toBe('application');

    const cancelled = await app.inject({ method: 'DELETE', url: `/api/competitions/${id}/signup`, headers: as('bob') });
    expect(cancelled.statusCode).toBe(200);
    expect((await myStatus(id, 'alice')).pending).toEqual([]);
    expect((await myStatus(id, 'bob')).pending).toEqual([]);

    // 已经关闭的申请不能再同意
    const stale = await respond(teamId, 'alice', application.membership_id, 'accept');
    expect(stale.statusCode).toBe(409);
    expect(stale.json().error).toBe('invalid_state');
  });

  it('cancelling follows the team rules: members leave, leaders transfer or disband, locked teams unlock first', async () => {
    const { app, as, signUp, teamCompetition, createTeam, myStatus, teams } = await setup();
    const id = await teamCompetition();
    await signUp(id, 'alice');
    await signUp(id, 'bob');
    const teamId = (await createTeam(id, 'alice', { name: '规则队', slogan: '稳' })).json().team.id;
    await join(app, as, id, teamId, 'alice', 'bob');
    expect((await myStatus(id, 'bob')).state).toBe('in_team');

    // 队员取消：自动退出队伍
    const bobCancel = await app.inject({ method: 'DELETE', url: `/api/competitions/${id}/signup`, headers: as('bob') });
    expect(bobCancel.statusCode).toBe(200);
    expect(bobCancel.json().signup.status).toBe('cancelled');
    expect(bobCancel.json().team).toBeNull();
    expect((await teams(id, 'alice'))[0].member_count).toBe(1);

    // 重新报名并回队后，领队不能直接取消
    await signUp(id, 'bob');
    await join(app, as, id, teamId, 'alice', 'bob');
    const leaderCancel = await app.inject({ method: 'DELETE', url: `/api/competitions/${id}/signup`, headers: as('alice') });
    expect(leaderCancel.statusCode).toBe(409);
    expect(leaderCancel.json().error).toBe('is_team_leader');

    // 锁定后先撤销确认
    expect((await app.inject({ method: 'POST', url: `/api/teams/${teamId}/lock`, headers: as('alice') })).statusCode).toBe(200);
    const lockedCancel = await app.inject({ method: 'DELETE', url: `/api/competitions/${id}/signup`, headers: as('bob') });
    expect(lockedCancel.statusCode).toBe(409);
    expect(lockedCancel.json().error).toBe('team_locked');
    expect((await app.inject({ method: 'DELETE', url: `/api/teams/${teamId}/lock`, headers: as('alice') })).statusCode).toBe(200);

    // 解散之后领队可以取消
    expect((await app.inject({ method: 'DELETE', url: `/api/teams/${teamId}`, headers: as('alice') })).statusCode).toBe(200);
    expect(await teams(id, 'alice')).toEqual([]);
    expect((await app.inject({ method: 'DELETE', url: `/api/competitions/${id}/signup`, headers: as('alice') })).statusCode).toBe(200);

    // 只有自己一人的队伍随取消一起解散
    await signUp(id, 'alice');
    expect((await createTeam(id, 'alice', { name: '独行队' })).statusCode).toBe(201);
    const soloCancel = await app.inject({ method: 'DELETE', url: `/api/competitions/${id}/signup`, headers: as('alice') });
    expect(soloCancel.statusCode).toBe(200);
    expect(await teams(id, 'alice')).toEqual([]);
  });
});

describe('teams', () => {
  it('rejects duplicate names after trim, NFKC and lower case', async () => {
    const { signUp, teamCompetition, createTeam } = await setup();
    const id = await teamCompetition();
    for (const login of ['alice', 'bob']) await signUp(id, login);
    expect((await createTeam(id, 'alice', { name: 'Geek 队' })).statusCode).toBe(201);
    const duplicate = await createTeam(id, 'bob', { name: '  ＧＥＥＫ 队  ' });
    expect(duplicate.statusCode).toBe(409);
    expect(duplicate.json().error).toBe('duplicate_team_name');
    const short = await createTeam(id, 'bob', { name: '  a  ' });
    expect(short.statusCode).toBe(400);
    expect(short.json().error).toBe('bad_team_name');
  });

  it('lets an applicant in, closes their other pending items, and hides them from others', async () => {
    const { app, as, signUp, teamCompetition, createTeam, apply, myStatus, respond } = await setup();
    const id = await teamCompetition();
    for (const login of ['alice', 'bob', 'carol']) await signUp(id, login, { looking_for_team: true });

    const agents = (await app.inject({ url: `/api/competitions/${id}/free-agents`, headers: as('bob') })).json().people;
    expect(agents.map((person: { login: string }) => person.login).sort()).toEqual(['alice', 'bob', 'carol']);

    const first = (await createTeam(id, 'alice', { name: '一队' })).json();
    expect(first.team).toMatchObject({ name: '一队', status: 'recruiting', member_count: 1 });
    expect(first.role).toBe('leader');
    expect(first.team.members[0]).toMatchObject({ login: 'alice', role: 'leader' });
    const second = (await createTeam(id, 'carol', { name: '二队' })).json().team.id;

    expect((await apply(first.team.id, 'bob', { message: '带带我' })).statusCode).toBe(201);
    expect((await apply(second, 'bob')).statusCode).toBe(201);

    const leaderPending = (await myStatus(id, 'alice')).pending;
    expect(leaderPending).toHaveLength(1);
    expect(leaderPending[0]).toMatchObject({
      kind: 'application', team_id: first.team.id, team_name: '一队',
      person: { login: 'bob', avatar_url: 'https://avatars.test/bob.png' }, message: '带带我',
    });
    // 不相干的人看不到别人的待处理项
    expect((await myStatus(id, 'dave')).pending).toEqual([]);
    // 申请人能看到自己发出的两份申请
    expect((await myStatus(id, 'bob')).pending).toHaveLength(2);

    const accepted = await respond(first.team.id, 'alice', leaderPending[0].membership_id, 'accept');
    expect(accepted.statusCode).toBe(200);
    expect(accepted.json().state).toBe('in_team');
    const bobStatus = await myStatus(id, 'bob');
    expect(bobStatus.state).toBe('in_team');
    expect(bobStatus.pending).toEqual([]);
    expect((await myStatus(id, 'carol')).pending).toEqual([]);
    // 已入队的人不再出现在「找队友」里
    const after = (await app.inject({ url: `/api/competitions/${id}/free-agents`, headers: as('bob') })).json().people;
    expect(after).toEqual([]);
  });

  it('invites signed-up members and refuses anyone else', async () => {
    const { app, as, accountId, signUp, teamCompetition, createTeam, myStatus, respond } = await setup();
    const id = await teamCompetition();
    await signUp(id, 'alice');
    await signUp(id, 'bob');
    const teamId = (await createTeam(id, 'alice', { name: '邀请队' })).json().team.id;

    const invite = await app.inject({
      method: 'POST', url: `/api/teams/${teamId}/invite`, headers: as('alice'), payload: { account_id: accountId('bob') },
    });
    expect(invite.statusCode).toBe(201);
    const bobPending = (await myStatus(id, 'bob')).pending;
    expect(bobPending).toHaveLength(1);
    expect(bobPending[0]).toMatchObject({ kind: 'invitation', team_name: '邀请队', person: { login: 'bob' } });

    const accepted = await respond(teamId, 'bob', bobPending[0].membership_id, 'accept');
    expect(accepted.statusCode).toBe(200);
    expect(accepted.json().state).toBe('in_team');

    const notSignedUp = await app.inject({
      method: 'POST', url: `/api/teams/${teamId}/invite`, headers: as('alice'), payload: { account_id: accountId('dave') },
    });
    expect(notSignedUp.statusCode).toBe(409);
    expect(notSignedUp.json().error).toBe('invitee_not_signed_up');

    const notLeader = await app.inject({
      method: 'POST', url: `/api/teams/${teamId}/invite`, headers: as('bob'), payload: { account_id: accountId('carol') },
    });
    expect(notLeader.statusCode).toBe(403);
    expect(notLeader.json().error).toBe('not_team_leader');
  });

  it('closes the remaining applications once the team is full', async () => {
    const { signUp, teamCompetition, createTeam, apply, myStatus, respond } = await setup();
    const id = await teamCompetition({ team_min: 1, team_max: 2 });
    for (const login of ['alice', 'bob', 'carol', 'dave']) await signUp(id, login);
    const teamId = (await createTeam(id, 'alice', { name: '满员队' })).json().team.id;
    expect((await apply(teamId, 'bob')).statusCode).toBe(201);
    expect((await apply(teamId, 'carol')).statusCode).toBe(201);

    const bobApplication = (await myStatus(id, 'alice')).pending
      .find((item: { person: { login: string } }) => item.person.login === 'bob');
    expect((await respond(teamId, 'alice', bobApplication.membership_id, 'accept')).statusCode).toBe(200);
    // 满员之后其余申请自动关闭
    expect((await myStatus(id, 'carol')).pending).toEqual([]);
    const full = await apply(teamId, 'carol');
    expect(full.statusCode).toBe(409);
    expect(full.json().error).toBe('team_full');
  });

  it('keeps the leader in place until they transfer or disband', async () => {
    const { app, as, accountId, signUp, teamCompetition, createTeam, myStatus, teams } = await setup();
    const id = await teamCompetition();
    await signUp(id, 'alice');
    await signUp(id, 'bob');
    const teamId = (await createTeam(id, 'alice', { name: '转让队' })).json().team.id;
    await join(app, as, id, teamId, 'alice', 'bob');

    const leaderLeave = await app.inject({ method: 'POST', url: `/api/teams/${teamId}/leave`, headers: as('alice') });
    expect(leaderLeave.statusCode).toBe(409);
    expect(leaderLeave.json().error).toBe('is_team_leader');

    const transfer = await app.inject({
      method: 'POST', url: `/api/teams/${teamId}/transfer`, headers: as('alice'), payload: { account_id: accountId('bob') },
    });
    expect(transfer.statusCode).toBe(200);
    expect(transfer.json().role).toBe('member');
    expect((await teams(id, 'bob'))[0].leader_account_id).toBe(accountId('bob'));

    const left = await app.inject({ method: 'POST', url: `/api/teams/${teamId}/leave`, headers: as('alice') });
    expect(left.statusCode).toBe(200);
    expect(left.json().state).toBe('signed_up');
    expect(left.json().team).toBeNull();
    expect((await myStatus(id, 'bob')).role).toBe('leader');
  });

  it('only confirms inside the size range and freezes a locked team', async () => {
    const { app, as, signUp, teamCompetition, createTeam, apply, myStatus } = await setup();
    const id = await teamCompetition({ team_min: 2, team_max: 3 });
    for (const login of ['alice', 'bob', 'carol']) await signUp(id, login);
    const teamId = (await createTeam(id, 'alice', { name: '范围队' })).json().team.id;

    const tooSmall = await app.inject({ method: 'POST', url: `/api/teams/${teamId}/lock`, headers: as('alice') });
    expect(tooSmall.statusCode).toBe(409);
    expect(tooSmall.json().error).toBe('team_too_small');

    await join(app, as, id, teamId, 'alice', 'bob');
    const locked = await app.inject({ method: 'POST', url: `/api/teams/${teamId}/lock`, headers: as('alice') });
    expect(locked.statusCode).toBe(200);
    expect(locked.json().state).toBe('confirmed');
    expect(locked.json().actions).toEqual(['update_signup', 'unlock']);

    const applyLocked = await apply(teamId, 'carol');
    expect(applyLocked.statusCode).toBe(409);
    expect(applyLocked.json().error).toBe('team_locked');
    const leaveLocked = await app.inject({ method: 'POST', url: `/api/teams/${teamId}/leave`, headers: as('bob') });
    expect(leaveLocked.statusCode).toBe(409);
    expect(leaveLocked.json().error).toBe('team_locked');

    const unlocked = await app.inject({ method: 'DELETE', url: `/api/teams/${teamId}/lock`, headers: as('alice') });
    expect(unlocked.statusCode).toBe(200);
    expect(unlocked.json().state).toBe('in_team');
    expect((await app.inject({ method: 'POST', url: `/api/teams/${teamId}/leave`, headers: as('bob') })).statusCode).toBe(200);
    expect((await myStatus(id, 'bob')).role).toBeNull();
  });

  it('disbands, returning members to signed-up', async () => {
    const { app, as, signUp, teamCompetition, createTeam, myStatus, teams } = await setup();
    const id = await teamCompetition();
    await signUp(id, 'alice');
    await signUp(id, 'bob');
    const teamId = (await createTeam(id, 'alice', { name: '解散队' })).json().team.id;
    await join(app, as, id, teamId, 'alice', 'bob');

    const disbanded = await app.inject({ method: 'DELETE', url: `/api/teams/${teamId}`, headers: as('alice') });
    expect(disbanded.statusCode).toBe(200);
    expect(disbanded.json().team).toBeNull();
    expect((await myStatus(id, 'bob')).state).toBe('signed_up');
    expect(await teams(id, 'bob')).toEqual([]);
    // 已解散的队伍再操作一律 404
    expect((await app.inject({ method: 'DELETE', url: `/api/teams/${teamId}`, headers: as('alice') })).statusCode).toBe(404);
  });

  it('validates ownership and role when responding to applications and invitations', async () => {
    const { app, as, accountId, signUp, teamCompetition, createTeam, apply, myStatus, respond } = await setup();
    const id = await teamCompetition();
    for (const login of ['alice', 'bob', 'carol']) await signUp(id, login);
    const first = (await createTeam(id, 'alice', { name: '归属队' })).json().team.id;
    const second = (await createTeam(id, 'carol', { name: '旁观队' })).json().team.id;
    expect((await apply(first, 'bob')).statusCode).toBe(201);
    const application = (await myStatus(id, 'alice')).pending[0];

    // 成员关系不属于路径上的队伍
    expect((await respond(second, 'carol', application.membership_id, 'accept')).statusCode).toBe(404);
    // 非领队不能同意
    const notLeader = await respond(first, 'bob', application.membership_id, 'accept');
    expect(notLeader.statusCode).toBe(403);
    expect(notLeader.json().error).toBe('not_team_leader');
    // 申请人撤回，之后不能重复处理
    expect((await respond(first, 'bob', application.membership_id, 'withdraw')).statusCode).toBe(200);
    const stale = await respond(first, 'bob', application.membership_id, 'withdraw');
    expect(stale.statusCode).toBe(409);
    expect(stale.json().error).toBe('invalid_state');

    // 领队撤回自己发出的邀请
    const invite = await app.inject({
      method: 'POST', url: `/api/teams/${first}/invite`, headers: as('alice'), payload: { account_id: accountId('bob') },
    });
    expect(invite.statusCode).toBe(201);
    const invitation = (await myStatus(id, 'bob')).pending[0];
    expect((await respond(first, 'alice', invitation.membership_id, 'withdraw')).statusCode).toBe(200);
    expect((await myStatus(id, 'bob')).pending).toEqual([]);
  });
});

describe('my competitions', () => {
  it('reports state and the actions the server would accept right now', async () => {
    const { configure, makeCompetition, signUp, teamCompetition, createTeam, myStatus } = await setup();
    const individual = await makeCompetition();
    expect((await configure(individual, { participation: 'individual', team_min: 1, team_max: 1 })).statusCode).toBe(200);
    const before = await myStatus(individual, 'alice');
    expect(before.state).toBe('none');
    expect(before.actions).toEqual(['signup']);
    const signed = (await signUp(individual, 'alice')).json();
    expect(signed.state).toBe('confirmed');
    expect(signed.actions).toEqual(['update_signup', 'cancel_signup']);
    const personal = await createTeam(individual, 'alice', { name: '个人赛队伍' });
    expect(personal.statusCode).toBe(409);
    expect(personal.json().error).toBe('individual_competition');

    const id = await teamCompetition();
    await signUp(id, 'alice');
    const waiting = await myStatus(id, 'alice');
    expect(waiting.state).toBe('signed_up');
    expect(waiting.actions).toEqual(['update_signup', 'cancel_signup', 'create_team']);
    const created = (await createTeam(id, 'alice', { name: '行动队' })).json();
    expect(created.role).toBe('leader');
    expect(created.actions).toEqual(['update_signup', 'cancel_signup', 'invite', 'lock', 'disband']);
    expect(created.stats).toEqual({ signups: 1, teams: 1, locked_teams: 0, confirmed_people: 0, unplaced: 0 });
    expect(created.writable).toBe(true);
    expect(created.pending).toEqual([]);
  });

  it('lists my competitions with a pending total and drops cancelled ones', async () => {
    const { app, as, accountId, signUp, teamCompetition, createTeam, myStatus } = await setup();
    const first = await teamCompetition();
    const second = await teamCompetition();
    await signUp(first, 'bob');
    await signUp(second, 'bob');
    await signUp(first, 'alice');
    const teamId = (await createTeam(first, 'alice', { name: '角标队' })).json().team.id;
    expect((await app.inject({
      method: 'POST', url: `/api/teams/${teamId}/invite`, headers: as('alice'), payload: { account_id: accountId('bob') },
    })).statusCode).toBe(201);

    const mine = (await app.inject({ url: '/api/me/competitions', headers: as('bob') })).json();
    expect(mine.pending_total).toBe(1);
    expect(mine.items).toHaveLength(2);
    const item = mine.items.find((row: { competition_id: string }) => row.competition_id === first);
    expect(item).toMatchObject({
      kind: 'internal', status: 'registering', state: 'signed_up', team: null, pending_count: 1,
      signup_deadline: expect.any(Number),
    });
    expect((await myStatus(first, 'bob')).pending[0].kind).toBe('invitation');

    await app.inject({ method: 'DELETE', url: `/api/competitions/${second}/signup`, headers: as('bob') });
    const after = (await app.inject({ url: '/api/me/competitions', headers: as('bob') })).json();
    expect(after.items.map((row: { competition_id: string }) => row.competition_id)).toEqual([first]);
  });
});

describe('console roster', () => {
  it('enforces the signup settings and audits every change', async () => {
    const { app, as, configure, makeCompetition, signUp, teamCompetition, createTeam } = await setup();
    const noDeadline = await makeCompetition({ signup_deadline: null });
    const missingDeadline = await configure(noDeadline);
    expect(missingDeadline.statusCode).toBe(409);
    expect(missingDeadline.json().error).toBe('deadline_required');

    const id = await teamCompetition();
    const badSize = await configure(id, { team_min: 5, team_max: 3 });
    expect(badSize.statusCode).toBe(400);
    expect(badSize.json().error).toBe('bad_team_size');

    await signUp(id, 'alice');
    const changeParticipation = await configure(id, { participation: 'individual', team_min: 1, team_max: 1 });
    expect(changeParticipation.statusCode).toBe(409);
    expect(changeParticipation.json().error).toBe('has_signups');

    await signUp(id, 'bob');
    const teamId = (await createTeam(id, 'alice', { name: '冲突队' })).json().team.id;
    await join(app, as, id, teamId, 'alice', 'bob');
    const sizeConflict = await configure(id, { team_min: 1, team_max: 1 });
    expect(sizeConflict.statusCode).toBe(409);
    expect(sizeConflict.json().error).toBe('team_size_conflict');

    const audits = app.services.storage.db
      .prepare("SELECT details FROM audit_logs WHERE action = 'competition.signup_settings.update' ORDER BY id")
      .all() as { details: string }[];
    expect(audits).toHaveLength(1);
    expect(JSON.parse(audits[0].details)).toEqual({
      before: { enabled: false, participation: 'individual', team_min: 1, team_max: 1, scoring: 'none' },
      after: { enabled: true, participation: 'team', team_min: 1, team_max: 3, scoring: 'none' },
    });
  });

  it('returns cancelled signups and disbanded teams, and exports a safe CSV with an audit row', async () => {
    const { app, as, signUp, teamCompetition, createTeam } = await setup();
    const id = await teamCompetition({ team_max: 3 });
    await signUp(id, 'alice', { note: '=SUM(1,2)' });
    await signUp(id, 'bob', { note: '想加入' });
    const teamId = (await createTeam(id, 'alice', { name: '名单队' })).json().team.id;
    await join(app, as, id, teamId, 'alice', 'bob');
    await signUp(id, 'carol');
    await app.inject({ method: 'DELETE', url: `/api/competitions/${id}/signup`, headers: as('carol') });

    const roster = (await app.inject({ url: `/api/console/competitions/${id}/roster`, headers: as('alice') })).json();
    expect(roster.settings).toEqual({ enabled: true, participation: 'team', team_min: 1, team_max: 3, scoring: 'none' });
    expect(roster.stats).toEqual({ signups: 2, teams: 1, locked_teams: 0, confirmed_people: 0, unplaced: 0 });
    expect(roster.signups.find((row: { login: string }) => row.login === 'bob')).toMatchObject({
      status: 'active', team_name: '名单队', role: 'member', looking_for_team: false,
    });
    expect(roster.signups.find((row: { login: string }) => row.login === 'carol')).toMatchObject({
      status: 'cancelled', team_id: null, cancelled_at: expect.any(Number),
    });
    expect(roster.teams[0]).toMatchObject({ name: '名单队', status: 'recruiting', member_count: 2, disbanded_at: null });

    const csv = await app.inject({ url: `/api/console/competitions/${id}/roster.csv`, headers: as('alice') });
    expect(csv.statusCode).toBe(200);
    expect(csv.headers['content-type']).toContain('text/csv');
    expect(csv.body.startsWith('\ufeff')).toBe(true);
    const lines = csv.body.slice(1).trimEnd().split('\r\n');
    expect(lines[0]).toBe('account_id,login,status,note,looking_for_team,team_name,role,created_at_beijing,updated_at_beijing,cancelled_at_beijing');
    expect(lines).toHaveLength(4);
    // 公式注入防护：以 = 开头的单元格前加 '
    expect(csv.body).toContain("'=SUM(1,2)");

    const exported = app.services.storage.db
      .prepare("SELECT target, details FROM audit_logs WHERE action = 'competition.roster.export'")
      .get() as { target: string; details: string };
    expect(exported.target).toBe(id);
    expect(JSON.parse(exported.details)).toEqual({ rows: 3 });
  });

  it('answers the three #238 constraints once signups exist', async () => {
    const { app, as, makeCompetition, signUp, teamCompetition } = await setup();
    const id = await teamCompetition();
    await signUp(id, 'alice');

    const kind = await app.inject({ method: 'PATCH', url: `/api/console/competitions/${id}`, headers: as('alice'), payload: { kind: 'external' } });
    expect(kind.statusCode).toBe(409);
    expect(kind.json().error).toBe('kind_locked');

    const deadline = await app.inject({ method: 'PATCH', url: `/api/console/competitions/${id}`, headers: as('alice'), payload: { signup_deadline: null } });
    expect(deadline.statusCode).toBe(409);
    expect(deadline.json().error).toBe('deadline_required');

    const removed = await app.inject({ method: 'DELETE', url: `/api/console/competitions/${id}`, headers: as('alice') });
    expect(removed.statusCode).toBe(409);
    expect(removed.json().error).toBe('has_signups');

    // 没有报名的比赛照常删除
    const empty = await makeCompetition();
    expect((await app.inject({ method: 'DELETE', url: `/api/console/competitions/${empty}`, headers: as('alice') })).statusCode).toBe(200);
  });
});

describe('rate limits', () => {
  it('caps member writes at 30 a minute and roster exports at 5', async () => {
    const { app, as, signUp, teamCompetition } = await setup();
    const id = await teamCompetition();

    for (let attempt = 0; attempt < 30; attempt += 1) {
      expect((await signUp(id, 'alice', { note: `第 ${attempt} 次` })).statusCode).toBe(200);
    }
    const limitedSignup = await signUp(id, 'alice');
    expect(limitedSignup.statusCode).toBe(429);
    expect(limitedSignup.json()).toMatchObject({ error: 'rate_limited' });

    for (let attempt = 0; attempt < 5; attempt += 1) {
      expect((await app.inject({ url: `/api/console/competitions/${id}/roster.csv`, headers: as('alice') })).statusCode).toBe(200);
    }
    const limitedExport = await app.inject({ url: `/api/console/competitions/${id}/roster.csv`, headers: as('alice') });
    expect(limitedExport.statusCode).toBe(429);
    expect(limitedExport.json()).toMatchObject({ error: 'rate_limited' });
  });
});

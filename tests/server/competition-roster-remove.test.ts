// 控制台移出报名（#342）：真实 Fastify 路由 + 隔离 SQLite。管理员移出与本人取消的差别（截止后、已确认队伍、
// 带队员的领队都照样移出），队伍的四种结果，权限、step-up、定榜三道拒绝，审计同事务回滚，以及名单、天梯、候选随之变化。
import { afterEach, describe, expect, it } from 'vitest';
import { activityRows, grantPermNode } from './helpers';
import { HOUR, contestSetup, type ContestContext } from './contest-fixtures';

const contexts: ContestContext[] = [];
afterEach(async () => { for (const context of contexts.splice(0)) await context.close(); });

type Settings = { participation?: 'individual' | 'team'; team_min?: number; team_max?: number; scoring?: 'none' | 'contribution' };

async function setup(settings: Settings = {}) {
  const c = await contestSetup();
  contexts.push(c);
  const id = await c.createCompetition();
  const { participation = 'team', team_min = 1, team_max = 3, scoring = 'contribution' } = settings;
  expect((await c.app.inject({
    method: 'PUT', url: `/api/console/competitions/${id}/signup-settings`, headers: c.as('owner'),
    payload: { enabled: true, participation, team_min, team_max, scoring },
  })).statusCode).toBe(200);
  const db = c.app.services.storage.db;
  const remove = (login: string, by = 'owner', competitionId = id) =>
    c.app.inject({ method: 'DELETE', url: `/api/console/competitions/${competitionId}/signups/${c.accountId(login)}`, headers: c.as(by) });
  const roster = async () => {
    const res = await c.app.inject({ url: `/api/console/competitions/${id}/roster`, headers: c.as('owner') });
    expect(res.statusCode).toBe(200);
    return res.json();
  };
  const my = async (login: string) => (await c.app.inject({ url: `/api/competitions/${id}/my-status`, headers: c.as(login) })).json();
  const createTeam = async (leader: string, name: string) => {
    const res = await c.app.inject({ method: 'POST', url: `/api/competitions/${id}/teams`, headers: c.as(leader), payload: { name } });
    expect(res.statusCode).toBe(201);
    return res.json().team.id as string;
  };
  /** 对方申请、领队同意；入队先后就是申请先后。 */
  const join = async (teamId: string, leader: string, login: string) => {
    expect((await c.app.inject({ method: 'POST', url: `/api/teams/${teamId}/apply`, headers: c.as(login), payload: {} })).statusCode).toBe(201);
    const application = (await my(leader)).pending.find((item: { person: { account_id: string } }) => item.person.account_id === c.accountId(login));
    expect((await c.app.inject({
      method: 'POST', url: `/api/teams/${teamId}/respond`, headers: c.as(leader),
      payload: { membership_id: application.membership_id, action: 'accept' },
    })).statusCode).toBe(200);
  };
  const lock = async (teamId: string, leader: string) =>
    expect((await c.app.inject({ method: 'POST', url: `/api/teams/${teamId}/lock`, headers: c.as(leader) })).statusCode).toBe(200);
  const teamRow = (teamId: string) => db.prepare('SELECT status, locked_at, leader_account_id FROM competition_teams WHERE id = ?').get(teamId) as
    { status: string; locked_at: number | null; leader_account_id: string };
  const memberStatus = (teamId: string, login: string) => (db.prepare('SELECT status, role FROM competition_team_members WHERE team_id = ? AND account_id = ? ORDER BY created_at DESC LIMIT 1')
    .get(teamId, c.accountId(login)) as { status: string; role: string } | undefined);
  const blockAudit = () => db.exec(`CREATE TRIGGER fail_remove_audit BEFORE INSERT ON activity_events
    WHEN NEW.action = 'competition.signup.remove' BEGIN SELECT RAISE(ABORT, 'synthetic audit failure'); END`);
  const unblockAudit = () => db.exec('DROP TRIGGER fail_remove_audit');
  return { ...c, id, db, remove, roster, my, createTeam, join, lock, teamRow, memberStatus, blockAudit, unblockAudit };
}

describe('拒绝路径', () => {
  it('没有 competition.manage 回 403，名单不变', async () => {
    const c = await setup();
    await c.signUp(c.id, 'alice');
    const res = await c.remove('alice', 'dave');
    expect(res.statusCode).toBe(403);
    expect(res.json()).toMatchObject({ error: 'forbidden' });
    expect((await c.roster()).stats.signups).toBe(1);
    expect(activityRows(c.app, { action: 'competition.signup.remove' })).toHaveLength(0);
  });

  it('不是刚登录过回 403 step_up_required，名单不变；重新登录后可以移出', async () => {
    const c = await setup();
    await c.signUp(c.id, 'alice');
    c.makeStale('owner');
    const stale = await c.remove('alice');
    expect(stale.statusCode).toBe(403);
    expect(stale.json().error).toBe('step_up_required');
    expect((await c.my('alice')).state).not.toBe('none');
    c.db.prepare('UPDATE sessions SET created_at = ? WHERE login = ?').run(Date.now(), 'owner');
    expect((await c.remove('alice')).statusCode).toBe(200);
  });

  it('已定榜回 409 competition_finalized，名单与名次不变', async () => {
    const c = await setup();
    await c.signUp(c.id, 'alice');
    await c.signUp(c.id, 'bob');
    expect((await c.addScore(c.id, { account_id: c.accountId('alice'), kind: 'pr', repo: 'geek/admin', number: 1, importance: 'important', core: 'business' })).statusCode).toBe(201);
    await c.endCompetition(c.id);
    expect((await c.app.inject({ method: 'POST', url: `/api/console/competitions/${c.id}/final`, headers: c.as('owner') })).statusCode).toBe(201);
    const res = await c.remove('bob');
    expect(res.statusCode).toBe(409);
    expect(res.json().error).toBe('competition_finalized');
    expect((await c.roster()).stats.signups).toBe(2);
    const board = (await c.app.inject({ url: `/api/competitions/${c.id}/leaderboard`, headers: c.as('alice') })).json();
    expect(board.individuals).toHaveLength(2);
  });

  it('没有报名、已经取消回 409 not_signed_up；比赛不存在回 404', async () => {
    const c = await setup();
    expect((await c.remove('carol')).json().error).toBe('not_signed_up');
    await c.signUp(c.id, 'carol');
    expect((await c.app.inject({ method: 'DELETE', url: `/api/competitions/${c.id}/signup`, headers: c.as('carol') })).statusCode).toBe(200);
    const again = await c.remove('carol');
    expect(again.statusCode).toBe(409);
    expect(again.json().error).toBe('not_signed_up');
    const missing = await c.remove('carol', 'owner', 'no-such-competition');
    expect(missing.statusCode).toBe(404);
    expect(missing.json().error).toBe('not_found');
  });
});

describe('移出与队伍', () => {
  it('个人赛：报名截止后本人不能取消，管理员仍能移出；本人看到未报名，审计只记账号与结果', async () => {
    const c = await setup({ participation: 'individual', team_min: 1, team_max: 1 });
    await c.signUp(c.id, 'alice');
    await c.signUp(c.id, 'bob');
    const now = Date.now();
    expect((await c.app.inject({
      method: 'PATCH', url: `/api/console/competitions/${c.id}`, headers: c.as('owner'),
      payload: { start_at: now - 2 * HOUR, signup_deadline: now - HOUR },
    })).statusCode).toBe(200);
    expect((await c.app.inject({ method: 'DELETE', url: `/api/competitions/${c.id}/signup`, headers: c.as('alice') })).json().error).toBe('signup_closed');

    const res = await c.remove('alice');
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ team_action: 'none', unlocked: false });
    const mine = await c.my('alice');
    expect(mine.state).toBe('none');
    expect(mine.signup.status).toBe('cancelled');
    const roster = await c.roster();
    expect(roster.stats).toMatchObject({ signups: 1, confirmed_people: 1 });
    expect(roster.signups.find((row: { account_id: string }) => row.account_id === c.accountId('alice'))).toMatchObject({ status: 'cancelled', cancelled_at: expect.any(Number) });

    const audit = activityRows(c.app, { action: 'competition.signup.remove' });
    expect(audit).toHaveLength(1);
    expect(audit[0]).toMatchObject({ surface: 'console', target_type: 'competition', target_id: c.id, outcome: 'ok' });
    expect(audit[0].meta).toEqual({ account_id: c.accountId('alice'), team_action: 'none', unlocked: false });
  });

  it('队员被移出：退出队伍，队伍和其他人不变；还没入队的人被移出时，待处理的申请一起关闭', async () => {
    const c = await setup();
    for (const login of ['alice', 'bob', 'carol', 'dave']) await c.signUp(c.id, login);
    const teamId = await c.createTeam('alice', '夜航星');
    await c.join(teamId, 'alice', 'bob');
    await c.join(teamId, 'alice', 'carol');

    const res = await c.remove('bob');
    expect(res.json()).toEqual({ team_action: 'left', unlocked: false });
    expect(c.memberStatus(teamId, 'bob')).toEqual({ status: 'left', role: 'member' });
    expect(c.teamRow(teamId)).toMatchObject({ status: 'recruiting', leader_account_id: c.accountId('alice') });
    const team = (await c.roster()).teams.find((row: { id: string }) => row.id === teamId);
    expect(team.members.map((member: { account_id: string }) => member.account_id)).toEqual([c.accountId('alice'), c.accountId('carol')]);
    expect((await c.my('bob')).state).toBe('none');

    expect((await c.app.inject({ method: 'POST', url: `/api/teams/${teamId}/apply`, headers: c.as('dave'), payload: {} })).statusCode).toBe(201);
    expect((await c.remove('dave')).json()).toEqual({ team_action: 'none', unlocked: false });
    expect(c.memberStatus(teamId, 'dave')).toEqual({ status: 'withdrawn', role: 'member' });
    expect((await c.my('alice')).pending).toEqual([]);
  });

  it('领队被移出：领队交给最早入队的队员，再退出', async () => {
    const c = await setup();
    for (const login of ['alice', 'bob', 'carol']) await c.signUp(c.id, login);
    const teamId = await c.createTeam('alice', '夜航星');
    await c.join(teamId, 'alice', 'bob');
    await c.join(teamId, 'alice', 'carol');

    const res = await c.remove('alice');
    expect(res.json()).toEqual({ team_action: 'transferred', unlocked: false });
    expect(c.teamRow(teamId)).toMatchObject({ status: 'recruiting', leader_account_id: c.accountId('bob') });
    expect(c.memberStatus(teamId, 'alice')).toEqual({ status: 'left', role: 'member' });
    const team = (await c.roster()).teams.find((row: { id: string }) => row.id === teamId);
    expect(team.members.map((member: { account_id: string; role: string }) => [member.account_id, member.role])).toEqual([
      [c.accountId('bob'), 'leader'], [c.accountId('carol'), 'member'],
    ]);
    // 新领队马上能管队伍
    expect((await c.my('bob')).actions).toContain('disband');
  });

  it('单人队的领队被移出：队伍解散', async () => {
    const c = await setup();
    await c.signUp(c.id, 'alice');
    const teamId = await c.createTeam('alice', '独行');
    const res = await c.remove('alice');
    expect(res.json()).toEqual({ team_action: 'disbanded', unlocked: false });
    expect(c.teamRow(teamId)).toMatchObject({ status: 'disbanded', locked_at: null });
    const roster = await c.roster();
    expect(roster.stats).toMatchObject({ signups: 0, teams: 0 });
    expect(roster.teams[0]).toMatchObject({ status: 'disbanded', disbanded_at: expect.any(Number) });
  });

  it('已确认的队伍掉到最低人数以下退回招募中；没掉下去的保持已确认', async () => {
    const c = await setup({ team_min: 2, team_max: 3 });
    for (const login of ['alice', 'bob', 'carol', 'dave', 'erin']) await c.signUp(c.id, login);
    const small = await c.createTeam('alice', '两人队');
    await c.join(small, 'alice', 'bob');
    await c.lock(small, 'alice');
    const big = await c.createTeam('carol', '三人队');
    await c.join(big, 'carol', 'dave');
    await c.join(big, 'carol', 'erin');
    await c.lock(big, 'carol');
    expect((await c.roster()).stats).toMatchObject({ locked_teams: 2, confirmed_people: 5 });
    // 本人在已确认的队伍里不能取消，管理员可以
    expect((await c.app.inject({ method: 'DELETE', url: `/api/competitions/${c.id}/signup`, headers: c.as('bob') })).json().error).toBe('team_locked');

    expect((await c.remove('bob')).json()).toEqual({ team_action: 'left', unlocked: true });
    expect(c.teamRow(small)).toMatchObject({ status: 'recruiting', locked_at: null });
    expect((await c.remove('carol')).json()).toEqual({ team_action: 'transferred', unlocked: false });
    expect(c.teamRow(big)).toMatchObject({ status: 'locked', leader_account_id: c.accountId('dave') });
    expect((await c.roster()).stats).toMatchObject({ signups: 3, teams: 2, locked_teams: 1, confirmed_people: 2, unplaced: 0 });
    expect((await c.my('alice')).state).toBe('in_team');
  });

  it('操作记录写不进去时整次移出回滚，重试成功', async () => {
    const c = await setup();
    for (const login of ['alice', 'bob']) await c.signUp(c.id, login);
    const teamId = await c.createTeam('alice', '夜航星');
    await c.join(teamId, 'alice', 'bob');
    const before = await c.roster();

    c.blockAudit();
    expect((await c.remove('alice')).statusCode).toBe(500);
    expect(await c.roster()).toEqual(before);
    expect(c.teamRow(teamId)).toMatchObject({ leader_account_id: c.accountId('alice') });
    expect(c.memberStatus(teamId, 'alice')).toEqual({ status: 'active', role: 'leader' });
    expect(activityRows(c.app, { action: 'competition.signup.remove' })).toHaveLength(0);

    c.unblockAudit();
    expect((await c.remove('alice')).json()).toEqual({ team_action: 'transferred', unlocked: false });
    expect(activityRows(c.app, { action: 'competition.signup.remove' })).toHaveLength(1);
  });
});

describe('移出后的名单、天梯与候选', () => {
  it('天梯与公开天梯不再列出这个人，队伍分不算他；积分记录保留', async () => {
    const c = await setup();
    for (const login of ['alice', 'bob', 'carol']) await c.signUp(c.id, login);
    const teamId = await c.createTeam('alice', '夜航星');
    await c.join(teamId, 'alice', 'bob');
    for (const [login, number] of [['alice', 1], ['bob', 2], ['carol', 3]] as const) {
      expect((await c.addScore(c.id, { account_id: c.accountId(login), kind: 'pr', repo: 'geek/admin', number, importance: 'important', core: 'business' })).statusCode).toBe(201);
    }
    const board = async () => (await c.app.inject({ url: `/api/competitions/${c.id}/leaderboard`, headers: c.as('carol') })).json();
    const publicBoard = async () => (await c.app.inject({ url: `/api/public/competitions/${c.id}/leaderboard` })).json();
    const before = await board();
    expect(before.individuals).toHaveLength(3);
    const teamPoints = before.teams[0].points;
    expect((await publicBoard()).individuals).toHaveLength(3); // 先读一次，公开接口有缓存

    expect((await c.remove('bob')).statusCode).toBe(200);
    const after = await board();
    expect(after.individuals.map((row: { person: { account_id: string } }) => row.person.account_id)).not.toContain(c.accountId('bob'));
    expect(after.individuals).toHaveLength(2);
    expect(after.teams[0].points).toBe(teamPoints / 2);
    expect((await publicBoard()).individuals.map((row: { username: string }) => row.username)).toEqual(expect.not.arrayContaining(['bob']));
    expect((await publicBoard()).individuals).toHaveLength(2);
    const events = (await c.app.inject({ url: `/api/console/competitions/${c.id}/score-events`, headers: c.as('owner') })).json().events;
    expect(events).toHaveLength(3);
    expect(events.every((event: { status: string }) => event.status === 'active')).toBe(true);
    const roster = await c.roster();
    expect(roster.stats).toMatchObject({ signups: 2, teams: 1, unplaced: 1 });
  });

  it('待确认贡献不再列出被移出的人，也不算进待确认数；候选行保留', async () => {
    const c = await setup();
    for (const login of ['alice', 'bob']) await c.signUp(c.id, login);
    grantPermNode(c.app, c.accountId('carol'), 'competition.score.review');
    const insert = c.db.prepare(`INSERT INTO competition_score_candidates(id, competition_id, account_id, kind, gitlab_project, gitlab_iid, url, title,
      status, contributed_at, created_at, updated_at) VALUES(?, ?, ?, 'pr', 'geek/admin', ?, ?, '合成候选', 'pending', ?, ?, ?)`);
    const now = Date.now();
    insert.run('00000000-0000-4000-8000-000000000001', c.id, c.accountId('alice'), 1, 'https://gitlab.test/geek/admin/-/merge_requests/1', now, now, now);
    insert.run('00000000-0000-4000-8000-000000000002', c.id, c.accountId('bob'), 2, 'https://gitlab.test/geek/admin/-/merge_requests/2', now, now + 1, now + 1);
    const list = async () => (await c.app.inject({ url: `/api/console/competitions/${c.id}/candidates?status=pending`, headers: c.as('carol') })).json();
    const pendingBadge = async () => (await c.app.inject({ url: '/api/console/summary', headers: c.as('carol') })).json().candidates_pending;
    expect((await list()).counts.pending).toBe(2);
    expect(await pendingBadge()).toBe(2);

    expect((await c.remove('bob')).statusCode).toBe(200);
    const page = await list();
    expect(page.items.map((row: { account: { account_id: string } }) => row.account.account_id)).toEqual([c.accountId('alice')]);
    expect(page.counts.pending).toBe(1);
    expect(await pendingBadge()).toBe(1);
    expect(c.db.prepare('SELECT COUNT(*) AS n FROM competition_score_candidates WHERE competition_id = ?').get(c.id)).toEqual({ n: 2 });
  });
});

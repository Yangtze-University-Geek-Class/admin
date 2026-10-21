// 比赛积分账本与天梯（#239 第二部分）：分值边界、重复与撤销、审计，以及天梯的排序与并列名次。
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import type { ServiceOverrides } from '../../app/server/src/services';
import { signIn, testApp } from './helpers';

const CONSOLE_ORG = 'Yangtze-University-Geek-Class';
const SEED_ID = 'oss-challenge-2026-1';
const contexts: Awaited<ReturnType<typeof testApp>>[] = [];
const dirs: string[] = [];
afterEach(async () => {
  for (const context of contexts.splice(0)) await context.close();
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

const USERS: Record<string, number> = { alice: 101, bob: 102, carol: 103, dave: 104 };
const HOUR = 3600_000;
const DAY = 24 * HOUR;

function github() {
  return (() => ({
    request: async (route: string, params: Record<string, string>) => {
      if (route !== 'GET /orgs/{org}/memberships/{username}' || params.org !== CONSOLE_ORG) {
        throw new Error(`Unexpected GitHub call ${route}`);
      }
      return { data: { state: 'active', role: params.username === 'alice' ? 'admin' : 'member' } };
    },
  })) as unknown as ServiceOverrides['octokitFactory'];
}

async function setup() {
  const context = await testApp({ octokitFactory: github() });
  contexts.push(context);
  const { app } = context;
  const sessions = new Map<string, string>();
  const as = (login: string) => {
    if (!sessions.has(login)) sessions.set(login, signIn(app, login, USERS[login], null));
    return { cookie: `sid=${sessions.get(login)!}` };
  };
  const accountId = (login: string) => {
    as(login);
    return app.services.auth.getSession(sessions.get(login)!)!.account_id;
  };
  /** 一场已开放报名、可组队、可计分的比赛（1–3 人）。 */
  const scoreCompetition = async (settings: Record<string, unknown> = {}) => {
    const now = Date.now();
    const created = await app.inject({
      method: 'POST', url: '/api/console/competitions', headers: as('alice'),
      payload: {
        name: '积分赛', kind: 'internal', start_at: now - HOUR, end_at: now + 30 * DAY,
        signup_deadline: now + 7 * DAY, url: null, description: '',
      },
    });
    expect(created.statusCode).toBe(201);
    const id = created.json().competition.id as string;
    const configured = await app.inject({
      method: 'PUT', url: `/api/console/competitions/${id}/signup-settings`, headers: as('alice'),
      payload: { enabled: true, participation: 'team', team_min: 1, team_max: 3, scoring: 'contribution', ...settings },
    });
    expect(configured.statusCode).toBe(200);
    return id;
  };
  const signUp = (id: string, login: string) =>
    app.inject({ method: 'POST', url: `/api/competitions/${id}/signup`, headers: as(login), payload: {} });
  const addScore = (id: string, payload: Record<string, unknown>) =>
    app.inject({ method: 'POST', url: `/api/console/competitions/${id}/score-events`, headers: as('alice'), payload });
  const revoke = (id: string, eventId: string, reason = '重复登记') =>
    app.inject({ method: 'POST', url: `/api/console/competitions/${id}/score-events/${eventId}/revoke`, headers: as('alice'), payload: { reason } });
  const board = async (id: string, login = 'alice') => {
    const res = await app.inject({ url: `/api/competitions/${id}/leaderboard`, headers: as(login) });
    expect(res.statusCode).toBe(200);
    return res.json();
  };
  const joinTeam = async (id: string, leader: string, login: string) => {
    const created = await app.inject({ method: 'POST', url: `/api/competitions/${id}/teams`, headers: as(leader), payload: { name: `${leader} 队` } });
    expect(created.statusCode).toBe(201);
    const teamId = created.json().team.id;
    expect((await app.inject({ method: 'POST', url: `/api/teams/${teamId}/apply`, headers: as(login), payload: {} })).statusCode).toBe(201);
    const pending = (await app.inject({ url: `/api/competitions/${id}/my-status`, headers: as(leader) })).json().pending;
    expect((await app.inject({
      method: 'POST', url: `/api/teams/${teamId}/respond`, headers: as(leader),
      payload: { membership_id: pending[0].membership_id, action: 'accept' },
    })).statusCode).toBe(200);
    return teamId as string;
  };
  return { app, as, accountId, scoreCompetition, signUp, addScore, revoke, board, joinTeam };
}

describe('seeded competition', () => {
  it('inserts the first open-source challenge once and never puts it back after deletion', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'geek-competition-seed-'));
    dirs.push(dir);
    const dbPath = join(dir, 'data.db');

    const first = await testApp({ octokitFactory: github() }, false, { DB_PATH: dbPath });
    try {
      const headers = { cookie: `sid=${signIn(first.app, 'alice', 101)}` };
      const listed = (await first.app.inject({ url: '/api/console/competitions', headers })).json().competitions;
      const seed = listed.find((row: { id: string }) => row.id === SEED_ID);
      expect(seed).toMatchObject({ name: '极客班开源实战贡献挑战赛 · 2026 第一期', kind: 'internal' });
      expect(seed.start_at).toBe(Date.parse('2026-10-21T00:00:00+08:00'));
      expect(seed.end_at).toBe(Date.parse('2026-11-15T23:59:59.999+08:00'));
      expect(seed.signup_deadline).toBe(seed.end_at);
      expect(seed.description).toContain('计分');

      const publicRow = (await first.app.inject({ url: '/api/public/competitions' })).json().competitions
        .find((row: { id: string }) => row.id === SEED_ID);
      expect(publicRow.signup).toEqual({ enabled: true, participation: 'team', team_min: 1, team_max: 3, scoring: 'contribution' });

      // 组织者删掉之后重启不再补
      expect((await first.app.inject({ method: 'DELETE', url: `/api/console/competitions/${SEED_ID}`, headers })).statusCode).toBe(200);
    } finally {
      await first.close();
    }

    const second = await testApp({ octokitFactory: github() }, false, { DB_PATH: dbPath });
    try {
      const headers = { cookie: `sid=${signIn(second.app, 'alice', 101)}` };
      const listed = (await second.app.inject({ url: '/api/console/competitions', headers })).json().competitions;
      expect(listed.map((row: { id: string }) => row.id)).not.toContain(SEED_ID);
      expect(second.app.services.storage.db.prepare("SELECT COUNT(*) AS n FROM console_seeds WHERE name = 'competition_oss_2026_1'").get())
        .toEqual({ n: 1 });
    } finally {
      await second.close();
    }
  });
});

describe('score events', () => {
  it('enforces the point ranges and repository shape of each kind', async () => {
    const { signUp, scoreCompetition, addScore, accountId } = await setup();
    const id = await scoreCompetition();
    await signUp(id, 'alice');
    const alice = accountId('alice');

    expect((await addScore(id, { account_id: alice, kind: 'issue', repo: 'org/repo', number: 1, points: 4 })).json().error).toBe('bad_points');
    expect((await addScore(id, { account_id: alice, kind: 'issue', repo: 'org/repo', number: 2, points: 31 })).json().error).toBe('bad_points');
    expect((await addScore(id, { account_id: alice, kind: 'pr', repo: 'org/repo', number: 3, points: 14 })).json().error).toBe('bad_points');
    expect((await addScore(id, { account_id: alice, kind: 'pr', repo: 'org/repo', number: 4, points: 101 })).statusCode).toBe(400);
    expect((await addScore(id, { account_id: alice, kind: 'penalty', points: -40 })).json().error).toBe('bad_points');
    expect((await addScore(id, { account_id: alice, kind: 'issue', number: 5, points: 5 })).json().error).toBe('bad_repo');
    expect((await addScore(id, { account_id: alice, kind: 'issue', repo: 'no-slash', number: 5, points: 5 })).json().error).toBe('bad_repo');
    expect((await addScore(id, { account_id: alice, kind: 'issue', repo: 'org/repo', number: 0, points: 5 })).statusCode).toBe(400);

    const edge = await addScore(id, { account_id: alice, kind: 'issue', repo: 'org/repo', number: 6, points: 30 });
    expect(edge.statusCode).toBe(201);
    expect(edge.json().event).toMatchObject({
      kind: 'issue', points: 30, repo: 'org/repo', number: 6, status: 'active', created_by_login: 'alice',
      person: { login: 'alice' }, revoked_at: null, revoke_reason: null, reason: '',
    });
    expect((await addScore(id, { account_id: alice, kind: 'pr', repo: 'org/repo', number: 7, points: 15 })).statusCode).toBe(201);
    expect((await addScore(id, { account_id: alice, kind: 'penalty', points: -50 })).statusCode).toBe(201);
  });

  it('refuses duplicates, unsigned-up members and competitions without scoring', async () => {
    const { signUp, scoreCompetition, addScore, revoke, accountId } = await setup();
    const id = await scoreCompetition();
    await signUp(id, 'alice');

    const payload = { account_id: accountId('alice'), kind: 'pr', repo: 'org/repo', number: 9, points: 20 };
    const created = await addScore(id, payload);
    expect(created.statusCode).toBe(201);
    const duplicate = await addScore(id, payload);
    expect(duplicate.statusCode).toBe(409);
    expect(duplicate.json().error).toBe('duplicate_score_event');

    // 撤销之后同一条可以重新登记
    expect((await revoke(id, created.json().event.id)).statusCode).toBe(200);
    expect((await addScore(id, payload)).statusCode).toBe(201);

    const notSignedUp = await addScore(id, { account_id: accountId('bob'), kind: 'issue', repo: 'org/repo', number: 10, points: 10 });
    expect(notSignedUp.statusCode).toBe(409);
    expect(notSignedUp.json().error).toBe('not_signed_up');

    const plain = await scoreCompetition({ scoring: 'none' });
    await signUp(plain, 'alice');
    const disabled = await addScore(plain, { account_id: accountId('alice'), kind: 'issue', repo: 'org/repo', number: 11, points: 10 });
    expect(disabled.statusCode).toBe(409);
    expect(disabled.json().error).toBe('scoring_not_enabled');
  });

  it('revokes once, keeps the trail, and audits both writes', async () => {
    const { app, signUp, scoreCompetition, addScore, revoke, accountId } = await setup();
    const id = await scoreCompetition();
    await signUp(id, 'alice');
    const created = (await addScore(id, {
      account_id: accountId('alice'), kind: 'issue', repo: 'org/repo', number: 12, points: 10, reason: '修了文档',
    })).json().event;

    const revoked = await revoke(id, created.id);
    expect(revoked.statusCode).toBe(200);
    expect(revoked.json().event).toMatchObject({
      id: created.id, status: 'revoked', revoked_at: expect.any(Number), revoke_reason: '重复登记', reason: '修了文档',
    });
    const again = await revoke(id, created.id);
    expect(again.statusCode).toBe(409);
    expect(again.json().error).toBe('already_revoked');
    expect((await revoke(id, 'missing-event')).statusCode).toBe(404);

    const actions = (app.services.storage.db
      .prepare("SELECT action FROM audit_logs WHERE action LIKE 'competition.score.%' ORDER BY id")
      .all() as { action: string }[]).map(row => row.action);
    expect(actions).toEqual(['competition.score.add', 'competition.score.revoke']);
  });

  it('lists events newest first and hides them from anonymous callers', async () => {
    const { app, as, signUp, scoreCompetition, addScore, accountId } = await setup();
    const id = await scoreCompetition();
    await signUp(id, 'alice');
    await addScore(id, { account_id: accountId('alice'), kind: 'issue', repo: 'org/one', number: 1, points: 5 });
    await addScore(id, { account_id: accountId('alice'), kind: 'issue', repo: 'org/two', number: 2, points: 6 });
    await addScore(id, { account_id: accountId('alice'), kind: 'penalty', points: -50 });

    const events = (await app.inject({ url: `/api/console/competitions/${id}/score-events`, headers: as('alice') })).json().events;
    expect(events.map((event: { kind: string }) => event.kind)).toEqual(['penalty', 'issue', 'issue']);
    expect(events[1].repo).toBe('org/two');

    expect((await app.inject({ url: `/api/console/competitions/${id}/score-events` })).statusCode).toBe(401);
    expect((await app.inject({ url: `/api/competitions/${id}/leaderboard` })).statusCode).toBe(401);
  });
});

describe('leaderboard', () => {
  it('ranks individuals by points with competition ranks, lists zero-point signups, and sums team points', async () => {
    const { signUp, scoreCompetition, addScore, board, joinTeam, accountId } = await setup();
    const id = await scoreCompetition();
    for (const login of ['alice', 'bob', 'carol', 'dave']) expect((await signUp(id, login)).statusCode).toBe(200);
    const teamId = await joinTeam(id, 'alice', 'bob');
    const alice = accountId('alice');

    await addScore(id, { account_id: alice, kind: 'pr', repo: 'org/alpha', number: 1, points: 50 });
    await addScore(id, { account_id: accountId('bob'), kind: 'pr', repo: 'org/beta', number: 2, points: 50 });
    await addScore(id, { account_id: accountId('carol'), kind: 'issue', repo: 'org/gamma', number: 3, points: 5 });

    const leaderboard = await board(id);
    expect(leaderboard.updated_at).toBeGreaterThan(0);
    expect(leaderboard.individuals.map((row: { person: { login: string } }) => row.person.login)).toEqual(['alice', 'bob', 'carol', 'dave']);
    expect(leaderboard.individuals.map((row: { rank: number }) => row.rank)).toEqual([1, 1, 3, 4]);
    expect(leaderboard.individuals.map((row: { points: number }) => row.points)).toEqual([50, 50, 5, 0]);
    expect(leaderboard.individuals[0]).toMatchObject({
      team: { id: teamId, name: 'alice 队' }, prs: 1, issues: 0, penalties: 0,
      person: { account_id: alice, login: 'alice' },
    });
    expect(leaderboard.individuals[2].team).toBeNull();
    expect(leaderboard.individuals[2]).toMatchObject({ issues: 1, prs: 0 });
    expect(leaderboard.teams).toEqual([
      { rank: 1, team: { id: teamId, name: 'alice 队', status: 'recruiting' }, points: 100, member_count: 2 },
    ]);

    // 扣分计入个人分，也计入队伍分
    await addScore(id, { account_id: accountId('carol'), kind: 'penalty', points: -50 });
    const afterPenalty = await board(id);
    expect(afterPenalty.individuals.find((row: { person: { login: string } }) => row.person.login === 'carol'))
      .toMatchObject({ points: -45, penalties: 1 });
  });

  it('drops revoked events and skips ranks on ties', async () => {
    const { signUp, scoreCompetition, addScore, revoke, board, accountId } = await setup();
    const id = await scoreCompetition();
    for (const login of ['alice', 'bob', 'carol']) await signUp(id, login);
    const first = (await addScore(id, {
      account_id: accountId('alice'), kind: 'pr', repo: 'org/alpha', number: 1, points: 50,
    })).json().event;
    await addScore(id, { account_id: accountId('carol'), kind: 'issue', repo: 'org/gamma', number: 2, points: 5 });

    expect((await revoke(id, first.id)).statusCode).toBe(200);
    const leaderboard = await board(id);
    expect(leaderboard.individuals.map((row: { points: number; rank: number }) => [row.points, row.rank]))
      .toEqual([[5, 1], [0, 2], [0, 2]]);
    expect(leaderboard.teams).toEqual([]);
  });

  it('refuses a competition without scoring', async () => {
    const { app, as, signUp, scoreCompetition } = await setup();
    const id = await scoreCompetition({ scoring: 'none' });
    await signUp(id, 'alice');
    const response = await app.inject({ url: `/api/competitions/${id}/leaderboard`, headers: as('alice') });
    expect(response.statusCode).toBe(409);
    expect(response.json().error).toBe('scoring_not_enabled');
  });
});

// #276 隔离演练：真实应用/存储/OAuth 路由，只替换外部 HTTP。此模块不被生产应用导入。
import assert from 'node:assert/strict';
import { randomBytes, randomUUID } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildApp, type BuildAppOptions } from '../app/server/src/app.js';
import { createConfig } from '../app/server/src/config.js';
import type { ServiceOverrides } from '../app/server/src/services.js';
import { enrollmentYearFor } from '../app/server/src/lib/grade.js';

const ROLES = ['owner', 'reviewer', 'redeemer', 'alice', 'bob'] as const;
type Role = typeof ROLES[number];
const isRole = (value: string): value is Role => ROLES.includes(value as Role);
const HOUR = 3600_000;
const GITLAB = 'https://gitlab.rehearsal.test';
type Contribution = { iid: number; author: { id: number }; title: string; web_url: string; labels: string[]; state: string; merged_at?: string; created_at?: string };

export async function createRehearsal(options: { port?: number; staticRoot?: BuildAppOptions['staticRoot'] } = {}) {
  const root = mkdtempSync(join(tmpdir(), 'geek-competition-rehearsal-'));
  const origin = `http://127.0.0.1:${options.port ?? 5198}`;
  const config = {
    ...createConfig({
      NODE_ENV: 'test', PUBLIC_ORIGIN: origin, DB_PATH: join(root, 'data.db'),
      SESSION_SECRET: randomBytes(48).toString('base64url'), ENCRYPTION_KEY: randomBytes(32).toString('base64'),
      OAUTH_CLIENT_ID: 'synthetic-client', OAUTH_CLIENT_SECRET: randomBytes(32).toString('hex'),
      POW_DIFFICULTY: '0', GITLAB_SYNC: 'on', GITLAB_URL: GITLAB, GITLAB_GROUP: 'rehearsal',
      GITLAB_API_TOKEN: randomBytes(32).toString('hex'),
    }),
    forumContentDir: fileURLToPath(new URL('../tests/server/fixtures/forum-content', import.meta.url)),
  };
  const deny = () => { throw new Error('External network is disabled in competition rehearsal'); };
  const mrs: Contribution[] = [], issues: Contribution[] = [];
  const gitlabSubjects = new Map<number, string>();
  const ids = new Map<Role, string>();
  const cookies = new Map<Role, string>();
  // 每个角色是一台设备：回调时带自己的访客 cookie（和真实浏览器一样）。没有 cookie 的注册按更严的 IP 额度算（#333），
  // 同一个 IP 上的五个角色不带 cookie 会被挡在第四个。
  const visitors = new Map<Role, string>();
  const visitorCookie = (role: Role) => {
    if (!visitors.has(role)) visitors.set(role, randomUUID());
    return `yugc_vid=${visitors.get(role)}`;
  };
  let competitionId = '';
  let app: Awaited<ReturnType<typeof buildApp>>;
  let closed = false;
  const userNumber = (role: Role) => 927600 + ROLES.indexOf(role);
  const httpRequest = (async (input: string, init: { body?: string; headers?: Record<string, string> } = {}) => {
    const url = new URL(input);
    if (url.origin === 'https://github.com' && url.pathname === '/login/oauth/access_token') {
      const role = JSON.parse(init.body ?? '{}').code as string;
      assert(isRole(role), 'synthetic OAuth code is not allowlisted');
      return { statusCode: 200, body: { json: async () => ({ access_token: `synthetic-${role}` }) } };
    }
    if (url.origin === 'https://api.github.com' && url.pathname === '/user') {
      const role = (init.headers?.Authorization ?? '').replace('Bearer synthetic-', '');
      assert(isRole(role), 'synthetic OAuth token is not allowlisted');
      return { statusCode: 200, body: { json: async () => ({ id: userNumber(role), login: `rehearsal_${role}`, avatar_url: '' }) } };
    }
    throw new Error('Unexpected OAuth HTTP request in rehearsal');
  }) as unknown as ServiceOverrides['httpRequest'];
  const gitlabFetch: NonNullable<ServiceOverrides['gitlabFetch']> = async (input, init) => {
    const url = new URL(String(input));
    assert.equal(url.origin, GITLAB);
    assert.equal(init?.redirect, 'error');
    assert.equal(init?.method ?? 'GET', 'GET');
    const path = url.pathname.replace(/^\/api\/v4/, '');
    let data: unknown;
    const user = /^\/users\/(\d+)$/.exec(path);
    if (user && gitlabSubjects.has(Number(user[1]))) {
      const id = Number(user[1]);
      const role = ROLES.find(item => userNumber(item) === id)!;
      data = { id, username: `rehearsal_${role}`, state: 'active', is_admin: false, bot: false,
        identities: [{ provider: 'openid_connect', extern_uid: gitlabSubjects.get(id) }] };
    } else if (path === '/projects/rehearsal%2Fcontest/merge_requests') data = mrs;
    else if (path === '/projects/rehearsal%2Fcontest/issues') data = issues;
    else if (/^\/projects\/rehearsal%2Fcontest\/(merge_requests|issues)\/[12]\/resource_label_events$/.test(path)) data = [];
    else throw new Error('Unexpected GitLab HTTP request in rehearsal');
    return new Response(JSON.stringify(data), { status: 200, headers: { 'content-type': 'application/json' } });
  };
  const headers = (role: Role) => ({ cookie: cookies.get(role)!, origin });
  const request = async (role: Role, method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE', url: string, expected: number, payload?: unknown) => {
    const response = await app.inject({ method, url, headers: headers(role), ...(payload === undefined ? {} : { payload: payload as Record<string, unknown> }) });
    assert.equal(response.statusCode, expected, `${method} ${url}: ${response.body}`);
    return response.json();
  };
  async function oauth(role: Role) {
    const started = await app.inject(`/auth/github?return_to=${encodeURIComponent(`${origin}/?open=competitions&competition=${competitionId}`)}`);
    assert.equal(started.statusCode, 302);
    const state = new URL(String(started.headers.location)).searchParams.get('state')!;
    const cookie = ([] as string[]).concat(started.headers['set-cookie'] ?? []).find(value => value.startsWith('oauth_state='))!.split(';')[0];
    const signed = await app.inject({ url: `/auth/callback?code=${role}&state=${encodeURIComponent(state)}`, headers: { cookie: `${cookie}; ${visitorCookie(role)}` } });
    const setCookies = ([] as string[]).concat(signed.headers['set-cookie'] ?? []);
    const sid = setCookies.find(value => value.startsWith('sid='));
    assert.equal(signed.statusCode, 302);
    assert(sid, 'real OAuth callback must issue a session');
    cookies.set(role, sid.split(';')[0]);
    return { setCookies, location: String(signed.headers.location) };
  }
  async function login(role: Role) {
    await oauth(role);
    return headers(role);
  }
  function contribute() {
    const at = new Date(Date.now() - 30 * 60_000).toISOString();
    mrs.splice(0, mrs.length, { iid: 1, author: { id: userNumber('alice') }, title: '合成核心功能', web_url: `${GITLAB}/rehearsal/contest/-/merge_requests/1`, labels: [], state: 'merged', merged_at: at });
    issues.splice(0, issues.length, { iid: 2, author: { id: userNumber('bob') }, title: '合成缺陷报告', web_url: `${GITLAB}/rehearsal/contest/-/issues/2`, labels: ['有用'], state: 'opened', created_at: at });
    return { merge_requests: 1, issues: 1 };
  }
  async function end() {
    return request('owner', 'PATCH', `/api/console/competitions/${competitionId}`, 200, {
      end_at: Date.now() - 1, signup_deadline: Date.now() - 2,
    });
  }
  const status = () => ({
    competition_id: competitionId, local: true, synthetic: true,
    portal: `/?open=competitions&competition=${competitionId}`,
    console: `/console/competitions/${competitionId}`,
    roles: ROLES.map(role => ({ role, login: `/__rehearsal/login/${role}` })),
    controls: { contribute: 'POST /__rehearsal/contribute', end: 'POST /__rehearsal/end' },
  });
  async function open() {
    const instance = await buildApp({
      config, staticRoot: options.staticRoot, mailWorker: false, gitlabSync: false, sessionCleanup: false,
      overrides: { httpRequest, gitlabFetch, octokitFactory: deny, githubProfileFetch: deny, mailFetch: deny },
    });
    // 只注册于本机演练工厂；生产 buildApp 不包含这些入口。
    instance.get('/__rehearsal/status', async () => status());
    instance.get<{ Params: { role: string } }>('/__rehearsal/login/:role', async (req, reply) => {
      if (!isRole(req.params.role)) return reply.code(404).send({ error: 'not_found' });
      const signed = await oauth(req.params.role);
      return reply.header('set-cookie', signed.setCookies).redirect(signed.location);
    });
    instance.post('/__rehearsal/contribute', async () => contribute());
    instance.post('/__rehearsal/end', async () => { await end(); return { ended: true }; });
    await instance.ready();
    return instance;
  }
  async function restart() {
    await app.close();
    app = await open();
  }
  async function close() {
    if (closed) return;
    closed = true;
    try { await app?.close(); } finally { rmSync(root, { recursive: true, force: true }); }
  }
  try {
    app = await open();
    app.services.oidcStore.registerClient({ name: 'GitLab', clientId: 'gitlab', redirectUris: [`${GITLAB}/users/auth/openid_connect/callback`] });
    for (const role of ROLES) {
      await login(role);
      const me = await request(role, 'GET', '/auth/me', 200);
      ids.set(role, me.account_id);
      app.services.identity.setSiteRole({ accountId: me.account_id, role: role === 'owner' ? 'admin' : 'member', actor: 'rehearsal' });
      app.services.profiles.setRealInfo(me.account_id, '演练同学', enrollmentYearFor(role === 'alice' ? 1 : 2));
      const nodes = role === 'reviewer' ? ['console.access', 'competition.score.review']
        : role === 'redeemer' ? ['console.access', 'competition.prize.redeem'] : [];
      for (const node of nodes) app.services.storage.db.prepare(
        "INSERT INTO perm_entries(subject_type, subject_id, node, value, scope, granted_by, created_at) VALUES ('account', ?, ?, 1, '{}', 'rehearsal', ?)",
      ).run(me.account_id, node, Date.now());
      app.services.storage.db.prepare(
        "INSERT INTO gitlab_accounts(account_id, gitlab_user_id, username, state, created_at, updated_at) VALUES (?, ?, ?, 'active', ?, ?)",
      ).run(me.account_id, userNumber(role), `rehearsal_${role}`, Date.now(), Date.now());
      gitlabSubjects.set(userNumber(role), app.services.oidcStore.subjectFor('gitlab.rehearsal.test', me.account_id));
    }
    app.services.permissions.bump();
    const now = Date.now();
    competitionId = (await request('owner', 'POST', '/api/console/competitions', 201, {
      name: '内部个人演练赛', kind: 'internal', start_at: now - HOUR, end_at: now + HOUR,
      signup_deadline: now + HOUR, description: '合成数据隔离演练',
    })).competition.id;
    await request('owner', 'PUT', `/api/console/competitions/${competitionId}/signup-settings`, 200, {
      enabled: true, participation: 'individual', team_min: 1, team_max: 1, scoring: 'contribution',
    });
    const rules = await request('owner', 'GET', `/api/console/competitions/${competitionId}/rules`, 200);
    await request('owner', 'PUT', `/api/console/competitions/${competitionId}/rules`, 200, {
      grade_factors: rules.grade_factors, gitlab_projects: ['rehearsal/contest'],
      prizes: [{ from: 1, to: 2, amount_cny: 1, title: '演练奖励' }],
    });
  } catch (error) { await close(); throw error; }

  async function complete() {
    for (const role of ['alice', 'bob'] as const) {
      await login(role);
      await request(role, 'POST', `/api/competitions/${competitionId}/signup`, 200, {});
    }
    contribute();
    const run = await request('reviewer', 'POST', `/api/console/competitions/${competitionId}/candidates/collect`, 200);
    assert.equal(run.last_run.error, null);
    assert.equal(run.last_run.created, 2);
    const candidates = await request('reviewer', 'GET', `/api/console/competitions/${competitionId}/candidates`, 200);
    for (const row of candidates.items) await request('reviewer', 'POST', `/api/console/competitions/${competitionId}/candidates/${row.id}/accept`, 200, {
      importance: row.kind === 'pr' ? 'critical' : 'normal', core: row.kind === 'pr' ? 'core' : 'business',
    });
    const board = await request('alice', 'GET', `/api/competitions/${competitionId}/leaderboard`, 200);
    assert.deepEqual(board.individuals.map((row: { points: number }) => row.points), [350, 18]);
    const publicBoard = (await app.inject(`/api/public/competitions/${competitionId}/leaderboard`)).json();
    assert.deepEqual(publicBoard.individuals.map((row: { score: number }) => row.score), [350, 18]);
    await end();
    const final = await request('owner', 'POST', `/api/console/competitions/${competitionId}/final`, 201);
    assert.equal(final.prizes.length, 2);
    const mine = await request('alice', 'GET', '/api/me/competition-results', 200);
    const code = mine.items[0].prize.code as string;
    assert(!JSON.stringify(final).includes(code));
    const bob = await request('bob', 'GET', '/api/me/competition-results', 200);
    assert(!JSON.stringify(bob).includes(code));
    await request('redeemer', 'POST', '/api/console/prizes/lookup', 200, { code });
    await request('redeemer', 'POST', '/api/console/prizes/redeem', 200, { code });
    await request('redeemer', 'POST', '/api/console/prizes/redeem', 409, { code });
    await request('owner', 'DELETE', `/api/console/competitions/${competitionId}/final`, 409);
    return { participants: 2, candidates: 2, scores: [350, 18], prizes: 2, redeemed: 1 };
  }
  return { get app() { return app; }, get competitionId() { return competitionId; }, origin, status, login, complete, restart, close };
}

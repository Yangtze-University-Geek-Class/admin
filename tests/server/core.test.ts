import { afterEach, beforeEach, expect, it } from 'vitest';
import type { ServiceOverrides } from '../../app/server/src/services';
import { safeReturnTo } from '../../app/server/src/lib/safe-return';
import { withTimeout } from '../../app/server/src/lib/github';
import { ADMIN_SPA_ENTRY, ADMIN_SPA_PATHS, PORTAL_SPA_ENTRY, buildApp, resolveSiteEntry } from '../../app/server/src/app';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { testApp, testConfig } from './helpers';
const contexts: Awaited<ReturnType<typeof testApp>>[] = [];
async function setup(overrides?: ServiceOverrides, production = false) { const c = await testApp(overrides, production); contexts.push(c); return c; }
afterEach(async () => { for (const c of contexts.splice(0)) await c.close(); });

it('isolates the core database and does not instantiate any retired forum services', async () => {
  const a = await setup(); const b = await setup();
  a.app.services.auth.createSession('isolated-user', 1, null, 'test-token');
  expect(b.app.services.storage.db.prepare('SELECT COUNT(*) AS n FROM sessions').get()).toEqual({ n: 0 });
  expect('forumDb' in a.app.services).toBe(false);
  expect('forumAuth' in a.app.services).toBe(false);
  expect(a.app.server.listening).toBe(false);
  expect((await a.app.inject('/healthz')).statusCode).toBe(200);
});
it.each(['/api/forum/me', '/api/forum/threads', '/auth/forum/github', '/forum/u/legacy.svg'])('retires %s instead of serving fake replacement data', async url => {
  const { app } = await setup(); const response = await app.inject(url);
  expect(response.statusCode).toBe(410); expect(response.json().error).toBe('legacy_forum_retired');
});
it('rejects old forum writes and does not redirect an old topic ID to an unrelated new topic', async () => {
  const { app } = await setup();
  // 旧论坛的写接口仍是 410；/api/forum/posts 现在是新论坛接口（#57），不再是退役路径。
  for (const url of ['/api/forum/threads', '/api/forum/threads/1/posts', '/api/forum/upload']) {
    const response = await app.inject({ method: 'POST', url, payload: { content: 'retired' } });
    expect(response.statusCode).toBe(410); expect(response.json().error).toBe('legacy_forum_retired');
  }
  expect((await app.inject({ method: 'POST', url: '/api/forum/posts', payload: { content: 'retired' } })).json().error).toBe('validation_error');
  const redirect = await app.inject('/forum/t/73');
  expect(redirect.statusCode).toBe(302); expect(redirect.headers.location).toBe('http://127.0.0.1:3456/');
});
it('fails closed rather than publishing the mock as a production forum', async () => {
  const { app } = await setup(undefined, true);
  expect((await app.inject('/forum')).statusCode).toBe(503);
});
it('serves only real allowlisted public documents', async () => {
  const { app } = await setup(); const response = await app.inject('/api/docs');
  expect(response.statusCode).toBe(200); expect(response.json().items).toHaveLength(4);
  for (const id of ['readme', 'readme-en', 'usage', 'usage-en']) {
    const document = await app.inject(`/api/docs/${id}`); expect(document.statusCode).toBe(200); expect(document.json().content.length).toBeGreaterThan(100);
  }
  expect((await app.inject('/api/docs/security')).statusCode).toBe(404);
});
it('preserves authentication and cross-origin protection for organization management', async () => {
  const { app } = await setup();
  expect((await app.inject('/api/admin/example/repos')).statusCode).toBe(401);
  expect((await app.inject({ method: 'POST', url: '/auth/signout', headers: { origin: 'https://untrusted.test' } })).statusCode).toBe(403);
  // 管理端与官网同源：只放行环境唯一的 origin，退役的管理端子域一律拒绝。
  expect((await app.inject({ method: 'POST', url: '/auth/signout', headers: { origin: 'https://admin.example.test' } })).statusCode).toBe(403);
  expect((await app.inject({ method: 'POST', url: '/auth/signout', headers: { origin: 'https://example.test' } })).statusCode).toBe(200);
  expect((await app.inject('/auth/me')).headers['cache-control']).toBe('no-store');
});
it('preserves core sessions without minting or reading old forum sessions', async () => {
  const { app } = await setup(); const sid = app.services.auth.createSession('test-user', 5, null, 'test-access');
  const headers = { cookie: `sid=${sid}` };
  expect((await app.inject({ url: '/auth/me', headers })).json().login).toBe('test-user');
  expect((await app.inject({ method: 'POST', url: '/auth/signout', headers })).statusCode).toBe(200);
  expect((await app.inject({ url: '/auth/me', headers })).json().signed_in).toBe(false);
});
it('rejects a tampered OAuth state before calling an external provider', async () => {
  const { app } = await setup(); const start = await app.inject('/auth/github?return_to=https://untrusted.test/');
  const state = new URL(String(start.headers.location)).searchParams.get('state');
  expect((await app.inject({ url: `/auth/callback?code=test&state=${state}`, headers: { cookie: 'oauth_state=tampered' } })).statusCode).toBe(400);
});
/** 假的 GitHub：换 token、取用户、撤销授权（204）；calls 记下每次请求的方法、地址和 Authorization */
const providerCalls: { method: string; url: string; authorization?: string; body?: string }[] = [];
const stubProvider = (async (url: string, options: { method?: string; headers?: Record<string, string>; body?: string } = {}) => {
  providerCalls.push({ method: options.method ?? 'GET', url, authorization: options.headers?.Authorization, body: options.body });
  if (url.includes('/grant')) return { statusCode: 204, body: { dump: async () => undefined } };
  return { statusCode: 200, body: { json: async () => url.includes('/access_token') ? { access_token: 'test-provider-token' } : { id: 7, login: 'test-github-user', avatar_url: '' } } };
}) as unknown as ServiceOverrides['httpRequest'];
beforeEach(() => { providerCalls.length = 0; });
/** 登录时查的是「当前用户自己在组织里的成员状态」；state 为 null 表示 404（不是成员） */
const membershipStub = (state: 'active' | 'pending' | null, seen: string[] = []) => (() => ({
  request: async (route: string, params: { org?: string }) => {
    seen.push(`${route} ${params.org}`);
    if (state === null) throw Object.assign(new Error('Not Found'), { status: 404 });
    return { data: { state, role: 'member' } };
  },
})) as unknown as ServiceOverrides['octokitFactory'];
async function startSignIn(app: Awaited<ReturnType<typeof setup>>['app'], returnTo?: string) {
  const start = await app.inject(returnTo ? `/auth/github?return_to=${encodeURIComponent(returnTo)}` : '/auth/github');
  const state = new URL(String(start.headers.location)).searchParams.get('state');
  return { state, cookie: String(start.headers['set-cookie']).split(';')[0] };
}
const setCookies = (response: { headers: Record<string, unknown> }) => ([] as string[]).concat((response.headers['set-cookie'] as string[] | string | undefined) ?? []);

it('completes the real core callback with a stub provider and issues only sid', async () => {
  const httpRequest = stubProvider;
  const seen: string[] = [];
  const { app } = await setup({ httpRequest, octokitFactory: membershipStub('active', seen) }); const start = await app.inject('/auth/github');
  const authorize = new URL(String(start.headers.location));
  // OAuth 回调固定在环境唯一的 origin 下：GitHub OAuth App 登记的就是这一条。
  expect(authorize.searchParams.get('redirect_uri')).toBe('https://example.test/auth/callback');
  const state = authorize.searchParams.get('state');
  const cookie = String(start.headers['set-cookie']).split(';')[0];
  const response = await app.inject({ url: `/auth/callback?code=isolated&state=${state}`, headers: { cookie } });
  expect(response.statusCode).toBe(302);
  expect(response.headers.location).toBe('https://example.test/console');
  const cookies = ([] as string[]).concat(response.headers['set-cookie'] || []);
  expect(cookies.some(c => c.startsWith('sid='))).toBe(true);
  expect(cookies.some(c => c.startsWith('forum_sid='))).toBe(false);
  // 成员身份按 CONSOLE_ORG 查，而且查的是用户自己（/user/memberships），不是按用户名去查别人
  expect(seen).toEqual(['GET /user/memberships/orgs/{org} Yangtze-University-Geek-Class']);
});
it('returns a member to the page that started the sign-in', async () => {
  const { app } = await setup({ httpRequest: stubProvider, octokitFactory: membershipStub('active') });
  const { state, cookie } = await startSignIn(app, 'https://example.test/forum/t/12?page=2');
  const response = await app.inject({ url: `/auth/callback?code=ok&state=${state}`, headers: { cookie } });
  expect(response.statusCode).toBe(302);
  expect(response.headers.location).toBe('https://example.test/forum/t/12?page=2');
  expect(setCookies(response).some(c => c.startsWith('sid='))).toBe(true);
  // 成员的授权不撤销
  expect(providerCalls.some(call => call.url.includes('/grant'))).toBe(false);
});
it.each([
  ['not a member of the organization', null, 'not_member'],
  ['invited but has not accepted yet', 'pending', 'invite_pending'],
] as const)('refuses to sign in a GitHub user who is %s and says why on the original page', async (_case, membership, outcome) => {
  const { app } = await setup({ httpRequest: stubProvider, octokitFactory: membershipStub(membership) });
  const { state, cookie } = await startSignIn(app, 'https://example.test/forum/');
  const response = await app.inject({ url: `/auth/callback?code=ok&state=${state}`, headers: { cookie } });
  expect(response.statusCode).toBe(302);
  expect(response.headers.location).toBe(`https://example.test/forum/?signin=${outcome}`);
  expect(setCookies(response).some(c => c.startsWith('sid='))).toBe(false);
  expect(app.services.storage.db.prepare('SELECT COUNT(*) AS n FROM sessions').get()).toEqual({ n: 0 });
  const denied = app.services.storage.db.prepare("SELECT actor, details FROM audit_logs WHERE action = 'auth.signin_denied'").get() as { actor: string; details: string };
  expect(denied.actor).toBe('test-github-user');
  expect(JSON.parse(denied.details)).toEqual({ org: 'Yangtze-University-Geek-Class', reason: membership ?? 'not_member' });
  // 被拒的人在 GitHub 上的授权被撤掉：用应用自己的 client_id:client_secret，撤的是这次换到的 token 所属的 grant
  const revoke = providerCalls.find(call => call.url.includes('/grant'));
  expect(revoke).toMatchObject({ method: 'DELETE', url: 'https://api.github.com/applications/test-client/grant' });
  expect(revoke?.authorization).toBe(`Basic ${Buffer.from('test-client:test-only-placeholder').toString('base64')}`);
  expect(JSON.parse(revoke?.body ?? '{}')).toEqual({ access_token: 'test-provider-token' });
});
it('still sends a refused user back with the reason when revoking the grant fails', async () => {
  const revokeFails = (async (url: string, options: { method?: string } = {}) => {
    if (url.includes('/grant')) throw Object.assign(new Error('connect timeout'), { code: 'UND_ERR_CONNECT_TIMEOUT', method: options.method });
    return { statusCode: 200, body: { json: async () => url.includes('/access_token') ? { access_token: 'test-provider-token' } : { id: 7, login: 'test-github-user', avatar_url: '' } } };
  }) as unknown as ServiceOverrides['httpRequest'];
  const { app } = await setup({ httpRequest: revokeFails, octokitFactory: membershipStub(null) });
  const { state, cookie } = await startSignIn(app, 'https://example.test/forum/');
  const response = await app.inject({ url: `/auth/callback?code=ok&state=${state}`, headers: { cookie } });
  expect(response.headers.location).toBe('https://example.test/forum/?signin=not_member');
  expect(setCookies(response).some(c => c.startsWith('sid='))).toBe(false);
});
it('gives every GitHub API call a timeout, because Octokit ignores request.timeout', async () => {
  const hanging = ((_input: unknown, init?: { signal?: AbortSignal }) => new Promise((_resolve, reject) => {
    init?.signal?.addEventListener('abort', () => reject(init.signal?.reason));
  })) as unknown as typeof fetch;
  await expect(withTimeout(hanging, 20)('https://api.github.com/user/memberships/orgs/x')).rejects.toMatchObject({ name: 'TimeoutError' });
  // 调用方自己的 signal 仍然生效
  const own = new AbortController();
  const pending = withTimeout(hanging, 60_000)('https://api.github.com/user', { signal: own.signal });
  own.abort(new Error('caller cancelled'));
  await expect(pending).rejects.toThrow('caller cancelled');
});
it('goes back to the original page instead of a JSON error when GitHub cannot be reached', async () => {
  const unreachable = (async () => { throw Object.assign(new Error('connect timeout'), { code: 'UND_ERR_CONNECT_TIMEOUT' }); }) as unknown as ServiceOverrides['httpRequest'];
  const { app } = await setup({ httpRequest: unreachable });
  const { state, cookie } = await startSignIn(app, 'https://example.test/forum/');
  const response = await app.inject({ url: `/auth/callback?code=ok&state=${state}`, headers: { cookie } });
  expect(response.statusCode).toBe(302);
  expect(response.headers.location).toBe('https://example.test/forum/?signin=failed');
  expect(setCookies(response).some(c => c.startsWith('sid='))).toBe(false);
});
it('does not treat a failed membership lookup as "not a member"', async () => {
  const forbidden = (() => ({ request: async () => { throw Object.assign(new Error('OAuth App access restricted'), { status: 403 }); } })) as unknown as ServiceOverrides['octokitFactory'];
  const { app } = await setup({ httpRequest: stubProvider, octokitFactory: forbidden });
  const { state, cookie } = await startSignIn(app, 'https://example.test/forum/');
  const response = await app.inject({ url: `/auth/callback?code=ok&state=${state}`, headers: { cookie } });
  // 403 不能当成「不是成员」：成员也会被组织的 OAuth App 限制挡住，这时只能说登录没完成
  expect(response.headers.location).toBe('https://example.test/forum/?signin=failed');
  expect(setCookies(response).some(c => c.startsWith('sid='))).toBe(false);
});
it('takes a cancelled GitHub authorization back to the original page', async () => {
  const { app } = await setup();
  const { state, cookie } = await startSignIn(app, 'https://example.test/forum/');
  const response = await app.inject({ url: `/auth/callback?error=access_denied&state=${state}`, headers: { cookie } });
  expect(response.statusCode).toBe(302);
  expect(response.headers.location).toBe('https://example.test/forum/?signin=cancelled');
  // 没有有效 state 的错误回调仍然就地拒绝，不跳到任何地方
  expect((await app.inject('/auth/callback?error=access_denied&state=forged')).statusCode).toBe(400);
  expect((await app.inject('/auth/callback?error=access_denied')).statusCode).toBe(400);
});
it('keeps return targets on the single public origin', async () => {
  const { app } = await setup(); const config = app.services.config;
  expect(safeReturnTo('//untrusted.test/', config, '/safe')).toBe('/safe');
  expect(safeReturnTo('/admin/demo', config, '/safe')).toBe('https://example.test/admin/demo');
  expect(safeReturnTo('https://example.test/forum/', config, '/safe')).toBe('https://example.test/forum/');
  // 退役的管理端子域和其它子域都不再是合法回跳目标。
  for (const raw of ['https://admin.example.test/admin', 'https://forum.example.test/', 'http://example.test/admin', 'https://user@example.test/admin']) {
    expect(safeReturnTo(raw, config, '/safe')).toBe('/safe');
  }
});
it.each([
  ['/admin', 'admin'], ['/admin/', 'admin'], ['/admin/demo/repos', 'admin'], ['/admin/signin?return_to=/admin', 'admin'],
  ['/console', 'admin'], ['/console/people', 'admin'], ['/signin', 'admin'],
  ['/', 'portal'], ['/join-us', 'portal'], ['/join/abc', 'portal'], ['/docs/usage', 'portal'], ['/administrator', 'portal'],
  ['/consoles', 'portal'], ['/signin/extra', 'portal'], ['/?next=/admin', 'portal'],
])('picks the SPA entry for %s by path only (%s), never by host', (url, site) => {
  expect(resolveSiteEntry(url)).toBe(site === 'admin' ? ADMIN_SPA_ENTRY : PORTAL_SPA_ENTRY);
});
it('keeps the admin path list and entry file in one place', () => {
  expect(ADMIN_SPA_PATHS).toEqual({ exact: ['/signin'], prefixes: ['/admin', '/console'] });
  // 管理端是 Vue 控制台（app/console），入口在它自己的产物里。
  expect([ADMIN_SPA_ENTRY, PORTAL_SPA_ENTRY]).toEqual(['sites/console/index.html', 'sites/portal/index.html']);
});
it('serves the console or portal index for deep links on the same host', async () => {
  const root = mkdtempSync(join(tmpdir(), 'geek-site-entry-'));
  try {
    for (const site of ['portal', 'console']) {
      mkdirSync(join(root, 'sites', site), { recursive: true });
      writeFileSync(join(root, 'sites', site, 'index.html'), `<main data-entry="${site}"></main>`);
    }
    const config = testConfig({
      NODE_ENV: 'test', PUBLIC_ORIGIN: 'https://example.test', DB_PATH: ':memory:', FORUM_DB_PATH: ':memory:',
      SESSION_SECRET: 'isolated-core-test-secret-at-least-32', ENCRYPTION_KEY: Buffer.alloc(32, 1).toString('base64'),
      OAUTH_CLIENT_ID: 'test-client', OAUTH_CLIENT_SECRET: 'test-only-placeholder', POW_DIFFICULTY: '0',
    });
    const app = await buildApp({ config, staticRoot: root });
    try {
      for (const [url, site] of [['/admin/demo', 'console'], ['/console/people', 'console'], ['/signin', 'console'], ['/join-us', 'portal']]) {
        const response = await app.inject({ url, headers: { host: 'example.test' } });
        expect(response.statusCode).toBe(200);
        expect(response.body).toContain(`data-entry="${site}"`);
      }
    } finally { await app.close(); }
  } finally { rmSync(root, { recursive: true, force: true }); }
});
it('lists admin feedback without the submitter IP, user agent or numeric account id', async () => {
  const octokitFactory = (() => ({ request: async () => ({ data: { state: 'active', role: 'admin' } }) })) as unknown as ServiceOverrides['octokitFactory'];
  const { app } = await setup({ octokitFactory }); const now = Date.now();
  app.services.storage.db.prepare('INSERT INTO feedback(org,content,category,contact,submitter_login,submitter_id,source_ip,user_agent,status,votes,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?)')
    .run('test-org', 'test feedback body', '建议', 'test-contact', 'test-student', 424242, '203.0.113.9', 'test-agent/1.0', 'open', 3, now, now);
  const sid = app.services.auth.createSession('test-admin', 1, null, 'test-access');
  const response = await app.inject({ url: '/api/admin/test-org/feedback', headers: { cookie: `sid=${sid}` } });
  expect(response.statusCode).toBe(200);
  const { items, counts } = response.json();
  expect(counts).toEqual({ open: 1 });
  expect(Object.keys(items[0]).sort()).toEqual(['category', 'contact', 'content', 'created_at', 'id', 'replied_at', 'replied_by', 'reply', 'status', 'submitter_login']);
  expect(response.body).not.toMatch(/203\.0\.113\.9|test-agent|424242/);
});
it('rejects invalid feedback data before persistence', async () => {
  const { app } = await setup();
  expect((await app.inject({ method: 'POST', url: '/api/feedback', payload: { org: 'demo', content: {} } })).statusCode).toBe(400);
});
it('bounds the public feedback limit: only 1–9999 is accepted, then capped at 100', async () => {
  const { app } = await setup();
  const insert = app.services.storage.db.prepare("INSERT INTO feedback(org, content, status, created_at, updated_at) VALUES('demo', ?, 'open', ?, ?)");
  for (let i = 0; i < 120; i++) insert.run(`意见 ${i}`, i, i);
  const count = async (query: string) => {
    const response = await app.inject({ url: `/api/feedback/public?org=demo${query}` });
    return response.statusCode === 200 ? response.json().items.length : response.statusCode;
  };
  expect(await count('')).toBe(20);
  expect(await count('&limit=5')).toBe(5);
  expect(await count('&limit=9999')).toBe(100);
  // 负数、0、小数、非数字都在公共 querystring 校验里 400，不会取消行数上限，也不会 500（#130）
  for (const bad of ['-1', '0', '1.5', 'abc', '10000']) expect(await count(`&limit=${bad}`)).toBe(400);
});
it('serves the portal and the console from two separate build outputs', async () => {
  const root = mkdtempSync(join(tmpdir(), 'geek-static-'));
  const web = join(root, 'web'); const consoleDist = join(root, 'console');
  mkdirSync(join(web, 'sites/portal'), { recursive: true }); mkdirSync(join(web, 'assets'), { recursive: true });
  mkdirSync(join(consoleDist, 'sites/console'), { recursive: true }); mkdirSync(join(consoleDist, 'console-assets'), { recursive: true });
  writeFileSync(join(web, 'sites/portal/index.html'), 'portal-index');
  writeFileSync(join(web, 'assets/portal.js'), 'portal-js');
  writeFileSync(join(consoleDist, 'sites/console/index.html'), 'console-index');
  writeFileSync(join(consoleDist, 'console-assets/app.js'), 'console-js');
  const { app: base } = await setup();
  const app = await buildApp({ config: base.services.config, staticRoot: [web, consoleDist] });
  try {
    const body = async (url: string) => (await app.inject({ url, headers: { host: 'example.test' } })).body;
    expect(await body('/console/people')).toBe('console-index');
    expect(await body('/admin')).toBe('console-index');
    expect(await body('/signin')).toBe('console-index');
    expect(await body('/apply')).toBe('portal-index');
    expect(await body('/console-assets/app.js')).toBe('console-js');
    expect(await body('/assets/portal.js')).toBe('portal-js');
    expect((await app.inject('/console-assets/missing.js')).statusCode).toBe(404);
  } finally {
    await app.close();
    rmSync(root, { recursive: true, force: true });
  }
});

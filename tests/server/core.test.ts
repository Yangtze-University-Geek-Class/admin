import { afterEach, expect, it } from 'vitest';
import type { ServiceOverrides } from '../../app/server/src/services';
import { safeReturnTo } from '../../app/server/src/lib/safe-return';
import { resolveSiteEntry } from '../../app/server/src/app';
import { testApp } from './helpers';
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
  expect((await app.inject({ method: 'POST', url: '/api/forum/posts', payload: { content: 'retired' } })).statusCode).toBe(410);
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
it('completes the real core callback with a stub provider and issues only sid', async () => {
  const httpRequest = (async (url: string) => ({ statusCode: 200, body: { json: async () => url.includes('/access_token') ? { access_token: 'test-provider-token' } : { id: 7, login: 'test-github-user', avatar_url: '' } } })) as unknown as ServiceOverrides['httpRequest'];
  const { app } = await setup({ httpRequest }); const start = await app.inject('/auth/github');
  const state = new URL(String(start.headers.location)).searchParams.get('state');
  const cookie = String(start.headers['set-cookie']).split(';')[0];
  const response = await app.inject({ url: `/auth/callback?code=isolated&state=${state}`, headers: { cookie } });
  expect(response.statusCode).toBe(302);
  const cookies = ([] as string[]).concat(response.headers['set-cookie'] || []);
  expect(cookies.some(c => c.startsWith('sid='))).toBe(true);
  expect(cookies.some(c => c.startsWith('forum_sid='))).toBe(false);
});
it('keeps safe return origins and no longer resolves a React forum entry', async () => {
  const { app } = await setup();
  expect(safeReturnTo('//untrusted.test/', app.services.config, '/safe')).toBe('/safe');
  expect(resolveSiteEntry(app.services.config, 'example.test', '/')).toBe('sites/portal/index.html');
  expect(resolveSiteEntry(app.services.config, 'admin.example.test', '/admin')).toBe('sites/admin/index.html');
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

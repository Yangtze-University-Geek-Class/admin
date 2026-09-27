import { afterEach, expect, it } from 'vitest';
import type { ServiceOverrides } from '../../app/server/src/services';
import { testApp } from './helpers';
const contexts: Awaited<ReturnType<typeof testApp>>[] = [];
afterEach(async () => { for (const c of contexts.splice(0)) await c.close(); });

/** Signed-in org admin whose stub GitHub client answers the role lookup and rejects every other call with `failure`. */
async function adminFixture(failure: Record<string, unknown> = {}) {
  const octokitFactory = (() => ({ request: async (route: string) => {
    if (route === 'GET /orgs/{org}/memberships/{username}') return { data: { state: 'active', role: 'admin' } };
    throw Object.assign(new Error('stub upstream rejection'), failure);
  } })) as unknown as ServiceOverrides['octokitFactory'];
  const context = await testApp({ octokitFactory }); contexts.push(context);
  const sid = context.app.services.auth.createSession('test-admin', 1, null, 'test-access');
  return { ...context, sid, headers: { cookie: `sid=${sid}` } };
}

it.each([403, 404, 409, 422])('maps an upstream GitHub %s to the same 4xx instead of internal_error', async status => {
  const { app, headers } = await adminFixture({ status });
  const response = await app.inject({ method: 'DELETE', url: '/api/admin/test-org/members/ghost', headers });
  expect(response.statusCode).toBe(status);
  const body = response.json();
  expect(body.error).toBe('upstream_rejected');
  expect(body.message).toMatch(/GitHub/);
  expect(body.message).not.toContain('stub upstream rejection');
  expect(body.request_id).toEqual(expect.any(String));
});
it('ends the session instead of passing on a GitHub 401: the token stored in it no longer works (#164)', async () => {
  const { app, sid, headers } = await adminFixture({ status: 401 });
  const response = await app.inject({ method: 'DELETE', url: '/api/admin/test-org/members/ghost', headers });
  expect(response.statusCode).toBe(401);
  expect(response.json()).toMatchObject({ error: 'session_expired', message: '登录已失效，请重新登录', request_id: expect.any(String) });
  const cookies = ([] as string[]).concat((response.headers['set-cookie'] as string[] | string | undefined) ?? []);
  expect(cookies.some(cookie => cookie.startsWith('sid=;'))).toBe(true);
  expect(app.services.auth.getSession(sid)).toBeNull();
  // 同一个 sid 再来就是普通的会话失效，不再问 GitHub。
  expect((await app.inject({ method: 'DELETE', url: '/api/admin/test-org/members/ghost', headers })).json()).toEqual({ error: 'session_expired' });
});
it.each([[{ status: 502 }, 502], [{ status: 0 }, 500], [{}, 500]] as const)('keeps upstream failure %j sanitized as %i', async (failure, expected) => {
  const { app, headers } = await adminFixture(failure);
  const response = await app.inject({ method: 'DELETE', url: '/api/admin/test-org/repos/demo', headers });
  expect(response.statusCode).toBe(expected);
  expect(response.json()).toMatchObject({ error: 'internal_error', message: '服务暂时不可用，请稍后重试' });
});
it('keeps Fastify statusCode errors on their own machine code and message', async () => {
  const { app } = await adminFixture();
  const response = await app.inject({ method: 'POST', url: '/api/feedback', headers: { 'content-type': 'application/json' }, payload: '{' });
  expect(response.statusCode).toBe(400);
  expect(response.json().error).not.toBe('upstream_rejected');
});

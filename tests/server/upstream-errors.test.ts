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
  return { ...context, headers: { cookie: `sid=${sid}` } };
}

it.each([401, 403, 404, 409, 422])('maps an upstream GitHub %s to the same 4xx instead of internal_error', async status => {
  const { app, headers } = await adminFixture({ status });
  const response = await app.inject({ method: 'DELETE', url: '/api/admin/test-org/members/ghost', headers });
  expect(response.statusCode).toBe(status);
  const body = response.json();
  expect(body.error).toBe('upstream_rejected');
  expect(body.message).toMatch(/GitHub/);
  expect(body.message).not.toContain('stub upstream rejection');
  expect(body.request_id).toEqual(expect.any(String));
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

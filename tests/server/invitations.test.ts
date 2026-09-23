import { afterEach, expect, it } from 'vitest';
import type { ServiceOverrides } from '../../app/server/src/services';
import { testApp } from './helpers';
const contexts: Awaited<ReturnType<typeof testApp>>[] = [];
afterEach(async () => { for (const c of contexts.splice(0)) await c.close(); });
async function fixture(failure?: number, options: { message?: string; lookup?: number } = {}) {
  let sends = 0;
  const context = await testApp({ octokitFactory: (() => ({ users: { getByUsername: async () => {
    if (options.lookup) throw Object.assign(new Error('stub lookup rejection'), { status: options.lookup });
    return { data: { id: 1 } };
  } }, request: async (method: string) => {
    if (!method.startsWith('POST')) throw new Error('Unexpected upstream operation');
    sends++; await new Promise(resolve => setTimeout(resolve, 15));
    if (failure) throw Object.assign(new Error(options.message ?? 'stub rejection'), { status: failure });
    return { data: { id: 42 } };
  } })) as ServiceOverrides['octokitFactory'] });
  contexts.push(context);
  const { db } = context.app.services.storage;
  db.prepare('INSERT INTO invite_links(token,org,created_by,created_by_token_encrypted,max_uses,current_uses,expires_at,disabled,created_at) VALUES(?,?,?,?,1,0,?,0,?)').run('test-link', 'test-org', 'test-admin', context.app.services.crypto.encrypt('test-stub-only'), Date.now() + 60000, Date.now());
  const send = (name: string) => context.app.inject({ method: 'POST', url: '/api/join/test-link', payload: { github_login: name, pow: { timestamp: Date.now(), nonce: 'test' } } });
  return { ...context, send, sends: () => sends };
}
it('retains atomic invitation quota across concurrent upstream awaits', async () => {
  const { app, send, sends } = await fixture(); const responses = await Promise.all([send('alpha'), send('beta')]);
  expect(responses.map(r => r.statusCode).sort()).toEqual([200, 409]); expect(sends()).toBe(1);
  expect(app.services.storage.db.prepare('SELECT current_uses FROM invite_links').get()).toEqual({ current_uses: 1 });
});
it('reuses a successful invitation without sending twice', async () => {
  const { send, sends } = await fixture(); expect((await send('alpha')).statusCode).toBe(200); expect((await send('alpha')).statusCode).toBe(200); expect(sends()).toBe(1);
});
it.each([400, 500])('preserves conservative quota handling after upstream %s', async status => {
  const { app, send } = await fixture(status); await send('alpha');
  expect(app.services.storage.db.prepare('SELECT current_uses FROM invite_links').get()).toEqual({ current_uses: status === 400 ? 0 : 1 });
});
it.each([
  ['an existing member', 422, { message: 'Validation Failed: {"message":"Invitee is already a part of this organization"}' }, '该用户已在组织中'],
  ['any other 422', 422, {}, 'GitHub 拒绝邀请（账号不存在或邮箱已被邀请）'],
  ['an unknown GitHub login', undefined, { lookup: 404 }, 'GitHub 用户名不存在，请检查拼写'],
  ['an unclassified 4xx', 403, {}, '邀请失败，稍后重试'],
] as const)('tells %s apart instead of always asking to retry', async (_case, failure, options, expected) => {
  const { send } = await fixture(failure, options); const response = await send('alpha');
  expect(response.statusCode).toBe(400); expect(response.json().error).toBe(expected);
  expect(JSON.stringify(response.json())).not.toMatch(/stub|Validation Failed/);
});
it('builds invite links on the single public origin', async () => {
  const context = await testApp({ octokitFactory: (() => ({ request: async (method: string) => {
    if (method !== 'GET /orgs/{org}/memberships/{username}') throw new Error('Unexpected upstream operation');
    return { data: { state: 'active', role: 'admin' } };
  } })) as ServiceOverrides['octokitFactory'] });
  contexts.push(context);
  const sid = context.app.services.auth.createSession('test-admin', 9, null, 'test-stub-only');
  const response = await context.app.inject({ method: 'POST', url: '/api/admin/test-org/invite-links', headers: { cookie: `sid=${sid}`, origin: 'https://example.test' }, payload: { hours: 1, max_uses: 1 } });
  expect(response.statusCode).toBe(200);
  const { token, url } = response.json();
  expect(url).toBe(`https://example.test/join/${token}`);
});

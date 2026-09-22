import { afterEach, expect, it } from 'vitest';
import type { ServiceOverrides } from '../../app/server/src/services';
import { testApp } from './helpers';
const contexts: Awaited<ReturnType<typeof testApp>>[] = [];
afterEach(async () => { for (const c of contexts.splice(0)) await c.close(); });
async function fixture(failure?: number) {
  let sends = 0;
  const context = await testApp({ octokitFactory: (() => ({ users: { getByUsername: async () => ({ data: { id: 1 } }) }, request: async (method: string) => {
    if (!method.startsWith('POST')) throw new Error('Unexpected upstream operation');
    sends++; await new Promise(resolve => setTimeout(resolve, 15));
    if (failure) throw Object.assign(new Error('stub rejection'), { status: failure });
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

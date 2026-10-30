import { generateKeyPairSync } from 'node:crypto';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { testApp } from './helpers';

/**
 * 未认证/低权接口的防滥用与枚举回归用例（PENTEST-20261029）：
 * - finding 8：同一份 PoW 证明可以原样重放，防刷退化成只剩 IP 限速；
 * - finding 25：OIDC token 端点用 400/401 的差异当 client_id 枚举 oracle。
 */
const contexts: Awaited<ReturnType<typeof testApp>>[] = [];
afterEach(async () => { vi.useRealTimers(); for (const context of contexts.splice(0)) await context.close(); });

async function setup(env: Record<string, string> = {}) {
  const context = await testApp({}, false, env);
  contexts.push(context);
  return context;
}

describe('PoW 证明只能用一次（finding 8）', () => {
  const ORG = 'Yangtze-University-Geek-Class';
  it('同一份证明原样重放回 400，换一份（新的时间戳）才放行', async () => {
    const { app } = await setup();
    const timestamp = Date.now();
    const pow = { timestamp, nonce: 'x' };
    const payload = { org: ORG, content: '这份意见只应该出现一次', category: '建议', pow };
    const first = await app.inject({ method: 'POST', url: '/api/feedback', payload });
    expect(first.statusCode).toBe(200);
    const replayed = await app.inject({ method: 'POST', url: '/api/feedback', payload });
    expect(replayed.statusCode).toBe(400);
    expect(app.services.storage.db.prepare('SELECT COUNT(*) AS n FROM feedback').get()).toEqual({ n: 1 });
    // 时间戳不同 = 摘要不同，客户端重新算一次即可
    const fresh = await app.inject({ method: 'POST', url: '/api/feedback', payload: { ...payload, pow: { timestamp: timestamp - 1, nonce: 'x' } } });
    expect(fresh.statusCode).toBe(200);
  });

  it('证明在整个有效期内都只能用一次：时间戳在未来 4 分钟，5 分 1 秒后重放仍回 400', async () => {
    // 时间戳允许前后各 5 分钟，一份证明能用的时间段是 10 分钟；去重窗口只有 5 分钟时，过了 5 分钟还能再用一次
    vi.useFakeTimers({ toFake: ['Date'] });
    const start = Date.parse('2026-10-30T03:00:00+08:00');
    vi.setSystemTime(start);
    const { app } = await setup();
    const payload = { org: ORG, content: '时间戳在未来的证明', category: '建议', pow: { timestamp: start + 4 * 60_000, nonce: 'x' } };
    expect((await app.inject({ method: 'POST', url: '/api/feedback', payload })).statusCode).toBe(200);
    vi.setSystemTime(start + 5 * 60_000 + 1_000);
    expect((await app.inject({ method: 'POST', url: '/api/feedback', payload })).statusCode).toBe(400);
    expect(app.services.storage.db.prepare('SELECT COUNT(*) AS n FROM feedback').get()).toEqual({ n: 1 });
  });
});

describe('OIDC token 端点不再泄露 client_id 是否存在（finding 25）', () => {
  const { privateKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
  const JWKS = JSON.stringify({ keys: [{ ...privateKey.export({ format: 'jwk' }), kid: 'test-key', use: 'sig', alg: 'RS256' }] });

  const token = (app: FastifyInstance, clientId: string) => app.inject({
    method: 'POST',
    url: '/oidc/token',
    // 用本站 Origin：http-policy 对「外站 Origin 的写请求」一律 403，轮不到 OIDC；报告里的 oracle 用的就是本站 Origin
    headers: { 'content-type': 'application/x-www-form-urlencoded', origin: 'https://example.test' },
    payload: `grant_type=authorization_code&code=x&redirect_uri=https%3A%2F%2Fgit.example.test%2Fcb&client_id=${encodeURIComponent(clientId)}`,
  });

  it('带 Origin 时，已登记与未登记的 client_id 回同一句 401', async () => {
    const { app } = await setup({ OIDC_JWKS: JWKS });
    app.services.oidcStore.registerClient({ name: 'GitLab', clientId: 'gitlab', redirectUris: ['https://git.example.test/cb'] });
    const known = await token(app, 'gitlab');
    const unknown = await token(app, 'not_registered_2026');
    expect(known.statusCode).toBe(401);
    expect(unknown.statusCode).toBe(401);
    expect(known.json()).toEqual(unknown.json());
    expect(known.json()).toEqual({ error: 'invalid_client', error_description: 'client authentication failed' });
  });

  it('发现文档和公钥不认客户端，带 Origin 照样能读', async () => {
    const { app } = await setup({ OIDC_JWKS: JWKS });
    for (const url of ['/oidc/.well-known/openid-configuration', '/oidc/jwks']) {
      const res = await app.inject({ method: 'GET', url, headers: { origin: 'https://example.test' } });
      expect(res.statusCode, url).toBe(200);
    }
  });
});

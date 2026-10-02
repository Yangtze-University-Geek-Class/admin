import { afterEach, expect, it } from 'vitest';
import type { ServiceOverrides } from '../../app/server/src/services';
import { testApp } from './helpers';

const CONSOLE_ORG = 'Yangtze-University-Geek-Class';
const contexts: Awaited<ReturnType<typeof testApp>>[] = [];
afterEach(async () => { for (const c of contexts.splice(0)) await c.close(); });

/** 路由级限流（@fastify/rate-limit）超额时的错误体，和论坛自己数次数的 429 是同一个（#191）。 */
const LIMITED = { error: 'rate_limited', message: '操作太频繁，请稍后再试', request_id: expect.stringMatching(/\S/) };

/** 模拟 GitHub：alice 是 CONSOLE_ORG 的 owner（控制台的全部能力），别的调用一律当测试漏洞。 */
const github = (() => ({
  request: async (route: string, params: Record<string, string>) => {
    if (route === 'GET /orgs/{org}/memberships/{username}' && params.org === CONSOLE_ORG && params.username === 'alice') return { data: { state: 'active', role: 'admin' } };
    throw new Error(`Unexpected GitHub call ${route}`);
  },
})) as unknown as ServiceOverrides['octokitFactory'];

// 限流在 onRequest 里先于鉴权、校验和处理器计数，额度内的请求回什么都占一次。
it.each([
  { name: 'POST /api/join/:token', method: 'POST', url: '/api/join/no-such-link', payload: {}, max: 5, within: 404, signedIn: false },
  { name: 'GET /api/console/applications/export.csv', method: 'GET', url: '/api/console/applications/export.csv', max: 5, within: 200, signedIn: true },
  { name: 'POST /api/console/assignments', method: 'POST', url: '/api/console/assignments', payload: { github_login: '-bad-', role: 'member' }, max: 30, within: 400, signedIn: true },
  { name: 'POST /api/portal/apply', method: 'POST', url: '/api/portal/apply', payload: {}, max: 5, within: 400, signedIn: false },
  { name: 'POST /api/feedback', method: 'POST', url: '/api/feedback', payload: {}, max: 10, within: 400, signedIn: false },
] as const)('answers $name over its $max-a-minute limit with 429 rate_limited, a Chinese message and the request_id', async ({ method, url, max, within, signedIn, ...rest }) => {
  const context = await testApp({ octokitFactory: github });
  contexts.push(context);
  const { app } = context;
  const headers = signedIn ? { cookie: `sid=${app.services.auth.createSession('alice', 101, null, 'token-alice')}` } : {};
  const send = () => app.inject({ method, url, headers, remoteAddress: '198.51.100.20', ...('payload' in rest ? { payload: rest.payload } : {}) });
  const statuses: number[] = [];
  for (let i = 0; i < max; i += 1) statuses.push((await send()).statusCode);
  expect(statuses).toEqual(Array(max).fill(within));
  const limited = await send();
  expect(limited.statusCode).toBe(429);
  expect(limited.json()).toEqual(LIMITED);
  expect(limited.headers['cache-control']).toBe('no-store');
  // 另一个 IP 的额度是自己的
  expect((await app.inject({ method, url, headers, remoteAddress: '198.51.100.21', ...('payload' in rest ? { payload: rest.payload } : {}) })).statusCode).toBe(within);
});

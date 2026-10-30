import { afterEach, expect, it } from 'vitest';
import type { ServiceOverrides } from '../../app/server/src/services';
import { SHIELD_NOTICE } from '../../app/server/src/lib/shield';
import { accountIdOf, grantPermGroup, signIn, testApp } from './helpers';

const CONSOLE_ORG = 'Yangtze-University-Geek-Class';
const contexts: Awaited<ReturnType<typeof testApp>>[] = [];
afterEach(async () => { for (const c of contexts.splice(0)) await c.close(); });

/** 路由级限流（@fastify/rate-limit）超额时的错误体，和论坛自己数次数的 429 是同一个（#191）；访问防护打开时多一句 notice（#333）。 */
const LIMITED = { error: 'rate_limited', message: '操作太频繁，请稍后再试', request_id: expect.stringMatching(/\S/), notice: SHIELD_NOTICE };

/** 模拟 GitHub：alice 是 CONSOLE_ORG 的 owner（控制台的全部能力），别的调用一律当测试漏洞。 */
const github = (() => ({
  request: async (route: string, params: Record<string, string>) => {
    if (route === 'GET /orgs/{org}/memberships/{username}' && params.org === CONSOLE_ORG && params.username === 'alice') return { data: { state: 'active', role: 'admin' } };
    throw new Error(`Unexpected GitHub call ${route}`);
  },
})) as unknown as ServiceOverrides['octokitFactory'];

// 限流在 onRequest 里先于鉴权、校验和处理器计数，额度内的请求回什么都占一次。
it.each([
  // #274 review round 1（SPEC §3.8）：/auth/github 原来没有限流，补成和 /auth/google 一样的按 IP 每分钟 20 次。
  { name: 'GET /auth/github', method: 'GET', url: '/auth/github', max: 20, within: 302, signedIn: false },
  { name: 'GET /api/console/applications/export.csv', method: 'GET', url: '/api/console/applications/export.csv', max: 5, within: 200, signedIn: true },
  // #274 删掉了 /api/console/assignments；邀请码写接口（invite.manage + step-up）沿用同样的 30/分钟限额。
  { name: 'POST /api/console/invites', method: 'POST', url: '/api/console/invites', payload: {}, max: 30, within: 400, signedIn: false },
  // #274 SPEC §3.2：投递要先登录（level.registered 就有 apply.submit），不再接受匿名投递。
  { name: 'POST /api/portal/apply', method: 'POST', url: '/api/portal/apply', payload: {}, max: 5, within: 400, signedIn: true },
  { name: 'POST /api/feedback', method: 'POST', url: '/api/feedback', payload: {}, max: 10, within: 400, signedIn: false },
] as const)('answers $name over its $max-a-minute limit with 429 rate_limited, a Chinese message and the request_id', async ({ method, url, max, within, signedIn, ...rest }) => {
  const context = await testApp({ octokitFactory: github });
  contexts.push(context);
  const { app } = context;
  const headers = signedIn ? { cookie: `sid=${signIn(app, 'alice', 101, null, 'token-alice')}` } : {};
  if (signedIn) grantPermGroup(app, accountIdOf(app, 'alice'), 'title.site.owner'); // #274：apply.export 等按新权限体系判定
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

it('同一个访客反复撞同一个限额，429 只在操作记录里留一行，meta.count 往上加（#274 残留修复 F）', async () => {
  const context = await testApp();
  contexts.push(context);
  const { app } = context;
  context.app.services.storage.db.prepare("DELETE FROM activity_events").run(); // 迁移自带的 identity.backfill 记录不参与这里的断言
  // /api/join/:token 在合并 idn274 分支后被删掉了（邀请码走别的路由），改用同样匿名、同样限流插件、
  // max=10/分钟的 /api/feedback：空 payload 校验不过但稳定回 400，不是限流响应，不影响这条用例要测的东西。
  // 保留原来的访客 cookie 回带：recordDenial 按 visitor_id 也参与去重分组，不带同一个 cookie 的话每次请求
  // 都会被发一个新访客号，3 条限流会各自配一个不同 visitor_id，合并不到一行。
  let cookie: string | undefined;
  const send = async () => {
    const res = await app.inject({ method: 'POST', url: '/api/feedback', payload: {}, remoteAddress: '198.51.100.40', headers: cookie ? { cookie } : {} });
    const setCookie = ([] as string[]).concat((res.headers['set-cookie'] as string[] | string | undefined) ?? []).find(c => c.startsWith('yugc_vid='));
    if (setCookie && !cookie) cookie = setCookie.split(';')[0];
    return res;
  };
  for (let i = 0; i < 10; i += 1) expect((await send()).statusCode).toBe(400); // 用满额度（max=10），都不是限流响应
  for (let i = 0; i < 3; i += 1) expect((await send()).statusCode).toBe(429); // 再撞 3 次
  const rows = app.services.storage.db.prepare("SELECT outcome, action, meta FROM activity_events WHERE outcome = 'limited'").all() as
    { outcome: string; action: string; meta: string }[];
  expect(rows).toHaveLength(1); // 3 次限流只留一行，没有一条一条插
  expect(rows[0].action).toBe('http.rate_limited');
  // 同一行记着方法、匹配到的路由模板与状态码（#333），不记原始路径和查询串
  expect(JSON.parse(rows[0].meta)).toEqual({ method: 'POST', route: '/api/feedback', status: 429, count: 3 });
});

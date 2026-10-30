import { STATIC_CDN_ORIGIN as CDN_ORIGIN } from '../static-cdn-fixture';
import { createHash } from 'node:crypto';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { buildApp } from '../../app/server/src/app';
import { beijingDayBounds } from '../../app/server/src/lib/limits';
import { ipSubject } from '../../app/server/src/lib/forum-rules';
import type { ServiceOverrides } from '../../app/server/src/services';
import { activityRows, signIn, testApp, testConfig } from './helpers';

/**
 * 招新投递（#169；#274 SPEC §3 改成按统一账号认人：要登录、要有 apply.submit 权限，不再接受匿名投递）。
 * 本文件只用到 testApp 返回值的关闭能力，就地命名，避免耦合 fastify 的实现签名。
 */
type TestContext = { close: () => Promise<void> };

const contexts: TestContext[] = [];
afterEach(async () => { for (const c of contexts.splice(0)) await c.close(); });

const VALID = {
  name: '张三',
  className: '计算机 2101',
  email: 'zhangsan@example.test',
  strengths: '熟悉 Go 与 TypeScript，做过两个开源项目，长期维护自己的技术博客。',
};

const SUCCESS_MESSAGE = '投递成功，我们会在 3 个工作日内联系你。';
const sha256 = (value: string) => createHash('sha256').update(value).digest('hex');
let nextGithubId = 101;

const INVALID: Array<[label: string, patch: Record<string, unknown>, field: string]> = [
  ['姓名过短', { name: 'A' }, 'name'],
  ['姓名过长', { name: '张'.repeat(41) }, 'name'],
  ['姓名含控制字符', { name: '张\u0000三' }, 'name'],
  ['姓名缺失', { name: undefined }, 'name'],
  ['班级过短', { className: 'x' }, 'className'],
  ['班级含非法字符', { className: '计算机@2101' }, 'className'],
  ['邮箱格式错误', { email: 'zhangsan.example.test' }, 'email'],
  ['邮箱过长', { email: `${'a'.repeat(110)}@example.test` }, 'email'],
  ['特长过短', { strengths: '太短了' }, 'strengths'],
];

/** 新建一个登录的账号（默认「注册用户」，member=true 时升到「极客班成员」，apply.submit 的额度不限）。 */
async function signedInApp(member = false, overrides: ServiceOverrides = {}) {
  const context = await testApp(overrides);
  contexts.push(context);
  const { app } = context;
  const sid = signIn(app, `applicant-${nextGithubId}`, nextGithubId++);
  const accountId = app.services.auth.getSession(sid)!.account_id;
  if (member) app.services.identity.setSiteRole({ accountId, role: 'member', actor: 'system' });
  return { ...context, app, db: app.services.storage.db, cookie: `sid=${sid}`, accountId };
}

async function fixture(member = false) {
  const ctx = await signedInApp(member);
  const submit = (payload: Record<string, unknown> = {}, extra: Record<string, unknown> = {}) => ctx.app.inject({
    method: 'POST', url: '/api/portal/apply', headers: { cookie: ctx.cookie },
    payload: { pow: { timestamp: Date.now(), nonce: 'test' }, ...VALID, ...payload },
    ...extra,
  });
  const count = (table: 'applications' | 'activity_events') => ctx.db.prepare(`SELECT COUNT(*) AS n FROM ${table}`).get();
  return { ...ctx, submit, count };
}

it('没登录回 401 unauthenticated，不落库', async () => {
  const context = await testApp();
  contexts.push(context);
  const res = await context.app.inject({
    method: 'POST', url: '/api/portal/apply',
    payload: { ...VALID, pow: { timestamp: Date.now(), nonce: 'test' } },
  });
  expect(res.statusCode).toBe(401);
  // #274 review round 1：preHandler 只挂 requirePermission（它自己判定登录态），不再多挂一个 requireAuth——
  // 两个一起挂时 requireAuth 先回它自己的 not_signed_in，盖掉通用错误码约定的 401 unauthenticated。
  expect(res.json()).toEqual({ error: 'unauthenticated', message: '请先登录' });
  expect(context.app.services.storage.db.prepare('SELECT COUNT(*) AS n FROM applications').get()).toEqual({ n: 0 });
});

it('登录了但 apply.submit 被收回（账号级 deny）回 403，不落库', async () => {
  const { app, cookie, accountId, db, count } = await fixture();
  db.prepare("INSERT INTO perm_entries(subject_type, subject_id, node, value, scope, granted_by, created_at) VALUES ('account', ?, 'apply.submit', 0, '{}', 'test', ?)")
    .run(accountId, Date.now());
  app.services.permissions.bump();
  const res = await app.inject({
    method: 'POST', url: '/api/portal/apply', headers: { cookie },
    payload: { ...VALID, pow: { timestamp: Date.now(), nonce: 'test' } },
  });
  expect(res.statusCode).toBe(403);
  expect(count('applications')).toEqual({ n: 0 });
});

it('accepts a real application from a signed-in account, stores it, never echoes the candidate text, and reports quota', async () => {
  const { app, db, accountId, submit, count } = await fixture();
  const response = await submit(VALID);
  expect(response.statusCode).toBe(201);
  const body = response.json();
  expect(Object.keys(body).sort()).toEqual(['id', 'message', 'quota', 'submitted_at']);
  expect(body.message).toBe(SUCCESS_MESSAGE);
  expect(body.id).toMatch(/^[0-9a-f-]{36}$/);
  // 注册用户每天 3 份，这是第一份：还剩 2 份
  expect(body.quota).toEqual({ apply_left_today: 2, apply_daily_limit: 3 });
  expect(count('applications')).toEqual({ n: 1 });
  expect(JSON.stringify(body)).not.toContain(VALID.strengths);

  const stored = db.prepare('SELECT * FROM applications WHERE id = ?').get(body.id);
  expect(stored).toMatchObject({
    id: body.id, name: VALID.name, class_name: VALID.className, email: VALID.email,
    strengths: VALID.strengths, status: 'received', created_at: body.submitted_at,
  });
  expect(JSON.stringify(stored)).toContain('127.0.0.1');

  // #274 item I：application.received 并进了 apply.submit 的 recordActivity，不再是单独一条 audit_logs 行。
  const rows = activityRows(app, { action: 'apply.submit' });
  expect(rows).toHaveLength(1);
  const [row] = rows;
  expect(row.account_id).toBe(accountId);
  expect(row).toMatchObject({ action: 'apply.submit', target_type: 'application', target_id: body.id, ip: '127.0.0.1' });
  expect(row.meta).toMatchObject({ strengths_length: VALID.strengths.length });
  expect(JSON.stringify(row)).toContain('z***@example.test');
  expect(JSON.stringify(row)).not.toContain(VALID.strengths);
});

it.each(INVALID)('refuses %s with a field-scoped Chinese error and no persistence', async (_label, patch, field) => {
  const { submit, count } = await fixture();
  const response = await submit({ ...VALID, ...patch });
  expect(response.statusCode).toBe(400);
  const body = response.json();
  expect(Object.keys(body.fields)).toEqual([field]);
  expect(body.fields[field]).toMatch(/[一-龥]/);
  expect(body.error).toBe(body.fields[field]);
  expect(count('applications')).toEqual({ n: 0 });
});

it('answers the honeypot exactly like a success without persisting anything', async () => {
  const { submit, count } = await fixture();
  const auditsBefore = count('activity_events');
  const response = await submit({ website: 'https://bot.example' });
  expect(response.statusCode).toBe(201);
  const body = response.json();
  expect(Object.keys(body).sort()).toEqual(['id', 'message', 'submitted_at']);
  expect(body.message).toBe(SUCCESS_MESSAGE);
  expect(count('applications')).toEqual({ n: 0 });
  expect(count('activity_events')).toEqual(auditsBefore);
});

it('holds the 2000-character boundary for 个人特长与优点', async () => {
  const { submit, count } = await fixture(true);
  expect((await submit({ strengths: '特'.repeat(2000) })).statusCode).toBe(201);
  const tooLong = await submit({ strengths: '特'.repeat(2001) });
  expect(tooLong.statusCode).toBe(400);
  expect(Object.keys(tooLong.json().fields)).toEqual(['strengths']);
  expect(count('applications')).toEqual({ n: 1 });
});

it('ignores unknown fields instead of failing the submission', async () => {
  const { db, submit, count } = await fixture();
  const response = await submit({ nickname: '未知字段', source: 'web', nested: { a: 1 } });
  expect(response.statusCode).toBe(201);
  expect(count('applications')).toEqual({ n: 1 });
  expect(db.prepare('SELECT name, class_name, email, strengths FROM applications').get()).toEqual({
    name: VALID.name, class_name: VALID.className, email: VALID.email, strengths: VALID.strengths,
  });
});

it('keeps the shared public-form abuse gates and their existing shapes', async () => {
  const { submit, count } = await fixture(true);
  const noPow = await submit({ pow: undefined });
  expect(noPow.statusCode).toBe(400);
  expect(noPow.json().error).toBe('防滥用校验失败，请刷新页面重试');
  const stalePow = await submit({ pow: { timestamp: Date.now() - 10 * 60 * 1000, nonce: 'test' } });
  expect(stalePow.statusCode).toBe(400);
  expect((await submit({ turnstile_token: '' })).statusCode).toBe(201);
  expect(count('applications')).toEqual({ n: 1 });
});

it('caps the endpoint at five submissions per minute for one client, regardless of account', async () => {
  const { submit, count } = await fixture(true);
  const statuses: number[] = [];
  for (let i = 0; i < 6; i++) statuses.push((await submit({ email: `candidate${i}@example.test` })).statusCode);
  expect(statuses).toEqual([201, 201, 201, 201, 201, 429]);
  expect(count('applications')).toEqual({ n: 5 });
});

/** 与 app/web/shared/lib/pow.ts 相同的求解公式：sha256(`${timestamp}:${bodyForHash}:${nonce}`) 前缀零。 */
function solvePow(bodyForHash: string, difficulty: number) {
  const timestamp = Date.now();
  for (let n = 0; ; n++) {
    const nonce = n.toString(36);
    if (createHash('sha256').update(`${timestamp}:${bodyForHash}:${nonce}`).digest('hex').startsWith('0'.repeat(difficulty))) {
      return { timestamp, nonce };
    }
  }
}

/**
 * 生产难度不是 0，前缀零校验会被真正执行，因此这里另建一份高难度实例；
 * 其余隔离约束与 tests/server/helpers.ts 一致（内存库、外部请求一律拒绝）。
 */
async function productionDifficultyApp() {
  const config = testConfig({
    NODE_ENV: 'test',
    PUBLIC_ORIGIN: 'https://example.test', STATIC_CDN_ORIGIN: CDN_ORIGIN, DB_PATH: ':memory:',
    FORUM_DB_PATH: '/nonexistent/never-open-legacy-forum.db',
    SESSION_SECRET: 'isolated-core-test-secret-at-least-32',
    ENCRYPTION_KEY: Buffer.alloc(32, 1).toString('base64'),
    OAUTH_CLIENT_ID: 'test-client', OAUTH_CLIENT_SECRET: 'test-only-placeholder', POW_DIFFICULTY: '3',
  });
  // 未注入的 httpRequest/octokit 必须失败关闭：本用例不允许任何外部网络请求。
  const denyNetwork = (() => { throw new Error('Unexpected external network request in isolated apply test'); }) as unknown as ServiceOverrides['httpRequest'];
  const app = await buildApp({ config, staticRoot: false, overrides: { httpRequest: denyNetwork, octokitFactory: denyNetwork } });
  await app.ready();
  const context = { app, close: () => app.close() };
  contexts.push(context);
  const sid = signIn(app, `applicant-${nextGithubId}`, nextGithubId++);
  app.services.identity.setSiteRole({ accountId: app.services.auth.getSession(sid)!.account_id, role: 'member', actor: 'system' });
  return { app, cookie: `sid=${sid}` };
}

it('accepts a client-computed proof of work built from apply:<trim 后姓名>:<trim 后邮箱>', async () => {
  const { app, cookie } = await productionDifficultyApp();
  const name = '李四';
  const email = 'lisi@example.test';
  const post = (pow: { timestamp: number; nonce: string }) => app.inject({
    method: 'POST', url: '/api/portal/apply', headers: { cookie },
    payload: { name: `  ${name} `, className: '软件 2202', email: ` ${email} `, strengths: '写过排课小工具，也在队伍里做过前端联调。', pow, turnstile_token: '' },
  });

  expect((await post(solvePow(`apply:${name}:${email}`, 3))).statusCode).toBe(201);
  const wrongPrefix = await post(solvePow(`apply:${name}:${email}:软件 2202`, 3));
  expect(wrongPrefix.statusCode).toBe(400);
  expect(wrongPrefix.json().error).toBe('防滥用校验失败，请刷新页面重试');
  expect(app.services.storage.db.prepare('SELECT COUNT(*) AS n FROM applications').get()).toEqual({ n: 1 });
});

describe('每天的投递额度（#274 SPEC §3：按账号 / IP / 设备三条线，北京时间零点重置）', () => {
  it('注册用户每天 3 份，第 4 份回 429，bucket 是 apply.daily，retry_after 到下一个北京零点', async () => {
    const now = Date.now();
    vi.spyOn(Date, 'now').mockReturnValue(now);
    try {
      const { submit, count } = await fixture();
      for (let i = 0; i < 3; i++) expect((await submit({ email: `c${i}@example.test` })).statusCode).toBe(201);
      const fourth = await submit({ email: 'c3@example.test' });
      expect(fourth.statusCode).toBe(429);
      const expectedRetry = Math.ceil((beijingDayBounds(now).end - now) / 1000);
      expect(fourth.json()).toMatchObject({ error: 'rate_limited', bucket: 'apply.daily', retry_after: expectedRetry });
      expect(fourth.headers['retry-after']).toBe(String(expectedRetry));
      expect(count('applications')).toEqual({ n: 3 });
    } finally {
      vi.restoreAllMocks();
    }
  });

  it('极客班成员不限额（meta -1）：超过注册用户的 3 份也不拦（换 IP 避免撞上 IP 那条线）', async () => {
    const { submit } = await fixture(true);
    for (let i = 0; i < 12; i++) {
      expect((await submit({ email: `m${i}@example.test` }, { remoteAddress: `198.51.100.${i + 1}` })).statusCode).toBe(201);
    }
  });

  it('过了北京零点，账号的额度重新开始算', async () => {
    const now = Date.now();
    vi.spyOn(Date, 'now').mockReturnValue(now);
    try {
      const { submit, count } = await fixture();
      for (let i = 0; i < 3; i++) expect((await submit({ email: `d${i}@example.test` })).statusCode).toBe(201);
      expect((await submit({ email: 'd3@example.test' })).statusCode).toBe(429);
      vi.spyOn(Date, 'now').mockReturnValue(beijingDayBounds(now).end + 1_000);
      const afterMidnight = await submit({ email: 'd4@example.test' });
      expect(afterMidnight.statusCode).toBe(201);
      expect(count('applications')).toEqual({ n: 4 });
    } finally {
      vi.restoreAllMocks();
    }
  });

  it('同一个 IP（IPv6 按 /64 归一）一天最多 10 份，不同账号共用也会撞线', async () => {
    // 每个账号都设成成员（账号那条线不限），只用来隔离、单独验证 IP 这一条线；每次换一个设备 cookie，
    // 设备那条线（5/天）不会先撞上。
    const { app, cookie } = await signedInApp(true);
    const submitFrom = (ip: string, email: string) => app.inject({
      method: 'POST', url: '/api/portal/apply', headers: { cookie },
      payload: { ...VALID, email, pow: { timestamp: Date.now(), nonce: 'test' } },
      remoteAddress: ip,
    });
    for (let n = 1; n <= 10; n += 1) expect((await submitFrom(`2001:db8:1:2::${n}`, `ip${n}@example.test`)).statusCode).toBe(201);
    const eleventh = await submitFrom('2001:db8:1:2::b', 'ip11@example.test');
    expect(eleventh.statusCode).toBe(429);
    expect(eleventh.json()).toMatchObject({ error: 'rate_limited', bucket: 'apply.daily' });
    // 换一个不在这个 /64 里的地址照样能投
    expect((await submitFrom('203.0.113.9', 'ip12@example.test')).statusCode).toBe(201);
    // 库里只有 IP 的哈希，不是原文
    const ipRows = app.services.storage.db.prepare("SELECT subject FROM limit_events WHERE bucket = 'apply.daily.ip'").all() as { subject: string }[];
    expect(new Set(ipRows.map(row => row.subject))).toEqual(new Set([sha256(ipSubject('2001:db8:1:2::1')), sha256('203.0.113.9')]));
  });

  it('同一个设备 cookie 一天最多 5 份，不同账号共用也会撞线', async () => {
    const { app, cookie } = await signedInApp(true);
    const device = 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee';
    const submitAs = (ip: string, email: string) => app.inject({
      method: 'POST', url: '/api/portal/apply', headers: { cookie }, cookies: { yugc_apply_device: device },
      payload: { ...VALID, email, pow: { timestamp: Date.now(), nonce: 'test' } },
      remoteAddress: ip, // 每次换一个不相关的 IP，IP 那条线（10/天）不会先撞上
    });
    for (let n = 1; n <= 5; n += 1) expect((await submitAs(`198.51.100.${n}`, `dev${n}@example.test`)).statusCode).toBe(201);
    const sixth = await submitAs('198.51.100.6', 'dev6@example.test');
    expect(sixth.statusCode).toBe(429);
    expect(sixth.json()).toMatchObject({ error: 'rate_limited', bucket: 'apply.daily' });
    const deviceRows = app.services.storage.db.prepare("SELECT subject FROM limit_events WHERE bucket = 'apply.daily.device'").all() as { subject: string }[];
    expect(new Set(deviceRows.map(row => row.subject))).toEqual(new Set([sha256(device)]));
  });

  it('带来的设备 id 不像我们发的就换一个新的；没带就发一个新的', async () => {
    const { app, cookie } = await signedInApp(true);
    const first = await app.inject({
      method: 'POST', url: '/api/portal/apply', headers: { cookie },
      payload: { ...VALID, pow: { timestamp: Date.now(), nonce: 'test' } },
    });
    const deviceCookie = first.cookies.find(c => c.name === 'yugc_apply_device');
    expect(deviceCookie).toMatchObject({ httpOnly: true, path: '/api/portal/apply', sameSite: 'Lax', maxAge: 365 * 24 * 3600 });
    expect(deviceCookie!.value).toMatch(/^[0-9a-f-]{36}$/);
    const forged = await app.inject({
      method: 'POST', url: '/api/portal/apply', headers: { cookie }, cookies: { yugc_apply_device: 'not-a-device-id' },
      payload: { ...VALID, email: 'forged@example.test', pow: { timestamp: Date.now(), nonce: 'test' } },
    });
    expect(forged.statusCode).toBe(201);
    expect(forged.cookies.find(c => c.name === 'yugc_apply_device')!.value).toMatch(/^[0-9a-f-]{36}$/);
  });
});

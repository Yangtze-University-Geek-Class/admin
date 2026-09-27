import { createHash } from 'node:crypto';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { buildApp } from '../../app/server/src/app';
import { ipSubject } from '../../app/server/src/lib/forum-rules';
import type { ServiceOverrides } from '../../app/server/src/services';
import { testApp, testConfig } from './helpers';

/** 本文件只用到 testApp 返回值的关闭能力，就地命名，避免耦合 fastify 的实现签名。 */
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

async function fixture() {
  const context = await testApp();
  contexts.push(context);
  const { db } = context.app.services.storage;
  const submit = (payload: Record<string, unknown>) => context.app.inject({
    method: 'POST', url: '/api/portal/apply',
    payload: { pow: { timestamp: Date.now(), nonce: 'test' }, ...payload },
  });
  const count = (table: 'applications' | 'audit_logs') => db.prepare(`SELECT COUNT(*) AS n FROM ${table}`).get();
  return { ...context, db, submit, count };
}

it('accepts a real application, stores it and never echoes the candidate text', async () => {
  const { db, submit, count } = await fixture();
  const response = await submit(VALID);
  expect(response.statusCode).toBe(201);
  const body = response.json();
  expect(Object.keys(body).sort()).toEqual(['id', 'message', 'submitted_at']);
  expect(body.message).toBe(SUCCESS_MESSAGE);
  expect(body.id).toMatch(/^[0-9a-f-]{36}$/);
  expect(count('applications')).toEqual({ n: 1 });
  expect(JSON.stringify(body)).not.toContain(VALID.strengths);

  const stored = db.prepare('SELECT * FROM applications WHERE id = ?').get(body.id);
  expect(stored).toMatchObject({
    id: body.id, name: VALID.name, class_name: VALID.className, email: VALID.email,
    strengths: VALID.strengths, status: 'received', created_at: body.submitted_at,
  });
  expect(JSON.stringify(stored)).toContain('127.0.0.1');

  const audits = db.prepare("SELECT actor, action, target, details, ip FROM audit_logs WHERE action = 'application.received'").all();
  expect(audits).toHaveLength(1);
  const [audit] = audits;
  expect(audit).toMatchObject({ actor: 'public:apply', action: 'application.received', target: body.id, ip: '127.0.0.1' });
  expect(audit).toMatchObject({ details: expect.stringContaining('"strengths_length"') });
  expect(JSON.stringify(audit)).toContain('z***@example.test');
  expect(JSON.stringify(audit)).not.toContain(VALID.strengths);
});

it.each(INVALID)('refuses %s with a field-scoped Chinese error and no persistence', async (_label, patch, field) => {
  const { submit, count } = await fixture();
  const response = await submit({ ...VALID, ...patch });
  expect(response.statusCode).toBe(400);
  const body = response.json();
  expect(Object.keys(body.fields)).toEqual([field]);
  expect(body.fields[field]).toMatch(/[\u4e00-\u9fa5]/);
  expect(body.error).toBe(body.fields[field]);
  expect(count('applications')).toEqual({ n: 0 });
});

it('answers the honeypot exactly like a success without persisting anything', async () => {
  const { submit, count } = await fixture();
  const response = await submit({ ...VALID, website: 'https://bot.example' });
  expect(response.statusCode).toBe(201);
  const body = response.json();
  expect(Object.keys(body).sort()).toEqual(['id', 'message', 'submitted_at']);
  expect(body.message).toBe(SUCCESS_MESSAGE);
  expect(count('applications')).toEqual({ n: 0 });
  expect(count('audit_logs')).toEqual({ n: 0 });
});

it('holds the 2000-character boundary for 个人特长与优点', async () => {
  const { submit, count } = await fixture();
  expect((await submit({ ...VALID, strengths: '特'.repeat(2000) })).statusCode).toBe(201);
  const tooLong = await submit({ ...VALID, strengths: '特'.repeat(2001) });
  expect(tooLong.statusCode).toBe(400);
  expect(Object.keys(tooLong.json().fields)).toEqual(['strengths']);
  expect(count('applications')).toEqual({ n: 1 });
});

it('ignores unknown fields instead of failing the submission', async () => {
  const { db, submit, count } = await fixture();
  const response = await submit({ ...VALID, nickname: '未知字段', source: 'web', nested: { a: 1 } });
  expect(response.statusCode).toBe(201);
  expect(count('applications')).toEqual({ n: 1 });
  expect(db.prepare('SELECT name, class_name, email, strengths FROM applications').get()).toEqual({
    name: VALID.name, class_name: VALID.className, email: VALID.email, strengths: VALID.strengths,
  });
});

it('keeps the shared public-form abuse gates and their existing shapes', async () => {
  const { submit, count } = await fixture();
  const noPow = await submit({ ...VALID, pow: undefined });
  expect(noPow.statusCode).toBe(400);
  expect(noPow.json().error).toBe('防滥用校验失败，请刷新页面重试');
  const stalePow = await submit({ ...VALID, pow: { timestamp: Date.now() - 10 * 60 * 1000, nonce: 'test' } });
  expect(stalePow.statusCode).toBe(400);
  expect((await submit({ ...VALID, turnstile_token: '' })).statusCode).toBe(201);
  expect(count('applications')).toEqual({ n: 1 });
});

it('caps the endpoint at five submissions per minute for one client', async () => {
  const { submit, count } = await fixture();
  const statuses: number[] = [];
  for (let i = 0; i < 6; i++) statuses.push((await submit({ ...VALID, email: `candidate${i}@example.test` })).statusCode);
  expect(statuses).toEqual([201, 201, 201, 201, 201, 429]);
  expect(count('applications')).toEqual({ n: 5 });
});

it('keeps the cap and records the real address when a client behind the two deployment proxies rotates its own X-Forwarded-For', async () => {
  // 部署链路：客户端 → 宿主 nginx → web 容器 nginx（172.18.0.3）→ server；两层 nginx 各在末尾追加一段，
  // 客户端自己带的 X-Forwarded-For 在最左边。TRUST_PROXY=2 只信任这两层。
  const context = await testApp({}, false, { TRUST_PROXY: '2' });
  contexts.push(context);
  const { db } = context.app.services.storage;
  const statuses: number[] = [];
  for (let i = 0; i < 6; i++) {
    statuses.push((await context.app.inject({
      method: 'POST', url: '/api/portal/apply', remoteAddress: '172.18.0.3',
      headers: { 'x-forwarded-for': `10.0.0.${i}, 198.51.100.7, 172.18.0.1` },
      payload: { pow: { timestamp: Date.now(), nonce: 'test' }, ...VALID, email: `candidate${i}@example.test` },
    })).statusCode);
  }
  expect(statuses).toEqual([201, 201, 201, 201, 201, 429]);
  expect(db.prepare('SELECT DISTINCT source_ip FROM applications').all()).toEqual([{ source_ip: '198.51.100.7' }]);
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
    PUBLIC_ORIGIN: 'https://example.test', DB_PATH: ':memory:',
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
  return context;
}

it('accepts a client-computed proof of work built from apply:<trim 后姓名>:<trim 后邮箱>', async () => {
  const { app } = await productionDifficultyApp();
  const name = '李四';
  const email = 'lisi@example.test';
  const post = (pow: { timestamp: number; nonce: string }) => app.inject({
    method: 'POST', url: '/api/portal/apply',
    payload: { name: `  ${name} `, className: '软件 2202', email: ` ${email} `, strengths: '写过排课小工具，也在队伍里做过前端联调。', pow, turnstile_token: '' },
  });

  expect((await post(solvePow(`apply:${name}:${email}`, 3))).statusCode).toBe(201);
  const wrongPrefix = await post(solvePow(`apply:${name}:${email}:软件 2202`, 3));
  expect(wrongPrefix.statusCode).toBe(400);
  expect(wrongPrefix.json().error).toBe('防滥用校验失败，请刷新页面重试');
  expect(app.services.storage.db.prepare('SELECT COUNT(*) AS n FROM applications').get()).toEqual({ n: 1 });
});

describe('how often one device or network can apply (#169)', () => {
  const LIMITED = { error: 'apply_limited', message: '同一台设备或同一个网络 24 小时内最多投递 5 次，之前投的都已经收到了。' };
  const sha256 = (value: string) => createHash('sha256').update(value).digest('hex');
  const deviceOf = (response: { cookies: Array<{ name: string; value: string }> }) => response.cookies.find(cookie => cookie.name === 'yugc_apply_device');
  async function limits() {
    const { app, db, count } = await fixture();
    const apply = (ip: string, device?: string, patch: Record<string, unknown> = {}) => app.inject({
      method: 'POST', url: '/api/portal/apply', remoteAddress: ip, cookies: device ? { yugc_apply_device: device } : {},
      payload: { ...VALID, pow: { timestamp: Date.now(), nonce: 'test' }, ...patch },
    });
    return { app, db, count, apply };
  }

  it('takes 5 applications from one network in 24 hours, grouping IPv6 by /64, and refuses the 6th without storing it', async () => {
    const { apply, count, db } = await limits();
    // 同一个 /64 里的地址各算一次请求限流（每分钟 5 次碰不到），但算同一个来源；每次不带 cookie，算不同的设备
    for (let n = 1; n <= 5; n += 1) expect((await apply(`2001:db8:1:2::${n}`)).statusCode).toBe(201);
    const sixth = await apply('2001:db8:1:2::6');
    expect(sixth.statusCode).toBe(429);
    expect(sixth.json()).toEqual(LIMITED);
    expect(count('applications')).toEqual({ n: 5 });
    expect(db.prepare('SELECT COUNT(*) AS n FROM mail_outbox').get()).toEqual({ n: 5 });
    expect((await apply('203.0.113.9')).statusCode).toBe(201);
    // 库里只有哈希
    const rows = db.prepare("SELECT subject_hash FROM application_limits WHERE bucket = 'source'").all() as { subject_hash: string }[];
    expect(new Set(rows.map(row => row.subject_hash))).toEqual(new Set([sha256(ipSubject('2001:db8:1:2::1')), sha256('203.0.113.9')]));
    expect(JSON.stringify(db.prepare('SELECT * FROM application_limits').all())).not.toMatch(/2001:db8|203\.0\.113/);
  });

  it('counts one browser across networks by its cookie, which only goes to the apply endpoint', async () => {
    const { apply, count } = await limits();
    const first = await apply('198.51.100.1');
    const cookie = deviceOf(first);
    expect(cookie).toMatchObject({ httpOnly: true, path: '/api/portal/apply', sameSite: 'Lax', maxAge: 365 * 24 * 3600 });
    expect(cookie!.value).toMatch(/^[0-9a-f-]{36}$/);
    for (let n = 2; n <= 5; n += 1) expect((await apply(`198.51.100.${n}`, cookie!.value)).statusCode).toBe(201);
    const sixth = await apply('198.51.100.6', cookie!.value);
    expect(sixth.statusCode).toBe(429);
    expect(sixth.json()).toEqual(LIMITED);
    expect(count('applications')).toEqual({ n: 5 });
    // 清掉 cookie 就算新设备；带来的不像我们发的，换一个新的 id
    expect((await apply('198.51.100.7')).statusCode).toBe(201);
    const forged = await apply('198.51.100.8', 'not-a-device-id');
    expect(forged.statusCode).toBe(201);
    expect(deviceOf(forged)!.value).toMatch(/^[0-9a-f-]{36}$/);
  });

  it('admits exactly 5 of 10 applications that arrive from one network at the same moment, with a slow human check in between', async () => {
    // 开着 Turnstile，校验要 20 毫秒：10 个请求一定在「查次数」和「写入」之间交错
    const slowCheck = (async () => {
      await new Promise(resolve => setTimeout(resolve, 20));
      return { body: { json: async () => ({ success: true }) } };
    }) as unknown as ServiceOverrides['httpRequest'];
    const context = await testApp({ httpRequest: slowCheck }, false, { TURNSTILE_SITE_KEY: 'test-site-key', TURNSTILE_SECRET_KEY: 'test-secret-key' });
    contexts.push(context);
    const { app } = context;
    const results = await Promise.all(Array.from({ length: 10 }, (_, i) => app.inject({
      method: 'POST', url: '/api/portal/apply', remoteAddress: `2001:db8:7:8::${i + 1}`,
      payload: { ...VALID, turnstile_token: 'ok', pow: { timestamp: Date.now(), nonce: 'test' } },
    })));
    expect(results.filter(response => response.statusCode === 201)).toHaveLength(5);
    expect(results.filter(response => response.statusCode === 429)).toHaveLength(5);
    expect(app.services.storage.db.prepare('SELECT COUNT(*) AS n FROM applications').get()).toEqual({ n: 5 });
  });

  it('counts only stored applications, and frees the network again after 24 hours', async () => {
    const { apply, count, db } = await limits();
    const at = (n: number) => `2001:db8:5:6::${n}`;
    // 校验不过和蜜罐都不算
    expect((await apply(at(1), undefined, { email: 'not-an-email' })).statusCode).toBe(400);
    expect((await apply(at(2), undefined, { website: 'https://bot.example' })).statusCode).toBe(201);
    expect(count('applications')).toEqual({ n: 0 });
    for (let n = 3; n <= 7; n += 1) expect((await apply(at(n))).statusCode).toBe(201);
    expect((await apply(at(8))).statusCode).toBe(429);
    const now = Date.now();
    const later = vi.spyOn(Date, 'now').mockReturnValue(now + 24 * 3600_000 + 1_000);
    try {
      expect((await apply(at(9))).statusCode).toBe(201);
    } finally {
      later.mockRestore();
    }
    expect(count('applications')).toEqual({ n: 6 });
    // 过了窗口的计数在下一次投递时删掉：只剩最后这一份的两行
    expect(db.prepare('SELECT COUNT(*) AS n FROM application_limits').get()).toEqual({ n: 2 });
  });
});

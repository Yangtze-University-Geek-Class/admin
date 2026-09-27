import { createHash, randomUUID } from 'node:crypto';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { buildApp } from '../../app/server/src/app';
import { createConfig } from '../../app/server/src/config';
import { aliyunSignature, ALIYUN_ENDPOINT, RESEND_ENDPOINT } from '../../app/server/src/lib/mail/providers';
import { MAX_ATTEMPTS, RETRY_DELAYS_MS, SEND_LEASE_MS } from '../../app/server/src/lib/mail/outbox';
import { formatMailDateTime } from '../../app/server/src/lib/mail/envelope';
import type { ServiceOverrides } from '../../app/server/src/services';
import { testApp, testConfig } from './helpers';

/**
 * 发信队列与触发点（#148）：投递发「已收到」、控制台改状态发对应的信；同一事件只发一封；
 * 白名单、没配置发信商、阿里云失败换 Resend、重试与放弃、最终状态清掉地址和正文。
 * 发信商的请求全部由假的 fetch 回答，不连真实的阿里云和 Resend。
 */

const CONSOLE_ORG = 'Yangtze-University-Geek-Class';
const T0 = Date.UTC(2026, 8, 27, 3, 0);
const ALIYUN_ENV = { MAIL_ALIYUN_ACCESS_KEY_ID: 'test-aliyun-id', MAIL_ALIYUN_ACCESS_KEY_SECRET: 'test-aliyun-secret-value', MAIL_ALIYUN_FROM: 'notify@mail.example.test' };
const RESEND_ENV = { MAIL_RESEND_API_KEY: 're_test_resend_key_value', MAIL_RESEND_FROM: 'notify@example.test' };
const BOTH = { ...ALIYUN_ENV, ...RESEND_ENV, MAIL_RECIPIENTS: 'all' };
const APPLICANT = {
  name: '李小满', className: '计科2301', email: 'Xiaoman.Li@Example.test',
  strengths: '做过一个课表小程序，后端用 Go，前端用 Vue，喜欢折腾。',
};

type Call = { url: string; headers: Record<string, string>; body: string };
type Answer = { status: number; json: unknown } | Error;

/** 假的 fetch：记下每次请求，按 handler 回答；默认两家都成功。 */
function fakeFetch(handler: (call: Call) => Answer = defaultAnswer) {
  const calls: Call[] = [];
  const fetch = (async (url: string | URL, init: RequestInit = {}) => {
    const call = { url: String(url), headers: Object.fromEntries(new Headers(init.headers).entries()), body: String(init.body) };
    calls.push(call);
    const answer = handler(call);
    if (answer instanceof Error) throw answer;
    return new Response(JSON.stringify(answer.json), { status: answer.status, headers: { 'content-type': 'application/json' } });
  }) as typeof globalThis.fetch;
  return { fetch, calls };
}
function defaultAnswer(call: Call): Answer {
  return call.url === ALIYUN_ENDPOINT ? { status: 200, json: { EnvId: 'env-1', RequestId: 'req-1' } } : { status: 200, json: { id: 're-message-1' } };
}
const aliyunCalls = (calls: Call[]) => calls.filter(call => call.url === ALIYUN_ENDPOINT);
const resendCalls = (calls: Call[]) => calls.filter(call => call.url === RESEND_ENDPOINT);

/** 可以拨的时钟 */
function clock(start = T0) {
  let now = start;
  return { now: () => now, advance: (ms: number) => { now += ms; } };
}

/** 模拟 GitHub：alice 是组织 owner（提督，全部能力）。 */
const octokitFactory = (() => ({
  request: async (route: string, params: Record<string, string>) => {
    if (route === 'GET /orgs/{org}/memberships/{username}' && params.org === CONSOLE_ORG && params.username.toLowerCase() === 'alice') return { data: { state: 'active', role: 'admin' } };
    throw Object.assign(new Error('stub not found'), { status: 404 });
  },
})) as unknown as ServiceOverrides['octokitFactory'];

const contexts: Awaited<ReturnType<typeof testApp>>[] = [];
afterEach(async () => { for (const c of contexts.splice(0)) await c.close(); });

async function setup(env: Record<string, string> = {}, fetch = fakeFetch(), time = clock()) {
  const context = await testApp({ octokitFactory, mailFetch: fetch.fetch, clock: time.now }, false, env);
  contexts.push(context);
  const { app } = context;
  const { db } = app.services.storage;
  const alice = { cookie: `sid=${app.services.auth.createSession('alice', 101, null, 'token-alice')}` };
  const apply = async (patch: Record<string, unknown> = {}) => {
    const response = await app.inject({ method: 'POST', url: '/api/portal/apply', payload: { ...APPLICANT, pow: { timestamp: Date.now(), nonce: 'test' }, ...patch } });
    expect(response.statusCode).toBe(201);
    return response.json().id as string;
  };
  const patch = (id: string, payload: Record<string, unknown>) => app.inject({ method: 'PATCH', url: `/api/console/applications/${id}`, headers: alice, payload });
  // 像刚打开详情页的控制台那样带上当前状态和审核记录的版本号（最大的 id）；payload 里写了的以 payload 为准
  const seen = (id: string) => {
    const row = db.prepare('SELECT status FROM applications WHERE id = ?').get(id) as { status: string } | undefined;
    const last = db.prepare('SELECT COALESCE(MAX(id), 0) AS id FROM application_reviews WHERE application_id = ?').get(id) as { id: number };
    return row ? { expected_status: row.status, expected_review_id: last.id } : {};
  };
  const review = (id: string, payload: Record<string, unknown>) => patch(id, { ...seen(id), ...payload });
  const detail = async (id: string) => (await app.inject({ url: `/api/console/applications/${id}`, headers: alice })).json();
  const rows = () => db.prepare('SELECT * FROM mail_outbox ORDER BY id').all() as Record<string, unknown>[];
  return { app, db, fetch, time, apply, review, patch, seen, detail, rows, mail: app.services.mail };
}

const sha256 = (value: string) => createHash('sha256').update(value).digest('hex');

describe('applying queues the 已收到 letter', () => {
  it('queues exactly one received letter, sends it, then keeps only the hash and the subject', async () => {
    const { apply, rows, mail, fetch, db } = await setup(BOTH);
    const id = await apply();
    const { created_at: submittedAt } = db.prepare('SELECT created_at FROM applications WHERE id = ?').get(id) as { created_at: number };
    const [row, ...rest] = rows();
    expect(rest).toEqual([]);
    expect(row).toMatchObject({
      event_key: `application:${id}:received`, kind: 'recruitment.received', application_id: id, review_id: null,
      recipient: APPLICANT.email, recipient_hash: sha256(APPLICANT.email.toLowerCase()), subject: '极客班收到了你的报名信',
      status: 'pending', attempts: 0, next_attempt_at: T0, reply_to: null,
    });
    // 信里按姓称呼，有报名信息和特长原文
    expect(row.text).toContain('姓名：李小满');
    expect(row.text).toContain('邮箱：Xiaoman.Li@Example.test');
    expect(row.text).toContain(`投递时间：${formatMailDateTime(submittedAt)}（北京时间）`);
    expect(row.text).toContain(`> ${APPLICANT.strengths}`);
    expect(row.text).toContain('李同学，你好：');
    expect(row.html).not.toMatch(/avatar/i);

    await mail.drain();
    expect(fetch.calls).toHaveLength(1);
    expect(rows()[0]).toMatchObject({
      status: 'sent', attempts: 1, provider: 'aliyun', provider_message_id: 'env-1', sent_at: T0, last_error: null,
      recipient: null, html: null, text: null, subject: '极客班收到了你的报名信', recipient_hash: sha256('xiaoman.li@example.test'),
    });
    // 再跑一轮不会再发
    await mail.drain();
    expect(fetch.calls).toHaveLength(1);
  });

  it('writes one row per event: the same event key twice stays one letter', async () => {
    const { apply, rows, mail, fetch } = await setup(BOTH);
    const id = await apply();
    const rendered = mail.recruitmentLetter('received', { id, name: '李小满', class_name: '计科2301', email: 'x@example.test', strengths: '一段够长的特长与优点。', created_at: T0 });
    const again = mail.enqueue({ eventKey: `application:${id}:received`, kind: 'recruitment.received', applicationId: id, to: 'x@example.test', mail: rendered });
    expect(again).toMatchObject({ id: rows()[0].id, created: false });
    expect(rows()).toHaveLength(1);
    expect(rows()[0].recipient).toBe(APPLICANT.email);
    await mail.drain();
    await mail.drain();
    expect(fetch.calls).toHaveLength(1);
  });

  it('keeps the application when the letter cannot be built or queued', async () => {
    const { app, apply, rows, db } = await setup(BOTH);
    vi.spyOn(app.services.mail, 'recruitmentLetter').mockImplementation(() => { throw new Error('template broke'); });
    const id = await apply();
    expect(db.prepare('SELECT status FROM applications WHERE id = ?').get(id)).toEqual({ status: 'received' });
    expect(rows()).toEqual([]);
  });

  it('does not queue anything for a honeypot hit', async () => {
    const { apply, rows } = await setup(BOTH);
    await apply({ website: 'https://bot.example' });
    expect(rows()).toEqual([]);
  });
});

describe('limits on the 已收到 letter', () => {
  it('sends one received letter per address in 24 hours; the applications still go through', async () => {
    const time = clock();
    const { apply, review, rows, mail, fetch, detail, db } = await setup(BOTH, fakeFetch(), time);
    const first = await apply();
    const second = await apply({ email: ' XIAOMAN.LI@example.test ' });
    const third = await apply({ name: 'www.evil.example' });
    expect((db.prepare('SELECT COUNT(*) AS n FROM applications').get() as { n: number }).n).toBe(3);
    expect(rows().map(row => [row.application_id, row.status, row.skip_reason])).toEqual([
      [first, 'pending', null], [second, 'skipped', 'recipient_limited'], [third, 'skipped', 'recipient_limited'],
    ]);
    expect(rows()[1]).toMatchObject({ recipient: null, html: null, text: null });
    await mail.drain();
    expect(fetch.calls).toHaveLength(1);
    expect((await detail(second)).received_mail).toMatchObject({ status: 'skipped', skip_reason: 'recipient_limited' });
    // 过了 24 小时再投，照常发
    time.advance(24 * 3600_000);
    const later = await apply();
    expect(rows().at(-1)).toMatchObject({ application_id: later, status: 'pending' });
    // 改状态的信不受这个上限影响
    expect((await review(first, { status: 'accepted' })).statusCode).toBe(200);
    expect(rows().at(-1)).toMatchObject({ kind: 'recruitment.accepted', status: 'pending' });
  });

  it('treats +tags, a trailing dot and Gmail dots as the same inbox, and refuses a domain ending in a dot', async () => {
    const { app, apply, rows } = await setup(BOTH);
    await apply({ email: 'victim@gmail.com' });
    await apply({ email: 'victim+1@gmail.com' });
    await apply({ email: 'Vic.Tim+x@googlemail.com' });
    await apply({ email: 'other@example.test' });
    await apply({ email: 'other+a@example.test' });
    expect(rows().map(row => row.skip_reason)).toEqual([null, 'recipient_limited', 'recipient_limited', null, 'recipient_limited']);
    // 末尾带点、连续的点、以点开头的域名在投递时就拒收
    for (const email of ['victim@gmail.com.', 'a@b..c', 'a@.b.c']) {
      // 换一个来源 IP，不碰每个 IP 每分钟 5 次的限流
      const response = await app.inject({ method: 'POST', url: '/api/portal/apply', remoteAddress: '198.51.100.9', payload: { ...APPLICANT, email, pow: { timestamp: Date.now(), nonce: 'test' } } });
      expect(response.statusCode, email).toBe(400);
      expect(response.json().fields, email).toHaveProperty('email');
    }
    expect(rows()).toHaveLength(5);
  });

  it('sends at most 5 received letters an hour from one IP, grouping IPv6 by /64; the applications still go through', async () => {
    const { app, rows, db } = await setup(BOTH);
    const from = (ip: string, n: number) => app.inject({
      method: 'POST', url: '/api/portal/apply', remoteAddress: ip,
      payload: { ...APPLICANT, email: `u${n}@example.test`, pow: { timestamp: Date.now(), nonce: 'test' } },
    });
    // 同一个 /64 里的六个地址：每个地址自己的每分钟限流碰不到，但算同一个来源
    for (let n = 1; n <= 6; n += 1) expect((await from(`2001:db8:1:2::${n}`, n)).statusCode).toBe(201);
    expect((await from('203.0.113.9', 7)).statusCode).toBe(201);
    expect((db.prepare('SELECT COUNT(*) AS n FROM applications').get() as { n: number }).n).toBe(7);
    expect(rows().map(row => [row.status, row.skip_reason])).toEqual([
      ...Array.from({ length: 5 }, () => ['pending', null]), ['skipped', 'source_limited'], ['pending', null],
    ]);
    expect(rows()[5]).toMatchObject({ recipient: null, html: null, text: null });
    // 库里只有来源的哈希，没有 IP
    expect(rows()[0].source_hash).toBe(sha256('2001:db8:1:2::/64'));
    expect(rows()[6].source_hash).toBe(sha256('203.0.113.9'));
  });

  it('counts the per-source hour and day windows, and skips the check when there is no source', async () => {
    const time = clock();
    const { mail, rows } = await setup(BOTH, fakeFetch(), time);
    const letter = mail.recruitmentLetter('received', { id: 'x', name: '李小满', class_name: '计科2301', email: 'a@example.test', strengths: '一段够长的特长与优点。', created_at: T0 });
    let n = 0;
    const put = (source: string | null) => mail.enqueue(
      { eventKey: `test:${(n += 1)}`, kind: 'recruitment.received', to: `u${n}@example.test`, mail: letter, source },
      { perSourceHour: 2, perSourceDay: 3 },
    ).status;
    expect([put('198.51.100.1'), put('198.51.100.1'), put('198.51.100.1')]).toEqual(['pending', 'pending', 'skipped']);
    expect(rows().at(-1)).toMatchObject({ skip_reason: 'source_limited' });
    expect(put('198.51.100.2')).toBe('pending');
    expect(put(null)).toBe('pending');
    time.advance(3600_000);
    // 过了一小时，一天的额度还剩一封
    expect([put('198.51.100.1'), put('198.51.100.1')]).toEqual(['pending', 'skipped']);
    time.advance(23 * 3600_000);
    expect(put('198.51.100.1')).toBe('pending');
  });

  it('does not count letters that were never going to be sent', async () => {
    const { apply, rows } = await setup({ ...RESEND_ENV, MAIL_RECIPIENTS: 'allowlist', MAIL_ALLOWLIST: 'friend@example.test' });
    await apply();
    await apply();
    await apply({ email: 'friend@example.test' });
    await apply({ email: 'Friend@example.test' });
    expect(rows().map(row => row.skip_reason)).toEqual(['not_allowlisted', 'not_allowlisted', null, 'recipient_limited']);
  });

  it('stops at the hourly cap for one kind of letter, and counts again after the hour', async () => {
    const time = clock();
    const { mail, rows } = await setup(BOTH, fakeFetch(), time);
    const letter = mail.recruitmentLetter('received', { id: 'x', name: '李小满', class_name: '计科2301', email: 'a@example.test', strengths: '一段够长的特长与优点。', created_at: T0 });
    const put = (n: number) => mail.enqueue({ eventKey: `test:${n}`, kind: 'recruitment.received', to: `u${n}@example.test`, mail: letter }, { perHour: 2 });
    expect([put(1), put(2), put(3)].map(result => result.status)).toEqual(['pending', 'pending', 'skipped']);
    expect(rows()[2]).toMatchObject({ skip_reason: 'rate_limited', recipient: null });
    // 别的种类不算在里面
    expect(mail.enqueue({ eventKey: 'test:other', kind: 'recruitment.accepted', to: 'u9@example.test', mail: letter }, { perHour: 2 }).status).toBe('pending');
    time.advance(3600_000);
    expect(put(4).status).toBe('pending');
  });
});

describe('recipients and configuration', () => {
  it('records mail_disabled when no provider is configured, and never keeps the address or body', async () => {
    const { apply, rows, mail, detail } = await setup();
    const id = await apply();
    expect(rows()).toEqual([expect.objectContaining({ status: 'skipped', skip_reason: 'mail_disabled', recipient: null, html: null, text: null, attempts: 0, subject: '极客班收到了你的报名信' })]);
    await mail.drain();
    const body = await detail(id);
    expect(body.mail).toEqual({ enabled: false, recipients: 'allowlist', deliverable: false });
    expect(body.received_mail).toEqual({ status: 'skipped', skip_reason: 'mail_disabled', attempts: 0, subject: '极客班收到了你的报名信', sent_at: null, updated_at: T0 });
  });

  it('only writes to allowlisted addresses in allowlist mode (case-insensitive)', async () => {
    const { apply, rows, mail, fetch, detail } = await setup({ ...RESEND_ENV, MAIL_RECIPIENTS: 'allowlist', MAIL_ALLOWLIST: ' friend@example.test , XIAOMAN.LI@example.test' });
    const allowed = await apply();
    const other = await apply({ email: 'stranger@example.test' });
    const [first, second] = rows();
    expect(first).toMatchObject({ application_id: allowed, status: 'pending', skip_reason: null });
    expect(second).toMatchObject({ application_id: other, status: 'skipped', skip_reason: 'not_allowlisted', recipient: null, html: null, text: null, recipient_hash: sha256('stranger@example.test') });
    await mail.drain();
    expect(fetch.calls.map(call => JSON.parse(call.body).to)).toEqual([[APPLICANT.email]]);
    expect((await detail(allowed)).mail).toEqual({ enabled: true, recipients: 'allowlist', deliverable: true });
    expect((await detail(other)).mail).toEqual({ enabled: true, recipients: 'allowlist', deliverable: false });
  });

  it('boots with every mail variable empty and refuses half-configured or malformed ones', async () => {
    const env = {
      NODE_ENV: 'test', PUBLIC_ORIGIN: 'https://example.test', DB_PATH: ':memory:', SESSION_SECRET: 'isolated-core-test-secret-at-least-32',
      ENCRYPTION_KEY: Buffer.alloc(32, 1).toString('base64'), OAUTH_CLIENT_ID: 'test-client', OAUTH_CLIENT_SECRET: 'test-only-placeholder',
    };
    expect(createConfig(env).mail).toEqual({ aliyun: null, resend: null, assetBase: 'https://cdn.crosery.com/yzgc/mail/v1/', replyTo: null, recipients: 'allowlist', allowlist: [] });
    expect(() => createConfig({ ...env, MAIL_ALIYUN_ACCESS_KEY_ID: 'only-the-id' })).toThrow('must be set together');
    expect(() => createConfig({ ...env, MAIL_ALIYUN_ACCESS_KEY_SECRET: 'only-the-secret' })).toThrow('must be set together');
    expect(() => createConfig({ ...env, MAIL_RECIPIENTS: 'everyone' })).toThrow('MAIL_RECIPIENTS');
    // 密钥有了、发件地址没写：这家发信商不算配置好
    expect(createConfig({ ...env, MAIL_RESEND_API_KEY: 're_x' }).mail.resend).toBeNull();
    const boot = (extra: Record<string, string>) => buildApp({ config: testConfig({ ...env, ...extra }), staticRoot: false });
    for (const [key, value] of [['MAIL_REPLY_TO', 'a@b.com\r\nBcc: x@evil.example'], ['MAIL_RESEND_FROM', 'x <a@b.com>'], ['MAIL_ASSET_BASE', 'http://cdn.example.test/mail/']]) {
      const extra = key === 'MAIL_RESEND_FROM' ? { MAIL_RESEND_API_KEY: 're_x', [key]: value } : { [key]: value };
      await expect(boot(extra), key).rejects.toThrow(key);
      // 错误信息不带配置的值
      await expect(boot(extra), key).rejects.not.toThrow(value);
    }
  });
});

describe('sending: provider order, retries and the final state', () => {
  it('falls back to Resend when Aliyun fails, and signs the Aliyun request per the RPC v1 rules', async () => {
    const fetch = fakeFetch(call => call.url === ALIYUN_ENDPOINT ? { status: 400, json: { Code: 'InvalidMailAddress.NotFound', Message: `no such sender for ${APPLICANT.email}` } } : { status: 200, json: { id: 're-2' } });
    const { apply, rows, mail } = await setup(BOTH, fetch);
    await apply();
    await mail.drain();
    expect(fetch.calls.map(call => call.url)).toEqual([ALIYUN_ENDPOINT, RESEND_ENDPOINT]);
    // 发出了，前一家的失败也留着，看得出为什么走了 Resend
    expect(rows()[0]).toMatchObject({ status: 'sent', provider: 'resend', provider_message_id: 're-2', attempts: 1, last_error: 'aliyun http 400 InvalidMailAddress.NotFound' });

    const params = Object.fromEntries(new URLSearchParams(aliyunCalls(fetch.calls)[0].body));
    expect(params).toMatchObject({
      Action: 'SingleSendMail', Version: '2015-11-23', Format: 'JSON', RegionId: 'cn-hangzhou', AccessKeyId: 'test-aliyun-id',
      SignatureMethod: 'HMAC-SHA1', SignatureVersion: '1.0', Timestamp: '2026-09-27T03:00:00Z', AccountName: 'notify@mail.example.test',
      AddressType: '1', ReplyToAddress: 'false', FromAlias: '长江大学极客班', ToAddress: APPLICANT.email, Subject: '极客班收到了你的报名信',
    });
    expect(params.HtmlBody).toContain('李小满');
    const { Signature, ...signed } = params;
    expect(Signature).toBe(aliyunSignature(signed, 'test-aliyun-secret-value'));
    expect(aliyunCalls(fetch.calls)[0].headers['content-type']).toBe('application/x-www-form-urlencoded');

    const resend = resendCalls(fetch.calls)[0];
    expect(resend.headers.authorization).toBe('Bearer re_test_resend_key_value');
    expect(resend.headers['idempotency-key']).toMatch(/^yzgc-mail-[0-9a-f]{40}$/);
    const payload = JSON.parse(resend.body);
    expect(payload).toMatchObject({ from: '长江大学极客班 <notify@example.test>', to: [APPLICANT.email], subject: '极客班收到了你的报名信' });
    expect(payload).not.toHaveProperty('reply_to');
    expect(payload.text).toContain('姓名：李小满');
  });

  it('matches the signature example in the Aliyun documentation', () => {
    const params = {
      AccessKeyId: 'testid', AccountName: "<a%b'>", Action: 'SingleSendMail', AddressType: '1', Format: 'XML', HtmlBody: '4', RegionId: 'cn-hangzhou',
      ReplyToAddress: 'true', SignatureMethod: 'HMAC-SHA1', SignatureNonce: 'c1b2c332-4cfb-4a0f-b8cc-ebe622aa0a5c', SignatureVersion: '1.0', Subject: '3',
      TagName: '2', Timestamp: '2016-10-20T06:27:56Z', ToAddress: '1@test.com', Version: '2015-11-23',
    };
    expect(aliyunSignature(params, 'testsecret')).toBe('llJfXJjBW3OacrVgxxsITgYaYm0=');
  });

  it('retries after 1 min, 5 min, 30 min, 2 h and 6 h, then gives up after the 6th failure and clears the letter', async () => {
    const fetch = fakeFetch(call => call.url === ALIYUN_ENDPOINT ? new TypeError('fetch failed') : { status: 500, json: { name: 'internal_server_error', message: 'boom' } });
    const time = clock();
    const { apply, rows, mail } = await setup(BOTH, fetch, time);
    await apply();
    const seen: number[] = [];
    for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt += 1) {
      await mail.drain();
      const row = rows()[0];
      expect(row.attempts).toBe(attempt);
      seen.push(fetch.calls.length);
      if (attempt < MAX_ATTEMPTS) {
        const delay = RETRY_DELAYS_MS[attempt - 1];
        expect(row).toMatchObject({ status: 'pending', next_attempt_at: time.now() + delay, last_error: 'aliyun network TypeError; resend http 500 internal_server_error' });
        expect(row.recipient).toBe(APPLICANT.email);
        // 还没到时间：什么也不发
        time.advance(delay - 1);
        await mail.drain();
        expect(fetch.calls.length).toBe(seen.at(-1));
        time.advance(1);
      }
    }
    expect(RETRY_DELAYS_MS).toEqual([60_000, 300_000, 1_800_000, 7_200_000, 21_600_000]);
    expect(fetch.calls).toHaveLength(2 * MAX_ATTEMPTS);
    expect(rows()[0]).toMatchObject({ status: 'failed', attempts: 6, recipient: null, html: null, text: null, sent_at: null, subject: '极客班收到了你的报名信' });
    // 记录里没有密钥、地址和正文
    const failure = String(rows()[0].last_error);
    for (const secret of ['test-aliyun-secret-value', 're_test_resend_key_value', APPLICANT.email, '李小满', 'boom']) expect(failure).not.toContain(secret);
    time.advance(24 * 3600_000);
    await mail.drain();
    expect(fetch.calls).toHaveLength(2 * MAX_ATTEMPTS);
  });

  it('keeps the Resend idempotency key the same across retries', async () => {
    let fail = true;
    const fetch = fakeFetch(() => (fail ? { status: 503, json: {} } : { status: 200, json: { id: 're-3' } }));
    const time = clock();
    const { apply, rows, mail } = await setup({ ...RESEND_ENV, MAIL_RECIPIENTS: 'all' }, fetch, time);
    await apply();
    await mail.drain();
    fail = false;
    time.advance(RETRY_DELAYS_MS[0]);
    await mail.drain();
    expect(rows()[0]).toMatchObject({ status: 'sent', attempts: 2, provider: 'resend' });
    const keys = fetch.calls.map(call => call.headers['idempotency-key']);
    expect(keys).toHaveLength(2);
    expect(keys[0]).toBe(keys[1]);
  });

  it('retries a letter whose sending lease ran out, and leaves a fresh lease alone', async () => {
    const time = clock();
    const { apply, rows, mail, db, fetch } = await setup(BOTH, fakeFetch(), time);
    const stale = await apply();
    const fresh = await apply({ email: 'fresh@example.test' });
    // 模拟进程在发信中途退出：一封租约已经过期，一封刚领走
    db.prepare("UPDATE mail_outbox SET status = 'sending', attempts = 1, next_attempt_at = ? WHERE application_id = ?").run(T0 - 1, stale);
    db.prepare("UPDATE mail_outbox SET status = 'sending', attempts = 1, next_attempt_at = ? WHERE application_id = ?").run(T0 + SEND_LEASE_MS, fresh);
    await mail.drain();
    expect(fetch.calls).toHaveLength(1);
    const [first, second] = rows();
    expect(first).toMatchObject({ application_id: stale, status: 'sent', attempts: 2 });
    expect(second).toMatchObject({ application_id: fresh, status: 'sending', attempts: 1 });
  });

  it('sends letters with a reply-to only through Resend, and treats Aliyun alone as not configured', async () => {
    const withReply = await setup({ ...BOTH, MAIL_REPLY_TO: 'join@example.test' });
    await withReply.apply();
    expect(withReply.rows()[0]).toMatchObject({ reply_to: 'join@example.test' });
    expect(withReply.rows()[0].text).toContain('有问题直接回复这封邮件。');
    await withReply.mail.drain();
    expect(withReply.fetch.calls.map(call => call.url)).toEqual([RESEND_ENDPOINT]);
    expect(JSON.parse(withReply.fetch.calls[0].body).reply_to).toBe('join@example.test');
    expect(withReply.rows()[0]).toMatchObject({ status: 'sent', provider: 'resend' });

    // 配了回信地址、只有阿里云：没有一家能带 Reply-To，按没有配置发信商处理，控制台不会说「保存并发邮件」
    const aliyunOnly = await setup({ ...ALIYUN_ENV, MAIL_RECIPIENTS: 'all', MAIL_REPLY_TO: 'join@example.test' });
    const id = await aliyunOnly.apply();
    await aliyunOnly.mail.drain();
    expect(aliyunOnly.fetch.calls).toEqual([]);
    expect(aliyunOnly.rows()[0]).toMatchObject({ status: 'skipped', skip_reason: 'mail_disabled', recipient: null, html: null, text: null });
    expect((await aliyunOnly.detail(id)).mail).toEqual({ enabled: false, recipients: 'all', deliverable: false });
  });

  it('sends right after enqueue when the worker runs in the server process, and stops with the app', async () => {
    const fetch = fakeFetch();
    const config = testConfig({
      NODE_ENV: 'test', PUBLIC_ORIGIN: 'https://example.test', DB_PATH: ':memory:', SESSION_SECRET: 'isolated-core-test-secret-at-least-32',
      ENCRYPTION_KEY: Buffer.alloc(32, 1).toString('base64'), OAUTH_CLIENT_ID: 'test-client', OAUTH_CLIENT_SECRET: 'test-only-placeholder', POW_DIFFICULTY: '0',
      ...BOTH,
    });
    const app = await buildApp({ config, staticRoot: false, mailWorker: true, overrides: { mailFetch: fetch.fetch } });
    await app.ready();
    try {
      const response = await app.inject({ method: 'POST', url: '/api/portal/apply', payload: { ...APPLICANT, pow: { timestamp: Date.now(), nonce: 'test' } } });
      expect(response.statusCode).toBe(201);
      await vi.waitFor(() => expect(app.services.storage.db.prepare('SELECT status FROM mail_outbox').get()).toEqual({ status: 'sent' }), { timeout: 5000 });
      expect(fetch.calls).toHaveLength(1);
    } finally {
      await app.close();
    }
  });
});

describe('console status changes', () => {
  it('rejects statuses outside the four, including the retired reviewing', async () => {
    const { apply, review, rows } = await setup(BOTH);
    const id = await apply();
    for (const status of ['reviewing', 'bogus', '']) {
      const response = await review(id, { status });
      expect(response.statusCode, status).toBe(400);
      expect(response.json(), status).toMatchObject({ error: 'invalid_status', message: '状态只能是已收到、待面试、已录取、未通过' });
    }
    expect(rows()).toHaveLength(1);
  });

  it('asks for the interview time and place before queueing the interview letter, and changes nothing without them', async () => {
    const { apply, review, rows, db } = await setup(BOTH);
    const id = await apply();
    const missing = await review(id, { status: 'interview', note: '约面试' });
    expect(missing.statusCode).toBe(400);
    expect(missing.json()).toEqual({ error: 'letter_required', message: '要发待面试的信，请填面试时间和地点', fields: { time: '请填面试时间', place: '请填面试地点' } });
    const blankPlace = await review(id, { status: 'interview', letter: { time: '9 月 30 日 19:00', place: ' \n ' } });
    expect(blankPlace.json()).toMatchObject({ error: 'letter_required', fields: { place: '请填面试地点' } });
    expect(blankPlace.json().fields).not.toHaveProperty('time');
    expect(db.prepare('SELECT status FROM applications WHERE id = ?').get(id)).toEqual({ status: 'received' });
    expect(db.prepare('SELECT COUNT(*) AS n FROM application_reviews').get()).toEqual({ n: 0 });
    expect(rows()).toHaveLength(1);
    // 超长的字段按请求格式拒绝
    expect((await review(id, { status: 'interview', letter: { time: '时'.repeat(61), place: '东校区' } })).statusCode).toBe(400);
  });

  it('queues the interview letter with the time, place and notes, keeps the internal note out of it, and shows it on the review', async () => {
    const { apply, review, rows, detail, mail } = await setup(BOTH);
    const id = await apply();
    const note = '只给审核人看的备注：一面偏后端';
    const response = await review(id, { status: 'interview', note, letter: { time: '9 月 30 日（周三）19:00', place: '东校区 3 教 301', notes: '面试大约 20 分钟。\n\n带上学生证。' } });
    expect(response.statusCode).toBe(200);
    const body = response.json();
    expect(body.application.status).toBe('interview');
    expect(body.review.mail).toEqual({ status: 'pending', skip_reason: null, attempts: 0, subject: '极客班面试安排：9 月 30 日（周三）19:00', sent_at: null, updated_at: T0 });
    const letter = rows()[1];
    expect(letter).toMatchObject({ event_key: `review:${body.review.id}`, kind: 'recruitment.interview', review_id: body.review.id, application_id: id });
    expect(letter.text).toContain('地点：东校区 3 教 301');
    expect(letter.text).toContain('1. 面试大约 20 分钟。\n2. 带上学生证。');
    expect(letter.text).toContain('到官网的意见箱留言，联系方式一栏填这个邮箱，我们再约。');
    expect(letter.text).toContain('姓名：李小满');
    expect(`${letter.html}${letter.text}`).not.toContain(note);

    await mail.drain();
    const shown = await detail(id);
    expect(shown.reviews).toHaveLength(1);
    expect(shown.reviews[0]).toMatchObject({ id: body.review.id, to_status: 'interview', note, mail: { status: 'sent', attempts: 1, sent_at: T0 } });
    expect(shown.received_mail).toMatchObject({ status: 'sent', subject: '极客班收到了你的报名信' });
    expect(shown.mail).toEqual({ enabled: true, recipients: 'all', deliverable: true });
  });

  it('queues the accepted and rejected letters with the reviewer text', async () => {
    const { apply, review, rows } = await setup(BOTH);
    const accepted = await apply();
    const rejected = await apply({ email: 'second@example.test' });
    expect((await review(accepted, { status: 'accepted', letter: { notes: '留意 GitHub 发来的组织邀请。\n周六下午来 3 教 301 见面。' } })).statusCode).toBe(200);
    expect((await review(rejected, { status: 'rejected', letter: { message: '这一轮我们更想找做过后端项目的同学。' } })).statusCode).toBe(200);
    const [, , acceptedLetter, rejectedLetter] = rows();
    expect(acceptedLetter).toMatchObject({ kind: 'recruitment.accepted', subject: '你已通过极客班招新' });
    expect(acceptedLetter.text).toContain('接下来\n1. 留意 GitHub 发来的组织邀请。\n2. 周六下午来 3 教 301 见面。');
    expect(rejectedLetter).toMatchObject({ kind: 'recruitment.rejected', recipient: 'second@example.test' });
    expect(rejectedLetter.text).toContain('这一轮我们更想找做过后端项目的同学。');
    expect(rejectedLetter.text).toContain('邮箱：second@example.test');
  });

  it('refuses a letter that asks for a direct reply when there is no reply-to address', async () => {
    const { apply, review, rows, db } = await setup(BOTH);
    const id = await apply();
    const response = await review(id, { status: 'rejected', letter: { message: '有问题直接回复这封邮件。' } });
    expect(response.statusCode).toBe(400);
    expect(response.json()).toMatchObject({ error: 'letter_invalid' });
    expect(db.prepare('SELECT status FROM applications WHERE id = ?').get(id)).toEqual({ status: 'received' });
    expect(rows()).toHaveLength(1);
  });

  it('refuses a change made from a stale page with 409, without a review or a letter', async () => {
    const { apply, review, patch, rows, db } = await setup(BOTH);
    const id = await apply();
    // 两位审核人都在「已收到」、还没有审核记录时打开了这份投递
    const page = { expected_status: 'received', expected_review_id: 0 };
    const first = await patch(id, { ...page, status: 'accepted' });
    expect(first.statusCode).toBe(200);
    const stale = await patch(id, { ...page, status: 'interview', letter: { time: '9 月 30 日 19:00', place: '东校区 3 教 301' } });
    expect(stale.statusCode).toBe(409);
    expect(stale.json()).toMatchObject({ error: 'status_changed', message: '这份投递刚被别人处理过，现在是「已录取」，看过最新的记录再改', application: { id, status: 'accepted' } });
    expect(db.prepare('SELECT status FROM applications WHERE id = ?').get(id)).toEqual({ status: 'accepted' });
    expect(db.prepare('SELECT COUNT(*) AS n FROM application_reviews').get()).toEqual({ n: 1 });
    expect(rows().map(row => row.kind)).toEqual(['recruitment.received', 'recruitment.accepted']);
    // 只补备注也要看的是最新的记录
    expect((await patch(id, { ...page, note: '补一句' })).statusCode).toBe(409);
    expect((await review(id, { note: '补一句' })).statusCode).toBe(200);
    // 不是四个状态之一的、负数的按请求格式拒绝
    expect((await review(id, { status: 'rejected', expected_status: 'reviewing' })).json()).toMatchObject({ error: 'validation_error' });
    expect((await review(id, { status: 'rejected', expected_review_id: -1 })).json()).toMatchObject({ error: 'validation_error' });
  });

  it('catches a status changed away and back (ABA) by the latest review id', async () => {
    const { apply, review, patch, rows } = await setup(BOTH);
    const id = await apply();
    const page = { expected_status: 'received', expected_review_id: 0 };
    // 别人改成待面试（发了面试信），又改回已收到；状态和旧页面看到的一样
    expect((await review(id, { status: 'interview', letter: { time: '9 月 30 日 19:00', place: '东校区 3 教 301' } })).statusCode).toBe(200);
    expect((await review(id, { status: 'received' })).statusCode).toBe(200);
    const stale = await patch(id, { ...page, status: 'rejected' });
    expect(stale.statusCode).toBe(409);
    expect(stale.json()).toMatchObject({ error: 'status_changed', message: '这份投递刚被别人处理过，现在是「已收到」，看过最新的记录再改' });
    expect(rows().map(row => row.kind)).toEqual(['recruitment.received', 'recruitment.interview']);
  });

  it('uses the largest review id, so a server clock stepping back does not hide a change away and back', async () => {
    const { apply, review, patch, seen, rows } = await setup(BOTH);
    const id = await apply();
    expect((await review(id, { note: '先看一眼' })).statusCode).toBe(200);
    const page = seen(id); // 旧页面：已收到，版本号是第 1 条审核记录
    const now = Date.now();
    const back = vi.spyOn(Date, 'now').mockReturnValue(now - 120_000); // 服务器时钟往回拨了 2 分钟
    try {
      expect((await review(id, { status: 'interview', letter: { time: '9 月 30 日 19:00', place: '东校区 3 教 301' } })).statusCode).toBe(200);
      expect((await review(id, { status: 'received' })).statusCode).toBe(200);
      const stale = await patch(id, { ...page, status: 'rejected' });
      expect(stale.statusCode).toBe(409);
      expect(stale.json()).toMatchObject({ error: 'status_changed' });
    } finally {
      back.mockRestore();
    }
    expect(rows().map(row => row.kind)).toEqual(['recruitment.received', 'recruitment.interview']);
  });

  it('refuses a status change from an old page that sends neither field, and still takes a note from it', async () => {
    const { apply, patch, rows, db } = await setup(BOTH);
    const id = await apply();
    for (const body of [{ status: 'accepted' }, { status: 'accepted', expected_status: 'received' }, { status: 'accepted', expected_review_id: 0 }]) {
      const response = await patch(id, body);
      expect(response.statusCode, JSON.stringify(body)).toBe(409);
      expect(response.json(), JSON.stringify(body)).toMatchObject({ error: 'status_changed', message: '这个页面是旧版本，刷新后再改' });
    }
    expect(rows()).toHaveLength(1);
    expect((await patch(id, { note: '旧页面补的备注' })).statusCode).toBe(200);
    expect(db.prepare('SELECT status FROM applications WHERE id = ?').get(id)).toEqual({ status: 'received' });
  });

  it('queues nothing when notify is false, when going back to 已收到, or for a note only', async () => {
    const { apply, review, rows, detail } = await setup(BOTH);
    const id = await apply();
    const silent = await review(id, { status: 'accepted', notify: false });
    expect(silent.statusCode).toBe(200);
    expect(silent.json().review.mail).toBeNull();
    const back = await review(id, { status: 'received', letter: { message: '不会发出去' } });
    expect(back.statusCode).toBe(200);
    expect(back.json().review.mail).toBeNull();
    const noteOnly = await review(id, { note: '补一句备注' });
    expect(noteOnly.statusCode).toBe(200);
    expect(noteOnly.json().review.mail).toBeNull();
    expect(rows().map(row => row.kind)).toEqual(['recruitment.received']);
    expect((await detail(id)).reviews.map((item: { mail: unknown }) => item.mail)).toEqual([null, null, null]);
    // 没有这份投递
    expect((await review(randomUUID(), { status: 'accepted' })).statusCode).toBe(404);
  });
});

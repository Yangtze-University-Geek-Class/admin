import { STATIC_CDN_ORIGIN as CDN_ORIGIN } from '../static-cdn-fixture';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { buildApp } from '../../app/server/src/app';
import type { ServiceOverrides } from '../../app/server/src/services';
import { DEFAULT_CONSOLE_ORG } from '../../app/server/src/config';
import { redeemInvite } from '../../app/server/src/lib/invite-codes';
import { accountIdOf, grantPermGroup, signIn, testApp, testConfig } from './helpers';

/**
 * 访问防护（#333）：按真实客户端 IP 的封禁与逐级加长、封禁表与限流计数落库、全站北京日上限（发码、注册、意见箱、设备码）、
 * 没有 visitor cookie 的注册更严、邮箱收件人日上限（#319）、邀请码最短 8 位（#319）、控制台列表与解封（写审计）。
 * 测试用的 IP 走 inject 的 remoteAddress（不设 TRUST_PROXY 时就是客户端地址）；发信商与外部请求都是假的。
 */
const contexts: { app: FastifyInstance; close: () => Promise<void> }[] = [];
const dirs: string[] = [];
afterEach(async () => {
  for (const c of contexts.splice(0)) await c.close();
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

const MAIL_ENV = { MAIL_RESEND_API_KEY: 're_test_resend_key_value', MAIL_RESEND_FROM: 'notify@example.test', MAIL_RECIPIENTS: 'all' };
/** 阈值压低，方便用几次请求触发封禁；封禁 15 分钟，再犯 60 分钟（上限），上一段封禁结束后安静 24 小时则级别归零。 */
const SHIELD_ENV = { SHIELD_THRESHOLD: '8', SHIELD_WINDOW_MINUTES: '10', SHIELD_BLOCK_MINUTES: '15,60', SHIELD_DECAY_HOURS: '24' };

function setup(options: { env?: Record<string, string>; now?: { value: number } } = {}) {
  const clock = options.now ?? { value: Date.now() };
  const tick = (ms: number) => { clock.value += ms; };
  const mail = mailbox();
  return testApp({ clock: () => clock.value, mailFetch: mail.fetch }, false, { ...MAIL_ENV, ...SHIELD_ENV, ...(options.env ?? {}) })
    .then(context => {
      contexts.push(context);
      return { app: context.app, tick, mail, clock };
    });
}

/** 假的发信商：记下每封信，验证码从正文里取（和 signin-methods 的做法一样）。 */
function mailbox() {
  const letters: { to: string; text: string }[] = [];
  const fetch = (async (_url: string, init: { body: string }) => {
    const body = JSON.parse(init.body) as { to: string[]; text: string };
    letters.push({ to: body.to[0], text: body.text });
    return new Response(JSON.stringify({ id: `mail-${letters.length}` }), { status: 200, headers: { 'Content-Type': 'application/json' } });
  }) as unknown as ServiceOverrides['mailFetch'];
  async function codeFor(to: string, nth = 1): Promise<string> {
    for (let i = 0; i < 200; i++) {
      const mine = letters.filter(letter => letter.to === to);
      if (mine.length >= nth) return /\b(\d{6})\b/.exec(mine[nth - 1].text)![1];
      await new Promise(resolve => setTimeout(resolve, 5));
    }
    throw new Error(`no letter for ${to}`);
  }
  return { letters, fetch, codeFor };
}

/** 用错误密码登录 n 次：每次都是一条失败信号（400 + 登录失败的额外分数），从 remoteAddress 发出。 */
async function failSignIn(app: FastifyInstance, ip: string, n: number) {
  for (let i = 0; i < n; i++) {
    await app.inject({ method: 'POST', url: '/auth/email/password', remoteAddress: ip, payload: { email: `nobody${i}-${ip}@example.test`, password: 'wrong-password-1' } });
  }
}
const SIGN_IN_PROBE = { method: 'POST' as const, url: '/auth/email/password', payload: { email: 'probe@example.test', password: 'wrong-password-1' } };

describe('IP 封禁（#333）', () => {
  it('同一 IP 的失败信号超过阈值后被封禁，封禁期内回 403 ip_blocked，别的 IP 不受影响', async () => {
    const { app } = await setup();
    await failSignIn(app, '198.51.100.7', 2);
    const blocked = await app.inject({ ...SIGN_IN_PROBE, remoteAddress: '198.51.100.7' });
    expect(blocked.statusCode).toBe(403);
    expect(blocked.json()).toMatchObject({ error: 'ip_blocked', retry_after: 900 });
    expect(blocked.json().message).toEqual(expect.any(String));
    expect(blocked.json().request_id).toEqual(expect.any(String));
    const other = await app.inject({ ...SIGN_IN_PROBE, remoteAddress: '198.51.100.8' });
    expect(other.statusCode).toBe(400);
  });

  it('到期后自动解封；再犯时封禁时间逐级加长，到上限为止，安静期（上一段封禁结束后 24 小时）过后从第一级重新开始', async () => {
    const { app, tick } = await setup();
    await failSignIn(app, '198.51.100.9', 2);
    tick(15 * 60_000 + 1_000);
    expect((await app.inject({ ...SIGN_IN_PROBE, remoteAddress: '198.51.100.9' })).statusCode).toBe(400);
    await failSignIn(app, '198.51.100.9', 2);
    expect((await app.inject({ ...SIGN_IN_PROBE, remoteAddress: '198.51.100.9' })).json()).toMatchObject({ error: 'ip_blocked', retry_after: 3600 });
    tick(60 * 60_000 + 1_000);
    await failSignIn(app, '198.51.100.9', 2);
    expect((await app.inject({ ...SIGN_IN_PROBE, remoteAddress: '198.51.100.9' })).json()).toMatchObject({ error: 'ip_blocked', retry_after: 3600 });
    tick(60 * 60_000 + 24 * 3600_000 + 60_000);
    await failSignIn(app, '198.51.100.9', 2);
    expect((await app.inject({ ...SIGN_IN_PROBE, remoteAddress: '198.51.100.9' })).json()).toMatchObject({ error: 'ip_blocked', retry_after: 900 });
  });

  it('封禁表落库：重启服务后封禁仍然有效', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'yzgc-shield-'));
    dirs.push(dir);
    const now = { value: Date.now() };
    const env = { PUBLIC_ORIGIN: 'https://example.test', STATIC_CDN_ORIGIN: CDN_ORIGIN, SESSION_SECRET: 'isolated-core-test-secret-at-least-32', ENCRYPTION_KEY: Buffer.alloc(32, 1).toString('base64'), OAUTH_CLIENT_ID: 'test-client', OAUTH_CLIENT_SECRET: 'test-only-placeholder', POW_DIFFICULTY: '0', FORUM_DB_PATH: '/nonexistent/never-open-legacy-forum.db', DB_PATH: join(dir, 'data.db'), ...SHIELD_ENV };
    const open = async () => {
      const app = await buildApp({ config: testConfig(env), staticRoot: false, overrides: { clock: () => now.value, httpRequest: deny, octokitFactory: deny, mailFetch: deny } });
      await app.ready();
      return app;
    };
    let app = await open();
    await failSignIn(app, '198.51.100.30', 2);
    await app.close();
    app = await open();
    contexts.push({ app, close: () => app.close() });
    expect((await app.inject({ ...SIGN_IN_PROBE, remoteAddress: '198.51.100.30' })).json()).toMatchObject({ error: 'ip_blocked' });
  });

  it('按 TRUST_PROXY 取到的真实客户端 IP 计数：同一个代理后面的另一位用户不受影响', async () => {
    const { app } = await setup({ env: { TRUST_PROXY: '1' } });
    const via = (client: string) => ({ ...SIGN_IN_PROBE, remoteAddress: '10.0.0.2', headers: { 'x-forwarded-for': client } });
    for (let i = 0; i < 2; i++) await app.inject({ ...via('198.51.100.20'), payload: { email: `x${i}@example.test`, password: 'wrong-password-1' } });
    expect((await app.inject(via('198.51.100.20'))).json()).toMatchObject({ error: 'ip_blocked' });
    expect((await app.inject(via('198.51.100.21'))).statusCode).toBe(400);
  });

  it('SHIELD_ALLOWLIST 里的网段永远不封禁', async () => {
    const { app } = await setup({ env: { SHIELD_ALLOWLIST: '203.0.113.0/24' } });
    await failSignIn(app, '203.0.113.9', 6);
    expect((await app.inject({ ...SIGN_IN_PROBE, remoteAddress: '203.0.113.9' })).statusCode).toBe(400);
  });

  it('健康检查路由对被封禁的 IP 照常可达', async () => {
    const { app } = await setup();
    await failSignIn(app, '198.51.100.40', 2);
    expect((await app.inject({ url: '/healthz', remoteAddress: '198.51.100.40' })).statusCode).toBe(200);
  });

  it('限流计数落库：重启后同一窗口内的次数不清零', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'yzgc-ratelimit-'));
    dirs.push(dir);
    const now = { value: Date.now() };
    const env = { PUBLIC_ORIGIN: 'https://example.test', STATIC_CDN_ORIGIN: CDN_ORIGIN, SESSION_SECRET: 'isolated-core-test-secret-at-least-32', ENCRYPTION_KEY: Buffer.alloc(32, 1).toString('base64'), OAUTH_CLIENT_ID: 'test-client', OAUTH_CLIENT_SECRET: 'test-only-placeholder', POW_DIFFICULTY: '0', FORUM_DB_PATH: '/nonexistent/never-open-legacy-forum.db', DB_PATH: join(dir, 'data.db') };
    const open = async () => {
      const app = await buildApp({ config: testConfig(env), staticRoot: false, overrides: { clock: () => now.value, httpRequest: deny, octokitFactory: deny, mailFetch: deny } });
      await app.ready();
      return app;
    };
    const feedback = { method: 'POST' as const, url: '/api/feedback', remoteAddress: '198.51.100.50', payload: { org: 'nope', content: '随便写' } };
    let app = await open();
    for (let i = 0; i < 10; i++) expect((await app.inject(feedback)).statusCode).toBe(400);
    await app.close();
    app = await open();
    contexts.push({ app, close: () => app.close() });
    expect((await app.inject(feedback)).statusCode).toBe(429);
  });

  it('只有真的比对过的验证码失败才加登录失败分：猜错（含用完挑战的第 5 次）加分，过期、没有挑战或已用完只算普通的 400', async () => {
    const { app, mail, tick } = await setup({ env: { SHIELD_THRESHOLD: '100' } });
    const reasons = (ip: string) => (app.services.storage.db.prepare('SELECT reason FROM shield_signals WHERE ip = ? ORDER BY rowid').all(ip) as { reason: string }[]).map(row => row.reason);
    const begin = async (email: string, ip: string) => {
      const started = await app.inject({ method: 'POST', url: '/auth/email/start', remoteAddress: ip, payload: { email } });
      const cookie = ([] as string[]).concat(started.headers['set-cookie'] ?? []).map(raw => raw.split(';')[0]).find(pair => pair.startsWith('email_challenge='))!;
      return { cookie, code: await mail.codeFor(email) };
    };
    const verify = (ip: string, cookie: string | undefined, code: string) =>
      app.inject({ method: 'POST', url: '/auth/email/verify', remoteAddress: ip, headers: cookie ? { cookie } : {}, payload: { code } });

    const guess = await begin('guess@example.test', '198.51.100.120');
    const wrong = guess.code === '000000' ? '111111' : '000000';
    const errors: string[] = [];
    for (let i = 0; i < 5; i++) errors.push((await verify('198.51.100.120', guess.cookie, wrong)).json().error);
    expect(errors).toEqual(['invalid_code', 'invalid_code', 'invalid_code', 'invalid_code', 'code_expired']);
    // 挑战已经用完：再试没有比对，只算普通的 400
    expect((await verify('198.51.100.120', guess.cookie, wrong)).json().error).toBe('code_expired');
    const guessed = reasons('198.51.100.120');
    expect(guessed.filter(reason => reason === 'auth.code')).toHaveLength(5);
    expect(guessed.filter(reason => reason === 'client_error')).toHaveLength(6);

    const stale = await begin('stale@example.test', '198.51.100.121');
    tick(11 * 60_000);
    expect((await verify('198.51.100.121', stale.cookie, stale.code)).json().error).toBe('code_expired');
    expect((await verify('198.51.100.121', undefined, stale.code)).json().error).toBe('code_expired');
    expect(reasons('198.51.100.121')).toEqual(['client_error', 'client_error']);
  });
});

describe('全站北京日上限（#319、#333）', () => {
  it('发码超过全站日上限后回 429 site_quota_exceeded，换 IP 也不能再发', async () => {
    const { app } = await setup({ env: { SITE_QUOTA_EMAIL_DAILY: '2' } });
    const start = (email: string, ip: string) => app.inject({ method: 'POST', url: '/auth/email/start', remoteAddress: ip, payload: { email } });
    expect((await start('a1@example.test', '10.1.0.1')).statusCode).toBe(202);
    expect((await start('a2@example.test', '10.1.0.2')).statusCode).toBe(202);
    const refused = await start('a3@example.test', '10.1.0.3');
    expect(refused.statusCode).toBe(429);
    expect(refused.json()).toMatchObject({ error: 'site_quota_exceeded', bucket: 'site.email.daily' });
    expect(refused.json().message).toEqual(expect.any(String));
  });

  it('同一收件人每个北京日最多收到 EMAIL_RECIPIENT_QUOTA_DAILY 次，换 IP 无效（#319）', async () => {
    const { app, tick } = await setup({ env: { EMAIL_RECIPIENT_QUOTA_DAILY: '2' } });
    const start = (ip: string) => app.inject({ method: 'POST', url: '/auth/email/start', remoteAddress: ip, payload: { email: 'victim@example.test' } });
    expect((await start('10.2.0.1')).statusCode).toBe(202);
    tick(61_000);
    expect((await start('10.2.0.2')).statusCode).toBe(202);
    tick(61_000);
    const refused = await start('10.2.0.3');
    expect(refused.statusCode).toBe(429);
    expect(refused.json()).toMatchObject({ error: 'rate_limited', bucket: 'email.recipient.daily' });
  });

  it('意见箱超过全站日上限后回 429 site_quota_exceeded', async () => {
    const { app } = await setup({ env: { SITE_QUOTA_FEEDBACK_DAILY: '1' } });
    const submit = (content: string) => app.inject({
      method: 'POST', url: '/api/feedback', headers: { origin: 'https://example.test' },
      payload: { org: DEFAULT_CONSOLE_ORG, content, category: '建议', pow: { timestamp: Date.now(), nonce: 'x' } },
    });
    expect((await submit('第一条意见，内容足够长')).statusCode).toBe(200);
    const refused = await submit('第二条意见，内容足够长');
    expect(refused.statusCode).toBe(429);
    expect(refused.json()).toMatchObject({ error: 'site_quota_exceeded', bucket: 'site.feedback.daily' });
  });

  it('设备授权码超过全站日上限后回 429 site_quota_exceeded', async () => {
    const { app } = await setup({ env: { SITE_QUOTA_DEVICE_CODE_DAILY: '1' } });
    const code = (ip: string) => app.inject({ method: 'POST', url: '/auth/device/code', remoteAddress: ip, payload: { client_id: 'geek-cli' } });
    expect((await code('10.3.0.1')).statusCode).toBe(200);
    const refused = await code('10.3.0.2');
    expect(refused.statusCode).toBe(429);
    expect(refused.json()).toMatchObject({ error: 'site_quota_exceeded', bucket: 'site.device_code.daily' });
  });

  it('没有 visitor cookie 的注册按更严的每 IP 额度算：丢掉 cookie 不能绕过设备限额（#333）', async () => {
    const { app, mail } = await setup({ env: { REGISTER_NO_COOKIE_IP_DAILY: '1' } });
    const register = (email: string, ip: string, cookie?: string) => registerFlow(app, mail, { email, ip, visitor: cookie });
    expect((await register('n1@example.test', '10.4.0.1')).statusCode).toBe(200);
    const refused = await register('n2@example.test', '10.4.0.1');
    expect(refused.statusCode).toBe(429);
    expect(refused.json()).toMatchObject({ error: 'rate_limited', bucket: 'auth.register.daily' });
    expect((await register('n3@example.test', '10.4.0.1', '6f1b0c0e-6d2a-4b7e-9c1d-2f3a4b5c6d7e')).statusCode).toBe(200);
  });

  it('注册超过全站日上限后回 429 site_quota_exceeded', async () => {
    const { app, mail } = await setup({ env: { SITE_QUOTA_REGISTER_DAILY: '1' } });
    expect((await registerFlow(app, mail, { email: 's1@example.test', ip: '10.5.0.1', visitor: '6f1b0c0e-6d2a-4b7e-9c1d-2f3a4b5c6d70' })).statusCode).toBe(200);
    const refused = await registerFlow(app, mail, { email: 's2@example.test', ip: '10.5.0.2', visitor: '6f1b0c0e-6d2a-4b7e-9c1d-2f3a4b5c6d71' });
    expect(refused.statusCode).toBe(429);
    expect(refused.json()).toMatchObject({ error: 'site_quota_exceeded', bucket: 'site.register.daily' });
  });
});

describe('控制台封禁列表与解封（#333）', () => {
  it('持有 security.manage 的站长能看到封禁、解封（解封后级别归零并写审计），没有权限的 403', async () => {
    const { app } = await setup();
    const owner = signIn(app, 'shield-owner', 401);
    grantPermGroup(app, accountIdOf(app, 'shield-owner'), 'title.site.owner');
    const ownerCookie = `sid=${owner}`;
    const other = signIn(app, 'shield-visitor', 402);

    await failSignIn(app, '198.51.100.60', 2);
    const list = await app.inject({ url: '/api/console/security/blocks', headers: { cookie: ownerCookie } });
    expect(list.statusCode).toBe(200);
    expect(list.json().blocks).toEqual([expect.objectContaining({ ip: '198.51.100.60', level: 1 })]);
    expect((await app.inject({ url: '/api/console/security/blocks', headers: { cookie: `sid=${other}` } })).statusCode).toBe(403);
    expect((await app.inject({ method: 'DELETE', url: '/api/console/security/blocks/198.51.100.60', headers: { cookie: `sid=${other}` } })).statusCode).toBe(403);

    const cleared = await app.inject({ method: 'DELETE', url: '/api/console/security/blocks/198.51.100.60', headers: { cookie: ownerCookie } });
    expect(cleared.statusCode).toBe(200);
    expect((await app.inject({ ...SIGN_IN_PROBE, remoteAddress: '198.51.100.60' })).statusCode).toBe(400);
    expect((await app.inject({ url: '/api/console/security/blocks', headers: { cookie: ownerCookie } })).json().blocks).toEqual([]);

    await failSignIn(app, '198.51.100.60', 2);
    expect((await app.inject({ ...SIGN_IN_PROBE, remoteAddress: '198.51.100.60' })).json()).toMatchObject({ error: 'ip_blocked', retry_after: 900 });

    const actions = (app.services.storage.db.prepare("SELECT action FROM activity_events WHERE action LIKE 'security.%' ORDER BY id").all() as { action: string }[]).map(row => row.action);
    expect(actions).toContain('security.block');
    expect(actions).toContain('security.block.clear');
    expect(actions).toContain('security.blocks.view');
  });

  it('解封审计失败时保持封禁，恢复审计后才能原子解封', async () => {
    const { app } = await setup();
    const owner = signIn(app, 'shield-atomic', 406);
    grantPermGroup(app, accountIdOf(app, 'shield-atomic'), 'title.site.owner');
    const ip = '198.51.100.61';
    app.services.shield.trap(ip, 'honeypot');
    const db = app.services.storage.db;
    db.exec("CREATE TRIGGER reject_clear_audit BEFORE INSERT ON activity_events WHEN NEW.action = 'security.block.clear' BEGIN SELECT RAISE(FAIL, 'synthetic audit failure'); END");
    const clear = () => app.inject({ method: 'DELETE', url: `/api/console/security/blocks/${ip}`, headers: { cookie: `sid=${owner}` } });
    expect((await clear()).statusCode).toBe(500);
    expect((await app.inject({ url: '/auth/providers', remoteAddress: ip })).json()).toMatchObject({ error: 'ip_blocked' });
    db.exec('DROP TRIGGER reject_clear_audit');
    expect((await clear()).statusCode).toBe(200);
    expect((await app.inject({ url: '/auth/providers', remoteAddress: ip })).statusCode).toBe(200);
    expect(db.prepare("SELECT count(*) AS count FROM activity_events WHERE action = 'security.block.clear'").get()).toEqual({ count: 1 });
  });

  it('DELETE 没有这个 IP 的封禁时回 404', async () => {
    const { app } = await setup();
    const owner = signIn(app, 'shield-owner-2', 403);
    grantPermGroup(app, accountIdOf(app, 'shield-owner-2'), 'title.site.owner');
    const res = await app.inject({ method: 'DELETE', url: '/api/console/security/blocks/198.51.100.99', headers: { cookie: `sid=${owner}` } });
    expect(res.statusCode).toBe(404);
  });

  it('被拒的请求按方法、路由模板与状态码分开记，路径里的地址与编号不进记录（#333）', async () => {
    const { app } = await setup();
    const headers = { cookie: `sid=${signIn(app, 'shield-audit', 405)}` };
    expect((await app.inject({ url: '/api/console/security/blocks', headers })).statusCode).toBe(403);
    expect((await app.inject({ method: 'DELETE', url: '/api/console/security/blocks/198.51.100.77', headers })).statusCode).toBe(403);
    expect((await app.inject({ method: 'DELETE', url: '/api/console/security/blocks/198.51.100.78', headers })).statusCode).toBe(403);
    const rows = app.services.storage.db.prepare("SELECT target_type, target_id, meta FROM activity_events WHERE outcome = 'denied' AND action = 'security.manage' ORDER BY id").all() as { target_type: string | null; target_id: string | null; meta: string }[];
    expect(rows.map(row => JSON.parse(row.meta))).toEqual([
      { method: 'GET', route: '/api/console/security/blocks', status: 403, count: 1 },
      { method: 'DELETE', route: '/api/console/security/blocks/:ip', status: 403, count: 2 },
    ]);
    expect(JSON.stringify(rows)).not.toContain('198.51.100.77');
    expect(JSON.stringify(rows)).not.toContain('198.51.100.78');
  });
});

describe('邀请码最短长度（#319）', () => {
  it('新建邀请码至少 8 位；历史上的 4 位码照样能兑换', async () => {
    const { app } = await setup();
    const owner = signIn(app, 'shield-invites', 404);
    grantPermGroup(app, accountIdOf(app, 'shield-invites'), 'title.site.owner');
    const create = (code: string) => app.inject({ method: 'POST', url: '/api/console/invites', headers: { cookie: `sid=${owner}` }, payload: { code } });
    expect((await create('abcd')).statusCode).toBe(400);
    expect((await create('abcdefg')).statusCode).toBe(400);
    expect((await create('abcdefgh')).statusCode).toBe(201);

    const db = app.services.storage.db;
    const now = Date.now();
    db.prepare("INSERT INTO invite_codes(code, note, max_uses, expires_at, disabled, created_by, created_at, updated_at) VALUES ('oldd', '', NULL, NULL, 0, 'test', ?, ?)").run(now, now);
    expect(redeemInvite(db, 'oldd', now)).toMatchObject({ ok: true });
  });
});

/**
 * 邮箱验证码注册：发码（拿到挑战 cookie）→ 从假的发信商取出验证码 → 核对登录。`visitor` 是这个人已有的 yugc_vid，不传就是没有 cookie。
 */
async function registerFlow(app: FastifyInstance, mail: ReturnType<typeof mailbox>, input: { email: string; ip: string; visitor?: string }) {
  const sentBefore = mail.letters.filter(letter => letter.to === input.email).length;
  const started = await app.inject({ method: 'POST', url: '/auth/email/start', remoteAddress: input.ip, payload: { email: input.email } });
  const challenge = ([] as string[]).concat(started.headers['set-cookie'] ?? []).map(raw => raw.split(';')[0]).find(pair => pair.startsWith('email_challenge='))!;
  if (started.statusCode !== 202) return started;
  const code = await mail.codeFor(input.email, sentBefore + 1);
  const cookies = [challenge, ...(input.visitor ? [`yugc_vid=${input.visitor}`] : [])].join('; ');
  return app.inject({ method: 'POST', url: '/auth/email/verify', remoteAddress: input.ip, headers: { cookie: cookies, origin: 'https://example.test' }, payload: { code, real_name: '测试同学', grade: 2 } });
}

const deny = (() => { throw new Error('Unexpected external network request in isolated core test'); }) as unknown as ServiceOverrides['httpRequest'];

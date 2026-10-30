import { generateKeyPairSync, createSign, type JsonWebKey } from 'node:crypto';
import { afterEach, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import type { ServiceOverrides } from '../../app/server/src/services';
import { GOOGLE_JWKS_URL, GOOGLE_TOKEN_URL } from '../../app/server/src/lib/google';
import { accountIdOf, activityRows, completeProfile, grantPermGroup, signIn, testApp } from './helpers';
import { requestLogFields } from '../../app/server/src/app';
import { PERMISSION_NODES } from '../../app/server/src/lib/permission-nodes';
import { createLoginThrottle } from '../../app/server/src/lib/password-policy';

/**
 * 邮箱验证码与密码、Google、邀请码注册、控制台按站内称号授权（#262，所有者 2026-10-23 的决定，
 * docs/decisions/0005-sso-extend-core-server.md「2026-10-23 修订」）。发信商、Google 与 GitHub 一律是假的。
 */
const contexts: Awaited<ReturnType<typeof testApp>>[] = [];
afterEach(async () => { for (const c of contexts.splice(0)) await c.close(); });

const MAIL_ENV = { MAIL_RESEND_API_KEY: 're_test_resend_key_value', MAIL_RESEND_FROM: 'notify@example.test', MAIL_RECIPIENTS: 'all' };
const GOOGLE_ENV = { GOOGLE_CLIENT_ID: 'google-test-client', GOOGLE_CLIENT_SECRET: 'google-test-secret' };
/** 邮箱注册必填的姓名和年级（#280）；登录到已有账号时服务端不看这两项，所以每次核对验证码都带上 */
const REAL = { real_name: '测试同学', grade: 2 };

/** 假的发信商：记下每封信的收件人和正文，验证码从正文里取。 */
function mailbox() {
  const letters: { to: string; subject: string; text: string }[] = [];
  const fetch = (async (_url: string, init: { body: string }) => {
    const body = JSON.parse(init.body) as { to: string[]; subject: string; text: string };
    letters.push({ to: body.to[0], subject: body.subject, text: body.text });
    return new Response(JSON.stringify({ id: `mail-${letters.length}` }), { status: 200, headers: { 'Content-Type': 'application/json' } });
  }) as unknown as ServiceOverrides['mailFetch'];
  /** 发信不阻塞响应：等到这个地址收到第 n 封信 */
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

/** 假的 GitHub：组织角色按登录名查表；记下每次调用，用来证明邮箱会话没碰 GitHub。 */
function github(roles: Record<string, 'admin' | 'member' | null>, calls: string[]) {
  return ((token: string) => ({
    request: async (route: string, params: { username?: string }) => {
      calls.push(`${route} ${token}`);
      if (route === 'GET /orgs/{org}/memberships/{username}') {
        const role = roles[params.username!.toLowerCase()];
        if (!role) throw Object.assign(new Error('Not Found'), { status: 404 });
        return { data: { state: 'active', role } };
      }
      return { data: [] };
    },
    paginate: async () => [],
  })) as unknown as ServiceOverrides['octokitFactory'];
}

/** 假的 Google：token 端点回一个用测试私钥签的 ID Token，JWKS 端点回对应的公钥。 */
function googleStub() {
  const { privateKey, publicKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
  const jwk = { ...(publicKey.export({ format: 'jwk' }) as JsonWebKey), kid: 'test-kid', alg: 'RS256', use: 'sig' };
  const claims: Record<string, unknown> = { sub: 'google-sub-1', email: 'g.user@example.test', email_verified: true };
  const tokenRequests: string[] = [];
  let nonce = '';
  const sign = (payload: Record<string, unknown>) => {
    const part = (value: object) => Buffer.from(JSON.stringify(value)).toString('base64url');
    const head = `${part({ alg: 'RS256', kid: 'test-kid', typ: 'JWT' })}.${part(payload)}`;
    return `${head}.${createSign('RSA-SHA256').update(head).sign(privateKey).toString('base64url')}`;
  };
  const httpRequest = (async (url: string, options: { body?: string } = {}) => {
    if (url === GOOGLE_JWKS_URL) return { statusCode: 200, headers: { 'cache-control': 'public, max-age=3600' }, body: { json: async () => ({ keys: [jwk] }) } };
    if (url === GOOGLE_TOKEN_URL) {
      tokenRequests.push(options.body ?? '');
      const now = Math.floor(Date.now() / 1000);
      const idToken = sign({ iss: 'https://accounts.google.com', aud: 'google-test-client', iat: now, exp: now + 600, nonce, ...claims });
      return { statusCode: 200, headers: {}, body: { json: async () => ({ id_token: idToken, access_token: 'unused' }) } };
    }
    throw new Error(`unexpected request ${url}`);
  }) as unknown as ServiceOverrides['httpRequest'];
  return { claims, tokenRequests, httpRequest, setNonce: (value: string) => { nonce = value; } };
}

async function setup(options: { env?: Record<string, string>; roles?: Record<string, 'admin' | 'member' | null>; google?: ReturnType<typeof googleStub> } = {}) {
  const mail = mailbox();
  const calls: string[] = [];
  // 同一个邮箱 60 秒内只能获取一次验证码：用例里要再取一次时把时钟往前拨（tick）
  let now = Date.now();
  const tick = (ms: number) => { now += ms; };
  const context = await testApp({
    clock: () => now,
    mailFetch: mail.fetch, octokitFactory: github(options.roles ?? {}, calls),
    ...(options.google ? { httpRequest: options.google.httpRequest } : {}),
  }, false, { ...MAIL_ENV, ...(options.env ?? {}) });
  contexts.push(context);
  const { app } = context;
  const db = app.services.storage.db;
  const invite = (code: string, extra: { max_uses?: number | null; disabled?: boolean } = {}) => {
    const created = app.services.invites.create({ code, max_uses: extra.max_uses ?? null }, 'test');
    if (extra.disabled) app.services.invites.update(created.id, { disabled: true });
    return created;
  };
  return { app, db, mail, calls, invite, tick };
}

/**
 * 带 cookie 的请求：把响应里的 Set-Cookie 合进一个小罐子，后面的请求自动带上。`remoteAddress` 给注册限额
 * 的测试模拟「同一个人换 IP」或「同一个 IP 换设备」，不传就用 Fastify 的默认值（和原来一样）。
 */
function browser(app: FastifyInstance, remoteAddress?: string) {
  const jar = new Map<string, string>();
  async function send(method: 'GET' | 'POST' | 'PATCH', url: string, payload?: unknown) {
    const response = await app.inject({
      method, url, payload: payload as object | undefined, remoteAddress,
      headers: { cookie: [...jar].map(([k, v]) => `${k}=${v}`).join('; '), ...(method === 'GET' ? {} : { origin: 'https://example.test' }) },
    });
    for (const raw of ([] as string[]).concat((response.headers['set-cookie'] as string[] | string | undefined) ?? [])) {
      const [pair, ...attrs] = raw.split(';');
      const [name, ...rest] = pair.split('=');
      const value = rest.join('=');
      if (!value || attrs.some(a => /max-age=0|expires=thu, 01 jan 1970/i.test(a))) jar.delete(name.trim());
      else jar.set(name.trim(), value);
    }
    return response;
  }
  return { send, jar };
}

describe('GET /auth/providers lists what this site has enabled (#262)', () => {
  it('shows GitHub alone without a mail provider, email with one, and Google only with both credentials', async () => {
    const bare = await testApp(); contexts.push(bare);
    expect((await bare.app.inject('/auth/providers')).json().providers.map((p: { id: string }) => p.id)).toEqual(['github']);
    const { app } = await setup({ env: GOOGLE_ENV });
    const providers = (await app.inject('/auth/providers')).json().providers;
    expect(providers.map((p: { id: string }) => p.id)).toEqual(['github', 'google', 'email']);
    expect(providers.find((p: { id: string }) => p.id === 'email')).toEqual({ id: 'email', name: '邮箱', kind: 'email_code', start: '/auth/email/start', can_register: true, password: '/auth/email/password' });
  });
});

describe('email code sign-in and invite-code registration (#262)', () => {
  it('asks a new address for a name and grade before registering, keeping the code and invite for the retry, and sends an existing account without them to the profile page (#280)', async () => {
    const { app, db, mail, invite, tick } = await setup();
    invite('yugc-test-2026', { max_uses: 1 });
    const user = browser(app);
    await user.send('POST', '/auth/email/start', { email: 'fresh@example.test', return_to: '/forum/' });
    const code = await mail.codeFor('fresh@example.test');
    const missing = await user.send('POST', '/auth/email/verify', { code, invite_code: 'yugc-test-2026' });
    expect([missing.statusCode, missing.json().error]).toEqual([400, 'real_info_required']);
    const badName = await user.send('POST', '/auth/email/verify', { code, invite_code: 'yugc-test-2026', real_name: '1', grade: 1 });
    expect([badName.statusCode, badName.json().error]).toEqual([400, 'bad_real_name']);
    // 年级只能是大一到大四或已毕业，合同直接挡下
    expect((await user.send('POST', '/auth/email/verify', { code, real_name: '王小明', grade: 5 })).statusCode).toBe(400);
    expect(db.prepare('SELECT COUNT(*) AS n FROM users').get()).toEqual({ n: 0 });

    const ok = await user.send('POST', '/auth/email/verify', { code, invite_code: 'yugc-test-2026', real_name: ' 王  小明 ', grade: 1 });
    expect(ok.json()).toEqual({ return_to: 'https://example.test/forum/', registered: true });
    const me = (await user.send('GET', '/auth/me')).json();
    expect(me).toMatchObject({ level: 'member', real_name: '王 小明', grade: 1, grade_label: '大一', profile_required: false });

    // 老账号缺姓名和年级：登录照常，return_to 先指向补资料页；登录到已有账号不要求带这两项
    app.services.profiles.setRealInfo(me.account_id, null, null);
    tick(61_000);
    const again = browser(app);
    await again.send('POST', '/auth/email/start', { email: 'fresh@example.test', return_to: '/forum/' });
    const signedIn = await again.send('POST', '/auth/email/verify', { code: await mail.codeFor('fresh@example.test', 2) });
    expect(signedIn.json()).toEqual({ return_to: 'https://example.test/complete-profile?return_to=%2Fforum%2F', registered: false });
  });

  it('registers a plain registered user without an invite, never wasting the code on an invalid one (#274: invite code is optional)', async () => {
    const { app, db, mail, invite } = await setup();
    invite('yugc-test-2026');
    const user = browser(app);
    const start = await user.send('POST', '/auth/email/start', { email: '  New.Member@Example.TEST ', return_to: '/forum/' });
    expect(start.statusCode).toBe(202);
    expect(start.json()).toEqual({ resend_after: 60 });
    const code = await mail.codeFor('new.member@example.test');
    expect(mail.letters[0].subject).toBe('你的极客班登录验证码');
    expect(mail.letters[0].text).not.toMatch(/https?:\/\/\S*(signin|auth)/);

    // 邀请码不对：拒绝、不建号、不白丢验证码（还能再试）
    const wrong = await user.send('POST', '/auth/email/verify', { ...REAL, code, invite_code: 'not-a-real-code' });
    expect(wrong.json()).toMatchObject({ error: 'invite_invalid', attempts_left: 4 });
    expect(db.prepare('SELECT COUNT(*) AS n FROM users').get()).toEqual({ n: 0 });

    // 不填邀请码：注册成注册用户，不是错误（SPEC §3.2）；姓名和年级只有极客班的人要填（#280），这里不用带
    const ok = await user.send('POST', '/auth/email/verify', { code });
    expect(ok.statusCode).toBe(200);
    expect(ok.json()).toEqual({ return_to: 'https://example.test/forum/', registered: true });
    const me = (await user.send('GET', '/auth/me')).json();
    expect(me).toMatchObject({ signed_in: true, provider: 'email', user_id: null, console_link: false, level: 'registered', profile_required: false, real_name: null });
    expect(me.login).toMatch(/^yz_[0-9a-hjkmnp-tv-z]{8}$/);
    const account = db.prepare('SELECT org_state, org_role, invite_code_id, canonical_email, handle FROM users').get() as Record<string, unknown>;
    // #274 review round 1（blocker）：没填邀请码的 org_state 记 not_member，不再统一写 active——
    // 没有站内角色、没有邀请码记录，只是普通注册用户。
    expect(account).toMatchObject({ org_state: 'not_member', org_role: null, invite_code_id: null, canonical_email: 'new.member@example.test', handle: me.login });
    expect(db.prepare('SELECT used_count FROM invite_codes').get()).toEqual({ used_count: 0 });
    // #274 item I：以前 identity-store.ts 内部不管注没注册都会再写一条 auth.signin，和路由这边按
    // result.registered 选一个记的 recordActivity 重复；删掉内部那条重复调用后，一次注册只有一条 auth.register。
    // 前面那次邀请码错误（行 151）是路由自己记的 auth.signin_failed（review round 1 加的），真实事件，不是重复。
    expect(activityRows(app, { actionLike: 'auth.%' }).map(row => row.action)).toEqual(['auth.signin_failed', 'auth.register']);

    // 同一个验证码不能再用
    const again = browser(app);
    for (const [k, v] of user.jar) if (k === 'email_challenge') again.jar.set(k, v);
    expect((await again.send('POST', '/auth/email/verify', { ...REAL, code })).json().error).toBe('code_expired');
  });

  it('lets a plain registered email account (no invite, no GitHub id) be recognized as a real forum member, not a guest — but it still cannot post without forum.topic.create (#274 SPEC §3.2/§3.6)', async () => {
    const { app, mail } = await setup();
    const user = browser(app);
    await user.send('POST', '/auth/email/start', { email: 'no.invite.member@example.test' });
    await user.send('POST', '/auth/email/verify', { ...REAL, code: await mail.codeFor('no.invite.member@example.test') });
    const me = (await user.send('GET', '/auth/me')).json();
    expect(me).toMatchObject({ signed_in: true, provider: 'email', user_id: null, level: 'registered' });
    const profile = await user.send('GET', '/api/identity/profile');
    expect(profile.statusCode).toBe(200);
    expect(profile.json().username).toMatch(/^[a-z0-9_]{3,24}$/);

    // 之前的 bug：论坛只按 session.user_id（GitHub 数字 id）认人，没有它就按游客处理；
    // 修复后按账号（account_id）认人，邮箱注册也是真实成员（viewer.kind），不用游客昵称和 PoW——
    // 但「论坛认不认识你」和「有没有权限写」是两回事：没用邀请码的注册用户没有 forum.topic.create，
    // 发帖仍然 403（SPEC §3.2），这条只测前者，权限矩阵见 forum.test.ts。
    const state = (await user.send('GET', '/api/forum/state')).json().state;
    expect(state.viewer.kind).toBe('member');
    expect(state.viewer.userId).toMatch(/^a\d+$/);
    const forumUser = state.users.find((u: { id: string }) => u.id === state.viewer.userId);
    expect(forumUser).toMatchObject({ username: profile.json().username, kind: 'member' });

    const posted = await user.send('POST', '/api/forum/topics', { title: '邮箱注册也能发帖', categoryId: 'c-ai', content: '不用游客昵称和验证码' });
    expect(posted.statusCode).toBe(403);
    expect(posted.json().error).toBe('forbidden');

    // 论坛用户行落了账号、没有 GitHub id（GET /state 已经建过这一行，不需要真的发成帖才有）；
    // 同一账号再来续用同一行，不会另建一个空号。
    const row = app.services.storage.db.prepare('SELECT account_id, github_user_id FROM forum_users WHERE id = ?').get(state.viewer.userId);
    expect(row).toEqual({ account_id: me.account_id, github_user_id: null });
    const again = (await user.send('GET', '/api/forum/state')).json().state;
    expect(again.viewer.userId).toBe(state.viewer.userId);
  });

  it('registers a member with a valid invite code, consuming it exactly once', async () => {
    const { app, db, mail, invite } = await setup();
    invite('yugc-test-2026');
    const user = browser(app);
    await user.send('POST', '/auth/email/start', { email: 'future.member@example.test', return_to: '/forum/' });
    const code = await mail.codeFor('future.member@example.test');
    const ok = await user.send('POST', '/auth/email/verify', { ...REAL, code, invite_code: ' YUGC-test-2026 ' });
    expect(ok.statusCode).toBe(200);
    expect(ok.json()).toEqual({ return_to: 'https://example.test/forum/', registered: true });
    const me = (await user.send('GET', '/auth/me')).json();
    expect(me).toMatchObject({ signed_in: true, provider: 'email', level: 'member' });
    const account = db.prepare('SELECT org_state, org_role, canonical_email FROM users').get() as Record<string, unknown>;
    // 邀请码注册的是成员，站内角色记成 member（舰员，#262 第四期）
    expect(account).toMatchObject({ org_state: 'active', org_role: 'member', canonical_email: 'future.member@example.test' });
    expect(db.prepare('SELECT used_count FROM invite_codes').get()).toEqual({ used_count: 1 });
  });

  it('signs an existing account in without an invite and answers start the same for unknown addresses', async () => {
    const { app, mail, invite, tick } = await setup();
    invite('yugc-test-2026');
    const first = browser(app);
    await first.send('POST', '/auth/email/start', { email: 'member@example.test' });
    await first.send('POST', '/auth/email/verify', { ...REAL, code: await mail.codeFor('member@example.test'), invite_code: 'yugc-test-2026' });
    const accountId = (await first.send('GET', '/auth/me')).json().account_id;
    tick(61_000);

    const later = browser(app);
    const known = await later.send('POST', '/auth/email/start', { email: 'member@example.test' });
    const stranger = await browser(app).send('POST', '/auth/email/start', { email: 'nobody@example.test' });
    expect([known.statusCode, known.json()]).toEqual([stranger.statusCode, stranger.json()]);
    await new Promise(resolve => setTimeout(resolve, 0));
    // 60 秒内同一个邮箱不再发；登录页按 retry_after 倒计时
    const again = await later.send('POST', '/auth/email/start', { email: 'member@example.test' });
    expect(again.statusCode).toBe(429);
    expect(again.json()).toMatchObject({ error: 'rate_limited', retry_after: 60 });
    expect(again.headers['retry-after']).toBe('60');
    const ok = await later.send('POST', '/auth/email/verify', { ...REAL, code: await mail.codeFor('member@example.test', 2) });
    expect(ok.json()).toMatchObject({ registered: false });
    expect((await later.send('GET', '/auth/me')).json().account_id).toBe(accountId);
  });

  it('expires a challenge after five wrong codes and rejects malformed addresses', async () => {
    const { app, db } = await setup();
    const user = browser(app);
    expect((await user.send('POST', '/auth/email/start', { email: 'no-at-sign' })).json().error).toBe('bad_email');
    await user.send('POST', '/auth/email/start', { email: 'guess@example.test' });
    const answers = [];
    for (let i = 0; i < 5; i++) answers.push((await user.send('POST', '/auth/email/verify', { ...REAL, code: '000000' })).json());
    expect(answers.map(a => a.error)).toEqual(['invalid_code', 'invalid_code', 'invalid_code', 'invalid_code', 'code_expired']);
    expect(answers[0].attempts_left).toBe(4);
    // 五次验证码都算一次 auth.signin_failed（#274 review round 1，SPEC §3.7），不记邮箱和验证码本身。
    const failed = db.prepare('SELECT outcome, meta FROM activity_events WHERE action = ?').all('auth.signin_failed') as { outcome: string; meta: string }[];
    expect(failed).toEqual([
      { outcome: 'denied', meta: JSON.stringify({ provider: 'email', method: 'code', reason: 'invalid_code' }) },
      { outcome: 'denied', meta: JSON.stringify({ provider: 'email', method: 'code', reason: 'invalid_code' }) },
      { outcome: 'denied', meta: JSON.stringify({ provider: 'email', method: 'code', reason: 'invalid_code' }) },
      { outcome: 'denied', meta: JSON.stringify({ provider: 'email', method: 'code', reason: 'invalid_code' }) },
      { outcome: 'denied', meta: JSON.stringify({ provider: 'email', method: 'code', reason: 'code_expired' }) },
    ]);
  });

  it('refuses a disabled or used-up invite code', async () => {
    const { app, mail, invite } = await setup();
    invite('closed-code', { disabled: true });
    invite('one-shot', { max_uses: 1 });
    const a = browser(app);
    await a.send('POST', '/auth/email/start', { email: 'a@example.test' });
    const codeA = await mail.codeFor('a@example.test');
    expect((await a.send('POST', '/auth/email/verify', { ...REAL, code: codeA, invite_code: 'closed-code' })).json().error).toBe('invite_invalid');
    expect((await a.send('POST', '/auth/email/verify', { ...REAL, code: codeA, invite_code: 'one-shot' })).statusCode).toBe(200);
    const b = browser(app);
    await b.send('POST', '/auth/email/start', { email: 'b@example.test' });
    expect((await b.send('POST', '/auth/email/verify', { ...REAL, code: await mail.codeFor('b@example.test'), invite_code: 'one-shot' })).json().error).toBe('invite_invalid');
  });
});

/**
 * 注册限额（#274 残留修复，SPEC §3.8）：同一 IP 每天最多新建 5 个账号、同一设备（yugc_vid）每天最多 3 个，
 * 只在真的要新建账号那一刻计数——登录到已有账号不占额度。用邮箱验证码这条链路测（lib/register-limits.ts
 * 是三种注册方式共用的，GitHub、Google 走同一个 hitAll，这里不重复测三遍）。
 */
describe('registration limits: 5/IP/day, 3/device/day, only when a new account is created (#274 SPEC §3.8)', () => {
  const FIXED_VID = '11111111-1111-4111-8111-111111111111';
  const deviceOf = (n: number) => `${FIXED_VID.slice(0, -1)}${n}`;

  it('limits new accounts to 5 a day from the same IP, even across different devices', async () => {
    const { app, mail } = await setup();
    const register = async (email: string, vid: string) => {
      const b = browser(app, '198.51.100.9');
      b.jar.set('yugc_vid', vid);
      await b.send('POST', '/auth/email/start', { email });
      return b.send('POST', '/auth/email/verify', { ...REAL, code: await mail.codeFor(email) });
    };
    for (let i = 0; i < 5; i++) {
      const response = await register(`ip-bucket-${i}@example.test`, deviceOf(i));
      expect(response.statusCode).toBe(200);
      expect(response.json().registered).toBe(true);
    }
    const sixth = await register('ip-bucket-5@example.test', deviceOf(5));
    expect(sixth.statusCode).toBe(429);
    expect(sixth.json()).toMatchObject({ error: 'rate_limited', bucket: 'auth.register.daily' });
    expect(typeof sixth.json().retry_after).toBe('number');
    expect(sixth.json().retry_after).toBeGreaterThan(0);
  });

  it('limits new accounts to 3 a day from the same device, even across different IPs', async () => {
    const { app, mail } = await setup();
    const register = async (email: string, ip: string) => {
      const b = browser(app, ip);
      b.jar.set('yugc_vid', FIXED_VID);
      await b.send('POST', '/auth/email/start', { email });
      return b.send('POST', '/auth/email/verify', { ...REAL, code: await mail.codeFor(email) });
    };
    for (let i = 0; i < 3; i++) {
      const response = await register(`device-bucket-${i}@example.test`, `203.0.113.${i + 1}`);
      expect(response.statusCode).toBe(200);
      expect(response.json().registered).toBe(true);
    }
    const fourth = await register('device-bucket-3@example.test', '203.0.113.200');
    expect(fourth.statusCode).toBe(429);
    expect(fourth.json()).toMatchObject({ error: 'rate_limited', bucket: 'auth.register.daily' });
  });

  it('never counts logging into an existing account, even after the daily registration limit is hit on the same IP and device', async () => {
    const { app, mail, tick } = await setup();
    const ip = '198.51.100.50';
    const vid = FIXED_VID;
    const freshBrowser = () => { const b = browser(app, ip); b.jar.set('yugc_vid', vid); return b; };
    // 固定同一个 IP、同一台设备连续注册：设备那条线（3/天）比 IP 那条线（5/天）先到上限，用满 3 个就够了。
    for (let i = 0; i < 3; i++) {
      const b = freshBrowser();
      const email = `fill-${i}@example.test`;
      await b.send('POST', '/auth/email/start', { email });
      expect((await b.send('POST', '/auth/email/verify', { ...REAL, code: await mail.codeFor(email) })).statusCode).toBe(200);
    }
    // 新账号确实到了上限：第 6 个真的要注册的邮箱被拒。
    const blocked = freshBrowser();
    await blocked.send('POST', '/auth/email/start', { email: 'blocked@example.test' });
    const blockedResult = await blocked.send('POST', '/auth/email/verify', { ...REAL, code: await mail.codeFor('blocked@example.test') });
    expect(blockedResult.statusCode).toBe(429);
    // 登录回上面已经注册过的账号（fill-0），同一个 IP、同一台设备，不受影响——这不是「新建账号」，不占额度。
    tick(61_000); // 同一个邮箱 60 秒内只能再要一次验证码，跳过这个冷却期
    const back = freshBrowser();
    await back.send('POST', '/auth/email/start', { email: 'fill-0@example.test' });
    const signedIn = await back.send('POST', '/auth/email/verify', { ...REAL, code: await mail.codeFor('fill-0@example.test', 2) });
    expect(signedIn.statusCode).toBe(200);
    expect(signedIn.json().registered).toBe(false);
  });
});

describe('email password sign-in (#262)', () => {
  it('sets a password only on a fresh session with a bound email, then signs in with it', async () => {
    const { app, db, mail, invite } = await setup();
    invite('yugc-test-2026');
    const user = browser(app);
    await user.send('POST', '/auth/email/start', { email: 'pw@example.test' });
    await user.send('POST', '/auth/email/verify', { ...REAL, code: await mail.codeFor('pw@example.test'), invite_code: 'yugc-test-2026' });

    expect((await user.send('POST', '/api/identity/password', { password: 'short' })).json().error).toBe('password_too_short');
    expect((await user.send('POST', '/api/identity/password', { password: 'abcd123' })).json()).toMatchObject({ error: 'password_too_short', message: '密码至少 8 位' });
    // 8 位以上就行，不要求大小写、数字或符号
    expect((await user.send('POST', '/api/identity/password', { password: 'abcd1234' })).json()).toEqual({ ok: true });
    const view = (await user.send('GET', '/api/identity/me')).json();
    expect(view).toMatchObject({ has_password: true, identities: [{ provider: 'email', label: 'p***@example.test' }] });
    // 响应合同不删字段：账号页用到的每一项都在
    expect(Object.keys(view).sort()).toEqual(['account_id', 'available', 'created_at', 'email_required', 'grade', 'grade_label', 'has_password', 'identities', 'login', 'membership', 'password_updated_at', 'profile_required', 'real_name', 'recent', 'session']);
    expect(view.membership).toEqual({ state: 'active', org_role: 'member', via_invite: true });
    expect(view.session).toEqual(expect.objectContaining({ provider: 'email', step_up_until: view.session.created_at + 10 * 60 * 1000 }));
    expect(view.recent[0]).toEqual({ at: expect.any(Number), action: 'password_set', provider: 'email', result: 'ok' });

    const wrong = await browser(app).send('POST', '/auth/email/password', { email: 'pw@example.test', password: 'not the passphrase!!' });
    expect(wrong.json()).toEqual(expect.objectContaining({ error: 'invalid_credentials' }));
    const unknown = await browser(app).send('POST', '/auth/email/password', { email: 'ghost@example.test', password: 'abcd1234' });
    expect(unknown.json().error).toBe('invalid_credentials');
    // 两次密码登录失败都记 auth.signin_failed，不带邮箱（#274 review round 1，SPEC §3.7）。
    const failed = db.prepare('SELECT outcome, meta FROM activity_events WHERE action = ?').all('auth.signin_failed') as { outcome: string; meta: string }[];
    expect(failed).toEqual([
      { outcome: 'denied', meta: JSON.stringify({ provider: 'email', method: 'password', reason: 'invalid_credentials' }) },
      { outcome: 'denied', meta: JSON.stringify({ provider: 'email', method: 'password', reason: 'invalid_credentials' }) },
    ]);
    expect(failed.some(row => row.meta.includes('example.test'))).toBe(false);
    const other = browser(app);
    const ok = await other.send('POST', '/auth/email/password', { email: 'PW@example.test', password: 'abcd1234', return_to: '/console' });
    expect(ok.json()).toEqual({ return_to: 'https://example.test/console' });
    expect((await other.send('GET', '/auth/me')).json()).toMatchObject({ signed_in: true, provider: 'email' });
  });

  it('asks a stale session to sign in again or give the current password', async () => {
    const { app, db, mail, invite } = await setup();
    invite('yugc-test-2026');
    const user = browser(app);
    await user.send('POST', '/auth/email/start', { email: 'old@example.test' });
    await user.send('POST', '/auth/email/verify', { ...REAL, code: await mail.codeFor('old@example.test'), invite_code: 'yugc-test-2026' });
    const activity = (action: string) => db.prepare('SELECT outcome, meta FROM activity_events WHERE action = ? ORDER BY id').all(action) as { outcome: string; meta: string }[];
    await user.send('POST', '/api/identity/password', { password: 'first passphrase is long' });
    // 第一次设密码记 auth.password_set，meta 不带密码本身（#274 review round 1，SPEC §3.7）。
    expect(activity('auth.password_set')).toEqual([{ outcome: 'ok', meta: '{}' }]);
    db.prepare('UPDATE sessions SET created_at = created_at - 11 * 60 * 1000').run();
    expect((await user.send('POST', '/api/identity/password', { password: 'second passphrase is long' })).json()).toMatchObject({ error: 'step_up_required', reauth: { return_to: '/account' } });
    expect((await user.send('POST', '/api/identity/password', { password: 'second passphrase is long', current_password: 'nope' })).json().error).toBe('invalid_credentials');
    expect(activity('auth.password_change_failed')).toEqual([{ outcome: 'denied', meta: JSON.stringify({ reason: 'invalid_credentials' }) }]);
    expect((await user.send('POST', '/api/identity/password', { password: 'second passphrase is long', current_password: 'first passphrase is long' })).json()).toEqual({ ok: true });
    expect(activity('auth.password_change')).toEqual([{ outcome: 'ok', meta: '{}' }]);
  });
});

describe('console permissions come only from the site account; GitHub is a connection the server makes (#262 第四期)', () => {
  it('provisions a legacy member by immutable GitHub id without inventing or copying an email', async () => {
    const { app } = await setup();
    const member = app.services.identity.provisionAccount({ githubId: 340692242, githubLogin: 'legacy-member', orgRole: 'member' });
    expect(member).toMatchObject({ created: true, emailLinked: false });
    const account = app.services.storage.db.prepare("SELECT org_state, org_role, canonical_email FROM users WHERE id = ?").get(member.accountId) as { org_state: string; org_role: string; canonical_email: string | null };
    expect(account).toEqual({ org_state: 'active', org_role: 'member', canonical_email: null });
    expect(app.services.storage.db.prepare("SELECT provider, provider_uid, login FROM identities WHERE user_id = ?").all(member.accountId)).toEqual([{ provider: 'github', provider_uid: '340692242', login: 'legacy-member' }]);
    expect(app.services.storage.db.prepare("SELECT group_id FROM perm_members WHERE account_id = ?").all(member.accountId)).toEqual([{ group_id: 'level.member' }]);
    expect(app.services.identity.provisionAccount({ githubId: 340692242, githubLogin: 'legacy-member', orgRole: 'member' })).toMatchObject({ accountId: member.accountId, created: false, emailLinked: false });
  });

  it('gives the provisioned owner 站长 every permission node through email and reports GitHub as not connected without a GitHub App', async () => {
    const { app, mail, calls } = await setup();
    const owner = app.services.identity.provisionAccount({ githubId: 900000001, githubLogin: 'fixture-owner', orgRole: 'admin', email: 'owner@example.test' });
    expect(owner).toMatchObject({ created: true, emailLinked: true });
    // 重跑不重复建
    expect(app.services.identity.provisionAccount({ githubId: 900000001, githubLogin: 'fixture-owner', orgRole: 'admin', email: 'owner@example.test' })).toMatchObject({ accountId: owner.accountId, created: false, emailLinked: false });

    const user = browser(app);
    await user.send('POST', '/auth/email/start', { email: 'owner@example.test' });
    expect((await user.send('POST', '/auth/email/verify', { ...REAL, code: await mail.codeFor('owner@example.test') })).json()).toMatchObject({ registered: false });
    expect((await user.send('GET', '/auth/me')).json()).toMatchObject({ login: 'fixture-owner', user_id: 900000001, account_id: owner.accountId, provider: 'email', console_link: true });
    const me = (await user.send('GET', '/api/console/me')).json();
    expect(me).toMatchObject({ account_id: owner.accountId, provider: 'email', level: 'member', level_name: '极客班成员', department: null });
    expect(me.titles).toEqual([expect.objectContaining({ id: 'title.site.owner', department_id: null })]);
    // 站长的权限组条目是通配 `*`（lib/migrations/2026-10-yugc-v2.ts），effective() 展开成目录里的每一个非 meta 节点
    expect(me.permissions).toEqual(PERMISSION_NODES.filter(def => !def.meta).map(def => def.node));

    // #274 删掉了通用的「GitHub 组织页面」（/api/admin/:org/overview）和 /api/me/orgs、旧的 /api/console/people
    // 与称号指派：没配 GitHub App、这次也不是 GitHub 会话时，没有任何控制台路由会去接 GitHub（见 github-connection.test.ts）。
    // 新的用户列表（/api/console/users，节点 users.view）来自极客班账号，不并 GitHub 组织。
    const users = await user.send('GET', '/api/console/users');
    expect(users.statusCode).toBe(200);
    expect(users.json().items).toEqual([expect.objectContaining({
      account_id: owner.accountId, status: 'active', level: 'member', providers: expect.arrayContaining(['github', 'email']),
      titles: [expect.objectContaining({ id: 'title.site.owner' })],
    })]);
    // 名单不带邮箱
    expect(users.json().items[0]).not.toHaveProperty('email');
    // 没登录过本站的账号 id：权限组加成员查不到这个人
    const unknownGroup = await user.send('POST', '/api/console/permission-groups', { id: 'custom.probe', name: '探测', weight: 1 });
    expect(unknownGroup.statusCode).toBe(201);
    const unknown = await user.send('POST', '/api/console/permission-groups/custom.probe/members', { account_id: '01HZZZZZZZZZZZZZZZZZZZZZZZ' });
    expect([unknown.statusCode, unknown.json().error]).toEqual([404, 'account_not_found']);
    // 绑定了 GitHub 的账号用邮箱登录，在论坛里照常是成员
    expect((await user.send('GET', '/api/forum/state')).json().state.viewer.kind).toBe('member');
    expect(calls).toEqual([]);
  });

  it('makes an invite-registered member a 舰员 who can be given a department head title by account, without GitHub', async () => {
    const { app, mail, invite, calls } = await setup();
    invite('yugc-test-2026');
    const owner = app.services.identity.provisionAccount({ githubId: 900000001, githubLogin: 'fixture-owner', orgRole: 'admin', email: 'owner@example.test' });
    const user = browser(app);
    await user.send('POST', '/auth/email/start', { email: 'crew@example.test' });
    await user.send('POST', '/auth/email/verify', { ...REAL, code: await mail.codeFor('crew@example.test'), invite_code: 'yugc-test-2026' });
    expect((await user.send('GET', '/api/me/competitions')).statusCode).toBe(200);
    const me = (await user.send('GET', '/api/console/me')).json();
    expect(me).toMatchObject({ level: 'member', department: null, titles: [] });
    // 普通成员没有 console.access，进不了控制台
    expect(me.permissions).not.toContain('console.access');
    expect((await user.send('GET', '/api/console/users')).statusCode).toBe(403);
    // 没有绑定 GitHub 不是游客：论坛按账号认人（#274 SPEC §3.6），邀请码兑换的成员照常是成员。
    const crewState = (await user.send('GET', '/api/forum/state')).json().state;
    expect(crewState.viewer.kind).toBe('member');
    expect(crewState.viewer.userId).toMatch(/^a\d+$/);

    // 提督按账号给他部门部长称号，不用 GitHub 用户名（#274 的用户/权限组接口都按 account_id）
    const admiral = browser(app);
    await admiral.send('POST', '/auth/email/start', { email: 'owner@example.test' });
    await admiral.send('POST', '/auth/email/verify', { ...REAL, code: await mail.codeFor('owner@example.test') });
    const crewId = (await user.send('GET', '/auth/me')).json().account_id as string;
    const assigned = await admiral.send('PATCH', `/api/console/users/${crewId}`, { titles: ['title.ai.head'] });
    expect(assigned.statusCode).toBe(200);
    // #274 残留修复 D：回和列表一样形状的完整行，不是只有 account_id
    expect(assigned.json()).toMatchObject({ account_id: crewId, titles: [{ id: 'title.ai.head', name: expect.any(String), department_id: 'dept.ai' }] });
    const after = (await user.send('GET', '/api/console/me')).json();
    expect(after.titles).toEqual([expect.objectContaining({ id: 'title.ai.head', department_id: 'dept.ai' })]);
    // 部门部长的权限按 SPEC §3.4 限定在本部门范围（scope.department = ["dept.ai"]），但 console.access 不带范围；
    // dept.manage 不在这里（#274 残留修复 J：种子发了这个节点，但没有接口按它判定，不放进导航清单）
    expect(after.permissions).toEqual(expect.arrayContaining(['console.access', 'apply.review', 'users.view', 'activity.read']));
    expect(after.permissions).not.toContain('dept.manage');
    const missing = await admiral.send('PATCH', '/api/console/users/01HZZZZZZZZZZZZZZZZZZZZZZZ', { level: 'alumni' });
    expect([missing.statusCode, missing.json().error]).toEqual([404, 'not_found']);
    expect(owner.accountId).not.toBe(crewId);
    expect(calls).toEqual([]);
  });

  it('access.resolve() reads valid site membership and never calls GitHub, whatever an org-membership stub would say', async () => {
    // roles.octocat='admin' 只是用来证明没人会去看它：access.resolve() 已经不查 GitHub（lib/access.ts），
    // 这个账号没填邀请码签入，站内角色只能是空，不会被这个桩「升级」成管理员。
    const roles: Record<string, 'admin' | 'member' | null> = { octocat: 'admin' };
    const { app, db, calls } = await setup({ roles });
    const sid = signIn(app, 'octocat', 42);
    expect((await app.inject({ url: '/auth/me', headers: { cookie: `sid=${sid}` } })).json().signed_in).toBe(true);
    expect(db.prepare('SELECT org_role, org_state FROM users').get()).toEqual({ org_role: null, org_state: 'not_member' });
    expect(calls).toEqual([]);
    const accountId = (db.prepare('SELECT id FROM users').get() as { id: string }).id;
    const access = await app.services.access.resolve({ login: 'octocat', userId: 42, accountId, accessToken: 'token-octocat', provider: 'github' });
    // 正常登录不等于具有 member/alumni 资格；论坛识别会话与业务写权限仍分别判定。
    expect([access.member, access.siteRole]).toEqual([false, null]);
    expect(db.prepare('SELECT org_role, org_state FROM users').get()).toEqual({ org_role: null, org_state: 'not_member' });
    expect(calls).toEqual([]);
  });

  it('lists a plain no-invite GitHub sign-up as not a member, and lets 提督 settle it as a member', async () => {
    const { app } = await setup();
    signIn(app, 'octocat', 42);
    const listed = () => app.services.identity.listAccounts().find(account => account.login === 'octocat')!;
    // #274 review round 1（blocker）：没填邀请码注册的账号不再是「回填的老账号还没记角色」（role_unrecorded 只
    // 描述 backfillIdentity 迁移来的老数据，见 identity-store.ts 的类型注释），而是明确的「还不是极客班成员」。
    expect(listed()).toMatchObject({ site_role: null, role_unrecorded: false, member: false });
    expect(app.services.identity.setSiteRole({ accountId: listed().account_id, role: 'member', actor: { login: 'boss', account_id: null } })).toEqual({ ok: true, changed: true });
    expect(listed()).toMatchObject({ site_role: 'member', role_unrecorded: false, member: true });
  });
});

describe('site ownership in 成员与权限 (#274：按权限节点判定，取代旧的 site_role/people.ts)', () => {
  it('needs users.manage to change anyone\'s titles, keeps one site owner, and the change applies to the next request at once', async () => {
    const { app, db, mail, invite, tick } = await setup();
    invite('yugc-test-2026');
    const owner = app.services.identity.provisionAccount({ githubId: 900000001, githubLogin: 'fixture-owner', orgRole: 'admin', email: 'owner@example.test' });
    const signInByEmail = async (email: string, invite_code?: string, nth = 1) => {
      const user = browser(app);
      await user.send('POST', '/auth/email/start', { email });
      const verified = await user.send('POST', '/auth/email/verify', { ...REAL, code: await mail.codeFor(email, nth), ...(invite_code ? { invite_code } : {}) });
      return { user, verified };
    };
    const { user: admiral } = await signInByEmail('owner@example.test');
    const { user: crew } = await signInByEmail('crew@example.test', 'yugc-test-2026');
    const idOf = async (user: ReturnType<typeof browser>) => (await user.send('GET', '/auth/me')).json().account_id as string;
    const crewId = await idOf(crew);
    const patch = (user: ReturnType<typeof browser>, accountId: string, body: Record<string, unknown>) => user.send('PATCH', `/api/console/users/${accountId}`, body);

    // 普通成员没有 users.manage，改不了任何人的称号
    const byCrew = await patch(crew, crewId, { titles: ['title.site.owner'] });
    expect(byCrew.statusCode).toBe(403);
    expect(byCrew.json()).toMatchObject({ error: 'forbidden', node: 'users.manage' });
    expect((await patch(admiral, '01HZZZZZZZZZZZZZZZZZZZZZZZ', { level: 'member' })).statusCode).toBe(404);

    // 提督把舰员也加成站长；响应回和列表一样形状的完整行（#274 残留修复 D），不回旧的 site_role/changed
    expect((await patch(admiral, crewId, { titles: ['title.site.owner'] })).json()).toMatchObject({ account_id: crewId, level: 'member' });
    const crewMe = (await crew.send('GET', '/api/console/me')).json();
    expect(crewMe.titles).toEqual([expect.objectContaining({ id: 'title.site.owner' })]);
    expect(crewMe.permissions).toContain('users.manage');

    // 现在有两位站长，新站长可以把原来那位的站长称号摘掉（不是最后一位，不触发 last_owner）；
    // 下一个请求立刻按新的权限判定——没有缓存失效的延迟（lib/permissions.ts 的 revision + bump()）
    expect((await patch(crew, owner.accountId, { titles: [] })).json()).toMatchObject({ account_id: owner.accountId, titles: [] });
    const removedMe = (await admiral.send('GET', '/api/console/me')).json();
    expect(removedMe.titles).toEqual([]);
    expect(removedMe.permissions).not.toContain('console.access');
    // 账号本身没有被停用，论坛照常是成员（只是不再是站长）
    expect((await admiral.send('GET', '/api/forum/state')).json().state.viewer.kind).toBe('member');
    tick(61_000);
    // #274：org_state 不再参与登录判断，不是站长了也能照常登录，只是没有站长权限
    const { verified: signedBackIn } = await signInByEmail('owner@example.test', undefined, 2);
    expect(signedBackIn.statusCode).toBe(200);

    // 至少留一位站长：原提督已经没有 users.manage 了，只有新站长自己能试——摘自己的站长称号也会被拒绝
    const last = await patch(crew, crewId, { titles: [] });
    expect([last.statusCode, last.json().error]).toEqual([409, 'last_owner']);
    const lastByDisable = await patch(crew, crewId, { status: 'disabled' });
    expect([lastByDisable.statusCode, lastByDisable.json().error]).toEqual([409, 'last_owner']);

    expect(activityRows(app, { action: 'users.update' }).map(row => row.target_id))
      .toEqual([crewId, owner.accountId]);
  });
});

describe('GitHub sign-in: invite optional, no organization check (#274 rewrite of #262 第四期)', () => {
  const user = { id: 42, login: 'octocat' };
  const httpRequest = (async (url: string) => ({
    statusCode: 200,
    body: { json: async () => url.includes('/access_token') ? { access_token: 'test-provider-token' } : { id: user.id, login: user.login, avatar_url: '' }, dump: async () => undefined },
  })) as unknown as ServiceOverrides['httpRequest'];
  /** 只用来证明「从没被调用过」：GitHub 组织那道门已经去掉（SPEC §3.2），任何调用都是意外。 */
  function noGithubCalls(calls: string[]) {
    return (() => ({ request: async (route: string) => { calls.push(route); throw new Error(`unexpected GitHub call ${route}`); } })) as unknown as ServiceOverrides['octokitFactory'];
  }
  /** 极客班的人（成员、往届成员）缺姓名和年级（#280）：登录后先到补资料页，补好再回论坛；普通注册用户直接回论坛 */
  const PROFILE_PAGE = 'https://example.test/complete-profile?return_to=%2Fforum%2F';
  const FORUM = 'https://example.test/forum/';
  async function callback(app: FastifyInstance, invite?: string) {
    const start = await app.inject(`/auth/github?return_to=https%3A%2F%2Fexample.test%2Fforum%2F${invite ? `&invite=${invite}` : ''}`);
    const state = new URL(String(start.headers.location)).searchParams.get('state');
    const response = await app.inject({ url: `/auth/callback?code=ok&state=${state}`, headers: { cookie: String(start.headers['set-cookie']).split(';')[0] } });
    return String(response.headers.location);
  }

  it('registers a new GitHub user as a plain registered user without an invite, never calling the GitHub org API', async () => {
    const calls: string[] = [];
    const context = await testApp({ httpRequest, octokitFactory: noGithubCalls(calls) }); contexts.push(context);
    const { app } = context;
    const db = app.services.storage.db;
    Object.assign(user, { id: 42, login: 'octocat' });
    expect(await callback(app)).toBe(FORUM);
    expect(calls).toEqual([]);
    // #274 review round 1（blocker）：没填邀请码的 org_state 记 not_member，不再统一写 active。
    expect(db.prepare('SELECT org_role, org_state FROM users').get()).toEqual({ org_role: null, org_state: 'not_member' });

    // 再登录一次：同一个账号，不重新注册
    expect(await callback(app)).toBe(FORUM);
    expect(db.prepare('SELECT COUNT(*) AS n FROM users').get()).toEqual({ n: 1 });
  });

  it('registers a new GitHub user as a member with a valid invite, and refuses an invalid one without creating an account', async () => {
    const calls: string[] = [];
    const context = await testApp({ httpRequest, octokitFactory: noGithubCalls(calls) }); contexts.push(context);
    const { app } = context;
    const db = app.services.storage.db;
    app.services.invites.create({ code: 'yugc-test-2026', max_uses: null }, 'test');
    Object.assign(user, { id: 43, login: 'newmember' });
    expect(await callback(app, 'not-a-real-code')).toContain('signin=invite_invalid');
    expect(db.prepare('SELECT COUNT(*) AS n FROM users').get()).toEqual({ n: 0 });
    expect(await callback(app, 'yugc-test-2026')).toBe(PROFILE_PAGE);
    expect(db.prepare('SELECT org_role, org_state FROM users').get()).toEqual({ org_role: 'member', org_state: 'active' });
    expect(calls).toEqual([]);
  });

  it('never makes a GitHub sign-in a site admin automatically; only the console or CLI provisioning can', async () => {
    const calls: string[] = [];
    const context = await testApp({ httpRequest, octokitFactory: noGithubCalls(calls) }); contexts.push(context);
    const { app } = context;
    const db = app.services.storage.db;
    Object.assign(user, { id: 44, login: 'firstuser' });
    expect(await callback(app)).toBe(FORUM);
    // #262 时代「空库第一个 GitHub 组织 owner 自动变站内管理员」已经去掉（SPEC §3.2）：第一个 GitHub 用户也只是注册用户
    expect(db.prepare('SELECT org_role FROM users').get()).toEqual({ org_role: null });
  });

  it('refuses a disabled account and keeps a recorded site role untouched on repeat sign-in; the organization gate cannot take access away anymore', async () => {
    const calls: string[] = [];
    const context = await testApp({ httpRequest, octokitFactory: noGithubCalls(calls) }); contexts.push(context);
    const { app } = context;
    const db = app.services.storage.db;
    const owner = app.services.identity.provisionAccount({ githubId: 42, githubLogin: 'octocat', orgRole: 'admin', email: 'owner@example.test' });
    Object.assign(user, { id: 42, login: 'octocat' });
    expect(await callback(app)).toBe(PROFILE_PAGE);
    expect(db.prepare('SELECT org_role FROM users WHERE id = ?').get(owner.accountId)).toEqual({ org_role: 'admin' });
    expect(calls).toEqual([]);

    db.prepare("UPDATE users SET status = 'disabled' WHERE id = ?").run(owner.accountId);
    expect(await callback(app)).toContain('signin=account_disabled');
  });

  it('sends a GitHub account without an email to the bind page first, a member then to the profile page (#280), and straight back once both are done (#273)', async () => {
    const calls: string[] = [];
    const context = await testApp({ httpRequest, octokitFactory: noGithubCalls(calls) }, false, MAIL_ENV); contexts.push(context);
    const { app } = context;
    Object.assign(user, { id: 45, login: 'needsemail' });
    expect(await callback(app)).toBe('https://example.test/bind-email?return_to=%2Fforum%2F');
    const accountId = (app.services.storage.db.prepare("SELECT user_id FROM identities WHERE provider = 'github' AND provider_uid = '45'").get() as { user_id: string }).user_id;
    app.services.identity.linkEmail({ accountId, email: 'needs@example.test', login: 'needsemail', claim: () => true });
    expect(await callback(app)).toBe(FORUM);
    grantPermGroup(app, accountId, 'level.member');
    expect(await callback(app)).toBe(PROFILE_PAGE);
    completeProfile(app, accountId);
    expect(await callback(app)).toBe(FORUM);
    expect(calls).toEqual([]);
  });
});

describe('binding an email to a GitHub account (#262)', () => {
  it('binds once, refuses an address that belongs to someone else, and then allows email sign-in', async () => {
    const { app, mail, invite, tick } = await setup({ roles: { octocat: 'member' } });
    invite('yugc-test-2026');
    const other = browser(app);
    await other.send('POST', '/auth/email/start', { email: 'taken@example.test' });
    await other.send('POST', '/auth/email/verify', { ...REAL, code: await mail.codeFor('taken@example.test'), invite_code: 'yugc-test-2026' });
    tick(61_000);

    const user = browser(app);
    user.jar.set('sid', signIn(app, 'octocat', 42));
    await user.send('POST', '/api/identity/email/start', { email: 'taken@example.test' });
    expect((await user.send('POST', '/api/identity/email/verify', { code: await mail.codeFor('taken@example.test', 2) })).json().error).toBe('identity_conflict');
    expect((await user.send('POST', '/api/identity/email/start', { email: 'octo@example.test' })).statusCode).toBe(202);
    expect((await user.send('POST', '/api/identity/email/verify', { code: await mail.codeFor('octo@example.test') })).json()).toEqual({ ok: true });
    expect((await user.send('GET', '/api/identity/me')).json().identities.map((i: { provider: string }) => i.provider)).toEqual(['github', 'email']);

    tick(61_000);
    const later = browser(app);
    await later.send('POST', '/auth/email/start', { email: 'octo@example.test' });
    await later.send('POST', '/auth/email/verify', { ...REAL, code: await mail.codeFor('octo@example.test', 2) });
    expect((await later.send('GET', '/auth/me')).json()).toMatchObject({ login: 'octocat', user_id: 42, provider: 'email' });
  });

  it('binds up to five emails, keeps the first as primary, removes the others and signs in with any of them (#272)', async () => {
    const { app, db, mail, tick } = await setup({ roles: { octocat: 'member' } });
    const activityCount = (action: string) => (db.prepare('SELECT COUNT(*) AS n FROM activity_events WHERE action = ?').get(action) as { n: number }).n;
    const user = browser(app);
    user.jar.set('sid', signIn(app, 'octocat', 42));
    const bind = async (email: string) => {
      expect((await user.send('POST', '/api/identity/email/start', { email })).statusCode).toBe(202);
      return (await user.send('POST', '/api/identity/email/verify', { code: await mail.codeFor(email) })).json();
    };
    expect(await bind('first@example.test')).toEqual({ ok: true });
    expect(await bind('work@example.test')).toEqual({ ok: true });
    // 每次成功绑定都记一条 auth.email_link（#274 review round 1，SPEC §3.7）。
    expect(activityCount('auth.email_link')).toBe(2);
    // 已经绑在自己账号上的邮箱不再发信
    const again = await user.send('POST', '/api/identity/email/start', { email: 'Work@example.test' });
    expect([again.statusCode, again.json().error]).toEqual([409, 'identity_exists']);
    expect(mail.letters.filter(letter => letter.to === 'work@example.test')).toHaveLength(1);

    const view = (await user.send('GET', '/api/identity/me')).json();
    expect(view.identities).toEqual([
      expect.objectContaining({ provider: 'github', label: 'octocat' }),
      expect.objectContaining({ provider: 'email', label: 'f***@example.test', id: expect.any(String), primary: true }),
      expect.objectContaining({ provider: 'email', label: 'w***@example.test', id: expect.any(String), primary: false }),
    ]);
    expect(view.identities[0]).not.toHaveProperty('id');
    expect(view.available).toEqual(['email']);
    const accountId = view.account_id as string;
    expect(app.services.identity.getAccountClaims(accountId)).toMatchObject({ email: 'first@example.test', emails: ['first@example.test', 'work@example.test'] });

    // 用第二个邮箱也能登录同一个账号
    tick(61_000);
    const later = browser(app);
    await later.send('POST', '/auth/email/start', { email: 'work@example.test' });
    await later.send('POST', '/auth/email/verify', { ...REAL, code: await mail.codeFor('work@example.test', 2) });
    expect((await later.send('GET', '/auth/me')).json()).toMatchObject({ login: 'octocat', account_id: accountId, provider: 'email' });

    for (const email of ['c@example.test', 'd@example.test', 'e@example.test']) expect(await bind(email)).toEqual({ ok: true });
    const full = await user.send('POST', '/api/identity/email/start', { email: 'sixth@example.test' });
    expect([full.statusCode, full.json().error]).toEqual([409, 'email_limit']);
    expect(full.json().message).toBe('一个账号最多绑 5 个邮箱，先删掉一个再加');
    expect((await user.send('GET', '/api/identity/me')).json().available).toEqual([]);

    const emails = (await user.send('GET', '/api/identity/me')).json().identities.filter((item: { provider: string }) => item.provider === 'email') as { id: string; primary: boolean }[];
    const primary = await user.send('POST', '/api/identity/email/remove', { identity_id: emails[0].id });
    expect([primary.statusCode, primary.json().error]).toEqual([409, 'primary_email']);
    expect((await user.send('POST', '/api/identity/email/remove', { identity_id: emails[1].id })).json()).toEqual({ ok: true });
    // 只有真的解绑成功才记 auth.email_unlink；上面那次 409（删主邮箱）不算。
    expect(activityCount('auth.email_unlink')).toBe(1);
    const gone = await user.send('POST', '/api/identity/email/remove', { identity_id: emails[1].id });
    expect([gone.statusCode, gone.json().error]).toEqual([404, 'not_found']);
    expect(activityCount('auth.email_unlink')).toBe(1);
    expect(app.services.identity.getAccountClaims(accountId)!.emails).toEqual(['first@example.test', 'c@example.test', 'd@example.test', 'e@example.test']);
    const after = (await user.send('GET', '/api/identity/me')).json();
    expect(after.available).toEqual(['email']);
    expect(after.recent[0]).toEqual({ at: expect.any(Number), action: 'unlink', provider: 'email', result: 'ok' });

    // 删掉的邮箱不再属于原账号：这个地址不填邀请码也能登录，但登进的是一个全新的注册用户，不是原账号（#274）
    tick(61_000);
    const removed = browser(app);
    await removed.send('POST', '/auth/email/start', { email: 'work@example.test' });
    const rejoined = await removed.send('POST', '/auth/email/verify', { ...REAL, code: await mail.codeFor('work@example.test', 3) });
    expect(rejoined.json()).toMatchObject({ registered: true });
    expect((await removed.send('GET', '/auth/me')).json().account_id).not.toBe(accountId);
    const stranger = browser(app);
    stranger.jar.set('sid', signIn(app, 'hubot', 7));
    expect((await stranger.send('POST', '/api/identity/email/remove', { identity_id: emails[2].id })).statusCode).toBe(404);
  });

  it('refuses the sixth email at verify time when another session filled the account after the code was sent (#272)', async () => {
    const { app, mail } = await setup({ roles: { octocat: 'member' } });
    const first = browser(app);
    first.jar.set('sid', signIn(app, 'octocat', 42));
    const second = browser(app);
    second.jar.set('sid', signIn(app, 'octocat', 42));
    for (const email of ['a@example.test', 'b@example.test', 'c@example.test', 'd@example.test']) {
      await first.send('POST', '/api/identity/email/start', { email });
      await first.send('POST', '/api/identity/email/verify', { code: await mail.codeFor(email) });
    }
    // 两个会话都在还差一个时发了码；一个先填满，另一个填码时按上限拒绝
    expect((await first.send('POST', '/api/identity/email/start', { email: 'e@example.test' })).statusCode).toBe(202);
    expect((await second.send('POST', '/api/identity/email/start', { email: 'f@example.test' })).statusCode).toBe(202);
    expect((await second.send('POST', '/api/identity/email/verify', { code: await mail.codeFor('f@example.test') })).json()).toEqual({ ok: true });
    const late = await first.send('POST', '/api/identity/email/verify', { code: await mail.codeFor('e@example.test') });
    expect([late.statusCode, late.json().error]).toEqual([409, 'email_limit']);
    expect((await first.send('GET', '/api/identity/me')).json().identities.filter((item: { provider: string }) => item.provider === 'email')).toHaveLength(5);
  });

  it('asks a stale session to sign in again before removing an email (#272)', async () => {
    const { app, db, mail } = await setup({ roles: { octocat: 'member' } });
    const user = browser(app);
    user.jar.set('sid', signIn(app, 'octocat', 42));
    for (const email of ['first@example.test', 'second@example.test']) {
      await user.send('POST', '/api/identity/email/start', { email });
      await user.send('POST', '/api/identity/email/verify', { code: await mail.codeFor(email) });
    }
    const second = (await user.send('GET', '/api/identity/me')).json().identities.find((item: { primary?: boolean }) => item.primary === false);
    db.prepare('UPDATE sessions SET created_at = created_at - 11 * 60 * 1000').run();
    expect((await user.send('POST', '/api/identity/email/remove', { identity_id: second.id })).json()).toMatchObject({ error: 'step_up_required', reauth: { return_to: '/account' } });
    expect((await user.send('GET', '/api/identity/me')).json().identities.filter((item: { provider: string }) => item.provider === 'email')).toHaveLength(2);
  });
});

describe('invite codes in the console (#262)', () => {
  it('lets 提督 create, list and disable codes and keeps everyone else out', async () => {
    const { app } = await setup({ roles: { boss: 'admin', crew: 'member' } });
    const boss = browser(app); boss.jar.set('sid', signIn(app, 'boss', 1));
    const crew = browser(app); crew.jar.set('sid', signIn(app, 'crew', 2));
    // #274：invite.manage 按新权限节点判定，不再跟着旧的 GitHub 组织角色桩走，站长要显式放进 title.site.owner。
    grantPermGroup(app, accountIdOf(app, 'boss'), 'title.site.owner');
    const refused = await crew.send('GET', '/api/console/invites');
    expect(refused.statusCode).toBe(403);
    expect(refused.json()).toMatchObject({ node: 'invite.manage' });
    const created = await boss.send('POST', '/api/console/invites', { code: 'Spring-2027', note: '春季招新', max_uses: 30 });
    expect(created.statusCode).toBe(201);
    expect(created.json()).toMatchObject({ code: 'spring-2027', note: '春季招新', max_uses: 30, used_count: 0, disabled: false, usable: true });
    expect((await boss.send('POST', '/api/console/invites', { code: 'SPRING-2027' })).json().error).toBe('invite_code_taken');
    expect((await boss.send('POST', '/api/console/invites', { code: 'no' })).statusCode).toBe(400);
    const disabled = await boss.send('PATCH', `/api/console/invites/${created.json().id}`, { disabled: true });
    expect(disabled.json()).toMatchObject({ disabled: true, usable: false });
    expect((await boss.send('GET', '/api/console/invites')).json().invites).toEqual([{
      id: created.json().id, code: 'spring-2027', note: '春季招新', max_uses: 30, used_count: 0, expires_at: null, disabled: true,
      created_by: 'boss', created_at: expect.any(Number), updated_at: expect.any(Number), usable: false,
    }]);
  });
});

describe('Google sign-in (#262)', () => {
  async function googleFlow(app: FastifyInstance, google: ReturnType<typeof googleStub>, query = '') {
    const user = browser(app);
    const start = await user.send('GET', `/auth/google?return_to=%2Fforum%2F${query}`);
    expect(start.statusCode).toBe(302);
    const location = new URL(String(start.headers.location));
    expect(location.origin + location.pathname).toBe('https://accounts.google.com/o/oauth2/v2/auth');
    expect(location.searchParams.get('code_challenge_method')).toBe('S256');
    google.setNonce(location.searchParams.get('nonce')!);
    const back = await user.send('GET', `/auth/google/callback?code=ok&state=${location.searchParams.get('state')}`);
    return { user, location: String(back.headers.location) };
  }

  it('is not there without credentials', async () => {
    const { app } = await setup();
    expect((await app.inject('/auth/google')).json().error).toBe('provider_not_enabled');
  });

  it('registers a plain registered user without an invite, then upgrades to member through the redeem endpoint (#274)', async () => {
    const google = googleStub();
    const { app, db, mail, invite } = await setup({ env: GOOGLE_ENV, google });
    invite('yugc-test-2026');
    const first = await googleFlow(app, google);
    // 没填邀请码：注册成注册用户，不是错误（SPEC §3.2）；Google 给的邮箱不算登录邮箱（#273），注册后先到绑定邮箱页
    expect(first.location).toBe('https://example.test/bind-email?return_to=%2Fforum%2F');
    expect(db.prepare('SELECT COUNT(*) AS n FROM users').get()).toEqual({ n: 1 });
    expect(db.prepare('SELECT org_role FROM users').get()).toEqual({ org_role: null });
    expect(google.tokenRequests.at(-1)).toContain('code_verifier=');
    const me = (await first.user.send('GET', '/auth/me')).json();
    expect(me).toMatchObject({ signed_in: true, provider: 'google', email_required: true, level: 'registered' });
    expect(db.prepare("SELECT provider_uid, email FROM identities WHERE provider = 'google'").get()).toEqual({ provider_uid: 'google-sub-1', email: 'g.user@example.test' });
    // 绑上同一个 Gmail 地址就行；注册用户不用补姓名和年级（#280），之后用 Google 登录直接回原页，同一个账号
    expect((await first.user.send('POST', '/api/identity/email/start', { email: 'g.user@example.test' })).statusCode).toBe(202);
    expect((await first.user.send('POST', '/api/identity/email/verify', { code: await mail.codeFor('g.user@example.test') })).json()).toEqual({ ok: true });
    const again = await googleFlow(app, google);
    expect(again.location).toBe('https://example.test/forum/');
    expect((await again.user.send('GET', '/auth/me')).json().account_id).toBe(me.account_id);
    expect(db.prepare('SELECT COUNT(*) AS n FROM users').get()).toEqual({ n: 1 });

    // 资料卡/账号页兑换邀请码升级成成员，不用重新登录（CONTRACT-274 §2）
    const redeemed = await first.user.send('POST', '/api/identity/invite/redeem', { code: 'yugc-test-2026' });
    expect(redeemed.json()).toEqual({ level: 'member' });
    expect((await first.user.send('GET', '/auth/me')).json().level).toBe('member');
    expect(db.prepare('SELECT org_role FROM users').get()).toEqual({ org_role: null }); // org_role 不再由兑换邀请码改，只有 perm_members 变
    // 成了成员再登录，先补姓名和年级
    expect((await googleFlow(app, google)).location).toBe('https://example.test/complete-profile?return_to=%2Fforum%2F');
    completeProfile(app, me.account_id);
    expect((await googleFlow(app, google)).location).toBe('https://example.test/forum/');
  });

  it('does not create a second account for an email that already has one, and fails closed on a bad token', async () => {
    const google = googleStub();
    const { app, mail, invite } = await setup({ env: GOOGLE_ENV, google });
    invite('yugc-test-2026');
    const user = browser(app);
    await user.send('POST', '/auth/email/start', { email: 'g.user@example.test' });
    await user.send('POST', '/auth/email/verify', { ...REAL, code: await mail.codeFor('g.user@example.test'), invite_code: 'yugc-test-2026' });
    expect((await googleFlow(app, google, '&invite=yugc-test-2026')).location).toContain('signin=email_taken');

    google.claims.sub = 'google-sub-2';
    google.claims.email = 'other@example.test';
    google.claims.aud = 'someone-else';
    expect((await googleFlow(app, google, '&invite=yugc-test-2026')).location).toContain('signin=failed');
  });
});

describe('forgot password and the bind-email gate (#273)', () => {
  /** 用邀请码注册一个邮箱账号，passphrase 不为空时再在账号页设上密码；返回这个浏览器和账号 id。 */
  async function emailAccount(context: Awaited<ReturnType<typeof setup>>, email: string, passphrase?: string) {
    const user = browser(context.app);
    await user.send('POST', '/auth/email/start', { email });
    await user.send('POST', '/auth/email/verify', { ...REAL, code: await context.mail.codeFor(email), invite_code: 'yugc-test-2026' });
    if (passphrase) expect((await user.send('POST', '/api/identity/password', { password: passphrase })).json()).toEqual({ ok: true });
    return { user, accountId: (await user.send('GET', '/auth/me')).json().account_id as string };
  }

  it('resets a forgotten password with an emailed code, signs in, and keeps the code for a second try when the new password is too short', async () => {
    const context = await setup();
    const { app, db, mail, invite, tick } = context;
    invite('yugc-test-2026');
    const { accountId } = await emailAccount(context, 'forgot@example.test', 'old passphrase here');
    tick(61_000);

    const user = browser(app);
    expect((await user.send('POST', '/auth/email/start', { email: 'forgot@example.test', purpose: 'reset', return_to: '/console' })).statusCode).toBe(202);
    const code = await mail.codeFor('forgot@example.test', 2);
    expect(mail.letters[1].subject).toBe('你的极客班重设密码验证码');
    expect(mail.letters[1].text).toContain('你正在重设极客班账号的密码');

    const short = await user.send('POST', '/auth/email/reset', { code, password: 'abc' });
    expect([short.statusCode, short.json()]).toEqual([400, { error: 'password_too_short', message: '密码至少 8 位' }]);
    expect((await user.send('POST', '/auth/email/reset', { code: code === '000000' ? '111111' : '000000', password: 'new passphrase here' })).json()).toMatchObject({ error: 'invalid_code', attempts_left: 4 });
    const ok = await user.send('POST', '/auth/email/reset', { code, password: 'new passphrase here' });
    expect([ok.statusCode, ok.json()]).toEqual([200, { return_to: 'https://example.test/console' }]);
    expect((await user.send('GET', '/auth/me')).json()).toMatchObject({ signed_in: true, provider: 'email', account_id: accountId, email_required: false });
    // 同一个验证码不能再用
    expect((await user.send('POST', '/auth/email/reset', { code, password: 'third passphrase here' })).json().error).toBe('code_expired');

    expect((await browser(app).send('POST', '/auth/email/password', { email: 'forgot@example.test', password: 'old passphrase here' })).json().error).toBe('invalid_credentials');
    expect((await browser(app).send('POST', '/auth/email/password', { email: 'forgot@example.test', password: 'new passphrase here' })).statusCode).toBe(200);
    expect(db.prepare("SELECT action, provider, result FROM identity_audit WHERE user_id = ? AND action LIKE 'password_%' ORDER BY id").all(accountId))
      .toEqual([{ action: 'password_set', provider: 'email', result: 'ok' }, { action: 'password_reset', provider: 'email', result: 'ok' }]);
    // #274 item I：account.password 这条审计删掉了（identity-store.ts 内部重复，路由侧已经按 kind 分别记
    // auth.password_set/auth.password_change/auth.password_reset），这里改认对应的 activity_events 动作名。
    expect(activityRows(app, { actionLike: 'auth.password_%' }).map(row => row.action))
      .toEqual(['auth.password_set', 'auth.password_reset']);
    const view = (await user.send('GET', '/api/identity/me')).json();
    expect(view.recent[0]).toMatchObject({ action: 'login', provider: 'email' });
    expect(view.recent.map((r: { action: string }) => r.action)).toContain('password_reset');
  });

  it('revokes the account\'s other sessions when the password is reset (PENTEST-20261029 finding 14)', async () => {
    const context = await setup();
    const { app, mail, invite, tick } = context;
    invite('yugc-test-2026');
    await emailAccount(context, 'revoke@example.test', 'old passphrase here');
    tick(61_000);
    // 旧设备或已经泄露的那条会话：用旧密码登录出来的另一个 sid
    const stale = browser(app);
    expect((await stale.send('POST', '/auth/email/password', { email: 'revoke@example.test', password: 'old passphrase here' })).statusCode).toBe(200);
    expect((await stale.send('GET', '/auth/me')).json().signed_in).toBe(true);
    // 受害者走「忘了密码」重设
    const user = browser(app);
    await user.send('POST', '/auth/email/start', { email: 'revoke@example.test', purpose: 'reset' });
    expect((await user.send('POST', '/auth/email/reset', { code: await mail.codeFor('revoke@example.test', 2), password: 'new passphrase here' })).statusCode).toBe(200);
    // 重设之前签发的会话必须失效，这次新签发的照常能用
    expect((await stale.send('GET', '/auth/me')).json().signed_in).toBe(false);
    expect((await user.send('GET', '/auth/me')).json().signed_in).toBe(true);
  });

  it('revokes the account\'s other sessions when the signed-in user changes the password (PENTEST-20261029 finding 14)', async () => {
    const context = await setup();
    const { app, invite, tick } = context;
    invite('yugc-test-2026');
    await emailAccount(context, 'change@example.test', 'old passphrase here');
    tick(61_000);
    const stale = browser(app);
    expect((await stale.send('POST', '/auth/email/password', { email: 'change@example.test', password: 'old passphrase here' })).statusCode).toBe(200);
    const user = browser(app);
    expect((await user.send('POST', '/auth/email/password', { email: 'change@example.test', password: 'old passphrase here' })).statusCode).toBe(200);
    // 刚登录过，不用再输当前密码；改完之后只留发起修改的这一条
    expect((await user.send('POST', '/api/identity/password', { password: 'new passphrase here' })).statusCode).toBe(200);
    expect((await stale.send('GET', '/auth/me')).json().signed_in).toBe(false);
    expect((await user.send('GET', '/auth/me')).json().signed_in).toBe(true);
  });

  it('sets a first password the same way for an email account that never had one', async () => {
    const context = await setup();
    const { app, mail, invite, tick } = context;
    invite('yugc-test-2026');
    await emailAccount(context, 'nopw@example.test');
    tick(61_000);
    const user = browser(app);
    await user.send('POST', '/auth/email/start', { email: 'nopw@example.test', purpose: 'reset' });
    expect((await user.send('POST', '/auth/email/reset', { code: await mail.codeFor('nopw@example.test', 2), password: 'fresh passphrase' })).statusCode).toBe(200);
    expect((await user.send('GET', '/api/identity/me')).json()).toMatchObject({ has_password: true });
  });

  it('cannot register or open a disabled account, and leaves the code unused when there is no account', async () => {
    const context = await setup();
    const { app, db, mail, invite, tick } = context;
    invite('yugc-test-2026');
    const stranger = browser(app);
    await stranger.send('POST', '/auth/email/start', { email: 'ghost@example.test', purpose: 'reset' });
    const none = await stranger.send('POST', '/auth/email/reset', { code: await mail.codeFor('ghost@example.test'), password: 'some passphrase' });
    expect([none.statusCode, none.json().error]).toEqual([400, 'no_account']);
    expect(db.prepare('SELECT COUNT(*) AS n FROM users').get()).toEqual({ n: 0 });
    expect(db.prepare('SELECT used_at FROM email_challenges WHERE email = ?').get('ghost@example.test')).toEqual({ used_at: null });

    const { accountId } = await emailAccount(context, 'off@example.test', 'old passphrase here');
    db.prepare("UPDATE users SET status = 'disabled' WHERE id = ?").run(accountId);
    tick(61_000);
    const user = browser(app);
    await user.send('POST', '/auth/email/start', { email: 'off@example.test', purpose: 'reset' });
    const refused = await user.send('POST', '/auth/email/reset', { code: await mail.codeFor('off@example.test', 2), password: 'new passphrase here' });
    expect([refused.statusCode, refused.json().error]).toEqual([403, 'account_disabled']);
    expect(user.jar.has('sid')).toBe(false);
    expect((await browser(app).send('POST', '/auth/email/password', { email: 'off@example.test', password: 'new passphrase here' })).json().error).toBe('invalid_credentials');
  });

  it('resets a password for an account that is no longer a geek-class member, and expires a code older than 10 minutes (#274: org_state no longer gates sign-in)', async () => {
    const context = await setup();
    const { app, db, mail, invite, tick } = context;
    invite('yugc-test-2026');
    const { accountId } = await emailAccount(context, 'left@example.test', 'old passphrase here');
    db.prepare("UPDATE users SET org_role = NULL, org_state = 'not_member' WHERE id = ?").run(accountId);
    tick(61_000);
    const user = browser(app);
    await user.send('POST', '/auth/email/start', { email: 'left@example.test', purpose: 'reset' });
    const ok = await user.send('POST', '/auth/email/reset', { code: await mail.codeFor('left@example.test', 2), password: 'new passphrase here' });
    expect(ok.statusCode).toBe(200);
    expect(user.jar.has('sid')).toBe(true);
    expect((await user.send('GET', '/auth/me')).json()).toMatchObject({ signed_in: true, account_id: accountId });

    tick(61_000);
    await user.send('POST', '/auth/email/start', { email: 'left@example.test', purpose: 'reset' });
    const code = await mail.codeFor('left@example.test', 3);
    tick(10 * 60_000 + 1_000);
    const late = await user.send('POST', '/auth/email/reset', { code, password: 'yet another passphrase' });
    expect([late.statusCode, late.json().error]).toEqual([400, 'code_expired']);
    expect((await browser(app).send('POST', '/auth/email/password', { email: 'left@example.test', password: 'new passphrase here' })).statusCode).toBe(200);
  });

  it('flags an account without a login email on /auth/me, the account page and the console, until one is bound', async () => {
    const { app, mail } = await setup({ roles: { octocat: 'member' } });
    const user = browser(app);
    user.jar.set('sid', signIn(app, 'octocat', 42));
    expect((await user.send('GET', '/auth/me')).json()).toMatchObject({ signed_in: true, email_required: true });
    expect((await user.send('GET', '/api/identity/me')).json()).toMatchObject({ email_required: true, available: ['email'] });
    expect((await user.send('GET', '/api/console/me')).json()).toMatchObject({ email_required: true });

    await user.send('POST', '/api/identity/email/start', { email: 'octo@example.test' });
    expect((await user.send('POST', '/api/identity/email/verify', { code: await mail.codeFor('octo@example.test') })).json()).toEqual({ ok: true });
    expect((await user.send('GET', '/auth/me')).json().email_required).toBe(false);
    expect((await user.send('GET', '/api/identity/me')).json().email_required).toBe(false);
    expect((await user.send('GET', '/api/console/me')).json().email_required).toBe(false);
  });

  it('does not ask for an email where this site cannot send one', async () => {
    const context = await testApp({ octokitFactory: github({ octocat: 'member' }, []) }); contexts.push(context);
    const headers = { cookie: `sid=${signIn(context.app, 'octocat', 42)}` };
    expect((await context.app.inject({ url: '/auth/me', headers })).json().email_required).toBe(false);
    expect((await context.app.inject({ url: '/api/identity/me', headers })).json().email_required).toBe(false);
    expect((await context.app.inject({ url: '/api/console/me', headers })).json().email_required).toBe(false);
  });
});

describe('hardening from the #262 review', () => {
  // #274：「GitHub 拒绝时站内角色不变」这条用例测的 githubSigninPlan/recordGithubDenied 已经随组织门槛一起删掉
  // （SPEC §3.2，不再查 GitHub 组织），等价覆盖搬到了「GitHub sign-in: invite optional, no organization check」
  // 的「refuses a disabled account and keeps a recorded site role untouched on repeat sign-in」。
  it('shows a GitHub-linked admin signed in by email as a forum member, not a guest', async () => {
    const { app, mail } = await setup();
    app.services.identity.provisionAccount({ githubId: 900000001, githubLogin: 'fixture-owner', orgRole: 'admin', email: 'owner@example.test' });
    const user = browser(app);
    await user.send('POST', '/auth/email/start', { email: 'owner@example.test' });
    await user.send('POST', '/auth/email/verify', { ...REAL, code: await mail.codeFor('owner@example.test') });
    expect((await user.send('GET', '/api/console/me')).json().titles).toEqual([expect.objectContaining({ id: 'title.site.owner' })]);
    expect((await user.send('GET', '/api/forum/state')).json().state.viewer.kind).toBe('member');
  });

  it('lets only the same browser void an earlier code, so a stranger cannot cancel yours', async () => {
    const { app, db, mail, invite, tick } = await setup();
    invite('yugc-test-2026');
    const victim = browser(app);
    await victim.send('POST', '/auth/email/start', { email: 'v@example.test' });
    const code = await mail.codeFor('v@example.test');
    tick(61_000);
    await browser(app).send('POST', '/auth/email/start', { email: 'v@example.test' });
    expect((await victim.send('POST', '/auth/email/verify', { ...REAL, code, invite_code: 'yugc-test-2026' })).statusCode).toBe(200);

    const me = browser(app);
    await me.send('POST', '/auth/email/start', { email: 'w@example.test' });
    tick(61_000);
    await me.send('POST', '/auth/email/start', { email: 'w@example.test' });
    const used = db.prepare('SELECT used_at IS NOT NULL AS used FROM email_challenges WHERE email = ? ORDER BY created_at').all('w@example.test');
    expect(used).toEqual([{ used: 1 }, { used: 0 }]);
    expect((await me.send('POST', '/auth/email/verify', { ...REAL, code: await mail.codeFor('w@example.test', 2), invite_code: 'yugc-test-2026' })).statusCode).toBe(200);
  });

  it('rate-limits both Google endpoints', async () => {
    const { app } = await setup({ env: GOOGLE_ENV });
    const callback = [];
    for (let i = 0; i < 11; i++) callback.push((await app.inject('/auth/google/callback')).statusCode);
    expect(callback).toEqual([...Array(10).fill(400), 429]);
    const start = [];
    for (let i = 0; i < 21; i++) start.push((await app.inject('/auth/google')).statusCode);
    expect(start).toEqual([...Array(20).fill(302), 429]);
  });

  it('keeps the password throttle working for new addresses when its table is full', () => {
    const throttle = createLoginThrottle();
    for (let i = 0; i < 5000; i++) throttle.take(`filler-${i}@example.test`);
    expect(throttle.take('real@example.test')).toBe(true);
    for (let i = 0; i < 9; i++) throttle.take('real@example.test');
    expect(throttle.take('real@example.test')).toBe(false);
  });

  it('keeps OAuth codes and invite codes in /auth query strings out of request logs', () => {
    expect(requestLogFields({ method: 'GET', url: '/auth/google?invite=spring-2027&return_to=%2F', host: 'example.test', ip: '203.0.113.9' }))
      .toEqual({ method: 'GET', url: '/auth/google', host: 'example.test', remoteAddress: '203.0.113.9', remotePort: undefined });
    expect(requestLogFields({ method: 'GET', url: '/auth/callback?code=abc&state=xyz' }).url).toBe('/auth/callback');
    expect(requestLogFields({ method: 'GET', url: '/api/console/audit?limit=5' }).url).toBe('/api/console/audit?limit=5');
  });
});

describe('Google link (#291)', () => {
  const countUsers = (db: ReturnType<typeof testAppDb>) => (db.prepare('SELECT COUNT(*) AS n FROM users').get() as { n: number }).n;
  type Db = Awaited<ReturnType<typeof setup>>['db'];
  const testAppDb = (db: Db) => db;
  const googleRows = (db: Db) => db.prepare("SELECT user_id, provider_uid, email, email_verified, last_login_at FROM identities WHERE provider = 'google' ORDER BY created_at").all();
  const events = (db: Db, action: string) => db.prepare('SELECT user_id, provider, result, reason FROM identity_audit WHERE action = ?').all(action);

  /** 已登录的人：用 GitHub 身份签一个会话（刚签出来，算刚登录过）。 */
  function signedIn(app: FastifyInstance, login: string, githubId: number) {
    const user = browser(app);
    user.jar.set('sid', signIn(app, login, githubId));
    return user;
  }
  /** 资料窗口的「绑定」：先 POST 拿授权地址，再带着 Google 的回调回来；返回回官网的地址。 */
  async function linkFlow(user: ReturnType<typeof browser>, google: ReturnType<typeof googleStub>, returnTo: string | null = '/?open=profile') {
    const start = await user.send('POST', '/api/identity/link', { provider: 'google', ...(returnTo === null ? {} : { return_to: returnTo }) });
    expect(start.statusCode).toBe(200);
    const location = new URL(start.json().authorize_url);
    expect(location.origin + location.pathname).toBe('https://accounts.google.com/o/oauth2/v2/auth');
    expect(location.searchParams.get('code_challenge_method')).toBe('S256');
    google.setNonce(location.searchParams.get('nonce')!);
    const back = await user.send('GET', `/auth/google/callback?code=ok&state=${location.searchParams.get('state')}`);
    expect(back.statusCode).toBe(302);
    return String(back.headers.location);
  }
  /** 登录页上的 Google 登录（不是绑定）。 */
  async function googleSignIn(app: FastifyInstance, google: ReturnType<typeof googleStub>) {
    const user = browser(app);
    const start = await user.send('GET', '/auth/google?return_to=%2Fforum%2F');
    const location = new URL(String(start.headers.location));
    google.setNonce(location.searchParams.get('nonce')!);
    const back = await user.send('GET', `/auth/google/callback?code=ok&state=${location.searchParams.get('state')}`);
    return { user, location: String(back.headers.location) };
  }

  it('binds Google to the signed-in account: no new account, same session, and Google sign-in then lands in it', async () => {
    const google = googleStub();
    const { app, db } = await setup({ env: GOOGLE_ENV, google });
    const alice = signedIn(app, 'alice', 1001);
    const aliceId = accountIdOf(app, 'alice');
    const sid = alice.jar.get('sid');
    expect(countUsers(db)).toBe(1);

    expect(await linkFlow(alice, google)).toBe('https://example.test/?open=profile&link=linked&provider=google');
    expect(countUsers(db)).toBe(1);
    expect(googleRows(db)).toEqual([{ user_id: aliceId, provider_uid: 'google-sub-1', email: 'g.user@example.test', email_verified: 1, last_login_at: null }]);
    expect(alice.jar.get('sid')).toBe(sid);
    expect((await alice.send('GET', '/auth/me')).json().account_id).toBe(aliceId);
    expect(activityRows(app, { action: 'auth.link' })).toMatchObject([{ account_id: aliceId, outcome: 'ok', meta: { provider: 'google' } }]);
    expect(events(db, 'link')).toEqual([{ user_id: aliceId, provider: 'google', result: 'ok', reason: null }]);
    // 授权地址的 sub、邮箱不写进操作记录
    expect(JSON.stringify(activityRows(app, { action: 'auth.link' }))).not.toMatch(/google-sub-1|gmail/);
    expect((await alice.send('GET', '/api/identity/me')).json().identities).toEqual(expect.arrayContaining([expect.objectContaining({ provider: 'google' })]));

    // 以后用 Google 登录，进的就是这个账号，没有多出账号
    const again = await googleSignIn(app, google);
    expect((await again.user.send('GET', '/auth/me')).json().account_id).toBe(aliceId);
    expect(countUsers(db)).toBe(1);
  });

  it('keeps /auth/google a sign-in: an unknown Google account still becomes a new account, which is why the profile window must not link to it (#291 repro)', async () => {
    const google = googleStub();
    const { app, db } = await setup({ env: GOOGLE_ENV, google });
    const alice = signedIn(app, 'alice', 1001);
    const aliceId = accountIdOf(app, 'alice');
    // 资料窗口原来的「绑定」就是这条链接：已登录的人走完 Google 授权，得到的是另一个账号和新会话，原来的账号没有绑上 Google
    const start = await alice.send('GET', '/auth/google?return_to=%2F');
    const location = new URL(String(start.headers.location));
    google.setNonce(location.searchParams.get('nonce')!);
    await alice.send('GET', `/auth/google/callback?code=ok&state=${location.searchParams.get('state')}`);
    expect(countUsers(db)).toBe(2);
    expect((await alice.send('GET', '/auth/me')).json().account_id).not.toBe(aliceId);
    expect(googleRows(db)).toMatchObject([{ provider_uid: 'google-sub-1' }]);
    expect(googleRows(db)).not.toMatchObject([{ user_id: aliceId }]);
  });

  it('refuses a Google account that already belongs to another account, without creating or switching anything', async () => {
    const google = googleStub();
    const { app, db } = await setup({ env: GOOGLE_ENV, google });
    const bob = await googleSignIn(app, google);
    const bobId = (await bob.user.send('GET', '/auth/me')).json().account_id;
    const alice = signedIn(app, 'alice', 1001);
    const aliceId = accountIdOf(app, 'alice');
    const sid = alice.jar.get('sid');
    expect(countUsers(db)).toBe(2);

    expect(await linkFlow(alice, google)).toBe('https://example.test/?open=profile&link=conflict&provider=google');
    expect(countUsers(db)).toBe(2);
    expect(googleRows(db)).toMatchObject([{ user_id: bobId, provider_uid: 'google-sub-1' }]);
    expect(alice.jar.get('sid')).toBe(sid);
    expect((await alice.send('GET', '/auth/me')).json().account_id).toBe(aliceId);
    expect(events(db, 'link_conflict')).toEqual([{ user_id: aliceId, provider: 'google', result: 'denied', reason: 'identity_conflict' }]);
    expect(activityRows(app, { action: 'auth.link' })).toEqual([]);
  });

  it('does not start a second binding when the account already has Google, and a stale second authorization is refused', async () => {
    const google = googleStub();
    const { app, db } = await setup({ env: GOOGLE_ENV, google });
    const alice = signedIn(app, 'alice', 1001);
    // 先发起两次授权（两个标签页），第一次绑好以后第二次回来：本账号已经有 Google
    const first = new URL((await alice.send('POST', '/api/identity/link', { provider: 'google' })).json().authorize_url);
    const cookieOfFirst = alice.jar.get('google_oauth_state')!;
    const second = new URL((await alice.send('POST', '/api/identity/link', { provider: 'google' })).json().authorize_url);
    const cookieOfSecond = alice.jar.get('google_oauth_state')!;
    expect(cookieOfFirst).not.toBe(cookieOfSecond);
    google.setNonce(second.searchParams.get('nonce')!);
    expect(String((await alice.send('GET', `/auth/google/callback?code=ok&state=${second.searchParams.get('state')}`)).headers.location)).toBe('https://example.test/account?link=linked&provider=google');
    // 已经绑了：再发起直接 409，不去 Google
    const third = await alice.send('POST', '/api/identity/link', { provider: 'google' });
    expect(third.statusCode).toBe(409);
    expect(third.json().error).toBe('identity_exists');
    // 第一次的授权（另一个 Google 账号）这时才回来：本账号已有 Google，拒绝
    alice.jar.set('google_oauth_state', cookieOfFirst);
    google.claims.sub = 'google-sub-2';
    google.claims.email = 'second@example.test';
    google.setNonce(first.searchParams.get('nonce')!);
    expect(String((await alice.send('GET', `/auth/google/callback?code=ok&state=${first.searchParams.get('state')}`)).headers.location)).toBe('https://example.test/account?link=exists&provider=google');
    expect(googleRows(db)).toMatchObject([{ provider_uid: 'google-sub-1' }]);
  });

  it('wants a login and a recent sign-in, and is absent without Google credentials', async () => {
    const google = googleStub();
    const { app, db } = await setup({ env: GOOGLE_ENV, google });
    expect((await app.inject({ method: 'POST', url: '/api/identity/link', payload: { provider: 'google' }, headers: { origin: 'https://example.test' } })).statusCode).toBe(401);
    const alice = signedIn(app, 'alice', 1001);
    // 登录超过 10 分钟：和绑定邮箱一样要求重新登录，不发起授权
    db.prepare('UPDATE sessions SET created_at = ? WHERE login = ?').run(Date.now() - 11 * 60_000, 'alice');
    const stale = await alice.send('POST', '/api/identity/link', { provider: 'google' });
    expect(stale.statusCode).toBe(403);
    expect(stale.json().error).toBe('step_up_required');
    expect(alice.jar.has('google_oauth_state')).toBe(false);
    expect(googleRows(db)).toEqual([]);

    const bare = await setup();
    const bobSid = signIn(bare.app, 'bob', 1002);
    const response = await bare.app.inject({ method: 'POST', url: '/api/identity/link', payload: { provider: 'google' }, headers: { cookie: `sid=${bobSid}`, origin: 'https://example.test' } });
    expect(response.statusCode).toBe(404);
    expect(response.json().error).toBe('provider_not_enabled');
  });

  it('only completes in the session that started it, and a cancelled or tampered authorization binds nothing', async () => {
    const google = googleStub();
    const { app, db } = await setup({ env: GOOGLE_ENV, google });
    const alice = signedIn(app, 'alice', 1001);
    const start = new URL((await alice.send('POST', '/api/identity/link', { provider: 'google' })).json().authorize_url);
    google.setNonce(start.searchParams.get('nonce')!);
    // 授权过程中换成了另一个账号：带着发起时的 cookie，会话却是 carol 的
    const carol = signedIn(app, 'carol', 1003);
    carol.jar.set('google_oauth_state', alice.jar.get('google_oauth_state')!);
    expect(String((await carol.send('GET', `/auth/google/callback?code=ok&state=${start.searchParams.get('state')}`)).headers.location)).toBe('https://example.test/account?link=failed&provider=google');
    expect(googleRows(db)).toEqual([]);
    // 回调里的 state 被改过
    const tampered = await alice.send('GET', '/auth/google/callback?code=ok&state=not-the-state');
    expect(tampered.statusCode).toBe(400);
    expect(googleRows(db)).toEqual([]);
    // 在 Google 那边点了取消：回官网原来的账号，不去登录页
    const cancelled = new URL((await alice.send('POST', '/api/identity/link', { provider: 'google' })).json().authorize_url);
    const back = await alice.send('GET', `/auth/google/callback?error=access_denied&state=${cancelled.searchParams.get('state')}`);
    expect(String(back.headers.location)).toBe('https://example.test/account?link=cancelled&provider=google');
    expect(googleRows(db)).toEqual([]);
    expect(countUsers(db)).toBe(2);
    // 登录用的授权不能当绑定用：登录流程的 state 没有账号和会话，这个 cookie 在绑定回调里不会被当成绑定
    const signinStart = await alice.send('GET', '/auth/google?return_to=%2F');
    const signinState = new URL(String(signinStart.headers.location)).searchParams.get('state');
    expect(signinState).toBeTruthy();
  });

  it('returns to /account when the caller names no page, and refuses return_to outside this site', async () => {
    const google = googleStub();
    const { app, db } = await setup({ env: GOOGLE_ENV, google });
    const alice = signedIn(app, 'alice', 1001);
    expect(await linkFlow(alice, google, null)).toBe('https://example.test/account?link=linked&provider=google');
    expect(googleRows(db)).toHaveLength(1);
    const bob = signedIn(app, 'bob', 1002);
    google.claims.sub = 'google-sub-bob';
    expect(await linkFlow(bob, google, 'https://evil.example/steal')).toBe('https://example.test/account?link=linked&provider=google');
  });

  it('only knows how to bind Google', async () => {
    const google = googleStub();
    const { app } = await setup({ env: GOOGLE_ENV, google });
    const alice = signedIn(app, 'alice', 1001);
    for (const body of [{ provider: 'github' }, { provider: 'email' }, {}, { provider: 'google', return_to: 5 }]) {
      const response = await alice.send('POST', '/api/identity/link', body);
      expect(response.statusCode, JSON.stringify(body)).toBe(400);
    }
    expect(alice.jar.has('google_oauth_state')).toBe(false);
  });

  it('rate-limits binding per account: ten starts a minute, and another account is not affected', async () => {
    const google = googleStub();
    const { app } = await setup({ env: GOOGLE_ENV, google });
    const alice = signedIn(app, 'alice', 1001);
    const statuses = [];
    for (let i = 0; i < 11; i++) statuses.push((await alice.send('POST', '/api/identity/link', { provider: 'google' })).statusCode);
    expect(statuses).toEqual([...Array(10).fill(200), 429]);
    const bob = signedIn(app, 'bob', 1002);
    expect((await bob.send('POST', '/api/identity/link', { provider: 'google' })).statusCode).toBe(200);
  });
});

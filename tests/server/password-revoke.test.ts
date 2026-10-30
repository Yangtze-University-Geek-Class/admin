import { createHash, generateKeyPairSync, randomBytes } from 'node:crypto';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { FastifyInstance, LightMyRequestResponse } from 'fastify';
import type { ServiceOverrides } from '../../app/server/src/services';
import { DEVICE_GRANT_TYPE } from '../../app/server/src/lib/device-store';
import { accountIdOf, activityRows, grantPermGroup, signIn as signInGithub, testApp } from './helpers';

/**
 * 改密码（POST /api/identity/password）和重设密码（POST /auth/email/reset）成功后，吊销这个账号的命令行令牌（gk_，
 * device_grants）、尚未兑换的设备授权，以及对外授权（oauth_grants 和 oidc-provider 为它发出的授权与访问令牌，oidc_payloads）（#332）。
 * 吊销和改密码在同一个事务里：吊销抛错，密码不变、令牌仍有效。被拒绝的改密码或重设（当前密码不对、缺少重新验证、验证码错或过期）
 * 什么都不吊销。本站的其它会话按原规则作废，当前这次照常可用；别的账号的令牌和授权不受影响。
 * 邮件发信商与 OIDC 往返都是本地的。
 */
const ORIGIN = 'https://example.test';
const CALLBACK = 'https://git.example.test/users/auth/openid_connect/callback';
const MAIL_ENV = { MAIL_RESEND_API_KEY: 're_test_resend_key_value', MAIL_RESEND_FROM: 'notify@example.test', MAIL_RECIPIENTS: 'all' };
const { privateKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
const JWKS = JSON.stringify({ keys: [{ ...privateKey.export({ format: 'jwk' }), kid: 'test-key', use: 'sig', alg: 'RS256' }] });

const contexts: Awaited<ReturnType<typeof testApp>>[] = [];
afterEach(async () => { vi.restoreAllMocks(); for (const context of contexts.splice(0)) await context.close(); });

/** 假的发信商：记下每封信，验证码从正文里取（和 signin-methods.test.ts 的 mailbox 一样）。 */
function mailbox() {
  const letters: { to: string; text: string }[] = [];
  const fetch = (async (_url: string, init: { body: string }) => {
    const body = JSON.parse(init.body) as { to: string[]; text: string };
    letters.push({ to: body.to[0], text: body.text });
    return new Response(JSON.stringify({ id: `mail-${letters.length}` }), { status: 200, headers: { 'Content-Type': 'application/json' } });
  }) as unknown as ServiceOverrides['mailFetch'];
  /** 发信不阻塞响应：等这个地址收到信 */
  async function codeFor(to: string): Promise<string> {
    for (let i = 0; i < 200; i++) {
      const mine = letters.filter(letter => letter.to === to);
      if (mine.length) return /\b(\d{6})\b/.exec(mine[mine.length - 1].text)![1];
      await new Promise(resolve => setTimeout(resolve, 5));
    }
    throw new Error(`no letter for ${to}`);
  }
  return { fetch, codeFor };
}

/** 时钟可以往后拨：验证码过期的用例用它；默认和真实时间一致。 */
async function setup() {
  const mail = mailbox();
  const time = { offset: 0 };
  const context = await testApp({ mailFetch: mail.fetch, clock: () => Date.now() + time.offset }, false, { ...MAIL_ENV, OIDC_JWKS: JWKS });
  contexts.push(context);
  const { clientSecret } = context.app.services.oidcStore.registerClient({ name: 'GitLab', clientId: 'gitlab', redirectUris: [CALLBACK] });
  return { ...context, mail, clientSecret, time };
}

/** 一个能用命令行和对外授权的账号：GitHub 登录建的、绑好登录邮箱、是极客班成员（对外授权只发给成员）。 */
function account(app: FastifyInstance, login: string, githubId: number, email: string) {
  const sid = signInGithub(app, login, githubId);
  const accountId = accountIdOf(app, login);
  const linked = app.services.identity.linkEmail({ accountId, email, login, claim: () => true });
  if (!linked.ok) throw new Error(`link failed for ${login}: ${linked.reason}`);
  grantPermGroup(app, accountId, 'level.member');
  return { sid, accountId };
}

/** 发设备授权码并在账号页批准，返回 device_code；令牌之后再换。 */
async function approveDevice(app: FastifyInstance, sid: string): Promise<string> {
  const code = (await app.inject({
    method: 'POST', url: '/auth/device/code',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    payload: new URLSearchParams({ client_id: 'geek-cli', scope: 'openid profile forum apply competition repo' }).toString(),
  })).json();
  const approved = await app.inject({
    method: 'POST', url: '/api/identity/device/approve',
    headers: { cookie: `sid=${sid}`, 'content-type': 'application/json' },
    payload: { user_code: code.user_code, decision: 'approve' },
  });
  expect(approved.statusCode).toBe(200);
  return code.device_code as string;
}

/** 用 device_code 轮询一次换令牌：成功返回 access_token，否则返回 error。 */
async function redeem(app: FastifyInstance, deviceCode: string): Promise<{ access_token?: string; error?: string }> {
  return (await app.inject({
    method: 'POST', url: '/auth/device/token',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    payload: new URLSearchParams({ grant_type: DEVICE_GRANT_TYPE, device_code: deviceCode, client_id: 'geek-cli' }).toString(),
  })).json();
}

/** 走完设备授权拿一个 gk_ 令牌，和 geek login 拿到的是同一种。 */
async function cliToken(app: FastifyInstance, sid: string): Promise<string> {
  const token = await redeem(app, await approveDevice(app, sid));
  expect(token.access_token).toMatch(/^gk_/);
  return token.access_token as string;
}

const cliStatus = (app: FastifyInstance, token: string) =>
  app.inject({ url: '/auth/device/userinfo', headers: { authorization: `Bearer ${token}` } }).then(response => response.statusCode);
const apiStatus = (app: FastifyInstance, token: string) =>
  app.inject({ url: '/api/console/me', headers: { authorization: `Bearer ${token}` } }).then(response => response.statusCode);
const oidcStatus = (app: FastifyInstance, token: string) =>
  app.inject({ url: '/oidc/me', headers: { authorization: `Bearer ${token}` } }).then(response => response.statusCode);
const signedIn = (app: FastifyInstance, sid: string) =>
  app.inject({ url: '/auth/me', headers: { cookie: `sid=${sid}` } }).then(response => response.json().signed_in as boolean);

/** 新签发的 sid（重设密码、登录成功时 Set-Cookie 里的那一个）。 */
function sidFrom(response: LightMyRequestResponse): string {
  const raw = ([] as string[]).concat(response.headers['set-cookie'] ?? []).find(line => line.startsWith('sid='));
  if (!raw) throw new Error('no sid cookie');
  return raw.slice('sid='.length).split(';')[0];
}

/** 浏览器罐子：按路径记 cookie（oidc-provider 的交互 cookie 只在 /oidc/interaction/<uid> 下有效）。 */
class Jar {
  private cookies = new Map<string, { name: string; value: string; path: string }>();
  store(res: LightMyRequestResponse) {
    const raw = res.headers['set-cookie'];
    for (const line of (Array.isArray(raw) ? raw : raw ? [raw] : [])) {
      const [pair, ...attributes] = line.split(';').map(part => part.trim());
      const at = pair.indexOf('=');
      const name = pair.slice(0, at);
      const value = pair.slice(at + 1);
      const path = attributes.find(item => item.toLowerCase().startsWith('path='))?.slice(5) ?? '/';
      const expired = attributes.some(item => /^max-age=0$/i.test(item) || /^expires=thu, 01 jan 1970/i.test(item));
      const key = `${name};${path}`;
      if (expired || !value) this.cookies.delete(key);
      else this.cookies.set(key, { name, value, path });
    }
  }
  set(name: string, value: string) { this.cookies.set(`${name};/`, { name, value, path: '/' }); }
  header(url: string) {
    const path = new URL(url, ORIGIN).pathname;
    return [...this.cookies.values()]
      .filter(cookie => cookie.path === '/' || path === cookie.path || path.startsWith(`${cookie.path}/`))
      .map(cookie => `${cookie.name}=${cookie.value}`).join('; ');
  }
}

async function visit(app: FastifyInstance, jar: Jar, url: string, method: 'GET' | 'POST' = 'GET') {
  const target = new URL(url, ORIGIN);
  const res = await app.inject({
    method, url: target.pathname + target.search,
    headers: { cookie: jar.header(target.pathname), ...(method === 'POST' ? { origin: ORIGIN } : {}) },
  });
  jar.store(res);
  return res;
}

/** 从授权请求一路跟到回调或授权页（最多 8 跳）。 */
async function follow(app: FastifyInstance, jar: Jar, url: string) {
  let res = await visit(app, jar, url);
  for (let hops = 0; hops < 8; hops++) {
    const location = res.headers.location as string | undefined;
    if (res.statusCode !== 303 && res.statusCode !== 302) throw new Error(`stopped at ${res.statusCode} ${url}`);
    if (!location) throw new Error('redirect without location');
    if (location.startsWith(CALLBACK) || location.startsWith('/authorize?uid=')) return { location, consentUid: location.startsWith('/authorize?uid=') ? new URLSearchParams(location.split('?')[1]).get('uid') : null };
    res = await visit(app, jar, location);
  }
  throw new Error('too many redirects');
}

/** 授权码 + PKCE 走完整往返，换出访问令牌；consented 为 true 表示这一次跳到了授权页（要重新同意）。 */
async function oidcAuthorize(app: FastifyInstance, jar: Jar, secret: string) {
  const verifier = randomBytes(32).toString('base64url');
  const challenge = createHash('sha256').update(verifier).digest('base64url');
  const query = new URLSearchParams({ client_id: 'gitlab', response_type: 'code', scope: 'openid profile', redirect_uri: CALLBACK, state: 'state-1', nonce: 'nonce-1', code_challenge: challenge, code_challenge_method: 'S256' });
  const first = await follow(app, jar, `/oidc/auth?${query}`);
  let location = first.location;
  if (first.consentUid) {
    const confirmed = await app.inject({
      method: 'POST', url: `/oidc/interaction/${first.consentUid}/confirm`,
      headers: { cookie: jar.header(`/oidc/interaction/${first.consentUid}/confirm`), origin: ORIGIN },
    });
    jar.store(confirmed);
    location = (await follow(app, jar, confirmed.json().redirect_to)).location;
  }
  const code = new URL(location!, ORIGIN).searchParams.get('code')!;
  const exchanged = await app.inject({
    method: 'POST', url: '/oidc/token',
    headers: { 'content-type': 'application/x-www-form-urlencoded', authorization: `Basic ${Buffer.from(`gitlab:${secret}`).toString('base64')}` },
    payload: new URLSearchParams({ grant_type: 'authorization_code', code, redirect_uri: CALLBACK, code_verifier: verifier }).toString(),
  });
  expect(exchanged.statusCode).toBe(200);
  return { accessToken: exchanged.json().access_token as string, consented: Boolean(first.consentUid) };
}

/** 一个账号的两样凭据：命令行令牌和对外授权的访问令牌，以及它的浏览器罐子（重新同意时用）。 */
type Creds = { cli: string; oidc: string; jar: Jar };
async function credentials(app: FastifyInstance, who: { sid: string }, secret: string): Promise<Creds> {
  const jar = new Jar();
  jar.set('sid', who.sid);
  const cli = await cliToken(app, who.sid);
  const oidc = (await oidcAuthorize(app, jar, secret)).accessToken;
  return { cli, oidc, jar };
}

/** [/api/console/me, /auth/device/userinfo, /oidc/me] 三处的状态码：凭据还能用时都是 200，吊销后都是 401。 */
async function statuses(app: FastifyInstance, creds: Creds) {
  return [await apiStatus(app, creds.cli), await cliStatus(app, creds.cli), await oidcStatus(app, creds.oidc)];
}

/** 账号页改密码：`currentPassword` 只在会话超过 10 分钟时才需要。 */
function changePassword(app: FastifyInstance, sid: string, password: string, currentPassword?: string) {
  return app.inject({
    method: 'POST', url: '/api/identity/password',
    headers: { cookie: `sid=${sid}`, origin: ORIGIN, 'content-type': 'application/json' },
    payload: currentPassword === undefined ? { password } : { password, current_password: currentPassword },
  });
}

/** 把会话的登录时间拨到 20 分钟前：之后改密码要求重新核对当前密码（step-up）。 */
function ageSession(app: FastifyInstance, sid: string) {
  app.services.storage.db.prepare('UPDATE sessions SET created_at = ? WHERE id = ?').run(Date.now() - 20 * 60_000, sid);
}

/** 忘了密码：没有 sid 的浏览器请求验证码，返回它的挑战 cookie。 */
async function startReset(app: FastifyInstance, email: string): Promise<Jar> {
  const started = await app.inject({
    method: 'POST', url: '/auth/email/start',
    headers: { 'content-type': 'application/json', origin: ORIGIN },
    payload: { email, purpose: 'reset' },
  });
  expect(started.statusCode).toBe(202);
  const forgot = new Jar();
  forgot.store(started);
  return forgot;
}

function resetWith(app: FastifyInstance, forgot: Jar, code: string, password: string) {
  return app.inject({
    method: 'POST', url: '/auth/email/reset',
    headers: { cookie: forgot.header('/auth/email/reset'), origin: ORIGIN, 'content-type': 'application/json' },
    payload: { code, password },
  });
}

const revokedRows = (app: FastifyInstance) =>
  activityRows(app, { action: 'auth.credentials_revoked' }).map(row => ({ outcome: row.outcome, meta: row.meta }));

describe('改密码、重设密码后吊销命令行令牌与对外授权（#332）', () => {
  it('a password change revokes this account\'s gk_ tokens and OIDC authorizations, and keeps this session and other accounts', async () => {
    const { app, clientSecret } = await setup();
    const alice = account(app, 'alice', 101, 'alice@example.test');
    const bob = account(app, 'bob', 202, 'bob@example.test');
    // 另一台设备上的会话：改密码后应当被踢掉（既有行为）
    const stale = signInGithub(app, 'alice', 101);
    const aliceCreds = await credentials(app, alice, clientSecret);
    const bobCreds = await credentials(app, bob, clientSecret);
    expect(await statuses(app, aliceCreds)).toEqual([200, 200, 200]);

    const changed = await changePassword(app, alice.sid, 'a new passphrase here');
    expect(changed.json()).toEqual({ ok: true });

    expect(await statuses(app, aliceCreds)).toEqual([401, 401, 401]);
    expect(await statuses(app, bobCreds)).toEqual([200, 200, 200]);
    expect(await signedIn(app, alice.sid)).toBe(true);
    expect(await signedIn(app, stale)).toBe(false);
    // 授权被吊销后，下次登录同一个应用要重新同意
    expect((await oidcAuthorize(app, aliceCreds.jar, clientSecret)).consented).toBe(true);
    expect(revokedRows(app)).toEqual([{ outcome: 'ok', meta: { sessions: 1, cli_tokens: 1, cli_grants: 0, oidc_grants: 1 } }]);
  });

  it('an emailed-code password reset revokes them the same way, and the session it signs in leaves other accounts alone', async () => {
    const { app, mail, clientSecret } = await setup();
    const alice = account(app, 'alice', 101, 'reset@example.test');
    const bob = account(app, 'bob', 202, 'bob@example.test');
    const aliceCreds = await credentials(app, alice, clientSecret);
    const bobCreds = await credentials(app, bob, clientSecret);
    expect(await statuses(app, aliceCreds)).toEqual([200, 200, 200]);
    expect(await statuses(app, bobCreds)).toEqual([200, 200, 200]);

    const forgot = await startReset(app, 'reset@example.test');
    const reset = await resetWith(app, forgot, await mail.codeFor('reset@example.test'), 'new passphrase here');
    expect(reset.statusCode).toBe(200);
    const newSid = sidFrom(reset);

    expect(await statuses(app, aliceCreds)).toEqual([401, 401, 401]);
    expect(await statuses(app, bobCreds)).toEqual([200, 200, 200]);
    expect(await signedIn(app, alice.sid)).toBe(false);
    expect(await signedIn(app, newSid)).toBe(true);
    expect(revokedRows(app)).toEqual([{ outcome: 'ok', meta: { sessions: 1, cli_tokens: 1, cli_grants: 0, oidc_grants: 1 } }]);
  });

  it('a device code approved before the change cannot be redeemed after it', async () => {
    const { app } = await setup();
    const alice = account(app, 'alice', 101, 'alice@example.test');
    expect((await changePassword(app, alice.sid, 'first passphrase here')).json()).toEqual({ ok: true });
    // 已批准、还没换令牌：攻击者可以在改密码之前先让账号批准一个设备码
    const deviceCode = await approveDevice(app, alice.sid);
    const before = revokedRows(app).length;

    expect((await changePassword(app, alice.sid, 'a new passphrase here')).json()).toEqual({ ok: true });

    const redeemed = await redeem(app, deviceCode);
    expect(redeemed.access_token).toBeUndefined();
    expect(redeemed.error).toBe('expired_token');
    expect(revokedRows(app).slice(before)).toEqual([{ outcome: 'ok', meta: { sessions: 0, cli_tokens: 0, cli_grants: 1, oidc_grants: 0 } }]);
  });

  it('a wrong current password changes nothing', async () => {
    const { app, clientSecret } = await setup();
    const alice = account(app, 'alice', 101, 'alice@example.test');
    expect((await changePassword(app, alice.sid, 'first passphrase here')).json()).toEqual({ ok: true });
    const creds = await credentials(app, alice, clientSecret);
    const hash = app.services.identity.passwordHashOf(alice.accountId);
    const before = revokedRows(app).length;
    ageSession(app, alice.sid);

    const res = await changePassword(app, alice.sid, 'a new passphrase here', 'not the current one');
    expect(res.statusCode).toBe(400);
    expect(res.json().error).toBe('invalid_credentials');
    expect(app.services.identity.passwordHashOf(alice.accountId)).toBe(hash);
    expect(await statuses(app, creds)).toEqual([200, 200, 200]);
    expect(revokedRows(app)).toHaveLength(before);
  });

  it('a change that needs step-up and gets no current password changes nothing', async () => {
    const { app, clientSecret } = await setup();
    const alice = account(app, 'alice', 101, 'alice@example.test');
    expect((await changePassword(app, alice.sid, 'first passphrase here')).json()).toEqual({ ok: true });
    const creds = await credentials(app, alice, clientSecret);
    const hash = app.services.identity.passwordHashOf(alice.accountId);
    const before = revokedRows(app).length;
    ageSession(app, alice.sid);

    const res = await changePassword(app, alice.sid, 'a new passphrase here');
    expect(res.statusCode).toBe(403);
    expect(res.json().error).toBe('step_up_required');
    expect(app.services.identity.passwordHashOf(alice.accountId)).toBe(hash);
    expect(await statuses(app, creds)).toEqual([200, 200, 200]);
    expect(revokedRows(app)).toHaveLength(before);
  });

  it('a wrong emailed code changes nothing', async () => {
    const { app, mail, clientSecret } = await setup();
    const alice = account(app, 'alice', 101, 'reset@example.test');
    const creds = await credentials(app, alice, clientSecret);
    const forgot = await startReset(app, 'reset@example.test');
    const code = await mail.codeFor('reset@example.test');

    const res = await resetWith(app, forgot, code === '000000' ? '999999' : '000000', 'new passphrase here');
    expect(res.statusCode).toBe(400);
    expect(res.json().error).toBe('invalid_code');
    expect(app.services.identity.passwordHashOf(alice.accountId)).toBeNull();
    expect(await statuses(app, creds)).toEqual([200, 200, 200]);
    expect(revokedRows(app)).toHaveLength(0);
  });

  it('an expired emailed code changes nothing', async () => {
    const { app, mail, clientSecret, time } = await setup();
    const alice = account(app, 'alice', 101, 'reset@example.test');
    const creds = await credentials(app, alice, clientSecret);
    const forgot = await startReset(app, 'reset@example.test');
    const code = await mail.codeFor('reset@example.test');
    // 验证码 10 分钟过期；拨 15 分钟，访问令牌（1 小时）和命令行令牌（30 天）仍然有效，只有验证码过期这一条原因
    time.offset = 15 * 60_000;

    const res = await resetWith(app, forgot, code, 'new passphrase here');
    expect(res.statusCode).toBe(400);
    expect(res.json().error).toBe('code_expired');
    expect(app.services.identity.passwordHashOf(alice.accountId)).toBeNull();
    expect(await statuses(app, creds)).toEqual([200, 200, 200]);
    expect(revokedRows(app)).toHaveLength(0);
  });

  it('when the revocation throws, the password change is rolled back and every credential still works', async () => {
    const { app, clientSecret } = await setup();
    const alice = account(app, 'alice', 101, 'alice@example.test');
    expect((await changePassword(app, alice.sid, 'first passphrase here')).json()).toEqual({ ok: true });
    const stale = signInGithub(app, 'alice', 101);
    const creds = await credentials(app, alice, clientSecret);
    const hash = app.services.identity.passwordHashOf(alice.accountId);
    const before = revokedRows(app).length;
    vi.spyOn(app.services.device, 'revokeAccountTokens').mockImplementation(() => { throw new Error('injected: token store down'); });

    const res = await changePassword(app, alice.sid, 'a new passphrase here');
    expect(res.statusCode).toBe(500);
    expect(app.services.identity.passwordHashOf(alice.accountId)).toBe(hash);
    expect(await statuses(app, creds)).toEqual([200, 200, 200]);
    // 会话删除在吊销令牌之前执行，也必须一起回滚
    expect(await signedIn(app, stale)).toBe(true);
    expect(await signedIn(app, alice.sid)).toBe(true);
    expect(revokedRows(app)).toHaveLength(before);
  });

  it('when the revocation throws, the reset is rolled back and the emailed code can still be used', async () => {
    const { app, mail, clientSecret } = await setup();
    const alice = account(app, 'alice', 101, 'reset@example.test');
    const creds = await credentials(app, alice, clientSecret);
    const forgot = await startReset(app, 'reset@example.test');
    const code = await mail.codeFor('reset@example.test');
    const failing = vi.spyOn(app.services.oidcStore, 'revokeAccountGrants').mockImplementation(() => { throw new Error('injected: grant store down'); });

    const res = await resetWith(app, forgot, code, 'new passphrase here');
    expect(res.statusCode).toBe(500);
    expect(app.services.identity.passwordHashOf(alice.accountId)).toBeNull();
    // 前面两步（会话、令牌）已经做过，也必须一起回滚
    expect(await statuses(app, creds)).toEqual([200, 200, 200]);
    expect(await signedIn(app, alice.sid)).toBe(true);
    expect(revokedRows(app)).toHaveLength(0);

    // 验证码没有被占用：吊销故障修好后，同一个码还能用
    failing.mockRestore();
    expect((await resetWith(app, forgot, code, 'new passphrase here')).statusCode).toBe(200);
    expect(await statuses(app, creds)).toEqual([401, 401, 401]);
  });
});

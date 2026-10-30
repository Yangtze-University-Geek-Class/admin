import { createHash, generateKeyPairSync, randomBytes } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { FastifyInstance, LightMyRequestResponse } from 'fastify';
import { OIDC_PROTOCOL_LIMIT } from '../../app/server/src/routes/oidc/index';
import { activityRows, completeProfile, signIn as rawSignIn, testApp } from './helpers';

/**
 * 对外授权只发给成员（lib/account-directory.ts 的 oidcAccount()，#274 按 level.member 判定，不再是
 * 「登录了就算」）：这个文件测的是 OIDC 协议本身，不是成员资格判定，所以登录顺手设成成员，和 #262 之前
 * 「GitHub 组织成员」同义；要测「不是成员」在这之后自己再调一次 setSiteRole('none')。
 */
function signIn(app: FastifyInstance, login: string, githubId: number, avatarUrl: string | null = null): string {
  const sid = rawSignIn(app, login, githubId, avatarUrl);
  app.services.identity.setSiteRole({ accountId: app.services.identity.accountForGithub(githubId)!, role: 'member', actor: 'system' });
  return sid;
}

/**
 * 对外授权（#270，ADR-0005 决策 3、8）：GitLab 这样不同源的应用用极客班账号登录。用 app.inject 走完整的授权码 + PKCE 往返，
 * 自带一个按 Path 区分的 cookie 罐子（oidc-provider 的交互 cookie 只在 /oidc/interaction/<uid> 下有效）。
 */
const { privateKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
const JWKS = JSON.stringify({ keys: [{ ...privateKey.export({ format: 'jwk' }), kid: 'test-key', use: 'sig', alg: 'RS256' }] });
const ORIGIN = 'https://example.test';
const CALLBACK = 'https://git.example.test/users/auth/openid_connect/callback';

const contexts: Awaited<ReturnType<typeof testApp>>[] = [];
afterEach(async () => { for (const context of contexts.splice(0)) await context.close(); });

async function setup(env: Record<string, string> = {}) {
  const context = await testApp({}, false, { OIDC_JWKS: JWKS, ...env });
  contexts.push(context);
  const { client, clientSecret } = context.app.services.oidcStore.registerClient({ name: 'GitLab', clientId: 'gitlab', redirectUris: [CALLBACK] });
  return { ...context, client, clientSecret };
}

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

/** 浏览器那一边：带着罐子里的 cookie 请求，记下回来的 cookie。地址可以是绝对地址（只取路径和查询串）。 */
async function visit(app: FastifyInstance, jar: Jar, url: string, init: { method?: 'GET' | 'POST'; payload?: string; headers?: Record<string, string> } = {}) {
  const target = url.startsWith('http') ? new URL(url) : new URL(url, ORIGIN);
  if (target.origin !== ORIGIN) throw new Error(`browser left the site: ${url}`);
  const res = await app.inject({
    method: init.method ?? 'GET', url: target.pathname + target.search, payload: init.payload,
    headers: { cookie: jar.header(target.pathname), ...(init.method === 'POST' ? { origin: ORIGIN } : {}), ...init.headers },
  });
  jar.store(res);
  return res;
}

const pkce = () => {
  const verifier = randomBytes(32).toString('base64url');
  return { verifier, challenge: createHash('sha256').update(verifier).digest('base64url') };
};

function authorizeUrl(params: Record<string, string>) {
  const query = new URLSearchParams({ client_id: 'gitlab', response_type: 'code', scope: 'openid profile email', redirect_uri: CALLBACK, state: 'state-1', nonce: 'nonce-1', ...params });
  return `/oidc/auth?${query}`;
}

/** 从授权请求一路跟到回调（最多 8 跳）；遇到授权页时返回它的交互 uid。 */
async function follow(app: FastifyInstance, jar: Jar, url: string, callback = CALLBACK) {
  let res = await visit(app, jar, url);
  for (let hops = 0; hops < 8; hops++) {
    const location = res.headers.location as string | undefined;
    if (res.statusCode !== 303 && res.statusCode !== 302) return { res, location: null, consentUid: null };
    if (!location) throw new Error('redirect without location');
    if (location.startsWith(callback) || location.startsWith('/signin') || location.startsWith(`${ORIGIN}/bind-email?`) || location.startsWith(`${ORIGIN}/complete-profile?`)) return { res, location, consentUid: null };
    if (location.startsWith('/authorize?uid=')) return { res, location, consentUid: new URLSearchParams(location.split('?')[1]).get('uid') };
    res = await visit(app, jar, location);
  }
  throw new Error('too many redirects');
}

async function exchange(app: FastifyInstance, code: string, verifier: string, secret: string, redirectUri = CALLBACK) {
  return app.inject({
    method: 'POST', url: '/oidc/token',
    headers: { 'content-type': 'application/x-www-form-urlencoded', authorization: `Basic ${Buffer.from(`gitlab:${secret}`).toString('base64')}` },
    payload: new URLSearchParams({ grant_type: 'authorization_code', code, redirect_uri: redirectUri, code_verifier: verifier }).toString(),
  });
}

const accountOf = (app: FastifyInstance, githubId: number) =>
  (app.services.storage.db.prepare("SELECT user_id FROM identities WHERE provider = 'github' AND provider_uid = ?").get(String(githubId)) as { user_id: string }).user_id;

/** 登录、同意、换令牌一次走完，返回令牌响应与回调里的参数。 */
async function signInThroughGitlab(app: FastifyInstance, jar: Jar, secret: string, redirectUri = CALLBACK) {
  const { verifier, challenge } = pkce();
  const first = await follow(app, jar, authorizeUrl({ code_challenge: challenge, code_challenge_method: 'S256', redirect_uri: redirectUri }), redirectUri);
  let location = first.location;
  if (first.consentUid) {
    const confirmed = await visit(app, jar, `/oidc/interaction/${first.consentUid}/confirm`, { method: 'POST' });
    expect(confirmed.statusCode).toBe(200);
    location = (await follow(app, jar, confirmed.json().redirect_to, redirectUri)).location;
  }
  expect(location?.startsWith(redirectUri)).toBe(true);
  const callback = new URL(location!);
  const token = await exchange(app, callback.searchParams.get('code')!, verifier, secret, redirectUri);
  return { token, callback, verifier, consented: Boolean(first.consentUid) };
}

describe('OIDC provider for downstream apps (#270)', () => {
  it('publishes discovery and public keys under the environment origin', async () => {
    const { app } = await setup();
    const discovery = await app.inject({ url: '/oidc/.well-known/openid-configuration', headers: { 'x-forwarded-proto': 'http', 'x-forwarded-host': 'evil.test' } });
    expect(discovery.statusCode).toBe(200);
    const body = discovery.json();
    expect(body.issuer).toBe(`${ORIGIN}/oidc`);
    expect(body.authorization_endpoint).toBe(`${ORIGIN}/oidc/auth`);
    expect(body.token_endpoint).toBe(`${ORIGIN}/oidc/token`);
    expect(body.userinfo_endpoint).toBe(`${ORIGIN}/oidc/me`);
    expect(body.code_challenge_methods_supported).toEqual(['S256']);
    expect(body.subject_types_supported).toEqual(['pairwise']);
    expect(body.response_types_supported).toEqual(['code']);
    expect(body.registration_endpoint).toBeUndefined();
    expect(body.end_session_endpoint).toBeUndefined();
    const jwks = await app.inject({ url: '/oidc/jwks' });
    expect(jwks.statusCode).toBe(200);
    const [key] = jwks.json().keys;
    expect(key.kid).toBe('test-key');
    expect(key.d).toBeUndefined();
    expect(key.p).toBeUndefined();
  });

  it('sends a visitor without a session to the unified sign-in page and back', async () => {
    const { app } = await setup();
    const jar = new Jar();
    const { challenge } = pkce();
    const result = await follow(app, jar, authorizeUrl({ code_challenge: challenge, code_challenge_method: 'S256' }));
    expect(result.location).toMatch(/^\/signin\?return_to=%2Foidc%2Finteraction%2F[A-Za-z0-9_-]+$/);
  });

  it('signs a member in with consent once, a per-sector sub and one-time codes', async () => {
    const { app, clientSecret } = await setup();
    const sid = signIn(app, 'alice', 101, 'https://avatars.githubusercontent.com/u/101');
    const accountId = accountOf(app, 101);
    const jar = new Jar();
    jar.set('sid', sid);

    const first = await signInThroughGitlab(app, jar, clientSecret);
    expect(first.consented).toBe(true);
    expect(first.callback.searchParams.get('state')).toBe('state-1');
    expect(first.token.statusCode).toBe(200);
    const tokens = first.token.json();
    expect(tokens.refresh_token).toBeUndefined();
    const [, payload] = tokens.id_token.split('.');
    const claims = JSON.parse(Buffer.from(payload, 'base64url').toString());
    const sub = app.services.oidcStore.subjectFor('git.example.test', accountId);
    expect(claims).toMatchObject({ iss: `${ORIGIN}/oidc`, aud: 'gitlab', sub, nonce: 'nonce-1' });
    expect(sub).not.toBe(accountId);
    expect(sub).not.toBe(app.services.oidcStore.subjectFor('other.example.test', accountId));

    const userinfo = await app.inject({ url: '/oidc/me', headers: { authorization: `Bearer ${tokens.access_token}` } });
    expect(userinfo.statusCode).toBe(200);
    expect(userinfo.json()).toEqual({ sub, name: 'alice', preferred_username: 'alice', picture: 'https://avatars.githubusercontent.com/u/101' });

    // 第二次登录：不再问，sub 不变
    const second = await signInThroughGitlab(app, jar, clientSecret);
    expect(second.consented).toBe(false);
    const again = JSON.parse(Buffer.from(second.token.json().id_token.split('.')[1], 'base64url').toString());
    expect(again.sub).toBe(sub);
    const audit = activityRows(app, { actionLike: 'oidc.%' }).map(row => ({ action: row.action, target: row.target_id }));
    expect(audit).toEqual([{ action: 'oidc.consent', target: 'gitlab' }]);

    // 授权码只能用一次；重放时按规范撤销这份授权，它发出的令牌一起失效，下次登录要重新同意
    const replay = await exchange(app, second.callback.searchParams.get('code')!, second.verifier, clientSecret);
    expect(replay.statusCode).toBe(400);
    expect(replay.json().error).toBe('invalid_grant');
    const revoked = await app.inject({ url: '/oidc/me', headers: { authorization: `Bearer ${second.token.json().access_token}` } });
    expect(revoked.statusCode).toBe(401);
    expect((await signInThroughGitlab(app, jar, clientSecret)).consented).toBe(true);
  });

  it('remembers consent in a new browser for the same account', async () => {
    const { app, clientSecret } = await setup();
    const sid = signIn(app, 'alice', 101);
    const jar = new Jar();
    jar.set('sid', sid);
    expect((await signInThroughGitlab(app, jar, clientSecret)).consented).toBe(true);
    const fresh = new Jar();
    fresh.set('sid', sid);
    expect((await signInThroughGitlab(app, fresh, clientSecret)).consented).toBe(false);
  });

  it('returns the verified email only with the email scope', async () => {
    const { app, clientSecret } = await setup();
    const sid = signIn(app, 'alice', 101);
    app.services.storage.db.prepare('UPDATE users SET canonical_email = ? WHERE id = ?').run('alice@example.test', accountOf(app, 101));
    const jar = new Jar();
    jar.set('sid', sid);
    const { token } = await signInThroughGitlab(app, jar, clientSecret);
    const userinfo = await app.inject({ url: '/oidc/me', headers: { authorization: `Bearer ${token.json().access_token}` } });
    expect(userinfo.json()).toMatchObject({ email: 'alice@example.test', email_verified: true });
  });

  it('stops serving userinfo for an already-issued token once the account is disabled (SPEC §3.8：停用后 OIDC 令牌全部失效)', async () => {
    const { app, clientSecret } = await setup();
    const sid = signIn(app, 'alice', 101);
    const accountId = accountOf(app, 101);
    const jar = new Jar();
    jar.set('sid', sid);
    const { token } = await signInThroughGitlab(app, jar, clientSecret);
    const accessToken = token.json().access_token;
    // 停用前，这个令牌还能正常用
    const before = await app.inject({ url: '/oidc/me', headers: { authorization: `Bearer ${accessToken}` } });
    expect(before.statusCode).toBe(200);

    app.services.storage.db.prepare("UPDATE users SET status = 'disabled' WHERE id = ?").run(accountId);
    // findAccount（lib/oidc-provider.ts）经 account-directory.ts 的 oidcAccount() 每次都查 getAccountClaims()，
    // member 需要 status === 'active'；这里把这条既有行为锁进回归测试，停用这个动作本身不用另外去撤销令牌。
    const after = await app.inject({ url: '/oidc/me', headers: { authorization: `Bearer ${accessToken}` } });
    expect(after.statusCode).toBe(401);
  });

  it('refuses an unknown client and a redirect URI that was not registered, without redirecting', async () => {
    const { app } = await setup();
    const jar = new Jar();
    jar.set('sid', signIn(app, 'alice', 101));
    const { challenge } = pkce();
    const unknown = await visit(app, jar, authorizeUrl({ client_id: 'nobody', code_challenge: challenge, code_challenge_method: 'S256' }));
    expect(unknown.statusCode).toBe(400);
    expect(unknown.headers.location).toBeUndefined();
    expect(unknown.body).toContain('invalid_client');
    const wrong = await visit(app, jar, authorizeUrl({ redirect_uri: 'https://git.example.test/elsewhere', code_challenge: challenge, code_challenge_method: 'S256' }));
    expect(wrong.statusCode).toBe(400);
    expect(wrong.headers.location).toBeUndefined();
    expect(wrong.body).toContain('invalid_redirect_uri');
    expect(wrong.body).not.toContain('elsewhere');
  });

  it('requires PKCE and rejects a wrong verifier', async () => {
    const { app, clientSecret } = await setup();
    const jar = new Jar();
    jar.set('sid', signIn(app, 'alice', 101));
    const missing = await visit(app, jar, authorizeUrl({}));
    expect(missing.statusCode).toBe(303);
    const back = new URL(missing.headers.location as string);
    expect(back.origin + back.pathname).toBe(CALLBACK);
    expect(back.searchParams.get('error')).toBe('invalid_request');
    const plain = await visit(app, jar, authorizeUrl({ code_challenge: 'x'.repeat(43), code_challenge_method: 'plain' }));
    expect(new URL(plain.headers.location as string).searchParams.get('error')).toBe('invalid_request');

    const { callback } = await signInThroughGitlab(app, jar, clientSecret);
    // signInThroughGitlab 已经用掉了它的码；再走一次，换令牌时故意给错 verifier
    const { challenge } = pkce();
    const result = await follow(app, jar, authorizeUrl({ code_challenge: challenge, code_challenge_method: 'S256' }));
    const code = new URL(result.location!).searchParams.get('code')!;
    expect(code).not.toBe(callback.searchParams.get('code'));
    const bad = await exchange(app, code, pkce().verifier, clientSecret);
    expect(bad.statusCode).toBe(400);
    expect(bad.json().error).toBe('invalid_grant');
  });

  it('sends an account without a login email to the bind page, resumes the same login after, and holds the consent page until then (#273)', async () => {
    // 能发信的环境才要求登录邮箱；这里不会真的发信
    const { app, clientSecret } = await setup({ MAIL_RESEND_API_KEY: 're_test_resend_key_value', MAIL_RESEND_FROM: 'notify@example.test' });
    const jar = new Jar();
    jar.set('sid', signIn(app, 'alice', 101));
    const accountId = accountOf(app, 101);
    const bind = (email: string) => app.services.identity.linkEmail({ accountId, email, login: 'alice', claim: () => true });
    const { challenge } = pkce();
    const first = await follow(app, jar, authorizeUrl({ code_challenge: challenge, code_challenge_method: 'S256' }));
    expect(first.res.statusCode).toBe(303);
    expect(first.location).toMatch(/^https:\/\/example\.test\/bind-email\?return_to=%2Foidc%2Finteraction%2F[A-Za-z0-9_-]+$/);

    // 绑好邮箱后回到同一个交互，接着去授权页
    expect(bind('alice@example.test')).toEqual({ ok: true });
    const resumed = await follow(app, jar, new URL(first.location!).searchParams.get('return_to')!);
    expect(resumed.consentUid).toMatch(/^[A-Za-z0-9_-]+$/);

    // 授权页读详情和点允许也要有登录邮箱；拒绝不拦
    app.services.storage.db.prepare("DELETE FROM identities WHERE provider = 'email' AND user_id = ?").run(accountId);
    const details = await visit(app, jar, `/oidc/interaction/${resumed.consentUid}/details`);
    expect([details.statusCode, details.json().error]).toEqual([403, 'email_required']);
    const confirm = await visit(app, jar, `/oidc/interaction/${resumed.consentUid}/confirm`, { method: 'POST' });
    expect([confirm.statusCode, confirm.json().error]).toEqual([403, 'email_required']);
    const aborted = await visit(app, jar, `/oidc/interaction/${resumed.consentUid}/abort`, { method: 'POST' });
    expect(aborted.statusCode).toBe(200);
    expect(new URL((await follow(app, jar, aborted.json().redirect_to)).location!).searchParams.get('error')).toBe('access_denied');

    expect(bind('alice@example.test')).toEqual({ ok: true });
    const { token, consented } = await signInThroughGitlab(app, jar, clientSecret);
    expect([token.statusCode, consented]).toEqual([200, true]);

    // 已经允许过、oidc-provider 的会话也还在：没有登录邮箱时同样先去绑定页，不直接发授权码
    app.services.storage.db.prepare("DELETE FROM identities WHERE provider = 'email' AND user_id = ?").run(accountId);
    const again = await follow(app, jar, authorizeUrl({ code_challenge: pkce().challenge, code_challenge_method: 'S256' }));
    expect(again.location).toMatch(/^https:\/\/example\.test\/bind-email\?return_to=%2Foidc%2Finteraction%2F/);
    expect(bind('alice@example.test')).toEqual({ ok: true });
    const back = await follow(app, jar, new URL(again.location!).searchParams.get('return_to')!);
    expect([back.consentUid, back.location?.startsWith(CALLBACK)]).toEqual([null, true]);
  });

  it('sends an account without a name and grade to the profile page, resumes the same login after, and never puts the real name in tokens or userinfo (#280)', async () => {
    const { app, clientSecret } = await setup();
    const jar = new Jar();
    jar.set('sid', signIn(app, 'alice', 101));
    const accountId = accountOf(app, 101);
    app.services.profiles.setRealInfo(accountId, null, null);
    const first = await follow(app, jar, authorizeUrl({ code_challenge: pkce().challenge, code_challenge_method: 'S256' }));
    expect(first.location).toMatch(/^https:\/\/example\.test\/complete-profile\?return_to=%2Foidc%2Finteraction%2F[A-Za-z0-9_-]+$/);

    // 补好姓名和年级后回到同一个交互，接着去授权页；授权页读详情和点允许之前同样要求补齐
    completeProfile(app, accountId, '刘爱丽');
    const resumed = await follow(app, jar, new URL(first.location!).searchParams.get('return_to')!);
    expect(resumed.consentUid).toMatch(/^[A-Za-z0-9_-]+$/);
    app.services.profiles.setRealInfo(accountId, null, null);
    const details = await visit(app, jar, `/oidc/interaction/${resumed.consentUid}/details`);
    expect([details.statusCode, details.json().error]).toEqual([403, 'profile_required']);
    const confirm = await visit(app, jar, `/oidc/interaction/${resumed.consentUid}/confirm`, { method: 'POST' });
    expect([confirm.statusCode, confirm.json().error]).toEqual([403, 'profile_required']);

    completeProfile(app, accountId, '刘爱丽');
    const { token } = await signInThroughGitlab(app, jar, clientSecret);
    expect(token.statusCode).toBe(200);
    const userinfo = await app.inject({ url: '/oidc/me', headers: { authorization: `Bearer ${token.json().access_token}` } });
    expect(userinfo.statusCode).toBe(200);
    const idToken = JSON.parse(Buffer.from(String(token.json().id_token).split('.')[1], 'base64url').toString('utf8'));
    expect(JSON.stringify([userinfo.json(), idToken])).not.toContain('刘爱丽');
  });

  it('turns a denial on the consent page into access_denied for the app', async () => {
    const { app } = await setup();
    const jar = new Jar();
    jar.set('sid', signIn(app, 'alice', 101));
    const { challenge } = pkce();
    const { consentUid } = await follow(app, jar, authorizeUrl({ code_challenge: challenge, code_challenge_method: 'S256' }));
    const details = await visit(app, jar, `/oidc/interaction/${consentUid}/details`);
    expect(details.statusCode).toBe(200);
    expect(details.headers['cache-control']).toBe('no-store');
    expect(details.json()).toMatchObject({ client: { id: 'gitlab', name: 'GitLab', host: 'git.example.test' }, scopes: ['openid', 'profile', 'email'], account: { login: 'alice' } });
    const aborted = await visit(app, jar, `/oidc/interaction/${consentUid}/abort`, { method: 'POST' });
    const { location } = await follow(app, jar, aborted.json().redirect_to);
    expect(new URL(location!).searchParams.get('error')).toBe('access_denied');
    expect(activityRows(app, { action: 'oidc.deny' })).toHaveLength(1);
  });

  it('keeps the consent endpoints to the signed-in account that started the login', async () => {
    const { app } = await setup();
    const jar = new Jar();
    jar.set('sid', signIn(app, 'alice', 101));
    const { challenge } = pkce();
    const { consentUid } = await follow(app, jar, authorizeUrl({ code_challenge: challenge, code_challenge_method: 'S256' }));
    const anonymous = new Jar();
    expect((await visit(app, anonymous, `/oidc/interaction/${consentUid}/details`)).statusCode).toBe(401);
    // 换成别的账号的 sid，但带着这次交互的 cookie
    jar.set('sid', signIn(app, 'bob', 202));
    const other = await visit(app, jar, `/oidc/interaction/${consentUid}/confirm`, { method: 'POST' });
    expect(other.statusCode).toBe(409);
    expect(other.json().error).toBe('interaction_mismatch');
    // 跨站提交被统一的 Origin 检查挡下
    const crossSite = await visit(app, jar, `/oidc/interaction/${consentUid}/confirm`, { method: 'POST', headers: { origin: 'https://evil.test' } });
    expect(crossSite.statusCode).toBe(403);
    // 没有交互 cookie 的浏览器拿不到详情
    const stranger = new Jar();
    stranger.set('sid', signIn(app, 'alice', 101));
    expect((await visit(app, stranger, `/oidc/interaction/${consentUid}/details`)).statusCode).toBe(404);
  });

  it('follows the current site session when the browser switches accounts', async () => {
    const { app, clientSecret } = await setup();
    const jar = new Jar();
    jar.set('sid', signIn(app, 'alice', 101));
    await signInThroughGitlab(app, jar, clientSecret);
    jar.set('sid', signIn(app, 'bob', 202));
    const { token } = await signInThroughGitlab(app, jar, clientSecret);
    const claims = JSON.parse(Buffer.from(token.json().id_token.split('.')[1], 'base64url').toString());
    expect(claims.sub).toBe(app.services.oidcStore.subjectFor('git.example.test', accountOf(app, 202)));
  });

  it('asks for sign-in again after the site session ends', async () => {
    const { app, clientSecret } = await setup();
    const jar = new Jar();
    const sid = signIn(app, 'alice', 101);
    jar.set('sid', sid);
    await signInThroughGitlab(app, jar, clientSecret);
    app.services.auth.destroySession(sid);
    const { challenge } = pkce();
    const result = await follow(app, jar, authorizeUrl({ code_challenge: challenge, code_challenge_method: 'S256' }));
    expect(result.location).toMatch(/^\/signin\?return_to=/);
  });

  it('refuses accounts that are no longer members and their existing tokens', async () => {
    const { app, clientSecret } = await setup();
    const jar = new Jar();
    jar.set('sid', signIn(app, 'alice', 101));
    signIn(app, 'admiral', 1);
    app.services.identity.setSiteRole({ accountId: accountOf(app, 1), role: 'admin', actor: 'system' });
    const { token } = await signInThroughGitlab(app, jar, clientSecret);
    const accessToken = token.json().access_token;
    expect(app.services.identity.setSiteRole({ accountId: accountOf(app, 101), role: 'none', actor: 'system' })).toMatchObject({ ok: true, changed: true });
    const userinfo = await app.inject({ url: '/oidc/me', headers: { authorization: `Bearer ${accessToken}` } });
    expect(userinfo.statusCode).toBe(401);
    const { challenge } = pkce();
    const denied = await follow(app, jar, authorizeUrl({ code_challenge: challenge, code_challenge_method: 'S256' }));
    expect(new URL(denied.location!).searchParams.get('error')).toBe('access_denied');
  });

  it('stops serving a disabled client', async () => {
    const { app } = await setup();
    app.services.oidcStore.setClientStatus('gitlab', 'disabled');
    const jar = new Jar();
    jar.set('sid', signIn(app, 'alice', 101));
    const { challenge } = pkce();
    const res = await visit(app, jar, authorizeUrl({ code_challenge: challenge, code_challenge_method: 'S256' }));
    expect(res.statusCode).toBe(400);
    expect(res.body).toContain('invalid_client');
  });

  it('shows a plain error page for an expired interaction and keeps /oidc closed without keys', async () => {
    const { app } = await setup();
    const jar = new Jar();
    jar.set('sid', signIn(app, 'alice', 101));
    const expired = await visit(app, jar, '/oidc/interaction/AAAAAAAAAAAAAAAAAAAAA');
    expect(expired.statusCode).toBe(400);
    expect(expired.headers['content-type']).toContain('text/html');
    expect(expired.body).toContain('这次登录已经过期');

    const plain = await testApp();
    contexts.push(plain);
    expect((await plain.app.inject({ url: '/oidc/.well-known/openid-configuration' })).statusCode).toBe(404);
  });

  it('logs a provider failure by path, error name and code only', async () => {
    const { app } = await setup();
    const logged = vi.spyOn(app.log, 'error');
    // 签发者的存储坏了：oidc-provider 回 500，日志只记在哪一步、什么错，不带请求里的参数
    app.services.storage.db.exec('ALTER TABLE oidc_payloads RENAME TO oidc_payloads_gone');
    const res = await app.inject({ url: authorizeUrl({ code_challenge: pkce().challenge, code_challenge_method: 'S256' }) });
    app.services.storage.db.exec('ALTER TABLE oidc_payloads_gone RENAME TO oidc_payloads');
    expect(res.statusCode).toBe(500);
    expect(logged).toHaveBeenCalledWith({ path: '/auth', error: 'SqliteError', code: 'SQLITE_ERROR' }, 'oidc server error');
  });

  it('rate-limits the protocol endpoints, server calls and browser redirects apart, and the interaction entry', async () => {
    const { app } = await setup();
    const codes: number[] = [];
    for (let i = 0; i <= OIDC_PROTOCOL_LIMIT.server; i++) codes.push((await app.inject({ url: '/oidc/jwks' })).statusCode);
    expect(codes.slice(0, OIDC_PROTOCOL_LIMIT.server).every(code => code === 200)).toBe(true);
    expect(codes[OIDC_PROTOCOL_LIMIT.server]).toBe(429);
    const limited = await app.inject({ url: '/oidc/token', method: 'POST' });
    expect(limited.statusCode).toBe(429);
    expect(limited.json().error).toBe('rate_limited');
    // 浏览器跳转另算：GitLab 的服务器用完了它的额度，成员照样能从浏览器开始登录
    const browser: number[] = [];
    for (let i = 0; i <= OIDC_PROTOCOL_LIMIT.browser; i++) browser.push((await app.inject({ url: authorizeUrl({ code_challenge: pkce().challenge, code_challenge_method: 'S256' }) })).statusCode);
    expect(browser.slice(0, OIDC_PROTOCOL_LIMIT.browser).every(code => code === 303)).toBe(true);
    expect(browser[OIDC_PROTOCOL_LIMIT.browser]).toBe(429);
    for (let i = 0; i < 30; i++) await app.inject({ url: '/oidc/interaction/AAAAAAAAAAAAAAAAAAAAA' });
    expect((await app.inject({ url: '/oidc/interaction/AAAAAAAAAAAAAAAAAAAAA' })).statusCode).toBe(429);
  });

  it('keeps the sub when GitLab moves its callback to a path on another host, and drops the old callback only when removed (#335)', async () => {
    const { app, clientSecret } = await setup();
    const store = app.services.oidcStore;
    const moved = `${ORIGIN}/gitlab/users/auth/openid_connect/callback`;
    const jar = new Jar();
    jar.set('sid', signIn(app, 'alice', 101));
    const subOf = (token: LightMyRequestResponse) => JSON.parse(Buffer.from(token.json().id_token.split('.')[1], 'base64url').toString()).sub as string;
    const before = subOf((await signInThroughGitlab(app, jar, clientSecret)).token);
    // 钉住之前登记的旧行没有 sector_id：照旧取第一个回调的主机
    app.services.storage.db.prepare("UPDATE oauth_clients SET sector_id = NULL WHERE client_id = 'gitlab'").run();
    expect(store.sectorOf('gitlab')).toBe('git.example.test');

    expect(store.addRedirectUri('gitlab', moved)).toMatchObject({ changed: true, before: [CALLBACK], client: { redirect_uris: [CALLBACK, moved], sector: 'git.example.test' } });
    expect(store.addRedirectUri('gitlab', moved).changed).toBe(false);
    const both = await signInThroughGitlab(app, jar, clientSecret, moved);
    expect(both.token.statusCode).toBe(200);
    expect(subOf(both.token)).toBe(before);
    expect(subOf((await signInThroughGitlab(app, jar, clientSecret)).token)).toBe(before);

    expect(store.removeRedirectUri('gitlab', CALLBACK)).toMatchObject({ changed: true, client: { redirect_uris: [moved], sector: 'git.example.test' } });
    expect(store.sectorOf('gitlab')).toBe('git.example.test');
    const { challenge } = pkce();
    const old = await visit(app, jar, authorizeUrl({ code_challenge: challenge, code_challenge_method: 'S256' }));
    expect(old.statusCode).toBe(400);
    expect(old.headers.location).toBeUndefined();
    expect(old.body).toContain('invalid_redirect_uri');
    expect(subOf((await signInThroughGitlab(app, jar, clientSecret, moved)).token)).toBe(before);
    expect(() => store.removeRedirectUri('gitlab', moved)).toThrow(/at least one/);
    expect(() => store.addRedirectUri('gitlab', 'http://example.test/gitlab/cb')).toThrow(/https/);
    expect(() => store.addRedirectUri('nobody', moved)).toThrow(/not found/);
    expect(store.listClients().find(client => client.client_id === 'gitlab')).toMatchObject({ redirect_uris: [moved], sector: 'git.example.test' });
  });

  it('keeps a fixed sub for a member of a legacy GitLab row after the callback moves to another host (golden, #335)', async () => {
    const { app, clientSecret } = await setup();
    const store = app.services.oidcStore;
    const db = app.services.storage.db;
    const moved = `${ORIGIN}/gitlab/users/auth/openid_connect/callback`;
    // 固定的账号与 sub：正式库里 GitLab 已经绑着的值，是 #335 之前按旧主机生成并存下的
    const GOLDEN = 'kq3Zb0x9WlqvYH2m7tC5u1fJp8sRdNe4aGiLoV6yTwE';
    db.prepare("UPDATE oauth_clients SET sector_id = NULL WHERE client_id = 'gitlab'").run();
    const jar = new Jar();
    jar.set('sid', signIn(app, 'golden', 4242));
    const account = accountOf(app, 4242);
    db.prepare('INSERT INTO oauth_subjects(sector_id, user_id, sub, created_at) VALUES(?, ?, ?, ?)').run('git.example.test', account, GOLDEN, 1);
    const subOf = (token: LightMyRequestResponse) => JSON.parse(Buffer.from(token.json().id_token.split('.')[1], 'base64url').toString()).sub as string;
    expect(subOf((await signInThroughGitlab(app, jar, clientSecret)).token)).toBe(GOLDEN);

    store.addRedirectUri('gitlab', moved);
    store.removeRedirectUri('gitlab', CALLBACK);
    expect(store.listClients().find(client => client.client_id === 'gitlab')?.redirect_uris).toEqual([moved]);
    const after = await signInThroughGitlab(app, jar, clientSecret, moved);
    expect(subOf(after.token)).toBe(GOLDEN);
    const userinfo = await app.inject({ url: '/oidc/me', headers: { authorization: `Bearer ${after.token.json().access_token}` } });
    expect(userinfo.json().sub).toBe(GOLDEN);
    // 没有在新主机的 sector 下给这个成员另起一个 sub
    expect(db.prepare('SELECT sector_id, sub FROM oauth_subjects WHERE user_id = ?').all(account)).toEqual([{ sector_id: 'git.example.test', sub: GOLDEN }]);
  });

  it('samples members by sector and digests their subs without creating or printing any (#335)', async () => {
    const { app, clientSecret } = await setup();
    const store = app.services.oidcStore;
    const db = app.services.storage.db;
    expect(store.pinnedSectorOf('gitlab')).toBe('git.example.test');
    db.prepare("UPDATE oauth_clients SET sector_id = NULL WHERE client_id = 'gitlab'").run();
    expect(store.pinnedSectorOf('gitlab')).toBeNull();
    expect(store.pinnedSectorOf('nobody')).toBeUndefined();
    for (const [login, id] of [['ann', 301], ['bob', 302], ['cat', 303]] as const) {
      const jar = new Jar();
      jar.set('sid', signIn(app, login, id));
      await signInThroughGitlab(app, jar, clientSecret);
    }
    const accounts = store.subjectAccounts('git.example.test', 2);
    expect(accounts).toEqual([...accounts].sort());
    expect(accounts).toHaveLength(2);
    const rows = () => db.prepare('SELECT COUNT(*) AS n FROM oauth_subjects').get() as { n: number };
    const before = rows().n;
    const digest = store.subjectDigest('git.example.test', accounts);
    expect(digest).toMatchObject({ count: 2, missing: 0 });
    expect(digest.digest).toMatch(/^[0-9a-f]{64}$/);
    expect(store.subjectDigest('git.example.test', accounts)).toEqual(digest);
    // 回调搬到别的主机之后，同一批账号的摘要不变
    store.addRedirectUri('gitlab', `${ORIGIN}/gitlab/users/auth/openid_connect/callback`);
    store.removeRedirectUri('gitlab', CALLBACK);
    expect(store.subjectDigest(store.sectorOf('gitlab')!, accounts)).toEqual(digest);
    // 别的 sector 里没有这批账号：只报缺几个，不生成
    expect(store.subjectDigest('example.test', accounts)).toMatchObject({ count: 0, missing: 2 });
    expect(rows().n).toBe(before);
    // 任何一个账号的 sub 变了，摘要就变
    db.prepare('UPDATE oauth_subjects SET sub = ? WHERE sector_id = ? AND user_id = ?').run('changed', 'git.example.test', accounts[0]);
    expect(store.subjectDigest('git.example.test', accounts).digest).not.toBe(digest.digest);
  });

  it('validates redirect URIs when registering a client', async () => {
    const { app } = await setup();
    const store = app.services.oidcStore;
    expect(() => store.registerClient({ name: 'A', redirectUris: ['http://git.example.test/cb'] })).toThrow(/https/);
    expect(() => store.registerClient({ name: 'A', redirectUris: ['https://a.example.test/cb', 'https://b.example.test/cb'] })).toThrow(/share a host/);
    expect(() => store.registerClient({ name: 'A', redirectUris: ['https://a.example.test/cb#x'] })).toThrow(/fragment/);
    expect(() => store.registerClient({ name: 'GitLab', clientId: 'gitlab', redirectUris: [CALLBACK] })).toThrow(/already exists/);
    // 换地址的应用重新登记时钉住原来的 sector（#335）：回调可以在别的主机上
    expect(store.registerClient({ name: 'Moved', clientId: 'moved', redirectUris: [`${ORIGIN}/gitlab/cb`], sector: 'git.example.test' }).client.sector).toBe('git.example.test');
    expect(store.sectorOf('moved')).toBe('git.example.test');
    expect(() => store.registerClient({ name: 'Bad', redirectUris: [`${ORIGIN}/gitlab/cb`], sector: 'https://git.example.test' })).toThrow(/host name/);
    const row = app.services.storage.db.prepare("SELECT secret_encrypted FROM oauth_clients WHERE client_id = 'gitlab'").get() as { secret_encrypted: string };
    expect(row.secret_encrypted).not.toContain(store.rotateSecret('gitlab'));
  });
});

/**
 * 直接用安装的 oidc-provider（版本钉在 app/server/package.json）核对多主机回调的规则（#335）：pairwise 客户端的回调跨两个主机时，
 * 不带 sector_identifier_uri 它拒绝加载；带上之后，默认会去取这个地址上的文档，所以要关掉 sectorIdentifierUriValidate 才能加载。
 * oidc-store 的 clientMetadata 一直带着钉住的 sector，oidc-provider.ts 关掉了去取文档，所以换地址的过渡期新旧回调可以同时在。
 */
describe('oidc-provider multi-host pairwise clients (#335)', () => {
  const serverPackage = new URL('../../app/server/package.json', import.meta.url);
  const two = [CALLBACK, `${ORIGIN}/gitlab/users/auth/openid_connect/callback`];
  const base = { client_id: 'gitlab', client_secret: 's'.repeat(43), grant_types: ['authorization_code'], response_types: ['code'], token_endpoint_auth_method: 'client_secret_basic', subject_type: 'pairwise' };
  async function load(metadata: Record<string, unknown>, extra: Record<string, unknown> = {}) {
    type Loaded = { sectorIdentifier: string; redirectUris: string[] } | undefined;
    const { default: Provider } = await import(createRequire(serverPackage).resolve('oidc-provider')) as { default: new (issuer: string, configuration: Record<string, unknown>) => { Client: { find(id: string): Promise<Loaded> } } };
    const adapter = class {
      constructor(private name: string) {}
      async find() { return this.name === 'Client' ? metadata : undefined; }
      async upsert() {}
      async findByUid() { return undefined; }
      async findByUserCode() { return undefined; }
      async consume() {}
      async destroy() {}
      async revokeByGrantId() {}
    };
    const provider = new Provider(`${ORIGIN}/oidc`, { adapter, subjectTypes: ['pairwise'], pairwiseIdentifier: async (_ctx: unknown, accountId: string) => accountId, ...extra });
    return provider.Client.find('gitlab');
  }

  it('is the pinned version', () => {
    expect(JSON.parse(readFileSync(serverPackage, 'utf8')).dependencies['oidc-provider']).toBe('9.12.2');
  });

  it('refuses two hosts without sector_identifier_uri, and loads them with it once fetching the document is off', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const info = vi.spyOn(console, 'info').mockImplementation(() => {});
    try {
      expect((await load({ ...base, redirect_uris: [CALLBACK] }))?.sectorIdentifier).toBe('git.example.test');
      await expect(load({ ...base, redirect_uris: two })).rejects.toMatchObject({ name: 'InvalidClientMetadata', error_description: 'sector_identifier_uri is mandatory property' });
      await expect(load({ ...base, redirect_uris: two, sector_identifier_uri: 'https://git.example.test/' })).rejects.toMatchObject({ error_description: 'could not load sector_identifier_uri response' });
      const loaded = await load({ ...base, redirect_uris: two, sector_identifier_uri: 'https://git.example.test/' }, { sectorIdentifierUriValidate: () => false });
      expect(loaded?.redirectUris).toEqual(two);
      expect(loaded?.sectorIdentifier).toBe('git.example.test');
    } finally {
      warn.mockRestore();
      info.mockRestore();
    }
  });

  it('gets that metadata from the store for a client whose callbacks span two hosts', async () => {
    const { app } = await setup();
    const store = app.services.oidcStore;
    store.addRedirectUri('gitlab', two[1]);
    expect(store.clientMetadata('gitlab')).toMatchObject({ redirect_uris: two, subject_type: 'pairwise', sector_identifier_uri: 'https://git.example.test/' });
  });
});

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { DEVICE_GRANT_TYPE } from '../../app/server/src/lib/device-store';
import { activityRows, signIn, testApp } from './helpers';

/**
 * RFC 8628 设备授权（#262，为 `geek login` 预留）：命令行发码、用户确认、轮询换一次性令牌、userinfo。
 * 时钟由 `overrides.clock` 控制，过期与 slow_down 不靠真实等待。
 */
const contexts: Awaited<ReturnType<typeof testApp>>[] = [];
const START = Date.UTC(2026, 0, 1);
let now = START;
const clock = () => now;

beforeEach(() => { now = START; });
afterEach(async () => { for (const context of contexts.splice(0)) await context.close(); });

async function setup(env: Record<string, string> = {}) {
  const context = await testApp({ clock }, false, env);
  contexts.push(context);
  return context;
}

const form = (payload: Record<string, string>) => new URLSearchParams(payload).toString();

function issueCode(app: FastifyInstance, payload: Record<string, string> = { client_id: 'geek-cli' }, encoded = true) {
  return app.inject({
    method: 'POST', url: '/auth/device/code',
    headers: { 'content-type': encoded ? 'application/x-www-form-urlencoded' : 'application/json' },
    payload: encoded ? form(payload) : payload,
  });
}

function pollToken(app: FastifyInstance, deviceCode: string, clientId = 'geek-cli', grantType: string = DEVICE_GRANT_TYPE) {
  return app.inject({
    method: 'POST', url: '/auth/device/token',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    payload: form({ grant_type: grantType, device_code: deviceCode, client_id: clientId }),
  });
}

const approveUrl = '/api/identity/device/approve';

/** better-sqlite3 的 get() 只回 unknown；这里读的是登录事务刚写下的身份行，形状由 db.ts 的 identities 表确定。 */
function accountOfGithub(db: FastifyInstance['services']['storage']['db'], githubId: string): string {
  const row = db.prepare("SELECT user_id FROM identities WHERE provider = 'github' AND provider_uid = ?").get(githubId) as { user_id: string } | undefined;
  if (!row) throw new Error(`no account for GitHub id ${githubId}`);
  return row.user_id;
}

function decide(app: FastifyInstance, sid: string, userCode: string, decision: 'approve' | 'deny') {
  return app.inject({
    method: 'POST', url: approveUrl,
    headers: { cookie: `sid=${sid}`, 'content-type': 'application/json' },
    payload: { user_code: userCode, decision },
  });
}

function detail(app: FastifyInstance, sid: string, userCode: string) {
  return app.inject({ url: `/api/identity/device?user_code=${encodeURIComponent(userCode)}`, headers: { cookie: `sid=${sid}` } });
}

describe('device authorization (#262, RFC 8628)', () => {
  it('issues a code in both encodings from the environment origin and stores only hashes', async () => {
    const { app } = await setup();
    const response = await issueCode(app);
    expect(response.statusCode).toBe(200);
    expect(response.headers['cache-control']).toBe('no-store');
    const body = response.json();
    expect(body.user_code).toMatch(/^[BCDFGHJKLMNPQRSTVWXZ]{4}-[BCDFGHJKLMNPQRSTVWXZ]{4}$/);
    expect(body.verification_uri).toBe('https://example.test/device');
    expect(body.verification_uri_complete).toBe(`https://example.test/device?user_code=${encodeURIComponent(body.user_code)}`);
    expect(body.expires_in).toBe(600);
    expect(body.interval).toBe(5);
    expect(body.device_code).toMatch(/^[A-Za-z0-9_-]{43}$/);

    const json = await issueCode(app, { client_id: 'geek-cli', scope: 'profile' }, false);
    expect(json.statusCode).toBe(200);
    expect(json.json().device_code).not.toBe(body.device_code);

    const rows = app.services.storage.db.prepare('SELECT * FROM device_grants ORDER BY created_at, rowid').all() as Record<string, unknown>[];
    expect(rows).toHaveLength(2);
    expect(rows[0]).toMatchObject({ client_id: 'geek-cli', scope: 'openid profile', status: 'pending', interval_s: 5 });
    expect(rows[1]).toMatchObject({ scope: 'profile' });
    expect(rows[0].user_code).toBe(body.user_code.replace('-', ''));
    expect(rows[0].device_code_hash).toMatch(/^[0-9a-f]{64}$/);
    const stored = JSON.stringify(rows);
    expect(stored).not.toContain(body.device_code);
    expect(stored).not.toContain(json.json().device_code);

    // form 请求同样过 body schema：未知字段被拒，不会静默带进存储。
    const unknownField = await issueCode(app, { client_id: 'geek-cli', rogue: '1' });
    expect(unknownField.statusCode).toBe(400);
    expect(unknownField.json().error).toBe('validation_error');
  });

  it('rejects an unregistered client and an unsupported scope', async () => {
    const { app } = await setup();
    const unknown = await issueCode(app, { client_id: 'rogue-client' });
    expect(unknown.statusCode).toBe(400);
    expect(unknown.json().error).toBe('invalid_client');
    const scope = await issueCode(app, { client_id: 'geek-cli', scope: 'openid admin' });
    expect(scope.statusCode).toBe(400);
    expect(scope.json().error).toBe('invalid_scope');
    expect(app.services.storage.db.prepare('SELECT COUNT(*) AS n FROM device_grants').get()).toEqual({ n: 0 });
  });

  it('reports authorization_pending, then slow_down and raises the stored interval', async () => {
    const { app } = await setup();
    const code = (await issueCode(app)).json();
    const first = await pollToken(app, code.device_code);
    expect(first.statusCode).toBe(400);
    expect(first.json().error).toBe('authorization_pending');
    const second = await pollToken(app, code.device_code);
    expect(second.json().error).toBe('slow_down');
    expect(app.services.storage.db.prepare('SELECT interval_s FROM device_grants').get()).toEqual({ interval_s: 10 });

    now += 10_000;
    expect((await pollToken(app, code.device_code)).json().error).toBe('authorization_pending');
    const wrongClient = await pollToken(app, code.device_code, 'other-client');
    expect(wrongClient.json().error).toBe('invalid_client');
    const unknown = await pollToken(app, 'not-a-device-code');
    expect(unknown.json().error).toBe('invalid_grant');
    const grantType = await pollToken(app, code.device_code, 'geek-cli', 'password');
    expect(grantType.json().error).toBe('unsupported_grant_type');
  });

  it('requires a session to inspect or decide a code', async () => {
    const { app } = await setup();
    const code = (await issueCode(app)).json();
    expect((await app.inject(`/api/identity/device?user_code=${encodeURIComponent(code.user_code)}`)).statusCode).toBe(401);
    const approve = await app.inject({ method: 'POST', url: approveUrl, payload: { user_code: code.user_code, decision: 'approve' } });
    expect(approve.statusCode).toBe(401);
    // #274 item I 的 extras c：preHandler 以前多挂了一个 requireAuth，它先回自己的 401 not_signed_in，
    // 盖掉 requirePermission 回的通用 401 unauthenticated（和 portal/apply.ts 同一类 bug，同样的修法）。
    expect(approve.json()).toEqual({ error: 'unauthenticated', message: '请先登录' });
    expect((await app.inject('/api/identity/device?user_code=ZZZZ-ZZZZ')).statusCode).toBe(401);
  });

  it('shows a pending code to the signed-in user, accepting lowercase and missing hyphens', async () => {
    const { app } = await setup();
    const sid = signIn(app, 'octocat', 4242);
    const code = (await issueCode(app)).json();
    const response = await detail(app, sid, code.user_code.replace('-', '').toLowerCase());
    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({
      user_code: code.user_code,
      client_id: 'geek-cli',
      client_name: '极客班命令行',
      scope: 'openid profile',
      status: 'pending',
      expires_at: now + 600_000,
    });
    const missing = await detail(app, sid, 'ZZZZ-ZZZZ');
    expect(missing.statusCode).toBe(404);
    expect(missing.json().error).toBe('device_code_not_found');
  });

  it('exchanges an approved code once for a token bound to the session account', async () => {
    const { app } = await setup();
    const db = app.services.storage.db;
    const sid = signIn(app, 'octocat', 4242, 'https://avatars.githubusercontent.com/test/octocat.png');
    const accountId = accountOfGithub(db, '4242');
    const code = (await issueCode(app)).json();

    const approved = await decide(app, sid, code.user_code, 'approve');
    expect(approved.statusCode).toBe(200);
    expect(approved.json()).toEqual({ ok: true, status: 'approved' });

    const response = await pollToken(app, code.device_code);
    expect(response.statusCode).toBe(200);
    expect(response.headers['cache-control']).toBe('no-store');
    const token = response.json();
    expect(token).toMatchObject({ token_type: 'Bearer', expires_in: 30 * 24 * 60 * 60, scope: 'openid profile', account_id: accountId });
    expect(token.access_token).toMatch(/^gk_[A-Za-z0-9_-]{43}$/);

    const row = db.prepare('SELECT status, token_hash, token_expires_at, account_id FROM device_grants').get() as Record<string, unknown>;
    expect(row.status).toBe('consumed');
    expect(row.account_id).toBe(accountId);
    expect(row.token_hash).toMatch(/^[0-9a-f]{64}$/);
    expect(row.token_expires_at).toBe(now + 30 * 24 * 60 * 60 * 1000);
    const stored = JSON.stringify(db.prepare('SELECT * FROM device_grants').all());
    expect(stored).not.toContain(token.access_token);
    expect(stored).not.toContain(code.device_code);

    // 一次性：第二次轮询拿不到第二个令牌，重复确认是 409。
    expect((await pollToken(app, code.device_code)).json().error).toBe('invalid_grant');
    expect((await decide(app, sid, code.user_code, 'approve')).statusCode).toBe(409);
    expect((await detail(app, sid, code.user_code)).json().status).toBe('consumed');

    const info = await app.inject({ url: '/auth/device/userinfo', headers: { authorization: `Bearer ${token.access_token}` } });
    expect(info.statusCode).toBe(200);
    expect(info.json()).toMatchObject({
      sub: accountId, account_id: accountId, login: 'octocat',
      username: expect.any(String), display_name: expect.any(String), bio: expect.any(String),
      avatar_url: 'https://avatars.githubusercontent.com/test/octocat.png', scope: 'openid profile', email_required: false, profile_required: false,
      // signIn() 新建的测试账号默认补过资料（helpers.ts 的 completeProfile）；它传的默认年级是 2，但
      // enrollmentYearFor() 没有接这个文件的 `clock`、按真实当前时间算入学年份，年级又按这里固定的
      // 测试时钟现算，两边时间不一致，算出来就是 1/大一，不是传入的 2（helpers.ts 的已知问题，不在
      // #277 范围内，已向负责 #280 的一方报告）。
      grade: 1, grade_label: '大一',
    });
    expect(Object.keys(info.json()).sort()).toEqual([
      'account_id', 'avatar_url', 'bio', 'display_name', 'email_required',
      'grade', 'grade_label', 'login', 'profile_required', 'scope', 'sub', 'username',
    ].sort());
    const rejected = await app.inject({ url: '/auth/device/userinfo', headers: { authorization: 'Bearer gk_wrong' } });
    expect(rejected.statusCode).toBe(401);
    expect(rejected.json().error).toBe('invalid_token');
    expect(rejected.headers['www-authenticate']).toBe('Bearer error="invalid_token"');

    const rows = activityRows(app, { actionLike: 'identity.device.%' });
    expect(rows.map(row => row.action)).toEqual(['identity.device.approve']);
    expect(rows[0].meta).toEqual({ client_id: 'geek-cli', scope: 'openid profile' });
    expect(JSON.stringify(rows[0].meta)).not.toContain(code.device_code);
    expect(JSON.stringify(rows[0].meta)).not.toContain(token.access_token);
  });

  it('turns a denial into access_denied and records the decision', async () => {
    const { app } = await setup();
    const db = app.services.storage.db;
    const sid = signIn(app, 'octocat', 4242);
    const code = (await issueCode(app)).json();
    const denied = await decide(app, sid, code.user_code, 'deny');
    expect(denied.statusCode).toBe(200);
    expect(denied.json()).toEqual({ ok: true, status: 'denied' });
    expect((await pollToken(app, code.device_code)).json().error).toBe('access_denied');
    expect(db.prepare('SELECT status, account_id FROM device_grants').get()).toEqual({ status: 'denied', account_id: null });
    expect(activityRows(app, { actionLike: 'identity.device.%' }).map(row => row.action)).toEqual(['identity.device.deny']);
  });

  it('never approves a code after the ten minutes are up', async () => {
    const { app } = await setup();
    const sid = signIn(app, 'octocat', 4242);
    const code = (await issueCode(app)).json();
    now += 600_001;
    expect((await pollToken(app, code.device_code)).json().error).toBe('expired_token');
    expect((await detail(app, sid, code.user_code)).json().status).toBe('expired');
    const late = await decide(app, sid, code.user_code, 'approve');
    expect(late.statusCode).toBe(409);
    expect(late.json().error).toBe('device_code_not_pending');
  });

  it('refuses a token for an account that is no longer active', async () => {
    const { app } = await setup();
    const db = app.services.storage.db;
    const sid = signIn(app, 'octocat', 4242);
    const accountId = accountOfGithub(db, '4242');
    const code = (await issueCode(app)).json();
    expect((await decide(app, sid, code.user_code, 'approve')).statusCode).toBe(200);
    db.prepare("UPDATE users SET status = 'disabled' WHERE id = ?").run(accountId);
    expect((await pollToken(app, code.device_code)).json().error).toBe('access_denied');
  });

  it('stops accepting an already-issued token once the account is disabled afterwards (SPEC §3.8：停用后命令行令牌全部失效)', async () => {
    const { app } = await setup();
    const db = app.services.storage.db;
    const sid = signIn(app, 'octocat', 4242);
    const accountId = accountOfGithub(db, '4242');
    const code = (await issueCode(app)).json();
    expect((await decide(app, sid, code.user_code, 'approve')).statusCode).toBe(200);
    const token = (await pollToken(app, code.device_code)).json();
    // 停用前，这个令牌还能正常用
    const before = await app.inject({ url: '/auth/device/userinfo', headers: { authorization: `Bearer ${token.access_token}` } });
    expect(before.statusCode).toBe(200);

    db.prepare("UPDATE users SET status = 'disabled' WHERE id = ?").run(accountId);
    // device.authenticate() 每次都联查账号状态（lib/device-store.ts），不是靠令牌本身过期或被撤销——
    // 这里把这条既有行为锁进回归测试，停用这个动作本身不用另外去吊销已经发出去的令牌。
    const after = await app.inject({ url: '/auth/device/userinfo', headers: { authorization: `Bearer ${token.access_token}` } });
    expect(after.statusCode).toBe(401);
    expect(after.json().error).toBe('invalid_token');
  });

  it('stops accepting a token after its 30 days', async () => {
    const { app } = await setup();
    const sid = signIn(app, 'octocat', 4242);
    const code = (await issueCode(app)).json();
    await decide(app, sid, code.user_code, 'approve');
    const token = (await pollToken(app, code.device_code)).json();
    now += 30 * 24 * 60 * 60 * 1000 + 1;
    const expired = await app.inject({ url: '/auth/device/userinfo', headers: { authorization: `Bearer ${token.access_token}` } });
    expect(expired.statusCode).toBe(401);
    expect(expired.json().error).toBe('invalid_token');
  });

  it('asks an account without a login email to bind one before approving, and still lets it deny (#273)', async () => {
    // 能发信的环境才要求登录邮箱；这里不会真的发信
    const { app } = await setup({ MAIL_RESEND_API_KEY: 're_test_resend_key_value', MAIL_RESEND_FROM: 'notify@example.test' });
    const db = app.services.storage.db;
    const sid = signIn(app, 'octocat', 4242);
    const accountId = accountOfGithub(db, '4242');
    const first = (await issueCode(app)).json();
    const held = await decide(app, sid, first.user_code, 'approve');
    expect([held.statusCode, held.json().error]).toEqual([403, 'email_required']);
    expect((await detail(app, sid, first.user_code)).json().status).toBe('pending');
    expect((await decide(app, sid, first.user_code, 'deny')).statusCode).toBe(200);

    app.services.identity.linkEmail({ accountId, email: 'octo@example.test', login: 'octocat', claim: () => true });
    const second = (await issueCode(app)).json();
    expect((await decide(app, sid, second.user_code, 'approve')).statusCode).toBe(200);
  });

  it('limits approving a device code to 20 a day per account (SPEC §3.8), but never blocks a denial', async () => {
    const { app } = await setup();
    const sid = signIn(app, 'octocat', 4242);
    const accountId = accountOfGithub(app.services.storage.db, '4242');
    // 预先垫 19 次，不占用路由自己每分钟 20 次的额度（否则分不清是哪条线拦下来的）。
    for (let i = 0; i < 19; i += 1) app.services.limits.hit({ bucket: 'account.cli.login.daily', subject: accountId, window: 'day-bj', max: 20 });
    const ok = (await issueCode(app)).json();
    expect((await decide(app, sid, ok.user_code, 'approve')).statusCode).toBe(200);
    const blocked = (await issueCode(app)).json();
    const refused = await decide(app, sid, blocked.user_code, 'approve');
    expect(refused.statusCode).toBe(429);
    expect(refused.json()).toMatchObject({ error: 'rate_limited', bucket: 'account.cli.login.daily' });
    // 这个码没有被 approve 耗掉（账号停在 pending），拒绝（deny）不占这条额度，照常能用。
    expect((await detail(app, sid, blocked.user_code)).json().status).toBe('pending');
    expect((await decide(app, sid, blocked.user_code, 'deny')).statusCode).toBe(200);
  });
});

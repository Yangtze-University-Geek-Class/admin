import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { DEVICE_GRANT_TYPE } from '../../app/server/src/lib/device-store';
import { accountIdOf, activityRows, grantPermGroup, signIn, testApp } from './helpers';

/**
 * geek 命令行的 Bearer 鉴权（#277）：中间件把令牌挂成 req.session、cookie + Bearer 混用拒绝、
 * scope 粗粒度拦截、没绑邮箱的账号挡在业务接口之外、撤销令牌、操作记录按 surface=cli 落地。
 * RFC 8628 的发码/轮询/确认本身已经在 device-flow.test.ts 覆盖，这里只测 #277 新加的部分。
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

function issueCode(app: FastifyInstance, scope?: string) {
  return app.inject({
    method: 'POST', url: '/auth/device/code',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    payload: form(scope ? { client_id: 'geek-cli', scope } : { client_id: 'geek-cli' }),
  }).then(response => response.json());
}

function pollToken(app: FastifyInstance, deviceCode: string) {
  return app.inject({
    method: 'POST', url: '/auth/device/token',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    payload: form({ grant_type: DEVICE_GRANT_TYPE, device_code: deviceCode, client_id: 'geek-cli' }),
  }).then(response => response.json());
}

function decide(app: FastifyInstance, sid: string, userCode: string) {
  return app.inject({
    method: 'POST', url: '/api/identity/device/approve',
    headers: { cookie: `sid=${sid}`, 'content-type': 'application/json' },
    payload: { user_code: userCode, decision: 'approve' },
  });
}

/** 走完整的设备码流程拿一个真实令牌（和命令行拿到的是同一种）；scope 不传就是默认 "openid profile"。 */
async function login(app: FastifyInstance, sid: string, scope?: string): Promise<string> {
  const code = await issueCode(app, scope);
  const approved = await decide(app, sid, code.user_code);
  if (approved.statusCode !== 200) throw new Error(`approve failed: ${JSON.stringify(approved.json())}`);
  const token = await pollToken(app, code.device_code);
  return token.access_token as string;
}

const bearer = (token: string) => ({ authorization: `Bearer ${token}` });

describe('geek 命令行的 Bearer 鉴权（#277）', () => {
  it('把令牌挂成和 cookie 会话一样的身份，requireAuth 系的接口不用改就能用', async () => {
    const { app } = await setup();
    const sid = signIn(app, 'octocat', 4242);
    const token = await login(app, sid, 'openid profile forum apply competition repo');
    const response = await app.inject({ url: '/api/console/me', headers: bearer(token) });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({ account_id: accountIdOf(app, 'octocat') });
    expect(response.json()).not.toHaveProperty('real_name');
  });

  it('令牌只能用命令行用到的接口：控制台、账号页、/auth/me 一律 cli_not_allowed', async () => {
    const { app } = await setup();
    const sid = signIn(app, 'octocat', 4242);
    const token = await login(app, sid, 'openid profile forum apply competition repo');
    const refused = [
      { method: 'GET', url: '/auth/me' },
      { method: 'GET', url: '/api/identity/me' },
      { method: 'GET', url: '/api/identity/profile' },
      { method: 'POST', url: '/api/identity/password', payload: { password: 'a-new-password-1' } },
      { method: 'POST', url: '/api/identity/email/start', payload: { email: 'someone@example.test' } },
      { method: 'GET', url: '/api/console/users' },
      { method: 'PATCH', url: '/api/console/users/x', payload: { status: 'disabled' } },
      { method: 'POST', url: '/api/public/feedback', payload: {} },
    ] as const;
    for (const request of refused) {
      const response = await app.inject({ ...request, headers: { ...bearer(token), ...('payload' in request ? { 'content-type': 'application/json' } : {}) } });
      expect({ url: request.url, status: response.statusCode, error: response.json().error }).toEqual({ url: request.url, status: 403, error: 'cli_not_allowed' });
    }
    const competitions = await app.inject({ url: '/api/public/competitions', headers: bearer(token) });
    expect(competitions.statusCode).toBe(200);
  });

  it('命令行请求永远不算刚登录过，过不了 step-up', async () => {
    const { isSessionFresh } = await import('../../app/server/src/middleware/require-step-up');
    const { app } = await setup();
    const req = (via: 'cli' | undefined) => ({ via, session: { created_at: now }, server: app }) as unknown as Parameters<typeof isSessionFresh>[0];
    expect(isSessionFresh(req(undefined))).toBe(true);
    expect(isSessionFresh(req('cli'))).toBe(false);
  });

  it('同一个请求不能既带 cookie 又带 Bearer', async () => {
    const { app } = await setup();
    const sid = signIn(app, 'octocat', 4242);
    const token = await login(app, sid);
    const response = await app.inject({ url: '/api/identity/profile', headers: { ...bearer(token), cookie: `sid=${sid}` } });
    expect(response.statusCode).toBe(400);
    expect(response.json().error).toBe('mixed_credentials');
  });

  it('无效或已撤销的令牌按未登录处理，和 cookie 过期一样，不单独报一种错', async () => {
    const { app } = await setup();
    const response = await app.inject({ url: '/api/identity/profile', headers: bearer('gk_not-a-token') });
    expect(response.statusCode).toBe(401);
  });

  it('令牌没有申请过的 scope 时拒绝业务接口（insufficient_scope），和权限节点的拒绝是两件事', async () => {
    const { app } = await setup();
    const sid = signIn(app, 'octocat', 4242);
    // 极客班成员才有 forum.topic.create；先把账号升到 member，证明这里先被 scope 挡下，而不是权限
    const accountId = accountIdOf(app, 'octocat');
    app.services.storage.db.prepare("INSERT OR IGNORE INTO perm_members(account_id, group_id, granted_by, created_at) VALUES (?, 'level.member', 'test', ?)").run(accountId, now);
    app.services.permissions.bump();
    const token = await login(app, sid); // 默认 scope："openid profile"，没有 forum
    const response = await app.inject({
      method: 'POST', url: '/api/forum/topics', headers: { ...bearer(token), 'content-type': 'application/json' },
      payload: { title: 't', categoryId: 'general', content: 'c' },
    });
    expect(response.statusCode).toBe(403);
    expect(response.json()).toMatchObject({ error: 'insufficient_scope', scope: 'forum' });
    // 组队广场（#278，geek comp plaza）归 competition scope，没申请过同样先被 scope 挡下
    const plaza = await app.inject({ url: '/api/team-plaza', headers: bearer(token) });
    expect(plaza.statusCode).toBe(403);
    expect(plaza.json()).toMatchObject({ error: 'insufficient_scope', scope: 'competition' });
  });

  it('注册用户（没有邀请码）即使令牌带了 forum scope，发帖也被权限节点拒绝，错误可读（issue #277 验收项）', async () => {
    const { app } = await setup();
    const sid = signIn(app, 'octocat', 4242);
    const token = await login(app, sid, 'openid profile forum apply competition repo');
    const response = await app.inject({
      method: 'POST', url: '/api/forum/topics', headers: { ...bearer(token), 'content-type': 'application/json' },
      payload: { title: 't', categoryId: 'general', content: 'c' },
    });
    expect(response.statusCode).toBe(403);
    const body = response.json();
    expect(body.error).toBe('forbidden');
    expect(body.message).toContain('forum.topic.create');
    // http-policy.ts 的全局钩子记了这次拒绝（论坛的 ForumError 没有带 node 字段，行为名退回通用的
    // "http.<error>"，和 requirePermission 回的 {node} 不是一回事）；via=cli 把 surface 改写成 "cli"，
    // 不是论坛接口默认的 "forum"。
    const denials = activityRows(app, { action: 'http.forbidden' });
    expect(denials).toHaveLength(1);
    expect(denials[0]).toMatchObject({ surface: 'cli', outcome: 'denied' });
  });

  it('没有登录邮箱的账号用业务接口被挡，但 userinfo 和 revoke 不算业务接口', async () => {
    // 正常流程里 /api/identity/device/approve 自己就会先挡住没绑邮箱的账号（#273，device-flow.test.ts
    // 已经覆盖）；这里直接把码标成已批准，模拟「令牌是在要求绑邮箱这条规则生效之前发出的，30 天有效期
    // 还没到」——这才是 middleware/bearer-auth.ts 的闸真正要接住的场景。
    const { app } = await setup({ MAIL_RESEND_API_KEY: 're_test_resend_key_value', MAIL_RESEND_FROM: 'notify@example.test' });
    signIn(app, 'octocat', 4242);
    const accountId = accountIdOf(app, 'octocat');
    const code = await issueCode(app, 'openid profile forum apply competition repo');
    const normalizedCode = code.user_code.replace('-', '');
    app.services.storage.db.prepare("UPDATE device_grants SET status = 'approved', account_id = ?, decided_at = ? WHERE user_code = ?").run(accountId, now, normalizedCode);
    const token = (await pollToken(app, code.device_code)).access_token as string;
    const blocked = await app.inject({ url: '/api/forum/state', headers: bearer(token) });
    expect(blocked.statusCode).toBe(403);
    expect(blocked.json().error).toBe('email_required');
    const info = await app.inject({ url: '/auth/device/userinfo', headers: bearer(token) });
    expect(info.statusCode).toBe(200);
    const revoke = await app.inject({ method: 'POST', url: '/auth/device/revoke', headers: bearer(token) });
    expect(revoke.statusCode).toBe(200);
    expect(revoke.json()).toEqual({ ok: true });
  });

  it('姓名和年级没补齐的账号用业务接口被挡（#280 的第二道关口），但 userinfo 的 grade/grade_label 是 null、revoke 不算业务接口', async () => {
    // signIn() 的测试账号默认已经补过资料（helpers.ts 的 completeProfile）；这里清掉，模拟「令牌是在
    // 要求补资料这条规则生效之前发出的」——和上一条「没绑邮箱」同样的手法：直接把码标成已批准，不走
    // /api/identity/device/approve（它自己会先挡住，device-flow.test.ts 还没覆盖 #280 这道关口，这里
    // 只测 middleware/bearer-auth.ts 的闸，不重复测 approve 本身）。
    const { app } = await setup();
    signIn(app, 'octocat', 4242);
    const accountId = accountIdOf(app, 'octocat');
    // 补资料关口只拦极客班的人（成员、往届成员），普通注册用户不用填
    grantPermGroup(app, accountId, 'level.member');
    app.services.profiles.setRealInfo(accountId, null, null);
    const code = await issueCode(app, 'openid profile forum apply competition repo');
    const normalizedCode = code.user_code.replace('-', '');
    app.services.storage.db.prepare("UPDATE device_grants SET status = 'approved', account_id = ?, decided_at = ? WHERE user_code = ?").run(accountId, now, normalizedCode);
    const token = (await pollToken(app, code.device_code)).access_token as string;
    const blocked = await app.inject({ url: '/api/forum/state', headers: bearer(token) });
    expect(blocked.statusCode).toBe(403);
    expect(blocked.json()).toMatchObject({ error: 'profile_required' });
    const info = await app.inject({ url: '/auth/device/userinfo', headers: bearer(token) });
    expect(info.statusCode).toBe(200);
    expect(info.json()).toMatchObject({ profile_required: true, grade: null, grade_label: null });
    const revoke = await app.inject({ method: 'POST', url: '/auth/device/revoke', headers: bearer(token) });
    expect(revoke.statusCode).toBe(200);
    expect(revoke.json()).toEqual({ ok: true });
  });

  it('geek logout 撤销令牌后，同一个令牌调任何接口都是 401；撤销一个不存在的令牌仍然回 200（幂等，不泄露信息）', async () => {
    const { app } = await setup();
    const sid = signIn(app, 'octocat', 4242);
    const token = await login(app, sid, 'openid profile forum apply competition repo');
    const before = await app.inject({ url: '/auth/device/userinfo', headers: bearer(token) });
    expect(before.statusCode).toBe(200);

    const revoke = await app.inject({ method: 'POST', url: '/auth/device/revoke', headers: bearer(token) });
    expect(revoke.statusCode).toBe(200);
    expect(revoke.json()).toEqual({ ok: true });

    const after = await app.inject({ url: '/auth/device/userinfo', headers: bearer(token) });
    expect(after.statusCode).toBe(401);
    const profile = await app.inject({ url: '/api/identity/profile', headers: bearer(token) });
    expect(profile.statusCode).toBe(401);

    const unknown = await app.inject({ method: 'POST', url: '/auth/device/revoke', headers: bearer('gk_never-issued') });
    expect(unknown.statusCode).toBe(200);
    expect(unknown.json()).toEqual({ ok: true });

    const rows = activityRows(app, { action: 'identity.device.revoke' });
    expect(rows).toHaveLength(1); // 真撤销的那一次才记一条；重复撤销、撤销不存在的令牌都不记
  });

  it('命令行调用成功的接口留一条 surface=cli 的操作记录，供控制台看到这次调用（issue #277 验收项）', async () => {
    const { app } = await setup();
    const sid = signIn(app, 'octocat', 4242);
    const token = await login(app, sid, 'openid profile forum apply competition repo');
    const response = await app.inject({ url: '/api/forum/state', headers: bearer(token) });
    expect(response.statusCode).toBe(200);
    const rows = activityRows(app, { action: 'cli.get' });
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ surface: 'cli', outcome: 'ok', target_type: 'route', target_id: '/api/forum/state' });
  });

  it('geek-cli 客户端现在能申请 forum/apply/competition/repo 四个新 scope（#277）', async () => {
    const { app } = await setup();
    const code = await issueCode(app, 'openid profile forum apply competition repo');
    expect(code.device_code).toBeTruthy();
    const rejected = await issueCode(app, 'forum admin');
    expect(rejected.error).toBe('invalid_scope');
  });
});

import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { accountIdOf, activityRows, grantPermGroup, grantPermNode, signIn, testApp } from './helpers';

const contexts: { app: FastifyInstance; close: () => Promise<void> }[] = [];
const dirs: string[] = [];
afterEach(async () => {
  for (const context of contexts.splice(0)) await context.close();
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});
const path = '/api/console/security/decoy';
async function setup(env: Record<string, string> = {}, clock = { value: Date.now() }) {
  const context = await testApp({ clock: () => clock.value }, false, { GEEK_DEPLOYMENT_ENVIRONMENT: 'production', ...env });
  contexts.push(context);
  const { app } = context;
  const cookie = `sid=${signIn(app, 'decoy-owner', 7333)}`;
  grantPermGroup(app, accountIdOf(app, 'decoy-owner'), 'title.site.owner');
  const headers = { cookie, origin: 'https://example.test' };
  const put = (body: Record<string, unknown>) => app.inject({ method: 'PUT', url: path, headers, payload: body });
  const status = async () => (await app.inject({ url: path, headers })).json();
  return { app, context, clock, headers, put, status };
}
function auditFailure(app: FastifyInstance, action: string) {
  app.services.storage.db.exec(`CREATE TRIGGER fail_decoy_audit BEFORE INSERT ON activity_events WHEN NEW.action = '${action}' BEGIN SELECT RAISE(ABORT, 'audit unavailable'); END`);
}

// 真实路由与内存/临时 SQLite；只改外部适配器，不复制 handler。
describe('临时合成蜜罐', () => {
  it('默认关闭，开启保存截止时间，关闭不解除既有封禁', async () => {
    const { app, put, status, clock } = await setup();
    expect(await status()).toMatchObject({ available: true, active: false, expires_at: null, shield_enabled: true });
    const enabled = await put({ enabled: true, duration_minutes: 30 });
    expect(enabled.statusCode).toBe(200);
    expect(enabled.json()).toMatchObject({ active: true, expires_at: clock.value + 30 * 60_000 });
    await app.inject({ url: '/.env', remoteAddress: '198.51.100.31' });
    expect((await put({ enabled: false })).json()).toMatchObject({ active: false, expires_at: null });
    expect((await app.inject({ url: '/api/feedback/categories', remoteAddress: '198.51.100.31' })).statusCode).toBe(403);
    expect((await app.inject({ url: '/.env', remoteAddress: '198.51.100.32' })).statusCode).toBe(404);
    expect(activityRows(app, { action: 'security.decoy.update' }).map(row => row.meta.enabled)).toEqual([true, false]);
  });

  it.each(['preview', 'local', '', 'PRODUCTION'])('部署身份 %s 不能开启，即使 NODE_ENV=production', async environment => {
    const { put, status } = await setup({ GEEK_DEPLOYMENT_ENVIRONMENT: environment, NODE_ENV: 'production', FORUM_ORIGIN: 'http://127.0.0.1:3456' });
    const response = await put({ enabled: true, duration_minutes: 15 });
    expect(response.statusCode).toBe(409);
    expect(response.json().error).toBe('decoy_unavailable');
    expect(await status()).toMatchObject({ available: false, active: false });
    expect((await put({ enabled: false })).statusCode).toBe(200);
  });

  it('基础防护关闭时不能开启，但可以清除残留设置', async () => {
    const { app, put, status, clock } = await setup({ SHIELD_ENABLED: 'off' });
    app.services.storage.db.prepare('INSERT INTO app_state(key,value,updated_at) VALUES (?,?,?)').run('security_decoy_until', String(clock.value + 60_000), clock.value);
    expect((await put({ enabled: true, duration_minutes: 15 })).json().error).toBe('shield_disabled');
    expect(await status()).toMatchObject({ active: false, shield_enabled: false });
    expect((await put({ enabled: false })).json().expires_at).toBeNull();
  });

  it('匿名、无权限、旧登录与跨站写入都不能改设置', async () => {
    const { app, headers, clock, status } = await setup();
    const request = { method: 'PUT' as const, url: path, payload: { enabled: true, duration_minutes: 15 } };
    expect((await app.inject(request)).statusCode).toBe(401);
    expect((await app.inject({ url: path })).statusCode).toBe(401);
    const cookie = `sid=${signIn(app, 'decoy-reader', 7334)}`;
    expect((await app.inject({ ...request, headers: { cookie } })).statusCode).toBe(403);
    expect((await app.inject({ url: path, headers: { cookie } })).statusCode).toBe(403);
    expect((await app.inject({ ...request, headers: { ...headers, origin: 'https://foreign.test' } })).json().error).toBe('invalid_origin');
    clock.value += 10 * 60_000 + 1;
    expect((await app.inject({ ...request, headers })).json().error).toBe('step_up_required');
    expect(await status()).toMatchObject({ active: false, expires_at: null });
  });

  it.each([{}, { enabled: true }, { enabled: 'true', duration_minutes: 15 }, { enabled: true, duration_minutes: 0 },
    { enabled: true, duration_minutes: 61 }, { enabled: true, duration_minutes: 1.5 }, { enabled: true, duration_minutes: '15' },
    { enabled: true, duration_minutes: 15, prompt: 'arbitrary' }, { enabled: false, duration_minutes: 15 }])('拒绝不合约的配置 %j', async body => {
    const { put, status } = await setup();
    expect((await put(body)).statusCode).toBe(400);
    expect(await status()).toMatchObject({ active: false, expires_at: null });
  });

  it('精确到期即关闭，服务重启不续期', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'security-decoy-'));
    dirs.push(dir);
    const env = { DB_PATH: join(dir, 'data.db') };
    const first = await setup(env);
    const until = first.clock.value + 60_000;
    expect((await first.put({ enabled: true, duration_minutes: 1 })).statusCode).toBe(200);
    await first.context.close();
    contexts.pop();
    first.clock.value = until - 1;
    const second = await setup(env, first.clock);
    expect(await second.status()).toMatchObject({ active: true, expires_at: until });
    expect((await second.app.inject({ url: '/.env', remoteAddress: '198.51.100.41' })).statusCode).toBe(200);
    first.clock.value = until;
    expect(await second.status()).toMatchObject({ active: false, expires_at: until });
    expect((await second.app.inject({ url: '/.env', remoteAddress: '198.51.100.42' })).statusCode).toBe(404);
  });

  it('坏持久值与时钟回拨都关闭，不把无效值变成长期开放', async () => {
    const { app, clock, status, put } = await setup();
    const saved = clock.value;
    const upsert = app.services.storage.db.prepare('INSERT INTO app_state(key,value,updated_at) VALUES (?,?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value,updated_at=excluded.updated_at');
    for (const value of ['oops', '-1', 'Infinity', '1e99', 'PERMANENT', 'permanent ', String(saved + 61 * 60_000), String(Number.MAX_SAFE_INTEGER + 1)]) {
      upsert.run('security_decoy_until', value, saved);
      expect(await status()).toMatchObject({ active: false, expires_at: null });
    }
    await put({ enabled: true, duration_minutes: 15 });
    clock.value = saved - 1;
    expect((await status()).active).toBe(false);
  });

  it('永久开启不随时间到期，重启后仍开着，关闭立即失效，审计记下是否永久', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'security-decoy-'));
    dirs.push(dir);
    const env = { DB_PATH: join(dir, 'data.db') };
    const first = await setup(env);
    const enabled = await first.put({ enabled: true, permanent: true });
    expect(enabled.statusCode).toBe(200);
    expect(enabled.json()).toMatchObject({ active: true, permanent: true, expires_at: null });
    await first.context.close();
    contexts.pop();
    first.clock.value += 10 * 365 * 24 * 60 * 60_000;
    const second = await setup(env, first.clock);
    expect(await second.status()).toMatchObject({ active: true, permanent: true, expires_at: null });
    expect((await second.app.inject({ url: '/.env', remoteAddress: '198.51.100.91' })).statusCode).toBe(200);
    expect((await second.put({ enabled: false })).json()).toMatchObject({ active: false, permanent: false, expires_at: null });
    expect((await second.app.inject({ url: '/.env', remoteAddress: '198.51.100.92' })).statusCode).toBe(404);
    expect(activityRows(second.app, { action: 'security.decoy.update' }).map(row => row.meta)).toEqual([
      { enabled: true, duration_minutes: null, permanent: true, expires_at: null },
      { enabled: false, duration_minutes: null, permanent: false, expires_at: null },
    ]);
  });

  it('状态接口的 permanent 只在永久开启时为 true', async () => {
    const { put, status } = await setup();
    expect(await status()).toMatchObject({ permanent: false, active: false });
    await put({ enabled: true, duration_minutes: 15 });
    expect(await status()).toMatchObject({ permanent: false, active: true });
    await put({ enabled: true, permanent: true });
    expect(await status()).toMatchObject({ permanent: true, active: true, expires_at: null });
    await put({ enabled: false });
    expect(await status()).toMatchObject({ permanent: false, active: false, expires_at: null });
  });

  it.each([
    { enabled: true, permanent: true, duration_minutes: 15 },
    { enabled: true, permanent: true, duration_minutes: 60 },
    { enabled: true, permanent: false },
    { enabled: true, permanent: 'true' },
    { enabled: false, permanent: true },
  ])('永久开启不接受时长或非真值 %j', async body => {
    const { put, status } = await setup();
    expect((await put(body)).statusCode).toBe(400);
    expect(await status()).toMatchObject({ active: false, permanent: false, expires_at: null });
  });

  it('永久开启同样受正式环境与基础防护限制', async () => {
    const preview = await setup({ GEEK_DEPLOYMENT_ENVIRONMENT: 'preview' });
    const unavailable = await preview.put({ enabled: true, permanent: true });
    expect(unavailable.statusCode).toBe(409);
    expect(unavailable.json().error).toBe('decoy_unavailable');
    const shieldOff = await setup({ SHIELD_ENABLED: 'off' });
    const disabled = await shieldOff.put({ enabled: true, permanent: true });
    expect(disabled.statusCode).toBe(409);
    expect(disabled.json().error).toBe('shield_disabled');
    expect(await shieldOff.status()).toMatchObject({ active: false, permanent: false });
  });

  it('永久开启的审计失败时整体回滚', async () => {
    const { app, put, status } = await setup();
    auditFailure(app, 'security.decoy.update');
    expect((await put({ enabled: true, permanent: true })).statusCode).toBe(500);
    expect(await status()).toMatchObject({ active: false, permanent: false, expires_at: null });
  });

  it.each([true, false])('设置审计失败时整体回滚：enabled=%s', async enabled => {
    const { app, put, status } = await setup();
    if (!enabled) await put({ enabled: true, duration_minutes: 15 });
    const before = await status();
    auditFailure(app, 'security.decoy.update');
    expect((await put(enabled ? { enabled: true, duration_minutes: 15 } : { enabled: false })).statusCode).toBe(500);
    expect(await status()).toMatchObject({ active: before.active, expires_at: before.expires_at });
  });

  it.each(['GET', 'HEAD'] as const)('%s 只返回有界合成数据，命中记固定族并封禁，已有封禁优先', async method => {
    const { app, put, headers } = await setup();
    await put({ enabled: true, duration_minutes: 60 });
    const probe = { method, url: '/%2Eenv/private-marker?token=query-marker', remoteAddress: '198.51.100.51', headers: { authorization: 'Bearer credential-marker', cookie: 'other=cookie-marker', 'user-agent': 'synthetic-agent' } };
    const hit = await app.inject(probe);
    expect(hit.statusCode).toBe(200);
    expect(hit.headers['cache-control']).toBe('no-store');
    expect(hit.headers['content-type']).toMatch(/^application\/json/);
    expect(hit.headers['x-robots-tag']).toContain('noindex');
    if (method === 'HEAD') expect(hit.body).toBe('');
    else {
      expect(hit.json()).toMatchObject({ synthetic: true, data: { mode: 'simulation', access: 'none', records: [] } });
      expect(Buffer.byteLength(hit.body)).toBeLessThan(2048);
    }
    expect((await app.inject(probe)).statusCode).toBe(403);
    const hits = activityRows(app, { action: 'security.decoy.hit' });
    expect(hits).toHaveLength(1);
    expect(hits[0]).toMatchObject({ target_id: '/.env', outcome: 'denied', meta: { method, probe: '/.env', status: 200, synthetic: true } });
    expect(JSON.stringify(activityRows(app))).not.toMatch(/private-marker|query-marker|credential-marker|cookie-marker/);
    const audit = await app.inject({ url: '/api/console/activity?action=security.decoy.hit', headers });
    expect(audit.statusCode).toBe(200);
    expect(audit.json().items[0].target_id).toBe('/.env');
    const readerCookie = `sid=${signIn(app, 'security-only', 7335)}`;
    grantPermNode(app, accountIdOf(app, 'security-only'), 'security.manage');
    expect((await app.inject({ url: '/api/console/activity?action=security.decoy.hit', headers: { cookie: readerCookie } })).statusCode).toBe(403);
  });

  it('命中审计失败不返回诱饵，封禁和系统封禁记录一起回滚', async () => {
    const { app, put } = await setup();
    await put({ enabled: true, duration_minutes: 15 });
    auditFailure(app, 'security.decoy.hit');
    const probe = { url: '/.env', remoteAddress: '198.51.100.61' };
    expect((await app.inject(probe)).statusCode).toBe(500);
    expect((await app.inject({ ...probe, url: '/api/feedback/categories' })).statusCode).toBe(200);
    expect(activityRows(app, { action: 'security.block' })).toEqual([]);
    app.services.storage.db.exec('DROP TRIGGER fail_decoy_audit');
    expect((await app.inject(probe)).statusCode).toBe(200);
    expect((await app.inject(probe)).statusCode).toBe(403);
  });

  it('授权出口和外站浏览器诱导不触发诱饵，非读取方法仍拒绝', async () => {
    const { app, put } = await setup({ SHIELD_ALLOWLIST: '203.0.113.0/24' });
    await put({ enabled: true, duration_minutes: 15 });
    for (const request of [
      { url: '/.env', remoteAddress: '203.0.113.8' },
      { url: '/.env', remoteAddress: '198.51.100.71', headers: { 'sec-fetch-site': 'cross-site' } },
    ]) {
      const response = await app.inject(request);
      expect(response.statusCode).toBe(404);
      expect(response.json()).not.toHaveProperty('synthetic');
      expect((await app.inject({ ...request, url: '/api/feedback/categories' })).statusCode).toBe(200);
    }
    const post = await app.inject({ method: 'POST', url: '/.env', remoteAddress: '198.51.100.72', headers: { origin: 'https://example.test' }, payload: { secret: 'body-marker' } });
    expect(post.statusCode).toBe(404);
    expect(post.json()).not.toHaveProperty('synthetic');
    expect(activityRows(app, { action: 'security.decoy.hit' })).toEqual([]);
  });
});

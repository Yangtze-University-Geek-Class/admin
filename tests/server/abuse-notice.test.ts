import { afterEach, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { SHIELD_NOTICE, honeypotFamily, requestPath } from '../../app/server/src/lib/shield';
import { testApp } from './helpers';

/**
 * 蜜罐与法律告知（#333 追加）：扫描常见的敏感路径（`/.env`、`/wp-login.php` 等）第一次命中就封禁；被拦下的回应
 * （403 ip_blocked、429、蜜罐的 404）带一句中文 `notice`，正常回应不带。SHIELD_ENABLED=off（开发环境）时不封、不告知；
 * SHIELD_ALLOWLIST 里的来源不计分、不封，蜜罐路径也不带告知。`/.well-known/security.txt` 两种开关下都从 PUBLIC_ORIGIN 拼。
 */
const contexts: { app: FastifyInstance; close: () => Promise<void> }[] = [];
afterEach(async () => {
  for (const c of contexts.splice(0)) await c.close();
});

async function setup(env: Record<string, string> = {}) {
  const context = await testApp({}, false, env);
  contexts.push(context);
  return context.app;
}

describe('蜜罐路径与法律告知（#333 追加）', () => {
  it.each([
    '/.env',
    '/.git/config',
    '/wp-login.php',
    '/wp-admin/',
    '/phpmyadmin/',
    '/actuator/env',
    '/server-status',
    '/.aws/credentials',
  ])('%s 第一次命中：回 404 并带 notice，这个 IP 立刻被封，之后的 API 回 403 ip_blocked', async url => {
    const app = await setup();
    const trap = await app.inject({ method: 'GET', url, remoteAddress: '198.51.100.50' });
    expect(trap.statusCode).toBe(404);
    expect(trap.json()).toMatchObject({ error: 'not_found', notice: SHIELD_NOTICE });

    const after = await app.inject({ method: 'GET', url: '/api/feedback/categories', remoteAddress: '198.51.100.50' });
    expect(after.statusCode).toBe(403);
    expect(after.json()).toMatchObject({ error: 'ip_blocked', retry_after: 900, notice: SHIELD_NOTICE });
  });

  it('正常页面、API 与普通的 404 都不带 notice', async () => {
    const app = await setup();
    const ok = await app.inject({ method: 'GET', url: '/api/feedback/categories', remoteAddress: '198.51.100.60' });
    expect(ok.statusCode).toBe(200);
    expect(ok.json()).not.toHaveProperty('notice');

    const missing = await app.inject({ method: 'GET', url: '/api/no-such-thing', remoteAddress: '198.51.100.60' });
    expect(missing.statusCode).toBe(404);
    expect(missing.json()).not.toHaveProperty('notice');
  });

  it('429 带 notice：超过路由限额的回应里有法律告知', async () => {
    const app = await setup();
    let last = await app.inject({ method: 'POST', url: '/api/feedback', remoteAddress: '198.51.100.70', payload: {} });
    for (let i = 0; i < 10; i += 1) last = await app.inject({ method: 'POST', url: '/api/feedback', remoteAddress: '198.51.100.70', payload: {} });
    expect(last.statusCode).toBe(429);
    expect(last.json()).toMatchObject({ notice: SHIELD_NOTICE });
  });

  it.each([
    ['/.env', '/.env'], ['/.env.bak', '/.env'], ['/.git/config', '/.git/'],
    ['/wp-login.php', '/wp-login.php'], ['/actuator/env', '/actuator/'], ['/server-status', '/server-status'],
    ['/.aws/credentials?x=1', '/.aws/'], ['/%2Eenv', '/.env'], ['/%2egit/config', '/.git/'],
    ['//.env', '/.env'], ['/WP-%4Cogin.php', '/wp-login.php'], ['/x/../.env', '/.env'],
    ['/./.aws/credentials', '/.aws/'],
  ])('将 %s 规整一次后归入固定探针族 %s', (url, family) => {
    expect(honeypotFamily(requestPath(url))).toBe(family);
  });

  it.each(['/', '/.well-known/security.txt', '/robots.txt', '/api/feedback/categories', '/sites/portal/main.tsx', '/admin/x',
    '/%252Eenv', '/%E0%A4%A', '/api/%2Eenv', '/forum/t/wp-admin'])('正常路径或双重/坏编码 %s 不算蜜罐', url => {
    expect(honeypotFamily(requestPath(url))).toBeUndefined();
  });

  it.each(['/%2Eenv', '//.env', '/.%67it/config'])('编码过的蜜罐路径 %s 同样封禁', async url => {
    const app = await setup();
    const trap = await app.inject({ method: 'GET', url, remoteAddress: '198.51.100.51' });
    expect(trap.statusCode).toBe(404);
    expect(trap.json()).toMatchObject({ error: 'not_found', notice: SHIELD_NOTICE });
    const after = await app.inject({ method: 'GET', url: '/api/feedback/categories', remoteAddress: '198.51.100.51' });
    expect(after.json()).toMatchObject({ error: 'ip_blocked' });
  });

  it('两层编码的路径不是蜜罐：普通 404，不带 notice，不封', async () => {
    const app = await setup();
    const miss = await app.inject({ method: 'GET', url: '/%252Eenv', remoteAddress: '198.51.100.52' });
    expect(miss.statusCode).toBe(404);
    expect(miss.json()).not.toHaveProperty('notice');
    expect((await app.inject({ method: 'GET', url: '/api/feedback/categories', remoteAddress: '198.51.100.52' })).statusCode).toBe(200);
  });

  it('被封禁的来源仍能取到 security.txt，别的路径照样 403', async () => {
    const app = await setup();
    await app.inject({ method: 'GET', url: '/.env', remoteAddress: '198.51.100.53' });
    const txt = await app.inject({ method: 'GET', url: '/.well-known/security.txt', remoteAddress: '198.51.100.53' });
    expect(txt.statusCode).toBe(200);
    expect(txt.headers['content-type']).toMatch(/^text\/plain/);
    expect(txt.body).toContain('Contact: https://example.test/?open=feedback\n');
    expect((await app.inject({ method: 'GET', url: '/api/feedback/categories', remoteAddress: '198.51.100.53' })).json()).toMatchObject({ error: 'ip_blocked' });
  });

  it('SHIELD_ALLOWLIST 里的来源超过路由限额：429 照回，但不带 notice、不记分', async () => {
    const app = await setup({ SHIELD_ALLOWLIST: '198.51.100.71' });
    let last = await app.inject({ method: 'POST', url: '/api/feedback', remoteAddress: '198.51.100.71', payload: {} });
    for (let i = 0; i < 10; i += 1) last = await app.inject({ method: 'POST', url: '/api/feedback', remoteAddress: '198.51.100.71', payload: {} });
    expect(last.statusCode).toBe(429);
    expect(last.json()).toMatchObject({ error: 'rate_limited' });
    expect(last.json()).not.toHaveProperty('notice');
    expect(app.services.storage.db.prepare('SELECT COUNT(*) AS n FROM shield_signals WHERE ip = ?').get('198.51.100.71')).toEqual({ n: 0 });
  });

  it('SHIELD_ENABLED=off：429 照回但不带 notice，不记分', async () => {
    const app = await setup({ SHIELD_ENABLED: 'off' });
    let last = await app.inject({ method: 'POST', url: '/api/feedback', remoteAddress: '198.51.100.72', payload: {} });
    for (let i = 0; i < 10; i += 1) last = await app.inject({ method: 'POST', url: '/api/feedback', remoteAddress: '198.51.100.72', payload: {} });
    expect(last.statusCode).toBe(429);
    expect(last.json()).not.toHaveProperty('notice');
    expect(app.services.storage.db.prepare('SELECT COUNT(*) AS n FROM shield_signals').get()).toEqual({ n: 0 });
  });

  it('SHIELD_ENABLED=off（开发环境）：蜜罐路径不封、不带 notice，之后的 API 照常 200', async () => {
    const app = await setup({ SHIELD_ENABLED: 'off' });
    const trap = await app.inject({ method: 'GET', url: '/.env', remoteAddress: '198.51.100.90' });
    expect(trap.statusCode).toBe(404);
    expect(trap.json()).not.toHaveProperty('notice');
    const after = await app.inject({ method: 'GET', url: '/api/feedback/categories', remoteAddress: '198.51.100.90' });
    expect(after.statusCode).toBe(200);
  });

  it('SHIELD_ENABLED 只认 on 或 off，写错启动失败', async () => {
    await expect(setup({ SHIELD_ENABLED: 'maybe' })).rejects.toThrow('SHIELD_ENABLED must be on or off');
  });

  it('SHIELD_ALLOWLIST 里的来源：蜜罐路径不封、不带 notice，之后的 API 照常 200', async () => {
    const app = await setup({ SHIELD_ALLOWLIST: '198.51.100.0/24' });
    const trap = await app.inject({ method: 'GET', url: '/.env', remoteAddress: '198.51.100.50' });
    expect(trap.statusCode).toBe(404);
    expect(trap.json()).not.toHaveProperty('notice');
    const after = await app.inject({ method: 'GET', url: '/api/feedback/categories', remoteAddress: '198.51.100.50' });
    expect(after.statusCode).toBe(200);
  });

  it('/.well-known/security.txt 按 RFC 9116 写，Contact 从 PUBLIC_ORIGIN 拼，Expires 在将来', async () => {
    const app = await setup();
    const res = await app.inject({ method: 'GET', url: '/.well-known/security.txt', remoteAddress: '198.51.100.80' });
    expect(res.statusCode).toBe(200);
    expect(res.headers['content-type']).toMatch(/^text\/plain/);
    expect(res.body).toContain('Contact: https://example.test/?open=feedback\n');
    expect(res.body).toContain('Preferred-Languages: zh, en\n');
    const expires = /^Expires: (.+)$/m.exec(res.body)?.[1] ?? '';
    expect(expires).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/);
    expect(Date.parse(expires)).toBeGreaterThan(Date.now());
  });
});

/**
 * 外站让访客浏览器发来的请求（#333）：浏览器写 `Sec-Fetch-Site: cross-site`、没有 Origin 或 Origin 是别的站。外站页面用
 * `<img src="https://本站/.env">` 或循环请求限流接口，不能让访客（以及同一校园出口后面的所有人）被封；但这只是线索，
 * 生效中的封禁、Origin 核对与路由限流照旧。
 */
describe('外站诱导的浏览器请求不计分、不触发蜜罐（#333）', () => {
  const signals = (app: FastifyInstance, ip: string) => app.services.storage.db.prepare('SELECT COUNT(*) AS n FROM shield_signals WHERE ip = ?').get(ip);

  it.each([
    { name: '没有 Origin', headers: { 'sec-fetch-site': 'cross-site' } },
    { name: 'Origin 是外站', headers: { 'sec-fetch-site': 'cross-site', origin: 'https://evil.test' } },
  ])('$name 的跨站请求命中蜜罐：普通 404，不封，不带 notice', async ({ headers }) => {
    const app = await setup();
    const trap = await app.inject({ method: 'GET', url: '/.env', remoteAddress: '198.51.100.110', headers });
    expect(trap.statusCode).toBe(404);
    expect(trap.json()).not.toHaveProperty('notice');
    expect(app.services.storage.db.prepare('SELECT COUNT(*) AS n FROM ip_blocks WHERE ip = ?').get('198.51.100.110')).toEqual({ n: 0 });
    expect((await app.inject({ method: 'GET', url: '/api/feedback/categories', remoteAddress: '198.51.100.110' })).statusCode).toBe(200);
  });

  it.each([
    { name: '直接请求（没有 Fetch Metadata）', headers: {} },
    { name: '本站页面发的（same-origin）', headers: { 'sec-fetch-site': 'same-origin' } },
    { name: 'Origin 写成本站却说 cross-site（伪造的头）', headers: { 'sec-fetch-site': 'cross-site', origin: 'https://example.test' } },
  ])('$name 命中蜜罐照样封禁', async ({ headers }) => {
    const app = await setup();
    const trap = await app.inject({ method: 'GET', url: '/.env', remoteAddress: '198.51.100.111', headers });
    expect(trap.json()).toMatchObject({ error: 'not_found', notice: SHIELD_NOTICE });
    expect((await app.inject({ method: 'GET', url: '/api/feedback/categories', remoteAddress: '198.51.100.111' })).json()).toMatchObject({ error: 'ip_blocked' });
  });

  it('跨站请求不解除生效中的封禁', async () => {
    const app = await setup();
    await app.inject({ method: 'GET', url: '/.env', remoteAddress: '198.51.100.112' });
    const crossSite = await app.inject({ method: 'GET', url: '/api/feedback/categories', remoteAddress: '198.51.100.112', headers: { 'sec-fetch-site': 'cross-site' } });
    expect(crossSite.statusCode).toBe(403);
    expect(crossSite.json()).toMatchObject({ error: 'ip_blocked' });
  });

  it('跨站请求照样受路由限流（第 21 次 429），只是 429 不计分；同样的直接请求计分', async () => {
    const app = await setup();
    const volley = async (ip: string, headers: Record<string, string>) => {
      const statuses: number[] = [];
      for (let i = 0; i < 21; i += 1) statuses.push((await app.inject({ method: 'GET', url: '/auth/github', remoteAddress: ip, headers })).statusCode);
      return statuses;
    };
    expect((await volley('198.51.100.113', { 'sec-fetch-site': 'cross-site' })).at(-1)).toBe(429);
    expect(signals(app, '198.51.100.113')).toEqual({ n: 0 });
    expect((await volley('198.51.100.114', {})).at(-1)).toBe(429);
    expect(signals(app, '198.51.100.114')).toEqual({ n: 1 });
  });

  it('Origin 核对照旧：跨站 POST 回 403 invalid_origin，不建设备码、不占全站上限', async () => {
    const app = await setup({ SITE_QUOTA_DEVICE_CODE_DAILY: '1' });
    const crossSite = await app.inject({ method: 'POST', url: '/auth/device/code', remoteAddress: '198.51.100.115', headers: { 'sec-fetch-site': 'cross-site' }, payload: { client_id: 'geek-cli' } });
    expect(crossSite.statusCode).toBe(403);
    expect(crossSite.json()).toMatchObject({ error: 'invalid_origin' });
    // 全站上限只给同源的请求用掉：唯一的一个名额还在，用掉之后同源的下一次照样 429
    expect((await app.inject({ method: 'POST', url: '/auth/device/code', remoteAddress: '198.51.100.116', payload: { client_id: 'geek-cli' } })).statusCode).toBe(200);
    expect((await app.inject({ method: 'POST', url: '/auth/device/code', remoteAddress: '198.51.100.117', payload: { client_id: 'geek-cli' } })).json()).toMatchObject({ error: 'site_quota_exceeded' });
  });
});

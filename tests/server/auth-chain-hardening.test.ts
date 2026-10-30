import { afterEach, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { signIn, testApp } from './helpers';

/**
 * 账号与登录链路的回归用例（PENTEST-20261029）：
 * - finding 9/11：站内用户名/昵称能改成官方账号名，匿名 /api/forum/state 出现两个同名账号；
 * - finding 31：重复的 state 查询参数把 OAuth 回调打成 500。
 * 每条都对着一个判断，改回去就会红。
 */
const contexts: Awaited<ReturnType<typeof testApp>>[] = [];
afterEach(async () => { for (const context of contexts.splice(0)) await context.close(); });

async function setup(env: Record<string, string> = {}) {
  const context = await testApp({}, false, env);
  contexts.push(context);
  return context;
}

/** 官方账号（forum_users 里 kind = official，没有 account_id）——报告里被冒名的 geekclass 就是这种。 */
function seedOfficial(app: FastifyInstance, username: string, displayName: string) {
  const now = Date.now();
  // 夹具里已经有官方账号也无所谓：只保证这个用户名下有一行 kind = official
  if (app.services.storage.db.prepare("SELECT 1 FROM forum_users WHERE username = ? COLLATE NOCASE").get(username)) return;
  app.services.storage.db.prepare(
    `INSERT INTO forum_users(id, kind, username, display_name, bio, avatar_color, role, notify_reply, notify_like, notify_follow, joined_at, updated_at)
     VALUES(?, 'official', ?, ?, '', '#2f6fed', 'admin', 0, 0, 0, ?, ?)`,
  ).run(`u-${username}`, username, displayName, now, now);
}

describe('站内用户名不能冒用官方账号（finding 9/11）', () => {
  it('把 username 改成官方账号名回 409，正常的名字照常能改', async () => {
    const { app } = await setup();
    seedOfficial(app, 'site_official', '站点官方');
    const cookie = `sid=${signIn(app, 'squatter', 301)}`;
    const taken = await app.inject({ method: 'PATCH', url: '/api/identity/profile', headers: { cookie }, payload: { username: 'site_official' } });
    expect([taken.statusCode, taken.json().error]).toEqual([409, 'username_taken']);
    const ok = await app.inject({ method: 'PATCH', url: '/api/identity/profile', headers: { cookie }, payload: { username: 'squatter_ok' } });
    expect(ok.statusCode).toBe(200);
  });

  it('昵称也不能用官方账号的显示名，@ 提及不会指错人', async () => {
    const { app } = await setup();
    seedOfficial(app, 'site_official', '站点官方');
    const cookie = `sid=${signIn(app, 'nickuser', 302)}`;
    const taken = await app.inject({ method: 'PATCH', url: '/api/identity/profile', headers: { cookie }, payload: { display_name: '站点官方' } });
    expect([taken.statusCode, taken.json().error]).toEqual([409, 'display_name_taken']);
  });

  it('登录名和官方用户名只差连字符/下划线时也不能用（nameKey 归一后撞名）', async () => {
    const { app } = await setup();
    seedOfficial(app, 'site_official', '站点官方');
    // GitHub 登录名允许 -，nameKey 会把它去掉，和官方用户名 site_official 撞成同一个
    const cookie = `sid=${signIn(app, 'site-official', 304)}`;
    const res = await app.inject({ method: 'PATCH', url: '/api/identity/profile', headers: { cookie }, payload: { display_name: 'site_official' } });
    expect([res.statusCode, res.json().error]).toEqual([409, 'display_name_taken']);
  });

  it('改回自己原来的名字不算占用', async () => {
    const { app } = await setup();
    const cookie = `sid=${signIn(app, 'selfkeep', 303)}`;
    const before = (await app.inject({ url: '/api/identity/profile', headers: { cookie } })).json().username as string;
    const res = await app.inject({ method: 'PATCH', url: '/api/identity/profile', headers: { cookie }, payload: { username: before } });
    expect(res.statusCode).toBe(200);
  });
});

describe('OAuth 回调对重复 state 不 500（finding 31）', () => {
  it('state 重复时回 400 invalid_state', async () => {
    const { app } = await setup();
    const res = await app.inject({ url: '/auth/callback?state=a&state=b&code=x' });
    expect([res.statusCode, res.json().error]).toEqual([400, 'invalid_state']);
    const single = await app.inject({ url: '/auth/callback?state=a&code=x' });
    expect([single.statusCode, single.json().error]).toEqual([400, 'invalid_state']);
  });
});

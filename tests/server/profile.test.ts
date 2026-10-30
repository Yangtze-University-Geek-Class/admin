import { createHash } from 'node:crypto';
import { afterEach, describe, expect, it } from 'vitest';
import { testApp, signIn } from './helpers';

/**
 * 账号资料、头像与邀请码兑换（#274 CONTRACT §2），以及公开的部门列表（CONTRACT §1）。
 * 一张 2×2 的真实 PNG（sharp 生成后转出的 hex，像素内容不重要），libspng 能正常解码出完整像素数据；
 * 手搓的「假 PNG」字节即使 metadata 能读出 format，IDAT 段的 zlib 流/CRC 对不上，解码像素时仍会报
 * `pngload_buffer: libspng read error`，必须用真实编码器产出的字节才能和真实上传行为一致。
 */
const PNG_2X2 = Buffer.from(
  '89504e470d0a1a0a0000000d494844520000000200000002080600000072b60d240000000970485973000003e8000003e801b57b526b0000001149444154789c63f8cfc0f01f8419600c0047ca07f967596eb70000000049454e44ae426082',
  'hex',
);

const contexts: Awaited<ReturnType<typeof testApp>>[] = [];
afterEach(async () => { for (const c of contexts.splice(0)) await c.close(); });

async function setup() {
  const context = await testApp();
  contexts.push(context);
  const { app } = context;
  const sid = signIn(app, 'profile-owner', 101);
  const cookie = `sid=${sid}`;
  return { app, cookie, sid };
}

describe('账号资料（GET/PATCH /api/identity/profile，#274）', () => {
  it('新账号第一次读资料就有一份兜底资料，不是 500', async () => {
    const { app, cookie } = await setup();
    const res = await app.inject({ url: '/api/identity/profile', headers: { cookie } });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body).toMatchObject({ bio: '', avatar_url: null, prefs: {} });
    expect(body.username).toMatch(/^[a-z0-9_]{3,24}$/);
  });

  it('没登录读资料回 401', async () => {
    const { app } = await setup();
    const res = await app.inject({ url: '/api/identity/profile' });
    expect(res.statusCode).toBe(401);
    expect(res.json().error).toBe('not_signed_in');
  });

  it('改昵称、简介、用户名与偏好；偏好是合并写不是整份替换', async () => {
    const { app, cookie } = await setup();
    const first = await app.inject({ method: 'PATCH', url: '/api/identity/profile', headers: { cookie }, payload: { display_name: '极客', bio: '你好', prefs: { forum_theme: 'sky' } } });
    expect(first.statusCode).toBe(200);
    expect(first.json()).toMatchObject({ display_name: '极客', bio: '你好', prefs: { forum_theme: 'sky' } });
    const second = await app.inject({ method: 'PATCH', url: '/api/identity/profile', headers: { cookie }, payload: { username: 'fixture_test', prefs: { start_note_seen_at: 123 } } });
    expect(second.statusCode).toBe(200);
    // 第二次没传 forum_theme，应该还在；新传的 start_note_seen_at 也要在，证明是合并写
    expect(second.json()).toMatchObject({ username: 'fixture_test', display_name: '极客', prefs: { forum_theme: 'sky', start_note_seen_at: 123 } });
  });

  it('用户名被占用回 409', async () => {
    const { app, cookie } = await setup();
    const other = signIn(app, 'other-user', 102);
    await app.inject({ method: 'PATCH', url: '/api/identity/profile', headers: { cookie: `sid=${other}` }, payload: { username: 'taken_name' } });
    const res = await app.inject({ method: 'PATCH', url: '/api/identity/profile', headers: { cookie }, payload: { username: 'taken_name' } });
    expect(res.statusCode).toBe(409);
    expect(res.json().error).toBe('username_taken');
  });

  // PATCH 的 username 合同只收纯小写（^[a-z0-9_]{3,24}$，CONTRACT-274 §2），大小写不敏感只在唯一性判定上生效
  // ——保护的是不走这条 PATCH 写入的旧数据（例如迁移脚本按 GitHub 登录名生成的默认用户名）。直接写一行大小写混合的
  // 记录来模拟这种数据，而不是把一个不合法的大小写输入发去 PATCH（那只会被合同挡在校验层，回 400，测不到这条判断）。
  it('占用判定不分大小写：已有一行大写记录时，小写同名也算占用', async () => {
    const { app, cookie } = await setup();
    signIn(app, 'other-user', 102);
    const db = app.services.storage.db;
    const otherAccountId = (db.prepare("SELECT openid FROM sessions WHERE login = 'other-user'").get() as { openid: string }).openid;
    app.services.profiles.get(otherAccountId); // ensure() 先建兜底资料行，才能 UPDATE
    db.prepare('UPDATE account_profiles SET username = ? WHERE account_id = ?').run('Taken_Name', otherAccountId);
    const res = await app.inject({ method: 'PATCH', url: '/api/identity/profile', headers: { cookie }, payload: { username: 'taken_name' } });
    expect(res.statusCode).toBe(409);
    expect(res.json().error).toBe('username_taken');
  });

  it('改回自己原来的用户名不算占用', async () => {
    const { app, cookie } = await setup();
    const before = (await app.inject({ url: '/api/identity/profile', headers: { cookie } })).json().username as string;
    const res = await app.inject({ method: 'PATCH', url: '/api/identity/profile', headers: { cookie }, payload: { username: before } });
    expect(res.statusCode).toBe(200);
  });
});

describe('账号头像（PUT /api/identity/avatar、GET /api/identity/avatar/:file，#274）', () => {
  it('上传一张真实 PNG，转成方形 WebP，按内容哈希可以直接取回', async () => {
    const { app, cookie } = await setup();
    const put = await app.inject({ method: 'PUT', url: '/api/identity/avatar', headers: { cookie, 'content-type': 'image/png' }, payload: PNG_2X2 });
    expect(put.statusCode).toBe(200);
    const { avatar_url } = put.json() as { avatar_url: string };
    expect(avatar_url).toMatch(/^\/api\/identity\/avatar\/[0-9a-f]{64}\.webp$/);
    const get = await app.inject({ url: avatar_url });
    expect(get.statusCode).toBe(200);
    expect(get.headers['content-type']).toBe('image/webp');
    expect(get.headers['cache-control']).toContain('immutable');
    // 资料里也要能看到新头像
    const profile = await app.inject({ url: '/api/identity/profile', headers: { cookie } });
    expect(profile.json().avatar_url).toBe(avatar_url);
  });

  it('不支持的类型回 415，不是图片的字节回 400', async () => {
    const { app, cookie } = await setup();
    const badType = await app.inject({ method: 'PUT', url: '/api/identity/avatar', headers: { cookie, 'content-type': 'application/pdf' }, payload: Buffer.from('not an image') });
    expect(badType.statusCode).toBe(415);
    const badBytes = await app.inject({ method: 'PUT', url: '/api/identity/avatar', headers: { cookie, 'content-type': 'image/png' }, payload: Buffer.from('not actually a png') });
    expect(badBytes.statusCode).toBe(400);
    expect(badBytes.json().error).toBe('invalid_image');
  });

  it('不存在的哈希回 404', async () => {
    const { app } = await setup();
    const res = await app.inject({ url: `/api/identity/avatar/${'0'.repeat(64)}.webp` });
    expect(res.statusCode).toBe(404);
  });
});

describe('邀请码兑换（POST /api/identity/invite/redeem，#274）', () => {
  it('有效邀请码：注册用户变成极客班成员', async () => {
    const { app, cookie } = await setup();
    app.services.invites.create({ code: 'redeem-ok' }, 'test');
    const res = await app.inject({ method: 'POST', url: '/api/identity/invite/redeem', headers: { cookie }, payload: { code: 'redeem-ok' } });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ level: 'member' });
    // sessions.openid 存的是账号 id（lib/auth.ts 的历史命名，来自 #262 之前的 GitHub openid）
    const accountId = (app.services.storage.db.prepare('SELECT openid FROM sessions').get() as { openid: string }).openid;
    expect(app.services.permissions.check(accountId, 'forum.topic.create')).toBe(true);
  });

  it('无效邀请码回 400，已是成员回 409', async () => {
    const { app, cookie } = await setup();
    const bad = await app.inject({ method: 'POST', url: '/api/identity/invite/redeem', headers: { cookie }, payload: { code: 'does-not-exist' } });
    expect(bad.statusCode).toBe(400);
    expect(bad.json().error).toBe('invite_invalid');
    app.services.invites.create({ code: 'redeem-twice' }, 'test');
    await app.inject({ method: 'POST', url: '/api/identity/invite/redeem', headers: { cookie }, payload: { code: 'redeem-twice' } });
    const again = await app.inject({ method: 'POST', url: '/api/identity/invite/redeem', headers: { cookie }, payload: { code: 'redeem-twice' } });
    expect(again.statusCode).toBe(409);
    expect(again.json().error).toBe('already_member');
  });

  it('账号 1 小时内猜错 10 次锁 1 小时：锁定期间给真邀请码也拒绝，不白升级成成员（#274）', async () => {
    const { app, cookie } = await setup();
    const db = app.services.storage.db;
    const accountId = (db.prepare('SELECT openid FROM sessions').get() as { openid: string }).openid;
    const now = Date.now();
    // 直接写 9 条失败记录模拟之前已经猜错过 9 次：绕开按请求计数、不分成败的通用限流（10 次/小时按账号）
    for (let i = 0; i < 9; i++) db.prepare('INSERT INTO limit_events(bucket, subject, at) VALUES (?, ?, ?)').run('invite.redeem.fail.account', accountId, now - 1000);
    // 第 10 次猜错：锁定检查在计数之前，这次还没到线，回的是普通的 invite_invalid
    const tenth = await app.inject({ method: 'POST', url: '/api/identity/invite/redeem', headers: { cookie }, payload: { code: 'still-wrong' } });
    expect(tenth.statusCode).toBe(400);
    expect(tenth.json().error).toBe('invite_invalid');
    // 第 11 次：就算这次给的是真的有效邀请码，也被锁定挡住
    app.services.invites.create({ code: 'late-valid' }, 'test');
    const locked = await app.inject({ method: 'POST', url: '/api/identity/invite/redeem', headers: { cookie }, payload: { code: 'late-valid' } });
    expect(locked.statusCode).toBe(429);
    expect(locked.json()).toMatchObject({ error: 'rate_limited', bucket: 'invite.redeem.fail.account', retry_after: 3600 });
    expect(app.services.permissions.check(accountId, 'forum.topic.create')).toBe(false);
  });

  it('同一个 IP 1 小时内（不同账号）攒够 20 次猜错，也锁 1 小时（#274）', async () => {
    const { app, cookie } = await setup();
    const db = app.services.storage.db;
    const ip = '203.0.113.9';
    // limit_events 存的是 IP 的哈希，不是原文（和 lib/identity-store.ts 的 hashIp 同一个算法，profile.ts 的
    // 兑换接口现在也直接导入它，不再自己另写一份）。
    const ipHash = createHash('sha256').update(ip).digest('hex');
    const now = Date.now();
    for (let i = 0; i < 19; i++) db.prepare('INSERT INTO limit_events(bucket, subject, at) VALUES (?, ?, ?)').run('invite.redeem.fail.ip', ipHash, now - 1000);
    const twentieth = await app.inject({ method: 'POST', url: '/api/identity/invite/redeem', headers: { cookie }, remoteAddress: ip, payload: { code: 'still-wrong' } });
    expect(twentieth.statusCode).toBe(400);
    expect(twentieth.json().error).toBe('invite_invalid');
    app.services.invites.create({ code: 'ip-late-valid' }, 'test');
    const locked = await app.inject({ method: 'POST', url: '/api/identity/invite/redeem', headers: { cookie }, remoteAddress: ip, payload: { code: 'ip-late-valid' } });
    expect(locked.statusCode).toBe(429);
    expect(locked.json()).toMatchObject({ error: 'rate_limited', bucket: 'invite.redeem.fail.ip' });
  });
});

describe('公开的部门与称号列表（GET /api/public/departments，#274）', () => {
  it('6 个新部门按顺序排列，无部门排最后，每个部门按权重带出部员/副部长/部长', async () => {
    const { app } = await setup();
    const res = await app.inject({ url: '/api/public/departments' });
    expect(res.statusCode).toBe(200);
    const { departments } = res.json() as { departments: { id: string; titles: { id: string; weight: number }[] }[] };
    expect(departments.map(d => d.id)).toEqual(['dept.ai', 'dept.algo', 'dept.hardware', 'dept.security', 'dept.management', 'dept.none']);
    const ai = departments.find(d => d.id === 'dept.ai')!;
    expect(ai.titles.map(t => t.id)).toEqual(['title.ai.staff', 'title.ai.deputy', 'title.ai.head']);
    const none = departments.find(d => d.id === 'dept.none')!;
    expect(none.titles).toEqual([]);
  });
});

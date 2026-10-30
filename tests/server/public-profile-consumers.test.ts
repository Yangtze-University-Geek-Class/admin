import { afterEach, describe, expect, it } from 'vitest';
import type { InjectOptions } from 'fastify';
import type { ForumStateBody, ForumUser } from '../../app/server/src/lib/forum-store';
import { createForumStore } from '../../app/server/src/lib/forum-store';
import { processAvatar } from '../../app/server/src/lib/forum-avatar';
import { DEVICE_GRANT_TYPE } from '../../app/server/src/lib/device-store';
import { accountIdOf, grantPermGroup, signIn, testApp } from './helpers';

const PNG = Buffer.from(
  '89504e470d0a1a0a0000000d494844520000000200000002080600000072b60d240000000970485973000003e8000003e801b57b526b0000001149444154789c63f8cfc0f01f8419600c0047ca07f967596eb70000000049454e44ae426082',
  'hex',
);
const contexts: Awaited<ReturnType<typeof testApp>>[] = [];
afterEach(async () => { for (const context of contexts.splice(0)) await context.close(); });

async function setup(overrides: Parameters<typeof testApp>[0] = {}) {
  const context = await testApp(overrides);
  contexts.push(context);
  const { app } = context;
  const origin = 'https://example.test';
  const fetch = async (url: string, init: RequestInit = {}) => {
    expect(new URL(url).origin).toBe(origin);
    const response = await app.inject({
      method: (init.method ?? 'GET').toUpperCase() as InjectOptions['method'], url,
      headers: Object.fromEntries(new Headers(init.headers)),
      payload: init.body instanceof Uint8Array ? Buffer.from(init.body) : init.body as string | undefined,
    });
    const headers = new Headers();
    for (const [name, value] of Object.entries(response.headers)) {
      if (value !== undefined) headers.set(name, String(value));
    }
    return new Response(new Uint8Array(response.rawPayload), { status: response.statusCode, headers });
  };
  const author = signIn(app, 'profile-author', 92101, 'https://avatars.githubusercontent.com/test/author.png');
  const reader = signIn(app, 'profile-reader', 92102);
  grantPermGroup(app, accountIdOf(app, 'profile-author'), 'level.member');
  const request = (path: string, sid?: string, method = 'GET', body?: unknown) => fetch(`${origin}${path}`, {
    method,
    headers: {
      ...(sid ? { cookie: `sid=${sid}` } : {}),
      ...(method !== 'GET' ? { origin: 'https://example.test' } : {}),
      ...(body === undefined ? {} : { 'content-type': Buffer.isBuffer(body) ? 'image/png' : 'application/json' }),
    },
    body: body === undefined ? undefined : Buffer.isBuffer(body) ? new Uint8Array(body) : JSON.stringify(body),
  });
  return { app, author, reader, origin, request, fetch };
}

async function authorize(request: Awaited<ReturnType<typeof setup>>['request'], sid: string) {
  const issued = await request('/auth/device/code', undefined, 'POST', { client_id: 'geek-cli', scope: 'openid profile forum' });
  expect(issued.status).toBe(200);
  const code = await issued.json();
  const approved = await request('/api/identity/device/approve', sid, 'POST', { user_code: code.user_code, decision: 'approve' });
  expect(approved.status).toBe(200);
  const polled = await request('/auth/device/token', undefined, 'POST', {
    grant_type: DEVICE_GRANT_TYPE, client_id: 'geek-cli', device_code: code.device_code,
  });
  expect(polled.status).toBe(200);
  return (await polled.json()).access_token as string;
}

describe('统一公开资料的真实 HTTP 消费者', () => {
  it('canonical 空昵称和空头像按当前 GitHub 绑定回退，不要求历史作者再次访问论坛', async () => {
    const { app, author, reader, request } = await setup();
    const accountId = accountIdOf(app, 'profile-author');
    const initial = await request('/api/forum/state', author);
    expect(initial.status).toBe(200);
    const authorId = (await initial.json()).state.viewer.userId as string;
    const canonical = await (await request('/api/identity/profile', author)).json() as {
      username: string; display_name: string; avatar_url: string | null;
    };
    expect(canonical).toMatchObject({ display_name: '', avatar_url: null });

    signIn(app, 'profile-renamed', 92101, 'https://avatars.githubusercontent.com/test/renamed.png');
    expect(accountIdOf(app, 'profile-renamed')).toBe(accountId);

    for (const sid of [reader, undefined]) {
      const response = await request('/api/forum/state', sid);
      expect(response.status).toBe(200);
      const projected = (await response.json()).state.users.find((user: ForumUser) => user.id === authorId);
      expect(projected).toMatchObject({
        id: authorId,
        username: canonical.username,
        displayName: 'profile-renamed',
        avatarUrl: 'https://avatars.githubusercontent.com/test/renamed.png',
      });
      expect(projected).not.toHaveProperty('email');
      expect(projected).not.toHaveProperty('real_name');
      expect(projected).not.toHaveProperty('account_id');
    }

    const search = await request('/api/forum/search?q=profile-renamed', reader);
    expect(search.status).toBe(200);
    expect((await search.json()).results.users).toEqual([expect.objectContaining({
      id: authorId,
      username: canonical.username,
      displayName: 'profile-renamed',
      avatarUrl: 'https://avatars.githubusercontent.com/test/renamed.png',
    })]);
    const oldSearch = await request('/api/forum/search?q=profile-author', reader);
    expect(oldSearch.status).toBe(200);
    expect((await oldSearch.json()).results.users).toEqual([]);
    const suggest = await request('/api/forum/users/suggest?q=profile-renamed', reader);
    expect(suggest.status).toBe(200);
    expect((await suggest.json()).users).toEqual([{
      username: canonical.username,
      display_name: 'profile-renamed',
      avatar_url: 'https://avatars.githubusercontent.com/test/renamed.png',
    }]);
  });

  it('作者只改门户资料、不再访问论坛，另一账号和游客立即看到话题作者的新资料和真实头像', async () => {
    const { author, reader, request } = await setup();
    const created = await request('/api/forum/topics', author, 'POST', {
      title: '公开资料回归', categoryId: 'c-ai', content: '作者之后只访问门户', tags: [],
    });
    expect(created.status).toBe(201);
    const write = await created.json();
    const authorId = write.viewer.userId as string;
    const topicId = write.changes.topics[0].id as string;
    const patch = await request('/api/identity/profile', author, 'PATCH', {
      username: 'unified_author', display_name: '统一昵称', bio: '统一简介\n第二行',
    });
    expect(patch.status).toBe(200);
    const upload = await request('/api/identity/avatar', author, 'PUT', PNG);
    expect(upload.status).toBe(200);
    const { avatar_url } = await upload.json() as { avatar_url: string };
    const image = await request(avatar_url);
    expect(image.status).toBe(200);
    expect(image.headers.get('content-type')).toBe('image/webp');
    expect((await image.arrayBuffer()).byteLength).toBeGreaterThan(100);

    for (const sid of [reader, undefined]) {
      const stateResponse = await request('/api/forum/state', sid);
      expect(stateResponse.status).toBe(200);
      const { state } = await stateResponse.json() as { state: ForumStateBody };
      const profile = state.users.find(user => user.id === authorId) as ForumUser;
      expect(profile).toMatchObject({
        id: authorId, username: 'unified_author', displayName: '统一昵称', bio: '统一简介\n第二行', avatarUrl: avatar_url,
      });
      expect(profile).not.toHaveProperty('real_name');
      expect(profile).not.toHaveProperty('email');
      expect(profile).not.toHaveProperty('account_id');
      const posts = await request(`/api/forum/topics/${topicId}/posts`, sid);
      expect(posts.status).toBe(200);
      expect((await posts.json()).posts[0].authorId).toBe(authorId);
    }
  });

  it('设备 userinfo 立即读统一资料，保留 account_id/sub 和 GitHub uid，不公开邮箱或实名', async () => {
    const { app, author, origin, request, fetch } = await setup();
    const accountId = accountIdOf(app, 'profile-author');
    const token = await authorize(request, author);
    const read = async () => {
      const response = await fetch(`${origin}/auth/device/userinfo`, { headers: { authorization: `Bearer ${token}` } });
      expect(response.status).toBe(200);
      return response.json();
    };
    const before = await read();
    const patched = await request('/api/identity/profile', author, 'PATCH', { username: 'device_author', display_name: '设备昵称', bio: '设备简介' });
    expect(patched.status).toBe(200);
    const upload = await request('/api/identity/avatar', author, 'PUT', PNG);
    expect(upload.status).toBe(200);
    const { avatar_url } = await upload.json();
    const after = await read();
    expect(after).toMatchObject({
      sub: accountId, account_id: accountId, login: 'profile-author',
      username: 'device_author', display_name: '设备昵称', bio: '设备简介', avatar_url,
    });
    expect(after.sub).toBe(before.sub);
    expect(after).not.toHaveProperty('real_name');
    expect(after).not.toHaveProperty('email');
    expect(after).not.toHaveProperty('emails');
    expect(after).not.toHaveProperty('prefs');
    signIn(app, 'provider-renamed', 92101, 'https://avatars.githubusercontent.com/test/new.png');
    expect(accountIdOf(app, 'provider-renamed')).toBe(accountId);
    expect(app.services.identity.getAccountClaims(accountId)?.github?.id).toBe(92101);
    expect(await read()).toMatchObject({ sub: accountId, username: 'device_author', display_name: '设备昵称', bio: '设备简介', avatar_url });
  });

  it('搜索与 @ 提示按更新后的统一用户名和昵称匹配，不继续返回旧资料', async () => {
    const { author, reader, request } = await setup();
    expect((await request('/api/forum/state', author)).status).toBe(200);
    expect((await request('/api/identity/profile', author, 'PATCH', {
      username: 'search_author', display_name: '搜索新昵称', bio: '更新简介',
    })).status).toBe(200);
    const search = await request(`/api/forum/search?q=${encodeURIComponent('搜索新昵称')}`, reader);
    expect(search.status).toBe(200);
    expect((await search.json()).results.users).toEqual([expect.objectContaining({
      username: 'search_author', displayName: '搜索新昵称', bio: '更新简介',
    })]);
    const suggest = await request('/api/forum/users/suggest?q=search_', reader);
    expect(suggest.status).toBe(200);
    expect((await suggest.json()).users).toEqual([{
      username: 'search_author', display_name: '搜索新昵称', avatar_url: 'https://avatars.githubusercontent.com/test/author.png',
    }]);
    const literal = await request('/api/forum/users/suggest?q=search%25', reader);
    expect(literal.status).toBe(200);
    expect((await literal.json()).users).toEqual([]);
  });

  it('旧论坛资料写口同步统一昵称和简介，仍保留论坛专属资料与账号自定义用户名', async () => {
    const { author, reader, request } = await setup();
    expect((await request('/api/identity/profile', author, 'PATCH', {
      username: 'kept_author', display_name: '门户昵称', bio: '门户简介',
    })).status).toBe(200);
    const edited = await request('/api/forum/me/profile', author, 'PATCH', {
      displayName: '论坛新昵称', bio: '论坛新简介', location: '武汉', website: 'https://example.test/home',
      notifyPrefs: { follow: false },
    });
    expect(edited.status).toBe(200);
    expect((await edited.json()).changes.users[0]).toMatchObject({
      username: 'kept_author', displayName: '论坛新昵称', bio: '论坛新简介',
      location: '武汉', website: 'https://example.test/home', notifyPrefs: { follow: false },
    });
    const canonical = await request('/api/identity/profile', author);
    expect(canonical.status).toBe(200);
    expect(await canonical.json()).toMatchObject({
      username: 'kept_author', display_name: '论坛新昵称', bio: '论坛新简介',
    });
    const state = await request('/api/forum/state', reader);
    const projected = (await state.json()).state.users.find((user: ForumUser) => user.username === 'kept_author');
    expect(projected).toMatchObject({
      displayName: '论坛新昵称', bio: '论坛新简介', location: '武汉', website: 'https://example.test/home',
      notifyPrefs: { follow: true },
    });
  });

  it('论坛真实头像上传和撤销同步全站，撤销不会重新显出旧论坛上传', async () => {
    const { author, reader, origin, request, fetch } = await setup();
    const token = await authorize(request, author);
    const uploaded = await request('/api/forum/me/avatar', author, 'PUT', PNG);
    expect(uploaded.status).toBe(200);
    const forumAvatar = (await uploaded.json()).changes.users[0].avatarUrl as string;
    const canonical = await (await request('/api/identity/profile', author)).json();
    expect(forumAvatar).toBe(canonical.avatar_url);
    expect(forumAvatar).toMatch(/^\/api\/identity\/avatar\/[a-f0-9]{64}\.webp$/);
    const image = await request(forumAvatar);
    expect(image.status).toBe(200);
    expect(image.headers.get('content-type')).toBe('image/webp');
    expect((await image.arrayBuffer()).byteLength).toBeGreaterThan(100);
    // 在门户换一张同源头像后，论坛旧 hash 仍不能成为撤销后的 fallback。
    expect((await request('/api/identity/avatar', author, 'PUT', PNG)).status).toBe(200);
    const removed = await request('/api/forum/me/avatar', author, 'DELETE');
    expect(removed.status).toBe(200);
    expect((await removed.json()).changes.users[0].avatarUrl).toBe('https://avatars.githubusercontent.com/test/author.png');
    expect((await (await request('/api/identity/profile', author)).json()).avatar_url).toBeNull();
    const state = await (await request('/api/forum/state', reader)).json();
    expect(state.state.users.find((user: ForumUser) => user.id === 'm92101').avatarUrl).toBe('https://avatars.githubusercontent.com/test/author.png');
    const info = await fetch(`${origin}/auth/device/userinfo`, { headers: { authorization: `Bearer ${token}` } });
    expect(info.status).toBe(200);
    expect((await info.json()).avatar_url).toBe('https://avatars.githubusercontent.com/test/author.png');
  });

  it('新统一用户名的 @ 提及仍指向同一论坛作者', async () => {
    const { app, author, reader, request } = await setup();
    grantPermGroup(app, accountIdOf(app, 'profile-reader'), 'level.member');
    expect((await request('/api/forum/state', author)).status).toBe(200);
    expect((await request('/api/identity/profile', author, 'PATCH', { username: 'mention_author' })).status).toBe(200);
    const created = await request('/api/forum/topics', reader, 'POST', {
      title: '提及资料作者', categoryId: 'c-ai', content: '请 @mention_author 看看', tags: [],
    });
    expect(created.status).toBe(201);
    const postId = (await created.json()).changes.posts[0].id;
    const state = await (await request('/api/forum/state', author)).json();
    expect(state.state.notifications).toEqual([expect.objectContaining({
      type: 'mention', recipientId: 'm92101', actorId: 'm92102', postId,
    })]);
  });

  it('跨账号昵称不能冒用修改后的统一用户名或其归一化写法', async () => {
    const { author, reader, request } = await setup();
    expect((await request('/api/forum/state', author)).status).toBe(200);
    expect((await request('/api/identity/profile', author, 'PATCH', { username: 'reserved_author' })).status).toBe(200);
    for (const displayName of ['reserved_author', 'Reserved Author']) {
      const attempt = await request('/api/forum/me/profile', reader, 'PATCH', { displayName });
      expect(attempt.status).toBe(400);
      expect((await attempt.json()).error).toBe('display_name_taken');
    }
  });

  it('既有冲突按 canonical 优先投影，读取不改写旧论坛字段或删除自定义图像字节', async () => {
    let now = Date.now();
    const { app, author, reader, origin, request, fetch } = await setup({ clock: () => now });
    const token = await authorize(request, author);
    const initial = await (await request('/api/forum/state', author)).json();
    const authorId = initial.state.viewer.userId;
    expect((await request('/api/identity/profile', author, 'PATCH', {
      username: 'legacy_author', display_name: '迁移时昵称', bio: '迁移时简介',
    })).status).toBe(200);
    // 通过旧 store 公共写接口建立历史夹具，模拟迁移之后、修复之前的独立论坛修改，不读真实旧库。
    const legacy = createForumStore(app.services.storage.db, app.services.forum.content);
    now += 1_000;
    legacy.updateProfile(authorId, { displayName: '旧论坛自定义昵称', bio: '旧论坛自定义简介' }, now);
    const avatar = await processAvatar(PNG);
    legacy.setAvatar(authorId, avatar.hash, avatar.data, now);
    const state = await (await request('/api/forum/state', reader)).json();
    const projected = state.state.users.find((user: ForumUser) => user.id === authorId);
    expect(projected).toMatchObject({
      username: 'legacy_author', displayName: '迁移时昵称', bio: '迁移时简介',
      avatarUrl: 'https://avatars.githubusercontent.com/test/author.png',
    });
    const info = await fetch(`${origin}/auth/device/userinfo`, { headers: { authorization: `Bearer ${token}` } });
    expect(info.status).toBe(200);
    expect(await info.json()).toMatchObject({
      display_name: '迁移时昵称', bio: '迁移时简介', avatar_url: projected.avatarUrl,
    });
    now += 1_000;
    expect((await request('/api/identity/profile', author, 'PATCH', {
      display_name: '之后门户昵称', bio: '之后门户简介',
    })).status).toBe(200);
    const refreshed = await (await request('/api/forum/state', reader)).json();
    expect(refreshed.state.users.find((user: ForumUser) => user.id === authorId)).toMatchObject({
      displayName: '之后门户昵称', bio: '之后门户简介', avatarUrl: projected.avatarUrl,
    });
    expect(legacy.user(authorId)).toMatchObject({
      displayName: '旧论坛自定义昵称', bio: '旧论坛自定义简介',
      avatarUrl: `/api/forum/avatars/${avatar.hash}.webp`,
    });
    const preserved = await request(`/api/forum/avatars/${avatar.hash}.webp`);
    expect(preserved.status).toBe(200);
    expect(Buffer.from(await preserved.arrayBuffer())).toEqual(avatar.data);
  });

  it('从未建 canonical 的旧作者仍展示原资料，公开读取和论坛局部编辑不悄悄建空 profile', async () => {
    const { app, author, reader, request } = await setup();
    const accountId = accountIdOf(app, 'profile-author');
    expect((await request('/api/forum/state', author)).status).toBe(200);
    const legacy = createForumStore(app.services.storage.db, app.services.forum.content);
    legacy.updateProfile('m92101', { displayName: '历史作者', bio: '历史简介', location: '武汉' });
    const avatar = await processAvatar(PNG);
    legacy.setAvatar('m92101', avatar.hash, avatar.data);
    // 仅内存历史夹具：模拟 migration 之后还没建立统一资料行的作者。
    app.services.storage.db.prepare('DELETE FROM account_profiles WHERE account_id = ?').run(accountId);
    for (const sid of [reader, undefined]) {
      const response = await request('/api/forum/state', sid);
      expect(response.status).toBe(200);
      const { state } = await response.json();
      expect(state.users.find((user: ForumUser) => user.id === 'm92101')).toMatchObject({
        username: 'profile-author', displayName: '历史作者', bio: '历史简介',
        location: '武汉', avatarUrl: `/api/forum/avatars/${avatar.hash}.webp`,
      });
    }
    expect(app.services.profiles.findMany([accountId]).size).toBe(0);
    const edited = await request('/api/forum/me/profile', author, 'PATCH', { bio: '只改简介' });
    expect(edited.status).toBe(200);
    expect((await edited.json()).changes.users[0]).toMatchObject({
      username: 'profile-author', displayName: '历史作者', bio: '只改简介',
      location: '武汉', avatarUrl: `/api/forum/avatars/${avatar.hash}.webp`,
    });
    expect(app.services.profiles.findMany([accountId]).size).toBe(0);
  });

  it('跨批用户查找保持搜索 50 条与提示 8 条上限、先加入顺序和 literal 下划线', async () => {
    const { app, reader, request } = await setup();
    // 只建立合成夹具；200 个不命中的作者在前，确保不能先截断旧字段候选再投影 canonical。
    const joinedAt = Date.now() - 86_400_000;
    for (let index = 0; index < 270; index += 1) {
      const login = `batch-user-${index}`;
      signIn(app, login, 93000 + index);
      const accountId = accountIdOf(app, login);
      app.services.forum.ensureMember({
        accountId, githubUserId: 93000 + index, login, avatarUrl: null,
        role: 'member', title: null, department: null, titles: [],
      }, joinedAt);
      app.services.profiles.update(accountId, { username: `${index < 200 ? 'other' : 'batch'}_${String(index).padStart(4, '0')}` });
    }
    const search = await request('/api/forum/search?q=batch_', reader);
    expect(search.status).toBe(200);
    const users = (await search.json()).results.users;
    expect(users).toHaveLength(50);
    expect(users[0].username).toBe('batch_0200');
    expect(users[49].username).toBe('batch_0249');
    const suggest = await request('/api/forum/users/suggest?q=batch_', reader);
    expect(suggest.status).toBe(200);
    const suggested = (await suggest.json()).users;
    expect(suggested).toHaveLength(8);
    expect(suggested[0].username).toBe('batch_0200');
    expect(suggested[7].username).toBe('batch_0207');
    const literal = await request('/api/forum/search?q=batch%25', reader);
    expect(literal.status).toBe(200);
    expect((await literal.json()).results.users).toEqual([]);
  });
});

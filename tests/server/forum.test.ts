import { createHash } from 'node:crypto';
import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { crc32, deflateSync } from 'node:zlib';
import { afterEach, describe, expect, it } from 'vitest';
import { buildApp } from '../../app/server/src/app';
import { REPO_ROOT } from '../../app/server/src/config';
import { loadForumContent } from '../../app/server/src/lib/forum-content';
import { ipSubject, nameKey } from '../../app/server/src/lib/forum-rules';
import { createForumStore } from '../../app/server/src/lib/forum-store';
import type { ServiceOverrides } from '../../app/server/src/services';
import { FORUM_FIXTURE_DIR, testApp, testConfig } from './helpers';

/** sharp 是 app/server 的依赖，根目录没有它；从 server 包里取，用来生成真实的测试图片和核对输出。 */
const sharp = createRequire(join(REPO_ROOT, 'app/server/package.json'))('sharp') as typeof import('../../app/server/node_modules/sharp');

const CONSOLE_ORG = 'Yangtze-University-Geek-Class';
const FORUM_CAPS = ['forum.topic.pin', 'forum.topic.close', 'forum.post.moderate', 'forum.category.manage', 'forum.badge.assign'];
type Role = 'admin' | 'member';
const USERS: Record<string, number> = { alice: 101, bob: 102, carol: 103, dave: 104, erin: 105, frank: 106 };

/** 模拟 GitHub：只回答组织角色查询；failing=true 时一律 502，用来验证 GitHub 出错的路径。 */
function github(roles: Record<string, Role>, state = { failing: false }) {
  return (() => ({
    request: async (route: string, params: Record<string, string>) => {
      if (state.failing) throw Object.assign(new Error('stub upstream down'), { status: 502 });
      if (route === 'GET /orgs/{org}/memberships/{username}') {
        const role = params.org === CONSOLE_ORG ? roles[params.username.toLowerCase()] : undefined;
        if (!role) throw Object.assign(new Error('stub not found'), { status: 404 });
        return { data: { state: 'active', role } };
      }
      throw new Error(`Unexpected GitHub call ${route}`);
    },
  })) as unknown as ServiceOverrides['octokitFactory'];
}

const contexts: { close: () => Promise<unknown> }[] = [];
const dirs: string[] = [];
afterEach(async () => {
  for (const c of contexts.splice(0)) await c.close();
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

/**
 * alice 是组织 owner（提督）；bob、carol、dave、erin 是普通成员，其中 carol 是社区部舰员（能管帖子、置顶、关闭），
 * dave 是项目部队长（只能置顶），erin 是领航员；frank 不在组织里。
 */
async function setup(options: { failing?: { failing: boolean }; env?: Record<string, string> } = {}) {
  const roles: Record<string, Role> = { alice: 'admin', bob: 'member', carol: 'member', dave: 'member', erin: 'member' };
  const context = await testApp({ octokitFactory: github(roles, options.failing) }, false, options.env);
  contexts.push(context);
  const { app } = context;
  const sids = new Map<string, string>();
  const as = (login: string) => {
    if (!sids.has(login)) sids.set(login, app.services.auth.createSession(login, USERS[login] ?? null, `https://avatars.example.test/${login}`, `token-${login}`));
    return { cookie: `sid=${sids.get(login)}` };
  };
  const assign = (login: string, role: 'captain' | 'head' | 'member' | 'alumni', department_id = '') =>
    app.services.roles.insertAssignment({ github_login: login, github_user_id: USERS[login] ?? null, role, department_id, note: null, granted_by: 'fixture' });
  assign('carol', 'member', 'community');
  assign('dave', 'head', 'projects');
  assign('erin', 'alumni');
  const call = (method: 'GET' | 'POST' | 'PATCH' | 'DELETE', url: string, who?: string, payload?: object) =>
    app.inject({ method, url, ...(payload === undefined ? {} : { payload }), headers: who ? as(who) : {} });
  const state = async (who?: string) => (await call('GET', '/api/forum/state', who)).json().state;
  const audits = () => app.services.storage.db.prepare("SELECT org, actor, action, target, details FROM audit_logs WHERE action LIKE 'forum.%' ORDER BY id").all() as { org: string; actor: string; action: string; target: string; details: string | null }[];
  return { app, as, call, state, audits, roles, db: app.services.storage.db };
}
type Setup = Awaited<ReturnType<typeof setup>>;

const guestReply = (topicId: string, content: string, name = '路过的同学', extra: Record<string, unknown> = {}) =>
  ({ topicId, content, guest: { name }, pow: { timestamp: Date.now(), nonce: 'x' }, website: '', ...extra });

/**
 * 昵称允许清单（lib/forum-rules.ts 的 isAllowedName）要拒绝的名字：前几轮审查找到的每一个探针都在这里。
 * 零宽与格式字符、双向覆盖（显示成「极客班」）、BOM、韩文填充字、C1 控制字符、行分隔符、软连字符、盲文空格、乐谱空符头、
 * 高棉文不发音元音、单独的附加符号、未分配的可忽略字符（U+2065、U+FFF0、U+E0080）、私用区、西里尔、希腊、亚美尼亚、
 * 傈僳、切罗基的形近字母、NFKC 之后是希腊字母的 µ、小型大写与搭嘴音这类形近拉丁字母、表情、连着的空格、只有符号。
 */
const REFUSED_NAMES = [
  '极客班\u200B', 'geekclass\u2060', '\u202E班客极', '极\u200D客班', 'bo\uFEFFb', '\u3164', 'bob\u0085', '极客\u2028班', '极客班\u00AD',
  '极客班\u2800', '\u2800', '\u{1D159}', 'bob\u{1D159}', '\u17B4', '\u17B5', '\u0332', 'bob\u0332', '\u20DD\u0301',
  'bob\u2065', 'bob\uFFF0', 'bob\u{E0080}', 'bob\uE000',
  'b\u043Eb', 'geekcl\u0430ss', '\u041A\u043E\u0432\u0430\u043B\u0451\u0432', 'b\u03BFb', '\u{1D41B}\u03BFb', '\u0391\u03BB\u03AD\u03BE\u03B7\u03C2',
  'b\u0585b', '\uA4D0ob', '\u13A0ave', '5\u00B5m', '\u0299ob', 'geekc\u01C0ass', '小博\u{1F389}', '张  三', '---', '·',
];
/** 允许清单要收的名字：汉字、拉丁字母（含拼音声调、越南文）、假名、韩文、数字和几个分隔符。 */
const ALLOWED_NAMES = ['张 三', 'Zhang San', '小博bob', '田中さん', '김민수', "O'Neil", 'ab-cd_e.f', 'Lǚ Xiǎomíng', 'Nguyễn Văn An', '阿·凡提', '中村・花子', 'ラーメン'];
const NAME_RULE = "昵称只能用汉字、字母、假名、韩文、数字、空格和 - _ . · ・ ' 这几个符号，空格不能连着用";

async function newTopic(s: Setup, who = 'bob', patch: Record<string, unknown> = {}) {
  const response = await s.call('POST', '/api/forum/topics', who, { title: '新话题', categoryId: 'c-ai', tags: [], content: '正文', ...patch });
  expect(response.statusCode).toBe(201);
  return response.json() as { topicId: string; postId: string; state: any };
}

describe('state', () => {
  it('serves the seeded forum to a guest, with no private lists and no caching', async () => {
    const s = await setup();
    const response = await s.call('GET', '/api/forum/state');
    expect(response.statusCode).toBe(200);
    expect(response.headers['cache-control']).toBe('no-store');
    const { state } = response.json();
    expect(state).toMatchObject({ version: 1, seededAt: 0, counters: { topic: 1000, post: 10000, notification: 0, tag: 0 }, notifications: [], bookmarks: [], follows: [] });
    // 分类按 categoryOrder 排，清单里不存在的 id 跳过。
    expect(state.categories.map((c: { id: string }) => c.id)).toEqual(['c-ai', 'c-exam']);
    expect(state.tags.map((t: { id: string }) => t.id)).toEqual(['tag-grade25', 'tag-agents']);
    expect(state.topics.map((t: { id: string }) => t.id)).toEqual(['t9', 't73']);
    expect(state.topics[1]).toEqual({
      id: 't73', slug: 'topic-73', title: '夹具旧帖一', categoryId: 'c-exam', tagIds: ['tag-grade25'], authorId: 'u-geekclass',
      createdAt: 1700000000000, lastActivityAt: 1700000000000, views: 12, pinned: true, closed: false,
    });
    expect(state.posts.map((p: { id: string; authorId: string }) => `${p.id}:${p.authorId}`)).toEqual(['body-9:u-geekclass', 'body-73:u-geekclass']);
    expect(state.users).toEqual([{
      id: 'u-geekclass', username: 'geekclass', displayName: '极客班', bio: '夹具官方账号', location: '', website: '', avatarColor: '#2f6fed',
      joinedAt: 1690000000000, role: 'admin', notifyPrefs: { reply: false, like: false, follow: false }, kind: 'official',
    }]);
    expect(state.viewer).toEqual({ userId: null, kind: 'guest', capabilities: [] });
    expect(state.guestPolicy).toEqual({ powDifficulty: 0, turnstileSiteKey: null, nameMax: 20, contentMax: 2000 });
  });

  it('creates the member on the first signed-in request, refreshes role, title and GitHub avatar, and keeps what they edited', async () => {
    const s = await setup();
    const first = await s.state('alice');
    expect(first.viewer).toEqual({ userId: 'm101', kind: 'member', capabilities: FORUM_CAPS });
    const alice = first.users.find((u: { id: string }) => u.id === 'm101');
    expect(alice).toMatchObject({ username: 'alice', displayName: 'alice', role: 'admin', title: { id: 'admin' }, avatarUrl: 'https://avatars.example.test/alice', kind: 'member', notifyPrefs: { reply: true, like: true, follow: true } });
    expect(Object.keys(alice)).not.toContain('github_user_id');

    const carol = (await s.state('carol'));
    expect(carol.viewer.capabilities).toEqual(['forum.topic.pin', 'forum.topic.close', 'forum.post.moderate']);
    expect(carol.users.find((u: { id: string }) => u.id === 'm103')).toMatchObject({ role: 'member', title: { id: 'member', department: 'community' } });
    expect((await s.state('dave')).viewer.capabilities).toEqual(['forum.topic.pin']);
    expect((await s.state('bob')).viewer.capabilities).toEqual([]);
    expect((await s.state('erin')).users.find((u: { id: string }) => u.id === 'm105').title).toEqual({ id: 'alumni' });

    expect((await s.call('PATCH', '/api/forum/me/profile', 'bob', { displayName: '小博' })).statusCode).toBe(200);
    // 称号变了、GitHub 头像换了：下一次请求就刷新，自己改的昵称不动。
    s.app.services.roles.insertAssignment({ github_login: 'bob', github_user_id: 102, role: 'head', department_id: 'tech', note: null, granted_by: 'fixture' });
    s.db.prepare("UPDATE sessions SET avatar_url = 'https://avatars.example.test/bob-new' WHERE login = 'bob'").run();
    const bob = (await s.state('bob')).users.find((u: { id: string }) => u.id === 'm102');
    expect(bob).toMatchObject({ displayName: '小博', title: { id: 'head', department: 'tech' }, avatarUrl: 'https://avatars.example.test/bob-new' });
  });

  it('does not turn a GitHub failure into a guest view', async () => {
    const failing = { failing: false };
    const s = await setup({ failing });
    failing.failing = true;
    const response = await s.call('GET', '/api/forum/state', 'bob');
    // 上游 5xx 按 http-policy 的统一映射脱敏成 internal_error；不会把成员当成游客返回一份「能看不能写」的状态。
    expect(response.statusCode).toBe(502);
    expect(response.json().error).toBe('internal_error');
    expect((await s.call('GET', '/api/forum/state')).statusCode).toBe(200);
  });

  it('treats a signed-in user who is no longer in the organization as a guest, whatever titles they hold', async () => {
    const s = await setup();
    // frank 有会话但不在组织里：看到的是游客，不建论坛用户。
    const frank = await s.state('frank');
    expect(frank.viewer).toEqual({ userId: null, kind: 'guest', capabilities: [] });
    expect(frank.users.map((u: { id: string }) => u.id)).not.toContain('m106');

    // carol 是社区部舰员（能置顶、关闭、管帖子），之后被移出组织；组织角色缓存 60 秒过期后就只是游客。
    expect((await s.state('carol')).viewer.capabilities).toEqual(['forum.topic.pin', 'forum.topic.close', 'forum.post.moderate']);
    delete s.roles.carol;
    s.app.services.cache.invalidate('console:orgrole:');
    const carol = await s.state('carol');
    expect(carol.viewer).toEqual({ userId: null, kind: 'guest', capabilities: [] });
    expect([carol.notifications, carol.bookmarks]).toEqual([[], []]);
    expect((await s.call('POST', '/api/forum/topics/t9/pin', 'carol', { pinned: true })).json().error).toBe('signin_required');
    expect((await s.call('POST', '/api/forum/topics', 'carol', { title: '还能发吗', categoryId: 'c-ai', content: '正文' })).statusCode).toBe(401);
    expect((await s.call('PATCH', '/api/forum/me/profile', 'carol', { displayName: '还能改吗' })).statusCode).toBe(401);
    // 回复只能走游客那条路：要游客昵称和 PoW，发出去的是一个游客用户。
    expect((await s.call('POST', '/api/forum/posts', 'carol', { topicId: 't9', content: '按成员回复' })).json().error).toBe('invalid_guest_name');
    const asGuest = await s.call('POST', '/api/forum/posts', 'carol', guestReply('t9', '按游客回复'));
    expect(asGuest.statusCode).toBe(201);
    expect(asGuest.json().state.posts.find((p: { id: string }) => p.id === asGuest.json().postId).authorId).toBe('g1');
    expect(s.audits()).toEqual([]);
  });

  it('sends real notification settings only to their owner', async () => {
    const s = await setup();
    await s.state('bob');
    expect((await s.call('PATCH', '/api/forum/me/profile', 'carol', { notifyPrefs: { like: false, follow: false } })).statusCode).toBe(200);
    const carolIn = (state: { users: { id: string; notifyPrefs: unknown }[] }) => state.users.find(u => u.id === 'm103')!.notifyPrefs;
    expect(carolIn(await s.state('carol'))).toEqual({ reply: true, like: false, follow: false });
    // 别人（成员、游客）看到的是成员的初始值，字段还在；官方账号本来就全关。
    expect(carolIn(await s.state('bob'))).toEqual({ reply: true, like: true, follow: true });
    expect(carolIn(await s.state())).toEqual({ reply: true, like: true, follow: true });
    expect((await s.state('bob')).users.find((u: { id: string }) => u.id === 'u-geekclass').notifyPrefs).toEqual({ reply: false, like: false, follow: false });
  });

  it('limits /api/forum/state to 120 requests a minute per IP', async () => {
    const s = await setup();
    const get = (remoteAddress: string) => s.app.inject({ method: 'GET', url: '/api/forum/state', remoteAddress });
    for (let i = 0; i < 120; i += 1) expect((await get('198.51.100.40')).statusCode).toBe(200);
    const limited = await get('198.51.100.40');
    expect(limited.statusCode).toBe(429);
    expect(limited.json()).toMatchObject({ error: 'rate_limited', message: '操作太频繁\uFF0C请稍后再试' });
    expect(limited.headers['cache-control']).toBe('no-store');
    expect((await get('198.51.100.41')).statusCode).toBe(200);
  });

  it('answers HEAD /api/forum/state with 405 without building the state or spending its own budget', async () => {
    const s = await setup();
    for (let i = 0; i < 3; i += 1) {
      const head = await s.app.inject({ method: 'HEAD', url: '/api/forum/state', remoteAddress: '198.51.100.42', headers: s.as('bob') });
      expect(head.statusCode).toBe(405);
      expect(head.headers.allow).toBe('GET');
    }
    // 没有建论坛用户，也没有另一份 120 次的额度：GET 的计数从头开始。
    expect(s.db.prepare("SELECT COUNT(*) AS n FROM forum_users WHERE id = 'm102'").get()).toEqual({ n: 0 });
    expect((await s.app.inject({ method: 'GET', url: '/api/forum/state', remoteAddress: '198.51.100.42' })).headers['x-ratelimit-remaining']).toBe('119');
  });
});

describe('topics', () => {
  it('lets members post and keeps guests out', async () => {
    const s = await setup();
    const guest = await s.call('POST', '/api/forum/topics', undefined, { title: 't', categoryId: 'c-ai', content: 'c' });
    expect(guest.statusCode).toBe(401);
    expect(guest.json()).toMatchObject({ error: 'signin_required', message: '登录后才能操作' });

    const { topicId, postId, state } = await newTopic(s, 'bob', { title: '  第一个新话题  ', tags: ['tag-agents', 'Rust', '机试心得', 'rust ', 'tag-agents'] });
    expect([topicId, postId]).toEqual(['t1001', 'p10001']);
    const topic = state.topics.find((t: { id: string }) => t.id === 't1001');
    expect(topic).toMatchObject({ slug: 'topic-1001', title: '第一个新话题', categoryId: 'c-ai', authorId: 'm102', views: 0, pinned: false, closed: false, tagIds: ['tag-agents', 'tag-1', 'tag-2'] });
    expect(state.tags.slice(2)).toEqual([
      { id: 'tag-1', slug: 'rust', name: 'Rust', color: '#e5484d' },
      { id: 'tag-2', slug: 'tag-2', name: '机试心得', color: '#f76b15' },
    ]);
    expect(state.posts.find((p: { id: string }) => p.id === 'p10001')).toMatchObject({ topicId: 't1001', authorId: 'm102', content: '正文', likeUserIds: [] });
    // 同名标签（中文按名字、英文按 slug）不会重复建。
    const again = await newTopic(s, 'bob', { tags: ['机试心得', 'RUST'] });
    expect(again.state.topics.find((t: { id: string }) => t.id === again.topicId).tagIds).toEqual(['tag-2', 'tag-1']);
    expect(again.state.counters).toMatchObject({ topic: 1002, post: 10002, tag: 2 });
  });

  it('validates topics with Chinese messages', async () => {
    const s = await setup();
    const post = (patch: Record<string, unknown>) => s.call('POST', '/api/forum/topics', 'bob', { title: '标题', categoryId: 'c-ai', content: '正文', ...patch });
    const long = await post({ title: 'x'.repeat(121) });
    expect(long.statusCode).toBe(400);
    expect(long.json()).toMatchObject({ error: 'validation_error', message: '标题太长了\uFF0C最多 120 个字' });
    expect((await post({ title: '   ' })).json().error).toBe('invalid_title');
    expect((await post({ categoryId: 'c-missing' })).json()).toMatchObject({ error: 'unknown_category', message: '没有这个分类' });
    expect((await post({ tags: ['a', 'b', 'c', 'd', 'e', 'f'] })).json().message).toBe('标签最多 5 个');
    expect((await post({ tags: ['这个标签名字写得实在是太长了超过二十个字了吧'] })).json().error).toBe('invalid_tag');
    expect((await post({ content: 'x'.repeat(20001) })).json().message).toBe('正文太长了\uFF0C最多 20000 个字');
    expect((await post({ content: ' \n ' })).json().error).toBe('empty_content');
    expect((await post({ extra: 1 })).json().message).toBe('不认识的字段\uFF1Aextra');
    expect((await post({ title: undefined })).json().message).toBe('缺少标题');
  });

  it('limits a member to 10 topics a minute', async () => {
    const s = await setup();
    for (let i = 0; i < 10; i += 1) await newTopic(s);
    const response = await s.call('POST', '/api/forum/topics', 'bob', { title: '第 11 个', categoryId: 'c-ai', content: '正文' });
    expect(response.statusCode).toBe(429);
    expect(response.json()).toMatchObject({ error: 'rate_limited', message: '操作太频繁\uFF0C请稍后再试' });
    await newTopic(s, 'carol');
  });

  it('pins and closes only with the forum capability, and audits without any post text', async () => {
    const s = await setup();
    expect((await s.call('POST', '/api/forum/topics/t9/pin', undefined, { pinned: true })).statusCode).toBe(401);
    const denied = await s.call('POST', '/api/forum/topics/t9/pin', 'bob', { pinned: true });
    expect(denied.statusCode).toBe(403);
    expect(denied.json()).toMatchObject({ error: 'forbidden', message: '需要「置顶话题」权限' });
    // 项目部队长能置顶、不能关闭；社区部舰员两样都能。
    const pinned = await s.call('POST', '/api/forum/topics/t9/pin', 'dave', { pinned: true });
    expect(pinned.statusCode).toBe(200);
    expect(pinned.json().state.topics.find((t: { id: string }) => t.id === 't9').pinned).toBe(true);
    expect((await s.call('POST', '/api/forum/topics/t9/close', 'dave', { closed: true })).statusCode).toBe(403);
    expect((await s.call('POST', '/api/forum/topics/t9/close', 'carol', { closed: true })).json().state.topics.find((t: { id: string }) => t.id === 't9').closed).toBe(true);
    expect((await s.call('POST', '/api/forum/topics/t404/close', 'carol', { closed: true })).statusCode).toBe(404);
    expect((await s.call('POST', '/api/forum/topics/t9/close', 'carol', { closed: 'yes' })).statusCode).toBe(400);
    expect(s.audits()).toEqual([
      { org: CONSOLE_ORG, actor: 'dave', action: 'forum.topic.pin', target: 't9', details: '{"pinned":true}' },
      { org: CONSOLE_ORG, actor: 'carol', action: 'forum.topic.close', target: 't9', details: '{"closed":true}' },
    ]);
  });

  it('counts a view once per IP per topic per hour', async () => {
    const s = await setup();
    const view = (remoteAddress: string, topic = 't9') => s.app.inject({ method: 'POST', url: `/api/forum/topics/${topic}/view`, remoteAddress });
    expect((await view('198.51.100.1')).statusCode).toBe(204);
    await view('198.51.100.1');
    await view('198.51.100.2');
    expect((await s.state()).topics.find((t: { id: string }) => t.id === 't9').views).toBe(5);
    expect((await view('198.51.100.1', 't404')).statusCode).toBe(404);
    // 一小时之后同一个 IP 再算一次。
    s.db.prepare('UPDATE forum_topic_views SET viewed_at = viewed_at - 3600001').run();
    await view('198.51.100.1');
    expect((await s.state()).topics.find((t: { id: string }) => t.id === 't9').views).toBe(6);
  });

  it('counts an IPv6 /64 as one viewer and limits view pings to 60 a minute per IP', async () => {
    const s = await setup();
    const view = (remoteAddress: string, topic = 't9') => s.app.inject({ method: 'POST', url: `/api/forum/topics/${topic}/view`, remoteAddress });
    await view('2001:db8:1:2::1');
    await view('2001:db8:1:2:ffff::9');
    await view('2001:db8:1:3::1');
    expect((await s.state()).topics.find((t: { id: string }) => t.id === 't9').views).toBe(5);
    expect(s.db.prepare('SELECT ip FROM forum_topic_views ORDER BY ip').all()).toEqual([{ ip: '2001:db8:1:2::/64' }, { ip: '2001:db8:1:3::/64' }]);

    for (let i = 0; i < 60; i += 1) expect((await view('198.51.100.50', i % 2 ? 't9' : 't73')).statusCode).toBe(204);
    const limited = await view('198.51.100.50');
    expect(limited.statusCode).toBe(429);
    expect(limited.json()).toMatchObject({ error: 'rate_limited', message: '操作太频繁\uFF0C请稍后再试' });
    expect((await view('198.51.100.51')).statusCode).toBe(204);
  });
});

describe('replies', () => {
  it('lets a member reply and notifies the topic author and the replied-to author once each', async () => {
    const s = await setup();
    await s.state('carol');
    const { topicId, postId: first } = await newTopic(s, 'bob');
    const reply = await s.call('POST', '/api/forum/posts', 'carol', { topicId, content: '同意 @bob 和 @alice 的看法' });
    expect(reply.statusCode).toBe(201);
    expect(reply.json().postId).toBe('p10002');
    await s.state('alice');
    const nested = await s.call('POST', '/api/forum/posts', 'alice', { topicId, content: '补充一句', replyToPostId: 'p10002' });
    expect(nested.statusCode).toBe(201);
    const bob = await s.state('bob');
    expect(bob.notifications.map((n: { type: string; actorId: string; postId: string }) => `${n.type}:${n.actorId}:${n.postId}`)).toEqual(['reply:m101:p10003', 'reply:m103:p10002']);
    // alice 第一次来之前被 @ 的那条找不到她（当时还没有论坛用户），carol 收到 alice 回复她的通知。
    expect((await s.state('carol')).notifications.map((n: { type: string; actorId: string }) => `${n.type}:${n.actorId}`)).toEqual(['reply:m101']);
    expect(bob.posts.find((p: { id: string }) => p.id === 'p10003').replyToPostId).toBe('p10002');
    expect(bob.topics.find((t: { id: string }) => t.id === topicId).lastActivityAt).toBeGreaterThanOrEqual(bob.topics.find((t: { id: string }) => t.id === topicId).createdAt);
    expect(first).toBe('p10001');
    expect((await s.call('POST', '/api/forum/posts', 'bob', { topicId, content: 'x', replyToPostId: 'body-9' })).json().error).toBe('invalid_reply_target');
    expect((await s.call('POST', '/api/forum/posts', 'bob', { topicId: 't404', content: 'x' })).statusCode).toBe(404);
  });

  it('notifies @mentions of members only, never the author, and respects notification settings', async () => {
    const s = await setup();
    await s.state('carol'); await s.state('dave');
    await s.call('PATCH', '/api/forum/me/profile', 'dave', { notifyPrefs: { reply: false } });
    const { topicId } = await newTopic(s, 'dave', { content: '@carol 看一下\uFF0C`@bob` 不算\uFF0C@geekclass 也不算' });
    expect((await s.state('carol')).notifications.map((n: { type: string }) => n.type)).toEqual(['mention']);
    await s.call('POST', '/api/forum/posts', 'carol', { topicId, content: '收到 @dave' });
    // dave 关了回复通知：回复不通知；@ 提及没有开关，照常通知。
    expect((await s.state('dave')).notifications.map((n: { type: string }) => n.type)).toEqual(['mention']);
  });

  it('lets a guest reply with a name, proof of work and an empty honeypot, and never lets a guest open a topic', async () => {
    const s = await setup();
    await s.state('bob');
    const { topicId } = await newTopic(s, 'bob');
    const send = (body: Record<string, unknown>, remoteAddress = '203.0.113.5') => s.app.inject({ method: 'POST', url: '/api/forum/posts', payload: body, remoteAddress });

    expect((await send(guestReply(topicId, '没有 PoW', undefined, { pow: undefined }))).json()).toMatchObject({ error: 'pow_invalid' });
    expect((await send(guestReply(topicId, '过期的 PoW', undefined, { pow: { timestamp: Date.now() - 10 * 60_000, nonce: 'x' } }))).json().error).toBe('pow_invalid');
    expect((await send(guestReply(topicId, '机器人', undefined, { website: 'https://spam.example' }))).json()).toMatchObject({ error: 'request_rejected', message: '请求被拒绝' });
    expect((await send(guestReply(topicId, 'x'.repeat(2001)))).json().error).toBe('content_too_long');
    expect((await send(guestReply(topicId, '没名字', '  '))).json().error).toBe('invalid_guest_name');
    expect((await send(guestReply(topicId, '名字太长', 'x'.repeat(21)))).json().error).toBe('validation_error');
    expect((await send(guestReply(topicId, '冒充', '极客班'))).json().error).toBe('guest_name_taken');
    expect((await send(guestReply(topicId, '冒充', 'BOB'))).json().error).toBe('guest_name_taken');
    expect((await send({ ...guestReply(topicId, 'x'), homepage: 'x' })).json().error).toBe('validation_error');

    const ok = await send(guestReply(topicId, '游客的回复 @bob'));
    expect(ok.statusCode).toBe(201);
    const { state, postId } = ok.json();
    expect(state.viewer).toEqual({ userId: null, kind: 'guest', capabilities: [] });
    const post = state.posts.find((p: { id: string }) => p.id === postId);
    expect(post.authorId).toBe('g1');
    expect(state.users.find((u: { id: string }) => u.id === 'g1')).toEqual({
      id: 'g1', username: 'guest-1', displayName: '路过的同学', bio: '', location: '', website: '', avatarColor: '#e5484d',
      joinedAt: expect.any(Number), role: 'member', notifyPrefs: { reply: false, like: false, follow: false }, kind: 'guest',
    });
    // 游客回复也通知话题作者（actor 是游客用户）；同一帖里的 @ 不重复通知。
    expect((await s.state('bob')).notifications.map((n: { type: string; actorId: string }) => `${n.type}:${n.actorId}`)).toEqual(['reply:g1']);
    // 游客改不了、删不了自己的回复，也发不了话题。
    expect((await s.call('PATCH', `/api/forum/posts/${postId}`, undefined, { content: '改' })).statusCode).toBe(401);
    expect((await s.call('DELETE', `/api/forum/posts/${postId}`)).statusCode).toBe(401);
    expect((await s.call('POST', '/api/forum/posts/p10001/like')).statusCode).toBe(401);
    // 每条游客回复是一个新的游客用户。
    expect((await send(guestReply(topicId, '第二条'))).json().state.users.map((u: { id: string }) => u.id)).toContain('g2');
  });

  it('limits guest replies to 5 a minute and 30 a day per IP', async () => {
    const s = await setup();
    const send = (remoteAddress: string) => s.app.inject({ method: 'POST', url: '/api/forum/posts', payload: guestReply('t9', '回复'), remoteAddress });
    for (let i = 0; i < 5; i += 1) expect((await send('203.0.113.7')).statusCode).toBe(201);
    const limited = await send('203.0.113.7');
    expect(limited.statusCode).toBe(429);
    expect(limited.json().error).toBe('rate_limited');
    expect((await send('203.0.113.8')).statusCode).toBe(201);
    // 一天 30 次：把 30 条记录放在一分钟以前、一天以内。
    const earlier = Date.now() - 2 * 60_000;
    for (let i = 0; i < 30; i += 1) s.app.services.forum.rateRecord('guestPost', '203.0.113.9', earlier);
    expect((await send('203.0.113.9')).statusCode).toBe(429);
  });

  it('counts guest replies from one IPv6 /64 together', async () => {
    const s = await setup();
    const send = (remoteAddress: string) => s.app.inject({ method: 'POST', url: '/api/forum/posts', payload: guestReply('t9', '回复'), remoteAddress });
    const statuses: number[] = [];
    for (let i = 1; i <= 6; i += 1) statuses.push((await send(`2001:db8:1:2::${i.toString(16)}`)).statusCode);
    expect(statuses).toEqual([201, 201, 201, 201, 201, 429]);
    expect((await send('2001:db8:1:2:abcd:ef01:2345:6789')).statusCode).toBe(429);
    expect((await send('2001:db8:1:3::1')).statusCode).toBe(201);
    // IPv4 映射成 IPv6 的地址按 IPv4 计。
    for (let i = 0; i < 5; i += 1) s.app.services.forum.rateRecord('guestPost', '203.0.113.30');
    expect((await send('::ffff:203.0.113.30')).statusCode).toBe(429);
  });

  it('pauses all guest replies after 200 an hour across the site, and leaves members alone', async () => {
    const s = await setup();
    const send = (remoteAddress: string) => s.app.inject({ method: 'POST', url: '/api/forum/posts', payload: guestReply('t9', '回复'), remoteAddress });
    const earlier = Date.now() - 2 * 60_000;
    for (let i = 0; i < 199; i += 1) s.app.services.forum.rateRecord('guestPostSite', 'site', earlier);
    // 第 200 条照常发出并记进全站计数；之后换任何 IP 都暂停。
    expect((await send('203.0.113.70')).statusCode).toBe(201);
    const paused = await send('203.0.113.71');
    expect(paused.statusCode).toBe(429);
    expect(paused.json()).toMatchObject({ error: 'guest_replies_paused', message: '游客回复暂时太多\uFF0C请过一会儿再试\uFF0C或者登录后回复' });
    expect((await send('2001:db8:9::1')).json().error).toBe('guest_replies_paused');
    expect((await s.call('POST', '/api/forum/posts', 'bob', { topicId: 't9', content: '成员照常回复' })).statusCode).toBe(201);
    // 一小时之后恢复。
    s.db.prepare("UPDATE forum_rate_events SET created_at = created_at - 3600001 WHERE bucket = 'guestPostSite'").run();
    expect((await send('203.0.113.71')).statusCode).toBe(201);
  });

  it('takes only allowlisted characters in guest names, and every probe from earlier rounds is refused', async () => {
    const s = await setup();
    let ip = 100;
    const send = (name: string) => s.app.inject({ method: 'POST', url: '/api/forum/posts', payload: guestReply('t9', '冒充', name), remoteAddress: `203.0.113.${ip++}` });
    for (const name of REFUSED_NAMES) {
      const response = await send(name);
      expect(response.statusCode, JSON.stringify(name)).toBe(400);
      expect(response.json(), JSON.stringify(name)).toMatchObject({ error: 'invalid_guest_name', message: NAME_RULE });
    }
    for (const name of ALLOWED_NAMES) expect((await send(name)).statusCode, JSON.stringify(name)).toBe(201);
    expect((await send('  ')).json()).toMatchObject({ error: 'invalid_guest_name', message: '游客要填 1 到 20 个字的昵称' });
  });

  it('refuses guest names that differ from a member or the official account only in width, case or accents', async () => {
    const s = await setup();
    await s.state('bob');
    const send = (name: string) => s.app.inject({ method: 'POST', url: '/api/forum/posts', payload: guestReply('t9', '冒充', name), remoteAddress: '203.0.113.60' });
    for (const name of ['\uFF27\uFF25\uFF25\uFF2B\uFF23\uFF2C\uFF21\uFF33\uFF33', '\uFF22\uFF4F\uFF42', 'B\u00F3b', '极客班']) {
      const response = await send(name);
      expect(response.statusCode, JSON.stringify(name)).toBe(400);
      expect(response.json().error, JSON.stringify(name)).toBe('guest_name_taken');
    }
    expect((await send('极客班的同学')).statusCode).toBe(201);
  });

  it('keeps guests and members from taking the login of an org member who never opened the forum', async () => {
    const s = await setup();
    // dave（队长）、erin（领航员）、zed（后来指派的舰员）只在控制台的称号指派里；owner1 登录过（审计里有 auth.signin），
    // grace 有当前会话。这些人都没打开过论坛。frank 没有称号、也从没登录过：这是剩下的缺口。
    s.app.services.roles.insertAssignment({ github_login: 'zed', github_user_id: null, role: 'member', department_id: 'tech', note: null, granted_by: 'fixture' });
    s.app.services.storage.audit(null, 'owner1', 'auth.signin', 'owner1');
    s.app.services.auth.createSession('grace', 107, null, 'token-grace');
    const send = (name: string) => s.app.inject({ method: 'POST', url: '/api/forum/posts', payload: guestReply('t9', '冒充', name), remoteAddress: '203.0.113.63' });
    for (const name of ['Dave', '\uFF25\uFF32\uFF29\uFF2E', 'zed', 'OWNER1', 'Grace']) {
      expect((await send(name)).json().error, name).toBe('guest_name_taken');
    }
    expect((await send('frank')).statusCode).toBe(201);
    expect((await s.state()).users.map((u: { id: string }) => u.id)).not.toContain('m104');

    const rename = (displayName: string, who: string) => s.call('PATCH', '/api/forum/me/profile', who, { displayName });
    expect((await rename('erin', 'bob')).json().error).toBe('display_name_taken');
    expect((await rename('owner1', 'bob')).json().error).toBe('display_name_taken');
    expect((await rename('DAVE', 'dave')).statusCode).toBe(200);
  });

  it('notifies at most 10 people mentioned in one post, in the order they appear', async () => {
    const s = await setup();
    const handles = Array.from({ length: 12 }, (_, i) => `member${String(i + 1).padStart(2, '0')}`);
    handles.forEach((login, i) => s.app.services.forum.ensureMember({ githubUserId: 500 + i, login, avatarUrl: null, role: 'member', title: null }));
    const { postId } = await newTopic(s, 'bob', { content: handles.map(handle => `@${handle}`).join(' ') });
    const mentioned = s.db.prepare("SELECT recipient_id FROM forum_notifications WHERE type = 'mention' AND post_id = ? ORDER BY rowid").all(postId) as { recipient_id: string }[];
    expect(mentioned.map(row => row.recipient_id)).toEqual(Array.from({ length: 10 }, (_, i) => `m${500 + i}`));
  });

  it('checks the guest proof of work over `${topicId}:${content}` at the real difficulty', async () => {
    const config = testConfig({
      NODE_ENV: 'test', PUBLIC_ORIGIN: 'https://example.test', DB_PATH: ':memory:',
      SESSION_SECRET: 'isolated-core-test-secret-at-least-32', ENCRYPTION_KEY: Buffer.alloc(32, 1).toString('base64'),
      OAUTH_CLIENT_ID: 'test-client', OAUTH_CLIENT_SECRET: 'test-only-placeholder', POW_DIFFICULTY: '2',
    });
    const deny = (() => { throw new Error('Unexpected external network request in forum PoW test'); }) as unknown as ServiceOverrides['httpRequest'];
    const app = await buildApp({ config, staticRoot: false, overrides: { httpRequest: deny, octokitFactory: deny as unknown as ServiceOverrides['octokitFactory'] } });
    contexts.push(app);
    // `avoid`：错的解不能碰巧也是对的解（难度 2 时约 1/256 的概率），否则用例会偶发失败。
    const solve = (bodyForHash: string, avoid?: string) => {
      const timestamp = Date.now();
      const solves = (body: string, n: number) => createHash('sha256').update(`${timestamp}:${body}:${n}`).digest('hex').startsWith('00');
      for (let n = 0; ; n += 1) {
        if (solves(bodyForHash, n) && !(avoid && solves(avoid, n))) return { timestamp, nonce: String(n) };
      }
    };
    expect((await app.inject('/api/forum/state')).json().state.guestPolicy.powDifficulty).toBe(2);
    const content = '  前后有空白的回复  ';
    const wrong = await app.inject({ method: 'POST', url: '/api/forum/posts', payload: guestReply('t9', content, undefined, { pow: solve(`t73:${content}`, `t9:${content}`) }) });
    expect(wrong.json().error).toBe('pow_invalid');
    const right = await app.inject({ method: 'POST', url: '/api/forum/posts', payload: guestReply('t9', content, undefined, { pow: solve(`t9:${content}`) }) });
    expect(right.statusCode).toBe(201);
    expect(right.json().state.posts.find((p: { id: string }) => p.id === right.json().postId).content).toBe(content);
  });

  it('lets only moderators reply in a closed topic', async () => {
    const s = await setup();
    await s.call('POST', '/api/forum/topics/t9/close', 'carol', { closed: true });
    const member = await s.call('POST', '/api/forum/posts', 'bob', { topicId: 't9', content: '还能回吗' });
    expect(member.statusCode).toBe(403);
    expect(member.json()).toMatchObject({ error: 'forbidden', message: '话题已关闭\uFF0C不能回复' });
    expect((await s.call('POST', '/api/forum/posts', undefined, guestReply('t9', '游客呢'))).statusCode).toBe(403);
    expect((await s.call('POST', '/api/forum/posts', 'dave', { topicId: 't9', content: '队长呢' })).statusCode).toBe(403);
    expect((await s.call('POST', '/api/forum/posts', 'carol', { topicId: 't9', content: '版务说明' })).statusCode).toBe(201);
    expect((await s.call('POST', '/api/forum/posts', 'alice', { topicId: 't9', content: '提督补充' })).statusCode).toBe(201);
  });

  it('rejects cross-origin writes before touching the forum', async () => {
    const s = await setup();
    const response = await s.app.inject({ method: 'POST', url: '/api/forum/posts', payload: guestReply('t9', 'x'), headers: { origin: 'https://evil.example' } });
    expect(response.statusCode).toBe(403);
    expect(response.json().error).toBe('invalid_origin');
    expect((await s.state()).posts).toHaveLength(2);
  });
});

describe('editing and deleting', () => {
  it('lets authors edit and soft-delete their own posts, and moderators anyone’s with an audit entry', async () => {
    const s = await setup();
    const { topicId, postId: first } = await newTopic(s, 'bob');
    const reply = (await s.call('POST', '/api/forum/posts', 'bob', { topicId, content: '第一版' })).json().postId;
    const guest = (await s.call('POST', '/api/forum/posts', undefined, guestReply(topicId, '游客的话'))).json().postId;

    const edited = await s.call('PATCH', `/api/forum/posts/${reply}`, 'bob', { content: '第二版' });
    expect(edited.statusCode).toBe(200);
    expect(edited.json().state.posts.find((p: { id: string }) => p.id === reply)).toMatchObject({ content: '第二版', editedAt: expect.any(Number) });
    const other = await s.call('PATCH', `/api/forum/posts/${reply}`, 'dave', { content: '改别人的' });
    expect(other.statusCode).toBe(403);
    expect(other.json()).toMatchObject({ error: 'forbidden', message: '只能编辑自己的帖子' });
    expect((await s.call('DELETE', `/api/forum/posts/${reply}`, 'erin')).statusCode).toBe(403);
    expect((await s.call('PATCH', `/api/forum/posts/${reply}`, 'bob', { content: '  ' })).json().error).toBe('empty_content');

    // 社区部舰员改、删游客的帖子：写审计，不记正文。
    expect((await s.call('PATCH', `/api/forum/posts/${guest}`, 'carol', { content: '\uFF08已由版务整理\uFF09' })).statusCode).toBe(200);
    const removed = await s.call('DELETE', `/api/forum/posts/${guest}`, 'carol');
    expect(removed.json().state.posts.find((p: { id: string }) => p.id === guest)).toMatchObject({ deleted: true, content: '' });
    expect(s.audits()).toEqual([
      { org: CONSOLE_ORG, actor: 'carol', action: 'forum.post.edit', target: guest, details: JSON.stringify({ topic_id: topicId, author_id: 'g1' }) },
      { org: CONSOLE_ORG, actor: 'carol', action: 'forum.post.delete', target: guest, details: JSON.stringify({ topic_id: topicId, author_id: 'g1' }) },
    ]);

    // 自己删自己的不审计；再删一次原样返回；删掉的不能再改、不能点赞。
    const own = await s.call('DELETE', `/api/forum/posts/${reply}`, 'bob');
    expect(own.json().state.posts.find((p: { id: string }) => p.id === reply)).toMatchObject({ deleted: true, content: '' });
    expect((await s.call('DELETE', `/api/forum/posts/${reply}`, 'bob')).statusCode).toBe(200);
    expect((await s.call('PATCH', `/api/forum/posts/${reply}`, 'bob', { content: '复活' })).json()).toMatchObject({ error: 'post_deleted' });
    expect((await s.call('POST', `/api/forum/posts/${reply}/like`, 'carol')).statusCode).toBe(409);
    expect(s.audits()).toHaveLength(2);

    // 第一帖承载话题，谁都不能删。
    const firstDelete = await s.call('DELETE', `/api/forum/posts/${first}`, 'alice');
    expect(firstDelete.statusCode).toBe(400);
    expect(firstDelete.json().error).toBe('first_post');
    expect((await s.call('DELETE', '/api/forum/posts/body-9', 'alice')).json().error).toBe('first_post');
    expect((await s.call('DELETE', '/api/forum/posts/p99999', 'bob')).statusCode).toBe(404);
    expect((await s.call('DELETE', '/api/forum/posts/not-an-id', 'bob')).json()).toMatchObject({ error: 'validation_error', message: '链接里的编号不对' });
  });
});

describe('likes, bookmarks, follows and notifications', () => {
  it('toggles likes with one notification per liker and post', async () => {
    const s = await setup();
    await s.state('bob');
    const { postId } = await newTopic(s, 'bob');
    const like = () => s.call('POST', `/api/forum/posts/${postId}/like`, 'carol');
    expect((await like()).json().state.posts.find((p: { id: string }) => p.id === postId).likeUserIds).toEqual(['m103']);
    expect((await like()).json().state.posts.find((p: { id: string }) => p.id === postId).likeUserIds).toEqual([]);
    await like();
    await s.call('POST', `/api/forum/posts/${postId}/like`, 'bob');
    expect((await s.state('bob')).notifications.map((n: { type: string; actorId: string }) => `${n.type}:${n.actorId}`)).toEqual(['like:m103']);
    expect((await s.call('POST', '/api/forum/posts/p99999/like', 'bob')).statusCode).toBe(404);
  });

  it('keeps bookmarks and notifications private to their owner', async () => {
    const s = await setup();
    await s.state('bob');
    const { topicId, postId } = await newTopic(s, 'bob');
    await s.call('POST', '/api/forum/posts', 'carol', { topicId, content: '回复' });
    const saved = await s.call('POST', `/api/forum/posts/${postId}/bookmark`, 'carol');
    expect(saved.json().state.bookmarks).toEqual([{ userId: 'm103', postId, createdAt: expect.any(Number) }]);
    await s.call('POST', '/api/forum/posts/body-9/bookmark', 'bob');

    const bob = await s.state('bob');
    expect(bob.bookmarks.map((b: { postId: string }) => b.postId)).toEqual(['body-9']);
    expect(bob.notifications.every((n: { recipientId: string }) => n.recipientId === 'm102')).toBe(true);
    const carol = await s.state('carol');
    expect(carol.notifications).toEqual([]);
    expect(carol.bookmarks.map((b: { postId: string }) => b.postId)).toEqual([postId]);
    const guest = await s.state();
    expect([guest.bookmarks, guest.notifications]).toEqual([[], []]);

    // 只能标自己的通知已读；别人的当作不存在。
    const [notification] = bob.notifications;
    expect((await s.call('POST', `/api/forum/notifications/${notification.id}/read`, 'carol')).statusCode).toBe(404);
    expect((await s.call('POST', `/api/forum/notifications/${notification.id}/read`, 'bob')).json().state.notifications[0].read).toBe(true);
    expect((await s.call('POST', '/api/forum/notifications/n999/read', 'bob')).statusCode).toBe(404);
    await s.call('POST', `/api/forum/posts/${postId}/like`, 'carol');
    const all = await s.call('POST', '/api/forum/notifications/read-all', 'bob');
    expect(all.json().state.notifications.every((n: { read: boolean }) => n.read)).toBe(true);
    expect((await s.call('POST', '/api/forum/notifications/read-all')).statusCode).toBe(401);
    // 取消收藏。
    expect((await s.call('POST', `/api/forum/posts/${postId}/bookmark`, 'carol')).json().state.bookmarks).toEqual([]);
  });

  it('toggles follows, refuses self-follows and notifies once', async () => {
    const s = await setup();
    await s.state('bob');
    const follow = (target: string, who = 'carol') => s.call('POST', `/api/forum/users/${target}/follow`, who);
    expect((await follow('m102')).json().state.follows).toEqual([{ followerId: 'm103', followeeId: 'm102', createdAt: expect.any(Number) }]);
    expect((await follow('m102')).json().state.follows).toEqual([]);
    await follow('m102');
    expect((await s.state('bob')).notifications.map((n: { type: string }) => n.type)).toEqual(['follow']);
    const self = await follow('m103');
    expect(self.statusCode).toBe(400);
    expect(self.json().error).toBe('cannot_follow_self');
    expect((await follow('m999')).statusCode).toBe(404);
    expect((await follow('u-geekclass')).statusCode).toBe(200);
    expect((await s.call('POST', '/api/forum/users/m102/follow')).statusCode).toBe(401);
    // 关注列表对所有人公开。
    expect((await s.state()).follows).toHaveLength(2);
  });
});

describe('profile', () => {
  it('edits nickname, signature, location, website and notification settings within limits', async () => {
    const s = await setup();
    const patch = (body: object, who: string | null = 'bob') => s.call('PATCH', '/api/forum/me/profile', who ?? undefined, body);
    const ok = await patch({ displayName: '  博  ', bio: '第一行\n第二行', location: '武汉', website: 'https://bob.example.test/', notifyPrefs: { like: false } });
    expect(ok.statusCode).toBe(200);
    expect(ok.json().state.users.find((u: { id: string }) => u.id === 'm102')).toMatchObject({
      displayName: '博', bio: '第一行\n第二行', location: '武汉', website: 'https://bob.example.test/', notifyPrefs: { reply: true, like: false, follow: true },
    });
    expect((await patch({ website: '' })).json().state.users.find((u: { id: string }) => u.id === 'm102').website).toBe('');
    expect((await patch({ displayName: 'x'.repeat(31) })).json().message).toBe('昵称太长了\uFF0C最多 30 个字');
    expect((await patch({ displayName: '   ' })).json().error).toBe('invalid_display_name');
    expect((await patch({ bio: 'x'.repeat(201) })).json().message).toBe('个人签名太长了\uFF0C最多 200 个字');
    expect((await patch({ bio: 'a\u0007b' })).json().error).toBe('invalid_bio');
    expect((await patch({ location: 'x'.repeat(61) })).statusCode).toBe(400);
    for (const website of ['http://bob.example.test', 'javascript:alert(1)', 'https://user:pass@bob.example.test', 'bob.example.test']) {
      expect((await patch({ website })).json().error).toBe('invalid_website');
    }
    expect((await patch({})).json().message).toBe('没有要修改的内容');
    expect((await patch({ role: 'admin' })).json().error).toBe('validation_error');
    expect((await patch({ displayName: 'x' }, null)).statusCode).toBe(401);
  });

  it('takes only allowlisted characters in member nicknames and stops members taking the official name or someone else’s username', async () => {
    const s = await setup();
    await s.state('carol');
    const rename = (displayName: string, who = 'bob') => s.call('PATCH', '/api/forum/me/profile', who, { displayName });
    for (const name of REFUSED_NAMES) {
      const response = await rename(name);
      expect(response.statusCode, JSON.stringify(name)).toBe(400);
      expect(response.json(), JSON.stringify(name)).toMatchObject({ error: 'invalid_display_name', message: NAME_RULE });
    }
    for (const name of ALLOWED_NAMES) expect((await rename(name)).statusCode, JSON.stringify(name)).toBe(200);
    for (const name of ['极客班', '\uFF27\uFF45\uFF45\uFF4B\uFF23\uFF4C\uFF41\uFF53\uFF53', 'Carol', 'C\u00E1rol']) {
      const response = await rename(name);
      expect(response.statusCode, JSON.stringify(name)).toBe(400);
      expect(response.json(), JSON.stringify(name)).toMatchObject({ error: 'display_name_taken', message: '这个昵称是官方账号或别人的用户名\uFF0C换一个吧' });
    }
    // 自己的用户名换个大小写可以；和别的成员昵称相同也可以。
    expect((await rename('BOB')).statusCode).toBe(200);
    expect((await rename('小博', 'carol')).statusCode).toBe(200);
    expect((await rename('小博')).json().state.users.filter((u: { displayName: string }) => u.displayName === '小博')).toHaveLength(2);
  });

  it('keeps a stored nickname that breaks the current rules when other fields change, but still checks a new one', async () => {
    const s = await setup();
    await s.state('carol');
    await s.state('bob');
    const patch = (body: object) => s.call('PATCH', '/api/forum/me/profile', 'bob', body);
    const bob = (response: { json(): { state: { users: { id: string }[] } } }) => response.json().state.users.find(u => u.id === 'm102');
    // 早先存下的昵称：带看不见的字符，或者和官方账号同名。
    for (const legacy of ['b\u200Bob', '极客班']) {
      s.db.prepare("UPDATE forum_users SET display_name = ? WHERE id = 'm102'").run(legacy);
      const kept = await patch({ displayName: legacy, bio: `签名 ${legacy}`, website: 'https://bob.example.test/' });
      expect(kept.statusCode, JSON.stringify(legacy)).toBe(200);
      expect(bob(kept), JSON.stringify(legacy)).toMatchObject({ displayName: legacy, bio: `签名 ${legacy}` });
      expect((await patch({ displayName: ` ${legacy} `, location: '武汉' })).statusCode, JSON.stringify(legacy)).toBe(200);
    }
    // 换成别的昵称仍然要过允许清单和冒名检查，被拒时别的字段也不写。
    const refused = await patch({ displayName: 'b\u2060ob', bio: '不该写进去' });
    expect(refused.statusCode).toBe(400);
    expect(refused.json()).toMatchObject({ error: 'invalid_display_name', message: NAME_RULE });
    expect((await patch({ displayName: 'Carol', bio: '不该写进去' })).json().error).toBe('display_name_taken');
    expect((await s.state('bob')).users.find((u: { id: string }) => u.id === 'm102')).toMatchObject({ displayName: '极客班', bio: '签名 极客班' });
  });
});

/** 一张真实的 PNG：400×300，左红右蓝。 */
const samplePng = () => sharp({ create: { width: 400, height: 300, channels: 3, background: '#d03030' } })
  .composite([{ input: { create: { width: 200, height: 300, channels: 3, background: '#3050d0' } }, left: 200, top: 0 }])
  .png().toBuffer();

/** 只有文件头的 PNG：声明一张很大的画布（默认 20000×20000），数据块只有一行，用来验证像素上限在解码前就拦住。 */
function pixelBombPng(width = 20000, height = 20000) {
  const chunk = (type: string, data: Buffer) => {
    const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
    const length = Buffer.alloc(4); length.writeUInt32BE(data.length);
    const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(body) >>> 0);
    return Buffer.concat([length, body, crc]);
  };
  const header = Buffer.alloc(13);
  header.writeUInt32BE(width, 0); header.writeUInt32BE(height, 4);
  header[8] = 8; header[9] = 0; header[10] = 0; header[11] = 0; header[12] = 0;
  return Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk('IHDR', header), chunk('IDAT', deflateSync(Buffer.alloc(20001))), chunk('IEND', Buffer.alloc(0))]);
}

describe('avatars', () => {
  it('re-encodes an uploaded image to a 256×256 WebP served immutably by content hash, and falls back to GitHub after removal', async () => {
    const s = await setup();
    const upload = (payload: Buffer, type = 'image/png', who: string | null = 'bob') =>
      s.app.inject({ method: 'PUT', url: '/api/forum/me/avatar', payload, headers: { ...(who ? s.as(who) : {}), 'content-type': type } });

    const response = await upload(await samplePng());
    expect(response.statusCode).toBe(200);
    const avatarUrl: string = response.json().state.users.find((u: { id: string }) => u.id === 'm102').avatarUrl;
    expect(avatarUrl).toMatch(/^\/api\/forum\/avatars\/[0-9a-f]{64}\.webp$/);
    const served = await s.app.inject(avatarUrl);
    expect(served.statusCode).toBe(200);
    expect(served.headers['content-type']).toBe('image/webp');
    expect(served.headers['cache-control']).toBe('public, max-age=31536000, immutable');
    expect(served.headers['x-content-type-options']).toBe('nosniff');
    expect(createHash('sha256').update(served.rawPayload).digest('hex')).toBe(avatarUrl.slice(19, 83));
    const meta = await sharp(served.rawPayload).metadata();
    expect([meta.format, meta.width, meta.height, meta.exif]).toEqual(['webp', 256, 256, undefined]);
    // 居中裁切：左半边红、右半边蓝都还在。
    const { data } = await sharp(served.rawPayload).raw().toBuffer({ resolveWithObject: true });
    expect(data[0]).toBeGreaterThan(150);
    expect(data[(255 * 3) + 2]).toBeGreaterThan(150);

    expect((await upload(Buffer.from('not an image at all'))).json()).toMatchObject({ error: 'invalid_image' });
    expect((await upload(Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"/>'), 'image/svg+xml')).statusCode).toBe(415);
    expect((await upload(Buffer.from('{}'), 'application/json')).statusCode).toBe(415);
    const bomb = await upload(pixelBombPng());
    expect(bomb.statusCode).toBe(400);
    expect(bomb.json().error).toBe('image_too_large');
    const huge = await upload(Buffer.alloc(2 * 1024 * 1024 + 1));
    expect(huge.statusCode).toBe(413);
    expect(huge.json()).toMatchObject({ error: 'avatar_too_large', message: '头像不能超过 2MB' });
    expect((await upload(await samplePng(), 'image/png', null)).statusCode).toBe(401);

    const removed = await s.call('DELETE', '/api/forum/me/avatar', 'bob');
    expect(removed.json().state.users.find((u: { id: string }) => u.id === 'm102').avatarUrl).toBe('https://avatars.example.test/bob');
    const gone = await s.app.inject(avatarUrl);
    expect(gone.statusCode).toBe(404);
    expect(gone.headers['cache-control']).toBe('no-store');
    expect((await s.app.inject('/api/forum/avatars/not-a-hash.webp')).statusCode).toBe(400);
  });

  it('limits avatar uploads to 10 an hour', async () => {
    const s = await setup();
    await s.state('bob');
    for (let i = 0; i < 10; i += 1) s.app.services.forum.rateRecord('avatar', 'm102');
    const response = await s.app.inject({ method: 'PUT', url: '/api/forum/me/avatar', payload: await samplePng(), headers: { ...s.as('bob'), 'content-type': 'image/png' } });
    expect(response.statusCode).toBe(429);
  });

  it('checks the session and the hourly count before reading the body, and counts uploads that fail to decode', async () => {
    const s = await setup();
    const upload = (payload: Buffer, who: string | null = 'bob') =>
      s.app.inject({ method: 'PUT', url: '/api/forum/me/avatar', payload, headers: { ...(who ? s.as(who) : {}), 'content-type': 'image/png' } });
    const oversized = Buffer.alloc(2 * 1024 * 1024 + 1);
    // 游客连超大的请求体都不会被读：先回 401，而不是读完再回 413。
    expect((await upload(oversized, null)).json().error).toBe('signin_required');

    // 解不出来的图也占额度：10 次坏图之后，好图也要等。
    for (let i = 0; i < 10; i += 1) expect((await upload(Buffer.from(`not an image ${i}`))).json().error).toBe('invalid_image');
    expect((await upload(await samplePng())).statusCode).toBe(429);
    // 超了次数就不再读请求体。
    expect((await upload(oversized)).statusCode).toBe(429);
    expect(s.db.prepare("SELECT COUNT(*) AS n FROM forum_rate_events WHERE bucket = 'avatar' AND subject = 'm102'").get()).toEqual({ n: 10 });
  });

  it('refuses images over 4096×4096 pixels before decoding them', async () => {
    const s = await setup();
    const upload = async (payload: Buffer) => (await s.app.inject({ method: 'PUT', url: '/api/forum/me/avatar', payload, headers: { ...s.as('bob'), 'content-type': 'image/png' } })).json();
    // 5000×4000 = 2000 万像素：比 4096×4096 大，比以前的 3600 万小。
    expect(await upload(pixelBombPng(5000, 4000))).toMatchObject({ error: 'image_too_large', message: '图片尺寸太大\uFF0C请换一张小一点的图' });
    expect(await upload(pixelBombPng(4097, 4096))).toMatchObject({ error: 'image_too_large' });
  });
});

describe('seeding', () => {
  it('inserts only missing legacy topics and never overwrites what changed online', async () => {
    const s = await setup();
    const { forum } = s.app.services;
    await s.call('POST', '/api/forum/topics/t73/pin', 'alice', { pinned: false });
    await s.call('POST', '/api/forum/posts', 'bob', { topicId: 't73', content: '线上的回复' });
    await s.call('PATCH', '/api/forum/posts/body-73', 'alice', { content: '线上改过的首帖' });
    expect(forum.seed()).toBe(0);
    const state = await s.state();
    expect(state.topics.find((t: { id: string }) => t.id === 't73').pinned).toBe(false);
    expect(state.posts.find((p: { id: string }) => p.id === 'body-73').content).toBe('线上改过的首帖');
    expect(state.posts).toHaveLength(3);
    expect(state.counters).toMatchObject({ topic: 1000, post: 10001 });

    // 以后导出的新帖：重新发版后只插入新的那一篇。
    const content = loadForumContent(FORUM_FIXTURE_DIR);
    const next = createForumStore(s.db, { ...content, topics: [...content.topics, { ...content.topics[1], id: 't5', slug: 'topic-5', title: '后来导出的旧帖', content: '正文' }] });
    expect(next.seed()).toBe(1);
    expect(next.seed()).toBe(0);
    expect((await s.state()).posts.map((p: { id: string }) => p.id)).toContain('body-5');
  });

  it('refuses to start with content that does not hold together', () => {
    const dir = mkdtempSync(join(tmpdir(), 'geek-forum-content-'));
    dirs.push(dir);
    cpSync(FORUM_FIXTURE_DIR, dir, { recursive: true });
    const topicsFile = join(dir, 'published/topics.json');
    const original = JSON.parse(readFileSync(topicsFile, 'utf8'));
    const write = (patch: (value: any) => void) => {
      const value = structuredClone(original); patch(value); writeFileSync(topicsFile, JSON.stringify(value));
    };
    write(value => { value.topics[0].categoryId = 'c-missing'; });
    expect(() => loadForumContent(dir)).toThrow('unknown category c-missing');
    write(value => { value.topics[0].id = 't1001'; });
    expect(() => loadForumContent(dir)).toThrow('invalid topic id');
    write(value => { value.topics[0].tagIds = ['tag-missing']; });
    expect(() => loadForumContent(dir)).toThrow('unknown tag');
    write(value => { value.topics.push(value.topics[0]); });
    expect(() => loadForumContent(dir)).toThrow('duplicate topic t73');
    rmSync(topicsFile);
    expect(() => loadForumContent(dir)).toThrow('published/topics.json: cannot read');
  });

  it('parses the public content files the server image ships', () => {
    // 只核对真实公开文件能被服务端读出来（否则镜像启动就失败）；其余用例都用夹具。
    const content = loadForumContent(join(REPO_ROOT, 'app/forum/content'));
    expect(content.categories.map(category => category.id)).toEqual(['c-exam', 'c-announcements', 'c-courses', 'c-competitions', 'c-careers', 'c-ai']);
    expect(content.topics.length).toBeGreaterThan(0);
    expect(content.topics.every(topic => Number(topic.id.slice(1)) < 1000)).toBe(true);
    expect(content.author.id).toBe('u-geekclass');
  });
});

describe('client address behind the two deployment proxies', () => {
  // 部署链路：客户端 → 宿主 nginx → web 容器 nginx（172.18.0.3）→ server。两层 nginx 各往 X-Forwarded-For 末尾追加一段
  // （宿主 nginx 追加客户端地址，web 容器追加它看到的宿主一侧 172.18.0.1）；客户端自己带的 X-Forwarded-For 排在最左边。
  const through = (spoofed: string, client: string, extra: Record<string, string> = {}) => ({
    remoteAddress: '172.18.0.3', headers: { ...extra, 'x-forwarded-for': `${spoofed}, ${client}, 172.18.0.1` },
  });
  const guestThrough = (s: Setup, spoofed: string, client = '198.51.100.7') =>
    s.app.inject({ method: 'POST', url: '/api/forum/posts', payload: guestReply('t9', '回复'), ...through(spoofed, client) });

  it('with TRUST_PROXY=2 counts guest replies and audits by the address the host nginx saw, however the client rotates its own header', async () => {
    const s = await setup({ env: { TRUST_PROXY: '2' } });
    const statuses: number[] = [];
    for (let i = 1; i <= 6; i += 1) statuses.push((await guestThrough(s, `10.0.0.${i}`)).statusCode);
    expect(statuses).toEqual([201, 201, 201, 201, 201, 429]);
    expect((await guestThrough(s, '10.0.0.99', '198.51.100.8')).statusCode).toBe(201);
    expect(s.db.prepare("SELECT DISTINCT subject FROM forum_rate_events WHERE bucket = 'guestPost' ORDER BY subject").all())
      .toEqual([{ subject: '198.51.100.7' }, { subject: '198.51.100.8' }]);

    const pinned = await s.app.inject({ method: 'POST', url: '/api/forum/topics/t9/pin', payload: { pinned: true }, ...through('10.9.9.9', '198.51.100.9', s.as('alice')) });
    expect(pinned.statusCode).toBe(200);
    expect(s.db.prepare("SELECT ip FROM audit_logs WHERE action = 'forum.topic.pin'").all()).toEqual([{ ip: '198.51.100.9' }]);
  });

  it('with TRUST_PROXY=true the rotated header got through every time (the bug the hop count fixes)', async () => {
    const s = await setup({ env: { TRUST_PROXY: 'true' } });
    for (let i = 1; i <= 6; i += 1) expect((await guestThrough(s, `10.0.0.${i}`)).statusCode).toBe(201);
  });

  it('keeps local development on loopback trust when TRUST_PROXY is unset', async () => {
    const s = await setup();
    // 不经回环代理直连时，客户端带的 X-Forwarded-For 不算数。
    const direct = (spoofed: string) => s.app.inject({ method: 'POST', url: '/api/forum/posts', payload: guestReply('t9', '回复'), remoteAddress: '203.0.113.20', headers: { 'x-forwarded-for': spoofed } });
    const statuses: number[] = [];
    for (let i = 1; i <= 6; i += 1) statuses.push((await direct(`10.0.0.${i}`)).statusCode);
    expect(statuses).toEqual([201, 201, 201, 201, 201, 429]);
    // 本机开发代理（回环）转发时照旧取它追加的地址。
    const proxied = await s.app.inject({ method: 'POST', url: '/api/forum/posts', payload: guestReply('t9', '回复'), remoteAddress: '127.0.0.1', headers: { 'x-forwarded-for': '198.51.100.30' } });
    expect(proxied.statusCode).toBe(201);
    expect(s.db.prepare("SELECT DISTINCT subject FROM forum_rate_events WHERE bucket = 'guestPost' ORDER BY subject").all())
      .toEqual([{ subject: '198.51.100.30' }, { subject: '203.0.113.20' }]);
  });
});

describe('rules', () => {
  it('keys IPv6 addresses by their /64 and IPv4-mapped addresses as IPv4', () => {
    expect([
      '203.0.113.5', '::ffff:203.0.113.5', '2001:db8:1:2:3:4:5:6', '2001:0DB8:0001:0002::', '2001:db8::1',
      'fe80::1%eth0', '::1', '64:ff9b::192.0.2.1', 'not-an-ip',
    ].map(ipSubject)).toEqual([
      '203.0.113.5', '203.0.113.5', '2001:db8:1:2::/64', '2001:db8:1:2::/64', '2001:db8:0:0::/64',
      'fe80:0:0:0::/64', '0:0:0:0::/64', '64:ff9b:0:0::/64', 'not-an-ip',
    ]);
  });

  it('compares names after NFKC, without case or accents', () => {
    expect(nameKey('\uFF27\uFF45\uFF45\uFF4B\uFF23\uFF4C\uFF41\uFF53\uFF53')).toBe('geekclass');
    expect(nameKey('  B\u00F3b  ')).toBe('bob');
    expect(nameKey('L\u01DA  Xi\u01CEom\u00EDng')).toBe('lu xiaoming');
    expect(nameKey('がくせい')).toBe('かくせい');
    expect(nameKey('김민수')).toBe('김민수');
    expect(nameKey('极客\u3000 班')).toBe('极客 班');
  });
});

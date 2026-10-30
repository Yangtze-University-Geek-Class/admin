import { createHash } from 'node:crypto';
import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { crc32, deflateSync } from 'node:zlib';
import { afterEach, describe, expect, it } from 'vitest';
import { REPO_ROOT } from '../../app/server/src/config';
import { loadForumContent } from '../../app/server/src/lib/forum-content';
import { ipSubject, nameKey } from '../../app/server/src/lib/forum-rules';
import { createForumStore } from '../../app/server/src/lib/forum-store';
import { setExclusiveGroupMembership } from '../../app/server/src/lib/permissions';
import { FORUM_FIXTURE_DIR, accountIdOf, activityRows, grantPermGroup, grantPermNode, signIn, testApp } from './helpers';
import { STATIC_CDN_BASE } from '../../app/server/src/lib/static-cdn';

/** sharp 是 app/server 的依赖，根目录没有它；从 server 包里取，用来生成真实的测试图片和核对输出。 */
const sharp = createRequire(join(REPO_ROOT, 'app/server/package.json'))('sharp') as typeof import('../../app/server/node_modules/sharp');

const FORUM_CAPS = ['forum.topic.pin', 'forum.topic.close', 'forum.post.moderate', 'forum.category.manage', 'forum.badge.assign'];
const USERS: Record<string, number> = { alice: 101, bob: 102, carol: 103, dave: 104, erin: 105, frank: 106, 'da-ve': 108 };

const contexts: { close: () => Promise<unknown> }[] = [];
const dirs: string[] = [];
afterEach(async () => {
  for (const c of contexts.splice(0)) await c.close();
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

/**
 * alice 是提督（见下面的 setSiteRole）；bob、carol、dave、erin 是普通成员，其中 carol 是社区部舰员（能管帖子、
 * 置顶、关闭），dave 是项目部队长（只能置顶），erin 是领航员；da-ve 是另一个普通成员，登录名去掉 - 和 dave 一样；
 * frank 只是普通注册账号，没有任何部门指派或站内角色。#274 review round 1 起论坛、版务权限不再查 GitHub
 * （see setup() 的 testApp 调用不传 octokitFactory，用 testApp 默认的「调用即报错」桩，顺带证明确实没人调用）。
 */
async function setup(options: { env?: Record<string, string> } = {}) {
  const context = await testApp({}, false, options.env);
  contexts.push(context);
  const { app } = context;
  const sids = new Map<string, string>();
  const as = (login: string) => {
    if (!sids.has(login)) {
      sids.set(login, signIn(app, login, USERS[login], `https://avatars.githubusercontent.com/test/${login}`, `token-${login}`));
      // 这些场景约定了明确的 @用户名；注册时自动生成的 acct_* 不是 GitHub 登录名。
      expect(app.services.profiles.update(accountIdOf(app, login), { username: login.replace(/-/g, '_') }).ok).toBe(true);
    }
    return { cookie: `sid=${sids.get(login)}` };
  };
  const assign = (login: string, role: 'captain' | 'head' | 'member' | 'alumni', department_id = '') =>
    app.services.roles.insertAssignment({ github_login: login, github_user_id: USERS[login], role, department_id, note: null, granted_by: 'fixture' });
  assign('carol', 'member', 'community');
  assign('dave', 'head', 'projects');
  assign('erin', 'alumni');
  // #274：版务权限不再经旧的 role_assignments/capabilities（那一套留着只影响上面 state().viewer.capabilities
  // 的展示，#276 才会迁走），版面行为（置顶/关闭/编辑删帖）按新权限节点判定。SPEC §3.4「部门」行是不分部员/
  // 部长的统一授权：部门组本身就带 forum.moderate.*，哪一级称号都继承。department→真实论坛分类的对照已经
  // 落在 lib/migrations/2026-10-yugc-v2.ts 的 DEPARTMENT_FORUM_CATEGORIES 里（该映射本身另有专门测试，见
  // tests/server/permissions.test.ts「部门的 scope 通配只覆盖本部门对应的真实论坛分类」），但现实里没有
  // 任何一个部门同时覆盖夹具用到的 c-exam 和 c-ai 两个分类，这里按夹具话题实际用到的两个分类直接发放，
  // 只是为了让这份版面行为测试不依赖账号具体分到哪个部门。carol、dave 两个部门账号拿到同一份
  // 权限，不再有「队长只能置顶、舰员才能关闭/删帖」的分级。
  as('carol'); as('dave');
  for (const login of ['carol', 'dave']) {
    grantPermNode(app, accountIdOf(app, login), 'forum.moderate.*', { category: ['c-exam', 'c-ai'] });
  }
  // #274：能不能发帖回帖按权限节点判定（forum.topic.create 等只在 level.member 才有，见迁移种子），
  // 不再是「登录就算数」（access.member 那套的老口径，这正是 SPEC §3.2 要堵的洞）。这份夹具里 alice、
  // bob、carol、dave、da-ve 都是文档注释说的「普通成员」，erin 是往届成员，都要显式放进对应的 level 组，
  // 不能只靠 signIn()（没有邀请码默认落在 level.registered，没有发帖权限）。frank 不在组织里，留在
  // level.registered，不升级。
  for (const login of ['alice', 'bob', 'carol', 'dave', 'erin', 'da-ve']) as(login);
  const setLevel = (login: string, groupId: string) => {
    setExclusiveGroupMembership(app.services.storage.db, accountIdOf(app, login), groupId, Date.now(), 'test');
    app.services.permissions.bump();
  };
  for (const login of ['alice', 'bob', 'carol', 'dave', 'da-ve']) setLevel(login, 'level.member');
  setLevel('erin', 'level.alumni');
  // #274 review round 1（blocker）：alice 的提督身份不再靠 GitHub 组织角色实时补查自动获得——那条路径
  // 已经从 lib/access.ts 删掉（见 identity-store.ts 的 syncPermissionLevel 注释），access.resolve() 现在
  // 纯读本地记录、不再调 GitHub、也不会把刚手动设的 level.alumni 之类重新同步掉，所以这里不用再配合
  // GitHub 角色桩；直接发 title.site.owner 就够。
  grantPermGroup(app, accountIdOf(app, 'alice'), 'title.site.owner');
  const call = (method: 'GET' | 'POST' | 'PATCH' | 'PUT' | 'DELETE', url: string, who?: string, payload?: object) =>
    app.inject({ method, url, ...(payload === undefined ? {} : { payload }), headers: who ? as(who) : {} });
  const state = async (who?: string) => (await call('GET', '/api/forum/state', who)).json().state;
  // #274 item I：audit_logs 不再有人写，改读 activity_events；org/actor 对应的 GitHub 组织概念已经删掉，没有等价字段。
  const audits = () => activityRows(app, { actionLike: 'forum.%' }).map(row => ({ account_id: row.account_id, action: row.action, target: row.target_id, meta: row.meta }));
  return { app, as, call, state, audits, db: app.services.storage.db };
}
type Setup = Awaited<ReturnType<typeof setup>>;

/**
 * 昵称允许清单（lib/forum-rules.ts 的 isAllowedName）要拒绝的名字：前几轮审查找到的每一个探针都在这里。
 * 零宽与格式字符、双向覆盖（显示成「极客班」）、BOM、韩文填充字、C1 控制字符、行分隔符、软连字符、盲文空格、乐谱空符头、
 * 高棉文不发音元音、单独的附加符号、未分配的可忽略字符（U+2065、U+FFF0、U+E0080）、私用区、西里尔、希腊、亚美尼亚、
 * 傈僳、切罗基的形近字母、NFKC 之后是希腊字母的 µ、小型大写与搭嘴音这类形近拉丁字母、表情、连着的空格、只有符号，
 * 还有单独的韩文字母（「极客班」后面跟一个元音字母 U+1161 看不出来；兼容字母ㄱ在 NFKC 之后也是单独的字母）。
 */
const REFUSED_NAMES = [
  '极客班\u200B', 'geekclass\u2060', '\u202E班客极', '极\u200D客班', 'bo\uFEFFb', '\u3164', 'bob\u0085', '极客\u2028班', '极客班\u00AD',
  '极客班\u2800', '\u2800', '\u{1D159}', 'bob\u{1D159}', '\u17B4', '\u17B5', '\u0332', 'bob\u0332', '\u20DD\u0301',
  'bob\u2065', 'bob\uFFF0', 'bob\u{E0080}', 'bob\uE000',
  'b\u043Eb', 'geekcl\u0430ss', '\u041A\u043E\u0432\u0430\u043B\u0451\u0432', 'b\u03BFb', '\u{1D41B}\u03BFb', '\u0391\u03BB\u03AD\u03BE\u03B7\u03C2',
  'b\u0585b', '\uA4D0ob', '\u13A0ave', '5\u00B5m', '\u0299ob', 'geekc\u01C0ass', '小博\u{1F389}', '张  三', '---', '·',
  '极客班\u1161', '\u1100', 'bob\uA960', 'bob\uD7B0', '\u3131\u3131',
  // 属于允许的文字、但不是字母的字符：韩文声调符号 U+302E，汉字部首 U+2E80（Script=Han，类别 So）。
  '极客班\u302E', '极客班\u2E80',
];
/** 允许清单要收的名字：汉字、拉丁字母（含拼音声调、越南文）、假名、韩文、数字和几个分隔符。 */
const ALLOWED_NAMES = ['张 三', 'Zhang San', '小博bob', '田中さん', '김민수', '\u1100\u1161\u11A8', "O'Neil", 'ab-cd_e.f', 'Lǚ Xiǎomíng', 'Nguyễn Văn An', '阿·凡提', '中村・花子', 'ラーメン'];
const NAME_RULE = "昵称只能用汉字、字母、假名、韩文、数字、空格和 - _ . · ・ ' 这几个符号，空格不能连着用";

async function newTopic(s: Setup, who = 'bob', patch: Record<string, unknown> = {}) {
  const response = await s.call('POST', '/api/forum/topics', who, { title: '新话题', categoryId: 'c-ai', tags: [], content: '正文', ...patch });
  expect(response.statusCode).toBe(201);
  return response.json() as { topicId: string; postId: string; changes: any };
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
      createdAt: 1700000000000, lastActivityAt: 1700000000000, views: 12, pinned: true, closed: false, visibility: 'public',
    });
    expect(state.posts.map((p: { id: string; authorId: string }) => `${p.id}:${p.authorId}`)).toEqual(['body-9:u-geekclass', 'body-73:u-geekclass']);
    expect(state.users).toEqual([{
      id: 'u-geekclass', username: 'geekclass', displayName: '极客班', bio: '夹具官方账号', location: '', website: '', avatarColor: '#2f6fed',
      joinedAt: 1690000000000, role: 'admin', notifyPrefs: { reply: false, like: false, follow: false }, kind: 'official',
      department: null, titles: [],
    }]);
    // 团队负责人 #276 追加：游客的分级可见等级是 public，六个写权限节点一个都没有。
    expect(state.viewer).toEqual({ userId: null, kind: 'guest', capabilities: [], level: 'public', nodes: [] });
  });

  it('creates the member on the first signed-in request, refreshes role, title and GitHub avatar, and keeps what they edited', async () => {
    const s = await setup();
    const first = await s.state('alice');
    // 团队负责人 #276 追加：alice 持 title.site.owner（节点 "*"，见 2026-10-yugc-v2.ts 的迁移种子），
    // 六个写权限节点全都有，和 level.member 单独能拿到的那五个（没有 forum.moderate.edit）不一样。
    expect(first.viewer).toEqual({
      userId: 'm101', kind: 'member', capabilities: FORUM_CAPS, level: 'member',
      nodes: ['forum.topic.create', 'forum.reply.create', 'forum.react', 'forum.sticker.use', 'forum.upload.image', 'forum.moderate.edit'],
    });
    const alice = first.users.find((u: { id: string }) => u.id === 'm101');
    expect(alice).toMatchObject({ username: 'alice', displayName: 'alice', role: 'admin', title: { id: 'admin' }, avatarUrl: 'https://avatars.githubusercontent.com/test/alice', kind: 'member', notifyPrefs: { reply: true, like: true, follow: true } });
    expect(Object.keys(alice)).not.toContain('github_user_id');

    // carol、dave 都是部门账号，拿到同一份 forum.moderate.* 授权（见上面 setup() 的注释：新权限体系不再有
    // 「队长只能置顶、舰员才能关闭/删帖」的分级），capabilities 这个显隐提示现在也从权限引擎算，和 dave 一样。
    // 称号徽章只保真 title.site.owner 和 level.alumni 两件事（#274，CONTRACT-276.md §9 之前不读部门称号），
    // carol、dave 都没有 title.* 组，徽章是 null，不再是 role_assignments 给的「舰员/队长」。
    const carol = (await s.state('carol'));
    expect(carol.viewer.capabilities).toEqual(['forum.topic.pin', 'forum.topic.close', 'forum.post.moderate']);
    // 没有称号徽章时 title 列在 DB 里是 NULL，读出来是 undefined，JSON 序列化直接丢掉这个键，不是 "title": null。
    const carolUser = carol.users.find((u: { id: string }) => u.id === 'm103');
    expect(carolUser).toMatchObject({ role: 'member' });
    expect(carolUser.title).toBeUndefined();
    expect((await s.state('dave')).viewer.capabilities).toEqual(['forum.topic.pin', 'forum.topic.close', 'forum.post.moderate']);
    expect((await s.state('bob')).viewer.capabilities).toEqual([]);
    expect((await s.state('erin')).users.find((u: { id: string }) => u.id === 'm105').title).toEqual({ id: 'alumni' });

    expect((await s.call('PATCH', '/api/forum/me/profile', 'bob', { displayName: '小博' })).statusCode).toBe(200);
    // GitHub 头像换了：下一次请求就刷新，自己改的昵称不动。往 role_assignments 里插一条称号指派
    // 不再影响论坛徽章——那张表迁移后只给控制台旧页面读，论坛称号只认 title.site.owner / level.alumni。
    s.app.services.roles.insertAssignment({ github_login: 'bob', github_user_id: 102, role: 'head', department_id: 'tech', note: null, granted_by: 'fixture' });
    signIn(s.app, 'bob', 102, 'https://avatars.githubusercontent.com/test/bob-new', 'token-bob-new');
    const bob = (await s.state('bob')).users.find((u: { id: string }) => u.id === 'm102');
    expect(bob).toMatchObject({ displayName: '小博', avatarUrl: 'https://avatars.githubusercontent.com/test/bob-new' });
    expect(bob.title).toBeUndefined();
  });

  it('never asks GitHub to read or write the forum, so a GitHub outage cannot affect it (#274 review round 1)', async () => {
    // #274 review round 1（blocker）：/api/forum/state 和每个版面写接口再也不会用会话自带的令牌问 GitHub
    // 组织角色（那条路径——access.resolve 的 GitHub 调用——已经整段删掉，lib/access.ts 不再接收 accessToken/
    // provider 做查询）。上面「#164」那组用例（GitHub 出错/令牌被收回时结束会话）测的正是这条被删掉的路径，
    // 通用的「上游 401 结束会话、5xx 统一脱敏」契约已经在 tests/server/upstream-errors.test.ts 用一个独立的
    // 合成路由钉住，不再依赖某个具体业务接口——这里改成直接证明论坛读写全程不碰 GitHub：setup() 用的是
    // testApp 默认「调用即报错」的 octokitFactory 桩，真的调用一次就会让这个用例直接抛错失败。
    const s = await setup();
    expect((await s.state('bob')).viewer.kind).toBe('member');
    expect((await s.call('POST', '/api/forum/posts/body-9/bookmark', 'bob')).statusCode).toBe(200);
  });

  it('is a real forum member with no capabilities when it has no recorded site role or department assignment (#274 review round 1: forum membership follows the site account, not an org role)', async () => {
    const s = await setup();
    // frank 没有 role_assignments、也没被 setSiteRole 提升过：按 SPEC §3.6，论坛成员资格只看账号本身是不是
    // 启用（lib/access.ts 的 membershipOf），不再看有没有被记过站内角色——和邮箱、Google 注册的普通用户是
    // 同一条规则（tests/server/signin-methods.test.ts「lets a plain registered email account...」）。
    const frank = await s.state('frank');
    // 团队负责人 #276 追加：frank 留在 level.registered（见上面 setup() 的注释），论坛身份是 member（真实
    // 有过账号），但分级可见等级只是 registered，六个写权限节点一个都没有——这正是旧 kind 字段分不出来的
    // 那种人：kind 和成员一样是 "member"，level/nodes 才能让前端知道他不能发话题、回复、点表情或传图。
    expect(frank.viewer).toEqual({ userId: 'm106', kind: 'member', capabilities: [], level: 'registered', nodes: [] });
    expect(frank.users.map((u: { id: string }) => u.id)).toContain('m106');

    // carol 的版务能力来自显式的部门指派（role_assignments）和新权限节点（setup() 里的 grantPermNode），
    // 都不挂在 org_role 上；提督把她设成「极客班成员」再改回「不是成员」，两次都是真的状态变化，但论坛身份
    // 和能力全程不受影响（item 2 的要点正是把这两件事彻底分开，不再有「退组织/改角色」牵连论坛权限这回事）。
    const before = (await s.state('carol')).viewer.capabilities;
    expect(before).toEqual(['forum.topic.pin', 'forum.topic.close', 'forum.post.moderate']);
    const accountId = s.app.services.identity.accountForGithub(USERS.carol)!;
    expect(s.app.services.identity.setSiteRole({ accountId, role: 'member', actor: { login: 'alice', account_id: null } })).toEqual({ ok: true, changed: true });
    expect((await s.state('carol')).viewer.capabilities).toEqual(before);
    expect(s.app.services.identity.setSiteRole({ accountId, role: 'none', actor: { login: 'alice', account_id: null } })).toEqual({ ok: true, changed: true });
    expect((await s.state('carol')).viewer.capabilities).toEqual(before);
    expect((await s.call('POST', '/api/forum/topics/t9/pin', 'carol', { pinned: true })).statusCode).toBe(200);
  });

  it('keeps a demoted member’s forum identity and profile editing, but drops their write nodes (#274 SPEC §3.2: 降级只影响 level 组，不影响论坛身份)', async () => {
    const s = await setup();
    // 提督把 bob 的站内角色改成「不是成员」：level 组降回 level.registered（syncPermissionLevel），
    // 论坛身份还在、不是游客，只是重新落回「注册用户不能发帖回帖」——不会悄悄滑进游客的 PoW 回帖口子，
    // 自己的资料（昵称等）仍然能改，那是账号自己的事，不是论坛写权限。bob 是用 signIn() 直接建的测试账号，
    // 没填邀请码，旧的 org_role/org_state 字段一开始就是「不是成员」——先走一次 setSiteRole('member') 把
    // 这两个字段也翻成「成员」，才有「降级」这回事可测，和上面 carol 的两段式调用一致。
    const accountId = s.app.services.identity.accountForGithub(USERS.bob)!;
    expect(s.app.services.identity.setSiteRole({ accountId, role: 'member', actor: { login: 'alice', account_id: null } })).toEqual({ ok: true, changed: true });
    expect(s.app.services.identity.setSiteRole({ accountId, role: 'none', actor: { login: 'alice', account_id: null } })).toEqual({ ok: true, changed: true });
    const demoted = await s.state('bob');
    expect(demoted.viewer).toMatchObject({ kind: 'member', capabilities: [] });
    expect((await s.call('POST', '/api/forum/topics/t9/pin', 'bob', { pinned: true })).json().error).toBe('forbidden');
    expect((await s.call('POST', '/api/forum/topics', 'bob', { title: '还能发吗', categoryId: 'c-ai', content: '正文' })).statusCode).toBe(403);
    expect((await s.call('PATCH', '/api/forum/me/profile', 'bob', { displayName: '还能改吗' })).statusCode).toBe(200);
    expect((await s.call('POST', '/api/forum/posts', 'bob', { topicId: 't9', content: '按成员回复' })).json().error).toBe('forbidden');
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

  // SPEC §3.8: anonymous read is capped at 60/min (meta.limit.read.per_minute), tighter than the
  // route's own flat 120/min IP limit (FORUM_REQUEST_LIMITS), so the new check fires first.
  it('limits an anonymous /api/forum/state caller to 60 requests a minute per IP (SPEC §3.8 visitor tier)', async () => {
    const s = await setup();
    const get = (remoteAddress: string) => s.app.inject({ method: 'GET', url: '/api/forum/state', remoteAddress });
    for (let i = 0; i < 60; i += 1) expect((await get('198.51.100.40')).statusCode).toBe(200);
    const limited = await get('198.51.100.40');
    expect(limited.statusCode).toBe(429);
    expect(limited.json()).toMatchObject({ error: 'rate_limited', bucket: 'read.per_minute', message: '操作太频繁\uFF0C请稍后再试' });
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

describe('list state without bodies (#156)', () => {
  /** 一帖很长的正文：它只要出现在首屏，大小就看得出差别。尾部的标记只在这里出现。 */
  const TAIL = '正文结尾标记-不在首屏-38f2';
  const LONG = `# 标题\n\n${'这一段是正文，用来验证首屏不再带整篇内容。'.repeat(200)}${TAIL}`;

  it('carries no post body and a one-line excerpt per post in /state', async () => {
    const s = await setup();
    const { topicId, postId } = await newTopic(s, 'bob', { content: LONG });
    await s.call('POST', '/api/forum/posts', 'carol', { topicId, content: '短回复' });
    const res = await s.call('GET', '/api/forum/state');
    const { posts } = res.json().state as { posts: any[] };
    // 整篇正文不在回答里（标题与正文的尾部标记都不在）。
    expect(res.body).not.toContain(TAIL);
    expect(res.body).not.toContain('# 标题');
    for (const post of posts) {
      expect(Object.keys(post), post.id).not.toContain('content');
      expect(typeof post.excerpt).toBe('string');
    }
    // 摘要是纯文本（标题符号与换行都被压掉），长帖截到 200 字加省略号。
    const long = posts.find(post => post.id === postId);
    expect(long.excerpt).not.toContain('#');
    expect(long.excerpt).not.toContain('\n');
    expect(long.excerpt).toHaveLength(201);
    expect(long.excerpt.endsWith('…')).toBe(true);
    expect(posts.find(post => post.id === 'body-9').excerpt.length).toBeLessThan(201);
    // 除正文外，帖子记录的其它字段照旧：列表与个人页的计数不用变。
    expect(Object.keys(posts[0]).sort()).toEqual(['authorId', 'createdAt', 'excerpt', 'id', 'likeUserIds', 'reactions', 'topicId', 'visibility']);
  });

  it('serves one topic\'s posts with bodies, for anyone, and 404s an unknown topic', async () => {
    const s = await setup();
    const { topicId, postId } = await newTopic(s, 'bob', { content: LONG });
    await s.call('POST', '/api/forum/posts', 'carol', { topicId, content: '短回复' });

    const guest = await s.app.inject({ method: 'GET', url: `/api/forum/topics/${topicId}/posts` });
    expect(guest.statusCode).toBe(200);
    expect(guest.headers['cache-control']).toBe('no-store');
    const posts = guest.json().posts as any[];
    expect(posts.map(post => post.id)).toEqual([postId, expect.any(String)]);
    expect(posts[0].content).toBe(LONG);
    expect(posts[0]).not.toHaveProperty('excerpt');
    // 与 /state 里同一条的其它字段逐项相同，包括点赞的人。
    await s.call('POST', `/api/forum/posts/${postId}/like`, 'carol');
    const listed = (await s.state()).posts.find((post: { id: string }) => post.id === postId)!;
    const { excerpt: _excerpt, ...listedRest } = listed;
    expect((await s.app.inject({ method: 'GET', url: `/api/forum/topics/${topicId}/posts` })).json().posts[0]).toEqual({ ...listedRest, content: LONG });

    const missing = await s.app.inject({ method: 'GET', url: '/api/forum/topics/t404/posts' });
    expect(missing.statusCode).toBe(404);
    expect(missing.json()).toMatchObject({ error: 'not_found', message: '话题不存在' });
  });

  it('searches titles, bodies, names and usernames on the server, and matches nothing else', async () => {
    const s = await setup();
    const { topicId, postId } = await newTopic(s, 'bob', { title: '机试安排在什么时候', content: `早前的正文\n\n${LONG}` });
    await s.state('bob');

    // 正文深处的词也搜得到（浏览器里已经没有正文了），命中摘要以它为中心。
    const hit = (await s.app.inject({ method: 'GET', url: '/api/forum/search?q=%E7%94%A8%E6%9D%A5%E9%AA%8C%E8%AF%81' })).json().results;
    expect(hit.posts.map((post: { id: string }) => post.id)).toEqual([postId]);
    expect(hit.posts[0].excerpt).toContain('用来验证');
    expect(hit.posts[0].excerpt.length).toBeLessThanOrEqual(122);
    expect(hit.posts[0]).not.toHaveProperty('content');

    // 话题标题、用户名、昵称都匹配。
    expect((await s.app.inject({ method: 'GET', url: '/api/forum/search?q=%E6%9C%BA%E8%AF%95%E5%AE%89%E6%8E%92' })).json().results.topics.map((t: { id: string }) => t.id)).toEqual([topicId]);
    expect((await s.app.inject({ method: 'GET', url: '/api/forum/search?q=bob' })).json().results.users.map((u: { id: string }) => u.id)).toEqual(['m102']);
    expect((await s.app.inject({ method: 'GET', url: '/api/forum/search?q=%E6%9E%81%E5%AE%A2%E7%8F%AD' })).json().results.users.map((u: { id: string }) => u.id)).toEqual(['u-geekclass']);

    // 空词回空结果；删掉的帖子不参与（与浏览器里旧的 searchAll 一致）。
    expect((await s.app.inject({ method: 'GET', url: '/api/forum/search?q=%20' })).json().results).toEqual({ topics: [], posts: [], users: [] });
    expect((await s.app.inject({ method: 'GET', url: '/api/forum/search' })).json().results.posts).toEqual([]);
    await s.call('DELETE', `/api/forum/posts/${(await s.call('POST', '/api/forum/posts', 'carol', { topicId, content: '将被删除的回复' })).json().postId}`, 'carol');
    expect((await s.app.inject({ method: 'GET', url: '/api/forum/search?q=%E5%B0%86%E8%A2%AB%E5%88%A0%E9%99%A4' })).json().results.posts).toEqual([]);

    // 搜索词里的 `%` 是字面量，不是通配符；超长的词 400。
    expect((await s.app.inject({ method: 'GET', url: '/api/forum/search?q=%25' })).json().results).toEqual({ topics: [], posts: [], users: [] });
    const tooLong = await s.app.inject({ method: 'GET', url: `/api/forum/search?q=${'x'.repeat(101)}` });
    expect(tooLong.statusCode).toBe(400);
    expect(tooLong.json()).toMatchObject({ error: 'validation_error' });

    // 游客也能搜，但看到的不比 /state 多：别人的通知、书签不在结果里。
    await s.call('PATCH', '/api/forum/me/profile', 'carol', { bio: '搜索用的签名' });
    expect((await s.app.inject({ method: 'GET', url: '/api/forum/search?q=%E6%90%9C%E7%B4%A2%E7%94%A8%E7%9A%84%E7%AD%BE%E5%90%8D' })).json().results.users).toEqual([]);
  });

  // SPEC §3.8: anonymous read is capped at 60/min and search at 10/min (meta.limit.read.per_minute /
  // meta.limit.search.per_minute), both tighter than the routes' own flat IP limits (120/30 per min), so
  // the new per-level check fires first.
  it('limits an anonymous caller to 60 topic-post reads and 10 searches a minute per IP (SPEC §3.8 visitor tier)', async () => {
    const s = await setup();
    const address = '198.51.100.43';
    const posts = (n: number) => s.app.inject({ method: 'GET', url: '/api/forum/topics/t9/posts', remoteAddress: address, headers: { 'x-forwarded-for': `198.51.100.${n}` } });
    for (let i = 0; i < 60; i += 1) expect((await posts(i)).statusCode).toBe(200);
    expect((await posts(1)).statusCode).toBe(429);
    const search = () => s.app.inject({ method: 'GET', url: '/api/forum/search?q=a', remoteAddress: address });
    for (let i = 0; i < 10; i += 1) expect((await search()).statusCode).toBe(200);
    expect((await search()).statusCode).toBe(429);
  });
});

describe('topics', () => {
  it('lets members post and keeps guests out', async () => {
    const s = await setup();
    const guest = await s.call('POST', '/api/forum/topics', undefined, { title: 't', categoryId: 'c-ai', content: 'c' });
    expect(guest.statusCode).toBe(401);
    expect(guest.json()).toMatchObject({ error: 'signin_required', message: '登录后才能操作' });

    const { topicId, postId, changes } = await newTopic(s, 'bob', { title: '  第一个新话题  ', tags: ['tag-agents', 'Rust', '机试心得', 'rust ', 'tag-agents'] });
    expect([topicId, postId]).toEqual(['t1001', 'p10001']);
    const topic = changes.topics.find((t: { id: string }) => t.id === 't1001');
    expect(topic).toMatchObject({ slug: 'topic-1001', title: '第一个新话题', categoryId: 'c-ai', authorId: 'm102', views: 0, pinned: false, closed: false, tagIds: ['tag-agents', 'tag-1', 'tag-2'] });
    // 回答里带上话题用到的标签（新建的两个排在精选的后面）。
    expect(changes.tags.map((t: { id: string }) => t.id)).toEqual(['tag-agents', 'tag-1', 'tag-2']);
    expect(changes.tags.slice(1)).toEqual([
      { id: 'tag-1', slug: 'rust', name: 'Rust', color: '#e5484d' },
      { id: 'tag-2', slug: 'tag-2', name: '机试心得', color: '#f76b15' },
    ]);
    expect(changes.posts.find((p: { id: string }) => p.id === 'p10001')).toMatchObject({ topicId: 't1001', authorId: 'm102', content: '正文', likeUserIds: [] });
    // 同名标签（中文按名字、英文按 slug）不会重复建。
    const again = await newTopic(s, 'bob', { tags: ['机试心得', 'RUST'] });
    expect(again.changes.topics.find((t: { id: string }) => t.id === again.topicId).tagIds).toEqual(['tag-2', 'tag-1']);
    expect((await s.state()).counters).toMatchObject({ topic: 1002, post: 10002, tag: 2 });
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

  it('also limits a level.member to 20 topics an hour (SPEC §3.8 meta.limit.forum.topic.hourly), independent of the per-minute flood guard', async () => {
    const s = await setup();
    s.as('bob');
    const bobId = accountIdOf(s.app, 'bob');
    grantPermGroup(s.app, bobId, 'level.member');
    // 垫 19 次（不占每分钟 10 次的额度），第 20 次真的发出去，第 21 次按小时上限拦下。
    for (let i = 0; i < 19; i += 1) s.app.services.limits.hit({ bucket: 'forum.topic.hourly', subject: bobId, window: { ms: 3600_000 }, max: 20 });
    await newTopic(s);
    const blocked = await s.call('POST', '/api/forum/topics', 'bob', { title: '超额的第 21 个', categoryId: 'c-ai', content: '正文' });
    expect(blocked.statusCode).toBe(429);
    expect(blocked.json()).toMatchObject({ error: 'rate_limited', bucket: 'forum.topic.hourly' });
  });

  it('pins and closes only with the forum capability, and audits without any post text', async () => {
    const s = await setup();
    expect((await s.call('POST', '/api/forum/topics/t9/pin', undefined, { pinned: true })).statusCode).toBe(401);
    const denied = await s.call('POST', '/api/forum/topics/t9/pin', 'bob', { pinned: true });
    expect(denied.statusCode).toBe(403);
    expect(denied.json()).toMatchObject({ error: 'forbidden', message: '需要「置顶话题」权限' });
    // #274：部门的版务权限不分部员/部长，项目部的 dave 和社区部的 carol 都能置顶、也都能关闭（SPEC §3.4）。
    const pinned = await s.call('POST', '/api/forum/topics/t9/pin', 'dave', { pinned: true });
    expect(pinned.statusCode).toBe(200);
    expect(pinned.json().changes.topics.find((t: { id: string }) => t.id === 't9').pinned).toBe(true);
    expect((await s.call('POST', '/api/forum/topics/t9/close', 'dave', { closed: true })).json().changes.topics.find((t: { id: string }) => t.id === 't9').closed).toBe(true);
    expect((await s.call('POST', '/api/forum/topics/t9/close', 'carol', { closed: true })).json().changes.topics.find((t: { id: string }) => t.id === 't9').closed).toBe(true);
    expect((await s.call('POST', '/api/forum/topics/t404/close', 'carol', { closed: true })).statusCode).toBe(404);
    expect((await s.call('POST', '/api/forum/topics/t9/close', 'carol', { closed: 'yes' })).statusCode).toBe(400);
    expect(s.audits()).toEqual([
      { account_id: accountIdOf(s.app, 'dave'), action: 'forum.topic.pin', target: 't9', meta: { pinned: true } },
      { account_id: accountIdOf(s.app, 'dave'), action: 'forum.topic.close', target: 't9', meta: { closed: true } },
      { account_id: accountIdOf(s.app, 'carol'), action: 'forum.topic.close', target: 't9', meta: { closed: true } },
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

  it('attributes a signed-in view to the account, not the visitor (#274 残留修复 G)', async () => {
    const s = await setup();
    const response = await s.call('POST', '/api/forum/topics/t9/view', 'bob');
    expect(response.statusCode).toBe(204);
    const bobId = accountIdOf(s.app, 'bob');
    const rows = s.db.prepare(
      "SELECT account_id, visitor_id FROM activity_events WHERE action = 'forum.topic.view' AND target_id = 't9'",
    ).all() as { account_id: string | null; visitor_id: string | null }[];
    expect(rows).toHaveLength(1);
    expect(rows[0]).toEqual({ account_id: bobId, visitor_id: null });
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

  it('also limits a level.member to 60 replies an hour (SPEC §3.8 meta.limit.forum.reply.hourly), independent of the per-minute flood guard', async () => {
    const s = await setup();
    s.as('bob');
    const bobId = accountIdOf(s.app, 'bob');
    grantPermGroup(s.app, bobId, 'level.member');
    for (let i = 0; i < 59; i += 1) s.app.services.limits.hit({ bucket: 'forum.reply.hourly', subject: bobId, window: { ms: 3600_000 }, max: 60 });
    expect((await s.call('POST', '/api/forum/posts', 'bob', { topicId: 't9', content: '第 60 条' })).statusCode).toBe(201);
    const blocked = await s.call('POST', '/api/forum/posts', 'bob', { topicId: 't9', content: '超额的第 61 条' });
    expect(blocked.statusCode).toBe(429);
    expect(blocked.json()).toMatchObject({ error: 'rate_limited', bucket: 'forum.reply.hourly' });
  });

  it('caps all accounts on one IP combined to 200 replies an hour (SPEC §3.8), on top of each account\'s own hourly cap', async () => {
    const s = await setup();
    const address = '198.51.100.90';
    const ipKey = createHash('sha256').update(ipSubject(address)).digest('hex');
    for (let i = 0; i < 199; i += 1) s.app.services.limits.hit({ bucket: 'forum.reply.ip.hourly', subject: ipKey, window: { ms: 3600_000 }, max: 200 });
    const post = (who: string) => s.app.inject({ method: 'POST', url: '/api/forum/posts', remoteAddress: address, headers: s.as(who), payload: { topicId: 't9', content: `${who} 的回复` } });
    expect((await post('bob')).statusCode).toBe(201);
    // 换另一个账号，同一个 IP ：这条上限按 IP 算所有账号加起来，不按单个账号。
    const blocked = await post('carol');
    expect(blocked.statusCode).toBe(429);
    expect(blocked.json()).toMatchObject({ error: 'rate_limited', bucket: 'forum.reply.ip.hourly' });
  });

  it('stores member nicknames in their NFKC form, and ignores separators when comparing them', async () => {
    const s = await setup();
    await s.state('carol');
    const rename = (displayName: string, who = 'bob') => s.call('PATCH', '/api/forum/me/profile', who, { displayName });
    // 点号分隔、大小写都不算区别：和 carol 的用户名撞上。
    expect((await rename('c.a.r.o.l')).json().error).toBe('display_name_taken');
    // 中间点 · 是允许清单里的分隔符，不撞车就能用。
    expect((await rename('阿·凡提', 'carol')).statusCode).toBe(200);
    // 长度按 NFKC 展开之后的写法算：㍿ 在 NFKC 之后是「株式会社」四个字。
    expect((await rename('㍿'.repeat(8))).json()).toMatchObject({ error: 'invalid_display_name', message: '昵称要 1 到 30 个字' });
  });

  it('treats lookalike letters as the same when comparing member nicknames', async () => {
    const s = await setup();
    await s.state('alice');
    // alıce：无点的 ı（dotless i）看起来和 alice 一样。
    expect((await s.call('PATCH', '/api/forum/me/profile', 'carol', { displayName: 'alıce' })).json().error).toBe('display_name_taken');
  });

  it('keeps members from renaming to the login of an org member who never opened the forum', async () => {
    const s = await setup();
    // owner1 登录过（审计里有 auth.signin）但没打开过论坛：#274 item I，auth.signin 改记在 activity_events
    // （account_id，不是自由文本的 actor），lib/auth.ts 的 signedInLogins() 按 account_id 解登录名——真的
    // 建一个账号再补一条 auth.signin，然后结束它的会话，模拟「登录过，但现在没有当前会话」。
    const ownerSid = signIn(s.app, 'owner1', 9108);
    const ownerAccountId = s.app.services.auth.getSession(ownerSid)!.account_id;
    s.app.services.storage.db.prepare(
      "INSERT INTO activity_events(at, account_id, surface, action, outcome, meta) VALUES (?, ?, 'portal', 'auth.signin', 'ok', '{}')",
    ).run(Date.now(), ownerAccountId);
    s.app.services.auth.destroySession(ownerSid);

    const rename = (displayName: string, who: string) => s.call('PATCH', '/api/forum/me/profile', who, { displayName });
    expect((await rename('erin', 'bob')).json().error).toBe('display_name_taken');
    expect((await rename('owner1', 'bob')).json().error).toBe('display_name_taken');
    // 自己的登录名只按原样（不分大小写）豁免：da-ve 不能用有称号的 dave 的登录名，改回 Da-Ve、da-ve 可以。
    expect((await rename('dave', 'da-ve')).json().error).toBe('display_name_taken');
    expect((await rename('Da-Ve', 'da-ve')).statusCode).toBe(200);
    expect((await rename('da-ve', 'da-ve')).statusCode).toBe(200);
    // 只和自己的登录名撞上的写法也可以：bob 用 B.o.b。
    expect((await rename('B.o.b', 'bob')).statusCode).toBe(200);
    expect((await rename('DAVE', 'dave')).statusCode).toBe(200);
  });

  it('notifies at most 10 people mentioned in one post, in the order they appear', async () => {
    const s = await setup();
    const handles = Array.from({ length: 12 }, (_, i) => `member${String(i + 1).padStart(2, '0')}`);
    handles.forEach((login, i) => {
      signIn(s.app, login, 500 + i);
      const accountId = accountIdOf(s.app, login);
      expect(s.app.services.profiles.update(accountId, { username: login }).ok).toBe(true);
      s.app.services.forum.ensureMember({ accountId, githubUserId: 500 + i, login, avatarUrl: null, role: 'member', title: null, department: null, titles: [] });
    });
    const { postId } = await newTopic(s, 'bob', { content: handles.map(handle => `@${handle}`).join(' ') });
    const mentioned = s.db.prepare("SELECT recipient_id FROM forum_notifications WHERE type = 'mention' AND post_id = ? ORDER BY rowid").all(postId) as { recipient_id: string }[];
    expect(mentioned.map(row => row.recipient_id)).toEqual(Array.from({ length: 10 }, (_, i) => `m${500 + i}`));
  });

  it('lets only moderators reply in a closed topic', async () => {
    const s = await setup();
    await s.call('POST', '/api/forum/topics/t9/close', 'carol', { closed: true });
    const member = await s.call('POST', '/api/forum/posts', 'bob', { topicId: 't9', content: '还能回吗' });
    expect(member.statusCode).toBe(403);
    expect(member.json()).toMatchObject({ error: 'forbidden', message: '话题已关闭\uFF0C不能回复' });
    // #274：dave 所在的项目部一样拿到 forum.moderate.edit（统一授权，不分部员/部长），关闭的话题里也能回。
    expect((await s.call('POST', '/api/forum/posts', 'dave', { topicId: 't9', content: '队长也能说' })).statusCode).toBe(201);
    expect((await s.call('POST', '/api/forum/posts', 'carol', { topicId: 't9', content: '版务说明' })).statusCode).toBe(201);
    expect((await s.call('POST', '/api/forum/posts', 'alice', { topicId: 't9', content: '提督补充' })).statusCode).toBe(201);
  });

  it('rejects cross-origin writes before touching the forum', async () => {
    const s = await setup();
    const response = await s.app.inject({ method: 'POST', url: '/api/forum/posts', payload: { topicId: 't9', content: 'x' }, headers: { origin: 'https://evil.example' } });
    expect(response.statusCode).toBe(403);
    expect(response.json().error).toBe('invalid_origin');
    expect((await s.state()).posts).toHaveLength(2);
  });
});

/**
 * #274 残留修复：访客 × 注册用户 × 成员，三档身份各试一遍话题、回复、点赞，确认允许/拒绝都对（SPEC §3.2/§3.11）。
 * 访客没有会话，三件事一律 401；注册用户（frank，没有邀请码、没有 forum.topic.create/forum.reply.create/forum.react）
 * 一律 403，403 在限额判断之前就拦住；成员（bob，level.member）三件事都允许。
 */
describe('write gate by permission node: visitor × registered × member (#274 SPEC §3.2/§3.11)', () => {
  it('topic create: 401 for a visitor, 403 for a registered account, 201 for a member', async () => {
    const s = await setup();
    expect((await s.call('POST', '/api/forum/topics', undefined, { title: '访客发帖', categoryId: 'c-ai', content: '正文' })).statusCode).toBe(401);
    const registered = await s.call('POST', '/api/forum/topics', 'frank', { title: '注册用户发帖', categoryId: 'c-ai', content: '正文' });
    expect(registered.statusCode).toBe(403);
    expect(registered.json().error).toBe('forbidden');
    const member = await s.call('POST', '/api/forum/topics', 'bob', { title: '成员发帖', categoryId: 'c-ai', content: '正文' });
    expect(member.statusCode).toBe(201);
  });

  it('reply: 401 for a visitor, 403 for a registered account, 201 for a member', async () => {
    const s = await setup();
    expect((await s.call('POST', '/api/forum/posts', undefined, { topicId: 't9', content: '访客回复' })).statusCode).toBe(401);
    const registered = await s.call('POST', '/api/forum/posts', 'frank', { topicId: 't9', content: '注册用户回复' });
    expect(registered.statusCode).toBe(403);
    expect(registered.json().error).toBe('forbidden');
    const member = await s.call('POST', '/api/forum/posts', 'bob', { topicId: 't9', content: '成员回复' });
    expect(member.statusCode).toBe(201);
  });

  it('like: 401 for a visitor, 403 for a registered account, 200 for a member', async () => {
    const s = await setup();
    expect((await s.call('POST', '/api/forum/posts/body-9/like', undefined)).statusCode).toBe(401);
    const registered = await s.call('POST', '/api/forum/posts/body-9/like', 'frank');
    expect(registered.statusCode).toBe(403);
    expect(registered.json().error).toBe('forbidden');
    expect((await s.call('POST', '/api/forum/posts/body-9/like', 'bob')).statusCode).toBe(200);
  });
});

describe('editing and deleting', () => {
  it('lets authors edit and soft-delete their own posts, and moderators anyone’s with an audit entry', async () => {
    const s = await setup();
    const { topicId, postId: first } = await newTopic(s, 'bob');
    const reply = (await s.call('POST', '/api/forum/posts', 'bob', { topicId, content: '第一版' })).json().postId;
    const daves = (await s.call('POST', '/api/forum/posts', 'dave', { topicId, content: '别人的话' })).json().postId;

    const edited = await s.call('PATCH', `/api/forum/posts/${reply}`, 'bob', { content: '第二版' });
    expect(edited.statusCode).toBe(200);
    expect(edited.json().changes.posts.find((p: { id: string }) => p.id === reply)).toMatchObject({ content: '第二版', editedAt: expect.any(Number) });
    // erin 没有任何部门的版务权限（只是往届成员/alumni），改不了别人的帖子。
    const other = await s.call('PATCH', `/api/forum/posts/${reply}`, 'erin', { content: '改别人的' });
    expect(other.statusCode).toBe(403);
    expect(other.json()).toMatchObject({ error: 'forbidden', message: '只能编辑自己的帖子' });
    expect((await s.call('DELETE', `/api/forum/posts/${reply}`, 'erin')).statusCode).toBe(403);
    expect((await s.call('PATCH', `/api/forum/posts/${reply}`, 'bob', { content: '  ' })).json().error).toBe('empty_content');

    // 社区部舰员改、删别人（dave）的帖子：写审计，不记正文。
    expect((await s.call('PATCH', `/api/forum/posts/${daves}`, 'carol', { content: '（已由版务整理）' })).statusCode).toBe(200);
    const removed = await s.call('DELETE', `/api/forum/posts/${daves}`, 'carol');
    expect(removed.json().changes.posts.find((p: { id: string }) => p.id === daves)).toMatchObject({ deleted: true, content: '' });
    // s.audits() 是 forum.% 全量（这次用例里还有建话题、发回复两条合法的 forum.topic.create/forum.reply.create，
    // 以前只查 audit_logs 看不到，现在统一读 activity_events 就都在了），这里只看版务改/删别人帖这两条要钉住的。
    expect(s.audits().filter(row => row.action.startsWith('forum.post.'))).toEqual([
      { account_id: accountIdOf(s.app, 'carol'), action: 'forum.post.edit', target: daves, meta: { topic_id: topicId, author_id: 'm104' } },
      { account_id: accountIdOf(s.app, 'carol'), action: 'forum.post.delete', target: daves, meta: { topic_id: topicId, author_id: 'm104' } },
    ]);

    // 自己删自己的不审计；再删一次原样返回；删掉的不能再改、不能点赞。
    const own = await s.call('DELETE', `/api/forum/posts/${reply}`, 'bob');
    expect(own.json().changes.posts.find((p: { id: string }) => p.id === reply)).toMatchObject({ deleted: true, content: '' });
    expect((await s.call('DELETE', `/api/forum/posts/${reply}`, 'bob')).statusCode).toBe(200);
    expect((await s.call('PATCH', `/api/forum/posts/${reply}`, 'bob', { content: '复活' })).json()).toMatchObject({ error: 'post_deleted' });
    expect((await s.call('POST', `/api/forum/posts/${reply}/like`, 'carol')).statusCode).toBe(409);
    expect(s.audits().filter(row => row.action.startsWith('forum.post.'))).toHaveLength(2);

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
    expect((await like()).json().changes.posts.find((p: { id: string }) => p.id === postId).likeUserIds).toEqual(['m103']);
    expect((await like()).json().changes.posts.find((p: { id: string }) => p.id === postId).likeUserIds).toEqual([]);
    await like();
    await s.call('POST', `/api/forum/posts/${postId}/like`, 'bob');
    expect((await s.state('bob')).notifications.map((n: { type: string; actorId: string }) => `${n.type}:${n.actorId}`)).toEqual(['like:m103']);
    expect((await s.call('POST', '/api/forum/posts/p99999/like', 'bob')).statusCode).toBe(404);
  });

  it('stores a like: a fresh read shows it to everyone, on a new topic and on an imported first post (#143)', async () => {
    const s = await setup();
    await s.state('bob');
    const { postId } = await newTopic(s, 'bob');
    const likesOf = (state: { posts: { id: string; likeUserIds: string[] }[] }, id: string) => state.posts.find(p => p.id === id)?.likeUserIds;
    // 话题的第一帖（新话题的 postId、公开旧帖 t9 的 body-9）都能赞；赞过的在之后任何人重新读的状态里都在，不只在这次的返回里。
    expect((await s.call('POST', `/api/forum/posts/${postId}/like`, 'carol')).statusCode).toBe(200);
    expect((await s.call('POST', '/api/forum/posts/body-9/like', 'carol')).statusCode).toBe(200);
    for (const viewer of ['carol', 'bob', undefined]) {
      const state = await s.state(viewer);
      expect(likesOf(state, postId)).toEqual(['m103']);
      expect(likesOf(state, 'body-9')).toEqual(['m103']);
    }
    expect(s.db.prepare('SELECT post_id, user_id FROM forum_likes ORDER BY post_id').all()).toEqual([
      { post_id: 'body-9', user_id: 'm103' }, { post_id: postId, user_id: 'm103' },
    ]);
    // 取消也写进库：重新读就没有了。
    await s.call('POST', '/api/forum/posts/body-9/like', 'carol');
    expect(likesOf(await s.state(), 'body-9')).toEqual([]);
    expect(likesOf(await s.state(), postId)).toEqual(['m103']);
  });

  it('keeps bookmarks and notifications private to their owner', async () => {
    const s = await setup();
    await s.state('bob');
    const { topicId, postId } = await newTopic(s, 'bob');
    await s.call('POST', '/api/forum/posts', 'carol', { topicId, content: '回复' });
    const saved = await s.call('POST', `/api/forum/posts/${postId}/bookmark`, 'carol');
    expect(saved.json().changes.bookmarks).toEqual([{ userId: 'm103', postId, createdAt: expect.any(Number) }]);
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
    expect((await s.call('POST', `/api/forum/notifications/${notification.id}/read`, 'bob')).json().changes.notifications).toEqual([{ ...notification, read: true }]);
    expect((await s.call('POST', '/api/forum/notifications/n999/read', 'bob')).statusCode).toBe(404);
    await s.call('POST', `/api/forum/posts/${postId}/like`, 'carol');
    const all = await s.call('POST', '/api/forum/notifications/read-all', 'bob');
    // 全部已读只回这次从未读变成已读的那条点赞通知，刚才单独标过的回复通知不在里面。
    expect(all.json().changes.notifications.map((n: { type: string; recipientId: string; read: boolean }) => `${n.type}:${n.recipientId}:${n.read}`)).toEqual(['like:m102:true']);
    expect((await s.call('POST', '/api/forum/notifications/read-all')).statusCode).toBe(401);
    // 取消收藏。
    const unsaved = (await s.call('POST', `/api/forum/posts/${postId}/bookmark`, 'carol')).json().changes;
    expect(unsaved).toEqual({ users: [expect.objectContaining({ id: 'm103' })], removed: { bookmarks: [{ userId: 'm103', postId }] } });
  });

  it('toggles follows, refuses self-follows and notifies once', async () => {
    const s = await setup();
    await s.state('bob');
    const follow = (target: string, who = 'carol') => s.call('POST', `/api/forum/users/${target}/follow`, who);
    expect((await follow('m102')).json().changes.follows).toEqual([{ followerId: 'm103', followeeId: 'm102', createdAt: expect.any(Number) }]);
    expect((await follow('m102')).json().changes).toMatchObject({ removed: { follows: [{ followerId: 'm103', followeeId: 'm102' }] } });
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

/**
 * 团队负责人 #276 发现的 bug：reactionsByPost(viewerId) 原来拿论坛用户 id 去比 forum_reactions.account_id
 * （核心账号 id），两种 id 格式不同，永远比不上，mine 原来恒为 false——这里按「加的人自己看 mine=true，
 * 别人和游客看 mine=false」在 /state、话题正文、PUT/DELETE 的回答三处分别核对，口径必须一致。
 */
describe('reactions (#276 CONTRACT §4): mine 按看的人是不是也回应过，不是恒为 false', () => {
  it('bob 加一个表情：bob 自己看 mine=true，carol 和游客看 mine=false，/state、GET 话题正文、PUT/DELETE 回答三处口径一致', async () => {
    const s = await setup();
    const url = '/api/forum/posts/body-9/reactions/yugc-wave';
    const added = await s.call('PUT', url, 'bob');
    expect(added.statusCode).toBe(200);
    const reactionShape = (mine: boolean) => [{ stickerId: 'yugc-wave', shortcode: 'yugc-wave', url: expect.stringContaining('/api/forum/stickers/'), count: 1, mine }];
    expect(added.json().reactions).toEqual(reactionShape(true));

    const reactionsOf = (posts: { id: string; reactions: unknown }[]) => posts.find(p => p.id === 'body-9')!.reactions;
    expect(reactionsOf((await s.state('bob')).posts)).toEqual(reactionShape(true));
    expect(reactionsOf((await s.state('carol')).posts)).toEqual(reactionShape(false));
    expect(reactionsOf((await s.state()).posts)).toEqual(reactionShape(false));

    const topicPosts = async (who?: string) => (await s.call('GET', '/api/forum/topics/t9/posts', who)).json().posts;
    expect(reactionsOf(await topicPosts('bob'))).toEqual(reactionShape(true));
    expect(reactionsOf(await topicPosts('carol'))).toEqual(reactionShape(false));
    expect(reactionsOf(await topicPosts())).toEqual(reactionShape(false));

    const removed = await s.call('DELETE', url, 'bob');
    expect(removed.statusCode).toBe(200);
    expect(removed.json().reactions).toEqual([]);

    // #274：加和取消表情都要记一条 forum.react，不然控制台的操作记录看不到这件事（之前这两个接口漏了）。
    const reactionAudits = s.audits().filter(row => row.action === 'forum.react');
    expect(reactionAudits).toEqual([
      { account_id: expect.any(String), action: 'forum.react', target: 'body-9', meta: { sticker_id: 'yugc-wave' } },
      { account_id: expect.any(String), action: 'forum.react', target: 'body-9', meta: { sticker_id: 'yugc-wave', removed: true } },
    ]);
  });
});

describe('write responses (#145)', () => {
  const byId = <T extends { id: string } & Record<string, unknown>>(list: T[], id: string): T => {
    const found = list.find(item => item.id === id);
    if (!found) throw new Error(`Missing expected record: ${id}`);
    return found;
  };
  /** `/state` 里的帖子带摘要（#156），写回答里不带：比对时先把摘要拆掉。 */
  const withoutExcerpt = ({ excerpt: _excerpt, ...rest }: Record<string, unknown>): Record<string, unknown> => rest;

  it('answers each write with only the records it changed, each identical to the one in /state', async () => {
    const s = await setup();
    await s.state('carol');
    const { topicId, postId, changes: created } = await newTopic(s, 'bob', { tags: ['tag-agents', '新标签'] });
    const full = await s.state('bob');
    expect(Object.keys(created).sort()).toEqual(['posts', 'tags', 'topics', 'users']);
    expect(created.topics).toEqual([byId(full.topics, topicId)]);
    expect(created.tags).toEqual(full.tags.filter((t: { id: string }) => ['tag-agents', 'tag-1'].includes(t.id)));
    expect(created.users).toEqual([byId(full.users, 'm102')]);
    // 发帖是改正文的写入：回答里带正文（前端要把新正文显示出来）。/state 里同一条是摘要，其余字段逐项相同。
    expect(created.posts).toEqual([{ ...withoutExcerpt(byId(full.posts, postId)), content: '正文' }]);
    expect(Object.keys(byId(full.posts, postId))).not.toContain('content');
    expect(byId(full.posts, postId).excerpt).toBe('正文');

    const reply = await s.call('POST', '/api/forum/posts', 'carol', { topicId, content: '回复 @bob' });
    expect(reply.statusCode).toBe(201);
    const { changes, viewer, postId: replyId } = reply.json();
    const carol = await s.state('carol');
    expect(changes).toEqual({
      users: [byId(carol.users, 'm103')], topics: [byId(carol.topics, topicId)],
      posts: [{ ...withoutExcerpt(byId(carol.posts, replyId)), content: '回复 @bob' }],
    });
    expect(viewer).toEqual(carol.viewer);
    // 话题的最后活动时间跟着回复走：并进前端的那条话题已经是新的。
    expect(changes.topics[0].lastActivityAt).toBe(changes.posts[0].createdAt);

    // 点赞不改正文：回答里带的是 /state 里同一条（摘要，带正文的 200 字以内），长帖也只回这一条短记录。
    const liked = (await s.call('POST', `/api/forum/posts/${postId}/like`, 'carol')).json();
    expect(liked.changes).toEqual({ users: [byId(carol.users, 'm103')], posts: [{ ...byId(carol.posts, postId), likeUserIds: ['m103'] }] });
    expect(JSON.stringify(liked.changes.posts[0])).not.toContain('content');
    expect(liked.changes.posts[0].excerpt).toBe('正文');
    expect(JSON.stringify(liked).length).toBeLessThan(1500);
  });

  it('never carries anything the viewer could not read from /state', async () => {
    const s = await setup();
    await s.state('bob');
    await s.call('PATCH', '/api/forum/me/profile', 'carol', { notifyPrefs: { like: false } });
    const { topicId, postId } = await newTopic(s, 'bob');
    await s.call('POST', `/api/forum/posts/${postId}/bookmark`, 'bob');

    // carol 的回复给 bob 发了通知，她的回答里没有；她自己的用户记录带着她真实的通知设置。
    const reply = (await s.call('POST', '/api/forum/posts', 'carol', { topicId, content: '回复' })).json();
    expect(reply.changes.notifications).toBeUndefined();
    expect(reply.changes.users).toEqual([expect.objectContaining({ id: 'm103', notifyPrefs: { reply: true, like: false, follow: true } })]);

    // 拼回答的那一层自己也挡：别人的通知、别人的书签、别人的通知设置都拿不到。
    const bobNotification = (await s.state('bob')).notifications[0].id;
    const forum = s.app.services.forum;
    expect(forum.changes('m103', { notifications: [bobNotification], bookmarks: [postId] })).toEqual({ removed: { bookmarks: [{ userId: 'm103', postId }] } });
    expect(forum.changes(null, { notifications: [bobNotification], bookmarks: [postId] })).toEqual({});
    expect(forum.changes('m102', { notifications: [bobNotification], bookmarks: [postId] })).toMatchObject({
      notifications: [{ id: bobNotification, recipientId: 'm102' }], bookmarks: [{ userId: 'm102', postId }],
    });
    expect(forum.changes('m102', { users: ['m103'] }).users![0].notifyPrefs).toEqual({ reply: true, like: true, follow: true });
    expect(forum.changes('m103', { users: ['m103'] }).users![0].notifyPrefs).toEqual({ reply: true, like: false, follow: true });
    // 删掉的帖子在回答（full）里正文清空；不存在的 id 直接跳过。
    const removed = await s.call('DELETE', `/api/forum/posts/${reply.postId}`, 'carol');
    expect(removed.json().changes.posts).toEqual([expect.objectContaining({ id: reply.postId, content: '', deleted: true })]);
    expect(forum.changes(null, { posts: [reply.postId, 'p99999'], topics: ['t404'], users: ['m999'], tags: ['tag-404'] })).toEqual({
      posts: [expect.objectContaining({ id: reply.postId, deleted: true })],
    });
  });

  it('answers a write that does not touch a body with that post\'s excerpt, not its body (#156)', async () => {
    const s = await setup();
    // 一条很长的帖子：它只要回到点赞的回答里，回答就大了。
    const long = '很长的一帖。'.repeat(3000);
    const { topicId, postId } = await newTopic(s, 'bob', { content: long });
    await s.state('carol');

    const liked = (await s.call('POST', `/api/forum/posts/${postId}/like`, 'carol')).json();
    // 回答里只有这条帖子与点讆人自己的记录；帖子这一条带的是摘要（201 字），不是 1.8 万字的正文。
    expect(liked.changes).toEqual({ users: [expect.objectContaining({ id: 'm103' })], posts: [byId((await s.state('carol')).posts, postId)] });
    expect(JSON.stringify(liked.changes.posts).length).toBeLessThan(600);
    expect(liked.changes.posts[0]).not.toHaveProperty('content');
    expect(liked.changes.posts[0].excerpt).toHaveLength(201);
    // 书签、置顶、改资料这些也不带正文。
    const bookmarked = (await s.call('POST', `/api/forum/posts/${postId}/bookmark`, 'carol')).json();
    expect(JSON.stringify(bookmarked)).not.toContain(long.slice(0, 60));
    for (const answer of [
      (await s.call('POST', `/api/forum/topics/${topicId}/pin`, 'alice', { pinned: true })).json(),
      (await s.call('PATCH', '/api/forum/me/profile', 'carol', { bio: '签名' })).json(),
    ]) expect(JSON.stringify(answer)).not.toContain(long.slice(0, 60));
    // 改正文的写入照样带正文：前端要把新正文显示出来。
    const reply = (await s.call('POST', '/api/forum/posts', 'carol', { topicId, content: '新回复' })).json();
    expect(reply.changes.posts[0].content).toBe('新回复');
    expect((await s.call('PATCH', `/api/forum/posts/${postId}`, 'bob', { content: '改过的长帖' })).json().changes.posts[0].content).toBe('改过的长帖');
  });
});

/**
 * 论坛前端的 `parseWriteResult`，从副本导入：在原处导入时 vite 会读 app/forum/tsconfig.json，它引用的
 * .nuxt/ 只有装过论坛依赖才有，CI 的 core job 没有。副本只有它和它导入的 app/data/types.ts、
 * shared/sticker-url.ts（#286），目录结构不变，代码就是论坛里的那份；放在仓库里被忽略的 .tools/ 下，
 * 因为 vite 只加载项目目录里的文件，而那里往上没有 tsconfig.json。
 */
async function forumWriteParser(): Promise<typeof import('../../app/forum/shared/forum-api').parseWriteResult> {
  mkdirSync(join(REPO_ROOT, '.tools'), { recursive: true });
  const dir = mkdtempSync(join(REPO_ROOT, '.tools', 'forum-api-'));
  dirs.push(dir);
  for (const file of ['shared/forum-api.ts', 'shared/sticker-url.ts', 'app/data/types.ts']) {
    mkdirSync(dirname(join(dir, file)), { recursive: true });
    cpSync(join(REPO_ROOT, 'app/forum', file), join(dir, file));
  }
  const module = await import(pathToFileURL(join(dir, 'shared/forum-api.ts')).href) as typeof import('../../app/forum/shared/forum-api');
  return module.parseWriteResult;
}

describe('write responses read by the forum client (#145)', () => {
  // 论坛前端只收 parseWriteResult 认得的形状，认不得的字段直接丢掉；这里把真实回答原样喂给它，
  // 服务端改了字段名（比如 removed.bookmarks 写成 removed.bookmark）而前端没跟上时，这条会失败。
  it('reads every kind of write answer exactly as the server sent it', async () => {
    const parseWriteResult = await forumWriteParser();
    const s = await setup();
    await s.state('bob');
    await s.state('carol');
    const answers: { name: string; body: any }[] = [];
    const run = async (name: string, method: 'POST' | 'PATCH' | 'DELETE', url: string, who?: string, payload?: object) => {
      const response = await s.call(method, url, who, payload);
      expect(response.statusCode, name).toBeLessThan(300);
      answers.push({ name, body: response.json() });
      return response.json();
    };
    const { topicId, postId } = await run('topic', 'POST', '/api/forum/topics', 'bob', { title: '新话题', categoryId: 'c-ai', tags: ['tag-agents', '新标签'], content: '正文' });
    const reply = await run('reply', 'POST', '/api/forum/posts', 'carol', { topicId, content: '回复 @bob', replyToPostId: postId });
    await run('like', 'POST', `/api/forum/posts/${postId}/like`, 'carol');
    await run('bookmark', 'POST', `/api/forum/posts/${postId}/bookmark`, 'carol');
    await run('remove the bookmark', 'POST', `/api/forum/posts/${postId}/bookmark`, 'carol');
    await run('follow', 'POST', '/api/forum/users/m102/follow', 'carol');
    await run('unfollow', 'POST', '/api/forum/users/m102/follow', 'carol');
    await run('edit', 'PATCH', `/api/forum/posts/${reply.postId}`, 'carol', { content: '改过的回复' });
    await run('delete', 'DELETE', `/api/forum/posts/${reply.postId}`, 'carol');
    await run('pin', 'POST', `/api/forum/topics/${topicId}/pin`, 'carol', { pinned: true });
    await run('close', 'POST', `/api/forum/topics/${topicId}/close`, 'carol', { closed: true });
    const [notification] = (await s.state('bob')).notifications;
    await run('mark one read', 'POST', `/api/forum/notifications/${notification.id}/read`, 'bob');
    await run('mark all read', 'POST', '/api/forum/notifications/read-all', 'bob');
    await run('profile', 'PATCH', '/api/forum/me/profile', 'carol', { bio: '在学 Go', notifyPrefs: { like: false } });

    for (const { name, body } of answers) {
      const parsed = parseWriteResult(body);
      expect({ changes: parsed.changes, viewer: parsed.viewer }, name)
        .toEqual({ changes: body.changes, viewer: body.viewer });
      // 成员的每个回答都带着自己的用户记录，前端的测试夹具照这个写（app/forum/tests/fixtures/server-state.ts 的 writeBody）。
      if (body.viewer.userId !== null) expect(body.changes.users.map((user: { id: string }) => user.id), name).toContain(body.viewer.userId);
    }
    // 上面这些写入把每一类记录和两种 removed 都走到了。
    expect([...new Set(answers.flatMap(({ body }) => Object.keys(body.changes)))].sort())
      .toEqual(['bookmarks', 'follows', 'notifications', 'posts', 'removed', 'tags', 'topics', 'users']);
    expect([...new Set(answers.flatMap(({ body }) => Object.keys(body.changes.removed ?? {})))].sort()).toEqual(['bookmarks', 'follows']);
  });
});

describe('profile', () => {
  it('edits nickname, signature, location, website and notification settings within limits', async () => {
    const s = await setup();
    const patch = (body: object, who: string | null = 'bob') => s.call('PATCH', '/api/forum/me/profile', who ?? undefined, body);
    const ok = await patch({ displayName: '  博  ', bio: '第一行\n第二行', location: '武汉', website: 'https://bob.example.test/', notifyPrefs: { like: false } });
    expect(ok.statusCode).toBe(200);
    expect(ok.json().changes.users.find((u: { id: string }) => u.id === 'm102')).toMatchObject({
      displayName: '博', bio: '第一行\n第二行', location: '武汉', website: 'https://bob.example.test/', notifyPrefs: { reply: true, like: false, follow: true },
    });
    expect((await patch({ website: '' })).json().changes.users.find((u: { id: string }) => u.id === 'm102').website).toBe('');
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
    expect((await rename('小博')).json().changes.users).toEqual([expect.objectContaining({ id: 'm102', displayName: '小博' })]);
    expect((await s.state()).users.filter((u: { displayName: string }) => u.displayName === '小博')).toHaveLength(2);
  });

  it.each(['canonical', 'legacy'] as const)('keeps a stored %s nickname that breaks the current rules when other fields change, but still checks a new one', async source => {
    const s = await setup();
    await s.state('carol');
    await s.state('bob');
    const accountId = accountIdOf(s.app, 'bob');
    if (source === 'legacy') s.db.prepare('DELETE FROM account_profiles WHERE account_id = ?').run(accountId);
    // 合成规则变更前已存在的资料：有 canonical 时它才是昵称权威，缺档案时保留历史作者资料。
    const storedNickname = (name: string) => {
      s.db.prepare("UPDATE forum_users SET display_name = ? WHERE id = 'm102'").run(name);
      if (source === 'canonical') s.db.prepare('UPDATE account_profiles SET display_name = ? WHERE account_id = ?').run(name, accountId);
    };
    const patch = (body: object) => s.call('PATCH', '/api/forum/me/profile', 'bob', body);
    const bob = (response: { json(): { changes: { users: { id: string }[] } } }) => response.json().changes.users.find(u => u.id === 'm102');
    // 早先存下的昵称：带看不见的字符，或者和官方账号同名。
    for (const legacy of ['b\u200Bob', '极客班']) {
      storedNickname(legacy);
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
    // 存的是带首尾空格的「 bob 」：提交「bob」算没改，昵称不写回。
    storedNickname(' bob ');
    expect((await patch({ displayName: 'bob', bio: '又改了签名' })).statusCode).toBe(200);
    expect(s.db.prepare("SELECT display_name, bio FROM forum_users WHERE id = 'm102'").get()).toEqual({ display_name: ' bob ', bio: '又改了签名' });
    // 统一公开 DTO 去首尾空白，但不为只改签名重写存量昵称；没有 canonical 的历史资料保持原样。
    expect((await s.state()).users.find((u: { id: string }) => u.id === 'm102')).toMatchObject({ displayName: source === 'canonical' ? 'bob' : ' bob ', bio: '又改了签名' });
    if (source === 'canonical') expect(s.app.services.profiles.findMany([accountId]).get(accountId)?.display_name).toBe(' bob ');
    if (source === 'legacy') expect(s.app.services.profiles.findMany([accountId]).size).toBe(0);
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
    const avatarUrl: string = response.json().changes.users.find((u: { id: string }) => u.id === 'm102').avatarUrl;
    expect(avatarUrl).toMatch(/^\/api\/identity\/avatar\/[0-9a-f]{64}\.webp$/);
    const hash = /^\/api\/identity\/avatar\/([0-9a-f]{64})\.webp$/.exec(avatarUrl)![1];
    const served = await s.app.inject(avatarUrl);
    expect(served.statusCode).toBe(200);
    expect(served.headers['content-type']).toBe('image/webp');
    expect(served.headers['cache-control']).toBe('public, max-age=31536000, immutable');
    expect(served.headers['x-content-type-options']).toBe('nosniff');
    expect(createHash('sha256').update(served.rawPayload).digest('hex')).toBe(hash);
    const legacyUrl = `/api/forum/avatars/${hash}.webp`;
    const legacyServed = await s.app.inject(legacyUrl);
    expect(legacyServed.statusCode).toBe(200);
    expect(legacyServed.rawPayload).toEqual(served.rawPayload);
    expect(legacyServed.headers['content-type']).toBe('image/webp');
    expect(legacyServed.headers['cache-control']).toBe('public, max-age=31536000, immutable');
    expect(legacyServed.headers['x-content-type-options']).toBe('nosniff');
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
    expect(removed.json().changes.users.find((u: { id: string }) => u.id === 'm102').avatarUrl).toBe('https://avatars.githubusercontent.com/test/bob');
    const gone = await s.app.inject(avatarUrl);
    expect(gone.statusCode).toBe(404);
    expect(gone.headers['cache-control']).toBe('no-store');
    expect((await s.app.inject(legacyUrl)).statusCode).toBe(404);
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
    expect(state.posts.find((p: { id: string }) => p.id === 'body-73').excerpt).toBe('线上改过的首帖');
    expect(state.posts).toHaveLength(3);
    expect(state.counters).toMatchObject({ topic: 1000, post: 10001 });
    // 正文在话题页的接口里读（#156）：线上改过的首帖原样存着。
    expect(forum.topicPosts('t73')[0]).toMatchObject({ id: 'body-73', content: '线上改过的首帖' });

    // 以后导出的新帖：重新发版后只插入新的那一篇。
    const content = loadForumContent(FORUM_FIXTURE_DIR);
    const next = createForumStore(s.db, { ...content, topics: [...content.topics, { ...content.topics[1], id: 't5', slug: 'topic-5', title: '后来导出的旧帖', content: '正文' }] });
    expect(next.seed()).toBe(1);
    expect(next.seed()).toBe(0);
    expect((await s.state()).posts.map((p: { id: string }) => p.id)).toContain('body-5');
  });

  it('refreshes unedited legacy bodies on restart without overwriting manual edits (#304)', async () => {
    const s = await setup();
    await s.call('PATCH', '/api/forum/posts/body-9', 'alice', { content: '人工改过的旧帖，保留阿里原链接' });
    const content = loadForumContent(FORUM_FIXTURE_DIR);
    const topics = content.topics.map(topic => ({ ...topic, content: `${topic.content}\n\n![迁移](https://cdn.crosery.com/yzgc/static/site/forum/published/0123456789abcdef.webp)` }));
    const next = createForumStore(s.db, { ...content, topics });
    expect(next.seed()).toBe(0);
    expect(next.seed()).toBe(0);
    expect(s.db.prepare('SELECT content, edited_at FROM forum_posts WHERE id = ?').get('body-73')).toEqual({ content: topics.find(topic => topic.id === 't73')!.content, edited_at: null });
    expect(s.db.prepare('SELECT content FROM forum_posts WHERE id = ?').get('body-9')).toEqual({ content: '人工改过的旧帖，保留阿里原链接' });
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
    expect(content.categories.map(category => category.id)).toEqual(['c-exam', 'c-announcements', 'c-guides', 'c-courses', 'c-competitions', 'c-careers', 'c-ai']);
    expect(content.topics.length).toBeGreaterThan(0);
    expect(content.topics.every(topic => Number(topic.id.slice(1)) < 1000)).toBe(true);
    expect(content.author.id).toBe('u-geekclass');
    expect(content.guides.length).toBeGreaterThan(0);
    expect(content.guides.every(guide => guide.categoryId === 'c-guides' && /^t9\d\d$/.test(guide.id))).toBe(true);
    // 站点导航仍只写站内路径；#295 的截图只允许公开桶里带哈希的图片，不豁免其他绝对链接。
    for (const item of content.guides) {
      expect(item.content, item.id).not.toMatch(/\p{Extended_Pictographic}/u);
      expect(item.content, item.id).not.toMatch(/\*\*|__/);
      expect(item.content, item.id).not.toMatch(/[\w.+-]+@[\w-]+\.[a-z]{2,}/);
      const withoutCdnImages = item.content.replace(new RegExp(`!\\[([^\\]\\n]*)\\]\\(${STATIC_CDN_BASE.replace(/[.*+?^${}()|[\]\\/]/g, '\\$&')}forum/guides/[a-z0-9-]+\\.[A-Za-z0-9_-]{8}\\.(?:webp|png)\\)`, 'g'), '$1');
      expect(withoutCdnImages, item.id).not.toMatch(/yangtzeu\.work/);
    }
  });

  /** 夹具加上使用说明的分类、标签和 guides/ 目录（#281）。 */
  const guideFixture = (guides: Record<string, string>) => {
    const dir = mkdtempSync(join(tmpdir(), 'geek-forum-guides-'));
    dirs.push(dir);
    cpSync(FORUM_FIXTURE_DIR, dir, { recursive: true });
    const curationFile = join(dir, 'curation.json');
    const curation = JSON.parse(readFileSync(curationFile, 'utf8'));
    curation.categories.push({ id: 'c-guides', slug: 'guides', name: '使用说明', description: '', color: '#0d9488', icon: 'i-ri-book-read-line' });
    curation.tags.push({ id: 'tag-for-member', slug: 'for-member', name: '成员', color: '#0d9488' }, { id: 'tag-for-organizer', slug: 'for-organizer', name: '比赛组织者', color: '#d97706' });
    writeFileSync(curationFile, JSON.stringify(curation));
    mkdirSync(join(dir, 'guides'));
    for (const [name, text] of Object.entries(guides)) writeFileSync(join(dir, 'guides', name), text);
    return dir;
  };
  const guide = (fields: Record<string, string>, body = '正文') =>
    `---\n${Object.entries({ id: 't901', slug: 'create-competition', title: '建一场比赛', audience: '比赛组织者', visibility: 'member', order: '1', date: '2026-10-24', ...fields }).map(([k, v]) => `${k}: ${v}`).join('\n')}\n---\n\n${body}\n`;

  it('seeds the usage guides and keeps them in step with the repo, without touching what happened online (#281)', async () => {
    const s = await setup();
    const dir = guideFixture({ 'a.md': guide({}), 'b.md': guide({ id: 't902', slug: 'sign-in', title: '登录', audience: '成员', visibility: 'public', order: '2' }) });
    const content = loadForumContent(dir);
    expect(content.guides.map(item => [item.id, item.visibility, item.tagIds, item.categoryId])).toEqual([
      ['t901', 'member', ['tag-for-organizer'], 'c-guides'], ['t902', 'public', ['tag-for-member'], 'c-guides'],
    ]);
    // 同一天 order 小的时间晚，列表里排在前面。
    expect(content.guides[0].createdAt).toBeGreaterThan(content.guides[1].createdAt);
    const store = createForumStore(s.db, content);
    expect(store.seed()).toBe(2);
    expect(store.seed()).toBe(0);
    const topic = (id: string) => s.db.prepare('SELECT title, slug, visibility, pinned, author_id FROM forum_topics WHERE id = ?').get(id) as Record<string, unknown>;
    const body = (id: string) => s.db.prepare('SELECT content, edited_at FROM forum_posts WHERE id = ?').get(id) as { content: string; edited_at: number | null };
    expect(topic('t901')).toMatchObject({ title: '建一场比赛', visibility: 'member', author_id: 'u-geekclass' });
    expect(body('body-901')).toEqual({ content: '正文', edited_at: null });

    // 线上置顶、回复不动；仓库里改了标题、可见范围和正文，下次启动跟着改。
    s.db.prepare("UPDATE forum_topics SET pinned = 1 WHERE id = 't901'").run();
    writeFileSync(join(dir, 'guides', 'a.md'), guide({ title: '在控制台建一场比赛', visibility: 'registered' }, '新正文'));
    expect(createForumStore(s.db, loadForumContent(dir)).seed(1_800_000_000_000)).toBe(0);
    expect(topic('t901')).toMatchObject({ title: '在控制台建一场比赛', visibility: 'registered', pinned: 1 });
    expect(body('body-901')).toEqual({ content: '新正文', edited_at: 1_800_000_000_000 });
    // 正文没变就不写 edited_at。
    expect(createForumStore(s.db, loadForumContent(dir)).seed(1_900_000_000_000)).toBe(0);
    expect(body('body-901').edited_at).toBe(1_800_000_000_000);

    // 同一个编号已经是别人的话题：不覆盖。
    await s.call('POST', '/api/forum/posts', 'bob', { topicId: 't73', content: '先让 bob 有论坛用户' });
    s.db.prepare("UPDATE forum_topics SET author_id = (SELECT id FROM forum_users WHERE kind <> 'official' LIMIT 1) WHERE id = 't902'").run();
    writeFileSync(join(dir, 'guides', 'b.md'), guide({ id: 't902', slug: 'sign-in', title: '改过的登录', audience: '成员', visibility: 'public', order: '2' }));
    createForumStore(s.db, loadForumContent(dir)).seed();
    expect(topic('t902').title).toBe('登录');
  });

  it('refuses usage guides that do not hold together (#281)', () => {
    const load = (guides: Record<string, string>) => () => loadForumContent(guideFixture(guides));
    expect(load({ 'a.md': '没有 front matter' })).toThrow('needs front matter');
    expect(load({ 'a.md': guide({ id: 't1001' }) })).toThrow('invalid id');
    expect(load({ 'a.md': guide({ id: 't73' }) })).toThrow('invalid id');
    expect(load({ 'a.md': guide({ audience: '访客' }) })).toThrow('unknown audience');
    expect(load({ 'a.md': guide({ visibility: 'admin' }) })).toThrow('invalid visibility');
    expect(load({ 'a.md': guide({ date: '10/24' }) })).toThrow('invalid date');
    expect(load({ 'a.md': guide({}), 'b.md': guide({ slug: 'other' }) })).toThrow('duplicate topic t901');
    expect(load({ 'a.md': guide({ audience: '管理员' }) })).toThrow('curation.json needs c-guides and tag-for-admin');
  });
});

describe('client address behind the two deployment proxies', () => {
  // 部署链路：客户端 → 宿主 nginx → web 容器 nginx（172.18.0.3）→ server。两层 nginx 各往 X-Forwarded-For 末尾追加一段
  // （宿主 nginx 追加客户端地址，web 容器追加它看到的宿主一侧 172.18.0.1）；客户端自己带的 X-Forwarded-For 排在最左边。
  const through = (spoofed: string, client: string, extra: Record<string, string> = {}) => ({
    remoteAddress: '172.18.0.3', headers: { ...extra, 'x-forwarded-for': `${spoofed}, ${client}, 172.18.0.1` },
  });
  const ipKey = (address: string) => createHash('sha256').update(ipSubject(address)).digest('hex');
  // forum.reply.ip.hourly（SPEC §3.8）按解析出来的真实客户端地址分桶：游客回复在 #276 已经去掉，这里改用
  // 成员回复，预先把目标地址的配额堆到只差一次，专门考两层代理的 hop 数解析对不对。
  const replyThrough = (s: Setup, spoofed: string, client: string, who = 'bob') =>
    s.app.inject({ method: 'POST', url: '/api/forum/posts', payload: { topicId: 't9', content: '回复' }, ...through(spoofed, client, s.as(who)) });

  it('with TRUST_PROXY=2 counts replies and audits by the address the host nginx saw, however the client rotates its own header', async () => {
    const s = await setup({ env: { TRUST_PROXY: '2' } });
    for (let i = 0; i < 199; i += 1) s.app.services.limits.hit({ bucket: 'forum.reply.ip.hourly', subject: ipKey('198.51.100.7'), window: { ms: 3600_000 }, max: 200 });
    const statuses: number[] = [];
    for (let i = 1; i <= 2; i += 1) statuses.push((await replyThrough(s, `10.0.0.${i}`, '198.51.100.7')).statusCode);
    expect(statuses).toEqual([201, 429]);
    // 换一个真实客户端地址（宿主 nginx 看到的第二段），配额分开算，不管自称的那段怎么写。
    expect((await replyThrough(s, '10.0.0.99', '198.51.100.8')).statusCode).toBe(201);

    const pinned = await s.app.inject({ method: 'POST', url: '/api/forum/topics/t9/pin', payload: { pinned: true }, ...through('10.9.9.9', '198.51.100.9', s.as('alice')) });
    expect(pinned.statusCode).toBe(200);
    expect(s.db.prepare("SELECT ip FROM activity_events WHERE action = 'forum.topic.pin'").all()).toEqual([{ ip: '198.51.100.9' }]);
  });

  it('with TRUST_PROXY=true the rotated header got through every time (the bug the hop count fixes)', async () => {
    const s = await setup({ env: { TRUST_PROXY: 'true' } });
    for (let i = 0; i < 199; i += 1) s.app.services.limits.hit({ bucket: 'forum.reply.ip.hourly', subject: ipKey('198.51.100.7'), window: { ms: 3600_000 }, max: 200 });
    // 信任每一跳：把客户端自己伪造的最左边地址当真，配额按伪造地址分别算，预先堆满的 199 次配额被绕开。
    for (let i = 1; i <= 6; i += 1) expect((await replyThrough(s, `10.0.0.${i}`, '198.51.100.7')).statusCode).toBe(201);
  });

  it('keeps local development on loopback trust when TRUST_PROXY is unset', async () => {
    const s = await setup();
    for (let i = 0; i < 199; i += 1) s.app.services.limits.hit({ bucket: 'forum.reply.ip.hourly', subject: ipKey('203.0.113.20'), window: { ms: 3600_000 }, max: 200 });
    // 不经回环代理直连时，客户端带的 X-Forwarded-For 不算数：两次「不同」的伪造地址都按同一个真实地址计。
    const direct = (spoofed: string) =>
      s.app.inject({ method: 'POST', url: '/api/forum/posts', payload: { topicId: 't9', content: '回复' }, remoteAddress: '203.0.113.20', headers: { ...s.as('bob'), 'x-forwarded-for': spoofed } });
    expect((await direct('10.0.0.1')).statusCode).toBe(201);
    expect((await direct('10.0.0.2')).statusCode).toBe(429);
    // 本机开发代理（回环）转发时照旧取它追加的地址：换了地址，配额重新算。
    const proxied = await s.app.inject({ method: 'POST', url: '/api/forum/posts', payload: { topicId: 't9', content: '回复' }, remoteAddress: '127.0.0.1', headers: { ...s.as('bob'), 'x-forwarded-for': '198.51.100.30' } });
    expect(proxied.statusCode).toBe(201);
    const subjects = (s.db.prepare("SELECT DISTINCT subject FROM limit_events WHERE bucket = 'forum.reply.ip.hourly'").all() as { subject: string }[]).map(row => row.subject).sort();
    expect(subjects).toEqual([ipKey('198.51.100.30'), ipKey('203.0.113.20')].sort());
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
    expect(nameKey('L\u01DA  Xi\u01CEom\u00EDng')).toBe('luxiaoming');
    expect(nameKey('がくせい')).toBe('かくせい');
    expect(nameKey('김민수')).toBe('김민수');
    // 空白和 - _ . · ・ ' 都不算区别。
    expect(nameKey('极客\u3000 班')).toBe('极客班');
    expect(['极\u00A0客班', '极客班.', "极-客_班'", '阿\u30FB凡提', '阿\u00B7凡提'].map(nameKey)).toEqual(['极客班', '极客班', '极客班', '阿凡提', '阿凡提']);
    // 形近字：ı ĸ 和拉丁字母，片假名カニロエハタトー和汉字力二口工八夕卜一，平假名へ和片假名ヘ。
    expect(nameKey('al\u0131ce gee\u0138class')).toBe('alicegeekclass');
    expect(nameKey('\u30AB\u30CB\u30ED\u30A8\u30CF\u30BF\u30C8\u30FC\u3078')).toBe(nameKey('\u529B\u4E8C\u53E3\u5DE5\u516B\u5915\u535C\u4E00\u30D8'));
  });
});

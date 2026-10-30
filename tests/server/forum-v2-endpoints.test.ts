import { randomUUID } from 'node:crypto';
import { createHash } from 'node:crypto';
import { createRequire } from 'node:module';
import { join } from 'node:path';
import { crc32, deflateSync } from 'node:zlib';
import { afterEach, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { REPO_ROOT } from '../../app/server/src/config';
import { setExclusiveGroupMembership } from '../../app/server/src/lib/permissions';
import { accountIdOf, activityRows, grantPermNode, signIn, testApp } from './helpers';

/** sharp 是 app/server 的依赖，根目录没有它（和 tests/server/forum.test.ts 同一个取法）。 */
const sharp = createRequire(join(REPO_ROOT, 'app/server/package.json'))('sharp') as typeof import('../../app/server/node_modules/sharp');

/**
 * #276 服务端新接口的端到端覆盖：分级可见（CONTRACT §1）、访客翻页上限（§9）、表情包（§3）、表情回应（§4）、
 * 上传图片（§5）、@ 自动补全（§6）、控制台论坛管理（§8），按访客/注册用户/成员/版主四级权限矩阵测。
 * 游客回帖已经删除（见 CONTRACT §2），不在这份文件里：那部分的回归留在 forum.test.ts。
 * llms.txt、/t/<id>.md 的隐藏话题过滤完全在 app/forum（读静态快照，不调这里任何接口），不在服务端职责范围，
 * 这份文件不测它——见本任务汇报里的说明。
 */
const contexts: Awaited<ReturnType<typeof testApp>>[] = [];
afterEach(async () => { for (const c of contexts.splice(0)) await c.close(); });

const GITHUB_IDS: Record<string, number> = { reg: 9801, mem: 9802, mod: 9803, mem2: 9804, sugg1: 9805 };

/** 访客（没有 sid）、注册用户 reg（没有邀请码，留在 level.registered）、成员 mem/mem2、
 * 版主 mod（成员 + forum.moderate.* 限定在 c-exam、c-ai 两个夹具分类）。 */
async function setup() {
  const context = await testApp();
  contexts.push(context);
  const { app } = context;
  const db = app.services.storage.db;
  const sids = new Map<string, string>();
  const as = (login: string) => {
    if (!sids.has(login)) {
      sids.set(login, signIn(app, login, GITHUB_IDS[login]));
      expect(app.services.profiles.update(accountIdOf(app, login), { username: login }).ok).toBe(true);
    }
    return { cookie: `sid=${sids.get(login)}` };
  };
  const setLevel = (login: string, groupId: string) => {
    as(login);
    setExclusiveGroupMembership(db, accountIdOf(app, login), groupId, Date.now(), 'test');
    app.services.permissions.bump();
  };
  for (const login of ['mem', 'mem2', 'mod']) setLevel(login, 'level.member');
  grantPermNode(app, accountIdOf(app, 'mod'), 'forum.moderate.*', { category: ['c-exam', 'c-ai'] });
  as('reg'); // 默认落在 level.registered，不升级。
  const call = (method: 'GET' | 'POST' | 'PATCH' | 'PUT' | 'DELETE', url: string, who?: string, payload?: object) =>
    app.inject({ method, url, ...(payload === undefined ? {} : { payload }), headers: who ? as(who) : {} });
  return { app, db, as, call };
}
type Setup = Awaited<ReturnType<typeof setup>>;

/** 直接给账号的 `meta.limit.*` 节点一个账号级覆盖值（账号自己的优先于组，见 permissions.ts 的 metaValueFromEntries）。 */
function grantMeta(app: FastifyInstance, accountId: string, node: string, value: string | number) {
  app.services.storage.db.prepare(
    "INSERT INTO perm_entries(subject_type, subject_id, node, meta_value, scope, granted_by, created_at) VALUES ('account', ?, ?, ?, '{}', 'test', ?)",
  ).run(accountId, node, String(value), Date.now());
  app.services.permissions.bump();
}

/** 把这个账号的会话改成 20 分钟前登录的，模拟「没刚登录过」（和 console-permissions.test.ts 的 makeStale 同一个套路）。 */
function makeStale(app: FastifyInstance, login: string) {
  app.services.storage.db.prepare('UPDATE sessions SET created_at = ? WHERE login = ?').run(Date.now() - 20 * 60_000, login);
}
/** 把会话改回「刚登录过」：`as()` 按登录名缓存 sid，重复调用拿到的是同一个会话，不能靠再签一次名把 session 变新。 */
function unstale(app: FastifyInstance, login: string) {
  app.services.storage.db.prepare('UPDATE sessions SET created_at = ? WHERE login = ?').run(Date.now(), login);
}

const topicIds = (list: { id: string }[]) => list.map(item => item.id);

/** t73「夹具旧帖一」的真实标题：401/403 响应体不能出现它。 */
const HIDDEN_TITLE = '夹具旧帖一';

describe('分级可见（#276 CONTRACT §1）', () => {
  it('默认所有分类都是 public：访客、注册用户、成员都能看到夹具话题（state、搜索、列表、话题页）', async () => {
    const s = await setup();
    for (const who of [undefined, 'reg', 'mem'] as const) {
      const state = (await s.call('GET', '/api/forum/state', who)).json().state;
      expect(topicIds(state.topics)).toEqual(expect.arrayContaining(['t73', 't9']));
      const search = (await s.call('GET', '/api/forum/search?q=夹具旧帖', who)).json().results;
      expect(topicIds(search.topics)).toEqual(expect.arrayContaining(['t73', 't9']));
      const page = (await s.call('GET', '/api/forum/topics', who)).json();
      expect(topicIds(page.topics)).toEqual(expect.arrayContaining(['t73', 't9']));
      const posts = await s.call('GET', '/api/forum/topics/t73/posts', who);
      expect(posts.statusCode).toBe(200);
    }
  });

  it('版主把 t73 设成 member 可见后：访客 401、注册用户 403，都不带标题；三者的 state/搜索/列表都不再出现这个话题', async () => {
    const s = await setup();
    const patch = await s.call('PATCH', '/api/forum/topics/t73/visibility', 'mod', { visibility: 'member' });
    expect(patch.statusCode).toBe(200);
    expect(patch.json().changes.topics[0]).toMatchObject({ id: 't73', visibility: 'member' });

    const guestPosts = await s.call('GET', '/api/forum/topics/t73/posts');
    expect(guestPosts.statusCode).toBe(401);
    expect(guestPosts.json()).toMatchObject({ error: 'unauthenticated', need: 'member' });
    expect(guestPosts.body).not.toContain(HIDDEN_TITLE);

    const regPosts = await s.call('GET', '/api/forum/topics/t73/posts', 'reg');
    expect(regPosts.statusCode).toBe(403);
    expect(regPosts.json()).toMatchObject({ error: 'forbidden', node: 'forum.read.member', need: 'member' });
    expect(regPosts.body).not.toContain(HIDDEN_TITLE);

    const memPosts = await s.call('GET', '/api/forum/topics/t73/posts', 'mem');
    expect(memPosts.statusCode).toBe(200);

    for (const who of [undefined, 'reg'] as const) {
      expect(topicIds((await s.call('GET', '/api/forum/state', who)).json().state.topics)).not.toContain('t73');
      expect(topicIds((await s.call('GET', '/api/forum/search?q=' + HIDDEN_TITLE, who)).json().results.topics)).not.toContain('t73');
      expect(topicIds((await s.call('GET', '/api/forum/topics', who)).json().topics)).not.toContain('t73');
    }
    const memberState = (await s.call('GET', '/api/forum/state', 'mem')).json().state;
    expect(topicIds(memberState.topics)).toContain('t73');
  });

  it('设成 registered 可见：访客挡住（401 need=registered），注册用户能看', async () => {
    const s = await setup();
    await s.call('PATCH', '/api/forum/topics/t73/visibility', 'mod', { visibility: 'registered' });
    const guest = await s.call('GET', '/api/forum/topics/t73/posts');
    expect(guest.statusCode).toBe(401);
    expect(guest.json()).toMatchObject({ need: 'registered' });
    const registered = await s.call('GET', '/api/forum/topics/t73/posts', 'reg');
    expect(registered.statusCode).toBe(200);
  });

  it('点赞、收藏、表情回应也按话题可见范围拦：帖子编号是递增的，注册用户就算被单独给了 forum.react 也读不到 member 话题的帖子', async () => {
    const s = await setup();
    const postId = (await s.call('GET', '/api/forum/topics/t73/posts', 'mem')).json().posts[0].id as string;
    await s.call('PATCH', '/api/forum/topics/t73/visibility', 'mod', { visibility: 'member' });
    grantPermNode(s.app, accountIdOf(s.app, 'reg'), 'forum.react');
    const sticker = s.app.services.forum.listStickerPacks()[0].stickers[0].id;
    for (const [method, url] of [
      ['POST', `/api/forum/posts/${postId}/like`],
      ['POST', `/api/forum/posts/${postId}/bookmark`],
      ['PUT', `/api/forum/posts/${postId}/reactions/${sticker}`],
      ['DELETE', `/api/forum/posts/${postId}/reactions/${sticker}`],
    ] as const) {
      const res = await s.call(method, url, 'reg');
      expect(res.statusCode, url).toBe(403);
      expect(res.json()).toMatchObject({ error: 'forbidden', need: 'member' });
      expect(res.body).not.toContain(HIDDEN_TITLE);
    }
    expect((await s.call('POST', `/api/forum/posts/${postId}/like`, 'mem')).statusCode).toBe(200);
  });

  it('设成 null 跟随分类，c-exam 默认 public，重新对所有人可见', async () => {
    const s = await setup();
    await s.call('PATCH', '/api/forum/topics/t73/visibility', 'mod', { visibility: 'member' });
    const back = await s.call('PATCH', '/api/forum/topics/t73/visibility', 'mod', { visibility: null });
    expect(back.json().changes.topics[0].visibility).toBe('public');
    expect((await s.call('GET', '/api/forum/topics/t73/posts')).statusCode).toBe(200);
  });

  it('不能比分类更松：c-ai 分类设成 registered 后，话题可见范围不能再设回 public（400 visibility_too_open）', async () => {
    const s = await setup();
    const created = await s.call('POST', '/api/forum/topics', 'mem', { title: 'AI 话题', categoryId: 'c-ai', content: '正文' });
    expect(created.statusCode).toBe(201);
    const topicId = created.json().topicId as string;
    s.app.services.forum.setCategoryVisibility('c-ai', 'registered', 'test');

    const tooOpen = await s.call('PATCH', `/api/forum/topics/${topicId}/visibility`, 'mod', { visibility: 'public' });
    expect(tooOpen.statusCode).toBe(400);
    expect(tooOpen.json().error).toBe('visibility_too_open');

    expect((await s.call('PATCH', `/api/forum/topics/${topicId}/visibility`, 'mod', { visibility: 'registered' })).statusCode).toBe(200);
    expect((await s.call('PATCH', `/api/forum/topics/${topicId}/visibility`, 'mod', { visibility: 'member' })).statusCode).toBe(200);
    expect((await s.call('PATCH', `/api/forum/topics/${topicId}/visibility`, 'mod', { visibility: null })).statusCode).toBe(200);
  });

  it('不是版主（普通成员）改不了可见范围：403；话题不存在：404（和「看不到」用不同的状态码区分）', async () => {
    const s = await setup();
    const notModerator = await s.call('PATCH', '/api/forum/topics/t73/visibility', 'mem2', { visibility: 'member' });
    expect(notModerator.statusCode).toBe(403);
    expect(notModerator.json().error).toBe('forbidden');

    const missing = await s.call('PATCH', '/api/forum/topics/t999999/visibility', 'mod', { visibility: 'member' });
    expect(missing.statusCode).toBe(404);
    expect((await s.call('GET', '/api/forum/topics/t999999/posts', 'mem')).statusCode).toBe(404);
  });
});

describe('话题列表的游标分页 GET /api/forum/topics（#276 CONTRACT §9）', () => {
  it('按最后活跃时间倒序，limit=1 时翻两页翻完；q 按标题子串过滤', async () => {
    const s = await setup();
    const page1 = (await s.call('GET', '/api/forum/topics?limit=1')).json();
    expect(topicIds(page1.topics)).toEqual(['t73']); // createdAt 更晚的夹具旧帖一排在前面
    expect(page1.nextCursor).toBeTruthy();
    const page2 = (await s.call('GET', `/api/forum/topics?limit=1&cursor=${page1.nextCursor}`)).json();
    expect(topicIds(page2.topics)).toEqual(['t9']);
    expect(page2.nextCursor).toBeNull();

    const unique = (await s.call('GET', '/api/forum/topics?q=旧帖一')).json();
    expect(topicIds(unique.topics)).toEqual(['t73']);
    const both = (await s.call('GET', '/api/forum/topics?q=夹具旧帖')).json();
    expect(topicIds(both.topics)).toEqual(expect.arrayContaining(['t73', 't9']));
  });

  it('limit 要是 1 到 50 的整数，不是就 400', async () => {
    const s = await setup();
    for (const limit of ['0', '51', 'abc', '-1']) {
      const res = await s.call('GET', `/api/forum/topics?limit=${limit}`);
      expect(res.statusCode).toBe(400);
      expect(res.json().error).toBe('validation_error');
    }
  });

  it('访客翻页上限（SPEC §3.8）：第一页免费不计数，第二页起（带 cursor）按天每访客最多 10 次，第 11 次 429', async () => {
    const s = await setup();
    const vid = randomUUID();
    const visitorCall = (url: string) => s.app.inject({ url, headers: { cookie: `yugc_vid=${vid}` } });

    for (let i = 0; i < 5; i += 1) expect((await visitorCall('/api/forum/topics')).statusCode).toBe(200);
    expect(s.db.prepare("SELECT COUNT(*) AS n FROM limit_events WHERE bucket = 'forum.visitor.pages'").get()).toEqual({ n: 0 });

    for (let i = 0; i < 10; i += 1) expect((await visitorCall('/api/forum/topics?cursor=x')).statusCode).toBe(200);
    const blocked = await visitorCall('/api/forum/topics?cursor=x');
    expect(blocked.statusCode).toBe(429);
    expect(blocked.json()).toMatchObject({ error: 'rate_limited', bucket: 'forum.visitor.pages' });
    expect(blocked.json().retry_after).toBeGreaterThan(0);
    expect(blocked.headers['retry-after']).toBeDefined();
  });

  it('登录用户（注册用户、成员）翻页不限', async () => {
    const s = await setup();
    for (let i = 0; i < 12; i += 1) expect((await s.call('GET', '/api/forum/topics?cursor=x', 'reg')).statusCode).toBe(200);
    for (let i = 0; i < 12; i += 1) expect((await s.call('GET', '/api/forum/topics?cursor=x', 'mem')).statusCode).toBe(200);
  });
});

describe('表情包（#276 CONTRACT §3）', () => {
  it('GET /api/forum/stickers 不用登录，回极客娘表情包；按内容哈希取图片', async () => {
    const s = await setup();
    const res = await s.call('GET', '/api/forum/stickers');
    expect(res.statusCode).toBe(200);
    const packs = res.json().packs as { id: string; stickers: { id: string; shortcode: string; url: string }[] }[];
    expect(packs.find(p => p.id === 'yugc')?.stickers.length).toBe(24);
    const first = packs[0].stickers[0];
    expect(first.shortcode).toMatch(/^yugc-/);

    const file = await s.app.inject(first.url);
    expect(file.statusCode).toBe(200);
    expect(file.headers['content-type']).toBe('image/webp');
    expect(first.url).toBe(`/api/forum/stickers/${createHash('sha256').update(file.rawPayload).digest('hex')}.webp`);
  });

  it('不存在的表情文件 404', async () => {
    const s = await setup();
    expect((await s.call('GET', `/api/forum/stickers/${'0'.repeat(64)}.webp`)).statusCode).toBe(404);
  });
});

describe('表情回应 PUT/DELETE（#276 CONTRACT §4）', () => {
  it('访客 401，注册用户没有 forum.react 回 403，成员能加能删，未知表情 400', async () => {
    const s = await setup();
    const url = '/api/forum/posts/body-73/reactions/yugc-wave';
    expect((await s.call('PUT', url)).statusCode).toBe(401);
    expect((await s.call('PUT', url, 'reg')).statusCode).toBe(403);

    const added = await s.call('PUT', url, 'mem');
    expect(added.statusCode).toBe(200);
    expect(added.json().reactions).toEqual([{ stickerId: 'yugc-wave', shortcode: 'yugc-wave', url: expect.stringContaining('/api/forum/stickers/'), count: 1, mine: true }]);

    const unknown = await s.call('PUT', '/api/forum/posts/body-73/reactions/yugc-not-a-real-one', 'mem');
    expect(unknown.statusCode).toBe(400);
    expect(unknown.json().error).toBe('unknown_sticker');

    const removed = await s.call('DELETE', url, 'mem');
    expect(removed.statusCode).toBe(200);
    expect(removed.json().reactions).toEqual([]);
  });

  it('每小时限额（meta.limit.forum.react.hourly）超了回 429，带 bucket 与 retry_after', async () => {
    const s = await setup();
    grantMeta(s.app, accountIdOf(s.app, 'mem'), 'meta.limit.forum.react.hourly', 1);
    expect((await s.call('PUT', '/api/forum/posts/body-73/reactions/yugc-wave', 'mem')).statusCode).toBe(200);
    const blocked = await s.call('PUT', '/api/forum/posts/body-73/reactions/yugc-thumbsup', 'mem');
    expect(blocked.statusCode).toBe(429);
    expect(blocked.json()).toMatchObject({ error: 'rate_limited', bucket: 'forum.react.hourly' });
    expect(blocked.json().retry_after).toBeGreaterThan(0);
  });

  it('同一个人对同一条帖子重复加同一个表情：幂等，count 不会往上累加（forum-store.ts 的 INSERT OR IGNORE）', async () => {
    const s = await setup();
    const url = '/api/forum/posts/body-73/reactions/yugc-wave';
    const first = await s.call('PUT', url, 'mem');
    expect(first.json().reactions).toEqual([expect.objectContaining({ stickerId: 'yugc-wave', count: 1, mine: true })]);
    const second = await s.call('PUT', url, 'mem');
    expect(second.statusCode).toBe(200);
    expect(second.json().reactions).toEqual([expect.objectContaining({ stickerId: 'yugc-wave', count: 1, mine: true })]);
    // 换一个人加同一个表情才真的涨到 2；两次重复请求没有把本来就在的那一行变成两行。
    expect((await s.call('PUT', url, 'mem2')).json().reactions).toEqual([expect.objectContaining({ stickerId: 'yugc-wave', count: 2 })]);
  });

  it('表情停用之后不能再用来回应：和不存在的表情同一个错误（400 unknown_sticker），已有的回应不受影响', async () => {
    const s = await setup();
    const url = '/api/forum/posts/body-73/reactions/yugc-wave';
    expect((await s.call('PUT', url, 'mem')).statusCode).toBe(200);
    s.db.prepare("UPDATE forum_stickers SET enabled = 0 WHERE id = 'yugc-wave'").run();
    const blocked = await s.call('PUT', '/api/forum/posts/body-73/reactions/yugc-wave', 'mem2');
    expect(blocked.statusCode).toBe(400);
    expect(blocked.json().error).toBe('unknown_sticker');
    // 停用前已经加上的那条回应还在：停用不回溯删除历史数据，只挡新的加。
    const state = await s.call('GET', `/api/forum/topics/t73/posts`, 'mem');
    const post = state.json().posts.find((item: { id: string }) => item.id === 'body-73');
    expect(post.reactions).toEqual([expect.objectContaining({ stickerId: 'yugc-wave', count: 1 })]);
  });
});

describe('上传图片 PUT/GET /api/forum/uploads（#276 CONTRACT §5）', () => {
  const samplePng = (color = '#336699') => sharp({ create: { width: 10, height: 10, channels: 3, background: color } }).png().toBuffer();

  /** 只有文件头的 PNG，和 forum.test.ts 的 pixelBombPng 同一个写法，用来验证像素上限在解码前就拦住。 */
  function pixelBombPng(width = 5000, height = 4000) {
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

  const upload = (s: Setup, payload: Buffer, who: string | null, type = 'image/png') =>
    s.app.inject({ method: 'PUT', url: '/api/forum/uploads', payload, headers: { ...(who ? s.as(who) : {}), 'content-type': type } });

  it('访客 401（连大请求体都不读），注册用户没有 forum.upload.image 回 403，成员上传成功能取回', async () => {
    const s = await setup();
    const oversized = Buffer.alloc(5 * 1024 * 1024 + 1);
    expect((await upload(s, oversized, null)).json().error).toBe('signin_required');
    expect((await upload(s, await samplePng(), 'reg')).statusCode).toBe(403);

    const png = await samplePng();
    const ok = await upload(s, png, 'mem');
    expect(ok.statusCode).toBe(200);
    const { url, width, height } = ok.json();
    expect([width, height]).toEqual([10, 10]);
    expect(url).toMatch(/^\/api\/forum\/uploads\/[0-9a-f]{64}\.webp$/);
    const served = await s.app.inject(url);
    expect(served.statusCode).toBe(200);
    expect(served.headers['content-type']).toBe('image/webp');

    expect((await s.app.inject(`/api/forum/uploads/${'0'.repeat(64)}.webp`)).statusCode).toBe(404);
  });

  it('接受 PNG、JPEG、WebP 三种格式，都重新编码成 webp 存下来', async () => {
    const s = await setup();
    const image = sharp({ create: { width: 10, height: 10, channels: 3, background: '#aabbcc' } });
    const cases = [
      ['image/png', await image.png().toBuffer()],
      ['image/jpeg', await image.jpeg().toBuffer()],
      ['image/webp', await image.webp().toBuffer()],
    ] as const;
    for (const [type, payload] of cases) {
      const res = await upload(s, payload, 'mem', type);
      expect(res.statusCode, type).toBe(200);
      expect(res.json().url, type).toMatch(/\.webp$/);
    }
  });

  it('请求体超过 5MB：413 upload_too_large', async () => {
    const s = await setup();
    const oversized = Buffer.alloc(5 * 1024 * 1024 + 1);
    const res = await upload(s, oversized, 'mem');
    expect(res.statusCode).toBe(413);
    expect(res.json()).toMatchObject({ error: 'upload_too_large' });
  });

  it('不支持的类型：415 unsupported_media_type', async () => {
    const s = await setup();
    const res = await upload(s, Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"/>'), 'mem', 'image/svg+xml');
    expect(res.statusCode).toBe(415);
    expect(res.json().error).toBe('unsupported_media_type');
  });

  it('超过 4096×4096 像素，解码前就拦住：400 image_too_large', async () => {
    const s = await setup();
    const res = await upload(s, pixelBombPng(4097, 4096), 'mem');
    expect(res.statusCode).toBe(400);
    expect(res.json().error).toBe('image_too_large');
  });

  it('不是真图片：400 invalid_image', async () => {
    const s = await setup();
    const res = await upload(s, Buffer.from('not an image at all'), 'mem');
    expect(res.statusCode).toBe(400);
    expect(res.json().error).toBe('invalid_image');
  });

  it('每小时限额（meta.limit.forum.upload.hourly）超了回 429，拦在解码之前', async () => {
    const s = await setup();
    grantMeta(s.app, accountIdOf(s.app, 'mem'), 'meta.limit.forum.upload.hourly', 1);
    expect((await upload(s, await samplePng(), 'mem')).statusCode).toBe(200);
    const blocked = await upload(s, await samplePng('#996633'), 'mem');
    expect(blocked.statusCode).toBe(429);
    expect(blocked.json()).toMatchObject({ error: 'rate_limited', bucket: 'forum.upload.hourly' });
  });
});

describe('@ 自动补全 GET /api/forum/users/suggest（#276 CONTRACT §6）', () => {
  it('访客 401；注册用户（不是极客班成员也行，只要登录过）能用；按用户名/昵称前缀匹配；不回邮箱', async () => {
    const s = await setup();
    // 签到只建会话；论坛用户行要等它第一次碰论坛接口（ensureMember）才会建，suggestUsers 查的是 forum_users。
    await s.call('GET', '/api/forum/state', 'sugg1'); // 只签到，不升级，留在 level.registered。
    expect((await s.call('GET', '/api/forum/users/suggest?q=su')).statusCode).toBe(401);

    const res = await s.call('GET', '/api/forum/users/suggest?q=sugg', 'reg');
    expect(res.statusCode).toBe(200);
    const users = res.json().users as Record<string, unknown>[];
    expect(users).toEqual([{ username: 'sugg1', display_name: 'sugg1', avatar_url: expect.stringMatching(/^https:\/\/avatars\.githubusercontent\.com\/u\/\d+$/) }]);
    expect(JSON.stringify(users)).not.toMatch(/@.*\./); // 没有邮箱字样
  });

  it('每分钟限额 30 次，第 31 次 429', async () => {
    const s = await setup();
    for (let i = 0; i < 30; i += 1) expect((await s.call('GET', '/api/forum/users/suggest?q=m', 'mem')).statusCode).toBe(200);
    const blocked = await s.call('GET', '/api/forum/users/suggest?q=m', 'mem');
    expect(blocked.statusCode).toBe(429);
    expect(blocked.json()).toMatchObject({ error: 'rate_limited', bucket: 'forum.suggest.per_minute' });
  });
});

describe('控制台论坛管理（#276 CONTRACT §8）：权限矩阵与 step-up', () => {
  async function consoleSetup() {
    const s = await setup();
    s.as('mod'); // 复用 mod 当控制台管理员账号，单独发控制台节点，和论坛版务权限互不相干。
    return s;
  }

  it('GET 分类列表：没有 forum.category.manage 回 403，有的话带 visibility 与 topic_count', async () => {
    const s = await consoleSetup();
    const refused = await s.call('GET', '/api/console/forum/categories', 'mod');
    expect(refused.statusCode).toBe(403);
    grantPermNode(s.app, accountIdOf(s.app, 'mod'), 'forum.category.manage');
    const ok = await s.call('GET', '/api/console/forum/categories', 'mod');
    expect(ok.statusCode).toBe(200);
    const exam = ok.json().categories.find((c: { id: string }) => c.id === 'c-exam');
    expect(exam).toMatchObject({ visibility: 'public', topic_count: 2 });
  });

  it('PATCH 分类可见范围：没权限 403，有权限但没 step-up 403 step_up_required，刚登录过才 200；未知分类 404', async () => {
    const s = await consoleSetup();
    const noPerm = await s.call('PATCH', '/api/console/forum/categories/c-exam', 'mod', { visibility: 'registered' });
    expect(noPerm.statusCode).toBe(403);
    expect(noPerm.json().error).toBe('forbidden');

    grantPermNode(s.app, accountIdOf(s.app, 'mod'), 'forum.category.manage');
    makeStale(s.app, 'mod');
    const stale = await s.call('PATCH', '/api/console/forum/categories/c-exam', 'mod', { visibility: 'registered' });
    expect(stale.statusCode).toBe(403);
    expect(stale.json().error).toBe('step_up_required');

    unstale(s.app, 'mod');
    const ok = await s.call('PATCH', '/api/console/forum/categories/c-exam', 'mod', { visibility: 'registered' });
    expect(ok.statusCode).toBe(200);
    expect(ok.json()).toEqual({ id: 'c-exam', visibility: 'registered' });

    const missing = await s.call('PATCH', '/api/console/forum/categories/c-not-real', 'mod', { visibility: 'public' });
    expect(missing.statusCode).toBe(404);
  });

  it('GET 表情包列表：没有 forum.sticker.manage 回 403，有的话带 use_count', async () => {
    const s = await consoleSetup();
    expect((await s.call('GET', '/api/console/forum/stickers', 'mod')).statusCode).toBe(403);
    grantPermNode(s.app, accountIdOf(s.app, 'mod'), 'forum.sticker.manage');
    const ok = await s.call('GET', '/api/console/forum/stickers', 'mod');
    expect(ok.statusCode).toBe(200);
    const pack = ok.json().packs.find((p: { id: string }) => p.id === 'yugc');
    expect(pack.stickers[0]).toMatchObject({ shortcode: expect.stringContaining('yugc-'), use_count: 0 });
  });

  it('PATCH 表情包/表情：同一套权限 + step-up；新增表情 shortcode 重复回 409，成功后出现在公开列表里', async () => {
    const s = await consoleSetup();
    grantPermNode(s.app, accountIdOf(s.app, 'mod'), 'forum.sticker.manage');
    makeStale(s.app, 'mod');
    const stalePatch = await s.call('PATCH', '/api/console/forum/sticker-packs/yugc', 'mod', { enabled: false });
    expect(stalePatch.statusCode).toBe(403);
    expect(stalePatch.json().error).toBe('step_up_required');

    unstale(s.app, 'mod');
    expect((await s.call('PATCH', '/api/console/forum/sticker-packs/yugc', 'mod', { sort: 1 })).statusCode).toBe(200);
    expect((await s.call('PATCH', '/api/console/forum/sticker-packs/not-real', 'mod', { sort: 1 })).statusCode).toBe(404);
    expect((await s.call('PATCH', '/api/console/forum/stickers/yugc-wave', 'mod', { label: '新标签' })).statusCode).toBe(200);
    expect((await s.call('PATCH', '/api/console/forum/stickers/not-real', 'mod', { label: 'x' })).statusCode).toBe(404);

    const png = await sharp({ create: { width: 10, height: 10, channels: 3, background: '#00ff00' } }).png().toBuffer();
    const uploadSticker = (shortcode: string, who = 'mod') => s.app.inject({
      method: 'PUT', url: `/api/console/forum/sticker-packs/yugc/stickers?shortcode=${shortcode}&label=测试表情`,
      payload: png, headers: { ...s.as(who), 'content-type': 'image/png' },
    });
    const taken = await uploadSticker('yugc-wave'); // 已经存在的短码
    expect(taken.statusCode).toBe(409);
    expect(taken.json().error).toBe('shortcode_taken');

    const created = await uploadSticker('yugc-test-new');
    expect(created.statusCode).toBe(201);
    expect(created.json()).toMatchObject({ id: 'yugc-test-new', shortcode: 'yugc-test-new', label: '测试表情' });
    const list = await s.call('GET', '/api/forum/stickers');
    expect(list.json().packs.find((p: { id: string }) => p.id === 'yugc').stickers.some((st: { id: string }) => st.id === 'yugc-test-new')).toBe(true);
  });

  it('新建表情包：同一套权限 + step-up；id 重复回 409，新包排在最后，往里加的表情出现在公开列表里', async () => {
    const s = await consoleSetup();
    expect((await s.call('POST', '/api/console/forum/sticker-packs', 'mod', { id: 'cats', name: '猫猫' })).statusCode).toBe(403);
    grantPermNode(s.app, accountIdOf(s.app, 'mod'), 'forum.sticker.manage');
    makeStale(s.app, 'mod');
    const stale = await s.call('POST', '/api/console/forum/sticker-packs', 'mod', { id: 'cats', name: '猫猫' });
    expect(stale.json().error).toBe('step_up_required');
    unstale(s.app, 'mod');
    expect((await s.call('POST', '/api/console/forum/sticker-packs', 'mod', { id: 'Cats!', name: '猫猫' })).statusCode).toBe(400);
    const created = await s.call('POST', '/api/console/forum/sticker-packs', 'mod', { id: 'cats', name: ' 猫猫 ' });
    expect(created.statusCode).toBe(201);
    expect(created.json()).toEqual({ id: 'cats', name: '猫猫' });
    const again = await s.call('POST', '/api/console/forum/sticker-packs', 'mod', { id: 'cats', name: '别的' });
    expect(again.statusCode).toBe(409);
    expect(again.json().error).toBe('pack_id_taken');
    expect(activityRows(s.app, { action: 'forum.sticker_pack.create' })).toHaveLength(1);

    const packs = (await s.call('GET', '/api/console/forum/stickers', 'mod')).json().packs as { id: string; sort: number; stickers: unknown[] }[];
    const cats = packs.find(p => p.id === 'cats')!;
    expect(cats.stickers).toEqual([]);
    expect(cats.sort).toBe(Math.max(...packs.map(p => p.sort)));
    // 空包不出现在论坛的表情面板里（面板只画有表情的包），加了表情以后出现
    const png = await sharp({ create: { width: 10, height: 10, channels: 3, background: '#ff9900' } }).png().toBuffer();
    const put = await s.app.inject({ method: 'PUT', url: '/api/console/forum/sticker-packs/cats/stickers?shortcode=cats-hi&label=招手', payload: png, headers: { ...s.as('mod'), 'content-type': 'image/png' } });
    expect(put.statusCode).toBe(201);
    const pub = (await s.call('GET', '/api/forum/stickers')).json().packs as { id: string; stickers: { shortcode: string }[] }[];
    expect(pub.find(p => p.id === 'cats')?.stickers.map(st => st.shortcode)).toEqual(['cats-hi']);
  });

  it('新增表情的图片有自己的上限与格式：超过 2MB 回 413 sticker_too_large，不支持的类型回 415；PNG/JPEG/WebP 都能传', async () => {
    const s = await consoleSetup();
    grantPermNode(s.app, accountIdOf(s.app, 'mod'), 'forum.sticker.manage');
    const uploadSticker = (shortcode: string, payload: Buffer, type: string) => s.app.inject({
      method: 'PUT', url: `/api/console/forum/sticker-packs/yugc/stickers?shortcode=${shortcode}&label=测试表情`,
      payload, headers: { ...s.as('mod'), 'content-type': type },
    });

    const oversized = Buffer.alloc(2 * 1024 * 1024 + 1);
    const tooBig = await uploadSticker('yugc-too-big', oversized, 'image/png');
    expect(tooBig.statusCode).toBe(413);
    expect(tooBig.json()).toMatchObject({ error: 'sticker_too_large' });

    const svg = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"/>');
    const badType = await uploadSticker('yugc-bad-type', svg, 'image/svg+xml');
    expect(badType.statusCode).toBe(415);
    expect(badType.json().error).toBe('unsupported_media_type');

    for (const [ext, type] of [['png', 'image/png'], ['jpeg', 'image/jpeg'], ['webp', 'image/webp']] as const) {
      const image = sharp({ create: { width: 10, height: 10, channels: 3, background: '#112233' } });
      const payload = ext === 'png' ? await image.png().toBuffer() : ext === 'jpeg' ? await image.jpeg().toBuffer() : await image.webp().toBuffer();
      const ok = await uploadSticker(`yugc-new-${ext}`, payload, type);
      expect(ok.statusCode, ext).toBe(201);
    }
  });
});

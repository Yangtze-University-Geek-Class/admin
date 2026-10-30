import { createHash } from 'node:crypto';
import { createRequire } from 'node:module';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { REPO_ROOT, createConfig } from '../../app/server/src/config';
import { setExclusiveGroupMembership } from '../../app/server/src/lib/permissions';
import { STATIC_CDN_BASE, parseStaticCdnBase } from '../../app/server/src/lib/static-cdn';
import { createStickerUrl, loadStickerManifest, stickerSameOriginUrl } from '../../app/server/src/lib/sticker-manifest';
import { accountIdOf, grantPermNode, signIn, testApp } from './helpers';

/** sharp 是 app/server 的依赖，根目录没有它（和 forum-v2-endpoints.test.ts 同一个取法）。 */
const sharp = createRequire(join(REPO_ROOT, 'app/server/package.json'))('sharp') as typeof import('../../app/server/node_modules/sharp');

/**
 * 表情图片的地址（#286）：CDN 开关（构建参数 STATIC_CDN_BASE，进到服务进程的环境变量）关闭时全部同源；
 * 打开时仓库内置的表情（内容哈希在 app/server/assets/stickers/manifest.json 里）走 CDN 绝对地址，
 * 站长在控制台上传的、CDN 上没有的仍走同源。
 */
const contexts: Awaited<ReturnType<typeof testApp>>[] = [];
afterEach(async () => { for (const context of contexts.splice(0)) await context.close(); });

type PublicPack = { id: string; stickers: { id: string; shortcode: string; label: string; url: string }[] };
const SAME_ORIGIN = /^\/api\/forum\/stickers\/[0-9a-f]{64}\.webp$/;
const manifest = loadStickerManifest(join(REPO_ROOT, 'app/server/assets/stickers'));
const builtIn = manifest.packs.flatMap(pack => pack.stickers.map(sticker => ({ ...sticker, shortcode: `${pack.id}-${sticker.id}` })));

async function setup(env: Record<string, string> = {}) {
  const context = await testApp({}, false, env);
  contexts.push(context);
  const { app } = context;
  const sids = new Map<string, string>();
  const as = (login: string, githubId: number) => {
    if (!sids.has(login)) sids.set(login, signIn(app, login, githubId));
    return { cookie: `sid=${sids.get(login)}` };
  };
  const member = (login: string, githubId: number) => {
    as(login, githubId);
    setExclusiveGroupMembership(app.services.storage.db, accountIdOf(app, login), 'level.member', Date.now(), 'test');
    app.services.permissions.bump();
    return as(login, githubId);
  };
  return { app, as, member };
}

async function publicStickers(app: Awaited<ReturnType<typeof setup>>['app']) {
  const res = await app.inject('/api/forum/stickers');
  expect(res.statusCode).toBe(200);
  return (res.json().packs as PublicPack[]).flatMap(pack => pack.stickers);
}

describe('开关关闭（不传 STATIC_CDN_BASE）：图片地址全是同源', () => {
  it('公开列表里每个表情都是 /api/forum/stickers/<哈希>.webp', async () => {
    const { app } = await setup();
    const stickers = await publicStickers(app);
    expect(stickers.length).toBe(builtIn.length);
    for (const sticker of stickers) expect(sticker.url, sticker.shortcode).toMatch(SAME_ORIGIN);
    for (const item of builtIn) expect(stickers.find(sticker => sticker.shortcode === item.shortcode)?.url).toBe(stickerSameOriginUrl(item.sha256));
  });

  it('控制台列表和表情回应里的图片也是同源', async () => {
    const { app, member } = await setup();
    const headers = member('cdn-mod', 9911);
    expect((await app.inject({ method: 'GET', url: '/api/console/forum/stickers', headers })).statusCode).toBe(403);
    grantPermNode(app, accountIdOf(app, 'cdn-mod'), 'forum.sticker.manage');
    const ok = await app.inject({ method: 'GET', url: '/api/console/forum/stickers', headers });
    expect(ok.statusCode).toBe(200);
    for (const pack of ok.json().packs as { stickers: { url: string }[] }[]) for (const sticker of pack.stickers) expect(sticker.url).toMatch(SAME_ORIGIN);

    const reaction = await app.inject({ method: 'PUT', url: '/api/forum/posts/body-73/reactions/yugc-wave', headers: member('cdn-mem', 9912) });
    expect(reaction.statusCode).toBe(200);
    expect(reaction.json().reactions).toEqual([expect.objectContaining({ stickerId: 'yugc-wave', url: stickerSameOriginUrl(builtIn.find(item => item.shortcode === 'yugc-wave')!.sha256) })]);
  });
});

describe('开关打开（STATIC_CDN_BASE 等于固定值）：内置表情走 CDN，站长上传的仍同源', () => {
  it('每个内置表情的地址是 STATIC_CDN_BASE 加清单里的对象键，库里的哈希与清单一致', async () => {
    const { app } = await setup({ STATIC_CDN_BASE });
    const stickers = await publicStickers(app);
    expect(stickers.length).toBe(builtIn.length);
    const rows = app.services.storage.db.prepare('SELECT id, file_hash FROM forum_stickers').all() as { id: string; file_hash: string }[];
    for (const item of builtIn) {
      expect(rows.find(row => row.id === item.shortcode)?.file_hash, item.shortcode).toBe(item.sha256);
      expect(stickers.find(sticker => sticker.shortcode === item.shortcode)?.url, item.shortcode).toBe(`https://cdn.crosery.com/yzgc/static/site/forum/stickers/${item.sha256}.webp`);
      expect(item.key).toBe(`forum/stickers/${item.sha256}.webp`);
    }
  });

  it('站长在控制台上传的表情不在清单里，CDN 上没有它，地址仍是同源；内置的照样走 CDN', async () => {
    const { app, as, member } = await setup({ STATIC_CDN_BASE });
    member('cdn-mod', 9921);
    grantPermNode(app, accountIdOf(app, 'cdn-mod'), 'forum.sticker.manage');
    const png = await sharp({ create: { width: 12, height: 12, channels: 3, background: '#33aa77' } }).png().toBuffer();
    const put = await app.inject({
      method: 'PUT', url: '/api/console/forum/sticker-packs/yugc/stickers?shortcode=yugc-runtime-added&label=后来加的',
      payload: png, headers: { ...as('cdn-mod', 9921), 'content-type': 'image/png' },
    });
    expect(put.statusCode).toBe(201);
    const stickers = await publicStickers(app);
    const added = stickers.find(sticker => sticker.shortcode === 'yugc-runtime-added')!;
    expect(added.url).toMatch(SAME_ORIGIN);
    const stored = app.services.storage.db.prepare("SELECT file_hash FROM forum_stickers WHERE id = 'yugc-runtime-added'").get() as { file_hash: string };
    expect(builtIn.some(item => item.sha256 === stored.file_hash)).toBe(false);
    expect(added.url).toBe(stickerSameOriginUrl(stored.file_hash));
    expect(stickers.find(sticker => sticker.shortcode === 'yugc-wave')!.url.startsWith(STATIC_CDN_BASE)).toBe(true);

    const consoleList = await app.inject({ method: 'GET', url: '/api/console/forum/stickers', headers: as('cdn-mod', 9921) });
    const all = (consoleList.json().packs as { stickers: { id: string; url: string }[] }[]).flatMap(pack => pack.stickers);
    expect(all.find(sticker => sticker.id === 'yugc-runtime-added')!.url).toMatch(SAME_ORIGIN);
    expect(all.find(sticker => sticker.id === 'yugc-wave')!.url.startsWith(STATIC_CDN_BASE)).toBe(true);
  });

  it('表情回应里的图片地址同样走 CDN', async () => {
    const { app, member } = await setup({ STATIC_CDN_BASE });
    const wave = builtIn.find(item => item.shortcode === 'yugc-wave')!;
    const res = await app.inject({ method: 'PUT', url: '/api/forum/posts/body-73/reactions/yugc-wave', headers: member('cdn-mem', 9922) });
    expect(res.statusCode).toBe(200);
    expect(res.json().reactions).toEqual([expect.objectContaining({ stickerId: 'yugc-wave', url: `${STATIC_CDN_BASE}forum/stickers/${wave.sha256}.webp` })]);
  });
});

describe('同源图片路由（开关关闭时的唯一来源，开关打开时的退路）', () => {
  it('每张内置图片都取得到，一年 immutable，不带 Content-Encoding，字节与清单一致', async () => {
    const { app } = await setup({ STATIC_CDN_BASE });
    for (const item of builtIn) {
      const res = await app.inject(stickerSameOriginUrl(item.sha256));
      expect(res.statusCode, item.shortcode).toBe(200);
      expect(res.headers['content-type']).toBe('image/webp');
      expect(res.headers['cache-control'], item.shortcode).toBe('public, max-age=31536000, immutable');
      expect(res.headers['content-encoding']).toBeUndefined();
      expect(createHash('sha256').update(res.rawPayload).digest('hex')).toBe(item.sha256);
      expect(res.rawPayload.length).toBe(item.size);
    }
  });

  it('只有按哈希取图的成功响应长期缓存：列表接口、不存在的哈希、不合法的文件名仍是 no-store', async () => {
    const { app } = await setup();
    const list = await app.inject('/api/forum/stickers');
    expect(list.statusCode).toBe(200);
    expect(list.headers['cache-control']).toBe('no-store');
    const withQuery = await app.inject('/api/forum/stickers?x=1');
    expect(withQuery.headers['cache-control']).toBe('no-store');
    const missing = await app.inject(`/api/forum/stickers/${'0'.repeat(64)}.webp`);
    expect(missing.statusCode).toBe(404);
    expect(missing.headers['cache-control']).toBe('no-store');
    for (const bad of ['../x.webp', 'abc.webp', `${'0'.repeat(63)}.webp`, `${'0'.repeat(64)}.png`]) {
      const res = await app.inject(`/api/forum/stickers/${bad}`);
      expect(res.statusCode, bad).toBeGreaterThanOrEqual(400);
      expect(res.headers['cache-control'], bad).toBe('no-store');
    }
  });
});

describe('createStickerUrl', () => {
  const sample = { version: 1 as const, packs: [{ id: 'a', name: 'A', stickers: [{ id: 'b', label: 'B', file: 'b.webp', sha256: 'a'.repeat(64), size: 5, key: `forum/stickers/${'a'.repeat(64)}.webp` }] }] };

  it('开关关闭（cdnBase 为空）时不论清单里有没有，都是同源地址', () => {
    const url = createStickerUrl({ cdnBase: '', manifest: sample });
    expect(url('a'.repeat(64))).toBe(`/api/forum/stickers/${'a'.repeat(64)}.webp`);
    expect(url('b'.repeat(64))).toBe(`/api/forum/stickers/${'b'.repeat(64)}.webp`);
  });

  it('开关打开时只有清单里的哈希走 CDN，别的哈希同源', () => {
    const url = createStickerUrl({ cdnBase: STATIC_CDN_BASE, manifest: sample });
    expect(url('a'.repeat(64))).toBe(`${STATIC_CDN_BASE}forum/stickers/${'a'.repeat(64)}.webp`);
    expect(url('b'.repeat(64))).toBe(`/api/forum/stickers/${'b'.repeat(64)}.webp`);
  });

  it('空清单（没有清单文件）时开关打开也全是同源', () => {
    expect(createStickerUrl({ cdnBase: STATIC_CDN_BASE, manifest: { version: 1, packs: [] } })('a'.repeat(64))).toMatch(SAME_ORIGIN);
  });
});

describe('STATIC_CDN_BASE 的读法', () => {
  const env = {
    NODE_ENV: 'test', PUBLIC_ORIGIN: 'https://example.test', DB_PATH: ':memory:',
    SESSION_SECRET: 'isolated-core-test-secret-at-least-32', ENCRYPTION_KEY: Buffer.alloc(32, 1).toString('base64'),
    OAUTH_CLIENT_ID: 'test-client', OAUTH_CLIENT_SECRET: 'test-only-placeholder',
  };

  it('未设置、空串、纯空白都是同源（空）；等于固定值才打开；别的值一律拒绝', () => {
    expect(createConfig(env).staticCdnBase).toBe('');
    expect(parseStaticCdnBase(undefined)).toBe('');
    expect(parseStaticCdnBase('')).toBe('');
    expect(parseStaticCdnBase('  ')).toBe('');
    expect(parseStaticCdnBase(STATIC_CDN_BASE)).toBe(STATIC_CDN_BASE);
    expect(createConfig({ ...env, STATIC_CDN_BASE }).staticCdnBase).toBe(STATIC_CDN_BASE);
    for (const wrong of ['https://cdn-old.example.test/', 'https://cdn.crosery.com/yzgc/static/site', 'http://cdn.crosery.com/yzgc/static/site/', 'https://evil.example/yzgc/static/site/', 'https://cdn-old.example.test/yzgc/promo/']) {
      expect(() => parseStaticCdnBase(wrong), wrong).toThrow(/只能为空或/);
      expect(() => createConfig({ ...env, STATIC_CDN_BASE: wrong }), wrong).toThrow(/只能为空或/);
    }
  });
});

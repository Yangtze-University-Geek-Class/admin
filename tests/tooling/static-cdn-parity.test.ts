import { describe, expect, it } from 'vitest';
import { STATIC_CDN_BASE, staticCdnBase } from '../../scripts/static-cdn-base.mjs';
import { PACK_ID, PACK_NAME_MAX, STICKER_ID, STICKER_KEY_PREFIX, STICKER_LABEL_MAX } from '../../scripts/sticker-manifest.mjs';
import { STATIC_CDN_BASE as SERVER_BASE, parseStaticCdnBase } from '../../app/server/src/lib/static-cdn';
import { STICKER_KEY_PREFIX as SERVER_KEY_PREFIX, stickerSameOriginUrl } from '../../app/server/src/lib/sticker-manifest';
import { FORUM_LIMITS } from '../../app/server/src/lib/forum-rules';

// server 镜像的构建上下文里没有 scripts/（app/server/Dockerfile 只复制 app/server/src），tsconfig 的 rootDir 也是 src，
// 所以服务端对 STATIC_CDN_BASE 的读法与对象键前缀各写了一份（#286）。这里逐项核对两份规则一致。
const run = (read: () => string) => { try { return { ok: read() }; } catch (error) { return { error: (error as Error).message }; } };

describe('server STATIC_CDN_BASE rule equals scripts/static-cdn-base.mjs', () => {
  it('names the same fixed address', () => {
    expect(SERVER_BASE).toBe(STATIC_CDN_BASE);
  });

  it('never reflects credentials accidentally pasted into a build URL', () => {
    const raw = 'https://fixture-user:fixture-private@cdn.yangtzeu.work/geek-public/static/site/';
    for (const read of [() => staticCdnBase({ STATIC_CDN_BASE: raw }), () => parseStaticCdnBase(raw)]) {
      expect(run(read)).toHaveProperty('error');
      expect(JSON.stringify(run(read))).not.toContain('fixture-private');
    }
  });

  it.each([
    undefined, '', ' ', '\n', '\t ', STATIC_CDN_BASE, ` ${STATIC_CDN_BASE} `, `${STATIC_CDN_BASE}\n`,
    'https://cdn-old.example.test', 'https://cdn-old.example.test/', 'https://cdn.yangtzeu.work/geek-public/static/site', 'http://cdn.yangtzeu.work/geek-public/static/site/',
    'https://CDN.yangtzeu.work/geek-public/static/site/', 'https://cdn.yangtzeu.work/geek-public/static/site//', 'https://cdn.yangtzeu.work/geek-public/static/site/forum/',
    'https://evil.example/yzgc/static/site/', 'https://cdn-old.example.test/yzgc/promo/', '/yzgc/static/site/', 'null', '0',
  ])('gives the same answer for %j', raw => {
    expect(run(() => parseStaticCdnBase(raw))).toEqual(run(() => staticCdnBase({ STATIC_CDN_BASE: raw })));
  });
});

describe('server manifest reader equals scripts/sticker-manifest.mjs', () => {
  it('uses the same object key prefix, id shapes and text limits', () => {
    expect(SERVER_KEY_PREFIX).toBe(STICKER_KEY_PREFIX);
    expect(PACK_NAME_MAX).toBe(40);
    expect(STICKER_LABEL_MAX).toBe(FORUM_LIMITS.stickerLabelMax);
    // 脚本允许的每个 包 id + 表情 id 组合，服务端的短码规则都认。
    expect(`${'a'.repeat(20)}-${'b'.repeat(19)}`).toMatch(FORUM_LIMITS.stickerShortcodePattern);
    for (const id of ['yugc', 'cats', 'a', '0pack', 'a-b', 'x'.repeat(20)]) expect(id).toMatch(PACK_ID);
    for (const id of ['wave', 'a', '0a', 'a-b', 'y'.repeat(19)]) expect(id).toMatch(STICKER_ID);
    for (const id of ['-a', 'A', 'a_b', 'x'.repeat(21), '']) expect(id).not.toMatch(PACK_ID);
    for (const id of ['-a', 'A', 'a_b', 'y'.repeat(20), '']) expect(id).not.toMatch(STICKER_ID);
  });

  it('the same-origin address is the CDN address without the prefix: <origin>/api/forum/stickers/<hash>.webp vs <base>forum/stickers/<hash>.webp', () => {
    const hash = 'cd'.repeat(32);
    expect(stickerSameOriginUrl(hash)).toBe(`/api/forum/stickers/${hash}.webp`);
    expect(`${STATIC_CDN_BASE}${SERVER_KEY_PREFIX}${hash}.webp`).toBe(`https://cdn.yangtzeu.work/geek-public/static/site/forum/stickers/${hash}.webp`);
  });
});

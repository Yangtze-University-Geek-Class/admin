import { describe, expect, it } from 'vitest'
import { currentCdnUrl, isStickerUrl, LEGACY_STATIC_CDN_PREFIX, STATIC_CDN_PREFIX, STICKER_CDN_PREFIX, STICKER_SAME_ORIGIN_PREFIX, STICKER_URL_PATTERN, stickerHash } from '../shared/sticker-url'

/**
 * The one rule for a sticker picture address (#286): the same-origin content-hash address and the same hash on the
 * controlled CDN are taken, nothing else. forum-api.ts (what the server sends), post-markdown.ts (post bodies and
 * the way in and out of the editor) and editor/inline-stickers.ts (picture blocks in the editor) all use it.
 */
const HASH = 'ab12'.repeat(16)
const SAME = `/api/forum/stickers/${HASH}.webp`
const NEW_ORIGIN = new URL(STICKER_CDN_PREFIX).origin
const NEW_HOST = new URL(STICKER_CDN_PREFIX).host
const CDN = `${STICKER_CDN_PREFIX}${HASH}.webp`
const LEGACY = `${LEGACY_STATIC_CDN_PREFIX}forum/stickers/${HASH}.webp`

describe('sticker picture addresses', () => {
  it('takes the same-origin address and the controlled CDN address of a 64-hex content hash', () => {
    expect(STICKER_SAME_ORIGIN_PREFIX).toBe('/api/forum/stickers/')
    expect(STICKER_CDN_PREFIX).toBe('https://cdn.crosery.com/yzgc/static/site/forum/stickers/')
    expect(isStickerUrl(SAME)).toBe(true)
    expect(isStickerUrl(CDN)).toBe(true)
    expect(isStickerUrl(`/api/forum/stickers/${'0'.repeat(64)}.webp`)).toBe(true)
    expect(isStickerUrl(`${STICKER_CDN_PREFIX}${'f'.repeat(64)}.webp`)).toBe(true)
  })

  it.each([
    ['the retired CDN', `https://cdn-old.example.test/yzgc/static/site/forum/stickers/${HASH}.webp`],
    ['the retired cn domain', `https://cdn-old.example.cn/yzgc/static/site/forum/stickers/${HASH}.webp`],
    ['a host that starts with the new CDN host', `https://${NEW_HOST}.evil.example/yzgc/static/site/forum/stickers/${HASH}.webp`],
    ['the new CDN behind a userinfo', `https://${NEW_HOST}@evil.example/yzgc/static/site/forum/stickers/${HASH}.webp`],
    ['the new CDN on another port', `https://${NEW_HOST}:8443/yzgc/static/site/forum/stickers/${HASH}.webp`],
    ['a protocol-relative new CDN', `//cdn.crosery.com/yzgc/static/site/forum/stickers/${HASH}.webp`],
    ['an encoded path trick on the new CDN', `https://cdn.crosery.com/yzgc/static/site/forum/stickers/%2e%2e/${HASH}.webp`],
    ['a private bucket on the new CDN', `${NEW_ORIGIN}/geek-production-private/yzgc/static/site/forum/stickers/${HASH}.webp`],
    ['another domain', `https://cdn.example.com/yzgc/static/site/forum/stickers/${HASH}.webp`],
    ['another domain with the same path', `https://evil.example/forum/stickers/${HASH}.webp`],
    ['a host that starts with the CDN host', `https://cdn-old.example.test.evil.example/yzgc/static/site/forum/stickers/${HASH}.webp`],
    ['the CDN address behind a userinfo', `https://cdn-old.example.test@evil.example/yzgc/static/site/forum/stickers/${HASH}.webp`],
    ['the CDN address inside another URL', `https://evil.example/${CDN}`],
    ['the CDN host on another port', `https://cdn-old.example.test:8443/yzgc/static/site/forum/stickers/${HASH}.webp`],
    ['http instead of https', `http://cdn.crosery.com/yzgc/static/site/forum/stickers/${HASH}.webp`],
    ['an upper-case host', CDN.replace('https://cdn.', 'https://CDN.')],
    ['a protocol-relative address', `//cdn-old.example.test/yzgc/static/site/forum/stickers/${HASH}.webp`],
    ['another folder of the CDN', `https://cdn.crosery.com/yzgc/static/site/forum/guides/${HASH}.webp`],
    ['another prefix of the CDN', `https://cdn-old.example.test/yzgc/promo/forum/stickers/${HASH}.webp`],
    ['a path trick on the CDN', `https://cdn.crosery.com/yzgc/static/site/forum/stickers/../guides/${HASH}.webp`],
    ['a doubled slash on the CDN', `https://cdn.crosery.com/yzgc/static/site/forum/stickers//${HASH}.webp`],
    ['a subfolder on the CDN', `https://cdn.crosery.com/yzgc/static/site/forum/stickers/sub/${HASH}.webp`],
    ['a path trick on the same origin', `/api/forum/stickers/../uploads/${HASH}.webp`],
    ['an encoded path trick on the same origin', `/api/forum/stickers/%2e%2e/${HASH}.webp`],
    ['a path trick behind the hash', `/api/forum/stickers/${HASH}/../${HASH}.webp`],
    ['another API folder', `/api/forum/uploads/${HASH}.webp`],
    ['a relative address', `api/forum/stickers/${HASH}.webp`],
    ['a query string', `${SAME}?x=1`],
    ['a query string on the CDN', `${CDN}?x=1`],
    ['a fragment', `${CDN}#x`],
    ['the wrong extension', `/api/forum/stickers/${HASH}.png`],
    ['an upper-case extension', `/api/forum/stickers/${HASH}.WEBP`],
    ['a doubled extension', `${SAME}.png`],
    ['a short hash', `/api/forum/stickers/${HASH.slice(1)}.webp`],
    ['a long hash', `/api/forum/stickers/${HASH}0.webp`],
    ['an upper-case hash', `/api/forum/stickers/${HASH.toUpperCase()}.webp`],
    ['a hash with a non-hex letter', `/api/forum/stickers/${HASH.slice(1)}g.webp`],
    ['javascript:', 'javascript:alert(1)'],
    ['javascript: dressed as the CDN', `javascript:void("${CDN}")`],
    ['data:', 'data:image/webp;base64,UklGRg=='],
    ['blob:', `blob:${CDN}`],
    ['a leading space', ` ${SAME}`],
    ['a trailing newline', `${SAME}\n`],
    ['an embedded newline', `/api/forum/stickers/\n${HASH}.webp`],
    ['an empty string', ''],
  ])('refuses %s', (_name, url) => {
    expect(isStickerUrl(url)).toBe(false)
    expect(stickerHash(url)).toBeNull()
  })

  it('takes the old Garage address of the same hash, and reads it as the current address (#346)', () => {
    expect(isStickerUrl(LEGACY)).toBe(true)
    expect(stickerHash(LEGACY)).toBe(HASH)
    expect(currentCdnUrl(LEGACY)).toBe(CDN)
    expect(currentCdnUrl(SAME)).toBe(SAME)
    expect(currentCdnUrl(CDN)).toBe(CDN)
    expect(currentCdnUrl(`${LEGACY_STATIC_CDN_PREFIX}forum/published/${'0'.repeat(16)}.webp`)).toBe(`${STATIC_CDN_PREFIX}forum/published/${'0'.repeat(16)}.webp`)
    expect(currentCdnUrl('https://evil.example/x.webp')).toBe('https://evil.example/x.webp')
  })

  it.each([
    ['a path trick on the old address', `${LEGACY_STATIC_CDN_PREFIX}forum/stickers/../guides/${HASH}.webp`],
    ['the old address over http', `http://cdn.yangtzeu.work/geek-public/static/site/forum/stickers/${HASH}.webp`],
    ['the old address with a subfolder', `${LEGACY_STATIC_CDN_PREFIX}forum/stickers/sub/${HASH}.webp`],
    ['the old address behind a userinfo', `https://cdn.yangtzeu.work@evil.example/geek-public/static/site/forum/stickers/${HASH}.webp`],
    ['the old address with a query string', `${LEGACY}?x=1`],
  ])('refuses %s', (_name, url) => {
    expect(isStickerUrl(url)).toBe(false)
    expect(stickerHash(url)).toBeNull()
  })

  it('refuses what is not a string', () => {
    for (const value of [undefined, null, 7, {}, [SAME], true])
      expect(isStickerUrl(value)).toBe(false)
  })

  it('gives the same hash for both forms of one picture, and null for anything else', () => {
    expect(stickerHash(SAME)).toBe(HASH)
    expect(stickerHash(CDN)).toBe(HASH)
    expect(stickerHash('https://evil.example/x.webp')).toBeNull()
    expect(stickerHash(undefined)).toBeNull()
  })

  it('offers the address as a pattern a Markdown image regex can embed, with the same two forms and nothing more', () => {
    const image = new RegExp(`!\\[[^\\]\\n]*\\]\\((${STICKER_URL_PATTERN})\\)`, 'g')
    expect([...`![a](${SAME}) ![b](${CDN}) ![c](https://evil.example/x.webp) ![d](${SAME}?x=1)`.matchAll(image)].map(match => match[1])).toEqual([SAME, CDN])
    expect(new RegExp(`^${STICKER_URL_PATTERN}$`).test(CDN)).toBe(true)
  })
})

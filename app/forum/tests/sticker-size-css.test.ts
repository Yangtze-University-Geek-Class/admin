import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { STICKER_INLINE_SIZE, STICKER_SELECTORS, stickerInlineCss } from '../shared/sticker-css'
import { isStickerUrl } from '../shared/sticker-url'

/**
 * How big a sticker is in the line, and where it sits (#294). The composer rule used to name only the same-origin
 * address, so when the built-in stickers moved to the CDN (#286) the picture in the box lost its size and filled it;
 * posts had a fixed 4rem. One rule now sizes both, in em, bottom on the text's bottom, and it is built from the same
 * address prefixes the whitelist uses.
 */
const HASH = 'ab12'.repeat(16)
const SAME = `/api/forum/stickers/${HASH}.webp`
const CDN = `https://cdn.crosery.com/yzgc/static/site/forum/stickers/${HASH}.webp`

/** The attribute-prefix selector of an `img[src^="…"]` entry, or null for the class selector. */
const prefixOf = (selector: string): string | null => /\[src\^="([^"]+)"\]/.exec(selector)?.[1] ?? null

describe('sticker size in the line', () => {
  it('covers a post, and the composer for both the same-origin and the CDN address', () => {
    expect(STICKER_SELECTORS).toContain('.forum-sticker')
    for (const address of [SAME, CDN]) {
      expect(isStickerUrl(address)).toBe(true)
      const covering = STICKER_SELECTORS.filter(selector => selector.startsWith('.milkdown img') && address.startsWith(prefixOf(selector) ?? '\0'))
      expect(covering, `no composer selector matches ${address}`).toHaveLength(1)
    }
  })

  it('does not touch an uploaded picture or a picture from another address', () => {
    const prefixes = STICKER_SELECTORS.map(prefixOf).filter((prefix): prefix is string => prefix !== null)
    for (const address of ['/api/forum/uploads/ab12.webp', `https://evil.example/yzgc/static/site/forum/stickers/${HASH}.webp`, 'https://cdn.crosery.com/yzgc/static/site/forum/uploads/x.webp']) {
      expect(prefixes.some(prefix => address.startsWith(prefix)), address).toBe(false)
    }
  })

  it('sizes the picture from the text, square, with its bottom on the text bottom', () => {
    const css = stickerInlineCss()
    expect(STICKER_INLINE_SIZE).toMatch(/^\d+(\.\d+)?em$/)
    expect(css).toContain(`width: ${STICKER_INLINE_SIZE};`)
    expect(css).toContain(`height: ${STICKER_INLINE_SIZE};`)
    expect(css).toContain('display: inline-block;')
    expect(css).toContain('vertical-align: text-bottom;')
    expect(css).toContain('object-fit: contain;')
    expect(css).not.toMatch(/\b\d+(\.\d+)?(px|rem)\b[^;]*;/)
  })

  it('is the rule FORUM_THEME_CSS carries, with no fixed-size rule left beside it', () => {
    const config = readFileSync(new URL('../uno.config.ts', import.meta.url), 'utf8')
    expect(config).toContain("import { stickerInlineCss } from './shared/sticker-css'")
    expect(config).toContain('${stickerInlineCss()}')
    expect(config).not.toMatch(/\.forum-sticker\s*\{/)
    expect(config).not.toMatch(/img\[src\^="\/api\/forum\/stickers\/"\]/)
  })
})

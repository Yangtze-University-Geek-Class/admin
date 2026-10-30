import { STICKER_CDN_PREFIX, STICKER_SAME_ORIGIN_PREFIX } from './sticker-url'

/**
 * How big a sticker is in the line, and where it sits (#294). It is two characters tall, so it follows the font
 * size in a post, in the composer and on a phone, and the whole figure and the word on it stay readable; it was a
 * fixed 4rem in posts and 3rem in the composer (#276). Its bottom lines up with the bottom of the text
 * (`vertical-align: text-bottom`, which is what a Bilibili comment does with its 1.4em emote: measured on a video's
 * comments on 2026-10-25, 21px in 15px text), so a line with a sticker in it sits on the same ruled line as the rest.
 * The composer rule used to name only the same-origin address, so once the built-in stickers moved to the CDN (#286)
 * the picture there had no size at all and filled the box.
 */
export const STICKER_INLINE_SIZE = '2em'

/**
 * A rendered post puts `.forum-sticker` on the picture (shared/post-markdown.ts). The composer keeps Milkdown's plain
 * <img>, so it is told apart by its address, which is one of the two forms shared/sticker-url.ts lets through.
 */
// CDN 前缀为空（开关关闭）时不加这一条：[src^=""] 会匹配所有图片。
export const STICKER_SELECTORS = [
  '.forum-sticker',
  `.milkdown img[src^="${STICKER_SAME_ORIGIN_PREFIX}"]`,
  ...(STICKER_CDN_PREFIX ? [`.milkdown img[src^="${STICKER_CDN_PREFIX}"]`] : []),
]

/** The one rule for a sticker sitting between words; uno.config.ts puts it in FORUM_THEME_CSS. */
export function stickerInlineCss(): string {
  return `${STICKER_SELECTORS.join(',\n')} {
  display: inline-block;
  width: ${STICKER_INLINE_SIZE};
  height: ${STICKER_INLINE_SIZE};
  margin: 0 0.1em;
  object-fit: contain;
  vertical-align: text-bottom;
}`
}

/**
 * 帖子正文按 Markdown 原样存，游客也能发，渲染给别人看之前先在这里过一遍，再交给 TxMarkdownView。
 *
 * 1. 原始 HTML 一律当文字显示：每个可能开始 HTML 的 `<`（后面紧跟字母、`/`、`!`、`?`）后面插一个
 *    WORD JOINER（U+2060，不可见、不断行）。marked 的所有 HTML 规则都要求 `<` 后面紧跟这几类字符，
 *    插进去以后整篇文字里就不会再有标签、注释或 HTML 块，不需要猜哪里是代码：在代码里它同样看不见，
 *    `#include <stdio.h>` 照常显示；复制时 `ForumMarkdown.vue` 把它从剪贴板里去掉。
 *    `<https://…>`、`<mailto:…>` 这种自动链接不含空格，本来就不可能是标签，原样保留。
 * 2. Typora 这类编辑器常写 `<img src="…" alt="…" style="zoom:33%">`（公开的旧帖里就有），
 *    代码块之外的 `<img>` 换成等价的 Markdown 图片 `![alt](src)`，属性只留 src 和 alt。
 * 3. 链接和图片的地址只放行 http(s)、mailto 和不带协议的站内地址；`javascript:`、`data:`、`vbscript:`
 *    等其它协议（包括写成实体、夹着控制字符的）前面加 `#`，变成页内锚点。引用式定义 `[x]: …` 同样处理。
 *    旧 Garage 前缀的图片地址（#346 之前写进库里的）读取时改成当前的 CDN 前缀，库里的内容不改。
 *
 * 4. 表情（#276）：代码之外的 `:yugc-wave:` 这类短码，只要在表情白名单里（`GET /api/forum/stickers`
 *    给的、启用中的），换成 `<img class="forum-sticker" alt="<名字>" title="[包名_名字]" src="<图片地址>">`。
 *    这一步在第 1 步之后做，插进去的标签不会被当成文字；地址只认 shared/sticker-url.ts 的白名单（站内按哈希的地址，
 *    或 CDN 开关打开时受控 CDN 上同一个哈希的地址，#286），名字按属性转义。
 *    不在白名单里的（停用的、拼错的）原样显示。服务端存的仍是短码。
 *    照 B 站的写法，`[极客娘_打招呼]` 这样的「[包名_名字]」也认：先换成短码再按上面处理，所以手打、粘贴、
 *    从别处复制来的都显示成表情；后面紧跟 `(`、`[`、`:` 的不换，那是 Markdown 的链接写法。
 *
 * TxMarkdownView 默认还会用 DOMPurify 清理一遍，这里是第一道；任何一道的默认值变了，另一道仍然挡着。
 * 写帖子的编辑器（PostEditor.vue）里别人的文字（回复时的引用、版主编辑别人的帖子）原样放进去，不另做转义；
 * 编辑器里表情显示成图片，进出编辑器时用 `stickersToImages` / `imagesToStickers` 在短码和图片之间换，
 * 「[包名_名字]」出编辑器时也换成短码。
 */

import { postLine } from '../app/utils/excerpt'
import { currentCdnUrl, isStickerUrl, STICKER_URL_PATTERN, stickerHash } from './sticker-url'

export const WORD_JOINER = '\u2060'

/** 白名单里的一个表情：短码（不带冒号）、名字、图片地址（同源或受控 CDN，见 shared/sticker-url.ts），和 B 站那样的写法 `[包名_名字]`。 */
export interface StickerRef {
  shortcode: string
  label: string
  url: string
  token?: string
}

/** 短码的写法与服务端 `STICKER_ID_PATTERN` 相同，两边用冒号包住。 */
const SHORTCODE = /:([a-z0-9][a-z0-9-]{1,39}):/g
/** 编辑器里的表情图片 `![名字](地址)` 或 `![名字](地址 "标题")`；地址只认 shared/sticker-url.ts 的白名单（同源或受控 CDN）。 */
const STICKER_IMAGE = new RegExp(`!\\[[^\\]\\n]*\\]\\((${STICKER_URL_PATTERN})(?:\\s+"[^"\\n]*")?\\)`, 'g')

/** `[包名_名字]`；后面紧跟 `(`、`[`、`:` 的是 Markdown 链接或引用，不算。 */
const TOKEN = /\[([^[\]\n]{1,64})\](?![([:])/g

const SAFE_SCHEMES = new Set(['http', 'https', 'mailto'])

/** 与 marked 同样的围栏：行首最多 3 个空格，3 个以上的 ` 或 ~；反引号围栏的信息串里不能再有反引号。 */
const FENCE_OPEN = /^ {0,3}(`{3,}(?=[^`]*$)|~{3,})/

/** `<` 后面是这些字符时，marked 可能把它当成 HTML 的开头。 */
const HTML_START = /<(?=[a-z/!?])/gi
/** 不含空白的 http(s)/mailto 自动链接，marked 只会把它当链接。粘性匹配，从每个 `<` 的位置试一次。 */
const AUTOLINK = /<(?:https?:\/\/|mailto:)[^\s<>]*>/iy

/** 行内链接与图片 `](dest`、引用式定义 `]: dest`（地址可以在下一行）。 */
const INLINE_DESTINATION = /(\]\(\s*<?)([^\s)>]*)/g
const DEFINITION_DESTINATION = /(\]:[ \t]*(?:\n[ \t]*)?<?)([^\s>]*)/g

export function renderableMarkdown(source: string, stickers?: ReadonlyMap<string, StickerRef>): string {
  const withImages = convertImgTags(source)
  const withSafeLinks = currentDestinations(withImages)
    .replace(INLINE_DESTINATION, neutralize)
    .replace(DEFINITION_DESTINATION, neutralize)
  const escaped = escapeHtmlStarts(withSafeLinks)
  if (!stickers?.size)
    return escaped
  const byToken = tokenIndex(stickers)
  return mapOutsideCode(escaped, text => withShortcodes(text, byToken).replace(SHORTCODE, (match, code: string) => stickerTag(stickers.get(code)) ?? match))
}

/** 短码换成的标签；地址不在表情图片白名单里时不换（返回 null，原样显示短码）。 */
function stickerTag(sticker: StickerRef | undefined): string | null {
  if (!sticker || !isStickerUrl(sticker.url))
    return null
  const title = sticker.token ? ` title="${escapeAttribute(sticker.token)}"` : ''
  return `<img class="forum-sticker" alt="${escapeAttribute(sticker.label)}"${title} src="${sticker.url}">`
}

/** B 站那样的写法：`[包名_名字]`。 */
export function stickerToken(packName: string, label: string): string {
  return `[${packName}_${label}]`
}

/** 按 `[包名_名字]` 查表情；同一个写法有两张时用排在前面的那张。 */
export function tokenIndex(stickers: ReadonlyMap<string, StickerRef>): Map<string, StickerRef> {
  const byToken = new Map<string, StickerRef>()
  for (const sticker of stickers.values()) {
    if (sticker.token && !byToken.has(sticker.token))
      byToken.set(sticker.token, sticker)
  }
  return byToken
}

/** 一段（代码之外的）文字里认得的 `[包名_名字]` 换成 `:短码:`。 */
function withShortcodes(text: string, byToken: ReadonlyMap<string, StickerRef>): string {
  return byToken.size ? text.replace(TOKEN, match => (byToken.has(match) ? `:${byToken.get(match)!.shortcode}:` : match)) : text
}

function escapeAttribute(value: string): string {
  return value.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}

/** 白名单按短码查：服务端给的表情包摊平成一张表，每张带上自己的 `[包名_名字]`。 */
export function stickerIndex(packs: ReadonlyArray<{ name?: string, stickers: ReadonlyArray<StickerRef> }>): Map<string, StickerRef> {
  return new Map(packs.flatMap(pack => pack.stickers.map(sticker => ({
    ...sticker,
    ...(pack.name ? { token: stickerToken(pack.name, sticker.label) } : {}),
  }))).map(sticker => [sticker.shortcode, sticker]))
}

/**
 * 旧 Garage 前缀的地址（#346 之前写进库里的旧帖与正文）改成当前 CDN 前缀，`](地址` 与 `]: 地址` 两种写法都换。
 * 只换前缀；渲染和进编辑器时都用，库里的文字不动。
 */
export function currentDestinations(source: string): string {
  return source
    .replace(INLINE_DESTINATION, (_match, lead: string, destination: string) => `${lead}${currentCdnUrl(destination)}`)
    .replace(DEFINITION_DESTINATION, (_match, lead: string, destination: string) => `${lead}${currentCdnUrl(destination)}`)
}

/** 进编辑器之前：代码之外白名单里的短码（和 `[包名_名字]`）换成 Markdown 图片，编辑时看到的就是表情。 */
export function stickersToImages(source: string, stickers: ReadonlyMap<string, StickerRef>): string {
  const current = currentDestinations(source)
  if (!stickers.size)
    return current
  const byToken = tokenIndex(stickers)
  return mapOutsideCode(current, text => withShortcodes(text, byToken).replace(SHORTCODE, (match, code: string) => {
    const sticker = stickers.get(code)
    return sticker && isStickerUrl(sticker.url) ? `![${sticker.label.replace(/[\\[\]]/g, '')}](${sticker.url})` : match
  }))
}

/** 从编辑器出来以后：表情图片和 `[包名_名字]` 换回短码，存进服务端的仍是 `:yugc-wave:`。认不出的原样留下。 */
export function imagesToStickers(source: string, stickers: ReadonlyMap<string, StickerRef>): string {
  if (!stickers.size)
    return source
  // 按内容哈希认，不按整条地址：同一张图的同源地址和 CDN 地址哈希相同，页面加载之后开关变了、
  // 或者从别处复制来另一种地址的图，都照样换回短码。
  const byHash = new Map<string, string>()
  for (const sticker of stickers.values()) {
    const hash = stickerHash(sticker.url)
    if (hash)
      byHash.set(hash, sticker.shortcode)
  }
  const byToken = tokenIndex(stickers)
  return mapOutsideCode(source, text => withShortcodes(text.replace(STICKER_IMAGE, (match, url: string) => {
    const code = byHash.get(stickerHash(url) ?? '')
    return code ? `:${code}:` : match
  }), byToken))
}

/** 回复框引用的摘要最多这么长。 */
export const QUOTE_LENGTH = 80

/** 引用一条回复时插入的文字（#276）：`> @用户名：那一帖的前 80 个字`。 */
export function replyQuote(excerpt: string, username?: string): string {
  return username ? `> @${username}：${excerpt}\n\n` : `> ${excerpt}\n\n`
}

/**
 * 点「引用」时插入的内容（ReplyComposer.vue）。
 * 引的是那一帖的一行文字（#156）：页面在列表里拿到的可能只有服务端截好的 `excerpt`。
 */
export function quoteDraft(post: { content?: string, excerpt?: string }, username?: string): string {
  return replyQuote(postLine(post, QUOTE_LENGTH), username)
}

function neutralize(match: string, lead: string, destination: string): string {
  return isUnsafeDestination(destination) ? `${lead}#${destination}` : match
}

/**
 * 地址里有协议且不在白名单里就算不安全。浏览器会先解码属性里的实体、忽略控制字符和空白再判断协议，
 * 这里照做，`java&#115;cript:`、`jav&#x09;ascript:`、`JaVaScRiPt:` 都拦得住。
 */
export function isUnsafeDestination(destination: string): boolean {
  const decoded = destination
    .replace(/\\(.)/g, '$1')
    .replace(/&#x([0-9a-f]+);?/gi, (_, hex: string) => String.fromCodePoint(Number.parseInt(hex, 16) % 0x110000))
    .replace(/&#(\d+);?/g, (_, dec: string) => String.fromCodePoint(Number(dec) % 0x110000))
    .replace(/&colon;/gi, ':')
    .replace(/&(?:tab|newline);/gi, '')
    // eslint-disable-next-line no-control-regex
    .replace(/[\u0000-\u0020\u007F-\u009F\u2060\u200B]/g, '')
    .toLowerCase()
  const scheme = /^([a-z][a-z0-9+.-]*):/.exec(decoded)?.[1]
  return scheme !== undefined && !SAFE_SCHEMES.has(scheme)
}

function escapeHtmlStarts(text: string): string {
  return text.replace(HTML_START, (match, offset: number) => {
    AUTOLINK.lastIndex = offset
    return AUTOLINK.test(text) ? match : `<${WORD_JOINER}`
  })
}

/**
 * 只在围栏代码块和同一行的行内代码之外换 `<img>`；判断错了也不影响安全（换不成的 `<img` 最后仍会被
 * 第 1 步当作文字），只影响代码里的 `<img>` 会不会被改写。
 */
function convertImgTags(source: string): string {
  return mapOutsideCode(source, text => text.replace(/<img\b[^>]*>/gi, imgToMarkdown))
}

/** 对围栏代码块和行内代码之外的文字做 `map`；表情短码与 `<img>` 改写共用。 */
function mapOutsideCode(source: string, map: (text: string) => string): string {
  let fence: string | null = null
  return source.split('\n').map((line) => {
    if (fence !== null) {
      if (new RegExp(`^ {0,3}${fence}[~\`]* *$`).test(line))
        fence = null
      return line
    }
    const open = FENCE_OPEN.exec(line)
    if (open) {
      fence = open[1] as string
      return line
    }
    return mapOutsideCodeSpans(line, map)
  }).join('\n')
}

function mapOutsideCodeSpans(line: string, map: (text: string) => string): string {
  let out = ''
  let plain = ''
  let index = 0
  while (index < line.length) {
    const char = line[index] as string
    if (char === '\\') {
      plain += line.slice(index, index + 2)
      index += 2
      continue
    }
    if (char === '`') {
      const run = /^`+/.exec(line.slice(index))?.[0] as string
      const close = findClosingRun(line, index + run.length, run.length)
      if (close >= 0) {
        out += map(plain) + line.slice(index, close + run.length)
        plain = ''
        index = close + run.length
        continue
      }
      plain += run
      index += run.length
      continue
    }
    plain += char
    index += 1
  }
  return out + map(plain)
}

function findClosingRun(line: string, from: number, length: number): number {
  const pattern = /`+/g
  pattern.lastIndex = from
  for (let match = pattern.exec(line); match; match = pattern.exec(line)) {
    if (match[0].length === length)
      return match.index
  }
  return -1
}

function imgToMarkdown(tag: string): string {
  const src = attribute(tag, 'src')
  if (!src || /[\s()<>]/.test(src) || isUnsafeDestination(src))
    return tag
  const alt = (attribute(tag, 'alt') ?? '').replace(/[\\[\]]/g, '\\$&').replace(/\s+/g, ' ')
  return `![${alt}](${src})`
}

function attribute(tag: string, name: string): string | undefined {
  const match = new RegExp(`\\s${name}\\s*=\\s*(?:"([^"]*)"|'([^']*)'|([^\\s"'>]+))`, 'i').exec(tag)
  return match ? (match[1] ?? match[2] ?? match[3]) : undefined
}

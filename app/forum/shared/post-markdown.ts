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
 *
 * TxMarkdownView 默认还会用 DOMPurify 清理一遍，这里是第一道；任何一道的默认值变了，另一道仍然挡着。
 * 编辑器里的别人的文字见下面的 `toEditor`。
 */

import { postExcerpt } from '../app/utils/excerpt'

export const WORD_JOINER = '\u2060'

const SAFE_SCHEMES = new Set(['http', 'https', 'mailto'])

/** 与 marked 同样的围栏：行首最多 3 个空格，3 个以上的 ` 或 ~；反引号围栏的信息串里不能再有反引号。 */
const FENCE_OPEN = /^ {0,3}(`{3,}(?=[^`]*$)|~{3,})/

/** 开始一个字符实体的 `&`：`&#60;`、`&#x3c;`、`&lt;` 这类。 */
const ENTITY_START = /&(?=#|[a-z][a-z0-9]*;)/gi
/** `toEditor` 插在 `<`、`&` 后面的 WORD JOINER。 */
const INSERTED_JOINER = new RegExp(`([<&])${WORD_JOINER}`, 'g')

/** `<` 后面是这些字符时，marked 可能把它当成 HTML 的开头。 */
const HTML_START = /<(?=[a-z/!?])/gi
/** 不含空白的 http(s)/mailto 自动链接，marked 只会把它当链接。粘性匹配，从每个 `<` 的位置试一次。 */
const AUTOLINK = /<(?:https?:\/\/|mailto:)[^\s<>]*>/iy

/** 行内链接与图片 `](dest`、引用式定义 `]: dest`（地址可以在下一行）。 */
const INLINE_DESTINATION = /(\]\(\s*<?)([^\s)>]*)/g
const DEFINITION_DESTINATION = /(\]:[ \t]*(?:\n[ \t]*)?<?)([^\s>]*)/g

export function renderableMarkdown(source: string): string {
  const withImages = convertImgTags(source)
  const withSafeLinks = withImages
    .replace(INLINE_DESTINATION, neutralize)
    .replace(DEFINITION_DESTINATION, neutralize)
  return escapeHtmlStarts(withSafeLinks)
}

/**
 * 放进 TxMarkdownEditor 的别人的文字：回复时的引用、版主编辑别人的帖子。编辑器每收到一次 modelValue，
 * 都用 marked + DOMPurify 的默认配置渲染到所见即所得层和预览层；这两层只是被 v-show 藏起来，一直在 DOM 里。
 * DOMPurify 默认放行 `<style>`、`<form>`、`<input>` 和 style 属性，一段 `<style>body{display:none}</style>`
 * 就能把整页藏掉。所以这里做上面的第 1 步，另外在开始一个字符实体的 `&` 后面也插 WORD JOINER：
 * `&lt;style&gt;` 在所见即所得层里显示成 `<style>` 这几个字，编辑器切回源码时原样写回字面的 `<`，
 * 下一次渲染就成了真的标签；插了以后它不再是实体，一直按文字显示。链接地址原样留给作者改；
 * 存回去之前用 `fromEditor` 去掉插进去的字符。
 */
export function toEditor(source: string): string {
  return escapeHtmlStarts(source).replace(ENTITY_START, `&${WORD_JOINER}`)
}

/**
 * 编辑器里的文字存回去之前去掉 `toEditor` 插的 WORD JOINER：只去掉紧跟在 `<`、`&` 后面的那些，作者自己写在
 * 别处的 U+2060（比如词语中间不许断行的地方）原样保留。存下来的正文显示时照常再过 `renderableMarkdown`。
 */
export function fromEditor(text: string): string {
  return text.replace(INSERTED_JOINER, '$1')
}

/** 回复框里预填的引用：被回复那一帖的一行摘要。摘要来自别人写的正文，同样先过 `toEditor`。 */
export function replyQuote(excerpt: string): string {
  return `> ${toEditor(excerpt)}\n\n`
}

/** 回复框引用的摘要最多这么长。 */
export const QUOTE_LENGTH = 80

/** 回复某一帖时回复框里预填的内容（ReplyComposer.vue）。 */
export function quoteDraft(post: { content: string }): string {
  return replyQuote(postExcerpt(post.content, QUOTE_LENGTH))
}

/** 点「编辑」时编辑器里的初始内容（PostCard.vue）；可能是别人的帖子（版主编辑）。 */
export function editDraft(post: { content: string }): string {
  return toEditor(post.content)
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
    return mapOutsideCodeSpans(line, text => text.replace(/<img\b[^>]*>/gi, imgToMarkdown))
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

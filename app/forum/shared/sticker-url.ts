/**
 * 表情图片地址的白名单（#286；#276 的同源规则上放行受控 CDN）。能写进 `src` 的表情图片地址只有两种：
 *
 *   同源      /api/forum/stickers/<64 位小写十六进制哈希>.webp
 *             服务端按内容哈希发，一年 immutable；CDN 开关关闭、站长在控制台上传的表情都走这里
 *   受控 CDN  https://cdn.crosery.com/yzgc/static/site/forum/stickers/<同样的哈希>.webp
 *             CDN 开关打开时仓库内置的表情走这里，同一张图只是前缀不同
 *
 * 旧 Garage 公开前缀（#295 到 #346 之间）写进过库里的旧帖与编辑中的正文，也认：它只是同一个哈希的另一种写法，
 * 读取渲染时改写成当前前缀（currentCdnUrl），不写库。
 *
 * 别的一律不进页面：别的域名、http、大小写不同的主机、路径穿越、`javascript:`、`data:`、查询串、片段、多一层目录。
 * 这条规则原来在 forum-api.ts、post-markdown.ts 和编辑器的 inline-stickers.ts 各写一份，现在三处都从这里取。
 * CDN 前缀是写死的常量，与 scripts/static-cdn-base.mjs 的 STATIC_CDN_BASE 加服务端清单的对象键前缀 `forum/stickers/`
 * 是同一个值，tests/tooling/static-cdn-parity.test.ts 逐字核对。
 */

/** 站内按内容哈希的表情图片地址前缀（服务端 routes/forum-api/stickers.ts）。 */
export const STICKER_SAME_ORIGIN_PREFIX = '/api/forum/stickers/'
/** 受控 CDN 的静态资源前缀（与 scripts/static-cdn-base.mjs 的 STATIC_CDN_BASE 一致）。 */
export const STATIC_CDN_PREFIX = 'https://cdn.crosery.com/yzgc/static/site/'
/** 受控 CDN 上表情图片的地址前缀。 */
export const STICKER_CDN_PREFIX = `${STATIC_CDN_PREFIX}forum/stickers/`
/**
 * 旧 Garage 公开前缀：只为认得库里已有的地址。新内容一律写当前前缀；这个前缀不进 CSP、不进任何构建参数。
 * 公开站点的所有静态地址都是 `<origin>/<对象键>`，旧前缀多一段桶名，所以两者的差别只在前缀上，哈希与文件名相同。
 */
export const LEGACY_STATIC_CDN_PREFIX = 'https://cdn.yangtzeu.work/geek-public/static/site/'
export const LEGACY_STICKER_CDN_PREFIX = `${LEGACY_STATIC_CDN_PREFIX}forum/stickers/`

const HASH_LENGTH = 64
const EXTENSION = '.webp'

function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\/]/g, '\\$&')
}

/** 不带 ^ 和 $ 的地址写法，嵌进别的正则（Markdown 图片 `![名字](地址)`）里用；整体是一个非捕获组。 */
export const STICKER_URL_PATTERN = `(?:${escapeRegExp(STICKER_SAME_ORIGIN_PREFIX)}|${escapeRegExp(STICKER_CDN_PREFIX)}|${escapeRegExp(LEGACY_STICKER_CDN_PREFIX)})[0-9a-f]{${HASH_LENGTH}}${escapeRegExp(EXTENSION)}`

const STICKER_URL = new RegExp(`^${STICKER_URL_PATTERN}$`)

/** 是不是白名单里的表情图片地址（含旧 Garage 前缀）。 */
export function isStickerUrl(value: unknown): value is string {
  return typeof value === 'string' && STICKER_URL.test(value)
}

/** 白名单地址里的 64 位内容哈希；不是表情图片地址返回 null。同一张图的同源地址、CDN 地址与旧前缀地址哈希相同。 */
export function stickerHash(value: unknown): string | null {
  return isStickerUrl(value) ? value.slice(value.length - EXTENSION.length - HASH_LENGTH, value.length - EXTENSION.length) : null
}

/**
 * 把旧 Garage 前缀换成当前前缀；别的地址原样返回。只换前缀，对象键的哈希与文件名不动。
 * 读取渲染时用（post-markdown.ts 的 Markdown 目的地与表情图片），不写库。
 */
export function currentCdnUrl(value: string): string {
  return value.startsWith(LEGACY_STATIC_CDN_PREFIX) ? `${STATIC_CDN_PREFIX}${value.slice(LEGACY_STATIC_CDN_PREFIX.length)}` : value
}

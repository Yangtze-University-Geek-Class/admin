// Pure text transforms for export-published.mjs: no filesystem, no network.
// The vitest suite drives them with fabricated documents, never the private snapshot.

/** Old forum addresses that meant "topic N": `/t/tN`, and absolute links to the old archive or topic pages. */
const OLD_TOPIC_URL = /^(?:https?:\/\/(?:www\.)?yangtzeu\.work)?\/(?:forum\/)?(?:archive\/)?t\/t?(\d+)\/?$/
/** Link texts the old forum filled in with its own page title; they say nothing about the target. */
const GENERIC_LINK_TEXT = /^\s*长江大学极客班(?:\s*[(（]\s*yangtzeu\.work\s*[)）])?\s*$/
const WITHHELD = '这篇没有公开'

/**
 * Markdown inline links and images, outside fenced code. `[text](target)` with
 * an optional leading `!`; the target stops at the first `)` or whitespace,
 * which is all the old forum ever wrote.
 */
const LINK = /(!?)\[([^\]\n]*)\]\(([^)\s]+)\)/g

/**
 * HTML images, outside fenced code: `<img src="…" …>` as Typora writes them
 * when a picture is scaled (`style="zoom:33%"`). They go through the same
 * image rules as Markdown images.
 */
const HTML_IMAGE = /<img\b[^>]*?\bsrc=(["'])([^"'\s]+)\1[^>]*>/gi

/**
 * Query parameters that identify whoever shared a link rather than the page:
 * B 站的 `vd_source`/`spm_id_from`、公众号的 `sharer_*`/`srcid`. They are
 * dropped; everything else (a video's `t=`, an article's `sn`) stays.
 */
const TRACKING = new Map([
  ['bilibili.com', ['vd_source', 'spm_id_from', 'share_source', 'share_medium', 'share_plat', 'share_session_id', 'share_tag', 'unique_k', 'from_spmid']],
  ['mp.weixin.qq.com', ['sharer_shareinfo', 'sharer_shareinfo_first', 'srcid']],
])

/**
 * A link as it should be published: gitee's outbound redirect
 * (`gitee.com/link?target=…`) becomes its target, and sharer-tracking
 * parameters are removed. Anything that is not an absolute http(s) URL, or
 * has nothing to clean, comes back unchanged.
 */
export function cleanUrl(target) {
  let url
  try {
    url = new URL(target)
  }
  catch {
    return target
  }
  if (url.protocol !== 'https:' && url.protocol !== 'http:')
    return target
  if (url.hostname === 'gitee.com' && url.pathname === '/link' && url.searchParams.get('target'))
    return cleanUrl(url.searchParams.get('target'))
  const host = [...TRACKING.keys()].find(domain => url.hostname === domain || url.hostname.endsWith(`.${domain}`))
  if (!host)
    return target
  const drop = TRACKING.get(host).filter(name => url.searchParams.has(name))
  if (!drop.length)
    return target
  for (const name of drop)
    url.searchParams.delete(name)
  return url.toString()
}

export function topicIdOf(target) {
  const match = OLD_TOPIC_URL.exec(target)
  return match ? `t${match[1]}` : null
}

/**
 * Applies `fn` to every line outside ``` fences; fence lines and code stay
 * untouched. A fence may open right after a list marker (`- ```cmd`), which
 * the old documents do inside numbered steps.
 */
function outsideFences(markdown, fn) {
  let inFence = false
  return markdown.split('\n').map((line) => {
    if (/^\s*(?:(?:[-*+]|\d+[.)])\s+)?(?:```|~~~)/.test(line)) {
      inFence = !inFence
      return line
    }
    return inFence ? line : fn(line)
  }).join('\n')
}

/** The text outside fences and inline code: what a reader sees rendered as images and links. */
function prose(markdown) {
  let inFence = false
  return markdown.split('\n').filter((line) => {
    if (/^\s*(?:(?:[-*+]|\d+[.)])\s+)?(?:```|~~~)/.test(line)) {
      inFence = !inFence
      return false
    }
    return !inFence
  }).map(line => line.replace(/`[^`\n]*`/g, '')).join('\n')
}

/**
 * Rewrites one topic's Markdown for the published forum.
 *
 * - Links to another published topic become relative (`./t9`): every topic
 *   page lives at `<base>t/<id>` and its Markdown twin at `<base>t/<id>.md`,
 *   so the link resolves under any base path. A link text that only repeats
 *   the old site title becomes the target's title.
 * - Links to a topic that is not published become plain text ending in
 *   「这篇没有公开」, so nobody lands on a 404.
 * - Other links into the old forum (`/c/…`, `/u/…`) lose the link and keep
 *   their text (none when it only repeated the old site title): those pages
 *   do not exist any more.
 * - Images, Markdown or HTML `<img src>`, go through `image(target)`, which
 *   returns the new relative path, `{ text }` to replace the image with a note
 *   in parentheses, or `null` to leave an external image as it is (listed in
 *   `externalImages`, so the review record counts every image).
 * - Other external links lose sharer-tracking parameters (`cleanUrl`).
 *
 * Returns the new Markdown and what was rewritten, for the review record.
 */
export function rewriteLinks(markdown, { titles, image }) {
  const report = { topicLinks: [], withheldLinks: [], unlinked: [], images: [], droppedImages: [], externalImages: [], cleanedLinks: [] }
  /** One image target → `null` (keep), `{ text }` (drop) or the local path, recorded in the report. */
  const imageTarget = (target, html) => {
    const local = image(target)
    if (local === null)
      report.externalImages.push({ from: target, html })
    else if (typeof local === 'object')
      report.droppedImages.push({ from: target, text: local.text, html })
    else
      report.images.push({ from: target, to: local, html })
    return local
  }
  const htmlImages = line => line.replace(HTML_IMAGE, (whole, quote, target) => {
    const local = imageTarget(target, true)
    if (local === null)
      return whole
    if (typeof local === 'object')
      return `（${local.text}）`
    return whole.replace(`${quote}${target}${quote}`, `${quote}${local}${quote}`)
  })
  const content = outsideFences(markdown, line => htmlImages(line).replace(LINK, (whole, bang, text, target) => {
    if (bang) {
      const local = imageTarget(target, false)
      if (local === null)
        return whole
      if (typeof local === 'object')
        return `（${local.text}）`
      return `![${text}](${local})`
    }
    const id = topicIdOf(target)
    if (id !== null) {
      const title = titles.get(id)
      if (title === undefined) {
        report.withheldLinks.push({ from: target, text })
        return GENERIC_LINK_TEXT.test(text) || text.trim() === '' ? WITHHELD : `${text}（${WITHHELD}）`
      }
      report.topicLinks.push({ from: target, to: id })
      return `[${GENERIC_LINK_TEXT.test(text) || text.trim() === '' ? title : text}](./${id})`
    }
    if (target.startsWith('/') && !target.startsWith('//')) {
      report.unlinked.push({ from: target, text })
      return GENERIC_LINK_TEXT.test(text) ? '' : text
    }
    const cleaned = cleanUrl(target)
    if (cleaned === target)
      return whole
    report.cleanedLinks.push({ from: target, to: cleaned })
    return `[${text}](${cleaned})`
  }))
  return { content, report }
}

/**
 * Replaces each pattern the exact number of times the manifest expects. A
 * count that does not match means the source changed under the manifest, so
 * the export stops instead of publishing a half-redacted document.
 */
export function applyRedactions(markdown, redactions, topicId) {
  let content = markdown
  for (const { pattern, replacement, count } of redactions) {
    const regex = new RegExp(pattern, 'g')
    const found = content.match(regex)?.length ?? 0
    if (found !== count)
      throw new Error(`${topicId}：替换规则 ${JSON.stringify(pattern)} 应命中 ${count} 次，实际 ${found} 次`)
    content = content.replace(regex, replacement)
  }
  return content
}

/**
 * Leftovers that must never reach the published files: old asset routes and
 * paths, links back into the old archive, e-mail addresses and anything that
 * looks like a login written out in the text. Returns the problems found.
 */
export function publishedProblems(markdown) {
  const problems = []
  if (markdown.includes('/api/local-forum/'))
    problems.push('还有旧论坛的资产地址 /api/local-forum/')
  if (/\]\((?:\.\/)?bbs\//.test(markdown))
    problems.push('还有旧论坛的 bbs/ 相对图片')
  // Every image a reader sees is either one of ours or an https original; code samples that
  // show the syntax (`![描述](图片的链接)` in a fence) are not images.
  const visible = prose(markdown)
  if (/!\[[^\]\n]*\]\((?!https:\/\/|\.\.\/published\/)/.test(visible))
    problems.push('有图片既不是导出的站内图，也不是 https 外链')
  if (/<img\b[^>]*?\bsrc=(["'])(?!https:\/\/|\.\.\/published\/)/i.test(visible))
    problems.push('有 HTML 图片既不是导出的站内图，也不是 https 外链')
  if (/yangtzeu\.work\/forum\/archive/.test(markdown))
    problems.push('还有指回旧论坛归档的地址')
  if (/[\w.+-]+@[\w-]+\.[\w.]+/.test(markdown))
    problems.push('有邮箱地址')
  if (/(?:账户|账号)\s*\**\s*[:：]/.test(markdown))
    problems.push('有写出来的账户')
  if (/(?:密码|提取码)\s*\**\s*[:：]\s*\w/.test(markdown))
    problems.push('有写出来的密码或提取码')
  return problems
}

#!/usr/bin/env node
/**
 * 论坛页面的 CSP：站点的策略 + 本次构建里每段内联脚本的 sha256。
 *
 * `nuxt generate` 的 HTML 里有内联脚本（入口 importmap、配色脚本、`window.__NUXT__` 配置），
 * 站点 CSP 的 `script-src 'self'` 会把它们全拦下，论坛白屏（#78）。这里不放宽成 'unsafe-inline'，
 * 而是在镜像构建时扫一遍产物，把这几段的哈希加进 script-src，写成论坛容器 nginx 的 add_header。
 * 站点策略只从宿主 nginx 模板（deploy/nginx/production.conf）读一份，不另写第二份。
 *
 * 用法（论坛镜像构建阶段）：
 *   node scripts/csp-header.mjs --html .output/public --site-conf /repo/deploy/nginx/production.conf --out /nginx-out/conf.d/00-csp.conf
 */
import { createHash } from 'node:crypto'
import { readdirSync, readFileSync, realpathSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'

/** 不会被执行的脚本类型：数据块不受 script-src 约束，不用算哈希。 */
const DATA_TYPES = new Set(['application/json', 'application/ld+json'])

/**
 * 一段 HTML 里所有内联可执行脚本（含 importmap）的 `'sha256-…'`，按出现顺序去重。
 * 认不准就直接失败，不猜：脚本标签数与认出来的脚本数对不上、正文里有 CR（浏览器会先把 CRLF 换成 LF
 * 再算哈希，这里算出来的就对不上）都会报错，构建随之失败，不会生成一份放行了错误脚本的策略。
 */
export function inlineScriptHashes(html) {
  const hashes = []
  const elements = [...html.matchAll(/<script(?=[\s/>])([^>]*)>([\s\S]*?)<\/script\s*>/gi)]
  const openTags = html.match(/<script(?=[\s/>])/gi)?.length ?? 0
  if (openTags !== elements.length)
    throw new Error(`HTML 里有 ${openTags} 个 <script> 开始标签，只认出 ${elements.length} 段完整脚本`)
  for (const [, attributes, body] of elements) {
    // 属性值里带 > 时，上面的 [^>]* 会在引号中间截断，引号就成了单数。
    if ((attributes.split('"').length - 1) % 2 || (attributes.split("'").length - 1) % 2)
      throw new Error(`认不准这个 <script> 开始标签的属性：<script${attributes}>`)
    if (/(?:^|\s)src\s*=/i.test(attributes)) continue
    const type = (/(?:^|\s)type\s*=\s*["']?([^"'\s>]+)/i.exec(attributes)?.[1] ?? '').toLowerCase()
    if (DATA_TYPES.has(type)) continue
    if (body.includes('\r')) throw new Error('内联脚本里有 CR 换行，浏览器算哈希前会改写它，无法按原文放行')
    const hash = `'sha256-${createHash('sha256').update(body, 'utf8').digest('base64')}'`
    if (!hashes.includes(hash)) hashes.push(hash)
  }
  return hashes
}

/** 从宿主 nginx 模板里取站点 CSP（map 的 default 分支）。 */
export function siteCsp(confText) {
  const policy = /^\s*default\s+"(default-src [^"]+)";\s*$/m.exec(confText)?.[1]
  if (!policy) throw new Error('宿主 nginx 模板里找不到站点 CSP（map 的 default 分支）')
  return policy
}

/** 把哈希加进 script-src；策略里没有 script-src 就失败（不能悄悄变成只靠 default-src）。 */
export function withScriptHashes(policy, hashes) {
  const directives = policy.split(';').map(part => part.trim()).filter(Boolean)
  const index = directives.findIndex(part => part.startsWith('script-src '))
  if (index < 0) throw new Error('站点 CSP 没有 script-src')
  if (/'unsafe-inline'/.test(directives[index])) throw new Error("站点 CSP 的 script-src 不能含 'unsafe-inline'")
  const [name, ...sources] = directives[index].split(/\s+/)
  directives[index] = [name, ...sources, ...hashes].join(' ')
  return directives.join('; ')
}

function htmlFiles(dir) {
  return readdirSync(dir, { withFileTypes: true }).flatMap(entry => {
    const path = join(dir, entry.name)
    if (entry.isDirectory()) return htmlFiles(path)
    return entry.isFile() && entry.name.endsWith('.html') ? [path] : []
  })
}

/** 扫产物目录下所有 HTML，返回合并后的哈希与最终策略。 */
export function buildForumCsp({ htmlDir, siteConf }) {
  const files = htmlFiles(htmlDir)
  if (!files.length) throw new Error(`${htmlDir} 下没有 HTML`)
  const hashes = []
  for (const file of files) {
    for (const hash of inlineScriptHashes(readFileSync(file, 'utf8'))) if (!hashes.includes(hash)) hashes.push(hash)
  }
  return { files: files.length, hashes, policy: withScriptHashes(siteCsp(readFileSync(siteConf, 'utf8')), hashes) }
}

function isDirectRun() {
  try {
    return Boolean(process.argv[1]) && pathToFileURL(realpathSync(resolve(process.argv[1]))).href === import.meta.url
  }
  catch {
    return false
  }
}
if (isDirectRun()) {
  const args = process.argv.slice(2)
  const option = name => {
    const value = args[args.indexOf(name) + 1]
    if (!args.includes(name) || !value) throw new Error(`缺少 ${name}`)
    return value
  }
  const { files, hashes, policy } = buildForumCsp({ htmlDir: option('--html'), siteConf: option('--site-conf') })
  writeFileSync(option('--out'), [
    '# 由 app/forum/scripts/csp-header.mjs 在镜像构建时生成：站点 CSP + 本次产物内联脚本的 sha256。',
    `add_header Content-Security-Policy "${policy}" always;`,
    '',
  ].join('\n'))
  console.log(`论坛 CSP：扫描 ${files} 个 HTML，放行 ${hashes.length} 段内联脚本（按哈希）。`)
}

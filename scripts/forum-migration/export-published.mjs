#!/usr/bin/env node
// Exports the topics listed in app/forum/content/published/manifest.json from the private
// snapshot into files that may be committed: app/forum/content/published/topics.json and the
// images under app/forum/public/published/. No environment-file reads.
//
//   node scripts/forum-migration/export-published.mjs .tools/forum-runtime/<snapshot> [--fetch]
//
// Offline by default. External images that the manifest edits (covers a bookmark bar, crops a
// window) are read from <snapshot>/external/<sha256>; `--fetch` downloads the missing ones once
// and checks them against the SHA-256 in the manifest. Running it again on the same snapshot
// writes the same bytes. The review record (what was rewritten, per topic) goes to stdout,
// never into the repository.
import { createRequire } from 'node:module'
import { createHash } from 'node:crypto'
import { chmodSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { applyRedactions, publishedProblems, rewriteLinks } from './published-transform.mjs'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..')
const snapshotDir = resolve(process.argv[2] ?? '')
const fetchMissing = process.argv.includes('--fetch')
if (!snapshotDir.startsWith(`${root}/.tools/forum-runtime/`))
  throw new Error('快照目录必须在 .tools/forum-runtime/ 下（私有，不入库）')
const manifestPath = resolve(root, 'app/forum/content/published/manifest.json')
const outputPath = resolve(root, 'app/forum/content/published/topics.json')
const imageDir = resolve(root, 'app/forum/public/published')
const sharp = createRequire(resolve(root, 'app/server/package.json'))('sharp')

const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'))
const snapshot = JSON.parse(readFileSync(resolve(snapshotDir, 'content.json'), 'utf8'))
const assetIndex = JSON.parse(readFileSync(resolve(snapshotDir, 'asset-index.json'), 'utf8'))
if (manifest.source !== snapshotDir.split('/').pop())
  throw new Error(`manifest.source 是 ${manifest.source}，传入的快照是 ${snapshotDir.split('/').pop()}`)

const state = snapshot.state
const topicsById = new Map(state.topics.map(topic => [topic.id, topic]))
const titles = new Map(manifest.topics.map(({ id }) => {
  const topic = topicsById.get(id)
  if (!topic)
    throw new Error(`快照里没有话题 ${id}`)
  return [id, topic.title]
}))
for (const id of manifest.withheld) {
  if (titles.has(id))
    throw new Error(`${id} 同时在 topics 和 withheld 里`)
}

// Per-image rules, keyed by the exact target written in the old Markdown: `drop` replaces the
// image with a note; `cover` paints rectangles (source pixels) and `crop` trims edges before
// encoding. An external image with edits needs its `sha256` so the export stays reproducible.
const rules = new Map((manifest.images ?? []).map(rule => [rule.source, rule]))
const usedRules = new Set()
const externalDir = resolve(snapshotDir, 'external')

async function externalOriginal(rule) {
  if (!/^[a-f0-9]{64}$/.test(rule.sha256 ?? ''))
    throw new Error(`外链图片 ${rule.source} 要编辑，清单里必须写它的 sha256`)
  const file = resolve(externalDir, rule.sha256)
  if (!existsSync(file)) {
    if (!fetchMissing)
      throw new Error(`没有 ${rule.source} 的本机原图，加 --fetch 下载一次`)
    const response = await fetch(rule.source)
    if (!response.ok)
      throw new Error(`下载 ${rule.source} 失败：HTTP ${response.status}`)
    const bytes = Buffer.from(await response.arrayBuffer())
    const actual = createHash('sha256').update(bytes).digest('hex')
    if (actual !== rule.sha256)
      throw new Error(`${rule.source} 的内容变了：清单写 ${rule.sha256}，下载到 ${actual}`)
    mkdirSync(externalDir, { recursive: true, mode: 0o700 })
    writeFileSync(file, bytes, { mode: 0o600 })
    chmodSync(file, 0o600)
  }
  const bytes = readFileSync(file)
  if (createHash('sha256').update(bytes).digest('hex') !== rule.sha256)
    throw new Error(`本机原图 ${file} 与清单里的 sha256 不一致`)
  return bytes
}

/** Old asset reference → snapshot asset entry, or null for an external image. */
function snapshotAsset(target) {
  const direct = /^\/api\/local-forum\/assets\/([a-f0-9]{64})$/.exec(target)
  const hash = direct ? direct[1] : assetIndex.aliases?.[`legacy/${target}`]
  if (!hash)
    return null
  const entry = assetIndex.assets[hash]
  if (!entry)
    throw new Error(`资产索引里没有 ${hash}`)
  return entry
}

/** Applies a rule's covers (in source pixels) and then its crop. */
async function edited(source, rule) {
  let buffer = source
  if (rule?.cover?.length) {
    const layers = rule.cover.map(([left, top, width, height]) => ({
      input: { create: { width, height, channels: 3, background: '#e5e7eb' } },
      left,
      top,
    }))
    buffer = await sharp(buffer).composite(layers).png().toBuffer()
  }
  if (rule?.crop) {
    const { width, height } = await sharp(buffer).metadata()
    const { top = 0, right = 0, bottom = 0, left = 0 } = rule.crop
    buffer = await sharp(buffer).extract({ left, top, width: width - left - right, height: height - top - bottom }).png().toBuffer()
  }
  return buffer
}

// Images are re-encoded once per source: at most 1600 px wide, lossy WebP. The name is the
// SHA-256 prefix of the encoded bytes, so a changed image never reuses a cached name.
const encoded = new Map()
async function encode(key, source, { mime, rule }) {
  if (encoded.has(key))
    return encoded.get(key)
  const input = await edited(source, rule)
  const image = sharp(input, { limitInputPixels: 40_000_000, animated: false, failOn: 'error' })
  const lossy = await image.resize({ width: 1600, withoutEnlargement: true }).webp({ quality: 72, effort: 6 }).toBuffer()
  // A small lossless WebP can come out larger when re-encoded; keep the original then.
  const bytes = !rule && mime === 'image/webp' && source.length <= lossy.length ? source : lossy
  const name = `${createHash('sha256').update(bytes).digest('hex').slice(0, 16)}.webp`
  const result = { name, bytes, sourceBytes: source.length }
  encoded.set(key, result)
  return result
}

/** What to do with one image target: `{ drop }`, a local file to encode, or null (leave it). */
function imagePlan(target) {
  const rule = rules.get(target)
  if (rule)
    usedRules.add(target)
  if (rule?.drop)
    return { drop: rule.drop }
  const entry = snapshotAsset(target)
  if (entry) {
    return { key: entry.sha256, rule, mime: entry.mime, read: async () => {
      const source = readFileSync(resolve(snapshotDir, 'assets', entry.file))
      if (createHash('sha256').update(source).digest('hex') !== entry.sha256)
        throw new Error(`资产 ${entry.file} 与索引里的 SHA-256 不一致`)
      return source
    } }
  }
  if (rule)
    return { key: rule.sha256, rule, mime: '', read: () => externalOriginal(rule) }
  return null
}

const record = []
const topics = []
for (const item of manifest.topics) {
  const topic = topicsById.get(item.id)
  const body = state.posts.filter(post => post.topicId === item.id && post.isTopicBody)
  if (body.length !== 1)
    throw new Error(`${item.id} 应有且只有一篇首帖，实际 ${body.length}`)
  const redacted = applyRedactions(body[0].content, manifest.redactions.filter(r => r.topic === item.id), item.id)

  // First pass collects the images to encode; the second writes their new paths.
  const pending = new Map()
  rewriteLinks(redacted, { titles, image: (target) => {
    const plan = imagePlan(target)
    if (plan && !plan.drop)
      pending.set(target, plan)
    return null
  } })
  const paths = new Map()
  for (const [target, plan] of pending)
    paths.set(target, `../published/${(await encode(plan.key, await plan.read(), plan)).name}`)
  const { content, report } = rewriteLinks(redacted, { titles, image: (target) => {
    const plan = imagePlan(target)
    if (!plan)
      return null
    return plan.drop ? { text: plan.drop } : paths.get(target)
  } })

  const problems = publishedProblems(content)
  if (problems.length)
    throw new Error(`${item.id} 导出后还有问题：${problems.join('；')}`)
  record.push({ id: item.id, title: topic.title, redactions: manifest.redactions.filter(r => r.topic === item.id).length, ...report })
  topics.push({
    id: topic.id,
    slug: topic.slug,
    title: topic.title,
    categoryId: item.categoryId,
    tagIds: item.tagIds,
    pinned: item.pinned,
    createdAt: body[0].createdAt,
    // Replies are not published, so the last activity is the opening post.
    lastActivityAt: body[0].createdAt,
    views: topic.views,
    content,
  })
}

const unused = [...rules.keys()].filter(source => !usedRules.has(source))
if (unused.length)
  throw new Error(`清单里的图片规则没有对应的图片：${unused.join('、')}`)

const output = {
  $comment: '由 scripts/forum-migration/export-published.mjs 从私有快照生成，不要手改；要改内容先改同目录的 manifest.json 再重新导出。',
  schemaVersion: 1,
  source: manifest.source,
  capturedAt: snapshot.capturedAt,
  author: manifest.author,
  topics,
}
writeFileSync(outputPath, `${JSON.stringify(output, null, 2)}\n`)
mkdirSync(imageDir, { recursive: true })
const keep = new Set([...encoded.values()].map(image => image.name))
for (const name of existsSync(imageDir) ? readdirSync(imageDir) : []) {
  if (!keep.has(name))
    rmSync(resolve(imageDir, name))
}
for (const image of encoded.values())
  writeFileSync(resolve(imageDir, image.name), image.bytes)

console.log(JSON.stringify({
  topics: record,
  images: [...encoded.values()].map(({ name, bytes, sourceBytes }) => ({ name, bytes: bytes.length, sourceBytes })),
}, null, 2))

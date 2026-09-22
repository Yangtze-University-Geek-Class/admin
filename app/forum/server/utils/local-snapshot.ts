import type { H3Event } from 'h3'
import type { Curation } from '../../shared/local-curation'
import type { AssetEntry, AssetIndex, SnapshotDocument } from '../../shared/local-snapshot'
import { readFile, stat } from 'node:fs/promises'
import { basename, join, resolve, sep } from 'node:path'
import { applyCuration, parseCuration } from '../../shared/local-curation'
import { parseAssetIndex, parseSnapshotDocument, parseSnapshotState, SnapshotError, summarize } from '../../shared/local-snapshot'

/** Nitro server-assets mount of `app/forum/content/` (see nuxt.config.ts). */
const CONTENT_ASSETS = 'assets:content'
const CONTENT_FILE = /^posts\/[a-z0-9-]+\.md$/

/**
 * Loads the private read-only snapshot directory named by
 * `GEEK_FORUM_CONTENT_DIR` (runtimeConfig.geekForumContentDir). The directory
 * is never inside the repository; without the variable the forum stays in
 * upstream demo mode and the local-forum routes answer 404.
 *
 * Parsed once per server process. A failed load is not cached, so fixing the
 * files and reloading the page is enough. Error messages name files by their
 * base name only; the configured directory never appears in a response.
 */

export interface LoadedSnapshot {
  dir: string
  assetsDir: string
  document: SnapshotDocument
  assets: AssetIndex
}

let pending: Promise<LoadedSnapshot> | null = null

export function snapshotDirectory(): string {
  return String(useRuntimeConfig().geekForumContentDir ?? '').trim()
}

export function snapshotConfigured(): boolean {
  return snapshotDirectory() !== ''
}

/**
 * Common gate for the local-forum routes: dev server only, GET/HEAD only,
 * never cached, 404 unless a snapshot directory is configured.
 */
export function requireSnapshotRoute(event: H3Event): void {
  if (!import.meta.dev)
    throw createError({ statusCode: 404, statusMessage: 'Not Found' })
  if (event.method !== 'GET' && event.method !== 'HEAD') {
    setHeader(event, 'Allow', 'GET, HEAD')
    throw createError({ statusCode: 405, statusMessage: 'Method Not Allowed', data: { error: 'method_not_allowed' } })
  }
  setHeader(event, 'Cache-Control', 'no-store')
  setHeader(event, 'X-Content-Type-Options', 'nosniff')
  if (!snapshotConfigured())
    throw createError({ statusCode: 404, statusMessage: 'Not Found', data: { error: 'local_snapshot_not_configured' } })
}

export function loadLocalSnapshot(): Promise<LoadedSnapshot> {
  if (!pending) {
    pending = load().catch((error: unknown) => {
      pending = null
      throw error
    })
  }
  return pending
}

/** Absolute path of an indexed asset, or `null` if it would escape the assets directory. */
export function assetFilePath(snapshot: LoadedSnapshot, entry: AssetEntry): string | null {
  const file = resolve(snapshot.assetsDir, entry.file)
  return file.startsWith(snapshot.assetsDir + sep) ? file : null
}

/** Maps loader failures to an HTTP error that carries a machine code and no filesystem detail. */
export function snapshotHttpError(error: unknown) {
  if (error instanceof SnapshotError)
    return createError({ statusCode: 503, statusMessage: 'Snapshot Invalid', data: { error: error.code, message: error.message } })
  console.error('[local-forum] snapshot unavailable:', error instanceof Error ? error.message : error)
  return createError({ statusCode: 503, statusMessage: 'Snapshot Unavailable', data: { error: 'snapshot_unavailable', message: '快照目录不可读，请查看 dev.log' } })
}

async function load(): Promise<LoadedSnapshot> {
  const dir = resolve(snapshotDirectory())
  const assetsDir = join(dir, 'assets')
  const [content, index, assetsStat] = await Promise.all([
    readJson(join(dir, 'content.json')),
    readJson(join(dir, 'asset-index.json')),
    stat(assetsDir).catch(() => null),
  ])
  if (!assetsStat?.isDirectory())
    throw new SnapshotError('invalid_asset_index', '快照目录缺少 assets/ 子目录')
  const raw = parseSnapshotDocument(content)
  // The editorial layer (archive category, new-era categories, polished
  // bodies) is versioned in app/forum/content/; the result is validated
  // again so a bad curation fails the load, not the pages.
  const state = parseSnapshotState(applyCuration(raw.state, await loadCuration()))
  return {
    dir,
    assetsDir,
    document: { capturedAt: raw.capturedAt, summary: summarize(state), state },
    assets: parseAssetIndex(index),
  }
}

async function loadCuration(): Promise<Curation> {
  const storage = useStorage(CONTENT_ASSETS)
  let document: unknown
  try {
    document = JSON.parse(await readContentAsset(storage, 'curation.json'))
  }
  catch (error) {
    if (error instanceof SnapshotError)
      throw error
    throw new SnapshotError('invalid_document', '不是合法 JSON：curation.json')
  }
  // `contentFile` keeps long Markdown bodies out of the JSON; resolve them here
  // so the pure parser only ever sees `content`.
  if (isRecord(document) && isRecord(document.posts)) {
    for (const [id, entry] of Object.entries(document.posts)) {
      if (!isRecord(entry) || typeof entry.contentFile !== 'string')
        continue
      if (!CONTENT_FILE.test(entry.contentFile))
        throw new SnapshotError('invalid_document', `curation.posts.${id} 的 contentFile 只能是 posts/<name>.md`)
      entry.content = await readContentAsset(storage, entry.contentFile)
      delete entry.contentFile
    }
  }
  return parseCuration(document)
}

async function readContentAsset(storage: ReturnType<typeof useStorage>, key: string): Promise<string> {
  const value = await storage.getItemRaw(key)
  if (typeof value === 'string')
    return value
  if (value instanceof Uint8Array)
    return Buffer.from(value).toString('utf8')
  throw new SnapshotError('invalid_document', `编辑层资源缺失：${key}`)
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

async function readJson(file: string): Promise<unknown> {
  const text = await readFile(file, 'utf8').catch(() => {
    throw new SnapshotError('invalid_document', `快照文件缺失或不可读：${basename(file)}`)
  })
  try {
    return JSON.parse(text)
  }
  catch {
    throw new SnapshotError('invalid_document', `不是合法 JSON：${basename(file)}`)
  }
}

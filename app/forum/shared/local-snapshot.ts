import type { Category, ForumState, Post, Topic, User } from '../app/data/types'
import { isUserTitle } from '../app/data/titles'

/**
 * Read-only local snapshot of the 极客班 forum archive.
 *
 * `scripts/forum-migration/prepare.py` and `normalize-assets.mjs` turn the
 * private SQLite backup into `content.json` + `asset-index.json` + `assets/`
 * inside a directory that stays outside version control. The Nitro routes
 * under `server/routes/api/local-forum/` serve that directory and the client
 * plugin hydrates the Pinia store from it; both sides validate through the
 * parsers here so a broken or foreign file fails loudly instead of silently
 * falling back to the upstream demo seed.
 *
 * Nuxt-free and filesystem-free on purpose: the vitest suite feeds these
 * functions fabricated documents, never the real backup.
 */

export const SNAPSHOT_SCHEMA_VERSION = 1
export const SNAPSHOT_MODE = 'local-snapshot'
export const SNAPSHOT_STATE_VERSION = 1
export const ASSET_ROUTE_PREFIX = '/api/local-forum/assets/'

/** Media the asset route will serve. SVG is deliberately absent. */
export const ASSET_MIME_ALLOWLIST: ReadonlySet<string> = new Set([
  'image/webp',
  'image/png',
  'image/jpeg',
  'image/gif',
  'video/mp4',
  'text/plain',
  'text/plain; charset=utf-8',
])

export type SnapshotErrorCode = 'invalid_document' | 'invalid_state' | 'invalid_asset_index'

export class SnapshotError extends Error {
  readonly code: SnapshotErrorCode

  constructor(code: SnapshotErrorCode, message: string) {
    super(message)
    this.name = 'SnapshotError'
    this.code = code
  }
}

export interface SnapshotSummary {
  users: number
  categories: number
  topics: number
  /** Posts that are not a topic's opening body. */
  replies: number
  archivedTopics: number
}

export interface SnapshotDocument {
  /** ISO-8601 capture time of the source database, as recorded by prepare.py. */
  capturedAt: string
  summary: SnapshotSummary
  state: ForumState
}

export interface AssetEntry {
  hash: string
  /** File name inside the snapshot's `assets/` directory; always `<hash>[.ext]`. */
  file: string
  mime: string
  bytes: number
  disposition: 'inline' | 'attachment'
}

export interface AssetIndex {
  assets: ReadonlyMap<string, AssetEntry>
  /** Original attachment path -> hash, kept for future legacy-link support. */
  aliases: ReadonlyMap<string, string>
}

const HASH = /^[a-f0-9]{64}$/
const ASSET_FILE = /^[a-f0-9]{64}(?:\.[a-z0-9]{1,8})?$/
const STATE_ARRAYS = ['users', 'categories', 'tags', 'topics', 'posts', 'notifications', 'bookmarks', 'follows'] as const
const COUNTERS = ['topic', 'post', 'notification', 'tag'] as const
const ROLES = new Set(['admin', 'moderator', 'member'])

export function isAssetHash(value: string): boolean {
  return HASH.test(value)
}

/** What the store holds while the snapshot is being fetched: nothing, not the demo seed. */
export function emptyForumState(): ForumState {
  return {
    version: SNAPSHOT_STATE_VERSION,
    seededAt: 0,
    counters: { topic: 0, post: 0, notification: 0, tag: 0 },
    users: [],
    categories: [],
    tags: [],
    topics: [],
    posts: [],
    notifications: [],
    bookmarks: [],
    follows: [],
  }
}

export function parseSnapshotDocument(raw: unknown): SnapshotDocument {
  if (!isRecord(raw))
    throw new SnapshotError('invalid_document', '快照文件不是 JSON 对象')
  if (raw.schemaVersion !== SNAPSHOT_SCHEMA_VERSION)
    throw new SnapshotError('invalid_document', `快照 schemaVersion 必须为 ${SNAPSHOT_SCHEMA_VERSION}`)
  if (raw.mode !== SNAPSHOT_MODE)
    throw new SnapshotError('invalid_document', `快照 mode 必须为 ${SNAPSHOT_MODE}`)
  if (typeof raw.capturedAt !== 'string' || Number.isNaN(Date.parse(raw.capturedAt)))
    throw new SnapshotError('invalid_document', '快照缺少有效的 capturedAt 时间')
  const state = parseSnapshotState(raw.state)
  return { capturedAt: raw.capturedAt, summary: summarize(state), state }
}

/**
 * Structural and referential validation of a projected `ForumState`. The
 * pages index entities by id, username and slug and never guard against a
 * dangling reference, so anything that would leave a page rendering a hole
 * is rejected here.
 */
export function parseSnapshotState(raw: unknown): ForumState {
  if (!isRecord(raw) || raw.version !== SNAPSHOT_STATE_VERSION)
    throw new SnapshotError('invalid_state', `state.version 必须为 ${SNAPSHOT_STATE_VERSION}`)
  if (!isNonNegative(raw.seededAt))
    throw new SnapshotError('invalid_state', 'state.seededAt 必须是非负数字')
  const counters = raw.counters
  if (!isRecord(counters) || COUNTERS.some(key => !isNonNegative(counters[key])))
    throw new SnapshotError('invalid_state', 'state.counters 缺少 topic/post/notification/tag 计数')
  for (const key of STATE_ARRAYS) {
    if (!Array.isArray(raw[key]))
      throw new SnapshotError('invalid_state', `state.${key} 必须是数组`)
  }

  const users = (raw.users as unknown[]).map(validateUser)
  const categories = (raw.categories as unknown[]).map(validateCategory)
  const topics = (raw.topics as unknown[]).map(validateTopic)
  const posts = (raw.posts as unknown[]).map(validatePost)

  const userIds = uniqueIds(users.map(user => user.id), 'users.id')
  uniqueIds(users.map(user => user.username), 'users.username')
  const categoryIds = uniqueIds(categories.map(category => category.id), 'categories.id')
  uniqueIds(categories.map(category => category.slug), 'categories.slug')
  const topicIds = uniqueIds(topics.map(topic => topic.id), 'topics.id')
  uniqueIds(topics.map(topic => topic.slug), 'topics.slug')
  uniqueIds(posts.map(post => post.id), 'posts.id')

  for (const topic of topics) {
    if (!categoryIds.has(topic.categoryId))
      throw new SnapshotError('invalid_state', `话题 ${topic.id} 引用了不存在的分类 ${topic.categoryId}`)
    if (!userIds.has(topic.authorId))
      throw new SnapshotError('invalid_state', `话题 ${topic.id} 引用了不存在的作者 ${topic.authorId}`)
  }
  const topicsWithPosts = new Set<string>()
  for (const post of posts) {
    if (!topicIds.has(post.topicId))
      throw new SnapshotError('invalid_state', `帖子 ${post.id} 引用了不存在的话题 ${post.topicId}`)
    if (!userIds.has(post.authorId))
      throw new SnapshotError('invalid_state', `帖子 ${post.id} 引用了不存在的作者 ${post.authorId}`)
    topicsWithPosts.add(post.topicId)
  }
  for (const topic of topics) {
    if (!topicsWithPosts.has(topic.id))
      throw new SnapshotError('invalid_state', `话题 ${topic.id} 没有任何帖子`)
  }

  return raw as unknown as ForumState
}

export function parseAssetIndex(raw: unknown): AssetIndex {
  if (!isRecord(raw) || !isRecord(raw.assets))
    throw new SnapshotError('invalid_asset_index', 'asset-index.json 缺少 assets 映射')
  const assets = new Map<string, AssetEntry>()
  for (const [hash, value] of Object.entries(raw.assets)) {
    if (!HASH.test(hash))
      throw new SnapshotError('invalid_asset_index', `资产键不是 SHA-256：${hash}`)
    if (!isRecord(value))
      throw new SnapshotError('invalid_asset_index', `资产 ${hash} 不是对象`)
    const { sha256, file, mime, bytes, disposition } = value
    if (sha256 !== hash)
      throw new SnapshotError('invalid_asset_index', `资产 ${hash} 的 sha256 与键不一致`)
    if (typeof file !== 'string' || !ASSET_FILE.test(file) || !file.startsWith(hash))
      throw new SnapshotError('invalid_asset_index', `资产 ${hash} 的文件名不合法`)
    if (typeof mime !== 'string' || !ASSET_MIME_ALLOWLIST.has(mime))
      throw new SnapshotError('invalid_asset_index', `资产 ${hash} 的类型不在允许列表：${String(mime)}`)
    if (!Number.isInteger(bytes) || (bytes as number) < 0)
      throw new SnapshotError('invalid_asset_index', `资产 ${hash} 的大小不合法`)
    if (disposition !== 'inline' && disposition !== 'attachment')
      throw new SnapshotError('invalid_asset_index', `资产 ${hash} 的 disposition 不合法`)
    assets.set(hash, { hash, file, mime, bytes: bytes as number, disposition })
  }

  const aliases = new Map<string, string>()
  if (raw.aliases !== undefined) {
    if (!isRecord(raw.aliases))
      throw new SnapshotError('invalid_asset_index', 'asset-index.json 的 aliases 必须是对象')
    for (const [alias, hash] of Object.entries(raw.aliases)) {
      if (typeof hash !== 'string' || !assets.has(hash))
        throw new SnapshotError('invalid_asset_index', `别名 ${alias} 指向不存在的资产`)
      aliases.set(alias, hash)
    }
  }
  return { assets, aliases }
}

/** The route parameter is the bare hash; anything else (aliases, extensions, case variants) is a 404. */
export function resolveAsset(index: AssetIndex, param: string): AssetEntry | null {
  if (!isAssetHash(param))
    return null
  return index.assets.get(param) ?? null
}

export function summarize(state: ForumState): SnapshotSummary {
  const bodies = new Set<string>()
  for (const post of state.posts) {
    if ((post as Post & { isTopicBody?: boolean }).isTopicBody)
      bodies.add(post.id)
  }
  return {
    users: state.users.length,
    categories: state.categories.length,
    topics: state.topics.length,
    replies: state.posts.length - bodies.size,
    archivedTopics: state.topics.filter(topic => (topic as Topic & { archived?: boolean }).archived === true).length,
  }
}

function validateUser(value: unknown, index: number): User {
  if (!isRecord(value) || !isText(value.id) || !isText(value.username) || !isText(value.displayName))
    throw new SnapshotError('invalid_state', `users[${index}] 缺少 id/username/displayName`)
  if (typeof value.role !== 'string' || !ROLES.has(value.role))
    throw new SnapshotError('invalid_state', `users[${index}] 的 role 不合法`)
  if (typeof value.avatarColor !== 'string' || !isNonNegative(value.joinedAt) || !isRecord(value.notifyPrefs))
    throw new SnapshotError('invalid_state', `users[${index}] 缺少 avatarColor/joinedAt/notifyPrefs`)
  // prepare.py writes null/"" for members without a picture; the avatar
  // component wants the field absent so the initials fallback kicks in.
  if (value.avatarUrl === '' || value.avatarUrl === null)
    delete value.avatarUrl
  if (value.avatarUrl !== undefined && (typeof value.avatarUrl !== 'string' || !value.avatarUrl.startsWith(ASSET_ROUTE_PREFIX)))
    throw new SnapshotError('invalid_state', `users[${index}] 的 avatarUrl 必须指向本地资产路由`)
  // A title can make its holder forum staff, so a malformed one must fail the
  // load rather than render as an unknown badge.
  if (value.title !== undefined && !isUserTitle(value.title))
    throw new SnapshotError('invalid_state', `users[${index}] 的 title 不合法`)
  return value as unknown as User
}

function validateCategory(value: unknown, index: number): Category {
  if (!isRecord(value) || !isText(value.id) || !isText(value.slug) || !isText(value.name))
    throw new SnapshotError('invalid_state', `categories[${index}] 缺少 id/slug/name`)
  if (typeof value.color !== 'string' || typeof value.icon !== 'string' || typeof value.description !== 'string')
    throw new SnapshotError('invalid_state', `categories[${index}] 缺少 color/icon/description`)
  return value as unknown as Category
}

function validateTopic(value: unknown, index: number): Topic {
  if (!isRecord(value) || !isText(value.id) || !isText(value.slug) || !isText(value.title))
    throw new SnapshotError('invalid_state', `topics[${index}] 缺少 id/slug/title`)
  if (!isText(value.categoryId) || !isText(value.authorId) || !Array.isArray(value.tagIds))
    throw new SnapshotError('invalid_state', `topics[${index}] 缺少 categoryId/authorId/tagIds`)
  if (!isNonNegative(value.createdAt) || !isNonNegative(value.lastActivityAt) || !isNonNegative(value.views))
    throw new SnapshotError('invalid_state', `topics[${index}] 的时间或浏览数不合法`)
  if (typeof value.pinned !== 'boolean' || typeof value.closed !== 'boolean')
    throw new SnapshotError('invalid_state', `topics[${index}] 缺少 pinned/closed`)
  return value as unknown as Topic
}

function validatePost(value: unknown, index: number): Post {
  if (!isRecord(value) || !isText(value.id) || !isText(value.topicId) || !isText(value.authorId))
    throw new SnapshotError('invalid_state', `posts[${index}] 缺少 id/topicId/authorId`)
  if (typeof value.content !== 'string' || !isNonNegative(value.createdAt) || !Array.isArray(value.likeUserIds))
    throw new SnapshotError('invalid_state', `posts[${index}] 缺少 content/createdAt/likeUserIds`)
  // SQL NULLs arrive as JSON null; the Post type models absence as undefined.
  if (value.editedAt === null)
    delete value.editedAt
  if (value.replyToPostId === null)
    delete value.replyToPostId
  if (value.editedAt !== undefined && !isNonNegative(value.editedAt))
    throw new SnapshotError('invalid_state', `posts[${index}] 的 editedAt 不合法`)
  return value as unknown as Post
}

function uniqueIds(values: string[], label: string): Set<string> {
  const seen = new Set<string>()
  for (const value of values) {
    if (seen.has(value))
      throw new SnapshotError('invalid_state', `${label} 重复：${value}`)
    seen.add(value)
  }
  return seen
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function isText(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0
}

function isNonNegative(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0
}

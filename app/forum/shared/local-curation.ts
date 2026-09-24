import type { Category, ForumState, Tag, Topic } from '../app/data/types'
import { SnapshotError } from './local-snapshot'

/**
 * Editorial layer over the read-only snapshot, described by
 * `app/forum/content/curation.json` and applied by the server before the
 * state is served:
 *
 * - every category the projection marks `archived` collapses into one
 *   "老帖归档" category; each archived topic keeps its origin as a tag named
 *   after the old category, so the archive can still be filtered by it;
 * - new-era categories and tags are added, existing categories patched and
 *   the sidebar order fixed;
 * - individual topics can be retitled, moved or tagged, and individual post
 *   bodies replaced with a polished version.
 *
 * Pure and Nuxt-free; the vitest suite drives it with fabricated states. The
 * result must still pass `parseSnapshotState`, which the server re-runs.
 */

export const CURATION_SCHEMA_VERSION = 1

export interface CurationCategory {
  id: string
  slug: string
  name: string
  description: string
  color: string
  icon: string
}

export interface CurationArchive extends CurationCategory {
  /** Prefix for the per-origin tag ids and slugs (`<prefix><category id>`). */
  tagPrefix: string
  tagColor: string
}

export interface CurationTopicPatch {
  title?: string
  categoryId?: string
  tagIds?: string[]
  pinned?: boolean
}

/**
 * 旧论坛（快照里 archived 的主题与分类）怎么处理：
 * - `hide`（默认）：旧主题连同回复全部不显示，「老帖归档」类别、按旧分类生成的标签、空着的旧分类、
 *   没有出现在可见内容里的旧账号一并去掉；`include` 里列出的话题编号例外，按普通话题显示
 *   （通常再用 topics 补丁把它放进新类别）。所有者 2026-09-24：「我们不要老帖归档，目前的数据都不需要了」。
 * - `archive`：旧行为，旧主题集中到「老帖归档」类别，按原分类打标签。
 */
export interface CurationLegacy {
  mode: 'hide' | 'archive'
  include: string[]
}

export interface Curation {
  schemaVersion: typeof CURATION_SCHEMA_VERSION
  legacy: CurationLegacy
  archive: CurationArchive
  categories: CurationCategory[]
  categoryOmissions?: string[]
  tags: Tag[]
  categoryOrder: string[]
  categoryPatches: Record<string, Partial<Pick<Category, 'name' | 'description' | 'color' | 'icon'>>>
  topics: Record<string, CurationTopicPatch>
  posts: Record<string, { content: string }>
}

type ArchivedCategory = Category & { archived?: boolean }
type ArchivedTopic = Topic & { archived?: boolean }

const ID = /^[a-z0-9][a-z0-9-]*$/
const HEX = /^#[0-9a-f]{6}$/i

export function parseCuration(raw: unknown): Curation {
  if (!isRecord(raw) || raw.schemaVersion !== CURATION_SCHEMA_VERSION)
    throw new SnapshotError('invalid_document', `curation.json 的 schemaVersion 必须为 ${CURATION_SCHEMA_VERSION}`)
  const archiveCategory = parseCategory(raw.archive, 'archive')
  if (!isRecord(raw.archive) || typeof raw.archive.tagPrefix !== 'string' || !ID.test(raw.archive.tagPrefix) || typeof raw.archive.tagColor !== 'string' || !HEX.test(raw.archive.tagColor))
    throw new SnapshotError('invalid_document', 'curation.archive 需要合法的 tagPrefix 与 tagColor')
  const archive: CurationArchive = { ...archiveCategory, tagPrefix: raw.archive.tagPrefix, tagColor: raw.archive.tagColor }
  const legacy = parseLegacy(raw.legacy)
  const categories = Array.isArray(raw.categories) ? raw.categories.map((value, index) => parseCategory(value, `categories[${index}]`)) : []
  const categoryOmissions = Array.isArray(raw.categoryOmissions) ? raw.categoryOmissions.map(String) : []
  const tags = Array.isArray(raw.tags) ? raw.tags.map((value, index) => parseTag(value, index)) : []
  const categoryOrder = Array.isArray(raw.categoryOrder) ? raw.categoryOrder.map(String) : []
  const categoryPatches = isRecord(raw.categoryPatches) ? raw.categoryPatches as Curation['categoryPatches'] : {}
  const topics: Record<string, CurationTopicPatch> = {}
  if (isRecord(raw.topics)) {
    for (const [id, patch] of Object.entries(raw.topics)) {
      if (!isRecord(patch))
        throw new SnapshotError('invalid_document', `curation.topics.${id} 必须是对象`)
      if (patch.title !== undefined && (typeof patch.title !== 'string' || patch.title.trim() === ''))
        throw new SnapshotError('invalid_document', `curation.topics.${id} 的 title 不能为空`)
      if (patch.categoryId !== undefined && typeof patch.categoryId !== 'string')
        throw new SnapshotError('invalid_document', `curation.topics.${id} 的 categoryId 必须是字符串`)
      if (patch.tagIds !== undefined && (!Array.isArray(patch.tagIds) || patch.tagIds.some(tag => typeof tag !== 'string')))
        throw new SnapshotError('invalid_document', `curation.topics.${id} 的 tagIds 必须是字符串数组`)
      if (patch.pinned !== undefined && typeof patch.pinned !== 'boolean')
        throw new SnapshotError('invalid_document', `curation.topics.${id} 的 pinned 必须是布尔值`)
      topics[id] = patch as CurationTopicPatch
    }
  }
  const posts: Record<string, { content: string }> = {}
  if (isRecord(raw.posts)) {
    for (const [id, patch] of Object.entries(raw.posts)) {
      if (!isRecord(patch) || typeof patch.content !== 'string' || patch.content.trim() === '')
        throw new SnapshotError('invalid_document', `curation.posts.${id} 需要非空 content`)
      posts[id] = { content: patch.content }
    }
  }
  return { schemaVersion: CURATION_SCHEMA_VERSION, legacy, archive, categories, categoryOmissions, tags, categoryOrder, categoryPatches, topics, posts }
}

function parseLegacy(value: unknown): CurationLegacy {
  if (value === undefined)
    return { mode: 'hide', include: [] }
  if (!isRecord(value) || (value.mode !== 'hide' && value.mode !== 'archive'))
    throw new SnapshotError('invalid_document', 'curation.legacy.mode 只能是 hide 或 archive')
  const include = value.include === undefined ? [] : value.include
  if (!Array.isArray(include) || include.some(id => typeof id !== 'string' || !ID.test(id)))
    throw new SnapshotError('invalid_document', 'curation.legacy.include 必须是话题编号数组（如 "t12"）')
  return { mode: value.mode, include: [...new Set(include as string[])] }
}

/**
 * hide 模式：删掉旧主题（include 例外）及其帖子，以及因此变空的旧分类、只被旧内容用到的标签与账号。
 * 在编辑层其余步骤之前做，后面的步骤只看到新内容。
 */
function dropLegacy(state: ForumState, legacy: CurationLegacy): ForumState {
  const archivedCategoryIds = new Set(state.categories.filter(category => (category as ArchivedCategory).archived === true).map(category => category.id))
  const include = new Set(legacy.include)
  for (const id of include) {
    if (!state.topics.some(topic => topic.id === id))
      throw new SnapshotError('invalid_state', `curation.legacy.include 引用了不存在的话题 ${id}`)
  }
  const isLegacy = (topic: Topic) => (topic as ArchivedTopic).archived === true || archivedCategoryIds.has(topic.categoryId)
  const topics = state.topics.filter(topic => !isLegacy(topic) || include.has(topic.id)).map((topic) => {
    if (!include.has(topic.id))
      return topic
    // 开启的旧帖按普通话题显示：去掉 archived，不再置顶
    const { archived: _archived, ...rest } = topic as ArchivedTopic
    return { ...rest, pinned: false }
  })
  const topicIds = new Set(topics.map(topic => topic.id))
  const posts = state.posts.filter(post => topicIds.has(post.topicId))
  const usedCategories = new Set(topics.map(topic => topic.categoryId))
  const categories = state.categories.filter(category => !archivedCategoryIds.has(category.id) || usedCategories.has(category.id))
  // 标签先全部保留：后面的话题补丁可能给新话题加上旧标签；没人用的标签在 applyCuration 最后统一去掉
  const tags = state.tags
  const people = new Set<string>()
  for (const topic of topics) people.add(topic.authorId)
  for (const post of posts) {
    people.add(post.authorId)
    for (const id of post.likeUserIds ?? []) people.add(id)
  }
  const users = state.users.filter(user => people.has(user.id))
  const postIds = new Set(posts.map(post => post.id))
  // 通知、收藏、关注只留两端都还在的；快照里这三样目前都是空的，这里只保证结构一致
  const notifications = state.notifications.filter(item => people.has(item.recipientId) && people.has(item.actorId) && (!item.topicId || topicIds.has(item.topicId)) && (!item.postId || postIds.has(item.postId)))
  const bookmarks = state.bookmarks.filter(item => people.has(item.userId) && postIds.has(item.postId))
  const follows = state.follows.filter(item => people.has(item.followerId) && people.has(item.followeeId))
  return { ...state, users, categories: categories.map(category => ({ ...category, archived: false }) as ArchivedCategory), tags, topics, posts, notifications, bookmarks, follows }
}

export function applyCuration(input: ForumState, curation: Curation): ForumState {
  const hide = curation.legacy.mode === 'hide'
  const state = hide ? dropLegacy(input, curation.legacy) : input
  const categories: ArchivedCategory[] = state.categories.map(category => ({ ...category }))
  const topics: ArchivedTopic[] = state.topics.map(topic => ({ ...topic, tagIds: [...topic.tagIds] }))
  const tags: Tag[] = state.tags.map(tag => ({ ...tag }))
  const posts = state.posts.map(post => ({ ...post }))

  // 1. Pre-apply topic category moves so omitted categories are freed
  for (const [id, patch] of Object.entries(curation.topics)) {
    const topic = topics.find(candidate => candidate.id === id)
    if (topic && patch.categoryId)
      topic.categoryId = patch.categoryId
  }

  // 2. Collapse archived categories into the archive; remember origins as tags.
  const archivedCategories = new Map(categories.filter(category => category.archived === true).map(category => [category.id, category]))
  const originTags = new Map<string, Tag>()
  for (const topic of topics) {
    const origin = archivedCategories.get(topic.categoryId)
    if (!origin && topic.archived !== true)
      continue
    if (origin) {
      let tag = originTags.get(origin.id)
      if (!tag) {
        tag = { id: `${curation.archive.tagPrefix}${origin.id}`, slug: `${curation.archive.tagPrefix}${origin.slug}`, name: origin.name, color: curation.archive.tagColor }
        originTags.set(origin.id, tag)
      }
      if (!topic.tagIds.includes(tag.id))
        topic.tagIds.push(tag.id)
    }
    topic.categoryId = curation.archive.id
    topic.archived = true
  }

  // 3. Drop omitted categories
  const omissions = new Set(curation.categoryOmissions ?? [])
  for (const id of omissions) {
    if (topics.some(t => t.categoryId === id))
      throw new SnapshotError('invalid_state', `无法移除分类 ${id}：仍有话题引用它`)
  }
  const kept = categories.filter(category => !archivedCategories.has(category.id) && !omissions.has(category.id))
  const { tagPrefix: _prefix, tagColor: _color, ...archiveCategory } = curation.archive
  if (!hide)
    kept.push({ ...archiveCategory, archived: true })
  for (const tag of originTags.values())
    tags.push(tag)

  // 2. New categories, new tags and patches.
  for (const category of curation.categories) {
    if (kept.some(existing => existing.id === category.id || existing.slug === category.slug))
      throw new SnapshotError('invalid_state', `curation 新增分类与现有分类冲突：${category.id}`)
    kept.push({ ...category, archived: false })
  }
  for (const tag of curation.tags) {
    if (tags.some(existing => existing.id === tag.id || existing.slug === tag.slug))
      throw new SnapshotError('invalid_state', `curation 新增标签与现有标签冲突：${tag.id}`)
    tags.push({ ...tag })
  }
  for (const [id, patch] of Object.entries(curation.categoryPatches)) {
    const target = kept.find(category => category.id === id)
    if (!target)
      throw new SnapshotError('invalid_state', `curation.categoryPatches 引用了不存在的分类 ${id}`)
    Object.assign(target, pick(patch, ['name', 'description', 'color', 'icon']))
  }

  // 3. Sidebar order: listed ids first, everything else in original order.
  // hide 模式下没有归档类别：排序里写着它也不报错，直接跳过
  const rank = new Map(curation.categoryOrder.filter(id => !(hide && id === curation.archive.id)).map((id, index) => [id, index]))
  for (const id of rank.keys()) {
    if (!kept.some(category => category.id === id))
      throw new SnapshotError('invalid_state', `curation.categoryOrder 引用了不存在的分类 ${id}`)
  }
  kept.sort((a, b) => (rank.get(a.id) ?? Number.MAX_SAFE_INTEGER) - (rank.get(b.id) ?? Number.MAX_SAFE_INTEGER))

  // 4. Topic patches and post bodies.
  for (const [id, patch] of Object.entries(curation.topics)) {
    const topic = topics.find(candidate => candidate.id === id)
    if (!topic)
      throw new SnapshotError('invalid_state', `curation.topics 引用了不存在的话题 ${id}`)
    if (patch.title !== undefined)
      topic.title = patch.title
    if (patch.categoryId !== undefined) {
      if (!kept.some(category => category.id === patch.categoryId))
        throw new SnapshotError('invalid_state', `curation.topics.${id} 指向不存在的分类 ${patch.categoryId}`)
      topic.categoryId = patch.categoryId
    }
    for (const tagId of patch.tagIds ?? []) {
      if (!tags.some(tag => tag.id === tagId))
        throw new SnapshotError('invalid_state', `curation.topics.${id} 指向不存在的标签 ${tagId}`)
      if (!topic.tagIds.includes(tagId))
        topic.tagIds.push(tagId)
    }
    if (patch.pinned !== undefined)
      topic.pinned = patch.pinned
  }
  for (const [id, patch] of Object.entries(curation.posts)) {
    const post = posts.find(candidate => candidate.id === id)
    if (!post)
      throw new SnapshotError('invalid_state', `curation.posts 引用了不存在的帖子 ${id}`)
    post.content = patch.content
  }

  // hide 模式：去掉最后没有任何话题在用的标签（旧分类、旧帖专用的标签）；编辑层新增的标签即使暂时没用也保留
  const curatedTags = new Set(curation.tags.map(tag => tag.id))
  const usedTags = new Set(topics.flatMap(topic => topic.tagIds))
  const finalTags = hide ? tags.filter(tag => usedTags.has(tag.id) || curatedTags.has(tag.id)) : tags
  return { ...state, categories: kept, tags: finalTags, topics, posts }
}

function parseCategory(value: unknown, label: string): CurationCategory {
  if (!isRecord(value) || typeof value.id !== 'string' || !ID.test(value.id) || typeof value.slug !== 'string' || value.slug === '')
    throw new SnapshotError('invalid_document', `curation.${label} 需要合法的 id 与 slug`)
  if (typeof value.name !== 'string' || value.name === '' || typeof value.description !== 'string')
    throw new SnapshotError('invalid_document', `curation.${label} 需要 name 与 description`)
  if (typeof value.color !== 'string' || !HEX.test(value.color) || typeof value.icon !== 'string' || (!value.icon.startsWith('i-carbon-') && !value.icon.startsWith('i-ri-')))
    throw new SnapshotError('invalid_document', `curation.${label} 的 color 必须是 6 位十六进制，icon 必须是 i-carbon-* 或 i-ri-*`)
  return { id: value.id, slug: value.slug, name: value.name, description: value.description, color: value.color, icon: value.icon }
}

function parseTag(value: unknown, index: number): Tag {
  if (!isRecord(value) || typeof value.id !== 'string' || !ID.test(value.id) || typeof value.slug !== 'string' || value.slug === '')
    throw new SnapshotError('invalid_document', `curation.tags[${index}] 需要合法的 id 与 slug`)
  if (typeof value.name !== 'string' || value.name === '' || typeof value.color !== 'string' || !HEX.test(value.color))
    throw new SnapshotError('invalid_document', `curation.tags[${index}] 需要 name 与 6 位十六进制 color`)
  return { id: value.id, slug: value.slug, name: value.name, color: value.color }
}

function pick<T extends object, K extends keyof T>(value: T, keys: K[]): Partial<T> {
  const out: Partial<T> = {}
  for (const key of keys) {
    if (value[key] !== undefined)
      out[key] = value[key]
  }
  return out
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

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

export interface Curation {
  schemaVersion: typeof CURATION_SCHEMA_VERSION
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
  return { schemaVersion: CURATION_SCHEMA_VERSION, archive, categories, categoryOmissions, tags, categoryOrder, categoryPatches, topics, posts }
}

export function applyCuration(state: ForumState, curation: Curation): ForumState {
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
  const rank = new Map(curation.categoryOrder.map((id, index) => [id, index]))
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

  return { ...state, categories: kept, tags, topics, posts }
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

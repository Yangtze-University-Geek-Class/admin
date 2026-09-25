import type { Category, ForumState, Tag } from '../app/data/types'
// Named imports on purpose: the bundle takes these three fields of
// curation.json and leaves the rest (the snapshot topic titles and post
// patches, whose authors exist only in the private archive) behind.
import { categories as curatedCategories, categoryOrder, tags as curatedTags } from '../content/curation.json'
import { emptyForumState } from './local-snapshot'

/**
 * What the deployed forum shows (`contentSource: 'site'`): 极客班论坛's own
 * categories and tags from `content/curation.json`, and nothing else. There
 * is no backend yet, so no users, topics, posts, notifications, bookmarks or
 * follows — never the upstream demo seed, and never the private snapshot.
 *
 * Categories follow `curation.categoryOrder` (the sidebar order the snapshot
 * uses too); ids listed there that are not curated categories (old forum
 * categories the snapshot patches) are skipped, curated categories missing
 * from it keep their file order after the listed ones.
 */
export function siteForumState(): ForumState {
  const rank = new Map(categoryOrder.map((id, index) => [id, index]))
  const categories: Category[] = curatedCategories
    .map((category, index) => ({ category, index }))
    .sort((a, b) => (rank.get(a.category.id) ?? Number.MAX_SAFE_INTEGER) - (rank.get(b.category.id) ?? Number.MAX_SAFE_INTEGER) || a.index - b.index)
    .map(({ category: { id, slug, name, description, color, icon } }) => ({ id, slug, name, description, color, icon }))
  const tags: Tag[] = curatedTags.map(({ id, slug, name, color }) => ({ id, slug, name, color }))
  const empty = emptyForumState()
  // The tag counter resumes from the tags already present, like a stored state
  // written before the counter existed (see `parseState`).
  return { ...empty, counters: { ...empty.counters, tag: tags.length }, categories, tags }
}

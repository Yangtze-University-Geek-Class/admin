import type { Category, ForumState, Tag } from '../app/data/types'
// Named imports on purpose: the bundle takes these three fields of
// curation.json and leaves the rest (the snapshot topic titles and post
// patches, whose authors exist only in the private archive) behind.
import { categories as curatedCategories, categoryOrder, tags as curatedTags } from '../content/curation.json'
import { emptyForumState } from './local-snapshot'
import { publishedContent } from './published'

/**
 * What the deployed forum shows (`contentSource: 'site'`): 极客班论坛's own
 * categories and tags from `content/curation.json`, plus the old-forum
 * documents published under the 极客班 account (`shared/published.ts`). There
 * is no backend yet, so nobody else, no replies, notifications, bookmarks or
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
  const { users, topics, posts } = publishedContent()
  const empty = emptyForumState()
  // Counters resume after what is already present, like a stored state written
  // before they existed (see `parseState`): the tag count, and the highest
  // topic number so a new topic id can never reuse an old forum's `t<n>`.
  const topicCounter = Math.max(0, ...topics.map(topic => Number(topic.id.slice(1))))
  return {
    ...empty,
    counters: { ...empty.counters, topic: topicCounter, post: posts.length, tag: tags.length },
    users,
    categories,
    tags,
    topics,
    posts,
  }
}

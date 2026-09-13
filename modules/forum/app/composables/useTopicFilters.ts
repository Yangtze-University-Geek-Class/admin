import type { DataTableSortState } from '@talex-touch/tuffex/data-table'
import type { MaybeRefOrGetter } from 'vue'
import type { Topic } from '~/data/types'
import type { TopicSortMode } from '~/stores/forum'

export const TOPIC_PAGE_SIZE = 20

const MODES: TopicSortMode[] = ['latest', 'new', 'top']

/** The sortable table columns, keyed as `DataTableColumn.key`. */
export type TopicSortColumn = 'replies' | 'views' | 'activity'

const SORT_COLUMNS: TopicSortColumn[] = ['replies', 'views', 'activity']

/** No category/tag carries this id, so an unknown slug filters everything out. */
const NO_MATCH = ' no-match'

export interface TopicFilterPins {
  /**
   * Slug the page fixes (`/c/[slug]`, `/tag/[slug]`). A pinned filter stays out
   * of the query string — the route already says it — and its dropdown is
   * hidden, so nothing can change it from the nav row.
   */
  category?: MaybeRefOrGetter<string | undefined>
  tag?: MaybeRefOrGetter<string | undefined>
}

/**
 * The topic list's filter state, which lives entirely in the query string:
 * `?mode=new&category=help&tag=vue&sort=replies&dir=desc&page=2`. Defaults are
 * omitted, so `/` stays `/`, and every setter is a `replace` — filtering is not
 * a history step.
 *
 * The column sort lives here rather than inside `TxDataTable` because the table
 * only ever receives one page: its own `sortOnClient` would order those twenty
 * rows and call it sorted. Discourse sorts the whole list, so the order is
 * applied to `matching` before the page is sliced out of it.
 */
export function useTopicFilters(pins: TopicFilterPins = {}) {
  const forum = useForumStore()
  const route = useRoute()
  const router = useRouter()

  const pinnedCategory = computed(() => toValue(pins.category))
  const pinnedTag = computed(() => toValue(pins.tag))

  const mode = computed<TopicSortMode>(() => {
    const raw = queryValue(route.query.mode)
    return MODES.includes(raw as TopicSortMode) ? raw as TopicSortMode : 'latest'
  })

  const categorySlug = computed(() => pinnedCategory.value ?? queryValue(route.query.category))
  const tagSlug = computed(() => pinnedTag.value ?? queryValue(route.query.tag))

  /** `null` unless both halves are present and valid, so half a sort never half-applies. */
  const sort = computed<DataTableSortState | null>(() => {
    const key = queryValue(route.query.sort)
    const dir = queryValue(route.query.dir)
    if (!SORT_COLUMNS.includes(key as TopicSortColumn) || (dir !== 'asc' && dir !== 'desc'))
      return null
    return { key: key as string, order: dir }
  })

  const requestedPage = computed(() => {
    const parsed = Number.parseInt(queryValue(route.query.page) ?? '', 10)
    return Number.isFinite(parsed) && parsed > 1 ? parsed : 1
  })

  const filtered = computed<Topic[]>(() => forum.sortedTopics({
    mode: mode.value,
    categoryId: categorySlug.value ? forum.categoryBySlug(categorySlug.value)?.id ?? NO_MATCH : undefined,
    tagId: tagSlug.value ? forum.tagBySlug(tagSlug.value)?.id ?? NO_MATCH : undefined,
  }))

  const matching = computed<Topic[]>(() => {
    const state = sort.value
    if (!state)
      return filtered.value
    const value = sortValue(forum, state.key as TopicSortColumn)
    const sign = state.order === 'asc' ? 1 : -1
    // Pinned first in every order (Discourse keeps them there), and `sort` is
    // stable, so equal counts stay in the mode's order underneath.
    return [...filtered.value].sort((a, b) =>
      Number(b.pinned) - Number(a.pinned) || sign * (value(a) - value(b)))
  })

  const total = computed(() => matching.value.length)
  const pageCount = computed(() => Math.max(1, Math.ceil(total.value / TOPIC_PAGE_SIZE)))
  /** Clamped, so `?page=99` shows the last page instead of an empty table. */
  const page = computed(() => Math.min(requestedPage.value, pageCount.value))
  const topics = computed(() => matching.value.slice((page.value - 1) * TOPIC_PAGE_SIZE, page.value * TOPIC_PAGE_SIZE))

  /** Merges into the current query; `undefined` (or `''`) removes a key. */
  function apply(patch: Record<string, string | undefined>): void {
    const query: Record<string, string> = {}
    for (const [key, value] of Object.entries(route.query)) {
      if (typeof value === 'string' && value !== '')
        query[key] = value
    }
    for (const [key, value] of Object.entries(patch)) {
      if (value === undefined || value === '')
        Reflect.deleteProperty(query, key)
      else
        query[key] = value
    }
    void router.replace({ path: route.path, query })
  }

  // Changing what is listed always returns to page 1; staying on page 3 of a
  // different filter shows an arbitrary slice of it.
  function setMode(next: TopicSortMode): void {
    apply({ mode: next === 'latest' ? undefined : next, page: undefined })
  }

  function setCategory(slug: string | undefined): void {
    apply({ category: slug, page: undefined })
  }

  function setTag(slug: string | undefined): void {
    apply({ tag: slug, page: undefined })
  }

  /** `null` (the third click of the table's tri-state cycle) clears both keys. */
  function setSort(next: DataTableSortState | null): void {
    const usable = next && next.order && SORT_COLUMNS.includes(next.key as TopicSortColumn) ? next : null
    apply({
      sort: usable?.key,
      dir: usable?.order ?? undefined,
      page: undefined,
    })
  }

  function setPage(next: number): void {
    apply({ page: next > 1 ? String(next) : undefined })
  }

  return {
    mode,
    categorySlug,
    tagSlug,
    pinnedCategory,
    pinnedTag,
    sort,
    page,
    pageCount,
    pageSize: TOPIC_PAGE_SIZE,
    total,
    topics,
    setMode,
    setCategory,
    setTag,
    setSort,
    setPage,
  }
}

/** Reply counts are derived, so the sort value comes from the store, not the row. */
function sortValue(forum: ReturnType<typeof useForumStore>, key: TopicSortColumn): (topic: Topic) => number {
  switch (key) {
    case 'replies':
      return topic => forum.replyCount(topic.id)
    case 'views':
      return topic => topic.views
    case 'activity':
      return topic => topic.lastActivityAt
  }
}

function queryValue(value: unknown): string | undefined {
  return typeof value === 'string' && value !== '' ? value : undefined
}

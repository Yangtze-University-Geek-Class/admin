import type { SidebarNavGroup, SidebarNavItem, SidebarNavValue } from '@talex-touch/tuffex/sidebar-nav'

const TOP_TAG_COUNT = 8

/** Discourse's four sidebar sections, in its order. */
const GROUPS: SidebarNavGroup[] = [
  { key: 'community', label: '社区' },
  { key: 'categories', label: '类别' },
  { key: 'tags', label: '标签' },
  { key: 'mine', label: '我的' },
]

/**
 * The sidebar model. Item values are route paths, so the active item is the
 * one whose value equals `route.path` exactly and selecting one is a push.
 */
export function useForumNav() {
  const forum = useForumStore()
  const session = useSessionStore()
  const route = useRoute()
  const router = useRouter()

  /** Category items show Discourse's colour square instead of an icon. */
  const dotColors = computed(() => new Map(
    forum.state.categories.map(category => [`/c/${category.slug}` as SidebarNavValue, category.color]),
  ))

  const items = computed<SidebarNavItem[]>(() => {
    const user = session.currentUser
    const list: SidebarNavItem[] = [
      { value: '/', label: '话题', group: 'community', icon: 'i-carbon-forum' },
    ]
    if (user)
      list.push({ value: `/u/${user.username}`, label: '我的帖子', group: 'community', icon: 'i-carbon-user' })
    list.push(
      { value: '/users', label: '用户', group: 'community', icon: 'i-carbon-user-multiple' },
      { value: '/about', label: '关于', group: 'community', icon: 'i-carbon-information' },
    )

    for (const category of forum.state.categories)
      list.push({ value: `/c/${category.slug}`, label: category.name, group: 'categories', icon: category.icon })
    list.push({ value: '/categories', label: '全部类别', group: 'categories', icon: 'i-carbon-category' })

    // Same ranking as `/tags`, from the store, so the sidebar's "热门" cannot
    // disagree with the tag cloud.
    for (const { tag } of forum.tagsByPopularity(TOP_TAG_COUNT))
      list.push({ value: `/tag/${tag.slug}`, label: tag.name, group: 'tags', icon: 'i-carbon-tag' })
    list.push({ value: '/tags', label: '全部标签', group: 'tags', icon: 'i-carbon-tag-group' })

    if (user) {
      const unread = forum.unreadCount(user.id)
      list.push(
        { value: '/notifications', label: '通知', group: 'mine', icon: 'i-carbon-notification', ...(unread ? { badge: unread } : {}) },
        { value: '/bookmarks', label: '书签', group: 'mine', icon: 'i-carbon-bookmark' },
      )
    }
    return list
  })

  const active = computed<SidebarNavValue | undefined>(() =>
    items.value.some(item => item.value === route.path) ? route.path : undefined,
  )

  function select(item: SidebarNavItem): void {
    void router.push(String(item.value))
  }

  return { groups: GROUPS, items, active, dotColors, select }
}

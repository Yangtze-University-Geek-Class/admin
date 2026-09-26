<script setup lang="ts">
import type { CommandPaletteItem } from '@talex-touch/tuffex/command-palette'

const { isSite, siteLogin, siteName } = useContentSource()
const { can } = useCurrentUser()

// Body styling goes through utility classes: the project ships no custom CSS,
// and tuffex's stylesheet deliberately leaves `body` alone.
useHead({
  titleTemplate: title => (title ? `${title} · ${siteName}` : siteName),
  bodyAttrs: {
    class: 'min-h-screen bg-$tx-bg-color-page text-$tx-text-color-primary [font-family:var(--tx-font-family)] antialiased',
  },
})

const RECENT_TOPIC_COUNT = 20

/** Command ids double as the destination, so `select` is a plain push. */
const PAGE_COMMANDS: CommandPaletteItem[] = [
  { id: '/', title: '话题', description: '最新话题列表', icon: 'i-carbon-forum', keywords: ['latest', 'home'] },
  { id: '/categories', title: '类别', description: '浏览全部类别', icon: 'i-carbon-category', keywords: ['categories'] },
  { id: '/tags', title: '标签', description: '浏览全部标签', icon: 'i-carbon-tag-group', keywords: ['tags'] },
  { id: '/users', title: '用户', description: '用户目录', icon: 'i-carbon-user-multiple', keywords: ['users'] },
  { id: '/notifications', title: '通知', icon: 'i-carbon-notification', keywords: ['notifications'] },
  { id: '/bookmarks', title: '书签', icon: 'i-carbon-bookmark', keywords: ['bookmarks'] },
  { id: '/new', title: '新话题', description: '发起一个新话题', icon: 'i-carbon-add', keywords: ['new', 'post'] },
  // 极客班论坛的关于页没有管理团队（还没有成员资料）。
  { id: '/about', title: '关于', description: isSite ? '论坛简介' : '站点简介与管理团队', icon: 'i-carbon-information', keywords: ['about'] },
]

const forum = useForumStore()
const router = useRouter()
const { paletteOpen } = useShell()

const commands = computed<CommandPaletteItem[]>(() => [
  // The read-only snapshot has no composer; in 极客班论坛 only a signed-in member has one.
  ...PAGE_COMMANDS.filter(command => !siteLogin || command.id !== '/new' || can('createTopic')),
  ...forum.sortedTopics({ mode: 'latest' }).slice(0, RECENT_TOPIC_COUNT).map(topic => ({
    id: `/t/${topic.id}`,
    title: topic.title,
    description: forum.categoryById(topic.categoryId)?.name,
    icon: 'i-carbon-chat',
    keywords: ['topic', '话题'],
  })),
  ...forum.state.users.map(user => ({
    id: `/u/${user.username}`,
    title: user.displayName,
    description: `@${user.username}`,
    icon: 'i-carbon-user',
    keywords: [user.username, 'user', '用户'],
  })),
])

function onSelect(item: CommandPaletteItem) {
  void router.push(item.id)
}

useEventListener(document, 'keydown', (event) => {
  if ((event.metaKey || event.ctrlKey) && !event.altKey && event.key.toLowerCase() === 'k') {
    event.preventDefault()
    paletteOpen.value = !paletteOpen.value
  }
})
</script>

<template>
  <NuxtLayout>
    <NuxtPage />
  </NuxtLayout>
  <TxCommandPalette
    v-model="paletteOpen"
    :commands="commands"
    placeholder="搜索话题、用户或页面…"
    empty-text="没有匹配项"
    aria-label="快速跳转"
    @select="onSelect"
  />
  <TxToastHost />
</template>

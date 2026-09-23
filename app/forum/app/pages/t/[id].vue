<script setup lang="ts">
import type { BreadcrumbItem } from '@talex-touch/tuffex/breadcrumb'
import type { Post } from '~/data/types'
import { toast } from '@talex-touch/tuffex/utils'

// Discourse's /t/<slug>/<id>: the post stream with its right-hand timeline,
// the topic control bar, the bottom composer and the suggested topics.
definePageMeta({
  // Re-run setup when the id changes; the query string must not remount.
  key: route => route.path,
})

/** How long a jumped-to or freshly posted card keeps its highlight. */
const FLASH_MS = 1200
const BREADCRUMB_TITLE_LENGTH = 24

const route = useRoute()
const router = useRouter()
const forum = useForumStore()
const { can } = useCurrentUser()
const { isDesktop } = useShell()

const topicId = String(route.params.id)
// Read through the store rather than capturing the object: `重置示例数据`
// replaces the whole state, and a captured entity would keep rendering (and
// answering `can()`) from a tree nothing writes to any more.
const topic = computed(() => forum.topicById(topicId))

// The 话题管理 menu lists only what the viewer may do. Pinning and closing are
// separate forum capabilities (a 项目部 head may pin but not close), so each
// item asks can() on its own and the menu shows when either one holds.
const canPin = computed(() => topic.value !== undefined && can('pinTopic', { topic: topic.value }))
const canClose = computed(() => topic.value !== undefined && can('closeTopic', { topic: topic.value }))

// Raised rather than thrown: a `throw` in setup still renders the template once
// with every binding undefined, which logs a handful of Vue warnings on the way
// to the error page. `showError` lets setup finish and the root `v-if` keeps
// the template from rendering anything at all.
if (!topic.value) {
  showError(createError({
    statusCode: 404,
    // h3 warns when `statusMessage` carries prose ("prefer `message`"), and that
    // warning is a console error by AC3's standards; the Chinese copy lives in
    // `message`, which is what error.vue renders anyway.
    statusMessage: 'Not Found',
    message: '这个话题不存在，它可能已被删除。',
    fatal: true,
  }))
}

useHead({ title: () => topic.value?.title ?? '话题' })

const posts = computed<Post[]>(() => (topic.value ? forum.postsOfTopic(topic.value.id) : []))
const category = computed(() => (topic.value ? forum.categoryById(topic.value.categoryId) : undefined))
const tags = computed(() => (topic.value ? topic.value.tagIds.map(id => forum.tagById(id)).filter(tag => tag !== undefined) : []))

const composerOpen = ref(false)
const replyTo = ref<Post | undefined>()
const flashPostId = ref<string | null>(null)
let flashTimer: ReturnType<typeof setTimeout> | undefined

const breadcrumb = computed<BreadcrumbItem[]>(() => [
  { label: '话题' },
  { label: category.value?.name ?? '' },
  { label: truncate(topic.value?.title ?? '', BREADCRUMB_TITLE_LENGTH) },
])

function onBreadcrumb(_item: BreadcrumbItem, index: number) {
  if (index === 0)
    void router.push('/')
  else if (index === 1 && category.value)
    void router.push(`/c/${category.value.slug}`)
}

function truncate(value: string, max: number): string {
  return value.length > max ? `${value.slice(0, max)}…` : value
}

/** Scrolls a post into view and highlights it, for both backlinks and new replies. */
function focusPost(postId: string) {
  const element = document.getElementById(`post-${postId}`)
  if (!element)
    return
  element.scrollIntoView({ behavior: 'smooth', block: 'center' })
  flashPostId.value = postId
  clearTimeout(flashTimer)
  flashTimer = setTimeout(() => {
    if (flashPostId.value === postId)
      flashPostId.value = null
  }, FLASH_MS)
}

function openComposer(post?: Post) {
  if (!topic.value || !can('reply', { topic: topic.value }))
    return
  replyTo.value = post
  composerOpen.value = true
}

async function onSubmitted(post: Post) {
  await nextTick()
  replyTo.value = undefined
  focusPost(post.id)
}

function togglePinned() {
  const current = topic.value
  if (!current || !can('pinTopic', { topic: current }))
    return
  forum.setPinned(current.id, !current.pinned)
  toast({ title: current.pinned ? '话题已置顶' : '已取消置顶', variant: 'success' })
}

function toggleClosed() {
  const current = topic.value
  if (!current || !can('closeTopic', { topic: current }))
    return
  forum.setClosed(current.id, !current.closed)
  toast({ title: current.closed ? '话题已关闭' : '话题已重新开放', variant: 'success' })
}

// One view per topic per browser session, so re-reading a thread in the same
// tab does not inflate its count.
onMounted(() => {
  const current = topic.value
  if (!current)
    return
  const key = `tuff-forum:viewed:${current.id}`
  try {
    if (sessionStorage.getItem(key))
      return
    sessionStorage.setItem(key, '1')
  }
  catch {
    // Storage disabled: count the view anyway rather than losing it.
  }
  forum.incrementViews(current.id)
})

onBeforeUnmount(() => clearTimeout(flashTimer))
</script>

<template>
  <TxStack v-if="topic" :gap="16">
    <!-- No `href`: TxBreadcrumb renders a real <a>, which would reload the SPA. -->
    <TxBreadcrumb :items="breadcrumb" @click="onBreadcrumb" />

    <TxStack :gap="8">
      <TxFlex align="center" :gap="8" wrap="wrap">
        <h1 class="inline-flex items-center gap-2 text-2xl font-semibold">
          <i v-if="topic.closed" class="i-carbon-locked" aria-hidden="true" />
          <span>{{ topic.title }}</span>
        </h1>

        <TxDropdownMenu v-if="canPin || canClose" placement="bottom-end" reference-class="ml-auto">
          <template #trigger>
            <TxIconButton icon="i-carbon-overflow-menu-horizontal" label="话题管理" />
          </template>
          <TxDropdownItem v-if="canPin" @select="togglePinned">
            {{ topic.pinned ? '取消置顶' : '置顶话题' }}
          </TxDropdownItem>
          <TxDropdownItem v-if="canClose" @select="toggleClosed">
            {{ topic.closed ? '重新开放' : '关闭话题' }}
          </TxDropdownItem>
        </TxDropdownMenu>
      </TxFlex>

      <TxFlex align="center" :gap="6" wrap="wrap">
        <CategoryTag :category="category" clickable />
        <TxTag v-for="tag in tags" :key="tag.id" :label="tag.name" variant="plain" size="sm" />
        <TxStatusBadge v-if="topic.pinned" text="已置顶" icon="i-carbon-pin" status="muted" size="sm" />
        <TxStatusBadge v-if="topic.closed" text="已关闭" icon="i-carbon-locked" status="muted" size="sm" />
      </TxFlex>
    </TxStack>

    <TxRow :gutter="24">
      <TxCol :span="24" :lg="17">
        <TxStack :gap="16">
          <TxStack :gap="12">
            <PostCard
              v-for="(post, index) in posts"
              :key="post.id"
              :post="post"
              :topic="topic"
              :floor="index + 1"
              :flash="flashPostId === post.id"
              @reply="openComposer"
              @jump="focusPost"
            />
          </TxStack>

          <TopicControls :topic="topic" @reply="openComposer()" />

          <SuggestedTopics :topic-id="topic.id" />
        </TxStack>
      </TxCol>

      <TxCol v-if="isDesktop" :lg="7">
        <div class="sticky top-20">
          <TopicTimeline :topic="topic" />
        </div>
      </TxCol>
    </TxRow>

    <ReplyComposer
      v-model:visible="composerOpen"
      :topic="topic"
      :reply-to="replyTo"
      @submitted="onSubmitted"
    />
  </TxStack>
</template>

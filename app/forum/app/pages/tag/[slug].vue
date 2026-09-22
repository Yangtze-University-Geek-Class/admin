<script setup lang="ts">
// Discourse's /tag/<slug>: the same list, fixed to one tag by the route.
definePageMeta({
  key: route => route.path,
})

const route = useRoute()
const router = useRouter()
const forum = useForumStore()

const slug = String(route.params.slug)
// See `pages/c/[slug].vue`: read through the store so a state replacement (重置
// 示例数据) cannot leave the page rendering a detached entity.
const tag = computed(() => forum.tagBySlug(slug))

// See `pages/c/[slug].vue` for why this is `showError` and not `throw`.
if (!tag.value) {
  showError(createError({
    statusCode: 404,
    statusMessage: 'Not Found',
    message: '标签不存在，它可能已经改名或被删除。',
    fatal: true,
  }))
}

useHead({ title: () => (tag.value ? `#${tag.value.name}` : '标签') })

const {
  mode,
  categorySlug,
  sort,
  page,
  pageSize,
  total,
  topics,
  setMode,
  setCategory,
  setSort,
  setPage,
} = useTopicFilters({ tag: slug })

// The banner counts the whole tag, not the filtered slice below it.
const tagTopics = computed(() => (tag.value ? forum.sortedTopics({ mode: 'latest', tagId: tag.value.id }) : []))
const topicCount = computed(() => tagTopics.value.length)
const postCount = computed(() =>
  tagTopics.value.reduce((sum, topic) => sum + forum.replyCount(topic.id) + 1, 0),
)

const breadcrumb = computed(() => [{ label: '话题' }, { label: '标签' }, { label: tag.value?.name ?? '' }])

function onBreadcrumb(_item: unknown, index: number) {
  if (index === 0)
    void router.push('/')
  else if (index === 1)
    void router.push('/tags')
}
</script>

<template>
  <TxStack v-if="tag" :gap="16">
    <!-- No `href`: TxBreadcrumb renders a real <a>, which would reload the SPA. -->
    <TxBreadcrumb :items="breadcrumb" @click="onBreadcrumb" />

    <!--
      Upstream puts the stats in TxCardItem's #right slot, where the two
      full-width TxStatCards stack into a tall column. Here they sit in a
      two-column TxGrid beside the heading and wrap under it on a phone.
    -->
    <TxCard>
      <TxFlex align="center" justify="space-between" :gap="16" wrap="wrap">
        <TxCardItem :description="`带有 #${tag.name} 标签的话题`" class="min-w-60 flex-1">
          <template #avatar>
            <TxTag :label="tag.name" :color="tag.color" size="md" pill />
          </template>
          <!-- The tag is the page heading. -->
          <template #title>
            <h1 class="truncate text-xl font-semibold">
              #{{ tag.name }}
            </h1>
          </template>
        </TxCardItem>
        <!-- TxGrid pins its own width to 100%, so the wrapper carries the size. -->
        <div class="w-full sm:w-72">
          <TxGrid :cols="2" :gap="12">
            <TxStatCard :value="topicCount" label="话题" icon-class="i-carbon-forum" />
            <TxStatCard :value="postCount" label="帖子" icon-class="i-carbon-chat" />
          </TxGrid>
        </div>
      </TxFlex>
    </TxCard>

    <TopicListNav
      :mode="mode"
      :category-slug="categorySlug"
      pinned-tag
      @update:mode="setMode"
      @update:category="setCategory"
    />

    <TopicList
      :topics="topics"
      :total="total"
      :current-page="page"
      :sort="sort"
      :page-size="pageSize"
      @update:current-page="setPage"
      @update:sort="setSort"
    />
  </TxStack>
</template>

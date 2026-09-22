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

    <TxCard>
      <div class="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div class="flex items-center gap-3">
          <TxTag :label="tag.name" :color="tag.color" size="md" pill class="shrink-0" />
          <div>
            <h1 class="text-xl font-semibold text-$tx-text-color-primary leading-tight">
              #{{ tag.name }}
            </h1>
            <p class="text-sm text-$tx-text-color-secondary mt-1">
              带有 #{{ tag.name }} 标签的话题
            </p>
          </div>
        </div>

        <div class="flex items-center gap-3 shrink-0">
          <div class="flex items-center gap-3 px-3.5 py-2 rounded-xl border border-$tx-border-color-lighter bg-$tx-bg-color-page min-w-[96px]">
            <div class="w-8 h-8 rounded-lg bg-$tx-color-primary-light flex items-center justify-center text-$tx-color-primary shrink-0">
              <i class="i-carbon-forum text-base" />
            </div>
            <div>
              <div class="text-base font-bold text-$tx-text-color-primary leading-tight">
                {{ topicCount }}
              </div>
              <div class="text-xs text-$tx-text-color-secondary">
                话题
              </div>
            </div>
          </div>

          <div class="flex items-center gap-3 px-3.5 py-2 rounded-xl border border-$tx-border-color-lighter bg-$tx-bg-color-page min-w-[96px]">
            <div class="w-8 h-8 rounded-lg bg-$tx-color-success-light flex items-center justify-center text-$tx-color-success shrink-0">
              <i class="i-carbon-chat text-base" />
            </div>
            <div>
              <div class="text-base font-bold text-$tx-text-color-primary leading-tight">
                {{ postCount }}
              </div>
              <div class="text-xs text-$tx-text-color-secondary">
                帖子
              </div>
            </div>
          </div>
        </div>
      </div>
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

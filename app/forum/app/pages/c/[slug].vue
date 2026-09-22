<script setup lang="ts">
// Discourse's /c/<slug>: the category banner over the same topic list, with
// the category filter fixed by the route instead of the query string.
definePageMeta({
  // Re-run setup when the slug changes (the query string must not remount).
  key: route => route.path,
})

const route = useRoute()
const router = useRouter()
const forum = useForumStore()

const slug = String(route.params.slug)
// Read through the store, not captured: `重置示例数据` swaps the whole state and
// a captured entity would keep rendering from the replaced tree.
const category = computed(() => forum.categoryBySlug(slug))

// An unknown slug is a 404, raised imperatively rather than thrown: a `throw`
// aborts setup and Vue still renders the template once with every binding
// undefined (four `[Vue warn]`s on the way to the error page), while raising it
// from route middleware runs before mount and logs Nuxt's NUXT_E1005
// diagnostic. `showError` lets setup finish, and the `v-if` renders nothing.
if (!category.value) {
  showError(createError({
    statusCode: 404,
    statusMessage: 'Not Found',
    message: '类别不存在，它可能已经改名或被删除。',
    fatal: true,
  }))
}

useHead({ title: () => category.value?.name ?? '类别' })

const {
  mode,
  tagSlug,
  sort,
  page,
  pageSize,
  total,
  topics,
  setMode,
  setTag,
  setSort,
  setPage,
} = useTopicFilters({ category: slug })

// The banner counts the whole category, not the filtered slice below it.
const categoryTopics = computed(() => (category.value ? forum.sortedTopics({ mode: 'latest', categoryId: category.value.id }) : []))
const topicCount = computed(() => categoryTopics.value.length)
const postCount = computed(() =>
  categoryTopics.value.reduce((sum, topic) => sum + forum.replyCount(topic.id) + 1, 0),
)

const breadcrumb = computed(() => [{ label: '话题' }, { label: category.value?.name ?? '' }])

function onBreadcrumb(_item: unknown, index: number) {
  if (index === 0)
    void router.push('/')
}
</script>

<template>
  <TxStack v-if="category" :gap="16">
    <!-- No `href`: TxBreadcrumb renders a real <a>, which would reload the SPA. -->
    <TxBreadcrumb :items="breadcrumb" @click="onBreadcrumb" />

    <TxCard>
      <div class="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div class="flex items-center gap-3">
          <TxBadge dot :color="category.color" class="shrink-0" />
          <div>
            <h1 class="text-xl font-semibold text-$tx-text-color-primary leading-tight">
              {{ category.name }}
            </h1>
            <p v-if="category.description" class="text-sm text-$tx-text-color-secondary mt-1">
              {{ category.description }}
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
      :tag-slug="tagSlug"
      pinned-category
      @update:mode="setMode"
      @update:tag="setTag"
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

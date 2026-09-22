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

    <!--
      Upstream puts the stats in TxCardItem's #right slot, where the two
      full-width TxStatCards stack into a tall column. Here they sit in a
      two-column TxGrid beside the heading and wrap under it on a phone.
    -->
    <TxCard>
      <TxFlex align="center" justify="space-between" :gap="16" wrap="wrap">
        <TxCardItem :description="category.description" class="min-w-60 flex-1">
          <template #avatar>
            <TxBadge dot :color="category.color" />
          </template>
          <!-- The category name is the page heading. -->
          <template #title>
            <h1 class="truncate text-xl font-semibold">
              {{ category.name }}
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

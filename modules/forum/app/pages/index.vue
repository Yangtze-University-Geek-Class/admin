<script setup lang="ts">
// Discourse's /latest: the nav row (modes, category, tag, 新话题) over the
// topic list.
useHead({ title: '话题' })

const {
  mode,
  categorySlug,
  tagSlug,
  sort,
  page,
  pageSize,
  total,
  topics,
  setMode,
  setCategory,
  setTag,
  setSort,
  setPage,
} = useTopicFilters()
</script>

<template>
  <TxStack :gap="16">
    <TopicListNav
      :mode="mode"
      :category-slug="categorySlug"
      :tag-slug="tagSlug"
      @update:mode="setMode"
      @update:category="setCategory"
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

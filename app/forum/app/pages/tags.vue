<script setup lang="ts">
// Discourse's /tags: the tag cloud, busiest first.
useHead({ title: '标签' })

const forum = useForumStore()
const router = useRouter()

// Busiest first; the sidebar's 热门标签 section takes the head of the same list.
const tags = computed(() => forum.tagsByPopularity())

function open(slug: string) {
  void router.push(`/tag/${slug}`)
}
</script>

<template>
  <TxCard>
    <template #header>
      <h1 class="text-xl font-semibold">
        标签
      </h1>
    </template>

    <TxFlex v-if="tags.length" wrap="wrap" :gap="8">
      <TxTag
        v-for="{ tag, count } in tags"
        :key="tag.id"
        :label="tag.name"
        :color="tag.color"
        :count="count"
        size="md"
        pill
        @click="open(tag.slug)"
      />
    </TxFlex>

    <TxEmptyState
      v-else
      variant="no-data"
      title="还没有标签"
      description="发布话题时可以创建标签"
    />
  </TxCard>
</template>

<script setup lang="ts">
import type { FilterChipItem, FilterChipValue } from '@talex-touch/tuffex/filter-chips'
import type { TxSelectModelValue, TxSelectOption } from '@talex-touch/tuffex/select'
import type { TopicSortMode } from '~/stores/forum'

/**
 * Discourse's navigation row above the topic list: the three list modes, the
 * category and tag dropdowns, and "新话题" pushed to the right edge.
 *
 * A pinned category/tag (on `/c/[slug]` and `/tag/[slug]`) hides its own
 * dropdown — the route owns that filter and nothing here may change it.
 */
defineProps<{
  mode: TopicSortMode
  categorySlug?: string
  tagSlug?: string
  pinnedCategory?: boolean
  pinnedTag?: boolean
}>()

const emit = defineEmits<{
  'update:mode': [mode: TopicSortMode]
  'update:category': [slug: string | undefined]
  'update:tag': [slug: string | undefined]
}>()

const forum = useForumStore()
const { can } = useCurrentUser()

const MODE_CHIPS: FilterChipItem[] = [
  { value: 'latest', label: '最新', iconClass: 'i-carbon-time' },
  { value: 'new', label: '新', iconClass: 'i-carbon-star' },
  { value: 'top', label: '热门', iconClass: 'i-carbon-growth' },
]

const categoryOptions = computed<TxSelectOption[]>(() => [
  { value: '', label: '全部类别' },
  ...forum.state.categories.map(category => ({ value: category.slug, label: category.name, icon: category.icon })),
])

const tagOptions = computed<TxSelectOption[]>(() => [
  { value: '', label: '全部标签' },
  ...forum.state.tags.map(tag => ({ value: tag.slug, label: tag.name })),
])

function pickMode(value: FilterChipValue) {
  emit('update:mode', String(value) as TopicSortMode)
}

function pickCategory(value: TxSelectModelValue) {
  emit('update:category', String(value) || undefined)
}

function pickTag(value: TxSelectModelValue) {
  emit('update:tag', String(value) || undefined)
}
</script>

<template>
  <TxFlex align="center" :gap="8" wrap="wrap">
    <TxFilterChips
      :model-value="mode"
      :items="MODE_CHIPS"
      role="tablist"
      aria-label="话题排序"
      @change="pickMode"
    />

    <TxSelect
      v-if="!pinnedCategory"
      :model-value="categorySlug ?? ''"
      :options="categoryOptions"
      placeholder="全部类别"
      @update:model-value="pickCategory"
    />

    <TxSelect
      v-if="!pinnedTag"
      :model-value="tagSlug ?? ''"
      :options="tagOptions"
      placeholder="全部标签"
      searchable
      search-placeholder="搜索标签"
      empty-text="没有匹配的标签"
      @update:model-value="pickTag"
    />

    <TxButton
      v-if="can('createTopic')"
      variant="primary"
      icon="i-carbon-add"
      class="ml-auto"
      @click="navigateTo('/new')"
    >
      新话题
    </TxButton>
  </TxFlex>
</template>

<script setup lang="ts">
import type { DataTableColumn, DataTableSortState } from '@talex-touch/tuffex/data-table'
import type { Topic } from '~/data/types'
import { useDeferredLoading } from '@talex-touch/tuffex/skeleton'

/**
 * The topic list itself, in both of Discourse's shapes: a five-column table on
 * desktop, one card item per topic below 1024px. The caller owns filtering and
 * paging; this only renders the slice it is handed.
 */
const props = withDefaults(defineProps<{
  topics: Topic[]
  total: number
  currentPage: number
  pageSize?: number
  /** Controlled sort; the caller orders the whole list, not this page. */
  sort?: DataTableSortState | null
}>(), {
  pageSize: TOPIC_PAGE_SIZE,
  sort: null,
})

const emit = defineEmits<{
  'update:currentPage': [page: number]
  'update:sort': [sort: DataTableSortState | null]
}>()

const forum = useForumStore()
const router = useRouter()
const { isDesktop } = useShell()
const { fromNow, formatAbsolute } = useRelativeTime()

/**
 * The mock store answers synchronously, so there is no wait to show a skeleton
 * for. The first paint gets one anyway — it is the affordance that keeps the
 * list from appearing out of nowhere (R7) — and it lives here rather than in
 * each page, so `/`, `/c/[slug]` and `/tag/[slug]` cannot drift apart.
 *
 * `delay: 0` because there is no slow response to wait out; `minDuration` still
 * stops the skeleton from vanishing half-drawn.
 */
const FIRST_PAINT_MS = 32
const firstPaint = ref(true)

onMounted(() => {
  setTimeout(() => {
    firstPaint.value = false
  }, FIRST_PAINT_MS)
})

const showSkeleton = useDeferredLoading(firstPaint, { delay: 0, minDuration: 400 })

const pageCount = computed(() => Math.max(1, Math.ceil(props.total / props.pageSize)))
const rangeStart = computed(() => (props.currentPage - 1) * props.pageSize + 1)
const rangeEnd = computed(() => Math.min(props.currentPage * props.pageSize, props.total))

// No `sorter` on the sortable columns: the table runs in controlled mode
// (`sort` + `sortOnClient="false"`), so clicking a header only reports the
// request and the caller re-orders every topic before slicing this page.
const columns = computed<DataTableColumn<Topic>[]>(() => [
  { key: 'topic', title: '话题', auto: true },
  { key: 'posters', title: '发帖者', width: 140 },
  { key: 'replies', title: '回复', width: 80, align: 'right', sortable: true },
  { key: 'views', title: '浏览', width: 80, align: 'right', sortable: true, dataIndex: 'views' },
  { key: 'activity', title: '活动', width: 110, sortable: true, dataIndex: 'lastActivityAt' },
])

function open(topic: Topic) {
  void router.push(`/t/${topic.id}`)
}

function tagsOf(topic: Topic) {
  return topic.tagIds.map(id => forum.tagById(id)).filter(tag => tag !== undefined)
}

/**
 * Discourse only summarises pinned topics in the list. Built once per page
 * rather than per cell: the template needs the value twice (to decide whether
 * to render the line, and to fill it).
 */
const excerpts = computed(() => new Map(
  props.topics
    .filter(topic => topic.pinned)
    .map(topic => [topic.id, postExcerpt(forum.firstPostOf(topic.id)?.content ?? '')]),
))
</script>

<template>
  <TxStack :gap="16">
    <!--
      The skeleton mirrors a full page of rows (spec: same row count, or the
      page still jumps when the data lands), not design §5.2's literal 10.
    -->
    <TxCard v-if="showSkeleton" variant="plain">
      <TxRowSkeleton :rows="pageSize" leading description trailing separated />
    </TxCard>

    <TxEmptyState
      v-else-if="!topics.length"
      variant="search-empty"
      title="没有话题"
      description="换个筛选条件试试"
    />

    <TxDataTable
      v-else-if="isDesktop"
      hover
      :data="topics"
      :columns="columns"
      row-key="id"
      :sort="sort"
      :sort-on-client="false"
      @row-click="open($event.row)"
      @sort-change="emit('update:sort', $event)"
    >
      <template #cell-topic="{ row }: { row: Topic }">
        <TxFlex direction="column" :gap="4">
          <TxFlex align="center" :gap="6" wrap="wrap">
            <TxStatusBadge v-if="row.pinned" text="已置顶" icon="i-carbon-pin" status="muted" size="sm" />
            <TxStatusBadge v-if="row.closed" text="已关闭" icon="i-carbon-locked" status="muted" size="sm" />
            <span class="font-medium">{{ row.title }}</span>
          </TxFlex>
          <TxFlex align="center" :gap="6" wrap="wrap">
            <CategoryTag :category="forum.categoryById(row.categoryId)" />
            <TxTag v-for="tag in tagsOf(row)" :key="tag.id" :label="tag.name" variant="plain" size="sm" />
          </TxFlex>
          <span v-if="excerpts.get(row.id)" class="line-clamp-2 text-sm text-$tx-text-color-secondary">
            {{ excerpts.get(row.id) }}
          </span>
        </TxFlex>
      </template>

      <template #cell-posters="{ row }: { row: Topic }">
        <TxAvatarGroup :max="5" size="small">
          <UserAvatar v-for="user in forum.participants(row.id)" :key="user.id" :user="user" />
        </TxAvatarGroup>
      </template>

      <template #cell-replies="{ row }: { row: Topic }">
        {{ forum.replyCount(row.id) }}
      </template>

      <template #cell-activity="{ row }: { row: Topic }">
        <TxTooltip :content="formatAbsolute(row.lastActivityAt)">
          <span class="text-$tx-text-color-secondary">{{ fromNow(row.lastActivityAt) }}</span>
        </TxTooltip>
      </template>
    </TxDataTable>

    <TxCard v-else variant="plain" :padding="0">
      <TxStack :gap="0">
        <template v-for="(topic, index) in topics" :key="topic.id">
          <TopicRow :topic="topic" />
          <TxDivider v-if="index < topics.length - 1" />
        </template>
      </TxStack>
    </TxCard>

    <TxPagination
      v-if="!showSkeleton && pageCount > 1"
      :current-page="currentPage"
      :page-size="pageSize"
      :total="total"
      show-info
      prev-label="上一页"
      next-label="下一页"
      aria-label="话题分页"
      @update:current-page="emit('update:currentPage', $event)"
    >
      <template #info>
        第 {{ rangeStart }}–{{ rangeEnd }} 个，共 {{ total }} 个话题
      </template>
    </TxPagination>
  </TxStack>
</template>

<script lang="ts">
import { ref } from "vue";

/** 展开了哪些人（按 person.key）：放在组件外面，进详情再返回列表时还是展开的；刷新页面就收起。 */
const expandedPeople = ref<ReadonlySet<string>>(new Set());
</script>

<script setup lang="ts">
import { computed, watch } from "vue";
import { useRoute, useRouter } from "vue-router";
import { TxCard } from "@talex-touch/tuffex/card";
import { TxDataTable } from "@talex-touch/tuffex/data-table";
import { TxFilterChips } from "@talex-touch/tuffex/filter-chips";
import { TxSearchInput } from "@talex-touch/tuffex/search-input";
import { TxButton } from "@talex-touch/tuffex/button";
import { TxCellLink } from "@talex-touch/tuffex/cell-link";
import { TxEmptyState } from "@talex-touch/tuffex/empty-state";
import { TxPagination } from "@talex-touch/tuffex/pagination";
import { TxTag } from "@talex-touch/tuffex/tag";
import { TxTooltip } from "@talex-touch/tuffex/tooltip";
import PageHeader from "../components/PageHeader.vue";
import ToneTag from "../components/ToneTag.vue";
import ErrorPanel from "../components/ErrorPanel.vue";
import LoadingBlock from "../components/LoadingBlock.vue";
import { api } from "../lib/http";
import { fmtDate, fmtRelative } from "../lib/format";
import { isMock } from "../lib/runtime";
import { useResource } from "../lib/resource";
import { useSession } from "../lib/session";
import { toneColor } from "../lib/titles";
import { APPLICATION_STATUS, APPLICATION_STATUSES, isApplicationStatus, statusMeta } from "../lib/statuses";
import { listRows, listSummary, reasonLabels, toggleExpanded, totalCount, type ListRow } from "../lib/application-groups";
import type { ApplicationList } from "../lib/types";

const PAGE_SIZE = 20;
const route = useRoute();
const router = useRouter();
const { can, catalogue } = useSession();

const status = computed(() => (isApplicationStatus(route.query.status) ? route.query.status : ""));
const q = computed(() => (typeof route.query.q === "string" ? route.query.q : ""));
const page = computed(() => Math.max(1, Number(route.query.page) || 1));
const draft = ref(q.value);
watch(q, value => { draft.value = value; });

const list = useResource(() => {
  const query = new URLSearchParams({ limit: String(PAGE_SIZE), offset: String((page.value - 1) * PAGE_SIZE) });
  if (status.value) query.set("status", status.value);
  if (q.value) query.set("q", q.value);
  return api<ApplicationList>(`/api/console/applications?${query}`);
}, [status, q, page]);

function setQuery(next: Record<string, string | undefined>) {
  const merged: Record<string, string> = {};
  for (const [key, value] of Object.entries({ ...route.query, ...next })) if (typeof value === "string" && value) merged[key] = value;
  void router.replace({ query: merged });
}

const chips = computed(() => [
  { value: "", label: "全部", count: totalCount(list.data.value?.counts) },
  ...APPLICATION_STATUSES.map(id => ({ value: id, label: APPLICATION_STATUS[id].label, count: list.data.value?.counts[id] ?? 0, dot: toneColor(APPLICATION_STATUS[id].tone, catalogue.value) })),
]);
const summary = computed(() => (list.data.value ? listSummary(list.data.value, status.value, Boolean(q.value)) : ""));

const rows = computed(() => listRows(list.data.value?.items ?? [], expandedPeople.value));
function toggle(key: string) {
  expandedPeople.value = toggleExpanded(expandedPeople.value, key);
}
const rowClass = (row: ListRow): Record<string, boolean> => ({ "is-history": row.kind === "history", "is-open": row.kind === "person" && row.expanded });

const columns = [
  { key: "name", title: "姓名", width: 150 },
  { key: "email", title: "邮箱", width: 200 },
  { key: "strengths", title: "特长摘要" },
  { key: "status", title: "状态", width: 120 },
  { key: "created_at", title: "投递时间", width: 130, align: "right" as const },
];
const applicationId = (row: ListRow) => (row.kind === "person" ? row.item.id : row.application.id);
const detailHref = (row: ListRow) => `/console/applications/${applicationId(row)}`;
const shownOf = (row: ListRow) => (row.kind === "person" ? row.item : row.application);
/** 导出和列表同一个口径：带上当前的状态筛选和搜索词（#184） */
const exportHref = computed(() => {
  const query = new URLSearchParams();
  if (status.value) query.set("status", status.value);
  if (q.value) query.set("q", q.value);
  const search = query.toString();
  return `/api/console/applications/export.csv${search ? `?${search}` : ""}`;
});
</script>

<template>
  <div class="page">
    <PageHeader title="投递管理" description="官网「投递简历」收到的投递。同一邮箱或姓名班级相同的投递算同一个人，合成一行。打开详情和导出都会记入审计日志。">
      <template #actions>
        <template v-if="can('applications.export')">
          <TxTooltip v-if="isMock()" content="开发预览不能导出，请连接本地后端">
            <TxButton icon="i-carbon-download" disabled>导出 CSV</TxButton>
          </TxTooltip>
          <a v-else :href="exportHref" download class="export-link">
            <TxButton icon="i-carbon-download" tabindex="-1">导出 CSV</TxButton>
          </a>
        </template>
      </template>
    </PageHeader>

    <div class="toolbar">
      <TxFilterChips :model-value="status" :items="chips" aria-label="按状态筛选" @update:model-value="value => setQuery({ status: String(value) || undefined, page: undefined })" />
      <form class="toolbar__end" role="search" @submit.prevent="setQuery({ q: draft.trim() || undefined, page: undefined })">
        <TxSearchInput v-model="draft" placeholder="搜索姓名、班级或邮箱" class="search" @search="setQuery({ q: draft.trim() || undefined, page: undefined })" @clear="setQuery({ q: undefined, page: undefined })" />
      </form>
    </div>

    <ErrorPanel v-if="list.error.value" :error="list.error.value" :retry="list.reload" />
    <LoadingBlock v-else-if="!list.data.value" :lines="8" />
    <template v-else>
      <p class="list-summary" aria-live="polite">{{ summary }}</p>
      <TxCard :padding="0" class="table-card">
        <TxDataTable
          style="--table-min: 760px"
          :columns="columns"
          :data="rows"
          :row-key="(row: ListRow) => row.key"
          :row-class="rowClass"
          table-layout="fixed"
          scroll-x
          :loading="list.loading.value"
          @row-click="({ row }: { row: ListRow }) => router.push(detailHref(row))"
        >
          <template #cell-name="{ row }: { row: ListRow }">
            <span v-if="row.kind === 'person'" class="cell-stack">
              <TxCellLink :href="detailHref(row)" :label="row.item.name" @open="router.push(detailHref(row))" />
              <span class="cell-sub">{{ row.item.class_name }}</span>
              <TxButton
                v-if="row.expandable"
                variant="bare"
                size="sm"
                :icon="row.expanded ? 'i-carbon-chevron-up' : 'i-carbon-chevron-down'"
                class="person-toggle"
                :aria-expanded="row.expanded"
                :aria-label="`${row.expanded ? '收起' : '展开'} ${row.item.name} 的 ${row.shown} 份投递`"
                @click.stop="toggle(row.personKey)"
              >
                {{ row.expanded ? "收起" : `${row.shown} 份投递` }}
              </TxButton>
              <span v-if="row.hidden" class="cell-sub">另有 {{ row.hidden }} 份不在当前筛选里</span>
            </span>
            <span v-else class="cell-stack history-name">
              <span v-if="row.nameDiffers" class="cell-sub">{{ row.application.name }} · {{ row.application.class_name }}</span>
              <span class="reason-tags">
                <TxTag v-for="label in reasonLabels(row.application.linked_by)" :key="label" :label="label" variant="plain" size="sm" />
              </span>
              <!-- 窄屏时状态和时间两列要横向滚动才看得到，历次投递在第一列里再写一遍 -->
              <span class="history-compact">
                <ToneTag :tone="statusMeta(row.application.status).tone" :label="statusMeta(row.application.status).label" />
                <span class="cell-sub">{{ fmtDate(row.application.created_at) }}</span>
              </span>
            </span>
          </template>
          <template #cell-email="{ row }: { row: ListRow }">
            <span class="cell-stack">
              <span class="mono ellipsis cell-email" :title="shownOf(row).email">{{ shownOf(row).email }}</span>
              <span v-if="row.kind === 'person' && row.item.person?.reasons.length && !row.expanded" class="reason-tags">
                <TxTag v-for="label in reasonLabels(row.item.person.reasons)" :key="label" :label="label" variant="plain" size="sm" />
              </span>
            </span>
          </template>
          <template #cell-strengths="{ row }: { row: ListRow }">
            <span class="clamp-2 muted">{{ shownOf(row).strengths_excerpt }}</span>
          </template>
          <template #cell-status="{ row }: { row: ListRow }">
            <span class="cell-stack">
              <ToneTag :tone="statusMeta(shownOf(row).status).tone" :label="statusMeta(shownOf(row).status).label" />
              <span v-if="shownOf(row).last_review" class="cell-sub mono">@{{ shownOf(row).last_review!.reviewer }}</span>
            </span>
          </template>
          <template #cell-created_at="{ row }: { row: ListRow }">
            <span v-if="row.kind === 'person'" class="muted" :title="fmtDate(row.item.created_at)">{{ fmtRelative(row.item.created_at) }}</span>
            <span v-else class="cell-stack history-time">
              <span class="muted">{{ fmtRelative(row.application.created_at) }}</span>
              <span class="cell-sub">{{ fmtDate(row.application.created_at) }}</span>
            </span>
          </template>
          <template #empty>
            <TxEmptyState
              :variant="q || status ? 'search-empty' : 'no-data'"
              :title="q || status ? '没有符合条件的投递' : '还没有收到投递'"
              :description="q || status ? '换一个状态或关键词再试。' : '官网有人投递后会出现在这里。'"
              size="small"
            />
          </template>
        </TxDataTable>
        <div v-if="list.data.value.total > PAGE_SIZE" class="pager">
          <TxPagination :current-page="page" :page-size="PAGE_SIZE" :total="list.data.value.total" show-info @update:current-page="(value: number) => setQuery({ page: value > 1 ? String(value) : undefined })" />
        </div>
      </TxCard>
    </template>
  </div>
</template>

<style scoped>
.search {
  width: min(280px, 100%);
}
.export-link {
  text-decoration: none;
}
.list-summary {
  margin: -4px 0 0;
  font-size: 13px;
  line-height: 20px;
  color: var(--tx-text-color-secondary);
}
.table-card :deep(tbody tr) {
  cursor: pointer;
}
.cell-email {
  display: block;
  color: var(--tx-text-color-regular);
}
.person-toggle {
  margin-top: 2px;
  font-size: 12px;
}
.reason-tags {
  display: flex;
  flex-wrap: wrap;
  gap: 4px;
}
/* 展开后的历次投递：浅底、首列缩进并在左边画一条竖线，看得出是上面那个人的 */
.table-card :deep(tr.is-history > td) {
  background: var(--tx-fill-color-lighter);
}
.table-card :deep(tr.is-history > td:first-child) {
  padding-left: 28px;
  box-shadow: inset 14px 0 0 var(--tx-fill-color-lighter), inset 16px 0 0 var(--tx-border-color);
}
.table-card :deep(tr.is-open > td) {
  border-bottom-color: transparent;
}
.history-time {
  align-items: flex-end;
}
.history-compact {
  display: none;
}
.pager {
  display: flex;
  justify-content: flex-end;
  padding: 12px 16px;
  border-top: 1px solid var(--tx-border-color-lighter);
}
@media (max-width: 900px) {
  .history-compact {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 2px 6px;
  }
  .toolbar__end {
    margin-left: 0;
    width: 100%;
  }
  .search {
    width: 100%;
  }
}
</style>

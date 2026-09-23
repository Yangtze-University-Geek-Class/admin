<script setup lang="ts">
import { computed, ref, watch } from "vue";
import { useRoute, useRouter } from "vue-router";
import { TxCard } from "@talex-touch/tuffex/card";
import { TxDataTable } from "@talex-touch/tuffex/data-table";
import { TxFilterChips } from "@talex-touch/tuffex/filter-chips";
import { TxSearchInput } from "@talex-touch/tuffex/search-input";
import { TxButton } from "@talex-touch/tuffex/button";
import { TxCellLink } from "@talex-touch/tuffex/cell-link";
import { TxEmptyState } from "@talex-touch/tuffex/empty-state";
import { TxPagination } from "@talex-touch/tuffex/pagination";
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
import { APPLICATION_STATUS, APPLICATION_STATUSES, isApplicationStatus } from "../lib/statuses";
import type { ApplicationItem, ApplicationList } from "../lib/types";

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

const total = computed(() => Object.values(list.data.value?.counts ?? {}).reduce((sum, n) => sum + n, 0));
const chips = computed(() => [
  { value: "", label: "全部", count: total.value },
  ...APPLICATION_STATUSES.map(id => ({ value: id, label: APPLICATION_STATUS[id].label, count: list.data.value?.counts[id] ?? 0, dot: toneColor(APPLICATION_STATUS[id].tone, catalogue.value) })),
]);

const columns = [
  { key: "name", title: "姓名", width: 150 },
  { key: "email", title: "邮箱", width: 220 },
  { key: "strengths", title: "特长摘要" },
  { key: "status", title: "状态", width: 150 },
  { key: "created_at", title: "投递时间", width: 110, align: "right" as const },
];
const detailHref = (row: ApplicationItem) => `/console/applications/${row.id}`;
const exportHref = computed(() => `/api/console/applications/export.csv${status.value ? `?status=${status.value}` : ""}`);
</script>

<template>
  <div class="page">
    <PageHeader title="投递管理" description="官网「投递简历」收到的投递。打开详情和导出都会记入审计日志。">
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
    <TxCard v-else :padding="0" class="table-card">
      <TxDataTable style="--table-min: 860px" :columns="columns" :data="list.data.value.items" row-key="id" table-layout="fixed" scroll-x :loading="list.loading.value" @row-click="({ row }: { row: ApplicationItem }) => router.push(detailHref(row))">
        <template #cell-name="{ row }: { row: ApplicationItem }">
          <span class="cell-stack">
            <TxCellLink :href="detailHref(row)" :label="row.name" @open="router.push(detailHref(row))" />
            <span class="cell-sub">{{ row.class_name }}</span>
          </span>
        </template>
        <template #cell-email="{ row }: { row: ApplicationItem }">
          <span class="mono ellipsis cell-email" :title="row.email">{{ row.email }}</span>
        </template>
        <template #cell-strengths="{ row }: { row: ApplicationItem }">
          <span class="clamp-2 muted">{{ row.strengths_excerpt }}</span>
        </template>
        <template #cell-status="{ row }: { row: ApplicationItem }">
          <span class="cell-stack">
            <ToneTag :tone="APPLICATION_STATUS[row.status].tone" :label="APPLICATION_STATUS[row.status].label" />
            <span v-if="row.last_review" class="cell-sub mono">@{{ row.last_review.reviewer }}</span>
          </span>
        </template>
        <template #cell-created_at="{ row }: { row: ApplicationItem }">
          <span class="muted" :title="fmtDate(row.created_at)">{{ fmtRelative(row.created_at) }}</span>
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
  </div>
</template>

<style scoped>
.search {
  width: min(280px, 100%);
}
.export-link {
  text-decoration: none;
}
.table-card :deep(tbody tr) {
  cursor: pointer;
}
.cell-email {
  display: block;
  color: var(--tx-text-color-regular);
}
.pager {
  display: flex;
  justify-content: flex-end;
  padding: 12px 16px;
  border-top: 1px solid var(--tx-border-color-lighter);
}
@media (max-width: 900px) {
  .toolbar__end {
    margin-left: 0;
    width: 100%;
  }
  .search {
    width: 100%;
  }
}
</style>

<script setup lang="ts">
import { computed } from "vue";
import { useRoute, useRouter } from "vue-router";
import { TxCard } from "@talex-touch/tuffex/card";
import { TxDataTable } from "@talex-touch/tuffex/data-table";
import { TxFilterChips } from "@talex-touch/tuffex/filter-chips";
import { TxTag } from "@talex-touch/tuffex/tag";
import { TxEmptyState } from "@talex-touch/tuffex/empty-state";
import { TxPagination } from "@talex-touch/tuffex/pagination";
import PageHeader from "../components/PageHeader.vue";
import ErrorPanel from "../components/ErrorPanel.vue";
import LoadingBlock from "../components/LoadingBlock.vue";
import { api } from "../lib/http";
import { fmtDate, fmtRelative } from "../lib/format";
import { useResource } from "../lib/resource";
import type { AuditRow } from "../lib/types";

const PAGE_SIZE = 50;
/** 动作按前缀分类（服务端 `action` 参数按前缀匹配）。 */
const GROUPS = [
  { value: "", label: "全部" },
  { value: "application", label: "投递" },
  { value: "role", label: "称号" },
  { value: "department", label: "部门" },
  { value: "feedback", label: "意见" },
  { value: "invite", label: "邀请" },
  { value: "repo", label: "仓库" },
  { value: "team", label: "团队" },
  { value: "member", label: "成员" },
  { value: "org", label: "组织资料" },
];

const route = useRoute();
const router = useRouter();
const action = computed(() => (typeof route.query.action === "string" && GROUPS.some(g => g.value === route.query.action) ? route.query.action : ""));
const page = computed(() => Math.max(1, Number(route.query.page) || 1));
const logs = useResource(() => {
  const query = new URLSearchParams({ limit: String(PAGE_SIZE + 1), offset: String((page.value - 1) * PAGE_SIZE) });
  if (action.value) query.set("action", action.value);
  return api<{ logs: AuditRow[] }>(`/api/console/audit?${query}`);
}, [action, page]);

/** 多取一条来判断有没有下一页（接口不返回总数）。 */
const rows = computed(() => (logs.data.value?.logs ?? []).slice(0, PAGE_SIZE));
const hasNext = computed(() => (logs.data.value?.logs.length ?? 0) > PAGE_SIZE);
const setQuery = (next: Record<string, string | undefined>) => void router.replace({ query: { ...route.query, ...next } });

function detailText(details: unknown): string {
  if (!details || typeof details !== "object") return details == null ? "" : String(details);
  return Object.entries(details as Record<string, unknown>)
    .filter(([, value]) => value !== null && value !== undefined && value !== "")
    .map(([key, value]) => `${key}=${typeof value === "object" ? JSON.stringify(value) : String(value)}`)
    .join("  ");
}

const columns = [
  { key: "time", title: "时间", width: 150 },
  { key: "actor", title: "操作人", width: 120 },
  { key: "action", title: "动作", width: 160 },
  { key: "target", title: "对象与详情" },
  { key: "ip", title: "IP", width: 110 },
];
</script>

<template>
  <div class="page">
    <PageHeader title="审计日志" description="控制台和 GitHub 组织管理里的写操作，以及投递的查看与导出。登录、官网投递这类全站事件不在这里。" />

    <TxFilterChips :model-value="action" :items="GROUPS" aria-label="按动作筛选" @update:model-value="value => setQuery({ action: value ? String(value) : undefined, page: undefined })" />

    <ErrorPanel v-if="logs.error.value" :error="logs.error.value" :retry="logs.reload" />
    <LoadingBlock v-else-if="!logs.data.value" :lines="10" />
    <TxCard v-else :padding="0">
      <TxDataTable style="--table-min: 690px" :columns="columns" :data="rows" row-key="id" table-layout="fixed" scroll-x :loading="logs.loading.value">
        <template #cell-time="{ row }: { row: AuditRow }">
          <span class="cell-stack">
            <span>{{ fmtRelative(row.created_at) }}</span>
            <span class="cell-sub mono ellipsis" :title="fmtDate(row.created_at)">{{ fmtDate(row.created_at) }}</span>
          </span>
        </template>
        <template #cell-actor="{ row }: { row: AuditRow }">
          <span class="mono ellipsis" :title="row.actor">@{{ row.actor }}</span>
        </template>
        <template #cell-action="{ row }: { row: AuditRow }">
          <TxTag :label="row.action" size="sm" variant="soft" class="mono" />
        </template>
        <template #cell-target="{ row }: { row: AuditRow }">
          <span class="cell-stack">
            <span class="mono ellipsis" :title="row.target ?? undefined">{{ row.target ?? "无" }}</span>
            <span v-if="detailText(row.details)" class="cell-sub mono ellipsis" :title="JSON.stringify(row.details)">{{ detailText(row.details) }}</span>
          </span>
        </template>
        <template #cell-ip="{ row }: { row: AuditRow }">
          <span class="mono muted">{{ row.ip ?? "无" }}</span>
        </template>
        <template #empty>
          <TxEmptyState :title="action ? '这类动作还没有记录' : '还没有审计记录'" description="控制台里的写操作发生后会出现在这里。" size="small" />
        </template>
      </TxDataTable>
      <div v-if="page > 1 || hasNext" class="pager">
        <TxPagination :current-page="page" :total-pages="hasNext ? page + 1 : page" @update:current-page="(value: number) => setQuery({ page: value > 1 ? String(value) : undefined })" />
      </div>
    </TxCard>
  </div>
</template>

<style scoped>
.pager {
  display: flex;
  justify-content: flex-end;
  padding: 12px 16px;
  border-top: 1px solid var(--tx-border-color-lighter);
}
</style>

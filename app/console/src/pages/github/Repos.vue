<script setup lang="ts">
import { computed } from "vue";
import { useRoute, useRouter } from "vue-router";
import { TxCard } from "@talex-touch/tuffex/card";
import { TxDataTable } from "@talex-touch/tuffex/data-table";
import { TxButton } from "@talex-touch/tuffex/button";
import { TxTag } from "@talex-touch/tuffex/tag";
import { TxCellLink } from "@talex-touch/tuffex/cell-link";
import { TxFilterChips } from "@talex-touch/tuffex/filter-chips";
import { TxEmptyState } from "@talex-touch/tuffex/empty-state";
import PageHeader from "../../components/PageHeader.vue";
import ErrorPanel from "../../components/ErrorPanel.vue";
import LoadingBlock from "../../components/LoadingBlock.vue";
import { api } from "../../lib/http";
import { fmtDate, fmtRelative } from "../../lib/format";
import { useOrg } from "../../lib/github";
import { useResource } from "../../lib/resource";

type Repo = {
  name: string; description: string | null; visibility: string; archived: boolean; default_branch: string; size_kb: number;
  language: string | null; stargazers_count: number; open_issues_count: number; pushed_at: string; topics: string[];
};

const route = useRoute();
const router = useRouter();
const { apiBase, can, base } = useOrg();
const repos = useResource(() => api<{ repos: Repo[] }>(`${apiBase.value}/repos`), [apiBase]);

const filter = computed(() => (["public", "private", "archived"].includes(String(route.query.filter)) ? String(route.query.filter) : ""));
const all = computed(() => [...(repos.data.value?.repos ?? [])].sort((a, b) => Date.parse(b.pushed_at) - Date.parse(a.pushed_at)));
const rows = computed(() => all.value.filter(repo =>
  filter.value === "archived" ? repo.archived : filter.value ? !repo.archived && repo.visibility === filter.value : !repo.archived));
const chips = computed(() => [
  { value: "", label: "使用中", count: all.value.filter(r => !r.archived).length },
  { value: "public", label: "公开", count: all.value.filter(r => !r.archived && r.visibility === "public").length },
  { value: "private", label: "私有", count: all.value.filter(r => !r.archived && r.visibility === "private").length },
  { value: "archived", label: "已归档", count: all.value.filter(r => r.archived).length },
]);

const columns = [
  { key: "name", title: "仓库" },
  { key: "visibility", title: "可见性", width: 96 },
  { key: "language", title: "语言", width: 110 },
  { key: "issues", title: "未关闭 Issue", width: 110, align: "right" as const },
  { key: "pushed_at", title: "最近推送", width: 120, align: "right" as const },
];
const open = (repo: Repo) => router.push(`${base}/repos/${repo.name}`);
</script>

<template>
  <div class="page">
    <PageHeader title="仓库" description="组织里的全部仓库，按最近推送排序。">
      <template #actions>
        <TxButton v-if="can('github.repos.manage')" variant="primary" icon="i-carbon-add" @click="router.push(`${base}/repos/new`)">新建仓库</TxButton>
      </template>
    </PageHeader>

    <TxFilterChips :model-value="filter" :items="chips" aria-label="按类型筛选" @update:model-value="value => router.replace({ query: { filter: value ? String(value) : undefined } })" />

    <ErrorPanel v-if="repos.error.value" :error="repos.error.value" :retry="repos.reload" />
    <LoadingBlock v-else-if="!repos.data.value" :lines="8" />
    <TxCard v-else :padding="0" class="table-card">
      <TxDataTable style="--table-min: 640px" :columns="columns" :data="rows" row-key="name" table-layout="fixed" scroll-x @row-click="({ row }: { row: Repo }) => open(row)">
        <template #cell-name="{ row }: { row: Repo }">
          <span class="cell-stack">
            <TxCellLink :href="`${base}/repos/${row.name}`" :label="row.name" class="mono" @open="open(row)" />
            <span v-if="row.description" class="cell-sub ellipsis">{{ row.description }}</span>
          </span>
        </template>
        <template #cell-visibility="{ row }: { row: Repo }">
          <TxTag :label="row.archived ? '已归档' : row.visibility === 'private' ? '私有' : '公开'" size="sm" :variant="row.visibility === 'private' ? 'soft' : 'plain'" />
        </template>
        <template #cell-language="{ row }: { row: Repo }">
          <span class="muted">{{ row.language ?? "无" }}</span>
        </template>
        <template #cell-issues="{ row }: { row: Repo }">
          <span class="num">{{ row.open_issues_count }}</span>
        </template>
        <template #cell-pushed_at="{ row }: { row: Repo }">
          <span class="muted" :title="fmtDate(row.pushed_at)">{{ fmtRelative(row.pushed_at) }}</span>
        </template>
        <template #empty>
          <TxEmptyState :title="filter ? '这一类下没有仓库' : '组织还没有仓库'" size="small" />
        </template>
      </TxDataTable>
    </TxCard>
  </div>
</template>

<style scoped>
.table-card :deep(tbody tr) {
  cursor: pointer;
}
.num {
  font-variant-numeric: tabular-nums;
}
</style>

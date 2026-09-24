<script setup lang="ts">
import { TxCard } from "@talex-touch/tuffex/card";
import { TxDataTable } from "@talex-touch/tuffex/data-table";
import { TxButton } from "@talex-touch/tuffex/button";
import { TxStatusBadge } from "@talex-touch/tuffex/status-badge";
import { TxEmptyState } from "@talex-touch/tuffex/empty-state";
import { toast } from "@talex-touch/tuffex/utils";
import PageHeader from "../../components/PageHeader.vue";
import ErrorPanel from "../../components/ErrorPanel.vue";
import ErrorAlert from "../../components/ErrorAlert.vue";
import LoadingBlock from "../../components/LoadingBlock.vue";
import { api } from "../../lib/http";
import { confirm } from "../../lib/confirm";
import { fmtDate, fmtRelative } from "../../lib/format";
import { useOrg } from "../../lib/github";
import { useAction, useResource } from "../../lib/resource";

type Pending = { id: number; login: string | null; email: string | null; role: string; inviter?: { login?: string } | null; created_at: string };
type History = { id: number; github_login: string | null; email: string | null; note: string | null; invite_link_token: string | null; status: string; source_ip: string | null; created_at: number };

const { apiBase } = useOrg();
const data = useResource(() => api<{ pending: Pending[]; history: History[] }>(`${apiBase.value}/invitations`), [apiBase]);
const who = (row: { login?: string | null; github_login?: string | null; email: string | null }) => {
  const login = row.login ?? row.github_login;
  return login ? `@${login}` : row.email ?? "未知";
};

const cancel = useAction(async (row: Pending) => {
  await api(`${apiBase.value}/invitations/${row.id}`, { method: "DELETE" });
  toast({ title: "已取消邀请", description: who(row), variant: "success" });
  await data.reload();
});
async function askCancel(row: Pending) {
  if (await confirm({ title: `取消给 ${who(row)} 的邀请？`, body: "对方将不能再通过这份邀请加入。之后可以重新邀请。", confirmText: "取消邀请", danger: true })) await cancel.execute(row);
}

const pendingColumns = [
  { key: "who", title: "受邀人" },
  { key: "inviter", title: "邀请人", width: 160 },
  { key: "created_at", title: "发出时间", width: 140 },
  { key: "actions", title: "操作", width: 110, align: "right" as const },
];
const historyColumns = [
  { key: "who", title: "受邀人", width: 150 },
  { key: "note", title: "备注" },
  { key: "link", title: "邀请链接", width: 130 },
  { key: "status", title: "结果", width: 84 },
  { key: "ip", title: "来源 IP", width: 116 },
  { key: "created_at", title: "时间", width: 120 },
];
const STATUS: Record<string, { text: string; status: "success" | "danger" | "warning" | "muted" }> = {
  sent: { text: "已发出", status: "success" },
  failed: { text: "失败", status: "danger" },
  pending: { text: "待核对", status: "warning" },
};
</script>

<template>
  <div class="page">
    <PageHeader title="邀请" description="还没接受的 GitHub 组织邀请，以及通过本站邀请链接发出的记录。">
      <template #actions>
        <TxButton icon="i-carbon-renew" :loading="data.loading.value" @click="data.reload()">刷新</TxButton>
      </template>
    </PageHeader>
    <ErrorAlert v-if="cancel.error.value" :error="cancel.error.value" @close="cancel.reset()" />

    <ErrorPanel v-if="data.error.value" :error="data.error.value" :retry="data.reload" />
    <LoadingBlock v-else-if="!data.data.value" :lines="8" />
    <template v-else>
      <TxCard :padding="0">
        <template #header><div class="card-head table-head"><h2 class="section-title">待接受</h2><span class="count">{{ data.data.value.pending.length }} 份</span></div></template>
        <TxDataTable style="--table-min: 620px" :columns="pendingColumns" :data="data.data.value.pending" row-key="id" table-layout="fixed" scroll-x>
          <template #cell-who="{ row }: { row: Pending }"><span class="mono">{{ who(row) }}</span></template>
          <template #cell-inviter="{ row }: { row: Pending }"><span class="mono muted">{{ row.inviter?.login ? `@${row.inviter.login}` : "未知" }}</span></template>
          <template #cell-created_at="{ row }: { row: Pending }"><span class="muted" :title="fmtDate(row.created_at)">{{ fmtRelative(row.created_at) }}</span></template>
          <template #cell-actions="{ row }: { row: Pending }">
            <TxButton size="sm" variant="ghost" class="danger-text" :disabled="cancel.pending.value" @click="askCancel(row)">取消邀请</TxButton>
          </template>
          <template #empty><TxEmptyState title="没有待接受的邀请" size="small" /></template>
        </TxDataTable>
      </TxCard>

      <TxCard :padding="0">
        <template #header><div class="card-head table-head"><h2 class="section-title">本站发出的记录</h2><span class="count">{{ data.data.value.history.length }} 条</span></div></template>
        <TxDataTable style="--table-min: 680px" :columns="historyColumns" :data="data.data.value.history" row-key="id" table-layout="fixed" scroll-x>
          <template #cell-who="{ row }: { row: History }"><span class="mono">{{ who(row) }}</span></template>
          <template #cell-note="{ row }: { row: History }"><span :class="{ muted: !row.note }">{{ row.note ?? "无" }}</span></template>
          <template #cell-link="{ row }: { row: History }"><span class="mono muted ellipsis">{{ row.invite_link_token ?? "无" }}</span></template>
          <template #cell-status="{ row }: { row: History }">
            <TxStatusBadge :text="STATUS[row.status]?.text ?? row.status" :status="STATUS[row.status]?.status ?? 'muted'" size="sm" />
          </template>
          <template #cell-ip="{ row }: { row: History }"><span class="mono muted">{{ row.source_ip ?? "无" }}</span></template>
          <template #cell-created_at="{ row }: { row: History }"><span class="muted">{{ fmtDate(row.created_at) }}</span></template>
          <template #empty><TxEmptyState title="还没有通过本站发出的邀请" size="small" /></template>
        </TxDataTable>
      </TxCard>
    </template>
  </div>
</template>

<style scoped>
.table-head {
  padding: 4px 4px 0;
}
.danger-text {
  color: var(--tx-color-danger);
}
</style>

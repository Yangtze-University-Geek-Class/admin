<script setup lang="ts">
import { computed } from "vue";
import { TxCard } from "@talex-touch/tuffex/card";
import { TxDataTable } from "@talex-touch/tuffex/data-table";
import { TxButton } from "@talex-touch/tuffex/button";
import { TxTag } from "@talex-touch/tuffex/tag";
import { TxEmptyState } from "@talex-touch/tuffex/empty-state";
import { toast } from "@talex-touch/tuffex/utils";
import PageHeader from "../../components/PageHeader.vue";
import UserCell from "../../components/UserCell.vue";
import ErrorPanel from "../../components/ErrorPanel.vue";
import ErrorAlert from "../../components/ErrorAlert.vue";
import LoadingBlock from "../../components/LoadingBlock.vue";
import { api, jsonBody } from "../../lib/http";
import { confirm } from "../../lib/confirm";
import { useOrg } from "../../lib/github";
import { useAction, useResource } from "../../lib/resource";

type Member = { login: string; avatar_url: string | null; role: string; state: string };

const { apiBase, can } = useOrg();
const canManage = computed(() => can("github.members.manage"));
const members = useResource(() => api<{ members: Member[] }>(`${apiBase.value}/members`), [apiBase]);
/** 管理员在前，其余按登录名。 */
const rows = computed(() => [...(members.data.value?.members ?? [])].sort((a, b) => Number(b.role === "admin") - Number(a.role === "admin") || a.login.localeCompare(b.login)));

const columns = computed(() => [
  { key: "login", title: "成员" },
  { key: "role", title: "组织角色", width: 140 },
  { key: "state", title: "状态", width: 120 },
  ...(canManage.value ? [{ key: "actions", title: "操作", width: 220, align: "right" as const }] : []),
]);

const setRole = useAction(async (member: Member) => {
  const role = member.role === "admin" ? "member" : "admin";
  await api(`${apiBase.value}/members/${member.login}/role`, { method: "PATCH", ...jsonBody({ role }) });
  toast({ title: role === "admin" ? "已设为管理员" : "已改为普通成员", description: `@${member.login}`, variant: "success" });
  await members.reload();
});
const remove = useAction(async (member: Member) => {
  await api(`${apiBase.value}/members/${member.login}`, { method: "DELETE" });
  toast({ title: "已移出组织", description: `@${member.login}`, variant: "success" });
  await members.reload();
});

async function askRole(member: Member) {
  const toAdmin = member.role !== "admin";
  if (await confirm({ title: toAdmin ? `把 @${member.login} 设为组织管理员？` : `把 @${member.login} 改为普通成员？`, body: toAdmin ? "管理员可以管理组织的所有仓库、成员和设置。" : "对方会失去组织管理员权限。", confirmText: toAdmin ? "设为管理员" : "改为成员", danger: !toAdmin })) await setRole.execute(member);
}
async function askRemove(member: Member) {
  if (await confirm({ title: `把 @${member.login} 移出组织？`, body: "对方会失去组织和团队带来的全部仓库权限。之后可以重新邀请。", confirmText: "移出", danger: true })) await remove.execute(member);
}
</script>

<template>
  <div class="page">
    <PageHeader title="成员" :description="canManage ? 'GitHub 组织的正式成员。改角色、移出组织会直接改动 GitHub。' : 'GitHub 组织的正式成员。改角色或移出成员需要「管理组织成员」权限。'" />
    <ErrorAlert v-if="setRole.error.value" :error="setRole.error.value" @close="setRole.reset()" />
    <ErrorAlert v-if="remove.error.value" :error="remove.error.value" @close="remove.reset()" />

    <ErrorPanel v-if="members.error.value" :error="members.error.value" :retry="members.reload" />
    <LoadingBlock v-else-if="!members.data.value" :lines="8" />
    <TxCard v-else :padding="0">
      <template #header><div class="card-head table-head"><h2 class="section-title">全部成员</h2><span class="count">{{ rows.length }} 人</span></div></template>
      <TxDataTable style="--table-min: 640px" :columns="columns" :data="rows" row-key="login" table-layout="fixed" scroll-x>
        <template #cell-login="{ row }: { row: Member }">
          <UserCell :login="row.login" :src="row.avatar_url" link />
        </template>
        <template #cell-role="{ row }: { row: Member }">
          <TxTag :label="row.role === 'admin' ? '管理员' : '成员'" size="sm" :variant="row.role === 'admin' ? 'soft' : 'plain'" />
        </template>
        <template #cell-state="{ row }: { row: Member }">
          <span class="muted">{{ row.state === "active" ? "已加入" : row.state }}</span>
        </template>
        <template #cell-actions="{ row }: { row: Member }">
          <span class="row-actions">
            <TxButton size="sm" variant="ghost" :disabled="setRole.pending.value" @click="askRole(row)">{{ row.role === "admin" ? "改为成员" : "设为管理员" }}</TxButton>
            <TxButton size="sm" variant="ghost" class="danger-text" :disabled="remove.pending.value" @click="askRemove(row)">移出</TxButton>
          </span>
        </template>
        <template #empty>
          <TxEmptyState title="组织里还没有成员" size="small" />
        </template>
      </TxDataTable>
    </TxCard>
  </div>
</template>

<style scoped>
.table-head {
  padding: 4px 4px 0;
}
.row-actions {
  display: inline-flex;
  gap: 4px;
}
.danger-text {
  color: var(--tx-color-danger);
}
</style>

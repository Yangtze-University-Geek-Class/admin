<script setup lang="ts">
import { computed } from "vue";
import { useRouter } from "vue-router";
import { TxCard } from "@talex-touch/tuffex/card";
import { TxDataTable } from "@talex-touch/tuffex/data-table";
import { TxSelect } from "@talex-touch/tuffex/select";
import { TxButton } from "@talex-touch/tuffex/button";
import { TxTag } from "@talex-touch/tuffex/tag";
import { TxStatusBadge } from "@talex-touch/tuffex/status-badge";
import { toast } from "@talex-touch/tuffex/utils";
import UserCell from "../../../components/UserCell.vue";
import ErrorAlert from "../../../components/ErrorAlert.vue";
import { api, jsonBody } from "../../../lib/http";
import { confirm } from "../../../lib/confirm";
import { useOrg } from "../../../lib/github";
import { useAction } from "../../../lib/resource";
import type { Branch, Collaborator, RepoResponse } from "./types";

const props = defineProps<{ repoApi: string; detail: RepoResponse }>();
const emit = defineEmits<{ changed: [] }>();
const router = useRouter();
const { org, can, base } = useOrg();
const canManage = computed(() => can("github.repos.manage"));
const name = computed(() => props.detail.info.name);

const PERMISSIONS = [
  { value: "pull", label: "只读" }, { value: "triage", label: "分类" }, { value: "push", label: "可写" },
  { value: "maintain", label: "维护" }, { value: "admin", label: "管理" },
];
/** GitHub 的 role_name（read/write…）与接口参数（pull/push…）名字不同，这里对齐显示。 */
const ROLE_TO_PERMISSION: Record<string, string> = { read: "pull", pull: "pull", triage: "triage", write: "push", push: "push", maintain: "maintain", admin: "admin" };
const permissionLabel = (role: string) => PERMISSIONS.find(p => p.value === ROLE_TO_PERMISSION[role])?.label ?? role;

const setPermission = useAction(async (login: string, permission: string) => {
  await api(`${props.repoApi}/collaborators/${login}`, { method: "PUT", ...jsonBody({ permission }) });
  toast({ title: "权限已更新", description: `@${login}`, variant: "success" });
  emit("changed");
});
const removeCollaborator = useAction(async (login: string) => {
  await api(`${props.repoApi}/collaborators/${login}`, { method: "DELETE" });
  toast({ title: "已撤销额外权限", description: `@${login}`, variant: "success" });
  emit("changed");
});
async function askRemove(row: Collaborator) {
  if (await confirm({ title: `撤销 @${row.login} 在这个仓库的额外权限？`, body: "撤销后回到组织给所有成员的默认权限。", confirmText: "撤销", danger: true })) await removeCollaborator.execute(row.login);
}

const deleteRepo = useAction(async () => {
  await api(props.repoApi, { method: "DELETE" });
  toast({ title: "仓库已删除", description: name.value, variant: "success" });
  void router.push(`${base}/repos`);
});
async function askDelete() {
  if (await confirm({ title: `删除仓库 ${org.value}/${name.value}？`, body: "代码、Issue、合并请求、发布和 Wiki 都会被永久删除，不能恢复。请先确认已经备份。", confirmText: "我已备份，删除", danger: true })) await deleteRepo.execute();
}

const branchColumns = [{ key: "name", title: "分支" }, { key: "protected", title: "保护", width: 120 }];
const collaboratorColumns = computed(() => [
  { key: "login", title: "成员" },
  { key: "role", title: "仓库权限", width: 180 },
  ...(canManage.value ? [{ key: "actions", title: "操作", width: 100, align: "right" as const }] : []),
]);
</script>

<template>
  <div class="settings">
    <ErrorAlert v-if="setPermission.error.value || removeCollaborator.error.value" :error="setPermission.error.value ?? removeCollaborator.error.value" @close="setPermission.reset(); removeCollaborator.reset()" />

    <TxCard :padding="0">
      <template #header><div class="card-head table-head"><h2 class="section-title">分支</h2><span class="count">{{ detail.branches.length }} 个</span></div></template>
      <TxDataTable :columns="branchColumns" :data="detail.branches" row-key="name" max-height="320">
        <template #cell-name="{ row }: { row: Branch }">
          <span class="mono">{{ row.name }}</span>
          <TxTag v-if="row.name === detail.info.default_branch" label="默认" size="sm" variant="soft" class="default-tag" />
        </template>
        <template #cell-protected="{ row }: { row: Branch }">
          <TxStatusBadge :text="row.protected ? '受保护' : '未保护'" :status="row.protected ? 'success' : 'muted'" size="sm" />
        </template>
      </TxDataTable>
    </TxCard>

    <TxCard :padding="0">
      <template #header>
        <div class="card-head table-head">
          <h2 class="section-title">单独授权的成员</h2>
          <span class="count">{{ detail.collaborators.length }} 人</span>
        </div>
      </template>
      <p class="muted intro">组织成员默认按组织设置拿到权限；这里可以给某个人单独提高这个仓库的权限。</p>
      <TxDataTable style="--table-min: 520px" :columns="collaboratorColumns" :data="detail.collaborators" row-key="login" scroll-x>
        <template #cell-login="{ row }: { row: Collaborator }">
          <UserCell :login="row.login" :src="row.avatar_url" link />
        </template>
        <template #cell-role="{ row }: { row: Collaborator }">
          <TxSelect
            v-if="canManage"
            :model-value="ROLE_TO_PERMISSION[row.role] ?? 'pull'"
            :options="PERMISSIONS"
            :disabled="setPermission.pending.value"
            class="perm-select"
            @update:model-value="(v: string | number | Array<string | number>) => setPermission.execute(row.login, String(v))"
          />
          <TxTag v-else :label="permissionLabel(row.role)" size="sm" variant="plain" />
        </template>
        <template #cell-actions="{ row }: { row: Collaborator }">
          <TxButton size="sm" variant="ghost" class="danger-text" :disabled="removeCollaborator.pending.value" @click="askRemove(row)">撤销</TxButton>
        </template>
      </TxDataTable>
    </TxCard>

    <TxCard v-if="detail.hooks.length">
      <template #header><h2 class="section-title">Webhook（{{ detail.hooks.length }}）</h2></template>
      <ul class="hooks">
        <li v-for="hook in detail.hooks" :key="hook.id">
          <TxStatusBadge :text="hook.active ? '启用' : '停用'" :status="hook.active ? 'success' : 'muted'" size="sm" />
          <span class="mono ellipsis">{{ hook.url ?? hook.name }}</span>
        </li>
      </ul>
    </TxCard>

    <TxCard v-if="canManage" class="danger-zone">
      <template #header><h2 class="section-title danger-title">删除仓库</h2></template>
      <p class="muted">永久删除这个仓库的代码、Issue、合并请求、发布和 Wiki，不能恢复。</p>
      <ErrorAlert v-if="deleteRepo.error.value" :error="deleteRepo.error.value" @close="deleteRepo.reset()" />
      <TxButton variant="danger" icon="i-carbon-trash-can" :loading="deleteRepo.pending.value" @click="askDelete">删除仓库</TxButton>
    </TxCard>
  </div>
</template>

<style scoped>
.settings {
  display: flex;
  flex-direction: column;
  gap: 16px;
}
.table-head {
  padding: 4px 4px 0;
}
.intro {
  margin: 0;
  padding: 0 16px 8px;
  font-size: 13px;
}
.default-tag {
  margin-left: 8px;
}
.perm-select {
  width: 140px;
}
.danger-text {
  color: var(--tx-color-danger);
}
.hooks {
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: 8px;
}
.hooks li {
  display: flex;
  align-items: center;
  gap: 8px;
  min-width: 0;
}
.danger-zone {
  border: 1px solid color-mix(in srgb, var(--tx-color-danger) 30%, transparent);
}
.danger-title {
  color: var(--tx-color-danger);
}
.danger-zone p {
  margin: 0 0 12px;
}
</style>

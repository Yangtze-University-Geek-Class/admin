<script setup lang="ts">
import { computed, reactive, ref } from "vue";
import { TxCard } from "@talex-touch/tuffex/card";
import { TxDataTable } from "@talex-touch/tuffex/data-table";
import { TxButton } from "@talex-touch/tuffex/button";
import { TxTag } from "@talex-touch/tuffex/tag";
import { TxModal } from "@talex-touch/tuffex/modal";
import { TxForm, TxFormItem } from "@talex-touch/tuffex/form";
import { TxInput } from "@talex-touch/tuffex/input";
import { TxRadioGroup, TxRadio } from "@talex-touch/tuffex/radio";
import { TxEmptyState } from "@talex-touch/tuffex/empty-state";
import { toast } from "@talex-touch/tuffex/utils";
import PageHeader from "../../components/PageHeader.vue";
import ErrorPanel from "../../components/ErrorPanel.vue";
import ErrorAlert from "../../components/ErrorAlert.vue";
import LoadingBlock from "../../components/LoadingBlock.vue";
import { api, jsonBody } from "../../lib/http";
import { confirm } from "../../lib/confirm";
import { useOrg } from "../../lib/github";
import { useAction, useResource } from "../../lib/resource";

type Team = { name: string; slug: string; description: string | null; privacy: string; member_count: number; repo_count: number };

const { apiBase, can } = useOrg();
const canManage = computed(() => can("github.teams.manage"));
const teams = useResource(() => api<{ teams: Team[] }>(`${apiBase.value}/teams`), [apiBase]);

const columns = computed(() => [
  { key: "name", title: "团队" },
  { key: "privacy", title: "可见范围", width: 130 },
  { key: "member_count", title: "成员", width: 90, align: "right" as const },
  { key: "repo_count", title: "仓库", width: 90, align: "right" as const },
  ...(canManage.value ? [{ key: "actions", title: "操作", width: 100, align: "right" as const }] : []),
]);

const creating = ref(false);
const form = reactive({ name: "", description: "", privacy: "closed" as "closed" | "secret" });
function openCreate() {
  Object.assign(form, { name: "", description: "", privacy: "closed" });
  create.reset();
  creating.value = true;
}
const create = useAction(async () => {
  await api(`${apiBase.value}/teams`, { method: "POST", ...jsonBody({ name: form.name.trim(), description: form.description.trim(), privacy: form.privacy }) });
  toast({ title: "已新建团队", description: form.name.trim(), variant: "success" });
  creating.value = false;
  await teams.reload();
});
const remove = useAction(async (team: Team) => {
  await api(`${apiBase.value}/teams/${team.slug}`, { method: "DELETE" });
  toast({ title: "已删除团队", description: team.name, variant: "success" });
  await teams.reload();
});
async function askRemove(team: Team) {
  if (await confirm({ title: `删除团队「${team.name}」？`, body: `团队里 ${team.member_count} 名成员会失去通过它获得的仓库权限，${team.repo_count} 个仓库的团队授权也会一起移除。成员本身不会被移出组织。`, confirmText: "删除团队", danger: true })) await remove.execute(team);
}
</script>

<template>
  <div class="page">
    <PageHeader title="团队" description="GitHub 组织里的团队。仓库权限可以按团队授予。">
      <template #actions>
        <TxButton v-if="canManage" variant="primary" icon="i-carbon-add" @click="openCreate">新建团队</TxButton>
      </template>
    </PageHeader>
    <ErrorAlert v-if="remove.error.value" :error="remove.error.value" @close="remove.reset()" />

    <ErrorPanel v-if="teams.error.value" :error="teams.error.value" :retry="teams.reload" />
    <LoadingBlock v-else-if="!teams.data.value" :lines="6" />
    <TxCard v-else :padding="0">
      <TxDataTable style="--table-min: 640px" :columns="columns" :data="teams.data.value.teams" row-key="slug" table-layout="fixed" scroll-x>
        <template #cell-name="{ row }: { row: Team }">
          <span class="cell-stack">
            <strong class="team-name">{{ row.name }}</strong>
            <span class="cell-sub"><span class="mono">{{ row.slug }}</span><template v-if="row.description"> · {{ row.description }}</template></span>
          </span>
        </template>
        <template #cell-privacy="{ row }: { row: Team }">
          <TxTag :label="row.privacy === 'secret' ? '仅团队成员可见' : '组织内可见'" size="sm" variant="plain" />
        </template>
        <template #cell-actions="{ row }: { row: Team }">
          <TxButton size="sm" variant="ghost" class="danger-text" :disabled="remove.pending.value" @click="askRemove(row)">删除</TxButton>
        </template>
        <template #empty>
          <TxEmptyState title="还没有团队" :description="canManage ? '用右上角的「新建团队」创建第一个。' : '组织管理员创建后会出现在这里。'" size="small" />
        </template>
      </TxDataTable>
    </TxCard>

    <TxModal v-model="creating" title="新建团队" width="min(92vw, 480px)">
      <TxForm :model="form" label-position="top" @submit="form.name.trim() && create.execute()">
        <TxFormItem label="名称" required>
          <TxInput v-model="form.name" placeholder="例如 AI Native" />
        </TxFormItem>
        <TxFormItem label="说明（选填）">
          <TxInput v-model="form.description" placeholder="这个团队负责什么" />
        </TxFormItem>
        <TxFormItem label="可见范围">
          <TxRadioGroup v-model="form.privacy" type="standard" direction="column">
            <TxRadio value="closed" label="组织内可见：组织成员都能看到这个团队" />
            <TxRadio value="secret" label="仅团队成员可见" />
          </TxRadioGroup>
        </TxFormItem>
        <ErrorAlert v-if="create.error.value" :error="create.error.value" @close="create.reset()" />
      </TxForm>
      <template #footer>
        <div class="dialog-actions">
          <TxButton variant="secondary" @click="creating = false">取消</TxButton>
          <TxButton variant="primary" :disabled="!form.name.trim()" :loading="create.pending.value" @click="create.execute()">新建</TxButton>
        </div>
      </template>
    </TxModal>
  </div>
</template>

<style scoped>
.team-name {
  font-weight: 500;
}
.danger-text {
  color: var(--tx-color-danger);
}
.dialog-actions {
  display: flex;
  justify-content: flex-end;
  gap: 8px;
}
</style>

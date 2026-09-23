<script setup lang="ts">
import { computed, reactive, ref } from "vue";
import { TxCard } from "@talex-touch/tuffex/card";
import { TxDataTable } from "@talex-touch/tuffex/data-table";
import { TxButton, TxCopyButton } from "@talex-touch/tuffex/button";
import { TxStatusBadge } from "@talex-touch/tuffex/status-badge";
import { TxModal } from "@talex-touch/tuffex/modal";
import { TxForm, TxFormItem } from "@talex-touch/tuffex/form";
import { TxInput } from "@talex-touch/tuffex/input";
import { TxNumberInput } from "@talex-touch/tuffex/number-input";
import { TxSelect } from "@talex-touch/tuffex/select";
import { TxAlert } from "@talex-touch/tuffex/alert";
import { TxEmptyState } from "@talex-touch/tuffex/empty-state";
import { toast } from "@talex-touch/tuffex/utils";
import PageHeader from "../../components/PageHeader.vue";
import ErrorPanel from "../../components/ErrorPanel.vue";
import ErrorAlert from "../../components/ErrorAlert.vue";
import LoadingBlock from "../../components/LoadingBlock.vue";
import { api, jsonBody } from "../../lib/http";
import { confirm } from "../../lib/confirm";
import { fmtDate, fmtRelative } from "../../lib/format";
import { useOrg } from "../../lib/github";
import { useAction, useResource } from "../../lib/resource";
import { siteUrl } from "../../lib/runtime";

type Link = { token: string; note: string | null; max_uses: number; current_uses: number; expires_at: number; team_slug: string | null; disabled: number; created_by: string; created_at: number };
type Team = { name: string; slug: string };

const { apiBase } = useOrg();
const links = useResource(() => api<{ links: Link[] }>(`${apiBase.value}/invite-links`), [apiBase]);
const teams = useResource(() => api<{ teams: Team[] }>(`${apiBase.value}/teams`), [apiBase]);
const joinUrl = (token: string) => new URL(siteUrl("portal", `/join/${token}`), window.location.origin).toString();

function linkState(link: Link) {
  if (link.disabled) return { text: "已停用", status: "muted" as const };
  if (link.expires_at < Date.now()) return { text: "已过期", status: "danger" as const };
  if (link.current_uses >= link.max_uses) return { text: "次数用完", status: "warning" as const };
  return { text: "可用", status: "success" as const };
}

const columns = [
  { key: "link", title: "链接" },
  { key: "note", title: "备注", width: 160 },
  { key: "uses", title: "已用 / 上限", width: 110, align: "right" as const },
  { key: "expires", title: "到期", width: 150 },
  { key: "team", title: "自动加入团队", width: 130 },
  { key: "state", title: "状态", width: 100 },
  { key: "actions", title: "操作", width: 150, align: "right" as const },
];

const creating = ref(false);
const created = ref<string | null>(null);
const form = reactive({ hours: 72 as number | null, max_uses: 30 as number | null, note: "", team_slug: "" });
const teamOptions = computed(() => [{ value: "", label: "不加入团队" }, ...(teams.data.value?.teams ?? []).map(t => ({ value: t.slug, label: t.name, description: t.slug }))]);
function openCreate() {
  Object.assign(form, { hours: 72, max_uses: 30, note: "", team_slug: "" });
  created.value = null;
  create.reset();
  creating.value = true;
}
const create = useAction(async () => {
  const result = await api<{ token: string; url: string }>(`${apiBase.value}/invite-links`, {
    method: "POST",
    ...jsonBody({ hours: form.hours ?? 72, max_uses: form.max_uses ?? 30, note: form.note.trim(), team_slug: form.team_slug || null }),
  });
  created.value = result.url || joinUrl(result.token);
  await links.reload();
});
const toggle = useAction(async (link: Link) => {
  await api(`${apiBase.value}/invite-links/${link.token}`, { method: "PATCH", ...jsonBody({ disabled: !link.disabled }) });
  toast({ title: link.disabled ? "已启用" : "已停用", variant: "success" });
  await links.reload();
});
const remove = useAction(async (link: Link) => {
  await api(`${apiBase.value}/invite-links/${link.token}`, { method: "DELETE" });
  toast({ title: "已删除邀请链接", variant: "success" });
  await links.reload();
});
async function askRemove(link: Link) {
  if (await confirm({ title: "删除这条邀请链接？", body: "已经通过它发出的邀请不会撤回，只是以后不能再用这条链接。", confirmText: "删除", danger: true })) await remove.execute(link);
}
</script>

<template>
  <div class="page">
    <PageHeader title="邀请链接" description="生成一条有时限的链接发给新同学，对方填 GitHub 用户名后会自动收到组织邀请。">
      <template #actions>
        <TxButton variant="primary" icon="i-carbon-add" @click="openCreate">生成链接</TxButton>
      </template>
    </PageHeader>
    <ErrorAlert v-if="toggle.error.value" :error="toggle.error.value" @close="toggle.reset()" />
    <ErrorAlert v-if="remove.error.value" :error="remove.error.value" @close="remove.reset()" />

    <ErrorPanel v-if="links.error.value" :error="links.error.value" :retry="links.reload" />
    <LoadingBlock v-else-if="!links.data.value" :lines="6" />
    <TxCard v-else :padding="0">
      <TxDataTable style="--table-min: 1080px" :columns="columns" :data="links.data.value.links" row-key="token" table-layout="fixed" scroll-x>
        <template #cell-link="{ row }: { row: Link }">
          <span class="link-cell">
            <span class="mono ellipsis">/join/{{ row.token }}</span>
            <TxCopyButton :text="joinUrl(row.token)" copy-label="复制" copied-label="已复制" />
          </span>
        </template>
        <template #cell-note="{ row }: { row: Link }"><span :class="{ muted: !row.note }">{{ row.note || "无" }}</span></template>
        <template #cell-uses="{ row }: { row: Link }"><span class="num">{{ row.current_uses }} / {{ row.max_uses }}</span></template>
        <template #cell-expires="{ row }: { row: Link }">
          <span class="cell-stack"><span>{{ fmtRelative(row.expires_at) }}</span><span class="cell-sub">{{ fmtDate(row.expires_at) }}</span></span>
        </template>
        <template #cell-team="{ row }: { row: Link }"><span class="mono" :class="{ muted: !row.team_slug }">{{ row.team_slug ?? "无" }}</span></template>
        <template #cell-state="{ row }: { row: Link }"><TxStatusBadge :text="linkState(row).text" :status="linkState(row).status" size="sm" /></template>
        <template #cell-actions="{ row }: { row: Link }">
          <span class="row-actions">
            <TxButton size="sm" variant="ghost" :disabled="toggle.pending.value" @click="toggle.execute(row)">{{ row.disabled ? "启用" : "停用" }}</TxButton>
            <TxButton size="sm" variant="ghost" class="danger-text" :disabled="remove.pending.value" @click="askRemove(row)">删除</TxButton>
          </span>
        </template>
        <template #empty><TxEmptyState title="还没有邀请链接" description="用右上角的「生成链接」创建第一条。" size="small" /></template>
      </TxDataTable>
    </TxCard>

    <TxModal v-model="creating" :title="created ? '链接已生成' : '生成邀请链接'" width="min(92vw, 520px)">
      <template v-if="created">
        <TxAlert type="success" title="把下面的地址发给要邀请的同学" :closable="false" />
        <div class="created">
          <TxInput :model-value="created" readonly class="created__url" />
          <TxCopyButton :text="created" copy-label="复制" copied-label="已复制" size="md" />
        </div>
      </template>
      <TxForm v-else :model="form" label-position="top">
        <div class="form-grid">
          <TxFormItem label="有效时长（小时）">
            <TxNumberInput v-model="form.hours" :min="1" :max="8760" />
          </TxFormItem>
          <TxFormItem label="最多使用次数">
            <TxNumberInput v-model="form.max_uses" :min="1" :max="1000" />
          </TxFormItem>
          <TxFormItem label="备注（选填）" class="wide">
            <TxInput v-model="form.note" placeholder="例如：新生群" />
          </TxFormItem>
          <TxFormItem label="加入后自动进入团队" class="wide">
            <TxSelect v-model="form.team_slug" :options="teamOptions" class="fill-width" />
          </TxFormItem>
        </div>
        <ErrorAlert v-if="create.error.value" :error="create.error.value" @close="create.reset()" />
      </TxForm>
      <template #footer>
        <div class="dialog-actions">
          <TxButton v-if="created" variant="primary" @click="creating = false">完成</TxButton>
          <template v-else>
            <TxButton variant="secondary" @click="creating = false">取消</TxButton>
            <TxButton variant="primary" :loading="create.pending.value" @click="create.execute()">生成</TxButton>
          </template>
        </div>
      </template>
    </TxModal>
  </div>
</template>

<style scoped>
.link-cell {
  display: flex;
  align-items: center;
  gap: 8px;
  min-width: 0;
}
.num {
  font-variant-numeric: tabular-nums;
}
.row-actions {
  display: inline-flex;
  gap: 4px;
}
.danger-text {
  color: var(--tx-color-danger);
}
.created {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-top: 12px;
}
.created__url {
  flex: 1;
  min-width: 0;
}
.dialog-actions {
  display: flex;
  justify-content: flex-end;
  gap: 8px;
}
</style>

<script setup lang="ts">
import { reactive, ref } from "vue";
import { useRouter } from "vue-router";
import { TxCard } from "@talex-touch/tuffex/card";
import { TxDataTable } from "@talex-touch/tuffex/data-table";
import { TxButton } from "@talex-touch/tuffex/button";
import { TxStatusBadge } from "@talex-touch/tuffex/status-badge";
import { TxModal } from "@talex-touch/tuffex/modal";
import { TxForm, TxFormItem } from "@talex-touch/tuffex/form";
import { TxInput } from "@talex-touch/tuffex/input";
import { TxTextarea } from "@talex-touch/tuffex/textarea";
import { TxRadio, TxRadioGroup } from "@talex-touch/tuffex/radio";
import { TxEmptyState } from "@talex-touch/tuffex/empty-state";
import { toast } from "@talex-touch/tuffex/utils";
import PageHeader from "../components/PageHeader.vue";
import ErrorPanel from "../components/ErrorPanel.vue";
import ErrorAlert from "../components/ErrorAlert.vue";
import LoadingBlock from "../components/LoadingBlock.vue";
import { api, jsonBody } from "../lib/http";
import { confirm } from "../lib/confirm";
import { fmtDay } from "../lib/format";
import { useAction, useResource } from "../lib/resource";
import { KIND_TEXT, STATUS_TEXT, emptyForm, formErrors, formFrom, formPayload, isOneDay, type CompetitionForm } from "../lib/competitions";
import type { CompetitionRecord, CompetitionStatus } from "../lib/types";

const router = useRouter();
const list = useResource(() => api<{ competitions: CompetitionRecord[] }>("/api/console/competitions"), []);

/** 状态色：报名中用成功色，进行中用主色，报不了名的与结束过的都弱化。 */
const STATUS_TONE: Record<CompetitionStatus, "success" | "info" | "warning" | "muted"> = {
  upcoming: "info", registering: "success", ongoing: "info", closed: "warning", ended: "muted",
};

const columns = [
  { key: "name", title: "比赛", minWidth: 220 },
  { key: "window", title: "时间（北京时间）", width: 200 },
  { key: "status", title: "状态", width: 108 },
  { key: "actions", title: "操作", width: 300, align: "right" as const },
];

const editing = ref(false);
const editingId = ref<string | null>(null);
const original = ref<CompetitionRecord>();
const form = reactive<CompetitionForm>(emptyForm());
const errors = ref<Partial<Record<string, string>>>({});
const kindOptions = [
  { value: "internal", label: "内部（班内自己办）" },
  { value: "external", label: "外部（校外或官方赛事）" },
];

function openCreate() {
  Object.assign(form, emptyForm());
  editingId.value = null;
  original.value = undefined;
  errors.value = {};
  save.reset();
  editing.value = true;
}
function openEdit(row: CompetitionRecord) {
  Object.assign(form, formFrom(row));
  editingId.value = row.id;
  original.value = row;
  errors.value = {};
  save.reset();
  editing.value = true;
}
const save = useAction(async () => {
  const found = formErrors(form);
  errors.value = found;
  if (Object.keys(found).length) return;
  const payload = formPayload(form, original.value);
  if (editingId.value && !Object.keys(payload).length) { editing.value = false; return; }
  if (editingId.value) await api(`/api/console/competitions/${editingId.value}`, { method: "PATCH", ...jsonBody(payload) });
  else await api("/api/console/competitions", { method: "POST", ...jsonBody(payload) });
  toast({ title: editingId.value ? "已保存" : "已新建比赛", variant: "success" });
  editing.value = false;
  await list.reload();
});
const toggleOffline = useAction(async (row: CompetitionRecord) => {
  await api(`/api/console/competitions/${row.id}`, { method: "PATCH", ...jsonBody({ offline: !row.offline }) });
  toast({ title: row.offline ? "已重新上线" : "已下线，官网不再显示", variant: "success" });
  await list.reload();
});
const remove = useAction(async (row: CompetitionRecord) => {
  await api(`/api/console/competitions/${row.id}`, { method: "DELETE" });
  toast({ title: "已删除比赛", variant: "success" });
  await list.reload();
});
async function askRemove(row: CompetitionRecord) {
  if (await confirm({ title: `删除「${row.name}」？`, body: "删除后不能恢复。只想让官网不再显示，用「下线」就好。", confirmText: "删除", danger: true })) await remove.execute(row);
}
</script>

<template>
  <div class="page">
    <PageHeader title="比赛" description="官网桌面「比赛」应用显示的赛事。时间按北京时间选，服务端按 UTC 存。">
      <template #actions>
        <TxButton class="competition-create" variant="primary" icon="i-carbon-add" @click="openCreate">新建比赛</TxButton>
      </template>
    </PageHeader>
    <ErrorAlert v-if="toggleOffline.error.value" :error="toggleOffline.error.value" @close="toggleOffline.reset()" />
    <ErrorAlert v-if="remove.error.value" :error="remove.error.value" @close="remove.reset()" />

    <ErrorPanel v-if="list.error.value" :error="list.error.value" :retry="list.reload" />
    <LoadingBlock v-else-if="!list.data.value" :lines="6" />
    <TxCard v-else :padding="0">
      <TxDataTable style="--table-min: 780px" :columns="columns" :data="list.data.value.competitions" row-key="id" table-layout="fixed" scroll-x>
        <template #cell-name="{ row }: { row: CompetitionRecord }">
          <span class="cell-stack">
            <span class="cell-title">
              <b>{{ row.name }}</b>
              <TxStatusBadge v-if="row.offline" text="已下线" status="muted" size="sm" />
            </span>
            <span class="cell-sub ellipsis">{{ KIND_TEXT[row.kind] }}<template v-if="row.url"> · {{ row.url }}</template></span>
          </span>
        </template>
        <template #cell-window="{ row }: { row: CompetitionRecord }">
          <span class="cell-stack">
            <span v-if="isOneDay(row)">{{ fmtDay(row.start_at) }}</span>
            <template v-else>
              <span>{{ fmtDay(row.start_at) }} 起</span>
              <span class="cell-sub">到 {{ fmtDay(row.end_at) }}</span>
            </template>
            <span v-if="row.signup_deadline" class="cell-sub">报名截止 {{ fmtDay(row.signup_deadline) }}</span>
          </span>
        </template>
        <template #cell-status="{ row }: { row: CompetitionRecord }">
          <TxStatusBadge :text="STATUS_TEXT[row.status]" :status="STATUS_TONE[row.status]" size="sm" />
        </template>
        <template #cell-actions="{ row }: { row: CompetitionRecord }">
          <span class="row-actions">
            <TxButton v-if="row.kind === 'internal'" size="sm" variant="ghost" @click="router.push(`/console/competitions/${row.id}`)">报名与积分</TxButton>
            <TxButton size="sm" variant="ghost" @click="openEdit(row)">编辑</TxButton>
            <TxButton size="sm" variant="ghost" :disabled="toggleOffline.pending.value" @click="toggleOffline.execute(row)">{{ row.offline ? "上线" : "下线" }}</TxButton>
            <TxButton size="sm" variant="ghost" class="danger-text" :disabled="remove.pending.value" @click="askRemove(row)">删除</TxButton>
          </span>
        </template>
        <template #empty><TxEmptyState title="还没有比赛" description="用右上角的「新建比赛」添加第一场。" size="small" /></template>
      </TxDataTable>
    </TxCard>

    <TxModal v-model="editing" :title="editingId ? '编辑比赛' : '新建比赛'" width="min(92vw, 640px)">
      <TxForm :model="form" label-position="top">
        <div class="form-grid competition-form">
          <TxFormItem label="比赛名称" class="wide">
            <TxInput v-model="form.name" class="fill-width" placeholder="例如：极客班算法挑战赛" />
            <span v-if="errors.name" class="field-error">{{ errors.name }}</span>
          </TxFormItem>
          <TxFormItem label="类型" class="wide">
            <TxRadioGroup v-model="form.kind" type="card" direction="row">
              <TxRadio v-for="option in kindOptions" :key="option.value" :value="option.value" :label="option.label" />
            </TxRadioGroup>
          </TxFormItem>
          <TxFormItem label="开始日期" class="wide">
            <TxInput v-model="form.startDate" type="date" class="fill-width" />
            <span v-if="errors.startDate" class="field-error">{{ errors.startDate }}</span>
          </TxFormItem>
          <TxFormItem label="结束日期" class="wide">
            <TxInput v-model="form.endDate" type="date" class="fill-width" />
            <span v-if="errors.endDate" class="field-error">{{ errors.endDate }}</span>
          </TxFormItem>
          <TxFormItem label="报名截止（选填，当天整天都能报）" class="wide">
            <TxInput v-model="form.deadlineDate" type="date" class="fill-width" />
            <span v-if="errors.deadlineDate" class="field-error">{{ errors.deadlineDate }}</span>
          </TxFormItem>
          <TxFormItem label="官方链接（选填，https）" class="wide">
            <TxInput v-model="form.url" class="fill-width" placeholder="https://" />
            <span v-if="errors.url" class="field-error">{{ errors.url }}</span>
          </TxFormItem>
          <TxFormItem label="说明（选填）" class="wide">
            <TxTextarea v-model="form.description" :rows="3" placeholder="一两句说清这是什么比赛、谁能参加。" />
            <span v-if="errors.description" class="field-error">{{ errors.description }}</span>
          </TxFormItem>
        </div>
        <ErrorAlert v-if="save.error.value" :error="save.error.value" @close="save.reset()" />
      </TxForm>
      <template #footer>
        <div class="dialog-actions">
          <TxButton variant="secondary" @click="editing = false">取消</TxButton>
          <TxButton variant="primary" :loading="save.pending.value" @click="save.execute()">{{ editingId ? "保存" : "新建" }}</TxButton>
        </div>
      </template>
    </TxModal>
  </div>
</template>

<style scoped>
.cell-title {
  display: flex;
  align-items: center;
  gap: 8px;
  min-width: 0;
}
.row-actions {
  display: inline-flex;
  gap: 4px;
  white-space: nowrap;
}
.danger-text {
  color: var(--tx-color-danger);
}
.dialog-actions {
  display: flex;
  justify-content: flex-end;
  gap: 8px;
}
.field-error {
  font-size: 0.75rem;
  line-height: 1.125rem;
  color: var(--tx-color-danger);
}
.competition-create,
.row-actions :deep(button),
.dialog-actions :deep(button),
.competition-form :deep(.tx-radio) {
  min-height: 44px;
  min-width: 44px;
}
.competition-form :deep(.tx-input) {
  min-height: 46px;
}
.competition-form :deep(.tx-input__inner) {
  min-height: 44px;
}
/* TxModal 会 Teleport；以本页表单为条件限定关闭按钮，不改其它弹窗。 */
:global([role="dialog"]:has(.competition-form) .tx-modal__close) {
  width: 44px;
  height: 44px;
}
</style>

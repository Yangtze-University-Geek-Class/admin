<script setup lang="ts">
import { computed, reactive, ref } from "vue";
import { useRoute, useRouter } from "vue-router";
import { TxCard } from "@talex-touch/tuffex/card";
import { TxFilterChips } from "@talex-touch/tuffex/filter-chips";
import { TxButton } from "@talex-touch/tuffex/button";
import { TxSelect } from "@talex-touch/tuffex/select";
import { TxTextarea } from "@talex-touch/tuffex/textarea";
import { TxTag } from "@talex-touch/tuffex/tag";
import { TxEmptyState } from "@talex-touch/tuffex/empty-state";
import { TxForm, TxFormItem } from "@talex-touch/tuffex/form";
import { TxCopyButton } from "@talex-touch/tuffex/button";
import { toast } from "@talex-touch/tuffex/utils";
import PageHeader from "../components/PageHeader.vue";
import ToneTag from "../components/ToneTag.vue";
import ErrorPanel from "../components/ErrorPanel.vue";
import ErrorAlert from "../components/ErrorAlert.vue";
import LoadingBlock from "../components/LoadingBlock.vue";
import { api, jsonBody } from "../lib/http";
import { confirm } from "../lib/confirm";
import { fmtDate, fmtRelative } from "../lib/format";
import { useAction, useResource } from "../lib/resource";
import { siteUrl } from "../lib/runtime";
import { useSession } from "../lib/session";
import { toneColor } from "../lib/titles";
import { FEEDBACK_STATUS, FEEDBACK_STATUSES } from "../lib/statuses";
import type { FeedbackItem, FeedbackList, FeedbackStatus } from "../lib/types";

const route = useRoute();
const router = useRouter();
const { me, can, catalogue } = useSession();
const canManage = computed(() => can("feedback.manage"));

const status = computed(() => (typeof route.query.status === "string" && (FEEDBACK_STATUSES as string[]).includes(route.query.status) ? route.query.status : ""));
const list = useResource(() => api<FeedbackList>(`/api/console/feedback${status.value ? `?status=${status.value}` : ""}`), [status]);
const total = computed(() => Object.values(list.data.value?.counts ?? {}).reduce((sum, n) => sum + n, 0));
const chips = computed(() => [
  { value: "", label: "全部", count: total.value },
  ...FEEDBACK_STATUSES.map(id => ({ value: id, label: FEEDBACK_STATUS[id].label, count: list.data.value?.counts[id] ?? 0, dot: toneColor(FEEDBACK_STATUS[id].tone, catalogue.value) })),
]);
const setStatus = (value: string | number) => void router.replace({ query: { ...route.query, status: value ? String(value) : undefined } });

const editing = ref<number | null>(null);
const draft = reactive({ status: "open" as FeedbackStatus, reply: "" });
function startEdit(item: FeedbackItem) {
  editing.value = item.id;
  draft.status = item.status;
  draft.reply = item.reply ?? "";
  save.reset();
}
const statusOptions = FEEDBACK_STATUSES.map(value => ({ value, label: FEEDBACK_STATUS[value].label }));

const save = useAction(async (item: FeedbackItem) => {
  await api(`/api/console/feedback/${item.id}`, { method: "PATCH", ...jsonBody({ status: draft.status, reply: draft.reply.trim() }) });
  editing.value = null;
  toast({ title: "已保存", description: `意见 #${item.id}`, variant: "success" });
  await list.reload();
});
const remove = useAction(async (item: FeedbackItem) => {
  await api(`/api/console/feedback/${item.id}`, { method: "DELETE" });
  toast({ title: "已删除", description: `意见 #${item.id}`, variant: "success" });
  await list.reload();
});
async function askRemove(item: FeedbackItem) {
  if (await confirm({ title: `删除意见 #${item.id}？`, body: "删除后不能恢复，官网的公开意见页也不再显示它。", confirmText: "删除", danger: true })) await remove.execute(item);
}

const publicPath = computed(() => `/feedback/${me.value?.org ?? ""}`);
const publicUrl = computed(() => new URL(siteUrl("portal", publicPath.value), window.location.origin).toString());
</script>

<template>
  <div class="page">
    <PageHeader title="意见箱" description="官网「意见」提交的反馈。你的回复会公开显示在官网的意见页上。" />

    <div class="split">
      <div class="stack">
        <TxFilterChips :model-value="status" :items="chips" aria-label="按状态筛选" @update:model-value="setStatus" />
        <ErrorAlert v-if="remove.error.value" :error="remove.error.value" @close="remove.reset()" />

        <ErrorPanel v-if="list.error.value" :error="list.error.value" :retry="list.reload" />
        <LoadingBlock v-else-if="!list.data.value" :lines="6" />
        <TxCard v-else-if="!list.data.value.items.length">
          <TxEmptyState :title="status ? '这个状态下没有意见' : '还没有收到意见'" :description="status ? '换一个状态看看。' : '把右侧的公开链接发给同学，就能收到意见。'" size="small" />
        </TxCard>
        <TxCard v-for="item in list.data.value?.items ?? []" v-else :key="item.id">
          <div class="fb-meta">
            <TxTag :label="item.category ?? '其他'" size="sm" variant="plain" />
            <ToneTag :tone="FEEDBACK_STATUS[item.status].tone" :label="FEEDBACK_STATUS[item.status].label" />
            <span class="mono muted">#{{ item.id }}</span>
            <span v-if="item.submitter_login" class="mono">@{{ item.submitter_login }}</span>
            <span v-else class="muted">匿名</span>
            <span v-if="item.contact" class="muted">联系方式：{{ item.contact }}</span>
            <span class="muted fb-time" :title="fmtDate(item.created_at)">{{ fmtRelative(item.created_at) }}</span>
          </div>
          <p class="fb-content">{{ item.content }}</p>

          <div v-if="item.reply && editing !== item.id" class="fb-reply">
            <span class="fb-reply__by"><span class="mono">@{{ item.replied_by }}</span> 回复 · {{ fmtRelative(item.replied_at) }}</span>
            <p>{{ item.reply }}</p>
          </div>

          <TxForm v-if="editing === item.id" :model="draft" label-position="top" class="fb-edit" @submit="save.execute(item)">
            <TxFormItem label="状态">
              <TxSelect v-model="draft.status" :options="statusOptions" class="fb-select" />
            </TxFormItem>
            <TxFormItem label="公开回复（选填）">
              <TxTextarea v-model="draft.reply" :rows="3" :max-length="2000" placeholder="写给提意见的同学，会显示在官网上" />
            </TxFormItem>
            <ErrorAlert v-if="save.error.value" :error="save.error.value" @close="save.reset()" />
            <div class="fb-actions">
              <TxButton variant="primary" size="sm" native-type="submit" :loading="save.pending.value">保存</TxButton>
              <TxButton variant="secondary" size="sm" @click="editing = null">取消</TxButton>
            </div>
          </TxForm>
          <div v-else class="fb-actions">
            <template v-if="canManage">
              <TxButton size="sm" icon="i-carbon-edit" @click="startEdit(item)">处理或回复</TxButton>
              <TxButton variant="ghost" size="sm" class="danger-text fb-delete" icon="i-carbon-trash-can" :disabled="remove.pending.value" @click="askRemove(item)">删除</TxButton>
            </template>
            <span v-else class="muted small">只读。处理和回复需要「处理意见」权限。</span>
          </div>
        </TxCard>
      </div>

      <div class="stack">
        <TxCard>
          <template #header><h2 class="section-title">处理进度</h2></template>
          <ul class="progress">
            <li v-for="id in FEEDBACK_STATUSES" :key="id">
              <ToneTag :tone="FEEDBACK_STATUS[id].tone" :label="FEEDBACK_STATUS[id].label" />
              <span class="progress__count">{{ list.data.value?.counts[id] ?? 0 }}</span>
            </li>
          </ul>
        </TxCard>
        <TxCard>
          <template #header><h2 class="section-title">公开提交链接</h2></template>
          <p class="muted small">把这个地址发给同学，不登录也能提意见。</p>
          <div class="share">
            <a class="mono share__url" :href="publicUrl" target="_blank" rel="noreferrer">{{ publicPath }}</a>
            <TxCopyButton :text="publicUrl" copy-label="复制" copied-label="已复制" />
          </div>
        </TxCard>
      </div>
    </div>
  </div>
</template>

<style scoped>
.stack {
  display: flex;
  flex-direction: column;
  gap: 12px;
  min-width: 0;
}
.fb-meta {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 6px 10px;
  font-size: 13px;
}
.fb-time {
  margin-left: auto;
}
.fb-content {
  margin: 10px 0 0;
  white-space: pre-wrap;
  overflow-wrap: anywhere;
  line-height: 24px;
}
.fb-reply {
  margin-top: 12px;
  padding: 8px 12px;
  border-left: 3px solid var(--tx-color-primary-light-5);
  background: var(--tx-fill-color-lighter);
  border-radius: 0 var(--tx-border-radius-base) var(--tx-border-radius-base) 0;
}
.fb-reply__by {
  font-size: 12px;
  color: var(--tx-text-color-secondary);
}
.fb-reply p {
  margin: 4px 0 0;
  white-space: pre-wrap;
  overflow-wrap: anywhere;
}
.fb-edit {
  margin-top: 12px;
}
.fb-select {
  width: min(240px, 100%);
}
.fb-actions {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 8px;
  margin-top: 12px;
}
.fb-delete {
  margin-left: auto;
}
.danger-text {
  color: var(--tx-color-danger);
}
.small {
  margin: 0;
  font-size: 12px;
}
.progress {
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: 8px;
}
.progress li {
  display: flex;
  align-items: center;
  justify-content: space-between;
}
.progress__count {
  font-variant-numeric: tabular-nums;
  font-weight: 600;
}
.share {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-top: 10px;
}
.share__url {
  flex: 1;
  min-width: 0;
  overflow-wrap: anywhere;
}
</style>

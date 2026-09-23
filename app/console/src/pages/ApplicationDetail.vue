<script setup lang="ts">
import { computed, ref, watch } from "vue";
import { useRoute } from "vue-router";
import { TxCard } from "@talex-touch/tuffex/card";
import { TxSelect } from "@talex-touch/tuffex/select";
import { TxTextarea } from "@talex-touch/tuffex/textarea";
import { TxButton } from "@talex-touch/tuffex/button";
import { TxTimeline, TxTimelineItem } from "@talex-touch/tuffex/timeline";
import { TxSteps, TxStep } from "@talex-touch/tuffex/steps";
import { TxEmptyState } from "@talex-touch/tuffex/empty-state";
import { TxForm, TxFormItem } from "@talex-touch/tuffex/form";
import { toast } from "@talex-touch/tuffex/utils";
import PageHeader from "../components/PageHeader.vue";
import ToneTag from "../components/ToneTag.vue";
import ErrorPanel from "../components/ErrorPanel.vue";
import ErrorAlert from "../components/ErrorAlert.vue";
import LoadingBlock from "../components/LoadingBlock.vue";
import { api, jsonBody } from "../lib/http";
import { fmtDate, fmtRelative } from "../lib/format";
import { useAction, useResource } from "../lib/resource";
import { useSession } from "../lib/session";
import { APPLICATION_STATUS, APPLICATION_STATUSES } from "../lib/statuses";
import type { ApplicationDetail, ApplicationStatus } from "../lib/types";

const route = useRoute();
const { can } = useSession();
const id = computed(() => String(route.params.applicationId ?? ""));
const detail = useResource(() => api<ApplicationDetail>(`/api/console/applications/${id.value}`), [id]);

const status = ref<ApplicationStatus>("received");
const note = ref("");
watch(() => detail.data.value, data => { if (data) status.value = data.application.status; }, { immediate: true });

const unchanged = computed(() => !detail.data.value || (status.value === detail.data.value.application.status && !note.value.trim()));
const statusOptions = APPLICATION_STATUSES.map(value => ({ value, label: APPLICATION_STATUS[value].label }));

/** 进度条：已收到 → 评估中 → 待面试 → 已录取；「未通过」单独标红。 */
const pipeline: ApplicationStatus[] = ["received", "reviewing", "interview", "accepted"];
const stepIndex = computed(() => {
  const current = detail.data.value?.application.status;
  return current && current !== "rejected" ? pipeline.indexOf(current) : -1;
});
const reviewers = computed(() => [...new Set((detail.data.value?.reviews ?? []).map(item => item.reviewer))]);

const review = useAction(async () => {
  const data = detail.data.value!;
  await api(`/api/console/applications/${id.value}`, {
    method: "PATCH",
    ...jsonBody({ ...(status.value !== data.application.status ? { status: status.value } : {}), ...(note.value.trim() ? { note: note.value.trim() } : {}) }),
  });
  note.value = "";
  toast({ title: "已保存", description: "审核记录已更新。", variant: "success" });
  await detail.reload();
});
</script>

<template>
  <div class="page">
    <ErrorPanel v-if="detail.error.value" :error="detail.error.value" :retry="detail.reload" />
    <LoadingBlock v-else-if="!detail.data.value" :lines="10" />
    <template v-else>
      <PageHeader
        :title="detail.data.value.application.name"
        :crumbs="[{ label: '投递管理', to: '/console/applications' }, { label: detail.data.value.application.name }]"
      >
        <template #meta>
          <p class="head-meta">
            {{ detail.data.value.application.class_name }}
            <span class="mono">{{ detail.data.value.application.email }}</span>
            <span>{{ fmtDate(detail.data.value.application.created_at) }} 投递</span>
          </p>
        </template>
        <template #actions>
          <ToneTag :tone="APPLICATION_STATUS[detail.data.value.application.status].tone" :label="APPLICATION_STATUS[detail.data.value.application.status].label" />
        </template>
      </PageHeader>

      <TxCard>
        <TxSteps v-if="stepIndex >= 0" :active="stepIndex" size="small">
          <TxStep v-for="(id, index) in pipeline" :key="id" :title="APPLICATION_STATUS[id].label" :step="index" :clickable="false" />
        </TxSteps>
        <p v-else class="rejected">这份投递已标为「未通过」。</p>
      </TxCard>

      <div class="split">
        <div class="stack">
          <TxCard>
            <template #header>
              <div class="card-head">
                <h2 class="section-title">特长与优点</h2>
                <span class="count">{{ detail.data.value.application.strengths.length }} 字</span>
              </div>
            </template>
            <p class="strengths">{{ detail.data.value.application.strengths }}</p>
          </TxCard>

          <TxCard>
            <template #header>
              <div class="card-head">
                <h2 class="section-title">审核记录</h2>
                <span class="count">{{ detail.data.value.reviews.length }} 条</span>
              </div>
            </template>
            <TxEmptyState v-if="!detail.data.value.reviews.length" title="还没有人处理" description="在右侧改状态或写备注后，会记在这里。" size="small" />
            <TxTimeline v-else>
              <TxTimelineItem
                v-for="item in detail.data.value.reviews"
                :key="item.id"
                :title="item.from_status === item.to_status ? `@${item.reviewer} 补充了备注` : `@${item.reviewer} 改为「${APPLICATION_STATUS[item.to_status].label}」`"
                :time="`${fmtRelative(item.created_at)} · ${fmtDate(item.created_at)}`"
                :color="item.to_status === 'rejected' ? 'error' : item.to_status === 'accepted' ? 'success' : 'primary'"
              >
                <p v-if="item.from_status !== item.to_status" class="review-from">原状态：{{ APPLICATION_STATUS[item.from_status].label }}</p>
                <p v-if="item.note" class="review-note">{{ item.note }}</p>
              </TxTimelineItem>
            </TxTimeline>
          </TxCard>
        </div>

        <div class="stack">
          <TxCard>
            <template #header>
              <h2 class="section-title">处理这份投递</h2>
            </template>
            <TxForm v-if="can('applications.review')" :model="{ status, note }" label-position="top" class="review-form" @submit="!unchanged && review.execute()">
              <TxFormItem label="状态">
                <TxSelect v-model="status" :options="statusOptions" class="fill-width" />
              </TxFormItem>
              <TxFormItem label="备注">
                <TxTextarea v-model="note" :rows="4" :max-length="2000" placeholder="例如：约在周四晚上面试" />
              </TxFormItem>
              <p class="hint">备注只给审核人看，不写入审计日志。</p>
              <ErrorAlert v-if="review.error.value" :error="review.error.value" @close="review.reset()" />
              <TxButton variant="primary" native-type="submit" block :disabled="unchanged" :loading="review.pending.value">
                {{ unchanged ? "没有修改" : "保存" }}
              </TxButton>
            </TxForm>
            <p v-else class="hint">你可以查看这份投递。修改状态需要「审核投递」权限。</p>
          </TxCard>

          <TxCard>
            <template #header>
              <h2 class="section-title">投递信息</h2>
            </template>
            <dl class="facts">
              <dt>姓名</dt><dd>{{ detail.data.value.application.name }}</dd>
              <dt>班级</dt><dd>{{ detail.data.value.application.class_name }}</dd>
              <dt>邮箱</dt><dd class="mono">{{ detail.data.value.application.email }}</dd>
              <dt>投递时间</dt><dd>{{ fmtDate(detail.data.value.application.created_at) }}</dd>
              <dt>编号</dt><dd class="mono small">{{ detail.data.value.application.id }}</dd>
              <dt>经手人</dt><dd class="mono">{{ reviewers.length ? reviewers.map(r => `@${r}`).join("、") : "暂无" }}</dd>
            </dl>
          </TxCard>
        </div>
      </div>
    </template>
  </div>
</template>

<style scoped>
.head-meta {
  display: flex;
  flex-wrap: wrap;
  gap: 4px 12px;
  margin: 4px 0 0;
  color: var(--tx-text-color-secondary);
}
.stack {
  display: flex;
  flex-direction: column;
  gap: 16px;
  min-width: 0;
}
.strengths {
  margin: 0;
  white-space: pre-wrap;
  overflow-wrap: anywhere;
  line-height: 26px;
  color: var(--tx-text-color-regular);
}
.rejected {
  margin: 0;
  color: var(--tx-color-danger);
  font-weight: 500;
}
.review-from {
  margin: 2px 0 0;
  font-size: 12px;
  color: var(--tx-text-color-secondary);
}
.review-note {
  margin: 6px 0 0;
  padding: 8px 12px;
  white-space: pre-wrap;
  overflow-wrap: anywhere;
  border-radius: var(--tx-border-radius-base);
  background: var(--tx-fill-color-light);
  color: var(--tx-text-color-regular);
}
.review-form {
  display: flex;
  flex-direction: column;
  gap: 4px;
}
.hint {
  margin: 0 0 8px;
  font-size: 12px;
  color: var(--tx-text-color-secondary);
}
.small {
  font-size: 12px;
}
</style>

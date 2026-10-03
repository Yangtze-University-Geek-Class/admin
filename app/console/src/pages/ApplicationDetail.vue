<script setup lang="ts">
import { computed, reactive, ref, watch } from "vue";
import { useRoute, useRouter } from "vue-router";
import { TxCard } from "@talex-touch/tuffex/card";
import { TxSelect } from "@talex-touch/tuffex/select";
import { TxInput } from "@talex-touch/tuffex/input";
import { TxTextarea } from "@talex-touch/tuffex/textarea";
import { TxCheckbox } from "@talex-touch/tuffex/checkbox";
import { TxButton } from "@talex-touch/tuffex/button";
import { TxCellLink } from "@talex-touch/tuffex/cell-link";
import { TxDataTable } from "@talex-touch/tuffex/data-table";
import { TxTag } from "@talex-touch/tuffex/tag";
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
import { APPLICATION_STATUS, APPLICATION_STATUSES, isApplicationStatus, statusMeta } from "../lib/statuses";
import { reasonLabels } from "../lib/application-groups";
import {
  LETTER_LIMITS, emptyLetterDraft, letterErrors, mailState, newestReviewId, noticePlan, reviewPatch, savedMessage, serverFieldErrors, statusChangedMessage,
  type LetterErrors,
} from "../lib/applications";
import type { ApplicationDetail, ApplicationReviewResult, ApplicationStatus, PersonApplication, PossibleDuplicate } from "../lib/types";

const route = useRoute();
const router = useRouter();
const { can } = useSession();
const id = computed(() => String(route.params.applicationId ?? ""));
const detail = useResource(() => api<ApplicationDetail>(`/api/console/applications/${id.value}`), [id]);
const current = computed(() => detail.data.value?.application.status ?? "received");

const status = ref<ApplicationStatus>("received");
const note = ref("");
const notify = ref(true);
const letter = reactive(emptyLetterDraft());
const touched = ref(false);
watch(() => detail.data.value, data => { if (data) status.value = isApplicationStatus(data.application.status) ? data.application.status : "received"; }, { immediate: true });
// 每换一次目标状态，「给投递人发邮件」回到默认的勾选。
watch(status, () => { notify.value = true; });

const statusOptions = APPLICATION_STATUSES.map(value => ({ value, label: APPLICATION_STATUS[value].label }));
/** 服务端还没有发信设置时（旧版本）按「没有配置」处理，不让页面出错。 */
const NO_MAIL = { enabled: false, recipients: "all", deliverable: false } as const;
const plan = computed(() => {
  const data = detail.data.value;
  return data ? noticePlan(current.value, status.value, notify.value, data.mail ?? NO_MAIL, data.application.email) : { kind: "none" as const };
});
const unchanged = computed(() => !detail.data.value || (status.value === current.value && !note.value.trim()));

const review = useAction(async () => {
  const body = reviewPatch({
    current: current.value, latestReviewId: newestReviewId(detail.data.value?.reviews ?? []), status: status.value, note: note.value, notify: notify.value, draft: letter,
  });
  let result: ApplicationReviewResult;
  try {
    result = await api<ApplicationReviewResult>(`/api/console/applications/${id.value}`, { method: "PATCH", ...jsonBody(body) });
  } catch (error) {
    // 别人刚改过状态：服务端没改也没发信。刷新成最新的状态，填好的信和备注留着，看过再决定。
    const changed = statusChangedMessage(error);
    if (!changed) throw error;
    toast({ title: "没有保存", description: changed, variant: "warning" });
    await detail.reload();
    return;
  }
  note.value = "";
  Object.assign(letter, emptyLetterDraft());
  touched.value = false;
  toast({ title: "已保存", description: savedMessage(result.review.mail ?? null), variant: "success" });
  await detail.reload();
});

/** 字段下的错误：本地核对（点过保存才显示），加上服务端按字段拒绝的那一次。 */
const localErrors = computed<LetterErrors>(() => (plan.value.kind === "letter" && plan.value.notify ? letterErrors(plan.value.letter, letter) : {}));
const serverErrors = computed(() => serverFieldErrors(review.error.value));
const shown = computed<LetterErrors>(() => ({ ...serverErrors.value?.letter, ...(touched.value ? localErrors.value : {}) }));
// 服务端按字段拒绝后，改了表单就把那条错误收起来，改由本地核对接手。
watch([status, notify, () => ({ ...letter })], () => { if (serverErrors.value) review.reset(); });

/** 进度条：已收到 → 待面试 → 已录取；「未通过」单独标红。旧的「评估中」算在已收到这一步。 */
const pipeline: ApplicationStatus[] = ["received", "interview", "accepted"];
const stepIndex = computed(() => Math.max(0, pipeline.indexOf(current.value)));
const reviewers = computed(() => [...new Set((detail.data.value?.reviews ?? []).map(item => item.reviewer))]);
const receivedMail = computed(() => mailState(detail.data.value?.received_mail ?? null));

/** 同一个人的投递（#184）：只有一份时不显示这张卡片。 */
const person = computed(() => {
  const value = detail.data.value?.person;
  return value && value.applications.length > 1 ? value : null;
});
const possible = computed(() => detail.data.value?.possible_duplicates);
// 时间和来源邮箱放在同一列上下排：窄屏只有两列，邮箱也能看全
const personColumns = [
  { key: "application", title: "投递时间与来源邮箱" },
  { key: "status", title: "状态", width: 124 },
];
const openApplication = (row: { id: string }) => { if (row.id !== id.value) void router.push(`/console/applications/${row.id}`); };
const timelineColor = (to: string) => (to === "rejected" ? "error" : to === "accepted" ? "success" : to === "cancelled" ? "default" : "primary");

async function submit() {
  if (unchanged.value || review.pending.value) return;
  touched.value = true;
  if (Object.keys(localErrors.value).length > 0) return;
  await review.execute();
}
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
          <ToneTag :tone="statusMeta(current).tone" :label="statusMeta(current).label" />
        </template>
      </PageHeader>

      <TxCard>
        <p v-if="current === 'rejected'" class="rejected">这份投递已标为「未通过」。</p>
        <p v-else-if="current === 'cancelled'" class="cancelled">这份投递已标为「已取消」：重复或无效的投递，不算进招新进度。</p>
        <TxSteps v-else :active="stepIndex" size="small">
          <TxStep v-for="(step, index) in pipeline" :key="step" :title="APPLICATION_STATUS[step].label" :step="index" :clickable="false" />
        </TxSteps>
      </TxCard>

      <div class="split">
        <div class="stack">
          <TxCard v-if="person">
            <template #header>
              <div class="card-head">
                <h2 class="section-title">同一邮箱的投递</h2>
                <span class="count">{{ person.applications.length }} 份</span>
              </div>
            </template>
            <p class="person-reasons">
              <span>按</span>
              <TxTag v-for="label in reasonLabels(person.reasons)" :key="label" :label="label" variant="plain" size="sm" />
              <span>分组，邮箱未经身份验证。确认重复后可改成「已取消」并写备注，不发邮件。</span>
            </p>
            <TxDataTable :columns="personColumns" :data="person.applications" row-key="id" table-layout="fixed" class="person-table" @row-click="({ row }: { row: PersonApplication }) => openApplication(row)">
              <template #cell-application="{ row }: { row: PersonApplication }">
                <span class="cell-stack">
                  <span class="person-when">
                    <span v-if="row.id === id" class="current-mark">当前这份</span>
                    <TxCellLink v-else :href="`/console/applications/${row.id}`" :label="fmtRelative(row.created_at)" @open="openApplication(row)" />
                    <span class="cell-sub">{{ fmtDate(row.created_at) }}</span>
                  </span>
                  <span class="mono person-email">{{ row.email }}</span>
                  <span v-if="row.name !== detail.data.value.application.name || row.class_name !== detail.data.value.application.class_name" class="cell-sub">{{ row.name }} · {{ row.class_name }}</span>
                </span>
              </template>
              <template #cell-status="{ row }: { row: PersonApplication }">
                <span class="cell-stack">
                  <ToneTag :tone="statusMeta(row.status).tone" :label="statusMeta(row.status).label" />
                  <span v-if="row.last_review" class="cell-sub mono ellipsis" :title="`@${row.last_review.reviewer}`">@{{ row.last_review.reviewer }}</span>
                </span>
              </template>
            </TxDataTable>
          </TxCard>

          <TxCard v-if="possible?.total">
            <template #header>
              <div class="card-head">
                <h2 class="section-title">疑似重复，待人工核对</h2>
                <span class="count">{{ possible.total }} 份</span>
              </div>
            </template>
            <p class="person-reasons">同名同班、邮箱不同，仅作核对线索，不算同一人，也不会自动取消。</p>
            <p v-if="possible.total > possible.applications.length" class="person-reasons">仅列最新 {{ possible.applications.length }} 份；其余可回投递管理按姓名搜索。</p>
            <TxDataTable :columns="personColumns" :data="possible.applications" row-key="id" table-layout="fixed" class="person-table" @row-click="({ row }: { row: PossibleDuplicate }) => openApplication(row)">
              <template #cell-application="{ row }: { row: PossibleDuplicate }">
                <span class="cell-stack">
                  <TxCellLink :href="`/console/applications/${row.id}`" :label="`${row.name} · ${row.class_name}`" @open="openApplication(row)" />
                  <span class="cell-sub">{{ fmtDate(row.created_at) }}</span>
                  <span class="mono person-email">{{ row.email }}</span>
                </span>
              </template>
              <template #cell-status="{ row }: { row: PossibleDuplicate }">
                <ToneTag :tone="statusMeta(row.status).tone" :label="statusMeta(row.status).label" />
              </template>
            </TxDataTable>
          </TxCard>

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
                :title="item.from_status === item.to_status ? `@${item.reviewer} 补充了备注` : `@${item.reviewer} 改为「${statusMeta(item.to_status).label}」`"
                :time="`${fmtRelative(item.created_at)} · ${fmtDate(item.created_at)}`"
                :color="timelineColor(item.to_status)"
              >
                <p v-if="item.from_status !== item.to_status" class="review-from">原状态：{{ statusMeta(item.from_status).label }}</p>
                <p v-if="item.note" class="review-note">{{ item.note }}</p>
                <p class="review-mail" :class="`is-${mailState(item.mail ?? null).tone}`">
                  <i class="i-carbon-email" aria-hidden="true" />
                  <span>邮件：{{ mailState(item.mail ?? null).text }}</span>
                </p>
                <p v-if="item.mail" class="review-subject">主题：{{ item.mail.subject }}</p>
              </TxTimelineItem>
            </TxTimeline>
          </TxCard>
        </div>

        <div class="stack">
          <TxCard>
            <template #header>
              <h2 class="section-title">处理这份投递</h2>
            </template>
            <!-- 面试时间、地点是单行输入框：按回车会隐式提交表单并马上发信，所以回车在这两个框里不提交。 -->
            <TxForm v-if="can('applications.review')" :model="{ status, note, notify, ...letter }" label-position="top" class="review-form" @submit="submit">
              <TxFormItem label="状态">
                <TxSelect v-model="status" :options="statusOptions" :status="serverErrors?.status ? 'error' : 'default'" class="fill-width" />
                <span v-if="serverErrors?.status" class="field-error">{{ serverErrors.status }}</span>
              </TxFormItem>

              <section v-if="plan.kind !== 'none'" class="notice" aria-labelledby="notice-heading">
                <h3 id="notice-heading" class="notice__heading">通知投递人</h3>
                <template v-if="plan.kind === 'letter'">
                  <TxCheckbox v-model="notify" label="给投递人发邮件" />
                  <template v-if="notify">
                    <template v-if="plan.letter === 'interview'">
                      <TxFormItem label="面试时间" required>
                        <template #default="field">
                          <TxInput
                            v-bind="field"
                            v-model="letter.time"
                            class="fill-width"
                            placeholder="例如 9 月 30 日（周三）19:00"
                            autocomplete="off"
                            @keydown.enter.prevent
                            :maxlength="LETTER_LIMITS.time"
                            :aria-invalid="Boolean(shown.time)"
                          />
                          <span v-if="shown.time" class="field-error">{{ shown.time }}</span>
                        </template>
                      </TxFormItem>
                      <TxFormItem label="面试地点" required>
                        <template #default="field">
                          <TxInput
                            v-bind="field"
                            v-model="letter.place"
                            class="fill-width"
                            placeholder="例如 东校区三教 301"
                            autocomplete="off"
                            @keydown.enter.prevent
                            :maxlength="LETTER_LIMITS.place"
                            :aria-invalid="Boolean(shown.place)"
                          />
                          <span v-if="shown.place" class="field-error">{{ shown.place }}</span>
                        </template>
                      </TxFormItem>
                      <TxFormItem label="面试说明（选填，一行一条）">
                        <TxTextarea
                          v-model="letter.interviewNotes"
                          :rows="3"
                          :max-length="LETTER_LIMITS.notes"
                          :status="shown.notes ? 'error' : 'default'"
                          :placeholder="'例如：带上学生证\n做过的项目可以带电脑现场演示'"
                        />
                        <span v-if="shown.notes" class="field-error">{{ shown.notes }}</span>
                      </TxFormItem>
                    </template>
                    <TxFormItem v-else-if="plan.letter === 'accepted'" label="接下来要做的事（选填，一行一条）">
                      <TxTextarea
                        v-model="letter.acceptedNotes"
                        :rows="3"
                        :max-length="LETTER_LIMITS.notes"
                        :status="shown.notes ? 'error' : 'default'"
                        :placeholder="'例如：加入新成员群\n周六下午来参加第一次分享会'"
                      />
                      <span v-if="shown.notes" class="field-error">{{ shown.notes }}</span>
                    </TxFormItem>
                    <TxFormItem v-else label="写给投递人的话（选填）">
                      <TxTextarea
                        v-model="letter.message"
                        :rows="3"
                        :max-length="LETTER_LIMITS.message"
                        :status="shown.message ? 'error' : 'default'"
                        placeholder="例如：这次方向不太匹配，欢迎常来论坛交流"
                      />
                      <span v-if="shown.message" class="field-error">{{ shown.message }}</span>
                    </TxFormItem>
                  </template>
                </template>
                <p class="hint notice__hint">{{ plan.hint }}</p>
                <p v-if="serverErrors?.notice" class="field-error notice__error" role="alert">{{ serverErrors.notice }}</p>
              </section>

              <TxFormItem label="备注">
                <TxTextarea v-model="note" :rows="4" :max-length="2000" placeholder="例如：算法方向，请技术部一起看" />
              </TxFormItem>
              <p class="hint">备注只给审核人看，不会写进给投递人的邮件，也不写入审计日志。</p>
              <ErrorAlert v-if="review.error.value && !serverErrors" :error="review.error.value" @close="review.reset()" />
              <TxButton variant="primary" native-type="submit" block :disabled="unchanged" :loading="review.pending.value">
                {{ unchanged ? "没有修改" : plan.kind === "letter" && plan.sends ? "保存并发邮件" : "保存" }}
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
              <dt>确认信</dt><dd :class="`mail-${receivedMail.tone}`">{{ receivedMail.text }}</dd>
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
.cancelled {
  margin: 0;
  color: var(--tx-text-color-secondary);
  font-weight: 500;
}
.person-reasons {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 4px 6px;
  margin: 0 0 10px;
  font-size: 13px;
  line-height: 20px;
  color: var(--tx-text-color-secondary);
}
.person-table :deep(tbody tr) {
  cursor: pointer;
}
.current-mark {
  font-weight: 500;
  color: var(--tx-text-color-primary);
}
.person-when {
  display: flex;
  flex-wrap: wrap;
  align-items: baseline;
  gap: 0 8px;
}
.person-email {
  font-size: 13px;
  line-height: 20px;
  overflow-wrap: anywhere;
  color: var(--tx-text-color-regular);
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
.review-mail {
  display: flex;
  align-items: baseline;
  gap: 6px;
  margin: 6px 0 0;
  font-size: 13px;
  line-height: 20px;
  overflow-wrap: anywhere;
  color: var(--tx-text-color-secondary);
}
.review-mail.is-success,
.mail-success {
  color: var(--tx-color-success);
}
.review-mail.is-warning,
.mail-warning {
  color: var(--tx-color-warning);
}
.review-mail.is-danger,
.mail-danger {
  color: var(--tx-color-danger);
}
.review-subject {
  margin: 2px 0 0;
  font-size: 12px;
  line-height: 18px;
  overflow-wrap: anywhere;
  color: var(--tx-text-color-secondary);
}
.review-form {
  display: flex;
  flex-direction: column;
  gap: 4px;
}
/* 与上下两个表单项的间距和表单项之间相同（layout.css 里是 14px）。 */
.notice {
  display: flex;
  flex-direction: column;
  gap: 10px;
  margin: 14px 0;
  padding: 12px;
  border-radius: var(--tx-border-radius-base);
  background: var(--tx-fill-color-lighter);
}
.notice__heading {
  margin: 0;
  font-size: 14px;
  line-height: 20px;
  font-weight: 600;
  color: var(--tx-text-color-primary);
}
.notice__hint {
  margin: 0;
  overflow-wrap: anywhere;
}
.field-error.notice__error {
  margin-top: 0;
  overflow-wrap: anywhere;
}
.field-error {
  display: block;
  margin-top: 4px;
  font-size: 12px;
  color: var(--tx-color-danger);
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

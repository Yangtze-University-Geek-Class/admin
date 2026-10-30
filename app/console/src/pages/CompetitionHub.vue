<script setup lang="ts">
import { computed, reactive, ref, watch } from "vue";
import { useRoute, useRouter } from "vue-router";
import { TxCard } from "@talex-touch/tuffex/card";
import { TxAlert } from "@talex-touch/tuffex/alert";
import { TxDataTable } from "@talex-touch/tuffex/data-table";
import { TxFilterChips } from "@talex-touch/tuffex/filter-chips";
import { TxSearchInput } from "@talex-touch/tuffex/search-input";
import { TxButton } from "@talex-touch/tuffex/button";
import { TxStatusBadge } from "@talex-touch/tuffex/status-badge";
import { TxSwitch } from "@talex-touch/tuffex/switch";
import { TxModal } from "@talex-touch/tuffex/modal";
import { TxForm, TxFormItem } from "@talex-touch/tuffex/form";
import { TxInput } from "@talex-touch/tuffex/input";
import { TxTextarea } from "@talex-touch/tuffex/textarea";
import { TxRadio, TxRadioGroup } from "@talex-touch/tuffex/radio";
import { TxEmptyState } from "@talex-touch/tuffex/empty-state";
import { TxTabs, TxTabItem } from "@talex-touch/tuffex/tabs";
import { toast } from "@talex-touch/tuffex/utils";
import PageHeader from "../components/PageHeader.vue";
import UserCell from "../components/UserCell.vue";
import ErrorPanel from "../components/ErrorPanel.vue";
import ErrorAlert from "../components/ErrorAlert.vue";
import LoadingBlock from "../components/LoadingBlock.vue";
import CandidatesPanel from "./competition/CandidatesPanel.vue";
import RulesPanel from "./competition/RulesPanel.vue";
import SitePanel from "./competition/SitePanel.vue";
import FinalPanel from "./competition/FinalPanel.vue";
import ScoreLevels from "./competition/ScoreLevels.vue";
import { api, jsonBody } from "../lib/http";
import { confirm } from "../lib/confirm";
import { useSession } from "../lib/session";
import { vSnapIndicator } from "../lib/tabs";
import { eventPointsNote } from "../lib/competition-contest";
import { fmtDate } from "../lib/format";
import { useAction, useResource } from "../lib/resource";
import { KIND_TEXT, STATUS_TEXT } from "../lib/competitions";
import {
  PARTICIPATION_TEXT, ROLE_TEXT, SCORE_KIND_TEXT, SCORING_TEXT, SIGNUP_STATUS_TEXT, TEAM_STATUS_TEXT,
  canRemoveSignup, emptyScoreForm, exportRateLimitNotice, matchSignups, removalNotice, removalResultText,
  rosterCsvName, rosterCsvPath, rosterStats, scoreErrors, scorePayload,
  scoreTargetText, scoreTargetUrl, settingsErrors, settingsForm, settingsPayload, teamLeader,
  type ScoreErrors, type ScoreForm, type SettingsErrors, type SettingsForm,
} from "../lib/competition-hub";
import type { CompetitionRecord, CompetitionRoster, CompetitionRules, RosterSignup, RosterTeam, ScoreEvent, ScoreEventList, SignupRemoval } from "../lib/types";

const route = useRoute();
const router = useRouter();
const { can } = useSession();
const id = computed(() => String(route.params.id ?? ""));

/** 没有单场控制台接口：从列表里取这一场（已下线的也在）。 */
const competitions = useResource(() => api<{ competitions: CompetitionRecord[] }>("/api/console/competitions"));
const competition = computed(() => competitions.data.value?.competitions.find(row => row.id === id.value));
const isExternal = computed(() => competition.value?.kind === "external");

// 名单要 competition.manage，积分记录要 competition.score.review（服务端同样核验）；没有的不去读
const roster = useResource(() => api<CompetitionRoster>(`/api/console/competitions/${encodeURIComponent(id.value)}/roster`), [id], {
  enabled: () => can("competition.manage"),
});
const events = useResource(() => api<ScoreEventList>(`/api/console/competitions/${encodeURIComponent(id.value)}/score-events`), [id], {
  enabled: () => can("competition.score.review"),
});
const scoringEnabled = computed(() => roster.data.value?.settings.scoring === "contribution");

// —— 页签（#278）：报名与名单、积分是原来的两块（都读名单，要 competition.manage；积分另要 competition.score.review）；
// 待确认贡献、计分与奖项、官网、定榜只对内部比赛。都按权限出现，默认开第一个 ——
type Tab = "signup" | "scores" | "candidates" | "rules" | "site" | "final";
const tabs = computed(() => {
  const list: { id: Tab; label: string }[] = [];
  if (can("competition.manage")) list.push({ id: "signup", label: "报名与名单" });
  if (can("competition.manage") && can("competition.score.review")) list.push({ id: "scores", label: "积分" });
  if (isExternal.value) return list;
  if (can("competition.score.review")) list.push({ id: "candidates", label: "待确认贡献" });
  if (can("competition.manage") || can("competition.score.review")) list.push({ id: "rules", label: "计分与奖项" });
  if (can("competition.manage") || can("competition.site.publish")) list.push({ id: "site", label: "官网" });
  if (can("competition.manage")) list.push({ id: "final", label: "定榜" });
  return list;
});
const tab = computed<Tab | undefined>(() => tabs.value.find(item => item.id === route.query.tab)?.id ?? tabs.value[0]?.id);
const setTab = (value: string) => void router.replace({ query: { ...route.query, tab: value === tabs.value[0]?.id ? undefined : value } });
// 手机上页签条横向滚动，带 ?tab= 进来时当前页签可能在可视区外：渲染后滚到能看见
const tabsRef = ref<{ $el: HTMLElement } | null>(null);
watch([tab, tabsRef], () => tabsRef.value?.$el.querySelector(".tx-tab-item.is-active")?.scrollIntoView({ block: "nearest", inline: "nearest" }), { flush: "post" });

// 积分记录里这场比赛的 GitLab 项目不拼 GitHub 链接；读不到规则（没有权限、外部比赛）时照旧
const rules = useResource(() => api<CompetitionRules>(`/api/console/competitions/${encodeURIComponent(id.value)}/rules`), [id], {
  enabled: () => can("competition.manage") || can("competition.score.review"),
});
const gitlabProjects = computed(() => rules.data.value?.gitlab_projects ?? []);
/** 候选确认、驳回、改规则、定榜之后，积分记录与名单跟着重读。 */
const onContestChanged = () => Promise.all([events.reload(), roster.reload(), rules.reload()]);

// —— 报名设置 ——

const settings = reactive<SettingsForm>(settingsForm({ enabled: false, participation: "individual", team_min: 1, team_max: 1, scoring: "none" }));
const settingsErrorView = ref<SettingsErrors>({});
watch(() => roster.data.value?.settings, value => {
  if (value) {
    Object.assign(settings, settingsForm(value));
    settingsErrorView.value = {};
  }
}, { immediate: true });

const saveSettings = useAction(async () => {
  const found = settingsErrors(settings, { hasDeadline: Boolean(competition.value?.signup_deadline) });
  settingsErrorView.value = found;
  if (Object.keys(found).length) return;
  await api(`/api/console/competitions/${encodeURIComponent(id.value)}/signup-settings`, { method: "PUT", ...jsonBody(settingsPayload(settings)) });
  toast({ title: "报名设置已保存", variant: "success" });
  await Promise.all([roster.reload(), competitions.reload()]);
});

// —— 名单 ——

const signupColumns = [
  { key: "person", title: "用户", minWidth: 200 },
  { key: "status", title: "状态", width: 92 },
  { key: "note", title: "留言" },
  { key: "looking", title: "找队伍", width: 84 },
  { key: "team", title: "队伍", width: 140 },
  { key: "role", title: "角色", width: 76 },
  { key: "created_at", title: "报名时间（北京时间）", width: 170 },
  { key: "actions", title: "操作", width: 92, align: "right" as const },
];
const teamColumns = [
  { key: "name", title: "队名", minWidth: 180 },
  { key: "status", title: "状态", width: 92 },
  { key: "member_count", title: "人数", width: 72 },
  { key: "leader", title: "领队", width: 200 },
  { key: "members", title: "成员" },
];

const exportError = ref<unknown>(null);
const exporting = ref(false);
async function exportCsv() {
  if (exporting.value) return;
  exporting.value = true;
  exportError.value = null;
  try {
    const csv = await api<string>(rosterCsvPath(id.value));
    const url = URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8" }));
    const link = document.createElement("a");
    link.href = url;
    link.download = rosterCsvName(id.value);
    link.click();
    URL.revokeObjectURL(url);
  } catch (error) {
    const notice = exportRateLimitNotice(error);
    if (notice) toast({ title: notice, variant: "warning" });
    else exportError.value = error;
  } finally {
    exporting.value = false;
  }
}

// —— 移出（#342）：定榜后不能改名单，按钮跟着藏起来；读不到规则时照常显示，服务端仍会拒绝 ——

const finalized = computed(() => rules.data.value?.finalized === true);
const removeSignup = useAction(async (row: RosterSignup) => {
  const result = await api<SignupRemoval>(
    `/api/console/competitions/${encodeURIComponent(id.value)}/signups/${encodeURIComponent(row.account_id)}`, { method: "DELETE" },
  );
  toast({ title: `已移出 @${row.login}`, description: removalResultText(result), variant: "success" });
  await roster.reload();
});
async function askRemoveSignup(row: RosterSignup) {
  const data = roster.data.value;
  if (!data) return;
  const notice = removalNotice(row, data);
  const ok = await confirm({ title: notice.title, body: notice.body, confirmText: "移出", danger: true });
  if (ok) await removeSignup.execute(row);
}

// —— 积分 ——

const score = reactive<ScoreForm>(emptyScoreForm());
const scoreErrorView = ref<ScoreErrors>({});
const candidateQuery = ref("");
watch(() => score.kind, kind => {
  if (kind === "penalty") {
    score.repo = "";
    score.number = "";
    score.importance = "";
    score.core = "";
  }
});

/** 候选：未取消的报名，按登录名搜；选中的那位即使被搜索过滤掉也留在列表里。 */
const candidates = computed(() => {
  const rows = matchSignups(roster.data.value?.signups ?? [], candidateQuery.value).slice(0, 12);
  const selected = roster.data.value?.signups.find(row => row.status === "active" && row.account_id === score.accountId);
  return selected && !rows.some(row => row.account_id === selected.account_id) ? [selected, ...rows] : rows;
});
const candidateChips = computed(() => candidates.value.map(row => ({ value: row.account_id, label: `@${row.login}` })));

const saveScore = useAction(async () => {
  const found = scoreErrors(score);
  scoreErrorView.value = found;
  if (Object.keys(found).length) return;
  await api(`/api/console/competitions/${encodeURIComponent(id.value)}/score-events`, { method: "POST", ...jsonBody(scorePayload(score)) });
  toast({ title: "已登记积分", variant: "success" });
  const kind = score.kind;
  Object.assign(score, emptyScoreForm(kind));
  candidateQuery.value = "";
  await Promise.all([events.reload(), roster.reload()]);
});

const scoreColumns = [
  { key: "created_at", title: "时间（北京时间）", width: 150 },
  { key: "person", title: "选手", width: 180 },
  { key: "kind", title: "类型", width: 108 },
  { key: "target", title: "仓库", width: 220 },
  { key: "points", title: "分值", width: 200 },
  { key: "reason", title: "说明" },
  { key: "created_by", title: "登记人", width: 140 },
  { key: "status", title: "状态", width: 150 },
  { key: "actions", title: "操作", width: 92, align: "right" as const },
];

const revoking = ref<ScoreEvent | null>(null);
const revokeReason = ref("");
const revokeErrorText = ref("");
const revoke = useAction(async () => {
  const target = revoking.value;
  if (!target) return;
  const reason = revokeReason.value.trim();
  if (!reason) {
    revokeErrorText.value = "请填写撤销原因。";
    return;
  }
  if ([...reason].length > 200) {
    revokeErrorText.value = "撤销原因最多 200 个字。";
    return;
  }
  revokeErrorText.value = "";
  await api(`/api/console/competitions/${encodeURIComponent(id.value)}/score-events/${encodeURIComponent(target.id)}/revoke`, { method: "POST", ...jsonBody({ reason }) });
  toast({ title: "已撤销这条积分", variant: "success" });
  revoking.value = null;
  revokeReason.value = "";
  await events.reload();
});
function askRevoke(event: ScoreEvent) {
  revoking.value = event;
  revokeReason.value = "";
  revokeErrorText.value = "";
  revoke.reset();
}

const signupTone = (row: RosterSignup) => (row.status === "cancelled" ? "muted" : "success");
const teamTone = (team: RosterTeam) => (team.status === "locked" ? "success" : team.status === "disbanded" ? "muted" : "info");
</script>

<template>
  <div class="page">
    <PageHeader
      :title="competition?.name ?? '比赛报名'"
      :description="competition ? `${KIND_TEXT[competition.kind]} · ${STATUS_TEXT[competition.status]}：${isExternal ? '报名设置、名单与积分' : '报名、积分、官网与定榜'}。` : '报名、积分、官网与定榜。'"
    >
      <template #actions>
        <TxButton icon="i-carbon-arrow-left" @click="router.push('/console/competitions')">返回比赛列表</TxButton>
      </template>
    </PageHeader>

    <ErrorPanel v-if="competitions.error.value" :error="competitions.error.value" :retry="competitions.reload" />
    <LoadingBlock v-else-if="!competitions.data.value" :lines="3" />
    <TxCard v-else-if="!competition">
      <TxEmptyState title="找不到这场比赛" description="它可能已经被删除。回比赛列表看看。" size="small">
        <template #actions>
          <TxButton variant="secondary" @click="router.push('/console/competitions')">返回比赛列表</TxButton>
        </template>
      </TxEmptyState>
    </TxCard>

    <template v-else>
      <TxAlert v-if="isExternal" type="info" title="外部比赛在官网报名">
        官网的报名是意向，用来找人组队和统计；报名设置与积分由比赛主办方管理，这里不提供。
      </TxAlert>

      <TxAlert v-if="!tabs.length" type="info" title="这里没有你能看的内容">外部比赛的意向名单要「管理比赛」权限。</TxAlert>
      <TxTabs v-else ref="tabsRef" v-snap-indicator :model-value="tab" placement="top" indicator-variant="line" borderless :content-scrollable="false" :content-padding="0" class="hub-tabs" @update:model-value="setTab">
        <TxTabItem v-for="item in tabs" :key="item.id" :name="item.id">
          <template #name>{{ item.label }}</template>
          <template v-if="item.id === 'signup'">
            <TxCard v-if="!isExternal && roster.data.value" class="section">
              <div class="section-head">
                <h2>报名设置</h2>
                <span class="muted">只对内部比赛开放；保存后门户立即生效。</span>
              </div>
              <TxForm :model="settings" label-position="top" class="settings-form">
                <div class="form-grid">
                  <TxFormItem label="在线报名" class="wide">
                    <TxSwitch v-model="settings.enabled" label="开放在线报名" aria-label="开放在线报名" />
                    <span class="field-hint">关闭后已有报名保留，门户不能再报名。</span>
                    <span v-if="settingsErrorView.enabled" class="field-error">{{ settingsErrorView.enabled }}</span>
                  </TxFormItem>
                  <TxFormItem label="参赛形式" class="wide">
                    <TxRadioGroup v-model="settings.participation" type="card" direction="row">
                      <TxRadio v-for="(text, value) in PARTICIPATION_TEXT" :key="value" :value="value" :label="text" />
                    </TxRadioGroup>
                    <span class="field-hint">有未取消的报名后不能再改参赛形式。</span>
                  </TxFormItem>
                  <template v-if="settings.participation === 'team'">
                    <TxFormItem label="每队最低人数">
                      <TxInput v-model="settings.teamMin" type="number" min="1" max="20" class="fill-width" />
                      <span v-if="settingsErrorView.teamMin" class="field-error">{{ settingsErrorView.teamMin }}</span>
                    </TxFormItem>
                    <TxFormItem label="每队最高人数">
                      <TxInput v-model="settings.teamMax" type="number" min="1" max="20" class="fill-width" />
                      <span v-if="settingsErrorView.teamMax" class="field-error">{{ settingsErrorView.teamMax }}</span>
                    </TxFormItem>
                  </template>
                  <TxFormItem label="计分" class="wide">
                    <TxRadioGroup v-model="settings.scoring" type="card" direction="row">
                      <TxRadio v-for="(text, value) in SCORING_TEXT" :key="value" :value="value" :label="text" />
                    </TxRadioGroup>
                    <span class="field-hint">开启后可以登记 Issue、合入的 MR 与作弊扣分，门户和官网显示积分天梯。</span>
                  </TxFormItem>
                </div>
                <ErrorAlert v-if="saveSettings.error.value" :error="saveSettings.error.value" @close="saveSettings.reset()" />
                <div class="form-actions">
                  <TxButton variant="primary" :loading="saveSettings.pending.value" @click="saveSettings.execute()">保存设置</TxButton>
                </div>
              </TxForm>
            </TxCard>
            <ErrorPanel v-if="roster.error.value" :error="roster.error.value" :retry="roster.reload" />
            <LoadingBlock v-else-if="!roster.data.value" :lines="6" />
            <TxCard v-else class="section">
              <div class="section-head">
                <h2>名单</h2>
                <span class="muted">{{ isExternal ? '外部比赛的报名只是意向。' : '含已取消的报名与已解散的队伍。' }}</span>
                <span class="section-end">
                  <TxButton icon="i-carbon-download" :loading="exporting" @click="exportCsv">导出 CSV</TxButton>
                </span>
              </div>
              <ErrorAlert v-if="exportError" :error="exportError" @close="exportError = null" />
              <ErrorAlert v-if="removeSignup.error.value" :error="removeSignup.error.value" @close="removeSignup.reset()" />
              <div class="stats">
                <div v-for="item in rosterStats(roster.data.value, competition.kind)" :key="item.key" class="stat">
                  <span class="stat__value">{{ item.value }}</span>
                  <span class="stat__label">{{ item.label }}</span>
                  <span class="stat__hint">{{ item.hint }}</span>
                </div>
              </div>

              <h3 class="subhead">报名</h3>
              <TxDataTable style="--table-min: 972px" :columns="signupColumns" :data="roster.data.value.signups" row-key="account_id" table-layout="fixed" scroll-x>
                <template #cell-person="{ row }: { row: RosterSignup }">
                  <UserCell :login="row.login" :src="row.avatar_url" />
                </template>
                <template #cell-status="{ row }: { row: RosterSignup }">
                  <TxStatusBadge :text="SIGNUP_STATUS_TEXT[row.status]" :status="signupTone(row)" size="sm" />
                </template>
                <template #cell-note="{ row }: { row: RosterSignup }">
                  <span v-if="row.note" class="clamp-2">{{ row.note }}</span>
                  <span v-else class="muted">—</span>
                </template>
                <template #cell-looking="{ row }: { row: RosterSignup }">
                  <span :class="row.looking_for_team ? '' : 'muted'">{{ row.looking_for_team ? "在找队伍" : "—" }}</span>
                </template>
                <template #cell-team="{ row }: { row: RosterSignup }">
                  <span v-if="row.team_name">{{ row.team_name }}</span>
                  <span v-else class="muted">未成队</span>
                </template>
                <template #cell-role="{ row }: { row: RosterSignup }">
                  <span v-if="row.role">{{ ROLE_TEXT[row.role] }}</span>
                  <span v-else class="muted">—</span>
                </template>
                <template #cell-created_at="{ row }: { row: RosterSignup }">
                  <span class="muted">{{ fmtDate(row.created_at) }}</span>
                </template>
                <template #cell-actions="{ row }: { row: RosterSignup }">
                  <TxButton v-if="canRemoveSignup(row, finalized)" size="sm" variant="ghost" class="danger-text" :aria-label="`把 ${row.login} 移出这场比赛`" :loading="removeSignup.pending.value" @click="askRemoveSignup(row)">移出</TxButton>
                  <span v-else class="muted">—</span>
                </template>
                <template #empty><TxEmptyState title="还没有人报名" description="门户里有成员报名后会出现在这里。" size="small" /></template>
              </TxDataTable>

              <h3 class="subhead">队伍</h3>
              <TxDataTable style="--table-min: 720px" :columns="teamColumns" :data="roster.data.value.teams" row-key="id" table-layout="fixed" scroll-x>
                <template #cell-name="{ row }: { row: RosterTeam }">
                  <span class="cell-stack">
                    <b>{{ row.name }}</b>
                    <span v-if="row.slogan" class="cell-sub ellipsis">{{ row.slogan }}</span>
                  </span>
                </template>
                <template #cell-status="{ row }: { row: RosterTeam }">
                  <TxStatusBadge :text="TEAM_STATUS_TEXT[row.status]" :status="teamTone(row)" size="sm" />
                </template>
                <template #cell-member_count="{ row }: { row: RosterTeam }">
                  <span>{{ row.member_count }}</span>
                </template>
                <template #cell-leader="{ row }: { row: RosterTeam }">
                  <UserCell v-if="teamLeader(row)" :login="teamLeader(row)!.login" :src="teamLeader(row)!.avatar_url" />
                  <span v-else class="muted">—</span>
                </template>
                <template #cell-members="{ row }: { row: RosterTeam }">
                  <span v-if="row.members.length" class="mono ellipsis">{{ row.members.map(member => `@${member.login}`).join("、") }}</span>
                  <span v-else class="muted">—</span>
                </template>
                <template #empty><TxEmptyState title="还没有队伍" description="团队赛里领队建队后会出现在这里。" size="small" /></template>
              </TxDataTable>
            </TxCard>
          </template>
          <template v-else-if="item.id === 'scores'">
            <ErrorPanel v-if="roster.error.value" :error="roster.error.value" :retry="roster.reload" />
            <LoadingBlock v-else-if="!roster.data.value" :lines="6" />
            <TxCard v-else class="section">
              <div class="section-head">
                <h2>积分</h2>
                <span class="muted">手动登记 Issue、合入的 MR 与作弊扣分。分数不手填：选重要程度和核心度查表，再乘记分那一刻的年级系数；GitLab 收来的在「待确认贡献」里确认。记错了撤销，记录保留。</span>
              </div>

              <template v-if="scoringEnabled && !isExternal">
                <TxForm :model="score" label-position="top" class="score-form">
                  <div class="form-grid">
                    <TxFormItem label="选手" class="wide">
                      <TxSearchInput v-model="candidateQuery" placeholder="按登录名搜索已报名的选手" class="fill-width" />
                      <TxFilterChips v-if="candidateChips.length" :model-value="score.accountId" :items="candidateChips" aria-label="选择选手" @update:model-value="value => { score.accountId = String(value); scoreErrorView.accountId = undefined; }" />
                      <span v-if="!candidateChips.length" class="field-hint">还没有未取消的报名，门户有人报名后才能登记。</span>
                      <span v-if="scoreErrorView.accountId" class="field-error">{{ scoreErrorView.accountId }}</span>
                    </TxFormItem>
                    <TxFormItem label="类型" class="wide">
                      <TxRadioGroup v-model="score.kind" type="card" direction="row">
                        <TxRadio v-for="(text, kind) in SCORE_KIND_TEXT" :key="kind" :value="kind" :label="text" />
                      </TxRadioGroup>
                    </TxFormItem>
                    <template v-if="score.kind !== 'penalty'">
                      <TxFormItem label="仓库 owner/name" class="wide">
                        <TxInput v-model="score.repo" class="fill-width" placeholder="例如 geek/admin" />
                        <span v-if="scoreErrorView.repo" class="field-error">{{ scoreErrorView.repo }}</span>
                      </TxFormItem>
                      <TxFormItem label="编号">
                        <TxInput v-model="score.number" type="number" min="1" class="fill-width" placeholder="Issue 或 MR 编号" />
                        <span v-if="scoreErrorView.number" class="field-error">{{ scoreErrorView.number }}</span>
                      </TxFormItem>
                    </template>
                    <ScoreLevels
                      :competition-id="id" :account-id="score.accountId" :kind="score.kind" :errors="scoreErrorView"
                      :importance="score.importance" :core="score.core"
                      @update:importance="value => { score.importance = value; scoreErrorView.importance = undefined; }"
                      @update:core="value => { score.core = value; scoreErrorView.core = undefined; }"
                    />
                    <TxFormItem label="说明" class="wide">
                      <TxTextarea v-model="score.reason" :rows="2" placeholder="写清合入的改动或扣分原因，≤200 字。" />
                      <span v-if="scoreErrorView.reason" class="field-error">{{ scoreErrorView.reason }}</span>
                    </TxFormItem>
                  </div>
                  <ErrorAlert v-if="saveScore.error.value" :error="saveScore.error.value" @close="saveScore.reset()" />
                  <div class="form-actions">
                    <TxButton variant="primary" :loading="saveScore.pending.value" @click="saveScore.execute()">登记积分</TxButton>
                  </div>
                </TxForm>
              </template>
              <p v-else class="muted">
                {{ isExternal ? "外部比赛不在这里记积分。" : "这场比赛没有开启积分。在「报名设置」里选「开源贡献积分」后可以登记。" }}
              </p>

              <h3 class="subhead">登记记录</h3>
              <ErrorPanel v-if="events.error.value" :error="events.error.value" :retry="events.reload" />
              <LoadingBlock v-else-if="!events.data.value" :lines="4" />
              <TxDataTable v-else style="--table-min: 1104px" :columns="scoreColumns" :data="events.data.value.events" row-key="id" table-layout="fixed" scroll-x>
                <template #cell-created_at="{ row }: { row: ScoreEvent }">
                  <span class="muted">{{ fmtDate(row.created_at) }}</span>
                </template>
                <template #cell-person="{ row }: { row: ScoreEvent }">
                  <UserCell :login="row.person.login" :src="row.person.avatar_url" />
                </template>
                <template #cell-kind="{ row }: { row: ScoreEvent }">
                  <span>{{ SCORE_KIND_TEXT[row.kind] }}</span>
                </template>
                <template #cell-target="{ row }: { row: ScoreEvent }">
                  <a v-if="scoreTargetUrl(row, gitlabProjects)" class="mono" :href="scoreTargetUrl(row, gitlabProjects)!" target="_blank" rel="noreferrer">{{ scoreTargetText(row) }}</a>
                  <span v-else-if="row.repo" class="mono">{{ scoreTargetText(row) }}</span>
                  <span v-else class="muted">—</span>
                </template>
                <template #cell-points="{ row }: { row: ScoreEvent }">
                  <span class="cell-stack">
                    <span class="mono points" :class="row.points > 0 ? 'points--positive' : 'points--negative'">{{ row.points > 0 ? `+${row.points}` : row.points }}</span>
                    <span v-if="eventPointsNote(row)" class="cell-sub">{{ eventPointsNote(row) }}</span>
                  </span>
                </template>
                <template #cell-reason="{ row }: { row: ScoreEvent }">
                  <span v-if="row.reason" class="clamp-2">{{ row.reason }}</span>
                  <span v-else class="muted">—</span>
                </template>
                <template #cell-created_by="{ row }: { row: ScoreEvent }">
                  <span class="mono muted">@{{ row.created_by_login }}</span>
                </template>
                <template #cell-status="{ row }: { row: ScoreEvent }">
                  <span class="cell-stack">
                    <TxStatusBadge :text="row.status === 'active' ? '有效' : '已撤销'" :status="row.status === 'active' ? 'success' : 'muted'" size="sm" />
                    <span v-if="row.revoke_reason" class="cell-sub ellipsis">原因：{{ row.revoke_reason }}</span>
                  </span>
                </template>
                <template #cell-actions="{ row }: { row: ScoreEvent }">
                  <TxButton v-if="row.status === 'active'" size="sm" variant="ghost" class="danger-text" @click="askRevoke(row)">撤销</TxButton>
                  <span v-else class="muted">—</span>
                </template>
                <template #empty><TxEmptyState title="还没有积分记录" description="登记一条以后会出现在这里；撤销的记录也会保留。" size="small" /></template>
              </TxDataTable>
            </TxCard>
          </template>
          <CandidatesPanel v-else-if="item.id === 'candidates'" :competition-id="id" @changed="onContestChanged" />
          <RulesPanel v-else-if="item.id === 'rules'" :competition-id="id" :can-edit="can('competition.manage')" @changed="onContestChanged" />
          <SitePanel v-else-if="item.id === 'site'" :competition-id="id" :can-publish="can('competition.site.publish')" @changed="onContestChanged" />
          <FinalPanel v-else :competition-id="id" :end-at="competition.end_at" :can-manage="can('competition.manage')" @changed="onContestChanged" />
        </TxTabItem>
      </TxTabs>
    </template>

    <TxModal :model-value="Boolean(revoking)" title="撤销这条积分" width="min(92vw, 520px)" @update:model-value="value => { if (!value) revoking = null; }">
      <p v-if="revoking" class="revoke-summary">
        {{ SCORE_KIND_TEXT[revoking.kind] }} · @{{ revoking.person.login }} · {{ revoking.points > 0 ? `+${revoking.points}` : revoking.points }} 分
      </p>
      <p class="muted">撤销后这条记录不再计分，记录与原因会保留，可以追溯。</p>
      <TxForm :model="{ reason: revokeReason }" label-position="top">
        <TxFormItem label="撤销原因">
          <TxTextarea v-model="revokeReason" :rows="3" placeholder="例如：重复登记，MR 实际没有合入。" />
          <span v-if="revokeErrorText" class="field-error">{{ revokeErrorText }}</span>
        </TxFormItem>
      </TxForm>
      <ErrorAlert v-if="revoke.error.value" :error="revoke.error.value" @close="revoke.reset()" />
      <template #footer>
        <div class="dialog-actions">
          <TxButton variant="secondary" @click="revoking = null">取消</TxButton>
          <TxButton variant="danger" :loading="revoke.pending.value" @click="revoke.execute()">撤销记录</TxButton>
        </div>
      </template>
    </TxModal>
  </div>
</template>

<style scoped>
.section {
  margin-top: 16px;
}
.section-head {
  display: flex;
  flex-wrap: wrap;
  align-items: baseline;
  gap: 8px 12px;
  margin-bottom: 14px;
}
.section-head h2 {
  margin: 0;
  font-size: 1.05rem;
}
.section-end {
  margin-left: auto;
  display: inline-flex;
  gap: 8px;
}
.subhead {
  margin: 18px 0 8px;
  font-size: 0.95rem;
}
.stats {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(150px, 1fr));
  gap: 10px;
}
.stat {
  display: flex;
  flex-direction: column;
  gap: 2px;
  padding: 12px 14px;
  border-radius: 12px;
  background: var(--tx-bg-color-page);
}
.stat__value {
  font-size: 1.4rem;
  font-weight: 600;
  line-height: 1.2;
}
.stat__label {
  font-size: 0.8125rem;
}
.stat__hint {
  font-size: 0.75rem;
  opacity: 0.72;
}
.form-grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(220px, 1fr));
  gap: 4px 16px;
}
.form-grid .wide {
  grid-column: 1 / -1;
}
.form-actions {
  display: flex;
  justify-content: flex-end;
  margin-top: 4px;
}
.field-hint {
  display: block;
  margin-top: 4px;
  font-size: 0.75rem;
  line-height: 1.125rem;
  opacity: 0.75;
}
.field-error {
  display: block;
  margin-top: 4px;
  font-size: 0.75rem;
  line-height: 1.125rem;
  color: var(--tx-color-danger);
}
.points {
  font-weight: 600;
}
.points--positive {
  color: var(--tx-color-success);
}
.points--negative {
  color: var(--tx-color-danger);
}
.danger-text {
  color: var(--tx-color-danger);
}
.cell-title {
  display: flex;
  align-items: center;
  gap: 8px;
  min-width: 0;
}
.dialog-actions {
  display: flex;
  justify-content: flex-end;
  gap: 8px;
}
.revoke-summary {
  margin: 0 0 8px;
  font-weight: 600;
}
.hub-tabs :deep(.tx-tabs__nav) {
  border-bottom: 1px solid var(--tx-border-color-lighter);
}
/* 六个页签在手机上放不下：不折行，横向滚动（导航条的 flex 子项要能缩到容器宽，滚动才落在 nav-inner 上） */
.hub-tabs :deep(.tx-tabs__nav-bar) {
  flex: 1 1 auto;
  min-width: 0;
}
.hub-tabs :deep(.tx-tab-item) {
  flex: none;
  white-space: nowrap;
}
.settings-form :deep(.tx-input),
.score-form :deep(.tx-input) {
  min-height: 44px;
}
.dialog-actions :deep(button),
.section-end :deep(button) {
  min-height: 44px;
  min-width: 44px;
}
</style>

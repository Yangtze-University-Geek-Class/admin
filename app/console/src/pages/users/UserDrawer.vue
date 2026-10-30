<script setup lang="ts">
import { computed, reactive, ref, watch } from "vue";
import { TxDrawer } from "@talex-touch/tuffex/drawer";
import { TxTabs, TxTabItem } from "@talex-touch/tuffex/tabs";
import { TxForm, TxFormItem } from "@talex-touch/tuffex/form";
import { TxRadioGroup, TxRadio } from "@talex-touch/tuffex/radio";
import { TxSwitch } from "@talex-touch/tuffex/switch";
import { TxInput } from "@talex-touch/tuffex/input";
import { TxSelect } from "@talex-touch/tuffex/select";
import { TxButton } from "@talex-touch/tuffex/button";
import { TxAvatar } from "@talex-touch/tuffex/avatar";
import { TxTag } from "@talex-touch/tuffex/tag";
import { TxStatusBadge } from "@talex-touch/tuffex/status-badge";
import { TxEmptyState } from "@talex-touch/tuffex/empty-state";
import { TxSkeleton } from "@talex-touch/tuffex/skeleton";
import { TxTimeline, TxTimelineItem } from "@talex-touch/tuffex/timeline";
import { toast } from "@talex-touch/tuffex/utils";
import TitleBadge from "../../components/TitleBadge.vue";
import ErrorAlert from "../../components/ErrorAlert.vue";
import ErrorPanel from "../../components/ErrorPanel.vue";
import { api, jsonBody } from "../../lib/http";
import { confirm } from "../../lib/confirm";
import { fmtDate, fmtRelative } from "../../lib/format";
import { actionText, outcomeText, surfaceText, targetText } from "../../lib/activity";
import { ASSIGNABLE_LEVELS, GITLAB_STATE_TEXT, LEVEL_TEXT, PROVIDER_TEXT, levelText } from "../../lib/levels";
import { GROUP_KIND_TEXT, metaValueText, nodesByDomain } from "../../lib/permissions";
import { useAction } from "../../lib/resource";
import { GRADE_OPTIONS, isSelectableGrade } from "../../lib/grade";
import { useSession } from "../../lib/session";
import { vSnapIndicator } from "../../lib/tabs";
import { DEPT_TONE_SWATCH, deptTone } from "../../lib/tone";
import { SITE_OWNER_TITLE, departmentChoices, departmentOf, draftFromUser, nameOf, titleChoices, titleTone, userPatch, withDepartment, type UserDraft } from "../../lib/users";
import type { ActivityEvent, ActivityPage, ConsoleUser, EffectivePermissions, PublicDepartment } from "../../lib/types";

/**
 * 用户详情抽屉：资料与修改（真实姓名和年级、身份、部门、称号、站长、停用）、这个人的操作记录、有效权限。
 * 真实姓名只有 users.manage 才看得到（#280，接口不给就没有这一行）；本人填过以后只能在这里改。
 * 改动用 PATCH /api/console/users/:id，成功后把服务端回的那一行交给列表。
 */
const props = defineProps<{ user: ConsoleUser | null; departments: PublicDepartment[] }>();
const emit = defineEmits<{ close: []; updated: [user: ConsoleUser] }>();
const { can, permissionLabel } = useSession();
const canManage = computed(() => can("users.manage"));
const canDisable = computed(() => can("users.disable"));
const canActivity = computed(() => can("activity.read"));
const canEffective = computed(() => can("perm.view"));

const visible = computed({ get: () => props.user !== null, set: value => { if (!value) emit("close"); } });
const tab = ref("profile");

const draft = reactive<UserDraft>({ level: "registered", department: "dept.none", title: "", owner: false, real_name: "", grade: "" });
const gradeInput = computed({ get: () => draft.grade, set: (value: string | number | (string | number)[]) => { draft.grade = isSelectableGrade(value) ? value : ""; } });
const showsRealName = computed(() => props.user?.real_name !== undefined);
const reset = (user: ConsoleUser) => Object.assign(draft, draftFromUser(user));

const departmentOptions = computed(() => departmentChoices(props.departments));
const titleOptions = computed(() => titleChoices(props.departments.find(item => item.id === draft.department)));
const pick = (department: string | number) => Object.assign(draft, withDepartment(draft, String(department)));
const patch = computed(() => (props.user ? userPatch(props.user, draft) : null));
const isOwner = computed(() => Boolean(props.user?.titles.some(item => item.id === SITE_OWNER_TITLE.id)));

const save = useAction(async (user: ConsoleUser) => {
  const body = userPatch(user, draft);
  if (!body) return;
  const updated = await api<ConsoleUser>(`/api/console/users/${encodeURIComponent(user.account_id)}`, { method: "PATCH", ...jsonBody(body) });
  reset(updated);
  emit("updated", updated);
  toast({ title: "已保存", description: `${nameOf(updated)} @${updated.username}`, variant: "success" });
});
async function submit() {
  const user = props.user;
  if (!user || !patch.value) return;
  if (draft.owner !== isOwner.value) {
    const ok = await confirm(draft.owner
      ? { title: `把 ${nameOf(user)} 设为站长？`, body: "站长拥有全部权限，包括改别人的权限和设立其他站长。", confirmText: "设为站长", danger: true }
      : { title: `取消 ${nameOf(user)} 的站长？`, body: "取消后这个人只保留身份、部门和称号带来的权限。系统里最后一位站长不能取消。", confirmText: "取消站长", danger: true });
    if (!ok) return;
  }
  await save.execute(user);
}

const status = useAction(async (user: ConsoleUser) => {
  const next = user.status === "active" ? "disabled" : "active";
  const updated = await api<ConsoleUser>(`/api/console/users/${encodeURIComponent(user.account_id)}`, { method: "PATCH", ...jsonBody({ status: next }) });
  emit("updated", updated);
  toast({ title: next === "disabled" ? "已停用" : "已重新启用", description: `${nameOf(updated)} @${updated.username}`, variant: "success" });
});
async function toggleStatus() {
  const user = props.user;
  if (!user) return;
  const disabling = user.status === "active";
  const ok = await confirm(disabling
    ? { title: `停用 ${nameOf(user)}？`, body: "停用后这个账号马上退出所有设备，命令行令牌和 GitLab 登录也一起失效，之后不能再登录。可以随时重新启用。", confirmText: "停用", danger: true }
    : { title: `重新启用 ${nameOf(user)}？`, body: "启用后这个人可以重新登录，原来的身份、部门和称号不变。", confirmText: "重新启用" });
  if (ok) await status.execute(user);
}

// ---- 操作记录与有效权限：打开对应的页签时才读，换人时清空 ----

type Loaded<T> = { account: string; data: T | null; error: unknown; loading: boolean };
const activity = ref<Loaded<{ items: ActivityEvent[]; next: string | null }> | null>(null);
const effective = ref<Loaded<EffectivePermissions> | null>(null);

async function loadActivity(more = false) {
  const user = props.user;
  if (!user) return;
  const account = user.account_id;
  const before = more && activity.value?.account === account ? activity.value.data : null;
  activity.value = { account, data: before, error: null, loading: true };
  try {
    const cursor = before?.next ? `?cursor=${encodeURIComponent(before.next)}` : "";
    const data = await api<ActivityPage>(`/api/console/accounts/${encodeURIComponent(account)}/activity${cursor}`);
    if (props.user?.account_id !== account) return;
    activity.value = { account, data: { items: [...(before?.items ?? []), ...data.items], next: data.next_cursor }, error: null, loading: false };
  } catch (error) {
    if (props.user?.account_id !== account) return;
    activity.value = { account, data: before, error, loading: false };
  }
}
async function loadEffective() {
  const user = props.user;
  if (!user) return;
  const account = user.account_id;
  effective.value = { account, data: null, error: null, loading: true };
  try {
    const data = await api<EffectivePermissions>(`/api/console/accounts/${encodeURIComponent(account)}/effective`);
    if (props.user?.account_id === account) effective.value = { account, data, error: null, loading: false };
  } catch (error) {
    if (props.user?.account_id === account) effective.value = { account, data: null, error, loading: false };
  }
}
watch(tab, value => {
  if (value === "activity" && !activity.value) void loadActivity();
  if (value === "effective" && !effective.value) void loadEffective();
});
// 资料改过之后有效权限会变，下次打开重新读。
watch(() => props.user, () => { if (effective.value?.data) effective.value = null; });

// 换了一个人：表单回到这个人的样子，页签回到资料，其余结果清空。
watch(() => props.user?.account_id, id => {
  if (!id || !props.user) return;
  reset(props.user);
  tab.value = "profile";
  save.reset();
  status.reset();
  activity.value = null;
  effective.value = null;
}, { immediate: true });

const allowByDomain = computed(() => nodesByDomain(effective.value?.data?.allow ?? []));
const groupName = (id: string) => effective.value?.data?.groups.find(group => group.id === id)?.name ?? id;

const TIMELINE_COLOR = { ok: "success", denied: "error", limited: "warning", error: "error" } as const;
const providerText = (user: ConsoleUser) => user.providers.map(item => PROVIDER_TEXT[item] ?? item).join("、") || "-";
</script>

<template>
  <TxDrawer v-model:visible="visible" :title="user ? nameOf(user) : '用户详情'" direction="right" size="min(560px, 100vw)" :mobile-adapt="false" :show-footer="false">
    <div v-if="user" class="detail">
      <header class="who">
        <TxAvatar :src="user.avatar_url ?? undefined" :name="nameOf(user)" :size="48" />
        <div class="who__text">
          <p class="who__name ellipsis">{{ nameOf(user) }}</p>
          <p class="mono muted ellipsis">@{{ user.username }}</p>
        </div>
        <TxStatusBadge :text="user.status === 'active' ? '正常' : '已停用'" :status="user.status === 'active' ? 'success' : 'muted'" size="sm" />
      </header>

      <TxTabs v-model="tab" v-snap-indicator placement="top" indicator-variant="line" borderless :content-scrollable="false" :content-padding="0">
        <TxTabItem name="profile">
          <template #name>资料</template>
          <div class="pane">
            <dl class="facts">
              <template v-if="showsRealName">
                <dt>真实姓名</dt>
                <dd><span v-if="user.real_name">{{ user.real_name }}</span><span v-else class="muted">没填</span></dd>
              </template>
              <dt>年级</dt>
              <dd><span v-if="user.grade_label">{{ user.grade_label }}</span><span v-else class="muted">没填</span></dd>
              <dt>身份</dt><dd>{{ levelText(user.level) }}</dd>
              <dt>部门</dt>
              <dd>
                <span v-if="departmentOf(user)" class="dept">
                  <span class="dept__dot" :style="{ background: DEPT_TONE_SWATCH[deptTone(departmentOf(user)!.tone)] }" aria-hidden="true" />{{ departmentOf(user)!.name }}
                </span>
                <span v-else class="muted">无部门</span>
              </dd>
              <dt>称号</dt>
              <dd>
                <span v-if="user.titles.length" class="tags">
                  <TitleBadge v-for="title in user.titles" :key="title.id" :label="title.name" :tone="titleTone(title, user.department)" />
                </span>
                <span v-else class="muted">没有称号</span>
              </dd>
              <dt>登录方式</dt><dd>{{ providerText(user) }}</dd>
              <dt>GitLab</dt><dd>{{ GITLAB_STATE_TEXT[user.gitlab.state] ?? user.gitlab.state }}</dd>
              <dt>最近登录</dt><dd>{{ user.last_login_at ? fmtDate(user.last_login_at) : "没登录过" }}</dd>
              <dt>注册时间</dt><dd>{{ fmtDate(user.created_at) }}</dd>
            </dl>

            <ErrorAlert v-if="save.error.value" :error="save.error.value" @close="save.reset()" />
            <TxForm v-if="canManage" :model="draft" label-position="top" class="edit" @submit="submit">
              <h3 class="section-title">修改</h3>
              <TxFormItem v-if="showsRealName" v-slot="{ id }" label="真实姓名">
                <TxInput :id="id" v-model="draft.real_name" class="fill-width" placeholder="和学籍上一致" maxlength="32" spellcheck="false" />
              </TxFormItem>
              <TxFormItem label="年级">
                <!-- TxSelect 0.6.0 的 attrs 落在外层，用 label 给里面的输入框命名。 -->
                <label class="fill-width">
                  <span class="sr-only">年级</span>
                  <TxSelect v-model="gradeInput" :options="GRADE_OPTIONS" placeholder="选择年级" class="fill-width" :searchable="false" panel-background="pure" />
                </label>
                <p class="hint">本人填过以后只能在这里改。年级每年 9 月 1 日自动升一级，大四之后是已毕业。</p>
              </TxFormItem>
              <TxFormItem label="身份">
                <TxRadioGroup v-model="draft.level" type="card" direction="row" class="choices choices--3" aria-label="身份">
                  <TxRadio v-for="level in ASSIGNABLE_LEVELS" :key="level" :value="level" :label="LEVEL_TEXT[level]" />
                </TxRadioGroup>
              </TxFormItem>
              <TxFormItem label="部门">
                <TxRadioGroup :model-value="draft.department" type="card" direction="row" class="choices choices--2" aria-label="部门" @update:model-value="pick">
                  <TxRadio v-for="option in departmentOptions" :key="option.value" :value="option.value">
                    <span class="dept">
                      <span class="dept__dot" :style="{ background: DEPT_TONE_SWATCH[deptTone(option.tone)] }" aria-hidden="true" />{{ option.label }}
                    </span>
                  </TxRadio>
                </TxRadioGroup>
              </TxFormItem>
              <TxFormItem label="称号">
                <TxRadioGroup v-if="titleOptions.length" v-model="draft.title" type="card" direction="row" class="choices choices--2" aria-label="称号">
                  <TxRadio v-for="option in titleOptions" :key="option.value" :value="option.value" :label="option.label" />
                </TxRadioGroup>
                <p v-else class="hint">选了部门才能给部门称号。</p>
              </TxFormItem>
              <TxFormItem label="站长">
                <TxSwitch v-model="draft.owner" label="设为站长" aria-label="设为站长" />
                <p class="hint">站长拥有全部权限，不属于任何部门。系统里最后一位站长不能取消。</p>
              </TxFormItem>
              <p class="hint">换部门时，原来部门的称号会一起去掉。</p>
              <div class="actions">
                <TxButton variant="secondary" native-type="button" :disabled="!patch || save.pending.value" @click="reset(user)">还原</TxButton>
                <TxButton variant="primary" native-type="submit" :disabled="!patch" :loading="save.pending.value">保存</TxButton>
              </div>
            </TxForm>
            <p v-else class="hint">改姓名、年级、身份、部门和称号需要「{{ permissionLabel("users.manage") }}」权限。</p>

            <section v-if="canDisable" class="status">
              <h3 class="section-title">账号状态</h3>
              <ErrorAlert v-if="status.error.value" :error="status.error.value" @close="status.reset()" />
              <p class="hint">{{ user.status === "active" ? "停用后这个人不能再登录，已有的登录全部失效。" : "这个账号已停用，不能登录。" }}</p>
              <div class="actions actions--start">
                <TxButton :variant="user.status === 'active' ? 'danger' : 'primary'" :loading="status.pending.value" @click="toggleStatus">
                  {{ user.status === "active" ? "停用账号" : "重新启用" }}
                </TxButton>
              </div>
            </section>
          </div>
        </TxTabItem>

        <TxTabItem v-if="canActivity" name="activity">
          <template #name>操作记录</template>
          <div class="pane">
            <ErrorPanel v-if="activity?.error && !activity.data" :error="activity.error" :retry="() => loadActivity()" size="small" />
            <TxSkeleton v-else-if="!activity?.data" :loading="true" :lines="6" />
            <TxEmptyState v-else-if="!activity.data.items.length" variant="no-data" title="还没有记录" description="这个人登录、发帖、投递或在控制台里操作后会记在这里。" size="small" />
            <template v-else>
              <TxTimeline>
                <TxTimelineItem
                  v-for="row in activity.data.items"
                  :key="row.id"
                  :title="actionText(row.action) || row.action"
                  :time="fmtDate(row.at)"
                  :color="TIMELINE_COLOR[row.outcome] ?? 'default'"
                >
                  <span class="event">
                    <span class="mono">{{ row.action }}</span>
                    <span>{{ surfaceText(row.surface) }} · {{ outcomeText(row.outcome) }}</span>
                    <span v-if="targetText(row)" class="mono ellipsis">{{ targetText(row) }}</span>
                  </span>
                </TxTimelineItem>
              </TxTimeline>
              <p v-if="activity.error" class="hint hint--error">没有读到更多，点「加载更多」再试一次。</p>
              <div class="actions actions--split">
                <RouterLink :to="{ path: '/console/activity', query: { account: user.account_id } }" class="more-link">在操作记录里筛选这个人</RouterLink>
                <TxButton v-if="activity.data.next" variant="secondary" :loading="activity.loading" @click="loadActivity(true)">加载更多</TxButton>
              </div>
            </template>
          </div>
        </TxTabItem>

        <TxTabItem v-if="canEffective" name="effective">
          <template #name>有效权限</template>
          <div class="pane">
            <ErrorPanel v-if="effective?.error" :error="effective.error" :retry="loadEffective" size="small" />
            <TxSkeleton v-else-if="!effective?.data" :loading="true" :lines="6" />
            <template v-else>
              <section class="block">
                <h3 class="section-title">所在的组</h3>
                <ul v-if="effective.data.groups.length" class="groups">
                  <li v-for="group in effective.data.groups" :key="group.id">
                    <TxTag :label="GROUP_KIND_TEXT[group.kind] ?? group.kind" variant="outline" size="sm" />
                    <span>{{ group.name }}</span>
                    <span v-if="group.via.length" class="muted">经 {{ group.via.map(groupName).join(" → ") }}</span>
                  </li>
                </ul>
                <p v-else class="hint">没有在任何组里。</p>
              </section>
              <section class="block">
                <h3 class="section-title">允许 {{ effective.data.allow.length }} 项</h3>
                <p v-if="!effective.data.allow.length" class="hint">没有允许的节点。</p>
                <div v-for="domain in allowByDomain" :key="domain.id" class="domain">
                  <p class="domain__label">{{ domain.label }}</p>
                  <span class="tags">
                    <TxTag v-for="node in domain.nodes" :key="node" :label="permissionLabel(node)" :title="node" variant="soft" size="sm" />
                  </span>
                </div>
              </section>
              <section v-if="effective.data.deny.length" class="block">
                <h3 class="section-title">拒绝 {{ effective.data.deny.length }} 项</h3>
                <span class="tags">
                  <TxTag v-for="node in effective.data.deny" :key="node" :label="permissionLabel(node)" :title="node" variant="outline" size="sm" color="var(--tx-color-danger)" />
                </span>
              </section>
              <section v-if="Object.keys(effective.data.meta).length" class="block">
                <h3 class="section-title">限额</h3>
                <dl class="facts facts--wide">
                  <template v-for="(value, key) in effective.data.meta" :key="key">
                    <dt>{{ permissionLabel(String(key)) }}</dt>
                    <dd>{{ metaValueText(value) }}</dd>
                  </template>
                </dl>
              </section>
              <RouterLink :to="{ path: '/console/permissions', query: { tab: 'explain', account: user.account_id } }" class="more-link">在「权限」里查某一项为什么允许或拒绝</RouterLink>
            </template>
          </div>
        </TxTabItem>
      </TxTabs>
    </div>
  </TxDrawer>
</template>

<style scoped>
.detail {
  display: flex;
  flex-direction: column;
  gap: 12px;
  min-width: 0;
}
.who {
  display: flex;
  align-items: center;
  gap: 12px;
  min-width: 0;
}
.who__text {
  flex: 1;
  min-width: 0;
}
.who__text p {
  margin: 0;
}
.who__name {
  font-size: 16px;
  font-weight: 600;
  line-height: 24px;
}
.pane {
  display: flex;
  flex-direction: column;
  gap: 16px;
  padding-top: 14px;
  min-width: 0;
}
.dept {
  display: inline-flex;
  align-items: center;
  gap: 6px;
}
.dept__dot {
  width: 8px;
  height: 8px;
  border-radius: 50%;
  flex-shrink: 0;
}
.edit,
.status {
  display: flex;
  flex-direction: column;
  gap: 4px;
  padding-top: 14px;
  border-top: 1px solid var(--tx-border-color-lighter);
}
.edit .section-title,
.status .section-title {
  margin-bottom: 6px;
}
/* 卡片单选在一行里按格子排，不让每张卡占满整行（Tuffex 0.6.0 的卡片默认 width:100%）。 */
.choices {
  display: grid;
  gap: 8px;
  width: 100%;
}
.choices--3 {
  grid-template-columns: repeat(3, minmax(0, 1fr));
}
.choices--2 {
  grid-template-columns: repeat(2, minmax(0, 1fr));
}
.choices :deep(.tx-radio) {
  min-height: 44px;
}
.hint {
  margin: 4px 0 0;
  font-size: 13px;
  line-height: 20px;
  color: var(--tx-text-color-secondary);
}
.hint--error {
  color: var(--tx-color-danger);
}
.actions {
  display: flex;
  flex-wrap: wrap;
  justify-content: flex-end;
  align-items: center;
  gap: 8px;
  margin-top: 12px;
}
.actions--start {
  justify-content: flex-start;
  margin-top: 4px;
}
.actions--split {
  justify-content: space-between;
}
.actions :deep(button) {
  min-height: 44px;
  min-width: 44px;
}
.event {
  display: flex;
  flex-direction: column;
  gap: 2px;
  font-size: 13px;
  color: var(--tx-text-color-secondary);
  min-width: 0;
}
.more-link {
  display: inline-flex;
  align-items: center;
  min-height: 44px;
  font-size: 13px;
}
.block {
  display: flex;
  flex-direction: column;
  gap: 8px;
}
.groups {
  display: flex;
  flex-direction: column;
  gap: 6px;
  margin: 0;
  padding: 0;
  list-style: none;
  font-size: 14px;
}
.groups li {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 4px 8px;
}
.domain__label {
  margin: 4px 0 6px;
  font-size: 12px;
  color: var(--tx-text-color-secondary);
}
.facts--wide {
  grid-template-columns: minmax(0, 1fr) auto;
}
@media (max-width: 480px) {
  .choices--3,
  .choices--2 {
    grid-template-columns: minmax(0, 1fr);
  }
}
</style>

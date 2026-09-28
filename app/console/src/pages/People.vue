<script setup lang="ts">
import { computed, ref, watch } from "vue";
import { useRoute, useRouter } from "vue-router";
import { TxCard } from "@talex-touch/tuffex/card";
import { TxCardItem } from "@talex-touch/tuffex/card-item";
import { TxTabs, TxTabItem } from "@talex-touch/tuffex/tabs";
import { TxDataTable } from "@talex-touch/tuffex/data-table";
import { TxButton } from "@talex-touch/tuffex/button";
import { TxBadge } from "@talex-touch/tuffex/badge";
import { TxEmptyState } from "@talex-touch/tuffex/empty-state";
import { TxTag } from "@talex-touch/tuffex/tag";
import { toast } from "@talex-touch/tuffex/utils";
import PageHeader from "../components/PageHeader.vue";
import UserCell from "../components/UserCell.vue";
import TitleBadge from "../components/TitleBadge.vue";
import ErrorPanel from "../components/ErrorPanel.vue";
import ErrorAlert from "../components/ErrorAlert.vue";
import LoadingBlock from "../components/LoadingBlock.vue";
import AssignDialog from "./people/AssignDialog.vue";
import BundleDialog from "./people/BundleDialog.vue";
import TitleList from "./people/TitleList.vue";
import PermissionTree from "./people/PermissionTree.vue";
import { api } from "../lib/http";
import { confirm } from "../lib/confirm";
import { fmtDate, fmtDay } from "../lib/format";
import { carbon } from "../lib/icons";
import {
  GROUP_ALL, GROUP_NONE, canAppointCaptain, githubRoleText, holdersOf, isOwnCaptainRow, leadsOf, mayRevoke, peopleGroups, peopleInGroup, sortPeople,
} from "../lib/people";
import { useAction, useResource } from "../lib/resource";
import { useSession } from "../lib/session";
import { titleLabel, toneColor } from "../lib/titles";
import type { Assignment, AssignmentsResponse, Department, PeopleResponse, Person, TitleView } from "../lib/types";

const route = useRoute();
const router = useRouter();
const { me, catalogue, catalogueFailed, can, capabilityLabel, reload: reloadMe, reloadCatalogue } = useSession();

const people = useResource(() => api<PeopleResponse>("/api/console/people"));
const assignments = useResource(() => api<AssignmentsResponse>("/api/console/assignments"));
const departments = useResource(() => api<{ departments: Department[] }>("/api/console/departments"));

const canManageAll = computed(() => can("roles.manage"));
const canManageDepartments = computed(() => me.value?.github_role === "admin");
const canAppoint = computed(() => Boolean(me.value && canAppointCaptain(me.value)));
const label = (id: Parameters<typeof titleLabel>[0]) => titleLabel(id, catalogue.value);
const depts = computed(() => departments.data.value?.departments ?? []);
const sorted = computed(() => sortPeople(people.data.value?.people ?? [], depts.value, catalogue.value));
const groups = computed(() => peopleGroups(sorted.value, depts.value));

/** 分区和名单分组都记在地址里；权限树只读，「称号」仍只给能管理称号的人。 */
type Section = "people" | "titles" | "departments" | "permissions";
const section = computed<Section>(() => {
  const view = route.query.view;
  if (view === "titles" && canManageAll.value) return "titles";
  return view === "departments" || view === "permissions" ? view : "people";
});
watch(section, next => {
  // 首次挂载已有部门请求；从其它页签返回时重新取包，不能把旧配置称作当前来源。
  if (next === "permissions") void departments.reload();
});
/** 左侧选中的分组（全部成员 / 某个部门 / 没有部门），记在 ?group= 里。 */
const group = computed(() => {
  const raw = route.query.group;
  return typeof raw === "string" && groups.value.some(item => item.key === raw) ? raw : GROUP_ALL;
});
const current = computed(() => groups.value.find(item => item.key === group.value) ?? groups.value[0]);
const setView = (view: string) => void router.push({ query: { ...route.query, view: view === "titles" || view === "departments" || view === "permissions" ? view : undefined } });
const setGroup = (value: string) => void router.replace({ query: { ...route.query, group: value === GROUP_ALL ? undefined : value } });

const SECTION_LABEL: Record<Section, string> = { people: "成员", titles: "称号", departments: "部门", permissions: "权限树" };

/** 名单每一行：一个人的全部称号；指派来的称号带上指派人、时间、备注，以及当前查看者能不能撤销。 */
type TitleLine = { key: string; title: TitleView; assignment: Assignment | null; revocable: boolean };
type PersonRow = Person & { departmentNames: string[]; lines: TitleLine[] };
const byAssignment = computed(() => new Map((assignments.data.value?.assignments ?? []).map(row => [row.id, row])));
const rows = computed<PersonRow[]>(() => peopleInGroup(sorted.value, group.value, depts.value).map(person => ({
  ...person,
  departmentNames: [...new Set(person.titles.map(title => title.department?.name).filter((name): name is string => Boolean(name)))],
  lines: person.titles.map((title, index) => {
    const assignment = title.assignment_id !== null ? byAssignment.value.get(title.assignment_id) ?? null : null;
    return {
      key: `${title.id}-${title.assignment_id ?? `${title.source}-${index}`}`,
      title,
      assignment,
      revocable: Boolean(me.value && assignment && mayRevoke(assignment, me.value, canManageAll.value)),
    };
  }),
})));

const columns = computed(() => [
  { key: "login", title: "成员", width: 190 },
  { key: "titles", title: "称号" },
  { key: "department", title: "部门", width: 130 },
  { key: "github", title: "GitHub 身份", width: 100 },
  { key: "actions", title: "操作", width: 108, align: "right" as const },
]);
const expandedPeople = ref<string[]>([]);
const sourcesVisible = (login: string) => expandedPeople.value.includes(login);
function toggleSources(login: string) {
  expandedPeople.value = sourcesVisible(login)
    ? expandedPeople.value.filter(item => item !== login)
    : [...expandedPeople.value, login];
}

const noCaptain = computed(() => assignments.data.value !== undefined && assignments.data.value.captain === null);

const adding = ref(false);
const addingLogin = ref<string | null>(null);
function openAssign(login: string | null) {
  addingLogin.value = login;
  adding.value = true;
}
const editing = ref<Department | null>(null);
const editOpen = computed({ get: () => editing.value !== null, set: value => { if (!value) editing.value = null; } });

async function refreshAll() {
  await Promise.all([people.reload(), assignments.reload(), departments.reload(), reloadMe()]);
}
/** 改了称号的名字或权限：catalogue、自己的身份和名单都要重新读，所有徽章才会跟着变。 */
async function refreshTitles() {
  await Promise.all([reloadCatalogue(), reloadMe(), people.reload(), assignments.reload()]);
}

const revoke = useAction(async (row: Assignment, own: boolean) => {
  await api(`/api/console/assignments/${row.id}`, { method: "DELETE" });
  toast({ title: own ? `已卸任${label("captain")}` : "已撤销称号", description: `@${row.github_login}`, variant: "success" });
  await refreshAll();
});

async function askRevoke(line: TitleLine) {
  const row = line.assignment!;
  const own = Boolean(me.value && isOwnCaptainRow(row, me.value));
  const next = `卸任后由${label("admin")}指定下一任${label("captain")}。`;
  const ok = await confirm(row.role !== "captain"
    ? { title: `撤销 @${row.github_login} 的「${line.title.label}」？`, body: "对方会立刻失去这个称号带来的权限。", confirmText: "撤销", danger: true }
    : own
      ? { title: `卸任${label("captain")}？`, body: next, confirmText: "卸任", danger: true }
      : { title: `撤下 @${row.github_login} 的${label("captain")}？`, body: `对方会立刻失去这个称号带来的权限。${next}`, confirmText: "撤下", danger: true });
  if (ok) await revoke.execute(row, own);
}
const revokeText = (line: TitleLine) => (me.value && line.assignment && isOwnCaptainRow(line.assignment, me.value) ? "卸任" : "撤销");

/** 称号的来历：指派来的写指派人和日期，GitHub 自动给的写组织身份。 */
function origin(line: TitleLine, person: Person): string {
  if (line.assignment) return `@${line.assignment.granted_by} 指派 · ${fmtDay(line.assignment.created_at)}`;
  if (line.title.source === "github") return `GitHub 组织${githubRoleText(person.github_role)}，自动获得`;
  return "";
}

const removeDept = useAction(async (dept: Department) => {
  const result = await api<{ ok: true; removed: number }>(`/api/console/departments/${encodeURIComponent(dept.id)}`, { method: "DELETE" });
  toast({ title: `已删除${dept.name}`, description: result.removed ? `一起撤掉了 ${result.removed} 个部门称号` : undefined, variant: "success" });
  if (group.value === dept.id) setGroup(GROUP_ALL);
  await refreshAll();
});

async function askDelete(dept: Department) {
  const body = dept.heads.length + dept.crew_count
    ? `部门里还有 ${dept.heads.length} 位${label("head")}、${dept.crew_count} 位${label("member")}。删除后他们在这个部门的称号一起撤掉，别的称号不受影响。删除后不能恢复。`
    : "这个部门没有人。删除后不能恢复。";
  if (await confirm({ title: `删除「${dept.name}」？`, body, confirmText: "删除部门", danger: true })) await removeDept.execute(dept);
}

const headOfNames = computed(() => (me.value?.head_of ?? []).map(id => depts.value.find(d => d.id === id)?.name).filter(Boolean).join("、"));
const description = computed(() => {
  if (section.value === "permissions") return "查看当前权限、授予来源及适用范围。";
  if (section.value === "titles") return "查看称号及其基础权限。";
  if (section.value === "departments") return "查看部门成员与权限配置。";
  return canManageAll.value ? "按部门查看成员与称号。" : `你负责${headOfNames.value || "本部门"}，可以任免本部门的${label("member")}。`;
});

function emptyText(key: string) {
  if (key === GROUP_ALL) return { title: "名单是空的", description: "GitHub 组织里还没有成员。" };
  if (key === GROUP_NONE) return { title: "每个人都在部门里", description: "" };
  return { title: "这个部门还没有人", description: `用右上角的「添加称号」指派${label("head")}或${label("member")}。` };
}

/** 右侧顶部像飞书的部门卡片：全班写管理的人，部门写负责人和上级。 */
const admins = computed(() => holdersOf(sorted.value, "admin"));
const captains = computed(() => holdersOf(sorted.value, "captain"));
const leads = computed(() => (current.value.department ? leadsOf(sorted.value, current.value.department.id) : []));
/** 部门负责人的上级：舰长这一级；没有舰长时是管理全班的最高称号。 */
const superiors = computed(() => (captains.value.length
  ? { label: label("captain"), people: captains.value }
  : { label: label("admin"), people: admins.value }));

const bundleLabels = (ids: string[]) => ids.map(capabilityLabel);
const orderedDepts = computed(() => [...depts.value].sort((a, b) =>
  Number(me.value?.head_of.includes(b.id)) - Number(me.value?.head_of.includes(a.id)) || Number(a.archived) - Number(b.archived) || a.sort_order - b.sort_order));
const sections = computed<Section[]>(() => (canManageAll.value ? ["people", "titles", "departments", "permissions"] : ["people", "departments", "permissions"]));
</script>

<template>
  <div class="page">
    <PageHeader title="成员与权限" :description="description">
      <template v-if="section === 'people'" #actions>
        <TxButton variant="primary" icon="i-carbon-add" @click="openAssign(null)">添加称号</TxButton>
      </template>
    </PageHeader>

    <p v-if="section !== 'permissions' && noCaptain && canAppoint" class="page-note">现在没有{{ label("captain") }}，可以用「添加称号」指定一位。</p>
    <ErrorAlert v-if="revoke.error.value" :error="revoke.error.value" @close="revoke.reset()" />
    <ErrorAlert v-if="removeDept.error.value" :error="removeDept.error.value" @close="removeDept.reset()" />

    <ErrorPanel v-if="section !== 'permissions' && departments.error.value" :error="departments.error.value" :retry="departments.reload" />
    <LoadingBlock v-else-if="section !== 'permissions' && !departments.data.value" :lines="8" />
    <TxCard v-else :padding="0" class="people-card">
      <TxTabs :model-value="section" placement="top" indicator-variant="line" borderless :content-scrollable="false" :content-padding="0" @update:model-value="setView">
        <TxTabItem v-for="id in sections" :key="id" :name="id">
          <template #name>{{ SECTION_LABEL[id] }}</template>

          <template v-if="id === 'people'">
            <ErrorPanel v-if="people.error.value" :error="people.error.value" :retry="people.reload" />
            <ErrorPanel v-else-if="assignments.error.value" :error="assignments.error.value" :retry="assignments.reload" />
            <LoadingBlock v-else-if="!people.data.value || !assignments.data.value" :lines="8" />
            <div v-else class="people-groups">
              <nav class="group-list" aria-label="按部门查看">
                <p class="group-list__heading">成员分组</p>
                <TxCardItem
                  v-for="item in groups"
                  :key="item.key"
                  clickable
                  role="button"
                  :active="item.key === group"
                  :aria-current="item.key === group ? 'true' : undefined"
                  :title="item.label"
                  :icon-class="item.department ? carbon(item.department.icon) : item.key === GROUP_ALL ? 'i-carbon-user-multiple' : 'i-carbon-user'"
                  :avatar-size="28"
                  avatar-shape="rounded"
                  class="group-item"
                  @click="setGroup(item.key)"
                >
                  <template #right><span class="group-count">{{ item.count }}</span></template>
                </TxCardItem>
              </nav>
              <section class="group-panel" :aria-label="current.label">
                  <header class="group-head">
                      <template v-if="current.department">
                        <span class="dept__icon" :style="{ color: toneColor(current.department.tone, catalogue), background: `color-mix(in srgb, ${toneColor(current.department.tone, catalogue)} 10%, white)` }">
                          <i :class="carbon(current.department.icon)" aria-hidden="true" />
                        </span>
                        <div class="group-head__body">
                          <h3>{{ current.department.name }}</h3>
                          <p v-if="current.department.description" class="muted">{{ current.department.description }}</p>
                          <dl class="group-head__facts">
                            <div>
                              <dt>{{ label("head") }}</dt>
                              <dd>
                                <template v-if="leads.length"><UserCell v-for="lead in leads" :key="lead.login" :login="lead.login" :src="lead.avatar_url" link /></template>
                                <span v-else class="muted">空缺</span>
                              </dd>
                            </div>
                            <div>
                              <dt>上级</dt>
                              <dd>
                                <span class="muted">{{ superiors.label }}</span>
                                <template v-if="superiors.people.length"><UserCell v-for="boss in superiors.people" :key="boss.login" :login="boss.login" :src="boss.avatar_url" link /></template>
                                <span v-else class="muted">还没有指定</span>
                              </dd>
                            </div>
                            <div>
                              <dt>人数</dt>
                              <dd>{{ current.count }} 人</dd>
                            </div>
                          </dl>
                        </div>
                      </template>
                      <template v-else-if="current.key === GROUP_ALL">
                        <span class="dept__icon group-head__org"><i class="i-carbon-user-multiple" aria-hidden="true" /></span>
                        <div class="group-head__body">
                          <h3>全班</h3>
                          <p class="muted">GitHub 组织里的每个人，加上有称号但已经退出组织的人。</p>
                          <dl class="group-head__facts">
                            <div>
                              <dt>{{ label("admin") }}</dt>
                              <dd>
                                <template v-if="admins.length"><UserCell v-for="boss in admins" :key="boss.login" :login="boss.login" :src="boss.avatar_url" link /></template>
                                <span v-else class="muted">GitHub 组织的所有者自动成为{{ label("admin") }}</span>
                              </dd>
                            </div>
                            <div>
                              <dt>{{ label("captain") }}</dt>
                              <dd>
                                <template v-if="captains.length"><UserCell v-for="boss in captains" :key="boss.login" :login="boss.login" :src="boss.avatar_url" link /></template>
                                <span v-else class="muted">还没有指定</span>
                              </dd>
                            </div>
                            <div>
                              <dt>部门</dt>
                              <dd>{{ groups.length - 2 }} 个</dd>
                            </div>
                          </dl>
                        </div>
                      </template>
                      <template v-else>
                        <span class="dept__icon group-head__org"><i class="i-carbon-user" aria-hidden="true" /></span>
                        <div class="group-head__body">
                          <h3>没有部门</h3>
                          <p class="muted">还没加入任何部门的人。用「添加称号」把他们指派到部门。</p>
                        </div>
                      </template>
                    </header>

                    <div class="people-table-scroll" tabindex="0" aria-label="成员名单，可滚动">
                    <TxDataTable style="--table-min: 780px" :columns="columns" :data="rows" row-key="login" table-layout="fixed" scroll-x class="people-table">
                      <template #cell-login="{ row }: { row: PersonRow }">
                        <UserCell :login="row.login" :src="row.avatar_url" link />
                      </template>
                      <template #cell-titles="{ row }: { row: PersonRow }">
                        <ul class="title-lines" :class="{ 'title-lines--expanded': sourcesVisible(row.login) }">
                          <li v-for="line in row.lines" :key="line.key" class="title-line">
                            <span class="cell-stack title-line__main">
                              <TitleBadge :title="line.title" />
                              <template v-if="sourcesVisible(row.login)">
                                <span v-if="origin(line, row)" class="cell-sub" :title="line.assignment ? fmtDate(line.assignment.created_at) : undefined">{{ origin(line, row) }}</span>
                                <span v-if="line.assignment?.note" class="cell-sub clamp-2" :title="line.assignment.note">{{ line.assignment.note }}</span>
                              </template>
                            </span>
                            <TxButton
                              v-if="line.revocable && sourcesVisible(row.login)"
                              variant="ghost"
                              size="sm"
                              class="danger-text"
                              :aria-label="`${revokeText(line)} @${row.login} 的「${line.title.label}」`"
                              :disabled="revoke.pending.value"
                              @click="askRevoke(line)"
                            >
                              {{ revokeText(line) }}
                            </TxButton>
                          </li>
                        </ul>
                        <TxButton v-if="row.lines.some(line => origin(line, row) || line.assignment?.note || line.revocable)" variant="bare" size="sm" :aria-expanded="sourcesVisible(row.login)" :aria-label="`${sourcesVisible(row.login) ? '收起' : '查看'} @${row.login} 的称号详情`" class="source-toggle" @click="toggleSources(row.login)">
                          {{ sourcesVisible(row.login) ? "收起详情" : "称号详情" }}
                        </TxButton>
                      </template>
                      <template #cell-department="{ row }: { row: PersonRow }">
                        <span v-if="row.departmentNames.length">{{ row.departmentNames.join("、") }}</span>
                        <span v-else class="muted">不属于部门</span>
                      </template>
                      <template #cell-github="{ row }: { row: PersonRow }">
                        <span :class="{ muted: row.github_role === null }">{{ githubRoleText(row.github_role) }}</span>
                      </template>
                      <template #cell-actions="{ row }: { row: PersonRow }">
                        <TxButton variant="ghost" size="sm" icon="i-carbon-add" :aria-label="`给 @${row.login} 添加称号`" @click="openAssign(row.login)">添加称号</TxButton>
                      </template>
                      <template #empty>
                        <TxEmptyState :title="emptyText(current.key).title" :description="emptyText(current.key).description" size="small" />
                      </template>
                    </TxDataTable>
                    </div>
              </section>
            </div>
          </template>

          <template v-else-if="id === 'titles'">
            <TitleList v-if="catalogue" :catalogue="catalogue" :admiral="Boolean(me?.titles.some(title => title.id === 'admin'))" @changed="refreshTitles" />
            <TxEmptyState
              v-else-if="catalogueFailed"
              title="没有读到称号设置"
              description="网络恢复后再试一次。"
              size="small"
              :primary-action="{ label: '重试', variant: 'secondary' }"
              @primary="reloadCatalogue()"
            />
            <LoadingBlock v-else :lines="6" />
          </template>

          <template v-else-if="id === 'permissions'">
            <PermissionTree v-if="section === 'permissions'" :departments="departments" />
          </template>

          <div v-else class="dept-list">
            <div class="dept-list__heading"><h2>部门</h2><span>{{ orderedDepts.length }} 个</span></div>
            <TxEmptyState v-if="!orderedDepts.length" title="还没有部门" description="部门建立后会显示在这里。" size="small" />
            <article v-for="dept in orderedDepts" :key="dept.id" class="dept" :class="{ 'dept--archived': dept.archived }">
              <div class="dept__head">
                <span class="dept__icon" :style="{ color: toneColor(dept.tone, catalogue), background: `color-mix(in srgb, ${toneColor(dept.tone, catalogue)} 10%, white)` }">
                  <i :class="carbon(dept.icon)" aria-hidden="true" />
                </span>
                <div class="dept__title">
                  <h3>
                    {{ dept.name }}
                    <TxTag v-if="me?.head_of.includes(dept.id)" label="你负责" size="sm" variant="soft" />
                    <TxTag v-if="dept.archived" label="已归档" size="sm" variant="plain" />
                  </h3>
                  <p class="muted">{{ dept.description || "没有填写说明" }}</p>
                  <p class="dept__people">
                    {{ label("head") }}
                    <span class="mono">{{ dept.heads.length ? dept.heads.map(h => `@${h}`).join("、") : "空缺" }}</span>
                    <span class="muted">·</span>
                    {{ label("member") }} {{ dept.crew_count }} 人
                  </p>
                </div>
                <div v-if="canManageDepartments" class="dept__actions">
                  <TxButton size="sm" icon="i-carbon-edit" @click="editing = dept">编辑权限</TxButton>
                  <TxButton size="sm" variant="ghost" icon="i-carbon-trash-can" class="danger-text" :disabled="removeDept.pending.value" @click="askDelete(dept)">删除部门</TxButton>
                </div>
              </div>
              <div class="dept__bundles">
                <div>
                  <h4>{{ label("head") }}额外权限</h4>
                  <div class="tags">
                    <TxTag v-for="item in bundleLabels(dept.head_capabilities)" :key="item" :label="item" size="sm" variant="plain" />
                    <span v-if="!dept.head_capabilities.length" class="muted">无</span>
                  </div>
                </div>
                <div>
                  <h4>{{ label("member") }}权限</h4>
                  <div class="tags">
                    <TxTag v-for="item in bundleLabels(dept.member_capabilities)" :key="item" :label="item" size="sm" variant="plain" />
                    <span v-if="!dept.member_capabilities.length" class="muted">无</span>
                  </div>
                </div>
              </div>
            </article>
          </div>
        </TxTabItem>
      </TxTabs>
    </TxCard>

    <AssignDialog
      v-model:open="adding"
      :departments="depts"
      :scope="canManageAll ? 'all' : (me?.head_of ?? [])"
      :can-assign-captain="canAppoint"
      :captain="assignments.data.value?.captain?.github_login ?? null"
      :initial-login="addingLogin"
      @done="refreshAll"
    />
    <BundleDialog v-if="catalogue && canManageDepartments" v-model:open="editOpen" :department="editing" :catalogue="catalogue" @done="refreshAll" />
  </div>
</template>

<style scoped>
.page-note {
  margin: 0;
  font-size: 13px;
  color: var(--tx-text-color-secondary);
}
.people-card :deep(.tx-tabs__nav) {
  border-bottom: 1px solid var(--tx-border-color-lighter);
  padding: 0 16px;
}
.people-card :deep(.tx-tabs__nav-item) {
  min-height: 52px;
}
.people-groups {
  display: grid;
  grid-template-columns: 280px minmax(0, 1fr);
  height: min(720px, 78dvh);
  min-height: 480px;
}
.group-list {
  display: flex;
  flex-direction: column;
  gap: 8px;
  min-width: 0;
  min-height: 0;
  padding: 24px 16px;
  overflow-y: auto;
  border-right: 1px solid var(--tx-border-color-lighter);
  background: var(--tx-fill-color-light);
}
.group-list__heading {
  margin: 0 12px 12px;
  font-size: 13px;
  font-weight: 600;
  color: var(--tx-text-color-secondary);
}
.group-item {
  --tx-card-item-padding: 12px 14px;
  flex: 0 0 auto;
  min-width: 0;
  border-radius: 10px;
}
.group-item[aria-current="true"] {
  background: color-mix(in srgb, var(--tx-color-primary) 9%, white);
}
.group-count {
  font-size: 12px;
  font-variant-numeric: tabular-nums;
  color: var(--tx-text-color-secondary);
}
.group-panel {
  display: flex;
  flex-direction: column;
  min-width: 0;
  min-height: 0;
  overflow: hidden;
}
.people-table-scroll {
  flex: 1 1 auto;
  min-height: 0;
  overflow-y: auto;
  overscroll-behavior: contain;
}
@media (max-width: 900px) {
  .people-groups {
    grid-template-columns: minmax(0, 1fr);
    grid-template-rows: auto minmax(0, 1fr);
  }
  .group-list {
    flex-direction: row;
    overflow-x: auto;
    overflow-y: hidden;
    gap: 8px;
    padding: 10px 12px;
    border-right: 0;
    border-bottom: 1px solid var(--tx-border-color-lighter);
  }
  .group-list__heading {
    position: absolute;
    width: 1px;
    height: 1px;
    overflow: hidden;
    clip-path: inset(50%);
  }
  .group-item {
    --tx-card-item-padding: 8px 12px;
    flex: 0 0 auto;
    width: max-content;
  }
}
.group-head {
  display: flex;
  flex: 0 0 auto;
  align-items: flex-start;
  gap: 14px;
  padding: 22px 24px;
}
.group-head__org {
  color: var(--tx-color-primary);
  background: color-mix(in srgb, var(--tx-color-primary) 10%, white);
}
.group-head__body {
  flex: 1 1 auto;
  min-width: 0;
}
.group-head__body h3 {
  margin: 0;
  font-size: 19px;
  font-weight: 650;
}
.group-head__body > p {
  margin: 5px 0 0;
  font-size: 13px;
}
.group-head__facts {
  display: flex;
  flex-wrap: wrap;
  gap: 10px 24px;
  margin: 18px 0 0;
}
.group-head__facts div {
  display: flex;
  align-items: center;
  gap: 8px;
  min-width: 0;
}
.group-head__facts dt {
  font-size: 12px;
  color: var(--tx-text-color-secondary);
}
.group-head__facts dd {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 6px 12px;
  margin: 0;
  font-size: 13px;
}
.tab-label {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  white-space: nowrap;
}
.people-table {
  border-top: 1px solid var(--tx-border-color-lighter);
}
.title-lines {
  display: flex;
  flex-wrap: wrap;
  gap: 6px 12px;
  margin: 0;
  padding: 0;
  list-style: none;
}
.title-line {
  display: flex;
  align-items: flex-start;
  gap: 4px;
}
.title-line__main {
  flex: 1 1 auto;
}
.title-lines--expanded {
  flex-direction: column;
  gap: 12px;
}
.title-lines--expanded .title-line {
  justify-content: space-between;
}
.source-toggle {
  margin-top: 4px;
  font-size: 12px;
}
.danger-text {
  color: var(--tx-color-danger);
}
.dept-list {
  display: flex;
  flex-direction: column;
}
.dept-list__heading {
  display: flex;
  align-items: baseline;
  gap: 12px;
  padding: 20px 24px 14px;
  border-bottom: 1px solid var(--tx-border-color-lighter);
}
.dept-list__heading h2 { margin: 0; font-size: 18px; font-weight: 650; }
.dept-list__heading span { font-size: 13px; color: var(--tx-text-color-secondary); }
.dept {
  padding: 22px 24px;
  border-bottom: 1px solid var(--tx-border-color-lighter);
}
.dept:last-child {
  border-bottom: 0;
}
.dept--archived {
  opacity: 0.65;
}
.dept__head {
  display: flex;
  flex-wrap: wrap;
  align-items: flex-start;
  gap: 14px;
}
.dept__icon {
  display: grid;
  place-items: center;
  flex: 0 0 auto;
  width: 36px;
  height: 36px;
  border-radius: 10px;
  font-size: 18px;
}
.dept__actions {
  display: flex;
  flex-wrap: wrap;
  gap: 4px;
}
.dept__title {
  flex: 1 1 260px;
  min-width: 0;
}
.dept__title h3 {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 8px;
  margin: 0;
  font-size: 17px;
  font-weight: 650;
}
.dept__title p {
  margin: 5px 0 0;
  font-size: 13px;
}
.dept__people {
  color: var(--tx-text-color-regular);
}
.dept__bundles {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 20px;
  margin-top: 20px;
  padding: 18px 0 0 50px;
  border-top: 1px solid var(--tx-border-color-lighter);
}
.dept__bundles h4 {
  margin: 0 0 10px;
  font-size: 13px;
  font-weight: 600;
  color: var(--tx-text-color-secondary);
}
@media (max-width: 900px) {
  .dept__bundles {
    grid-template-columns: minmax(0, 1fr);
    padding-left: 0;
  }
  .dept__actions {
    grid-column: 2;
  }
  .dept__head {
    display: grid;
    grid-template-columns: 36px minmax(0, 1fr);
  }
  .dept__title {
    grid-column: 2;
  }
}
</style>

<script setup lang="ts">
import { computed, ref } from "vue";
import { useRoute, useRouter } from "vue-router";
import { TxCard } from "@talex-touch/tuffex/card";
import { TxTabs, TxTabItem } from "@talex-touch/tuffex/tabs";
import { TxDataTable } from "@talex-touch/tuffex/data-table";
import { TxButton } from "@talex-touch/tuffex/button";
import { TxBadge } from "@talex-touch/tuffex/badge";
import { TxAlert } from "@talex-touch/tuffex/alert";
import { TxEmptyState } from "@talex-touch/tuffex/empty-state";
import { TxTag } from "@talex-touch/tuffex/tag";
import { toast } from "@talex-touch/tuffex/utils";
import PageHeader from "../components/PageHeader.vue";
import UserCell from "../components/UserCell.vue";
import ErrorPanel from "../components/ErrorPanel.vue";
import ErrorAlert from "../components/ErrorAlert.vue";
import LoadingBlock from "../components/LoadingBlock.vue";
import KindTag from "./people/KindTag.vue";
import AssignDialog from "./people/AssignDialog.vue";
import BundleDialog from "./people/BundleDialog.vue";
import { api } from "../lib/http";
import { confirm } from "../lib/confirm";
import { fmtDate, fmtDay } from "../lib/format";
import { carbon } from "../lib/icons";
import { PEOPLE_TABS, isPeopleTab, mayRevoke, rowsForTab, sortAssignments, tabCounts, visibleTabs, type PeopleTab } from "../lib/people";
import { useAction, useResource } from "../lib/resource";
import { useSession } from "../lib/session";
import { toneColor } from "../lib/titles";
import type { Assignment, AssignmentsResponse, Department } from "../lib/types";

const route = useRoute();
const router = useRouter();
const { me, catalogue, can, capabilityLabel, reload: reloadMe } = useSession();

const assignments = useResource(() => api<AssignmentsResponse>("/api/console/assignments"));
const departments = useResource(() => api<{ departments: Department[] }>("/api/console/departments"));

const canManageAll = computed(() => can("roles.manage"));
const isCaptain = computed(() => Boolean(me.value?.titles.some(title => title.id === "captain")));
const depts = computed(() => departments.data.value?.departments ?? []);
const sorted = computed(() => sortAssignments(assignments.data.value?.assignments ?? [], depts.value, catalogue.value));
const counts = computed(() => tabCounts(sorted.value));
const tabs = computed(() => {
  const ids = visibleTabs(sorted.value, canManageAll.value);
  return PEOPLE_TABS.filter(tab => ids.includes(tab.id));
});

/** 顶层分区（成员 / 部门与权限包）与名单页签都记在地址里，刷新后停在原处。 */
const section = computed(() => (route.query.view === "departments" ? "departments" : "people"));
const tab = computed<PeopleTab>(() => (isPeopleTab(route.query.tab) && tabs.value.some(t => t.id === route.query.tab) ? route.query.tab : "all"));
const setView = (view: string) => void router.replace({ query: { ...route.query, view: view === "departments" ? "departments" : undefined } });
const setTab = (value: string) => void router.replace({ query: { ...route.query, tab: value === "all" ? undefined : value } });
const SECTION_LABEL = { people: "成员", departments: "部门与权限包" } as const;

const rows = computed(() => rowsForTab(sorted.value, tab.value));
const deptName = (id: string) => depts.value.find(d => d.id === id)?.name ?? "";

const columns = computed(() => [
  { key: "login", title: "成员", width: 170 },
  { key: "title", title: "称号", width: 120 },
  { key: "department", title: "部门", width: 96 },
  { key: "note", title: "备注" },
  { key: "granted", title: "指派人 · 时间", width: 150 },
  { key: "actions", title: "操作", width: 96, align: "right" as const },
]);

const adding = ref(false);
const editing = ref<Department | null>(null);
const editOpen = computed({ get: () => editing.value !== null, set: value => { if (!value) editing.value = null; } });

async function refreshAll() {
  await Promise.all([assignments.reload(), departments.reload(), reloadMe()]);
}

const revoke = useAction(async (row: Assignment) => {
  await api(`/api/console/assignments/${row.id}`, { method: "DELETE" });
  toast({ title: row.role === "captain" ? "已卸任舰长" : "已撤销称号", description: `@${row.github_login}`, variant: "success" });
  await refreshAll();
});

async function askRevoke(row: Assignment) {
  const captainRow = row.role === "captain";
  const ok = await confirm(captainRow
    ? { title: "卸任舰长？", body: "卸任后没有正式舰长，由 GitHub 组织管理员临时代任，直到指定下一任。", confirmText: "卸任", danger: true }
    : { title: `撤销 @${row.github_login} 的称号？`, body: "对方会立刻失去这个称号带来的权限。", confirmText: "撤销", danger: true });
  if (ok) await revoke.execute(row);
}

const headOfNames = computed(() => (me.value?.head_of ?? []).map(deptName).filter(Boolean).join("、"));
const description = computed(() => canManageAll.value
  ? "给成员指派称号，维护每个部门的权限包。GitHub 类权限始终受对方自己的组织角色限制。"
  : `你负责${headOfNames.value || "本部门"}，可以任免本部门舰员。`);

const bundleLabels = (ids: string[]) => ids.map(capabilityLabel);
const orderedDepts = computed(() => [...depts.value].sort((a, b) =>
  Number(me.value?.head_of.includes(b.id)) - Number(me.value?.head_of.includes(a.id)) || Number(a.archived) - Number(b.archived) || a.sort_order - b.sort_order));
</script>

<template>
  <div class="page">
    <PageHeader title="成员与权限" :description="description">
      <template #actions>
        <TxButton variant="primary" icon="i-carbon-add" @click="adding = true">添加称号</TxButton>
      </template>
    </PageHeader>

    <TxAlert v-if="assignments.data.value?.bootstrap_active" type="warning" title="还没有正式舰长" :closable="false">
      现在由 GitHub 组织管理员临时代任。{{ isCaptain ? "用「添加称号」选择「舰长」来指定正式舰长。" : "请联系组织管理员指定正式舰长。" }}
    </TxAlert>
    <ErrorAlert v-if="revoke.error.value" :error="revoke.error.value" @close="revoke.reset()" />

    <ErrorPanel v-if="assignments.error.value" :error="assignments.error.value" :retry="assignments.reload" />
    <LoadingBlock v-else-if="!assignments.data.value || !departments.data.value" :lines="8" />
    <TxCard v-else :padding="0" class="people-card">
      <TxTabs :model-value="section" placement="top" indicator-variant="line" borderless :content-scrollable="false" :content-padding="0" @update:model-value="setView">
        <TxTabItem name="people" icon-class="i-carbon-user-multiple">
          <template #name>{{ SECTION_LABEL.people }}</template>

          <div class="people-tabs">
            <TxTabs :model-value="tab" placement="top" indicator-variant="pill" borderless :content-scrollable="false" :content-padding="0" @update:model-value="setTab">
              <TxTabItem v-for="item in tabs" :key="item.id" :name="item.id">
                <template #name>
                  <span class="tab-label">{{ item.label }} <TxBadge :value="counts[item.id]" /></span>
                </template>

                <TxDataTable style="--table-min: 690px" :columns="columns" :data="rows" row-key="id" table-layout="fixed" scroll-x class="people-table">
                  <template #cell-login="{ row }: { row: Assignment }">
                    <UserCell :login="row.github_login" link />
                  </template>
                  <template #cell-title="{ row }: { row: Assignment }">
                    <KindTag :row="row" :departments="depts" />
                  </template>
                  <template #cell-department="{ row }: { row: Assignment }">
                    <span v-if="row.department_id">{{ deptName(row.department_id) || row.department_id }}</span>
                    <span v-else class="muted">不属于部门</span>
                  </template>
                  <template #cell-note="{ row }: { row: Assignment }">
                    <span v-if="row.note" class="clamp-2" :title="row.note">{{ row.note }}</span>
                    <span v-else class="muted">无</span>
                  </template>
                  <template #cell-granted="{ row }: { row: Assignment }">
                    <span class="granted" :title="fmtDate(row.created_at)">
                      <span class="mono">@{{ row.granted_by }}</span>
                      <span class="muted">{{ fmtDay(row.created_at) }}</span>
                    </span>
                  </template>
                  <template #cell-actions="{ row }: { row: Assignment }">
                    <TxButton v-if="me && mayRevoke(row, me, canManageAll)" variant="ghost" size="sm" class="danger-text" :disabled="revoke.pending.value" @click="askRevoke(row)">
                      {{ row.role === "captain" ? "卸任" : "撤销" }}
                    </TxButton>
                  </template>
                  <template #empty>
                    <TxEmptyState
                      :title="`还没有${item.id === 'all' ? '指派任何称号' : PEOPLE_TABS.find(t => t.id === item.id)!.label}`"
                      description="用右上角的「添加称号」指派。"
                      size="small"
                    />
                  </template>
                </TxDataTable>
              </TxTabItem>
            </TxTabs>
          </div>
        </TxTabItem>

        <TxTabItem name="departments" icon-class="i-carbon-building">
          <template #name>{{ SECTION_LABEL.departments }}</template>

          <ErrorPanel v-if="departments.error.value" :error="departments.error.value" :retry="departments.reload" />
          <div v-else class="dept-list">
            <p class="dept-intro">部门的权限包决定队长和舰员在基础权限之外还能做什么。舰长可以修改；新增部门不需要改代码。</p>
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
                    队长
                    <span class="mono">{{ dept.heads.length ? dept.heads.map(h => `@${h}`).join("、") : "空缺" }}</span>
                    <span class="muted">·</span>
                    舰员 {{ dept.crew_count }} 人
                  </p>
                </div>
                <TxButton v-if="canManageAll" size="sm" icon="i-carbon-edit" @click="editing = dept">编辑权限包</TxButton>
              </div>
              <div class="dept__bundles">
                <div>
                  <h4>队长额外权限</h4>
                  <div class="tags">
                    <TxTag v-for="label in bundleLabels(dept.head_capabilities)" :key="label" :label="label" size="sm" variant="plain" />
                    <span v-if="!dept.head_capabilities.length" class="muted">无</span>
                  </div>
                </div>
                <div>
                  <h4>舰员权限</h4>
                  <div class="tags">
                    <TxTag v-for="label in bundleLabels(dept.member_capabilities)" :key="label" :label="label" size="sm" variant="plain" />
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
      :can-assign-captain="isCaptain"
      :captain="assignments.data.value?.captain?.github_login ?? null"
      @done="refreshAll"
    />
    <BundleDialog v-if="catalogue" v-model:open="editOpen" :department="editing" :catalogue="catalogue" @done="refreshAll" />
  </div>
</template>

<style scoped>
.people-card :deep(.tx-tabs__nav) {
  border-bottom: 1px solid var(--tx-border-color-lighter);
}
.people-tabs {
  padding: 8px 0 0;
}
.people-tabs :deep(.tx-tabs__nav) {
  border-bottom: 0;
  padding: 0 8px;
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
.granted {
  display: flex;
  flex-direction: column;
  gap: 1px;
  font-size: 13px;
}
.danger-text {
  color: var(--tx-color-danger);
}
.dept-list {
  display: flex;
  flex-direction: column;
}
.dept-intro {
  margin: 0;
  padding: 12px 20px;
  font-size: 13px;
  color: var(--tx-text-color-secondary);
  border-bottom: 1px solid var(--tx-border-color-lighter);
}
.dept {
  padding: 16px 20px;
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
  gap: 12px;
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
  font-size: 15px;
  font-weight: 600;
}
.dept__title p {
  margin: 2px 0 0;
  font-size: 13px;
}
.dept__people {
  color: var(--tx-text-color-regular);
}
.dept__bundles {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 12px 24px;
  margin-top: 12px;
  padding-left: 48px;
}
.dept__bundles h4 {
  margin: 0 0 6px;
  font-size: 12px;
  font-weight: 500;
  color: var(--tx-text-color-secondary);
}
@media (max-width: 900px) {
  .dept__bundles {
    grid-template-columns: minmax(0, 1fr);
    padding-left: 0;
  }
}
</style>

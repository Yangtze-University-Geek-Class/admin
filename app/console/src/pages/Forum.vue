<script setup lang="ts">
import { computed } from "vue";
import { TxCard } from "@talex-touch/tuffex/card";
import { TxAlert } from "@talex-touch/tuffex/alert";
import { TxButton } from "@talex-touch/tuffex/button";
import { TxDataTable } from "@talex-touch/tuffex/data-table";
import { TxStatusBadge } from "@talex-touch/tuffex/status-badge";
import PageHeader from "../components/PageHeader.vue";
import TitleBadge from "../components/TitleBadge.vue";
import ErrorPanel from "../components/ErrorPanel.vue";
import LoadingBlock from "../components/LoadingBlock.vue";
import { api } from "../lib/http";
import { FORUM_CAPABILITIES } from "../lib/nav";
import { useResource } from "../lib/resource";
import { siteUrl } from "../lib/runtime";
import { useSession } from "../lib/session";
import { closure, makeTitle, titleLabel } from "../lib/titles";
import type { Department, TitleId, TitleView } from "../lib/types";

/** 论坛类能力对应的论坛动作。论坛还没有服务端，这张表是给未来论坛接口的约定。 */
const FORUM_ACTIONS: Record<string, string> = {
  "forum.topic.pin": "置顶或取消置顶话题",
  "forum.topic.close": "关闭或重新打开话题",
  "forum.post.moderate": "编辑、删除别人的帖子，在已关闭的话题里回复",
  "forum.category.manage": "管理分类（论坛里暂时没有对应操作）",
  "forum.badge.assign": "授予论坛徽章（预留，暂无接口）",
};

const { me, catalogue, capabilityLabel } = useSession();
const departments = useResource(() => api<{ departments: Department[] }>("/api/console/departments"));

const mine = computed(() => FORUM_CAPABILITIES.map(id => ({ id, label: capabilityLabel(id), action: FORUM_ACTIONS[id], has: Boolean(me.value?.capabilities.includes(id)) })));

type MatrixRow = { key: string; title: TitleView; caps: string[] };
/**
 * 每个称号实际拿到的论坛权限：称号自己的权限包（catalogue.role_base，可在「称号」里改），
 * head 与带部门的 member 再加部门权限包；admin 永远是全部。
 */
const matrix = computed<MatrixRow[]>(() => {
  const cat = catalogue.value;
  const forum = (...bundles: string[][]) => {
    const held = closure(bundles.flat(), cat?.implies);
    return FORUM_CAPABILITIES.filter(id => held.has(id));
  };
  const base = (id: TitleId) => cat?.role_base[id] ?? [];
  const row = (id: TitleId): MatrixRow => ({ key: id, title: makeTitle(id, null, cat), caps: id === "admin" ? FORUM_CAPABILITIES : forum(base(id)) });
  const rows: MatrixRow[] = [row("admin"), row("captain")];
  for (const dept of (departments.data.value?.departments ?? []).filter(d => !d.archived)) {
    const view = { id: dept.id, name: dept.name, tag: dept.tag, icon: dept.icon, tone: dept.tone };
    rows.push({ key: `${dept.id}-head`, title: makeTitle("head", view, cat), caps: forum(base("head"), dept.head_capabilities) });
    rows.push({ key: `${dept.id}-crew`, title: makeTitle("member", view, cat), caps: forum(base("member"), dept.member_capabilities) });
  }
  rows.push(row("alumni"), row("member"));
  return rows;
});

const columns = computed(() => [
  { key: "title", title: "称号" },
  ...FORUM_CAPABILITIES.map(id => ({ key: id, title: capabilityLabel(id), width: 96, align: "center" as const })),
]);
const cellSlots = FORUM_CAPABILITIES;
const openForum = () => window.open(siteUrl("forum", "/"), "_blank", "noopener");
</script>

<template>
  <div class="page">
    <PageHeader title="论坛管理" description="称号会显示在论坛用户名旁边；部门权限包里的论坛权限决定谁能做版务。">
      <template #actions>
        <TxButton variant="primary" icon="i-carbon-launch" @click="openForum">打开论坛</TxButton>
      </template>
    </PageHeader>

    <TxAlert type="info" title="论坛还没有服务端" :closable="false">
      置顶、关闭、删帖目前只在论坛的前端演示里生效。这里的权限先作为以后论坛接口的约定。
    </TxAlert>

    <div class="grid-2">
      <TxCard>
        <template #header>
          <div class="card-head">
            <h2 class="section-title">你的论坛权限</h2>
            <span class="count">{{ mine.filter(item => item.has).length }} / {{ mine.length }}</span>
          </div>
        </template>
        <ul class="caps">
          <li v-for="item in mine" :key="item.id" class="caps__row">
            <TxStatusBadge :text="item.has ? '有' : '无'" :status="item.has ? 'success' : 'muted'" size="sm" />
            <span class="caps__text">
              <strong>{{ item.label }}</strong>
              <span class="muted">{{ item.action }}</span>
            </span>
          </li>
        </ul>
      </TxCard>

      <TxCard>
        <template #header>
          <div class="card-head"><h2 class="section-title">论坛里看到的称号</h2></div>
        </template>
        <div class="tags wall">
          <TitleBadge v-for="row in matrix" :key="row.key" :title="row.title" />
        </div>
        <p class="muted small">论坛和控制台用同一套称号、颜色和部门。</p>
      </TxCard>
    </div>

    <ErrorPanel v-if="departments.error.value" :error="departments.error.value" :retry="departments.reload" />
    <LoadingBlock v-else-if="!departments.data.value" :lines="6" />
    <TxCard v-else :padding="0">
      <template #header>
        <div class="card-head matrix-head">
          <h2 class="section-title">谁能做版务</h2>
          <span class="count">按部门权限包</span>
        </div>
      </template>
      <TxDataTable style="--table-min: 700px" :columns="columns" :data="matrix" row-key="key" scroll-x table-layout="fixed">
        <template #cell-title="{ row }: { row: MatrixRow }">
          <TitleBadge :title="row.title" />
        </template>
        <template v-for="id in cellSlots" :key="id" #[`cell-${id}`]="{ row }: { row: MatrixRow }">
          <i v-if="row.caps.includes(id)" class="i-carbon-checkmark cell-yes" role="img" aria-label="有" />
          <i v-else class="i-carbon-subtract cell-no" role="img" aria-label="无" />
        </template>
      </TxDataTable>
      <p class="muted small matrix-foot">要改谁能做版务，到「成员与权限」的「部门与权限包」或「称号」里修改。{{ titleLabel("admin", catalogue) }}永远拥有全部论坛权限。</p>
    </TxCard>
  </div>
</template>

<style scoped>
.caps {
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: 10px;
}
.caps__row {
  display: flex;
  align-items: flex-start;
  gap: 10px;
}
.caps__text {
  display: flex;
  flex-direction: column;
  gap: 2px;
  min-width: 0;
  font-size: 13px;
}
.caps__text strong {
  font-weight: 500;
  font-size: 14px;
}
.wall {
  gap: 8px;
}
.small {
  margin: 12px 0 0;
  font-size: 12px;
}
.matrix-head {
  padding: 4px 4px 0;
}
.matrix-foot {
  margin: 0;
  padding: 12px 16px;
  border-top: 1px solid var(--tx-border-color-lighter);
}
.cell-yes {
  font-size: 18px;
  color: var(--tx-color-primary);
}
.cell-no {
  font-size: 16px;
  color: var(--tx-text-color-disabled);
}
</style>

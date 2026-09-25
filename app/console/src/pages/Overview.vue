<script setup lang="ts">
import { computed } from "vue";
import { useRouter } from "vue-router";
import { TxCard } from "@talex-touch/tuffex/card";
import { TxStatCard } from "@talex-touch/tuffex/stat-card";
import { TxCardItem } from "@talex-touch/tuffex/card-item";
import { TxAvatar } from "@talex-touch/tuffex/avatar";
import { TxTag } from "@talex-touch/tuffex/tag";
import { TxButton } from "@talex-touch/tuffex/button";
import { TxEmptyState } from "@talex-touch/tuffex/empty-state";
import { TxSkeleton } from "@talex-touch/tuffex/skeleton";
import PageHeader from "../components/PageHeader.vue";
import TitleBadge from "../components/TitleBadge.vue";
import ErrorPanel from "../components/ErrorPanel.vue";
import { api } from "../lib/http";
import { fmtDate, fmtRelative } from "../lib/format";
import { BLOCK_REASON_TEXT } from "../lib/nav";
import { useResource } from "../lib/resource";
import { useSession } from "../lib/session";
import { assignerText } from "../lib/titles";
import type { AuditRow, Summary } from "../lib/types";

const router = useRouter();
const { me, catalogue, can } = useSession();
const summary = useResource(() => api<Summary>("/api/console/summary"));
const audit = useResource(() => api<{ logs: AuditRow[] }>("/api/console/audit?limit=6"), [], { enabled: () => can("audit.read") });

const roleText = computed(() => me.value?.github_role === "admin" ? "管理员" : me.value?.github_role === "member" ? "成员" : "未加入");
const held = computed(() => (me.value?.capabilities ?? []).filter(id => id !== "console.access"));

/** 按能力类别列出：我有的、被 GitHub 组织角色挡住的。没有任何能力的类别不列。 */
const domains = computed(() => {
  const cat = catalogue.value;
  if (!cat || !me.value) return [];
  return cat.domains.filter(domain => domain.id !== "console").map(domain => {
    const inDomain = cat.capabilities.filter(item => item.domain === domain.id);
    const granted = inDomain.filter(item => me.value!.capabilities.includes(item.id));
    const blocked = inDomain.filter(item => me.value!.blocked.some(b => b.capability === item.id));
    const reason = me.value!.blocked.find(b => blocked.some(item => item.id === b.capability))?.reason ?? null;
    return { ...domain, granted, blocked, reason };
  }).filter(domain => domain.granted.length + domain.blocked.length > 0);
});

type Stat = { label: string; value: number; meta: string; to: string; icon: string };
const stats = computed<Stat[]>(() => {
  const s = summary.data.value;
  if (!s) return [];
  const list: Stat[] = [];
  if (s.applications) {
    list.push({ label: "待处理投递", value: s.applications.by_status.received ?? 0, meta: `共 ${s.applications.total} 份，近 7 天 ${s.applications.last_7d} 份`, to: "/console/applications?status=received", icon: "i-carbon-document-attachment" });
    list.push({ label: "待面试", value: s.applications.by_status.interview ?? 0, meta: `已录取 ${s.applications.by_status.accepted ?? 0} 人`, to: "/console/applications?status=interview", icon: "i-carbon-time" });
  }
  if (s.feedback) list.push({ label: "待处理意见", value: s.feedback.open, meta: `共 ${s.feedback.total} 条`, to: "/console/feedback?status=open", icon: "i-carbon-chat" });
  if (s.people) list.push({ label: "称号指派", value: s.people.assignments, meta: `${s.people.departments} 个部门`, to: "/console/people", icon: "i-carbon-user-admin" });
  return list;
});
</script>

<template>
  <div v-if="me" class="page">
    <PageHeader title="概览" description="你的称号、能做的事，以及需要你处理的数量。" />

    <TxCard>
      <div class="identity">
        <TxAvatar :src="me.avatar_url ?? undefined" :name="me.login" :size="52" />
        <div class="identity__text">
          <span class="mono identity__login">@{{ me.login }}</span>
          <div class="tags">
            <TitleBadge v-for="title in me.titles" :key="`${title.id}-${title.assignment_id ?? title.source}`" :title="title" size="md" />
          </div>
        </div>
        <dl class="identity__facts">
          <div><dt>GitHub 组织</dt><dd class="mono ellipsis" :title="me.org">{{ me.org }}</dd></div>
          <div><dt>组织角色</dt><dd>{{ roleText }}</dd></div>
          <div><dt>权限</dt><dd>{{ held.length }} 项</dd></div>
        </dl>
      </div>
    </TxCard>

    <ErrorPanel v-if="summary.error.value" :error="summary.error.value" :retry="summary.reload" size="small" />
    <div v-else-if="summary.loading.value && !summary.data.value" class="grid-stats">
      <TxCard v-for="n in 3" :key="n"><TxSkeleton :loading="true" :lines="3" :height="14" /></TxCard>
    </div>
    <div v-else-if="stats.length" class="grid-stats">
      <TxStatCard
        v-for="stat in stats"
        :key="stat.label"
        :value="stat.value"
        :label="stat.label"
        :icon-class="stat.icon"
        clickable
        class="stat"
        role="link"
        tabindex="0"
        @click="router.push(stat.to)"
        @keydown.enter="router.push(stat.to)"
      >
        <template #label>
          <span class="stat__label">{{ stat.label }}</span>
          <span class="stat__meta">{{ stat.meta }}</span>
        </template>
      </TxStatCard>
    </div>

    <div class="grid-2">
      <TxCard>
        <template #header>
          <div class="card-head">
            <h2 class="section-title">你能做的事</h2>
            <span class="count">{{ held.length }} 项</span>
          </div>
        </template>
        <TxSkeleton v-if="!catalogue" :loading="true" :lines="4" />
        <div v-else class="domains">
          <section v-for="domain in domains" :key="domain.id" class="domain">
            <h3>{{ domain.label }}</h3>
            <div class="tags">
              <TxTag v-for="item in domain.granted" :key="item.id" :label="item.label" variant="soft" size="sm" />
              <TxTag v-for="item in domain.blocked" :key="item.id" :label="item.label" icon="i-carbon-locked" variant="plain" size="sm" />
            </div>
            <p v-if="domain.reason" class="domain__note">带锁的一项{{ BLOCK_REASON_TEXT[domain.reason] }}才能使用。</p>
          </section>
          <p class="domain__note">需要更多权限，请联系{{ assignerText(catalogue) }}指派称号。</p>
        </div>
      </TxCard>

      <TxCard v-if="can('audit.read')">
        <template #header>
          <div class="card-head">
            <h2 class="section-title">最近操作</h2>
            <div class="card-head__actions">
              <TxButton variant="ghost" size="sm" @click="router.push('/console/audit')">查看全部</TxButton>
            </div>
          </div>
        </template>
        <ErrorPanel v-if="audit.error.value" :error="audit.error.value" :retry="audit.reload" size="small" />
        <TxSkeleton v-else-if="!audit.data.value" :loading="true" :lines="5" />
        <TxEmptyState v-else-if="!audit.data.value.logs.length" title="还没有记录" description="控制台里的写操作会记在这里。" size="small" />
        <div v-else class="recent">
          <TxCardItem
            v-for="row in audit.data.value.logs"
            :key="row.id"
            :title="row.actor"
            :avatar-text="row.actor.slice(0, 2).toUpperCase()"
            :avatar-size="28"
          >
            <template #subtitle>
              <span class="mono recent__action">{{ row.action }}</span>
              <span v-if="row.target" class="mono muted recent__target">{{ row.target.length > 24 ? row.target.slice(0, 8) : row.target }}</span>
            </template>
            <template #right>
              <span class="muted recent__time" :title="fmtDate(row.created_at)">{{ fmtRelative(row.created_at) }}</span>
            </template>
          </TxCardItem>
        </div>
      </TxCard>

      <TxCard v-else>
        <template #header>
          <div class="card-head"><h2 class="section-title">称号说明</h2></div>
        </template>
        <div class="recent">
          <TxCardItem v-for="title in catalogue?.titles ?? []" :key="title.id" :description="title.description">
            <template #title>
              <TitleBadge :title="{ ...title, department: null }" />
            </template>
          </TxCardItem>
        </div>
      </TxCard>
    </div>
  </div>
</template>

<style scoped>
.identity {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 16px 24px;
}
.identity__text {
  display: flex;
  flex-direction: column;
  gap: 8px;
  flex: 1 1 260px;
  min-width: 0;
}
.identity__login {
  font-size: 18px;
  font-weight: 600;
  color: var(--tx-text-color-primary);
}
.identity__facts {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, auto));
  gap: 8px 28px;
  margin: 0;
  min-width: 0;
}
.identity__facts dt {
  font-size: 12px;
  color: var(--tx-text-color-secondary);
}
.identity__facts dd {
  margin: 2px 0 0;
  max-width: 260px;
  font-weight: 500;
}
.stat {
  cursor: pointer;
}
.stat__label {
  display: block;
}
.stat__meta {
  display: block;
  margin-top: 2px;
  font-size: 12px;
  font-weight: 400;
  color: var(--tx-text-color-secondary);
}
.domains {
  display: flex;
  flex-direction: column;
  gap: 16px;
}
.domain h3 {
  margin: 0 0 8px;
  font-size: 13px;
  font-weight: 600;
  color: var(--tx-text-color-regular);
}
.domain__note {
  margin: 6px 0 0;
  font-size: 12px;
  color: var(--tx-text-color-secondary);
}
.recent {
  display: flex;
  flex-direction: column;
  gap: 2px;
}
.recent__action {
  color: var(--tx-color-primary);
}
.recent__target {
  margin-left: 8px;
}
.recent__time {
  font-size: 12px;
  white-space: nowrap;
}
@media (max-width: 900px) {
  .identity__facts {
    grid-template-columns: minmax(0, 1fr) minmax(0, 1fr);
    width: 100%;
  }
}
</style>

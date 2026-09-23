<script setup lang="ts">
import { computed } from "vue";
import { useRouter } from "vue-router";
import { TxCard } from "@talex-touch/tuffex/card";
import { TxStatCard } from "@talex-touch/tuffex/stat-card";
import { TxCardItem } from "@talex-touch/tuffex/card-item";
import { TxAvatar } from "@talex-touch/tuffex/avatar";
import { TxButton } from "@talex-touch/tuffex/button";
import { TxTag } from "@talex-touch/tuffex/tag";
import { TxEmptyState } from "@talex-touch/tuffex/empty-state";
import { TxSkeleton } from "@talex-touch/tuffex/skeleton";
import PageHeader from "../../components/PageHeader.vue";
import ErrorPanel from "../../components/ErrorPanel.vue";
import LoadingBlock from "../../components/LoadingBlock.vue";
import { api } from "../../lib/http";
import { fmtDay, fmtRelative } from "../../lib/format";
import { useOrg } from "../../lib/github";
import { useResource } from "../../lib/resource";

type OrgInfo = { login: string; name: string | null; avatar_url: string | null; html_url: string; description: string | null; plan: string | null; public_repos: number; total_private_repos: number; two_factor_required: boolean; disk_usage_mb: number; created_at: string };
type OverviewResponse = { role: string; org: OrgInfo; counts: { members: number; repos: number; pending_invites: number; invites_24h: number; active_invite_links: number } };
type Repo = { name: string; description: string | null; visibility: string; pushed_at: string };
type Event = { id: string; actor: string; payload_summary: string; repo: string | null; created_at: string };

const router = useRouter();
const { org, apiBase, can, base } = useOrg();
const openExternal = (url: string) => window.open(url, "_blank", "noopener");
const overview = useResource(() => api<OverviewResponse>(`${apiBase.value}/overview`), [apiBase]);
const repos = useResource(() => api<{ repos: Repo[] }>(`${apiBase.value}/repos`), [apiBase]);
const activity = useResource(() => api<{ events: Event[] }>(`${apiBase.value}/activity`), [apiBase]);

const recentRepos = computed(() => [...(repos.data.value?.repos ?? [])].sort((a, b) => Date.parse(b.pushed_at) - Date.parse(a.pushed_at)).slice(0, 6));
const stats = computed(() => {
  const data = overview.data.value;
  if (!data) return [];
  const invites = can("github.invites.manage");
  return [
    { label: "成员", value: data.counts.members, meta: "组织里的正式成员", to: `${base}/members`, icon: "i-carbon-user-multiple" },
    { label: "仓库", value: data.counts.repos, meta: `公开 ${data.org.public_repos} 个，私有 ${data.org.total_private_repos} 个`, to: `${base}/repos`, icon: "i-carbon-repo-source-code" },
    { label: "待接受的邀请", value: data.counts.pending_invites, meta: `24 小时内申请 ${data.counts.invites_24h} 次`, to: invites ? `${base}/invitations` : "", icon: "i-carbon-email" },
    { label: "可用的邀请链接", value: data.counts.active_invite_links, meta: "没过期也没停用", to: invites ? `${base}/invite-links` : "", icon: "i-carbon-link" },
  ];
});
</script>

<template>
  <div class="page">
    <ErrorPanel v-if="overview.error.value" :error="overview.error.value" :retry="overview.reload" />
    <LoadingBlock v-else-if="!overview.data.value" :lines="8" />
    <template v-else>
      <PageHeader :title="overview.data.value.org.name ?? org" :description="overview.data.value.org.description ?? undefined">
        <template #meta>
          <p class="org-meta">
            <TxAvatar :src="overview.data.value.org.avatar_url ?? undefined" :name="org" :size="20" shape="rounded" />
            <span class="mono">@{{ org }}</span>
            <TxTag :label="overview.data.value.role === 'admin' ? '你是组织管理员' : '你是组织成员'" size="sm" variant="soft" />
          </p>
        </template>
        <template #actions>
          <TxButton icon="i-carbon-launch" @click="openExternal(overview.data.value.org.html_url)">在 GitHub 打开</TxButton>
        </template>
      </PageHeader>

      <div class="grid-stats">
        <TxStatCard
          v-for="stat in stats"
          :key="stat.label"
          :value="stat.value"
          :label="stat.label"
          :icon-class="stat.icon"
          :clickable="Boolean(stat.to)"
          :class="{ stat: stat.to }"
          :role="stat.to ? 'link' : undefined"
          :tabindex="stat.to ? 0 : undefined"
          @click="stat.to && router.push(stat.to)"
          @keydown.enter="stat.to && router.push(stat.to)"
        >
          <template #label>
            <span class="stat__label">{{ stat.label }}</span>
            <span class="stat__meta">{{ stat.meta }}</span>
          </template>
        </TxStatCard>
      </div>

      <div class="grid-3">
        <TxCard>
          <template #header><h2 class="section-title">组织信息</h2></template>
          <dl class="facts">
            <dt>方案</dt><dd>{{ overview.data.value.org.plan ?? "未知" }}</dd>
            <dt>创建时间</dt><dd>{{ fmtDay(overview.data.value.org.created_at) }}</dd>
            <dt>两步验证</dt><dd>{{ overview.data.value.org.two_factor_required ? "所有成员必须开启" : "不强制" }}</dd>
            <dt>存储用量</dt><dd>{{ overview.data.value.org.disk_usage_mb }} MB</dd>
          </dl>
        </TxCard>

        <TxCard>
          <template #header>
            <div class="card-head">
              <h2 class="section-title">最近推送的仓库</h2>
              <div class="card-head__actions"><TxButton variant="ghost" size="sm" @click="router.push(`${base}/repos`)">全部仓库</TxButton></div>
            </div>
          </template>
          <ErrorPanel v-if="repos.error.value" :error="repos.error.value" :retry="repos.reload" size="small" />
          <TxSkeleton v-else-if="!repos.data.value" :loading="true" :lines="5" />
          <TxEmptyState v-else-if="!recentRepos.length" title="还没有仓库" size="small" />
          <div v-else class="list">
            <TxCardItem v-for="repo in recentRepos" :key="repo.name" clickable role="link" :description="repo.description ?? ''" @click="router.push(`${base}/repos/${repo.name}`)">
              <template #title><span class="mono">{{ repo.name }}</span></template>
              <template #right><span class="muted small">{{ fmtRelative(repo.pushed_at) }}</span></template>
            </TxCardItem>
          </div>
        </TxCard>

        <TxCard>
          <template #header>
            <div class="card-head">
              <h2 class="section-title">最近活动</h2>
              <div class="card-head__actions"><TxButton variant="ghost" size="sm" @click="router.push(`${base}/activity`)">全部活动</TxButton></div>
            </div>
          </template>
          <ErrorPanel v-if="activity.error.value" :error="activity.error.value" :retry="activity.reload" size="small" />
          <TxSkeleton v-else-if="!activity.data.value" :loading="true" :lines="5" />
          <TxEmptyState v-else-if="!activity.data.value.events.length" title="最近没有活动" size="small" />
          <div v-else class="list">
            <TxCardItem v-for="event in activity.data.value.events.slice(0, 6)" :key="event.id" :avatar-text="event.actor.slice(0, 2).toUpperCase()" :avatar-size="28">
              <template #title><span class="mono">@{{ event.actor }}</span></template>
              <template #subtitle>{{ event.payload_summary }}</template>
              <template #right><span class="muted small">{{ fmtRelative(event.created_at) }}</span></template>
            </TxCardItem>
          </div>
        </TxCard>
      </div>
    </template>
  </div>
</template>

<style scoped>
.org-meta {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 8px;
  margin: 6px 0 0;
}
.grid-3 {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 16px;
  align-items: start;
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
.list {
  display: flex;
  flex-direction: column;
  gap: 2px;
}
.small {
  font-size: 12px;
  white-space: nowrap;
}
@media (max-width: 1180px) {
  .grid-3 {
    grid-template-columns: minmax(0, 1fr);
  }
}
</style>

<script setup lang="ts">
import { computed } from "vue";
import { useRoute, useRouter } from "vue-router";
import { TxTabs, TxTabItem } from "@talex-touch/tuffex/tabs";
import { TxTag } from "@talex-touch/tuffex/tag";
import { TxButton } from "@talex-touch/tuffex/button";
import PageHeader from "../../components/PageHeader.vue";
import ErrorPanel from "../../components/ErrorPanel.vue";
import LoadingBlock from "../../components/LoadingBlock.vue";
import CodeTab from "./repo/CodeTab.vue";
import CommitsTab from "./repo/CommitsTab.vue";
import ThreadsTab from "./repo/ThreadsTab.vue";
import ThreadDetail from "./repo/ThreadDetail.vue";
import SettingsTab from "./repo/SettingsTab.vue";
import { api } from "../../lib/http";
import { useOrg } from "../../lib/github";
import { useResource } from "../../lib/resource";
import type { RepoResponse } from "./repo/types";

const route = useRoute();
const router = useRouter();
const { apiBase, base } = useOrg();
const repo = computed(() => String(route.params.repo ?? ""));
const repoApi = computed(() => `${apiBase.value}/repos/${encodeURIComponent(repo.value)}`);
const detail = useResource(() => api<RepoResponse>(repoApi.value), [repoApi]);

const TABS = [
  { name: "code", label: "代码", icon: "i-carbon-code" },
  { name: "commits", label: "提交", icon: "i-carbon-commit" },
  { name: "issues", label: "Issue", icon: "i-carbon-warning-alt" },
  { name: "pulls", label: "合并请求", icon: "i-carbon-pull-request" },
  { name: "settings", label: "设置", icon: "i-carbon-settings" },
];
const tab = computed(() => (typeof route.params.tab === "string" && route.params.tab ? route.params.tab : "code"));
const number = computed(() => (typeof route.params.number === "string" ? route.params.number : ""));
const setTab = (name: string) => void router.push(`${base}/repos/${repo.value}${name === "code" ? "" : `/${name}`}`);
const openExternal = (url: string) => window.open(url, "_blank", "noopener");
</script>

<template>
  <div class="page">
    <ErrorPanel v-if="detail.error.value" :error="detail.error.value" :retry="detail.reload" />
    <LoadingBlock v-else-if="!detail.data.value" :lines="10" />
    <template v-else>
      <PageHeader :title="detail.data.value.info.name" :description="detail.data.value.info.description ?? undefined" :crumbs="[{ label: '仓库', to: `${base}/repos` }, { label: detail.data.value.info.name }]">
        <template #meta>
          <p class="repo-meta">
            <TxTag :label="detail.data.value.info.visibility === 'private' ? '私有' : '公开'" size="sm" variant="soft" />
            <TxTag v-if="detail.data.value.info.archived" label="已归档" size="sm" variant="plain" />
            <span class="muted">默认分支 <span class="mono">{{ detail.data.value.info.default_branch }}</span></span>
          </p>
        </template>
        <template #actions>
          <TxButton icon="i-carbon-launch" @click="openExternal(detail.data.value.info.html_url)">在 GitHub 打开</TxButton>
        </template>
      </PageHeader>

      <TxTabs :model-value="tab" placement="top" indicator-variant="line" borderless :content-scrollable="false" :content-padding="0" class="repo-tabs" @update:model-value="setTab">
        <TxTabItem v-for="item in TABS" :key="item.name" :name="item.name" :icon-class="item.icon">
          <template #name>{{ item.label }}</template>
          <div class="repo-tab">
            <CodeTab v-if="item.name === 'code'" :repo-api="repoApi" :repo="repo" :branches="detail.data.value.branches" :default-branch="detail.data.value.info.default_branch" />
            <CommitsTab v-else-if="item.name === 'commits'" :repo-api="repoApi" :branches="detail.data.value.branches" :default-branch="detail.data.value.info.default_branch" />
            <template v-else-if="item.name === 'issues' || item.name === 'pulls'">
              <ThreadDetail v-if="number" :kind="item.name === 'issues' ? 'issue' : 'pr'" :repo-api="repoApi" :number="number" :back="`${base}/repos/${repo}/${item.name}`" />
              <ThreadsTab v-else :kind="item.name === 'issues' ? 'issue' : 'pr'" :repo-api="repoApi" :link-base="`${base}/repos/${repo}/${item.name}`" />
            </template>
            <SettingsTab v-else :repo-api="repoApi" :detail="detail.data.value" @changed="detail.reload()" />
          </div>
        </TxTabItem>
      </TxTabs>
    </template>
  </div>
</template>

<style scoped>
.repo-meta {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 8px;
  margin: 6px 0 0;
}
.repo-tabs :deep(.tx-tabs__nav) {
  border-bottom: 1px solid var(--tx-border-color-light);
}
.repo-tab {
  padding-top: 16px;
}
</style>

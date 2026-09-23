<script setup lang="ts">
import { TxCard } from "@talex-touch/tuffex/card";
import { TxCardItem } from "@talex-touch/tuffex/card-item";
import { TxTag } from "@talex-touch/tuffex/tag";
import { TxEmptyState } from "@talex-touch/tuffex/empty-state";
import PageHeader from "../../components/PageHeader.vue";
import ErrorPanel from "../../components/ErrorPanel.vue";
import LoadingBlock from "../../components/LoadingBlock.vue";
import { api } from "../../lib/http";
import { fmtDate, fmtRelative } from "../../lib/format";
import { useOrg } from "../../lib/github";
import { useResource } from "../../lib/resource";

type Event = { id: string; actor: string; actor_avatar: string | null; payload_summary: string; repo: string | null; created_at: string; type: string };

const { apiBase } = useOrg();
const activity = useResource(() => api<{ events: Event[] }>(`${apiBase.value}/activity`), [apiBase]);
const repoName = (full: string | null) => (full ? full.split("/").pop() : "");
</script>

<template>
  <div class="page">
    <PageHeader title="活动" description="GitHub 组织最近的公开活动：推送、合并请求、Issue、发布等。" />
    <ErrorPanel v-if="activity.error.value" :error="activity.error.value" :retry="activity.reload" />
    <LoadingBlock v-else-if="!activity.data.value" :lines="10" />
    <TxCard v-else>
      <TxEmptyState v-if="!activity.data.value.events.length" title="最近没有活动" size="small" />
      <div v-else class="list">
        <TxCardItem
          v-for="event in activity.data.value.events"
          :key="event.id"
          :avatar-url="event.actor_avatar ?? ''"
          :avatar-text="event.actor.slice(0, 2).toUpperCase()"
          :avatar-size="32"
        >
          <template #title>
            <span class="mono">@{{ event.actor }}</span>
            <span class="summary">{{ event.payload_summary }}</span>
          </template>
          <template #subtitle>
            <span v-if="event.repo" class="mono">{{ repoName(event.repo) }}</span>
            <span class="muted" :title="fmtDate(event.created_at)"> {{ fmtRelative(event.created_at) }}</span>
          </template>
          <template #right>
            <TxTag :label="event.type.replace(/Event$/, '')" size="sm" variant="plain" class="mono" />
          </template>
        </TxCardItem>
      </div>
    </TxCard>
  </div>
</template>

<style scoped>
.list {
  display: flex;
  flex-direction: column;
  gap: 2px;
}
.summary {
  margin-left: 8px;
  font-weight: 400;
  color: var(--tx-text-color-regular);
}
</style>

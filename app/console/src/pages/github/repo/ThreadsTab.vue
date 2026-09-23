<script setup lang="ts">
import { computed, ref } from "vue";
import { useRouter } from "vue-router";
import { TxCard } from "@talex-touch/tuffex/card";
import { TxCardItem } from "@talex-touch/tuffex/card-item";
import { TxFilterChips } from "@talex-touch/tuffex/filter-chips";
import { TxTag } from "@talex-touch/tuffex/tag";
import { TxEmptyState } from "@talex-touch/tuffex/empty-state";
import ErrorPanel from "../../../components/ErrorPanel.vue";
import LoadingBlock from "../../../components/LoadingBlock.vue";
import { api } from "../../../lib/http";
import { fmtRelative } from "../../../lib/format";
import { useResource } from "../../../lib/resource";
import type { Label, Person } from "./types";

type Thread = { number: number; title: string; state: string; draft?: boolean; merged?: boolean; comments?: number; user: Person; labels?: Label[]; head?: string; base?: string; created_at: string; updated_at: string };

/** Issue 与合并请求列表（两者形状相近，共用一个组件）。 */
const props = defineProps<{ kind: "issue" | "pr"; repoApi: string; linkBase: string }>();
const router = useRouter();
const state = ref<"open" | "closed" | "all">("open");
const endpoint = computed(() => (props.kind === "issue" ? "issues" : "pulls"));
const list = useResource(() => api<Record<string, Thread[]>>(`${props.repoApi}/${endpoint.value}?state=${state.value}`), [state, endpoint]);
const rows = computed(() => list.data.value?.[endpoint.value] ?? []);
const chips = [{ value: "open", label: "未关闭" }, { value: "closed", label: "已关闭" }, { value: "all", label: "全部" }];
const noun = computed(() => (props.kind === "issue" ? "Issue" : "合并请求"));
const stateTag = (t: Thread) => t.merged ? "已合并" : t.state === "open" ? (t.draft ? "草稿" : "未关闭") : "已关闭";
</script>

<template>
  <div class="threads">
    <TxFilterChips v-model="state" :items="chips" :aria-label="`按状态筛选${noun}`" />
    <ErrorPanel v-if="list.error.value" :error="list.error.value" :retry="list.reload" />
    <LoadingBlock v-else-if="!list.data.value" :lines="6" />
    <TxCard v-else>
      <TxEmptyState v-if="!rows.length" :title="`没有${state === 'open' ? '未关闭的' : state === 'closed' ? '已关闭的' : ''}${noun}`" size="small" />
      <div v-else class="list">
        <TxCardItem
          v-for="thread in rows"
          :key="thread.number"
          clickable
          role="link"
          :title="thread.title"
          :icon-class="kind === 'issue' ? 'i-carbon-warning-alt' : 'i-carbon-pull-request'"
          :avatar-size="28"
          @click="router.push(`${linkBase}/${thread.number}`)"
        >
          <template #subtitle>
            <span class="mono">#{{ thread.number }}</span>
            <span class="mono"> @{{ thread.user.login }}</span>
            <span class="muted"> · {{ fmtRelative(kind === 'issue' ? thread.created_at : thread.updated_at) }}</span>
            <span v-if="thread.head" class="mono muted"> · {{ thread.head }} 合入 {{ thread.base }}</span>
          </template>
          <template #right>
            <span class="thread-tags">
              <TxTag v-for="label in thread.labels ?? []" :key="label.name" :label="label.name" :color="`#${label.color}`" size="sm" variant="soft" />
              <TxTag :label="stateTag(thread)" size="sm" variant="plain" />
            </span>
          </template>
        </TxCardItem>
      </div>
    </TxCard>
  </div>
</template>

<style scoped>
.threads {
  display: flex;
  flex-direction: column;
  gap: 12px;
}
.list {
  display: flex;
  flex-direction: column;
  gap: 2px;
}
.thread-tags {
  display: inline-flex;
  flex-wrap: wrap;
  justify-content: flex-end;
  gap: 4px;
}
</style>

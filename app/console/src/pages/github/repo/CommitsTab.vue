<script setup lang="ts">
import { ref } from "vue";
import { TxCard } from "@talex-touch/tuffex/card";
import { TxCardItem } from "@talex-touch/tuffex/card-item";
import { TxButton } from "@talex-touch/tuffex/button";
import { TxEmptyState } from "@talex-touch/tuffex/empty-state";
import ErrorPanel from "../../../components/ErrorPanel.vue";
import LoadingBlock from "../../../components/LoadingBlock.vue";
import BranchSelect from "./BranchSelect.vue";
import DiffBlock from "./DiffBlock.vue";
import { api } from "../../../lib/http";
import { fmtDate, fmtRelative } from "../../../lib/format";
import { useResource } from "../../../lib/resource";
import type { Branch, FileChange, Person } from "./types";

type Commit = { sha: string; short_sha: string; message: string; author: { name: string; date: string }; actor: Person | null };
type CommitDetail = { sha: string; message: string; author: { name: string; date: string }; actor: Person | null; stats?: { additions: number; deletions: number }; files: FileChange[] };

const props = defineProps<{ repoApi: string; branches: Branch[]; defaultBranch: string }>();
const branch = ref(props.defaultBranch);
const open = ref<string | null>(null);
const list = useResource(() => api<{ commits: Commit[] }>(`${props.repoApi}/commits?${new URLSearchParams({ sha: branch.value, per_page: "50" })}`), [branch]);
const detail = useResource(() => api<CommitDetail>(`${props.repoApi}/commits/${open.value}`), [open], { enabled: () => Boolean(open.value) });
</script>

<template>
  <div class="commits">
    <template v-if="open">
      <div><TxButton variant="ghost" size="sm" icon="i-carbon-arrow-left" @click="open = null">返回提交列表</TxButton></div>
      <ErrorPanel v-if="detail.error.value" :error="detail.error.value" :retry="detail.reload" />
      <LoadingBlock v-else-if="!detail.data.value" :lines="8" />
      <template v-else>
        <TxCard>
          <p class="message">{{ detail.data.value.message }}</p>
          <p class="muted meta">
            <span class="mono">{{ detail.data.value.actor?.login ? `@${detail.data.value.actor.login}` : detail.data.value.author.name }}</span>
            · {{ fmtDate(detail.data.value.author.date) }}
            · <span class="mono">{{ detail.data.value.sha.slice(0, 7) }}</span>
            · <span class="add">+{{ detail.data.value.stats?.additions ?? 0 }}</span> <span class="del">-{{ detail.data.value.stats?.deletions ?? 0 }}</span>
          </p>
        </TxCard>
        <DiffBlock :files="detail.data.value.files" />
      </template>
    </template>

    <template v-else>
      <BranchSelect v-model="branch" :branches="branches" />
      <ErrorPanel v-if="list.error.value" :error="list.error.value" :retry="list.reload" />
      <LoadingBlock v-else-if="!list.data.value" :lines="8" />
      <TxCard v-else>
        <TxEmptyState v-if="!list.data.value.commits.length" title="这个分支还没有提交" size="small" />
        <div v-else class="list">
          <TxCardItem
            v-for="commit in list.data.value.commits"
            :key="commit.sha"
            clickable
            role="button"
            :title="commit.message"
            :avatar-text="(commit.actor?.login ?? commit.author.name).slice(0, 2).toUpperCase()"
            :avatar-size="28"
            @click="open = commit.sha"
          >
            <template #subtitle>
              <span class="mono">{{ commit.actor?.login ? `@${commit.actor.login}` : commit.author.name }}</span>
              <span class="muted"> · {{ fmtRelative(commit.author.date) }}</span>
            </template>
            <template #right><span class="mono muted">{{ commit.short_sha }}</span></template>
          </TxCardItem>
        </div>
      </TxCard>
    </template>
  </div>
</template>

<style scoped>
.commits {
  display: flex;
  flex-direction: column;
  gap: 12px;
}
.list {
  display: flex;
  flex-direction: column;
  gap: 2px;
}
.message {
  margin: 0;
  font-size: 16px;
  font-weight: 500;
  white-space: pre-wrap;
}
.meta {
  margin: 8px 0 0;
  font-size: 13px;
}
.add {
  color: var(--tx-color-success);
}
.del {
  color: var(--tx-color-danger);
}
</style>

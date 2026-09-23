<script setup lang="ts">
import { computed, ref, watch } from "vue";
import { TxCard } from "@talex-touch/tuffex/card";
import { TxCardItem } from "@talex-touch/tuffex/card-item";
import { TxBreadcrumb } from "@talex-touch/tuffex/breadcrumb";
import { TxButton } from "@talex-touch/tuffex/button";
import { TxEmptyState } from "@talex-touch/tuffex/empty-state";
import { TxAlert } from "@talex-touch/tuffex/alert";
import ErrorPanel from "../../../components/ErrorPanel.vue";
import LoadingBlock from "../../../components/LoadingBlock.vue";
import BranchSelect from "./BranchSelect.vue";
import { api } from "../../../lib/http";
import { useResource } from "../../../lib/resource";
import type { Branch } from "./types";

type Entry = { name: string; path: string; type: "dir" | "file"; size: number };
type FileResponse = { path: string; size: number; content?: string; too_large?: boolean; html_url?: string };

const props = defineProps<{ repoApi: string; repo: string; branches: Branch[]; defaultBranch: string }>();
const ref_ = ref(props.defaultBranch);
const path = ref("");
const file = ref<string | null>(null);
watch(ref_, () => { file.value = null; });

const query = (params: Record<string, string>) => new URLSearchParams(params).toString();
const tree = useResource(() => api<{ path: string; entries: Entry[] }>(`${props.repoApi}/tree?${query({ ref: ref_.value, path: path.value })}`), [ref_, path, () => props.repoApi], { enabled: () => file.value === null });
const blob = useResource(() => api<FileResponse>(`${props.repoApi}/file?${query({ ref: ref_.value, path: file.value ?? "" })}`), [file, ref_], { enabled: () => file.value !== null });

const segments = computed(() => path.value.split("/").filter(Boolean));
const crumbs = computed(() => [{ label: props.repo }, ...segments.value.map(label => ({ label })), ...(file.value ? [{ label: file.value.split("/").pop() ?? "" }] : [])]);
function onCrumb(_item: unknown, index: number) {
  file.value = null;
  path.value = segments.value.slice(0, index).join("/");
}
const sorted = computed(() => [...(tree.data.value?.entries ?? [])].sort((a, b) => Number(b.type === "dir") - Number(a.type === "dir") || a.name.localeCompare(b.name)));
const openEntry = (entry: Entry) => { if (entry.type === "dir") path.value = entry.path; else file.value = entry.path; };
const size = (bytes: number) => (bytes >= 1024 ? `${(bytes / 1024).toFixed(1)} KB` : `${bytes} B`);
</script>

<template>
  <div class="code">
    <div class="toolbar">
      <BranchSelect v-model="ref_" :branches="branches" />
      <TxBreadcrumb :items="crumbs" class="crumbs mono" @click="onCrumb" />
    </div>

    <template v-if="file">
      <ErrorPanel v-if="blob.error.value" :error="blob.error.value" :retry="blob.reload" />
      <LoadingBlock v-else-if="!blob.data.value" :lines="12" />
      <TxCard v-else :padding="0">
        <template #header>
          <div class="card-head file-head">
            <TxButton variant="ghost" size="sm" icon="i-carbon-arrow-left" @click="file = null">返回目录</TxButton>
            <span class="muted">{{ size(blob.data.value.size) }}</span>
          </div>
        </template>
        <TxAlert v-if="blob.data.value.too_large" type="warning" :closable="false" message="文件超过 1 MB，请在 GitHub 上查看。" />
        <pre v-else class="pre file-body">{{ blob.data.value.content }}</pre>
      </TxCard>
    </template>

    <template v-else>
      <ErrorPanel v-if="tree.error.value" :error="tree.error.value" :retry="tree.reload" />
      <LoadingBlock v-else-if="!tree.data.value" :lines="8" />
      <TxCard v-else>
        <TxEmptyState v-if="!sorted.length" title="这个目录是空的" size="small" />
        <div v-else class="entries">
          <TxCardItem v-if="path" clickable role="button" title="上一级" icon-class="i-carbon-arrow-up" :avatar-size="28" @click="path = segments.slice(0, -1).join('/')" />
          <TxCardItem
            v-for="entry in sorted"
            :key="entry.path"
            clickable
            role="button"
            :icon-class="entry.type === 'dir' ? 'i-carbon-folder' : 'i-carbon-document'"
            :avatar-size="28"
            @click="openEntry(entry)"
          >
            <template #title><span class="mono">{{ entry.name }}</span></template>
            <template v-if="entry.type === 'file'" #right><span class="muted small">{{ size(entry.size) }}</span></template>
          </TxCardItem>
        </div>
      </TxCard>
    </template>
  </div>
</template>

<style scoped>
.code {
  display: flex;
  flex-direction: column;
  gap: 12px;
}
.crumbs {
  min-width: 0;
}
.entries {
  display: flex;
  flex-direction: column;
  gap: 2px;
}
.file-head {
  padding: 4px 4px 0;
}
.file-body {
  border-radius: 0;
}
.small {
  font-size: 12px;
}
</style>

<script setup lang="ts">
import { computed, ref } from "vue";
import { TxCollapse, TxCollapseItem } from "@talex-touch/tuffex/collapse";
import { TxTag } from "@talex-touch/tuffex/tag";
import type { FileChange } from "./types";

/** 文件改动列表：每个文件一个折叠面板，展开后显示 patch（增删行分别着色）。前三个文件默认展开。 */
const props = defineProps<{ files: FileChange[] }>();
const open = ref(props.files.slice(0, 3).map(f => f.filename));
const STATUS: Record<string, string> = { added: "新增", removed: "删除", modified: "修改", renamed: "重命名" };
const lines = (patch: string | null) => (patch ?? "").split("\n").map(text => ({
  text: text || " ",
  kind: text.startsWith("@@") ? "hunk" : text.startsWith("+") && !text.startsWith("+++") ? "add" : text.startsWith("-") && !text.startsWith("---") ? "del" : "ctx",
}));
const count = computed(() => props.files.length);
</script>

<template>
  <p class="muted summary">{{ count }} 个文件有改动</p>
  <TxCollapse v-model="open">
    <TxCollapseItem v-for="file in files" :key="file.filename" :name="file.filename">
      <template #title>
        <span class="file-title">
          <TxTag :label="STATUS[file.status] ?? file.status" size="sm" variant="plain" />
          <span class="mono ellipsis">{{ file.filename }}</span>
          <span class="add">+{{ file.additions }}</span>
          <span class="del">-{{ file.deletions }}</span>
        </span>
      </template>
      <pre v-if="file.patch" class="diff"><span v-for="(line, i) in lines(file.patch)" :key="i" :class="`diff__${line.kind}`">{{ line.text }}
</span></pre>
      <p v-else class="muted">没有可显示的差异（二进制、重命名或文件过大）。</p>
    </TxCollapseItem>
  </TxCollapse>
</template>

<style scoped>
.summary {
  margin: 0 0 8px;
  font-size: 13px;
}
.file-title {
  display: flex;
  align-items: center;
  gap: 8px;
  min-width: 0;
}
.add {
  color: var(--tx-color-success);
  font-size: 12px;
}
.del {
  color: var(--tx-color-danger);
  font-size: 12px;
}
.diff {
  margin: 0;
  overflow: auto;
  max-height: 60vh;
  font-family: var(--console-mono);
  font-size: 12.5px;
  line-height: 20px;
  border-radius: var(--tx-border-radius-base);
  background: var(--tx-fill-color-lighter);
}
.diff span {
  display: block;
  padding: 0 12px;
  white-space: pre;
}
.diff__add {
  background: color-mix(in srgb, var(--tx-color-success) 10%, transparent);
}
.diff__del {
  background: color-mix(in srgb, var(--tx-color-danger) 9%, transparent);
}
.diff__hunk {
  color: var(--tx-color-primary);
  background: color-mix(in srgb, var(--tx-color-primary) 7%, transparent);
}
</style>

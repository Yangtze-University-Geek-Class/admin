<script setup lang="ts">
import { TxCard } from "@talex-touch/tuffex/card";
import { TxSkeleton } from "@talex-touch/tuffex/skeleton";

/** 加载占位：卡片里几行骨架，行数按页面实际内容给。 */
withDefaults(defineProps<{ lines?: number; label?: string }>(), { lines: 5, label: "正在加载" });
</script>

<template>
  <TxCard class="loading-block" role="status" :aria-label="label">
    <TxSkeleton :loading="true" :lines="1" :width="180" :height="16" />
    <TxSkeleton class="loading-block__rows" :loading="true" :lines="lines" :height="14" :gap="14" />
  </TxCard>
</template>

<style scoped>
.loading-block__rows {
  margin-top: 18px;
}
</style>

<script setup lang="ts">
import { computed } from "vue";
import { TxSelect } from "@talex-touch/tuffex/select";
import type { Branch } from "./types";

const props = defineProps<{ branches: Branch[]; modelValue: string }>();
const emit = defineEmits<{ "update:modelValue": [value: string] }>();
const options = computed(() => props.branches.map(b => ({ value: b.name, label: b.name, description: b.protected ? "受保护" : undefined })));
</script>

<template>
  <TxSelect :model-value="modelValue" :options="options" searchable search-placeholder="搜索分支" class="branch-select" @update:model-value="(v: string | number | Array<string | number>) => emit('update:modelValue', String(v))" />
</template>

<style scoped>
.branch-select {
  width: min(260px, 100%);
}
</style>

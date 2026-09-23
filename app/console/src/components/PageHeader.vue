<script setup lang="ts">
import { computed } from "vue";
import { useRouter } from "vue-router";
import { TxBreadcrumb } from "@talex-touch/tuffex/breadcrumb";

export type Crumb = { label: string; to?: string };

/** 页头：可选面包屑、标题、一句说明、右侧操作。面包屑走站内路由，所以不给 TxBreadcrumb 传 href，由 click 事件跳转。 */
const props = defineProps<{ title: string; description?: string; crumbs?: Crumb[] }>();
const router = useRouter();
const items = computed(() => (props.crumbs ?? []).map(crumb => ({ label: crumb.label })));

function onCrumb(_item: unknown, index: number) {
  const to = props.crumbs?.[index]?.to;
  if (to) void router.push(to);
}
</script>

<template>
  <header class="page-head">
    <div class="page-head__text">
      <TxBreadcrumb v-if="items.length" class="page-head__crumbs" :items="items" @click="onCrumb" />
      <h1>{{ title }}</h1>
      <p v-if="description">{{ description }}</p>
      <slot name="meta" />
    </div>
    <div v-if="$slots.actions" class="page-head__actions">
      <slot name="actions" />
    </div>
  </header>
</template>

<style scoped>
.page-head__crumbs {
  margin-bottom: 6px;
}
</style>

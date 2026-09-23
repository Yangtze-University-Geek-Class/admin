<script setup lang="ts">
import { computed } from "vue";
import { TxErrorState } from "@talex-touch/tuffex/error-state";
import { TxPermissionState } from "@talex-touch/tuffex/permission-state";
import { describeError, errorTrace } from "../lib/errors";
import { useSession } from "../lib/session";

/** 读取失败：说清楚出了什么事、下一步做什么；缺能力时改用权限不足状态。`retry` 给了才显示「重试」。 */
const props = withDefaults(defineProps<{ error: unknown; retry?: () => unknown; size?: "small" | "medium" | "large" }>(), { retry: undefined, size: "medium" });
const { capabilityLabel } = useSession();
const view = computed(() => describeError(props.error, capabilityLabel));
const trace = computed(() => errorTrace(view.value));
</script>

<template>
  <TxPermissionState
    v-if="view.kind === 'forbidden'"
    :title="view.title"
    :description="view.detail"
    :size="size"
    surface="card"
  >
    <template #actions>
      <span class="mono trace">{{ trace }}</span>
    </template>
  </TxPermissionState>
  <TxErrorState
    v-else
    :title="view.title"
    :description="view.detail"
    :size="size"
    surface="card"
    :primary-action="retry ? { label: '重试', variant: 'secondary' } : undefined"
    @primary="retry?.()"
  >
    <template v-if="!retry" #actions>
      <span class="mono trace">{{ trace }}</span>
    </template>
  </TxErrorState>
  <p v-if="retry && view.kind !== 'forbidden'" class="mono trace trace--below">{{ trace }}</p>
</template>

<style scoped>
.trace {
  color: var(--tx-text-color-secondary);
  font-size: 12px;
  overflow-wrap: anywhere;
}
.trace--below {
  margin: 6px 0 0;
  text-align: center;
}
</style>

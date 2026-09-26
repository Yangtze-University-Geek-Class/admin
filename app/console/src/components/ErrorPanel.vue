<script setup lang="ts">
import { computed } from "vue";
import { useRoute } from "vue-router";
import { TxErrorState } from "@talex-touch/tuffex/error-state";
import { TxPermissionState } from "@talex-touch/tuffex/permission-state";
import { describeError, errorTrace } from "../lib/errors";
import { signInHref } from "../lib/runtime";
import { useSession } from "../lib/session";
import { assignerText } from "../lib/titles";

/**
 * 读取失败：说清楚出了什么事、下一步做什么；缺能力时改用权限不足状态。`retry` 给了才显示「重试」。
 * 登录已失效时重试只会再拿到 401，改成「重新登录」，登录后回到当前页面（#133）。
 */
const props = withDefaults(defineProps<{ error: unknown; retry?: () => unknown; size?: "small" | "medium" | "large" }>(), { retry: undefined, size: "medium" });
const { catalogue, capabilityLabel } = useSession();
const route = useRoute();
const view = computed(() => describeError(props.error, capabilityLabel, assignerText(catalogue.value)));
const trace = computed(() => errorTrace(view.value));
const signedOut = computed(() => view.value.kind === "signed_out");
const action = computed(() => (signedOut.value ? { label: "重新登录", variant: "primary" as const } : props.retry ? { label: "重试", variant: "secondary" as const } : undefined));
function onPrimary() {
  if (signedOut.value) window.location.assign(signInHref(`${window.location.origin}${route.fullPath}`));
  else props.retry?.();
}
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
    :primary-action="action"
    @primary="onPrimary"
  >
    <template v-if="!action" #actions>
      <span class="mono trace">{{ trace }}</span>
    </template>
  </TxErrorState>
  <p v-if="action && view.kind !== 'forbidden'" class="mono trace trace--below">{{ trace }}</p>
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

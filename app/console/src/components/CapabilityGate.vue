<script setup lang="ts">
import { computed } from "vue";
import { useRouter } from "vue-router";
import { TxPermissionState } from "@talex-touch/tuffex/permission-state";
import { BLOCK_REASON_TEXT } from "../lib/nav";
import { useSession } from "../lib/session";

/**
 * 页面级能力门：前端只做提示，服务端仍独立校验。
 * 没有任何一项所需能力时，说明缺哪项；称号给了但被 GitHub 组织角色挡住时，说明是这个原因。
 */
const props = defineProps<{ anyOf: string[] }>();
const { me, canAny, capabilityLabel } = useSession();
const router = useRouter();

const allowed = computed(() => canAny(props.anyOf));
const blocked = computed(() => me.value?.blocked.find(item => props.anyOf.includes(item.capability)) ?? null);
const needed = computed(() => capabilityLabel(blocked.value?.capability ?? props.anyOf[0]));
const title = computed(() => `你没有「${needed.value}」权限`);
const description = computed(() => blocked.value
  ? `你的称号包含这项权限，但${BLOCK_REASON_TEXT[blocked.value.reason]}才能使用。控制台不能超出你在 GitHub 组织里的角色。`
  : `请联系班长，在「成员与权限」里给你指派带有「${needed.value}」的称号。`);
</script>

<template>
  <slot v-if="allowed" />
  <div v-else class="page">
    <TxPermissionState
      :title="title"
      :description="description"
      size="large"
      surface="card"
      :primary-action="{ label: '回到概览', variant: 'secondary' }"
      @primary="router.push('/console')"
    >
      <template #icon>
        <i class="i-carbon-locked gate-icon" aria-hidden="true" />
      </template>
    </TxPermissionState>
    <p class="mono gate-trace">403 missing_capability · {{ anyOf.join(" | ") }}</p>
  </div>
</template>

<style scoped>
.gate-icon {
  font-size: 40px;
  color: var(--tx-text-color-secondary);
}
.gate-trace {
  margin: 0;
  text-align: center;
  font-size: 12px;
  color: var(--tx-text-color-secondary);
}
</style>

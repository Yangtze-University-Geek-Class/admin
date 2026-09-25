<script setup lang="ts">
import { computed } from "vue";
import { TxAlert } from "@talex-touch/tuffex/alert";
import { describeError, errorTrace } from "../lib/errors";
import { useSession } from "../lib/session";
import { assignerText } from "../lib/titles";

/** 写操作失败：内联横幅，保留用户已填的内容。 */
const props = defineProps<{ error: unknown }>();
defineEmits<{ close: [] }>();
const { catalogue, capabilityLabel } = useSession();
const view = computed(() => describeError(props.error, capabilityLabel, assignerText(catalogue.value)));
</script>

<template>
  <TxAlert type="error" :title="view.title" :closable="true" @close="$emit('close')">
    <span>{{ view.detail }}</span>
    <span class="mono trace">{{ errorTrace(view) }}</span>
  </TxAlert>
</template>

<style scoped>
.trace {
  display: block;
  margin-top: 2px;
  font-size: 12px;
  opacity: 0.8;
  overflow-wrap: anywhere;
}
</style>

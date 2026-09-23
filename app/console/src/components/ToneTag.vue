<script setup lang="ts">
import { computed } from "vue";
import { TxTag } from "@talex-touch/tuffex/tag";
import { useSession } from "../lib/session";
import { toneColor } from "../lib/titles";
import type { Tone } from "../lib/types";

/** 状态标签：带色点的 TxTag，色调取 catalogue 的 tones（与称号徽章同一套色）。 */
const props = withDefaults(defineProps<{ tone: Tone; label: string; icon?: string; dot?: boolean }>(), { icon: "", dot: true });
const { catalogue } = useSession();
const color = computed(() => toneColor(props.tone, catalogue.value));
</script>

<template>
  <TxTag :label="label" :icon="icon" :color="color" :dot="dot ? color : undefined" variant="soft" />
</template>

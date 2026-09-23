<script setup lang="ts">
import { computed } from "vue";
import { TxTag } from "@talex-touch/tuffex/tag";
import { carbon } from "../lib/icons";
import { useSession } from "../lib/session";
import { badgeTone, toneColor } from "../lib/titles";
import type { TitleView } from "../lib/types";

/** 称号徽章：TxTag + 称号图标 + 中文称号。色调来自 catalogue（班长琥珀、负责人随部门、干事灰蓝、成员天蓝、领航员紫）。 */
const props = withDefaults(defineProps<{ title: Pick<TitleView, "id" | "label" | "icon" | "tone" | "department">; size?: "sm" | "md" }>(), { size: "sm" });
const { catalogue } = useSession();
const color = computed(() => toneColor(badgeTone(props.title), catalogue.value));
</script>

<template>
  <TxTag :label="title.label" :icon="carbon(title.icon)" :color="color" :size="size" variant="soft" />
</template>

<script setup lang="ts">
import { computed } from "vue";
import { TxTag } from "@talex-touch/tuffex/tag";
import { carbon } from "../../lib/icons";
import { useSession } from "../../lib/session";
import { KIND_LABEL, kindOf, kindTone, toneColor } from "../../lib/titles";
import type { Assignment, Department } from "../../lib/types";

/** 名单里的称号徽章：舰长琥珀、队长随部门色、舰员灰蓝、成员天蓝、领航员紫。部门名另起一列，这里不重复。 */
const props = defineProps<{ row: Pick<Assignment, "role" | "department_id">; departments: Department[] }>();
const { catalogue } = useSession();
const kind = computed(() => kindOf(props.row));
const color = computed(() => toneColor(kindTone(props.row, props.departments, catalogue.value), catalogue.value));
const icon = computed(() => {
  if (kind.value === "head" || kind.value === "crew") return carbon(props.departments.find(d => d.id === props.row.department_id)?.icon);
  return carbon(catalogue.value?.titles.find(t => t.id === props.row.role)?.icon ?? { captain: "star-filled", member: "code", alumni: "compass" }[props.row.role as string]);
});
</script>

<template>
  <TxTag :label="KIND_LABEL[kind]" :icon="icon" :color="color" variant="soft" />
</template>

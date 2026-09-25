<script setup lang="ts">
import { computed, ref, watch } from "vue";
import { TxModal } from "@talex-touch/tuffex/modal";
import { TxCheckbox } from "@talex-touch/tuffex/checkbox";
import { TxButton } from "@talex-touch/tuffex/button";
import { toast } from "@talex-touch/tuffex/utils";
import ErrorAlert from "../../components/ErrorAlert.vue";
import { api, jsonBody } from "../../lib/http";
import { useAction } from "../../lib/resource";
import { titleLabel } from "../../lib/titles";
import type { Catalogue, Department } from "../../lib/types";

/**
 * 编辑部门权限包：按能力类别分组，每项两个复选框（head / 带部门的 member，名字取 catalogue）。
 * catalogue.captain_only 里的能力不能放进部门权限包，不列出；「进入控制台」是自动获得的，也不列出。
 */
const props = defineProps<{ open: boolean; department: Department | null; catalogue: Catalogue }>();
const emit = defineEmits<{ "update:open": [value: boolean]; done: [] }>();
const headLabel = computed(() => titleLabel("head", props.catalogue));
const crewLabel = computed(() => titleLabel("member", props.catalogue));

const head = ref(new Set<string>());
const crew = ref(new Set<string>());
watch(() => [props.open, props.department] as const, ([open, department]) => {
  if (!open || !department) return;
  head.value = new Set(department.head_capabilities);
  crew.value = new Set(department.member_capabilities);
  save.reset();
}, { immediate: true });

const delegatable = computed(() => props.catalogue.capabilities.filter(item => !props.catalogue.captain_only.includes(item.id) && item.id !== "console.access"));
const groups = computed(() => props.catalogue.domains
  .map(domain => ({ ...domain, items: delegatable.value.filter(item => item.domain === domain.id) }))
  .filter(domain => domain.items.length > 0));

const dirty = computed(() => {
  const d = props.department;
  if (!d) return false;
  const same = (a: Set<string>, b: string[]) => a.size === b.length && b.every(id => a.has(id));
  return !same(head.value, d.head_capabilities) || !same(crew.value, d.member_capabilities);
});

function toggle(set: "head" | "crew", id: string, value: boolean) {
  const target = set === "head" ? head : crew;
  const next = new Set(target.value);
  if (value) next.add(id); else next.delete(id);
  target.value = next;
}

const save = useAction(async () => {
  const order = delegatable.value.map(item => item.id);
  await api(`/api/console/departments/${props.department!.id}`, {
    method: "PATCH",
    ...jsonBody({
      head_capabilities: order.filter(id => head.value.has(id)),
      member_capabilities: order.filter(id => crew.value.has(id)),
    }),
  });
  toast({ title: "权限包已保存", description: props.department!.name, variant: "success" });
  emit("done");
  emit("update:open", false);
});
</script>

<template>
  <TxModal
    :model-value="open"
    :title="department ? `${department.name}的权限包` : '权限包'"
    width="min(94vw, 720px)"
    @update:model-value="value => emit('update:open', value)"
  >
    <p class="intro">勾选的权限会加在对应称号的基础权限上。GitHub 类权限仍受成员自己在 GitHub 组织里的角色限制。</p>
    <div class="bundle">
      <div class="bundle__head" aria-hidden="true">
        <span />
        <span>{{ headLabel }}</span>
        <span>{{ crewLabel }}</span>
      </div>
      <fieldset v-for="group in groups" :key="group.id" class="bundle__group">
        <legend>{{ group.label }}</legend>
        <div v-for="item in group.items" :key="item.id" class="bundle__row">
          <span class="bundle__label">
            {{ item.label }}
            <span class="bundle__desc">{{ item.description }}</span>
          </span>
          <TxCheckbox
            :model-value="head.has(item.id)"
            :aria-label="`${headLabel}：${item.label}`"
            @update:model-value="(value: boolean) => toggle('head', item.id, value)"
          />
          <TxCheckbox
            :model-value="crew.has(item.id)"
            :aria-label="`${crewLabel}：${item.label}`"
            @update:model-value="(value: boolean) => toggle('crew', item.id, value)"
          />
        </div>
      </fieldset>
    </div>
    <ErrorAlert v-if="save.error.value" :error="save.error.value" class="bundle__state" @close="save.reset()" />
    <template #footer>
      <div class="dialog-actions">
        <TxButton variant="secondary" @click="emit('update:open', false)">取消</TxButton>
        <TxButton variant="primary" :disabled="!dirty" :loading="save.pending.value" @click="save.execute()">{{ dirty ? "保存权限包" : "没有修改" }}</TxButton>
      </div>
    </template>
  </TxModal>
</template>

<style scoped>
.intro {
  margin: 0 0 12px;
  font-size: 13px;
  line-height: 20px;
  color: var(--tx-text-color-secondary);
}
.bundle {
  max-height: min(56vh, 520px);
  overflow-y: auto;
  padding-right: 4px;
}
.bundle__head,
.bundle__row {
  display: grid;
  grid-template-columns: minmax(0, 1fr) 64px 64px;
  align-items: center;
  gap: 8px;
}
.bundle__head {
  position: sticky;
  top: 0;
  z-index: 1;
  padding: 4px 0 6px;
  font-size: 12px;
  text-align: center;
  color: var(--tx-text-color-secondary);
  background: var(--tx-bg-color-overlay);
}
.bundle__group {
  margin: 0 0 10px;
  padding: 4px 12px 8px;
  border: 1px solid var(--tx-border-color-light);
  border-radius: var(--tx-border-radius-base);
}
.bundle__group legend {
  padding: 0 4px;
  font-size: 12px;
  font-weight: 600;
  color: var(--tx-text-color-regular);
}
.bundle__row {
  padding: 6px 0;
  border-top: 1px solid var(--tx-border-color-extra-light);
}
.bundle__row:first-of-type {
  border-top: 0;
}
.bundle__row > :deep(.tx-checkbox) {
  justify-self: center;
}
.bundle__label {
  display: flex;
  flex-direction: column;
  min-width: 0;
  font-size: 14px;
  color: var(--tx-text-color-primary);
}
.bundle__desc {
  font-size: 12px;
  color: var(--tx-text-color-secondary);
}
.bundle__state {
  margin-top: 12px;
}
.dialog-actions {
  display: flex;
  justify-content: flex-end;
  gap: 8px;
}
@media (max-width: 520px) {
  .bundle__head,
  .bundle__row {
    grid-template-columns: minmax(0, 1fr) 48px 48px;
  }
}
</style>

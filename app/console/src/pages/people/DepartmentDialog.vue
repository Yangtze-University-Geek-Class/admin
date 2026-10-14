<script setup lang="ts">
import { computed, ref, watch } from "vue";
import { TxModal } from "@talex-touch/tuffex/modal";
import { TxForm, TxFormItem } from "@talex-touch/tuffex/form";
import { TxInput } from "@talex-touch/tuffex/input";
import { TxNumberInput } from "@talex-touch/tuffex/number-input";
import { TxTextarea } from "@talex-touch/tuffex/textarea";
import { TxRadioGroup, TxRadio } from "@talex-touch/tuffex/radio";
import { TxButton } from "@talex-touch/tuffex/button";
import { toast } from "@talex-touch/tuffex/utils";
import ErrorAlert from "../../components/ErrorAlert.vue";
import { api, jsonBody } from "../../lib/http";
import { carbon, iconName } from "../../lib/icons";
import { useAction } from "../../lib/resource";
import { TONE_NAMES, toneColor } from "../../lib/titles";
import {
  DEPARTMENT_DESCRIPTION_MAX, DEPARTMENT_NAME_MAX, DEPARTMENT_SORT_ORDER_MAX,
  departmentBody, departmentChanged, departmentDraftErrors, departmentDraftOf, departmentPatch, emptyDepartmentDraft,
  type DepartmentDraft,
} from "../../lib/departments";
import type { Capability, Catalogue, Department, Tone } from "../../lib/types";

/**
 * 新建或编辑一个部门：名字、英文标签、图标、色调、说明和排序。
 * id 是主键，只在新建时填写（服务端的 PATCH 也不接受 id）。权限包不在这里改：新建后用现有的「编辑权限」设置。
 * 校验规则与服务端一致；编辑只提交改动的字段（服务端要求至少一项）。
 */
const props = defineProps<{ open: boolean; department: Department | null; catalogue: Catalogue }>();
const emit = defineEmits<{ "update:open": [value: boolean]; done: [] }>();

const editing = computed(() => props.department !== null);
const draft = ref<DepartmentDraft>(emptyDepartmentDraft());
const original = ref<DepartmentDraft>(emptyDepartmentDraft());
const touched = ref(false);

/** 服务端按清单顺序存权限包；提交时用它排序（这里不改权限包，只保证原样带回）。 */
const order = computed<Capability[]>(() => props.catalogue.capabilities.map(item => item.id));
const toneIds = computed(() => Object.keys(props.catalogue.tones) as Tone[]);

watch(() => [props.open, props.department] as const, ([open, department]) => {
  if (!open) return;
  original.value = department ? departmentDraftOf(department) : emptyDepartmentDraft();
  draft.value = {
    ...original.value,
    head_capabilities: [...original.value.head_capabilities],
    member_capabilities: [...original.value.member_capabilities],
  };
  touched.value = false;
  save.reset();
}, { immediate: true });

const errors = computed(() => departmentDraftErrors(draft.value, props.catalogue, { editing: editing.value }));
const shown = computed(() => (touched.value ? errors.value : {}));
const dirty = computed(() => departmentChanged(original.value, draft.value));

const save = useAction(async () => {
  if (editing.value) {
    const patch = departmentPatch(original.value, draft.value, order.value);
    await api(`/api/console/departments/${encodeURIComponent(props.department!.id)}`, { method: "PATCH", ...jsonBody(patch) });
    toast({ title: "部门已保存", description: draft.value.name.trim(), variant: "success" });
  } else {
    await api("/api/console/departments", { method: "POST", ...jsonBody(departmentBody(draft.value, order.value)) });
    toast({ title: "部门已建立", description: draft.value.name.trim(), variant: "success" });
  }
  emit("done");
  emit("update:open", false);
});

async function submit() {
  touched.value = true;
  if (Object.keys(errors.value).length > 0 || !dirty.value) return;
  await save.execute();
}

/** 数字输入清空时给 null；排序留空按 0 处理（0 也是合法值，会排在最前）。 */
function setSortOrder(value: number | null) {
  draft.value.sort_order = value ?? 0;
}
const previewName = computed(() => draft.value.name.trim() || "新部门");
</script>

<template>
  <TxModal
    :model-value="open"
    :title="editing ? `编辑「${department?.name}」` : '新建部门'"
    width="min(94vw, 720px)"
    @update:model-value="value => emit('update:open', value)"
  >
    <TxForm :model="draft" label-position="top" class="dept-form" @submit="submit">
      <div class="preview">
        <span
          class="preview__icon"
          :style="{ color: toneColor(draft.tone, catalogue), background: `color-mix(in srgb, ${toneColor(draft.tone, catalogue)} 10%, white)` }"
        >
          <i :class="carbon(draft.icon)" aria-hidden="true" />
        </span>
        <span class="preview__name">{{ previewName }}</span>
        <span class="mono preview__tag">{{ draft.tag || "TAG" }}</span>
      </div>

      <p class="intro">
        部门是组织分组：成员归属、称号与组内任免都跟着它走。排序越小越靠前。
        <template v-if="editing">id 是主键，建立后不能改。</template>
      </p>

      <div class="form-grid">
        <TxFormItem label="名字" required>
          <template #default="field">
            <TxInput
              v-bind="field"
              v-model="draft.name"
              :placeholder="`例如 网络网安组（最多 ${DEPARTMENT_NAME_MAX} 个字）`"
              autocomplete="off"
              :aria-invalid="Boolean(shown.name)"
            />
            <span v-if="shown.name" class="field-error">{{ shown.name }}</span>
          </template>
        </TxFormItem>
        <TxFormItem label="英文标签" required>
          <template #default="field">
            <TxInput
              v-bind="field"
              :model-value="draft.tag"
              class="mono-input"
              placeholder="例如 NETSEC"
              autocomplete="off"
              spellcheck="false"
              :aria-invalid="Boolean(shown.tag)"
              @update:model-value="(value: string | number) => (draft.tag = String(value).toUpperCase())"
            />
            <span v-if="shown.tag" class="field-error">{{ shown.tag }}</span>
          </template>
        </TxFormItem>
      </div>

      <div class="form-grid">
        <TxFormItem v-if="!editing" label="id" required>
          <template #default="field">
            <TxInput
              v-bind="field"
              :model-value="draft.id"
              class="mono-input"
              placeholder="例如 netsec"
              autocomplete="off"
              spellcheck="false"
              :aria-invalid="Boolean(shown.id)"
              @update:model-value="(value: string | number) => (draft.id = String(value).toLowerCase())"
            />
            <span v-if="shown.id" class="field-error">{{ shown.id }}</span>
          </template>
        </TxFormItem>
        <TxFormItem label="排序">
          <template #default="field">
            <TxNumberInput
              v-bind="field"
              :model-value="draft.sort_order"
              :min="0"
              :max="DEPARTMENT_SORT_ORDER_MAX"
              :step="10"
              :precision="0"
              aria-label="排序"
              @update:model-value="setSortOrder"
            />
            <span v-if="shown.sort_order" class="field-error">{{ shown.sort_order }}</span>
          </template>
        </TxFormItem>
      </div>

      <TxFormItem label="图标" required>
        <TxRadioGroup v-model="draft.icon" type="card" direction="row" class="picker" aria-label="图标">
          <TxRadio v-for="name in catalogue.department_icons" :key="name" :value="name" :title="iconName(name)" :aria-label="iconName(name)">
            <i :class="carbon(name)" class="picker__icon" aria-hidden="true" />
          </TxRadio>
        </TxRadioGroup>
        <span v-if="shown.icon" class="field-error">{{ shown.icon }}</span>
      </TxFormItem>

      <TxFormItem label="色调" required>
        <TxRadioGroup v-model="draft.tone" type="card" direction="row" class="picker" aria-label="色调">
          <TxRadio v-for="id in toneIds" :key="id" :value="id">
            <span class="swatch">
              <span class="swatch__dot" :style="{ background: toneColor(id, catalogue) }" aria-hidden="true" />
              {{ TONE_NAMES[id] ?? id }}
            </span>
          </TxRadio>
        </TxRadioGroup>
        <span v-if="shown.tone" class="field-error">{{ shown.tone }}</span>
      </TxFormItem>

      <TxFormItem label="说明（选填）">
        <TxTextarea
          v-model="draft.description"
          :rows="2"
          :max-length="DEPARTMENT_DESCRIPTION_MAX"
          placeholder="一句话说明这个部门负责什么"
        />
        <span v-if="shown.description" class="field-error">{{ shown.description }}</span>
      </TxFormItem>

      <ErrorAlert v-if="save.error.value" :error="save.error.value" class="dept-form__state" @close="save.reset()" />
    </TxForm>
    <template #footer>
      <div class="dialog-actions">
        <TxButton variant="secondary" @click="emit('update:open', false)">取消</TxButton>
        <TxButton variant="primary" :disabled="!dirty" :loading="save.pending.value" @click="submit">
          {{ editing ? (dirty ? "保存" : "没有修改") : "建立部门" }}
        </TxButton>
      </div>
    </template>
  </TxModal>
</template>

<style scoped>
.dept-form {
  display: flex;
  flex-direction: column;
  gap: 4px;
  max-height: min(64vh, 640px);
  overflow-y: auto;
  padding-right: 4px;
}
.preview {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 10px;
  margin-bottom: 8px;
  padding: 10px 12px;
  border-radius: var(--tx-border-radius-base);
  background: var(--tx-fill-color-lighter);
}
.preview__icon {
  display: grid;
  place-items: center;
  width: 28px;
  height: 28px;
  border-radius: 8px;
  font-size: 15px;
}
.preview__name {
  font-size: 14px;
  font-weight: 600;
  color: var(--tx-text-color-primary);
}
.preview__tag {
  font-size: 12px;
  color: var(--tx-text-color-secondary);
}
.intro {
  margin: 0 0 10px;
  font-size: 13px;
  line-height: 20px;
  color: var(--tx-text-color-secondary);
}
.mono-input :deep(input) {
  font-family: var(--console-mono);
}
.field-error {
  font-size: 12px;
  color: var(--tx-color-danger);
}
/* TxRadio 的卡片样式默认一项占满一行；这里改成紧凑的小方块，换行排列。 */
.picker {
  gap: 8px;
}
.picker :deep(.tx-radio--card) {
  width: auto;
  gap: 8px;
  padding: 6px 10px;
  border-radius: 10px;
}
.picker__icon {
  font-size: 18px;
}
.swatch {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  font-size: 13px;
  white-space: nowrap;
}
.swatch__dot {
  width: 14px;
  height: 14px;
  border-radius: 50%;
}
.dept-form__state {
  margin-top: 12px;
}
.dialog-actions {
  display: flex;
  justify-content: flex-end;
  gap: 8px;
}
</style>

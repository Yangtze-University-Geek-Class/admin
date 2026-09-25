<script setup lang="ts">
import { computed, ref, watch } from "vue";
import { TxModal } from "@talex-touch/tuffex/modal";
import { TxForm, TxFormItem } from "@talex-touch/tuffex/form";
import { TxInput } from "@talex-touch/tuffex/input";
import { TxTextarea } from "@talex-touch/tuffex/textarea";
import { TxRadioGroup, TxRadio } from "@talex-touch/tuffex/radio";
import { TxCheckbox } from "@talex-touch/tuffex/checkbox";
import { TxButton } from "@talex-touch/tuffex/button";
import { toast } from "@talex-touch/tuffex/utils";
import ErrorAlert from "../../components/ErrorAlert.vue";
import TitleBadge from "../../components/TitleBadge.vue";
import { api, jsonBody } from "../../lib/http";
import { carbon, iconName } from "../../lib/icons";
import { useAction } from "../../lib/resource";
import {
  TITLE_DESCRIPTION_MAX, TITLE_LABEL_MAX, TONE_NAMES, closure, titleBundleError, titleDraftErrors, titleLabel, titlePatch, toneColor,
} from "../../lib/titles";
import type { Catalogue, CatalogueCapability, CatalogueTitle, TitleConfig, TitlePatchResponse, Tone } from "../../lib/types";

/**
 * 编辑一个称号：名字、英文标签、图标、色调、说明和权限包，改完全站的徽章和权限都跟着变。
 * admin 的权限永远是全部、guest 没有权限，这两个只能改显示；catalogue.captain_only 里的能力只能给 captain。
 * 校验规则与服务端一致，只提交改动的字段。
 */
const props = defineProps<{ open: boolean; title: CatalogueTitle | null; catalogue: Catalogue }>();
const emit = defineEmits<{ "update:open": [value: boolean]; done: [] }>();

const label = ref("");
const tag = ref("");
const icon = ref("");
const tone = ref<Tone>("slate");
const description = ref("");
const selected = ref(new Set<string>());
const touched = ref(false);

const original = computed<TitleConfig | null>(() => {
  const title = props.title;
  if (!title) return null;
  const { id, label, tag, icon, tone, description } = title;
  return { id, label, tag, icon, tone, description, capabilities: props.catalogue.role_base[id] ?? [] };
});
const fixed = computed(() => props.title?.id === "admin" || props.title?.id === "guest");
const nameOf = (id: Parameters<typeof titleLabel>[0]) => titleLabel(id, props.catalogue);

const draft = computed(() => ({
  label: label.value, tag: tag.value, icon: icon.value, tone: tone.value, description: description.value,
  capabilities: fixed.value
    ? original.value?.capabilities ?? []
    : props.catalogue.capabilities.map(item => item.id).filter(id => selected.value.has(id)),
}));
const errors = computed(() => titleDraftErrors(draft.value));
const shown = computed(() => (touched.value ? errors.value : {}));
const patch = computed(() => (original.value ? titlePatch(original.value, draft.value) : {}));
const dirty = computed(() => Object.keys(patch.value).length > 0);
const bundleError = computed(() => (props.title && patch.value.capabilities
  ? titleBundleError(props.title.id, patch.value.capabilities, props.catalogue.captain_only)
  : null));

const save = useAction(async () => {
  const id = props.title!.id;
  const result = await api<TitlePatchResponse>(`/api/console/titles/${id}`, { method: "PATCH", ...jsonBody(patch.value) });
  toast({ title: "称号已保存", description: result.title.label, variant: "success" });
  emit("done");
  emit("update:open", false);
});

watch(() => [props.open, props.title] as const, ([open]) => {
  const current = original.value;
  if (!open || !current) return;
  label.value = current.label;
  tag.value = current.tag;
  icon.value = current.icon;
  tone.value = current.tone;
  description.value = current.description;
  selected.value = new Set(current.capabilities);
  touched.value = false;
  save.reset();
}, { immediate: true });

const toneIds = computed(() => Object.keys(props.catalogue.tones) as Tone[]);
const groups = computed(() => props.catalogue.domains
  .map(domain => ({ ...domain, items: props.catalogue.capabilities.filter(item => item.domain === domain.id) }))
  .filter(domain => domain.items.length > 0));
const capabilityName = (id: string) => props.catalogue.capabilities.find(item => item.id === id)?.label ?? id;

/** 被别的已选能力蕴含的能力 → 蕴含它的那一项（显示为已勾选、不能单独取消）。 */
const impliedBy = computed(() => {
  const result = new Map<string, string>();
  for (const id of selected.value) {
    for (const implied of closure([id], props.catalogue.implies)) {
      if (implied !== id && !result.has(implied)) result.set(implied, id);
    }
  }
  return result;
});
const captainOnly = (id: string) => props.catalogue.captain_only.includes(id) && props.title?.id !== "captain";
const isChecked = (id: string) => (fixed.value ? props.title?.id === "admin" : selected.value.has(id) || impliedBy.value.has(id));
const isDisabled = (id: string) => fixed.value || captainOnly(id) || impliedBy.value.has(id);
function rowNote(item: CatalogueCapability): string {
  const by = impliedBy.value.get(item.id);
  if (by && !fixed.value) return `随「${capabilityName(by)}」自动获得`;
  if (captainOnly(item.id) && !fixed.value) return `只能给${nameOf("captain")}`;
  return item.description;
}
function toggle(id: string, value: boolean) {
  const next = new Set(selected.value);
  if (value) next.add(id); else next.delete(id);
  selected.value = next;
}

const fixedReason = computed(() => {
  if (props.title?.id === "admin") return `${nameOf("admin")}永远拥有全部权限，不能修改。`;
  if (props.title?.id === "guest") return `${nameOf("guest")}没有任何权限，不能修改。`;
  return "";
});
const capsIntro = computed(() => {
  if (props.title?.id === "head") return `这里是${nameOf("head")}的基础权限，另加所在部门的权限包。`;
  if (props.title?.id === "member") return `这里是${nameOf("member")}的基础权限；有部门的另加部门的权限包。`;
  return "勾选的权限会给所有拥有这个称号的人。";
});

const preview = computed(() => ({
  id: props.title?.id ?? "guest", label: label.value.trim() || props.title?.label || "", icon: icon.value, tone: tone.value, department: null,
}));

async function submit() {
  touched.value = true;
  if (Object.keys(errors.value).length > 0 || !dirty.value || bundleError.value) return;
  await save.execute();
}
</script>

<template>
  <TxModal
    :model-value="open"
    :title="title ? `编辑「${title.label}」` : '编辑称号'"
    width="min(94vw, 720px)"
    @update:model-value="value => emit('update:open', value)"
  >
    <TxForm v-if="title" :model="{ label, tag, icon, tone, description }" label-position="top" class="title-form" @submit="submit">
      <div class="preview">
        <span class="preview__label">预览</span>
        <TitleBadge :title="preview" size="md" />
        <span class="mono preview__tag">{{ tag || title.tag }}</span>
      </div>

      <div class="form-grid">
        <TxFormItem label="名字" required>
          <template #default="field">
            <TxInput v-bind="field" v-model="label" :placeholder="`最多 ${TITLE_LABEL_MAX} 个字`" autocomplete="off" :aria-invalid="Boolean(shown.label)" />
            <span v-if="shown.label" class="field-error">{{ shown.label }}</span>
          </template>
        </TxFormItem>
        <TxFormItem label="英文标签" required>
          <template #default="field">
            <TxInput
              v-bind="field"
              :model-value="tag"
              class="mono-input"
              placeholder="例如 CAPTAIN"
              autocomplete="off"
              spellcheck="false"
              :aria-invalid="Boolean(shown.tag)"
              @update:model-value="(value: string | number) => (tag = String(value).toUpperCase())"
            />
            <span v-if="shown.tag" class="field-error">{{ shown.tag }}</span>
          </template>
        </TxFormItem>
      </div>

      <TxFormItem label="图标">
        <TxRadioGroup v-model="icon" type="card" direction="row" class="picker" aria-label="图标">
          <TxRadio v-for="name in catalogue.department_icons" :key="name" :value="name" :title="iconName(name)" :aria-label="iconName(name)">
            <i :class="carbon(name)" class="picker__icon" aria-hidden="true" />
          </TxRadio>
        </TxRadioGroup>
      </TxFormItem>

      <TxFormItem label="色调">
        <TxRadioGroup v-model="tone" type="card" direction="row" class="picker" aria-label="色调">
          <TxRadio v-for="id in toneIds" :key="id" :value="id">
            <span class="swatch">
              <span class="swatch__dot" :style="{ background: toneColor(id, catalogue) }" aria-hidden="true" />
              {{ TONE_NAMES[id] ?? id }}
            </span>
          </TxRadio>
        </TxRadioGroup>
      </TxFormItem>

      <TxFormItem label="说明（选填）">
        <TxTextarea v-model="description" :rows="2" :max-length="TITLE_DESCRIPTION_MAX" placeholder="一句话说明什么人会有这个称号" />
        <span v-if="shown.description" class="field-error">{{ shown.description }}</span>
      </TxFormItem>

      <section class="caps" aria-labelledby="title-caps-heading">
        <h3 id="title-caps-heading" class="caps__heading">权限</h3>
        <p class="caps__intro">
          <template v-if="fixedReason">{{ fixedReason }}</template>
          <template v-else>{{ capsIntro }}GitHub 类权限仍受成员自己在 GitHub 组织里的角色限制。</template>
        </p>
        <div class="caps__list">
          <fieldset v-for="group in groups" :key="group.id" class="caps__group">
            <legend>{{ group.label }}</legend>
            <div v-for="item in group.items" :key="item.id" class="caps__row">
              <span class="caps__label">
                {{ item.label }}
                <span class="caps__desc">{{ rowNote(item) }}</span>
              </span>
              <TxCheckbox
                :model-value="isChecked(item.id)"
                :disabled="isDisabled(item.id)"
                :aria-label="item.label"
                @update:model-value="(value: boolean) => toggle(item.id, value)"
              />
            </div>
          </fieldset>
        </div>
      </section>

      <ErrorAlert v-if="save.error.value" :error="save.error.value" class="title-form__state" @close="save.reset()" />
    </TxForm>
    <template #footer>
      <div class="dialog-actions">
        <TxButton variant="secondary" @click="emit('update:open', false)">取消</TxButton>
        <TxButton variant="primary" :disabled="!dirty" :loading="save.pending.value" @click="submit">{{ dirty ? "保存" : "没有修改" }}</TxButton>
      </div>
    </template>
  </TxModal>
</template>

<style scoped>
.title-form {
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
.preview__label {
  font-size: 12px;
  color: var(--tx-text-color-secondary);
}
.preview__tag {
  font-size: 12px;
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
.caps {
  margin-top: 14px;
}
.caps__heading {
  margin: 0;
  font-size: 14px;
  font-weight: 600;
  color: var(--tx-text-color-primary);
}
.caps__intro {
  margin: 2px 0 10px;
  font-size: 13px;
  line-height: 20px;
  color: var(--tx-text-color-secondary);
}
.caps__group {
  margin: 0 0 10px;
  padding: 4px 12px 8px;
  border: 1px solid var(--tx-border-color-light);
  border-radius: var(--tx-border-radius-base);
}
.caps__group legend {
  padding: 0 4px;
  font-size: 12px;
  font-weight: 600;
  color: var(--tx-text-color-regular);
}
.caps__row {
  display: grid;
  grid-template-columns: minmax(0, 1fr) 48px;
  align-items: center;
  gap: 8px;
  padding: 6px 0;
  border-top: 1px solid var(--tx-border-color-extra-light);
}
.caps__row:first-of-type {
  border-top: 0;
}
.caps__row > :deep(.tx-checkbox) {
  justify-self: center;
}
.caps__label {
  display: flex;
  flex-direction: column;
  min-width: 0;
  font-size: 14px;
  color: var(--tx-text-color-primary);
}
.caps__desc {
  font-size: 12px;
  color: var(--tx-text-color-secondary);
}
.title-form__state {
  margin-top: 12px;
}
.dialog-actions {
  display: flex;
  justify-content: flex-end;
  gap: 8px;
}
</style>

<script setup lang="ts">
import { computed, ref, watch } from "vue";
import { TxCard } from "@talex-touch/tuffex/card";
import { TxForm, TxFormItem } from "@talex-touch/tuffex/form";
import { TxInput } from "@talex-touch/tuffex/input";
import { TxTextarea } from "@talex-touch/tuffex/textarea";
import { TxSelect } from "@talex-touch/tuffex/select";
import { TxCheckbox } from "@talex-touch/tuffex/checkbox";
import { TxButton } from "@talex-touch/tuffex/button";
import { TxAlert } from "@talex-touch/tuffex/alert";
import { TxAvatar } from "@talex-touch/tuffex/avatar";
import { toast } from "@talex-touch/tuffex/utils";
import PageHeader from "../../components/PageHeader.vue";
import ErrorPanel from "../../components/ErrorPanel.vue";
import ErrorAlert from "../../components/ErrorAlert.vue";
import LoadingBlock from "../../components/LoadingBlock.vue";
import { api, jsonBody } from "../../lib/http";
import { useOrg } from "../../lib/github";
import { MEMBER_FIELDS, PERMISSION_OPTIONS, TEXT_FIELDS, changedFields, type OrgSettings } from "../../lib/org-settings";
import { useAction, useResource } from "../../lib/resource";

const { org, apiBase, can } = useOrg();
const canEdit = computed(() => can("github.org.manage"));
const info = useResource(() => api<OrgSettings>(`${apiBase.value}/org`), [apiBase]);

/** 草稿是一份完整副本；与原值比较得出改动，改回原值就不算修改。 */
const draft = ref<OrgSettings>({});
watch(() => info.data.value, data => { draft.value = data ? { ...data } : {}; }, { immediate: true });
const changes = computed(() => (info.data.value ? changedFields(info.data.value, draft.value) : {}));
const changeCount = computed(() => Object.keys(changes.value).length);

const text = (key: string) => String(draft.value[key] ?? "");
const setField = (key: string, value: unknown) => { draft.value = { ...draft.value, [key]: value }; };

const save = useAction(async () => {
  await api(`${apiBase.value}/org`, { method: "PATCH", ...jsonBody(changes.value) });
  toast({ title: "组织资料已保存", description: `${changeCount.value} 项修改`, variant: "success" });
  await info.reload();
});
const reset = () => { if (info.data.value) draft.value = { ...info.data.value }; save.reset(); };
const settingsUrl = computed(() => `https://github.com/organizations/${org.value}/settings/profile`);
</script>

<template>
  <div class="page">
    <ErrorPanel v-if="info.error.value" :error="info.error.value" :retry="info.reload" />
    <LoadingBlock v-else-if="!info.data.value" :lines="10" />
    <template v-else>
      <PageHeader title="组织资料" :description="canEdit ? '修改会直接写到 GitHub 组织设置。' : '只读。修改需要「修改组织资料」权限。'">
        <template #meta>
          <p class="org-line">
            <TxAvatar :src="(info.data.value.avatar_url as string | null) ?? undefined" :name="org" :size="20" shape="rounded" />
            <span class="mono">@{{ info.data.value.login }}</span>
          </p>
        </template>
      </PageHeader>

      <TxForm :model="draft" label-position="top" :disabled="!canEdit" class="settings" @submit="changeCount && save.execute()">
        <TxCard>
          <template #header><h2 class="section-title">基本资料</h2></template>
          <div class="form-grid">
            <TxFormItem v-for="field in TEXT_FIELDS" :key="field.key" :label="field.label" :class="{ wide: field.wide }">
              <TxTextarea v-if="field.wide" :model-value="text(field.key)" :rows="2" :disabled="!canEdit" @update:model-value="(v: string) => setField(field.key, v)" />
              <TxInput v-else :model-value="text(field.key)" :placeholder="field.placeholder ?? ''" :disabled="!canEdit" @update:model-value="(v: string | number) => setField(field.key, String(v))" />
            </TxFormItem>
          </div>
        </TxCard>

        <TxCard>
          <template #header><h2 class="section-title">成员权限</h2></template>
          <div class="form-grid">
            <TxFormItem label="成员对所有仓库的默认权限" class="wide">
              <TxSelect
                :model-value="text('default_repository_permission') || 'read'"
                :options="PERMISSION_OPTIONS"
                :disabled="!canEdit"
                class="permission-select"
                @update:model-value="(v: string | number | Array<string | number>) => setField('default_repository_permission', v)"
              />
            </TxFormItem>
          </div>
          <div class="checks">
            <div v-for="field in MEMBER_FIELDS" :key="field.key" class="check">
              <TxCheckbox
                :model-value="Boolean(draft[field.key])"
                :label="field.label"
                :disabled="!canEdit"
                @update:model-value="(v: boolean) => setField(field.key, v)"
              />
              <span v-if="field.hint" class="check__hint">{{ field.hint }}</span>
            </div>
          </div>
        </TxCard>

        <TxCard>
          <template #header><h2 class="section-title">要到 GitHub 上修改的</h2></template>
          <p class="muted external">组织的登录名（地址里的那段）和头像不能通过接口修改。<a :href="settingsUrl" target="_blank" rel="noreferrer">打开 GitHub 组织设置</a></p>
        </TxCard>

        <div v-if="canEdit" class="save-bar">
          <ErrorAlert v-if="save.error.value" :error="save.error.value" class="save-bar__error" @close="save.reset()" />
          <TxAlert v-else-if="changeCount" type="info" :closable="false" :message="`有 ${changeCount} 项修改还没保存。`" class="save-bar__note" />
          <span v-else class="muted save-bar__note">没有修改</span>
          <div class="save-bar__actions">
            <TxButton variant="secondary" :disabled="!changeCount || save.pending.value" @click="reset">放弃修改</TxButton>
            <TxButton variant="primary" native-type="submit" :disabled="!changeCount" :loading="save.pending.value">
              {{ changeCount ? `保存 ${changeCount} 项修改` : "无修改" }}
            </TxButton>
          </div>
        </div>
      </TxForm>
    </template>
  </div>
</template>

<style scoped>
.org-line {
  display: flex;
  align-items: center;
  gap: 8px;
  margin: 6px 0 0;
}
.settings {
  display: flex;
  flex-direction: column;
  gap: 16px;
}
.permission-select {
  width: min(360px, 100%);
}
.checks {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 4px 24px;
  margin-top: 8px;
}
.check {
  display: flex;
  align-items: center;
  gap: 8px;
  min-height: 40px;
  padding: 4px 8px;
  border-radius: var(--tx-border-radius-base);
}
.check:hover {
  background: var(--tx-fill-color-lighter);
}
.check__hint {
  font-size: 12px;
  color: var(--tx-color-warning);
}
.external {
  margin: 0;
}
.save-bar {
  position: sticky;
  bottom: 12px;
  z-index: 5;
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 12px;
  padding: 12px 16px;
  background: var(--tx-bg-color);
  border: 1px solid var(--tx-border-color-light);
  border-radius: 12px;
  box-shadow: var(--tx-elevation-3, 0 4px 14px rgba(0, 0, 0, 0.06));
}
.save-bar__note,
.save-bar__error {
  flex: 1 1 240px;
  min-width: 0;
}
.save-bar__actions {
  display: flex;
  gap: 8px;
  margin-left: auto;
}
@media (max-width: 900px) {
  .checks {
    grid-template-columns: minmax(0, 1fr);
  }
}
</style>

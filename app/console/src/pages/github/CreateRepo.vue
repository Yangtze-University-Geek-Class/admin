<script setup lang="ts">
import { computed, reactive, ref } from "vue";
import { useRouter } from "vue-router";
import { TxCard } from "@talex-touch/tuffex/card";
import { TxForm, TxFormItem } from "@talex-touch/tuffex/form";
import { TxInput } from "@talex-touch/tuffex/input";
import { TxTextarea } from "@talex-touch/tuffex/textarea";
import { TxSelect } from "@talex-touch/tuffex/select";
import { TxRadioGroup, TxRadio } from "@talex-touch/tuffex/radio";
import { TxSwitch } from "@talex-touch/tuffex/switch";
import { TxButton } from "@talex-touch/tuffex/button";
import { toast } from "@talex-touch/tuffex/utils";
import PageHeader from "../../components/PageHeader.vue";
import ErrorAlert from "../../components/ErrorAlert.vue";
import { api, jsonBody } from "../../lib/http";
import { REPO_NAME, useOrg } from "../../lib/github";
import { useAction } from "../../lib/resource";

const router = useRouter();
const { org, apiBase, base } = useOrg();
const form = reactive({ name: "", description: "", visibility: "private" as "private" | "public", auto_init: true, gitignore_template: "", license_template: "" });
const touched = ref(false);
const nameValid = computed(() => REPO_NAME.test(form.name.trim()));

const GITIGNORE = ["", "Node", "Python", "Go", "Rust", "Java", "Kotlin", "Swift", "C", "C++", "VisualStudio", "Unity", "Android"];
const gitignoreOptions = GITIGNORE.map(value => ({ value, label: value || "不添加" }));
const licenseOptions = [
  { value: "", label: "不添加" }, { value: "mit", label: "MIT" }, { value: "apache-2.0", label: "Apache 2.0" },
  { value: "gpl-3.0", label: "GPL 3.0" }, { value: "bsd-3-clause", label: "BSD 3-Clause" }, { value: "mpl-2.0", label: "Mozilla Public License 2.0" },
  { value: "unlicense", label: "Unlicense" },
];

const create = useAction(async () => {
  const result = await api<{ repo: { name: string } }>(`${apiBase.value}/create-repo`, {
    method: "POST",
    ...jsonBody({ ...form, name: form.name.trim(), description: form.description.trim() }),
  });
  toast({ title: "仓库已创建", description: result.repo.name, variant: "success" });
  void router.push(`${base}/repos/${result.repo.name}`);
});
function submit() {
  touched.value = true;
  if (nameValid.value) void create.execute();
}
</script>

<template>
  <div class="page narrow">
    <PageHeader title="新建仓库" :crumbs="[{ label: '仓库', to: `${base}/repos` }, { label: '新建仓库' }]" description="仓库会建在极客班的 GitHub 组织下。" />

    <TxCard>
      <TxForm :model="form" label-position="top" class="repo-form" @submit="submit">
        <TxFormItem label="仓库名" required>
          <div class="name-row">
            <span class="mono muted">{{ org }}/</span>
            <TxInput v-model="form.name" placeholder="my-project" class="name-input" autocomplete="off" spellcheck="false" />
          </div>
          <span class="field-hint" :class="{ 'field-error': touched && !nameValid }">只能用字母、数字、点、下划线和连字符。</span>
        </TxFormItem>
        <TxFormItem label="说明（选填）">
          <TxTextarea v-model="form.description" :rows="2" />
        </TxFormItem>
        <TxFormItem label="可见性">
          <TxRadioGroup v-model="form.visibility" type="card" direction="row">
            <TxRadio value="private" label="私有：只有组织成员能看到" />
            <TxRadio value="public" label="公开：所有人都能看到和 fork" />
          </TxRadioGroup>
        </TxFormItem>
        <TxFormItem label="初始化">
          <TxSwitch v-model="form.auto_init" label="创建 README（关闭后仓库为空，需要从本地推送）" />
        </TxFormItem>
        <div class="form-grid">
          <TxFormItem label=".gitignore 模板">
            <TxSelect v-model="form.gitignore_template" :options="gitignoreOptions" class="fill-width" />
          </TxFormItem>
          <TxFormItem label="许可证">
            <TxSelect v-model="form.license_template" :options="licenseOptions" class="fill-width" />
          </TxFormItem>
        </div>
        <ErrorAlert v-if="create.error.value" :error="create.error.value" @close="create.reset()" />
        <div class="actions">
          <TxButton variant="secondary" @click="router.push(`${base}/repos`)">取消</TxButton>
          <TxButton variant="primary" native-type="submit" :loading="create.pending.value">创建仓库</TxButton>
        </div>
      </TxForm>
    </TxCard>
  </div>
</template>

<style scoped>
.narrow {
  max-width: 760px;
}
.repo-form {
  display: flex;
  flex-direction: column;
  gap: 4px;
}
.name-row {
  display: flex;
  align-items: center;
  gap: 6px;
  min-width: 0;
}
.name-input {
  flex: 1;
  min-width: 0;
}
.name-input :deep(input) {
  font-family: var(--console-mono);
}
.field-hint {
  font-size: 12px;
  color: var(--tx-text-color-secondary);
}
.field-error {
  color: var(--tx-color-danger);
}
.actions {
  display: flex;
  justify-content: flex-end;
  gap: 8px;
  margin-top: 8px;
}
@media (max-width: 520px) {
  .name-row {
    flex-direction: column;
    align-items: stretch;
  }
}
</style>

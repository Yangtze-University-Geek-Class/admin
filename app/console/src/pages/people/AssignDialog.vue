<script setup lang="ts">
import { computed, ref, watch } from "vue";
import { TxModal } from "@talex-touch/tuffex/modal";
import { TxForm, TxFormItem } from "@talex-touch/tuffex/form";
import { TxInput } from "@talex-touch/tuffex/input";
import { TxSelect } from "@talex-touch/tuffex/select";
import { TxButton } from "@talex-touch/tuffex/button";
import { toast } from "@talex-touch/tuffex/utils";
import ErrorAlert from "../../components/ErrorAlert.vue";
import { api, jsonBody } from "../../lib/http";
import { confirm } from "../../lib/confirm";
import { GITHUB_LOGIN } from "../../lib/people";
import { useAction } from "../../lib/resource";
import type { AssignableRole, Department } from "../../lib/types";

/**
 * 添加称号。舰长能指派全部称号（「舰长」一项只有现任舰长能选，等于移交）；
 * 只管本部门的队长只能把人设为本部门舰员。服务端会用你自己的 GitHub 授权核对用户名是否存在。
 */
const props = defineProps<{
  open: boolean;
  departments: Department[];
  scope: "all" | string[];
  canAssignCaptain: boolean;
  captain: string | null;
}>();
const emit = defineEmits<{ "update:open": [value: boolean]; done: [] }>();

const limited = computed(() => props.scope !== "all");
const allowedDepartments = computed(() => {
  const active = props.departments.filter(d => !d.archived);
  return limited.value ? active.filter(d => (props.scope as string[]).includes(d.id)) : active;
});

type RoleChoice = AssignableRole | "crew";
const roleOptions = computed(() => limited.value
  ? [{ value: "crew", label: "部门舰员" }]
  : [
    ...(props.canAssignCaptain ? [{ value: "captain", label: "舰长", description: props.captain ? "移交后你不再是舰长" : "指定正式舰长" }] : []),
    { value: "head", label: "队长" },
    { value: "crew", label: "部门舰员" },
    { value: "member", label: "舰员", description: "不属于任何部门" },
    { value: "alumni", label: "领航员", description: "已毕业的学长学姐" },
  ]);

const login = ref("");
const role = ref<RoleChoice>("crew");
const department = ref("");
const note = ref("");
const touched = ref(false);

watch(() => props.open, open => {
  if (!open) return;
  login.value = "";
  note.value = "";
  touched.value = false;
  role.value = limited.value ? "crew" : "head";
  department.value = allowedDepartments.value[0]?.id ?? "";
  create.reset();
});

const needsDepartment = computed(() => role.value === "head" || role.value === "crew");
const loginValid = computed(() => GITHUB_LOGIN.test(login.value.trim()));
const departmentOptions = computed(() => allowedDepartments.value.map(d => ({ value: d.id, label: d.name })));
const canSubmit = computed(() => loginValid.value && (!needsDepartment.value || Boolean(department.value)));

const create = useAction(async () => {
  const apiRole: AssignableRole = role.value === "crew" ? "member" : role.value;
  await api("/api/console/assignments", {
    method: "POST",
    ...jsonBody({
      github_login: login.value.trim(),
      role: apiRole,
      ...(needsDepartment.value ? { department_id: department.value } : {}),
      ...(note.value.trim() ? { note: note.value.trim() } : {}),
    }),
  });
  toast({ title: "已添加称号", description: `@${login.value.trim()}`, variant: "success" });
  emit("done");
  emit("update:open", false);
});

async function submit() {
  touched.value = true;
  if (!canSubmit.value) return;
  if (role.value === "captain" && props.captain) {
    const ok = await confirm({
      title: `把舰长移交给 @${login.value.trim()}？`,
      body: "移交后你不再是舰长，会失去管理称号与部门等全部舰长权限。",
      confirmText: "确认移交",
      danger: true,
    });
    if (!ok) return;
  }
  await create.execute();
}
</script>

<template>
  <TxModal :model-value="open" title="添加称号" width="min(92vw, 520px)" @update:model-value="value => emit('update:open', value)">
    <TxForm :model="{ login, role, department, note }" label-position="top" class="assign-form" @submit="submit">
      <TxFormItem label="GitHub 用户名" required>
        <template #default="field">
          <TxInput
            v-bind="field"
            v-model="login"
            class="mono-input"
            placeholder="例如 octocat"
            autocomplete="off"
            spellcheck="false"
            :aria-invalid="touched && !loginValid"
          />
          <span v-if="touched && !loginValid" class="field-error">只能包含字母、数字和单个连字符，不超过 39 个字符。</span>
        </template>
      </TxFormItem>
      <div class="form-grid">
        <TxFormItem label="称号">
          <TxSelect v-model="role" :options="roleOptions" class="fill-width" :disabled="limited" />
        </TxFormItem>
        <TxFormItem label="部门">
          <TxSelect
            v-if="needsDepartment"
            v-model="department"
            :options="departmentOptions"
            placeholder="选择部门"
            class="fill-width"
            :status="touched && !department ? 'error' : 'default'"
          />
          <TxInput v-else model-value="不属于部门" disabled />
        </TxFormItem>
      </div>
      <TxFormItem label="备注（选填）">
        <TxInput v-model="note" placeholder="例如：负责面试排期" :maxlength="200" />
      </TxFormItem>
      <ErrorAlert v-if="create.error.value" :error="create.error.value" @close="create.reset()" />
    </TxForm>
    <template #footer>
      <div class="dialog-actions">
        <TxButton variant="secondary" @click="emit('update:open', false)">取消</TxButton>
        <TxButton variant="primary" :loading="create.pending.value" @click="submit">添加</TxButton>
      </div>
    </template>
  </TxModal>
</template>

<style scoped>
.assign-form {
  display: flex;
  flex-direction: column;
  gap: 4px;
}
.mono-input :deep(input) {
  font-family: var(--console-mono);
}
.field-error {
  font-size: 12px;
  color: var(--tx-color-danger);
}
.dialog-actions {
  display: flex;
  justify-content: flex-end;
  gap: 8px;
}
</style>

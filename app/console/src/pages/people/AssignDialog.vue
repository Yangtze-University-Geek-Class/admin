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
import { useSession } from "../../lib/session";
import { kindLabel, titleDef, titleLabel } from "../../lib/titles";
import type { AssignableRole, Department } from "../../lib/types";

/**
 * 添加称号。能管理全部称号的人能指派 captain 以外的全部称号；captain 一项只有 admin 和现任 captain 能选，
 * 已有 captain 时等于移交。只管本部门的人只能把人设为本部门的 crew。称号名字取 catalogue。
 * 服务端会用你自己的 GitHub 授权核对用户名是否存在。`initialLogin` 给了就预先填好用户名（从名单某一行打开时）。
 */
const props = withDefaults(defineProps<{
  open: boolean;
  departments: Department[];
  scope: "all" | string[];
  canAssignCaptain: boolean;
  captain: string | null;
  initialLogin?: string | null;
}>(), { initialLogin: null });
const emit = defineEmits<{ "update:open": [value: boolean]; done: [] }>();
const { me, catalogue } = useSession();
const label = (id: Parameters<typeof titleLabel>[0]) => titleLabel(id, catalogue.value);
/** 自己就是现任 captain：选 captain 等于把它交出去。 */
const selfIsCaptain = computed(() => Boolean(props.captain && me.value && props.captain.toLowerCase() === me.value.login.toLowerCase()));

const limited = computed(() => props.scope !== "all");
const allowedDepartments = computed(() => {
  const active = props.departments.filter(d => !d.archived);
  return limited.value ? active.filter(d => (props.scope as string[]).includes(d.id)) : active;
});

type RoleChoice = AssignableRole | "crew";
function captainHint(): string {
  if (!props.captain) return `现在没有${label("captain")}`;
  return selfIsCaptain.value ? `移交后你不再是${label("captain")}` : `现任是 @${props.captain}，指定后由新人接任`;
}
const roleOptions = computed(() => limited.value
  ? [{ value: "crew", label: kindLabel("crew", catalogue.value) }]
  : [
    ...(props.canAssignCaptain ? [{ value: "captain", label: label("captain"), description: captainHint() }] : []),
    { value: "head", label: label("head") },
    { value: "crew", label: kindLabel("crew", catalogue.value) },
    { value: "member", label: label("member"), description: "不属于任何部门" },
    { value: "alumni", label: label("alumni"), description: titleDef("alumni", catalogue.value).description || undefined },
  ]);

const login = ref("");
const role = ref<RoleChoice>("crew");
const department = ref("");
const note = ref("");
const touched = ref(false);

watch(() => props.open, open => {
  if (!open) return;
  login.value = props.initialLogin ?? "";
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
    const captain = label("captain");
    const ok = await confirm(selfIsCaptain.value
      ? {
        title: `把${captain}移交给 @${login.value.trim()}？`,
        body: `移交后你不再是${captain}，会失去${captain}的全部权限。`,
        confirmText: "确认移交",
        danger: true,
      }
      : {
        title: `让 @${login.value.trim()} 接任${captain}？`,
        body: `现任 @${props.captain} 会同时失去${captain}称号和它带来的权限。`,
        confirmText: "确认接任",
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

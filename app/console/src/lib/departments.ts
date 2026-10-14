// 部门的编辑规则。纯函数，tests/console 直接测。
// 服务端是唯一来源：id 与 tag 的形状、名字与说明的长度、图标与色调的取值范围在 app/server/src/lib/roles.ts 与
// app/server/src/routes/console/contracts.ts 里校验；这里只做提交前的同规则预检，不新增规则。
import type { Capability, Catalogue, Department, DepartmentInput, DepartmentPatch, Tone } from "./types";

/** 与服务端 DEPARTMENT_ID_PATTERN 一致；id 是主键，建立后不能改。 */
export const DEPARTMENT_ID_RE = /^[a-z][a-z0-9-]{1,31}$/;
/** 与服务端 DEPARTMENT_TAG_PATTERN 一致。 */
export const DEPARTMENT_TAG_RE = /^[A-Z][A-Z0-9-]{1,15}$/;
/** 与服务端 contracts.ts 的 text(12, 2) / text(200) / integer(0, 10000) 一致。 */
export const DEPARTMENT_NAME_MIN = 2;
export const DEPARTMENT_NAME_MAX = 12;
export const DEPARTMENT_DESCRIPTION_MAX = 200;
export const DEPARTMENT_SORT_ORDER_MAX = 10000;
/** 新建时没填排序用这个值（服务端 insertDepartment 的默认值）。 */
export const DEPARTMENT_SORT_ORDER_DEFAULT = 100;

export type DepartmentDraft = {
  id: string; name: string; tag: string; icon: string; tone: Tone; description: string; sort_order: number;
  head_capabilities: Capability[]; member_capabilities: Capability[];
};
export type DepartmentDraftErrors = Partial<Record<"id" | "name" | "tag" | "icon" | "tone" | "description" | "sort_order", string>>;

/** 按字符（码点）计数，与服务端 JSON Schema 的 maxLength 一致。 */
const charCount = (value: string) => [...value].length;
/** 权限包按清单顺序排列，去掉清单外的与重复的。 */
const orderedBundle = (values: readonly Capability[], order: readonly Capability[]) => order.filter(id => values.includes(id));
/** 权限包按集合比较，顺序不算改动。 */
const sameBundle = (a: readonly Capability[], b: readonly Capability[]) => a.length === b.length && b.every(id => a.includes(id));

/** 新建时的空草稿：图标留空（必须选一个），色调取石板灰。 */
export const emptyDepartmentDraft = (): DepartmentDraft => ({
  id: "", name: "", tag: "", icon: "", tone: "slate", description: "",
  sort_order: DEPARTMENT_SORT_ORDER_DEFAULT, head_capabilities: [], member_capabilities: [],
});

/** 编辑时的初始草稿：取这条部门当前的设置。 */
export function departmentDraftOf(department: Department): DepartmentDraft {
  const { id, name, tag, icon, tone, description, sort_order, head_capabilities, member_capabilities } = department;
  return {
    id, name, tag, icon, tone, description, sort_order,
    head_capabilities: [...head_capabilities], member_capabilities: [...member_capabilities],
  };
}

/** 与初始草稿相比有没有改动：文字忽略首尾空白，权限包按集合比较。 */
export function departmentChanged(original: DepartmentDraft, draft: DepartmentDraft): boolean {
  for (const key of ["name", "tag", "description"] as const) if (draft[key].trim() !== original[key].trim()) return true;
  if (draft.icon !== original.icon || draft.tone !== original.tone || draft.sort_order !== original.sort_order) return true;
  return !sameBundle(original.head_capabilities, draft.head_capabilities) || !sameBundle(original.member_capabilities, draft.member_capabilities);
}

/** 提交前按服务端的校验规则检查。编辑时 id 不能改，不校验。 */
export function departmentDraftErrors(
  draft: DepartmentDraft,
  catalogue: Pick<Catalogue, "department_icons" | "tones">,
  options: { editing: boolean },
): DepartmentDraftErrors {
  const errors: DepartmentDraftErrors = {};
  if (!options.editing && !DEPARTMENT_ID_RE.test(draft.id.trim())) errors.id = "以小写字母开头，2 到 32 位，只能用小写字母、数字和连字符。";
  const name = draft.name.trim();
  if (!name) errors.name = "名字不能为空。";
  else if (charCount(name) < DEPARTMENT_NAME_MIN) errors.name = `名字至少 ${DEPARTMENT_NAME_MIN} 个字。`;
  else if (charCount(name) > DEPARTMENT_NAME_MAX) errors.name = `名字最多 ${DEPARTMENT_NAME_MAX} 个字。`;
  if (!DEPARTMENT_TAG_RE.test(draft.tag.trim())) errors.tag = "以大写字母开头，2 到 16 位，只能用大写字母、数字和连字符。";
  if (!catalogue.department_icons.includes(draft.icon)) errors.icon = "请选择一个图标。";
  if (!Object.prototype.hasOwnProperty.call(catalogue.tones, draft.tone)) errors.tone = "请选择一个色调。";
  if (charCount(draft.description.trim()) > DEPARTMENT_DESCRIPTION_MAX) errors.description = `说明最多 ${DEPARTMENT_DESCRIPTION_MAX} 个字。`;
  if (!Number.isInteger(draft.sort_order) || draft.sort_order < 0 || draft.sort_order > DEPARTMENT_SORT_ORDER_MAX) {
    errors.sort_order = `排序用 0 到 ${DEPARTMENT_SORT_ORDER_MAX} 的整数。`;
  }
  return errors;
}

/** POST /api/console/departments 的正文：文字去首尾空白，权限包按清单顺序排列。 */
export function departmentBody(draft: DepartmentDraft, order: readonly Capability[]): DepartmentInput {
  return {
    id: draft.id.trim(),
    name: draft.name.trim(),
    tag: draft.tag.trim(),
    icon: draft.icon,
    tone: draft.tone,
    description: draft.description.trim(),
    sort_order: draft.sort_order,
    head_capabilities: orderedBundle(draft.head_capabilities, order),
    member_capabilities: orderedBundle(draft.member_capabilities, order),
  };
}

/** PATCH 只提交改动的字段（服务端要求至少一项）。id 不提交：它是主键，服务端也不接受。 */
export function departmentPatch(original: DepartmentDraft, draft: DepartmentDraft, order: readonly Capability[]): DepartmentPatch {
  const patch: DepartmentPatch = {};
  for (const key of ["name", "tag", "description"] as const) {
    const value = draft[key].trim();
    if (value !== original[key]) patch[key] = value;
  }
  if (draft.icon !== original.icon) patch.icon = draft.icon;
  if (draft.tone !== original.tone) patch.tone = draft.tone;
  if (draft.sort_order !== original.sort_order) patch.sort_order = draft.sort_order;
  if (!sameBundle(original.head_capabilities, draft.head_capabilities)) patch.head_capabilities = orderedBundle(draft.head_capabilities, order);
  if (!sameBundle(original.member_capabilities, draft.member_capabilities)) patch.member_capabilities = orderedBundle(draft.member_capabilities, order);
  return patch;
}

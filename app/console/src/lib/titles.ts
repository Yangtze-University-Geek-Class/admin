// 称号的显示：徽章色调、指派行对应的称号。纯函数，tests/console 直接测。
import type { Assignment, Catalogue, Department, DepartmentView, Tone, TitleId, TitleView } from "./types";

/** 服务端 roles.ts 的 TONES；catalogue 还没加载时用它兜底，避免徽章闪成默认蓝。 */
export const FALLBACK_TONES: Record<Tone, string> = {
  amber: "#855700", cobalt: "#3346C8", violet: "#6E44C9", jade: "#18694A",
  sky: "#08609A", coral: "#A63F16", rose: "#B4235A", slate: "#5B6475",
};

export const toneColor = (tone: Tone, catalogue?: Catalogue | null) => catalogue?.tones[tone] ?? FALLBACK_TONES[tone];

/** 名单里的称号类别：带部门的 member 是「部门舰员」，不带的是「舰员」。 */
export type PeopleKind = "captain" | "head" | "crew" | "member" | "alumni";

export function kindOf(row: Pick<Assignment, "role" | "department_id">): PeopleKind {
  if (row.role === "member") return row.department_id ? "crew" : "member";
  return row.role;
}

/** 名单里称号徽章的短名：部门另起一列显示，所以队长、舰员不重复部门名。 */
export const KIND_LABEL: Record<PeopleKind, string> = {
  captain: "舰长", head: "队长", crew: "部门舰员", member: "舰员", alumni: "领航员",
};

const deptView = (department: Department | undefined): DepartmentView | null =>
  department ? { id: department.id, name: department.name, tag: department.tag, icon: department.icon, tone: department.tone } : null;

/** 按指派行拼出与服务端 computeAccess 一致的称号。 */
export function titleOf(row: Assignment, departments: Department[], catalogue?: Catalogue | null): TitleView {
  const department = departments.find(item => item.id === row.department_id);
  const base = catalogue?.titles.find(item => item.id === row.role);
  const common = { source: "assignment" as const, assignment_id: row.id, department: deptView(department) };
  if (row.role === "head") {
    return { ...common, id: "head", label: `${department?.name ?? "部门"} · 队长`, tag: "LEADER", icon: department?.icon ?? "badge", tone: department?.tone ?? "cobalt" };
  }
  if (row.role === "member" && department) {
    return { ...common, id: "member", label: `${department.name} · 舰员`, tag: catalogue?.crew.tag ?? "CREW", icon: department.icon, tone: catalogue?.crew.tone ?? "slate" };
  }
  return { ...common, id: row.role, label: base?.label ?? KIND_LABEL[kindOf(row)], tag: base?.tag ?? row.role.toUpperCase(), icon: base?.icon ?? "user", tone: base?.tone ?? "slate" };
}

/** 徽章色调：舰长琥珀、队长跟部门走、舰员中性、成员天蓝、领航员紫（都来自 catalogue）。 */
export function badgeTone(title: Pick<TitleView, "id" | "tone" | "department">): Tone {
  if (title.id === "head" && title.department) return title.department.tone;
  return title.tone;
}

/** 名单行的徽章色调，规则同上。 */
export function kindTone(row: Pick<Assignment, "role" | "department_id">, departments: Department[], catalogue?: Catalogue | null): Tone {
  const kind = kindOf(row);
  if (kind === "head") return departments.find(d => d.id === row.department_id)?.tone ?? "cobalt";
  if (kind === "crew") return catalogue?.crew.tone ?? "slate";
  const id: TitleId = row.role;
  return catalogue?.titles.find(t => t.id === id)?.tone ?? ({ captain: "amber", member: "sky", alumni: "violet" } as Record<string, Tone>)[id] ?? "slate";
}

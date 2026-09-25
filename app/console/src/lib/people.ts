// 「成员与权限」名单：按称号分页签，每页一张固定排序的表。纯函数，tests/console 直接测。
import { kindOf, type PeopleKind } from "./titles";
import type { Assignment, Catalogue, Department } from "./types";

export type PeopleTab = "all" | PeopleKind;

/** 页签顺序是所有者给定的：全部 / 舰长 / 队长 / 部门舰员 / 舰员 / 领航员。 */
export const PEOPLE_TABS: { id: PeopleTab; label: string }[] = [
  { id: "all", label: "全部" },
  { id: "captain", label: "舰长" },
  { id: "head", label: "队长" },
  { id: "crew", label: "部门舰员" },
  { id: "member", label: "舰员" },
  { id: "alumni", label: "领航员" },
];

export const isPeopleTab = (value: unknown): value is PeopleTab => PEOPLE_TABS.some(tab => tab.id === value);

/** 服务端 roles.ts 的 rank：舰长 0、队长 1、舰员 2、领航员 3、成员 4。catalogue 未到时用它。 */
const FALLBACK_RANK: Record<PeopleKind, number> = { captain: 0, head: 1, crew: 2, alumni: 3, member: 4 };

export function kindRank(kind: PeopleKind, catalogue?: Catalogue | null): number {
  if (kind === "crew") return catalogue?.crew.rank ?? FALLBACK_RANK.crew;
  return catalogue?.titles.find(title => title.id === kind)?.rank ?? FALLBACK_RANK[kind];
}

/**
 * 排序规则：称号 rank → 部门 sort_order（无部门的排在有部门的前面，已归档或未知部门排最后）→ 登录名。
 * 同一个人有多个称号时各占一行。
 */
export function sortAssignments(rows: Assignment[], departments: Department[], catalogue?: Catalogue | null): Assignment[] {
  const order = new Map(departments.map(d => [d.id, d.archived ? Number.MAX_SAFE_INTEGER - 1 : d.sort_order]));
  const deptOrder = (id: string) => (id === "" ? -1 : order.get(id) ?? Number.MAX_SAFE_INTEGER);
  return [...rows].sort((a, b) =>
    kindRank(kindOf(a), catalogue) - kindRank(kindOf(b), catalogue)
    || deptOrder(a.department_id) - deptOrder(b.department_id)
    || a.github_login.localeCompare(b.github_login, "en", { sensitivity: "base" })
    || a.id - b.id);
}

export function rowsForTab(rows: Assignment[], tab: PeopleTab): Assignment[] {
  return tab === "all" ? rows : rows.filter(row => kindOf(row) === tab);
}

export function tabCounts(rows: Assignment[]): Record<PeopleTab, number> {
  const counts: Record<PeopleTab, number> = { all: rows.length, captain: 0, head: 0, crew: 0, member: 0, alumni: 0 };
  for (const row of rows) counts[kindOf(row)] += 1;
  return counts;
}

/**
 * 显示哪些页签：「全部」总在；舰长能任免所有称号，所以六个都显示；
 * 只管本部门的队长只会拿到本部门的行，只显示有人的页签和「部门舰员」。
 */
export function visibleTabs(rows: Assignment[], canManageAll: boolean): PeopleTab[] {
  if (canManageAll) return PEOPLE_TABS.map(tab => tab.id);
  const counts = tabCounts(rows);
  return PEOPLE_TABS.map(tab => tab.id).filter(id => id === "all" || id === "crew" || counts[id] > 0);
}

/** 谁能撤销哪一行：舰长那行只有本人能卸任；其余行舰长都能撤，队长只能撤本部门舰员。 */
export function mayRevoke(row: Assignment, me: { head_of: string[]; titles: { id: string; assignment_id: number | null }[] }, canManageAll: boolean): boolean {
  if (row.role === "captain") return me.titles.some(title => title.id === "captain" && title.assignment_id === row.id);
  return canManageAll || (row.role === "member" && row.department_id !== "" && me.head_of.includes(row.department_id));
}

export const GITHUB_LOGIN = /^[A-Za-z0-9](?:[A-Za-z0-9]|-(?=[A-Za-z0-9])){0,38}$/;

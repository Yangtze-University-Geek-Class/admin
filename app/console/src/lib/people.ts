// 「成员与权限」名单：每人一行（GET /api/console/people），像飞书通讯录一样按部门分组。纯函数，tests/console 直接测。
import { kindRank, titleKind, type TitleKind } from "./titles";
import type { Assignment, Catalogue, Department, GithubRole, Person } from "./types";

/** 左侧分组的两个固定键。部门 id 只能以小写字母开头（DEPARTMENT_ID_PATTERN），下划线开头的键不会和部门撞上。 */
export const GROUP_ALL = "_all";
export const GROUP_NONE = "_none";
export type PeopleGroup = { key: string; label: string; count: number; department: Department | null };

/** 一个人所在的部门（去重，按称号顺序）。 */
export const departmentIdsOf = (person: Pick<Person, "titles">): string[] =>
  [...new Set(person.titles.map(title => title.department?.id).filter((id): id is string => Boolean(id)))];

const activeDepartments = (departments: Department[]) =>
  departments.filter(department => !department.archived).sort((a, b) => a.sort_order - b.sort_order);

/** 左侧的分组：全部成员、每个未归档的部门（按排序）、不在任何部门的人。 */
export function peopleGroups(people: Person[], departments: Department[]): PeopleGroup[] {
  const active = activeDepartments(departments);
  return [
    { key: GROUP_ALL, label: "全部成员", count: people.length, department: null },
    ...active.map(department => ({
      key: department.id, label: department.name, department,
      count: people.filter(person => departmentIdsOf(person).includes(department.id)).length,
    })),
    { key: GROUP_NONE, label: "没有部门", count: peopleInGroup(people, GROUP_NONE, departments).length, department: null },
  ];
}

/** 某个分组里的人；「没有部门」是不在任何未归档部门里的人。 */
export function peopleInGroup(people: Person[], key: string, departments: Department[]): Person[] {
  if (key === GROUP_ALL) return people;
  if (key === GROUP_NONE) {
    const active = new Set(activeDepartments(departments).map(department => department.id));
    return people.filter(person => !departmentIdsOf(person).some(id => active.has(id)));
  }
  return people.filter(person => departmentIdsOf(person).includes(key));
}

/** 部门的负责人：在这个部门里有 head 称号的人。 */
export const leadsOf = (people: Person[], departmentId: string): Person[] =>
  people.filter(person => person.titles.some(title => title.id === "head" && title.department?.id === departmentId));

/** 持有某个不属于部门的称号（admin、captain）的人。 */
export const holdersOf = (people: Person[], id: "admin" | "captain"): Person[] =>
  people.filter(person => person.titles.some(title => title.id === id));

/** 主称号：服务端已按层级排好，第一个就是；没有称号的人服务端会给 guest。 */
export const primaryKind = (person: Pick<Person, "titles">): TitleKind => (person.titles[0] ? titleKind(person.titles[0]) : "guest");

/**
 * 排序规则：主称号层级 → 主称号所在部门的 sort_order（无部门在前，已归档或未知部门最后）→ 登录名（不分大小写）。
 */
export function sortPeople(people: Person[], departments: Department[], catalogue?: Catalogue | null): Person[] {
  const order = new Map(departments.map(d => [d.id, d.archived ? Number.MAX_SAFE_INTEGER - 1 : d.sort_order]));
  const deptOrder = (person: Person) => {
    const id = person.titles[0]?.department?.id;
    return id === undefined ? -1 : order.get(id) ?? Number.MAX_SAFE_INTEGER;
  };
  return [...people].sort((a, b) =>
    kindRank(primaryKind(a), catalogue) - kindRank(primaryKind(b), catalogue)
    || deptOrder(a) - deptOrder(b)
    || a.login.localeCompare(b.login, "en", { sensitivity: "base" }));
}

type Viewer = { head_of: string[]; titles: { id: string; assignment_id: number | null }[] };

/** 能任命、移交 captain 的人：admin 或现任 captain。 */
export const canAppointCaptain = (me: Pick<Viewer, "titles">) => me.titles.some(title => title.id === "admin" || title.id === "captain");
export const isOwnCaptainRow = (row: Pick<Assignment, "id" | "role">, me: Pick<Viewer, "titles">) =>
  row.role === "captain" && me.titles.some(title => title.id === "captain" && title.assignment_id === row.id);

/**
 * 谁能撤销哪条指派（与服务端一致）：captain 那条只有本人（卸任）或 admin 能撤；
 * 其余能管理全部称号的人都能撤，只管本部门的人只能撤本部门的 crew。
 */
export function mayRevoke(row: Pick<Assignment, "id" | "role" | "department_id">, me: Viewer, canManageAll: boolean): boolean {
  if (row.role === "captain") return isOwnCaptainRow(row, me) || me.titles.some(title => title.id === "admin");
  return canManageAll || (row.role === "member" && row.department_id !== "" && me.head_of.includes(row.department_id));
}

/** GitHub 组织身份的说法。 */
export const GITHUB_ROLE_TEXT: Record<Exclude<GithubRole, null> | "none", string> = { admin: "所有者", member: "成员", none: "不在组织里" };
export const githubRoleText = (role: GithubRole) => GITHUB_ROLE_TEXT[role ?? "none"];

export const GITHUB_LOGIN = /^[A-Za-z0-9](?:[A-Za-z0-9]|-(?=[A-Za-z0-9])){0,38}$/;

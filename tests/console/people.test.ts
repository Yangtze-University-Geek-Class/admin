import { describe, expect, it } from "vitest";
import {
  GROUP_ALL, GROUP_NONE, canAppointCaptain, departmentIdsOf, githubRoleText, holdersOf, isOwnCaptainRow, leadsOf, mayRevoke, peopleGroups, peopleInGroup,
  primaryKind, sortPeople,
} from "../../app/console/src/lib/people";
import {
  DEFAULT_TITLES, assignerText, badgeTone, closure, kindLabel, makeTitle, titleDraftErrors, titleLabel, titlePatch,
} from "../../app/console/src/lib/titles";
import type { Assignment, Catalogue, Department, DepartmentView, Person, TitleConfig, TitleId } from "../../app/console/src/lib/types";

const dept = (id: string, sort_order: number, tone: Department["tone"] = "cobalt", archived = false): Department => ({
  id, name: `${id}-name`, tag: id.toUpperCase(), icon: "code", tone, description: "", head_capabilities: [], member_capabilities: [],
  sort_order, archived, heads: [], crew_count: 0,
});
const departments = [dept("tech", 20, "jade"), dept("recruitment", 10, "coral"), dept("old", 5, "slate", true)];
const view = (id: string): DepartmentView => {
  const d = departments.find(item => item.id === id) ?? dept(id, 0);
  return { id: d.id, name: d.name, tag: d.tag, icon: d.icon, tone: d.tone };
};

/** 与服务端一样按层级排好称号：第一个是主称号。 */
const person = (login: string, titles: [TitleId, string?][], github_role: Person["github_role"] = "member"): Person => ({
  login, user_id: null, avatar_url: null, github_role,
  titles: titles.map(([id, departmentId], index) => makeTitle(id, departmentId ? view(departmentId) : null, null, { source: "assignment", assignment_id: index + 1 })),
});

const people = [
  person("zed", [["member"]]),
  person("amy", [["alumni"]]),
  person("Bob", [["head", "tech"], ["member"]]),
  person("cat", [["member", "tech"], ["member"]]),
  person("dan", [["head", "recruitment"]]),
  person("eve", [["captain"], ["member"]]),
  person("owner", [["admin"]], "admin"),
  person("ann", [["member", "recruitment"]]),
  person("abe", [["member", "tech"]]),
  person("gus", [["head", "old"]]),
  person("fay", [["head", "gone"]]),
  person("left", [["guest"]], null),
];

/** 改过名字的 catalogue：徽章、页签都应跟着变。 */
const renamed = {
  titles: DEFAULT_TITLES.map(t => (t.id === "member" ? { ...t, label: "船员" } : t.id === "captain" ? { ...t, label: "船长", tone: "rose" as const } : t)),
  crew: { tag: "CREW", tone: "slate", rank: 3 },
} as unknown as Catalogue;

describe("sortPeople", () => {
  it("orders by primary title rank, then department sort order, then login (case-insensitive)", () => {
    expect(sortPeople(people, departments).map(p => p.login)).toEqual([
      "owner", // admin（rank 0）
      "eve", // captain
      "dan", "Bob", "gus", "fay", // head：招新部(10) → 技术部(20) → 已归档 → 未知部门
      "ann", "abe", "cat", // crew：招新部 → 技术部（abe < cat）
      "amy", // alumni（rank 4）
      "zed", // member（rank 5）
      "left", // guest（rank 9）
    ]);
  });

  it("does not mutate its input", () => {
    const copy = [...people];
    sortPeople(people, departments);
    expect(people).toEqual(copy);
  });
});

describe("department groups", () => {
  const sorted = sortPeople(people, departments);

  it("lists everyone, then each active department in its order, then people without a department", () => {
    expect(peopleGroups(sorted, departments).map(g => [g.key, g.label, g.count])).toEqual([
      [GROUP_ALL, "全部成员", 12],
      ["recruitment", "recruitment-name", 2], // dan（head）、ann（crew）
      ["tech", "tech-name", 3], // Bob（head）、abe、cat
      [GROUP_NONE, "没有部门", 7], // 已归档（gus）、未知部门（fay）与没有部门的人都算这里
    ]);
    // 固定键不会和部门 id 撞上：部门 id 必须以小写字母开头。
    expect(/^[a-z]/.test(GROUP_ALL) || /^[a-z]/.test(GROUP_NONE)).toBe(false);
  });

  it("files a person under every department they are in, and names who leads it", () => {
    expect(departmentIdsOf(person("x", [["head", "tech"], ["member", "recruitment"], ["member", "tech"]]))).toEqual(["tech", "recruitment"]);
    expect(peopleInGroup(sorted, "tech", departments).map(p => p.login)).toEqual(["Bob", "abe", "cat"]);
    expect(peopleInGroup(sorted, GROUP_NONE, departments).map(p => p.login)).toEqual(["owner", "eve", "gus", "fay", "amy", "zed", "left"]);
    expect(peopleInGroup(sorted, GROUP_ALL, departments)).toHaveLength(people.length);
    expect(leadsOf(sorted, "tech").map(p => p.login)).toEqual(["Bob"]);
    expect(leadsOf(sorted, "projects")).toEqual([]);
    expect(holdersOf(sorted, "captain").map(p => p.login)).toEqual(["eve"]);
    expect(holdersOf(sorted, "admin").map(p => p.login)).toEqual(["owner"]);
  });

  it("files each person under their primary title; crew is a member with a department", () => {
    expect(primaryKind(person("x", [["member", "tech"], ["member"]]))).toBe("crew");
    expect(primaryKind(person("x", [["member"]]))).toBe("member");
    expect(kindLabel("member", renamed)).toBe("船员");
  });
});

describe("revoking and appointing", () => {
  let nextId = 100;
  const row = (github_login: string, role: Assignment["role"], department_id = ""): Assignment =>
    ({ id: nextId++, github_login, github_user_id: null, role, department_id, note: null, granted_by: "someone", created_at: 0 });
  const captainRow = row("eve", "captain");
  const crewRow = row("ann", "member", "recruitment");
  const techCrew = row("cat", "member", "tech");

  it("lets the sitting captain step down and the admin remove the captain; nobody else", () => {
    const self = { head_of: [], titles: [{ id: "captain", assignment_id: captainRow.id }] };
    expect(mayRevoke(captainRow, self, true)).toBe(true);
    expect(isOwnCaptainRow(captainRow, self)).toBe(true);
    const admin = { head_of: [], titles: [{ id: "admin", assignment_id: null }] };
    expect(mayRevoke(captainRow, admin, true)).toBe(true);
    expect(isOwnCaptainRow(captainRow, admin)).toBe(false);
    expect(mayRevoke(captainRow, { head_of: [], titles: [{ id: "captain", assignment_id: null }] }, true)).toBe(false);
    expect(mayRevoke(captainRow, { head_of: ["recruitment"], titles: [{ id: "head", assignment_id: 9 }] }, false)).toBe(false);
  });

  it("lets a department head revoke only their own crew", () => {
    const head = { head_of: ["recruitment"], titles: [{ id: "head", assignment_id: 99 }] };
    expect(mayRevoke(crewRow, head, false)).toBe(true);
    expect(mayRevoke(techCrew, head, false)).toBe(false);
    expect(mayRevoke(row("zed", "alumni"), head, false)).toBe(false);
    expect(mayRevoke(row("zed", "alumni"), { head_of: [], titles: [] }, true)).toBe(true);
  });

  it("lets only the admin or the captain appoint a captain", () => {
    expect(canAppointCaptain({ titles: [{ id: "admin" }] })).toBe(true);
    expect(canAppointCaptain({ titles: [{ id: "captain" }, { id: "member" }] })).toBe(true);
    expect(canAppointCaptain({ titles: [{ id: "head" }, { id: "member" }] })).toBe(false);
  });

  it("describes the GitHub organisation role in plain words", () => {
    expect([githubRoleText("admin"), githubRoleText("member"), githubRoleText(null)]).toEqual(["所有者", "成员", "不在组织里"]);
  });
});

describe("title display", () => {
  it("colours a head by department and crew with the neutral crew tone", () => {
    expect(badgeTone(makeTitle("head", view("tech")))).toBe("jade");
    expect(makeTitle("member", view("tech")).tone).toBe("slate");
    expect(makeTitle("captain", null).tone).toBe("amber");
    expect(makeTitle("member", null).tone).toBe("sky");
    expect(makeTitle("alumni", null).tone).toBe("jade");
    expect(makeTitle("admin", null)).toMatchObject({ tone: "violet", icon: "user-admin" });
  });

  it("builds the same title labels as the server, from the catalogue when it has loaded", () => {
    expect(makeTitle("head", view("tech")).label).toBe("tech-name · 队长");
    expect(makeTitle("head", view("tech")).icon).toBe("code");
    expect(makeTitle("member", view("tech")).label).toBe("tech-name · 舰员");
    expect(makeTitle("alumni", null).label).toBe("领航员");
    expect(makeTitle("member", view("tech"), renamed).label).toBe("tech-name · 船员");
    expect(makeTitle("captain", null, renamed)).toMatchObject({ label: "船长", tone: "rose" });
    expect(titleLabel("captain", renamed)).toBe("船长");
    expect(assignerText()).toBe("提督或舰长");
    expect(assignerText(renamed)).toBe("提督或船长");
  });
});

describe("title editing", () => {
  const original: TitleConfig = {
    id: "alumni", label: "领航员", tag: "NAVIGATOR", icon: "compass", tone: "jade", description: "已毕业的学长学姐",
    capabilities: ["console.access", "github.org.read", "feedback.read"],
  };
  const draft = { ...original, capabilities: [...original.capabilities] };

  it("validates like the server: label 1-8 characters, tag pattern, description up to 200", () => {
    expect(titleDraftErrors(draft)).toEqual({});
    expect(titleDraftErrors({ ...draft, label: "  " }).label).toBeDefined();
    expect(titleDraftErrors({ ...draft, label: "一二三四五六七八" }).label).toBeUndefined();
    expect(titleDraftErrors({ ...draft, label: "一二三四五六七八九" }).label).toBeDefined();
    expect(titleDraftErrors({ ...draft, tag: "navigator" }).tag).toBeDefined();
    expect(titleDraftErrors({ ...draft, tag: "N" }).tag).toBeDefined();
    expect(titleDraftErrors({ ...draft, tag: "NAV-2" }).tag).toBeUndefined();
    expect(titleDraftErrors({ ...draft, tag: "A23456789012345678" }).tag).toBeDefined();
    expect(titleDraftErrors({ ...draft, description: "字".repeat(200) }).description).toBeUndefined();
    expect(titleDraftErrors({ ...draft, description: "字".repeat(201) }).description).toBeDefined();
  });

  it("sends only the fields that changed, trimming text and ignoring bundle order", () => {
    expect(titlePatch(original, draft)).toEqual({});
    expect(titlePatch(original, { ...draft, capabilities: [...original.capabilities].reverse() })).toEqual({});
    expect(titlePatch(original, { ...draft, label: " 学长 ", tone: "sky" })).toEqual({ label: "学长", tone: "sky" });
    expect(titlePatch(original, { ...draft, capabilities: ["console.access"] })).toEqual({ capabilities: ["console.access"] });
  });

  it("closes a bundle over the implies relation", () => {
    const implies = { "github.repos.manage": ["github.org.read"], "roles.manage": ["roles.department.manage"] };
    expect([...closure(["github.repos.manage", "roles.manage"], implies)].sort())
      .toEqual(["github.org.read", "github.repos.manage", "roles.department.manage", "roles.manage"]);
    expect([...closure(["feedback.read"])]).toEqual(["feedback.read"]);
  });
});

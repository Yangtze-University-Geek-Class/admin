import { describe, expect, it } from "vitest";
import { PEOPLE_TABS, mayRevoke, rowsForTab, sortAssignments, tabCounts, visibleTabs } from "../../app/console/src/lib/people";
import { kindOf, kindTone, titleOf } from "../../app/console/src/lib/titles";
import type { Assignment, Department } from "../../app/console/src/lib/types";

const dept = (id: string, sort_order: number, tone: Department["tone"] = "cobalt", archived = false): Department => ({
  id, name: `${id}-name`, tag: id.toUpperCase(), icon: "code", tone, description: "", head_capabilities: [], member_capabilities: [],
  sort_order, archived, heads: [], crew_count: 0,
});
const departments = [dept("tech", 20, "jade"), dept("recruitment", 10, "coral"), dept("old", 5, "slate", true)];

let nextId = 1;
const row = (github_login: string, role: Assignment["role"], department_id = ""): Assignment =>
  ({ id: nextId++, github_login, github_user_id: null, role, department_id, note: null, granted_by: "captain", created_at: 0 });

const rows = [
  row("zed", "member"),
  row("amy", "alumni"),
  row("Bob", "head", "tech"),
  row("cat", "member", "tech"),
  row("dan", "head", "recruitment"),
  row("eve", "captain"),
  row("ann", "member", "recruitment"),
  row("abe", "member", "tech"),
  row("gus", "head", "old"),
  row("fay", "head", "gone"),
];

describe("sortAssignments", () => {
  it("orders by title rank, then department sort order, then login (case-insensitive)", () => {
    const sorted = sortAssignments(rows, departments).map(r => r.github_login);
    expect(sorted).toEqual([
      "eve", // 舰长
      "dan", "Bob", "gus", "fay", // 队长：招新部(10) → 技术部(20) → 已归档 → 未知部门
      "ann", "abe", "cat", // 舰员：招新部 → 技术部（abe < cat）
      "amy", // 领航员（rank 3）
      "zed", // 舰员（rank 4）
    ]);
  });

  it("does not mutate its input", () => {
    const copy = [...rows];
    sortAssignments(rows, departments);
    expect(rows).toEqual(copy);
  });
});

describe("tabs", () => {
  const sorted = sortAssignments(rows, departments);

  it("follows the owner's tab order", () => {
    expect(PEOPLE_TABS.map(t => t.label)).toEqual(["全部", "舰长", "队长", "部门舰员", "舰员", "领航员"]);
  });

  it("splits member rows into crew (with department) and plain members", () => {
    expect(kindOf(row("x", "member", "tech"))).toBe("crew");
    expect(kindOf(row("x", "member"))).toBe("member");
    expect(rowsForTab(sorted, "crew").map(r => r.github_login)).toEqual(["ann", "abe", "cat"]);
    expect(rowsForTab(sorted, "member").map(r => r.github_login)).toEqual(["zed"]);
    expect(rowsForTab(sorted, "all")).toHaveLength(rows.length);
  });

  it("counts every tab", () => {
    expect(tabCounts(sorted)).toEqual({ all: 10, captain: 1, head: 4, crew: 3, member: 1, alumni: 1 });
  });

  it("shows all tabs to the captain and only populated ones plus crew to a department head", () => {
    expect(visibleTabs(sorted, true)).toEqual(["all", "captain", "head", "crew", "member", "alumni"]);
    const ownDept = sorted.filter(r => r.department_id === "recruitment");
    expect(visibleTabs(ownDept, false)).toEqual(["all", "head", "crew"]);
    expect(visibleTabs([], false)).toEqual(["all", "crew"]);
  });
});

describe("mayRevoke", () => {
  const captainRow = rows.find(r => r.role === "captain")!;
  const crewRow = rows.find(r => r.github_login === "ann")!;
  const techCrew = rows.find(r => r.github_login === "cat")!;

  it("lets only the sitting captain step down", () => {
    expect(mayRevoke(captainRow, { head_of: [], titles: [{ id: "captain", assignment_id: captainRow.id }] }, true)).toBe(true);
    expect(mayRevoke(captainRow, { head_of: [], titles: [{ id: "captain", assignment_id: null }] }, true)).toBe(false);
  });
  it("lets a department head revoke only their own crew", () => {
    const head = { head_of: ["recruitment"], titles: [{ id: "head", assignment_id: 99 }] };
    expect(mayRevoke(crewRow, head, false)).toBe(true);
    expect(mayRevoke(techCrew, head, false)).toBe(false);
  });
});

describe("title display", () => {
  it("colours a head by department and crew with the neutral crew tone", () => {
    expect(kindTone(row("x", "head", "tech"), departments)).toBe("jade");
    expect(kindTone(row("x", "member", "tech"), departments)).toBe("slate");
    expect(kindTone(row("x", "captain"), departments)).toBe("amber");
    expect(kindTone(row("x", "member"), departments)).toBe("sky");
    expect(kindTone(row("x", "alumni"), departments)).toBe("violet");
  });
  it("builds the same title labels as the server", () => {
    expect(titleOf(row("x", "head", "tech"), departments).label).toBe("tech-name · 队长");
    expect(titleOf(row("x", "member", "tech"), departments).label).toBe("tech-name · 舰员");
    expect(titleOf(row("x", "alumni"), departments).label).toBe("领航员");
  });
});

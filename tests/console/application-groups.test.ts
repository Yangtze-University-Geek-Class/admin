import { describe, expect, it } from "vitest";
import { listRows, listSummary, overviewApplicationsMeta, reasonLabels, toggleExpanded, totalCount } from "../../app/console/src/lib/application-groups";
import type { ApplicationItem, ApplicationStatus, GroupReason } from "../../app/console/src/lib/types";

/** 投递管理按人合并（#184）的展示：一人一行、展开看历次投递、列表上方的数字。 */

const application = (id: string, status: ApplicationStatus, linked_by: GroupReason[] = [], patch: Partial<ApplicationItem> = {}) => ({
  id, name: "周子涵", class_name: "计科2301", email: `${id}@example.test`, strengths_excerpt: "特长", status, created_at: 0, last_review: null, linked_by, ...patch,
});
function person(key: string, applications: ReturnType<typeof application>[], size = applications.length, reasons: GroupReason[] = ["email"]): ApplicationItem {
  const { linked_by: _linked, ...primary } = applications.find(a => a.status !== "cancelled") ?? applications[0];
  return { ...primary, person: { key, reasons: applications.length > 1 || size > 1 ? reasons : [], size, applications } };
}

describe("listRows", () => {
  const zhou = person("p1", [application("new", "cancelled", ["email"]), application("old", "received", ["email"])]);
  const wu = person("p2", [application("only", "received")]);
  const lin = person("p3", [application("lin", "received", ["email"], { name: "林小" })], 3);

  it("gives one row per person and nothing more while collapsed", () => {
    const rows = listRows([zhou, wu, lin], new Set());
    expect(rows.map(row => row.kind)).toEqual(["person", "person", "person"]);
    expect(rows.map(row => row.kind === "person" && [row.item.id, row.shown, row.expandable, row.hidden])).toEqual([["old", 2, true, 0], ["only", 1, false, 0], ["lin", 1, false, 2]]);
  });

  it("puts every application of an expanded person right under them, newest first", () => {
    const rows = listRows([zhou, wu], new Set(["p1"]));
    expect(rows.map(row => row.key)).toEqual(["person:p1", "history:p1:new", "history:p1:old", "person:p2"]);
    const history = rows.filter(row => row.kind === "history");
    expect(history.map(row => row.kind === "history" && [row.application.status, row.application.linked_by, row.nameDiffers])).toEqual([
      ["cancelled", ["email"], false], ["received", ["email"], false],
    ]);
    expect(rows[0]).toMatchObject({ kind: "person", expanded: true, personKey: "p1" });
  });

  it("does not expand a person with one application even if asked, and flags a different name", () => {
    expect(listRows([wu], new Set(["p2"]))).toHaveLength(1);
    const pair = person("p4", [application("a", "received", ["email"], { name: "林晓" }), application("b", "received", ["email"], { name: "林小" })]);
    const rows = listRows([pair], new Set(["p4"]));
    expect(rows.map(row => row.kind === "history" && row.nameDiffers)).toEqual([false, false, true]);
  });

  it("treats an item from a server without person as a single application", () => {
    const { person: _person, ...bare } = wu;
    const rows = listRows([bare as ApplicationItem], new Set());
    expect(rows).toEqual([expect.objectContaining({ kind: "person", key: "person:only", shown: 1, expandable: false, hidden: 0 })]);
  });
});

describe("toggleExpanded", () => {
  it("opens and closes one person without touching the others or the old set", () => {
    const before = new Set(["p1"]);
    const opened = toggleExpanded(before, "p2");
    expect([...opened].sort()).toEqual(["p1", "p2"]);
    expect([...toggleExpanded(opened, "p1")]).toEqual(["p2"]);
    expect([...before]).toEqual(["p1"]);
  });
});

describe("list wording", () => {
  it("names the merge reasons and keeps unknown ones as they are", () => {
    expect(reasonLabels(["email", "phone"])).toEqual(["同一邮箱", "phone"]);
  });

  it("says how many people and applications the list holds, per filter", () => {
    expect(listSummary({ total: 7, total_applications: 10 }, "", false)).toBe("共 7 个邮箱组、10 份投递");
    expect(listSummary({ total: 1, total_applications: 1 }, "cancelled", false)).toBe("「已取消」：1 个邮箱组、1 份投递");
    expect(listSummary({ total: 1, total_applications: 2 }, "", true)).toBe("搜索结果：1 个邮箱组、2 份投递");
    expect(listSummary({ total: 1, total_applications: 1 }, "received", true)).toBe("「已收到」里的搜索结果：1 个邮箱组、1 份投递");
    expect(listSummary({ total: 3 }, "", false)).toBe("共 3 个邮箱组");
  });

  it("adds up 全部 from every status, cancelled included", () => {
    expect(totalCount({ received: 6, interview: 1, accepted: 1, rejected: 1, cancelled: 1 })).toBe(10);
    expect(totalCount(undefined)).toBe(0);
  });

  it("says on the overview how many cancelled applications its total leaves out", () => {
    const byStatus = { received: 7, interview: 1, accepted: 1, rejected: 1, cancelled: 2 };
    // 概览的 10 份加上不算的 2 份，正好是投递管理「全部」的 12
    expect(overviewApplicationsMeta({ total: 10, last_7d: 9, by_status: byStatus })).toBe("共 10 份，近 7 天 9 份，不算已取消的 2 份");
    expect(10 + byStatus.cancelled).toBe(totalCount(byStatus));
    expect(overviewApplicationsMeta({ total: 4, last_7d: 0, by_status: { received: 4, cancelled: 0 } })).toBe("共 4 份，近 7 天 0 份");
    expect(overviewApplicationsMeta({ total: 4, last_7d: 1, by_status: { received: 4 } })).toBe("共 4 份，近 7 天 1 份");
  });
});

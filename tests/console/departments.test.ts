import { describe, expect, it } from "vitest";
import {
  DEPARTMENT_ID_RE, DEPARTMENT_TAG_RE, departmentBody, departmentChanged, departmentDraftErrors, departmentDraftOf, departmentPatch, emptyDepartmentDraft,
  type DepartmentDraft,
} from "../../app/console/src/lib/departments";
import { CAPABILITY_IDS, DEFAULT_DEPARTMENTS, DEPARTMENT_ICONS, TONE_IDS } from "../../app/server/src/lib/roles";
import type { Catalogue, Department, Tone } from "../../app/console/src/lib/types";

/** 取值范围就是服务端的清单：图标用 DEPARTMENT_ICONS，色调用 TONE_IDS，权限包顺序用 CAPABILITY_IDS。 */
const catalogue: Pick<Catalogue, "department_icons" | "tones"> = {
  department_icons: [...DEPARTMENT_ICONS],
  tones: Object.fromEntries(TONE_IDS.map(id => [id, "#000000"])) as Record<Tone, string>,
};
const order = [...CAPABILITY_IDS];

/** 新建设置网络网安组时的草稿。 */
const draft = (over: Partial<DepartmentDraft> = {}): DepartmentDraft => ({
  ...emptyDepartmentDraft(),
  id: "netsec", name: "网络网安组", tag: "NETSEC", icon: "chart-network", tone: "violet",
  ...over,
});

describe("部门草稿的校验与服务端同一套规则", () => {
  it("填全的草稿没有错误", () => {
    expect(departmentDraftErrors(draft(), catalogue, { editing: false })).toEqual({});
  });

  it("id：小写字母开头，2 到 32 位，只用小写字母、数字和连字符", () => {
    for (const id of ["netsec", "net-sec", "a1"]) expect(DEPARTMENT_ID_RE.test(id), id).toBe(true);
    // 下面是服务端 DEPARTMENT_ID_PATTERN 会拒绝、界面也要拦下的写法。
    for (const id of ["n", "Netsec", "net_sec", "-netsec", "网络", "a".repeat(33)]) {
      expect(DEPARTMENT_ID_RE.test(id), id).toBe(false);
      expect(departmentDraftErrors(draft({ id }), catalogue, { editing: false }).id, id).toBeTruthy();
    }
  });

  it("编辑时不校验 id：它是主键，服务端的 PATCH 也不接受改 id", () => {
    expect(departmentDraftErrors(draft({ id: "" }), catalogue, { editing: true }).id).toBeUndefined();
    expect(departmentDraftErrors(draft({ id: "Netsec" }), catalogue, { editing: true }).id).toBeUndefined();
  });

  it("名字 2 到 12 个字（服务端 text(12, 2)）", () => {
    expect(departmentDraftErrors(draft({ name: "" }), catalogue, { editing: true }).name).toBeTruthy();
    expect(departmentDraftErrors(draft({ name: "网" }), catalogue, { editing: true }).name).toBeTruthy();
    expect(departmentDraftErrors(draft({ name: "网络" }), catalogue, { editing: true }).name).toBeUndefined();
    expect(departmentDraftErrors(draft({ name: "网".repeat(12) }), catalogue, { editing: true }).name).toBeUndefined();
    expect(departmentDraftErrors(draft({ name: "网".repeat(13) }), catalogue, { editing: true }).name).toBeTruthy();
    expect(departmentDraftErrors(draft({ name: "  网络网安组  " }), catalogue, { editing: true }).name).toBeUndefined();
  });

  it("英文标签：大写字母开头，2 到 16 位", () => {
    for (const tag of ["NETSEC", "A1", "AI-2"]) expect(DEPARTMENT_TAG_RE.test(tag), tag).toBe(true);
    for (const tag of ["netsec", "N", "-N", "A".repeat(17)]) {
      expect(DEPARTMENT_TAG_RE.test(tag), tag).toBe(false);
      expect(departmentDraftErrors(draft({ tag }), catalogue, { editing: true }).tag, tag).toBeTruthy();
    }
  });

  it("图标与色调必须在服务端下发的清单里", () => {
    expect(departmentDraftErrors(draft({ icon: "" }), catalogue, { editing: true }).icon).toBeTruthy();
    expect(departmentDraftErrors(draft({ icon: "crown" }), catalogue, { editing: true }).icon).toBeTruthy();
    expect(departmentDraftErrors(draft({ tone: "neon" as Tone }), catalogue, { editing: true }).tone).toBeTruthy();
    expect(departmentDraftErrors(draft({ icon: "chart-network", tone: "violet" }), catalogue, { editing: true })).toEqual({});
  });

  it("说明最多 200 个字（服务端 text(200)）", () => {
    expect(departmentDraftErrors(draft({ description: "说".repeat(200) }), catalogue, { editing: true }).description).toBeUndefined();
    expect(departmentDraftErrors(draft({ description: "说".repeat(201) }), catalogue, { editing: true }).description).toBeTruthy();
  });

  it("排序用 0 到 10000 的整数（服务端 integer(0, 10000)）", () => {
    for (const sort_order of [0, 50, 10000]) {
      expect(departmentDraftErrors(draft({ sort_order }), catalogue, { editing: true }).sort_order, String(sort_order)).toBeUndefined();
    }
    for (const sort_order of [-1, 10001, 1.5]) {
      expect(departmentDraftErrors(draft({ sort_order }), catalogue, { editing: true }).sort_order, String(sort_order)).toBeTruthy();
    }
  });
});

describe("提交正文", () => {
  it("新建：文字去首尾空白，权限包按服务端清单顺序排列、丢掉清单外的", () => {
    const body = departmentBody(draft({
      name: "  网络网安组 ", tag: " NETSEC ", description: " 负责网络安全方向 ",
      head_capabilities: ["forum.topic.pin", "github.org.read", "forum.topic.pin"],
    }), order);
    expect(body).toEqual({
      id: "netsec", name: "网络网安组", tag: "NETSEC", icon: "chart-network", tone: "violet",
      description: "负责网络安全方向", sort_order: emptyDepartmentDraft().sort_order,
      head_capabilities: ["github.org.read", "forum.topic.pin"],
      member_capabilities: [],
    });
  });

  it("编辑：没有改动就是空对象（服务端 PATCH 至少要求一项）", () => {
    const original = departmentDraftOf({ ...DEFAULT_DEPARTMENTS[0], archived: false, heads: [], crew_count: 0 } as Department);
    expect(departmentPatch(original, original, order)).toEqual({});
    expect(departmentChanged(original, original)).toBe(false);
    // 权限包顺序不同不算改动：服务端按集合比对。
    const reordered = { ...original, head_capabilities: [...original.head_capabilities].reverse(), member_capabilities: [...original.member_capabilities].reverse() };
    expect(departmentPatch(original, reordered, order)).toEqual({});
    expect(departmentChanged(original, reordered)).toBe(false);
  });

  it("编辑：只提交改动的字段，且永远不带 id", () => {
    const original = departmentDraftOf({ ...DEFAULT_DEPARTMENTS[0], archived: false, heads: [], crew_count: 0 } as Department);
    const patch = departmentPatch(original, { ...original, name: "招生部", sort_order: 5, id: "hacked" }, order);
    expect(patch).toEqual({ name: "招生部", sort_order: 5 });
    expect(patch).not.toHaveProperty("id");
    expect(departmentChanged(original, { ...original, name: "招生部" })).toBe(true);
  });

  it("编辑：权限包变了才提交这一项", () => {
    const original = departmentDraftOf({ ...DEFAULT_DEPARTMENTS[0], archived: false, heads: [], crew_count: 0 } as Department);
    const patch = departmentPatch(original, { ...original, member_capabilities: ["applications.read"] }, order);
    expect(patch).toEqual({ member_capabilities: ["applications.read"] });
    expect(departmentChanged(original, { ...original, member_capabilities: ["applications.read"] })).toBe(true);
  });
});

describe("草稿的初值", () => {
  it("空草稿：id/名字/标签/图标留空，色调石板灰，排序用服务端默认值", () => {
    expect(emptyDepartmentDraft()).toEqual({
      id: "", name: "", tag: "", icon: "", tone: "slate", description: "",
      sort_order: 100, head_capabilities: [], member_capabilities: [],
    });
  });

  it("编辑的初稿取当前设置，权限包是副本（改草稿不会动列表里的数据）", () => {
    const department = { ...DEFAULT_DEPARTMENTS[0], archived: false, heads: [], crew_count: 0 } as Department;
    const draftOf = departmentDraftOf(department);
    expect(draftOf).toMatchObject({ id: department.id, name: department.name, tag: department.tag, icon: department.icon, tone: department.tone, description: department.description, sort_order: department.sort_order });
    draftOf.head_capabilities.push("audit.read");
    draftOf.member_capabilities.push("feedback.read");
    expect(department.head_capabilities).not.toContain("audit.read");
    expect(department.member_capabilities).not.toContain("feedback.read");
  });
});

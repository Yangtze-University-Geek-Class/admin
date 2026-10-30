// 「权限」页的纯函数（lib/permissions）和开发预览里的简化求值（mock/console），不挂载组件。
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  createGroupInput, emptyEntryDraft, emptyGroupDraft, entryInput, entryNodeLabel, entryValueText, groupForm, groupLabel, groupPatch, groupSections,
  hitSourceText, isMetaNode, knownNode, metaValueText, nodeSelectGroups, nodesByDomain, scopeText, wildcardNodes,
} from "../../app/console/src/lib/permissions";
import { nodeLabel } from "../../app/console/src/lib/permission-nodes";
import { MOCK_GROUPS, MOCK_NODES, routeConsole } from "../../app/console/src/mock/console";
import { mockApi } from "../../app/console/src/mock";
import type { EffectivePermissions, PermissionExplain, PermissionGroupMembersResponse, PermissionGroupsResponse } from "../../app/console/src/lib/types";

afterEach(() => vi.unstubAllGlobals());
const as = (persona: string) => vi.stubGlobal("window", { location: { search: `?__persona=${persona}` } });
const get = <T>(path: string) => routeConsole(new URL(path, "http://mock.local")) as T;
const group = (id: string) => MOCK_GROUPS.find(item => item.id === id)!;
const NOW = Date.UTC(2026, 9, 24, 4);

describe("group list and labels", () => {
  it("sorts 身份 by weight, 部门 by sort, 称号 by department then weight, custom by name", () => {
    const sections = groupSections(MOCK_GROUPS);
    expect(sections.map(section => section.label)).toEqual(["身份", "部门", "称号", "自定义"]);
    expect(sections[0].items.map(item => item.id)).toEqual(["level.visitor", "level.registered", "level.alumni", "level.member"]);
    expect(sections[1].items.map(item => item.id).slice(0, 5)).toEqual(["dept.ai", "dept.algo", "dept.hardware", "dept.security", "dept.management"]);
    expect(sections[2].items.map(item => item.id).slice(0, 4)).toEqual(["title.site.owner", "title.ai.head", "title.ai.deputy", "title.ai.staff"]);
  });
  it("names a title together with its department so several 部长 can be told apart", () => {
    expect(groupLabel(group("title.ai.head"), MOCK_GROUPS)).toBe("AI部门 · 部长");
    expect(groupLabel(group("title.site.owner"), MOCK_GROUPS)).toBe("站长");
  });
  it("writes wildcards, meta values, results and scopes in plain words", () => {
    expect(entryNodeLabel("*", nodeLabel)).toBe("全部权限");
    expect(entryNodeLabel("users.*", nodeLabel)).toBe("users 下的全部节点");
    expect(entryNodeLabel("users.view", nodeLabel)).toBe("查看用户");
    expect(metaValueText("-1")).toBe("不限");
    expect(entryValueText({ value: null, meta_value: "3" })).toEqual({ text: "取值 3", status: "info" });
    expect(entryValueText({ value: false, meta_value: null }).text).toBe("拒绝");
    expect(scopeText({})).toBe("不限范围");
    expect(scopeText({ department: ["dept.ai", "dept.algo"] }, id => ({ "dept.ai": "AI部门", "dept.algo": "算法部门" })[id] ?? id)).toBe("部门：AI部门、算法部门");
  });
  it("draws the source chain of a hit, ending at the group that holds the entry", () => {
    const nameOf = (id: string) => group(id)?.name ?? id;
    expect(hitSourceText({ source: "group", group: { id: "level.registered", name: "注册用户" }, via: ["level.member", "level.registered"] }, nameOf)).toBe("极客班成员 → 注册用户");
    expect(hitSourceText({ source: "account", group: null, via: [] }, nameOf)).toBe("账号自己的条目");
  });
});

describe("entry and group forms", () => {
  const nodes = MOCK_NODES.nodes;
  it("knows catalogue nodes and wildcards whose prefix exists", () => {
    expect(knownNode("users.view", nodes)).toBe(true);
    expect(knownNode("users.*", nodes)).toBe(true);
    expect(knownNode("*", nodes)).toBe(true);
    expect(knownNode("nope.*", nodes)).toBe(false);
    expect(isMetaNode("meta.limit.apply.daily", nodes)).toBe(true);
    expect(isMetaNode("meta.*", nodes)).toBe(false);
    expect(wildcardNodes(nodes)).toEqual(expect.arrayContaining(["*", "forum.*", "forum.moderate.*", "meta.limit.*"]));
  });
  it("turns the entry form into entries.add and reports the first problem from the top", () => {
    const draft = { ...emptyEntryDraft(), node: "apply.export" };
    expect(entryInput(draft, nodes, NOW)).toEqual({ input: { node: "apply.export", value: true } });
    expect(entryInput({ ...draft, value: "deny" }, nodes, NOW)).toEqual({ input: { node: "apply.export", value: false } });
    expect(entryInput({ ...draft, node: "" }, nodes, NOW)).toEqual({ error: "选一个节点" });
    expect(entryInput({ ...draft, node: "apply.unknown" }, nodes, NOW)).toEqual({ error: "节点目录里没有这个节点" });
    expect(entryInput({ ...draft, node: "meta.limit.apply.daily", metaValue: "-2" }, nodes, NOW)).toMatchObject({ error: expect.stringContaining("-1") });
    expect(entryInput({ ...draft, node: "meta.limit.apply.daily", metaValue: "-1" }, nodes, NOW)).toEqual({ input: { node: "meta.limit.apply.daily", meta_value: "-1" } });
    expect(entryInput({ ...draft, scope: "[1]" }, nodes, NOW)).toMatchObject({ error: expect.stringContaining("JSON 对象") });
    expect(entryInput({ ...draft, scope: '{"department":["dept.ai"]}' }, nodes, NOW)).toEqual({ input: { node: "apply.export", value: true, scope: { department: ["dept.ai"] } } });
    expect(entryInput({ ...draft, expiresDate: "2026-10-23" }, nodes, NOW)).toEqual({ error: "到期日期要在今天或以后" });
    // 到期日是北京时间那天的最后一毫秒
    expect(entryInput({ ...draft, expiresDate: "2026-10-24" }, nodes, NOW)).toEqual({ input: { node: "apply.export", value: true, expires_at: Date.UTC(2026, 9, 24, 16) - 1 } });
  });
  it("builds a custom group id from the slug and refuses duplicates, bad names and weights", () => {
    const draft = { ...emptyGroupDraft(), slug: "event_crew", name: "活动组" };
    expect(createGroupInput(draft, MOCK_GROUPS)).toEqual({ payload: { id: "custom.event_crew", name: "活动组", weight: 10 } });
    expect(createGroupInput({ ...draft, slug: "custom.event_crew" }, MOCK_GROUPS)).toMatchObject({ payload: { id: "custom.event_crew" } });
    expect(createGroupInput({ ...draft, slug: "Event-Crew" }, MOCK_GROUPS)).toMatchObject({ error: expect.stringContaining("小写") });
    expect(createGroupInput({ ...draft, slug: "event_staff" }, MOCK_GROUPS)).toEqual({ error: "已经有 custom.event_staff 这个组" });
    expect(createGroupInput({ ...draft, name: " " }, MOCK_GROUPS)).toEqual({ error: "名称填 1–32 个字" });
    expect(createGroupInput({ ...draft, weight: 1001 }, MOCK_GROUPS)).toEqual({ error: "权重填 0–1000 的整数" });
  });
  it("sends only the changed group fields and refuses a group that inherits itself", () => {
    const target = group("custom.event_staff");
    expect(groupPatch(target, groupForm(target))).toEqual({ patch: null });
    expect(groupPatch(target, { ...groupForm(target), weight: 30 })).toEqual({ patch: { weight: 30 } });
    expect(groupPatch(target, { ...groupForm(target), parents: ["custom.event_staff"] })).toEqual({ error: "组不能继承自己" });
  });
  it("groups node options by domain, wildcards first, with the node in the label so search finds both", () => {
    const options = nodeSelectGroups(MOCK_NODES.nodes, MOCK_NODES.domains);
    const system = options.find(group => group.options.some(option => option.value === "system.backup"));
    expect(system?.options.map(option => option.value)).toContain("security.manage");
    expect(options[0]?.options.some(option => option.value === "*")).toBe(true);
    expect(nodesByDomain(["gitlab.view", "users.view", "forum.react"]).map(item => item.id)).toEqual(["forum", "console", "gitlab"]);
  });
});

describe("preview evaluation (mock, SPEC §3.4–§3.5)", () => {
  it("expands wildcards: the owner's * allows every concrete node", () => {
    as("owner");
    const effective = get<EffectivePermissions>("/api/console/accounts/mock-xu_yan/effective");
    expect(effective.allow).toEqual(expect.arrayContaining(["perm.manage", "gitlab.settings", "forum.badge.grant", "activity.read.ip"]));
    expect(effective.deny).toEqual([]);
  });
  it("lets a deny win: the muted member keeps reading but cannot post or reply", () => {
    as("owner");
    const effective = get<EffectivePermissions>("/api/console/accounts/mock-bai_shuo/effective");
    expect(effective.deny).toEqual(expect.arrayContaining(["forum.topic.create", "forum.reply.create"]));
    expect(effective.allow).toContain("forum.read.member");
    const explain = get<PermissionExplain>("/api/console/permissions/explain?account=mock-bai_shuo&node=forum.reply.create");
    expect(explain.result).toBe("deny");
    expect(explain.hits.map(hit => hit.group?.id)).toEqual(expect.arrayContaining(["level.member", "custom.muted"]));
  });
  it("takes meta from the heaviest group: members unlimited, registered 3 a day, 活动志愿者 lifts the topic limit", () => {
    as("owner");
    expect(get<EffectivePermissions>("/api/console/accounts/mock-liu_xing/effective").meta["meta.limit.apply.daily"]).toBe("-1");
    expect(get<EffectivePermissions>("/api/console/accounts/mock-zhou_zihan/effective").meta["meta.limit.apply.daily"]).toBe("3");
    expect(get<EffectivePermissions>("/api/console/accounts/mock-he_miao/effective").meta["meta.limit.forum.topic.hourly"]).toBe("40");
  });
  it("explains an inherited allow with the chain and an account's own entry", () => {
    as("owner");
    const inherited = get<PermissionExplain>("/api/console/permissions/explain?account=mock-zhou_zihan&node=account.cli.login");
    expect(inherited).toMatchObject({ result: "allow", hits: [{ source: "group", group: { id: "level.registered" }, via: ["level.registered"], entry: { node: "account.*" } }] });
    const own = get<PermissionExplain>("/api/console/permissions/explain?account=mock-liu_xing&node=forum.moderate.pin");
    expect(own.hits[0]).toMatchObject({ source: "account", group: null, entry: { scope: { category: ["notice"] } } });
    expect(get<PermissionExplain>("/api/console/permissions/explain?account=mock-liu_xing&node=perm.view").result).toBe("unset");
    expect(() => get("/api/console/permissions/explain?account=mock-liu_xing&node=users.*")).toThrowError(/具体的节点/);
  });
  it("counts and lists members from the accounts themselves; the visitor group has none", () => {
    as("owner");
    const { groups } = get<PermissionGroupsResponse>("/api/console/permission-groups");
    const count = (id: string) => groups.find(item => item.id === id)!.member_count;
    expect(count("level.visitor")).toBe(0);
    expect(count("title.site.owner")).toBe(1);
    expect(count("dept.ai")).toBe(4);
    const { members } = get<PermissionGroupMembersResponse>("/api/console/permission-groups/custom.event_staff/members");
    expect(members.map(item => item.username).sort()).toEqual(["he_miao", "qin_lan"]);
    expect(members.find(item => item.username === "he_miao")!.expires_at).not.toBeNull();
  });
  it("needs perm.view to read groups, and console.access before any of it", () => {
    as("ai_head");
    expect(() => get("/api/console/permission-groups")).toThrowError(/查看权限/);
    as("member");
    expect(() => get("/api/console/summary")).toThrowError(/进入控制台/);
  });
});

describe("preview writes check like the server, then stay read-only", () => {
  const write = (path: string, method: string, body?: unknown) => mockApi(path, { method, body: body === undefined ? undefined : JSON.stringify(body) });
  it("answers 501 once the node and step-up are fine", async () => {
    as("owner");
    await expect(write("/api/console/permission-groups/custom.event_staff", "PATCH", { weight: 30 })).rejects.toMatchObject({ status: 501, code: "mock_read_only" });
  });
  it("asks for a fresh login when the session is older than 10 minutes", async () => {
    as("owner_stale");
    await expect(write("/api/console/permission-groups/custom.event_staff", "PATCH", { weight: 30 })).rejects.toMatchObject({ status: 403, code: "step_up_required" });
  });
  it("refuses deleting a system group, inheritance cycles and unknown nodes", async () => {
    as("owner");
    await expect(write("/api/console/permission-groups/level.member", "DELETE")).rejects.toMatchObject({ status: 409, code: "system_group" });
    await expect(write("/api/console/permission-groups/level.registered", "PATCH", { parents: ["level.member"] })).rejects.toMatchObject({ status: 400, code: "group_cycle" });
    await expect(write("/api/console/permission-groups/custom.muted", "PATCH", { entries: { add: [{ node: "forum.nope" }], remove: [] } })).rejects.toMatchObject({ status: 400, code: "unknown_node" });
  });
  it("keeps the last site owner: no disabling and no dropping the title", async () => {
    as("owner");
    await expect(write("/api/console/users/mock-xu_yan", "PATCH", { status: "disabled" })).rejects.toMatchObject({ status: 409, code: "last_owner" });
    await expect(write("/api/console/users/mock-xu_yan", "PATCH", { titles: [] })).rejects.toMatchObject({ status: 409, code: "last_owner" });
    await expect(write("/api/console/users/mock-he_miao", "PATCH", { level: "alumni" })).rejects.toMatchObject({ status: 501 });
  });
  it("needs users.disable for status and perm.manage for members", async () => {
    as("ai_head");
    await expect(write("/api/console/users/mock-he_miao", "PATCH", { level: "alumni" })).rejects.toMatchObject({ status: 403, code: "forbidden" });
    as("management_head");
    await expect(write("/api/console/users/mock-he_miao", "PATCH", { status: "disabled" })).rejects.toMatchObject({ status: 501 });
    await expect(write("/api/console/permission-groups/custom.muted/members", "POST", { account_id: "mock-he_miao" })).rejects.toMatchObject({ status: 403, code: "forbidden" });
  });
});

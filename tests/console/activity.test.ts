// 操作记录页的纯函数（lib/activity）和开发预览的记录（mock/console），不挂载组件。
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  ACTIVITY_PAGE_SIZE, EMPTY_FILTERS, OUTCOME_TEXT, SURFACE_TEXT, actionFamily, actionText, activityParams, actorText, bucketText, eventSubText, extraFilterTags,
  filtersFromQuery, filtersToQuery, presetOf, presetRange, targetText,
} from "../../app/console/src/lib/activity";
import { routeConsole } from "../../app/console/src/mock/console";
import type { ActivityList } from "../../app/console/src/lib/types";

afterEach(() => vi.unstubAllGlobals());
const as = (persona: string) => vi.stubGlobal("window", { location: { search: `?__persona=${persona}` } });
const read = (query = "") => routeConsole(new URL(`/api/console/activity${query}`, "http://mock.local")) as ActivityList;

describe("activity filters", () => {
  it("names the seven surfaces (including GitLab, #370) and four outcomes in Chinese", () => {
    expect(Object.values(SURFACE_TEXT)).toEqual(["官网", "论坛", "控制台", "命令行", "接口", "系统", "GitLab"]);
    expect(Object.values(OUTCOME_TEXT)).toEqual(["成功", "拒绝", "限流", "出错"]);
  });
  it("drops unknown surfaces, outcomes and malformed dates from the address bar", () => {
    expect(filtersFromQuery({ surface: "github", outcome: "maybe", from: "2026-13-01", to: "2026-10-24", action: " auth. " }))
      .toEqual({ ...EMPTY_FILTERS, to: "2026-10-24", action: "auth." });
    expect(filtersToQuery({ ...EMPTY_FILTERS, outcome: "limited", account: " " })).toEqual({ outcome: "limited" });
  });
  it("sends Beijing day edges, so one day means the whole day", () => {
    const params = activityParams({ ...EMPTY_FILTERS, from: "2026-10-24", to: "2026-10-24", surface: "forum" }, { page: 3 });
    expect(params.get("from")).toBe(String(Date.UTC(2026, 9, 23, 16)));
    expect(params.get("to")).toBe(String(Date.UTC(2026, 9, 24, 16) - 1));
    expect(params.toString()).toContain("surface=forum");
    // 按页翻（#370）：第 3 页从第 101 条读起；第 1 页不带 offset
    expect(params.get("offset")).toBe(String(2 * ACTIVITY_PAGE_SIZE));
    expect(activityParams(EMPTY_FILTERS, { page: 1 }).has("offset")).toBe(false);
  });
  // #370 简化筛选：时间只给今天、近 7 天、近 30 天、全部，按北京时间算日子
  it("turns time presets into Beijing dates and recognises them back", () => {
    const now = Date.UTC(2026, 9, 30, 18, 30); // 北京时间 10-31 02:30
    expect(presetRange("today", now)).toEqual({ from: "2026-10-31", to: "" });
    expect(presetRange("7d", now)).toEqual({ from: "2026-10-25", to: "" });
    expect(presetRange("", now)).toEqual({ from: "", to: "" });
    expect(presetOf({ from: "2026-10-02", to: "" }, now)).toBe("30d");
    expect(presetOf({ from: "", to: "" }, now)).toBe("");
    expect(presetOf({ from: "2026-10-20", to: "2026-10-24" }, now)).toBeNull();
  });
  it("shows visitor, action and custom dates as closable tags, not as input boxes", () => {
    const now = Date.UTC(2026, 9, 30, 18, 30);
    const tags = extraFilterTags({ ...EMPTY_FILTERS, visitor: "v_8f3a2c61e0b94d7a", action: "auth.", from: "2026-10-20", to: "2026-10-24" }, now);
    expect(tags.map(tag => tag.text)).toEqual(["访客 v_8f3a2c61", "动作：登录与账号（auth.）", "日期：2026-10-20 至 2026-10-24"]);
    expect(tags.map(tag => tag.clear)).toEqual([{ visitor: "" }, { action: "" }, { from: "", to: "" }]);
    expect(extraFilterTags({ ...EMPTY_FILTERS, from: "2026-10-25" }, now)).toEqual([]);
    expect(actionFamily("forum.topic.view")).toBe("forum.topic.");
    expect(actionFamily("auth.signin")).toBe("auth.");
  });
  // #274：服务端 activityQuery 契约不认 `limit`（每页固定 50 条），传了会被拒绝；地址串不能再带它。
  it("never sends limit — the server contract does not accept it", () => {
    const params = activityParams({ ...EMPTY_FILTERS, surface: "forum" }, { page: 2 });
    expect(params.has("limit")).toBe(false);
  });
  it("writes actions, buckets, actors and targets plainly, falling back to the raw value", () => {
    expect(actionText("auth.signin")).toBe("登录");
    expect(actionText("perm.group.update")).toBe("权限");
    expect(actionText("x.y")).toBe("");
    expect(bucketText("apply.daily")).toBe("每天投递份数");
    expect(bucketText("forum.reply.hourly")).toBe("论坛");
    expect(bucketText("unknown")).toBe("");
    expect(actorText({ account: null, visitor_id: "v_8f3a2c61e0b94d7a" })).toEqual({ kind: "visitor", text: "访客 v_8f3a2c" });
    expect(actorText({ account: null, visitor_id: null })).toEqual({ kind: "system", text: "系统" });
    // GitLab 事件（#370）：对上账号的写显示名；没对上的写 GitLab 用户名并标未关联；动作按对象与动作查表
    expect(actorText({ account: null, visitor_id: null, surface: "gitlab", meta: { gitlab_username: "bob" } })).toEqual({ kind: "gitlab", text: "GitLab 用户 bob（未关联）" });
    expect(actionText("gitlab.issue.opened")).toBe("议题 · 开启");
    expect(actionText("gitlab.merge_request.accepted")).toBe("合并请求 · 合并");
    expect(actionText("gitlab.note.commented_on")).toBe("评论 · 发表");
    expect(actionText("gitlab.mystery.thing")).toBe("GitLab");
    expect(targetText({ target_type: "topic", target_id: "128" })).toBe("topic · 128");
    expect(eventSubText({ surface: "gitlab", target_type: "push", target_id: null, meta: { project: "geek/sandbox", ref: "main" } })).toBe("geek/sandbox · main");
    expect(eventSubText({ surface: "gitlab", target_type: "issue", target_id: "17", meta: { project: "geek/geek-cli" } })).toBe("geek/geek-cli · #17");
    expect(eventSubText({ surface: "forum", target_type: "topic", target_id: "128", meta: {} })).toBe("topic · 128");
  });
});

describe("preview activity (mock)", () => {
  it("pages with a cursor, newest first", () => {
    as("owner");
    const first = read();
    expect(first.items).toHaveLength(50);
    expect(first.next_cursor).toBe("50");
    expect(first.items[0].at).toBeGreaterThanOrEqual(first.items[1].at);
    const second = read("?cursor=50");
    expect(second.next_cursor).toBeNull();
    expect(second.items.length).toBeGreaterThan(0);
  });
  it("pages by offset with a total count (#370)", () => {
    as("owner");
    const first = read();
    const second = read(`?offset=${ACTIVITY_PAGE_SIZE}`);
    expect(first.total).toBe(first.items.length + second.items.length);
    expect(second.total).toBe(first.total);
    expect(second.items[0].id).toBe(read("?cursor=50").items[0].id);
    expect(read("?surface=gitlab").total).toBe(3);
  });
  // #274：Activity.vue 曾经一直带着 `limit=50`，服务端的 activityQuery 契约不认它，整页 400。
  // mock 现在和服务端一样拒绝契约之外的字段，不能再对着这种参数默默放行。
  it("rejects a query param the server contract doesn't have, like limit", () => {
    as("owner");
    expect(() => read("?limit=50")).toThrow(/additional properties/);
  });
  // 概览的「最近操作」也带过 `?limit=6`，同样整块 400：控制台源码里请求操作记录的地方都不许带 limit。
  it("no console page asks the activity API for a limit", () => {
    const root = join(__dirname, "../../app/console/src");
    const files = (readdirSync(root, { recursive: true }) as string[]).filter(name => /\.(vue|ts)$/.test(name) && !name.startsWith("mock"));
    const offenders = files.filter(name => /\/activity[^"'`]*[?&]limit=/.test(readFileSync(join(root, name), "utf8")));
    expect(offenders).toEqual([]);
  });
  it("filters by account, visitor, action prefix, surface, outcome and time", () => {
    as("owner");
    expect(read("?outcome=limited").items.every(row => row.outcome === "limited")).toBe(true);
    expect(read("?action=perm.").items.every(row => row.action.startsWith("perm."))).toBe(true);
    expect(read("?account=mock-chen_hang").items.every(row => row.account?.username === "chen_hang")).toBe(true);
    expect(read("?visitor=v_1d07e5b2a9c84f36").items.every(row => row.visitor_id === "v_1d07e5b2a9c84f36")).toBe(true);
    expect(read("?surface=cli").items.every(row => row.surface === "cli")).toBe(true);
    // #274：论坛、控制台也各自上报操作记录了，来源筛选要对这两个来源同样好用。
    expect(read("?surface=forum").items.every(row => row.surface === "forum")).toBe(true);
    expect(read("?surface=console").items.every(row => row.surface === "console")).toBe(true);
    expect(read("?surface=forum").items.length).toBeGreaterThan(0);
    expect(read("?surface=console").items.length).toBeGreaterThan(0);
    expect(read(`?from=${Date.now() - 60 * 60_000}`).items.every(row => row.at >= Date.now() - 60 * 60_000 - 1000)).toBe(true);
  });
  it("masks IPs without activity.read.ip and keeps them for the owner", () => {
    as("owner");
    expect(read().items[0].ip).not.toContain("*");
    as("management_head");
    // 管理部部长有 activity.*，也看得到完整 IP；部门部长只有 activity.read
    expect(read().items[0].ip).not.toContain("*");
    as("ai_head");
    // GitLab 事件（#370）本来就没有 IP，是 null；有 IP 的都打码
    for (const row of read().items) if (row.ip !== null) expect(row.ip).toMatch(/^\d+\.\d+\.\*\.\*$/);
    expect(read().items.some(row => row.ip !== null)).toBe(true);
  });
  it("shows a department head only their department's accounts and no blocked counts", () => {
    as("ai_head");
    const { items, blocked_today } = read();
    expect(items.length).toBeGreaterThan(0);
    expect(items.every(row => ["li_xiaoman", "qin_lan", "he_miao", "fang_lin"].includes(row.account?.username ?? ""))).toBe(true);
    expect(blocked_today).toEqual([]);
  });
});

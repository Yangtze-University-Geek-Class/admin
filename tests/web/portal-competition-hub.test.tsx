// @vitest-environment jsdom
// 比赛报名、组队、积分天梯（#239）：成员接口的容错读入、路径、阶段与文案纯函数，
// 以及「赛事 / 我的参赛」切换、Hero 报名、组队大厅、邀请与申请、天梯这些界面。
// 请求按 URL + method 分别作答，写请求连 JSON body 一起核对；时间用固定时间戳，轮询用 fake timers。
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { ApiError } from "@shared/lib/api";
import CompetitionsApp from "../../app/web/sites/portal/components/os/competitions/CompetitionsApp";
import CompetitionDetail from "../../app/web/sites/portal/components/os/competitions/CompetitionDetail";
import type { Account } from "../../app/web/sites/portal/lib/account";
import { readCompetition, type Competition } from "../../app/web/sites/portal/lib/competitions";
import { participationText, signupFact, timelineProgress } from "../../app/web/sites/portal/lib/competitionLabels";
import {
  countdown, countdownText, entryText, failText, HUB_LIMITS, hubPaths, hubSentence, journey, nextMilestone,
  pendingView, phaseOf, readFreeAgents, readLeaderboard, readMine, readMyStatus, readPerson, readTeam, readTeams,
  SCORE_RULES, teamSlots, type MyStatus, type Pending, type Team,
} from "../../app/web/sites/portal/lib/competitionHub";
import { signupBody } from "../../app/server/src/lib/competition-contract";

beforeEach(() => localStorage.setItem("yugc:dev-data-source", "live"));
afterEach(() => {
  localStorage.clear();
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

const HOUR = 3600_000;
const DAY = 24 * HOUR;
const NOW = Date.now();

// ---- 夹具 ----

const person = (account_id: string, login: string) => ({ account_id, login, avatar_url: null as string | null });
const member = (account_id: string, login: string, role: "leader" | "member", joined_at = NOW) => ({ ...person(account_id, login), role, joined_at });

/** 一场内部赛，默认开了团队赛在线报名（1–3 人、计分）。 */
const competition = (over: Record<string, unknown> = {}): Competition => readCompetition({
  id: "c1", name: "极客班算法挑战赛", kind: "internal",
  start_at: NOW + 6 * DAY, end_at: NOW + 6 * DAY + 6 * HOUR, signup_deadline: NOW + 4 * DAY,
  url: null, description: "班内选拔，前五名代表学院参加校赛", status: "registering",
  signup: { enabled: true, participation: "team", team_min: 1, team_max: 3, scoring: "contribution" },
  ...over,
})!;

const TEAM: Team = {
  id: "t1", name: "长江 Commit 队", slogan: "写点有用的", status: "recruiting", leader_account_id: "a1",
  members: [member("a1", "ada", "leader"), member("a2", "bob", "member")],
  member_count: 2, created_at: NOW - 2 * DAY,
};

const TEAM_SETTINGS = { enabled: true, participation: "team" as const, team_min: 2, team_max: 3, scoring: "none" as const };
const SCORED_TEAM_SETTINGS = { ...TEAM_SETTINGS, scoring: "contribution" as const };
const INDIVIDUAL = { enabled: true, participation: "individual" as const, team_min: 1, team_max: 1, scoring: "none" as const };

const activeSignup = { status: "active" as const, note: "", looking_for_team: true, created_at: NOW, updated_at: NOW };

const statusFixture = (over: Partial<MyStatus> = {}): MyStatus => ({
  competition_id: "c1", settings: SCORED_TEAM_SETTINGS, writable: true, signup: null,
  state: "none", team: null, role: null, pending: [],
  stats: { signups: 0, teams: 0, locked_teams: 0, confirmed_people: 0, unplaced: 0 }, actions: [],
  ...over,
});

const ACCOUNT: Account = { login: "ada", avatarUrl: null, consoleLink: false, accountId: "a1" };

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

type Call = { method: string; url: string; body: unknown };
/** 按「METHOD 路径」作答的 fetch 桩；返回的 calls 记着每次请求与解析后的 JSON body。 */
function serveHub(routes: Record<string, unknown>) {
  const calls: Call[] = [];
  vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL, init: RequestInit = {}) => {
    const url = typeof input === "string" ? input : input instanceof URL ? `${input.pathname}${input.search}` : input.url;
    const method = (init.method ?? "GET").toUpperCase();
    const body = typeof init.body === "string" ? JSON.parse(init.body) as unknown : undefined;
    calls.push({ method, url, body });
    const reply = routes[`${method} ${url}`];
    if (reply === undefined) return json({ error: "unexpected_request", message: `没有为 ${method} ${url} 准备响应` }, 500);
    const out = typeof reply === "function" ? reply(body) : reply;
    return out instanceof Response ? out : json(out);
  }));
  return calls;
}

const writes = (calls: Call[]) => calls.filter((call) => call.method !== "GET");

type TextLimit = { maxLength: number; minLength: number };
/** 取服务端请求契约里某个字段的长度限制：契约变了这条就红，不用手抄数字。 */
function contractField(schema: unknown, field: string): TextLimit {
  if (typeof schema !== "object" || schema === null) throw new Error("请求契约不是对象");
  const properties = Object.entries(schema).find(([key]) => key === "properties")?.[1];
  if (typeof properties !== "object" || properties === null) throw new Error("请求契约缺少 properties");
  const value = Object.entries(properties).find(([key]) => key === field)?.[1];
  if (typeof value !== "object" || value === null || !("maxLength" in value) || !("minLength" in value)) {
    throw new Error(`请求契约里的 ${field} 不是带长度限制的字符串`);
  }
  const { maxLength, minLength } = value;
  if (typeof maxLength !== "number" || typeof minLength !== "number") throw new Error(`请求契约里的 ${field} 长度限制不是数字`);
  return { maxLength, minLength };
}

// ---- 读响应 ----

describe("读成员响应：缺字段的条目丢掉，不显示半条", () => {
  it("一个人要有账号 id 和用户名；头像只认 https", () => {
    expect(readPerson({ account_id: "a1", login: "ada", avatar_url: "https://avatars.example/ada.png" })).toEqual({
      account_id: "a1", login: "ada", avatar_url: "https://avatars.example/ada.png",
    });
    // 数字 id 也认（服务端种子里的账号）
    expect(readPerson({ account_id: 7, login: "ada" })).toEqual({ account_id: "7", login: "ada", avatar_url: null });
    expect(readPerson({ login: "ada" })).toBeNull();
    expect(readPerson({ account_id: "a1" })).toBeNull();
    expect(readPerson("junk")).toBeNull();
    expect(readPerson(null)).toBeNull();
    expect(readPerson({ account_id: "a1", login: "ada", avatar_url: "http://example.test/a.png" })?.avatar_url).toBeNull();
    expect(readPerson({ account_id: "a1", login: "ada", avatar_url: "javascript:alert(1)" })?.avatar_url).toBeNull();
  });

  it("队伍领队排第一，其余按入队先后；member_count 不小于实际人数，状态认不出按招募中", () => {
    const team = readTeam({
      id: "t1", name: "长江 Commit 队", slogan: "写点有用的", status: "locked", leader_account_id: "a1",
      members: [member("a2", "bob", "member", 2), member("a1", "ada", "leader", 9)],
      member_count: 2, created_at: 5,
    });
    expect(team?.members.map((entry) => entry.login)).toEqual(["ada", "bob"]);
    expect(team).toMatchObject({ id: "t1", status: "locked", leader_account_id: "a1", created_at: 5 });
    expect(readTeam({ id: "t1", name: "没有成员的队" })?.members).toEqual([]);
    expect(readTeam({ id: "t1", name: "队", member_count: 0, members: [member("a1", "ada", "leader")] })?.member_count).toBe(1);
    expect(readTeam({ id: "t1", name: "队", status: "weird", members: [{ login: "缺 id" }] })).toMatchObject({ status: "recruiting", members: [] });
    expect(readTeam({ name: "没有 id" })).toBeNull();
    expect(readTeam({ id: "t1" })).toBeNull();
    expect(readTeam([])).toBeNull();
  });

  it("我的状态：认不出的 state 整份丢掉，未知 action 过滤掉，缺 id 的待处理丢掉", () => {
    const status = readMyStatus({
      competition_id: "c1",
      settings: { enabled: true, participation: "team", team_min: 1, team_max: 3, scoring: "contribution" },
      writable: true,
      signup: { status: "cancelled", note: "会写前端", looking_for_team: true, created_at: 1, updated_at: 2 },
      state: "signed_up", team: null, role: "leader",
      pending: [
        { membership_id: "m1", kind: "invitation", team_id: "t9", team_name: "别的队", person: { account_id: "a2", login: "bob" }, message: "来吧", created_at: 3 },
        { kind: "application", person: { account_id: "a3", login: "carol" } },
      ],
      stats: { signups: 3, teams: 1 },
      actions: ["signup", "lock", "hack"],
    });
    expect(status).toMatchObject({
      state: "signed_up", role: "leader", writable: true, team: null, actions: ["signup", "lock"],
      signup: { status: "cancelled", note: "会写前端", looking_for_team: true },
      settings: { enabled: true, participation: "team", team_min: 1, team_max: 3, scoring: "contribution" },
    });
    expect(status?.pending).toHaveLength(1);
    expect(status?.pending[0]).toMatchObject({ membership_id: "m1", kind: "invitation", team_name: "别的队" });
    expect(status?.stats).toEqual({ signups: 3, teams: 1, locked_teams: 0, confirmed_people: 0, unplaced: 0 });
    expect(readMyStatus({ state: "not_a_state" })).toBeNull();
    expect(readMyStatus({ competition_id: "c1" })).toBeNull();
    expect(readMyStatus(null)).toBeNull();
  });

  it("队伍列表、找队友、我的参赛与天梯：形状不对返回 null，条目缺 id 丢掉", () => {
    expect(readTeams({ teams: [{ id: "t1", name: "队" }, { name: "缺 id" }, "junk"] })).toEqual([expect.objectContaining({ id: "t1" })]);
    expect(readTeams({ teams: null })).toBeNull();
    expect(readTeams([])).toBeNull();

    expect(readFreeAgents({ people: [{ account_id: "a1", login: "ada", note: "会写 CSS", since: 3 }, { account_id: "a2" }] })).toEqual([
      expect.objectContaining({ login: "ada", note: "会写 CSS", since: 3 }),
    ]);
    expect(readFreeAgents({ people: "nope" })).toBeNull();

    const mine = readMine({
      items: [
        { competition_id: "c1", state: "in_team", pending_count: 2, team: { id: "t1", name: "队", status: "locked", member_count: 3, team_max: 3 } },
        { state: "signed_up" },
        { competition_id: "c2", state: "weird" },
        "junk",
      ],
      pending_total: 4,
    });
    expect(mine?.items).toHaveLength(1);
    expect(mine?.items[0]).toMatchObject({ competition_id: "c1", pending_count: 2, team: { id: "t1", status: "locked", team_max: 3 } });
    expect(mine?.pending_total).toBe(4);
    expect(readMine({ items: {} })).toBeNull();
    expect(readMine(null)).toBeNull();

    const board = readLeaderboard({
      updated_at: 9,
      individuals: [
        { rank: 1, person: { account_id: "a1", login: "ada" }, team: null, points: 30, issues: 2, prs: 1, penalties: 0 },
        { rank: 2, person: { login: "缺 id" } },
      ],
      teams: [{ rank: 1, team: { id: "t1", name: "队", status: "locked" }, points: 40, member_count: 3 }, { rank: 2, team: { name: "缺 id" } }],
    });
    expect(board?.updated_at).toBe(9);
    expect(board?.individuals).toEqual([expect.objectContaining({ rank: 1, points: 30, issues: 2, prs: 1 })]);
    expect(board?.teams).toEqual([expect.objectContaining({ rank: 1, points: 40, member_count: 3 })]);
    expect(readLeaderboard({ individuals: null })).toBeNull();
  });
});

describe("路径、阶段与失败文案", () => {
  it("比赛与队伍的 id 都做路径段编码", () => {
    expect(hubPaths.status("c 1")).toBe("/api/competitions/c%201/my-status");
    expect(hubPaths.signup("c/1")).toBe("/api/competitions/c%2F1/signup");
    expect(hubPaths.teams("q")).toBe("/api/competitions/q/teams");
    expect(hubPaths.freeAgents("q")).toBe("/api/competitions/q/free-agents");
    expect(hubPaths.leaderboard("q")).toBe("/api/competitions/q/leaderboard");
    expect(hubPaths.team("t/1")).toBe("/api/teams/t%2F1");
    expect(hubPaths.team("t/1", "lock")).toBe("/api/teams/t%2F1/lock");
    expect(hubPaths.mine).toBe("/api/me/competitions");
  });

  it("401 当没登录，403 当不是成员（跨站来源除外），其余当读失败", () => {
    expect(phaseOf(new ApiError(401, "unauthorized", "请先登录"))).toBe("signed_out");
    expect(phaseOf(new ApiError(403, "not_member", "只对成员开放"))).toBe("not_member");
    // 跨站请求被拒是配置/安全问题，不是「不是成员」，重试才有意义
    expect(phaseOf(new ApiError(403, "invalid_origin", "来源不合法"))).toBe("failed");
    expect(phaseOf(new ApiError(500, "internal", "服务器错误"))).toBe("failed");
    expect(phaseOf(new Error("offline"))).toBe("failed");
  });

  it("失败文案：限流、登录过期各说各的，4xx 有中文说明用服务端的，其余给通用一句", () => {
    expect(failText(new ApiError(429, "rate_limited", "操作太频繁"))).toBe("操作太频繁了，请过一分钟再试。");
    expect(failText(new ApiError(401, "unauthorized", "请先登录"))).toBe("登录已过期，请重新登录后再试。");
    expect(failText(new ApiError(409, "team_full", "这支队伍已经满了"))).toBe("这支队伍已经满了");
    // 英文或服务端 5xx 的中文说明不外露，给统一的提示
    expect(failText(new ApiError(400, "invalid_body", "Invalid team name"))).toBe("没有提交成功：网络不稳定或服务暂时不可用，请稍后再试。");
    expect(failText(new ApiError(500, "internal", "数据库出错了"))).toBe("没有提交成功：网络不稳定或服务暂时不可用，请稍后再试。");
    expect(failText(new Error("offline"))).toBe("没有提交成功：网络不稳定或服务暂时不可用，请稍后再试。");
  });
});

describe("里程碑、倒计时、槽位与待处理", () => {
  it("倒计时数到最早还没到的那个节点，同一刻的合成一句", () => {
    const item = { start_at: 1000, end_at: 3000, signup_deadline: 500 };
    expect(nextMilestone(item, 0)).toEqual({ label: "报名截止", at: 500 });
    expect(nextMilestone(item, 500)).toEqual({ label: "报名截止", at: 500 });
    expect(nextMilestone(item, 501)).toEqual({ label: "开赛", at: 1000 });
    expect(nextMilestone(item, 1000)).toEqual({ label: "比赛结束", at: 3000 });
    expect(nextMilestone(item, 3000)).toEqual({ label: "比赛结束", at: 3000 });
    expect(nextMilestone(item, 3001)).toBeNull();
    // 报名开到比赛最后一刻：报名截止与结束是同一刻，只画一句
    expect(nextMilestone({ start_at: 1000, end_at: 3000, signup_deadline: 3000 }, 2500)).toEqual({ label: "报名截止 · 比赛结束", at: 3000 });
    // 没登记报名截止：直接数到开赛
    expect(nextMilestone({ start_at: 1000, end_at: 3000, signup_deadline: null }, 0)).toEqual({ label: "开赛", at: 1000 });
  });

  it("倒计时拆成天时分秒，读屏只念到分钟", () => {
    const at = 1_000_000 + DAY + HOUR + 60_000 + 1000;
    expect(countdown(at, 1_000_000)).toEqual({ days: 1, hours: 1, minutes: 1, seconds: 1 });
    expect(countdown(1000, 2000)).toEqual({ days: 0, hours: 0, minutes: 0, seconds: 0 });
    expect(countdownText(2 * DAY + 3 * HOUR, 0)).toBe("还有 2 天 3 小时");
    expect(countdownText(3 * HOUR + 5 * 60_000, 0)).toBe("还有 3 小时 5 分");
    expect(countdownText(5 * 60_000, 0)).toBe("还有 5 分钟");
    expect(countdownText(0, 1000)).toBe("还有 0 分钟");
  });

  it("队伍槽位按人数上限补空位，人数比上限多时不截断", () => {
    const team = readTeam({ id: "t1", name: "队", members: [member("a1", "ada", "leader", 2), member("a2", "bob", "member", 1)] })!;
    expect(teamSlots(team, 3).map((slot) => slot?.login ?? null)).toEqual(["ada", "bob", null]);
    expect(teamSlots(team, 2)).toHaveLength(2);
    expect(teamSlots(team, 1)).toHaveLength(2);
    expect(teamSlots(team, 3).map((slot) => slot?.role ?? null)).toEqual(["leader", "member", null]);
  });

  it("一条待处理的方向与可用操作：申请看领队、邀请看接收方，关于我这支队伍的只有领队能处理", () => {
    const pending = (over: Partial<Pending> = {}): Pending => ({
      membership_id: "m1", kind: "application", team_id: "t1", team_name: "长江 Commit 队",
      person: person("a2", "bob"), message: "", created_at: 0, ...over,
    });
    const ours = { team: TEAM, role: "leader" as const };
    expect(pendingView(pending(), ours)).toEqual({ incoming: true, title: "bob 申请加入", detail: "没有留言", actions: ["decline", "accept"] });
    expect(pendingView(pending({ message: "  想加入  " }), ours).detail).toBe("“想加入”");
    expect(pendingView(pending(), { team: TEAM, role: "member" })).toEqual({ incoming: false, title: "bob 申请加入", detail: "没有留言", actions: [] });
    expect(pendingView(pending(), { team: null, role: null })).toMatchObject({ incoming: false, title: "已申请加入「长江 Commit 队」", actions: ["withdraw"] });
    // 我申请了别的队：等领队处理，可以撤回
    expect(pendingView(pending({ team_id: "t9", team_name: "别的队" }), ours)).toEqual({
      incoming: false, title: "已申请加入「别的队」", detail: "等领队处理", actions: ["withdraw"],
    });
    // 别人邀请我：我处理；邀请的是我的队员：只有领队能撤回
    expect(pendingView(pending({ kind: "invitation", team_id: "t9", team_name: "别的队" }), ours)).toEqual({
      incoming: true, title: "「别的队」邀请你加入", detail: "领队发来了邀请", actions: ["decline", "accept"],
    });
    expect(pendingView(pending({ kind: "invitation", message: "一起来" }), ours)).toEqual({
      incoming: false, title: "已邀请 bob", detail: "等对方回复", actions: ["withdraw"],
    });
    expect(pendingView(pending({ kind: "invitation" }), { team: TEAM, role: "member" })).toMatchObject({ incoming: false, actions: [] });
  });

  it("底部进度：团队赛 报名 → 组队 → 确认参赛，个人赛两步；没队伍算没完成", () => {
    const steps = (state: MyStatus["state"], participation: "team" | "individual") => journey(state, participation).map((step) => `${step.label}:${step.state}`);
    expect(steps("none", "team")).toEqual(["报名:now", "组队:todo", "确认参赛:todo"]);
    expect(steps("signed_up", "team")).toEqual(["报名:done", "组队:now", "确认参赛:todo"]);
    expect(steps("unplaced", "team")).toEqual(["报名:done", "组队:missed", "确认参赛:todo"]);
    expect(steps("in_team", "team")).toEqual(["报名:done", "组队:done", "确认参赛:now"]);
    expect(steps("confirmed", "team")).toEqual(["报名:done", "组队:done", "确认参赛:done"]);
    expect(journey("none", "individual")).toEqual([{ label: "报名", state: "now" }, { label: "参赛", state: "todo" }]);
    expect(journey("signed_up", "individual")).toEqual([{ label: "报名", state: "done" }, { label: "参赛", state: "now" }]);
  });

  it("操作条那句话：现在什么情况、下一步做什么", () => {
    const due = "11-15（周日）23:59";
    const none = { state: "none" as const, writable: true, team: null, role: null };
    expect(hubSentence(none, TEAM_SETTINGS, due)).toBe(`报名截止 ${due}。报名后可以创建队伍，或申请加入别人的队伍。`);
    expect(hubSentence({ ...none, writable: false }, TEAM_SETTINGS, due)).toBe("报名已截止，这场比赛你没有报名。");
    expect(hubSentence(none, INDIVIDUAL, due)).toBe(`报名截止 ${due}。报名即参赛。`);
    expect(hubSentence(none, { ...INDIVIDUAL, scoring: "contribution" }, due)).toBe(`报名截止 ${due}。报名即参赛，比赛期间合入的 Issue 与 PR 计入积分天梯。`);
    const signed = { state: "signed_up" as const, writable: true, team: null, role: null };
    expect(hubSentence(signed, TEAM_SETTINGS, due)).toBe("你已报名，还没有队伍：创建一支，或申请加入别人的队伍。");
    expect(hubSentence({ ...signed, writable: false }, TEAM_SETTINGS, due)).toBe("报名已截止，你还没有队伍。");
    expect(hubSentence(signed, INDIVIDUAL, due)).toBe("你已报名，等组织者的通知。");
    expect(hubSentence(signed, { ...INDIVIDUAL, scoring: "contribution" }, due)).toBe("你已报名。比赛期间合入的 Issue 与 PR，由组织者核实后计入天梯。");
    expect(hubSentence({ state: "in_team", writable: true, team: { ...TEAM, member_count: 1 }, role: "leader" }, TEAM_SETTINGS, due)).toBe("「长江 Commit 队」现在 1 人，还差 1 人才能确认参赛。");
    expect(hubSentence({ state: "in_team", writable: true, team: TEAM, role: "leader" }, TEAM_SETTINGS, due)).toBe("「长江 Commit 队」2/3 人。人齐了就点「确认参赛」锁定名单。");
    expect(hubSentence({ state: "in_team", writable: true, team: TEAM, role: "member" }, TEAM_SETTINGS, due)).toBe("你在「长江 Commit 队」，等领队确认参赛。");
    expect(hubSentence({ state: "confirmed", writable: false, team: { ...TEAM, status: "locked" }, role: "leader" }, TEAM_SETTINGS, due)).toBe("「长江 Commit 队」已确认参赛，名单已锁定。");
    expect(hubSentence({ state: "unplaced", writable: false, team: null, role: null }, TEAM_SETTINGS, due)).toBe("报名截止时你还没有队伍，这次没能参赛。");
  });

  it("「我的参赛」卡片那一行：报名到哪一步、哪支队伍", () => {
    const entry = (state: MyStatus["state"], team: { name: string; member_count: number; team_max: number } | null = null) => ({ competition_id: "c1", state, pending_count: 0, team: team && { id: "t1", status: "recruiting" as const, ...team } });
    expect(entryText(entry("signed_up"), "team")).toBe("已报名 · 还没有队伍");
    expect(entryText(entry("signed_up"), "individual")).toBe("已报名");
    expect(entryText(entry("in_team", { name: "长江 Commit 队", member_count: 2, team_max: 3 }), "team")).toBe("「长江 Commit 队」2/3 人 · 招募中");
    expect(entryText(entry("confirmed", { name: "长江 Commit 队", member_count: 3, team_max: 3 }), "team")).toBe("「长江 Commit 队」已确认参赛");
    expect(entryText(entry("unplaced"), "team")).toBe("报名截止时没有队伍");
    expect(entryText(entry("none"), "team")).toBe("有待处理的邀请");
  });

  it("输入上限与计分规则跟服务端请求契约一致", () => {
    expect(HUB_LIMITS.teamName).toBe(contractField(signupBody.teamCreate, "name").maxLength);
    expect(HUB_LIMITS.teamNameMin).toBe(contractField(signupBody.teamCreate, "name").minLength);
    expect(HUB_LIMITS.slogan).toBe(contractField(signupBody.teamCreate, "slogan").maxLength);
    expect(HUB_LIMITS.note).toBe(contractField(signupBody.signup, "note").maxLength);
    expect(HUB_LIMITS.message).toBe(contractField(signupBody.apply, "message").maxLength);
    expect(SCORE_RULES).toEqual([
      { kind: "issue", label: "合入 Issue", points: "+5～+30", note: "按问题的价值与描述质量" },
      { kind: "pr", label: "合入 PR", points: "+15～+100", note: "按改动的难度与影响" },
      { kind: "penalty", label: "作弊", points: "−50", note: "刷量、抄袭、冒名提交等，每次核实扣分" },
    ]);
  });
});

describe("赛程进度与报名方式（competitionLabels）", () => {
  it("时间线进度在 0–1 之间分段线性，单节点与同时刻节点都不除零", () => {
    const steps = (...ats: number[]) => ats.map((at) => ({ at }));
    expect(timelineProgress([], 5)).toBe(0);
    expect(timelineProgress(steps(100), 50)).toBe(0);
    expect(timelineProgress(steps(100), 100)).toBe(1);
    expect(timelineProgress(steps(0, 100), 50)).toBe(0.5);
    expect(timelineProgress(steps(0, 100, 300), 50)).toBe(0.25);
    expect(timelineProgress(steps(0, 100, 300), 100)).toBe(0.5);
    expect(timelineProgress(steps(0, 100, 300), 200)).toBe(0.75);
    // 两个节点同一时刻：过了就是最后一段
    expect(timelineProgress(steps(0, 0), 0)).toBe(1);
    expect(timelineProgress(steps(0, 0), -1)).toBe(0);
  });

  it("参赛形式与报名方式：内部赛开了在线报名就在这里报", () => {
    expect(participationText({ participation: "individual", team_min: 1, team_max: 1 })).toBe("个人赛");
    expect(participationText({ participation: "team", team_min: 1, team_max: 3 })).toBe("团队赛 · 每队 1–3 人");
    expect(participationText({ participation: "team", team_min: 3, team_max: 3 })).toBe("团队赛 · 每队 3 人");
    expect(signupFact({ kind: "internal", url: null, signup: { ...TEAM_SETTINGS } })).toEqual({ main: "在这里在线报名", sub: "团队赛 · 每队 2–3 人" });
    expect(signupFact({ kind: "internal", url: null, signup: { ...TEAM_SETTINGS, enabled: false } })).toEqual({ main: "按组织者通知报名", sub: "在线报名还没开放" });
    expect(signupFact({ kind: "external", url: "https://example.test/comp", signup: { ...TEAM_SETTINGS } })).toEqual({ main: "在比赛官网报名", sub: "example.test" });
  });
});

// ---- 赛事 / 我的参赛 ----

describe("比赛应用：赛事 / 我的参赛", () => {
  it("没有比赛开在线报名时不放切换，界面与只有赛事时一样", async () => {
    serveHub({
      "GET /api/public/competitions": () => ({ competitions: [competition({ signup: { enabled: false } })] }),
      "GET /api/me/competitions": () => ({ items: [], pending_total: 0 }),
    });
    render(<CompetitionsApp account={ACCOUNT} />);
    await screen.findByRole("list", { name: "比赛列表" });
    expect(screen.queryByRole("group", { name: "切换列表" })).toBeNull();
    expect(screen.queryByRole("button", { name: /我的参赛/ })).toBeNull();
  });

  it("有比赛开在线报名才出现切换；未登录切到「我的参赛」给登录链接，不读成员数据", async () => {
    const calls = serveHub({ "GET /api/public/competitions": () => ({ competitions: [competition()] }) });
    render(<CompetitionsApp account={null} />);
    const group = await screen.findByRole("group", { name: "切换列表" });
    const all = within(group).getByRole("button", { name: /赛事/ });
    expect(all.getAttribute("aria-pressed")).toBe("true");
    fireEvent.click(within(group).getByRole("button", { name: /我的参赛/ }));
    expect(within(group).getByRole("button", { name: /我的参赛/ }).getAttribute("aria-pressed")).toBe("true");
    const signIn = await screen.findByRole("link", { name: "登录" });
    expect(signIn.getAttribute("href")).toMatch(/^\/signin\?return_to=/);
    expect(screen.getByText("登录后查看你的参赛")).toBeTruthy();
    expect(calls.some((call) => call.url === hubPaths.mine)).toBe(false);
    expect(calls.some((call) => call.url.endsWith("/my-status"))).toBe(false);
  });

  it("登录后读我的参赛：卡片写报名到哪一步与待处理条数，切换上角标是 total", async () => {
    const calls = serveHub({
      "GET /api/public/competitions": () => ({ competitions: [competition()] }),
      "GET /api/me/competitions": () => ({
        items: [{ competition_id: "c1", state: "in_team", pending_count: 2, team: { id: "t1", name: "长江 Commit 队", status: "recruiting", member_count: 2, team_max: 3 } }],
        pending_total: 5,
      }),
      "GET /api/competitions/c1/my-status": () => statusFixture({ state: "in_team", team: TEAM, role: "leader", signup: activeSignup, actions: ["invite"] }),
    });
    render(<CompetitionsApp account={ACCOUNT} />);
    const group = await screen.findByRole("group", { name: "切换列表" });
    fireEvent.click(within(group).getByRole("button", { name: /我的参赛/ }));
    const mine = await screen.findByRole("list", { name: "我的参赛" });
    const card = within(mine).getByRole("button", { name: /极客班算法挑战赛/ });
    expect(within(card).getByText("「长江 Commit 队」2/3 人 · 招募中")).toBeTruthy();
    expect(within(card).getByText("2 条待处理")).toBeTruthy();
    const badge = document.querySelector(".pt-cx-badge");
    expect(badge?.textContent).toContain("5");
    expect(calls.some((call) => call.url === hubPaths.mine)).toBe(true);
  });

  it("不是极客班成员（403）时说清楚只对成员开放", async () => {
    serveHub({
      "GET /api/public/competitions": () => ({ competitions: [competition()] }),
      "GET /api/me/competitions": () => json({ error: "not_member", message: "只对极客班成员开放" }, 403),
      "GET /api/competitions/c1/my-status": () => statusFixture({ actions: ["signup"] }),
    });
    render(<CompetitionsApp account={ACCOUNT} />);
    const group = await screen.findByRole("group", { name: "切换列表" });
    fireEvent.click(within(group).getByRole("button", { name: /我的参赛/ }));
    expect(await screen.findByText("报名与组队只对极客班成员开放")).toBeTruthy();
    expect(screen.getByText(/你的账号还不是极客班成员/)).toBeTruthy();
  });

  it("没报名时「看看可报名的比赛」切回赛事并打开「可报名」筛选", async () => {
    serveHub({
      "GET /api/public/competitions": () => ({ competitions: [competition(), competition({ id: "c2", name: "上学期的练习赛", kind: "external", url: "https://example.test/comp", signup_deadline: NOW - DAY })] }),
      "GET /api/me/competitions": () => ({ items: [], pending_total: 0 }),
      "GET /api/competitions/c1/my-status": () => statusFixture({ actions: ["signup"] }),
    });
    render(<CompetitionsApp account={ACCOUNT} />);
    const group = await screen.findByRole("group", { name: "切换列表" });
    fireEvent.click(within(group).getByRole("button", { name: /我的参赛/ }));
    expect(await screen.findByText("你还没有报名比赛")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "看看可报名的比赛" }));
    expect(within(group).getByRole("button", { name: /赛事/ }).getAttribute("aria-pressed")).toBe("true");
    const chips = screen.getByRole("group", { name: "筛选比赛" });
    expect(within(chips).getByRole("button", { name: /^可报名/ }).getAttribute("aria-pressed")).toBe("true");
    expect(within(screen.getByRole("list", { name: "比赛列表" })).getAllByRole("button")).toHaveLength(1);
  });
});

// ---- 详情：Hero、报名与页签 ----

describe("比赛详情：Hero 主按钮、报名与页签", () => {
  it("未登录时 Hero 主按钮是「登录后报名」链接，指向统一登录页", () => {
    const calls = serveHub({});
    render(<CompetitionDetail item={competition()} now={NOW} account="signed_out" />);
    const signIn = screen.getByRole("link", { name: /登录后报名/ });
    expect(signIn.getAttribute("href")).toMatch(/^\/signin\?return_to=/);
    expect(signIn.closest(".pt-cx-hero")).not.toBeNull();
    expect(screen.getByText(/登录极客班账号后在这里报名、组队。/)).toBeTruthy();
    expect(calls).toHaveLength(0);
  });

  it("登录后读 my-status；立即报名提交留言与「找队友」，成功后提示并切到队伍页签", async () => {
    const calls = serveHub({
      "GET /api/competitions/c1/my-status": () => statusFixture({ actions: ["signup"] }),
      "POST /api/competitions/c1/signup": () => statusFixture({ state: "signed_up", signup: activeSignup, actions: ["create_team", "update_signup", "cancel_signup"] }),
      "GET /api/competitions/c1/teams": () => ({ teams: [] }),
    });
    render(<CompetitionDetail item={competition()} now={NOW} account="signed_in" accountId="a1" />);
    const go = await screen.findByRole("button", { name: "立即报名" });
    expect(go.closest(".pt-cx-hero")).not.toBeNull();
    fireEvent.click(go);
    const dialog = screen.getByRole("dialog", { name: "报名参赛" });
    fireEvent.change(within(dialog).getByRole("textbox"), { target: { value: "擅长前端" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "确认报名" }));
    await waitFor(() => expect(writes(calls)).toEqual([{ method: "POST", url: "/api/competitions/c1/signup", body: { note: "擅长前端", looking_for_team: true } }]));
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    expect(document.querySelector(".pt-cx-notice")?.textContent).toContain("报名成功！下一步：创建队伍，或申请加入一支队伍。");
    expect(screen.getByRole("tab", { name: /^队伍/ }).getAttribute("aria-selected")).toBe("true");
  });

  it("服务端拒绝时对话框不关，显示那句中文说明，填好的内容还在", async () => {
    serveHub({
      "GET /api/competitions/c1/my-status": () => statusFixture({ actions: ["signup"] }),
      "POST /api/competitions/c1/signup": () => json({ error: "signup_closed", message: "报名已经截止了，下次早点来。" }, 409),
    });
    render(<CompetitionDetail item={competition()} now={NOW} account="signed_in" accountId="a1" />);
    fireEvent.click(await screen.findByRole("button", { name: "立即报名" }));
    const dialog = screen.getByRole("dialog", { name: "报名参赛" });
    fireEvent.change(within(dialog).getByRole("textbox"), { target: { value: "想参加，能写前端" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "确认报名" }));
    await waitFor(() => expect(within(dialog).getByRole("alert").textContent).toBe("报名已经截止了，下次早点来。"));
    expect(screen.getByRole("dialog", { name: "报名参赛" })).toBeTruthy();
    expect(dialog.querySelector("textarea")?.value).toBe("想参加，能写前端");
  });

  it("页签 role=tablist，左右键循环、Home / End 跳首尾，焦点跟着走", async () => {
    serveHub({
      "GET /api/competitions/c1/my-status": () => statusFixture({ state: "signed_up", signup: activeSignup, actions: ["create_team"] }),
      "GET /api/competitions/c1/teams": () => ({ teams: [] }),
      "GET /api/competitions/c1/free-agents": () => ({ people: [] }),
      "GET /api/competitions/c1/leaderboard": () => ({ updated_at: NOW, individuals: [], teams: [] }),
    });
    render(<CompetitionDetail item={competition()} now={NOW} account="signed_in" accountId="a1" />);
    const tablist = await screen.findByRole("tablist", { name: "比赛内容" });
    const selected = () => within(tablist).getAllByRole("tab").find((tab) => tab.getAttribute("aria-selected") === "true")?.getAttribute("data-tab");
    expect(selected()).toBe("overview");
    fireEvent.keyDown(tablist, { key: "ArrowRight" });
    expect(selected()).toBe("teams");
    expect(document.activeElement?.getAttribute("data-tab")).toBe("teams");
    fireEvent.keyDown(tablist, { key: "End" });
    expect(document.activeElement?.getAttribute("data-tab")).toBe("board");
    expect(selected()).toBe("board");
    // 从最后一个往右回到第一个，往左回到最后一个
    fireEvent.keyDown(tablist, { key: "ArrowRight" });
    expect(document.activeElement?.getAttribute("data-tab")).toBe("overview");
    fireEvent.keyDown(tablist, { key: "ArrowLeft" });
    expect(document.activeElement?.getAttribute("data-tab")).toBe("board");
    fireEvent.keyDown(tablist, { key: "Home" });
    expect(document.activeElement?.getAttribute("data-tab")).toBe("overview");
  });

  it("对话框 Esc 关闭并把焦点还给打开它的按钮，Tab 在框里循环", async () => {
    serveHub({ "GET /api/competitions/c1/my-status": () => statusFixture({ actions: ["signup"] }) });
    render(<CompetitionDetail item={competition()} now={NOW} account="signed_in" accountId="a1" />);
    const go = await screen.findByRole("button", { name: "立即报名" });
    // jsdom 的 click 不会像浏览器那样把焦点给按钮：先手动聚焦，关闭对话框后才会还给「打开它的按钮」
    go.focus();
    fireEvent.click(go);
    const dialog = screen.getByRole("dialog", { name: "报名参赛" });
    const note = within(dialog).getByRole("textbox");
    await waitFor(() => expect(document.activeElement).toBe(note));

    fireEvent.keyDown(dialog, { key: "Escape" });
    expect(screen.queryByRole("dialog")).toBeNull();
    await waitFor(() => expect(document.activeElement).toBe(go));

    fireEvent.click(go);
    const again = screen.getByRole("dialog", { name: "报名参赛" });
    const focusables = [...again.querySelectorAll<HTMLElement>('a[href], button:not([disabled]), input:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])')];
    const first = focusables[0]!;
    const last = focusables[focusables.length - 1]!;
    last.focus();
    fireEvent.keyDown(last, { key: "Tab" });
    expect(document.activeElement).toBe(first);
    first.focus();
    fireEvent.keyDown(first, { key: "Tab", shiftKey: true });
    expect(document.activeElement).toBe(last);
  });
});

// ---- 队伍页签 ----

describe("队伍页签：槽位、邀请、确认参赛、申请与待处理", () => {
  const leaderStatus = statusFixture({
    settings: TEAM_SETTINGS, state: "in_team", team: TEAM, role: "leader", signup: activeSignup,
    actions: ["invite", "lock", "leave", "transfer", "disband", "update_signup", "cancel_signup"],
  });

  it("按人数上限画槽位，领队带皇冠；空位点了打开邀请对话框并读找队友名单", async () => {
    const calls = serveHub({
      "GET /api/competitions/c1/my-status": leaderStatus,
      "GET /api/competitions/c1/teams": () => ({ teams: [TEAM] }),
      "GET /api/competitions/c1/free-agents": () => ({ people: [{ ...person("a3", "carol"), note: "会写 CSS", since: NOW }] }),
    });
    render(<CompetitionDetail item={competition()} now={NOW} account="signed_in" accountId="a1" />);
    fireEvent.click(await screen.findByRole("tab", { name: /^队伍/ }));
    const mine = await screen.findByRole("region", { name: "长江 Commit 队" });
    expect(mine.querySelectorAll(".pt-cx-slots > li")).toHaveLength(3);
    expect(mine.querySelectorAll(".pt-cx-crown")).toHaveLength(1);
    expect(within(mine).getByText("我是领队")).toBeTruthy();
    const empty = within(mine).getAllByRole("button", { name: /空位/ });
    expect(empty).toHaveLength(1);
    expect(empty[0]!.textContent).toContain("点这里邀请");
    fireEvent.click(empty[0]!);
    expect(screen.getByRole("dialog", { name: "邀请队友" })).toBeTruthy();
    await waitFor(() => expect(calls.some((call) => call.url === "/api/competitions/c1/free-agents")).toBe(true));
    expect(await screen.findByRole("button", { name: /邀请 carol/ })).toBeTruthy();
  });

  it("人数够了「确认参赛」先二次确认，再 POST 锁队", async () => {
    const locked = { ...leaderStatus, team: { ...TEAM, status: "locked" as const }, actions: ["unlock", "leave"] };
    const calls = serveHub({
      "GET /api/competitions/c1/my-status": leaderStatus,
      "GET /api/competitions/c1/teams": () => ({ teams: [] }),
      "POST /api/teams/t1/lock": () => locked,
    });
    render(<CompetitionDetail item={competition()} now={NOW} account="signed_in" accountId="a1" />);
    fireEvent.click(await screen.findByRole("tab", { name: /^队伍/ }));
    const mine = await screen.findByRole("region", { name: "长江 Commit 队" });
    fireEvent.click(within(mine).getByRole("button", { name: "确认参赛" }));
    const confirm = screen.getByRole("dialog", { name: "确认参赛并锁定名单？" });
    expect(within(confirm).getByText(/「长江 Commit 队」2 人参赛。锁定后不能再加人或退出/)).toBeTruthy();
    fireEvent.click(within(confirm).getByRole("button", { name: "确认参赛" }));
    await waitFor(() => expect(writes(calls)).toEqual([{ method: "POST", url: "/api/teams/t1/lock", body: {} }]));
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    expect(await screen.findByText("我是领队")).toBeTruthy();
  });

  it("收到的邀请能接受或婉拒，POST respond 带上申请 id 与动作", async () => {
    const invitation: Pending = {
      membership_id: "m1", kind: "invitation", team_id: "t9", team_name: "别的队",
      person: person("a9", "dave"), message: "来吧", created_at: NOW,
    };
    const joined = readTeam({
      id: "t9", name: "别的队", slogan: "", status: "recruiting", leader_account_id: "a9",
      members: [member("a9", "dave", "leader"), member("a1", "ada", "member")], member_count: 2, created_at: NOW,
    })!;
    const calls = serveHub({
      "GET /api/competitions/c1/my-status": () => statusFixture({
        settings: TEAM_SETTINGS, state: "signed_up", signup: activeSignup, pending: [invitation],
        actions: ["create_team", "apply", "update_signup", "cancel_signup"],
      }),
      "GET /api/competitions/c1/teams": () => ({ teams: [] }),
      "POST /api/teams/t9/respond": () => statusFixture({
        settings: TEAM_SETTINGS, state: "in_team", signup: activeSignup, actions: ["leave"], team: joined, role: "member",
      }),
    });
    render(<CompetitionDetail item={competition()} now={NOW} account="signed_in" accountId="a1" />);
    fireEvent.click(await screen.findByRole("tab", { name: /^队伍/ }));
    const title = await screen.findByText("「别的队」邀请你加入");
    expect(title.closest("li")?.className).toBe("is-in");
    const pending = title.closest("section")!;
    expect(within(pending).getByText(/“来吧”/)).toBeTruthy();
    expect(within(pending).getByRole("button", { name: "婉拒" })).toBeTruthy();
    fireEvent.click(within(pending).getByRole("button", { name: "接受" }));
    await waitFor(() => expect(writes(calls)).toEqual([{ method: "POST", url: "/api/teams/t9/respond", body: { membership_id: "m1", action: "accept" } }]));
  });

  it("别的队伍能申请加入：对话框写留言，POST apply 带上留言", async () => {
    const other: Team = {
      id: "t2", name: "另一支队伍", slogan: "", status: "recruiting", leader_account_id: "a2",
      members: [member("a2", "bob", "leader")], member_count: 1, created_at: NOW,
    };
    const calls = serveHub({
      "GET /api/competitions/c1/my-status": () => statusFixture({
        settings: TEAM_SETTINGS, state: "signed_up", signup: activeSignup,
        actions: ["create_team", "apply", "update_signup", "cancel_signup"],
      }),
      "GET /api/competitions/c1/teams": () => ({ teams: [other] }),
      "POST /api/teams/t2/apply": () => statusFixture({ settings: TEAM_SETTINGS, state: "signed_up", signup: activeSignup }),
    });
    render(<CompetitionDetail item={competition()} now={NOW} account="signed_in" accountId="a1" />);
    fireEvent.click(await screen.findByRole("tab", { name: /^队伍/ }));
    fireEvent.click(await screen.findByRole("button", { name: /申请加入/ }));
    const dialog = screen.getByRole("dialog", { name: "申请加入「另一支队伍」" });
    fireEvent.change(within(dialog).getByRole("textbox"), { target: { value: "我做过两年前端" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "发送申请" }));
    await waitFor(() => expect(writes(calls)).toEqual([{ method: "POST", url: "/api/teams/t2/apply", body: { message: "我做过两年前端" } }]));
  });
});

// ---- 天梯页签 ----

describe("天梯页签：领奖台、表格与轮询", () => {
  const board = {
    updated_at: NOW,
    individuals: [
      { rank: 1, person: person("a2", "bob"), team: { id: "t2", name: "红队" }, points: 80, issues: 3, prs: 2, penalties: 0 },
      { rank: 2, person: person("a3", "carol"), team: null, points: 60, issues: 2, prs: 1, penalties: 0 },
      { rank: 3, person: person("a4", "dave"), team: null, points: 40, issues: 1, prs: 1, penalties: 1 },
      { rank: 4, person: person("a1", "ada"), team: { id: "t1", name: "长江 Commit 队" }, points: 20, issues: 1, prs: 0, penalties: 0 },
    ],
    teams: [
      { rank: 1, team: { id: "t2", name: "红队", status: "locked" }, points: 140, member_count: 3 },
      { rank: 2, team: { id: "t1", name: "长江 Commit 队", status: "recruiting" }, points: 20, member_count: 2 },
    ],
  };
  const boardStatus = statusFixture({
    settings: SCORED_TEAM_SETTINGS, state: "in_team", team: TEAM, role: "leader", signup: activeSignup, actions: ["invite"],
  });

  it("前三名上领奖台、第四名起进表格，我那一行标出来；个人与队伍榜可切换", async () => {
    serveHub({
      "GET /api/competitions/c1/my-status": boardStatus,
      "GET /api/competitions/c1/leaderboard": () => board,
    });
    render(<CompetitionDetail item={competition()} now={NOW} account="signed_in" accountId="a1" />);
    fireEvent.click(await screen.findByRole("tab", { name: "天梯" }));
    const podium = await screen.findByRole("list", { name: "前三名" });
    expect(within(podium).getAllByRole("listitem")).toHaveLength(3);
    expect(podium.querySelectorAll(".is-me")).toHaveLength(0);
    expect(within(podium).getByText("bob")).toBeTruthy();

    const table = screen.getByRole("table");
    const rows = within(table).getAllByRole("row");
    expect(rows).toHaveLength(2);
    expect(rows[1]!.className).toBe("is-me");
    expect(within(rows[1]!).getByText("ada")).toBeTruthy();
    expect(within(rows[1]!).getByText("长江 Commit 队")).toBeTruthy();
    expect(screen.getByText(/更新于 .* · 每 30 秒自动刷新/)).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "队伍榜" }));
    const teamTable = screen.getByRole("table");
    const teamRows = within(teamTable).getAllByRole("row");
    expect(teamRows).toHaveLength(3);
    expect(teamRows[2]!.className).toBe("is-me");
    expect(within(teamTable).getByText("红队")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "个人榜" }));
    expect(screen.getByRole("list", { name: "前三名" })).toBeTruthy();
  });

  it("空榜说清积分怎么来，队伍榜没有队伍得分时也一样", async () => {
    serveHub({
      "GET /api/competitions/c1/my-status": boardStatus,
      "GET /api/competitions/c1/leaderboard": () => ({ updated_at: NOW, individuals: [], teams: [] }),
    });
    render(<CompetitionDetail item={competition()} now={NOW} account="signed_in" accountId="a1" />);
    fireEvent.click(await screen.findByRole("tab", { name: "天梯" }));
    expect(await screen.findByText("还没有人得分")).toBeTruthy();
    expect(screen.getByText(/合入的 Issue 与 PR 由组织者核实后登记积分/)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "队伍榜" }));
    expect(screen.getByText("还没有队伍得分")).toBeTruthy();
  });

  it("天梯开着时每 30 秒重读一次", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(NOW);
    let reads = 0;
    const calls = serveHub({
      "GET /api/competitions/c1/my-status": boardStatus,
      "GET /api/competitions/c1/leaderboard": () => {
        reads += 1;
        return { ...board, updated_at: NOW + reads };
      },
    });
    render(<CompetitionDetail item={competition()} now={NOW} account="signed_in" accountId="a1" />);
    await vi.waitFor(() => expect(screen.getByRole("tab", { name: "天梯" })).toBeTruthy());
    fireEvent.click(screen.getByRole("tab", { name: "天梯" }));
    await vi.waitFor(() => expect(screen.getByRole("table")).toBeTruthy());
    const before = calls.filter((call) => call.url === "/api/competitions/c1/leaderboard").length;
    expect(before).toBe(1);
    await vi.advanceTimersByTimeAsync(30_000);
    await vi.waitFor(() => expect(calls.filter((call) => call.url === "/api/competitions/c1/leaderboard").length).toBe(before + 1));
    expect(reads).toBe(2);
  });
});

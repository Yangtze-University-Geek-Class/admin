// 比赛报名与积分（#239）控制台页面的纯逻辑：设置表单、积分表单、名单统计与链接、样板名单。
// 不渲染组件（tests/console 里没有挂载 Vue 页面的先例），只测这些函数与 mock 的只读样板。
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  activeSignups, canRemoveSignup, emptyScoreForm, exportRateLimitNotice, matchSignups, removalNotice, removalResultText, rosterCsvName, rosterCsvPath,
  rosterStats, scoreErrors, scorePayload, scoreTargetText, scoreTargetUrl,
  settingsErrors, settingsForm, settingsPayload, teamLeader, type SettingsForm,
} from "../../app/console/src/lib/competition-hub";
import { ApiError } from "../../app/console/src/lib/http";
import { routeConsole } from "../../app/console/src/mock/console";
import { mockApi } from "../../app/console/src/mock";
import type { CompetitionRoster, RosterSignup, RosterTeam, ScoreForm } from "../../app/console/src/lib/types";

const settings = (patch: Partial<SettingsForm> = {}): SettingsForm => ({
  enabled: false, participation: "individual", teamMin: "1", teamMax: "1", scoring: "none", ...patch,
});
const scoreForm = (patch: Partial<ScoreForm> = {}): ScoreForm => ({
  accountId: "acc-1", kind: "issue", repo: "Yangtze-University-Geek-Class/portal", number: "265", importance: "normal", core: "business", reason: "修了一个问题", ...patch,
});
const person = (login: string, patch: Partial<RosterSignup> = {}): RosterSignup => ({
  account_id: `mock-${login}`, login, avatar_url: null, status: "active", note: "", looking_for_team: false,
  team_id: null, team_name: null, role: null, created_at: 0, updated_at: 0, cancelled_at: null, ...patch,
});

describe("signup settings form", () => {
  it("round-trips settings without inventing values", () => {
    expect(settingsForm({ enabled: true, participation: "team", team_min: 2, team_max: 5, scoring: "contribution" }))
      .toEqual({ enabled: true, participation: "team", teamMin: "2", teamMax: "5", scoring: "contribution" });
  });

  it("requires a deadline before opening signup", () => {
    expect(settingsErrors(settings({ enabled: true }), { hasDeadline: false }).enabled).toContain("报名截止时间");
    expect(settingsErrors(settings({ enabled: true }), { hasDeadline: true })).toEqual({});
    // 关闭报名不需要截止时间
    expect(settingsErrors(settings(), { hasDeadline: false })).toEqual({});
  });

  it("keeps team size inside 1–20 with min ≤ max, only for team competitions", () => {
    const team = (min: string, max: string) => settingsErrors(settings({ participation: "team", teamMin: min, teamMax: max }), { hasDeadline: true });
    expect(team("2", "5")).toEqual({});
    expect(team("1", "1")).toEqual({});
    expect(team("20", "20")).toEqual({});
    expect(team("0", "5").teamMin).toBeTruthy();
    expect(team("2", "21").teamMax).toBeTruthy();
    expect(team("2.5", "5").teamMin).toBeTruthy();
    expect(team("", "5").teamMin).toBeTruthy();
    expect(team("4", "2").teamMax).toContain("不能小于最低人数");
    expect(team("4", "4")).toEqual({});
    // 个人赛不组队：人数输入框隐藏，残留的值不参与校验
    expect(settingsErrors(settings({ participation: "individual", teamMin: "0", teamMax: "abc" }), { hasDeadline: true })).toEqual({});
  });

  it("sends integers, and forces 1 / 1 for individual competitions", () => {
    expect(settingsPayload(settings({ enabled: true, participation: "team", teamMin: " 2 ", teamMax: "5", scoring: "contribution" })))
      .toEqual({ enabled: true, participation: "team", team_min: 2, team_max: 5, scoring: "contribution" });
    expect(settingsPayload(settings({ participation: "individual", teamMin: "0", teamMax: "x" })))
      .toEqual({ enabled: false, participation: "individual", team_min: 1, team_max: 1, scoring: "none" });
  });
});

describe("roster stats", () => {
  const stats = { signups: 5, teams: 2, locked_teams: 1, confirmed_people: 3, unplaced: 1 };
  const roster = (participation: "individual" | "team"): Pick<CompetitionRoster, "stats" | "settings"> =>
    ({ stats, settings: { enabled: true, participation, team_min: 2, team_max: 3, scoring: "none" } });

  it("labels the internal counts from the interface", () => {
    const cards = rosterStats(roster("team"), "internal");
    expect(cards.map(card => card.label)).toEqual(["报名人数", "队伍", "已确认队伍", "已确认人数", "未成队"]);
    expect(cards.map(card => card.value)).toEqual([5, 2, 1, 3, 1]);
    expect(cards[2].hint).toContain("领队");
  });

  it("calls external signups intents and explains individual competitions", () => {
    const external = rosterStats(roster("team"), "external");
    expect(external[0]).toMatchObject({ label: "意向人数", value: 5 });
    const individual = rosterStats(roster("individual"), "internal");
    expect(individual[3].hint).toContain("个人赛报名即确认");
    expect(individual[4].hint).toContain("个人赛不组队");
  });

  it("finds the leader by role, falling back to leader_account_id", () => {
    const team = {
      id: "t1", name: "夜航星", slogan: "", status: "locked", leader_account_id: "acc-2", member_count: 2,
      created_at: 0, disbanded_at: null, members: [
        { account_id: "acc-1", login: "a", avatar_url: null, role: "member", joined_at: 0 },
        { account_id: "acc-2", login: "b", avatar_url: null, role: "member", joined_at: 0 },
      ],
    } satisfies RosterTeam;
    expect(teamLeader(team)?.login).toBe("b");
    expect(teamLeader({ ...team, leader_account_id: "missing" })).toBeNull();
  });

  it("points CSV downloads at the console route", () => {
    expect(rosterCsvPath("c1001")).toBe("/api/console/competitions/c1001/roster.csv");
    expect(rosterCsvPath("a b/c")).toBe("/api/console/competitions/a%20b%2Fc/roster.csv");
    expect(rosterCsvName("c1001")).toBe("competition-c1001-roster.csv");
  });

  it("explains the export rate limit and leaves other failures to the error panel", () => {
    expect(exportRateLimitNotice(new ApiError(429, "rate_limited", "Rate limit exceeded"))).toBe("导出太频繁，请一分钟后再试");
    expect(exportRateLimitNotice(new ApiError(500, "server_error", "boom"))).toBeNull();
    expect(exportRateLimitNotice(new Error("network"))).toBeNull();
  });
});

describe("score form validation", () => {
  it("asks for both levels on an Issue or MR and none on a penalty (#278: no free points)", () => {
    expect(scoreErrors(scoreForm())).toEqual({});
    expect(scoreErrors(scoreForm({ kind: "pr", importance: "critical", core: "core" }))).toEqual({});
    expect(scoreErrors(scoreForm({ importance: "" })).importance).toBeTruthy();
    expect(scoreErrors(scoreForm({ kind: "pr", core: "" })).core).toBeTruthy();
    expect(scoreErrors(scoreForm({ kind: "penalty", importance: "", core: "", repo: "", number: "" }))).toEqual({});
    expect(emptyScoreForm("pr")).toMatchObject({ kind: "pr", accountId: "", importance: "", core: "" });
    expect(emptyScoreForm()).not.toHaveProperty("points");
  });

  it("requires a positive integer number for issues and pull requests", () => {
    expect(scoreErrors(scoreForm({ number: "1" }))).toEqual({});
    expect(scoreErrors(scoreForm({ number: "1000000" }))).toEqual({});
    for (const number of ["", "0", "-3", "1.5", "abc", "1000001"]) {
      expect(scoreErrors(scoreForm({ number })).number).toBeTruthy();
    }
    // 扣分没有仓库和编号，这两个错误不能出现
    expect(scoreErrors(scoreForm({ kind: "penalty", importance: "", core: "", repo: "bad", number: "0" }))).toEqual({});
  });

  it("requires owner/name with the server's character set and length", () => {
    expect(scoreErrors(scoreForm({ repo: " owner/name " }))).toEqual({});
    // #278：GitLab 项目可以在子组里，服务端的 REPO_PATTERN 放宽到最多五段
    expect(scoreErrors(scoreForm({ repo: "owner/name/extra" }))).toEqual({});
    expect(scoreErrors(scoreForm({ repo: "a/b/c/d/e" }))).toEqual({});
    for (const repo of ["", "owner", "a/b/c/d/e/f", "owner//name", "owner/na me", "owner/名字", `${"a".repeat(70)}/${"b".repeat(70)}`]) {
      expect(scoreErrors(scoreForm({ repo })).repo).toBeTruthy();
    }
    expect(scoreErrors(scoreForm({ repo: `${"a".repeat(69)}/${"b".repeat(70)}` })).repo).toBeUndefined();
  });

  it("counts the note by characters and requires a person", () => {
    expect(scoreErrors(scoreForm({ reason: "x".repeat(200) }))).toEqual({});
    expect(scoreErrors(scoreForm({ reason: "𠮷".repeat(200) }))).toEqual({});
    expect(scoreErrors(scoreForm({ reason: "x".repeat(201) })).reason).toBeTruthy();
    expect(scoreErrors(scoreForm({ accountId: " " })).accountId).toBeTruthy();
  });

  it("builds the request body with the two levels and no points, leaving repo, number and levels off a penalty", () => {
    expect(scorePayload(scoreForm({ repo: " owner/name ", number: " 12 ", importance: "important", core: "core", reason: " 修好了 " })))
      .toEqual({ account_id: "acc-1", kind: "issue", repo: "owner/name", number: 12, importance: "important", core: "core", reason: "修好了" });
    const penalty = scorePayload(scoreForm({ kind: "penalty", repo: "owner/name", number: "3", reason: "抄了" }));
    expect(penalty).toEqual({ account_id: "acc-1", kind: "penalty", reason: "抄了" });
    expect(penalty).not.toHaveProperty("repo");
    expect(penalty).not.toHaveProperty("number");
    expect(penalty).not.toHaveProperty("importance");
  });
});

describe("score links", () => {
  it("links issues and pull requests on GitHub, and nothing for a penalty", () => {
    expect(scoreTargetUrl({ kind: "issue", repo: "owner/name", number: 7 })).toBe("https://github.com/owner/name/issues/7");
    expect(scoreTargetUrl({ kind: "pr", repo: "owner/name", number: 265 })).toBe("https://github.com/owner/name/pull/265");
    expect(scoreTargetUrl({ kind: "penalty", repo: null, number: null })).toBeNull();
    expect(scoreTargetUrl({ kind: "issue", repo: null, number: 7 })).toBeNull();
    expect(scoreTargetText({ kind: "pr", repo: "owner/name", number: 265 })).toBe("owner/name#265");
    expect(scoreTargetText({ kind: "penalty", repo: null, number: null })).toBe("—");
  });

  it("does not build a GitHub link for the competition's GitLab projects (#278)", () => {
    expect(scoreTargetUrl({ kind: "pr", repo: "geek/admin", number: 12 }, ["geek/admin"])).toBeNull();
    expect(scoreTargetUrl({ kind: "pr", repo: "owner/name", number: 12 }, ["geek/admin"])).toBe("https://github.com/owner/name/pull/12");
    expect(scoreTargetText({ kind: "pr", repo: "geek/admin", number: 12 })).toBe("geek/admin#12");
  });
});

describe("score person candidates", () => {
  it("only offers active signups and searches logins case-insensitively", () => {
    const rows = [
      person("Chen-Hang"),
      person("li-xiaoman", { status: "cancelled" }),
      person("wang-zhe", { team_id: "t1" }),
    ];
    expect(activeSignups(rows).map(row => row.login)).toEqual(["Chen-Hang", "wang-zhe"]);
    expect(matchSignups(rows, " CHEN ").map(row => row.login)).toEqual(["Chen-Hang"]);
    expect(matchSignups(rows, "zhe").map(row => row.login)).toEqual(["wang-zhe"]);
    // 已取消的报名不出现，即使登录名匹配
    expect(matchSignups(rows, "xiaoman")).toEqual([]);
    expect(matchSignups(rows, "")).toHaveLength(2);
  });
});

describe("console mock roster", () => {
  const roster = () => routeConsole(new URL("http://mock.local/api/console/competitions/c1001/roster")) as CompetitionRoster;

  it("serves settings, stats and both tables in the server's shape", () => {
    const data = roster();
    expect(data.settings).toEqual({ enabled: true, participation: "team", team_min: 2, team_max: 3, scoring: "contribution" });
    expect(data.stats).toEqual({ signups: 5, teams: 2, locked_teams: 1, confirmed_people: 3, unplaced: 1 });
    // 含已取消的报名与招募中的队伍
    expect(data.signups).toHaveLength(6);
    expect(data.signups.some(row => row.status === "cancelled")).toBe(true);
    expect(data.teams.map(team => team.status).sort()).toEqual(["locked", "recruiting"]);
    expect(data.teams[0].members).toHaveLength(3);
  });

  it("keeps the other competitions on the default, closed settings", () => {
    const data = routeConsole(new URL("http://mock.local/api/console/competitions/c1002/roster")) as CompetitionRoster;
    expect(data.settings).toEqual({ enabled: false, participation: "individual", team_min: 1, team_max: 1, scoring: "none" });
    expect(data.stats).toEqual({ signups: 0, teams: 0, locked_teams: 0, confirmed_people: 0, unplaced: 0 });
  });

  it("exports a CSV with the same columns as the server", () => {
    const csv = routeConsole(new URL("http://mock.local/api/console/competitions/c1001/roster.csv")) as string;
    const [header, first] = csv.replace(/^\ufeff/, "").split("\r\n");
    expect(header).toBe("account_id,login,status,note,looking_for_team,team_name,role,created_at_beijing,updated_at_beijing,cancelled_at_beijing");
    expect(first).toContain("chen_hang");
    expect(csv).toContain("he_miao,cancelled");
  });

  it("lists the score events, including the revoked one", () => {
    const { events } = routeConsole(new URL("http://mock.local/api/console/competitions/c1001/score-events")) as { events: { kind: string; status: string }[] };
    expect(events.map(event => event.kind).sort()).toEqual(["issue", "issue", "penalty", "pr"]);
    expect(events.find(event => event.kind === "penalty")?.status).toBe("revoked");
  });

  it("hides roster data for an unknown competition", () => {
    expect(() => routeConsole(new URL("http://mock.local/api/console/competitions/nope/roster"))).toThrowError(/比赛不存在/);
  });
});

describe("removing a signup (#342)", () => {
  const member = (login: string, role: "leader" | "member", joined_at: number) => ({ account_id: `mock-${login}`, login, avatar_url: null, role, joined_at });
  const team = (patch: Partial<RosterTeam> = {}): RosterTeam => ({
    id: "t1", name: "夜航星", slogan: "", status: "recruiting", leader_account_id: "mock-chen",
    members: [member("chen", "leader", 1), member("li", "member", 2), member("wang", "member", 3)], member_count: 3,
    created_at: 0, disbanded_at: null, ...patch,
  });
  const roster = (teams: RosterTeam[], team_min = 1) => ({
    settings: { enabled: true, participation: "team" as const, team_min, team_max: 3, scoring: "none" as const }, teams,
  });
  const inTeam = (login: string, role: "leader" | "member") => person(login, { team_id: "t1", team_name: "夜航星", role });

  it("offers the action on active rows only, and never once the competition is finalized", () => {
    expect(canRemoveSignup(person("chen"), false)).toBe(true);
    expect(canRemoveSignup(person("chen", { status: "cancelled" }), false)).toBe(false);
    expect(canRemoveSignup(person("chen"), true)).toBe(false);
  });

  it("explains the team consequence the way the server applies it", () => {
    const base = "报名会改为已取消，不再算进报名人数和天梯；已登记的积分记录保留。";
    expect(removalNotice(person("zhao"), roster([team()]))).toEqual({ title: "把 @zhao 移出这场比赛？", body: base });
    expect(removalNotice(inTeam("li", "member"), roster([team()])).body).toBe(`${base}@li 会退出「夜航星」。`);
    // 领队交给名单里领队之后的第一位，也就是最早入队的队员
    expect(removalNotice(inTeam("chen", "leader"), roster([team()])).body)
      .toBe(`${base}@chen 是「夜航星」的领队，领队会交给最早入队的 @li，然后 @chen 退出队伍。`);
    const solo = team({ members: [member("chen", "leader", 1)], member_count: 1 });
    expect(removalNotice(inTeam("chen", "leader"), roster([solo])).body).toBe(`${base}「夜航星」只有 @chen 一人，队伍会解散。`);
  });

  it("warns when a confirmed team drops below the minimum, and stays quiet when it does not", () => {
    const locked = team({ status: "locked" });
    expect(removalNotice(inTeam("wang", "member"), roster([locked], 3)).body)
      .toContain("「夜航星」已确认参赛，移出后只剩 2 人，少于最低 3 人，会退回招募中。");
    expect(removalNotice(inTeam("wang", "member"), roster([locked], 2)).body).not.toContain("退回招募中");
    expect(removalNotice(inTeam("chen", "leader"), roster([locked], 3)).body).toContain("会退回招募中");
  });

  it("describes the server's result in the toast", () => {
    expect(removalResultText({ team_action: "none", unlocked: false })).toBe("报名已取消。");
    expect(removalResultText({ team_action: "left", unlocked: true })).toBe("已退出队伍。队伍人数不够，已退回招募中。");
    expect(removalResultText({ team_action: "transferred", unlocked: false })).toBe("领队已交给最早入队的队员。");
    expect(removalResultText({ team_action: "disbanded", unlocked: false })).toBe("队伍已解散。");
  });
});

describe("preview removal checks like the server, then stays read-only", () => {
  afterEach(() => vi.unstubAllGlobals());
  const as = (persona: string) => vi.stubGlobal("window", { location: { search: `?__persona=${persona}` } });
  const remove = (competition: string, account: string) =>
    mockApi(`/api/console/competitions/${competition}/signups/${account}`, { method: "DELETE" });

  it("refuses without the node, without a fresh login, or without an active signup", async () => {
    as("member");
    await expect(remove("c1001", "mock-chen_hang")).rejects.toMatchObject({ status: 403 });
    as("owner_stale");
    await expect(remove("c1001", "mock-chen_hang")).rejects.toMatchObject({ status: 403, code: "step_up_required" });
    as("owner");
    await expect(remove("nope", "mock-chen_hang")).rejects.toMatchObject({ status: 404, code: "not_found" });
    await expect(remove("c1001", "mock-he_miao")).rejects.toMatchObject({ status: 409, code: "not_signed_up" });
    await expect(remove("c1001", "mock-chen_hang")).rejects.toMatchObject({ status: 501, code: "mock_read_only" });
  });
});

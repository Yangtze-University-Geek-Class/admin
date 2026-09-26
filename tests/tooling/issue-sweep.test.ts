import { spawnSync } from "node:child_process";
import { chmodSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { beijing, linkedIssues, planSweep, renderReport, TRACK_RE } from "../../scripts/issue-sweep.mjs";

// scripts/issue-sweep.mjs：issue 巡检（docs/conventions/TRACKING.md §1，#115）。夹具都是虚构的 issue 与 PR。
const NOW = new Date("2026-09-26T08:00:00Z"); // 北京 16:00
const daysAgo = (days: number) => new Date(NOW.getTime() - days * 24 * 60 * 60 * 1000).toISOString();
const track = (kind: string, stage: string, createdAt: string) => ({ body: `<!-- yzgc:track v1 kind=${kind} stage=${stage} -->\n**x**｜y`, createdAt });

const merged = [
  { number: 101, title: "task 分支的 PR", headRefName: "task/1/done", baseRefName: "stage", body: "### 关联\nCloses #1\n", mergedAt: daysAgo(2), mergeCommit: { oid: "a".repeat(40) } },
  { number: 102, title: "不是 task 分支，但正文关了 #2", headRefName: "someone/patch", baseRefName: "stage", body: "修好了。\n\nFixes #2，Refs #12", mergedAt: daysAgo(1), mergeCommit: { oid: "b".repeat(40) } },
  { number: 103, title: "合进 main 的不算", headRefName: "stage", baseRefName: "main", body: "Closes #6", mergedAt: daysAgo(1), mergeCommit: { oid: "c".repeat(40) } },
  { number: 104, title: "#3 的 PR", headRefName: "task/3/redo", baseRefName: "stage", body: "Closes #3", mergedAt: daysAgo(20), mergeCommit: { oid: "d".repeat(40) } },
  { number: 109, title: "#9 的 PR", headRefName: "task/9/x", baseRefName: "stage", body: "Closes #9", mergedAt: daysAgo(3), mergeCommit: { oid: "e".repeat(40) } },
  { number: 21, title: "旧 PR", headRefName: "task/14/old", baseRefName: "stage", body: "Closes #14", mergedAt: daysAgo(40), mergeCommit: { oid: "f".repeat(40) } },
  { number: 115, title: "第一轮", headRefName: "task/15/part", baseRefName: "stage", body: "Closes #15", mergedAt: daysAgo(2), mergeCommit: { oid: "1".repeat(40) } },
  { number: 116, title: "刚合并", headRefName: "task/16/fresh", baseRefName: "stage", body: "Closes #16", mergedAt: daysAgo(0.5 / 24), mergeCommit: { oid: "2".repeat(40) } },
  { number: 120, title: "重开后别人修好", headRefName: "someone/patch17", baseRefName: "stage", body: "Closes #17", mergedAt: daysAgo(2), mergeCommit: { oid: "3".repeat(40) } },
  { number: 118, title: "#18 的第一段", headRefName: "task/18/first", baseRefName: "stage", body: "Closes #18", mergedAt: daysAgo(25), mergeCommit: { oid: "4".repeat(40) } },
  { number: 119, title: "#19 的 PR", headRefName: "task/19/x", baseRefName: "stage", body: "Closes #19", mergedAt: daysAgo(30), mergeCommit: { oid: "5".repeat(40) } },
];

const openPrs = [{ number: 117, headRefName: "task/15/more", body: "Closes #15" }, { number: 130, headRefName: "task/18/second", body: "Closes #18" }];

const open = [
  { number: 1, title: "合并了还开着", updatedAt: daysAgo(2), comments: [track("progress", "dev", daysAgo(5))] },
  { number: 2, title: "正文 Fixes 关联", updatedAt: daysAgo(1), comments: [] },
  { number: 3, title: "合并后关过又被重开 | 还没修好", updatedAt: daysAgo(15), comments: [track("closed", "merged", daysAgo(20)), track("rework", "review", daysAgo(15))] },
  { number: 4, title: "两周没人动", updatedAt: daysAgo(20), comments: [track("plan", "dev", daysAgo(20))] },
  { number: 5, title: "刚提的", updatedAt: daysAgo(3), comments: [] },
  { number: 6, title: "只被合进 main 的 PR 提到", updatedAt: daysAgo(1), comments: [] },
  { number: 12, title: "只被 Refs", updatedAt: daysAgo(14), comments: [] },
  // 早年用普通文字关的（没有 yzgc:track 记录头），后来又被重开：不能按旧 PR 再关
  { number: 14, title: "旧格式关闭后重开", updatedAt: daysAgo(20), stateReason: "REOPENED", reopenedAt: daysAgo(30), comments: [{ body: "已由 PR #21 合并进 stage，关闭。", createdAt: daysAgo(40) }] },
  { number: 15, title: "还有开着的 PR", updatedAt: daysAgo(2), comments: [] },
  { number: 16, title: "PR 刚合并", updatedAt: daysAgo(20), comments: [] },
  // issue 开着时 stateReason 一直是 REOPENED：重开在最近一次合并之前，合并之后没人再重开，就该补关
  { number: 17, title: "重开后又被修好", updatedAt: daysAgo(2), stateReason: "REOPENED", reopenedAt: daysAgo(10), comments: [] },
  { number: 18, title: "合并了一段，还有 PR 开着", updatedAt: daysAgo(20), comments: [] },
  // 查不到重开时间：当作合并后重开，不补关
  { number: 19, title: "查不到重开时间", updatedAt: daysAgo(20), stateReason: "REOPENED", reopenedAt: null, comments: [] },
];

const closed = [
  // #112 那样：关了，没有 PR，也没有「关闭」记录（评论是 CRLF 换行的也要认得出记录头）
  { number: 7, title: "关了没记录", closedAt: daysAgo(0.1), stateReason: "COMPLETED", comments: [{ body: "<!-- yzgc:track v1 kind=progress stage=dev -->\r\n**进展**｜开工", createdAt: daysAgo(0.2) }] },
  { number: 8, title: "关了有记录", closedAt: daysAgo(1), stateReason: "NOT_PLANNED", comments: [{ body: "<!-- yzgc:track v1 kind=closed stage=closed -->\r\n**关闭**｜不做了", createdAt: daysAgo(1) }] },
  { number: 9, title: "合并关的", closedAt: daysAgo(3), stateReason: "COMPLETED", comments: [] },
  { number: 10, title: "太早关的", closedAt: daysAgo(30), stateReason: "COMPLETED", comments: [] },
  { number: 11, title: "已经留过缺记录", closedAt: daysAgo(2), stateReason: "COMPLETED", comments: [track("unrecorded", "closed", daysAgo(1))] },
  { number: 13, title: "不做但没说", closedAt: daysAgo(5), stateReason: "NOT_PLANNED", comments: [] },
];

const plan = () => planSweep({ open, closed, merged, openPrs, now: NOW });

describe("issue 巡检：要做什么", () => {
  it("关联：head 是 task/<issue>/… 或正文有关闭关键字；Refs 不算", () => {
    expect(linkedIssues(merged[0])).toEqual([1]);
    expect(linkedIssues(merged[1])).toEqual([2]);
    expect(linkedIssues({ headRefName: "task/5/a", body: "Closes #5\nCloses #6" }).sort()).toEqual([5, 6]);
  });

  it("三件事各就各位：补关、超期、缺记录，其余不动", () => {
    expect(plan().map((action: { type: string, issue: { number: number } }) => `${action.type} #${action.issue.number}`)).toEqual([
      "close #1", "close #2", "overdue #3", "overdue #4", "overdue #12", "overdue #14", "close #17", "overdue #18", "overdue #19", "unrecorded #7", "unrecorded #13",
    ]);
  });

  it("补关：写「关闭」记录，引用 PR 与合并提交", () => {
    const [first] = plan();
    expect(first.pr.number).toBe(101);
    expect(first.body.split("\n")[0]).toBe("<!-- yzgc:track v1 kind=closed stage=merged -->");
    expect(first.body).toContain("**关闭**｜PR #101 已合并进 `stage`，巡检补关这个 issue");
    expect(first.body).toContain(`合并提交 ${"a".repeat(40)}`);
    expect(first.body).toContain(`**引用**：#101 · ${"a".repeat(12)}`);
    expect(first.body).toContain(`在 ${beijing(daysAgo(2))}（北京时间）合并`);
  });

  it("不补关：GitHub 标着 REOPENED 的（旧格式的文字关闭评论认不出来）、还有开着的 PR 关联的、PR 合并不到一小时的", () => {
    const numbers = (actions: Array<{ type: string, issue: { number: number } }>) => actions.filter((action) => action.type === "close").map((action) => action.issue.number);
    expect(numbers(plan())).toEqual([1, 2, 17]);
    // 去掉 REOPENED 就会被旧 PR 再关一次：这正是要防的
    const notReopened = open.map((issue) => (issue.number === 14 ? { ...issue, stateReason: undefined, reopenedAt: undefined } : issue));
    expect(numbers(planSweep({ open: notReopened, closed, merged, openPrs, now: NOW }))).toEqual([1, 2, 14, 17]);
    expect(numbers(planSweep({ open, closed, merged, now: NOW }))).toEqual([1, 2, 15, 17, 18]);
    expect(numbers(planSweep({ open, closed, merged, openPrs, now: new Date(NOW.getTime() + 2 * 3_600_000) }))).toEqual([1, 2, 16, 17]);
  });

  it("两次合并夹着一次重开：按最近一次合并算，重开早于它就补关，和 PR 列表的顺序无关", () => {
    const issue = { number: 20, title: "修了一次又重开", updatedAt: daysAgo(1), stateReason: "REOPENED", reopenedAt: daysAgo(5), comments: [] };
    const first = { number: 140, title: "第一次修", headRefName: "task/20/first", baseRefName: "stage", body: "Closes #20", mergedAt: daysAgo(10), mergeCommit: { oid: "6".repeat(40) } };
    const second = { number: 141, title: "重开后再修", headRefName: "someone/fix20", baseRefName: "stage", body: "Closes #20", mergedAt: daysAgo(2), mergeCommit: { oid: "7".repeat(40) } };
    for (const order of [[first, second], [second, first]]) {
      const actions = planSweep({ open: [issue], closed: [], merged: order, now: NOW });
      expect(actions.map((action: { type: string, pr?: { number: number } }) => `${action.type} ${action.pr?.number}`)).toEqual(["close 141"]);
    }
    // 只有重开之前的那次合并：不补关（一天前刚动过，也还没超期）
    expect(planSweep({ open: [issue], closed: [], merged: [first], now: NOW })).toEqual([]);
  });

  it("没补关的超期 issue，「超期」记录写明已合并的 PR 和没补关的原因", () => {
    const body = (number: number) => plan().find((action: { issue: { number: number } }) => action.issue.number === number).body;
    expect(body(14)).toContain(`关联的 PR #21 在 ${beijing(daysAgo(40))} 合并进 stage，之后这个 issue 在 ${beijing(daysAgo(30))} 又被重开，巡检不再补关`);
    expect(body(19)).toContain(`关联的 PR #119 在 ${beijing(daysAgo(30))} 合并进 stage，这个 issue 被重开过（查不到重开时间，按合并后重开处理），巡检不再补关`);
    expect(body(3)).toContain(`关联的 PR #104 在 ${beijing(daysAgo(20))} 合并进 stage，之后留过「关闭」记录，这个 issue 又被重开，巡检不再补关`);
    expect(body(18)).toContain("关联的 PR #118 已合并进 stage，但还有开着的 PR #130 关联它，巡检不补关");
    expect(body(4)).toContain("还开着，stage 上没有关联它的已合并 PR；");
  });

  it("合并后关过又被重开的不再去关，按超期算；超期记录沿用最后一条记录的阶段", () => {
    const actions = plan();
    const reopened = actions.find((action: { issue: { number: number } }) => action.issue.number === 3);
    expect(reopened.type).toBe("overdue");
    expect(reopened.body.split("\n")[0]).toBe("<!-- yzgc:track v1 kind=overdue stage=review -->");
    const idle = actions.find((action: { issue: { number: number } }) => action.issue.number === 4);
    expect(idle.body).toContain("**超期**｜14 天没有动静");
    expect(idle.body).toContain("已经 20 天");
    const noRecords = actions.find((action: { issue: { number: number } }) => action.issue.number === 12);
    expect(noRecords.body.split("\n")[0]).toBe("<!-- yzgc:track v1 kind=overdue stage=triage -->");
  });

  it("缺记录：只看 closed-days 天内关闭的；有合并 PR、有「关闭」记录、已经留过的都跳过；不重开", () => {
    const [missing, notPlanned] = plan().filter((action: { type: string }) => action.type === "unrecorded");
    expect(missing.body.split("\n")[0]).toBe("<!-- yzgc:track v1 kind=unrecorded stage=closed -->");
    expect(missing.body).toContain("以「完成」关闭");
    expect(missing.body).toContain("巡检不重开");
    expect(notPlanned.body).toContain("以「不做」关闭");
    expect(planSweep({ open: [], closed, merged, now: NOW, closedDays: 60 }).map((action: { issue: { number: number } }) => action.issue.number)).toEqual([7, 10, 13]);
  });

  it("阈值可调：idle-days 设成 30 时两周没动静的不算超期", () => {
    expect(planSweep({ open, closed: [], merged, openPrs, now: NOW, idleDays: 30 }).map((action: { type: string }) => action.type)).toEqual(["close", "close", "close"]);
  });

  it("记录格式与 TRACKING.md §3 一致，新增的两种类型写进了 TRACKING 的类型表", () => {
    const tracking = readFileSync(new URL("../../docs/conventions/TRACKING.md", import.meta.url), "utf8");
    for (const action of plan()) {
      const [head, title, blank, ...fields] = action.body.split("\n");
      const match = TRACK_RE.exec(head);
      expect(match).not.toBeNull();
      expect(["triage", "dev", "review", "merged", "released", "closed"]).toContain(match![2]);
      expect(tracking).toContain(`| \`${match![1]}\` |`);
      expect(title).toMatch(/^\*\*[^*]+\*\*｜\S/);
      expect(blank).toBe("");
      for (const field of fields) expect(field).toMatch(/^\*\*(现状|证据|下一步|引用)\*\*：/);
    }
  });

  it("运行摘要：列出每个 issue 的处理，标题里的 | 转义；没有事时说没有", () => {
    const report = renderReport(plan().map((action: object) => ({ action })), { apply: false, now: NOW });
    expect(report).toContain("只读，没有改 GitHub");
    expect(report).toContain("| #1 | 将补关 | PR #101 已合并进 stage，issue 还开着 | 合并了还开着 |");
    expect(report).toContain("合并后关过又被重开 \\| 还没修好");
    expect(renderReport([], { apply: true, now: NOW })).toContain("没有要处理的 issue。");
  });
});

describe("issue 巡检：命令行（假 gh）", () => {
  const dirs: string[] = [];
  afterEach(() => {
    for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
  });

  /** 假 gh：list 类查询回夹具，其它调用追加到日志里 */
  function fakeGh(fixtures: { open: object[], closed: object[], merged: object[], openPrs?: object[], comments?: Record<string, object[]>, reopenedAt?: Record<string, string> }, { failOn }: { failOn?: string } = {}) {
    const dir = mkdtempSync(join(tmpdir(), "geek-issue-sweep-"));
    dirs.push(dir);
    writeFileSync(join(dir, "fixtures.json"), JSON.stringify(fixtures));
    writeFileSync(join(dir, "gh"), [
      `#!${process.execPath}`,
      'const { appendFileSync, readFileSync } = require("node:fs");',
      "const args = process.argv.slice(2);",
      `const fixtures = JSON.parse(readFileSync(${JSON.stringify(join(dir, "fixtures.json"))}, "utf8"));`,
      'const state = args[args.indexOf("--state") + 1];',
      'if (args[0] === "pr" && args[1] === "list") { console.log(JSON.stringify(state === "open" ? fixtures.openPrs ?? [] : fixtures.merged)); process.exit(0); }',
      'if (args[0] === "issue" && args[1] === "list") { console.log(JSON.stringify(state === "open" ? fixtures.open : fixtures.closed)); process.exit(0); }',
      // gh api graphql …-F number=<n>：回这个 issue 最后一次重开的时间（夹具 reopenedAt，没有就空，"FAIL" 就像 GitHub 出错那样失败）。
      // 查询必须是时间线上最后一次重开（REOPENED_EVENT、last: 1），不是就失败；每次查询记进 graphql.log
      'if (args[0] === "api" && args[1] === "graphql") {',
      '  const query = args.find((arg) => arg.startsWith("query=")) ?? "";',
      `  appendFileSync(${JSON.stringify(join(dir, "graphql.log"))}, JSON.stringify(query) + "\\n");`,
      '  if (!query.includes("REOPENED_EVENT") || !query.includes("last: 1")) { console.error("假 gh：查询不是时间线上最后一次重开"); process.exit(2); }',
      '  const at = fixtures.reopenedAt?.[args.find((arg) => arg.startsWith("number=")).slice(7)] ?? "";',
      '  if (at === "FAIL") { console.error("HTTP 502"); process.exit(1); }',
      '  console.log(at); process.exit(0);',
      '}',
      // gh api --paginate repos/<repo>/issues/<n>/comments --jq '… | @json'：每行一条评论
      'if (args[0] === "api") { const n = /issues\\/(\\d+)\\/comments/.exec(args.join(" "))[1]; for (const c of fixtures.comments?.[n] ?? []) console.log(JSON.stringify(c)); process.exit(0); }',
      `appendFileSync(${JSON.stringify(join(dir, "calls.log"))}, JSON.stringify(args) + "\\n");`,
      `if (${JSON.stringify(failOn ?? "")} && args[2] === ${JSON.stringify(failOn ?? "")}) { console.error("HTTP 403"); process.exit(1); }`,
      "",
    ].join("\n"));
    chmodSync(join(dir, "gh"), 0o755);
    return dir;
  }

  const sweep = (dir: string, args: string[]) => spawnSync(process.execPath, [new URL("../../scripts/issue-sweep.mjs", import.meta.url).pathname, ...args], {
    encoding: "utf8", env: { ...process.env, PATH: `${dir}:${process.env.PATH}` },
  });
  const calls = (dir: string) => {
    try {
      return readFileSync(join(dir, "calls.log"), "utf8").trim().split("\n").filter(Boolean).map((line) => JSON.parse(line));
    } catch {
      return [];
    }
  };

  // 命令行用真实的当前时间，夹具按当前时间往前推
  const fresh = () => ({
    open: [
      { number: 1, title: "合并了还开着", updatedAt: new Date().toISOString(), comments: [] },
      { number: 4, title: "两周没人动", updatedAt: new Date(Date.now() - 20 * 86_400_000).toISOString(), comments: [] },
    ],
    closed: [{ number: 7, title: "关了没记录", closedAt: new Date(Date.now() - 3_600_000).toISOString(), stateReason: "COMPLETED", comments: [] }],
    merged: [{ number: 101, title: "PR", headRefName: "task/1/done", baseRefName: "stage", body: "Closes #1", mergedAt: new Date(Date.now() - 2 * 3_600_000).toISOString(), mergeCommit: { oid: "a".repeat(40) } }],
  });

  it("不带 --apply 只读：不调用任何写操作", () => {
    const dir = fakeGh(fresh());
    const result = sweep(dir, ["--repo", "org/repo"]);
    expect(result.status).toBe(0);
    expect(result.stdout).toContain("| #1 | 将补关 |");
    expect(calls(dir)).toEqual([]);
  });

  it("--apply：补关用 issue close --reason completed --comment，其余用 issue comment；有一个失败就以 1 退出", () => {
    const dir = fakeGh(fresh());
    const result = sweep(dir, ["--apply", "--repo", "org/repo"]);
    expect(result.status).toBe(0);
    const log = calls(dir);
    expect(log.map((args: string[]) => args.slice(0, 3).join(" "))).toEqual(["issue close 1", "issue comment 4", "issue comment 7"]);
    expect(log[0]).toEqual(expect.arrayContaining(["--repo", "org/repo", "--reason", "completed", "--comment"]));
    expect(log[0][log[0].indexOf("--comment") + 1]).toMatch(/^<!-- yzgc:track v1 kind=closed stage=merged -->/);
    expect(log[1][log[1].indexOf("--body") + 1]).toMatch(/^<!-- yzgc:track v1 kind=overdue stage=triage -->/);
    expect(result.stdout).toContain("| #7 | 已留「缺记录」 |");

    const failing = fakeGh(fresh(), { failOn: "4" });
    const partial = sweep(failing, ["--apply", "--repo", "org/repo"]);
    expect(partial.status).toBe(1);
    expect(partial.stdout).toContain("| #4 | 失败：HTTP 403 |");
    expect(calls(failing)).toHaveLength(3); // 一个失败不影响其它
  });

  it("评论到了 100 条就翻页取全：第 101 条才是「关闭」记录时不留「缺记录」", () => {
    const hundred = Array.from({ length: 100 }, (_, i) => ({ body: `第 ${i + 1} 条讨论`, createdAt: new Date(Date.now() - 7_200_000).toISOString() }));
    const closedRecord = { body: "<!-- yzgc:track v1 kind=closed stage=closed -->\n**关闭**｜不做了", createdAt: new Date(Date.now() - 3_600_000).toISOString() };
    const fixtures = {
      open: [],
      closed: [{ number: 7, title: "讨论很长", closedAt: new Date(Date.now() - 3_600_000).toISOString(), stateReason: "NOT_PLANNED", comments: hundred }],
      merged: [],
      comments: { 7: [...hundred, closedRecord] },
    };
    const dir = fakeGh(fixtures);
    const result = sweep(dir, ["--repo", "org/repo"]);
    expect(result.status).toBe(0);
    expect(result.stdout).toContain("没有要处理的 issue。");
    const truncated = fakeGh({ ...fixtures, comments: { 7: hundred } });
    expect(sweep(truncated, ["--repo", "org/repo"]).stdout).toContain("| #7 | 将留「缺记录」 |");
  });

  it("stateReason 是 REOPENED 的 issue 去时间线查重开时间：重开在合并之前就补关，之后就不关", () => {
    const hoursAgo = (hours: number) => new Date(Date.now() - hours * 3_600_000).toISOString();
    const fixtures = {
      open: [{ number: 5, title: "重开过", updatedAt: hoursAgo(1), stateReason: "REOPENED", comments: [] }],
      closed: [],
      merged: [{ number: 150, title: "PR", headRefName: "someone/patch", baseRefName: "stage", body: "Closes #5", mergedAt: hoursAgo(3), mergeCommit: { oid: "a".repeat(40) } }],
    };
    expect(sweep(fakeGh({ ...fixtures, reopenedAt: { 5: hoursAgo(5) } }), ["--repo", "org/repo"]).stdout).toContain("| #5 | 将补关 |");
    expect(sweep(fakeGh({ ...fixtures, reopenedAt: { 5: hoursAgo(2) } }), ["--repo", "org/repo"]).stdout).toContain("没有要处理的 issue。");
    expect(sweep(fakeGh(fixtures), ["--repo", "org/repo"]).stdout).toContain("没有要处理的 issue。");
    // 假 gh 只认时间线上最后一次重开的查询：每个 REOPENED 的 issue 查一次，查询都带 REOPENED_EVENT 和 last: 1
    const dir = fakeGh({ ...fixtures, reopenedAt: { 5: hoursAgo(5) } });
    sweep(dir, ["--repo", "org/repo"]);
    const queries = readFileSync(join(dir, "graphql.log"), "utf8").trim().split("\n").map((line) => JSON.parse(line));
    expect(queries).toHaveLength(1);
    expect(queries[0]).toContain("timelineItems(itemTypes: [REOPENED_EVENT], last: 1)");
  });

  it("GraphQL 查询失败：当作合并后重开，不补关；超期记录写明查不到重开时间", () => {
    const daysBack = (days: number) => new Date(Date.now() - days * 86_400_000).toISOString();
    const dir = fakeGh({
      open: [{ number: 5, title: "重开过", updatedAt: daysBack(20), stateReason: "REOPENED", comments: [] }],
      closed: [],
      merged: [{ number: 150, title: "PR", headRefName: "task/5/x", baseRefName: "stage", body: "Closes #5", mergedAt: daysBack(30), mergeCommit: { oid: "a".repeat(40) } }],
      reopenedAt: { 5: "FAIL" },
    });
    const result = sweep(dir, ["--apply", "--repo", "org/repo"]);
    expect(result.status).toBe(0);
    expect(result.stdout).toContain("| #5 | 已留「超期」 |");
    const log = calls(dir);
    expect(log.map((args: string[]) => args.slice(0, 3).join(" "))).toEqual(["issue comment 5"]);
    expect(log[0][log[0].indexOf("--body") + 1]).toContain("关联的 PR #150 在");
    expect(log[0][log[0].indexOf("--body") + 1]).toContain("这个 issue 被重开过（查不到重开时间，按合并后重开处理），巡检不再补关");
  });
});

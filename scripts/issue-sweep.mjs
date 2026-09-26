#!/usr/bin/env node
// issue 巡检（docs/conventions/TRACKING.md §1「做完当场关」，#115）。issue-lifecycle.yml 每天跑一次 --apply。
//
//   node scripts/issue-sweep.mjs [--repo <owner/name>]            只读：列出巡检要做的事，不改 GitHub
//   node scripts/issue-sweep.mjs --apply [--repo <owner/name>]    照着做：关闭 issue、留追踪记录（GH_TOKEN 要有 issues: write）
//   可选：--idle-days <n>（默认 14）、--closed-days <n>（默认 14）
//
// 三件事，结果以 Markdown 表格打到标准输出（工作流写进运行摘要）：
//   1. 关闭：开着的 issue，关联的 PR 已经合并进 stage（PR 的 head 是 task/<issue>/…，或正文写了 Closes #<issue>）。
//      close-on-merge 本该在合并时关掉它；没关上（工作流失败、PR 不是 task 分支）就在这里补关，留「关闭」记录。
//      这些情况不补关，按下一条算：最近一次合并之后有人重开过（重开时间取 GitHub 时间线上最后一次 REOPENED_EVENT；
//      stateReason 在 issue 开着时一直是 REOPENED，只能说明重开过，不能说明是在合并前还是合并后；查不到重开时间就当作
//      合并后重开。合并之后已经有过「关闭」记录也算，旧的 issue 当初是用普通文字关的，只能靠前者认出来）；
//      还有开着的 PR 关联同一个 issue。这样的 issue 超期时，「超期」记录写明已合并的 PR 和它为什么没被补关。
//      合并不到一小时的 PR 先不管，那是 close-on-merge 的事，免得两边各留一条。
//   2. 超期：其余开着的 issue，idle-days 天没有任何动静（GitHub 的 updatedAt）：留一条「超期」记录，写明三种处理办法。
//      留言本身会刷新 updatedAt，所以同一个 issue 最多每 idle-days 天一条。
//   3. 缺记录：closed-days 天内关闭的 issue，既没有关联的已合并 PR，也没有「关闭」记录（#112 那样）：
//      留一条「缺记录」请关闭的人补上。不重开；同一个 issue 只留一次。
// 只用 gh 读写 issue 的状态与评论，不碰代码、分支和 PR。判断在纯函数 planSweep 里，测试在 tests/tooling/issue-sweep.test.ts。
import { execFileSync } from "node:child_process";
import { realpathSync } from "node:fs";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { closingIssues, issueFromBranch } from "./pr-contract.mjs";

const DAY_MS = 24 * 60 * 60 * 1000;
/** 合并不到这么久的 PR 留给 close-on-merge */
export const MERGE_GRACE_MS = 60 * 60 * 1000;
/** gh issue list 每个 issue 最多带回这么多条评论；到了这个数就单独翻页取全 */
export const COMMENT_PAGE = 100;
export const DEFAULT_IDLE_DAYS = 14;
export const DEFAULT_CLOSED_DAYS = 14;
/** 追踪记录头（docs/conventions/TRACKING.md §3） */
export const TRACK_RE = /^<!-- yzgc:track v1 kind=([a-z]+) stage=([a-z]+) -->/;
const STATE_REASON = { COMPLETED: "完成", NOT_PLANNED: "不做", DUPLICATE: "重复" };

// ── 纯函数 ───────────────────────────────────────────────────────────────

/** ISO 时间 → 北京时间「YYYY-MM-DD HH:MM」 */
export function beijing(iso) {
  return new Date(Date.parse(iso) + 8 * 60 * 60 * 1000).toISOString().replace("T", " ").slice(0, 16);
}

/** 一个已合并的 PR 关联了哪些 issue：head 分支 task/<issue>/…，加上正文里的 Closes/Fixes/Resolves #n */
export function linkedIssues(pr) {
  const issues = new Set(closingIssues(pr.body));
  const fromBranch = issueFromBranch(pr.headRefName);
  if (fromBranch !== null) issues.add(fromBranch);
  return [...issues];
}

/** 评论里的追踪记录：[{ kind, stage, createdAt }]，按原顺序 */
export function trackRecords(comments = []) {
  return comments.flatMap((comment) => {
    const match = TRACK_RE.exec(String(comment.body ?? "").trimStart());
    return match ? [{ kind: match[1], stage: match[2], createdAt: comment.createdAt }] : [];
  });
}

export function closeNote(pr) {
  const sha = pr.mergeCommit?.oid ?? "";
  return [
    "<!-- yzgc:track v1 kind=closed stage=merged -->",
    `**关闭**｜PR #${pr.number} 已合并进 \`stage\`，巡检补关这个 issue`,
    "",
    `**现状**：PR #${pr.number}「${pr.title ?? ""}」在 ${beijing(pr.mergedAt)}（北京时间）合并${sha ? `，合并提交 ${sha}` : ""}；合并时这个 issue 没有关上（close-on-merge 没跑成，或者 PR 不是从 task 分支来的），巡检补关。`,
    "**下一步**：随下一个 `vX.Y.Z-rc.N` 发到预发布，由所有者验收（docs/conventions/RELEASES.md）。",
    `**引用**：#${pr.number}${sha ? ` · ${sha.slice(0, 12)}` : ""}`,
  ].join("\n");
}

/**
 * 超期的 issue 和 PR 的关系，写进「超期」记录的现状：
 * pr 是关联的已合并 PR（没有就是 null），reopenedAt 是合并后重开的时间（null 表示没重开或查不到），openPrNumbers 是关联它的开着的 PR。
 */
export function situation({ pr = null, reopened = false, reopenedAt = null, openPrNumbers = [] }) {
  const open = openPrNumbers.map((number) => `#${number}`).join("、");
  if (pr && reopened) return `关联的 PR #${pr.number} 在 ${beijing(pr.mergedAt)} 合并进 stage，之后这个 issue ${reopenedAt ? `在 ${beijing(reopenedAt)} ` : ""}又被重开，巡检不再补关`;
  if (pr && open) return `关联的 PR #${pr.number} 已合并进 stage，但还有开着的 PR ${open} 关联它，巡检不补关`;
  if (open) return `关联的 PR ${open} 还开着，stage 上没有关联它的已合并 PR`;
  return "stage 上没有关联它的已合并 PR";
}

export function overdueNote({ updatedAt, idleDays, stage, days, context = situation({}) }) {
  return [
    `<!-- yzgc:track v1 kind=overdue stage=${stage} -->`,
    `**超期**｜${idleDays} 天没有动静，请负责人决定关掉、拆出外部等待，还是接着做`,
    "",
    `**现状**：还开着，${context}；最后一次更新在 ${beijing(updatedAt)}（北京时间），已经 ${days} 天。`,
    "**下一步**：按 docs/conventions/TRACKING.md §1 三选一：做完了（运维操作、决定不做、被别的改动顺带解决）就写一条「关闭」记录并关掉；只剩外部等待就关掉这个 issue，把剩下的一步开成新 issue、写明负责人；还要接着做就留一条「进展」，写清卡在哪、谁在做。",
  ].join("\n");
}

export function unrecordedNote({ closedAt, stateReason }) {
  const reason = STATE_REASON[stateReason] ?? stateReason ?? "未注明";
  return [
    "<!-- yzgc:track v1 kind=unrecorded stage=closed -->",
    "**缺记录**｜关闭了，但没有合并的 PR，也没有「关闭」记录",
    "",
    `**现状**：${beijing(closedAt)}（北京时间）以「${reason}」关闭；stage 上没有关联这个 issue 的已合并 PR（head 是 task/<issue>/…，或正文写了 Closes #<issue>），评论里也没有「关闭」记录。巡检不重开。`,
    "**下一步**：关闭的人补一条「关闭」记录（docs/conventions/TRACKING.md §3）：做了什么、在哪里验证的、剩下的事交给了哪个 issue；其实还没做完就重开，再写一条「进展」。",
  ].join("\n");
}

/**
 * 算出巡检要做的事。
 * @param {{
 *   open: Array<{ number: number, title: string, updatedAt: string, stateReason?: string, reopenedAt?: string | null, comments?: Array<{ body: string, createdAt: string }> }>,
 *     reopenedAt：时间线上最后一次重开的时间，stateReason 是 REOPENED 时由 load 查好；查不到是 null
 *   closed: Array<{ number: number, title: string, closedAt: string, stateReason?: string, comments?: Array<{ body: string, createdAt: string }> }>,
 *   merged: Array<{ number: number, title?: string, headRefName: string, baseRefName?: string, body?: string, mergedAt: string, mergeCommit?: { oid: string } }>,
 *   openPrs?: Array<{ number: number, headRefName: string, body?: string }>,
 *   now?: Date, idleDays?: number, closedDays?: number,
 * }} input
 * @returns {Array<{ type: "close" | "overdue" | "unrecorded", issue: object, pr?: object, body: string, reason: string }>}
 */
export function planSweep({ open, closed, merged, openPrs = [], now = new Date(), idleDays = DEFAULT_IDLE_DAYS, closedDays = DEFAULT_CLOSED_DAYS }) {
  const mergedFor = new Map();
  for (const pr of merged) {
    if (pr.baseRefName && pr.baseRefName !== "stage") continue;
    for (const issue of linkedIssues(pr)) {
      const previous = mergedFor.get(issue);
      if (!previous || Date.parse(pr.mergedAt) > Date.parse(previous.mergedAt)) mergedFor.set(issue, pr);
    }
  }

  const openPrsFor = new Map();
  for (const pr of openPrs) for (const issue of linkedIssues(pr)) openPrsFor.set(issue, [...(openPrsFor.get(issue) ?? []), pr.number]);

  const actions = [];
  for (const issue of [...open].sort((a, b) => a.number - b.number)) {
    const records = trackRecords(issue.comments);
    const pr = mergedFor.get(issue.number);
    if (pr && now.getTime() - Date.parse(pr.mergedAt) < MERGE_GRACE_MS) continue;
    // 最近一次合并之后重开过：重开时间查不到时当作合并后重开，宁可不关
    const reopenedAfterMerge = Boolean(pr) && ((issue.stateReason === "REOPENED" && (!issue.reopenedAt || Date.parse(issue.reopenedAt) > Date.parse(pr.mergedAt)))
      || records.some((record) => record.kind === "closed" && Date.parse(record.createdAt) >= Date.parse(pr.mergedAt)));
    const openPrNumbers = openPrsFor.get(issue.number) ?? [];
    if (pr && !reopenedAfterMerge && !openPrNumbers.length) {
      actions.push({ type: "close", issue, pr, body: closeNote(pr), reason: `PR #${pr.number} 已合并进 stage，issue 还开着` });
      continue;
    }
    const days = Math.floor((now.getTime() - Date.parse(issue.updatedAt)) / DAY_MS);
    if (days >= idleDays) {
      const stage = records.at(-1)?.stage ?? "triage";
      const context = situation({ pr, reopened: reopenedAfterMerge, reopenedAt: reopenedAfterMerge ? issue.reopenedAt ?? null : null, openPrNumbers });
      actions.push({ type: "overdue", issue, body: overdueNote({ updatedAt: issue.updatedAt, idleDays, stage, days, context }), reason: `${days} 天没有动静` });
    }
  }

  const since = now.getTime() - closedDays * DAY_MS;
  for (const issue of [...closed].sort((a, b) => a.number - b.number)) {
    if (Date.parse(issue.closedAt) < since || mergedFor.has(issue.number)) continue;
    const kinds = trackRecords(issue.comments).map((record) => record.kind);
    if (kinds.includes("closed") || kinds.includes("unrecorded")) continue;
    actions.push({ type: "unrecorded", issue, body: unrecordedNote(issue), reason: "关闭了，没有已合并的 PR，也没有「关闭」记录" });
  }
  return actions;
}

const LABEL = {
  close: { plan: "将补关", done: "已补关" },
  overdue: { plan: "将留「超期」", done: "已留「超期」" },
  unrecorded: { plan: "将留「缺记录」", done: "已留「缺记录」" },
};

const cell = (text) => String(text ?? "").replace(/\|/g, "\\|").replace(/\s*\n\s*/g, " ");

/** 运行摘要：results 是 [{ action, error? }]，apply 为 false 时只列计划 */
export function renderReport(results, { apply, now = new Date() }) {
  const lines = [`## issue 巡检（${beijing(now.toISOString())} 北京时间，${apply ? "已执行" : "只读，没有改 GitHub"}）`, ""];
  if (!results.length) {
    lines.push("没有要处理的 issue。");
    return `${lines.join("\n")}\n`;
  }
  lines.push("| issue | 处理 | 原因 | 标题 |", "|---|---|---|---|");
  for (const { action, error } of results) {
    const status = error ? `失败：${cell(error)}` : LABEL[action.type][apply ? "done" : "plan"];
    lines.push(`| #${action.issue.number} | ${status} | ${cell(action.reason)} | ${cell(action.issue.title)} |`);
  }
  lines.push("", "规则见 docs/conventions/TRACKING.md §1：做完当场关；不走 PR 做完的留「关闭」记录再关；只剩外部等待的关掉原 issue，剩下的一步开新 issue 写明负责人。");
  return `${lines.join("\n")}\n`;
}

// ── 读写 GitHub ─────────────────────────────────────────────────────────

function gh(args) {
  return execFileSync("gh", args, { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"], maxBuffer: 64 * 1024 * 1024 });
}

/** 评论到了 COMMENT_PAGE 条的 issue，用 REST 接口翻页把评论取全 */
function allComments(issue, repo) {
  if ((issue.comments?.length ?? 0) < COMMENT_PAGE) return issue;
  const path = `repos/${repo ?? "{owner}/{repo}"}/issues/${issue.number}/comments?per_page=100`;
  const lines = gh(["api", "--paginate", path, "--jq", ".[] | {body, createdAt: .created_at} | @json"]).split("\n").filter(Boolean);
  return { ...issue, comments: lines.map((line) => JSON.parse(line)) };
}

const REOPENED_QUERY = "query($owner: String!, $name: String!, $number: Int!) { repository(owner: $owner, name: $name) { issue(number: $number) { timelineItems(itemTypes: [REOPENED_EVENT], last: 1) { nodes { ... on ReopenedEvent { createdAt } } } } } }";

/** stateReason 是 REOPENED 的 issue，查时间线上最后一次重开的时间；查不到是 null（planSweep 当作合并后重开，不补关） */
function withReopenedAt(issue, nameWithOwner) {
  if (issue.stateReason !== "REOPENED") return issue;
  const [owner, name] = nameWithOwner.split("/");
  try {
    const at = gh(["api", "graphql", "-f", `query=${REOPENED_QUERY}`, "-F", `owner=${owner}`, "-F", `name=${name}`, "-F", `number=${issue.number}`,
      "--jq", ".data.repository.issue.timelineItems.nodes[0].createdAt // \"\""]).trim();
    return { ...issue, reopenedAt: at || null };
  } catch {
    return { ...issue, reopenedAt: null };
  }
}

function load({ repo, now, closedDays }) {
  const scope = repo ? ["--repo", repo] : [];
  const since = new Date(now.getTime() - closedDays * DAY_MS).toISOString().slice(0, 10);
  const list = (args) => JSON.parse(gh([...args, ...scope]));
  const withComments = (issues) => issues.map((issue) => allComments(issue, repo));
  const nameWithOwner = repo ?? gh(["repo", "view", "--json", "nameWithOwner", "--jq", ".nameWithOwner"]).trim();
  return {
    open: withComments(list(["issue", "list", "--state", "open", "--limit", "500", "--json", "number,title,updatedAt,stateReason,comments"]))
      .map((issue) => withReopenedAt(issue, nameWithOwner)),
    closed: withComments(list(["issue", "list", "--state", "closed", "--limit", "500", "--search", `closed:>=${since}`, "--json", "number,title,closedAt,stateReason,comments"])),
    merged: list(["pr", "list", "--state", "merged", "--base", "stage", "--limit", "500", "--json", "number,title,headRefName,baseRefName,body,mergedAt,mergeCommit"]),
    openPrs: list(["pr", "list", "--state", "open", "--limit", "500", "--json", "number,headRefName,body"]),
  };
}

function perform(action, repo) {
  const scope = repo ? ["--repo", repo] : [];
  const number = String(action.issue.number);
  if (action.type === "close") gh(["issue", "close", number, ...scope, "--reason", "completed", "--comment", action.body]);
  else gh(["issue", "comment", number, ...scope, "--body", action.body]);
}

function parseArgs(argv) {
  const options = { apply: false, repo: undefined, idleDays: DEFAULT_IDLE_DAYS, closedDays: DEFAULT_CLOSED_DAYS };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--apply") options.apply = true;
    else if (arg === "--repo" && argv[i + 1]) options.repo = argv[++i];
    else if ((arg === "--idle-days" || arg === "--closed-days") && /^[1-9][0-9]*$/.test(argv[i + 1] ?? "")) {
      options[arg === "--idle-days" ? "idleDays" : "closedDays"] = Number(argv[++i]);
    } else throw new Error("用法：node scripts/issue-sweep.mjs [--apply] [--repo <owner/name>] [--idle-days <n>] [--closed-days <n>]");
  }
  return options;
}

function main() {
  const options = parseArgs(process.argv.slice(2));
  const now = new Date();
  const actions = planSweep({ ...load({ ...options, now }), now, idleDays: options.idleDays, closedDays: options.closedDays });
  const results = actions.map((action) => {
    if (!options.apply) return { action };
    try {
      perform(action, options.repo);
      return { action };
    } catch (error) {
      return { action, error: String(error?.stderr || error?.message || error).trim() };
    }
  });
  process.stdout.write(renderReport(results, { apply: options.apply, now }));
  const failed = results.filter((result) => result.error);
  if (failed.length) {
    console.error(`有 ${failed.length} 个 issue 没处理成功：${failed.map((result) => `#${result.action.issue.number}`).join("、")}`);
    process.exitCode = 1;
  }
}

function isDirectRun() {
  if (!process.argv[1]) return false;
  try {
    return pathToFileURL(realpathSync(resolve(process.argv[1]))).href === import.meta.url;
  } catch {
    return false;
  }
}

if (isDirectRun()) {
  try {
    main();
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
}

#!/usr/bin/env node
// 一个 issue = 一个 task 分支 = 一个 git worktree = 一个 PR（docs/conventions/TRACKING.md §1、BRANCHING.md「task worktree」）。
//
//   node scripts/task.mjs start <issue> <slug>   从最新 origin/stage 建 task/<issue>/<slug> 与 worktree，issue 上留一条 progress 记录
//   node scripts/task.mjs list                   列出每个 task worktree：分支、issue 状态、PR 状态、能否清理
//   node scripts/task.mjs finish <issue>         PR 已合并（或 issue 已关闭）且工作区干净时，删 worktree 与本地分支
//   node scripts/task.mjs prune                  对所有能清理的 task worktree 执行 finish
//
// 只动本机的 worktree 与本地分支；远端分支由 branch-hygiene.yml、issue 由 issue-lifecycle.yml 在合并时处理。
// 有未提交改动、或 PR 没合并且 issue 还开着的 worktree 一律不删，只报告原因。纯判断逻辑见 decideCleanup，有单测。
import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

/** task/<issue>/<slug>：与 check-branch-invariants.mjs、pr-contract.mjs 同一条规则 */
export const TASK_BRANCH_RE = /^task\/([0-9]+)\/[a-z0-9]+(?:_[a-z0-9]+)*$/;
export const SLUG_RE = /^[a-z0-9]+(?:_[a-z0-9]+)*$/;
/** worktree 统一放在主工作区的 .claude/worktrees/task-<issue>（已被 .gitignore 忽略） */
export const WORKTREE_DIR = ".claude/worktrees";

export function taskBranch(issue, slug) {
  if (!/^[0-9]+$/.test(String(issue))) throw new Error(`issue 编号必须是数字：${issue}`);
  if (!SLUG_RE.test(String(slug))) throw new Error(`slug 只能用小写字母、数字和下划线（不用 -）：${slug}`);
  return `task/${Number(issue)}/${slug}`;
}

export function worktreePath(mainRoot, issue) {
  return join(mainRoot, WORKTREE_DIR, `task-${Number(issue)}`);
}

export function issueOfBranch(branch) {
  const match = TASK_BRANCH_RE.exec(String(branch ?? ""));
  return match ? Number(match[1]) : null;
}

/** 解析 `git worktree list --porcelain` */
export function parseWorktrees(porcelain) {
  const list = [];
  let current = null;
  for (const line of String(porcelain).split("\n")) {
    if (line.startsWith("worktree ")) {
      current = { path: line.slice(9), branch: null, head: null, detached: false };
      list.push(current);
    } else if (current && line.startsWith("HEAD ")) current.head = line.slice(5);
    else if (current && line.startsWith("branch ")) current.branch = line.slice(7).replace(/^refs\/heads\//, "");
    else if (current && line === "detached") current.detached = true;
  }
  return list;
}

/**
 * 这个 task worktree 能不能清理。
 * @param {{ dirty: boolean, issueState: string | null, prState: string | null }} input
 *   dirty：worktree 里有未提交或未跟踪的改动；issueState：OPEN / CLOSED / null（查不到）；
 *   prState：这条分支最近一个 PR 的状态 MERGED / OPEN / CLOSED / null（没有 PR）
 * @returns {{ ok: boolean, reason: string }}
 */
export function decideCleanup({ dirty, issueState, prState }) {
  if (dirty) return { ok: false, reason: "有未提交的改动：先提交或自己处理，脚本不替你丢弃" };
  if (prState === "MERGED") return { ok: true, reason: "PR 已合并" };
  if (prState === "OPEN") return { ok: false, reason: "PR 还开着：合并后再清理" };
  if (issueState === "CLOSED") return { ok: true, reason: prState === "CLOSED" ? "PR 已关闭且 issue 已关闭（放弃）" : "issue 已关闭，没有 PR（放弃）" };
  if (issueState === "OPEN") return { ok: false, reason: prState === "CLOSED" ? "PR 被关了但 issue 还开着：要么重开 PR，要么在 issue 上写明放弃并关闭" : "issue 还开着，还在做" };
  return { ok: false, reason: "查不到 issue 状态（离线或没有 gh 权限）：不清理" };
}

// ── 带副作用的部分 ────────────────────────────────────────────────────────

const here = dirname(fileURLToPath(import.meta.url));

function run(cmd, args, options = {}) {
  return execFileSync(cmd, args, { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"], ...options }).trim();
}

/** 主工作区根目录：在任何一个 worktree 里运行都能找到（git-common-dir 的上一级） */
function mainRoot() {
  const common = run("git", ["rev-parse", "--path-format=absolute", "--git-common-dir"], { cwd: here });
  return dirname(common);
}

function gh(args) {
  try {
    return run("gh", args);
  } catch {
    return null;
  }
}

function issueState(issue) {
  return gh(["issue", "view", String(issue), "--json", "state", "--jq", ".state"]);
}

function prState(branch) {
  const out = gh(["pr", "list", "--head", branch, "--state", "all", "--limit", "1", "--json", "state,number", "--jq", '.[0] | "\\(.state) \\(.number)"']);
  if (!out) return { state: null, number: null };
  const [state, number] = out.split(" ");
  return { state: state || null, number: number ? Number(number) : null };
}

function isDirty(path) {
  return run("git", ["-C", path, "status", "--porcelain"]).length > 0;
}

function taskWorktrees(root) {
  return parseWorktrees(run("git", ["-C", root, "worktree", "list", "--porcelain"]))
    .map((wt) => ({ ...wt, issue: issueOfBranch(wt.branch) }))
    .filter((wt) => wt.issue !== null);
}

function start(issue, slug) {
  const root = mainRoot();
  const branch = taskBranch(issue, slug);
  const path = worktreePath(root, issue);
  const state = issueState(issue);
  if (state !== "OPEN") throw new Error(`issue #${issue} ${state ? `状态是 ${state}` : "查不到"}：先开 issue（docs/conventions/ISSUES.md），再建 task。`);
  if (existsSync(path)) throw new Error(`${relative(root, path)} 已经存在：一个 issue 只有一个 worktree，直接进去继续做。`);
  const existing = taskWorktrees(root).find((wt) => wt.issue === Number(issue));
  if (existing) throw new Error(`issue #${issue} 已经有 worktree：${existing.path}（分支 ${existing.branch}）。`);
  run("git", ["-C", root, "fetch", "--quiet", "origin", "stage"]);
  run("git", ["-C", root, "worktree", "add", "--quiet", "-b", branch, path, "origin/stage"]);
  const base = run("git", ["-C", path, "rev-parse", "--short=12", "HEAD"]);
  const note = [
    "<!-- yzgc:track v1 kind=progress stage=dev -->",
    `**进展**｜开工：分支 \`${branch}\`，独立 worktree`,
    "",
    `**现状**：从 \`origin/stage\`（${base}）拉出，worktree 在主工作区的 \`${relative(root, path)}\`；PR 合并后由 \`node scripts/task.mjs finish ${Number(issue)}\` 清理。`,
    `**引用**：#${Number(issue)} · ${base}`,
  ].join("\n");
  const commented = gh(["issue", "comment", String(issue), "--body", note]) !== null;
  console.log(`已建 task：${branch}`);
  console.log(`worktree：${path}`);
  console.log(`基于：origin/stage ${base}`);
  console.log(commented ? `已在 issue #${issue} 留开工记录` : `没能在 issue #${issue} 留言（gh 不可用），请手工补一条 progress 记录`);
  console.log(`下一步：cd ${path} && pnpm install --frozen-lockfile`);
}

function inspect(wt) {
  const pr = prState(wt.branch);
  const iss = issueState(wt.issue);
  const dirty = existsSync(wt.path) ? isDirty(wt.path) : false;
  return { ...wt, pr, issueState: iss, dirty, decision: decideCleanup({ dirty, issueState: iss, prState: pr.state }) };
}

function list() {
  const root = mainRoot();
  const rows = taskWorktrees(root).map((wt) => inspect(wt));
  if (!rows.length) {
    console.log("没有 task worktree。");
    return;
  }
  for (const row of rows) {
    const pr = row.pr.number ? `PR #${row.pr.number} ${row.pr.state}` : "没有 PR";
    console.log(`#${row.issue}\t${row.branch}\tissue ${row.issueState ?? "?"}\t${pr}\t${row.dirty ? "有改动" : "干净"}\t${row.decision.ok ? "可清理" : "保留"}：${row.decision.reason}\t${relative(root, row.path)}`);
  }
}

function finishOne(root, wt) {
  const row = inspect(wt);
  if (!row.decision.ok) {
    console.log(`保留 #${row.issue}（${row.branch}）：${row.decision.reason}`);
    return false;
  }
  if (resolve(process.cwd()).startsWith(resolve(row.path))) throw new Error(`当前目录在要删的 worktree 里（${row.path}）：先 cd 到主工作区再运行。`);
  run("git", ["-C", root, "worktree", "remove", row.path]);
  // 合并后本地分支落后于 stage 或已被 squash：-D 删除是预期的；前面已确认 PR 合并或 issue 放弃
  run("git", ["-C", root, "branch", "-D", row.branch]);
  console.log(`已清理 #${row.issue}：删掉 worktree ${relative(root, row.path)} 与本地分支 ${row.branch}（${row.decision.reason}）`);
  return true;
}

function finish(issue) {
  const root = mainRoot();
  const wt = taskWorktrees(root).find((candidate) => candidate.issue === Number(issue));
  if (!wt) {
    console.log(`issue #${issue} 没有 task worktree，不需要清理。`);
    return;
  }
  if (!finishOne(root, wt)) process.exitCode = 1;
}

function prune() {
  const root = mainRoot();
  run("git", ["-C", root, "worktree", "prune"]);
  const all = taskWorktrees(root);
  const cleaned = all.filter((wt) => finishOne(root, wt)).length;
  console.log(`共 ${all.length} 个 task worktree，清理 ${cleaned} 个。`);
}

function main() {
  const [command, a, b] = process.argv.slice(2);
  if (command === "start") return start(a, b);
  if (command === "list") return list();
  if (command === "finish") return finish(a);
  if (command === "prune") return prune();
  throw new Error("用法：node scripts/task.mjs start <issue> <slug> | list | finish <issue> | prune");
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    main();
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
}

#!/usr/bin/env node
// 一个 issue = 一个 task 分支 = 一个 git worktree = 一个 PR（docs/conventions/TRACKING.md §1、BRANCHING.md「task worktree」）。
//
//   node scripts/task.mjs start <issue> <slug>   从最新 origin/stage 建 task/<issue>/<slug> 与 worktree，issue 上留一条 progress 记录，
//                                                并在 worktree 的 notes/ 里写链路第一条「开工」、并入暂存的执行记录
//   node scripts/task.mjs list                   列出每个 task worktree：分支、issue 状态、PR 状态、能否清理
//   node scripts/task.mjs list --check           推送前检查（.githooks/pre-push 调用）：有 PR 已合并或 issue 已关、还没 finish 的
//                                                worktree 就以 1 退出并给出清理命令；查不到 GitHub 只警告，以 0 退出
//   node scripts/task.mjs finish <issue>         PR 已合并（或 issue 已关闭）且工作区干净时，删 worktree 与本地分支，暂存链路的「收尾」记录
//   node scripts/task.mjs prune                  对所有能清理的 task worktree 执行 finish
//
// 只动本机的 worktree 与本地分支；远端分支由 branch-hygiene.yml、issue 由 issue-lifecycle.yml 在合并时处理。
// 有未提交改动、或 PR 没合并且 issue 还开着的 worktree 一律不删，只报告原因。纯判断逻辑见 decideCleanup 与 checkLifecycle，有单测。
// start 与 finish 都要知道是谁在干活（docs/conventions/NOTES.md）：--user <GitHub 用户名> --by <执行者>，
// 或环境变量 GEEK_NOTES_USER / GEEK_NOTES_BY；缺了就不开工、不收尾。
import { execFile, execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, realpathSync, writeFileSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { promisify } from "node:util";
import { addNote, branchSlug, BY_RE, collectChains, flushPending, PENDING_DIR, renderIndex, USER_RE } from "./note.mjs";

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

/**
 * 推送前检查（list --check）：这个 worktree 是不是该清而没清。
 * 「该清」与 decideCleanup 的判断相同，只是不看有没有未提交改动：PR 已合并或 issue 已放弃，worktree 就到头了，
 * 有改动也算没收尾（改动要么另开 issue 带走，要么确认不要），只是提示里要说清楚别替别人丢弃。
 * PR 查不到（离线、gh 没登录）时不下结论：issue 关了也可能还有开着的 PR。
 * @param {{ dirty: boolean, issueState: string | null, prState: string | null, prKnown: boolean }} input
 *   prKnown：PR 查询是否成功（成功但没有 PR 时 prState 为 null）
 * @returns {{ status: "stale" | "unknown" | "ok", reason: string }}
 */
export function checkLifecycle({ dirty, issueState, prState, prKnown }) {
  if (!prKnown) return { status: "unknown", reason: "查不到 PR 的状态（离线或 gh 没登录）" };
  const done = decideCleanup({ dirty: false, issueState, prState });
  if (done.ok) {
    return {
      status: "stale",
      reason: dirty
        ? `${done.reason}，但 worktree 里还有未提交的改动：先确认这些改动是谁的、还要不要（要的另开 issue 带走），不要替别人丢弃；处理完再 finish`
        : `${done.reason}，还没 finish`,
    };
  }
  if (issueState === null) return { status: "unknown", reason: "查不到 issue 的状态（离线或 gh 没登录）" };
  return { status: "ok", reason: done.reason };
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

const execFileAsync = promisify(execFile);
/** 每个 gh 调用最多等这么久：离线时 pre-push 不能一直挂着 */
const GH_TIMEOUT_MS = 20_000;

/** 调 gh，失败（离线、没登录、超时）返回 null；几个 worktree 的查询并发跑。 */
async function gh(args) {
  try {
    const { stdout } = await execFileAsync("gh", args, { encoding: "utf8", timeout: GH_TIMEOUT_MS });
    return stdout.trim();
  } catch {
    return null;
  }
}

async function issueState(issue) {
  return (await gh(["issue", "view", String(issue), "--json", "state", "--jq", ".state"])) || null;
}

/** 这条分支最近一个 PR：{ state, number, known }；known 为 false 表示没查到（离线等），查到但没有 PR 时 state 为 null。 */
async function prState(branch) {
  const out = await gh(["pr", "list", "--head", branch, "--state", "all", "--limit", "1", "--json", "state,number", "--jq", '.[0] // {} | "\\(.state // "") \\(.number // "")"']);
  if (out === null) return { state: null, number: null, known: false };
  const [state, number] = out.split(" ");
  return { state: state || null, number: number ? Number(number) : null, known: true };
}

function hooksEnabled(root) {
  try {
    return run("git", ["-C", root, "config", "--get", "core.hooksPath"]).length > 0;
  } catch {
    return false;
  }
}

function isDirty(path) {
  return run("git", ["-C", path, "status", "--porcelain"]).length > 0;
}

function taskWorktrees(root) {
  return parseWorktrees(run("git", ["-C", root, "worktree", "list", "--porcelain"]))
    .map((wt) => ({ ...wt, issue: issueOfBranch(wt.branch) }))
    .filter((wt) => wt.issue !== null);
}

/** 执行记录的身份：替谁干活（GitHub 用户名）与执行者；缺了直接失败，不开工也不收尾。 */
function notesIdentity(flags) {
  const user = flags.user ?? process.env.GEEK_NOTES_USER;
  const by = flags.by ?? process.env.GEEK_NOTES_BY;
  if (!USER_RE.test(user ?? "") || !BY_RE.test(by ?? "")) {
    throw new Error("先说明是谁在干活（docs/conventions/NOTES.md）：--user <GitHub 用户名> --by <执行者，如 agent-claude-geek-main-08（Claude Code，claude-opus-5-5）>，或设置 GEEK_NOTES_USER / GEEK_NOTES_BY。");
  }
  return { user, by };
}

export function finishTitle(pr, issue) {
  if (pr?.state === "MERGED") {
    return `PR #${pr.number} 已合并，清理 worktree`;
  }
  if (pr?.state === "CLOSED") {
    return `PR #${pr.number} 已关闭未合并，放弃，清理 worktree`;
  }
  return "放弃，清理 worktree";
}

async function start(issue, slug, flags = {}) {
  const identity = notesIdentity(flags);
  const root = mainRoot();
  const branch = taskBranch(issue, slug);
  const path = worktreePath(root, issue);
  const state = await issueState(issue);
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
  const commented = (await gh(["issue", "comment", String(issue), "--body", note])) !== null;
  // 执行链路第一条：开工。之前在 task 分支之外暂存的记录（上一个 task 的收尾等）一起并进这个 worktree，随它的提交入库。
  const chainPath = addNote(path, {
    ...identity, chain: branch, stage: "开工", issues: [String(Number(issue))],
    title: `从 origin/stage ${base} 建 ${branch}`,
    did: `node scripts/task.mjs start ${Number(issue)} ${slug}：建分支与 worktree ${relative(root, path)}，在 issue 上留开工记录`,
    result: commented ? "worktree 已建好，issue 上已留开工记录" : "worktree 已建好；gh 不可用，issue 上的开工记录要手工补",
  });
  let flushed = [];
  try {
    flushed = flushPending(join(root, PENDING_DIR), path);
  } catch (err) {
    console.warn(`暂存记录并入跳过或异常：${err instanceof Error ? err.message : String(err)}`);
  }
  writeFileSync(join(path, "notes", "INDEX.md"), renderIndex(path));
  console.log(`已建 task：${branch}`);
  console.log(`worktree：${path}`);
  console.log(`基于：origin/stage ${base}`);
  console.log(commented ? `已在 issue #${issue} 留开工记录` : `没能在 issue #${issue} 留言（gh 不可用），请手工补一条 progress 记录`);
  console.log(`执行链路：${relative(path, chainPath)}（已写「开工」）${flushed.length ? `；并入暂存记录 ${flushed.length} 个文件` : ""}`);
  console.log(`下一步：cd ${path} && pnpm install --frozen-lockfile；之后每一步用 node scripts/note.mjs add 记下来`);
  if (!hooksEnabled(root)) console.warn("提醒：这台克隆还没启用 pre-push 钩子（分支规则、发布 tag、该清理的 worktree），在主工作区运行一次 pnpm hooks:enable。");
}

async function inspect(wt) {
  const [pr, iss] = await Promise.all([prState(wt.branch), issueState(wt.issue)]);
  const dirty = existsSync(wt.path) ? isDirty(wt.path) : false;
  return {
    ...wt, pr, issueState: iss, dirty,
    decision: decideCleanup({ dirty, issueState: iss, prState: pr.state }),
    lifecycle: checkLifecycle({ dirty, issueState: iss, prState: pr.state, prKnown: pr.known }),
  };
}

async function list(flags = {}) {
  const root = mainRoot();
  const rows = await Promise.all(taskWorktrees(root).map((wt) => inspect(wt)));
  if (flags.check) return check(root, rows);
  if (!rows.length) {
    console.log("没有 task worktree。");
    return;
  }
  for (const row of rows) {
    const pr = row.pr.number ? `PR #${row.pr.number} ${row.pr.state}` : row.pr.known ? "没有 PR" : "PR ?";
    console.log(`#${row.issue}\t${row.branch}\tissue ${row.issueState ?? "?"}\t${pr}\t${row.dirty ? "有改动" : "干净"}\t${row.decision.ok ? "可清理" : "保留"}：${row.decision.reason}\t${relative(root, row.path)}`);
  }
}

/** list --check：该清而没清的 worktree 让推送失败（退出码 1），查不到状态的只警告。 */
function check(root, rows) {
  const stale = rows.filter((row) => row.lifecycle.status === "stale");
  for (const row of rows.filter((candidate) => candidate.lifecycle.status === "unknown")) {
    console.warn(`task.mjs：#${row.issue}（${row.branch}）${row.lifecycle.reason}，这次不拦。`);
  }
  if (!stale.length) {
    const unknown = rows.length - rows.filter((row) => row.lifecycle.status === "ok").length;
    console.log(`task worktree 生命周期通过：${rows.length - unknown} 个还在做${unknown ? `，${unknown} 个查不到状态（只警告）` : ""}。`);
    return;
  }
  console.error("本机有该清理的 task worktree（docs/conventions/BRANCHING.md「task worktree」）：");
  for (const row of stale) {
    const pr = row.pr.number ? `PR #${row.pr.number} ${row.pr.state}` : "没有 PR";
    console.error(`  #${row.issue} ${row.branch}（${pr}，issue ${row.issueState}）：${row.lifecycle.reason}`);
    console.error(`    ${relative(root, row.path)}`);
  }
  console.error("清理（在主工作区运行，带上执行记录的身份）：");
  console.error(`  cd ${root} && GEEK_NOTES_USER=<GitHub 用户名> GEEK_NOTES_BY=<执行者> node scripts/task.mjs finish <issue>`);
  console.error("  一次清掉所有能清的：node scripts/task.mjs prune（有未提交改动的不会删，要先处理）");
  process.exitCode = 1;
}

async function finishOne(root, wt, identity) {
  const row = await inspect(wt);
  if (!row.decision.ok) {
    console.log(`保留 #${row.issue}（${row.branch}）：${row.decision.reason}`);
    return false;
  }
  if (resolve(process.cwd()).startsWith(resolve(row.path))) throw new Error(`当前目录在要删的 worktree 里（${row.path}）：先 cd 到主工作区再运行。`);

  const chainSlug = branchSlug(row.branch);
  const wtChains = collectChains(row.path);
  const wtChain = [...wtChains.values()].find((c) => c.slug === chainSlug);
  const stageChains = collectChains(root);
  const stageChain = [...stageChains.values()].find((c) => c.slug === chainSlug);

  const hasStart = (wtChain && wtChain.files.some((f) => f.entries.some((e) => e.stage === "开工"))) ||
                   (stageChain && stageChain.files.some((f) => f.entries.some((e) => e.stage === "开工")));

  if (hasStart) {
    // 如果 PR 未合并（被放弃关闭），将 worktree 中尚未并入 stage 的 notes 记录复制到 pending，避免只有「收尾」导致链路断裂
    if (row.pr.state !== "MERGED" && wtChain) {
      for (const file of wtChain.files) {
        const dest = join(root, PENDING_DIR, file.rel);
        mkdirSync(dirname(dest), { recursive: true });
        const content = readFileSync(join(row.path, file.rel), "utf8");
        writeFileSync(dest, content);
      }
    }
    // 链路最后一条：收尾。worktree 马上要删，先暂存到主工作区，下一个 task 开工时随它入库。
    addNote(join(root, PENDING_DIR), {
      ...identity, chain: row.branch, stage: "收尾", issues: [String(row.issue)],
      title: finishTitle(row.pr, row.issue),
      did: `node scripts/task.mjs finish ${row.issue}：删 worktree ${relative(root, row.path)} 与本地分支 ${row.branch}`,
      result: row.decision.reason,
    });
  } else {
    console.log(`链路 ${row.branch} 没有「开工」记录，跳过写入收尾记录。`);
  }

  run("git", ["-C", root, "worktree", "remove", row.path]);
  // 合并后本地分支落后于 stage 或已被 squash：-D 删除是预期的；前面已确认 PR 合并或 issue 放弃
  run("git", ["-C", root, "branch", "-D", row.branch]);
  console.log(`已清理 #${row.issue}：删掉 worktree ${relative(root, row.path)} 与本地分支 ${row.branch}（${row.decision.reason}）`);
  return true;
}

async function finish(issue, flags = {}) {
  const identity = notesIdentity(flags);
  const root = mainRoot();
  const wt = taskWorktrees(root).find((candidate) => candidate.issue === Number(issue));
  if (!wt) {
    console.log(`issue #${issue} 没有 task worktree，不需要清理。`);
    return;
  }
  if (!(await finishOne(root, wt, identity))) process.exitCode = 1;
}

async function prune(flags = {}) {
  const identity = notesIdentity(flags);
  const root = mainRoot();
  run("git", ["-C", root, "worktree", "prune"]);
  const all = taskWorktrees(root);
  let cleaned = 0;
  for (const wt of all) if (await finishOne(root, wt, identity)) cleaned += 1;
  console.log(`共 ${all.length} 个 task worktree，清理 ${cleaned} 个。`);
}

async function main() {
  const args = process.argv.slice(2);
  const flags = {};
  const positional = [];
  for (let i = 0; i < args.length; i += 1) {
    if (args[i] === "--user" || args[i] === "--by") flags[args[i].slice(2)] = args[++i];
    else if (args[i] === "--check") flags.check = true;
    else positional.push(args[i]);
  }
  const [command, a, b] = positional;
  if (command === "start") return start(a, b, flags);
  if (command === "list") return list(flags);
  if (command === "finish") return finish(a, flags);
  if (command === "prune") return prune(flags);
  throw new Error("用法：node scripts/task.mjs start <issue> <slug> | list [--check] | finish <issue> | prune，start/finish/prune 还要 --user <GitHub 用户名> --by <执行者>（或 GEEK_NOTES_USER / GEEK_NOTES_BY）");
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
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
}

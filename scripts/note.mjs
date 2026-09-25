#!/usr/bin/env node
// 执行记录（notes/）的写入、索引与核对。规则只在 docs/conventions/NOTES.md 定义，这里是它的实现。
//
//   node scripts/note.mjs add --stage 提交 --issue 91 --title "…" --did "…" --result "…" [--next "…"] [--chain <分支>]
//        身份取 --user / --by，或环境变量 GEEK_NOTES_USER（替谁干活的 GitHub 用户名）/ GEEK_NOTES_BY（执行者）
//   node scripts/note.mjs flush        把暂存的记录（在 task 分支之外写的）并进当前 task worktree
//   node scripts/note.mjs index        重新生成 notes/INDEX.md；--summary 输出全部链路的一览表
//   node scripts/note.mjs check        核对 notes/ 的格式、链路顺序与索引
//   node scripts/note.mjs check --pr --base origin/stage --head task/91/agent_notes
//                                      另外要求这个 task 的链路里有引用本 issue 的 开工、提交、PR、审查
//
// 时间一律取北京时间（Asia/Shanghai，+08:00），由脚本读系统时钟，不接受手填。
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readdirSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

export const TIME_ZONE = "Asia/Shanghai";
/** 链路里一条记录的阶段；开工在最前，收尾在最后。 */
export const STAGES = ["开工", "方案", "开发", "提交", "推送", "PR", "审查", "返工", "合并", "发布", "验收", "阻塞", "收尾"];
/** task 分支进 stage 之前，链路里必须已经有的阶段（都要引用本 issue）。 */
export const REQUIRED_BEFORE_MERGE = ["开工", "提交", "PR", "审查"];
export const USER_RE = /^[a-z0-9](?:[a-z0-9]|-(?=[a-z0-9])){0,38}$/;
export const BY_RE = /^(?:agent|human)-[a-z0-9]+(?:-[a-z0-9]+)*(?:（[^（）\n]+）)?$/;
export const PENDING_DIR = ".claude/notes-pending";
const TASK_RE = /^task\/(\d+)\/[a-z0-9]+(?:_[a-z0-9]+)*$/;
const DATE_RE = /^(\d{4})-(\d{2})-(\d{2})$/;
const SLUG_RE = /^[a-z0-9_]+$/;
const ENTRY_RE = new RegExp(`^## (\\d{2}):(\\d{2}):(\\d{2}) \\+08:00 · (${STAGES.join("|")}) · ((?:#\\d+)(?: #\\d+)*|无 issue) · (\\S.*)$`);
const FIELDS = ["执行者", "做了什么", "结果", "下一步"];
const REQUIRED_FIELDS = ["执行者", "做了什么", "结果"];

// ── 纯函数 ───────────────────────────────────────────────────────────────

/** 北京时间的日期与时刻，`now` 可注入以便测试。 */
export function beijingNow(now = new Date()) {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat("en-CA", {
      timeZone: TIME_ZONE, hourCycle: "h23",
      year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit",
    }).formatToParts(now).map(part => [part.type, part.value]),
  );
  return { date: `${parts.year}-${parts.month}-${parts.day}`, time: `${parts.hour}:${parts.minute}:${parts.second}` };
}

/** 分支名 → 链路文件名：非字母数字换成 `_`（`task/91/agent_notes` → `task_91_agent_notes`）。 */
export function branchSlug(branch) {
  return String(branch ?? "").toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "");
}

export function chainFile(root, { date, user, chain }) {
  return join(root, "notes", date, user, `${branchSlug(chain)}.md`);
}

function oneLine(value, name) {
  const text = String(value ?? "").replace(/\s+/g, " ").trim();
  if (!text) throw new Error(`缺少 --${name}`);
  return text;
}

/**
 * 一条记录的 Markdown；`issues` 为空数组时写「无 issue」。
 * @param {{ time: string, stage: string, issues: string[], title: string, by: string, did: string, result: string, next?: string }} entry
 */
export function formatEntry({ time, stage, issues, title, by, did, result, next }) {
  const refs = issues.length ? issues.map(n => `#${n}`).join(" ") : "无 issue";
  const lines = [
    `## ${time} +08:00 · ${stage} · ${refs} · ${oneLine(title, "title")}`,
    "",
    `- 执行者：${oneLine(by, "by")}`,
    `- 做了什么：${oneLine(did, "did")}`,
    `- 结果：${oneLine(result, "result")}`,
  ];
  if (next !== undefined && String(next).trim()) lines.push(`- 下一步：${oneLine(next, "next")}`);
  return `${lines.join("\n")}\n`;
}

function header({ date, user, chain }) {
  return `# ${chain} · ${user} · ${date}\n\n负责人：${user}\n`;
}

/** 按时间排序并合并条目，同一标题不重复写入 */
export function mergeEntries(file, meta, newBlocks) {
  mkdirSync(dirname(file), { recursive: true });
  const currentText = existsSync(file) ? readFileSync(file, "utf8").replace(/\r\n/g, "\n") : header(meta);
  const currentBlocks = currentText.split(/\n(?=## )/).slice(1).map(b => b.replace(/\n*$/, "\n"));

  const allBlocks = [...currentBlocks];
  const seenHeadings = new Set(currentBlocks.map(b => b.split("\n")[0].trim()));

  for (const block of newBlocks) {
    const trimmed = block.replace(/\n*$/, "\n");
    const heading = trimmed.split("\n")[0].trim();
    if (!seenHeadings.has(heading)) {
      seenHeadings.add(heading);
      allBlocks.push(trimmed);
    }
  }

  const parsed = allBlocks.map(b => {
    const firstLine = b.split("\n")[0];
    const m = /^## (\d{2}:\d{2}:\d{2})/.exec(firstLine);
    return { time: m ? m[1] : "00:00:00", block: b };
  });
  parsed.sort((a, b) => a.time.localeCompare(b.time));

  writeFileSync(file, `${header(meta)}\n${parsed.map(p => p.block.trimEnd()).join("\n\n")}\n`);
}

/** 在文件末尾追加若干条记录；文件不存在时先写标题。 */
function appendEntries(file, meta, entries) {
  mkdirSync(dirname(file), { recursive: true });
  const current = existsSync(file) ? readFileSync(file, "utf8").replace(/\n*$/, "\n") : header(meta);
  writeFileSync(file, `${current}\n${entries.map(entry => entry.replace(/\n*$/, "\n")).join("\n")}`);
}

/**
 * 在 root/notes/<北京日期>/<user>/<链路>.md 末尾追加一条；返回文件路径。
 * @param {string} root
 * @param {{ user?: string, by?: string, chain: string, stage?: string, issues: string[], title?: string, did?: string, result?: string, next?: string, now?: Date }} options
 */
export function addNote(root, { user, by, chain, stage, issues, title, did, result, next, now }) {
  if (!USER_RE.test(user ?? "")) throw new Error(`--user（或 GEEK_NOTES_USER）要写替谁干活的 GitHub 用户名（小写），收到 ${JSON.stringify(user)}`);
  if (!BY_RE.test(by ?? "")) throw new Error(`--by（或 GEEK_NOTES_BY）要写执行者，形如 agent-claude-geek-main-08（Claude Code，claude-opus-5-5）或 human-crosery，收到 ${JSON.stringify(by)}`);
  if (!STAGES.includes(stage ?? "")) throw new Error(`--stage 只能是 ${STAGES.join("、")}，收到 ${JSON.stringify(stage)}`);
  if (!branchSlug(chain)) throw new Error("--chain 要写链路对应的分支名（默认当前分支）");
  for (const n of issues) if (!/^\d+$/.test(String(n))) throw new Error(`--issue 只写数字，收到 ${JSON.stringify(n)}`);
  const { date, time } = beijingNow(now);
  const file = chainFile(root, { date, user, chain });
  appendEntries(file, { date, user, chain }, [formatEntry({ time, stage, issues, title, by, did, result, next })]);
  return file;
}

/** 解析一个链路文件：标题、负责人和每条记录。 */
export function parseChain(text) {
  const lines = text.replace(/\r\n/g, "\n").split("\n");
  const title = /^# (\S+) · (\S+) · (\d{4}-\d{2}-\d{2})$/.exec(lines[0] ?? "");
  const owner = lines.find(line => line.startsWith("负责人："))?.slice(4).trim() ?? "";
  const entries = [];
  const badHeadings = [];
  let current = null;
  lines.forEach((line, index) => {
    if (line.startsWith("## ")) {
      const m = ENTRY_RE.exec(line);
      current = null;
      if (!m) {
        badHeadings.push(index + 1);
        return;
      }
      current = { line: index + 1, time: `${m[1]}:${m[2]}:${m[3]}`, hms: [+m[1], +m[2], +m[3]], stage: m[4], issues: m[5] === "无 issue" ? [] : m[5].split(" ").map(ref => ref.slice(1)), title: m[6], fields: new Map() };
      entries.push(current);
      return;
    }
    const field = /^- ([^：]+)：(.*)$/.exec(line);
    if (current && field && FIELDS.includes(field[1])) current.fields.set(field[1], field[2].trim());
  });
  return { chain: title?.[1] ?? null, user: title?.[2] ?? null, date: title?.[3] ?? null, owner, entries, badHeadings };
}

function validDate(text) {
  const m = DATE_RE.exec(text);
  if (!m) return false;
  const d = new Date(Date.UTC(+m[1], +m[2] - 1, +m[3]));
  return d.getUTCFullYear() === +m[1] && d.getUTCMonth() === +m[2] - 1 && d.getUTCDate() === +m[3];
}

/** 核对一个链路文件；`rel` 是相对仓库根的路径（notes/<日期>/<用户>/<链路>.md）。 */
export function checkChainFile(rel, text) {
  const parts = rel.split("/");
  if (parts.length !== 4 || parts[0] !== "notes" || !parts[3].endsWith(".md")) return [`${rel}：链路只能放在 notes/<北京日期>/<GitHub 用户名>/<分支>.md`];
  const [, date, user, name] = parts;
  const slug = name.slice(0, -3);
  const problems = [];
  if (!validDate(date)) problems.push(`${rel}：日期目录 ${date} 不是有效日期（YYYY-MM-DD）`);
  if (!USER_RE.test(user)) problems.push(`${rel}：${user} 不是 GitHub 用户名（小写字母、数字和 -）`);
  if (!SLUG_RE.test(slug)) problems.push(`${rel}：文件名要是分支名把 / 和 - 换成 _，例如 task_91_agent_notes.md`);
  const parsed = parseChain(text);
  if (!parsed.chain) problems.push(`${rel}:1：第一行要写成「# <分支> · ${user} · ${date}」`);
  else {
    if (parsed.date !== date) problems.push(`${rel}:1：标题里的日期 ${parsed.date} 和目录 ${date} 不一致`);
    if (parsed.user !== user) problems.push(`${rel}:1：标题里的 ${parsed.user} 和用户目录 ${user} 不一致`);
    if (branchSlug(parsed.chain) !== slug) problems.push(`${rel}:1：标题里的分支 ${parsed.chain} 和文件名 ${slug} 不一致`);
  }
  if (parsed.owner !== user) problems.push(`${rel}：缺少「负责人：${user}」一行`);
  for (const line of parsed.badHeadings) problems.push(`${rel}:${line}：记录标题要写成「## HH:MM:SS +08:00 · <阶段> · #<issue> · <一句话>」，阶段是 ${STAGES.join("、")} 之一，没有 issue 写「无 issue」`);
  let last = "";
  for (const entry of parsed.entries) {
    const [h, m, s] = entry.hms;
    if (h > 23 || m > 59 || s > 59) problems.push(`${rel}:${entry.line}：时间 ${entry.time} 不存在`);
    if (entry.time < last) problems.push(`${rel}:${entry.line}：时间 ${entry.time} 早于上一条 ${last}，记录只能往后追加`);
    last = entry.time;
    for (const field of REQUIRED_FIELDS) {
      if (!entry.fields.has(field)) problems.push(`${rel}:${entry.line}：这条记录缺少「- ${field}：」`);
      else if (!entry.fields.get(field)) problems.push(`${rel}:${entry.line}：「${field}」不能是空的`);
    }
    const by = entry.fields.get("执行者");
    if (by && !BY_RE.test(by)) problems.push(`${rel}:${entry.line}：执行者要写成 agent-<工具>-<会话>（说明）或 human-<GitHub 用户名>`);
  }
  if (!parsed.entries.length && !parsed.badHeadings.length) problems.push(`${rel}：一条记录也没有`);
  return problems;
}

/** 全部链路：key 为 `<用户>/<链路文件名>`，按日期排好的文件与记录。 */
export function collectChains(root) {
  const base = join(root, "notes");
  const chains = new Map();
  if (!existsSync(base)) return chains;
  for (const date of readdirSync(base).filter(name => DATE_RE.test(name)).sort()) {
    const dateDir = join(base, date);
    for (const user of readdirSync(dateDir, { withFileTypes: true }).filter(d => d.isDirectory() && !d.name.startsWith(".")).map(d => d.name).sort()) {
      for (const name of readdirSync(join(dateDir, user)).filter(n => n.endsWith(".md") && !n.startsWith(".")).sort()) {
        const rel = `notes/${date}/${user}/${name}`;
        const parsed = parseChain(readFileSync(join(root, rel), "utf8"));
        const key = `${user}/${name.slice(0, -3)}`;
        if (!chains.has(key)) chains.set(key, { user, slug: name.slice(0, -3), chain: parsed.chain, files: [] });
        chains.get(key).files.push({ date, rel, entries: parsed.entries });
      }
    }
  }
  return chains;
}

/** task 链路的规则：第一条是开工；收尾之后不能再有记录。stage、main 等链路只记发布与验收，不要求。 */
export function checkChainOrder(chain) {
  const problems = [];
  const all = chain.files.flatMap(file => file.entries.map(entry => ({ ...entry, rel: file.rel })));
  if (!all.length || !TASK_RE.test(chain.chain ?? "")) return problems;
  if (all[0].stage !== "开工") problems.push(`${all[0].rel}:${all[0].line}：链路 ${chain.user}/${chain.slug} 的第一条必须是「开工」（开发前先记），现在是「${all[0].stage}」`);
  const closed = all.findIndex(entry => entry.stage === "收尾");
  if (closed >= 0 && closed < all.length - 1) problems.push(`${all[closed + 1].rel}:${all[closed + 1].line}：链路 ${chain.user}/${chain.slug} 已经收尾，后面不能再记；重新开始要开新的 task`);
  return problems;
}

/** notes/INDEX.md：按日期（新的在前）列出每个人的目录；每个人目录下一条链路一个文件。 */
export function renderIndex(root) {
  const base = join(root, "notes");
  const dates = existsSync(base) ? readdirSync(base).filter(name => DATE_RE.test(name)).sort().reverse() : [];
  const lines = [
    "# 执行记录索引",
    "",
    "> 由 `node scripts/note.mjs index` 生成，不要手改。规则见 [NOTES](../docs/conventions/NOTES.md)。每个日期下按 GitHub 用户名分目录，目录里一条链路一个文件，文件名是分支名；全部链路的一览表见 `node scripts/note.mjs index --summary`，每次 CI 运行也会贴进运行摘要。",
    "",
  ];
  if (!dates.length) lines.push("还没有记录。");
  for (const date of dates) {
    const users = readdirSync(join(base, date), { withFileTypes: true }).filter(d => d.isDirectory() && !d.name.startsWith(".")).map(d => d.name).sort();
    lines.push(`- ${date}：${users.map(user => `[${user}](${date}/${user}/)`).join("、")}`);
  }
  return `${lines.join("\n")}\n`;
}

/** 全部链路的一览表（Markdown），给 CI 运行摘要和终端里看。 */
export function renderSummary(root) {
  const rows = [...collectChains(root).values()].map((chain) => {
    const all = chain.files.flatMap(file => file.entries.map(entry => ({ ...entry, date: file.date })));
    const first = all[0];
    const last = all.at(-1);
    const issues = [...new Set(all.flatMap(entry => entry.issues))].map(n => `#${n}`).join(" ");
    const bys = [...new Set(all.map(entry => (entry.fields.get("执行者") ?? "").replace(/（.*$/, "")).filter(Boolean))].join("、");
    return {
      key: `${last?.date ?? ""} ${last?.time ?? ""}`,
      line: `| ${chain.user} | ${chain.chain ?? chain.slug} | ${issues} | ${bys} | ${all.length} | ${first ? `${first.date} ${first.time}` : ""} | ${last ? `${last.stage}（${last.date} ${last.time}）` : ""} |`,
    };
  }).sort((a, b) => b.key.localeCompare(a.key));
  return ["## 执行记录：全部链路", "", "| 负责人 | 链路 | issue | 执行者 | 条数 | 开工 | 最后一条 |", "|---|---|---|---|---|---|---|", ...rows.map(row => row.line), ""].join("\n");
}

/** 核对 root 下全部记录；返回问题列表。 */
export function checkAll(root) {
  const base = join(root, "notes");
  if (!existsSync(base)) return [];
  const problems = [];
  const walk = (dir) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      if (entry.name.startsWith(".")) continue;
      const path = join(dir, entry.name);
      const rel = relative(root, path).split("\\").join("/");
      if (entry.isDirectory()) walk(path);
      else if (rel === "notes/INDEX.md") continue;
      else if (!rel.endsWith(".md") || rel.split("/").length !== 4) problems.push(`${rel}：notes/ 下只放 <日期>/<用户>/<链路>.md 和 INDEX.md`);
      else problems.push(...checkChainFile(rel, readFileSync(path, "utf8")));
    }
  };
  walk(base);
  for (const chain of collectChains(root).values()) problems.push(...checkChainOrder(chain));
  const index = join(base, "INDEX.md");
  if (!existsSync(index) || readFileSync(index, "utf8") !== renderIndex(root)) problems.push("notes/INDEX.md 不是最新的：运行 `node scripts/note.mjs index` 重新生成");
  return problems;
}

function git(root, args) {
  return execFileSync("git", args, { cwd: root, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
}

/**
 * task/<issue>/<slug> 进 stage 的 PR：这个分支的链路里必须有引用 #<issue> 的开工、提交、PR、审查，
 * 并且这次改动新增了引用 #<issue> 的记录。forReview 为 true 时允许暂缺「审查」记录。
 * 此外，严格检查 notes/ 下已有记录不能被修改或删除（除 INDEX.md 外）。
 * 不是 task 分支时不要求。返回问题列表。
 */
export function checkPullRequest(root, { base, head, forReview = false }) {
  const task = TASK_RE.exec(head ?? "");
  if (!task) return [];
  const issue = task[1];
  const slug = branchSlug(head);
  const mine = [...collectChains(root).values()].filter(chain => chain.slug === slug);
  const entries = mine.flatMap(chain => chain.files.flatMap(file => file.entries)).filter(entry => entry.issues.includes(issue));
  const hint = stage => `  node scripts/note.mjs add --stage ${stage} --issue ${issue} --title "<一句话>" --did "<做了什么>" --result "<结果和证据>"`;
  if (!mine.length) return [`没有 ${head} 的执行链路：notes/<日期>/<GitHub 用户名>/${slug}.md 不存在。开工时 task.mjs start 会写第一条，之后每一步都要记（docs/conventions/NOTES.md）。`];

  const required = forReview ? REQUIRED_BEFORE_MERGE.filter(stage => stage !== "审查") : REQUIRED_BEFORE_MERGE;
  const problems = required.filter(stage => !entries.some(entry => entry.stage === stage))
    .map(stage => `${head} 的链路里还没有引用 #${issue} 的「${stage}」记录，例如：\n${hint(stage)}`);

  // 只能追加，不改不删（NOTES §3、AGENTS.md 黑名单）
  try {
    const statusLines = git(root, ["diff", "--no-renames", "--name-status", `${base}...HEAD`, "--", "notes/"]).split("\n").filter(Boolean);
    for (const line of statusLines) {
      const parts = line.split(/\s+/);
      const status = parts[0];
      const path = parts[1];
      if (path === "notes/INDEX.md") continue;
      if (status === "D" || status === "R") {
        problems.push(`不能删除或改名执行记录：${path}（状态 ${status}）违反「只能追加，已写的记录不改不删」`);
      }
    }
    const diffLines = git(root, ["diff", "--no-renames", "--unified=0", "--no-color", `${base}...HEAD`, "--", "notes/"]).split("\n");
    let currentDiffFile = "";
    for (const line of diffLines) {
      if (line.startsWith("diff --git a/")) {
        const parts = line.split(" ");
        currentDiffFile = (parts[2] ?? "").replace(/^a\//, "");
        continue;
      }
      if (currentDiffFile === "notes/INDEX.md") continue;
      if (line.startsWith("-") && !line.startsWith("--- ")) {
        problems.push(`${currentDiffFile}：发现删除或修改已有记录的行（「${line.slice(1).trim()}」），违反「只能往末尾追加，已写的记录不改不删」`);
        break;
      }
    }
  } catch (err) {}

  const diff = git(root, ["diff", "--no-renames", "--unified=0", "--no-color", "--diff-filter=AM", `${base}...HEAD`, "--", "notes/"]);
  const added = diff.split("\n").filter(line => line.startsWith("+## ")).map(line => ENTRY_RE.exec(line.slice(1))).filter(Boolean);
  if (!added.some(m => m[5].split(" ").includes(`#${issue}`))) problems.push(`这次改动没有新增引用 #${issue} 的记录：链路要随开发持续往后记。`);
  return problems;
}

/** 把 from/notes 下暂存的记录并进 to/notes（按时间合并，去重），然后删掉暂存。返回并进的文件。 */
export function flushPending(from, to) {
  const base = join(from, "notes");
  if (!existsSync(base)) return [];
  const moved = [];
  const targetBranch = currentBranch(to);
  const targetSlug = branchSlug(targetBranch);

  const activeTaskBranches = new Set();
  try {
    const text = git(to, ["worktree", "list", "--porcelain"]);
    for (const b of text.trim().split("\n\n")) {
      const brLine = b.split("\n").find(l => l.startsWith("branch refs/heads/task/"));
      if (brLine) {
        activeTaskBranches.add(branchSlug(brLine.replace(/^branch refs\/heads\//, "")));
      }
    }
  } catch {}

  const walk = (dir) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      if (entry.name.startsWith(".")) continue;
      const path = join(dir, entry.name);
      if (entry.isDirectory()) {
        walk(path);
        continue;
      }
      if (!entry.name.endsWith(".md")) continue;
      const slug = entry.name.slice(0, -3);
      if (slug !== targetSlug && activeTaskBranches.has(slug)) {
        continue;
      }
      const rel = relative(from, path).split("\\").join("/");
      const text = readFileSync(path, "utf8").replace(/\r\n/g, "\n");
      const parsed = parseChain(text);
      const blocks = text.split(/\n(?=## )/).slice(1);
      if (!parsed.chain || !blocks.length) continue;
      mergeEntries(join(to, rel), { date: parsed.date, user: parsed.user, chain: parsed.chain }, blocks);
      rmSync(path);
      moved.push(rel);
    }
  };
  walk(base);
  const cleanEmpty = (dir) => {
    if (!existsSync(dir)) return;
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      if (entry.isDirectory()) cleanEmpty(join(dir, entry.name));
    }
    if (readdirSync(dir).length === 0) {
      rmSync(dir, { recursive: true, force: true });
    }
  };
  cleanEmpty(base);
  return moved;
}

// ── 命令行 ───────────────────────────────────────────────────────────────

const ALLOWED_OPTIONS = new Set([
  "user", "by", "chain", "stage", "issue", "title", "did", "result", "next",
  "base", "head", "pr", "for-review", "summary"
]);

function parseArgs(argv) {
  const [command, ...rest] = argv;
  const options = { issues: [] };
  for (let i = 0; i < rest.length; i += 1) {
    const key = rest[i];
    if (key === "--pr" || key === "--summary" || key === "--for-review") {
      options[key.slice(2)] = true;
      continue;
    }
    if (!key.startsWith("--") || i + 1 >= rest.length) throw new Error(`参数不对：${key}`);
    const name = key.slice(2);
    if (!ALLOWED_OPTIONS.has(name)) throw new Error(`不认识的参数：${key}`);
    const value = rest[++i];
    if (name === "issue") options.issues.push(...value.split(/[\s,]+/).filter(Boolean).map(v => String(Number(v.replace(/^#/, "")))));
    else options[name] = value;
  }
  return { command, options };
}

export function currentBranch(root) {
  try {
    return git(root, ["branch", "--show-current"]).trim();
  }
  catch {
    return "";
  }
}

/** 主工作区根目录（任何 worktree 里都能找到），暂存目录放在它下面。 */
export function mainRoot(root) {
  return dirname(git(root, ["rev-parse", "--path-format=absolute", "--git-common-dir"]).trim());
}

/**
 * 写一条记录。当前 worktree 就在这条链路的 task 分支上时写进去并更新索引；否则（release
 * worktree、主工作区、别的链路）暂存到主工作区的 .claude/notes-pending/，下一个 task 开工时并进去。
 */
export function worktreeForBranch(root, branch) {
  try {
    const text = git(root, ["worktree", "list", "--porcelain"]);
    const blocks = text.trim().split("\n\n");
    for (const b of blocks) {
      const lines = b.split("\n");
      const wtLine = lines.find(l => l.startsWith("worktree "));
      const brLine = lines.find(l => l.startsWith("branch "));
      if (wtLine && brLine) {
        const wtPath = wtLine.replace(/^worktree\s+/, "");
        const brName = brLine.replace(/^branch\s+refs\/heads\//, "");
        if (brName === branch) return wtPath;
      }
    }
  } catch {
    return null;
  }
  return null;
}

export function record(repo, options) {
  const branch = currentBranch(repo);
  const chain = options.chain ?? branch;
  const isPostStage = ["合并", "发布", "验收", "收尾"].includes(options.stage);

  let targetRepo = null;
  const directWorktree = worktreeForBranch(repo, chain);
  if (directWorktree && !isPostStage) {
    let alreadyMerged = false;
    try {
      git(directWorktree, ["merge-base", "--is-ancestor", "HEAD", "origin/stage"]);
      alreadyMerged = true;
    } catch {}
    if (!alreadyMerged) {
      targetRepo = directWorktree;
    }
  }

  const here = targetRepo !== null;
  const target = here ? targetRepo : join(mainRoot(repo), PENDING_DIR);
  const file = addNote(target, { ...options, chain });
  if (here) {
    mkdirSync(join(target, "notes"), { recursive: true });
    writeFileSync(join(target, "notes", "INDEX.md"), renderIndex(target));
  }
  return { file, here };
}

function main() {
  const repo = git(process.cwd(), ["rev-parse", "--show-toplevel"]).trim();
  const { command, options } = parseArgs(process.argv.slice(2));
  if (command === "add") {
    const { file, here } = record(repo, {
      user: options.user ?? process.env.GEEK_NOTES_USER,
      by: options.by ?? process.env.GEEK_NOTES_BY,
      chain: options.chain, stage: options.stage, issues: options.issues, title: options.title, did: options.did, result: options.result, next: options.next,
    });
    console.log(here ? `已写入 ${relative(repo, file)}，并更新 notes/INDEX.md` : `已暂存到 ${file}：下一个 task 开工时（task.mjs start）或在 task worktree 里运行 node scripts/note.mjs flush 并进去`);
    return;
  }
  if (command === "flush") {
    if (!TASK_RE.test(currentBranch(repo))) throw new Error("flush 要在 task worktree 里运行：暂存的记录随这个 task 的提交入库");
    const moved = flushPending(join(mainRoot(repo), PENDING_DIR), repo);
    mkdirSync(join(repo, "notes"), { recursive: true });
    writeFileSync(join(repo, "notes", "INDEX.md"), renderIndex(repo));
    console.log(moved.length ? `已并入 ${moved.length} 个文件：${moved.join("、")}` : "没有暂存的记录。");
    return;
  }
  if (command === "index") {
    if (options.summary) {
      process.stdout.write(renderSummary(repo));
      return;
    }
    mkdirSync(join(repo, "notes"), { recursive: true });
    writeFileSync(join(repo, "notes", "INDEX.md"), renderIndex(repo));
    console.log("已生成 notes/INDEX.md");
    return;
  }
  if (command === "check") {
    const problems = checkAll(repo);
    if (options.pr) problems.push(...checkPullRequest(repo, { base: options.base ?? "origin/stage", head: options.head ?? currentBranch(repo), forReview: !!options["for-review"] }));
    if (problems.length) {
      for (const problem of problems) console.error(problem);
      process.exit(1);
    }
    console.log(`执行记录通过：${collectChains(repo).size} 条链路${options.pr ? "，本 task 的链路完整" : ""}。`);
    return;
  }
  console.error("用法：node scripts/note.mjs add|flush|index|check …（见文件头注释与 docs/conventions/NOTES.md）");
  process.exit(2);
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
  }
  catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  }
}

#!/usr/bin/env node
// 文档跟着模块改（docs/README.md「文档跟着模块改」，#115）。对照表只写在 docs/README.md 那一节，这里是它的实现。
//
//   node scripts/check-doc-sync.mjs                        在 task/* 分支上自动按 PR 核对（对 origin/stage，没有就对本地 stage）；
//                                                          其它分支（stage、main、dev/*、CI 的 PR 合并提交）按第一父链的时间核对
//   node scripts/check-doc-sync.mjs --base origin/stage [--head task/<issue>/<slug>]
//                                                          不管在哪个分支，都按 PR 核对；--head 给出 task 分支名，
//                                                          用来找这个 task 自己的执行记录（CI 的 branch-guard 检出的是合并提交，没有分支名）
//
// 两种核对：
//   按时间（第一父链）：模块路径在第一父链上最后一次改动（git log -1 --first-parent，合并提交算在它合进来的那一刻）
//     不能比文档路径新；工作区里没提交的改动（含未跟踪的新文件）算作「现在」。stage 上每个 PR 只进来一个合并提交，
//     PR 同时动了模块和文档，两边就是同一个时间；PR 里返工提交的先后不影响。rebase 合并会把 PR 的提交逐个接到
//     第一父链上，模块提交落在文档提交后面就不通过，所以 PR 只用 merge commit 进 stage（docs/conventions/BRANCHING.md）。
//   按 PR：merge-base 到工作区（含提交、未提交、未跟踪）动了模块路径，就必须也改了文档路径里的说明（只改「更新：」日期
//     不算），或者这个 task 自己的执行记录（notes/<日期>/<用户>/task_<issue>_*.md，只有这个 PR 会改）在这期间新加了
//     一行「文档核对：<文档路径> 不用改——<理由>」。另外在 merge-base 上按时间核对一次，stage 本来就不同步的照样报出来，
//     写明是 stage 上的问题（这条分支改了那份文档的说明或写了文档核对，就算在修，不报）。
//   按时间核对时，第一父链上新加「文档核对」那一行的提交也算文档的改动（stage 上就是那个 PR 的合并提交）。
// 两种都核对头部「更新：」：不能早于模块最后一次改动（不算合并提交）的作者时间的北京日期；合并、rebase 在零点之后
// 进来不影响。工作区里有没提交的模块改动时按今天算。
// 只读 Git 与文件，不改任何东西。浅克隆看不到完整历史，直接报错，不假装通过。
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, realpathSync } from "node:fs";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { beijingNow } from "./note.mjs";

export const MAP_FILE = "docs/README.md";
export const MAP_HEADING = "## 文档跟着模块改";
const HEADER_DATE_RE = /更新：(\d{4}-\d{2}-\d{2})/;
/** 头部「更新：」只在文件开头这几行里找（标题、摘要、状态行） */
const HEADER_LINES = 10;

export const SHALLOW_MESSAGE = "仓库是浅克隆，看不到完整历史，没法比较模块和文档最后一次改动的时间：CI 的检出要写 fetch-depth: 0，本机运行 git fetch --unshallow。";

// ── 纯函数 ───────────────────────────────────────────────────────────────

/**
 * 解析 docs/README.md「文档跟着模块改」一节的表格：每行 { modules, docs, headers }，
 * 单元格里的路径写在反引号里，多个路径用顿号隔开。没有反引号的行（表头、分隔行）跳过。
 */
export function parseSyncMap(markdown) {
  const lines = String(markdown).replace(/\r\n/g, "\n").split("\n");
  const start = lines.findIndex((line) => line.trim() === MAP_HEADING || line.startsWith(`${MAP_HEADING}（`));
  if (start < 0) throw new Error(`${MAP_FILE} 里找不到「${MAP_HEADING.slice(3)}」一节：模块与文档的对照表只写在那里。`);
  const pairs = [];
  let inTable = false;
  for (const line of lines.slice(start + 1)) {
    if (line.startsWith("## ")) break;
    if (!line.trim().startsWith("|")) {
      if (inTable) break;
      continue;
    }
    inTable = true;
    const cells = line.trim().replace(/^\||\|$/g, "").split("|");
    const paths = cells.map((cell) => [...cell.matchAll(/`([^`]+)`/g)].map((match) => match[1]));
    if (!paths[0]?.length) continue;
    if (cells.length !== 3 || !paths[1].length || !paths[2].length) {
      throw new Error(`${MAP_FILE}「${MAP_HEADING.slice(3)}」的表格每行要有三列：模块路径、文档路径、头部「更新：」所在的文档；这一行不对：${line.trim()}`);
    }
    pairs.push({ modules: paths[0], docs: paths[1], headers: paths[2] });
  }
  if (!pairs.length) throw new Error(`${MAP_FILE}「${MAP_HEADING.slice(3)}」一节里没有对照表。`);
  return pairs;
}

/** 文档头部「更新：YYYY-MM-DD」；没有就是 null。 */
export function headerDate(text) {
  const head = String(text).split("\n").slice(0, HEADER_LINES).join("\n");
  return HEADER_DATE_RE.exec(head)?.[1] ?? null;
}

/** 秒级时间戳 → 北京时间「YYYY-MM-DD HH:MM:SS +08:00」与日期 */
export function beijingStamp(seconds) {
  const { date, time } = beijingNow(new Date(seconds * 1000));
  return { date, text: `${date} ${time} +08:00` };
}

export function pairLabel(pair) {
  return `${pair.modules.join("、")} ↔ ${pair.docs.join("、")}`;
}

// ── 读 Git ──────────────────────────────────────────────────────────────

function git(root, args) {
  return execFileSync("git", args, { cwd: root, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
}

function refExists(root, ref) {
  try {
    git(root, ["rev-parse", "--verify", "--quiet", `${ref}^{commit}`]);
    return true;
  } catch {
    return false;
  }
}

function currentBranch(root) {
  try {
    return git(root, ["branch", "--show-current"]).trim();
  } catch {
    return "";
  }
}

/** 第一父链上这些路径最后一次被改动的提交（合并提交也算）：{ sha, time, subject }；没有就是 null。 */
export function lastChange(root, paths, rev = "HEAD") {
  const out = git(root, ["log", "-1", "--first-parent", "--format=%H%x09%ct%x09%s", rev, "--", ...paths]).trim();
  if (!out) return null;
  const [sha, time, ...subject] = out.split("\t");
  return { sha, time: Number(time), subject: subject.join("\t") };
}

/** 这些路径最后一次被改动的非合并提交与它的作者时间：{ sha, time }；没有就是 null。「更新：」按它比。 */
export function lastAuthored(root, paths) {
  const out = git(root, ["log", "-1", "--no-merges", "--format=%H%x09%at", "--", ...paths]).trim();
  if (!out) return null;
  const [sha, time] = out.split("\t");
  return { sha, time: Number(time) };
}

/** 工作区里这些路径下还没提交的改动（含未跟踪的新文件，不含被忽略的） */
export function uncommitted(root, paths) {
  return git(root, ["status", "--porcelain", "--untracked-files=all", "--", ...paths])
    .split("\n").filter(Boolean).map((line) => line.slice(3));
}

/** 执行记录里的「文档核对：<文档路径> 不用改——<理由>」，一行可以有几条，用「；」隔开 */
export const WAIVER_RE = /文档核对：(\S+?) 不用改——([^；\n]*)/g;

/** 零宽空格、零宽连接符与不连接符、词连接符、BOM：看不见，不能让它们撑起一条「有理由」的文档核对 */
const INVISIBLE_RE = /[\u200B-\u200D\u2060\uFEFF]/g;

/** 理由算不算数：去掉看不见的字符后，不能是模板里的「<理由>」，也要有汉字、字母或数字（汉字属于 \p{L}） */
function realReason(reason) {
  return reason !== "<理由>" && /[\p{L}\p{N}]/u.test(reason);
}

/** 从文本里取出文档核对：[{ path, reason }]，理由为空、照抄模板或只有标点的不算 */
export function parseWaivers(text) {
  return [...String(text).matchAll(WAIVER_RE)]
    .map((match) => ({ path: match[1], reason: match[2].replace(INVISIBLE_RE, "").trim() }))
    .filter((waiver) => realReason(waiver.reason));
}

const bare = (path) => path.replace(/\/+$/, "");
/** 这些文档核对里有没有一条针对这一对的文档路径 */
export function waives(waivers, pair) {
  return waivers.some((waiver) => pair.docs.some((doc) => bare(doc) === bare(waiver.path)));
}

/** git diff --unified=0 输出里新加的行 */
function addedLines(diff) {
  return diff.split("\n").filter((line) => line.startsWith("+") && !line.startsWith("+++")).map((line) => line.slice(1)).join("\n");
}

/** 工作区里 notes/ 下还没提交的新内容（已跟踪文件新加的行 + 未跟踪文件的全文） */
function uncommittedNotes(root) {
  const untracked = git(root, ["ls-files", "--others", "--exclude-standard", "--", "notes/"]).split("\n").filter(Boolean);
  return [addedLines(git(root, ["diff", "--unified=0", "--no-color", "HEAD", "--", "notes/"])), ...untracked.map((file) => readFileSync(join(root, file), "utf8"))].join("\n");
}

/**
 * 第一父链上最近一个新加了这一对的「文档核对」的提交，只找不早于 since 的：{ sha, time, subject } 或 null。
 * 合并提交按它和第一父提交的差比，stage 上就是那个 PR 的合并提交。
 */
function lastWaiver(root, pair, rev, since) {
  const log = git(root, ["log", "--first-parent", "--format=%H%x09%ct%x09%P%x09%s", rev, "--", "notes/"]).trim();
  for (const line of log ? log.split("\n") : []) {
    const [sha, time, parents, ...subject] = line.split("\t");
    if (Number(time) < since) break;
    const parent = parents.split(" ")[0];
    if (!parent) continue;
    if (waives(parseWaivers(addedLines(git(root, ["diff", "--unified=0", "--no-color", parent, sha, "--", "notes/"]))), pair)) {
      return { sha, time: Number(time), subject: subject.join("\t") };
    }
  }
  return null;
}

/** task 分支 task/<issue>/<slug> 的执行记录文件都叫 task_<issue>_<slug>.md（跨零点时每天一个） */
function chainFileRe(branch) {
  const match = /^task\/([0-9]+)\/([a-z0-9_]+)$/.exec(branch ?? "");
  return match ? new RegExp(`^notes/[^/]+/[^/]+/task_${match[1]}_${match[2]}\\.md$`) : null;
}

/** 从 merge-base 到工作区，这个 task 的执行记录里新加的文档核对；不知道是哪个 task 时看 notes/ 下所有新加的内容 */
function waiversSince(root, mergeBase, branch) {
  const only = chainFileRe(branch);
  const files = touchedSince(root, mergeBase, ["notes/"]).filter((file) => file.endsWith(".md") && (!only || only.test(file)));
  const tracked = new Set(git(root, ["ls-files", "--", ...files.length ? files : ["notes/"]]).split("\n").filter(Boolean));
  const text = files.map((file) => (tracked.has(file)
    ? addedLines(git(root, ["diff", "--unified=0", "--no-color", mergeBase, "--", file]))
    : existsSync(join(root, file)) ? readFileSync(join(root, file), "utf8") : "")).join("\n");
  return parseWaivers(text);
}

/**
 * 从 merge-base 到工作区，文档路径是怎么改的："none" 没改；"date" 只改了「更新：」日期（或者只动了空白与空行）；"content" 改了说明。
 * 只改日期不算同步：说明没变时要写文档核对。比较时忽略空白与空行（-w --ignore-blank-lines），行尾加个空格不算改了说明。
 */
function docChange(root, mergeBase, pair) {
  const files = touchedSince(root, mergeBase, pair.docs);
  if (!files.length) return "none";
  const untracked = git(root, ["ls-files", "--others", "--exclude-standard", "--", ...pair.docs]).trim();
  if (untracked) return "content";
  const diff = git(root, ["diff", "--unified=0", "--no-color", "-w", "--ignore-blank-lines", mergeBase, "--", ...pair.docs]).split("\n");
  const normalize = (lines) => lines.map((line) => line.slice(1).replace(/更新：\d{4}-\d{2}-\d{2}/g, "更新：")).sort();
  const removed = normalize(diff.filter((line) => line.startsWith("-") && !line.startsWith("---")));
  const added = normalize(diff.filter((line) => line.startsWith("+") && !line.startsWith("+++")));
  return removed.length === added.length && removed.every((line, i) => line === added[i]) ? "date" : "content";
}

/** 从 merge-base 到工作区动过的文件：已提交、没提交、未跟踪的都算 */
function touchedSince(root, mergeBase, paths) {
  const changed = git(root, ["diff", "--name-only", mergeBase, "--", ...paths]).split("\n");
  const untracked = git(root, ["ls-files", "--others", "--exclude-standard", "--", ...paths]).split("\n");
  return [...new Set([...changed, ...untracked].filter(Boolean))];
}

/** app/ 下的服务目录：只看 Git 跟踪的和没被忽略的新文件（残留的忽略目录不算），工作区里已经删掉的也不算 */
function appServices(root) {
  const files = git(root, ["ls-files", "--cached", "--others", "--exclude-standard", "--", "app"]).split("\n");
  return [...new Set(files.map((file) => /^app\/([^/]+)\//.exec(file)?.[1]).filter(Boolean))]
    .filter((name) => existsSync(join(root, "app", name)))
    .map((name) => `app/${name}/`);
}

const trailing = (path) => (path.endsWith("/") ? path : `${path}/`);
const short = (sha) => sha.slice(0, 7);
const listFiles = (files) => files.slice(0, 3).join("、") + (files.length > 3 ? ` 等 ${files.length} 个文件` : "");
const commitLine = (commit) => `${short(commit.sha)} ${beijingStamp(commit.time).text}「${commit.subject}」`;

// ── 核对 ────────────────────────────────────────────────────────────────

/** 按时间（第一父链）核对一对；rev 是 HEAD 时把工作区里没提交的改动算作 now。返回问题描述或 null。 */
function orderProblem(root, pair, { rev = "HEAD", now }) {
  const moduleCommit = lastChange(root, pair.modules, rev);
  const docCommit = lastChange(root, pair.docs, rev);
  const working = rev === "HEAD";
  const moduleDirty = working ? uncommitted(root, pair.modules) : [];
  const docDirty = working ? uncommitted(root, pair.docs) : [];
  const nowSeconds = Math.floor(now.getTime() / 1000);
  const moduleTime = moduleDirty.length ? nowSeconds : moduleCommit?.time;
  const docTime = docDirty.length ? nowSeconds : docCommit?.time;
  if (moduleTime === undefined || (docTime !== undefined && moduleTime <= docTime)) return null;
  // 文档里的事实没变、只写了文档核对的，按写下文档核对的那一刻算
  if (working && waives(parseWaivers(uncommittedNotes(root)), pair)) return null;
  if (!moduleDirty.length && lastWaiver(root, pair, rev, moduleTime)) return null;
  if (moduleDirty.length) {
    return {
      summary: `工作区里改了模块（${listFiles(moduleDirty)}），对应的文档还没动。`,
      fix: `把 ${pair.docs.join("、")} 里对应的说明改对，和这次的代码一起提交。`,
    };
  }
  return {
    summary: [`模块最后一次改动：${commitLine(moduleCommit)}`, `文档最后一次改动：${docCommit ? commitLine(docCommit) : "从没提交过"}`].join("\n  "),
    fix: `git show ${short(moduleCommit.sha)} -- ${pair.modules.join(" ")} 看改了什么，把 ${pair.docs.join("、")} 里对应的说明改对；文档里的事实确实不用改时，在执行记录里写一行「文档核对：${pair.docs[0]} 不用改——<理由>」（见 ${MAP_FILE}）。只改「更新：」日期不算同步。`,
  };
}

function isAncestor(root, sha, of) {
  try {
    git(root, ["merge-base", "--is-ancestor", sha, of]);
    return true;
  } catch {
    return false;
  }
}

/** 头部「更新：」；按 PR 核对时给 { base, mergeBase }，过期的日期来自 stage 上的提交就写明不是这条分支造成的 */
function headerProblems(root, pair, now, { base, mergeBase } = {}) {
  const problems = [];
  const moduleDirty = uncommitted(root, pair.modules);
  const authored = moduleDirty.length ? null : lastAuthored(root, pair.modules);
  if (!moduleDirty.length && !authored) return problems;
  const moduleDate = moduleDirty.length ? beijingNow(now).date : beijingStamp(authored.time).date;
  const dates = pair.headers.map((file) => ({ file, date: headerDate(readFileSync(join(root, file), "utf8")) }));
  for (const { file, date } of dates) {
    if (!date) problems.push(`${file} 的开头没有「更新：YYYY-MM-DD」（见 docs/conventions/DOCUMENTATION.md）。`);
  }
  const newest = dates.map(({ date }) => date).filter(Boolean).sort().at(-1);
  if (newest && newest < moduleDate) {
    const which = pair.headers.length > 1 ? `${pair.headers.join("、")} 里最新的「更新：${newest}」` : `${pair.headers[0]} 头部的「更新：${newest}」`;
    const source = moduleDirty.length ? "工作区里还没提交的改动" : `${short(authored.sha)} 的作者时间`;
    const fromBase = !moduleDirty.length && mergeBase && isAncestor(root, authored.sha, mergeBase);
    problems.push(fromBase
      ? `${base} 上本来就过期（不是这条分支造成的）：${which}早于 ${pair.modules.join("、")} 最后一次改动的北京日期 ${moduleDate}（${source}）：在 stage 上补，或者在这条分支上顺手核对文档、把「更新：」改成 ${moduleDate}。`
      : `${which}早于 ${pair.modules.join("、")} 最后一次改动的北京日期 ${moduleDate}（${source}）：核对文档内容后把「更新：」改成 ${moduleDate}。`);
  }
  return problems;
}

/** 要按 PR 核对时的 base：显式给的优先；task/* 分支上自动用 origin/stage，没有就用本地 stage。 */
export function resolveBase(root, { base, branch = currentBranch(root) } = {}) {
  if (base) {
    if (!refExists(root, base)) throw new Error(`找不到 ${base}：先 git fetch origin stage。`);
    return { base, note: null };
  }
  if (!/^task\//.test(branch)) return { base: null, note: null };
  const found = ["origin/stage", "stage"].find((ref) => refExists(root, ref));
  if (found) return { base: found, note: null };
  return { base: null, note: `${branch} 是 task 分支，但本机既没有 origin/stage 也没有 stage，没法按 PR 核对，退回按第一父链的时间核对（PR 里先改文档、后返工代码会被误报）：先 git fetch origin stage。` };
}

/**
 * 按 docs/README.md 的对照表核对整个仓库。
 * @returns {{ pairs: Array<{ modules: string[], docs: string[], headers: string[] }>, problems: string[], notes: string[], base: string | null }}
 */
export function checkDocSync(root, { base, branch, now = new Date() } = {}) {
  if (git(root, ["rev-parse", "--is-shallow-repository"]).trim() === "true") throw new Error(SHALLOW_MESSAGE);
  const pairs = parseSyncMap(readFileSync(join(root, MAP_FILE), "utf8"));
  const problems = [];
  const notes = [];

  for (const pair of pairs) {
    for (const path of new Set([...pair.modules, ...pair.docs, ...pair.headers])) {
      if (!existsSync(join(root, path))) problems.push(`${MAP_FILE} 对照表里的 \`${path}\` 不存在：路径改了就同步改表。`);
    }
    for (const file of pair.headers) {
      if (!pair.docs.some((doc) => file === doc || file.startsWith(trailing(doc)))) problems.push(`${MAP_FILE} 对照表：头部文档 \`${file}\` 不在这一行的文档路径里。`);
    }
  }
  const modules = pairs.flatMap((pair) => pair.modules.map(trailing));
  for (const service of appServices(root)) {
    if (!modules.includes(service)) problems.push(`${service} 没有写进 ${MAP_FILE}「${MAP_HEADING.slice(3)}」的对照表：新增服务要同时加 docs/services/<服务>/README.md 和表里的一行。`);
  }
  if (problems.length) return { pairs, problems, notes, base: null };

  const resolved = resolveBase(root, { base, branch });
  if (resolved.note) notes.push(resolved.note);

  const mergeBase = resolved.base ? git(root, ["merge-base", resolved.base, "HEAD"]).trim() : null;
  if (resolved.base) {
    const taskBranch = branch ?? currentBranch(root);
    const waivers = waiversSince(root, mergeBase, taskBranch);
    for (const pair of pairs) {
      const moduleFiles = touchedSince(root, mergeBase, pair.modules);
      const change = docChange(root, mergeBase, pair);
      const covered = change === "content" || waives(waivers, pair);
      if (moduleFiles.length && !covered) {
        problems.push([
          change === "date" ? `这次的改动动了模块，文档只改了「更新：」日期或空白：${pairLabel(pair)}` : `这次的改动动了模块、没动文档：${pairLabel(pair)}`,
          `  从 ${resolved.base} 分出来之后（merge-base ${short(mergeBase)}）改了 ${listFiles(moduleFiles)}，${pair.docs.join("、")} 里的说明没有改动。`,
          `  怎么办：把对应的说明改对；文档里的事实确实不用改时，在这个 task 的执行记录里写一行「文档核对：${pair.docs[0]} 不用改——<理由>」（见 ${MAP_FILE}）。`,
        ].join("\n"));
      }
      const broken = covered ? null : orderProblem(root, pair, { rev: mergeBase, now });
      if (broken) {
        problems.push([
          `${resolved.base} 上本来就不同步（不是这条分支造成的）：${pairLabel(pair)}`,
          `  ${broken.summary}`,
          `  怎么办：在 stage 上补文档，或者在这条分支上顺手把 ${pair.docs.join("、")} 补对。`,
        ].join("\n"));
      }
    }
  } else {
    for (const pair of pairs) {
      const found = orderProblem(root, pair, { now });
      if (found) problems.push([`文档没跟上模块：${pairLabel(pair)}`, `  ${found.summary}`, `  怎么办：${found.fix}`].join("\n"));
    }
  }

  for (const pair of pairs) problems.push(...headerProblems(root, pair, now, { base: resolved.base, mergeBase }));
  return { pairs, problems, notes, base: resolved.base };
}

// ── 命令行 ───────────────────────────────────────────────────────────────

function main() {
  const args = process.argv.slice(2);
  let base;
  let branch;
  for (let i = 0; i < args.length; i += 1) {
    if (args[i] === "--base" && args[i + 1]) base = args[++i];
    else if (args[i] === "--head" && args[i + 1]) branch = args[++i];
    else throw new Error("用法：node scripts/check-doc-sync.mjs [--base <ref>] [--head <task 分支名>]");
  }
  let root;
  try {
    root = git(process.cwd(), ["rev-parse", "--show-toplevel"]).trim();
  } catch {
    throw new Error("要在 git 仓库里运行：文档同步按 Git 提交历史比较。");
  }
  const { pairs, problems, notes, base: used } = checkDocSync(root, { base, branch });
  for (const note of notes) console.warn(note);
  if (problems.length) {
    console.error(problems.join("\n\n"));
    console.error(`\n规则与对照表见 ${MAP_FILE}「${MAP_HEADING.slice(3)}」。不要改检查脚本或只改日期来换通过。`);
    process.exitCode = 1;
    return;
  }
  console.log(`文档同步通过：${pairs.length} 组模块与文档，${used ? `按 PR 核对（对 ${used}）` : "按第一父链的时间核对"}。`);
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

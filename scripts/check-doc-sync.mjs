#!/usr/bin/env node
// 文档跟着模块改（docs/README.md「文档跟着模块改」，#115）。对照表只写在 docs/README.md 那一节，这里是它的实现。
//
//   node scripts/check-doc-sync.mjs                        逐行核对对照表：模块路径最后一次提交不能比文档路径新，
//                                                          工作区里没提交的改动算作「现在」；头部「更新：」不能早于
//                                                          模块最后一次改动的北京日期
//   node scripts/check-doc-sync.mjs --base origin/stage    另外核对 <base>...HEAD 这次的改动：动了模块路径就必须动文档路径（PR 用）
//
// 时间取提交者时间（%ct）：rebase、cherry-pick、squash 都会生成新的提交者时间，比作者时间更接近「这次改动什么时候进来」。
// 合并提交不算改动（--no-merges）：把 stage 合进 task 分支、GitHub 给 PR 做的合并提交，时间都是合并那一刻，
// 不是谁改了模块；git 默认的历史简化仍然只沿着真正带来这份内容的父提交往回找，所以报出来的是真正改模块的那个提交。
// 合并时解决冲突顺手改的内容因此看不到，由 --base 的 PR 检查（看整个 diff）兜住。
// 只读 Git 与文件，不改任何东西。浅克隆看不到完整历史，直接报错，不假装通过。
import { execFileSync } from "node:child_process";
import { existsSync, readdirSync, readFileSync, realpathSync } from "node:fs";
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

/** 这些路径最后一次被改动的提交（不算合并提交）：{ sha, time, subject }；从没提交过就是 null。 */
export function lastChange(root, paths) {
  const out = git(root, ["log", "-1", "--no-merges", "--format=%H%x09%ct%x09%s", "--", ...paths]).trim();
  if (!out) return null;
  const [sha, time, ...subject] = out.split("\t");
  return { sha, time: Number(time), subject: subject.join("\t") };
}

/** 工作区里这些路径下还没提交的改动（含未跟踪的文件） */
export function uncommitted(root, paths) {
  return git(root, ["status", "--porcelain", "--untracked-files=all", "--", ...paths])
    .split("\n").filter(Boolean).map((line) => line.slice(3));
}

function changedSince(root, base, paths) {
  return git(root, ["diff", "--name-only", `${base}...HEAD`, "--", ...paths]).split("\n").filter(Boolean);
}

function appServices(root) {
  const app = join(root, "app");
  if (!existsSync(app)) return [];
  return readdirSync(app, { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && !entry.name.startsWith("."))
    .map((entry) => `app/${entry.name}/`);
}

const trailing = (path) => (path.endsWith("/") ? path : `${path}/`);

// ── 核对 ────────────────────────────────────────────────────────────────

function checkPair(root, pair, now) {
  const problems = [];
  const label = pairLabel(pair);
  const moduleCommit = lastChange(root, pair.modules);
  const docCommit = lastChange(root, pair.docs);
  const moduleDirty = uncommitted(root, pair.modules);
  const docDirty = uncommitted(root, pair.docs);
  const nowSeconds = Math.floor(now.getTime() / 1000);
  const moduleTime = moduleDirty.length ? nowSeconds : moduleCommit?.time;
  const docTime = docDirty.length ? nowSeconds : docCommit?.time;
  if (moduleTime === undefined) return problems;

  if (docTime === undefined || moduleTime > docTime) {
    if (moduleDirty.length) {
      const files = moduleDirty.slice(0, 3).join("、") + (moduleDirty.length > 3 ? ` 等 ${moduleDirty.length} 个文件` : "");
      problems.push([
        `文档没跟上模块：${label}`,
        `  工作区里改了模块（${files}），对应的文档还没动。`,
        `  怎么办：把 ${pair.docs.join("、")} 里对应的说明改对，和这次的代码一起提交。`,
      ].join("\n"));
    } else {
      const docLine = docCommit
        ? `${docCommit.sha.slice(0, 7)} ${beijingStamp(docCommit.time).text}「${docCommit.subject}」`
        : "从没提交过";
      problems.push([
        `文档没跟上模块：${label}`,
        `  模块最后一次提交：${moduleCommit.sha.slice(0, 7)} ${beijingStamp(moduleCommit.time).text}「${moduleCommit.subject}」`,
        `  文档最后一次提交：${docLine}`,
        `  怎么办：git show ${moduleCommit.sha.slice(0, 7)} -- ${pair.modules.join(" ")} 看改了什么，把 ${pair.docs.join("、")} 里对应的说明改对，和代码同一个提交或紧接着提交；只改日期不算同步。`,
      ].join("\n"));
    }
  }

  const moduleDate = moduleDirty.length ? beijingNow(now).date : beijingStamp(moduleCommit.time).date;
  const dates = pair.headers.map((file) => ({ file, date: existsSync(join(root, file)) ? headerDate(readFileSync(join(root, file), "utf8")) : null }));
  for (const { file, date } of dates) {
    if (existsSync(join(root, file)) && !date) problems.push(`${file} 的开头没有「更新：YYYY-MM-DD」（见 docs/conventions/DOCUMENTATION.md）。`);
  }
  const newest = dates.map(({ date }) => date).filter(Boolean).sort().at(-1);
  if (newest && newest < moduleDate) {
    const which = pair.headers.length > 1 ? `${pair.headers.join("、")} 里最新的「更新：${newest}」` : `${pair.headers[0]} 头部的「更新：${newest}」`;
    const source = moduleDirty.length ? "工作区里还没提交的改动" : moduleCommit.sha.slice(0, 7);
    problems.push(`${which}早于 ${pair.modules.join("、")} 最后一次改动的北京日期 ${moduleDate}（${source}）：核对文档内容后把「更新：」改成 ${moduleDate}。`);
  }
  return problems;
}

/**
 * 按 docs/README.md 的对照表核对整个仓库；base 给了（PR）时另外核对 <base>...HEAD。
 * @returns {{ pairs: Array<{ modules: string[], docs: string[], headers: string[] }>, problems: string[] }}
 */
export function checkDocSync(root, { base, now = new Date() } = {}) {
  if (git(root, ["rev-parse", "--is-shallow-repository"]).trim() === "true") throw new Error(SHALLOW_MESSAGE);
  const pairs = parseSyncMap(readFileSync(join(root, MAP_FILE), "utf8"));
  const problems = [];

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
  if (problems.length) return { pairs, problems };

  for (const pair of pairs) problems.push(...checkPair(root, pair, now));

  if (base) {
    for (const pair of pairs) {
      const moduleFiles = changedSince(root, base, pair.modules);
      if (moduleFiles.length && !changedSince(root, base, pair.docs).length) {
        const files = moduleFiles.slice(0, 3).join("、") + (moduleFiles.length > 3 ? ` 等 ${moduleFiles.length} 个文件` : "");
        problems.push([
          `这次的改动动了模块、没动文档：${pairLabel(pair)}`,
          `  ${base}...HEAD 改了 ${files}，${pair.docs.join("、")} 没有任何改动。`,
          `  怎么办：把对应的说明改对，提交到这条分支上。`,
        ].join("\n"));
      }
    }
  }
  return { pairs, problems };
}

// ── 命令行 ───────────────────────────────────────────────────────────────

function main() {
  const args = process.argv.slice(2);
  let base;
  for (let i = 0; i < args.length; i += 1) {
    if (args[i] === "--base" && args[i + 1]) base = args[++i];
    else throw new Error("用法：node scripts/check-doc-sync.mjs [--base <ref>]");
  }
  let root;
  try {
    root = git(process.cwd(), ["rev-parse", "--show-toplevel"]).trim();
  } catch {
    throw new Error("要在 git 仓库里运行：文档同步按 Git 提交历史比较。");
  }
  const { pairs, problems } = checkDocSync(root, { base });
  if (problems.length) {
    console.error(problems.join("\n\n"));
    console.error(`\n规则与对照表见 ${MAP_FILE}「${MAP_HEADING.slice(3)}」。不要改检查脚本或只改日期来换通过。`);
    process.exitCode = 1;
    return;
  }
  console.log(`文档同步通过：${pairs.length} 组模块与文档${base ? `，${base}...HEAD 的改动也带上了文档` : ""}。`);
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

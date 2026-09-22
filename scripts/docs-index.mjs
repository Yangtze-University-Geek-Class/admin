#!/usr/bin/env node
// 生成 docs/INDEX.md —— 文档索引的唯一来源。
//
//   node scripts/docs-index.mjs           # 重新生成
//   node scripts/docs-index.mjs --check   # 只校验，过期则 exit 1（用于 CI / 提交前自查）
//
// INDEX.md 是生成物，不要手改。它从文档自身的 H1 标题和首个引用块（`> ...`）里
// 抽取标题与摘要，因此新增文档只需写好这两处，再跑一次本脚本。
//
// 文件夹说明取自各目录的 README.md 首个引用块。README.md 本身是目录落地页，
// 不作为普通文档列出；只有 README.md 的目录同样成组出现，用它的引用块当说明，
// 这样「一个目录一份契约」的文档（如 docs/services/<service>/）不会被跳过。

import { readdirSync, readFileSync, writeFileSync, existsSync } from "node:fs";
import { join, relative, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const DOCS = join(ROOT, "docs");
const INDEX = join(DOCS, "INDEX.md");
const CHECK = process.argv.includes("--check");

// 顶层目录展示顺序；未列出的目录按字母序追加在后面。
// 子目录（如 services/<service>）跟随其顶层目录排序，保证同一个顶层目录下的文档成组出现。
const FOLDER_ORDER = ["conventions", "services", "components", "design", "architecture", "plan", "ops"];

function walk(dir) {
  const out = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.name.startsWith(".")) continue;
    const full = join(dir, entry.name);
    // Generated vendor references have a dedicated catalogue; keep this index small.
    const rel = relative(DOCS, full).replaceAll(String.fromCharCode(92), "/");
    if (["components/tuffex/reference", "components/tuffex/snapshot"].includes(rel)) continue;
    if (entry.isDirectory()) out.push(...walk(full));
    else if (entry.name.endsWith(".md")) out.push(full);
  }
  return out;
}

/** 取第一个一级标题，去掉行首的 "# "。 */
function titleOf(text) {
  const line = text.split("\n").find((l) => l.startsWith("# "));
  return line ? line.slice(2).trim() : null;
}

/** 取首个引用块（连续的 "> " 行）拼成一行摘要，跳过语言切换行。 */
function summaryOf(text) {
  const lines = text.split("\n");
  const start = lines.findIndex((l) => l.startsWith("> "));
  if (start === -1) return null;
  const parts = [];
  for (let i = start; i < lines.length; i++) {
    if (!lines[i].startsWith(">")) break;
    const body = lines[i].replace(/^>\s?/, "").trim();
    if (!body) continue;
    // 语言切换行只是导航，不进摘要
    if (/^(English|中文|中英对照|双语)\s*[:：]/.test(body)) continue;
    parts.push(body);
  }
  const joined = parts.join(" ").replace(/\s+/g, " ").trim();
  // 摘要里保留链接文字、去掉链接目标，避免索引页出现多余跳转与路径噪音
  return (joined.replace(/\[([^\]]+)\]\([^)]+\)/g, "$1") || null);
}

function readDoc(path) {
  const text = readFileSync(path, "utf8");
  return { text, title: titleOf(text), summary: summaryOf(text) };
}

function build() {
  const files = walk(DOCS).filter((f) => !f.endsWith("INDEX.md"));

  // 只把中文版当主条目；.en.md 挂到同名主条目下。
  const primary = [];
  const englishBy = new Map();
  for (const f of files) {
    const rel = relative(DOCS, f);
    if (rel.endsWith(".en.md")) englishBy.set(rel.replace(/\.en\.md$/, ".md"), rel);
    else primary.push(rel);
  }

  const folders = new Map(); // folder -> rows
  const folderReadme = new Map(); // folder -> {title, summary}
  const rootDocs = [];

  for (const rel of primary.sort()) {
    const name = rel.split("/").pop();
    const folder = dirname(rel) === "." ? "" : dirname(rel);
    const doc = readDoc(join(DOCS, rel));

    if (name === "README.md") {
      if (folder) folderReadme.set(folder, doc);
      continue; // 根 README 与目录 README 都是落地页，不进表格
    }

    const row = {
      rel,
      file: name,
      title: doc.title ?? name,
      summary: doc.summary,
      en: englishBy.get(rel) ?? null,
    };
    if (folder) {
      if (!folders.has(folder)) folders.set(folder, []);
      folders.get(folder).push(row);
    } else {
      rootDocs.push(row);
    }
  }

  // 只有 README 的目录（例如 docs/services/<service>/）也要出现：该 README 就是目录说明，
  // 否则「一个目录一份契约」的文档会被静默跳过。
  for (const folder of folderReadme.keys()) if (!folders.has(folder)) folders.set(folder, []);

  const rank = (folder) => {
    const index = FOLDER_ORDER.indexOf(folder.split("/")[0]);
    return index === -1 ? FOLDER_ORDER.length : index;
  };
  const order = [...folders.keys()].sort((a, b) => rank(a) - rank(b) || (a < b ? -1 : a > b ? 1 : 0));

  const lines = [];
  lines.push("# 文档索引");
  lines.push("");
  lines.push("> 本文件由 `node scripts/docs-index.mjs` 生成，**请勿手工编辑**。");
  lines.push("> 改了文档标题或摘要后重新生成；提交前用 `node scripts/docs-index.mjs --check` 自查。");
  lines.push("");
  lines.push("任务与规范导航见 [`README.md`](./README.md) 和 [`../AGENTS.md`](../AGENTS.md)。Tuffex 完整组件索引见 [`COMPONENTS.md`](./components/tuffex/COMPONENTS.md)，不在总索引重复展开。");
  lines.push("");

  const describe = (folder) => {
    const r = folderReadme.get(folder);
    return r?.summary ?? r?.title ?? "";
  };

  const table = (rows) => {
    lines.push("| 文档 | 说明 | EN |");
    lines.push("|---|---|---|");
    for (const r of rows) {
      const en = r.en ? `[EN](./${r.en})` : "—";
      const desc = r.summary ? r.summary.replace(/\|/g, "\\|") : "";
      lines.push(`| [\`${r.file}\`](./${r.rel}) | ${desc} | ${en} |`);
    }
    lines.push("");
  };

  if (rootDocs.length) {
    lines.push("## 根目录");
    lines.push("");
    table(rootDocs);
  }

  for (const folder of order) {
    lines.push(`## ${folder}/`);
    lines.push("");
    const desc = describe(folder);
    if (desc) {
      lines.push(desc);
      lines.push("");
    }
    const rows = folders.get(folder).sort((a, b) => a.file.localeCompare(b.file));
    if (rows.length) table(rows);
  }

  const total = rootDocs.length + [...folders.values()].reduce((count, rows) => count + rows.length, 0);
  lines.push("---");
  lines.push("");
  lines.push(`共 ${total} 篇文档（另有 ${englishBy.size} 篇英文版）。索引按目录分组，组内按文件名排序。`);
  lines.push("");

  return lines.join("\n");
}

const generated = build();

if (CHECK) {
  const current = existsSync(INDEX) ? readFileSync(INDEX, "utf8") : "";
  if (current !== generated) {
    console.error("docs/INDEX.md 已过期。运行 `node scripts/docs-index.mjs` 重新生成。");
    process.exit(1);
  }
  console.log("docs/INDEX.md 是最新的。");
} else {
  writeFileSync(INDEX, generated);
  console.log(`已写入 docs/INDEX.md（${generated.split("\n").length} 行）。`);
}

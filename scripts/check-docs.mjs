#!/usr/bin/env node
// 文档链接、入口与技能的校验器。
//
// 新结构下仓库只有一个 agent 入口（AGENTS.md）和一份技能实现（.agents/skills/），
// 不再校验 CLAUDE/GEMINI/CONVENTIONS/.cursorrules/.github/copilot-instructions 等适配器，
// 也不再校验模块级 AGENTS.md 指针。
import { existsSync, lstatSync, readdirSync, readFileSync, realpathSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
function walk(dir) {
  return readdirSync(dir, { withFileTypes: true }).flatMap(entry => {
    if (["node_modules", ".git", ".tools", "dist", "coverage", "test-results"].includes(entry.name)) return [];
    const path = join(dir, entry.name);
    return entry.isDirectory() ? walk(path) : /\.(?:md|mdc)$/.test(entry.name) ? [path] : [];
  });
}

const errors = [];

// 仓库说明、唯一 agent 入口与 docs 总入口必须存在。
const required = ["AGENTS.md", "README.md", "docs/README.md"];

// 每个 app/<service> 必须有一份 docs/services/<service>/README.md 契约。
const app = join(root, "app");
if (!existsSync(app)) errors.push("missing app/");
else {
  const services = readdirSync(app, { withFileTypes: true })
    .filter(entry => entry.isDirectory() && !entry.name.startsWith("."))
    .map(entry => entry.name)
    .sort();
  if (!services.length) errors.push("app/: no service directories found");
  for (const service of services) required.push(`docs/services/${service}/README.md`);
}

// 技能只有一个实现放在 .agents/skills/，各 CLI 目录只允许符号链接过去，禁止复制内容。
const skillDir = ".agents/skills/code-review";
const skillFile = `${skillDir}/SKILL.md`;
const skillLinks = [".omp/skills/code-review", ".claude/skills/code-review"];

// 入口文件同样参与相对链接校验；docs/ 下所有文档由 walk 收集。
const pointers = ["AGENTS.md", "README.md", "README.en.md", skillFile];

for (const file of required) if (!existsSync(join(root, file))) errors.push(`missing ${file}`);
if (!existsSync(join(root, skillFile))) errors.push(`missing ${skillFile}`);
for (const link of skillLinks) {
  const path = join(root, link);
  if (!existsSync(path)) {
    errors.push(`missing skill link ${link}`);
    continue;
  }
  if (!lstatSync(path).isSymbolicLink()) errors.push(`${link}: must be a symlink to ${skillDir}, not a copy`);
  else if (realpathSync(path) !== realpathSync(join(root, skillDir))) errors.push(`${link}: symlink must resolve to ${skillDir}`);
}

const documents = [...walk(join(root, "docs")), ...pointers.map(file => join(root, file)).filter(existsSync)];
for (const file of documents) {
  const original = readFileSync(file, "utf8");
  const text = original.replace(/```[^\n]*\n[\s\S]*?```/g, "").replace(/`[^`\n]*`/g, "");
  for (const match of text.matchAll(/\[[^\]]*\]\(([^\s)]+)(?:\s+"[^"]*")?\)/g)) {
    const target = match[1].replace(/^<|>$/g, "").split("#")[0];
    if (!target || /^(?:[a-z][a-z0-9+.-]*:|\/\/)/i.test(target)) continue;
    let decoded;
    try { decoded = decodeURIComponent(target); } catch { errors.push(`${relative(root,file)}: invalid URL ${target}`); continue; }
    if (!existsSync(resolve(dirname(file), decoded))) errors.push(`${relative(root,file)}: missing ${target}`);
  }
  if (relative(root, file).startsWith("docs/history/") && !original.includes("historical")) errors.push(`${relative(root, file)}: missing historical status`);
}

if (errors.length) { console.error(errors.join("\n")); process.exitCode = 1; }
else console.log(`Documentation links, routes and skill links passed: ${documents.length} documents.`);

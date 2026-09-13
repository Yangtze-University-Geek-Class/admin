#!/usr/bin/env node
import { existsSync, readdirSync, readFileSync } from "node:fs";
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
const pointers = ["README.md", "README.en.md", "AGENTS.md", "CLAUDE.md", "GEMINI.md", "CONVENTIONS.md", ".github/copilot-instructions.md", ".cursor/rules/main.mdc", "server/AGENTS.md", "web/shared/AGENTS.md", "deploy/forum-subdomain-setup.md"];
for (const site of ["portal", "admin"]) for (const dir of [`web/sites/${site}`, `server/src/routes/${site}`]) for (const name of ["AGENTS.md", "CLAUDE.md"]) pointers.push(`${dir}/${name}`);
pointers.push("modules/forum/AGENTS.md", "modules/forum/CLAUDE.md", "modules/forum/README.md");
const documents = [...walk(join(root, "docs")), ...pointers.map(file => join(root,file)).filter(existsSync)];
for (const file of documents) {
  const original = readFileSync(file, "utf8");
  const text = original.replace(/```[^\n]*\n[\s\S]*?```/g, "").replace(/`[^`\n]*`/g, "");
  for (const match of text.matchAll(/\[[^\]]*\]\(([^\s)]+)(?:\s+"[^"]*")?\)/g)) {
    const target = match[1].replace(/^<|>$/g, "").split("#")[0];
    if (!target || /^(?:[a-z][a-z0-9+.-]*:|\/\/)/i.test(target)) continue;
    let decoded;
    try { decoded = decodeURIComponent(target); } catch { errors.push(`${relative(root,file)}: invalid URL ${target}`); continue; }
    if (!existsSync(resolve(dirname(file),decoded))) errors.push(`${relative(root,file)}: missing ${target}`);
  }
  if (relative(root,file).startsWith("docs/history/") && !original.includes("historical")) errors.push(`${relative(root,file)}: missing historical status`);
}
for (const site of ["portal", "forum", "admin"]) {
  const directories = site === "forum" ? ["modules/forum"] : [`web/sites/${site}`, `server/src/routes/${site}`];
  for (const directory of directories) {
    if (!existsSync(join(root,directory,"AGENTS.md"))) errors.push(`${directory}: missing agent pointer`);
  }
  if (!existsSync(join(root,`docs/modules/${site}.md`))) errors.push(`missing ${site} module contract`);
}
if (errors.length) { console.error(errors.join("\n")); process.exitCode = 1; }
else console.log(`Documentation links and module pointers passed: ${documents.length} documents.`);

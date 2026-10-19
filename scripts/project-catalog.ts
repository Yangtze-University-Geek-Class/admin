import { existsSync, mkdirSync, readFileSync, realpathSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { collectRuntime, ROOT } from "./catalog/collect.js";
import { buildCatalog, OWNERSHIP_PATH, type Ownership } from "./catalog/model.js";
import { renderCatalog } from "./catalog/render.js";
import { serialize } from "./catalog/source.js";

export async function generateCatalog() {
  const ownership: Ownership = JSON.parse(readFileSync(join(ROOT, OWNERSHIP_PATH), "utf8"));
  return buildCatalog(await collectRuntime(), ownership);
}

export function checkArtifacts(artifacts: Record<string, string>, directory: string) {
  const stale = Object.entries(artifacts).filter(([name, contents]) => {
    const path = join(directory, name);
    return !existsSync(path) || readFileSync(path, "utf8") !== contents;
  }).map(([name]) => name);
  if (stale.length) throw new Error(`项目目录缺失或过期：${stale.join("、")}；运行 pnpm catalog:generate 后核对差异`);
}

async function main() {
  const [command, ...extra] = process.argv.slice(2);
  if (extra.length || !["generate", "check", "json"].includes(command)) throw new Error("用法：project-catalog.ts generate|check|json");
  const catalog = await generateCatalog();
  const json = serialize(catalog);
  if (command === "json") { process.stdout.write(json); return; }
  const artifacts = { "catalog.json": json, ...renderCatalog(catalog) };
  const directory = join(ROOT, "docs/architecture/catalog");
  if (command === "check") checkArtifacts(artifacts, directory);
  else {
    mkdirSync(directory, { recursive: true });
    for (const [name, contents] of Object.entries(artifacts)) writeFileSync(join(directory, name), contents);
  }
  console.log(`项目目录${command === "check" ? "核对通过" : "已生成"}：${catalog.applications.length} 应用，${catalog.runtimeUnits.length} 运行单元，${catalog.coverage.routeMethods} 方法路径（业务 ${catalog.coverage.businessOperations}、自动 HEAD ${catalog.coverage.automaticHead}），${catalog.tables.length} 表，${catalog.capabilities.length} 能力。`);
  console.log(`来源摘要 ${catalog.provenance.fingerprint}；只代表当前源码与隔离注册，不代表已部署或业务验收。`);
}

if (process.argv[1] && realpathSync(resolve(process.argv[1])) === fileURLToPath(import.meta.url)) {
  main().catch(error => { console.error(error instanceof Error ? error.message : String(error)); process.exitCode = 1; });
}

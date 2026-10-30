#!/usr/bin/env node
// 只读 Git/diff/JSON；不导入或执行被审查分支的应用代码。完整规则：ARCHITECTURE-ALIGNMENT.md。
import { execFileSync } from "node:child_process";
import { existsSync, lstatSync, readFileSync, realpathSync, writeFileSync } from "node:fs";
import { isAbsolute, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { parseSyncMap, parseWaivers, waives } from "./check-doc-sync.mjs";
import { activeWindows, readRegistryAt } from "./hotfix-windows.mjs";
import { parsePrSections } from "./pr-markdown.mjs";

export const DIMENSIONS = ["business", "backend", "permissions", "data", "dependencies", "documentation", "verification", "delivery"];
const TASK = /^task\/([0-9]+)\/[a-z0-9]+(?:_[a-z0-9]+)*$/;
const visual = path => /\.(?:css|scss|sass|less|png|jpe?g|webp|avif|gif|svg|ico|woff2?)$/i.test(path);
const docsOnly = path => /^(?:docs\/.*\.md|README(?:\.en)?\.md)$/.test(path) || path.startsWith("notes/");
const code = path => /\.(?:[cm]?[jt]sx?|vue|sh|html|ya?ml)$/.test(path);
const safePath = path => typeof path === "string" && path.length > 0 && !path.startsWith("/")
  && !path.includes("\\") && !path.includes("\0") && !path.includes("\n") && !path.includes("\r")
  && !path.split("/").some(part => part === ".." || part === ".") && !/^[a-z]:/i.test(path);
const meaningful = value => typeof value === "string" && [...value.trim()].length >= 12
  && !/(?:<[^>]*>|待补|待填写|TODO|TBD|N\/A)/i.test(value) && new Set(value.replace(/\s/g, "")).size >= 6;
const array = value => Array.isArray(value) ? value : [];
const covers = (scope, path) => scope.endsWith("/") ? path.startsWith(scope) : path === scope;
const humanDoc = path => /\.md$/.test(path) && !/^notes\//.test(path)
  && !/^docs\/architecture\/catalog\/(?:CATALOG|routes|data-model|permissions)\.md$/.test(path) && path !== "docs/INDEX.md";
const broadScopes = new Set(["app/", "docs/", "scripts/", "tests/", ".github/", "deploy/", "app/server/", "app/web/", "app/console/", "app/forum/"]);
const GENERATED = new Set(["docs/INDEX.md", ...["catalog.json", "CATALOG.md", "routes.md", "data-model.md", "permissions.md", "map.html"].map(name => `docs/architecture/catalog/${name}`)]);
export const FORGES = ["gitlab", "github"];

/**
 * 宏观声明的路径。GitLab 一侧是 docs/changes/<编号>.json（编号以 GitLab 为准）；GitHub 一侧的同步工单另放在
 * docs/changes/github/<编号>.json，两边同号时各取各的，不会互相覆盖（#330）。
 */
export function manifestPathFor(issue, forge = "gitlab") {
  if (!FORGES.includes(forge)) throw new Error(`forge 只能是 gitlab 或 github：${forge}`);
  return forge === "github" ? `docs/changes/github/${issue}.json` : `docs/changes/${issue}.json`;
}

/** 公开检查接口：调用方提供实际 diff 和存在性查询，测试与 CI 使用同一判定。 */
export function checkAlignment({ issue, manifest, catalog, baseCatalog = null, changedFiles, exists, evidenceExists = exists, body = null, documentWaiverText = "", syncMap = [], deletedFiles = [], readBaseFile = () => null, readHeadFile = () => null, forge = "gitlab" }) {
  const errors = [];
  const fail = message => errors.push(message);
  const manifestPath = manifestPathFor(issue, forge);
  const changed = [...new Set(changedFiles)].sort();
  const material = changed.filter(path => !path.startsWith("notes/") && path !== manifestPath);
  const authored = material.filter(path => !GENERATED.has(path));
  const documentWaivers = parseWaivers(documentWaiverText);
  if (!manifest || typeof manifest !== "object") return { ok: false, errors: [`缺少宏观对齐声明 ${manifestPath}`], changedFiles: changed, affectedNodeIds: [] };
  if (manifest.version !== 1 || manifest.issue !== issue) fail("宏观声明的 version/issue 与任务不一致");
  if (!["business", "ui-only", "docs-only", "engineering"].includes(manifest.kind)) fail("kind 必须为 business/ui-only/docs-only/engineering");
  if (!meaningful(manifest.summary)) fail("必须说明业务目标或工程目标，不能填占位内容");
  if (!catalog || catalog.version !== 1 || !Array.isArray(catalog.nodes)) {
    return { ok: false, errors: [...errors, "缺少有效项目目录，先运行 pnpm catalog:generate"], changedFiles: changed, affectedNodeIds: [] };
  }
  const domains = new Set([...array(catalog.domains), ...array(baseCatalog?.domains)].map(item => item.id));
  const applications = new Set([...array(catalog.applications), ...array(baseCatalog?.applications)].map(item => item.id));
  const nodes = new Set([...catalog.nodes, ...array(baseCatalog?.nodes)].map(item => item.id));
  const declaredDomains = array(manifest.domains);
  if (!declaredDomains.length || declaredDomains.some(id => !domains.has(id))) fail("必须引用真实业务域，不接受空或未知 domain");
  if (!Array.isArray(manifest.applications) || manifest.applications.some(id => !applications.has(id))) fail("applications 必须引用真实源码应用");
  for (const path of material) {
    if (!safePath(path)) { fail("diff 包含不支持的路径"); continue; }
    const app = /^app\/([^/]+)\//.exec(path)?.[1];
    if (app && !array(manifest.applications).includes(app)) fail(`遗漏受影响应用：${app}`);
  }
  if (manifest.kind === "ui-only" && authored.some(path => !visual(path) && !docsOnly(path) && !/^tests\//.test(path))) fail("实际 diff 不只是样式/素材，不能声明 ui-only；组件逻辑、路由或配置需要完整评估");
  if (manifest.kind === "docs-only" && authored.some(path => !docsOnly(path))) fail("实际 diff 不只是文档，不能声明 docs-only");
  const businessFiles = authored.filter(path => /^app\/server\/src\/(?:routes|middleware|lib)\//.test(path) || /^app\/forum\/server\//.test(path)
    || /^app\/(?:web|console|forum)\/(?:src|app|sites|shared)\/.*\.(?:tsx?|vue)$/.test(path));
  if (businessFiles.length && manifest.kind !== "business") fail("涉及业务处理、授权或持久化实现，必须声明 business 并对齐业务流程");

  const pathExists = path => safePath(path) && !path.endsWith("/") && exists(path);
  const evidencePathExists = path => safePath(path) && !path.endsWith("/") && evidenceExists(path);
  for (const dimension of DIMENSIONS) {
    const assessment = manifest.assessments?.[dimension];
    if (!assessment || !["changed", "unchanged", "not-applicable"].includes(assessment.status)) {
      fail(`缺少有效评估维度：${dimension}`); continue;
    }
    if (!meaningful(assessment.reason)) fail(`${dimension} 必须给出具体理由，不能填“无影响”或占位内容`);
    if (!array(assessment.evidence).length || assessment.evidence.some(path => path === manifestPath || !evidencePathExists(path))) fail(`${dimension} 必须引用实际存在的源码/文档/测试证据，不能自证`);
    if (assessment.status === "changed" && !array(assessment.evidence).some(path => changed.includes(path))) fail(`${dimension} 声称 changed，但证据没有本 PR 的实际改动`);
  }
  const sensitive = {
    backend: material.filter(path => /^app\/(?:server\/src|forum\/server)\//.test(path)),
    permissions: material.filter(path => /^app\/(?:server\/src|forum\/server)\//.test(path)),
    data: material.filter(path => /^app\/(?:server\/src|forum\/server)\//.test(path) || /\/stores?\//.test(path)),
    dependencies: material.filter(path => /(?:package\.json|pnpm-lock\.yaml)$/.test(path) || /^app\/(?:server\/src|forum\/server)\//.test(path)),
    delivery: material.filter(path => /^(?:deploy\/|\.github\/workflows\/|\.githooks\/)/.test(path) || /(?:Dockerfile|vite\.config\.[cm]?ts|nuxt\.config\.ts)$/.test(path)),
  };
  for (const [dimension, paths] of Object.entries(sensitive)) {
    if (!paths.length) continue;
    const assessment = manifest.assessments?.[dimension];
    if (assessment?.status === "not-applicable" || !array(assessment?.evidence).some(path => paths.includes(path))) {
      fail(`${dimension} 触及敏感实现，必须评估并引用本次对应改动，不能写 not-applicable`);
    }
  }
  const coverage = array(manifest.coverage);
  if (material.length && !coverage.length) fail("必须按模块/用例声明 coverage");
  for (const entry of coverage) {
    if (!meaningful(entry.reason) || !array(entry.domains).length || entry.domains.some(id => !declaredDomains.includes(id))) fail("coverage 必须有具体对齐说明及已声明业务域");
    if (!array(entry.paths).length || entry.paths.some(path => !safePath(path) || broadScopes.has(path) || path.includes("*"))) fail("coverage 路径必须精确到文件或具体模块，不允许 app/、docs/ 等根目录或通配符");
    if (!array(entry.nodes).length || entry.nodes.some(id => !nodes.has(id))) fail("coverage 必须引用真实目录节点");
    for (const scope of array(entry.paths)) if (!material.some(path => covers(scope, path))) fail(`coverage 声明没有对应实际改动：${scope}`);
  }
  for (const path of material) if (!coverage.some(entry => array(entry.paths).some(scope => covers(scope, path)))) fail(`实际改动未对齐：${path}`);
  const ownerRecords = [...array(catalog.sourceOwnership), ...array(baseCatalog?.sourceOwnership)]
    .flatMap(item => array(item.domains).map(domain => ({ id: `domain:${domain}`, domain, source: { path: item.path } })));
  const records = [...array(catalog.routes), ...array(catalog.tables), ...array(catalog.capabilities), ...array(catalog.supplementalInterfaces),
    ...array(baseCatalog?.routes), ...array(baseCatalog?.tables), ...array(baseCatalog?.capabilities), ...array(baseCatalog?.supplementalInterfaces), ...ownerRecords];
  for (const path of businessFiles) if (!records.some(item => item.source?.path === path)) fail(`业务源码未登记归属：${path}，先补模块或消费者关联，不能静默归入 platform`);
  const affected = records.filter(item => material.includes(item.source?.path));
  for (const item of affected) {
    const covering = coverage.filter(entry => array(entry.paths).some(scope => covers(scope, item.source.path)));
    if (!declaredDomains.includes(item.domain) || !covering.some(entry => array(entry.domains).includes(item.domain))) fail(`源码影响业务域未对齐：${item.source.path} -> ${item.domain}`);
  }
  const flows = array(manifest.flows);
  const knownFlows = new Map(array(catalog.flows).map(flow => [flow.id, flow]));
  const removalTraces = new Set();
  for (const removal of array(manifest.removals)) {
    const path = removal?.path;
    const needle = removal?.baseAnchor;
    const owners = [...new Set(records.filter(item => item.source?.path === path).map(item => item.domain))];
    const eligible = safePath(path) && /\.(?:[cm]?[jt]sx?|vue)$/.test(path) && businessFiles.includes(path) && deletedFiles.includes(path) && !exists(path) && owners.length > 0;
    const oldText = eligible ? readBaseFile(path) : null;
    const valid = eligible
      && meaningful(removal.reason) && typeof oldText === "string" && typeof needle === "string" && needle.length >= 8
      && oldText.includes(needle) && oldText.indexOf(needle) === oldText.lastIndexOf(needle)
      && owners.length > 0 && owners.every(domain => array(removal.domains).includes(domain))
      && array(removal.domains).every(domain => declaredDomains.includes(domain));
    if (!valid) { fail(`删除声明缺少真实 base 源码/唯一锚点或业务域对齐：${String(path)}`); continue; }
    if (removal.replacement) {
      const replacementOwners = records.filter(item => item.source?.path === removal.replacement).map(item => item.domain);
      if (!safePath(removal.replacement) || !businessFiles.includes(removal.replacement) || !material.includes(removal.replacement)
        || !replacementOwners.length || replacementOwners.some(domain => !array(removal.domains).includes(domain))) {
        fail(`重命名后的源码归属未对齐：${removal.replacement}`); continue;
      }
      if (readHeadFile(removal.replacement) !== oldText) {
        fail(`重命名证据不成立：${path}，替换文件必须是本 PR 的相同内容源码`); continue;
      }
      removalTraces.add(removal.replacement);
    }
    removalTraces.add(path);
  }
  const activeBusinessFiles = businessFiles.filter(path => !removalTraces.has(path));
  if (manifest.kind === "business" && !flows.length && (activeBusinessFiles.length || !removalTraces.size)) fail("业务 PR 必须引用已登记业务流程；无现存流程的删除或纯重命名须提供实际 base 证据");
  if (flows.some(id => !knownFlows.has(id))) fail("flows 必须引用当前目录的业务流程；已删除的旧流程不能证明当前源码");
  if (manifest.kind === "business") {
    for (const domain of new Set(affected.filter(item => !removalTraces.has(item.source.path)).map(item => item.domain))) {
      if (!flows.some(id => [knownFlows.get(id)?.domain, ...array(knownFlows.get(id)?.relatedDomains)].includes(domain))) fail(`受影响业务域缺少流程对齐：${domain}`);
    }
    for (const path of activeBusinessFiles) if (!flows.some(id => array(knownFlows.get(id)?.evidence).some(evidence => evidence.path === path))) fail(`业务源码未关联具体流程证据：${path}`);
  }
  for (const id of flows) {
    const flow = knownFlows.get(id);
    if (flow && [flow.domain, ...array(flow.relatedDomains)].some(domain => !declaredDomains.includes(domain))) fail(`流程与声明业务域不一致：${id}`);
  }
  if (baseCatalog) {
    const previousRoutes = new Map(array(baseCatalog.routes).map(route => [route.id, route]));
    for (const route of array(catalog.routes)) {
      if (route.kind !== "business" || route.registration === "automatic-head" || route.method === "HEAD") continue;
      const previous = previousRoutes.get(route.id);
      if ((!previous || JSON.stringify(previous.schema) !== JSON.stringify(route.schema)) && !route.contractCoverage?.responseSchema) {
        fail(`新增或修改接口契约必须声明响应 Schema：${route.key}`);
      }
    }
    const tableShape = table => JSON.stringify({ sql: table.sql, columns: table.columns, foreignKeys: table.foreignKeys, indexes: table.indexes });
    const previousTables = new Map(array(baseCatalog.tables).map(table => [table.name, tableShape(table)]));
    const currentTables = new Map(array(catalog.tables).map(table => [table.name, tableShape(table)]));
    const schemaChanged = [...new Set([...previousTables.keys(), ...currentTables.keys()])].some(name => previousTables.get(name) !== currentTables.get(name));
    if (schemaChanged && manifest.assessments?.data?.status !== "changed") fail("数据库物理结构发生变化，data 必须声明 changed 并给出迁移、兼容和回归证据");
  } else if (businessFiles.length || array(catalog.routes).some(route => route.kind === "business" && route.source?.path === "app/server/src/app.ts")) {
    fail("首次目录基线不得混入业务接口、权限或数据库改动；先建立可比较的真实基线");
  }
  const documents = array(manifest.documents);
  if (!documents.length || documents.some(path => !humanDoc(path) || !pathExists(path))) fail("必须引用人工维护的相关文档，生成物和执行记录不能替代业务文档");
  const changedDocumentation = documents.some(path => changed.includes(path)) && manifest.assessments?.documentation?.status === "changed";
  const mappedModules = syncMap.filter(pair => pair.modules.some(prefix => authored.some(path => covers(prefix, path))));
  const checkedUnchanged = manifest.assessments?.documentation?.status === "unchanged"
    && documentWaivers.length > 0
    && (mappedModules.length ? mappedModules.every(pair => waives(documentWaivers, pair))
      : documents.every(path => documentWaivers.some(waiver => covers(waiver.path, path) || waiver.path.replace(/\/$/, "") === path)));
  if (authored.some(code) && !changedDocumentation && !checkedUnchanged) fail("代码/工作流变化必须同步相关人工文档，或在本任务新增有效文档核对；生成目录和空理由不能替代");
  const tests = array(manifest.tests);
  if (tests.some(path => !/^(?:tests\/|app\/forum\/tests\/)/.test(path) || !pathExists(path))) fail("tests 必须引用真实测试文件");
  if (authored.some(code) && !tests.some(path => changed.includes(path))) fail("代码/工作流变化必须有本 PR 新增或更新的回归测试");
  for (const key of ["compatibility", "migration", "rollback"]) if (!meaningful(manifest[key])) fail(`${key} 必须给出具体评估或说明不涉及的理由`);
  if (body !== null) {
    const { parts, duplicates } = parsePrSections(body);
    const section = parts.get("宏观对齐") ?? "";
    if (duplicates.has("宏观对齐")) fail("PR 正文必须只有一个宏观对齐段落");
    const reference = new RegExp(`(?:^|[^a-zA-Z0-9_])${manifestPath.replaceAll(".", "\\.")}(?=$|[^a-zA-Z0-9_./-])`);
    if (!reference.test(section)) fail(`PR 正文“宏观对齐”必须引用 ${manifestPath}，注释或代码块不算`);
  }
  const allAffected = [...new Set([...affected.map(item => item.id), ...coverage.flatMap(entry => array(entry.nodes)), ...flows])].sort();
  const currentNodeIds = new Set(catalog.nodes.map(item => item.id));
  return {
    ok: errors.length === 0, errors: [...new Set(errors)], issue, kind: manifest.kind,
    changedFiles: changed, affectedNodeIds: allAffected.filter(id => currentNodeIds.has(id)),
    removedNodeIds: allAffected.filter(id => !currentNodeIds.has(id)),
    removalTraces: [...removalTraces].sort(),
    domains: declaredDomains, assessments: manifest.assessments, catalogFingerprint: catalog.provenance?.fingerprint ?? null,
  };
}

function git(root, args) {
  return execFileSync("git", ["-C", root, ...args], { encoding: "utf8", maxBuffer: 32 * 1024 * 1024, stdio: ["ignore", "pipe", "pipe"] });
}
function commit(root, ref) {
  return git(root, ["rev-parse", "--verify", "--end-of-options", `${ref}^{commit}`]).trim();
}
export function inspectChange({ root, base = "origin/stage", head, branch, body = null, forge = "gitlab" }) {
  const task = TASK.exec(branch);
  if (!task) throw new Error("每个 PR 必须来自 task/<issue>/<slug>，不能跳过宏观对齐");
  const baseSha = commit(root, base), headSha = commit(root, head ?? "HEAD");
  const ancestor = git(root, ["merge-base", baseSha, headSha]).trim();
  const changed = git(root, ["diff", "--no-renames", "--name-only", "-z", ancestor, ...(head ? [headSha] : []), "--"]).split("\0").filter(Boolean);
  const deletedFiles = git(root, ["diff", "--no-renames", "--diff-filter=D", "--name-only", "-z", ancestor, ...(head ? [headSha] : []), "--"]).split("\0").filter(Boolean);
  if (!head) changed.push(...git(root, ["ls-files", "--others", "--exclude-standard", "-z"]).split("\0").filter(Boolean));
  function existsAt(path, revision = headSha) {
    if (!safePath(path)) return false;
    try { return git(root, ["cat-file", "-t", `${revision}:${path}`]).trim() === "blob"; } catch { return false; }
  }
  function local(path) {
    const absolute = resolve(root, path);
    if (!safePath(path) || !existsSync(absolute)) return false;
    const inside = relative(realpathSync(root), realpathSync(absolute));
    return inside !== ".." && !inside.startsWith(`..${sep}`) && !isAbsolute(inside) && lstatSync(absolute).isFile();
  }
  function read(path) {
    if (head) return existsAt(path) ? git(root, ["show", `${headSha}:${path}`]) : null;
    return local(path) ? readFileSync(resolve(root, path), "utf8") : null;
  }
  const issue = Number(task[1]), manifestPath = manifestPathFor(issue, forge);
  const parse = path => { const text = read(path); return text === null ? null : JSON.parse(text); };
  const chain = branch.replaceAll("/", "_");
  const notePaths = changed.filter(path => /^notes\/\d{4}-\d{2}-\d{2}\/[a-z0-9_-]+\//.test(path) && path.endsWith(`/${chain}.md`));
  const documentWaiverText = notePaths.map(path => {
    const before = existsAt(path, ancestor) ? git(root, ["show", `${ancestor}:${path}`]) : "";
    const after = read(path) ?? "";
    return after.startsWith(before) ? after.slice(before.length) : "";
  }).join("\n");
  let syncMap = [];
  if (parseWaivers(documentWaiverText).length) {
    const map = existsAt("docs/README.md", ancestor) ? git(root, ["show", `${ancestor}:docs/README.md`]) : read("docs/README.md");
    if (!map) throw new Error("文档核对缺少模块与文档对照表");
    syncMap = parseSyncMap(map);
  }
  const result = checkAlignment({
    issue, manifest: parse(manifestPath), catalog: parse("docs/architecture/catalog/catalog.json"), changedFiles: changed,
    baseCatalog: existsAt("docs/architecture/catalog/catalog.json", ancestor) ? JSON.parse(git(root, ["show", `${ancestor}:docs/architecture/catalog/catalog.json`])) : null,
    exists: path => head ? existsAt(path) : local(path),
    evidenceExists: path => (head ? existsAt(path) : local(path)) || existsAt(path, ancestor), body, documentWaiverText, syncMap, deletedFiles,
    readBaseFile: path => safePath(path) && existsAt(path, ancestor) ? git(root, ["show", `${ancestor}:${path}`]) : null,
    readHeadFile: read,
    forge,
  });
  return { ...result, base: ancestor, head: head ? headSha : "working-tree", branch };
}

/**
 * hotfix 分支的默认基线：分支从 `origin/main` 拉出，按 `origin/stage` 比会把 main 自己的提交算进本次改动。
 * 只有这个 task 的 issue 在窗口登记里开着（登记读 `origin/main` 那份，本地还没合入时读 HEAD）才改用 `origin/main`；
 * 常规 task 分支、没有窗口、登记读不到时仍是 `origin/stage`。
 */
export function hotfixBase(registry, branch, now = new Date()) {
  const issue = TASK.exec(branch ?? "")?.[1];
  if (!issue) return null;
  return activeWindows(registry, now).some((item) => String(item.issue) === issue) ? "origin/main" : null;
}

function defaultBase(root, branch, explicit) {
  if (explicit) return explicit;
  let registry = null;
  try { registry = readRegistryAt(root, "origin/main") ?? readRegistryAt(root, "HEAD"); } catch { registry = null; }
  const base = hotfixBase(registry, branch);
  if (!base) return "origin/stage";
  try { commit(root, base); return base; } catch { return "origin/stage"; }
}

function main() {
  const options = {};
  const allowed = new Set(["root", "base", "head", "branch", "body-file", "report", "forge"]);
  for (let i = 2; i < process.argv.length; i += 2) {
    const name = process.argv[i].replace(/^--/, "");
    if (!allowed.has(name) || !process.argv[i].startsWith("--") || !process.argv[i + 1] || name in options) throw new Error("参数无效：--root --base --head --branch --body-file --report --forge gitlab|github");
    options[name] = process.argv[i + 1];
  }
  // GitHub Actions 只跑在 GitHub 镜像上：没传 --forge 时读 GitHub 一侧的声明，core 的 pnpm check 与 architecture-alignment 读同一份（#335）。
  const forge = options.forge ?? (process.env.GITHUB_ACTIONS === "true" ? "github" : "gitlab");
  if (!FORGES.includes(forge)) throw new Error(`--forge 只能是 gitlab 或 github：${forge}`);
  const root = resolve(options.root ?? process.cwd());
  const branch = options.branch ?? (process.env.GITHUB_HEAD_REF || git(root, ["branch", "--show-current"]).trim());
  if (!options.branch && !options.head && !TASK.test(branch)) {
    console.log("非任务检出：逐 PR 宏观对齐由 architecture-alignment 检查；目录新鲜度仍由 check:catalog 核对。"); return;
  }
  const body = options["body-file"] ? readFileSync(options["body-file"], "utf8") : null;
  const result = inspectChange({ root, base: defaultBase(root, branch, options.base), head: options.head, branch, body, forge });
  if (options.report) writeFileSync(resolve(options.report), `${JSON.stringify(result, null, 2)}\n`);
  for (const error of result.errors) console.error(`宏观对齐：${JSON.stringify(error)}`);
  console.log(`宏观对齐${result.ok ? "通过" : "失败"}：#${result.issue}，${result.changedFiles.length} 个变更文件，${result.affectedNodeIds.length} 个关联节点。`);
  if (!result.ok) process.exitCode = 1;
}
if (process.argv[1] && realpathSync(resolve(process.argv[1])) === fileURLToPath(import.meta.url)) {
  try { main(); } catch (error) { console.error(`宏观对齐失败：${JSON.stringify(error.message)}`); process.exitCode = 1; }
}

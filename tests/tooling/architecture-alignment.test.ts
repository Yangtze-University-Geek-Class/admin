import { afterEach, expect, it } from "vitest";
import { execFileSync, spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { checkAlignment, DIMENSIONS, inspectChange, manifestPathFor } from "../../scripts/check-architecture.mjs";

function fixture() {
  const files = ["app/web/styles/theme.css", "docs/services/web/README.md", "tests/web/theme.test.ts", "docs/changes/12.json"];
  const assessments = Object.fromEntries(DIMENSIONS.map((key: string) => [key, {
    status: key === "documentation" || key === "verification" ? "changed" : "unchanged",
    reason: "只调整现有样式间距，相关业务行为保持原样并已明确核对。",
    evidence: [key === "documentation" ? files[1] : key === "verification" ? files[2] : files[0]],
  }]));
  return {
    issue: 12, changedFiles: files, exists: (path: string) => files.includes(path),
    body: "### 宏观对齐\n\n声明：docs/changes/12.json\n\n### 解决链路\n保持业务行为。",
    catalog: { version: 1, domains: [{ id: "portal" }], applications: [{ id: "web" }], nodes: [{ id: "application:web" }], routes: [], tables: [], capabilities: [], flows: [] },
    manifest: {
      version: 1, issue: 12, kind: "ui-only", summary: "调整既有页面的样式间距，不改变操作或数据处理。",
      applications: ["web"], domains: ["portal"], flows: [], assessments,
      coverage: [{ paths: files.slice(0, 3), domains: ["portal"], nodes: ["application:web"], reason: "所有变更均围绕现有官网样式、维护说明和视觉回归。" }],
      tests: [files[2]], documents: [files[1]],
      compatibility: "接口及数据格式保持不变，不需要消费者迁移。",
      migration: "未改变数据库或存储结构，不需要执行数据迁移。",
      rollback: "恢复本次样式与说明即可，不涉及业务数据回滚。",
    },
  };
}

it("rejects a PR without its macro-granularity declaration", () => {
  expect(checkAlignment({ ...fixture(), manifest: null }).ok).toBe(false);
});

it("does not count fenced, indented or duplicate sections as a macro declaration", () => {
  for (const body of [
    "### 宏观对齐\n~~~markdown\ndocs/changes/12.json\n~~~",
    "### 宏观对齐\n  ````markdown\ndocs/changes/12.json\n  ````",
    "### 宏观对齐\n\n    docs/changes/12.json",
    "### 宏观对齐\n没有声明\n### 宏观对齐\ndocs/changes/12.json",
  ]) expect(checkAlignment({ ...fixture(), body }).ok).toBe(false);
});

it("does not use a deleted base flow as evidence for retained business source", () => {
  const input = fixture();
  const path = "app/web/sites/portal/pages/Home.tsx";
  input.changedFiles[0] = path;
  input.manifest.kind = "business";
  input.manifest.flows = ["flow:old_home"];
  input.manifest.coverage[0].paths[0] = path;
  for (const assessment of Object.values(input.manifest.assessments)) {
    assessment.evidence = assessment.evidence.map(value => value === "app/web/styles/theme.css" ? path : value);
  }
  const catalog = { ...input.catalog, sourceOwnership: [{ path, domains: ["portal"] }], flows: [] };
  const baseCatalog = { ...catalog, nodes: [...catalog.nodes, { id: "flow:old_home" }],
    flows: [{ id: "flow:old_home", domain: "portal", evidence: [{ path }] }] };
  expect(checkAlignment({ ...input, catalog, baseCatalog }).errors.join()).toContain("当前目录");
});

it("accepts an aligned UI change with a visible PR reference and all eight assessments", () => {
  expect(checkAlignment(fixture()).errors).toEqual([]);
});

it.each(DIMENSIONS)("rejects omission or placeholder text in %s", (dimension: string) => {
  const missing = fixture();
  delete missing.manifest.assessments[dimension];
  expect(checkAlignment(missing).ok).toBe(false);
  const placeholder = fixture();
  placeholder.manifest.assessments[dimension].reason = "无影响";
  expect(checkAlignment(placeholder).ok).toBe(false);
});

it("does not trust a UI-only label when the actual diff changes backend authorization", () => {
  const input = fixture();
  input.changedFiles.push("app/server/src/middleware/require-auth.ts");
  expect(checkAlignment(input).errors.join("\n")).toMatch(/不能声明 ui-only/);
  expect(checkAlignment(input).errors.join("\n")).toMatch(/必须声明 business/);
  expect(checkAlignment(input).errors.join("\n")).toMatch(/permissions/);
});

it("cannot disguise email side effects or frontend application logic as engineering-only", () => {
  for (const path of ["app/server/src/lib/mail/mailer.ts", "app/console/src/pages/Applications.vue"]) {
    const input = fixture();
    input.manifest.kind = "engineering";
    input.changedFiles.push(path);
    expect(checkAlignment(input).errors.join()).toContain("必须声明 business");
  }
});

it("includes Nitro and non-route business implementations in domain/flow alignment", () => {
  for (const path of ["app/forum/server/middleware/forum-markdown.ts", "app/server/src/lib/forum-store.ts"]) {
    const input = fixture();
    input.manifest.kind = "engineering";
    input.changedFiles.push(path);
    expect(checkAlignment(input).errors.join()).toContain("必须声明 business");
    input.manifest.kind = "business";
    const catalog = { ...input.catalog, domains: [{ id: "portal" }, { id: "forum" }],
      sourceOwnership: [{ path, domains: ["forum"] }],
      flows: [{ id: "flow:unrelated", domain: "portal", evidence: [{ path: "app/web/styles/theme.css" }] }],
    };
    const manifest = { ...input.manifest, flows: ["flow:unrelated"] };
    const result = checkAlignment({ ...input, catalog, baseCatalog: catalog, manifest });
    expect(result.errors.join()).toContain("源码影响业务域未对齐");
    expect(result.errors.join()).toContain("业务源码未关联具体流程证据");
  }
});

it("does not let regenerated catalog artifacts turn a documentation-only PR into code changes", () => {
  const input = fixture();
  const generated = ["catalog.json", "CATALOG.md", "routes.md", "data-model.md", "permissions.md", "map.html"].map(name => `docs/architecture/catalog/${name}`);
  input.changedFiles = ["docs/services/web/README.md", ...generated, "docs/changes/12.json"];
  input.manifest.kind = "docs-only";
  input.manifest.applications = [];
  input.manifest.tests = [];
  input.manifest.assessments.verification.status = "unchanged";
  input.manifest.coverage[0].paths = input.changedFiles.slice(0, -1);
  expect(checkAlignment(input).errors).toEqual([]);
});

it("accepts an actual unchanged-document review without weakening empty-reason rejection", () => {
  const input = fixture();
  input.changedFiles = input.changedFiles.filter(path => path !== "docs/services/web/README.md");
  input.manifest.assessments.documentation.status = "unchanged";
  input.manifest.coverage[0].paths = input.manifest.coverage[0].paths.filter(path => path !== "docs/services/web/README.md");
  const valid = "文档核对：docs/services/web/ 不用改——仅收紧已有样式间距和回归，页面功能与文档事实完全不变";
  const syncMap = [{ modules: ["app/web/"], docs: ["docs/services/web/"], headers: ["docs/services/web/README.md"] }];
  expect(checkAlignment({ ...input, syncMap, documentWaiverText: valid }).errors).toEqual([]);
  expect(checkAlignment({ ...input, syncMap, documentWaiverText: "文档核对：docs/services/web/ 不用改——<理由>" }).ok).toBe(false);
  expect(checkAlignment({ ...input, syncMap, documentWaiverText: valid.replace("docs/services/web/", "docs/services/server/") }).ok).toBe(false);
});

it("traces deletion and pure rename through real base evidence without inventing a current flow", () => {
  const oldPath = "app/server/src/lib/password-policy.ts";
  const nextPath = "app/server/src/lib/legacy-password.ts";
  const doc = "docs/services/server/README.md", test = "tests/server/cleanup.test.ts";
  const oldText = "export function legacyPasswordPolicy() { return false; }\n";
  const catalog = { version: 1, applications: [{ id: "server" }], domains: [{ id: "identity" }],
    nodes: [{ id: "domain:identity" }, { id: "application:server" }], routes: [], tables: [], capabilities: [], flows: [], sourceOwnership: [] };
  const baseCatalog = { ...catalog, sourceOwnership: [{ path: oldPath, domains: ["identity"] }] };
  const template = fixture().manifest;
  const assessments = Object.fromEntries(DIMENSIONS.map((key: string) => [key, {
    status: key === "documentation" || key === "verification" ? "changed" : "unchanged",
    reason: "删除已核对的未使用历史模块，保留身份边界及现有调用行为，不影响业务数据。",
    evidence: [key === "documentation" ? doc : key === "verification" ? test : oldPath],
  }]));
  const manifest = { ...template, kind: "business", domains: ["identity"], applications: ["server"], flows: [], assessments,
    coverage: [{ paths: [oldPath, doc, test], domains: ["identity"], nodes: ["domain:identity"], reason: "历史模块移除对应旧源码、身份域、服务说明和新增清理回归，不能假造还存在的流程。" }],
    documents: [doc], tests: [test],
    removals: [{ path: oldPath, domains: ["identity"], baseAnchor: "export function legacyPasswordPolicy",
      reason: "移除没有消费者的历史密码策略，旧源码以基线提交核对，身份与会话仍由现有服务提供。" }],
  };
  const input = { issue: 12, manifest, catalog, baseCatalog, changedFiles: [oldPath, doc, test, "docs/changes/12.json"],
    deletedFiles: [oldPath], exists: (path: string) => [doc, test].includes(path),
    evidenceExists: (path: string) => [oldPath, doc, test].includes(path),
    readBaseFile: (path: string) => path === oldPath ? oldText : null };
  expect(checkAlignment(input).errors).toEqual([]);
  expect(checkAlignment({ ...input, deletedFiles: [] }).ok).toBe(false);
  expect(checkAlignment({ ...input, readBaseFile: () => "unrelated old source" }).ok).toBe(false);
  const renamed = {
    ...input, changedFiles: [...input.changedFiles, nextPath], exists: (path: string) => [nextPath, doc, test].includes(path),
    catalog: { ...catalog, sourceOwnership: [{ path: nextPath, domains: ["identity"] }] },
    manifest: { ...manifest, coverage: [{ ...manifest.coverage[0], paths: [...manifest.coverage[0].paths, nextPath] }],
      removals: [{ ...manifest.removals[0], replacement: nextPath }] },
    readHeadFile: (path: string) => path === nextPath ? oldText : null,
  };
  expect(checkAlignment(renamed).errors).toEqual([]);
  expect(checkAlignment({ ...renamed, readHeadFile: () => `${oldText}// other change` }).ok).toBe(false);
});

it("rejects uncovered files, broad root coverage and non-existent catalog references", () => {
  const missing = fixture();
  missing.changedFiles.push("app/web/styles/other.css");
  expect(checkAlignment(missing).errors.join()).toContain("实际改动未对齐");
  const broad = fixture();
  broad.manifest.coverage[0].paths = ["app/"];
  expect(checkAlignment(broad).errors.join()).toContain("精确到文件");
  const dangling = fixture();
  dangling.manifest.coverage[0].nodes = ["route:GET /invented"];
  expect(checkAlignment(dangling).errors.join()).toContain("真实目录节点");
});

it("rejects generated-only documentation, missing new regression and hidden PR references", () => {
  const generated = fixture();
  generated.manifest.documents = ["docs/architecture/catalog/routes.md"];
  expect(checkAlignment(generated).errors.join()).toContain("人工维护");
  const noTest = fixture();
  noTest.manifest.tests = [];
  expect(checkAlignment(noTest).errors.join()).toContain("回归测试");
  for (const body of ["### 宏观对齐\n<!-- docs/changes/12.json -->", "### 宏观对齐\n```\ndocs/changes/12.json\n```", "### 宏观对齐\ndocs/changes/12.json.fake"]) {
    expect(checkAlignment({ ...fixture(), body }).ok).toBe(false);
  }
});

it("requires response contracts for new operations after the baseline and explicit migration assessment for schema changes", () => {
  const input = fixture();
  const baseCatalog = { ...input.catalog, routes: [], tables: [] };
  const route = { id: "route:POST /api/new", key: "POST /api/new", kind: "business", registration: "explicit", method: "POST", schema: {}, contractCoverage: { responseSchema: false } };
  const catalog = { ...input.catalog, routes: [route], tables: [{ name: "new_table", sql: "CREATE TABLE new_table(id INTEGER)", columns: [], foreignKeys: [], indexes: [] }] };
  const result = checkAlignment({ ...input, catalog, baseCatalog });
  expect(result.errors.join()).toContain("必须声明响应 Schema");
  expect(result.errors.join()).toContain("data 必须声明 changed");
});

const temporary: string[] = [];
afterEach(() => { for (const path of temporary.splice(0)) rmSync(path, { recursive: true, force: true }); });

it("checks actual Git snapshots, not an unrelated dirty worktree, without executing candidate code", () => {
  const root = mkdtempSync(join(tmpdir(), "architecture-git-"));
  temporary.push(root);
  const git = (...args: string[]) => execFileSync("git", args, { cwd: root, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();
  const write = (path: string, content: string) => { mkdirSync(dirname(join(root, path)), { recursive: true }); writeFileSync(join(root, path), content); };
  const input = fixture();
  git("init", "-b", "stage"); git("config", "user.name", "Fixture"); git("config", "user.email", "fixture@example.invalid");
  for (const path of input.changedFiles.slice(0, 3)) write(path, "baseline");
  write("docs/architecture/catalog/catalog.json", JSON.stringify(input.catalog));
  git("add", "."); git("commit", "-m", "fixture baseline");
  const base = git("rev-parse", "HEAD");
  git("switch", "-c", "task/12/ui_spacing");
  for (const path of input.changedFiles.slice(0, 3)) write(path, "updated fixture");
  write("docs/changes/12.json", JSON.stringify(input.manifest));
  git("add", "."); git("commit", "-m", "fixture candidate");
  const head = git("rev-parse", "HEAD");
  const result = inspectChange({ root, base, head, branch: "task/12/ui_spacing", body: input.body });
  expect(result.errors).toEqual([]);
  write("docs/changes/12.json", "{}");
  write("app/server/src/routes/unsafe.ts", 'throw new Error("candidate code must never execute");');
  expect(inspectChange({ root, base, head, branch: "task/12/ui_spacing", body: input.body }).ok).toBe(true);
  expect(inspectChange({ root, base, branch: "task/12/ui_spacing", body: input.body }).ok).toBe(false);
  expect(() => inspectChange({ root, base, head, branch: "dev/alice" })).toThrow("不能跳过");
});

it("hotfix 窗口开着时，宏观对齐的默认基线是 origin/main，其余情况仍是 origin/stage", async () => {
  const { hotfixBase } = await import("../../scripts/check-architecture.mjs");
  const registry = { schemaVersion: 1, windows: [{
    issue: 309, tag: "v0.1.1", status: "open", approvedBy: "所有者",
    approvedAt: "2026-10-28T19:11:00+08:00", expiresAt: "2026-11-04T19:11:00+08:00", approval: "线上 bug 必须全部走 hotfix",
  }] };
  const now = new Date("2026-10-28T23:00:00+08:00");
  expect(hotfixBase(registry, "task/309/env_isolation_parity", now)).toBe("origin/main");
  expect(hotfixBase(registry, "task/310/other_work", now)).toBe(null);
  expect(hotfixBase(registry, "stage", now)).toBe(null);
  expect(hotfixBase(null, "task/309/env_isolation_parity", now)).toBe(null);
  const closed = { schemaVersion: 1, windows: [{ ...registry.windows[0], status: "closed", closedAt: "2026-10-29T08:00:00+08:00", evidence: "合回 stage 的提交与线上核对" }] };
  expect(hotfixBase(closed, "task/309/env_isolation_parity", now)).toBe(null);
  const expired = { schemaVersion: 1, windows: [{ ...registry.windows[0], expiresAt: "2026-10-29T19:11:00+08:00" }] };
  expect(hotfixBase(expired, "task/309/env_isolation_parity", new Date("2026-10-30T09:00:00+08:00"))).toBe(null);
});

const manifest12 = () => fixture().manifest;
/** 临时 Git 仓库：基线里放入 files（含两份声明），候选提交只改三个源文件，用来比较不同平台取到的声明。 */
function forgeRepo(files: Record<string, string>) {
  const input = fixture();
  const root = mkdtempSync(join(tmpdir(), "architecture-forge-"));
  temporary.push(root);
  const git = (...args: string[]) => execFileSync("git", args, { cwd: root, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();
  const write = (path: string, content: string) => { mkdirSync(dirname(join(root, path)), { recursive: true }); writeFileSync(join(root, path), content); };
  git("init", "-b", "stage"); git("config", "user.name", "Fixture"); git("config", "user.email", "fixture@example.invalid");
  for (const path of input.changedFiles.slice(0, 3)) write(path, "baseline");
  write("docs/architecture/catalog/catalog.json", JSON.stringify(input.catalog));
  for (const [path, content] of Object.entries(files)) write(path, content);
  git("add", "."); git("commit", "-m", "fixture baseline");
  const base = git("rev-parse", "HEAD");
  git("switch", "-c", "task/12/ui_spacing");
  for (const path of input.changedFiles.slice(0, 3)) write(path, "updated fixture");
  git("add", "."); git("commit", "-m", "fixture candidate");
  const head = git("rev-parse", "HEAD");
  return { root, base, head, body: input.body };
}

it("按平台取宏观声明：GitHub 同步工单读 docs/changes/github/<编号>.json，同号的 GitLab 声明各取各的（#330）", () => {
  expect(manifestPathFor(306)).toBe("docs/changes/306.json");
  expect(manifestPathFor(306, "gitlab")).toBe("docs/changes/306.json");
  expect(manifestPathFor(306, "github")).toBe("docs/changes/github/306.json");
  expect(() => manifestPathFor(306, "gitea")).toThrow("forge 只能是 gitlab 或 github");
  const { root, base, head, body } = forgeRepo({
    "docs/changes/12.json": JSON.stringify(manifest12()),
    "docs/changes/github/12.json": JSON.stringify({ ...manifest12(), kind: "engineering", summary: "GitHub 同步工单的工程声明，与 GitLab 同号声明互不覆盖。" }),
  });
  const branch = "task/12/ui_spacing";
  const gitlab = inspectChange({ root, base, head, branch, body });
  expect(gitlab.ok).toBe(true);
  expect(gitlab.kind).toBe("ui-only");
  const github = inspectChange({ root, base, head, branch, body: body.replace("docs/changes/12.json", "docs/changes/github/12.json"), forge: "github" });
  expect(github.ok).toBe(true);
  expect(github.kind).toBe("engineering");
  expect(inspectChange({ root, base, head, branch, body, forge: "github" }).errors.join()).toContain("docs/changes/github/12.json");
});

it("--forge github 缺 github/ 下的声明时报错，不回退去读 GitLab 的同号声明", () => {
  const { root, base, head, body } = forgeRepo({ "docs/changes/12.json": JSON.stringify(manifest12()) });
  const branch = "task/12/ui_spacing";
  expect(inspectChange({ root, base, head, branch, body }).ok).toBe(true);
  const github = inspectChange({ root, base, head, branch, body, forge: "github" });
  expect(github.ok).toBe(false);
  expect(github.errors.join()).toContain("docs/changes/github/12.json");
  expect(checkAlignment({ ...fixture(), manifest: null, forge: "github" }).errors.join()).toContain("docs/changes/github/12.json");
});

it("不传 forge 时与旧行为一致：只读 docs/changes/<编号>.json", () => {
  const { root, base, head, body } = forgeRepo({ "docs/changes/12.json": JSON.stringify(manifest12()) });
  const branch = "task/12/ui_spacing";
  const implicit = inspectChange({ root, base, head, branch, body });
  const explicit = inspectChange({ root, base, head, branch, body, forge: "gitlab" });
  expect(implicit).toEqual(explicit);
  expect(implicit.ok).toBe(true);
});

it("命令行 --forge 只接受 gitlab 或 github，其它值退出码非 0 且不写报告", () => {
  const { root } = forgeRepo({ "docs/changes/12.json": JSON.stringify(manifest12()) });
  const result = spawnSync(process.execPath, [join(dirname(fileURLToPath(import.meta.url)), "../../scripts/check-architecture.mjs"), "--root", root, "--branch", "task/12/ui_spacing", "--forge", "gitea"], { encoding: "utf8" });
  expect(result.status).not.toBe(0);
  expect(result.stderr).toContain("--forge 只能是 gitlab 或 github");
});

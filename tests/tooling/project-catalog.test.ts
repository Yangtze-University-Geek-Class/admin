import { afterEach, beforeAll, expect, it, vi } from "vitest";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { collectRuntime, ROOT } from "../../scripts/catalog/collect";
import { buildCatalog, OWNERSHIP_PATH, type Ownership, type Runtime } from "../../scripts/catalog/model";
import { renderCatalog } from "../../scripts/catalog/render";
import { canonical, registrationDetails, registrationSource, serialize, sourceReader } from "../../scripts/catalog/source";
import { checkArtifacts } from "../../scripts/project-catalog";

let runtime: Runtime;
let ownership: Ownership;
const temporary: string[] = [];
const directory = () => { const path = mkdtempSync(join(tmpdir(), "geek-catalog-")); temporary.push(path); return path; };
beforeAll(async () => {
  runtime = await collectRuntime();
  ownership = JSON.parse(readFileSync(join(ROOT, OWNERSHIP_PATH), "utf8"));
});
afterEach(() => {
  vi.unstubAllEnvs();
  for (const path of temporary.splice(0)) rmSync(path, { recursive: true, force: true });
});
const copy = () => structuredClone(ownership);

it("includes every observed method/path, nested avatar routes, loop routes and explicit versus automatic HEAD", () => {
  const catalog = buildCatalog(runtime, ownership);
  expect(catalog.routes.map(route => route.key).sort()).toEqual(runtime.routes.map(route => `${route.method} ${route.path}`).sort());
  const route = (key: string) => catalog.routes.find(item => item.key === key);
  expect(route("PUT /api/forum/me/avatar")?.source.path).toBe("app/server/src/routes/forum-api/people.ts");
  expect(route("POST /api/forum/topics/:topic_id/pin")).toBeDefined();
  expect(route("POST /api/forum/topics/:topic_id/close")).toBeDefined();
  expect(route("HEAD /api/forum/state")?.registration).toBe("explicit");
  expect(route("HEAD /api/docs")?.registration).toBe("automatic-head");
  expect(route("OPTIONS /auth/forum/*")?.kind).toBe("retired");
  expect(route("GET /healthz")?.kind).toBe("infrastructure");
  expect(route("GET /api/docs/:id")?.schema).toHaveProperty("params.properties.id.maxLength", 64);
  expect(route("POST /api/forum/notifications/read-all")?.method).toBe("POST");
  expect(route("GET /healthz")?.contractCoverage.responseSchema).toBe(false);
});

it("extracts actual database columns, foreign keys, indexes and all source capabilities without business records", () => {
  const catalog = buildCatalog(runtime, ownership);
  expect(catalog.tables.map(table => table.name)).toEqual(runtime.tables.map(table => table.name));
  const reviews = catalog.tables.find(table => table.name === "application_reviews")!;
  expect(reviews.foreignKeys).toEqual(expect.arrayContaining([expect.objectContaining({ table: "applications", from: "application_id", on_delete: "CASCADE" })]));
  expect(catalog.tables.find(table => table.name === "mail_outbox")?.foreignKeys).toEqual([]);
  const roles = catalog.tables.find(table => table.name === "role_assignments")!;
  expect(roles.indexes).toEqual(expect.arrayContaining([expect.objectContaining({ name: "uq_role_assignments_captain", unique: 1, partial: 1 })]));
  expect(catalog.capabilities.map(capability => capability.capability)).toEqual(runtime.capabilities.map(capability => capability.id));
  expect(catalog.capabilities.find(capability => capability.capability === "applications.review")?.implies).toContain("applications.read");
  expect(catalog.tables.every(table => !("rows" in table))).toBe(true);
  expect(catalog.deploymentStatus).toBe("not-observed");
  const markdown = renderCatalog(catalog)["data-model.md"];
  expect(markdown).toContain("| `application_id` | `TEXT` | 1 | 0 | 未声明 |");
  expect(markdown).toContain("| `uq_role_assignments_captain` | `role` | 1 |");
});

it("keeps Nitro/static declarations distinct from observed Fastify registrations", () => {
  const catalog = buildCatalog(runtime, ownership);
  expect(catalog.supplementalInterfaces).toHaveLength(5);
  expect(catalog.supplementalInterfaces.every(item => item.assessment === "static-declaration-not-runtime-observed")).toBe(true);
  expect(catalog.supplementalInterfaces.find(item => item.path === "/api/local-forum/assets/:hash")?.methods).toEqual(["GET", "HEAD"]);
  expect(catalog.supplementalInterfaces.find(item => item.path === "/llms.txt")?.scope).toBe("nitro-and-prerender");
});

it("links the cancellation flow without inventing a mail foreign key or successful verification", () => {
  const catalog = buildCatalog(runtime, ownership);
  expect(catalog.flows[0].testStatus).toBe("linked-not-executed-by-generator");
  expect(catalog.relations).toContainEqual(expect.objectContaining({ from: "flow:application.cancel", to: "table:mail_outbox", type: "does-not-enqueue", basis: "declaration" }));
  const nodes = new Set(catalog.nodes.map(node => node.id));
  expect(catalog.relations.every(edge => nodes.has(edge.from) && nodes.has(edge.to))).toBe(true);
});

it("produces deterministic, portable artifacts and detects stale generated content", async () => {
  const first = buildCatalog(runtime, ownership);
  const second = buildCatalog(await collectRuntime(), ownership);
  expect(serialize(first)).toBe(serialize(second));
  expect(first.provenance.sources.every(item => !item.path.startsWith("/") && !item.path.includes("\\"))).toBe(true);
  const artifacts = { "catalog.json": serialize(first), ...renderCatalog(first) };
  const path = directory();
  expect(() => checkArtifacts(artifacts, path)).toThrow("缺失或过期");
  for (const [name, value] of Object.entries(artifacts)) writeFileSync(join(path, name), value);
  expect(() => checkArtifacts(artifacts, path)).not.toThrow();
  writeFileSync(join(path, "routes.md"), "stale");
  expect(() => checkArtifacts(artifacts, path)).toThrow("routes.md");
});

it("keeps the checked-in directory synchronized with the current source and declarations", () => {
  const catalog = buildCatalog(runtime, ownership);
  checkArtifacts({ "catalog.json": serialize(catalog), ...renderCatalog(catalog) }, join(ROOT, "docs/architecture/catalog"));
});

it("does not use database, mail or credential settings from the ambient environment", async () => {
  const path = directory();
  vi.stubEnv("DB_PATH", join(path, "must-not-exist.db"));
  vi.stubEnv("MAIL_RESEND_API_KEY", "fixture-must-not-be-used");
  vi.stubEnv("MAIL_RESEND_FROM", "fixture@example.invalid");
  vi.stubEnv("SESSION_SECRET", "fixture-must-not-be-used");
  const result = await collectRuntime();
  expect(result.isolation).toEqual({ database: "memory", listening: false, externalRequests: "denied", backgroundWorkers: false });
  expect(serialize(buildCatalog(result, ownership))).not.toContain("fixture-must-not-be-used");
  expect(() => readFileSync(join(path, "must-not-exist.db"))).toThrow();
  await expect(collectRuntime(path)).rejects.toThrow("不能把另一目录");
});

it.each([
  ["unknown route owner", (value: Ownership) => { delete value.routeOwners["app/server/src/routes/portal/docs.ts"]; }, "没有业务归属"],
  ["duplicate domain", (value: Ownership) => { value.domains.push(value.domains[0]); }, "业务域 重复"],
  ["missing table owner", (value: Ownership) => { value.domains.find(domain => domain.tables.includes("sessions"))!.tables = []; }, "数据表没有业务归属"],
  ["duplicate table owner", (value: Ownership) => { value.domains[1].tables.push("sessions"); }, "表重复归属"],
  ["dangling route override", (value: Ownership) => { value.routeOverrides["GET /api/missing"] = "forum"; }, "覆盖声明悬空"],
  ["dangling capability", (value: Ownership) => { value.flows[0].capabilities.push("does.not.exist"); }, "未知能力"],
  ["missing evidence", (value: Ownership) => { value.flows[0].evidence[0].needle = "nonexistent-source-anchor"; }, "证据锚点不存在"],
  ["missing Nitro entry", (value: Ownership) => { value.supplementalInterfaces = value.supplementalInterfaces.filter(item => item.id !== "forum.local-state"); }, "Nitro 入口尚未纳入"],
])("fails closed for %s", (_label, mutate, error) => {
  const changed = copy();
  mutate(changed);
  expect(() => buildCatalog(runtime, changed)).toThrow(error);
});

it("rejects duplicate actual registrations and unowned new tables", () => {
  expect(() => buildCatalog({ ...runtime, routes: [...runtime.routes, runtime.routes[0]] }, ownership)).toThrow("实际注册路由 重复");
  expect(() => buildCatalog({ ...runtime, tables: [...runtime.tables, { ...runtime.tables[0], name: "new_business_table" }] }, ownership)).toThrow("数据表没有业务归属");
});

it("resolves actual stack positions and fails instead of inventing a source", () => {
  expect(registrationSource("/repo", "at route (/repo/app/server/src/app.ts:80:9)")).toEqual({ path: "app/server/src/app.ts", line: 80, column: 9 });
  expect(() => registrationSource("/repo", "at somewhere (unknown.js:1:1)")).toThrow("没有可追溯");
  const text = 'app.get("/api/test", { preHandler: requireCapability("audit.read") }, () => ({}));';
  expect(registrationDetails(text, { path: "test.ts", line: 1, column: 5 })).toMatchObject({
    declaredMethods: ["GET"], authorization: { capabilityGroups: [["audit.read"]], assessment: "partial-static-evidence" },
  });
});

it("does not attribute a hook in an unrelated function to a public registration", () => {
  const lines = [
    'function unrelated(app) { app.addHook("preHandler", requireAuth); }',
    'function routes(app) { app.get("/public", () => ({})); }',
  ];
  const detail = registrationDetails(lines.join("\n"), { path: "fixture.ts", line: 2, column: lines[1].indexOf("app.get") + 5 });
  expect(detail.authorization.checks).not.toContain("requireAuth");
});

it("guards source paths and evidence anchors and canonicalizes only JSON values", () => {
  const path = directory();
  writeFileSync(join(path, ".env"), "fixture-only");
  writeFileSync(join(path, "source.ts"), "anchor\nother\nanchor\n");
  const source = sourceReader(path);
  expect(() => source.read(".env")).toThrow("不得读取环境文件");
  expect(() => source.read(join(ROOT, "package.json"))).toThrow("越界");
  expect(() => source.evidence("source.ts", "anchor")).toThrow("不唯一");
  expect(source.evidence("source.ts", "other")).toEqual({ path: "source.ts", line: 2 });
  expect(serialize({ z: 1, a: { c: 2, b: 1 } })).toBe(serialize({ a: { b: 1, c: 2 }, z: 1 }));
  expect(() => canonical({ callback() {} })).toThrow("不可序列化");
});

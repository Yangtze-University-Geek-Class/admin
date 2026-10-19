import { readdirSync } from "node:fs";
import { join } from "node:path";
import { collectRuntime, ROOT } from "./collect.js";
import { registrationDetails, sourceReader, type Evidence } from "./source.js";

export const OWNERSHIP_PATH = "docs/architecture/catalog/ownership.json";
export type Ownership = {
  version: number; updated: string;
  applications: { id: string; title: string; root: string; runtime: string; docs: string }[];
  runtimeUnits: { id: string; title: string; source: string }[];
  domains: { id: string; title: string; docs: string[]; tables: string[] }[];
  routeOwners: Record<string, string>;
  routeOverrides: Record<string, string>;
  capabilityDomains: Record<string, string>;
  moduleOwners: Record<string, string[]>;
  tableNotes: Record<string, string>;
  supplementalInterfaces: {
    id: string; application: string; domain: string; path: string; methods: string[]; scope: string;
    source: { path: string; needle: string }; summary: string;
  }[];
  flows: {
    id: string; title: string; domain: string; relatedDomains?: string[]; assessment: string; operation: string; capabilities: string[];
    reads: string[]; writes: string[]; doesNotEnqueue: string[]; invariants: string[];
    evidence: { path: string; needle: string }[]; tests: string[]; docs: string[];
  }[];
};
export type Runtime = Awaited<ReturnType<typeof collectRuntime>>;
type Relation = { from: string; to: string; type: string; basis: "declaration" | "runtime" | "static-evidence"; evidence?: Evidence[] };
const compare = (a: string, b: string) => a < b ? -1 : a > b ? 1 : 0;
function requireThat(value: unknown, message: string): asserts value {
  if (!value) throw new Error(message);
}
function unique(values: string[], label: string) {
  const seen = new Set<string>();
  for (const value of values) {
    requireThat(typeof value === "string" && value.length > 0, `${label} 缺少名称`);
    requireThat(!seen.has(value), `${label} 重复：${value}`);
    seen.add(value);
  }
  return seen;
}
function sourceFiles(root: string, directory: string): string[] {
  return readdirSync(join(root, directory), { withFileTypes: true }).flatMap(entry => {
    const path = `${directory}/${entry.name}`;
    return entry.isDirectory() ? sourceFiles(root, path) : /\.(?:[cm]?[jt]sx?|vue)$/.test(entry.name) ? [path] : [];
  });
}

export function buildCatalog(runtime: Runtime, ownership: Ownership, root = ROOT) {
  const source = sourceReader(root);
  source.read(OWNERSHIP_PATH);
  requireThat(ownership.version === 1 && /^\d{4}-\d{2}-\d{2}$/.test(ownership.updated), "目录声明版本或更新日期无效");
  const domains = unique(ownership.domains.map(item => item.id), "业务域");
  const apps = unique(ownership.applications.map(item => item.id), "应用");
  const units = unique(ownership.runtimeUnits.map(item => item.id), "运行单元");
  const tableNames = unique(runtime.tables.map(table => table.name), "数据库表");
  const capabilityIds = unique(runtime.capabilities.map(capability => capability.id), "能力");
  unique(ownership.flows.map(flow => flow.id), "业务流程");
  unique(runtime.routes.map(route => `${route.method} ${route.path}`), "实际注册路由");
  const tableOwners = new Map<string, string>();
  const documents = new Set<string>();
  const tests = new Set<string>();
  for (const domain of ownership.domains) {
    requireThat(domain.title && domain.docs.length, `业务域缺少说明：${domain.id}`);
    for (const doc of domain.docs) { source.read(doc); documents.add(doc); }
    for (const name of domain.tables) {
      requireThat(tableNames.has(name), `声明引用不存在的表：${name}`);
      requireThat(!tableOwners.has(name), `表重复归属：${name}`);
      tableOwners.set(name, domain.id);
    }
  }
  const actualApps = readdirSync(join(root, "app"), { withFileTypes: true }).filter(entry => entry.isDirectory() && !entry.name.startsWith(".")).map(entry => entry.name);
  requireThat(actualApps.length === apps.size && actualApps.every(id => apps.has(id)), "app/ 与目录应用清单不一致");
  for (const environment of ["production", "preview"]) {
    const compose = source.read(`deploy/compose/${environment}.yml`);
    const services = /^services:\s*\n([\s\S]*?)(?=^[^\s#]|$(?![\s\S]))/m.exec(compose)?.[1] ?? "";
    const names = [...services.matchAll(/^  ([a-z][a-z0-9_-]*):\s*$/gm)].map(match => match[1]);
    requireThat(names.length === units.size && names.every(id => units.has(id)), `${environment} compose 与运行单元不一致`);
  }
  const applications = ownership.applications.map(app => {
    requireThat(app.root === `app/${app.id}` && units.has(app.runtime), `应用归属无效：${app.id}`);
    const manifest = JSON.parse(source.read(`${app.root}/package.json`));
    source.read(app.docs); documents.add(app.docs);
    return { ...app, package: manifest.name, basis: "declaration-checked-against-source" };
  });
  const runtimeUnits = ownership.runtimeUnits.map(unit => { source.read(unit.source); return { ...unit, environmentStatus: "not-observed" }; });
  const routeSources = new Set<string>();
  const routeKeys = new Set(runtime.routes.map(route => `${route.method} ${route.path}`));
  for (const key of Object.keys(ownership.routeOverrides)) requireThat(routeKeys.has(key), `路由覆盖声明悬空：${key}`);
  const routes = runtime.routes.map(route => {
    const key = `${route.method} ${route.path}`;
    const detail = registrationDetails(source.read(route.source.path), route.source);
    const automaticHead = route.method === "HEAD" && !detail.declaredMethods.includes("HEAD");
    const sourceKey = automaticHead ? `GET ${route.path}` : key;
    const domain = ownership.routeOverrides[sourceKey] ?? ownership.routeOwners[route.source.path];
    requireThat(domains.has(domain), `路由没有业务归属：${key}（${route.source.path}）`);
    routeSources.add(route.source.path);
    for (const group of detail.authorization.capabilityGroups) for (const capability of group) requireThat(capabilityIds.has(capability), `路由引用未知能力：${key} -> ${capability}`);
    const schema = route.schema as Record<string, unknown>;
    const rootRoute = route.source.path === "app/server/src/app.ts";
    const kind = rootRoute
      ? ["/api/forum", "/api/forum/*", "/auth/forum/*", "/forum/u/*"].includes(route.path) ? "retired" : route.path.startsWith("/api/") ? "business" : "infrastructure"
      : "business";
    return {
      id: `route:${key}`, key, method: route.method, path: route.path, kind, domain, application: "server",
      registration: automaticHead ? "automatic-head" : "explicit",
      source: { path: route.source.path, line: route.source.line },
      schema, authorization: detail.authorization,
      contractCoverage: {
        requestSections: ["params", "querystring", "headers", "body"].filter(part => schema[part] !== undefined),
        responseSchema: schema.response !== undefined,
        description: "仅报告已挂载 Schema，不代表所有请求语义或响应状态都已描述。",
      },
    };
  }).sort((a, b) => compare(a.key, b.key));
  for (const path of Object.keys(ownership.routeOwners)) requireThat(routeSources.has(path), `路由源码归属声明悬空：${path}`);
  for (const name of Object.keys(ownership.tableNotes)) requireThat(tableNames.has(name), `数据表说明悬空：${name}`);
  const tables = runtime.tables.map(table => {
    const domain = tableOwners.get(table.name);
    requireThat(domain, `数据表没有业务归属：${table.name}`);
    for (const fk of table.foreignKeys) requireThat(tableNames.has(String(fk.table)), `外键指向未知表：${table.name} -> ${fk.table}`);
    return {
      ...table, id: `table:${table.name}`, domain, database: "data.db",
      source: source.evidence("app/server/src/lib/db.ts", `CREATE TABLE IF NOT EXISTS ${table.name} (`),
      note: ownership.tableNotes[table.name] ?? "字段隐私、保留周期及读写范围需结合数据模型和业务实现核对，物理结构不能代替业务规则。",
    };
  });
  const capabilities = runtime.capabilities.map(capability => {
    const domain = ownership.capabilityDomains[capability.domain];
    requireThat(domains.has(domain), `能力没有业务归属：${capability.id}`);
    for (const implied of capability.implies) requireThat(capabilityIds.has(implied), `能力蕴含引用未知项：${capability.id} -> ${implied}`);
    return {
      ...capability, id: `capability:${capability.id}`, capability: capability.id, domain, capabilityDomain: capability.domain,
      source: source.evidence("app/server/src/lib/roles.ts", `{ id: "${capability.id}",`),
    };
  });
  unique(ownership.supplementalInterfaces.map(item => item.id), "补充接口");
  const supplementalSources = new Set(ownership.supplementalInterfaces.map(item => item.source.path));
  for (const path of [...sourceFiles(root, "app/forum/server/routes"), ...sourceFiles(root, "app/forum/server/middleware")]) {
    requireThat(supplementalSources.has(path), `Nitro 入口尚未纳入目录：${path}`);
  }
  const supplementalInterfaces = ownership.supplementalInterfaces.map(item => {
    requireThat(apps.has(item.application) && domains.has(item.domain) && item.methods.length, `补充接口归属无效：${item.id}`);
    unique(item.methods, `补充接口方法 ${item.id}`);
    requireThat(["development-only", "nitro-and-prerender"].includes(item.scope), `补充接口范围无效：${item.id}`);
    return { ...item, id: `interface:${item.id}`, source: source.evidence(item.source.path, item.source.needle), assessment: "static-declaration-not-runtime-observed" };
  });
  source.read("app/forum/server/utils/local-snapshot.ts");
  source.read("app/forum/nuxt.config.ts");
  const sourceOwnership = new Map<string, Set<string>>();
  function owns(path: string, domain: string) {
    requireThat(domains.has(domain), `源码归属引用未知业务域：${path} -> ${domain}`);
    const set = sourceOwnership.get(path) ?? new Set<string>();
    set.add(domain); sourceOwnership.set(path, set);
  }
  for (const item of [...routes, ...tables, ...capabilities, ...supplementalInterfaces]) owns(item.source.path, item.domain);
  const implementationFiles = [
    "app/server/src", "app/forum/server", "app/forum/app", "app/forum/shared",
    "app/web/sites", "app/web/shared", "app/console/src",
  ].flatMap(path => sourceFiles(root, path));
  const moduleOwners = Object.entries(ownership.moduleOwners ?? {}).sort(([a], [b]) => b.length - a.length);
  for (const [prefix, owners] of moduleOwners) {
    requireThat(prefix.startsWith("app/") && !prefix.includes("..") && owners.length && owners.every(domain => domains.has(domain)), `模块归属无效：${prefix}`);
    requireThat(implementationFiles.some(path => path.startsWith(prefix)), `模块归属未匹配源码：${prefix}`);
  }
  for (const path of implementationFiles) {
    if (sourceOwnership.has(path)) continue;
    const routeFolder = /^app\/server\/src\/routes\/[^/]+\//.exec(path)?.[0];
    const routeDomains = routeFolder ? routes.filter(route => route.source.path.startsWith(routeFolder)).map(route => route.domain) : [];
    const owners = routeDomains.length ? routeDomains : moduleOwners.find(([prefix]) => path.startsWith(prefix))?.[1] ?? [];
    for (const domain of owners) owns(path, domain);
  }
  const operations = new Map([
    ...routes.map(route => [route.key, { id: route.id, domain: route.domain, label: route.key }] as const),
    ...supplementalInterfaces.map(item => [item.id, { id: item.id, domain: item.domain, label: `${item.methods.join("/")} ${item.path}` }] as const),
  ]);
  const flows = ownership.flows.map(flow => {
    const operation = operations.get(flow.operation);
    const flowDomains = [flow.domain, ...(flow.relatedDomains ?? [])];
    requireThat(flowDomains.every(domain => domains.has(domain)) && operation && flowDomains.includes(operation.domain), `流程归属或操作悬空/不对齐：${flow.id}`);
    requireThat(flow.assessment === "declared-with-source-evidence" && flow.invariants.length && flow.evidence.length && flow.tests.length && flow.docs.length, `流程缺少规则或证据：${flow.id}`);
    for (const name of [...flow.reads, ...flow.writes, ...flow.doesNotEnqueue]) requireThat(tableNames.has(name), `流程引用未知表：${flow.id} -> ${name}`);
    for (const id of flow.capabilities) requireThat(capabilityIds.has(id), `流程引用未知能力：${flow.id} -> ${id}`);
    for (const path of flow.docs) { source.read(path); documents.add(path); }
    for (const path of flow.tests) { source.read(path); tests.add(path); }
    for (const name of [...flow.reads, ...flow.writes, ...flow.doesNotEnqueue]) requireThat(flowDomains.includes(tableOwners.get(name)!), `流程未声明数据所属业务域：${flow.id} -> ${name}`);
    return { ...flow, id: `flow:${flow.id}`, operationNodeId: operation.id, operationLabel: operation.label, evidence: flow.evidence.map(item => source.evidence(item.path, item.needle)), testStatus: "linked-not-executed-by-generator" };
  });
  const coveredOperations = new Set(flows.map(flow => flow.operationNodeId));
  const businessOperations = routes.filter(route => route.kind === "business" && route.registration === "explicit" && route.method !== "HEAD");
  for (const route of businessOperations) requireThat(coveredOperations.has(route.id), `业务接口缺少流程关联：${route.key}`);
  for (const item of supplementalInterfaces) requireThat(coveredOperations.has(item.id), `补充入口缺少流程关联：${item.id}`);

  const relations: Relation[] = [];
  const edge = (from: string, to: string, type: string, basis: Relation["basis"], evidence?: Evidence[]) => relations.push({ from, to, type, basis, ...(evidence ? { evidence } : {}) });
  for (const app of applications) {
    edge(`application:${app.id}`, `runtime:${app.runtime}`, "runs-in", "declaration");
    edge(`application:${app.id}`, `document:${app.docs}`, "documented-by", "declaration");
  }
  edge("database:data.db", "runtime:server", "stored-by", "declaration");
  for (const domain of ownership.domains) for (const doc of domain.docs) edge(`domain:${domain.id}`, `document:${doc}`, "documented-by", "declaration");
  for (const route of routes) {
    edge(route.id, `domain:${route.domain}`, "belongs-to", "declaration");
    edge("application:server", route.id, "provides", "runtime", [route.source]);
    for (const group of route.authorization.capabilityGroups) for (const id of group) edge(route.id, `capability:${id}`, "checks-capability", "static-evidence", [route.source]);
  }
  for (const item of supplementalInterfaces) {
    edge(item.id, `domain:${item.domain}`, "belongs-to", "declaration");
    edge(`application:${item.application}`, item.id, "declares", "static-evidence", [item.source]);
  }
  for (const table of tables) {
    edge(table.id, `domain:${table.domain}`, "belongs-to", "declaration");
    edge(table.id, "database:data.db", "stored-in", "runtime", [table.source]);
    for (const fk of table.foreignKeys) edge(table.id, `table:${fk.table}`, `foreign-key:${fk.from}->${fk.to}`, "runtime", [table.source]);
  }
  for (const capability of capabilities) {
    edge(capability.id, `domain:${capability.domain}`, "belongs-to", "declaration");
    for (const implied of capability.implies) edge(capability.id, `capability:${implied}`, "implies", "static-evidence", [capability.source]);
  }
  for (const flow of flows) {
    edge(flow.id, `domain:${flow.domain}`, "belongs-to", "declaration");
    edge(flow.id, flow.operationNodeId, "uses", "declaration", flow.evidence);
    for (const id of flow.capabilities) edge(flow.id, `capability:${id}`, "requires", "declaration", flow.evidence);
    for (const [type, names] of [["reads", flow.reads], ["writes", flow.writes], ["does-not-enqueue", flow.doesNotEnqueue]] as const) {
      for (const name of names) edge(flow.id, `table:${name}`, type, "declaration", flow.evidence);
    }
    for (const path of flow.tests) edge(flow.id, `test:${path}`, "test-entry", "declaration");
    for (const path of flow.docs) edge(flow.id, `document:${path}`, "documented-by", "declaration");
  }
  const nodes = [
    ...ownership.domains.map(item => ({ id: `domain:${item.id}`, kind: "domain", title: item.title })),
    ...applications.map(item => ({ id: `application:${item.id}`, kind: "application", title: item.title })),
    ...runtimeUnits.map(item => ({ id: `runtime:${item.id}`, kind: "runtime", title: item.title })),
    { id: "database:data.db", kind: "database", title: "data.db" },
    ...routes.map(item => ({ id: item.id, kind: "route", title: item.key })),
    ...supplementalInterfaces.map(item => ({ id: item.id, kind: "supplemental-interface", title: item.path })),
    ...tables.map(item => ({ id: item.id, kind: "table", title: item.name })),
    ...capabilities.map(item => ({ id: item.id, kind: "capability", title: item.label })),
    ...flows.map(item => ({ id: item.id, kind: "flow", title: item.title })),
    ...[...documents].sort().map(path => ({ id: `document:${path}`, kind: "document", title: path })),
    ...[...tests].sort().map(path => ({ id: `test:${path}`, kind: "test", title: path })),
  ].sort((a, b) => compare(a.id, b.id));
  const nodeIds = unique(nodes.map(node => node.id), "图节点");
  for (const relation of relations) requireThat(nodeIds.has(relation.from) && nodeIds.has(relation.to), `图关系悬空：${relation.from} -> ${relation.to}`);
  unique(relations.map(item => `${item.from}\0${item.type}\0${item.to}`), "图关系");
  relations.sort((a, b) => compare(`${a.from}\0${a.type}\0${a.to}`, `${b.from}\0${b.type}\0${b.to}`));
  // 所有后端实现都参与摘要，不能把“同一路径但行为变了”误当成基线没变。
  for (const path of sourceFiles(root, "app/server/src")) source.read(path);
  for (const path of sourceFiles(root, "scripts/catalog")) source.read(path);
  source.read("scripts/project-catalog.ts");
  source.read("scripts/catalog/viewer.html");
  source.read("pnpm-lock.yaml");
  for (const path of implementationFiles) source.read(path);
  return {
    version: 1, updated: ownership.updated, visibility: "internal-engineering", deploymentStatus: "not-observed",
    isolation: runtime.isolation, provenance: source.provenance(),
    applications, runtimeUnits, domains: ownership.domains, routes, supplementalInterfaces, tables, capabilities, flows, nodes, relations,
    sourceOwnership: [...sourceOwnership].sort(([a], [b]) => compare(a, b)).map(([path, owners]) => ({ path, domains: [...owners].sort() })),
    unmappedSources: implementationFiles.filter(path => !sourceOwnership.has(path)).sort(),
    coverage: {
      routeMethods: routes.length,
      businessOperations: businessOperations.length,
      businessOperationsWithFlow: businessOperations.filter(route => coveredOperations.has(route.id)).length,
      supplementalInterfacesWithFlow: supplementalInterfaces.filter(item => coveredOperations.has(item.id)).length,
      automaticHead: routes.filter(route => route.registration === "automatic-head").length,
      responseSchemas: routes.filter(route => route.contractCoverage.responseSchema).length,
      supplementalInterfaces: supplementalInterfaces.length,
      tables: tables.length, capabilities: capabilities.length, declaredFlows: flows.length,
    },
    limitations: [
      "这是源码与隔离运行时基线，不证明预发布或正式环境部署状态。",
      "业务操作、基础设施和退役路由分别分类；自动 HEAD 单列。关闭静态托管提取，不枚举静态文件资源。",
      "授权证据只覆盖直接可定位的检查，不推断所有条件、对象范围或间接调用。",
      "请求 Schema 存在不等于请求语义完整；没有响应 Schema 的端点保持缺失，不生成虚假契约。",
      "表结构来自空的内存数据库；没有读取业务记录，不代表旧库迁移已验证。",
      "仅显式声明的业务流程有读写及副作用关系；没有声明的流程不伪造关系。",
      "测试链接只是验证入口；生成器不把文件存在视为测试通过。",
      "app/forum 的 Nitro 接口和 Markdown 中间件单独按源码声明收录，不冒充本次实际启动过 Nitro；方法与挂载方式见对应源码及论坛合同。",
    ],
  };
}
export type Catalog = ReturnType<typeof buildCatalog>;

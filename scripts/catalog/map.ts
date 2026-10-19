import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import type { Catalog } from "./model.js";

type Port = { id: string; label: string; type: string };
type MapNode = {
  id: string; title: string; kind: string; status: string; basis: string; page: string; group: string;
  summary: string; detail: string; searchText: string; path: string; line?: number; meta: string[][]; evidence: string[];
  inputs: Port[]; outputs: Port[]; drill?: string;
};
const kindMap: Record<string, string> = {
  domain: "module", application: "service", runtime: "service", database: "store", table: "store",
  route: "entry", capability: "contract", flow: "job", document: "tool", test: "tool", "supplemental-interface": "entry",
};
const relationLabels: Record<string, string> = {
  "runs-in": "运行于", "documented-by": "文档", "stored-by": "存储归属", "belongs-to": "业务归属",
  provides: "提供接口", declares: "声明入口", "checks-capability": "能力检查", "stored-in": "数据库",
  implies: "蕴含", uses: "调用", requires: "要求能力", reads: "读取", writes: "写入",
  "does-not-enqueue": "不生成队列记录", "test-entry": "测试入口",
};
const relationType = (type: string) => /capability|requires|implies/.test(type) ? "identity"
  : /provides|declares|uses/.test(type) ? "http"
    : /document|test-entry/.test(type) ? "code"
      : /reads|writes|stored|foreign-key|enqueue/.test(type) ? "data" : "config";

export function buildMapGraph(catalog: Catalog) {
  const records = new Map<string, unknown>([
    ...catalog.routes.map(value => [value.id, value] as const),
    ...catalog.tables.map(value => [value.id, value] as const),
    ...catalog.capabilities.map(value => [value.id, value] as const),
    ...catalog.flows.map(value => [value.id, value] as const),
    ...catalog.supplementalInterfaces.map(value => [value.id, value] as const),
    ...catalog.applications.map(value => [`application:${value.id}`, value] as const),
    ...catalog.runtimeUnits.map(value => [`runtime:${value.id}`, value] as const),
    ...catalog.domains.map(value => [`domain:${value.id}`, value] as const),
  ]);
  const pages = [
    { id: "overview", title: "系统总览", cluster: "overview" },
    ...catalog.domains.map(domain => ({ id: `domain-${domain.id}`, title: domain.title, cluster: "business" })),
    { id: "data", title: "数据库模型", cluster: "structure" },
    { id: "permissions", title: "权限与能力", cluster: "structure" },
    { id: "derived", title: "自动 HEAD", cluster: "structure" },
    { id: "compatibility", title: "基础设施与退役接口", cluster: "structure" },
    { id: "flows", title: "业务流程", cluster: "evidence" },
    { id: "documents", title: "文档与测试", cluster: "evidence" },
  ];
  const nodes: MapNode[] = catalog.nodes.map(node => {
    const route = catalog.routes.find(value => value.id === node.id);
    const table = catalog.tables.find(value => value.id === node.id);
    const capability = catalog.capabilities.find(value => value.id === node.id);
    const flow = catalog.flows.find(value => value.id === node.id);
    const extra = catalog.supplementalInterfaces.find(value => value.id === node.id);
    const record = records.get(node.id) as Record<string, unknown> | undefined;
    const source = (record?.source as { path?: string; line?: number } | undefined);
    const page = route
      ? route.registration === "automatic-head" ? "derived" : route.kind !== "business" ? "compatibility" : `domain-${route.domain}`
      : table ? "data" : capability ? "permissions" : flow ? "flows"
        : extra ? `domain-${extra.domain}` : ["document", "test"].includes(node.kind) ? "documents" : "overview";
    const evidence = flow ? flow.evidence.map(value => `${value.path}:${value.line}`)
      : source?.path ? [`${source.path}${source.line ? `:${source.line}` : ""}`]
        : node.kind === "document" || node.kind === "test" ? [node.title] : [];
    const meta: string[][] = [["实体", node.kind]];
    if (route) meta.push(["方法", route.method], ["业务域", route.domain], ["响应契约", route.contractCoverage.responseSchema ? "已声明" : "未声明"], ["注册", route.registration]);
    if (table) meta.push(["业务域", table.domain], ["字段", String(table.columns.length)], ["外键", String(table.foreignKeys.length)], ["索引", String(table.indexes.length)]);
    if (capability) meta.push(["业务域", capability.domain], ["能力", capability.capability]);
    if (flow) meta.push(["业务域", flow.domain], ["操作", flow.operation], ["证据", "显式声明"]);
    let summary = node.title;
    let detail = record ? JSON.stringify(record, null, 2) : node.title;
    if (route) {
      summary = `${route.method} · ${route.domain} · ${route.contractCoverage.responseSchema ? "响应已声明" : "响应 Schema 待补"}`;
      detail = `请求与响应 Schema\n${JSON.stringify(route.schema, null, 2)}\n\n授权证据\n${route.authorization.checks.join("\n") || "需查看 handler 和继承策略"}\n${route.authorization.note}`;
      const useCases = catalog.flows.filter(value => value.operationNodeId === route.id);
      if (useCases.length) detail += `\n\n业务用例\n${useCases.map(value => `${value.title}\n${value.invariants.join("\n")}\n读取：${value.reads.join("、") || "无本地表"}\n写入：${value.writes.join("、") || "无本地表"}`).join("\n\n")}`;
    }
    if (table) {
      summary = `${table.columns.length} 字段 · ${table.foreignKeys.length} 外键 · ${table.domain}`;
      detail = `${table.note}\n\n字段\n${table.columns.map(column => `${column.name}  ${column.type}  ${column.notnull ? "NOT NULL" : ""}${column.pk ? ` PK(${column.pk})` : ""}  ${column.dflt_value === null ? "" : `DEFAULT ${column.dflt_value}`}`).join("\n")}\n\n索引\n${table.indexes.map(index => `${index.name}: ${index.sql ?? index.columns.filter(column => column.key === 1).map(column => column.name).join(", ")}`).join("\n")}\n\n物理外键\n${table.foreignKeys.map(fk => `${fk.from} → ${fk.table}.${fk.to} (ON DELETE ${fk.on_delete})`).join("\n") || "无"}\n\n${table.sql}`;
    }
    if (capability) detail = `${capability.description}\n\n蕴含：${capability.implies.join("、") || "无直接蕴含"}\n\n不读取真实用户、称号或部门权限包；是否获授权仍由服务端条件及资源范围判断。`;
    if (flow) detail = `${flow.invariants.join("\n")}\n\n操作：${flow.operation}\n能力：${flow.capabilities.join("、")}\n读取：${flow.reads.join("、")}\n写入：${flow.writes.join("、")}\n不入队：${flow.doesNotEnqueue.join("、")}\n\n${flow.evidence.map(value => `${value.path}:${value.line}`).join("\n")}\n\n测试入口（不等于本次通过）：\n${flow.tests.join("\n")}`;
    if (node.kind === "domain") {
      const domain = catalog.domains.find(value => `domain:${value.id}` === node.id)!;
      const count = catalog.routes.filter(value => value.domain === domain.id && value.registration === "explicit").length;
      const files = catalog.sourceOwnership.filter(value => value.domains.includes(domain.id)).map(value => value.path);
      summary = `${count} 个显式方法路径 · ${domain.tables.length} 张表`;
      detail = `${summary}\n\n源码与共享模块：\n${files.join("\n")}\n\n文档：\n${domain.docs.join("\n")}\n\n业务归属是显式声明，不等同于物理目录或部署单元。`;
    }
    return {
      id: node.id, title: node.title, kind: kindMap[node.kind] ?? "module",
      status: route?.kind === "retired" ? "retired" : route && !route.contractCoverage.responseSchema ? "partial" : ["domain", "flow", "supplemental-interface"].includes(node.kind) ? "planned" : "built",
      basis: ["domain", "flow", "supplemental-interface"].includes(node.kind) ? "doc" : "code",
      page, group: `${page}-${node.kind}`, summary, detail, searchText: detail,
      path: source?.path ?? (["document", "test"].includes(node.kind) ? node.title : String(record?.root ?? "")),
      ...(source?.line ? { line: source.line } : {}),
      meta, evidence, inputs: [], outputs: [],
      ...(node.kind === "domain" ? { drill: `domain-${node.id.slice("domain:".length)}` } : {}),
    };
  });
  const byId = new Map(nodes.map(node => [node.id, node]));
  const groups = [...new Set(nodes.map(node => node.group))].map(id => {
    const node = nodes.find(value => value.group === id)!;
    const kind = catalog.nodes.find(value => value.id === node.id)!.kind;
    const names: Record<string, string> = { domain: "业务域", application: "源码应用", runtime: "运行单元", database: "数据库", table: "数据表", route: "接口", capability: "能力", flow: "业务流程", document: "文档", test: "测试", "supplemental-interface": "补充入口" };
    return { id, page: node.page, title: names[kind], note: "", style: kind === "runtime" ? "boundary" : "module", parent: null };
  });
  const edges = catalog.relations.map((relation, index) => {
    const from = byId.get(relation.from), to = byId.get(relation.to);
    if (!from || !to) throw new Error(`地图关系悬空：${relation.from} -> ${relation.to}`);
    const portId = relation.type.startsWith("foreign-key:") ? "foreign-key" : relation.type;
    const label = relationLabels[relation.type] ?? (portId === "foreign-key" ? "物理外键" : relation.type);
    const type = relationType(relation.type);
    if (!from.outputs.some(port => port.id === portId)) from.outputs.push({ id: portId, label, type });
    if (!to.inputs.some(port => port.id === portId)) to.inputs.push({ id: portId, label, type });
    return { id: `edge-${index}`, from: `${from.id}#${portId}`, to: `${to.id}#${portId}`, type, label, page: from.page };
  });
  return {
    meta: { title: "geek_main · 项目地图", repo: "geek_main", fingerprint: catalog.provenance.fingerprint },
    clusters: [{ id: "overview", title: "总览" }, { id: "business", title: "业务域" }, { id: "structure", title: "接口与结构" }, { id: "evidence", title: "流程与证据" }],
    pages, nodes, groups, edges,
  };
}

export function renderMap(catalog: Catalog) {
  const template = readFileSync(fileURLToPath(new URL("./viewer.html", import.meta.url)), "utf8");
  if (template.split("__GRAPH_JSON__").length !== 2) throw new Error("地图模板必须有且只有一个数据插槽");
  const geometry = readFileSync(fileURLToPath(new URL("./geometry.mjs", import.meta.url)), "utf8").replace(/^export function /gm, "function ");
  if (template.split("__GEOMETRY_CODE__").length !== 2) throw new Error("地图模板必须有且只有一个几何函数插槽");
  const payload = JSON.stringify(buildMapGraph(catalog)).replaceAll("<", "\\u003c").replaceAll("\u2028", "\\u2028").replaceAll("\u2029", "\\u2029");
  // 一次替换模板中的插槽，不能再次扫描已经插入的用户/源码字符串。
  return template.replace(/__GRAPH_JSON__|__GEOMETRY_CODE__/g, marker => marker === "__GRAPH_JSON__" ? payload : geometry);
}

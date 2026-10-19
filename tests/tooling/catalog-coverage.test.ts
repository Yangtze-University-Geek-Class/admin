import { afterEach, beforeAll, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { setImmediate } from "node:timers/promises";
import { generateCatalog as collectCatalog } from "../../scripts/project-catalog";
import { collectRuntime, ROOT } from "../../scripts/catalog/collect";
import { buildCatalog, OWNERSHIP_PATH, type Ownership, type Runtime } from "../../scripts/catalog/model";

const recorded = JSON.parse(readFileSync(join(ROOT, "docs/architecture/catalog/catalog.json"), "utf8"));
const businessCases: string[] = recorded.routes.filter((route: { kind: string; registration: string; method: string }) =>
  route.kind === "business" && route.registration === "explicit" && route.method !== "HEAD")
  .map((route: { key: string }) => route.key);
const supplementalCases: string[] = recorded.supplementalInterfaces.map((item: { id: string }) => item.id);
let runtime: Runtime;
let ownership: Ownership;
beforeAll(async () => {
  runtime = await collectRuntime();
  ownership = JSON.parse(readFileSync(join(ROOT, OWNERSHIP_PATH), "utf8"));
});
// 每次同步源码分析后让 worker 处理进度 RPC；连续微任务会饿死托管机器的 I/O。
afterEach(() => setImmediate());

it("每个业务操作和补充入口都有可追溯的业务用例", async () => {
  const catalog = await collectCatalog();
  const business = catalog.routes.filter(route =>
    route.kind === "business" && route.registration === "explicit" && route.method !== "HEAD");
  const operations = [...business, ...catalog.supplementalInterfaces];
  const covered = new Set(catalog.flows.map(flow => flow.operationNodeId));
  expect(businessCases.slice().sort()).toEqual(business.map(route => route.key).sort());
  expect(supplementalCases.slice().sort()).toEqual(catalog.supplementalInterfaces.map(item => item.id).sort());
  const missing = operations.filter(operation => !covered.has(operation.id)).map(operation => operation.id);
  console.log(`业务用例覆盖：${business.filter(route => covered.has(route.id)).length}/${business.length} 业务操作，`
    + `${catalog.supplementalInterfaces.filter(route => covered.has(route.id)).length}/${catalog.supplementalInterfaces.length} 补充入口`);
  expect(missing, "已注册操作不能仅有路由节点而没有业务用例").toEqual([]);
});

// 每个真实操作单列，避免同步批处理阻塞托管 runner 的测试进度通信。
it.each(businessCases)("删除 %s 的全部流程关联时拒绝生成", operation => {
  const changed = structuredClone(ownership);
  changed.flows = changed.flows.filter(flow => flow.operation !== operation);
  expect(() => buildCatalog(runtime, changed)).toThrow(/业务接口缺少流程关联/);
});

it.each(supplementalCases)("删除 %s 的全部流程关联时拒绝生成", operation => {
  const changed = structuredClone(ownership);
  changed.flows = changed.flows.filter(flow => flow.operation !== operation);
  expect(() => buildCatalog(runtime, changed)).toThrow(/补充入口缺少流程关联/);
});

import type { Catalog } from "./model.js";
import type { Evidence } from "./source.js";
import { renderMap } from "./map.js";

const cell = (value: unknown) => String(value ?? "").replaceAll("|", "\\|").replaceAll("\n", " ");
const code = (value: unknown) => `\`${cell(value)}\``;
const link = (path: string) => `[${path}](../../../${path})`;
const evidence = (source: Evidence) => `[${source.path}:${source.line}](../../../${source.path}#L${source.line})`;
function header(title: string, summary: string, catalog: Catalog) {
  return `# ${title}\n\n> ${summary}\n\n状态：\`current\` · 更新：${catalog.updated} · 自动生成，不手工编辑。\n\n来源摘要：\`${catalog.provenance.fingerprint}\`。更新日期指目录声明版本，数据新鲜度由摘要和 \`pnpm check:catalog\` 核对。\n\n[使用与维护](README.md) · [总览](CATALOG.md) · [接口](routes.md) · [数据](data-model.md) · [权限](permissions.md) · [机器目录](catalog.json)\n\n`;
}

export function renderCatalog(catalog: Catalog): Record<string, string> {
  let overview = header("项目目录", "应用、运行单元、业务域与源码证据的统一入口；不表示线上部署状态。", catalog);
  overview += `## 基线\n\n- ${catalog.applications.length} 个源码应用，${catalog.runtimeUnits.length} 个运行单元。\n- ${catalog.coverage.routeMethods} 个已注册方法与路径，其中业务操作 ${catalog.coverage.businessOperations} 个，自动 HEAD ${catalog.coverage.automaticHead} 个。\n- ${catalog.tables.length} 张应用表，${catalog.capabilities.length} 个能力，${catalog.flows.length} 条显式业务流程。\n- 响应 Schema：${catalog.coverage.responseSchemas}/${catalog.coverage.routeMethods}。缺失不等于没有响应；不冒充完整 OpenAPI。\n\n`;
  overview += `业务流程关联：${catalog.coverage.businessOperationsWithFlow}/${catalog.coverage.businessOperations} 个业务操作；${catalog.coverage.supplementalInterfacesWithFlow}/${catalog.coverage.supplementalInterfaces} 个补充入口。遗漏关联时生成失败。逐接口响应和错误说明见[接口行为契约](../../services/server/endpoint-contracts.md)。\n\n`;
  overview += "## 应用与运行单元\n\n| 应用 | 代码 | 包 | 运行单元 | 合同 |\n|---|---|---|---|---|\n";
  overview += catalog.applications.map(app => `| ${cell(app.title)} | ${code(app.root)} | ${code(app.package)} | ${code(app.runtime)} | ${link(app.docs)} |`).join("\n");
  overview += "\n\n运行单元从两套 compose 核对；控制台是独立源码应用，但产物随 web 镜像交付。\n\n## 业务域\n\n| 业务 | 接口注册 | 数据表 | 业务说明 |\n|---|---:|---|---|\n";
  overview += catalog.domains.map(domain => `| ${cell(domain.title)} | ${catalog.routes.filter(route => route.domain === domain.id).length} | ${domain.tables.map(code).join("、") || "无本地表"} | ${domain.docs.map(link).join(" · ")} |`).join("\n");
  overview += "\n\n## 业务流程\n\n";
  for (const flow of catalog.flows) {
    overview += `### ${flow.title}\n\n标识：${code(flow.id)}；性质：显式声明并关联源码，不是自动证明业务正确。\n\n`;
    overview += `- 操作：${code(flow.operation)}\n- 能力：${flow.capabilities.map(code).join("、")}\n- 读取：${flow.reads.map(code).join("、")}\n- 写入：${flow.writes.map(code).join("、")}\n- 不入队：${flow.doesNotEnqueue.map(code).join("、")}\n`;
    overview += flow.invariants.map(item => `- ${item}`).join("\n");
    overview += `\n\n源码：${flow.evidence.map(evidence).join(" · ")}\n\n测试入口：${flow.tests.map(link).join(" · ")}。生成器未执行这些测试。\n\n`;
  }
  overview += `## 核验边界\n\n${catalog.limitations.map(item => `- ${item}`).join("\n")}\n`;

  let routes = header("后端接口目录", "真实 Fastify 注册的方法、路径、Schema 与源码位置；含根路由、嵌套插件、循环注册及自动 HEAD。", catalog);
  routes += "[接口行为契约](../../services/server/endpoint-contracts.md)按方法和路径说明成功响应、失败、资源授权及副作用；[业务流程](CATALOG.md#业务流程)关联数据库读写，地图中可沿接口与流程互相跳转。\n\n";
  routes += "Schema 完整内容在机器目录；这里的授权项只是源码检查证据，不是完整策略。没有直接检查不能解释为匿名可用。数据库、外部 HTTP 和发信均使用隔离配置，没有监听端口。\n\n";
  for (const kind of ["business", "infrastructure", "retired"]) {
    routes += `## ${({ business: "业务与认证", infrastructure: "基础设施与占位", retired: "退役兼容" })[kind as "business"]}\n\n`;
    routes += "| 方法与路径 | 业务域 | 注册 | 请求 Schema | 响应 Schema | 授权检查证据 | 源码 |\n|---|---|---|---|---|---|---|\n";
    routes += catalog.routes.filter(route => route.kind === kind).map(route => `| ${code(route.key)} | ${code(route.domain)} | ${route.registration === "automatic-head" ? "自动 HEAD" : "显式"} | ${route.contractCoverage.requestSections.map(code).join("、") || "未声明"} | ${route.contractCoverage.responseSchema ? "已挂载" : "未声明"} | ${route.authorization.checks.map(code).join("、") || "需查看 handler 与继承策略"} | ${evidence(route.source)} |`).join("\n");
    routes += "\n\n";
  }
  routes += "## 核心之外：Nitro 与预渲染入口\n\n以下是源码声明核对，不是本次运行时观测。路径相对于论坛应用，实际挂载前缀由论坛配置决定；没有启动 Nitro 或读取本机快照。静态文件与 SPA 回落不逐文件枚举。\n\n| 方法与路径 | 范围 | 说明 | 源码 |\n|---|---|---|---|\n";
  routes += catalog.supplementalInterfaces.map(item => `| ${code(`${item.methods.join("/")} ${item.path}`)} | ${code(item.scope)} | ${cell(item.summary)} | ${evidence(item.source)} |`).join("\n") + "\n";

  let data = header("数据库结构目录", "从真实建库函数产生的内存 SQLite 提取表、列、索引和物理外键；不读取业务记录。", catalog);
  data += "## 物理外键关系\n\n连线只表示数据库声明的 REFERENCES，不猜测命名相似的字段，也不推断业务所有权或基数。\n\n```mermaid\nflowchart LR\n";
  for (const table of catalog.tables) data += `  ${table.name}["${table.name}"]\n`;
  for (const table of catalog.tables) for (const fk of table.foreignKeys) data += `  ${table.name} -->|"${fk.from} → ${fk.to}"| ${fk.table}\n`;
  data += "```\n\n";
  for (const table of catalog.tables) {
    data += `## ${table.name}\n\n业务域：${code(table.domain)}；结构来源：${evidence(table.source)}。\n\n${table.note}\n\n`;
    data += "| 列 | 类型 | NOT NULL | 主键序号 | 默认值 | 隐藏/生成标记 |\n|---|---|---|---|---|---|\n";
    data += table.columns.map(column => `| ${code(column.name)} | ${code(column.type)} | ${column.notnull} | ${column.pk} | ${column.dflt_value === null ? "未声明" : code(column.dflt_value)} | ${column.hidden} |`).join("\n");
    data += "\n\nNOT NULL 与主键分别保留 SQLite 元数据，不把主键标记当作 NOT NULL 标记。\n\n";
    if (table.foreignKeys.length) {
      data += "| 外键列 | 引用 | ON UPDATE | ON DELETE |\n|---|---|---|---|\n";
      data += table.foreignKeys.map(fk => `| ${code(fk.from)} | ${code(`${fk.table}.${fk.to}`)} | ${fk.on_update} | ${fk.on_delete} |`).join("\n") + "\n\n";
    }
    if (table.indexes.length) {
      data += "| 索引 | 列 | 唯一 | 来源 | 部分索引 | SQL |\n|---|---|---|---|---|---|\n";
      data += table.indexes.map(index => `| ${code(index.name)} | ${index.columns.filter(column => column.key === 1).map(column => code(`${column.name ?? "表达式"}${column.desc ? " DESC" : ""}`)).join("、")} | ${index.unique} | ${index.origin} | ${index.partial} | ${code(index.sql ?? "SQLite 自动索引")} |`).join("\n") + "\n\n";
    }
    data += `<details><summary>建表 SQL</summary>\n\n\`\`\`sql\n${table.sql};\n\`\`\`\n\n</details>\n\n`;
  }
  let permissions = header("能力目录", "直接读取服务端能力定义、蕴含关系及可定位的路由检查，不复制运行时角色权限包。", catalog);
  permissions += "称号和部门权限包可由数据库配置，GitHub 能力还受上游组织角色限制。此目录不读取这些真实配置，也不宣称某个真实用户持有什么权限。对象归属、部门范围、作者身份等仍须按 SECURITY 与测试核验。\n\n";
  permissions += "| 能力 | 名称 | 业务域 | 蕴含 | 定义 | 直接检查它的操作数 |\n|---|---|---|---|---|---:|\n";
  permissions += catalog.capabilities.map(capability => `| ${code(capability.capability)} | ${cell(capability.label)} | ${code(capability.domain)} | ${capability.implies.map(code).join("、")} | ${evidence(capability.source)} | ${catalog.routes.filter(route => route.registration === "explicit" && route.authorization.capabilityGroups.flat().includes(capability.capability)).length} |`).join("\n");
  permissions += "\n\n直接检查数为 0 不代表能力无效：可能通过蕴含、条件或 helper 使用，也可能仍是预留项。生成器不替代权限测试。\n";
  return { "CATALOG.md": overview, "routes.md": routes, "data-model.md": data, "permissions.md": permissions, "map.html": renderMap(catalog) };
}

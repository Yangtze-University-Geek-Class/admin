# 项目地图与工程目录

> 人查看交互地图，Agent 检索同源文本与结构化目录；应用、接口、数据、权限和业务流程统一关联源码证据。

状态：`current` · 更新：2026-10-19 · 适用：开发、设计和代码审查；内部工程材料，不加入公开文档白名单。

本目录 `docs/architecture/catalog/` 是项目地图的固定位置。入口统一引用这里的仓库相对路径，与当前检出的代码一起更新；地图 HTML、生成的 Markdown 清单和 JSON 保持同源。

## 人查看地图

用浏览器打开本目录的 [map.html](map.html)，无需启动业务服务。macOS 可在仓库根运行：

```bash
open docs/architecture/catalog/map.html
```

在 GitHub 文件页下载原文件后，用本机浏览器打开即可交互；直接阅读结构与业务流程可用 [CATALOG.md](CATALOG.md)。地图中可搜索接口路径、表名、能力或业务名称，点击节点查看详情并沿关联跳转。

## Agent 按需检索

1. 先读 [CATALOG.md](CATALOG.md) 确定业务域及上下游，再进入下方对应的接口、数据、权限或服务文档。
2. 用方法路径、表名、能力名或源码路径缩小范围。需要精确关联时查询 [catalog.json](catalog.json) 中的 `routes`、`flows`、`tables`、`capabilities`、`sourceOwnership`、`relations`。
3. 沿 `source` / `evidence` 回到当前检出的源码核对。设计和审查按[宏观对齐规范](../../conventions/ARCHITECTURE-ALIGNMENT.md)完成影响声明；目录里的测试链接只是验证入口。

在仓库根的检索示例（JSON 查询使用 `jq`）：

```bash
rg -n -F '/api/console/applications' docs/architecture/catalog/routes.md
jq '.flows[] | select(.id == "flow:application.cancel") | {operation, capabilities, reads, writes, doesNotEnqueue, evidence}' docs/architecture/catalog/catalog.json
jq '.sourceOwnership[] | select(.path == "app/server/src/routes/console/applications.ts")' docs/architecture/catalog/catalog.json
```

优先读相关 Markdown 段落或筛选后的 JSON 结果。`map.html` 内嵌查看器和完整数据，不需要整份加载到 Agent 上下文。

## 阅读入口

- [交互项目地图](map.html)：直接打开即可使用；业务域钻取、搜索、关联高亮、结构详情与 PR 影响报告。

- [总览与业务流程](CATALOG.md)：源码应用、Docker 运行单元、业务归属和已关联的业务流程。
- [接口目录](routes.md)：核心后端全部注册方法路径；论坛 Nitro 和预渲染入口单独列出。
- [数据模型](data-model.md)：所有应用表的列、主键、索引、物理外键与建表 SQL。
- [接口行为契约](../../services/server/endpoint-contracts.md)：逐接口响应、错误、资源范围和副作用说明。
- [能力目录](permissions.md)：服务端能力及蕴含关系，不是实际用户的权限清单。
- [机器目录](catalog.json)：上述视图与交互地图共同使用的数据；包含 nodes、relations、源码位置及来源摘要。

## 生成与核对

在仓库根使用 Node 22 和锁定的 pnpm：

```bash
pnpm catalog:generate
pnpm docs:index
pnpm check:catalog
pnpm typecheck:catalog
pnpm exec vitest run tests/server/catalog.test.ts tests/tooling/project-catalog.test.ts
```

生成器创建真实 Fastify 应用但不监听，使用真实建库函数建立内存 SQLite，不读取 `.env`、业务数据库或论坛快照。GitHub、OAuth HTTP 和发信适配器均拒绝外部请求，发信与会话清理循环不开启；读取结构后关闭应用。论坛内容只使用测试夹具。

`check:catalog` 重新提取并逐字比较生成物，不改文件。根 `pnpm test` 中的目录回归也核对入库产物；根 `typecheck` 包含工具类型检查。目录自身完整性之外，根 `check:architecture` 与 PR 的 `architecture-alignment` 按[宏观对齐规范](../../conventions/ARCHITECTURE-ALIGNMENT.md)核对实际变更与声明。

## 各种事实在哪里维护

| 内容 | 唯一来源 | 如何更新 |
|---|---|---|
| 核心方法、路径和实际挂载 Schema | `buildApp` 的真实 Fastify 注册 | 改对应路由或 `contracts.ts`，重新生成 |
| 表、列、索引、物理外键 | `createDatabase(":memory:")` 后的 SQLite 元数据 | 改合法的建库/迁移实现，另做旧库兼容验证，重新生成 |
| 能力、能力蕴含 | `app/server/src/lib/roles.ts` | 改定义及实际授权执行点，补权限回归，重新生成 |
| 应用、业务归属、显式业务流程 | [ownership.json](ownership.json) | 只维护机器不能从结构可靠推断的语义，不复制字段或 Schema |
| 架构取舍、业务不变量 | 既有服务合同、API、SECURITY、ADR | 按原规范维护；目录以引用关联，不复制第二套全局规则 |
| 实际部署及验收 | 发布和环境验收记录 | 与目录分开；目录不探测真实环境、不声称已上线 |

源码应用与运行单元不是一一对应：`app/console` 独立构建，但产物随 web 镜像交付。业务能力与路由、表也是多对多；示例 `application.cancel` 使用已有 PATCH 操作，不为画图制造新接口。

## 数据契约

`catalog.json` 的 `version` 当前为 1；工具接口类型在 `scripts/catalog/model.ts`，输出类型为 `Catalog`。

- `applications`、`runtimeUnits`、`domains`：源码应用、运行单元和业务域。
- `routes`：真实注册的方法路径，包括显式/自动 HEAD、基础设施及退役路由；保留最终请求 Schema 与响应 Schema 是否存在。
- `supplementalInterfaces`：论坛 Nitro 路由和 Markdown 中间件的源码声明；明确标记未在生成器中启动 Nitro。
- `tables`：`table_xinfo`、`foreign_key_list`、`index_list`、`index_xinfo` 的结构数据及 SQL；不包含任何业务记录。
- `capabilities`：服务端定义及蕴含关系。
- `flows`：带源码锚点、测试入口和文档引用的显式业务声明；跨域数据/副作用用 relatedDomains 对齐，操作可引用核心方法路径或补充接口 id。
- `sourceOwnership`：注册文件、表/能力来源及 moduleOwners 的源码归属；未映射源码列在 unmappedSources，业务 PR 触及它们时必须补映射，不静默推断为 platform。
- `nodes`、`relations`：由上述记录派生；关系区分 `runtime`、`static-evidence`、`declaration`，不把人工声明包装成运行验证。
- `provenance`：所有实际读取源文件的仓库相对路径与 SHA-256，以及排序后清单的摘要；文本换行统一为 LF。源摘要不用 HEAD，避免“生成物引用自己的提交”导致每次提交都过期。源码链接针对同一次检出；生成的工程附件应与对应提交一起保存。

节点 id 按类型区分，例如 `application:server`、`domain:recruitment`、`route:PATCH /api/console/applications/:application_id`、`table:applications`、`capability:applications.review`、`flow:application.cancel`。方法或路径变化就是接口身份变化，需要检查引用和兼容性；业务流程 id 不随文件搬迁改变。

重复 id、实际注册重复、缺少归属、悬空关系、失效或不唯一的源码锚点会让生成失败。新增源码应用、Nitro 入口未归档，或业务操作缺少流程关联，同样失败。源码路径必须留在当前检出中；环境文件不进入输入。

## 什么还没有被证明

- `requestSections` 只表示挂载了哪些 Schema，不等于字段或业务语义已完整描述。
- 授权只提取直接可定位的检查及能力参数；对象归属、部门范围、继承和动态 helper 仍须读实现和做权限测试。没有提取到检查不代表匿名可用。
- 表关系图只画真实外键。诸如 `mail_outbox.review_id` 的逻辑关系不是物理外键，不能自动画成数据库约束。
- 每个核心业务操作和补充入口都必须关联带源码证据的业务用例；生成器拒绝遗漏。它核对关联完整性，实际规则、分支授权与副作用仍通过源码审查和真实路由测试验证。
- 测试链接只是验证入口，不是通过证明。目录不读取当前用户权限包、外部系统数据或线上部署。
- 本目录尚未生成完整 OpenAPI。交互地图消费同一份节点关系；PR 检查生成 `architecture-impact.json`，在地图「PR 影响」导入后高亮关联节点。摘要不一致或未知节点会拒绝导入；导入结果只供阅读，合并仍以真实 GitHub 检查为准。

## 实现与验证

入口：[project-catalog.ts](../../../scripts/project-catalog.ts)。`scripts/catalog/collect.ts` 负责真实隔离提取，`source.ts` 负责证据与规范化，`model.ts` 负责归属和关系检查，`render.ts` 派生阅读视图。

回归分别验证真实根路由、循环注册与头像子插件、自动 HEAD、最终 Schema、SQLite 外键/部分索引、环境隔离、完整性失败路径、确定性和过期产物。运行业务回归仍按 [TESTING](../../conventions/TESTING.md)；本目录不能代替预发布人工验收。

## 地图维护

查看器模板在 `scripts/catalog/viewer.html`，复用本次用户提供的节点地图渲染器，旧项目拓扑与证据已全部移除；转换器 `map.ts` 从目录生成视图。它是内部离线工程文档，不新增业务端或并行通用 UI 库；若将来接入 Vue 业务页面，仍按 Tuffex 政策实现。总览、业务域、数据、权限和文档视图共享实体，自动 HEAD 单列，避免概览铺满重复节点。状态不使用“在线”冒充部署证明。

支持拖动与缩放、缩略图、重置、全局搜索（Enter 逐项定位）、节点详情、跨页关联、深浅色和窄屏目录/详情。PR 报告只能本机导入，不上传；报告本身不是批准或验收记录。

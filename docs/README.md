# 文档与规范总入口

> 所有项目规范集中于 docs；根目录及工具文件只负责导航。

状态：`current` · 更新：2026-09-13

## AI 第一操作

AI/Agent 必须先停止业务操作，完整读取 [AGENT-START](conventions/AGENT-START.md)、PROJECT、CONTRIBUTING、[RELEASES](conventions/RELEASES.md) 和任务适用文档，再开始实施。根 [AGENTS](../AGENTS.md) 保存硬门禁摘要；不能先执行再补读。

## 阅读地图

| 主题 | 规范文档 |
|---|---|
| 用户需求、实际状态、数据位置与未完成项的完整交接 | [2026-09-13 项目交接](handovers/2026-09-13-geek-main-handover.md) |
| 项目身份、范围、协作和完成定义 | [PROJECT](conventions/PROJECT.md) |
| 模块归属、依赖方向、契约和变更流程 | [MODULAR-DEVELOPMENT](conventions/MODULAR-DEVELOPMENT.md) |
| 环境准备、分支、开发与贡献流程 | [CONTRIBUTING](conventions/CONTRIBUTING.md) |
| 提交格式与职责范围 | [COMMITS](conventions/COMMITS.md) |
| main、release-/prev-、预发布 @SHA 和人工验收 | [RELEASES](conventions/RELEASES.md) |
| CI/CD 阶段设计与尚未启用的部署门禁 | [CICD](ops/CICD.md) |
| Issue、PR 与审查 | [ISSUES](conventions/ISSUES.md)、[PULL-REQUESTS](conventions/PULL-REQUESTS.md) |
| 测试、隔离、验收证据 | [TESTING](conventions/TESTING.md) |
| 技术文档结构、生命周期与事实来源 | [DOCUMENTATION](conventions/DOCUMENTATION.md) |
| 官方标准、采用范围与核对日期 | [REFERENCES](conventions/REFERENCES.md) |
| 系统架构、认证、存储 | [ARCHITECTURE](architecture/ARCHITECTURE.md) |
| 安全边界与防护限制 | [SECURITY](architecture/SECURITY.md) |
| API 契约及错误、幂等约定 | [API](architecture/API.md) |
| UI 设计、无障碍与组件实现 | [DESIGN](design/DESIGN.md) |
| 统一组件库、AI 检索、官方 API 和示例 | [Tuffex 文档库](components/tuffex/README.md)、[使用政策](components/tuffex/USAGE-POLICY.md) |
| 已采用技术栈与升级准入 | [STACK](design/STACK.md) |
| 模块合同 | [portal](modules/portal.md)、[forum](modules/forum.md)、[admin](modules/admin.md)、[shared](modules/shared.md)、[server](modules/server.md) |
| 发布、数据维护与恢复 | [DEPLOY](ops/DEPLOY.md) |
| 极客班论坛原始数据拉取与本地备份 | [FORUM-DATA-CAPTURE](ops/FORUM-DATA-CAPTURE.md) |
| 直接采用原仓论坛与本机入口 | [TUFF-FORUM](ops/TUFF-FORUM.md)、[LOCAL-PREVIEW](ops/LOCAL-PREVIEW.md) |
| 用户指南，可公开 | [USAGE](ops/USAGE.md) |
| 架构决策 | [ADR-0001](decisions/0001-modular-monolith.md)、[Tuffex 选型 ADR-0002](decisions/0002-tuffex-ui-foundation.md)、[论坛替换 ADR-0003](decisions/0003-adopt-tuff-forum.md) |
| 旧架构历史整改记录 | [NORMALIZATION](reviews/NORMALIZATION.md)；新架构不可沿用旧测试数量 |
| 原仓论坛替换与实际验收 | [TUFF-FORUM-ADOPTION](reviews/TUFF-FORUM-ADOPTION.md) |

## 文档类别与优先级

`conventions/` 规定如何协作，`architecture/` 描述当前系统，`modules/` 规定模块边界，`design/` 规定当前交互与选型，`ops/` 记录操作流程，`decisions/` 保存已接受的决策，`plan/` 保存提议或历史盘点，`public/` 仅存允许公开的材料。

同一规则只在一个规范源定义，其余文档链接过去。`components/` 保存组件资料与采用约定；reference-snapshot 是固定版本参考，不是项目执行规则。代码与 current 文档不一致是缺陷，必须在改动中说明并同步修正；不能通过随意选择某份文档掩盖冲突。historical/proposed 文档不覆盖 current 规范。

完整目录见 [INDEX](INDEX.md)。索引由 `pnpm docs:index` 生成，不手工维护。文档标题、摘要、路径变更必须重新生成索引。

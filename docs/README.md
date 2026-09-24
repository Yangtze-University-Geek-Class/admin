# 文档与规范总入口

> 所有项目规范集中于 docs；`docs/` 与 `app/` 严格对齐，根目录及工具文件只负责导航。

状态：`current` · 更新：2026-09-25

## AI 第一操作

Agent 进入仓库的第一件事是**确认当前分支**（`git branch --show-current`），第二件事是停止业务操作并完整读取 [AGENT-START](conventions/AGENT-START.md)、[PROJECT](conventions/PROJECT.md)、[BRANCHING](conventions/BRANCHING.md)、[CONTRIBUTING](conventions/CONTRIBUTING.md)、[TRACKING](conventions/TRACKING.md)、[CODE-REVIEW](conventions/CODE-REVIEW.md)、[RELEASES](conventions/RELEASES.md) 和任务适用文档，再开始实施。根 [AGENTS](../AGENTS.md) 保存硬门禁摘要；不能先执行再补读。

## app ↔ docs ↔ 规范 地图

| `app/` 路径 | `docs/` 路径 | 管辖规范 |
|---|---|---|
| `app/server/` | [services/server](services/server/README.md) | [MODULAR-DEVELOPMENT](conventions/MODULAR-DEVELOPMENT.md)、[API](architecture/API.md)、[SECURITY](architecture/SECURITY.md) |
| `app/web/`（`sites/portal`、`shared`） | [services/web](services/web/README.md) · [portal](services/web/portal.md) · [shared](services/web/shared.md) · [admin（已迁出）](services/web/admin.md) | [DESIGN](design/DESIGN.md)、[STACK](design/STACK.md)、[TESTING](conventions/TESTING.md) |
| `app/console/` | [services/console](services/console/README.md) | [DESIGN](design/DESIGN.md)、[Tuffex 使用政策](components/tuffex/USAGE-POLICY.md)、[TESTING](conventions/TESTING.md) |
| `app/forum/` | [services/forum](services/forum/README.md) | [TUFF-FORUM](ops/TUFF-FORUM.md)、[Tuffex 使用政策](components/tuffex/USAGE-POLICY.md)、[ADR-0003](decisions/0003-adopt-tuff-forum.md) |
| `deploy/` | [ops/DEPLOY](ops/DEPLOY.md) · [ops/ENVIRONMENTS](ops/ENVIRONMENTS.md) · [ops/CICD](ops/CICD.md) | [RELEASES](conventions/RELEASES.md)、[BRANCHING](conventions/BRANCHING.md) |
| `docs/`（本文档树） | [INDEX](INDEX.md)（生成物） | [DOCUMENTATION](conventions/DOCUMENTATION.md) |
| `scripts/`、`tests/` | [TESTING](conventions/TESTING.md) · [ops/CICD](ops/CICD.md) | [CONTRIBUTING](conventions/CONTRIBUTING.md)、[CODE-REVIEW](conventions/CODE-REVIEW.md) |

**硬规则**：新增服务 = 新增 `app/<service>` + 新增 `docs/services/<service>/README.md`，两处缺一视为未完成；模块细节放同目录子文档（见 [MODULAR-DEVELOPMENT](conventions/MODULAR-DEVELOPMENT.md) 与 [DOCUMENTATION](conventions/DOCUMENTATION.md)）。`docs/modules/` 已删除，不再重建。

## 阅读地图

| 主题 | 规范文档 |
|---|---|
| 分支模型、不变量、合并后删分支 | [BRANCHING](conventions/BRANCHING.md) |
| diff 审查清单与结论格式 | [CODE-REVIEW](conventions/CODE-REVIEW.md) |
| 打 tag 发版、人工验收、版本展示、回滚 | [RELEASES](conventions/RELEASES.md) |
| 项目身份、范围、授权边界与完成定义 | [PROJECT](conventions/PROJECT.md) |
| 环境准备、开发与贡献流程 | [CONTRIBUTING](conventions/CONTRIBUTING.md) |
| 提交格式与职责范围 | [COMMITS](conventions/COMMITS.md) |
| Issue（开发前必开）与 MR | [ISSUES](conventions/ISSUES.md)、[PULL-REQUESTS](conventions/PULL-REQUESTS.md) |
| issue ↔ 分支 ↔ PR 的生命周期、互相引用、评论里的追踪记录格式；审查机器人接不接 issue、怎么评论 | [TRACKING](conventions/TRACKING.md) |
| 测试、隔离、验收证据 | [TESTING](conventions/TESTING.md) |
| 文档结构、状态词表与事实来源 | [DOCUMENTATION](conventions/DOCUMENTATION.md) |
| 官方标准、采用范围与核对日期 | [REFERENCES](conventions/REFERENCES.md) |
| 服务合同与源码地图 | [server](services/server/README.md)、[web](services/web/README.md)、[console](services/console/README.md)、[forum](services/forum/README.md) |
| 系统架构、认证、存储 | [ARCHITECTURE](architecture/ARCHITECTURE.md) |
| 安全边界与防护限制 | [SECURITY](architecture/SECURITY.md) |
| API 契约及错误、幂等约定 | [API](architecture/API.md) |
| UI 设计、无障碍与组件实现 | [DESIGN](design/DESIGN.md) |
| 统一组件库、AI 检索、官方 API 和示例 | [Tuffex 文档库](components/tuffex/README.md)、[使用政策](components/tuffex/USAGE-POLICY.md) |
| 已采用技术栈与升级准入 | [STACK](design/STACK.md) |
| 部署、回滚、两套 Docker 栈 | [DEPLOY](ops/DEPLOY.md) |
| `.env` 契约、密钥注入、DNS/TLS 前置 | [ENVIRONMENTS](ops/ENVIRONMENTS.md) |
| CI/CD 工作流、环境 secrets/vars、部署开关 | [CICD](ops/CICD.md) |
| 本机预览与论坛运行 | [LOCAL-PREVIEW](ops/LOCAL-PREVIEW.md)、[TUFF-FORUM](ops/TUFF-FORUM.md) |
| 极客班论坛原始数据拉取与本地备份 | [FORUM-DATA-CAPTURE](ops/FORUM-DATA-CAPTURE.md) |
| 用户指南，可公开 | [USAGE](ops/USAGE.md) |
| 架构决策 | [ADR-0001](decisions/0001-modular-monolith.md)、[ADR-0002](decisions/0002-tuffex-ui-foundation.md)、[ADR-0003](decisions/0003-adopt-tuff-forum.md)、[ADR-0004](decisions/0004-review-bot-deploy-target.md)（proposed） |
| 交付证据与历史整改记录 | [reviews](reviews/README.md)；历史材料见 [history](history/README.md)、[plan](plan/README.md)、[handovers](handovers/README.md) |

## 文档类别与优先级

`conventions/` 规定如何协作，`services/` 规定每个服务的边界与实现位置，`architecture/` 描述当前系统，`design/` 规定当前交互与选型，`ops/` 记录操作流程，`decisions/` 保存已接受的决策，`plan/` `history/` `handovers/` 保存计划与历史材料，`reviews/` 保存交付证据，`public/` 仅存允许公开的材料。

同一规则只在一个规范源定义，其余文档链接过去。状态词表只有 `current` / `accepted` / `proposed` / `historical`（见 [DOCUMENTATION](conventions/DOCUMENTATION.md)）：`historical` 与 `proposed` 文档不覆盖 current 规范，也不得被当作现行操作依据。代码与 current 文档不一致是缺陷，必须在改动中说明并同步修正；不能通过随意选择某份文档掩盖冲突。

完整目录见 [INDEX](INDEX.md)。索引由 `pnpm docs:index`（`node scripts/docs-index.mjs`）生成，不手工维护。文档标题、摘要、路径变更必须重新生成索引。

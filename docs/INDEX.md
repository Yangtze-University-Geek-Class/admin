# 文档索引

> 本文件由 `node scripts/docs-index.mjs` 生成，**请勿手工编辑**。
> 改了文档标题或摘要后重新生成；提交前用 `node scripts/docs-index.mjs --check` 自查。

任务与规范导航见 [`README.md`](./README.md) 和 [`../AGENTS.md`](../AGENTS.md)。Tuffex 完整组件索引见 [`COMPONENTS.md`](./components/tuffex/COMPONENTS.md)，不在总索引重复展开。

## conventions/

强制遵守的规范：分支、审查、提交、Issue、MR、发版与文档。违反会被 CODE-REVIEW 退回。

| 文档 | 说明 | EN |
|---|---|---|
| [`AGENT-START.md`](./conventions/AGENT-START.md) | AI 进入 geek_main 的第一步：确认当前分支并完整读取 docs 中的适用规范；不能以记忆、任务紧急或测试通过替代。 | — |
| [`BRANCHING.md`](./conventions/BRANCHING.md) | 只有 `main`（正式）与 `stage`（预发布）两条长期分支；task 分支合并后必须立即删除，任何操作前先确认当前分支。 | — |
| [`CODE-REVIEW.md`](./conventions/CODE-REVIEW.md) | 本仓库专属的 diff 审查清单：触发时机、逐项检查、结论格式与审查记录位置。 | — |
| [`COMMITS.md`](./conventions/COMMITS.md) | Conventional Commits 结构，中文说明，一次提交一个可回滚目的。 | [EN](./conventions/COMMITS.en.md) |
| [`CONTRIBUTING.md`](./conventions/CONTRIBUTING.md) | 统一入口、最小变更、可审查的提交与资源隔离。 | [EN](./conventions/CONTRIBUTING.en.md) |
| [`DOCUMENTATION.md`](./conventions/DOCUMENTATION.md) | 区分当前事实、已接受决策、未实施提议和历史材料；`docs/` 与 `app/` 严格对齐。 | — |
| [`ISSUES.md`](./conventions/ISSUES.md) | 记录可复现问题、影响范围、验收条件及安全边界；开发前先有 issue，issue 是 task 分支的来源。 | [EN](./conventions/ISSUES.en.md) |
| [`MODULAR-DEVELOPMENT.md`](./conventions/MODULAR-DEVELOPMENT.md) | 职责清楚、依赖单向、契约明确；`app/` 与 `docs/services/` 严格对齐，不为目录形式制造部署复杂度。 | — |
| [`PROJECT.md`](./conventions/PROJECT.md) | 项目定位、授权边界、统一入口和完成定义。 | — |
| [`PULL-REQUESTS.md`](./conventions/PULL-REQUESTS.md) | 审查代码、合同、权限、数据一致性、文档与实际验证证据；每个 MR 都写清 range、验证命令与审查结论。 | [EN](./conventions/PULL-REQUESTS.en.md) |
| [`REFERENCES.md`](./conventions/REFERENCES.md) | 可追溯的工程依据，不把外部建议、产品选择和已完成验收混为一谈。 | — |
| [`RELEASES.md`](./conventions/RELEASES.md) | 分支即发布：`stage` 是预发布、`main` 是正式；人工验收与明确批准必须发生在合入 `main` 之前，版本号不自动提升。 | — |
| [`TESTING.md`](./conventions/TESTING.md) | 核心真实路由与上游论坛演示分别验收；类型、行为、构建和生产证据不相互替代。 | — |

## services/

与 `app/` 一一对应的服务文档：每个服务一份 README（源码地图、契约、运行、验证、限制）。

## services/forum/

直接采用 Tuff Forum 原代码、TuffEx 组件与验证方式；本机可只读显示极客班论坛快照，仍无真实认证与后端。

## services/server/

核心 portal/admin 的应用组装、资源生命周期和真实 GitHub 适配；一个 Fastify 进程。

## services/web/

portal 与 admin 两个 React/Vite 站点 + shared 适配层；同时是每个环境的 HTTP 入口容器。

| 文档 | 说明 | EN |
|---|---|---|
| [`admin.md`](./services/web/admin.md) | 使用当前用户 GitHub 权限的组织管理模块。 | — |
| [`portal.md`](./services/web/portal.md) | 公开介绍、投递简历、文档、反馈和邀请落地；无独立登录态。 | — |
| [`shared.md`](./services/web/shared.md) | 共享 UI、网络、渲染和配置，不反向依赖站点。 | — |

## components/

本项目统一 UI 基础的文档入口，按需检索第三方资料。

## components/tuffex/

官方中文文档、API、Vue 示例和类型参考，供 AI 按组件与章节离线查询。

| 文档 | 说明 | EN |
|---|---|---|
| [`AI-GUIDE.md`](./components/tuffex/AI-GUIDE.md) | 确认版本，再按组件、章节与示例取上下文，不从其他组件库推断接口。 | — |
| [`COMPONENTS.md`](./components/tuffex/COMPONENTS.md) | 按官方分类检索中文文档；每页包含 API、示例和固定版本源码链接。 | — |
| [`SOURCES.md`](./components/tuffex/SOURCES.md) | 可复核的官方源码快照，不把网页部署版本、源码 manifest 与 npm 发布版本混为一谈。 | — |
| [`TASK-MAP.md`](./components/tuffex/TASK-MAP.md) | 从宣传主页、内部主站、论坛和组织管理任务定位组件，再查询准确 API。 | — |
| [`USAGE-POLICY.md`](./components/tuffex/USAGE-POLICY.md) | 用户已指定后续界面开发依赖 Tuffex，业务模块和主题保持低耦合。 | — |

## design/

界面怎么做、技术用什么版本。改 UI 或动依赖之前先读这里。

| 文档 | 说明 | EN |
|---|---|---|
| [`DESIGN.md`](./design/DESIGN.md) | 统一浅色品牌、可靠平台交互与可验证状态，区分标准要求和项目偏好。 | [EN](./design/DESIGN.en.md) |
| [`STACK.md`](./design/STACK.md) | 记录已采用框架及版本来源，未来升级另立提议。 | [EN](./design/STACK.en.md) |

## architecture/

长期有效的系统设计：架构、鉴权、数据模型、安全模型。改动系统边界或数据之前先读这里。

| 文档 | 说明 | EN |
|---|---|---|
| [`API.md`](./architecture/API.md) | 模块自有 Schema、明确错误语义和外部副作用约定。 | — |
| [`ARCHITECTURE.md`](./architecture/ARCHITECTURE.md) | 三个服务（web/server/forum）组成的严格 monorepo；两套 Docker 栈交付两个环境；明确当前实现与目标的差异。 | [EN](./architecture/ARCHITECTURE.en.md) |
| [`SECURITY.md`](./architecture/SECURITY.md) | 区分保留核心服务的真实安全边界与原仓论坛的浏览器演示；新论坛尚不具备生产安全条件。 | [EN](./architecture/SECURITY.en.md) |

## plan/

计划与现状盘点，**有保质期**。落地后应删除或压缩成结论，不要长期堆积。

| 文档 | 说明 | EN |
|---|---|---|
| [`REFACTOR.md`](./plan/REFACTOR.md) | 历史阶段记录：旧路径、版本、数量和完成声明仅供追溯。 | [EN](./plan/REFACTOR.en.md) |
| [`WEB-SPLIT.md`](./plan/WEB-SPLIT.md) | 历史阶段记录：旧路径、版本、数量和完成声明仅供追溯。 | [EN](./plan/WEB-SPLIT.en.md) |

## ops/

运维与使用：照着做就能跑的操作手册。

| 文档 | 说明 | EN |
|---|---|---|
| [`CICD.md`](./ops/CICD.md) | 四工作流（ci / deploy-preview / deploy-production / branch-hygiene）+ `.env` 驱动；部署开关默认关闭，机器检查不替代人工验收。 | — |
| [`DEPLOY.md`](./ops/DEPLOY.md) | 同机两套 Docker 栈 + 宿主 nginx TLS 终止；生产发布为独立授权操作，模板存在不等于已经部署。 | [EN](./ops/DEPLOY.en.md) |
| [`ENVIRONMENT.md`](./ops/ENVIRONMENT.md) | 仅包含占位符；已有环境文件不由代码规范化任务读取或覆盖。 | — |
| [`ENVIRONMENTS.md`](./ops/ENVIRONMENTS.md) | 两份入库 `.env` 的字段契约与可见性规则；地址端口直接写，密钥留空由 CI/CD 注入。 | — |
| [`FORUM-DATA-CAPTURE.md`](./ops/FORUM-DATA-CAPTURE.md) | 已通过 Mac SSH 获取三份 SQLite 在线备份及两代附件；本机论坛可只读显示由此生成的投影，未导入可写库或切换线上服务。 | — |
| [`LOCAL-PREVIEW.md`](./ops/LOCAL-PREVIEW.md) | 保留官网和管理后台的隔离预览；论坛直接运行原仓 Nuxt/TuffEx，不再启动旧论坛。 | — |
| [`RELEASE-ACCEPTANCE-TEMPLATE.md`](./ops/RELEASE-ACCEPTANCE-TEMPLATE.md) | 空白模板，供验收人逐字段手工填写；不是流水线自动生成的通过证明。 | — |
| [`TUFF-FORUM.md`](./ops/TUFF-FORUM.md) | 独立启动直接引入的 Nuxt/TuffEx 原仓；本机默认只读显示极客班快照，不将其冒充生产论坛。 | — |
| [`USAGE.md`](./ops/USAGE.md) | 公开访问说明；区分核心 GitHub 管理和新论坛浏览器演示，不包含内部凭据。 | [EN](./ops/USAGE.en.md) |

## decisions/

已接受决策及其背景、替代方案、后果和重新评估条件。

| 文档 | 说明 | EN |
|---|---|---|
| [`0001-modular-monolith.md`](./decisions/0001-modular-monolith.md) | 保留一个部署单元，通过模块合同、应用工厂和自动检查降低耦合。 | — |
| [`0002-tuffex-ui-foundation.md`](./decisions/0002-tuffex-ui-foundation.md) | 记录用户指定的组件体系，并提供有固定版本、可离线检索的开发文档。 | — |
| [`0003-adopt-tuff-forum.md`](./decisions/0003-adopt-tuff-forum.md) | 用户明确选择使用原仓代码，而不是模仿 UI 或重写一套 React 论坛。 | — |

## handovers/

交接记录：特定时点的项目状态快照，仅供追溯，不作为现行规范。

| 文档 | 说明 | EN |
|---|---|---|
| [`2026-09-13-geek-main-handover.md`](./handovers/2026-09-13-geek-main-handover.md) | 2026-09-13 上午的交接记录：论坛原仓已引入，真实数据已备份并生成展示投影，当时本地论坛仍显示上游示例（中午起已改为只读显示极客班快照，见第 6 行）；统一主站、真实论坛服务和远程 CI/CD 尚未完成。 | — |

## history/

保留旧架构、设计、运维和研究材料，仅供追溯，不作为当前操作规范。

| 文档 | 说明 | EN |
|---|---|---|
| [`ARCHITECTURE.md`](./history/ARCHITECTURE.md) | 历史材料：旧版本事实、路径和设计，不作为当前实施指令。 | [EN](./history/ARCHITECTURE.en.md) |
| [`DEPLOY.md`](./history/DEPLOY.md) | 历史材料：旧版本事实、路径和设计，不作为当前实施指令。 | [EN](./history/DEPLOY.en.md) |
| [`DESIGN.md`](./history/DESIGN.md) | 历史材料：旧版本事实、路径和设计，不作为当前实施指令。 | [EN](./history/DESIGN.en.md) |
| [`SECURITY.md`](./history/SECURITY.md) | 历史材料：旧版本事实、路径和设计，不作为当前实施指令。 | [EN](./history/SECURITY.en.md) |
| [`STACK.md`](./history/STACK.md) | 历史材料：旧版本事实、路径和设计，不作为当前实施指令。 | [EN](./history/STACK.en.md) |
| [`USAGE.md`](./history/USAGE.md) | 历史材料：旧版本事实、路径和设计，不作为当前实施指令。 | [EN](./history/USAGE.en.md) |

## public/

长江大学极客班官网、论坛和组织管理服务。

## reviews/

按实际代码基线、执行结果与未验证边界保存审查和交付证据。

| 文档 | 说明 | EN |
|---|---|---|
| [`DATA-CAPTURE-RELEASE-RULES.md`](./reviews/DATA-CAPTURE-RELEASE-RULES.md) | 原始数据已落在 Mac 私有目录，Agent 首步阅读及人工发版约定已落实；未导入新论坛，也未开启远程部署。 | — |
| [`LOCAL-CONTENT-ENVIRONMENTS.md`](./reviews/LOCAL-CONTENT-ENVIRONMENTS.md) | 阶段记录：发布域名合同和论坛环境展示已实现，真实内容投影已生成；当时数据接口未落盘，页面接入未完成。本机只读快照接入已于 2026-09-13 中午完成，见 FORUM-DATA-CAPTURE 最新状态。 | — |
| [`NORMALIZATION.md`](./reviews/NORMALIZATION.md) | 本地代码、文档和隔离测试的实际交付记录；生产环境与凭据轮换尚未执行。 | — |
| [`TUFF-FORUM-ADOPTION.md`](./reviews/TUFF-FORUM-ADOPTION.md) | 已直接采用原仓前端并切换本机入口；不将缺少真实认证和后端的演示称为生产社区。 | — |
| [`TUFFEX-DOCS.md`](./reviews/TUFFEX-DOCS.md) | 固定官方源码提交的离线文档、示例、类型参考、AI 检索与项目选型约定。 | — |

---

共 52 篇文档（另有 20 篇英文版）。索引按目录分组，组内按文件名排序。

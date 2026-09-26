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
| [`ISSUES.md`](./conventions/ISSUES.md) | issue 是一件事的主档：开发前先开 issue，写清现象、复现、环境与验收条件；之后每一步进展都以追踪记录留在评论里，PR 合并即关闭。 | [EN](./conventions/ISSUES.en.md) |
| [`MODULAR-DEVELOPMENT.md`](./conventions/MODULAR-DEVELOPMENT.md) | 职责清楚、依赖单向、契约明确；`app/` 与 `docs/services/` 严格对齐，不为目录形式制造部署复杂度。 | — |
| [`NOTES.md`](./conventions/NOTES.md) | 每个人、每个 agent 做的每一步，都按北京时间写进仓库里的 `notes/<日期>/<GitHub 用户名>/<链路>.md`；开发前先记开工，开发后记到收尾，链路不完整的 PR 不能合并。 | — |
| [`PROJECT.md`](./conventions/PROJECT.md) | 项目定位、授权边界、统一入口和完成定义。 | — |
| [`PULL-REQUESTS.md`](./conventions/PULL-REQUESTS.md) | PR 是一次改动的证据档：写清解决链路、验证结果、可以直接照着做的人工验收步骤和截图录屏；审查与返工写成评论，合并后 issue 自动关闭。 | [EN](./conventions/PULL-REQUESTS.en.md) |
| [`REFERENCES.md`](./conventions/REFERENCES.md) | 可追溯的工程依据，不把外部建议、产品选择和已完成验收混为一谈。 | — |
| [`RELEASES.md`](./conventions/RELEASES.md) | 发版只靠打 tag：`vX.Y.Z-rc.N` 打在 `stage` 的提交上发预发布，所有者在预发布验收通过后，在同一提交上打 `vX.Y.Z` 发正式。tag 不可移动、不可删除，版本号不自动提升。 | — |
| [`TESTING.md`](./conventions/TESTING.md) | 核心真实路由与上游论坛演示分别验收；类型、行为、构建和生产证据不相互替代。 | — |
| [`TRACKING.md`](./conventions/TRACKING.md) | 一件事从提出到关闭，每一步都以固定格式的评论留在 issue 与 PR 上；人扫一眼能看懂进展，Agent 按字段就能读出状态。 | — |

## services/

与 `app/` 一一对应的服务文档：每个服务一份 README（源码地图、契约、运行、验证、限制）。

## services/console/

极客班控制台前端：Vue 3 + Tuffex 单页应用，按称号能力显示页面；接口全部来自 `app/server`，产物由 web 镜像托管。

## services/forum/

直接采用 Tuff Forum 原代码、TuffEx 组件与验证方式；线上镜像是极客班论坛自己的站名、分类和标签，加上从旧论坛公开的帖子（只有首帖）；本机可显示极客班论坛快照；登录只走全站 GitHub 登录（上游验收与本机示例预览除外）；论坛仍没有后端。

## services/server/

核心 portal/admin/console 与论坛接口的应用组装、资源生命周期和真实 GitHub 适配；一个 Fastify 进程。

| 文档 | 说明 | EN |
|---|---|---|
| [`data-model.md`](./services/server/data-model.md) | data.db 每张表的用途、写入方、读取方和个人信息字段，以及当前没有消费者的表、列和索引；表结构以 `app/server/src/lib/db.ts` 为唯一来源。 | — |

## services/web/

官网 portal（React/Vite）+ shared 适配层；web 镜像同时托管控制台产物（`app/console`），是每个环境的 HTTP 入口容器。

| 文档 | 说明 | EN |
|---|---|---|
| [`admin.md`](./services/web/admin.md) | 管理端前端已从 `app/web/sites/admin`（React）迁到独立的 Vue 包 `app/console`；本页只记录迁移事实与仍然有效的服务端约定。 | — |
| [`portal.md`](./services/web/portal.md) | 公开官网：3D 书桌与 YUGC OS 桌面、加入我们（信封场景）、论坛与 GitHub 场景、文档、意见箱和邀请落地；不自建登录，菜单栏显示全站 GitHub 登录的账号或登录入口。 | — |
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
| [`CICD.md`](./ops/CICD.md) | 六工作流（ci / deploy-preview / deploy-production / branch-hygiene / issue-lifecycle / cert-watch）+ `.env` 驱动；发版只由发布 tag 触发（`vX.Y.Z-rc.N` → 预发布，`vX.Y.Z` → 正式），push 分支只跑 CI；部署开关默认关闭，机器检查不替代人工验收。 | — |
| [`DEPLOY.md`](./ops/DEPLOY.md) | 同机两套 Docker 栈 + 宿主 nginx TLS 终止；生产发布为独立授权操作，模板存在不等于已经部署。 | [EN](./ops/DEPLOY.en.md) |
| [`ENVIRONMENT.md`](./ops/ENVIRONMENT.md) | 仅包含占位符；已有环境文件不由代码规范化任务读取或覆盖。 | — |
| [`ENVIRONMENTS.md`](./ops/ENVIRONMENTS.md) | 两份入库 `.env` 的字段契约与可见性规则；地址端口直接写，密钥留空由 CI/CD 注入。 | — |
| [`FORUM-DATA-CAPTURE.md`](./ops/FORUM-DATA-CAPTURE.md) | 已通过 Mac SSH 获取三份 SQLite 在线备份及两代附件；本机论坛可只读显示由此生成的投影，未导入可写库或切换线上服务。 | — |
| [`LOCAL-PREVIEW.md`](./ops/LOCAL-PREVIEW.md) | 本机起官网、核心后端与论坛；启动时给出 GitHub OAuth 应用的两项凭据就走真实 GitHub 登录（数据留在 `.tools/local-preview/`），不给就是隔离的内存模式。 | — |
| [`RELEASE-ACCEPTANCE-TEMPLATE.md`](./ops/RELEASE-ACCEPTANCE-TEMPLATE.md) | 空白模板，供验收人逐字段手工填写；不是流水线自动生成的通过证明。 | — |
| [`TUFF-FORUM.md`](./ops/TUFF-FORUM.md) | 独立启动直接引入的 Nuxt/TuffEx 原仓；本机有私有快照时显示极客班论坛内容，登录只走全站 GitHub 登录，不将其冒充生产论坛。 | — |
| [`USAGE.md`](./ops/USAGE.md) | 公开访问说明：全站 GitHub 登录、加入我们、核心 GitHub 管理和新论坛浏览器演示分别怎么用；不包含内部凭据。 | [EN](./ops/USAGE.en.md) |

## decisions/

已接受决策及其背景、替代方案、后果和重新评估条件。

| 文档 | 说明 | EN |
|---|---|---|
| [`0001-modular-monolith.md`](./decisions/0001-modular-monolith.md) | 保留一个部署单元，通过模块合同、应用工厂和自动检查降低耦合。 | — |
| [`0002-tuffex-ui-foundation.md`](./decisions/0002-tuffex-ui-foundation.md) | 记录用户指定的组件体系，并提供有固定版本、可离线检索的开发文档。 | — |
| [`0003-adopt-tuff-forum.md`](./decisions/0003-adopt-tuff-forum.md) | 用户明确选择使用原仓代码，而不是模仿 UI 或重写一套 React 论坛。 | — |
| [`0004-forum-backend-in-core-server.md`](./decisions/0004-forum-backend-in-core-server.md) | Tuff Forum 前端（ADR-0003）没有后端；论坛的帖子、账号资料和社区功能由核心服务 `app/server` 提供，存在同一个 `data.db` 里。 | — |

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

共 56 篇文档（另有 20 篇英文版）。索引按目录分组，组内按文件名排序。

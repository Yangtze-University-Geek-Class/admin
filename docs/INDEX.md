# 文档索引

> 本文件由 `node scripts/docs-index.mjs` 生成，**请勿手工编辑**。
> 改了文档标题或摘要后重新生成；提交前用 `node scripts/docs-index.mjs --check` 自查。

任务与规范导航见 [`README.md`](./README.md) 和 [`../AGENTS.md`](../AGENTS.md)。Tuffex 完整组件索引见 [`COMPONENTS.md`](./components/tuffex/COMPONENTS.md)，不在总索引重复展开。

## conventions/

强制遵守的规范：分支、审查、提交、Issue、MR、发版与文档。违反会被 CODE-REVIEW 退回。

| 文档 | 说明 | EN |
|---|---|---|
| [`AGENT-ADAPTERS.md`](./conventions/AGENT-ADAPTERS.md) | OMP 与 Claude 读取根 AGENTS.md 的本机加载证据、启动方式和验证边界；本页只说明接入，不定义第二套项目规则。 | — |
| [`AGENT-START.md`](./conventions/AGENT-START.md) | AI 进入 geek_main 的第一步：确认当前分支并完整读取 docs 中的适用规范；不能以记忆、任务紧急或测试通过替代。 | — |
| [`ARCHITECTURE-ALIGNMENT.md`](./conventions/ARCHITECTURE-ALIGNMENT.md) | 每个 PR 都把业务、后端、权限、数据、依赖、文档、验证和交付对齐到实际变更；纯 UI、文档和工程改动也不能省略。 | — |
| [`BRANCHING.md`](./conventions/BRANCHING.md) | 只有 `main`（正式）与 `stage`（预发布）两条长期分支；task 分支合并后必须立即删除，任何操作前先确认当前分支。 | — |
| [`CHANGE-PATHS.md`](./conventions/CHANGE-PATHS.md) | 一件改动先判断属于哪种场景，再照这一行的路径、检查和授权点走；对不上任何一行时停下来问所有者，不自己拼路径。 | — |
| [`CODE-REVIEW.md`](./conventions/CODE-REVIEW.md) | 本仓库专属的 diff 审查清单：触发时机、逐项检查、结论格式与审查记录位置。 | — |
| [`COMMITS.md`](./conventions/COMMITS.md) | Conventional Commits 结构，中文说明，一次提交一个可回滚目的。 | [EN](./conventions/COMMITS.en.md) |
| [`CONTRIBUTING.md`](./conventions/CONTRIBUTING.md) | 统一入口、最小变更、可审查的提交与资源隔离。 | [EN](./conventions/CONTRIBUTING.en.md) |
| [`DOCUMENTATION.md`](./conventions/DOCUMENTATION.md) | 区分当前事实、已接受决策、未实施提议和历史材料；`docs/` 与 `app/` 严格对齐。 | — |
| [`ISSUES.md`](./conventions/ISSUES.md) | issue 是经所有者确认事项的主档：查证、查重、确认后建单；写清现象、验收条件和确认依据，进展以追踪记录留在评论里，PR 合并即关闭。 | [EN](./conventions/ISSUES.en.md) |
| [`MODULAR-DEVELOPMENT.md`](./conventions/MODULAR-DEVELOPMENT.md) | 职责清楚、依赖单向、契约明确；`app/` 与 `docs/services/` 严格对齐，不为目录形式制造部署复杂度。 | — |
| [`NOTES.md`](./conventions/NOTES.md) | 每个人、每个 agent 做的每一步，都按北京时间写进仓库里的 `notes/<日期>/<GitHub 用户名>/<链路>.md`；开发前先记开工，开发后记到收尾，链路不完整的 PR 不能合并。 | — |
| [`PROJECT.md`](./conventions/PROJECT.md) | 项目定位、授权边界、统一入口和完成定义。 | — |
| [`PULL-REQUESTS.md`](./conventions/PULL-REQUESTS.md) | PR 是一次改动的证据档：写清解决链路、验证结果、可以直接照着做的人工验收步骤和截图录屏；审查与返工写成评论，合并后 issue 自动关闭。 | [EN](./conventions/PULL-REQUESTS.en.md) |
| [`REFERENCES.md`](./conventions/REFERENCES.md) | 可追溯的工程依据，不把外部建议、产品选择和已完成验收混为一谈。 | — |
| [`RELEASE-PARITY.md`](./conventions/RELEASE-PARITY.md) | 对齐的是接口和表结构，数据只对齐格式；预发布上做过的每一件事，正式都有对应动作；地址、端口、签发者只来自各环境自己的 env 文件；发版前同构清单清零，发版后烟测通过。 | — |
| [`RELEASES.md`](./conventions/RELEASES.md) | 发版只靠打 tag：`vX.Y.Z-rc.N` 打在 `stage` 的提交上发预发布，在预发布验收通过后，在同一提交上打 `vX.Y.Z` 发正式。tag 不可移动、不可删除，版本号不自动提升。 | — |
| [`TESTING.md`](./conventions/TESTING.md) | 核心真实路由与上游论坛演示分别验收；类型、行为、构建和生产证据不相互替代。 | — |
| [`TRACKING.md`](./conventions/TRACKING.md) | 一件事从提出到关闭，每一步都以固定格式的评论留在 issue 与 PR 上；人扫一眼能看懂进展，Agent 按字段就能读出状态。 | — |

## services/

与 `app/` 一一对应的服务文档：每个服务一份 README（源码地图、契约、运行、验证、限制）。

## services/cli/

极客班命令行 `geek`（Rust）：设备码登录、论坛/比赛/代码仓库只读与写操作、给 Claude Code/Codex/omp 装一份极客班技能（#277）。独立工具链，不进 Node 工作区；产物不单独成镜像，随 `app/web` 镜像的 `/cli/` 路径分发。

## services/console/

极客班控制台前端：Vue 3 + Tuffex 单页应用，按权限节点显示页面；接口全部来自 `app/server`，产物由 web 镜像托管。

## services/forum/

直接采用 Tuff Forum 原代码、TuffEx 组件与验证方式；线上镜像是极客班论坛：帖子、回复、资料存在核心服务（同域 `/api/forum/*`，#57），话题按身份分级可见（公开、注册用户、成员），没登录只能看公开的帖子；成员用全站登录（极客班账号）后发帖、回复、点赞、用表情回应、收藏、关注、改资料，注册用户填邀请码成为成员之前只能看；本机可显示极客班论坛快照；上游验收与本机示例预览仍是浏览器里的示例数据。

## services/server/

核心 portal/admin/console 与论坛接口的应用组装、资源生命周期和真实 GitHub 适配；一个 Fastify 进程。

| 文档 | 说明 | EN |
|---|---|---|
| [`competition-rehearsal.md`](./services/server/competition-rehearsal.md) | GitHub #276 的有限后台验收矩阵、真实路由闭环和浏览器接力入口；测试通过不等于未知组合、真实 GitLab 或浏览器已验收。 | — |
| [`contest-site-quickstart.md`](./services/server/contest-site-quickstart.md) | 给要给自己的内部比赛做一个官网的组织者看：从建比赛到发布官网的完整步骤，接口清单，以及几条容易踩的坑。这份文档本身是给论坛「举办内部比赛指南」（t910）直接引用的材料，写法上不假设读者先看过别的文档。 | — |
| [`data-model.md`](./services/server/data-model.md) | data.db 每张表的用途、写入方、读取方和个人信息字段，以及当前没有消费者的表、列和索引；表结构以 `app/server/src/lib/db.ts` 为唯一来源。 | — |
| [`endpoint-contracts.md`](./services/server/endpoint-contracts.md) | 按真实 handler、授权执行点与存储实现核对现有接口；关联目录中的业务用例，区分存量人工说明与已挂载的机器响应契约。 | — |
| [`mail.md`](./services/server/mail.md) | 招新的四封信怎么拼、怎么渲染、怎么排队发出去：每类信的内容是库里的模板（可以有多套，控制台里编辑、预览、向测试邮箱试发），拼好后先写进 data.db 的发信队列，再由服务进程里的发信循环交给阿里云邮件推送或 Resend；信封版式照官网「加入我们」的信纸，图片部件放在 CDN 上。 | — |
| [`oidc.md`](./services/server/oidc.md) | 不同源的应用用极客班账号登录：核心服务内嵌一个 OpenID Connect 签发者，第一个下游是自建的 GitLab（正式 `https://yangtzeu.work/gitlab`；#335 搬家前是子域名 `git.yangtzeu.work`，现在只做跳转）。同一模块按极客班账号在 GitLab 上建好用户、放进 `geek` 组，离开的封禁。 | — |

## services/web/

官网 portal（React/Vite）+ shared 适配层；web 镜像同时托管控制台产物（`app/console`），是每个环境的 HTTP 入口容器。

| 文档 | 说明 | EN |
|---|---|---|
| [`admin.md`](./services/web/admin.md) | 管理端前端已从 `app/web/sites/admin`（React）迁到独立的 Vue 包 `app/console`；本页只记录迁移事实与仍然有效的服务端约定。 | — |
| [`portal.md`](./services/web/portal.md) | 公开官网：开机动画与 YUGC OS 桌面（加入我们、意见箱等都是桌面窗口）、论坛 3D 场景和文档；不自建登录，菜单栏头像打开「账号资料」窗口。 | — |
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
| [`ARCHITECTURE.md`](./architecture/ARCHITECTURE.md) | 四个源码应用、三个 Docker 运行单元；区分当前代码、开发模式与部署证据，并从统一目录追溯接口、数据和权限。 | [EN](./architecture/ARCHITECTURE.en.md) |
| [`SECURITY.md`](./architecture/SECURITY.md) | 区分核心后端授权、论坛服务端模式与本机演示；代码防护、真实环境配置和人工验收分别取证。 | [EN](./architecture/SECURITY.en.md) |

## architecture/catalog/

人查看交互地图，Agent 检索同源文本与结构化目录；应用、接口、数据、权限和业务流程统一关联源码证据。

| 文档 | 说明 | EN |
|---|---|---|
| [`CATALOG.md`](./architecture/catalog/CATALOG.md) | 应用、运行单元、业务域与源码证据的统一入口；不表示线上部署状态。 | — |
| [`data-model.md`](./architecture/catalog/data-model.md) | 从真实建库函数产生的内存 SQLite 提取表、列、索引和物理外键；不读取业务记录。 | — |
| [`permissions.md`](./architecture/catalog/permissions.md) | 直接读取服务端能力定义、蕴含关系及可定位的路由检查，不复制运行时角色权限包。 | — |
| [`routes.md`](./architecture/catalog/routes.md) | 真实 Fastify 注册的方法、路径、Schema 与源码位置；含根路由、嵌套插件、循环注册及自动 HEAD。 | — |

## plan/

计划与现状盘点，**有保质期**。落地后应删除或压缩成结论，不要长期堆积。

| 文档 | 说明 | EN |
|---|---|---|
| [`COMPETITION-APP.md`](./plan/COMPETITION-APP.md) | #239 的目标方案（未实施）：把官网「比赛」窗口升级为「赛事 / 我的参赛」两个视图的应用——所有人看到同一份赛事，极客班成员在上面叠加自己的报名、组队与参赛状态；参赛者按极客班统一账号（`account_id`）识别，不按 GitHub 账号；同时约定接口、业务规则、数据库草图、控制台报名名单、内部比赛官网托管与 SDK、与统一登录等其他业务的协调，以及与后端草稿 90fc376 的对齐清单。 | — |
| [`CONSOLE-PERMISSION-TREE.md`](./plan/CONSOLE-PERMISSION-TREE.md) | #176 的离线参考与接入计划已落实为控制台只读页签；当前契约迁回 console 服务文档。本记录是实施结论，不代替人工验收；合并、tag 与部署状态以 issue #176 的追踪记录为准。 | — |
| [`REFACTOR.md`](./plan/REFACTOR.md) | 历史阶段记录：旧路径、版本、数量和完成声明仅供追溯。 | [EN](./plan/REFACTOR.en.md) |
| [`UNIFIED-LOGIN.md`](./plan/UNIFIED-LOGIN.md) | #237 的实施规格（交付 1 已由 #262 实施：账号底座与 GitHub 登录事务、统一登录页 `/signin`、三端入口改「登录」、RFC 8628 设备授权；#262 第二、三期按所有者 2026-10-23 的决定实施了邮箱验证码与密码登录、Google 登录、邀请码注册与账号页 `/account`，见「实施进度」；交付 4 与渠道绑定的其余部分未实施，其中 Google 绑定已由 #291 实施，见「第二、三期」下面一段）：把 ADR-0005 落到可以直接开工的颗粒度——统一登录页 `/signin`、账号页 `/account` 与控制台的界面状态，三种登录方式的后端流程，全站一套的个人资料（头像、昵称），新表与迁移，要会话的接口在邮箱或 Google 会话下怎么处理，以及各业务要改什么、怎么验收；按四个候选 issue 拆分交付。 | — |
| [`WEB-SPLIT.md`](./plan/WEB-SPLIT.md) | 历史阶段记录：旧路径、版本、数量和完成声明仅供追溯。 | [EN](./plan/WEB-SPLIT.en.md) |
| [`YUGC-OS-V2.md`](./plan/YUGC-OS-V2.md) | 批次源自开机动画视觉令牌与门户桌面改版，所有者 2026-10-23 批准按 `#274 账号/权限地基 → #275 门户桌面 → #276 论坛可见范围 → #277 geek 命令行 → #278 第一期比赛官网` 顺序推进。本文件收录设计方案第 1–3 章的要点（视觉令牌去向、执行顺序与分工、#274 的设计与落地结论）；第 1 章的令牌取值写进 `docs/design/DESIGN.md`（由 #275 补充），逐字段的接口契约在各自服务契约文档里；#275-#278 各章的要点由对应 issue 的 MR 补进本文件。 | — |

## ops/

运维与使用：照着做就能跑的操作手册。

| 文档 | 说明 | EN |
|---|---|---|
| [`BACKUP.md`](./ops/BACKUP.md) | 平台沿用 `yzgc-system-backup@1` 系统归档恢复到独立空卷；数据、配置、身份映射和外发隔离分别验收，不把 GitLab 备份或文件 hash 当完整迁移。 | — |
| [`CDN.md`](./ops/CDN.md) | #346：公开静态资源改回七牛（域名绑定到桶，上传走 path-style S3）；Garage 的公开桶封存，对象内容与配置保留。对象内容、发布来源和私有运维索引分别追溯。 | — |
| [`CICD.md`](./ops/CICD.md) | 持续集成、宏观对齐与 `.env` 驱动的发布控制；发版只由发布 tag 触发（`vX.Y.Z-rc.N` / `vX.Y.Z-hf.N` / `vX.Y.Z-stable.N` → 预发布，`vX.Y.Z` → 正式），push 分支只跑 CI；部署开关默认关闭，机器检查不替代人工验收。 | — |
| [`DEPLOY.md`](./ops/DEPLOY.md) | 两套隔离 Linux Docker 栈运行于 Arch，香港 Caddy 提供 HTTPS 入口；DNS 过渡期间旧 VPS 仅转发，不再运行应用或写库。 | [EN](./ops/DEPLOY.en.md) |
| [`ENVIRONMENT.md`](./ops/ENVIRONMENT.md) | 仅包含占位符；已有环境文件不由代码规范化任务读取或覆盖。 | — |
| [`ENVIRONMENTS.md`](./ops/ENVIRONMENTS.md) | 三份仓库环境模板（正式、预发布、本机）、Arch/HK 发布目标与副本外发门禁；已接管的权威源保持原行为，模板、运行配置和数据库有效设置分别核对。 | — |
| [`FORUM-DATA-CAPTURE.md`](./ops/FORUM-DATA-CAPTURE.md) | 已通过 Mac SSH 获取三份 SQLite 在线备份及两代附件；本机论坛可只读显示由此生成的投影，未导入可写库或切换线上服务。 | — |
| [`GITLAB.md`](./ops/GITLAB.md) | `deploy/gitlab/` 的来源、安装映射、OIDC 与头像边界、私有备份及恢复验收门禁；源码纳管不代表重新部署或统一登录恢复。 | — |
| [`LOCAL-PREVIEW.md`](./ops/LOCAL-PREVIEW.md) | 本机起官网、核心后端与论坛；启动时给出 GitHub OAuth 应用的两项凭据就走真实 GitHub 登录（数据留在 `.tools/local-preview/`），不给就是隔离的内存模式。 | — |
| [`RELEASE-ACCEPTANCE-TEMPLATE.md`](./ops/RELEASE-ACCEPTANCE-TEMPLATE.md) | 空白模板，供验收人逐字段手工填写；不是流水线自动生成的通过证明。 | — |
| [`STORAGE-CDN.md`](./ops/STORAGE-CDN.md) | 一台守在香港的 1 vCPU / 1 GiB 小机器：Garage 提供 S3 兼容对象存储，Caddy 做网关与自动 TLS，S3 Manager 提供可视控制台，Policy Bridge 把控制台里的「设为公共桶」翻译成 Garage 的 website 开关。本文件是这套系统的**唯一现行合同**，配置模板在 `deploy/storage-cdn/`。 | — |
| [`TUFF-FORUM.md`](./ops/TUFF-FORUM.md) | 独立启动直接引入的 Nuxt/TuffEx 原仓；本机有私有快照时显示极客班论坛内容，登录只走全站统一登录页（GitHub 是目前唯一的登录方式），不将其冒充生产论坛。 | — |
| [`USAGE.md`](./ops/USAGE.md) | 公开访问说明：全站 GitHub 登录、加入我们、核心 GitHub 管理和新论坛浏览器演示分别怎么用；不包含内部凭据。 | [EN](./ops/USAGE.en.md) |

## changes/

每个任务的一份宏观对齐记录，与真实 diff、项目目录及 PR 正文一起审查。

## decisions/

架构决策及待确认方案的背景、替代方案、后果和重新评估条件；以各文档的状态与实施说明为准。

| 文档 | 说明 | EN |
|---|---|---|
| [`0001-modular-monolith.md`](./decisions/0001-modular-monolith.md) | 保留一个部署单元，通过模块合同、应用工厂和自动检查降低耦合。 | — |
| [`0002-tuffex-ui-foundation.md`](./decisions/0002-tuffex-ui-foundation.md) | 记录用户指定的组件体系，并提供有固定版本、可离线检索的开发文档。 | — |
| [`0003-adopt-tuff-forum.md`](./decisions/0003-adopt-tuff-forum.md) | 用户明确选择使用原仓代码，而不是模仿 UI 或重写一套 React 论坛。 | — |
| [`0004-forum-backend-in-core-server.md`](./decisions/0004-forum-backend-in-core-server.md) | Tuff Forum 前端（ADR-0003）没有后端；论坛的帖子、账号资料和社区功能由核心服务 `app/server` 提供，存在同一个 `data.db` 里。 | — |
| [`0005-sso-extend-core-server.md`](./decisions/0005-sso-extend-core-server.md) | 已接受的方案（`accepted`），尚未实施：产品上叫「长江大学极客班统一登录」，GitHub（已有）、Google、邮箱验证码（以后可能有微信）都是绑定在同一个极客班账号（内部 OpenID）上的登录方式，会话、权限和审计都以账号为主语；先在 `app/server` 里建身份表、改会话、改三端的登录界面，不引入成品 IdP 或认证库；对外授权（OIDC）等第一个下游应用出现时接在内部身份之上，内嵌在 `app/server`，不另起授权服务器。头像、昵称等个人资料也归极客班账号，官网、论坛、控制台和比赛用同一份，改一处各端同步（决策 10）。GitHub 组织门槛不动：第一次建号仍要用 GitHub 证明是组织成员。 | — |

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

## history/changes/gitlab/

保存跨仓同号 issue 的原始声明；本目录不是当前 GitHub 任务的实施依据。

| 文档 | 说明 | EN |
|---|---|---|
| [`270.md`](./history/changes/gitlab/270.md) |  | — |
| [`271.md`](./history/changes/gitlab/271.md) | 保全旧 GitLab 同号声明的原始字节及来源，不将旧业务批准转移给当前 GitHub 任务。 | — |
| [`272.md`](./history/changes/gitlab/272.md) | 保全旧 GitLab 同号声明的原始字节及来源，不将旧业务批准转移给当前 GitHub 任务。 | — |
| [`273.md`](./history/changes/gitlab/273.md) | 保全旧 GitLab 同号声明的原始字节及来源，不将旧业务批准转移给当前 GitHub 任务。 | — |
| [`274.md`](./history/changes/gitlab/274.md) | 保全旧 GitLab 同号声明的原始字节及来源，不将旧业务批准转移给当前 GitHub 任务。 | — |
| [`275.md`](./history/changes/gitlab/275.md) | 保全旧 GitLab 同号声明的原始字节及来源，不将旧业务批准转移给当前 GitHub 任务。 | — |
| [`284.md`](./history/changes/gitlab/284.md) |  | — |

## history/portal-contest-night/

#278 把主站比赛窗口的官网入口横幅和比赛详情头图从夜空改成和第一期比赛官网同一套浅色时退场的组件与样式，原样放在这里备查；它们不参与构建，也不会上线。

## history/portal-yugc-os-v1/

#275 把官网换成 YUGC OS v2 桌面时退场的页面、组件、样式、图片和模型，以及 #279 把「加入我们」改成桌面窗口时退场的信封场景，原样放在这里备查；它们不参与构建，也不会上线。

## history/portal-yugc-os-v1/files/app/web/sites/portal/assets/models/

iPhone 15 Pro Max model attribution

## public/

长江大学极客班官网、论坛和组织管理服务。

## reviews/

按实际代码基线、执行结果与未验证边界保存审查和交付证据。

| 文档 | 说明 | EN |
|---|---|---|
| [`DATA-CAPTURE-RELEASE-RULES.md`](./reviews/DATA-CAPTURE-RELEASE-RULES.md) | 原始数据已落在 Mac 私有目录，Agent 首步阅读及人工发版约定已落实；未导入新论坛，也未开启远程部署。 | — |
| [`GITLAB-INCIDENT-2026-10.md`](./reviews/GITLAB-INCIDENT-2026-10.md) | 极客班成员在比赛期间进不了自己的 GitLab 号，参赛提交落到了 GitHub。复盘只看流程和门禁的缺口，不追究个人。 | — |
| [`LOCAL-CONTENT-ENVIRONMENTS.md`](./reviews/LOCAL-CONTENT-ENVIRONMENTS.md) | 阶段记录：发布域名合同和论坛环境展示已实现，真实内容投影已生成；当时数据接口未落盘，页面接入未完成。本机只读快照接入已于 2026-09-13 中午完成，见 FORUM-DATA-CAPTURE 最新状态。 | — |
| [`NORMALIZATION.md`](./reviews/NORMALIZATION.md) | 本地代码、文档和隔离测试的实际交付记录；生产环境与凭据轮换尚未执行。 | — |
| [`STRICT-SHIELD-387.md`](./reviews/STRICT-SHIELD-387.md) |  | — |
| [`TUFF-FORUM-ADOPTION.md`](./reviews/TUFF-FORUM-ADOPTION.md) | 已直接采用原仓前端并切换本机入口；不将缺少真实认证和后端的演示称为生产社区。 | — |
| [`TUFFEX-DOCS.md`](./reviews/TUFFEX-DOCS.md) | 固定官方源码提交的离线文档、示例、类型参考、AI 检索与项目选型约定。 | — |

## reviews/238/

#238 / PR #243 的本地真实 HTTP、桌面与手机界面证据；测试身份与真实 OAuth 分开记录。

---

共 87 篇文档（另有 20 篇英文版）。索引按目录分组，组内按文件名排序。

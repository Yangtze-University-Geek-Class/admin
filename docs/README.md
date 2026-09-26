# 文档与规范总入口

> 所有项目规范集中于 docs；`docs/` 与 `app/` 严格对齐，根目录及工具文件只负责导航。

状态：`current` · 更新：2026-09-26

## AI 第一操作

Agent 进入仓库的第一件事是**确认当前分支**（`git branch --show-current`），第二件事是停止业务操作并完整读取 [AGENT-START](conventions/AGENT-START.md)、[PROJECT](conventions/PROJECT.md)、[BRANCHING](conventions/BRANCHING.md)、[CONTRIBUTING](conventions/CONTRIBUTING.md)、[TRACKING](conventions/TRACKING.md)、[NOTES](conventions/NOTES.md)、[CODE-REVIEW](conventions/CODE-REVIEW.md)、[RELEASES](conventions/RELEASES.md) 和任务适用文档，再开始实施。根 [AGENTS](../AGENTS.md) 保存硬门禁摘要；不能先执行再补读。

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

**硬规则**：新增服务 = 新增 `app/<service>` + 新增 `docs/services/<service>/README.md` + 下一节对照表里加一行，缺一视为未完成；模块细节放同目录子文档（见 [MODULAR-DEVELOPMENT](conventions/MODULAR-DEVELOPMENT.md) 与 [DOCUMENTATION](conventions/DOCUMENTATION.md)）。`docs/modules/` 已删除，不再重建。

## 文档跟着模块改

模块改了，对应的文档要在同一个 PR 里跟着改。下表是模块与文档的唯一对照清单，`scripts/check-doc-sync.mjs` 逐行核对（`pnpm check:doc-sync`，在 `pnpm check` 里，CI 的 core 与 branch-guard 都会跑），不通过就不能合并：

| 模块路径 | 文档路径 | 头部「更新：」 |
|---|---|---|
| `app/server/` | `docs/services/server/` | `docs/services/server/README.md` |
| `app/web/` | `docs/services/web/` | `docs/services/web/README.md` |
| `app/console/` | `docs/services/console/` | `docs/services/console/README.md` |
| `app/forum/` | `docs/services/forum/` | `docs/services/forum/README.md` |
| `deploy/` | `docs/ops/DEPLOY.md`、`docs/ops/ENVIRONMENTS.md`、`docs/ops/CICD.md` | `docs/ops/DEPLOY.md`、`docs/ops/ENVIRONMENTS.md`、`docs/ops/CICD.md` |
| `.github/workflows/` | `docs/ops/CICD.md` | `docs/ops/CICD.md` |

检查分两种，按所在分支自动选：

1. 在 `task/*` 分支上按 PR 核对（本机的 `pnpm check` 对 `origin/stage`，没有就对本地 `stage`；CI 的 `branch-guard` 用 `--base origin/stage --head <task 分支>`）：从 merge-base 到现在，动了模块路径，就要改对应文档路径里的说明，或者在这个 task 的执行记录里写文档核对（见下文）。已提交、没提交、没跟踪的新文件都算；文档只改了「更新：」日期不算改了说明。PR 里先改文档、后面返工代码不要紧，只看整个 PR。另外在 merge-base 上按第 2 条核对一次，`stage` 本来就不同步的照样报出来，并写明不是这条分支造成的；这条分支改了那份文档的说明或写了文档核对，就算在顺手修，不再报。找不到 `origin/stage` 和 `stage` 时退回第 2 条并提示先 `git fetch origin stage`。
2. 在其它分支上（`stage`、`main`、`dev/*`、CI 给 PR 做的合并提交）按第一父链的时间核对：模块路径在第一父链上最后一次改动（`git log -1 --first-parent --format=%ct -- <路径>`）不能比文档路径新。PR 以 merge commit 进 `stage`，合并提交同时带来模块和文档（或文档核对），两边时间相同就通过。工作区里还没提交的改动（含没跟踪的新文件）算作「现在」。这条依赖「PR 只用 merge commit 进 `stage`」（[BRANCHING](conventions/BRANCHING.md)）：rebase 合并会把 PR 的提交逐个接到第一父链上，模块提交排在文档提交后面就不通过。

两种都要满足：

3. 第三列文档开头的「更新：」日期不能早于模块最后一次改动（不算合并提交）的作者时间的北京日期；一行写了几份文档时，看其中最新的那个日期。用作者时间，是为了零点前写好、零点后才合进 `stage` 的提交不被判成过期。工作区里有没提交的模块改动时按今天算。写了文档核对也要满足这一条。「更新：」只是时间戳：几个 PR 同一天改成同一个日期，合并时不冲突；不同日期改了同一行，解冲突时留较晚的日期。
4. 要有完整历史：浅克隆直接报错，不会当作通过。CI 的检出写 `fetch-depth: 0`；本机遇到时运行 `git fetch --unshallow`。
5. `app/` 下每个服务目录（Git 跟踪的或没被忽略的新目录）都要在表里，表里写的路径都要存在。不设排除项：`app/` 里的测试、脚本、Dockerfile、锁文件改了，也要回头看服务文档里对应的源码地图、验证命令、镜像说明还对不对。

不通过时，报错会写出是哪一对、是哪个提交或哪些文件。先 `git show <提交>` 看改了什么，把文档里对应的说明改对，再把「更新：」改成当天。

模块改了、文档里写的事实却一个都没变（只改测试、重构、审查后的返工），就在这个 task 自己的执行记录（`notes/<日期>/<用户名>/task_<issue>_<slug>.md`，[NOTES](conventions/NOTES.md)）里写一行文档核对，格式是 `文档核对：<文档路径> 不用改——<理由>`，文档路径照抄上表第二列（例 `文档核对：docs/services/server/ 不用改——只加了 roles.ts 的回归测试，接口和表都没变`），可以写在 `node scripts/note.mjs add` 的「做了什么」或「结果」里。执行记录文件只有这个 PR 会改，不像共享的文档行那样让并行的 PR 互相冲突。文档核对是真实的核对记录，审查人对照 diff 看理由属不属实。只改「更新：」日期、既不改说明也不写文档核对，检查不通过；理由写得不实，审查按 [CODE-REVIEW](conventions/CODE-REVIEW.md) 第 6 项拦下。实现在 `scripts/check-doc-sync.mjs`，测试在 `tests/tooling/doc-sync.test.ts`。

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
| issue ↔ 分支 ↔ PR 的生命周期、互相引用、评论里的追踪记录格式 | [TRACKING](conventions/TRACKING.md) |
| 每个人、每个 agent 的执行记录（`notes/`，按北京日期和 GitHub 用户名） | [NOTES](conventions/NOTES.md) |
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
| 架构决策 | [ADR-0001](decisions/0001-modular-monolith.md)、[ADR-0002](decisions/0002-tuffex-ui-foundation.md)、[ADR-0003](decisions/0003-adopt-tuff-forum.md)、[ADR-0004](decisions/0004-forum-backend-in-core-server.md) |
| 交付证据与历史整改记录 | [reviews](reviews/README.md)；历史材料见 [history](history/README.md)、[plan](plan/README.md)、[handovers](handovers/README.md) |

## 文档类别与优先级

`conventions/` 规定如何协作，`services/` 规定每个服务的边界与实现位置，`architecture/` 描述当前系统，`design/` 规定当前交互与选型，`ops/` 记录操作流程，`decisions/` 保存已接受的决策，`plan/` `history/` `handovers/` 保存计划与历史材料，`reviews/` 保存交付证据，`public/` 仅存允许公开的材料。

同一规则只在一个规范源定义，其余文档链接过去。状态词表只有 `current` / `accepted` / `proposed` / `historical`（见 [DOCUMENTATION](conventions/DOCUMENTATION.md)）：`historical` 与 `proposed` 文档不覆盖 current 规范，也不得被当作现行操作依据。代码与 current 文档不一致是缺陷，必须在改动中说明并同步修正；不能通过随意选择某份文档掩盖冲突。

完整目录见 [INDEX](INDEX.md)。索引由 `pnpm docs:index`（`node scripts/docs-index.mjs`）生成，不手工维护。文档标题、摘要、路径变更必须重新生成索引。

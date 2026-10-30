# Agent entry point — geek_main

> 本文件是仓库唯一的 agent 入口，只写规范与硬门禁。规则正文全部在 `docs/`，这里不写教程、不复制第二套规则。

## 0. 首步门禁：先确认分支，再读完规范

**AI / Agent 进入本仓库的第一件事是 `git branch --show-current`，然后按顺序读完下面这些文档；没读完不许动手。**

1. [docs 总入口](docs/README.md)
2. [AGENT-START](docs/conventions/AGENT-START.md)
3. [PROJECT](docs/conventions/PROJECT.md)
4. [BRANCHING](docs/conventions/BRANCHING.md)
5. [CHANGE-PATHS](docs/conventions/CHANGE-PATHS.md)（改动走哪条路：常规、P0 hotfix、部分晋升、配置、数据、宿主、回滚、活动期、代码托管不可用）
6. [CONTRIBUTING](docs/conventions/CONTRIBUTING.md)
7. [TRACKING](docs/conventions/TRACKING.md)
8. [NOTES](docs/conventions/NOTES.md)
9. [CODE-REVIEW](docs/conventions/CODE-REVIEW.md)
10. [RELEASES](docs/conventions/RELEASES.md)
11. [RELEASE-PARITY](docs/conventions/RELEASE-PARITY.md)（发版、hotfix、动 env / 部署 / 宿主 / 外部服务的任务必读）

再按任务读取适用规范与服务契约（`docs/services/` 下的服务文档、[TESTING](docs/conventions/TESTING.md)、安全与运维文档等）。

**项目定位、功能设计与 PR 审查先查[项目地图与检索入口](docs/architecture/catalog/README.md)**：按业务域找到接口、权限、数据及源码证据，再确定改动位置。Agent 按该入口读取同源 Markdown/JSON；人查看[交互地图](docs/architecture/catalog/map.html)。

读完之前禁止：编辑文件、安装依赖、执行项目脚本、操作业务数据、启动或停止服务、任何 Git 写操作（提交、推送、切分支、建分支、合并）。只允许读规范必需的只读操作：`git branch --show-current`、`git status`、读取文档。

文档被截断就继续读到完整；文件缺失、读不到或规范互相冲突时停下来报告阻塞，不凭记忆继续。上下文压缩或恢复后同样适用。

## 1. 分支硬门禁

**长期分支只有两条：`main`（正式）与 `stage`（预发布）；其余分支必须是短生命周期。**

- `stage` 必须包含 `main`：`git merge-base --is-ancestor origin/main origin/stage` 必须成功；`main` 不得领先 `stage`，写进 `main` 的提交必须已经存在于 `stage`。
- 禁止直接向 `main` 提交或推送；`main` 只能由 `stage` 合并进入。例外只有两种窗口，都要所有者的批准摘要、都会过期，分支门禁按登记逐个提交核对。第一种是 `deploy/hotfix/windows.json` 里所有者批准、未过期的 P0 hotfix 窗口：窗口内 `main` 可以领先 `stage`，领先的每个提交都要归属于该窗口 issue，hotfix MR 合进 `main` 后立刻运行 `node scripts/hotfix-sync.mjs apply` 合回 `stage`，保证 `stage >= main`（[BRANCHING](docs/conventions/BRANCHING.md)「线上紧急修复」）；不用 `--no-verify` 绕过门禁。
- 第二种是部分晋升窗口：预发布里已验收的一部分要先上正式、又不是 P0 时，不借用 hotfix 窗口：先考虑功能开关和前缀快进，都不行才登记 `deploy/promotion/windows.json` 的部分晋升窗口（所有者的批准摘要、最长 3 天），`main` 领先 `stage` 的提交只能是登记提交和 `git cherry-pick -x` 挑来的 picks，由 `scripts/promotion-windows.mjs` 与 branch-guard 核对（[BRANCHING](docs/conventions/BRANCHING.md)「部分晋升窗口」）。
- 分支名一律不用 `-`，只用 `/` 分层，段内多词用 `_`（正则见 [BRANCHING](docs/conventions/BRANCHING.md)）。
- 任务分支命名 `task/<issue>/<slug>`（例 `task/12/portal_redesign`），**只能从 `stage` 拉出**；MR 合并后必须立即删除，不得残留死分支。
- `dev/<github-username>`（例 `dev/alice`）是个人自由开发区，不作为进入 `stage` 的凭据，也不部署。
- 推送分支不部署：push `stage`/`main` 只跑 CI。发版只靠打 tag：`vX.Y.Z-rc.N` 打在 `stage` 的提交上 → 预发布 `https://prev.yangtzeu.work`；`vX.Y.Z` 打在 `main` 的同一提交上 → 正式 `https://yangtzeu.work`；hotfix 合回 `stage` 的合并提交上打 `vX.Y.Z-hf.N` / `vX.Y.Z-stable.N`，也发预发布（[RELEASES](docs/conventions/RELEASES.md)）。本机 localhost/127.0.0.1 只是本地开发，不是预发布。
- 规则存在不等于远程保护已生效：域名、环境文件或分支保护配置齐全，不代表 DNS、TLS、CI 或部署已经落地。

细节见 [BRANCHING](docs/conventions/BRANCHING.md)。

## 2. 工作流硬门禁

**建单先由所有者确认。** Agent 先查证、查重，用「痛点／解决方案／最终效果与验收条件」提出候选；只有所有者明确批准具体事项后，才可新建、拆分、补建、重开或建立替代 issue，并在正文保留确认依据（[ISSUES](docs/conventions/ISSUES.md) §1–§2）。未确认只保留候选，不建 issue 或 task 分支、不擅自实施候选；「先 issue」、审查建议、巡检、紧急补单与后续跟进都不是建单授权。所有者取消的事项不自动恢复。

**所有者确认建单 → issue → 从 `stage` 拉 task 分支 → MR 回 `stage` → 在 `stage` 的提交上打 `vX.Y.Z-rc.N` 发预发布 → 所有者验收 → `main` 快进到同一提交 → 打 `vX.Y.Z` 发正式。**

- **一件事 = 一个 issue = 一个 `task/<issue>/<slug>` 分支 = 一个 git worktree = 一个 PR**，生命周期跟着 issue 走（[TRACKING](docs/conventions/TRACKING.md)）。开工用 `node scripts/task.mjs start <issue> <slug>` 从最新 `stage` 建分支和独立 worktree，所有开发都在 worktree 里做，不在主工作区切分支；合并后 `node scripts/task.mjs finish <issue>` 删 worktree 与本地分支（[BRANCHING](docs/conventions/BRANCHING.md)「task worktree」）；本机有 PR 已合并或 issue 已关、还没 finish 的 worktree 时，`pre-push` 拒绝任何推送（钩子每台克隆用 `pnpm hooks:enable` 启用一次）。开发前先按 [ISSUES](docs/conventions/ISSUES.md) 开 issue；PR 按 [PULL-REQUESTS](docs/conventions/PULL-REQUESTS.md) 的正文契约写（`Closes #<issue>`、解决链路、验收证据截图 / 录屏、人工验收步骤），CI 的 `pr-contract` 核对；**合并进 `stage` 即删分支、关 issue**，issue 与 PR 两边都要留记录。
- issue 做完当场关（合并后不清理，死分支和开着的 issue 会无人看管）：PR 合并进 `stage` 后，它 `Closes` 的 issue 必须关闭，task 分支与 worktree 必须清理；`issue-lifecycle` 自动关 issue、`branch-hygiene` 自动删远端分支，自动化没关上的（例如 fork PR 没有写权限，#137）由合并的人当场手工关并留「关闭」记录，本机 worktree 由开发者 `task.mjs finish`。不走 PR 做完的（运维操作、被别的改动顺带解决）由做完的人当场写「关闭」记录再关；所有者取消的用 `not planned` 关闭，取消不表示修复或职责完成。只剩外部等待或新发现的问题先提出候选，由所有者决定是否继续、拆分或建单，不自动生成替代 issue。每天的巡检补关 PR 已合并还开着的 issue，给 14 天没动静的留「超期」、给关了却没有 PR 也没有记录的留「缺记录」。每个生命周期在哪里强制见 [TRACKING](docs/conventions/TRACKING.md) §1。
- 每个阶段的进展以 [TRACKING](docs/conventions/TRACKING.md) §3 的「追踪记录」格式写成 issue / PR 评论；恢复上下文先读 issue 正文和最后几条追踪记录，不凭记忆续做。
- **执行记录前后必须写**（[NOTES](docs/conventions/NOTES.md)）：每一步按北京时间记进 `notes/<日期>/<GitHub 用户名>/<链路>.md`，入口是 `notes/INDEX.md`。开发前由 `task.mjs start` 记「开工」（要带 `GEEK_NOTES_USER` 与 `GEEK_NOTES_BY` 身份），开发中每次提交、开 PR、审查、返工都记，合并、发布、验收照记，`task.mjs finish` 记「收尾」。task PR 的链路缺「开工」「提交」「PR」「审查」时 CI 不通过，不能合并。
- 任何进入 `stage` 的内容必须走 [CODE-REVIEW](docs/conventions/CODE-REVIEW.md)：按 [code-review 技能](.agents/skills/code-review/SKILL.md) 逐项核对 diff，并把审查结论贴进 MR。**没有审查结论的 MR 不允许合并。**
- 进入 `main` 和打正式 tag 前，必须有在预发布环境对同一提交的真实验收记录；自动化 PASS 只是机器验证，不能代替人工验证。
- 文档跟着模块改：`app/<服务>`、`deploy/`、`.github/workflows/` 改了，对应文档在同一个 PR 里跟着改，服务文档头的「更新：」不早于模块最后改动的日期；文档里的事实确实没变时，在这个 task 的执行记录里写「文档核对：<文档路径> 不用改——<理由>」。对照表与规则只在 [docs/README](docs/README.md)「文档跟着模块改」，`pnpm check` 与 CI 强制。只改日期、不改内容是假同步。PR 只用 merge commit 进 `stage`（[BRANCHING](docs/conventions/BRANCHING.md)）。
- **issue 与 PR 必带「组:类」改动类型标签**（`ui:*` / `func:*` / `infra:*`，口径见 [ISSUES](docs/conventions/ISSUES.md) §2）：`ui:*` 的 issue 和 PR 必须有已上传至 GitHub 托管的有效截图（用户提供图片，Agent 必须负责转存上传为 GitHub 附件链接，禁止写入裸文件名或本地路径充数；缺图必须主动找用户要）；`func:*` 必须有接口测试与接口验证，建单前先查开放与已关闭的相似 issue 并在正文写「相关 issue」；`task.mjs start` 与 CI 的 `pr-contract` 核对。
- 提交信息只遵循 [COMMITS](docs/conventions/COMMITS.md)；提交、推送、合并、打 tag、部署分别需要对应授权。发版流程、tag 规则与回滚见 [RELEASES](docs/conventions/RELEASES.md)。

**每个 PR 必须宏观颗粒度对齐**（[ARCHITECTURE-ALIGNMENT](docs/conventions/ARCHITECTURE-ALIGNMENT.md)）：先读项目目录及相关业务合同，提交 `docs/changes/<issue>.json`，逐项评估业务、后端接口、权限与资源范围、数据与事务、依赖/副作用、文档、验证和交付。纯 UI、文档或工程 PR 也不得省略；实际 diff 未覆盖、假称无影响、悬空节点、漏相关文档或回归时拒绝。运行 `pnpm check:architecture`，审查核对语义，不以填表或绿标代替设计。进入 stage 前 `architecture-alignment`、`pr-contract`、`verify` 必须成功；远端强制状态另查分支保护，不凭工作流文件推断。

## 3. 部署硬门禁

**每个环境一套完整 Docker 栈：`production` 与 `preview`，各自 compose、网络、卷，互不共享数据。**

- 环境变量只走 `deploy/env/.env.production` / `deploy/env/.env.preview` / `deploy/env/.env.dev`（本机调试，脱敏入库，默认走本地），前两份由 `docker compose --env-file` 消费；三份键集一致、值互相隔离，`pnpm check:env-isolation` 核对（含在 `pnpm check` 里）。不得另建环境文件或在别处定义第二份环境变量。
- 代码、工作流、宿主配置片段不写另一个环境的域名、端口、签发者、镜像仓库：从该环境的 env 文件或 `deploy/environments.json` 读，宿主片段读宿主文件；确需写死的位置登记在 `deploy/env/origin-exceptions.json` 并写理由（[RELEASE-PARITY](docs/conventions/RELEASE-PARITY.md) 第二节）。
- 域名、源站、桶、端口、开关等配置不写死在代码、工作流或宿主片段里：值只从该环境的 env 文件读取（缺值时失败关闭或保持同源，不回退到写死的地址）；测试夹具除外。
- 对齐的是接口和数据库表结构；数据不对齐，只对齐格式（用户、帖子、报名等内容各环境自有，不复制不同步）；没有任何页面调用的接口不留（[RELEASE-PARITY](docs/conventions/RELEASE-PARITY.md) 第九节）。
- 一个外部系统（GitLab、对象存储、邮件、数据库）同一时刻只有一个环境在写：切换写者先停旧的、核对停了，再开新的。2026-10-29 两个环境的 GitLab 同步同时开着，建出 6 个重复号（[事故复盘](docs/reviews/GITLAB-INCIDENT-2026-10.md)）。
- 预发布做过的每一件事，正式都要有对应动作：代码靠提交和 tag，表结构的手工步骤、数据格式、env 键与密钥、宿主配置、外部服务靠同构清单 `deploy/parity/ledger.json`（`node scripts/parity.mjs`）。`deploy-production.yml` 与 `deploy-hotfix.yml` 的 `parity` job 在清单还有 `pending` 时不构建、不部署；部署后 `smoke` job 核对线上，含内部赛事官网。hotfix 同样适用，豁免只能由所有者逐条批准，并留下批准摘要。
- 非密钥项（origin、host、端口、路径、开关）预填真实值；**密钥留空，真实值只存在于目标机 `.env.<环境>`**，由 CI/CD 用环境级 secrets 填充。
- 密钥不得入库、不得进镜像、不得进日志或发布记录。
- 部署只由发布 tag 触发（`deploy-preview.yml` / `deploy-production.yml`），部署开关默认关闭，未显式开启不部署。AI 不得自行部署、不得创建/推送/移动/删除发布 tag、不得修改版本号或镜像 tag、不得触发流水线。`hotfix-sync.mjs apply --preview-tag` 也是在创建发布 tag，同样要所有者对这个版本的授权，并用 `--tag-approval "<批准摘要>"` 写进 tag。
- 唯一的例外路径：GitHub 计划使部署 job 按设计失败关闭时，用 `scripts/deploy-manual.mjs` 从本机部署**同一发布 tag 由 CI 构建的镜像归档**，物料取自 tag 指向的提交，核对与 CI 相同（正式还要仓库里有「批准发布」评论）。它只能在这次发布已获授权之后运行，由经授权的人，或经明确授权的 agent 执行；不得用它部署未打 tag 的提交或本机构建的镜像。
- 发布 tag 不可移动、不可删除；创建发布 tag 需要对该版本号的明确授权，正式 tag 还需要对同一提交的预发布验收记录。
- 禁止用 systemd、pm2 或手工 `node` 进程替代 Docker 栈；禁止在目标机手工修改运行中的栈。
- 宿主层物料（systemd 单元、CDN 镜像、隧道看门狗）只经 `deploy/remote/install-host.sh` 由部署流水线安装并核对；GitLab 登录改接等一次性运维只经 `gitlab-cutover.yml`。开发者与 agent 不为了改线上而登录目标机，新的宿主操作先在仓库里补流水线路径和 CI 测试（[RELEASE-PARITY](docs/conventions/RELEASE-PARITY.md) 第十节）。

## 4. 证据硬门禁

- 每个改动都要有可复现的验证证据（命令 + 真实输出）；没验证就写「未验证」，不得写「应该没问题」。
- 未验证项必须在 MR 和审查结论里显式列出；未完成的环境验收不得标为 PASS。
- 类型检查、构建成功、mock 预览、浏览器验证、线上验收是不同证据，不能互相替代。见 [TESTING](docs/conventions/TESTING.md)。

## 5. 禁止事项（黑名单）

- 没读完第 0 节的规范就开始开发、安装依赖、跑脚本或操作数据。
- 在代码、工作流或宿主片段里写另一个环境的域名，或不写理由地扩大 `deploy/env/origin-exceptions.json`；预发布做了而正式没做就打正式 tag、派发 hotfix；把预发布的数据行或数据库文件复制到正式；用 `waive`、`not-applicable` 或改 `parity.mjs`、`smoke.json`、检查脚本绕过同构清单。
- 在代码、工作流或宿主片段里硬编码配置（域名、源站、桶、端口、开关），而不是从该环境的 env 文件读取；测试夹具除外。
- 在 `main` 上直接提交/推送，或让 task/dev 分支直接进 `main`。
- task 分支合并后残留死分支或死 worktree、合并后关联 issue 仍开着，或新建 `main`/`stage` 之外的长期分支。
- 在主工作区里切 task 分支开发，或在同一个 worktree 里做两个 issue。
- 把真实密钥、令牌、生产数据或完整 `.env` 写进仓库、镜像、日志、MR。
- 绕过或放宽 CI 与校验：`|| true`、`continue-on-error`、`[skip ci]`、删断言、改校验器、放宽既有校验来换绿色。
- 删除、覆盖或 reset 他人未提交的工作；在脏工作区自行 `reset`/`clean`/切分支。
- 用 systemd、pm2、手工进程替代 Docker 栈部署，或手工改目标机运行中的栈。
- 把 `proposed`/`historical` 文档当现行规范执行；规范冲突时自己挑一份照做而不报告。
- 伪造审查结论、验收证据、测试结果或审批记录。
- 不写执行记录就开发、合并或发布；改写、删除已写的记录，手填时间，或补写没发生过的事。
- 未经所有者对具体事项确认就新建、拆分、补建、重开或建立替代 issue，或把取消关闭写成已修复。
- 未经授权创建或推送发布 tag，或者移动、删除已推送的发布 tag。

## 6. 文档路由表

服务代码与文档严格对齐，一个服务一份契约；完整地图（含 `deploy/`、`docs/`、`scripts/` 行）见 [docs/README.md](docs/README.md)，冲突时以它为准：

| 服务目录 | 服务契约 | 管辖规范 |
|---|---|---|
| `app/server` | [docs/services/server/README.md](docs/services/server/README.md) | `MODULAR-DEVELOPMENT`、`API`、`SECURITY` |
| `app/web`（`sites/portal`、`shared`） | [docs/services/web/README.md](docs/services/web/README.md) | `DESIGN`、`STACK`、`TESTING` |
| `app/console`（极客班控制台，Vue 3 + Tuffex，根工作区 Node 22 / pnpm 9） | [docs/services/console/README.md](docs/services/console/README.md) | `DESIGN`、Tuffex 使用政策、`TESTING` |
| `app/forum`（上游 Nuxt/TuffEx，独立工具链 Node ≥26 / pnpm 11.24.0） | [docs/services/forum/README.md](docs/services/forum/README.md) | `TUFF-FORUM`、Tuffex 使用政策、`ADR-0003` |

新增服务 = 新增 `app/<service>` + 新增 `docs/services/<service>/README.md` + [docs/README](docs/README.md)「文档跟着模块改」对照表里加一行，缺一视为未完成；模块细节放同目录子文档。完整目录清单见生成物 [docs/INDEX.md](docs/INDEX.md)，不要手工编辑。

**工具适配器政策**：本仓只有 `AGENTS.md` 一个 agent 入口。`CLAUDE.md`、`GEMINI.md`、`CONVENTIONS.md`、`.clinerules`、`.cursorrules`、`.windsurfrules`、`.cursor/rules/*`、`.github/copilot-instructions.md` 以及所有模块级 `AGENTS.md` 一律不再保留（连指针也不留）。技能只有一个实现放在 `.agents/skills/`，其它 CLI 用自己的目录符号链接过去（`.omp/skills/<name>`、`.claude/skills/<name>`），禁止复制内容形成第二份规则。

接入或排查 OMP、Claude 的根入口加载时读 [AGENT-ADAPTERS](docs/conventions/AGENT-ADAPTERS.md)：使用已核验的加载方式，不另建入口文件。

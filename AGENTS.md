# Agent entry point — geek_main

> 本文件是仓库唯一的 agent 入口，只写规范与硬门禁。规则正文全部在 `docs/`，这里不写教程、不复制第二套规则。

## 0. 首步门禁：先确认分支，再读完规范

**AI / Agent 进入本仓库的第一件事是 `git branch --show-current`，然后按顺序读完下面这些文档；没读完不许动手。**

1. [docs 总入口](docs/README.md)
2. [AGENT-START](docs/conventions/AGENT-START.md)
3. [PROJECT](docs/conventions/PROJECT.md)
4. [BRANCHING](docs/conventions/BRANCHING.md)
5. [CONTRIBUTING](docs/conventions/CONTRIBUTING.md)
6. [TRACKING](docs/conventions/TRACKING.md)
7. [NOTES](docs/conventions/NOTES.md)
8. [CODE-REVIEW](docs/conventions/CODE-REVIEW.md)
9. [RELEASES](docs/conventions/RELEASES.md)

再按任务读取适用规范与服务契约（`docs/services/` 下的服务文档、[TESTING](docs/conventions/TESTING.md)、安全与运维文档等）。

读完之前禁止：编辑文件、安装依赖、执行项目脚本、操作业务数据、启动或停止服务、任何 Git 写操作（提交、推送、切分支、建分支、合并）。只允许读规范必需的只读操作：`git branch --show-current`、`git status`、读取文档。

文档被截断就继续读到完整；文件缺失、读不到或规范互相冲突时停下来报告阻塞，不凭记忆继续。上下文压缩或恢复后同样适用。

## 1. 分支硬门禁

**长期分支只有两条：`main`（正式）与 `stage`（预发布）；其余分支必须是短生命周期。**

- `stage` 必须包含 `main`：`git merge-base --is-ancestor origin/main origin/stage` 必须成功；`main` 不得领先 `stage`，写进 `main` 的提交必须已经存在于 `stage`。
- 禁止直接向 `main` 提交或推送；`main` 只能由 `stage` 合并进入。
- 分支名一律不用 `-`，只用 `/` 分层，段内多词用 `_`（正则见 [BRANCHING](docs/conventions/BRANCHING.md)）。
- 任务分支命名 `task/<issue>/<slug>`（例 `task/12/portal_redesign`），**只能从 `stage` 拉出**；MR 合并后必须立即删除，不得残留死分支。
- `dev/<github-username>`（例 `dev/crosery`）是个人自由开发区，不作为进入 `stage` 的凭据，也不部署。
- 推送分支不部署：push `stage`/`main` 只跑 CI。发版只靠打 tag：`vX.Y.Z-rc.N` 打在 `stage` 的提交上 → 预发布 `https://prev.yangtzeu.work`；`vX.Y.Z` 打在 `main` 的同一提交上 → 正式 `https://yangtzeu.work`。本机 localhost/127.0.0.1 只是本地开发，不是预发布。
- 规则存在不等于远程保护已生效：域名、环境文件或分支保护配置齐全，不代表 DNS、TLS、CI 或部署已经落地。

细节见 [BRANCHING](docs/conventions/BRANCHING.md)。

## 2. 工作流硬门禁

**先 issue → 从 `stage` 拉 task 分支 → MR 回 `stage` → 在 `stage` 的提交上打 `vX.Y.Z-rc.N` 发预发布 → 所有者验收 → `main` 快进到同一提交 → 打 `vX.Y.Z` 发正式。**

- **一件事 = 一个 issue = 一个 `task/<issue>/<slug>` 分支 = 一个 git worktree = 一个 PR**，生命周期跟着 issue 走（[TRACKING](docs/conventions/TRACKING.md)）。开工用 `node scripts/task.mjs start <issue> <slug>` 从最新 `stage` 建分支和独立 worktree，所有开发都在 worktree 里做，不在主工作区切分支；合并后 `node scripts/task.mjs finish <issue>` 删 worktree 与本地分支（[BRANCHING](docs/conventions/BRANCHING.md)「task worktree」）。开发前先按 [ISSUES](docs/conventions/ISSUES.md) 开 issue；PR 按 [PULL-REQUESTS](docs/conventions/PULL-REQUESTS.md) 的正文契约写（`Closes #<issue>`、解决链路、验收证据截图 / 录屏、人工验收步骤），CI 的 `pr-contract` 核对；**合并进 `stage` 即删分支、关 issue**，issue 与 PR 两边都要留记录。
- 每个阶段的进展以 [TRACKING](docs/conventions/TRACKING.md) §3 的「追踪记录」格式写成 issue / PR 评论；恢复上下文先读 issue 正文和最后几条追踪记录，不凭记忆续做。
- **执行记录前后必须写**（[NOTES](docs/conventions/NOTES.md)）：每一步按北京时间记进 `notes/<日期>/<GitHub 用户名>/<链路>.md`，入口是 `notes/INDEX.md`。开发前由 `task.mjs start` 记「开工」（要带 `GEEK_NOTES_USER` 与 `GEEK_NOTES_BY` 身份），开发中每次提交、开 PR、审查、返工都记，合并、发布、验收照记，`task.mjs finish` 记「收尾」。task PR 的链路缺「开工」「提交」「PR」「审查」时 CI 不通过，不能合并。
- 任何进入 `stage` 的内容必须走 [CODE-REVIEW](docs/conventions/CODE-REVIEW.md)：按 [code-review 技能](.agents/skills/code-review/SKILL.md) 逐项核对 diff，并把审查结论贴进 MR。**没有审查结论的 MR 不允许合并。**
- 进入 `main` 和打正式 tag 前，必须有所有者在预发布环境对同一提交的真实验收记录；自动化 PASS 只是机器验证，不能代替人工验证。
- 提交信息只遵循 [COMMITS](docs/conventions/COMMITS.md)；提交、推送、合并、打 tag、部署分别需要对应授权。发版流程、tag 规则与回滚见 [RELEASES](docs/conventions/RELEASES.md)。

## 3. 部署硬门禁

**每个环境一套完整 Docker 栈：`production` 与 `preview`，各自 compose、网络、卷，互不共享数据。**

- 环境变量只走 `deploy/env/.env.production` / `deploy/env/.env.preview`，由 `docker compose --env-file` 消费；不得另建环境文件或在别处定义第二份环境变量。
- 非密钥项（origin、host、端口、路径、开关）预填真实值；**密钥留空，真实值只存在于目标机 `.env.<环境>`**，由 CI/CD 用环境级 secrets 填充。
- 密钥不得入库、不得进镜像、不得进日志或发布记录。
- 部署只由发布 tag 触发（`deploy-preview.yml` / `deploy-production.yml`），部署开关默认关闭，未显式开启不部署。AI 不得自行部署、不得创建/推送/移动/删除发布 tag、不得修改版本号或镜像 tag、不得触发流水线。
- 唯一的例外路径：GitHub 计划使部署 job 按设计失败关闭时，用 `scripts/deploy-manual.mjs` 从维护者机器部署**同一发布 tag 由 CI 构建的镜像归档**，物料取自 tag 指向的提交，核对与 CI 相同（正式还要所有者在仓库里的「批准发布」评论）。它只能在所有者已授权这次发布之后运行，由维护者或经所有者明确授权的 agent 执行；不得用它部署未打 tag 的提交或本机构建的镜像。
- 发布 tag 不可移动、不可删除；创建发布 tag 需要所有者对该版本的明确授权，正式 tag 还需要所有者对同一提交的预发布验收记录。
- 禁止用 systemd、pm2 或手工 `node` 进程替代 Docker 栈；禁止在目标机手工修改运行中的栈。

## 4. 证据硬门禁

- 每个改动都要有可复现的验证证据（命令 + 真实输出）；没验证就写「未验证」，不得写「应该没问题」。
- 未验证项必须在 MR 和审查结论里显式列出；未完成的环境验收不得标为 PASS。
- 类型检查、构建成功、mock 预览、浏览器验证、线上验收是不同证据，不能互相替代。见 [TESTING](docs/conventions/TESTING.md)。

## 5. 禁止事项（黑名单）

- 没读完第 0 节的规范就开始开发、安装依赖、跑脚本或操作数据。
- 在 `main` 上直接提交/推送，或让 task/dev 分支直接进 `main`。
- task 分支合并后残留死分支或死 worktree，或新建 `main`/`stage` 之外的长期分支。
- 在主工作区里切 task 分支开发，或在同一个 worktree 里做两个 issue。
- 把真实密钥、令牌、生产数据或完整 `.env` 写进仓库、镜像、日志、MR。
- 绕过或放宽 CI 与校验：`|| true`、`continue-on-error`、`[skip ci]`、删断言、改校验器、放宽既有校验来换绿色。
- 删除、覆盖或 reset 他人未提交的工作；在脏工作区自行 `reset`/`clean`/切分支。
- 用 systemd、pm2、手工进程替代 Docker 栈部署，或手工改目标机运行中的栈。
- 把 `proposed`/`historical` 文档当现行规范执行；规范冲突时自己挑一份照做而不报告。
- 伪造审查结论、验收证据、测试结果或审批记录。
- 不写执行记录就开发、合并或发布；改写、删除已写的记录，手填时间，或补写没发生过的事。
- 未经所有者授权创建或推送发布 tag，或者移动、删除已推送的发布 tag。

## 6. 文档路由表

服务代码与文档严格对齐，一个服务一份契约；完整地图（含 `deploy/`、`docs/`、`scripts/` 行）见 [docs/README.md](docs/README.md)，冲突时以它为准：

| 服务目录 | 服务契约 | 管辖规范 |
|---|---|---|
| `app/server` | [docs/services/server/README.md](docs/services/server/README.md) | `MODULAR-DEVELOPMENT`、`API`、`SECURITY` |
| `app/web`（`sites/portal`、`shared`） | [docs/services/web/README.md](docs/services/web/README.md) | `DESIGN`、`STACK`、`TESTING` |
| `app/console`（极客班控制台，Vue 3 + Tuffex，根工作区 Node 22 / pnpm 9） | [docs/services/console/README.md](docs/services/console/README.md) | `DESIGN`、Tuffex 使用政策、`TESTING` |
| `app/forum`（上游 Nuxt/TuffEx，独立工具链 Node ≥26 / pnpm 11.24.0） | [docs/services/forum/README.md](docs/services/forum/README.md) | `TUFF-FORUM`、Tuffex 使用政策、`ADR-0003` |

新增服务 = 新增 `app/<service>` + 新增 `docs/services/<service>/README.md`，两处缺一视为未完成；模块细节放同目录子文档。完整目录清单见生成物 [docs/INDEX.md](docs/INDEX.md)，不要手工编辑。

**工具适配器政策**：本仓只有 `AGENTS.md` 一个 agent 入口。`CLAUDE.md`、`GEMINI.md`、`CONVENTIONS.md`、`.clinerules`、`.cursorrules`、`.windsurfrules`、`.cursor/rules/*`、`.github/copilot-instructions.md` 以及所有模块级 `AGENTS.md` 一律不再保留（连指针也不留）。技能只有一个实现放在 `.agents/skills/`，其它 CLI 用自己的目录符号链接过去（`.omp/skills/<name>`、`.claude/skills/<name>`），禁止复制内容形成第二份规则。

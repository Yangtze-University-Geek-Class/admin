# CI/CD 与部署控制

> 六工作流（ci / deploy-preview / deploy-production / branch-hygiene / issue-lifecycle / cert-watch）+ `.env` 驱动；发版只由发布 tag 触发（`vX.Y.Z-rc.N` → 预发布，`vX.Y.Z` → 正式），push 分支只跑 CI；部署开关默认关闭，机器检查不替代人工验收。

状态：`accepted` · 更新：2026-09-26 · 实施状态：工作流为 `.github/workflows/ci.yml`、`deploy-preview.yml`、`deploy-production.yml`、`branch-hygiene.yml`、`issue-lifecycle.yml`、`cert-watch.yml`，actionlint 全绿。两条部署工作流由 SemVer 发布 tag 触发（2026-09-24 所有者指令），此前「push `stage`/`main` 即部署」的触发方式已删除；更早的 `preview.yml`、`release.yml`（`release-*`/`prev-*` tag）也早已删除。首次上线（2026-09-25，#63）已配置：`preview` Environment 的环境级 secrets（部署 SSH、OAuth、会话与加密密钥；Turnstile 两项未配＝关闭）与 `DEPLOY_TARGET_ENVIRONMENT=preview`，目标机 `/opt/yzgc/preview`、`prev.yangtzeu.work` 证书与站点配置。组织是 GitHub 免费版、仓库私有，GitHub 文档写明免费版只能给**公开**仓库配置环境，所以 `production` 的审批无法配置，正式部署 job 按设计失败关闭，正式环境走下文「维护者机器部署」。这些前置条件都由维护者手工完成，任何工作流都不会自动创建。

发布规则以 [RELEASES](../conventions/RELEASES.md) 为唯一完整规范，分支模型以 [BRANCHING](../conventions/BRANCHING.md) 为准，环境字段契约见 [ENVIRONMENTS](ENVIRONMENTS.md)。

## 触发与职责

| 工作流 | 触发 | 行为 |
|---|---|---|
| `ci.yml` | PR → `main`/`stage`；push `main`/`stage`/`task/**`/`dev/**`（不含 tag）；`workflow_dispatch` | `branch-guard`（分支不变量）→ `core`（Node 22：check/test/build）∥ `forum`（Node ≥26：check/generate）∥ `env-contract`（`.env` 与 `environments.json`、compose 一致性，前端站点配置不含域名）∥ `docker`（`deploy/compose/{production,preview}.yml` 解析 + 三条镜像构建验证）→ `verify` 汇总 |
| `deploy-preview.yml` | push tag `v[0-9]+.[0-9]+.[0-9]+-rc.[0-9]+`；`workflow_dispatch`（必填 `tag`，并从同名 tag 运行） | 断言 ref 是 `refs/tags/vX.Y.Z-rc.N` → `release-policy` 规划（提交在 `origin/stage` 上、版本等于 `package.json`）→ 构建镜像 → 渲染 `.env.preview` → SSH 分发镜像与环境文件 → `deploy-stack.sh` → 健康检查 → 记录 deployment（payload 带 rc tag）。开关 `vars.DEPLOY_PREVIEW_ENABLED`；同一时刻只跑一个，不取消正在跑的运行 |
| `deploy-production.yml` | push tag `v[0-9]+.[0-9]+.[0-9]+`；`workflow_dispatch`（必填 `tag`，并从同名 tag 运行） | 断言 ref 是 `refs/tags/vX.Y.Z`（rc tag 被拒绝）→ `release-policy` 规划（提交在 `origin/main` 上、同一提交有 `vX.Y.Z-rc.N`）→ 证据检查（见下文）→ 构建镜像 → 分发 `.env.production` → 部署 → 记录 deployment。开关 `vars.DEPLOY_PRODUCTION_ENABLED`，`environment: production`，不取消正在跑的运行 |
| `branch-hygiene.yml` | PR `closed`（`merged == true`）、每周一 03:17 UTC、`workflow_dispatch` | 合并后删除 head 为 `task/**` 的本仓分支（`contents: write`，只删 `task/**`，**永不**自动删 `dev/**` 或长期分支）；每周巡检远端 `task/**`，对「14 天无提交活动且无 open PR」的残留分支只输出 `::warning::` 与 step summary，不删除 |
| `cert-watch.yml` | 每天 01:43 UTC、`workflow_dispatch`（都只在默认分支 `main` 上的文件生效，合入 `main` 后才开始） | 从公网用 `openssl s_client -verify_return_error -verify_hostname` 核对 `yangtzeu.work`、`prev.yangtzeu.work` 的证书：连不上、链不可信、名字不匹配或剩余不到总有效期的四分之一即失败（GitHub 通知维护者）。`permissions: {}`，不接触任何 secrets；续期本身由目标机的 certbot 负责，见 [DEPLOY](DEPLOY.md#证书续期与到期监控) |
| `issue-lifecycle.yml` | PR 指向 `stage` 的 opened / edited / synchronize / reopened / closed、每周一 03:37 UTC、`workflow_dispatch` | `pr-contract`：核对 PR 正文契约（`Closes #<issue>` 与 task 分支号一致、issue 存在且开着、九个必需段落、验收证据、审查结论；`scripts/pr-contract.mjs`，只检出默认分支上的脚本，不执行 PR 代码）；`close-on-merge`：合并进 `stage` 后关闭 issue 并在 issue 与 PR 上各留一条追踪记录（`issues: write`、`pull-requests: write`）；每周巡检「PR 已合并但 issue 还开着」「issue 开着但没有分支也没有 PR」，只告警 |

- **push `stage` 或 `main` 不部署任何环境**，只跑 `ci.yml`。部署只由发布 tag 触发，规则见 [RELEASES](../conventions/RELEASES.md)。GitHub 的 tag 过滤按整个 tag 名匹配：`deploy-production.yml` 的 `v[0-9]+.[0-9]+.[0-9]+` 不含 `-`，匹配不到 `vX.Y.Z-rc.N`；两条部署工作流的 plan job 还会用完整正则再断言一次，前导 0、`rc.0` 等格式也会被拒绝。
- 手工运行部署工作流时，「Use workflow from」必须选同一个发布 tag，并在 `tag` 输入框里填这个 tag；ref 与输入不一致即失败。手工运行只用于重新部署已有 tag，不创建 tag。
- 一次只推一个发布 tag：GitHub 在一次推送超过三个 tag 时不产生 push 事件，工作流不会运行。
- **打 tag 之前先等这个提交上 `ci.yml` 的 `verify (required check)` 跑完并通过。** 部署记录用 `required_contexts` 只要求这一项检查，它还在跑或没通过时，创建部署记录返回 409，部署 job 在这一步失败（`scripts/deploy-manual.mjs` 同样）。刚合并进 `stage` 的提交要等 push `stage` 触发的那次 CI 结束再打 rc tag。
- tag 推送触发的是**该 tag 所在提交里**的工作流文件；手工运行也按所选 tag 的工作流文件执行，但入口要求工作流文件已经存在于默认分支（`main`）。
- `dev/**` 只在 `ci.yml` 里做机器验证，不部署、不获得任何发布含义；PR 仍然只能指向 `main`/`stage`，`dev/**` 不得作为进入 `stage` 的凭据；旧的 `dev-*` 名字不再触发 `ci.yml`（见 [BRANCHING](../conventions/BRANCHING.md) 命名规则）。
- `branch-hygiene.yml` 是「合并后立即删除 task 分支」的执行者；它不创建 tag、不动 `main`/`stage`、不改 PR 状态，也不接触任何 secrets。巡检发现残留分支只告警，删除留给人工决定。

- `ci.yml` 顶层权限仅 `contents: read`，不挂载任何 secrets，不产出可部署产物。
- `branch-guard` 运行 `node scripts/check-branch-invariants.mjs`（`--require-remote-refs`）：核对两条不变量（`stage ≥ main`、`main` 不领先 `stage`）与分支命名卫生，并检查写入 `main` 的提交来源。不变量定义见 [BRANCHING](../conventions/BRANCHING.md)。同一脚本的 `--push` 模式还在本地 pre-push 里核对发布 tag（格式、所在分支、版本号、不可删除和移动）；`ci.yml` 不由 tag 触发，tag 的服务端核对在两条部署工作流的 plan job 里。
- `env-contract` 校验两份 `.env` 的字段契约（非密值必填、契约外字段拒绝、密钥必空、`PUBLIC_ORIGIN` 逐字等于环境 origin、两环境端口/域名必须不同）与 `deploy/environments.json`、compose 文件的一致性，并用 `pnpm check:site-config` 确认前端 `app.config.json` 不含任何域名（每个环境一个 origin，管理端按路径区分）。
- 部署工作流用 **build args** 把发布身份注入镜像：`GEEK_RELEASE_VERSION`（正式 `X.Y.Z`，预发布 `X.Y.Z-rc.N@<sha12>`）与 `GEEK_RELEASE_COMMIT`（完整 SHA），不写进 `.env`；展示规则见 [RELEASES](../conventions/RELEASES.md)。
- plan job 检出发布 tag（`fetch-depth: 0`，带全部分支与 tag），核对检出的 HEAD 就是 tag 指向的提交；build 与 deploy job 按 plan 输出的完整 SHA 检出，不再按 tag 名重新解析。
- **镜像名按环境分开**：`deploy-preview.yml` 构建并打包 `yzgc-preview/{server,web,forum}:<sha12>`，`deploy-production.yml` 构建并打包 `yzgc-production/{server,web,forum}:<sha12>`（仓库名来自 plan 输出的 `imageRepository`，归档名 `yzgc-images-<environment>-<sha12>.tar.gz`）。目标机的 `deploy-stack.sh` 在 `docker load` 之前读归档清单，出现别的仓库或别的 tag 就拒绝。`ci.yml` 的 `docker` job 按正式身份构建 `yzgc-production/*`，并用同一个 `IMAGE_TAG` 解析两套 compose，两边出现相同镜像引用即失败。
- `verify` 是单一 required check 输出，供分支保护引用；任一上游 job 失败即汇总为失败。不得用 `continue-on-error` 掩盖失败。
- **部署开关默认关闭**：`DEPLOY_PREVIEW_ENABLED`、`DEPLOY_PRODUCTION_ENABLED` 不设置即不部署；不设置时 `ci`/构建仍照常运行并产出镜像校验结果。取值必须逐字为 `enabled`。

## 环境身份

| 环境 | 发布 tag（提交所在分支） | GitHub Environment | 栈根 | 入口 |
|---|---|---|---|---|
| preview | `vX.Y.Z-rc.N`（`stage`） | `preview` | `/opt/yzgc/preview` | `https://prev.yangtzeu.work`（管理端 `/admin`、`/console`） |
| production | `vX.Y.Z`（`main`） | `production` | `/opt/yzgc/production` | `https://yangtzeu.work`（管理端 `/admin`、`/console`） |

[deploy/environments.json](../../deploy/environments.json) 是环境身份的唯一机器配置，两份 `.env` 的 `GEEK_DEPLOYMENT_ENVIRONMENT`、`GEEK_ENVIRONMENT_ORIGIN`、`STACK_ROOT`、`COMPOSE_PROJECT_NAME` 必须与之一致，由 `env-contract` 与实际部署脚本双重核对。两环境同机不同栈，不共享数据库、卷、密钥或 Cookie 域。

## 环境级 secrets / vars 清单

启用远程部署前必须由维护者逐项配置。两个环境用的是**同名**条目，环境级缺失时 GitHub 会静默回落到仓库级同名值，因此**不要在仓库级创建任何 `DEPLOY_*` 条目**。

### secrets（`preview`、`production` 各一套，取值必须不同）

| 名称 | 用途 |
|---|---|
| `DEPLOY_SSH_HOST` | 部署目标机地址 |
| `DEPLOY_SSH_PORT` | SSH 端口 |
| `DEPLOY_SSH_USER` | 部署用户 |
| `DEPLOY_SSH_KEY` | SSH 私钥全文 |
| `DEPLOY_SSH_KNOWN_HOSTS` | 目标机主机公钥行（`StrictHostKeyChecking=yes`） |
| `OAUTH_CLIENT_ID` | GitHub OAuth 应用（每个环境一个，Callback URL 为 `<origin>/auth/callback`，见 [ENVIRONMENTS](ENVIRONMENTS.md#github-oauth-app-回调地址)） |
| `OAUTH_CLIENT_SECRET` | GitHub OAuth 应用密钥 |
| `SESSION_SECRET` | 会话签名密钥（≥32 字符随机值） |
| `ENCRYPTION_KEY` | 32 字节密钥的 base64（GitHub token 加密） |
| `TURNSTILE_SITE_KEY` | Cloudflare Turnstile 站点键 |
| `TURNSTILE_SECRET_KEY` | Cloudflare Turnstile 服务端密钥 |

### vars

| 层级 | 名称 | 用途 |
|---|---|---|
| 环境级 | `DEPLOY_TARGET_ENVIRONMENT` | **反回落哨兵**：取值必须逐字等于所在环境名，两个 deploy job 都会核对，不等即失败并提示「环境级变量未配置或被仓库级值覆盖」 |
| 仓库级 | `DEPLOY_PREVIEW_ENABLED` | 取值 `enabled` 才运行 `deploy-preview` 的部署 job |
| 仓库级 | `DEPLOY_PRODUCTION_ENABLED` | 取值 `enabled` 才运行 `deploy-production` 的部署 job |

密钥只经环境级 secrets 注入渲染后的运行时 env 文件（`<栈根>/.env.<environment>`），**不写入仓库、镜像、日志或发布记录**；`deploy/env/.env.*` 模板中的密钥字段必须保持空值，由 `env-contract` 强制。

## 证据链与失败关闭

`deploy-production` 在构建前核对以下证据，任一缺失即失败关闭：

1. 正式 tag `vX.Y.Z` 所在提交上有同一 `X.Y.Z` 的 `vX.Y.Z-rc.N`（plan job 在带全部 tag 的检出里查找，evidence job 再核对一遍列表）；
2. 同一提交在 `preview` 环境有最新状态为 `success` 的 GitHub deployment 记录，且记录 payload 里的 `tag` 是上一条列出的 rc tag 之一（只按显式 deployment 记录判断；分支时代留下的、不带 tag 的旧记录不算）。部署 job 带 `environment: preview`，GitHub Actions 会为它另建一条不带 payload 的记录（ref 是 tag 名），并在 job 结束时置为 `success`，比工作流自己的记录晚几秒；GitHub 文档说新的 `success` 会把同一环境更早的成功记录置为 `inactive`，但 2026-09-25 实测（#69，`gh api repos/<仓库>/deployments/<id>/statuses`）没有发生：`v0.1.0-rc.3`、`rc.4`、`rc.5` 工作流建的记录在自动记录置 success 之后、以及后续 rc 部署成功之后，最新状态仍是 `success`，GraphQL 的 `state` 仍是 `ACTIVE`。所以这里只看最新状态；两条部署工作流和 `deploy-manual.mjs` 自己发的状态一律带 `-F auto_inactive=false`，不会把旧记录置为 `inactive`；
3. `https://prev.yangtzeu.work/release.json` 的 `environment` 是 `preview`，`commit` 是这个提交，`version` 是其中一个 rc 的 `X.Y.Z-rc.N@<sha12>`（`release.json` 由 web 镜像内置）：避免把「上一个预发布通过」推广到未经试用的新代码；
4. `production` GitHub Environment 已配置审批要求（部署 job 用 REST 实测 protection rules，不信任 YAML 里写了 `environment: production` 这一行）；
5. `DEPLOY_TARGET_ENVIRONMENT` 等于 `production`（防环境级变量回落）。

正式构建与预发布构建是同一提交、不同 build args 的两次构建，镜像 digest 不同，所以两者放在不同的镜像仓库里（见上文「镜像名按环境分开」）；工作流目前**不**比对两者的镜像内容。上述都是机器一致性检查，**不构成、也不能代替** [RELEASES](../conventions/RELEASES.md) 要求的人工试用与明确批准。

部署 job 的失败关闭行为：镜像 sha256 校验失败、env 校验失败、SSH 失败或健康门失败都让整条流水线失败，**不自动重试到未知状态**。部署脚本内部在 `docker compose up -d` 失败或健康门失败时（两者走同一条路，见 [DEPLOY](DEPLOY.md)「失败即回滚」）会把 `IMAGE_TAG` 切回部署前的值、重新 `compose up -d` 并复检，结果记为 `ROLLED_BACK`（复检也失败记 `ROLLBACK_FAILED`）——这是脚本的环境自愈，不等于发布成功，也不改变「流水线失败」的结论；不写 `approved=true` 之类的放行状态，不自动覆盖更晚的部署。

## 需要人工完成的前置条件

1. **GitHub Environment**：创建 `preview`、`production`；`production` 必须配置 required reviewers（若计划不支持私有仓库的该能力，见下）；deployment branches and tags 建议只放行发布 tag（`v*`），只做粗筛；rc 与正式的精确区分以两条部署工作流 plan job 的正则为准，禁止自批。
2. **环境级 secrets/vars**：按上表配置两套，取值互不相同。
3. **目标机**：安装 Docker 与 Compose v2；创建 `/opt/yzgc/production`、`/opt/yzgc/preview`（属部署用户）；宿主机 nginx 安装 `deploy/nginx/{production,preview}.conf`（`yangtzeu.work`、`prev.yangtzeu.work` 两个入口，外加 `github.yangtzeu.work` 的 301）；certbot 证书就绪。
4. **DNS 与 OAuth**：`prev.yangtzeu.work` 的 A 记录已指向同一主机（2026-09-24 核对），不需要管理端子域；两个环境的 GitHub OAuth App Callback URL 分别为 `https://yangtzeu.work/auth/callback`、`https://prev.yangtzeu.work/auth/callback`。
5. **仓库级开关**：确认第 1–4 步与一次手工演练通过后，才把 `DEPLOY_PREVIEW_ENABLED` 设为 `enabled`；正式部署开关在预发布稳定运行且人工验收流程跑通后再打开。

### 平台能力实测（2026-09-13，`gh api` 只读核对）

- 组织 `Yangtze-University-Geek-Class` 的 `plan.name` 实测为 `free`；仓库 `admin` 实测为 `private`。
- `GET /repos/{owner}/{repo}/rulesets` 与 `GET /repos/{owner}/{repo}/branches/main/protection` 均返回 `403`（`Upgrade to GitHub Pro or make this repository public…`）：`main` 与 tag 的 refs 保护在当前计划下配置不了。
- `GET /repos/{owner}/{repo}/environments` 的 `total_count` 实测为 `0`：`preview`、`production` 两个 Environment 都尚未创建。

结论：在**计划升级**或**改用受控外部审批**之前，`production` 的人工门禁无法启用；此时 `DEPLOY_PRODUCTION_ENABLED` 必须保持关闭，正式发布由人手工执行已验证产物。不得以此为由取消人工验收、伪造审批记录，也不得为了解锁功能把私有仓库公开。以上为 2026-09-13 的实测快照，启用前必须重新核对。

## 维护者机器部署（免费版的退路）

免费版的私有仓库可以建环境、存环境级 secrets（运行时能否注入还没实测），但配不了审批。`deploy-production` 的部署 job 有两种结局：开关 `DEPLOY_PRODUCTION_ENABLED` 关闭时**跳过**；打开时在「production 环境保护」核对处**失败关闭**。这是正确行为，不得放宽。两种情况下 build job 都会产出镜像归档（正式保留 30 天，预发布保留 7 天，过期要重新运行工作流）。正式环境（以及 `preview` 的部署 job 拿不到 secrets 时的预发布）改用 `scripts/deploy-manual.mjs` 从维护者机器部署；谁可以运行见 [AGENTS](../../AGENTS.md) §3 与 [RELEASES](../conventions/RELEASES.md)「授权门禁」。步骤与 CI 的 deploy job 一一对应，**一切部署物料取自 tag 指向的提交**，不取当前工作区：

1. 进程环境里的 `DEPLOY_TARGET_ENVIRONMENT` 必须等于 `--environment`（对应 CI 的环境哨兵，防止导出的是另一个环境的密钥）；仓库取自 `origin` 远端。
2. `git archive <提交> deploy scripts package.json` 解到临时目录（不是 Git 仓库，所以 `--check` 会打两条「无法通过 git check-ignore 判定」的警告，这是预期的：物料来自 `git archive`，必然是入库文件），用**这一份**的 `release-policy` 规划（与工作流同一个 `--branch-ref`、`--require-tag`，`--root` 指向这份物料）并跑环境契约 `--check`；rc tag 只能进 `preview`，正式 tag 只能进 `production`。`DEPLOY_SSH_HOST/PORT/USER` 必须与这份物料里该环境模板的 `DEPLOY_HOST/PORT/USER` 一致。
3. 正式环境先核对所有者批准：`--acceptance` 必须是本仓库 issue 或 PR 里的一条评论链接（评论确实在链接写的那个编号下），作者是仓库管理员，**没有被编辑过**（按 GraphQL `IssueComment.lastEditedAt` 判断，表情回应不算编辑；有写权限的人能改别人的评论而作者不变，编辑过就请所有者重新发一条）、没有被折叠隐藏（`isMinimized`），发在预发布部署成功之后，并且**整条评论只有一行** `批准发布 vX.Y.Z`（CRLF 当作 LF，末尾的空格、制表符与换行不算，别的一个字符都不能多：`v` 不能省，不能加句号，不能用全角空格，前面不能有缩进或空行，不能加粗、放进引用、代码块或 HTML，不能再写一句试用结论，「暂不批准发布」、只写 rc 的都不算）。这是白名单：脚本不去推测 GitHub 怎么渲染 Markdown 与 HTML，#69 第一轮审查找出了十几种页面上看不到、或和别的字连在一起，却能被逐行规则接受的写法。试用结论、验收记录（[RELEASE-ACCEPTANCE-TEMPLATE](RELEASE-ACCEPTANCE-TEMPLATE.md)）写在别的评论里，批准另发一条只写这一行的新评论；再重做证据 job 的三项核对（同一提交上有同版本的 rc tag、`preview` 有 payload.tag 为这些 rc 之一且最新状态 `success` 的部署记录、`https://prev.yangtzeu.work/release.json` 就是这个提交的 rc 版本）。都在下载之前。
4. 找到这个 tag 的 push 触发的 `deploy-<environment>.yml` 运行（tag 名与提交都要对上、build job 成功），用 `gh run download` 取镜像归档，**先在本机流式核对 sha256**；从不在本机或目标机构建镜像。
5. 用这份物料里的 `render` 在临时目录渲染 0600 的运行时 env：密钥只经 render 的子进程环境传入（其它子进程的环境里去掉了密钥），不进命令行；子进程都用和脚本同一个 Node（`process.execPath`）；临时目录在结束、出错或 Ctrl-C 时删除。SSH 用 `-F none`、只认 `DEPLOY_SSH_KNOWN_HOSTS_FILE`、`StrictHostKeyChecking=yes`。
6. 写 GitHub 部署记录（payload 键与 CI 相同，正式另有 `preview_tags`，另加 `deployed_from: "maintainer"` 与批准链接；与两条部署工作流一样用 `required_contexts=["verify (required check)"]`：GitHub 默认要求提交上的全部检查都已通过，会把正在运行或已失败的部署 job 也算进去而一直返回 409，`v0.1.0-rc.1` 首次部署时实测；与工作流一样显式 `-F auto_merge=false`，不让 GitHub 去合并默认分支，状态一律 `-F auto_inactive=false`，见上文「证据链」第 2 条），把这份物料里的 compose 与 `deploy-stack.sh` 分发到同样的远端路径，运行同样参数的 `deploy-stack.sh`，按结果把记录置为 `success` / `failure`。

`--dry-run` 做完核对、下载与渲染后停下，不连目标机、不写记录。脚本不创建、不移动 tag，也不替代所有者在预发布上的试用与批准。编排顺序（先核对后下载、物料来自该提交、dry-run 不连目标机、失败置 failure 并清理）由 `tests/tooling/deploy-manual.test.ts` 用注入的假依赖核对；批准评论的白名单正反例（含第一轮审查的全部反例）、评论编辑状态的解析和部署记录的参数（含两条工作流的写法）也在同一个文件里。

## 自托管 runner

组织是免费版、仓库私有：托管 runner 每月 2000 分钟，支出上限 $0。额度用完后所有 job 都报 `The job was not started because recent account payments have failed or your spending limit needs to be increased`（2026-09-25 实测），`verify (required check)` 出不来，也就打不了 rc tag。自托管 runner 不计分钟数，所以 CI 改到维护者家里的机器上跑（#93；所有者 2026-09-26 决定仓库保持私有）。

| 项 | 取值 |
|---|---|
| 宿主机 | crosery-arch（Arch Linux，Ryzen 7 8845H 16 线程 / 30G 内存），维护者家里 |
| 隔离 | 非特权 incus 系统容器 `yzgc-runner`（Ubuntu 24.04，`security.nesting=true`，容器里有自己的 Docker），限 8 线程、16G 内存；存储池是 80G 的 btrfs 镜像文件，放在单独的子卷 `/var/lib/incus`，不进宿主机的 snapper 快照 |
| 注册 | 只注册到本仓库；两个实例 `crosery-arch-1`、`crosery-arch-2`，一个 PR 的 push 与 pull_request 两次运行可以同时跑；标签 `yzgc-arch` |
| 出站 | incus 网络 ACL `runner-egress` 拒绝容器访问 `10.0.0.0/8`、`172.16.0.0/12`、`192.168.0.0/16`、`100.64.0.0/10`、`169.254.0.0/16`（家里局域网、tailscale、netbird、宿主机与它的 Docker 网桥），其余放行 |
| 预装 | 对齐 ubuntu-latest 里工作流直接用到的工具：Node 22 LTS（`branch-guard`、`docker`、`pr-contract` 不经 setup-node 直接调 `node`，官方包按 SHASUMS256 校验）、git、gh、jq、shellcheck、openssl、Docker + buildx + compose。新工作流用到别的预装工具时，先在容器里装上再切过来 |
| 镜像源 | 家里连不上 Docker Hub，容器内 Docker 走 `docker.m.daocloud.io`、`docker.1ms.run` 镜像加速 |
| 清理 | 容器内定时器每天清掉 72 小时前的镜像与构建缓存 |

**重建**：机器上的步骤都在 [deploy/runner/](../../deploy/runner/)，每一份都能重复执行。宿主机 root 跑 `host-setup.sh`（incus 初始化、网桥、ACL、放行 Docker 的 FORWARD、建容器）；把 `container-setup.sh`、`register.sh` 用 `incus file push` 放进容器，先跑前者（工具、Docker、Node、runner 用户，runner 安装包按官方 SHA256 校验），再按 `register.sh` 开头的写法把注册令牌经环境变量传进去注册两个实例。宿主机的 incus 包按本机软件源索引的版本安装，不做部分升级。

**切换**：仓库变量 `CI_RUNNER=yzgc-arch` 时，`ci`、`branch-hygiene`、`issue-lifecycle`、`cert-watch` 跑在这台机器上；删掉变量就回到 `ubuntu-latest`（额度恢复或支出上限调高之后）。两条部署工作流读另一个变量 `DEPLOY_RUNNER`，默认不设：部署 job 会拿到环境级 secrets（部署私钥等），要不要放到这台机器上跑，由所有者单独决定。

**掉线**：机器断电、断网或关机时，job 排队等 runner 回来；排队超过 24 小时没被领取的 job 由 GitHub 判失败。机器恢复后重跑，或者临时删掉 `CI_RUNNER`。

**安全边界**：

- 只有能向本仓库推分支的人能让 job 跑到这台机器上（私有仓库，没有 fork PR）。job 在容器里以普通用户 `runner` 运行，能用容器里的 Docker（相当于容器内 root），但容器是非特权的，拿不到宿主机的 root、家目录、SSH 材料、凭据和数据库，所以满足下文「自托管运行器不得接在有生产凭据或真实数据的机器上」的要求。
- 容器里除 runner 自己的注册凭据外不放任何密钥。runner 自动更新保持开启（版本落后太多时 GitHub 不再派发 job）。
- 镜像加速源是第三方服务：CI 只用它构建验证用的镜像，不产出部署物；部署镜像仍在托管 runner 上构建，除非打开 `DEPLOY_RUNNER`。

## 明确不做的事

- 任何工作流都不自动创建/移动/删除 tag，不自动升级 `package.json` 版本，不写放行状态；发布 tag 由维护者在所有者授权后手工创建。
- 不从 `pull_request_target` 触发，不给 fork/PR 构建授予部署 secrets；自托管运行器不得接在有生产凭据或真实数据的机器上执行不可信 PR（现有的自托管 runner 怎么满足这一条，见上文「自托管 runner」）。
- 不把 `.tools`、真实数据库、`.env`、SSH 材料、内部文档或浏览器状态打进镜像、缓存或日志。
- 机器 PASS（`pnpm verify`、CI 全绿）不构成人工验收记录，也不授权任何部署或发版动作。
- 不把 `stage` 分支的推送当作任何环境的部署：正式部署必须能追到同一提交的 rc tag、成功的预发布部署记录与人工试用结论。

## 双工具链

核心按根 manifest/锁文件使用 Node 22 + pnpm 9.15.9；论坛按独立 manifest/锁文件使用 Node ≥26 + pnpm 11.24.0。分别安装、分别运行现有测试，避免用一套 Node 运行另一 ABI 的原生 SQLite 模块。CI 使用临时测试库和虚构数据；线上目标为 Linux，不上传 Mac 原生依赖。

## 官方依据

核对日期：2026-09-13。平台行为依据（不代表远程设置已完成）：

- https://docs.github.com/en/actions/reference/workflows-and-actions/workflow-syntax — 事件/ref 过滤、权限与并发。
- https://docs.github.com/en/actions/how-tos/deploy/configure-and-manage-deployments/manage-environments — 环境保护、秘密放行、自动创建环境及私有仓库计划限制。
- https://docs.github.com/en/repositories/configuring-branches-and-merges-in-your-repository/managing-rulesets/about-rulesets — 分支保护。

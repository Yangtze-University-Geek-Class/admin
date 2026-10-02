# CI/CD 与部署控制

> 六工作流（ci / deploy-preview / deploy-production / branch-hygiene / issue-lifecycle / cert-watch）+ `.env` 驱动；发版只由发布 tag 触发（`vX.Y.Z-rc.N` → 预发布，`vX.Y.Z` → 正式），push 分支只跑 CI；部署开关默认关闭，机器检查不替代人工验收。

状态：`accepted` · 更新：2026-10-02 · 实施状态：工作流为 `.github/workflows/ci.yml`、`deploy-preview.yml`、`deploy-production.yml`、`branch-hygiene.yml`、`issue-lifecycle.yml`、`cert-watch.yml`，actionlint 全绿，所有 job 只跑在 GitHub 托管 runner 上（见下文「运行位置」）。两条部署工作流由 SemVer 发布 tag 触发（2026-09-24 所有者指令），此前「push `stage`/`main` 即部署」的触发方式已删除；更早的 `preview.yml`、`release.yml`（`release-*`/`prev-*` tag）也早已删除。首次上线（2026-09-25，#63）已配置：`preview` Environment 的环境级 secrets（部署 SSH、OAuth、会话与加密密钥；Turnstile 两项未配＝关闭）与 `DEPLOY_TARGET_ENVIRONMENT=preview`，目标机 `/opt/yzgc/preview`、`prev.yangtzeu.work` 证书与站点配置。组织是 GitHub 免费版；仓库原本私有，2026-09-26 17:49 所有者因 CI 排队决定公开（见下文「平台能力实测」的更新）。公开之后 `production` 的 required reviewers 才能配置；2026-09-27 所有者建了 `production` Environment，配了 required reviewers（审批人 Crosery）与自定义部署分支规则，并打开 `DEPLOY_PRODUCTION_ENABLED`，`v0.1.0` 的正式部署由 `deploy-production.yml` 在审批后跑完（运行 36314912545）。下文「维护者机器部署」只在部署 job 拿不到环境时作退路。这些前置条件都由维护者手工完成，任何工作流都不会自动创建。

发布规则以 [RELEASES](../conventions/RELEASES.md) 为唯一完整规范，分支模型以 [BRANCHING](../conventions/BRANCHING.md) 为准，环境字段契约见 [ENVIRONMENTS](ENVIRONMENTS.md)。

## 触发与职责

| 工作流 | 触发 | 行为 |
|---|---|---|
| `ci.yml` | PR → `main`/`stage`；push `main`/`stage`/`task/**`/`dev/**`（不含 tag）；`workflow_dispatch` | `branch-guard`（分支不变量；task 分支的 PR 另查执行记录与本 PR 的文档同步）→ `core`（Node 22：check/test/build，检出完整历史）∥ `forum`（Node ≥26：check/generate）∥ `env-contract`（`.env` 与 `environments.json`、compose 一致性，前端站点配置不含域名）∥ `docker`（`deploy/compose/{production,preview}.yml` 解析 + 三条镜像构建验证）∥ `docker-cdn`（静态资源 CDN 开关打开时的 web、forum 镜像构建，再像部署工作流一样取出产物、`static-cdn.mjs plan` 列上传清单，不上传，见下文「静态资源 CDN」）→ `verify` 汇总 |
| `deploy-preview.yml` | push tag `v[0-9]+.[0-9]+.[0-9]+-rc.[0-9]+`；`workflow_dispatch`（必填 `tag`，并从同名 tag 运行） | 断言 ref 是 `refs/tags/vX.Y.Z-rc.N` → `release-policy` 规划（提交在 `origin/stage` 上、版本等于 `package.json`）→ 文档同步（tag 指向的提交，见下文）→ `cdn-plan` 决定静态资源 CDN 开关 → 构建镜像 → `cdn-upload` 上传并核对带哈希的静态文件（开关关闭时只报告状态，见下文「静态资源 CDN」）→ 渲染 `.env.preview` → SSH 分发镜像与环境文件 → `deploy-stack.sh` → 健康检查 → 记录 deployment（payload 带 rc tag）。开关 `vars.DEPLOY_PREVIEW_ENABLED`；同一时刻只跑一个，不取消正在跑的运行 |
| `deploy-production.yml` | push tag `v[0-9]+.[0-9]+.[0-9]+`；`workflow_dispatch`（必填 `tag`，并从同名 tag 运行） | 断言 ref 是 `refs/tags/vX.Y.Z`（rc tag 被拒绝）→ `release-policy` 规划（提交在 `origin/main` 上、同一提交有 `vX.Y.Z-rc.N`）→ 文档同步（tag 指向的提交，见下文）→ 证据检查（见下文）→ `cdn-plan` → 构建镜像 → `cdn-upload` → 分发 `.env.production` → 部署 → 记录 deployment。开关 `vars.DEPLOY_PRODUCTION_ENABLED`，`environment: production`，不取消正在跑的运行 |
| `branch-hygiene.yml` | PR `closed`（`merged == true`）、每周一 03:17 UTC、`workflow_dispatch` | 合并后删除 head 为 `task/**` 的本仓分支（`contents: write`，只删 `task/**`，**永不**自动删 `dev/**` 或长期分支）；每周巡检远端 `task/**`，对「14 天无提交活动且无 open PR」的残留分支只输出 `::warning::` 与 step summary，不删除 |
| `cert-watch.yml` | 每天 01:43 UTC、`workflow_dispatch`（都只在默认分支 `main` 上的文件生效，合入 `main` 后才开始） | 从公网用 `openssl s_client -verify_return_error -verify_hostname` 核对 `yangtzeu.work`、`prev.yangtzeu.work` 的证书：连不上、链不可信、名字不匹配或剩余不到总有效期的四分之一即失败（GitHub 通知维护者）。`permissions: {}`，不接触任何 secrets；续期本身由目标机的 certbot 负责，见 [DEPLOY](DEPLOY.md#证书续期与到期监控) |
| `issue-lifecycle.yml` | PR 指向 `stage` 的 opened / edited / synchronize / reopened / closed、每天 03:37 UTC、`workflow_dispatch`（可勾「只读」） | `pr-contract`：核对 PR 正文契约（`Closes #<issue>` 与 task 分支号一致、issue 存在且开着、九个必需段落、验收证据、审查结论；`scripts/pr-contract.mjs`，只检出默认分支上的脚本，不执行 PR 代码）；`close-on-merge`：合并进 `stage` 后关闭 issue 并在 issue 与 PR 上各留一条追踪记录（`issues: write`、`pull-requests: write`）；`sweep` 每天巡检（`scripts/issue-sweep.mjs`，规则见 [TRACKING](../conventions/TRACKING.md) §1）：关联 PR 已合并进 `stage` 还开着的 issue 自动关闭并留「关闭」记录（合并后重开过的、还有开着的 PR 的、合并不到一小时的不关），14 天没动静的留「超期」记录，14 天内关闭却没有合并 PR 也没有「关闭」记录的留「缺记录」，不重开（`issues: write`，只检出两个脚本）。定时任务只跑默认分支 `main` 上的文件，合入 `main` 之前仍是旧的每周只告警 |

- **push `stage` 或 `main` 不部署任何环境**，只跑 `ci.yml`。部署只由发布 tag 触发，规则见 [RELEASES](../conventions/RELEASES.md)。GitHub 的 tag 过滤按整个 tag 名匹配：`deploy-production.yml` 的 `v[0-9]+.[0-9]+.[0-9]+` 不含 `-`，匹配不到 `vX.Y.Z-rc.N`；两条部署工作流的 plan job 还会用完整正则再断言一次，前导 0、`rc.0` 等格式也会被拒绝。
- 手工运行部署工作流时，「Use workflow from」必须选同一个发布 tag，并在 `tag` 输入框里填这个 tag；ref 与输入不一致即失败。手工运行只用于重新部署已有 tag，不创建 tag。
- 一次只推一个发布 tag：GitHub 在一次推送超过三个 tag 时不产生 push 事件，工作流不会运行。
- **打 tag 之前先等这个提交上 `ci.yml` 的 `verify (required check)` 跑完并通过。** 部署记录用 `required_contexts` 只要求这一项检查，它还在跑或没通过时，创建部署记录返回 409，部署 job 在这一步失败（`scripts/deploy-manual.mjs` 同样）。刚合并进 `stage` 的提交要等 push `stage` 触发的那次 CI 结束再打 rc tag。
- tag 推送触发的是**该 tag 所在提交里**的工作流文件；手工运行也按所选 tag 的工作流文件执行，但入口要求工作流文件已经存在于默认分支（`main`）。
- `ci.yml` 的旧运行（#124）：同一 PR 或同一个 `task/**`、`dev/**` 分支推了新提交，旧提交还没跑完的运行自动取消，runner 让给新提交。被取消的运行因为 `verify` 是 `if: always()`（跳过会被当成通过，不能去掉），还会排一个 `verify` job，最后以 failure 或 cancelled 结束（runner 都忙时它会先显示排队中）。push `main`、`stage` 的运行不取消正在跑的；但同一组里已经有一个在排队时，GitHub 会取消排队中的那一次（默认 `queue: single`），连续合并三次以上时中间的提交可能没有 `verify`：打 rc tag 前先确认这个提交上的 `verify (required check)`，没有就重跑那次运行。
- `dev/**` 只在 `ci.yml` 里做机器验证，不部署、不获得任何发布含义；PR 仍然只能指向 `main`/`stage`，`dev/**` 不得作为进入 `stage` 的凭据；旧的 `dev-*` 名字不再触发 `ci.yml`（见 [BRANCHING](../conventions/BRANCHING.md) 命名规则）。
- `branch-hygiene.yml` 是「合并后立即删除 task 分支」的执行者；它不创建 tag、不动 `main`/`stage`、不改 PR 状态，也不接触任何 secrets。巡检发现残留分支只告警，删除留给人工决定。

- `ci.yml` 顶层权限仅 `contents: read`，不挂载任何 secrets，不产出可部署产物。
- `branch-guard` 运行 `node scripts/check-branch-invariants.mjs`（`--require-remote-refs`）：核对两条不变量（`stage ≥ main`、`main` 不领先 `stage`）与分支命名卫生，并检查写入 `main` 的提交来源。不变量定义见 [BRANCHING](../conventions/BRANCHING.md)。同一脚本的 `--push` 模式还在本地 pre-push 里核对发布 tag（格式、所在分支、版本号、不可删除和移动）；`ci.yml` 不由 tag 触发，tag 的服务端核对在两条部署工作流的 plan job 里。
- **文档跟着模块改**（对照表与规则见 [docs/README](../README.md)「文档跟着模块改」，`scripts/check-doc-sync.mjs`）：`core` 的 `pnpm check` 里有 `check:doc-sync`：PR 运行时检出的是 GitHub 做的合并提交，push `stage`/`main`/`dev/**` 时是分支本身，都按第一父链的时间比较每一对模块与文档；push `task/**` 时按 PR 对 `origin/stage` 核对。检出写 `fetch-depth: 0`，浅克隆直接失败。`branch-guard` 在 task 分支进 `stage` 的 PR 上再跑 `--base origin/stage --head <task 分支>`：merge-base 以来动了模块，就要改对应文档的说明，或者在这个 task 的执行记录里写文档核对（`--head` 用来找到这个 task 的执行记录，检出的合并提交上没有分支名）。第一父链的比较依赖 PR 只用 merge commit 进 `stage`（[BRANCHING](../conventions/BRANCHING.md)）。改 `.github/workflows/` 就要同时改本文档；改 `deploy/` 就要改 [DEPLOY](DEPLOY.md)、[ENVIRONMENTS](ENVIRONMENTS.md) 或本文档里对应的说明（三份里至少动一份，改哪份看改了什么）。
- **发版时在 tag 指向的提交上再核对一次文档同步**（#192）：两条部署工作流的 plan job 在 `release-policy` 规划与环境契约之后、任何构建之前跑「文档同步（发布 tag 指向的提交）」：先核对检出的 HEAD 就是 tag 指向的提交，再运行 `node scripts/check-doc-sync.mjs`。检出的是 tag（detached HEAD，没有分支名），脚本按第一父链的时间核对，与 push `stage` 时 `core` 里 `pnpm check` 的规则相同；完整历史来自 plan 检出的 `fetch-depth: 0`，浅克隆直接失败。脚本只用 Node 内置模块，plan job 只按 `.nvmrc` 装 Node，不装依赖。不通过 plan 就失败，后面每个 job 都 `needs: plan`，不构建、不上传 CDN、不部署；`scripts/deploy-manual.mjs` 只认 build 成功的运行，也部署不了。不通过时按报错在 `stage` 上补文档，再在补好的提交上打下一个 rc。rc tag 打在 `stage` 的合并提交上时比的是 `stage` 的第一父链；打在 PR 里面的某个提交上时比的是那条 task 分支的直线历史，模块提交排在文档提交后面就报不同步。这一步只在包含它的提交上生效：tag 触发的是 tag 所在提交里的工作流文件。`tests/tooling/deploy-doc-sync.test.ts` 核对两条工作流都有这一步、在 plan job 里、排在完整历史的 tag 检出与 Node 安装之后、没有条件和吞掉失败的写法、其它 job 都 `needs: plan`，并在临时仓库里照工作流的写法跑这一步：不同步的提交失败，同步的通过，HEAD 不是 tag 的提交或浅克隆都失败。
- `env-contract` 校验两份 `.env` 的字段契约（非密值必填、契约外字段拒绝、密钥必空、`PUBLIC_ORIGIN` 逐字等于环境 origin、两环境端口/域名必须不同）与 `deploy/environments.json`、compose 文件的一致性，并用 `pnpm check:site-config` 确认前端 `app.config.json` 不含任何域名（每个环境一个 origin，管理端按路径区分）。
- 部署工作流用 **build args** 把发布身份注入镜像：`GEEK_RELEASE_VERSION`（正式 `X.Y.Z`，预发布 `X.Y.Z-rc.N@<sha12>`）与 `GEEK_RELEASE_COMMIT`（完整 SHA），不写进 `.env`；展示规则见 [RELEASES](../conventions/RELEASES.md)。
- plan job 检出发布 tag（`fetch-depth: 0`，带全部分支与 tag），核对检出的 HEAD 就是 tag 指向的提交；build 与 deploy job 按 plan 输出的完整 SHA 检出，不再按 tag 名重新解析。
- **镜像名按环境分开**：`deploy-preview.yml` 构建并打包 `yzgc-preview/{server,web,forum}:<sha12>`，`deploy-production.yml` 构建并打包 `yzgc-production/{server,web,forum}:<sha12>`（仓库名来自 plan 输出的 `imageRepository`，归档名 `yzgc-images-<environment>-<sha12>.tar.gz`）。目标机的 `deploy-stack.sh` 在 `docker load` 之前读归档清单，出现别的仓库或别的 tag 就拒绝。`ci.yml` 的 `docker` job 按正式身份构建 `yzgc-production/*`，并用同一个 `IMAGE_TAG` 解析两套 compose，两边出现相同镜像引用即失败；`docker-cdn` 在另一个 runner 上按同样的身份、打开静态资源 CDN 开关再构建 web、forum 两个镜像。
- `verify` 是单一 required check 输出，供分支保护引用；任一上游 job 失败即汇总为失败。不得用 `continue-on-error` 掩盖失败。
- **现在没有任何分支保护或 ruleset 引用 `verify`**（2026-10-02 只读核对：`gh api repos/Yangtze-University-Geek-Class/admin/rulesets` 返回 `[]`，`stage`、`main` 的 `branches/<分支>/protection` 都返回 404 `Branch not protected`）。名字里的 required 不是 GitHub 意义上的必需检查：CI 报红不会自动拦住合并，直推 `stage`/`main`（hot-fix 合回）也不经过 PR 检查。例：`9b38684`（#173 的 hot-fix 直接合回 `stage`）改了 `app/web/`、`app/forum/`、`deploy/` 却没跟文档，push `stage` 的 CI（运行 36318197583）`core` 报文档不同步、`verify` 失败，没有拦住任何东西；PR #174 最后一次 CI（运行 36322153265）的 `branch-guard` 报 `stage` 本来就不同步，`core`、`verify` 也失败，照样在 2026-09-27T16:06:26Z 合进了 `stage`。把 `verify (required check)` 设成 `stage`、`main` 的必需检查、要不要禁止直推，是仓库设置，由所有者决定后在 Settings → Rules 里配置，#192 的 PR 不改设置。在那之前，合并的人自己确认 CI 全绿（门禁没通过，[CODE-REVIEW](../conventions/CODE-REVIEW.md) 的结论就是阻塞），发版时 plan job 的文档同步再拦一次（见上文）。
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
| `MAIL_ALIYUN_ACCESS_KEY_ID` | 阿里云邮件推送的 AccessKey ID（可选，和下一项要么都配、要么都不配） |
| `MAIL_ALIYUN_ACCESS_KEY_SECRET` | 阿里云邮件推送的 AccessKey Secret |
| `MAIL_RESEND_API_KEY` | Resend 的 API Key（可选） |
| `MAIL_ALLOWLIST` | 收件名单，英文逗号隔开的邮箱（可选；只在 `MAIL_RECIPIENTS=allowlist` 时起作用，两个环境现在都是 `all`） |

两条部署工作流的「渲染运行时 env 文件」步骤把上表从 `OAUTH_CLIENT_ID` 起的每一项按同名传给 `scripts/deployment-environment.mjs render`，`scripts/deploy-manual.mjs` 的 `SECRET_ENV` 也是同一份名单；`tests/tooling/deploy-manual.test.ts` 核对这三处与 `SECRET_FIELDS` 一致。发信四项都没配时照常部署，server 不发信，见 [ENVIRONMENTS](ENVIRONMENTS.md)。

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

## 静态资源 CDN（#146）

带内容哈希的静态文件（官网 `/assets/`、控制台 `/console-assets/`、论坛 `/forum/_nuxt/`）可以改从七牛 CDN `https://cdn.crosery.com` 加载，不再全部从香港源站取。官网桌面壁纸由代码 import，也带哈希，在 `/assets/` 里一起走。HTML、接口、`release.json` 和不带哈希的文件（看板娘、favicon、论坛的公开旧帖图片与 `llms.txt`）仍走源站。

**开关**：一个构建参数 `STATIC_CDN_BASE`。空（默认）与原来一样同源；非空时只能逐字等于 `https://cdn.crosery.com/yzgc/static/site/`，否则构建失败。规则只写在 `scripts/static-cdn-base.mjs` 一处：`app/web`、`app/console` 的 Vite 配置用 `experimental.renderBuiltUrl` 只改写构建资源的地址（`base` 仍是 `/`），`app/forum` 的 Nuxt 配置设 `app.cdnURL`。源站路径与 CDN 对象一一对应：源站 `/X` ↔ 对象 `yzgc/static/site/X`（论坛是 `yzgc/static/site/forum/_nuxt/…`）。预发布与正式共用这个前缀：文件名带内容哈希，内容相同键就相同。镜像里仍有全部文件，开关打开后源站照样能直接访问它们。

**工作流**（两条部署工作流相同，`scripts/static-cdn.mjs` 是唯一实现，零依赖）：

| job | 做什么 | 能看到上传 token 吗 |
|---|---|---|
| `cdn-plan` | 检出这个提交，不安装依赖，运行 `static-cdn.mjs decide --origin <环境 origin>`：没有 token 输出空（同源）；token 的策略不对（不是只写 `crosery:yzgc/static/site/` 前缀、不是只增不改、带回调或持久化处理、没有到期时间、到期时间在 366 天以后）或 90 分钟内到期（后面的 `build` 最长 60 分钟、`cdn-upload` 最长 20 分钟，再留 10 分钟排队）直接失败；线上 CSP（HEAD `<origin>/`）的 `script-src`、`style-src`、`font-src` 还没放行这个前缀时告警并退回同源。剩余有效期不到 30 天时告警 | 能（`environment: static-cdn`） |
| `build` | 按 `cdn-plan` 的输出给 web、forum 两个镜像传 `STATIC_CDN_BASE`（server 不传）；Dockerfile 在镜像里断言入口页引用的是这个地址。开关打开时从刚构建的镜像里 `docker cp` 出三个产物目录，`static-cdn.mjs plan` 离线挑文件（文件名不是构建产出的形状——官网、控制台是 `<name>-<8 位哈希>.<ext>`，论坛是 `<8 位哈希>.js`、`<name>.<8 位哈希>.<ext>` 与 `builds/meta/<构建 id>.json`——或是源码 `public/` 里原样复制进来的、符号链接、隐藏文件、未知类型或超过 10 MiB 的文件，就失败），打成 artifact `yzgc-static-<environment>-<sha12>`（保留 7 天） | 不能：这个 job 运行 `pnpm install` 与 `docker build`，不挂任何 Environment |
| `cdn-upload` | 第一步只报告开关状态；开关打开时检出、下载上一步的 artifact（`scripts/fetch-artifact.mjs`），`static-cdn.mjs upload` 先确认 token 还剩 20 分钟以上，再逐个表单上传到 `https://up-z2.qiniup.com`，再经 CDN 带 `Referer: <origin>/`、`Origin: <origin>`、`Accept-Encoding: identity` 逐个 HEAD 核对：200、ETag 等于本地算出的七牛 qetag、长度一致、`Content-Type` 对、JS/CSS/字体带 `Access-Control-Allow-Origin`（`*` 或本环境 origin）。任一不符即失败 | 能（`environment: static-cdn`），同样不安装依赖 |
| `deploy` | `needs` 加上 `cdn-upload`：上传或核对失败，这次不部署 | — |

- 上传只写 `yzgc/static/site/{assets,console-assets,forum/_nuxt}/` 下的键（脚本的前缀守卫 + token 策略两道），`insertOnly`：同名同内容七牛返回 200，算成功；同名不同内容返回 614（键已存在），不覆盖，随后的 CDN 核对发现 ETag 与本地不同，脚本失败并报出这个键。脚本里没有删除、移动、改元信息的调用。
- 论坛的 `_nuxt/builds/latest.json`（文件名固定、每次内容都变）不上传；开关打开时 Nuxt 的新版本检查（`experimental.checkOutdatedBuildInterval`）关掉，`builds/meta/<构建 id>.json` 每次构建是新键，照常上传。
- **CDN 上的旧文件不删**：回滚到开关打开时构建的旧镜像，页面引用的仍是那时上传的对象。要清理只能由所有者按前缀手工处理，并且确认两个环境的历史镜像都不再引用。
- `scripts/deploy-manual.mjs` 找镜像归档时同样要求这次运行的 `cdn-upload` 成功（没有这个 job 的旧运行只看 build）。
- **开关打开的构建每次 CI 都跑**：部署工作流要等下面的所有者步骤做完才会走开关打开的路，在那之前这条路没有机会在 GitHub 上运行。`ci.yml` 的 `docker-cdn` job 用 `STATIC_CDN_BASE=https://cdn.crosery.com/yzgc/static/site/`（先用 `scripts/static-cdn-base.mjs` 核对这个值）构建 web、forum 两个镜像，Dockerfile 在镜像里断言入口页引用 CDN 地址；再跑部署工作流 `build` job 里同一步「取出要上传 CDN 的带哈希文件」（逐字相同，`tests/tooling/static-cdn-workflows.test.ts` 核对）：`docker cp` 出三个产物目录，`static-cdn.mjs plan` 离线挑文件。它不上传、不需要 token、不挂 Environment，失败会让 `verify` 失败。

**凭据：`STATIC_CDN_UPLOAD_TOKEN`，放在 GitHub Environment `static-cdn` 里**。它是用七牛账号 AK/SK 签出来的上传凭证，不是 AK/SK 本身：策略是 `scope=crosery:yzgc/static/site/`、`isPrefixalScope=1`（只能写这个前缀下的键）、`insertOnly=1`（不能覆盖已有对象）、`fsizeLimit=10 MiB`、带 `deadline`（默认 180 天，最多 366 天），不带回调与持久化处理。泄露后别人只能在到期前往这个前缀下新增对象，不能改、删已有文件，也碰不到桶里别的前缀；七牛的上传凭证签出后不能单独吊销，要作废只能在七牛控制台轮换这对 AK/SK。仓库是公开的，所以不要把账号 AK/SK 放进 GitHub。

所有者按顺序做（任一步没做，部署照常同源构建）：

1. 把入库的 `deploy/nginx/preview.conf`、`production.conf` 装到宿主机（[DEPLOY](DEPLOY.md)「静态资源 CDN」），公网确认 CSP 的 `script-src`、`style-src`、`font-src` 带 `https://cdn.crosery.com/yzgc/static/site/`。
2. **合并本改动（#146）之后、打下一个 rc tag 之前**，在仓库 Settings → Environments 新建 `static-cdn`，Deployment branches and tags 选 Selected branches and tags，只加 tag 规则 `v*`（与发布 tag 一致）。顺序不能反：`cdn-plan`、`cdn-upload` 引用这个 Environment，GitHub 运行引用了不存在的 Environment 的工作流时会自动建一个同名的，自动建的没有任何保护规则（官方文档「Managing environments for deployment」）。它已经被某次 tag 运行自动建出来时，先打开它补上这条规则，再做第 5 步。不要在仓库级建同名 secret（环境级缺失时会回落到仓库级）。2026-09-27 只读核对（`gh api repos/Yangtze-University-Geek-Class/admin/environments`）：仓库里只有 `preview`，还没有 `static-cdn`。
3. **在放 token 之前实测 tag 规则管不管 `deployment: false` 的 job**。两个 job 都写了 `deployment: false`（不产生部署记录）；官方文档（「Deploying with GitHub Actions」）只写了这种 job 照样受 wait timer 与 required reviewers 约束、自定义保护规则会让 job 直接失败，没写 deployment branches and tags 规则，所以第一次要自己看：
   - 第 2 步之后的第一个 rc tag：`cdn-plan`、`cdn-upload` 照常运行（tag 匹配 `v*`），`cdn-plan` 的日志写没有配置 token、这次同源构建；
   - 在自己的个人分支（`dev/<GitHub 用户名>`）上临时加一个工作流，只有一个 `environment: { name: static-cdn, deployment: false }`、`run: echo ok` 的 job，推上去。这个 job 应当被环境规则拒绝（job 页写这个分支不允许使用 `static-cdn`）。拒绝了再做第 5 步；照常跑完说明这条规则管不到 `deployment: false` 的 job，不要放 token，先把两个 job 的 `deployment: false` 去掉（让它们按部署走环境规则）再测一次。测完删掉这个临时工作流。
4. 建议再加一条 tag ruleset，限制谁能建 `v*` tag：Settings → Rules → Rulesets → New tag ruleset，目标 `v*`，勾 Restrict creations（再勾 Restrict updates、Restrict deletions，对应 [RELEASES](../conventions/RELEASES.md)「tag 不可变」），bypass 只留所有者。原因：`static-cdn` 的规则只看 tag 名，tag 触发的又是 tag 所在提交里的工作流文件，任何有写权限的人在自己的分支上改了工作流再推一个 `v*` tag，就能绕过 `plan` 的核对让这两个 job 拿到 token（`preview` 的 `v*.*.*-rc.*` 规则同理）。仓库公开以后 rulesets 可以配：2026-09-27 只读核对 `gh api repos/Yangtze-University-Geek-Class/admin/rulesets` 返回 `[]`（公开前是 403，见下文「平台能力实测」），也就是现在一条都没有。
5. 在自己的机器上签 token 并直接写进这个 Environment，token 不经过终端、文件或剪贴板：

   ```bash
   node scripts/static-cdn.mjs mint-token --env-file ~/.claude/secrets/.env.cloud \
     | gh secret set STATIC_CDN_UPLOAD_TOKEN --env static-cdn --repo Yangtze-University-Geek-Class/admin
   ```

   `--env-file` 里要有 `QINIU_ACCESS_KEY`、`QINIU_SECRET_KEY`（也可以直接放进进程环境、不给 `--env-file`）；`--days` 改有效期（1–366 天，默认 180）。stdout 是终端时脚本拒绝输出，stderr 只打策略与到期时间。
6. 下一次打 rc tag：`cdn-plan` 的日志写「CSP 已放行 … 这次带哈希的静态文件从 CDN 加载」，`cdn-upload` 列出上传与核对的文件数。`cdn-plan` 提示快到期时重复第 5 步；剩不到 90 分钟时 `cdn-plan` 直接失败。

要关掉：删掉 `static-cdn` 里的 `STATIC_CDN_UPLOAD_TOKEN`，下一次部署就回到同源。

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

结论：在**计划升级**或**改用受控外部审批**之前，`production` 的人工门禁无法启用；此时 `DEPLOY_PRODUCTION_ENABLED` 必须保持关闭，正式发布由人手工执行已验证产物。不得以此为由取消人工验收、伪造审批记录。以上为 2026-09-13 的实测快照，启用前必须重新核对。

**更新（2026-09-26 17:49，所有者决定公开仓库）**：`admin` 现在是公开仓库。公开前用 gitleaks 扫过全部分支与 tag 的历史（485 个提交，2 处命中都是测试里的假值），邮箱、手机号、公网 IP 只有测试数据。公开后同时做了：外部贡献者（非协作者）的 fork PR 触发的工作流要维护者批准才跑（`approval_policy=all_external_contributors`）；开启私密漏洞报告；删掉仓库变量 `CI_RUNNER`，CI 回到 `ubuntu-latest`（公开仓库托管 runner 不计分钟，免费版最多 20 个 job 同时跑）；runner 组 `yzgc-deploy` 放行公开仓库（组里仍只选了 `admin`），否则 rc 部署一直排队；`preview` Environment 只放行 `v*.*.*-rc.*` 形状的 tag，其它分支、tag 与 PR 上声明 `environment: preview` 的 job 拿不到它的 secrets。rulesets、分支保护与 `production` 的 required reviewers 现在可以配，但**都还没配**，要所有者定规则。

**更新（2026-09-26 21:05，#138）**：所有者决定 CI 与部署都只用 GitHub 托管 runner：仓库变量 `DEPLOY_RUNNER` 也删了，runner 组 `yzgc-deploy` 的「允许公开仓库」关回去。仓库里的工作流、文档与机器脚本在 #139 改完，见下文「运行位置」。

## 维护者机器部署（免费版的退路）

仓库原先私有时免费版配不了 `production` 的审批人，部署 job 在「production 环境保护」核对处失败关闭，正式环境只能从维护者机器部署。2026-09-27 起 `production` 有 required reviewers（审批人 Crosery，2026-10-02 只读核对 `gh api repos/<仓库>/environments/production`），`DEPLOY_PRODUCTION_ENABLED` 已打开，正式部署照常走 `deploy-production.yml`：开关关闭时部署 job **跳过**；环境保护被删掉或审批人被清空时，它仍在「production 环境保护」核对处**失败关闭**，这是正确行为，不得放宽。build job 都会产出镜像归档（正式保留 30 天，预发布保留 7 天，过期要重新运行工作流）。GitHub 计划让部署 job 按设计失败关闭时（例如仓库改回私有、免费版配不了 required reviewers），或 `preview` 的部署 job 拿不到 secrets 时，改用 `scripts/deploy-manual.mjs` 从维护者机器部署；环境保护被删掉、审批人被清空时，先查清原因、恢复保护再重跑工作流，不改用本脚本。谁可以运行见 [AGENTS](../../AGENTS.md) §3 与 [RELEASES](../conventions/RELEASES.md)「授权门禁」。步骤与 CI 的 deploy job 一一对应，**一切部署物料取自 tag 指向的提交**，不取当前工作区：

1. 进程环境里的 `DEPLOY_TARGET_ENVIRONMENT` 必须等于 `--environment`（对应 CI 的环境哨兵，防止导出的是另一个环境的密钥）；仓库取自 `origin` 远端。
2. `git archive <提交> deploy scripts package.json` 解到临时目录（不是 Git 仓库，所以 `--check` 会打两条「无法通过 git check-ignore 判定」的警告，这是预期的：物料来自 `git archive`，必然是入库文件），用**这一份**的 `release-policy` 规划（与工作流同一个 `--branch-ref`、`--require-tag`，`--root` 指向这份物料）并跑环境契约 `--check`；rc tag 只能进 `preview`，正式 tag 只能进 `production`。`DEPLOY_SSH_HOST/PORT/USER` 必须与这份物料里该环境模板的 `DEPLOY_HOST/PORT/USER` 一致。
3. 正式环境先核对所有者批准：`--acceptance` 必须是本仓库 issue 或 PR 里的一条评论链接（评论确实在链接写的那个编号下），作者是仓库管理员，**没有被编辑过**（按 GraphQL `IssueComment.lastEditedAt` 判断，表情回应不算编辑；有写权限的人能改别人的评论而作者不变，编辑过就请所有者重新发一条）、没有被折叠隐藏（`isMinimized`），发在预发布部署成功之后，并且**整条评论只有一行** `批准发布 vX.Y.Z`（CRLF 当作 LF，末尾的空格、制表符与换行不算，别的一个字符都不能多：`v` 不能省，不能加句号，不能用全角空格，前面不能有缩进或空行，不能加粗、放进引用、代码块或 HTML，不能再写一句试用结论，「暂不批准发布」、只写 rc 的都不算）。这是白名单：脚本不去推测 GitHub 怎么渲染 Markdown 与 HTML，#69 第一轮审查找出了十几种页面上看不到、或和别的字连在一起，却能被逐行规则接受的写法。试用结论、验收记录（[RELEASE-ACCEPTANCE-TEMPLATE](RELEASE-ACCEPTANCE-TEMPLATE.md)）写在别的评论里，批准另发一条只写这一行的新评论；再重做证据 job 的三项核对（同一提交上有同版本的 rc tag、`preview` 有 payload.tag 为这些 rc 之一且最新状态 `success` 的部署记录、`https://prev.yangtzeu.work/release.json` 就是这个提交的 rc 版本）。都在下载之前。
4. 找到这个 tag 的 push 触发的 `deploy-<environment>.yml` 运行（tag 名与提交都要对上、build job 成功；有 `cdn-upload` job 的运行还要它成功，否则镜像里的页面可能引用 CDN 上还没有的文件，见上文「静态资源 CDN」），用 `gh run download` 取镜像归档，**先在本机流式核对 sha256**；从不在本机或目标机构建镜像。
5. 用这份物料里的 `render` 在临时目录渲染 0600 的运行时 env：密钥只经 render 的子进程环境传入（其它子进程的环境里去掉了密钥），不进命令行；子进程都用和脚本同一个 Node（`process.execPath`）；临时目录在结束、出错或 Ctrl-C 时删除。SSH 用 `-F none`、只认 `DEPLOY_SSH_KNOWN_HOSTS_FILE`、`StrictHostKeyChecking=yes`。
6. 写 GitHub 部署记录（payload 键与 CI 相同，正式另有 `preview_tags`，另加 `deployed_from: "maintainer"` 与批准链接；与两条部署工作流一样用 `required_contexts=["verify (required check)"]`：GitHub 默认要求提交上的全部检查都已通过，会把正在运行或已失败的部署 job 也算进去而一直返回 409，`v0.1.0-rc.1` 首次部署时实测；与工作流一样显式 `-F auto_merge=false`，不让 GitHub 去合并默认分支，状态一律 `-F auto_inactive=false`，见上文「证据链」第 2 条），把这份物料里的 compose 与 `deploy-stack.sh` 分发到同样的远端路径，运行同样参数的 `deploy-stack.sh`，按结果把记录置为 `success` / `failure`。

`--dry-run` 做完核对、下载与渲染后停下，不连目标机、不写记录。脚本不创建、不移动 tag，也不替代所有者在预发布上的试用与批准。编排顺序（先核对后下载、物料来自该提交、dry-run 不连目标机、失败置 failure 并清理）由 `tests/tooling/deploy-manual.test.ts` 用注入的假依赖核对；批准评论的白名单正反例（含第一轮审查的全部反例）、评论编辑状态的解析和部署记录的参数（含两条工作流的写法）也在同一个文件里。

## 运行位置

CI 与部署只用 GitHub 托管 runner（#139）：六个工作流的每个 job 都写 `runs-on: ubuntu-latest`。

- 托管 runner 每个 job 一台新虚拟机，job 结束即销毁：前一个 job（包括别人分支上的 job）改不到后一个 job 的文件系统、工具和本地缓存，部署 job 也一样；Actions 缓存（setup-node 的 `cache: pnpm`、`actions/cache`）不随虚拟机销毁，按 GitHub 的分支作用域在多次运行之间共享，从缓存装进来的包仍按锁文件 integrity 核对。仓库公开（2026-09-26 17:49）以后托管 runner 不计分钟，免费版最多 20 个 job 同时跑。
- 部署用的密钥只经 GitHub Environment 进 job：`preview` 只放行 `v*.*.*-rc.*` 形状的 tag（见上文「平台能力实测」的 2026-09-26 更新），`static-cdn` 的放行规则见上文「静态资源 CDN」第 2 步；`production` 的密钥只经 `production` Environment 进 job（2026-10-02 只读核对：它有 required reviewers 与自定义部署分支规则，2026-09-27 建；`v0.1.0` 的正式部署运行 36314912545 由所有者批准后在托管 runner 上跑完）。
- **写成字面量，不读仓库变量**。原来的写法是 `${{ vars.CI_RUNNER || 'ubuntu-latest' }}` 与 `${{ vars.DEPLOY_RUNNER || 'ubuntu-latest' }}`，#139 改掉，理由：两个变量已经删了（#138），留着这种写法只会让人以为还能切回去；改仓库变量不经 PR 与审查，也不进 git 历史，设一个变量就能把带部署私钥的 job 送到别的机器上，写成字面量后换 runner 必须改工作流、经过审查；原来的 runner 组 `yzgc-deploy` 已经不允许公开仓库，设回去 job 也只会排队。`tests/tooling/hosted-runners.test.ts` 核对 `.github/workflows/` 下每个工作流的每个 job 都是 `runs-on: ubuntu-latest`，也没有残留 `vars.CI_RUNNER`、`vars.DEPLOY_RUNNER` 和旧的 runner 标签。
- 托管 runner 出问题时等 GitHub 恢复后重跑，不再有切到别的机器的退路。以后真要用自托管 runner，先开 issue，重新论证隔离、凭据与公开仓库 fork PR 的边界，再改工作流和上面这条测试；不要靠加标签或设变量切过去。

`historical`：仓库还私有时，免费版每月 2000 分钟的托管额度用完（2026-09-25 所有 job 报 `The job was not started because recent account payments have failed or your spending limit needs to be increased`），CI 改到维护者家里的机器 crosery-arch 上的常驻 incus 容器里跑（#93，后来加到 4 个实例，#124），部署 job 跑在同一台机器上每个 job 一个的一次性容器里（#97）。2026-09-26 17:49 仓库公开后 CI 回到托管 runner；`v0.1.0-rc.8` 在一次性 runner 上两次失败后，所有者 21:05 决定部署也不再用家里的 runner（#138）。机器上的脚本 `deploy/runner/` 已在 #139 删除，原文在 git 历史里（`git show 458999f:deploy/runner/<文件>`），当时的做法、隔离边界与实测记在 `notes/2026-09-26/crosery/` 的 `task_93_self_hosted_runner.md`、`task_97_deploy_jit_runner.md`、`task_124_ci_throughput.md`；宿主机上的容器、服务、JIT 令牌与 GitHub 上的 runner 注册由所有者清理，从 #139 拆到 #187 跟进。

### 构建下载源（#104）

工作流与 Dockerfile 可以经三个仓库变量把下面这些下载换到别的源，**仓库变量没设就是官方源**。现在三个变量都没设（2026-10-02 `gh variable list` 只有两个部署开关），CI 与部署都在托管 runner 上走官方源。托管 runner 不用设：设了会让所有 job 都绕到那个源，better-sqlite3 预编译包还要多信一个源（见下文「例外」）。机制留着不删：工作流里的写法与官方回落由 `tests/tooling/build-mirrors.test.ts` 核对，在国内的机器上本机 `docker build` 也能用同名 build arg 换源。

`historical`：#104 是给家里的自托管 runner 加的。那台机器连 GitHub、`registry.npmjs.org`、`deb.debian.org` 只有几十到两百 KB/s，`v0.1.0-rc.7` 的预发布部署（运行 36216674208）一共 56 分钟；换成下表的国内镜像后，server 镜像构建从 1847 秒降到 80 秒（2026-09-26 在那台机器上实测）。当时还用 `deploy/runner/container-setup.sh` 把 Node 22 预置进 runner 的工具缓存，省掉 setup-node 的下载；runner 与脚本已于 #139 退役，托管 runner 上 setup-node 照常从 `github.com/actions/node-versions` 取。

| 下载 | 在哪 | 不设变量（官方） | 设了变量 | 校验 |
|---|---|---|---|---|
| npm 包 | runner 上的 `pnpm install`、三个 Dockerfile 的构建阶段 | `registry.npmjs.org` | `NPM_REGISTRY` | 锁文件里每个包的 integrity |
| pnpm 9.15.9（corepack） | server、web 镜像的构建阶段 | 同上 | `NPM_REGISTRY`（`COREPACK_NPM_REGISTRY`） | corepack 用自带的 npm 公钥核对 npm 的发布签名 |
| pnpm 11.24.0（`npm pack`） | forum 镜像的构建阶段、ci 的 forum job | 同上 | `NPM_REGISTRY` | 写死的官方 sha512（Dockerfile 与 ci.yml 的 `FORUM_PNPM_INTEGRITY`） |
| pnpm/action-setup 的引导版 pnpm（`npm ci`） | core、env-contract、两条部署工作流的 build job | 同上 | `NPM_REGISTRY` | action 自带的锁文件 |
| pnpm 9.15.9（action-setup 的 `self-update`） | 同上 | 同上 | **不换源**：这些 job 故意不设 `pnpm_config_registry` | 只有源自己给的 integrity，所以留在官方源 |
| Debian 包（`apt-get`） | server 镜像的构建阶段 | `deb.debian.org` | `DEBIAN_MIRROR` | apt 按 `debian-archive-keyring` 核对 InRelease 签名 |
| better-sqlite3 预编译包 | runner 上的 `pnpm install`、server 镜像的构建阶段 | GitHub releases | `BETTER_SQLITE3_BINARY_HOST` | 不核对哈希，只靠 https，见下文；只用托管 runner 之后这套变量还要不要，在 #188 评估 |

仓库变量（Settings → Secrets and variables → Actions → Variables，仓库级，不是密钥）：

| 名称 | 可用的国内镜像（#104 时家里 runner 的取值） | 不设时 |
|---|---|---|
| `NPM_REGISTRY` | `https://registry.npmmirror.com` | `https://registry.npmjs.org` |
| `DEBIAN_MIRROR` | `http://mirrors.ustc.edu.cn/debian` | `deb.debian.org`（镜像自带的源） |
| `BETTER_SQLITE3_BINARY_HOST` | `https://registry.npmmirror.com/-/binary/better-sqlite3` | GitHub releases |

- **怎么接进去**：`ci.yml` 的 docker job 与两条部署工作流的 build job 以同名 build arg 传给 Dockerfile（`DEBIAN_MIRROR`、`BETTER_SQLITE3_BINARY_HOST` 只有 server 用）；装依赖的 job 设 `npm_config_registry`（npm 与 pnpm 9 读它）、`pnpm_config_registry`（只在 forum job，pnpm 11 不读 `npm_config_*`，`scripts/forum.mjs` 把它转给论坛的 pnpm）、`npm_config_better_sqlite3_binary_host`（prebuild-install 7.1.3 按 `npm_config_<包名>_binary_host` 取下载地址）。两个 pnpm 版本读哪个变量是 2026-09-26 用 `pnpm config get registry` 实测的。
- **只在构建阶段**：三个参数只在 Dockerfile 的 builder 阶段声明，运行阶段是新的 `FROM`，不继承 ARG 和 ENV；`tests/tooling/build-mirrors.test.ts` 核对这一点，并核对工作流里每处 `vars.*` 都带官方回落值。
- **格式**：`NPM_REGISTRY` 必须是 `https://`、不带结尾 `/`（corepack 直接拼 `<源>/<包名>`）；`DEBIAN_MIRROR` 必须是 `http://`、不带结尾 `/`：slim 镜像在装 ca-certificates 之前 apt 走不了 https（2026-09-26 在 `node:26-bookworm-slim` 里实测：`Certificate verification failed`，而 `apt-get update` 仍以 0 退出），Debian 包的完整性本来就靠签名而不是 TLS。`BETTER_SQLITE3_BINARY_HOST` 设了就必须是 `https://`、不带结尾 `/`：预编译包不核对哈希（见下文），传输途中不被换包只能靠 TLS。`DEBIAN_MIRROR` 与 `BETTER_SQLITE3_BINARY_HOST` 还只许字母、数字和 `.:/_-`（前者要写进 sed，后者不许带 `@` 用户名段或 `?`、`#`）。不合格时 server 构建阶段在第一条 RUN 就失败，不会悄悄回到官方源；基础镜像哪天换了 apt 源的写法，改写后找不到镜像那一行也会失败。runner 上的 `pnpm install` 同样会下载这个预编译包，所以 ci 的 core job 与两条部署工作流的 build job 在检出之后的第一步「核对 better-sqlite3 预编译包地址」用同一条 case 核对 `npm_config_better_sqlite3_binary_host`，不合格时在任何下载之前失败。`tests/tooling/build-mirrors.test.ts` 实跑那条 RUN 与这一步核对这些拒绝，核对三处 job 的写法与 Dockerfile 逐字相同，并核对上表的国内镜像取值能通过。
- **为什么换源不降低完整性**：npmmirror（阿里云维护的 npm 同步源）与中科大 Debian 镜像只是转发。npm 包的内容由锁文件里的 sha512 决定，镜像给不了别的内容。corepack 核对的是 npm 官方的发布签名，镜像源的元数据里带的就是官方签名：2026-09-26 对比 `pnpm@9.15.9`、`pnpm@11.24.0` 在两个源上的 `dist.integrity` 与 `dist.signatures`，逐字相同；本机用 `COREPACK_NPM_REGISTRY=https://registry.npmmirror.com` 装 pnpm 9.15.9 通过，换一把不相干的公钥（`COREPACK_INTEGRITY_KEYS`）时 corepack 报 `The package was not signed by any trusted keys` 拒绝，说明签名核对在镜像源下照常执行。`COREPACK_INTEGRITY_KEYS` 不设空、不关签名。Debian 包由 InRelease 签名链保护，镜像改不了。
- **例外：better-sqlite3 预编译包**。prebuild-install 只按地址下载 tar 包，不核对任何哈希，官方源也是这样；换成 npmmirror 等于从「信 GitHub 上的发布」换成「信 npmmirror 的同步」。2026-09-26 取 `v11.10.0` 的 `node-v127-linux-x64` 包，两边 sha256 都是 `ea6a09d12d43cca31782ab0e09ecf442b8e2a49f5a02b219f5f117a6601ed306`。不愿意信它就不设这个变量（回到 GitHub releases），或者以后改成从源码编译（构建阶段已经装了 python3、make、g++）。
- **生效条件**：仓库变量设好后下一次运行即生效，删掉即回到官方源。

### 下载镜像归档（#99）

deploy job 不用 `actions/download-artifact`，改用 `scripts/fetch-artifact.mjs`：同一地址并发 16 段 Range 请求。下载地址约 1 分钟过期，每段重试时重新取；一段连续 60 秒没收到数据（等响应头或下一块数据；连接卡住不报错，#111）也算失败，断开后重新取地址重试，可用 `--idle-seconds`（1–600）调整，只限空闲时长、不限一段的总时长；查 artifact 列表的 API 请求也限这么久，超时直接失败；只核对总字节数与 zip 的 CRC，归档内容仍由目标机 `sha256sum -c` 核对。job 权限因此多一个 `actions: read`。`historical`：加它时部署跑在家里的自托管 runner 上，单连接从 GitHub 的存储下载只有 40–220KB/s，163MB 要 15–60 分钟（`v0.1.0-rc.6` 实测），并发 16 段约 6.6MB/s；那台 runner 已于 #139 退役，托管 runner 上照常用它。

## 明确不做的事

- 任何工作流都不自动创建/移动/删除 tag，不自动升级 `package.json` 版本，不写放行状态；发布 tag 由维护者在所有者授权后手工创建。
- 不从 `pull_request_target` 触发，不给 fork/PR 构建授予部署 secrets；不用自托管 runner，所有 job 只跑在 GitHub 托管 runner 上（见上文「运行位置」）。
- 不把 `.tools`、真实数据库、`.env`、SSH 材料、内部文档或浏览器状态打进镜像、缓存或日志。
- 机器 PASS（`pnpm verify`、CI 全绿）不构成人工验收记录，也不授权任何部署或发版动作。
- 不把 `stage` 分支的推送当作任何环境的部署：正式部署必须能追到同一提交的 rc tag、成功的预发布部署记录与人工试用结论。

## 双工具链

核心按根 manifest/锁文件使用 Node 22 + pnpm 9.15.9；论坛按独立 manifest/锁文件使用 Node ≥26 + pnpm 11.24.0。分别安装、分别运行现有测试，避免用一套 Node 运行另一 ABI 的原生 SQLite 模块。CI 使用临时测试库和虚构数据；线上目标为 Linux，不上传 Mac 原生依赖。

## 官方依据

核对日期：2026-09-13。平台行为依据（不代表远程设置已完成）：

- https://docs.github.com/en/actions/reference/workflows-and-actions/workflow-syntax — 事件/ref 过滤、权限与并发。
- https://docs.github.com/en/actions/how-tos/deploy/configure-and-manage-deployments/manage-environments — 环境保护、秘密放行、自动创建环境及私有仓库计划限制（2026-09-27 复核：引用不存在的 Environment 会自动创建，新建的没有保护规则和 secrets）。
- https://docs.github.com/en/actions/how-tos/deploy/configure-and-manage-deployments/control-deployments — job 的 `environment.deployment: false`（2026-09-27 核对：wait timer 与 required reviewers 照样生效，自定义保护规则会让 job 失败；没写 deployment branches and tags 规则，见「静态资源 CDN」第 3 步）。
- https://docs.github.com/en/repositories/configuring-branches-and-merges-in-your-repository/managing-rulesets/about-rulesets — 分支保护。

# CI/CD 与部署控制

> 六工作流（ci / deploy-preview / deploy-production / branch-hygiene / issue-lifecycle / cert-watch）+ `.env` 驱动；发版只由发布 tag 触发（`vX.Y.Z-rc.N` → 预发布，`vX.Y.Z` → 正式），push 分支只跑 CI；部署开关默认关闭，机器检查不替代人工验收。

状态：`accepted` · 更新：2026-09-27 · 实施状态：工作流为 `.github/workflows/ci.yml`、`deploy-preview.yml`、`deploy-production.yml`、`branch-hygiene.yml`、`issue-lifecycle.yml`、`cert-watch.yml`，actionlint 全绿。两条部署工作流由 SemVer 发布 tag 触发（2026-09-24 所有者指令），此前「push `stage`/`main` 即部署」的触发方式已删除；更早的 `preview.yml`、`release.yml`（`release-*`/`prev-*` tag）也早已删除。首次上线（2026-09-25，#63）已配置：`preview` Environment 的环境级 secrets（部署 SSH、OAuth、会话与加密密钥；Turnstile 两项未配＝关闭）与 `DEPLOY_TARGET_ENVIRONMENT=preview`，目标机 `/opt/yzgc/preview`、`prev.yangtzeu.work` 证书与站点配置。组织是 GitHub 免费版；仓库原本私有，2026-09-26 17:49 所有者因 CI 排队决定公开（见下文「平台能力实测」的更新）。公开之后 `production` 的 required reviewers 才能配置，**目前还没配**，所以正式部署 job 仍按设计失败关闭，正式环境仍走下文「维护者机器部署」。这些前置条件都由维护者手工完成，任何工作流都不会自动创建。

发布规则以 [RELEASES](../conventions/RELEASES.md) 为唯一完整规范，分支模型以 [BRANCHING](../conventions/BRANCHING.md) 为准，环境字段契约见 [ENVIRONMENTS](ENVIRONMENTS.md)。

## 触发与职责

| 工作流 | 触发 | 行为 |
|---|---|---|
| `ci.yml` | PR → `main`/`stage`；push `main`/`stage`/`task/**`/`dev/**`（不含 tag）；`workflow_dispatch` | `branch-guard`（分支不变量；task 分支的 PR 另查执行记录与本 PR 的文档同步）→ `core`（Node 22：check/test/build，检出完整历史）∥ `forum`（Node ≥26：check/generate）∥ `env-contract`（`.env` 与 `environments.json`、compose 一致性，前端站点配置不含域名）∥ `docker`（`deploy/compose/{production,preview}.yml` 解析 + 三条镜像构建验证）→ `verify` 汇总 |
| `deploy-preview.yml` | push tag `v[0-9]+.[0-9]+.[0-9]+-rc.[0-9]+`；`workflow_dispatch`（必填 `tag`，并从同名 tag 运行） | 断言 ref 是 `refs/tags/vX.Y.Z-rc.N` → `release-policy` 规划（提交在 `origin/stage` 上、版本等于 `package.json`）→ `cdn-plan` 决定静态资源 CDN 开关 → 构建镜像 → `cdn-upload` 上传并核对带哈希的静态文件（开关关闭时只报告状态，见下文「静态资源 CDN」）→ 渲染 `.env.preview` → SSH 分发镜像与环境文件 → `deploy-stack.sh` → 健康检查 → 记录 deployment（payload 带 rc tag）。开关 `vars.DEPLOY_PREVIEW_ENABLED`；同一时刻只跑一个，不取消正在跑的运行 |
| `deploy-production.yml` | push tag `v[0-9]+.[0-9]+.[0-9]+`；`workflow_dispatch`（必填 `tag`，并从同名 tag 运行） | 断言 ref 是 `refs/tags/vX.Y.Z`（rc tag 被拒绝）→ `release-policy` 规划（提交在 `origin/main` 上、同一提交有 `vX.Y.Z-rc.N`）→ 证据检查（见下文）→ `cdn-plan` → 构建镜像 → `cdn-upload` → 分发 `.env.production` → 部署 → 记录 deployment。开关 `vars.DEPLOY_PRODUCTION_ENABLED`，`environment: production`，不取消正在跑的运行 |
| `branch-hygiene.yml` | PR `closed`（`merged == true`）、每周一 03:17 UTC、`workflow_dispatch` | 合并后删除 head 为 `task/**` 的本仓分支（`contents: write`，只删 `task/**`，**永不**自动删 `dev/**` 或长期分支）；每周巡检远端 `task/**`，对「14 天无提交活动且无 open PR」的残留分支只输出 `::warning::` 与 step summary，不删除 |
| `cert-watch.yml` | 每天 01:43 UTC、`workflow_dispatch`（都只在默认分支 `main` 上的文件生效，合入 `main` 后才开始） | 从公网用 `openssl s_client -verify_return_error -verify_hostname` 核对 `yangtzeu.work`、`prev.yangtzeu.work` 的证书：连不上、链不可信、名字不匹配或剩余不到总有效期的四分之一即失败（GitHub 通知维护者）。`permissions: {}`，不接触任何 secrets；续期本身由目标机的 certbot 负责，见 [DEPLOY](DEPLOY.md#证书续期与到期监控) |
| `issue-lifecycle.yml` | PR 指向 `stage` 的 opened / edited / synchronize / reopened / closed、每天 03:37 UTC、`workflow_dispatch`（可勾「只读」） | `pr-contract`：核对 PR 正文契约（`Closes #<issue>` 与 task 分支号一致、issue 存在且开着、九个必需段落、验收证据、审查结论；`scripts/pr-contract.mjs`，只检出默认分支上的脚本，不执行 PR 代码）；`close-on-merge`：合并进 `stage` 后关闭 issue 并在 issue 与 PR 上各留一条追踪记录（`issues: write`、`pull-requests: write`）；`sweep` 每天巡检（`scripts/issue-sweep.mjs`，规则见 [TRACKING](../conventions/TRACKING.md) §1）：关联 PR 已合并进 `stage` 还开着的 issue 自动关闭并留「关闭」记录（合并后重开过的、还有开着的 PR 的、合并不到一小时的不关），14 天没动静的留「超期」记录，14 天内关闭却没有合并 PR 也没有「关闭」记录的留「缺记录」，不重开（`issues: write`，只检出两个脚本）。定时任务只跑默认分支 `main` 上的文件，合入 `main` 之前仍是旧的每周只告警 |

- **push `stage` 或 `main` 不部署任何环境**，只跑 `ci.yml`。部署只由发布 tag 触发，规则见 [RELEASES](../conventions/RELEASES.md)。GitHub 的 tag 过滤按整个 tag 名匹配：`deploy-production.yml` 的 `v[0-9]+.[0-9]+.[0-9]+` 不含 `-`，匹配不到 `vX.Y.Z-rc.N`；两条部署工作流的 plan job 还会用完整正则再断言一次，前导 0、`rc.0` 等格式也会被拒绝。
- 手工运行部署工作流时，「Use workflow from」必须选同一个发布 tag，并在 `tag` 输入框里填这个 tag；ref 与输入不一致即失败。手工运行只用于重新部署已有 tag，不创建 tag。
- 一次只推一个发布 tag：GitHub 在一次推送超过三个 tag 时不产生 push 事件，工作流不会运行。
- **打 tag 之前先等这个提交上 `ci.yml` 的 `verify (required check)` 跑完并通过。** 部署记录用 `required_contexts` 只要求这一项检查，它还在跑或没通过时，创建部署记录返回 409，部署 job 在这一步失败（`scripts/deploy-manual.mjs` 同样）。刚合并进 `stage` 的提交要等 push `stage` 触发的那次 CI 结束再打 rc tag。
- tag 推送触发的是**该 tag 所在提交里**的工作流文件；手工运行也按所选 tag 的工作流文件执行，但入口要求工作流文件已经存在于默认分支（`main`）。
- `ci.yml` 的旧运行（#124）：同一 PR 或同一个 `task/**`、`dev/**` 分支推了新提交，旧提交还没跑完的运行自动取消，runner 让给新提交。被取消的运行因为 `verify` 是 `if: always()`（跳过会被当成通过，不能去掉），还会排一个 `verify` job，最后以 failure 或 cancelled 结束（常驻 runner 占满时它会先显示排队中）。push `main`、`stage` 的运行不取消正在跑的；但同一组里已经有一个在排队时，GitHub 会取消排队中的那一次（默认 `queue: single`），连续合并三次以上时中间的提交可能没有 `verify`：打 rc tag 前先确认这个提交上的 `verify (required check)`，没有就重跑那次运行。
- `dev/**` 只在 `ci.yml` 里做机器验证，不部署、不获得任何发布含义；PR 仍然只能指向 `main`/`stage`，`dev/**` 不得作为进入 `stage` 的凭据；旧的 `dev-*` 名字不再触发 `ci.yml`（见 [BRANCHING](../conventions/BRANCHING.md) 命名规则）。
- `branch-hygiene.yml` 是「合并后立即删除 task 分支」的执行者；它不创建 tag、不动 `main`/`stage`、不改 PR 状态，也不接触任何 secrets。巡检发现残留分支只告警，删除留给人工决定。

- `ci.yml` 顶层权限仅 `contents: read`，不挂载任何 secrets，不产出可部署产物。
- `branch-guard` 运行 `node scripts/check-branch-invariants.mjs`（`--require-remote-refs`）：核对两条不变量（`stage ≥ main`、`main` 不领先 `stage`）与分支命名卫生，并检查写入 `main` 的提交来源。不变量定义见 [BRANCHING](../conventions/BRANCHING.md)。同一脚本的 `--push` 模式还在本地 pre-push 里核对发布 tag（格式、所在分支、版本号、不可删除和移动）；`ci.yml` 不由 tag 触发，tag 的服务端核对在两条部署工作流的 plan job 里。
- **文档跟着模块改**（对照表与规则见 [docs/README](../README.md)「文档跟着模块改」，`scripts/check-doc-sync.mjs`）：`core` 的 `pnpm check` 里有 `check:doc-sync`：PR 运行时检出的是 GitHub 做的合并提交，push `stage`/`main`/`dev/**` 时是分支本身，都按第一父链的时间比较每一对模块与文档；push `task/**` 时按 PR 对 `origin/stage` 核对。检出写 `fetch-depth: 0`，浅克隆直接失败。`branch-guard` 在 task 分支进 `stage` 的 PR 上再跑 `--base origin/stage --head <task 分支>`：merge-base 以来动了模块，就要改对应文档的说明，或者在这个 task 的执行记录里写文档核对（`--head` 用来找到这个 task 的执行记录，检出的合并提交上没有分支名）。第一父链的比较依赖 PR 只用 merge commit 进 `stage`（[BRANCHING](../conventions/BRANCHING.md)）。改 `.github/workflows/` 就要同时改本文档；改 `deploy/` 就要改 [DEPLOY](DEPLOY.md)、[ENVIRONMENTS](ENVIRONMENTS.md) 或本文档里对应的说明（三份里至少动一份，改哪份看改了什么）。
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

**凭据：`STATIC_CDN_UPLOAD_TOKEN`，放在 GitHub Environment `static-cdn` 里**。它是用七牛账号 AK/SK 签出来的上传凭证，不是 AK/SK 本身：策略是 `scope=crosery:yzgc/static/site/`、`isPrefixalScope=1`（只能写这个前缀下的键）、`insertOnly=1`（不能覆盖已有对象）、`fsizeLimit=10 MiB`、带 `deadline`（默认 180 天，最多 366 天），不带回调与持久化处理。泄露后别人只能在到期前往这个前缀下新增对象，不能改、删已有文件，也碰不到桶里别的前缀；七牛的上传凭证签出后不能单独吊销，要作废只能在七牛控制台轮换这对 AK/SK。仓库是公开的，所以不要把账号 AK/SK 放进 GitHub。

所有者按顺序做（任一步没做，部署照常同源构建）：

1. 把入库的 `deploy/nginx/preview.conf`、`production.conf` 装到宿主机（[DEPLOY](DEPLOY.md)「静态资源 CDN」），公网确认 CSP 的 `script-src`、`style-src`、`font-src` 带 `https://cdn.crosery.com/yzgc/static/site/`。
2. 在仓库 Settings → Environments 新建 `static-cdn`，Deployment branches and tags 选 Selected，只加 tag 规则 `v*`（与发布 tag 一致；两个 job 都写了 `deployment: false`，不产生部署记录）。不要在仓库级建同名 secret（环境级缺失时会回落到仓库级）。
3. 在自己的机器上签 token 并直接写进这个 Environment，token 不经过终端、文件或剪贴板：

   ```bash
   node scripts/static-cdn.mjs mint-token --env-file ~/.claude/secrets/.env.cloud \
     | gh secret set STATIC_CDN_UPLOAD_TOKEN --env static-cdn --repo Yangtze-University-Geek-Class/admin
   ```

   `--env-file` 里要有 `QINIU_ACCESS_KEY`、`QINIU_SECRET_KEY`（也可以直接放进进程环境、不给 `--env-file`）；`--days` 改有效期。stdout 是终端时脚本拒绝输出，stderr 只打策略与到期时间。
4. 下一次打 rc tag：`cdn-plan` 的日志写「CSP 已放行 … 这次带哈希的静态文件从 CDN 加载」，`cdn-upload` 列出上传与核对的文件数。`cdn-plan` 提示快到期时重复第 3 步。

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

## 维护者机器部署（免费版的退路）

`production` 环境和它的审批人还没配置（仓库原先私有时免费版配不了；2026-09-26 公开后可以配，审批人由所有者定）。`deploy-production` 的部署 job 有两种结局：开关 `DEPLOY_PRODUCTION_ENABLED` 关闭时**跳过**；打开时在「production 环境保护」核对处**失败关闭**。这是正确行为，不得放宽。两种情况下 build job 都会产出镜像归档（正式保留 30 天，预发布保留 7 天，过期要重新运行工作流）。正式环境（以及 `preview` 的部署 job 拿不到 secrets 时的预发布）改用 `scripts/deploy-manual.mjs` 从维护者机器部署；谁可以运行见 [AGENTS](../../AGENTS.md) §3 与 [RELEASES](../conventions/RELEASES.md)「授权门禁」。步骤与 CI 的 deploy job 一一对应，**一切部署物料取自 tag 指向的提交**，不取当前工作区：

1. 进程环境里的 `DEPLOY_TARGET_ENVIRONMENT` 必须等于 `--environment`（对应 CI 的环境哨兵，防止导出的是另一个环境的密钥）；仓库取自 `origin` 远端。
2. `git archive <提交> deploy scripts package.json` 解到临时目录（不是 Git 仓库，所以 `--check` 会打两条「无法通过 git check-ignore 判定」的警告，这是预期的：物料来自 `git archive`，必然是入库文件），用**这一份**的 `release-policy` 规划（与工作流同一个 `--branch-ref`、`--require-tag`，`--root` 指向这份物料）并跑环境契约 `--check`；rc tag 只能进 `preview`，正式 tag 只能进 `production`。`DEPLOY_SSH_HOST/PORT/USER` 必须与这份物料里该环境模板的 `DEPLOY_HOST/PORT/USER` 一致。
3. 正式环境先核对所有者批准：`--acceptance` 必须是本仓库 issue 或 PR 里的一条评论链接（评论确实在链接写的那个编号下），作者是仓库管理员，**没有被编辑过**（按 GraphQL `IssueComment.lastEditedAt` 判断，表情回应不算编辑；有写权限的人能改别人的评论而作者不变，编辑过就请所有者重新发一条）、没有被折叠隐藏（`isMinimized`），发在预发布部署成功之后，并且**整条评论只有一行** `批准发布 vX.Y.Z`（CRLF 当作 LF，末尾的空格、制表符与换行不算，别的一个字符都不能多：`v` 不能省，不能加句号，不能用全角空格，前面不能有缩进或空行，不能加粗、放进引用、代码块或 HTML，不能再写一句试用结论，「暂不批准发布」、只写 rc 的都不算）。这是白名单：脚本不去推测 GitHub 怎么渲染 Markdown 与 HTML，#69 第一轮审查找出了十几种页面上看不到、或和别的字连在一起，却能被逐行规则接受的写法。试用结论、验收记录（[RELEASE-ACCEPTANCE-TEMPLATE](RELEASE-ACCEPTANCE-TEMPLATE.md)）写在别的评论里，批准另发一条只写这一行的新评论；再重做证据 job 的三项核对（同一提交上有同版本的 rc tag、`preview` 有 payload.tag 为这些 rc 之一且最新状态 `success` 的部署记录、`https://prev.yangtzeu.work/release.json` 就是这个提交的 rc 版本）。都在下载之前。
4. 找到这个 tag 的 push 触发的 `deploy-<environment>.yml` 运行（tag 名与提交都要对上、build job 成功；有 `cdn-upload` job 的运行还要它成功，否则镜像里的页面可能引用 CDN 上还没有的文件，见上文「静态资源 CDN」），用 `gh run download` 取镜像归档，**先在本机流式核对 sha256**；从不在本机或目标机构建镜像。
5. 用这份物料里的 `render` 在临时目录渲染 0600 的运行时 env：密钥只经 render 的子进程环境传入（其它子进程的环境里去掉了密钥），不进命令行；子进程都用和脚本同一个 Node（`process.execPath`）；临时目录在结束、出错或 Ctrl-C 时删除。SSH 用 `-F none`、只认 `DEPLOY_SSH_KNOWN_HOSTS_FILE`、`StrictHostKeyChecking=yes`。
6. 写 GitHub 部署记录（payload 键与 CI 相同，正式另有 `preview_tags`，另加 `deployed_from: "maintainer"` 与批准链接；与两条部署工作流一样用 `required_contexts=["verify (required check)"]`：GitHub 默认要求提交上的全部检查都已通过，会把正在运行或已失败的部署 job 也算进去而一直返回 409，`v0.1.0-rc.1` 首次部署时实测；与工作流一样显式 `-F auto_merge=false`，不让 GitHub 去合并默认分支，状态一律 `-F auto_inactive=false`，见上文「证据链」第 2 条），把这份物料里的 compose 与 `deploy-stack.sh` 分发到同样的远端路径，运行同样参数的 `deploy-stack.sh`，按结果把记录置为 `success` / `failure`。

`--dry-run` 做完核对、下载与渲染后停下，不连目标机、不写记录。脚本不创建、不移动 tag，也不替代所有者在预发布上的试用与批准。编排顺序（先核对后下载、物料来自该提交、dry-run 不连目标机、失败置 failure 并清理）由 `tests/tooling/deploy-manual.test.ts` 用注入的假依赖核对；批准评论的白名单正反例（含第一轮审查的全部反例）、评论编辑状态的解析和部署记录的参数（含两条工作流的写法）也在同一个文件里。

## 自托管 runner

组织是免费版，仓库当时私有：托管 runner 每月 2000 分钟，支出上限 $0。额度用完后所有 job 都报 `The job was not started because recent account payments have failed or your spending limit needs to be increased`（2026-09-25 实测），`verify (required check)` 出不来，也就打不了 rc tag。自托管 runner 不计分钟数，所以 CI 改到维护者家里的机器上跑（#93），部署 job 也在同一台机器上跑，但每个 job 一个全新容器（#97，见下文「部署用的一次性 runner」）。2026-09-26 仓库公开后，CI 改回托管 runner（`CI_RUNNER` 已删），下面的常驻 runner 保留注册、闲置，作为托管 runner 出问题时的退路；部署仍在一次性 runner 上。

| 项 | 取值 |
|---|---|
| 宿主机 | crosery-arch（Arch Linux，Ryzen 7 8845H 16 线程 / 30G 内存），维护者家里 |
| 隔离 | 非特权 incus 系统容器 `yzgc-runner`（Ubuntu 24.04，`security.nesting=true`，容器里有自己的 Docker），限 8 线程、16G 内存；存储池是 80G 的 btrfs 镜像文件，放在单独的子卷 `/var/lib/incus`，不进宿主机的 snapper 快照 |
| 注册 | 只注册到本仓库；四个实例 `crosery-arch-1`…`crosery-arch-4`（`RUNNER_INSTANCES`，默认 4、只能 1–9，`job-started.sh` 按 `r[0-9]` 认工作目录；#124：两个人同时开 PR 时两个实例排队一个多小时，四个实例共用容器限额 8 线程、16GiB），一个 PR 的 push 与 pull_request 两次运行可以同时跑；标签 `yzgc-arch` |
| 与托管 runner 对齐 | 托管 runner 每个 job 一台新机器，这里用两条规则补齐：每个实例一个 HOME（`/home/runner/r<N>/home`，`~/setup-pnpm`、pnpm 的 SQLite 索引、npm 缓存不在并发 job 之间共用，共用时 pnpm 报 `disk I/O error`）；每个 job 开始前由 `ACTIONS_RUNNER_HOOK_JOB_STARTED` 清空工作目录（上一个 job 的 sparse-checkout 会让下一个 job 缺文件，#93 第一轮 CI 实测） |
| 出站 | incus 网络 ACL `runner-egress` 拒绝容器访问 `10.0.0.0/8`、`172.16.0.0/12`、`192.168.0.0/16`、`100.64.0.0/10`、`169.254.0.0/16`、`198.18.0.0/15`（家里局域网、tailscale、netbird、宿主机与它的 Docker 网桥、代理的 fake-ip 段），其余放行 |
| 预装 | 对齐 ubuntu-latest 里工作流直接用到的工具：Node 22 LTS（`branch-guard`、`docker`、`pr-contract` 不经 setup-node 直接调 `node`，官方包按 SHASUMS256 校验；同一个包还解进 runner 的工具缓存，setup-node 直接命中，见下文「构建下载源」）、git、gh、jq、shellcheck、openssl、Docker + buildx + compose。新工作流用到别的预装工具时，先在容器里装上再切过来 |
| 镜像源 | 家里连不上 Docker Hub，容器内 Docker 走 `docker.m.daocloud.io`、`docker.1ms.run` 镜像加速；容器自己的 Ubuntu apt 走中科大。npm 包、pnpm、Debian 包、better-sqlite3 预编译包由仓库变量换源，见下文「构建下载源」 |
| 清理 | 容器内定时器每天清掉 72 小时前的镜像与构建缓存 |

**重建**：机器上的步骤都在 [deploy/runner/](../../deploy/runner/)。宿主机 root 跑 `host-setup.sh`（incus 初始化、网桥、ACL、放行 Docker 的 FORWARD、建容器）；把 `container-setup.sh`、`job-started.sh`、`register.sh` 三个文件用 `incus file push` 放进容器的同一个目录（如 `/root/`），先跑 `container-setup.sh`（工具、Docker、Node、runner 用户与清理钩子，runner 安装包按官方 SHA256 校验），再按 `register.sh` 开头的写法把注册令牌从 stdin 喂进去注册 `RUNNER_INSTANCES` 个实例（令牌只经环境变量 `ACTIONS_RUNNER_INPUT_TOKEN` 给 `config.sh`，不进任何命令行）。宿主机的 incus 包按本机软件源索引的版本安装，不做部分升级。三个脚本都能重复执行，但重跑 `container-setup.sh` 会重启容器里的 docker，正在跑的 job 会失败，挑没有 job 的时候跑；`register.sh` 只重启 `.env` 改过或新注册的实例，已注册、在跑的实例不动。加实例时：新实例的目录用缓存的 runner 包解出来，解包前先按 `container-setup.sh` 里写死的 `RUNNER_SHA256` 核对（`echo "<RUNNER_SHA256>  <包>" | sha256sum -c -`；包在 `/home/runner` 下、属 runner，job 能改到它），再 `incus exec --env RUNNER_INSTANCES=6 yzgc-runner -- sh /root/register.sh`（`incus exec` 不继承调用方的环境变量）。

**切换**：仓库变量 `CI_RUNNER=yzgc-arch` 时，`ci`、`branch-hygiene`、`issue-lifecycle`、`cert-watch` 跑在常驻容器上；两条部署工作流读另一个变量 `DEPLOY_RUNNER`，现在是 `yzgc-deploy`（下文的一次性 runner），**不要指向常驻的 `yzgc-arch`**（原因见下面的剩余风险）。`CI_RUNNER` 现在已删（仓库公开，托管 runner 不计分钟），CI 跑在 `ubuntu-latest` 上；托管 runner 出问题时设回 `CI_RUNNER=yzgc-arch`。下文「构建下载源」的三个仓库变量 `NPM_REGISTRY`、`DEBIAN_MIRROR`、`BETTER_SQLITE3_BINARY_HOST` 是仓库级的，不看 job 跑在哪台 runner 上：`CI_RUNNER`、`DEPLOY_RUNNER` 都删掉、全部回到托管 runner 时，把这三个也一起删掉，否则托管 runner 也会绕到国内镜像下载（不设它们就是官方源）。2026-09-26 删 `CI_RUNNER` 时这三个本来就没设。

**掉线**：机器断电、断网或关机时，job 排队等 runner 回来；排队超过 24 小时没被领取的 job 由 GitHub 判失败。机器恢复后重跑，或者临时删掉 `DEPLOY_RUNNER`（CI 已在托管 runner 上，不受影响）；这时如果设了三个下载源变量，同上一起删掉，机器回来、切回自托管时再设上（取值见「构建下载源」）。

**安全边界**（下文「自托管运行器不得接在有生产凭据或真实数据的机器上执行不可信 PR」在这里靠下面几条成立，不是无条件满足）：

- 谁能让代码跑到这里：能向本仓库推分支的协作者；仓库公开后还有外部贡献者的 fork PR，但它们的工作流要维护者批准才会运行，批准前先看 PR 有没有改 `.github/workflows/`。他们推任意分支（包括在分支里新增一个写 `runs-on: yzgc-arch` 的工作流），代码就会在这台 runner 上执行。
- 隔离到哪一层：job 在非特权容器里以 `runner` 用户运行，但 `runner` 在容器的 docker 组里，等于**容器内 root**。容器里没有宿主机的家目录、SSH 材料、凭据和数据库，除 runner 自己的注册凭据外不放任何密钥；出站拒绝上表的私网段。宿主机隔离靠 Linux 内核的命名空间，容器与宿主机共用内核，内核漏洞可以逃逸到维护者的个人机器。
- 剩余风险一：**runner 是常驻的，不是一次性的**。拿到容器内 root 的人可以改掉 `job-started.sh`、`/usr/local/bin/node`、runner 本体或构建缓存，影响之后任何分支（包括 `stage`）上的 CI 结果，`verify (required check)` 的绿色因此只证明「这台 runner 上跑过」。发现可疑时重建容器（`incus delete -f yzgc-runner` 后按上文重建，并在仓库设置里移除全部 `crosery-arch-*`）。改成每个 job 一个全新容器前，这条风险一直在。
- 剩余风险二：ACL 挡的是私网段，挡不住经家里公网 IP 绕回路由器端口转发的连接。
- 所以部署 job 不放到常驻 runner 上，而是放到下文的一次性 runner：每个部署 job 的容器是新起的，前一个 job（包括别人分支上的 job）改不到它的文件系统；池里同时在跑的容器之间开了 port isolation 与 IP / MAC 过滤，互相连不上，也不能仿冒对方的地址。
- 一次性 runner 的剩余风险：runner 组免费版只能限制仓库，不能限制工作流（按工作流限制时 GitHub 要求写具体 ref，`@refs/tags/*` 与 `@*` 都被拒绝，2026-09-26 实测），能推分支的人也能把 job 发到 `yzgc-deploy` 上。这样的 job 拿到的同样是跑完即删的新容器，改不到之后部署 job 的容器；但它可以一直占着 runner（比如一个 matrix 占满两台，再接着占住新补上的），部署就一直排队，这时找到并取消那个运行。部署私钥经 `preview` 环境的 secrets 进入 job，任何分支上声明了 `environment: preview` 的工作流都能拿到，这与 runner 在哪无关。容器与宿主机共用内核、公网 IP 绕回这两条与常驻 runner 相同；拿到宿主机 root 的人能用令牌注册假 runner 抢部署 job。
- 镜像加速源是第三方服务：CI 与部署都经它拉基础镜像，三个 Dockerfile 的基础镜像按 digest 固定（[DEPLOY](DEPLOY.md)「基础镜像按 digest 固定」），拉取时 Docker 按 digest 校验，加速源换不了内容；npm、Debian 镜像源各自靠什么校验见下文「构建下载源」。runner 自动更新保持开启（版本落后太多时 GitHub 不再派发 job）。

### 构建下载源（#104）

家里连 GitHub、`registry.npmjs.org`、`deb.debian.org` 只有几十到两百 KB/s。`v0.1.0-rc.7` 的预发布部署（运行 36216674208）一共 56 分钟，实测大头是：三个 job 的 setup-node 从 `github.com/actions/node-versions` 下 Node 包，plan 2 分 50 秒、build 5 分 13 秒、deploy 13 分 46 秒；server 镜像构建阶段的 `apt-get` 从 `deb.debian.org` 下 9.4MB 索引加 75MB 包，这一条 RUN 用了 668.8 秒。npm 包本身在家里还算快（server 镜像的 `pnpm install` 45 秒）。下面这些下载改走本机缓存或国内镜像，**仓库变量没设就是官方源**，托管 runner 不用设：

| 下载 | 在哪 | 不设变量（官方） | 家里 runner | 校验 |
|---|---|---|---|---|
| Node 22（setup-node 读 `.nvmrc` 的 `22`） | 读 `.nvmrc` 的 setup-node：ci 的 core、env-contract，两条部署工作流的 plan、build、deploy（ci 的 forum job 装 Node 26、不读 `.nvmrc`，不在此列，这里不预置） | `github.com/actions/node-versions` | 不下载：`container-setup.sh` 把装进 `/usr/local` 的同一个官方包解进 runner 的工具缓存 | nodejs.org 的 SHASUMS256 |
| npm 包 | runner 上的 `pnpm install`、三个 Dockerfile 的构建阶段 | `registry.npmjs.org` | `NPM_REGISTRY` | 锁文件里每个包的 integrity |
| pnpm 9.15.9（corepack） | server、web 镜像的构建阶段 | 同上 | `NPM_REGISTRY`（`COREPACK_NPM_REGISTRY`） | corepack 用自带的 npm 公钥核对 npm 的发布签名 |
| pnpm 11.24.0（`npm pack`） | forum 镜像的构建阶段、ci 的 forum job | 同上 | `NPM_REGISTRY` | 写死的官方 sha512（Dockerfile 与 ci.yml 的 `FORUM_PNPM_INTEGRITY`） |
| pnpm/action-setup 的引导版 pnpm（`npm ci`） | core、env-contract、两条部署工作流的 build job | 同上 | `NPM_REGISTRY` | action 自带的锁文件 |
| pnpm 9.15.9（action-setup 的 `self-update`） | 同上 | 同上 | **不换源**：这些 job 故意不设 `pnpm_config_registry` | 只有源自己给的 integrity，所以留在官方源 |
| Debian 包（`apt-get`） | server 镜像的构建阶段 | `deb.debian.org` | `DEBIAN_MIRROR` | apt 按 `debian-archive-keyring` 核对 InRelease 签名 |
| better-sqlite3 预编译包 | runner 上的 `pnpm install`、server 镜像的构建阶段 | GitHub releases | `BETTER_SQLITE3_BINARY_HOST` | 不核对哈希，只靠 https，见下文 |

仓库变量（Settings → Secrets and variables → Actions → Variables，仓库级，不是密钥）：

| 名称 | 家里 runner 的取值 | 不设时 |
|---|---|---|
| `NPM_REGISTRY` | `https://registry.npmmirror.com` | `https://registry.npmjs.org` |
| `DEBIAN_MIRROR` | `http://mirrors.ustc.edu.cn/debian` | `deb.debian.org`（镜像自带的源） |
| `BETTER_SQLITE3_BINARY_HOST` | `https://registry.npmmirror.com/-/binary/better-sqlite3` | GitHub releases |

- **怎么接进去**：`ci.yml` 的 docker job 与两条部署工作流的 build job 以同名 build arg 传给 Dockerfile（`DEBIAN_MIRROR`、`BETTER_SQLITE3_BINARY_HOST` 只有 server 用）；装依赖的 job 设 `npm_config_registry`（npm 与 pnpm 9 读它）、`pnpm_config_registry`（只在 forum job，pnpm 11 不读 `npm_config_*`，`scripts/forum.mjs` 把它转给论坛的 pnpm）、`npm_config_better_sqlite3_binary_host`（prebuild-install 7.1.3 按 `npm_config_<包名>_binary_host` 取下载地址）。两个 pnpm 版本读哪个变量是 2026-09-26 用 `pnpm config get registry` 实测的。
- **只在构建阶段**：三个参数只在 Dockerfile 的 builder 阶段声明，运行阶段是新的 `FROM`，不继承 ARG 和 ENV；`tests/tooling/build-mirrors.test.ts` 核对这一点，并核对工作流里每处 `vars.*` 都带官方回落值。
- **格式**：`NPM_REGISTRY` 必须是 `https://`、不带结尾 `/`（corepack 直接拼 `<源>/<包名>`）；`DEBIAN_MIRROR` 必须是 `http://`、不带结尾 `/`：slim 镜像在装 ca-certificates 之前 apt 走不了 https（2026-09-26 在 `node:26-bookworm-slim` 里实测：`Certificate verification failed`，而 `apt-get update` 仍以 0 退出），Debian 包的完整性本来就靠签名而不是 TLS。`BETTER_SQLITE3_BINARY_HOST` 设了就必须是 `https://`、不带结尾 `/`：预编译包不核对哈希（见下文），传输途中不被换包只能靠 TLS。`DEBIAN_MIRROR` 与 `BETTER_SQLITE3_BINARY_HOST` 还只许字母、数字和 `.:/_-`（前者要写进 sed，后者不许带 `@` 用户名段或 `?`、`#`）。不合格时 server 构建阶段在第一条 RUN 就失败，不会悄悄回到官方源；基础镜像哪天换了 apt 源的写法，改写后找不到镜像那一行也会失败。runner 上的 `pnpm install` 同样会下载这个预编译包，所以 ci 的 core job 与两条部署工作流的 build job 在检出之后的第一步「核对 better-sqlite3 预编译包地址」用同一条 case 核对 `npm_config_better_sqlite3_binary_host`，不合格时在任何下载之前失败。`tests/tooling/build-mirrors.test.ts` 实跑那条 RUN 与这一步核对这些拒绝，核对三处 job 的写法与 Dockerfile 逐字相同，并核对上表「家里 runner 的取值」能通过。
- **为什么换源不降低完整性**：npmmirror（阿里云维护的 npm 同步源）与中科大 Debian 镜像只是转发。npm 包的内容由锁文件里的 sha512 决定，镜像给不了别的内容。corepack 核对的是 npm 官方的发布签名，镜像源的元数据里带的就是官方签名：2026-09-26 对比 `pnpm@9.15.9`、`pnpm@11.24.0` 在两个源上的 `dist.integrity` 与 `dist.signatures`，逐字相同；本机用 `COREPACK_NPM_REGISTRY=https://registry.npmmirror.com` 装 pnpm 9.15.9 通过，换一把不相干的公钥（`COREPACK_INTEGRITY_KEYS`）时 corepack 报 `The package was not signed by any trusted keys` 拒绝，说明签名核对在镜像源下照常执行。`COREPACK_INTEGRITY_KEYS` 不设空、不关签名。Debian 包由 InRelease 签名链保护，镜像改不了。
- **例外：better-sqlite3 预编译包**。prebuild-install 只按地址下载 tar 包，不核对任何哈希，官方源也是这样；换成 npmmirror 等于从「信 GitHub 上的发布」换成「信 npmmirror 的同步」。2026-09-26 取 `v11.10.0` 的 `node-v127-linux-x64` 包，两边 sha256 都是 `ea6a09d12d43cca31782ab0e09ecf442b8e2a49f5a02b219f5f117a6601ed306`。不愿意信它就不设这个变量（回到 GitHub releases），或者以后改成从源码编译（构建阶段已经装了 python3、make、g++）。
- **Node 工具缓存**：actions/setup-node v7 对 `22` 这种范围、`check-latest` 为 false 时先调 `@actions/tool-cache` 的 `find`，在 `$RUNNER_TOOL_CACHE/node/<版本>/x64`（同级要有 `x64.complete` 标记）里挑最高的 22.x，找到就不下载。runner 的 `RUNNER_TOOL_CACHE` 是 `<runner 目录>/_work/_tool`：常驻 CI 是 `/home/runner/r1`、`r2` 下的，一次性 runner 是 `/home/runner/actions-runner` 下的；`job-started.sh` 只清 `_work/<仓库>/<仓库>`，工具缓存留得住。缓存里的版本与 `/usr/local` 相同，只在重做容器或 jit 镜像时更新到当时最新的 22.x LTS。包下载到这次运行用 `mktemp -d` 新建的目录里，按 SHASUMS256 核对通过（记在脚本变量里，不看 `/tmp` 里有没有同名文件：`/tmp` 对 job 可写）才解进 `/usr/local` 与工具缓存，脚本退出时整个目录删掉；核对不过就退出，不写 `x64.complete`。
- **实测**（2026-09-26，crosery-arch 宿主机自己的 Docker，同一份代码各构建一次，`--no-cache`、基础镜像已在本地）：server 镜像用官方源 1847 秒（`apt-get` 那条 RUN 1737 秒：索引 41.3kB/s、75MB 包 51.2kB/s；`pnpm install` 75.9 秒），用上表的镜像源 80 秒（那条 RUN 33.7 秒，`pnpm install` 7.1 秒）；web 134 秒对 57 秒，forum 105 秒对 49 秒。镜像源构建里 prebuild-install 的下载缓存文件名前缀等于 npmmirror 地址的 sha512 前 6 位，说明 pnpm 把 `npm_config_better_sqlite3_binary_host` 传到了 prebuild-install。
- **生效条件**：改了 `container-setup.sh`，要按上文重跑一次常驻容器的 `container-setup.sh ci`、按下文重做一次性 runner 的镜像（`jit-image.sh`），缓存才会出现；仓库变量设好后下一次运行即生效。

### 部署用的一次性 runner

部署 job 要用预发布的 SSH 私钥（与正式环境同一台服务器），不能放在常驻容器里；这里每个 job 一个全新容器，跑完就删（#97）。

| 项 | 取值 |
|---|---|
| 容器 | 同一台 crosery-arch；每个 job 一个非特权 incus 系统容器 `ydeploy-<时间>-<随机>`（Ubuntu 24.04，容器里有自己的 Docker），限 6 线程、8G 内存；是 incus 的 ephemeral 实例，关机即删除 |
| 注册 | 组织级 JIT runner：runner 组 `yzgc-deploy`（id 3，只放行 `admin` 仓库；`admin` 公开后于 2026-09-26 打开「允许公开仓库」。改这个设置之前注册的 JIT runner 不接公开仓库的 job：v0.1.0-rc.8 的 plan job 排了 10 分钟没人领，旧 runner 到 8 小时上限被回收时这个 job 跟着被取消，池子补上新 runner 后重跑才领走。改组设置后要等旧 runner 换完，或者在宿主机上重启 `yzgc-jit-pool` 立即换），标签 `yzgc-deploy`。每台只接一个 job，job 结束后 GitHub 自动注销它 |
| 补位 | 宿主机 systemd 服务 `yzgc-jit-pool`（`deploy/runner/jit-pool.sh`）始终保持 2 个在跑的容器：一个 job 跑完容器关机，几秒后补一个新的，新容器从镜像 `yzgc-deploy` 起，十几秒就能接活。每 10 分钟维护一次：删掉启动失败留下的停机实例；注销容器已经没了的离线 runner；空闲超过 5 小时的 runner 先在 GitHub 上注销（忙时 GitHub 拒绝）再删容器。容器里的服务另有 8 小时上限兜底，接到 job 的 runner（build 最长 60 分钟）不会在 job 中途被杀 |
| 凭据 | 一个 fine-grained 令牌，只有组织权限「Self-hosted runners: Read and write」，存在宿主机 `/etc/yzgc-runner/github.header`（root 0600），只用来生成 JIT 配置、删离线 runner，不进仓库、镜像、日志和容器。容器里只有自己这一次的 JIT 配置：读进环境变量后删掉文件，runner 不把它传给 job；但 runner 会把解出的凭据写进 `actions-runner/.credentials*`，job 与 runner 同一个用户，读得到。那只是这台 runner 自己的凭据，随 job 结束注销 |
| 网络 | 单独的网桥 `incusdeploy`（10.78.0.0/24），和常驻 CI 容器不在同一个二层网段（incus 的 ACL 管不到同一网桥上容器之间的流量）；网卡开 `security.port_isolation`（部署容器之间互相不通，只能到网关）与 `security.ipv4_filtering`（不能冒用别的 IP、MAC）；出站 ACL 与 CI 相同 |
| 镜像 | `jit-image.sh` 做：`container-setup.sh jit`（与 CI 容器同样的工具、Docker、Node 与 runner，Node 22 同时解进 `/home/runner/actions-runner/_work/_tool`，见上文「构建下载源」），再预拉三个 Dockerfile 的基础镜像（按 digest），清掉 machine-id 后发布为 `yzgc-deploy` |
| 下载镜像归档 | deploy job 不用 `actions/download-artifact`，改用 `scripts/fetch-artifact.mjs`（#99）：家里单连接从 GitHub 的存储下载只有 40–220KB/s，163MB 要 15–60 分钟（`v0.1.0-rc.6` 实测）；同一地址并发 16 段 Range 请求约 6.6MB/s。下载地址约 1 分钟过期，每段重试时重新取；一段连续 60 秒没收到数据（等响应头或下一块数据；连接卡住不报错，#111）也算失败，断开后重新取地址重试，可用 `--idle-seconds`（1–600）调整，只限空闲时长、不限一段的总时长；查 artifact 列表的 API 请求也限这么久，超时直接失败；只核对总字节数与 zip 的 CRC，归档内容仍由目标机 `sha256sum -c` 核对。job 权限因此多一个 `actions: read` |

**重建**：宿主机 root 在 `deploy/runner/` 里依次运行 `host-setup.sh`（也建 `incusdeploy` 网桥与 profile `yzgc-deploy`）→ `sh jit-image.sh $(grep -ho '^FROM [^ ]*@sha256:[0-9a-f]*' ../../app/*/Dockerfile | cut -d' ' -f2 | sort -u)` → 把令牌从 stdin 喂给 `sh jit-pool.sh token`（不进命令行）→ `sh jit-pool.sh install`。基础镜像的 digest 或 runner 版本变了就重做一次镜像，已经在跑的容器不受影响。

**令牌轮换**：令牌到期后补位进程拿不到 JIT 配置，日志（`journalctl -u yzgc-jit-pool`）里是「拿不到 JIT 配置」，部署 job 排队。到期前在所有者账号下新建一个同样权限的令牌（资源所有者选组织，只勾「Self-hosted runners: Read and write」），再跑一次 `sh jit-pool.sh token`，不用重启服务；旧令牌随后在 GitHub 上删掉。

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

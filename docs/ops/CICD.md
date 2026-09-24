# CI/CD 与部署控制

> 五工作流（ci / deploy-preview / deploy-production / branch-hygiene / issue-lifecycle）+ `.env` 驱动；发版只由发布 tag 触发（`vX.Y.Z-rc.N` → 预发布，`vX.Y.Z` → 正式），push 分支只跑 CI；部署开关默认关闭，机器检查不替代人工验收。

状态：`accepted` · 更新：2026-09-24 · 实施状态：工作流为 `.github/workflows/ci.yml`、`deploy-preview.yml`、`deploy-production.yml`、`branch-hygiene.yml`、`issue-lifecycle.yml`，actionlint 全绿。两条部署工作流由 SemVer 发布 tag 触发（2026-09-24 所有者指令），此前「push `stage`/`main` 即部署」的触发方式已删除；更早的 `preview.yml`、`release.yml`（`release-*`/`prev-*` tag）也早已删除。GitHub Environments（`preview`/`production`）、环境级 secrets/vars、目标机栈目录与镜像分发通道均**尚未配置**：这些是启用部署前必须由维护者手工完成的前置条件，本文档或任何工作流都不会自动创建。

发布规则以 [RELEASES](../conventions/RELEASES.md) 为唯一完整规范，分支模型以 [BRANCHING](../conventions/BRANCHING.md) 为准，环境字段契约见 [ENVIRONMENTS](ENVIRONMENTS.md)。

## 触发与职责

| 工作流 | 触发 | 行为 |
|---|---|---|
| `ci.yml` | PR → `main`/`stage`；push `main`/`stage`/`task/**`/`dev/**`（不含 tag）；`workflow_dispatch` | `branch-guard`（分支不变量）→ `core`（Node 22：check/test/build）∥ `forum`（Node ≥26：check/generate）∥ `env-contract`（`.env` 与 `environments.json`、compose 一致性，前端站点配置不含域名）∥ `docker`（`deploy/compose/{production,preview}.yml` 解析 + 三条镜像构建验证）→ `verify` 汇总 |
| `deploy-preview.yml` | push tag `v[0-9]+.[0-9]+.[0-9]+-rc.[0-9]+`；`workflow_dispatch`（必填 `tag`，并从同名 tag 运行） | 断言 ref 是 `refs/tags/vX.Y.Z-rc.N` → `release-policy` 规划（提交在 `origin/stage` 上、版本等于 `package.json`）→ 构建镜像 → 渲染 `.env.preview` → SSH 分发镜像与环境文件 → `deploy-stack.sh` → 健康检查 → 记录 deployment（payload 带 rc tag）。开关 `vars.DEPLOY_PREVIEW_ENABLED`；同一时刻只跑一个，不取消正在跑的运行 |
| `deploy-production.yml` | push tag `v[0-9]+.[0-9]+.[0-9]+`；`workflow_dispatch`（必填 `tag`，并从同名 tag 运行） | 断言 ref 是 `refs/tags/vX.Y.Z`（rc tag 被拒绝）→ `release-policy` 规划（提交在 `origin/main` 上、同一提交有 `vX.Y.Z-rc.N`）→ 证据检查（见下文）→ 构建镜像 → 分发 `.env.production` → 部署 → 记录 deployment。开关 `vars.DEPLOY_PRODUCTION_ENABLED`，`environment: production`，不取消正在跑的运行 |
| `branch-hygiene.yml` | PR `closed`（`merged == true`）、每周一 03:17 UTC、`workflow_dispatch` | 合并后删除 head 为 `task/**` 的本仓分支（`contents: write`，只删 `task/**`，**永不**自动删 `dev/**` 或长期分支）；每周巡检远端 `task/**`，对「14 天无提交活动且无 open PR」的残留分支只输出 `::warning::` 与 step summary，不删除 |
| `issue-lifecycle.yml` | PR 指向 `stage` 的 opened / edited / synchronize / reopened / closed、每周一 03:37 UTC、`workflow_dispatch` | `pr-contract`：核对 PR 正文契约（`Closes #<issue>` 与 task 分支号一致、issue 存在且开着、九个必需段落、验收证据、审查结论；`scripts/pr-contract.mjs`，只检出默认分支上的脚本，不执行 PR 代码）；`close-on-merge`：合并进 `stage` 后关闭 issue 并在 issue 与 PR 上各留一条追踪记录（`issues: write`、`pull-requests: write`）；每周巡检「PR 已合并但 issue 还开着」「issue 开着但没有分支也没有 PR」，只告警 |

- **push `stage` 或 `main` 不部署任何环境**，只跑 `ci.yml`。部署只由发布 tag 触发，规则见 [RELEASES](../conventions/RELEASES.md)。GitHub 的 tag 过滤按整个 tag 名匹配：`deploy-production.yml` 的 `v[0-9]+.[0-9]+.[0-9]+` 不含 `-`，匹配不到 `vX.Y.Z-rc.N`；两条部署工作流的 plan job 还会用完整正则再断言一次，前导 0、`rc.0` 等格式也会被拒绝。
- 手工运行部署工作流时，「Use workflow from」必须选同一个发布 tag，并在 `tag` 输入框里填这个 tag；ref 与输入不一致即失败。手工运行只用于重新部署已有 tag，不创建 tag。
- 一次只推一个发布 tag：GitHub 在一次推送超过三个 tag 时不产生 push 事件，工作流不会运行。
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
2. 同一提交在 `preview` 环境有最新状态为 `success` 的 GitHub deployment 记录，且记录 payload 里的 `tag` 是上一条列出的 rc tag 之一（只按显式 deployment 记录判断；分支时代留下的、不带 tag 的旧记录不算）；
3. `https://prev.yangtzeu.work/release.json` 的 `environment` 是 `preview`，`commit` 是这个提交，`version` 是其中一个 rc 的 `X.Y.Z-rc.N@<sha12>`（`release.json` 由 web 镜像内置）：避免把「上一个预发布通过」推广到未经试用的新代码；
4. `production` GitHub Environment 已配置审批要求（部署 job 用 REST 实测 protection rules，不信任 YAML 里写了 `environment: production` 这一行）；
5. `DEPLOY_TARGET_ENVIRONMENT` 等于 `production`（防环境级变量回落）。

正式构建与预发布构建是同一提交、不同 build args 的两次构建，镜像 digest 不同，所以两者放在不同的镜像仓库里（见上文「镜像名按环境分开」）；工作流目前**不**比对两者的镜像内容。上述都是机器一致性检查，**不构成、也不能代替** [RELEASES](../conventions/RELEASES.md) 要求的人工试用与明确批准。

部署 job 的失败关闭行为：镜像 sha256 校验失败、env 校验失败、SSH 失败或健康门失败都让整条流水线失败，**不自动重试到未知状态**。部署脚本内部在健康门失败时会把 `IMAGE_TAG` 切回部署前的值、重新 `compose up -d` 并复检，结果记为 `ROLLED_BACK`（复检也失败记 `ROLLBACK_FAILED`）——这是脚本的环境自愈，不等于发布成功，也不改变「流水线失败」的结论；不写 `approved=true` 之类的放行状态，不自动覆盖更晚的部署。

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

## 明确不做的事

- 任何工作流都不自动创建/移动/删除 tag，不自动升级 `package.json` 版本，不写放行状态；发布 tag 由维护者在所有者授权后手工创建。
- 不从 `pull_request_target` 触发，不给 fork/PR 构建授予部署 secrets；自托管运行器不得接在有生产凭据或真实数据的机器上执行不可信 PR。
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

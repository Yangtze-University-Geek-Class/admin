# 环境与 `.env` 契约

> 两份入库 `.env` 的字段契约与可见性规则；地址端口直接写，密钥留空由 CI/CD 注入。

状态：`current` · 更新：2026-09-26 · 机器配置：[deploy/environments.json](../../deploy/environments.json)

## 可见性规则

1. **环境变量只经 `.env` 文件**，不同环境用不同后缀：`deploy/env/.env.production`、`deploy/env/.env.preview`。
2. 这两个文件**提交入库**。**非密钥项**（服务地址、端口、域名、路径、开关）全部预填真实值——部署事实直接可见，机器与人都能一眼看清每个环境长什么样。
3. **密钥项必须留空**（`KEY=`），由 CI/CD 用 GitHub 环境级 secrets 渲染到目标机 `<STACK_ROOT>/.env.<environment>`，仓库里永远没有真值。留空的值在渲染/校验时**失败关闭**：缺密钥就没有部署。
4. 语义上「留空即代表无值」的字段（`COOKIE_DOMAIN`、`ALLOWED_ORGS`）同样留空，但含义明确，不算缺失。
5. 目标机运行时文件名固定为 `<STACK_ROOT>/.env.production` / `<STACK_ROOT>/.env.preview`，由 `docker compose --env-file <文件> -f deploy/compose/<环境>.yml` 消费。
6. 禁止把真实密钥写入仓库、镜像、日志或发布记录；不得把某环境的密钥复用到另一环境。

## 字段契约

下表列出两份模板中都存在的字段。取值列为当前入库值（地址/端口是部署事实）。

| 字段 | 可见性 | production | preview |
|---|---|---|---|
| `GEEK_DEPLOYMENT_ENVIRONMENT` | 可见 | `production` | `preview` |
| `GEEK_ENVIRONMENT_ORIGIN` | 可见 | `https://yangtzeu.work` | `https://prev.yangtzeu.work` |
| `COMPOSE_PROJECT_NAME` | 可见 | `yzgc-production` | `yzgc-preview` |
| `STACK_ROOT` | 可见 | `/opt/yzgc/production` | `/opt/yzgc/preview` |
| `DEPLOY_HOST` | 可见 | `103.117.123.226` | 同左（同机不同栈） |
| `DEPLOY_PORT` | 可见 | `22000` | `22000` |
| `DEPLOY_USER` | 可见 | `root` | `root` |
| `IMAGE_TAG` | 可见 | `unset`（部署时写入本次 `<sha12>`） | 同左 |
| `WEB_BIND` | 可见 | `127.0.0.1:18100`（宿主 → web 容器 8080） | `127.0.0.1:18200`（宿主 → web 容器 8080） |
| `SERVER_BIND` | 可见 | `127.0.0.1:18101` | `127.0.0.1:18201` |
| `SERVER_PORT` / `FORUM_PORT` | 可见 | `3000` / `3000`（容器内） | `3000` / `3000`（容器内） |
| `PORT` | 可见 | `3000`（容器内监听） | `3000` |
| `FORUM_PORT` 改值注意 | — | 必须与 forum 镜像内 nginx 的 `listen`/`EXPOSE` 及 web 容器 `proxy_pass http://forum:3000/` 三处同时改 | 同左 |
| `HOST` | 可见 | `0.0.0.0`（容器内必须绑定全网卡，否则 web 容器连不上） | `0.0.0.0` |
| `TRUST_PROXY` | 可见 | `2`：反代层数（客户端 → 宿主 nginx → web 容器 nginx → server），只信任这两层追加的 `X-Forwarded-For`。**不能写 `true`**：会把客户端自己填的最左边一段当成客户端 IP，所有按 IP 的限流（投递、邀请、反馈、论坛）和审计 IP 都能伪造。`pnpm check:environments` 要求等于 `scripts/deployment-environment.mjs` 的 `PROXY_HOPS`，测试核对它与两份 nginx 配置一致 | `2` |
| `PUBLIC_ORIGIN` | 可见 | `https://yangtzeu.work`（必须逐字等于 `deploy/environments.json` 的 origin） | `https://prev.yangtzeu.work`（同左） |
| `NODE_ENV` | 可见 | `production` | `production` |
| `DB_PATH` | 可见 | `/data/data.db`（命名卷内） | `/data/data.db` |
| `FORUM_DB_PATH` / `FORUM_UPLOAD_DIR` | 可见（兼容字段，服务不打开旧 `forum.db`、不写上传目录；论坛数据在 `DB_PATH` 的 `forum_*` 表，头像也存在库里，#57） | `/data/forum.db` / `/data/forum-uploads` | 同左 |
| `COOKIE_DOMAIN` | 可见·留空 | 空 = host-only；**禁止**填写 | 空 = host-only；**禁止** `.yangtzeu.work` |
| `POW_DIFFICULTY` | 可见 | `3` | `3` |
| `ALLOWED_ORGS` | 可见·留空 | 空 = 不限制组织允许列表 | 空 |
| `CONSOLE_ORG` | 可见 | `Yangtze-University-Geek-Class`（极客班控制台 `/api/console/*` 固定管理的组织；`ALLOWED_ORGS` 非空时必须包含它，否则 server 启动失败） | 同左 |
| `GEEK_RELEASE_DISPLAY_SUFFIX` | **已移除** | 不再出现在 env 文件里：它是 `BUILD_ONLY_FIELDS`（发布身份只走 build args），写进 `.env` 不会被读取 | 同左 |
| `OAUTH_CLIENT_ID` | **密钥·必须留空** | CI/CD 注入 | CI/CD 注入 |
| `OAUTH_CLIENT_SECRET` | **密钥·必须留空** | CI/CD 注入 | CI/CD 注入 |
| `SESSION_SECRET` | **密钥·必须留空** | CI/CD 注入 | CI/CD 注入 |
| `ENCRYPTION_KEY` | **密钥·必须留空** | CI/CD 注入 | CI/CD 注入 |
| `TURNSTILE_SITE_KEY` | **密钥·必须留空** | CI/CD 注入 | CI/CD 注入 |
| `TURNSTILE_SECRET_KEY` | **密钥·必须留空** | CI/CD 注入 | CI/CD 注入 |

**一个环境只有一个域名**（项目所有者 2026-09-23 决定）：官网、管理端、论坛共用 `PUBLIC_ORIGIN`，按 URL 路径区分——`/admin`、`/admin/…`、`/console`、`/console/…`、`/signin` 进管理端 SPA，`/forum/…` 进论坛，其余进官网。旧的按站点分域名字段 `SITE_ORIGIN`、`ADMIN_HOST`、`PORTAL_HOST`、`FORUM_HOST` 已退役，校验器把模板里任何契约外的字段判为失败，防止重新长出第二份域名配置。

校验：`node scripts/deployment-environment.mjs --check`（`pnpm check:environments`）核对模板字段完整性、契约外字段、密钥留空、`PUBLIC_ORIGIN` 与 `deploy/environments.json` 逐字一致、两环境取值差异；`node scripts/deployment-environment.mjs render --environment <env> --out <路径> --image-tag <sha12>` 生成目标机运行时文件（只读仓库、只写显式 `--out`）。

**不在 env 文件里的发布身份**：`GEEK_RELEASE_VERSION`（正式 tag `vX.Y.Z` → `X.Y.Z`；预发布 tag `vX.Y.Z-rc.N` → `X.Y.Z-rc.N@<sha12>`）与 `GEEK_RELEASE_COMMIT`（完整 40 位 SHA）由 CI/CD 作为**构建参数**传给镜像构建，不写进 `.env`——写死就等于让展示值与实际 commit 脱钩。展示规则见 [RELEASES](../conventions/RELEASES.md)。

本机开发用的 `.env` 是另一回事：模板见 [ENVIRONMENT](ENVIRONMENT.md)，由操作者自建、不入库、只连本机数据。

## GitHub Environment 配置

环境名固定为 `preview` 与 `production`，两者条目**同名**、**取值必须不同**。工作流行为与证据链见 [CICD](CICD.md)；这里是配置清单本身。

### 环境级 secrets（`preview` / `production` 各一套）

| 名称 | 用途 |
|---|---|
| `DEPLOY_SSH_HOST` | 部署目标机地址 |
| `DEPLOY_SSH_PORT` | SSH 端口 |
| `DEPLOY_SSH_USER` | 部署用户 |
| `DEPLOY_SSH_KEY` | SSH 私钥全文 |
| `DEPLOY_SSH_KNOWN_HOSTS` | 目标机主机公钥行（`StrictHostKeyChecking=yes`） |
| `OAUTH_CLIENT_ID` | GitHub OAuth 应用 ID → 渲染进运行时 `.env`（每个环境一个独立的 OAuth App，见下文） |
| `OAUTH_CLIENT_SECRET` | GitHub OAuth 应用密钥 → 运行时 `.env` |
| `SESSION_SECRET` | 会话签名密钥（≥32 字符随机值） |
| `ENCRYPTION_KEY` | 32 字节密钥的 base64（GitHub token 加密） |
| `TURNSTILE_SITE_KEY` | Cloudflare Turnstile 站点键 |
| `TURNSTILE_SECRET_KEY` | Cloudflare Turnstile 服务端密钥 |

Turnstile 两项是可选的一对（`scripts/deployment-environment.mjs` 的 `OPTIONAL_SECRET_PAIR`）：**都为空＝明确关闭**，渲染时写空值并提示；只填一项仍拒绝渲染；其余密钥一律必填。关闭时服务端 `middleware/turnstile.ts` 不校验人机验证，公开的投递、反馈、邀请只靠工作量证明（`POW_DIFFICULTY`）、蜜罐字段与限流；遗留风险是批量脚本的成本只剩计算量，要开启时在 Cloudflare 建站点后把两项同时配进环境级 secrets 并重新部署。首次上线（2026-09-25）两个环境都关闭。

### vars

| 层级 | 名称 | 取值 / 作用 |
|---|---|---|
| 环境级 | `DEPLOY_TARGET_ENVIRONMENT` | 哨兵：必须逐字等于所在环境名（`preview` / `production`）；不等即失败关闭 |
| 仓库级 | `DEPLOY_PREVIEW_ENABLED` | 取值 `enabled` 才运行 `deploy-preview` 的部署 job；默认不设置 = 关闭 |
| 仓库级 | `DEPLOY_PRODUCTION_ENABLED` | 取值 `enabled` 才运行 `deploy-production` 的部署 job；默认不设置 = 关闭 |

**不要在仓库级创建任何 `DEPLOY_*` 同名条目**：环境级缺失时 GitHub 会静默回落到仓库级值，两个环境可能因此指向同一台机器。

### GitHub OAuth App 回调地址

服务端发起登录时的 `redirect_uri` 固定为 `<PUBLIC_ORIGIN>/auth/callback`（`app/server/src/lib/auth.ts`）。GitHub 在 OAuth App 未开启通配匹配时要求它与登记的 Callback URL **完全一致**（[GitHub 文档](https://docs.github.com/en/apps/oauth-apps/building-oauth-apps/authorizing-oauth-apps)，2026-09-24 核对），所以：

| 环境 | Callback URL | 说明 |
|---|---|---|
| production | `https://yangtzeu.work/auth/callback` | 沿用现有 OAuth App，**切换当天由所有者把它的 Callback URL 从 `https://github.yangtzeu.work/auth/callback` 改成这一条**；不改则正式环境登录失败 |
| preview | `https://prev.yangtzeu.work/auth/callback` | 需要单独建一个 OAuth App：密钥永不跨环境共用，它的 ID/密钥只放进 `preview` 环境的 secrets |

登录成功后默认回到 `<PUBLIC_ORIGIN>/console`；`return_to` 只接受同一个 origin。

## DNS / TLS 前置

| 域名 | 指向 | 用途 |
|---|---|---|
| `yangtzeu.work` | `103.117.123.226` | 正式环境唯一入口（官网、`/admin`、`/console`、`/forum`） |
| `prev.yangtzeu.work` | `103.117.123.226`（A 记录已生效） | 预发布环境唯一入口（同上） |
| `github.yangtzeu.work` | `103.117.123.226` | 已退役的正式管理端域名：宿主 nginx 整站 301 到 `https://yangtzeu.work`（保留路径），旧书签和已发出的 `/join/<token>` 邀请链接继续可用；保留证书续期即可 |

- 2026-09-24 用 `dig +short` 核对：上面三个域名都解析到 `103.117.123.226`。预发布**不需要**额外的管理端子域名记录。
- `prev.yangtzeu.work` 的证书尚未确认已签发；签发前预发布入口不可用（容器端口可通，但 HTTPS 访问失败）。
- TLS 由宿主 nginx 终止，证书用 certbot 按域名签发；本地开发不执行这些操作。
- 改完 nginx 配置先 `nginx -t` 再 reload；不要为了排错关闭 HTTPS 或引入 HTTP 回退。

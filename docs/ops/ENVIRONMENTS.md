# 环境与 `.env` 契约

> 三份仓库环境模板（正式、预发布、本机）、Arch/HK 发布目标与副本外发门禁；已接管的权威源保持原行为，模板、运行配置和数据库有效设置分别核对。

状态：`current` · 更新：2026-10-31 · 适用：两套隔离栈；机器身份：[deploy/environments.json](../../deploy/environments.json)，运行现状及授权见 [DEPLOY](DEPLOY.md#迁移现状与授权边界)。

## 可见性规则

1. **环境变量只经 `.env` 文件**，不同环境用不同后缀：`deploy/env/.env.production`、`deploy/env/.env.preview`，本机调试另有 `deploy/env/.env.dev`。三份键集一致、值互相隔离，由 `pnpm check:env-isolation` 核对（[RELEASE-PARITY](../conventions/RELEASE-PARITY.md) 第一节）。
2. 这三个文件**提交入库**；非密地址、端口、路径和开关对齐 Arch 目标。模板、真实运行配置、GitHub 配置和工作流执行仍分别取证。
3. **密钥项必须留空**（`KEY=`），由 CI/CD 用 GitHub 环境级 secrets 渲染到目标机 `<STACK_ROOT>/.env.<environment>`，仓库里永远没有真值。必填的密钥留空时，渲染/校验**失败关闭**：缺必填密钥就没有部署；Turnstile 和发信的几项可以不配，见下文「环境级 secrets」。
4. 语义上「留空即代表无值」的字段（`COOKIE_DOMAIN`、`MAIL_REPLY_TO`）同样留空，但含义明确，不算缺失。
5. 目标机运行时文件名固定为 `<STACK_ROOT>/.env.production` / `<STACK_ROOT>/.env.preview`，由 `docker compose --env-file <文件> -f deploy/compose/<环境>.yml` 消费。
6. 禁止把真实密钥写入仓库、镜像、日志或发布记录；不得把某环境的密钥复用到另一环境。

## 字段契约

下表是已接管的 Arch 双栈配置。2026-10-26 无损迁移保留原应用设置，两个环境邮件 all、预发布 sync on；这些是权威源而非同时运行的副本。模板与真实配置仍须分别核对，隔离副本另遵守下文安全门禁。

| 字段 | 可见性 | production | preview |
|---|---|---|---|
| `GEEK_DEPLOYMENT_ENVIRONMENT` | 可见 | `production` | `preview` |
| `GEEK_ENVIRONMENT_ORIGIN` | 可见 | `https://yangtzeu.work` | `https://prev.yangtzeu.work` |
| `COMPOSE_PROJECT_NAME` | 可见 | `yzgc-production` | `yzgc-preview` |
| `STACK_ROOT` | 可见 | `/opt/yzgc/production` | `/opt/yzgc/preview` |
| `DEPLOY_HOST` | 可见 | `10.66.0.2`（Arch tun0） | 同左（同机双栈） |
| `DEPLOY_PORT` | 可见 | `22` | `22` |
| `DEPLOY_USER` | 可见 | `root`（模板目标，非权限/连通证明） | 同左 |
| `DEPLOY_PROXY_JUMP` | 可见·可留空 | `root@156.238.244.78:22`（香港跳板） | 同左；直连必须显式留空 |
| `IMAGE_TAG` | 可见 | `unset`（部署时写入本次 `<sha12>`） | 同左 |
| `WEB_BIND` | 可见 | `10.66.0.2:18100`（tun0 → web 容器 8080） | `10.66.0.2:18200` |
| `SERVER_BIND` | 可见 | `127.0.0.1:18101` | `127.0.0.1:18201` |
| `SERVER_PORT` / `FORUM_PORT` | 可见 | `3000` / `3000`（容器内） | `3000` / `3000`（容器内） |
| `PORT` | 可见 | `3000`（容器内监听） | `3000` |
| `FORUM_PORT` 改值注意 | — | 必须与 forum 镜像内 nginx 的 `listen`/`EXPOSE` 及 web 容器 `proxy_pass http://forum:3000/` 三处同时改 | 同左 |
| `HOST` | 可见 | `0.0.0.0`（容器内必须绑定全网卡，否则 web 容器连不上） | `0.0.0.0` |
| `TRUST_PROXY` | 可见 | `2`：Caddy → web nginx → server；过渡旧入口的客户端地址由 Caddy 按来源重新构造，隧道不计 HTTP 层；禁止 `true` | `2` |
| `PUBLIC_ORIGIN` | 可见 | `https://yangtzeu.work`（必须逐字等于 `deploy/environments.json` 的 origin） | `https://prev.yangtzeu.work`（同左） |
| `NODE_ENV` | 可见 | `production` | `production` |
| `DB_PATH` | 可见 | `/data/data.db`（命名卷内） | `/data/data.db` |
| `FORUM_DB_PATH` / `FORUM_UPLOAD_DIR` | 可见（兼容字段，服务不打开旧 `forum.db`、不写上传目录；论坛数据在 `DB_PATH` 的 `forum_*` 表，头像也存在库里，#57） | `/data/forum.db` / `/data/forum-uploads` | 同左 |
| `COOKIE_DOMAIN` | 可见·留空 | 空 = host-only；**禁止**填写 | 空 = host-only；**禁止** `.yangtzeu.work` |
| `POW_DIFFICULTY` | 可见 | `3` | `3` |
| `SHIELD_ENABLED` | 可见 | `on`：访问防护总开关，server 与 web 容器 nginx 都读；`off` 时 server 的计分、封禁、蜜罐与告知都不生效（server 自己的全站上限与接口限流计数照常），web nginx 的第一层限流也整体不生效。只认 `on`、`off`，写错时 server 与 web 都起不来（开发环境 `.env.dev` 用，#333） | `off`（仅 `.env.dev`），正式与预发布 `on` |
| `SHIELD_THRESHOLD` | 可见 | `120`：10 分钟内总分到此封禁（#333） | `120` |
| `SHIELD_WINDOW_MINUTES` | 可见 | `10`：信号的计分窗口 | `10` |
| `SHIELD_BLOCK_MINUTES` | 可见 | `15,60,360,1440`：逐级封禁的分钟数，到顶为止 | `15,60,360,1440` |
| `SHIELD_DECAY_HOURS` | 可见 | `24`：上一段封禁结束后安静这么久，级别归零 | `24` |
| `SITE_QUOTA_EMAIL_DAILY` | 可见 | `2000`：全站每个北京日的发码上限，`-1` 不限（#319） | `2000` |
| `SITE_QUOTA_REGISTER_DAILY` | 可见 | `300`：全站每个北京日的新注册上限 | `300` |
| `SITE_QUOTA_FEEDBACK_DAILY` | 可见 | `200`：全站每个北京日的意见箱上限 | `200` |
| `SITE_QUOTA_DEVICE_CODE_DAILY` | 可见 | `500`：全站每个北京日的命令行设备码上限 | `500` |
| `EMAIL_RECIPIENT_QUOTA_DAILY` | 可见 | `10`：同一收件人每个北京日的验证码上限（#319） | `10` |
| `REGISTER_NO_COOKIE_IP_DAILY` | 可见 | `3`：没有 visitor cookie 的注册，每个 IP 每个北京日的上限 | `3` |
| `MAIL_ALIYUN_FROM` | 密钥·留空，阿里云发信时必填 | 环境密钥：阿里云邮件推送的发信地址，不带显示名，由 CI/CD 注入 | 同左 |
| `MAIL_RESEND_FROM` | 密钥·留空，Resend 发信时必填 | 环境密钥：Resend 的发件地址，发出时写成 `长江大学极客班 <地址>`，由 CI/CD 注入 | 同左 |
| `MAIL_ASSET_BASE` | 可见 | `https://cdn.crosery.com/yzgc/mail/v1/`（信里图片的地址前缀：https，以 `/` 结尾，不带查询串） | 同左 |
| `STATIC_CDN_ORIGIN` | 可见 | 静态资源 CDN 的源站（https，不带路径、尾斜杠和查询），三份 env 的值相同。构建开关 `STATIC_CDN_BASE` 与服务端只接受由它派生的 `<源站>/yzgc/static/site/`；开关打开而缺它时失败关闭（#360） | 同左 |
| `MAIL_REPLY_TO` | 可见·留空 | 空 = 信里不带 Reply-To，改请对方到官网意见箱留言；要填就写一个不带显示名的地址 | 空 |
| `MAIL_RECIPIENTS` | 可见 | `all`，沿用接管前设置 | `all`，沿用接管前设置 |
| `GITLAB_SYNC` | 可见 | `off`，完整旧身份对账后才开启 | `on` 是独立实例的目标配置；切换前不能部署旧令牌或复用旧绑定 |
| `GITLAB_URL` | 可见 | `https://yangtzeu.work/gitlab`（#335：和预发布一样在本环境入口的 `/gitlab` 下；旧主机 `git.yangtzeu.work` 只做 301） | `https://prev.yangtzeu.work/gitlab`；保留部署子路径的独立基址 |
| `GITLAB_GROUP` | 可见 | `geek` | `geek`，两个实例各自的群组 |
| `GITLAB_EVENTS_INTERVAL_MINUTES` | 可见 | `10`：GitLab 项目事件只读拉取的间隔（分钟）；`0` 关闭，`1`–`1440` 为间隔，留空按 10；与 `GITLAB_SYNC` 无关（#370） | `10`，与正式相同 |
| `GITLAB_OIDC_CLIENT` | 可见 | `gitlab` | `gitlab_preview`，不覆盖仍被旧正式登录使用的预发布客户端 |
| `GITLAB_OIDC_SECTOR` | 可见 | `git.yangtzeu.work`：`gitlab` 客户端钉住的 sector，沿用搬家前的主机，成员的 `sub` 不变（#335） | `prev.yangtzeu.work`；同步核对客户端钉住的 sector 和它一致，不一致整轮跳过 |
| `GITLAB_STACK_ROOT` | 可见 | `/srv/gitlab`，保留原卷与账号 | `/srv/gitlab-preview`，全新独立数据 |
| `GITLAB_HTTP_BIND` | 可见 | `10.66.0.2:8929` | `10.66.0.2:8930`，仅隧道入口 |
| `GITLAB_DOCKER_SUBNET` | 可见 | `172.31.29.0/24` | `172.31.30.0/24`，不共享网络 |
| `GITLAB_DOCKER_GATEWAY` | 可见 | `172.31.29.1` | `172.31.30.1` |
| `GEEK_RELEASE_DISPLAY_SUFFIX` | **已移除** | 不再出现在 env 文件里：它是 `BUILD_ONLY_FIELDS`（发布身份只走 build args），写进 `.env` 不会被读取 | 同左 |
| `OAUTH_CLIENT_ID` | **密钥·必须留空** | CI/CD 注入 | CI/CD 注入 |
| `OAUTH_CLIENT_SECRET` | **密钥·必须留空** | CI/CD 注入 | CI/CD 注入 |
| `SESSION_SECRET` | **密钥·必须留空** | CI/CD 注入 | CI/CD 注入 |
| `ENCRYPTION_KEY` | **密钥·必须留空** | CI/CD 注入 | CI/CD 注入 |
| `TURNSTILE_SITE_KEY` | **密钥·必须留空** | CI/CD 注入 | CI/CD 注入 |
| `TURNSTILE_SECRET_KEY` | **密钥·必须留空** | CI/CD 注入 | CI/CD 注入 |
| `MAIL_ALIYUN_ACCESS_KEY_ID` / `MAIL_ALIYUN_ACCESS_KEY_SECRET` | 密钥·留空，可选的一对 | CI/CD 注入，可以不配 | 同左 |
| `MAIL_RESEND_API_KEY` | 密钥·留空，可选 | CI/CD 注入，可以不配 | 同左 |
| `MAIL_ALLOWLIST` | 密钥·留空，可选 | `allowlist` 模式使用；迁移副本必须空，不得从原环境秘密注入后误放行 | 同左 |
| `SHIELD_ALLOWLIST` | 密钥·留空，可选 | 访问防护的豁免网段（IP 或 CIDR，逗号分隔）：server 不计分、不封，web 容器 nginx 的第一层限流也不计；写错时两个容器都起不来，错误只报第几段、不打印网段；空 = 没有豁免（#333） | 同左 |
| `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET` | 密钥·留空，可选的一对 | 没配：登录页不出现 Google | 同左 |
| `OIDC_JWKS` | 密钥·留空，可选 | 没配：对外授权关闭，`/oidc/*` 一律 404 | 同左 |
| `GITLAB_API_TOKEN` | 密钥·留空，`GITLAB_SYNC=on` 时必填 | `GITLAB_SYNC=on` 才用 | 同左，`on` 时必填 |
| `BACKUP_S3_ENDPOINT` | 可见 | `https://s3.cn-south-1.qiniucs.com` | 同左 |
| `BACKUP_S3_REGION` | 可见 | `cn-south-1` | 同左 |
| `BACKUP_S3_PREFIX` | 可见 | `yzgc/production/backup/` | `yzgc/preview/backup/`，不能为空 |
| `BACKUP_S3_BUCKET` / `BACKUP_S3_ACCESS_KEY_ID` / `BACKUP_S3_SECRET_ACCESS_KEY` / `BACKUP_GPG_RECIPIENT` / `BACKUP_GPG_PUBLIC_KEY` | 密钥·留空 | CI/CD 注入 | 同左 |

**一个环境只有一个域名**（2026-09-23 决定）：官网、管理端、论坛共用 `PUBLIC_ORIGIN`，按 URL 路径区分——`/admin`、`/admin/…`、`/console`、`/console/…`、`/signin`、`/device`、`/account`、`/authorize` 进管理端 SPA，`/forum/…` 进论坛，`/oidc/…`（对外授权，#270）进 server，其余进官网。旧的按站点分域名字段 `SITE_ORIGIN`、`ADMIN_HOST`、`PORTAL_HOST`、`FORUM_HOST` 已退役，校验器把模板里任何契约外的字段判为失败，防止重新长出第二份域名配置。

校验：`node scripts/deployment-environment.mjs --check`（`pnpm check:environments`）核对模板字段、密钥留空、origin、两环境隔离、受限 bind 与 ProxyJump 语法；不会连接目标或读取业务数据库。`render --environment <env> --out <路径> --image-tag <sha12>` 只把模板与环境级秘密渲染到显式目标，不验证恢复库 effective mode 或收件人是否为空，不能单独作为副本启动门禁。

**不在 env 文件里的发布身份**：`GEEK_RELEASE_VERSION`（正式 tag `vX.Y.Z` → `X.Y.Z`；预发布 tag `vX.Y.Z-rc.N` → `X.Y.Z-rc.N@<sha12>`）与 `GEEK_RELEASE_COMMIT`（完整 40 位 SHA）由 CI/CD 作为**构建参数**传给镜像构建，不写进 `.env`——写死就等于让展示值与实际 commit 脱钩。展示规则见 [RELEASES](../conventions/RELEASES.md)。

本机调试用 `deploy/env/.env.dev`（入库，已脱敏）：`GEEK_DEPLOYMENT_ENVIRONMENT=local`（沿用论坛构建里的 `local`）、`PUBLIC_ORIGIN=http://127.0.0.1:5173`、数据在 `.tools/local-preview/`、`GITLAB_SYNC=off`、`GITLAB_EVENTS_INTERVAL_MINUTES=0`（本机 GitLab 通常不在运行，不拉事件）、`MAIL_RECIPIENTS=allowlist` 且名单为空；部署目标、镜像标签这类本机没有的键留空，密钥全部留空。需要本机后端时用 `pnpm local:up`（见 [TESTING](../conventions/TESTING.md)「本机开发」）：它把本机用的会话与加密密钥生成到 `.tools/local/secrets.json`，不写进 `.env`，也不需要复制模板。只看界面直接 `pnpm dev:web`，不连任何远端。字段说明与最小占位见 [ENVIRONMENT](ENVIRONMENT.md)。

**正式与预发布的差异键**：原有环境身份、栈路径/端口与 `GITLAB_SYNC`，另加上表六项独立 GitLab 目标字段。其余键两份取值必须相同。`check-env-isolation.mjs` 另外拒绝两个实例复用 URL、目录、绑定、子网或网关；公开客户端标识不命名为凭据字段，密钥检查规则不放宽。实际凭据、运行绑定与模板分别核验，模板修改不等于已切换。

**密钥在两个 GitHub 环境里必须同名同集**：预发布配了的密钥，正式也要配（第三方账号和域名不同，取值不同）。缺口登记在同构清单 `deploy/parity/ledger.json`，发版前清零（[RELEASE-PARITY](../conventions/RELEASE-PARITY.md) 第五节）。

香港共享入口的专用运维密钥 `GITLAB_EDGE_SSH_KEY` 只放在受 required reviewers 保护的 `production` 环境，不进入业务 `.env`，也不下放到普通预发布部署。它仅能调用固定的入口动作；这是宿主运维权限，不是两套应用的业务密钥。预发布的备份凭据是预发布环境自己的 `BACKUP_S3_ACCESS_KEY_ID` / `BACKUP_S3_SECRET_ACCESS_KEY` 与 `BACKUP_S3_BUCKET`，不能回落正式备份凭据。

## 副本启动安全门禁

- 仓库模板、`render` 或 `prepare-arch-runtime.mjs` 只处理 env，不清洗数据库业务设置。`app/server/src/lib/gitlab-sync.ts` 从 `app_state` 中 `key='gitlab_settings'` 的 JSON 读取 `mode`，覆盖 env；仅看到 `GITLAB_SYNC=off` 或准备器回执不能启动副本。
- `verify-arch-replica.mjs` 可只读核对指定 env/独立一致快照；持久 on/dry-run、缺原加密密钥、WAL/SHM/journal 状态均拒绝。成功只表示配置满足当前预部署合同，不证明密钥与原快照匹配或真实循环无外发；分发和命令见 [DEPLOY](DEPLOY.md#arch-副本启动前的独立门禁)。
- 核心真实入口会启动 GitLab 同步和贡献收集循环；`competition-candidates.ts` 按有效 GitLab mode 判定，`dry-run` 不等同 off。启动前须在出站隔离中证明恢复库 **effective mode=off**、贡献收集不外发/不计分、邮件空白名单及队列无外发；Compose bridge 网络名 `internal` 不会自动断网。
- 对恢复副本的设置调整属于数据写入，必须取得该环境和目标的明确批准；只操作获批复制库，保留原快照和旧源，不给出任意 UPDATE 线上库的捷径。保留原 `ENCRYPTION_KEY`、client、sector/sub 与 GitLab 关联；不为“安全副本”重建账号或随机换加密密钥。
- 最终接管身份源按单写者顺序：先停旧源的**有效**同步/贡献收集并证明停止 → 对账/保全关联与 sub → 只开启新权威源并逐成员核验 → 获批切换 issuer/client。`gitlab-cutover` 已提供排空、持久写口、canonical env 原子更新和原镜像重启路径，不要求另发 rc。只读状态不证明旧进程已换模式；模板默认值也不等于运行状态。邮件恢复外发另行授权。

## SSH 与跳板绑定

`deployment-environment.mjs ssh-config` 在任何 SSH/SCP 之前严格核对环境哨兵和 `DEPLOY_SSH_HOST/PORT/USER` 与该提交模板；缺失或旧源 `103.117.123.226:22000` 不符时失败关闭，不用 fallback。`DEPLOY_PROXY_JUMP` 必须存在，非空只收单个 `[user@]host[:port]`；可选进程变量 `DEPLOY_SSH_PROXY_JUMP` 仅能逐字一致，不能覆盖模板跳板。

CI/manual 都用生成的 `-F <配置> yzgc-target`，同一配置供 SSH/SCP：固定 `IdentitiesOnly`、`BatchMode`、`StrictHostKeyChecking=yes`、专用 `UserKnownHostsFile`，不读全局 known_hosts。应事先核验跳板与 Arch 双端主机公钥及专用部署 key 的权限；不得把个人 root 私钥给 CI，不能把生成成功当连通性证明。旧 tag 仍执行旧版本脚本，不因当前模板更新自动获得新门禁。

## GitHub Environment 配置

环境名固定为 `preview` 与 `production`，两者条目**同名**、**取值必须不同**。工作流行为与证据链见 [CICD](CICD.md)；这里是配置清单本身。

### 环境级 secrets（`preview` / `production` 各一套）

| 名称 | 用途 |
|---|---|
| `DEPLOY_SSH_HOST` | 必须逐字等于该提交模板 `DEPLOY_HOST`，不得静默回落旧源 |
| `DEPLOY_SSH_PORT` | 必须逐字等于模板 `DEPLOY_PORT` |
| `DEPLOY_SSH_USER` | 必须逐字等于模板 `DEPLOY_USER` |
| `DEPLOY_SSH_KEY` | 本次专用部署私钥；不使用个人 root 私钥；权限由目标方预先配置 |
| `DEPLOY_SSH_KNOWN_HOSTS` | 已核验的香港跳板与 Arch 主机公钥行，严格校验双端，不用关闭检查换连通 |
| `OAUTH_CLIENT_ID` | GitHub OAuth 应用 ID → 渲染进运行时 `.env`（每个环境一个独立的 OAuth App，见下文） |
| `OAUTH_CLIENT_SECRET` | GitHub OAuth 应用密钥 → 运行时 `.env` |
| `SESSION_SECRET` | 会话签名密钥（≥32 字符随机值） |
| `ENCRYPTION_KEY` | 32 字节密钥的 base64（GitHub token 加密） |
| `TURNSTILE_SITE_KEY` | Cloudflare Turnstile 站点键 |
| `TURNSTILE_SECRET_KEY` | Cloudflare Turnstile 服务端密钥 |
| `MAIL_ALIYUN_FROM` | 阿里云邮件推送的发信地址（配了阿里云那一对密钥时必填；不带显示名） |
| `MAIL_RESEND_FROM` | Resend 的发件地址（配了 `MAIL_RESEND_API_KEY` 时必填；不带显示名） |
| `MAIL_ALIYUN_ACCESS_KEY_ID` | 阿里云邮件推送的 AccessKey ID（可选，和下一项要么都配、要么都不配） |
| `MAIL_ALIYUN_ACCESS_KEY_SECRET` | 阿里云邮件推送的 AccessKey Secret |
| `MAIL_RESEND_API_KEY` | Resend 的 API Key（可选） |
| `SHIELD_ALLOWLIST` | 访问防护的豁免网段：英文逗号隔开的 IP 或 CIDR（可选，#333）；按密钥存，空 = 没有豁免 |
| `MAIL_ALLOWLIST` | 收件名单：英文逗号隔开的邮箱，不带空格（可选；`MAIL_RECIPIENTS=allowlist` 时只发给这些地址） |
| `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET` | Google 登录的 OAuth 客户端（可选的一对；Google Cloud 里类型选「Web 应用」，已获授权的重定向 URI 填 `<origin>/auth/google/callback`） |
| `OIDC_JWKS` | 对外授权的签名私钥（可选，#270）：在 server 容器里 `node app/server/dist/cli/oidc.js keygen` 生成的一行 base64（RSA 2048 的 JWK Set），环境密钥不收引号，不用 JSON 原文 |
| `GITLAB_API_TOKEN` | 自建 GitLab 管理员的个人访问令牌（`api` 范围，#270）；`GITLAB_SYNC=on` 时必填，`off`、`dry-run` 可以留空 |
| `BACKUP_S3_BUCKET` | 七牛私有备份桶名（只放在 secret 里，仓库和文档不写）。渲染进目标机 `.env.<环境>` |
| `BACKUP_S3_ACCESS_KEY_ID` / `BACKUP_S3_SECRET_ACCESS_KEY` | 备份专用的七牛 AccessKey，GitLab、平台与部署前数据库快照共用，每个环境一套 |
| `BACKUP_GPG_PUBLIC_KEY` | 备份加密的公钥：ASCII 公钥块的 base64（一行）。有它时部署前快照用 `--recipient-file` 加密，目标机钥匙环不需要这把钥匙，优先于 `BACKUP_GPG_RECIPIENT`。 |
| `BACKUP_GPG_RECIPIENT` | 备份加密的 GPG 收件人（只在没有 `BACKUP_GPG_PUBLIC_KEY` 时用）。目标机钥匙环里必须有对应公钥；两项都空时跳过迁移前备份并告警，缺钥匙时快照失败关闭，不迁移 |

Turnstile 两项是可选的一对（`scripts/deployment-environment.mjs` 的 `OPTIONAL_SECRET_PAIR`）：**都为空＝明确关闭**，渲染时写空值并提示；只填一项仍拒绝渲染；除 Turnstile 和下面的发信密钥外，其余密钥一律必填。关闭时服务端 `middleware/turnstile.ts` 不校验人机验证，公开的投递、反馈、邀请只靠工作量证明（`POW_DIFFICULTY`）、蜜罐字段与限流；遗留风险是批量脚本的成本只剩计算量，要开启时在 Cloudflare 建站点后把两项同时配进环境级 secrets 并重新部署。首次上线（2026-09-25）两个环境都关闭。

发信密钥可不配：阿里云 AK/SK 成对，Resend 为单项；全部为空时不外发，失败仍记录脱敏结果。带 `MAIL_REPLY_TO` 时只使用能承载该字段的 Resend，具体限制见 [mail 合同](../services/server/mail.md)。`MAIL_RECIPIENTS=allowlist` 只发送到名单，空名单不发；格式错误不回显名单。当前 Arch 已接管原权威源，模板与原运行设置均为 all；另建复制环境仍要使用空白名单和出站隔离，不能因为权威源获批外发就同时启动第二个发送者。

Google 两项为可选的一对：都空时登录页不出现 Google、端点 404；只填一项拒绝渲染/启动。实际配置状态不由仓库空字段推断；迁移后的真实提供商回调、同意与绑定另验，不在本任务重配凭据或代替本人操作。

OIDC/GitLab 环境字段承接历史 **GitLab geek/admin#270**，不是 GitHub admin#270 迁移单。`OIDC_JWKS` 为空时对外授权关闭；render 仅按 env 的 `GITLAB_SYNC=on` 要求令牌，不能发现数据库有效 mode 的覆盖，见上文安全门禁。GitLab 客户端 id `gitlab`、sector 取回调主机，持久 pairwise sub 不随内部账号 ID 或签名密钥重新计算；保全原 `oauth_clients`/`oauth_subjects`/`gitlab_accounts` 和 `ENCRYPTION_KEY`。改接正式权威源、真实登录与至少两轮正常同步均需独立验收，详见 [OIDC 服务合同](../services/server/oidc.md) 与 [GitLab 运维合同](GITLAB.md)，不能用“同步错误 0”核销现有 SSO 故障。

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
| production | `https://yangtzeu.work/auth/callback` | 保留已发布环境的精确回调；迁移不顺带新建/修改 OAuth 应用，实际登记另核对 |
| preview | `https://prev.yangtzeu.work/auth/callback` | 独立客户端与密钥，不与正式复用；真实往返需在新代理链验证 |

登录成功后默认回到 `<PUBLIC_ORIGIN>/console`；`return_to` 只接受同一个 origin。

## DNS / TLS 前置

| 域名 | 2026-10-26 迁移后的解析 / 行为 | 后续 |
|---|---|---|
| `yangtzeu.work` | A 仍为 `103.117.123.226`，无 AAAA；旧入口转发到 Arch 正式 | 所有者将 A 指向香港 `156.238.244.78` |
| `prev.yangtzeu.work` | A 仍为 `103.117.123.226`，无 AAAA；旧入口转发到 Arch 预发布 | 同上；香港可信 TLS 与指定 IP 路径已验证 |
| `github.yangtzeu.work` | 旧 VPS 保留 301；legacy Node 已停用。2026-10-30 核对：已没有 A 记录，这个 301 实际到不了 | `deploy/nginx/production.conf` 里的 301 块还在，删不删另行决定（#335 只登记不删） |
| `git.yangtzeu.work` | 香港 → Arch GitLab 原链路（2026-10-30 核对：A 为香港 `156.238.244.78`） | #335 搬家后只做 301 到正式入口的 `/gitlab` 同一路径，DNS 不改；sector 仍是这个主机 |

DNS 由所有者操作；切前核对 A/AAAA/CAA/TTL、SNI、证书签发/续期与回调。旧源 nginx/certbot 保留观察窗口；新边缘使用 Caddy 签证书，不搬私钥、不在 Arch 额外叠宿主 nginx。模板/回环 HTTP 不证明 HTTPS 或身份安全，真实验收见 [DEPLOY](DEPLOY.md)。

## 环境同构性原则（预防线上 Hotfix）

避免线上紧急缺陷（`hot-fix`）的根本前提是预发布与正式环境保持最高程度的**同构一致性**。线上出现环境级问题的三大主要根因与必检清单：

1. **网关策略同构**：
   - 两份 nginx 模板保留为策略源；现行香港配置由迁移工具从各环境实际配置提取。`scripts/render-arch-caddy.mjs` 尚未覆盖旧入口过渡的 IP 信任逻辑，不可直接安装覆盖 live 配置。
   - 保留论坛上游内联哈希和比赛 sandbox CSP；新目标保持两层代理。模板一致不证明旧源或新边缘已安装，Caddy 生成/语法/真实域名分别取证。
2. **S3 CDN 的公开读取与环境一致性**：
   - 宣传片与公开静态资源放在 `https://cdn.crosery.com`（七牛桶的 `yzgc/` 下），路径、公私桶和凭据合同见 [CDN](CDN.md)；数据库不外移。论坛图片与头像在对象存储开启后外移，前缀按环境分开（`OBJECT_STORAGE_PREFIX`：预发布 `yzgc/preview/`，正式 `yzgc/production/`），见 [CDN](CDN.md)「用户文件」。
   - 正式与预发布都须真实验证 CORS、Range、MIME、缓存和 CSP；旧七牛的 Referer 白名单与 insertOnly 不是新服务能力。
   - S3 上传凭据只在发布 job 的进程环境，不能放到这两份业务运行时 `.env` 或镜像。部分凭据、认证失败或新端点不可达均失败关闭。
3. **域名绑定与第三方服务配置**：
   - **OAuth 回调**：正式环境 GitHub OAuth App 的 Callback URL 必须精准匹配 `PUBLIC_ORIGIN/auth/callback`，不可指向预发布；
   - **Turnstile 人机验证**：Cloudflare 仪表盘中的允许域名列表必须同时包含正式域名与预发布域名；
   - **Cookie 域隔离**：保持 host-only，禁止父域共享导致登录态污染。
4. **真实路径走通**：任何第三方服务、流媒体 CDN、外部 API、OAuth 回调在正式上线前必须在预发布环境真实完整跑通，杜绝「预发布未配/未测、正式才配置」带来的不可控风险。

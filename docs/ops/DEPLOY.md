# 部署、维护与恢复规范

> 同机两套 Docker 栈 + 宿主 nginx TLS 终止；生产发布为独立授权操作，模板存在不等于已经部署。

状态：`current` · 更新：2026-09-24

## 发布前置

**先遵守 [RELEASES](../conventions/RELEASES.md) 与 [BRANCHING](../conventions/BRANCHING.md)：`stage` 是预发布、`main` 是正式；人工试用及明确批准必须发生在把 `stage` 合入 `main` 之前。** 发布内容由分支 + commit SHA 决定，没有 tag 步骤；镜像 tag 是本次 commit 的 `<sha12>`。

发布者明确目标环境、commit、镜像 tag、回滚对象和维护窗口。先在本地或 CI 完成 `pnpm verify` 与相关浏览器检查，再部署；不从含无关修改的工作区发布。核心与论坛使用两套工具链（Node 22/pnpm 9.15.9 与 Node ≥26/pnpm 11.24.0），镜像构建在容器内完成，不上传 Mac 原生依赖。

## 拓扑

```text
互联网
  └─ 宿主 nginx（TLS 终止，certbot 证书，安全头在此下发）
       ├─ yangtzeu.work / prev.yangtzeu.work → 127.0.0.1:18100 / 18200（web 容器），每个环境只有这一个域名
       └─ github.yangtzeu.work（已退役）      → 301 到 https://yangtzeu.work，保留路径
            └─ web 容器（nginx，容器内监听 8080：静态产物 + 反代）
                 ├─ /healthz  → server:3000（web 也代理，部署脚本用它做健康门）
                 ├─ /api/*、/auth/* → server:3000（Fastify + /data 命名卷）
                 ├─ /forum/*  → forum:3000（Nuxt 静态产物；镜像按 GEEK_FORUM_BASE_PATH=/forum/ 构建，proxy_pass 带尾斜杠剥离前缀）
                 ├─ /admin、/admin/*、/console、/console/*、/signin → admin SPA 入口
                 └─ 其余路径 → portal SPA 入口
```

宿主 nginx 的 server block 是 `deploy/nginx/production.conf` 与 `deploy/nginx/preview.conf`（TLS、ACME 挑战、安全头都在这里，不注入任何站点头）。**每个环境只有一个域名**，管理端靠 URL 路径区分：web 容器 nginx 按路径选 SPA 入口（规则与 `app/server/src/app.ts` 的 `resolveSiteEntry` 一致），镜像与前端产物里不含任何环境域名，同一个镜像在两个环境通用。旧的「管理端独立子域 + 宿主注入站点头」模型已退役：正式的 `github.yangtzeu.work` 只剩 301 跳转，预发布不再有管理端子域。

`/release.json` 由 **web 镜像内置**（构建时用 build args 生成的静态文件，`Cache-Control: no-store`），不再是宿主 nginx 的 alias。

论坛不再是独立子域，而是 portal 域名下的 `/forum` 路径；旧 `forum.yangtzeu.work` 子域模型已退役（见文末历史章节）。

## 两套栈

| 项 | production（正式） | preview（预发布） |
|---|---|---|
| 分支 | `main` | `stage` |
| 栈根目录 | `/opt/yzgc/production` | `/opt/yzgc/preview` |
| compose 文件 | `deploy/compose/production.yml` | `deploy/compose/preview.yml` |
| compose 项目名 | `yzgc-production` | `yzgc-preview` |
| 环境文件（目标机） | `<栈根>/.env.production`（脚本安装为 600） | `<栈根>/.env.preview` |
| 入口域名（唯一） | `yangtzeu.work`（`github.yangtzeu.work` 仅 301 到这里） | `prev.yangtzeu.work` |
| web 宿主端口 | `127.0.0.1:18100` → 容器 8080 | `127.0.0.1:18200` → 容器 8080 |
| server 宿主端口（调试/健康门） | `127.0.0.1:18101` → 容器 3000 | `127.0.0.1:18201` → 容器 3000 |
| 容器内端口 | web 8080 / server 3000 / forum 3000 | web 8080 / server 3000 / forum 3000 |
| 数据 | 命名卷 `<项目名>-data` 挂到 server 的 `/data` | 独立命名卷，不共享 |
| 部署锁与历史 | `<栈根>/.deploy.lock`、`<栈根>/deploy-history.log` | 同结构，互相独立 |

两栈**完全隔离**：独立目录、独立 compose 项目、独立端口、独立数据卷、独立密钥、独立域名、独立锁。不得共用数据库、上传目录、会话密钥或父域 Cookie；Cookie 使用 host-only，禁止 `.yangtzeu.work`。宿主 3000/443/2568/8787/8080 已被现有服务占用，新栈只绑回环的 18100/18101 与 18200/18201；forum 容器不发布任何宿主端口。

镜像名 `yzgc/server:<tag>`、`yzgc/web:<tag>`、`yzgc/forum:<tag>`，tag = 本次 commit 的 `<sha12>`，部署时写入目标机环境文件的 `IMAGE_TAG`。构建上下文是仓库根，`dockerfile: app/<service>/Dockerfile`；每个服务有 `app/<service>/.dockerignore`，另有根 `.dockerignore` 控制上下文（Docker 读的是构建上下文根下的那一份，因此根文件才是实际生效的排除规则）。三个镜像共享同一组 build args：`GEEK_DEPLOYMENT_ENVIRONMENT`（必填，`production`/`preview`）、`GEEK_RELEASE_VERSION`、`GEEK_RELEASE_COMMIT`；论坛会校验组合（预发布要 `X.Y.Z@<sha12>`、正式要 `X.Y.Z`、commit 必须 40 位十六进制），不合格直接构建失败。

## 部署流程

```bash
# 1) 可信机器上构建并打包镜像（CI 或人工，两条工具链分别构建）
docker compose --env-file deploy/env/.env.production -f deploy/compose/production.yml build \
  --build-arg GEEK_DEPLOYMENT_ENVIRONMENT=production \
  --build-arg GEEK_RELEASE_VERSION=<X.Y.Z> \
  --build-arg GEEK_RELEASE_COMMIT=<40 位 SHA>
docker save yzgc/server:<sha12> yzgc/web:<sha12> yzgc/forum:<sha12> -o yzgc-<sha12>.tar
sha256sum yzgc-<sha12>.tar > yzgc-<sha12>.tar.sha256

# 2) 分发 tar(+sha256) 与渲染好的运行时 env 文件到目标机，然后：
bash deploy-stack.sh --environment production \
  --images ./yzgc-<sha12>.tar --env-file ./runtime/.env.production
```

`deploy/remote/deploy-stack.sh` 的行为（目标机上，参数即契约）：

| 参数 | 含义 |
|---|---|
| `--environment <production\|preview>` | 必填；决定 compose 文件与历史记录中的环境列 |
| `--images <tar\|tar.gz\|目录>` | 待 `docker load` 的镜像包 |
| `--env-file <路径>` | 运行时 env 文件的唯一事实源 |
| `--incoming-dir <目录>` | 镜像与 env 的落地目录（默认在栈根下） |
| `--image-tag <sha12>` / `--stack-root <目录>` | **仅交叉核对**：与 env 文件中的 `IMAGE_TAG`、`STACK_ROOT` 不一致即硬失败 |
| `--compose-file <路径>` | 覆盖 compose 文件解析结果 |
| `--health-timeout <秒>` | 健康门超时（默认 180） |

- **env 文件是唯一事实源**：`STACK_ROOT`、`COMPOSE_PROJECT_NAME`、`IMAGE_TAG`、`SERVER_BIND`、`WEB_BIND`、`SERVER_PORT` 都从它读取，脚本把它原子安装为 `<栈根>/.env.<environment>`（权限 600）。
- **镜像包校验失败关闭**：必须能核到 sha256（`<包>.sha256`、去扩展名的同名 `.sha256`，或同目录的 `SHA256SUMS`/`sha256sums.txt`/`checksums.txt`），缺失或不等即拒绝部署。
- **串行锁**：`flock <栈根>/.deploy.lock`（等待 900s），production 与 preview 各自独立串行。
- **健康门**：轮询 `http://127.0.0.1:<SERVER_BIND 端口>/healthz` 与 `http://127.0.0.1:<WEB_BIND 端口>/healthz`（web nginx 代理 `/healthz` → server:3000），两者都必须返回 HTTP 200 且 `"ok":true`；默认 180s 超时、3s 间隔。失败时脚本把 `IMAGE_TAG` 切回部署前的值、重新 `compose up -d` 并复检。
- **历史记录**：追加写 `<栈根>/deploy-history.log`，制表符分列 `<UTC ISO8601> <环境> <生效版本> <结果> <说明>`。第 3 列是**该次动作后真正在跑的 tag**：`OK` / `MANUAL_ROLLBACK` 行 = 部署后生效的 tag；`FAILED` 行 = 尝试部署但没起来的 tag；`ROLLED_BACK` 行 = 回滚后真正生效的旧 tag（说明里写明目标版本未上线）。镜像保留策略与 `rollback-stack.sh --to previous` 都按这一列判断。结果取值：`OK` / `FAILED` / `ROLLED_BACK` / `ROLLBACK_FAILED` / `ROLLBACK_SKIPPED`（部署）与 `MANUAL_ROLLBACK` / `MANUAL_ROLLBACK_FAILED`（回滚）。
- **镜像构成**：`node:22-bookworm-slim`（server 构建与运行）、`node:22-bookworm-slim` + `nginx:1.31-alpine`（web 构建 + 运行）、`node:26-bookworm-slim` + `nginx:1.31-alpine`（forum 构建 + 运行）。基础镜像大版本变更必须单独验证（1.27 系列已下线，不要再回退到旧 tag）。
- **`FORUM_PORT` 三处一致**：compose 用 `expose: ["${FORUM_PORT}"]` 声明容器内端口，必须与 forum 镜像内 nginx 的 `listen`/`EXPOSE` 以及 web 容器 `proxy_pass http://forum:3000/` 三处同时一致；改值要一起改镜像与 web 的 nginx 配置。
- **镜像保留**：部署成功后清理其它 `yzgc/*` tag，保留历史中最新 5 个不同 tag + 当前 + 上一个；正在使用的镜像不会被强制删除。
- 目标机只 `docker load` 镜像并 `up -d`，**不在服务器上 `git pull` 后构建**。
- 同一环境同一时刻只允许一个部署任务（锁保证）；正式环境部署不得在切换过程中被新任务取消。

**实施状态**：`deploy/compose/{production,preview}.yml`、`deploy/nginx/{production,preview}.conf`、`deploy/remote/{deploy-stack,rollback-stack}.sh` 已入库并定义本模型。旧 systemd / 发布包模型的文件已随本次改造**删除**：`deploy/remote/{deploy-release,rollback}.sh`、`deploy/yzgc-admin.service`、`deploy/yzgc-preview.service`、`deploy/setup.sh`、根目录旧 `deploy/nginx*.conf`（含 `nginx-release-metadata.conf`）、`deploy/forum-subdomain-setup.md`、`scripts/release-bundle.mjs`、`tests/tooling/release-bundle.test.ts`。这些路径只存在于历史章节，不要按旧流程重建。

## 前置条件（部署前必须由维护者确认）

1. DNS：`prev.yangtzeu.work` 已有指向本机 IP 的 A 记录（2026-09-24 `dig` 核对为 `103.117.123.226`，与正式域名同一主机、不同栈）；不需要任何管理端子域记录。
2. TLS：宿主 nginx 用 certbot 签发/续期三张证书：`yangtzeu.work`、`prev.yangtzeu.work`、`github.yangtzeu.work`（最后一张只服务 301 跳转）；命令 `certbot certonly --webroot -w /var/www/html -d <域名>`。证书准备完成前不引用，改完先 `nginx -t` 再 reload。
3. 宿主 nginx：把 `deploy/nginx/production.conf`、`deploy/nginx/preview.conf` 分别安装到 `/etc/nginx/sites-available/` 并 symlink 进 `sites-enabled/`；TLS、ACME 挑战、安全头与旧管理端域名的 301 都由这两个文件负责，不要把两者配成同名 `server_name` 而冲突。
4. GitHub OAuth App：Callback URL 必须是 `<origin>/auth/callback`。正式环境切换当天，所有者要把现有 OAuth App 的 Callback URL 改成 `https://yangtzeu.work/auth/callback`；预发布另建一个 Callback URL 为 `https://prev.yangtzeu.work/auth/callback` 的 OAuth App（密钥不跨环境共用）。细节见 [ENVIRONMENTS](ENVIRONMENTS.md#github-oauth-app-回调地址)。
5. Docker 与 Compose v2 已安装；栈根目录存在且属部署用户；`<栈根>/.env.<environment>` 由部署脚本原子安装（含真实密钥，权限 600）。
6. 环境文件里的必填项（`HOST`、`TRUST_PROXY`、`PUBLIC_ORIGIN`、`DB_PATH`、`IMAGE_TAG` 等）缺失时 compose 会直接拒绝启动；不要靠临时改 compose 文件绕过。

## 配置合同

环境变量**只**经 `.env` 文件：`deploy/env/.env.production` 与 `deploy/env/.env.preview` 提交入库，非密值（地址、端口、域名、路径、开关）预填真实值，密钥字段留空由 CI/CD 注入。完整字段契约、可见性规则与 GitHub 环境 secrets/vars 清单见 [ENVIRONMENTS](ENVIRONMENTS.md)；本机开发模板见 [ENVIRONMENT](ENVIRONMENT.md)。

关键非密字段：`GEEK_DEPLOYMENT_ENVIRONMENT`、`GEEK_ENVIRONMENT_ORIGIN`、`COMPOSE_PROJECT_NAME`、`STACK_ROOT`、`DEPLOY_HOST`、`DEPLOY_PORT`、`DEPLOY_USER`、`IMAGE_TAG`、`WEB_BIND`、`SERVER_BIND`、`SERVER_PORT`、`FORUM_PORT`、`PUBLIC_ORIGIN`（环境唯一的对外地址，逐字等于 `deploy/environments.json` 的 origin）、`NODE_ENV`、`PORT`、`HOST`（容器内必须 `0.0.0.0`，否则 web 容器连不上）、`TRUST_PROXY`（反代来自 compose 网络，必须为 `true`）、`DB_PATH`、`POW_DIFFICULTY`、`COOKIE_DOMAIN`（留空 = host-only）。密钥字段：`OAUTH_CLIENT_ID`、`OAUTH_CLIENT_SECRET`、`SESSION_SECRET`、`ENCRYPTION_KEY`、`TURNSTILE_SITE_KEY`、`TURNSTILE_SECRET_KEY`——**仓库里必须留空**。发布身份（`GEEK_RELEASE_VERSION`、`GEEK_RELEASE_COMMIT`、`GEEK_RELEASE_DISPLAY_SUFFIX`）是 `BUILD_ONLY_FIELDS`：只经 build args 注入，写在 env 文件里不会被读取。

禁止把真实密钥写入仓库、镜像、日志或发布记录；`.env` 由目标机最小权限保存，不打印、不提交。

## 数据与备份

- 每个环境的数据都在自己的命名卷里（server 的 `/data`：`data.db`、旧论坛兼容路径）；forum 容器当前不挂卷、无服务端持久化。两栈互不可见。
- 旧站数据已按独立授权拉到 Mac 私有目录，见 [FORUM-DATA-CAPTURE](FORUM-DATA-CAPTURE.md)；这是源数据保全，不是 schema 迁移，不自动替换线上库，也不放进镜像或 CI。
- 变更表结构尽量增量兼容，不自动删除或重排。变更前使用 SQLite 在线 backup API 或停服的一致性备份，不能只复制活动 WAL 主文件并假定完整。备份同时记录镜像 tag、环境与应用版本，并完成恢复演练。
- 镜像保留策略（最新 5 个 tag + 当前 + 上一个）只清理镜像，不清理数据卷；**回滚不重置数据库**，结构不兼容时停下来由人处理。
- 禁止把业务数据库用于自动测试。

## 回滚

```bash
# 目标机（栈根）：
bash deploy-stack.sh  ... # 部署失败时自动回滚（见上文健康门）
bash rollback-stack.sh --environment production --to <sha12|previous>
```

`rollback-stack.sh` 只做两件事：把 `<栈根>/.env.<environment>` 的 `IMAGE_TAG` 改成目标 tag，然后 `docker compose up -d`。它**不触碰数据卷、不删除数据、不清理镜像、不改分支或版本号**；`previous` = `deploy-history.log` 中与当前不同的最近一个 tag。可选参数 `--env-file`、`--stack-root`、`--compose-file`、`--health-timeout` 与部署脚本同名同义，健康门同样生效；结果写入同一份 `deploy-history.log`。

回滚后重新执行健康检查并记录结果。旧日志、旧请求排队不能覆盖更晚版本；切换前再次核对目标环境、镜像 tag 与当前部署序号。

## 最小权限

- 容器内进程非 root 运行（web 容器 nginx 以 nginx 用户跑非特权 8080）；镜像只含运行必需的代码与静态产物。
- 宿主 nginx 只做 TLS 终止与反代，不读取应用密钥；安全头统一在宿主下发，容器不重复。
- 部署用户的 SSH 密钥只存在于 GitHub 环境级 secrets；不在仓库、脚本或日志中出现。
- 镜像与 env 文件按 600/最小权限落在栈根，发布产物不包含 `.env`、真实数据库或 SSH 材料。

## 发布和回滚验收

检查 `/healthz`（server 与 web 各一次）、入口域名与深链接（`/`、`/join-us`、`/admin`、`/console/...` 分别进官网与管理端）、`github.yangtzeu.work` 的 301（仅正式环境）、`/api/*` 与 `/forum/*` 是否正确反代、缺失资产 404、真实 OAuth/Cookie、验证码、权限、邀请结果、服务重启后的数据保留。HTML/资产/后端必须来自同一镜像 tag：用 `docker inspect` 的镜像 digest 与 `<栈根>/.env.<environment>` 的 `IMAGE_TAG` 交叉核对，web 容器内置的 `/release.json`（`no-store`）可作为发布身份的第二证据。数据库有新增字段时，回滚旧镜像前确认兼容，不以重置数据卷代替回滚。

未执行的生产验证明确标注，不将本机的 `pnpm verify` PASS、模板文件或模拟测试称为线上验收。

## 历史：systemd 与发布包模型（`historical`，已删除）

以下内容属于 **2026-09-23 之前** 的部署模型，保留仅供追溯，**不是现行操作规范**，对应文件已在本次改造中删除（不要按这些路径重建）：

- systemd 单元 `deploy/yzgc-admin.service`（正式）与 `deploy/yzgc-preview.service`（预发布），服务用户 `yzgc-admin`，`WorkingDirectory=/opt/yzgc-admin`，`EnvironmentFile=<部署根>/.env`。
- 发布包布局：`$DEPLOY_ROOT/releases/<releaseId>` + `current`/`previous` 符号链接 + `shared/{.env,data}` + `incoming/` + `deploy-history.log`；`releaseId = baseVersion-shortCommit12`；打包器 `scripts/release-bundle.mjs`。
- 目标机脚本 `deploy/remote/deploy-release.sh`、`deploy/remote/rollback.sh`（基于符号链接切换，不基于镜像 tag）。
- 宿主 nginx 直接把 `/` 反代到 `127.0.0.1:3000`（根目录旧 `deploy/nginx.conf`、`deploy/nginx-yangtzeu.conf`、`deploy/nginx-security-headers.conf`、`deploy/nginx-release-metadata.conf`），论坛按 `/forum/r/` alias 到旧 mbbs 资源目录。
- 旧一键安装 `deploy/setup.sh` 的自动安装行为已退役。
- 论坛子域模型（`forum.yangtzeu.work`，配套 `deploy/forum-subdomain-setup.md`）已退役：论坛现由 portal 域名下的 `/forum` 路径提供。
- 管理端独立域名模型（2026-09-24 退役）：正式 `github.yangtzeu.work`、预发布 `prev-admin.yangtzeu.work` 各占一个域名，宿主 nginx 注入站点头让 web 容器选 admin SPA，env 另有按站点的 host 字段，前端 `app.config.json` 的 host 在镜像构建时按环境重写。现在每个环境只有一个域名，管理端按路径进入；`github.yangtzeu.work` 只保留 301。
- 发布 tag（`release-X.Y.Z` / `prev-X.Y.Z`）不再产生新的发布身份，见 [RELEASES](../conventions/RELEASES.md)。

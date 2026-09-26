# 部署、维护与恢复规范

> 同机两套 Docker 栈 + 宿主 nginx TLS 终止；生产发布为独立授权操作，模板存在不等于已经部署。

状态：`current` · 更新：2026-09-26

## 发布前置

**先遵守 [RELEASES](../conventions/RELEASES.md) 与 [BRANCHING](../conventions/BRANCHING.md)：发版只靠打 tag。`vX.Y.Z-rc.N` 打在 `stage` 的提交上部署预发布；所有者在预发布试用并明确批准后，`main` 快进到同一提交，再打 `vX.Y.Z` 部署正式。** push `stage`/`main` 不部署。发布内容由发布 tag 指向的提交决定；镜像 tag 是该提交的 `<sha12>`。

发布者明确目标环境、commit、镜像 tag、回滚对象和维护窗口。先在本地或 CI 完成 `pnpm verify` 与相关浏览器检查，再部署；不从含无关修改的工作区发布。核心与论坛使用两套工具链（Node 22/pnpm 9.15.9 与 Node ≥26/pnpm 11.24.0），镜像构建在容器内完成，不上传 Mac 原生依赖。

## 拓扑

```text
互联网
  └─ 宿主 nginx（TLS 终止，certbot 证书，安全头在此下发；论坛页面的 CSP 例外见「最小权限」）
       ├─ yangtzeu.work / prev.yangtzeu.work → 127.0.0.1:18100 / 18200（web 容器），每个环境只有这一个域名
       └─ github.yangtzeu.work（已退役）      → 301 到 https://yangtzeu.work，保留路径
            └─ web 容器（nginx，容器内监听 8080：官网与控制台两份静态产物 + 反代）
                 ├─ /console、/admin、/signin（含子路径） → sites/console/index.html（app/console，Vue + Tuffex）
                 ├─ /healthz  → server:3000（web 也代理，部署脚本用它做健康门）
                 ├─ /api/*、/auth/* → server:3000（Fastify + /data 命名卷）
                 ├─ /forum/*  → forum:3000（Nuxt 静态产物；镜像按 GEEK_FORUM_BASE_PATH=/forum/ 构建，proxy_pass 带尾斜杠剥离前缀；location ^~，图片、字体也转给论坛）
                 ├─ /admin、/admin/*、/console、/console/*、/signin → admin SPA 入口
                 └─ 其余路径 → portal SPA 入口
```

web 镜像构建阶段分别构建 `app/web`（官网）与 `app/console`（控制台），把两份 dist 叠进同一个站点根（`sites/portal/` + `assets/`，`sites/console/` + `console-assets/`，目录不重叠）。

宿主 nginx 的 server block 是 `deploy/nginx/production.conf` 与 `deploy/nginx/preview.conf`（TLS、ACME 挑战、安全头都在这里，不注入任何站点头；论坛页面的 CSP 由论坛容器下发，见下文「最小权限」）。**每个环境只有一个域名**，管理端靠 URL 路径区分：web 容器 nginx 按路径选 SPA 入口（`/admin`、`/console` 及其子路径与 `/signin` 进控制台入口 `sites/console/index.html`，其余进官网；规则与 `app/server/src/app.ts` 的 `resolveSiteEntry` 一致），镜像与前端产物里不含任何环境域名，同一个镜像在两个环境通用。旧的「管理端独立子域 + 宿主注入站点头」模型已退役：正式的 `github.yangtzeu.work` 只剩 301 跳转，预发布不再有管理端子域。

`/release.json` 由 **web 镜像内置**（构建时用 build args 生成的静态文件，`Cache-Control: no-store`），不再是宿主 nginx 的 alias。

论坛不再是独立子域，而是 portal 域名下的 `/forum` 路径；旧 `forum.yangtzeu.work` 子域模型已退役（见文末历史章节）。

## 两套栈

| 项 | production（正式） | preview（预发布） |
|---|---|---|
| 发布 tag（提交所在分支） | `vX.Y.Z`（`main`） | `vX.Y.Z-rc.N`（`stage`） |
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

镜像名按环境分仓库：正式 `yzgc-production/{server,web,forum}:<tag>`，预发布 `yzgc-preview/{server,web,forum}:<tag>`，tag = 本次 commit 的 `<sha12>`，部署时写入目标机环境文件的 `IMAGE_TAG`。两套栈共用同一个 Docker 守护进程，同一提交的正式与预发布镜像构建参数不同（`release.json`、版本串），共用镜像名会在 `docker load` 时互相覆盖；仓库名在 compose 文件里是字面量，不从 env 文件读取，`scripts/deployment-environment.mjs --check` 会拒绝两套 compose 在同一 SHA 上解析出相同镜像引用。构建上下文是仓库根，`dockerfile: app/<service>/Dockerfile`；每个服务有 `app/<service>/.dockerignore`，另有根 `.dockerignore` 控制上下文（Docker 读的是构建上下文根下的那一份，因此根文件才是实际生效的排除规则）。三个镜像共享同一组 build args：`GEEK_DEPLOYMENT_ENVIRONMENT`（必填，`production`/`preview`）、`GEEK_RELEASE_VERSION`、`GEEK_RELEASE_COMMIT`；论坛会校验组合（预发布要 `X.Y.Z-rc.N@<sha12>`、正式要 `X.Y.Z`、commit 必须 40 位十六进制），不合格直接构建失败。另有只在构建阶段生效的下载源参数：`NPM_REGISTRY`（三个镜像）、`DEBIAN_MIRROR` 与 `BETTER_SQLITE3_BINARY_HOST`（只有 server），不传就是官方源，不进运行镜像；取值、校验与信任依据见 [CICD](CICD.md#构建下载源104)。

## 部署流程

```bash
# 0) 部署工作流由发布 tag 触发，并先用规划器核对 tag、提交、版本号与所在分支：
node scripts/release-policy.mjs plan --tag <vX.Y.Z> --commit <40 位 SHA>
# 1) 可信机器上构建并打包镜像（CI 或人工，两条工具链分别构建）
docker compose --env-file deploy/env/.env.production -f deploy/compose/production.yml build \
  --build-arg GEEK_DEPLOYMENT_ENVIRONMENT=production \
  --build-arg GEEK_RELEASE_VERSION=<X.Y.Z，预发布为 X.Y.Z-rc.N@<sha12>> \
  --build-arg GEEK_RELEASE_COMMIT=<40 位 SHA>
# 镜像必须带本环境的仓库名：compose 文件的 image 就是 yzgc-production/<服务>:${IMAGE_TAG}
docker save yzgc-production/server:<sha12> yzgc-production/web:<sha12> yzgc-production/forum:<sha12> \
  -o yzgc-images-production-<sha12>.tar
sha256sum yzgc-images-production-<sha12>.tar > yzgc-images-production-<sha12>.tar.sha256

# 2) 分发 tar(+sha256) 与渲染好的运行时 env 文件到目标机，然后：
bash deploy-stack.sh --environment production \
  --images ./yzgc-images-production-<sha12>.tar --env-file ./runtime/.env.production
```

`deploy/remote/deploy-stack.sh` 的行为（目标机上，参数即契约）：

| 参数 | 含义 |
|---|---|
| `--environment <production\|preview>` | 必填；决定 compose 文件与历史记录中的环境列 |
| `--images <tar\|tar.gz\|目录>` | 待 `docker load` 的镜像包 |
| `--env-file <路径>` | 运行时 env 文件的唯一事实源 |
| `--incoming-dir <目录>` | 镜像与 env 的落地目录（工作流与 `deploy-manual.mjs` 都用 `<栈根>/incoming`）；部署成功后清理其中本环境的归档与 env 文件，见下文「incoming 清理」 |
| `--image-tag <sha12>` / `--stack-root <目录>` | **仅交叉核对**：与 env 文件中的 `IMAGE_TAG`、`STACK_ROOT` 不一致即硬失败 |
| `--compose-file <路径>` | 覆盖 compose 文件解析结果 |
| `--health-timeout <秒>` | 健康门超时（默认 180） |

- **env 文件是唯一事实源**：`STACK_ROOT`、`COMPOSE_PROJECT_NAME`、`IMAGE_TAG`、`SERVER_BIND`、`WEB_BIND`、`SERVER_PORT` 都从它读取，脚本把它原子安装为 `<栈根>/.env.<environment>`（权限 600）。
- **镜像只属于本环境**：装载前读归档里 `manifest.json` 的 `RepoTags`，只接受 `yzgc-<environment>/{server,web,forum}:<IMAGE_TAG>` 这三个，出现另一环境、旧的 `yzgc/*` 或别的 tag 即拒绝（不 `docker load`，也不重新打 tag）；compose 文件解析出的镜像也必须恰好是这三个，目标机上残留旧版 compose 文件时直接失败。
- **镜像包校验失败关闭**：必须能核到 sha256（`<包>.sha256`、去扩展名的同名 `.sha256`，或同目录的 `SHA256SUMS`/`sha256sums.txt`/`checksums.txt`），缺失或不等即拒绝部署。
- **串行锁**：`flock <栈根>/.deploy.lock`（等待 900s），production 与 preview 各自独立串行。锁只包住 `deploy-stack.sh`（`rollback-stack.sh` 用同一把），上传归档与 env 文件（scp）在锁外，见下文「同一环境同一时刻只允许一个部署任务」。
- **健康门**：轮询 `http://127.0.0.1:<SERVER_BIND 端口>/healthz` 与 `http://127.0.0.1:<WEB_BIND 端口>/healthz`（web nginx 代理 `/healthz` → server:3000），两者都必须返回 HTTP 200 且 `"ok":true`；默认 180s 超时、3s 间隔。每一轮先探测、再看是否超时，所以至少探测一次（先判断超时的话，bash 的 `SECONDS` 整秒跳变正好落在算出截止时间之后时，会一次不探测就判失败）；`rollback-stack.sh` 相同。
- **失败即回滚**：`docker compose up -d` 本身失败（web 对 server 是 `depends_on: condition: service_healthy`，新 server 起不来时 up 自己就非零退出）与健康门超时走同一条路：记 `FAILED`（说明里写是哪一种），有上一个版本就把 `IMAGE_TAG` 切回部署前的值、重新 `compose up -d` 并复检，通过记 `ROLLED_BACK`，不通过记 `ROLLBACK_FAILED`；无论哪种结局脚本都非零退出。回滚只用本机已装载的镜像，不读 incoming 里的归档。
- **历史记录**：追加写 `<栈根>/deploy-history.log`，制表符分列 `<UTC ISO8601> <环境> <生效版本> <结果> <说明>`。第 3 列是**该次动作后真正在跑的 tag**：`OK` / `MANUAL_ROLLBACK` 行 = 部署后生效的 tag；`FAILED` 行 = 尝试部署但没起来的 tag；`ROLLED_BACK` 行 = 回滚后真正生效的旧 tag（说明里写明目标版本未上线）。镜像保留策略与 `rollback-stack.sh --to previous` 都按这一列判断。结果取值：`OK` / `FAILED` / `ROLLED_BACK` / `ROLLBACK_FAILED` / `ROLLBACK_SKIPPED`（部署）与 `MANUAL_ROLLBACK` / `MANUAL_ROLLBACK_FAILED`（回滚）。
- **镜像构成**：`node:22-bookworm-slim`（server 构建与运行）、`node:22-bookworm-slim` + `nginx:1.31-alpine`（web 构建 + 运行）、`node:26-bookworm-slim` + `nginx:1.31-alpine`（forum 构建 + 运行）。基础镜像大版本变更必须单独验证（1.27 系列已下线，不要再回退到旧 tag）。
- **基础镜像按 digest 固定**（#97）：三个 Dockerfile 的 `FROM` 写成 `<tag>@sha256:<digest>`。家里的自托管 runner 连不上 Docker Hub，只能经第三方加速源拉取；按 digest 拉取时 Docker 会校验内容，加速源给不了别的镜像。更新基础镜像走普通 task PR：在 Docker Hub 上查到新 digest（`hub.docker.com/v2/repositories/library/<名字>/tags/<tag>` 的 `digest`，是多架构索引的 digest），再和两个加速源返回的 `Docker-Content-Digest` 对一遍，三处一致才改；改完重做一次性部署 runner 的镜像（[CICD](CICD.md#自托管-runner)）。
- **构建阶段的下载源**（#104）：家里的自托管 runner 经仓库变量把 npm、Debian、better-sqlite3 预编译包换成国内镜像，工作流以同名 build arg 传进来；锁文件 integrity、corepack 签名、apt 签名照常核对，论坛的 pnpm 11.24.0 按写死的官方 sha512 核对。运行阶段是新的 `FROM`，不继承这些 ARG 与 ENV；server 运行镜像里唯一的痕迹是 pnpm 写在 `node_modules/.modules.yaml` 的 `registries`（安装元数据，运行时不读）。细节见 [CICD](CICD.md#构建下载源104)。
- **`FORUM_PORT` 三处一致**：compose 用 `expose: ["${FORUM_PORT}"]` 声明容器内端口，必须与 forum 镜像内 nginx 的 `listen`/`EXPOSE` 以及 web 容器 `proxy_pass http://forum:3000/` 三处同时一致；改值要一起改镜像与 web 的 nginx 配置。
- **镜像保留**：部署成功后只清理本环境仓库 `yzgc-<environment>/*` 的其它 tag，保留本栈历史中最新 5 个不同 tag + 当前 + 上一个；另一环境的仓库不在清理范围内；正在使用的镜像不会被强制删除。旧模型遗留的 `yzgc/*` 镜像两个脚本都不再使用也不清理，确认两套栈都已切到新仓库后由维护者手工删除。
- **自动回滚前先确认镜像在**：部署失败（compose up 或健康门）时，若本机没有本环境上一个版本的三个镜像，记 `ROLLBACK_SKIPPED` 并停下，不会用另一环境的同名 SHA 顶替；没有上一个版本（首次部署）同样记 `ROLLBACK_SKIPPED`。
- **incoming 清理**：部署成功（记 `OK`）后，删掉 `--incoming-dir` 里本环境的镜像归档（`yzgc-images-<environment>-<sha12>.tar.gz` 等及其 `.sha256`）和 `.env.<environment>`，本次和更早留下的都删，免得归档越积越多、密钥在磁盘上多一份副本。只看这个目录的直接文件，文件名要整串对上（末尾带换行之类的名字不算），另一环境的文件、别的文件（如分发来的 `deploy-stack.sh`）、子目录和目录之外的路径都不碰；与已安装的 `<栈根>/.env.<environment>` 是同一个文件的（`--incoming-dir` 就是栈根，或者栈根的 env 是指向它的符号链接、硬链接）也不删；没给 `--incoming-dir` 时不清理。部署失败（含已回滚）时不清理，留给维护者排查或在目标机上重跑。删除失败不改变部署结果（退出码 0，历史记 `OK`）：stderr 逐个报出没删掉的文件，stdout 另打一行 `::warning::清理 incoming 失败…`，经 ssh 回到 runner 后在 Actions 里显示成部署步骤的警告，由人删除残留（可能含带密钥的 env）。清理不影响回滚：自动回滚与 `rollback-stack.sh` 只用本机已装载的镜像和栈根里的 env 文件，镜像保留策略保证上一个版本的镜像还在。
- 目标机只 `docker load` 镜像并 `up -d`，**不在服务器上 `git pull` 后构建**。
- 同一环境同一时刻只允许一个部署任务；正式环境部署不得在切换过程中被新任务取消。工作流的 `concurrency: deploy-<environment>` 只让同环境的 CI 部署彼此排队，`flock` 只包住 `deploy-stack.sh`，上传在锁外，`scripts/deploy-manual.mjs` 两者都管不到。所以**不要让 `deploy-manual.mjs` 与同环境的 CI 部署同时跑**：运行前先确认这个环境没有正在跑或排队的部署工作流。两者重叠时，前一次成功后的 incoming 清理会删掉后一次已经上传的归档与 env 文件，后一次失败关闭、不会部署错版本；视时机停在上传后的 `sha256sum -c`、`deploy-stack.sh` 的「env 文件不存在」，或者等锁之后的「compose 文件解析出的镜像不是 …」（这时是 env 文件没了，不是 compose 文件旧）。

**实施状态**：`deploy/compose/{production,preview}.yml`、`deploy/nginx/{production,preview}.conf`、`deploy/remote/{deploy-stack,rollback-stack}.sh` 已入库并定义本模型。旧 systemd / 发布包模型的文件已随本次改造**删除**：`deploy/remote/{deploy-release,rollback}.sh`、`deploy/yzgc-admin.service`、`deploy/yzgc-preview.service`、`deploy/setup.sh`、根目录旧 `deploy/nginx*.conf`（含 `nginx-release-metadata.conf`）、`deploy/forum-subdomain-setup.md`、`scripts/release-bundle.mjs`、`tests/tooling/release-bundle.test.ts`。这些路径只存在于历史章节，不要按旧流程重建。

## 前置条件（部署前必须由维护者确认）

1. DNS：`prev.yangtzeu.work` 已有指向本机 IP 的 A 记录（2026-09-24 `dig` 核对为 `103.117.123.226`，与正式域名同一主机、不同栈）；不需要任何管理端子域记录。
2. TLS：宿主 nginx 用 certbot 签发/续期三张证书：`yangtzeu.work`、`prev.yangtzeu.work`、`github.yangtzeu.work`（最后一张只服务 301 跳转）；命令 `certbot certonly --webroot -w /var/www/html -d <域名>`。证书准备完成前不引用，改完先 `nginx -t` 再 reload。
3. 宿主 nginx：把 `deploy/nginx/production.conf`、`deploy/nginx/preview.conf` 分别安装到 `/etc/nginx/sites-available/` 并 symlink 进 `sites-enabled/`；TLS、ACME 挑战、安全头与旧管理端域名的 301 都由这两个文件负责，不要把两者配成同名 `server_name` 而冲突。
4. GitHub OAuth App：Callback URL 必须是 `<origin>/auth/callback`。正式环境切换当天，所有者要把现有 OAuth App 的 Callback URL 改成 `https://yangtzeu.work/auth/callback`；预发布另建一个 Callback URL 为 `https://prev.yangtzeu.work/auth/callback` 的 OAuth App（密钥不跨环境共用）。细节见 [ENVIRONMENTS](ENVIRONMENTS.md#github-oauth-app-回调地址)。
5. Docker 与 Compose v2 已安装；栈根目录存在且属部署用户；`<栈根>/.env.<environment>` 由部署脚本原子安装（含真实密钥，权限 600）。
6. 环境文件里的必填项（`HOST`、`TRUST_PROXY`、`PUBLIC_ORIGIN`、`DB_PATH`、`IMAGE_TAG` 等）缺失时 compose 会直接拒绝启动；不要靠临时改 compose 文件绕过。

## 证书续期与到期监控

所有者 2026-09-25：「这个签证书是要永久签哈，要一直监控着签。」

- **续期**：目标机 `certbot.timer`（systemd，每天两次）对 `/etc/letsencrypt/renewal/` 下的全部证书执行 `certbot renew`；`prev.yangtzeu.work` 与 `yangtzeu.work` 都走 webroot `/var/www/html`（两个 server block 的 80 端口都放行 `/.well-known/acme-challenge/`）。
- **续期后生效**：`/etc/letsencrypt/renewal-hooks/deploy/reload-nginx.sh` 在任何证书续期成功后执行 `nginx -t -q && systemctl reload nginx`；配置检查不过就不 reload，旧证书继续服务，由到期监控报警。
- **监控**：`.github/workflows/cert-watch.yml` 每天从公网核对两个入口的证书（有效、名字匹配、剩余不少于总有效期的四分之一，90 天证书约 22 天），不满足即失败，GitHub 通知维护者；它只在默认分支 `main` 上生效，所以合入 `main` 之后才开始每天检查。
- **已知噪音**：同一台机上还有不属于本项目的证书，其中一张续期失败、一张续期配置损坏，它们让 `certbot.service` 每次都以失败结束，但不影响其它证书续期；所以本项目的证书以 `cert-watch.yml` 的结论为准，不看 `certbot.service` 的整体状态。

## 首次上线记录（2026-09-25，#63）

只记录做了什么，不含任何密钥或私钥内容。

- 目标机 `103.117.123.226`（Ubuntu 22.04，2 核 2 GB，Docker 29 / Compose v5 已装）：先用只含 ACME 挑战的临时 80 端口块签发 `prev.yangtzeu.work` 证书，再换成入库的 `deploy/nginx/preview.conf`（`nginx -t` 通过后 reload）；新建 `/opt/yzgc/preview`；加上面的续期钩子。同机其它站点未改动。
- 部署 SSH：新的 ed25519 密钥（公钥以 `restrict` 选项加入目标机部署用户的 `authorized_keys`），私钥只在维护者机器与 `preview` 环境级 secrets 里；known_hosts 取自已信任的主机公钥。
- GitHub OAuth：正式环境用「Geek Class Admin」应用，新增回调 `https://yangtzeu.work/auth/callback`（旧的 `github.yangtzeu.work` 回调保留到旧站下线）；预发布用另一个应用，回调含 `https://prev.yangtzeu.work/auth/callback`。两个环境的会话密钥、加密密钥各自独立生成。
- Turnstile 未配（没有 Cloudflare 账号）：两项都为空＝关闭，见 [ENVIRONMENTS](ENVIRONMENTS.md)。

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
bash deploy-stack.sh  ... # 部署失败时自动回滚（见上文「失败即回滚」）
bash rollback-stack.sh --environment production --to <sha12|previous>
```

`rollback-stack.sh` 只做两件事：把 `<栈根>/.env.<environment>` 的 `IMAGE_TAG` 改成目标 tag，然后 `docker compose up -d`。目标镜像只在本环境仓库 `yzgc-<environment>/…` 里找，另一环境同一 SHA 的镜像不能代替；compose 文件解析出的镜像不是本环境仓库时直接失败。它**不触碰数据卷、不删除数据、不清理镜像、不改分支或版本号**；`previous` = `deploy-history.log` 中与当前不同的最近一个 tag。可选参数 `--env-file`、`--stack-root`、`--compose-file`、`--health-timeout` 与部署脚本同名同义，健康门同样生效；结果写入同一份 `deploy-history.log`。

回滚目标用发布 tag 来选：切回某个更早的 `vX.Y.Z`，对应镜像 tag 是 `git rev-parse "vX.Y.Z^{commit}" | cut -c1-12`。回滚不移动、不删除、不重打任何 tag，后续修复走新的 rc（见 [RELEASES](../conventions/RELEASES.md)）。

回滚后重新执行健康检查并记录结果。旧日志、旧请求排队不能覆盖更晚版本；切换前再次核对目标环境、镜像 tag 与当前部署序号。

## 最小权限

- 容器内进程非 root 运行（web 容器 nginx 以 nginx 用户跑非特权 8080）；镜像只含运行必需的代码与静态产物。
- 宿主 nginx 只做 TLS 终止与反代，不读取应用密钥；安全头统一在宿主下发，容器不重复。唯一例外是论坛页面的 CSP：论坛容器下发站点策略加上论坛内联脚本的哈希，宿主模板开头的 `map` 只在 `/forum/` 下、上游已带 CSP 时不再叠加第二份，其它路径照发站点策略（#78）。站点策略的 `media-src` 与 `connect-src` 放行 `https://cdn.crosery.com`（官网宣传片是 HLS，hls.js 用 XHR 取分片、以 `blob:` 地址交给 `<video>`，#77）。改宿主模板后要重新安装到服务器（只装对应环境那一份，先备份、`nginx -t` 再 reload），这一步不在 CI 里；发版后经公网确认 `/forum/` 只有一条带 `sha256-` 的 CSP（部署脚本的健康检查不经过宿主 nginx，查不出来）。
- 部署用户的 SSH 密钥只存在于 GitHub 环境级 secrets 与维护者机器（`scripts/deploy-manual.mjs` 通过 `DEPLOY_SSH_KEY_FILE` 读取）；不在仓库、脚本或日志中出现。
- 镜像与 env 文件按 600/最小权限落在栈根，发布产物不包含 `.env`、真实数据库或 SSH 材料；incoming 里分发来的归档与 env 副本在部署成功后删除（见「incoming 清理」）。

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
- 旧发布 tag（`release-X.Y.Z` / `prev-X.Y.Z`）不再产生发布身份；现行发布 tag 是 SemVer 的 `vX.Y.Z-rc.N` / `vX.Y.Z`，见 [RELEASES](../conventions/RELEASES.md)。
- 2026-09-23 至 2026-09-24 短暂使用过「push `stage` 部署预发布、push `main` 部署正式」的分支触发模型，已由发布 tag 触发取代。

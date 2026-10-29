# 部署、维护与恢复规范

> 两套隔离 Linux Docker 栈运行于 Arch，香港 Caddy 提供 HTTPS 入口；DNS 过渡期间旧 VPS 仅转发，不再运行应用或写库。

状态：`current` · 更新：2026-10-29 · 适用：GitHub admin#270 的迁移接管及后续发布；GitLab 同号身份事项与既有旁路服务见 [GITLAB](GITLAB.md)。

## 发布前置

**先遵守 [RELEASES](../conventions/RELEASES.md) 与 [BRANCHING](../conventions/BRANCHING.md)：发版只靠打 tag。`vX.Y.Z-rc.N` 打在 `stage` 的提交上部署预发布；在预发布试用并明确批准后，`main` 快进到同一提交，再打 `vX.Y.Z` 部署正式。** push `stage`/`main` 不部署。发布内容由发布 tag 指向的提交决定；镜像 tag 是该提交的 `<sha12>`。

发布前先过同构这一关（[RELEASE-PARITY](../conventions/RELEASE-PARITY.md)）：预发布做过、不在提交里的事（表结构的手工步骤、数据格式、env 键与密钥、宿主配置、外部服务）正式都做完，`node scripts/parity.mjs check --release` 清零；`deploy-production.yml` 与 `deploy-hotfix.yml` 的 `parity` job 会在清单有 `pending` 时拒绝构建与部署。三份 env（`.env.production`、`.env.preview`、`.env.dev`）由 `pnpm check:env-isolation` 核对，正式的值不会混进预发布，反之亦然。

hotfix 派发前先确认 `deploy/hotfix/windows.json` 里这个 P0 issue 的窗口是 `open` 且没过期（所有者批准的原话在登记里），否则 `deploy-hotfix` 的 plan 失败。GitLab 签发者改接走 `gitlab-cutover.yml`：先 `migrate-subjects` 演算，再 apply；正式库缺失的有效旧成员由 server 镜像的 `account.js provision-github` 按 GitHub UID 最小补建并保留原 `sub`，不按邮箱合号，随后才能 `switch-issuer`。登记里的原话若含正式站域名，`check-env-isolation` 会判为写死；原话不改写，在 `deploy/env/origin-exceptions.json` 登记 `deploy/hotfix/windows.json`（`max: 1`）并写理由（#310，2026-10-29）。`deploy/` 下每次改动后，文档的更新时间都要晚于这次改动，否则 plan 的文档同步检查失败。hotfix 的 MR 合进 `main` 后，立刻用 `node scripts/hotfix-sync.mjs apply` 把 `main` 同步到镜像远端并合回 `stage`；线上核对通过后加 `--close-window <issue> --evidence "…"` 关闭窗口。

发布者明确目标环境、commit、镜像 tag、回滚对象和维护窗口。先在本地或 CI 完成 `pnpm verify` 与相关浏览器检查，再部署；不从含无关修改的工作区发布。核心与论坛使用两套工具链（Node 22/pnpm 9.15.9 与 Node ≥26/pnpm 11.24.0），镜像构建在容器内完成，不上传 Mac 原生依赖。

## 迁移现状与授权边界

2026-10-26 所有者追加授权无损迁移、Arch 只作 Docker 宿主，并在迁移后要求统一 GitHub 发版与现行连接信息。原版双栈已接管，不再是隔离候选副本。证据在主工作区 `.tools/handoff/2026-10-26-migration/RESULTS.md` 及 `evidence/`；发布连接复验在 `.tools/handoff/2026-10-26-release-target/`。后续运行变化须重新取证。

| 对象 | 已验证状态 | 边界 |
|---|---|---|
| Arch 正式 | `v0.1.0`，`d4a24749d0775929f6ec88413f419bd9d03c6f86` | 未升级正式应用 |
| Arch 预发布 | `v0.1.1-rc.25`，`02cb751c0b830c0e686a180f6c6c5870c0c055ec` | 未创建新的 rc |
| 两套栈 | 6 个原镜像容器 healthy；最终停写快照的全表/schema/文件摘要与目标启动前一致，原 sessions 保留 | 后续新写入只在 Arch，不能重开旧冻结库 |
| 原应用设置 | 原密钥未轮换；两环境 `MAIL_RECIPIENTS=all`、预发布 `GITLAB_SYNC=on`，身份源不变 | 不用副本隔离开关覆盖当前权威源 |
| 香港 | `/etc/caddy/sites/yzgc.caddy` 已生效，两域名可信 TLS，新旧入口 52/52、交替 SNI 20/20 通过 | 未故意断隧道或重启宿主验证 |
| 旧 VPS | 六个应用容器停止；legacy Node、旧 guard/backup timer 停用；Nginx 转发香港 | DNS 与旧管理域兼容跳转未收尾，不删除旧机或恢复材料 |

后续发布目标只允许 Arch。GitHub 双环境 SSH 配置已改新目标，应用 secrets 按各环境原运行值同步；专用 key 的双环境 SSH/SCP 实测通过。源码仍在 task270 待集成，未运行新的 Actions 发布；旧 tag 不会获得新脚本能力。本轮没有新版本授权，不创建/移动/补推 tag，不切 DNS，不改变 GitLab 身份源。

## 拓扑

```text
当前链路（DNS 尚未切换）
互联网 → 旧 VPS Nginx（仅转发）→ 香港 Caddy（TLS）
  → ssh -w 三层点对点隧道 10.66.0.1 ↔ 10.66.0.2
  → Arch web：10.66.0.2:18100 / 18200 → web 容器 nginx:8080
      ├─ /console、/admin、/signin 等 → 控制台静态入口
      ├─ /api/*、/auth/*、/oidc/*、/healthz → 本环境 server:3000
      ├─ /c/* → server 比赛官网（保留 sandbox CSP）
      ├─ /forum/* → 本环境 forum:3000（保留论坛内联哈希 CSP）
      └─ /sdk/*、/cli/*、其余路径 → SDK、CLI 分发、portal 静态产物
```

后端只信任 Caddy 与 web nginx 两层，`TRUST_PROXY=2`。DNS 过渡多经过旧 Nginx，但它覆盖外来 X-Real-IP，Caddy 仅对来自旧 VPS 地址的请求读取该值，其他请求按实际远端地址重建 X-Forwarded-For；客户端伪造头实测未被信任。`ssh -w` 不增加 HTTP 代理层，Arch 不叠宿主 nginx。DNS 后续指向香港 `156.238.244.78`，不是 Arch 私有地址。

web 镜像构建阶段分别构建 `app/web`（官网）与 `app/console`（控制台），把两份 dist 叠进同一个站点根（`sites/portal/` + `assets/`，`sites/console/` + `console-assets/`，目录不重叠）。

`deploy/nginx/{production,preview}.conf` 保留为网关策略源；现行公网配置在香港 Caddy，不能再把这两份 Nginx 模板装回旧 VPS 以恢复旧栈。迁移时从源机各环境真实策略提取 CSP、安全头、压缩和重定向，保留原版本差异。旧 Nginx 仅转发 HTTPS，保持上游证书验证、深度 3，关闭跨 SNI 的会话复用；ACME 路径本地文件优先再转香港。

`scripts/render-arch-caddy.mjs --out <空待审目录>` 仍是待集成生成器，派生四份 Caddy 文件，不是当前香港配置的安装来源。它尚未包含 DNS 过渡期间信任旧入口并重建客户端地址的完整逻辑，不能覆盖 live 配置。默认不含旧 `github.yangtzeu.work`；该兼容跳转仍在旧 VPS，不因主域迁移而自动迁走。

香港回环 `18480/18481` 仅是私有预检设计，不能代替真实域名验证。后续候选配置先留非 import 目录，获批前不放进自动加载的 `/etc/caddy/sites/*.caddy`；变更先 validate 再 reload，保留 GitLab handler，不 restart 相邻服务。

`/release.json` 由 **web 镜像内置**（构建时用 build args 生成的静态文件，`Cache-Control: no-store`），不再是宿主 nginx 的 alias。

论坛不再是独立子域，而是 portal 域名下的 `/forum` 路径；旧 `forum.yangtzeu.work` 子域模型已退役（见文末历史章节）。

## Docker 网络与维护

- 固定项目子网：production `172.31.181.0/24`、preview `172.31.182.0/24`；server DNS 为 `1.1.1.1` / `8.8.8.8`。固定子网与出网规则绑定，后续 Compose 不能丢失这些字段。
- Arch 规则优先级 91/92 查询表 18182，经 tun0 到香港；保留 Docker 默认 NAT，香港追加 `yzgc-docker-egress` 出口 NAT。只作用于项目子网，不改宿主默认路由；容器到 GitHub/GitLab/Google 均实测 200。
- 两端 `yzgc-egress.service` 持久化网络；Arch `yzgc-compose@production.service` / `@preview.service` 在 Docker 与隧道之后编排 Compose，不运行宿主业务 Node。
- 隧道抖动不拖垮站点（#309，物料由 `deploy/remote/install-host.sh` 在部署后自动安装并核对，不需要登录目标机）：`hk-tunnel-watchdog` 原来只要一次 ping 丢包就重启 `hk-tunnel`，`yzgc-egress` 跟着重启，又因 `yzgc-compose@` 写 `Requires=yzgc-egress.service` 把六个容器一起停掉再拉起，整站断 25 秒以上，GitLab 也随隧道一起断。现在 [`yzgc-compose@.service`](../../deploy/remote/systemd/yzgc-compose@.service) 改为 `Wants=`，egress 重启只重放路由；[watchdog 覆盖项](../../deploy/remote/systemd/hk-tunnel-watchdog.service.d/tolerate-loss.conf)改为 tun0 地址消失立刻重启、否则连续 3 次 ping 都丢才重启。回滚：安装器覆盖前会留 `<目标文件>.bak-<UTC 时间>`；把仓库里这两份物料 revert 后重新部署即可，不手改目标机（2026-10-28 首次手工安装时的备份在 Arch `/root/yzgc-compose@.service.bak-20261028T2030`）。隧道本身仍是单条链路，掉线期间 `git.yangtzeu.work` 不可达，根治需要第二条路径，未实施。
- `/opt/yzgc/tools/docker-backup.py` 在原 Linux 镜像内做保留 sessions 的一致备份，每份再断网恢复核对；`yzgc-backup@*.timer` 北京时间 04:00、随机延后不超过 10 分钟。`yzgc-health.timer` 每 10 分钟只读检查，不全局 prune。详见 [BACKUP](BACKUP.md)。
- 这些实机维护工具暂由迁移交接中的源码保全；现有 `platform-maintenance.sh` / `platform-backup@` 是另一套未安装候选，不能混称已纳管或覆盖现行任务。

## 两套栈

| 项 | production（正式） | preview（预发布） |
|---|---|---|
| 发布 tag（提交所在分支） | `vX.Y.Z`（`main`） | `vX.Y.Z-rc.N`（`stage`） |
| 栈根目录 | `/opt/yzgc/production` | `/opt/yzgc/preview` |
| compose 文件 | `deploy/compose/production.yml` | `deploy/compose/preview.yml` |
| compose 项目名 | `yzgc-production` | `yzgc-preview` |
| 环境文件（目标机） | `<栈根>/.env.production`（脚本安装为 600） | `<栈根>/.env.preview` |
| 入口域名（唯一） | `yangtzeu.work`（`github.yangtzeu.work` 仅 301 到这里） | `prev.yangtzeu.work` |
| web 宿主端口（Arch 目标） | `10.66.0.2:18100` → 容器 8080 | `10.66.0.2:18200` → 容器 8080 |
| server 宿主端口（调试/健康门） | `127.0.0.1:18101` → 容器 3000 | `127.0.0.1:18201` → 容器 3000 |
| 容器内端口 | web 8080 / server 3000 / forum 3000 | web 8080 / server 3000 / forum 3000 |
| 数据 | 命名卷 `<项目名>-data` 挂到 server 的 `/data` | 独立命名卷，不共享 |
| 部署锁与历史 | `<栈根>/.deploy.lock`、`<栈根>/deploy-history.log` | 同结构，互相独立 |

两栈必须使用独立目录、项目、网络、数据卷、密钥、域名与锁；Cookie 为 host-only，禁止 `.yangtzeu.work`。server 仅回环，web 仅 Arch tun0 或旧源兼容回环，禁止 `0.0.0.0`/任意外部网卡；forum 不发布宿主端口。Compose 的 `internal` 是网络名称，不是 `internal: true`，**不能据此认定副本已断外网**。当前候选限额为 server `512m/1CPU`，web/forum 各 `128m/0.5CPU`；尚未在 Arch 实测，不是容量承诺，不能挤压既有 GitLab、隧道与 SSH。

镜像名按环境分仓库：正式 `yzgc-production/{server,web,forum}:<tag>`，预发布 `yzgc-preview/{server,web,forum}:<tag>`，tag = 本次 commit 的 `<sha12>`，部署时写入目标机环境文件的 `IMAGE_TAG`。两套栈共用同一个 Docker 守护进程，同一提交的正式与预发布镜像构建参数不同（`release.json`、版本串），共用镜像名会在 `docker load` 时互相覆盖；仓库名在 compose 文件里是字面量，不从 env 文件读取，`scripts/deployment-environment.mjs --check` 会拒绝两套 compose 在同一 SHA 上解析出相同镜像引用。构建上下文是仓库根，`dockerfile: app/<service>/Dockerfile`；每个服务有 `app/<service>/.dockerignore`，另有根 `.dockerignore` 控制上下文（Docker 读的是构建上下文根下的那一份，因此根文件才是实际生效的排除规则）。三个镜像共享同一组 build args：`GEEK_DEPLOYMENT_ENVIRONMENT`（必填，`production`/`preview`）、`GEEK_RELEASE_VERSION`、`GEEK_RELEASE_COMMIT`；论坛会校验组合（预发布要 `X.Y.Z-rc.N@<sha12>`、正式要 `X.Y.Z`、commit 必须 40 位十六进制），不合格直接构建失败。另有只在构建阶段生效的下载源参数：`NPM_REGISTRY`（三个镜像）、`DEBIAN_MIRROR` 与 `BETTER_SQLITE3_BINARY_HOST`（只有 server），不传就是官方源，不进运行镜像；取值、校验与信任依据见 [CICD](CICD.md#构建下载源104)。

## 部署流程

后续发布由 tag 对应的 CI 产物、环境审批及部署入口完成，详见 [CICD](CICD.md)。已完成的原版迁移复用原镜像及最终停写全卷快照，没有重建同一 tag 或清除 sessions；`export-stack-snapshot.mjs` 的业务导出不等于此次全量迁移。后续不得把工作区新脚本拼进旧 tag 物料。

### Arch 副本启动前的独立门禁

1. 正式和预发布分别在**新空命名卷**恢复，不以 preview 整库覆盖 production，不用 `--force` 覆盖未知目录；完整工具布局和验证见 [BACKUP](BACKUP.md)。
2. `prepare-arch-runtime.mjs` 只准备运行配置：`/config` 挂该环境栈根，`/templates` 只读挂模板；保留原 `ENCRYPTION_KEY` 等密钥，设置 env sync off、邮件空白名单。它不修改恢复库，输出 `gitlab_sync: off` 只说明 env，**不是有效同步模式的证明**。
3. `app_state(key='gitlab_settings').value.mode` 会覆盖 `GITLAB_SYNC`；核心真实入口还会启动 GitLab 同步及贡献收集循环。须先在出站隔离下独立验证恢复副本的 **effective mode 为 off**、贡献收集不访问 GitLab/不计分、邮件无外发。`dry-run` 也不能替代贡献收集的 off 门禁。需改复制库时先获该目标的数据操作批准；不修改旧源/原快照，不提供随意 UPDATE 线上库的捷径。
4. 准备器不等于部署器；先形成受控 incoming 配置，再由标准脚本原子安装。已有 canonical env、历史部署或半成品目录须核对，不能当全新栈盲目覆盖。
5. 本节只约束另建的隔离恢复副本，不用于关闭已接管权威源的外发；本地测试、目标启动、真实代理链验证与所有者验收分别取证。

`node deploy/remote/verify-arch-replica.mjs --environment <production|preview> --env-file <明确文件> --database <独立一致快照>` 提供只读配置门禁：核对环境/原版本/bind、邮件空名单、env 与持久 sync off、非空原加密密钥；WAL 格式或 WAL/SHM/journal 旁文件、非法持久设置一律拒绝，不修库。其 `scope=configuration` 与 `encryption_key_match_verified=false` 不证明原密钥匹配、业务完整性或实际无外发；完整分发布局见 [BACKUP](BACKUP.md)。

### SSH 目标绑定

`deployment-environment.mjs ssh-config` 是 CI/manual 共用入口：先核对 `DEPLOY_TARGET_ENVIRONMENT` 与模板身份，再逐字核对 `DEPLOY_SSH_HOST/PORT/USER` 与该提交的 `DEPLOY_HOST/PORT/USER`。Arch 模板为 `10.66.0.2:22`，`DEPLOY_PROXY_JUMP=root@156.238.244.78:22`；旧源地址不符必须在任何 SSH/SCP 前失败，缺失值也不 fallback。跳板只能来自模板，直连要显式留空。

SSH/SCP 共用 `-F <本次受控配置> yzgc-target`，固定 `IdentitiesOnly`、`BatchMode`、`StrictHostKeyChecking=yes` 和专用 known_hosts；必须预先核验**跳板与 Arch 双端主机公钥**并配置专用部署 key。模板的 root 用户不是可达性/权限证明，不把个人 root 私钥上传 CI，不关闭主机密钥检查。新代码只存在于工作区不代表旧发布 tag 已具备此保护。

本地可只读核对：`node scripts/deployment-environment.mjs --check`、`node --check scripts/render-arch-caddy.mjs`、`node --experimental-strip-types scripts/backup-restore.mjs --help`；它们不生成 SSH 配置、不连目标机，也不放行部署。

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

- **部署参数事实源**：`STACK_ROOT`、`COMPOSE_PROJECT_NAME`、`IMAGE_TAG`、`SERVER_BIND`、`WEB_BIND`、`SERVER_PORT` 从 env 文件读取，原子安装为 `<栈根>/.env.<environment>`（0600）；这不表示业务开关只由 env 决定，持久化 GitLab mode 的覆盖见上文副本门禁。
- **env 文件只能操作自己环境**：`deploy-stack.sh` 与 `rollback-stack.sh` 都要求 `STACK_ROOT` 的最后一段逐字等于 `--environment`、`COMPOSE_PROJECT_NAME` 逐字等于 `yzgc-<environment>`，并且上面这些键在文件里只能出现一次（重复键直接失败，不取最后一个值）。否则一份 preview env 指向 `/opt/yzgc/production` 就能用 preview 的镜像与密钥 up/回滚正式栈与 `yzgc-production-data` 卷。
- **渲染出的运行时 env 用原子替换**：`deployment-environment.mjs render` 先写同目录 0600 临时文件再 `rename`，目标已存在时同权限收紧为 0600；`--out` 是符号链接时拒绝渲染，避免密钥顺着链接写到别处（`mode: 0o600` 只对新建文件生效）。
- **镜像只属于本环境**：装载前读归档里 `manifest.json` 的 `RepoTags`，只接受 `yzgc-<environment>/{server,web,forum}:<IMAGE_TAG>` 这三个，出现另一环境、旧的 `yzgc/*` 或别的 tag 即拒绝（不 `docker load`，也不重新打 tag）；compose 文件解析出的镜像也必须恰好是这三个，目标机上残留旧版 compose 文件时直接失败。
- **镜像包校验失败关闭**：必须能核到 sha256（`<包>.sha256`、去扩展名的同名 `.sha256`，或同目录的 `SHA256SUMS`/`sha256sums.txt`/`checksums.txt`），缺失或不等即拒绝部署。
- **串行锁**：`flock <栈根>/.deploy.lock`（等待 900s），production 与 preview 各自独立串行。锁只包住 `deploy-stack.sh`（`rollback-stack.sh` 用同一把），上传归档与 env 文件（scp）在锁外，见下文「同一环境同一时刻只允许一个部署任务」。
- **健康门**：按实际 `SERVER_BIND` 与 `WEB_BIND` 探测 `http://<bind>/healthz`，两者都须 HTTP 200 且 `"ok":true`；默认 180s 超时、3s 间隔，每轮先探测再判超时，`rollback-stack.sh` 相同。Arch web 走 tun0 地址，不再硬测不存在的回环映射；直连健康门不覆盖香港 TLS/代理和身份链路。
- **失败即回滚**：`docker compose up -d` 本身失败（web 对 server 是 `depends_on: condition: service_healthy`，新 server 起不来时 up 自己就非零退出）与健康门超时走同一条路：记 `FAILED`（说明里写是哪一种），有上一个版本就把 `IMAGE_TAG` 切回部署前的值、重新 `compose up -d` 并复检，通过记 `ROLLED_BACK`，不通过记 `ROLLBACK_FAILED`；无论哪种结局脚本都非零退出。回滚只用本机已装载的镜像，不读 incoming 里的归档。
- **历史记录**：追加写 `<栈根>/deploy-history.log`，制表符分列 `<UTC ISO8601> <环境> <生效版本> <结果> <说明>`。第 3 列是**该次动作后真正在跑的 tag**：`OK` / `MANUAL_ROLLBACK` 行 = 部署后生效的 tag；`FAILED` 行 = 尝试部署但没起来的 tag；`ROLLED_BACK` 行 = 回滚后真正生效的旧 tag（说明里写明目标版本未上线）。镜像保留策略与 `rollback-stack.sh --to previous` 都按这一列判断。结果取值：`OK` / `FAILED` / `ROLLED_BACK` / `ROLLBACK_FAILED` / `ROLLBACK_SKIPPED`（部署）与 `MANUAL_ROLLBACK` / `MANUAL_ROLLBACK_FAILED`（回滚）。
- **镜像构成**：`node:22-bookworm-slim`（server 构建与运行）、`node:22-bookworm-slim` + `nginx:1.31-alpine`（web 构建 + 运行）、`node:26-bookworm-slim` + `nginx:1.31-alpine`（forum 构建 + 运行）。基础镜像大版本变更必须单独验证（1.27 系列已下线，不要再回退到旧 tag）。
- **基础镜像按 digest 固定**（#97）：三个 Dockerfile 的 `FROM` 写成 `<tag>@sha256:<digest>`，每次构建用同一份基础镜像；不管从 Docker Hub 还是从加速源拉取，Docker 都按 digest 校验内容，换不了镜像。CI 与部署都在 GitHub 托管 runner 上，直接从 Docker Hub 拉取（[CICD](CICD.md#运行位置)）。更新基础镜像走普通 task PR：在 Docker Hub 上查到新 digest（`hub.docker.com/v2/repositories/library/<名字>/tags/<tag>` 的 `digest`，是多架构索引的 digest），改三个 Dockerfile 的 `FROM`。（`historical`：#97 加这条时，家里的自托管 runner 连不上 Docker Hub，只能经第三方加速源拉取，所以还要和两个加速源返回的 `Docker-Content-Digest` 对一遍、改完重做部署 runner 的镜像；那台 runner 已于 #139 退役，这两步不再需要。）
- **构建阶段的下载源**（#104）：工作流可以经仓库变量把 npm、Debian、better-sqlite3 预编译包换到别的源，以同名 build arg 传进来；当初是给家里的自托管 runner 换国内镜像，那台 runner 已于 #139 退役；变量没设时构建走官方源（2026-10-02 核对时三个都没设）。锁文件 integrity、corepack 签名、apt 签名照常核对，论坛的 pnpm 11.24.0 按写死的官方 sha512 核对。运行阶段是新的 `FROM`，不继承这些 ARG 与 ENV；server 运行镜像里唯一的痕迹是 pnpm 写在 `node_modules/.modules.yaml` 的 `registries`（安装元数据，运行时不读）。细节见 [CICD](CICD.md#构建下载源104)。
- **`FORUM_PORT` 三处一致**：compose 用 `expose: ["${FORUM_PORT}"]` 声明容器内端口，必须与 forum 镜像内 nginx 的 `listen`/`EXPOSE` 以及 web 容器 `proxy_pass http://forum:3000/` 三处同时一致；改值要一起改镜像与 web 的 nginx 配置。
- **镜像保留**：部署成功后只清理本环境仓库 `yzgc-<environment>/*` 的其它 tag，保留本栈历史中最新 5 个不同 tag + 当前 + 上一个；另一环境的仓库不在清理范围内；正在使用的镜像不会被强制删除。旧模型遗留的 `yzgc/*` 镜像两个脚本都不再使用也不清理，确认两套栈都已切到新仓库后由维护者手工删除。
- **自动回滚前先确认镜像在**：部署失败（compose up 或健康门）时，若本机没有本环境上一个版本的三个镜像，记 `ROLLBACK_SKIPPED` 并停下，不会用另一环境的同名 SHA 顶替；没有上一个版本（首次部署）同样记 `ROLLBACK_SKIPPED`。
- **incoming 清理**：部署成功（记 `OK`）后，删掉 `--incoming-dir` 里本环境的镜像归档（`yzgc-images-<environment>-<sha12>.tar.gz` 等及其 `.sha256`）和 `.env.<environment>`，本次和更早留下的都删，免得归档越积越多、密钥在磁盘上多一份副本。只看这个目录的直接文件，文件名要整串对上（末尾带换行之类的名字不算），另一环境的文件、别的文件（如分发来的 `deploy-stack.sh`）、子目录和目录之外的路径都不碰；与已安装的 `<栈根>/.env.<environment>` 是同一个文件的（`--incoming-dir` 就是栈根，或者栈根的 env 是指向它的符号链接、硬链接）也不删；没给 `--incoming-dir` 时不清理。部署失败（含已回滚）时不清理，留给维护者排查或在目标机上重跑。删除失败不改变部署结果（退出码 0，历史记 `OK`）：stderr 逐个报出没删掉的文件，stdout 另打一行 `::warning::清理 incoming 失败…`，经 ssh 回到 runner 后在 Actions 里显示成部署步骤的警告，由人删除残留（可能含带密钥的 env）。清理不影响回滚：自动回滚与 `rollback-stack.sh` 只用本机已装载的镜像和栈根里的 env 文件，镜像保留策略保证上一个版本的镜像还在。
- 目标机只 `docker load` 镜像并 `up -d`，**不在服务器上 `git pull` 后构建**。
- 同一环境同一时刻只允许一个部署任务；正式环境部署不得在切换过程中被新任务取消。工作流的 `concurrency: deploy-<environment>` 只让同环境的 CI 部署彼此排队，`flock` 只包住 `deploy-stack.sh`，上传在锁外，`scripts/deploy-manual.mjs` 两者都管不到。所以**不要让 `deploy-manual.mjs` 与同环境的 CI 部署同时跑**：运行前先确认这个环境没有正在跑或排队的部署工作流。两者重叠时，前一次成功后的 incoming 清理会删掉后一次已经上传的归档与 env 文件，后一次失败关闭、不会部署错版本；视时机停在上传后的 `sha256sum -c`、`deploy-stack.sh` 的「env 文件不存在」，或者等锁之后的「compose 文件解析出的镜像不是 …」（这时是 env 文件没了，不是 compose 文件旧）。

**源码与运行分开**：原版应用已迁移，新的 Compose、deploy/rollback 与 CI 变更仍待集成审查。旧 `yzgc-admin.service` 已实测停用，不再作为入口；只保留过渡 Nginx、certbot 与恢复材料。香港现行配置来源及尚未纳管的维护脚本见上文，不能从工作区存在文件推断已安装。

## 前置条件（部署前必须由维护者确认）

1. 目标为已接管的 Arch + 香港 Caddy；DNS 仍由所有者另行切换。香港证书已签发并由 Caddy 续期；旧入口 nginx/certbot 保持过渡服务。
2. 后续香港配置变更先审查、validate，再获批 reload；保留 GitLab 与其他站点，复验 CSP、真实 IP 和两域名 SNI。
3. 两端专用部署 key/known_hosts 与 GitHub 环境目标已匹配并实测；新版本物料仍要通过目标门禁，不能绕过校验去连旧机。SSH/SCP 本机通过不代表新 Actions 工作流已执行。
4. OAuth 回调继续逐字匹配本环境 origin；新的完整授权往返未验证，不能用旧会话仍可用代替。
5. 保留独立卷与原密钥；原版本接管后保持原外发行为。只有另建隔离恢复副本时才使用副本关闭外发门禁，不把它应用于权威源。
6. 发布仍需要获批 tag、完整物料与原门禁；不重置数据库或临时放宽校验求绿。

## 证书续期与到期监控

2026-09-25：「这个签证书是要永久签哈，要一直监控着签。」
香港 Caddy 已取得两个入口的可信证书并自动管理续期；`cert-watch.yml` 按公开域名监控，到 DNS 切换后继续生效。下列 nginx/certbot 仅是旧入口过渡期的续期安排，不是 Arch 安装步骤。未模拟未来证书到期或重启整机。


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

字段、非密模板目标、`DEPLOY_PROXY_JUMP`、密钥注入和副本安全限制集中在 [ENVIRONMENTS](ENVIRONMENTS.md)。`TRUST_PROXY=2` 对应两层代理，`HOST=0.0.0.0` 仅用于容器内；发布身份只经 build args。邮件/sync 的模板值、运行副本值和数据库 effective mode 必须分别核对，不能只改日期或复制一份 env 当作部署完成。

禁止把真实密钥写入仓库、镜像、日志或发布记录；`.env` 由目标机最小权限保存，不打印、不提交。

## 数据与备份

- 每个环境的数据都在自己的命名卷里（server 的 `/data`：`data.db`、比赛官网站点包解开后的文件 `sites/<比赛>/<版本>/`（#278，与 `DB_PATH` 同目录，备份数据库时一起备份）、旧论坛兼容路径）；forum 容器当前不挂卷、无服务端持久化。两栈互不可见。
- 旧站数据已按独立授权拉到 Mac 私有目录，见 [FORUM-DATA-CAPTURE](FORUM-DATA-CAPTURE.md)；这是源数据保全，不是 schema 迁移，不自动替换线上库，也不放进镜像或 CI。
- 变更表结构尽量增量兼容，不自动删除或重排。变更前使用 SQLite 在线 backup API 或停服的一致性备份，不能只复制活动 WAL 主文件并假定完整。备份同时记录镜像 tag、环境与应用版本，并完成恢复演练。
- 日常备份、搬迁和恢复演练走控制台「备份」页一键导出（#282，节点 `system.backup`，`GET /api/console/backup`）：正是上一条的实现，归档里带着 SQLite 在线备份的快照、`sites/` 站点文件和一份 manifest（镜像 tag、环境、每张表的行数、每个文件的 sha256）；恢复用 `scripts/backup-restore.mjs`。完整说明、排除哪些数据和跨环境搬迁步骤见 [BACKUP](BACKUP.md)。
- 镜像保留策略（最新 5 个 tag + 当前 + 上一个）只清理镜像，不清理数据卷；**回滚不重置数据库**，结构不兼容时停下来由人处理。
- 禁止把业务数据库用于自动测试。

## 回滚

```bash
# 获批后在目标机执行；CI/manual 将同 tag 的两个脚本一起分发到本环境 incoming：
bash /opt/yzgc/production/incoming/rollback-stack.sh --environment production --to previous
```

预发布对应 `/opt/yzgc/preview/incoming/rollback-stack.sh`，不能混用环境。2026-10-26 实查 Arch 两环境目前只有迁移原物料 `deploy-stack.sh`，尚无 `rollback-stack.sh`；以上命令须等获批 tag 的两个脚本一起分发后使用。不能拿工作区草稿覆盖旧发布物料。当前可用的是已验证的全量备份与隔离恢复路径，不冒称应用版本回滚已执行。

`rollback-stack.sh` 只做两件事：把 `<栈根>/.env.<environment>` 的 `IMAGE_TAG` 改成目标 tag，然后 `docker compose up -d`。目标镜像只在本环境仓库 `yzgc-<environment>/…` 里找，另一环境同一 SHA 的镜像不能代替；compose 文件解析出的镜像不是本环境仓库时直接失败。它**不触碰数据卷、不删除数据、不清理镜像、不改分支或版本号**；`previous` = `deploy-history.log` 中与当前不同的最近一个 tag。可选参数 `--env-file`、`--stack-root`、`--compose-file`、`--health-timeout` 与部署脚本同名同义，健康门同样生效；结果写入同一份 `deploy-history.log`。

回滚目标用发布 tag 来选：切回某个更早的 `vX.Y.Z`，对应镜像 tag 是 `git rev-parse "vX.Y.Z^{commit}" | cut -c1-12`。回滚不移动、不删除、不重打任何 tag，后续修复走新的 rc（见 [RELEASES](../conventions/RELEASES.md)）。

回滚后重新执行健康检查并记录结果。旧日志、旧请求排队不能覆盖更晚版本；切换前再次核对目标环境、镜像 tag 与当前部署序号。

### 最终切换与含新写入的回退

2026-10-26 已停止旧应用、分别完成最终全卷快照与恢复，在原版镜像下接管并转发旧入口；Arch 为唯一写入源，原账号/GitLab 映射/sector/sub/会话及密钥保留。DNS 尚未切换不等于旧库仍是权威源。本次切换出现过已修复的 TLS 502，不宣称零停机；应用升级仍需新的 rc 验收与精确版本授权。

回退必须先冻结新机写入，保全新帖子、报名、账号及积分事件并生成可核对的恢复点；验证旧镜像与迁后库/新增写入兼容，确定可执行回灌路径后才切回。只改 DNS 回旧库、丢弃新写入不算回滚。旧源、原镜像和恢复点保留完整观察窗口，停服与删除另批。

## 最小权限

- 容器内进程非 root 运行（web 容器 nginx 以 nginx 用户跑非特权 8080）；镜像只含运行必需的代码与静态产物。
- **CSP 与代理等价性**：现行安全头由香港 Caddy 下发，旧入口已去掉重复头。论坛保留上游内联 `sha256-` CSP，不叠冲突策略；迁移复验首页和论坛均只有一份 CSP。原生产与预发布版本的策略差异保留，没有借迁移升级生产策略。HLS、GLB、CDN 和比赛 sandbox 的完整业务路径仍分别验证，生成器通过不代表已安装。
- **比赛官网**：`/c/<slug>/` 的 server sandbox CSP 必须与默认策略取交集，不被边缘覆盖。容器仅比赛 zip 上传入口放宽到 21m，站点网关策略源仍为 6m，生成器沿用该上限；大包经整条链可能 413，不能顺带扩权。论坛 CSP、sandbox、上传/旧链接/HLS、Host/SNI、Secure Cookie/OIDC 和真实 IP 防伪造都列为目标验收，不由直连 `/healthz` 代替。
- 部署用户的 SSH 密钥只存在于 GitHub 环境级 secrets 与维护者机器（`scripts/deploy-manual.mjs` 通过 `DEPLOY_SSH_KEY_FILE` 读取）；不在仓库、脚本或日志中出现。
- 镜像与 env 文件按 600/最小权限落在栈根，发布产物不包含 `.env`、真实数据库或 SSH 材料；incoming 里分发来的归档与 env 副本在部署成功后删除（见「incoming 清理」）。

## 静态资源 CDN（#295）

完整合同见 [CDN](CDN.md)，发布接线见 [CICD](CICD.md)。只允许构建前缀 `https://cdn.yangtzeu.work/geek-public/static/site/`，公开对象在 `geek-public`；HLS 在 `media/promo/`，邮件图片在 `mail/v1/`，业务数据不外移。

- 先在香港按两环境策略源核对现行 Caddy 配置，保留论坛内联哈希与比赛 sandbox，备份、validate 并在授权后 reload，再经公网核对 CSP，再由受保护发布 job 注入 S3 环境凭据。无凭据或未放行 CSP 时按原约定同源构建；签名请求401或网络失败不得绕过认证或回旧服务。
- 镜像始终保留全部同源构建资源，表情 BLOB 同源接口保持可用；宣传片、邮件和指南的固定 CDN 地址不能靠空构建开关恢复。
- 上传器只在已存在对象完整 GET 逐字一致时复用，冲突拒绝；没有主动删除/覆盖调用，但 Garage 不提供 insertOnly/条件创建/WORM，跨进程与恶意写入者竞态未被客户端隔离。
- 回滚到旧镜像所引用的资源不能删除；旧镜像仍引用旧供应商时，父级需保留原资源及迁移哈希清单，不移动发布 tag。
- 新端点的两环境 GET/HEAD/Range、MIME、CORS、缓存、HLS 全链、匿名权限、TLS 与浏览器均由父级真实验收。旧七牛的防盗链、压缩和 CORS 实测不能作为新服务已经生效的证据。
- 源站 web/forum nginx 的 gzip 级别保持6；本任务不修改压缩策略、镜像身份或部署授权门禁。

## 香港对象存储（站点静态资源与备份归档）

`cdn.yangtzeu.work` 是香港一台 1 vCPU / 1 GiB 小机器上的 S3 兼容对象存储（Garage + Caddy + S3 Manager），承担站点带哈希静态资源、表情包、宣传片和邮件图片的公共出口（`geek-public`），以及 GitLab 与平台备份的归档（`geek-backup`）。预发布与正式的页面只有在边缘 CSP 放行 `https://cdn.yangtzeu.work/geek-public/static/site/` 后才会以 CDN 模式构建（`deploy-*.yml` 的 cdn-plan 读线上响应头）；七牛 `https://cdn.crosery.com` 不再增写，旧对象只留给 rc.25 及更早版本回滚。

- 配置模板在 [`deploy/storage-cdn/`](../../deploy/storage-cdn/)（`garage.toml`、`s3manager.env`、`Caddyfile`、`edge.caddy`、`scripts/upload_demo.py`），合同见 [STORAGE-CDN](STORAGE-CDN.md)。
- 公网入口由主站香港 `156.238.244.78` 的 `/etc/caddy/sites/storage-cdn-edge.caddy` 反代到 Garage 机 `103.240.197.216`，保留 Host、S3 签名、CORS、Range、MIME 与缓存；`cdn` 的 A 记录回滚值是 `103.240.197.216`。
- 模板里的密钥字段一律留空：S3 Access/Secret 在目标机 `/etc/s3manager.env`（0600），Garage 的 rpc/admin/metrics 三个 token 在 `/etc/garage.toml`，控制台 basic-auth 哈希由 systemd 变量 `S3MANAGER_ADMIN_HASH` 提供。仓库里出现真实值就是泄漏。改 Caddyfile 先 `caddy validate` 再 `reload`，改 garage.toml 才 `restart garage`。

## 发布和回滚验收

检查 `/healthz`（server 与 web 各一次）、入口域名与深链接（`/`、`/join-us`、`/admin`、`/console/...` 分别进官网与管理端）、`github.yangtzeu.work` 的 301（仅正式环境）、`/api/*` 与 `/forum/*` 是否正确反代（`/forum` 308 到相对地址 `/forum/`，直接打开 `/forum/users` 返回 200、不跳转，#140）、缺失资产 404、真实 OAuth/Cookie、验证码、权限、邀请结果、服务重启后的数据保留。HTML/资产/后端必须来自同一镜像 tag：用 `docker inspect` 的镜像 digest 与 `<栈根>/.env.<environment>` 的 `IMAGE_TAG` 交叉核对，web 容器内置的 `/release.json`（`no-store`）可作为发布身份的第二证据。数据库有新增字段时，回滚旧镜像前确认兼容，不以重置数据卷代替回滚。

部署工作流在部署成功后自动运行 `smoke`（`node scripts/parity.mjs smoke --origin <站点> --env <环境>`），按 `deploy/parity/smoke.json` 核对关键地址，含内部赛事官网 `/c/oss-challenge-2026-1/`；正式 tag 部署还会与预发布做 `compare`。烟测失败时这次运行变红，已切换的栈不会被它回滚：先按上文「回滚」切回上一个镜像，再查清差异；数据缺口用服务自带的函数补，不手写对正式库的 UPDATE（[RELEASE-PARITY](../conventions/RELEASE-PARITY.md) 第四节）。

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

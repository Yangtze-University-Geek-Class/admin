# GitLab CE 运维与部署合同

> `deploy/gitlab/` 的来源、安装映射、OIDC 与头像边界、私有备份及恢复验收门禁；源码纳管不代表重新部署或统一登录恢复。

状态：`current` · 更新：2026-10-30 · 适用：既有 GitLab 旁路服务的源码维护与获批恢复。依据：[GitHub admin#270](https://github.com/Yangtze-University-Geek-Class/admin/issues/270)（Arch 预部署与运维源码纳管）；历史身份事项分别为 [GitLab geek/admin#270](https://git.yangtzeu.work/geek/admin/-/issues/270)（统一登录）、[GitLab geek/admin#271](https://git.yangtzeu.work/geek/admin/-/issues/271)（资料头像同步）、[GitLab geek/admin#272](https://git.yangtzeu.work/geek/admin/-/issues/272)（提交邮箱同步）。


## 架构拓扑与运行网络

源码声明的链路（#335 搬家后）：公网 `https://yangtzeu.work/gitlab` → 香港 Caddy 正式站点块的 `/gitlab` 处理器（TLS 终止，不剥前缀）→ `hk-tunnel.service` 的 `ssh -w` 三层点对点隧道（`10.66.0.1` ↔ `10.66.0.2`）→ Arch `10.66.0.2:8929` → GitLab 容器 HTTP 80（`external_url` 带 `/gitlab`）。旧主机 `git.yangtzeu.work` 只做 301，跳到新地址的同一路径（带查询串）；搬家前它直接反代到同一个 Arch 端口。线上搬没搬以 `gitlab-cutover` 的 `path-status` 为准：2026-10-30 核对时 `https://yangtzeu.work/gitlab/users/sign_in` 回的还是官网页面，旧主机仍在反代。隧道实现依据原始迁移调查，不由 Compose 文件推断。

- [docker-compose.yml](../../deploy/gitlab/docker-compose.yml) 是模板（#335）：[production-path.py](../../deploy/gitlab/production-path.py) 用 `deploy/env/.env.production` 的 `GITLAB_URL`、`GITLAB_HTTP_BIND`、`GITLAB_STACK_ROOT`、子网与网关渲染，只发布 `<GITLAB_HTTP_BIND>:80`（正式 `10.66.0.2:8929`）和 `127.0.0.1:<同端口>:80`，不发布容器 SSH；成员通过 HTTPS/PAT 推拉。镜像行仍是字面值（`preview.py` 与 `restore-drill.sh` 照读）。模板不写 `hostname`：改成主站主机名时 Docker 会把它写进容器的 `/etc/hosts`，签发者 `<PUBLIC_ORIGIN>/oidc` 就会解析回容器自己。
- [gitlab-compose.service](../../deploy/gitlab/gitlab-compose.service) 等待 `tun0` 的 `10.66.0.2` 后执行 Docker Compose；它不是应用平台两套栈的部署入口。
- 容器内 Nginx/Rails 的代理信任地址为 `10.66.0.1`、`10.66.0.2`、`127.0.0.1` 和 Docker 网关 `GITLAB_DOCKER_GATEWAY`（正式 `172.31.29.1`）；真实 IP、防伪造头及 DNS/TLS 仍需目标链路取证。
- GitLab 是既有旁路服务，不加入 `yzgc-production` / `yzgc-preview`，不因本任务重启、reconfigure、改签发者或启停同步。本轮没有读取运行配置或探测线上健康。

## 源码纳管与运行安装映射

唯一维护入口是仓库 `deploy/gitlab/`。本轮将其中 28 个普通文件逐一与只读来源 `/Users/crosery/work_file/geek_gitlab/<同相对路径>` 比对：28 个 SHA-256 与大小一致，缺失 0、不一致 0；未改动导入文件。外部 `README.md` 的安装表和恢复说明已读取；`PLAN.md`、`BRIEF-backup.md` 是历史方案，不覆盖本合同。三份来源说明未导入，28 项内没有 `.git`、运行数据库、备份包、环境文件或私钥。

| 仓库源码（`deploy/gitlab/` 下） | 获批安装时的目标 / 调用关系 |
|---|---|
| `docker-compose.yml` | Arch `/srv/gitlab/docker-compose.yml`，#335 起由 `production-path.py` 从模板渲染（容器日志 json-file 轮转，`max-size: "10m"`、`max-file: "3"`，和两套站点栈一样）；由 `gitlab-compose.service` 引用 |
| `gitlab-compose.service` | Arch `/etc/systemd/system/`；依赖既有 Docker、隧道服务 |
| `settings.sh` | Arch `/srv/gitlab/settings.sh`；用 `bash` 显式执行，写数据库应用设置，不随源码纳管自动执行 |
| `backup.sh`、`restore-drill.sh`、仓库 `deploy/remote/garage-archive.mjs` | Arch `/srv/gitlab/`；前者由备份 service 调用，后者由获批操作者调用，共享归档器由两者调用 |
| `gitlab-backup.service`、`gitlab-backup.timer` | Arch `/etc/systemd/system/`；timer → service → `/srv/gitlab/backup.sh` |
| `gitlab-oidc.rb`、`gitlab-ui.rb` | 审核后合入 Arch `/srv/gitlab/config/gitlab.rb`，不是独立 Ruby 程序；不得反复追加或覆盖整份已有配置。回调和两条头像地址读 `/etc/gitlab/yzgc-gitlab-url`（Arch `/srv/gitlab/config/yzgc-gitlab-url`，一行，等于 `GITLAB_URL`，#335）；搬家时 `production-path.py` 只改 `gitlab.rb` 里这三行，每行必须恰好出现一次 |
| `migrate-oidc-subjects.mjs`（#309 新增，不属于 28 项导入基线） | 不安装到宿主：改接签发者时 `docker cp` 进两个 server 容器的 `/tmp/` 临时运行，用完删除；缺省只演算，`--apply` 才写正式库的 `oauth_subjects`（见上节第 3 步） |
| `gitlab.caddy` | #335 起是旧主机只做 301 的物料：`install-host.sh --target edge` 装到香港 `/usr/local/share/yzgc-edge/gitlab-legacy.caddy`，接收器 `production-apply` 核对它只把旧主机跳到正式 `/gitlab` 后放进 `/etc/caddy/sites/gitlab.caddy`；原来的默认头像规则搬进正式站点块的 `/gitlab` 处理器（`deploy/remote/edge-gitlab.py`），搬家前这里反代到 `10.66.0.2:8929` |
| `production-path.py`、`move-path.sh`（#335 新增，不属于 28 项导入基线） | 不安装到宿主：`gitlab-cutover` 每次把本次提交分发到 Arch 临时目录，`cutover.sh *-production-path` 调前者；后者在 runner 上串起 Arch、香港两半和公网核对 |
| `ui/logo.png`、`group-avatar.png`、`favicon-32.png`、`project-*.png`（4 张） | 外观、组织和项目头像上传输入；没有自动上传脚本 |
| `ui/nano-avatars/20261025/avatar-*.png`（8 张）与 `manifest.json` | 香港 `/var/lib/caddy/gitlab-avatars/20261025/`；Arch `/srv/gitlab/config/nano-avatars/20261025/` 的恢复副本只有实际安装后才会进入配置备份 |
| `ui/nano-avatars/20261025/preview.png` | 离线预览，不是站点运行依赖 |
| `ui/cut-logo.py` | 离线图像处理，显式输入/输出路径，依赖 NumPy/Pillow；不需要为使用现有 PNG 重跑 |

本地已核对 service 的脚本/Compose 引用、timer 的 service 引用与 Caddy 的 8 张图均有对应源码。运行时 `/etc/gitlab-backup/env`、`/srv/gitlab/config/{gitlab-secrets.json,yzgc-oidc-secret}`、`hk-tunnel.service` 不在 28 项内；未读取或声称它们已就绪。没有总安装器，也没有由本任务到服务重启的自动调用链。

### 来源与许可门禁

来源目录未提供 `LICENSE` / `COPYING`，本仓也没有可替这些资产授予许可的根许可证。原说明将 4 张项目图标归为 Remix 线性图标，但未附版本和许可文本；头像 manifest 记录生成模型、人设参考及原图哈希，不等于完整的授权证明。保留原字节与来源台账，不补造许可证。公开分发前由所有者核实徽标、人设参考、生成图及 Remix 图标的使用/再分发权，并保留适用声明；当前仅证明来源一致，未证明许可齐全。

## 物料清单与 SHA-256 校验和

2026-10-26 本地逐文件核对结果。下列 SHA-256 同时适用于导入文件及上述来源目录的同相对路径；这是导入基线，不是线上安装清单或运行数据的校验和。

| 相对路径 (`deploy/gitlab/`) | 大小 | SHA-256 校验和 |
|---|---|---|
| `backup.sh` | 7,749 B | `74b4f357a8d09547de5caf332918792dd9fc4bbd0bc3911fff1f351bbb2b0e2d` |
| `docker-compose.yml` | 2,103 B | `849ad0a292ae17d00ffeb7619a7b599c915d9c5017734ef7cd2b7e4addbc2189` |
| `gitlab-backup.service` | 296 B | `b097e2467d8b5718d8e92a020df0d976018bbe69d6e15ee7e6bdcdfd0a731d6f` |
| `gitlab-backup.timer` | 193 B | `d524d35c27a384a06b30e0b8fd61696766e5cef1ae8f69009f44e2d976a2c39c` |
| `gitlab-compose.service` | 699 B | `568289608539ed2bb77b24935d0da8851c6c7384009c03aefdc69533d0247e64` |
| `gitlab-oidc.rb` | 1,923 B | `7cef7549ca9ea456e5f07b9d0cb5c25b2e1d6670a880ef3a939ebcaf499d3262` |
| `gitlab-ui.rb` | 587 B | `e12e9d77ef6a2215babef2cc0086fb5a5a6a370346320b81e41ac5bd9450a277` |
| `gitlab.caddy` | 1,250 B | `aa577a62c2911a1178ec1712a058ea91b1f21cb00f9fc5e8f1fd5c43df8cb5a8` |
| `restore-drill.sh` | 10,443 B | `fba9106323f447d392cb3a699fff813e65a070f429ba85870408f40ce1378212` |
| `settings.sh` | 806 B | `5afec360e0fd78eab549421e982b594020450e54bfcea75ca45a699ca7c39baa` |
| `ui/cut-logo.py` | 832 B | `dc860c2e41bb9800c283ec902533d92142f69518d5e450d91504748a594519e6` |
| `ui/favicon-32.png` | 3,218 B | `67eb4261585ae33b8b2cb60233593b207c1e0794dcb816c077bd0a8c2a5adb0d` |
| `ui/group-avatar.png` | 79,328 B | `8d6096e2fa9664faca22b555f2a3cfb9b5b0c5e8c0ceb21d200de8757204213b` |
| `ui/logo.png` | 79,328 B | `8d6096e2fa9664faca22b555f2a3cfb9b5b0c5e8c0ceb21d200de8757204213b` |
| `ui/nano-avatars/20261025/avatar-01.png` | 56,551 B | `8aff73c1920d726d6ad0faaca55289ce23e020ce08766458b19351ce33f20332` |
| `ui/nano-avatars/20261025/avatar-02.png` | 55,624 B | `e225b98f39ea41e922c274e247e910fd5fb8d8179580cd75687383aa18fd38a6` |
| `ui/nano-avatars/20261025/avatar-03.png` | 56,391 B | `3d3a3372404e8684993d25ec275d674b7b203bd985a9d1147d2313e41616657c` |
| `ui/nano-avatars/20261025/avatar-04.png` | 55,942 B | `fdb175b768200559ba18e968a73b6e442ba3b453b0c2e8b71a20cd31e5d5036d` |
| `ui/nano-avatars/20261025/avatar-05.png` | 60,339 B | `31fc3afca8969d15622bed6236f09b8776da1fd2179635d86d30d01908decba1` |
| `ui/nano-avatars/20261025/avatar-06.png` | 67,217 B | `46a8ebb3218a7cb877d078bf108ae1cd83a4cb9af73a3063d0856464c33fcc63` |
| `ui/nano-avatars/20261025/avatar-07.png` | 64,467 B | `6dc329a2c57118cfb7d98918c872bbcbb2f1ef415e7f89d16b5f40350ea19006` |
| `ui/nano-avatars/20261025/avatar-08.png` | 62,834 B | `a57f4cfc5998139dbc14f38e3ca25ede42b071ad489cf5aba07ab1b10de02e2b` |
| `ui/nano-avatars/20261025/manifest.json` | 6,672 B | `14658688ba1abe03545a5867c6eb61974e9553e7bdd99a5a10bb4fbd4f3a1409` |
| `ui/nano-avatars/20261025/preview.png` | 499,659 B | `a98888a4f2033c587003e3b14bac7a4136f70da528e11dc34e5125619f33e684` |
| `ui/project-github-line.png` | 4,706 B | `1351398881600754cbf834c772af7d089d18d9982357ff38677c1ba06cf464b8` |
| `ui/project-global-line.png` | 5,543 B | `d6b53f1e0c0621a5561f6ac27017cce41df0ce65e1fd23af85362536e7356f0b` |
| `ui/project-robot-2-line.png` | 3,714 B | `2b85cf053e08ddb1eecf4d279e984303ad405f8bcdbdd074590bae26141cb743` |
| `ui/project-terminal-box-line.png` | 3,077 B | `8439c9b6d2fda4c6e7f04708124ec07c7f35baa566e80350577308994a1bdaac` |

---

## 容器配置与资源基线

Compose 固定 `gitlab/gitlab-ce@sha256:bb79dc86267c557fd11e7feb0cd9dd506dd02e991ecdd6cae11ca7d7e5d36fc3`；交接记录对应 CE 19.5.1，本轮没有运行镜像核实版本。限额为内存 `10g`、CPU `6`、共享内存 `256m`，Puma 2 worker、Sidekiq 并发 10、关闭 Prometheus/registry/usage ping。源码注释的常驻内存目标不是实测容量结论。

恢复必须使用备份产生时**同版本、同 CE 版本类型**的镜像；不能把当前 Compose 的摘要、`latest` 或可启动当作兼容证明。镜像升级与 GitLab 运行变更另行审批，不随应用平台迁移顺带执行。

## 独立预发布实例（#308）

所有者于2026-10-29明确接受已有预发布域名 `/gitlab/` 的 Beta 部署风险；现有 `gitlab` 容器、`/srv/gitlab` 和全部旧账号/仓库保留为正式（入口原为 `git.yangtzeu.work`，#335 起改为正式入口的 `/gitlab`，见下一节）。官方依据：[Linux package relative URL](https://docs.gitlab.com/omnibus/settings/configuration/#configure-a-relative-url-for-gitlab)。不新增子域名、不改DNS、不升级镜像，不复制正式业务数据。

| 项目 | 正式 | 独立预发布 |
|---|---|---|
| 入口 | `https://yangtzeu.work/gitlab`（#335；旧主机 `git.yangtzeu.work` 只做 301） | `https://prev.yangtzeu.work/gitlab` |
| 容器/数据根 | `gitlab` / `/srv/gitlab`，保持现有 | `gitlab-preview` / `/srv/gitlab-preview` |
| 隧道绑定/子网 | `10.66.0.2:8929` / `172.31.29.0/24` | `10.66.0.2:8930` / `172.31.30.0/24` |
| OIDC 客户端/sector | `gitlab` / `git.yangtzeu.work`（钉住，搬家后不变） | `gitlab_preview` / `prev.yangtzeu.work` |
| 备份角色/桶 | `gitlab-backup` / `geek-backup` | `gitlab-preview-backup` / `geek-preview-private` |

- 编排来源为 `preview-compose.yml`，仅从 canonical preview 模板渲染已校验的非密字段；`preview.py plan|apply|verify --env-file <明确路径>` 不读取正式数据。真正安装还要 `apply --apply`。同镜像摘要、6GiB/3CPU限额、全新目录与网络；未知已有目录、符号链接、实例挂载或配置漂移拒绝。只用本机已存在镜像，不构建、不拉取。启动失败只停止本轮新实例，保留数据；健康后关闭注册，初始化不打开SSO。
- 受保护 `gitlab-cutover` 增加 `preview-status`、`install-preview`、`verify-preview`；安装成功后经 `install-host.sh --target gitlab-preview` 安装备份/恢复脚本、归档器与独立 systemd 单元。单元只编排Docker，不运行宿主业务进程。备份凭据未配时不启用定时器，不能称备份已完成。
- 香港入口使用 `edge-gitlab.py` 固定动作接收器，`edge-status`、`edge-apply`、`edge-verify`、`edge-rollback` 均经同一 production 审批。仅改预发布站点块：精确匹配 `/gitlab` 与 `/gitlab/*`，不剥前缀，上传上限2GiB，保留GitLab自身CSP、WebSocket和既有真实IP处理；预发布动作不碰正式块与相邻路径（正式块的 `/gitlab` 由 #335 的 `production-*` 动作管理，两者改同一份文件时互相更新对方的收据与备份）。备份、候选validate、全配置validate、原子替换、reload及失败恢复均保留；配置漂移拒绝重放与回滚。
- 首次通道安装由所有者明确批准的管理员步骤执行 `install-host.sh apply --target edge --source <仓库的 deploy/remote> --edge-env-file <canonical preview模板> --edge-production-env-file <canonical 正式模板> --edge-public-key-stdin`（#335 起两份模板都要给，物料多一份 `../gitlab/gitlab.caddy`；已装过的再跑一次可以不带公钥参数）；只接一把专用公钥，`restrict` 加固定command，旧授权行逐字保全，不静默轮换。私钥只存 `production` 环境的 `GITLAB_EDGE_SSH_KEY`。后续受限密钥不能上传代码、改目标或执行shell。
- 2026-10-29已实测：专用SSH `plan` 成功，`id` 被拒；临时私钥已删除，Caddy未reload。真实Caddy `adapt --validate` 对候选配置通过且正式块逐字未变；这不等于新GitLab已部署或SSO已验收。
- `backup.sh --environment preview` 与 `restore-drill.sh --environment preview --run <日期/run>` 只使用预发布目录、容器、锁和 `GITLAB_PREVIEW_BACKUP_S3_*`，凭据文件为 `/etc/gitlab-preview-backup/env`。默认production行为保持；两个桶中的相同 `gitlab/<日期>/<run>/` 前缀互不相见，预发布prune不读取或删除正式备份。恢复仍要求明确run、完整摘要、固定同版本CE和断网演练容器。预发布备份05:30，正式03:30，均为北京时间。
- **切换前置仍未完成**：旧主体完整认领、旧写者排空、正式issuer改接、新预发布API令牌/客户端/绑定与应用版本交付，必须完成后才能启用新实例SSO。不能把新URL配给旧管理员令牌，也不能把旧 `gitlab_accounts` 数字ID当新实例ID。两个缺失正式身份的补建选择工具超时不构成人工授权；不因此补建账号或授予资格。


## 搬到正式入口的 /gitlab（#335）

所有者 2026-10-30 在会话中要求正式 GitLab 和预发布一样放在本环境入口的 `/gitlab` 下，仓库里不再用子域名；10:52 批准按 P0 走热修复窗口（`deploy/hotfix/windows.json` 的 #335，绑定 `v0.1.1`，到 2026-11-06 10:52）。实例、容器名、数据目录、镜像、网络、账号和仓库都不变，变的只有对外地址。操作手册（停机、逐步核对、公告草稿）在交接目录的 `GITLAB-PATH-CUTOVER.md`。

- 地址只有一个来源：`deploy/env/.env.production` 的 `GITLAB_URL=https://yangtzeu.work/gitlab`，`deployment-environment.mjs` 要求它等于 `<PUBLIC_ORIGIN>/gitlab`。`GITLAB_OIDC_SECTOR=git.yangtzeu.work` 是 `gitlab` 客户端钉住的 pairwise sector 标识，不是在用的地址：成员的 `sub` 按它分区，搬家后不变，GitLab 上的 `openid_connect` 绑定和 GitLab 用户 ID 都不用动。
- 先发 server，再搬家：`deploy-hotfix`（`HOTFIX_ISSUE=335`，沿用 `v0.1.1`）把认得 sector 钉住的 server 和新的 `GITLAB_URL` 一起发到正式。`*-production-path` 改回调之前先用 `client show --client-id gitlab` 确认正式 server 认得 sector 钉住（输出带 `sector_id` 字段），旧版本不认得这条命令，`cutover.sh` 拒绝，什么都不改；`path-status` 会写明正式库「认得 sector 钉住」还是要先发版本。从发布到搬家完成之间，官网的代码仓库链接会跳到还没接上的 `/gitlab`（回的是官网页面），同步与贡献收集调 GitLab API 也会失败（失败只记 error，不撤分），这段时间要尽量短。
- 只改正式库：GitLab 已经信任正式签发者（2026-10-30 11:20 核对过登录跳转到 `https://yangtzeu.work/oidc/auth`），`cutover.sh` 要求 `gitlab.rb` 里的签发者是正式的，只给正式库的 `gitlab` 客户端加减回调，不碰预发布库。因此搬家之后不能直接 `rollback-issuer` 退回预发布签发者，要先 `rollback-production-path`。
- 新旧回调可以同时在：oidc-provider 9.12.2 对回调跨两个主机的 pairwise 客户端要求 `sector_identifier_uri`，我们的客户端元数据一直带钉住的 sector，并关掉了去取这个地址（`tests/server/oidc.test.ts` 用安装的 oidc-provider 核对过：不带就拒绝加载，带上并关掉校验就能加载）。所以过渡期不用原子替换回调，也不因此多停机。
- 香港接收器先升级：所有者批准的管理员步骤按上一节的 `install-host.sh apply --target edge …` 重跑（带两份模板），再 `install-host.sh verify --target edge`。
- `gitlab-cutover` 的三个步骤（production 审批，不勾 apply 只读或演算）：
  1. `path-status`：Arch 报当前地址、目标地址、是否已搬、上次搬家前的地址、正式库 `gitlab` 客户端的 sector 与回调、有没有搬家前的账号基线；香港 `production-plan` 报两份文件会不会变。
  2. `move-production-path`：不勾 apply 演算两半。勾 apply 时 `move-path.sh` 依次做：
     - Arch `move-production-path --apply`：`gitlab-backup.service` 一致性备份和 `yzgc-backup@production`；记下账号基线 `/srv/gitlab/path-move/accounts.json`（按账号 id 抽样 50 个成员在 `gitlab` 客户端 sector 下的 `sub` 摘要、GitLab 账号数与最大账号 id，只有计数、摘要和本库账号 id）；给正式库的 `gitlab` 客户端加新回调，旧回调留着；`production-path.py` 写地址文件、改 `gitlab.rb` 三行、按模板写 Compose（模板带 json-file 日志轮转，取值和两套站点栈一样 `max-size: "10m"`、`max-file: "3"`，这次重建一起生效），`docker compose up -d --no-build --pull never` 重建（数据卷、镜像、网络不变），在容器里等 `/gitlab/-/health`。重建失败就恢复原文件、按原地址重建等健康，撤回新回调。
     - 香港 `production-apply`：正式站点块加 `/gitlab` 处理器，旧主机文件换成 301；候选与全配置 validate 后 reload，失败恢复原文件。
     - runner 上的公网核对：新地址登录页 200；旧地址 `…/geek/admin.git/info/refs?service=git-upload-pack` 301 到新地址的同一路径（git 只在第一次请求跟随跳转，之后的推拉直接打新地址）；旧子域名的 DNS 已撤（2026-10-30 起不再解析）时 curl 解析不到主机，记「旧地址：解析不到（子域名已撤）」并算通过，解析得到时仍必须 301；登录页的统一登录跳到签发者 `/oidc/auth` 并带新回调，签发者对这个回调回 302 或 303。
     - Arch `check-production-path`（只读）：同一批成员按 `gitlab` 客户端现在的 sector 重算 `sub` 摘要，必须和基线一样；搬家后 GitLab 新增的账号（id 比基线最大的大）只能是正式库映射着的成员号（同步给新成员建的），多出一个不是的，就是有成员登录时 GitLab 没认出原来的号。
     - 全部通过后 Arch `finish-production-path --apply`：去掉旧回调，再做一次 GitLab 备份。
     香港切换、公网核对或账号核对失败时两半都恢复（香港切换失败时接收器已自己恢复，只恢复 Arch），然后报失败；收尾失败时搬家已经完成，重跑 `move-production-path` 会再备份一次（不覆盖基线），然后接着收尾。
  3. `rollback-production-path`：勾 apply 时香港先恢复，Arch 再补回旧回调、恢复原 Compose 与 `gitlab.rb` 并重建、去掉新回调；全程要求正式 server 仍认得 sector 钉住。回调改完后不能直接退回旧镜像：旧版本按第一个回调的主机算 sector，回调里有新主机时成员的 `sub` 会变（见 [数据模型](../services/server/data-model.md)）。要退 server 镜像，先跑完 `rollback-production-path`，回调只剩旧主机之后再退。
- 搬完再跑 `verify-accounts`：逐人核对绑定、原 GitLab ID 与组权限不变；有账号基线时再核对一次抽样 `sub` 摘要和没有多出不是成员号的 GitLab 账号，任何一项对不上就失败，按手册整批 `rollback-production-path`。
- 停机从容器重建开始，到 GitLab 健康、香港 reload 完成为止（Omnibus 启动加 reconfigure，通常几分钟）；两次备份在停机前后，不计入停机，但整个 job 可能要几十分钟，超时 120 分钟。
- 输出只有步骤、HTTP 状态、计数和公开的 GitLab 账号 id，不打印令牌、cookie、跳转参数或 sub。测试见 `tests/tooling/gitlab-cutover.test.ts`、`gitlab-preview.test.ts`、`gitlab-move-path.test.ts`、`install-host.test.ts` 与 `tests/server/oidc.test.ts`；都是假 docker、假 curl、临时根或内存库，真实 Caddy 解析、真实 GitLab 重建、真实 `gitlab-rails` 计数和真人统一登录没有验过。

## 极客班统一登录（OIDC）契约

身份实现及服务验收以 [Server OIDC 合同](../services/server/oidc.md)、[安全模型](../architecture/SECURITY.md#对外授权与-gitlab-账号同步270) 为准；导入的 [gitlab-oidc.rb](../../deploy/gitlab/gitlab-oidc.rb) 仅保存 GitLab 侧片段：client id `gitlab`、`uid_field: sub`、PKCE、回调 `<GITLAB_URL>/users/auth/openid_connect/callback`，地址读 `/etc/gitlab/yzgc-gitlab-url`（#335）。签发者和 secret 都不写在片段里（#309）：`File.read('/etc/gitlab/yzgc-oidc-issuer')` 读一行 `<PUBLIC_ORIGIN>/oidc`，`File.read('/etc/gitlab/yzgc-oidc-secret')` 读 secret，两者都在宿主配置挂载内（Arch `/srv/gitlab/config/`）。GitLab 信任哪个环境，就在 `yzgc-oidc-issuer` 里写哪个环境的 `PUBLIC_ORIGIN`（`deploy/env/.env.production|.env.preview`）；仓库里不存在任何环境的签发者域名，`scripts/check-env-isolation.mjs` 在 `pnpm check` 里核对这一点。

- `users.id` 是内部账号 ID，不是给 GitLab 的主体标识；下游 `sub` 按客户端钉住的 sector（正式 `git.yangtzeu.work`，搬家后不变，见 [oidc](../services/server/oidc.md#客户端与密钥)）生成 32 字节随机值，持久化于 `oauth_subjects`，不能从账号 ID 重新计算。GitLab `openid_connect` 的 `extern_uid` 必须沿用该值。
- 迁移保全 `oauth_clients`、GitLab sector 的 `oauth_subjects`、`gitlab_accounts` 和原 `ENCRYPTION_KEY`；跨库内部 ID 可不同，须按不可变身份及认领证明对账，不按邮箱/昵称自动合号或直接照抄内部 ID。
- 改接必须是单写者：旧预发布排空停写 → 保全原 sector/sub、client 与账号关联 → 正式唯一写者对账并核验 → 改 GitLab issuer/client secret。不能只写 env 或 app_state 就声称旧进程停写；运行进程缓存设置，须替换并核对健康。
- 已完成的前置（2026-10-28）：正式 `OIDC_JWKS`、`GITLAB_API_TOKEN` 写进 GitHub 环境 `production`，由 hotfix 部署渲染进正式 env；正式库登记了 `gitlab` 客户端，明文 secret 只在 Arch `/srv/gitlab/config/yzgc-oidc-secret.production`（0600）。GitLab 现在读的 `yzgc-oidc-secret` 仍是预发布的，改接之前不动它。
- 以下路径统一由 [gitlab-cutover.yml](../../.github/workflows/gitlab-cutover.yml) 在 `main` 执行，保留 production 审批、哨兵与部署开关；默认演算，`apply` 才写，不另发 rc、不升号、不改镜像或 DNS：
  1. `status` 核对正式 discovery/client/secret 文件存在；`sync-status` 使用只读库与无网络一次性容器报告持久配置、有效直接成员及绑定计数，不播种资料或启动循环。`scope=persisted-configuration` 不冒充旧进程内存模式。
  2. `migrate-subjects` 先演算。只认稳定 provider+provider_uid，保留已有 sub；冲突、目标库对不上或源账号无不可变身份均整批拒绝且非零退出；只有显式 `--provision-unmatched` 才按 GitHub UID 最小补建（与 server 同口径：成员看有效的 `level.member`，管理员看有效的站长称号，已弃用的 `org_role`、`org_state` 不参与；校友、过期、停用或没有 GitHub 身份的不补建，随「对不上」写明原因；cutover.sh 的 `--apply` 已带；sub 已属于别人时不建号；`account.js` 在一个事务里建号，失败不留半个账号；建出来的账号若因别的条目整批被拒而没写入 sub，会保留下来，重跑时直接复用）。只报告计数与 provider uid，不打印 sub。手工兜底：把 [migrate-oidc-subjects.mjs](../../deploy/gitlab/migrate-oidc-subjects.mjs) `docker cp` 进两个 server 容器的 `/tmp/`，预发布容器 `export --sector <GitLab 主机名>`，正式容器 `import` 先演算看过「可迁、冲突、对不上」三个数再 `--apply`。
  2a. 正式同步已经开过时，先 `stop-production-sync --apply`（同 3 的备份、双锁、排空与健康门，把正式持久模式和运行 env 改 off），再 `repair-duplicates`。它处理改接前正式同步已经开过留下的重复号（2026-10-29 15:43–16:18 正式同步给已有 GitLab 号的 6 名成员又建了 `_yz` 号，主体迁移因此报「目标库该账号已有不同的 sub」）。先演算：从预发布导出 sector 主体，用正式容器网络、只读库逐人核对——原号按预发布 sub 唯一找到、是受管普通成员、正式库没有别的账号映射它；重复号是正式库这一行映射的号，只绑着正式 sub（或上次修到一半已解绑），GitLab 上 `last_sign_in_at` 与 `current_sign_in_at` 都为空。任一条不满足、或同一正式账号/重复号/原号出现两次，整批拒绝、非零退出、不写。`--apply` 要求正式持久模式与运行 env 都是 off（同步循环按 account_id 写回头像、邮箱、权限缓存，会和改映射撞车），取正式部署锁并先跑正式一致性备份，再逐人在 GitLab 解绑重复号的 `openid_connect` 身份并封禁（不删除），之后在一个事务里把正式库这个账号的 sub 换成预发布的、`gitlab_accounts` 改映射原号并清掉权限、头像、邮箱的同步缓存，下一轮同步按正式资料重新对齐原号；中途失败重跑从剩下的步骤接着做。输出只有计数、provider uid 和 GitLab 数字 ID（实现与测试：[sync-control.mjs](../../deploy/gitlab/sync-control.mjs) 的 `repairDuplicates`，`tests/tooling/gitlab-sync-control.test.ts`）。
  3. `stop-preview-sync --apply` 先确认身份能完整对账（这一步的演算带 `--provision-unmatched`：写入时能按 GitHub UID 最小补建的成员单独计为「可最小补建」，不算对不上；否则缺号成员要等预发布停写才能补建，两步互相卡住。切签发者和开正式写者之前的演算不带，仍按对不上拒绝），再执行本环境一致性备份及隔离恢复门；取双栈部署锁，正常排空旧进程（强杀不算通过），用同步模块的持久设置写口改 off，原子更新本环境 canonical env，以原镜像重启。必须有新 StartedAt、运行 env=off、持久有效配置=off 和健康门证据。
     同步设置写入或重启失败时，先停失败实例，再恢复原有效模式与本环境 env 备份并复检健康；尚未写设置的排空失败只重启原实例。恢复成功仍返回失败，不把重试恢复写成切换成功；恢复失败明确报告，不能继续切另一写者。全程禁止拉取或构建镜像。
  4. `migrate-subjects --apply` 只在上述预发布 off 后新增主体记录；已有值不覆盖。正式账号或资格缺失交由本人注册/所有者核对，不按邮箱、名字合号，不复制预发布业务用户，也不自动授予资格。
  5. `enable-production-sync` 要求预发布运行 env 和持久模式均 off、四项主体计数清零、旧成员在正式仍具有有效资格及既有 GitLab ID 不变；`--apply` 经同样备份、锁、排空和健康门开启正式。服务按原入口立即启动一轮对账，并保留正常周期。
  6. `verify-accounts` 使用正式容器网络和只读库，逐成员核对 active 非管理员/服务账号、唯一 `openid_connect` 绑定的原 sub、原 GitLab ID 与 geek 组 Developer 30 / Owner 50；HTTP 未知或缺绑定不得算通过。报告不含 sub、邮箱、令牌或内部 account_id。
  7. `switch-issuer` 在前述核验、正式 discovery/client/secret 和严格迁移演算均满足后，备份配置并原子替换签发者文件与正式 secret，执行 reconfigure。核对未登录访问 `/users/sign_in` 的跳转目标是正式 origin 的 `/oidc/auth`；成员真实登录及原 GitLab ID 另验，不以脚本配置通过代替登录。
  回滚签发者用 `rollback-issuer` 恢复备份；同步写者回退仍须先停止当前写者，确认没有双写，再恢复旧源，不能只回写 app_state 或删除主体来覆盖新状态。业务用户、仓库与上线后的写入不删除；迁移写入的行用脚本打印的 `DELETE` 逆向清理。
- 原生运维工具从 server 包解析 SQLite 依赖；本机使用当前 worktree 的依赖，`/ops` 挂载或 `/tmp` 分发时使用运行镜像 `/app/app/server`，不遍历 pnpm 内部存储、不替换原生模块 ABI。
- root 的应急地址为 `/users/sign_in?auto_sign_in=false`；普通成员的密码限制、组权限和资料传播须另验，不能从配置片段推断已生效。默认头像优先级也不等于核心同步永不改用户头像。
- 交接中的真实 SSO 成员资格故障仍未在本任务修复或复测；“同步无错误”、资产纳管、语法通过均不证明有效成员/往届/站长可登录。历史资料头像同步不是 NANO 头像池任务，不混用两平台同号 issue 或在 GitLab MR 写关闭 GitHub issue 的裸编号。

## 界面定制、NANO 头像池与自定义头像保护

[gitlab-ui.rb](../../deploy/gitlab/gitlab-ui.rb) 关闭 packages/dependency proxy，并把自定义 Libravatar 地址设为 `<GITLAB_URL>/nano-avatar/20261025/%{hash}?s=%{size}`（读 `yzgc-gitlab-url`，#335 前是旧主机根路径）。[manifest](../../deploy/gitlab/ui/nano-avatars/20261025/manifest.json) 的 8 张 PNG 为 4 张 Q 版、4 张正常比例，均为 512×512；本地已核对各图的大小、尺寸及 SHA-256。它们与论坛 `app/server/assets/stickers/manifest.json` 的 56 张表情是两组独立资产。

- Caddy 仅对 64 位小写十六进制散列取首位映射：`0/8→01`、`1/9→02`、`2/a→03`、`3/b→04`、`4/c→05`、`5/d→06`、`6/e→07`、`7/f→08`；`s` 参数不参与选图。
- 两条规则在正式站点块的 `/gitlab` 处理器里，路径带 `/gitlab` 前缀（#335）；`/gitlab/assets/no_avatar[-<hash>].png` 回退至 `avatar-01.png`；已有上传头像路径不在这些匹配器内。**自定义头像优先**，不得为重放默认头像迁移而清除用户头像或改同步来源标记。
- 既有 8 张图已在前序任务交付；本任务不重新生成、上传或部署，不重做历史默认图清理。`manifest` 中的 `visual_review` 与原安装说明的截图/线上结果属于前序记录，不是本轮验收。
- 完整恢复还需香港图片和 Caddy 规则；备份脚本不直接打包香港文件，只有事先存入 Arch `config/nano-avatars/` 的副本才随配置归档保存。外观/组织/项目已上传图片随 GitLab 数据备份；未上传的源码图片仍从本仓取得。

## 私有备份与恢复门禁

### 备份合同

[backup.sh](../../deploy/gitlab/backup.sh) 使用 `flock`、`umask 077`，由 [timer](../../deploy/gitlab/gitlab-backup.timer) 每日 `03:30 Asia/Shanghai` 调用。它先 `gitlab-backup create SKIP=registry STRATEGY=copy CRON=1`，再分别 GPG 公钥加密数据 tar 与配置 tar，写 `SHA256SUMS`，最后调用共享 [garage-archive.mjs](../../deploy/remote/garage-archive.mjs) 归档。适配器固定 `https://cdn.yangtzeu.work`、region `garage`、path-style 和私有桶 `geek-backup`；上传前完整 GET 已有对象，逐字相同才复用，不同则失败，新增后再次完整 GET 核对 SHA-256。它没有覆盖、移动、sync 或 purge 接口。`put-tree` 把 `SHA256SUMS` 放在最后上传，远端出现清单就说明同一 run 的数据对象都已写入并读回核验过。香港机空间有限，上传核验之后脚本接着执行 `prune-runs --keep-dates 3 --apply`：从新到旧逐个 run 读 `SHA256SUMS`，与对象列表逐项相等才算一个有效备份日期，保留最近 3 个有效日期，更早的整日 run 先删清单再删对象；保留窗口内清单对不上的旧 run 不计入日期、也不会被删，结果的 `unverifiedRuns` 会列出它们。有效日期不足 3 个、最新一份带清单的 run 对不上、出现晚于北京今天的日期（疑似主机时钟错误）、目录结构出现意外对象时一律零删除。缺省（不带 `--apply`）只列出会删什么。所有者 2026-10-27 16:08 指示备份要记得清理快照，这条保留策略据此生效。

- GitLab 路径为 `gitlab/YYYY-MM-DD/<run>/`。恢复必须点名 run：`restore-drill.sh --run YYYY-MM-DD/<run>` 只核对被点名的这一个 run，不带 `--run` 时只列候选并退出 1，**不再**自动挑“字典序最新”的那一个；`--day YYYY-MM-DD` 只是列候选时的过滤器。旧 `gitlab/YYYY-MM-DD/` 单层目录不再由新备份写入，也不会出现在候选列表里（适配器只认 `<日期>/<run>/SHA256SUMS`）；要恢复这类历史对象只能先把它们重新归档成 `<日期>/<run>/` 形状，不能靠改选择器绕过。
- 凭据只从 `/etc/gitlab-backup/env` 或进程环境的 `GITLAB_BACKUP_S3_ACCESS_KEY_ID`、`GITLAB_BACKUP_S3_SECRET_ACCESS_KEY` 注入；endpoint、region、桶和 path-style 不接受环境改写。凭据不得进入配置归档、日志、argv 或源码。
- 配置候选恰为 `/srv/gitlab/config`、Compose、backup/restore 两脚本及三个 systemd unit，只归档存在项；不是缺任一项都会失败。`config` 必须含原 `gitlab-secrets.json` 与 `yzgc-oidc-secret`，另含头像恢复副本才能宣称可恢复这些内容。
- `/etc/gitlab-backup/env`、七牛 AK/SK、GPG 私钥/口令不在配置归档内；GitLab 配置包本身**包含运行 secret**，仅允许加密保存，绝不能导入源码仓库。明文配置 tar 在加密后及退出 trap 中删除；这不是磁盘块级安全擦除。
- 换源不授权清理：新脚本不删除旧明文 tar、本地加密运行或旧供应商的任何对象；唯一的删除是 `geek-backup` 里 `gitlab/` 与 `platform/<环境>/` 下早于最近 3 个备份日期的整日 run。旧供应商材料与既有恢复证据保留；旧材料的清理和迁移另行批准。平台的一键系统备份见 [BACKUP](BACKUP.md)，不能用 GitLab 备份代替。
- Garage 不提供服务端 WORM、对象锁或 `If-None-Match` 原子创建。客户端完整 GET/比对/写后读回与单次脚本锁只能防止本程序主动覆盖，不能隔离跨进程竞态或恶意写入者；桶级最小权限、串行写入与外部独占网关须在真实环境另验。

### 平台快照异机归档

`platform-maintenance.sh backup` 仍只在 `platform-backup@.service` 的 `RestrictAddressFamilies=AF_UNIX` 沙箱里生成本地快照、SHA-256 和收据，不联网。收据新增固定目标 `geek-backup/platform/<production|preview>/<北京日期>/<run>/`。独立 [platform-archive.sh](../../deploy/remote/platform-archive.sh) 在获批的可联网、最小权限执行环境中重新核对本地三份 SHA，打成明文 tar 后用 `PLATFORM_BACKUP_GPG_RECIPIENT` 加密，仅把 `.gpg` 与其 `SHA256SUMS` 交给共享归档器；明文 tar 退出时删除，本地原快照不删除。上传核验之后同样按 3 个备份日期清理本环境在 `geek-backup` 里的旧 run，不碰另一个环境。正式与预发布分别只接受 `PLATFORM_PRODUCTION_BACKUP_S3_*`、`PLATFORM_PREVIEW_BACKUP_S3_*`，不能共用默认凭据或从业务 `.env` 读取。

发布生成的 0600 私有内容索引由同一归档器写入 `geek-production-private` 或 `geek-preview-private` 的 `indexes/content/<40位commit>/sha256.json`，凭据分别是 `PRODUCTION_PRIVATE_INDEX_S3_*` 与 `PREVIEW_PRIVATE_INDEX_S3_*`。索引 schema、权限、键和完整读回均在上传前后核对；同键不同字节失败，runner 临时文件未归档时不得称持久追溯完成。

### 恢复前必须满足

1. 先取得恢复目标、日期、资源预算与清理范围的明确批准；本任务不执行脚本、不读取真实备份。新目标与旧实例隔离，不覆盖活机目录，不重启旁路 GitLab。
2. `restore-drill.sh` 先用共享适配器逐对象完整 GET 到全新目录，再以 `sha256sum -c SHA256SUMS` 核对两份加密归档；之后才解密。核对原 GitLab 备份版本/CE 类型及配置归档里的 Compose 镜像与数据备份对应。脚本实际读取的是**当前** `/srv/gitlab/docker-compose.yml`，并且只接受逐字等于 `gitlab/gitlab-ce@sha256:bb79dc86…d36fc3`（脚本顶部常量）的镜像串：`:latest`、别的 tag 或未复核的 digest 在任何下载、解密、启动之前就失败；要换版本先改脚本常量走审查。失败或中断时，本轮创建的 `gitlab-drill` 容器与整个演练目录（含明文 `config/gitlab-secrets.json`）由同一个 EXIT 清理路径删除，原始加密归档保留，退出码不变。
3. 单独保全并验证可用的 GPG 私钥和口令；GitLab 的原 `gitlab-secrets.json`、OIDC client secret 和平台原 `ENCRYPTION_KEY` 分别用于各自系统，不能互相替代。秘密只走受控文件/凭据注入，不放 argv、日志、聊天或源码。
4. 普通带凭据命令使用 `crosery-ct cred exec --cred NAME=ENV -- 命令` 注入，不引导查看密钥。恢复脚本优先读取 fd 3，再用 `gpg --passphrase-fd 3`；保留的环境变量 fallback 不应成为推荐路径。若工具先注入 `GPG_PASSPHRASE`，应在获批目标上的短生命周期 shell 中转 fd 并取消导出，禁止 `set -x`：

   ```bash
   crosery-ct cred exec --cred GITLAB_BACKUP_GPG_PASSPHRASE=GPG_PASSPHRASE -- \
     bash -c 'exec 3<<<"$GPG_PASSPHRASE"; unset GPG_PASSPHRASE; exec /srv/gitlab/restore-drill.sh "$@"' bash --run YYYY-MM-DD/<run>
   ```

   此命令只适用于已安装凭据工具、已获恢复授权的目标。`--run` 必须是核实过的备份 run（`YYYY-MM-DD/<run>`）：不传时脚本只列出可用 run 并以退出码 1 结束，不再自动挑“最新”那一个；`--day` 只用来过滤列出的候选。`--cleanup` 是**本轮恢复完成后的清理开关**，不是事后再运行一次脚本的清理命令。
5. [restore-drill.sh](../../deploy/gitlab/restore-drill.sh) 的下载阶段会联网；`garage-archive.mjs` 须和两脚本一起安装到 `/srv/gitlab/`。仅 `gitlab-drill` 容器 `--network none`、不发布端口，限额 `6g/4CPU`。它只从配置包复制 `gitlab-secrets.json`，**不恢复或验证 OIDC、香港头像、Caddy**；末尾还读取既有 `gitlab` 对象计数，因此也不是可直接在空机运行的完整灾备安装器。
6. `gitlab:check SANITIZE=true`、`gitlab:doctor:secrets` 与备份时点的数据核对均须留真实结果；live/drill 计数不同只提示，并不失败，不能据退出码证明业务一致。默认保留的恢复数据库、配置和日志仍是敏感运行数据，不进入源码；旧数据、演练目录的删除另按批准范围执行。
7. 完整灾备验收另含原 OIDC 配置/secret、sector/sub/账号关联、真实登录、仓库读取及自定义头像保护，并独立验证香港图片、Caddy 语法/TLS/代理。未满足这些条件只记录隔离数据恢复结果，不能写“SSO 恢复”或“线上 healthy”。

## 本地验收与交付边界

以下从仓库根执行；表中 28 项仍是原始导入基线。#295 明确豁免 `backup.sh`、`restore-drill.sh` 的目标字节一致性，#335 又有意改了 `docker-compose.yml`、`gitlab-oidc.rb`、`gitlab-ui.rb`、`gitlab.caddy`（换地址）：来源必须继续符合表中摘要，这 6 项仓库目标必须已偏离旧摘要，其余 22 项应逐字一致。`deploy/gitlab/` 里后来新增的文件不在基线里，脚本只核对基线这 28 项。2026-10-30 核对：`ui/nano-avatars/20261025/manifest.json` 自 2026-10-27 的提交起已偏离基线（不是 #335 改的），脚本会在它上面停下，要先核对那次改动再决定怎么登记；来源目录的 `gitlab-oidc.rb` 也已和基线不同，没有核对原因。共享 Garage 工具在 `deploy/remote/`，不混入这份来源清单。不读取来源目录中的环境文件、密钥或备份数据。

```bash
python3 - /Users/crosery/work_file/geek_gitlab <<'PY'
from pathlib import Path
import hashlib
import re
import sys

source = Path(sys.argv[1])
target = Path("deploy/gitlab")
contract = Path("docs/ops/GITLAB.md").read_text()
rows = re.findall(r"^\| `([^`]+)` \| [\d,]+ B \| `([0-9a-f]{64})` \|$", contract, re.M)
files = sorted(p.relative_to(target).as_posix() for p in target.rglob("*") if p.is_file())
assert len(rows) == 28 and set(path for path, _ in rows) <= set(files)
changed = {"backup.sh", "restore-drill.sh", "docker-compose.yml", "gitlab-oidc.rb", "gitlab-ui.rb", "gitlab.caddy"}
for path, expected in rows:
    source_file = source / path
    target_file = target / path
    assert not source_file.is_symlink() and source_file.is_file(), source_file
    assert not target_file.is_symlink() and target_file.is_file(), target_file
    assert hashlib.sha256(source_file.read_bytes()).hexdigest() == expected, source_file
    actual = hashlib.sha256(target_file.read_bytes()).hexdigest()
    if path in changed:
        assert actual != expected, f"{path} unexpectedly reverted to its import baseline"
        print(f"MIGRATED {path} {actual}")
    else:
        assert actual == expected, target_file
        print(f"MATCH {path} {expected}")
print("22/22 untouched imports matched; 6/6 intentionally changed (2 backup adapters, 4 for the path move)")
PY

bash -n deploy/gitlab/backup.sh &&
bash -n deploy/gitlab/restore-drill.sh &&
bash -n deploy/gitlab/settings.sh &&
python3 -c 'from pathlib import Path; p=Path("deploy/gitlab/ui/cut-logo.py"); compile(p.read_bytes(), str(p), "exec"); print("Python syntax OK")' &&
ruby -c deploy/gitlab/gitlab-oidc.rb &&
ruby -c deploy/gitlab/gitlab-ui.rb
```

2026-10-26 的 28/28 来源哈希是导入基线；#295 后 `backup.sh`、`restore-drill.sh` 已因 Garage 迁移有意偏离该来源，新增共享归档器与平台归档步骤，不得再用导入基线证明这两个脚本当前字节。当前定向回归使用合成文件、假 rclone/GPG 覆盖完整上传下载、哈希冲突、日期选择和凭据隔离；语法与单测不执行真实安装、备份、恢复、联网或图像处理。

**未验证**：目标文件权限/存在性、当前 GitLab 版本与健康、Caddy/Compose 的目标环境解析、私有桶策略及实际对象、加解密/恢复、真实 SSO、图片的线上呈现和正式验收；许可材料缺口未解除。本轮没有提交、推送、发布、SSH、网络写入、外发或服务启停。文档索引及本次 PR 的全局门禁由协调者集成，不能把这些局部证据写为全套验证通过。

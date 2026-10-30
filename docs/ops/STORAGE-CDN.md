# 香港对象存储与静态 CDN 运维合同

> 一台守在香港的 1 vCPU / 1 GiB 小机器：Garage 提供 S3 兼容对象存储，Caddy 做网关与自动 TLS，S3 Manager 提供可视控制台，Policy Bridge 把控制台里的「设为公共桶」翻译成 Garage 的 website 开关。本文件是这套系统的**唯一现行合同**，配置模板在 [`deploy/storage-cdn/`](../../deploy/storage-cdn/)。

状态：`current` · 更新：2026-10-28 · 适用：香港 CDN 机（DogYun `hk.st.s`）。与业务代码无关，不被任何应用服务 import。

## 它是什么、不是什么

| 是 | 不是 |
|---|---|
| 一个 S3 兼容的**对象存储**（Garage），带公共桶直链与私有桶预签名外链 | 带边缘节点的多地 CDN：只有香港这一台，掉线时没有第二份可回源 |
| 站点静态资源的公共出口：官网、控制台、论坛带哈希的 JS、CSS、字体、图片和论坛内置表情包放在 `geek-public/static/site/`（见 [CICD](CICD.md#静态资源-cdn146)、[CDN](CDN.md)） | 七牛旧 CDN 域名（个人域名）的运行依赖：新构建不再引用它，旧对象只留给 rc.25 及更早版本回滚 |
| 平台与 GitLab 备份的归档目的地（私有桶 `geek-backup`） | Arch 本机备份的替代：单副本，本机副本继续保留 |
| 图床/开放文档的公共桶（`geek-public`、`cdn`） | 一个多节点集群：`replication_factor = 1`，单机单副本 |

## 主机与端口

| 项 | 值 |
|---|---|
| 公网 IPv4 / IPv6 | `103.240.197.216` / `2401:2660:0601:5f58:2d4b:cd50:e101:e905` |
| 域名 | `cdn.yangtzeu.work`（Caddy 自动签发并续期 Let's Encrypt） |
| 规格 | 1 vCPU / 1 GiB / 250 GiB HDD，1000 Mbps，BBR |
| SSH | 22，仅公钥（`PasswordAuthentication no`），fail2ban 守护 |
| 防火墙 | UFW 默认拒绝入站，只开 22/80/443；3900–3903、8080、8081 一律不对外 |

| 服务 | 技术栈 | 监听 | systemd 单元 | 配置 |
|---|---|---|---|---|
| 网关 | Caddy v2.8.4 | `:80`、`:443` | `caddy.service` | `/etc/caddy/Caddyfile` ← [模板](../../deploy/storage-cdn/Caddyfile) |
| 对象存储 | Garage v2.4.1 | `127.0.0.1:3900`（S3）、`3901`（RPC）、`3902`（静态出口）、`3903`（admin） | `garage.service` | `/etc/garage.toml` ← [模板](../../deploy/storage-cdn/garage.toml) |
| 控制台 | S3 Manager v0.12 | `127.0.0.1:8080` | `s3manager.service` | `/etc/s3manager.env` ← [模板](../../deploy/storage-cdn/s3manager.env) |
| 策略桥接 | S3 Policy Bridge | `127.0.0.1:8081` | `s3-policy-bridge.service` | `/opt/s3-policy-bridge/bridge.py` |

数据目录：`/var/lib/garage/{meta,data}`（meta 是 SQLite + WAL）；控制台运行目录 `/var/lib/stowage`。

Caddy 的路由顺序是合同的一部分：S3 签名请求 → 桶策略桥接 → 控制台静态 → 公共对象直链（`/{bucket}/{key}` 改写成 `/{key}` 并补 `Host: {bucket}.cdn.yangtzeu.work` 交 3902）→ 兜底控制台。

## 主站边缘反代（#305）

公网 `cdn.yangtzeu.work` 的 A 记录指向主站香港入口 `156.238.244.78`，由主站 `/etc/caddy/sites/storage-cdn-edge.caddy`（模板 [`deploy/storage-cdn/edge.caddy`](../../deploy/storage-cdn/edge.caddy)）反代到 Garage 机 `103.240.197.216` 的 HTTPS 入口。主站与 Garage 之间固定 `tls_server_name cdn.yangtzeu.work` 并保留原始 Host、路径、查询串和 Authorization；S3 SigV4 仍在 Garage 的 Caddy 上验证。反代不改写 CORS、Range、MIME 或缓存头，不做第二份缓存。

这条链路解决直连 Garage 公网入口的丢包与长 RTT，不把单机存储变成多节点 CDN。安装与切换顺序：先把模板放到主站非 import 目录并完成 `caddy validate`，再安装到 `/etc/caddy/sites/`、复核并 `systemctl reload caddy`；TLS 与公共对象通过后才把 `cdn` 的 A 记录从 `103.240.197.216` 改为 `156.238.244.78`。回滚只需把该 A 记录改回 `103.240.197.216`，主站反代文件不影响其它站点，不 restart 相邻服务。

## 存储桶

| 桶 | 权限 | 用途 |
|---|---|---|
| `cdn` | 公共 | 默认公共直链桶 |
| `geek-public` | 公共 | 图床与开放文档 |
| `geek-production-private` | 私有 | 正式站私密资源（匿名 404） |
| `geek-preview-private` | 私有 | 预发布私密资源 |
| `geek-backup` | 私有 | 备份归档桶。写入方是归档器 `deploy/remote/garage-archive.mjs`：GitLab 经 `deploy/gitlab/backup.sh` 写 `gitlab/<日期>/<run>/`，平台经 `deploy/remote/platform-archive.sh` 写 `platform/<环境>/<日期>/<run>/`，各自只保留最近 3 个备份日期（[GITLAB](GITLAB.md)、[BACKUP](BACKUP.md)）；平台侧的一键系统备份仍走浏览器下载，不写这里 |

公共直链：`https://cdn.yangtzeu.work/{bucket}/{key}`。私有桶只能用控制台生成的带签名外链，过期即失效。

切换权限走控制台 **Bucket Policy**：Bridge 收到后执行 `garage bucket website --allow|--deny {bucket}`。命令行等价操作见下节；不要绕过 Bridge 直接改 Garage 内部状态。

## 凭据（本仓库不含任何真实值）

| 凭据 | 存放位置 | 说明 |
|---|---|---|
| S3 Access Key ID / Secret | 目标机 `/etc/s3manager.env`（0600）+ 所有者凭据库 | 仓库里这两个字段**必须为空** |
| Garage `rpc_secret` / `admin_token` / `metrics_token` | 目标机 `/etc/garage.toml` | 仓库模板里留空 |
| 控制台 basic-auth 口令哈希 | 目标机 systemd 环境变量 `S3MANAGER_ADMIN_HASH`（bcrypt） | Caddyfile 里写 `{$S3MANAGER_ADMIN_HASH}`；变量缺失时 Caddy 拒绝启动（失败关闭） |

轮换顺序：先在 Garage 生成新 key（`garage key new --name …`），把新值写进 `/etc/s3manager.env` 并 `systemctl restart s3manager`，确认控制台能列出桶，再停用旧 key（`garage key deny/delete`）。导入/导出凭据走本机凭据工具注入进程环境，不写文件、不进 shell 历史、不进日志；示例脚本 [`upload_demo.py`](../../deploy/storage-cdn/scripts/upload_demo.py) 只从 `S3_ACCESS_KEY_ID` / `S3_SECRET_KEY` 读。

## 仓库里没有这些东西

以下组件/配置只存在于目标机，本仓库没有源码或版本记录，改它们必须先自行取证、再人工复核；本节列出是为了让人知道**照这份合同并不能从头重建**：

| 不在仓库 | 位置 | 影响 |
|---|---|---|
| S3 Policy Bridge | `/opt/s3-policy-bridge/bridge.py`（无来源、无版本、无摘要） | 控制台「设为公共桶」能生效全靠它，改它无从评审 |
| 四个 systemd unit | `caddy.service`、`garage.service`、`s3manager.service`、`s3-policy-bridge.service` | 内存上限、EnvironmentFile（含 `S3MANAGER_ADMIN_HASH`）都写在这里 |
| 防火墙与封禁规则 | UFW、`/etc/fail2ban/jail.local` | 端口暴露面与暴力破解防护 |
| 系统调优 | `/etc/sysctl.d/99-custom.conf`、`/etc/fstab`、swap | 1 GiB 内存下的稳定性 |

要收进来按普通 task 走：只读导出 → 脱敏 → 加回归，不在本分支顺手改。

## 日常运维

```bash
systemctl status caddy garage s3manager s3-policy-bridge --no-pager
garage status                      # 节点与磁盘
garage bucket list                 # 桶清单
garage bucket info geek-backup     # 单桶容量/对象数/是否开启静态访问
garage key list                    # 访问密钥
garage bucket website --allow|--deny <bucket>   # 手动开关公共直链
journalctl -u garage -n 50 -f      # 存储日志
ufw status verbose; fail2ban-client status sshd
```

改 Caddyfile 的顺序固定：先 `caddy validate --config /etc/caddy/Caddyfile`，通过再 `systemctl reload caddy`；**不要 restart**，避免中断进行中的上传。

- `validate` 通过不等于口令可用：`S3MANAGER_ADMIN_HASH` 缺失或为空时 Caddy 会拒绝启动（失败关闭），但填一个**不是 bcrypt 的字符串**照样能过校验，上线后控制台永远 401。部署前自检 `[[ $S3MANAGER_ADMIN_HASH =~ ^\$2[aby]\$ ]] || exit 1`。
- **handle 块按文件顺序生效**（`caddy adapt` 实测：把公共对象块前移，路由顺序真的变了）。所以「S3 签名 → 桶策略 → 控制台 → 公共对象 → 兜底」这个顺序是合同的一部分，`tests/tooling/storage-cdn-config.test.ts` 里有断言守着，不要为了可读性调换。
- 改 `garage.toml`（不是 Caddyfile）必须 `systemctl restart garage`：Garage 不热加载，改之前先用副本 `garage server --config` 试跑一遍。

容量与内存：`garage` 的 cgroup 上限 250M、`caddy` 120M、`s3manager` 80M、bridge 50M；常驻约 309 MB，另配 2.5 GB swap。不要把大文件反复拖进控制台预览（会走内存缓冲）。

## Arch 镜像与备份核验

Garage 是单节点单副本（`replication_factor = 1`），这台机器没有自己的备份。内容的第二份放在 Arch：[`deploy/remote/cdn-mirror.sh`](../../deploy/remote/cdn-mirror.sh) 每天 02:20（Asia/Shanghai）用一把只对五个桶有读权限的 Garage 密钥 `backup-reader`，经 `https://cdn.yangtzeu.work` 把 `geek-public`、`geek-production-private`、`geek-preview-private`、`geek-backup`、`cdn` 单向拉到 `/srv/cdn-mirror/current/<桶>/`。

| 项 | 做法 |
|---|---|
| 密钥 | 目标机 `/etc/cdn-mirror/env`（0600，`CDN_MIRROR_ACCESS_KEY_ID`、`CDN_MIRROR_SECRET_ACCESS_KEY`）；只读，Arch 上拿到它改不了 Garage |
| 保留 | 被覆盖或在源端删除的对象进 `/srv/cdn-mirror/trash/<UTC 时间>/<桶>/`，保留 `CDN_MIRROR_KEEP_DAYS`（默认 14）天，过期整次运行目录才删；镜像本体不删 |
| 重试与路径 | 每个 rclone 调用带 5 次重试、10 次底层重试和连接/读写超时。Arch 直连香港存储机往返约 230 ms、重传严重（首次实测 10 分钟只拉下约 70 MB），所以服务单元用 `BindReadOnlyPaths=-/etc/cdn-mirror/hosts:/etc/hosts` 给镜像单独一份 hosts，把 `cdn.yangtzeu.work` 指到香港边缘；同样的 383 MiB 改走边缘后约 1 分钟拉下 100 MB。这份 hosts 只在该服务里生效，不改全局，也不改 DNS；文件不存在就按正常解析。DNS 改到边缘后（P-0008）可以删掉它 |
| 核验 | 同步后逐桶比对源桶与镜像的对象数、字节数，再 `rclone check` 逐对象；不一致先再同步一次，仍不一致记失败。源桶读成空而镜像非空时拒绝同步 |
| 结果 | `/srv/cdn-mirror/status.json`：`ok`、`error`、`last_success_at`、各桶对象数/字节数/`verified` |
| 新鲜度 | `cdn-mirror-watch.timer` 每小时跑 `cdn-mirror.sh watch`：最近一次失败、没有 status 或 `last_success_at` 超过 36 小时，写 `/srv/cdn-mirror/ALERT` 并让该 unit 失败（`systemctl --failed` 可见，journal 有 `cdn-mirror ALERT`）。目前没有向外推送的渠道 |
| 磁盘 | 可用空间低于 10 GiB 停止同步并记失败 |

安装不需要登录目标机：`deploy/remote/install-host.sh` 由三条部署工作流在栈部署成功后运行（`plan` / `apply` / `verify`，见 [RELEASE-PARITY](../conventions/RELEASE-PARITY.md) 第十节），把 `cdn-mirror.sh`、`cdn-mirror.hosts` 和 `deploy/remote/systemd/` 下的单元装到位、`daemon-reload`、有凭据时启用两个定时器，再核对一致；只做 `daemon-reload`，不重启任何服务。镜像凭据是 GitHub 环境（`production`、`preview`）的 secret `CDN_MIRROR_ACCESS_KEY_ID`、`CDN_MIRROR_SECRET_ACCESS_KEY`，由流水线经 stdin 写入 `/etc/cdn-mirror/env`。Garage 上的只读密钥只需要建一次（在 Garage 机上，需要管理员）：`garage key create backup-reader`，再对五个桶各执行 `garage bucket allow --read --key backup-reader <桶>`；生成的值只写进上面两个环境 secret。手动跑一次：`systemctl start cdn-mirror.service`（oneshot 会长时间处于 activating，看 `journalctl -u cdn-mirror` 与 `status.json`）。

首次同步发现过一个坑：网关会把文本响应压成 gzip，rclone 默认带 `Accept-Encoding: gzip` 下载并原样写盘，镜像里 436 个 css/js 变成了压缩包，只有逐对象核验报 `sizes differ` 才暴露。脚本现在设 `RCLONE_CONFIG_CDN_USE_ACCEPT_ENCODING_GZIP=false`，下载内容的 MD5 与对象 ETag 一致。

恢复到一个新的 Garage：先按「日常运维」里的命令重建桶（`garage bucket create`，公共桶 `garage bucket website --allow`）并为应用生成写密钥，再把镜像推回去：`rclone copy /srv/cdn-mirror/current/<桶> <远端>:<桶>`。恢复的是对象内容；桶别名、website 开关和密钥不在镜像里，按本文件的桶表重建。镜像只保证内容，不替代 Garage 本机元数据备份。

GitLab 与平台备份不走这里。Arch 上实际运行的 GitLab 备份是七牛版 `/srv/gitlab/backup.sh`（SHA-256 `74b4f357…`，每日 03:30，本机加密副本加七牛 `<备份桶>/gitlab/<日期>/`，保留最近 3 天）；仓库里的 [`deploy/gitlab/backup.sh`](../../deploy/gitlab/backup.sh) 是写 Garage `geek-backup` 的版本，目标机尚未安装，Garage 上也没有对应的写密钥。两者不能混着当“已备份”：七牛有 GitLab 备份，Garage 的 `geek-backup` 目前只有 3 个对象。

## 冷热分层（规划，未实施）

上面的 Arch 镜像只是单向拉取副本，不删除香港侧的任何数据。计划里“香港机只保留最近 30 天热数据（`rclone delete --min-age 30d`）”这一步仍**未实施**：一旦执行就是在删香港侧数据，需所有者单独批准，并先有镜像核验记录（`status.json` 里该桶 `verified: true` 且新鲜）。当前没有任何自动删除策略，桶只会增长。

## 明确不做

- 不在本仓库保存任何真实密钥、口令、basic-auth 哈希或私钥；发现泄漏先轮换再清理。
- 不在这台机器上做图片处理、转码或回源：站点静态资源由发布流水线按内容哈希上传到 `geek-public/static/site/`，这台机器只存和出。
- 不在这台机器上跑应用容器、数据库或 CI Runner（1 vCPU / 1 GiB 的余量全部留给存储与 TLS）。
- 不修改 `replication_factor`、不接第二个节点、不改 UFW 放行端口，除非有明确的容量与安全评审。
- 不删除既有桶与对象：删除只能在所有者批准、且有异地校验记录之后进行。

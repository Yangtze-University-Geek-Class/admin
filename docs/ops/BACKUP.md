# 一键系统备份与恢复

> 平台沿用 `yzgc-system-backup@1` 系统归档恢复到独立空卷；数据、配置、身份映射和外发隔离分别验收，不把 GitLab 备份或文件 hash 当完整迁移。

状态：`current` · 更新：2026-10-30 · 适用：平台业务导出、获批恢复与 Arch 全量保全；接口格式仍承接历史 GitLab geek/admin#282，不在本次重造归档协议。

## 这份备份里有什么

账号资料、头像、论坛的话题/回复/表情包/上传图片全部是 `data.db` 里的行或 BLOB 列（见 [server 合同](../services/server/README.md)的数据模型），没有独立的论坛库或上传目录；唯一落在数据库之外的是比赛官网的站点包文件（`<DB_PATH 同目录>/sites/`，#278）。所以一份备份只有两样东西，打进一个 `.tar.gz`：

- `data.db`：用 better-sqlite3 的在线备份 API（`db.backup()`）拍的一致快照，不用停服务；
- `sites/`：原样打包比赛官网的站点文件（没有发布过比赛官网时这部分是空的）。

归档首项 `manifest.json`（`format: yzgc-system-backup@1`）记录应用版本、镜像 tag、环境/时间、逐表行数及逐文件大小/SHA-256；`required_env` 只列字段名、不含值。线上镜像或迁移导出器可能给空名单，恢复工具再从同环境的仓库模板读取键名，不把空名单当“无需密钥”。

**排除的数据**（在快照里清空，不随备份搬走）：登录会话（`sessions`）、命令行设备授权（`device_grants`）、对外登录（OIDC）的临时授权与令牌（`oauth_grants`、`oidc_payloads`）、邮箱验证码（`email_challenges`）、各种限流与去重计数（`invite_attempts`、`application_limits`、`limit_events`、`forum_rate_events`）。这些都是几分钟到几天就失效的数据，搬到新环境本来就要重新登录或重新同意，留着没有迁移价值，反而带着加密会话令牌、验证码哈希这类不必要的敏感内容。完整名单与理由见 `app/server/src/lib/system-backup.ts` 的 `BACKUP_EXCLUDED_TABLES`。

**保留的数据**：账号、密码哈希、GitLab 映射 `gitlab_accounts`、客户端 `oauth_clients` 与持久 `oauth_subjects`，以及包括 `app_state` 在内的业务设置。保留 sub 是为了原账号/下游身份不断链；同时意味着恢复库可能携带 `gitlab_settings.mode=on`，**备份不自动清洗外发设置**。

**不包含环境密钥明文**：不打包 `.env`、`SESSION_SECRET`、`ENCRYPTION_KEY` 或证书私钥；数据库保留的客户端 secret/兑奖码密文仍需原 `ENCRYPTION_KEY` 解密。归档含账号、密码哈希及业务内容，本身仍是敏感数据，只在受控目录/通道保存，不放 Git、镜像、聊天或公开附件。

## 下载

控制台「备份」页（节点 `system.backup`，种子里只有站长的根通配 `*` 默认拿到，见 [server 合同](../services/server/README.md)「极客班控制台」）点「下载完整备份」，浏览器按 `GET /api/console/backup` 走普通下载。单账号 5 分钟一次的限流；接口会在操作记录里留一条 `system.backup.export`（只记文件数、表数和排除了哪些表，不记内容）。

## 恢复到新环境

获批后在新目标的空目录执行，不对活卷操作：

```bash
node --experimental-strip-types scripts/backup-restore.mjs --archive <已核验的备份.tar.gz> --target <新空数据目录>
```

- 工具不依赖 better-sqlite3 等三方包，但**不是单个 mjs 文件即可搬走**：它导入 `../app/server/src/lib/tar-stream.ts`。须保留下面相对布局，并使用支持 TypeScript 类型擦除的 Node；本地已验证 Node 22.23.2 加上述参数可读帮助，Arch 的 Node26 与核心 Node22 原生依赖仍隔离。

  ```text
  tools/scripts/backup-restore.mjs
  tools/app/server/src/lib/tar-stream.ts
  tools/deploy/env/.env.production
  tools/deploy/env/.env.preview
  tools/deploy/remote/verify-arch-replica.mjs
  tools/scripts/deployment-environment.mjs
  ```

  两份 env 只能是仓库的密钥留空模板，供 `required_env` 为空时列键名；不是复制到工具包里的真实运行 env。最后两个文件是副本只读核验器及其相对导入依赖，不能只拷核验器单文件；使用已验证的 Node 22.23.2 或 Node26 内置 `node:sqlite`，不混用 SQLite 原生依赖。
- 逐条写出文件时校验 manifest 的大小/sha256；不等、未知/缺失文件或非法路径即失败，但已写的部分保留，**不是事务性还原**。失败目录先保全/核对，不用 `--force` 在同一未知目录重试。
- CLI 支持 `--force` 覆盖已存在的同名文件，且不删除无关文件；本次迁移**不得使用**，新环境按独立空卷恢复。运行结果只打印环境、表/文件数及所需字段名，不能打印数据或秘密。
- 恢复文件的属主/权限须满足 server 的 UID/GID `1000:1000`，`DB_PATH=/data/data.db`，站点包位于同目录 `sites/`。文件校验后还要做 SQLite integrity/外键、逐表/文件计数、身份关联及关键业务检查。
- 首次服务启动会应用现有迁移，必须先完成下节的**有效 mode / 贡献收集 / 邮件 / 出站隔离**；在获批副本运行迁移两遍，证明第二遍不再改变数据，不能以“迁移脚本幂等”推断已验。回滚旧镜像前另验证迁后库兼容。

## 当前 Arch 全量保全

2026-10-26 的无损迁移没有使用会清空 sessions 的控制台导出器：先停止源 web/server/forum，取得完整命名卷和 schema/逐表内容/逐文件权限与摘要，分别恢复到 Arch 新空卷；启动前比对完全一致。原 sessions、OIDC 材料和加密密钥保留，应用镜像未升级。旧源应用停止后 Arch 成为唯一写入者。

- 全量恢复点在 Arch `/opt/yzgc/migration/arch-20261026/final-{production,preview}`；历史资料及 24 个镜像引用在同目录 `history/`，四个历史数据库 integrity_check 均通过。
- 实际日常维护入口是 `/opt/yzgc/tools/docker-backup.py` 与 `backup-helper.cjs`：同环境原镜像、只读源卷、断网 helper，SQLite 在线 backup 保留所有表，附属文件另核对；原配置单独留在 root 私有包中，不输出值。每份归档立即解包并校验全表和文件摘要。
- `yzgc-backup@production.timer` / `@preview.timer` 已启用，每天北京时间 04:00，随机延后不超过 10 分钟；`yzgc-health.timer` 每十分钟只检查项目六容器，不全局清理。
- 已把新机最新备份传回旧机全新隔离目录，用同版本原镜像断网恢复，两环境通过；没有覆盖旧卷、启动旧应用或把公网切回。
- 这是保留会话的基础设施全量备份，不是下文 `yzgc-system-backup@1` 的业务导出协议。现有 `platform-maintenance.sh` / `platform-backup@` 候选未安装；实机脚本源码与证据在主工作区 `.tools/handoff/2026-10-26-migration/`，尚未纳入发布 tag。

## 在预发布和正式之间搬迁

正式与预发布各自独立命名卷、网络、密钥和数据库；本次是**同环境跨主机搬迁**，不是 preview 整库覆盖 production。跨环境拷贝也须另有数据方案与批准，不能按下面步骤自动合并真实账号。

1. 当前 Arch 为唯一公共写入源；分别记录两环境发布身份、镜像 ID、归档 hash 与一致快照时点。控制台和 `export-stack-snapshot.mjs` 的业务导出会清短期授权表，不用于要求保留全部会话的同环境迁移。原快照与旧机资料只作恢复来源，不重新投入写入。
2. 完整传输及双方 hash 符合后才 load/restore。凌晨的镜像半包已由后续完整传输取代；最终接管使用上节的停写全卷归档，不使用清 sessions 的前序业务导出。一份小归档通过不代表整个环境完整。
3. 每环境用自己的新空卷、原密钥和账号映射；保全 `oauth_clients`、GitLab sector 的 `oauth_subjects`、`gitlab_accounts`，跨库 ID 不同须按不可变身份对账，不能用邮箱自动合号或重算 sub。
4. `prepare-arch-runtime.mjs` 仅准备 env，不改恢复库。`app_state(key='gitlab_settings').value.mode` 可覆盖 env off；真实入口会开同步/贡献收集及邮件循环。须先隔离出站，并独立证明 **effective mode=off**、贡献收集不外发/不计分、邮件空白名单且无队列外发；不得只看 env 回执启动。需改复制库设置时先获目标数据写入批准，不改原快照/旧源，不用任意线上 SQL 求通。详情见 [ENVIRONMENTS](ENVIRONMENTS.md#副本启动安全门禁)。
5. 数据、迁移两遍、业务与新代理链验收分别留证据。最终停写窗口再同步最后变化；切后新写入如何保全/回灌、旧版本兼容和观察窗口见 [DEPLOY](DEPLOY.md#最终切换与含新写入的回退)。没有持续同步方案不承诺零停机。

## 整机搬到新服务器

Arch 已承载两环境完整应用/数据，香港 Caddy 做公网边缘；不是重装 Arch 或只搬静态论坛。下表是后续搬迁的分类清单；本次实际完成路径见「当前 Arch 全量保全」，不要把业务导出当作保留会话的完整迁移：

| 要带走的 | 在旧机器的哪里 | 怎么到新机器 |
|---|---|---|
| 正式、预发布两套数据（账号、论坛、投递、比赛、表情、头像……） | 两个命名卷里的 `data.db` 和 `sites/` | 分别在两个环境的控制台「备份」页各下载一份，新机器上用 `scripts/backup-restore.mjs` 恢复到各自的空目录，再挂成新栈的数据卷。两个环境各恢复各的，不要混用 |
| 镜像 | 已发布 tag 的原运行镜像 / CI 原归档 | 迁移复用已导出的同环境镜像，核对完整 hash、RepoTags 和 Image ID 后 load；不为旧 tag 重新本机构建，不把 main HEAD 当运行版本 |
| Compose、部署与恢复工具 | 本仓对应已审物料 | 按相对布局传完整工具，不只拷一个 mjs；标准 deploy/rollback 保持环境独立 |
| 非密环境项 | 仓库候选模板与旧源实际配置分别取证 | Arch 目标/跳板/端口以模板为准；模板更新不会改旧源或已有 env 副本，不据此声明外发隔离 |
| 密钥（会话密钥、加密密钥、OAuth 客户端密钥、邮件凭据等） | 只在旧机器的 `.env.<environment>` 里 | 不进备份、不进仓库：由所有者从密钥保管处单独填到新机器的 `.env.<environment>`；`backup-restore.mjs` 打印的名单就是要填的项。`ENCRYPTION_KEY` 要和旧机器一致，否则库里加密存的下游应用密钥（GitLab 登录用的 `oauth_clients`）和兑奖码解不开 |
| 网关与 TLS | 旧源 nginx 策略、香港既有 Caddy | 从 nginx 策略派生 Caddy，公网文件先留非 import 目录，validate/激活另批；新边缘重新签证书，私钥不跨机搬 |
| DNS | 域名服务商 | 所有者在最终一致数据/新链路验收后操作；旧源保留观察窗口，不能先切再补证书 |
| 静态资源与 CLI | 原发布 web/forum/server 镜像及已发布 CDN 对象 | 原内容保全，检查引用/hash/缓存及 CLI `/cli/` 物料是否实际存在；不因为模板有入口就宣称已分发 |
| 宿主看护/每日备份 | 主工作区 `.tools/host-guard/geek-host-guard` 是旧机候选来源 | 禁止原样复制到 Arch timer；具体风险和非破坏性准入见下一节，平台异机加密备份尚未完成 |

GitLab 是 Arch 上的既有旁路服务，有自己的私有加密备份、GPG/版本/OIDC 恢复门禁，见 [GITLAB](GITLAB.md)。平台 system-backup 和 GitLab 备份是**两条独立验收链**，不能互相替代；本任务不重启 GitLab。

## 宿主看护与异机备份差距

已只读核对旧看护源码：`check` 会调用全局 Docker image/builder prune、`apt-get clean`、journal vacuum，`DRY_RUN=1` 不能阻止全部动作；`backup` 硬编码 `/mnt/data`，还打包 env 和证书私钥。这不是 Arch 的非破坏看护/平台系统归档实现，不得原样纳入日常 timer，也不在本轮执行或扩大 #267。

本 task 新增 `deploy/remote/platform-maintenance.sh`，替代旧脚本作为平台的非破坏入口：`status` 只采样本环境容器与宿主资源，不自动修复；`backup` 复用同目录 `export-stack-snapshot.mjs`，核对源容器/卷/完整镜像身份，以断网、只读源卷、受限资源的 helper 导出本合同归档。显式新目录或既有 `STACK_ROOT/backups` 派生的新时间戳目录均不覆盖旧产物；归档/manifest/收据及各自 SHA256 共六文件，目录700、文件600，不归档 env/证书，不上传、不自动删除或全局 prune。

获批安装布局为 `/opt/yzgc/tools/deploy/remote/{platform-maintenance.sh,export-stack-snapshot.mjs}`。示例：

```bash
bash /opt/yzgc/tools/deploy/remote/platform-maintenance.sh status \
  --environment preview --env-file /opt/yzgc/preview/.env.preview
bash /opt/yzgc/tools/deploy/remote/platform-maintenance.sh backup \
  --environment preview --env-file /opt/yzgc/preview/.env.preview
```

宿主依赖 Bash、Node≥22、本机 Docker default context；不新增第二份环境变量来源。默认 helper 为当前同环境 server；旧正式0.1.0缺备份模块时失败关闭，只有显式、经核对的 `--helper-image` 才可使用其它已有镜像作离线导出器，收据分别记录 source/helper ID，不 pull/build/load 或启业务入口。512MiB 内存、256MiB 临时空间是资源预算，不是大库容量承诺；失败保留现场。

`deploy/maintenance/platform-backup@.service` / `.timer` 是待安装的两环境实例模板，每日北京时间04:00、随机延后最多20分钟，只调用离线 Docker 导出器，不替代应用栈。本轮仅核验目标 `systemd-analyze calendar` 的日历表达式，未安装、启用或验证完整 unit。`status` 退出0仅表示采样完成，不代表全部健康。

平台异机备份写七牛私有备份桶，写入方式与留存见下一节「七牛私有备份桶」。真实备份写入前，先用合成数据验证加密上传、私有下载、解密和恢复。

## 七牛私有备份桶

写入方有三个：GitLab 备份、平台一键备份和部署前数据库快照。三者都经 [`deploy/remote/garage-archive.mjs`](../../deploy/remote/garage-archive.mjs) 上传，只读环境变量 `BACKUP_S3_*`。

- GitLab：[`deploy/gitlab/backup.sh`](../../deploy/gitlab/backup.sh)，每日 03:30，写 `gitlab/<日期>/<run>/`。恢复演练 [`deploy/gitlab/restore-drill.sh`](../../deploy/gitlab/restore-drill.sh) 读同一组变量。
- 平台：[`deploy/remote/platform-archive.sh`](../../deploy/remote/platform-archive.sh)，写 `platform/<环境>/<日期>/<run>/`。
- 部署前数据库快照：[`deploy/remote/deploy-stack.sh`](../../deploy/remote/deploy-stack.sh) 的第 4b 步，在 `compose up`（会执行迁移）之前运行，写 `database/<日期>/<run>/`。快照用 better-sqlite3 的在线备份在本次新镜像里做：容器断网、根文件系统只读，数据卷以读写挂载（WAL 需要），代码只以只读方式打开库。快照先 gzip 再 gpg 加密。目标机没有数据卷（首次部署）时跳过；任何一步失败都在启动新版本之前退出，旧版本不动。

配置（非密项已预填在 `deploy/env/.env.production` 与 `deploy/env/.env.preview`）：

- `BACKUP_S3_ENDPOINT=https://s3.cn-south-1.qiniucs.com`，`BACKUP_S3_REGION=cn-south-1`，path-style SigV4。
- `BACKUP_S3_PREFIX` 按环境区分：正式 `yzgc/production/backup/`，预发布 `yzgc/preview/backup/`。不能为空，否则备份会落到桶根。
- `BACKUP_S3_BUCKET`、`BACKUP_S3_ACCESS_KEY_ID`、`BACKUP_S3_SECRET_ACCESS_KEY`、`BACKUP_GPG_PUBLIC_KEY`（或 `BACKUP_GPG_RECIPIENT`）仓库里留空。它们由 GitHub 环境 secret 经部署流水线写入目标机的 `.env.<环境>`。桶名不写进仓库和文档。
- GPG 加密带 `--compress-algo ZIP`。收件人优先用 `BACKUP_GPG_PUBLIC_KEY`（base64 的 ASCII 公钥，写成 `--recipient-file` 加密，不需要目标机钥匙环）；只配了 `BACKUP_GPG_RECIPIENT` 时才查钥匙环。`deploy/remote/platform-archive.sh` 与 `deploy/gitlab/backup.sh` 的收件人规则相同。

留存（GFS）：每个日期（取最近 7 个有完整备份的日期）、每个 ISO 周（最近 4 周）、每个自然月（最近 3 个月）各保留最新的一份完整 run，三条取并集。删除只发生在本角色前缀下的整日 run，并且先核对保留下来的 run 的 manifest；核对不过则一个都不删。没有 manifest 的残缺 run 只在早于最早保留日期时删除。

```bash
node deploy/remote/garage-archive.mjs prune-runs --role gitlab-backup            # 缺省只列计数
node deploy/remote/garage-archive.mjs prune-runs --role gitlab-backup --apply    # 确认后才删除
```

角色名有 `gitlab-backup`、`gitlab-preview-backup`、`platform-preview-backup`、`platform-production-backup`、`database-backup`。输出只有模式、保留参数和计数（run 数、对象数、字节数），不打印对象名或内容。运行前要先导入同一环境的 `BACKUP_S3_*`。

迁移注意：目标机上的 `/etc/gitlab-backup/env` 与 `/etc/gitlab-preview-backup/env` 仍是旧名字 `GITLAB_BACKUP_S3_*`、`GITLAB_PREVIEW_BACKUP_S3_*`。新脚本只读 `BACKUP_S3_*`，切换前要按新名字写入。Garage 上的历史备份对象（`geek-backup`）不迁移、不删除。

## 已知限制

- 控制台导出仍是手动业务导出。Arch 另有已运行的保留会话全量备份 timer、非破坏健康检查及隔离恢复证据；七牛私有备份的脚本已在仓库里，但还没有在目标机安装并跑过真实备份，一次向旧机的恢复演练不等于持续异机备份。
- 下载要求 10 分钟内登录过（归档里有全部账号和密码哈希），不够新时页面先请人重新登录。
- 恢复脚本只验证文件完整性（sha256），不验证数据库内部的业务一致性；跨大版本迁移（表结构有不兼容变更）仍需人工核对，见 [DEPLOY](DEPLOY.md)「数据与备份」的一般原则。
- `app/forum`（Nuxt 前端）本身没有需要备份的运行数据，论坛的全部线上数据都在 `data.db` 里，见 [server 合同](../services/server/README.md)「数据所有权」。

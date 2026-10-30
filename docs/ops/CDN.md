# CDN 与对象存储合同

> #346：公开静态资源改回七牛（域名绑定到桶，上传走 path-style S3）；Garage 的公开桶封存，对象内容与配置保留。对象内容、发布来源和私有运维索引分别追溯。

状态：`current` · 更新：2026-10-30

## 桶与路径

上传端点（S3 兼容）为 `https://s3.cn-south-1.qiniucs.com`，region 为 `cn-south-1`，桶名来自 GitHub 环境变量 `STATIC_CDN_S3_BUCKET`（环境 static-cdn 的 vars；桶名带个人标识，不入库；不放 secret，否则 GitHub 会把含同一字串的 CDN 地址从 job 输出里打码丢掉），`forcePathStyle=true`，签名 URL 是 端点 / 桶 / 对象键。公开入口是 `https://cdn.crosery.com`：域名已绑定到该桶，公开地址就是 `origin` 加对象键，路径里没有桶名。这是目标合同；供应商可用性和桶权限是否生效以下面「验证与环境责任」的实测为准。

| 对象 | 桶内对象键 | 公开地址 |
|---|---|---|
| 站点静态资源：带哈希的构建资源、表情、使用说明截图、旧帖图片 | `yzgc/static/site/{assets,console-assets,forum/_nuxt,forum/guides,forum/stickers,forum/published}/` | `https://cdn.crosery.com/yzgc/static/site/…`，保持构建或源文件内容哈希文件名 |
| 宣传片：保持相对 HLS 主清单、子清单、初始化段、分片和海报关系 | `yzgc/static/promo/<版本与内容哈希>/`（当前 `v5-tone-e1419fc9331a`） | `https://cdn.crosery.com/yzgc/static/promo/v5-tone-e1419fc9331a/` |
| 邮件图片 | `yzgc/mail/v1/`，`MAIL_ASSET_BASE=https://cdn.crosery.com/yzgc/mail/v1/` | `https://cdn.crosery.com/yzgc/mail/v1/` |
| 公开发布清单 | `yzgc/indexes/releases/<production\|preview>/<完整提交>/manifest.json` | `https://cdn.crosery.com/yzgc/indexes/releases/…` |

项目对象都在桶的 `yzgc/` 命名空间下。上传器只写 `yzgc/static/site/` 与 `yzgc/indexes/releases/`，宣传片与邮件图片由人工按本表放入，不由上传器写。

私有桶不在这次迁移范围：`geek-production-private`、`geek-preview-private`（Garage 上的私有索引与业务对象预留）保持 #295 的合同和现有位置，本任务不移动、不新建私有对象。备份不再写 Garage：仓库里的备份脚本写七牛私有备份桶（#354，见 [BACKUP](BACKUP.md)），`geek-backup` 只保留已有对象。

**Garage 的公开桶已封存。** Garage 上的 `geek-public` 与 `cdn` 不再接收任何公开对象（构建参数与上传目的地已切到七牛），已有对象、桶配置与 Caddy 出口保留，不删除。备份写入已在仓库里改到七牛（#354，`BACKUP_S3_*`，见 [BACKUP](BACKUP.md)）。内容索引的私有桶写入，以及 `deploy/remote/cdn-mirror.sh` 的镜像，还指向 Garage，它们要等 #346 的后续步骤另行切换。旧 Garage 公开地址（`https://cdn.yangtzeu.work/geek-public/…`）只留给库里已有的旧帖内容，读取时改写到新前缀（见 [论坛服务](../services/forum/README.md)）。

七牛上的旧对象已经是 `yzgc/` 下的同名键（`yzgc/static/site/`、`yzgc/static/promo/`、`yzgc/mail/`），本任务不改它们。Garage 上的 `static/site/` 不迁移：发布流水线按内容哈希把对象补传到七牛，已存在则逐字比对，不覆盖。

## 用户文件（#352）

论坛上传的图片、账号头像和论坛头像在对象存储开启后写到七牛，不再存进库里。端点、区域、桶、前缀与公开地址都从环境来，代码里不写死。

| 对象 | 对象键（前缀之后） | 公开地址 |
|---|---|---|
| 论坛上传的图片 | `uploads/<sha256>.webp`，动图是 `.gif` | `<OBJECT_STORAGE_PUBLIC_BASE><OBJECT_STORAGE_PREFIX>uploads/<sha256>.<扩展名>` |
| 账号头像、论坛头像 | `avatars/<sha256>.webp` | `<OBJECT_STORAGE_PUBLIC_BASE><OBJECT_STORAGE_PREFIX>avatars/<sha256>.webp` |

- 前缀按环境分开：预发布 `yzgc/preview/`，正式 `yzgc/production/`，写在 env 模板里（`OBJECT_STORAGE_PREFIX`，`check:env-isolation` 把它列为按环境的键）。端点 `OBJECT_STORAGE_ENDPOINT` 与区域 `OBJECT_STORAGE_REGION` 和上传端点相同，公开地址 `OBJECT_STORAGE_PUBLIC_BASE` 是域名绑定到桶的入口，地址里没有桶名。
- 桶名是环境变量 `vars.OBJECT_STORAGE_BUCKET`（不放 secret，免得 GitHub 把含同一字串的地址打码），访问密钥是环境级 secrets `OBJECT_STORAGE_ACCESS_KEY_ID`、`OBJECT_STORAGE_SECRET_ACCESS_KEY`，三项要么都填、要么都留空。留空即关闭，文件照旧存在库里；只填一部分时部署渲染失败，服务启动也失败。
- 写入由 `app/server/src/lib/object-storage.ts` 完成：SigV4 path-style，只用 fetch 与 node:crypto。先 HEAD，已存在不再 PUT；写不进去时接口返回 503，不返回指向空对象的地址。
- 读取：库里还有字节的旧地址照常从库里读。库里没有字节的账号头像和论坛头像，`GET /api/identity/avatar/:file`、`GET /api/forum/avatars/:file` 返回 302 到公开地址。
- 回填：服务启动后台跑一次 `lib/object-storage-backfill.ts`，把库里的账号头像、论坛头像、论坛图片中对象存储没有的补传；日志只记数量，已存在的对象只做 HEAD。
- 竞赛官网的站点文件（`lib/competition-site-store.ts`）没有改，仍写数据卷。
- 回滚：关闭密钥后，新上传的图片回到写库。开启期间新传的头像只在对象存储里，关闭后它们的站内地址没有字节可读；在回滚前要保持开启，或先把这些对象回填成库里的字节。

## 公开发布清单与私有内容索引

公开来源索引：`yzgc/indexes/releases/<production|preview>/<完整40位小写commit>/manifest.json`。schema 固定为：

```json
{
  "schema_version": 1,
  "environment": "preview",
  "commit": "0000000000000000000000000000000000000000",
  "generated_at": "2026-10-26T17:21:00.000Z",
  "objects": [{
    "key": "yzgc/static/site/assets/app-12345678.js",
    "sha256": "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad",
    "bytes": 3,
    "content_type": "text/javascript",
    "source_path": "build/web/assets/app-12345678.js",
    "role": "portal-asset"
  }]
}
```

`generated_at` 取发布提交的提交时间，规范化为 UTC ISO 时间；不是每次重跑的当前时间，便于相同产物幂等比对。`role` 只认 `portal-asset`、`console-asset`、`forum-asset`、`guide-image`、`sticker`、`published-image`。来源只认构建相对路径或仓库内公开截图、表情、旧帖图片的相对路径。未知字段、重复键、错误摘要/类型/大小/来源、隐藏路径、私有业务路径一律拒绝。不得加入业务信息、绝对路径、签名 URL、环境配置或密钥。

内容哈希索引单独由 `--content-index` 生成：`{schema_version:1, hashes:{<sha256>:{bytes,keys:[]}}}`，不含发布提交和来源字段，写成权限 `0600` 的本地私有产物。父级发布链用共享 `deploy/remote/garage-archive.mjs put-file --role <preview|production>-content-index` 把它归档进对应环境私有桶的 `indexes/content/<commit>/sha256.json`；适配器校验 0600、schema 与完整 commit 键，已存在时完整 GET 逐字相同才复用，不同即失败，写后再完整读回。未归档不能称持久追溯已闭环。本公共上传器不接私有桶写权限、不上传它，不在公开桶另建“全量索引”。公开清单按环境/提交反查，私有内容索引按 SHA-256 反查，不能互相冒充。

清单在全部资产上传和公开校验通过后才写入；同一个发布键已存在时完整 GET 逐字比对，任何不同都失败，不更新旧清单。相同提交重新构建若产生不同 Nuxt build id 或哈希文件，必须使用原产物重跑，或通过新的提交发布，不能覆盖旧清单。

## 凭据与开关

凭据仅从进程环境读取，不接收命令行密钥、凭据文件或 BasicAuth：

| 变量 | 约定 |
|---|---|
| `STATIC_CDN_S3_ACCESS_KEY_ID` | CDN 发布凭据 ID；不进运行时镜像和业务 `.env`；名字不变，值由所有者在 GitHub 环境 secret 里设 |
| `STATIC_CDN_S3_SECRET_ACCESS_KEY` | 对应 secret；不得写日志或文件 |
| `STATIC_CDN_S3_ENDPOINT` | 可省略，固定为 `https://s3.cn-south-1.qiniucs.com`；其他值拒绝 |
| `STATIC_CDN_S3_REGION` | 可省略，只接受 `cn-south-1` |
| `STATIC_CDN_S3_BUCKET` | 必填，环境 static-cdn 的变量（vars），只核对桶名形状（小写字母、数字、连字符） |
| `STATIC_CDN_S3_FORCE_PATH_STYLE` | 可省略，只接受 `true` |

两项密钥都不设时 `decide` 保持同源；只设一项、非法目的地、配置旧 `STATIC_CDN_UPLOAD_TOKEN` 时失败。完整凭据下先读环境首页 CSP：未放行新 CDN 时仍按原约定同源构建。CSP 放行后对 S3 做签名探测（探测对象键不存在时 404 也算端点在响应），401/403、网络失败、超时均失败关闭，不自动回旧供应商。

私有归档凭据按用途和环境拆分：备份（GitLab、平台、部署前数据库快照）统一用 `BACKUP_S3_ACCESS_KEY_ID` / `BACKUP_S3_SECRET_ACCESS_KEY`，每个环境各一套；私有内容索引分别用 `PREVIEW_PRIVATE_INDEX_S3_ACCESS_KEY_ID` / `PREVIEW_PRIVATE_INDEX_S3_SECRET_ACCESS_KEY` 与 `PRODUCTION_PRIVATE_INDEX_S3_ACCESS_KEY_ID` / `PRODUCTION_PRIVATE_INDEX_S3_SECRET_ACCESS_KEY`。它们只进入对应受控归档进程，不进入业务运行 env、镜像、argv、日志或公开清单；备份的 endpoint、region、桶与前缀来自 `BACKUP_S3_*`；内容索引的 endpoint、region、桶与 path-style 固定在适配器合同里。内容索引归档仍指向 Garage，见上文「Garage 的公开桶已封存」。

构建参数 `STATIC_CDN_BASE` 只能为空或由环境文件的 `STATIC_CDN_ORIGIN` 派生的 `<源站>/yzgc/static/site/`（#360，源站不写在代码或工作流里）。空值保持 JS/CSS/字体/构建图片及内置表情同源；HTML、接口、release.json 和不带哈希的 public 文件一直同源。宣传片、邮件图片、指南正文地址不随构建开关切回同源。旧帖清单里显式标 `cdn: true` 的图片也固定走 CDN；其余旧帖图片继续按 viewer 从核心同源读取。镜像仍保存构建资产、内置表情与旧帖图片的同源副本。

## 上传协议、保护与限制

`scripts/static-cdn-s3.mjs` 使用 Node 内置 crypto/fetch 实现 SigV4：服务 `s3`、region `cn-south-1`、完整 `x-amz-content-sha256`，签名包含 Host、日期及写入元信息。只允许 GET、HEAD、经过 `ensure` 的 PUT，没有删除、移动、改元信息接口。拒绝路径穿越、编码路径、查询串、用户信息、非合同目的地及无哈希静态对象名。

内容寻址：构建对象保留构建内容哈希名，截图重算文件名中的摘要，表情用完整 SHA-256；每个实际对象的完整 SHA-256 记录于清单。每次写之前先完整签名 GET；已存在则逐字比对，不发送 PUT；冲突立即失败。不存在时 PUT 后再完整 GET 核对。PUT 响应丢失时先重新 GET 对账，不盲目重发 PUT。同一适配器按键串行化；整批先校验键、大小、类型与摘要，最大单文件 10 MiB、并发最多 8，默认 4。网络/429/5xx 最多 3 次，重试等待有界，每次 15 秒超时覆盖响应体，响应读取有大小上限。重定向一律拒绝，错误不打印上游原文、签名或凭据。

**防覆盖只在客户端执行。** 七牛 S3 兼容接口是否支持 `If-None-Match` 条件创建、对象锁或 WORM，本任务没有实测，不能假定其存在。客户端不会主动覆盖已存在对象，但 GET/PUT 之间存在竞态；不同进程、恶意或其他持有写权限的写入者仍可能覆盖。凭据的桶范围、发布串行化、只读发布归档或外部独占写入网关需由运维明确实现并真实验证，不能靠空断言宣称已经隔离。此任务未添加这些服务端能力，也未把真实端点的 401 绕成 BasicAuth。

## 命令与发布接线

```bash
# 离线：保持 collect/plan 接口，另外包含源截图和内置表情。
node scripts/static-cdn.mjs plan --web <web根> --forum <forum根>
node scripts/static-cdn.mjs decide --origin https://prev.yangtzeu.work

# 只有已获授权的发布任务注入 S3 环境凭据；此命令会写公开对象。
node scripts/static-cdn.mjs upload --web <web根> --forum <forum根> \
  --referer https://prev.yangtzeu.work/ --environment preview \
  --commit <完整提交> --generated-at <提交时间> \
  --manifest <新的本地清单文件> --content-index <新的本地私有索引文件>

# 恢复追溯：无需写凭据，只按清单读取公开对象并完整核对。
node scripts/static-cdn.mjs verify-manifest --manifest <清单文件> \
  --referer https://prev.yangtzeu.work/
```

本地输出使用 `wx`，拒绝覆盖已有文件。新服务不再有 `mint-token`、`--owner-env-file` 或七牛表单上传步骤。GitLab 是本次事项与外部操作的主入口：父级 task270 的 GitLab 发版草稿须接入本 CLI，传入完整 SHA、提交时间和环境，并在上传/公开校验成功后才部署。当前基线 `.github/workflows/{ci,deploy-preview,deploy-production,deploy-hotfix}.yml` 的既有接线同步为新协议，不代表已经创建或运行 GitLab 流水线。

### 与 task270 的合并边界

本分支基于 stage，不引入 task270 的 Arch/Compose/GitLab 全套草稿。集成时逐块合并两份部署工作流的 `cdn-plan`/`cdn-upload`、两份 `deploy/env` 的邮件 base、`docs/ops/{CICD,DEPLOY,ENVIRONMENTS}.md` 和生成目录，不能用任一任务整文件覆盖另一任务。

task270 的 `deploy/gitlab/backup.sh`、`restore-drill.sh` 已改为调用共享 Garage 归档器：新写入位于 `gitlab/YYYY-MM-DD/<run>/`，恢复仍可按日期选最新运行，完整下载后核对 `SHA256SUMS`，不再使用 sync/purge。`deploy/remote/platform-maintenance.sh` 在本地收据中固定 `platform/<environment>/<date>/<run>/`，独立 `platform-archive.sh` 验证本地 SHA、先加密再归档；原 `platform-backup@.service` 的 `AF_UNIX` sandbox 不放宽，联网归档须由另一个获批、可联网但最小权限的受控步骤调用。本分支不移动现有数据，也不声称真实服务器已安装或恢复通过。#354 起这些备份路径改写七牛私有备份桶（`BACKUP_S3_*`，见 [BACKUP](BACKUP.md)），`geek-backup` 只保留已有对象。

## 验证与环境责任

公开对象逐个校验 HEAD 200、完整 GET 200 的 SHA-256/字节数、Range 206 和 `Content-Range`/字节、MIME、公开缓存以及浏览器需要的 CORS。ETag 视为不透明值，不依赖等于 qetag、MD5 或 SHA-256。

本地 HTTP 假存储故意允许服务端覆盖，以证明已有对象保护确实在客户端执行。假存储在 `/fixture-bucket/<键>` 上模拟 path-style S3，在 `/yzgc/<键>` 上模拟公开域名直链。受限运行器不能 bind 时，测试通过 Node 原生 HTTP client/server 的进程内双向字节流执行；`CDN_TEST_TCP=1` 改为真实回环 TCP。它们是协议/源码回归，不证明公网、TLS、浏览器或供应商安全能力。

2026-10-30 的只读核对（HEAD、不写对象）：`https://cdn.crosery.com` 上宣传片的 `master-av1.m3u8`、`master-h264.m3u8`、`poster.jpg`、`poster-640.jpg` 与 8 个档位播放列表都是 200，每个档位的初始化段与首分片也是 200；邮件的四个图片对象是 200；表情（抽样 1 个）与使用说明截图（抽样 1 个）是 200；旧帖图片 `forum/published/` 抽样 1 个是 404，即这些对象还没有上传到七牛，要靠下一次发布的 `cdn-upload` 补传。

父级仍负责：旧对象的逐项完整 GET 哈希、桶权限与凭据、真实 TLS/SigV4、匿名不能列桶/写公开对象/读私有对象、两环境 MIME/CORS/Range、HLS 全链、邮件图片、指南与表情、真实浏览器及备份恢复。未经这些实测不得标为上线通过。

回滚源码/构建开关不删除任何对象；已发布旧镜像仍引用旧服务时，必须保留其资源与迁移清单。新服务缺对象或凭据失效不会自动退回旧 CDN。

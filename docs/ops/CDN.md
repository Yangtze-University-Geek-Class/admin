# CDN 与对象存储合同

> #295：公开静态资源迁到 path-style S3；对象内容、发布来源和私有运维索引分别追溯。

状态：`current` · 更新：2026-10-28

## 桶与路径

S3 endpoint 为 `https://cdn.yangtzeu.work`，region 为 `garage`，`forcePathStyle=true`。公开基础地址为 `https://cdn.yangtzeu.work/geek-public`。这是目标合同，不是供应商可用性或桶权限已生效的证据。

| 桶 | 可见性与用途 | 对象路径 |
|---|---|---|
| `geek-public` | 仅公开静态资源；不允许匿名列桶、写入 | `static/site/{assets,console-assets,forum/_nuxt,forum/guides,forum/stickers,forum/published}/`；保持构建或源文件内容哈希文件名 |
| `geek-public` | 宣传片；保持相对 HLS 主清单、子清单、初始化段、分片和海报关系 | `media/promo/<版本与内容哈希>/` |
| `geek-public` | 邮件图片 | `mail/v1/`，`MAIL_ASSET_BASE=https://cdn.yangtzeu.work/geek-public/mail/v1/` |
| `geek-production-private` | 正式环境私有业务对象预留 | 按业务合同另行确定；本任务不外移 DB、头像、附件或站点包 |
| `geek-preview-private` | 预发布环境私有业务对象预留 | 与正式隔离；本任务不移动任何现有业务对象 |
| `geek-backup` | 私有、加密运维备份及运维索引 | 平台 `platform/<environment>/<date>/<run>/`；GitLab 保持 `gitlab/YYYY-MM-DD/`，兼容恢复选择器 |

除下述明确允许公开的发布来源清单外，业务、内容哈希反查和运维索引只允许放私有桶。上传器不会把私有桶内容或私有索引同步到公开桶。

旧 `yzgc/static/site/` 映射到 `static/site/`，旧 `yzgc/static/promo/` 映射到 `media/promo/`，旧 `yzgc/mail/` 映射到 `mail/`。旧实际域名主要为七牛侧的个人域名，不是仅 `.cn`。历史 notes、changes、archive、已发布 tag 不改写；旧版本回滚所需的旧供应商对象不能由此源码任务删除。

## 公开发布清单与私有内容索引

公开来源索引：`indexes/releases/<production|preview>/<完整40位小写commit>/manifest.json`。schema 固定为：

```json
{
  "schema_version": 1,
  "environment": "preview",
  "commit": "0000000000000000000000000000000000000000",
  "generated_at": "2026-10-26T17:21:00.000Z",
  "objects": [{
    "key": "static/site/assets/app-12345678.js",
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
| `STATIC_CDN_S3_ACCESS_KEY_ID` | CDN 发布凭据 ID；不进运行时镜像和业务 `.env` |
| `STATIC_CDN_S3_SECRET_ACCESS_KEY` | 对应 secret；不得写日志或文件 |
| `STATIC_CDN_S3_ENDPOINT` | 可省略，固定上述 HTTPS endpoint；其他值拒绝 |
| `STATIC_CDN_S3_REGION` | 可省略，只接受 `garage` |
| `STATIC_CDN_S3_BUCKET` | 可省略，只接受 `geek-public` |
| `STATIC_CDN_S3_FORCE_PATH_STYLE` | 可省略，只接受 `true` |

两项密钥都不设时 `decide` 保持同源；只设一项、非法目的地、配置旧 `STATIC_CDN_UPLOAD_TOKEN` 时失败。完整凭据下先读环境首页 CSP：未放行新 CDN 时仍按原约定同源构建。CSP 放行后对 S3 做签名探测，401/403、网络失败、超时均失败关闭，不自动回旧供应商。

私有归档凭据按用途和环境拆分：GitLab 用 `GITLAB_BACKUP_S3_ACCESS_KEY_ID` / `GITLAB_BACKUP_S3_SECRET_ACCESS_KEY`；平台快照分别用 `PLATFORM_PREVIEW_BACKUP_S3_ACCESS_KEY_ID` / `PLATFORM_PREVIEW_BACKUP_S3_SECRET_ACCESS_KEY` 与 `PLATFORM_PRODUCTION_BACKUP_S3_ACCESS_KEY_ID` / `PLATFORM_PRODUCTION_BACKUP_S3_SECRET_ACCESS_KEY`；私有内容索引分别用 `PREVIEW_PRIVATE_INDEX_S3_ACCESS_KEY_ID` / `PREVIEW_PRIVATE_INDEX_S3_SECRET_ACCESS_KEY` 与 `PRODUCTION_PRIVATE_INDEX_S3_ACCESS_KEY_ID` / `PRODUCTION_PRIVATE_INDEX_S3_SECRET_ACCESS_KEY`。它们只进入对应受控归档进程，不进入业务运行 env、镜像、argv、日志或公开清单；endpoint、region、桶与 path-style 固定在适配器合同里。

构建参数 `STATIC_CDN_BASE` 只能为空或 `https://cdn.yangtzeu.work/geek-public/static/site/`。空值保持 JS/CSS/字体/构建图片及内置表情同源；HTML、接口、release.json 和不带哈希的 public 文件一直同源。宣传片、邮件图片、指南正文地址不随构建开关切回同源。旧帖清单里显式标 `cdn: true` 的图片也固定走 CDN；其余旧帖图片继续按 viewer 从核心同源读取。镜像仍保存构建资产、内置表情与旧帖图片的同源副本。

## 上传协议、保护与限制

`scripts/static-cdn-s3.mjs` 使用 Node 内置 crypto/fetch 实现 SigV4：服务 `s3`、region `garage`、完整 `x-amz-content-sha256`，签名包含 Host、日期及写入元信息。只允许 GET、HEAD、经过 `ensure` 的 PUT，没有删除、移动、改元信息接口。拒绝路径穿越、编码路径、查询串、用户信息、非合同目的地及无哈希静态对象名。

内容寻址：构建对象保留构建内容哈希名，截图重算文件名中的摘要，表情用完整 SHA-256；每个实际对象的完整 SHA-256 记录于清单。每次写之前先完整签名 GET；已存在则逐字比对，不发送 PUT；冲突立即失败。不存在时 PUT 后再完整 GET 核对。PUT 响应丢失时先重新 GET 对账，不盲目重发 PUT。同一适配器按键串行化；整批先校验键、大小、类型与摘要，最大单文件 10 MiB、并发最多 8，默认 4。网络/429/5xx 最多 3 次，重试等待有界，每次 15 秒超时覆盖响应体，响应读取有大小上限。重定向一律拒绝，错误不打印上游原文、签名或凭据。

**这不是七牛 insertOnly 的等价服务端保障。** Garage 不支持 `If-None-Match` 条件创建、对象锁或 WORM，不能把 BucketPolicy 当作 Amazon S3 的完整等价实现。客户端不会主动覆盖已存在对象，但 GET/PUT 之间存在竞态；不同进程、恶意或其他持有写权限的写入者仍可能覆盖。凭据桶范围、发布串行化、只读发布归档或外部独占写入网关需由运维明确实现并真实验证，不能靠空断言宣称已经隔离。此任务未添加这些服务端能力，也未把真实端点的 401 绕成 BasicAuth。

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

本地输出使用 `wx`，拒绝覆盖已有文件。新服务不再有 `mint-token`、`--owner-env-file` 或七牛表单上传步骤。GitLab 是本次事项与外部操作的主入口：父级 task270 的 GitLab 发版草稿须接入本 CLI，传入完整 SHA、提交时间和环境，并在上传/公开校验成功后才部署。当前基线 `.github/workflows/{ci,deploy-preview,deploy-production}.yml` 的既有接线同步为新协议，不代表已经创建或运行 GitLab 流水线。

### 与 task270 的合并边界

本分支基于 stage，不引入 task270 的 Arch/Compose/GitLab 全套草稿。集成时逐块合并两份部署工作流的 `cdn-plan`/`cdn-upload`、两份 `deploy/env` 的邮件 base、`docs/ops/{CICD,DEPLOY,ENVIRONMENTS}.md` 和生成目录，不能用任一任务整文件覆盖另一任务。

task270 的 `deploy/gitlab/backup.sh`、`restore-drill.sh` 已改为调用共享 Garage 归档器：新写入位于 `gitlab/YYYY-MM-DD/<run>/`，恢复仍可按日期选最新运行，完整下载后核对 `SHA256SUMS`，不再使用 sync/purge。`deploy/remote/platform-maintenance.sh` 在本地收据中固定 `platform/<environment>/<date>/<run>/`，独立 `platform-archive.sh` 验证本地 SHA、先加密再归档；原 `platform-backup@.service` 的 `AF_UNIX` sandbox 不放宽，联网归档须由另一个获批、可联网但最小权限的受控步骤调用。本分支不移动现有数据，也不声称真实服务器已安装或恢复通过。

## 验证与环境责任

公开对象逐个校验 HEAD 200、完整 GET 200 的 SHA-256/字节数、Range 206 和 `Content-Range`/字节、MIME、公开缓存以及浏览器需要的 CORS。ETag 视为不透明值，不依赖等于 qetag、MD5 或 SHA-256。

本地 HTTP 假存储故意允许服务端覆盖，以证明已有对象保护确实在客户端执行。受限运行器不能 bind 时，测试通过 Node 原生 HTTP client/server 的进程内双向字节流执行；`CDN_TEST_TCP=1` 改为真实回环 TCP。它们是协议/源码回归，不证明公网、TLS、浏览器或供应商安全能力。

父级负责旧对象下载/上传、逐项完整 GET 哈希、桶权限与凭据、真实 TLS/SigV4、匿名不能列桶/写公开对象/读私有对象、两环境 MIME/CORS/Range、HLS 全链、邮件图片、指南与表情、真实浏览器及备份恢复。新端点目前所报的 S3 401 是环境阻塞；未经这些实测不得标为上线通过。

回滚源码/构建开关不删除任何对象；已发布旧镜像仍引用旧服务时，必须保留其资源与迁移清单。新服务缺对象或凭据失效不会自动退回旧 CDN。

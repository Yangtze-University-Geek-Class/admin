# 极客班论坛数据本地保全

> 已通过 Mac SSH 获取三份 SQLite 在线备份及两代附件；本机论坛可只读显示由此生成的投影，未导入可写库或切换线上服务。

状态：`current` · 更新：2026-09-26 · 适用：已明确授权的极客班论坛源数据拉取与校验（2026-09-13 首次采集，2026-09-26 增量采集）。

## 最新接入状态：本机只读显示，未导入可写库

现在用的只读展示投影是 `.tools/forum-runtime/geek-20260926/`，由 2026-09-26 的增量采集经 `prepare.py` 转换而来（见下文「2026-09-26 增量采集」）：185 个公开资料记录、70 个有效主题、35 条有效回复、21 个分类，其中 67 个历史归档主题；19 个已删主题和 31 条已删回复不复活。第一份投影是 2026-09-13 的 `geek-20260913`（183 个公开资料记录、69 个有效主题，18 个已删主题，其余同上），仍然保留。账号私有字段、密码、旧会话、邮件/IP、私有消息和用户组权限不进入展示投影。原始备份保持不变。

附件规范化处理了 160 份有效输入，11 份不符合允许格式的现站上传不用于展示；去重后129份资产，其中可见正文/头像引用85份，缺失引用0。两份投影的 `asset-index.json` 逐字节相同。图像真实解码后重新编码为 WebP，原始文件不删除。

**2026-09-13 起，根 `pnpm forum:start` 自动发现投影（有多份时取名字最大的）并以只读快照模式启动：dev 专用 `/api/local-forum/state` 与 `/api/local-forum/assets/<hash>` 只读提供投影，页面整体替换为极客班内容、会话固定为游客、论坛状态不写 localStorage；浏览器已验证首页、话题、附件图片、关于页、成员页和刷新深链接。** 这不是迁移完成：没有可写数据库或跨设备存储；2026-09-25 起快照模式的顶栏接了全站 GitHub 登录，但它只识别身份，旧论坛账号没有和 GitHub 登录关联，论坛也不据此开放任何写操作；投影仍在 `.tools` 私有目录，不进 Git 或构建产物。运行方式见 [TUFF-FORUM](TUFF-FORUM.md)，边界见 [forum 服务合同](../services/forum/README.md)。此前一次创建接口文件的尝试曾被工具拦截，本次按项目规范重新实现，没有绕过安全限制。

## 已完成的范围

实际通过 crosery-mac 的 OpenSSH 连接已记录的极客班服务器，使用已有身份和严格主机密钥校验，未读取/输出 SSH 私钥、密码或应用 .env。连接成功且发现论坛部署目录、现用 forum.db 和历史 mbbs 数据。现场查询时旧 systemd 服务 `yzgc-admin` 为 active（该部署模型已在 2026-09-23 退役，见 [DEPLOY](DEPLOY.md) 历史章节）。

采集工具 `scripts/forum-migration/capture.py` 以只读连接打开源库，调用 SQLite online backup 创建独立镜像，再经 SSH 加密传输。远端只新建本次私有临时导出目录，结束即清理；没有修改原库内容、checkpoint、重启服务、修改 Nginx 或执行部署。不是直接复制正在使用的 WAL 主文件。

## 本机位置

私有数据都在主工作区的 `.tools/` 下。采集、核验、投影和导出工具在 task worktree 里运行时，也按 `git rev-parse --git-common-dir` 找到主工作区，把相对路径（`.tools/forum-migration/<名字>`、`.tools/forum-runtime/<名字>`）按主工作区解析；`task.mjs finish` 删掉 worktree 时不会带走这些唯一的副本。

```text
/Users/crosery/work_file/geek_main/.tools/forum-migration/20260926-new-posts/   2026-09-26 增量采集，结构同下
/Users/crosery/work_file/geek_main/.tools/forum-migration/20260913-initial/
├── transfer.tar.gz
└── source/
    ├── manifest.json
    ├── forum.sqlite
    ├── mbbs-snapshot.sqlite
    ├── mbbs-original.sqlite
    └── attachments/
        ├── legacy/          现站保留的历史附件
        ├── uploads/         现站上传目录
        └── mbbs-original/   原 mbbs 附件留痕副本
```

采集开始时间由源 manifest 记录为 `2026-09-12T19:03:18Z`（UTC），即北京时间 2026-09-13 03:03:18。每个数据库单独取得一致快照，并非停站后的跨库原子切点；正式切换前仍需增量核对。

## 来源和数量

下表的远端路径是**采集当时的线上布局**（旧 systemd + `/opt/yzgc-admin` 模型，已于 2026-09-23 退役，见 [DEPLOY](DEPLOY.md) 历史章节）；这些路径是历史事实记录，不代表现行部署结构。

| 数据集 | 远端来源 | 已保存的主要记录 |
|---|---|---|
| 现用论坛 | `/opt/yzgc-admin/data/forum.db` | 用户 183、主题 87、回复 66、分类 21、标签 4、用户组 4；全部 13 张业务表 |
| 旧站迁移快照 | `/opt/yzgc-admin/data/bbs-snapshot.db` | 用户 164、主题 77、帖子 145、分类 16、点赞关系 47、用户消息 133；全部 12 张业务表 |
| 原 mbbs 数据库 | `/root/geek-mbbs/bbs.db` | 同类 12 张业务表，独立保留原始来源，不因条数相同就丢弃 |
| 现站历史附件 | `/opt/yzgc-admin/data/legacy-resources` | 160 文件，29,817,368 字节 |
| 现站上传 | `/opt/yzgc-admin/data/forum-uploads` | 11 文件，761 字节；原样保留，不宣称都是有效图片 |
| 原站附件 | `/root/geek-mbbs/resources` | 160 文件，29,817,368 字节；逐路径/哈希与历史附件副本一致 |

现库的“回复”和 mbbs 的“posts（包含首帖）”口径不同；两代数据重叠，不能直接相加宣称迁入了更多用户/帖子。原始采集步骤没有执行去重、字段映射、删除状态恢复或内容重写；后续独立投影的映射与展示限制见本文最上方最新状态。所有表条数及文件摘要在私有 source/manifest.json 中。

共校验 334 个载荷文件：3 个数据库、331 个附件条目，载荷 62,306,089 字节。压缩归档 58,030,132 字节，SHA-256：

```text
a5f30455530251d7d2347808632b049fcb6147d68e548e52331e3a393a835aac
```

## 本地验证与恢复演练

从 geek_main 根目录运行以下只读核验，不连接服务器：

```bash
python3 scripts/forum-migration/verify.py \
  --snapshot .tools/forum-migration/20260913-initial \
  --archive-sha256 a5f30455530251d7d2347808632b049fcb6147d68e548e52331e3a393a835aac
```

本次实际结果：334 文件大小和 SHA-256 均匹配；3 个镜像分别恢复到独立内存库，integrity_check 均为 ok，全部表名与条数匹配采集 manifest；两份 160 文件的历史附件逐路径/哈希一致；Git 忽略生效、未跟踪任何私有备份。文件权限 0600，数据目录 0700。

初次只用 mode=ro 打开冻结 WAL 模式镜像时，本机 SQLite 返回 unable to open database file。随后使用只适用于冻结备份的 `mode=ro&immutable=1` 成功执行完整核验和内存恢复；未修改备份，也未将此选项用于正在写入的线上库。校验不是业务功能验收，也不是完整数据库迁移演练。

## 公开导出（#87）

快照本身不入库。要把其中几篇放到线上极客班论坛，只能走一条路：在 `app/forum/content/published/manifest.json` 里列出话题编号、类别、标签和替换规则，再运行

```bash
node scripts/forum-migration/export-published.mjs .tools/forum-runtime/geek-20260913 --fetch
```

`--fetch` 只在清单要编辑的外链原图还没下载时联网一次，按清单里的 SHA-256 核对后存到快照的 `external/` 下；之后不加它也能离线重跑。它只读快照，写出 `app/forum/content/published/topics.json` 和 `app/forum/public/published/*.webp`，并把每篇改了什么（站内链接、不公开的链接、去掉的链接、换掉的图片、去掉的图片、留作外链的图片、替换次数）打印到终端，这份记录不入库，逐篇摘要（不含私密值）贴进 PR。入库前逐篇核对正文和图片（包括 HTML `<img>` 和留作外链的图）里没有账号、密码、令牌、邮箱、手机号、真实姓名和别人的本机用户名；留下的第三方内容（原作者自己在截图里的网名、需要特殊网络才能打开的外部服务）在 PR 的复核记录里写明理由。话题和作者字段统一写「极客班」，旧论坛的作者昵称和用户名不进作者字段，回复不导出。字段和改写规则见 [forum 合同](../services/forum/README.md)「公开的旧帖」。

## 2026-09-26 增量采集（#108）

所有者 2026-09-26 要求把正式环境上新发的帖子放到预发布，以后迁移正式环境时，新帖也要能补进来。本节记录这次采集，下一节是以后照做的步骤。

现场（只读核对）：`yangtzeu.work` 仍由旧部署提供，nginx 反代 `127.0.0.1:3000`，进程是 systemd 服务 `yzgc-admin`（工作目录 `/opt/yzgc-admin`），它打开的论坛库仍是 `/opt/yzgc-admin/data/forum.db`，WAL 当天仍在写；`/opt/yzgc` 下只有 preview 栈。这是 2026-09-26 的现场事实，旧模型还没有从正式域名撤下，不代表现行部署结构。布局和 09-13 相同，所以 `capture.py` 的默认来源路径不用改。

连接：这台 Mac 的 Clash TUN 把服务器地址转到境外节点，SSH 在握手前就被断开。采集改从本机网卡直连（`--bind-interface en0`），主机密钥仍严格校验；直连只有几十到一百多 KB/s，约 58 MB 的归档要几分钟到半小时，所以把整体超时放宽到一小时（`--timeout 3600`，默认 240 秒）。服务器地址和端口是 `deploy/env/.env.production` 里的 `DEPLOY_HOST`、`DEPLOY_PORT`（这次用 `root` 账户，和 09-13 相同）。

```bash
python3 scripts/forum-migration/capture.py --host root@<DEPLOY_HOST> --port <DEPLOY_PORT> \
  --bind-interface en0 --timeout 3600 --destination .tools/forum-migration/20260926-new-posts
python3 scripts/forum-migration/verify.py --snapshot .tools/forum-migration/20260926-new-posts \
  --archive-sha256 6992367e1bde203c9572f0525c8e650b13bea5e63557db2c448a6dfad41f23fe
python3 scripts/forum-migration/prepare.py --snapshot .tools/forum-migration/20260926-new-posts \
  --archive-sha256 6992367e1bde203c9572f0525c8e650b13bea5e63557db2c448a6dfad41f23fe \
  --name geek-20260926 --node /Users/crosery/work_file/geek_main/.tools/node/bin/node
```

远端仍只建本次的私有临时导出目录，结束后已确认不存在；没有改原库、checkpoint、重启服务或改 nginx。第一次按旧的 240 秒超时中断，第二次为了改成脱离终端会话运行而手动停止；两次的半截归档都已删除，远端临时目录也已确认清理。

结果：采集时间 `2026-09-26T07:30:15Z`（北京时间 15:30:15）；334 个载荷文件共 62,367,529 字节，压缩归档 58,044,470 字节，SHA-256：

```text
6992367e1bde203c9572f0525c8e650b13bea5e63557db2c448a6dfad41f23fe
```

`verify.py` 的结果：334 个文件的大小和哈希都对得上，三个库恢复到内存后 integrity_check 都是 ok，表条数与采集 manifest 一致，两份历史附件逐路径一致，备份被 Git 忽略。和 09-13 比，只有 `forum.sqlite` 变了：主题 87 → 89、用户 183 → 185（另有会话 48 → 53，属于私有记录，不进投影）；附件和两份 mbbs 库逐文件哈希不变。

投影 `.tools/forum-runtime/geek-20260926/`：185 个公开资料记录、70 个有效主题、35 条有效回复、21 个分类，其中 67 个历史归档主题；排除已删主题 19 个、已删回复 31 条，引用附件 85 份，缺失 0。`asset-index.json` 与 `geek-20260913` 的逐字节相同。`pnpm forum:start` 自动选名字最大的投影，所以本机快照模式现在读的是它。`t89` 原来的分类「AI Coding」（`c18`）在 `curation.json` 的 `categoryOmissions` 里，所以 `curation.json` 的 `topics` 里也给了它「人工智能」和同样的标签，否则快照加载会报「无法移除分类 c18」；这条归类引用的 `t89` 只在 `geek-20260926` 及以后的投影里有，再指定 `geek-20260913` 会因为找不到 `t89` 加载失败。

09-13 之后新建的主题只有两个：`t89`「国内 Agent 工具安装指南」（2026-09-25 16:46Z，原「AI Coding」分类）去掉公益 API 密钥后公开；`t88` 是同一篇较长的早先版本，发帖人已删，不复活。已公开的 14 篇在 09-13 之后没有被编辑，只有浏览数变了。

同一次还公开了 09-13 的快照里就有、同样写在现论坛上的两篇：`t78`「LLM-WIKI搭建经验谈--来自2026/6/14晚i3egnner分享会」（2026-06-14 14:34Z，原「应用与产品」分类 `c20`）和 `t84`「Vibecoding知识点整理，从大模型到Coding Agent；包含大模型基础、Agent原理、工具区分等内容」（2026-09-09 00:25Z，原「AI Coding」分类 `c18`）。两篇都用原文：没有邮箱、账户、密码和密钥；`t78` 里提到的分享人只写了网名，保留；`t84` 引用的讲义是清华云盘上不设密码的公开分享，保留链接，只把地址里的空格编成 `%20`（原文的空格让 Markdown 认不出这个链接）。`t84` 的 8 张讲义截图放在 gitee 图床，带着别的网站的 Referer 去取会被转到 gitee 的图标，线上显示不出来，所以在清单里写了原图 `sha256`，第一次导出加 `--fetch` 下载后转成站内 WebP；截图只有讲义上的示意图，没有个人信息。`curation.json` 里给本机快照模式改写的标题和正文（`content/posts/body-78.md`、`body-84.md`）不进镜像。

## 以后再补新帖

旧论坛下线前每补一次，都按下面做一遍：

1. 在这次任务的 task worktree 里，照上一节的命令重新采集到一个新目录 `.tools/forum-migration/<日期>-<说明>`，`verify.py` 核对，再用 `prepare.py` 出新投影 `.tools/forum-runtime/geek-<日期>`。目录名不能和已有的重复，采集工具不覆盖旧目录。
2. 和上一份投影对比，列出上次采集之后新建的主题，以及已公开话题的正文有没有变（比较 `content.json` 里首帖的 `content`）。逐篇读正文，看有没有邮箱、手机号、学号、账号密码、API 密钥、私人网盘或分享链接、别人的个人信息，决定公开还是写进 `withheld`，每篇在 PR 里写一句理由。外链图片带上 `Referer: https://prev.yangtzeu.work/` 取一次，看图床给不给外站引用。
3. 改 `app/forum/content/published/manifest.json`：`source` 换成新投影的目录名，要公开的编号加进 `topics`（类别、标签、置顶），需要的图片规则和 `redactions` 一起写；替换规则里不写被去掉的原文。图床不给外站引用的外链图（gitee raw 就是这样）不需要编辑也写一条带原图 `sha256` 的规则，导出成站内图片。新帖原来的分类在 `curation.json` 的 `categoryOmissions` 里（`c16`–`c20`）时，在 `curation.json` 的 `topics` 里给它同样的类别和标签，本机快照模式才能加载新投影。
4. 运行 `node scripts/forum-migration/export-published.mjs .tools/forum-runtime/geek-<日期> --fetch`（新投影里还没有外链原图时会下载一次，并按清单里的 SHA-256 核对）。已公开话题的 `content` 应该不变，跟着快照变的只有 `views` 和顶层的 `source`、`capturedAt`；正文变了要在 PR 里说明是原帖被编辑了。不加 `--fetch` 再跑一次，确认输出逐字节相同。
5. 更新 `app/forum/tests/site-state.test.ts`、`app/forum/Dockerfile` 的断言和 [forum 合同](../services/forum/README.md)「公开的旧帖」，跑 `pnpm forum:check`、按镜像方式的 `forum.mjs generate` 和根 `pnpm check`，走 PR 进 `stage`，再按 [RELEASES](../conventions/RELEASES.md) 发版。
6. 按 #57（PR #116）的约定，合并后生效：论坛后端在启动时把 `topics.json` 里的话题按编号「没有才插入」：已经导入的话题不会重复，也不会被覆盖，线上的回复、置顶和浏览数以数据库为准。所以补新帖只会带进新的编号，`topics.json` 里旧话题的浏览数变化不会回写到线上。

## 敏感性和禁止操作

完整源库包含用户私有字段以及历史会话/凭据记录，必须作为敏感备份保管；这些记录没有被激活为新论坛登录态。备份仅存于用户 Mac，不上传聊天附件、Git、CI 缓存或 Actions artifacts，不放入 Nuxt public、浏览器 localStorage、演示种子或发布包。没有抓取无关项目、组织管理库、服务器日志或应用密钥。

`.tools/forum-migration` 虽然被 Git 忽略，但不是可随意删除的缓存。禁止 `git clean -fdx`、整体删除 .tools 或清理旧论坛目录而误删唯一数据副本。保留/加密存档/离机备份由所有者决定，不擅自同步到第三方存储。

## 尚未进行

已生成独立只读投影并可在本机只读显示，但没有导入可写目标数据库、上线新论坛、建立真实统一登录、重新使用历史会话、运行持续同步，也没有发布（没有打任何发布 tag，发版规则见 [RELEASES](../conventions/RELEASES.md)）。当前用户将步骤限定为“先拉到本地”，后续转换和上线是下一阶段，须另有副本演练、身份认领策略、权限/隐藏/删除数据处理、附件安全校验、增量核对及 [人工发版门禁](../conventions/RELEASES.md)。

技术依据（2026-09-13 核对）：https://www.sqlite.org/backup.html 。该 API 提供在线一致数据库复制；本任务证据来自实际导出、manifest 和本地恢复，而不是仅引用文档。

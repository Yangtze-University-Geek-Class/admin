# 极客班论坛数据本地保全

> 已通过 Mac SSH 获取三份 SQLite 在线备份及两代附件；本机论坛可只读显示由此生成的投影，未导入可写库或切换线上服务。

状态：`current` · 更新：2026-09-25 · 适用：本次已明确授权的极客班论坛源数据拉取与校验。

## 最新接入状态：本机只读显示，未导入可写库

2026-09-13 后续检查已用 `prepare.py` 将当前 forum.sqlite 转换成独立的只读展示投影，位于 `.tools/forum-runtime/geek-20260913/`。结果为 183 个公开资料记录、69 个有效主题、35 条有效回复、21 个分类，其中 67 个历史归档主题；18 个已删主题和31条已删回复不复活。账号私有字段、密码、旧会话、邮件/IP、私有消息和用户组权限不进入展示投影。原始备份保持不变。

附件规范化处理了 160 份有效输入，11 份不符合允许格式的现站上传不用于展示；去重后129份资产，其中可见正文/头像引用85份，缺失引用0。图像真实解码后重新编码为 WebP，原始文件不删除。

**2026-09-13 起，根 `pnpm forum:start` 自动发现该投影并以只读快照模式启动：dev 专用 `/api/local-forum/state` 与 `/api/local-forum/assets/<hash>` 只读提供投影，页面整体替换为极客班内容、会话固定为游客、论坛状态不写 localStorage；浏览器已验证首页、话题、附件图片、关于页、成员页和刷新深链接。** 这不是迁移完成：没有可写数据库或跨设备存储；2026-09-25 起快照模式的顶栏接了全站 GitHub 登录，但它只识别身份，旧论坛账号没有和 GitHub 登录关联，论坛也不据此开放任何写操作；投影仍在 `.tools` 私有目录，不进 Git 或构建产物。运行方式见 [TUFF-FORUM](TUFF-FORUM.md)，边界见 [forum 服务合同](../services/forum/README.md)。此前一次创建接口文件的尝试曾被工具拦截，本次按项目规范重新实现，没有绕过安全限制。

## 已完成的范围

实际通过 crosery-mac 的 OpenSSH 连接已记录的极客班服务器，使用已有身份和严格主机密钥校验，未读取/输出 SSH 私钥、密码或应用 .env。连接成功且发现论坛部署目录、现用 forum.db 和历史 mbbs 数据。现场查询时旧 systemd 服务 `yzgc-admin` 为 active（该部署模型已在 2026-09-23 退役，见 [DEPLOY](DEPLOY.md) 历史章节）。

采集工具 `scripts/forum-migration/capture.py` 以只读连接打开源库，调用 SQLite online backup 创建独立镜像，再经 SSH 加密传输。远端只新建本次私有临时导出目录，结束即清理；没有修改原库内容、checkpoint、重启服务、修改 Nginx 或执行部署。不是直接复制正在使用的 WAL 主文件。

## 本机位置

```text
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

`--fetch` 只在清单要编辑的外链原图还没下载时联网一次，按清单里的 SHA-256 核对后存到快照的 `external/` 下；之后不加它也能离线重跑。它只读快照，写出 `app/forum/content/published/topics.json` 和 `app/forum/public/published/*.webp`，并把每篇改了什么（站内链接、不公开的链接、去掉的链接、换掉的图片、替换次数）打印到终端，这份记录不入库，贴进 PR 的审查里。入库前逐篇核对正文和图片里没有账号、密码、令牌、邮箱、手机号和真实姓名；外链图片同样要看。作者统一写「极客班」，旧论坛的昵称和用户名不导出，回复不导出。字段和改写规则见 [forum 合同](../services/forum/README.md)「公开的旧帖」。

## 敏感性和禁止操作

完整源库包含用户私有字段以及历史会话/凭据记录，必须作为敏感备份保管；这些记录没有被激活为新论坛登录态。备份仅存于用户 Mac，不上传聊天附件、Git、CI 缓存或 Actions artifacts，不放入 Nuxt public、浏览器 localStorage、演示种子或发布包。没有抓取无关项目、组织管理库、服务器日志或应用密钥。

`.tools/forum-migration` 虽然被 Git 忽略，但不是可随意删除的缓存。禁止 `git clean -fdx`、整体删除 .tools 或清理旧论坛目录而误删唯一数据副本。保留/加密存档/离机备份由所有者决定，不擅自同步到第三方存储。

## 尚未进行

已生成独立只读投影并可在本机只读显示，但没有导入可写目标数据库、上线新论坛、建立真实统一登录、重新使用历史会话、运行持续同步，也没有发布（没有打任何发布 tag，发版规则见 [RELEASES](../conventions/RELEASES.md)）。当前用户将步骤限定为“先拉到本地”，后续转换和上线是下一阶段，须另有副本演练、身份认领策略、权限/隐藏/删除数据处理、附件安全校验、增量核对及 [人工发版门禁](../conventions/RELEASES.md)。

技术依据（2026-09-13 核对）：https://www.sqlite.org/backup.html 。该 API 提供在线一致数据库复制；本任务证据来自实际导出、manifest 和本地恢复，而不是仅引用文档。

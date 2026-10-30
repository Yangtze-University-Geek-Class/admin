# stage · crosery · 2026-10-25

负责人：crosery

## 00:04:12 +08:00 · 发布 · #276 · rc.20 发布记录移到 stage 链路（原 22:03:16 记在 #276 收尾之后）

- 执行者：agent-claude-geek-main-3c2a7a67（Claude Code 主会话，claude-opus-5-5）
- 做了什么：2026-10-24 22:03:16 写的 rc.20 发布记录挂在了 task_276_forum_image_scan 链路的收尾之后，随 MR !16 进了 stage，note.mjs check 报「链路已经收尾，后面不能再记」。按 NOTES.md「不属于任何 task 的操作（发布……）记在当时所在分支的链路里」，从那条链路拿掉，原文记在这里：按 GitLab stage 19c5db46（含 !11 #277、!12 #278、!13 #276、!14 #276 修复）本机构建三个镜像，CDN 开关打开；static-cdn upload --owner-env-file 上传并核对 390 个文件（11.93 MiB）；rsync 增量传归档（新数据 172MB）并 sha256 核对；sqlite3 .backup 备份预发布库到 /root/yzgc-backups/preview-20261024-220157-39ab81ab9203.db（integrity_check ok）；备份并替换目标机 compose（去掉 CONSOLE_ORG）；env 只换 IMAGE_TAG；deploy-stack 部署；本地轻量 tag v0.1.1-rc.20，当时没有推送（22:2x 和其余 rc tag 一起推到了 GitLab 与 GitHub）。
- 结果：原结果：release.json version 0.1.1-rc.20@19c5db4675d7；两个 healthz 返回 ok；公开快照接口 200。拿掉旧记录是改了已入库的一条记录，原因和原文都在这条里，MR 里同样写明。
- 下一步：按 ACCEPTANCE A–G 验收 rc.21

## 00:11:49 +08:00 · 开发 · 无 issue · 宿主机 103.117.123.226 只留极客班栈，加磁盘/内存看护与每日备份

- 执行者：agent-claude-geek-main-2697b386（Claude Code，claude-sonnet-5-5）
- 做了什么：按所有者指令停用并禁用 kaiwu-keepalive 三个、claude-http-relay、yanling-api、mirror-hunt、mihomo，移除 nginx 里 game/mirror-hunt/openrouter/token 四个站点的软链；保留 yzgc-admin（极客班旧版，6M）。装 /usr/local/sbin/geek-host-guard 与两个 systemd 定时器、journald 上限、nginx OOM 分值，挂载闲置的 /dev/vdb1 到 /mnt/data 放备份
- 结果：停前后对比：yangtzeu.work 与 prev.yangtzeu.work 的 / /forum/ /release.json /auth/me 都是 200，六个容器 healthy；磁盘 27G(70%)→20G(50%)，可用内存 812M→1429M；备份 2 库完整性检查与恢复演练通过；certbot 对 yangtzeu.work、prev.yangtzeu.work 的续期演练通过；未做：异机备份、compose 层的内存限制；脚本在 .tools/host-guard（未入库）
- 下一步：等所有者决定是否配异机备份，以及是否另开 issue 把脚本和 compose 内存限制收进仓库

## 01:11:45 +08:00 · 返工 · #276 · 恢复 rc.20 发布记录的原位置，00:04:12 那条改成指向原记录

- 执行者：agent-claude-geek-main-3c2a7a67（Claude Code 主会话，claude-opus-5-5）
- 做了什么：00:04:12 把 2026-10-24 22:03:16 的 rc.20 发布记录从 notes/2026-10-24/crosery/task_276_forum_image_scan.md 拿掉，note.mjs check --pr 报「发现删除或修改已有记录的行」：记录只能往末尾追加，已写的不改不删。改正：那个文件恢复成 stage（6b71db41）上的原样，原记录留在原处；00:04:12 那条里「从那条链路拿掉」不再成立，以这条为准，它只是把 rc.20 的发布记录在 stage 链路上再登记一次。原记录挂在收尾之后的问题是 !16 合并时带进 stage 的，留在原处，不再改动。
- 结果：notes/2026-10-24/crosery/task_276_forum_image_scan.md 与 6b71db41 没有差异。
- 下一步：重跑 note.mjs check --pr，合并 MR !17。

## 04:12:30 +08:00 · 发布 · #278 · 预发布 0.1.1-rc.21@7aa5e7777726（本机发版，tag 只在本地）

- 执行者：agent-claude-geek-main-3c2a7a67（Claude Code 主会话，claude-opus-5-5）
- 做了什么：release worktree 切到 stage 7aa5e777（含 #276 !17、#274 !18、#282 !19、#283 !16、#280 !15、#278 !20）；部署前在预发布库新备份 preview-20261025-033905-rehearsal-rc21.db 的本机副本上跑两次迁移（第二次表数、列数、各表行数不变，副本已删）；build-rc.sh 21 构建三个镜像，deploy-rc.sh：CDN 上传 396 个文件核对通过、rsync 传镜像、部署前备份预发布库 preview-20261025-035636-19c5db4675d7.db、换 compose 与 env、deploy-stack，本地轻量 tag v0.1.1-rc.21
- 结果：健康检查 18200/18201 ok，部署成功 preview 7aa5e7777726；线上库 68 张表，competitions 11→12 列、competition_teams 11→15 列，users/forum_topics/forum_posts 等行数不变，forum_sticker_files 24→39、perm_nodes 51→52 按种子增加；第一期比赛已是个人赛；ego-browser 1440/390 看过控制台比赛、新建弹窗、官网页签、备份、操作记录与门户比赛窗口、组队广场
- 下一步：rc.22 带上 #281

## 04:34:07 +08:00 · 发布 · #281 · 预发布 0.1.1-rc.22@130a58b84bc7（本机发版）

- 执行者：agent-claude-geek-main-3c2a7a67（Claude Code 主会话，claude-opus-5-5）
- 做了什么：release worktree 切到 stage 130a58b8（rc.21 之上加 #281 !21）；build-rc.sh 22 构建三个镜像；deploy-rc.sh：CDN 上传 421 个文件核对通过（含 25 张说明帖配图）、rsync 传镜像、部署前备份预发布库 preview-20261025-042944-7aa5e7777726.db、换 compose 与 env、deploy-stack；本地轻量 tag v0.1.1-rc.22；v0.1.1-rc.21 与 v0.1.1-rc.22 两个 tag 推到 GitLab（pre-push 发布 tag 规则通过，GitLab 没有起流水线）
- 结果：健康检查 18200/18201 ok，部署成功 preview 130a58b84bc7；/release.json 为 0.1.1-rc.22@130a58b84bc7；游客读 /api/forum/state 看到使用说明 4 篇 public；成员账号在 ego-browser 看到 26 篇（public 4、registered 1、member 21）；t906 两张配图、t903 三张配图在 1440 宽下 naturalWidth 1440/1100 均加载成功；1440 说明帖正文与配图、说明帖列表、390 窄屏 t903 截图看过没有重叠
- 下一步：所有者在预发布验收 rc.22 并在仓库里写「批准发布 v0.1.1」后，main 快进到 130a58b8 再打 v0.1.1

## 16:41:49 +08:00 · 合并 · #285 · 合并：!27 进 stage

- 执行者：agent-claude-geek-main-completion（Claude Code，claude-sonnet-5-5）
- 做了什么：按审查过的提交 4f10185e 合并 !27（merge commit，目标 stage），GitLab 随之删除来源分支
- 结果：stage 486a4667；issue #285 已关闭并留了「关闭」追踪记录
- 下一步：随 rc.23 部署到预发布后，用预发布配置的发信商给自己填的邮箱真发一封样信

## 16:41:49 +08:00 · 收尾 · #285 · 收尾：清理 #285 的 worktree 与本地分支

- 执行者：agent-claude-geek-main-completion（Claude Code，claude-sonnet-5-5）
- 做了什么：task.mjs finish 查不到 GitHub 上的 issue 状态而保留，改为确认 4f10185e 已是 gitlab/stage 的祖先后，手工移除 .claude/worktrees/task-285、删除本地分支 task/285/mail_templates，核对远端 task/285/* 分支为 0 个，停掉隔离栈并删除临时库
- 结果：worktree 与本地、远端分支都已清理；仓库里 task/285 相关分支为 0
- 下一步：无

## 18:50:10 +08:00 · 发布 · #284 #285 #286 #287 #288 #289 #290 #291 #292 · 预发布 0.1.1-rc.23@375fba2f9cb5（本机发版，server 镜像补 STATIC_CDN_BASE 后重发）

- 执行者：agent-claude-geek-main-completion（Claude Code，claude-sonnet-5-5）
- 做了什么：所有者 2026-10-23 决定[已脱敏]、2026-10-25 12:52 接手指令范围内；本地 tag v0.1.1-rc.23 → 375fba2f（未推送）；docker build --platform linux/amd64 三个镜像；17:55:29 第一次部署，部署前备份预发布库（18:02:04，integrity ok），18:02:51 健康检查通过；随后发现 server 镜像没带 STATIC_CDN_BASE，表情接口仍给同源地址，补参数重建 server 镜像，18:06:04 到 18:11:05 重发同一提交（部署前再备份一份 18:10:20，integrity ok），健康检查通过
- 结果：release.json 0.1.1-rc.23@375fba2f9cb5；GET /api/forum/stickers 3 包 56 张地址全部在 CDN（18:49 复核）；公开赛事描述第三行是个人赛、官网 /c/oss-challenge-2026-1/ 200 16227 字节（18:49 复核）；回滚用 130a58b84bc7（rc.22）镜像与 18:02:04 的库备份
- 下一步：rc.24 随 #293 发出；所有者在预发布验收
## 19:31:29 +08:00 · 发布 · #293 · 预发布 0.1.1-rc.24@ac9f9e86b67a（本机发版）

- 执行者：agent-claude-geek-main-completion（Claude Code，claude-sonnet-5-5）
- 做了什么：所有者 2026-10-23 决定[已脱敏]、2026-10-25 12:52 接手指令范围内；本地 tag v0.1.1-rc.24 → ac9f9e86（未推送）；docker build --platform linux/amd64 三个镜像；CDN 上传 18:50:23，镜像归档传输 18:50:58，部署前备份预发布库 19:00:07（宿主机 /root/yzgc-backups/preview-20261025-190007-375fba2f9cb5.db），deploy-stack 19:00:25，19:00:54 两个健康检查口均返回 ok
- 结果：release.json 0.1.1-rc.24@ac9f9e86b67a；预发布控制台的邮件模板页按新设计在真实模板数据上打开；回滚用 375fba2f9cb5（rc.23）镜像与 19:00:07 的库备份
- 下一步：rc.25 随 #294 发出；所有者在预发布验收

## 22:38:13 +08:00 · 发布 · #294 · 预发布 0.1.1-rc.25@02cb751c0b83（本机发版）

- 执行者：agent-claude-geek-main-completion（Claude Code，claude-sonnet-5-5）
- 做了什么：所有者 2026-10-23 决定[已脱敏]、2026-10-25 12:52 接手指令范围内；本机构建三个预发布镜像（stage 02cb751c），部署前把预发布库备份到宿主机 /root/yzgc-backups/preview-20261025-200551-ac9f9e86b67a.db，传输镜像后 compose up；tag v0.1.1-rc.25 指向 02cb751c0b830c0e686a180f6c6c5870c0c055ec，之后经临时克隆推到 GitLab（本地 pre-push 钩子要求 tag 的提交在本地 stage 上，没有绕过）；补发 #294 与 !32 的改后截图（桌面与手机）
- 结果：目标机 deploy-history.log 2026-10-25T12:06:36Z preview 02cb751c0b83 OK；release.json 0.1.1-rc.25@02cb751c0b83，builtAt 2026-10-25T11:30:34Z；三个预发布容器 healthy；回滚用 ac9f9e86b67a 的镜像与 20:05:51 的库备份
- 下一步：在 rc.25 上自测 A–G 并整理发布资料；正式版等所有者验收与批准

## 22:38:13 +08:00 · 发布 · #294 · 发布准备：整理 v0.1.1 正式版资料，没有发正式

- 执行者：agent-claude-geek-main-completion（Claude Code，claude-sonnet-5-5）
- 做了什么：所有者 2026-10-25 20:14 说「[已脱敏]」。在 rc.25 上做 A–G 共 40 项自测（evidence/V03-matrix.md）；迁移三套预演与回滚兼容预演并存证；本机试构建 yzgc-production 三个镜像（没有上传）；在候选提交上跑全套门禁；写 RELEASE-PACKET.md、ACCEPTANCE-OWNER-rc25.md、ACCEPTANCE-RECORD-FACTS.md
- 结果：门禁 15 个命令里 12 个直接通过，docs/INDEX.md 过期一行与 K10 两项不通过，vitest 2402 项通过 0 失败；没有打 v0.1.1、没有快进 main、没有部署正式环境、没有改正式环境的任何配置
- 下一步：等所有者定是否为 INDEX.md 一行出 rc.26，再在预发布验收；验收记录与「批准发布」之后才发正式

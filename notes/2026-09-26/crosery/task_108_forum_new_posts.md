# task/108/forum_new_posts · crosery · 2026-09-26

负责人：crosery

## 15:10:13 +08:00 · 开工 · #108 · 从 origin/stage 28122511456d 建 task/108/forum_new_posts

- 执行者：agent-claude-geek-main-08（Claude Code，claude-opus-5-5）
- 做了什么：node scripts/task.mjs start 108 forum_new_posts：建分支与 worktree .claude/worktrees/task-108，在 issue 上留开工记录
- 结果：worktree 已建好，issue 上已留开工记录

## 15:23:08 +08:00 · 方案 · #108 · 定位现网旧论坛库，工具改为在 task worktree 里也把私有数据放主工作区

- 执行者：agent-claude-geek-main-subagent-108（Claude Code 子代理）
- 做了什么：只读 ssh 核对：yangtzeu.work 的 nginx 仍反代 127.0.0.1:3000，由 systemd yzgc-admin 进程提供，它打开的库是 /opt/yzgc-admin/data/forum.db（WAL 2026-09-26 05:57Z 仍在写），布局与 09-13 相同；本机 Clash TUN 把这台机的 SSH 转到美国节点后在握手前被断开，改用 ssh -B en0 走本机网卡直连。capture/verify/prepare/normalize-assets/export-published 的私有目录改为按 git-common-dir 取主工作区的 .tools，相对路径也按主工作区解析；capture.py 加 --bind-interface
- 结果：python3 -m unittest test_capture test_prepare：13 项通过；worktree 里用旧快照 geek-20260913 重跑导出，app/forum 下无差异
- 下一步：用 capture.py 拉新快照到主工作区 .tools/forum-migration/20260926-*，verify、prepare，列出 09-13 之后的新帖逐篇审

## 15:50:38 +08:00 · 开发 · #108 · 增量采集、核验、投影，导出 t89

- 执行者：agent-claude-geek-main-subagent-108（Claude Code 子代理）
- 做了什么：capture.py --bind-interface en0 --timeout 3600 到主工作区 .tools/forum-migration/20260926-new-posts（第一次 240 秒超时、第二次为改成脱离会话运行而手动停止，两次半截归档已删，远端临时目录已确认清理）；verify.py；prepare.py --name geek-20260926；export-published.mjs geek-20260926 --fetch 两次
- 结果：采集 2026-09-26T07:30:15Z，334 文件 62,367,529 字节，归档 sha256 6992367e1bde…f23fe；verify 全部匹配、3 库 integrity ok；相对 09-13 只有 forum.sqlite 变（主题 87→89、用户 183→185）；投影 70 有效主题；09-13 后新主题 t89（公开，去掉第三方公益 API 密钥和原帖末尾被截断的半个链接）、t88（发帖人已删，不复活）；已公开 14 篇正文不变，只有 views 跟着变；两次导出 sha256 相同

## 15:50:38 +08:00 · 提交 · #108 · 迁移工具支持 task worktree、指定网卡与超时，导出拦 API 密钥

- 执行者：agent-claude-geek-main-subagent-108（Claude Code 子代理）
- 做了什么：提交 31047ec feat(tooling): 论坛迁移工具在 task worktree 里也用主工作区的私有目录
- 结果：python3 -m unittest test_capture test_prepare 13 项通过；vitest tests/tooling 220 项通过；根 pnpm check 通过

## 15:51:42 +08:00 · 提交 · #108 · 公开 t89，数据保全文档补这次采集与以后补新帖的步骤

- 执行者：agent-claude-geek-main-subagent-108（Claude Code 子代理）
- 做了什么：提交 d839390 feat(forum): 极客班论坛补上正式环境 09-13 之后的新帖 t89（含并入的 stage 暂存记录）
- 结果：forum.mjs check：Vitest 240 项通过；site 模式 generate 通过，有 t/t89.md、无 t5/t15；本机产物上重放 Dockerfile 断言通过；根 pnpm check 通过
- 下一步：等主 agent 决定 t78、t84 是否一起公开；不推送、不开 PR

# task/169/apply_limit · crosery · 2026-09-27

负责人：crosery

## 14:25:14 +08:00 · 开工 · #169 · 从 origin/stage 8bd6782e7361 建 task/169/apply_limit

- 执行者：agent-claude-geek-main-08（Claude Code，claude-opus-5-5）
- 做了什么：node scripts/task.mjs start 169 apply_limit：建分支与 worktree .claude/worktrees/task-169，在 issue 上留开工记录
- 结果：worktree 已建好；gh 不可用，issue 上的开工记录要手工补

## 14:45:19 +08:00 · 方案 · #169 · 防盗刷从信挪到投递，预发布发给所有人

- 执行者：agent-claude-geek-main-08（Claude Code，claude-opus-5-5）
- 做了什么：按所有者 14:20 的两句话：投递接口里按来源 IP（ipSubject，/64）和设备 cookie 各数 24 小时内成功的投递，满 5 份回 429；计数放新表 application_limits（服务端没有 ALTER TABLE 的先例，不改 applications）；查次数和写入放同一个同步事务。确认信只留全站每小时 200 封，理由是防换 IP 刷光额度后正式通知发不出去；发信队列按收件箱、按来源限量的选项保留（预发布的 mail_outbox 已经建好，limit_hash 不能为空）。预发布 MAIL_RECIPIENTS=all，去掉部署契约里预发布必须 allowlist。窗口选滚动 24 小时而不是永久：永久会让共用出口的校园网整个招新季投不了
- 结果：issue #169 写明取舍，所有者可以改

## 14:45:19 +08:00 · 开发 · #169 · 投递次数、确认信不限量、预发布发给所有人、发信并发测试

- 执行者：agent-claude-geek-main-08（Claude Code，claude-opus-5-5）
- 做了什么：apply.ts：APPLY_LIMITS、yugc_apply_device cookie、admit 事务、429 apply_limited；db.ts：application_limits；mailer.ts：RECEIVED_LETTER_LIMITS 只留 perHour 200；.env.preview、deployment-environment.mjs；测试：applications.test.ts 投递次数 4 条（含开着慢人机验证时 10 份并发正好收 5 份），mail-outbox.test.ts 改写上限用例、加并发 2 条（50 封同时来且发信商慢、一半阿里云失败换 Resend），legacy-database 表清单，deployment-environment 契约；文档 API、数据模型、mail.md、SECURITY 中英、TESTING、ENVIRONMENTS、CICD、portal.md、server 与 console README。所有者 14:35 问「并发会不会导致漏发邮件。这是不是要搞个队列之类的？」：已经是队列（mail_outbox + 单轮发信循环 + 原子领取 + 重试），补了并发测试
- 结果：变异 14 项都被抓到（投递次数 7 项、确认信按收件箱、预发布契约 2 项、两轮发信领同一封、新信不接着发、阿里云失败不换 Resend、查次数与写入之间有 await）。本机 harness（真实路由、临时库、假 Resend、官网生产构建）在 ego TaskSpace 11：同一邮箱同一 IP 先投 5 份，5 封都发，第 6 份信纸下显示「同一台设备或同一个网络 24 小时内最多投递 5 次，之前投的都已经收到了。」，没有第 6 封；harness 已按 PID 停，TaskSpace 已 finish

## 14:45:35 +08:00 · 提交 · #169 · 5d816f9、587585f、dee7820：按用途三个提交

- 执行者：agent-claude-geek-main-08（Claude Code，claude-opus-5-5）
- 做了什么：feat(server) 防盗刷改在投递这一步；fix(deploy) 预发布给所有投递人发信；test(server) 发信并发。mail.md、server README、mail-outbox.test.ts 两个提交都改，用 hash-object 加 update-index 分段写进暂存区（按文件实际的可执行位；第一次拆时把 deployment-environment.mjs 写成了 644，没推送，reset --mixed 后重拆）
- 结果：提交前 pnpm verify 退出码 0：根 60 个文件 921 条，论坛 541 条，build 与 forum generate 通过

## 14:45:35 +08:00 · 推送 · #169 · 推送 task/169/apply_limit

- 执行者：agent-claude-geek-main-08（Claude Code，claude-opus-5-5）
- 做了什么：git push -u origin task/169/apply_limit（SSH 443）
- 结果：见 PR 记录

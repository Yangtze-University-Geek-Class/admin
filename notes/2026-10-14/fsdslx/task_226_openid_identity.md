# task/226/openid_identity · fsdslx · 2026-10-14

负责人：fsdslx

## 17:55:51 +08:00 · 开工 · #226 · 从 origin/stage 471d3dbfda3e 建 task/226/openid_identity

- 执行者：agent-zcode-geek-main-01（ZCode，deepseek-flash）
- 做了什么：node scripts/task.mjs start 226 openid_identity：建分支与 worktree .claude\worktrees\task-226，在 issue 上留开工记录
- 结果：worktree 已建好，issue 上已留开工记录

## 18:02:39 +08:00 · 方案 · #226 · 身份地基：三张新表 + sessions 影子列 + GitHub 登录接入内部 OpenID

- 执行者：agent-zcode-geek-main-01（ZCode，deepseek-flash）
- 做了什么：读准现状后定方案：内部 OpenID 用 ULID（48 位毫秒 + 80 位随机，Crockford Base32，26 字符，lib/openid.ts），第三方 id 只作为凭据；新增 users/identities/identity_audit 三张表（IF NOT EXISTS，只新增不改已有表），sessions 加两个可空影子列 openid/provider（先读 PRAGMA 再 ALTER，保证幂等）。登录只在通过组织成员门槛之后才落身份并双写；存量回填用 console_seeds 标记做一次；回滚用独立脚本。按你的选择沿用仓库风格（不引入迁移框架）。
- 结果：两个未答复问题的处理（不臆测你的偏好，取最保守）：① 登录准入门槛不变，仍是只有 CONSOLE_ORG 的 active 成员能登录，是否放开属安全模型变更、留给所有者，已写进 issue 的「不做什么」；② CDN 那两个交付只做接口与文档、默认关闭、不接前端（issue #227）。
- 下一步：按方案实现并自测

## 18:02:39 +08:00 · 开发 · #226 · 实现落地：数据库、身份存储、登录接线、回填与回滚脚本

- 执行者：agent-zcode-geek-main-01（ZCode，deepseek-flash）
- 做了什么：改动：lib/db.ts（三张表 + sessions 影子列的幂等 ALTER）、lib/openid.ts（ULID）、lib/identity-store.ts（身份读写、审计、回填、回滚）、lib/auth.ts（Session 增 openid/provider，createSession 增可选身份参数）、routes/admin/auth.ts（过门槛后落身份 + 审计 + 作废旧 sid + 双写）、services.ts（装配身份存储与启动回填）、app/server/scripts/rollback-identity.mjs、tests/server/identity.test.ts、docs/architecture/IDENTITY.md 与四份既有文档。
- 结果：验证：pnpm exec vitest run tests/server 14 文件 280 用例全过（含既有 OAuth/组织权限/旧库升级用例）；app/server 的 tsc --noEmit 通过；docs-index --check、boundaries、doc-sync、notes、secrets、根 typecheck 全部通过（check-docs 只报本机既有的符号链接环境问题）。回滚脚本实测四种行为：dry run 只报告且库不变、--yes 后清影子列 1 行并丢掉三张表与标记、会话旧列 login/user_id 完好、重复执行报「没有可回滚的内容」、相对路径被拒（rc=2）。
- 下一步：提交并推送

## 18:02:39 +08:00 · 提交 · #226 · 身份地基一次提交（代码+测试+文档+脚本）

- 执行者：agent-zcode-geek-main-01（ZCode，deepseek-flash）
- 做了什么：feat(server): 登录身份改为内部 OpenID，第三方账号只作为凭据（地基阶段）；改动 11 个文件，含三张新表、影子列、身份存储、登录接线与 sid 轮换、回填、回滚脚本、单测与文档。
- 结果：提交前门禁：tests/server 280/280、tsc、docs-index、boundaries、doc-sync、notes、secrets、typecheck 全过；文档索引已重新生成（docs/architecture/IDENTITY.md 进索引）。

## 18:40:11 +08:00 · PR · #226 · 开 PR #229（fork 提出，目标 stage）

- 执行者：agent-zcode-geek-main-01（ZCode，deepseek-flash）
- 做了什么：以九段正文契约写 PR #229：https://github.com/Yangtze-University-Geek-Class/admin/pull/229，目标 stage，来源 FsdsLx:task/226/openid_identity。验收证据段写「无界面变化」（本次只改服务端与文档）。同时在 #226 上记录了需求方的两条决定（准入不变、第二渠道选微信及其只能走绑定路径的硬约束），并开了 P1 issue #228（绑定/解绑/合并 + step-up）。
- 结果：PR 已创建，分支已推到 fork（本账号对该仓库只有读权限，只能走 fork）。
- 下一步：等 CI 与维护者审查；微信渠道排在 #228 之后

## 19:53:50 +08:00 · 审查 · #226 · 审查结论：有条件通过（审查人 = 本 agent，不是人工验收）

- 执行者：agent-zcode-geek-main-01（ZCode，deepseek-flash）
- 做了什么：按 .agents/skills/code-review/SKILL.md 逐项审查 task/226/openid_identity（被审提交 b9da457，对 471d3db，17 文件 +777/−15），结论以 kind=review 发在 PR #229。审查人明确是 agent-zcode-geek-main-01，不等于人工试用与发布批准。本次重点核对了唯一的表结构变更：只新增三表 + sessions 两个可空列、ALTER 幂等、回填单事务且幂等、回滚脚本实测。
- 结果：逐项：分支不变量 0、base=stage 无直推 main、secrets 0 且 identities.raw 一律 NULL、.env 与镜像 compose 未改、docs-index 与 doc-sync（CI 同命令）通过、boundaries 通过、提交信息合规、无旧模型残留、官方仓库无 task/226 分支、未改工作流、未改 package.json 与锁文件、note check --pr --for-review 通过（66 链路）。两条建议：影子列只写不读要留给 P1 决定何时切换；app_state 的版本概念与 P1 一起定。未验证 5 条：未在真实库副本验证回填（最该补）、无真实 OAuth 端到端、未做预发布验收、本机 check-docs 符号链接环境问题、微信与绑定合并不在本 PR。结论：有条件通过。
- 下一步：推送让 CI 执行记录检查转绿

# task/190/api_doc_drift · crosery · 2026-10-02

负责人：crosery

## 21:59:21 +08:00 · 开工 · #190 · 从 origin/stage 2075c553e734 建 task/190/api_doc_drift

- 执行者：agent-claude-geek-main-1002（Claude Code，claude-opus-5-5）
- 做了什么：node scripts/task.mjs start 190 api_doc_drift：建分支与 worktree .claude/worktrees/task-190，在 issue 上留开工记录
- 结果：worktree 已建好，issue 上已留开工记录

## 22:23:03 +08:00 · 开发 · #190 · 逐条对着 2075c55 的 app/server 核实并改 API.md

- 执行者：agent-claude-geek-main-subagent-190（Claude Code 子代理，claude-opus-5-5）
- 做了什么：读 #190 表格 8 条与 #191；对照 app/server/src 重新定位行号；临时探针用 buildApp+inject 实测 429/request_id/409/摘要/长度/per_page/410/安全头/dependabot.error（探针没入库，输出存 /private/tmp/geek-evidence/190/probe-2075c55.txt）；改 docs/architecture/API.md
- 结果：8 条都属实；第 2 条实测是五处不是三处：除 export.csv、assignments、join 外，POST /api/feedback 与 POST /api/portal/apply 的 429 也是 request_error（apply.ts 的 errorResponseBuilder 返回普通对象，错误处理器只读 code）；另把 strengths_excerpt 的最长 121、merge_failed 回 GitHub 原文写进文档。docs/services/server/README.md 不用改（#190 期望保持不变，app/server 没动）

## 22:23:03 +08:00 · 提交 · #190 · API 手册按 server 实现改正 8 处不符

- 执行者：agent-claude-geek-main-subagent-190（Claude Code 子代理，claude-opus-5-5）
- 做了什么：docs(docs): API 手册按 server 实现改正 #190 列出的 8 处不符；pnpm check；vitest forum/invitations/upstream-errors/applications
- 结果：pnpm check 通过（文档同步通过，按 PR 核对；执行记录通过）；4 个测试文件 100 passed；docs-index --check 最新

## 22:29:07 +08:00 · 开发 · #190 · ego 浏览器本机核对 6e4edfadd1bb

- 执行者：agent-claude-geek-main-subagent-190（Claude Code 子代理，claude-opus-5-5）
- 做了什么：本机起核心服务 127.0.0.1:5521（内存库）与 portal vite 5520（/api 转 5521），ego TaskSpace 224：/sites/portal/docs?__data=live 只列项目介绍、使用指南，GET /api/docs/api 404（API.md 不在 DOC_FILES 白名单，不对外渲染）；页面内实发 410/401/429 请求；本机用 marked 渲染 HEAD 的 API.md 截改动段落
- 结果：6 张截图存 /private/tmp/geek-evidence/190/（01、03–07）；export.csv、join、feedback 第 N+1 次 429 是 request_error + 英文，apply 是 request_error + 中文，论坛 search 是 rate_limited；410 体无 request_id；每个响应都带 nosniff / DENY / strict-origin-when-cross-origin；渲染后 410 行 5 列、429 表 6 行 3 列；TaskSpace 已 finish，5520–5522 上自己起的进程已关

## 22:29:07 +08:00 · 提交 · #190 · 补记本机浏览器核对

- 执行者：agent-claude-geek-main-subagent-190（Claude Code 子代理，claude-opus-5-5）
- 做了什么：docs(notes): 记录 #190 本机浏览器核对；node scripts/note.mjs check
- 结果：执行记录检查通过

## 22:57:06 +08:00 · 返工 · #190 · 按独立审查 R190-1、R190-6 改 API.md 的 join 400 与测试引用

- 执行者：agent-claude-geek-main-subagent-190（Claude Code 子代理，claude-opus-5-5）
- 做了什么：R190-1：API.md 端点清单 POST /api/join/:token 的 400 拆成两种：Schema 校验（routes/portal/contracts.ts，在找链接之前）回 validation_error + Ajv 英文 message + request_id；路由自己判断的（蜜罐、PoW、用户名和邮箱都没填、格式不对、Turnstile、已知失败）回 { error: <中文句子> }。R190-6：state 说明里的「测试「关注列表对所有人公开」」改成 tests/server/forum.test.ts 的 toggles follows, refuses self-follows and notifies once 用例。临时探针 zz_probe_190r.test.ts（buildApp + inject，每次换来源 IP 避开限流，未入库，跑完已移到 /private/tmp/geek-evidence/190/rework/）
- 结果：探针 17 条：未知字段、github_login 40、email 255、note 281、pow 缺 nonce、nonce 33、timestamp 是字符串、github_login 是数字、website 201、链接不存在时带未知字段都回 400 validation_error 带 request_id；都没填、用户名格式、邮箱格式、蜜罐、缺 PoW 回 400 中文句子，没有 request_id；链接不存在 404；同一 IP 第 6 次 429 request_error。文档核对：docs/services/server/ 不用改——本轮只改 docs/architecture/API.md 与执行记录，app/server 没动
- 下一步：pnpm check 后提交；R190-2、R190-3、R190-7、R190-8 要发到 GitHub 的记录与 issue 草稿交主控

## 22:57:45 +08:00 · 提交 · #190 · 提交 join 400 两种形状与测试引用的返工

- 执行者：agent-claude-geek-main-subagent-190（Claude Code 子代理，claude-opus-5-5）
- 做了什么：docs(docs): API 手册写清 join 的两种 400，改正关注列表的测试引用；pnpm check；npx vitest run tests/server/invitations.test.ts tests/server/forum.test.ts
- 结果：pnpm check exit 0（文档同步通过：6 组模块与文档，按 PR 核对（对 origin/stage）；执行记录通过：45 条链路；docs/INDEX.md 是最新的）；2 个测试文件 70 passed

## 23:05:39 +08:00 · 返工 · #190 · ego 浏览器本机核对 d33b25aa2a59 的 join 两种 400，按 R190-5 重截渲染图

- 执行者：agent-claude-geek-main-subagent-190（Claude Code 子代理，claude-opus-5-5）
- 做了什么：本机起核心服务 127.0.0.1:5521（task/190 worktree，文件库在 /private/tmp/geek-evidence/190/rework/，插入测试链接 probe190）与静态服务 5522；ego TaskSpace 233 在 http://127.0.0.1:5521/healthz 页面里同源 fetch POST /api/join/probe190 五种请求；用 marked GFM 渲染 d33b25aa2a59 的 API.md（顶部固定快照标注、单元格可折行），重截 04–07 并新截 09（join 一行）
- 结果：未知字段、github_login 40 个字符回 400 validation_error + Ajv 英文 + request_id；蜜罐、PoW 不对、PoW 对但用户名和邮箱都没填回 400 中文句子、没有 request_id（截图 08）；渲染页 scrollWidth 1317 等于视口宽度，410 一行「主要错误」列完整（07）；6 张图都带「本机·未发布 @d33b25aa2a59（0.1.1 预发布队列）」；6e4edfa 的旧 04–07 移到 superseded-6e4edfa/；TaskSpace 233 已 finish，5521、5522 上自己起的进程已关

## 23:06:07 +08:00 · 提交 · #190 · 提交返工后的浏览器核对记录

- 执行者：agent-claude-geek-main-subagent-190（Claude Code 子代理，claude-opus-5-5）
- 做了什么：docs(notes): 记录 #190 返工后的本机浏览器核对；node scripts/note.mjs check
- 结果：执行记录检查见本条之后的 node scripts/note.mjs check 输出；只改 notes/

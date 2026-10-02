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

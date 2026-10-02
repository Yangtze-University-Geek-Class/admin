# task/191/rate_limited_body · crosery · 2026-10-02

负责人：crosery

## 21:59:15 +08:00 · 开工 · #191 · 从 origin/stage 2075c553e734 建 task/191/rate_limited_body

- 执行者：agent-claude-geek-main-1002（Claude Code，claude-opus-5-5）
- 做了什么：node scripts/task.mjs start 191 rate_limited_body：建分支与 worktree .claude/worktrees/task-191，在 issue 上留开工记录
- 结果：worktree 已建好，issue 上已留开工记录

## 22:11:01 +08:00 · 提交 · #191 · 路由级限流超额统一回 429 rate_limited，补回归测试与文档

- 执行者：agent-claude-geek-main-subagent-191（Claude Code 子代理，claude-opus-5-5）
- 做了什么：fix(server)：middleware/http-policy.ts 新增 rateLimited()（论坛 viewer.ts 改为转出它），app.ts 注册 @fastify/rate-limit 时设为默认 errorResponseBuilder；去掉 apply.ts 自带的普通对象 builder（错误处理器只认 code，它实际回的是 request_error）；新增 tests/server/rate-limits.test.ts（join、export.csv、assignments、apply、feedback 各自超额）；同步 docs/architecture/API.md 四行错误列与投递 429 说明、docs/services/server/README.md「限流」、docs/conventions/TESTING.md
- 结果：改前同一测试 5 条全失败（error 是 request_error）；改后 vitest run tests/server：11 files 245 passed；pnpm check 退出 0（Boundaries passed、文档同步通过、执行记录通过）
- 下一步：本机起真实 server 在 ego 里对 POST /api/join/<假 token> 截改前改后两张图

## 22:14:15 +08:00 · 开发 · #191 · 本机真实 server + ego 浏览器核对 POST /api/join 超额的 429，改前改后各一张

- 执行者：agent-claude-geek-main-subagent-191（Claude Code 子代理，claude-opus-5-5）
- 做了什么：git archive 2075c55 与 bc43c04 的 app/server 各自 tsc 构建，用 buildApp 起真实服务（临时库、GitHub/HTTP/发信一律拒绝，PUBLIC_ORIGIN 为本机页面地址）在 127.0.0.1:5511（改前）与 5512（改后）；ego TaskSpace 221 打开本机核对页，在页面里 fetch POST /api/join/evidence-fake-token 连发 7 次并把状态码与响应体渲染到页面截图；之后 finish TaskSpace、停掉两个服务进程、删掉临时库
- 结果：改前：第 1–5 次 404，第 6、7 次 429 {error:request_error, message:Rate limit exceeded, retry in 1 minute, request_id:req-9/req-a}；改后：第 1–5 次 404，第 6、7 次 429 {error:rate_limited, message:操作太频繁，请稍后再试, request_id:req-a/req-b}；截图 before-join-429.png、after-join-429.png（1317×998，贴进 PR「验收证据」）；本机未发布，不是预发布验收

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

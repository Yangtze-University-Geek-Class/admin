# task/128/session_cleanup · lysnowq · 2026-10-02

负责人：lysnowq

## 16:42:43 +08:00 · 开发 · #128 · 过期会话主动清理：清理函数、每小时定时器与生命周期开关

- 执行者：agent-omp-issue-128（OMP，代表 LYsnowQ）
- 做了什么：app/server/src/lib/auth.ts 新增 cleanupExpiredSessions()（按 expires_at 批量 DELETE、返回删掉条数）与 startCleanup/stopCleanup（启动时清一次、之后每小时一次，计时器 unref，出错只记日志），createSession/getSession 改用注入的时钟；services.ts 把 ServiceOverrides.clock 同时传给 createAuth，close() 停掉清理；app.ts 新增 sessionCleanup 开关（onReady 启动、onClose 停止），index.ts 打开；tests/server/session-cleanup.test.ts 新增 5 个用例；docs/services/server/README.md、data-model.md 与 docs/architecture/SECURITY.md 写明会话行最长保留 7 天加一个清理间隔
- 结果：corepack pnpm exec vitest run tests/server/session-cleanup.test.ts：把 src 暂存回修复前 4 failed/1 passed，修复后 5 passed；corepack pnpm exec vitest run tests/server：11 files、245 passed；corepack pnpm check 通过（doc-sync 按 PR 对 origin/stage）；corepack pnpm --filter @yzgc/server build 退出 0

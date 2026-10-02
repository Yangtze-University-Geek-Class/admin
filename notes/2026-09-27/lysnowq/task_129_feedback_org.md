# task/129/feedback_org · lysnowq · 2026-09-27

负责人：lysnowq

## 00:30:57 +08:00 · 开发 · #129 · 先写的回归测试已落地、未提交，修复没开始，中断（补记）

- 执行者：agent-omp-geek-main-26（omp，claude-opus-5-5）
- 做了什么：补记：开工后在 worktree 写了 tests/server/feedback-org.test.ts（4 条：组织名不分大小写落成 CONSOLE_ORG 的写法、别的组织 400 不落库、公开列表只按 CONSOLE_ORG 查、启动时把旧数据改成规范写法），之后会话中断；本条为 00 点后补记
- 结果：worktree HEAD 6254304，文件未跟踪；00:1x 在 worktree 里跑 vitest tests/server/feedback-org.test.ts：4 failed（修复前应失败，预期内）；服务端代码没改
- 下一步：从最新 stage（c8e7648）合并后再实现修复

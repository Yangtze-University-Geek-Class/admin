# task/298/issue_gate_evidence_loop · yuminghuang738 · 2026-10-29

负责人：yuminghuang738

## 14:43:08 +08:00 · 开工 · #298 · 从 origin/stage 9438af8b3f04 建 task/298/issue_gate_evidence_loop

- 执行者：agent-dsh-geek-main-sonnet（DeepSeek Harness，claude-sonnet-5-5-high）
- 做了什么：node scripts/task.mjs start 298 issue_gate_evidence_loop：建分支与 worktree .claude/worktrees/task-298，在 issue 上留开工记录
- 结果：worktree 已建好，issue 上已留开工记录

## 14:55:05 +08:00 · 开发 · #298 · 修 needs-evidence 死锁：区分开工门禁与 issue-gate 两个调用方

- 执行者：agent-dsh-geek-main-sonnet（DeepSeek Harness，claude-sonnet-5-5-high）
- 做了什么：checkIssue 增加 ignoreEvidenceLabel 选项与 evidenceLabeled 返回值；issue-gate 传 true 并如实展示标签状态；tests/tooling/issue-labels.test.ts 加三条回归；ISSUES.md 与 CICD.md 记录循环依赖
- 结果：issue-labels 测试 27 条通过、连同 task-worktree 共 37 条；把开关关掉后实测 1 条失败（expected false to be true），恢复后全绿
- 下一步：提交、推 fork、开 PR

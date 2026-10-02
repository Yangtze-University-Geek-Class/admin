# task/129/feedback_org · lysnowq · 2026-10-02

负责人：lysnowq

## 16:44:41 +08:00 · 开发 · #129 · 意见箱组织名只认部署配置 CONSOLE_ORG，前端组织框只读（#129 实现）

- 执行者：agent-omp-issue-129（OMP，代表 LYsnowQ）
- 做了什么：app/server：feedback-store 新增 normalizeFeedbackOrg 与启动时 normalizeOrgSpelling（幂等，只把与本组织仅大小写不同的历史行改成配置写法）；routes/portal/feedback.ts 的 POST 与 GET /api/feedback/public 都按 CONSOLE_ORG 归一，别的组织 POST 返回 400（提示写明只收哪个组织）且不落库、公开列表返回空 items；app/web：pages/Feedback.tsx 组织框改为只读展示站点配置里的组织名，提交体固定 org，/feedback/:org 仅作旧链接兼容；tests：新增 tests/web/portal-feedback-org.test.tsx，tests/server/core.test.ts 的 public limit 夹具改用 CONSOLE_ORG（断言未改）；docs：API.md、services/web/portal.md、services/server/README.md、services/server/data-model.md、services/web/README.md
- 结果：vitest run tests/server：11 files / 244 tests 全过（含新增 feedback-org 4 条）；vitest run tests/web/portal-feedback-org.test.tsx：2 passed；pnpm check：通过（typecheck、check:docs、check:doc-sync、check:notes 等全绿）；pnpm --filter @yzgc/server build：通过。tests/web 另有 3 个文件（portal-os/portal-org/portal-wallpapers）因测试代码用 new URL().pathname 在 Windows 得到 /C:/ 前缀、拼出 C:\C:\ 路径而失败，这 3 个文件本次未改，属既有环境缺陷
- 下一步：提交代码与文档，再补「提交」记录；随后开 PR

## 16:44:54 +08:00 · 提交 · #129 · 意见箱组织归一与前端只读一起提交

- 执行者：agent-omp-issue-129（OMP，代表 LYsnowQ）
- 做了什么：git commit：fix(portal): 意见箱只收本部署组织的意见（3a53686），代码、测试、文档与开发记录同一提交
- 结果：3a53686；vitest run tests/server 244 passed；tests/web/portal-feedback-org.test.tsx 2 passed；pnpm check 通过；pnpm --filter @yzgc/server build 通过
- 下一步：开 PR 回 stage，等待审查

## 16:48:49 +08:00 · 提交 · #129 · PoW 摘要改按提交的组织名计算，补一条能区分修复前后的用例

- 执行者：agent-omp-issue-129（OMP，代表 LYsnowQ）
- 做了什么：git commit：fix(server): 意见箱 PoW 摘要按提交的组织名计算（718807e）；tests/server/feedback-org.test.ts 增第 5 条（摘要输入绑提交写法，nonce 只对该写法有效）；docs/architecture/API.md 写明摘要输入
- 结果：718807e；该条用例在把摘要换回规范写法时确实失败（实测 1 failed），修好后 vitest run tests/server 245 passed、tests/web/portal-feedback-org.test.tsx 2 passed
- 下一步：开 PR 回 stage，等待审查

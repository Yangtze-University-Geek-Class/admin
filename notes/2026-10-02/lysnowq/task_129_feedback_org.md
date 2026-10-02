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

## 16:52:06 +08:00 · PR · #129 · 开 PR #182 指向 stage，附前后截图与独立复现

- 执行者：agent-omp-issue-129（OMP，代表 LYsnowQ）
- 做了什么：gh pr create：base=stage、head=task/129/feedback_org；正文九段含解决链路、修复前后对照（stage 源码 7/7 失败 → 修复版 7/7 通过）、整套服务端 245 条、各步 check、真实浏览器只读验证、人工验收步骤与十二项自审；新增 docs/assets/feedback-org/ 两张 webp
- 结果：PR https://github.com/Yangtze-University-Geek-Class/admin/pull/182
- 下一步：补「审查」记录并重推，等 PR CI

## 16:52:06 +08:00 · 审查 · #129 · 自审通过：组织名以 CONSOLE_ORG 为准、前端去掉可改入口

- 执行者：agent-omp-issue-129（OMP，代表 LYsnowQ）
- 做了什么：按 CODE-REVIEW 十二项核对 2289fcb：分支合规、无密钥/环境变量/镜像改动、7 条新用例可区分修复前后、五份文档同步、边界 202文件1152导入、提交规范、无旧模型；危险操作面已核对（无 schema 变更、启动归一事务+幂等、只动大小写变体、公开列表收窄不删历史行）；执行记录连续、未合并不清理；core.test.ts 仅换夹具组织名未删断言
- 结果：无阻塞与未决应修；结论：通过（PR 正文同名小节）
- 下一步：等 PR CI；合并后按任务清理流程收尾

## 20:14:56 +08:00 · 返工 · #129 · 意见箱的组织名改由服务端下发（审查 F3）

- 执行者：agent-claude-geek-main-subagent-129（Claude Code 子代理，claude-opus-5-5，Crosery 一方接手）
- 做了什么：独立审查 F3：页面的组织名取 app.config.json urls.githubOrg，服务端只认 CONSOLE_ORG，两处没对照，不一致时每次提交都 400、提交者改不了。改为 GET /api/feedback/categories 多下发 org（=CONSOLE_ORG 配置写法），Feedback.tsx 照它展示、读公开列表、算 PoW 摘要和提交；接口回来前或失败时仍用 githubOrg 最后一段；读列表的 effect 加了先发后到不覆盖的保护；mock 数据同步带 org；App.tsx 路由注释写明 /feedback/:org 是控制台意见箱生成的分享地址（F8）。文档：API.md 的 categories 一行、portal.md 的 /feedback 一行同步。否决了在 check-site-config / check:environments 里强制 githubOrg 等于 CONSOLE_ORG：服务端下发之后意见箱不再依赖两处一致，强制相等会给与本 issue 无关的 GitHub 链接加约束
- 结果：新增 2 条用例（tests/server/feedback-org.test.ts 1 条、tests/web/portal-feedback-org.test.tsx 1 条）；把 app/ 换回改动前时这 2 条失败、其余 7 条通过（Tests 2 failed | 7 passed (9)），恢复后 Tests 9 passed (9)；tsc server=0 web=0（Node 22.23.2）

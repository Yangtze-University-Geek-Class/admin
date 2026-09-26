# task/111/fetch_stall_timeout · crosery · 2026-09-26

负责人：crosery

## 15:23:16 +08:00 · 开工 · #111 · 从 origin/stage 28122511456d 建 task/111/fetch_stall_timeout

- 执行者：agent-omp-geek-main-26（omp，claude-opus-5-5）
- 做了什么：node scripts/task.mjs start 111 fetch_stall_timeout：建分支与 worktree .claude\worktrees\task-111，在 issue 上留开工记录
- 结果：worktree 已建好，issue 上已留开工记录

## 15:38:16 +08:00 · 方案 · #111 · 本机复现单段挂住时下载永不返回

- 执行者：agent-omp-geek-main-26（omp，claude-opus-5-5）
- 做了什么：一次性脚本注入 fetchImpl：16KiB 分 4 段，第 2 段 206 后 body 永不结束，观察 20 秒
- 结果：fetchArtifact 20 秒后仍 pending，卡住段只请求 1 次未重试；已在 #111 留复现记录 issuecomment-5844317823
- 下一步：写修复前失败的 tests/tooling/fetch-artifact.test.ts 用例

## 15:49:37 +08:00 · 开发 · #111 · fetchRange 加空闲超时，卡住的段断开重试

- 执行者：agent-omp-geek-main-26（omp，claude-opus-5-5）
- 做了什么：先加 3 条用例（首次卡住后重试成功、一直卡住有限时间失败、慢但一直有数据不误杀）+ --idle-seconds 参数校验，旧代码上跑；再改 scripts/fetch-artifact.mjs：每次尝试独立 AbortController 与共享 signal 用 AbortSignal.any 合并，取地址、等响应头、读每块前重置 idleMs（默认 60 秒）计时，finally 清计时并断开；CICD.md 下载镜像归档一行补说明
- 结果：修复前 3 failed / 8 passed（两条卡住用例 3000ms 超时，--idle-seconds 不认识）；修复后 pnpm exec vitest run tests/tooling/fetch-artifact.test.ts 11 passed；本机 undici 真实 http 服务冒烟：首次无 body、二次无响应头、三次正常，idleMs=300 时 643ms 取回；未在真实 GitHub 存储与部署容器里验证
- 下一步：合入最新 stage 后跑 pnpm verify，申请提交与开 PR

## 16:01:15 +08:00 · 开发 · #111 · 本机门禁：改动不新增失败

- 执行者：agent-omp-geek-main-26（omp，claude-opus-5-5）
- 做了什么：pnpm check 各步（docs-index 除外）、pnpm test 全量、pnpm build；并在未改动的 stage 主工作区跑同一全量对比失败集合
- 结果：check-docs/check-notes/check-secrets/typecheck 通过；pnpm build 通过；vitest 本分支 25 failed / 431 passed，stage 基线 25 failed / 428 passed，失败集合逐条相同（Windows 路径分隔符与 bash 部署脚本用例、docs-index 在 Windows 生成反斜杠路径），与本改动无关；forum:check/generate 需 Node>=26，本机未装，未验证
- 下一步：开 PR 前请所有者授权提交与推送；CI（Linux）上跑完整 verify

## 16:42:00 +08:00 · 提交 · #111 · 提交修复 db13574

- 执行者：agent-omp-geek-main-26（omp，claude-opus-5-5）
- 做了什么：git commit db13574 fix(deploy): fetch-artifact 一段卡住不报错时按空闲超时断开重试（所有者授权提交、推送、开 PR）
- 结果：提交含 scripts/fetch-artifact.mjs、测试、CICD.md 一行与本链路；fetch-artifact 测试 11 passed，全量失败集合与 stage 基线相同

## 16:44:22 +08:00 · PR · #111 · 开 PR #119 到 stage

- 执行者：agent-omp-geek-main-26（omp，claude-opus-5-5）
- 做了什么：git push -u origin task/111/fetch_stall_timeout（本地 check-branch-invariants --push 通过）；gh pr create #119，正文按 PULL-REQUESTS 九段
- 结果：https://github.com/Yangtze-University-Geek-Class/admin/pull/119；等待 Crosery 审查
- 下一步：收到审查结论后补「审查」记录

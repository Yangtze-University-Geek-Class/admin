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

## 22:30:51 +08:00 · 返工 · #191 · 按独立审查意见 F3、F4 返工：去掉 topics.ts 重复的 errorResponseBuilder，rateLimited() 注释写明不处理 ban

- 执行者：agent-claude-geek-main-subagent-191（Claude Code 子代理，claude-opus-5-5）
- 做了什么：F3：routes/forum-api/topics.ts 的 perIp 去掉 errorResponseBuilder: () => rateLimited()，和 app.ts 注册的默认值重复，与 docs/services/server/README.md「路由不另写」对不上，注释改成写明用的是 app.ts 的默认值；F4：middleware/http-policy.ts 的 rateLimited() 注释补「不看 respCtx、不处理 ban，插件 ban 时给 403，用它仍回 429；以后要配 ban 时让 builder 按 respCtx.ban 回 403」。F1、F2 改 PR 正文与证据，见下一条。文档核对：docs/services/server/ 不用改——README「限流」写的就是默认 builder、路由不另写，这次删掉 topics.ts 那一项是让代码跟上文档；rateLimited() 只加注释，接口行为不变
- 结果：pnpm exec vitest run tests/server/forum.test.ts tests/server/rate-limits.test.ts：2 files 65 passed（论坛 state、话题浏览等按 IP 限流的 429 rate_limited 断言照常通过）；pnpm exec vitest run tests/server：11 files 245 passed；pnpm check 退出 0（Boundaries passed: 202 files、文档同步通过、执行记录通过）
- 下一步：提交后用改后提交重建 app/server，在 ego 里对真实 /feedback 与 /join/<token> 页面截改前改后（桌面与 390px）

## 22:42:25 +08:00 · 返工 · #191 · 按审查意见 F1、F2 返工：在真实的邀请页与意见箱上截改前改后（桌面与 390px），改 PR 正文第 4 步

- 执行者：agent-claude-geek-main-subagent-191（Claude Code 子代理，claude-opus-5-5）
- 做了什么：F1：git archive 2075c55 与 55d2e60 的 app/server 各自 tsc 构建，pnpm --filter @yzgc/web build 出官网产物（两提交之间 app/web 没有改动），用 buildApp 起真实服务托管官网产物，127.0.0.1:5511 改前、5512 改后；临时库里放一条虚构邀请链接，GitHub、HTTP、发信一律拒绝；ego TaskSpace 228 打开真实的 /join/evidence191invite，用户名填 geek_191（格式不对）连点 6 次「发邀请给我」，再打开真实的 /feedback 连续提交 11 次，桌面 1317×998 与 390×844 手机各截一张；服务端每个写请求的状态码打到日志。另用 curl 对两套服务各打一遍，记下 429 的原始响应体。F2：PR 正文第 4 步改成在控制台 DevTools 里 fetch export.csv 6 次，写明每次 200 都记一条 application.export 审计；验收证据删掉「无界面变化」，写明两页的提示从英文变成中文
- 结果：改前：邀请页第 1–5 次 400「GitHub 用户名格式无效」、第 6 次 429，页面显示「Rate limit exceeded, retry in 55 seconds」（手机 56 seconds）；意见箱第 1–10 次 200、第 11 次 429，显示「Rate limit exceeded, retry in 40 seconds」。改后：同样的次数，两页第 6、11 次都显示「操作太频繁，请稍后再试」。curl：改前 429 {error:request_error, message:Rate limit exceeded, retry in 1 minute}，改后 429 {error:rate_limited, message:操作太频繁，请稍后再试, request_id}。截图 before|after-join|feedback-desktop|mobile.png 共 8 张，已逐张看过；TaskSpace 228 已 finish，四个服务进程已停、临时库已删。顺带看到：邀请页在 390px 下 .pt-invite 右边到 392px，页面横向多出 2px（stage 2075c55 的 app/web 同样，和本次无关，未修）。本机未发布，不是预发布验收

## 23:29:30 +08:00 · 审查 · #191 · 两轮独立审查：f0d1fad、5d41b90 均有条件通过

- 执行者：agent-claude-geek-main-1002（Claude Code，claude-opus-5-5，代 Crosery）
- 做了什么：Claude Code 独立审查子代理（claude-opus-5-5）代 Crosery 只读审查。第一轮被审 f0d1fad：应修 F1（正文先写无界面变化又写邀请页、意见箱提示会变，且只有接口截图）、F2（人工验收第 4 步用导出按钮验不出来）；建议 F3（topics.ts 重复写 errorResponseBuilder）、F4（rateLimited() 不看 respCtx，ban 时仍回 429）。第二轮被审 5d41b90：F1–F4 已处理属实；建议 F5（API.md 端点清单开头一句说论坛自己数次数的限流都抛 rateLimited()，但全站游客回复上限抛的是 guest_replies_paused）
- 结果：两轮都没有阻塞；F1–F4 在 55d2e60 与 PR 正文返工，F5 下一条记录返工

## 23:29:31 +08:00 · 返工 · #191 · API.md 写窄论坛哪些 429 回 rate_limited（第二轮审查 F5）

- 执行者：agent-claude-geek-main-1002（Claude Code，claude-opus-5-5，代 Crosery）
- 做了什么：docs/architecture/API.md 端点清单开头：「论坛自己数次数的限流抛的也是它」改成「论坛自己按人、按 IP 数次数的限流（发帖、回复、头像）抛的也是它；全站游客回复的总量上限不是限流，另回 429 guest_replies_paused」。核对代码：rateLimited() 只在 topics.ts:55、people.ts:76、posts.ts:46、posts.ts:61 抛，guest_replies_paused 来自 viewer.ts:59 的 guestRepliesPaused()
- 结果：提交 1792d23（只改 API.md 一句）；pnpm check:doc-sync 通过、check-docs 272 篇通过

## 23:29:31 +08:00 · 提交 · #191 · 提交 1792d23 并合入 stage a18616a

- 执行者：agent-claude-geek-main-1002（Claude Code，claude-opus-5-5，代 Crosery）
- 做了什么：1792d23 docs(api): 写准论坛哪些自己计数的 429 回 rate_limited（Refs #191）；ef00e8f 把 origin/stage a18616a（#182 合入后）合进来，冲突只在 docs/architecture/API.md 的意见箱三行：取 stage 一侧（#129 的说明），在 POST /api/feedback 错误列末尾补回本分支的 429 rate_limited；notes/INDEX.md 用 note.mjs index 重新生成
- 结果：合并后（Node 22.23.2）：pnpm check:doc-sync 通过、check-docs 272 篇、docs-index 最新；vitest run tests/server 12 个文件 253 passed；vitest run tests/web 19 个文件 141 passed。1792d23 与 ef00e8f 改了 notes/ 以外的文件，送增量审查

## 23:39:46 +08:00 · PR · #191 · 开 PR #197 指向 stage

- 执行者：agent-claude-geek-main-1002（Claude Code，claude-opus-5-5，代 Crosery）
- 做了什么：gh pr create --base stage --head task/191/rate_limited_body，正文九段，8 张改前改后截图（ego，桌面 1317×998 与 390×844，快照写在图注里）已上传为 GitHub 附件；审查结论一节暂写待审查、结论：阻塞，等第三轮增量审查（4d29300）结论后替换
- 结果：本机 pr-contract check 通过；PR https://github.com/Yangtze-University-Geek-Class/admin/pull/197

## 23:40:43 +08:00 · 审查 · #191 · 第三轮独立审查 4d29300：有条件通过

- 执行者：agent-claude-geek-main-1002（Claude Code，claude-opus-5-5，代 Crosery）
- 做了什么：独立审查子代理只读审 5d41b90..4d29300：F5 改对；ef00e8f 非冲突路径与 stage 一侧 patch-id 相同，API.md 冲突两边都保留；#129 合入后 rate-limits 的意见箱用例仍测限流（临时探针：合法组织 10 次 200 后第 11 次 429 rate_limited）；基线换成 a18616a 后新用例 5 条全失败；tests/server + tests/web 31 个文件 394 passed；pnpm check 退出 0
- 结果：没有阻塞和应修；建议 F6 API.md:23「不是限流」和 forum-rules.ts:33-39、API.md:102 对不上；F7 1792d23 的 scope api 不在词表、记录没跟改动同一提交（不回写历史，本次起照做）；F8 证据 5–8 截于 #129 合入前；F9 正文 pnpm check 停在 5d41b90。F6 在本提交改，F8、F9 改正文

## 23:40:43 +08:00 · 返工 · #191 · API.md 去掉「不是限流」半句（第三轮审查 F6）

- 执行者：agent-claude-geek-main-1002（Claude Code，claude-opus-5-5，代 Crosery）
- 做了什么：docs/architecture/API.md:23「全站游客回复的总量上限不是限流，另回 429 guest_replies_paused」改成「全站游客回复的总量上限另回 429 guest_replies_paused」：forum-rules.ts 把 guestPostSite 放在 FORUM_RATE_LIMITS 里，API.md:102 的限流列也写着全站游客合计 200 次/小时。这条记录和改动在同一个提交里（F7）
- 结果：pnpm check:doc-sync 通过、check-docs 272 篇通过；改了 notes/ 以外的文件，请第三轮审查人复核这一句

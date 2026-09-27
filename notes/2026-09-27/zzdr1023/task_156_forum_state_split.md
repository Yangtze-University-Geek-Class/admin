# task/156/forum_state_split · zzdr1023 · 2026-09-27

负责人：zzdr1023

## 18:43:29 +08:00 · 开工 · #156 · 从 origin/stage d4a24749d077 建 task/156/forum_state_split

- 执行者：agent-pi-geek-main-02（pi coding agent，dsf）
- 做了什么：node scripts/task.mjs start 156 forum_state_split：建分支与 worktree .claude/worktrees/task-156，在 issue 上留开工记录
- 结果：worktree 已建好，issue 上已留开工记录

## 18:55:39 +08:00 · 方案 · #156 · 方案：/state 去掉帖子正文，话题页按话题取帖子

- 执行者：agent-pi-geek-main-02（pi coding agent，dsf）
- 做了什么：复现：app.inject 量真实公开旧帖（app/forum/content），/state 74.4KB 原始 / gzip 49.7KB，posts 121.4KB 占 91%（body-84 26754B、body-89 17918B、body-72 13796B）；合成 200 帖 541.8KB/gzip 54.4KB、1000 帖 2419.1KB/gzip 76.6KB、中位 68ms。方案：/state 的每条帖子只给摘要（服务端截到 200 字）与计数，进话题页再按话题取整条帖子正文
- 结果：已完成复现，方案见下一条；未改任何代码
- 下一步：写服务端 topics/:id/posts 接口与 /state 摘要，再改前端

## 19:00:01 +08:00 · 方案 · #156 · 方案定稿：state 的帖子只带摘要+计数，话题页按话题取正文

- 执行者：agent-pi-geek-main-02（pi coding agent，dsf）
- 做了什么：接口设计：GET /api/forum/topics/:id/posts（所有人可读、按 IP 限流）回整条帖子（含正文）；GET /api/forum/state 的 posts 每条只给 excerpt（服务端按纯文本截断）与 replyCount/likeCount，不再给 content；写接口回答里不改正文的写入（点赞、书签、置顶、关闭、标已读、资料、头像）只回帖子摘要，改正文的写入（发帖、回复、编辑、删除）回整条
- 结果：方案已定，未开始改代码；前端配套：TopicList/TopicRow/书签页/搜索/个人页改读摘要，搜索改为服务端接口，话题页进入时按话题取正文
- 下一步：改 app/server 的 forum-store 与路由、改 contracts 与 API 文档，再改 app/forum

## 19:31:18 +08:00 · 开发 · #156 · 服务端：/state 帖子只带摘要，新增话题帖子与搜索接口

- 执行者：agent-pi-geek-main-02（pi coding agent，dsf）
- 做了什么：forum-rules 加 plainText/postExcerpt/matchExcerpt（与论坛前端 excerpt.ts 同一套规则）与 topicPosts/search 限流项；forum-store 的 state() 帖子改 toPostExcerpt（无正文）、changes() 加 { posts } 选项、新增 topicPosts()/search()；topics.ts 加 GET /api/forum/topics/:topic_id/posts 与 GET /api/forum/search，发帖/回复/编辑/删除传 posts:"full"；tests/server/forum.test.ts 跟着改
- 结果：npx tsc -p app/server/tsconfig.json --noEmit 干净；npx vitest run tests/server/forum.test.ts 55 passed；完整 pnpm test 里除 build-mirrors 的 4 条既有失败外全过（891 passed / 28 skipped）
- 下一步：改前端：parseServerSnapshot 与 store 的摘要、话题页按话题取正文、搜索改服务端、书签页/个人页改摘要

## 19:48:39 +08:00 · 开发 · #156 · 前端：列表读摘要、话题页按话题取正文、搜索走服务端

- 执行者：agent-pi-geek-main-02（pi coding agent，dsf）
- 做了什么：types.ts 的 Post.content 改为可选、加 excerpt；forum-api 加 topicPosts()/search() 与 parseTopicPosts/parseSearch，parseWriteResult 的帖子经 normalizePost；forum.ts 加 assignPost（列表回答不带 content 时保留已取到的正文）；forum-server 加 loadTopic()/search()；TopicList/TopicRow/书签页/个人页改用 postLine()；PostCard 正文没到先显示摘要与「正在读取正文…」；search.vue 服务端搜索；forum-markdown/post-markdown 的摘要改用 postLine
- 结果：nuxi typecheck 干净；论坛 vitest 30 files / 541 tests passed；editor-call-sites 里 PostCard 那条跟着改了断言
- 下一步：补能区分修复前后的回归测试（服务端与前端各一组），再跑 pnpm check/test/build、forum:check/generate 与限速实测

## 20:07:46 +08:00 · 开发 · #156 · 回归测试与文档同步：服务端 4 组、论坛 5 条新用例

- 执行者：agent-pi-geek-main-02（pi coding agent，dsf）
- 做了什么：tests/server/forum.test.ts 新增「list state without bodies (#156)」一组（/state 无正文且每条带 excerpt、话题帖子接口对游客可用与 404、搜索匹配与转义与限流、不触正文的写回答只带摘要）与 1 条点赞长帖的回答大小；app/forum 新增 forum-server-store 的 5 条（loadTopic 合并、共用一个请求、失败保持摘要、服务端搜索、被拒编辑不丢正文）；fixtures/server-state.ts 改成 /state 无正文并加 topicPostsBody/searchBody；文档同步：docs/architecture/API.md、docs/services/server/README.md、docs/services/forum/README.md、docs/conventions/TESTING.md、app/forum/ADOPTION.json（3 条上游适配）
- 结果：pnpm check 全绿（文档同步 6 组、执行记录 41 条链路、密钥门禁、三处 typecheck）；变异验证：state() 改回带正文使 3 条失败、topicPosts 改回摘要使 2 条失败、去掉搜索词长校验使 1 条失败、changes 一律 full 使 1 条失败、loadTopic 不合并使 6 条失败、remember 不记正文使 1 条失败
- 下一步：跑 pnpm test / build / forum:check / forum:generate，再做限速首屏实测与浏览器验证

## 20:18:35 +08:00 · 开发 · #156 · 实测对比：首屏 /state gzip 48.6KB→6.7KB；浏览完整套通过

- 执行者：agent-pi-geek-main-02（pi coding agent，dsf）
- 做了什么：同一份脚本（app.inject、真实公开旧帖 app/forum/content）在改动前后各跑一次：改前 17 帖 /state 125.4KB/gzip 48.6KB（posts 占 94.6%）、200 帖 1485.9KB/gzip 54.4KB、1000 帖 6928.9KB/gzip 76.6KB/中位 68.8ms；改后 17 帖 16.8KB/gzip 6.7KB（posts 59.4%）、200 帖 156.3KB/gzip 8.6KB、1000 帖 714.9KB/gzip 14.3KB/中位 44.5ms；body-84 那一条在 /state 里 26.8KB/gzip 13.0KB → 0.6KB/gzip 0.5KB；新增 /topics/t84/posts 26.8KB/gzip 13.0KB（只有进这个话题时才下）
- 结果：pnpm check 全绿；pnpm test 896 passed / 28 skipped、只有 build-mirrors 的 4 条既有失败（node:crypto，与本次无关，改动前后一致）；pnpm build 通过；pnpm forum:check 30 files/546 tests 通过；pnpm forum:generate 61 路由；tests/tooling 里 nginx 相关的 49 条实跑（web-nginx 19、forum-csp 15、forum-redirects 9、hashed-asset-cache 6），没有静默跳过
- 下一步：浏览器验证话题页与搜索，再提交

## 20:26:41 +08:00 · 开发 · #156 · 真机验证：话题页正文按话题取、搜索走服务端、列表页只下摘要

- 执行者：agent-pi-geek-main-02（pi coding agent，dsf）
- 做了什么：本机起真实核心服务（:3010，内存库、真实公开旧帖 17 篇）+ Nuxt dev（GEEK_FORUM_SOURCE=site，:3457）+ 转发（:3456，只转发 /api/forum、/auth、/api/public/org 到 3010），用真实 Chromium 走一遍：列表页只请求 /api/forum/state（17208B，posts 每条只有 excerpt、没有 content），不请求任何话题正文；进 /t/t84 请求 /api/forum/topics/t84/posts（200，27482B）并把正文渲染出来（10284 字，不是那行 201 字摘要）；站内跳转同样只取这个话题的正文、不再下 state；/search?q=机试 请求 /api/forum/search（200，2540B）并渲染结果；移动端 390×844 列表的置顶话题显示服务端摘要
- 结果：13 项断言全 PASS（脚本 .tools/verify156.mjs、verify156b.mjs，临时、不入库）；截图 5 张（桌面/手机 × 列表/话题/搜索）在 /tmp/156-*.png
- 下一步：清理临时脚本、提交、推 fork、开 PR

## 20:32:30 +08:00 · 提交 · #156 · 提交 77a49b3：perf(forum)! /state 不再带帖子正文

- 执行者：agent-pi-geek-main-02（pi coding agent，dsf）
- 做了什么：git commit 77a49b3（36 个文件，+899/-99）：服务端 forum-rules/forum-store/forum-api 三个路由文件加摘要、话题帖子与搜索接口；论坛 12 个源文件、6 个测试文件跟着改；文档 4 份 + ADR-0004 + ADOPTION 3 条；notes 链路
- 结果：提交前 pnpm check 全绿、npx vitest run 896 passed（4 条既有失败）、pnpm forum:check 546 passed、pnpm build 与 forum:generate 通过

## 20:33:05 +08:00 · 推送 · #156 · 推 fork：task/156/forum_state_split（efeb4f2）

- 执行者：agent-pi-geek-main-02（pi coding agent，dsf）
- 做了什么：git push -u fork task/156/forum_state_split：新建远端分支，pre-push 的分支规则、发布 tag 规则与 worktree 生命周期检查都通过（task worktree 生命周期通过：1 个还在做）
- 结果：fork 上已有 task/156/forum_state_split，指向 efeb4f2；官方仓库没有写权限，PR 走 fork → stage

## 20:36:02 +08:00 · PR · #156 · 开 PR #174（fork → 官方 stage）

- 执行者：agent-pi-geek-main-02（pi coding agent，dsf）
- 做了什么：gh pr create --repo Yangtze-University-Geek-Class/admin --base stage --head ZZDR1023:task/156/forum_state_split --body-file /tmp/pr156.md：九段齐全，审查结论一段写明尚未审查（不预填结论行之外的三种结论）；本地 node scripts/pr-contract.mjs check --branch task/156/forum_state_split 通过
- 结果：PR #174：https://github.com/Yangtze-University-Geek-Class/admin/pull/174
- 下一步：等 CI；审查结论写成 PR 评论后补一条「审查」记录

## 20:50:17 +08:00 · 阻塞 · #156 · PR #174 的 CI 红在 stage 自己身上（#175）

- 执行者：agent-pi-geek-main-02（pi coding agent，dsf）
- 做了什么：gh pr checks 174：docker、docker-cdn、env-contract、lint-workflows、pr-contract 通过，core、forum、branch-guard 失败、verify 跟着失败。逐条查失败原因：forum job 是 app/forum/app/pages/u/[username]/preferences.vue:345 的 <style scoped>（check-styles 报 vue-style-block，#173 加的、本 PR 没改这个文件）；core 与 branch-guard 是 check-doc-sync 报 deploy/ ↔ docs/ops/*、app/web/ ↔ docs/services/web/ 两组不同步，报错文本自己写着「origin/stage 上本来就不同步（不是这条分支造成的）」；对照 origin/stage 自己的 CI（run 36318197583，#173 合并）同样红，且把干净 origin/stage 检到 /tmp/stage156 跑 check-doc-sync 退出码 1
- 结果：已开 #175 记录 stage 的这两处（含复现命令与 stage CI 链接），并在 #156 留一条 kind=blocked 追踪记录；没有改检查脚本、没有放宽校验、没有把无关改动塞进本 PR。本 PR 的本地验证不受影响（pnpm check / forum:check 在本分支全绿）

## 20:59:43 +08:00 · 阻塞 · #156 · 已把 CI 的合并态复现清楚：只红在 stage 的两处，本 PR 自身检查全过

- 执行者：agent-pi-geek-main-02（pi coding agent，dsf）
- 做了什么：为了确认不是本 PR 引入的，在临时 worktree 里按 CI 的做法合成合并提交（origin/stage 9b38684 + 680bcff）并 pnpm install：check-doc-sync 仍在 app/web/ 与 deploy/ 两组上失败，check-styles 仍在 preferences.vue:345 上失败。branch-guard 里本 PR 自己的检查（分支不变量、执行记录）都过，只有 check-doc-sync 那一步红；核心 CI 里 docker、docker-cdn、env-contract、lint-workflows、pr-contract 全过。临时 worktree 与临时分支已删干净
- 结果：CI run 36320332194：branch-guard dry（只差 check-doc-sync 与预期的「审查」记录）、core dry（只差 doc-sync）、forum dry（只差 check-styles）；docker/docker-cdn/env-contract/lint-workflows/pr-contract pass。对照 origin/stage 自己的 CI run 36318197583 失败 job 与原因完全一致

## 21:13:51 +08:00 · 返工 · #156 · 自查发现并修掉一个真机才暴露的缺陷：正文未到时显示空白

- 执行者：agent-pi-geek-main-02（pi coding agent，dsf）
- 做了什么：自己写的 hasBody 用 props.post.content !== ''：列表回答里 content 是 undefined（不是空串），于是「已到达」判成真，卡片渲染空的 ForumMarkdown 而不是摘要 +「正在读取正文…」，也就是首屏进话题页时正文一栏是空白。改成 typeof content === 'string' && content !== ''；补两条组件测试（正文未到时显示摘要 +「正在读取正文…」且不给「编辑」；正文到达后渲染正文并给「编辑」），并把 mountCard 加 bodiesPending 参数与 postLine 自动导入
- 结果：改回旧写法时新用例失败（expected '刚刚#2赞 编辑 删除 回复' to contain '机试说明'），改后 19 条通过；真机复测（真实 Chromium，把 /topics/*/posts 延后 3 秒）：正文到达前卡片显示摘要与「正在读取正文…」、到达后换成 10284 字完整正文；把该接口改成 500 时显示「正文没有读出来，刷新页面再试。」并保留摘要；搜索「副驾驶」有 1 个 mark 命中并居中显示命中上下文。forum:check 548 passed、根 npx vitest run 924 passed（4 条既有失败）

## 21:22:01 +08:00 · PR · #156 · PR #174 正文更新到 6f607c3，并在 PR 上留返工追踪记录

- 执行者：agent-pi-geek-main-02（pi coding agent，dsf）
- 做了什么：gh api PATCH pulls/174 更新正文（gh pr edit 因 Projects classic 的 GraphQL 提示没生效）：解决链路加第 4 步返工、验证章节改成证据 1–7、forum 测试数 548 与根测试数 924、被审查提交改成 6f607c3；PR 上留一条 kind=progress 追踪记录说明这次自查修复；再取回远端正文核对（证据 7 / 6f607c3 / 924 passed / 返工（自查）各 1 处）
- 结果：PR #174 正文与评论都是最新的；CI 最新一次（run 36321685800）：docker、docker-cdn、env-contract、lint-workflows、pr-contract pass；core（只差 stage 的 doc-sync）、forum（只差 stage 的 preferences.vue style block）、branch-guard（只差 stage 的 doc-sync 与预期的「审查」记录）fail；PR 状态 OPEN、MERGEABLE、base=stage
- 下一步：等所有者处理 #175 后重跑 CI，然后等独立审查

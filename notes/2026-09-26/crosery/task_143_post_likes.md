# task/143/post_likes · crosery · 2026-09-26

负责人：crosery

## 22:19:10 +08:00 · 开工 · #143 · 从 origin/stage c8e7648d5779 建 task/143/post_likes

- 执行者：agent-claude-geek-main-08（Claude Code，claude-opus-5-5）
- 做了什么：node scripts/task.mjs start 143 post_likes：建分支与 worktree .claude/worktrees/task-143，在 issue 上留开工记录
- 结果：worktree 已建好，issue 上已留开工记录

## 22:37:16 +08:00 · 方案 · #143 · 点赞按钮写出「赞」和赞数，服务端契约不用改

- 执行者：agent-claude-geek-main-08（Claude Code，claude-opus-5-5）
- 做了什么：读 PostCard.vue、useForumActions、stores/forum-server.ts、shared/forum-api.ts 与 app/server 的 POST /api/forum/posts/:post_id/like、forum-store.toggleLike、forum_likes 表（主键 post_id+user_id）；读上游验收 verify-topic-page.mjs、smoke-routes.mjs 用 button[aria-label="赞"] 找按钮并把按钮文字当数字
- 结果：定位：按钮是 variant=bare 的纯图标，赞数为 0 时什么都不显示，aria-label=赞 盖掉了数字。服务端已经写库（toggleLike 在事务里删或插 forum_likes）并返回整份 state，前端用返回值整体替换 store，契约不缺。方案：新增 data/likes.ts 的 likeControl（文字「赞 N」/「赞」、赞过时实心心形与 danger 色调、aria-pressed、点击是 toggle 还是 prompt），PostCard 去掉 aria-label、请求没回来前不再发第二次；LoginModal 的提示文案抽成 data/access.ts 的 loginPromptToast 以便单测游客路径；两份上游验收脚本改成按文字找按钮并记进 ADOPTION.json；服务端只补一条写库回归测试。话题列表不加赞数（列表照 Discourse 三列，上游验收逐字核对表头）
- 下一步：拆三个提交：refactor 提示文案、feat 点赞按钮、test 服务端写库

## 22:37:39 +08:00 · 提交 · #143 · 登录提示的文案抽成 loginPromptToast

- 执行者：agent-claude-geek-main-08（Claude Code，claude-opus-5-5）
- 做了什么：refactor(forum): 登录提示的文案抽成 loginPromptToast：LoginModal 里按 loginPrompt 挑 toast 的三段分支搬到 data/access.ts 的纯函数，模态框只补「登录」按钮，文字与 id、时长、色调不变；access.test.ts 加两条；ADOPTION.json 的 LoginModal 说明补一句。node scripts/forum.mjs test tests/access.test.ts
- 结果：access.test.ts 16 个测试通过；把 sign-in 的 signIn 改成 false 后测试失败（反向验证）

## 22:38:04 +08:00 · 提交 · #143 · 每条帖子的点赞写出「赞」和赞数，赞过的变红

- 执行者：agent-claude-geek-main-08（Claude Code，claude-opus-5-5）
- 做了什么：feat(forum): 帖子的点赞写出「赞」和赞数，赞过的高亮：新增 data/likes.ts 的 likeControl；PostCard 的赞按钮改成带边框的 TxButton，文字「赞 N」/「赞」，不再有 aria-label，赞过时实心心形 + danger 色调 + aria-pressed，请求没回来前再点不发第二次；tests/likes.test.ts；上游 verify-topic-page.mjs、smoke-routes.mjs 按文字找按钮，记进 ADOPTION.json；docs/services/forum/README.md 补「点赞」一条与单测清单。FORUM_PNPM=… node scripts/forum.mjs check；pnpm check
- 结果：forum check 通过（typecheck、typecheck:tests、eslint、check-styles 115 个文件、24 个文件 472 个测试）；pnpm check 通过（文档同步按 PR 对 origin/stage 通过）。反向验证 10 个变异全部被测试拦下：文字退回纯数字、不变红、心形不填实、游客也显示按下、忽略能不能写、加回 aria-label、去掉请求中的防重、服务端模式走本地 store、store 不采用服务端的返回。上游 CDP 验收脚本按所有者规则没有在本机跑，脚本片段用 jsdom 夹具核对过能找到按钮、读出数字和 aria-pressed

## 22:38:27 +08:00 · 提交 · #143 · 服务端点赞写库的回归测试

- 执行者：agent-claude-geek-main-08（Claude Code，claude-opus-5-5）
- 做了什么：test(server): 点赞写进库，重新读取时谁都看得到：tests/server/forum.test.ts 新增一条，新话题第一帖与公开旧帖 t9 的第一帖 body-9 各赞一次，carol、bob、游客分别重新 GET /api/forum/state 都看到 m103，forum_likes 表里正好两行，取消后重新读就没有。app/server 源码没动。pnpm vitest run tests/server/forum.test.ts；另更正上一条「提交」记录：反向验证是 9 个变异（loginPromptToast 的那个属于第一个提交），forum check 当时是 472 个测试，测试挪到 access.test.ts 之后要以最终重跑为准
- 结果：tests/server/forum.test.ts 50 个测试通过。反向验证 3 个变异都被新测试拦下：路由只改返回值不写库（expected [] to deeply equal ['m103']）、取消不删行（expected ['m103'] to deeply equal []）、第一帖拒绝点赞（expected 400 to be 200）。文档核对：docs/services/server/ 不用改——只在 tests/server/forum.test.ts 加了点赞写库的回归测试，app/server 的接口、表和行为都没变

## 22:57:27 +08:00 · 提交 · #143 · 赞按钮改用 flat 样式，没赞时和「链接」一样清楚

- 执行者：agent-claude-geek-main-08（Claude Code，claude-opus-5-5）
- 做了什么：fix(forum): 赞按钮用 flat 样式，没赞时不再发灰：ego-browser 里看到 secondary 的赞按钮文字 #909399、边框 #e4e7ed，比旁边的「链接」（#606266、#dcdfe6）还浅；改成 TxButton variant=flat（常规文字色与边框），赞过时 type=danger（文字和边框 #f56c6c）。likeControl 的 variant 字段换成 tone；likes.test.ts、ADOPTION.json、README 跟着改。FORUM_PNPM=… node scripts/forum.mjs check；pnpm check
- 结果：forum check 通过（24 个文件 473 个测试）；pnpm check 通过。反向验证：tone 恒为空、恒为 danger、模板改回 secondary，各有测试失败。ego-browser（TaskSpace 215）里未赞是 variant-flat、rgb(96,98,102)，赞过是 variant-flat tone-danger、rgb(245,108,108)

## 23:00:24 +08:00 · 返工 · #143 · 赞按钮不在组件里拦第二次点击，写入交给 #145

- 执行者：agent-claude-geek-main-08（Claude Code，claude-opus-5-5）
- 做了什么：协调方转来：所有者报点赞和书签点了会卡住，#145 负责把论坛所有写入改成乐观更新（在 store / useForumActions 里先改本地、后台发请求、失败回滚）。本 PR 只管「赞 N」的显示和 PostCard 的接线，不动写入路径：PostCard 的 like() 去掉 liking 防重和 await，恢复成 void actions.toggleLike(...)（和 stage 上一样，只把判断换成 likeState.click），ADOPTION.json 与 README 去掉「请求没回来前不发第二次」的说法；likes.test.ts 的源码核对跟着改。FORUM_PNPM=… node scripts/forum.mjs check；pnpm check
- 结果：forum check 通过（24 个文件 473 个测试）；pnpm check 通过；把提示判断改回只看有没有用户后 likes 测试失败。服务端模式下的点赞仍经 useForumActions().toggleLike → stores/forum-server.ts，#145 在那一层改乐观更新即可，likeControl 只读 post.likeUserIds，本地先改的赞数会直接显示

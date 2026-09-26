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

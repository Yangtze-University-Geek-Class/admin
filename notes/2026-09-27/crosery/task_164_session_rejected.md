# task/164/session_rejected · crosery · 2026-09-27

负责人：crosery

## 07:06:18 +08:00 · 开工 · #164 · 从 origin/stage 4fd2a27e9f4a 建 task/164/session_rejected

- 执行者：agent-claude-geek-main-08（Claude Code，claude-opus-5-5）
- 做了什么：node scripts/task.mjs start 164 session_rejected：建分支与 worktree .claude/worktrees/task-164，在 issue 上留开工记录
- 结果：worktree 已建好，issue 上已留开工记录

## 07:22:38 +08:00 · 方案 · #164 · 论坛「连不上」是会话里的 GitHub 令牌被拒

- 执行者：agent-claude-geek-main-08（Claude Code，claude-opus-5-5）
- 做了什么：主机 nginx 日志与 server 日志只读排查：09-27 06:46–06:48 所有者 Chrome 三次 /api/forum/state 401，server 记 upstream request rejected（resolveAccess 用会话令牌查组织角色，GitHub 回 401）；同段其余 111 次 200，容器未重启。ego 自己的预发布会话同样 /auth/me 已登录、/api/forum/state 401 upstream_rejected。授权地址 client_id=Ov23li… 是 OAuth App；预发布审计从 09-25 18:18 起所有者登录 5 次、退出 2 次；正式站用另一个 OAuth App；本机没有用预发布 OAuth App 的环境
- 结果：原因是 GitHub 收回了会话里存的令牌，论坛把 401 当成连不上、/auth/me 仍回已登录；不是 rc.10、rc.11 发布引入的。令牌具体被什么收回查不到（未验证；GitHub 每用户每应用 10 个令牌的上限只是候选之一，两处会话都失效更像整条授权被撤）。方案：服务端结束被拒的会话，论坛按游客重读并提示重新登录
- 下一步：开发

## 07:22:38 +08:00 · 开发 · #164 · 会话令牌被拒时结束会话，论坛按游客重读并提示登录已失效

- 执行者：agent-claude-geek-main-08（Claude Code，claude-opus-5-5）
- 做了什么：server：http-policy 错误处理对带会话的请求遇到上游 401 删会话、清 sid 与 forum_sid、回 401 session_expired、审计 auth.session_rejected（require-auth.ts 的 isRejectedToken、endRejectedSession、clearSessionCookies，退出登录共用清 cookie）；/auth/me 同一情况回 { signed_in: false, session_expired: true }；destroySession 返回是否删掉了行，并发时只审计一次。forum：forum-server 读状态遇到 session_expired 按游客再读一次，写操作遇到它不弹原失败提示、交给 LoginModal；signinLapse 记次数与失败标题；LoginModal 头像菜单换回登录按钮、弹一条 signinLapsedToast 带登录按钮，挂载前已发生的在挂载时补说一次、useState 记住说到第几次；useSiteAccount 读到 /auth/me 的 session_expired 同样记一次。文档：API、SECURITY（含英文）、server、forum、console README、TESTING；ADOPTION.json 的 LoginModal 说明
- 结果：server 新增 5 条测试（forum 两条、upstream-errors、console /auth/me 与控制台接口、邀请链接发起人令牌被拒不动访问者会话）：撤掉 server 改动后前 4 条失败、邀请那条两边都过（守不变量），恢复后 pnpm test 56 files / 822 tests 通过，pnpm check exit 0。forum 新增 access、site-account、store 4 条、login-modal 3 条：去掉 watch 的 immediate 后挂载那条失败，恢复后 node scripts/forum.mjs check exit 0（30 files / 532 tests）。本机 harness（/tmp/geek164，站点模式构建，假 GitHub 对被撤的令牌回 401）ego 验证：写路径只出一条「没有加上书签 / 登录已失效…」带登录，右上角换回用 GitHub 登录，sid 被清，点登录走 /auth/github 到 GitHub 授权页；刷新路径第一轮发现提示没出（状态在 LoginModal 挂载前读完），改为挂载时补说后复验出现「登录已失效」、再刷新不重复、页面按游客显示没有连不上
- 下一步：提交，独立审查，推送开 PR

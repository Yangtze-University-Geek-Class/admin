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

## 07:45:12 +08:00 · 提交 · #164 · cbe44b5、5b399ac、08b483c

- 执行者：agent-claude-geek-main-08（Claude Code，claude-opus-5-5）
- 做了什么：cbe44b5 docs(notes) 记下 rc.11 发布与验收、#162 收尾与 #164 的方案、开发；5b399ac fix(server) GitHub 拒绝会话里的令牌时结束会话，回 401 session_expired；08b483c fix(forum) 服务端结束登录后按游客重读，提示登录已失效并给登录按钮
- 结果：三个本地提交，工作区干净；提交前 pnpm check exit 0、pnpm test 56 files / 822 tests、node scripts/forum.mjs check 30 files / 532 tests
- 下一步：独立审查

## 07:45:12 +08:00 · 审查 · #164 · 第一轮独立审查 08b483c：有条件通过，3 条应修

- 执行者：agent-claude-review-164（Claude Code，claude-opus-5-5）
- 做了什么：Workflow 三个视角（服务端正确性与安全、论坛客户端、回归测试文档与规范）按 .agents/skills/code-review/SKILL.md 与 CODE-REVIEW 只读审查 origin/stage...08b483c，每个视角前两条发现各由一个反驳者按代码核实
- 结果：没有阻塞。应修 3 条均核实成立：一、只有结束会话的那个请求收到 session_expired，其它已打开的标签页之后收到 signin_required，页面会按「这个账号不在组织里」说、也没有登录按钮；二、docs/services/server/data-model.md 的会话删除路径与 org 为空的审计清单没写 auth.session_rejected；三、执行记录缺「提交」。建议：按游客重读碰上 429 时成员按钮还在（核实成立）；/auth/me 那条路径没重读论坛；「并发只审计一次」没测到；邀请链接那条测试在现有代码下不会失败，TESTING 的说法要改；server README 指向 SECURITY「登录门槛」但规则写在「失败语义」；登录按钮整页跳转会丢掉刚放回的回复草稿（未核实）
- 下一步：返工

## 07:45:12 +08:00 · 返工 · #164 · 成员的写操作碰到任何 401 都交给 LoginModal，先问 /auth/me 再说

- 执行者：agent-claude-geek-main-08（Claude Code，claude-opus-5-5）
- 做了什么：forum：signinLapse 加 ended、message；fail() 对成员的任何 401 都记一次（session_expired 为 ended），LoginModal 对非 ended 的先 refresh /auth/me：已没登录弹「登录已失效」带登录，还登录着（被移出组织）照原样弹失败原因；noteSignedOut 先清 viewer 与 currentUserId，重读碰上 429 也不留成员按钮；useSiteAccount 读到 session_expired 时也重读论坛。server：http-policy 注释写明 join 不加载会话。文档：data-model.md 两处、SECURITY「登录门槛」加一条、TESTING 把邀请那条写成哨兵、forum README 失败一段、ADOPTION LoginModal。测试：store 改 1 条加 2 条，LoginModal 改 3 条加 2 条，server 加并发只审计一次 1 条
- 结果：变异核对：fail() 去掉成员条件、noteSignedOut 不清身份、LoginModal 不问 /auth/me，各自对应的测试失败，恢复后通过；server 并发测试在去掉 destroySession 返回值判断时失败。node scripts/forum.mjs check exit 0（30 files / 536 tests），pnpm check exit 0，pnpm test 56 files / 823 tests，check-doc-sync 通过。本机 harness 在 ego 里开两个标签页：A 点书签后会话结束，B 点赞弹「没有赞上 / 登录已失效…」带登录，右上角换回用 GitHub 登录，不再出现「不在组织里」，之后点书签按游客提示「登录后才能继续」。登录跳转丢草稿不在本 PR 改，另开 issue
- 下一步：提交，第二轮审查

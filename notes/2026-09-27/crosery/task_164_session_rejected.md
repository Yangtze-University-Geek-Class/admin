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

## 08:02:15 +08:00 · PR · #164 · PR #165 回 stage

- 执行者：agent-claude-geek-main-08（Claude Code，claude-opus-5-5）
- 做了什么：推送 task/164/session_rejected（到 e73a449）；gh pr create --base stage，标签 bug、P0、forum、server；正文 9 段，含改前改后 4 张截图（上传时借 PR #163 的评论框取附件地址，没有发评论）；node scripts/pr-contract.mjs check 通过。另开 #166：点登录整页跳转会丢未发出的草稿（审查建议，本 PR 不做）
- 结果：https://github.com/Yangtze-University-Geek-Class/admin/pull/165；审查结论先按第一轮写有条件通过，第二轮结束后更新
- 下一步：第二轮审查，CI

## 08:14:47 +08:00 · 提交 · #164 · 5cd60ae、e73a449（第一轮返工）

- 执行者：agent-claude-geek-main-08（Claude Code，claude-opus-5-5）
- 做了什么：5cd60ae docs(server) 数据模型与安全文档写上会话令牌被拒时结束会话，补并发只审计一次的测试；e73a449 fix(forum) 成员的写操作碰到任何 401 都先问 /auth/me；d1817cf docs(notes) 记下 PR #165
- 结果：提交前 pnpm check exit 0、pnpm test 56 files / 823 tests、node scripts/forum.mjs check 30 files / 536 tests；推送后 PR #165 的 CI 在 d1817cf 上 9 个检查全过（第二轮审查指出这两个提交漏了「提交」记录，这里补上）
- 下一步：第二轮审查的建议

## 08:14:47 +08:00 · 审查 · #164 · 第二轮独立审查 e73a449：没有阻塞和应修，5 条建议

- 执行者：agent-claude-review-164（Claude Code，claude-opus-5-5）
- 做了什么：只读审查 08b483c..e73a449 的返工与完整分支，核对第一轮各项；跑了 forum 的 3 个测试文件（59 条通过）、note.mjs check、check-doc-sync、docs-index --check；在仓库外写临时测试复现两条写操作同时 401
- 结果：第一轮 3 条应修都已修。建议：一、两条写操作同时在途时，第二条在页面换成游客后回来，仍弹没有登录按钮的旧提示（临时测试复现）；二、等 /auth/me 回来前页面短暂按「这个账号不在组织里」算；三、/auth/me 回 session_expired 那段没有测试；四、被移出组织的人收到「登录后才能操作」，应改用不在组织里的说法；五、5cd60ae、e73a449 没有「提交」记录
- 下一步：按建议返工

## 08:14:47 +08:00 · 返工 · #164 · 按发出时的身份判断失败，等 /auth/me 时先按没登录算，被移出组织改用不在组织里的说法

- 执行者：agent-claude-geek-main-08（Claude Code，claude-opus-5-5）
- 做了什么：forum-server：attempt、steer、sendReply 在发出时记下是不是成员，fail() 按它判断（先试过「失效到重读完成之间」的标记，新测试抓到重读完成后才回来的写操作仍会漏，改掉）；/auth/me 那条收成 noteSessionEnded()；LoginModal 问 /auth/me 前先把 account 置空，还登录着时弹 refusedNotMemberToast；forum README 与 ADOPTION 同步；测试：store 加两条写操作同时 401 与 noteSessionEnded 两条，access 加 1 条，LoginModal 改被移出组织那条（等 /auth/me 时断言没登录、之后是不在组织里的说法）
- 结果：变异核对：fail() 改回按页面上的身份判断、LoginModal 去掉先置空，各自对应的测试失败，恢复后通过。node scripts/forum.mjs check exit 0（30 files / 539 tests），pnpm check exit 0，check-doc-sync 通过。重建后本机 harness 在 ego 里再走两个标签页：A、B 各弹一条带登录的「登录已失效」，B 全程用 MutationObserver 看没出现过不在组织里的文字，A 刷新后是游客、不再弹。建议三按 noteSessionEnded 的 store 测试覆盖，组合函数本身由 nuxt typecheck 核对调用
- 下一步：提交，推送，更新 PR

## 08:27:29 +08:00 · 提交 · #164 · 4d91c2d（第二轮返工）

- 执行者：agent-claude-geek-main-08（Claude Code，claude-opus-5-5）
- 做了什么：4d91c2d fix(forum) 按发出时的身份判断写操作失败，等 /auth/me 时先按没登录算，被移出组织改用不在组织里的说法；同一提交带上 提交、审查、返工 三条记录
- 结果：提交前 node scripts/forum.mjs check exit 0（30 files / 539 tests），pnpm check exit 0；推送后 PR #165 的 CI 在 4d91c2d 上 9 个检查全过（run 36281923271、36281920083）
- 下一步：第三轮审查

## 08:27:29 +08:00 · 审查 · #164 · 第三轮独立审查 4d91c2d：通过，1 条建议

- 执行者：agent-claude-review-164（Claude Code，claude-opus-5-5）
- 做了什么：只读审查 e73a449..4d91c2d 与完整分支，核对第二轮 5 条建议；跑了 forum-server-store、login-modal、access 三个测试文件（62 条通过）、note.mjs check --pr --for-review、check-doc-sync、docs-index --check；grep 核对 fail() 与 noteSessionEnded 的调用点；读 viewer.ts 确认「/auth/me 还登录着 + 写操作 401」只会是被移出组织
- 结果：通过。第二轮建议一、二、四、五已处理，三只做了一半：useSiteAccount 在 /auth/me 回 session_expired 时调 noteSessionEnded 的那一行没有测试（删掉或写反，现有测试照样通过）。未验证：本机没跑完整 verify 与 e2e（以 CI 为准），没复现 ego 双标签页走查，没有预发布验证
- 下一步：补这条测试后合并

## 08:27:29 +08:00 · 返工 · #164 · 给 useSiteAccount 读到 session_expired 通知论坛补测试

- 执行者：agent-claude-geek-main-08（Claude Code，claude-opus-5-5）
- 做了什么：tests/support/sfc.ts 加 loadModule：按客户端构建（import.meta.client 为 true）载入 app 下的 TypeScript 模块，和 loadComponent 共用求值；tests/site-account.test.ts 加两条，给 useSiteAccount 假的 fetch 与 store；forum README 失败一段指向这条测试
- 结果：/auth/me 回 session_expired 时 noteSessionEnded 只调一次、顶栏按没登录算；登录着、普通没登录、读不到、非论坛服务端模式都不调。变异核对：去掉那次调用、去掉 serverMode 条件，各有一条新测试失败，恢复后通过。node scripts/forum.mjs check exit 0（30 files / 541 tests），check-doc-sync 通过
- 下一步：提交，推送

## 08:27:29 +08:00 · 提交 · #164 · 99678be（第三轮返工）

- 执行者：agent-claude-geek-main-08（Claude Code，claude-opus-5-5）
- 做了什么：99678be test(forum) 测 useSiteAccount 读到 /auth/me 的 session_expired 时通知论坛
- 结果：提交前 node scripts/forum.mjs check exit 0（30 files / 541 tests）；服务端与根目录代码没变，pnpm check、pnpm test 沿用 4d91c2d 上的结果
- 下一步：推送，CI 通过后更新 PR 审查结论并合并

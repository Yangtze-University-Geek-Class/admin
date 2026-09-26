# task/57/forum_backend · crosery · 2026-09-26

负责人：crosery

## 15:09:48 +08:00 · 开工 · #57 · 从 origin/stage 28122511456d 建 task/57/forum_backend

- 执行者：agent-claude-geek-main-08（Claude Code，claude-opus-5-5）
- 做了什么：node scripts/task.mjs start 57 forum_backend：建分支与 worktree .claude/worktrees/task-57，在 issue 上留开工记录
- 结果：worktree 已建好，issue 上已留开工记录

## 15:20:40 +08:00 · 方案 · #57 · 论坛后端放进核心服务的实现方案

- 执行者：agent-claude-geek-main-subagent-57（Claude Code 子代理）
- 做了什么：读完门禁文档与 .claude/plans/forum-backend-contract.md；定方案：data.db 新增 forum_* 表（用户、话题、帖子、点赞、书签、关注、通知、新建标签、头像 BLOB、计数器、浏览去重、限流记录），lib/forum-content 读 curation.json 与 topics.json 播种，lib/forum-store 负责 SQL 与整份 state，routes/forum 挂 /api/forum/*，/auth/me 加 console_link
- 结果：方案已定，开始实现；Node 22.23.2 下 pnpm install --frozen-lockfile 完成，基线 vitest tests/server 113 passed

## 15:53:28 +08:00 · 开发 · #57 · 论坛后端与 console_link 实现完成，pnpm verify 通过

- 执行者：agent-claude-geek-main-subagent-57（Claude Code 子代理）
- 做了什么：新增 lib/forum-content、forum-store、forum-rules、forum-avatar 与 routes/forum-api（/api/forum/* 全部端点），db.ts 加 12 张 forum_* 表，services 启动时读 app/forum/content 播种，Dockerfile 运行阶段复制 curation.json 与 published/topics.json，http-policy 放行头像的长期缓存，/auth/me 加 console_link；路由目录用 routes/forum-api，因为 scripts/check-forum-adoption.mjs 守着旧 routes/forum 不许回来；tests/server/forum.test.ts 与夹具 tests/server/fixtures/forum-content；同步 ADR-0004、server 合同、数据模型、API、SECURITY 等文档
- 结果：Node 22.23.2 下 pnpm verify 退出 0（根 Test Files 44 passed、Tests 511 passed；论坛 Test Files 15 passed、Tests 240 passed；Forum provenance passed）；hadolint app/server/Dockerfile 无输出；FROM scratch 的 docker build 核对两份 JSON 在构建上下文里；dist 在 127.0.0.1:3157 冒烟：/api/forum/state 200 no-store、14 篇旧帖、游客回复 201 p10001、游客发帖 401、浏览 204、旧 /api/forum/threads 410，进程已按 PID 停掉；未验证：真实镜像构建、预发布环境

## 15:53:41 +08:00 · 提交 · #57 · /auth/me 的 console_link 单独提交

- 执行者：agent-claude-geek-main-subagent-57（Claude Code 子代理）
- 做了什么：feat(auth): /auth/me 返回 console_link，只给管理者显示控制台入口（routes/admin/auth.ts、tests/server/console.test.ts 两条用例、API.md 的 /auth/me 一行）
- 结果：npx vitest run tests/server 通过；整体 pnpm verify 退出 0（见上一条开发记录）

## 15:54:44 +08:00 · 提交 · #57 · 论坛后端 /api/forum 提交

- 执行者：agent-claude-geek-main-subagent-57（Claude Code 子代理）
- 做了什么：feat(server): 论坛后端 /api/forum，数据存 data.db 的 forum_* 表（lib/forum-*、routes/forum-api、db.ts、services、Dockerfile、http-policy、测试与夹具、ADR-0004 与相关文档）；上一条提交 e88a658 在临时 worktree 单独跑过 vitest tests/server（115 passed）与 server tsc
- 结果：pnpm verify 退出 0（根 Tests 511 passed，论坛 Tests 240 passed）；未验证：真实镜像构建与预发布环境

## 16:11:38 +08:00 · PR · #57 · 开 PR #116

- 执行者：agent-claude-geek-main-08（Claude Code，claude-opus-5-5）
- 做了什么：会话 15:57 重启打断了子代理，它的提交 e88a658、5d8c1b7 与记录都已完成；主 agent 核对记录后推送 task/57/forum_backend 并 gh pr create
- 结果：https://github.com/Yangtze-University-Geek-Class/admin/pull/116；派独立审查

## 16:34:07 +08:00 · 审查 · #57 · 第一轮独立审查：有条件通过（3 应修、6 建议）

- 执行者：agent-claude-geek-main-subagent-116（Claude Code 子代理）
- 做了什么：收到 PR #116 第一轮独立审查（16:22，审查的提交 8723671）：应修 1 客户端 IP 可伪造（TRUST_PROXY=true 信任 X-Forwarded-For 最左边，轮换 XFF 8/8 次 201）；应修 2 游客昵称可用零宽、双向控制字符冒用「极客班」「geekclass」；应修 3 被移出组织的人凭 sid 仍按成员发帖（viewer.ts 不看 githubRole）；建议 6 条：别人的 notifyPrefs 下发给所有人、state 与浏览接口无限流、IPv6 按 /64 计游客限流并加全站游客回复熔断、头像在鉴权前读完请求体且像素上限偏大、@提及通知每帖不设上限、API.md 同步
- 结果：结论：有条件通过；条件是 3 条应修全部修完并带测试，建议 6 条一并处理
- 下一步：子代理在 task-57 worktree 逐条修复，每条带测试与变异核对

## 16:54:10 +08:00 · 提交 · #57 · 应修 1：两个环境按两层反代取客户端 IP

- 执行者：agent-claude-geek-main-subagent-116（Claude Code 子代理）
- 做了什么：fix(deploy): 两个环境按两层反代取客户端 IP，不再信任整条 X-Forwarded-For（config.ts 的 TRUST_PROXY 接受层数 0–10；两份 env 模板 TRUST_PROXY=2；deployment-environment.mjs 要求等于 PROXY_HOPS=2；configuration、applications、forum、deployment-environment 四处测试；ENVIRONMENTS、DEPLOY、SECURITY、API、TESTING 同步）
- 结果：提交前 vitest tests/server 与 tests/tooling/deployment-environment.test.ts 全部通过（9 个文件 183 条）；node scripts/deployment-environment.mjs --check 通过；server tsc 通过

## 16:55:51 +08:00 · 提交 · #57 · 应修 2、3 与 6 条建议：论坛接口加固

- 执行者：agent-claude-geek-main-subagent-116（Claude Code 子代理）
- 做了什么：fix(server): 论坛昵称拦看不见的字符，被移出组织的会话按游客处理，并按审查建议加固（forum-rules 的 hasHiddenNameChars、nameKey、ipSubject、FORUM_REQUEST_LIMITS、guestPostSite、mentionNotifyMax、4096×4096；forum-store 的 guestNameTaken 归一比较、displayNameTaken、只给本人真实 notifyPrefs、提及上限；viewer 的 githubRole 为 null 按游客；posts 按 /64 与全站熔断；topics 的 state 120/分钟、浏览 60/分钟；people 的头像在 onRequest 核对登录与计数；forum.test 新增 16 条用例并修掉 PoW 用例约 1/256 的偶发失败；API、SECURITY、数据模型、server 合同、TESTING 同步）
- 结果：提交前 vitest run tests/server 8 个文件 157 条全部通过；server tsc 通过；check-docs 与 docs-index --check 通过

## 17:00:57 +08:00 · 返工 · #57 · 第一轮审查的 3 条应修与 6 条建议已修完，变异核对全部被测试抓到

- 执行者：agent-claude-geek-main-subagent-116（Claude Code 子代理）
- 做了什么：560c762 fix(deploy)：TRUST_PROXY 接受层数，两环境改为 2，校验器要求等于 PROXY_HOPS；70b1045 fix(server)：昵称拦 \p{Cf} 等看不见的字符并按 nameKey（NFKC、去隐形字符与附加符号、不分大小写）判重名，成员昵称不能等于官方名字或别人的用户名（新 400 display_name_taken）；组织角色为 null 的会话按游客；别人的 notifyPrefs 给初始值；state 120/分钟、浏览 60/分钟按 IP；IPv6 按 /64；全站游客回复 200/小时（新 429 guest_replies_paused）；头像 onRequest 核对登录与计数、每次上传都计、像素上限 4096×4096；一帖 @提及最多通知 10 人；修掉 PoW 用例约 1/256 的偶发失败。变异核对：层数当成 true、模板改回 true、昵称只拦 C0、判重名不归一、去掉 githubRole 判断，以及 6 条建议各去掉一处，每次都有对应用例失败，恢复后全绿
- 结果：vitest run tests/server 8 个文件 157 条通过；server tsc 通过；check-boundaries 通过；pnpm check 退出 0；pnpm test 退出 0（44 个文件 529 条）；pnpm verify 的 check、test、build 通过，forum:check 在本 worktree 找不到 .tools/pnpm11 退出 1，设 FORUM_PNPM 为主工作区的 pnpm.cjs 后 forum:check（15 个文件 240 条）与 forum:generate 退出 0；未验证：真实 nginx 链路下 server 看到的 X-Forwarded-For、预发布与正式环境、论坛前端对新错误码的处理
- 下一步：主 agent 复核后推送并请第二轮审查

## 17:18:19 +08:00 · 审查 · #57 · 第二轮审查：有条件通过（1 应修、5 建议）

- 执行者：agent-claude-geek-main-subagent-116（Claude Code 子代理）
- 做了什么：收到 PR #116 第二轮审查（17:16，审查的提交 046fb85）：应修 1 条，看起来是空白但不在 \p{Cf} 里的字符还能通过（盲文空格 U+2800、U+1D159、单独的组合符号 U+17B4/U+17B5 使 nameKey 为空）；建议 5 条：拉丁字母混用西里尔或希腊字母的形近昵称、游客昵称只和论坛里已有的用户比较（没打开过论坛的组织成员可被冒用）、state 的自动 HEAD 路由另占一份限流额度且照样算整份 state、.env.example 的 TRUST_PROXY 注释过时、以后一个提交一个目的
- 结果：结论：有条件通过；条件是应修修完并带测试，建议除提交粒度外一并处理
- 下一步：子代理在 task-57 worktree 按目的分提交修复

## 17:23:35 +08:00 · 提交 · #57 · 第二轮应修：拦住看起来是空白的昵称

- 执行者：agent-claude-geek-main-subagent-116（Claude Code 子代理）
- 做了什么：fix(server): 论坛昵称拦住盲文空格等看起来是空白的字符（forum-rules 的 HIDDEN_NAME_CHAR 加 U+2800、U+1D159、U+17B4、U+17B5，新增 nameProblem：nameKey 为空的名字拒绝；游客与成员昵称都走它；forum.test 两处新用例；API、SECURITY 同步）
- 结果：提交前 vitest tests/server/forum.test.ts 42 条通过，server tsc 通过

## 17:25:07 +08:00 · 提交 · #57 · 第二轮建议：昵称不许拉丁字母混写西里尔、希腊字母

- 执行者：agent-claude-geek-main-subagent-116（Claude Code 子代理）
- 做了什么：fix(server): 论坛昵称不许拉丁字母和西里尔、希腊字母混写（nameProblem 加 mixed_script，按 NFKC 后判断；游客与成员昵称都拒，错误码不变、message 为「昵称不能把拉丁字母和西里尔字母、希腊字母混着写」；forum.test 两处用例；API、SECURITY 同步）
- 结果：提交前 vitest tests/server/forum.test.ts 43 条通过，server tsc 通过

## 17:27:06 +08:00 · 提交 · #57 · 第二轮建议：昵称也不能冒用有称号但没打开过论坛的人

- 执行者：agent-claude-geek-main-subagent-116（Claude Code 子代理）
- 做了什么：fix(server): 论坛昵称也不能冒用有称号但没打开过论坛的人（createForumStore 加 orgLogins 选项，services.ts 从 role_assignments 取登录名；guestNameTaken 与 displayNameTaken 都比较，成员自己的登录名除外；forum.test 新用例；API、SECURITY、数据模型同步，SECURITY 写明没有称号又没打开过论坛的成员与组织 owner 仍是缺口）
- 结果：提交前 vitest tests/server 8 个文件 160 条通过，server tsc 通过

## 17:28:30 +08:00 · 提交 · #57 · 第二轮建议：state 的 HEAD 不再另占额度、不再算整份 state

- 执行者：agent-claude-geek-main-subagent-116（Claude Code 子代理）
- 做了什么：fix(server): HEAD /api/forum/state 回 405，不再另占限流额度（topics.ts 的 state 路由 exposeHeadRoute: false，另注册 HEAD 回 405 Allow: GET，不落到旧论坛的 410 通配路由；forum.test 新用例；API 同步）
- 结果：提交前 vitest tests/server/forum.test.ts 45 条通过，server tsc 通过；改之前实测 HEAD 200、x-ratelimit-remaining 从 119 往下走，与 GET 各算各的

## 17:29:06 +08:00 · 提交 · #57 · 第二轮建议：.env.example 的 TRUST_PROXY 说明改成层数

- 执行者：agent-claude-geek-main-subagent-116（Claude Code 子代理）
- 做了什么：docs(server): .env.example 的 TRUST_PROXY 说明改成本机不设、部署写层数（去掉过时的 loopback/true/false/CIDR 说明与示例行）
- 结果：node scripts/check-secrets.mjs 通过

## 17:30:11 +08:00 · 返工 · #57 · 第二轮审查的应修与 4 条可做的建议已修完，按目的分 5 个提交

- 执行者：agent-claude-geek-main-subagent-116（Claude Code 子代理）
- 做了什么：cd29cfb 应修：昵称拦 U+2800、U+1D159、U+17B4、U+17B5，nameKey 为空的名字拒绝；02be81c 拉丁字母混写西里尔、希腊字母的昵称拒绝；7077bcd 昵称也和 role_assignments 里的登录名比较（没有称号又没打开过论坛的成员与组织 owner 仍是缺口，本地没有来源）；d064c22 HEAD /api/forum/state 回 405，不再另占额度、不再算 state；0d748eb .env.example 的 TRUST_PROXY 说明。提交粒度一条按要求从这一轮起一个目的一个提交。变异核对：去掉 U+2800 与 U+1D159、去掉空 nameKey 判断、去掉混写判断、去掉 orgLogins 比较、去掉 HEAD 处理，每次都有对应用例失败，恢复后工作区干净
- 结果：vitest run tests/server tests/tooling 退出 0（23 个文件 381 条）；server tsc 退出 0；pnpm check 退出 0；未验证：预发布环境、论坛前端对新 message 的显示；没有推送
- 下一步：主 agent 复核后推送并请第三轮审查；没有称号的成员与组织 owner 的冒名缺口另开 issue

## 17:42:44 +08:00 · 审查 · #57 · 第三轮审查：有条件通过（1 应修、2 建议）

- 执行者：agent-claude-geek-main-subagent-116（Claude Code 子代理）
- 做了什么：收到 PR #116 第三轮审查（17:40，审查的提交 76c39e1）：应修 1 条，昵称的屏蔽清单还在漏（U+2065、U+FFF0–U+FFF8、U+E0080 等未分配的默认可忽略字符能当零宽用；亚美尼亚、傈僳、切罗基字母的形近名能通过；5µm 被误判成希腊字母），决定改成允许清单：只收汉字、拉丁字母、平假名、片假名、韩文、ASCII 数字和空格 - _ . · ・ '，先做 NFKC；建议 2 条：orgLogins 再并上 audit_logs 里 auth.signin 的登录者与当前会话的登录名、SECURITY 与数据模型写清剩下的缺口只有从没登录过的组织成员
- 结果：结论：有条件通过；条件是改成允许清单并保留前几轮全部探针（都要 400），建议一并处理
- 下一步：子代理在 task-57 worktree 按目的分提交修复

## 17:51:15 +08:00 · 提交 · #57 · 第三轮应修：昵称改成允许清单

- 执行者：agent-claude-geek-main-subagent-116（Claude Code 子代理）
- 做了什么：fix(server): 论坛昵称改用允许清单（forum-rules 的 isAllowedName 与 NAME_RULE_MESSAGE 取代 HIDDEN_NAME_CHAR、nameProblem 与混写规则；nameKey 改为 NFKC、不分大小写、去附加符号；游客与成员昵称共用；forum.test 用 REFUSED_NAMES 覆盖前几轮全部探针和第三轮新探针、ALLOWED_NAMES 覆盖允许的写法；API、SECURITY、SECURITY.en、数据模型、TESTING 同步）
- 结果：提交前 vitest tests/server 8 个文件 161 条通过，server tsc 通过，check-docs 与 docs-index --check 通过

## 17:53:19 +08:00 · 提交 · #57 · 第三轮建议：昵称也不能冒用登录过、但没打开过论坛的组织成员

- 执行者：agent-claude-geek-main-subagent-116（Claude Code 子代理）
- 做了什么：fix(server): 论坛昵称也不能冒用登录过、但没打开过论坛的组织成员（lib/auth 新增 signedInLogins：audit_logs 里 auth.signin 的 actor 并上 sessions.login；services.ts 的 orgLogins 加上它；forum.test 加 owner1 与 grace 两种探针；SECURITY 把剩下的缺口写成段末单独一句，并写明成员昵称也不能是这些人里别人的登录名；API、数据模型同步）
- 结果：提交前 vitest tests/server 8 个文件 160 条通过，server tsc 通过，check-docs 通过

## 17:54:21 +08:00 · 返工 · #57 · 第三轮审查的应修与 2 条建议已修完：昵称改成允许清单、冒名检查加上登录过的人

- 执行者：agent-claude-geek-main-subagent-116（Claude Code 子代理）
- 做了什么：c12f417 昵称改用允许清单（isAllowedName，先 NFKC，只收汉字、假名、韩文、常用拉丁字母、ASCII 数字、ー 与空格 - _ . · ・ '），拉丁字母比审查定的更窄，不收 IPA、小型大写、搭嘴音；删掉屏蔽清单、nameProblem 与混写规则；nameKey 改为 NFKC、不分大小写、去附加符号；8aa6d1e orgLogins 并上审计里 auth.signin 的登录名与当前会话，SECURITY 把剩下的缺口写成段末单独一句。变异核对：清单放宽成任意字母与格式字符、不查只有符号与连着的空格、成员昵称不走清单、拉丁字母放宽到整个 Script=Latin、orgLogins 去掉登录过的人，每次都有对应用例失败，恢复后工作区干净。论坛前端（task-107）只查昵称是否为空和长度，没有字符检查，服务端的 message 经 ForumApiError 显示
- 结果：vitest run tests/server tests/tooling 退出 0（23 个文件 380 条）；server tsc 退出 0；pnpm check 退出 0；未验证：预发布环境、前端显示新 message；没有推送
- 下一步：主 agent 复核后推送并请第四轮审查

## 19:25:20 +08:00 · 返工 · #57 · 第三轮复核的两处跟进：没改的昵称不再检查、本机预览说明更正 /api/forum/*

- 执行者：agent-claude-geek-main-subagent-116（Claude Code 子代理）
- 做了什么：主 agent 复核第三轮返工后提出两处跟进（拉丁字母范围保持更窄的写法）。cb00438 fix(server)：PATCH /api/forum/me/profile 里 displayName 去首尾空白后和库里现存的相同就当没改，不查允许清单和冒名、也不写；资料页每次保存都带昵称，早先存下的不合规或和官方同名的昵称不再挡住改签名、网站；换成别的昵称仍走全部检查，被拒时别的字段也不写；API.md 同步。c3dfd9f docs(ops)：LOCAL-PREVIEW 第 16 行改为 /api/forum/* 是新论坛接口，只有新接口没注册的旧路径、/auth/forum/*、/forum/u/* 返回 410，只动第 5 行日期和第 16 行，和 #126 分支（改第 13 行）用 git merge-file 模拟合并无冲突。变异核对：去掉跳过、一律跳过、比较时不去首尾空白，三次都有对应用例失败，恢复后工作区干净
- 结果：vitest run tests/server tests/tooling 退出 0（23 个文件 381 条）；server tsc 退出 0；pnpm check 退出 0；check:docs 退出 0；未验证：预发布环境、资料页真实保存；没有推送。另发现：成员默认昵称是 GitHub 登录名，最长 39 个字，超过 30 个字的人在资料页保存时会被 displayName 的长度校验挡住（前端 profileProblem 和服务端 schema 都查），这次没改
- 下一步：主 agent 复核后推送并请第四轮审查

## 19:32:43 +08:00 · 提交 · #57 · 合并 stage，论坛 README 去掉过渡说明

- 执行者：agent-claude-geek-main-08（Claude Code，claude-opus-5-5）
- 做了什么：c5c8886 把 stage（5c1717b，含 #106、#113、#117）合进来，无冲突；3f8d927 删掉 forum README 里「服务端接口已实现、论坛页面还没接上（#107）」一行，使该文件与 stage 相同，#126 合入时不冲突。子代理原先把删行 amend 进了合并提交，主 agent 改成纯合并 + 单独的 docs 提交
- 结果：vitest run tests/server tests/tooling 24 个文件 418 条通过；pnpm check 退出 0
- 下一步：推送；第四轮审查看 76c39e1..HEAD

## 19:53:52 +08:00 · 返工 · #57 · 第四轮审查的应修与 4 条建议已修完：昵称存 NFKC 写法、比较去空白和形近字、韩文只收音节、被占检查放到限流和 PoW 之后

- 执行者：agent-claude-geek-main-subagent-116（Claude Code 子代理）
- 做了什么：第四轮审查（审查的提交 08827be）有条件通过，按目的分提交修复。f34e6d9 应修：游客昵称和成员 displayName 先 NFKC 再去首尾空白，校验、存、算长度都用这个写法（不换行空格、U+2002、全角空格不再原样存下来）；nameKey 去掉所有空白和 - _ . · ・ '；昵称没改的比较两边都先这样处理；SECURITY 第 20 行、API、数据模型同步。5081db3 建议 1：nameKey 折叠形近字（ı ĸ，片假名カニロエハタトー和汉字力二口工八夕卜一，平假名へ和片假名ヘ）。ec260d4 建议 2：韩文只收 U+AC00–U+D7A3 的音节，单独的字母不收。df38fc6 建议 3：guest_name_taken 放到限流和 PoW 之后，被占也记一次这个 IP 的 guestPost，SECURITY 写明这个查询面。f0c01ae 建议 3：审计表加部分索引 idx_audit_signin_actor，旧库迁移测试核对索引和查询计划。da5b97a 建议 4：补极客班加 U+2E80 / U+302E、只在 auth.signin_denied 里的登录名、存的是「 bob 」时提交 bob 不写回三条测试。变异核对 13 次（游客存原文、nameKey 只合并空白、成员存原文、NFKC 后不查长度、不折形近字、去掉カ一项、韩文放回整个 Script=Hangul、被占不计数、被占检查放回限流之前、不建索引、去掉 (?=\p{L})、signin_denied 也算登录、没改的比较用原文），每次都有对应用例失败，恢复后工作区干净
- 结果：vitest run tests/server tests/tooling 退出 0（24 个文件 421 条）；pnpm check 退出 0；check:docs 退出 0；没有推送。新加的行为：NFKC 之后超过长度上限的昵称（如 ㍿ 展开成四个字）按 invalid_guest_name / invalid_display_name 拒绝；兼容韩文字母（ㄱ）现在也拒绝。未验证：预发布环境、论坛页面显示新的错误信息
- 下一步：主 agent 复核后推送并请第五轮审查

## 20:03:35 +08:00 · 审查 · #57 · 第四轮审查：有条件通过（1 应修、5 建议）

- 执行者：agent-claude-geek-main-subagent-116（Claude Code 子代理）
- 做了什么：补记 PR #116 第四轮审查（19:42，审查的提交 08827be）：应修 1 条，允许清单校验的是 NFKC 之后的写法、存的却是原文，NFKC 会把不换行空格、U+2000–U+200A、U+202F、U+205F、全角空格变成普通空格，nameKey 只合并空白，所以「极」加这些空格加「客班」的游客昵称返回 201、原样存下来看起来像「极客班」，成员改成这类昵称或「Car」加不换行空格加「ol」返回 200；要求校验和存同一个 NFKC 写法、nameKey 去掉所有空白和分隔符、昵称没改的比较用处理后的值。建议 5 条：nameKey 折叠形近字（ı ĸ、片假名和形近汉字、平假名へ）；韩文只收合成好的音节；游客昵称是否被占放到限流和 PoW 之后并计入额度；审计表加 auth.signin 的部分索引；补三条没被测到的变异（(?=\p{L})、auth.signin_denied、存的是「 bob 」时不写回）
- 结果：结论：有条件通过；条件是修完应修，建议一并处理
- 下一步：子代理在 task-57 按目的分提交修复（已在 f34e6d9 到 e537286 完成）

## 20:03:35 +08:00 · 审查 · #57 · 第五轮审查：有条件通过（1 应修、1 建议）

- 执行者：agent-claude-geek-main-subagent-116（Claude Code 子代理）
- 做了什么：收到 PR #116 第五轮定向复查（20:02，审查的提交 e537286）：应修 1 条，是 f34e6d9 带进来的回退：forum-store 里成员自己的登录名豁免按 nameKey 比较，nameKey 去掉了 -，所以成员 da-ve 能把昵称改成有称号的 dave 的登录名，返回 200；要求只豁免自己的登录名本身（不分大小写）。建议 1 条：开了 Turnstile 时，没被占的昵称停在 turnstile_failed、不占额度，被占和没被占又能免费区分（现在 TURNSTILE_SITE_KEY 为空，还没暴露）；要求 PoW 通过后每次尝试都记一次 guestPost，成功时不重复记，guestPostSite 只记真正发出的回复
- 结果：结论：有条件通过；条件是修完应修，建议能小改就一并处理
- 下一步：子代理在 task-57 按目的分提交修复

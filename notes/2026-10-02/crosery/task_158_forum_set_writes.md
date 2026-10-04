# task/158/forum_set_writes · crosery · 2026-10-02

负责人：crosery

## 20:04:21 +08:00 · 开工 · #158 · 从 origin/stage 458999fc0c60 建 task/158/forum_set_writes

- 执行者：agent-claude-geek-main-1002（Claude Code，claude-opus-5-5）
- 做了什么：node scripts/task.mjs start 158 forum_set_writes：建分支与 worktree .claude/worktrees/task-158，在 issue 上留开工记录
- 结果：worktree 已建好，issue 上已留开工记录

## 21:20:21 +08:00 · 提交 · #158 · 服务端赞、书签、关注改成按值设，旧切换写法暂留

- 执行者：agent-claude-geek-main-subagent-158（Claude Code 子代理，claude-opus-5-5）
- 做了什么：feat(server): forum-store 加 setLike/setBookmark/setFollow（INSERT OR IGNORE / DELETE，通知只在真正新加时发、沿用 hasNotification 去重），toggle* 改成读当前值再调 set*；contracts.ts 三条路由加可选 body（anyOf 对象/null，字段必填），posts.ts、people.ts 有 body 走设值、没有走旧切换；tests/server/forum.test.ts 加 5 条用例；同步 docs/architecture/API.md、docs/services/server/README.md、data-model.md、docs/conventions/TESTING.md
- 结果：npx vitest run tests/server/forum.test.ts：Tests 65 passed（新加 5 条：重复 liked/bookmarked/following=true 只有一行一条通知、取消同样幂等、无 body 旧切换仍可用、body 写错 400、游客与移出组织 401、删帖 409）；npx vitest run tests/server：Tests 245 passed；pnpm check 退出 0（文档同步通过：6 组模块与文档；执行记录通过：44 条链路）

## 21:21:06 +08:00 · 提交 · #158 · 论坛前端发设值请求，写请求超时后重读服务端

- 执行者：agent-claude-geek-main-subagent-158（Claude Code 子代理，claude-opus-5-5）
- 做了什么：feat(forum): shared/forum-api.ts 的 toggleLike/Bookmark/Follow 换成 setLike/setBookmark/setFollow（body 带值），全部写请求加 WRITE_TIMEOUT_MS=15s、头像 AVATAR_TIMEOUT_MS=60s；stores/forum-server.ts 的 steer 发最后一次点的值，超时或回答丢了（状态码 0）时不回滚不重发，按 recheck 重读 /state 或话题帖子，服务端已是想要的值就当成功，回复、新话题在服务端找到就当发出去了、找不到提示可能已经发出；新增 tests/forum-write-timeouts.test.ts（13 条），改 forum-api、forum-optimistic 测试；同步 docs/services/forum/README.md、API.md「写请求的时限」、TESTING；上一个提交 98d1ab6（服务端设值）
- 结果：FORUM_NODE=node26 node scripts/forum.mjs check 退出 0（Nuxt 类型、测试类型、ESLint、样式 guard 通过，Test Files 31 passed、Tests 576 passed）；把 outcomeUnknown 改成恒 false 时 forum-write-timeouts 的 13 条全部失败（已还原）；node scripts/check-doc-sync.mjs 通过

## 21:45:15 +08:00 · 开发 · #158 · 本机浏览器验收：两个标签页点赞、连点、写请求超时与回答丢失

- 执行者：agent-claude-geek-main-subagent-158（Claude Code 子代理，claude-opus-5-5）
- 做了什么：pnpm --filter @yzgc/server build；GEEK_FORUM_SOURCE=site GEEK_FORUM_BASE_PATH=/forum/ node scripts/forum.mjs generate；本机验收进程（app/server/dist 的 buildApp、临时文件库、假的 GitHub，同一端口提供论坛静态产物并把 /api、/auth 转给核心，可按规则拦住请求或丢掉回答）分别跑 e88bffa8e7d5（3472/5470）与改前 origin/stage 458999fc0c60（3473/5472，/private/tmp/geek-before-158 只读 worktree，用完已删）；ego 浏览器一个 TaskSpace（geek #158 验收），1440×900 与 390×844 DPR3 触屏
- 结果：改前：B 标签页点赞把 A 的赞取消（刷新后点赞 0）；赞的请求挂住 20.6 秒仍显示已赞、无提示。改后：B 点赞发 {"liked":true}，刷新仍是赞 1；连点两次/三次、关注连点结果与服务器一致，请求按顺序带值；赞挂住 15.0 秒后重读 /state 退回并提示「没有赞上」；书签回答丢失后重读确认并弹「已加入书签」；回复挂住提示「回复可能已经发出」并把原文留在回复框，回复回答丢失后找到即「回复已发布」，刷新只有一条；手机上赞与重读都挂住约 25 秒后提示「不知道改成了没有」，提示不溢出。证据 17 项在 /private/tmp/geek-evidence/158（主控上传 PR）。TaskSpace 已 finish，两个验收进程已停

## 22:30:10 +08:00 · 返工 · #158 · 审查 F1：2xx 的正文没收完按结果未知处理

- 执行者：agent-claude-geek-main-subagent-158（Claude Code 子代理，claude-opus-5-5）
- 做了什么：按独立审查 F1 改 app/forum/shared/forum-api.ts 的 request()：先 response.text() 再 JSON.parse，读正文出错且 response.ok 时抛状态码 0（到点 timeout、其余 network_error），store 因此走重读或找回复，不再当成服务端拒绝；4xx/5xx 正文没收完仍按状态码。新增夹具 cutOff（先给 200/201 头、正文到点或断线时出错）；forum-api.test.ts 加 3 条、forum-write-timeouts.test.ts 加 3 条（赞保持已赞不提示、回复在话题里找到且没有第二个 POST、断线时书签保留）。文档：docs/services/forum/README.md「超时与回答丢了」与测试清单、docs/architecture/API.md「写请求的时限」、docs/conventions/TESTING.md 论坛一行
- 结果：node scripts/forum.mjs test tests/forum-write-timeouts.test.ts tests/forum-api.test.ts tests/forum-optimistic.test.ts tests/forum-server-store.test.ts：Test Files 4 passed，Tests 153 passed；把 forum-api.ts 换回 9ebb1f8 的版本后新加 5 条失败（Tests 5 failed | 59 passed），已还原；node scripts/forum.mjs check（含本条与后两条改动）exit=0，Tests 583 passed

## 22:30:49 +08:00 · 返工 · #158 · 审查 F4：游客回复超时后按昵称认回复

- 执行者：agent-claude-geek-main-subagent-158（Claude Code 子代理，claude-opus-5-5）
- 做了什么：按独立审查 F4 改 app/forum/app/stores/forum-server.ts 的 replyLanded()：成员仍按作者编号认；游客回复另读一次 /state，作者要是昵称等于这次填的（按服务端 normalizeName 的 NFKC+trim）的游客，别人用别的昵称发的同一句「同问」不再被当成这位游客的回复。forum-write-timeouts.test.ts 加 1 条；docs/services/forum/README.md「超时与回答丢了」与测试清单同步。没有加 createdAt 时间窗：服务端时钟和浏览器时钟可能差得多，按时间比对会把真发出去的回复判成没找到
- 结果：node scripts/forum.mjs test tests/forum-write-timeouts.test.ts tests/forum-optimistic.test.ts tests/forum-server-store.test.ts：Test Files 3 passed，Tests 107 passed；把昵称条件去掉后新用例失败（Tests 1 failed | 16 passed），已还原

## 22:31:15 +08:00 · 返工 · #158 · 审查 F2：写明旧切换写法 v0.1.2-rc.1 去掉

- 执行者：agent-claude-geek-main-subagent-158（Claude Code 子代理，claude-opus-5-5）
- 做了什么：按独立审查 F2 与 issue #158 期望「旧的切换写法兼容一个版本，文档写明哪个 rc 去掉」：旧写法只留在 0.1.1 这一版，v0.1.2-rc.1 去掉。改 docs/architecture/API.md「论坛」、docs/services/server/README.md「论坛接口」、app/server/src/routes/forum-api/contracts.ts 的注释（只改注释，行为不变）。跟进 issue「去掉无体切换写法」的草稿写在 /private/tmp/geek-evidence/158/followup-issue.md，交主控开 issue 并请所有者确认版本；docs/services/server/data-model.md 不用改——表里只写旧写法切换，没有写去掉时间
- 结果：pnpm --filter @yzgc/server build 通过（tsc -p tsconfig.json）；npx vitest run tests/server/forum.test.ts：Tests 65 passed；版本 v0.1.2-rc.1 是按 issue 原话推的默认，待所有者确认

## 23:34:35 +08:00 · 返工 · #158 · 按审查 F1/F3/F4/F5 重做本机浏览器验收

- 执行者：agent-claude-geek-main-subagent-158（Claude Code 子代理，claude-opus-5-5）
- 做了什么：在 bf166ab092b6 上 pnpm --filter @yzgc/server build、GEEK_FORUM_SOURCE=site GEEK_FORUM_BASE_PATH=/forum/ node scripts/forum.mjs generate，起本机验收进程（buildApp 真实路由、临时库、假的 GitHub，能按路径 HOLD/LOSE/CUT；CUT 是只回状态码、头和一半正文）；同一进程另起一份 e88bffa8e7d5 的论坛构建作对照。ego 浏览器一个 TaskSpace，1440×900 与 390×844 DPR3 触屏（pointer: coarse 已核对）走两个标签页点赞、连点赞与关注、赞挂住、书签回答丢了、回复挂住与回答丢了、赞和重读都挂住、连点书签，以及 F1 的赞与回复正文停在一半、F4 的游客同问；证据 2、4、5、7–13、15–17 用新构建重拍，新增证据 18–25；证据 13 重拍成三格（F3）；PR 正文人工验收第 8 步写明断点选中止（F5），加第 10 步游客回复
- 结果：改后：CUT 赞 15.0 秒后同一毫秒 GET /state，保持赞 1、无提示（上一版弹「没有赞上 / 论坛服务暂时连不上」、刷新后其实赞 1）；CUT 回复 15.0 秒后读话题帖子找到、弹「回复已发布」、刷新只有一条（上一版弹「回复没有发出去」、回复其实已在）；游客同问改后弹「回复可能已经发出」（上一版把「另一位同学」的那条当成自己的）；其余场景结果与第一轮相同；390 宽各页 scrollWidth 不超出。证据 1–25 与快照标注在 PR 正文「验收证据」。未验证：pnpm verify、test:e2e、forum:verify 未在本机跑；预发布环境未验收

## 23:36:56 +08:00 · 返工 · #158 · 更正上一条记录里验收进程的说法

- 执行者：agent-claude-geek-main-subagent-158（Claude Code 子代理，claude-opus-5-5）
- 做了什么：上一条「做了什么」里写的「同一进程另起一份 e88bffa8e7d5 的论坛构建」不准确：实际是同一个验收脚本另起一个进程（端口 3473/5472/5473，主机名 prev158.localhost，独立临时库），bf166ab092b6 的构建在另一个进程（端口 3472/5470/5471，主机名 after158.localhost）
- 结果：只更正说法，验收步骤与结果不变；两个进程验收后都已停掉，3472、3473、5470–5473 上没有监听

# task/166/forum_signin_draft · crosery · 2026-10-02

负责人：crosery

## 20:04:15 +08:00 · 开工 · #166 · 从 origin/stage 458999fc0c60 建 task/166/forum_signin_draft

- 执行者：agent-claude-geek-main-1002（Claude Code，claude-opus-5-5）
- 做了什么：node scripts/task.mjs start 166 forum_signin_draft：建分支与 worktree .claude/worktrees/task-166，在 issue 上留开工记录
- 结果：worktree 已建好，issue 上已留开工记录

## 21:08:11 +08:00 · 开发 · #166 · 去登录前把没发出去的回复和编辑存进 sessionStorage

- 执行者：agent-claude-geek-main-subagent-166（Claude Code 子代理，claude-opus-5-5）
- 做了什么：新增 app/forum/app/data/composer-draft.ts（键 tuff-forum:draft:reply:<话题>/edit:<帖子>、编码、6 小时过期、正文上限 MEMBER_CONTENT_MAX）与 composables/useComposerDraft.ts（组件挂载时登记、stashComposerDrafts 收集，含还没被取回的被拒回复）；useSiteLinks().signIn 跳走前先 stash（try/finally，存失败也照样跳）；ReplyComposer 挂载时先放回存的字再取回内存里的被拒回复，取消/右上角关闭/Esc 与发出成功清掉；PostCard 能编辑时（正文到了之后）放回编辑，取消与保存成功清掉；单测 tests/composer-draft.test.ts（17 条），tests/forum-optimistic-components.test.ts 新增 14 条，tests/support/sfc.ts 的 loadModule 把 import.meta.dev 当 false；docs/services/forum/README.md 加「去登录时没发出去的字」并把更新改为 2026-10-02，ADOPTION.json 同步
- 结果：node scripts/forum.mjs check exit 0（typecheck、typecheck:tests、lint、check-styles clean 129 files、vitest 31 files / 579 tests 通过）；变异核对 9 处（signIn 不 stash、挂载不放回、取消不清、发出不清、不存被拒剩余、编辑取消不清、不等 canEdit、不看能否回复、关着的回复框也存）各自对应的测试失败，恢复后通过；浏览器验收未做，下一步在本机 harness 走

## 21:09:16 +08:00 · 提交 · #166 · 论坛去登录前存草稿、回来放回，代码测试文档一起提交

- 执行者：agent-claude-geek-main-subagent-166（Claude Code 子代理，claude-opus-5-5）
- 做了什么：fix(forum): 去登录前存下没发出去的回复和编辑；基于 origin/stage 458999f，含 app/forum 代码与测试、docs/services/forum/README.md、ADOPTION.json 与本链路的开工、开发、提交记录；git diff --check 无输出，新文件均为 LF
- 结果：pnpm check exit 0（docs 272 份链接通过、文档同步 6 组按 PR 对 origin/stage 通过、执行记录 44 条链路通过、密钥门禁通过、tsc 与 console vue-tsc 通过）；node scripts/forum.mjs check exit 0（31 files / 579 tests）；提交 SHA 记在下一条记录；未推送，浏览器验收未做

## 21:30:31 +08:00 · 返工 · #166 · 回复框收起后框里的字也随去登录存下，回来放回不自己打开

- 执行者：agent-claude-geek-main-subagent-166（Claude Code 子代理，claude-opus-5-5）
- 做了什么：上一提交 f2bac95 只存开着的回复框。本机 harness（站点模式构建 + 真实核心路由、内存库、假 GitHub）在 ego 里验收时发现：回复框开着时遮罩盖住顶栏，游客要先点「取消」收起回复框才点得到右上角「用 GitHub 登录」，而「取消」只是收起、字留在框里（#144），于是 issue 里「游客写了一半点右上角登录」那一条照样丢字。改为：不论开关都存框里的字和昵称，开着时再存回复的楼层和 open 标记；回来时字和昵称放回框里，只有跳走时开着的回复框自己打开；没被取回的被拒回复按开着存；文档与 ADOPTION.json 同步；测试改写取消那条、新增游客收起回复框后从顶栏登录那条，codec 加 open 字段
- 结果：node scripts/forum.mjs check exit 0（31 files / 580 tests，check-styles clean 129 files）；pnpm check exit 0；变异核对 11 处（含只存开着的回复框、关着的也自己打开、被拒剩余不按开着存）各自对应测试失败，恢复后通过；git diff --check 无输出；浏览器证据待用这次提交的构建重拍

## 21:30:31 +08:00 · 提交 · #166 · 回复框收起时的草稿也随去登录存下，返工提交

- 执行者：agent-claude-geek-main-subagent-166（Claude Code 子代理，claude-opus-5-5）
- 做了什么：fix(forum): 回复框收起后框里的字也随去登录存下；改 ReplyComposer.vue、data/composer-draft.ts（open 字段）、composables/useComposerDraft.ts、两份测试、docs/services/forum/README.md、ADOPTION.json 与本链路记录；上一提交 f2bac95eea6f
- 结果：forum check exit 0（580 tests）；pnpm check exit 0（文档同步按 PR 对 origin/stage 通过、执行记录通过、密钥门禁通过、typecheck 通过）；提交 SHA 记在下一条记录；未推送

## 21:47:24 +08:00 · 返工 · #166 · 游客昵称放回改在 setup 里做，修掉被输入框挂载钩子覆盖

- 执行者：agent-claude-geek-main-subagent-166（Claude Code 子代理，claude-opus-5-5）
- 做了什么：用 951eaee 的构建在 ego 里走游客那条（写昵称和回复 → 取消收起 → 顶栏用 GitHub 登录 → 模拟 GitHub 页取消 → 回来点回复）：正文回来了，昵称框是空的，但「以游客身份回复」按钮可点（guestName 有值）。用 CDP 在页面加载前挂 HTMLInputElement.value 的写入记录，看到同一毫秒里先由 beforeUpdate 写入「路过的新生」、再由 v-model 的 mounted 写回空串：onMounted 里改的值被输入框挂载时的旧值盖掉。改为在 setup 里（首次渲染前）放回正文和昵称，onMounted 只负责重新打开开着的回复框和取回被拒回复；新增「首次渲染时昵称和正文已在框里」的测试（放回挪回 onMounted 时这条失败）；ADOPTION.json 同步
- 结果：node scripts/forum.mjs check exit 0（31 files / 581 tests，check-styles clean）；pnpm check exit 0；变异核对 12 处各自对应测试失败，恢复后通过；git diff --check 无输出；浏览器证据待用这次提交的构建重拍。文档核对：docs/services/forum/ 不用改——这次只改放回的时机（setup 而不是 onMounted），README 里写的行为（回来后正文和昵称在框里、开着的才自己打开）没变

## 21:47:24 +08:00 · 提交 · #166 · 回复框草稿改在首次渲染前放回，返工提交

- 执行者：agent-claude-geek-main-subagent-166（Claude Code 子代理，claude-opus-5-5）
- 做了什么：fix(forum): 回复框草稿在首次渲染前放回，游客昵称不再被清空；改 ReplyComposer.vue、tests/forum-optimistic-components.test.ts、ADOPTION.json 与本链路记录；上一提交 951eaeed5b6d
- 结果：forum check exit 0（581 tests）；pnpm check exit 0；提交 SHA 记在下一条记录；未推送

## 22:12:11 +08:00 · 开发 · #166 · 用 4bf0090 的构建在 ego 里走完回复、编辑、游客三条去登录的一来一回

- 执行者：agent-claude-geek-main-subagent-166（Claude Code 子代理，claude-opus-5-5）
- 做了什么：本机验收进程：app/server/dist 的 buildApp（真实路由、内存库），GitHub 换 code、读用户、组织成员换成假的，GitHub 授权页由本机模拟；同一端口提供论坛站点模式静态产物并反代 /api、/auth。改后产物由 4bf009002f25 构建（geek166-after.localhost:3470），改前产物由 458999fc0c60（origin/stage）构建（geek166-before.localhost:3471）。ego TaskSpace「geek #166 验收」里在 1440×900 与 390×844 DPR3 触屏下、减少动态效果开着走三条：成员写回复→收回令牌→回复被拒→点 toast 的登录→模拟授权→回来→再发→刷新；编辑 #3→收回令牌→保存被拒→登录→回来→保存；游客写昵称和回复→取消收起回复框→顶栏用 GitHub 登录→模拟授权页取消→回来→再点回复
- 结果：改后：回来时回复框自己打开，标题「回复 @geekclass 的 #1」，原文在框里；再发弹「回复已发布」，草稿清掉，刷新不再弹框；编辑框回来带着改动打开，保存后草稿清掉；游客回来时回复框不自己打开，再点回复昵称和正文都在。matchMedia 的 prefers-reduced-motion 为 true，手机 pointer: coarse 为 true，都没有横向溢出。改前：回来后回复框和原文都没了，模拟授权页上的 sessionStorage 草稿为（没有），游客回来后昵称为空。证据 23 项（20 张截图、3 段逐帧录屏）和 manifest.json 放在本机 /private/tmp/geek-evidence/166/。另见：登录失效后重读状态会把已读出的正文换成「正文没有读出来，刷新页面再试。」，改前也有，不在本 issue 范围，交主控决定是否另开 issue

## 22:13:08 +08:00 · 提交 · #166 · 浏览器验收记录单独提交，代码不变

- 执行者：agent-claude-geek-main-subagent-166（Claude Code 子代理，claude-opus-5-5）
- 做了什么：docs(notes): 记录 #166 用 4bf0090 构建做的浏览器验收；只改本链路记录，代码仍是 4bf009002f25（上一提交）
- 结果：pnpm check exit 0（docs 272 份通过、文档同步 6 组按 PR 对 origin/stage 通过、执行记录 44 条链路通过、密钥门禁通过、typecheck 通过）；node scripts/forum.mjs check 在 4bf009002f25 上重跑 exit 0（31 files / 581 tests，check-styles clean 129 files）；git diff --check 无输出；未推送

## 23:03:26 +08:00 · 返工 · #166 · 按独立审查 F1–F3 返工：被拒回复只存一次、编辑框放回后滚到眼前、只有引用不存

- 执行者：agent-claude-geek-main-subagent-166（Claude Code 子代理，claude-opus-5-5）
- 做了什么：审查结论（有条件通过）四条：F1 stashComposerDrafts 对没取回的被拒回复只读不取，连调两次同一段回复拼两遍——改为存进 sessionStorage 成功后再从 store 取走（keep 返回是否存成，存不进去时留在内存里）；F2 编辑草稿放回后页面停在顶部、编辑框在屏幕外——useComposerDraft.ts 新增 bringDraftIntoView：PostCard 放回编辑后在 nextTick 里把 #post-<id> 滚到屏幕中间、光标放进编辑框（preventScroll），之后页面高度变化（上面的正文渲染出来）时再滚回中间，读者滚动/点按/打字或满 4 秒即停；F3 回复框里只有打开时自动填的引用也会被存——记下打开时填的引用（prefill），内容等于它时不存，发出时清掉 prefill（被拒的回复即使只有引用也照存）；F4 新话题页没接入草稿，不在 #166 范围，交主控另开 issue。测试：composer-draft.test.ts 加连调两次结果不变、存储拒绝时被拒回复留在 store、bringDraftIntoView 8 条；forum-optimistic-components.test.ts 加编辑放回后滚到眼前（编辑框已渲染）、普通「编辑」不滚、只有引用不存、引用后写了字或被拒的引用照存；docs/services/forum/README.md「去登录时没发出去的字」与 ADOPTION.json 同步
- 结果：node scripts/forum.mjs check exit 0（typecheck、typecheck:tests、lint、check-styles clean 129 files、vitest 31 files / 593 tests）；变异核对 10 处（R1 只读不取、R2 存不进去也取走、R3 不滚、R4 编辑框渲染前就滚、R5 不放光标、R6 不跟随高度变化、R7 读者操作后还跟、R8 不按时停、R9 引用也存、R10 被拒的引用不存）各自让对应测试失败（1–4 条），还原后 git status 只剩本次改动；浏览器证据待用这次提交的构建重拍

## 23:03:55 +08:00 · 提交 · #166 · 审查返工 F1–F3 的代码、测试、文档一起提交

- 执行者：agent-claude-geek-main-subagent-166（Claude Code 子代理，claude-opus-5-5）
- 做了什么：fix(forum): 被拒回复只存一次，编辑放回后滚到眼前，只有引用不存；改 composables/useComposerDraft.ts、components/PostCard.vue、components/ReplyComposer.vue、tests/composer-draft.test.ts、tests/forum-optimistic-components.test.ts、ADOPTION.json、docs/services/forum/README.md 与本链路记录；上一代码提交 4bf009002f25；git diff --check 无输出
- 结果：pnpm check exit 0（docs 272 份通过、文档同步 6 组按 PR 对 origin/stage 通过、执行记录 44 条链路通过、密钥门禁通过、typecheck 通过）；node scripts/forum.mjs check exit 0（31 files / 593 tests）；提交 SHA 记在下一条记录；未推送

## 23:33:45 +08:00 · 返工 · #166 · 用 6e9364b 的构建在 ego 里重拍全部改后证据，并复现、验收审查 F1–F3

- 执行者：agent-claude-geek-main-subagent-166（Claude Code 子代理，claude-opus-5-5）
- 做了什么：本机验收进程同上一轮（app/server/dist 的 buildApp、内存库、假 GitHub 与模拟授权页），新增 /__harness/slow 把下一次发回复的请求压后 4 秒；改后产物由 6e9364bd6bd7 构建（geek166-after.localhost:3470），返工前产物沿用上一轮 4bf009002f25 的构建（geek166-r0.localhost:3471）。ego TaskSpace「geek #166 验收」（234）里 1440×900 与 390×844 DPR3 触屏、减少动态效果开着：重走回复、编辑、游客三条（每条开头清掉本标签页的草稿，编辑那条回来后脚本不再替页面滚动）；F2 两个构建各走编辑一来一回；F3 游客点 #1 回复只留引用→取消→顶栏登录→授权页取消→回复话题；F1 写回复→收回令牌→请求压后→从面包屑回列表→列表页被拒→页面里接连两次 click() 顶栏登录→授权→进话题；另用 CDP 每 50ms 记 scrollY 与卡片位置（开/关 overflow-anchor 各一次）
- 结果：F2：返工前回来 scrollY 0、帖子在 8179px（手机 9272px）、焦点不在编辑框；返工后桌面 scrollY 8044、卡片在视口 325–671/900、焦点在编辑框，手机 scrollY 9278、卡片 281–659/844；逐帧记录里第一次居中时上面的正文还没渲染（y 167、卡片随后被推到 8202），ResizeObserver 约 60ms 内再居中到 y 8044，关掉滚动锚定时结果相同。F1：返工前授权页草稿与回来的回复框里同一段两遍（桌面、手机），返工后一份。F3：返工前授权页存的是 #1 的引用、回来回复话题框里是旧引用，返工后授权页「（没有）」、框是空的。回复、编辑、游客三条结果与上一轮一致，手机 pointer: coarse 与 prefers-reduced-motion 均为 true，都没有横向溢出。证据 41 项（改前 6 项沿用，改后 06–20、22、23 重拍，新增 24–41，含 4 段逐帧录屏）与 manifest.json 在本机 /private/tmp/geek-evidence/166/；TaskSpace 已 finish，两个验收进程已停

## 23:33:45 +08:00 · 提交 · #166 · 返工后的浏览器验收记录单独提交，代码不变

- 执行者：agent-claude-geek-main-subagent-166（Claude Code 子代理，claude-opus-5-5）
- 做了什么：docs(notes): 记录 #166 返工后用 6e9364b 构建做的浏览器验收；只改本链路记录，代码仍是 6e9364bd6bd7（上一提交）
- 结果：pnpm check 与 git diff --check 结果见本提交说明；未推送

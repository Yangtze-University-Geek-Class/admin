# task/149/notify_email · crosery · 2026-10-02

负责人：crosery

## 20:04:28 +08:00 · 开工 · #149 · 从 origin/stage 458999fc0c60 建 task/149/notify_email

- 执行者：agent-claude-geek-main-1002（Claude Code，claude-opus-5-5）
- 做了什么：node scripts/task.mjs start 149 notify_email：建分支与 worktree .claude/worktrees/task-149，在 issue 上留开工记录
- 结果：worktree 已建好，issue 上已留开工记录

## 21:20:44 +08:00 · 方案 · #149 · 绑定邮箱、通知发信与一键退订的做法

- 执行者：agent-claude-geek-main-subagent-149（Claude Code 子代理，claude-opus-5-5）
- 做了什么：读 #149 正文与分诊、mail.md、forum-store、forum-api 路由、preferences.vue、阿里云 SingleSendMail 文档（有 Headers 参数，List-Unsubscribe 与 List-Unsubscribe-Post 可覆盖，最多 10 个）与 Resend 文档（headers 对象）。定下：1) 发信模块：EnvelopeMessage 加 unsubscribe（页脚退订链接 + List-Unsubscribe/List-Unsubscribe-Post 头，两个地址都过 safeMailLink），OutgoingMail 加 headers，Resend 写 headers、阿里云写 Headers；mail_outbox 前进式加可空列 headers（新库在 CREATE 里，旧库 PRAGMA 核对后 ALTER ADD COLUMN），信到最终状态清掉；EnqueueLimits 加 perRecipientHour，outbox 加 cancelPending（待发的信记 skipped/cancelled）。2) 新表 forum_mail_settings（邮箱、验证时间、回复/提及/系统三项邮件开关，默认开）与 forum_email_codes（一人一行：邮箱哈希、验证码 HMAC、错误次数、10 分钟过期），不改 forum_users。3) 绑定：POST /api/forum/me/mail/code 发 6 位验证码（每人 1 次/分钟、5 次/天，同一收件箱 3 次/小时、5 次/天，计数只存哈希），POST /me/mail/verify 验证（错 5 次作废），PATCH /me/mail 改开关，DELETE /me/mail 解绑；换邮箱或解绑时把发往旧地址、还没发的论坛信记成 cancelled。4) 发信路径：forum-store 在一次写入的事务提交后把新通知 id 交给 onNotifications，lib/forum-mail.ts 只给回复、提及、系统通知发信（点赞、关注不发），event_key=forum.notification:<通知 id>，同一条只发一次；信里只放站内公开可见的回复人、话题标题、帖子摘要（≤140 字）和回站内链接，用户写的字只进事实栏、引用和主题，不进段落与摘要。5) 退订：令牌=论坛用户 id + HMAC（密钥由 ENCRYPTION_KEY 经 HKDF 派生，不加环境变量；换邮箱或重新绑定后旧链接失效）；GET /api/forum/mail/unsubscribe/:token 303 到论坛退订页，POST 同一地址一键退订（收 List-Unsubscribe=One-Click 表单，也收页面的 JSON），GET /api/forum/mail/subscription/:token 给页面显示状态。6) 论坛：账号资料加「邮件提醒」块（Tuffex），新页 /mail/unsubscribe。7) 测试：tests/server/forum-mail.test.ts、mail-outbox、mail-envelope、legacy-database，论坛 tests/forum-mail.test.ts。
- 结果：方案已定，按发信模块、服务端绑定与发信、论坛界面三个提交做；点赞与关注是否做每日汇总、招新进度类别是否适用留给所有者

## 21:27:46 +08:00 · 提交 · #149 · 发信模块支持退订邮件头、按收件箱限量和撤下待发的信

- 执行者：agent-claude-geek-main-subagent-149（Claude Code 子代理，claude-opus-5-5）
- 做了什么：feat(server): 发信支持退订邮件头、按收件箱限量与撤下待发的信（基于 458999f）：envelope.ts 加 unsubscribe（页脚链接 + List-Unsubscribe/List-Unsubscribe-Post，unsubscribeHeaders）、RenderedMail.headers；providers.ts 阿里云写 Headers、Resend 写 headers；outbox.ts 加 forum.email_code/forum.notification 两种信、perRecipientHour、cancelPending、skip_reason cancelled；db.ts 给 mail_outbox 前进式加 headers 列（addColumn）；同步 mail.md、data-model.md、server README；测试 mail-envelope、mail-outbox、legacy-database 加用例
- 结果：npx vitest run tests/server/mail-envelope.test.ts tests/server/mail-outbox.test.ts tests/server/legacy-database.test.ts：3 files，65 passed；corepack pnpm check 通过（文档同步 6 组、执行记录 44 条链路、密钥门禁、三份 typecheck）

## 21:44:22 +08:00 · 提交 · #149 · 服务端：绑定邮箱、通知同步发信与一键退订

- 执行者：agent-claude-geek-main-subagent-149（Claude Code 子代理，claude-opus-5-5）
- 做了什么：feat(server): 成员绑定邮箱后站内通知同步发信并可一键退订（接在 074c607 之后）：db.ts 新表 forum_mail_settings、forum_email_codes（不改 forum_users）；lib/forum-mail.ts（验证码 HMAC、按人与按收件箱限频、换邮箱与解绑撤下待发信、按类别发信、退订令牌由 ENCRYPTION_KEY 经 HKDF 派生）；lib/mail/forum.ts 两种信；forum-store 事务提交后交出通知 id（onNotifications）与 notificationMail 投影；routes/forum-api/mail.ts 五个成员接口与三个退订接口；contracts、forum-rules 限流；同步 mail.md、data-model.md、server README、API.md、SECURITY.md、TESTING.md、ENVIRONMENTS.md（ENCRYPTION_KEY 多了派生用途，没有新环境变量）、docs/INDEX.md
- 结果：npx vitest run tests/server：11 files，262 passed（新增 tests/server/forum-mail.test.ts 15 条）；corepack pnpm check 退出 0（文档同步 6 组、执行记录 44 条链路、密钥门禁、三份 typecheck）

## 21:55:17 +08:00 · 提交 · #149 · 论坛：账号资料绑定邮箱、邮件提醒开关与退订页

- 执行者：agent-claude-geek-main-subagent-149（Claude Code 子代理，claude-opus-5-5）
- 做了什么：feat(forum): 账号资料绑定邮箱、邮件提醒开关与退订页（接在 39c6b39 之后）：shared/forum-mail.ts（邮件提醒接口的浏览器客户端、回答校验、邮箱与验证码的表单检查、退订页查询串）；components/MailSettings.vue（Tuffex：绑定、更换、解绑邮箱，验证码倒计时，回复/提及/系统通知三项开关，写明点赞和关注不发邮件）；preferences.vue 在极客班论坛模式下放进这一块；新页 pages/mail/unsubscribe.vue（打开不退订，点按钮才退订，只能关不能开）；tests/forum-mail.test.ts 5 条；同步 docs/services/forum/README.md（源码地图、邮件提醒、退订页、单测清单，更新日期 2026-10-02）
- 结果：node scripts/forum.mjs check 退出 0（553 条单测通过、eslint 无问题、check-styles 128 个文件无内联样式）；论坛站点模式 generate 退出 0，/mail/unsubscribe 预渲染出页面

## 22:04:49 +08:00 · 提交 · #149 · 论坛：重新发送的倒计时挪到按钮外面

- 执行者：agent-claude-geek-main-subagent-149（Claude Code 子代理，claude-opus-5-5）
- 做了什么：fix(forum): 重新发送验证码的倒计时不再写进按钮（接在 a0be352 之后）：在 ego-browser 里 1440×900 点「发送验证码」后，按钮变成「重新发送（59 秒）」，两头的字被裁掉；TxButton 在 loading 结束时把宽度定成当时的文字宽（按钮上留着 width 内联样式），之后按钮里的字变长就被 overflow:hidden 裁掉。改成按钮只写「发送验证码」或「重新发送」，倒数写进下面那句说明（「N 秒后可以重新发送。」）；docs/services/forum/README.md 邮件提醒一段同步
- 结果：node scripts/forum.mjs check 退出 0（553 条单测、eslint、check-styles 128 个文件）；站点模式 generate 退出 0；浏览器复核见后面的验收截图

## 22:17:00 +08:00 · 提交 · #149 · 论坛：邮件提醒在手机上不再叠字

- 执行者：agent-claude-geek-main-subagent-149（Claude Code 子代理，claude-opus-5-5）
- 做了什么：fix(forum): 邮件提醒在手机上不再叠字（接在 4f5d569 之后）：ego-browser 390×844 DPR3 触屏下看到两处重叠：邮箱输入框（TxBlockInput 高度固定 56px，窄屏时输入框挤到标题下面）压住了「发送验证码」按钮；「有人回复我」等开关的说明折成两三行，压到下一项上（TxBlockSwitch 也是固定高度）。改成：邮箱和验证码用文字标签加 TxInput 上下排（带 autocomplete=email / one-time-code、inputmode=numeric）；三项开关的说明缩到一行（MAIL_TYPE_COPY，去掉没用的 unsubscribe 字段），「绑定邮箱之后才会发」和「通知偏好里关掉有人回复我时回复也不发邮件」挪到最后一行说明；docs/services/forum/README.md 同步。顺带看到：个人资料一组（昵称、个人签名、所在地、个人网站）在 390 宽下同样叠字，是 stage 上原有的问题，不在 #149 里改
- 结果：node scripts/forum.mjs check 退出 0（553 条单测、eslint、check-styles 128 个文件）；站点模式 generate 退出 0；390×844 下六个开关 clientHeight=scrollHeight=56，邮箱输入框不再压按钮

## 22:40:20 +08:00 · 开发 · #149 · 本机浏览器验收：绑定邮箱、回复发信、退订

- 执行者：agent-claude-geek-main-subagent-149（Claude Code 子代理，claude-opus-5-5）
- 做了什么：在 d0f50e1 的构建上验收（论坛站点模式 generate，服务端 buildApp 开着发信 worker，隔离的临时库，假 GitHub 两个成员 xiaoming/lihua，假发信商冒充 Resend 把信写成文件；前门 127.0.0.1:5481，服务端 5480）。ego-browser 一个 TaskSpace「geek #149 验收」：1440×900 下 xiaoming 填邮箱→发送验证码→从假发信商取码→验证并绑定；lihua 回复他的话题后收到「lihua 回复了你：…」，带 List-Unsubscribe 与 List-Unsubscribe-Post 头；退出登录打开信里的退订链接（换成本机地址），点「不再接收「有人回复我」的邮件」，回到账号资料看到回复那项关了。390×844 DPR3 触屏下 lihua 走同一流程，退订页点「不再接收任何论坛邮件」后三项都关，再解绑。另用 curl 测一键退订：GET 只 303 到退订页、不退订；POST List-Unsubscribe=One-Click 不带 Origin 退订成功；篡改的令牌 404；别站的 Origin 403。改前截图用 458999f 的论坛构建（只读 detached worktree，用完已删）。截图与信件存 /private/tmp/geek-evidence/149
- 结果：流程全部走通：退订回复类之后 lihua 再回复不发信（mail_outbox 没有 n2），点赞不发信（n3），@提及照发（n4）；同一条通知只有一行 forum.notification:<id>。验收中发现并修掉两处界面问题（4f5d569 按钮裁字、d0f50e1 手机叠字），最后一轮截图都在 d0f50e1 上重拍。顺带看到 stage 上原有的问题：个人资料一组（昵称、个人签名、所在地、个人网站）在窄屏下输入框压到别的字段上，不在 #149 里改

## 23:20:47 +08:00 · 返工 · #149 · 审查 F1：通知信写明回复人是游客

- 执行者：agent-claude-geek-main-subagent-149（Claude Code 子代理，claude-opus-5-5）
- 做了什么：fix(server): 游客回复和提及的通知信写明是游客（接在 dc05012 之后）：独立审查 F1——notificationMail 只把 actor 投影成昵称，游客（不用登录、昵称自取、可以叫「极客班管理员」）回复后，以「长江大学极客班」发出的信主题是「<昵称> 回复了你」、事实栏「回复的人：<昵称>」，站内 PostCard 上的「游客」标记到信里丢了。改成：NotificationMail.actor 带 kind；forumNotificationMessage 收 actorGuest，游客时主题写「游客「<昵称>」回复了你：…」「游客「<昵称>」在「…」里提到了你」，事实栏写「<昵称>（游客）」，成员不变；forum-mail.test.ts 的游客用例改成游客回复并 @ 另一位成员，断言两封信的主题、纯文本和 HTML 事实栏，成员回复的用例加「没有游客」；mail.md「信里有什么」和测试覆盖、SECURITY.md 论坛邮箱一段补游客的写法
- 结果：npx vitest run tests/server/forum-mail.test.ts：15 passed；把 lib/mail/forum.ts 临时换回 HEAD 版本时新用例失败（×），换回后通过；npx vitest run tests/server：11 files，262 passed；tsc -p app/server/tsconfig.json --noEmit 通过。文档核对：docs/services/server/data-model.md 不用改——没有新表新列，NotificationMail 是内存里的投影；API.md 不用改——接口和回答没变

## 23:26:06 +08:00 · 返工 · #149 · 审查 F2：邮件提醒的标题栏说明在 360 宽下两行放下

- 执行者：agent-claude-geek-main-subagent-149（Claude Code 子代理，claude-opus-5-5）
- 做了什么：fix(forum): 邮件提醒的说明在窄屏上不再掉出标题栏（接在 6088ac7 之后）：独立审查 F2——TxGroupBlock 标题栏高度固定，「邮件提醒」原说明 52 个字，360 宽下折成三行，第三行掉出灰色标题栏（审查实测 clientHeight 55 < scrollHeight 63）。说明改成「绑定邮箱后，有人回复或提到你时同时发邮件。改了立刻生效。」，模板里写明这条限制；docs/services/forum/README.md 邮件提醒一段补上标题栏说明的宽度要求和 320 宽下开关说明的情况
- 结果：论坛站点模式 generate 退出 0；ego-browser（TaskSpace 237）在这份构建上实测「邮件提醒」标题栏：360 宽（mobile 与非 mobile 两种）、320 宽、390 宽 clientHeight=scrollHeight=55，说明两行（32px，行高 16）；320 宽下三项邮件开关 clientHeight 56、scrollHeight 57，说明折成两行，与「通知偏好」的「有人回复我」相同（56/57），不在这里改。node scripts/forum.mjs check 退出 0（eslint、check-styles 128 个文件、31 files 553 tests passed）

## 23:26:40 +08:00 · 返工 · #149 · 审查 F4、F5：数据模型的语序与发信文档里带时效的说法

- 执行者：agent-claude-geek-main-subagent-149（Claude Code 子代理，claude-opus-5-5）
- 做了什么：docs(server): 数据模型与发信文档按审查改语序、去掉带时效的现状（接在 c50a4f5 之后）：F4——data-model.md「约定」第一条里 #149 那句插在 #148 新增 mail_outbox 和「同时每次启动执行一次 UPDATE applications…」之间，读起来像 #149 做的事；挪到 UPDATE applications 那句之后单独成句，#148 那句恢复成 stage 上的原样。F5——mail.md「发不出信时」里「比如正式环境现在没配发信密钥」是带时效的现状，改成「比如没配发信密钥的环境，各环境的情况见 ENVIRONMENTS」
- 结果：node scripts/check-doc-sync.mjs 退出 0；只改文档，没有代码改动

## 23:49:07 +08:00 · 返工 · #149 · 返工后的本机浏览器验收：游客的信、360 宽标题栏、全流程重拍

- 执行者：agent-claude-geek-main-subagent-149（Claude Code 子代理，claude-opus-5-5）
- 做了什么：在 c50a4f5 的构建上重拍全部改后证据（论坛站点模式 generate，服务端 buildApp 开着发信 worker，隔离临时库，假 GitHub 两个成员 xiaoming/lihua，假发信商冒充 Resend 把信写成文件；前门 127.0.0.1:5481，服务端 5480）。ego-browser 一个 TaskSpace（237，「geek #149 验收」，做完已 finish）：1440×900 下 xiaoming 绑定邮箱、lihua 回复、没登录的人在话题页用昵称「极客班管理员」回复（站内标「游客」），看两封信，没登录打开退订链接退订回复类，回账号资料看开关；390×844 DPR3 触屏下 lihua 绑定、xiaoming 与游客各回复一次、退订全部、解绑；360×800 与 320×568 量「邮件提醒」标题栏。curl 复核一键退订：GET 303 不退订，改过 MAC 的令牌 404，别站 Origin 403，不带 Origin 的 One-Click POST 200 关掉 mention。证据 25 张（01、02 是 458999f 的改前图）与 manifest 在 /private/tmp/geek-evidence/149，d0f50e1 的旧图移到 149-old-d0f50e1
- 结果：游客回复的两封信主题都是「游客「极客班管理员」回复了你：…」，事实栏「极客班管理员（游客）」；成员的信没有「游客」。退订回复类之后再回复（n3）、点赞（n4）没有信，@提及（n5）照发。「邮件提醒」标题栏在 320、360（严格布局与触屏布局 371）、390 宽下 clientHeight=scrollHeight=55，说明两行。顺带看到：导航栏右上角头像在 360 宽超出 11px，触屏模式下布局视口被撑到 371；320 宽下「界面外观」的「主题」压在标题上；都不在 #149 改。corepack pnpm check 退出 0（文档同步 6 组、执行记录 44 条链路、密钥门禁、三份 typecheck）；pnpm --filter @yzgc/server build 退出 0。git merge-tree 对最新 origin/stage 38685d1 有冲突（services.ts、server README、data-model.md、notes/INDEX.md，来自 #129 等已合入的改动），留给主控决定怎么合

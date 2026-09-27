# task/148/mail_envelope · crosery · 2026-09-27

负责人：crosery

## 01:17:13 +08:00 · 开工 · #148 · 从 origin/stage 3c9d183188cf 建 task/148/mail_envelope

- 执行者：agent-claude-geek-main-08（Claude Code，claude-opus-5-5）
- 做了什么：node scripts/task.mjs start 148 mail_envelope：建分支与 worktree .claude/worktrees/task-148，在 issue 上留开工记录
- 结果：worktree 已建好，issue 上已留开工记录

## 02:29:51 +08:00 · 开发 · #148 · 信封模板、招新四封信与四个图片部件

- 执行者：agent-claude-geek-main-08（Claude Code，claude-opus-5-5）
- 做了什么：app/server/src/lib/mail/：envelope.ts（renderEnvelope 纯函数，输出主题、HTML、纯文本；转义、链接只放行 https 的 yangtzeu.work 与 prev.yangtzeu.work、assetBase 校验）、envelope-pieces.ts（部件清单）、recruitment.ts（投递成功、待面试、已录取、未通过）；scripts/mail-envelope/build.py 用官网的 nano-wave-560.webp 与 logo.png 生成 4 个 2 倍 PNG 部件（header 63877 字节、stamp 9492、seal 5449、airmail 791），输出在 /tmp/mail-envelope/assets，图片不入库；tests/server/mail-envelope.test.ts 13 条；docs/services/server/mail.md 与 README 源码地图、已知限制；在 ego 里按 640px、375px、深色模式看 sample-received.html，改了字体名双引号截断 style 属性的问题（加了 jsdom 解析的回归测试），落款去掉加粗
- 结果：vitest tests/server/mail-envelope.test.ts 13 passed；pnpm test 53 files、718 tests passed；pnpm check 通过；pnpm build 通过；变异检查：抬头不转义、放行 http、图片不走 assetBase、字体名用双引号，各有测试失败。预览 /tmp/mail-envelope/desktop.png、mobile.png、dark.png 截于落款去加粗之前。未验证：真实邮件客户端（QQ、网易、Gmail、Outlook、Apple Mail）、CDN 上传、实际发信
- 下一步：主会话把部件上传到 cdn.crosery.com/yzgc/mail/v1/，用 /tmp/mail-envelope/send-received.html 发一封样例；之后做发信商适配器、队列与发送记录

## 02:29:51 +08:00 · 提交 · #148 · 提交信封模板与招新四封信

- 执行者：agent-claude-geek-main-08（Claude Code，claude-opus-5-5）
- 做了什么：feat(server): 新增站内邮件信封模板与招新四封信（Refs #148）；跑过 pnpm check、pnpm test、pnpm build
- 结果：本地提交，未推送；检查结果见上一条

## 03:01:25 +08:00 · 开发 · #148 · 按复核意见改信封模板：长名断行、未通过信文案、回信地址、图片部件第二版

- 执行者：agent-claude-geek-main-08（Claude Code，claude-opus-5-5）
- 做了什么：envelope.ts：抬头、小字、正文、事实栏的值、列表、页脚加 word-break:break-word;overflow-wrap:anywhere；邮票格改成 29% 宽、图片 width:100%;max-width:150px；按钮格子加 mso-padding-alt；oneLine 把 U+2028/U+2029 换成空格；assetBase 默认只收 https，file:// 要 allowFileAssets；新增 replyTo（渲染结果带出，给发信模块写 Reply-To），正文请人回复却没有 replyTo 时抛 missing_reply_to；信纸圆角统一 4px。recruitment.ts：未通过信改成「这一轮没能请你加入极客班」「论坛不登录也能看帖，也可以用昵称回复」，原因由调用方传 reason；待面试的时间地点必填、replyTo 必填、摘要按有无面试说明拼；投递成功与已录取只有给了 replyTo 才写直接回复，否则指向官网意见箱。build.py：信封前袋的硬边换成沿开口的柔和阴影，邮戳换浅一点的蓝，火漆加浅色描边，航空条纹下角 4px，顶图 192 色，输出目录里的旧文件不再删除。新部件 header-653d0976.png 70922、stamp-5c638b76.png 9603、seal-e9c4d486.png 5983、airmail-4f4c24ba.png 781 字节，在 /tmp/mail-envelope/assets；docs/services/server/mail.md 与 README 源码地图同步
- 结果：vitest tests/server/mail-envelope.test.ts 18 passed；变异检查 10 项（抬头去掉断行、关掉回信检查、U+2028 不处理、默认放行 file://、旧的未通过文案、固定 150px 邮票格、去掉 mso-padding-alt、面试地点可空、总写直接回复）各有测试失败；build.py 连跑两次文件名相同。ego TaskSpace 239 里按 375px（2 倍屏）看四封信、40 个字符英文名、去掉 <style> 的版本共 12 个页面，scrollWidth 都等于 375，长名断成 3 行，去掉 <style> 时抬头一行、邮票 77px；640px 深色模式下邮戳和火漆轮廓看得清；截图 /tmp/mail-envelope/desktop.png、mobile.png、dark.png；TaskSpace 已 finish。未验证：真实邮件客户端、CDN 上传、实际发信

## 03:03:06 +08:00 · 提交 · #148 · 提交按复核意见改的信封模板

- 执行者：agent-claude-geek-main-08（Claude Code，claude-opus-5-5）
- 做了什么：fix(server): 按复核意见修信封模板的断行、文案与回信地址（Refs #148）；跑过 pnpm check、pnpm test、pnpm build（Node 22.23.2）。更正上一条：变异检查是 9 项，括号里列的就是全部，不是 10 项
- 结果：pnpm check 退出码 0（文档同步按 PR 对 origin/stage 通过，执行记录 31 条链路通过）；pnpm test 53 files、723 tests passed（mail-envelope 18）；pnpm build 退出码 0；本地提交，未推送
- 下一步：主会话把 /tmp/mail-envelope/assets 里的 4 个新部件上传到 cdn.crosery.com/yzgc/mail/v1/，再用 send-received.html 发样例；样例没有 replyTo，信里指向意见箱

## 11:17:27 +08:00 · 方案 · #148 · 投递状态改成四个，改状态时发对应的信，信里写全报名信息

- 执行者：agent-claude-geek-main-08（Claude Code，claude-opus-5-5）
- 做了什么：所有者 2026-09-27 11:02「别人投信之后回复别人是不是固定为小明头像了，取第一个姓名的第一个字，还有投递的那些所有信息去写这些信」、11:04「这个状态就改为 已收到，待面试，已录取，未通过， 而且改变状态之后会同步更新邮件发送过去」、11:09「邮件的提交时间也有问题……我们这边用的是北京时间」。定的做法：状态去掉评估中（旧的 reviewing 行改回 received，历史记录照常显示）；新表 mail_outbox 落库发信，同一事件只发一次，失败按 1 分钟、5 分钟、30 分钟、2 小时、6 小时重试，发完清掉收件地址和正文只留哈希；发信商阿里云在前、Resend 兜底，两家都没配时记「发信没有配置」；预发布只发白名单（MAIL_RECIPIENTS=allowlist）；投递成功发「已收到」，控制台改成待面试、已录取、未通过时发对应的信（可取消勾选），改回已收到不发；信里加「你的报名信息」（姓名、班级、邮箱、投递时间、报名编号），已收到的信附上特长与优点原文，抬头左边一个圆形头像写姓名第一个字；所有时间按 Asia/Shanghai；待面试没有回信地址时改成指向意见箱。分三块并行：server、console、deploy 与环境契约
- 结果：样例信里的「小明」只是发样例时填的名字，模板本来按投递人的姓名写抬头；现在全站还没接发信
- 下一步：server、console、deploy 三块并行实现，主会话集成验证

## 12:05:38 +08:00 · 开发 · #148 · 发信队列、四个投递状态、改状态发信、信里写全报名信息，按姓称呼

- 执行者：agent-claude-geek-main-08（Claude Code，claude-opus-5-5）
- 做了什么：三个子代理按 /tmp/t148/contract.md 并行实现，主会话集成：t148-server（mail_outbox、阿里云与 Resend 适配器、重试与租约、白名单、投递成功与改状态的触发、GET 详情带每封信的状态、四封信加「你的报名信息」与特长原文、北京时间、按姓称呼含 38 个复姓、去掉评估中并迁移）；t148-console（四个状态、通知投递人一栏与必填校验、提示与按钮随能不能发出而变、审核记录与确认信显示发信状态、控制台时间固定北京时间、样板数据）；t148-deploy（两份 env 的 MAIL_* 字段、可选密钥与阿里云成对校验、预发布必须 allowlist、compose、两个部署工作流的渲染步骤、deploy-manual、文档）。所有者 11:30 说明是按姓称呼（「张同学」），去掉了一度加上的头像。主会话另外发现 cdn.crosery.com 的 Referer 白名单对 https://mail.qq.com/ 回 403（不带 Referer 是 200），给每张图加 referrerpolicy="no-referrer" 并加测试
- 结果：pnpm verify 退出码 0：pnpm test 59 files / 898 tests，forum 30 files / 541 tests，build 与 forum generate 通过。变异：server 子代理 14 项全被抓到；referrerpolicy 去掉时测试失败。本机 harness（真实路由、临时 SQLite、假的 Resend 把信写到 /tmp/geek148/mails2）在 ego TaskSpace 254 里：1440 宽改成待面试不填时间地点提示两项必填，填好后「保存并发邮件」，审核记录「邮件：已发出」、确认信「已发出」；信里「张同学，你好：」「欧阳同学，你好：」、你的报名信息、投递时间 12:00（北京时间，当时是北京时间 12:00）、特长原文、四张图都加载；375 宽信件无横向滚动；390 宽不在白名单的投递改成未通过，提示「预发布只给白名单里的邮箱发信，这封不会发出」，按钮是「保存」，记录「预发布未发送（不在白名单）」，没有生成信。TaskSpace 已 finish。未验证：真实发信（阿里云、Resend）、QQ 等真实邮件客户端里的显示、referrerpolicy 在网页邮箱里是否生效
- 下一步：提交，独立审查，开 PR

## 12:06:23 +08:00 · 提交 · #148 · 77a80c6、d7ca6dc、3ef4f14：server、console、deploy 三个提交

- 执行者：agent-claude-geek-main-08（Claude Code，claude-opus-5-5）
- 做了什么：1e3ba09 合并 origin/stage（只含冲突的 server README 两处）；5295436 docs(notes) 并入 #164 暂存记录；77a80c6 feat(server)、d7ca6dc feat(console)、3ef4f14 feat(deploy)，按服务分组
- 结果：提交前 pnpm verify 退出码 0（check、test 898、build、forum:check 541、forum:generate）；本地提交，未推送
- 下一步：独立审查

## 13:02:33 +08:00 · 审查 · #148 · 独立审查 70dd959：有条件通过，没有阻塞项，6 条应修

- 执行者：agent-claude-geek-main-08（Claude Code，claude-opus-5-5）
- 做了什么：Workflow wf_764bfa5a-fbd：3 个只读审查代理（server、console、deploy 与文档）审 origin/stage...70dd959，每条应修和第一条建议再由一个代理反驳核对（共 12 个代理）。应修：1 PATCH 没有期望状态，两位审核人按旧画面先后改会给投递人发出互相矛盾的信；2 匿名投递可以反复给任意邮箱发带自定义文字的「已收到」，没有按收件人和全站的上限；3 配了 MAIL_REPLY_TO 又只有阿里云时 deliverable 仍是 true，控制台写「保存并发邮件」，信一定失败；4 面试时间、地点输入框里按回车会隐式提交并马上发信；5 server README 说发信回归矩阵见 TESTING，TESTING 没写；6 执行记录还没有 PR（核对为开 PR 之后的正常步骤，不算缺陷）。建议：超时后同一次尝试换 Resend 可能重复发、换发信商发出后 last_error 被清空；CSV 导出仍是 UTC；ENVIRONMENTS 与 render 提示说 SingleSendMail 不能逐封设 Reply-To，和 mail.md 矛盾；复姓清单里的单于；d7ca6dc 的 scope console 不在 COMMITS 词表；.env.example 与 ENVIRONMENT.md 没列 MAIL_*；待面试信的地点和说明发出后控制台看不到
- 结果：结论：有条件通过（无阻塞，应修待修）。代理跑过：server 82 条与 239 条测试通过、tsc、check-secrets、check-boundaries 通过；复现了旧画面两次 PATCH 发出 3 封信、同一地址投 5 次发出 5 封、只配阿里云加回信地址时 deliverable true 而信 failed、jsdom 里在面试地点按回车发出 1 次 PATCH。审查结论写进 PR 正文

## 13:02:33 +08:00 · 返工 · #148 · 按审查意见返工：期望状态、确认信上限、回车、回信地址、北京时间 CSV、文档

- 执行者：agent-claude-geek-main-08（Claude Code，claude-opus-5-5）
- 做了什么：server：PATCH 加 expected_status，和库里不同回 409 status_changed，UPDATE 带 AND status = ? 兜底，不写审核记录也不写信；mail_outbox 的 enqueue 加 limits，apply 传 RECEIVED_LETTER_LIMITS（同一邮箱 24 小时一封、全站每小时 200 封，只数不是 skipped 的），超出记 recipient_limited / rate_limited，投递照样成功，加两个索引；配了 MAIL_REPLY_TO 时只把能带 Reply-To 的发信商交给队列，只有阿里云时按 mail_disabled 处理；换发信商发出后 last_error 留着前一家的错误；新 lib/beijing-time.ts，CSV 列改 created_at_beijing、文件名日期按北京时间；复姓清单去掉单于。console：reviewPatch 总带 expected_status，409 时弹「没有保存」并重读详情；面试时间、地点输入框 @keydown.enter.prevent；两种新的不发原因的说法；样板同样回 409。deploy：render 提示与 ENVIRONMENTS 改成阿里云适配器还没写按封回信地址，规则 3 改成只有必填密钥失败关闭。docs：mail.md（上限、已知限制里补重复发送和地点看不到两条）、API、SECURITY 中英、data-model、console README、TESTING 回归矩阵与隔离、COMMITS 词表加 console、.env.example 与 ENVIRONMENT.md 列出 MAIL_*。建议里没改的：超时后换 Resend 的重复发送（改成等下一轮只会重复更多，写进已知限制）、地点和说明在控制台看不到（写进已知限制）。另外所有者 12:26 同意后，用 gh secret set 把 MAIL_ALIYUN_ACCESS_KEY_ID、MAIL_ALIYUN_ACCESS_KEY_SECRET、MAIL_RESEND_API_KEY 放进 GitHub preview 环境（值经标准输入传，没打印）；MAIL_ALLOWLIST 没配
- 结果：tsc 与 vue-tsc 通过；vitest tests/server tests/console tests/tooling/deployment-environment.test.ts 19 个文件 344 条通过；变异 13 项全被抓到（去掉收件人上限、去掉每小时上限、skipped 也计数、apply 不传上限、去掉期望状态核对、去掉回信地址过滤、丢掉换发信商前的错误、CSV 回到 UTC、文件名按 UTC、单于放回清单、控制台不带期望状态、样板不回 409、recipient_limited 的说法）。本机 harness 在 ego TaskSpace 3 里：同一邮箱第二次投递的确认信显示「没有发：24 小时内已经给这个邮箱发过确认信」、只发出 2 封；1440 宽在面试地点按回车，PATCH 0 次、审核记录 0 条；另一个会话先改成已录取后在旧画面点「保存并发邮件」，弹「没有保存 这份投递刚被别人改成了「已录取」，看过最新的状态再改」，状态刷新成已录取，信仍是 2 封；CSV 列 created_at_beijing 是 2026-09-27 13:00:04、文件名 applications-20260927.csv。TaskSpace 已 finish，harness 已停

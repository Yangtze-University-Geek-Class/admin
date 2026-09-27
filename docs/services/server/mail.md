# Server 站内发信（lib/mail）

> 招新的四封信怎么拼、怎么渲染、怎么排队发出去：信先写进 data.db 的发信队列，再由服务进程里的发信循环交给阿里云邮件推送或 Resend；信封版式照官网「加入我们」的信纸，图片部件放在 CDN 上。

状态：`current` · 更新：2026-09-27 · 源码：`app/server/src/lib/mail/` · 上级合同：[server](README.md) · issue：#148

## 现状

- 投递成功（`POST /api/portal/apply`）写一封「已收到」的信（同一个收件箱 24 小时内只发一封、同一个 IP 一小时最多 5 封且一天最多 20 封、全站每小时最多 200 封，见「上限」）；控制台把投递改成待面试、已录取、未通过（`PATCH /api/console/applications/:application_id`）时写对应的一封，改回已收到、只写备注、取消勾选「发信」都不写。
- 信写进 `mail_outbox`（[数据模型](data-model.md)），同一件事只有一行。服务进程里的发信循环每 15 秒把到期的信发一遍，写进新信后立刻再发一遍。
- 发信商按顺序是阿里云邮件推送（SingleSendMail）、Resend。两家都没配置时信照样写一行，记成 `skipped` / `mail_disabled`，不发。
- 控制台的投递详情显示「已收到」那封和每次改状态那封的结果（`received_mail`、`reviews[].mail`），见 [API](../../architecture/API.md)。
- 源码：`envelope.ts`（渲染）、`envelope-pieces.ts`（图片部件清单）、`recruitment.ts`（四封信的内容）、`outbox.ts`（发信队列与发信循环）、`providers.ts`（两家发信商）、`mailer.ts`（按配置组装，给路由用）。部件生成脚本 `scripts/mail-envelope/build.py`。
- 还没有：CID 内嵌图片、退信与投诉回调、真实发信商上的收发验证。成员绑定邮箱、站内通知发邮件、退订在 #149。

## 接口

```ts
renderEnvelope(message: EnvelopeMessage, { assetBase, allowFileAssets? }): { subject, html, text, replyTo }
recruitmentMessage(kind: "received" | "interview" | "accepted" | "rejected", input): EnvelopeMessage

// services.mail（mailer.ts）
mail.recruitmentLetter(kind, application, letter?): RenderedMail   // 按投递拼信并渲染，内容不合规抛 MailTemplateError
mail.enqueue({ eventKey, kind, applicationId?, reviewId?, to, mail }, limits?): { id, status, created }
mail.summary(eventKey) / mail.reviewSummaries(reviewIds)            // 给控制台看的结果，没有地址和正文
mail.enabled / mail.recipients / mail.deliverable(address)
mail.drain() / mail.start(logger) / mail.stop()
```

- `EnvelopeMessage`：主题、收件箱摘要（preheader）、信纸左上角的小字、抬头、正文块（`paragraph` 段落、`facts` 两列事实栏，可带标题、`list` 编号列表，空条目会去掉、`quote` 带标题的多行引用）、可选按钮、落款日期、页脚几行字、页脚的站点链接、可选的回信地址 `replyTo`。以后的站内通知（#149）只要拼出同样的结构就能复用版式。
- `assetBase`：图片部件的地址前缀，必须以 `/` 结尾，只能是 `https://`（正式发信用 `https://cdn.crosery.com/yzgc/mail/v1/`）。本机预览要用 `file://` 时显式传 `allowFileAssets: true`；发信时不传，配置写错成 `file://` 会直接抛错，不会发出一封图片全失效的信。
- 发件人名是 `MAIL_SENDER_NAME`（长江大学极客班），发信模块写 `From` 头时用同一个常量。
- 四封信与控制台投递状态对应（`lib/roles.ts` 的 `APPLICATION_STATUSES`，只有这四个）：
  - `received` 已收到：投递成功时发，附上投递人写的特长与优点原文（`quote`，一行一行照写、经过转义）。
  - `interview` 待面试：时间和地点必填（空的直接抛 `MailTemplateError`，控制台接口先回 400 `letter_required`），面试说明可选、一行一条；收件箱摘要写时间和地点，有面试说明时才加一句「面试说明在信里」。
  - `accepted` 已录取：控制台填的「接下来」一行一条，没填时写「接下来的安排我们会另外发邮件告诉你」。
  - `rejected` 未通过：只写「这一轮没能请你加入极客班」，不替每个人写原因；改状态的人填了原因才单独成一段。论坛那句照论坛的规则写：不登录也能看帖，也可以用昵称回复（[forum](../forum/README.md)）。
- 每封信都有「你的报名信息」：姓名、班级、邮箱、投递时间、报名编号，收信人能核对是哪一份报名。
- 抬头按姓称呼（所有者 2026-09-27，`recruitment.ts` 的 `greetingFor`）：汉字开头的名字取姓，张三写「张同学，你好：」；以复姓清单（`COMPOUND_SURNAMES`，欧阳、司马、上官、诸葛等 37 个）里的一个开头、并且至少三个字的，按复姓，欧阳娜娜写「欧阳同学，你好：」；清单里没有「单于」（它是称号，姓单、名字以「于」开头的单于洋写「单同学，你好：」）；只有两个字的名字分不清是复姓还是姓加名，一律按单姓，欧阳写「欧同学，你好：」。不是汉字开头的名字照写全名，以字母结尾时中间空一格（「Alice 同学，你好：」）；姓名是空白时只写「你好：」。取姓之前先去掉控制字符；按码点取，不会切开补充平面的汉字。「你的报名信息」里仍写全名。信里没有头像。
- 信里的时间和日期（投递时间、落款日期）一律按北京时间写，与服务器的时区无关（容器是 UTC）：`formatMailDate` / `formatMailDateTime` 按 UTC+8 算（中国不用夏令时），投递时间后面写明「（北京时间）」。面试时间是审核人照北京时间填的文字，原样写进信里。
- 控制台审核时填的备注只给审核人看，不进信里。

## 回信

信里请对方「直接回复这封邮件」，就必须有人能收到回信。代码里是这样保证的：

- `EnvelopeMessage.replyTo` 是回信地址，渲染结果原样带出 `replyTo`（没有时是 `null`）。发信模块必须把它写进 `Reply-To` 头；它应当是有人在看的邮箱（例如 Email Routing 会转发到值班成员的地址）。
- 回信地址来自 `MAIL_REPLY_TO`，两个环境现在都留空。招新的信只有给了 `replyTo` 才写「直接回复这封邮件」；没给时，已收到和已录取的信写「可以到官网的意见箱留言，联系方式一栏填这个邮箱」，待面试的信写「这个时间来不了的话，到官网的意见箱留言，联系方式一栏填这个邮箱，我们再约。」
- `renderEnvelope` 还会检查我们写的段落、列表和摘要：出现「回复这封邮件」「回复这封信」「直接回信」却没有 `replyTo` 的，抛 `MailTemplateError`（`missing_reply_to`）；控制台改状态时审核人自己写了这几个字，接口回 400 `letter_invalid`，状态不改。事实栏和引用是投递人自己填的内容，不查。以后的站内通知照样受这条约束。
- `replyTo` 只收一个普通的 `local@domain` 地址：带空白、换行、尖括号、逗号、分号的，或者域名里没有点的，抛 `invalid_reply_to`，拼进 `Reply-To` 头时不会多出一行或多一个收件人。

## 发信

- 发信商：阿里云邮件推送在前，Resend 兜底。一家的密钥和发件地址都配了才算配置好；一次尝试里前一家失败就试下一家，都失败才算这次失败。
  - 阿里云：`POST https://dm.aliyuncs.com/`，`Action=SingleSendMail`，API 版本 `2015-11-23`，地域 `cn-hangzhou`，RPC 签名 v1（HMAC-SHA1，参数排序后按 RFC 3986 编码，密钥是 AccessKeySecret 加 `&`，见[阿里云签名机制](https://help.aliyun.com/zh/direct-mail/signature)；测试用文档里的例子核对签名）。`AccountName` 是 `MAIL_ALIYUN_FROM`，`AddressType=1`，`ReplyToAddress=false`，发件人名 `FromAlias=长江大学极客班`，HTML 和纯文本都带上。
  - Resend：`POST https://api.resend.com/emails`，`Authorization: Bearer <MAIL_RESEND_API_KEY>`，发件人 `长江大学极客班 <MAIL_RESEND_FROM>`，有回信地址时写 `reply_to`。每封信带一个重试时不变的 `Idempotency-Key`（事件、收件地址哈希和建信时间的 sha256），上一次其实发出去了（例如进程在记下结果前退出）时 Resend 在 24 小时内不会再发一次。
  - 带回信地址的信只交给 Resend：阿里云这一边不写按封的 Reply-To（原因见「已知限制」）。配了 `MAIL_REPLY_TO` 时每封信都带回信地址，`mailer.ts` 只把能带 Reply-To 的发信商交给发信队列；只配了阿里云时按没有配置发信商处理，信记成 `skipped` / `mail_disabled`，控制台的 `mail.enabled`、`deliverable` 都是 false，不会说「保存并发邮件」。发信队列里还留着一道检查：真有一封带回信地址的信没有发信商能发时，记成 `failed`，`last_error` 是 `reply_to_unsupported`。
- 请求只用全局 `fetch` 和 `node:crypto`，没有新增依赖；每个请求 15 秒超时。测试注入假的 `fetch`（`ServiceOverrides.mailFetch`），`tests/server/helpers.ts` 默认拒绝任何发信请求。
- 发信循环只在服务进程里开：`index.ts` 调 `buildApp({ mailWorker: true })`，应用就绪时开始、每 15 秒一轮，`app.close()` 时打断正在发的请求、等这一轮收尾再关库（被打断的那次按一次失败记）。测试不开循环，直接调 `mail.drain()`，时钟用 `ServiceOverrides.clock`。
- 配置（都是可选的，都不设时服务照常启动、不发信）：`MAIL_ALIYUN_ACCESS_KEY_ID` 与 `MAIL_ALIYUN_ACCESS_KEY_SECRET`（两个要么都有、要么都没有，只有一个时启动失败）、`MAIL_ALIYUN_FROM`、`MAIL_RESEND_API_KEY`、`MAIL_RESEND_FROM`、`MAIL_ASSET_BASE`（不写时是 `https://cdn.crosery.com/yzgc/mail/v1/`）、`MAIL_REPLY_TO`、`MAIL_RECIPIENTS`、`MAIL_ALLOWLIST`。发件地址和回信地址只收一个普通的邮箱地址，`MAIL_ASSET_BASE` 只收以 `/` 结尾的 https 地址，写错时启动失败，错误信息不带配置的值。每个环境的取值见 [ENVIRONMENTS](../../ops/ENVIRONMENTS.md)。
- 信里的链接指向 `PUBLIC_ORIGIN`（正式或预发布站点）；本机和测试的 `PUBLIC_ORIGIN` 不是这两个站点时，链接指向正式站点 `https://yangtzeu.work`。

## 重试

- 同一件事只有一行：`event_key` 唯一，写入用 `INSERT OR IGNORE`。已收到的信是 `application:<投递 id>:received`，改状态的信是 `review:<审核记录 id>`，重复触发不会多发。
- 发信循环领一封信时把它改成 `sending`，尝试次数加一，并把 `next_attempt_at` 推到 5 分钟以后当租约：进程在发信中途退出，5 分钟后这封信被重新领走；已经试满 6 次的不再领，记成 `failed`（`lease_expired`）。
- 一次尝试失败后分别等 1 分钟、5 分钟、30 分钟、2 小时、6 小时再试，第 6 次失败记成 `failed`，不再重试。
- 发信之前再核对一次发信商和白名单：重启后没有发信商了记 `mail_disabled`，不在白名单里了记 `not_allowlisted`。
- 前一家失败、后一家发出时，信记成 `sent`，前一家的错误摘要留在 `last_error`（例如阿里云拒收、Resend 发出），看得出为什么走了后一家。

## 白名单

- `MAIL_RECIPIENTS=all` 发给所有人（正式环境）；`allowlist` 只发给 `MAIL_ALLOWLIST` 里的地址（预发布），逗号分隔、不分大小写，其余的信写进队列时就记成 `skipped` / `not_allowlisted`。不写 `MAIL_RECIPIENTS` 时按 `allowlist` 处理，白名单也是空的，谁也不发。
- 控制台的 `mail.deliverable` 说的是「现在给这份投递写信会不会真的发出去」：有发信商、并且（`all` 或地址在白名单里）。

## 上限

投递接口不用登录，谁都能在表单里填别人的邮箱，每投一次服务器就以「长江大学极客班」的名义发一封带投递人自己写的文字（姓名、特长原文）的信。所有者 2026-09-27 14:20：「邮件不要做限制吧，不然我这边收不到邮件，没法测试。我们官方发的那些邮件，肯定必须发过去。」「为了防止别人申请时盗刷，可以在申请时限制一个设备或一个IP最多申请5次，也就是只能申请5个邮件。」所以防盗刷放在投递这一步，信本身基本不限（#169）：

- 投递次数：同一个来源 IP（IPv6 按 /64，`forum-rules.ts` 的 `ipSubject`）、同一个设备各自在滚动的 24 小时里最多 5 份成功的投递，第 6 份回 429 `apply_limited`，不落库、不发信（`apply.ts` 的 `APPLY_LIMITS`，计数在 `application_limits` 表，见 [数据模型](data-model.md)）。设备是投递接口自己发的 cookie `yugc_apply_device`（httpOnly，只发给 `/api/portal/apply`，一年），清掉 cookie 或换浏览器就算新设备，主要靠 IP 这一道。每个 IP 每分钟 5 次的请求限流另外算。
- 每份成功的投递都写一封「已收到」，同一个邮箱投几次就发几封。只剩全站一小时 200 封（`mailer.ts` 的 `RECEIVED_LETTER_LIMITS`，和论坛游客回复的全站上限一样），到了记成 `skipped` / `rate_limited`：防止有人换很多 IP 刷，把发信商的额度用完、改状态的正式通知发不出去。只数真的要发的信，不数 `skipped` 的。
- 改状态的信（待面试、已录取、未通过）要有「审核投递」能力才能触发，不设上限。
- 发信队列还支持按收件箱（`recipientWindowMs`，按 `limitKey` 归并：不分大小写、去掉 `+` 标签、域名按 IDNA 转成 ASCII 并去掉末尾的点、Gmail 忽略本地部分的点）和按来源（`perSourceHour`、`perSourceDay`，`source_hash`）限量，#148 时确认信用过，#169 起不用；控制台仍认得这几种旧记录（「24 小时内已经给这个邮箱发过确认信」「同一个网络这段时间投递得太多」）。投递接口照旧不收域名末尾带点、连续两个点、带引号或反斜杠的本地部分和 IP 字面量，官网表单用同一条正则。
- 共用出口（校园网、宿舍、热点，或 IPv6 同一个 /64）的人算同一个 IP：一天里第 6 个人投不了，页面写「同一台设备或同一个网络 24 小时内最多投递 5 次」，第二天可以再投。招新集中投递那几天如果有人反映投不进去，调 `APPLY_LIMITS`。
- 剩下的风险：换 IP、清 cookie 的人每个 IP 每天仍能投 5 份、发 5 封带自己文字的信给任意邮箱，同一个收件箱可能从不同 IP 收到多封；Turnstile 没开时（两个环境现在都没开，见 [ENVIRONMENTS](../../ops/ENVIRONMENTS.md)），拦批量投递的还有每个 IP 每分钟 5 次、工作量证明和蜜罐。见 [SECURITY](../../architecture/SECURITY.md)。

## 隐私

- 信到了最终状态（`sent`、`failed`、`skipped`）就把收件地址、HTML 和纯文本改成 NULL；不发的信写入时就不存这三样。留下的是收件地址的 sha256（去掉首尾空白、转小写之后算）、主题、结果、尝试次数、发信商和对方的消息编号。还没发出的信（`pending`、`sending`）在库里带着收件地址和正文，最长到第 6 次失败，约 8 个半小时。
- `last_error` 只有发信商名、HTTP 状态和对方的错误码（发出的信也可能有，是换发信商之前那一家的错误）（只留字母、数字和 `. _ -`，最长 64 个字符），例如 `aliyun http 400 InvalidMailAddress.NotFound; resend http 500 internal_server_error`，不含密钥、地址、正文和对方回答的原文；网络错误只记错误类型名。日志只记信的编号、种类、次数和同样的错误摘要。
- 审计 `application.review` 的 details 多了 `mail`（这次改状态有没有写信），不记信的内容。
- 投递的「已收到」写不进队列（模板出错、写库失败）时，投递照样成功，服务端只记一条带投递编号和错误码的日志。

## 安全

- 所有动态文字（姓名、班级、面试时间地点、按钮文字、页脚）都经过 HTML 转义；控制字符和双向文字控制符在渲染前去掉。
- 主题、抬头、事实栏是单行文字：换行、制表符和 U+2028 / U+2029（有的客户端会显示成换行）都变成空格，主题里不会混进 `\r\n`，发信时不会被拼出额外的邮件头。
- 按钮和页脚链接只接受 `https` 的 `yangtzeu.work` 与 `prev.yangtzeu.work`，不能带账号或端口；`javascript:`、`http:`、`data:`、其它域名一律抛 `MailTemplateError`，不会降级成纯文字。
- 纯文本版本不转义（`text/plain` 不会被当成 HTML），同样去掉控制字符。

## 版式与邮件客户端

- 宽 600px，表格布局加内联样式；`<style>` 里只有两组媒体查询：深色模式（`prefers-color-scheme: dark`，换深色信纸和浅色字）与窄屏（620px 以下收紧内边距、邮票缩到 104px）。不支持 `<style>` 的客户端照样能读浅色版。
- 邮票那一格按比例占 29%（图片 `width:100%;max-width:150px`，`width` 属性仍是 150 给 Outlook 桌面版）。
- 抬头要折行时折在最后一个「，」后面（「你好：」包在 `white-space:nowrap` 里），不会折成「…同学，你 / 好：」；前面的名字照常断行（长英文名）。
- 抬头、小字、正文段落、事实栏的值、列表条目和页脚都写了 `word-break:break-word;overflow-wrap:anywhere`：报名表允许的 40 个字符的英文名在 375px 宽时断成几行，不会把信撑出横向滚动。
- 不用 flex、grid、position、CSS 变量、脚本、网络字体和外链样式表；字体栈用系统字体（PingFang SC、微软雅黑、Noto Sans SC）。
- 每个背景色同时写 `bgcolor` 属性；Outlook 桌面版用 `<!--[if mso]>` 包一层 600px 的表格；按钮的内边距写在链接上，按钮格子上另写 `mso-padding-alt`，Outlook 桌面版忽略链接的内边距时用它；圆角在 Outlook 桌面版里是直角。
- 信纸的圆角和官网 `.pt-letter` 一样是 4px（上沿、下沿和航空条纹的两个角）。官网信纸每 34px 一条横格线，邮件里没有做：横格线只能用背景图，Outlook 桌面版不显示背景图，其它客户端也可能拦截，做了会让不同客户端看到的信纸不一样。
- 每张图片都写了 `width`、`height`、`alt`；图片被拦截时只剩顶图的替代文字「长江大学极客班」，其余部件的 `alt` 为空，正文不受影响。
- 一封信的 HTML 约 15 到 18KB（Gmail 超过 102KB 会截断），测试里用 30 条长说明、2000 字的特长加 40 个字的名字各压过一次，仍在 102KB 以内。

## 图片部件

| 部件 | 文件（v1） | 字节 | 显示尺寸 | 内容 |
|---|---|---|---|---|
| `header` | `header-653d0976.png` | 70922 | 600×220 | 极客娘（官网开机画面的 `nano-wave-560.webp`）在信纸后面挥手，旁边一只拆开的航空信封；透明底，底边就是信纸上沿 |
| `stamp` | `stamp-5c638b76.png` | 9603 | 150×100 | 带齿孔的邮票（校徽 + 极客班）和 YUGC 邮戳，照 `three/join.ts` 信封地址面；邮戳用比钴蓝浅的 `#5a6ee6`，深色模式的信纸上也看得清 |
| `seal` | `seal-e9c4d486.png` | 5983 | 72×72 | 落款旁的钴蓝火漆，压着校徽，边上一圈浅色描边，深色模式下能看出轮廓 |
| `airmail` | `airmail-4f4c24ba.png` | 781 | 600×12 | 信纸下沿的钴蓝与琥珀航空条纹，条纹之间透明，下面两个角 4px |

- 全部按 2 倍像素导出，pngquant 量化后再用 oxipng 压缩；顶图量化到 192 色、不抖动（128 色时头发暗部有色阶），约 69KB，其余三张都在 10KB 以内。四张都要透明底，所以都是 PNG。
- 文件名带内容 sha256 的前 8 位，换图就换名字，已发出的邮件继续指向旧图；`envelope-pieces.ts` 里的文件名要和上传的文件一致。
- 图片不进仓库、不进 server 镜像。生成：`python3 scripts/mail-envelope/build.py . /tmp/mail-envelope/assets`（需要 `resvg`、`pngquant`、`oxipng` 与 Python 的 Pillow），同样的输入连跑两次文件名相同。输出目录里的 `MANIFEST.txt` 列出这一次生成的文件、字节数和像素尺寸；以前生成的文件留在目录里不删。原图只用仓库里官网正在用的 `app/web/public/portal/nano-wave-560.webp` 与 `app/web/public/logo.png`；配色取自 `three/join.ts` 与 `styles/scenes.css`。生图参考只用来定版式，不进部件。
- 上传到 CDN 的 `yzgc/mail/v1/` 由维护者手动做，不在 CI 里；换了任何一张图，重新生成、上传新文件、改 `envelope-pieces.ts`，旧文件留着不删。

## 验证

```bash
pnpm exec vitest run tests/server/mail-envelope.test.ts tests/server/mail-outbox.test.ts tests/server/applications.test.ts
```

`tests/server/applications.test.ts` 的「how often one device or network can apply」覆盖投递次数：同一个 /64 里第 6 份回 429 `apply_limited`、不落库也不写信，别的 IP 照常；同一个 cookie 换着 IP 投，第 6 份同样 429，cookie 是 httpOnly、只发给投递接口、一年，清掉 cookie 算新设备，伪造的 cookie 换成新的 id；校验不过、蜜罐不算次数；过了 24 小时可以再投，过期的计数被删掉；`application_limits` 里只有哈希。

`tests/server/mail-outbox.test.ts` 覆盖：投递写且只写一封「已收到」，发出后只剩哈希和主题；同一个邮箱（不分大小写、带空白）投两次发两封，改状态的信照常写；末尾带点、连续的点、以点开头的域名、带引号或反斜杠的本地部分、IP 字面量投递时回 400（官网表单的正则和后端逐字一致，在 `tests/web/portal-join.test.ts`）；发信队列按收件箱限量时 `+` 标签、Gmail 的点、`googlemail.com`、全角字母和全角句点写的域名、域名里的零宽字符、中文域名和它的 punycode 算同一个收件箱，过了窗口再发；按来源的一小时、一天两个窗口各自计数，没有来源时不查；不会发出的信不占名额；同一种信一小时到上限后记 `rate_limited`，别的种类不算，过了一小时再发；同一个 `event_key` 两次只有一行、只发一封；信写不进队列时投递照样成功；蜜罐不写信；没配置发信商记 `mail_disabled`、白名单模式下不在白名单的记 `not_allowlisted`（不分大小写），都不留地址和正文；配置只有一把阿里云密钥、`MAIL_RECIPIENTS` 写错、回信地址带换行、发件地址带尖括号、`MAIL_ASSET_BASE` 不是 https 时启动失败，错误信息不带配置的值；阿里云失败换 Resend（发出后 `last_error` 留着阿里云的错误），阿里云请求的参数与签名、Resend 的请求头和正文；阿里云文档里的签名例子；按 1 分钟、5 分钟、30 分钟、2 小时、6 小时重试，第 6 次失败放弃并清掉地址和正文，`last_error` 不带密钥、地址、姓名和对方回答的原文；重试时 `Idempotency-Key` 不变；租约过期的 `sending` 重新发、租约没过期的不动；带回信地址的信只走 Resend，配了回信地址又只有阿里云时按没有配置处理（`mail_disabled`，详情里 `enabled`、`deliverable` 是 false）；服务进程开着发信循环时写进新信后马上发出、`app.close()` 能停下；控制台改成评估中或别的值回 400 `invalid_status`；改成待面试没填时间地点回 400 `letter_required`、状态和审核记录都不变；两位审核人从同一个旧画面先后改，第二次带着旧的 `expected_status`、`expected_review_id` 回 409 `status_changed`、不写审核记录也不写信，只补备注也要带最新的记录；别人改走又改回（状态一样、审核记录多了）同样 409，服务器时钟往回拨过、新记录按时间排在后面时也一样（版本号取最大的 id）；改状态却不带这两项（旧页面）回 409「这个页面是旧版本」，只补备注可以不带；待面试、已录取、未通过的信带上审核人填的内容、不带内部备注，投递详情里能看到每封信的结果；审核人没配回信地址却写「直接回复这封邮件」回 400 `letter_invalid`；`notify: false`、改回已收到、只写备注都不写信。旧的「评估中」启动时改回「已收到」、审核历史不动、再启动不再改，在 `tests/server/legacy-database.test.ts`。

`tests/server/mail-envelope.test.ts` 覆盖：四封信都能渲染；恶意姓名 `<img src=x onerror=alert(1)> & "q"` 在 HTML 的每个位置都被转义；`javascript:`、`http:`、其它域名、带账号或端口的链接被拒绝；纯文本版本有编号、时间、地点等关键事实；四封信都有「你的报名信息」（姓名、班级、邮箱、投递时间、报名编号）；已收到的信完整引用特长与优点（转义、按行换行、只在这一封里），投递人自己写了「回复这封邮件」不算请人回信；2000 字的特长加 40 个字的名字仍小于 102KB；抬头按姓称呼（张三、李小满、欧阳娜娜、司马光、叱干阿利、清单里每个复姓加一个字、两个字的欧阳按单姓、不在清单里的张王五按单姓、补充平面的汉字、Alice、空白名字），事实栏仍写全名，抬头的「你好：」不拆开，四封信里都没有头像，恶意姓名在抬头里照写全名并转义，控制字符先去掉再取姓；进程时区是 UTC、洛杉矶、上海时，`2026-09-27T03:00:00Z` 都写成「2026 年 9 月 27 日 11:00」，落款日期同样按北京时间；没有外链样式表、脚本、flex、grid、position；解析后的属性都合法、内联样式真的生效（字体名曾经用双引号，把 `style` 属性截断过）；图片地址都以 `assetBase` 开头并带宽高和替代文字，`file://` 只在 `allowFileAssets` 时放行；主题里没有换行和 U+2028 / U+2029；HTML 小于 102KB；未通过的信不再写「论坛对所有人开放」和名额的理由，传了 `reason` 才有原因；给了 `replyTo` 才请人回信，待面试的信没有 `replyTo` 时指向意见箱，自定义的信请人回复却没有 `replyTo`、`replyTo` 带换行或多个地址都抛错；待面试的时间地点不能为空，没有面试说明时摘要不提；抬头等动态文字带断行规则、邮票格按比例；按钮格子带 `mso-padding-alt`。

## 已知限制

- 结果不明的失败也会换下一家：阿里云其实收下了、只是 15 秒内没回应（或回应读到一半断了）时，这一次尝试接着交给 Resend，投递人会收到两封一样的信。部署时 `app.close()` 打断正在发的请求，下一轮还是先发阿里云，阿里云没有按封的去重，同样可能重复。这两种都只在超时或断线时出现，没有改：把结果不明的当成失败、只等下一轮重试阿里云，重复反而可能更多。
- 审核人写进信里的面试时间以外的内容（地点、面试说明、已录取的「接下来」、未通过的原因）只在信里：信发出后正文就清掉，控制台里只看得到主题（待面试的主题带面试时间）。另一位审核人要知道地点，得看备注。

- 真实发信只在预发布发过：2026-09-27 v0.1.0-rc.13 上投递一份，发信商收下（控制台「确认信 已发出」，试了 1 次）；收件箱里的样子由所有者看。
- 阿里云这边不写按封的回信地址：[SingleSendMail 的官方文档](https://help.aliyun.com/zh/direct-mail/api-dm-2015-11-23-singlesendmail)（2026-09-27 看过）列有可选参数 `ReplyAddress`、`ReplyAddressAlias`，适配器还没用，因为没有用真实的发信试过。要用时把 `providers.ts` 里阿里云的 `supportsReplyTo` 改成 true、把 `ReplyAddress` 传上去，再真发一封核对回信地址。现在两个环境的 `MAIL_REPLY_TO` 都是空的，没有信依赖它。
- 没有退信、投诉回调，也不按退信停发；`sent` 只说明发信商收下了这封信。
- 同一进程只跑一个发信循环；同一环境只有一个 server 容器（[server](README.md)「已知限制」），没有多进程抢同一封信的处理。阿里云没有按封的去重，租约过期重发时，上一次如果其实发出去了，对方会收到两封。
- 信在写进队列时渲染，落款日期是写进队列那天；重试拖过北京时间零点时，落款日期比实际发出早一天。
- 还没有在真实邮件客户端里看过（QQ 邮箱、网易、Gmail、Outlook、Apple Mail），只在 Chromium 里按 640px、375px、去掉 `<style>` 的 375px 和深色模式看过预览（2026-09-27 按 375px、去掉 `<style>` 的 375px 和 640px 深色模式又看过「你的报名信息」和特长引用）。
- 强制反色的客户端（Outlook.com、部分手机 App 的深色模式）不认媒体查询，会自己改背景和字色；图片部件都是透明底，不会出现白色色块，但颜色以客户端为准。
- 图片走 CDN，没有 CID 内嵌。`cdn.crosery.com` 开了 Referer 白名单：2026-09-27 实测不带 Referer 取图是 200，带 `https://mail.qq.com/` 或本机页面的 Referer 是 403。所以每张 `<img>` 都写了 `referrerpolicy="no-referrer"`（`envelope.ts` 的 `img`），浏览器和认这个属性的网页邮箱取图时不带 Referer。QQ 邮箱、网易等网页邮箱会不会去掉这个属性、或者自己代理取图，还没有用真实发信核对；如果信里的图仍然出不来，要么在七牛的 Referer 白名单里加上这些邮箱的域名，要么改成 CID 内嵌。
- 没有 `replyTo` 时信里指向官网意见箱；意见箱的内容和回复是公开的，只有联系方式一栏不公开。

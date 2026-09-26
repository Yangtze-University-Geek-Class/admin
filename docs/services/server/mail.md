# Server 邮件信封模板（lib/mail）

> 站内邮件共用的信封模板：一个纯函数把一封信渲染成主题、HTML 和纯文本，版式照官网「加入我们」的信纸；图片只做几个固定尺寸的部件，放在 CDN 上。

状态：`current` · 更新：2026-09-27 · 源码：`app/server/src/lib/mail/` · 上级合同：[server](README.md) · issue：#148

## 现状

- 已有：`renderEnvelope`（`envelope.ts`）、图片部件清单（`envelope-pieces.ts`）、招新四封信的内容（`recruitment.ts`）、部件生成脚本 `scripts/mail-envelope/build.py`、回归测试 `tests/server/mail-envelope.test.ts`。
- 还没有：发信商适配器、发信队列与重试、发送记录、预发布白名单、控制台改投递状态时触发发信、CID 内嵌图片。这些都在 #148 后续的提交里做；成员绑定邮箱、站内通知发邮件、退订在 #149。
- 所以现在全站仍然不发任何邮件，模块也没有被任何路由导入。

## 接口

```ts
renderEnvelope(message: EnvelopeMessage, { assetBase, allowFileAssets? }): { subject, html, text, replyTo }
recruitmentMessage(kind: "received" | "interview" | "accepted" | "rejected", input): EnvelopeMessage
```

- `EnvelopeMessage`：主题、收件箱摘要（preheader）、信纸左上角的小字、抬头、正文块（`paragraph` 段落、`facts` 两列事实栏、`list` 编号列表，空条目会去掉）、可选按钮、落款日期、页脚几行字、页脚的站点链接、可选的回信地址 `replyTo`。以后的站内通知（#149）只要拼出同样的结构就能复用版式。
- `assetBase`：图片部件的地址前缀，必须以 `/` 结尾，只能是 `https://`（正式发信用 `https://cdn.crosery.com/yzgc/mail/v1/`）。本机预览要用 `file://` 时显式传 `allowFileAssets: true`；发信时不传，配置写错成 `file://` 会直接抛错，不会发出一封图片全失效的信。
- 发件人名是 `MAIL_SENDER_NAME`（长江大学极客班），发信模块写 `From` 头时用同一个常量。
- 四封信与控制台投递状态对应（`lib/roles.ts` 的 `APPLICATION_STATUSES`）：
  - `received` 投递成功：编号、提交时间、班级。
  - `interview` 待面试：时间和地点必填（空的直接抛 `MailTemplateError`），面试说明可选；收件箱摘要写时间和地点，有面试说明时才加一句「面试说明在信里」。
  - `accepted` 已录取：接下来要做的事、可选按钮。
  - `rejected` 未通过：只写「这一轮没能请你加入极客班」，不替每个人写原因；改状态的人想说明原因时传 `reason`，单独成一段。论坛那句照论坛的规则写：不登录也能看帖，也可以用昵称回复（[forum](../forum/README.md)）。
  - 「评估中」不发信。

## 回信

信里请对方「直接回复这封邮件」，就必须有人能收到回信。代码里是这样保证的：

- `EnvelopeMessage.replyTo` 是回信地址，渲染结果原样带出 `replyTo`（没有时是 `null`）。发信模块必须把它写进 `Reply-To` 头；它应当是有人在看的邮箱（例如 Email Routing 会转发到值班成员的地址）。
- 招新的信只有给了 `replyTo` 才写「直接回复这封邮件」；没给时，投递成功和已录取的信改写「可以到官网的意见箱留言，联系方式一栏填这个邮箱」。待面试的信要能回信改时间，`InterviewInput.replyTo` 是必填字段。
- `renderEnvelope` 还会检查正文和摘要：出现「回复这封邮件」「回复这封信」「直接回信」却没有 `replyTo` 的，抛 `MailTemplateError`（`missing_reply_to`）。以后的站内通知照样受这条约束。
- `replyTo` 只收一个普通的 `local@domain` 地址：带空白、换行、尖括号、逗号、分号的，或者域名里没有点的，抛 `invalid_reply_to`，拼进 `Reply-To` 头时不会多出一行或多一个收件人。

## 安全

- 所有动态文字（姓名、班级、面试时间地点、按钮文字、页脚）都经过 HTML 转义；控制字符和双向文字控制符在渲染前去掉。
- 主题、抬头、事实栏是单行文字：换行、制表符和 U+2028 / U+2029（有的客户端会显示成换行）都变成空格，主题里不会混进 `\r\n`，发信时不会被拼出额外的邮件头。
- 按钮和页脚链接只接受 `https` 的 `yangtzeu.work` 与 `prev.yangtzeu.work`，不能带账号或端口；`javascript:`、`http:`、`data:`、其它域名一律抛 `MailTemplateError`，不会降级成纯文字。
- 纯文本版本不转义（`text/plain` 不会被当成 HTML），同样去掉控制字符。

## 版式与邮件客户端

- 宽 600px，表格布局加内联样式；`<style>` 里只有两组媒体查询：深色模式（`prefers-color-scheme: dark`，换深色信纸和浅色字）与窄屏（620px 以下收紧内边距、邮票缩到 104px）。不支持 `<style>` 的客户端照样能读浅色版。
- 邮票那一格按比例占 29%（图片 `width:100%;max-width:150px`，`width` 属性仍是 150 给 Outlook 桌面版）：不支持 `<style>` 的客户端在 375px 宽的屏幕上邮票缩到约 77px，抬头「小明同学，你好：」仍在一行。
- 抬头、小字、正文段落、事实栏的值、列表条目和页脚都写了 `word-break:break-word;overflow-wrap:anywhere`：报名表允许的 40 个字符的英文名在 375px 宽时断成几行，不会把信撑出横向滚动。
- 不用 flex、grid、position、CSS 变量、脚本、网络字体和外链样式表；字体栈用系统字体（PingFang SC、微软雅黑、Noto Sans SC）。
- 每个背景色同时写 `bgcolor` 属性；Outlook 桌面版用 `<!--[if mso]>` 包一层 600px 的表格；按钮的内边距写在链接上，按钮格子上另写 `mso-padding-alt`，Outlook 桌面版忽略链接的内边距时用它；圆角在 Outlook 桌面版里是直角。
- 信纸的圆角和官网 `.pt-letter` 一样是 4px（上沿、下沿和航空条纹的两个角）。官网信纸每 34px 一条横格线，邮件里没有做：横格线只能用背景图，Outlook 桌面版不显示背景图，其它客户端也可能拦截，做了会让不同客户端看到的信纸不一样。
- 每张图片都写了 `width`、`height`、`alt`；图片被拦截时只剩顶图的替代文字「长江大学极客班」，其余部件的 `alt` 为空，正文不受影响。
- 一封信的 HTML 约 10 到 13KB（Gmail 超过 102KB 会截断），测试里用 30 条长说明压过一次，仍在 102KB 以内。

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
pnpm exec vitest run tests/server/mail-envelope.test.ts
```

测试覆盖：四封信都能渲染；恶意姓名 `<img src=x onerror=alert(1)> & "q"` 在 HTML 的每个位置都被转义；`javascript:`、`http:`、其它域名、带账号或端口的链接被拒绝；纯文本版本有编号、时间、地点等关键事实；没有外链样式表、脚本、flex、grid、position；解析后的属性都合法、内联样式真的生效（字体名曾经用双引号，把 `style` 属性截断过）；图片地址都以 `assetBase` 开头并带宽高和替代文字，`file://` 只在 `allowFileAssets` 时放行；主题里没有换行和 U+2028 / U+2029；HTML 小于 102KB；未通过的信不再写「论坛对所有人开放」和名额的理由，传了 `reason` 才有原因；给了 `replyTo` 才请人回信，待面试的信没有 `replyTo`、自定义的信请人回复却没有 `replyTo`、`replyTo` 带换行或多个地址都抛错；待面试的时间地点不能为空，没有面试说明时摘要不提；抬头等动态文字带断行规则、邮票格按比例；按钮格子带 `mso-padding-alt`。

## 已知限制

- 还没有在真实邮件客户端里看过（QQ 邮箱、网易、Gmail、Outlook、Apple Mail），只在 Chromium 里按 640px、375px、去掉 `<style>` 的 375px 和深色模式看过预览。
- 强制反色的客户端（Outlook.com、部分手机 App 的深色模式）不认媒体查询，会自己改背景和字色；图片部件都是透明底，不会出现白色色块，但颜色以客户端为准。
- 图片走 CDN，没有 CID 内嵌；如果 CDN 防盗链拦了邮件客户端的请求，信里只剩文字，要等发信模块决定是否内嵌。
- 没有 `replyTo` 时信里指向官网意见箱；意见箱的内容和回复是公开的，只有联系方式一栏不公开。

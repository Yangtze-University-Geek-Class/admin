# Server 邮件信封模板（lib/mail）

> 站内邮件共用的信封模板：一个纯函数把一封信渲染成主题、HTML 和纯文本，版式照官网「加入我们」的信纸；图片只做几个固定尺寸的部件，放在 CDN 上。

状态：`current` · 更新：2026-09-27 · 源码：`app/server/src/lib/mail/` · 上级合同：[server](README.md) · issue：#148

## 现状

- 已有：`renderEnvelope`（`envelope.ts`）、图片部件清单（`envelope-pieces.ts`）、招新四封信的内容（`recruitment.ts`）、部件生成脚本 `scripts/mail-envelope/build.py`、回归测试 `tests/server/mail-envelope.test.ts`。
- 还没有：发信商适配器、发信队列与重试、发送记录、预发布白名单、控制台改投递状态时触发发信、CID 内嵌图片。这些都在 #148 后续的提交里做；成员绑定邮箱、站内通知发邮件、退订在 #149。
- 所以现在全站仍然不发任何邮件，模块也没有被任何路由导入。

## 接口

```ts
renderEnvelope(message: EnvelopeMessage, { assetBase }): { subject, html, text }
recruitmentMessage(kind: "received" | "interview" | "accepted" | "rejected", input): EnvelopeMessage
```

- `EnvelopeMessage`：主题、收件箱摘要（preheader）、信纸左上角的小字、抬头、正文块（`paragraph` 段落、`facts` 两列事实栏、`list` 编号列表）、可选按钮、落款日期、页脚几行字、页脚的站点链接。以后的站内通知（#149）只要拼出同样的结构就能复用版式。
- `assetBase`：图片部件的地址前缀，必须以 `/` 结尾，只能是 `https://`（正式发信用 `https://cdn.crosery.com/yzgc/mail/v1/`）或本机预览用的 `file://`。
- 发件人名是 `MAIL_SENDER_NAME`（长江大学极客班），发信模块写 `From` 头时用同一个常量。
- 四封信与控制台投递状态对应（`lib/roles.ts` 的 `APPLICATION_STATUSES`）：`received` 投递成功（编号、提交时间、班级）、`interview` 待面试（时间、地点、面试说明）、`accepted` 已录取（接下来要做的事、可选按钮）、`rejected` 未通过。「评估中」不发信。
- 待面试与已录取的正文写了「直接回复这封邮件」。发信模块要把 `Reply-To` 设成 Email Routing 会转发、有人看的地址；做不到时先改这两句文案。

## 安全

- 所有动态文字（姓名、班级、面试时间地点、按钮文字、页脚）都经过 HTML 转义；控制字符和双向文字控制符在渲染前去掉。
- 主题、抬头、事实栏是单行文字：换行变空格，主题里不会混进 `\r\n`，发信时不会被拼出额外的邮件头。
- 按钮和页脚链接只接受 `https` 的 `yangtzeu.work` 与 `prev.yangtzeu.work`，不能带账号或端口；`javascript:`、`http:`、`data:`、其它域名一律抛 `MailTemplateError`，不会降级成纯文字。
- 纯文本版本不转义（`text/plain` 不会被当成 HTML），同样去掉控制字符。

## 版式与邮件客户端

- 宽 600px，表格布局加内联样式；`<style>` 里只有两组媒体查询：深色模式（`prefers-color-scheme: dark`，换深色信纸和浅色字）与窄屏（620px 以下收紧内边距、缩小邮票）。不支持 `<style>` 的客户端照样能读浅色版。
- 不用 flex、grid、position、CSS 变量、脚本、网络字体和外链样式表；字体栈用系统字体（PingFang SC、微软雅黑、Noto Sans SC）。
- 每个背景色同时写 `bgcolor` 属性；Outlook 桌面版用 `<!--[if mso]>` 包一层 600px 的表格；圆角在 Outlook 桌面版里是直角。
- 每张图片都写了 `width`、`height`、`alt`；图片被拦截时只剩顶图的替代文字「长江大学极客班」，其余部件的 `alt` 为空，正文不受影响。
- 一封信的 HTML 约 12KB（Gmail 超过 102KB 会截断），测试里用 30 条长说明压过一次，仍在 102KB 以内。

## 图片部件

| 部件 | 文件（v1） | 显示尺寸 | 内容 |
|---|---|---|---|
| `header` | `header-69cc8949.png` | 600×220 | 极客娘（官网开机画面的 `nano-wave-560.webp`）在信纸后面挥手，旁边一只拆开的航空信封；透明底，底边就是信纸上沿 |
| `stamp` | `stamp-a390fe56.png` | 150×100 | 带齿孔的邮票（校徽 + 极客班）和 YUGC 邮戳，照 `three/join.ts` 信封地址面 |
| `seal` | `seal-dcc7a78b.png` | 72×72 | 落款旁的钴蓝火漆，压着校徽 |
| `airmail` | `airmail-62b665eb.png` | 600×12 | 信纸下沿的钴蓝与琥珀航空条纹，条纹之间透明 |

- 全部按 2 倍像素导出，pngquant 量化后再用 oxipng 压缩，每张都在 64KB 以内；四张都要透明底，所以都是 PNG。
- 文件名带内容 sha256 的前 8 位，换图就换名字，已发出的邮件继续指向旧图；`envelope-pieces.ts` 里的文件名要和上传的文件一致。
- 图片不进仓库、不进 server 镜像。生成：`python3 scripts/mail-envelope/build.py . /tmp/mail-envelope/assets`（需要 `resvg`、`pngquant`、`oxipng` 与 Python 的 Pillow），输出目录里的 `MANIFEST.txt` 列出每个文件的字节数和像素尺寸。原图只用仓库里官网正在用的 `app/web/public/portal/nano-wave-560.webp` 与 `app/web/public/logo.png`；配色取自 `three/join.ts` 与 `styles/scenes.css`。生图参考只用来定版式，不进部件。
- 上传到 CDN 的 `yzgc/mail/v1/` 由维护者手动做，不在 CI 里；换了任何一张图，重新生成、上传新文件、改 `envelope-pieces.ts`，旧文件留着不删。

## 验证

```bash
pnpm exec vitest run tests/server/mail-envelope.test.ts
```

测试覆盖：四封信都能渲染；恶意姓名 `<img src=x onerror=alert(1)> & "q"` 在 HTML 的每个位置都被转义；`javascript:`、`http:`、其它域名、带账号或端口的链接被拒绝；纯文本版本有编号、时间、地点等关键事实；没有外链样式表、脚本、flex、grid、position；解析后的属性都合法、内联样式真的生效（字体名曾经用双引号，把 `style` 属性截断过）；图片地址都以 `assetBase` 开头并带宽高和替代文字；主题里没有换行；HTML 小于 102KB。

## 已知限制

- 还没有在真实邮件客户端里看过（QQ 邮箱、网易、Gmail、Outlook、Apple Mail），只在 Chromium 里按 640px、375px 和深色模式看过预览。
- 强制反色的客户端（Outlook.com、部分手机 App 的深色模式）不认媒体查询，会自己改背景和字色；图片部件都是透明底，不会出现白色色块，但颜色以客户端为准。
- 图片走 CDN，没有 CID 内嵌；如果 CDN 防盗链拦了邮件客户端的请求，信里只剩文字，要等发信模块决定是否内嵌。

# task/147/wallpaper_switch · crosery · 2026-09-26

负责人：crosery

## 22:39:25 +08:00 · 开工 · #147 · 从 origin/stage c8e7648d5779 建 task/147/wallpaper_switch

- 执行者：agent-claude-geek-main-08（Claude Code，claude-opus-5-5）
- 做了什么：node scripts/task.mjs start 147 wallpaper_switch：建分支与 worktree .claude/worktrees/task-147，在 issue 上留开工记录
- 结果：worktree 已建好，issue 上已留开工记录

## 22:45:04 +08:00 · 方案 · #147 · 换壁纸先顶缩略图并从缩略图展开，大图解码后清晰过来，空闲预取其余壁纸

- 执行者：agent-claude-geek-main-08（Claude Code，claude-opus-5-5）
- 做了什么：读 Wallpaper.tsx：新层先 new Image()+decode() 整张 1920×1080 大图才开始淡入，期间桌面停在旧壁纸、没有反馈；源站 20–120KB/s 时 geek.webp（238KB）要好几秒。打算：lib/wallpapers.ts 加共用的下载解码（同一地址只下一次）、空闲预取清单与省流量/2G 判断；Wallpaper.tsx 点下去立刻压一层（底色 + 放大模糊的缩略图），从点的缩略图位置以圆角矩形展开到整个桌面，大图解码后在这一层里淡入变清晰；减少动态效果时只淡入；后一层展开完才卸掉下面的层，旧层的计时和解码不影响新层；YugcOs 在桌面空闲时预取。不碰 3D 书桌、PromoPlayer/PromoLazy/promo.css。
- 结果：定位确认：Wallpaper.tsx 第 38–53 行等 decode 才 setShown；未改代码

## 22:57:39 +08:00 · 提交 · #147 · 换壁纸点下去立刻顶上模糊缩略图，从缩略图展开，大图解码后清晰过来

- 执行者：agent-claude-geek-main-08（Claude Code，claude-opus-5-5）
- 做了什么：Wallpaper.tsx 改成一张壁纸一层：点下去马上压上新层（底色 + 放大模糊的缩略图），用 clip-path 从点的缩略图位置展开到整个桌面 640ms，大图解码好后淡入 480ms；减少动态效果只淡入 360ms；某层展开完只卸它下面的层。lib/wallpapers.ts 加 revealClipFrom 与共用的 loadWallpaperImage（同一地址只下一次，失败不记住），Home.tsx 开机画面改用它。补 tests/web/portal-wallpaper-switch.test.tsx 7 条（jsdom，假 Image 控制解码）；portal.md 加「壁纸」一节并改模块地图，DESIGN.md 改换壁纸描述。
- 结果：vitest 两个壁纸测试文件 10 条通过；tsc -p app/web 通过；变异检查：大图立刻给、不顶缩略图、展开完只留自己、压新层只留上一层、忽略减少动态效果、大图解码后不换上 6 个变异都被测试拦下

## 22:58:24 +08:00 · 提交 · #147 · 桌面空闲时预取其余壁纸，省流量与 2G 时不预取

- 执行者：agent-claude-geek-main-08（Claude Code，claude-opus-5-5）
- 做了什么：lib/wallpapers.ts 加 prefetchWallpapersWhenIdle：requestIdleCallback（最多等 4 秒，Safari 退到 1.5 秒计时）后按顺序低优先级下载，先全部缩略图再当前以外的大图，可取消；navigator.connection 的 saveData 或 2g/slow-2g 时不排任务。loadWallpaperImage 加 fetchPriority 参数，与换壁纸共用同一份下载。YugcOs 在桌面 active 时启动、退回书桌时取消。补测试：顺序与优先级、预取中途换过去不重下、取消、省流量/2G 不预取、Safari 退路；portal.md 加「空闲预取」。
- 结果：vitest 两个壁纸测试文件 17 条通过；tsc -p app/web 通过；变异检查：省流量也预取、2G 也预取、不等空闲立刻预取、下载不去重 4 个变异都被测试拦下

## 23:26:50 +08:00 · 提交 · #147 · 换壁纸按动画真正播完才卸旧层，减少动态效果时保留淡入

- 执行者：agent-claude-geek-main-08（Claude Code，claude-opus-5-5）
- 做了什么：ego 限速验收发现：旧层按固定 640ms/360ms 计时卸，动画在限帧的浏览器里晚开始时新层还没盖住就卸了（减少动态效果时 602ms 新层 opacity 还是 0，旧壁纸已没了）；另外 styles/portal.css 在减少动态效果时把 .pt-root * 的动画和过渡压成 .01ms，淡入根本看不到。Wallpaper.tsx 改成这一层自己的 animationend（target === currentTarget）才卸下面的层，大图淡入的 transitionend 才卸模糊缩略图，删掉两个计时 effect；os.css 在减少动态效果时用两个类的选择器保留整层淡入与清晰过来的时长。测试改成发 animationEnd/transitionEnd，并把时钟拨 5 秒确认不按计时卸；portal-wallpapers.test.ts 核对 CSS 豁免；portal.md「壁纸」同步。
- 结果：vitest 两个壁纸文件 18 条通过；pnpm check 通过；pnpm test 52 个文件 700 条通过；变异检查 16 个（新增按计时卸旧层、冒上来的事件也算、按计时卸缩略图、大图一到就撤缩略图、淡入被压成 .01ms、豁免选择器不够具体）全部被拦下

## 23:37:16 +08:00 · PR · #147 · 推送 task/147/wallpaper_switch 并开 PR #152 到 stage

- 执行者：agent-claude-geek-main-08（Claude Code，claude-opus-5-5）
- 做了什么：ego（TaskSpace 218）在本机生产构建 localhost:5192 上限速约 200kbps、页面级禁用缓存，逐帧录下桌面 1440×900 与手机 390×844 的换壁纸过程，拼成两张逐帧图，经 issue #147 评论框上传拿到 user-attachments 地址后清空评论框、没有发出；模拟减少动态效果核对淡入 0.36s、旧层在 animationend 之后才卸。用完 finish({keep:[]})，按 PID 停掉 5192/5193/5194 三个静态服务。推送分支，gh pr create --base stage 开 PR #152（Closes #147），pr-contract check 通过。
- 结果：桌面：32ms 新层出现，695ms animationend，697ms 卸旧层，10023ms 大图清晰；手机：135ms 新层，833ms animationend，880ms 卸旧层，10138ms 大图清晰；减少动态效果：440ms animationend，451ms 卸旧层。PR #152 已开，等 CI 与独立审查，不合并

## 23:43:39 +08:00 · 审查 · #147 · 独立审查 PR #152：通过，可以合并

- 执行者：agent-claude-geek-main-08（Claude Code，claude-opus-5-5）
- 做了什么：逐项读 origin/stage...0ee0bd0：Wallpaper.tsx 改成一张壁纸一层、新层按自己的 animationend 卸下面的层（只认 target === currentTarget）、大图 transitionend 后卸模糊缩略图；lib/wallpapers.ts 的 revealClipFrom、共用下载 loadWallpaperImage（同一地址只下一次，失败不记住）、空闲预取与省流量/2G 判断；YugcOs 传点的缩略图位置；Home.tsx 开机预载改走共用下载；os.css 的 reveal/fade 动画与减少动态效果下的时长豁免；两份单测与 portal.md「壁纸」一节
- 结果：通过。点下去同一次渲染就有新层，连点停在最后一张，减少动态效果走淡入，下载失败停在占位不闪回，符合 #147。剩余风险：一层的动画被取消（animationcancel，如中途被隐藏）时下面的旧层会留着，下一次换壁纸会一起卸掉，只多占一层合成；PR 里记的大图在首帧前解码完时模糊缩略图留在下面，同样只是多一层；全屏 blur(14px) 在低端手机上展开时的帧率没测。#146 换 CDN 会改 lib/wallpapers.ts 里的地址，合并顺序先 #152 后 #146。未验证：真实前台浏览器的帧率、Safari/iOS/微信、真机、预发布环境，等下一个 rc 在 ego 里验收
- 下一步：CI 通过后合并，确认 #147 关闭、远程分支和本地工作区清掉；告诉 #146 基于新的 stage 变基

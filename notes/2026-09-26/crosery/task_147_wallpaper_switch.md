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

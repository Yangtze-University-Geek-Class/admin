# task/142/promo_skip_only · crosery · 2026-09-26

负责人：crosery

## 22:18:05 +08:00 · 开工 · #142 · 从 origin/stage c8e7648d5779 建 task/142/promo_skip_only

- 执行者：agent-claude-geek-main-08（Claude Code，claude-opus-5-5）
- 做了什么：node scripts/task.mjs start 142 promo_skip_only：建分支与 worktree .claude/worktrees/task-142，在 issue 上留开工记录
- 结果：worktree 已建好，issue 上已留开工记录

## 22:25:46 +08:00 · 方案 · #142 · 播放层只留跳过；自动播被拒时 gate 直接结束、replay 停在封面点画面播

- 执行者：agent-claude-geek-main-08（Claude Code，claude-opus-5-5）
- 做了什么：读 PromoPlayer.tsx、promo.css、两份组件测试、portal.md 与 DESIGN.md 的宣传片段。定：删底部控件条、打开声音、播放宣传片按钮，空格与 M 快捷键；点画面永不暂停，只会停着就播、静音就开声音；静音也被拒时 gate 以 blocked 结束（算看过，不停在封面），replay 停在封面并提示点画面播放；gate 遇减少动态效果不加载直接 blocked，replay 照常播；删掉只给进度条用的 clock、PROMO.seconds 和四个图标
- 结果：否决「封面 + 跳过 + 几秒后自动关」：只是让人对着静图多等几秒，和无感播放相反，还多一个计时器；否决 replay 被拒也直接关：iOS 低电量、微信内置浏览器里桌面宣传片会永远打不开
- 下一步：改组件、样式、测试与文档，分提交

## 22:31:15 +08:00 · 提交 · #142 · 播放层只留右上角跳过，自动播被拒时不再停在封面

- 执行者：agent-claude-geek-main-08（Claude Code，claude-opus-5-5）
- 做了什么：feat(portal): PromoPlayer 删底部控件条、打开声音、播放宣传片按钮与空格/M 快捷键，点画面只开声音或接着播、从不暂停；gate 静音也被拒或减少动态效果时以 blocked 结束，replay 被拒停在封面提示点画面播放；promo.css 删 .pt-promo-bar/-track/-time/-icon/-play/-unmute，保留跳过的 Esc 键帽与焦点环；组件测试改写（20 条），e2e 加只有一个按钮的断言；portal.md 与 DESIGN.md 宣传片段同步
- 结果：pnpm vitest run 4 个宣传片与桌面测试文件 55 passed；pnpm check 退出 0；pnpm test 51 文件 689 passed；12 个变异（点画面暂停、gate 被拒停封面、不看减少动态效果、加回控件按钮、Esc 失效、blocked 不记看过、点画面不开声音、replay 被拒直接关、播完的 pause 算停下、Tab 不留在跳过、空格加回暂停、被拒不静音重试）全部让用例失败；e2e 未运行（本机 Playwright 会卡住，CI 也不跑）

## 22:31:26 +08:00 · 提交 · #142 · 删掉进度条留下的 clock、PROMO.seconds 和四个图标

- 执行者：agent-claude-geek-main-08（Claude Code，claude-opus-5-5）
- 做了什么：refactor(portal): lib/promo.ts 删 clock 与 PROMO.seconds（只给进度文案用），lib/icons.ts 删 play-fill、pause-fill、volume-up-line、volume-mute-line（icons.ts 只收官网用到的），tests/web/portal-promo.test.ts 删进度文案用例；rg 核对官网与测试里已没有引用
- 结果：文档核对：docs/services/web/ 不用改——删的是没人用的导出和图标，portal.md 里没写过它们；pnpm check 与 pnpm test 在提交后重跑，结果见下一条

## 22:41:50 +08:00 · 开发 · #142 · 生产构建在 localhost 上用 ego-browser 实看播放层

- 执行者：agent-claude-geek-main-08（Claude Code，claude-opus-5-5）
- 做了什么：pnpm --filter @yzgc/web build（f125abd 的源码），/tmp/serve-142.mjs 只绑 127.0.0.1:4318、非文件路径回落 portal 入口；ego TaskSpace 214 只删 yugc_promo_seen 一个 cookie 后打开 http://localhost:4318/join-us
- 结果：桌面 1440×900：hls.js AV1，静音自动播（没有用户手势），画面上按钮只有「跳过Esc」，没有底部条和打开声音，焦点在跳过上；鼠标点画面后 paused=false、muted=false；Esc 关闭并写入看过。减少动态效果：播放层没画出来、没有 video，直接进信纸，写入看过。手机 390×844 触屏：画面框 matrix(0,1,-1,0) 铺满，H.264 与 640 宽封面，只有「跳过」，键帽不显示；手指点画面不暂停并打开声音；点跳过关闭。PromoPlayer 分包 4.59kB（原约 6KB），portal.md 改为约 5KB。截图 /tmp/promo-142-desktop.png、/tmp/promo-142-mobile.png，稍后传到 PR

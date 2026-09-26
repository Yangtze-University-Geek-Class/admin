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

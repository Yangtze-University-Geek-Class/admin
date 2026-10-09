# task/212/dropdown_surface · crosery · 2026-10-08

负责人：crosery

## 00:30:28 +08:00 · 开工 · #212 · 从 origin/stage df90b67a8c03 建 task/212/dropdown_surface

- 执行者：agent-omp-geek-1008（omp，crosery/gpt-6.1-sol）
- 做了什么：node scripts/task.mjs start 212 dropdown_surface：建分支与 worktree .claude/worktrees/task-212，在 issue 上留开工记录
- 结果：worktree 已建好，issue 上已留开工记录

## 01:39:30 +08:00 · 方案 · #212 · 定 panel-background=pure：mask 在 0.6.0 是 0.75 半透明白遮罩，仍透出页面内容

- 执行者：agent-omp-forumdropdown-1008
- 做了什么：读安装版 Tuffex 0.6.0：TxDropdownMenu2.vue.js:22 默认 refraction→TxPopover→TxBaseAnchor panelCardProps 把 panelBackground 透传成 TxCard background；base-surface/style.css：refraction 层 backdrop-filter blur(30px) saturate×1.2 + radial-gradient 光斑（浅色纯底上糊成青绿带与白斑，即 #212 现象）；mask 在 card 预设下 background 取 var(--tx-surface-color)（TxCard 对 mask 传 var(--tx-bg-color-overlay,#fff)，深色 #1d1e1f），opacity 是 TxCard maskOpacity 默认 0.75——仍是半透明，菜单展开在帖子流/正文上会透出底下文字；pure 根层 background 取 var(--tx-fill-color-lighter)（浅色 #fafafa、深色 #1d1d1d），全不透明、无 backdrop-filter、无渐变层，正是论坛其它 TxCard（background 默认 pure）的面板底色，主题令牌驱动浅深两态
- 结果：选 pure 不选 mask：issue 验收 1 允许纯色或均匀遮罩，但验收条件「菜单文字对比度不受背景影响」只有全不透明的 pure 能保证（mask 恒定约 25% 透光，压在正文上时文字底下混着页面内容）；不改 Tuffex 本体、不写 style 块或内联样式，纯官方 prop 传参，符合论坛工程边界「无项目自定义样式」
- 下一步：4 个 callsite 显式传 panel-background pure，同步 ADOPTION.json 三条上游文件说明与 docs/services/forum/README.md 工程边界

## 01:39:52 +08:00 · 开发 · #212 · 论坛 4 个 TxDropdownMenu 显式 panel-background=pure

- 执行者：agent-omp-forumdropdown-1008
- 做了什么：AccountMenu.vue:56、ForumHeader.vue:91、PostCard.vue:284、pages/t/[id].vue:193 各加一个官方 prop panel-background="pure"（TxDropdownMenu 合法枚举 pure|mask|blur|glass|refraction，dist/es/dropdown-menu/src/types.d.ts:30），不改其它任何一行；全仓 grep 确认论坛只有这 4 处 TxDropdownMenu，无 TxDropdownSubmenu（子菜单不在范围内）；无 style 块、无内联样式、无库改动，样式 guard 的五条规则都不涉及静态属性传参
- 结果：ADOPTION.json 同步三条上游文件说明（ForumHeader.vue/PostCard.vue/t/[id].vue 各追加一句 #212 的取值与理由；AccountMenu.vue 是本项目新增文件、不在 modifiedUpstreamFiles，无需登记）；docs/services/forum/README.md 工程边界段写明 4 个面板的 panel-background=pure 与 refraction/mask/pure 三态的实测依据，头部「更新：」提到 2026-10-08；未跑构建/测试/lint（由父任务统一验收）
- 下一步：父任务在 3456 示例种子上截图对比浅色/深色两态后定稿；如所有者仍要两态对比可临时切回 mask

## 02:07:36 +08:00 · 方案 · #212 · 修正论坛浏览器验证的过时偏好页契约

- 执行者：agent-omp-geek-1008（omp，crosery/gpt-6.1-sol）
- 做了什么：完整 CDP 在隔离真实内存后端上运行：原核验器仍要求已于 #173/#175 退役的四个偏好页页签与 tabpanel；只删除过时结构断言和导航，保留资料、头像、通知持久化与越权跳转行为，窄屏改测输入控件是否越界
- 结果：shell 11、topics 18、topic-page 13、smoke 64/64 已通过；user-pages 在 preference tabs [] 处停止。不会改用户页面或放宽有效业务断言

## 02:17:43 +08:00 · 开发 · #212 · 论坛机器验证完成，隔离示例入口保持运行

- 执行者：agent-omp-geek-1008（omp，crosery/gpt-6.1-sol）
- 做了什么：forum:check、forum:generate、完整 forum:verify；3458 将论坛资产与 HMR 转给3456、读 API 经真实 testApp 内存库隔离，不停止或占用原3000的KTV服务；修正核验器过时偏好页页签假设，业务持久化和越权检查保留
- 结果：forum:check 30文件548测试、类型和ESLint与样式guard通过；静态构建通过；CDP完整7/7步骤、11+18+13+12交互步骤与64/64路由访问通过、0console问题；四处下拉浅深色与窄屏截图通过。check:notes 仍被 task start 导入的旧#209收尾后发布记录阻塞，未改写用户旧记录；文档索引和doc-sync通过。本地示例 http://127.0.0.1:3458，非真实OAuth或预发布人工验收

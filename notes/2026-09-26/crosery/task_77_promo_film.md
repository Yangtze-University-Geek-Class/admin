# task/77/promo_film · crosery · 2026-09-26

负责人：crosery

## 03:29:56 +08:00 · 开工 · #77 · 从 origin/stage 02b97d0e1fad 建 task/77/promo_film

- 执行者：agent-claude-geek-main-08（Claude Code，claude-opus-5-5）
- 做了什么：node scripts/task.mjs start 77 promo_film：建分支与 worktree .claude/worktrees/task-77，在 issue 上留开工记录
- 结果：worktree 已建好，issue 上已留开工记录

## 04:09:10 +08:00 · 方案 · #77 · HLS 分片上七牛，加入我们页挂全屏播放层，桌面加宣传片应用

- 执行者：agent-claude-geek-main-08（Claude Code，claude-opus-5-5）
- 做了什么：片源用所有者两份压缩版的参数（web264-28、av1-46）从母版重编：AV1 720/1080 + H.264 480/720/1080，fMP4 4 秒一段关键帧对齐；hls.js 1.7.3 按需加载，按 MediaSource / mediaCapabilities 挑 AV1 或 H.264，退到原生 HLS；cookie yugc_promo_seen 记只播一次；CSP 放行 cdn.crosery.com
- 结果：定案；hls.js 是新增生产依赖（Apache-2.0，独立分包 gzip 186KB）

## 04:09:10 +08:00 · 开发 · #77 · 分片包上 CDN，播放层、桌面应用、CSP、预取与测试完成

- 执行者：agent-claude-geek-main-08（Claude Code，claude-opus-5-5）
- 做了什么：package-hls.sh 在 Mac 上 5 分 36 秒出 5 档共 148 个文件 100.6MiB；qiniu-promo.mjs 只写 yzgc/static/promo/v5-tone-c70f489a19e9/（insertOnly），CDN 逐个 HEAD 核对大小；CDN 返回 ACAO * 与 max-age=31536000，Referer 只放行本站、localhost、空；PromoPlayer + JoinUs 门控 + YugcOs 宣传片应用与起播预取；nginx 两份模板 media-src / connect-src 加 CDN；单测 16 条 + 组件测试 7 条 + e2e 2 条
- 结果：ego-browser 生产构建 Fast 4G：桌面按 1 到第一帧 587–628ms（AV1，带声音）；直开 /join-us 播放层出现后 1.7–2.1s；Slow 4G 约 8s；跳过写 cookie、刷新不再播、桌面重看不动 cookie；1280×800 / 1440×900 / 1920×1080 / 390×844 图标、便签、Dock 不重叠。测量时误调了 Network.clearBrowserCache（清了整个浏览器 HTTP 缓存，未动 cookie 与存储），已停用，改用单页 setCacheDisabled

## 04:11:28 +08:00 · 提交 · #77 · 宣传片功能一次提交

- 执行者：agent-claude-geek-main-08（Claude Code，claude-opus-5-5）
- 做了什么：feat(portal): 第一次点「加入我们」先播宣传片，可跳过、只播一次，桌面可重看（3fdf38c）；pnpm verify；pnpm test:e2e
- 结果：pnpm verify 通过（核心 Tests 468 passed，论坛 Tests 240 passed）；pnpm test:e2e 12 passed

## 04:11:28 +08:00 · 推送 · #77 · task/77/promo_film 推到远端

- 执行者：agent-claude-geek-main-08（Claude Code，claude-opus-5-5）
- 做了什么：git push -u origin task/77/promo_film
- 结果：pre-push 分支与发布 tag 规则通过

## 04:11:29 +08:00 · PR · #77 · 开 PR #95 → stage，截图经 GitHub 附件上传

- 执行者：agent-claude-geek-main-08（Claude Code，claude-opus-5-5）
- 做了什么：gh pr create（#95），九段正文；6 张截图经 PR 评论框上传拿到 user-attachments 链接（未发评论）后写进「验收证据」
- 结果：PR #95 已开，验收证据 6 张；审查结论待独立审查

## 04:35:37 +08:00 · 审查 · #77 · 第一轮独立审查：有条件通过，2 条应修

- 执行者：agent-claude-geek-main-08（Claude Code，claude-opus-5-5）
- 做了什么：Claude 独立审查代理审 696180a（范围 02b97d0..696180a），按 CODE-REVIEW 逐项核对，另用 Playwright 冷缓存复核预取命中
- 结果：有条件通过：应修 2 条（点视频后焦点落到 body、Esc 失效；触屏平板露出 Esc 提示），建议 5 条（减少动态效果时进场动画没关、播放层分包失败会卸载整站、可改 hls.js/light、startVariant 与 hls.js 排序的假设、执行记录里测试条数重复计）；新增依赖 hls.js 是否经所有者批准待确认

## 04:35:37 +08:00 · 返工 · #77 · 按第一轮审查改：焦点、触屏提示、减少动态效果、分包失败、hls.js 精简版

- 执行者：agent-claude-geek-main-08（Claude Code，claude-opus-5-5）
- 做了什么：PromoPlayer 根节点 tabIndex -1；promo.css 加 (hover: none) 隐藏 kbd、减少动态效果选择器改 .pt-root.pt-promo、加载提示 pointer-events none（新 e2e 发现它挡住了点视频）；新增 PromoLazy.tsx，分包加载失败按 failed 结束；改用 hls.js/light（加 hls-light.d.ts）；startVariant 注释写明与 hls.js 排序的假设；新增组件测试 portal-promo-lazy 与 e2e「点视频后 Esc 仍能跳过」。更正：上一条开发记录里「单测 16 条 + 组件测试 7 条」重复计数，实际是单测 9 条 + 组件测试 7 条
- 结果：pnpm verify 通过（核心 Tests 469 passed，论坛 Tests 240 passed）；pnpm test:e2e 13 passed；hls 分包 gzip 186KB → 118KB

## 04:44:36 +08:00 · 审查 · #77 · 第二轮独立审查：通过

- 执行者：agent-claude-geek-main-08（Claude Code，claude-opus-5-5）
- 做了什么：Claude 独立审查代理审 243d249（范围 696180a..243d249），逐条复核第一轮 2 条应修、5 条建议，另核对 hls.js/light 的能力与拦掉播放层分包后的页面
- 结果：通过：全部已解决；新建议 1 条（PromoLazy 的 effect 把 onClose 返回值当清理函数、可能重复调用）；CI push 36186710701、PR 36186714168、pr-contract 36186837806 全部 success

## 04:44:36 +08:00 · 返工 · #77 · PromoLazy 只结束一次

- 执行者：agent-claude-geek-main-08（Claude Code，claude-opus-5-5）
- 做了什么：PromoUnavailable 用 ref 保证 onClose("failed") 只调一次、effect 不返回值；组件测试补「父组件重渲染换了新的 onClose 也只调一次」
- 结果：tsc 通过；promo 相关 vitest 17 passed

## 09:05:01 +08:00 · 审查 · #77 · 第三轮独立审查：通过；所有者批准新增 hls.js 并合并

- 执行者：agent-claude-geek-main-08（Claude Code，claude-opus-5-5）
- 做了什么：Claude 独立审查代理审 dd6d64b（范围 243d249..dd6d64b），核对 PromoLazy 只结束一次与重渲染测试；所有者 2026-09-26 在对话里选「同意，合并 #95」，批准新增生产依赖 hls.js 1.7.3
- 结果：通过：第二轮建议已解决，新建议 1 条（分包失败被 lazy 缓存，本次访问再点会立即关闭，不影响合并）；promo vitest 17 passed，pnpm check 退出码 0；CI push 36187592002、PR 36187597972、issue-lifecycle 36187600370 success
- 下一步：推送本记录，CI 绿后合并 #95

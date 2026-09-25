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

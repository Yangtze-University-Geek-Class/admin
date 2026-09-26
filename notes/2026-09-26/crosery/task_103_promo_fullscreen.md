# task/103/promo_fullscreen · crosery · 2026-09-26

负责人：crosery

## 13:26:39 +08:00 · 开工 · #103 · 从 origin/stage ad0f0bd29cd4 建 task/103/promo_fullscreen

- 执行者：agent-claude-geek-main-08（Claude Code，claude-opus-5-5）
- 做了什么：node scripts/task.mjs start 103 promo_fullscreen：建分支与 worktree .claude/worktrees/task-103，在 issue 上留开工记录
- 结果：worktree 已建好，issue 上已留开工记录

## 13:56:55 +08:00 · 方案 · #103 · 定位卡顿：CDN 边缘冷、最低档太重、手机可能软解 AV1；界面改成控件叠在画面里

- 执行者：agent-claude-geek-main-08（Claude Code，claude-opus-5-5）
- 做了什么：CDN 实测：五档 135 个分片 HEAD 几乎全是 x-qnm-cache Miss，第二次请求变 Hit（age 139），TTFB 0.33–0.48s；码率：H.264 最低 480p 平均 845kbps、峰值 1.2Mbps，AV1 最低 720p；mediaCapabilities 只看 smooth 不看 powerEfficient
- 结果：方案：加 240p/360p（64k 音频）与 AV1 480p；手机一律 H.264、AV1 要硬解；按带宽估计选起播档并封顶；缓冲 30 秒；控件叠进画面、播放中淡出；画面外用模糊画面色；手机竖屏转 90 度；CDN 预取

## 13:56:55 +08:00 · 提交 · #103 · 宣传片：控件叠在画面里、手机竖屏横过来、弱网起播档与缓冲

- 执行者：agent-claude-geek-main-08（Claude Code，claude-opus-5-5）
- 做了什么：feat(portal): PromoPlayer 重写界面（16:9 舞台 + 叠加控件 + 2.5 秒淡出 + 背景模糊画布 + 缓冲提示 + 触屏点画面收放控件），promo.css 竖屏触屏旋转 90 度；promo.ts 手机 H.264、AV1 要 powerEfficient、startEstimate/startLevelIndex、新前缀 v5-tone-e1419fc9331a 与 640 宽封面；YugcOs 预取同一起播档；测试与 portal.md、DESIGN.md。仓库外：片子目录新增 h264_240、h264_360、av1_480 三档与 poster-640，write-masters.py 按实际分片写 master，qiniu-promo.mjs 加 prefetch，236 个文件上传并经 CDN 核对大小，预取 44 个地址
- 结果：pnpm verify 通过（核心 484、论坛 240）；pnpm test:e2e 14 passed（新增手机竖屏旋转用例）；ego-browser：桌面 1280×1000 无深色条、控件在画面内、2.5 秒后淡出、动鼠标恢复；手机 390×844 触屏：画面框 matrix(0,1,-1,0) 铺满、H.264 360p 起播；横屏 844×390 正常；限速 450kbps/RTT 400ms 从请求 master 到首帧 3.7 秒、之后 240p 连续播放

## 14:00:58 +08:00 · PR · #103 · 开 PR #105 → stage，改前改后 6 张截图

- 执行者：agent-claude-geek-main-08（Claude Code，claude-opus-5-5）
- 做了什么：gh pr create（#105），九段正文；6 张截图经 PR 评论框上传拿到 user-attachments 链接（未发评论，输入框已清空）后写进「验收证据」
- 结果：PR #105 已开；验收证据 6 张（桌面改前 / 改后淡出 / 改后控件、手机竖屏改前 / 改后、手机横屏改后）

## 14:14:23 +08:00 · 审查 · #103 · 第一轮独立审查：有条件通过，3 条应修

- 执行者：agent-claude-geek-main-08（Claude Code，claude-opus-5-5）
- 做了什么：Claude 独立审查代理审 b50105f，按 CODE-REVIEW 逐项，读 hls.js 1.7.3 源码核对起播档，在 jsdom 里按 pointerdown→focus→click 复现，做了 3 个变异
- 结果：有条件通过：应修 3 条（控件淡出后手指第一次点画面被焦点先叫醒再被 click 收起；键盘焦点在底部控件时整条栏淡出、焦点框看不见；video 的 cursor:pointer 盖过 cursor:none）；建议 2 条（平板竖放也会旋转；测试抓不住 wake 不重计时、hidden 不看状态、先 startLoad 后设 startLevel）

## 14:14:24 +08:00 · 返工 · #103 · 按第一轮审查改：焦点叫醒、焦点在栏里不淡出、隐藏指针、平板不转、测试补强

- 执行者：agent-claude-geek-main-08（Claude Code，claude-opus-5-5）
- 做了什么：onFocus 只在焦点落到按钮上（target 不是播放层）时叫醒；.is-idle .pt-promo-bar:not(:has(:focus-visible)) 才淡出；.is-idle .pt-promo-video cursor none；旋转加 max-width:600px；测试：假 hls 记下 startLoad 时的 startLevel、淡出后再叫醒会再淡出、暂停不淡出、按 pointerdown→焦点移到播放层→click 的真实顺序测手指点画面；portal.md 同步
- 结果：组件测试 11 passed；四个变异（onFocus 无条件叫醒、wake 不重新计时、hidden 不看状态、先 startLoad）各有测试失败；tsc、check:docs 通过；pnpm test:e2e 14 passed；ego-browser：Tab 到「暂停」后 3.2 秒 is-idle=true 但底部栏 opacity 1、视频 cursor none

## 14:19:52 +08:00 · 审查 · #103 · 第二轮独立审查：有条件通过（条件是 CI 通过）

- 执行者：agent-claude-geek-main-08（Claude Code，claude-opus-5-5）
- 做了什么：Claude 独立审查代理审 b95e3f2（范围 b50105f..b95e3f2），重做 5 个变异（每次 git checkout 还原）
- 结果：第一轮 3 条应修、2 条建议都已修好，无新发现；5 个变异各有测试失败；vitest 24 passed、tsc 0、note check 通过；条件：CI 与 pr-contract 全绿

## 14:58:41 +08:00 · 合并 · #103 · 合并 #105（宣传片控件叠进画面、手机竖屏横过来、弱网低档起播）

- 执行者：agent-claude-geek-main-08（Claude Code，claude-opus-5-5）
- 做了什么：第二轮审查有条件通过；ee53d4f 的 PR CI 36223431114 与 push CI 36223427478 全部 success，pr-contract 06:56 success 后，gh pr merge 105 --merge --match-head-commit ee53d4f；停掉本地验证用的 vite（PID 86650，按 PID）
- 结果：合并提交 2812251，06:57:08Z 进 stage；#103 由 issue-lifecycle 关闭
- 下一步：#104 合并后一起打 v0.1.0-rc.8 发预发布，核对宣传片

## 14:58:45 +08:00 · 收尾 · #103 · PR #105 已合并，清理 worktree

- 执行者：agent-claude-geek-main-08（Claude Code，claude-opus-5-5）
- 做了什么：node scripts/task.mjs finish 103：删 worktree .claude/worktrees/task-103 与本地分支 task/103/promo_fullscreen
- 结果：PR 已合并

# task/110/promo_error_paths · crosery · 2026-09-26

负责人：crosery

## 15:23:00 +08:00 · 开工 · #110 · 从 origin/stage 28122511456d 建 task/110/promo_error_paths

- 执行者：agent-omp-geek-main-26（omp，claude-opus-5-5）
- 做了什么：node scripts/task.mjs start 110 promo_error_paths：建分支与 worktree .claude\worktrees\task-110，在 issue 上留开工记录
- 结果：worktree 已建好，issue 上已留开工记录

## 15:38:07 +08:00 · 方案 · #110 · 本机复现分包失败被 lazy 缓存

- 执行者：agent-omp-geek-main-26（omp，claude-opus-5-5）
- 做了什么：Vite dev（localhost:5173，mock 数据）真实 Chrome：从加载起拦截 PromoPlayer.tsx，双击桌面宣传片；解除拦截后再开两次
- 结果：对照组正常播（currentTime 5.6）；复现组解除拦截后分包 fetch 200，但两次打开都立刻关闭；已在 #110 留复现记录 issuecomment-5844309404；127.0.0.1 下 CDN 按 Referer 403，需用 localhost
- 下一步：写修复前失败的组件测试

## 16:37:37 +08:00 · 开发 · #110 · 三处修复完成，分包重来用写死的 3 个重试地址

- 执行者：agent-omp-geek-main-26（omp，claude-opus-5-5）
- 做了什么：子代理 Fix110Promo 三轮 + 主 agent 收尾：PromoPlayer play() 非 NotAllowedError 分流、起播 IIFE 兜底；PromoLazy 失败后换新 lazy；lib/promo.ts retryableImport 用原地址加 3 个 ?retry=n 字面量地址（所有者选定，部署包多约 1.1MB）；promo.css 改由 PromoLazy 跟主包引入；重写 portal-promo.test.ts 与 portal-promo-lazy.test.tsx；portal.md 出错时一条
- 结果：修复前 6 failed（HEAD 代码换回后）；修复后三份 promo 测试 34 passed；app/web tsc 0；check-boundaries/check-docs/check-notes 通过；vite 生产构建 + localhost 预览真实 Chrome：拦截原地址后 X 原 → X retry1 → ✓ retry2，播放 6.3s、样式在，hls 同样；全量 vitest 25 failed/438 passed，失败集合与 stage 基线相同
- 下一步：所有者授权后提交、推送、开 PR

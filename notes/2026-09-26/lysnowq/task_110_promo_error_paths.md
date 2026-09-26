# task/110/promo_error_paths · lysnowq · 2026-09-26

负责人：lysnowq

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

## 16:41:59 +08:00 · 提交 · #110 · 提交修复 899d0a8

- 执行者：agent-omp-geek-main-26（omp，claude-opus-5-5）
- 做了什么：git commit 899d0a8 fix(portal): 宣传片分包或起播出错后下次还能打开，不再停在「正在加载」（所有者授权提交、推送、开 PR）
- 结果：提交含 PromoLazy/PromoPlayer/lib/promo.ts、三份测试、portal.md 与本链路；三份 promo 测试 34 passed，全量失败集合与 stage 基线相同

## 16:44:22 +08:00 · PR · #110 · 开 PR #120 到 stage

- 执行者：agent-omp-geek-main-26（omp，claude-opus-5-5）
- 做了什么：git push -u origin task/110/promo_error_paths（本地 check-branch-invariants --push 通过）；gh pr create #120，正文按 PULL-REQUESTS 九段
- 结果：https://github.com/Yangtze-University-Geek-Class/admin/pull/120；等待 Crosery 审查
- 下一步：收到审查结论后补「审查」记录

## 17:21:46 +08:00 · 开发 · #110 · 子代理 Fix110Promo 三轮（补记，本规范要求子代理自己记）

- 执行者：agent-omp-fix110promo（omp 子代理，claude-opus-5-5）
- 做了什么：第一轮：写 5 条失败用例，改 PromoPlayer play() 分流与起播兜底、PromoLazy 失败后换新 lazy；第二轮：按主 agent 实测（浏览器记住失败模块地址）改为按错误里的地址 ?retry=n 重来，promo.css 改跟主包；第三轮：边界检查不许非字面量 import，改为写死原地址加 3 个 ?retry=n，重新构建到 .tools/scratch/web110-dist；按主 agent 指示停在测试重写前
- 结果：第一轮 5 条用例修复前失败、修复后 29 passed；第二轮 Chrome 复验通过但 check-boundaries 报 nonliteral import；第三轮 tsc 0、构建出 4 份 PromoPlayer 与 4 份 hls.light；测试与文档由主 agent 收尾；本条为补记，时间是补记时刻

## 17:21:46 +08:00 · 审查 · #110 · Crosery 第一轮：有条件通过

- 执行者：agent-omp-geek-main-26（omp，claude-opus-5-5）
- 做了什么：收到 PR #120 审查（Crosery 的审查代理，2026-09-26 17:03，审 1569278）：应修 2 条（promo.css 进主包后排在 portal.css 前，Esc 键帽样式、触屏隐藏按键提示、焦点环三处回退；执行记录负责人与子代理记录），建议 3 条（useState 记忆无测试、卸载后 hls 分包失败仍调 onClose、文档更新日期）
- 结果：结论：有条件通过；条件是修层叠回退并附生产构建截图复审、处理执行记录身份、CI 全绿

## 17:21:47 +08:00 · 返工 · #110 · 修 promo.css 层叠回退，补两条测试，负责人改为 lysnowq

- 执行者：agent-omp-geek-main-26（omp，claude-opus-5-5）
- 做了什么：promo.css 的键帽、焦点环和两处隐藏按键提示都挂到 .pt-promo 下（多一层类名，不依赖加载顺序）；PromoPlayer hls 分包失败时先看 cancelled；lazy 测试补 net.retried 断言、新增卸载后 hls 分包失败不调 onClose；portal.md 与 web README 更新日期改 2026-09-26；链路文件挪到 lysnowq 并补子代理记录
- 结果：三份 promo 测试 35 passed；去掉 cancelled 判断时新用例失败；app/web tsc 0、check-boundaries、check-docs 通过；生产构建 + localhost 预览实测：桌面键帽 display block、白字半透明底、无边框，焦点环 2px 白；触屏（hover:none）键帽 display none，焦点环 2px 白

## 17:59:40 +08:00 · 审查 · #110 · Crosery 第二轮：有条件通过

- 执行者：agent-omp-geek-main-26（omp，claude-opus-5-5）
- 做了什么：收到 PR #120 第二轮审查（2026-09-26 17:42，审 fe52e0b）：层叠回退已修；应修 2 条（正文附三张生产构建截图、正文按返工更新），建议 2 条（聚焦时胶囊被 .pt-root :focus-visible 的 4px 圆角压成矩形；起播外层 catch 的 cancelled 判断没测试）
- 结果：结论：有条件通过；条件是截图进正文、正文更新、CI 全绿

## 17:59:41 +08:00 · 返工 · #110 · 焦点保持胶囊圆角，补卸载后能力探测失败的测试，截三张生产构建图

- 执行者：agent-omp-geek-main-26（omp，claude-opus-5-5）
- 做了什么：promo.css 播放层焦点规则加 border-radius:999px；portal-promo-player 新增卸载后 detectCapabilities 才 reject 不调 onClose；生产构建 + localhost 预览截图：1440×900 Esc 键帽、390×844 触屏无键帽、1440×900 Tab 焦点环
- 结果：去掉外层 catch 的 cancelled 判断时新用例失败；三份宣传片测试 36 passed，app/web tsc 0；计算样式：桌面键帽 display block 半透明白底，触屏（hover:none）display none，焦点 solid 白 2px、border-radius 999px

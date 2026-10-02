# task/122/joinus_gate_loading · lysnowq · 2026-10-02

负责人：lysnowq

## 16:36:18 +08:00 · 开工 · #122 · 从 origin/stage 458999fc0c60 建 task/122/joinus_gate_loading

- 执行者：agent-omp-issue-wrapup（OMP，代表 LYsnowQ）
- 做了什么：node scripts/task.mjs start 122 joinus_gate_loading：建分支与 worktree .claude\worktrees\task-122，在 issue 上留开工记录
- 结果：worktree 已建好，issue 上已留开工记录

## 16:41:29 +08:00 · 开发 · #122 · 宣传片分包未到时显示加载遮罩，跳过沿用播放层语义

- 执行者：agent-omp-issue-122（OMP，代表 LYsnowQ）
- 做了什么：PromoLazy.tsx 新增 PromoFallback（全屏层 + 正在加载… + 右上角跳过/Esc，复用 promo.css），JoinUs.tsx 的 Suspense fallback 由 null 换成它，gate 的 onSeen/onClose 提取为共用回调；新增 tests/web/portal-promo-gate.test.tsx（播放层分包永不 resolve，断言遮罩可见、跳过可点、写「已看过」cookie、解除 inert、Esc 同样能跳过）；同步 docs/services/web/portal.md 与 README「更新」日期
- 结果：新用例 2/2 通过（1.33s）；tests/web 121 通过 / 3 个失败（portal-os、portal-org、portal-wallpapers 的 Windows 盘符路径断言，主工作区 stage 上同样失败，非本次改动）；check 各步（runtime、site-config、environments、boundaries 202文件1154导入、docs 272份、tuffex、doc-sync 6组、notes 44链路、secrets、tsc server/web/console）全部通过
- 下一步：提交并推送 task/122/joinus_gate_loading，开 PR 指向 stage

## 16:41:34 +08:00 · 提交 · #122 · 遮罩与用例随代码提交

- 执行者：agent-omp-issue-122（OMP，代表 LYsnowQ）
- 做了什么：fix(portal): 宣传片分包未到时显示加载遮罩并可跳过；提交包含 PromoLazy/JoinUs、promo-gate 用例、portal.md 与 README 日期，以及随本分支带入的暂存执行记录
- 结果：本提交见 git log；提交前 tests/web 121 通过 / 3 个既有 Windows 失败，check 各步与 tsc 通过

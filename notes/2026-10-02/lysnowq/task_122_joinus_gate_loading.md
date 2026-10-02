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

## 16:46:27 +08:00 · PR · #122 · 开 PR #180 指向 stage，附前后截图与自审结论

- 执行者：agent-omp-issue-122（OMP，代表 LYsnowQ）
- 做了什么：gh pr create：base=stage、head=task/122/joinus_gate_loading；正文九段含证据（四张改前改后截图钉在 0316df4）、验证命令与真实输出、人工验收步骤、十二项审查与风险回滚；新增 docs/assets/promo-gate/ 四张 webp
- 结果：PR https://github.com/Yangtze-University-Geek-Class/admin/pull/180
- 下一步：补「审查」记录并重推，等 PR CI

## 16:46:27 +08:00 · 审查 · #122 · 自审通过：fallback 从 null 换成与播放层同一套遮罩

- 执行者：agent-omp-issue-122（OMP，代表 LYsnowQ）
- 做了什么：按 CODE-REVIEW 十二项核对 0316df4：分支不变量、不直推 main、无密钥、无 .env/镜像改动、用例能区分修复前后（改回 null 2 失败）、文档同步 portal.md+README、边界 202文件1154导入、提交信息规范、无旧模型与危险操作、执行记录连续、未合并不清理；结论写入 PR 正文
- 结果：无阻塞与未决应修；结论：通过（PR 正文同名小节）
- 下一步：等 PR CI 全绿；合并由维护者决定，合并后按任务清理流程收尾

## 20:15:09 +08:00 · 返工 · #122 · F4：三份文件的行尾从 CRLF 换回 LF

- 执行者：agent-claude-geek-main-subagent-122（Claude Code 子代理，claude-opus-5-5，Crosery 一方接手）
- 做了什么：接手 PR #180（审查 F4）：sed -i '' 's/\r$//' 处理 docs/services/web/README.md、docs/services/web/portal.md、tests/web/portal-promo-gate.test.tsx；单独成一个 style(portal) 提交，不改写历史
- 结果：改后 git grep -lI $'\r' 工作区无输出；git diff --ignore-cr-at-eol 无改动；对 origin/stage 的 docs/services/web/ diff 只剩 README.md 2 +-、portal.md 3 ++-（原来 124 行和 331 行）。文档核对：docs/services/web/README.md、docs/services/web/portal.md 本提交只换行尾，内容不用改

## 20:20:09 +08:00 · 返工 · #122 · F1：遮罩换成播放层时接着淡入，不再从透明重来

- 执行者：agent-claude-geek-main-subagent-122（Claude Code 子代理，claude-opus-5-5，Crosery 一方接手）
- 做了什么：PromoLazy.tsx：Suspense 挪进 LazyPromoPlayer（新增 placeholder 属性，gate 传、桌面重看不传），PromoFallback 在 useLayoutEffect 里记下画出来的时刻 coverSince；PromoPlayer.tsx 新增可选 coverSince，挂上时按「遮罩已经盖了多久」给根节点负的 animation-delay；JoinUs.tsx 改用 <LazyPromoPlayer placeholder>，YugcOs.tsx 去掉外层已经多余的 Suspense；tests/web/portal-promo-gate.test.tsx 改成每条用例重新加载模块、分包由用例放行，新增「分包到了换成播放层」一条；portal.md「分包未到的加载占位」按实际机制重写
- 结果：vitest run tests/web/portal-promo-gate.test.tsx：3 passed；把四个源文件临时换回 9fffb81 的版本再跑：新用例 1 failed（animation-delay: "": expected null not to be null），另外 2 条 passed，已还原；promo-gate/lazy/player/promo/join 五个文件 45 passed；tsc -p app/web/tsconfig.json --noEmit 通过。真实浏览器逐帧未验证（放到最后一个代码提交的构建上做）

## 20:21:47 +08:00 · 返工 · #122 · F8：加载中跳过后分包失败，下次打开不再立刻按失败关掉

- 执行者：agent-claude-geek-main-subagent-122（Claude Code 子代理，claude-opus-5-5，Crosery 一方接手）
- 做了什么：PromoLazy.tsx：loadPlayer 返回 { Player, failed }，import 失败时记 failed；LazyPromoPlayer 打开时（useState 初始化，在 Suspense 外面，挂起重试不会再走）发现上一个失败过就换新的；PromoUnavailable 不再负责换。tests/web/portal-promo-lazy.test.tsx 新增「加载中就关掉、之后分包才失败」一条；portal.md「出错时」补一句
- 结果：vitest run tests/web/portal-promo-lazy.test.tsx：6 passed；把 PromoLazy.tsx 临时换回 a01ab40 的版本：新用例 1 failed（Unable to find role="dialog"，一打开就按失败关掉了），其余 5 passed，已还原；promo-gate/lazy/player 三个文件 29 passed；tsc web 通过

## 20:23:11 +08:00 · 返工 · #122 · F3：减少动态效果时 gate 不显示遮罩、不下载分包

- 执行者：agent-claude-geek-main-subagent-122（Claude Code 子代理，claude-opus-5-5，Crosery 一方接手）
- 做了什么：JoinUs.tsx：挂载时 reducedMotion 且没看过 → promoBlocked，promo 初值 false，effect 里按 blocked 写「看过」的 cookie（onPromoSeen 挪到前面共用）；tests/web/portal-promo-gate.test.tsx 新增减少动态效果一条（无 dialog、无「正在加载…」、inert=false、cookie 已写、播放层分包下载 0 次）；portal.md「分包未到的加载占位」「自动播被拒与减少动态效果」两处同步
- 结果：vitest run tests/web/portal-promo-gate.test.tsx：4 passed；把 JoinUs.tsx 临时换回 0b68462 的版本：新用例 1 failed（expected '' to contain 'yugc_promo_seen=1'），其余 3 passed，已还原；tsc web 通过

# task/312/norms_hardening · crosery · 2026-10-30

负责人：crosery

## 01:17:43 +08:00 · 开工 · #312 · 规范强化：场景分流、部分晋升窗口、hotfix 收紧、事故复盘、agent 规范重排

- 执行者：agent-claude-01d717b4（Claude Code，claude-opus-5-5）
- 做了什么：所有者 2026-10-30 00:54 原话批准（见 GitLab #312 确认依据）；task.mjs start 只查 GitHub issue，查不到 GitLab #312，按 #311 先例手工 git worktree add -b task/312/norms_hardening .claude/worktrees/task-312 gitlab/stage
- 结果：worktree 在 .claude/worktrees/task-312，基线 gitlab/stage 313dafb5

## 03:04:09 +08:00 · 提交 · #312 · 规范强化 6 个提交，rebase 到 gitlab/stage bad8f228

- 执行者：agent-claude-01d717b4（Claude Code，claude-opus-5-5）
- 做了什么：提交 00be2696 forge/task.mjs 走 GitLab、4c59c7ef 部分晋升窗口、ca4851cd hotfix 合回打 hf/stable tag、12f81fb1 规范文档与事故复盘、80fdf12b 宏观对齐声明（论坛部署信息两处证据登记到 forum.state 流程）；rebase 无冲突
- 结果：check-architecture --base gitlab/stage 通过（45 文件，3 节点）；check-doc-sync --base gitlab/stage 通过（8 组）；tooling 8 文件 206 用例通过；论坛 deployment.test.ts 34 用例通过（Node 26.7.0，复制到临时目录用主工作区论坛 vitest 跑）；pnpm check 停在 check:notes（notes/2026-10-29/crosery/task_308_stage_close.md 首条不是开工，既有问题，等所有者裁定），其后 secrets、catalog、cli、typecheck 单独跑都通过
- 下一步：独立审查全量 diff

## 04:12:14 +08:00 · 审查 · #312 · 独立审查 38225a96（03:17）：需返工，18 项

- 执行者：agent-claude-01d717b4（Claude Code，claude-opus-5-5）
- 做了什么：独立审查 agent a6888b63（只读，一次性仓库复现）逐项核对全量 diff：tooling 7 个测试文件 187/187 通过，check-architecture、check-doc-sync、docs-index、check-docs、check-boundaries、check-env-isolation、check-secrets、check-cli、check:catalog 通过
- 结果：结论：需返工。阻塞：conflictResolved 跳过 patch-id；登记后可改 picks；excludes 只在 main 领先时才查；hotfix-sync 临时分支被自己的 pre-push 拦；--preview-tag 没有逐版本授权；AGENTS/AGENT-START/CODE-REVIEW/312.json 互相矛盾；check:notes 被既有的 task_308_stage_close 拦（要所有者裁定）。应修：patch-id 忽略空白；hf/stable 不核对提交形态；重跑已关窗口误打 stable；pickReview 优先旧的已合并 MR；pre-push 认本地 stage；文档与代码漂移。建议：原话与提交时间是自述；forge 接受 http 并跟重定向；hotfix #N 归属说法不一；快照导出接受 rc.01

## 04:12:14 +08:00 · 返工 · #312 · 按审查返工：15 项已改，1 项待所有者裁定，2 项列残留

- 执行者：agent-claude-01d717b4（Claude Code，claude-opus-5-5）
- 做了什么：promotion-windows：去掉 conflictResolved，登记只在 main、登记后改过的窗口整体不放行、改晋升登记不能借 hotfix 窗口、收尾提交放行、excludes 快进也拦；patch-id 改 --verbatim（测试 agent a304a127 实测 git 2.54 下 --stable --verbatim 报错 129，原写法让所有 pick 失败关闭）。check-branch-invariants：只认同次推送或远端跟踪的 stage/main，钩子传 --remote。release-policy：hf/stable 只打在 main 合进 stage 的合并提交上，hf 要归属同版本窗口，stable 要新关闭同版本窗口且 validateWindows 通过。hotfix-sync：--tag-approval 必填，已关窗口重跑不打 stable。forge/task.mjs：只看最新 MR、合并后的本地提交不删、同步临时分支不算 task、令牌只发 https 不跟重定向。快照导出版本校验与维护脚本同口径。文档：AGENTS 两种窗口例外、BRANCHING 禁止事项与 hotfix 时间归属、RELEASES/CHANGE-PATHS/AGENT-START/CODE-REVIEW/技能/env 注释、事故复盘、312.json。文档核对：docs/ops/BACKUP.md 不用改——快照导出只收紧版本参数校验，BACKUP 没写参数格式。文档核对：docs/ops/DEPLOY.md 不用改——env 模板只改注释，键集与部署步骤没变
- 结果：Node 22.23.2 下 tests/tooling 全量 67 文件 1437 passed、27 skipped；check-architecture（50 文件，3 节点）、check-doc-sync（8 组）、docs-index、check-docs（368 篇）、check-env-isolation 通过。未改：check:notes 的既有问题等所有者裁定；原话与提交时间是 MR 自述（残留风险，靠审查核对原话）；git 2.39 以下没有 patch-id --verbatim（算不出时按不归属处理）

## 04:12:14 +08:00 · 提交 · #312 · 返工 5 个提交：12d27cd1 cba2250c 54bb9162 56845e39 bb049983

- 执行者：agent-claude-01d717b4（Claude Code，claude-opus-5-5）
- 做了什么：12d27cd1 晋升窗口登记只在 main 且不可改、pre-push 只认远端 stage；cba2250c hf/stable 提交形态与 --tag-approval；54bb9162 task.mjs 收尾按最新 MR、令牌只发 https；56845e39 快照导出版本校验；bb049983 规范文档对齐代码
- 结果：工作区干净后跑门禁：见上一条返工记录

## 04:14:43 +08:00 · 提交 · #312 · 变基到 gitlab/stage e77036d1，提交 SHA 改写

- 执行者：agent-claude-01d717b4（Claude Code，claude-opus-5-5）
- 做了什么：stage 期间合进 #314/#316/#317/#325 共 53 个提交；git rebase gitlab/stage，生成物（项目目录 6 个文件）冲突按 pnpm catalog:generate 重新生成。返工提交对照：12d27cd1→4357ef5d、cba2250c→ec35ac9b、54bb9162→fc2c0ded、56845e39→aef86bbc、bb049983→7082f4c0、b2ddf85c→65d0885a；更早的提交：00be2696→10f170a4、4c59c7ef→e807c7a9、ca4851cd→098ec186、12f81fb1→8a9ae95a、80fdf12b→20933ad1
- 结果：check:catalog、check-architecture --base gitlab/stage（50 文件）、check-doc-sync --base gitlab/stage（8 组）、check:secrets、check:cli、typecheck 通过；pnpm check 在 check:notes 停于既有的 task_308_stage_close（未改）

## 04:39:52 +08:00 · 返工 · #312 · 按复审 ae2a5317 的应修与建议返工：晋升窗口不能在 stage 上删改，推 main 照旧核对推送前的 excludes

- 执行者：agent-claude-01d717b4（Claude Code，claude-opus-5-5）
- 做了什么：复审应修 1：stage 上先删或改开着的晋升窗口、main 再快进，pre-push 会放行 excludes。promotion-windows 新增 droppedPromotions，judgeAhead 核对 stage 那一版是否删改了 main 上开着的窗口（登记还没合回 stage 时不算），推 main 时加 priorMainSha 拿推送前远端 main 上标 open 的窗口再核对，被删改的窗口前后两版的 excludes 都照旧核对；stage 的 pre-push 在 stage ≥ main 时也拦删改（只拦删改，过期未收尾的窗口要靠合回收尾，不拦），main 位置按推送远端取。标 closed 解除 excludes，写进 BRANCHING 第 6 步和 CHANGE-PATHS。建议项：task.mjs 的 slug 不能以 hotfix_sync_ 开头；forge 不跟重定向加测试（去掉 redirect:error 时测试失败，令牌被带到重定向地址）；pre-push 与 check-branch-invariants 头注释对齐现行规则（含不用 --no-verify 绕过门禁）；AGENTS §1 写 hf / stable，§3 写 --preview-tag 要逐版本授权；RELEASES 写 stage 已改版本号时不带 --preview-tag；312.json 测试数
- 结果：复现：新用例里去掉 priorMainSha 合并 excludes 的修正前，「stage 去掉排除项」用例失败（推送前那一版的 excludes 没核对），修正后通过。Node 22.23.2 下 tests/tooling 全量 68 文件 1472 passed、27 skipped；check-architecture --base gitlab/stage（50 文件，3 节点）、check-doc-sync --base gitlab/stage（8 组）、check-docs（368 篇）、docs-index --check、check:catalog、check:secrets、check:cli、check-env-isolation、typecheck 通过。复审应修 2 的记录更正见下一条

## 04:39:52 +08:00 · 提交 · #312 · 返工提交，并更正两条旧记录

- 执行者：agent-claude-01d717b4（Claude Code，claude-opus-5-5）
- 做了什么：提交本次返工（promotion-windows、check-branch-invariants、task.mjs、pre-push 注释、AGENTS、BRANCHING、CHANGE-PATHS、RELEASES、312.json 与对应测试）。更正：04:14:43 那条写的「变基到 gitlab/stage e77036d1」不对，reflog 记录这次 rebase (start) 是 checkout gitlab/stage d2873ca3，提交对照不变；03:04:09 那条标题写「6 个提交」，正文列的是 5 个（00be2696、4c59c7ef、ca4851cd、12f81fb1、80fdf12b），另一个是同批的开工记录提交
- 结果：旧记录不改，只追加这条更正

## 05:01:37 +08:00 · 审查 · #312 · 复审（04:15 派出，只读）：返工提交 4357ef5d ec35ac9b fc2c0ded aef86bbc 7082f4c0 结论通过

- 执行者：agent-claude-01d717b4（Claude Code，claude-opus-5-5）
- 做了什么：独立复审 agent 逐项核对首轮 18 项与返工 diff，可在 /tmp 建一次性仓库复现，不改本仓
- 结果：结论：通过。首轮 18 项里 16 项已解决；check:notes 的既有问题（要所有者裁定）与开 MR 后补 PR 记录两项按预期留着。应修 2 条：先在 stage 上删或改开着的晋升窗口、main 再快进，excludes 能进 main；04:14:43 的记录把变基目标写成 e77036d1。建议：hotfix_sync_ 前缀、重定向测试、pre-push 与门禁脚本头注释、AGENTS 写 hf/stable 与 --preview-tag 授权、stage 改版本号时的做法、312.json 测试数。残留风险 K3：hotfix 窗口内的提交不要求 -x 痕迹，手抄 excludes 的内容门禁认不出

## 05:01:37 +08:00 · 审查 · #312 · 增量审查 fa45b478（只读）：有条件通过，应修 3 条、建议 3 条

- 执行者：agent-claude-01d717b4（Claude Code，claude-opus-5-5）
- 做了什么：独立审查 agent 只看 fa45b478：在 /tmp/rev312 用一次性仓库复现删窗口、改窗口、强推、过期窗口、同批推送、hotfix-sync 合回、关窗等场景；把脚本换回 fa45b478^ 跑新用例；Node 22 下跑 tests/tooling 全量
- 结果：结论：有条件通过，无必修。应修：1）CI 状态模式与 check 只在 pre-push 带推送前的 main，main 快进落到远端之后删窗口放行（S1b ok=true）；2）强推时远端 main 的 SHA 本地没有，读不到登记就静默跳过；3）pickMainRef 优先推送远端的改动没有测试。建议：stage 登记 windows 不是数组时抛 TypeError；已过期还标 open 的窗口在 stage 上删除不拦；手工建 task/N/hotfix_sync_x 分支能躲过 finish 检查。无误报：task 合进 stage、登记只在 main 时推 stage、hotfix-sync 合回、main 上关窗再合回、stage 上关窗、没有登记文件、首次推 main、stage 与 main 同批推送。新用例里 4 个在修复前失败，重定向测试去掉 redirect:error 时失败；tests/tooling 1472 passed、27 skipped

## 05:01:37 +08:00 · 返工 · #312 · 按增量审查返工：晋升窗口按 main 与 stage 各自的历史核对删改，强推读不到远端 main 就拦

- 执行者：agent-claude-01d717b4（Claude Code，claude-opus-5-5）
- 做了什么：promotion-windows 新增 lostPromotions：用 git rev-list --full-history 读登记文件的各版，历史上登记时标 open 的窗口到这一版必须还在、只改过收尾字段，标过 closed 之后才能删；judgeAhead 对 main 与 stage 各跑一次，main 上被删改的窗口按登记时那一版核对 excludes，CI、pre-push、check 共用，main 快进之后也拦；登记不合法按全删处理，不再抛 TypeError；过期的窗口同样不能删改。推 main 带推送前的远端 main，SHA 本地没有就拒绝并提示先 fetch。task.mjs 只豁免 hotfix-sync 临时目录 hotfix-sync-<后缀>/ 里、分支后缀对得上的同步 worktree。新测试：main 快进后 CI 与 check 拦、合并时丢掉窗口（去掉 --full-history 时失败）、强推远端 main 不在本地、过期窗口删除与登记写坏、stage 推送按推送远端取 main、正常推 stage 不误报、同步 worktree 豁免。BRANCHING 第 3 步、pre-push 与门禁脚本头注释、312.json 跟着改
- 结果：Node 22.23.2 下 tests/tooling 全量 68 文件 1476 passed、27 skipped；真实仓库上 promotion-windows check 0.17 秒。check-architecture --base gitlab/stage（50 文件，3 节点）、check-doc-sync --base gitlab/stage（8 组）、check-docs（368 篇）、docs-index --check、check:catalog、check:secrets、check-env-isolation、typecheck 通过。残留：K3 不改，写进 MR 风险

## 05:01:38 +08:00 · 提交 · #312 · 提交增量审查的返工

- 执行者：agent-claude-01d717b4（Claude Code，claude-opus-5-5）
- 做了什么：promotion-windows、check-branch-invariants、task.mjs、pre-push 注释、BRANCHING、312.json 与对应测试一并提交
- 结果：门禁见上一条返工记录

## 05:06:31 +08:00 · 返工 · #312 · 推送时 pre-push 把别的 worktree 误报成有未提交改动：task.mjs 子进程去掉 git 的本仓库变量

- 执行者：agent-claude-01d717b4（Claude Code，claude-opus-5-5）
- 做了什么：第一次推 task/312/norms_hardening 被钩子拒绝：task-309、task-310-stage-sync 被报成有未提交改动，在 shell 里直接跑 list --check 却是干净的。在 /tmp/hookenv 复现：从链接的 worktree 推送时 git 给 pre-push 导出 GIT_DIR，task.mjs 带着它 git -C <别的 worktree> status 读的是推送方的索引。task.mjs 的子进程去掉 git rev-parse --local-env-vars 列出的变量；加测试：带 GIT_DIR 跑 list --check 不再误报（修复前失败）。之后在主工作区用本分支的 task.mjs 对 #310（issue 已关、没有 MR，tip d2292e31 在 gitlab/stage 上）和 #309（MR !52 已合并，tip 930e9bb4 在 gitlab/main 与 gitlab/stage 上）运行 finish：两个 worktree 与本地分支已删，#309 的收尾记录在主工作区 .claude/notes-pending，#310 的链路没有开工记录、没写收尾
- 结果：tests/tooling/task-worktree.test.ts 26 passed；带 GIT_DIR 跑 list --check，「未提交的改动」由 2 处变 0 处。旧版 task.mjs 只查 GitHub，GitLab 上的 MR 查不到，所以以前不报这两个 worktree

## 05:09:40 +08:00 · PR · #312 · 开 MR !72：task/312/norms_hardening → stage

- 执行者：agent-claude-01d717b4（Claude Code，claude-opus-5-5）
- 做了什么：推送 task/312/norms_hardening（pre-push 分支与发布 tag 规则通过）到 gitlab，经 GitLab API 开 MR !72，目标 stage，标签 infra:ci、infra:tooling，勾选合并后删源分支；正文十段，本地 pr-contract check 通过（审查结论段待增量复核后填写）
- 结果：https://git.yangtzeu.work/geek/admin/-/merge_requests/72 ，head 5140d20e

## 05:16:18 +08:00 · 审查 · #312 · 增量复核 4ba5dff9 与 5140d20e（只读）：需返工，必修 1 条

- 执行者：agent-claude-01d717b4（Claude Code，claude-opus-5-5）
- 做了什么：同一审查 agent 用 /tmp/rev312 的复现脚本重跑旧场景，再找历史核对的新绕过；另核对 5140d20e 去掉 git 本仓库变量的影响面
- 结果：结论：需返工。必修：从登记之前的基线拉 task 分支自写一版 #70（不带 excludes），合 stage 时冲突取自己那版，stage 的 pre-push、main 快进后的 CI 与 check 全部放行；lostPromotions 把拓扑顺序里最早的一版当原版，假的那版排在前面；fa45b478 的 stage 对 main 比对本来能拦，被换掉了。应修：算「已关过」时没要求 closedAt 与 evidence，先假关、改回 open、再删能过。建议：关窗后用同一个 issue 号重新登记会让 CI 一直红，文档要写新窗口用新号；forge.mjs 的 git 调用也去掉本仓库变量。已解决：S1b、S1c、S3a、强推读不到远端 main、登记写坏不再抛错、pickMainRef 与 isSyncWorktree 有测试；列出的流程都没有误报。5140d20e 没有问题，新断言在旧 task.mjs 上失败

## 05:16:18 +08:00 · 返工 · #312 · 按增量复核返工：同一窗口历史里两版登记就算改，恢复 stage 对 main 的比对，假关窗不算关

- 执行者：agent-claude-01d717b4（Claude Code，claude-opus-5-5）
- 做了什么：lostPromotions 不再按顺序取原版：历史里同一个 issue 的登记只要有两版不同（收尾字段之外）就算删改，每一版的 excludes 都核对；标过 open 的窗口被删，只有历史上有写了 closedAt 与 evidence 的 closed 版本才放行。judgeAhead 恢复 fa45b478 的 stage 那一版对照 main 上开着的窗口，与历史核对一起用。repoNeutralEnv 挪到 forge.mjs，forge 的 git 与 gh 调用和 task.mjs 共用。BRANCHING 写明新窗口用新的 issue 号。新测试：task 分支自写同号登记并在合并时保留（stage 推送、快进后的 CI 与 check 都拦）；假关窗、改回 open、再删
- 结果：两条新测试在 4ba5dff9 的脚本上失败、现在通过；Node 22.23.2 下 tests/tooling 全量 68 文件 1478 passed、27 skipped；真实仓库 promotion-windows check 0.14 秒通过；check-architecture、check-doc-sync（均 --base gitlab/stage）、check-docs、docs-index --check、check:secrets、typecheck 通过

## 05:16:18 +08:00 · 提交 · #312 · 提交增量复核的返工

- 执行者：agent-claude-01d717b4（Claude Code，claude-opus-5-5）
- 做了什么：promotion-windows、forge、task.mjs、BRANCHING、312.json 与 promotion-windows 测试一并提交
- 结果：门禁见上一条返工记录

## 05:23:08 +08:00 · 审查 · #312 · 增量复核 848b4f44（只读）：有条件通过，无必修、无应修

- 执行者：agent-claude-01d717b4（Claude Code，claude-opus-5-5）
- 做了什么：同一审查 agent 重跑 s4、s5、假关窗与更早的 S1–S6，再试新绕过 s6（键序与空白、issue 写成字符串或小数、同一版两条 #70、excludes 内键序）
- 结果：结论：有条件通过。s5 被 stage pre-push、main pre-push、check 拦；s4 两种父提交顺序都返回 [70,70]，快进前后 CI 都拦；假关窗再删快进前后都拦；S5d 提示先 fetch。无误报，本仓 HEAD 与 gitlab/*、origin/* 的 lostPromotions 都是 []。键序与空白只改格式、内容等价，不算绕过；excludes 内键换序被当成改动，偏保守。建议：算「关过」时用 validatePromotions 的口径（closedAt 时间写法、evidence 至少 8 个字），现在 closedAt:x、evidence:y 再删，main 快进后 CI 放行（stage CI 与 main pre-push 仍拦）。issue-labels.mjs:274 的 gh 没去掉本仓库变量，不在钩子路径上

## 05:23:08 +08:00 · 返工 · #312 · 按建议统一「关过」的口径：与登记校验一样要求 closedAt 时间写法、evidence 至少 8 个字

- 执行者：agent-claude-01d717b4（Claude Code，claude-opus-5-5）
- 做了什么：promotion-windows 新增 closedProperly，validatePromotions 的 closed 校验与 lostPromotions 的「关过才能删」共用；假关窗测试加一版 closedAt:x、evidence:y
- 结果：改回只要求非空时，这条测试失败；现在通过。Node 22.23.2 下 tests/tooling 全量 68 文件 1478 passed、27 skipped

## 05:25:13 +08:00 · 合并 · #312 · MR !72 合进 stage（8df2f3fd），手工关 #312

- 执行者：agent-claude-01d717b4（Claude Code，claude-opus-5-5）
- 做了什么：GitLab API 在 head 0576adbe 上合并 MR !72（merge commit，合并后删源分支）；GitLab 合进 stage 不自动关 issue，在 #312 与 !72 各留一条「关闭」记录（note 2158、2163）后关闭 #312
- 结果：gitlab/stage = 8df2f3fd，第二父提交 0576adbe；stage 包含 main；promotion-windows check 通过；远端 task 分支已删；#312 closed（05:24:40）。未满足：验收条件 5（pnpm verify）因既有的 task_308_stage_close 记录，等所有者裁定

## 05:25:21 +08:00 · 收尾 · #312 · PR !72 已合并，清理 worktree

- 执行者：agent-claude-01d717b4（Claude Code，claude-opus-5-5）
- 做了什么：node scripts/task.mjs finish 312：删 worktree .claude/worktrees/task-312 与本地分支 task/312/norms_hardening
- 结果：PR 已合并

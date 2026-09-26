# task/115/lifecycle_checks · crosery · 2026-09-26

负责人：crosery

## 15:38:44 +08:00 · 开工 · #115 · 从 origin/stage 28122511456d 建 task/115/lifecycle_checks

- 执行者：agent-claude-geek-main-08（Claude Code，claude-opus-5-5）
- 做了什么：node scripts/task.mjs start 115 lifecycle_checks：建分支与 worktree .claude/worktrees/task-115，在 issue 上留开工记录
- 结果：worktree 已建好，issue 上已留开工记录

## 15:48:22 +08:00 · 方案 · #115 · 文档同步检查、issue 巡检自动关闭、worktree 推送前检查的做法

- 执行者：agent-claude-geek-main-subagent-115（Claude Code 子代理）
- 做了什么：读完门禁文档与 task.mjs、note.mjs、check-docs.mjs、pre-push、ci.yml、issue-lifecycle.yml、branch-hygiene.yml；对照表放 docs/README.md 一节由 scripts/check-doc-sync.mjs 解析；按 git log -1 的提交时间比对模块与文档、工作区改动算作现在、服务文档头「更新：」不早于模块最后改动的北京日期、浅克隆直接报错；PR 另查 base...HEAD 动了模块必须动文档；task.mjs list --check 进 pre-push；每周巡检改成 scripts/issue-sweep.mjs：PR 已合并还开着的 issue 自动关闭并留关闭记录，14 天没动静的留超期记录
- 结果：现状：app/server、app/forum 比文档新（d3f3df7 固定基础镜像 digest），web 文档头日期落后；#112 已被关闭且没有 PR，它的六处不在本 issue 范围内
- 下一步：写脚本与测试，补三份服务文档

## 16:11:15 +08:00 · 开发 · #115 · 接手上一个子代理的未提交改动，核对三份服务文档落后的原因

- 执行者：agent-claude-geek-main-subagent-115（Claude Code 子代理）
- 做了什么：会话重启后接手：读 git diff 与新文件；git log dd93912..HEAD -- app/server、55a14a6..HEAD -- app/forum、329ad3d..HEAD -- app/web 找出让模块变新的提交：d3f3df7（三个 Dockerfile 的 FROM 按 digest 固定）、b3d3d94（论坛镜像的邮箱检查扩到整个产物的文本文件）；对照 app/*/Dockerfile 的 FROM 行与第 76-82 行断言核对文档改动属实
- 结果：server、forum 文档比模块旧（d3f3df7、b3d3d94 没改文档），web 文档头「更新：2026-09-25」早于 b95e3f2 的 2026-09-26；三份文档的补充内容与 Dockerfile 一致
- 下一步：先单独提交三份文档，再提交检查脚本

## 16:12:13 +08:00 · 提交 · #115 · 三份服务文档补上落后的内容

- 执行者：agent-claude-geek-main-subagent-115（Claude Code 子代理）
- 做了什么：docs(docs): 服务文档补上基础镜像按 digest 固定与论坛镜像的邮箱检查（4837515）；pnpm check:docs、node scripts/note.mjs check
- 结果：两项检查通过；这条记录写在提交之后：task 分支还没有自己的提交时 note.mjs 把 HEAD 在 origin/stage 里当成已合并、记录暂存到主工作区，flush 后才进 worktree

## 16:14:53 +08:00 · 开发 · #115 · 文档同步检查：合并提交不算改动，补测试并做变异检查

- 执行者：agent-claude-geek-main-subagent-115（Claude Code 子代理）
- 做了什么：scripts/check-doc-sync.mjs 的 lastChange 加 --no-merges，报错里写真正改模块的提交；补「合并提交不算改动」「GitHub 给 PR 做的合并提交」两个用例；branch-guard 的文档同步一步改成前面失败也照跑；CICD、CODE-REVIEW 第 6 项、TESTING、AGENTS 写明规则；五个变异（同秒算更新、去掉浅克隆检查、去掉 PR diff 检查、合并提交算改动、不看工作区）各自让测试失败，恢复后 15 个用例全过
- 结果：pnpm exec vitest run tests/tooling/doc-sync.test.ts：15 passed；五个变异各有用例失败；node scripts/check-doc-sync.mjs：文档同步通过：6 组模块与文档；actionlint 退出 0

## 16:14:54 +08:00 · 提交 · #115 · 文档跟着模块改的强制检查

- 执行者：agent-claude-geek-main-subagent-115（Claude Code 子代理）
- 做了什么：feat(tooling): 文档跟着模块改的检查进 pnpm check 与 CI；pnpm check
- 结果：pnpm check 退出 0（含 check:doc-sync：文档同步通过：6 组模块与文档）；actionlint 退出 0

## 16:19:12 +08:00 · 开发 · #115 · 推送前拦下该清理的 task worktree

- 执行者：agent-claude-geek-main-subagent-115（Claude Code 子代理）
- 做了什么：task.mjs list --check（上一个子代理写的）改成查不到 PR 就不下结论；pre-push 在分支规则之后跑 list --check；start 发现没启用钩子时提醒 pnpm hooks:enable；task-worktree.test.ts 在临时仓库建两个 worktree、换假 gh，覆盖 list --check 与 pre-push；四个变异（check 不设退出码、离线当成已知、钩子跳过 worktree 检查、有改动的该清 worktree 放行）各让用例失败；BRANCHING、AGENTS、TESTING 写明
- 结果：vitest tests/tooling/task-worktree.test.ts 7 passed，四个变异各有用例失败；本机 node scripts/task.mjs list --check：task worktree 生命周期通过：7 个还在做（3.3 秒）；shellcheck .githooks/pre-push 无输出

## 16:19:13 +08:00 · 提交 · #115 · pre-push 拦下该清理的 task worktree

- 执行者：agent-claude-geek-main-subagent-115（Claude Code 子代理）
- 做了什么：feat(tooling): pre-push 拦下已合并没 finish 的 task worktree；vitest task-worktree、notes；pnpm check:docs；node scripts/check-doc-sync.mjs
- 结果：27 passed；check:docs 退出 0；文档同步通过：6 组模块与文档

## 16:26:18 +08:00 · 开发 · #115 · 每天巡检 issue：补关已合并的，给超期与缺记录的留追踪记录

- 执行者：agent-claude-geek-main-subagent-115（Claude Code 子代理）
- 做了什么：新增 scripts/issue-sweep.mjs（纯函数 planSweep，复用 pr-contract.mjs 的 closingIssues 与 issueFromBranch）；issue-lifecycle.yml 的 weekly-sweep 换成每天的 sweep（issues: write，只检出两个脚本，手工运行可只读）；TRACKING §1 写做完当场关的三种情况与「各个生命周期在哪里强制」表，类型表加 overdue、unrecorded；AGENTS、ISSUES、CICD、TESTING 同步；五个变异（重开的也关、合进 main 的 PR 也算、缺记录重复留、只读也写、超期边界差一天）各让用例失败
- 结果：vitest tests/tooling/issue-sweep.test.ts 10 passed；node scripts/issue-sweep.mjs --repo Yangtze-University-Geek-Class/admin（只读）：没有要处理的 issue（#112 在 16:00 已有作者补的「关闭」记录）；actionlint 退出 0

## 16:26:18 +08:00 · 提交 · #115 · issue 巡检从只告警改成补关与留记录

- 执行者：agent-claude-geek-main-subagent-115（Claude Code 子代理）
- 做了什么：feat(tooling): 每天巡检 issue，补关已合并的并给超期与缺记录的留言；vitest tests/tooling；pnpm check:docs；node scripts/check-doc-sync.mjs；actionlint
- 结果：tests/tooling 全部通过；check:docs 与文档同步通过；actionlint 退出 0

## 16:32:02 +08:00 · 开发 · #115 · 四个提交之后跑完整的 pnpm verify

- 执行者：agent-claude-geek-main-subagent-115（Claude Code 子代理）
- 做了什么：FORUM_PNPM 指向主工作区 .tools/pnpm11、FORUM_NODE=/opt/homebrew/bin/node（v26.8.2），pnpm forum:install 后 pnpm verify；actionlint .github/workflows/*.yml
- 结果：pnpm verify 退出 0：文档同步通过：6 组模块与文档；执行记录通过：11 条链路；核心 Test Files 45 passed、Tests 513 passed；build 通过；论坛 Test Files 15 passed、Tests 240 passed；forum:generate 生成 .output/public；actionlint 退出 0。未验证：工作流在 GitHub 上的真实运行、sweep 对真实仓库的 --apply、pre-push 在别人机器上的表现
- 下一步：交主 agent 集成：推送、开 PR、审查

## 16:36:13 +08:00 · 开发 · #115 #112 · 按 #112 修正服务文档与代码对不上的六处

- 执行者：agent-claude-geek-main-subagent-115（Claude Code 子代理）
- 做了什么：主 agent 转达：#112 作者 16:00 的「关闭」记录把六处交给 #115，主 agent 确认接手。逐条对照代码：db.ts:116、121 建 console_seeds、titles 表；routes/console/index.ts 注册 titles、people；routes/portal/index.ts 注册 org.ts（GET /api/public/org）；app/forum/Dockerfile 断言 t/t73.md、t/t9.md 存在；router.ts 的 meta.anyOf 由 components/ConsoleShell.vue 交给 components/CapabilityGate.vue，pages/Gated.vue 不存在；web 源码地图第 12 行空行把表格截断。只改这几行，另外改 router.ts 注释后按文档同步规则补了 console 文档 src/router.ts 一行（ConsoleShell 把 meta.anyOf 交给 CapabilityGate，没写的页面按 console.access）与更新日期
- 结果：六处都与代码对上；node scripts/docs-index.mjs --check：docs/INDEX.md 是最新的；pnpm check 退出 0（文档同步通过：6 组模块与文档）。另见未改：app/forum/nuxt.config.ts:50 的注释仍说极客班论坛只有 llms.txt，不在 #112 六处里

## 16:36:13 +08:00 · 提交 · #115 #112 · #112 的六处单独一个提交

- 执行者：agent-claude-geek-main-subagent-115（Claude Code 子代理）
- 做了什么：docs(docs): 按 #112 修正服务文档与代码对不上的六处；node scripts/docs-index.mjs --check；pnpm check
- 结果：两项都通过

## 16:38:27 +08:00 · PR · #115 · 开 PR #118

- 执行者：agent-claude-geek-main-08（Claude Code，claude-opus-5-5）
- 做了什么：推送 task/115/lifecycle_checks（8f1f236，含 #112 转来的六处文档修正）后 gh pr create
- 结果：https://github.com/Yangtze-University-Geek-Class/admin/pull/118；派独立审查

## 17:00:59 +08:00 · 审查 · #115 · PR #118 第一轮审查：有条件通过，3 条应修、6 条建议

- 执行者：agent-claude-geek-main-subagent-115（Claude Code 子代理）
- 做了什么：读 PR #118 正文「审查结论」：独立审查代理 2026-09-26 16:57 审 a3bc698（2812251..a3bc698）；应修：issue-sweep 把旧格式关闭后重开的 issue 再关掉（#16 真实数据复现）；squash/rebase 合并跨北京零点让 stage 上「更新：」过期；app/ 只动测试或返工时没有合法的文档改动；建议：gh 非超时失败重试一次、主工作区停在已合并 task 分支时提示切回、补关前查开着的 PR 且只处理合并超过 1 小时的并翻页取评论、服务列表用 git ls-files、补两个变异用例、nuxt.config.ts 注释（#107 在改，不做）
- 结果：结论：有条件通过；主 agent 定了返工方案：排序按 first-parent 历史、task 分支用 PR 级规则加 merge-base 上的排序、「更新：」按作者时间、服务 README 加「最近核对」一行、写明进 stage 只用 merge commit
- 下一步：按主 agent 的方案返工，完成后记「返工」

## 17:09:15 +08:00 · 提交 · #115 · 文档同步改成按第一父链与按 PR 核对

- 执行者：agent-claude-geek-main-subagent-115（Claude Code 子代理）
- 做了什么：fix(tooling): 文档同步按第一父链与按 PR 核对，「更新：」按作者时间比；vitest tests/tooling/doc-sync.test.ts；pnpm check；actionlint
- 结果：21 passed；pnpm check 退出 0（文档同步通过：6 组模块与文档，按 PR 核对（对 origin/stage））；actionlint 退出 0

## 17:13:34 +08:00 · 提交 · #115 · 巡检不再补关重开过的 issue

- 执行者：agent-claude-geek-main-subagent-115（Claude Code 子代理）
- 做了什么：fix(tooling): 巡检不补关重开过、还有开着的 PR、刚合并的 issue，评论翻页取全；vitest tests/tooling/issue-sweep.test.ts；用 #16 与 PR #21 的真实数据（只读）喂 planSweep
- 结果：12 passed；#16 标 REOPENED 时不补关，去掉 stateReason 时复现审查说的 close #16 via PR #21；对真实仓库只读巡检：没有要处理的 issue

## 17:15:04 +08:00 · 提交 · #115 · list --check 重试偶发失败、主工作区停在 task 分支时提示切回

- 执行者：agent-claude-geek-main-subagent-115（Claude Code 子代理）
- 做了什么：fix(tooling): task.mjs 的 gh 偶发失败重试一次，主工作区停在已结束的 task 分支上时提示切回；vitest tests/tooling/task-worktree.test.ts
- 结果：9 passed（新增偶发失败重试、主工作区停在已合并 task 分支两个用例）

## 17:16:13 +08:00 · 返工 · #115 · 按 PR #118 第一轮审查返工：3 条应修与 5 条建议

- 执行者：agent-claude-geek-main-subagent-115（Claude Code 子代理）
- 做了什么：55c816b 文档同步改成非 task 分支按第一父链时间、task 分支按 PR（merge-base 以来动模块就要动文档，另在 merge-base 上按时间核对并写明是 stage 的问题），「更新：」按作者时间的北京日期，服务列表用 git ls-files，四份服务 README 与 CICD 加「最近核对」一行，BRANCHING、CONTRIBUTING、AGENTS 写明只用 merge commit 进 stage；99dd567 巡检带 stateReason，REOPENED、还有开着的 PR、合并不到一小时的不补关，评论到 100 条翻页取全；50427d9 list --check 的 gh 偶发失败重试一次，主工作区停在已结束的 task 分支上提示切回；nuxt.config.ts 注释按主 agent 的决定不改（#107 在改这个文件）；关 squash 与 rebase 要所有者在仓库设置里操作，没动设置
- 结果：三个测试文件 42 passed，tests/tooling 258 passed；变异检查 17 个（文档同步 9 个含 merge-base 换成 stage 现状、巡检 4 个、task.mjs 3 个、另 1 个第一次改错位置没抓到，改对后抓到）全部让用例失败；pnpm check 退出 0；actionlint 退出 0；check-doc-sync --base origin/stage 通过；#16 与 PR #21 真实数据：标 REOPENED 不补关
- 下一步：推送后请审查人按新 head 复查

## 17:16:30 +08:00 · 开发 · #115 · 更正上一条返工记录里的变异检查数

- 执行者：agent-claude-geek-main-subagent-115（Claude Code 子代理）
- 做了什么：上一条写的「变异检查 17 个……全部让用例失败」不准：真正的变异是 16 个（文档同步 9、巡检 4、task.mjs 3），都让用例失败；另有 1 次是我把「比 merge-base」的变异只改了模块那一侧，没改文档那一侧，所以没抓到，改成整个换掉 merge-base 后抓到，它就是文档同步 9 个里的那一个
- 结果：16 个变异全部被用例抓到；那次改错位置的尝试不算数

## 19:17:11 +08:00 · 审查 · #115 · PR #118 第二轮审查：有条件通过，1 条应修、5 条建议

- 执行者：agent-claude-geek-main-subagent-115（Claude Code 子代理）
- 做了什么：读 PR #118 正文「审查结论」第二轮：独立审查代理 2026-09-26 17:47 审 bfff5bb（a3bc698..bfff5bb）；应修：服务 README 与 CICD 里的「最近核对」每个 PR 都改同一行，并行 PR 必然冲突（隔离克隆里 #120、#126 只因这一行冲突）；建议：巡检的 REOPENED 在 issue 开着时一直不变、超期记录写错原因，doc-sync 两个变异没抓到（未提交的已跟踪模块改动、lastAuthored 去掉 --no-merges），stage 落后的「更新：」没写明不是这条分支造成的，TRACKING 还写「同一个提交或之后」、code-review 技能第 7 项缺 check-doc-sync，风险段缺 #106（主 agent 处理）
- 结果：结论：有条件通过；主 agent 定了处置：去掉「最近核对」，「更新：」保留为时间戳，文档事实没变的理由写进本 task 自己的执行记录「文档核对：<文档路径> 不用改——<理由>」，不用 CHECKS.md 加 merge=union
- 下一步：按处置返工，完成后记「返工」

## 19:21:38 +08:00 · 提交 · #115 · 「最近核对」换成执行记录里的文档核对

- 执行者：agent-claude-geek-main-subagent-115（Claude Code 子代理）
- 做了什么：fix(tooling): 文档事实没变时改在 task 执行记录里写文档核对，去掉「最近核对」行；vitest tests/tooling；pnpm check；actionlint
- 结果：tests/tooling 263 passed；pnpm check 退出 0；actionlint 退出 0

## 19:23:58 +08:00 · 提交 · #115 · stage 本来过期的「更新：」写明不是这条分支造成的

- 执行者：agent-claude-geek-main-subagent-115（Claude Code 子代理）
- 做了什么：fix(tooling): 按 PR 核对时 stage 带来的过期「更新：」写明来源；vitest tests/tooling/doc-sync.test.ts；两个变异（不写来源、全都写成来自 stage）
- 结果：26 passed；两个变异各让用例失败

## 19:25:09 +08:00 · 提交 · #115 · 补两个抓变异的文档同步用例

- 执行者：agent-claude-geek-main-subagent-115（Claude Code 子代理）
- 做了什么：test(tooling): 已跟踪文件没提交的改动、合并提交的作者时间两个用例；vitest tests/tooling/doc-sync.test.ts；把审查说的两个变异（diff 改成 mergeBase HEAD、lastAuthored 去掉 --no-merges）各跑一次
- 结果：28 passed；两个变异现在各让一个用例失败

## 19:25:39 +08:00 · 提交 · #115 · TRACKING 与审查技能跟上新的文档同步规则

- 执行者：agent-claude-geek-main-subagent-115（Claude Code 子代理）
- 做了什么：docs(docs): TRACKING 生命周期表改成「同一个 PR 里」，code-review 技能第 7 项加 check-doc-sync --base origin/stage --head 与文档核对的核对；pnpm check:docs
- 结果：check:docs 退出 0

## 19:28:45 +08:00 · 提交 · #115 · 巡检按时间线上的重开时间判断，超期记录写明没补关的原因

- 执行者：agent-claude-geek-main-subagent-115（Claude Code 子代理）
- 做了什么：fix(tooling): 巡检只在最近一次合并之后重开过时不补关，超期记录写明已合并的 PR 与原因；vitest tests/tooling/issue-sweep.test.ts；对真实仓库只读试 GraphQL 查询（#16、#70 返回空，没有重开过）
- 结果：14 passed；真实仓库里现在没有 stateReason 是 REOPENED 的 issue，只读巡检：没有要处理的 issue

## 19:30:02 +08:00 · 返工 · #115 · 按 PR #118 第二轮审查返工：去掉「最近核对」，改用执行记录里的文档核对

- 执行者：agent-claude-geek-main-subagent-115（Claude Code 子代理）
- 做了什么：a42d243 去掉四份服务 README 与 CICD 的「最近核对」，按 PR 核对时模块改了而说明没改，可以在本 task 执行记录里写「文档核对：<文档路径> 不用改——<理由>」，只改「更新：」日期不算改了说明，按时间核对时第一父链上带来文档核对的提交也算文档改动，branch-guard 传 --head；0fc5e7c stage 本来过期的「更新：」写明不是这条分支造成的；6ca23f3 补两个抓变异的用例（已跟踪文件没提交的改动、合并提交的作者时间）；205ac7d TRACKING 表改成同一个 PR 里，code-review 技能第 7 项加 check-doc-sync --base origin/stage --head；22257f1 巡检按时间线上最后一次重开时间判断，超期记录写明已合并的 PR 与没补关的原因；风险段的 #106 由主 agent 处理
- 结果：tests/tooling 17 个文件 267 passed；pnpm check 退出 0（Node v22.23.2）；actionlint 退出 0；check-doc-sync --base origin/stage（带不带 --head）通过；docs-index --check 通过；变异检查 15 个（文档核对 7、来源说明 2、审查说的两个漏网变异 2、巡检重开 4）全部让用例失败。已知：第一轮的 99dd567 提交说明与执行记录里各有一处英文关闭关键字加 issue 号的写法，已推送、只能追加不能改，#16 早已关闭
- 下一步：推送后请审查人按新 head 复查；关掉 squash 与 rebase 仍要所有者操作

## 20:20:55 +08:00 · 提交 · #115 · 合并 stage（#106、#113、#116、#117、#126），解开 server 与 forum 两份 README 的冲突

- 执行者：agent-claude-geek-main-subagent-115（Claude Code 子代理）
- 做了什么：b6674ed 用 git merge --no-ff 合并 origin/stage 3710dd2，合并提交里只有冲突的解法：docs/services/server/README.md 源码地图 app.ts、services.ts、config.ts 三行取 stage 的，portal/index.ts 保留本分支 #112 补的 org 路由，「运行时装」取 stage 的（已含 titles、console_seeds 和 forum_* 表）；docs/services/forum/README.md「断言」取 stage 的 17 篇写法，补回本分支的「published/ 里至少有一张 webp 图片」和「grep -I 跳过图片和字体」（stage 的 app/forum/Dockerfile 这两条断言都还在）；ci.yml 自动合并（core 的 env 与 fetch-depth: 0 都在）。之后按 stage 第一父链逐组核对模块与文档的最后改动时间，并跑 tests/tooling、pnpm check、actionlint、check-doc-sync --base origin/stage --head task/115/lifecycle_checks、note.mjs check --pr --for-review
- 结果：stage 3710dd2 上 6 组模块与文档的最后一次第一父链改动都是同一个合并提交，#116、#126 没有让顺序检查报错；合并后按第一父链的时间核对也没有问题。tests/tooling 18 个文件 305 passed；pnpm check 退出 0（Node v22.23.2）；actionlint 退出 0；check-doc-sync 两种用法都通过（6 组，按 PR 对 origin/stage）；执行记录链路完整
- 下一步：推送 task/115/lifecycle_checks，请审查人按新 head 做第三轮

## 21:03:45 +08:00 · 审查 · #115 · PR #118 第三轮审查：有条件通过，1 条应修、4 条建议

- 执行者：agent-claude-geek-main-subagent-115（Claude Code 子代理）
- 做了什么：按主 agent 转来的第三轮审查结论（审 8a73ae0）逐条核对。应修：所有者 2026-09-26 20:25 说「完成的pr管理的issue必须清理，这个是强制规范」，AGENTS.md、ISSUES.md、TRACKING.md、CODE-REVIEW 与审查技能只把合并后关 issue 写成自动化，没有写成必须；建议：文档核对的理由先去掉零宽字符再判空，模板占位「<理由>」和没有汉字字母数字的理由不算；判断文档有没有真改时忽略空白与空行；巡检用例核对 GraphQL 查询带 REOPENED_EVENT 与 last: 1、GraphQL 失败时不补关、两次合并夹着重开时按最近一次合并算；查不到重开时间时超期记录写明按合并后重开处理
- 结果：结论：有条件通过；应修与 4 条建议都做
- 下一步：逐条返工，完成后记「返工」

## 21:18:49 +08:00 · 返工 · #115 · 按 PR #118 第三轮审查返工：合并后清理写成强制规范，4 条建议都做

- 执行者：agent-claude-geek-main-subagent-115（Claude Code 子代理）
- 做了什么：a014794 AGENTS §2 写明 PR 合并进 stage 后它 Closes 的 issue 必须关闭、task 分支与 worktree 必须清理，自动化没关上的（例如 fork PR 没有写权限，#137）由合并的人当场手工关并留「关闭」记录，§5 黑名单加「合并后关联 issue 仍开着」，ISSUES、TRACKING、PULL-REQUESTS 同样写成必须并引所有者 2026-09-26 的原话，CODE-REVIEW 第 12 项与审查技能第 15 项加合并后可执行的核对（gh issue view 是 CLOSED、ls-remote 没有 task 分支、只读 issue-sweep 没有「将补关」、task.mjs list --check 通过）；e280185 文档核对的理由先去掉 U+200B–U+200D、U+2060、U+FEFF，照抄「<理由>」或没有汉字字母数字的不算；8a5f95c docChange 的 diff 加 -w --ignore-blank-lines；11e0f83 查不到重开时间时超期记录写「被重开过（查不到重开时间，按合并后重开处理），巡检不再补关」，合并后留过「关闭」记录的写明是这个原因；70c581b 巡检用例：假 gh 只认带 REOPENED_EVENT 与 last: 1 的查询、GraphQL 失败不补关、两次合并夹着重开按最近一次合并算；202d81e TESTING 跟上。变异检查：理由校验 4 个、空白 2 个、超期措辞 3 个、巡检查询与合并顺序 5 个
- 结果：变异 14 个全部让用例失败；tests/tooling 18 个文件 310 passed；pnpm check 退出 0（Node v22.23.2）；actionlint 退出 0；check-doc-sync --base origin/stage --head task/115/lifecycle_checks 通过；对真实仓库只读巡检：没有要处理的 issue
- 下一步：推送后请审查人按新 head 复查；关掉 squash 与 rebase 仍要所有者操作

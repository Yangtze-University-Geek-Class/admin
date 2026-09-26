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

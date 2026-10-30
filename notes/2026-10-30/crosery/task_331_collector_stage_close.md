# task/331/collector_stage_close · crosery · 2026-10-30

负责人：crosery

## 08:08:27 +08:00 · 开工 · #331 · 从 gitlab/stage 8df2f3fdda38 建 task/331/collector_stage_close

- 执行者：agent-claude-01d717b4（Claude Code，claude-opus-5-5）
- 做了什么：node scripts/task.mjs start 331 collector_stage_close：建分支与 worktree .claude/worktrees/task-331，在 issue 上留开工记录
- 结果：worktree 已建好，issue 上已留开工记录

## 09:06:34 +08:00 · 提交 · #331 · 收集器：合进任意分支的 MR 关闭的已关闭 Issue 收为待确认候选

- 执行者：agent-t331（Claude Code，claude-haiku-5-5，由 agent-claude-01d717b4 派遣）
- 做了什么：修改 app/server/src/lib/competition-candidates.ts：解析已合并 MR 正文的 GitLab 关闭关键字（Close/Fix/Resolve/Implement 系列，大小写不计，本项目 #n，可用逗号或 and 接多个，Refs 与跨项目写法不算），逐个读 Issue 详情，仅已关闭的才收，按 MR 合并时间记贡献、作者为 Issue 作者；不用 related_merge_requests。tests/server/competition-candidates.test.ts 新增 3 个用例（正例、关键字列表与反例、Refs/未合并/窗外/仍开着的反例）并给假 GitLab 加 Issue 详情路由；endpoint-contracts.md 与两篇 guides（organizer-score-contributions.md、member-competition-signup.md）同步规则；docs/changes/331.json 宏观声明（business）；catalog 用 pnpm catalog:generate 重生成。文档核对：docs/services/forum/ 不用改——只改 guides/ 下两篇使用说明的正文，论坛目录的用途与服务端播种方式没有变化。
- 结果：红：修复前 competition-candidates 2 例失败（created 1 vs 2、1 vs 5），反例通过；绿：npx vitest tests/server/competition-candidates.test.ts 43/43；比赛相关 11 个文件 160/160；pnpm test 全量 191 files passed 1 skipped、3189 tests passed 27 skipped，退出码 0；server tsc --noEmit 退出码 0；check:architecture --base gitlab/stage 通过（7 个变更文件，4 个关联节点）；check:catalog 通过；check:doc-sync 见下；note check 有一条 notes/2026-10-29/crosery/task_308_stage_close.md:5 的既有失败（该文件与 gitlab/stage 完全相同，不是本分支改动）。未验证：真实 GitLab 上的行为（只用注入的假响应）；pnpm check 完整结果另报。

## 09:07:46 +08:00 · 提交 · #331 · 补宏观声明中的项目目录生成物

- 执行者：agent-t331（Claude Code，claude-haiku-5-5，由 agent-claude-01d717b4 派遣）
- 做了什么：docs/changes/331.json 的 coverage 增加 docs/architecture/catalog 六个生成物一项，domains 增加 platform；check:architecture（gitlab/stage）因此通过。pnpm check 完整运行：check:notes 停在 notes/2026-10-29/crosery/task_308_stage_close.md:5 的既有失败（该文件与 gitlab/stage 相同），其后的 check:secrets、check:catalog、check:architecture、check:cli、typecheck 分别单独运行。更正：上一条「提交」结果里的 npx vitest 实际命令是 pnpm exec vitest run tests/server/competition-candidates.test.ts，其余数字不变。
- 结果：check:architecture --base gitlab/stage：宏观对齐通过（13 个变更文件，5 个关联节点）；check:catalog 退出码 0；check:cli 退出码 0（app/cli 没有改动，跳过 cargo）；pnpm typecheck 退出码 0；pnpm check 退出码 1，唯一失败是 check:notes 的既有 308 记录，其余步骤未被阻断前的结果均通过

## 09:45:13 +08:00 · 推送 · #331 · 推送 task 分支到 gitlab

- 执行者：agent-t331（Claude Code，claude-haiku-5-5，由 agent-claude-01d717b4 派遣）
- 做了什么：合入 gitlab/stage 14e46e6d（merge commit 128e074f），重跑门禁后推送 task/331/collector_stage_close 到 gitlab，pre-push 分支与发布 tag 规则通过，task worktree 生命周期通过
- 结果：git push gitlab task/331/collector_stage_close 成功（新分支，已设置上游）；合入后重跑：competition-candidates、promotion-windows、hotfix-sync、hotfix-policy、release-policy、branch-invariants 共 6 个文件 221 tests passed；check:architecture --base gitlab/stage 通过

## 09:45:14 +08:00 · PR · #331 · 开 MR !74 到 stage

- 执行者：agent-t331（Claude Code，claude-haiku-5-5，由 agent-claude-01d717b4 派遣）
- 做了什么：在 GitLab 项目 geek/admin 开 MR !74：task/331/collector_stage_close → stage，标题 feat(server)，标签 func:external 与 server（覆盖 #331 的 func:external），正文十段按 PULL-REQUESTS 契约，Closes #331；未合并
- 结果：MR !74 状态 opened，目标 stage，标签 func:external、server；合并由所有者或授权人另行决定，本记录不代表已合并

## 09:45:14 +08:00 · 审查 · #331 · 作者自审（非独立审查）

- 执行者：agent-t331（Claude Code，claude-haiku-5-5，由 agent-claude-01d717b4 派遣）
- 做了什么：按 CODE-REVIEW 清单 12 项逐项对照 diff（HEAD 128e074f）：分支不变量、无直推 main、无密钥入库、env 与 compose 无改动、测试与文档同步、边界规则、提交信息、旧模型残留、危险操作、执行记录、宏观对齐、标签与证明。文档核对：docs/services/forum/ 不用改——只改 guides/ 下两篇使用说明的正文，论坛目录用途与服务端播种方式没有变化
- 结果：结论：有条件通过。条件：独立审查人复核后补记审查结论；stage 基线失败（check:notes 的 task_308 记录、check:env-isolation 的 deploy/hotfix/windows.json 域名上限、check:doc-sync 的 deploy/ 与 docs/ops 不同步）由 #328 修复，其中 doc-sync 是否在 #328 范围内待确认。审查人：作者本人，不是独立审查；独立审查人与时间待补
- 下一步：等独立审查人复核，补记审查结论；等 #328 修复基线后重跑 CI

## 10:33:37 +08:00 · 提交 · #331 · 返工：收集器认冒号与完整路径的关闭关键字，Issue 开着也收（748f1aa6）

- 执行者：agent-t331（Claude Code，claude-haiku-5-5，由 agent-claude-01d717b4 派遣）
- 做了什么：按审查意见修改 app/server/src/lib/competition-candidates.ts 与 tests/server/competition-candidates.test.ts：去掉 Issue 必须已关闭的条件；关闭关键字接受冒号与本项目完整路径，其它项目、Refs、Related to 仍不算；closingIssueIids(description, project) 导出并直接测试；404、403、5xx 只跳过单个编号、计入 skipped 并记 warn 日志；驳回或控制台确认过的候选不再读 Issue 详情，待确认与经标签加分的仍读。
- 结果：红：修改前 competition-candidates.test.ts 61 例中 8 例失败（冒号、完整路径、开着的 Issue、404 计数、403/5xx 整轮失败、驳回后仍读详情、解析单测 3 例），其余 53 例通过。绿：同一文件 61/61；比赛相关 11 个测试文件 178/178；pnpm --filter @yzgc/server exec tsc --noEmit 通过。

## 10:34:26 +08:00 · 提交 · #331 · 返工：收集规则文档、变更声明与项目目录同步（4f4e8e2c）

- 执行者：agent-t331（Claude Code，claude-haiku-5-5，由 agent-claude-01d717b4 派遣）
- 做了什么：endpoint-contracts.md 收集规则一段、组织者计分指南第 2 条、参赛者指南第 7 条改为「关闭关键字收为候选，不要求 Issue 已关闭，分数来自 Issue 上的「有用」与两档标签（自动）或控制台确认」；docs/changes/331.json 的 summary、各 assessment、verification（12 + 9 条用例）、compatibility 同步；docs/architecture/catalog 六个生成物用 pnpm catalog:generate 重新生成。文档核对：docs/services/forum/ 不用改——只改 app/forum/content/guides/ 下两篇使用说明的正文，论坛目录用途与服务端播种方式没有变化。
- 结果：pnpm check:docs、check:catalog、check:secrets、check:boundaries 通过；pnpm check:architecture --base gitlab/stage 通过（宏观对齐通过：#331）；node scripts/check-doc-sync.mjs --base gitlab/stage 只报 gitlab/stage 上既有的 deploy/ 与 docs/ops 不同步，本分支没有 deploy/ 改动。

## 10:34:27 +08:00 · 返工 · #331 · 返工：按审查意见收口关闭关键字规则、读取预算与测试，并做真实接口只读核对

- 执行者：agent-t331（Claude Code，claude-haiku-5-5，由 agent-claude-01d717b4 派遣）
- 做了什么：1）按 team-lead 决定去掉 Issue 须已关闭的条件：合进 stage 的 MR 不会自动关 Issue，正是本需求要覆盖的情形。2）关闭关键字接受冒号（Closes: #n）与本项目完整路径（group/project#n）；其它项目、Refs、Related to 仍不算；closingIssueIids(description, project) 导出并直接测试；键统一用 issueKey。3）404、403、5xx 只跳过这一个编号，计入 skipped 并记 warn 日志，其它失败仍整轮不应用。4）驳回或控制台确认过的候选不再读 Issue 详情，待确认与经标签加分的仍读：标签改不了前两者的结果；待确认与标签加分要读，因为 Issue 在窗口前创建时只有这次读取能看到之后挂上的标签。5）测试改为真实 GitLab 形状的负载：description 为 null、重复收集、closed_by 与正文重叠、404、403/5xx、驳回不复活且不再读、窗口前 Issue 之后挂标签仍自动加分、冒号与完整路径。6）只读核对，脚本在仓库外 /tmp/t331-verify/verify.mts，只发 GET，不写 GitLab，令牌取自钥匙串且不打印。
- 结果：红：修改前 tests/server/competition-candidates.test.ts 共 61 例，8 例失败（Closes: 与完整路径解析 3 例、Issue 仍开着 1 例、404 计数 1 例、403/5xx 整轮失败 1 例、驳回后仍读详情 1 例、其余为解析单测），53 例通过。绿：同一文件 61/61。测试修正：驳回请求的操作人由 alice 改为有 competition.score.review 的 bob，alice 没有该权限会返回 403，属于测试设置问题，与实现无关。比赛相关 11 个测试文件 178/178 通过。只读核对（geek/admin）：已合并 MR 72 个，描述全为字符串；正文含关闭关键字的 56 个（stage 45、main 11）；引用的不同 Issue 43 个，43 个都读到 200，其中 6 个仍开着。这 43 个在不核对作者映射、不按比赛窗口过滤时会成为候选；比赛窗口不在仓库里，作者映射与报名过滤需要线上库，两项均未核对。

## 10:34:27 +08:00 · 审查 · #331 · 更正：上一条审查记录的 CODE-REVIEW 清单条数

- 执行者：agent-t331（Claude Code，claude-haiku-5-5，由 agent-claude-01d717b4 派遣）
- 做了什么：上一条「审查」记录写 CODE-REVIEW 清单 12 项，实际为 15 项（docs/conventions/CODE-REVIEW.md 第 1–15 条）。原记录不改，以本条为准。
- 结果：更正已记录；清单条数以 CODE-REVIEW.md 为准，审查结论不因此变化。

## 10:36:42 +08:00 · PR · #331 · 更新 MR !74 的标题与正文（返工后）

- 执行者：agent-t331（Claude Code，claude-haiku-5-5，由 agent-claude-01d717b4 派遣）
- 做了什么：MR !74（task/331/collector_stage_close → stage）标题改为 feat(server): 比赛收集器收录合进任意分支的 MR 正文关闭的 Issue（#331），正文按十段契约重写：目的、关联（Closes #331，标签 func:external、server）、变更范围、宏观对齐（含取舍）、解决链路、验证（红绿、只读核对、基线失败）、验收证据（无界面变化及理由）、人工验收步骤、审查结论（作者自审，有条件通过）、风险与回滚（含团队负责人决定与基线）。MR 未合并。
- 结果：GET 确认 MR 打开、目标 stage、标签未变；PUT 后 state opened、target stage、正文 4503 字符，十段齐全，可见结论行 1 行。

## 10:56:15 +08:00 · 开发 · #331 · 只读核对：按比赛窗口重跑（2026-10-21 至 2026-11-15，北京时间）

- 执行者：agent-t331（Claude Code，claude-haiku-5-5，由 agent-claude-01d717b4 派遣）
- 做了什么：用同一只读脚本加窗口参数重跑 geek/admin。只发 GET，未写 GitLab，令牌取自本机钥匙串且未打印。窗口按 MR 合并时间过滤，与收集器的 MR 窗口判定一致。
- 结果：已合并 MR 72 个，全部在窗口内（合并于 2026-10-23 至 2026-10-30）；正文含关闭关键字的 56 个（stage 45、main 11）；引用的不同 Issue 43 个，全部读到 200。候选编号 43 个（未核对作者映射与报名过滤）：270–295、298–301、303–306、308–312、314、316、317、325。结果与不加窗口时相同。

## 10:56:16 +08:00 · 审查 · #331 · 更正：撤回 PR 记录里的作者自审结论，审查改由团队负责人执行

- 执行者：agent-t331（Claude Code，claude-haiku-5-5，由 agent-claude-01d717b4 派遣）
- 做了什么：PR 记录里写的「审查结论（作者自审，有条件通过）」撤回，原记录不改。团队负责人确认由其执行独立审查，作者不写审查结论。MR 审查结论段改为待审查人补写，删去作者自查的清单段。团队负责人接受跳过 GET 的偏离（驳回与控制台确认过的候选不读详情，待确认与标签加分的仍读），MR 风险第 6 条已写明。check:doc-sync 的 deploy/ 与 docs/ops 不同步归 #328 修复，由团队负责人确认。
- 结果：MR !74 正文已更新：10 段齐全，可见结论行 0 行，待审查人补写；CI pr-contract 在补写前会失败，属预期。

## 13:51:38 +08:00 · 提交 · #331 · 合并提交 f3f96d3f：合入新 stage（含 #328、#332）

- 执行者：agent-claude-01d717b4（Claude Code，claude-opus-5-5）
- 做了什么：git merge gitlab/stage（e1683654）；项目目录 6 个生成物冲突用 pnpm catalog:generate 重新生成，未手改
- 结果：pnpm check 各步逐项通过；architecture、doc-sync 带 --base gitlab/stage 通过；check-privacy --commits 通过（11 条）

## 13:51:38 +08:00 · 审查 · #331 · 主控审查 MR !74：通过

- 执行者：agent-claude-01d717b4（Claude Code，claude-opus-5-5）
- 做了什么：按 CODE-REVIEW 核对 f3f96d3f：只认 GitLab 官方关闭关键字、跨项目与 Refs 不算；按 MR 合并时间算窗口并取最早一次；403/404/5xx 只跳过单个编号，其它非 200 整轮不应用；驳回与已确认候选不再读详情
- 结果：结论通过；全量 pnpm test 196 个文件全部通过（3293 通过、13 跳过），1 个 vitest worker 通信超时不对应用例；PR 正文契约通过；残留：URL 形式的关闭写法认不出

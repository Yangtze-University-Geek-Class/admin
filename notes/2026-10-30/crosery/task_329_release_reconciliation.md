# task/329/release_reconciliation · crosery · 2026-10-30

负责人：crosery

## 08:28:07 +08:00 · 开工 · #329 · 从 gitlab/stage 14e46e6d20f3 建 task/329/release_reconciliation

- 执行者：agent-claude-01d717b4（Claude Code，claude-opus-5-5）
- 做了什么：node scripts/task.mjs start 329 release_reconciliation：建分支与 worktree .claude/worktrees/task-329，在 issue 上留开工记录
- 结果：worktree 已建好，issue 上已留开工记录

## 08:29:57 +08:00 · 方案 · #329 · ADR-0006 环境面清单自动对账

- 执行者：agent-claude-01d717b4（Claude Code，claude-opus-5-5）
- 做了什么：读 RELEASE-PARITY（第五节自述漏登记是盲区）、GitLab 事故复盘、deploy-production.yml 的 job 顺序、platform-maintenance.sh 的断网辅助容器做法、project-catalog 的隔离注册；写 docs/decisions/0006-release-surface-reconciliation.md：六段清单（code/api/schema/data/config/external，宿主摘要由流水线追加）、三道门（预发布部署后存清单；发正式前 reconcile：现状清单、备份副本演练、差异逐条找出处；部署后与预发布同提交清单一致）、日常漂移核对、同构清单只留观测不到的事项、数据迁移带不变量；业界出处 Atlas/Flyway/Liquibase、expand/contract、oasdiff/Pact、GitLab Database Lab、GitOps 漂移、十二要素。
- 结果：ADR 已提交；核对中发现 GITLAB_SYNC 模板与库内生效值相反（预发布模板 on、生效 off；正式模板 off、生效 on），作为本单要修的漂移
- 下一步：按 ADR 实现生成器、差异解释、流水线三道门与漂移核对

## 09:01:28 +08:00 · 提交 · #329 · 1f9c1dcf 环境面清单的归一化、比较与差异解释

- 执行者：agent-t329（Claude Code，claude-opus-5-5，由 agent-claude-01d717b4 派遣）
- 做了什么：新增 scripts/surface.mjs（normalize/diff/drift/bind-catalog/attach-host/check-rehearsal/explain）与 tests/tooling/surface.test.ts；parity.mjs 条目加可选 explains 并校验
- 结果：vitest tests/tooling/surface.test.ts 先报缺模块失败，实现后 12 通过；tests/tooling/parity.test.ts 新用例先失败，实现后 24 通过
- 下一步：提交 server 里的生成器与不变量登记表

## 09:01:36 +08:00 · 提交 · #329 · a04152eb 环境面清单生成器与不变量登记表

- 执行者：agent-t329（Claude Code，claude-opus-5-5，由 agent-claude-01d717b4 派遣）
- 做了什么：app/server 新增 lib/surface.ts、lib/surface-invariants.ts、cli/surface.ts（generate/rehearse/copy）；项目目录登记三个文件归 platform 并重新生成；服务文档写生成器命令与比较范围的限制
- 结果：tests/server/surface.test.ts 先缺模块失败，实现后 10 通过；server tsc 通过；tsx 跑 generate 输出 305 路由、69 表，密钥值出现 0 次
- 下一步：部署脚本 surface-stack.sh 与三个部署工作流的三道门

## 09:29:28 +08:00 · 提交 · #329 · 337386f6 清单里邮箱与 user@host 形状的值只记摘要

- 执行者：agent-t329（Claude Code，claude-opus-5-5，由 agent-claude-01d717b4 派遣）
- 做了什么：lib/surface.ts 的 config 段对含 @ 的非密钥值记 sha256 前 16 位并标 masked；GitLab 同步覆盖用例改成不绑定模板当前值；服务文档同步
- 结果：tests/server/surface.test.ts 新用例先因 DEPLOY_PROXY_JUMP 原样出现失败，实现后 11 通过；server tsc --noEmit 通过
- 下一步：提交部署流水线的三道门与日常漂移核对

## 09:29:36 +08:00 · 提交 · #329 · 70a23a25 部署流水线的环境面对账三道门与日常漂移核对

- 执行者：agent-t329（Claude Code，claude-opus-5-5，由 agent-claude-01d717b4 派遣）
- 做了什么：新增 deploy/remote/surface-stack.sh、boot-probe.mjs、surface-drift.yml；deploy-production 加 reconcile job（parity 之后、build 之前）与 deploy job 里 deploy-stack 之前的对账、部署后核对；deploy-hotfix 按 ADR 的 hotfix 规则；deploy-preview 部署后保存清单；install-host 装入并加 digests；CICD、DEPLOY 写顺序与理由
- 结果：surface-stack 7、surface 14、install-host 与工作流结构测试通过；actionlint 1.7.12 与 shellcheck 无报告；没有在 GitHub Actions 与目标机真实运行
- 下一步：提交 GITLAB_SYNC 模板对齐与 P-0007、P-0011 收尾

## 09:29:44 +08:00 · 提交 · #329 · e51babb5 GITLAB_SYNC 模板与库内生效值对齐，关闭 P-0007、P-0011

- 执行者：agent-t329（Claude Code，claude-opus-5-5，由 agent-claude-01d717b4 派遣）
- 做了什么：deploy/env 正式 GITLAB_SYNC=on、预发布 off；parity.mjs done P-0007、P-0011 带 gitlab-cutover 与 switch-issuer 运行证据；ENVIRONMENTS 同步；deployment-environment 测试夹具按新模板调整
- 结果：parity.mjs check：13 条、0 pending；deployment-environment 测试通过
- 下一步：提交 RELEASE-PARITY 改写与 docs/changes/329.json，跑 pnpm check

## 09:32:45 +08:00 · 提交 · #329 · b591ee2d 同构规则改为环境面清单自动核对

- 执行者：agent-t329（Claude Code，claude-opus-5-5，由 agent-claude-01d717b4 派遣）
- 做了什么：RELEASE-PARITY 第三到第八节按 ADR-0006 改；release-parity 技能对齐；写 docs/changes/329.json；项目目录与 docs/INDEX.md 重新生成
- 结果：pnpm check 分项：check:boundaries 报 lib/surface.ts 依赖应用组装、check:architecture --base gitlab/stage 要求 lib 改动按业务声明，随后把生成器移出 lib 修正；check:env-isolation（deploy/hotfix/windows.json）与 check:notes（task_308_stage_close.md）在 gitlab/stage 上同样失败，不是本单改动
- 下一步：生成器移到 app/server/src/surface/，重跑全部门禁

## 09:33:01 +08:00 · 提交 · #329 · fc9e3eae 生成器移出 lib，归入组装层

- 执行者：agent-t329（Claude Code，claude-opus-5-5，由 agent-claude-01d717b4 派遣）
- 做了什么：lib/surface.ts、lib/surface-invariants.ts 移到 app/server/src/surface/manifest.ts、invariants.ts；cli、测试、文档、目录归属与 329.json 路径同步
- 结果：check-boundaries 通过；server tsc 通过；server 与 tooling 的 surface 测试和 project-catalog 测试 44 通过
- 下一步：重跑 pnpm check 全部分项与 tests/tooling、tests/server/surface 全量

## 10:17:52 +08:00 · 开发 · #329 · fc9e3eae 门禁与回归

- 执行者：agent-t329（Claude Code，claude-opus-5-5，由 agent-claude-01d717b4 派遣）
- 做了什么：pnpm check 各分项；node scripts/check-architecture.mjs --base gitlab/stage；node scripts/check-doc-sync.mjs --base gitlab/stage；pnpm exec vitest run tests/tooling tests/server/surface.test.ts；actionlint 1.7.12 与 shellcheck
- 结果：architecture 通过（42 个变更文件）、boundaries、doc-sync、catalog、secrets、typecheck 等通过；vitest 1515 通过、1 失败、27 跳过，失败的是 env-isolation 对 deploy/hotfix/windows.json 的域名计数，与 check:notes 对 task_308_stage_close.md 的链路顺序一样在 gitlab/stage 上已存在、本单未改这些文件；新步骤没有在 GitHub Actions 与目标机真实运行
- 下一步：等审查；不推送、不开 MR

## 10:35:18 +08:00 · 返工 · #329 · 774c26e2 P-0007 留给 #308 收尾

- 执行者：agent-t329（Claude Code，claude-opus-5-5，由 agent-claude-01d717b4 派遣）
- 做了什么：审查第 10 条：ledger 里 P-0007 恢复成 stage 上的 pending 条目；329.json 说明同步
- 结果：parity.mjs check：13 条、pending 1 条（P-0007）
- 下一步：改 ADR-0006 第二节与实现一致

## 10:35:45 +08:00 · 返工 · #329 · 23358eb0 ADR-0006 第二节按实际门禁位置改写

- 执行者：agent-t329（Claude Code，claude-opus-5-5，由 agent-claude-01d717b4 派遣）
- 做了什么：审查第 1 条：reconcile 在 build 前挡缺清单与范围；现状、演练、explain 在 deploy job 的 deploy-stack 之前；偏离理由写进 ADR
- 结果：文档改动，无测试
- 下一步：smell 修正（第 12 条）

## 10:37:16 +08:00 · 返工 · #329 · 67527a4e 生成器的命名与输入类型

- 执行者：agent-t329（Claude Code，claude-opus-5-5，由 agent-claude-01d717b4 派遣）
- 做了什么：审查第 12 条：masked 改名 looksLikeAddress；SurfaceInput 类型；两份 canonical 的摘要一致性测试
- 结果：server surface 测试 12 通过（新用例直接通过，固定现状）；server tsc 通过
- 下一步：data 段补赛事站点必需记录（第 7 条）

## 10:40:34 +08:00 · 返工 · #329 · 1d9d39af data 段记必需的赛事站点

- 执行者：agent-t329（Claude Code，claude-opus-5-5，由 agent-claude-01d717b4 派遣）
- 做了什么：审查第 7 条：REQUIRED_COMPETITION_SITES 与 smoke.json 一致；生成器记站点在不在与上线版本状态；check-candidate 要求必需站点存在且 passed
- 结果：先 3 失败，实现后 server 与 tooling surface 共 28 通过
- 下一步：生成器不用 root，读现状先取一致副本（第 8 条）

## 10:43:28 +08:00 · 返工 · #329 · 713efb09 辅助容器不用 root，现状先取一致副本

- 执行者：agent-t329（Claude Code，claude-opus-5-5，由 agent-claude-01d717b4 派遣）
- 做了什么：审查第 8 条：--user 1000:1000、去掉 DAC_OVERRIDE；env 与 boot-probe 复制进 700 副本目录；generate 先 copy 再读副本；本机 WAL 只读目录核对：写者开着可读可备份，写者关了报 SQLITE_READONLY_DIRECTORY
- 结果：surface-stack 先 2 失败，改后与 server surface 共 22 通过；shellcheck 无报告
- 下一步：host 段补 GitLab 签发者与边缘 Caddy 摘要（第 6 条）

## 10:55:55 +08:00 · 返工 · #329 · 审查第 6 条：host 段加 GitLab 签发者与香港入口站点

- 执行者：agent-t329（Claude Code，claude-opus-5-5，由 agent-claude-01d717b4 派遣）
- 做了什么：surface-stack.sh 新增 host 子命令与受限白名单 host preview|production；签发者按 {origin} 归一化后只记摘要；surface.mjs 收具名片段，香港入口一边没记时不比
- 结果：6 个用例先失败后通过；tooling 五个文件 108 通过，shellcheck、actionlint 无报告
- 下一步：香港入口那一行由对账脚本取（第 3 条）

## 11:14:32 +08:00 · 返工 · #329 · 审查第 3 条：三道门编排收进 surface-gate.mjs

- 执行者：agent-t329（Claude Code，claude-opus-5-5，由 agent-claude-01d717b4 派遣）
- 做了什么：新增 scripts/surface-gate.mjs（candidate、range、preview、pre-deploy、post-deploy），三条部署工作流改调它，正式与 hotfix 参数只差 --mode；香港入口站点摘要用 GITLAB_EDGE_SSH_KEY 的 plan 接上
- 结果：surface-gate 10 个与 hotfix-policy 1 个新用例先失败后通过；相关 8 个测试文件 149 通过，actionlint 无报告
- 下一步：deploy-manual 调同一脚本（第 2 条）

## 11:15:06 +08:00 · 返工 · #329 · 审查第 2 条：deploy-manual 跑同样的门

- 执行者：agent-t329（Claude Code，claude-opus-5-5，由 agent-claude-01d717b4 派遣）
- 做了什么：deploy-manual.mjs 调同一 tag 的 surface-gate.mjs：正式 candidate、range 在下载前，pre-deploy 在 deploy-stack 前，post-deploy 在后；预发布跑 preview；接受 --preview-surface；CICD.md 第 183 行与第 7 步跟着改
- 结果：deploy-manual.test.ts 旧脚本上 5 个失败，改后 27 通过；与 arch-target 合计 34 通过
- 下一步：gate 3 位置与烟测条件（第 4 条）

## 11:22:38 +08:00 · 返工 · #329 · 审查第 4 条：第 3 道门在写部署结果之前

- 执行者：agent-t329（Claude Code，claude-opus-5-5，由 agent-claude-01d717b4 派遣）
- 做了什么：三条部署工作流的记录部署结果排到清单与保存产物之后，success 带清单 sha256；deploy-stack 先写 switched 标记，smoke 改为 always() 且标记为 true；漂移基线由 surface-gate.mjs baseline 只取带清单 sha256 的 success 记录并核对产物
- 结果：surface-gate 新增 11 个用例在旧工作流上全部失败，改后 21 通过；deploy-manual 与 deploy-doc-sync 共 40 通过；actionlint 无报告
- 下一步：explain 按项目目录节点对账并纳入 host（第 5 条）

## 11:35:26 +08:00 · 返工 · #329 · 差异解释按项目目录节点对账并纳入宿主段

- 执行者：agent-t329（Claude Code，claude-opus-5-5，由 agent-claude-01d717b4 派遣）
- 做了什么：explain 的接口差异只认 route 节点与操作节点相同的流程，表差异只认 table 节点、库级差异认 database:data.db，去掉源码路径与文字匹配；host 段纳入比较，物料按 install-host.sh 物料表对应到 deploy/remote 源文件，片段只认本版本同构清单条目；hotfix 候选宿主摘要由 expected-host 按候选提交物料计算，部署后直接比较；RELEASE-PARITY 第五节、CICD、ADR-0006、329.json 同步，329.json 补上 deploy-manual.mjs 覆盖
- 结果：surface.test 新增 5 条先红（5 failed）后绿 21/21；surface-gate hotfix 用例先红后绿 22/22；相关 8 个测试文件 171 条中 parity.test 2 条因第 4 条改了烟测条件而失败，另行修正；check-architecture 通过；actionlint 通过
- 下一步：修正 parity.test 的烟测条件断言，再做第 9 条

## 11:49:18 +08:00 · 返工 · #329 · 工作流测试跟上第 3 道门之后的新顺序

- 执行者：agent-t329（Claude Code，claude-opus-5-5，由 agent-claude-01d717b4 派遣）
- 做了什么：第 4 条把记录部署结果移到宿主层与清单之后、烟测改为栈切换过就运行，install-host.test 与 parity.test 仍断言旧顺序与旧条件；改为断言新顺序与新条件
- 结果：跑与本单相关的 32 个 tooling 测试文件时发现 install-host 3 条、parity 2 条失败；修正后两文件 36/36 通过（对 HEAD 的工作流另行核对了宿主层步骤的切片）
- 下一步：第 9 条：受限密钥条目由 install-host 安装核对

## 11:50:03 +08:00 · 返工 · #329 · 漂移核对的受限密钥条目由 install-host 安装核对

- 执行者：agent-t329（Claude Code，claude-opus-5-5，由 agent-claude-01d717b4 派遣）
- 做了什么：install-host.sh 的 plan/apply/verify 管部署用户 authorized_keys 里标记为 yzgc-surface-drift 的一行：公钥取 deploy/remote/surface-drift.pub（合入时为空），条目固定到 surface-stack.sh forced 加 no-pty、no-port-forwarding 等；公钥混进别的条目时 verify 失败、apply 不动手；没有公钥时撤下条目；三条部署工作流把公钥随物料分发；跳板机转发授权登记为同构清单 P-0014（post_deploy，release 0.1.2）；CICD、DEPLOY、RELEASE-PARITY、surface-drift.yml 头注释与 329.json 同步。更正上一条记录：那条写的 36/36 不准确，当时工作区已带本条的 tar 改动，实跑是 33/36，HEAD 的工作流另用脚本核对了切片、顺序与 tar 字符串
- 结果：install-host.test 新增 5 条，其中 4 条先红后绿，默认不装的 1 条改前就通过；工作流 tar 断言 3 条先红后绿；install-host 与 parity 两文件 41/41；shellcheck、actionlint 通过；parity check 14 条格式正确，--release --version 0.1.2 只拦 P-0007
- 下一步：第 11 条：CHANGE-PATHS 与 CODE-REVIEW 第 15 项改成新规则

## 11:50:16 +08:00 · 返工 · #329 · CHANGE-PATHS 与 CODE-REVIEW 第 15 项改成清单核对加同构清单兜底

- 执行者：agent-t329（Claude Code，claude-opus-5-5，由 agent-claude-01d717b4 派遣）
- 做了什么：CHANGE-PATHS 配置、表结构、宿主三行的检查列与「预发布做过的事」一条、验证段的同构命令改成：清单看得到的由发正式前的对账核对，接口与表要写项目目录节点，同构清单只记看不到的；CODE-REVIEW 第 15 项同样改写；豁免署名与原话的措辞留给 #328；329.json 的文档覆盖加上这两份
- 结果：check-architecture 通过
- 下一步：跑门禁并核对 ADR 工作区那一行

## 12:18:15 +08:00 · 返工 · #329 · P-0011 回到 stage 的状态

- 执行者：agent-t329（Claude Code，claude-opus-5-5，由 agent-claude-01d717b4 派遣）
- 做了什么：同构清单 P-0011 的 production 段从 done 改回 pending，与 gitlab/stage 的这一条逐字一致；329.json 的 summary、data 评估、覆盖说明与 migration 不再写 P-0011 关闭
- 结果：parity check 14 条格式正确、pending 3 条；与 gitlab/stage 的 P-0011 序列化后相同
- 下一步：复审第 2 条：同构旧说法改成清单核对加同构清单

## 12:20:08 +08:00 · 返工 · #329 · 同构旧说法改成清单核对加同构清单

- 执行者：agent-t329（Claude Code，claude-opus-5-5，由 agent-claude-01d717b4 派遣）
- 做了什么：AGENTS.md 部署门禁、RELEASES 第 5 步与同构段与 hotfix 同构预防、DEPLOY 开头、PR 模板风险段、deploy-production 与 deploy-hotfix 的 parity 注释改成 ADR-0006 第四节的说法；329.json 的文档覆盖加上这几份
- 结果：docs-index 最新；check-docs 369 篇通过；check-doc-sync 与 check-architecture（53 个变更文件）通过；pr-contract、hotfix-policy、parity、deploy-doc-sync 97/97；actionlint 通过
- 下一步：复审第 3 条：server 清单测试的断言改回 toEqual

## 12:21:35 +08:00 · 返工 · #329 · 清单测试的断言改回 toEqual

- 执行者：agent-t329（Claude Code，claude-opus-5-5，由 agent-claude-01d717b4 派遣）
- 做了什么：tests/server/surface.test.ts 的 required_records 断言从 toMatchObject 改回 toEqual 并写全期望值；同文件 MAIL_RECIPIENTS、MAIL_RESEND_FROM、站点 rejected 形状改成 toEqual，演练报告先挑字段再 toEqual
- 结果：tests/server/surface.test.ts 15/15；文件里不再有 toMatchObject
- 下一步：复审第 4、5 条：ADR 写必需站点为什么记字段状态、入场核对查必需站点、香港入口只在两边都有时比较

## 12:22:30 +08:00 · 返工 · #329 · ADR 补必需站点的记法、入场核对与香港入口的已知限制

- 执行者：agent-t329（Claude Code，claude-opus-5-5，由 agent-claude-01d717b4 派遣）
- 做了什么：ADR-0006 data 段写清赛事站点记字段状态并说明为什么不压成摘要；第 2 道门的 reconcile 一句补上必需赛事站点的入场核对；后果里加已知限制：香港入口摘要只在两边都有时比较，常规发正式比较对象是预发布清单、没有这一项，实际只有 hotfix 比较，漂移核对看不到；checkCandidate 的注释同步
- 结果：check-docs 通过
- 下一步：复审第 6 条：受限密钥条目改用 restrict 形式

## 12:23:36 +08:00 · 返工 · #329 · 受限密钥条目改用 restrict

- 执行者：agent-t329（Claude Code，claude-opus-5-5，由 agent-claude-01d717b4 派遣）
- 做了什么：install-host.sh 的 DRIFT_OPTIONS 改成 restrict,command="/opt/yzgc/tools/surface-stack.sh forced"；测试的期望条目与「被改宽」用例（去掉 restrict）跟着改；CICD、surface-drift.yml 头注释、329.json 同步
- 结果：install-host.test 先红 2 条（期望条目改成 restrict 形式）后绿 17/17；shellcheck、actionlint 通过
- 下一步：复审第 7 条：surface-stack.sh 临时目录用 trap 清理

## 12:26:16 +08:00 · 返工 · #329 · surface-stack.sh 被打断时也删临时目录

- 执行者：agent-t329（Claude Code，claude-opus-5-5，由 agent-claude-01d717b4 派遣）
- 做了什么：privateDir 登记建出的临时目录，finally 正常删除，exit 事件兜底；INT/TERM/HUP 处理器以 130/143/129 退出触发 exit 事件；脚本 exec 成 node，所以没用 bash trap；KILL 拦不住写在注释与 DEPLOY 里；329.json 同步
- 结果：surface-stack.test 新增 3 条（整组收到 SIGTERM、SIGINT、SIGHUP），先红（目录留下）后绿，文件 13/13；shellcheck 通过；check-doc-sync 通过
- 下一步：复审第 8 条：SurfaceInput 收进 db 与 routes

## 12:27:26 +08:00 · 返工 · #329 · SurfaceInput 收进库与路由

- 执行者：agent-t329（Claude Code，claude-opus-5-5，由 agent-claude-01d717b4 派遣）
- 做了什么：manifest.ts 的 SurfaceInput 加上 db、routes、now，generateSurface 直接用它；演练的输入另起 RehearsalInput（去掉 db、routes、now，加 dbPath、forumContentDir）；routes 为 null 的说明挪到类型注释
- 结果：tsc -p app/server/tsconfig.json --noEmit 通过；tests/server/surface.test.ts 15/15；check-boundaries 通过
- 下一步：复审第 9 条：等 #328 合并后 rebase，P-0014 改成下一个空号

## 12:31:26 +08:00 · 返工 · #329 · 项目目录重新生成

- 执行者：agent-t329（Claude Code，claude-opus-5-5，由 agent-claude-01d717b4 派遣）
- 做了什么：pnpm check 的 check:catalog 报来源摘要过期（invariants.ts、manifest.ts、DEPLOY.md、server 服务文档改过）；pnpm catalog:generate 重新生成，只有来源摘要与四个文件的 sha256 变化
- 结果：check:catalog 通过
- 下一步：等 #328 合并后 rebase，P-0014 改号，再跑 pnpm check

## 13:37:39 +08:00 · 返工 · #329 · rebase 到 #328 合并后的 stage，同构清单条目改号 P-0015

- 执行者：agent-t329（Claude Code，claude-opus-5-5，由 agent-claude-01d717b4 派遣）
- 做了什么：git fetch gitlab 后把 33 个提交 rebase 到 gitlab/stage 77197a63。冲突处理：scripts/parity.mjs 保留 stage 的批准摘要校验，加回 explains 校验；docs/ops/CICD.md 保留 stage 的 pr-agent 行与 PR_AGENT_API_BASE 行，加上 surface-drift 两行；RELEASE-PARITY、CODE-REVIEW、AGENTS、RELEASES 里本单新写的豁免说法改成批准摘要、by 为「所有者」；ledger 保留 #328 的 P-0014，本单条目改号 P-0015，docs/changes/329.json 同步改号（之前记录里写的 P-0014 都指这一条）；项目目录、docs/INDEX.md、notes/INDEX.md 用脚本重新生成。前三个提交的作者邮箱不是 noreply 地址，check-privacy --commits 报出，用 rebase --exec 改成当前配置的 noreply 地址，作者时间不变。#328 把发件地址改成环境密钥后，tests/server/surface.test.ts 遮盖地址的用例改用模板里的 DEPLOY_PROXY_JUMP（user@host）
- 结果：check-privacy --commits gitlab/stage..HEAD 通过；pnpm check 从 check:runtime 到 check:catalog 通过，check:architecture 默认对 origin/stage 比，报 369 个文件失败（基线落后），--base gitlab/stage 通过；check:cli、typecheck 通过；check-doc-sync --base gitlab/stage 通过；actionlint、shellcheck 通过；相关 17 个测试文件第一次 359/360，失败的是上面那个用例，改后 tests/server/surface.test.ts 15/15
- 下一步：最终 HEAD 上重跑门禁与相关测试，交负责人推送与开 MR

## 17:27:05 +08:00 · 收尾 · #329 · 放弃，清理 worktree

- 执行者：agent-claude-01d717b4（Claude Code，claude-opus-5-5）
- 做了什么：node scripts/task.mjs finish 329：删 worktree .claude/worktrees/task-329 与本地分支 task/329/release_reconciliation
- 结果：issue 已关闭，没有 PR（放弃）

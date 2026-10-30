# task/309/env_isolation_parity · crosery · 2026-10-28

负责人：crosery

## 19:17:48 +08:00 · 开工 · #309 · hotfix：预发布与正式环境硬隔离、去硬编码、同构迁移门禁

- 执行者：agent-claude-geek-main-09（Claude Code，claude-sonnet-5-5）
- 做了什么：从 origin/main 228be7bf 拉 task/309/env_isolation_parity 与 .claude/worktrees/task-309（手工建，task.mjs start 只从 stage 拉）；所有者 2026-10-28 19:11 原话已写进 GitLab #309 正文的确认依据；交接文档 .tools/handoff/2026-10-28-hotfix-env-parity/
- 结果：worktree 已建，HEAD=228be7bf；pnpm install 后台进行中
- 下一步：盘点硬编码，写 check-env-isolation、.env.dev、同构清单与烟测，再改规范与提示词

## 19:38:57 +08:00 · 方案 · #309 · 盘点硬编码与同构缺口，定三层防线

- 执行者：agent-claude-geek-main-09（Claude Code，claude-sonnet-5-5）
- 做了什么：git grep origin/main 盘点环境域名 31 个文件；实测正式与预发布 /release.json、CSP、/oidc、内部赛事官网；定方案：① scripts/check-env-isolation.mjs（三份 env 键集一致、值隔离、写死域名登记）② scripts/parity.mjs 同构清单与发版烟测 ③ 两条正式部署工作流加 parity 与 smoke job ④ 规范 RELEASE-PARITY 与提示词同步
- 结果：实测：正式 /oidc 404、预发布 200；两环境 /c/oss-challenge-2026-1/ 均 200 且 md5 相同；正式与预发布 env 模板仅 8 个键不同

## 19:38:57 +08:00 · 开发 · #309 · 检查脚本、清单、烟测、工作流门禁、规范与技能完成

- 执行者：agent-claude-geek-main-09（Claude Code，claude-sonnet-5-5）
- 做了什么：新增 scripts/check-env-isolation.mjs、scripts/parity.mjs、deploy/env/.env.dev、origin-exceptions.json、deploy/parity/{ledger,smoke}.json、tests/tooling/{env-isolation,parity}.test.ts；gitlab-oidc.rb 改读宿主文件；deploy-manual.mjs 读 environments.json；deploy-production/hotfix 加 parity、smoke job；写 RELEASE-PARITY 并同步 AGENTS.md、RELEASES、BRANCHING、CODE-REVIEW、ENVIRONMENTS、CICD、DEPLOY、GITLAB 等；新增 release-parity 技能
- 结果：tests/tooling 新增 31 条通过；actionlint 两条工作流无输出；check-env-isolation 对注入的 prev 域名失败、还原后通过；对线上跑 parity.mjs smoke 正式与预发布均通过，compare 报出正式缺 /oidc；文档核对：docs/services/server/ 不用改——oidc.md 只补了一句签发者读宿主文件，接口和表没变

## 19:42:43 +08:00 · 提交 · #309 · 本地提交 1769ee84

- 执行者：agent-claude-geek-main-09（Claude Code，claude-sonnet-5-5）
- 做了什么：fix(deploy): 三份 env 严格隔离、去掉写死的环境域名并加同构门禁，42 个文件，从 origin/main 228be7bf 起；未推送
- 结果：git log -1 为 1769ee84；工作区只剩 notes 两个文件

## 19:56:11 +08:00 · 方案 · #309 · 所有者补充：[已脱敏]

- 执行者：agent-claude-geek-main-09（Claude Code，claude-sonnet-5-5）
- 做了什么：19:43 所有者原话：[已脱敏]。据此：RELEASE-PARITY 增口径与第九节；烟测去掉内部赛事官网的正文比对，改比公开 JSON 的键和值类型；用 catalog 的 213 条显式路由逐条查页面、CLI、脚本、外部协议的调用方
- 结果：静态搜索 44 条无直接匹配，逐条人工确认：forum-api.ts、competition-sdk、hubPaths 的 what 参数、console 的 base.value 拼接、CLI 的 {origin} 拼接、OIDC 同意页、nginx 反代的 llms.txt 都有调用方；只有 GET /api/console/departments 没有任何调用方，roles.ts 头注释早已写明只剩它和一条单测在读；已退役的旧论坛 410 兜底 28 条不算死接口，未动

## 19:56:11 +08:00 · 提交 · #309 · 本地提交 0c39d3c6

- 执行者：agent-claude-geek-main-09（Claude Code，claude-sonnet-5-5）
- 做了什么：第二次提交：数据只对齐格式（parity.mjs sameShape、smoke.json、规范与技能）并删除 GET /api/console/departments（路由、contracts、ownership 流程、文档，测试改断言 404）；第一次提交 1769ee84 与对齐补证据提交 e8b87dad 不变；均未推送
- 结果：check-architecture --base origin/main 通过（51 个变更文件，36 个关联节点）；compare 对线上只剩 /oidc；tests/server/console.test.ts 15 条通过

## 20:00:41 +08:00 · 审查 · #309 · 作者自审，被审查提交 0c39d3c6

- 执行者：agent-claude-geek-main-09（Claude Code，claude-sonnet-5-5）
- 做了什么：按 CODE-REVIEW 逐项对照 origin/main...HEAD（51 个文件）：新增行里没有任何环境域名（git diff 过滤为空）；env 三份键集一致由 check:env-isolation 核对；sameShape 记录内部只比同名字段类型；删除的 GET /api/console/departments 在 catalog 213 条显式路由中是唯一没有调用方的，44 条静态搜不到的逐条人工确认；同构清单 7 条 pending 会拦住 deploy-hotfix 与 deploy-production，包括本次 hotfix 自己
- 结果：结论：有条件通过。条件：1 这是作者本人自审，进 main 前需要另一位审查人或所有者复核；2 parity 与 smoke 两个 job 没有在真实 GitHub Actions 上跑过，只有 actionlint 和结构测试；3 P-0003..P-0009 需所有者授权在正式环境做完或逐条豁免，否则 hotfix 部署被自己的门禁拦住；4 没有正式访问日志，无法证明 departments 接口在页面之外没有外部调用。验证：tests/server 与 tests/tooling 118 个文件 2187 passed、27 skipped；typecheck 通过；check-architecture、check:catalog、docs-index、doc-sync（对 origin/main）、check:notes、check:secrets 通过

## 20:12:11 +08:00 · 开发 · #309 · 同构清单 P-0004 按实测标 done，并核对线上 GitLab、CDN、内部赛事

- 执行者：agent-claude-geek-main-09（Claude Code，claude-sonnet-5-5）
- 做了什么：P-0004：gh secret list --env production 有 GOOGLE_CLIENT_ID/SECRET（07:23Z 创建），线上 /auth/providers 列出 google，/auth/google 302 到 Google。线上只读实测：git.yangtzeu.work 30 次请求 30 次 200；GitLab 单点登录 POST 后 302 到 prev.yangtzeu.work/oidc/auth（正式跳预发布的根因）；cdn.yangtzeu.work 直连 103.240.197.216 30 次里 18 次超时；内部赛事 /api/public/competitions/oss-challenge-2026-1 的 7 个接口两边都是 200 且格式一致
- 结果：pending 由 7 条降为 6 条（P-0003、P-0005..P-0009）；正式 /api/public/gitlab/projects 返回 unavailable:true，两边 stats.updated_at 都是 0；deploy/remote/garage-archive.mjs 的备份端点写死 cdn.yangtzeu.work，而该域名当前解析到不稳定的直连 IP

## 20:12:25 +08:00 · PR · #309 · GitLab MR !51 到 main

- 执行者：agent-claude-geek-main-09（Claude Code，claude-sonnet-5-5）
- 做了什么：所有者 20:02 同意[已脱敏]；分支推到 gitlab 并用 push option 开了 MR !51（目标 main，描述含 Closes #309）；没有合并，没有触发任何流水线
- 结果：MR 地址 https://git.yangtzeu.work/geek/admin/-/merge_requests/51；完整 PR 正文草稿在 .tools/handoff/2026-10-28-hotfix-env-parity/PR-BODY.md，GitLab 没有 API 凭据，描述只写了一行，待所有者在网页补全

## 21:04:51 +08:00 · 开发 · #309 · 宿主层与一次性运维改走流水线，补 CDN 镜像、sub 迁移、同构清单 post_deploy 阶段

- 执行者：agent-claude-geek-main-09（Claude Code，claude-sonnet-5-5）
- 做了什么：20:49 所有者原话：[已脱敏]。据此：新增 deploy/remote/install-host.sh（plan/apply/verify）并接进 deploy-preview/production/hotfix 三条工作流；新增 deploy/gitlab/cutover.sh 与手动触发的 gitlab-cutover.yml；CDN 镜像 cdn-mirror.sh 与 systemd 单元进仓库；migrate-oidc-subjects.mjs；parity.mjs 增 phase 与 check --complete；规范写进 RELEASE-PARITY 第十节与 AGENTS.md
- 结果：新增测试 install-host 10、gitlab-cutover 10、cdn-mirror 14、oidc-subject-migration 8、parity 22 全部通过；actionlint 通过；首次镜像同步 geek-public 436 个 css/js 被存成 gzip（rclone 带 Accept-Encoding: gzip 下载），逐对象核验 sizes differ 查出，关掉后 MD5 与 ETag 一致，五个桶 verified；已用 install-host.sh 在 Arch 上 plan/apply/verify 一遍（八项 same），定时器已启用。此前 20:00–20:45 为取证和先行落地手工用了 ssh：装 systemd 单元与镜像脚本、docker exec 登记 gitlab 客户端、在 Garage 上建 backup-reader 只读密钥，这些现在都有对应的仓库路径，客户端登记与密钥生成属于一次性凭据引导，已按规范写明
- 下一步：合并前复跑全量检查；MR 描述补全；所有者批准后合并、同步 GitHub、派发 deploy-hotfix

## 21:09:55 +08:00 · 提交 · #309 · 本地提交 86388a3a：宿主层与 GitLab 改接走流水线

- 执行者：agent-claude-geek-main-09（Claude Code，claude-sonnet-5-5）
- 做了什么：第三次提交：install-host.sh、cdn-mirror.sh 与 systemd 单元、cutover.sh 与 gitlab-cutover.yml、migrate-oidc-subjects.mjs、parity post_deploy 阶段、规范与测试；此前提交 1769ee84..1dd1eb72 已在 MR !51
- 结果：pnpm check 各项（含 check-architecture --base origin/main、doc-sync、notes、secrets、catalog）通过，typecheck 无输出，vitest 182 个文件 2925 条通过 27 跳过；未推送

## 21:51:26 +08:00 · 审查 · #309 · 独立评审子 agent 对宿主层与闸门的审查，被审查提交 e4ce8592

- 执行者：agent-claude-geek-main-09（Claude Code，claude-sonnet-5-5）
- 做了什么：派一个不带结论的只读评审 agent 审 install-host.sh、cutover.sh、迁移脚本、cdn-mirror.sh、三条工作流的宿主层步骤、parity 闸门；我逐条读代码复核后采纳：二次 switch-issuer 后 rollback 还原错的 secret、cdn-mirror 二次核验失败静默中断、export 输出被 64KB 管道截断、switch 不检查 sub 是否已迁、冲突退出不清理、凭据校验在写文件之后、sha256 失败当 same、post_deploy 条目无人拦且拼错参数退出 0、preview 与 production 共用同一个宿主目录。未采纳：host 步骤失败跳过 smoke（hotfix/deploy-doc-sync 测试禁止 job 级 always()，不放宽校验，改为文档写明补验命令）
- 结果：前三项在旧代码上先红后绿（cdn-mirror 二次核验、export 截断 65536 字节、rollback 备份）；tests/tooling 63 个文件 1254 条通过，typecheck、docs、catalog、env-isolation、secrets、doc-sync、architecture（--base origin/main）通过
- 下一步：合并 MR !51、同步 GitHub main，等所有者批准派发 deploy-hotfix

## 21:51:26 +08:00 · 提交 · #309 · 本地提交 650c3c5c：评审问题修复

- 执行者：agent-claude-geek-main-09（Claude Code，claude-sonnet-5-5）
- 做了什么：cutover.sh、cdn-mirror.sh、migrate-oidc-subjects.mjs、install-host.sh、parity.mjs、三条部署工作流、规范与测试；ledger 的 post_deploy 条目补 release=0.1.1。文档核对：docs/ops/GITLAB.md、docs/conventions/RELEASE-PARITY.md、docs/ops/CICD.md、docs/conventions/RELEASES.md、.agents/skills/release-parity/SKILL.md 已随行为更新
- 结果：同审查条目；未推送

## 22:32:52 +08:00 · 开发 · #309 · 所有者 22:3x 两条指示：[已脱敏]

- 执行者：agent-claude-geek-main-09（Claude Code，claude-sonnet-5-5）
- 做了什么：所有者原话：「[已脱敏]」；「[已脱敏]」。据此：同构清单 P-0008（cdn 的 A 记录改到香港边缘）按这句原话 waive，不做任何 DNS 改动；#305 文档里改指边缘的段落（docs/ops/STORAGE-CDN.md:39-41、DEPLOY.md:235）与所有者意思冲突，本次未改；hotfix 窗口登记、门禁与 hotfix-sync 已提交 bba6f95b，独立评审进行中；部署派发与生产环境审批按所有者的授权由我执行
- 结果：parity.mjs check --release --version 0.1.1 退出 0，剩 P-0007、P-0009、P-0011 三条随本版本部署后处理；文档核对：docs/ops/STORAGE-CDN.md、docs/ops/DEPLOY.md 的 cdn 改指边缘段落不是本次改动，不改
- 下一步：评审通过后合并 MR !52、推 main、hotfix-sync、派发 deploy-hotfix

## 22:43:34 +08:00 · 返工 · #309 · 补齐文档核对：两条 doc-sync 报错来自 main 基线，不是本分支

- 执行者：agent-omp-geek-main-26（omp，deepseek-v4.1-flash）
- 做了什么：pnpm check 的 check:doc-sync 以 origin/stage(331c0b5) 为 base，把 main 侧 228be7bf「增加 main 同版本 hotfix 并保持 0.1.1」里 app/web/package.json、app/console/package.json 的版本号 0.1.2→0.1.1 算进本次改动；本分支没有改这两个服务的行为、接口或表。文档核对：docs/services/web/ 不用改——只随 main 基线把版本号回落 0.1.1，页面、接口与构建方式未变。文档核对：docs/services/console/ 不用改——同上，只随 main 基线回落版本号，控制台接口与使用方式未变。
- 结果：notes 已追加并重新生成 INDEX；改的是记录，不动检查脚本
- 下一步：重跑 pnpm check 看是否只剩预期项

## 22:44:21 +08:00 · 返工 · #309 · 文档核对按「；」分行重记，上一条两条挤在一行第二行没被识别

- 执行者：agent-omp-geek-main-26（omp，deepseek-v4.1-flash）
- 做了什么：check:doc-sync 的 WAIVER_RE 用「；」分隔同一条记录里的多条文档核对；上一条把两条写在同一句里、中间是句号，第二条例被吞进第一条例的理由，所以 console 仍报红。本分支相对 origin/stage 只多出 main 基线 228be7bf 的版本号回落（0.1.2→0.1.1），没有改两个服务的页面、接口、表或构建方式。文档核对：docs/services/web/ 不用改——只随 main 基线把版本号回落 0.1.1；文档核对：docs/services/console/ 不用改——只随 main 基线把版本号回落 0.1.1，控制台接口与使用方式未变
- 结果：这一条按规范用「；」分隔，重跑 check:doc-sync 应通过
- 下一步：重跑 pnpm check

## 22:54:32 +08:00 · 返工 · #309 · 接手 omp 会话：清单清零后 parity 测试反向失败、宏观对齐的默认基线不认识 hotfix

- 执行者：agent-omp-geek-main-26（omp，deepseek-v4.1-flash）
- 做了什么：uniflo 交接 claude:e05007e2（22:32 因 429 中断）后复跑门禁：1) tests/tooling/parity.test.ts 断言仓库清单拦 v0.1.1，清单按规范清零后必失败（独立评审第 3 项预测过），改为在临时根目录拷 scripts/parity.mjs 跑命令行，断言参数错误 2、拦住 1、清零后 0、--complete 1；删掉只断言仓库当前 pending>0 的用例。2) check-architecture 默认 --base origin/stage 把 main 自己的提交算进 hotfix 分支，加 hotfixBase()：该 task 的 issue 在窗口登记里开着（读 origin/main，本地未合入时读 HEAD）才把默认基线改成 origin/main，并补 5 条单测
- 结果：pnpm check 退出 0（含 check:architecture 默认基线自动改用 origin/main、27 个变更文件）；tests/tooling/parity.test.ts 23 条、architecture-alignment.test.ts 23 条通过；文档核对：docs/conventions/ARCHITECTURE-ALIGNMENT.md 不用改——只改默认基线来源，八维检查项与结论格式未变
- 下一步：全量 vitest 完成后提交、推送、开 MR !52

## 23:12:23 +08:00 · 返工 · #309 · 独立审查发现 hotfix-sync 在镜像 stage 分叉时会半应用

- 执行者：agent-omp-geek-main-27（omp，k3.1-pro）
- 做了什么：审查 origin/main...9c9842cb：planSync 只在 needMerge=false 时预检 mirror/stage；needMerge=true 时 applySync 会先推 mirror/main 与 source/stage，再发现 mirror/stage 不能快进。新增临时双裸仓回归，旧实现 1 failed，证实 gitlab/stage 与 origin/main 已改变；planSync 增加 needMerge 分支的镜像 stage 祖先预检，在任何推送前 code=2 停止。文档核对：docs/conventions/BRANCHING.md 不用改——原有任何一步不满足就停下、不强推、不覆盖的契约不变，本次让实现符合契约
- 结果：npx vitest run tests/tooling/hotfix-sync.test.ts：12 passed；新增用例修复前 1 failed、修复后通过
- 下一步：跑 pnpm check，提交并更新 MR !52 的审查结论后合并

## 23:23:23 +08:00 · 方案 · #309 · 接手 01a18305 的未完成 P0 hotfix

- 执行者：agent-omp-geek-main-handoff（omp，gpt-6.1-sol）
- 做了什么：通过 Uniflo 读取目标会话、上游 01a182ee 与原始 Claude e05007e2 的所有者授权：[已脱敏]。保留上一会话未提交的 mirror stage 分叉预检修复及回归。只读 ls-remote 核对双仓 main=604df9eb、stage=331c0b5a；GitLab task=9c9842cb，GitHub task=078eda0a。
- 结果：历史证据：hotfix-sync 12 passed、pnpm check 退出 0，未重复全量测试。现行 GitLab CLI 未认证，凭据执行工具错误且浏览器 relay 不可用，改用现有受控 CLI 排查认证；没有修改部署、DNS、业务数据或发布 tag。

## 23:30:11 +08:00 · 返工 · #309 · 修复同步收尾夹带未发布功能、跳过钩子及删除固定分支

- 执行者：agent-omp-geek-main-handoff（omp，gpt-6.1-sol）
- 做了什么：applySync 改为在唯一命名临时 task 分支中完成全部本地准备后才推送；移除 core.hooksPath=/dev/null；不删除已存在 task/issue/hotfix_sync；关闭窗口从 main 独立提交再合回 stage，不把 stage 功能合进 main。补分支保留、钩子拒绝、非生成物冲突全部引用不变和 stage 功能隔离的行为回归；删去源码字符串与文件存在性两项 incidental 测试，不放宽生产门禁。BRANCHING 与 309 影响声明同步。
- 结果：定向 Vitest：12 passed。真实 CLI 双裸仓对照：baseline stage-only-in-main=true；fixed false，两个远端一致、stage>=main、窗口 closed，第二次 apply 不变。生产只读 smoke 通过，但 release.json 仍为 228be7bf，OIDC discovery 404，尚未上线。

## 23:38:07 +08:00 · 提交 · #309 · 同步安全修复验证完成，准备提交 MR !52

- 执行者：agent-omp-geek-main-handoff（omp，gpt-6.1-sol）
- 做了什么：pnpm verify 已跑完核心 check/test/build（2955 passed、27 skipped），在 forum:check 因本 worktree 未配置 pnpm11 路径退出；按 TUFF-FORUM 设置 FORUM_NODE=/opt/homebrew/bin/node 与 FORUM_PNPM 指向主工作区既有 pnpm11，只续跑 forum:check && forum:generate。GitHub stage 的 enforce_admins、必需 PR 和三项检查已实查，不能直推；采用已存在 GitHub #284 的独立 worktree/task PR，同步时不混用 GitLab #309。
- 结果：核心门禁/构建通过；论坛 typecheck、tests typecheck、lint、styles、test 和 61 路由静态生成通过。单命令 pnpm verify 初次因工具路径退出 1，不冒称该次退出 0；其全部剩余阶段随后退出 0。同步 CLI 对照与定向 12 条回归通过，无 DNS、tag、线上库变更。

## 23:38:54 +08:00 · 审查 · #309 · MR !52 同步安全审查，有条件通过

- 执行者：agent-omp-geek-main-handoff（omp，gpt-6.1-sol）
- 做了什么：人工逐项复核 0d5a3d9（origin/main...HEAD）：保留 P0 同版本例外、不新建/移动 tag、不改 CDN DNS；无密钥或数据变更；同步分叉、冲突、既有分支、钩子、关闭窗口不夹带 stage 功能均由真实行为覆盖。reviewer 子代理因模型 429 不可用，本条是本执行者实际审查，不伪称独立代理成功。审查结论与完整十段正文写入 MR !52。
- 结果：有条件通过：已完成 core 2955 passed/27 skipped、forum 701 passed 和静态生成、CLI 对照；条件为 GitHub 受保护 stage 通过现有 #284 的 task PR 同步、真实 hotfix 工作流通过并由所有者完成 production 平台审批。GitLab 自动流水线仍默认关闭，未伪造运行或验收。

## 23:42:05 +08:00 · 合并 · #309 · MR !52 合并，GitLab stage 已包含修复，GitHub main 已同步

- 执行者：agent-omp-geek-main-handoff（omp，gpt-6.1-sol）
- 做了什么：GitLab API 以 sha=930e9bb47869aa751d59f1d79361dd5dcbabbec6 合并 !52，merge_commit=86e504ac2fb5f542d7ad95f0290a80a0af2a24b8；没有删除来源分支、没有关闭 #309。hotfix-sync apply --source gitlab --mirror gitlab --issue 309 把 GitLab stage 推到 1f969194827c。GitHub main 使用新窗口门禁正常推送 86e504ac，无 --no-verify 或保护更改；GitHub stage 正通过既有 #284 的独立 task PR 同步。
- 结果：GitLab stage>=main；GitHub main 已为 86e504ac，stage 尚等 #284 PR 必需检查。此前在旧 #284 检出上直接推 main 被旧钩子拒绝，没有绕过；合入已审查的新门禁后从 #309 正常通过。尚未派发生产部署。

## 23:53:29 +08:00 · 发布 · #309 · 已派发生产同版本 hotfix，保留平台审批

- 执行者：agent-omp-geek-main-handoff（omp，gpt-6.1-sol）
- 做了什么：gh workflow run deploy-hotfix.yml --ref main，tag=v0.1.1、commit=86e504ac2fb5f542d7ad95f0290a80a0af2a24b8、issue=309；运行40719126473。plan与parity已成功，core/forum继续运行；不新建版本或rc，不改DNS，不代替production审查人。GitHub #285已建立受保护stage同步PR，来源head0256307，architecture与pr-contract已成功，完整CI仍在运行。
- 结果：没有生产部署成功证据，仍待真实workflow与审批；P-0007、P-0009、P-0011保持pending，窗口open。PR自动合并功能仓库未开启，未修改设置，改为等待两个完整CI成功后执行正常merge（不使用admin绕过）。

## 23:55:53 +08:00 · 验收 · #309 · 部署前正式站只读浏览器基线

- 执行者：agent-omp-geek-main-handoff（omp，gpt-6.1-sol）
- 做了什么：用独立 headless Chromium 访问真实正式站，启动YUGC OS并双击宣传片；读取真实video为readyState=4、paused=false、currentTime=17.379495、duration=105、error=null，截图记录播放器窗口；另打开/c/oss-challenge-2026-1/，页面标题为OSS CHALLENGE，含第一届内部赛、规则与进行中标识。两张托管tab已关闭，没有登录、报名、发帖、改数据或批准OAuth。
- 结果：这是仍在运行的228be7bf的部署前基线，不是86e504ac上线验收；HLS主清单真实读取为application/vnd.apple.mpegurl、五档H264，播放器确实播放。截图：omp-sshots-15b81b80c0fe8b55.png（播放器）、15b81b9561aa9fee.png（赛事初始画面）；赛事天梯当时还在读取，未将其记为最终数据加载通过。

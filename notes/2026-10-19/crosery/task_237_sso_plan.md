# task/237/sso_plan · crosery · 2026-10-19

负责人：crosery

## 00:47:42 +08:00 · 开工 · #237 · 接手统一登录的业务契约与后续授权方案

- 执行者：agent-codex-geek-followup（Codex，PR 持续跟进）
- 做了什么：读取 #237 和 #242 当前正文、追踪记录、ADR 与认证实现；核对干净 worktree 的 head b358adcc；按所有者本轮宏观业务颗粒度要求审查数据库、接口与三端表现的对应关系
- 结果：PR 当前只交付方案，内部身份与对外 OAuth/OIDC 尚未实现；需要补全业务级交付、主体稳定性与迁移规则；本轮推送现有 PR，不合并、不建新 issue
- 下一步：按统一账号登录、渠道管理、应用授权三项业务能力补全跨层契约与验收矩阵

## 01:27:12 +08:00 · 返工 · #237 · 统一登录方案按三项完整业务交付对齐

- 执行者：agent-codex-geek-followup（Codex，PR 持续跟进）
- 做了什么：将数据库地基与切读步骤归入统一账号登录业务；补渠道管理、对外 OIDC 的数据/API/UI 验收表；禁止邮箱自动合并，保留最后一个 GitHub 资格核验身份；持久化 sector-sub 映射并阻止已对外授权账号自动合并；区分既有 sid 与尚未实施的 SSO 方案
- 结果：OpenID Connect Core 与 RFC 9700 官方正文已核对；pnpm verify 在 Node 22.23.2/pnpm 9.15.9 与独立 Node 26/pnpm 11.24.0 下退出 0：核心 73 文件 1079 条、论坛 30 文件 548 条，三端构建与 61 路由静态生成通过；本次不改 app，不建新 issue，不合并

## 01:27:13 +08:00 · 提交 · #237 · 提交统一登录与应用授权的业务合同

- 执行者：agent-codex-geek-followup（Codex，PR 持续跟进）
- 做了什么：提交 ADR-0005 与本轮执行记录，Refs #237
- 结果：完整 pnpm verify 通过；方案仍为 proposed，真实 OAuth 与内部身份迁移未实施，不能当作运行验收

## 01:45:05 +08:00 · 推送 · #237 · 已将 SSO 业务合同提交推送到原 PR 分支

- 执行者：agent-codex-geek-followup（Codex，PR 持续跟进）
- 做了什么：git push 原 fork 的 task/237/sso_plan，未 force push
- 结果：98fed0d8946e527aa51192a4c6f84501f41691d3 已到 PR #242；随后发现上游 stage 已推进至 1293f892，PR mergeStateStatus=DIRTY，需要同步新项目目录门禁

## 01:45:05 +08:00 · 方案 · #237 · 同步 stage 的架构目录与宏观对齐门禁

- 执行者：agent-codex-geek-followup（Codex，PR 持续跟进）
- 做了什么：完整补读当前 stage 的九份规范及 ARCHITECTURE-ALIGNMENT、项目地图检索入口和身份流程；计划只同步基线到 PR 分支并补 docs/changes/237.json
- 结果：确认新门禁要求每个 PR 的八维影响声明与十段正文；不将 proposed 的身份表和 OAuth 接口登记为当前运行实体，不将 PR 合入 stage

## 02:24:18 +08:00 · 开发 · #237 · 统一登录方案完成新目录门禁适配

- 执行者：agent-codex-geek-followup（Codex，PR 持续跟进）
- 做了什么：以 c5ed145 同步 stage 1293f892，文档和执行记录索引冲突均通过生成器解决；新增 docs/changes/237.json，关联现有 identity/organization/audit/platform 及四条身份流程；未来身份表和授权端点不登记为当前实体
- 结果：最新基线 pnpm verify 退出0：79文件1229条核心测试、30文件548条论坛测试、构建与61路由生成通过；check:architecture通过12个变更文件、7个关联节点，check:catalog通过

## 02:24:18 +08:00 · 提交 · #237 · 提交 SSO 宏观影响声明

- 执行者：agent-codex-geek-followup（Codex，PR 持续跟进）
- 做了什么：提交方案八维影响声明与基线同步后的真实验证记录
- 结果：声明只描述方案与导航变化；运行时接口、权限、数据和交付保持，不合并PR；当前提交CI与所有者方案验收仍待完成

## 02:53:37 +08:00 · 审查 · #237 · 两轴复查与 step-up 状态合同修正

- 执行者：agent-codex-geek-followup（Codex，PR 持续跟进）
- 做了什么：Standards 复核 c5ed145 与 237.json 通过；Spec 复核 b358adcc..98fed0d 确认原两项缺口修复，并指出 step-up 过期回401会触发控制台全站退出。已改为403 step_up_required，仅主会话失效用401，并补该场景验收条件
- 结果：主代理对照 app/console/src/lib/http.ts 的401处理核对；文档未改运行实现；修订后 pnpm verify 再次退出0，核心1229、论坛548、构建与61路由生成通过

## 02:53:37 +08:00 · 提交 · #237 · 明确重认证过期不等于主会话退出

- 执行者：agent-codex-geek-followup（Codex，PR 持续跟进）
- 做了什么：提交 ADR 的403/401语义与独立审查复核记录
- 结果：没有未决设计审查条目；最新提交的GitHub检查与所有者方案确认仍待完成，PR保持不合并

## 03:34:10 +08:00 · 审查 · #237 · 完成 SSO 方案最终两轴复核

- 执行者：agent-codex-geek-followup（Codex，PR 持续跟进）
- 做了什么：Standards核对宏观声明与目录通过；Spec对0b53371复核通过，确认403 step_up_required、最后一个GitHub身份和稳定sub映射均闭合；主代理逐项复查本PR未改应用代码和真实数据
- 结果：真实剩余审查问题0项；0b53371的verify、architecture-alignment和e2e均已成功，pr-contract仅因先前审查占位结论阻塞；完成最终记录后在对应head核对检查并更新结论，PR仍不合并

## 03:34:10 +08:00 · PR · #237 · 已更新 SSO PR 正文与跟进边界

- 执行者：agent-codex-geek-followup（Codex，PR 持续跟进）
- 做了什么：将PR #242正文整理为十段，引用237.json、三项业务交付与真实验证；已推送98fed0d、277724b、0b53371等提交；创建本chat每30分钟的PR跟进提醒pr-242-243
- 结果：PR OPEN、autoMergeRequest=null；无变化安静，后续只在有具体缺陷或人工反馈时返工并推原分支，不合并、不发布、不自动建单

## 05:02:41 +08:00 · PR · #237 · 核对并发布 SSO 最终审查结果

- 执行者：agent-codex-geek-followup（Codex，PR 持续跟进）
- 做了什么：更新PR #242为技术审查通过，发布review与issue进展记录；核对e02da73的verify、architecture-alignment、pr-contract、e2e和Netlify均成功
- 结果：PR保持OPEN，mergedAt为空且autoMergeRequest为空；方案仍proposed等所有者确认；相应外部操作记录暂存，随后续相关推进入库

## 05:06:48 +08:00 · 提交 · #237 · 归档最后的PR跟进记录

- 执行者：agent-codex-geek-followup（Codex，PR 持续跟进）
- 做了什么：仅提交已发生的对外跟进记录，不修改业务源码、测试或方案
- 结果：业务与方案代码保持e02da73；当前记录格式已核对，提交后继续由现有跟进核对最新head检查，不合并

## 05:13:04 +08:00 · 推送 · #237 · 最终记录提交已推送，继续等待同head检查

- 执行者：agent-codex-geek-followup（Codex，PR 持续跟进）
- 做了什么：已将c3d7722dd2c879de1bc73c7e2cf6829d9ed681ea快进推送至原PR来源分支；只追加最终跟进记录，未改业务源码
- 结果：pre-push与worktree生命周期通过；保持PR开放且无自动合并。最后对外操作记录按规范放暂存区，随下次实质推进归档，不为记录本次推送循环触发新CI。

## 05:27:10 +08:00 · 方案 · #237 · 补齐未关闭的 SSO 资格与文档状态审查意见

- 执行者：agent-codex-geek-followup（Codex，PR 持续跟进）
- 做了什么：实时核对PR #242的c3d7722、4条审查讨论及现行SECURITY和getOwnMembership；确认索引把proposed列为已接受、组织快照时效与新登录撤销未定义。计划只修订ADR和相应文档导航、影响声明，不修改runtime。
- 结果：PR #242仍OPEN；此前0未决审查记录遗漏这两项，将追加更正。已按工具归档本task的暂存推送记录，保留其他task和验收实例。

## 10:20:04 +08:00 · 返工 · #237 · 接手补齐 CodeRabbit 未决意见：方案状态与第二渠道资格时效

- 执行者：agent-notion-geek-handoff（Notion AI，接手 Codex PR 跟进）
- 做了什么：接手Codex 05:27未提交修订并逐项核对源码事实：ADR、索引与目录说明区分proposed；决策6定第二渠道新登录实时核验active、已有会话最多复用60秒资格结果、7天加密资格凭据清理、403/503/401分流及撤销版本检查；补齐决策7与影响声明的membership_state；DOCUMENTATION.md属目录来源，按catalog:generate重建来源摘要并纳入237.json覆盖
- 结果：pnpm verify退出0（148秒；核心79文件1229条、论坛30文件548条、61路由生成）；check:architecture 20文件7节点、check:catalog、check-docs 282份通过。未改运行代码，ADR仍为proposed等所有者确认
- 下一步：推送task/237/sso_plan后核对同head CI与Netlify，回复三条CodeRabbit讨论；不合并

## 10:55:30 +08:00 · 提交 · #237 · 明确 ADR-0005 待确认状态并补齐第二渠道资格时效与撤销边界

- 执行者：agent-notion-geek-handoff（Notion AI，接手 Codex PR 跟进）
- 做了什么：提交10:20返工的文档修订：ADR-0005摘要、决策索引与目录说明标明proposed待确认；决策6定第二渠道新登录实时核验active、已有会话最多复用60秒资格结果、7天加密资格凭据清理、403/503/401分流与撤销版本检查；决策7补membership_state；按catalog:generate重建来源摘要，237.json补覆盖路径
- 结果：追加本记录前Node 22.23.2下pnpm check退出0（19秒；282份文档、84条执行链路、目录来源摘要4aec8c31、#237宏观对齐20文件7节点），10:17的pnpm verify已覆盖全部文档改动；未改运行代码与测试，ADR保持proposed等所有者确认
- 下一步：推送原PR来源分支后核对同head的CI与Netlify，逐条回复三条CodeRabbit讨论；不合并

## 11:15:56 +08:00 · 推送 · #237 · 推送 ADR-0005 待确认状态与资格时效撤销边界返工

- 执行者：agent-notion-geek-handoff（Notion AI，接手 Codex PR 跟进）
- 做了什么：在task-237 worktree核对分支task/237/sso_plan、工作区干净、远端仍为c3d7722d且86ba1d5c可快进后，执行git push git@github.com:ZZDR1023/admin-geek.git HEAD:refs/heads/task/237/sso_plan（未force），把86ba1d5cb2d7158cf805ade814f2059593828351推到原PR来源分支
- 结果：pre-push分支与发布tag规则、task worktree生命周期检查通过；远端c3d7722d..86ba1d5c快进成功，PR #242 head已为86ba1d5c，仍OPEN、MERGEABLE且无自动合并，同head CI已开始重跑。本条按规范暂存在主工作区.claude/notes-pending，不为记录推送再触发CI
- 下一步：等core与e2e跑完确认同head检查全部变绿；逐条回复三条CodeRabbit讨论，留给所有者或机器人确认；ADR-0005保持proposed，等所有者在#237或本PR留确认记录；不合并

## 11:45:55 +08:00 · PR · #237 · PR #242同head检查全绿，留下CodeRabbit三条意见的返工记录

- 执行者：agent-notion-geek-handoff（Notion AI，接手 Codex PR 跟进）
- 做了什么：复核PR #242 head 86ba1d5c的同head检查：CI run 39193392459（core、forum、docker、docker-cdn、env-contract、branch-guard、lint-workflows、verify）、architecture-alignment 39193392451、pr-contract 39193392449、e2e 39193392455（job 117870830387）与Netlify预览；用GraphQL查reviewThreads；按TRACKING §3在PR #242发kind=rework stage=review评论，汇总三条CodeRabbit意见的改法与证据（issuecomment-6259181983）
- 结果：同head 14项检查全部pass，e2e 43 passed (12.0m)；4条审查讨论均已由coderabbitai[bot]标为resolved，推送后无新review或人工意见，CodeRabbit自动审查处于暂停；PR仍OPEN、MERGEABLE、无自动合并。正文审查结论的被审commit仍为e02da730，本次未改正文
- 下一步：所有者阅读ADR-0005后在#237或本PR留确认或修改意见，有确认记录后再改accepted；是否在86ba1d5c上重新派Standards/Spec审查并刷新正文由所有者决定；不合并

## 12:05:18 +08:00 · 审查 · #237 · PR #242 在 86ba1d5c 增量复核通过并刷新正文审查结论

- 执行者：agent-notion-geek-handoff（Notion AI，接手 Codex PR 跟进）
- 做了什么：按 code-review 对 e02da730..86ba1d5c 增量复核（c3d7722d 仅执行记录，86ba1d5c 改 12 个文档与生成文件）：逐段读 ADR-0005 diff，核对决策 6 与源码（auth.ts:27 SESSION_TTL_MS 7 天、crypto.ts:5 AES-256-GCM、github.ts:41 memberships、access.ts:13 ORG_ROLE_TTL_MS 60 秒、routes/admin/auth.ts 现有错误语义）；复跑 note check --for-review、check-doc-sync、docs-index --check、check-docs 与分支不变量；本地 pr-contract 校验新正文后 gh pr edit 刷新 #242 的验证段与审查结论
- 结果：结论：通过，另记 2 条建议（ADR 第 98 行 membership_state 补“第二渠道交付时”；第 46 行补回 lib/access.ts、require-org-role.ts、/auth/me 落点，留实现 issue）；84 条链路、6 组文档同步、282 份文档通过；12:04 改正文后 Issue lifecycle 39197642282（含 pr-contract）与 Architecture alignment 39197642291 均 success。返工与复核同一执行身份，非独立审查；ADR 仍 proposed，未合并
- 下一步：等所有者在 #237 或本 PR 确认 ADR-0005 后再改 accepted；本条随下次实质推送归档进分支；不合并

## 13:53:41 +08:00 · 方案 · #237 · 补充GitHub、Google与邮箱验证码登录方式和绑定规则

- 执行者：agent-notion-geek-handoff（Notion AI，接手 Codex PR 跟进）
- 做了什么：按所有者2026-10-19「[已脱敏]」修订ADR-0005：摘要与决策5改为三种登录方式绑定同一账号、建号仍需GitHub组织成员；决策6增加只读GitHub App资格来源（待确认）；登录页标题与渲染、接口表加Google与邮箱入口；新增「登录方式」一节（可行性表、绑定规则、Google与邮箱验证码流程、资格来源A/B、所有者准备项、验证、3条待确认）；交付清单与参考资料同步（Google OIDC、品牌验证、GitHub成员接口与organization事件，2026-10-19核对）
- 结果：docs:index、check:docs、check:architecture通过；凭据库没有Google凭据，crosery-ct收码邮箱可用于邮件实测；只改文档，方案保持proposed，未合并
- 下一步：等同head检查；所有者确认建号范围、资格来源与OIDC时机后再建实现issue

## 14:33:06 +08:00 · 提交 · #237 · 采纳 CodeRabbit 对登录方式的两条意见

- 执行者：agent-notion-geek-handoff（Notion AI，接手 Codex PR 跟进）
- 做了什么：CodeRabbit 对 74ca08ad 的增量审查（review 5567606684）提出 2 条意见，按 Google 帮助文档（Manage App Audience、Unverified apps、OAuth App Verification Help Center，2026-10-19 核对）与 ADR 现文核实均成立：① Google 行把「品牌验证前最多 100 名用户并显示未验证提示」写成通用限制，实际只请求 openid email profile 时 Testing 状态也不用登记测试用户、无提示、授权不会 7 天过期，100 名上限只在加其他 scope 或敏感/受限 scope 未验证时出现，品牌验证只管同意屏幕显示名称和 Logo，改写 Google 行、所有者准备项与参考资料；② 邮箱验证码第 4 步同步发信且两路失败回 503，与第 1 步「不论是否绑定都回同样的 202」矛盾，会按状态码与耗时泄露邮箱是否绑定，改为回 202 后由进程内即时队列异步投递、失败只记日志，并在本地验证里加「已绑定/未绑定 × 投递成功/失败」四种组合。顺带采纳审查建议 1：/auth/me 行注明 membership_state 第二渠道交付时再加，与决策 7 一致
- 结果：本地 pnpm check 全部通过；只改 ADR-0005，ADR 保持 proposed，未合并
- 下一步：推送后在两条审查意见下回复处理结果，等同 head CI 全绿再更新 PR 正文复核结论；不合并

## 17:23:19 +08:00 · 审查 · #237 · 补记：PR #242 在 b44bcb2d 增量复核通过并刷新正文审查结论

- 执行者：agent-notion-geek-handoff（Notion AI，接手 Codex PR 跟进）
- 做了什么：复核 b44bcb2d 相对 74ca08ad 的增量：Google 发布状态与验证限制按官方文档改正；邮箱验证码改为响应后异步投递，已绑定与未绑定的响应一致；/auth/me 的 membership_state 注明第二渠道交付时再加。15:01 刷新了 #242 正文的审查结论与 head（当时没有写记录，本条为补记）
- 结果：增量复核通过；head b44bcb2d671d2bd8cc8b1c548f5eabfad5f3e2b8 的 CI 与 e2e 全部通过，PR 可合并（clean，base stage），按所有者要求[已脱敏]
- 下一步：按所有者 2026-10-19 的要求[已脱敏]

## 17:23:19 +08:00 · 提交 · #237 · 补充统一登录实施规格与登录方案草图

- 执行者：agent-notion-geek-handoff（Notion AI，接手 Codex PR 跟进）
- 做了什么：新增 docs/plan/UNIFIED-LOGIN.md（proposed）：一人一个极客班 OpenID，GitHub、邮箱验证码、Google 都绑定在它名下，整个服务共用一套登录与 sid 会话；写明现状、交付总览、6 张方案草图（docs/assets/unified-login/）、登录事务与回跳、step-up、绑定解绑、邮箱验证码、Google、成员资格、41 条要本人 GitHub 令牌的接口、各业务域对齐表与账号事件表、接口与错误码、审计、数据库 DDL、回填、核对 SQL 与回滚、代码落点、验收、3 个候选 issue 和 8 条待确认。ADR-0005 背景补所有者原话，失败去向与绑定路由同步后指向规格；docs/plan/README.md 与 docs/INDEX.md 登记；docs/changes/237.json 改为 ui-only（docs-only 不允许 webp 素材）并补领域与覆盖
- 结果：没有改 app/ 代码，没有建 issue，没有合并；docs、doc-sync、catalog、architecture 检查通过，完整 pnpm check 在提交前重跑
- 下一步：快进推送 task/237/sso_plan，等 CI；更新 #242 正文的变更范围、草图与审查结论；在 #237 留追踪评论

## 20:52:03 +08:00 · 推送 · #237 · 统一登录实施规格与草图已快进推送到 PR #242 来源分支

- 执行者：agent-notion-geek-handoff（Notion AI，接手 Codex PR 跟进）
- 做了什么：核对 fork 远端 task/237/sso_plan 仍为 b44bcb2d671d2bd8cc8b1c548f5eabfad5f3e2b8（等于 HEAD~1）后，把 5d8b6a9cd82bf13aed468b9aaf9c76d5a42d5fe9 快进推送到 git@github.com:ZZDR1023/admin-geek.git；未 force push，未动 stage/main 与 tag
- 结果：pre-push 分支与发布 tag 规则、task worktree 生命周期通过；同 head 的 core、verify、architecture-alignment、pr-contract、docker、forum、env-contract 已通过，e2e 进行中；PR 仍 OPEN，方案仍 proposed
- 下一步：补一处参数名澄清与比赛协调链接后再推送，等同 head 检查再更新 PR 正文；不合并

## 20:52:04 +08:00 · 提交 · #237 · 澄清资格来源 A 的 GitHub 参数并链接比赛协调细则

- 执行者：agent-notion-geek-handoff（Notion AI，接手 Codex PR 跟进）
- 做了什么：UNIFIED-LOGIN.md 资格来源 A 引用的 GitHub 接口 GET /user/{account_id} 参数名与本文的 account_id（极客班 OpenID）同名，写明填 GitHub 身份的 identities.provider_uid；「按业务域」表 competitions 行补 #239 新流程同样只看身份、不调用 GitHub，并指向 PR #243 中 COMPETITION-APP.md 的「与其他业务的协调」
- 结果：只改方案文档，不改应用代码；pnpm check 见本次提交正文；方案仍 proposed，未合并
- 下一步：推送后等同 head 检查，更新 #242 正文与 #237 追踪记录；不合并

## 22:05:29 +08:00 · 推送 · #237 · 补记：752c0c64 已快进推送到 PR #242 来源分支，同 head 检查全绿

- 执行者：agent-notion-geek-handoff（Notion AI，接手 Codex PR 跟进）
- 做了什么：752c0c64（澄清资格来源 A 的 GitHub 参数并链接比赛协调细则）随 5d8b6a9c 快进推送到 fork 的 task/237/sso_plan，未 force push；21:12 在 PR #242 评论 @coderabbitai review 手动触发增量审查；21:14 干净工作区 pnpm check 退出 0（283 份文档、84 条链路、172 个方法路径、27 张表、20 项能力），并逐条核对规格里 34 处 file:line 引用
- 结果：同 head 检查全绿：CI 39255711653、architecture-alignment 39255711315、pr-contract 39255711468、e2e 39255711580（job 118070739158，43 passed (21.4m)）、Netlify 预览；CodeRabbit 21:21 完成 b44bcb2d..752c0c64 的增量审查，没有可执行意见；PR #242 正文尚未刷新
- 下一步：PR #243 的 CodeRabbit 意见要求资格模块能查别的账号，先在本分支补上再刷新 #242 正文；不合并

## 22:05:29 +08:00 · 提交 · #237 · 资格模块补充按账号查询别的账号是否成员

- 执行者：agent-notion-geek-handoff（Notion AI，接手 Codex PR 跟进）
- 做了什么：UNIFIED-LOGIN.md「成员资格（交付 2）」新增「查别的账号」：邀请对象、新队长这类检查也问资格模块的按账号查询，只读已记录的 users.status 与 org_state，两者都是 active 才回 active，其余（包括 unknown）回 not_member，不带会话、不调用 GitHub、不能用来签发或保留会话，交付 2 之前由第一个用到的业务写在共享成员守卫里；统一口径第 4 条指向它；ADR-0005 决策中 org_state、org_checked_at 的复用范围补上这项只读检查。起因是 CodeRabbit 在 PR #243 指出比赛方案直接读这两列并放行 unknown
- 结果：只改方案文档与记录，不改应用代码；pnpm check 见本次提交正文；方案仍 proposed，未合并
- 下一步：推送后把 #243 的规格固定链接改到新提交并改目标成员检查，等两边同 head 检查；不合并

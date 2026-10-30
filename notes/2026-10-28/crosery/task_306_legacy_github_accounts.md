# task/306/legacy_github_accounts · crosery · 2026-10-28

负责人：crosery

## 14:40:50 +08:00 · 开工 · #306 · task/306 开工：v0.1.1 升级后旧 GitHub 用户的账号与成员资格补齐（hotfix）

- 执行者：agent-claude-geek-main-fece2da2（Claude Code，claude-sonnet-5-5）
- 做了什么：GitLab #306、#307（所有者 2026-10-28 14:2x 与 14:30 原话：「[已脱敏]」「[已脱敏]」）。先查证：生产库 0.1.1 升级后 users 4、identities 5，旧库 sessions 89 行含 33 个 GitHub 登录名，论坛用户 33 行只有 4 行有账号，名册 25 行只有 2 行有账号；逐表对比发布前备份与现网库，除 sessions（登录状态）与 forum_topic_views 外没有旧表行减少，数据没有物理丢失，缺的是 GitHub 号到账号的映射与成员资格；4 个已建账号全是 level.registered，因为 backfillIdentity 建号时 org_role 为空，且 backfillSeedLedger 把刚认领的两条名册行预先记成已映射。发布前备份 backups/20261028T061720Z-3667551 已另存到 backups-keep 并核对校验和。从 stage 94140632（与 main 同一提交）新建 task/306/legacy_github_accounts 与 worktree。
- 结果：worktree 已建；方案：启动迁移里补建账号与 GitHub 身份、认领论坛用户与名册、按旧记录恢复成员资格，一次性、只补不删；生产库副本演练后发 v0.1.2 hotfix

## 14:41:30 +08:00 · 提交 · #306 · 旧 GitHub 用户补齐迁移、台账修正、版本 0.1.2

- 执行者：agent-claude-geek-main-fece2da2（Claude Code，claude-sonnet-5-5）
- 做了什么：新增 app/server/src/lib/migrations/2026-10-legacy-github.ts（restoreLegacyGithubAccounts、repairLegacyLevels），在 runYugcV2Migration 里排在 assignAccountIdentities 之前与 mapRoleAssignments 之后；backfillSeedLedger 只把账号已有权限成员记录的名册行记成已映射；tests/server/legacy-github-restore.test.ts 9 个用例（不带修复时 6 个失败）；docs/changes/306.json、SECURITY 与 server 服务合同；包版本 0.1.1 → 0.1.2。文档核对：docs/services/web/、docs/services/console/ 不用改——只有 package.json 的版本号变了，页面与接口没变，头部日期按规则改成 2026-10-28。演练：Arch 上用现网库的一致性副本与升级前备份各启动两次（--network none，不碰生产栈）：账号 4→44、论坛用户关联 32、名册关联 25、全部 level.member、所有者只有 Crosery、旧表行数无减少、第二次启动无变化、integrity_check 与 foreign_key_check 干净；备份路径下 sessions 89→6 是过期会话清理（0.1.1 已有行为），登录状态之外没有数据丢失。
- 结果：9 个新用例通过；全量 pnpm check 前一次因 web/console 文档日期未更新而在 doc-sync 失败，已改正

## 14:41:46 +08:00 · 开发 · #306 · 文档核对：web 与 console 服务文档

- 执行者：agent-claude-geek-main-fece2da2（Claude Code，claude-sonnet-5-5）
- 做了什么：文档核对：docs/services/web/ 不用改——app/web 只有 package.json 的版本号 0.1.1 改成 0.1.2，页面、接口与构建都没变。文档核对：docs/services/console/ 不用改——app/console 只有 package.json 的版本号 0.1.1 改成 0.1.2，控制台页面与接口没变。
- 结果：两份文档内容已核对无需改动，头部日期按规则更新

## 14:41:52 +08:00 · 开发 · #306 · 文档核对：console 服务文档

- 执行者：agent-claude-geek-main-fece2da2（Claude Code，claude-sonnet-5-5）
- 做了什么：文档核对：docs/services/console/ 不用改——app/console 只有 package.json 的版本号 0.1.1 改成 0.1.2，控制台页面与接口没变。
- 结果：console 服务文档内容已核对无需改动

## 14:51:55 +08:00 · 返工 · #306 · 独立审查意见的处理与演练复跑

- 执行者：agent-claude-geek-main-fece2da2（Claude Code，claude-sonnet-5-5）
- 做了什么：独立审查（另起的 claude-sonnet-5-5 子 agent，只读，没有看到作者的结论）提出 5 条：往届成员被论坛行提成成员（改：名册里只有 alumni 时不设站内角色）；adopt 会覆盖所有者在控制台设成「不是成员」的账号字段（改：等级来源不是自动授予的不动，加反例用例）；论坛 role=admin 只是最近一次请求时的缓存、站长恢复依赖它（未改代码：演练名单里将获得站长的只有 Crosery，发布后再用 bootstrap-owner 核对，记为剩余风险）；测试里有只会通过的断言（改：一次性用例用 github-signin 与 migration 来源降级后重跑、只补不删用整行快照、补 ledger 反例、升级后论坛行、舰长、往届、全新空库用例，并做两次变异核对：去掉 adopt 守卫、去掉一次性标记各有一个用例变红）；没有可追溯记录（改：补系统审计 identity.legacy_restore 只记数量，启动日志带 legacy_github 计数）。重新编译后在 Arch 上对现网库副本与升级前备份各复跑：账号 4→44（备份 0→44）、论坛用户关联 32、名册关联 25、全部 level.member、所有者只有 Crosery、第二次启动无变化、integrity 与 foreign_key 干净、旧表行数无减少（备份路径 sessions 89→6 是过期会话清理）。tests/server/legacy-database.test.ts 的一次性标记清单补上 legacy_github_v1 与 legacy_github_v1_levels。
- 结果：legacy-github-restore 13 个用例、legacy-database 与 yugc-v2-migration 全部通过；全量检查在提交前再跑一次

## 14:58:52 +08:00 · PR · #306 · 开 MR !49：task/306

- 执行者：agent-claude-geek-main-fece2da2（Claude Code，claude-sonnet-5-5）
- 做了什么：按 PULL-REQUESTS 正文契约开 GitLab MR !49（task/306/legacy_github_accounts → stage），Closes #306，Refs #307；标签 hot-fix、P0、bug、server、func:auth、func:data。正文写明：数据没有物理丢失、缺的是账号映射与成员资格、演练数字、三条剩余风险（站长恢复依赖论坛缓存角色、旧成员按旧记录保留成员权限、旧登录状态不可恢复）。
- 结果：MR !49 已开；未验证：生产启动后的实际结果，合并、打 rc、预发布核对、正式发布之后写回 #306

## 14:58:52 +08:00 · 审查 · #306 · MR !49 审查结论：通过

- 执行者：agent-claude-geek-main-fece2da2（Claude Code，claude-sonnet-5-5）
- 做了什么：审查人是另起的 claude-sonnet-5-5 子 agent（只读，没有看到作者结论），不是实现作者，时间 14:49，被审为 6b5e8103 之前的同一改动。逐点结论见 MR 正文「审查结论」：5 条意见，4 条改代码或测试，1 条（站长恢复依赖论坛缓存角色）记为剩余风险。作者复核：重新编译后在 Arch 上对现网库副本与升级前备份各复跑，名单中将获得站长的只有 Crosery；两次变异核对确认加强后的用例会变红。
- 结果：结论：通过（被审 commit 6b5e8103）

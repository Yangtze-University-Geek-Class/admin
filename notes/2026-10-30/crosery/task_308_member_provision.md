# task/308/member_provision · crosery · 2026-10-30

负责人：crosery

## 02:09:43 +08:00 · 开工 · #308 · 补建按权限组认成员

- 执行者：agent-claude-01d717b4（Claude Code，claude-opus-5-5）
- 做了什么：stop-preview-sync 演算（run 40927643521）报「对不上 github:317592648」，没有计入可最小补建。核对：GitLab 同步按 perm_members 的 level.member/level.alumni 认有效成员（sync-control.mjs accountsForVerification），而导出补建信息只看 users.org_role 是 admin/member 且 org_state=active；IofStage 在 GitHub 组织里（orgs/…/members 204），10-29 06:57 用预发布 SSO 登过 GitLab 11，正式库没有账号。从 gitlab/main 7f5656ae 拉 task/308/member_provision。
- 结果：定位到导出规则与同步的成员口径不一致。
- 下一步：导出按 level.member 认成员并写明不能补建的原因，补用例，MR 进 main。

## 02:11:47 +08:00 · 提交 · #308 · 补建按权限组认成员

- 执行者：agent-claude-01d717b4（Claude Code，claude-opus-5-5）
- 做了什么：97d08369：exportSubjects 先看已记录的 org_role，没有时按有效的 level.member 记为 member；补建不了的写 provision_skip（inactive/alumni/not_member/no_github），import 带 --provision-unmatched 时随「对不上」打印原因；汇总行格式不变。GITLAB.md 同步说明。新增用例覆盖成员、过期、校友、停用、无 GitHub、管理员六种。
- 结果：三组用例 73 通过。
- 下一步：审查、开 MR、合并后重跑 stop-preview-sync 演算。

## 02:12:55 +08:00 · 提交 · #308 · 宏观对齐声明与文档核对

- 执行者：agent-claude-01d717b4（Claude Code，claude-opus-5-5）
- 做了什么：dea04a69：docs/changes/308.json 改为本 MR 的声明（覆盖迁移工具、用例与 GITLAB.md）。文档核对：docs/ops/DEPLOY.md 不用改——它只写「正式库缺失的有效旧成员由 account.js provision-github 按 GitHub UID 最小补建」，口径变化写在 GITLAB.md。文档核对：docs/ops/ENVIRONMENTS.md 不用改——没有改 env 键、端口或环境划分。文档核对：docs/ops/CICD.md 不用改——没有改工作流或步骤选项。
- 结果：check-architecture 通过（5 个变更文件、3 个关联节点）。

## 02:15:01 +08:00 · 审查 · #308 · 补建口径的独立审查

- 执行者：agent-claude-01d717b4（Claude Code，claude-opus-5-5）
- 做了什么：审查 agent 按 code-review 技能核对 97d08369：不阻塞；指出判定先看已弃用的 org_role，与 server 的 membershipFromRow（identity-store.ts）不一致——org_role=admin 但没有站长称号的人会经 provisionAccount 在正式库拿到站长资格，org_role=member 但 level 已过期的会被补建；建议只看有效 level.member 与 title.site.owner，并补 5 个边界用例。核实：写入端与 cutover.sh 严格正则不受新字段影响。
- 结果：结论：可以合并，建议同一个 MR 内修正判定。

## 02:15:01 +08:00 · 返工 · #308 · 按 server 口径判定成员与角色

- 执行者：agent-claude-01d717b4（Claude Code，claude-opus-5-5）
- 做了什么：79fe78aa：导出只看有效的 level.member（成员）与 title.site.owner（管理员），校友写 alumni，org_role/org_state 不再读取；补上审查列出的 5 个边界用例；GITLAB.md 与 docs/changes/308.json 同步。
- 结果：三组用例 73 通过；pnpm check exit 0；check-architecture、check-doc-sync 对 gitlab/main 通过。
- 下一步：开 MR 进 main，合并后重跑 stop-preview-sync 演算。

## 02:15:52 +08:00 · PR · #308 · 开 MR !67 进 main

- 执行者：agent-claude-01d717b4（Claude Code，claude-opus-5-5）
- 做了什么：GitLab geek/admin!67：task/308/member_provision → main（hotfix 窗口 #308），正文十节，审查两轮结论「通过」；标签 P0、bug、func:auth、hot-fix、infra:deploy。
- 结果：MR 已开，无冲突。
- 下一步：合并，镜像 GitHub main，重跑 stop-preview-sync 演算。

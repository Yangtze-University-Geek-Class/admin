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

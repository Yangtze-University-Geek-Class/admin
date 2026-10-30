# task/316/auth_chain_hardening · crosery · 2026-10-30

负责人：crosery

## 02:51:00 +08:00 · 开工 · #316 · 接管 GitHub PR #294（Doulor）：账号与登录链路加固

- 执行者：agent-claude-geek-main-316（Claude Code，claude-haiku-5-5）
- 做了什么：GitHub PR #294（Doulor/admin，head task/287/auth_chain_hardening，GitHub issue #287）在 GitLab 停机期间提交，GitLab issue 迁移后为 #316。从 gitlab/stage bad8f228 建 task/316/auth_chain_hardening 与 worktree .claude/worktrees/task-316；按顺序 cherry-pick 三个非合并提交并保留作者：7c9fa9de→c5f9c7bc、eb9afd38→b7aa04dd、c1b85fc5→f573a9c5。本条补写于 cherry-pick 完成之后（实际开工在前，不回填时间）。
- 结果：pnpm install --frozen-lockfile --offline 完成；better-sqlite3 在 Node 22.23.2 下直接可加载，未重建；目录与声明的重编号在后续提交中完成
- 下一步：docs/changes/287.json 还原为 stage 版本；新增 docs/changes/316.json；重新生成项目目录；跑测试与 pnpm check；安全审查；推送 gitlab 的 task 分支

## 02:55:35 +08:00 · 提交 · #316 · 同步接口契约，重新生成项目目录

- 执行者：agent-claude-geek-main-316（Claude Code，claude-haiku-5-5）
- 做了什么：docs(docs): 同步接口契约并重新生成项目目录（#316）：endpoint-contracts.md 改密、重置后吊销其它会话，资料 409 display_name_taken 与论坛命名空间，回调重复参数与缺 state 的 invalid_state；pnpm catalog:generate 重新生成 docs/architecture/catalog/*（与 stage 的冲突按 stage 版本消解后重生成，不手改）
- 结果：npx vitest run tests/server 60 个文件 1001 个测试全部通过；auth-chain-hardening + signin-methods 58 个通过；pnpm check 在 check:notes 停止（既有问题 notes/2026-10-29/crosery/task_308_stage_close.md:5），其余步骤逐个运行 exit 0；check-doc-sync --base gitlab/stage 通过；check-architecture --base gitlab/stage 通过（宏观对齐通过：#316，19 个变更文件，38 个关联节点）
- 下一步：安全审查与变异检查结论写入审查记录；推送 gitlab task 分支

## 02:56:26 +08:00 · 审查 · #316 · 集成审查 PR #294 的安全改动（审查 SHA a3149609）

- 执行者：agent-claude-geek-main-316（Claude Code，claude-haiku-5-5）
- 做了什么：审查人 agent-claude-geek-main-316 为集成者自审，不是独立审查：逐行核对 app/server/src/lib/auth.ts、lib/forum-store.ts、routes/admin/auth.ts、routes/identity/account.ts、email.ts、google.ts、profile.ts 共 7 个文件 67 行改动；对 tests/server/auth-chain-hardening.test.ts 与 signin-methods.test.ts 做变异检查，逐个去掉修复再跑对应文件
- 结果：变异结果：去掉用户名/显示名占用判定（profile.ts）→ 3 个测试失败；去掉重置密码后的会话吊销（email.ts:220）→ 1 个失败；去掉回调类型收敛（admin/auth.ts）→ 1 个失败；去掉改密码后的会话吊销（account.ts:146）→ 0 个失败，无回归覆盖。阻塞项 0。残余：CLI 令牌 gk_（device-store.ts:219-226 只核对到期与账号状态）不随改密或重置失效；账号页改密路径无回归测试；缺 state 的错误码由 missing_params 变为 invalid_state（已写入声明与 endpoint-contracts.md）；会话吊销在重置事务之后执行（email.ts:220，已写入契约）
- 下一步：CLI 令牌是否随改密吊销、是否补账号页改密的回归测试，交所有者决定；MR 与 PR 正文由后续步骤创建

## 03:12:28 +08:00 · 返工 · #316 · 审查返工：补改密码后吊销其它会话的回归用例

- 执行者：agent-claude-01d717b4（Claude Code，claude-opus-5-5）
- 做了什么：主控审查：代码改动与 PENTEST-20261029 finding 9/11/14/31 对得上；集成时的变异检查显示去掉 account.ts 改密后的 revokeAccountSessions 没有用例失败。在 signin-methods.test.ts 补一条：同一账号两处登录，一处改密码，另一处 /auth/me 变为未登录、发起修改的这处仍登录
- 结果：新用例通过；把 account.ts 那一行换成注释后该用例失败（expected true to be false），已还原。残余：geek-cli 的 gk_ 令牌与 OIDC 下游令牌不随改密或重置失效，不在本单范围，作为候选另报

## 03:20:07 +08:00 · PR · #316 · 以原作者身份开 GitLab MR !70

- 执行者：agent-claude-01d717b4（Claude Code，claude-opus-5-5）
- 做了什么：用 Doulor 的临时冒充令牌开 !70：task/316/auth_chain_hardening → stage，标签 func:auth；issue #316 按正文的改动类型补 func:auth、摘 needs-evidence（正文有「涉及接口」）
- 结果：https://git.yangtzeu.work/geek/admin/-/merge_requests/70，作者 Doulor；冒充令牌已吊销

## 03:20:07 +08:00 · 审查 · #316 · 主控审查 ca8ef750，返工后 01f356dd：通过

- 执行者：agent-claude-01d717b4（Claude Code，claude-opus-5-5）
- 做了什么：核对占用判定在写入前、与论坛同一套 nameKey；revokeAccountSessions 按 sessions.openid 删除并保留当前 sid；回调先收敛参数类型。缺口是改密后吊销无回归用例，已补 6d1fcf05 并做变异检查。真实 HTTP（本机 listen + fetch）：GET /auth/callback?state=a&state=b&code=x → 400 invalid_state；PATCH /api/identity/profile 官方用户名 → 409 username_taken、官方显示名 → 409 display_name_taken、正常名 → 200
- 结果：结论：通过。tests/server 60 文件 1002 passed；check-architecture、check-doc-sync、check:catalog 通过。残余：gk_ 令牌与 OIDC 下游令牌不随改密失效，另报候选

## 03:31:47 +08:00 · 收尾 · #316 · PR !70 已合并，清理 worktree

- 执行者：agent-claude-01d717b4（Claude Code，claude-opus-5-5）
- 做了什么：node scripts/task.mjs finish 316：删 worktree .claude/worktrees/task-316 与本地分支 task/316/auth_chain_hardening
- 结果：PR 已合并

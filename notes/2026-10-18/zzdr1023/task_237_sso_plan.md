# task/237/sso_plan · zzdr1023 · 2026-10-18

负责人：zzdr1023

## 03:15:26 +08:00 · 审查 · #237 · 接手审查 f59c6b4：有条件通过，ADR 的论证和 DDL 要改

- 执行者：agent-claude-geek-main-sso（Claude Code，claude-sonnet-5-5，接手审查与返工）
- 做了什么：按 CODE-REVIEW 对 PR #242 的 f59c6b4 逐项核对：四条只读审查线（ADR 事实核对、#229+463d95e 身份模型、Auth.js 与内嵌 OIDC 可行性、#243 与 #239 的身份耦合），读 origin/stage 的代码和 gh pr diff 229，不运行测试；#229 的 DDL 与 resolveGithubIdentity 另由人对着 diff 复核（/tmp 下的 pr229.diff 第 156、325-330 行）
- 结果：结论：有条件通过，无阻塞项。应修：① 方案 A 的代价栏不成立（app/server 镜像 node:22 且无 engines，与 forum 的 Node >=26 无关；挂进 Fastify 不必换 sid）；② 36 处口径与 auth.ts:103 不符；③ 「没有轮换」与拆分清单第 1 项「轮换 sid」矛盾；④ #203 是 not planned，不是需求方；⑤ 采用的 DDL 有缺陷：users.id 的 ULID 含毫秒时间、provider_union_id 唯一约束挡住同一人的第二个微信应用、登录命中后不检查 users.status、merged 无 CHECK；⑥ 非 GitHub 会话在 access.resolve/require-org-role//auth/me 里没有定义（access_token_encrypted NOT NULL，访问判定一律带 GitHub token）；⑦ 拆分清单没有前端，也没有对外 sub 的稳定性承诺。ADR 全文未出现 Auth.js，仓库里也没有 Auth.js 依赖（git grep 只命中 ./auth.js 的本地 import）。夹带的 task_156/175/221 notes 是暂存链路入库，note.mjs check 通过，不算问题。PR 缺 func:api、func:auth 标签，缺审查记录（本条补）
- 下一步：合入 stage、按审查结果改 ADR、补标签、更新 PR 正文的审查结论

## 03:15:36 +08:00 · 返工 · #237 · 合入最新 stage，按审查结果改写 ADR-0005

- 执行者：agent-claude-geek-main-sso（Claude Code，claude-sonnet-5-5，接手审查与返工）
- 做了什么：git merge --no-ff origin/stage（20a9124，只有 notes/INDEX.md 冲突，用 node scripts/note.mjs index 重新生成，合并提交里没有别的编辑）；随后 d624d51 改写 docs/decisions/0005-sso-extend-core-server.md 并重新生成 docs/INDEX.md：对外授权由「否决」改为「推迟」，DDL 按审查结果改六处，新增对外 sub 稳定性与非 GitHub 会话两条决策，新增「三层各改什么」表，方案对比加 Auth.js 与 better-auth，拆分清单合成四项且把前端写进交付物，状态仍是 proposed
- 结果：node scripts/check-docs.mjs 273 份通过；docs-index.mjs --check 通过；check-doc-sync.mjs 6 组通过；ADR 里的行号对着 origin/stage 逐条核对（auth.ts:98、access.ts:24、role-store.ts:184、require-auth.ts:34、account.ts:14/29/44、signin.ts:22-32 等）。ADR 里 Node 22 兼容、内存增量、与 sid 和 Tuffex 登录页的接线、better-auth 的 Fastify 配合都未实测，已在文中写明。文档核对：docs/services/server/ 不用改——本 PR 仍没有 app/ 改动

## 03:15:36 +08:00 · 提交 · #237 · 合并提交与 ADR 改写提交

- 执行者：agent-claude-geek-main-sso（Claude Code，claude-sonnet-5-5，接手审查与返工）
- 做了什么：20a9124 Merge branch 'stage' into task/237/sso_plan；d624d51 docs(decisions): ADR-0005 改为先建内部身份、对外授权后接，补三层改动面；本条与上两条审查、返工记录一起以 docs(notes) 提交
- 结果：note.mjs check 与 docs-index.mjs --check 见返工记录；pnpm check 的 typecheck 未在本 worktree 跑（没有 app/ 改动，CI 会跑）

## 03:18:05 +08:00 · PR · #237 · 改 PR #242 正文并补 func:api、func:auth 标签

- 执行者：agent-claude-geek-main-sso（Claude Code，claude-sonnet-5-5，接手审查与返工）
- 做了什么：gh pr edit 242 --add-label func:api --add-label func:auth；gh pr edit 242 --body-file 重写正文的变更范围、解决链路、验证（追加接手后重跑）、人工验收步骤、审查结论、风险与回滚，目的、关联（只改 #203 一行）、验收证据保持作者原文；改前用 node scripts/pr-contract.mjs check 带 issue 状态和标签文件核对
- 结果：pr-contract：PR 正文契约通过（9 个段落齐全，有验收证据）；PR 现有标签 func:api、func:auth。审查结论段写明被审提交 f59c6b46、结论有条件通过，条件是 CI 全绿和对 ADR 的确认记录
- 下一步：推送后在 PR 上发审查与返工评论，等 CI；确认记录由 #237 或 PR 的评论留下

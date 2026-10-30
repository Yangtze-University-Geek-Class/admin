# task/317/anonymous_surface_hardening · crosery · 2026-10-30

负责人：crosery

## 02:56:59 +08:00 · 开工 · #317 · 接管 GitHub PR #295（Doulor）：未认证接口的防滥用与枚举加固

- 执行者：agent-claude-geek-main-317（Claude Code，claude-haiku-5-5）
- 做了什么：GitHub PR #295（Doulor/admin，head task/288/anonymous_surface_hardening，GitHub issue #288）在 GitLab 停机期间提交，GitLab issue 迁移后为 #317。从 gitlab/stage bad8f228 建 task/317/anonymous_surface_hardening 与 worktree .claude/worktrees/task-317（与 #316 分别独立）；待按顺序 cherry-pick 三个非合并提交并保留作者：bae1c3ee、cbaaa536、c17e6fd0
- 结果：pnpm install --frozen-lockfile --offline 完成；better-sqlite3 在 Node 22.23.2 下直接可加载，未重建
- 下一步：cherry-pick 三个提交；docs/changes/288.json 还原为 stage 版本；新增 docs/changes/317.json；重新生成项目目录；跑测试与 pnpm check；安全审查；推送 gitlab 的 task 分支

## 03:04:35 +08:00 · 提交 · #317 · 修正 PoW 去重与 OIDC 范围的文档说法，重新生成项目目录

- 执行者：agent-claude-geek-main-317（Claude Code，claude-haiku-5-5）
- 做了什么：docs(docs): 修正 PoW 去重说法并重新生成项目目录（#317）：SECURITY.md 与 endpoint-contracts.md 把「同一份 PoW 只能用一次」改成 5 分钟去重窗口，并写明未来时间戳证明窗口过后可再用一次（2026-10-30 探测）；删掉未验证的「浏览器本来就用不了这些端点」；两文档更新日期改为 2026-10-30；pnpm catalog:generate 重新生成目录
- 结果：npx vitest run tests/server 60 个文件 997 个测试通过；变异检查 M5（去掉 PoW 去重）、M6（去掉 OIDC Origin 判定）各使 anonymous-surface-hardening 一条失败；pnpm check 在 check:notes 停止（既有问题 notes/2026-10-29/crosery/task_308_stage_close.md:5），其余步骤单独运行：check:catalog 首次因文档改动过期，重生成后通过，其余全部 exit 0；check-doc-sync --base gitlab/stage 通过；check-architecture --base gitlab/stage 通过（宏观对齐通过：#317，16 个变更文件，29 个关联节点）
- 下一步：审查记录；推送 gitlab 的 task 分支

## 03:04:48 +08:00 · 审查 · #317 · 集成审查 PR #295 的匿名入口改动（审查 SHA 1e880b61 之前的代码未改动）

- 执行者：agent-claude-geek-main-317（Claude Code，claude-haiku-5-5）
- 做了什么：审查人 agent-claude-geek-main-317 为集成者自审，不是独立审查：逐行核对 app/server/src/middleware/pow.ts、lib/limits.ts、routes/oidc/index.ts、services.ts 的 67 行改动；临时探测测试两项（已删除，未提交）：PoW 重放与 OIDC client_id 差异；变异检查 M5（去掉 consumeNonce）与 M6（去掉 OIDC Origin 判定）
- 结果：PoW：同一份证明 0 秒后 400，5 分 1 秒后（时间戳偏差 61 秒）200，feedback 落 2 行，即窗口过后可再用一次，去重窗口 5 分钟与 checkPow 的 ±5 分钟偏差不匹配（pow.ts:14、services.ts:186-189、limits.ts hit 为滑动窗口）；OIDC：带 Origin 与不带 Origin 时，已登记与未登记 client_id 的 /oidc/token 响应都是 401 invalid_client「client authentication failed」，Origin 判定有效；SERVER_ENDPOINT（routes/oidc/index.ts:13）还包括发现文档与 JWKS，浏览器跨源读取它们会收到 401（按代码判断，未实测）；pow.ts preflight 先消费 nonce 再进入业务校验，业务 400 后证明也已失效（按代码判断）。变异：M5 使 anonymous-surface-hardening 1 条失败，M6 使 1 条失败。阻塞项 0；残余：PoW 窗口过后可再用一次（建议去重窗口取两倍偏差，或单向只收过去的时间戳，交所有者决定）；测试只覆盖即时重放
- 下一步：PoW 去重窗口的修法与 OIDC 判定范围，交所有者决定；MR 与 PR 正文由后续步骤创建

## 03:10:49 +08:00 · 返工 · #317 · 审查返工：PoW 有效期内只能用一次，发现文档与 JWKS 不挡 Origin

- 执行者：agent-claude-01d717b4（Claude Code，claude-opus-5-5）
- 做了什么：主控审查发现两处：1）时间戳允许前后各 5 分钟，证明能用 10 分钟，去重只记 5 分钟，未来时间戳的证明过 5 分钟能再用一次；2）带 Origin 一律 401 的正则把发现文档与 JWKS 也算进去，它们不认客户端，没有枚举差异。先加两条用例复现（红：5 分 1 秒后重放回 200；带 Origin 读发现文档回 401），再改：pow.ts 新增 POW_NONCE_TTL_MS = 2 × POW_WINDOW_MS，services.ts 用它做去重窗口；oidc/index.ts 新增 CLIENT_ENDPOINT（token、token/revocation、me）只对它挡 Origin。SECURITY.md、endpoint-contracts.md、317.json 去掉「残余风险」改为修复后的行为；目录重生成。文档核对：docs/services/server/README.md 不用改——它不写 PoW 去重与 OIDC Origin 的细节，这两处只在 SECURITY.md 与 endpoint-contracts.md，已同步
- 结果：anonymous-surface-hardening.test.ts 4/4 通过（修复前 2 条失败）；tests/server 60 文件 999 用例通过；check-architecture --base gitlab/stage 通过（#317，16 文件，29 节点）

## 03:20:07 +08:00 · PR · #317 · 以原作者身份开 GitLab MR !71

- 执行者：agent-claude-01d717b4（Claude Code，claude-opus-5-5）
- 做了什么：用 Doulor 的临时冒充令牌开 !71：task/317/anonymous_surface_hardening → stage，标签 func:api、func:auth；issue #317 补 func:api、func:auth，摘 needs-evidence
- 结果：https://git.yangtzeu.work/geek/admin/-/merge_requests/71，作者 Doulor；冒充令牌已吊销

## 03:20:07 +08:00 · 审查 · #317 · 主控审查 b3a70771，返工后 9b12a735：通过

- 执行者：agent-claude-01d717b4（Claude Code，claude-opus-5-5）
- 做了什么：两处返工：去重窗口短于证明有效时段（改 2 倍偏差）、Origin 判定误伤发现文档与 JWKS（改只挡 token、revocation、me），均先写用例复现。真实 HTTP（本机 listen + fetch）：POST /oidc/token 带 Origin 已登记与未登记 client 都 401 且响应体相同；GET /oidc/.well-known/openid-configuration、/oidc/jwks 带 Origin → 200；POST /api/feedback 首次 200、重放 400
- 结果：结论：通过。tests/server 60 文件 999 passed；anonymous-surface-hardening 4 passed（修复前 2 failed）；check-architecture、check-doc-sync、check:catalog 通过

## 03:31:53 +08:00 · 收尾 · #317 · PR !71 已合并，清理 worktree

- 执行者：agent-claude-01d717b4（Claude Code，claude-opus-5-5）
- 做了什么：node scripts/task.mjs finish 317：删 worktree .claude/worktrees/task-317 与本地分支 task/317/anonymous_surface_hardening
- 结果：PR 已合并

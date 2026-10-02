# task/128/session_cleanup · lysnowq · 2026-10-02

负责人：lysnowq

## 16:42:43 +08:00 · 开发 · #128 · 过期会话主动清理：清理函数、每小时定时器与生命周期开关

- 执行者：agent-omp-issue-128（OMP，代表 LYsnowQ）
- 做了什么：app/server/src/lib/auth.ts 新增 cleanupExpiredSessions()（按 expires_at 批量 DELETE、返回删掉条数）与 startCleanup/stopCleanup（启动时清一次、之后每小时一次，计时器 unref，出错只记日志），createSession/getSession 改用注入的时钟；services.ts 把 ServiceOverrides.clock 同时传给 createAuth，close() 停掉清理；app.ts 新增 sessionCleanup 开关（onReady 启动、onClose 停止），index.ts 打开；tests/server/session-cleanup.test.ts 新增 5 个用例；docs/services/server/README.md、data-model.md 与 docs/architecture/SECURITY.md 写明会话行最长保留 7 天加一个清理间隔
- 结果：corepack pnpm exec vitest run tests/server/session-cleanup.test.ts：把 src 暂存回修复前 4 failed/1 passed，修复后 5 passed；corepack pnpm exec vitest run tests/server：11 files、245 passed；corepack pnpm check 通过（doc-sync 按 PR 对 origin/stage）；corepack pnpm --filter @yzgc/server build 退出 0

## 16:42:49 +08:00 · 提交 · #128 · 会话清理的实现、测试与文档一起提交

- 执行者：agent-omp-issue-128（OMP，代表 LYsnowQ）
- 做了什么：fix(auth): 定时主动清理过期会话，不再长期留存加密令牌（app/server/src/{app,index,services,lib/auth}.ts、tests/server/session-cleanup.test.ts、docs/services/server/README.md、docs/services/server/data-model.md、docs/architecture/SECURITY.md）
- 结果：commit 5df3f49，10 files changed/219 insertions/15 deletions；本次提交前 corepack pnpm check 与 corepack pnpm exec vitest run tests/server（245 passed）都通过

## 16:44:00 +08:00 · 开发 · #128 · 去掉会话清理用例里未使用的 HOUR/DAY 常量

- 执行者：agent-omp-issue-128（OMP，代表 LYsnowQ）
- 做了什么：tests/server/session-cleanup.test.ts：删掉没有引用的两个常量，计时只用导出的 SESSION_CLEANUP_INTERVAL_MS 与 SESSION_TTL_MS
- 结果：corepack pnpm exec vitest run tests/server/session-cleanup.test.ts：5 passed

## 16:48:49 +08:00 · PR · #128 · 开 PR #181 指向 stage，附独立复跑证据与自审

- 执行者：agent-omp-issue-122-128（OMP，代表 LYsnowQ）
- 做了什么：gh pr create：base=stage、head=task/128/session_cleanup；正文九段含解决链路、修复前后对照（stage 版源码 4/5 失败、修复版 5/5 通过）、整套服务端 245 条、各步 check、人工验收步骤与十二项自审
- 结果：PR https://github.com/Yangtze-University-Geek-Class/admin/pull/181
- 下一步：补「审查」记录并重推，等 PR CI

## 16:48:49 +08:00 · 审查 · #128 · 自审通过：清理范围限 expires_at 过期行，生命周期跟随应用

- 执行者：agent-omp-issue-122-128（OMP，代表 LYsnowQ）
- 做了什么：按 CODE-REVIEW 十二项核对 0aa0ca0：分支合规、无密钥/环境变量/镜像改动、用例可区分修复前后、三份文档同步、边界 202文件1152导入、提交规范、无旧模型与危险操作（删除范围与 getSession 一致、无 schema 变更）、执行记录连续、未合并不清理；结论写入 PR 正文；另记录本机 corepack pnpm check 因嵌套 pnpm 解析到全局 11.5.1 而失败属机器级问题
- 结果：无阻塞与未决应修；结论：通过（PR 正文同名小节）
- 下一步：等 PR CI；合并后按任务清理流程收尾

## 20:23:02 +08:00 · 返工 · #128 · 按审查 F1/F5/F6 返工：删掉的会话在库文件、WAL 和在线备份里不留密文

- 执行者：agent-claude-geek-main-subagent-128（Claude Code 子代理，claude-opus-5-5，Crosery 一方接手）
- 做了什么：接手 PR #181（被审 head 443421b546dc，审查结论有条件通过）。F1：lib/db.ts 每个连接打开 secure_delete；新增 truncateWal（wal_checkpoint(TRUNCATE)，busy_timeout 临时设 0，有别的连接在读时不等、下一趟再截）；cleanupExpiredSessions 删完每趟都截 WAL，返回 { deleted, walTruncated }，截不成记 wal truncate deferred。F6：清理出错的日志加 SQLite 错误码 code。tests/server/session-cleanup.test.ts 新增 3 条：unref（hasRef 为 false）、文件库按字节核对 data.db/-wal/在线备份/关库后都找不到被删会话的密文（带清理前能找到的对照）、另一连接占着读时不等待且下一趟截断。F5：data-model.md 改写 sessions 的写入方/读取方、去掉 idx_sessions_login 的「未使用」（signedInLogins 用它当覆盖索引）、保留时间写明「服务运行期间」；README 源码地图补 sessionCleanup 与会话时钟；SECURITY.md 把「不会长期带着」改成实现后的准确说法，并写明打开 secure_delete 之前删掉的行要 VACUUM（预发布/正式要所有者授权）
- 结果：实验（better-sqlite3 11.10.0 / SQLite 3.49.2）：默认 secure_delete=0，删 20 行后库文件与在线备份各残留 20/20；ON+TRUNCATE 后 0/0/0；另一连接占读时 TRUNCATE 默认等 5178ms，busy_timeout=0 时 0.09ms 返回 busy=1；5 万行删 2.5 万 secure_delete 关/开 25.3ms/27.1ms，空闲截断 0.01ms；旧残留 30 条跑 5 趟后剩 3 条、VACUUM 后 0。pnpm exec vitest run tests/server/session-cleanup.test.ts：8 passed；变异核对 5 项都被抓到（去掉 secure_delete、去掉截断各 2 failed，去掉 busy_timeout=0 那条 5204ms 失败，去掉 unref、去掉 code 各 1 failed）。pnpm exec vitest run tests/server：11 files / 248 passed。pnpm check exit 0（文档同步通过：6 组模块与文档；执行记录通过：44 条链路；密钥门禁通过：746 个文件；typecheck 通过）

## 20:24:00 +08:00 · 返工 · #128 · 按审查 F2 返工：本机预览也打开过期会话清理，验收人能在本机照做

- 执行者：agent-claude-geek-main-subagent-128（Claude Code 子代理，claude-opus-5-5，Crosery 一方接手）
- 做了什么：scripts/local-preview.mjs 的 buildApp 加 sessionCleanup: true（两种模式都开；GitHub 登录模式的 .tools/local-preview/core.db 存的是本机登录者真实令牌，密钥就在旁边的 keys.json）；docs/ops/LOCAL-PREVIEW.md「数据生命周期」写明预览也清过期会话、不写服务日志、用 sqlite3 查行；app.ts 的 BuildAppOptions 注释、auth.ts startCleanup 注释与 server README 源码地图的 index.ts 一行改成「index.ts 和本机预览打开」
- 结果：node --check scripts/local-preview.mjs 通过；node scripts/docs-index.mjs --check：docs/INDEX.md 是最新的；node scripts/check-docs.mjs：272 documents passed；node scripts/check-doc-sync.mjs：文档同步通过（6 组）；tsc -p app/server/tsconfig.json --noEmit exit 0。local-preview 本身固定占 3000/5173，不在分给本任务的端口里，改端口副本的实跑结果在之后的验收记录里写

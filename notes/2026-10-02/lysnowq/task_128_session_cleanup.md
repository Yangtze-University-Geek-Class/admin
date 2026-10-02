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

## 20:44:05 +08:00 · 开发 · #128 · 本机浏览器验收（0b1c51a6a856 的构建）：登录 → 过期 → 启动清理 → 刷新退出，库与文件里都没了

- 执行者：agent-claude-geek-main-subagent-128（Claude Code 子代理，claude-opus-5-5，Crosery 一方接手）
- 做了什么：pnpm build 后在 /private/tmp/geek-acc-128 起 harness（app/server/dist 的 buildApp，logger 与 sessionCleanup 打开，临时文件库，假 GitHub，端口 5420，浏览器用 geek128.localhost 打开以免和本机别的服务的 sid cookie 混在一起）；ego TaskSpace 205「geek #128 验收」：控制台用（假的）GitHub 登录 → 停服务、sqlite3 把这一行改成已过期 → 再起服务 → 刷新；手机 390×844 DPR3 触屏再走一遍并插入别人的过期行；另用真实入口 node app/server/dist/index.js 对比 stage 458999fc0c60、PR 原 head 443421b546dc 与 0b1c51a6a856；scripts/local-preview.mjs 的改端口副本（3000→5423、5173→5323）对比 stage 版脚本
- 结果：桌面：重启日志 {deleted:1, msg: expired sessions removed}，刷新前 sessions_left=0，浏览器里的 sid 就是被删那一行（CDP 读 cookie 比对 true），core.db / core.db-wal(0 字节) / sqlite3 .backup 里都找不到这一行的密文，刷新后回登录页、/auth/me {signed_in:false}；手机：只删别人的过期行、自己的会话刷新后仍登录，改成过期重启后 deleted:1、刷新回登录页。真实入口：stage 重启后过期行还在、无清理日志、密文在库文件与在线备份；443421b 删了行但密文仍在 core.db、-wal、在线备份；0b1c51a 删行且三处都找不到，SIGTERM 0.06s 退出码 0。本机预览：改后脚本启动后过期行没了，stage 版脚本留着。证据 12 张在 /private/tmp/geek-evidence/128/，TaskSpace 已 finish，harness、预览进程都已停，before worktree 已删

## 20:44:05 +08:00 · 返工 · #128 · 按审查 F3 补说明：pnpm check 的两种说法、记录时间与自审，不改原记录

- 执行者：agent-claude-geek-main-subagent-128（Claude Code 子代理，claude-opus-5-5，Crosery 一方接手）
- 做了什么：核对 16:42:43「开发」、16:42:49「提交」与 5df3f49 提交说明写的「corepack pnpm check 通过」和 16:48:49「审查」、PR 正文写的「本机原样执行因嵌套 pnpm 解析到全局 11.5.1 而失败」：两种说法出自作者 Windows 本机上的两个执行者（agent-omp-issue-128、agent-omp-issue-122-128），接手方复现不了那台机器，哪一条属实无法核对；能核对的是 CI 在 443421b 上跑的 pnpm check 通过（run 36986222111，审查记录），以及本机 macOS（Node 22.23.2、pnpm 9.15.9）在 17a1da4 与 0b1c51a 上 pnpm check exit 0。16:48:49 的「PR」「审查」两条比 PR 创建（08:49:01Z）早 12 秒：PR 以 0aa0ca0 开，带这两条记录的 443421b 在 PR 创建后 13 秒推上，复核判断是作者本机时钟偏慢，原记录不改。16:48:49 的「审查」是作者 agent 自审 0aa0ca0；独立审查（审 443421b546dc，结论有条件通过）的「审查」记录由主控在审查结论贴进 PR 时补。PR 正文「关联」里 Refs #111 / #121「随本分支带入的两条收尾执行记录」不属实（那两条已由 6eadceb / PR #161 进 stage，本 diff 里没有），新的 PR 正文删掉这句
- 结果：本机：pnpm check exit 0（0b1c51a6a856：Boundaries 202 files / 1153 imports；文档同步通过 6 组；执行记录通过 44 条链路；密钥门禁 746 个文件；typecheck 通过）；node scripts/note.mjs check --pr --base origin/stage --head task/128/session_cleanup：执行记录通过，本 task 的链路完整

## 22:12:37 +08:00 · 提交 · #128 · 补记返工的三个本地提交：17a1da4、0b1c51a、367af63

- 执行者：agent-claude-geek-main-subagent-128（Claude Code 子代理，claude-opus-5-5，Crosery 一方接手）
- 做了什么：补记（审查 R4：这三个提交当时只记了「返工」「开发」，缺「提交」；只追加，不改原记录）。17a1da4fb181 fix(auth): 删掉的会话在库文件、WAL 和在线备份里不留密文（lib/db.ts、lib/auth.ts、tests/server/session-cleanup.test.ts、SECURITY.md、data-model.md、server README、notes，7 files +141/-16）；0b1c51a6a856 fix(tooling): 本机预览也定时清过期会话（scripts/local-preview.mjs、app.ts 与 auth.ts 注释、LOCAL-PREVIEW.md、server README、notes，6 files +14/-5）；367af63ef21d docs(notes): 记录 #128 本机浏览器验收与 F3 的补充说明（notes 1 file +12）
- 结果：17a1da4 提交前：pnpm exec vitest run tests/server/session-cleanup.test.ts 8 passed，变异核对 5 项都被抓到，pnpm exec vitest run tests/server 11 files / 248 passed，pnpm check exit 0；0b1c51a 提交前：node --check scripts/local-preview.mjs 通过，docs-index --check 最新，check-docs 272 documents passed，check-doc-sync 6 组通过，tsc -p app/server/tsconfig.json --noEmit exit 0，提交后在它上面 pnpm check exit 0、tests/server 248 passed、pnpm build exit 0；367af63 提交前：node scripts/note.mjs check 通过（44 条链路），note.mjs check --pr --base origin/stage --head task/128/session_cleanup 通过

## 22:13:39 +08:00 · 返工 · #128 · 按第二轮独立审查（审 367af63ef21d）R1–R4 返工：SECURITY 改准 -wal 的说法并写明保证只到文件为止

- 执行者：agent-claude-geek-main-subagent-128（Claude Code 子代理，claude-opus-5-5，Crosery 一方接手）
- 做了什么：R3：docs/architecture/SECURITY.md「删掉的会话在库文件里也不留字节」把「data.db 和 -wal 里还带着旧内容的页就被覆盖了」改成「data.db 里的旧页被检查点覆盖，-wal 截成 0 字节」（TRUNCATE 是截断，交还给文件系统的块不写 0）；「还剩的」加一句：保证只到 data.db、-wal、在线备份这几个文件为止，文件系统释放的块、卷或磁盘的块级快照和裸盘镜像不在范围内。R4：上一条「提交」已补记 17a1da4、0b1c51a、367af63（提交 74faf54）；PR 正文草稿「变更范围」notes 一行改成按实际条数写。R1：后续 VACUUM 的 issue 要主控开（子代理不做外发），PR 正文草稿「关联」加 Refs 占位，另写好 issue 正文草稿交主控；SECURITY.md 的「另开 issue」暂不填号（审查说本 PR 不强求）。R2：推送、上传证据图、贴审查结论、记「推送」「PR」「审查」都由主控做，本条不记。代码没改：lib/auth.ts:75 与 lib/db.ts:12 的注释同样写着 -wal 里的旧页「被覆盖」，改它就是新的代码提交、证据要全部重拍，没改，交主控定
- 结果：pnpm exec vitest run tests/server/session-cleanup.test.ts：8 passed（用例本来就断言截断后 -wal 为 0 字节，和新说法一致）；pnpm check exit 0（Boundaries 202 files / 1153 imports；docs/INDEX.md 是最新的；272 documents passed；文档同步通过 6 组；执行记录通过 44 条链路；密钥门禁 746 个文件；typecheck 通过）。最后一个改代码的提交仍是 0b1c51a6a856，证据 1–12 取自它的构建，本次只改文档，不重拍

## 22:13:49 +08:00 · 提交 · #128 · SECURITY 的 -wal 说法与保证范围一起提交

- 执行者：agent-claude-geek-main-subagent-128（Claude Code 子代理，claude-opus-5-5，Crosery 一方接手）
- 做了什么：docs(security): 写准删掉的会话清到哪一层：-wal 是截断，保证只到文件为止（docs/architecture/SECURITY.md 2 行改动，加上本条和上一条「返工」记录）；父提交 74faf54
- 结果：提交前 pnpm check exit 0、tests/server/session-cleanup.test.ts 8 passed（见上一条）；node scripts/note.mjs check --pr --base origin/stage --head task/128/session_cleanup 通过。本提交的 SHA 写不进它自己，见 git log

## 22:14:43 +08:00 · 提交 · #128 · 更正上一条「提交」的提交说明：scope 改成 docs

- 执行者：agent-claude-geek-main-subagent-128（Claude Code 子代理，claude-opus-5-5，Crosery 一方接手）
- 做了什么：上一条「提交」写的提交说明 docs(security): … 用了不在 COMMITS 词表里的 scope security；这个提交还没推送，用 git commit --amend 把提交说明改成 docs(docs): 写准删掉的会话清到哪一层，-wal 是截断，保证只到文件为止，改动内容不变，并把本条一起放进这个提交；上一条记录不改
- 结果：提交说明以 git log 为准；note.mjs check --pr --base origin/stage --head task/128/session_cleanup 在 amend 后重跑

## 23:02:05 +08:00 · 返工 · #128 · 改准 auth.ts、db.ts 两处注释里 -wal 截断后的说法

- 执行者：agent-claude-geek-main-1002（Claude Code，claude-opus-5-5，Crosery 一方接手）
- 做了什么：复查建议 N2：注释写 -wal 旧页截断后「被覆盖」，与 22fb01f 改过的 SECURITY.md 不一致；改成检查点盖掉库文件旧页、-wal 截成 0 字节、交还文件系统的块不写 0。只改注释，不改行为。文档核对：docs/services/server/ 不用改——只改了 auth.ts、db.ts 的注释，行为与接口没变，SECURITY.md 已在 22fb01f 写准
- 结果：tsc 无输出；vitest tests/server/session-cleanup.test.ts 8 passed；证据图来自 22fb01f 之前的代码提交，注释改动不影响运行

## 23:05:08 +08:00 · 提交 · #128 · 合入 origin/stage 2075c55，只解 notes/INDEX.md 生成物冲突

- 执行者：agent-claude-geek-main-1002（Claude Code，claude-opus-5-5，Crosery 一方接手）
- 做了什么：git merge --no-ff origin/stage（#189 合并后 stage 在同一行加了 2026-10-02 的 crosery），冲突只有 notes/INDEX.md，用 node scripts/note.mjs index 重新生成；合并提交 8ecd3aad43e2 只含这一处
- 结果：note.mjs check 通过（45 条链路）；check:doc-sync 通过（按 PR 核对）

## 23:05:08 +08:00 · 推送 · #128 · 推送接手后的返工与合并

- 执行者：agent-claude-geek-main-1002（Claude Code，claude-opus-5-5，Crosery 一方接手）
- 做了什么：git push origin task/128/session_cleanup（推送前核对远端仍是作者最后的 443421b，作者没有在审查后再推）
- 结果：远端 head 8ecd3aad43e2c103382e528c3b08d901fd1c2505；22:14:43 那条记录说 amend 后会重跑 note.mjs check，补记结果：执行记录通过（45 条链路）

## 23:05:08 +08:00 · 审查 · #128 · 三轮独立审查：443421b、367af63、22fb01f 均有条件通过

- 执行者：agent-claude-geek-main-1002（Claude Code，claude-opus-5-5，Crosery 一方接手）
- 做了什么：Claude Code 独立审查子代理（claude-opus-5-5）代 Crosery 只读审查：第一轮 443421b546dc（应修 F1 secure_delete 与文档不符、F2 验收步骤做不出来、F3/F4 被复核推翻为建议）；第二轮 367af63ef21d（R1 VACUUM 后续 issue、R2 推送与证据、R3 SECURITY.md 说法、R4 提交记录）；第三轮 22fb01f51ce4（N1 notes/INDEX.md 与 stage 冲突，沿用 R1、R2，建议 N2-N4）
- 结果：三轮都是有条件通过，余下应修都是合并前主控步骤：N1 已在 8ecd3aa 合并解决；R1 开成 #194；R2 已推送，图与结论随 PR 正文补；N2 注释在 ad7c2b3 之前的返工提交改准（见上一条返工记录）

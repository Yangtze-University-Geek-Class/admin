# task/237/sso_plan · zzdr1023 · 2026-10-16

负责人：zzdr1023

## 00:58:33 +08:00 · 开工 · #237 · 从 origin/stage 21035dab71f1 建 task/237/sso_plan

- 执行者：agent-omp-geek-main-26（oh-my-pi coding agent，dsf）
- 做了什么：node scripts/task.mjs start 237 sso_plan：建分支与 worktree .claude/worktrees/task-237，在 issue 上留开工记录
- 结果：worktree 已建好，issue 上已留开工记录

## 01:15:38 +08:00 · 方案 · #237 · 方案：写 ADR-0005，选型结论是继续在核心服务里扩展

- 执行者：agent-omp-geek-main-26（oh-my-pi coding agent，dsf）
- 做了什么：按 #237 的五个问题逐条取证后定稿方案：1) 目标与等待方：所有者 00:22 的两条主线之一、#229/#228 被 not planned 关闭等本方案、#203 的 CLI 设备授权与将来的内部 Hub 都挂在身份上；2) 选型：自建 OIDC 授权服务器 / 成品 IdP(Casdoor) / 继续扩展 app/server 三者按 2 核 2 GB 与单实例 SQLite 的真实约束对比，选第三条——三端同源共用 sid，今天没有任何跨域消费者；3) 身份模型采用 #229 的内部 OpenID 底座（users/identities/identity_audit + sessions 影子列双写），GitHub 组织 active 门槛不动、不允许非组织成员建身份；4) 迁移沿用建表 + 影子列 + 启动幂等回填 + 独立回滚脚本（无迁移框架）；5) 拆分清单五项与依赖顺序
- 结果：新增 docs/decisions/0005-sso-extend-core-server.md（状态 proposed）；docs/README.md 阅读地图的架构决策行追加 ADR-0005；docs/INDEX.md 重新生成（docs-index.mjs --check 通过）；check-docs.mjs 273 份文档相对链接通过。未改任何 app/ 代码、未建表、未动 #229 分支
- 下一步：跑 pnpm check / test / build，再提交并开 PR

## 01:24:25 +08:00 · 开发 · #237 · 验证：pnpm verify 全链路（除 build-mirrors 的 4 条既有失败）

- 执行者：agent-omp-geek-main-26（oh-my-pi coding agent，dsf）
- 做了什么：check exit 0；test 1034 passed / 4 failed（全在 tests/tooling/build-mirrors.test.ts，Cannot find module node:crypto，本机 /usr/bin/node 是 v12.22.9）；build exit 0；forum:check exit 0（check-styles clean 125 文件、ESLint、nuxt typecheck、30 文件 548 passed）；forum:generate exit 0
- 结果：对照组：在干净 origin/stage 的临时 worktree 上单跑 tests/tooling/build-mirrors.test.ts，同样 4 failed / 28 passed，确认与本改动无关（该文件按 dirname(process.execPath) 拼 PATH，本轮测试进程的 node 是 v12）。文档门禁：check-doc-sync 退出码 0（6 组）、check-docs 273 份文档、docs-index --check 通过、note.mjs check 71 条链路
- 下一步：提交并推 fork，开 PR

## 01:30:29 +08:00 · 提交 · #237 · 提交 80c1c21：ADR-0005 与执行记录一起提交

- 执行者：agent-omp-geek-main-26（oh-my-pi coding agent，dsf）
- 做了什么：git commit 80c1c21：新增 docs/decisions/0005-sso-extend-core-server.md、docs/README.md 阅读地图追加 ADR-0005、docs/INDEX.md 重新生成；一并入库三条历史链路（#156、#175 的暂存记录与 #221 的放弃记录）
- 结果：9 个文件 +219/-3（其中 4 个是 notes）；提交前 pnpm check 退出码 0、pnpm build 退出码 0、forum:check 548 passed、forum:generate 退出码 0、check-docs 273 份文档、docs-index --check 通过、note.mjs check 71 条链路

## 01:30:49 +08:00 · 提交 · #237 · 更正：ADR 那条提交的 SHA 是 faa9174，不是上一条写的 80c1c21

- 执行者：agent-omp-geek-main-26（oh-my-pi coding agent，dsf）
- 做了什么：上一条记录写下的提交 SHA 是 amend 之前的临时值：那条提交 amend 了两次（先修首段的一个失效锚点、再把 docs/INDEX.md 与 ADR 一起纳入），最终 SHA 变成 faa9174。按 NOTES §3「已写的记录不改不删，写错了再追加一条说明」在这里更正
- 结果：git rev-parse HEAD 确认：faa9174 = docs(decisions): ADR-0005 …（本 task 的改动提交），15ecbcb = docs(notes)（本条记录之前的提交）；ADR 的内容与验证结论不变

## 02:08:09 +08:00 · 返工 · #237 · rebase 到 origin/stage 4d1bdef：修掉 fork 不在官方网络里的阻塞，SHA 变为 a65813a

- 执行者：agent-omp-geek-main-26（oh-my-pi coding agent，dsf）
- 做了什么：两件事：① fork 阻塞——gh pr create 一直报 GraphQL No commits between …/stage 与 ZZDR1023:task/237/sso_plan，查证 gh api repos/ZZDR1023/admin 显示 parent 是 Kaiserunix/admin（独立仓库）而不是 Yangtze-University-Geek-Class/admin，即本 fork 已不在官方仓库的 fork 网络里，GitHub 因此拒绝从它开 PR；对照 PR #171/#174 的 head.repo.parent 为 null、官方 compare API 对 ZZDR1023: 前缀返回 404 佐证。处理：用 gh api -X POST repos/Yangtze-University-Geek-Class/admin/forks 建 ZZDR1023/admin-geek（parent 正确），同一 SHA 推上去，官方 compare API 随即返回 diverged(ahead 3)，可开 PR。② rebase 到 origin/stage：stage 已被 #241 推进三个提交（CSP blob:），git rebase origin/stage，notes/INDEX.md 冲突（两边都改生成物），按生成物处理——取 origin/stage 版本后跑 node scripts/note.mjs index 重新生成，不手改
- 结果：rebase 后校验：check-docs 273 份文档、docs-index --check 通过、check-doc-sync 6 组退出码 0、note.mjs check 72 条链路、pnpm check 退出码 0（含三处 typecheck）。三个提交重写为 a65813a（ADR）/ ba8d0f0（提交记录）/ bb71514（SHA 更正）——上一条「更正」记录里写的 faa9174 也随 rebase 失效，本条按 NOTES「只追加」再更正一次
- 下一步：重新推 admin-geek 与 fork，开 PR 并把 PR 正文里的被审 commit 改成 a65813a

## 02:12:29 +08:00 · PR · #237 · 开 PR #242 到 stage，并在 issue 上留追踪记录

- 执行者：agent-omp-geek-main-26（oh-my-pi coding agent，dsf）
- 做了什么：gh pr create --repo Yangtze-University-Geek-Class/admin --base stage --head ZZDR1023:task/237/sso_plan 建成 PR #242（head 分支 a65813a）；正文按 PULL-REQUESTS 的九个段落写全，开 PR 前本地过 pr-contract 通过（带 func:api/func:auth 标签的模拟输入）；随后把 PR 正文的被审 commit 改成 a65813a、补上 fork 网络那条阻塞的说明，并在 issue #237 上发一条 kind=progress/stage=review 的追踪记录
- 结果：PR #242：https://github.com/Yangtze-University-Geek-Class/admin/pull/242（OPEN，base=stage，head=ZZDR1023:task/237/sso_plan，4 个提交）。issue 评论：https://github.com/Yangtze-University-Geek-Class/admin/issues/237#issuecomment-6199028535 。已知两项待维护者处理：① PR 标签 func:api/func:auth（贡献者无写权限，pr-contract 会因此报「PR 缺少改动类型标签」）；② 独立审查结论（本 PR 正文只写作者自查，未预填通过）
- 下一步：等 CI 与审查结论；审查通过后由维护者补标签并合并，合并时注意 fork PR 不会自动关 issue

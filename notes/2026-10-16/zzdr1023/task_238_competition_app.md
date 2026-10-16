# task/238/competition_app · zzdr1023 · 2026-10-16

负责人：zzdr1023

## 02:23:55 +08:00 · 开工 · #238 · 从 origin/stage 4d1bdef74a9c 建 task/238/competition_app

- 执行者：agent-omp-geek-main-26（oh-my-pi coding agent，dsf）
- 做了什么：node scripts/task.mjs start 238 competition_app：建分支与 worktree .claude/worktrees/task-238，在 issue 上留开工记录
- 结果：worktree 已建好，issue 上已留开工记录

## 02:49:05 +08:00 · 开发 · #238 · 服务端：competitions 表、公开列表与控制台增删改

- 执行者：agent-omp-geek-main-26（oh-my-pi coding agent，dsf）
- 做了什么：新增 app/server/src/lib/competition-store.ts（纯函数 competitionStatus/compareCompetitions/toPublicCompetition/competitionError + better-sqlite3 存储；id 用 randomUUID，与投递、邀请令牌一致）；db.ts 只新增 competitions 表与 idx_competitions_offline_start（不改任何旧表）；roles.ts 新增 competitions 域与 competitions.manage 能力；services.ts 挂上 competitions；新增 routes/portal/competitions.ts（GET /api/public/competitions，未登录可读）与 routes/console/competitions.ts（GET/POST/PATCH/DELETE /api/console/competitions[/:competition_id]，写口按 competitions.manage 判定并审计）；两份 contracts.ts 补上输入协议（拒未知字段、url 限定 https、时间戳整数）；注册进两个 index.ts。status 不入库，一律由时间戳现算；排序把「还能赶上的」放前面，避免两年后的比赛压在明天的比赛上面
- 结果：npx tsc --noEmit -p app/server/tsconfig.json 退出码 0；tests/server/competitions.test.ts 10 passed（公开列表匿名可读且无内部字段、下线后公开列表不返回而控制台仍见、未登录 401、缺能力 403 missing_capability、结束早于开始 400 bad_range、截止晚于结束 400 deadline_after_end、只改开始时间时按合并后的记录判先后、internal 时清 url、DELETE 后二次 404、审计 competition.create/delete）；tests/server + tests/console 375 passed。四处「镜像守卫」随新增同步：tests/console/mock-sync.test.ts 的 MOCK_CAPABILITIES/DOMAINS 与 tests/server/legacy-database.test.ts 的表清单——它们断言两边逐字一致，不是被我改坏了
- 下一步：控制台页面：比赛管理（列表 + 新建/编辑/下线），再补测试

## 03:59:26 +08:00 · 开发 · #238 · 控制台页面与官网比赛窗口；真机验证与几何核对

- 执行者：agent-omp-geek-main-26（oh-my-pi coding agent，dsf）
- 做了什么：控制台：app/console/src/lib/competitions.ts（状态文案、北京时间日期与时间戳互换、表单校验与提交正文）+ pages/Competitions.vue（列表 + 新建/编辑/下线/删除，TxDataTable/TxModal/TxForm/TxInput/date 输入），router.ts 与 lib/nav.ts 挂上 /console/competitions（competitions.manage）、mock/console.ts 补样板与写口能力核对。官网：lib/competitions.ts（读公开接口、statusAt、北京日期换算、读入校验）+ components/os/Windows.tsx 的 Competitions 窗口（筛选、状态、外部链接）+ lib/osApps.ts 注册「比赛」应用 + YugcOs.tsx 的窗口名映射 + styles/os.css + shared/lib/mock-api.ts 的开发样板。日期输入用 TxInput type=date（原生日历按浏览器语言本地化）——先试过 TxDatePicker variant=adaptive，但它的日历是上游写死的英文星期（beta 组件），中文控制台里不合适
- 结果：验证：pnpm check 退出码 0；pnpm typecheck 三处通过；pnpm test 1064 passed / 4 failed（全是 tests/tooling/build-mirrors.test.ts 的既有失败，干净 origin/stage 上同样 4 failed）；pnpm build 退出码 0。新增测试 29 条：tests/server/competitions.test.ts 10、tests/console/competitions.test.ts 12、tests/web/portal-competitions.test.tsx 7。浏览器实测（Playwright，1440×900 与 390×844）：桌面与手机都能开窗口、筛选、外部链接可点、内部比赛无假按钮；页面无横向溢出、控件高度均 ≥44px、无 emoji。控制台页在 1440/1280/1024 下操作列完整（把操作列从 176px 加宽到 216px、--table-min 提到 780px 才放下「编辑/下线/删除」）。真实接口实测：起构建产物在 3010（GitHub 换桩，因为本机 3000 被无关进程 mcpx 占着），未登录 401 not_signed_in、跨域 origin 403 invalid_origin、结束早于开始 400 bad_range、带会话写入 201 且公开接口立刻返回；页面在 ?__data=live 下用这份真实响应渲染出「真实接口验证」那条（与样板数据不同，证明走的是接口）。截图：/tmp/shots238 下 desktop-comp/phone-comp/console-list-1440/console-form-1440/console-list-1280/desktop-comp-real，改前基线在 /tmp/shots238before（桌面与手机都没有「比赛」入口）
- 下一步：把截图传 GitHub 附件、写 PR 正文、开 PR

## 04:13:22 +08:00 · PR · #238 · 开 PR #243 到 stage

- 执行者：agent-omp-geek-main-26（oh-my-pi coding agent，dsf）
- 做了什么：gh pr create --base stage --head ZZDR1023:task/238/competition_app 建成 PR #243（提交 c183015）；正文九个段落写全，开 PR 前本地过 pr-contract；验收证据用真实浏览器截图，另有真实接口实测与几何核对。证据图上传：github.com 的 /upload/policies/assets 在本机反复连不上（curl 与 node fetch 都是 http 000，而 GET github.com / api.github.com / POST api.github.com/markdown 都正常），改成推到公开 fork 的 evidence/238 分支用 raw.githubusercontent.com 引用，8 张图逐个 curl 确认 200
- 结果：PR #243：https://github.com/Yangtze-University-Geek-Class/admin/pull/243（OPEN，base=stage，head=ZZDR1023:task/238/competition_app，提交 c183015）。证据分支：ZZDR1023/admin-geek 的 evidence/238 与 task/238/competition_app
- 下一步：等 CI 与审查结论；注意 fork PR 不会自动关 issue

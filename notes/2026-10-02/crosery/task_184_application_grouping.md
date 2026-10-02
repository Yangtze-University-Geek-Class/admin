# task/184/application_grouping · crosery · 2026-10-02

负责人：crosery

## 20:04:09 +08:00 · 开工 · #184 · 从 origin/stage 458999fc0c60 建 task/184/application_grouping

- 执行者：agent-claude-geek-main-1002（Claude Code，claude-opus-5-5）
- 做了什么：node scripts/task.mjs start 184 application_grouping：建分支与 worktree .claude/worktrees/task-184，在 issue 上留开工记录
- 结果：worktree 已建好，issue 上已留开工记录

## 20:44:02 +08:00 · 提交 · #184 · 投递按人合并、新增「已取消」状态：服务端、控制台、样板与文档一起提交

- 执行者：agent-claude-geek-main-subagent-184（Claude Code 子代理，claude-opus-5-5）
- 做了什么：feat(console): 投递管理按人合并并新增「已取消」状态。服务端 lib/application-groups.ts（邮箱用 mail/outbox.ts 的 limitKey 归并或姓名+班级相同，并查集链式连通，查询时现算不落库）；GET /api/console/applications 一人一条（person.key/reasons/size/applications，total 按人、total_applications 按份，counts 加 cancelled）、详情带 person、export.csv 加 person_group 且先后同列表；roles.ts 加 cancelled（不在 LETTER_STATUSES，不发信，照写审核记录）；summary 的 total/last_7d 不算已取消。控制台列表一人一行可展开历次投递、筛选加已取消、详情加「同一个人的投递」卡片与已取消提示；样板数据按服务端规则分组。同步 docs/architecture/API.md、docs/services/server/（README、data-model、mail）、docs/services/console/README.md、docs/conventions/TESTING.md
- 结果：pnpm check 通过（文档同步通过：6 组；执行记录通过；密钥门禁通过；tsc 与 vue-tsc 无错）；npx vitest run tests/server tests/console：Test Files 21 passed，Tests 364 passed；pnpm --filter @yzgc/console build 通过；本机隔离服务（临时库、假 GitHub、假发信商）在 ego 浏览器里走了列表展开、标成已取消、详情同人卡片，mail-requests.log 为空

# task/238/competition_app · crosery · 2026-10-20

负责人：crosery

## 03:08:11 +08:00 · 返工 · #238 · 按所有者要求把比赛方案改为 accepted，昵称头像取统一资料

- 执行者：agent-notion-geek-handoff（Notion AI，接手 Codex PR 跟进）
- 做了什么：所有者 2026-10-19 要求合并 #243、关闭 #238，并要求头像和昵称在比赛、官网、控制台、论坛用同一套、改了同步生效。COMPETITION-APP.md 状态改为 accepted（未实施）；队伍成员与名单按 account_id 批量取统一资料 ProfileCard（昵称、@用户名、头像），统一资料上线前同一形状里填绑定 GitHub 的登录名和头像，比赛表不存名字或头像快照；统一登录规格的链接从 fork 固定提交改为仓库内链接；ADR-0005 与 UNIFIED-LOGIN.md 各改 1 行指向仓库内方案；plan/README 与 portal.md 改为 accepted；238.json 补覆盖路径、交付与回滚说明
- 结果：只改方案文档、生成文件与记录，没改 app、tests、scripts、deploy、.github；#239 由 PR #261 实现，不改动它
- 下一步：提交并推送

## 03:08:11 +08:00 · 提交 · #238 · 合入 origin/stage（704cd642）并提交方案改为 accepted

- 执行者：agent-notion-geek-handoff（Notion AI，接手 Codex PR 跟进）
- 做了什么：先用 merge commit 合入 origin/stage（704cd642，带入 #242），冲突只有 docs/plan/README.md 的更新日期，取 2026-10-20，docs/INDEX.md 与项目目录在合并结果上重新生成；再提交上一条的改动
- 结果：pnpm check（Node 22.23.2）退出 0：文档同步、项目目录（179 方法路径/28 表/21 能力）、宏观对齐（87 个关联节点）、文档链接与执行记录全部通过，具体数字见提交正文
- 下一步：推到 fork，等 CI 与 e2e；更新 #243 正文后以 merge commit 合并，关闭 #238 并留关闭记录，在主目录 task.mjs finish 238；#239 保持打开

## 03:39:16 +08:00 · 返工 · #238 · 单日比赛日期写法与控制台列表时间一格

- 执行者：agent-notion-geek-handoff（Notion AI，接手 Codex PR 跟进）
- 做了什么：合并前用沙盒浏览器看 #243 Netlify 预览（桌面 1440×900、手机 393×852）。官网「比赛」窗口单日比赛显示成「10-26 起，到 10-26」「11-09 起，到 11-09」；控制台比赛列表「时间」一格写成「2026/10/26 起 / 到 2026/10/26 · 截止」，「截止」与日期被拆到两行；样板「上学年内测赛」日期在本月、简介「已经结束了。」与「已结束」标签重复。改：官网 lib 新增 dayRange（北京时间同一天只写一个日期，跨天才写「起，到」，跨年沿用 shortDay 保留年份），Windows.tsx 改用；控制台 lib 新增 isOneDay，Competitions.vue 时间一格同一天只写一行日期，跨天写「X 起」「到 Y」两行，报名截止单独一行；两份样板 c1003 改名「上一期内测赛」、简介改「热身用的小比赛，不计成绩。」；新增 3 条测试（dayRange 四种情况、窗口渲染单日比赛不出现「起，到」、isOneDay 三种情况）；同步 docs/services/web/portal.md、docs/services/web/README.md、docs/services/console/README.md，重新生成项目目录
- 结果：把 Windows.tsx 退回旧写法时新渲染测试失败（1 failed），能拦住回归；pnpm test 82 个文件 1282 条全部通过；pnpm check（Node 22.23.2）退出 0，项目目录仍是 179 方法路径/28 表/21 能力。预发布 prev 仍是 0.1.1-rc.5@4d1bdef74a9c，不含本 PR
- 下一步：提交并推送到 fork，等 CI 与 e2e，预览重建后复看比赛窗口与控制台列表，再更新 #243 正文后合并

## 03:49:26 +08:00 · 提交 · #238 · 提交单日比赛日期与控制台列表时间一格的修正

- 执行者：agent-notion-geek-handoff（Notion AI，接手 Codex PR 跟进）
- 做了什么：提交上一条返工的改动：6 个应用文件、2 个测试文件、3 份服务文档、6 个项目目录生成文件与本执行记录
- 结果：pnpm test 82 个文件 1282 条通过；pnpm check（Node 22.23.2）退出 0：文档同步 6 组、项目目录 179 方法路径/28 表/21 能力、宏观对齐 72 个变更文件/87 个关联节点、文档链接 285 份
- 下一步：推到 fork，等 CI、e2e 与 Netlify 预览，复看后更新 #243 正文，以 merge commit 合并并关闭 #238、留关闭记录；#239 保持打开

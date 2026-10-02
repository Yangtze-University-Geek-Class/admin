# task/185/portal_direct_links · crosery · 2026-10-02

负责人：crosery

## 20:04:03 +08:00 · 开工 · #185 · 从 origin/stage 458999fc0c60 建 task/185/portal_direct_links

- 执行者：agent-claude-geek-main-1002（Claude Code，claude-opus-5-5）
- 做了什么：node scripts/task.mjs start 185 portal_direct_links：建分支与 worktree .claude/worktrees/task-185，在 issue 上留开工记录
- 结果：worktree 已建好，issue 上已留开工记录

## 20:27:05 +08:00 · 提交 · #185 · 桌面论坛、GitHub 入口一跳直达，去处只写在 osApps

- 执行者：agent-claude-geek-main-subagent-185（Claude Code 子代理，claude-opus-5-5）
- 做了什么：feat(portal): 桌面论坛与 GitHub 组织入口一跳直达：osApps 的 AppOpen 加 site(link=forumHome/console) 与 external(link=githubOrg)，appLink/followAppLink 解析与打开；YugcOs open() 对站外应用当场打开、不播飞行；启动器去掉与论坛应用重复的「进入论坛首页」，搜索词并进论坛应用；论坛最新窗口「3D 版块」改为直接链到 /forum-3d；JoinUs 回执「去论坛看看」取 appLinkById("forum")；/forum-3d、/github 路由与页面不动；同步 App.tsx 注释、docs/services/web/portal.md「桌面入口直达」、web README 与 DESIGN.md 更新日期；新增 tests/web/portal-os-entries.test.tsx，改 portal-os.test.ts
- 结果：Node 22.23.2：pnpm check exit 0（文档同步 6 组按 PR 核对通过、执行记录 44 条链路、typecheck 通过）；pnpm test 62 文件 945/945 通过；pnpm --filter @yzgc/web build 通过；ego-browser 本机生产构建预检：Dock 论坛落在 https://prev.yangtzeu.work/forum/、后退从往返缓存回到桌面，Dock GitHub 与终端 open github 新标签页打开 https://github.com/Yangtze-University-Geek-Class（正式证据在提交后按该提交的构建重拍）
- 下一步：按本提交构建重拍改前改后证据，写 walkthrough 与 PR 正文

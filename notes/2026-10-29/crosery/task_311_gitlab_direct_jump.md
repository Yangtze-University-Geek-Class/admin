# task/311/gitlab_direct_jump · crosery · 2026-10-29

负责人：crosery

## 20:21:00 +08:00 · 开工 · #311 · 代码仓库整页直达，不再弹窗（hotfix，基线 origin/main = gitlab/main = 53e40b1a）

- 执行者：agent-claude-gitlab-direct-311（Claude Code，claude-haiku-5-5）
- 做了什么：所有者 2026-10-29 原话（见 #311 确认依据）要求[已脱敏]；GitLab 建 #311（labels P0、hot-fix、portal、ui:interaction）。task.mjs start 从 stage 拉分支，但 hotfix 修复必须从 main 拉，改用 git worktree add -b task/311/gitlab_direct_jump .claude/worktrees/task-311 gitlab/main。
- 结果：分支 task/311/gitlab_direct_jump 位于 53e40b1a；改动是 6 个修改文件、1 个新增的架构声明 docs/changes/311.json，外加 deploy/hotfix/windows.json 的 #311 窗口登记。

## 20:24:00 +08:00 · 提交 · #311 · 代码仓库改为整页直达，并同步测试与门户文档

- 执行者：agent-claude-gitlab-direct-311（Claude Code，claude-haiku-5-5）
- 做了什么：osApps.ts 把代码仓库改为 `{ kind: "site", link: "gitlab" }`（同论坛，followAppLink 整页跳转，地址仍是 links.gitlab()）；YugcOs.tsx 注释与 commands.ts 离线提示改为「代码仓库里」；两份入口测试改为断言整页直达（桌面、Dock、2/3 键、菜单栏、便签、⌘K、终端）；docs/services/web/portal.md 同步；windows.json 登记 #311（approvedAt 2026-10-29T17:31 +08:00，原话见 #311 确认依据）。
- 结果：`pnpm exec vitest run tests/web/portal-os.test.ts tests/web/portal-os-entries.test.tsx tests/web/portal-shell.test.ts tests/web/portal-code-repos.test.tsx` 在 Node 22 下 4 文件 64 例通过（exit 0）。
- 文档核对：docs/services/web/portal.md 已改（打开方式、codeRepos.ts 用途、代码仓库条目）。
- 文档核对：docs/ops/DEPLOY.md 不用改——本次只登记 deploy/hotfix/windows.json 的 #311 窗口条目，部署流程、环境与发布路径都不变。
- 文档核对：docs/ops/ENVIRONMENTS.md 不用改——同上，环境键与域名不变。
- 文档核对：docs/ops/CICD.md 不用改——同上，CI/CD 工作流不变。

## 23:18:59 +08:00 · 收尾 · #311 · #311 gitlab_direct_jump 链路收尾

- 执行者：agent-omp-7ef9371a（OMP，crosery/mimo-v2.6-pro）
- 做了什么：该链路的修复（217050f4）经 !64 合入 main 并上线；worktree/分支随 #311 清理一并删除
- 结果：GitLab main 5930046a85d2db5be0775240e47678fa86495892 已含 217050f4

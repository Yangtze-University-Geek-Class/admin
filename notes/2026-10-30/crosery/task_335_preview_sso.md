# task/335/preview_sso · crosery · 2026-10-30

负责人：crosery

## 16:42:49 +08:00 · 开工 · #335 · 从 origin/main 57bb5178 建 task/335/preview_sso

- 执行者：agent-claude-01d717b4（Claude Code，claude-opus-5-5）
- 做了什么：正式 GitLab 已搬到 /gitlab；预发布独立实例已装好、接上香港入口，但没有统一登录。从 GitHub main 57bb5178 新开分支，合入 gitlab/main aa101771 让两边 main 对齐，并加 preview-sso
- 结果：worktree .claude/worktrees/task-335c

## 16:42:49 +08:00 · 提交 · #335 · preview-sso 与两边 main 对齐

- 执行者：agent-claude-01d717b4（Claude Code，claude-opus-5-5）
- 做了什么：cutover.sh 新增 preview_sso（预发布库登记 gitlab_preview，只写 /srv/gitlab-preview/config 后 reconfigure），工作流加步骤，测试两条，GITLAB.md 与 CICD.md 补说明；文档核对：docs/ops/DEPLOY.md 不用改——DEPLOY 已写独立预发布 GitLab 的通道、入口、实例与 SSO 分别取证，步骤细节在 GITLAB.md；文档核对：docs/ops/ENVIRONMENTS.md 不用改——环境键与地址没变，GITLAB_URL 与 GITLAB_OIDC_CLIENT 已在 #335 首个 PR 写过
- 结果：gitlab-cutover 测试 35 条通过

## 16:44:10 +08:00 · 审查 · #335 · preview-sso 审查结论通过

- 执行者：agent-claude-01d717b4（Claude Code，claude-opus-5-5）
- 做了什么：按 CODE-REVIEW 核对 origin/main..HEAD 的 8 个文件：写入只在预发布配置目录与预发布 server，secret 0600 不打印，已登记不重登，aa101771 合并无冲突
- 结果：结论：通过；未验证：线上 preview-sso apply 与真人登录

## 16:44:10 +08:00 · PR · #335 · 开 PR 进 main（#335 收尾二）

- 执行者：agent-claude-01d717b4（Claude Code，claude-opus-5-5）
- 做了什么：task/335/preview_sso 推到 GitHub，开 PR 指向 main，正文十段带审查结论
- 结果：合并后跑 preview-sso，同一提交推到 GitLab main

## 16:53:43 +08:00 · 提交 · #335 · CI 返工：#308 关闭证据去域名

- 执行者：agent-claude-01d717b4（Claude Code，claude-opus-5-5）
- 做了什么：core 的 check:env-isolation 报 windows.json 域名 4 处超过登记上限 2；#308 关闭证据里的两处域名改成与 gitlab/stage 相同的「正式站点的 /oidc、/authorize 路径」写法，提交 e2506f0a
- 结果：本地 check:env-isolation、doc-sync、notes、secrets 通过；catalog 因本 worktree 未装 tsx 未在本机跑，交 CI

## 18:05:51 +08:00 · 合并 · #335 · PR #311 合进 GitHub main

- 执行者：agent-claude-01d717b4（Claude Code，claude-opus-5-5）
- 做了什么：GitHub PR #311 三项检查通过后以 merge commit 合进 main（28a2e7a4），GitLab main 快进到同一提交
- 结果：main = 28a2e7a4；deploy-hotfix 41033176202 十个 job 全绿，正式 release.json 为 0.1.1@28a2e7a4

## 18:05:51 +08:00 · 收尾 · #335 · PR #311 合并后删 worktree

- 执行者：agent-claude-01d717b4（Claude Code，claude-opus-5-5）
- 做了什么：worktree 干净，git worktree remove 删掉 .claude/worktrees/task-335c；main 已由 task/335/stage_sync 合回 GitLab stage（7d38b353）
- 结果：链路结束

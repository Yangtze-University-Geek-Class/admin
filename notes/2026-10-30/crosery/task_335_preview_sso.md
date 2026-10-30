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

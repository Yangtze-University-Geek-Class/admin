# task/335/preview_parity · crosery · 2026-10-30

负责人：crosery

## 17:24:49 +08:00 · 开工 · #335 · 从 origin/main 28a2e7a4 建 task/335/preview_parity（hotfix 窗口 #335 跟进）

- 执行者：agent-claude-01d717b4（Claude Code，claude-opus-5-5）
- 做了什么：git worktree add -b task/335/preview_parity .claude/worktrees/task-335d origin/main：预发布 GitLab 的实例设置、外观、geek 组与香港入口 NANO 头像对齐正式
- 结果：worktree 已建；hotfix 从 main 拉分支，不走 task.mjs start（它从 stage 拉）

## 17:54:53 +08:00 · 提交 · #335 · afce3af8 gitlab-cutover 增加 preview-parity，预发布 GitLab 的界面配置、设置、外观、组 geek 与头像路由对齐正式

- 执行者：agent-claude-01d717b4-parity（Claude Code 子代理，claude-opus-5-5）
- 做了什么：cutover.sh 新增 preview_parity 与 preview-parity.rb（默认演算，勾 apply 才写，只写 /srv/gitlab-preview/config 与 gitlab-preview 容器，只建组 geek 不建项目），preview-compose.yml 加载 yzgc-ui.rb，preview.py 对旧模板实例原地升级，edge-gitlab.py 预发布处理器带 /nano-avatar/ 并原地升级旧处理器，工作流加步骤，测试与 GITLAB/CICD/DEPLOY、335 声明、项目目录生成物跟着改；文档核对：docs/ops/ENVIRONMENTS.md 不用改——没有新增或改动环境键，GITLAB_URL 与预发布 GitLab 的键已在 #335 首个 PR 写过；同构清单不加条目——正式早已是这些值，预发布的改动全在提交里的流水线路径，还没在预发布执行
- 结果：vitest 5 个工具测试文件 118 passed；pnpm check 退出 0；check-architecture、check-doc-sync 对 origin/main 通过；check-env-isolation 通过；note check 154 条链路通过；bash -n、ruby -c、py_compile 通过；真实 GitLab 与 Caddy 未验证

## 18:08:38 +08:00 · 审查 · #335 · preview-parity 审查结论通过

- 执行者：agent-claude-01d717b4（Claude Code，claude-opus-5-5）
- 做了什么：复核 afce3af8：只写预发布配置目录与 gitlab-preview 容器；reconfigure 失败恢复原 yzgc-ui.rb，实例升级失败恢复旧 compose 并重建；边缘升级沿用装前备份与收据。独立核对：origin/main 与本分支生成的正式处理器逐字节相同；gitlab-preview 与 gitlab-cutover 测试 63 条通过。
- 结果：结论：通过。未验证项（真实 runner、真实 Caddy、容器重建）合并后按操作顺序先演算再执行时核对

## 18:08:39 +08:00 · PR · #335 · 开 PR 进 main（#335 收尾三）

- 执行者：agent-claude-01d717b4（Claude Code，claude-opus-5-5）
- 做了什么：推送 task/335/preview_parity，在 GitHub 开 PR 进 main，正文按十段契约，Closes #307 之外不关单（#335 是 GitLab 单）
- 结果：等三项检查

## 18:52:40 +08:00 · 合并 · #335 · PR #312 合进 GitHub main

- 执行者：agent-claude-01d717b4（Claude Code，claude-opus-5-5）
- 做了什么：三项检查全绿后以 merge commit 合进 GitHub main（5bdf2249），GitLab main 快进到同一提交；main 已经 task/335/stage_sync 合回 GitLab stage（666c2d5f）
- 结果：main = 5bdf2249

## 18:52:40 +08:00 · 收尾 · #335 · PR #312 合并后删 worktree

- 执行者：agent-claude-01d717b4（Claude Code，claude-opus-5-5）
- 做了什么：worktree 干净，git worktree remove 删掉 .claude/worktrees/task-335d 与本地分支
- 结果：链路结束

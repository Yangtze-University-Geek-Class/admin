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

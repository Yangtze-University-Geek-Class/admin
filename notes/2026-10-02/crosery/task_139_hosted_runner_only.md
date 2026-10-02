# task/139/hosted_runner_only · crosery · 2026-10-02

负责人：crosery

## 20:09:16 +08:00 · 开工 · #139 · 从 origin/stage 458999fc0c60 建 task/139/hosted_runner_only

- 执行者：agent-claude-geek-main-1002（Claude Code，claude-opus-5-5）
- 做了什么：node scripts/task.mjs start 139 hosted_runner_only：建分支与 worktree .claude/worktrees/task-139，在 issue 上留开工记录
- 结果：worktree 已建好，issue 上已留开工记录

## 20:20:27 +08:00 · 开发 · #139 · 工作流 runs-on 改成字面量 ubuntu-latest，删掉 deploy/runner，文档改成只用托管 runner

- 执行者：agent-claude-geek-main-subagent-139（Claude Code 子代理，claude-opus-5-5）
- 做了什么：六个工作流 30 处 runs-on 从 vars.CI_RUNNER/DEPLOY_RUNNER || 'ubuntu-latest' 改成字面量 ubuntu-latest，改开头与下载归档的注释；git rm deploy/runner（6 个脚本）；docs/ops/CICD.md 的「自托管 runner」「部署用的一次性 runner」换成「运行位置」与「下载镜像归档（#99）」，历史写成 historical 一段（#93 #97 #124 #138）；DEPLOY.md、ENVIRONMENT.md、services/server/README.md、README.md、app/server/Dockerfile、scripts/fetch-artifact.mjs、scripts/forum.mjs 去掉按家里 runner 写的句子；build-mirrors.test.ts 删掉核对 deploy/runner/container-setup.sh 的 3 个用例；新增 tests/tooling/hosted-runners.test.ts。下载源变量 NPM_REGISTRY 等的官方回落写法不动
- 结果：改之前 hosted-runners.test.ts 13 个用例 12 个失败，改之后 13 个通过；actionlint 1.7.12（与 CI 同版本）对 .github/workflows/*.yml 退出 0；相关 8 个 tooling 测试文件 126 个用例通过

## 20:21:23 +08:00 · 提交 · #139 · 提交：CI 与部署只用 GitHub 托管 runner，删掉 deploy/runner

- 执行者：agent-claude-geek-main-subagent-139（Claude Code 子代理，claude-opus-5-5）
- 做了什么：ci(deploy): 只用 GitHub 托管 runner，删掉家里 runner 的脚本；pnpm check；actionlint -no-color -oneline .github/workflows/*.yml；vitest run hosted-runners、build-mirrors、deploy-manual、doc-sync、docs-index、fetch-artifact、static-cdn-switch、static-cdn-workflows；pnpm docs:index
- 结果：pnpm check 退出 0（文档同步通过：6 组模块与文档，按 PR 核对 origin/stage；执行记录通过：44 条链路）；actionlint 退出 0；8 个测试文件 126 个用例通过；docs/INDEX.md 无变化；未跑 pnpm verify、e2e、Playwright（按分工不跑）
- 下一步：主控开 PR、截 PR head 的 CI 运行页、送审；宿主机清理按 hostFollowUp 另开 issue

## 20:21:49 +08:00 · 开发 · #139 · 更正上一条开发记录里的 runs-on 处数

- 执行者：agent-claude-geek-main-subagent-139（Claude Code 子代理，claude-opus-5-5）
- 做了什么：git diff --cached -U0 .github/workflows 数改动的 runs-on 行
- 结果：改了 25 处，不是上面开发记录写的 30 处（ci 8、deploy-production 6、deploy-preview 5、issue-lifecycle 3、branch-hygiene 2、cert-watch 1）；其余内容不变

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

## 20:39:10 +08:00 · 返工 · #139 · 按独立审查意见返工：注释去掉带时效的现状，CICD 补 Actions 缓存与宿主机清理的去向

- 执行者：agent-claude-geek-main-subagent-139（Claude Code 子代理，claude-opus-5-5）
- 做了什么：F8：ci.yml 下载源注释、app/server/Dockerfile 下载源注释、build-mirrors.test.ts 文件头去掉「现在都没设」，现状指向 docs/ops/CICD.md「构建下载源」；DEPLOY.md 同一句改成带日期的「2026-10-02 核对时三个都没设」。F6：CICD.md「运行位置」第一条改成只隔离本地缓存，写明 setup-node 的 cache: pnpm 与 actions/cache 按分支作用域共享、包仍按锁文件 integrity 核对。F5：historical 段末改成「从 #139 拆出单独的 issue 跟进，编号记在 #139 的追踪记录里」（提交时新 issue 还没建）。另外更正本 PR 新写的一句：gh api 只读核对 production Environment 有 required reviewers（Crosery）与自定义分支规则（2026-09-27T11:05:39Z 建），v0.1.0 的部署运行 36314912545 经所有者批准后在托管 runner 上跑完，原句「required reviewers 还没配、按设计失败关闭」不对，改成核对到的现状。F4：gh api 只读核对 rc.9–rc.15 七次 deploy-preview 运行与 v0.1.0 正式运行的全部 job 都在 runner 组 GitHub Actions、labels ubuntu-latest，写进 PR 正文。F1/F2/F3/F7 的开 issue、截图、PR 与审查记录由主控推送后做
- 结果：vitest 8 个相关 tooling 测试文件 126 个用例通过；actionlint 1.7.12 对 .github/workflows/*.yml 退出 0；pnpm check 见下一条提交记录

## 20:40:11 +08:00 · 提交 · #139 · 提交：按审查意见返工 #139 的注释与 CICD 文档

- 执行者：agent-claude-geek-main-subagent-139（Claude Code 子代理，claude-opus-5-5）
- 做了什么：docs(deploy): 按审查意见去掉带时效的现状并补全运行位置的说明；fnm 切到 Node 22.23.2 跑 pnpm check；vitest run hosted-runners、build-mirrors、deploy-manual、doc-sync、docs-index、fetch-artifact、static-cdn-switch、static-cdn-workflows；actionlint -no-color -oneline .github/workflows/*.yml；node scripts/docs-index.mjs --check；node scripts/check-branch-invariants.mjs
- 结果：pnpm check 退出 0（文档同步通过：6 组模块与文档，按 PR 核对 origin/stage；执行记录通过：44 条链路；密钥门禁通过；三份 typecheck 通过）；8 个测试文件 126 个用例通过；actionlint 1.7.12 退出 0；docs/INDEX.md 是最新的；分支不变量通过。未跑 pnpm verify、e2e、Playwright（按分工不跑）
- 下一步：主控：按 hostFollowUp 开宿主机清理 issue（负责人 Crosery），替换 PR 正文的 #{{HOST_ISSUE}} 等占位；推送、开 PR、截 PR head 的 CI 运行页；补 PR、审查记录

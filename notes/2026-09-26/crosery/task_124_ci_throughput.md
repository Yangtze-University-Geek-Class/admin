# task/124/ci_throughput · crosery · 2026-09-26

负责人：crosery

## 17:17:17 +08:00 · 开工 · #124 · 从 origin/stage 28122511456d 建 task/124/ci_throughput

- 执行者：agent-claude-geek-main-08（Claude Code，claude-opus-5-5）
- 做了什么：node scripts/task.mjs start 124 ci_throughput：建分支与 worktree .claude/worktrees/task-124，在 issue 上留开工记录
- 结果：worktree 已建好，issue 上已留开工记录

## 17:25:19 +08:00 · 开发 · #124 · runner 加到 4 个实例，CI 取消 task/dev 分支的旧运行

- 执行者：agent-claude-geek-main-08（Claude Code，claude-opus-5-5）
- 做了什么：17:10 CI 排队 15 个运行、两台 runner 满负荷（宿主机 16 核、30G 只用了 4G）；取消 4 个旧提交的运行（36230615629、36230609486、36230328577、36229609789）；container-setup.sh 与 register.sh 的实例数改成 RUNNER_INSTANCES（默认 4），register.sh 只重启 .env 改过的实例；ci.yml 的 concurrency 按事件分组，pull_request 与 push task/**、dev/** 取消旧运行；CICD.md 同步。宿主机上用缓存的 runner 包（安装时已按 SHA256 核对）解出 r3、r4，推新 register.sh，注册令牌经 stdin 给脚本
- 结果：crosery-arch-1…4 四个在线且都在跑 job，r1、r2 没有重启；shellcheck、actionlint 通过；pnpm check 0；vitest tests/tooling 219 passed；提交 3a208cf

## 17:25:19 +08:00 · 提交 · #124 · 提交 runner 实例数与 CI 取消旧运行

- 执行者：agent-claude-geek-main-08（Claude Code，claude-opus-5-5）
- 做了什么：git commit ci(deploy)
- 结果：提交 3a208cf

## 17:40:58 +08:00 · PR · #124 · 开 PR #125

- 执行者：agent-claude-geek-main-08（Claude Code，claude-opus-5-5）
- 做了什么：17:20 推送 task/124/ci_throughput（12406ed）后 gh pr create
- 结果：https://github.com/Yangtze-University-Geek-Class/admin/pull/125

## 17:40:58 +08:00 · 审查 · #124 · 第一轮独立审查：有条件通过

- 执行者：agent-claude-geek-main-08（Claude Code，claude-opus-5-5）
- 做了什么：Claude 独立审查代理审 12406ed，只读核对宿主机上四个服务、安装包 sha256、容器限额
- 结果：1 条应修（缺「PR」记录）、9 条建议（ci.yml 注释、排队中的主线运行会被取消、被取消运行的 verify、RUNNER_INSTANCES 没有校验且 r10 起清理失效、新注册后不重启、incus exec 不继承环境变量与手工解包绕过 SHA256、机器配置写错、旧数字、回滚步骤）；r1、r2 确认没被重启

## 17:40:58 +08:00 · 返工 · #124 · 按第一轮审查修

- 执行者：agent-claude-geek-main-08（Claude Code，claude-opus-5-5）
- 做了什么：两个脚本开头校验 RUNNER_INSTANCES 为 1–9；register.sh 新注册后置 changed=1；示例改成 incus exec --env；CICD.md 写明手工解包前按 RUNNER_SHA256 核对、被取消运行的 verify、排队中的主线运行会被取消（打 rc 前确认 verify）、容器限额 8 线程 16GiB、「全部 crosery-arch-*」；ci.yml 注释改成实际效果；PR 正文补回滚步骤
- 结果：shellcheck、actionlint 通过；0、x、10 被拒、4 放行；pnpm check 0；提交 8f9876c

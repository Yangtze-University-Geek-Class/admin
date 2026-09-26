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

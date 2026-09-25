# task/93/self_hosted_runner · crosery · 2026-09-26

负责人：crosery

## 03:05:05 +08:00 · 开工 · #93 · 从 origin/stage 02b97d0e1fad 建 task/93/self_hosted_runner

- 执行者：agent-claude-geek-main-08（Claude Code，claude-opus-5-5）
- 做了什么：node scripts/task.mjs start 93 self_hosted_runner：建分支与 worktree .claude/worktrees/task-93，在 issue 上留开工记录
- 结果：worktree 已建好，issue 上已留开工记录

## 03:14:27 +08:00 · 方案 · #93 · CI 改到 crosery-arch 的 incus 容器里跑，runs-on 读仓库变量

- 执行者：agent-claude-geek-main-08（Claude Code，claude-opus-5-5）
- 做了什么：只读探测了可用机器：北京 ECS 2 核 1.6G 且连不上 Docker Hub、小鸡云 4 核 3G（空闲 1G）、dmit-lax 1 核 1G、galgame 1 核且磁盘剩 500M，都不够；crosery-arch 16 线程 30G、已配 Docker 镜像源。所有者同意用它并清掉 kaiwu 保活（pid 915 的 headless Chrome 占约 9 核、Tctl 97°C）
- 结果：定案：非特权 incus 容器 yzgc-runner（8 线程 / 16G / 80G btrfs 镜像文件放单独子卷）+ 出站 ACL 拒绝私网段；runs-on 用 vars.CI_RUNNER / vars.DEPLOY_RUNNER，没设时回到 ubuntu-latest

## 03:14:27 +08:00 · 开发 · #93 · 工作流 runs-on 改读仓库变量，CICD.md 补自托管 runner 一节

- 执行者：agent-claude-geek-main-08（Claude Code，claude-opus-5-5）
- 做了什么：ci / branch-hygiene / issue-lifecycle / cert-watch 共 13 个 job 读 CI_RUNNER，deploy-preview / deploy-production 共 7 个 job 读 DEPLOY_RUNNER；docs/ops/CICD.md 新增「自托管 runner」；crosery-arch 上停用 kaiwu-keepalive 两个用户服务、删旧容器与 Flutter 缓存卷（回收 15.6G）
- 结果：pnpm check 通过；本机 actionlint 下载失败（github.com 连接超时），未验证，留给 runner 上的 lint-workflows；清理后负载 12.6 → 0.78、Tctl 97°C → 50°C

## 03:24:35 +08:00 · 开发 · #93 · crosery-arch 上装好 incus 容器和两个 runner，CI_RUNNER 已设

- 执行者：agent-claude-geek-main-08（Claude Code，claude-opus-5-5）
- 做了什么：incus 7.3（按本机 8-23 的软件源索引从 archive.archlinux.org 取包，SHA256 与索引一致、签名通过）；incusbr0 10.77.0.1/24 + ACL runner-egress；DOCKER-USER 放行 incusbr0；容器 yzgc-runner（Ubuntu 24.04，nesting，8 核 16G）装 docker.io 29.1.3 + 镜像加速、gh、jq、shellcheck；actions runner 2.337.0（SHA256 与官方发布说明一致）注册 crosery-arch-1/2，标签 yzgc-arch；gh variable set CI_RUNNER=yzgc-arch
- 结果：两个 runner online；容器内 hello-world 与 node:22-bookworm-slim 拉取 23 秒、构建运行通过；容器访问 10.77.0.1:22/445、192.168.1.4、192.168.1.1、100.64.0.12、10.250.143.57、172.17.0.1 全部 blocked，GitHub/npm/镜像源正常；本机 actionlint 1.7.12 检查全部工作流 0 个问题

## 03:26:57 +08:00 · 提交 · #93 · 工作流、CICD.md 与执行记录一起提交

- 执行者：agent-claude-geek-main-08（Claude Code，claude-opus-5-5）
- 做了什么：ci(deploy): runs-on 改读仓库变量，CI 可跑在家里 Arch 的自托管 runner（b75309936b3b）；pnpm verify；actionlint 1.7.12
- 结果：pnpm verify 通过（核心 Tests 452 passed，论坛 Tests 240 passed）；actionlint 0 个问题

## 03:31:23 +08:00 · 开发 · #93 · runner 上第一轮 CI：docker 与 branch-guard 缺 node，容器补装 Node 22

- 执行者：agent-claude-geek-main-08（Claude Code，claude-opus-5-5）
- 做了什么：CI 运行 36179768712（push 2034f9d）：forum、core、env-contract、lint-workflows 在 crosery-arch-1/2 上通过；docker、branch-guard 报 node: command not found（这两个 job 与 pr-contract 不经 setup-node 直接用 ubuntu-latest 预装的 node）。容器内装 nodejs.org 的 v22.23.3（SHASUMS256 校验通过）到 /usr/local；CICD.md 表里补「预装」一行
- 结果：runner 用户 command -v node → /usr/local/bin/node，v22.23.3；待下一轮 CI 复核

## 03:32:56 +08:00 · 提交 · #93 · runner 搭建脚本入库

- 执行者：agent-claude-geek-main-08（Claude Code，claude-opus-5-5）
- 做了什么：build(deploy): 自托管 runner 的宿主机、容器与注册脚本入库（e88ef5b9f560）；shellcheck、pnpm check、pnpm test
- 结果：shellcheck 无输出；pnpm check 通过；pnpm test Tests 452 passed

## 03:38:32 +08:00 · 开发 · #93 · runner 与托管 runner 对齐：每个 job 清空工作目录、每个实例独立 HOME

- 执行者：agent-claude-geek-main-08（Claude Code，claude-opus-5-5）
- 做了什么：运行 36180370198/36180376068：pr-contract 的 sparse-checkout 让同一 runner 上下一个 job 缺 package.json、scripts/*.mjs；两个实例共用 /home/runner 时 pnpm/action-setup 报 [ERR_SQLITE_ERROR] disk I/O error。容器内加 ACTIONS_RUNNER_HOOK_JOB_STARTED=/home/runner/job-started.sh（清空 GITHUB_WORKSPACE）与 HOME=/home/runner/r<N>/home，重启两个服务（打断了当时在跑的 job）；deploy/runner 与 CICD.md 同步
- 结果：日志里已看到 job-started: 已清空 /home/runner/r1/_work/admin/admin；两个服务 active；新一轮 CI 待复核

## 03:48:15 +08:00 · 推送 · #93 · task/93/self_hosted_runner 推到远端

- 执行者：agent-claude-geek-main-08（Claude Code，claude-opus-5-5）
- 做了什么：git push origin task/93/self_hosted_runner（2034f9d → a2fb0ba → 035fb93 → 743f901）
- 结果：pre-push 分支与发布 tag 规则通过；每次推送都在 crosery-arch-1/2 上触发 CI

## 03:48:15 +08:00 · PR · #93 · 开 PR #94 → stage，填入 runner 上的 CI 证据

- 执行者：agent-claude-geek-main-08（Claude Code，claude-opus-5-5）
- 做了什么：gh pr create（#94）；PR 正文按九段契约写，验收证据填 CI 运行 36180935964 的每个 job 与 runner 名
- 结果：push 运行 36180935964 在自托管 runner 上全部通过（verify success；core 118s、forum 79s、docker 337s）；pull_request 运行只差「PR」「审查」记录；pr-contract 待审查结论

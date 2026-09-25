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

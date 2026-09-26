# task/97/deploy_jit_runner · crosery · 2026-09-26

负责人：crosery

## 09:13:54 +08:00 · 开工 · #97 · 从 origin/stage bc86fd69abbb 建 task/97/deploy_jit_runner

- 执行者：agent-claude-geek-main-08（Claude Code，claude-opus-5-5）
- 做了什么：node scripts/task.mjs start 97 deploy_jit_runner：建分支与 worktree .claude/worktrees/task-97，在 issue 上留开工记录
- 结果：worktree 已建好，issue 上已留开工记录

## 09:25:11 +08:00 · 方案 · #97 · 部署 job 放到每个 job 一个全新容器的 JIT runner，基础镜像按 digest 固定

- 执行者：agent-claude-geek-main-08（Claude Code，claude-opus-5-5）
- 做了什么：宿主机 systemd 补位进程保持 2 个 incus ephemeral 容器，每个里一台组织级 JIT runner（runner 组 yzgc-deploy，id 3，只放行 admin 仓库），跑完一个 job 即关机删除；单独网桥 incusdeploy；令牌只放宿主机 root 0600。否决：DEPLOY_RUNNER 指向常驻 yzgc-arch（可被投毒）、仓库级 Administration 令牌（能删仓库）、按工作流限制 runner 组（免费版要求具体 ref，@refs/tags/* 与 @* 均 400）
- 结果：runner 组 yzgc-deploy 已建（visibility=selected，只含 admin）；三个基础镜像 digest 在 Docker Hub 与 docker.1ms.run、docker.m.daocloud.io 三处一致

## 09:25:11 +08:00 · 提交 · #97 · 三个 Dockerfile 的基础镜像按 digest 固定

- 执行者：agent-claude-geek-main-08（Claude Code，claude-opus-5-5）
- 做了什么：build(deploy): node:22-bookworm-slim、node:26-bookworm-slim、nginx:1.31-alpine 写成 tag@sha256；DEPLOY.md 补更新 digest 的做法；pnpm verify
- 结果：pnpm verify 通过（核心 Tests 452 passed，论坛 Tests 240 passed）

## 09:27:16 +08:00 · 提交 · #97 · 一次性部署 runner：镜像、补位进程、独立网桥与文档

- 执行者：agent-claude-geek-main-08（Claude Code，claude-opus-5-5）
- 做了什么：feat(deploy): container-setup.sh 加 jit 模式；host-setup.sh 建 incusdeploy 网桥与 profile yzgc-deploy；新增 jit-image.sh、jit-pool.sh；CICD.md「部署用的一次性 runner」、两条部署工作流头注释；并入 stage 4e3e01c（#95），补 #77 链路的合并与收尾记录；shellcheck、note.mjs check
- 结果：shellcheck 通过；note.mjs check 通过（6 条链路）；pnpm verify 在并入 stage 前通过（核心 452、论坛 240），并入后待 CI

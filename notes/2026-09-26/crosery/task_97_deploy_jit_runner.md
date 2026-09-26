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

## 09:42:04 +08:00 · PR · #97 · 开 PR #98 → stage

- 执行者：agent-claude-geek-main-08（Claude Code，claude-opus-5-5）
- 做了什么：gh pr create（#98），九段正文；仓库变量 DEPLOY_RUNNER=yzgc-deploy；crosery-arch 上 host-setup.sh 重跑、jit-image.sh 发布镜像 yzgc-deploy；令牌要 passkey 过 sudo，暂由本机临时脚本用 gh 生成 JIT 配置补位
- 结果：PR #98 已开；两台 ydeploy-* 在 runner 组 3 online（launch 到 online 约 14 秒）；CI push 36208488565 全部 success

## 09:57:27 +08:00 · 审查 · #97 · 第一轮独立审查：有条件通过，2 条应修

- 执行者：agent-claude-geek-main-08（Claude Code，claude-opus-5-5）
- 做了什么：Claude 独立审查代理审 690e61e（范围 4e3e01c..690e61e，另含 d3f3df7），按 CODE-REVIEW 逐项，另核对 runner 源码、incus launch 失败行为与三处 digest
- 结果：有条件通过：应修 2 条（RuntimeMaxSec=6h 把空闲时间算进去，晚接到的 job 会被中途杀掉；同一网桥上两台部署容器可互相仿冒、文档说重了），建议 2 条（JIT 凭据 job 读得到、文档「读完就删」不准；launch 失败留停机实例、DELETE 失败也记删掉、save_token 用 jq -r）

## 09:57:27 +08:00 · 返工 · #97 · 按第一轮审查改：空闲回收、端口隔离、维护逻辑、文档措辞

- 执行者：agent-claude-geek-main-08（Claude Code，claude-opus-5-5）
- 做了什么：jit-pool.sh：cleanup 改 maintain（删停机实例、注销离线 runner 只在成功时记、空闲超过 5 小时先注销再删容器），只数 RUNNING，launch 失败删实例，save_token 用 jq -e；container-setup.sh RuntimeMaxSec 改 8h 兜底并写明 JIT 凭据 job 读得到；host-setup.sh profile 网卡加 security.port_isolation、security.ipv4_filtering；CICD.md 按实际改写；宿主机重跑 host-setup.sh，重做镜像
- 结果：shellcheck、sh -n 通过；假 incus/api 的 harness 覆盖 6 种情况全部符合预期；宿主机两台部署容器 veth 为 isolated on，互 ping 不通，访问 api.github.com 200

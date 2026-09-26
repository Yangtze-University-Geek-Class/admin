# stage · lysnowq · 2026-09-27

负责人：lysnowq

## 00:31:21 +08:00 · 验收 · 无 issue · 本机拉 stage 并在 Windows 上跑构建、测试、浏览器冒烟（补记）

- 执行者：agent-omp-geek-main-26（omp，claude-opus-5-5）
- 做了什么：补记（本会话 09-26 20:4x–22:3x 做的，当时没记）：主工作区 git pull --ff-only 把 stage 从 6254304 快进到 864fd25，再到 c8e7648；pnpm install --frozen-lockfile；pnpm build；node scripts/local-preview.mjs start（隔离模式）+ 控制台 5186；vitest 与 playwright 全量；只读，没有提交、推送或改代码
- 结果：864fd25 上 vitest 51 failed / 529 passed / 20 skipped，同一提交 CI（ubuntu-24.04）615 passed；e2e 4 failed / 12 passed，打开硬件 GPU 后这 4 条通过；浏览器冒烟官网 7 个页面、控制台样板数据 6 页无页面错误，意见箱在 127.0.0.1 提交成功；这是本机开发环境，不是预发布验收

## 00:31:22 +08:00 · 验收 · 无 issue · 本机失败逐条定性：51 条 vitest 与 4 条 e2e 都是 Windows 环境，不是代码缺陷（补记）

- 执行者：agent-omp-geek-main-26（omp，claude-opus-5-5）
- 做了什么：补记：逐条看报错与被测代码；用 CI core job 日志作 Linux 对照（WSL 直连外网太慢没跑成）；同页面软件渲染与 Intel Iris Xe GPU 对比信封动画；curl 按 Origin/Referer 测宣传片 CDN
- 结果：vitest：URL.pathname 当文件路径（portal-os/org/wallpapers）、写死 /bin/sh（build-mirrors 27）、STACK_ROOT 只收 POSIX 路径（deploy-scripts 19）、0o600 权限位、task-worktree 与 deploy-manual 写死 /；e2e：SwiftShader 7fps 信纸 18.5s、GPU 60fps 8.6s；CDN 对 Referer 127.0.0.1 回 403、localhost/prev/正式回 200；CI 不跑 e2e；以上均未开 issue、未改代码

## 00:31:22 +08:00 · 验收 · 无 issue · 本机装论坛独立工具链并以 site 模式启动全部服务（补记）

- 执行者：agent-omp-geek-main-26（omp，claude-opus-5-5）
- 做了什么：补记：在 .tools/（已 gitignore）装 Node v26.10.0（SHASUMS256 核对）与 pnpm 11.24.0（按 ci.yml 写死的 sha512 核对），app/forum 按锁文件安装；scripts/forum.mjs install/start 在 Windows 上用不了（PATH 用 : 分隔、生成 #!/bin/sh 包装），改为同参数直接跑 nuxt dev；先用 demo 模式，被指出界面是旧的后换成 GEEK_FORUM_SOURCE=site
- 结果：app/forum/pnpm-lock.yaml 未变；3456 /__geek_forum 回 mode=site；本机官网与 prev.yangtzeu.work（0.1.0-rc.9@c8e7648）截图一致，论坛 site 模式与预发布一致（差别只是本机后端空库）；未合并的 PR #150 #151 不在 stage

## 00:31:23 +08:00 · 收尾 · #110 #112 #130 #133 · 核对并补全 LYsnowQ 的执行链路（补记）

- 执行者：agent-omp-geek-main-26（omp，claude-opus-5-5）
- 做了什么：按 NOTES 核对：给 #110 #130 #133 补「合并」并 task.mjs finish（git worktree remove 在 Windows 上因 node_modules 删不掉目录，逐文件与分支内容比对一致后手工删除）；#112 负责人更正并以放弃收尾；#128 #129 补中断记录；只动 lysnowq 的链路，crosery、kaiserunix 的记录未改
- 结果：已暂存 .claude/notes-pending（随下一个 task PR 入库）；本机剩 task-128、task-129 两个 worktree；task.mjs list 需把 C:\Program Files\GitHub CLI 加进 PATH 才查得到 GitHub

## 00:31:44 +08:00 · 验收 · #110 #112 #130 #133 · 更正：上一条「收尾」阶段用错

- 执行者：agent-omp-geek-main-26（omp，claude-opus-5-5）
- 做了什么：上一条（核对并补全 LYsnowQ 的执行链路）误用了「收尾」：收尾只用于 task 链路的最后一条，stage 链路不结束；按只追加规则不改原条，在此更正，内容以上一条为准
- 结果：stage 链路照常继续记

## 02:33:53 +08:00 · 验收 · 无 issue · 更正：本机构建与浏览器冒烟跑在快进之前的 6254304 上

- 执行者：agent-omp-geek-main-26（omp，claude-opus-5-5）
- 做了什么：00:31:21 那条把 pnpm build 与浏览器冒烟写在 git pull 之后，顺序不对：pnpm build（server/web/console）、第一轮 vitest 与 e2e、浏览器冒烟都在 6254304 上跑，之后才快进到 864fd25，在 864fd25 上重跑的只有 vitest 与 e2e；按只追加规则不改原条
- 结果：864fd25 上没有重跑构建与浏览器冒烟；c8e7648 上只做了启动与页面访问（curl 200）和官网、论坛与预发布的截图对比

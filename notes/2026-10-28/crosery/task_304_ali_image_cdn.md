# task/304/ali_image_cdn · crosery · 2026-10-28

负责人：crosery

## 12:59:29 +08:00 · 开工 · #304 · task/304 开工：旧帖阿里 OSS 图片迁到 Garage CDN

- 执行者：agent-claude-geek-main-fece2da2（Claude Code，claude-sonnet-5-5）
- 做了什么：GitLab #304（所有者 2026-10-28 原话「[已脱敏]」）。上一个会话（omp k3.1-pro）在 GitHub 上建了编号撞车的 #277/#278 并在旧编号分支上做了未提交的实现；本单把同一事项改挂到 GitLab #304，从 stage a5cb5a9c 新建 task/304/ali_image_cdn 与 worktree，逐文件搬入实现，docs/changes 与注释里的编号改成 304，旧 277.json、278.json 保持原样。
- 结果：worktree 已建；旧编号 277/278 的历史声明与记录未被改写

## 13:00:22 +08:00 · 提交 · #304 · 实现并核对：56 张旧帖图片走 Garage CDN

- 执行者：agent-claude-geek-main-fece2da2（Claude Code，claude-sonnet-5-5）
- 做了什么：提交 9aa8643c（feat(forum)）+ 变更声明补目录覆盖项。搬入的实现：topics.json 63 处阿里引用改为 cdn.yangtzeu.work 内容寻址 WebP（阿里引用 0，不同 CDN 地址 56 个）；static-cdn.mjs collectPublishedImages 只收正文引用并核对哈希；forum-store.ts 启动时只更新 edited_at 为空的旧帖正文。文档核对：docs/ops/CDN.md、docs/ops/CICD.md、docs/services/forum/README.md、docs/services/server/README.md 已随实现更新，其余映射文档（DEPLOY.md、ENVIRONMENTS.md）不用改——部署顺序与环境变量没有变化。
- 结果：vitest static-cdn、static-cdn-manifest、storage-cdn-config、server/forum 共 174 个用例通过；docs/doc-sync/secrets/catalog/architecture(#304，73 文件 5 节点)/boundaries/site-config/environments 逐项通过

## 13:04:50 +08:00 · PR · #304 · 开 MR !47：task/304

- 执行者：agent-claude-geek-main-fece2da2（Claude Code，claude-sonnet-5-5）
- 做了什么：按 PULL-REQUESTS 正文契约开 GitLab MR !47（task/304/ali_image_cdn → stage），Closes #304；正文写明编号撞车与旧声明保持原样。
- 结果：MR !47 已开；未验证项写进正文：真实 Garage 上传与浏览器加载、生产库副本上的旧帖正文更新演练

## 13:04:50 +08:00 · 审查 · #304 · MR !47 审查结论：通过

- 执行者：agent-claude-geek-main-fece2da2（Claude Code，claude-sonnet-5-5）
- 做了什么：非作者审查（实现来自 omp 会话）：上传键白名单只增 forum/published/ 且必须 16 位十六进制 .webp；collectPublishedImages 只收正文引用、拒绝符号链接、核对哈希；forum-store 的更新条件含 author_id 与 edited_at IS NULL；摘要读时计算无派生存储；56 个 CDN 地址逐个核对文件存在与哈希（0 缺失 0 不符）。pnpm typecheck && pnpm test：174 文件 2802 用例通过。
- 结果：结论：通过（被审 commit 9aa8643c、b37beca5）；未验证项已写进 MR 正文

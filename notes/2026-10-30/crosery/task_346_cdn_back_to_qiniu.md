# task/346/cdn_back_to_qiniu · crosery · 2026-10-30

负责人：crosery

## 20:43:39 +08:00 · 开工 · #346 · 从 gitlab/stage 3765fdbf4d84 建 task/346/cdn_back_to_qiniu

- 执行者：agent-claude-01d717b4（Claude Code，claude-opus-5-5）
- 做了什么：node scripts/task.mjs start 346 cdn_back_to_qiniu：建分支与 worktree .claude/worktrees/task-346，在 issue 上留开工记录
- 结果：worktree 已建好，issue 上已留开工记录

## 21:01:13 +08:00 · 提交 · #346 · 静态资源 CDN 目的地改回七牛

- 执行者：agent-claude-01d717b4-sub（Claude Code，claude-sonnet-5-5）
- 做了什么：提交 a10fc460 fix(tooling)：scripts/static-cdn*.mjs 常量与 S3 端点、服务端 STATIC_CDN_BASE、Dockerfile 校验、表情白名单前缀、论坛使用说明与旧帖 topics.json 改写、nginx CSP、CI 与部署工作流的 S3 环境值，并同步对应测试
- 结果：tests/tooling 11 个文件 311 passed；论坛 node scripts/forum.mjs test（Node 26.7，pnpm 11.24.0）715 passed；tests/server forum 与 console 占位 3 个文件 81 passed
- 下一步：写旧 Garage 前缀的读取时改写（论坛）、宣传片与邮件地址、隐私门禁放行

## 21:02:07 +08:00 · 提交 · #346 · 宣传片与邮件图片地址改到七牛

- 执行者：agent-claude-01d717b4-sub（Claude Code，claude-sonnet-5-5）
- 做了什么：提交 4e6f4fcd fix(server)：promo.ts 指向 yzgc/static/promo/v5 目录，邮件图片指向 yzgc/mail/v1/，三份环境模板、config 默认值与对应测试同步
- 结果：只读 curl HEAD：promo 4 个文件与 8 个档位列表、init、首分片 200；邮件 4 个对象 200；vitest 6 个文件 156 passed；check-env-isolation 通过；e2e 未运行

## 21:04:09 +08:00 · 提交 · #346 · 旧 Garage 前缀的帖子图片读取时改写

- 执行者：agent-claude-01d717b4-sub（Claude Code，claude-sonnet-5-5）
- 做了什么：提交 f94bc13a fix(forum)：sticker-url.ts 认旧前缀并提供 currentCdnUrl，post-markdown.ts 的渲染与 stickersToImages 入口改写 Markdown 目的地，库里的正文不改
- 结果：node scripts/forum.mjs test（Node 26.7，pnpm 11.24.0）725 passed，39 个文件；新增 10 条用例

## 21:10:47 +08:00 · 提交 · #346 · 文档、宏观声明与隐私门禁放行

- 执行者：agent-claude-01d717b4-sub（Claude Code，claude-sonnet-5-5）
- 做了什么：提交 e3bb5964 docs(ops) 与 af8a5208 chore(tooling)：CDN 合同、STORAGE-CDN 封存说明、部署与服务文档改为七牛地址，docs/changes/346.json 登记；隐私门禁新增精确主机放行（摘要登记 62 个文件）及测试
- 结果：vitest tests/tooling/check-privacy.test.ts 46 passed；check-env-isolation 通过；check-privacy 失败 29 处：裸桶名 [已脱敏] 的个人标识命中（需所有者决定）与 6 处非精确形式（转义正则、大写主机）；check-architecture 失败（portal 的 promo.ts 归属 7 个业务域未对齐，流程证据缺）
- 下一步：等所有者决定桶名放行；修 6 处非精确形式；补 check-architecture 的域与流程声明

## 21:21:35 +08:00 · 提交 · #346 · 桶名改由部署密钥提供，声明重写

- 执行者：agent-claude-01d717b4（Claude Code，claude-opus-5-5）
- 做了什么：隐私门禁报 29 处：桶名作为裸分段出现在脚本、三个部署工作流、测试夹具与文档，另有测试里大写主机与转义正则。桶名改读部署密钥 STATIC_CDN_S3_BUCKET（只核对形状），测试改用中性桶名、断言由常量拼出；docs/changes/346.json 按实际改动重写覆盖、流程与评估
- 结果：check-privacy 通过；改到的 9 个测试文件 260 条通过；check-architecture --base gitlab/stage 通过（83 个文件，23 个节点）

## 21:23:30 +08:00 · 提交 · #346 · 合入最新 stage 并补生成物

- 执行者：agent-claude-01d717b4（Claude Code，claude-opus-5-5）
- 做了什么：合入 gitlab/stage 293b3191（无冲突）；重新生成 docs/INDEX.md 与项目目录；声明覆盖生成物；声明里不写 CDN 域名
- 结果：pnpm check 除宏观对齐的默认基线外全部通过；check-architecture --base gitlab/stage 通过

## 21:25:14 +08:00 · 提交 · #346 · 版本改为 0.1.2

- 执行者：agent-claude-01d717b4（Claude Code，claude-opus-5-5）
- 做了什么：根与 console、server、web 的 package.json version 0.1.1 → 0.1.2；依据：所有者在会话中决定 stable 之后的开发走 0.1.2 的 rc，并要求本单尽快发版
- 结果：四个清单一致为 0.1.2

## 21:25:46 +08:00 · 审查 · #346 · CDN 换回七牛的自查

- 执行者：agent-claude-01d717b4（Claude Code，claude-opus-5-5）
- 做了什么：逐项核对 diff：构建前缀、上传目的地（七牛 S3 兼容端点、cn-south-1、path-style，桶名取部署密钥）、三个部署工作流、ci.yml、nginx 与论坛 CSP、server 镜像校验、宣传片与邮件图片地址、论坛旧前缀只在读取与渲染时改写（不写库，白名单仍认旧前缀的同一哈希）、隐私门禁只放行精确主机的摘要并按文件与次数登记；备份与镜像（garage-archive、platform-archive、GitLab backup、cdn-mirror）本单不动，文档已写明
- 结果：结论：通过；pnpm check 通过（宏观对齐按 gitlab/stage 基线通过），改到的 9 个测试文件 260 条通过；论坛自己的测试、e2e 本机未跑，交给 CI

## 21:37:09 +08:00 · 提交 · #346 · 同构清单记 P-0018

- 执行者：agent-claude-01d717b4（Claude Code，claude-opus-5-5）
- 做了什么：GitHub 共用环境 static-cdn 的上传密钥换成七牛的值并新增 STATIC_CDN_S3_BUCKET（值不入库、不打印）；等 v0.1.1-stable.1 的 cdn-upload 跑完才换；清单加 P-0018（external，pre_deploy，0.1.2）
- 结果：parity check：pending 0；三个密钥更新时间 13:32Z

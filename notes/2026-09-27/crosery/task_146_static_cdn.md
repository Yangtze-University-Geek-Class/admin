# task/146/static_cdn · crosery · 2026-09-27

负责人：crosery

## 00:07:27 +08:00 · 提交 · #146 · 六个提交按用途分开，rebase 到含 #152 的 stage ab926d9；壁纸改成带哈希的构建资源；另开 #153 记论坛入口 CSS

- 执行者：agent-claude-geek-main-08（Claude Code，claude-opus-5-5）
- 做了什么：按用途分成 6 个提交：543476b 构建开关（scripts/static-cdn-base.mjs、三个构建配置、两个 Dockerfile、tests/tooling/static-cdn-switch.test.ts）、1ebaed9 宿主 CSP、4a27369 上传脚本与测试、ea176f0 部署工作流与 CICD/DEPLOY 文档、682a263 论坛 gzip 级别、2c4cb4a 壁纸。#152 合进 stage 后 rebase 到 ab926d9，没有冲突。壁纸按协调人的要求只改 lib/wallpapers.ts 的 WALLPAPERS 地址：四张图从 public/portal/wallpapers/ 移到 sites/portal/assets/wallpapers/，清单 import，#147 的下载解码、预取、展开函数不动；测试改成检查源文件与体积，并断言 public/ 里不再有壁纸（把一个地址改回 /portal/wallpapers/ 做变异，2 条失败）。论坛 typecheck 因 nuxt.config.ts import 了 vite 的类型失败，改成按结构写插件。用 gh 开了 #153（论坛入口 CSS 626,718 字节里 571,245 是整份 Tuffex 组件样式，模板里用到 57 个组件）
- 结果：pnpm verify（带 FORUM_PNPM）exit 0：根 55 个文件 792 条测试、论坛 24 个文件 473 条测试、官网与控制台与论坛构建、论坛 generate 都通过；check-doc-sync 要求把 09-27 改过的四份文档的更新日期改成 2026-09-27，已改。本机构建壁纸地址：开关关时 /assets/yugc-pA0riuuE.webp 等四个，开关开时 https://cdn.crosery.com/yzgc/static/site/assets/… 同名四个，static-cdn.mjs collect 离线挑出这四个 image/webp；这四个新文件还没传到 CDN（唯一一次真实上传在移动之前），第一次开着开关的部署由 cdn-upload 上传并核对。测试数：static-cdn 76、static-cdn-switch 8、static-cdn-workflows 2、deploy-manual 等 58
- 下一步：推送 task 分支，开 PR 到 stage，等 CI

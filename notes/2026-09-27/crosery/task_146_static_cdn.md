# task/146/static_cdn · crosery · 2026-09-27

负责人：crosery

## 00:07:27 +08:00 · 提交 · #146 · 六个提交按用途分开，rebase 到含 #152 的 stage ab926d9；壁纸改成带哈希的构建资源；另开 #153 记论坛入口 CSS

- 执行者：agent-claude-geek-main-08（Claude Code，claude-opus-5-5）
- 做了什么：按用途分成 6 个提交：543476b 构建开关（scripts/static-cdn-base.mjs、三个构建配置、两个 Dockerfile、tests/tooling/static-cdn-switch.test.ts）、1ebaed9 宿主 CSP、4a27369 上传脚本与测试、ea176f0 部署工作流与 CICD/DEPLOY 文档、682a263 论坛 gzip 级别、2c4cb4a 壁纸。#152 合进 stage 后 rebase 到 ab926d9，没有冲突。壁纸按协调人的要求只改 lib/wallpapers.ts 的 WALLPAPERS 地址：四张图从 public/portal/wallpapers/ 移到 sites/portal/assets/wallpapers/，清单 import，#147 的下载解码、预取、展开函数不动；测试改成检查源文件与体积，并断言 public/ 里不再有壁纸（把一个地址改回 /portal/wallpapers/ 做变异，2 条失败）。论坛 typecheck 因 nuxt.config.ts import 了 vite 的类型失败，改成按结构写插件。用 gh 开了 #153（论坛入口 CSS 626,718 字节里 571,245 是整份 Tuffex 组件样式，模板里用到 57 个组件）
- 结果：pnpm verify（带 FORUM_PNPM）exit 0：根 55 个文件 792 条测试、论坛 24 个文件 473 条测试、官网与控制台与论坛构建、论坛 generate 都通过；check-doc-sync 要求把 09-27 改过的四份文档的更新日期改成 2026-09-27，已改。本机构建壁纸地址：开关关时 /assets/yugc-pA0riuuE.webp 等四个，开关开时 https://cdn.crosery.com/yzgc/static/site/assets/… 同名四个，static-cdn.mjs collect 离线挑出这四个 image/webp；这四个新文件还没传到 CDN（唯一一次真实上传在移动之前），第一次开着开关的部署由 cdn-upload 上传并核对。测试数：static-cdn 76、static-cdn-switch 8、static-cdn-workflows 2、deploy-manual 等 58
- 下一步：推送 task 分支，开 PR 到 stage，等 CI

## 00:11:27 +08:00 · PR · #146 · 开 #155 到 stage，正文九段齐全，另开 #153 记论坛入口 CSS

- 执行者：agent-claude-geek-main-08（Claude Code，claude-opus-5-5）
- 做了什么：推送 task/146/static_cdn（7ad6cb0），node scripts/pr-contract.mjs check 通过后 gh pr create --base stage 开 #155，正文写 Closes #146、Refs #153、#85、#147；验收证据放 7 张 ego 截图（GitHub 附件）、curl 与 performance 两张表、CDN 防盗链与 CORS 实测；未验证逐条列出：部署工作流没真跑过、宿主模板没装、预发布与正式没开开关看过、移动后的壁纸没从 CDN 加载过、手机没测
- 结果：PR 已开，作者自查结论：有条件通过（等独立审查与 CI）。没有设置任何 GitHub secret、variable 或 Environment，没有合并
- 下一步：等 CI；branch-guard 在独立审查之前失败是预期的；独立审查给出结论后补「审查」记录

## 01:14:05 +08:00 · 返工 · #146 · 按独立审查「修改后合并」的 7 条返工：产物目录 ^~ 长缓存、CI 跑开关打开的构建、token 到期区间、文件名规则、所有者步骤

- 执行者：agent-claude-geek-main-08（Claude Code，claude-opus-5-5）
- 做了什么：审的是 ab01348。965f088 fix(tooling)：token 到期时间超过 366 天拒绝，decide 要求剩 90 分钟（build 60 + cdn-upload 20 + 排队 10），upload 要求剩 20 分钟；产物文件名按构建形状核对（Vite <name>-<8 位哈希>.<ext>，Nuxt <8 位哈希>.js、<name>.<8 位哈希>.<ext>、builds/meta/<uuid>.json），并对照源码 public/ 目录拒绝原样复制的文件（只看名字挡不住 my-template.js，论坛现有 sok5vuyt.js 这种全小写哈希）。215bd50 fix(deploy)：web /assets/、/console-assets/ 与论坛 /_nuxt/ 改 location ^~，论坛 _nuxt/builds/latest.json 精确匹配 expires -1，新增 tests/tooling/hashed-asset-cache.test.ts（宿主 preview.conf + web + 论坛三层实跑）；a36f7eb 同步 forum-csp.test.ts 的 location 清单。1c777eb ci(deploy)：ci.yml 新增 docker-cdn，带 STATIC_CDN_BASE 构建 web、forum，再跑与部署工作流逐字相同的 docker cp + static-cdn.mjs plan，不上传、不用 token，verify 依赖它。2435a60 docs(deploy)：CICD 所有者步骤改成合并后第一个 rc 之前建带 v* 规则的 Environment、放 token 前实测规则管不管 deployment: false、建议 v* tag ruleset，.nvmrc 清单补 cdn-plan、cdn-upload。只读核对：gh api environments 只有 preview，rulesets 返回 []
- 结果：pnpm verify（Node 22、FORUM_PNPM）exit 0：根 56 个文件 815 条、论坛 24 个文件 473 条、官网与控制台构建、论坛 generate；第一次跑时 forum-csp 1 条失败（location 清单没跟上），a36f7eb 修后重跑通过。变异：旧正则 7 条失败、去 public 对照 3、余量回 10 分钟 3、去 366 天上限 3、上传也要 90 分钟 1、三个 ^~ 改回普通前缀 4（实测 max-age=604800）、删 docker-cdn 一行 docker cp 1、verify 不依赖 docker-cdn 1。本机 nginx 1.31.6 三层前后对比：6 个字体图片响应 604800 → 31536000，latest.json 31536000 → no-cache，安全头逐字相同。actionlint 1.7.12（shellcheck 0.11.0）exit 0。本机开关打开构建官网、控制台与论坛（site、/forum/），两个 Dockerfile 的入口断言照抄运行通过，plan 244 个文件；开关关闭 243 个也通过。镜像构建本机做不了（没有 Docker 基础镜像），等 CI 的 docker-cdn
- 下一步：改 PR 正文受影响的段落，推送 task 分支，等新 head 的 CI

## 01:37:05 +08:00 · 审查 · #146 · 独立审查 PR #155：返工后通过，可以合并

- 执行者：agent-claude-geek-main-08（Claude Code，claude-opus-5-5）
- 做了什么：初审 ab01348（diff 对 origin/stage）给修改后合并：同源字体和壁纸实际缓存 7 天（nginx 正则 location 优先于普通前缀，预发布 curl 实测 woff2 为 max-age=604800）；开关打开的 Docker 构建与上传清单从没跑过；另有 token 到期上限、decide 余量、哈希文件名判断、CICD 所有者步骤顺序与 .nvmrc 清单 5 条建议。复查返工 965f088、215bd50、1c777eb、2435a60、a36f7eb、9699575：本机 nginx 1.31.6 用真实产物三层同进程复现，ab01348 与 HEAD 的 nginx -t 都通过，前后只有 5 行 Cache-Control 不同（woff2、woff、webp、console favicon 从 604800 变 31536000，latest.json 变 no-cache），18 个路径的安全头与 CSP 逐一相同；docker-cdn 在 CI 用 STATIC_CDN_BASE 构建 web 和 forum 并跑 plan，不带 secrets 和 environment；token 到期超过 366 天拒绝、decide 余量 90 分钟、产物文件名按构建形状加 public 来源核对
- 结果：复查自做 6 个变异（去 366 天上限、余量改回 10 分钟、public 对照失效、论坛正则放宽、官网正则去哈希、^~ 改回普通前缀）都被测试抓到；相关 6 个测试文件 160 条通过；开关关闭的真实产物 plan 243 个文件全过，开关打开的 244 个由 CI docker-cdn 跑过；push 运行 36258365171 全绿（含 docker-cdn 1m15s），PR 运行只缺本条审查记录。剩余 3 条建议：CICD.md 关于官方文档的一句说法不准、将来插件写入形状像哈希的名字两道检查挡不住、215bd50 单独检出时 forum-csp 测试失败（a36f7eb 修正）。未验证：cdn-plan、cdn-upload 在 GitHub 上真实运行，static-cdn 环境 v* 规则对 deployment:false 的 job 是否生效，预发布与正式环境的缓存头，手机与浏览器验收
- 下一步：推送本条记录，CI 通过后经 SSH 以合并提交并入 stage（PR 改了工作流，gh 令牌没有 workflow 权限），确认 #146 关闭、分支和工作区清掉；所有者按 docs/ops/CICD.md 的步骤配置 static-cdn 后，下一个 rc 才真正走 CDN

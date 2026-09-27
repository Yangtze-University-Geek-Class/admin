# task/146/static_cdn · crosery · 2026-09-26

负责人：crosery

## 22:43:09 +08:00 · 开工 · #146 · 从 origin/stage c8e7648d5779 建 task/146/static_cdn

- 执行者：agent-claude-geek-main-08（Claude Code，claude-opus-5-5）
- 做了什么：node scripts/task.mjs start 146 static_cdn：建分支与 worktree .claude/worktrees/task-146，在 issue 上留开工记录
- 结果：worktree 已建好，issue 上已留开工记录

## 23:03:59 +08:00 · 方案 · #146 · 带哈希的静态文件走 CDN：一个构建开关、只增不改的上传脚本、部署工作流接线、CSP

- 执行者：agent-claude-geek-main-08（Claude Code，claude-opus-5-5）
- 做了什么：读了 Nuxt 4.5.2 的 paths/manifest/payload 与 vite-builder 的 renderBuiltUrl、public-dirs 插件，本机构建了开关开与关的官网、控制台、论坛产物；查了 CDN 的 Referer 白名单与 CORS 头；看了 Tuffex 全量样式在论坛入口 CSS 里的占比
- 结果：开关是构建环境变量 STATIC_CDN_BASE（只接受空或 https://cdn.crosery.com/yzgc/static/site/，解析集中在 scripts/static-cdn-base.mjs）；官网与控制台用 Vite experimental.renderBuiltUrl 只改 type=asset 的地址，base 仍是 /；论坛用 app.cdnURL=<base>forum/，代码 import 的 public 文件（论坛头部 logo）在开关打开时改为带哈希的构建资源，关掉 Nuxt 读 builds/latest.json 的新版本检查（文件名不带哈希，不上传）。上传脚本 scripts/static-cdn.mjs：从镜像里拷出站点根，只选 assets/、console-assets/、forum/_nuxt/ 下带哈希的文件（builds/meta/<构建 id>.json 例外，latest.json 排除），键一律 yzgc/static/site/…，insertOnly，经 CDN HEAD（带 Referer 与 Origin）核对状态、ETag=七牛 qetag、长度、类型、CORS 头，任一不符即失败。凭据是前缀限定（isPrefixalScope）+ insertOnly 的上传 token，放在单独的 GitHub Environment static-cdn 的 secret STATIC_CDN_UPLOAD_TOKEN，build job 挂这个环境（deployment: false）；没有 secret 就同源构建、跳过上传；宿主 CSP 还没放行 CDN 时也退回同源并告警。CSP 在两份宿主模板的 script-src、style-src、font-src 加 https://cdn.crosery.com/yzgc/static/site/，论坛镜像的 CSP 从 production.conf 派生，自动一致。预压缩：gzip -9 比现在的 -6 只小 0.3%，官方 nginx 镜像没有 brotli，不做。论坛入口 CSS 627KB 里 571KB 是整份 Tuffex 组件样式（论坛只用了 57 个组件），拆分要改论坛的组件注册，另开 issue
- 下一步：写 scripts/static-cdn.mjs 与测试，改 Dockerfile、工作流、nginx、文档

## 23:51:15 +08:00 · 开发 · #146 · 开关、上传脚本、工作流三段 job、CSP、论坛 gzip 级别与文档写完，本机两种构建与一次真实上传核对通过

- 执行者：agent-claude-geek-main-08（Claude Code，claude-opus-5-5）
- 做了什么：写 scripts/static-cdn-base.mjs（开关唯一解析点）与 scripts/static-cdn.mjs（decide、plan、upload、mint-token，零依赖）；官网、控制台 vite.config.ts 用 renderBuiltUrl，论坛 nuxt.config.ts 用 app.cdnURL + hashPublicImports + 关新版本检查；web、forum Dockerfile 只在构建阶段接 ARG STATIC_CDN_BASE 并断言入口地址；两条部署工作流拆成 cdn-plan（决定开关）→ build（不接触任何 Environment，开关打开时从镜像拷出产物、plan 离线挑文件、存 artifact）→ cdn-upload（上传并经 CDN 核对）→ deploy，token 只在 cdn-plan、cdn-upload 两个不装依赖的 job 里；方案里让 build job 挂 static-cdn 环境的做法改掉了，因为 build 要跑 pnpm install 与 docker build。deploy-manual.mjs 要求 cdn-upload 成功。两份宿主模板的 script-src、style-src、font-src 只放行 https://cdn.crosery.com/yzgc/static/site/。forum 容器 gzip_comp_level 从默认 1 改成 6（与 web 一致）。测试 tests/tooling/static-cdn.test.ts 86 条；对前缀守卫与 insertOnly 做了 5 个变异（删 KEY_RE、删逐段检查、assertKey 不抛、策略 insertOnly=0、不校验 insertOnly），分别有 4、4、12+、6+、3 条失败，都被抓到。用所有者 ~/.claude/secrets/.env.cloud 的 AK/SK 在进程里签 1 小时 token 做了一次真实上传（240 个文件、6.32 MiB，只写 yzgc/static/site/），经 CDN 带 prev Referer 全部核对通过，没有打印任何凭据。本机 4617（开）/4618（关）起生产构建，ego 里看 performance 条目并截图，GitHub 评论框上传图片取链接后清空，TaskSpace 已 finish，两个本机服务按 PID 停掉
- 结果：开关打开：官网、控制台、论坛带哈希的文件全部来自 cdn.crosery.com/yzgc/static/site/，无 CSP 拦截；开关关闭：地址与现网预发布相同（同源）。CDN 对 prev、正式的 Referer 返回 200，外站 403、localhost 403、无 Referer 200，JS/CSS/woff2 带 ACAO *，不用改 CDN 配置。同文件 5 次平均：源站 1.4–3.5 秒，CDN 0.31–0.42 秒；ego 里现网预发布论坛首页最后一个静态文件 16.3 秒结束，开关打开的本机构建 0.98 秒。论坛入口 CSS 经源站 gzip 128,152 字节，改级别后本机 nginx 95,932。文档：CICD、DEPLOY 加「静态资源 CDN」，web、console、forum 合同写开关
- 下一步：pnpm verify、论坛 check，按用途分提交，开论坛 CSS 的独立 issue，推送并开 PR

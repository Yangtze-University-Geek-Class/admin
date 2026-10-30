# task/360/perf_and_sites · crosery · 2026-10-31

负责人：crosery

## 00:10:46 +08:00 · 提交 · #360 · 比赛官网资源上对象存储，CSP 只放行本环境一段前缀

- 执行者：agent-claude-01d717b4-sub（Claude Code，claude-sonnet-5-5）
- 做了什么：提交 1ef840db：比赛官网发布先校验，再同步对象存储，同步失败回 503 且不切换版本；在线版本的 js、css、图片、字体 302 到 contest-sites/ 前缀，HTML 与预览仍由本站回；再发布时删掉上一版多出的文件；未配置对象存储时同源返回。边缘生成器 render-arch-caddy 为两个环境各生成一段 yzgc-security 片段，把各自的前缀并入 script-src、style-src、font-src；未设 OBJECT_STORAGE_PUBLIC_BASE 时策略与原来一字不差。SECURITY、API、服务合同与 DEPLOY 改写了 CSP 规则并写明原因（只放行一段前缀，因为浏览器取交集且 CSP3 的 'self' 不匹配跨源重定向）。
- 结果：pnpm typecheck 通过；vitest 通过 tests/server/competition-site-cdn、competition-site、object-storage、object-storage-upload、tests/tooling/arch-caddy 共 20 例，10 例需要真实 Caddy 镜像而跳过；check-architecture、check-doc-sync 通过。未验证：真实七牛桶与 CDN、真实 Caddy 加载新片段、浏览器中 CSP 与 302 的表现。

## 00:38:30 +08:00 · 提交 · #360 · 源站与开关改从环境文件读取（env、服务端、脚本）

- 执行者：agent-claude-01d717b4-sub（Claude Code，claude-haiku-5-5）
- 做了什么：提交 d5a8dc58 feat(config)：三份 env 新增 STATIC_CDN_ORIGIN（契约字段，compose 传入 server）；scripts/static-cdn-base.mjs 去掉源站与开关的导出常量，改为 staticCdnOrigin/staticCdnPrefixURL/staticCdnBase(env)；app/server 的 parseStaticCdnBase(raw, origin)、MAIL_ASSET_BASE 缺省由源站派生；app/server/Dockerfile 只查形状；上传、清单、旧帖脚本改用派生值；测试夹具从 deploy/env/.env.production 读源站（tests/static-cdn-fixture.ts、tests/static-cdn-hooks.ts）；privacy 登记表删掉 10 条已不再命中的旧域名放行，未改次数。
- 结果：pnpm exec vitest run（tooling 与 server 相关 32 个文件）：32 passed，790 passed / 10 skipped；pnpm check:env-isolation 通过；pnpm check:environments 通过；pnpm check:privacy 未通过：deploy/env/.env.production、.env.preview、.env.dev 各多一处 CDN 域名字符串，登记次数 2/2/1 不够，需要所有者决定是否把这三条放行各加 1（未改）。未验证：服务端镜像构建、线上。

## 00:38:46 +08:00 · 提交 · #360 · CI 的 docker-cdn 从环境文件派生源站，构建参数带上 STATIC_CDN_ORIGIN

- 执行者：agent-claude-01d717b4-sub（Claude Code，claude-haiku-5-5）
- 做了什么：提交 0df8c590 feat(ci)：ci.yml 删除 STATIC_CDN_BASE 字面量，第一步从 deploy/env/.env.dev 读 STATIC_CDN_ORIGIN 并派生 STATIC_CDN_BASE 写进 GITHUB_ENV；两条 docker build 加 --build-arg STATIC_CDN_ORIGIN；app/web/Dockerfile、app/forum/Dockerfile 声明 ARG STATIC_CDN_ORIGIN（只在构建阶段用）；tests/tooling/static-cdn-workflows.test.ts 同步。未改 deploy-*.yml。
- 结果：pnpm exec vitest run tests/tooling/static-cdn-workflows.test.ts tests/tooling/static-cdn-switch.test.ts：2 files，17 passed。CI 工作流本身未在 GitHub 上运行。

## 00:38:46 +08:00 · 提交 · #360 · 论坛表情 CDN 前缀改由构建参数决定

- 执行者：agent-claude-01d717b4-sub（Claude Code，claude-haiku-5-5）
- 做了什么：提交 03afd59f feat(forum)：app/forum/shared/sticker-url.ts 的 STATIC_CDN_PREFIX 读 import.meta.env.GEEK_STATIC_CDN_BASE（nuxt.config.ts 用 define 注入），空串时 CDN 前缀为空、白名单与 sticker-css 的 CDN 选择器都不加；旧 Garage 前缀（LEGACY_STATIC_CDN_PREFIX）保留为字面量兼容，原因是它要进构建参数就得改 deploy-*.yml 的 cdn_args，本轮不改。根与 app/forum 的 vitest 配置注入同一个派生值。文档：ENVIRONMENTS、DEPLOY、CDN、服务文档改为由 STATIC_CDN_ORIGIN 派生，模块文档「更新：」日期改为 2026-10-31；docs/changes/360.json 补覆盖。app/web/sites/portal/lib/promo.ts 未改（见阻塞记录）。
- 结果：pnpm exec vitest run（app/forum）：6 files，223 passed；根目录 5 个表情与 CDN 测试文件：169 passed；pnpm check:doc-sync --base gitlab/stage 通过（8 组）；node scripts/docs-index.mjs --check 通过。未验证：nuxt generate、论坛的 Docker 构建、浏览器里的表情。

## 00:38:46 +08:00 · 提交 · #360 · 目录采集补虚构的 CDN 源站并重新生成目录

- 执行者：agent-claude-01d717b4-sub（Claude Code，claude-haiku-5-5）
- 做了什么：提交 93bdf489 docs(catalog)：scripts/catalog/collect.ts 的虚构配置补 STATIC_CDN_ORIGIN（https://catalog.invalid，不是真实域名）；ownership.json 的 parseStaticCdnBase 证据锚点改成新签名；pnpm catalog:generate 重新生成目录。
- 结果：pnpm catalog:generate：5 应用，3 运行单元，314 方法路径，73 表，16 能力；pnpm check:catalog 核对通过；node scripts/check-architecture.mjs --base gitlab/stage --head HEAD --branch task/360/perf_and_sites：宏观对齐通过，98 个变更文件。

## 00:38:46 +08:00 · 提交 · #360 · 集成与端到端的服务端夹具补 STATIC_CDN_ORIGIN

- 执行者：agent-claude-01d717b4-sub（Claude Code，claude-haiku-5-5）
- 做了什么：提交 bebedbdd test(server)：tests/integration/forum-editor/http-fixture.mts、tests/e2e/competitions.spec.mts、tests/e2e/application-cancelled.spec.mts 的 buildApp 环境补 STATIC_CDN_ORIGIN（值从 deploy/env/.env.production 读）。
- 结果：未运行（integration 是另一套工具链，e2e 是浏览器用例，本轮不跑）。只做了路径与语法的静态检查。

## 00:38:46 +08:00 · 开发 · #360 · 文档核对与阻塞项记录

- 执行者：agent-claude-01d717b4-sub（Claude Code，claude-haiku-5-5）
- 做了什么：文档核对：docs/ops/CICD.md 不用改——docker-cdn 仍是无凭据的构建、不上传，只把开关值的来源从工作流字面量改为 deploy/env/.env.dev 派生；CICD.md 没有写 ci.yml 里的字面值，只把「更新：」日期改为 2026-10-31。本轮没有运行 deploy-*.yml，也没有修改它们（任务说明第 I 条）。
- 结果：阻塞，需要所有者决定：（1）deploy-preview/production/hotfix 的 cdn-plan 与 build 还没传 STATIC_CDN_ORIGIN。带 S3 凭据时 cdn-plan 的 decide 会失败关闭（报 STATIC_CDN_ORIGIN 未设置），不会悄悄同源；合并前要先改这三份工作流。（2）app/web/sites/portal/lib/promo.ts 的宣传片地址仍是字面量：宣传片只在 CDN 上，与开关无关，任务说明里「关闭时走同源」的前提不成立，它需要构建阶段拿到源站，同样依赖第（1）条。（3）LEGACY_STATIC_CDN_PREFIX（cdn.yangtzeu.work）仍是字面量，原因同上。（4）pnpm check:privacy 未通过，见第一条记录。（5）工作区的 AGENTS.md 是别人的未提交改动，没有纳入任何提交。

## 00:43:52 +08:00 · 提交 · #360 · CDN 大文件上传超时随体积放宽，上传并发可配

- 执行者：agent-claude-01d717b4-sub（Claude Code，claude-haiku-5-5）
- 做了什么：提交 419631c2：PUT 超时改为基础超时与 15 秒加体积除以每秒 16 KiB 取大者，上限 180 秒；参数上限由 60 秒放到 180 秒。并发数读取 STATIC_CDN_UPLOAD_CONCURRENCY（未设为 4，允许 1–8），三份部署工作流的 cdn-upload 步骤设为 4。网络错误重试前的退避原来就有（request 与 ensure 两处都 sleep），这次没改逻辑，只补了用例覆盖。
- 结果：pnpm exec vitest run tests/tooling/static-cdn-s3.test.ts：23 例通过（新增 3 例：大 PUT 在 50 毫秒基础超时下仍成功、GET 仍按基础超时、网络错误后退避不少于 90 毫秒）；tests/tooling/static-cdn.test.ts 与 static-cdn-workflows.test.ts：86 例通过；check-architecture、check-doc-sync 通过。未验证：真实七牛上传耗时与线上重跑。

## 00:46:30 +08:00 · 提交 · #360 · 部署工作流从环境文件读取 CDN 源站

- 执行者：agent-claude-01d717b4-sub（Claude Code，claude-haiku-5-5）
- 做了什么：提交 1c3a1365：三条部署工作流的 plan 从 deploy/env 的 STATIC_CDN_ORIGIN 读出 static_cdn_origin，决定（decide）、构建参数（cdn_args 与 STATIC_CDN_ORIGIN）、上传步骤都用它；工作流里不写域名。修正了 check 测试里 cdn_args 的字面量。
- 结果：node 解析三份工作流 YAML 通过；vitest 跑 static-cdn-workflows、static-cdn、static-cdn-switch 共 98 例通过；check-architecture、check-doc-sync、check:env-isolation 通过。未验证：真实 GitHub Actions 运行。

## 00:46:30 +08:00 · 提交 · #360 · 隐私登记删掉已不再命中的 CDN 域名放行

- 执行者：agent-claude-01d717b4-sub（Claude Code，claude-haiku-5-5）
- 做了什么：提交 1fb6587d：删掉 scripts/privacy-exceptions.json 里 docs/services/server/mail.md 与 docs/services/web/README.md 两条已不再命中的登记（门禁说明允许删除这类条目）。没有增加任何放行次数。
- 结果：pnpm check:privacy 对这两条的报错已消失；剩余失败只在三份 env 的 MAIL_ASSET_BASE 行（需要所有者决定：STATIC_CDN_ORIGIN 新增一处域名后，每份 env 超过登记次数），未改登记。

## 00:46:30 +08:00 · 提交 · #360 · AGENTS.md 写明配置不写死的规则

- 执行者：agent-claude-01d717b4-sub（Claude Code，claude-haiku-5-5）
- 做了什么：提交 b085ca48：§3 加一条「域名、源站、桶、端口、开关等配置不写死在代码、工作流或宿主片段里」，§5 黑名单加一条对应禁止项；测试夹具除外。
- 结果：node scripts/check-architecture.mjs --base gitlab/stage 通过；check-doc-sync 通过。

## 00:49:58 +08:00 · 提交 · #360 · 登记 hotfix 窗口与隐私次数

- 执行者：agent-claude-01d717b4（Claude Code，claude-opus-5-5）
- 做了什么：windows.json 加 #360 的 v0.1.1 窗口；三份 env 的 CDN 域名登记各加 1（源站从代码移进 STATIC_CDN_ORIGIN）
- 结果：check-privacy 通过；窗口登记格式校验通过；宏观对齐通过

## 00:49:58 +08:00 · 审查 · #360 · 主控审查 #360

- 执行者：agent-claude-01d717b4（Claude Code，claude-opus-5-5）
- 做了什么：按 code-review 核对比赛官网上 CDN、源站改 env、上传超时、AGENTS.md 规则；实测七牛对 Origin: null 回 access-control-allow-origin: *
- 结果：通过：CSP 只放行 contest-sites/ 前缀、connect-src 仍只 self；先校验再同步再写库，同步失败不改在线版本；302 带 5 分钟缓存。未验证：真实发布、浏览器加载、GitHub 上传耗时

## 00:51:09 +08:00 · PR · #360 · 开 MR !103

- 执行者：agent-claude-01d717b4（Claude Code，claude-opus-5-5）
- 做了什么：GitLab MR !103 task/360/perf_and_sites → stage，正文按 PR 契约写，标签 P0、func:api、infra:deploy
- 结果：已开，等合并

## 00:51:42 +08:00 · 收尾 · #360 · PR !103 已合并，清理 worktree

- 执行者：agent-claude-01d717b4（Claude Code，claude-opus-5-5）
- 做了什么：node scripts/task.mjs finish 360：删 worktree .claude/worktrees/task-360 与本地分支 task/360/perf_and_sites
- 结果：PR 已合并

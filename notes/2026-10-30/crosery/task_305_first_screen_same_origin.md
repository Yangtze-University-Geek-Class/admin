# task/305/first_screen_same_origin · crosery · 2026-10-30

负责人：crosery

## 09:55:28 +08:00 · 开工 · #305 · 从 gitlab/stage 14e46e6d20f3 建 task/305/first_screen_same_origin

- 执行者：agent-claude-01d717b4（Claude Code，claude-opus-5-5）
- 做了什么：node scripts/task.mjs start 305 first_screen_same_origin：建分支与 worktree .claude/worktrees/task-305，在 issue 上留开工记录
- 结果：worktree 已建好，issue 上已留开工记录

## 10:31:25 +08:00 · 方案 · #305 · 首屏 JS、CSS、字体同源，只有媒体走 cdn；撤回边缘反代

- 执行者：agent-t305（Claude Code，claude-haiku-5-5，由 agent-claude-01d717b4 派遣）
- 做了什么：读 #305 的 2026-10-30 改定、STORAGE-CDN、parity 台账 P-0008/P-0009、Vite 与 Nuxt 的 renderBuiltUrl 源码（@nuxt/vite-builder 4.5.2）。现状：开关打开时 Vite 的 type=asset 一刀切，JS、CSS、字体都改到 cdn；论坛用 app.cdnURL，_nuxt/ 整体上 cdn。选定：媒体 = 非 js/mjs/css/字体的 asset 走 cdn（scripts/static-cdn-base.mjs 的 isCdnMedia、cdnMediaBuiltUrl）；论坛不再设 app.cdnURL，改用 hooks vite:extendConfig 包住 Nuxt 自己的 renderBuiltUrl。撤回 851e90d7 加的 deploy/storage-cdn/edge.caddy 及其测试和文档一节。
- 结果：cdn 上传 PUT 已带 cache-control: public, max-age=31536000, immutable（scripts/static-cdn-s3.mjs:181），公开核对只查 public 与 max-age，补查 immutable
- 下一步：先写红测试，再改实现

## 10:31:25 +08:00 · 阻塞 · #305 · 宿主 hosts 覆盖仍把 cdn 指到主站香港入口，待决定

- 执行者：agent-t305（Claude Code，claude-haiku-5-5，由 agent-claude-01d717b4 派遣）
- 做了什么：deploy/remote/cdn-mirror.hosts 第 3 行是 156.238.244.78 cdn.yangtzeu.work，Arch 镜像的 systemd 单元用它做 /etc/hosts 覆盖（BindReadOnlyPaths）。这与『cdn 不经主站』冲突；删除它会让 Arch 镜像直连 103.240.197.216（STORAGE-CDN 记录的直连往返约 230 ms）。这是宿主层物料，改它要改单元与 install-host 测试，且会改变备份镜像的网络路径。
- 结果：未改动。需要 lead 或所有者决定：删除覆盖（镜像直连，慢）还是保留（违反不经主站的决定）。本 PR 不处理。
- 下一步：决定后另开改动，不在 #305 里顺手改宿主物料

## 10:31:26 +08:00 · 开发 · #305 · 红测试：先写期望，确认失败原因

- 执行者：agent-t305（Claude Code，claude-haiku-5-5，由 agent-claude-01d717b4 派遣）
- 做了什么：改 tests/tooling/static-cdn-switch.test.ts（renderBuiltUrl 只放行媒体、isCdnMedia、cdnMediaBuiltUrl、论坛不设 cdnURL、Dockerfile 入口断言为站内）、static-cdn-http.test.ts（PUT 带 immutable 元数据；缺 immutable 与 max-age 太短的响应必须拒绝）、新增 static-cdn-build-output.test.ts（真实构建官网，核对入口与样式同源、媒体走 cdn）、portal-wallpapers.test.ts（极客娘压缩预算）
- 结果：pnpm exec vitest run（4 个文件）：11 个用例红，原因都是期望行为未实现（例如 JS 仍返回 cdn 地址、isCdnMedia 未定义、入口仍是 cdn、图片 201.7 KB 超预算）；PUT 元数据用例直接绿（已有行为）
- 下一步：实现 scripts/static-cdn-base.mjs、两个 Vite 配置、论坛 nuxt.config、两个 Dockerfile、核对 immutable

## 10:31:27 +08:00 · 开发 · #305 · 实现：媒体走 cdn，脚本与样式同源；核对 immutable；撤回边缘反代

- 执行者：agent-t305（Claude Code，claude-haiku-5-5，由 agent-claude-01d717b4 派遣）
- 做了什么：scripts/static-cdn-base.mjs 新增 isCdnMedia、cdnMediaBuiltUrl（d.mts 同步）；app/web、app/console 的 vite.config.ts 改用 cdnMediaBuiltUrl；app/forum/nuxt.config.ts 去掉 app.cdnURL 与 checkOutdatedBuildInterval 覆盖，加 hooks vite:extendConfig；两个 Dockerfile 的入口断言改为站内；scripts/static-cdn.mjs 的公开核对要求 immutable 与 max-age=31536000；删除 deploy/storage-cdn/edge.caddy，storage-cdn-config.test.ts 的边缘断言改为不存在与不经主站的守卫；STORAGE-CDN 删除主站边缘反代一节；deploy/parity/smoke.json 增加 / 与 /forum/ 两条 contains
- 结果：vitest 4 个文件：70/70 通过（含真实 vite build 官网 3/3）；root 与论坛 nuxt generate（production，STATIC_CDN_BASE 打开）通过，论坛 #entry 为 /forum/_nuxt/，cdn 引用只剩 logo.<hash>.png 与 stickers（后者基线即如此）
- 下一步：压缩极客娘；补文档；跑全量

## 10:31:27 +08:00 · 开发 · #305 · 极客娘只重新编码，分辨率保持 883×1676

- 执行者：agent-t305（Claude Code，claude-haiku-5-5，由 agent-claude-01d717b4 派遣）
- 做了什么：试过缩到 1344 与 1600 高：体积更小，但 SkyWallpaper.tsx 的比例常量与注释要改，那会把组件逻辑牵进 7 个业务域，架构对齐不过，所以不改分辨率；只改编码 q=70（sharp，effort 6，alpha 90）。另在 1344 高 q78 上核对过视觉，原图与压缩图在 2× 显示下肉眼一致
- 结果：app/web/sites/portal/assets/mascot/geek-girl.webp：201652 → 138976 字节（-31%），883×1676，透明通道保留；左右对比的 100% 人脸裁切肉眼无差别（/tmp 下的对比图）。app/cli/build.rs 也读这张图（按 40 列缩放），未重新编译 CLI
- 下一步：文档、声明、全量测试

## 10:31:28 +08:00 · 开发 · #305 · 文档与声明

- 执行者：agent-t305（Claude Code，claude-haiku-5-5，由 agent-claude-01d717b4 派遣）
- 做了什么：docs/services/web、forum、console 的 CDN 段落改为只有媒体走 cdn；docs/ops/CDN、CICD、DEPLOY、STORAGE-CDN 同步；docs/changes/305.json 重写为新范围；pnpm catalog:generate、pnpm docs:index；node scripts/check-architecture.mjs --base gitlab/stage
- 结果：check-architecture：宏观对齐通过，31 个变更文件，5 个关联节点。文档核对：docs/ops/ENVIRONMENTS.md 不用改——没有环境变量、域名或环境差异的改动，只改了 smoke.json 的断言与 deploy/storage-cdn 的模板删除
- 下一步：全量 pnpm test 与 pnpm check

## 10:51:37 +08:00 · 提交 · #305 · 三个本地提交：CDN 切换、极客娘压缩、文档与清单（未推送）

- 执行者：agent-t305（Claude Code，claude-haiku-5-5，由 agent-claude-01d717b4 派遣）
- 做了什么：本地提交 3 个，没有 merge stage、没有 push、没有开 MR：7a8d69a3 feat(tooling) 脚本与样式站内同源、只有媒体走 CDN，撤回边缘反代模板；ca13b8d1 perf(portal) 极客娘立绘重新编码；2f5143f7 docs(docs) 合同与服务文档、docs/changes/305.json、catalog 与文档索引。
- 结果：提交前已核对：node scripts/check-architecture.mjs --base gitlab/stage 宏观对齐通过（31 个变更文件，5 个关联节点）；pnpm check:catalog、pnpm check:docs 通过；node scripts/check-doc-sync.mjs --base gitlab/stage 通过；tests/tooling/static-cdn-build-output.test.ts 3/3 通过；tests/web/portal-wallpapers.test.ts 11/11 通过。全量 pnpm test 与 pnpm check 另记。
- 下一步：全量 pnpm test 与 pnpm check 结果写进 MR 正文；MR 正文写到 /tmp/takeover-312/mr/305.md；推送与开 MR 不在本次授权内。

## 11:10:19 +08:00 · 开发 · #305 · 全量验证与门禁结果；MR 正文已写，未开 MR

- 执行者：agent-t305（Claude Code，claude-haiku-5-5，由 agent-claude-01d717b4 派遣）
- 做了什么：全量 pnpm test 跑两次；逐个单独跑 pnpm check 的各门禁；撤回对 wallpapers.ts 的注释修正（改动会把 app/web 的 .ts 文件判为 business，并牵入 8 个业务域），该注释过时问题列为风险。MR 正文写到执行者本机的交接目录，未推送、未开 MR。
- 结果：全量 pnpm test 第二次：193 个文件 1 个失败（env-isolation，deploy/hotfix/windows.json 基线），3193/3221 通过。第一次另有 hotfix-sync、promotion-windows 两项负载超时，第二次与单独重跑都通过（64/64 断言）。pnpm check 串行链在 check:env-isolation 停止（基线）；逐个运行：check:runtime、site-config、environments、boundaries、docs、doc-sync（gitlab/stage）、secrets、catalog、cli、architecture（gitlab/stage）、typecheck 通过；check:notes 失败于 task_308_stage_close.md:5（基线）。
- 下一步：等待审查（CODE-REVIEW）与 MR 人工验收截图；预发布与线上核对需要 rc 标签，不在本次授权内；cdn-mirror.hosts 的决定交 lead 或所有者。

## 11:22:43 +08:00 · 返工 · #305 · 按决定恢复香港边缘模板，壁纸注释改准确（8ef91a31）

- 执行者：agent-t305（Claude Code，claude-haiku-5-5，由 agent-claude-01d717b4 派遣）
- 做了什么：依 lead 的决定：cdn-mirror.hosts 不改（只在备份镜像服务里生效，公网 DNS 不变）；恢复 deploy/storage-cdn/edge.caddy（不再删除），顶部注释改为「只有备份镜像经服务内的 hosts 走这条路，公网 DNS 仍指向对象存储机」；storage-cdn-config 测试恢复边缘模板的断言并新增注释与文档断言（先红：边缘文件注释不符，后绿）；STORAGE-CDN 与 DEPLOY 的公网入口一节改写为同样口径；wallpapers.ts 注释改为「图片是媒体，跟随开关；JS、CSS 始终同源」。
- 结果：实验：注释改动会让宏观对齐要求 business 类型，且每个受影响业务域需要流程对齐，并要有流程证据指向该文件；旧的 engineering 声明会失败（「涉及业务处理…必须声明 business」）。改为 business，流程取 audit.events.report（证据指向 wallpapers.ts:18）、competition.public.list、feedback.public.list、identity.invites.list、application.settings.read、documentation.read。check:architecture（--base gitlab/stage）通过（32 个变更文件，18 个关联节点）；check:catalog 在重新生成后通过（只有 6 个来源摘要变化）；check:docs、doc-sync（gitlab/stage）通过；storage-cdn-config + portal-wallpapers 24/24；static-cdn-build-output 3/3。P-0008（cdn A 记录）已由所有者 waived，本次未改 ledger。
- 下一步：lead 合并前跑全量 pnpm test；预发布 rc 后由 lead 核对冷加载耗时与 cdn 响应头；MR 正文更新后等待审查。

## 11:48:46 +08:00 · 返工 · #305 · 更正：ENVIRONMENTS.md 不是不用改，第 174 行已过期

- 执行者：agent-t305（Claude Code，claude-haiku-5-5，由 agent-claude-01d717b4 派遣）
- 做了什么：原记录「文档核对：docs/ops/ENVIRONMENTS.md 不用改」（开发 · 文档与声明）只看了环境变量、域名和环境差异，没有看宣传片、表情和首屏 JS 的 CDN 口径。原记录不改，这里更正。
- 结果：docs/ops/ENVIRONMENTS.md 第 174 行改为「宣传片、邮件图片、表情等媒体迁到 CDN；首屏 JS、CSS 与字体留在站内（#305）」，头部日期改为 2026-10-30；两份 nginx 模板的注释同样过期，一并修正（提交 ae0764e4）。check-doc-sync（gitlab/stage）通过。
- 下一步：后续再改 CDN 口径时，同时核对 ENVIRONMENTS.md 与 nginx 注释。

## 12:08:08 +08:00 · 返工 · #305 · 两轴审查 9 项逐项返工，每项单独提交，未 push

- 执行者：agent-t305（Claude Code，claude-haiku-5-5，由 agent-claude-01d717b4 派遣）
- 做了什么：1 声明只留 flow:audit.events.report 与 audit（d719a496），再补齐新改动的覆盖（435ece9b）；2 同构清单新增 P-0014，post_deploy，不改 P-0009（ee59bf8f）；3 ENVIRONMENTS.md 第 174 行与两份 nginx 模板注释改准确（ae0764e4），本记录的更正另见 77023780；4 CSP 开关改看 img-src 与 media-src，测试先红后绿（ce4d67bc）；5 isCdnMedia 改白名单（图片、视频、音频），测试先红（b0bbbc3a）；6 缓存头收成 CDN_CACHE_CONTROL，上传与核对共用（dcc2095f）；7 壁纸测试不再深导入 sharp，改读 WebP 文件头，九张图与 sharp 逐个一致（7e5d5be5）；8 极客娘按设备像素高度选 1x（441×837）或 2x（035a9790），先红后绿；9 提交整理见下一条记录。
- 结果：测试：14 个文件 234 项全部通过（静态 CDN 开关、上传、CSP、边缘模板、同构清单、真实构建、壁纸、档位、开机动画与手机相关）；tsc -p app/web 通过；check:docs、check:catalog（重新生成后）、doc-sync（gitlab/stage）通过。check:architecture（gitlab/stage）未通过：43 个变更文件，14 个关联节点，报错 44 条：源码影响业务域未对齐 32 条（wallpapers.ts、SkyWallpaper.tsx、BootSequence.tsx、girl.ts 各 8 个业务域）、受影响业务域缺少流程对齐 8 条、实际改动未对齐 3 条（BootSequence.tsx、girl.ts、SkyWallpaper.tsx）、业务源码未关联具体流程证据 1 条（girl.ts）。按要求没有凑数，原始报错发给了 lead。
- 下一步：等 lead 决定：这三个 UI 文件是否保留（它们确实引用了 8 个业务域的清单，需要真实的流程对齐，还是撤回对应改动）。预发布截图三张在 /tmp/takeover-312/mr/shots/。

## 12:08:18 +08:00 · 返工 · #305 · 提交整理：新旧提交号对照（历史改写只动本地未推送的提交）

- 执行者：agent-t305（Claude Code，claude-haiku-5-5，由 agent-claude-01d717b4 派遣）
- 做了什么：用 git rebase -i，GIT_SEQUENCE_EDITOR 指向脚本，非交互。7a8d69a3 按职责拆成 7 个提交（scope 改为 tooling、portal、console、forum、deploy，测试单列）；8ef91a31 按目的拆成边缘模板与壁纸声明两个提交；其余提交不变。改写前后的最终树经 git diff 核对完全相同。
- 结果：新旧提交号：7a8d69a3 → e27e83d5（tooling）、38078845（portal）、67884fc0（console）、859658d3（forum）、dc03b0b5（deploy 烟测）、9e8c68a2（deploy 撤回模板）、8dcc1a72（test）；ca13b8d1 → 4a3e887b；2f5143f7 → 31b8cfe3；e84c8750 → 403ed1a2；8ef91a31 → 7cc6fefa（边缘模板保留）与 8bbe6b3f（壁纸注释与声明）；4fec74fb → fd3fe960。之后的提交见上面的返工记录。原记录里写的旧提交号不改，以这里为准。
- 下一步：没有推送。推送与 MR 等 lead 决定。

## 12:27:11 +08:00 · 提交 · #305 · 宏观对齐：补齐桌面流程与开机极客娘的 coverage（#305）

- 执行者：agent-t305（Claude Code，claude-haiku-5-5，由 agent-claude-01d717b4 派遣）
- 做了什么：e37676b8 登记 girl.ts 的流程证据（ownership.json 的 audit.events.report），重新生成项目目录；60f9c42f 在 docs/changes/305.json 补 8 个业务域的流程对齐（application.submit、identity.current、identity.invite.redeem、feedback.submit、competition.public.list、documentation.read，audit.events.report 保留），coverage 覆盖四个桌面文件与 ownership.json。
- 结果：check:catalog 通过；node scripts/check-architecture.mjs --base gitlab/stage 通过（44 个变更文件，20 个关联节点），--body-file 读 MR 正文也通过；check-doc-sync 通过；相关 11 个测试文件 321/321 通过。documentation 未动，文档核对不需要新增。
- 下一步：等 lead 决定是否推送；P-0014 编号等 #328/#329 合并后改号；窗口打开与换档跳动未在浏览器里重新核对，列为未验证。

## 12:27:11 +08:00 · 返工 · #305 · 宏观对齐返工：按 lead 决定补真实流程声明（#305）

- 执行者：agent-t305（Claude Code，claude-haiku-5-5，由 agent-claude-01d717b4 派遣）
- 做了什么：lead 决定不撤回 1x/2x，照 #310 的先例补真实声明。public_content 没有桌面窗口的流程：桌面的「文档」项跳到独立路由 /docs，选 documentation.read 并在理由里写明它不经过窗口。
- 结果：同上两道门禁通过。MR 正文宏观对齐段落已按最终声明重写，原始报错不再出现在正文里。
- 下一步：等 lead 决定是否推送与开 MR。

## 13:49:13 +08:00 · 返工 · #305 · 同构清单改号：P-0014 改为 P-0016（#305）

- 执行者：agent-t305（Claude Code，claude-haiku-5-5，由 agent-claude-01d717b4 派遣）
- 做了什么：P-0014 已被 #328 占用，#329 占用 P-0015，本条改为 P-0016。改了 deploy/parity/ledger.json 的 id 与 docs/changes/305.json 的 reason 两处；内容、验收与 P-0009 不变。原执行记录里写的 P-0014 不改，以这里为准。提交 c0eaf8a5。
- 结果：node scripts/parity.mjs check：同构清单格式正确，共 14 条，pending 3 条；check:docs 通过（docs/INDEX.md 最新，368 份文档，Tuffex 引用完整）；node scripts/check-architecture.mjs --base gitlab/stage 通过（44 个变更文件，20 个关联节点）。分支上没有 pnpm check:privacy（#328 在 gitlab/stage 上新增，本分支基于 14e46e6d）；用 gitlab/stage 上的 scripts/check-privacy.mjs 对本工作区运行得 321 处命中，与 14e46e6d 的命中数逐文件相同，不是本 PR 新增；gitlab/stage 同一脚本为 0 处。
- 下一步：合并 gitlab/stage 时 ledger.json 与 catalog 文件会冲突（dry-run 的冲突文件 7 个），由 lead 合并时处理，并按 gitlab/stage 上的新 ledger 重新确认编号。

## 17:26:16 +08:00 · 收尾 · #305 · 放弃，清理 worktree

- 执行者：agent-claude-01d717b4（Claude Code，claude-opus-5-5）
- 做了什么：node scripts/task.mjs finish 305：删 worktree .claude/worktrees/task-305 与本地分支 task/305/first_screen_same_origin
- 结果：issue 已关闭，没有 PR（放弃）

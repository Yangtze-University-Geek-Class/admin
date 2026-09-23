# Forum 服务合同（`app/forum`）

> 直接采用 Tuff Forum 原代码、TuffEx 组件与验证方式；本机可只读显示极客班论坛快照，仍无真实认证与后端。

状态：`current` · 更新：2026-09-23 · 源码：`app/forum/` · 镜像：`yzgc/forum:<tag>`

## 源码地图

| 路径 | 职责 |
|---|---|
| `app/forum/app/pages/` | Nuxt 路由（首页、话题、分类、标签、用户、通知等） |
| `app/forum/app/components/` | 组合与展示；组件自动注册，不手工仿制同名 React 组件 |
| `app/forum/app/composables/` `app/forum/app/stores/` | 交互状态与原仓数据操作（Pinia） |
| `app/forum/app/data/` | 类型、示例种子、权限 helper 与序列化 |
| `app/forum/app/plugins/` | `persist.client.ts`（浏览器存储）、`local-snapshot.client.ts`（只读快照替换 store） |
| `app/forum/server/routes/api/local-forum/` | dev 专用只读快照路由：`state`、`assets/[hash]` |
| `app/forum/shared/` | `local-snapshot.ts`（投影校验）、`local-curation.ts`（编辑层）、`deployment.ts`（环境/版本展示） |
| `app/forum/content/` | `curation.json` 与 `posts/*.md`，快照之上的人工编辑层 |
| `app/forum/scripts/` | 上游样式 guard、路由 smoke、CDP 四套验证脚本 |
| `app/forum/UPSTREAM.json` `ADOPTION.json` `LICENSE` | 上游文件摘要、本项目集成差异清单、MIT 声明（必须保留） |
| `app/forum/Dockerfile` | Node ≥26 + pnpm 11.24.0 构建 Nuxt 静态产物 → 静态服务；镜像按 `GEEK_FORUM_BASE_PATH=/forum/` 构建（资源与路由带前缀），容器内监听 3000，不发布宿主端口；构建参数 `GEEK_DEPLOYMENT_ENVIRONMENT`/`GEEK_RELEASE_VERSION`/`GEEK_RELEASE_COMMIT` 会被校验，组合不符直接构建失败 |

## 所有权与来源

唯一活动实现为 `app/forum`。上游 `talex-touch/tuff-forum`，固定提交 `37164f75c0258b65922ea2151592e1f4efce8bde`，MIT © 2026 TalexDreamSoul。原始文件摘要见 `UPSTREAM.json`。旧 React 页面、Fastify 论坛路由和专属身份实现已归档，不再修出平行论坛。决策见 [ADR-0003](../../decisions/0003-adopt-tuff-forum.md)。

## 工程边界

Node ≥26、pnpm 11.24.0；Nuxt 4/Vue 3、Pinia、UnoCSS、TuffEx 0.6.0。独立 pnpm workspace 和锁文件，根命令只做进程编排，不能跨包导入核心 React 页面、Fastify 模块或数据库。`app/pages` 管路由，`components` 管组合，`composables` 管交互状态，`stores` 管原仓数据和操作，`data` 管类型、种子、权限与序列化。镜像以 `/forum/` 为 base 构建：会离开路由器的地址（`TxCellLink` 的 `href`、复制与分享的链接）统一经 `app/composables/useAppLink.ts` 用 `router.resolve` 带上 base，`router.push`/`navigateTo` 仍传不带前缀的路由路径。

UI 依照 [Tuffex 使用政策](../../components/tuffex/USAGE-POLICY.md)，同时保留原仓更严格的样式规则：使用真实 Tx 组件 props/slots 和 Uno 工具类，无项目自定义样式表、Vue style 块、内联样式写入。保留组件自动注册与库内图标 safelist 收集。当前全量组件 CSS 是上游明确采用的集成方案，不随意删除导致组件失样式。

## 契约：身份与数据

示例模式：`app/stores/session.ts` 的 login 只是选择示例用户；`app/plugins/persist.client.ts` 使用 localStorage 保存示例状态。没有真实认证、服务端权限、共享数据库、附件存储或邮件服务。界面权限和 store 测试仅验证演示行为，不承担安全边界。不得加载旧论坛会话或向后台传递示例 role 以取得真实权限。

只读快照模式：根 `scripts/forum.mjs start|dev` 发现 `.tools/forum-runtime/<快照>/` 或收到 `GEEK_FORUM_CONTENT_DIR` 时，把该目录交给 Nuxt。dev 专用 Nitro 路由 `server/routes/api/local-forum/state` 与 `assets/[hash]` 只读提供 `content.json`、`asset-index.json` 和 `assets/`；`app/plugins/local-snapshot.client.ts` 经 `shared/local-snapshot.ts` 校验后整体替换 store，会话固定为游客，`persist.client.ts` 不把论坛状态和会话写入 localStorage（侧栏、主题等 UI 偏好仍存本机浏览器）；示例用户选择器、重置控件和 `/new` 命令不再出现，所有「登录」触发点改为打开只读说明；`LocalSnapshotGate` 在数据到达前不挂载页面，加载失败显示错误而不回退示例种子。两条路由仅 dev 服务器提供、只接受 GET/HEAD，资产只按 64 位小写哈希解析，类型与 disposition 取自索引，SVG 不在允许列表，响应 no-store，支持单段 Range。这仍是本机只读展示：没有真实登录、写入、跨设备持久化或服务端授权；`GEEK_FORUM_SOURCE=demo` 可强制回到示例种子。

编辑层：`app/forum/content/curation.json` 与 `app/forum/content/posts/*.md` 由 `app/forum/shared/local-curation.ts` 在服务端应用于快照，再经 `parseSnapshotState` 重新校验。规则固定为：投影里标记 `archived` 的旧分类全部并入「老帖归档」一个分类，每个旧帖以 `legacy-<原分类 id>` 标签保留原分类名；`categories`/`tags` 新增新时代分类与标签，`categoryPatches` 只允许改 name/description/color/icon，`categoryOrder` 决定侧栏顺序，`topics` 可改标题、分类、标签、置顶，`posts` 用 `contentFile` 指向润色后的 Markdown。任何引用不存在的 id 都让加载失败（503 `invalid_state`），不静默跳过。编辑后需重启 `pnpm forum:start`。原投影文件不被修改；旧分类 URL（`legacyLinks.categories`）尚未映射到归档标签页。

演示种子可复现；测试不允许通过随机新 ID 改写原仓确定性约定。用户浏览器内的示例内容不在不同设备同步。上游“重置示例数据”只由用户明确点击执行，不在迁移脚本中清理用户存储。

## 称号

用户名旁显示极客班称号，与论坛角色（`User.role`：admin / moderator / member）并存，不替代它。权威清单是服务端 `app/server/src/lib/roles.ts`（经 `/api/console/catalogue` 下发）；论坛在 `app/forum/app/data/titles.ts` 保留一份零依赖副本，因为静态构建不能跨包导入核心代码。副本与服务端逐项一致：称号 id、中文、英文标签、图标、色调与 rank，干事样式（`CREW`：`CREW` 标签、`slate` 色调、rank 2），八个色调色值，四个默认部门（id、名称、标签、图标、色调）及其负责人 / 干事权限包中的 `forum.*` 部分，论坛能力清单和部门 id 格式。图标在服务端是 Carbon 名称（`star-filled`），论坛写成完整类名（`i-carbon-star-filled`）便于 UnoCSS 扫描。`app/forum/tests/titles.test.ts` 把服务端清单手抄成独立的规格表并逐项断言；服务端文件改动时这张表和论坛副本要一起改，跨包自动比对留到两边合流时补上。

| 称号 | 显示 | 图标 | 色调 | 排序 |
|---|---|---|---|---|
| `captain` | 班长 | `star-filled` | amber | 0 |
| `head` + 部门 | 「{部门} · 负责人」 | 部门图标，未知部门用 `badge` | 部门色调，未知部门 cobalt | 1 |
| `member` + 部门 | 「{部门} · 干事」 | 部门图标 | slate | 2 |
| `alumni` | 领航员（毕业的学长学姐） | `compass` | violet | 3 |
| `member` | 极客班成员 | `code` | sky | 4 |

默认部门：招新部 `recruitment`（`user-follow`，coral）、技术部 `tech`（`terminal`，jade）、社区部 `community`（`forum`，rose）、项目部 `projects`（`application`，cobalt）。控制台新建的部门论坛看不到，按通用负责人 / 干事样式显示，且不带任何论坛能力。

- **显示**：`TitleBadge.vue` 只渲染 Tuffex `TxTag`（默认 outline 配方，`color` 取清单色值），不写样式、不绑定点击，因此不成为 Tab 停留点。干事也用 outline + 清单里的中性 slate，而不是 `plain` 变体：`plain` 忽略 `color`，文字取 `--tx-text-color-secondary`，在自己的底色上不到 3:1。深色模式不另起色板，而是 `color-mix(in srgb, <清单色> 40%, var(--tx-text-color-primary))`，向 Tuffex 自己的文字令牌提亮。单测按 WCAG 公式核对：浅色沿用服务端的口径（白底与 12% 同色底 ≥5:1）；深色从 `@talex-touch/tuffex/base.css` 读出深色与深色高对比的真实令牌（`--tx-bg-color`、`-page`、`-overlay`、`--tx-fill-color-light`），在每个底色及 12% 同色底上都 ≥5:1。单测只覆盖白底：浅色页面底 `#f2f3f5`（及浅色高对比的 `#eef2f7`）上，文字本身仍 ≥5.3:1，但在 12% 同色底上 amber、violet、coral、rose、slate 降到约 4.5–4.8:1（slate 最低，约 4.5:1），高于 WCAG AA 普通文本的 4.5:1，未达服务端 5:1 的口径；称号目前都渲染在白色卡片里，因此没有另行调整色值。帖子作者行、`/users` 的「角色」列在有称号时显示称号、否则保留原角色徽章；个人页横幅同时显示称号与角色徽章。`/users` 表头仍写「角色」，因为上游目录验收逐字断言表头；排序先按称号排序值，再按角色。
- **论坛能力**：`permissions.ts#hasForumCapability(user, capability)`：admin / moderator 仍持有全部论坛能力；其他人按称号取能力（`titleForumCapabilities`，与服务端 `computeAccess` 的论坛部分一致）——班长持有全部，负责人与干事持有所在默认部门权限包里的 `forum.*`，领航员、成员、未知部门与无称号都没有。动作对应：`forum.topic.pin` 对应 pinTopic，`forum.topic.close` 对应 closeTopic，`forum.post.moderate` 对应编辑或删除他人帖子、在已关闭话题回复；`forum.category.manage` 与 `forum.badge.assign` 暂无对应动作。`isStaff`（版务，「关于」页管理团队据此显示）= 持有 `forum.post.moderate`，与控制台「论坛管理」页的版务定义一致：默认是 admin、moderator、班长、社区部负责人和社区部干事。话题页的「话题管理」菜单不看 `isStaff`，而是逐项问 `can()`：能置顶或能关闭就显示菜单，菜单里只列本人能用的项。项目部负责人只能置顶、不算版务，菜单里只有「置顶话题」。这仍是前端演示权限，不是服务端授权。
- **种子**：talex 班长、mika 社区部负责人、yuki 技术部负责人、kai 技术部干事、lin 领航员，ryan 等六人为成员，bruce 无称号；所有 `role` 不变，上游验收用到的 ryan / xiaoyu 仍是普通成员。`FORUM_STATE_VERSION` 仍为 1，浏览器里已有的示例数据要点「重置示例数据」才会出现称号。
- **快照**：`shared/local-snapshot.ts` 校验可选的 `title`（对象、id 属于可存储称号且不是 guest、department 符合部门 id 格式），不合法即 `invalid_state`。真实成员的称号需要所有者提供名单，本期快照不带称号。

## 环境与版本显示

“关于”页的 DeploymentInfo 显示 local / preview / production，并按 [RELEASES](../../conventions/RELEASES.md) 说明预发布对应 `stage` 分支、版本显示 `X.Y.Z@<sha12>`，正式对应 `main` 分支、显示 `X.Y.Z`。固定域名来自根 [deploy/environments.json](../../../deploy/environments.json)：`prev.yangtzeu.work` 预发布，`yangtzeu.work` 正式；两套环境同机不同栈，容器内论坛端口都是 3000，宿主侧由 `web` 容器按 `/forum` 路径反代。本机明确标记“本地开发 · 未发布”，另按内容来源标记“上游示例”或“极客班论坛只读快照 + 采集时间”。Nuxt 配置只读取公共的域名/版本合同，不跨模块引用 React、Fastify 或业务数据。`GEEK_RELEASE_VERSION` 和完整 `GEEK_RELEASE_COMMIT` 只由受控构建注入，不是人已验收的证据。

## 运行

```bash
pnpm forum:install   # 独立锁文件安装
pnpm forum:start     # 本机 http://127.0.0.1:3456/（发现快照目录即只读快照模式）
pnpm forum:status    # contentSource、mode、snapshotConfigured
pnpm forum:stop
```

工具链选择见 [TUFF-FORUM](../../ops/TUFF-FORUM.md)；容器内由 `yzgc/forum` 镜像提供静态产物，web 容器以 `proxy_pass http://forum:3000/`（尾斜杠剥离 `/forum` 前缀）反代。

## 验证命令

```bash
pnpm forum:check     # Nuxt 类型、测试类型、ESLint、样式 guard、Vitest
pnpm forum:generate  # 静态构建（始终以示例种子运行）
pnpm forum:verify    # guard 自测 + 原仓 CDP 四套交互 + 全路由 smoke
node scripts/check-forum-adoption.mjs   # 上游文件摘要与集成差异
```

CDP 使用独立临时浏览器，只清理本次进程组。原仓单测与旧 Fastify 的历史测试不能混算。`forum:check/generate/verify` 始终以示例种子运行、不转发快照目录；3456 上若有快照模式预览，`forum:verify` 拒绝执行并要求先 `forum:stop`。快照文档与资产索引的解析规则由 `app/forum/tests/local-snapshot.test.ts` 用虚构夹具覆盖，测试不读取真实投影。

## 已知限制与生产准入

- 快照投影仍在 `.tools/` 私有目录，不进 Git、CI 缓存或发布包；`pnpm forum:generate` 产物中不存在 dev 专用路由。
- 真实统一认证、后端持久化、服务器授权与内部 Hub 未实现前，不作为生产内部论坛开放。后续在该原代码上接入真实服务，而不是重新启用旧论坛。
- 原始数据库和附件已按后续明确授权拉到 Mac 私有备份目录，见 [数据保全](../../ops/FORUM-DATA-CAPTURE.md)；由 `prepare.py` 生成的只读投影可按上文快照模式在本机显示，但未导入可写数据库、未激活旧会话。
- 目标数据模型转换、身份认领和上线仍需另行设计/验收，不删除源数据。

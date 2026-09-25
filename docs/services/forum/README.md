# Forum 服务合同（`app/forum`）

> 直接采用 Tuff Forum 原代码、TuffEx 组件与验证方式；线上镜像是极客班论坛自己的站名、分类和标签（还没有帖子）；本机可显示极客班论坛快照；登录只走全站 GitHub 登录（上游验收与本机示例预览除外）；论坛仍没有后端。

状态：`current` · 更新：2026-09-25 · 源码：`app/forum/` · 镜像：`yzgc-<environment>/forum:<sha12>`

## 源码地图

| 路径 | 职责 |
|---|---|
| `app/forum/app/pages/` | Nuxt 路由（首页、话题、分类、标签、用户、通知等） |
| `app/forum/app/components/` | 组合与展示；组件自动注册，不手工仿制同名 React 组件 |
| `app/forum/app/composables/` `app/forum/app/stores/` | 交互状态与原仓数据操作（Pinia）；`useSiteAccount.ts` 读全站登录（同域 `/auth/me`）、退出、说明登录结果 |
| `app/forum/app/data/` | 类型、示例种子、权限 helper 与序列化 |
| `app/forum/app/plugins/` | `persist.client.ts`（浏览器存储）、`local-snapshot.client.ts`（只读快照替换 store）、`site-state.client.ts`（极客班论坛：挂载前换成自己的分类和标签，会话固定为游客） |
| `app/forum/server/routes/api/local-forum/` | dev 专用只读快照路由：`state`、`assets/[hash]` |
| `app/forum/server/middleware/forum-markdown.ts` | 给 AI 读取的 `/t/<id>.md` 与 `/llms.txt`，`nuxt generate` 时逐个写成静态文件 |
| `app/forum/shared/` | `content-source.ts`（按构建环境选内容来源、站名与登录方式）、`site-state.ts`（极客班论坛的初始状态）、`local-snapshot.ts`（投影校验）、`local-curation.ts`（编辑层）、`deployment.ts`（环境/版本展示）、`forum-markdown.ts`（话题 Markdown 与 llms.txt 的生成规则） |
| `app/forum/content/` | `curation.json` 与 `posts/*.md`，快照之上的人工编辑层；镜像的分类和标签也取自 `curation.json` |
| `app/forum/scripts/` | 上游样式 guard、路由 smoke、CDP 四套验证脚本；`csp-header.mjs`（本项目新增）在镜像构建时把产物里内联脚本的 sha256 加进站点 CSP，写成容器 nginx 的 `add_header` |
| `app/forum/UPSTREAM.json` `ADOPTION.json` `LICENSE` | 上游文件摘要、本项目集成差异清单、MIT 声明（必须保留） |
| `app/forum/Dockerfile` | Node ≥26 + pnpm 11.24.0 构建 Nuxt 静态产物 → 静态服务；镜像按 `GEEK_FORUM_SOURCE=site`（极客班论坛，见下文「内容来源」）和 `GEEK_FORUM_BASE_PATH=/forum/` 构建（资源与路由带前缀），构建内断言 `llms.txt` 写的是极客班论坛、没有 `t/` 目录、产物里没有上游示例内容（`Tuff 2.5`、`CoreBox`），容器内监听 3000，不发布宿主端口；构建参数 `GEEK_DEPLOYMENT_ENVIRONMENT`/`GEEK_RELEASE_VERSION`/`GEEK_RELEASE_COMMIT` 会被校验，组合不符直接构建失败；容器 nginx 把 `*.md` 发成 `text/markdown; charset=utf-8`、`llms.txt` 发成 `text/plain; charset=utf-8`，文件不存在时返回 404，不回落页面；页面带一份 CSP（站点策略取自 `deploy/nginx/production.conf` 的 map，加上本次产物内联脚本的哈希），宿主在 `/forum/` 下看到后不再叠加；页面与回落页都不缓存（`expires -1`） |

## 所有权与来源

唯一活动实现为 `app/forum`。上游 `talex-touch/tuff-forum`，固定提交 `37164f75c0258b65922ea2151592e1f4efce8bde`，MIT © 2026 TalexDreamSoul。原始文件摘要见 `UPSTREAM.json`。旧 React 页面、Fastify 论坛路由和专属身份实现已归档，不再修出平行论坛。决策见 [ADR-0003](../../decisions/0003-adopt-tuff-forum.md)。

## 工程边界

Node ≥26、pnpm 11.24.0；Nuxt 4/Vue 3、Pinia、UnoCSS、TuffEx 0.6.0。独立 pnpm workspace 和锁文件，根命令只做进程编排，不能跨包导入核心 React 页面、Fastify 模块或数据库。`app/pages` 管路由，`components` 管组合，`composables` 管交互状态，`stores` 管原仓数据和操作，`data` 管类型、种子、权限与序列化。镜像以 `/forum/` 为 base 构建：会离开路由器的地址（`TxCellLink` 的 `href`、复制与分享的链接）统一经 `app/composables/useAppLink.ts` 用 `router.resolve` 带上 base，`router.push`/`navigateTo` 仍传不带前缀的路由路径。

UI 依照 [Tuffex 使用政策](../../components/tuffex/USAGE-POLICY.md)，同时保留原仓更严格的样式规则：使用真实 Tx 组件 props/slots 和 Uno 工具类，无项目自定义样式表、Vue style 块、内联样式写入。保留组件自动注册与库内图标 safelist 收集。当前全量组件 CSS 是上游明确采用的集成方案，不随意删除导致组件失样式。

## 契约：身份与数据

登录方式与内容来源是两件事。内容来源是极客班论坛、示例种子或本机快照（见下）；登录方式由 `nuxt.config.ts` 的 `loginMode` 决定：默认 `site`（全站统一登录，见下文「全站登录」），部署镜像、`forum:generate`、极客班论坛和快照模式都是它；只有 `scripts/forum.mjs` 在示例种子上为 `verify`（上游 CDP 验收）和 `start`/`dev`（本机示例预览）设 `GEEK_FORUM_LOGIN=demo`，这时才是上游的示例登录。快照模式永远是 `site`。

内容来源：构建时由 `shared/content-source.ts` 的 `selectContentSource`（单测 `tests/content-source.test.ts`）按环境变量决定，`nuxt.config.ts` 只调用它：`GEEK_FORUM_SOURCE=site` 是极客班论坛（`contentSource: site`，站名「极客班论坛」，不读任何内容目录）；`GEEK_FORUM_SOURCE=demo` 是上游示例种子（站名 Tuff Forum，压过任何快照目录）；不设置时 `GEEK_FORUM_CONTENT_DIR` 非空是本机只读快照（站名「极客班论坛」），否则是示例种子；其它取值直接让构建失败。

极客班论坛（`contentSource: site`，预发布与正式镜像）：`shared/site-state.ts` 的 `siteForumState()` = 空状态 + `content/curation.json` 里的分类（按 `categoryOrder`：班级公告、课程与作业、竞赛与项目、求职与升学、人工智能）和标签；没有用户、话题、帖子、通知、书签、关注。只按名字取 `categories`/`categoryOrder`/`tags` 三个字段，`curation.json` 里的快照话题标题和正文补丁不进浏览器产物（它们的作者只在私有快照里）。构建常量 `import.meta.env.GEEK_FORUM_SITE`（`nuxt.config.ts` 的 `vite.define`）让 `stores/forum.ts` 的初始状态直接是 `siteForumState()`，`createSeed` 与示例帖子整段不进产物；`app/plugins/site-state.client.ts` 在挂载前再换一次状态并把会话设为游客，示例种子一帧也不会出现。`persist.client.ts` 不读也不写浏览器里的论坛状态和会话。页面文案：顶部提示「论坛刚换到新系统，发帖和回复还没开放，以前的帖子暂时不显示。」加统一登录那句；关于页是一段极客班论坛简介和一行出处（基于开源项目 Tuff Forum，talex-touch/tuff-forum，MIT 许可），不显示用户/话题/帖子数字和管理团队；首页、单个类别页和标签页的话题列表以及类别总览的「最新」在没有话题时显示「还没有话题 / 发帖和回复还没开放。」，用户页显示「还没有用户 / 成员列表还没接入。」；系统通知写「来自极客班论坛的系统消息」。

示例登录（`loginMode=demo`）：`app/stores/session.ts` 的 login 只是选择示例用户；`app/plugins/persist.client.ts` 使用 localStorage 保存示例状态。没有真实认证、服务端权限、共享数据库、附件存储或邮件服务。界面权限和 store 测试仅验证演示行为，不承担安全边界。不得加载旧论坛会话或向后台传递示例 role 以取得真实权限。

只读快照模式：根 `scripts/forum.mjs start|dev` 发现 `.tools/forum-runtime/<快照>/` 或收到 `GEEK_FORUM_CONTENT_DIR` 时，把该目录交给 Nuxt。dev 专用 Nitro 路由 `server/routes/api/local-forum/state` 与 `assets/[hash]` 只读提供 `content.json`、`asset-index.json` 和 `assets/`；`app/plugins/local-snapshot.client.ts` 经 `shared/local-snapshot.ts` 校验后整体替换 store，论坛 store 的会话固定为游客，`persist.client.ts` 不把论坛状态和会话写入 localStorage（侧栏、主题等 UI 偏好仍存本机浏览器）；示例用户选择器、重置控件和 `/new` 命令不再出现（统一登录下都不出现），登录见下文「全站登录」；`LocalSnapshotGate` 在数据到达前不挂载页面，加载失败显示错误而不回退示例种子。两条路由仅 dev 服务器提供、只接受 GET/HEAD，资产只按 64 位小写哈希解析，类型与 disposition 取自索引，SVG 不在允许列表，响应 no-store，支持单段 Range。这仍是本机只读展示：没有写入、跨设备持久化或服务端授权；`GEEK_FORUM_SOURCE=demo` 可强制回到示例种子。

全站登录（`loginMode=site`）：论坛没有自己的登录，登录就是核心服务的 GitHub 登录（`/auth/github` → GitHub → `/auth/callback`，写下 `sid`），官网、论坛、控制台共用这一个 cookie，只有 `CONSOLE_ORG` 的 active 成员能登录成功（规则见 [SECURITY](../../architecture/SECURITY.md)）。`useSiteAccount.ts` 在浏览器里读同域 `/auth/me`：返回 `signed_in: true` 就是已登录，404、HTML 或请求失败都当作未登录。`ForumHeader.vue` 右上角是唯一入口，`/auth/me` 读完之前不显示：未登录是 Tuffex 按钮「用 GitHub 登录」（窄屏只写「登录」，读屏名称不变），跳到 `/auth/github?return_to=<当前论坛页面的完整地址，含查询和锚点>`（非开发态由 `useAppLink().absoluteUrl(route.fullPath)` 生成，带 `/forum` 前缀）；开发态指向 `http://127.0.0.1:5173/auth/github?return_to=http://127.0.0.1:5173/forum<当前路径>`，因为 `return_to` 只接受 `PUBLIC_ORIGIN`。已登录是 GitHub 头像，菜单里是 `@<登录名>`、「控制台」（线上同域 `/console`，开发态 `http://127.0.0.1:5173/console`）和「退出」（`POST /auth/signout`，全站一起退出；服务端返回成功才显示已退出，失败弹 toast「没有退出成功」）。账号只在顶栏右上角：`ForumSidebar.vue` 没有站点卡片也没有账号卡片（所有者 2026-09-25，#62），侧栏第一行就是「筛选侧栏」；极客班校徽（`/logo.png`）放在顶栏左上角站名前，取代 Tuffex 的描边标志。登录没成功时核心服务带 `?signin=<原因>` 回到原页面，`useSiteAccount` 按原因弹一次 Tuffex toast（8 秒）并用 `router.replace` 去掉这个参数，刷新不会重复提示：

| `signin` | 标题 | 说明 |
|---|---|---|
| `not_member` | 只有极客班成员可以登录 | 这个 GitHub 账号不在极客班的 GitHub 组织里。不登录也能看帖子。 |
| `invite_pending` | 还没接受组织邀请 | 到 GitHub 的通知或邮件里接受极客班组织的邀请，再回来登录。 |
| `cancelled` | 已取消登录 | 需要时再点右上角的登录。 |
| `failed` | 登录没有完成 | 请稍后再试一次。 |

去掉 `signin` 参数时保留锚点（`#post-N`）。

登录只识别身份，GitHub 账号不对应任何论坛成员，store 会话仍是游客，所以已登录的成员也不能发帖、回复。`/new`、`/bookmarks`、`/notifications`、`/u/<用户名>/preferences` 对游客显示「发帖还没开放」「书签还没开放」「通知还没开放」「资料修改还没开放」和「……正在接入」，没有登录按钮；`TopicControls.vue` 的游客提示是「回复还没开放」。每一帖的「赞」「书签」和个人页的「关注」按钮仍然显示；点击会打开 `loginOpen`，统一登录下 `LoginModal.vue` 不渲染示例选择器，而是弹 toast「现在还不能操作 / 发帖、回复、点赞和收藏正在接入，现在可以浏览。」再关上。`persist.client.ts` 在统一登录下不恢复浏览器里存过的示例会话。线上论坛与核心同域（`/forum/` 由 web 容器反代），直接请求 `/auth/me`；本机论坛单独跑在 3456，`nuxt.config.ts` 的 `nitro.devProxy` 把 `/auth` 转给 `http://127.0.0.1:3000/auth`，并把 `Origin` 换成 `http://127.0.0.1:5173`（核心只接受 `PUBLIC_ORIGIN` 的写请求，否则退出会被 403），这条代理不进静态产物（见 [LOCAL-PREVIEW](../../ops/LOCAL-PREVIEW.md)）。示例登录：顶栏仍是上游的示例「登录」和用户菜单（菜单第一行是「@<用户名> · <角色>」），不显示全站账号；侧栏只剩「重置示例数据」；`useSiteAccount` 在两种登录方式下都会读 `/auth/me` 并处理 `?signin=`。

编辑层：`app/forum/content/curation.json` 与 `app/forum/content/posts/*.md` 由 `app/forum/shared/local-curation.ts` 在服务端应用于快照，再经 `parseSnapshotState` 重新校验。规则固定为：**旧论坛内容默认不显示**（`legacy.mode = "hide"`，所有者 2026-09-24：「我们不要老帖归档，目前的数据都不需要了」）——投影里标记 `archived` 的旧主题连同回复、旧分类、只被旧帖用到的标签、只出现在旧帖里的账号都去掉，也没有「老帖归档」类别；所有者挑出的代表性旧帖把话题编号写进 `legacy.include` 就按普通话题重新显示（取消置顶，通常再用 `topics` 放进新类别），编号不存在时加载失败。`legacy.mode = "archive"` 保留旧行为（旧分类并入「老帖归档」，每个旧帖以 `legacy-<原分类 id>` 标签保留原分类名），只用于回看。`categories`/`tags` 新增新时代分类与标签，`categoryPatches` 只允许改 name/description/color/icon，`categoryOrder` 决定侧栏顺序，`topics` 可改标题、分类、标签、置顶，`posts` 用 `contentFile` 指向润色后的 Markdown。任何引用不存在的 id 都让加载失败（503 `invalid_state`），不静默跳过。编辑后需重启 `pnpm forum:start`。原投影文件不被修改；旧分类 URL（`legacyLinks.categories`）尚未映射到归档标签页。

演示种子可复现；测试不允许通过随机新 ID 改写原仓确定性约定。用户浏览器内的示例内容不在不同设备同步。上游“重置示例数据”只由用户明确点击执行，不在迁移脚本中清理用户存储。

## 称号

用户名旁显示极客班称号，与论坛角色（`User.role`：admin / moderator / member）并存，不替代它。称号是数据：名字、英文标签、图标、色调和说明由提督在控制台改，存在核心服务的 `titles` 表里。论坛启动后由 `app/composables/useOrgTitles.ts` 读一次同域的匿名接口 `GET /api/public/org`（本机经 `nuxt.config.ts` 的 devProxy 转到 3000），用纯函数 `applyPublicOrg` 叠在 `app/forum/app/data/titles.ts` 的默认值上；读不到、形状不对就保持默认值，不报错。默认值与服务端默认值逐项一致（`tests/titles-server-parity.test.ts` 核对）：称号 id、中文、英文标签、图标、色调、rank 与说明，部门舰员样式（`CREW`：slate、rank 3），八个色调色值，四个默认部门。图标在服务端是 Carbon 名称，论坛用字面量类名表 `ICON_CLASSES` 覆盖全部 18 个可选图标（UnoCSS 只生成看得见的字面量），认不出的图标或色调退回该称号的默认值；控制台新建的部门也按服务端给的名字和图标显示。

| 称号 | 默认显示 | 标签 | 图标 | 色调 | 排序 |
|---|---|---|---|---|---|
| `admin` | 提督（GitHub 组织 owner） | `ADMIRAL` | `user-admin` | violet | 0 |
| `captain` | 舰长 | `CAPTAIN` | `star-filled` | amber | 1 |
| `head` + 部门 | 「{部门} · 队长」 | `LEADER` | 部门图标，未知部门用 `badge` | 部门色调，未知部门 cobalt | 2 |
| `member` + 部门 | 「{部门} · 舰员」 | `CREW` | 部门图标 | slate | 3 |
| `alumni` | 领航员（毕业的学长学姐） | `NAVIGATOR` | `compass` | jade | 4 |
| `member` | 舰员 | `CREW` | `code` | sky | 5 |

表里是默认值，控制台改过的以 `/api/public/org` 为准；称号 id 与存储值不变。乘客（`guest`，`PASSENGER`）不在论坛显示。

默认部门：招新部 `recruitment`（`user-follow`，coral）、技术部 `tech`（`terminal`，jade）、社区部 `community`（`forum`，rose）、项目部 `projects`（`application`，cobalt）。控制台新建的部门按 `/api/public/org` 给的名字、图标和色调显示，但不带任何论坛能力。

- **显示**：`TitleBadge.vue` 只渲染 Tuffex `TxTag`（默认 outline 配方，`color` 取清单色值），不写样式、不绑定点击，因此不成为 Tab 停留点。部门舰员也用 outline + 清单里的中性 slate，而不是 `plain` 变体：`plain` 忽略 `color`，文字取 `--tx-text-color-secondary`，在自己的底色上不到 3:1。深色模式不另起色板，而是 `color-mix(in srgb, <清单色> 40%, var(--tx-text-color-primary))`，向 Tuffex 自己的文字令牌提亮。单测按 WCAG 公式核对：浅色沿用服务端的口径（白底与 12% 同色底 ≥5:1）；深色从 `@talex-touch/tuffex/base.css` 读出深色与深色高对比的真实令牌（`--tx-bg-color`、`-page`、`-overlay`、`--tx-fill-color-light`），在每个底色及 12% 同色底上都 ≥5:1。单测只覆盖白底：浅色页面底 `#f2f3f5`（及浅色高对比的 `#eef2f7`）上，文字本身仍 ≥5.3:1，但在 12% 同色底上 amber、violet、coral、rose、slate 降到约 4.5–4.8:1（slate 最低，约 4.5:1），高于 WCAG AA 普通文本的 4.5:1，未达服务端 5:1 的口径；称号目前都渲染在白色卡片里，因此没有另行调整色值。帖子作者行、`/users` 的「角色」列在有称号时显示称号、否则保留原角色徽章；个人页横幅同时显示称号与角色徽章。`/users` 表头仍写「角色」，因为上游目录验收逐字断言表头；排序先按称号排序值，再按角色。
- **论坛能力**：`permissions.ts#hasForumCapability(user, capability)`：admin / moderator 仍持有全部论坛能力；其他人按称号取能力（`titleForumCapabilities`）——提督和舰长持有全部，队长与部门舰员持有所在默认部门权限包里的 `forum.*`，领航员、不属于部门的舰员、未知部门与无称号都没有。动作对应：`forum.topic.pin` 对应 pinTopic，`forum.topic.close` 对应 closeTopic，`forum.post.moderate` 对应编辑或删除他人帖子、在已关闭话题回复；`forum.category.manage` 与 `forum.badge.assign` 暂无对应动作。`isStaff`（版务，「关于」页管理团队据此显示）= 持有 `forum.post.moderate`，与控制台「论坛管理」页的版务定义一致：默认是 admin、moderator、舰长、社区部队长和社区部舰员。话题页的「话题管理」菜单不看 `isStaff`，而是逐项问 `can()`：能置顶或能关闭就显示菜单，菜单里只列本人能用的项。项目部队长只能置顶、不算版务，菜单里只有「置顶话题」。这仍是前端演示权限，不是服务端授权。 **遗留**：论坛能力仍按 `titles.ts` 里默认部门的权限包计算，控制台改过的称号权限、部门权限包还不会影响论坛——公开接口 `/api/public/org` 不下发权限包；论坛后端（#57）接上服务端授权后改为以服务端为准。
- **种子**：talex 舰长、mika 社区部队长、yuki 技术部队长、kai 技术部舰员、lin 领航员，ryan 等六人为舰员，bruce 无称号；所有 `role` 不变，上游验收用到的 ryan / xiaoyu 仍是普通成员。`FORUM_STATE_VERSION` 仍为 1，浏览器里已有的示例数据要点「重置示例数据」才会出现称号。
- **快照**：`shared/local-snapshot.ts` 校验可选的 `title`（对象、id 属于可存储称号且不是 guest、department 符合部门 id 格式），不合法即 `invalid_state`。真实成员的称号需要所有者提供名单，本期快照不带称号。

## 契约：给 AI 读取的 Markdown

帖子正文本来就是 Markdown，页面把它渲染成 HTML。在话题地址后面加 `.md` 拿到的是同一份原文，供 AI 和脚本读取；`llms.txt` 按 [llms.txt](https://llmstxt.org/) 约定列出全部话题。

| 地址（线上前缀 `/forum`） | 类型 | 内容 |
|---|---|---|
| `/forum/t/<id>.md` | `text/markdown; charset=utf-8` | YAML 头（`title`、`category`、`author`、`author_username`、`created` ISO 8601、有标签时 `tags`、`replies`、`url` 为话题页地址），然后是标题、首帖原文，最后 `## 回复` 下按楼层排列的回复，每条以 `### #<楼层> <显示名> (@<用户名>) · <时间>` 开头；回复某一楼时下一行写明「回复 #<楼层>」；已删除的帖子只写「（此帖已被删除）」 |
| `/forum/llms.txt` | `text/plain; charset=utf-8` | 标题、一段说明，然后每个分类一节，每个话题一行 `- [标题](.md 地址): 首帖摘要`；置顶在前，其余按发帖时间从新到旧 |
| 话题页 `<head>` | — | `<link rel="alternate" type="text/markdown" href="/forum/t/<id>.md">`，只在该话题有 `.md` 文件时出现 |

正文与回复原样输出页面渲染用的 Markdown，不转成 HTML；标题、显示名、摘要这类纯文本字段转义 Markdown 符号。生成规则只在 `shared/forum-markdown.ts` 一处，由 `tests/forum-markdown.test.ts` 覆盖转义、代码块原样保留、楼层顺序和无回复的情况。链接的站点前缀取自环境契约：正式与预发布构建是 `https://<域名>/forum/…`，本机是站点相对路径。

**限制**：论坛还没有后端。静态产物里只有 `nuxt generate` 时写出的文件：极客班论坛（镜像）还没有话题，只有一份 `llms.txt`，写明站名和「还没有话题。」，没有 `t/<id>.md`，话题页也不输出 `alternate` 链接；示例种子的构建是每个话题（`t1`…`tN`）加一份 `llms.txt`，有 `.md` 的话题编号经运行时配置 `markdownTopicIds` 传给页面。用户在浏览器里新发的话题和回复只存在该浏览器的 localStorage，服务器上没有对应的 `.md`，请求会得到 404，这类话题页也不输出 `alternate` 链接。已有种子话题在浏览器里新增的回复、编辑、删除同样不会出现在 `.md` 里，文件内容停在构建时刻，时间也按构建时刻推算。本机 dev 服务器配置了只读快照时，`.md` 与 `llms.txt` 按请求从快照生成，覆盖快照里的全部话题；快照不进静态产物。接入真实后端后改由服务端按数据库生成。

## 环境与版本显示

“关于”页的 DeploymentInfo 显示 local / preview / production，并按 [RELEASES](../../conventions/RELEASES.md) 说明发版方式：预发布由打在 `stage` 提交上的 `vX.Y.Z-rc.N` tag 部署，版本显示 `X.Y.Z-rc.N@<sha12>`；正式由打在 `main` 同一提交上的 `vX.Y.Z` tag 部署，显示 `X.Y.Z`；推送分支本身不部署。固定域名来自根 [deploy/environments.json](../../../deploy/environments.json)：`prev.yangtzeu.work` 预发布，`yangtzeu.work` 正式；两套环境同机不同栈，容器内论坛端口都是 3000，宿主侧由 `web` 容器按 `/forum` 路径反代。本机明确标记“本地开发 · 未发布”，另按内容来源说明「当前页面是极客班论坛，发帖和回复还没接入。」（极客班论坛）、「当前页面仍使用上游示例内容」（示例种子）或「当前页面显示极客班论坛的帖子，发帖与回复还没接入」（快照）；快照模式下「关于」页写「当前显示极客班论坛的公开内容（更新于 <采集时间>）」，界面不再出现「只读快照」字样。Nuxt 配置只读取公共的域名/版本合同，不跨模块引用 React、Fastify 或业务数据。`GEEK_RELEASE_VERSION` 和完整 `GEEK_RELEASE_COMMIT` 只由受控构建注入，不是人已验收的证据。`-rc.N` 只能与 `@<sha12>` 同时出现且只用于预发布，`<sha12>` 必须等于提交前 12 位；`shared/deployment.ts` 对其它组合直接报错，构建因此失败。

## 运行

```bash
pnpm forum:install   # 独立锁文件安装
pnpm forum:start     # 本机 http://127.0.0.1:3456/（发现快照目录即只读快照模式）
pnpm forum:status    # contentSource、mode、snapshotConfigured
pnpm forum:stop
```

工具链选择见 [TUFF-FORUM](../../ops/TUFF-FORUM.md)；容器内由 `yzgc-<environment>/forum` 镜像提供静态产物，web 容器以 `proxy_pass http://forum:3000/`（尾斜杠剥离 `/forum` 前缀）反代。

## 验证命令

```bash
pnpm forum:check     # Nuxt 类型、测试类型、ESLint、样式 guard、Vitest
pnpm forum:generate  # 静态构建（默认示例种子），产物含每个种子话题的 t/<id>.md 与 llms.txt
GEEK_FORUM_SOURCE=site GEEK_FORUM_BASE_PATH=/forum/ node scripts/forum.mjs generate  # 按镜像的方式构建极客班论坛，只有 llms.txt
pnpm forum:verify    # guard 自测 + 原仓 CDP 四套交互 + 全路由 smoke
node scripts/check-forum-adoption.mjs   # 上游文件摘要与集成差异
```

CDP 使用独立临时浏览器，只清理本次进程组。原仓单测与旧 Fastify 的历史测试不能混算。`forum:check/generate/verify` 默认以示例种子运行、不转发快照目录；调用方给 `GEEK_FORUM_SOURCE=site` 时 `check`/`generate` 按极客班论坛构建，`verify` 忽略它（上游 CDP 套件断言示例数据）。3456 上若有快照模式或极客班论坛模式的预览，`forum:verify` 拒绝执行并要求先 `forum:stop`。快照文档与资产索引的解析规则由 `app/forum/tests/local-snapshot.test.ts` 用虚构夹具覆盖，测试不读取真实投影。

## 已知限制与生产准入

- 快照投影仍在 `.tools/` 私有目录，不进 Git、CI 缓存或发布包；`pnpm forum:generate` 产物中不存在 dev 专用路由。
- 全站 GitHub 登录已接入界面，但论坛后端持久化、服务器授权与内部 Hub 未实现前（#57），不作为生产内部论坛开放。后续在该原代码上接入真实服务，而不是重新启用旧论坛。
- 镜像（预发布、正式）是极客班论坛：站名、分类和标签是自己的，还没有帖子、用户和通知（快照不进镜像，上游示例内容也不进），登录方式是全站统一登录：顶栏只有「用 GitHub 登录」，登录后显示头像；顶部提示与关于页写明发帖和回复还没开放、以前的帖子暂时不显示。论坛后端见 #57。
- 发帖、回复、点赞、书签、通知、资料修改都没有后端；这些按钮只弹「现在还不能操作」。
- 原始数据库和附件已按后续明确授权拉到 Mac 私有备份目录，见 [数据保全](../../ops/FORUM-DATA-CAPTURE.md)；由 `prepare.py` 生成的只读投影可按上文快照模式在本机显示，但未导入可写数据库、未激活旧会话。
- 目标数据模型转换、身份认领和上线仍需另行设计/验收，不删除源数据。**未做**：旧论坛账号（包括当年用 GitHub 登录过的）还没有和现在的 GitHub 登录关联，改过的姓名也没有同步，登录后不会自动认领旧帖子。

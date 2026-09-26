# Forum 服务合同（`app/forum`）

> 直接采用 Tuff Forum 原代码、TuffEx 组件与验证方式；线上镜像是极客班论坛：帖子、回复、资料存在核心服务（同域 `/api/forum/*`，#57），游客能看帖和用昵称回复，成员用全站 GitHub 登录后发帖、点赞、收藏、关注、改资料；本机可显示极客班论坛快照；上游验收与本机示例预览仍是浏览器里的示例数据。

状态：`current` · 更新：2026-09-26 · 源码：`app/forum/` · 镜像：`yzgc-<environment>/forum:<sha12>`

## 源码地图

| 路径 | 职责 |
|---|---|
| `app/forum/app/pages/` | Nuxt 路由（首页、话题、分类、标签、用户、通知等） |
| `app/forum/app/components/` | 组合与展示；组件自动注册，不手工仿制同名 React 组件 |
| `app/forum/app/composables/` `app/forum/app/stores/` | 交互状态与原仓数据操作（Pinia）；`useSiteAccount.ts` 读全站登录（同域 `/auth/me`，含 `console_link`）、退出、说明登录结果；`stores/forum-server.ts` 在极客班论坛里读写论坛后端；`useForumActions.ts` 是页面唯一的写入口（服务端模式调接口，示例模式改本机 store）；`useSiteLinks.ts` 是登录、控制台、宣传主页三个站外地址 |
| `app/forum/app/data/` | 类型、示例种子、权限 helper 与序列化；`access.ts`（各模式下谁能写、游客能不能回复）、`account-menu.ts`（头像菜单有哪些行） |
| `app/forum/app/plugins/` | `persist.client.ts`（浏览器存储）、`local-snapshot.client.ts`（只读快照替换 store）、`site-state.client.ts`（极客班论坛：挂载前换成构建时的公开旧帖和游客会话，再向论坛后端要整份状态） |
| `app/forum/server/routes/api/local-forum/` | dev 专用只读快照路由：`state`、`assets/[hash]` |
| `app/forum/server/middleware/forum-markdown.ts` | 给 AI 读取的 `/t/<id>.md` 与 `/llms.txt`，`nuxt generate` 时逐个写成静态文件 |
| `app/forum/shared/` | `content-source.ts`（按构建环境选内容来源、站名与登录方式）、`site-state.ts`（极客班论坛的初始状态）、`local-snapshot.ts`（投影校验）、`local-curation.ts`（编辑层）、`deployment.ts`（环境/版本展示）、`forum-markdown.ts`（话题 Markdown 与 llms.txt 的生成规则）、`forum-api.ts`（论坛后端的浏览器客户端与返回值校验）、`pow.ts`（游客回复的工作量证明，Web Crypto）、`post-markdown.ts`（帖子正文渲染前的转义）、`turnstile.ts`（按需加载 Turnstile）、`site-notice.ts`（极客班论坛现状的几句话，提示条、关于页与 llms.txt 共用） |
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

极客班论坛（`contentSource: site`，预发布与正式镜像）：构建时的初始状态是 `shared/site-state.ts` 的 `siteForumState()` = 空状态 + `content/curation.json` 里的分类（按 `categoryOrder`：招新与机试、班级公告、课程与作业、竞赛与项目、求职与升学、人工智能）和标签 + `shared/published.ts` 读出的公开旧帖（见下文「公开的旧帖」）。只按名字取 `categories`/`categoryOrder`/`tags` 三个字段，`curation.json` 里的快照话题标题和正文补丁不进浏览器产物（它们的作者只在私有快照里）。构建常量 `import.meta.env.GEEK_FORUM_SITE`（`nuxt.config.ts` 的 `vite.define`）让 `stores/forum.ts` 的初始状态直接是 `siteForumState()`，`createSeed` 与示例帖子整段不进产物；`app/plugins/site-state.client.ts` 在挂载前再换一次状态并把会话设为游客，示例种子一帧也不会出现；随后向论坛后端要真正的数据（见下文「服务端模式」）。`persist.client.ts` 不读也不写浏览器里的论坛状态和会话。页面文案：顶部提示、关于页和 `llms.txt` 的说明共用 `shared/site-notice.ts` 的几句，不写具体放出了哪几类帖子（公开的旧帖随 `content/published` 增减）：「旧论坛的一部分帖子已经搬过来，其余的还没有公开。」，没登录时（等 `/auth/me` 返回后，和顶栏登录按钮同时出现）再加「不登录也能看帖和用昵称回复；发新话题、点赞、收藏和关注要先用 GitHub 登录，只有极客班成员能登录。」，已登录不显示；论坛后端连不上时整句换成「论坛服务暂时连不上，现在只能看帖子，稍后刷新页面再试。」，请求太频繁（429）时换成「请求太频繁，稍后再试，论坛过一会儿会自动重新加载，现在可以看帖子。」。关于页是同样的现状加一行出处（基于开源项目 Tuff Forum，talex-touch/tuff-forum，MIT 许可），不显示用户/话题/帖子数字和管理团队；整个论坛没有话题时列表与类别总览的「最新」显示「还没有话题 / 极客班成员登录后可以发第一个话题。」，用户页没有用户时显示「还没有用户 / 成员登录过论坛后会出现在这里。」；系统通知写「来自极客班论坛的系统消息」。

**公开的旧帖**（#87、#108）：共 17 篇，取自 2026-09-26 的快照 `geek-20260926`。旧论坛的 25 级、24 级机试文档和它们链到的入门资料 14 篇（`t73` `t72` `t71` `t9` `t35` 与 `t6` `t7` `t8` `t10` `t11` `t12` `t13` `t16` `t25`，#87）在「招新与机试」类别，`t73`、`t9` 置顶，标签「25级」「24级」「入门资料」；正式环境旧论坛上今年写的 3 篇 AI 帖子（#108）在「人工智能」类别：`t78`「LLM-WIKI搭建经验谈--来自2026/6/14晚i3egnner分享会」（标签「AI工作流」「分享会」）、`t84`「Vibecoding知识点整理，从大模型到Coding Agent；包含大模型基础、Agent原理、工具区分等内容」（「AICoding」「知识整理」），以及 09-13 之后新发的 `t89`「国内 Agent 工具安装指南」（「Agent」「AICoding」）。这三篇用原作者的原文：`t89` 里的第三方公益 API 密钥不公开；`t84` 的讲义链接地址里有空格，Markdown 不认成链接，导出时编成 `%20`；`t84` 的 8 张讲义截图原来放在 gitee 图床上，gitee 不给别的网站引用，导出成站内图片。`curation.json` 的 `topics` 里也有这三篇，只给本机快照模式用：`t78`、`t84` 在那里有改过的标题和正文（`content/posts/body-78.md`、`body-84.md`），`t89` 只有归类（它原来的分类 `c18` 被省略了）；这些改动不进镜像。作者统一是「极客班」（`u-geekclass`，管理员），原作者以后按 #58 认领，旧帖的回复不公开。以后再补新帖的步骤见 [数据保全](../../ops/FORUM-DATA-CAPTURE.md)「以后再补新帖」。

- 清单是 `app/forum/content/published/manifest.json`：快照目录名（`source`）、话题编号、类别、标签、置顶，不公开的话题（`withheld`：`t5` 代理配置教程、`t15`），按图片地址的处理规则（`drop` 换成「（这张截图没有公开）」，`cover` 用灰块盖住矩形，`crop` 裁边；要编辑的外链图记原图 `sha256`，图床不给别的网站引用的外链图不编辑也记 `sha256`），以及按话题的替换规则（写模式和应命中的次数，不写被去掉的原文）。
- `node scripts/forum-migration/export-published.mjs .tools/forum-runtime/<快照>` 按清单从私有快照导出 `content/published/topics.json`（快照目录名与采集时间，每篇的标题、时间、浏览数、首帖正文）和 `public/published/<哈希>.webp`（最宽 1600、有损 WebP），同一快照重跑结果逐字节相同；快照路径按主工作区解析，在 task worktree 里运行也读主工作区的私有快照，输出写进运行它的那份代码。改写规则在 `scripts/forum-migration/published-transform.mjs`：指向公开话题的链接改成相对地址 `./tN`（任何 base 下都能跳，链接文字只是旧站名时换成目标标题），指向不公开话题的链接变成「这篇没有公开」，旧论坛的分类和用户页链接只留文字，外部链接去掉分享人的追踪参数（B 站 `vd_source` 等、公众号 `sharer_*`，gitee 外链跳转换成目标地址），旧论坛里的图片和清单里记了 `sha256` 的外链图换成导出的 WebP，其余外链图片不动；Markdown 图片和 HTML `<img src>` 走同一套规则，导出记录逐篇列出换掉、去掉和留作外链的每一张。同一张原图在两个地址下写了不同的图片规则时导出直接失败；导出结果依赖 app/server 的 sharp 版本，换版本会得到不同的文件名。导出后正文里还有旧资产地址、旧归档链接、邮箱、写出来的账户或密码、API 密钥或令牌（代码块里的也算），或者代码块之外还有既不是站内 WebP 也不是 https 的图片，就直接失败。话题页只在 `<base>t/<id>` 下工作，带尾斜杠的地址由 `app/middleware/topic-trailing-slash.global.ts` 换成不带的，相对链接和图片才不会多一层。
- `shared/published.ts` 把 `topics.json` 变成用户、话题和首帖，`siteForumState()` 与 `nuxt.config.ts` 的 `markdownTopicIds` 都从这里取。
- 断言：`tests/site-state.test.ts` 核对 17 篇的类别、标签、置顶、作者和编号小于 1000（按 #57（PR #116）的约定，合并后生效：论坛后端按编号导入旧帖，新话题从 `t1001` 起），站内链接只指向公开话题、图片文件都在，正文里没有邮箱、写出来的账户和 API 密钥；镜像构建断言 `t/t73.md`、`t/t9.md`、`t/t78.md`、`t/t84.md`、`t/t89.md` 存在，`t/t5.md`、`t/t15.md` 不存在，产物里没有邮箱地址和 `sk-` 开头的密钥。

示例登录（`loginMode=demo`）：`app/stores/session.ts` 的 login 只是选择示例用户；`app/plugins/persist.client.ts` 使用 localStorage 保存示例状态。没有真实认证、服务端权限、共享数据库、附件存储或邮件服务。界面权限和 store 测试仅验证演示行为，不承担安全边界。不得加载旧论坛会话或向后台传递示例 role 以取得真实权限。

只读快照模式：根 `scripts/forum.mjs start|dev` 发现 `.tools/forum-runtime/<快照>/` 或收到 `GEEK_FORUM_CONTENT_DIR` 时，把该目录交给 Nuxt。dev 专用 Nitro 路由 `server/routes/api/local-forum/state` 与 `assets/[hash]` 只读提供 `content.json`、`asset-index.json` 和 `assets/`；`app/plugins/local-snapshot.client.ts` 经 `shared/local-snapshot.ts` 校验后整体替换 store，论坛 store 的会话固定为游客，`persist.client.ts` 不把论坛状态和会话写入 localStorage（侧栏、主题等 UI 偏好仍存本机浏览器）；示例用户选择器、重置控件和 `/new` 命令不再出现（统一登录下都不出现），登录见下文「全站登录」；`LocalSnapshotGate` 在数据到达前不挂载页面，加载失败显示错误而不回退示例种子。两条路由仅 dev 服务器提供、只接受 GET/HEAD，资产只按 64 位小写哈希解析，类型与 disposition 取自索引，SVG 不在允许列表，响应 no-store，支持单段 Range。这仍是本机只读展示：没有写入、跨设备持久化或服务端授权；`GEEK_FORUM_SOURCE=demo` 可强制回到示例种子。

全站登录（`loginMode=site`）：论坛没有自己的登录，登录就是核心服务的 GitHub 登录（`/auth/github` → GitHub → `/auth/callback`，写下 `sid`），官网、论坛、控制台共用这一个 cookie，只有 `CONSOLE_ORG` 的 active 成员能登录成功（规则见 [SECURITY](../../architecture/SECURITY.md)）。`useSiteAccount.ts` 在浏览器里读同域 `/auth/me`，回答由 `shared/site-account.ts` 的 `parseMe` 解析：返回 `signed_in: true` 且带登录名就是已登录，404、HTML 或请求失败都当作未登录；`console_link` 只有值恰好是 `true` 时算数，缺失当作 false（单测 `tests/site-account.test.ts`）。`ForumHeader.vue` 右上角是唯一入口，`/auth/me` 读完之前不显示：未登录是 Tuffex 按钮「用 GitHub 登录」（窄屏只写「登录」，读屏名称不变），跳到 `/auth/github?return_to=<当前论坛页面的完整地址，含查询和锚点>`（非开发态由 `useAppLink().absoluteUrl(route.fullPath)` 生成，带 `/forum` 前缀）；开发态指向 `http://127.0.0.1:5173/auth/github?return_to=http://127.0.0.1:5173/forum<当前路径>`，因为 `return_to` 只接受 `PUBLIC_ORIGIN`。已登录是头像（论坛资料里的头像，论坛后端没回答时是 GitHub 头像），点开是 `AccountMenu.vue`：第一行写昵称和 `@<登录名>`（`TxCardItem`，不是菜单项，键盘跳过），下面每一行前面都有 Carbon 图标：「我的主页」「账号资料」「我的书签」「通知」（有未读时右侧是数字）、「控制台」（只在 `/auth/me` 的 `console_link` 为 true 时出现：提督、舰长、队长、带部门权限包的舰员；线上同域 `/console`，开发态 `http://127.0.0.1:5173/console`）、「返回宣传主页」「查看环境与版本」（关于页）和「退出」（`POST /auth/signout`，全站一起退出；服务端返回成功才显示已退出并回到游客，失败弹 toast「没有退出成功」）。菜单里没有分隔线：`TxDivider` 在菜单面板里会留出一整行空白。前四行需要论坛用户，论坛后端没回答时不出现。行的清单在 `data/account-menu.ts`，单测 `tests/access.test.ts` 核对控制台只按 `console_link` 出现、每行都有文字和图标。示例登录没有这个菜单，顶部提示条右侧仍有「返回宣传主页」「查看环境与版本」两个链接；统一登录下这两个链接不在提示条里，没登录的人在侧栏「社区」里有「返回宣传主页」，版本在「关于」。账号只在顶栏右上角：`ForumSidebar.vue` 没有站点卡片也没有账号卡片（所有者 2026-09-25，#62），侧栏第一行就是「筛选侧栏」；极客班校徽（`/logo.png`）放在顶栏左上角站名前，取代 Tuffex 的描边标志。登录没成功时核心服务带 `?signin=<原因>` 回到原页面，`useSiteAccount` 按原因弹一次 Tuffex toast（8 秒）并用 `router.replace` 去掉这个参数，刷新不会重复提示：

| `signin` | 标题 | 说明 |
|---|---|---|
| `not_member` | 只有极客班成员可以登录 | 这个 GitHub 账号不在极客班的 GitHub 组织里。不登录也能看帖子。 |
| `invite_pending` | 还没接受组织邀请 | 到 GitHub 的通知或邮件里接受极客班组织的邀请，再回来登录。 |
| `cancelled` | 已取消登录 | 需要时再点右上角的登录。 |
| `failed` | 登录没有完成 | 请稍后再试一次。 |

去掉 `signin` 参数时保留锚点（`#post-N`）。

快照模式与统一登录下的示例种子（`mode: read-only`）只能看：`/new`、`/bookmarks`、`/notifications`、`/u/<用户名>/preferences` 显示「发帖还没开放」「书签还没开放」「通知还没开放」「资料修改还没开放」，话题页最后一帖下方是「回复还没开放」，「赞」「书签」「关注」弹 toast「现在还不能操作」。`persist.client.ts` 在统一登录下不恢复浏览器里存过的示例会话。线上论坛与核心同域（`/forum/` 由 web 容器反代），直接请求 `/auth/me` 与 `/api/forum/*`；本机论坛单独跑在 3456，`nuxt.config.ts` 的 `nitro.devProxy` 把 `/auth`、`/api/public/org`、`/api/forum` 转给 `http://127.0.0.1:3000`，并把 `Origin` 换成 `http://127.0.0.1:5173`（核心只接受 `PUBLIC_ORIGIN` 的写请求，否则退出、回复都会被 403），这条代理不进静态产物（见 [LOCAL-PREVIEW](../../ops/LOCAL-PREVIEW.md)）。示例登录：顶栏仍是上游的示例「登录」和用户菜单（菜单第一行是「@<用户名> · <角色>」），不显示全站账号；侧栏只剩「重置示例数据」；`useSiteAccount` 在两种登录方式下都会读 `/auth/me` 并处理 `?signin=`。

## 服务端模式（极客班论坛）

`data/access.ts` 的 `forumAccess(mode, status, user)` 决定谁能写：示例登录（`demo`）写本机 store；极客班论坛（`server`）读写论坛后端；快照与统一登录下的示例种子（`read-only`）只能看。页面的写操作都经 `useForumActions()`，组件里没有两条分支。

- **加载**：`site-state.client.ts` 挂载前调 `stores/forum-server.ts` 的 `load()` → `GET /api/forum/state`（`credentials: same-origin`，带全站的 `sid`）。成功就用返回的 `state` 整体 `replaceState`，会话设成 `state.viewer.userId`（游客是 `null`），并记下 `viewer.capabilities` 与 `guestPolicy`；`LocalSnapshotGate.vue` 在回答到达（或失败）之前显示「正在加载极客班论坛…」，新发的话题不会先 404。失败（网络错误、10 秒没有回答（`STATE_TIMEOUT_MS`，`AbortSignal.timeout`）、非 JSON、形状不对，`shared/forum-api.ts` 的 `parseServerSnapshot` 校验）保留构建时的公开旧帖，所有写操作关闭，顶部提示、`/new` 与话题页写「论坛服务暂时连不上」。429 `rate_limited` 不算连不上：已经显示的内容不动，弹一次「请求太频繁，稍后再试」（之后重试和记浏览数再被拒都不再弹，直到状态重新读到），隔 10、20、40 秒、之后每分钟再读一次；第一次读就被拒时状态是 `busy`，页面先显示构建时的公开旧帖、写操作关闭，读到之后恢复。这几句提示在 `data/access.ts` 的 `UNAVAILABLE_COPY`，各页面共用。
- **写**：每个写操作调一个接口，用返回的整份 `state` 替换 store；失败弹 Tuffex toast（标题说哪件事没成，正文是服务端的中文 `message`，没有时按状态码给一句），本地什么都不改；回 401（登录已经失效或在别处退出）时再读一次状态，页面换成游客能做的事（顶栏的登录状态要刷新页面才跟上）。浏览数用 `POST /api/forum/topics/:id/view`（同一浏览器会话每个话题只报一次，服务端再按 IP 一小时去重），失败不提示。退出后重新读一次状态，书签和通知随之清空。
- **游客**（没登录）：能看全部帖子；在没关闭的话题里能回复：回复框多一个「昵称」（≤`guestPolicy.nameMax`，20），正文 ≤`guestPolicy.contentMax`（2000），按钮写「以游客身份回复」；发送前在浏览器里用 Web Crypto 算工作量证明（`shared/pow.ts`：找 nonce 使 `sha256("<timestamp>:<topicId>:<正文>:<nonce>")` 以 `powDifficulty` 个 0 开头，与核心服务 `middleware/pow.ts` 同一算法），蜜罐字段 `website` 恒为空串；服务端配了 Turnstile（`guestPolicy.turnstileSiteKey` 非空）时回复框下面多一个人机验证（`TurnstileBox.vue`，脚本来自 `challenges.cloudflare.com`，站点 CSP 已放行），令牌一次性，每次发送后换新。昵称和成员撞了、含看不见的字符、太频繁、全站游客回复暂停（429 `guest_replies_paused`）、证明失效都由服务端说明原因，toast 正文就是服务端的 `message`。游客看不到「新话题」；`/new` 显示「登录后才能发帖」和「用 GitHub 登录」；「赞」「书签」「关注」弹 toast「登录后才能继续」并带「登录」按钮；书签、通知、资料页显示「登录后才能……」和登录按钮。游客回复在帖子上署名后面跟一个「游客」（普通的次要文字，不是徽章），`/users` 不列游客，游客的个人页没有「关注」，也没有可改的资料。
- **登录了但被当作游客**：全站登录还在（`/auth/me` 是已登录），但服务端因为这个账号已不在 `CONSOLE_ORG` 里而按游客回答（`viewer.kind: 'guest'`）。这时不再给「用 GitHub 登录」（登了也一样），`/new`、书签、通知、资料页与点赞等提示「这个账号现在不能在论坛里发帖」，和游客一样能看帖、用昵称回复。
- **成员**（用 GitHub 登录、在 `CONSOLE_ORG` 里）：发新话题（标题 ≤120、标签 ≤5、正文 ≤20000）、回复、编辑和删除自己的帖子（话题第一帖不能删）、点赞、收藏、关注、看通知并标为已读。
- **版务**：置顶、关闭、编辑或删除别人的帖子、在已关闭的话题里回复，只看 `state.viewer.capabilities`（服务端按 `computeAccess` 算出的 `forum.*`：`forum.topic.pin`、`forum.topic.close`、`forum.post.moderate`）。服务端模式下用户对象上的称号和角色本身不给任何权限（`permissions.ts` 的 `can(user, action, ctx, granted)`）；按钮只是提示，服务端对每个写请求再校验一次。
- **账号资料**（`/u/<用户名>/preferences`，标题「账号资料」）：昵称（≤30）、个人签名（≤200，可以换行，多行输入框）、所在地（≤60）、个人网站（空或 `https://`，≤200）与三项通知开关，保存前按这些上限先查一遍再 `PATCH /api/forum/me/profile`，昵称没改就不放进请求（`changedDisplayName`，服务端对发来的昵称要重新校验和查重）；头像页选一张 PNG、JPEG 或 WebP（≤2MB，浏览器先查类型和大小），用 `data:` 地址预览（站点 CSP 不放行 `blob:` 图片），「上传头像」把文件本身 `PUT /api/forum/me/avatar`，服务端裁成 256×256；「不用这张」放弃这次选择；上传过的头像可以「恢复 GitHub 头像」（`DELETE /api/forum/me/avatar`）。个人签名显示在个人主页横幅里，保留换行；个人网站只有 `https://` 开头时才显示成链接（`linkableWebsite`，快照或旧数据里的其它地址不显示）。头像在帖子、列表、菜单里都用 `avatarUrl`（上传的或 GitHub 的），没有时是首字母头像。
- **正文安全**：帖子正文（游客也能写）经 `ForumMarkdown.vue` 渲染：先过 `shared/post-markdown.ts`，原始 HTML 一律当文字显示（`<` 后面插一个不可见的 U+2060，复制时去掉），Typora 式 `<img>` 换成 Markdown 图片（只留 src 与 alt），链接和图片地址只放行 http(s)、mailto 与站内地址，`javascript:`、`data:`、`vbscript:` 等（含实体、控制字符写法）前面加 `#` 变成页内锚点；再交给 `TxMarkdownView`，它默认用 DOMPurify 再清一遍。别人写的文字进编辑器时也要先过一遍：`TxMarkdownEditor` 每收到一次内容就用 marked 和 DOMPurify 默认配置渲染到所见即所得层和预览层，这两层只是藏起来、一直在页面里，而默认配置放行 `<style>`、`<form>`、`<input>` 和 style 属性。所以回复框预填的引用（`replyQuote`）和版主编辑别人的帖子（`PostCard.vue` 的编辑）都先经 `toEditor` 在 `<` 后面插 U+2060，保存前 `fromEditor` 去掉；链接地址不改，留给作者自己改。单测 `tests/post-markdown.test.ts`。

接口路径、请求体、错误码与限流以核心服务为准，见 [API](../../architecture/API.md)「论坛」（随 #57 合入）；浏览器客户端在 `shared/forum-api.ts`，不带请求体的写接口不发 `Content-Type`（Fastify 会拒绝空 JSON）。单测：`tests/forum-api.test.ts`（客户端与返回值校验）、`tests/pow.test.ts`（与 `node:crypto` 同一结果、服务端能验证）、`tests/forum-server-store.test.ts`（假 fetch 下的加载、写入、失败不改本地、游客回复的请求体）、`tests/access.test.ts`（游客/成员/离线各能做什么、版务只看 capabilities、头像菜单）、`tests/turnstile.test.ts`。

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
- **论坛能力**：极客班论坛里只看服务端下发的 `viewer.capabilities`（见上文「服务端模式」）。示例与快照里是 `permissions.ts#hasForumCapability(user, capability)`：admin / moderator 仍持有全部论坛能力；其他人按称号取能力（`titleForumCapabilities`）——提督和舰长持有全部，队长与部门舰员持有所在默认部门权限包里的 `forum.*`，领航员、不属于部门的舰员、未知部门与无称号都没有。动作对应：`forum.topic.pin` 对应 pinTopic，`forum.topic.close` 对应 closeTopic，`forum.post.moderate` 对应编辑或删除他人帖子、在已关闭话题回复；`forum.category.manage` 与 `forum.badge.assign` 暂无对应动作。`isStaff`（版务，「关于」页管理团队据此显示）= 持有 `forum.post.moderate`，与控制台「论坛管理」页的版务定义一致：默认是 admin、moderator、舰长、社区部队长和社区部舰员。话题页的「话题管理」菜单不看 `isStaff`，而是逐项问 `can()`：能置顶或能关闭就显示菜单，菜单里只列本人能用的项。项目部队长只能置顶、不算版务，菜单里只有「置顶话题」。这仍是前端演示权限，不是服务端授权。 **遗留**（只在示例与快照模式）：这两种模式的论坛能力仍按 `titles.ts` 里默认部门的权限包计算，控制台改过的称号权限、部门权限包不会影响它们——公开接口 `/api/public/org` 不下发权限包。极客班论坛（服务端模式）没有这个问题：能力是核心服务按控制台同一套权限计算（`resolveAccess`）得出、放在 `viewer.capabilities` 里下发的。
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

**限制**：静态产物里只有 `nuxt generate` 时写出的文件：极客班论坛（镜像）是每篇公开旧帖的 `t/<id>.md` 加一份 `llms.txt`；示例种子的构建是每个话题（`t1`…`tN`）加一份 `llms.txt`，有 `.md` 的话题编号经运行时配置 `markdownTopicIds` 传给页面。极客班论坛里之后发的话题和回复存在核心服务，示例模式里新发的只存在该浏览器的 localStorage，两者都没有对应的 `.md`，请求会得到 404，这类话题页也不输出 `alternate` 链接；极客班论坛的 `llms.txt` 说明里写明它只列构建时公开的旧帖。已有种子话题在浏览器里新增的回复、编辑、删除同样不会出现在 `.md` 里，文件内容停在构建时刻，时间也按构建时刻推算。本机 dev 服务器配置了只读快照时，`.md` 与 `llms.txt` 按请求从快照生成，覆盖快照里的全部话题；快照不进静态产物。接入真实后端后改由服务端按数据库生成。

## 环境与版本显示

“关于”页的 DeploymentInfo 显示 local / preview / production，并按 [RELEASES](../../conventions/RELEASES.md) 说明发版方式：预发布由打在 `stage` 提交上的 `vX.Y.Z-rc.N` tag 部署，版本显示 `X.Y.Z-rc.N@<sha12>`；正式由打在 `main` 同一提交上的 `vX.Y.Z` tag 部署，显示 `X.Y.Z`；推送分支本身不部署。固定域名来自根 [deploy/environments.json](../../../deploy/environments.json)：`prev.yangtzeu.work` 预发布，`yangtzeu.work` 正式；两套环境同机不同栈，容器内论坛端口都是 3000，宿主侧由 `web` 容器按 `/forum` 路径反代。本机明确标记“本地开发 · 未发布”，另按内容来源说明「当前页面仍使用上游示例内容」（示例种子）或「当前页面显示极客班论坛的帖子，发帖与回复还没接入」（快照），极客班论坛不另写（顶部提示已经说了）；快照模式下「关于」页写「当前显示极客班论坛的公开内容（更新于 <采集时间>）」，界面不再出现「只读快照」字样。Nuxt 配置只读取公共的域名/版本合同，不跨模块引用 React、Fastify 或业务数据。`GEEK_RELEASE_VERSION` 和完整 `GEEK_RELEASE_COMMIT` 只由受控构建注入，不是人已验收的证据。`-rc.N` 只能与 `@<sha12>` 同时出现且只用于预发布，`<sha12>` 必须等于提交前 12 位；`shared/deployment.ts` 对其它组合直接报错，构建因此失败。

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
- 镜像（预发布、正式）是极客班论坛：站名、分类和标签是自己的，数据来自核心服务的 `/api/forum/*`（#57 的服务端与 #107 的前端都合入后才可用；只有前端时页面按「论坛服务暂时连不上」只读显示公开旧帖）。从旧论坛公开的旧帖共 17 篇（#87 的招新机试文档与入门资料，#108 的 3 篇 AI 帖子，见「公开的旧帖」）。快照不进镜像，上游示例内容也不进。
- 之后发的话题和回复没有静态 `.md`（见上文「给 AI 读取的 Markdown」）；旧帖的原作者认领见 #58。
- 原始数据库和附件已按后续明确授权拉到 Mac 私有备份目录，见 [数据保全](../../ops/FORUM-DATA-CAPTURE.md)；由 `prepare.py` 生成的只读投影可按上文快照模式在本机显示，但未导入可写数据库、未激活旧会话。
- 目标数据模型转换、身份认领和上线仍需另行设计/验收，不删除源数据。**未做**：旧论坛账号（包括当年用 GitHub 登录过的）还没有和现在的 GitHub 登录关联，改过的姓名也没有同步，登录后不会自动认领旧帖子。

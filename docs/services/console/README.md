# Console 服务合同（`app/console`）

> 极客班控制台前端：Vue 3 + Tuffex 单页应用，按称号能力显示页面；接口全部来自 `app/server`，产物由 web 镜像托管。

状态：`current` · 更新：2026-10-21 · 源码：`app/console/` · 产物：`app/console/dist/`（随 `yzgc/web:<tag>` 镜像发布）

## 为什么是独立的包

2026-09-24 要求控制台「统一套用组件库」，用论坛同款 Tuffex（issue #13）。Tuffex 只有 Vue 3 版本，[Tuffex 使用政策](../../components/tuffex/USAGE-POLICY.md)禁止在 React 里套 Vue 组件或做同名 React 仿制品，所以控制台从 `app/web`（React）里拆出来，单独成 `@yzgc/console` 包。它和 `app/web`、`app/server` 在同一个根 pnpm 工作区（Node 22 / pnpm 9.15.9），不另起工具链；论坛那套 Node 26 / pnpm 11 与它无关。

## 源码地图

| 路径 | 职责 |
|---|---|
| `app/console/index.html`、`src/main.ts`、`src/App.vue` | 入口：整包引入 Tuffex 样式、UnoCSS 图标、主题；挂路由、全局确认框、TxToastHost；`index.html` 自带首次打开的加载提示（#263，见「构建与托管」） |
| `src/router.ts` | 路由表与每页所需能力（`meta.anyOf`）；`ConsoleShell` 把它交给 `CapabilityGate`，缺能力时整页换成权限说明，没写的页面按 `console.access` 判断 |
| `src/pages/` | 页面：`Overview`、`Applications`/`ApplicationDetail`、`Forum`、`People`（`people/` 下是添加称号、编辑部门权限包、编辑称号三个对话框、称号列表 `TitleList` 和只读权限树 `PermissionTree`）、`Feedback`、`Audit`、`Competitions`、`SignIn`（极客班统一登录页，登录方式按 `GET /auth/providers` 渲染）、`Device`（设备授权确认页，`/device`）、`ConsoleRoot`（取身份与乘客态）；`github/` 下是组织概况、成员、仓库与仓库详情（`github/repo/`）、团队、活动、安全、组织资料、邀请、邀请链接、新建仓库 |
| `src/components/` | 外壳（`ConsoleShell`、`ConsoleNav`：只显示实际持有能力的页面）、能力门 `CapabilityGate`（直接访问无权限地址仍说明原因）、状态组件（`ErrorPanel`、`ErrorAlert`、`LoadingBlock`）、`TitleBadge`/`ToneTag`/`UserCell`、`PageHeader`、`ConfirmHost` |
| `src/lib/` | 纯逻辑（可单测，不导入 Vue）：`http`（请求与 `ApiError`）、`errors`（错误 → 文案与错误卡片的主按钮）、`signin`（登录未成原因解析、`return_to` 同源校验 `safeReturnPath`、`/auth/providers` 的解析与跳转地址）、`device`（设备授权确认页的纯逻辑：`user_code` 格式化与校验、去登录页的路径、scope 说法、剩余时间）、`nav`（导航与能力可见性）、`people`（按部门分组、负责人与排序、撤销规则）、`titles`（称号的默认值、徽章与编辑校验）、`org-settings`（组织资料改动计算）、`applications`（处理投递：通知信的提示、字段核对、PATCH 体、信件状态的说法）、`statuses`、`format`（时间一律按北京时间）、`icons`、`types`；带 Vue 的：`session`（身份与能力清单）、`resource`（读写状态）、`confirm`、`github`、`runtime`（数据源与跨服务链接） |
| `src/lib/permission-tree.ts`、`permission-boundaries.ts` | 前者用当前目录/部门配置解释本人 `/me` 的状态，不生成授权判断；后者维护能力的范围、实际执行点和关联页面，只作说明，随对应后端路由与契约同步 |
| `src/mock/` | 开发预览样板数据（全部虚构），只在数据源为 mock 且（DEV 或 PR 预览构建 `VITE_PREVIEW_MOCK=1`，#245）时动态导入，镜像构建不含；`lib/runtime.ts` 的 `PREVIEW_MOCK` 只由根目录 `netlify.toml` 设置。mock 的 `/auth/providers` 与服务端同形（只有 GitHub 一种），登录页在样板数据下也按它渲染；设备授权页用到的 `/auth/me`（跟随样板身份，未登录样板回 `signed_in: false`）与 `GET /api/identity/device`（任何完整的用户码都是十分钟内有效的待确认样板）也同形，允许/拒绝仍按只读回 501 |
| `src/styles/theme.css`、`layout.css` | 主题令牌覆盖与页面版式（见「设计令牌」） |
| `scripts/tuffex-icon-classes.mjs` | 扫描已安装 Tuffex 的 dist，给 UnoCSS 列出组件自带的 `i-carbon-*` 图标类（做法同论坛） |
| `vite.config.ts`、`uno.config.ts`、`tsconfig.json` | 构建、图标、类型检查配置 |

依赖方向：`pages → components → lib`；`lib` 里的纯逻辑模块不导入 Vue。控制台不得导入 `app/web` 或 `app/server` 的源码，`app/web` 也不得导入控制台（`scripts/check-boundaries.mjs` 检查，含 `.vue` 的 `<script>`）。和服务端共用的只有 HTTP 形状，类型在 `src/lib/types.ts` 手写一份，`tests/console/mock-sync.test.ts` 核对它没有和服务端 `roles.ts` 漂移。

## 路由

| 路径 | 页面 | 所需能力（任一） |
|---|---|---|
| `/signin` | 极客班统一登录页：调匿名 `GET /auth/providers` 渲染登录方式（目前只有 GitHub，按钮「通过 GitHub 继续」）；`?signin=<原因>` 说明上次登录为什么没成功；`return_to` 只接受同源路径（不合格回 `/console`），登录后回到它 | 无 |
| `/device` | 设备授权确认页（RFC 8628）：带入或输入 8 位 `user_code`，显示客户端、权限、剩余时间与防钓鱼提示，允许或拒绝；没登录先去 `/signin?return_to=/device?user_code=…` | 无（要极客班会话，页面自己读 `/auth/me`） |
| `/console` | 概览 | `console.access` |
| `/console/applications`、`/console/applications/:id` | 投递管理、投递详情 | `applications.read` |
| `/console/forum` | 论坛管理 | 任一 `forum.*` |
| `/console/people` | 成员与权限：四个文字页签「成员 / 称号 / 部门 / 权限树」；「成员」左侧宽分组栏，右侧概况与限定高度的内部滚动名单，可逐人展开来源与撤销操作；`?view=titles` 为「称号」（只给 `roles.manage`，列出名称、说明和基础权限）；`?view=departments` 为「部门」（展示负责人、成员与两类部门权限，仅组织 owner 显示编辑或删除）；`?view=permissions` 为只读能力目录与详情，按当前身份、称号或部门查看，只有有区分度的状态筛选会出现 | `roles.manage`、`roles.department.manage` |
| `/console/competitions` | 比赛：新建、编辑、下线、删除；日期按北京时间选，服务端按 UTC 存 | `competitions.manage` |
| `/console/feedback` | 意见箱 | `feedback.read` |
| `/console/audit` | 审计日志 | `audit.read` |
| `/console/github/**` | GitHub 组织页面；邀请与邀请链接另需 `github.invites.manage`，新建仓库另需 `github.repos.manage` | `github.org.read` |
| `/admin`、`/admin/**` | 跳到 `/console` | — |
| `/console/signin`、`/admin/signin` | 跳到 `/signin` | — |

旧的多组织入口 `/admin/:org/*` 不再保留页面：组织固定为 `CONSOLE_ORG`，GitHub 组织页面挂在 `/console/github/**` 下，接口仍是 `/api/admin/:org/*`。页面能力门只是提示，授权只在服务端。

### 设备授权确认页

`/device` 给命令行 `geek login` 用（#262，RFC 8628）。页面先读 `/auth/me`：没登录就跳 `/signin?return_to=/device?user_code=<代码>`，登录完带着同一串代码回来；已登录则按地址里的 `user_code`（或用户自己输入）调 `GET /api/identity/device`。代码输入对大小写、连字符和空格不敏感，输入时按服务端的字符集格式化并显示为 `XXXX-XXXX`。

结果按 `status` 分：`pending` 且未过期时显示客户端名（「极客班命令行 请求登录」）、`client_id`、逐项解释过的权限、代码与剩余时间，并固定提示「只有你刚在自己的电脑上运行了 `geek login`、终端里就是这串代码时才允许。别人发给你的代码不要确认。」；允许、拒绝调 `POST /api/identity/device/approve`，成功后换成「已授权」「已拒绝这次授权」。`expired`、`denied`、`consumed` 不给按钮，只说明原因并给「输入其它代码」。读取时 401 回登录页、404 提示核对代码（「没有找到这串代码」），确认时 404/409 按「已经不能确认」处理（过期、已被拒绝或已用过），其余错误提示网络问题；`user_code` 同步到地址栏，刷新与回跳都保留。确认页在控制台壳子之外（和 `/signin` 一样），不要控制台能力。

### 只读权限树

「成员与权限」第四页签 **权限树**（`/console/people?view=permissions`，[issue #176](https://github.com/Yangtze-University-Geek-Class/admin/issues/176)）沿用父页能力门，不向普通舰员开放。页签切换用路由历史，刷新、前进后退保留 `view` 和原有 `group`；仅当前页签挂载树，不显示「添加称号」等写按钮。原计划已压缩为 [实施结论](../../plan/CONSOLE-PERMISSION-TREE.md)；合并、tag 与部署状态以 [issue #176](https://github.com/Yangtze-University-Geek-Class/admin/issues/176) 的追踪记录为准。

- **读取**：复用父页的 departments Resource；进入或返回页签、手工刷新时读取当前 catalogue、部门与本人 `/me`。树单独保留 catalogue 的准确错误，不使用普通徽章的默认标签回落证明成功。任何加载或错误期间隐藏旧树、统计和授权结论；401 走统一登录回跳，403/上游失败显示 HTTP、机器码与 request id，可刷新重读。各接口不是事务快照；来源和结果不一致时显示警告，不覆盖 `/me`。
- **结论与来源**：本人视角的有效/受限/未授予只取 `/me.capabilities` 与 `blocked`；称号基础包、部门队长/舰员包与现有 `closure` 只解释来源。业务域名称取当前 catalogue，图标为前端映射；称号与未归档部门视角展示对应配置并标「已包含」，不模拟其他人的实际权限。多称号保留多条路径，rank 不继承，领航员不推导普通舰员；归档/缺失部门不参与来源。owner 自动全能力、自动补充 `console.access` 单列说明。配置或身份中的未知 id 原样保留并警告，不据此赋权。
- **边界**：详情区分直接、蕴含与自动授予，并给出 GitHub 上限原因、任免作用域、能力关系与关联页面。`roles.department.manage` 单独持有时的普通任免限于本人负责部门；同时持有 `roles.manage` 时按全局范围处理，现任舰长通过能力门后的移交与卸任另按本人身份核对。`forum.category.manage`、`forum.badge.assign` 单独标记预留，不因「已生效」而显示执行动作；论坛另需当前组织成员身份；旧 `/api/admin/:org/*` 仍按 GitHub 角色鉴权而非 capability。关联链接不承诺能进入或执行。
- **交互**：`TxSelect` 切换本人、称号与部门配置视角；`TxFilterChips` 只在状态结果不同时出现，切换视角后重置筛选；`TxSearchInput` 搜索能力名称、id 与说明。能力按业务域分组为只读选择列表，点击后显示来源、范围与关联页面；`/` 聚焦搜索，Esc 清空。窄屏上下布局，选择后焦点跳到详情，「返回权限列表」返回原节点。无授权复选框、拖拽、保存、真实成员模拟器或新写接口。

## 接口

业务数据统一由 `app/server` 提供，控制台不单独维护数据库：

- `/api/console/*`：`me`、`catalogue`、`summary`、`departments`（含删除）、`titles`、`people`、`assignments`、`applications`（含 `export.csv` 下载链接）、`competitions`、`feedback`、`audit`。称号的名字、标签、图标、色调、说明和权限一律取自 `catalogue`，代码里只有加载前的默认值（`lib/titles.ts` 的 `DEFAULT_TITLES`）。契约见 [API](../../architecture/API.md)「极客班控制台」。
- `/api/admin/:org/*`：GitHub 组织页面，`:org` 取 `/api/console/me` 返回的 `org`。
- `/auth/providers`（匿名）列出本站启用的登录方式，`/signin` 按它渲染按钮，前端不写死渠道；`/api/identity/device` 与 `/api/identity/device/approve` 是设备授权确认页用的两个接口。
- 登录走极客班统一登录页 `/signin?return_to=<本站路径>`：选一种登录方式（目前是 GitHub）后 302 到 `/auth/github?return_to=<完整本站地址>`，回调成功后回到 `return_to`；登录失败由核心服务送回 `/signin?signin=<原因>&return_to=<原路径>`。`POST /auth/signout` 退出。登录是全站共用的（官网、论坛、控制台同一个 `sid`），只有 `CONSOLE_ORG` 的 active 成员能登录，见 [SECURITY](../../architecture/SECURITY.md)「登录门槛」。

请求一律同源 `fetch`、`credentials: "same-origin"`，错误体解析成 `ApiError { status, code, message, requestId, payload }`，与 `app/web/shared/lib/http.ts` 同一契约。写操作经服务端的 Origin/Fetch Metadata 检查，控制台与接口同域，不需要额外处理。

## 状态

每个读取都有加载（Tuffex 骨架）、空（TxEmptyState，写明下一步）、失败（TxErrorState + 重试，附 `HTTP 状态 · 机器码 · request id` 一行）三种状态。缺能力：页面级用 `CapabilityGate`（TxPermissionState）写明缺哪项；若称号给了、但被 GitHub 组织角色挡住，说明是这个原因。未登录（`/api/console/me` 返回 401）跳到 `/signin?return_to=<原路径>`。用到一半登录失效（#133，会话到期、别处退出）时同样处理：`lib/http.ts` 的 `api()` 拿到任何 401（`/auth/signout` 除外）就调 `lib/session.ts` 注册的处理，清掉本地身份、把这个 401 记成 `meError`，`ConsoleRoot.vue` 于是带着当前地址跳 `/signin`；读写哪一种都一样，不再停在只有「重试」的「登录已失效」上。万一某处仍显示「登录已失效」，`ErrorPanel` 给的是「重新登录」（登录后回到当前页），不是「重试」。403、5xx 和网络错误不算退出。GitHub 拒绝会话里存的令牌时，服务端结束这个会话并回 401 `session_expired`（#164，见 [API](../../architecture/API.md) 的上游错误映射），控制台照样按退出处理，重新登录会换一个新的 GitHub 授权。登录没成功时核心服务把人送回统一登录页 `/signin?signin=<原因>&return_to=<原路径>`（#262；以前是回原来的控制台地址带 `?signin=`）；`lib/signin.ts` 解析原因，页面在按钮上方说明，原来的 `return_to` 留在地址里，再登录成功后照它回去。`ConsoleRoot.vue` 仍会把残留的 `signin` 从 `return_to` 里拿掉，再次登录成功后不会带着旧原因回去。已登录但没有任何能力显示乘客说明。

登录页（`SignIn.vue`）是官网、论坛、控制台共用的「极客班统一登录」页：标题「极客班统一登录」，副标题「一个极客班账号，通行全站」，下面一排列出官网、论坛、控制台、比赛，表示这个账号能进的地方。登录方式不写死：页面加载时调匿名 `GET /auth/providers`，`kind: "redirect"` 的每种方式一个按钮（「通过 <名字> 继续」），现在只有 GitHub 一个；加载中显示「正在读取可用的登录方式…」，取不到或列表为空时显示「登录方式没有加载出来，可能是网络不稳定。」和「重试」。按钮下方写明 GitHub 只是接入方式之一、全站以极客班账号认人；最后一行「登录后回到 `<return_to>`」。`return_to` 走 `safeReturnPath`：只接受同源路径，`//`、`/\`、控制字符、绝对 URL 一律换成 `/console`，也不回到 `/signin` 自己。按 `signin` 参数（通过 `lib/signin.ts` 解析，未知取值不显示）在按钮上方显示一条不可关闭的 TxAlert；带行动点的原因（`not_member`）在页脚多一个次按钮，和「回到官网」并排，宽度不足 440px 时竖排：

| `signin` | 类型 | 标题 | 正文 | 行动点 |
|---|---|---|---|---|
| `not_member` | warning | 只有极客班成员可以登录 | 这个 GitHub 账号不在极客班的 GitHub 组织里。极客班账号只对组织成员开放，不登录也能浏览官网和论坛。 | 次按钮「申请加入极客班」（信封图标，当前标签页打开官网 `/join-us`） |
| `invite_pending` | warning | 还没接受组织邀请 | 到 GitHub 的通知或邮件里接受极客班组织的邀请，再回来登录。 | — |
| `cancelled` | info | 已取消登录 | — | — |
| `failed` | warning | 登录没有完成 | 请稍后再试一次。 | — |
| `account_disabled` | warning | 这个极客班账号已停用 | 账号停用后不能登录，已有的会话也已失效。如有疑问请联系组织管理员。 | — |

`?signed_out=1` 另显示「你已退出登录」（正文「官网、论坛、控制台已一起退出。」）。写操作失败用 TxAlert 内联提示，保留已填内容；401 例外，会直接跳去登录，没保存的内容不保留；危险操作一律先确认（初始焦点在「取消」）。

## 比赛信息维护

`/console/competitions` 的页面与导航需要 `competitions.manage`；后端写口也独立核验。提督动态拥有新能力；已保存的称号和部门权限包不会自动增加此能力，须由有权限的管理者明确授予。数据取 `GET /api/console/competitions`，POST 新建、PATCH 编辑/下线/上线、DELETE 真删；普通 `console.access` 只能读列表，不能写入。下线后官网不显示，控制台仍可恢复；删除需确认，初始焦点在取消。列表「时间」一格按北京时间：同一天只写一个日期（`isOneDay`），跨天分两行写「起」「到」，报名截止单独一行。比赛页操作按钮、编辑弹窗按钮与输入框触控区域至少 44px；样式仅限定此页面和弹窗。

日期按北京时间填写，新建取当天起止边界；编辑只提交改变的字段，单改名称、说明或链接不会覆盖已保存的具体时分。清空链接或截止日期明确提交 null；没有改动时关闭编辑框而不发送空 PATCH。名称、说明和 URL 按 Unicode 码点计数，与接口一致；长度及 HTTPS 解析在表单先校验，服务端仍独立校验。状态包括未开始、报名中、报名已截止、进行中、已结束，取本次接口结果；每次重读样板数据同样按当前时间和已结束倒序计算。

PR 预览只读，合法写操作返回 501 `mock_read_only`，不能用预览保存按钮证明持久化通过；写入后官网刷新可见的完整链路在隔离本地服务或真实验收环境核对。报名、组队和 SSO 新身份模型不在此页面的交付范围。

## 投递详情与通知信

投递状态为五种：已收到、待面试、已录取、未通过、已取消（#204，`cancelled`，排在最后，用 slate 色调）。状态下拉框与列表筛选都使用这份清单，计数、概览与 CSV 筛选包含取消。进度条只展示已收到、待面试、已录取三步；未通过单独说明，已取消显示「这份投递已取消。简历和审核记录已保留。」，不显示正常录取进度。#148 去掉了「评估中」，服务端启动时把仍停在 `reviewing` 的投递改回已收到；审核记录里的 `reviewing` 照旧显示「评估中」。遇到不认识的状态 id 原样显示，页面不出错（`lib/statuses.ts` 的 `statusMeta`）。

「处理这份投递」里选了和现在不同的状态时，出现「通知投递人」一栏：

| 改成 | 这一栏 |
|---|---|
| 待面试 | 「给投递人发邮件」（默认勾选）；勾上时要填面试时间（例如「9 月 30 日（周三）19:00」）和面试地点，面试说明选填、一行一条。时间和地点是单行输入框，在里面按回车不提交（回车提交会马上发出一封没写完的信） |
| 已录取 | 同一个勾选框；勾上时可以填「接下来要做的事」，一行一条 |
| 未通过 | 同一个勾选框；勾上时可以填「写给投递人的话」 |
| 已收到 | 只写「改回已收到不发邮件。」 |
| 已取消 | 只写「这份投递将标为已取消，不发邮件。简历和审核记录会保留。」；没有发信勾选或信件输入，按钮为「保存」 |

栏里最后一行说清楚保存后会怎样，依据是详情接口的 `mail`：会发时写「保存后给 <邮箱> 发「待面试」通知信。」；白名单模式挡住时写「当前只给白名单里的邮箱发信，这封不会发出。」；发信没有配置时写「发信还没有配置，这封不会发出。」；没勾时写「这次只改状态，不给投递人发邮件。」。信真的会发出时按钮叫「保存并发邮件」，其余叫「保存」。每换一次目标状态，勾选框回到勾上。备注照旧只给审核人看，页面写明它不会写进给投递人的邮件。

取消成功提示为「投递已取消，没有发送邮件。」；请求不带 `notify` / `letter`，服务端也不会为取消生成邮件。取消保留原简历及审核历史，可以按原流程补备注或恢复状态。此前已排队或已发出的其他邮件不撤回，投递时的确认信仍按原状态显示。取消不是「未通过」，不新增按姓名、班级或邮箱聚合，也不自动取消其他简历。

提交的请求体按 [API](../../architecture/API.md) 的 `PATCH /api/console/applications/:application_id`：总是带上页面上看到的状态 `expected_status` 和审核记录的版本号 `expected_review_id`（最大的审核记录 id，`lib/applications.ts` 的 `newestReviewId`，没有记录时是 0），状态变了才带 `status`，备注非空才带 `note`；改到待面试、已录取、未通过时带 `notify`，勾上才带 `letter`（只带这种信用得到的字段，空的选填项不带）。面试时间最多 60 字、地点 120 字、说明和写给投递人的话 1000 字，本地先核对；服务端的 `letter_required` 显示在面试时间、地点下面，`invalid_status` 显示在状态下面，`letter_invalid`（信渲染不出来，例如没配回信地址却在信里写了「直接回复这封邮件」）显示在「通知投递人」一栏里，其它错误（含字段超长时的 `validation_error`）照旧用 ErrorAlert。别人在这之间处理过这份投递（包括改走又改回）时服务端回 409 `status_changed`，什么也没改、没发信：页面弹出「没有保存」和服务端那句「这份投递刚被别人处理过，现在是「…」，看过最新的记录再改」，重新读详情，状态回到最新的，已经填的信和备注留着。部署前打开、还没刷新的旧页面不带这两项，改状态会被拒绝（「这个页面是旧版本，刷新后再改」），刷新就是新版本。保存成功的提示按服务端回来的这封信说：正在发、没发出（白名单、没配置）或只更新了审核记录。

审核记录每一条都写这次的邮件：「已发出（时间）」「正在发」「发送失败，等待第 N 次重试」「没有发出：发了 N 次都失败了」「未发送（不在白名单）」「没有发：发信还没有配置」「没有发：24 小时内已经给这个邮箱发过确认信」「没有发：同一个网络这段时间投递得太多」「没有发：这一小时发出的确认信已到上限」，没有发信的写「没有发」；有信的再写一行主题。「投递信息」里多一行「确认信」，是投递时自动发的那封「已收到」信的状态，说法相同。

控制台里的时间一律按北京时间（Asia/Shanghai）显示，不跟浏览器所在的时区走，和信里写的投递时间对得上；「导出 CSV」下载的表里投递时间一列（`created_at_beijing`）和文件名里的日期也是北京时间（服务端生成）。

## 构建与托管

`pnpm --filter @yzgc/console build` 先 `vue-tsc` 再 `vite build`，产物：

```text
app/console/dist/
  sites/console/index.html      # 唯一入口
  console-assets/*.js|css|png   # 带哈希的资源，不与官网的 /assets/ 重名
```

`base` 是 `/`，不读 `public/`（favicon 与 logo 作为模块导入进 `console-assets/`）。静态资源 CDN 开关（#146，构建参数 `STATIC_CDN_BASE`）打开时，`vite.config.ts` 用 `experimental.renderBuiltUrl` 把 `console-assets/` 下的文件改写到 `https://cdn.crosery.com/yzgc/static/site/console-assets/…`，入口页与路由仍走源站；为空时同源。规则与 web 相同，见 [web 合同](../web/README.md)「静态资源 CDN 开关」。web 镜像把这份 dist 叠进 nginx 站点根，`/console`、`/console/…`、`/admin`、`/admin/…`、`/signin`、`/device` 回落到 `sites/console/index.html`；服务端 `resolveSiteEntry` 与开发态 Vite 的 `/device` 代理同一规则（直连 server 时）。详见 [web 合同](../web/README.md) 与 [DEPLOY](../../ops/DEPLOY.md)。

首次打开的加载提示（#263）：`index.html` 在 `#app` 后面放了一段 `.console-boot`（转圈 +「正在加载控制台」）和它的内联样式，入口页一到就画出来，不等控制台的样式表和脚本；样子和位置照 `ConsoleRoot` 的「正在确认登录状态」，颜色、字体取 `src/styles/theme.css` 的令牌，改令牌时一起改（`tests/console/boot-placeholder.test.ts` 核对）。Vue 挂载后 `#app` 不再为空，`#app:not(:empty) ~ .console-boot` 把提示藏起，交接时不闪白；10 秒后还没挂载，在下方补一句「网络较慢，长时间没有反应可以刷新页面」；减少动态效果时不转圈；禁用 JavaScript 时只显示「控制台需要开启 JavaScript 才能使用。」。线上 CSP 允许内联样式、不允许内联脚本，所以提示只用样式。Vite 默认把样式表链接放进 `<head>`，浏览器要等它下完才开始画（Fast 3G 下约 1.2 秒），所以构建时 `vite.config.ts` 的 `moveStylesheetsToBodyEnd` 把它挪到 `</body>` 前：预加载扫描器照常并行下载，模块脚本按 HTML 规范仍等样式表就绪才执行，挂载时样式已经齐了。开发态（`pnpm dev:console`）样式由脚本注入，不经过这一步。

## 开发

```bash
pnpm dev:console                     # http://127.0.0.1:5186/console ，默认连本地后端（Vite 把 /api、/auth 代理到 127.0.0.1:3000）
# 地址参数（仅开发态）：
#   ?__data=mock      改用样板数据（自动化测试用，tests/e2e 显式带上）
#   ?__data=live      切回本地后端
#   ?__persona=<名>   样板数据下切换身份：admin（组织 owner）、captain、recruitment、tech、community、projects、crew、member、alumni、guest、signed_out
```

开发态默认 `live`，是因为本机预览可以走真实 GitHub 登录（见 [LOCAL-PREVIEW](../../ops/LOCAL-PREVIEW.md)）；本地后端没起时页面是请求失败状态。`?__data=` 的选择记在本标签页的 `sessionStorage`（`yugc:console-data-source`），换标签页回到默认。数据源只在开发构建可切换；生产构建里 `dataSource()` 恒为 `live`，mock 模块不进产物。样板数据只读，写请求返回 501 `mock_read_only`，页面会说明「开发预览是只读的」。改称号、处理投递的写请求先按服务端核对（处理投递：状态只能是五种之一，页面上的状态或最新审核记录和样板不同、改状态却没带这两项时 409，要发待面试的信时面试时间和地点必填），不合法的得到和服务端一样的 403/400/409，合法的照样 501，不假装信已经排进发信队列。投递详情的样板带 `mail`、`received_mail` 和每条审核记录的邮件，上面的说法除了三种上限（24 小时内发过、同一个网络投递太多、这一小时到上限）都能看到，这三种的说法在 `tests/console/applications.test.ts` 里核对；发信设置用白名单模式（两个真实环境现在都是发给所有人，#169），只有三个样板邮箱在白名单里，好看到白名单挡下时的说法。另有一份已取消的虚构样板，其取消审核 `mail: null`，原确认信仍是已发出。

## 设计令牌

浅色「冰白纸面 + 钴蓝」，全部经 Tuffex 官方令牌表达（`src/styles/theme.css`）：`--tx-color-primary: #3346C8`，文字与边框换成同色相的藏青/冷灰，语义色用服务端 `roles.ts` 的色调（白底 ≥5:1），`--tx-bui-*` 同步给 SidebarNav。页面底铺一层 4% 钴蓝的图纸网格，面板纯白。称号徽章用 TxTag + 称号图标，名字、图标和色调取 `/api/console/catalogue`（可在「称号」里改），默认提督 violet、舰长 amber、队长随部门色、部门舰员 slate、舰员 sky、领航员 jade。一套无衬线字体；等宽只给 GitHub 登录名、编号、代码。规则总表见 [DESIGN](../../design/DESIGN.md)「控制台」。

## 验证

`tests/e2e/application-cancelled.spec.mts` 在 1440px / 390px 下由浏览器调用真实 Fastify 路由与内存库，只有身份查询和发信商是假响应，不接用户的本机验收实例、不发真实邮件；覆盖打开选项、键盘选取消、保存、刷新、保留历史、取消筛选与导出链接，以及过期画面 409 后保留备注。`tests/e2e/workflows.spec.ts` 里的邀请页用例在 1440/1280/1024 与 390×844 下量真实渲染几何：24 字符合成 token 在本格内截断（不越出单元格、不划穿「结果」列）、结果徽章与北京时间各保单行、两张表行高一致、窄屏横向滚动关在表自己的容器里（#211）；另一条在开发服务器上扣住 `src/main.ts`：脚本没到时入口页已显示「正在加载控制台」、`#app` 为空，放行后概览出来、提示藏起（#263）。截图和自动测试不代替在预发布做的人工验收。

```bash
pnpm --filter @yzgc/console typecheck   # vue-tsc（根 pnpm typecheck 也会跑）
pnpm test                               # tests/console/*：导航可见性、名单排序与按部门分组、称号编辑校验、组织资料改动、错误映射、用到一半 401 时统一退出、处理投递（通知信提示、字段核对、请求体、信件状态、北京时间）、与服务端清单同步（含投递状态与样板的处理投递核对）、首次加载提示（入口页结构、令牌一致、样式表挪位）、统一登录页（`signin.test.ts`：按 `/auth/providers` 渲染、`return_to` 同源校验、五种 `signin` 原因文案）、设备授权确认页（`device.test.ts`：代码格式化与校验、各状态的按钮与提示、没登录去登录页的路径、样板数据的待确认授权与只读）
pnpm --filter @yzgc/console build       # 根 pnpm build 也会跑
node scripts/check-boundaries.mjs       # console ↔ web ↔ server 互不导入
```

## 已知限制

- Tuffex 0.6.0 发布包里 17 个子路径（breadcrumb、steps、pagination、error-state、permission-state 等）的 `style.css` 是空文件，只能整包引入 `@talex-touch/tuffex/style.css`（与论坛相同），CSS 约 570KB（gzip 约 83KB）。上游修好后可改回按组件引入。
- Tuffex 与其依赖 `@talex-touch/utils` 声明 `engines.node >=26`，工作区是 Node 22；实测构建与运行正常；pnpm 默认不开 engine-strict，仓库也没有打开它。`@talex-touch/utils` 把 `electron` 声明为 peer：根 `package.json` 用 `pnpm.packageExtensions` 标成可选，锁文件里没有 electron。`@unocss/inspector` 通过 `pnpm.overrides` 固定 `@vitejs/devtools-kit@0.7.3`（与论坛同版本），0.7.5 依赖的 devframe 1.0 与 0.9 混装会让 Vite 配置加载失败。
- TxFormItem 在标签置顶时不会撑满宽度、TxDataTable 在窄屏会把固定布局的列压到重叠：`layout.css` 用两条选择器补上（见文件注释），没有改组件内部结构。
- 截断依赖 `layout.css` 里的 `.ellipsis`：统一隐藏溢出并保持单行；普通行内 `span.ellipsis` 另用 `inline-block` + `vertical-align: bottom` + `max-width: 100%` 使省略号生效，`dd` 等块元素保持原布局（#211），避免概览的组织名撑出所在列。邀请页「本站发出的记录」的邀请链接单元格带 `:title` 存全值，「结果」「时间」两列宽度 `104`/`140` 并走 Tuffex 的按列 `nowrap`，表体 `--table-min: 720px`，两表行高统一 47px；`/invitations` 样板的历史记录用 24 字符 token，截断在预览里看得见。
- 邀请页表体保持零卡片内边距，让表格铺满卡片；标题区另留上/左右各 12px、下 8px，与首列文本左缘对齐，不能沿用 4px 的标题内边距。浏览器回归同时核对两张卡片的标题不贴边，不能只测 token 遮挡。
- 键盘与读屏只做了基本检查（焦点可见、对话框初始焦点在取消）；WCAG 2.2 AA 对比度、屏幕阅读器未做专项测试。

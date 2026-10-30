# Console 服务合同（`app/console`）

> 极客班控制台前端：Vue 3 + Tuffex 单页应用，按权限节点显示页面；接口全部来自 `app/server`，产物由 web 镜像托管。

状态：`current` · 更新：2026-10-30 · 源码：`app/console/` · 产物：`app/console/dist/`（随 `yzgc/web:<tag>` 镜像发布）

## 为什么是独立的包

2026-09-24 要求控制台全部统一用组件库，用论坛同款 Tuffex（issue #13）。Tuffex 只有 Vue 3 版本，[Tuffex 使用政策](../../components/tuffex/USAGE-POLICY.md)禁止在 React 里套 Vue 组件或做同名 React 仿制品，所以控制台从 `app/web`（React）里拆出来，单独成 `@yzgc/console` 包。它和 `app/web`、`app/server` 在同一个根 pnpm 工作区（Node 22 / pnpm 9.15.9），不另起工具链；论坛那套 Node 26 / pnpm 11 与它无关。

## 源码地图

| 路径 | 职责 |
|---|---|
| `app/console/index.html`、`src/main.ts`、`src/App.vue` | 入口：整包引入 Tuffex 样式、UnoCSS 图标、主题；挂路由、全局确认框、TxToastHost；`index.html` 自带首次打开的加载提示（#263，见「构建与托管」） |
| `src/router.ts` | 路由表与每页所需权限节点（`meta.anyOf`，任一即可）；`ConsoleShell` 把它交给 `CapabilityGate`，缺节点时整页换成权限说明，没写的页面按 `console.access` 判断；旧地址 `/console/people`、`/console/audit` 带着查询参数跳到 `/console/users`、`/console/activity`；`afterEach` 按匹配到的路由模式上报 `page.view` 埋点（#274，见 `lib/events.ts`） |
| `src/pages/` | 页面：`Overview`、`Applications`/`ApplicationDetail`、`MailTemplates`（招聘邮件模板，#285、#293；`mail-templates/` 下是顶上的「状态与模板」`StatusRoutes`、左边的模板库 `TemplateList`、中间的编辑器 `TemplateEditor`、右边的实时预览 `TemplatePreview`、预览栏里弹出的测试邮箱试发 `TestSend` 和输入框外壳 `FieldRow`）、`Forum`（`forum/` 下是分类 `CategoriesTab`、表情 `StickersTab`（含新建表情包）、批量加表情 `NewStickerDialog`，#276）、`Competitions`/`CompetitionHub`（`competition/` 下是 #278 加的四个页签 `CandidatesPanel`、`RulesPanel`、`SitePanel`、`FinalPanel` 与它们共用的 `panel.css`）、`PrizeRedeem`（核销兑奖码）、`Users`（`users/UserDrawer` 是详情抽屉）、`Permissions`（`permissions/` 下是组列表 `GroupsTab`、组详情 `GroupDetail`、添加条目 `EntryDialog`、新建自定义组 `CreateGroupDialog`、`NodesTab`、`ExplainTab`）、`Invites`（注册邀请码）、`gitlab/`（`Overview`、`Accounts`、`Projects`、`Settings`）、`Activity`（操作记录）、`Feedback`、`SignIn`（极客班内部登录页，登录方式按 `GET /auth/providers` 渲染）、`Device`（设备授权确认页，`/device`）、`Authorize`（对外授权的同意页，`/authorize`）、`Account`（账号页，`/account`）、`BindEmail`、`CompleteProfile`（补资料页，`/complete-profile`，#280）、`ConsoleRoot`（取身份；没有 `console.access` 时显示「你还不能使用控制台」，缺邮箱或姓名、年级时先带人去绑定或补填） |
| `src/components/` | 外壳（`ConsoleShell`、`ConsoleNav`：只显示实际持有节点的页面；导航超出高度时整列滚动、品牌和账号区钉在上下两端，不让 `TxSidebarNav` 的列表区自己滚动，否则悬停高亮会比鼠标所在的条目高出滚动的距离）、权限门 `CapabilityGate`（直接访问没有权限的地址仍说明缺哪个节点）、状态组件（`ErrorPanel`、`ErrorAlert`：401 和 403 `step_up_required` 时主按钮是「重新登录」，带着当前地址去 `/signin?return_to=…`；`LoadingBlock`）、`MailPreviewFrame`（#285：邮件预览，放在不带任何权限的 `sandbox` iframe 里，可切「邮件样式」和「纯文本」）、`TitleBadge`（按部门色调）/`ToneTag`/`UserCell`、`AccountPicker`（按用户名或昵称远程搜账号，给操作记录、权限解释和加组员用）、`PageHeader`、`ConfirmHost` |
| `src/lib/` | 纯逻辑（可单测，不导入 Vue）：`http`（请求与 `ApiError`）、`errors`（错误 → 文案与错误卡片的主按钮）、`signin`（登录未成原因解析、`return_to` 同源校验 `safeReturnPath`、`/auth/providers` 的解析与跳转地址、邮箱验证码与密码登录的请求、发码冷却秒数、先开哪个标签 `initialSignInTab`、注册表单的本地检查 `registerProblem` 与提交流程 `registerWithEmail`；邮箱与验证码的检查 `looksLikeEmail`、`codeProblem` 账号页绑定邮箱也用；绑定邮箱页与补资料页的回跳 `bindEmailReturn`、`completeProfileReturn`，#280）、`grade`（#280：年级下拉框的选项、真实姓名与年级的本地检查，与服务端同一规则）、`account`（账号页的登录方式、成员资格与账号记录的说法，设密码前的本地检查；密码规则 `passwordRuleProblem` 登录页的注册也用）、`invites`（邀请码的状态、表单校验与提交内容）、`forum`（#276：可见范围的说法，表情和表情包编辑稿的检查与 PATCH 体，加表情时图片和短码的检查、上传地址，新建表情包的检查 `newPackErrors`、按文件名起草短码和名字 `draftsFromFiles`）、`device`、`authorize`、`mail-templates`（#285：模板草稿与请求体互转、正文块的增删移、变量点一下插到光标处、服务端指出的问题标到输入框、实时预览的 400 毫秒防抖与过期响应丢弃、试发结果的说法）、`nav`（导航与节点可见性）、`permission-nodes`（节点的中文名与业务域，读不到节点目录时的兜底）、`levels`（四种身份、账号状态、登录方式、GitLab 同步状态的说法）、`tone`（部门色调，SPEC §1）、`users`（用户页的筛选、抽屉编辑稿与 PATCH 体）、`permissions`（组的分段排序、条目与范围的说法、添加条目与新建、修改组的请求体、解释结果的来源链）、`activity`（操作记录的筛选、北京时间起止、来源、结果、动作和限流桶的说法；地址串不带 `limit`，服务端 `activityQuery` 契约不认这个字段，带了整页 400，#274）、`events`（#274：批量上报 `page.view` 页面浏览埋点，`POST /api/events` 带 `surface: "console"`，开发预览 `isMock()` 时不发，`router.ts` 的 `afterEach` 按匹配到的路由模式上报，不带参数真实值）、`gitlab`（同步模式、账号同步的状态与错误说法）、`applications`、`competitions`、`competition-hub`（报名设置与积分）、`competition-contest`（#278：计分规则与奖项的表单、待确认贡献、官网版本、兑奖码的校验与说法）、`statuses`、`format`（时间一律按北京时间）、`types`；带 Vue 的：`session`（身份与权限清单）、`resource`（读写状态）、`confirm`、`runtime`（数据源与跨服务链接）、`tabs`（`TxTabs` 首次显示时指示条不做滑入过渡的指令 `vSnapIndicator`） |
| `src/mock/` | 开发预览样板数据（全部虚构），只在数据源为 mock 且（DEV 或 PR 预览构建 `VITE_PREVIEW_MOCK=1`，#245）时动态导入，镜像构建不含；`lib/runtime.ts` 的 `PREVIEW_MOCK` 只由根目录 `netlify.toml` 设置。`mock/console.ts` 照 SPEC §3.3–§3.5 做了一份简化的组与求值：通配展开、拒绝优先、过期条目不算、meta 取权重最高的组（同权重取更宽松的），范围只认 `department` 一个键（部门部长看用户和操作记录只看到本部门的人）；样板身份见「开发」。样板表情用仓库里 `app/server/assets/stickers/yugc/` 的图（`import.meta.glob` 内联成 `data:` 地址，控制台的 CSP 不放行 `blob:`），三个样板包：极客娘、日常、停用的空包「活动限定」。mock 的 `/auth/providers` 与服务端同形（样板列出 GitHub、Google 和带密码的邮箱三种），`/api/identity/me` 按样板身份给账号页数据（未登录样板回 401）；设备授权页用到的 `/auth/me` 与 `GET /api/identity/device`、同意页的 `GET /oidc/interaction/<uid>/details` 也同形，允许、拒绝回 501；样板身份 `no_email`、`no_email_stale` 带 `email_required: true`，用来看绑定邮箱页（#273）；论坛管理的分类和表情包（`/api/console/forum/*`，#276）也有样板，写操作先过节点和重新登录检查，再回 501（重名短码、重名表情包 id 回 409）；比赛的待确认贡献、计分与奖项、官网、定榜四个读口也有样板（#278，第一期的三档奖项与年级系数）；邮件模板有六套样板（四类默认、一套简短的面试邀请、一套停用的）和一个简单的渲染器（`mock/mail-templates.ts`），`POST …/mail-templates/preview` 与 `POST …/applications/<id>/letter-preview` 因为不写任何数据，开发预览里照样渲染（未知变量同样回 400 `template_invalid`），模板的其它写操作和 `test-send` 先过节点与重新登录检查再回 501（#285） |
| `src/styles/theme.css`、`layout.css`、`controls.css` | 主题令牌覆盖、页面版式与 Tuffex 控件的统一外观（见「设计令牌」和「控件外观」） |
| `scripts/tuffex-icon-classes.mjs` | 扫描已安装 Tuffex 的 dist，给 UnoCSS 列出组件自带的 `i-carbon-*` 图标类（做法同论坛） |
| `vite.config.ts`、`uno.config.ts`、`tsconfig.json` | 构建、图标、类型检查配置 |

依赖方向：`pages → components → lib`；`lib` 里的纯逻辑模块不导入 Vue。控制台不得导入 `app/web` 或 `app/server` 的源码，`app/web` 也不得导入控制台（`scripts/check-boundaries.mjs` 检查，含 `.vue` 的 `<script>`）。和服务端共用的只有 HTTP 形状，类型在 `src/lib/types.ts` 照 `.tools/handoff/2026-10-23-yugc-os-v2/CONTRACT-274.md` 手写一份，比赛官网、贡献、奖项与兑奖的照 `CONTRACT-278.md` 与服务端 `competition-contract.ts`。

## 路由

| 路径 | 页面 | 所需权限节点（任一） |
|---|---|---|
| `/signin` | 极客班内部登录页：调匿名 `GET /auth/providers` 渲染登录方式（上面是「登录」「注册」两个标签的邮箱表单，下面是 GitHub、启用时的 Google 跳转按钮）；`?signin=<原因>` 说明上次登录为什么没成功；`return_to` 只接受同源路径（不合格回 `/console`），登录后回到它；邮箱的密码登录下有「忘记密码？」，换成「邮箱、验证码、新密码」的表单，用验证码设新密码并登录（#273） | 无 |
| `/bind-email` | 绑定邮箱页（#273）：只绑了 GitHub 或 Google、还没有登录邮箱的账号先到这里，绑好回到 `return_to`；只有绑定和退出登录两件事 | 无（任何有效会话，页面自己读 `/api/identity/me`） |
| `/complete-profile` | 补资料页（#280）：还没填真实姓名或年级的账号先到这里，填好回到 `return_to`；只有填写和退出登录两件事 | 无（任何有效会话，页面自己读 `/api/identity/me`） |
| `/account` | 我的账号：姓名和年级、登录方式、绑定和删除邮箱、设置或修改密码、成员资格、这次登录、最近的账号记录；没登录先去 `/signin?return_to=/account` | 无（任何有效会话，页面自己读 `/api/identity/me`） |
| `/device` | 设备授权确认页（RFC 8628）：带入或输入 8 位 `user_code`，显示客户端、权限、剩余时间与防钓鱼提示，允许或拒绝；没登录先去 `/signin?return_to=/device?user_code=…` | 无（要极客班会话，页面自己读 `/auth/me`） |
| `/authorize` | 对外授权的同意页（#270）：GitLab 这样的应用第一次用极客班账号登录时，服务端带着 `?uid=<交互编号>` 跳来；显示当前账号、应用名、回到哪个主机、要哪些信息和剩余时间，允许或拒绝后回到应用 | 无（要极客班会话，页面自己读 `/oidc/interaction/<uid>/details`） |
| `/console` | 概览：你的身份、能做的事和五张数字卡（待处理投递、待确认贡献、今天新注册、今天被拦下、GitLab 同步），只显示有权看的卡 | `console.access` |
| `/console/applications`、`/console/applications/:id` | 投递管理、投递详情；列表顶部是招新总开关（#284），看是 `apply.view`，改要 `apply.settings` | `apply.view` |
| `/console/mail-templates` | 邮件模板（#285、#293，见下文「邮件模板」）：每个状态发信用哪一套、模板库、像写 Markdown 一样编辑并实时预览、向测试邮箱试发 | `mail.template.manage` |
| `/console/forum` | 论坛管理 | 任一 `forum.moderate.*`、`forum.category.manage`、`forum.sticker.manage`、`forum.badge.grant` |
| `/console/competitions` | 比赛：新建、编辑、下线、删除；日期按北京时间选，服务端按 UTC 存；有 `competition.prize.redeem` 时右上多一个「核销兑奖码」 | 任一 `competition.manage`、`competition.score.review`、`competition.site.publish` |
| `/console/competitions/redeem` | 核销兑奖码（#278）：输入兑奖码查出是谁、哪张奖，核对后核销 | `competition.prize.redeem` |
| `/console/competitions/:id` | 一场比赛的页签（#239、#278）：报名与名单、积分、待确认贡献、计分与奖项、官网、定榜，按权限出现；入口在内部比赛那一行的「报名、积分与官网」 | 任一 `competition.manage`、`competition.score.review`、`competition.site.publish` |
| `/console/users` | 用户（见下文「用户」） | 任一 `users.view`、`users.manage`、`users.disable` |
| `/console/permissions` | 权限：组、节点、解释三个页签（见下文「权限」） | `perm.view` 或 `perm.manage` |
| `/console/invites` | 注册邀请码：列出、新建、编辑、停用与启用 | `invite.manage` |
| `/console/gitlab` | GitLab 概览：同步模式、连接、上次同步、最近 24 小时出错数（四张 `TxStatCard`，和概览页一样取值在上、名称在下），地址、群组、版本、令牌配没配 | 任一 `gitlab.view`、`gitlab.sync`、`gitlab.settings` |
| `/console/gitlab/accounts` | 账号同步：每个账号在 GitLab 上的用户名、组权限、还要做的事和最后一次错误（客户端的 sector 和本环境 `GITLAB_OIDC_SECTOR` 不一致时显示「GitLab 客户端的 sector 和本环境配置不一致」，#335）；「全部 / 出错的 / 还有事要做」筛选和搜索；有 `gitlab.sync` 时每行「重试」或「立即同步」（`POST /api/console/gitlab/accounts/:id/resync`） | 同上 |
| `/console/gitlab/projects` | 群组与项目：同步群组下的子群组和项目，HTTPS、SSH 克隆地址各带复制按钮 | 同上 |
| `/console/gitlab/settings` | GitLab 设置：同步模式（关闭、预演、打开）、群组路径、同步间隔（5–1440 分钟）；令牌只显示「已配置」或「未配置」 | `gitlab.settings` |
| `/console/activity` | 操作记录（见下文「操作记录」） | `activity.read` |
| `/console/feedback` | 意见箱；右边的公开提交链接是官网的 `/?open=feedback`，进桌面打开意见箱窗口 | `feedback.view` |
| `/console/backup` | 备份（#282，见下文「备份」） | `system.backup` |
| `/console/people`、`/console/audit` | 带着查询参数跳到 `/console/users`、`/console/activity` | — |
| `/admin`、`/admin/**` | 跳到 `/console` | — |
| `/console/signin`、`/admin/signin` | 跳到 `/signin` | — |

GitHub 组织那一整组页面（`/console/github/**`）和它们用的 `/api/admin/:org/*` 随 #274 去掉，控制台只接自建 GitLab（SPEC §3.9）。页面的权限门只是提示，授权只在服务端。

### 设备授权确认页

`/device` 给命令行 `geek login` 用（#262，RFC 8628）。页面先读 `/auth/me`：没登录就跳 `/signin?return_to=/device?user_code=<代码>`，登录完带着同一串代码回来；已登录则按地址里的 `user_code`（或用户自己输入）调 `GET /api/identity/device`。代码输入对大小写、连字符和空格不敏感，输入时按服务端的字符集格式化并显示为 `XXXX-XXXX`。

结果按 `status` 分：`pending` 且未过期时显示客户端名（「极客班命令行 请求登录」）、`client_id`、逐项解释过的权限、代码与剩余时间，并固定提示「只有你刚在自己的电脑上运行了 `geek login`、终端里就是这串代码时才允许。别人发给你的代码不要确认。」；允许、拒绝调 `POST /api/identity/device/approve`，成功后换成「已授权」「已拒绝这次授权」。`expired`、`denied`、`consumed` 不给按钮，只说明原因并给「输入其它代码」。读取时 401 回登录页、404 提示核对代码（「没有找到这串代码」），确认时 404/409 按「已经不能确认」处理（过期、已被拒绝或已用过），其余错误提示网络问题；`user_code` 同步到地址栏，刷新与回跳都保留。确认页在控制台壳子之外（和 `/signin` 一样），不要控制台能力。

### 对外授权的同意页

`/authorize`（#270，ADR-0005 决策 8）给不同源的应用用：GitLab 等下游第一次用极客班账号登录时，服务端的交互入口把浏览器带到 `/authorize?uid=<交互编号>`。页面按 `uid` 调 `GET /oidc/interaction/<uid>/details`，显示「授权登录 / 用极客班账号登录其它应用」、当前极客班账号（头像、显示名、`@登录名`）、「<应用名> 请求用你的极客班账号登录」和「允许后回到 <主机>」、逐项解释过的信息（`openid`、`profile`、`email`），以及「以后从这个应用登录不再问 · m:ss 后这次请求失效」。允许、拒绝调 `POST /oidc/interaction/<uid>/confirm` / `abort`，拿到 `redirect_to` 后整页跳回应用。

读取或提交时 401 去 `/signin?return_to=/oidc/interaction/<uid>`（登录完由服务端按新的登录状态继续），404 说「这次登录已经过期」，409 说「当前账号和发起登录的不一致」，地址里没有合格的交互编号说「缺少登录请求」，这三种都只留「回到官网」；网络错误给「再试一次」。剩余时间走完自动换成过期说明。卡片最宽 440px，与 `/device` 同一写法。

### 忘记密码与绑定邮箱（#273）

所有者 2026-10-23 19:22 指出 SSO 登录缺少忘记密码、改密码相关的功能，并要求：之前只绑定了 GitHub 账号、没绑定邮箱的人，再次进来或登录时必须绑定邮箱。

- **忘记密码**：`/signin` 的「登录 → 密码」下面有「忘记密码？」。点了以后标签、登录方式和跳转按钮收起，换成「重设密码」：邮箱、验证码（「获取验证码」发 `purpose: "reset"` 的信）、新密码和「重设密码并登录」，右上角「返回登录」。先在页面按从上到下检查（`lib/signin.ts` 的 `resetProblem`，新密码规则同账号页），再调 `POST /auth/email/reset`；成功整页跳回 `return_to`，验证码过期时清掉重新获取，邮箱没有账号时（`no_account`，忘记密码这条路径不会顺手注册）转到「注册」，刚才的验证码还能用。页面底部写明：记得旧密码只想换一个的，登录后到「我的账号」里改；只用 GitHub 或 Google 登录、还没绑邮箱的，先用原来的方式登录再绑邮箱。登录页的说明也加了「改密码在「我的账号」里」。
- **绑定邮箱页**：`/bind-email?return_to=<本站路径>`，和 `/signin` 一样在控制台壳子之外。页面读 `GET /api/identity/me`：401 去登录页，`email_required` 为 false（已经绑好，或这个环境发不出信）直接整页跳回 `return_to`（`lib/signin.ts` 的 `bindEmailReturn`，只认本站路径，指回自己时去 `/console`）。要绑时显示当前账号、一句说明和「邮箱、获取验证码、验证码、绑定并继续」，调账号页同一组 `POST /api/identity/email/start`、`/verify`；这次登录超过 10 分钟（`session.step_up_until`）或服务端回 `step_up_required` 时，先换成「先重新登录一次」和「重新登录」，登录页的 `return_to` 是这一页本身，登录完回来接着绑。页面上另外只有「退出登录」。
- **谁带人过来**：服务端的 GitHub、Google 登录回调和对外授权的交互入口直接跳来；`ConsoleRoot`（`/console/**`）读 `/api/console/me`、账号页读 `/api/identity/me`、设备授权页读 `/auth/me`，`email_required` 为 true 时都带着当前地址跳到 `/bind-email`；同意页和设备授权页在接口回 403 `email_required` 时也跳过来，绑好回到交互入口或同一串代码。官网、论坛读 `/auth/me` 自己跳。

### 补资料（#280）

所有者 2026-10-24 13:45 的要求概括为：不论之前还是之后注册的极客班成员，所有注册成员都要填所在年级（大一到大四，会随时间自动变化），用下拉框选、不能自己填写；还要填自己的姓名，并强制绑定邮箱，这些都是身份信息。

- **补资料页**：`/complete-profile?return_to=<本站路径>`，和 `/bind-email` 一样在控制台壳子之外。页面读 `GET /api/identity/me`：401 去登录页；`email_required` 为 true 先去绑定邮箱页（带着这一页当 `return_to`，绑好再回来）；`profile_required` 为 false 直接整页跳回 `return_to`（`lib/signin.ts` 的 `completeProfileReturn`，只认本站路径，指回绑定邮箱页或自己时去 `/console`）。只有成员和往届成员会被带到这里（所有者 2026-10-24 22:05 的要求概括为：只有极客班成员才需要填这些）。要填时显示当前账号、一段说明（极客班成员要实名；年级从下拉框里选，已经毕业的选「已毕业」，在读的每年 9 月 1 日自动升一级；填好后自己不能再改），「真实姓名」输入框和「所在年级」下拉框（`TxSelect`，大一到大四和已毕业），按钮「保存并继续」调 `POST /api/identity/real-info`。管理员只清掉了其中一项时，另一项只显示不让改。先在页面检查（`lib/grade.ts` 的 `realNameProblem`、`gradeProblem`，与服务端同一规则），服务端回 409 `real_info_locked` 时当作已经填好直接回去。页面上另外只有「退出登录」。
- **谁带人过来**：同绑定邮箱页，服务端的登录回调和对外授权的交互入口先看邮箱再看资料（`lib/email-gate.ts` 的 `gatedReturn`）；`ConsoleRoot`、账号页、设备授权页读到 `profile_required` 为 true（且 `email_required` 为 false）时带着当前地址跳到 `/complete-profile`；同意页和设备授权页在接口回 403 `profile_required` 时也跳过来。官网、论坛读 `/auth/me` 自己跳。
- **注册时就填**：登录页「注册」标签在邮箱下面加「真实姓名」和「所在年级」两项，见下文登录页一段。

### 账号页

`/account`（#262）在控制台壳子之外，和 `/signin`、`/device` 一样不要控制台能力，任何有效会话都能打开；控制台导航底部的「账号」、「你还不能使用控制台」说明里的「我的账号」都通到这里。页面读 `GET /api/identity/me`，401 跳 `/signin?return_to=/account`；`email_required` 或 `profile_required` 为 true 时先去绑定邮箱页或补资料页。分六张卡片：

- **登录方式**：已绑定的 GitHub（登录名）、邮箱（打码后的地址）、Google，带绑定时间和最近一次登录；`available` 里有邮箱时显示绑定表单，发码调 `POST /api/identity/email/start`，填码调 `POST /api/identity/email/verify`。邮箱可以绑几个（#272，最多 5 个）：第一个标「主邮箱」，不能删；已有邮箱时表单叫「添加邮箱」，其它邮箱行尾有「删除」，确认后调 `POST /api/identity/email/remove`。列表下面说明 GitLab 按提交里的邮箱认人，git 提交用的邮箱加在这里，GitLab 上的提交就显示本人头像。GitHub、Google 的绑定和解绑还没有。
- **密码**：密码登录用邮箱作账号，没绑邮箱时只说明先绑邮箱。至少 8 位、UTF-8 不超过 72 字节、两次一致，不要求大小写、数字或符号，先在页面检查（`lib/account.ts` 的 `passwordProblem`，与服务端 `passwordError` 同一规则），再调 `POST /api/identity/password`。已有密码且这次登录超过 10 分钟时要填当前密码；没有密码又超过 10 分钟时提示「重新登录」，按钮带着 `/account` 去登录页。
- **成员资格**：「极客班成员」，站内管理员写「极客班成员 · 站内管理员」，用邀请码注册的写「极客班成员 · 用邀请码注册」，不是成员时写明。
- **姓名和年级**（#280）：真实姓名和所在年级，下面说明年级每年 9 月 1 日自动升一级、真实姓名只有本人和管理员看得到、填错了找管理员在控制台改；本人在这里不能改。
- **这次登录**：登录方式、登录时间、有效期，以及「退出登录」。
- **最近的账号记录**：`identity_audit` 里本人最近 20 条（登录、注册、绑定、设密码等），按北京时间。

绑定、删除邮箱、设密码回 403 `step_up_required` 时在卡片顶部提示要重新登录，不当成退出。

### 注册邀请码

`/console/invites`（#262）给持有 `invite.manage` 的人（站长和管理部部长默认有）。注册时邀请码选填（CONTRACT-274 §2）：填了有效的就是极客班成员，不填是注册用户，以后在账号页或资料卡上兑换；填了但无效回 400 `invite_invalid`。表格列出邀请码（带复制按钮、备注、谁在哪天建的）、已用次数、过期日期（北京时间）和状态（可用、已停用、已过期、次数用完；状态列 120px，「次数用完」不折行）；邀请码不删，停用后不能再注册，随时可以重新启用。新建时默认填一个 10 位随机码（去掉 0、1、l、o），可以「换一个」或自己写 4–40 位字母、数字、`_`、`-`，不分大小写；次数、过期日期留空表示不限，过期日期当天整天都能用。编辑只提交改了的字段，邀请码本身建好后不能改。

### 用户

`/console/users`（SPEC §3.9）是所有注册过的账号的一张表（`GET /api/console/users`）：头像、昵称（太长截断，悬停看全名）、`@用户名`（有 `users.manage` 时后面跟真实姓名，#280）、年级（大一到大四、已毕业，没填写「没填」）、身份、部门（带部门色的圆点）、称号、GitLab 同步状态、最近登录（没登录过的写「没登录过」）和状态。页头写人数：今天来过的访客、注册用户、极客班成员、往届成员。筛选：身份（全部身份、注册用户、极客班成员、往届成员）和状态（全部状态、正常、已停用）是两组 `TxFilterChips`，放在左边；部门是 `TxSelect`（含「无部门」，传 `department=dept.none`），和按用户名或昵称搜索（有 `users.manage` 时也按姓名搜）一起放在右边；左右两组在同一行居中对齐，放不下时整组换到下一行。条件都写在地址栏里。一页 20 条，下面有「加载更多」（`cursor`）。窄于 640px 时表格换成一人一张卡（`TxCardItem`）：头像、昵称、`@用户名`、状态，下面是身份、部门、称号和 GitLab 同步状态，点卡片（或聚焦后按回车）打开同一个抽屉。部门部长的 `users.view` 范围是本部门，接口只回本部门的人。

点昵称打开右侧抽屉（宽 `min(560px, 100vw)`），三个页签（`TxTabs`；控制台里的 `TxTabs` 都加 `v-snap-indicator`，首次显示时指示条直接停在当前页签下面，不从导航左上角滑过来）：

- **资料**：真实姓名（只有 `users.manage` 看得到，接口不给就没有这一行）、年级、身份、部门、称号、登录方式、GitLab、最近登录、注册时间。有 `users.manage` 时下面是编辑表单：真实姓名输入框和年级下拉框（大一到大四和已毕业，本人填过以后只能在这里改，#280；清空姓名不算修改），身份三选一（注册用户、极客班成员、往届成员），部门六选一（AI、算法、硬件、网安、管理、无部门，各带部门色），称号只列这个部门的（部长、副部长、部员、没有称号，换部门时清掉原来的称号，服务端也这样做），「设为站长」是单独的开关，保存时站长有变化先确认。「保存」只提交改了的字段（`PATCH /api/console/users/:id`，无部门写 `null`），什么都没改时不可点；服务端回 409 `last_owner`（最后一位站长）等错误时在表单上方说明。有 `users.disable` 时另有「停用账号」或「重新启用」，确认后只提交 `{ status }`；停用的确认框写明这个账号马上退出所有设备，命令行令牌和 GitLab 登录也一起失效。
- **操作记录**（要 `activity.read`）：这个人最近的记录（`GET /api/console/accounts/:id/activity`，「加载更多」翻页），底部「在操作记录里筛选这个人」带着 `account=` 跳过去。
- **有效权限**（要 `perm.view`）：`GET /api/console/accounts/:id/effective` 的所在组（继承来的组写明从哪个组继承）、按业务域分组的允许节点、拒绝节点和限额取值；底部「在「权限」里查某一项为什么允许或拒绝」带着 `account=` 打开「权限 → 解释」。

### 权限

`/console/permissions` 有三个页签，写在地址栏里（`?tab=nodes`、`?tab=explain`，选中的组是 `?group=`）：

- **组**：左边按身份、部门、称号、自定义分段列出全部组（每项写人数和权重；称号写成「AI部门 · 部长」），窄于 900px 时换成可搜索的 `TxSelect`。右边是组详情：名称、说明、权重、继承的组、系统组标记；有 `perm.manage` 时可以改名称、说明、权重（0–1000）和继承（`PATCH /api/console/permission-groups/:id`，只带改了的字段；成环 400 `group_cycle`），非系统组可以删除（确认后 `DELETE`，系统组 409 `system_group`）。条目表列出节点（通配写「全部权限」「users 下的全部节点」）、结果（允许、拒绝或限额取值，-1 是不限）、范围（「部门：AI部门」，空的是不限范围）和到期（过期的标「已过期」，读取时就不算数）；继承来的组另列一行链接。「添加条目」对话框：节点 `TxSelect`（通配在前，按业务域分组，可按中文名或节点搜索），普通节点选允许或拒绝、限额节点填取值，范围是 JSON（有「只限本部门」快捷填法），到期是北京时间的日期；提交 `entries.add`，删除条目先确认再提交 `entries.remove`。成员表（`GET /api/console/permission-groups/:id/members`）列出账号、到期和加入时间；有 `perm.manage` 时用账号搜索框加人（到期日期选填，`POST …/members`）和移出（`DELETE …/members/:account_id`，移出自己时确认框多一句提醒）。身份组和部门组每个账号只能在一个里，页面写明加进来会从原来的组移走（部门换了，原部门的称号一起去掉）；称号组写明人要先在对应的部门里。访客组没有账号，无部门组是所有没分部门的人，这两个组不列成员、不能加人。页头「新建自定义组」（`perm.manage`）：编号 `custom.<小写字母、数字、下划线>`、名称 1–32 字、说明、权重、继承，建好后选中它。
- **节点**：节点目录（`GET /api/console/permissions/nodes`）按业务域筛选、可搜索，列出节点、中文名、说明和直接写了这个节点的组（点了跳到那个组）。
- **解释**：选一个账号和一个具体节点（`GET /api/console/permissions/explain`），给出允许、拒绝或「没有设置」（按拒绝处理）和限额取值，下面逐条列出命中的条目：来源（账号自己的条目，或「极客班成员 → 注册用户」这样的继承链）、条目节点、结果、范围、到期。

### 论坛管理

`/console/forum`（#276）有三个页签，写在地址栏里（`?tab=stickers`、`?tab=mine`），只显示持有节点的页签；置顶、关闭、编辑别人的帖子在论坛页面上做，页头有「打开论坛」：

- **分类**（`forum.category.manage`）：`GET /api/console/forum/categories` 的一张表，列出分类、话题数和「谁能看」（所有人、注册用户、极客班成员三个按钮），点了马上 `PATCH /api/console/forum/categories/:id`，提示「「分类」改成X能看」后重新读取。上方写明没登录的人只能看「所有人」的分类，话题可以在论坛里单独设得更严、不能更松。分类本身来自论坛的 `content/curation.json`，这里不增删。
- **表情**（`forum.sticker.manage`）：分两层（所有者 2026-10-25 提出表情包应按组分层，点进去才能看到具体表情）。第一层是表情包卡片（`GET /api/console/forum/stickers`）：标题「表情包」、包数、一句说明和「新建表情包」按钮；每个包一张可点的卡片，上半是排在前面、启用中的四张表情（`packCover`），下面是包名、表情数和回应次数，停用的包标「已停用」、封面变淡。「新建表情包」：名字 1–64 字、id（小写字母、数字和 `-`，1–40 位，之后是包里短码的前缀，建好后不能改，和已有的 id 或包名重了本地先拦下），`POST /api/console/forum/sticker-packs`，建好后直接进这个包并打开「加表情」。B 站等平台的表情归平台和作者所有，不搬进来。点卡片进第二层（地址栏 `?tab=stickers&pack=<id>`，浏览器返回回到卡片，换页签时清掉）：左上「全部表情包」返回；包头是封面、包名、启用状态、表情数、回应次数、排序和 id，操作「改名和排序」（名称 1–64 字、不和别的包重名、排序 0–100000，`PATCH …/sticker-packs/:id`，只带改了的字段）、「停用整包」或「启用整包」、「加表情」；一句说明论坛聊天框里输入 `[包名_名字]` 会变成对应的表情，帖子里存的是短码。下面是表情网格，每张一格：88px 的图、名字、它的写法 `[包名_名字]`（悬停显示短码）、回应次数和排序，停用的在图片右上角标「已停用」，按钮固定在格子底部：「编辑」（名字 1–20 字、同一个包里不重名，和排序，`PATCH …/stickers/:id`；对话框里写明短码建好后不能改）和停用、启用。地址里的包不存在时说明并给「看全部表情包」。「加表情」对话框一次可以选或拖进多张图（PNG、JPEG、WebP，每张不超过 2MB，一次最多 40 张，不合格的说明几张没加进来），每张一行：预览、短码、名字。短码和名字按文件名先填好（`lib/forum.ts` 的 `draftsFromFiles`：短码是「包 id-文件名里的小写字母数字」，和已有的、同一批前面的撞了加 -2、-3；名字是去掉扩展名的文件名，最多 20 字），都能改，行可以移除。「上传 N 个」先在本地查一遍（短码格式、已用的、同一批里重复的；名字和这个包里已有的、同一批里的都不能重复），全过了再一张一张提交 `PUT …/sticker-packs/:id/stickers?shortcode=&label=`，请求体是图片本身；传上去的行标「已上传」，失败的行留着写明原因（如 409 `shortcode_taken`），改好再点一次只传剩下的，全部传完自动关闭。所有写操作都要 10 分钟内登录过，否则提示重新登录。
- **我的论坛权限**：七个论坛节点各写一句能做什么，标出自己有没有；有 `perm.view` 时下面有「看哪些组有这些权限」（跳到权限页的节点页签）。

### 操作记录

`/console/activity`（SPEC §3.7）是 `GET /api/console/activity` 的一张表：时间（北京时间）、谁（账号、访客编号前 8 位或系统）、来源（官网、论坛、控制台、命令行、接口、系统）、动作（常见动作写中文，下面写动作本身）、目标、结果（成功、拒绝、限流、出错）和 IP（没有 `activity.read.ip` 时服务端打码成 `a.b.*.*`）。顶部「今天被拦下 N 次」按限流桶列出今天的次数，有「只看被限流的」。筛选：账号（有 `users.view` 时是账号搜索框，否则填账号编号）、访客编号、动作前缀（带几个常用前缀）、起止日期（北京时间整天），点「筛选」生效，「清空」回到全部；来源和结果是两排 `TxFilterChips`，点了马上生效；条件都写在地址栏里，开始日期晚于结束日期时提示，不发请求。一页 50 条，下面「加载更多」（`cursor`）。点一行打开「记录详情」抽屉：全部字段、附加信息（`meta` 的 JSON）、请求编号（可复制）、「只看这个人的记录」，有 `users.view` 时还有「打开用户详情」。有 `activity.export` 时页头有「导出 CSV」（`/api/console/activity.csv`，带同样的筛选）；开发预览里这个按钮不可点，悬停说明要连接本地后端。改密码或重设密码成功后会有一条「改密码后吊销了登录凭据」（`auth.credentials_revoked`），`meta` 里是这次吊销的会话、命令行令牌、未兑换的命令行授权和对外授权各几个（#332）。 概览页的「最近操作」也读这个接口，不带 `limit`（契约不认，带了整块 400），取回来的一页只显示最新 6 条；`tests/console/activity.test.ts` 扫控制台源码，请求操作记录的地方都不许带 `limit`。

### 备份

`/console/backup`（#282，所有者 2026-10-24 22:22：要能一键导出下载整个系统的数据，方便服务挂了或搬迁时恢复）。两段说明（包含什么、不包含什么，来自 `app/server` 的真实排除表，不是前端自己编的）加一个「下载完整备份」按钮，和「用户 → 操作记录 → 导出 CSV」同一种做法：普通的 `<a download>` 浏览器下载，同源 cookie 自动带上，不用自己拼 `fetch`；浏览器自己的下载进度条就是这次下载的进度。归档里有全部账号和密码哈希，服务端要求 10 分钟内登录过（`requireStepUp`）：页面先读 `GET /api/identity/me` 的 `session.step_up_until`，不够新时按钮换成「重新登录后下载」，登录后回到这一页，不让浏览器把 403 存成文件。开发预览里这个按钮不可点，悬停说明要连接本地后端（样板数据里仍有一条历史记录可以看表长什么样）。有 `activity.read` 时下面多一张「最近的备份记录」表（时间、发起人、结果、这次归档的文件数与表数），读 `GET /api/console/activity?action=system.backup.export`；没有这个节点时不显示这张表（服务端仍然按 `activity.read` 独立判定，前端只是不去读）。页面底部一句话指到 `docs/ops/BACKUP.md` 的完整恢复步骤，不在页面里重复整套操作手册。

## 接口

业务数据统一由 `app/server` 提供，控制台不单独维护数据库：

- `/api/console/*`：`me`（只要登录就回 200，没有 `console.access` 的账号 `permissions` 里没有它）、`summary`、`users`（GET、`PATCH /users/:id`）、`accounts/:id/activity`、`accounts/:id/effective`、`permissions/nodes`、`permissions/explain`、`permission-groups`（GET、POST、`PATCH`/`DELETE /:id`、`/:id/members` 的 GET、POST、DELETE）、`activity`（含 `activity.csv` 下载链接）、`gitlab/status`、`gitlab/accounts`（含 `/:id/resync`）、`gitlab/projects`、`gitlab/settings`（GET、PATCH）、`applications`（含 `export.csv` 下载链接）、`competitions`（#278 起含 `/:id/candidates`（GET，`/:candidate_id/accept`、`/:candidate_id/reject`、`/collect` 的 POST）、`/:id/rules`（GET、PUT）、`/:id/site`（GET、DELETE，`/versions`、`/publish` 的 POST）、`/:id/final`（GET、POST、DELETE））、`prizes/lookup`、`prizes/redeem`（#278）、`feedback`、`invites`、`backup`（#282，`GET`，下载 `.tar.gz`，不是 JSON，节点 `system.backup`）。形状以 `.tools/handoff/2026-10-23-yugc-os-v2/CONTRACT-274.md` §4–§7 为准，部门列表取匿名的 `GET /api/public/departments`。所有写操作要求刚登录过（step-up），过了 10 分钟服务端回 403 `step_up_required`。
- `/auth/providers`（匿名）列出本站启用的登录方式，`/signin` 按它渲染按钮，前端不写死渠道；邮箱登录调 `POST /auth/email/start`（发码，忘了密码时带 `purpose: "reset"`）、`/auth/email/verify`（用验证码登录，没有账号时带 `invite_code` 注册）、`/auth/email/password`（用密码登录）、`/auth/email/reset`（忘了密码，用验证码设新密码并登录，#273），成功都回 `{ return_to }` 后整页跳转；Google 是 `GET /auth/google?return_to=…&invite=…` 的跳转。`/api/identity/device` 与 `/api/identity/device/approve` 是设备授权确认页用的两个接口。
- `/api/identity/me`、`/api/identity/email/start`、`/api/identity/email/verify`、`/api/identity/email/remove`、`/api/identity/password` 是账号页用的接口；`/api/console/invites`（GET、POST）与 `PATCH /api/console/invites/:id` 是注册邀请码页用的接口。
- 登录走极客班内部登录页 `/signin?return_to=<本站路径>`：选 GitHub 或 Google 后 302 到 `/auth/github`、`/auth/google`（`?return_to=<完整本站地址>`），回调成功后回到 `return_to`；用邮箱时在本页完成；登录失败由核心服务送回 `/signin?signin=<原因>&return_to=<原路径>`。`POST /auth/signout` 退出。登录是全站共用的（官网、论坛、控制台同一个 `sid`）。GitHub 组织那道门随 #274 去掉：用邮箱、Google、GitHub 都能注册，邀请码选填（填了有效的是极客班成员，不填是注册用户），见 [SECURITY](../../architecture/SECURITY.md)「登录门槛」。

请求一律同源 `fetch`、`credentials: "same-origin"`，错误体解析成 `ApiError { status, code, message, requestId, payload }`，与 `app/web/shared/lib/http.ts` 同一契约。写操作经服务端的 Origin/Fetch Metadata 检查，控制台与接口同域，不需要额外处理。

## 状态

每个读取都有加载（Tuffex 骨架）、空（TxEmptyState，写明下一步）、失败（TxErrorState + 重试，附 `HTTP 状态 · 机器码 · request id` 一行）三种状态。缺节点：页面级用 `CapabilityGate`（TxPermissionState）写明缺哪项。写操作回 403 `step_up_required`（这次登录超过 10 分钟）时，错误提示的标题是「需要重新登录」，主按钮「重新登录」带着当前地址去 `/signin?return_to=…`，登录完回到这一页再操作一次。`/api/console/me` 回 200 但 `permissions` 里没有 `console.access`（注册用户、往届成员、没有控制台权限的极客班成员），或者旧的服务端回 403 `forbidden` 时，显示「你还不能使用控制台」：写明当前账号和身份、身份不对时找站长或有权限的部门负责人在「用户」里改，给「回到官网」和「我的账号」。未登录（`/api/console/me` 返回 401）跳到 `/signin?return_to=<原路径>`。用到一半登录失效（#133，会话到期、别处退出）时同样处理：`lib/http.ts` 的 `api()` 拿到任何 401（`/auth/signout` 除外）就调 `lib/session.ts` 注册的处理，清掉本地身份、把这个 401 记成 `meError`，`ConsoleRoot.vue` 于是带着当前地址跳 `/signin`；读写哪一种都一样。万一某处仍显示「登录已失效」，`ErrorPanel` 给的是「重新登录」（登录后回到当前页），不是「重试」。403、5xx 和网络错误不算退出。登录没成功时核心服务把人送回登录页 `/signin?signin=<原因>&return_to=<原路径>`（#262）；`lib/signin.ts` 解析原因，页面在按钮上方说明，原来的 `return_to` 留在地址里，再登录成功后照它回去。`ConsoleRoot.vue` 仍会把残留的 `signin` 从 `return_to` 里拿掉，再次登录成功后不会带着旧原因回去。

登录页（`SignIn.vue`）是官网、论坛、控制台共用的登录页：顶部是极客班标志和标题「极客班内部登录」（#280，所有者 2026-10-24 13:45 要求这里不强调统一登录，简单写成极客班内部登录即可，原来的副标题去掉）。卡片最宽 440px：`TxCard` 自带 `width: 100%`，和页面样式同优先级，构建后谁后加载谁生效，所以页面用 `max-width` 收窄（`/device` 同理）。登录方式不写死：页面加载时调匿名 `GET /auth/providers`。有 `kind: "email_code"` 时，上面是「登录」「注册」两个标签（`TxTabs`）的邮箱表单，下面隔一条「或者」是 `kind: "redirect"` 的跳转按钮（GitHub 在前、启用时再加 Google；卡片里放得下两个完整的大按钮才并排，按 `auto-fit` 的最小 180px 排，放不下就竖排；所有者 2026-10-23 10:32 指出：谷歌登录和 GitHub 登录的常规登录窗口逻辑应放在下面，并且缺少邮箱注册的逻辑）。邮箱表单用 `TxForm`（标签在上）和 `TxFormItem`，分隔线是 `TxDivider`。先开哪个标签由 `lib/signin.ts` 的 `initialSignInTab` 定：Google 因为邀请码无效回来（`signin=invite_invalid&provider=google`）时开「注册」，其余开「登录」；这种时候主按钮让给「用 Google 注册」，邮箱的「注册并登录」降成次按钮，免得填完邀请码点错；点过「获取验证码」就是在走邮箱，主按钮还给「注册并登录」，换邮箱、验证码过期也不再变回去。「登录」顶部切换「验证码」「密码」（列表里的邮箱方式带 `password` 时才有密码）。验证码模式：填邮箱后「获取验证码」，发出后按钮倒数「N 秒后重发」，冷却秒数取响应的 `resend_after` 或 429 的 `retry_after`；输入框只留数字、最多 6 位；邮箱还没有账号时，没填邀请码就直接注册成注册用户并登录；服务端回 400 `real_info_required`（#280：填了邀请码要先填姓名和年级）时，页面转到「注册」标签，上方说「填上姓名和年级就能用它注册，刚才的验证码还能用。」，已填的邮箱和验证码都留着。密码模式下提示还没设过密码就先用验证码登录，再到「我的账号」里设。「注册」依次是邮箱、「真实姓名」、「所在年级」（`TxSelect` 下拉框，大一到大四和已毕业；没填邀请码时两个标签后面写「（成员必填）」，下面一行写成员要填、填了邀请码就要一起填、每年 9 月 1 日自动升一级、填好后自己不能改，#280）、「邀请码（选填）」、验证码和「密码（可以不填）」，按钮「注册并登录」：提交前按 `registerProblem` 从上到下报第一处问题（填了邀请码、姓名或年级时：姓名 2 到 32 个字、只能是文字、空格和「·」，年级要选；密码填了就按账号页同一条规则 `passwordRuleProblem`：至少 8 位、不超过 72 字节），再由 `registerWithEmail` 调 `POST /auth/email/verify` 带 `invite_code`，没选年级时不带 `real_name`、`grade`；新建了账号且填了密码时，趁这次登录还在 10 分钟内调 `POST /api/identity/password` 设上，然后回到 `return_to`。两种情况先在页面上说一句、给「继续」（回 `return_to`）和「去我的账号」两个按钮：邮箱原来就有账号时只是登录、不改它的密码（「这个邮箱原来就有极客班账号，已经登录」「密码没有改」）；密码没设上时写「账号已经建好并登录了，密码没设上」和服务端给的原因。这时上方按 `signin` 参数显示的说明和页脚它带的按钮（如「申请加入极客班」）都收起来，人已经登录了。「注册」标签里 Google 按钮变成「用 Google 注册」，带上表单里的邀请码（没填也能点）；没有邮箱登录、只剩跳转按钮时，从 Google 回来会在按钮上方单独给一个「邀请码（选填）」框。邮箱表单的错误显示在提交按钮上方，保留已填内容。加载中显示「正在读取可用的登录方式…」，取不到或列表为空时显示「登录方式没有加载出来，可能是网络不稳定。」和「重试」。按钮下方的说明随标签变：「登录」写全站认的是极客班账号、还没有账号就切到「注册」；「注册」写邀请码选填：填了有效的邀请码注册后就是极客班成员，不填先是注册用户，以后拿到邀请码再兑换。`return_to` 不是 `/` 时最后一行显示「登录后回到 <return_to>」。`return_to` 走 `safeReturnPath`：只接受同源路径，`//`、`/\`、控制字符、绝对 URL 一律换成 `/console`，也不回到 `/signin` 自己。按 `signin` 参数（通过 `lib/signin.ts` 解析，未知取值不显示）在按钮上方显示一条不可关闭的 TxAlert；带行动点的原因（`not_member`）在页脚多一个次按钮，和「回到官网」并排，宽度不足 440px 时竖排：

| `signin` | 类型 | 标题 | 正文 | 行动点 |
|---|---|---|---|---|
| `cancelled` | info | 已取消登录 | — | — |
| `failed` | warning | 登录没有完成 | 请稍后再试一次。 | — |
| `account_disabled` | warning | 这个极客班账号已停用 | 账号停用后不能登录，已有的会话也已失效。如有疑问请联系站长。 | — |
| `invite_invalid` | warning | 邀请码无效 | 邀请码不对、已停用、过期或者次数用完了。不填邀请码也能注册成注册用户，或者向发给你邀请码的人要一个新的。 | 邀请码输入框（见上） |
| `email_taken` | warning | 这个邮箱已经有极客班账号 | Google 账号的邮箱已经绑定了别的极客班账号。用邮箱验证码登录那个账号就好。 | — |
| `no_account` | info | 这个邮箱还没有极客班账号 | 先用验证码登录注册一个。 | — |
| `code_expired` | warning | 验证码已失效 | 请重新获取验证码再试。 | — |
| `rate_limited` | warning | 试得太频繁了 | 请稍后再试。 | — |
| `registration_limited` | warning | 今天新注册的账号太多了 | 同一个网络或同一台设备今天新建账号的次数到上限了，北京时间零点以后可以再注册。已有账号登录不受影响。 | — |

`not_member`（只有极客班成员能登录）、`invite_required`（Google 没有账号先要邀请码）、`invite_pending`（待接受 GitHub 组织邀请）都随 GitHub 组织那道门一起去掉了（#274：邀请码选填，不填就是注册用户，不再有登录门槛）；按 CONTRACT-274 服务端不再送回这几个原因，万一还送回，页面不显示说明。`?signed_out=1` 另显示「你已退出登录」（正文「官网、论坛、控制台已一起退出。」）。写操作失败用 TxAlert 内联提示，保留已填内容；401 例外，会直接跳去登录，没保存的内容不保留；危险操作一律先确认（初始焦点在「取消」）。

## 比赛信息维护

`/console/competitions` 的页面与导航需要 `competition.manage`、`competition.score.review`、`competition.site.publish` 之一；写口要 `competition.manage`，后端独立核验。站长和管理部部长默认有（站长是 `*`，管理部部长是 `competition.*`），其他人要由有 `perm.manage` 的人在「权限」里给对应的组加上，例如自定义组「活动志愿者」。数据取 `GET /api/console/competitions`，POST 新建、PATCH 编辑/下线/上线、DELETE 真删；只有 `console.access` 的人打不开这一页。下线后官网不显示，控制台仍可恢复；删除需确认，初始焦点在取消。列表「时间」一格按北京时间：同一天只写一个日期（`isOneDay`），跨天分两行写「起」「到」，报名截止单独一行。比赛页操作按钮、编辑弹窗按钮与输入框触控区域至少 44px；样式仅限定此页面和弹窗。

日期按北京时间填写，新建取当天起止边界；编辑只提交改变的字段，单改名称、说明或链接不会覆盖已保存的具体时分。清空链接或截止日期明确提交 null；没有改动时关闭编辑框而不发送空 PATCH。名称、说明和 URL 按 Unicode 码点计数，与接口一致；长度及 HTTPS 解析在表单先校验，服务端仍独立校验。状态包括规划中、未开始、报名中、报名已截止、进行中、已结束，取本次接口结果；规划中（`planning`，#278 重开，所有者 2026-10-25 提出比赛要有状态（规划中、进行中、已结束等））是组织者还在筹备、还没准备好开放报名的阶段，开赛前压过其余未开始类状态，这时报名、组队接口一律拒绝（409 `competition_planning`）；列表显示「规划中」徽标，新建和编辑弹窗里有「规划中」开关（`TxSwitch`），编辑时只在开关真的变了才提交 `planning`。每次重读样板数据同样按当前时间和已结束倒序计算。

新建和编辑弹窗（#278，所有者 2026-10-25 要求区分内部比赛和外部比赛）先选类型，两个选项卡片并排：内部比赛是极客班自己办的，报名、组队、积分和官网都在本站；外部比赛只登记一个去处，赛事官网的 https 链接必填（`formErrors`），内部比赛不填链接。接着是名称、规划中开关、开始和结束日期（两栏）、报名截止（内部比赛叫「报名截止」，外部比赛叫「官网报名截止」），新建内部比赛时多一组「参赛形式」：个人赛或团队赛，团队赛再填每队最低与最高人数（默认 2–4）。保存时先 POST 建比赛，内部比赛再用同一组值 PUT `…/signup-settings`（报名先不开放、不计分）；第二步失败时比赛已经建好，提示「比赛已新建，参赛形式没保存上」，去「报名、积分与官网」里再设。弹窗底部一段说明写报名、积分、官网在建好后的哪一页设。窄屏（≤ 640px）弹窗改单栏，列表换成卡片（`TxCardItem`：名称、类型与日期、状态徽标，操作按钮在卡片下方），表格隐藏。

PR 预览只读，合法写操作返回 501 `mock_read_only`，不能用预览保存按钮证明持久化通过；写入后官网刷新可见的完整链路在隔离本地服务或真实验收环境核对。报名、组队与积分在下一节的「报名与积分」页，官网、贡献、奖项与定榜在再下一节。

## 报名与积分（#239）

比赛列表里只有内部比赛那一行有「报名、积分与官网」，进入 `/console/competitions/:id`。页面先从 `GET /api/console/competitions` 找到这一场（已下线的也能打开），再按权限出页签（`TxTabs`，选中的页签记在地址的 `?tab=`，默认开第一个）：「报名与名单」要 `competition.manage`；「积分」读名单与积分记录，要 `competition.manage` 和 `competition.score.review`；#278 的四个页签见下一节。名单只在有 `competition.manage` 时去读，积分记录只在有 `competition.score.review` 时去读，后端同样核验。直接打开外部比赛只显示「外部比赛在官网报名」的说明和意向名单，设置、积分和 #278 的页签都不显示。

- **报名设置**（只对内部比赛）：在线报名开关、参赛形式（个人赛 / 团队赛）、每队最低与最高人数（团队赛才出现，1–20）、计分（不计分 / 开源贡献积分）。表单先校验「开开放报名要有报名截止时间」「人数是 1–20 的整数且最低不大于最高」，其余冲突由服务端 409 原样显示（有未取消的报名后不能改形式、人数不能让现有队伍越界）。保存成功后提示「报名设置已保存」并重读名单与比赛列表；设置写入与审计同一事务。
- **名单与统计**：五个统计卡——报名人数（外部比赛叫「意向人数」）、队伍、已确认队伍、已确认人数、未成队（个人赛为 0）；下面「报名」与「队伍」两张表。报名列出用户、状态、留言、是否在找队伍、队伍与角色（领队 / 队员）、报名时间（北京时间），含已取消的行；队伍列出队名、状态（招募中 / 已确认 / 已解散）、人数、领队与成员，含已解散的行。空态分别写「还没有人报名」「还没有队伍」。
- **导出 CSV**：右上「导出 CSV」取 `roster.csv`，列是账号、登录名、状态、留言、找队伍、队伍名、角色与三个北京时间时间列；服务端带 BOM 与 CRLF、单元格防公式注入，并写 `competition.roster.export` 审计。导出每分钟 5 次，超限时页面提示「导出太频繁，请一分钟后再试」，其他错误进统一错误提示。
- **积分**：只有开启了「开源贡献积分」的内部比赛才显示登记表单。选手从已报名者里选（按登录名搜索），类型为 Issue、合入的 MR 或作弊扣分；Issue 与 MR 要仓库路径（两到五段，例如 `geek/admin`，和服务端同一条）与编号，再选重要程度（一般 / 重要 / 关键）和核心度（边缘 / 业务 / 核心）两档（`ScoreLevels`，#278 两档评定，不填分值、不看代码行数），选完马上调 `score-preview` 写出这条会记多少分（「基础分 25 × 大一 3.5 = 88 分。」；本周已经照算过一条「一般 × 边缘」时写记 0 分）；扣分固定 −50，不选两档、不带仓库编号；说明最多 200 字。加分乘选手在记分那一刻的年级系数（#278），扣分不乘。登记成功提示「已登记积分」并重读记录与名单。记录表按时间倒序，列出时间、选手、类型、仓库、分值、说明、登记人与状态；分值一格写两档和加权，例如「重要 × 业务 · 大一 ×3.5 = 158」，被防刷记 0 分的写「本周已照算过一条一般 × 边缘，记 0 分」，记下的两档、年级与系数之后不再改。仓库是这场比赛「计分与奖项」里列的 GitLab 项目时只显示路径、不拼 GitHub 链接（读不到规则时照旧拼）。已撤销的行保留并显示撤销原因。撤销要填原因（最多 200 字），只改状态，不删除记录。没有开启积分时写明在「报名设置」里选「开源贡献积分」后才能登记。
- 开发预览的样板数据同样只读：写请求一律被拒（501，页面翻译成「开发预览是只读的」），不能用预览保存证明持久化通过。

纯函数与样板数据的单测在 `tests/console/competition-hub.test.ts`（设置与积分表单校验、请求体、统计、CSV 路径与限流提示、样板名单形状）；接口与审计由 `tests/server/competition-signups.test.ts` 与 `tests/server/competition-scores.test.ts` 覆盖。页面本身没有组件级或浏览器端到端用例，见 [TESTING](../../conventions/TESTING.md) 的说明。

## 官网、贡献、奖项与定榜（#278）

内部比赛的页面上另有四个页签，都在 `src/pages/competition/`，接口形状以服务端为准（见 [server 合同](../server/README.md)「比赛官网、公开接口、贡献收集、定榜与兑奖」）。写操作都要刚登录过，过了 10 分钟回 403 `step_up_required`，由 `ErrorAlert` 给「重新登录」；服务端把每次写入记进操作记录。

- **待确认贡献**（`CandidatesPanel`，要 `competition.score.review`）：GitLab 收来的合并 MR 与 Issue。按「待确认」「已加分」「已驳回」筛选（各带条数），每页 50 条，后面「加载更多」。打了「有用」标签、打标签的人有审核积分权限的，收集时已经自动加分，状态旁写「GitLab 标签」；其余在这里确认或驳回：列表的「两档与分值」一列写标签给的两档（`重要程度::`、`核心度::` 标签，没有时写「没选两档」）；确认弹窗是同样的两个下拉框，默认选标签上的两档，按贡献时间试算记多少分，说明选填；只有「有用」没有两档标签的，收集时留在这里并写明原因；驳回要填原因。右上「立即收集」调 `POST …/candidates/collect`，提示一句收集结果（读了几条、新增、跳过、按标签加分、撤销几条；没完成时写原因）；上次收集的结果只记在服务端进程里，重启后写「服务启动后还没有收集过」。确认、驳回与收集之后积分记录与名单跟着重读。
- **计分与奖项**（`RulesPanel`，看要 `competition.manage` 或 `competition.score.review`，改要 `competition.manage`）：两档基础分表（只读，来自服务端 `scoring`）和防刷规则一句话；六个年级系数（大一、大二、大三、大四、已毕业、无年级，表单里写小数 0.5–5、最多两位，提交时乘 100 成服务端的百分数；第一期默认 3.5 / 2.2 / 1.4 / 1 / 1 / 1）；奖项选填，一档写从第几名到第几名、金额（元，0–100000 的整数）和说明（≤ 40 字），按名次从小到大、不重叠，最多 20 档，「加一档」接着上一档往后排；GitLab 项目每行一个，最多 10 个，重复的去掉。提交前在页面逐项报错，服务端照样校验。定榜后整页只读，提示先撤销定榜。
- **官网**（`SitePanel`，看要 `competition.manage` 或 `competition.site.publish`，上传、发布、下线要 `competition.site.publish`）：最上面是三步开发说明（所有者 2026-10-25 反映比赛这类功能没有开发说明、很难上手）：复制 `app/web/sites/contests/_starter` 并把 `site.config.ts` 的 id 改成这场比赛的 id；`pnpm contest:site dev <构建产物目录>`，加 `--api https://prev.yangtzeu.work` 时本地页面读预发布的公开比赛接口；`pnpm contest:site pack <构建产物目录> --competition <id>` 打出 zip，再链到论坛指南《用 SDK 接入比赛官网》。下面是官网地址（还没定时才显示，标签在上、输入框在下，窄屏不再挤出卡片）和上传区。用 `TxFileUploader` 选一个 zip（≤ 20MB），下面一行写已选的文件名和大小，「上传并校验」把文件原样作为 `application/zip` 发给 `POST …/site/versions`；没通过时（422 `site_rejected`）逐条列出服务端给的原因。第一次发布前填官网地址（3–32 个小写字母、数字或连字符，`/c/<地址>/`，之后不能改）。版本表列出版本、哈希前 12 位、状态（在线、通过、没通过）、大小与文件数、上传人、时间、校验结果，通过的版本有「预览」（一小时有效的签名地址）和「发布」或「换成这个」（回滚就是发布旧版本）；「下线」后地址回 404，版本和地址都留着。发布、换版本、下线都先确认。
- **定榜**（`FinalPanel`，要 `competition.manage`）：没定榜时列出按现在的分数排的名次和每人对应的奖项；比赛结束前「定榜」按钮不可点，并写明结束时间。定榜先确认（写明会给几位得奖的同学发兑奖码），之后列出奖项与兑奖码：名次、得奖人与分数、奖项、兑奖码只显示末四位、是否核销。已有奖核销过时「撤销定榜」不可点；撤销会删掉名次快照和全部兑奖码。

`/console/competitions/redeem`（`PrizeRedeem.vue`，要 `competition.prize.redeem`）：得奖的同学在门户「我的参赛」里看到兑奖码，拿来找所有者兑奖。输入兑奖码（不分大小写，空格、连字符与 `YUGC` 前缀可有可无，按服务端同一套规范化先在页面检查格式），「查找」调 `POST /api/console/prizes/lookup`，显示比赛、名次、奖项、分数、得奖人（用户名与昵称；比赛这边不读真实姓名，#280，要核对本人到用户页看）、兑奖码末四位和是否核销；核对后「核销」先确认，再调 `POST /api/console/prizes/redeem`（要刚登录过）。查不到写「没有这个兑奖码」，已经核销过写「这个兑奖码已经核销过了，不能再兑一次」并显示那张奖和核销人，输错太多次（每人每小时 20 次）写「一小时后再试」；其余错误交给 `ErrorAlert`。「换一个」清空重来。

纯逻辑与样板读口的单测在 `tests/console/competition-contest.test.ts`（规则表单与服务端 Schema 对齐、两档选项与基础分表、试算请求与说法、奖项档位校验、GitLab 项目、候选两档与收集结果的说法、官网地址与文件检查、版本状态、被拒原因、兑奖码与服务端同一套规范化、兑奖失败的三种说法、样板的候选、规则、官网和定榜预览）；接口、权限、step-up 与操作记录由 `tests/server/` 下 #278 的用例覆盖。页面在本地服务上用浏览器看过，见 #278 的执行记录。

## 招新总开关（#284）

投递管理（`/console/applications`）页头下面有一栏「招新投递：开放中 / 已关闭」，写明现在官网「加入我们」窗口是什么状态、上次是什么时候改的（从没改过不写这一行）。栏里的开关是 Tuffex 的 `TxSwitch`：只有持有 `apply.settings`（「招新开关」，种子里只有站长）的人看得到开关，别人只看到状态和「没有「招新开关」权限，只能查看」。开关是受控的：点一下先弹确认框（关闭按危险操作的样式，说明新的投递会被拒绝、已收到的投递不受影响；重新开放说明每天能投几份的限制不变），确认后发 `PATCH /api/console/applications/settings`，服务端回来才换成新状态，期间开关显示加载；失败（包括 10 分钟内没登录过的 `step_up_required`）时开关留在原状态，栏上方出现横幅，要重新登录的给「重新登录」。改成功弹出提示，说明官网已经打开的「加入我们」窗口要重新打开才会取到新状态。

文字与确认框的内容是 `lib/applications.ts` 里的纯函数 `applySwitchView`、`applySwitchConfirm`、`applySwitchSaved`，`tests/console/applications.test.ts` 直接测；权限节点的中文名在 `lib/permission-nodes.ts`，操作记录里的 `application.settings.update`（开放或关闭招新）和关闭期间被拒的投递 `http.apply_closed` 在 `lib/activity.ts` 有对应的中文名。开发预览里读到的永远是「开放中」，改是写请求，按只读回 501，但会先按服务端的顺序核对 `apply.settings` 与 step-up。

## 邮件模板（#285、#293）

所有者 2026-10-25 00:15 要求邮件做成多模板、可控的形式，招聘投递的邮件不固定为一个模板；模板可以编辑（包括里面的信息），编辑后可随时预览，并可填写邮箱发送测试；18:12 返工：所有者认为邮件模板设计有大问题，还会无限扩展，大部分人看不懂怎么用，希望像 Markdown 编辑器那样编辑时就看得明白；模板要有模板库，点开能看到全部模板，还能管理不同状态用哪个模板投递；测试按钮也很难看。页面 `/console/mail-templates`，节点 `mail.template.manage`（默认只有站长），后端规则见 [mail](../server/mail.md)「邮件模板」。接口与已存模板的格式没有变，下面说的都是这个页面里的做法。

- 布局：顶上一行「状态与模板」，下面是固定高度的工作台（随视口，约视口高度减去页头，最低 520px）：左边模板库，中间编辑，右边预览，三栏各自滚动，整页不随模板内容变长，也没有整页横向滚动。1180px 以上三栏并排；窄于 1180px 时状态、模板库、编辑、预览是四个页签，一次显示一栏，选中一套模板后自动切到「编辑」。
- 状态与模板：已收到、待面试、已录取、未通过各一张卡，写明什么时候发（已收到在投递提交后自动发，另外三种在投递详情页改成对应状态时发），下拉框里选这个状态发信用哪一套（只列已启用的），选中就是把它设为这一类的默认（`PATCH /api/console/mail-templates/:id` 的 `is_default`），卡上显示它的主题。改投递状态时不特别指定模板，就用这一套。
- 模板库：「全部」加四个状态的筛选，每套一张紧凑的卡（名称、「默认」「已停用」、主题），点一套在中间打开；只有选中的那一套下面出现「复制」「设为默认」「停用」或「启用」「删除」，默认模板没有后面三个，因为它不能停用也不能删。「新建」先选给哪个状态新建，从这一类的默认模板抄一份内容；「复制」按同一类的名字规则起「名字（副本）」，重名时「（副本 2）」。
- 编辑区像写 Markdown：顶上是名称、保存和放弃修改；下面主题、抬头两行，然后是一个正文输入框。正文里空一行是新的一段；要点列表、信息表、引用是用 `:::` 围起来的一段：`:::要点 标题` 下面一行一条，`:::信息 标题` 下面一行一项、写成「名称：内容」，`:::引用 标题` 下面写引用的话，各以单独一行 `:::` 结束；标题可以不写（引用要有标题）；行首本来就是 `:::` 的文字写成 `\:::`。工具栏的「要点列表」「信息表」「引用」在光标处插入一段写法，照着改；「插入变量」展开按这一类信能用的变量分组的清单（点一下插到光标处，鼠标移上去写它是什么，清单来自接口，没点过任何输入框时插在正文末尾）；「写法说明」展开上面这些规则。摘要、小标题、按钮（文字和官网里的路径，可以不要）、页脚（一行一条）收在「更多设置」里。
- 文字与块互转（`lib/mail-templates.ts` 的 `blocksToText`、`textToBlocks`）：接口里的正文仍是块的列表，页面读到模板时转成文字，保存和预览时再转回去；全部内置模板转成文字再转回，块逐项相同（`tests/console/mail-templates.test.ts`）。写得不全的（没有结尾的 `:::`、没有内容的块）照样转成块，由服务端指出缺什么。
- 保存前核对出的问题按路径标在对应位置：名称、主题、抬头、摘要、小标题、按钮、页脚各在自己的输入框下面；正文里任何一块的问题都标在正文输入框下面（服务端的话里已经写了第几块）；保存和预览指出的同一句话只留一条；认不出对应位置的写在编辑区顶上。有没保存的修改时切换到别的模板、复制、新建都会先问「放弃没保存的修改？」。
- 保存时带着读到这套模板时的更新时间（`expected_updated_at`）；别人先改过回 409 `template_changed`，出现「载入别人改过的版本」按钮，确认后丢掉自己的修改载入最新的。名字重名（`template_name_taken`）标在名称输入框下面。
- 实时预览：每次编辑停手 400 毫秒后调 `POST /api/console/mail-templates/preview`（`lib/mail-templates.ts` 的 `createPreviewer`），连着改只发最后一份，内容没变不重复请求，先发的旧请求后回来会被丢掉；渲染不出来时保留上一版预览、标成旧的，原因写在预览上面，问题同时标在对应的输入框下面。预览放在 `<iframe sandbox="" srcdoc>`（`components/MailPreviewFrame.vue`）里，不带任何权限，不执行脚本，不能碰页面；可以切「邮件样式」和「纯文本」。预览栏顶上有「示例数据」「刷新」「发测试邮件」三个按钮；「示例数据」弹出小窗，可以换姓名、班级、特长和（待面试、已录取、未通过的）信里填的内容，只影响预览和测试邮件。
- 测试邮箱试发：点预览栏的「发测试邮件」弹出小窗，一个邮箱输入框加「发送」，结果写在下面；发的是正在编辑的这一版，没保存也可以；主题前加「【测试】」，只发到填的这一个邮箱。发出前先在本地核对邮箱的写法；结果照实显示：已发出、已交给发信队列、没发（发信没有配置，或这个邮箱不在白名单里）、发失败了（发信商的错误码）；次数用完（429）时写明约多久恢复。要刚登录过（step-up），过期时错误卡片的主按钮是「重新登录」。
- 开发预览：模板列表、预览和投递详情里的预览用样板数据真的渲染（见「源码地图」`src/mock/`），其余写操作回 501。

## 投递详情与通知信

投递列表（`/console/applications`）窄于 640px 时表格换成一份一张卡（`TxCardItem`，和用户页同一做法）：姓名、班级、投递时间、状态，下面是特长摘要两行和邮箱、最后处理人，点卡片打开投递详情。

投递状态为五种：已收到、待面试、已录取、未通过、已取消（#204，`cancelled`，排在最后，用 slate 色调）。状态下拉框与列表筛选都使用这份清单，计数、概览与 CSV 筛选包含取消。进度条只展示已收到、待面试、已录取三步；未通过单独说明，已取消显示「这份投递已取消。简历和审核记录已保留。」，不显示正常录取进度。#148 去掉了「评估中」，服务端启动时把仍停在 `reviewing` 的投递改回已收到；审核记录里的 `reviewing` 照旧显示「评估中」。遇到不认识的状态 id 原样显示，页面不出错（`lib/statuses.ts` 的 `statusMeta`）。

「处理这份投递」里选了和现在不同的状态时，出现「通知投递人」一栏：

| 改成 | 这一栏 |
|---|---|
| 待面试 | 「给投递人发邮件」（默认勾选）；勾上时要填面试时间（例如「9 月 30 日（周三）19:00」）和面试地点，面试说明选填、一行一条。时间和地点是单行输入框，在里面按回车不提交（回车提交会马上发出一封没写完的信） |
| 已录取 | 同一个勾选框；勾上时可以填「接下来要做的事」，一行一条 |
| 未通过 | 同一个勾选框；勾上时可以填「写给投递人的话」 |
| 已收到 | 只写「改回已收到不发邮件。」 |
| 已取消 | 只写「这份投递将标为已取消，不发邮件。简历和审核记录会保留。」；没有发信勾选或信件输入，按钮为「保存」 |

这一类信有两套以上启用的模板时（依据详情接口的 `letter_templates`，#285），勾选框下面多一个「用哪一套信」下拉框，默认选中这一类的默认模板（名字里没有「默认」二字时标成「名字（默认）」）；只有一套时不出现。信的输入框下面是「预览这封信」按钮：按这份投递的真实字段和已经填的内容，调 `POST /api/console/applications/:application_id/letter-preview` 渲染，在弹窗「这封信发出去的样子」里显示，不发信、不改状态，面试时间、地点没填时显示为待填；预览用的是 `apply.review`，审核人不需要有 `mail.template.manage`。请求体只在选了默认以外的模板时才带 `template_id`；服务端回 `template_invalid`（选的这套被停用或删除了）时显示在「通知投递人」一栏里。

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

`base` 是 `/`，不读 `public/`（favicon 与 logo 作为模块导入进 `console-assets/`）。静态资源 CDN 开关（#146，构建参数 `STATIC_CDN_BASE`）打开时，`vite.config.ts` 用 `experimental.renderBuiltUrl` 把 `console-assets/` 下的文件改写到 `https://cdn.yangtzeu.work/geek-public/static/site/console-assets/…`，入口页与路由仍走源站；为空时同源。规则与 web 相同，见 [web 合同](../web/README.md)「静态资源 CDN 开关」。web 镜像把这份 dist 叠进 nginx 站点根，`/console`、`/console/…`、`/admin`、`/admin/…`、`/signin`、`/device`、`/account`、`/authorize`、`/bind-email` 回落到 `sites/console/index.html`；服务端 `resolveSiteEntry` 与开发态 Vite 的 `/device` 代理同一规则（直连 server 时）。详见 [web 合同](../web/README.md) 与 [DEPLOY](../../ops/DEPLOY.md)。

首次打开的加载提示（#263）：`index.html` 在 `#app` 后面放了一段 `.console-boot`（转圈 +「正在加载控制台」）和它的内联样式，入口页一到就画出来，不等控制台的样式表和脚本；样子和位置照 `ConsoleRoot` 的「正在确认登录状态」，颜色、字体取 `src/styles/theme.css` 的令牌，改令牌时一起改（`tests/console/boot-placeholder.test.ts` 核对）。Vue 挂载后 `#app` 不再为空，`#app:not(:empty) ~ .console-boot` 把提示藏起，交接时不闪白；10 秒后还没挂载，在下方补一句「网络较慢，长时间没有反应可以刷新页面」；减少动态效果时不转圈；禁用 JavaScript 时只显示「控制台需要开启 JavaScript 才能使用。」。线上 CSP 允许内联样式、不允许内联脚本，所以提示只用样式。Vite 默认把样式表链接放进 `<head>`，浏览器要等它下完才开始画（Fast 3G 下约 1.2 秒），所以构建时 `vite.config.ts` 的 `moveStylesheetsToBodyEnd` 把它挪到 `</body>` 前：预加载扫描器照常并行下载，模块脚本按 HTML 规范仍等样式表就绪才执行，挂载时样式已经齐了。开发态（`pnpm dev:console`）样式由脚本注入，不经过这一步。

## 开发

```bash
pnpm dev:console                     # http://127.0.0.1:5186/console ，默认连本地后端（Vite 把 /api、/auth、/oidc 代理到 127.0.0.1:3000）
# 地址参数（仅开发态）：
#   ?__data=mock      改用样板数据（自动化测试用，tests/e2e 显式带上）
#   ?__data=live      切回本地后端
#   ?__persona=<名>   样板数据下切换身份：owner（站长，全部权限）、owner_email（站长用邮箱登录）、owner_stale（站长，登录超过 10 分钟，写操作回 403 step_up_required）、
#                     management_head（管理部部长）、ai_head（AI部门部长，只看本部门）、ai_staff（AI部门部员，在自定义组「活动志愿者」里，只能管比赛）、
#                     member（极客班成员）、alumni（往届成员）、registered（注册用户），后三个没有「进入控制台」；signed_out（未登录）；
#                     no_email、no_email_stale 是还没有登录邮箱的极客班成员（#273），后者这次登录已超过 10 分钟
#                     no_profile 是还没填姓名和年级的极客班成员（#280）
```

开发态默认 `live`，是因为本机预览可以走真实 GitHub 登录（见 [LOCAL-PREVIEW](../../ops/LOCAL-PREVIEW.md)）；本地后端没起时页面是请求失败状态。`?__data=` 的选择记在本标签页的 `sessionStorage`（`yugc:console-data-source`），换标签页回到默认。数据源只在开发构建可切换；生产构建里 `dataSource()` 恒为 `live`，mock 模块不进产物。样板数据只读，写请求返回 501 `mock_read_only`，页面会说明「开发预览是只读的」。写请求先按服务端核对权限节点和 step-up（`owner_stale` 一律 403 `step_up_required`），用户、权限组的写请求再核对最后一位站长（409 `last_owner`）、删除系统组（409 `system_group`）、继承成环（400 `group_cycle`）和未知节点（400 `unknown_node`）；处理投递的写请求照旧核对（状态只能是五种之一，页面上的状态或最新审核记录和样板不同、改状态却没带这两项时 409，要发待面试的信时面试时间和地点必填），不合法的得到和服务端一样的 403/400/409，合法的照样 501，不假装信已经排进发信队列。投递详情的样板带 `mail`、`received_mail` 和每条审核记录的邮件，上面的说法除了三种上限（24 小时内发过、同一个网络投递太多、这一小时到上限）都能看到，这三种的说法在 `tests/console/applications.test.ts` 里核对；发信设置用白名单模式（两个真实环境现在都是发给所有人，#169），只有三个样板邮箱在白名单里，好看到白名单挡下时的说法。另有一份已取消的虚构样板，其取消审核 `mail: null`，原确认信仍是已发出。

## 设计令牌

浅色「冰白纸面 + 钴蓝」，全部经 Tuffex 官方令牌表达（`src/styles/theme.css`）：`--tx-color-primary: #3346C8`，文字与边框换成同色相的藏青/冷灰，语义色用服务端 `roles.ts` 的色调（白底 ≥5:1），`--tx-bui-*` 同步给 SidebarNav。页面底铺一层 4% 钴蓝的图纸网格，面板纯白。部门色取 SPEC §1（`src/lib/tone.ts`）：AI 青绿、算法蓝、硬件靛、网安粉、管理 `#3a78f0`、无部门 `#5b7fb5`；圆点用原色（`DEPT_TONE_SWATCH`），文字用同色相加深的一档（`DEPT_TONE_TEXT`），白底上读得清。称号徽章是 TxTag（soft，不带图标），部门里的称号用部门色，站长这类不属于部门的用无部门色；名字取接口（称号是后台数据，在「权限」里改组名）。一套无衬线字体；等宽只给用户名、编号、节点和代码。下拉面板（`TxSelect`、`TxSearchSelect`）一律传 `panel-background="pure"`：Tuffex 默认的 `refraction` 会折射背后的页面，字透出来还带彩边（所有者 2026-10-24 提出所有下拉框都不要这种样式）；`TxBlockSelect` 传不进这个属性，不用；`tests/console/dropdown-panels.test.ts` 读源码核对。Tuffex 0.9.0 起弹窗与抽屉也默认用 `refraction`，`src/main.ts` 启动时调 `setSurfacePerformanceMode('max')`，整页的玻璃类材质都画成不透明的 `flat`。`TxSelect` 选项满 8 个会自动出现英文的搜索框：用户页的部门筛选传 `search-placeholder="搜索部门"`、`empty-text="没有这个部门"`，年级、状态这类固定几项的下拉传 `:searchable="false"`，同一个测试核对。规则总表见 [DESIGN](../../design/DESIGN.md)「控制台」。

## 验证

`tests/e2e/application-cancelled.spec.mts` 在 1440px / 390px 下由浏览器调用真实 Fastify 路由与内存库，只有身份查询和发信商是假响应，不接用户的本机验收实例、不发真实邮件；覆盖打开选项、键盘选取消、保存、刷新、保留历史、取消筛选与导出链接，以及过期画面 409 后保留备注。`tests/e2e/workflows.spec.ts` 的控制台用例用样板数据：按身份看导航（站长全部、AI部门部长没有权限和 GitLab、成员和注册用户看到「你还不能使用控制台」）、缺节点的说明、未登录去统一登录页、用户页按身份筛选和抽屉的三个页签与部门六选一、部门部长只看到本部门、权限页的分段与系统组不能删、删除自定义组的确认从「取消」开始、过了 step-up 窗口的写操作给「重新登录」、操作记录按结果筛选、新页面没有原生 select 和 checkbox、390px 下页面不横向溢出且导航在抽屉里（#274 改写这些用例时没有在本机跑 Playwright）；另一条在开发服务器上扣住 `src/main.ts`：脚本没到时入口页已显示「正在加载控制台」、`#app` 为空，放行后概览出来、提示藏起（#263）。截图和自动测试不代替在预发布做的人工验收。

```bash
pnpm --filter @yzgc/console typecheck   # vue-tsc（根 pnpm typecheck 也会跑）
pnpm test                               # tests/console/*：导航可见性（`nav.test.ts`，按样板身份）、邮件模板页的草稿与请求体、正文文字与块互转（含全部内置模板的往返）、变量插入、问题标位、状态与模板的对应、实时预览的防抖与过期响应、试发结果和样板数据（`mail-templates.test.ts`，#285、#293）、用户页的编辑稿、PATCH 体和筛选（`users.test.ts`）、权限页的分段、条目和组的表单、解释来源链与样板求值和写操作核对（`permissions.test.ts`）、操作记录的筛选、北京时间起止与样板分页、IP 打码、部门范围（`activity.test.ts`）、GitLab 账号同步的说法与样板形状（`gitlab.test.ts`）、错误映射（含 step_up_required 给「重新登录」）、用到一半 401 时统一退出、处理投递（通知信提示、字段核对、请求体、信件状态、北京时间）、首次加载提示（入口页结构、令牌一致、样式表挪位）、登录页（`signin.test.ts`：按 `/auth/providers` 渲染、注册要填姓名和年级、补资料页的回跳、`return_to` 同源校验、`signin` 原因文案、先开哪个标签、注册表单的本地检查、注册提交后的三种结果）、设备授权确认页（`device.test.ts`）、对外授权的同意页（`authorize.test.ts`）、比赛的报名与积分（`competition-hub.test.ts`）和官网、贡献、奖项、兑奖（`competition-contest.test.ts`）
pnpm --filter @yzgc/console build       # 根 pnpm build 也会跑
node scripts/check-boundaries.mjs       # console ↔ web ↔ server 互不导入
```

### 控件外观（#283）

所有者 2026-10-24 22:16 反映论坛界面太紧凑，要求优化 admin 界面、全面检查，并认为很多按钮很难看；22:17 又表示 admin 的弹窗很难看。`src/styles/controls.css` 只改控制台里的 Tuffex 控件，选择器前加 `body` 压过 Tuffex 带 `data-v` 的同名规则，不用 `!important`：

- 按钮三档：`primary` 实心钴蓝白字（把 `fake-background` 那层 75% 浅色的 `--fake-opacity` 设成 0，不然发白），`secondary` 白底细边，`ghost` 文字按钮；`danger` 浅红底红字。去掉 80px 的最小宽度，常规高 32px、`sm` 28px、`lg` 40px。
- 弹窗（`TxModal`）：最高到视口减 40px，标题和底部按钮固定，中间正文滚动，底部按钮上方一条分隔线；窄屏四周留 12px。表单再长也看得到「取消」「保存」。
- 页签：鼠标点过不留粗框，键盘切换时留一条细框。
- 日期：全部用 `components/DateField.vue`（`TxDatePicker` 的下拉日历，中文文案、周一开头，值仍是 `YYYY-MM-DD`，`clearable` 时选了以后旁边有「清除」）；Tuffex 0.9.1 的星期表头写死英文，`controls.css` 按周一开头换成「一」到「日」。日期框高至少 44px，浅底无边框，和输入框一致；Tuffex 的日期框样式是 scoped，`body` 压不过，选择器多带一层 `.date-field`。比赛弹窗里日期框和输入框一样是 46px。控制台里不再有原生日期框。
- 论坛管理「我的论坛权限」改成卡片网格，每张卡片写权限名、能做什么和「有／没有」；「打开论坛」改成次按钮。

## 已知限制

- 邮件模板页（#285、#293）在隔离栈的真实浏览器里看过 1440×900 与 390×844（三栏各自滚动、手机四个页签、变量与写法插入、下拉换默认、保存后刷新一致、测试邮件小窗）；预览 iframe 在预发布内容安全策略下的显示和 1180px 附近的断点没有单独核对；页面逻辑只靠 `tests/console/` 的纯逻辑测试和样板数据覆盖，没有挂载组件的测试。信息表的一行按第一个冒号（全角或半角）切成名称和内容，所以名称里不能带冒号，内容里可以；之前存下来的模板如果信息表的名称里带冒号，打开后预览会按新的切法排，改好名称再保存。
- Tuffex 0.9.1 发布包里 18 个子路径（error-state、permission-state、empty、loading-state 等）的 `style.css` 是空文件，只能整包引入 `@talex-touch/tuffex/style.css`（与论坛相同）。2026-10-24 从 0.6.0 升到 0.9.1（所有者要求整体更新组件库）后，构建出的主 CSS 从约 622KB（gzip 约 91KB）变成约 936KB（gzip 约 137KB），主 JS 的 gzip 从约 91KB 变成约 109KB，多出来的是 0.7–0.9 新增组件的样式。上游把这些子路径补齐后可改回按组件引入。
- Tuffex 与其依赖 `@talex-touch/utils` 声明 `engines.node >=26`，工作区是 Node 22；实测构建与运行正常；pnpm 默认不开 engine-strict，仓库也没有打开它。`@talex-touch/utils` 把 `electron` 声明为 peer：根 `package.json` 用 `pnpm.packageExtensions` 标成可选，锁文件里没有 electron。`@unocss/inspector` 通过 `pnpm.overrides` 固定 `@vitejs/devtools-kit@0.7.3`（与论坛同版本），0.7.5 依赖的 devframe 1.0 与 0.9 混装会让 Vite 配置加载失败。
- TxFormItem 在标签置顶时不会撑满宽度、TxDataTable 在窄屏会把固定布局的列压到重叠：`layout.css` 用两条选择器补上（见文件注释），没有改组件内部结构。
- 窄屏表格（#287）：`TxDataTable` 设了 `--table-min` 就会在卡片里横向滚动，手机上右边的列被截掉。列不多、一行讲得清的表（注册邀请码、GitLab 账号同步、论坛分类、备份记录、权限节点、计分基础分）窄于 640px 时换成一行一张卡：表格加 `table-wide`，旁边放一个 `ul.row-cards`，`layout.css` 在 640px 以下隐藏前者、显示后者，两边各带一份空状态；列很多的表（操作记录、比赛名单、积分记录等）继续横向滚动。表格里的空状态改成贴着可见区域居中（`layout.css` 的 container query 单位），不再落在滚动区外被截掉。Tuffex 把叫 `action`、`actions` 的列当操作列钉在右边，所以操作记录里「动作」那一列的键叫 `event`，不能叫 `action`。`tests/console/narrow-layout.test.ts` 核对这几条约定。
- 截断依赖 `layout.css` 里的 `.ellipsis`：统一隐藏溢出并保持单行；普通行内 `span.ellipsis` 另用 `inline-block` + `vertical-align: bottom` + `max-width: 100%` 使省略号生效，`dd` 等块元素保持原布局（#211）。
- 键盘与读屏只做了基本检查（焦点可见、对话框初始焦点在取消）；WCAG 2.2 AA 对比度、屏幕阅读器未做专项测试。

# Console 服务合同（`app/console`）

> 极客班控制台前端：Vue 3 + Tuffex 单页应用，按称号能力显示页面；接口全部来自 `app/server`，产物由 web 镜像托管。

状态：`current` · 更新：2026-09-25 · 源码：`app/console/` · 产物：`app/console/dist/`（随 `yzgc/web:<tag>` 镜像发布）

## 为什么是独立的包

所有者 2026-09-24 要求控制台「统一套用组件库」，用论坛同款 Tuffex（issue #13）。Tuffex 只有 Vue 3 版本，[Tuffex 使用政策](../../components/tuffex/USAGE-POLICY.md)禁止在 React 里套 Vue 组件或做同名 React 仿制品，所以控制台从 `app/web`（React）里拆出来，单独成 `@yzgc/console` 包。它和 `app/web`、`app/server` 在同一个根 pnpm 工作区（Node 22 / pnpm 9.15.9），不另起工具链；论坛那套 Node 26 / pnpm 11 与它无关。

## 源码地图

| 路径 | 职责 |
|---|---|
| `app/console/index.html`、`src/main.ts`、`src/App.vue` | 入口：整包引入 Tuffex 样式、UnoCSS 图标、主题；挂路由、全局确认框、TxToastHost |
| `src/router.ts` | 路由表与每页所需能力（`meta.anyOf`） |
| `src/pages/` | 页面：`Overview`、`Applications`/`ApplicationDetail`、`Forum`、`People`（`people/` 下是添加称号、编辑部门权限包、编辑称号三个对话框和称号列表 `TitleList`）、`Feedback`、`Audit`、`SignIn`、`ConsoleRoot`（取身份与乘客态）；`github/` 下是组织概况、成员、仓库与仓库详情（`github/repo/`）、团队、活动、安全、组织资料、邀请、邀请链接、新建仓库 |
| `src/components/` | 外壳（`ConsoleShell`、`ConsoleNav`）、能力门 `CapabilityGate`、状态组件（`ErrorPanel`、`ErrorAlert`、`LoadingBlock`）、`TitleBadge`/`ToneTag`/`UserCell`、`PageHeader`、`ConfirmHost` |
| `src/lib/` | 纯逻辑（可单测，不导入 Vue）：`http`（请求与 `ApiError`）、`errors`（错误 → 文案）、`nav`（导航与能力可见性）、`people`（按部门分组、负责人与排序、撤销规则）、`titles`（称号的默认值、徽章与编辑校验）、`org-settings`（组织资料改动计算）、`statuses`、`format`、`icons`、`types`；带 Vue 的：`session`（身份与能力清单）、`resource`（读写状态）、`confirm`、`github`、`runtime`（数据源与跨服务链接） |
| `src/mock/` | 开发预览样板数据（全部虚构），只在 DEV 且数据源为 mock 时动态导入，生产构建不含 |
| `src/styles/theme.css`、`layout.css` | 主题令牌覆盖与页面版式（见「设计令牌」） |
| `scripts/tuffex-icon-classes.mjs` | 扫描已安装 Tuffex 的 dist，给 UnoCSS 列出组件自带的 `i-carbon-*` 图标类（做法同论坛） |
| `vite.config.ts`、`uno.config.ts`、`tsconfig.json` | 构建、图标、类型检查配置 |

依赖方向：`pages → components → lib`；`lib` 里的纯逻辑模块不导入 Vue。控制台不得导入 `app/web` 或 `app/server` 的源码，`app/web` 也不得导入控制台（`scripts/check-boundaries.mjs` 检查，含 `.vue` 的 `<script>`）。和服务端共用的只有 HTTP 形状，类型在 `src/lib/types.ts` 手写一份，`tests/console/mock-sync.test.ts` 核对它没有和服务端 `roles.ts` 漂移。

## 路由

| 路径 | 页面 | 所需能力（任一） |
|---|---|---|
| `/signin` | GitHub 登录；`?signin=<原因>` 时说明上次登录为什么没成功 | 无 |
| `/console` | 概览 | `console.access` |
| `/console/applications`、`/console/applications/:id` | 投递管理、投递详情 | `applications.read` |
| `/console/forum` | 论坛管理 | 任一 `forum.*` |
| `/console/people` | 成员与权限：「成员」像飞书通讯录，左边是全部成员、各部门与「没有部门」（`?group=<部门 id>`），右边是选中那一组的负责人、上级和名单；`?view=titles` 为「称号」（只给 `roles.manage`：六个称号的名字、英文标签、图标、色调、说明和权限都在这里改）；`?view=departments` 为部门与权限包（可编辑权限包、删除部门） | `roles.manage`、`roles.department.manage` |
| `/console/feedback` | 意见箱 | `feedback.read` |
| `/console/audit` | 审计日志 | `audit.read` |
| `/console/github/**` | GitHub 组织页面；邀请与邀请链接另需 `github.invites.manage`，新建仓库另需 `github.repos.manage` | `github.org.read` |
| `/admin`、`/admin/**` | 跳到 `/console` | — |
| `/console/signin`、`/admin/signin` | 跳到 `/signin` | — |

旧的多组织入口 `/admin/:org/*` 不再保留页面：组织固定为 `CONSOLE_ORG`，GitHub 组织页面挂在 `/console/github/**` 下，接口仍是 `/api/admin/:org/*`。页面能力门只是提示，授权只在服务端。

## 接口

只调用 `app/server` 已有的接口，不新增、不改后端：

- `/api/console/*`：`me`、`catalogue`、`summary`、`departments`（含删除）、`titles`、`people`、`assignments`、`applications`（含 `export.csv` 下载链接）、`feedback`、`audit`。称号的名字、标签、图标、色调、说明和权限一律取自 `catalogue`，代码里只有加载前的默认值（`lib/titles.ts` 的 `DEFAULT_TITLES`）。契约见 [API](../../architecture/API.md)「极客班控制台」。
- `/api/admin/:org/*`：GitHub 组织页面，`:org` 取 `/api/console/me` 返回的 `org`。
- `/auth/github?return_to=<本站地址>` 登录；`POST /auth/signout` 退出。登录是全站共用的（官网、论坛、控制台同一个 `sid`），只有 `CONSOLE_ORG` 的 active 成员能登录，见 [SECURITY](../../architecture/SECURITY.md)「登录门槛」。

请求一律同源 `fetch`、`credentials: "same-origin"`，错误体解析成 `ApiError { status, code, message, requestId, payload }`，与 `app/web/shared/lib/http.ts` 同一契约。写操作经服务端的 Origin/Fetch Metadata 检查，控制台与接口同域，不需要额外处理。

## 状态

每个读取都有加载（Tuffex 骨架）、空（TxEmptyState，写明下一步）、失败（TxErrorState + 重试，附 `HTTP 状态 · 机器码 · request id` 一行）三种状态。缺能力：页面级用 `CapabilityGate`（TxPermissionState）写明缺哪项；若称号给了、但被 GitHub 组织角色挡住，说明是这个原因。未登录（`/api/console/me` 返回 401）跳到 `/signin?return_to=<原路径>`。登录没成功时核心服务把人送回原来的控制台地址并带 `?signin=<原因>`；`ConsoleRoot.vue` 把 `signin` 从 `return_to` 里拿掉、单独传给 `/signin`，再次登录成功后不会带着旧原因回去。已登录但没有任何能力显示乘客说明。

登录页（`SignIn.vue`）写「只对极客班 GitHub 组织的成员开放。能看到哪些页面、做哪些操作，取决于你的称号。」，按 `signin` 参数在按钮上方显示一条不可关闭的 TxAlert，未知取值不显示：

| `signin` | 类型 | 标题 | 正文 |
|---|---|---|---|
| `not_member` | warning | 只有极客班成员可以登录 | 这个 GitHub 账号不在极客班的 GitHub 组织里，控制台只对成员开放。 |
| `invite_pending` | warning | 还没接受组织邀请 | 到 GitHub 的通知或邮件里接受极客班组织的邀请，再回来登录。 |
| `cancelled` | info | 已取消登录 | — |
| `failed` | warning | 登录没有完成 | 请稍后再试一次。 |

`?signed_out=1` 另显示「你已退出登录」。写操作失败用 TxAlert 内联提示，保留已填内容；危险操作一律先确认（初始焦点在「取消」）。

## 构建与托管

`pnpm --filter @yzgc/console build` 先 `vue-tsc` 再 `vite build`，产物：

```text
app/console/dist/
  sites/console/index.html      # 唯一入口
  console-assets/*.js|css|png   # 带哈希的资源，不与官网的 /assets/ 重名
```

`base` 是 `/`，不读 `public/`（favicon 与 logo 作为模块导入进 `console-assets/`）。web 镜像把这份 dist 叠进 nginx 站点根，`/console`、`/console/…`、`/admin`、`/admin/…`、`/signin` 回落到 `sites/console/index.html`；服务端 `resolveSiteEntry` 同一规则（直连 server 时）。详见 [web 合同](../web/README.md) 与 [DEPLOY](../../ops/DEPLOY.md)。

## 开发

```bash
pnpm dev:console                     # http://127.0.0.1:5186/console ，默认连本地后端（Vite 把 /api、/auth 代理到 127.0.0.1:3000）
# 地址参数（仅开发态）：
#   ?__data=mock      改用样板数据（自动化测试用，tests/e2e 显式带上）
#   ?__data=live      切回本地后端
#   ?__persona=<名>   样板数据下切换身份：admin（组织 owner）、captain、recruitment、tech、community、projects、crew、member、alumni、guest、signed_out
```

开发态默认 `live`，是因为本机预览可以走真实 GitHub 登录（见 [LOCAL-PREVIEW](../../ops/LOCAL-PREVIEW.md)）；本地后端没起时页面是请求失败状态。`?__data=` 的选择记在本标签页的 `sessionStorage`（`yugc:console-data-source`），换标签页回到默认。数据源只在开发构建可切换；生产构建里 `dataSource()` 恒为 `live`，mock 模块不进产物。样板数据只读，写请求返回 501 `mock_read_only`，页面会说明「开发预览是只读的」。

## 设计令牌

浅色「冰白纸面 + 钴蓝」，全部经 Tuffex 官方令牌表达（`src/styles/theme.css`）：`--tx-color-primary: #3346C8`，文字与边框换成同色相的藏青/冷灰，语义色用服务端 `roles.ts` 的色调（白底 ≥5:1），`--tx-bui-*` 同步给 SidebarNav。页面底铺一层 4% 钴蓝的图纸网格，面板纯白。称号徽章用 TxTag + 称号图标，名字、图标和色调取 `/api/console/catalogue`（可在「称号」里改），默认提督 violet、舰长 amber、队长随部门色、部门舰员 slate、舰员 sky、领航员 jade。一套无衬线字体；等宽只给 GitHub 登录名、编号、代码。规则总表见 [DESIGN](../../design/DESIGN.md)「控制台」。

## 验证

```bash
pnpm --filter @yzgc/console typecheck   # vue-tsc（根 pnpm typecheck 也会跑）
pnpm test                               # tests/console/*：导航可见性、名单排序与按部门分组、称号编辑校验、组织资料改动、错误映射、与服务端清单同步
pnpm --filter @yzgc/console build       # 根 pnpm build 也会跑
node scripts/check-boundaries.mjs       # console ↔ web ↔ server 互不导入
```

## 已知限制

- Tuffex 0.6.0 发布包里 17 个子路径（breadcrumb、steps、pagination、error-state、permission-state 等）的 `style.css` 是空文件，只能整包引入 `@talex-touch/tuffex/style.css`（与论坛相同），CSS 约 570KB（gzip 约 83KB）。上游修好后可改回按组件引入。
- Tuffex 与其依赖 `@talex-touch/utils` 声明 `engines.node >=26`，工作区是 Node 22；实测构建与运行正常；pnpm 默认不开 engine-strict，仓库也没有打开它。`@talex-touch/utils` 把 `electron` 声明为 peer：根 `package.json` 用 `pnpm.packageExtensions` 标成可选，锁文件里没有 electron。`@unocss/inspector` 通过 `pnpm.overrides` 固定 `@vitejs/devtools-kit@0.7.3`（与论坛同版本），0.7.5 依赖的 devframe 1.0 与 0.9 混装会让 Vite 配置加载失败。
- TxFormItem 在标签置顶时不会撑满宽度、TxDataTable 在窄屏会把固定布局的列压到重叠：`layout.css` 用两条选择器补上（见文件注释），没有改组件内部结构。
- 键盘与读屏只做了基本检查（焦点可见、对话框初始焦点在取消）；WCAG 2.2 AA 对比度、屏幕阅读器未做专项测试。

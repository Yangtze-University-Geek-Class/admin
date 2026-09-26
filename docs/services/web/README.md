# Web 服务合同（`app/web`）

> 官网 portal（React/Vite）+ shared 适配层；web 镜像同时托管控制台产物（`app/console`），是每个环境的 HTTP 入口容器。

状态：`current` · 更新：2026-09-26 · 源码：`app/web/` · 镜像：`yzgc-<environment>/web:<sha12>`

## 源码地图

| 路径 | 职责 |
|---|---|
| `app/web/sites/portal/` | 公开站点：`App.tsx` 路由（`/`、`/join-us`、`/forum-3d`、`/github`、`/docs`、`/feedback`、`/join/:token`）、`pages/`、`three/`（按需加载的 three.js 场景：书桌、信封、论坛气泡、GitHub 天际线）、`components/`（YUGC OS 桌面、加载动画、页面外壳）、`lib/`（状态机、进度、相机数学、链接、快照、图标、全站登录状态 `account.ts`）、`styles/`（浅色书桌 × YUGC OS 视觉令牌）、`index.html` 入口；不自建登录态，菜单栏显示全站 GitHub 登录的账号或登录入口（见 [portal](portal.md)「登录入口」） |

| `app/web/shared/lib/` | 网络（`api`、`http`、`runtime`）、URL/站点（`site`）、Markdown（`markdown`）、挂载（`mount`）、PoW、主题、只读 mock |
| `app/web/shared/ui/` | 官网复用的交互原语：Modal、ConfirmDialog、Select、ImageLightbox、TurnstileWidget、Mascot 等 |
| `app/web/shared/styles/` | 基础样式与令牌（`base.css`、`mascot.css`、`rounded.css`） |
| `app/web/shared/config/` | 公开前端配置（`app.config.json` → `config/index.ts` 的站点标题与 basePath 合同；不含域名） |
| `app/web/Dockerfile` | Node 22 构建官网（`app/web`）与控制台（`app/console`）两份产物，叠进同一个 nginx 站点根 → 静态托管与反代；容器内监听 8080（非特权），并生成 `release.json` 供发布身份核对 |
| `app/web` 镜像内 nginx 配置 | 由 `Dockerfile` 生成：`/api/*`、`/auth`、`/auth/*`（OAuth 登录与回调）、`/healthz` → `server:3000`；`/forum` 308 到 `/forum/`，`/forum/*`（含图片、字体，`location ^~` 不让官网的图片规则截走）剥掉前缀后 → `forum:3000`；`/admin`、`/console` 及其子路径与 `/signin` → 控制台入口 `sites/console/index.html`，其余 → portal，与 Host 无关；`/assets/*`（官网）与 `/console-assets/*`（控制台）是带哈希的长缓存资源；`/sites/*` 只提供真实文件，不存在即 404；安全头由宿主 nginx 统一下发，容器不重复 |

模块细节：[portal](portal.md)、[shared](shared.md)；管理端已迁到 `app/console`（[console 合同](../console/README.md)，迁移说明见 [admin](admin.md)）。依赖方向：站点 → shared → 通用依赖；shared 不得反向导入站点；`app/web` 与 `app/console` 互不导入。

## 契约

- **两个前端包、一个镜像**：官网由本包的 Vite 构建产出 `sites/portal/index.html`，控制台由 `app/console` 单独构建产出 `sites/console/index.html`；`web` 镜像同时承担 TLS 之后的静态托管与反向代理，是唯一对宿主机暴露业务端口的容器（容器内 8080，宿主 production `127.0.0.1:18100`、preview `127.0.0.1:18200`）。
- **域名**：每个环境只有一个域名——正式 `yangtzeu.work`、预发布 `prev.yangtzeu.work`。portal、控制台、论坛同域，按路径区分：控制台是 `/console/…`（登录页 `/signin`，旧的 `/admin/…` 跳到 `/console`），论坛是 `/forum/…`，其余路径是 portal。旧的管理端独立子域与论坛子域都已退役（见 [DEPLOY](../../ops/DEPLOY.md) 历史章节）。
- **HTTP 边界**：前端只通过 `shared/lib/api` 访问 `/api/*`；跨端链接使用 `externalUrl`，同端使用 Router。生产态跨端链接是同源路径（`/forum/…`、`/console`），不拼域名；开发态仍走 `/sites/<端>/…`，论坛指向本机 3456。
- **配置**：构建期只读公开配置（`app.config.json`），不加载私有 `.env`，也不含任何域名，同一份产物在两个环境通用；`scripts/check-site-config.mjs`（`pnpm check:site-config`）校验站点不带 host、论坛 basePath 非空且不与其他站点重叠、production 数据源固定为 live。
- **UI 选型**：官网是既有 React 实现，后续新增/迁移界面按 [Tuffex 使用政策](../../components/tuffex/USAGE-POLICY.md)；控制台已迁到 Vue + Tuffex（`app/console`）。不引入平行基础 UI 体系。

## 运行

```bash
pnpm dev:web        # 官网只读 mock 预览，无需 OAuth 或业务数据库
pnpm dev:console    # 控制台（app/console），默认连本地后端，?__data=mock 切样板数据
pnpm dev            # 前后端开发（需要本机 .env，模板见 ../../ops/ENVIRONMENT.md）
pnpm preview:local  # 核心 5173/3000 + 独立论坛 3456，见 ../../ops/LOCAL-PREVIEW.md
```

本机地址：官网 `http://127.0.0.1:5173/sites/portal/`；控制台 `http://127.0.0.1:5186/console`（`pnpm dev:console`）。5173 上的 `/console`、`/admin`、`/signin` 与旧的 `/sites/admin/*` 在开发态 302 到 5186；`/forum/<路径>` 302 到 `http://127.0.0.1:3456/<路径>`（去掉 `/forum` 前缀，查询参数保留，登录后回到论坛原页面靠它）。容器内由 nginx 托管构建产物并按路径选择入口；宿主 nginx 只做 TLS 终止与 `server_name` → 回环端口转发。

## 验证命令

```bash
pnpm typecheck                        # app/web/tsconfig.json
pnpm test                             # 组件与共享层单测
pnpm test:e2e                         # 浏览器验证（Playwright）
pnpm build                            # Vite 产物
node scripts/check-boundaries.mjs     # 站点/shared 依赖方向
node scripts/check-site-config.mjs    # 站点配置不含域名、论坛 basePath、production 数据源
```

浏览器验收项（键盘/焦点、错误与空状态、窄屏与移动导航、模态背景 inert、分页 URL）见 [TESTING](../../conventions/TESTING.md) 与 [DESIGN](../../design/DESIGN.md)。

## 已知限制

- 本机 mock 预览是只读样板，不操作真实 GitHub；真实数据只在连上 `app/server` 后出现。
- 旧入口跳转**只存在于本机 Vite dev**（`vite.config.ts` 的开发中间件）：`/sites/forum/*` 302 到新论坛首页 `http://127.0.0.1:3456/`，`/forum`、`/forum/*` 保留路径 302 到 3456；不猜测旧帖子 ID 映射。容器栈里 `/sites/forum/*` 返回 404，`/forum/*` 由 nginx 反代到 forum 容器。
- WCAG 2.2 AA 是目标而非已达成结论；对比度、放大、屏幕阅读器需独立测量。
- 论坛前端（`app/forum`）与控制台（`app/console`）是 Vue/Tuffex，与本包无代码复用：Vue 组件不能当作 React 组件使用。
- 开发态官网右上角的「DEV CONTROL」浮层会挡住文档页的语言切换按钮（点击被拦截，键盘可用）；属官网既有问题，未在本次处理。

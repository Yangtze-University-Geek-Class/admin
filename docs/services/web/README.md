# Web 服务合同（`app/web`）

> portal 与 admin 两个 React/Vite 站点 + shared 适配层；同时是每个环境的 HTTP 入口容器。

状态：`current` · 更新：2026-09-23 · 源码：`app/web/` · 镜像：`yzgc/web:<tag>`

## 源码地图

| 路径 | 职责 |
|---|---|
| `app/web/sites/portal/` | 公开站点：`App.tsx` 路由、`pages/`、`components/`、`theme.css`（MiMo 风格基线令牌与组件）、`index.html` 入口；无独立登录态 |
| `app/web/sites/admin/` | 组织管理站点：`App.tsx` 路由、`pages/`、`features/`（按代码/提交/Issue/PR/设置分 feature） |
| `app/web/shared/lib/` | 网络（`api`、`http`、`runtime`）、URL/站点（`site`）、Markdown（`markdown`）、挂载（`mount`）、PoW、主题、只读 mock |
| `app/web/shared/ui/` | 真正跨端复用的交互原语：Modal、ConfirmDialog、Select、NumberInput、ImageLightbox、TurnstileWidget、Mascot 等 |
| `app/web/shared/styles/` | 基础样式与令牌（`base.css`、`mascot.css`、`rounded.css`） |
| `app/web/shared/config/` | 公开前端配置（`app.config.json` → `config/index.ts` 的站点/域名合同） |
| `app/web/Dockerfile` | Node 22 构建 Vite 产物 → nginx 托管静态与反代；容器内监听 8080（非特权），并生成 `release.json` 供发布身份核对 |
| `app/web` 镜像内 nginx 配置 | 由 `Dockerfile` 生成：`/api/*` → `server:3000`；`/forum/*` → `forum:3000`；按宿主注入的 `X-YZGC-Site` 选择 portal/admin SPA 入口；安全头由宿主 nginx 统一下发，容器不重复 |

模块细节：[portal](portal.md)、[admin](admin.md)、[shared](shared.md)。依赖方向：站点 → shared → 通用依赖；shared 不得反向导入站点，站点之间不得互相导入。

## 契约

- **两个入口、一个包**：portal 与 admin 由同一 Vite 构建产出两份 HTML；`web` 镜像同时承担 TLS 之后的静态托管与反向代理，是唯一对宿主机暴露业务端口的容器（容器内 8080，宿主 production `127.0.0.1:18100`、preview `127.0.0.1:18200`）。
- **域名**：portal `yangtzeu.work` / `prev.yangtzeu.work`，admin `github.yangtzeu.work` / `prev-admin.yangtzeu.work`；论坛不再是独立子域，而是 portal 域名下的 `/forum` 路径（子域模型退役说明见 [DEPLOY](../../ops/DEPLOY.md)）。
- **HTTP 边界**：前端只通过 `shared/lib/api` 访问 `/api/*`；跨端链接使用 `externalUrl`，同端使用 Router。
- **配置**：构建期只读公开配置（`app.config.json`），不加载私有 `.env`；后端 host 与前端公开 host 必须一致，由 `scripts/check-site-hosts.mjs` 校验。
- **UI 选型**：既有 React 模块为过渡期实现，后续新增/迁移界面按 [Tuffex 使用政策](../../components/tuffex/USAGE-POLICY.md)。不引入平行基础 UI 体系。

## 运行

```bash
pnpm dev:web        # 只读 mock 预览，无需 OAuth 或业务数据库
pnpm dev            # 前后端开发（需要本机 .env，模板见 ../../ops/ENVIRONMENT.md）
pnpm preview:local  # 核心 5173/3000 + 独立论坛 3456，见 ../../ops/LOCAL-PREVIEW.md
```

本机地址 `http://127.0.0.1:5173/sites/portal/`、`http://127.0.0.1:5173/sites/admin/admin?__data=mock`。容器内由 nginx 托管构建产物；宿主 nginx 只做 TLS 终止与 `server_name` → 回环端口转发。

## 验证命令

```bash
pnpm typecheck                        # app/web/tsconfig.json
pnpm test                             # 组件与共享层单测
pnpm test:e2e                         # 浏览器验证（Playwright）
pnpm build                            # Vite 产物
node scripts/check-boundaries.mjs     # 站点/shared 依赖方向
node scripts/check-site-hosts.mjs     # 前后端 host 一致性
```

浏览器验收项（键盘/焦点、错误与空状态、窄屏与移动导航、模态背景 inert、分页 URL）见 [TESTING](../../conventions/TESTING.md) 与 [DESIGN](../../design/DESIGN.md)。

## 已知限制

- 本机 mock 预览是只读样板，不操作真实 GitHub；真实数据只在连上 `app/server` 后出现。
- 旧 `/sites/forum/*` 与 `/forum` 前端入口跳转到 `app/forum` 的新论坛首页，不猜测旧帖子 ID 映射。
- WCAG 2.2 AA 是目标而非已达成结论；对比度、放大、屏幕阅读器需独立测量。
- 论坛前端（`app/forum`，Vue/TuffEx）与本包无代码复用：Vue 组件不能当作 React 组件使用。

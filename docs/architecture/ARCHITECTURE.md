# 当前系统架构

> 四个源码应用、三个 Docker 运行单元；区分当前代码、开发模式与部署证据，并从统一目录追溯接口、数据和权限。

状态：`current` · 更新：2026-10-21

## 当前拓扑

```text
geek_main 根 README / AGENTS / 命令 / docs
  ├─ app/web/sites/portal           [React / Vite，Node 22] + app/web/shared
  ├─ app/console                    [Vue / Tuffex / Vite，Node 22]
  ├─ app/forum                      [Nuxt / Vue / TuffEx，独立 Node ≥26 工具链]
  │      官网、控制台、论坛通过同域 HTTP 调用核心后端
  ├─ app/server/src/app.ts          [Fastify，Node 22]
  │      └─ portal/admin/console/forum-api 路由
  │           └─ services -> data.db、GitHub、Turnstile、邮件适配器
  └─ deploy/                        [两套隔离的 compose 栈]
```

每个源码应用在 `docs/services/<service>/` 有对应合同（[server](../services/server/README.md)、[web](../services/web/README.md)、[console](../services/console/README.md)、[forum](../services/forum/README.md)）。运行单元只有 web/server/forum；控制台产物随 web 镜像交付。

[项目目录](catalog/README.md) 从真实 Fastify 注册、内存 SQLite 结构和能力定义生成接口、数据、权限清单。业务域与源码应用分开：同一个招新功能会跨官网、控制台、核心后端和邮件模块，不要求业务、目录、接口、表一一对应。

论坛不再是 `app/web/sites` 下的 React 入口。根 `pnpm verify` 编排核心与论坛各自检查，两个 pnpm 锁文件、运行时和 node_modules 分开管理。独立技术栈是用户明确采用原仓的要求，不是为了目录外观创建微服务——三个服务仍由同一套 compose 模板、同一台机器上的两套栈交付。

官网与控制台分别执行各自的 Vite 构建；核心后端 `resolveSiteEntry` 区分两份产物，web 镜像同时打包它们。论坛由 Nuxt generate 生成静态产物。开发入口和端口见 [LOCAL-PREVIEW](../ops/LOCAL-PREVIEW.md)；容器内 server 与 forum 都监听 3000，由 web 容器按路径反代（`/api/*`、`/auth`、`/auth/*`、`/healthz` → server，`/forum/*` → forum），逐条规则见 [web 合同](../services/web/README.md)。

## 交付拓扑（两套栈）

```text
宿主 nginx（TLS 终止，certbot 证书）
  ├─ yangtzeu.work / prev.yangtzeu.work → 127.0.0.1:18100 / 18200（每个环境只有这一个域名）
  └─ github.yangtzeu.work（已退役）      → 301 到 https://yangtzeu.work
       └─ web 容器（nginx：静态 + 反代，按路径选 SPA 入口）
            ├─ /api/*、/auth、/auth/*、/healthz → server 容器（Fastify，/data 命名卷）
            ├─ /forum/*                         → forum 容器（Nuxt 静态产物）
            ├─ /admin/*、/console/*、/signin     → 管理端 SPA
            └─ 其余路径                         → portal SPA
```

| 环境 | 发布 tag（提交所在分支） | 栈根 | compose 项目 | 数据 |
|---|---|---|---|---|
| production | `vX.Y.Z`（`main`） | `/opt/yzgc/production` | `yzgc-production` | 独立命名卷 |
| preview | `vX.Y.Z-rc.N`（`stage`） | `/opt/yzgc/preview` | `yzgc-preview` | 独立命名卷 |

两环境隔离维度：目录、compose 项目、端口、卷、密钥、域名、Cookie 域（host-only）。每个环境只有一个 origin（`PUBLIC_ORIGIN`）：官网、管理端、论坛同域，管理端靠路径区分，服务端（`resolveSiteEntry`）与 web 容器 nginx 用同一套路径规则选 SPA 入口。细节见 [DEPLOY](../ops/DEPLOY.md)、[ENVIRONMENTS](../ops/ENVIRONMENTS.md)、[CICD](../ops/CICD.md)。

## 核心数据与身份

`buildApp` 注册真实核心应用但不监听；`index.ts` 才加载环境和监听。`services.ts` 统一拥有 data.db、缓存、身份、论坛存储与外部客户端。**数据层是 SQLite（better-sqlite3，WAL），存放在 Docker 命名卷里**（容器内 `/data/data.db`）。结构清单见生成的[数据目录](catalog/data-model.md)，用途、读写方、个人信息及未使用对象见 [server 数据模型](../services/server/data-model.md)，本页不再维护容易漏项的第二份表名清单。Postgres 迁移未做；任何迁移仍需方案、授权与恢复演练。

核心 GitHub OAuth 的 sid 和组织权限校验保留，不再创建旧 forum_sid。全站只有这一个登录：官网、论坛、控制台共用同一个 host-only `sid`，只有 `CONSOLE_ORG` 的 active 成员能登录，三端的「登录」都进统一登录页 `/signin`，登录没成功时带 `signin=<原因>` 与原来的 `return_to` 回到这一页说明（#262，见 [SECURITY](SECURITY.md)「登录门槛」）。官网菜单栏和论坛只经同域 `/auth/me` 读身份；论坛没有自己的登录。论坛的数据与授权在核心服务的 `/api/forum/*`（#57，[ADR-0004](../decisions/0004-forum-backend-in-core-server.md)）：存在同一个 data.db 的 `forum_*` 表，成员只认 `sid`，论坛能力与控制台同一条 `computeAccess` 路径，游客能看帖和回复。

原始 forum.db 及附件在私有备份中保持原样，未删除、未导入可写库；本机展示的只读投影由该备份离线生成（见 [数据保全](../ops/FORUM-DATA-CAPTURE.md)）。旧论坛数据和代码生命周期分开；代码退役不等于授权删除数据。新论坛的跨设备存储已在核心服务（上段）；旧数据导入仍须另立方案，只有公开的旧帖（`app/forum/content/published/topics.json`）在启动时按编号「没有才插入」。

## 论坛运行模式

论坛需分清三种模式，不能把上游演示的限制套到核心后端集成上：

- 服务端模式：前端经 `/api/forum/*` 读写，身份来自 `sid`，授权与数据在核心后端；浏览器保留主题等偏好，不以本地示例身份授予服务端权限。
- 本机演示：确定性种子、Pinia/localStorage 与可选示例身份只用于演示和上游测试，不是认证证据。
- 本机只读快照：显式配置或本机工具发现快照时，开发专用 `/api/local-forum/*` 提供归档投影，不能写回，不因此获得业务权限；这些 Nitro 路由不随静态镜像运行。

模式判定与前端接入以 [forum 合同](../services/forum/README.md) 和 `app/forum/shared/content-source.ts`、`app/forum/shared/forum-api.ts` 为准。上游 Cloudflare PRD 不是已经落地的基础设施。

原仓文件、MIT 声明和提交摘要保留，业务页面未重写为 React。少量集成差异包括本地提醒、根入口、进程管理和隔离浏览器验证，详见 [ADR-0003](../decisions/0003-adopt-tuff-forum.md)。

## 目标结构，尚未完整实现

公开宣传主页 -> GitHub 等 Provider 登录 -> 内部 Hub -> 论坛 / GitHub 组织管理 / 可扩展服务。用户要求的蓝白科技、3D 游戏感 Hub 和 DIY 服务注册仍是后续实施目标。TuffEx 已为后续 UI 选定，但组件文档或导入原仓不证明所有模块已经迁到 Vue。

## 验证和发布

核心邀请仍原子预留额度、按结果补偿。核心真实接口与论坛演示分别测试；历史测试不能代替当前版本证据。`/api/forum` 下新接口没有注册的旧路径返回 410；直连 server 的 `/forum` 在生产返回 503，页面由 forum 容器提供。论坛后端和前端接入已经存在于源码；是否部署、实际使用到哪一步，以目标环境 `/release.json` 与对应验收记录核对。本说明和项目目录不自行推断线上状态。

发版只靠打 tag（`stage` 提交上的 `vX.Y.Z-rc.N` 发预发布，`main` 同一提交上的 `vX.Y.Z` 发正式），推送分支不部署，见 [RELEASES](../conventions/RELEASES.md) 与 [BRANCHING](../conventions/BRANCHING.md)。

参见 [API](API.md)、[SECURITY](SECURITY.md)、[模块规则](../conventions/MODULAR-DEVELOPMENT.md) 与 [本地运行](../ops/TUFF-FORUM.md)。

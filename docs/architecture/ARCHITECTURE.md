# 当前系统架构

> 三个服务（web/server/forum）组成的严格 monorepo；两套 Docker 栈交付两个环境；明确当前实现与目标的差异。

状态：`current` · 更新：2026-09-26

## 当前拓扑

```text
geek_main 根 README / AGENTS / 命令 / docs
  ├─ app/web/sites/{portal,admin}   [React / Vite，Node 22]  + app/web/shared（跨端适配）
  │      └─ HTTP -> app/server/src/app.ts -> portal/admin 路由
  │                   └─ services -> data.db、GitHub、Turnstile
  ├─ app/forum                      [原仓 Nuxt / Vue / TuffEx，Node ≥26]
  │      └─ Pinia：镜像是极客班论坛（curation.json 的分类和标签，加上 content/published 的公开旧帖）；本机是示例种子 + localStorage，或只读快照（dev 专用 /api/local-forum）
  └─ deploy/                        [compose 模板 + env 契约 + 目标机脚本；两套栈]
```

每个服务在 `docs/services/<service>/` 有对应合同（[server](../services/server/README.md)、[web](../services/web/README.md)、[forum](../services/forum/README.md)）；`app/` 与 `docs/` 严格对齐是硬规则。

论坛不再是 `app/web/sites` 下的 React 入口。根 `pnpm verify` 编排核心与论坛各自检查，两个 pnpm 锁文件、运行时和 node_modules 分开管理。独立技术栈是用户明确采用原仓的要求，不是为了目录外观创建微服务——三个服务仍由同一套 compose 模板、同一台机器上的两套栈交付。

核心 Vite 生成 portal/admin 两个 HTML；论坛由 Nuxt generate 生成静态产物。本机核心在 5173/3000、论坛在 3456（见 [LOCAL-PREVIEW](../ops/LOCAL-PREVIEW.md)）；容器内 server 与 forum 都监听 3000，由 web 容器按路径反代（`/api/*`、`/auth`、`/auth/*`、`/healthz` → server，`/forum/*` → forum），逐条规则见 [web 合同](../services/web/README.md)。

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

`buildApp` 注册真实核心应用但不监听；`index.ts` 才加载环境和监听。`services.ts` 只拥有 data.db、缓存和外部客户端。**数据层现状是 SQLite（better-sqlite3，WAL），存放在 Docker 命名卷里**（容器内 `/data/data.db`）；表 `sessions`、`invite_links`、`invite_attempts`、`invitations`、`feedback`、`applications`、`audit_logs`、`app_state` 保留，其中 `app_state` 当前无读写（预留）；各表用途、读写方与未使用对象见 [server 数据模型](../services/server/data-model.md)。**迁移到 Postgres 尚未进行**，本文件不把它写成已完成；任何迁移都需要独立方案、授权与恢复演练。

核心 GitHub OAuth 的 sid 和组织权限校验保留，不再创建旧 forum_sid。全站只有这一个登录：官网、论坛、控制台共用同一个 host-only `sid`，只有 `CONSOLE_ORG` 的 active 成员能登录，登录没成功时带 `?signin=<原因>` 回到发起登录的页面（见 [SECURITY](SECURITY.md)「登录门槛」）。官网菜单栏和论坛只经同域 `/auth/me` 读身份；论坛没有自己的登录。论坛的数据与授权在核心服务的 `/api/forum/*`（#57，[ADR-0004](../decisions/0004-forum-backend-in-core-server.md)）：存在同一个 data.db 的 `forum_*` 表，成员只认 `sid`，论坛能力与控制台同一条 `computeAccess` 路径，游客能看帖和回复。

原始 forum.db 及附件在私有备份中保持原样，未删除、未导入可写库；本机展示的只读投影由该备份离线生成（见 [数据保全](../ops/FORUM-DATA-CAPTURE.md)）。旧论坛数据和代码生命周期分开；代码退役不等于授权删除数据。新论坛的跨设备存储已在核心服务（上段）；旧数据导入仍须另立方案，只有公开的旧帖（`app/forum/content/published/topics.json`）在启动时按编号「没有才插入」。

## 上游论坛的真实边界

依据 `app/forum/README.md`、`app/forum/app/stores/session.ts` 和 `app/forum/app/plugins/persist.client.ts`：选择用户是 mock，全部数据在浏览器，没有服务端认证或业务 API。Nuxt dev server 和本地进程标记不等于论坛后端。上游 Cloudflare PRD 是 Draft，未作为已实现能力。不能将页面权限按钮或 localStorage 状态当作内部社区安全边界。本机 `forum:start` 发现私有快照目录时，dev 专用 Nitro 路由 `/api/local-forum/*` 只读提供极客班归档，前端整体替换 store、论坛会话固定为游客、不渲染示例登录（顶栏换成全站 GitHub 登录入口，本机经 `nitro.devProxy` 把 `/auth` 转给核心）并停止把论坛状态写入 localStorage；这只是本机展示，论坛没有服务端授权、写入或跨设备存储，静态产物中不存在这些路由，镜像里的论坛是极客班论坛（site 模式：curation.json 的分类和标签，没有帖子和用户，浏览器里不存论坛内容和会话，主题与侧栏偏好仍存在本机）。

原仓文件、MIT 声明和提交摘要保留，业务页面未重写为 React。少量集成差异包括本地提醒、根入口、进程管理和隔离浏览器验证，详见 [ADR-0003](../decisions/0003-adopt-tuff-forum.md)。

## 目标结构，尚未完整实现

公开宣传主页 -> GitHub 等 Provider 登录 -> 内部 Hub -> 论坛 / GitHub 组织管理 / 可扩展服务。用户要求的蓝白科技、3D 游戏感 Hub 和 DIY 服务注册仍是后续实施目标。TuffEx 已为后续 UI 选定，但组件文档或导入原仓不证明所有模块已经迁到 Vue。

## 验证和发布

核心邀请仍原子预留额度、按结果补偿，不能因为论坛更换退化其正确性。核心接口和论坛演示分别测试；原论坛历史 48 项通过不算新架构验收。`/api/forum` 下新接口没有注册的旧路径返回 410；直连 server 的 `/forum` 在生产返回 503（论坛页面由 forum 容器提供）。论坛的服务端身份、权限与存储已实现并有路由测试（`tests/server/forum.test.ts`），但前端接入（#107）、内容安全和在预发布环境的真实验证未完成前，不能写成论坛已上线。

发版只靠打 tag（`stage` 提交上的 `vX.Y.Z-rc.N` 发预发布，`main` 同一提交上的 `vX.Y.Z` 发正式），推送分支不部署，见 [RELEASES](../conventions/RELEASES.md) 与 [BRANCHING](../conventions/BRANCHING.md)。

参见 [API](API.md)、[SECURITY](SECURITY.md)、[模块规则](../conventions/MODULAR-DEVELOPMENT.md) 与 [本地运行](../ops/TUFF-FORUM.md)。

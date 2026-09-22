# Server 服务合同（`app/server`）

> 核心 portal/admin 的应用组装、资源生命周期和真实 GitHub 适配；一个 Fastify 进程。

状态：`current` · 更新：2026-09-23 · 源码：`app/server/` · 镜像：`yzgc/server:<tag>`

## 源码地图

| 路径 | 职责 |
|---|---|
| `app/server/src/index.ts` | 唯一启动入口：加载配置、监听端口、处理关闭信号 |
| `app/server/src/app.ts` | 组装 portal/admin 核心路由、中间件与插件；**不监听端口**，可注入依赖 |
| `app/server/src/services.ts` | 每个应用实例拥有自己的 data.db、缓存、身份与外部客户端；提供关闭方法 |
| `app/server/src/config.ts` | 环境变量解析与校验（端口、域名、密钥长度、难度参数） |
| `app/server/src/routes/portal/index.ts` | portal 路由注册入口（docs / feedback / join / public config） |
| `app/server/src/routes/portal/contracts.ts` | portal 请求 Schema（本模块输入协议源） |
| `app/server/src/routes/admin/index.ts` | admin 路由注册入口（`/auth/*`、`/api/me/*`、`/api/admin/:org/*`） |
| `app/server/src/routes/admin/contracts.ts` | admin 请求 Schema |
| `app/server/src/middleware/` | `require-auth`、`require-org-role`、`oauth-state`、`http-policy`、`pow`、`turnstile` |
| `app/server/src/lib/` | `db`、`auth`、`crypto`、`github`、`cache`、`http-contracts`、`invite-reservation`、`password-policy`、`safe-return` |
| `app/server/Dockerfile` | Node 22 多阶段构建，非 root 运行，`/data` 卷，健康检查 `/healthz` |
| `app/server/scripts/` | 本地邀请流程手工脚本，不属于生产路径 |

模块 import 不得加载 `.env`、打开数据库、创建上传目录或监听端口。`app.close()` 只关闭自己创建的服务；注入的服务由调用者负责。

## 契约

- **入口职责**：`buildApp` 注册真实应用但不监听；只有 `index.ts` 读取环境并监听。测试通过 `inject` 注册真实路由，只把 `DB_PATH` 指向内存库。
- **依赖方向**：`config → lib → middleware → routes`。`middleware` 不导入 `routes`；`lib` 不反向依赖 `middleware`；身份/持久化适配器只接收普通参数，不接受 Fastify 请求/响应对象。
- **运行时装**：`DB_PATH` 指向 SQLite（WAL，better-sqlite3）；`sessions`、`invite_links`、`invite_attempts`、`invitations`、`feedback`、`audit_logs`、`app_state` 由本服务拥有。
- **身份**：GitHub OAuth 保留签名 state、十分钟有效期和允许列表回跳，只签发 `sid`（服务器会话）；不签发、不桥接旧 `forum_sid`。
- **旧论坛接口**：`/api/forum*`、`/auth/forum/*`、`/forum/u/*` 返回 410 `legacy_forum_retired`；服务不打开 `forum.db`。生产环境缺少新论坛服务时 `/forum` 返回 503，不用模拟成功填补缺口。
- **数据所有权**：`app/forum` 的数据不归本服务；本服务不读取论坛私有备份或只读投影。
- **接口清单与错误语义**见 [API](../../architecture/API.md)，安全边界见 [SECURITY](../../architecture/SECURITY.md)。

## 运行

```bash
# 本机开发（需要人工填写的本机 .env，模板见 ../../ops/ENVIRONMENT.md）
pnpm dev

# 容器（正式/预发布由 compose 栈启动，宿主回环 18101 / 18201）
docker compose --env-file deploy/env/.env.production -f deploy/compose/production.yml up -d server
```

容器内监听 3000，仅经 `web` 容器反代暴露；宿主端口只用于调试。环境变量契约见 [ENVIRONMENTS](../../ops/ENVIRONMENTS.md)。

## 验证命令

```bash
pnpm typecheck                                            # app/server/tsconfig.json
pnpm test                                                 # 真实路由 + 内存 data.db
pnpm build                                                # 生成 app/server/dist
node scripts/check-boundaries.mjs                         # 依赖方向与跨端导入
```

回归矩阵（实例隔离、不打开旧论坛库、OAuth 与组织权限、邀请并发与未知结果、旧接口 410、生产缺少论坛服务失败关闭）见 [TESTING](../../conventions/TESTING.md)。

## 已知限制

- 没有多实例/多进程协调：SQLite 单文件 + 命名卷，同一环境只跑一个 server 容器。
- 没有迁移到 Postgres；`DB_PATH` 仍为 SQLite 文件（见 [ARCHITECTURE](../../architecture/ARCHITECTURE.md)）。
- 邀请的 GitHub 结果未知时保留待核对状态，需要人工核对后由授权维护修正，不会自动重发。
- `sharp` 仍在 manifest 中（历史上传路径遗留），当前没有活动的上传接口。
- `app/server/scripts/` 中的手工脚本不是生产运维入口。

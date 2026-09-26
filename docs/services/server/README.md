# Server 服务合同（`app/server`）

> 核心 portal/admin/console 与论坛接口的应用组装、资源生命周期和真实 GitHub 适配；一个 Fastify 进程。

状态：`current` · 更新：2026-09-26 · 源码：`app/server/` · 镜像：`yzgc-<environment>/server:<sha12>`

## 源码地图

| 路径 | 职责 |
|---|---|
| `app/server/src/index.ts` | 唯一启动入口：加载配置、监听端口、处理关闭信号 |
| `app/server/src/app.ts` | 组装 portal/admin/console/forum 路由、中间件与插件；直连时托管 `app/web/dist` 与 `app/console/dist` 两份前端产物，`resolveSiteEntry` 按路径把 `/console`、`/admin`、`/signin`（含子路径）回落到控制台入口；**不监听端口**，可注入依赖 |
| `app/server/src/services.ts` | 每个应用实例拥有自己的 data.db、缓存、身份与外部客户端；建库后读论坛内容并播种（读不出来就关库、启动失败）；提供关闭方法 |
| `app/server/src/config.ts` | 环境变量解析与校验（端口、唯一对外地址 `PUBLIC_ORIGIN`、`CONSOLE_ORG`、密钥长度、难度参数）；不读取前端配置。`forumContentDir` 固定为 `app/forum/content`（不是环境变量，镜像里是同一个相对位置） |
| `app/server/src/routes/portal/index.ts` | portal 路由注册入口（docs / feedback / join / apply / public config） |
| `app/server/src/routes/portal/contracts.ts` | portal 请求 Schema（本模块输入协议源） |
| `app/server/src/routes/admin/index.ts` | admin 路由注册入口（`/auth/*`、`/api/me/*`、`/api/admin/:org/*`） |
| `app/server/src/routes/admin/contracts.ts` | admin 请求 Schema |
| `app/server/src/routes/console/index.ts` | 极客班控制台路由注册入口（`/api/console/*`：me、catalogue、summary、departments、assignments、applications、feedback、audit） |
| `app/server/src/routes/console/contracts.ts` | 控制台请求 Schema（拒绝未知字段；投递参数按 UUID 校验） |
| `app/server/src/routes/forum-api/index.ts` | 论坛接口注册入口（`/api/forum/*`，#57，[ADR-0004](../../decisions/0004-forum-backend-in-core-server.md)）：`topics.ts`（state、发帖、置顶、关闭、浏览数）、`posts.ts`（回复、编辑、删除、点赞、收藏）、`people.ts`（关注、通知、账号资料、头像）、`viewer.ts`（成员 / 游客身份与 `forum.*` 能力） |
| `app/server/src/routes/forum-api/contracts.ts` | 论坛请求 Schema（拒绝未知字段；编号按字符串格式校验）与中文校验提示 |
| `app/server/src/middleware/` | `require-auth`（另有 `loadSession`：有有效 `sid` 就挂上会话、没有不回复，给游客也能用的论坛接口）、`require-org-role`、`require-capability`（控制台与论坛按能力授权）、`oauth-state`、`http-policy`、`pow`、`turnstile` |
| `app/server/src/lib/` | `db`、`auth`、`crypto`、`github`、`cache`、`http-contracts`、`invite-reservation`、`safe-return`；控制台的 `roles`（称号、部门、能力清单与 `computeAccess` 纯函数）、`role-store`（部门与指派持久化）、`access`（GitHub 组织角色缓存 60 秒 + 身份解析）、`feedback-store`（意见箱 SQL，管理端与控制台共用）；论坛的 `forum-content`（读、校验两份公开内容文件）、`forum-store`（`forum_*` 表的全部 SQL、编号、通知规则、整份 `ForumState`）、`forum-rules`（长度、限流、提及、标签 slug 等纯规则）、`forum-avatar`（sharp 重新编码头像）；`password-policy` 是旧论坛遗留的死代码，没有任何导入，待删 |
| `app/server/Dockerfile` | Node 22 多阶段构建，非 root 运行，`/data` 卷，健康检查 `/healthz`；运行阶段另复制论坛的两份公开内容文件 `app/forum/content/curation.json` 与 `published/topics.json` |
| `app/server/scripts/` | 已退役的占位文件（`test-invite-*.ts`）：运行只打印「改用 `pnpm test`」并以退出码 1 结束，没有可用的手工流程 |

模块 import 不得加载 `.env`、打开数据库、创建上传目录或监听端口。`app.close()` 只关闭自己创建的服务；注入的服务由调用者负责。

## 契约

- **入口职责**：`buildApp` 注册真实应用但不监听；只有 `index.ts` 读取环境并监听。测试通过 `inject` 注册真实路由，只把 `DB_PATH` 指向内存库。
- **依赖方向**：`config → lib → middleware → routes`。`middleware` 不导入 `routes`；`lib` 不反向依赖 `middleware`；身份/持久化适配器只接收普通参数，不接受 Fastify 请求/响应对象。
- **运行时装**：`DB_PATH` 指向 SQLite（WAL，better-sqlite3）；`sessions`、`invite_links`、`invite_attempts`、`invitations`、`feedback`、`applications`、`application_reviews`、`departments`、`role_assignments`、`titles`、`console_seeds`、`audit_logs`、`app_state` 与论坛的 `forum_*` 表由本服务拥有，其中 `app_state` 当前无读写（预留）。每张表的写入方、读取方、个人信息字段和未使用对象见 [数据模型](data-model.md)。
- **单一 origin**：每个环境只有一个对外地址 `PUBLIC_ORIGIN`（正式 `https://yangtzeu.work`、预发布 `https://prev.yangtzeu.work`）。OAuth `redirect_uri` 是 `<PUBLIC_ORIGIN>/auth/callback`，登录后默认回 `<PUBLIC_ORIGIN>/console`，邀请链接是 `<PUBLIC_ORIGIN>/join/<token>`；`return_to` 与写请求的 `Origin` 只接受这一个 origin。
- **SPA 入口按路径选择**：服务端直接托管前端产物时，`resolveSiteEntry` 把管理端路径（`ADMIN_SPA_PATHS`：`/admin`、`/admin/…`、`/console`、`/console/…`、`/signin`）交给管理端入口（`ADMIN_SPA_ENTRY` = `sites/console/index.html`，即 `app/console` 的产物），其余交给 portal 入口，与 Host 无关；两者各只在 `app.ts` 定义一处，web 容器 nginx 的 location 与之一致。管理端换成别的前端产物时只改入口常量。
- **身份**：全站只有这一个登录，官网、论坛、控制台共用它签发的 `sid`（服务器会话，host-only）；不签发、不桥接旧 `forum_sid`。GitHub OAuth 保留签名 state、十分钟有效期和允许列表回跳。`/auth/callback` 用刚换到的 token 查登录者自己在 `CONSOLE_ORG` 的成员状态（`lib/github.ts` 的 `getOwnMembership`，`GET /user/memberships/orgs/{org}`），只有 `active` 才签发 `sid`；不是成员或邀请没接受时不建会话、审计 `auth.signin_denied`，GitHub 出错（含 403）、用户取消时也不建会话，都 302 回到原页面并带 `?signin=not_member|invite_pending|failed|cancelled`（`routes/admin/auth.ts` 的 `SigninOutcome`）。换 token 与取 `/user` 的请求 15 秒超时。规则见 [SECURITY](../../architecture/SECURITY.md)「登录门槛」，状态码见 [API](../../architecture/API.md)。
- **极客班控制台**：`/api/console/*` 组织固定为 `CONSOLE_ORG`（非密钥环境变量，默认 `Yangtze-University-Geek-Class`；`ALLOWED_ORGS` 非空时必须包含它，否则启动失败），按称号 → 能力授权，GitHub 能力受用户自身组织角色上限约束，GitHub 登录后默认回到 `/console`。模型见 [SECURITY](../../architecture/SECURITY.md)，端点见 [API](../../architecture/API.md)。
- **论坛接口**（#57，[ADR-0004](../../decisions/0004-forum-backend-in-core-server.md)）：`/api/forum/*` 是论坛前端的全部数据来源，存储在 `data.db` 的 `forum_*` 表。成员身份只认 `sid`，第一次请求时建论坛用户 `m<GitHub user_id>`，之后每次请求按 `computeAccess` 刷新角色（组织 owner 为 admin）与称号；论坛能力只取 `forum.*`，与控制台同一条授权路径。没有有效 `sid` 的是游客：能看帖、能回复（昵称、PoW、空蜜罐、按 IP 限流），不能发帖或做其它写操作。启动时读 `app/forum/content` 的 `curation.json`（分类、标签）与 `published/topics.json`（公开的旧帖），旧帖按编号「没有才插入」（话题 + 首帖 `body-<n>` + 官方账号 `u-geekclass`），已存在的不覆盖；文件缺失或引用不存在的分类、标签时启动失败。新话题从 `t1001`、新帖子从 `p10001` 起编号。删他人帖子、改他人帖子、置顶、关闭以 `org = CONSOLE_ORG` 写审计（不记正文）。端点、错误码与限流见 [API](../../architecture/API.md)「论坛」。
- **旧论坛接口**：`/api/forum` 下新接口没有注册的旧路径、`/auth/forum/*`、`/forum/u/*` 返回 410 `legacy_forum_retired`；服务不打开 `forum.db`。论坛页面由 forum 容器提供，直连 server 的 `/forum` 在生产返回 503、开发态跳到 3456，不用模拟成功填补缺口。
- **加入我们（投递）**：`POST /api/portal/apply` 是匿名写接口，无会话依赖；成功时写一行 `applications`（含来源 IP 与 User-Agent）和一条 `audit_logs`。准入沿用公开表单的 PoW、蜜罐与 Turnstile，路由限流 5 次/分钟。字段约束在 `routes/portal/apply.ts` 内单一校验层实现（该端点不注册 `contracts.ts` body schema），校验失败不落库；`website`、`homepage`、`url_ref` 任一非空即按蜜罐命中处理，返回与成功一致的 201 形状但不落库。审计记录目标 id 和来源 IP，details 只含脱敏邮箱、班级、`name_length` 与 `strengths_length`，不记姓名和候选人正文。字段、错误码与限流细则见 [API](../../architecture/API.md)。
- **数据所有权**：论坛的线上数据（账号资料、话题、帖子、点赞、收藏、关注、通知、头像）归本服务，存在 `data.db`；`app/forum/content` 的两份公开文件只作为只读的种子输入。本服务不读取论坛私有备份或只读投影。
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

回归矩阵（实例隔离、不打开旧论坛库、OAuth 与组织权限、邀请并发与未知结果、旧接口 410、生产缺少论坛服务失败关闭、论坛接口 `tests/server/forum.test.ts`）见 [TESTING](../../conventions/TESTING.md)。

## 已知限制

- 没有多实例/多进程协调：SQLite 单文件 + 命名卷，同一环境只跑一个 server 容器。
- 没有迁移到 Postgres；`DB_PATH` 仍为 SQLite 文件（见 [ARCHITECTURE](../../architecture/ARCHITECTURE.md)）。
- 邀请的 GitHub 结果未知时保留待核对状态，需要人工核对后由授权维护修正，不会自动重发。
- `app/server/package.json` 仍声明旧上传与旧论坛遗留依赖：`@fastify/multipart`、`multer`、`marked`、`dompurify`、`isomorphic-dompurify` 在 `src` 中零引用，`bcryptjs` 只被无人导入的 `lib/password-policy.ts` 引用。`sharp` 已在用：论坛头像上传（`lib/forum-avatar.ts`，#57）。唯一的上传接口是 `PUT /api/forum/me/avatar`，请求体就是图片本身，没有注册 multipart 插件。删除其余遗留依赖和死代码要另开 issue 并更新锁文件。
- 论坛的 `state` 每次请求全量下发（全部用户、话题、帖子、关注），没有分页；GitHub 角色查询失败时成员的论坛请求失败（与控制台一致），不降级成游客视图。
- `app/server/scripts/` 只剩已退役的占位文件，运行即失败退出，不是任何流程的入口；邀请流程的回归由 `pnpm test` 覆盖。

# 重构前置清单

> 历史阶段记录：旧路径、版本、数量和完成声明仅供追溯。

状态：`historical` · 标注：2026-09-12

当前实施规范见 [当前架构](../architecture/ARCHITECTURE.md) 与 [模块规范](../conventions/MODULAR-DEVELOPMENT.md)，不以本文中的旧完成声明代替验收。

> 分支：`next` · 建立于 2026-09-12 · 基线提交 `4959668`
> 用途：动手重构前先把「现在长什么样」钉死。本文只描述现状，不含改造动作。
> 中英对照见 [REFACTOR.en.md](./REFACTOR.en.md)。

> **本文记录的是拆分之前（`4959668`）的目录结构。** 三端拆分已于 2026-09-12 落地，
> 前端现在在 `web/sites/<端>/` 与 `web/shared/`，后端路由在 `server/src/routes/<端>/`——
> 下文出现的 `web/src/pages/*`、`web/src/lib/*` 等路径均为历史路径。
> 页面清单、API 全表与缺陷清单仍然有效；目录相关的部分请以代码与 [WEB-SPLIT.md](./WEB-SPLIT.md) 为准。

---

## 0. 三个站点的边界

**确认：是一个代码库渲染三个站点。** 但站点 1「主引导页」并不只是首页——它下面挂着 4 个公开路由页面。

| # | 站点 | 代码标识 | 线上地址 | 页面/布局 | 登录态 |
|---|---|---|---|---|---|
| 1 | 主引导页（portal） | `portal` | `https://yangtzeu.work` | 4 页 | 全程匿名，无登录概念 |
| 2 | 论坛（forum） | `forum` | `https://yangtzeu.work/forum` | 13 页 + 1 布局 | 独立会话（`forum_sid`），可选 |
| 3 | 组织管理页（admin） | `admin` | `https://github.yangtzeu.work` | 15 页 + 1 布局 | 强制 GitHub OAuth（`sid`） |

三点需要先对齐：

1. **`forum.yangtzeu.work` 目前不解析**。配置里写着这个域名（`web/src/config/app.config.json` 的 `sites.forum.host`），但 DNS 无记录、nginx 无 server block、证书目录无该域名。论坛实际由 `yangtzeu.work/forum` 路径前缀兜底（`web/src/lib/site.ts:19-31` 的 `portalForumFallback`，命中后 `basePath="/forum"` 传给 `BrowserRouter basename`）。重构时要么启用子域，要么把配置改成路径挂载，不能继续两套并存。

2. **三个站点共享一份 bundle**。`pnpm --filter @yzgc/web build` 产出单个 `index-*.js`（597 KB / gzip 180 KB）+ 单个 `index-*.css`（78 KB）。`App.tsx:1-38` 把 34 个页面全部静态 import，`App.tsx:39-43` 只按 `site.kind` 选一棵路由树——**访问官网也会下载论坛和后台的全部代码**。当前没有 `React.lazy`、没有 `manualChunks`，构建时有 chunk > 500 KB 的告警。

3. **前端不区分构建产物，只区分运行时 host**。`detectSite()` 决定渲染哪棵树；nginx、systemd、后端都是同一份。所以「拆成三个站点」在构建层面是零成本的，在部署层面需要新增域名与证书。

---

## 1. 站点分流机制

调用链（`web/src/main.tsx:14-44`）：

```
detectSite()                     // lib/site.ts —— 决定 kind / host / title / basePath
  └ resolveRuntimeSite()         // lib/runtime.ts —— 域名优先，dev 允许 __site 覆盖
applyTheme(loadTheme(...))       // lib/themes.ts —— 唯一 yzgc-blue 浅色主题
document.documentElement.dataset.site = site.kind   // 驱动 index.css 里的 [data-site=...] 规则
new QueryClient({ staleTime: 15s, retry: false })
<BrowserRouter basename={site.basePath || undefined}>
  <App />                        // 三选一：PortalRoutes | ForumRoutes | AdminRoutes
  {features.feedbackFab && <GlobalFab />}
  <ImageLightbox /> <DevControlCenter />
```

判定顺序（`lib/runtime.ts:105-113`）：

1. dev 覆盖：`?__site=` query 或 `localStorage["yugc:dev-site"]`（生产被 `allowSiteOverride:false` 关死）
2. `hostname === "yangtzeu.work"` 且 `pathname` 以 `/forum` 开头 → `forum`
3. `hostname` 命中 `appConfig.sites[*].host` → 对应站点
4. 兜底 → `environment.defaultSite`（当前 `"portal"`）

跨站跳转统一走 `externalUrl(target, path)`（`lib/runtime.ts:62-77`），三种行为：同站返回相对路径；portal 上跳 forum 返回 `/forum/...`；其余返回 `https://<host>/...`。`app.config.json` 的 `sites` 是域名的唯一来源。

| 配置项 | portal | forum | admin |
|---|---|---|---|
| `host` | `yangtzeu.work` | `forum.yangtzeu.work` | `github.yangtzeu.work` |
| `title` | 长江大学极客班 · YUGC | YUGC 论坛 · 长江大学极客班 | YUGC Admin · 组织管理 |
| `basePath` | `""` | `""`（路径兜底时注入 `/forum`） | `""` |

---

## 2. 页面清单

### 2.1 portal（主引导页，4 页）

| 路由 | 文件 | 行 | 用途 | 后端 API |
|---|---|---|---|---|
| `/` | `pages/Landing.tsx` | 209 | 官网首页：Hero → 方向卡 → 技术分享 → 论坛动态 | **无**。全部内容为文件内静态常量 `DIRECTIONS`/`ARTICLES`/`THREADS`，不请求任何接口 |
| `/docs`、`/docs/:id` | `pages/Docs.tsx` | 102 | 文档站：左侧目录 + Markdown 正文 + 中英切换 | `GET /api/docs`、`GET /api/docs/:id` |
| `/feedback`、`/feedback/:org` | `pages/Feedback.tsx` | 177 | 公开意见箱 + 最近反馈列表 | `GET /api/feedback/categories`、`GET /api/public/config`、`GET /api/feedback/public`、`POST /api/feedback` |
| `/join/:token` | `pages/JoinByToken.tsx` | 193 | 邀请链接落地页：校验→填 GitHub 用户名/邮箱→自动入组 | `GET /api/join/:token`、`GET /api/public/config`、`POST /api/join/:token` |

配套组件：`components/PortalHeader.tsx`（52，配置驱动的顶部导航）、`components/Mascot.tsx`（112，全局看板娘）、`components/FeedbackFab.tsx`（164，悬浮意见按钮，portal 不挂载，见 `App.tsx:112-115`）。

技术特征：

- **全站唯一不使用 React Query 的站点**。`Feedback.tsx` / `JoinByToken.tsx` 是手写 `useState` + `useEffect`，因为要串 PoW 与 Turnstile 的异步状态机。
- 样式走 `portal.css`（388 行）的 `portal-*` / `mascot-*` 自定义类，与论坛/后台的 Tailwind 工具类**互不重叠**。
- 官网首屏、方向卡、文章列表、讨论列表的文字全部硬编码在 `Landing.tsx`，改文案要改代码。这是重构时最需要数据化的部分。

### 2.2 forum（论坛，13 页 + 1 布局）

`ForumLayout.tsx`（174）是壳层：sticky header、导航、搜索、用户菜单、GitHub 绑定横幅、Mascot 场景映射、`<Outlet/>`；并导出被 6 个页面复用的 `Avatar`（`:166-174`）。

| 路由 | 文件 | 行 | 用途 | 主要 API |
|---|---|---|---|---|
| `/`（index） | `ForumHome.tsx` | 135 | 首页/搜索结果：`latest`\|`hot` 切换 + 分页 | `GET /api/forum/categories`、`GET /api/forum/threads` |
| `/categories` | `ForumCategoryList.tsx` | 58 | 全部分类总览（根 + 子分类网格） | `GET /api/forum/categories` |
| `/c/:slug` | `ForumCategory.tsx` | 88 | 单分类主题列表 + 发帖入口 | `GET /api/forum/categories`、`GET /api/forum/threads` |
| `/t/:id` | `ForumThread.tsx` | 232 | 主题详情：正文渲染、楼层、点赞/回复/删除/置顶加精锁定 | `GET /api/forum/me`、`GET /api/forum/threads/:id`、`POST /api/forum/posts`、`DELETE /api/forum/posts/:id`、`POST /api/forum/posts/:id/like` |
| `/new` | `ForumNewThread.tsx` | 82 | 发新帖 | `GET /api/forum/me`、`GET /api/forum/categories`、`POST /api/forum/threads` |
| `/login`、`/register` | `ForumLogin.tsx`、`ForumRegister.tsx` | 69 / 71 | 用户名密码登录 / 注册 | `POST /api/forum/auth/login`、`POST /api/forum/auth/register` |
| `/u/:username` | `ForumProfile.tsx` | 84 | 用户公开主页 | `GET /api/forum/users/:username` |
| `/me` | `ForumMe.tsx` | 149 | 个人中心：资料、密码、GitHub 绑定 | `GET /api/forum/me`、`PATCH /api/forum/me/profile`、`POST /api/forum/auth/set-password`、`GET /api/forum/auth/github` |
| `/me/notifications` | `ForumNotifications.tsx` | 64 | 通知列表 | `GET /api/forum/me`、`GET /api/forum/me/notifications`、`POST /api/forum/me/notifications/read-all` |
| `/archive` | `ForumArchive.tsx` | 129 | mbbs 老帖归档列表（只读） | `GET /api/forum/archive/categories`、`GET /api/forum/threads?archive=1` |
| `/archive/t/:id` | 复用 `ForumThread.tsx` | — | 归档帖详情，`inArchive` 分支切只读 UI | 同上 |
| `/admin` | `ForumAdmin.tsx` | 377 | 论坛后台：用户/角色/分组/权限/分类/老师 | `GET /api/forum/permissions`、`GET/PUT /api/forum/groups/*`、`GET /api/forum/admin/users`、`PATCH /api/forum/admin/users/:id/role`、`POST /api/forum/admin/teachers`、`GET/POST/DELETE /api/forum/categories*` |
| `/teacher` | `ForumTeacher.tsx` | 170 | 老师面板 | `GET /api/forum/me`、`GET /api/forum/teacher/overview` |

技术特征：

- 全部走 React Query，`queryKey` 沿用 `["forum-*", ...]` 命名；写操作 `useMutation` + `invalidateQueries`。
- **无 401 统一拦截**。鉴权表现为「`GET /api/forum/me` 客户端门禁 + `role` 判断」，未登录就是 `me` 返回 401 后按游客渲染。菜单按 `role` 过滤：`admin|mod` 显示 `/admin`，`teacher|admin|mod` 显示 `/teacher`（`ForumLayout.tsx:88-93`）。
- 归档区只读由服务端强制：`is_legacy=1` 的分类在 `POST /api/forum/threads`、`POST /api/forum/posts/:id/like` 返回 403 `legacy_readonly`。
- 正文渲染走 `lib/forum-render.ts`（marked + DOMPurify + highlight.js，17 种语言，含 `rewriteResources` 把 `bbs/…` 重写为 `/forum/r/…`）。

### 2.3 admin（组织管理页，15 页 + 1 布局）

`OrgLayout.tsx`（157）是 `/admin/:org` 壳层：侧边栏、组织切换、退出，并通过 `<Outlet context={{ role, org, isAdmin }} />` 下发权限。

| 路由 | 文件 | 行 | 用途 |
|---|---|---|---|
| `/signin`、`/admin/signin` | `SignIn.tsx` | 36 | GitHub OAuth 登录引导（`return_to` 白名单校验） |
| `/admin` | `MyOrgs.tsx` | 84 | 组织选择页 |
| `/admin/:org`（index） | `Overview.tsx` | 64 | 组织总览：4 统计卡 + 组织信息 |
| `/admin/:org/members` | `Members.tsx` | 92 | 成员表：改角色 / 移除（`isAdmin` 才有操作列） |
| `/admin/:org/repos` | `Repos.tsx` | 61 | 仓库卡片列表 |
| `/admin/:org/repos/new` | `CreateRepo.tsx` | 112 | 新建仓库（可见性 / auto_init / gitignore / license） |
| `/admin/:org/repos/:repo/*` | `RepoDetail.tsx` | **699** | 仓库详情，见下方拆解 |
| `/admin/:org/invitations` | `Invitations.tsx` | 132 | GitHub 待处理邀请 + 本站发起历史 |
| `/admin/:org/invite-links` | `InviteLinks.tsx` | 211 | 邀请链接生成 / 禁用 / 删除，可绑定 team |
| `/admin/:org/teams` | `Teams.tsx` | 97 | 团队 CRUD |
| `/admin/:org/activity` | `Activity.tsx` | 36 | 组织活动流（只读） |
| `/admin/:org/security` | `Security.tsx` | 53 | Dependabot / secret scanning / audit log 支持度 |
| `/admin/:org/org` | `OrgSettings.tsx` | 126 | 组织资料与默认权限，draft 差量保存 |
| `/admin/:org/feedback` | `Feedback.tsx` | 145 | 意见箱管理：筛选 / 回复 / 删除 |
| `/admin/:org/logs` | `Logs.tsx` | 48 | 本站操作日志表 |

`RepoDetail.tsx` 是唯一需要重点拆分的文件，内部再嵌 7 条子路由（`:52-59`）：

| 子路由 | 内容 |
|---|---|
| index | `CodeTab` — 目录浏览 + 文件预览 |
| `commits` | `CommitsTab` — 分支选择 + 提交列表 + diff |
| `commits/:sha` | 提交详情 |
| `issues` | `IssuesTab` — 状态筛选 |
| `issues/:n` | `IssueDetail` — 正文 + 评论 + 关闭/评论操作 |
| `pulls` | `PullsTab` |
| `pulls/:n` | `PullDetail` — 正文 + 评论 + 文件 diff + 合并 |
| `settings` | `SettingsTab` — 协作者 / 分支 / webhooks / 危险操作 |

技术特征：

- 数据层统一 `api<T>()`（`lib/api.ts`），同源 fetch + `credentials:"same-origin"`；dev/mock 转 `lib/mock-api.ts`。
- 写操作用 `useMutation` + `invalidateQueries`；无表单库，受控 `useState` + `onSubmit`。
- 确认交互统一 `useConfirm()`（`components/ConfirmDialog.tsx`）；下拉统一 `components/Select.tsx`；数字输入 `NumberInput.tsx`；diff 渲染 `DiffView.tsx`。
- 权限分支只有一种模式：`OrgLayout` 通过 `useOutletContext` 下发 `isAdmin`，`members`/`teams`/`org` 据此隐藏或禁用写操作；`create-repo`、`invitations`、`invite-links`、`feedback`、`logs` 靠**导航项过滤 + 后端 403** 兜底。

---

## 3. 后端 API 全表（87 个端点）

单进程 Fastify，`127.0.0.1:3000`，路由文件与挂载见 `server/src/index.ts:44-58`。API 路径**不按站点隔离**，三类前缀直接混在同一进程：

### 3.1 公开（portal 用，13）

| 方法 | 路径 |
|---|---|
| GET | `/api/docs`、`/api/docs/:id` |
| GET | `/api/feedback/categories`、`/api/feedback/public` |
| POST | `/api/feedback` |
| GET | `/api/public/config` |
| GET/POST | `/api/join/:token` |
| GET | `/api/me/orgs` |
| GET | `/auth/github`、`/auth/callback`、`/auth/me` |
| POST | `/auth/signout` |

### 3.2 论坛（37）

| 文件 | 端点 |
|---|---|
| `forum/auth.ts` | `GET /api/forum/me`、`POST /api/forum/auth/login`、`POST /api/forum/auth/register`、`POST /api/forum/auth/logout`、`GET /auth/forum/github`、`POST /api/forum/auth/set-password`、`GET /api/forum/auth/providers`、`DELETE /api/forum/auth/github` |
| `forum/categories.ts` | `GET /api/forum/categories`、`GET /api/forum/archive/categories`、`POST /api/forum/categories`、`DELETE /api/forum/categories/:id` |
| `forum/threads.ts` | `GET /api/forum/threads`、`GET /api/forum/threads/:id`、`POST /api/forum/threads`、`PATCH /api/forum/threads/:id`、`DELETE /api/forum/threads/:id` |
| `forum/posts.ts` | `POST /api/forum/posts`、`DELETE /api/forum/posts/:id`、`POST /api/forum/posts/:id/like` |
| `forum/users.ts` | `GET /api/forum/users/:username`、`PATCH /api/forum/me/profile`、`GET /api/forum/me/notifications`、`POST /api/forum/me/notifications/read-all` |
| `forum/groups.ts` | `GET /api/forum/permissions`、`GET /api/forum/groups`、`GET /api/forum/groups/:id`、`PUT /api/forum/groups/:id/permissions`、`POST /api/forum/groups/:id/members`、`DELETE /api/forum/groups/:id/members/:user_id` |
| `forum/admin-users.ts` | `GET /api/forum/admin/users`、`PATCH /api/forum/admin/users/:id/role`、`POST /api/forum/admin/teachers` |
| `forum/teacher.ts` | `GET /api/forum/teacher/overview` |
| `forum/stats.ts` | `GET /api/forum/stats` |
| `forum/upload.ts` | `POST /api/forum/upload`、`GET /forum/u/:name` |

### 3.3 管理后台（37）

全部 `/api/admin/:org/...` 参数化，`server/src/routes/admin/repos.ts` 一个文件占 17 个端点。

| 文件 | 端点数 | 覆盖 |
|---|---|---|
| `repos.ts` | 17 | list / detail / tree / file / commits / commit / issues / pulls / issue 详情 / pr 详情 / merge / issue 状态 / 评论 / create-repo / delete / collaborator ×2 |
| `invite-links.ts` | 4 | CRUD（仅 admin） |
| `members.ts` | 3 | list / remove / role |
| `feedback.ts` | 3 | list / patch / delete |
| `teams.ts` | 3 | list / create / delete |
| `invitations.ts` | 2 | list / delete |
| `overview.ts`、`org.ts`、`activity.ts`、`security.ts`、`logs.ts` | 各 1 | 总览 / 组织设置 / 事件流 / 安全 / 审计 |

---

## 4. 数据模型

两个 SQLite 文件、两个独立连接，均 WAL、均 `foreign_keys=ON`。**没有共享表，没有外键跨库。**

| 库 | 连接常量 | 路径 | 归属 |
|---|---|---|---|
| `data.db` | `config.dbPath` | `.env` 的 `DB_PATH`，线上 `/opt/yzgc-admin/data/data.db` | admin 站 |
| `forum.db` | `FORUM_DB_PATH ?? dirname(DB_PATH)/forum.db` | 线上 `/opt/yzgc-admin/data/forum.db` | forum 站 |

### 4.1 `data.db`（`server/src/lib/db.ts:11-88`）

| 表 | 用途 |
|---|---|
| `app_state` | K/V 状态 |
| `sessions` | admin 会话；`access_token_encrypted` 为 AES-256-GCM 密文，7 天过期 |
| `invite_links` | 邀请链接；`created_by_token_encrypted` 存创建者 token，`max_uses` / `current_uses` / `expires_at` / `team_slug` / `disabled` |
| `invitations` | 邀请历史；`status` = `sent` / `failed` / `pending_admin` |
| `feedback` | 意见；`status` = `open` / `triaged` / `in_progress` / `done` / `wont_do` / `spam` |
| `audit_logs` | 审计；`actor` 可能是 GitHub login 或 `public:<token>` |

### 4.2 `forum.db`（`server/src/lib/forum-db.ts:13-176`）

| 表 | 用途 |
|---|---|
| `forum_users` | 论坛用户；`github_id` / `password_bcrypt` 二选一或并存；`role` = `admin` / `mod` / `teacher` / `member` / `banned`；`legacy_mbbs_id` 溯源 |
| `forum_sessions` | 论坛会话，14 天过期；`source` = `password` / `github` / `bind` |
| `forum_categories` | 分类；`is_legacy` 标记归档区，`parent_id` 支持一级嵌套，`thread_count` 冗余计数 |
| `forum_threads` | 主题；`is_sticky` / `is_essence` / `is_locked` / `is_deleted` 软删 |
| `forum_posts` | 楼层；`reply_post_id` 指向被回复楼层 |
| `forum_likes` | 点赞，PK `(user_id, post_id)` |
| `forum_notifications` | 通知 |
| `forum_tags` / `forum_thread_tags` | 标签（当前 4 条 tag，0 条关联） |
| `forum_groups` / `forum_group_permissions` / `forum_user_groups` | RBAC 三表 |
| `forum_settings` | K/V |

Schema 通过 `CREATE TABLE IF NOT EXISTS` + 启动时 `PRAGMA table_info` 检查后 `ALTER TABLE ADD COLUMN` 做增量（`forum-db.ts:178-192`）。仓库约定（`CONVENTIONS.md` §5）：**只允许加列，禁止 drop、禁止重排**。

---

## 5. 鉴权体系

**三套并存，互不打通。**

| | admin | forum（Web） | forum（CLI/API） |
|---|---|---|---|
| 凭据 | `sid` cookie | `forum_sid` cookie | `Authorization: Bearer <GitHub PAT>` |
| 有效期 | 7 天 | 14 天 | token 映射缓存 5 分钟 |
| 存储 | `sessions` 表，token 加密 | `forum_sessions` 表 | 内存 `TOKEN_CACHE` |
| 中间件 | `requireAuth` + `requireOrgRole(minRole)` | `requireForumAuth` / `requireForumAdmin` / `requireForumTeacherOrAdmin` | 同左（`resolveBearerToForumUser`） |
| 身份来源 | GitHub OAuth | 密码或 GitHub 绑定 | GitHub PAT 换 `github_id` |

关键实现：

- **admin 用登录者自己的 token 调 GitHub**（`CONVENTIONS.md` §4）。`requireOrgRole` 实时调 `GET /orgs/{org}/memberships/{username}` 拿角色，GitHub 侧权限直接生效，本地不建 RBAC。唯一例外是公开邀请链接，用创建者加密存档的 token 代发邀请。
- **forum 有两套身份，同一张 `forum_users` 表**。CLI 用 PAT 时由 `forum-bearer.ts` 调 GitHub `/user` 换 `github_id`，走 `upsertForumUserFromGithub` 自动建号；Web 用密码或 OAuth 绑定。
- **论坛权限判定已收口但仍有余量**。`lib/forum-permissions.ts` 的 `hasPermission()` 强制 `thread.create` / `thread.reply`；`thread.sticky` / `essence` / `lock` / `hideAny` 等**仍是数据库里的保留记录，实际由路由内 `isOwner` / `isMod` 判断决定**（该文件 `PERMISSION_CATALOG` 的 `enforced` 字段已如实标注）。重构时需要二选一：让权限表真正生效，或删掉未强制的记录以免误导。

---

## 6. 技术栈与构建

| 层 | 选型 | 版本 |
|---|---|---|
| 前端框架 | React + TypeScript | 18.3 / 5.7 |
| 构建 | Vite | 6.0 |
| 路由 | React Router | 7.1 |
| 数据 | TanStack Query | 5.62 |
| 样式 | Tailwind（CSS 变量驱动色板） | 3.4 |
| Markdown | marked + DOMPurify + highlight.js | 15 / 3.4 / 11 |
| 后端 | Node + Fastify | 20 / 5.2 |
| GitHub | Octokit | 21 |
| 数据库 | better-sqlite3（WAL） | 11.6 |
| 包管理 | pnpm workspace（`server` + `web`） | 9.15.9 |

构建命令：

```bash
pnpm install --frozen-lockfile
pnpm --filter @yzgc/web build      # tsc -b && vite build → web/dist
pnpm --filter @yzgc/server build   # tsc → server/dist
```

Fastify 直接托管 `web/dist`，SPA fallback 在 `server/src/index.ts:60-70`（非 `/api`、`/auth`、`/healthz` 前缀一律回 `index.html`）。

样式分两套命名空间，重构时不要混：

- `web/src/index.css`（318）— Tailwind base/components/utilities + `card` / `btn-*` / `input` / `tag-*` / `prose-forum` / `prose-doc`，被 forum 与 admin 使用。
- `web/src/portal.css`（388）— `portal-*` / `mascot-*`，只被 portal 与 Mascot 使用。
- 色板唯一：`lib/themes.ts` 的 `yzgc-blue`，`--ink-*` / `--brand-*` 由 `applyTheme` 写到 `:root`，Tailwind 通过 `rgb(var(--x) / <alpha-value>)` 消费。硬编码 hex 被 `CONVENTIONS.md` §1 禁止。

---

## 7. 跨站耦合点（重构重点）

按耦合强度排序，这些是拆站点时会直接断掉的地方：

1. **单 bundle、无代码分割**。三站共享一份产物的代价是任何一站都要下载另外两站的代码。拆站收益最大的一项。
2. **跨站硬编码跳转**。`ForumHome.tsx:110-111` 用 `<Link to="/docs">`、`<Link to="/feedback">` 指向 portal 才有的路由；forum 路由表里没有这两条，会落到 catch-all `Navigate to="/"`。**当前线上是坏的**——点「使用文档」会回到论坛首页。正确写法是 `externalUrl("portal", "/docs")`。同类问题需要全量筛查 `Link`/`navigate` 的站内路径。
3. **`api()` 的 mock 分派**。`lib/api.ts` 在 dev 下把请求转给 `lib/mock-api.ts`，而 mock 用 `/overview$`、`/members$` 这类**正则尾匹配**而非 `/api/admin/` 前缀（`mock-api.ts`）。改动任何 API 路径都要同步 mock，否则开发态静默返回错误数据。
4. **`/api/docs` 的白名单在后端**。`server/src/routes/docs.ts:10-21` 硬编码 10 个文档条目（README / USAGE / DEPLOY / ARCHITECTURE / SECURITY 各中英）。**新增 `docs/*.md` 不会自动出现在文档站**，必须改这个数组。
5. **`/api/docs` 无鉴权**。文档站对公网开放，任何被加进白名单的 `.md` 都会公开。
6. **portal 与 forum 的路径重叠**。`yangtzeu.work/forum` 既是 portal 的前缀规则，又是 forum 的 `basename`；`site.ts:19-31` 与 `runtime.ts:105-113` 两处逻辑必须保持一致。
7. **`GlobalFab` 的站点判断**（`App.tsx:112-115`）：portal 不挂载，forum 传 `raised`（抬到看板娘之上），admin 用默认位置。三站行为不同但共用组件。

---

## 8. 已知缺陷清单

重构时顺手修掉的候选，均已定位到行：

| # | 位置 | 问题 | 影响 |
|---|---|---|---|
| 1 | `pages/forum/ForumHome.tsx:110-111` | `Link to="/docs"` / `to="/feedback"` 指向 portal 路由。因 forum 的 `BrowserRouter basename="/forum"`，实际渲染为 `href="/forum/docs"` | **线上已实测确认死链**：`https://yangtzeu.work/forum` 点「使用文档」→ 落到 `/forum/docs` → 命中 catch-all → 回到 `https://yangtzeu.work/forum`。正确写法 `externalUrl("portal", "/docs")` |
| 2 | `pages/Landing.tsx` Hero | `titleLead<br/><span>titleAccent</span>` 中 span 为 `inline-block`，被文案列宽度折断 | ≥1280px 时「把想法写成代码。」折成三行，末行孤字「码。」 |
| 3 | `pages/Landing.tsx:114,137` | `SectionHeading desc` 留着开发者备注（「先放静态样板，不读取任何 API…」「静态看板用于确认信息密度…」） | 已随新版上线，公网可见的内部措辞 |
| 4 | `pages/Docs.tsx:56-61` | `marked.parse` 结果直接 `dangerouslySetInnerHTML`，**未经 DOMPurify** | 论坛渲染有净化（`forum-render.ts`），文档站没有，两条路径不一致 |
| 5 | `lib/mock-api.ts:110` | `/api/docs` 返回 `{id,title,description}`，`Docs.tsx:8` 期望 `{id,label,lang}` | mock 模式下文档侧栏与语言切换失效 |
| 6 | `pages/Landing.tsx` | 首屏、方向卡、文章、讨论列表全部硬编码常量 | 改文案必须改代码、重新构建 |
| 7 | `server/src/lib/forum-permissions.ts` | `PERMISSION_CATALOG` 共 16 项，只有 `thread.create` / `thread.reply` 两项被 `hasPermission()` 强制，其余 14 项未被代码读取 | UI 展示的权限开关与实际行为不符 |
| 8 | 构建产物 | 单 chunk 597 KB，无 `manualChunks` | 首屏下载包含三站代码 |

---

## 9. 重构切分建议

> **具体方案、目标目录树、边界规则与分阶段执行计划见 [WEB-SPLIT.md](./WEB-SPLIT.md)。** 本节只保留盘点得出的判断。

盘点得出的一条关键事实：**三站之间零跨站 import**。所以拆分不是解耦重构，而是把已存在的边界落到文件系统与构建产物上。

执行顺序（详见 WEB-SPLIT §7）：

1. **修死链与净化缺口**（第 8 节 #1、#4）。一行级改动，风险最低，且是拆站前必须扫干净的东西。
2. **建目录骨架**——`web/sites/{portal,forum,admin}` + `web/shared/`，纯 `git mv` 位移，逻辑不改。
3. **拆构建**——三个 `index.html` + 多入口 Vite，服务端按 host 派发，各站只下载自己的代码。
4. **清理**——删 `site.ts` 的路径特判与 `data-site` 条件选择器。

明确不在本次范围内：

- **不合并数据库。** 双库双连接是天然边界，合并只增耦合。
- **不给后端加站点维度。** `/api/forum` 与 `/api/admin` 前缀已经清晰。
- **不统一鉴权。** 三套凭据并存是历史包袱，但合并风险高（论坛允许无 GitHub 账号的密码用户，与 admin 的 OAuth-only 模型不兼容）。先只做「清理未强制的权限记录」，统一鉴权单独立项。
- **不引入 eslint / prettier / husky 全家桶。** 边界用无依赖脚本守，格式靠既有约定。

待办（未启动）：

- 数据化官网——`Landing.tsx` 的静态常量改为接口驱动，才能让非开发者改文案。

---

## 附：文件规模参考

| 范围 | 文件数 | 行数 |
|---|---|---|
| `web/src/pages/`（portal 四页） | 4 | 681 |
| `web/src/pages/forum` | 14 | 1,882 |
| `web/src/pages/admin` | 16 | 2,153 |
| `web/src/components` | 10 | 745 |
| `web/src/lib` + `config/index.ts` | 8 | 576 |
| `web/src/index.css` + `portal.css` | 2 | 706 |
| `server/src` | 44 | 3,395 |

最大的三个文件：`admin/RepoDetail.tsx` 699 · `server/routes/admin/repos.ts` 378 · `forum/ForumAdmin.tsx` 377。

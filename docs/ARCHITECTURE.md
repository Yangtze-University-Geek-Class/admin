# 架构

## 总体

```
Internet
  │ 443 HTTPS
nginx ─── certbot (Let's Encrypt 自动续期)
  │ proxy_pass localhost:3000
Node + Fastify (单进程, systemd 管)
  ├── routes/auth.ts          OAuth flow + session
  ├── routes/orgs.ts          /api/me/orgs (我的组织列表)
  ├── routes/join.ts          /api/join/:token  公开入会
  ├── routes/feedback.ts      /api/feedback     公开提交意见
  └── routes/admin/*          按 org 参数化, 所有 /api/admin/:org/...
        ├── overview.ts
        ├── members.ts
        ├── repos.ts          (含 tree/file/commits/issues/pulls/create/delete/collab)
        ├── invitations.ts
        ├── invite-links.ts
        ├── teams.ts
        ├── activity.ts
        ├── security.ts
        ├── org.ts
        ├── feedback.ts
        └── logs.ts
SQLite (WAL)
  ├── sessions
  ├── invite_links
  ├── invitations
  ├── feedback
  ├── audit_logs
  └── app_state
```

## 鉴权 / 授权

### 登录 flow

1. 用户访问 `/admin/signin` → 点击"GitHub 登录"
2. 浏览器跳 `/auth/github?return_to=<原始 URL>` → 后端生成 state，写到 `oauth_state` cookie，redirect 到 `https://github.com/login/oauth/authorize?...`
3. 用户 Authorize → GitHub callback 到 `/auth/callback?code=...&state=...`
4. 后端验证 state，用 code 交换 access_token，调 `GET /user` 拿 login + avatar
5. 创建 session record（access_token 经 AES-256-GCM 加密落库）
6. 设 httpOnly + secure + sameSite=lax 的 `sid` cookie
7. 跳回 `return_to`

OAuth scope：`read:user user:email admin:org read:org repo`

### 权限校验

每个 admin API 路由有两个 preHandler：

1. `requireAuth` → 验 session cookie，把 `req.session = { login, accessToken, ... }` 挂上
2. `requireOrgRole("admin" | "member")` → 用 session 的 accessToken 调 `GET /orgs/{org}/memberships/{login}` 拿当前用户在该 org 的 role；若 role 不够直接 403

**关键**：所有对 GitHub API 的调用都用**登录用户自己的 access_token**，不是全局 service token。
GitHub 端的权限模型直接生效，无需在我们这一层再实现 RBAC。

唯一例外是公开 invite link：链接生成时把 admin 的 access_token AES 加密存进 `invite_links.created_by_token_encrypted`，访客提交时用它调 `POST /orgs/.../invitations`。

## 数据库 schema 关键点

```sql
sessions(id PK, login, user_id, avatar_url,
         access_token_encrypted, created_at, expires_at)
-- 7 天过期

invite_links(token PK, org, created_by, created_by_token_encrypted,
             note, max_uses, current_uses, expires_at, team_slug, disabled, created_at)
-- 删除链接 ≠ 撤销已发出的 GitHub invitation

invitations(id, org, invite_link_token FK?, github_login, email,
            note, source_ip, user_agent, github_invitation_id, status, error_message, created_at)
-- 本系统发起的邀请历史, status: sent / failed / pending_admin

feedback(id, org, content, category, contact, submitter_login, submitter_id,
         source_ip, user_agent, status, reply, replied_by, replied_at, votes, created_at, updated_at)
-- status: open / triaged / in_progress / done / wont_do / spam

audit_logs(id, org, actor, action, target, details JSON, ip, created_at)
-- actor 可能是 GitHub login, 也可能是 'public:<token>' 表示通过公开 API
```

## 加密

- `ENCRYPTION_KEY` 32 字节 base64
- 算法 AES-256-GCM, 12 字节 random IV, 16 字节 auth tag
- 编码格式: base64(iv || tag || ciphertext)
- 加密对象: session.access_token, invite_link.created_by_token

## 防滥用

- 公开 invite POST: `@fastify/rate-limit` 5 req/min per IP
- 公开 feedback POST: 10 req/min per IP
- Cloudflare Turnstile：可选（`TURNSTILE_SITE_KEY/SECRET_KEY` 配置开启）

## 前端运行配置

`web/src/config/app.config.json` 是前端运行时配置的单一入口：

- `environment.development/production`：默认站点、mock/live 数据源、开发总控和覆盖权限。
- `sites` / `urls`：三个站点的域名、标题、主题和外链。
- `features.development/production`：看板娘、论坛看板娘、官网动态背景、预览区和意见悬浮按钮，可按环境分别设置。
- `portal`：官网 Hero 文案、唯一柔和蓝色 palette、代码流和装饰符号参数。
- `mascot`：尺寸、气泡间距、8 套姿势资源、fit/position/scale 和对话。

`web/src/lib/runtime.ts` 负责解析开发覆盖；`web/src/lib/api.ts` 根据数据源分派到真实 fetch 或 `web/src/lib/mock-api.ts`。mock 层只存在于前端，不增加服务端路由。生产构建强制 live，忽略 `__site` / `__data` 和 localStorage 覆盖。

## 前端架构

- Vite 6 + React 18 + React Router 7 + TanStack Query 5
- Tailwind 颜色由 CSS variables 驱动；产品只保留唯一的 `yzgc-blue` 浅色主题，旧深色主题 ID 自动回退
- 全局组件: `<ConfirmProvider>` (替代 window.confirm), `<Select>` (替代 native dropdown)
- 路由分 4 类:
  - `/` `/feedback/*` `/join/:token` — 公开
  - `/admin/signin` — 登录入口
  - `/admin` — 我的 orgs
  - `/admin/:org/*` — OrgLayout 包裹的所有功能页

## 部署

systemd Type=simple, 监听 127.0.0.1:3000, nginx 反代，证书 certbot 自动续期（cron / systemd timer 已自动配）。

详见 [DEPLOY.md](./DEPLOY.md)。

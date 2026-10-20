# 后端接口目录

> 真实 Fastify 注册的方法、路径、Schema 与源码位置；含根路由、嵌套插件、循环注册及自动 HEAD。

状态：`current` · 更新：2026-10-20 · 自动生成，不手工编辑。

来源摘要：`d2f12c41ffee16ed471d9a414db5af4eef5972df46a1ace9be579bcbd1434b2a`。更新日期指目录声明版本，数据新鲜度由摘要和 `pnpm check:catalog` 核对。

[使用与维护](README.md) · [总览](CATALOG.md) · [接口](routes.md) · [数据](data-model.md) · [权限](permissions.md) · [机器目录](catalog.json)

[接口行为契约](../../services/server/endpoint-contracts.md)按方法和路径说明成功响应、失败、资源授权及副作用；[业务流程](CATALOG.md#业务流程)关联数据库读写，地图中可沿接口与流程互相跳转。

Schema 完整内容在机器目录；这里的授权项只是源码检查证据，不是完整策略。没有直接检查不能解释为匿名可用。数据库、外部 HTTP 和发信均使用隔离配置，没有监听端口。

## 业务与认证

| 方法与路径 | 业务域 | 注册 | 请求 Schema | 响应 Schema | 授权检查证据 | 源码 |
|---|---|---|---|---|---|---|
| `DELETE /api/admin/:org/feedback/:id` | `feedback` | 显式 | `params`、`querystring` | 未声明 | `requireAuth`、`requireOrgRole("admin")` | [app/server/src/routes/admin/feedback.ts:32](../../../app/server/src/routes/admin/feedback.ts#L32) |
| `DELETE /api/admin/:org/invitations/:id` | `invitations` | 显式 | `params`、`querystring` | 未声明 | `requireAuth`、`requireOrgRole("admin")` | [app/server/src/routes/admin/invitations.ts:22](../../../app/server/src/routes/admin/invitations.ts#L22) |
| `DELETE /api/admin/:org/invite-links/:token` | `invitations` | 显式 | `params`、`querystring` | 未声明 | `requireAuth`、`requireOrgRole("admin")` | [app/server/src/routes/admin/invite-links.ts:74](../../../app/server/src/routes/admin/invite-links.ts#L74) |
| `DELETE /api/admin/:org/members/:login` | `github` | 显式 | `params`、`querystring` | 未声明 | `requireAuth`、`requireOrgRole("admin")` | [app/server/src/routes/admin/members.ts:29](../../../app/server/src/routes/admin/members.ts#L29) |
| `DELETE /api/admin/:org/repos/:repo` | `github` | 显式 | `params`、`querystring` | 未声明 | `requireAuth`、`requireOrgRole("admin")` | [app/server/src/routes/admin/repos.ts:338](../../../app/server/src/routes/admin/repos.ts#L338) |
| `DELETE /api/admin/:org/repos/:repo/collaborators/:login` | `github` | 显式 | `params`、`querystring` | 未声明 | `requireAuth`、`requireOrgRole("admin")` | [app/server/src/routes/admin/repos.ts:366](../../../app/server/src/routes/admin/repos.ts#L366) |
| `DELETE /api/admin/:org/teams/:slug` | `github` | 显式 | `params`、`querystring` | 未声明 | `requireAuth`、`requireOrgRole("admin")` | [app/server/src/routes/admin/teams.ts:42](../../../app/server/src/routes/admin/teams.ts#L42) |
| `DELETE /api/competitions/:id/signup` | `competitions` | 显式 | `params`、`querystring` | 已挂载 | 需查看 handler 与继承策略 | [app/server/src/routes/portal/competition-signups.ts:89](../../../app/server/src/routes/portal/competition-signups.ts#L89) |
| `DELETE /api/console/assignments/:id` | `organization` | 显式 | `params`、`querystring` | 未声明 | `requireAuth`、`requireCapability("roles.manage", "roles.department.manage")` | [app/server/src/routes/console/assignments.ts:98](../../../app/server/src/routes/console/assignments.ts#L98) |
| `DELETE /api/console/competitions/:competition_id` | `competitions` | 显式 | `params`、`querystring` | 已挂载 | `requireAuth` | [app/server/src/routes/console/competitions.ts:101](../../../app/server/src/routes/console/competitions.ts#L101) |
| `DELETE /api/console/departments/:department_id` | `organization` | 显式 | `params`、`querystring` | 未声明 | `requireAuth` | [app/server/src/routes/console/departments.ts:63](../../../app/server/src/routes/console/departments.ts#L63) |
| `DELETE /api/console/feedback/:id` | `feedback` | 显式 | `params`、`querystring` | 未声明 | `requireAuth`、`requireCapability("feedback.manage")` | [app/server/src/routes/console/feedback.ts:31](../../../app/server/src/routes/console/feedback.ts#L31) |
| `DELETE /api/forum/me/avatar` | `forum` | 显式 | `params`、`querystring` | 未声明 | `requireMember(req)` | [app/server/src/routes/forum-api/people.ts:91](../../../app/server/src/routes/forum-api/people.ts#L91) |
| `DELETE /api/forum/posts/:post_id` | `forum` | 显式 | `params`、`querystring` | 未声明 | `requireMember(req)` | [app/server/src/routes/forum-api/posts.ts:90](../../../app/server/src/routes/forum-api/posts.ts#L90) |
| `DELETE /api/teams/:id` | `competitions` | 显式 | `params`、`querystring` | 已挂载 | 需查看 handler 与继承策略 | [app/server/src/routes/portal/competition-signups.ts:283](../../../app/server/src/routes/portal/competition-signups.ts#L283) |
| `DELETE /api/teams/:id/lock` | `competitions` | 显式 | `params`、`querystring` | 已挂载 | 需查看 handler 与继承策略 | [app/server/src/routes/portal/competition-signups.ts:325](../../../app/server/src/routes/portal/competition-signups.ts#L325) |
| `GET /api/admin/:org/activity` | `github` | 显式 | `params`、`querystring` | 未声明 | `requireAuth`、`requireOrgRole("member")` | [app/server/src/routes/admin/activity.ts:9](../../../app/server/src/routes/admin/activity.ts#L9) |
| `GET /api/admin/:org/feedback` | `feedback` | 显式 | `params`、`querystring` | 未声明 | `requireAuth`、`requireOrgRole("admin")` | [app/server/src/routes/admin/feedback.ts:13](../../../app/server/src/routes/admin/feedback.ts#L13) |
| `GET /api/admin/:org/invitations` | `invitations` | 显式 | `params`、`querystring` | 未声明 | `requireAuth`、`requireOrgRole("admin")` | [app/server/src/routes/admin/invitations.ts:10](../../../app/server/src/routes/admin/invitations.ts#L10) |
| `GET /api/admin/:org/invite-links` | `invitations` | 显式 | `params`、`querystring` | 未声明 | `requireAuth`、`requireOrgRole("admin")` | [app/server/src/routes/admin/invite-links.ts:18](../../../app/server/src/routes/admin/invite-links.ts#L18) |
| `GET /api/admin/:org/logs` | `audit` | 显式 | `params`、`querystring` | 未声明 | `requireAuth`、`requireOrgRole("admin")` | [app/server/src/routes/admin/logs.ts:9](../../../app/server/src/routes/admin/logs.ts#L9) |
| `GET /api/admin/:org/members` | `github` | 显式 | `params`、`querystring` | 未声明 | `requireAuth`、`requireOrgRole("member")` | [app/server/src/routes/admin/members.ts:10](../../../app/server/src/routes/admin/members.ts#L10) |
| `GET /api/admin/:org/org` | `github` | 显式 | `params`、`querystring` | 未声明 | `requireAuth`、`requireOrgRole("member")` | [app/server/src/routes/admin/org.ts:21](../../../app/server/src/routes/admin/org.ts#L21) |
| `GET /api/admin/:org/overview` | `github` | 显式 | `params`、`querystring` | 未声明 | `requireAuth`、`requireOrgRole("member")` | [app/server/src/routes/admin/overview.ts:10](../../../app/server/src/routes/admin/overview.ts#L10) |
| `GET /api/admin/:org/repos` | `github` | 显式 | `params`、`querystring` | 未声明 | `requireAuth`、`requireOrgRole("member")` | [app/server/src/routes/admin/repos.ts:11](../../../app/server/src/routes/admin/repos.ts#L11) |
| `GET /api/admin/:org/repos/:repo` | `github` | 显式 | `params`、`querystring` | 未声明 | `requireAuth`、`requireOrgRole("member")` | [app/server/src/routes/admin/repos.ts:41](../../../app/server/src/routes/admin/repos.ts#L41) |
| `GET /api/admin/:org/repos/:repo/commits` | `github` | 显式 | `params`、`querystring` | 未声明 | `requireAuth`、`requireOrgRole("member")` | [app/server/src/routes/admin/repos.ts:98](../../../app/server/src/routes/admin/repos.ts#L98) |
| `GET /api/admin/:org/repos/:repo/commits/:sha` | `github` | 显式 | `params`、`querystring` | 未声明 | `requireAuth`、`requireOrgRole("member")` | [app/server/src/routes/admin/repos.ts:130](../../../app/server/src/routes/admin/repos.ts#L130) |
| `GET /api/admin/:org/repos/:repo/file` | `github` | 显式 | `params`、`querystring` | 未声明 | `requireAuth`、`requireOrgRole("member")` | [app/server/src/routes/admin/repos.ts:81](../../../app/server/src/routes/admin/repos.ts#L81) |
| `GET /api/admin/:org/repos/:repo/issues` | `github` | 显式 | `params`、`querystring` | 未声明 | `requireAuth`、`requireOrgRole("member")` | [app/server/src/routes/admin/repos.ts:154](../../../app/server/src/routes/admin/repos.ts#L154) |
| `GET /api/admin/:org/repos/:repo/issues/:n` | `github` | 显式 | `params`、`querystring` | 未声明 | `requireAuth`、`requireOrgRole("member")` | [app/server/src/routes/admin/repos.ts:202](../../../app/server/src/routes/admin/repos.ts#L202) |
| `GET /api/admin/:org/repos/:repo/pulls` | `github` | 显式 | `params`、`querystring` | 未声明 | `requireAuth`、`requireOrgRole("member")` | [app/server/src/routes/admin/repos.ts:177](../../../app/server/src/routes/admin/repos.ts#L177) |
| `GET /api/admin/:org/repos/:repo/pulls/:n` | `github` | 显式 | `params`、`querystring` | 未声明 | `requireAuth`、`requireOrgRole("member")` | [app/server/src/routes/admin/repos.ts:228](../../../app/server/src/routes/admin/repos.ts#L228) |
| `GET /api/admin/:org/repos/:repo/tree` | `github` | 显式 | `params`、`querystring` | 未声明 | `requireAuth`、`requireOrgRole("member")` | [app/server/src/routes/admin/repos.ts:63](../../../app/server/src/routes/admin/repos.ts#L63) |
| `GET /api/admin/:org/security` | `github` | 显式 | `params`、`querystring` | 未声明 | `requireAuth`、`requireOrgRole("member")` | [app/server/src/routes/admin/security.ts:9](../../../app/server/src/routes/admin/security.ts#L9) |
| `GET /api/admin/:org/teams` | `github` | 显式 | `params`、`querystring` | 未声明 | `requireAuth`、`requireOrgRole("member")` | [app/server/src/routes/admin/teams.ts:10](../../../app/server/src/routes/admin/teams.ts#L10) |
| `GET /api/competitions/:id/free-agents` | `competitions` | 显式 | `params`、`querystring` | 已挂载 | 需查看 handler 与继承策略 | [app/server/src/routes/portal/competition-signups.ts:127](../../../app/server/src/routes/portal/competition-signups.ts#L127) |
| `GET /api/competitions/:id/my-status` | `competitions` | 显式 | `params`、`querystring` | 已挂载 | 需查看 handler 与继承策略 | [app/server/src/routes/portal/competition-signups.ts:50](../../../app/server/src/routes/portal/competition-signups.ts#L50) |
| `GET /api/competitions/:id/teams` | `competitions` | 显式 | `params`、`querystring` | 已挂载 | 需查看 handler 与继承策略 | [app/server/src/routes/portal/competition-signups.ts:110](../../../app/server/src/routes/portal/competition-signups.ts#L110) |
| `GET /api/console/applications` | `recruitment` | 显式 | `params`、`querystring` | 未声明 | `requireAuth`、`requireCapability("applications.read")` | [app/server/src/routes/console/applications.ts:45](../../../app/server/src/routes/console/applications.ts#L45) |
| `GET /api/console/applications/:application_id` | `recruitment` | 显式 | `params`、`querystring` | 未声明 | `requireAuth`、`requireCapability("applications.read")` | [app/server/src/routes/console/applications.ts:101](../../../app/server/src/routes/console/applications.ts#L101) |
| `GET /api/console/applications/export.csv` | `recruitment` | 显式 | `params`、`querystring` | 未声明 | `requireAuth`、`requireCapability("applications.export")` | [app/server/src/routes/console/applications.ts:74](../../../app/server/src/routes/console/applications.ts#L74) |
| `GET /api/console/assignments` | `organization` | 显式 | `params`、`querystring` | 未声明 | `requireAuth`、`requireCapability("roles.manage", "roles.department.manage")` | [app/server/src/routes/console/assignments.ts:34](../../../app/server/src/routes/console/assignments.ts#L34) |
| `GET /api/console/audit` | `audit` | 显式 | `params`、`querystring` | 未声明 | `requireAuth`、`requireCapability("audit.read")` | [app/server/src/routes/console/audit.ts:29](../../../app/server/src/routes/console/audit.ts#L29) |
| `GET /api/console/catalogue` | `organization` | 显式 | `params`、`querystring` | 未声明 | `requireAuth`、`requireCapability("console.access")` | [app/server/src/routes/console/catalogue.ts:12](../../../app/server/src/routes/console/catalogue.ts#L12) |
| `GET /api/console/competitions` | `competitions` | 显式 | `params`、`querystring` | 已挂载 | `requireAuth`、`requireCapability("console.access")` | [app/server/src/routes/console/competitions.ts:31](../../../app/server/src/routes/console/competitions.ts#L31) |
| `GET /api/console/competitions/:competition_id/roster` | `competitions` | 显式 | `params`、`querystring` | 已挂载 | 需查看 handler 与继承策略 | [app/server/src/routes/console/competition-roster.ts:14](../../../app/server/src/routes/console/competition-roster.ts#L14) |
| `GET /api/console/competitions/:competition_id/roster.csv` | `competitions` | 显式 | `params`、`querystring` | 已挂载 | 需查看 handler 与继承策略 | [app/server/src/routes/console/competition-roster.ts:75](../../../app/server/src/routes/console/competition-roster.ts#L75) |
| `GET /api/console/departments` | `organization` | 显式 | `params`、`querystring` | 未声明 | `requireAuth`、`requireCapability("console.access")` | [app/server/src/routes/console/departments.ts:30](../../../app/server/src/routes/console/departments.ts#L30) |
| `GET /api/console/feedback` | `feedback` | 显式 | `params`、`querystring` | 未声明 | `requireAuth`、`requireCapability("feedback.read")` | [app/server/src/routes/console/feedback.ts:12](../../../app/server/src/routes/console/feedback.ts#L12) |
| `GET /api/console/me` | `organization` | 显式 | `params`、`querystring` | 未声明 | `requireAuth` | [app/server/src/routes/console/me.ts:14](../../../app/server/src/routes/console/me.ts#L14) |
| `GET /api/console/people` | `organization` | 显式 | `params`、`querystring` | 未声明 | `requireAuth`、`requireCapability("roles.manage", "roles.department.manage")` | [app/server/src/routes/console/people.ts:20](../../../app/server/src/routes/console/people.ts#L20) |
| `GET /api/console/summary` | `organization` | 显式 | `params`、`querystring` | 未声明 | `requireAuth`、`requireCapability("console.access")` | [app/server/src/routes/console/me.ts:27](../../../app/server/src/routes/console/me.ts#L27) |
| `GET /api/docs` | `public_content` | 显式 | `params`、`querystring` | 未声明 | 需查看 handler 与继承策略 | [app/server/src/routes/portal/docs.ts:16](../../../app/server/src/routes/portal/docs.ts#L16) |
| `GET /api/docs/:id` | `public_content` | 显式 | `params`、`querystring` | 未声明 | 需查看 handler 与继承策略 | [app/server/src/routes/portal/docs.ts:23](../../../app/server/src/routes/portal/docs.ts#L23) |
| `GET /api/feedback/categories` | `feedback` | 显式 | `params`、`querystring` | 未声明 | 需查看 handler 与继承策略 | [app/server/src/routes/portal/feedback.ts:24](../../../app/server/src/routes/portal/feedback.ts#L24) |
| `GET /api/feedback/public` | `feedback` | 显式 | `params`、`querystring` | 未声明 | 需查看 handler 与继承策略 | [app/server/src/routes/portal/feedback.ts:62](../../../app/server/src/routes/portal/feedback.ts#L62) |
| `GET /api/forum/avatars/:file` | `forum` | 显式 | `params`、`querystring` | 未声明 | 需查看 handler 与继承策略 | [app/server/src/routes/forum-api/people.ts:99](../../../app/server/src/routes/forum-api/people.ts#L99) |
| `GET /api/forum/search` | `forum` | 显式 | `params`、`querystring` | 未声明 | `forumViewer(req)` | [app/server/src/routes/forum-api/topics.ts:38](../../../app/server/src/routes/forum-api/topics.ts#L38) |
| `GET /api/forum/state` | `forum` | 显式 | `params`、`querystring` | 未声明 | `forumViewer(req)` | [app/server/src/routes/forum-api/topics.ts:21](../../../app/server/src/routes/forum-api/topics.ts#L21) |
| `GET /api/forum/topics/:topic_id/posts` | `forum` | 显式 | `params`、`querystring` | 未声明 | `forumViewer(req)` | [app/server/src/routes/forum-api/topics.ts:28](../../../app/server/src/routes/forum-api/topics.ts#L28) |
| `GET /api/join/:token` | `invitations` | 显式 | `params`、`querystring` | 未声明 | 需查看 handler 与继承策略 | [app/server/src/routes/portal/join.ts:52](../../../app/server/src/routes/portal/join.ts#L52) |
| `GET /api/me/competitions` | `competitions` | 显式 | `params`、`querystring` | 已挂载 | 需查看 handler 与继承策略 | [app/server/src/routes/portal/competition-signups.ts:38](../../../app/server/src/routes/portal/competition-signups.ts#L38) |
| `GET /api/me/orgs` | `github` | 显式 | `params`、`querystring` | 未声明 | `requireAuth` | [app/server/src/routes/admin/orgs.ts:10](../../../app/server/src/routes/admin/orgs.ts#L10) |
| `GET /api/public/competitions` | `competitions` | 显式 | `params`、`querystring` | 已挂载 | 需查看 handler 与继承策略 | [app/server/src/routes/portal/competitions.ts:10](../../../app/server/src/routes/portal/competitions.ts#L10) |
| `GET /api/public/config` | `platform` | 显式 | `params`、`querystring` | 未声明 | 需查看 handler 与继承策略 | [app/server/src/routes/portal/join.ts:47](../../../app/server/src/routes/portal/join.ts#L47) |
| `GET /api/public/org` | `organization` | 显式 | `params`、`querystring` | 未声明 | 需查看 handler 与继承策略 | [app/server/src/routes/portal/org.ts:11](../../../app/server/src/routes/portal/org.ts#L11) |
| `GET /auth/callback` | `identity` | 显式 | `params`、`querystring` | 未声明 | 需查看 handler 与继承策略 | [app/server/src/routes/admin/auth.ts:44](../../../app/server/src/routes/admin/auth.ts#L44) |
| `GET /auth/github` | `identity` | 显式 | `params`、`querystring` | 未声明 | 需查看 handler 与继承策略 | [app/server/src/routes/admin/auth.ts:37](../../../app/server/src/routes/admin/auth.ts#L37) |
| `GET /auth/me` | `identity` | 显式 | `params`、`querystring` | 未声明 | 需查看 handler 与继承策略 | [app/server/src/routes/admin/auth.ts:98](../../../app/server/src/routes/admin/auth.ts#L98) |
| `HEAD /api/admin/:org/activity` | `github` | 自动 HEAD | `params`、`querystring` | 未声明 | `requireAuth`、`requireOrgRole("member")` | [app/server/src/routes/admin/activity.ts:9](../../../app/server/src/routes/admin/activity.ts#L9) |
| `HEAD /api/admin/:org/feedback` | `feedback` | 自动 HEAD | `params`、`querystring` | 未声明 | `requireAuth`、`requireOrgRole("admin")` | [app/server/src/routes/admin/feedback.ts:13](../../../app/server/src/routes/admin/feedback.ts#L13) |
| `HEAD /api/admin/:org/invitations` | `invitations` | 自动 HEAD | `params`、`querystring` | 未声明 | `requireAuth`、`requireOrgRole("admin")` | [app/server/src/routes/admin/invitations.ts:10](../../../app/server/src/routes/admin/invitations.ts#L10) |
| `HEAD /api/admin/:org/invite-links` | `invitations` | 自动 HEAD | `params`、`querystring` | 未声明 | `requireAuth`、`requireOrgRole("admin")` | [app/server/src/routes/admin/invite-links.ts:18](../../../app/server/src/routes/admin/invite-links.ts#L18) |
| `HEAD /api/admin/:org/logs` | `audit` | 自动 HEAD | `params`、`querystring` | 未声明 | `requireAuth`、`requireOrgRole("admin")` | [app/server/src/routes/admin/logs.ts:9](../../../app/server/src/routes/admin/logs.ts#L9) |
| `HEAD /api/admin/:org/members` | `github` | 自动 HEAD | `params`、`querystring` | 未声明 | `requireAuth`、`requireOrgRole("member")` | [app/server/src/routes/admin/members.ts:10](../../../app/server/src/routes/admin/members.ts#L10) |
| `HEAD /api/admin/:org/org` | `github` | 自动 HEAD | `params`、`querystring` | 未声明 | `requireAuth`、`requireOrgRole("member")` | [app/server/src/routes/admin/org.ts:21](../../../app/server/src/routes/admin/org.ts#L21) |
| `HEAD /api/admin/:org/overview` | `github` | 自动 HEAD | `params`、`querystring` | 未声明 | `requireAuth`、`requireOrgRole("member")` | [app/server/src/routes/admin/overview.ts:10](../../../app/server/src/routes/admin/overview.ts#L10) |
| `HEAD /api/admin/:org/repos` | `github` | 自动 HEAD | `params`、`querystring` | 未声明 | `requireAuth`、`requireOrgRole("member")` | [app/server/src/routes/admin/repos.ts:11](../../../app/server/src/routes/admin/repos.ts#L11) |
| `HEAD /api/admin/:org/repos/:repo` | `github` | 自动 HEAD | `params`、`querystring` | 未声明 | `requireAuth`、`requireOrgRole("member")` | [app/server/src/routes/admin/repos.ts:41](../../../app/server/src/routes/admin/repos.ts#L41) |
| `HEAD /api/admin/:org/repos/:repo/commits` | `github` | 自动 HEAD | `params`、`querystring` | 未声明 | `requireAuth`、`requireOrgRole("member")` | [app/server/src/routes/admin/repos.ts:98](../../../app/server/src/routes/admin/repos.ts#L98) |
| `HEAD /api/admin/:org/repos/:repo/commits/:sha` | `github` | 自动 HEAD | `params`、`querystring` | 未声明 | `requireAuth`、`requireOrgRole("member")` | [app/server/src/routes/admin/repos.ts:130](../../../app/server/src/routes/admin/repos.ts#L130) |
| `HEAD /api/admin/:org/repos/:repo/file` | `github` | 自动 HEAD | `params`、`querystring` | 未声明 | `requireAuth`、`requireOrgRole("member")` | [app/server/src/routes/admin/repos.ts:81](../../../app/server/src/routes/admin/repos.ts#L81) |
| `HEAD /api/admin/:org/repos/:repo/issues` | `github` | 自动 HEAD | `params`、`querystring` | 未声明 | `requireAuth`、`requireOrgRole("member")` | [app/server/src/routes/admin/repos.ts:154](../../../app/server/src/routes/admin/repos.ts#L154) |
| `HEAD /api/admin/:org/repos/:repo/issues/:n` | `github` | 自动 HEAD | `params`、`querystring` | 未声明 | `requireAuth`、`requireOrgRole("member")` | [app/server/src/routes/admin/repos.ts:202](../../../app/server/src/routes/admin/repos.ts#L202) |
| `HEAD /api/admin/:org/repos/:repo/pulls` | `github` | 自动 HEAD | `params`、`querystring` | 未声明 | `requireAuth`、`requireOrgRole("member")` | [app/server/src/routes/admin/repos.ts:177](../../../app/server/src/routes/admin/repos.ts#L177) |
| `HEAD /api/admin/:org/repos/:repo/pulls/:n` | `github` | 自动 HEAD | `params`、`querystring` | 未声明 | `requireAuth`、`requireOrgRole("member")` | [app/server/src/routes/admin/repos.ts:228](../../../app/server/src/routes/admin/repos.ts#L228) |
| `HEAD /api/admin/:org/repos/:repo/tree` | `github` | 自动 HEAD | `params`、`querystring` | 未声明 | `requireAuth`、`requireOrgRole("member")` | [app/server/src/routes/admin/repos.ts:63](../../../app/server/src/routes/admin/repos.ts#L63) |
| `HEAD /api/admin/:org/security` | `github` | 自动 HEAD | `params`、`querystring` | 未声明 | `requireAuth`、`requireOrgRole("member")` | [app/server/src/routes/admin/security.ts:9](../../../app/server/src/routes/admin/security.ts#L9) |
| `HEAD /api/admin/:org/teams` | `github` | 自动 HEAD | `params`、`querystring` | 未声明 | `requireAuth`、`requireOrgRole("member")` | [app/server/src/routes/admin/teams.ts:10](../../../app/server/src/routes/admin/teams.ts#L10) |
| `HEAD /api/competitions/:id/free-agents` | `competitions` | 自动 HEAD | `params`、`querystring` | 已挂载 | 需查看 handler 与继承策略 | [app/server/src/routes/portal/competition-signups.ts:127](../../../app/server/src/routes/portal/competition-signups.ts#L127) |
| `HEAD /api/competitions/:id/my-status` | `competitions` | 自动 HEAD | `params`、`querystring` | 已挂载 | 需查看 handler 与继承策略 | [app/server/src/routes/portal/competition-signups.ts:50](../../../app/server/src/routes/portal/competition-signups.ts#L50) |
| `HEAD /api/competitions/:id/teams` | `competitions` | 自动 HEAD | `params`、`querystring` | 已挂载 | 需查看 handler 与继承策略 | [app/server/src/routes/portal/competition-signups.ts:110](../../../app/server/src/routes/portal/competition-signups.ts#L110) |
| `HEAD /api/console/applications` | `recruitment` | 自动 HEAD | `params`、`querystring` | 未声明 | `requireAuth`、`requireCapability("applications.read")` | [app/server/src/routes/console/applications.ts:45](../../../app/server/src/routes/console/applications.ts#L45) |
| `HEAD /api/console/applications/:application_id` | `recruitment` | 自动 HEAD | `params`、`querystring` | 未声明 | `requireAuth`、`requireCapability("applications.read")` | [app/server/src/routes/console/applications.ts:101](../../../app/server/src/routes/console/applications.ts#L101) |
| `HEAD /api/console/applications/export.csv` | `recruitment` | 自动 HEAD | `params`、`querystring` | 未声明 | `requireAuth`、`requireCapability("applications.export")` | [app/server/src/routes/console/applications.ts:74](../../../app/server/src/routes/console/applications.ts#L74) |
| `HEAD /api/console/assignments` | `organization` | 自动 HEAD | `params`、`querystring` | 未声明 | `requireAuth`、`requireCapability("roles.manage", "roles.department.manage")` | [app/server/src/routes/console/assignments.ts:34](../../../app/server/src/routes/console/assignments.ts#L34) |
| `HEAD /api/console/audit` | `audit` | 自动 HEAD | `params`、`querystring` | 未声明 | `requireAuth`、`requireCapability("audit.read")` | [app/server/src/routes/console/audit.ts:29](../../../app/server/src/routes/console/audit.ts#L29) |
| `HEAD /api/console/catalogue` | `organization` | 自动 HEAD | `params`、`querystring` | 未声明 | `requireAuth`、`requireCapability("console.access")` | [app/server/src/routes/console/catalogue.ts:12](../../../app/server/src/routes/console/catalogue.ts#L12) |
| `HEAD /api/console/competitions` | `competitions` | 自动 HEAD | `params`、`querystring` | 已挂载 | `requireAuth`、`requireCapability("console.access")` | [app/server/src/routes/console/competitions.ts:31](../../../app/server/src/routes/console/competitions.ts#L31) |
| `HEAD /api/console/competitions/:competition_id/roster` | `competitions` | 自动 HEAD | `params`、`querystring` | 已挂载 | 需查看 handler 与继承策略 | [app/server/src/routes/console/competition-roster.ts:14](../../../app/server/src/routes/console/competition-roster.ts#L14) |
| `HEAD /api/console/competitions/:competition_id/roster.csv` | `competitions` | 自动 HEAD | `params`、`querystring` | 已挂载 | 需查看 handler 与继承策略 | [app/server/src/routes/console/competition-roster.ts:75](../../../app/server/src/routes/console/competition-roster.ts#L75) |
| `HEAD /api/console/departments` | `organization` | 自动 HEAD | `params`、`querystring` | 未声明 | `requireAuth`、`requireCapability("console.access")` | [app/server/src/routes/console/departments.ts:30](../../../app/server/src/routes/console/departments.ts#L30) |
| `HEAD /api/console/feedback` | `feedback` | 自动 HEAD | `params`、`querystring` | 未声明 | `requireAuth`、`requireCapability("feedback.read")` | [app/server/src/routes/console/feedback.ts:12](../../../app/server/src/routes/console/feedback.ts#L12) |
| `HEAD /api/console/me` | `organization` | 自动 HEAD | `params`、`querystring` | 未声明 | `requireAuth` | [app/server/src/routes/console/me.ts:14](../../../app/server/src/routes/console/me.ts#L14) |
| `HEAD /api/console/people` | `organization` | 自动 HEAD | `params`、`querystring` | 未声明 | `requireAuth`、`requireCapability("roles.manage", "roles.department.manage")` | [app/server/src/routes/console/people.ts:20](../../../app/server/src/routes/console/people.ts#L20) |
| `HEAD /api/console/summary` | `organization` | 自动 HEAD | `params`、`querystring` | 未声明 | `requireAuth`、`requireCapability("console.access")` | [app/server/src/routes/console/me.ts:27](../../../app/server/src/routes/console/me.ts#L27) |
| `HEAD /api/docs` | `public_content` | 自动 HEAD | `params`、`querystring` | 未声明 | 需查看 handler 与继承策略 | [app/server/src/routes/portal/docs.ts:16](../../../app/server/src/routes/portal/docs.ts#L16) |
| `HEAD /api/docs/:id` | `public_content` | 自动 HEAD | `params`、`querystring` | 未声明 | 需查看 handler 与继承策略 | [app/server/src/routes/portal/docs.ts:23](../../../app/server/src/routes/portal/docs.ts#L23) |
| `HEAD /api/feedback/categories` | `feedback` | 自动 HEAD | `params`、`querystring` | 未声明 | 需查看 handler 与继承策略 | [app/server/src/routes/portal/feedback.ts:24](../../../app/server/src/routes/portal/feedback.ts#L24) |
| `HEAD /api/feedback/public` | `feedback` | 自动 HEAD | `params`、`querystring` | 未声明 | 需查看 handler 与继承策略 | [app/server/src/routes/portal/feedback.ts:62](../../../app/server/src/routes/portal/feedback.ts#L62) |
| `HEAD /api/forum/avatars/:file` | `forum` | 自动 HEAD | `params`、`querystring` | 未声明 | 需查看 handler 与继承策略 | [app/server/src/routes/forum-api/people.ts:99](../../../app/server/src/routes/forum-api/people.ts#L99) |
| `HEAD /api/forum/state` | `forum` | 显式 | `params`、`querystring` | 未声明 | 需查看 handler 与继承策略 | [app/server/src/routes/forum-api/topics.ts:22](../../../app/server/src/routes/forum-api/topics.ts#L22) |
| `HEAD /api/join/:token` | `invitations` | 自动 HEAD | `params`、`querystring` | 未声明 | 需查看 handler 与继承策略 | [app/server/src/routes/portal/join.ts:52](../../../app/server/src/routes/portal/join.ts#L52) |
| `HEAD /api/me/competitions` | `competitions` | 自动 HEAD | `params`、`querystring` | 已挂载 | 需查看 handler 与继承策略 | [app/server/src/routes/portal/competition-signups.ts:38](../../../app/server/src/routes/portal/competition-signups.ts#L38) |
| `HEAD /api/me/orgs` | `github` | 自动 HEAD | `params`、`querystring` | 未声明 | `requireAuth` | [app/server/src/routes/admin/orgs.ts:10](../../../app/server/src/routes/admin/orgs.ts#L10) |
| `HEAD /api/public/competitions` | `competitions` | 自动 HEAD | `params`、`querystring` | 已挂载 | 需查看 handler 与继承策略 | [app/server/src/routes/portal/competitions.ts:10](../../../app/server/src/routes/portal/competitions.ts#L10) |
| `HEAD /api/public/config` | `platform` | 自动 HEAD | `params`、`querystring` | 未声明 | 需查看 handler 与继承策略 | [app/server/src/routes/portal/join.ts:47](../../../app/server/src/routes/portal/join.ts#L47) |
| `HEAD /api/public/org` | `organization` | 自动 HEAD | `params`、`querystring` | 未声明 | 需查看 handler 与继承策略 | [app/server/src/routes/portal/org.ts:11](../../../app/server/src/routes/portal/org.ts#L11) |
| `HEAD /auth/callback` | `identity` | 自动 HEAD | `params`、`querystring` | 未声明 | 需查看 handler 与继承策略 | [app/server/src/routes/admin/auth.ts:44](../../../app/server/src/routes/admin/auth.ts#L44) |
| `HEAD /auth/github` | `identity` | 自动 HEAD | `params`、`querystring` | 未声明 | 需查看 handler 与继承策略 | [app/server/src/routes/admin/auth.ts:37](../../../app/server/src/routes/admin/auth.ts#L37) |
| `HEAD /auth/me` | `identity` | 自动 HEAD | `params`、`querystring` | 未声明 | 需查看 handler 与继承策略 | [app/server/src/routes/admin/auth.ts:98](../../../app/server/src/routes/admin/auth.ts#L98) |
| `PATCH /api/admin/:org/feedback/:id` | `feedback` | 显式 | `params`、`querystring`、`body` | 未声明 | `requireAuth`、`requireOrgRole("admin")` | [app/server/src/routes/admin/feedback.ts:19](../../../app/server/src/routes/admin/feedback.ts#L19) |
| `PATCH /api/admin/:org/invite-links/:token` | `invitations` | 显式 | `params`、`querystring`、`body` | 未声明 | `requireAuth`、`requireOrgRole("admin")` | [app/server/src/routes/admin/invite-links.ts:60](../../../app/server/src/routes/admin/invite-links.ts#L60) |
| `PATCH /api/admin/:org/members/:login/role` | `github` | 显式 | `params`、`querystring`、`body` | 未声明 | `requireAuth`、`requireOrgRole("admin")` | [app/server/src/routes/admin/members.ts:40](../../../app/server/src/routes/admin/members.ts#L40) |
| `PATCH /api/admin/:org/org` | `github` | 显式 | `params`、`querystring`、`body` | 未声明 | `requireAuth`、`requireOrgRole("admin")` | [app/server/src/routes/admin/org.ts:30](../../../app/server/src/routes/admin/org.ts#L30) |
| `PATCH /api/admin/:org/repos/:repo/issues/:n` | `github` | 显式 | `params`、`querystring`、`body` | 未声明 | `requireAuth`、`requireOrgRole("member")` | [app/server/src/routes/admin/repos.ts:285](../../../app/server/src/routes/admin/repos.ts#L285) |
| `PATCH /api/console/applications/:application_id` | `recruitment` | 显式 | `params`、`querystring`、`body` | 未声明 | `requireAuth`、`requireCapability("applications.review")` | [app/server/src/routes/console/applications.ts:117](../../../app/server/src/routes/console/applications.ts#L117) |
| `PATCH /api/console/competitions/:competition_id` | `competitions` | 显式 | `params`、`querystring`、`body` | 已挂载 | `requireAuth` | [app/server/src/routes/console/competitions.ts:61](../../../app/server/src/routes/console/competitions.ts#L61) |
| `PATCH /api/console/departments/:department_id` | `organization` | 显式 | `params`、`querystring`、`body` | 已挂载 | `requireAuth` | [app/server/src/routes/console/departments.ts:47](../../../app/server/src/routes/console/departments.ts#L47) |
| `PATCH /api/console/feedback/:id` | `feedback` | 显式 | `params`、`querystring`、`body` | 未声明 | `requireAuth`、`requireCapability("feedback.manage")` | [app/server/src/routes/console/feedback.ts:18](../../../app/server/src/routes/console/feedback.ts#L18) |
| `PATCH /api/console/titles/:title_id` | `organization` | 显式 | `params`、`querystring`、`body` | 已挂载 | `requireAuth`、`requireCapability("roles.manage")` | [app/server/src/routes/console/titles.ts:17](../../../app/server/src/routes/console/titles.ts#L17) |
| `PATCH /api/forum/me/profile` | `forum` | 显式 | `params`、`querystring`、`body` | 未声明 | `requireMember(req)` | [app/server/src/routes/forum-api/people.ts:32](../../../app/server/src/routes/forum-api/people.ts#L32) |
| `PATCH /api/forum/posts/:post_id` | `forum` | 显式 | `params`、`querystring`、`body` | 未声明 | `requireMember(req)` | [app/server/src/routes/forum-api/posts.ts:78](../../../app/server/src/routes/forum-api/posts.ts#L78) |
| `POST /api/admin/:org/create-repo` | `github` | 显式 | `params`、`querystring`、`body` | 未声明 | `requireAuth`、`requireOrgRole("admin")` | [app/server/src/routes/admin/repos.ts:317](../../../app/server/src/routes/admin/repos.ts#L317) |
| `POST /api/admin/:org/invite-links` | `invitations` | 显式 | `params`、`querystring`、`body` | 未声明 | `requireAuth`、`requireOrgRole("admin")` | [app/server/src/routes/admin/invite-links.ts:28](../../../app/server/src/routes/admin/invite-links.ts#L28) |
| `POST /api/admin/:org/repos/:repo/issues/:n/comments` | `github` | 显式 | `params`、`querystring`、`body` | 未声明 | `requireAuth`、`requireOrgRole("member")` | [app/server/src/routes/admin/repos.ts:301](../../../app/server/src/routes/admin/repos.ts#L301) |
| `POST /api/admin/:org/teams` | `github` | 显式 | `params`、`querystring`、`body` | 未声明 | `requireAuth`、`requireOrgRole("admin")` | [app/server/src/routes/admin/teams.ts:28](../../../app/server/src/routes/admin/teams.ts#L28) |
| `POST /api/competitions/:id/signup` | `competitions` | 显式 | `params`、`querystring`、`body` | 已挂载 | 需查看 handler 与继承策略 | [app/server/src/routes/portal/competition-signups.ts:67](../../../app/server/src/routes/portal/competition-signups.ts#L67) |
| `POST /api/competitions/:id/teams` | `competitions` | 显式 | `params`、`querystring`、`body` | 已挂载 | 需查看 handler 与继承策略 | [app/server/src/routes/portal/competition-signups.ts:144](../../../app/server/src/routes/portal/competition-signups.ts#L144) |
| `POST /api/console/assignments` | `organization` | 显式 | `params`、`querystring`、`body` | 未声明 | `requireAuth`、`requireCapability("roles.manage", "roles.department.manage")` | [app/server/src/routes/console/assignments.ts:52](../../../app/server/src/routes/console/assignments.ts#L52) |
| `POST /api/console/competitions` | `competitions` | 显式 | `params`、`querystring`、`body` | 已挂载 | `requireAuth` | [app/server/src/routes/console/competitions.ts:39](../../../app/server/src/routes/console/competitions.ts#L39) |
| `POST /api/console/departments` | `organization` | 显式 | `params`、`querystring`、`body` | 已挂载 | `requireAuth` | [app/server/src/routes/console/departments.ts:37](../../../app/server/src/routes/console/departments.ts#L37) |
| `POST /api/feedback` | `feedback` | 显式 | `params`、`querystring`、`body` | 未声明 | 需查看 handler 与继承策略 | [app/server/src/routes/portal/feedback.ts:26](../../../app/server/src/routes/portal/feedback.ts#L26) |
| `POST /api/forum/notifications/:notification_id/read` | `forum` | 显式 | `params`、`querystring` | 未声明 | `requireMember(req)` | [app/server/src/routes/forum-api/people.ts:20](../../../app/server/src/routes/forum-api/people.ts#L20) |
| `POST /api/forum/notifications/read-all` | `forum` | 显式 | `params`、`querystring` | 未声明 | `requireMember(req)` | [app/server/src/routes/forum-api/people.ts:26](../../../app/server/src/routes/forum-api/people.ts#L26) |
| `POST /api/forum/posts` | `forum` | 显式 | `params`、`querystring`、`body` | 未声明 | `can(viewer, "forum.post.moderate")`、`forumViewer(req)` | [app/server/src/routes/forum-api/posts.ts:36](../../../app/server/src/routes/forum-api/posts.ts#L36) |
| `POST /api/forum/posts/:post_id/bookmark` | `forum` | 显式 | `params`、`querystring` | 未声明 | `requireMember(req)` | [app/server/src/routes/forum-api/posts.ts:109](../../../app/server/src/routes/forum-api/posts.ts#L109) |
| `POST /api/forum/posts/:post_id/like` | `forum` | 显式 | `params`、`querystring` | 未声明 | `requireMember(req)` | [app/server/src/routes/forum-api/posts.ts:101](../../../app/server/src/routes/forum-api/posts.ts#L101) |
| `POST /api/forum/topics` | `forum` | 显式 | `params`、`querystring`、`body` | 未声明 | `requireMember(req)` | [app/server/src/routes/forum-api/topics.ts:47](../../../app/server/src/routes/forum-api/topics.ts#L47) |
| `POST /api/forum/topics/:topic_id/close` | `forum` | 显式 | `params`、`querystring`、`body` | 未声明 | `can(viewer, capability)`、`requireMember(req)` | [app/server/src/routes/forum-api/topics.ts:67](../../../app/server/src/routes/forum-api/topics.ts#L67) |
| `POST /api/forum/topics/:topic_id/pin` | `forum` | 显式 | `params`、`querystring`、`body` | 未声明 | `can(viewer, capability)`、`requireMember(req)` | [app/server/src/routes/forum-api/topics.ts:67](../../../app/server/src/routes/forum-api/topics.ts#L67) |
| `POST /api/forum/topics/:topic_id/view` | `forum` | 显式 | `params`、`querystring` | 未声明 | 需查看 handler 与继承策略 | [app/server/src/routes/forum-api/topics.ts:80](../../../app/server/src/routes/forum-api/topics.ts#L80) |
| `POST /api/forum/users/:forum_user_id/follow` | `forum` | 显式 | `params`、`querystring` | 未声明 | `requireMember(req)` | [app/server/src/routes/forum-api/people.ts:11](../../../app/server/src/routes/forum-api/people.ts#L11) |
| `POST /api/join/:token` | `invitations` | 显式 | `params`、`querystring`、`body` | 未声明 | 需查看 handler 与继承策略 | [app/server/src/routes/portal/join.ts:67](../../../app/server/src/routes/portal/join.ts#L67) |
| `POST /api/portal/apply` | `recruitment` | 显式 | `params`、`querystring` | 未声明 | 需查看 handler 与继承策略 | [app/server/src/routes/portal/apply.ts:118](../../../app/server/src/routes/portal/apply.ts#L118) |
| `POST /api/teams/:id/apply` | `competitions` | 显式 | `params`、`querystring`、`body` | 已挂载 | 需查看 handler 与继承策略 | [app/server/src/routes/portal/competition-signups.ts:167](../../../app/server/src/routes/portal/competition-signups.ts#L167) |
| `POST /api/teams/:id/invite` | `competitions` | 显式 | `params`、`querystring`、`body` | 已挂载 | 需查看 handler 与继承策略 | [app/server/src/routes/portal/competition-signups.ts:189](../../../app/server/src/routes/portal/competition-signups.ts#L189) |
| `POST /api/teams/:id/leave` | `competitions` | 显式 | `params`、`querystring` | 已挂载 | 需查看 handler 与继承策略 | [app/server/src/routes/portal/competition-signups.ts:239](../../../app/server/src/routes/portal/competition-signups.ts#L239) |
| `POST /api/teams/:id/lock` | `competitions` | 显式 | `params`、`querystring` | 已挂载 | 需查看 handler 与继承策略 | [app/server/src/routes/portal/competition-signups.ts:304](../../../app/server/src/routes/portal/competition-signups.ts#L304) |
| `POST /api/teams/:id/respond` | `competitions` | 显式 | `params`、`querystring`、`body` | 已挂载 | 需查看 handler 与继承策略 | [app/server/src/routes/portal/competition-signups.ts:215](../../../app/server/src/routes/portal/competition-signups.ts#L215) |
| `POST /api/teams/:id/transfer` | `competitions` | 显式 | `params`、`querystring`、`body` | 已挂载 | 需查看 handler 与继承策略 | [app/server/src/routes/portal/competition-signups.ts:260](../../../app/server/src/routes/portal/competition-signups.ts#L260) |
| `POST /auth/signout` | `identity` | 显式 | `params`、`querystring` | 未声明 | 需查看 handler 与继承策略 | [app/server/src/routes/admin/auth.ts:81](../../../app/server/src/routes/admin/auth.ts#L81) |
| `PUT /api/admin/:org/repos/:repo/collaborators/:login` | `github` | 显式 | `params`、`querystring`、`body` | 未声明 | `requireAuth`、`requireOrgRole("admin")` | [app/server/src/routes/admin/repos.ts:352](../../../app/server/src/routes/admin/repos.ts#L352) |
| `PUT /api/admin/:org/repos/:repo/pulls/:n/merge` | `github` | 显式 | `params`、`querystring`、`body` | 未声明 | `requireAuth`、`requireOrgRole("member")` | [app/server/src/routes/admin/repos.ts:259](../../../app/server/src/routes/admin/repos.ts#L259) |
| `PUT /api/console/competitions/:competition_id/signup-settings` | `competitions` | 显式 | `params`、`querystring`、`body` | 已挂载 | 需查看 handler 与继承策略 | [app/server/src/routes/console/competition-roster.ts:30](../../../app/server/src/routes/console/competition-roster.ts#L30) |
| `PUT /api/forum/me/avatar` | `forum` | 显式 | `params`、`querystring` | 未声明 | `requireMember(req)` | [app/server/src/routes/forum-api/people.ts:80](../../../app/server/src/routes/forum-api/people.ts#L80) |

## 基础设施与占位

| 方法与路径 | 业务域 | 注册 | 请求 Schema | 响应 Schema | 授权检查证据 | 源码 |
|---|---|---|---|---|---|---|
| `GET /` | `platform` | 显式 | 未声明 | 未声明 | 需查看 handler 与继承策略 | [app/server/src/app.ts:102](../../../app/server/src/app.ts#L102) |
| `GET /forum` | `platform` | 显式 | 未声明 | 未声明 | 需查看 handler 与继承策略 | [app/server/src/app.ts:82](../../../app/server/src/app.ts#L82) |
| `GET /forum/*` | `platform` | 显式 | 未声明 | 未声明 | 需查看 handler 与继承策略 | [app/server/src/app.ts:82](../../../app/server/src/app.ts#L82) |
| `GET /healthz` | `platform` | 显式 | 未声明 | 未声明 | 需查看 handler 与继承策略 | [app/server/src/app.ts:88](../../../app/server/src/app.ts#L88) |
| `HEAD /` | `platform` | 自动 HEAD | 未声明 | 未声明 | 需查看 handler 与继承策略 | [app/server/src/app.ts:102](../../../app/server/src/app.ts#L102) |
| `HEAD /forum` | `platform` | 自动 HEAD | 未声明 | 未声明 | 需查看 handler 与继承策略 | [app/server/src/app.ts:82](../../../app/server/src/app.ts#L82) |
| `HEAD /forum/*` | `platform` | 自动 HEAD | 未声明 | 未声明 | 需查看 handler 与继承策略 | [app/server/src/app.ts:82](../../../app/server/src/app.ts#L82) |
| `HEAD /healthz` | `platform` | 自动 HEAD | 未声明 | 未声明 | 需查看 handler 与继承策略 | [app/server/src/app.ts:88](../../../app/server/src/app.ts#L88) |

## 退役兼容

| 方法与路径 | 业务域 | 注册 | 请求 Schema | 响应 Schema | 授权检查证据 | 源码 |
|---|---|---|---|---|---|---|
| `DELETE /api/forum` | `platform` | 显式 | 未声明 | 未声明 | 需查看 handler 与继承策略 | [app/server/src/app.ts:78](../../../app/server/src/app.ts#L78) |
| `DELETE /api/forum/*` | `platform` | 显式 | 未声明 | 未声明 | 需查看 handler 与继承策略 | [app/server/src/app.ts:78](../../../app/server/src/app.ts#L78) |
| `DELETE /auth/forum/*` | `platform` | 显式 | 未声明 | 未声明 | 需查看 handler 与继承策略 | [app/server/src/app.ts:78](../../../app/server/src/app.ts#L78) |
| `DELETE /forum/u/*` | `platform` | 显式 | 未声明 | 未声明 | 需查看 handler 与继承策略 | [app/server/src/app.ts:78](../../../app/server/src/app.ts#L78) |
| `GET /api/forum` | `platform` | 显式 | 未声明 | 未声明 | 需查看 handler 与继承策略 | [app/server/src/app.ts:78](../../../app/server/src/app.ts#L78) |
| `GET /api/forum/*` | `platform` | 显式 | 未声明 | 未声明 | 需查看 handler 与继承策略 | [app/server/src/app.ts:78](../../../app/server/src/app.ts#L78) |
| `GET /auth/forum/*` | `platform` | 显式 | 未声明 | 未声明 | 需查看 handler 与继承策略 | [app/server/src/app.ts:78](../../../app/server/src/app.ts#L78) |
| `GET /forum/u/*` | `platform` | 显式 | 未声明 | 未声明 | 需查看 handler 与继承策略 | [app/server/src/app.ts:78](../../../app/server/src/app.ts#L78) |
| `HEAD /api/forum` | `platform` | 自动 HEAD | 未声明 | 未声明 | 需查看 handler 与继承策略 | [app/server/src/app.ts:78](../../../app/server/src/app.ts#L78) |
| `HEAD /api/forum/*` | `platform` | 自动 HEAD | 未声明 | 未声明 | 需查看 handler 与继承策略 | [app/server/src/app.ts:78](../../../app/server/src/app.ts#L78) |
| `HEAD /auth/forum/*` | `platform` | 自动 HEAD | 未声明 | 未声明 | 需查看 handler 与继承策略 | [app/server/src/app.ts:78](../../../app/server/src/app.ts#L78) |
| `HEAD /forum/u/*` | `platform` | 自动 HEAD | 未声明 | 未声明 | 需查看 handler 与继承策略 | [app/server/src/app.ts:78](../../../app/server/src/app.ts#L78) |
| `OPTIONS /api/forum` | `platform` | 显式 | 未声明 | 未声明 | 需查看 handler 与继承策略 | [app/server/src/app.ts:78](../../../app/server/src/app.ts#L78) |
| `OPTIONS /api/forum/*` | `platform` | 显式 | 未声明 | 未声明 | 需查看 handler 与继承策略 | [app/server/src/app.ts:78](../../../app/server/src/app.ts#L78) |
| `OPTIONS /auth/forum/*` | `platform` | 显式 | 未声明 | 未声明 | 需查看 handler 与继承策略 | [app/server/src/app.ts:78](../../../app/server/src/app.ts#L78) |
| `OPTIONS /forum/u/*` | `platform` | 显式 | 未声明 | 未声明 | 需查看 handler 与继承策略 | [app/server/src/app.ts:78](../../../app/server/src/app.ts#L78) |
| `PATCH /api/forum` | `platform` | 显式 | 未声明 | 未声明 | 需查看 handler 与继承策略 | [app/server/src/app.ts:78](../../../app/server/src/app.ts#L78) |
| `PATCH /api/forum/*` | `platform` | 显式 | 未声明 | 未声明 | 需查看 handler 与继承策略 | [app/server/src/app.ts:78](../../../app/server/src/app.ts#L78) |
| `PATCH /auth/forum/*` | `platform` | 显式 | 未声明 | 未声明 | 需查看 handler 与继承策略 | [app/server/src/app.ts:78](../../../app/server/src/app.ts#L78) |
| `PATCH /forum/u/*` | `platform` | 显式 | 未声明 | 未声明 | 需查看 handler 与继承策略 | [app/server/src/app.ts:78](../../../app/server/src/app.ts#L78) |
| `POST /api/forum` | `platform` | 显式 | 未声明 | 未声明 | 需查看 handler 与继承策略 | [app/server/src/app.ts:78](../../../app/server/src/app.ts#L78) |
| `POST /api/forum/*` | `platform` | 显式 | 未声明 | 未声明 | 需查看 handler 与继承策略 | [app/server/src/app.ts:78](../../../app/server/src/app.ts#L78) |
| `POST /auth/forum/*` | `platform` | 显式 | 未声明 | 未声明 | 需查看 handler 与继承策略 | [app/server/src/app.ts:78](../../../app/server/src/app.ts#L78) |
| `POST /forum/u/*` | `platform` | 显式 | 未声明 | 未声明 | 需查看 handler 与继承策略 | [app/server/src/app.ts:78](../../../app/server/src/app.ts#L78) |
| `PUT /api/forum` | `platform` | 显式 | 未声明 | 未声明 | 需查看 handler 与继承策略 | [app/server/src/app.ts:78](../../../app/server/src/app.ts#L78) |
| `PUT /api/forum/*` | `platform` | 显式 | 未声明 | 未声明 | 需查看 handler 与继承策略 | [app/server/src/app.ts:78](../../../app/server/src/app.ts#L78) |
| `PUT /auth/forum/*` | `platform` | 显式 | 未声明 | 未声明 | 需查看 handler 与继承策略 | [app/server/src/app.ts:78](../../../app/server/src/app.ts#L78) |
| `PUT /forum/u/*` | `platform` | 显式 | 未声明 | 未声明 | 需查看 handler 与继承策略 | [app/server/src/app.ts:78](../../../app/server/src/app.ts#L78) |

## 核心之外：Nitro 与预渲染入口

以下是源码声明核对，不是本次运行时观测。路径相对于论坛应用，实际挂载前缀由论坛配置决定；没有启动 Nitro 或读取本机快照。静态文件与 SPA 回落不逐文件枚举。

| 方法与路径 | 范围 | 说明 | 源码 |
|---|---|---|---|
| `GET /__geek_forum` | `development-only` | 本机进程标记，不是业务 API 或认证；import.meta.dev 之外返回 404。 | [app/forum/server/routes/__geek_forum.get.ts:4](../../../app/forum/server/routes/__geek_forum.get.ts#L4) |
| `GET/HEAD /api/local-forum/state` | `development-only` | 只读快照；requireSnapshotRoute 检查开发态、配置和方法；本工具不读取快照。 | [app/forum/server/routes/api/local-forum/state.ts:13](../../../app/forum/server/routes/api/local-forum/state.ts#L13) |
| `GET/HEAD /api/local-forum/assets/:hash` | `development-only` | 按哈希白名单提供只读快照附件及单段 Range；本工具不读取附件。 | [app/forum/server/routes/api/local-forum/assets/[hash].ts:15](../../../app/forum/server/routes/api/local-forum/assets/[hash].ts#L15) |
| `GET/HEAD /llms.txt` | `nitro-and-prerender` | 论坛应用相对路径；Nitro 中间件提供，静态镜像使用预渲染文件，不代表动态读取当前核心论坛数据库。 | [app/forum/server/middleware/forum-markdown.ts:36](../../../app/forum/server/middleware/forum-markdown.ts#L36) |
| `GET/HEAD /t/:id.md` | `nitro-and-prerender` | 论坛应用相对路径；源码匹配的 Markdown 视图，部署时可用文件取决于构建时预渲染内容。 | [app/forum/server/middleware/forum-markdown.ts:26](../../../app/forum/server/middleware/forum-markdown.ts#L26) |

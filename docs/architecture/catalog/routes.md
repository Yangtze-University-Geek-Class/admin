# 后端接口目录

> 真实 Fastify 注册的方法、路径、Schema 与源码位置；含根路由、嵌套插件、循环注册及自动 HEAD。

状态：`current` · 更新：2026-10-30 · 自动生成，不手工编辑。

来源摘要：`ac482727a4443d71b3a7c42f2440a8ea9ff0b7dc298f27f9e16b5cdb82a27a94`。更新日期指目录声明版本，数据新鲜度由摘要和 `pnpm check:catalog` 核对。

[使用与维护](README.md) · [总览](CATALOG.md) · [接口](routes.md) · [数据](data-model.md) · [权限](permissions.md) · [机器目录](catalog.json)

[接口行为契约](../../services/server/endpoint-contracts.md)按方法和路径说明成功响应、失败、资源授权及副作用；[业务流程](CATALOG.md#业务流程)关联数据库读写，地图中可沿接口与流程互相跳转。

Schema 完整内容在机器目录；这里的授权项只是源码检查证据，不是完整策略。没有直接检查不能解释为匿名可用。数据库、外部 HTTP 和发信均使用隔离配置，没有监听端口。

## 业务与认证

| 方法与路径 | 业务域 | 注册 | 请求 Schema | 响应 Schema | 授权检查证据 | 源码 |
|---|---|---|---|---|---|---|
| `DELETE /api/competitions/:id/signup` | `competitions` | 显式 | `params`、`querystring` | 已挂载 | 需查看 handler 与继承策略 | [app/server/src/routes/portal/competition-signups.ts:58](../../../app/server/src/routes/portal/competition-signups.ts#L58) |
| `DELETE /api/console/competitions/:competition_id` | `competitions` | 显式 | `params`、`querystring` | 已挂载 | `requireAuth` | [app/server/src/routes/console/competitions.ts:93](../../../app/server/src/routes/console/competitions.ts#L93) |
| `DELETE /api/console/competitions/:competition_id/final` | `competitions` | 显式 | `params`、`querystring` | 已挂载 | `requireAuth` | [app/server/src/routes/console/competition-results.ts:144](../../../app/server/src/routes/console/competition-results.ts#L144) |
| `DELETE /api/console/competitions/:competition_id/signups/:account_id` | `competitions` | 显式 | `params`、`querystring` | 已挂载 | `requireAuth` | [app/server/src/routes/console/competition-roster.ts:69](../../../app/server/src/routes/console/competition-roster.ts#L69) |
| `DELETE /api/console/competitions/:competition_id/site` | `competitions` | 显式 | `params`、`querystring` | 已挂载 | `requireAuth` | [app/server/src/routes/console/competition-site.ts:110](../../../app/server/src/routes/console/competition-site.ts#L110) |
| `DELETE /api/console/feedback/:id` | `feedback` | 显式 | `params`、`querystring` | 未声明 | `requireAuth` | [app/server/src/routes/console/feedback.ts:31](../../../app/server/src/routes/console/feedback.ts#L31) |
| `DELETE /api/console/mail-templates/:template_id` | `mail` | 显式 | `params`、`querystring` | 已挂载 | `requireAuth` | [app/server/src/routes/console/mail-templates.ts:202](../../../app/server/src/routes/console/mail-templates.ts#L202) |
| `DELETE /api/console/permission-groups/:id` | `permissions` | 显式 | `params`、`querystring` | 已挂载 | 需查看 handler 与继承策略 | [app/server/src/routes/console/permission-groups.ts:210](../../../app/server/src/routes/console/permission-groups.ts#L210) |
| `DELETE /api/console/permission-groups/:id/members/:account_id` | `permissions` | 显式 | `params`、`querystring` | 已挂载 | 需查看 handler 与继承策略 | [app/server/src/routes/console/permission-groups.ts:273](../../../app/server/src/routes/console/permission-groups.ts#L273) |
| `DELETE /api/console/security/blocks/:ip` | `platform` | 显式 | `params`、`querystring` | 已挂载 | `requireAuth` | [app/server/src/routes/console/security.ts:37](../../../app/server/src/routes/console/security.ts#L37) |
| `DELETE /api/forum/me/avatar` | `forum` | 显式 | `params`、`querystring` | 未声明 | `requireMember(req)` | [app/server/src/routes/forum-api/people.ts:111](../../../app/server/src/routes/forum-api/people.ts#L111) |
| `DELETE /api/forum/posts/:post_id` | `forum` | 显式 | `params`、`querystring` | 未声明 | `requireMember(req)` | [app/server/src/routes/forum-api/posts.ts:80](../../../app/server/src/routes/forum-api/posts.ts#L80) |
| `DELETE /api/forum/posts/:post_id/reactions/:sticker_id` | `forum` | 显式 | `params`、`querystring` | 已挂载 | 需查看 handler 与继承策略 | [app/server/src/routes/forum-api/posts.ts:120](../../../app/server/src/routes/forum-api/posts.ts#L120) |
| `DELETE /api/teams/:id` | `competitions` | 显式 | `params`、`querystring` | 已挂载 | 需查看 handler 与继承策略 | [app/server/src/routes/portal/competition-signups.ts:101](../../../app/server/src/routes/portal/competition-signups.ts#L101) |
| `DELETE /api/teams/:id/lock` | `competitions` | 显式 | `params`、`querystring` | 已挂载 | 需查看 handler 与继承策略 | [app/server/src/routes/portal/competition-signups.ts:107](../../../app/server/src/routes/portal/competition-signups.ts#L107) |
| `DELETE /api/teams/:id/plaza` | `competitions` | 显式 | `params`、`querystring` | 已挂载 | 需查看 handler 与继承策略 | [app/server/src/routes/portal/competition-signups.ts:116](../../../app/server/src/routes/portal/competition-signups.ts#L116) |
| `GET /api/competitions/:id/free-agents` | `competitions` | 显式 | `params`、`querystring` | 已挂载 | 需查看 handler 与继承策略 | [app/server/src/routes/portal/competition-signups.ts:66](../../../app/server/src/routes/portal/competition-signups.ts#L66) |
| `GET /api/competitions/:id/leaderboard` | `competitions` | 显式 | `params`、`querystring` | 已挂载 | 需查看 handler 与继承策略 | [app/server/src/routes/portal/competition-signups.ts:128](../../../app/server/src/routes/portal/competition-signups.ts#L128) |
| `GET /api/competitions/:id/my-status` | `competitions` | 显式 | `params`、`querystring` | 已挂载 | 需查看 handler 与继承策略 | [app/server/src/routes/portal/competition-signups.ts:48](../../../app/server/src/routes/portal/competition-signups.ts#L48) |
| `GET /api/competitions/:id/teams` | `competitions` | 显式 | `params`、`querystring` | 已挂载 | 需查看 handler 与继承策略 | [app/server/src/routes/portal/competition-signups.ts:61](../../../app/server/src/routes/portal/competition-signups.ts#L61) |
| `GET /api/console/accounts/:id/activity` | `audit` | 显式 | `params`、`querystring` | 已挂载 | `requireAuth` | [app/server/src/routes/console/activity.ts:119](../../../app/server/src/routes/console/activity.ts#L119) |
| `GET /api/console/accounts/:id/effective` | `permissions` | 显式 | `params`、`querystring` | 已挂载 | 需查看 handler 与继承策略 | [app/server/src/routes/console/accounts.ts:12](../../../app/server/src/routes/console/accounts.ts#L12) |
| `GET /api/console/activity` | `audit` | 显式 | `params`、`querystring` | 已挂载 | `requireAuth` | [app/server/src/routes/console/activity.ts:89](../../../app/server/src/routes/console/activity.ts#L89) |
| `GET /api/console/activity.csv` | `audit` | 显式 | `params`、`querystring` | 已挂载 | `requireAuth` | [app/server/src/routes/console/activity.ts:105](../../../app/server/src/routes/console/activity.ts#L105) |
| `GET /api/console/applications` | `recruitment` | 显式 | `params`、`querystring` | 未声明 | `requireAuth` | [app/server/src/routes/console/applications.ts:46](../../../app/server/src/routes/console/applications.ts#L46) |
| `GET /api/console/applications/:application_id` | `recruitment` | 显式 | `params`、`querystring` | 未声明 | `requireAuth` | [app/server/src/routes/console/applications.ts:137](../../../app/server/src/routes/console/applications.ts#L137) |
| `GET /api/console/applications/export.csv` | `recruitment` | 显式 | `params`、`querystring` | 未声明 | `requireAuth` | [app/server/src/routes/console/applications.ts:95](../../../app/server/src/routes/console/applications.ts#L95) |
| `GET /api/console/applications/settings` | `recruitment` | 显式 | `params`、`querystring` | 已挂载 | `requireAuth` | [app/server/src/routes/console/applications.ts:77](../../../app/server/src/routes/console/applications.ts#L77) |
| `GET /api/console/backup` | `platform` | 显式 | `params`、`querystring` | 已挂载 | `requireAuth` | [app/server/src/routes/console/backup.ts:33](../../../app/server/src/routes/console/backup.ts#L33) |
| `GET /api/console/competitions` | `competitions` | 显式 | `params`、`querystring` | 已挂载 | `requireAuth` | [app/server/src/routes/console/competitions.ts:38](../../../app/server/src/routes/console/competitions.ts#L38) |
| `GET /api/console/competitions/:competition_id/candidates` | `competitions` | 显式 | `params`、`querystring` | 已挂载 | `requireAuth` | [app/server/src/routes/console/competition-candidates.ts:30](../../../app/server/src/routes/console/competition-candidates.ts#L30) |
| `GET /api/console/competitions/:competition_id/final` | `competitions` | 显式 | `params`、`querystring` | 已挂载 | `requireAuth` | [app/server/src/routes/console/competition-results.ts:115](../../../app/server/src/routes/console/competition-results.ts#L115) |
| `GET /api/console/competitions/:competition_id/roster` | `competitions` | 显式 | `params`、`querystring` | 已挂载 | `requireAuth` | [app/server/src/routes/console/competition-roster.ts:59](../../../app/server/src/routes/console/competition-roster.ts#L59) |
| `GET /api/console/competitions/:competition_id/roster.csv` | `competitions` | 显式 | `params`、`querystring` | 已挂载 | `requireAuth` | [app/server/src/routes/console/competition-roster.ts:90](../../../app/server/src/routes/console/competition-roster.ts#L90) |
| `GET /api/console/competitions/:competition_id/rules` | `competitions` | 显式 | `params`、`querystring` | 已挂载 | `requireAuth` | [app/server/src/routes/console/competition-results.ts:83](../../../app/server/src/routes/console/competition-results.ts#L83) |
| `GET /api/console/competitions/:competition_id/score-events` | `competitions` | 显式 | `params`、`querystring` | 已挂载 | `requireAuth` | [app/server/src/routes/console/competition-roster.ts:115](../../../app/server/src/routes/console/competition-roster.ts#L115) |
| `GET /api/console/competitions/:competition_id/score-preview` | `competitions` | 显式 | `params`、`querystring` | 已挂载 | `requireAuth` | [app/server/src/routes/console/competition-roster.ts:125](../../../app/server/src/routes/console/competition-roster.ts#L125) |
| `GET /api/console/competitions/:competition_id/site` | `competitions` | 显式 | `params`、`querystring` | 已挂载 | `requireAuth` | [app/server/src/routes/console/competition-site.ts:52](../../../app/server/src/routes/console/competition-site.ts#L52) |
| `GET /api/console/feedback` | `feedback` | 显式 | `params`、`querystring` | 未声明 | `requireAuth` | [app/server/src/routes/console/feedback.ts:12](../../../app/server/src/routes/console/feedback.ts#L12) |
| `GET /api/console/forum/categories` | `forum` | 显式 | `params`、`querystring` | 已挂载 | `requireAuth` | [app/server/src/routes/console/forum.ts:18](../../../app/server/src/routes/console/forum.ts#L18) |
| `GET /api/console/forum/stickers` | `forum` | 显式 | `params`、`querystring` | 已挂载 | `requireAuth` | [app/server/src/routes/console/forum.ts:36](../../../app/server/src/routes/console/forum.ts#L36) |
| `GET /api/console/gitlab/accounts` | `gitlab` | 显式 | `params`、`querystring` | 已挂载 | `requireAuth` | [app/server/src/routes/console/gitlab.ts:19](../../../app/server/src/routes/console/gitlab.ts#L19) |
| `GET /api/console/gitlab/projects` | `gitlab` | 显式 | `params`、`querystring` | 已挂载 | `requireAuth` | [app/server/src/routes/console/gitlab.ts:41](../../../app/server/src/routes/console/gitlab.ts#L41) |
| `GET /api/console/gitlab/settings` | `gitlab` | 显式 | `params`、`querystring` | 已挂载 | `requireAuth` | [app/server/src/routes/console/gitlab.ts:43](../../../app/server/src/routes/console/gitlab.ts#L43) |
| `GET /api/console/gitlab/status` | `gitlab` | 显式 | `params`、`querystring` | 已挂载 | `requireAuth` | [app/server/src/routes/console/gitlab.ts:32](../../../app/server/src/routes/console/gitlab.ts#L32) |
| `GET /api/console/invites` | `identity` | 显式 | `params`、`querystring` | 已挂载 | `requireAuth` | [app/server/src/routes/console/invites.ts:17](../../../app/server/src/routes/console/invites.ts#L17) |
| `GET /api/console/mail-templates` | `mail` | 显式 | `params`、`querystring` | 已挂载 | `requireAuth` | [app/server/src/routes/console/mail-templates.ts:133](../../../app/server/src/routes/console/mail-templates.ts#L133) |
| `GET /api/console/me` | `organization` | 显式 | `params`、`querystring` | 已挂载 | `requireAuth` | [app/server/src/routes/console/me.ts:29](../../../app/server/src/routes/console/me.ts#L29) |
| `GET /api/console/permission-groups` | `permissions` | 显式 | `params`、`querystring` | 已挂载 | 需查看 handler 与继承策略 | [app/server/src/routes/console/permission-groups.ts:109](../../../app/server/src/routes/console/permission-groups.ts#L109) |
| `GET /api/console/permission-groups/:id/members` | `permissions` | 显式 | `params`、`querystring` | 已挂载 | 需查看 handler 与继承策略 | [app/server/src/routes/console/permission-groups.ts:226](../../../app/server/src/routes/console/permission-groups.ts#L226) |
| `GET /api/console/permissions/explain` | `permissions` | 显式 | `params`、`querystring` | 已挂载 | 需查看 handler 与继承策略 | [app/server/src/routes/console/permissions.ts:20](../../../app/server/src/routes/console/permissions.ts#L20) |
| `GET /api/console/permissions/nodes` | `permissions` | 显式 | `params`、`querystring` | 已挂载 | 需查看 handler 与继承策略 | [app/server/src/routes/console/permissions.ts:15](../../../app/server/src/routes/console/permissions.ts#L15) |
| `GET /api/console/security/blocks` | `platform` | 显式 | `params`、`querystring` | 已挂载 | `requireAuth` | [app/server/src/routes/console/security.ts:31](../../../app/server/src/routes/console/security.ts#L31) |
| `GET /api/console/security/decoy` | `platform` | 显式 | `params`、`querystring` | 已挂载 | `requireAuth` | [app/server/src/routes/console/security.ts:18](../../../app/server/src/routes/console/security.ts#L18) |
| `GET /api/console/summary` | `organization` | 显式 | `params`、`querystring` | 已挂载 | `requireAuth` | [app/server/src/routes/console/me.ts:60](../../../app/server/src/routes/console/me.ts#L60) |
| `GET /api/console/users` | `permissions` | 显式 | `params`、`querystring` | 已挂载 | 需查看 handler 与继承策略 | [app/server/src/routes/console/users.ts:118](../../../app/server/src/routes/console/users.ts#L118) |
| `GET /api/docs` | `public_content` | 显式 | `params`、`querystring` | 未声明 | 需查看 handler 与继承策略 | [app/server/src/routes/portal/docs.ts:16](../../../app/server/src/routes/portal/docs.ts#L16) |
| `GET /api/docs/:id` | `public_content` | 显式 | `params`、`querystring` | 未声明 | 需查看 handler 与继承策略 | [app/server/src/routes/portal/docs.ts:23](../../../app/server/src/routes/portal/docs.ts#L23) |
| `GET /api/feedback/categories` | `feedback` | 显式 | `params`、`querystring` | 未声明 | 需查看 handler 与继承策略 | [app/server/src/routes/portal/feedback.ts:25](../../../app/server/src/routes/portal/feedback.ts#L25) |
| `GET /api/feedback/public` | `feedback` | 显式 | `params`、`querystring` | 未声明 | 需查看 handler 与继承策略 | [app/server/src/routes/portal/feedback.ts:74](../../../app/server/src/routes/portal/feedback.ts#L74) |
| `GET /api/forum/avatars/:file` | `forum` | 显式 | `params`、`querystring` | 未声明 | 需查看 handler 与继承策略 | [app/server/src/routes/forum-api/people.ts:119](../../../app/server/src/routes/forum-api/people.ts#L119) |
| `GET /api/forum/search` | `forum` | 显式 | `params`、`querystring` | 未声明 | `forumViewer(req)` | [app/server/src/routes/forum-api/topics.ts:50](../../../app/server/src/routes/forum-api/topics.ts#L50) |
| `GET /api/forum/state` | `forum` | 显式 | `params`、`querystring` | 未声明 | `forumViewer(req)` | [app/server/src/routes/forum-api/topics.ts:22](../../../app/server/src/routes/forum-api/topics.ts#L22) |
| `GET /api/forum/stickers` | `forum` | 显式 | `params`、`querystring` | 已挂载 | 需查看 handler 与继承策略 | [app/server/src/routes/forum-api/stickers.ts:11](../../../app/server/src/routes/forum-api/stickers.ts#L11) |
| `GET /api/forum/stickers/:file` | `forum` | 显式 | `params`、`querystring` | 已挂载 | 需查看 handler 与继承策略 | [app/server/src/routes/forum-api/stickers.ts:13](../../../app/server/src/routes/forum-api/stickers.ts#L13) |
| `GET /api/forum/topics` | `forum` | 显式 | `params`、`querystring` | 已挂载 | `forumViewer(req)` | [app/server/src/routes/forum-api/topics.ts:67](../../../app/server/src/routes/forum-api/topics.ts#L67) |
| `GET /api/forum/topics/:topic_id/posts` | `forum` | 显式 | `params`、`querystring` | 未声明 | `forumViewer(req)` | [app/server/src/routes/forum-api/topics.ts:34](../../../app/server/src/routes/forum-api/topics.ts#L34) |
| `GET /api/forum/uploads/:file` | `forum` | 显式 | `params`、`querystring` | 已挂载 | 需查看 handler 与继承策略 | [app/server/src/routes/forum-api/uploads.ts:74](../../../app/server/src/routes/forum-api/uploads.ts#L74) |
| `GET /api/forum/users/suggest` | `forum` | 显式 | `params`、`querystring` | 已挂载 | `requireMember(req)` | [app/server/src/routes/forum-api/people.ts:13](../../../app/server/src/routes/forum-api/people.ts#L13) |
| `GET /api/identity/avatar/:file` | `identity` | 显式 | `params`、`querystring` | 已挂载 | 需查看 handler 与继承策略 | [app/server/src/routes/identity/profile.ts:52](../../../app/server/src/routes/identity/profile.ts#L52) |
| `GET /api/identity/default-avatar/:version/:file` | `identity` | 显式 | `params`、`querystring` | 已挂载 | 需查看 handler 与继承策略 | [app/server/src/routes/identity/profile.ts:68](../../../app/server/src/routes/identity/profile.ts#L68) |
| `GET /api/identity/device` | `identity` | 显式 | `params`、`querystring` | 已挂载 | 需查看 handler 与继承策略 | [app/server/src/routes/identity/device.ts:100](../../../app/server/src/routes/identity/device.ts#L100) |
| `GET /api/identity/me` | `identity` | 显式 | `params`、`querystring` | 已挂载 | 需查看 handler 与继承策略 | [app/server/src/routes/identity/account.ts:49](../../../app/server/src/routes/identity/account.ts#L49) |
| `GET /api/identity/profile` | `identity` | 显式 | `params`、`querystring` | 已挂载 | 需查看 handler 与继承策略 | [app/server/src/routes/identity/profile.ts:25](../../../app/server/src/routes/identity/profile.ts#L25) |
| `GET /api/me/applications` | `recruitment` | 显式 | `params`、`querystring` | 已挂载 | 需查看 handler 与继承策略 | [app/server/src/routes/portal/my-applications.ts:18](../../../app/server/src/routes/portal/my-applications.ts#L18) |
| `GET /api/me/competition-results` | `competitions` | 显式 | `params`、`querystring` | 已挂载 | 需查看 handler 与继承策略 | [app/server/src/routes/portal/competition-signups.ts:46](../../../app/server/src/routes/portal/competition-signups.ts#L46) |
| `GET /api/me/competitions` | `competitions` | 显式 | `params`、`querystring` | 已挂载 | 需查看 handler 与继承策略 | [app/server/src/routes/portal/competition-signups.ts:43](../../../app/server/src/routes/portal/competition-signups.ts#L43) |
| `GET /api/me/gitlab/projects` | `gitlab` | 显式 | `params`、`querystring` | 已挂载 | 需查看 handler 与继承策略 | [app/server/src/routes/portal/gitlab.ts:29](../../../app/server/src/routes/portal/gitlab.ts#L29) |
| `GET /api/public/competitions` | `competitions` | 显式 | `params`、`querystring` | 已挂载 | 需查看 handler 与继承策略 | [app/server/src/routes/portal/competitions.ts:18](../../../app/server/src/routes/portal/competitions.ts#L18) |
| `GET /api/public/competitions/:id` | `competitions` | 显式 | `params`、`querystring` | 已挂载 | 需查看 handler 与继承策略 | [app/server/src/routes/portal/competitions.ts:51](../../../app/server/src/routes/portal/competitions.ts#L51) |
| `GET /api/public/competitions/:id/feed` | `competitions` | 显式 | `params`、`querystring` | 已挂载 | 需查看 handler 与继承策略 | [app/server/src/routes/portal/competitions.ts:64](../../../app/server/src/routes/portal/competitions.ts#L64) |
| `GET /api/public/competitions/:id/leaderboard` | `competitions` | 显式 | `params`、`querystring` | 已挂载 | 需查看 handler 与继承策略 | [app/server/src/routes/portal/competitions.ts:58](../../../app/server/src/routes/portal/competitions.ts#L58) |
| `GET /api/public/competitions/:id/participants` | `competitions` | 显式 | `params`、`querystring` | 已挂载 | 需查看 handler 与继承策略 | [app/server/src/routes/portal/competitions.ts:80](../../../app/server/src/routes/portal/competitions.ts#L80) |
| `GET /api/public/competitions/:id/snapshot` | `competitions` | 显式 | `params`、`querystring` | 已挂载 | 需查看 handler 与继承策略 | [app/server/src/routes/portal/competitions.ts:96](../../../app/server/src/routes/portal/competitions.ts#L96) |
| `GET /api/public/competitions/:id/stats` | `competitions` | 显式 | `params`、`querystring` | 已挂载 | 需查看 handler 与继承策略 | [app/server/src/routes/portal/competitions.ts:73](../../../app/server/src/routes/portal/competitions.ts#L73) |
| `GET /api/public/competitions/:id/teams` | `competitions` | 显式 | `params`、`querystring` | 已挂载 | 需查看 handler 与继承策略 | [app/server/src/routes/portal/competitions.ts:89](../../../app/server/src/routes/portal/competitions.ts#L89) |
| `GET /api/public/config` | `platform` | 显式 | `params`、`querystring` | 未声明 | 需查看 handler 与继承策略 | [app/server/src/routes/portal/public-config.ts:17](../../../app/server/src/routes/portal/public-config.ts#L17) |
| `GET /api/public/departments` | `identity` | 显式 | `params`、`querystring` | 已挂载 | 需查看 handler 与继承策略 | [app/server/src/routes/portal/departments.ts:18](../../../app/server/src/routes/portal/departments.ts#L18) |
| `GET /api/public/gitlab` | `gitlab` | 显式 | `params`、`querystring` | 已挂载 | 需查看 handler 与继承策略 | [app/server/src/routes/portal/gitlab.ts:14](../../../app/server/src/routes/portal/gitlab.ts#L14) |
| `GET /api/public/gitlab/projects` | `gitlab` | 显式 | `params`、`querystring` | 已挂载 | 需查看 handler 与继承策略 | [app/server/src/routes/portal/gitlab.ts:19](../../../app/server/src/routes/portal/gitlab.ts#L19) |
| `GET /api/team-plaza` | `competitions` | 显式 | `params`、`querystring` | 已挂载 | 需查看 handler 与继承策略 | [app/server/src/routes/portal/competition-signups.ts:120](../../../app/server/src/routes/portal/competition-signups.ts#L120) |
| `GET /auth/callback` | `identity` | 显式 | `params`、`querystring` | 未声明 | 需查看 handler 与继承策略 | [app/server/src/routes/admin/auth.ts:45](../../../app/server/src/routes/admin/auth.ts#L45) |
| `GET /auth/device/userinfo` | `identity` | 显式 | `params`、`querystring` | 已挂载 | 需查看 handler 与继承策略 | [app/server/src/routes/identity/device.ts:148](../../../app/server/src/routes/identity/device.ts#L148) |
| `GET /auth/github` | `identity` | 显式 | `params`、`querystring` | 未声明 | 需查看 handler 与继承策略 | [app/server/src/routes/admin/auth.ts:37](../../../app/server/src/routes/admin/auth.ts#L37) |
| `GET /auth/google` | `identity` | 显式 | `params`、`querystring` | 已挂载 | 需查看 handler 与继承策略 | [app/server/src/routes/identity/google.ts:29](../../../app/server/src/routes/identity/google.ts#L29) |
| `GET /auth/google/callback` | `identity` | 显式 | `params`、`querystring` | 已挂载 | 需查看 handler 与继承策略 | [app/server/src/routes/identity/google.ts:62](../../../app/server/src/routes/identity/google.ts#L62) |
| `GET /auth/me` | `identity` | 显式 | `params`、`querystring` | 未声明 | 需查看 handler 与继承策略 | [app/server/src/routes/admin/auth.ts:159](../../../app/server/src/routes/admin/auth.ts#L159) |
| `GET /auth/providers` | `identity` | 显式 | `params`、`querystring` | 已挂载 | 需查看 handler 与继承策略 | [app/server/src/routes/identity/providers.ts:30](../../../app/server/src/routes/identity/providers.ts#L30) |
| `GET /c/:slug` | `competitions` | 显式 | 未声明 | 已挂载 | 需查看 handler 与继承策略 | [app/server/src/routes/sites/index.ts:74](../../../app/server/src/routes/sites/index.ts#L74) |
| `GET /c/:slug/*` | `competitions` | 显式 | 未声明 | 已挂载 | 需查看 handler 与继承策略 | [app/server/src/routes/sites/index.ts:76](../../../app/server/src/routes/sites/index.ts#L76) |
| `GET /forum/llms.txt` | `forum` | 显式 | `params`、`querystring` | 已挂载 | `forumViewer(req)` | [app/server/src/routes/forum-api/markdown.ts:32](../../../app/server/src/routes/forum-api/markdown.ts#L32) |
| `GET /forum/published/:file` | `forum` | 显式 | `params`、`querystring` | 已挂载 | `forumViewer(req)` | [app/server/src/routes/forum-api/markdown.ts:52](../../../app/server/src/routes/forum-api/markdown.ts#L52) |
| `GET /forum/t/:topic_id.md` | `forum` | 显式 | `params`、`querystring` | 已挂载 | `forumViewer(req)` | [app/server/src/routes/forum-api/markdown.ts:39](../../../app/server/src/routes/forum-api/markdown.ts#L39) |
| `GET /oidc/*` | `identity` | 显式 | 未声明 | 已挂载 | 需查看 handler 与继承策略 | [app/server/src/routes/oidc/index.ts:169](../../../app/server/src/routes/oidc/index.ts#L169) |
| `GET /oidc/interaction/:uid` | `identity` | 显式 | `params`、`querystring` | 已挂载 | 需查看 handler 与继承策略 | [app/server/src/routes/oidc/index.ts:70](../../../app/server/src/routes/oidc/index.ts#L70) |
| `GET /oidc/interaction/:uid/details` | `identity` | 显式 | `params`、`querystring` | 已挂载 | 需查看 handler 与继承策略 | [app/server/src/routes/oidc/index.ts:119](../../../app/server/src/routes/oidc/index.ts#L119) |
| `HEAD /api/competitions/:id/free-agents` | `competitions` | 自动 HEAD | `params`、`querystring` | 未声明 | 需查看 handler 与继承策略 | [app/server/src/routes/portal/competition-signups.ts:66](../../../app/server/src/routes/portal/competition-signups.ts#L66) |
| `HEAD /api/competitions/:id/leaderboard` | `competitions` | 自动 HEAD | `params`、`querystring` | 未声明 | 需查看 handler 与继承策略 | [app/server/src/routes/portal/competition-signups.ts:128](../../../app/server/src/routes/portal/competition-signups.ts#L128) |
| `HEAD /api/competitions/:id/my-status` | `competitions` | 自动 HEAD | `params`、`querystring` | 未声明 | 需查看 handler 与继承策略 | [app/server/src/routes/portal/competition-signups.ts:48](../../../app/server/src/routes/portal/competition-signups.ts#L48) |
| `HEAD /api/competitions/:id/teams` | `competitions` | 自动 HEAD | `params`、`querystring` | 未声明 | 需查看 handler 与继承策略 | [app/server/src/routes/portal/competition-signups.ts:61](../../../app/server/src/routes/portal/competition-signups.ts#L61) |
| `HEAD /api/console/accounts/:id/activity` | `audit` | 自动 HEAD | `params`、`querystring` | 未声明 | `requireAuth` | [app/server/src/routes/console/activity.ts:119](../../../app/server/src/routes/console/activity.ts#L119) |
| `HEAD /api/console/accounts/:id/effective` | `permissions` | 自动 HEAD | `params`、`querystring` | 未声明 | 需查看 handler 与继承策略 | [app/server/src/routes/console/accounts.ts:12](../../../app/server/src/routes/console/accounts.ts#L12) |
| `HEAD /api/console/activity` | `audit` | 自动 HEAD | `params`、`querystring` | 未声明 | `requireAuth` | [app/server/src/routes/console/activity.ts:89](../../../app/server/src/routes/console/activity.ts#L89) |
| `HEAD /api/console/activity.csv` | `audit` | 自动 HEAD | `params`、`querystring` | 未声明 | `requireAuth` | [app/server/src/routes/console/activity.ts:105](../../../app/server/src/routes/console/activity.ts#L105) |
| `HEAD /api/console/applications` | `recruitment` | 自动 HEAD | `params`、`querystring` | 未声明 | `requireAuth` | [app/server/src/routes/console/applications.ts:46](../../../app/server/src/routes/console/applications.ts#L46) |
| `HEAD /api/console/applications/:application_id` | `recruitment` | 自动 HEAD | `params`、`querystring` | 未声明 | `requireAuth` | [app/server/src/routes/console/applications.ts:137](../../../app/server/src/routes/console/applications.ts#L137) |
| `HEAD /api/console/applications/export.csv` | `recruitment` | 自动 HEAD | `params`、`querystring` | 未声明 | `requireAuth` | [app/server/src/routes/console/applications.ts:95](../../../app/server/src/routes/console/applications.ts#L95) |
| `HEAD /api/console/applications/settings` | `recruitment` | 自动 HEAD | `params`、`querystring` | 未声明 | `requireAuth` | [app/server/src/routes/console/applications.ts:77](../../../app/server/src/routes/console/applications.ts#L77) |
| `HEAD /api/console/backup` | `platform` | 自动 HEAD | `params`、`querystring` | 已挂载 | `requireAuth` | [app/server/src/routes/console/backup.ts:33](../../../app/server/src/routes/console/backup.ts#L33) |
| `HEAD /api/console/competitions` | `competitions` | 自动 HEAD | `params`、`querystring` | 未声明 | `requireAuth` | [app/server/src/routes/console/competitions.ts:38](../../../app/server/src/routes/console/competitions.ts#L38) |
| `HEAD /api/console/competitions/:competition_id/candidates` | `competitions` | 自动 HEAD | `params`、`querystring` | 未声明 | `requireAuth` | [app/server/src/routes/console/competition-candidates.ts:30](../../../app/server/src/routes/console/competition-candidates.ts#L30) |
| `HEAD /api/console/competitions/:competition_id/final` | `competitions` | 自动 HEAD | `params`、`querystring` | 未声明 | `requireAuth` | [app/server/src/routes/console/competition-results.ts:115](../../../app/server/src/routes/console/competition-results.ts#L115) |
| `HEAD /api/console/competitions/:competition_id/roster` | `competitions` | 自动 HEAD | `params`、`querystring` | 未声明 | `requireAuth` | [app/server/src/routes/console/competition-roster.ts:59](../../../app/server/src/routes/console/competition-roster.ts#L59) |
| `HEAD /api/console/competitions/:competition_id/roster.csv` | `competitions` | 自动 HEAD | `params`、`querystring` | 未声明 | `requireAuth` | [app/server/src/routes/console/competition-roster.ts:90](../../../app/server/src/routes/console/competition-roster.ts#L90) |
| `HEAD /api/console/competitions/:competition_id/rules` | `competitions` | 自动 HEAD | `params`、`querystring` | 未声明 | `requireAuth` | [app/server/src/routes/console/competition-results.ts:83](../../../app/server/src/routes/console/competition-results.ts#L83) |
| `HEAD /api/console/competitions/:competition_id/score-events` | `competitions` | 自动 HEAD | `params`、`querystring` | 未声明 | `requireAuth` | [app/server/src/routes/console/competition-roster.ts:115](../../../app/server/src/routes/console/competition-roster.ts#L115) |
| `HEAD /api/console/competitions/:competition_id/score-preview` | `competitions` | 自动 HEAD | `params`、`querystring` | 未声明 | `requireAuth` | [app/server/src/routes/console/competition-roster.ts:125](../../../app/server/src/routes/console/competition-roster.ts#L125) |
| `HEAD /api/console/competitions/:competition_id/site` | `competitions` | 自动 HEAD | `params`、`querystring` | 未声明 | `requireAuth` | [app/server/src/routes/console/competition-site.ts:52](../../../app/server/src/routes/console/competition-site.ts#L52) |
| `HEAD /api/console/feedback` | `feedback` | 自动 HEAD | `params`、`querystring` | 未声明 | `requireAuth` | [app/server/src/routes/console/feedback.ts:12](../../../app/server/src/routes/console/feedback.ts#L12) |
| `HEAD /api/console/forum/categories` | `forum` | 自动 HEAD | `params`、`querystring` | 未声明 | `requireAuth` | [app/server/src/routes/console/forum.ts:18](../../../app/server/src/routes/console/forum.ts#L18) |
| `HEAD /api/console/forum/stickers` | `forum` | 自动 HEAD | `params`、`querystring` | 未声明 | `requireAuth` | [app/server/src/routes/console/forum.ts:36](../../../app/server/src/routes/console/forum.ts#L36) |
| `HEAD /api/console/gitlab/accounts` | `gitlab` | 自动 HEAD | `params`、`querystring` | 未声明 | `requireAuth` | [app/server/src/routes/console/gitlab.ts:19](../../../app/server/src/routes/console/gitlab.ts#L19) |
| `HEAD /api/console/gitlab/projects` | `gitlab` | 自动 HEAD | `params`、`querystring` | 未声明 | `requireAuth` | [app/server/src/routes/console/gitlab.ts:41](../../../app/server/src/routes/console/gitlab.ts#L41) |
| `HEAD /api/console/gitlab/settings` | `gitlab` | 自动 HEAD | `params`、`querystring` | 未声明 | `requireAuth` | [app/server/src/routes/console/gitlab.ts:43](../../../app/server/src/routes/console/gitlab.ts#L43) |
| `HEAD /api/console/gitlab/status` | `gitlab` | 自动 HEAD | `params`、`querystring` | 未声明 | `requireAuth` | [app/server/src/routes/console/gitlab.ts:32](../../../app/server/src/routes/console/gitlab.ts#L32) |
| `HEAD /api/console/invites` | `identity` | 自动 HEAD | `params`、`querystring` | 未声明 | `requireAuth` | [app/server/src/routes/console/invites.ts:17](../../../app/server/src/routes/console/invites.ts#L17) |
| `HEAD /api/console/mail-templates` | `mail` | 自动 HEAD | `params`、`querystring` | 未声明 | `requireAuth` | [app/server/src/routes/console/mail-templates.ts:133](../../../app/server/src/routes/console/mail-templates.ts#L133) |
| `HEAD /api/console/me` | `organization` | 自动 HEAD | `params`、`querystring` | 未声明 | `requireAuth` | [app/server/src/routes/console/me.ts:29](../../../app/server/src/routes/console/me.ts#L29) |
| `HEAD /api/console/permission-groups` | `permissions` | 自动 HEAD | `params`、`querystring` | 未声明 | 需查看 handler 与继承策略 | [app/server/src/routes/console/permission-groups.ts:109](../../../app/server/src/routes/console/permission-groups.ts#L109) |
| `HEAD /api/console/permission-groups/:id/members` | `permissions` | 自动 HEAD | `params`、`querystring` | 未声明 | 需查看 handler 与继承策略 | [app/server/src/routes/console/permission-groups.ts:226](../../../app/server/src/routes/console/permission-groups.ts#L226) |
| `HEAD /api/console/permissions/explain` | `permissions` | 自动 HEAD | `params`、`querystring` | 未声明 | 需查看 handler 与继承策略 | [app/server/src/routes/console/permissions.ts:20](../../../app/server/src/routes/console/permissions.ts#L20) |
| `HEAD /api/console/permissions/nodes` | `permissions` | 自动 HEAD | `params`、`querystring` | 未声明 | 需查看 handler 与继承策略 | [app/server/src/routes/console/permissions.ts:15](../../../app/server/src/routes/console/permissions.ts#L15) |
| `HEAD /api/console/security/blocks` | `platform` | 自动 HEAD | `params`、`querystring` | 未声明 | `requireAuth` | [app/server/src/routes/console/security.ts:31](../../../app/server/src/routes/console/security.ts#L31) |
| `HEAD /api/console/security/decoy` | `platform` | 自动 HEAD | `params`、`querystring` | 未声明 | `requireAuth` | [app/server/src/routes/console/security.ts:18](../../../app/server/src/routes/console/security.ts#L18) |
| `HEAD /api/console/summary` | `organization` | 自动 HEAD | `params`、`querystring` | 未声明 | `requireAuth` | [app/server/src/routes/console/me.ts:60](../../../app/server/src/routes/console/me.ts#L60) |
| `HEAD /api/console/users` | `permissions` | 自动 HEAD | `params`、`querystring` | 未声明 | 需查看 handler 与继承策略 | [app/server/src/routes/console/users.ts:118](../../../app/server/src/routes/console/users.ts#L118) |
| `HEAD /api/docs` | `public_content` | 自动 HEAD | `params`、`querystring` | 未声明 | 需查看 handler 与继承策略 | [app/server/src/routes/portal/docs.ts:16](../../../app/server/src/routes/portal/docs.ts#L16) |
| `HEAD /api/docs/:id` | `public_content` | 自动 HEAD | `params`、`querystring` | 未声明 | 需查看 handler 与继承策略 | [app/server/src/routes/portal/docs.ts:23](../../../app/server/src/routes/portal/docs.ts#L23) |
| `HEAD /api/feedback/categories` | `feedback` | 自动 HEAD | `params`、`querystring` | 未声明 | 需查看 handler 与继承策略 | [app/server/src/routes/portal/feedback.ts:25](../../../app/server/src/routes/portal/feedback.ts#L25) |
| `HEAD /api/feedback/public` | `feedback` | 自动 HEAD | `params`、`querystring` | 未声明 | 需查看 handler 与继承策略 | [app/server/src/routes/portal/feedback.ts:74](../../../app/server/src/routes/portal/feedback.ts#L74) |
| `HEAD /api/forum/avatars/:file` | `forum` | 自动 HEAD | `params`、`querystring` | 未声明 | 需查看 handler 与继承策略 | [app/server/src/routes/forum-api/people.ts:119](../../../app/server/src/routes/forum-api/people.ts#L119) |
| `HEAD /api/forum/state` | `forum` | 显式 | `params`、`querystring` | 未声明 | 需查看 handler 与继承策略 | [app/server/src/routes/forum-api/topics.ts:27](../../../app/server/src/routes/forum-api/topics.ts#L27) |
| `HEAD /api/forum/stickers` | `forum` | 自动 HEAD | `params`、`querystring` | 未声明 | 需查看 handler 与继承策略 | [app/server/src/routes/forum-api/stickers.ts:11](../../../app/server/src/routes/forum-api/stickers.ts#L11) |
| `HEAD /api/forum/stickers/:file` | `forum` | 自动 HEAD | `params`、`querystring` | 未声明 | 需查看 handler 与继承策略 | [app/server/src/routes/forum-api/stickers.ts:13](../../../app/server/src/routes/forum-api/stickers.ts#L13) |
| `HEAD /api/forum/uploads/:file` | `forum` | 自动 HEAD | `params`、`querystring` | 未声明 | 需查看 handler 与继承策略 | [app/server/src/routes/forum-api/uploads.ts:74](../../../app/server/src/routes/forum-api/uploads.ts#L74) |
| `HEAD /api/forum/users/suggest` | `forum` | 自动 HEAD | `params`、`querystring` | 未声明 | `requireMember(req)` | [app/server/src/routes/forum-api/people.ts:13](../../../app/server/src/routes/forum-api/people.ts#L13) |
| `HEAD /api/identity/avatar/:file` | `identity` | 自动 HEAD | `params`、`querystring` | 未声明 | 需查看 handler 与继承策略 | [app/server/src/routes/identity/profile.ts:52](../../../app/server/src/routes/identity/profile.ts#L52) |
| `HEAD /api/identity/default-avatar/:version/:file` | `identity` | 自动 HEAD | `params`、`querystring` | 未声明 | 需查看 handler 与继承策略 | [app/server/src/routes/identity/profile.ts:68](../../../app/server/src/routes/identity/profile.ts#L68) |
| `HEAD /api/identity/device` | `identity` | 自动 HEAD | `params`、`querystring` | 未声明 | 需查看 handler 与继承策略 | [app/server/src/routes/identity/device.ts:100](../../../app/server/src/routes/identity/device.ts#L100) |
| `HEAD /api/identity/me` | `identity` | 自动 HEAD | `params`、`querystring` | 未声明 | 需查看 handler 与继承策略 | [app/server/src/routes/identity/account.ts:49](../../../app/server/src/routes/identity/account.ts#L49) |
| `HEAD /api/identity/profile` | `identity` | 自动 HEAD | `params`、`querystring` | 未声明 | 需查看 handler 与继承策略 | [app/server/src/routes/identity/profile.ts:25](../../../app/server/src/routes/identity/profile.ts#L25) |
| `HEAD /api/me/applications` | `recruitment` | 自动 HEAD | `params`、`querystring` | 未声明 | 需查看 handler 与继承策略 | [app/server/src/routes/portal/my-applications.ts:18](../../../app/server/src/routes/portal/my-applications.ts#L18) |
| `HEAD /api/me/competition-results` | `competitions` | 自动 HEAD | `params`、`querystring` | 未声明 | 需查看 handler 与继承策略 | [app/server/src/routes/portal/competition-signups.ts:46](../../../app/server/src/routes/portal/competition-signups.ts#L46) |
| `HEAD /api/me/competitions` | `competitions` | 自动 HEAD | `params`、`querystring` | 未声明 | 需查看 handler 与继承策略 | [app/server/src/routes/portal/competition-signups.ts:43](../../../app/server/src/routes/portal/competition-signups.ts#L43) |
| `HEAD /api/me/gitlab/projects` | `gitlab` | 自动 HEAD | `params`、`querystring` | 未声明 | 需查看 handler 与继承策略 | [app/server/src/routes/portal/gitlab.ts:29](../../../app/server/src/routes/portal/gitlab.ts#L29) |
| `HEAD /api/public/competitions` | `competitions` | 自动 HEAD | `params`、`querystring` | 未声明 | 需查看 handler 与继承策略 | [app/server/src/routes/portal/competitions.ts:18](../../../app/server/src/routes/portal/competitions.ts#L18) |
| `HEAD /api/public/competitions/:id` | `competitions` | 自动 HEAD | `params`、`querystring` | 未声明 | 需查看 handler 与继承策略 | [app/server/src/routes/portal/competitions.ts:51](../../../app/server/src/routes/portal/competitions.ts#L51) |
| `HEAD /api/public/competitions/:id/feed` | `competitions` | 自动 HEAD | `params`、`querystring` | 未声明 | 需查看 handler 与继承策略 | [app/server/src/routes/portal/competitions.ts:64](../../../app/server/src/routes/portal/competitions.ts#L64) |
| `HEAD /api/public/competitions/:id/leaderboard` | `competitions` | 自动 HEAD | `params`、`querystring` | 未声明 | 需查看 handler 与继承策略 | [app/server/src/routes/portal/competitions.ts:58](../../../app/server/src/routes/portal/competitions.ts#L58) |
| `HEAD /api/public/competitions/:id/participants` | `competitions` | 自动 HEAD | `params`、`querystring` | 未声明 | 需查看 handler 与继承策略 | [app/server/src/routes/portal/competitions.ts:80](../../../app/server/src/routes/portal/competitions.ts#L80) |
| `HEAD /api/public/competitions/:id/snapshot` | `competitions` | 自动 HEAD | `params`、`querystring` | 未声明 | 需查看 handler 与继承策略 | [app/server/src/routes/portal/competitions.ts:96](../../../app/server/src/routes/portal/competitions.ts#L96) |
| `HEAD /api/public/competitions/:id/stats` | `competitions` | 自动 HEAD | `params`、`querystring` | 未声明 | 需查看 handler 与继承策略 | [app/server/src/routes/portal/competitions.ts:73](../../../app/server/src/routes/portal/competitions.ts#L73) |
| `HEAD /api/public/competitions/:id/teams` | `competitions` | 自动 HEAD | `params`、`querystring` | 未声明 | 需查看 handler 与继承策略 | [app/server/src/routes/portal/competitions.ts:89](../../../app/server/src/routes/portal/competitions.ts#L89) |
| `HEAD /api/public/config` | `platform` | 自动 HEAD | `params`、`querystring` | 未声明 | 需查看 handler 与继承策略 | [app/server/src/routes/portal/public-config.ts:17](../../../app/server/src/routes/portal/public-config.ts#L17) |
| `HEAD /api/public/departments` | `identity` | 自动 HEAD | `params`、`querystring` | 未声明 | 需查看 handler 与继承策略 | [app/server/src/routes/portal/departments.ts:18](../../../app/server/src/routes/portal/departments.ts#L18) |
| `HEAD /api/public/gitlab` | `gitlab` | 自动 HEAD | `params`、`querystring` | 未声明 | 需查看 handler 与继承策略 | [app/server/src/routes/portal/gitlab.ts:14](../../../app/server/src/routes/portal/gitlab.ts#L14) |
| `HEAD /api/public/gitlab/projects` | `gitlab` | 自动 HEAD | `params`、`querystring` | 未声明 | 需查看 handler 与继承策略 | [app/server/src/routes/portal/gitlab.ts:19](../../../app/server/src/routes/portal/gitlab.ts#L19) |
| `HEAD /api/team-plaza` | `competitions` | 自动 HEAD | `params`、`querystring` | 未声明 | 需查看 handler 与继承策略 | [app/server/src/routes/portal/competition-signups.ts:120](../../../app/server/src/routes/portal/competition-signups.ts#L120) |
| `HEAD /auth/callback` | `identity` | 自动 HEAD | `params`、`querystring` | 未声明 | 需查看 handler 与继承策略 | [app/server/src/routes/admin/auth.ts:45](../../../app/server/src/routes/admin/auth.ts#L45) |
| `HEAD /auth/device/userinfo` | `identity` | 自动 HEAD | `params`、`querystring` | 未声明 | 需查看 handler 与继承策略 | [app/server/src/routes/identity/device.ts:148](../../../app/server/src/routes/identity/device.ts#L148) |
| `HEAD /auth/github` | `identity` | 自动 HEAD | `params`、`querystring` | 未声明 | 需查看 handler 与继承策略 | [app/server/src/routes/admin/auth.ts:37](../../../app/server/src/routes/admin/auth.ts#L37) |
| `HEAD /auth/google` | `identity` | 自动 HEAD | `params`、`querystring` | 未声明 | 需查看 handler 与继承策略 | [app/server/src/routes/identity/google.ts:29](../../../app/server/src/routes/identity/google.ts#L29) |
| `HEAD /auth/google/callback` | `identity` | 自动 HEAD | `params`、`querystring` | 未声明 | 需查看 handler 与继承策略 | [app/server/src/routes/identity/google.ts:62](../../../app/server/src/routes/identity/google.ts#L62) |
| `HEAD /auth/me` | `identity` | 自动 HEAD | `params`、`querystring` | 未声明 | 需查看 handler 与继承策略 | [app/server/src/routes/admin/auth.ts:159](../../../app/server/src/routes/admin/auth.ts#L159) |
| `HEAD /auth/providers` | `identity` | 自动 HEAD | `params`、`querystring` | 未声明 | 需查看 handler 与继承策略 | [app/server/src/routes/identity/providers.ts:30](../../../app/server/src/routes/identity/providers.ts#L30) |
| `HEAD /c/:slug` | `competitions` | 自动 HEAD | 未声明 | 已挂载 | 需查看 handler 与继承策略 | [app/server/src/routes/sites/index.ts:74](../../../app/server/src/routes/sites/index.ts#L74) |
| `HEAD /c/:slug/*` | `competitions` | 自动 HEAD | 未声明 | 已挂载 | 需查看 handler 与继承策略 | [app/server/src/routes/sites/index.ts:76](../../../app/server/src/routes/sites/index.ts#L76) |
| `HEAD /forum/llms.txt` | `forum` | 自动 HEAD | `params`、`querystring` | 未声明 | `forumViewer(req)` | [app/server/src/routes/forum-api/markdown.ts:32](../../../app/server/src/routes/forum-api/markdown.ts#L32) |
| `HEAD /forum/published/:file` | `forum` | 自动 HEAD | `params`、`querystring` | 未声明 | `forumViewer(req)` | [app/server/src/routes/forum-api/markdown.ts:52](../../../app/server/src/routes/forum-api/markdown.ts#L52) |
| `HEAD /forum/t/:topic_id.md` | `forum` | 自动 HEAD | `params`、`querystring` | 未声明 | `forumViewer(req)` | [app/server/src/routes/forum-api/markdown.ts:39](../../../app/server/src/routes/forum-api/markdown.ts#L39) |
| `HEAD /oidc/*` | `identity` | 自动 HEAD | 未声明 | 已挂载 | 需查看 handler 与继承策略 | [app/server/src/routes/oidc/index.ts:169](../../../app/server/src/routes/oidc/index.ts#L169) |
| `HEAD /oidc/interaction/:uid` | `identity` | 自动 HEAD | `params`、`querystring` | 未声明 | 需查看 handler 与继承策略 | [app/server/src/routes/oidc/index.ts:70](../../../app/server/src/routes/oidc/index.ts#L70) |
| `HEAD /oidc/interaction/:uid/details` | `identity` | 自动 HEAD | `params`、`querystring` | 未声明 | 需查看 handler 与继承策略 | [app/server/src/routes/oidc/index.ts:119](../../../app/server/src/routes/oidc/index.ts#L119) |
| `PATCH /api/console/applications/:application_id` | `recruitment` | 显式 | `params`、`querystring`、`body` | 已挂载 | `requireAuth` | [app/server/src/routes/console/applications.ts:155](../../../app/server/src/routes/console/applications.ts#L155) |
| `PATCH /api/console/applications/settings` | `recruitment` | 显式 | `params`、`querystring`、`body` | 已挂载 | `requireAuth` | [app/server/src/routes/console/applications.ts:79](../../../app/server/src/routes/console/applications.ts#L79) |
| `PATCH /api/console/competitions/:competition_id` | `competitions` | 显式 | `params`、`querystring`、`body` | 已挂载 | `requireAuth` | [app/server/src/routes/console/competitions.ts:61](../../../app/server/src/routes/console/competitions.ts#L61) |
| `PATCH /api/console/feedback/:id` | `feedback` | 显式 | `params`、`querystring`、`body` | 未声明 | `requireAuth` | [app/server/src/routes/console/feedback.ts:18](../../../app/server/src/routes/console/feedback.ts#L18) |
| `PATCH /api/console/forum/categories/:id` | `forum` | 显式 | `params`、`querystring`、`body` | 已挂载 | `requireAuth` | [app/server/src/routes/console/forum.ts:22](../../../app/server/src/routes/console/forum.ts#L22) |
| `PATCH /api/console/forum/sticker-packs/:id` | `forum` | 显式 | `params`、`querystring`、`body` | 已挂载 | `requireAuth` | [app/server/src/routes/console/forum.ts:57](../../../app/server/src/routes/console/forum.ts#L57) |
| `PATCH /api/console/forum/stickers/:id` | `forum` | 显式 | `params`、`querystring`、`body` | 已挂载 | `requireAuth` | [app/server/src/routes/console/forum.ts:68](../../../app/server/src/routes/console/forum.ts#L68) |
| `PATCH /api/console/gitlab/settings` | `gitlab` | 显式 | `params`、`querystring`、`body` | 已挂载 | `requireAuth` | [app/server/src/routes/console/gitlab.ts:47](../../../app/server/src/routes/console/gitlab.ts#L47) |
| `PATCH /api/console/invites/:id` | `identity` | 显式 | `params`、`querystring`、`body` | 已挂载 | `requireAuth` | [app/server/src/routes/console/invites.ts:30](../../../app/server/src/routes/console/invites.ts#L30) |
| `PATCH /api/console/mail-templates/:template_id` | `mail` | 显式 | `params`、`querystring`、`body` | 已挂载 | `requireAuth` | [app/server/src/routes/console/mail-templates.ts:164](../../../app/server/src/routes/console/mail-templates.ts#L164) |
| `PATCH /api/console/permission-groups/:id` | `permissions` | 显式 | `params`、`querystring`、`body` | 已挂载 | 需查看 handler 与继承策略 | [app/server/src/routes/console/permission-groups.ts:134](../../../app/server/src/routes/console/permission-groups.ts#L134) |
| `PATCH /api/console/users/:id` | `permissions` | 显式 | `params`、`querystring`、`body` | 已挂载 | 需查看 handler 与继承策略 | [app/server/src/routes/console/users.ts:165](../../../app/server/src/routes/console/users.ts#L165) |
| `PATCH /api/forum/me/profile` | `forum` | 显式 | `params`、`querystring`、`body` | 未声明 | `requireMember(req)` | [app/server/src/routes/forum-api/people.ts:46](../../../app/server/src/routes/forum-api/people.ts#L46) |
| `PATCH /api/forum/posts/:post_id` | `forum` | 显式 | `params`、`querystring`、`body` | 未声明 | `requireMember(req)` | [app/server/src/routes/forum-api/posts.ts:68](../../../app/server/src/routes/forum-api/posts.ts#L68) |
| `PATCH /api/forum/topics/:topic_id/visibility` | `forum` | 显式 | `params`、`querystring`、`body` | 已挂载 | `requireMember(req)` | [app/server/src/routes/forum-api/topics.ts:124](../../../app/server/src/routes/forum-api/topics.ts#L124) |
| `PATCH /api/identity/profile` | `identity` | 显式 | `params`、`querystring`、`body` | 已挂载 | 需查看 handler 与继承策略 | [app/server/src/routes/identity/profile.ts:27](../../../app/server/src/routes/identity/profile.ts#L27) |
| `POST /api/competitions/:id/signup` | `competitions` | 显式 | `params`、`querystring`、`body` | 已挂载 | 需查看 handler 与继承策略 | [app/server/src/routes/portal/competition-signups.ts:53](../../../app/server/src/routes/portal/competition-signups.ts#L53) |
| `POST /api/competitions/:id/teams` | `competitions` | 显式 | `params`、`querystring`、`body` | 已挂载 | 需查看 handler 与继承策略 | [app/server/src/routes/portal/competition-signups.ts:71](../../../app/server/src/routes/portal/competition-signups.ts#L71) |
| `POST /api/console/applications/:application_id/letter-preview` | `recruitment` | 显式 | `params`、`querystring`、`body` | 已挂载 | `requireAuth` | [app/server/src/routes/console/applications.ts:228](../../../app/server/src/routes/console/applications.ts#L228) |
| `POST /api/console/competitions` | `competitions` | 显式 | `params`、`querystring`、`body` | 已挂载 | `requireAuth` | [app/server/src/routes/console/competitions.ts:43](../../../app/server/src/routes/console/competitions.ts#L43) |
| `POST /api/console/competitions/:competition_id/candidates/:candidate_id/accept` | `competitions` | 显式 | `params`、`querystring`、`body` | 已挂载 | `requireAuth` | [app/server/src/routes/console/competition-candidates.ts:40](../../../app/server/src/routes/console/competition-candidates.ts#L40) |
| `POST /api/console/competitions/:competition_id/candidates/:candidate_id/reject` | `competitions` | 显式 | `params`、`querystring`、`body` | 已挂载 | `requireAuth` | [app/server/src/routes/console/competition-candidates.ts:64](../../../app/server/src/routes/console/competition-candidates.ts#L64) |
| `POST /api/console/competitions/:competition_id/candidates/collect` | `competitions` | 显式 | `params`、`querystring` | 已挂载 | `requireAuth` | [app/server/src/routes/console/competition-candidates.ts:86](../../../app/server/src/routes/console/competition-candidates.ts#L86) |
| `POST /api/console/competitions/:competition_id/final` | `competitions` | 显式 | `params`、`querystring` | 已挂载 | `requireAuth` | [app/server/src/routes/console/competition-results.ts:120](../../../app/server/src/routes/console/competition-results.ts#L120) |
| `POST /api/console/competitions/:competition_id/score-events` | `competitions` | 显式 | `params`、`querystring`、`body` | 已挂载 | `requireAuth` | [app/server/src/routes/console/competition-roster.ts:135](../../../app/server/src/routes/console/competition-roster.ts#L135) |
| `POST /api/console/competitions/:competition_id/score-events/:event_id/revoke` | `competitions` | 显式 | `params`、`querystring`、`body` | 已挂载 | `requireAuth` | [app/server/src/routes/console/competition-roster.ts:162](../../../app/server/src/routes/console/competition-roster.ts#L162) |
| `POST /api/console/competitions/:competition_id/site/publish` | `competitions` | 显式 | `params`、`querystring`、`body` | 已挂载 | `requireAuth` | [app/server/src/routes/console/competition-site.ts:77](../../../app/server/src/routes/console/competition-site.ts#L77) |
| `POST /api/console/competitions/:competition_id/site/versions` | `competitions` | 显式 | `params`、`querystring` | 已挂载 | `requireAuth` | [app/server/src/routes/console/competition-site.ts:57](../../../app/server/src/routes/console/competition-site.ts#L57) |
| `POST /api/console/forum/sticker-packs` | `forum` | 显式 | `params`、`querystring`、`body` | 已挂载 | `requireAuth` | [app/server/src/routes/console/forum.ts:46](../../../app/server/src/routes/console/forum.ts#L46) |
| `POST /api/console/gitlab/accounts/:account_id/resync` | `gitlab` | 显式 | `params`、`querystring` | 已挂载 | `requireAuth` | [app/server/src/routes/console/gitlab.ts:23](../../../app/server/src/routes/console/gitlab.ts#L23) |
| `POST /api/console/invites` | `identity` | 显式 | `params`、`querystring`、`body` | 已挂载 | `requireAuth` | [app/server/src/routes/console/invites.ts:19](../../../app/server/src/routes/console/invites.ts#L19) |
| `POST /api/console/mail-templates` | `mail` | 显式 | `params`、`querystring`、`body` | 已挂载 | `requireAuth` | [app/server/src/routes/console/mail-templates.ts:146](../../../app/server/src/routes/console/mail-templates.ts#L146) |
| `POST /api/console/mail-templates/preview` | `mail` | 显式 | `params`、`querystring`、`body` | 已挂载 | `requireAuth` | [app/server/src/routes/console/mail-templates.ts:214](../../../app/server/src/routes/console/mail-templates.ts#L214) |
| `POST /api/console/mail-templates/test-send` | `mail` | 显式 | `params`、`querystring`、`body` | 已挂载 | `requireAuth` | [app/server/src/routes/console/mail-templates.ts:244](../../../app/server/src/routes/console/mail-templates.ts#L244) |
| `POST /api/console/permission-groups` | `permissions` | 显式 | `params`、`querystring`、`body` | 已挂载 | 需查看 handler 与继承策略 | [app/server/src/routes/console/permission-groups.ts:111](../../../app/server/src/routes/console/permission-groups.ts#L111) |
| `POST /api/console/permission-groups/:id/members` | `permissions` | 显式 | `params`、`querystring`、`body` | 已挂载 | 需查看 handler 与继承策略 | [app/server/src/routes/console/permission-groups.ts:244](../../../app/server/src/routes/console/permission-groups.ts#L244) |
| `POST /api/console/prizes/lookup` | `competitions` | 显式 | `params`、`querystring`、`body` | 已挂载 | `requireAuth` | [app/server/src/routes/console/competition-results.ts:185](../../../app/server/src/routes/console/competition-results.ts#L185) |
| `POST /api/console/prizes/redeem` | `competitions` | 显式 | `params`、`querystring`、`body` | 已挂载 | `requireAuth` | [app/server/src/routes/console/competition-results.ts:196](../../../app/server/src/routes/console/competition-results.ts#L196) |
| `POST /api/events` | `audit` | 显式 | `params`、`querystring`、`body` | 已挂载 | 需查看 handler 与继承策略 | [app/server/src/routes/portal/events.ts:28](../../../app/server/src/routes/portal/events.ts#L28) |
| `POST /api/feedback` | `feedback` | 显式 | `params`、`querystring`、`body` | 未声明 | 需查看 handler 与继承策略 | [app/server/src/routes/portal/feedback.ts:27](../../../app/server/src/routes/portal/feedback.ts#L27) |
| `POST /api/forum/notifications/:notification_id/read` | `forum` | 显式 | `params`、`querystring` | 未声明 | `requireMember(req)` | [app/server/src/routes/forum-api/people.ts:34](../../../app/server/src/routes/forum-api/people.ts#L34) |
| `POST /api/forum/notifications/read-all` | `forum` | 显式 | `params`、`querystring` | 未声明 | `requireMember(req)` | [app/server/src/routes/forum-api/people.ts:40](../../../app/server/src/routes/forum-api/people.ts#L40) |
| `POST /api/forum/posts` | `forum` | 显式 | `params`、`querystring`、`body` | 已挂载 | 需查看 handler 与继承策略 | [app/server/src/routes/forum-api/posts.ts:44](../../../app/server/src/routes/forum-api/posts.ts#L44) |
| `POST /api/forum/posts/:post_id/bookmark` | `forum` | 显式 | `params`、`querystring` | 未声明 | 需查看 handler 与继承策略 | [app/server/src/routes/forum-api/posts.ts:99](../../../app/server/src/routes/forum-api/posts.ts#L99) |
| `POST /api/forum/posts/:post_id/like` | `forum` | 显式 | `params`、`querystring` | 未声明 | 需查看 handler 与继承策略 | [app/server/src/routes/forum-api/posts.ts:91](../../../app/server/src/routes/forum-api/posts.ts#L91) |
| `POST /api/forum/topics` | `forum` | 显式 | `params`、`querystring`、`body` | 未声明 | 需查看 handler 与继承策略 | [app/server/src/routes/forum-api/topics.ts:86](../../../app/server/src/routes/forum-api/topics.ts#L86) |
| `POST /api/forum/topics/:topic_id/close` | `forum` | 显式 | `params`、`querystring`、`body` | 未声明 | `requireMember(req)` | [app/server/src/routes/forum-api/topics.ts:108](../../../app/server/src/routes/forum-api/topics.ts#L108) |
| `POST /api/forum/topics/:topic_id/pin` | `forum` | 显式 | `params`、`querystring`、`body` | 未声明 | `requireMember(req)` | [app/server/src/routes/forum-api/topics.ts:108](../../../app/server/src/routes/forum-api/topics.ts#L108) |
| `POST /api/forum/topics/:topic_id/view` | `forum` | 显式 | `params`、`querystring` | 未声明 | 需查看 handler 与继承策略 | [app/server/src/routes/forum-api/topics.ts:142](../../../app/server/src/routes/forum-api/topics.ts#L142) |
| `POST /api/forum/users/:forum_user_id/follow` | `forum` | 显式 | `params`、`querystring` | 未声明 | 需查看 handler 与继承策略 | [app/server/src/routes/forum-api/people.ts:25](../../../app/server/src/routes/forum-api/people.ts#L25) |
| `POST /api/identity/device/approve` | `identity` | 显式 | `params`、`querystring`、`body` | 已挂载 | 需查看 handler 与继承策略 | [app/server/src/routes/identity/device.ts:111](../../../app/server/src/routes/identity/device.ts#L111) |
| `POST /api/identity/email/remove` | `identity` | 显式 | `params`、`querystring`、`body` | 已挂载 | 需查看 handler 与继承策略 | [app/server/src/routes/identity/account.ts:110](../../../app/server/src/routes/identity/account.ts#L110) |
| `POST /api/identity/email/start` | `identity` | 显式 | `params`、`querystring`、`body` | 已挂载 | 需查看 handler 与继承策略 | [app/server/src/routes/identity/account.ts:66](../../../app/server/src/routes/identity/account.ts#L66) |
| `POST /api/identity/email/verify` | `identity` | 显式 | `params`、`querystring`、`body` | 已挂载 | 需查看 handler 与继承策略 | [app/server/src/routes/identity/account.ts:85](../../../app/server/src/routes/identity/account.ts#L85) |
| `POST /api/identity/invite/redeem` | `identity` | 显式 | `params`、`querystring`、`body` | 已挂载 | 需查看 handler 与继承策略 | [app/server/src/routes/identity/profile.ts:112](../../../app/server/src/routes/identity/profile.ts#L112) |
| `POST /api/identity/link` | `identity` | 显式 | `params`、`querystring`、`body` | 已挂载 | 需查看 handler 与继承策略 | [app/server/src/routes/identity/google.ts:42](../../../app/server/src/routes/identity/google.ts#L42) |
| `POST /api/identity/password` | `identity` | 显式 | `params`、`querystring`、`body` | 已挂载 | 需查看 handler 与继承策略 | [app/server/src/routes/identity/account.ts:123](../../../app/server/src/routes/identity/account.ts#L123) |
| `POST /api/identity/real-info` | `identity` | 显式 | `params`、`querystring`、`body` | 已挂载 | 需查看 handler 与继承策略 | [app/server/src/routes/identity/account.ts:155](../../../app/server/src/routes/identity/account.ts#L155) |
| `POST /api/portal/apply` | `recruitment` | 显式 | `params`、`querystring` | 未声明 | 需查看 handler 与继承策略 | [app/server/src/routes/portal/apply.ts:119](../../../app/server/src/routes/portal/apply.ts#L119) |
| `POST /api/teams/:id/apply` | `competitions` | 显式 | `params`、`querystring`、`body` | 已挂载 | 需查看 handler 与继承策略 | [app/server/src/routes/portal/competition-signups.ts:76](../../../app/server/src/routes/portal/competition-signups.ts#L76) |
| `POST /api/teams/:id/invite` | `competitions` | 显式 | `params`、`querystring`、`body` | 已挂载 | 需查看 handler 与继承策略 | [app/server/src/routes/portal/competition-signups.ts:81](../../../app/server/src/routes/portal/competition-signups.ts#L81) |
| `POST /api/teams/:id/leave` | `competitions` | 显式 | `params`、`querystring` | 已挂载 | 需查看 handler 与继承策略 | [app/server/src/routes/portal/competition-signups.ts:93](../../../app/server/src/routes/portal/competition-signups.ts#L93) |
| `POST /api/teams/:id/lock` | `competitions` | 显式 | `params`、`querystring` | 已挂载 | 需查看 handler 与继承策略 | [app/server/src/routes/portal/competition-signups.ts:104](../../../app/server/src/routes/portal/competition-signups.ts#L104) |
| `POST /api/teams/:id/plaza` | `competitions` | 显式 | `params`、`querystring`、`body` | 已挂载 | 需查看 handler 与继承策略 | [app/server/src/routes/portal/competition-signups.ts:111](../../../app/server/src/routes/portal/competition-signups.ts#L111) |
| `POST /api/teams/:id/respond` | `competitions` | 显式 | `params`、`querystring`、`body` | 已挂载 | 需查看 handler 与继承策略 | [app/server/src/routes/portal/competition-signups.ts:86](../../../app/server/src/routes/portal/competition-signups.ts#L86) |
| `POST /api/teams/:id/transfer` | `competitions` | 显式 | `params`、`querystring`、`body` | 已挂载 | 需查看 handler 与继承策略 | [app/server/src/routes/portal/competition-signups.ts:96](../../../app/server/src/routes/portal/competition-signups.ts#L96) |
| `POST /auth/device/code` | `identity` | 显式 | `params`、`querystring`、`body` | 已挂载 | 需查看 handler 与继承策略 | [app/server/src/routes/identity/device.ts:36](../../../app/server/src/routes/identity/device.ts#L36) |
| `POST /auth/device/revoke` | `identity` | 显式 | `params`、`querystring` | 已挂载 | 需查看 handler 与继承策略 | [app/server/src/routes/identity/device.ts:181](../../../app/server/src/routes/identity/device.ts#L181) |
| `POST /auth/device/token` | `identity` | 显式 | `params`、`querystring`、`body` | 已挂载 | 需查看 handler 与继承策略 | [app/server/src/routes/identity/device.ts:66](../../../app/server/src/routes/identity/device.ts#L66) |
| `POST /auth/email/password` | `identity` | 显式 | `params`、`querystring`、`body` | 已挂载 | 需查看 handler 与继承策略 | [app/server/src/routes/identity/email.ts:171](../../../app/server/src/routes/identity/email.ts#L171) |
| `POST /auth/email/reset` | `identity` | 显式 | `params`、`querystring`、`body` | 已挂载 | 需查看 handler 与继承策略 | [app/server/src/routes/identity/email.ts:200](../../../app/server/src/routes/identity/email.ts#L200) |
| `POST /auth/email/start` | `identity` | 显式 | `params`、`querystring`、`body` | 已挂载 | 需查看 handler 与继承策略 | [app/server/src/routes/identity/email.ts:95](../../../app/server/src/routes/identity/email.ts#L95) |
| `POST /auth/email/verify` | `identity` | 显式 | `params`、`querystring`、`body` | 已挂载 | 需查看 handler 与继承策略 | [app/server/src/routes/identity/email.ts:114](../../../app/server/src/routes/identity/email.ts#L114) |
| `POST /auth/signout` | `identity` | 显式 | `params`、`querystring` | 未声明 | 需查看 handler 与继承策略 | [app/server/src/routes/admin/auth.ts:100](../../../app/server/src/routes/admin/auth.ts#L100) |
| `POST /oidc/*` | `identity` | 显式 | 未声明 | 已挂载 | 需查看 handler 与继承策略 | [app/server/src/routes/oidc/index.ts:169](../../../app/server/src/routes/oidc/index.ts#L169) |
| `POST /oidc/interaction/:uid/abort` | `identity` | 显式 | `params`、`querystring` | 已挂载 | 需查看 handler 与继承策略 | [app/server/src/routes/oidc/index.ts:153](../../../app/server/src/routes/oidc/index.ts#L153) |
| `POST /oidc/interaction/:uid/confirm` | `identity` | 显式 | `params`、`querystring` | 已挂载 | 需查看 handler 与继承策略 | [app/server/src/routes/oidc/index.ts:136](../../../app/server/src/routes/oidc/index.ts#L136) |
| `PUT /api/console/competitions/:competition_id/rules` | `competitions` | 显式 | `params`、`querystring`、`body` | 已挂载 | `requireAuth` | [app/server/src/routes/console/competition-results.ts:88](../../../app/server/src/routes/console/competition-results.ts#L88) |
| `PUT /api/console/competitions/:competition_id/signup-settings` | `competitions` | 显式 | `params`、`querystring`、`body` | 已挂载 | `requireAuth` | [app/server/src/routes/console/competition-roster.ts:38](../../../app/server/src/routes/console/competition-roster.ts#L38) |
| `PUT /api/console/forum/sticker-packs/:id/stickers` | `forum` | 显式 | `params`、`querystring` | 已挂载 | `requireAuth` | [app/server/src/routes/console/forum.ts:86](../../../app/server/src/routes/console/forum.ts#L86) |
| `PUT /api/console/security/decoy` | `platform` | 显式 | `params`、`querystring`、`body` | 已挂载 | `requireAuth` | [app/server/src/routes/console/security.ts:19](../../../app/server/src/routes/console/security.ts#L19) |
| `PUT /api/forum/me/avatar` | `forum` | 显式 | `params`、`querystring` | 未声明 | `requireMember(req)` | [app/server/src/routes/forum-api/people.ts:94](../../../app/server/src/routes/forum-api/people.ts#L94) |
| `PUT /api/forum/posts/:post_id/reactions/:sticker_id` | `forum` | 显式 | `params`、`querystring` | 已挂载 | 需查看 handler 与继承策略 | [app/server/src/routes/forum-api/posts.ts:107](../../../app/server/src/routes/forum-api/posts.ts#L107) |
| `PUT /api/forum/uploads` | `forum` | 显式 | `params`、`querystring` | 已挂载 | 需查看 handler 与继承策略 | [app/server/src/routes/forum-api/uploads.ts:51](../../../app/server/src/routes/forum-api/uploads.ts#L51) |
| `PUT /api/identity/avatar` | `identity` | 显式 | `params`、`querystring` | 已挂载 | 需查看 handler 与继承策略 | [app/server/src/routes/identity/profile.ts:85](../../../app/server/src/routes/identity/profile.ts#L85) |

## 基础设施与占位

| 方法与路径 | 业务域 | 注册 | 请求 Schema | 响应 Schema | 授权检查证据 | 源码 |
|---|---|---|---|---|---|---|
| `GET /` | `platform` | 显式 | 未声明 | 未声明 | 需查看 handler 与继承策略 | [app/server/src/app.ts:173](../../../app/server/src/app.ts#L173) |
| `GET /forum` | `platform` | 显式 | 未声明 | 未声明 | 需查看 handler 与继承策略 | [app/server/src/app.ts:153](../../../app/server/src/app.ts#L153) |
| `GET /forum/*` | `platform` | 显式 | 未声明 | 未声明 | 需查看 handler 与继承策略 | [app/server/src/app.ts:153](../../../app/server/src/app.ts#L153) |
| `GET /healthz` | `platform` | 显式 | 未声明 | 未声明 | 需查看 handler 与继承策略 | [app/server/src/app.ts:159](../../../app/server/src/app.ts#L159) |
| `HEAD /` | `platform` | 自动 HEAD | 未声明 | 未声明 | 需查看 handler 与继承策略 | [app/server/src/app.ts:173](../../../app/server/src/app.ts#L173) |
| `HEAD /forum` | `platform` | 自动 HEAD | 未声明 | 未声明 | 需查看 handler 与继承策略 | [app/server/src/app.ts:153](../../../app/server/src/app.ts#L153) |
| `HEAD /forum/*` | `platform` | 自动 HEAD | 未声明 | 未声明 | 需查看 handler 与继承策略 | [app/server/src/app.ts:153](../../../app/server/src/app.ts#L153) |
| `HEAD /healthz` | `platform` | 自动 HEAD | 未声明 | 未声明 | 需查看 handler 与继承策略 | [app/server/src/app.ts:159](../../../app/server/src/app.ts#L159) |

## 退役兼容

| 方法与路径 | 业务域 | 注册 | 请求 Schema | 响应 Schema | 授权检查证据 | 源码 |
|---|---|---|---|---|---|---|
| `DELETE /api/forum` | `platform` | 显式 | 未声明 | 未声明 | 需查看 handler 与继承策略 | [app/server/src/app.ts:149](../../../app/server/src/app.ts#L149) |
| `DELETE /api/forum/*` | `platform` | 显式 | 未声明 | 未声明 | 需查看 handler 与继承策略 | [app/server/src/app.ts:149](../../../app/server/src/app.ts#L149) |
| `DELETE /auth/forum/*` | `platform` | 显式 | 未声明 | 未声明 | 需查看 handler 与继承策略 | [app/server/src/app.ts:149](../../../app/server/src/app.ts#L149) |
| `DELETE /forum/u/*` | `platform` | 显式 | 未声明 | 未声明 | 需查看 handler 与继承策略 | [app/server/src/app.ts:149](../../../app/server/src/app.ts#L149) |
| `GET /api/forum` | `platform` | 显式 | 未声明 | 未声明 | 需查看 handler 与继承策略 | [app/server/src/app.ts:149](../../../app/server/src/app.ts#L149) |
| `GET /api/forum/*` | `platform` | 显式 | 未声明 | 未声明 | 需查看 handler 与继承策略 | [app/server/src/app.ts:149](../../../app/server/src/app.ts#L149) |
| `GET /auth/forum/*` | `platform` | 显式 | 未声明 | 未声明 | 需查看 handler 与继承策略 | [app/server/src/app.ts:149](../../../app/server/src/app.ts#L149) |
| `GET /forum/u/*` | `platform` | 显式 | 未声明 | 未声明 | 需查看 handler 与继承策略 | [app/server/src/app.ts:149](../../../app/server/src/app.ts#L149) |
| `HEAD /api/forum` | `platform` | 自动 HEAD | 未声明 | 未声明 | 需查看 handler 与继承策略 | [app/server/src/app.ts:149](../../../app/server/src/app.ts#L149) |
| `HEAD /api/forum/*` | `platform` | 自动 HEAD | 未声明 | 未声明 | 需查看 handler 与继承策略 | [app/server/src/app.ts:149](../../../app/server/src/app.ts#L149) |
| `HEAD /auth/forum/*` | `platform` | 自动 HEAD | 未声明 | 未声明 | 需查看 handler 与继承策略 | [app/server/src/app.ts:149](../../../app/server/src/app.ts#L149) |
| `HEAD /forum/u/*` | `platform` | 自动 HEAD | 未声明 | 未声明 | 需查看 handler 与继承策略 | [app/server/src/app.ts:149](../../../app/server/src/app.ts#L149) |
| `OPTIONS /api/forum` | `platform` | 显式 | 未声明 | 未声明 | 需查看 handler 与继承策略 | [app/server/src/app.ts:149](../../../app/server/src/app.ts#L149) |
| `OPTIONS /api/forum/*` | `platform` | 显式 | 未声明 | 未声明 | 需查看 handler 与继承策略 | [app/server/src/app.ts:149](../../../app/server/src/app.ts#L149) |
| `OPTIONS /auth/forum/*` | `platform` | 显式 | 未声明 | 未声明 | 需查看 handler 与继承策略 | [app/server/src/app.ts:149](../../../app/server/src/app.ts#L149) |
| `OPTIONS /forum/u/*` | `platform` | 显式 | 未声明 | 未声明 | 需查看 handler 与继承策略 | [app/server/src/app.ts:149](../../../app/server/src/app.ts#L149) |
| `PATCH /api/forum` | `platform` | 显式 | 未声明 | 未声明 | 需查看 handler 与继承策略 | [app/server/src/app.ts:149](../../../app/server/src/app.ts#L149) |
| `PATCH /api/forum/*` | `platform` | 显式 | 未声明 | 未声明 | 需查看 handler 与继承策略 | [app/server/src/app.ts:149](../../../app/server/src/app.ts#L149) |
| `PATCH /auth/forum/*` | `platform` | 显式 | 未声明 | 未声明 | 需查看 handler 与继承策略 | [app/server/src/app.ts:149](../../../app/server/src/app.ts#L149) |
| `PATCH /forum/u/*` | `platform` | 显式 | 未声明 | 未声明 | 需查看 handler 与继承策略 | [app/server/src/app.ts:149](../../../app/server/src/app.ts#L149) |
| `POST /api/forum` | `platform` | 显式 | 未声明 | 未声明 | 需查看 handler 与继承策略 | [app/server/src/app.ts:149](../../../app/server/src/app.ts#L149) |
| `POST /api/forum/*` | `platform` | 显式 | 未声明 | 未声明 | 需查看 handler 与继承策略 | [app/server/src/app.ts:149](../../../app/server/src/app.ts#L149) |
| `POST /auth/forum/*` | `platform` | 显式 | 未声明 | 未声明 | 需查看 handler 与继承策略 | [app/server/src/app.ts:149](../../../app/server/src/app.ts#L149) |
| `POST /forum/u/*` | `platform` | 显式 | 未声明 | 未声明 | 需查看 handler 与继承策略 | [app/server/src/app.ts:149](../../../app/server/src/app.ts#L149) |
| `PUT /api/forum` | `platform` | 显式 | 未声明 | 未声明 | 需查看 handler 与继承策略 | [app/server/src/app.ts:149](../../../app/server/src/app.ts#L149) |
| `PUT /api/forum/*` | `platform` | 显式 | 未声明 | 未声明 | 需查看 handler 与继承策略 | [app/server/src/app.ts:149](../../../app/server/src/app.ts#L149) |
| `PUT /auth/forum/*` | `platform` | 显式 | 未声明 | 未声明 | 需查看 handler 与继承策略 | [app/server/src/app.ts:149](../../../app/server/src/app.ts#L149) |
| `PUT /forum/u/*` | `platform` | 显式 | 未声明 | 未声明 | 需查看 handler 与继承策略 | [app/server/src/app.ts:149](../../../app/server/src/app.ts#L149) |

## 核心之外：Nitro 与预渲染入口

以下是源码声明核对，不是本次运行时观测。路径相对于论坛应用，实际挂载前缀由论坛配置决定；没有启动 Nitro 或读取本机快照。静态文件与 SPA 回落不逐文件枚举。

| 方法与路径 | 范围 | 说明 | 源码 |
|---|---|---|---|
| `GET /__geek_forum` | `development-only` | 本机进程标记，不是业务 API 或认证；import.meta.dev 之外返回 404。 | [app/forum/server/routes/__geek_forum.get.ts:4](../../../app/forum/server/routes/__geek_forum.get.ts#L4) |
| `GET/HEAD /api/local-forum/state` | `development-only` | 只读快照；requireSnapshotRoute 检查开发态、配置和方法；本工具不读取快照。 | [app/forum/server/routes/api/local-forum/state.ts:13](../../../app/forum/server/routes/api/local-forum/state.ts#L13) |
| `GET/HEAD /api/local-forum/assets/:hash` | `development-only` | 按哈希白名单提供只读快照附件及单段 Range；本工具不读取附件。 | [app/forum/server/routes/api/local-forum/assets/[hash].ts:15](../../../app/forum/server/routes/api/local-forum/assets/[hash].ts#L15) |
| `GET/HEAD /llms.txt` | `nitro-and-prerender` | demo与本机快照本地生成；site开发代理核心动态授权出口，生产静态镜像不携带该文件。 | [app/forum/server/middleware/forum-markdown.ts:34](../../../app/forum/server/middleware/forum-markdown.ts#L34) |
| `GET/HEAD /t/:id.md` | `nitro-and-prerender` | demo与本机快照本地生成；site开发代理核心动态授权出口，生产静态镜像不携带话题Markdown。 | [app/forum/server/middleware/forum-markdown.ts:22](../../../app/forum/server/middleware/forum-markdown.ts#L22) |
| `GET/HEAD /published/:file` | `nitro-and-prerender` | site开发把旧帖图片转给核心按当前viewer授权；demo保留public静态素材，site镜像删除该目录。 | [app/forum/server/middleware/forum-markdown.ts:23](../../../app/forum/server/middleware/forum-markdown.ts#L23) |

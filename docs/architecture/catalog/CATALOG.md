# 项目目录

> 应用、运行单元、业务域与源码证据的统一入口；不表示线上部署状态。

状态：`current` · 更新：2026-10-18 · 自动生成，不手工编辑。

来源摘要：`6e752944da9e196c7d0b95ba3037551c28986ac8e1e6e7e3b865277d5e1c2128`。更新日期指目录声明版本，数据新鲜度由摘要和 `pnpm check:catalog` 核对。

[使用与维护](README.md) · [总览](CATALOG.md) · [接口](routes.md) · [数据](data-model.md) · [权限](permissions.md) · [机器目录](catalog.json)

## 基线

- 4 个源码应用，3 个运行单元。
- 203 个已注册方法与路径，其中业务操作 115 个，自动 HEAD 59 个。
- 32 张应用表，21 个能力，121 条显式业务流程。
- 响应 Schema：34/203。缺失不等于没有响应；不冒充完整 OpenAPI。

业务流程关联：115/115 个业务操作；5/5 个补充入口。遗漏关联时生成失败。逐接口响应和错误说明见[接口行为契约](../../services/server/endpoint-contracts.md)。

## 应用与运行单元

| 应用 | 代码 | 包 | 运行单元 | 合同 |
|---|---|---|---|---|
| 官网 | `app/web` | `@yzgc/web` | `web` | [docs/services/web/README.md](../../../docs/services/web/README.md) |
| 控制台 | `app/console` | `@yzgc/console` | `web` | [docs/services/console/README.md](../../../docs/services/console/README.md) |
| 核心后端 | `app/server` | `@yzgc/server` | `server` | [docs/services/server/README.md](../../../docs/services/server/README.md) |
| 论坛 | `app/forum` | `tuff-forum` | `forum` | [docs/services/forum/README.md](../../../docs/services/forum/README.md) |

运行单元从两套 compose 核对；控制台是独立源码应用，但产物随 web 镜像交付。

## 业务域

| 业务 | 接口注册 | 数据表 | 业务说明 |
|---|---:|---|---|
| 身份与会话 | 7 | `sessions` | [docs/architecture/SECURITY.md](../../../docs/architecture/SECURITY.md) |
| 组织与权限 | 20 | `departments`、`titles`、`role_assignments`、`console_seeds` | [docs/services/console/README.md](../../../docs/services/console/README.md) · [docs/architecture/SECURITY.md](../../../docs/architecture/SECURITY.md) |
| 招新投递 | 8 | `applications`、`application_reviews`、`application_limits` | [docs/architecture/API.md](../../../docs/architecture/API.md) · [docs/services/server/data-model.md](../../../docs/services/server/data-model.md) · [docs/ops/USAGE.md](../../../docs/ops/USAGE.md) |
| 意见反馈 | 13 | `feedback` | [docs/architecture/API.md](../../../docs/architecture/API.md) · [docs/services/server/data-model.md](../../../docs/services/server/data-model.md) |
| 组织邀请 | 11 | `invite_links`、`invite_attempts`、`invitations` | [docs/architecture/API.md](../../../docs/architecture/API.md) · [docs/services/server/data-model.md](../../../docs/services/server/data-model.md) |
| GitHub 组织代理 | 46 | 无本地表 | [docs/services/console/README.md](../../../docs/services/console/README.md) · [docs/architecture/API.md](../../../docs/architecture/API.md) |
| 论坛交流 | 21 | `forum_counters`、`forum_avatars`、`forum_users`、`forum_tags`、`forum_topics`、`forum_posts`、`forum_likes`、`forum_bookmarks`、`forum_follows`、`forum_notifications`、`forum_topic_views`、`forum_rate_events` | [docs/services/forum/README.md](../../../docs/services/forum/README.md) · [docs/services/server/data-model.md](../../../docs/services/server/data-model.md) |
| 通知邮件 | 0 | `mail_outbox` | [docs/services/server/mail.md](../../../docs/services/server/mail.md) |
| 审计 | 4 | `audit_logs` | [docs/architecture/SECURITY.md](../../../docs/architecture/SECURITY.md) · [docs/services/server/data-model.md](../../../docs/services/server/data-model.md) |
| 公开文档 | 4 | 无本地表 | [docs/conventions/DOCUMENTATION.md](../../../docs/conventions/DOCUMENTATION.md) · [docs/architecture/API.md](../../../docs/architecture/API.md) |
| 基础设施与兼容入口 | 38 | `app_state` | [docs/architecture/ARCHITECTURE.md](../../../docs/architecture/ARCHITECTURE.md) · [docs/services/server/README.md](../../../docs/services/server/README.md) · [docs/conventions/ARCHITECTURE-ALIGNMENT.md](../../../docs/conventions/ARCHITECTURE-ALIGNMENT.md) |
| 比赛与战队 | 31 | `competitions`、`competition_signup_settings`、`competition_signups`、`competition_teams`、`competition_team_members` | [docs/architecture/API.md](../../../docs/architecture/API.md) · [docs/services/server/data-model.md](../../../docs/services/server/data-model.md) · [docs/services/console/README.md](../../../docs/services/console/README.md) |

## 业务流程

### 取消投递

标识：`flow:application.cancel`；性质：显式声明并关联源码，不是自动证明业务正确。

- 操作：`PATCH /api/console/applications/:application_id`
- 能力：`applications.review`
- 读取：`applications`、`application_reviews`
- 写入：`applications`、`application_reviews`、`audit_logs`
- 不入队：`mail_outbox`
- 取消保留简历并追加审核历史；需要 applications.review。
- 修改状态必须带 expected_status 与 expected_review_id；版本冲突拒绝写入。
- 取消不生成通知邮件；已经排队或发出的其他邮件不撤回。

源码：[app/server/src/routes/console/applications.ts:118](../../../app/server/src/routes/console/applications.ts#L118) · [app/server/src/routes/console/applications.ts:135](../../../app/server/src/routes/console/applications.ts#L135) · [app/server/src/routes/console/applications.ts:149](../../../app/server/src/routes/console/applications.ts#L149) · [app/server/src/routes/console/applications.ts:167](../../../app/server/src/routes/console/applications.ts#L167)

测试入口：[tests/server/mail-outbox.test.ts](../../../tests/server/mail-outbox.test.ts) · [tests/server/console.test.ts](../../../tests/server/console.test.ts) · [tests/server/legacy-database.test.ts](../../../tests/server/legacy-database.test.ts)。生成器未执行这些测试。

### 发起 GitHub 登录

标识：`flow:identity.authorize`；性质：显式声明并关联源码，不是自动证明业务正确。

- 操作：`GET /auth/github`
- 能力：
- 读取：
- 写入：
- 不入队：
- 权限与资源：匿名可发起；return_to仅接受PUBLIC_ORIGIN，否则回控制台。
- 响应与错误：302跳到GitHub授权地址。
- 数据与副作用：生成随机state并写签名oauth_state cookie，不创建会话；本次响应不向GitHub发送token交换请求。

源码：[app/server/src/routes/admin/auth.ts:37](../../../app/server/src/routes/admin/auth.ts#L37) · [app/server/src/middleware/oauth-state.ts:18](../../../app/server/src/middleware/oauth-state.ts#L18)

测试入口：[tests/server/core.test.ts](../../../tests/server/core.test.ts)。生成器未执行这些测试。

### 校验登录回调并建立统一会话

标识：`flow:identity.callback`；性质：显式声明并关联源码，不是自动证明业务正确。

- 操作：`GET /auth/callback`
- 能力：
- 读取：
- 写入：`sessions`、`audit_logs`
- 不入队：
- 权限与资源：state与签名cookie必须相符且未过期；仅CONSOLE_ORG active成员成功。
- 响应与错误：成功302回return_to；取消/上游失败/非成员分别带signin结果回跳；缺参数或无效state为400，旧forum-state为410。
- 数据与副作用：调用GitHub换token、取用户、查本人组织成员状态；成功写sessions及auth.signin审计。非成员不建会话、审计拒绝并尽力撤销授权；失败日志不输出token。

源码：[app/server/src/routes/admin/auth.ts:44](../../../app/server/src/routes/admin/auth.ts#L44) · [app/server/src/lib/auth.ts:32](../../../app/server/src/lib/auth.ts#L32)

测试入口：[tests/server/core.test.ts](../../../tests/server/core.test.ts)。生成器未执行这些测试。

### 退出当前会话

标识：`flow:identity.signout`；性质：显式声明并关联源码，不是自动证明业务正确。

- 操作：`POST /auth/signout`
- 能力：
- 读取：`sessions`
- 写入：`sessions`、`audit_logs`
- 不入队：
- 权限与资源：仅销毁cookie sid对应本站会话；允许没有会话的幂等退出，仍受共同写请求Origin校验。
- 响应与错误：200 {ok:true}；不向调用者泄露sid是否存在。
- 数据与副作用：清sid和旧forum_sid cookie；实际读取到会话才写auth.signout，不撤销GitHub授权。

源码：[app/server/src/routes/admin/auth.ts:81](../../../app/server/src/routes/admin/auth.ts#L81)

测试入口：[tests/server/core.test.ts](../../../tests/server/core.test.ts) · [tests/server/session-cleanup.test.ts](../../../tests/server/session-cleanup.test.ts)。生成器未执行这些测试。

### 读取统一登录状态与控制台入口

标识：`flow:identity.current`；性质：显式声明并关联源码，不是自动证明业务正确。

- 操作：`GET /auth/me`
- 能力：
- 读取：`sessions`、`role_assignments`、`departments`、`titles`
- 写入：`sessions`、`audit_logs`
- 不入队：
- 权限与资源：只返回当前sid的身份；console_link是显示提示，不赋予后端权限。
- 响应与错误：200 {signed_in:false}或身份字段及console_link；GitHub拒绝token时200 {signed_in:false,session_expired:true}，其他角色查询失败仍保持登录但入口false。
- 数据与副作用：访问GitHub角色缓存和权限数据；过期/被拒token才删会话，拒绝token写审计；无其他业务写入。

源码：[app/server/src/routes/admin/auth.ts:98](../../../app/server/src/routes/admin/auth.ts#L98) · [app/server/src/lib/access.ts:19](../../../app/server/src/lib/access.ts#L19)

测试入口：[tests/server/core.test.ts](../../../tests/server/core.test.ts) · [tests/server/console.test.ts](../../../tests/server/console.test.ts)。生成器未执行这些测试。

### 列出本人组织

标识：`flow:github.organizations.list`；性质：显式声明并关联源码，不是自动证明业务正确。

- 操作：`GET /api/me/orgs`
- 能力：
- 读取：`sessions`
- 写入：`sessions`、`audit_logs`
- 不入队：
- 权限与资源：仅有效会话，读取本人active组织并按ALLOWED_ORGS过滤。
- 响应与错误：200 {orgs,allowed_orgs}；仅active成员组织并按配置过滤。
- 数据与副作用：GET /user/memberships/orgs，按登录名缓存120秒。
- 会话读取遇到过期会话才删除 sessions；没有有效会话返回401，不把界面显隐作为授权。

源码：[app/server/src/routes/admin/orgs.ts:10](../../../app/server/src/routes/admin/orgs.ts#L10) · [app/server/src/middleware/require-auth.ts:17](../../../app/server/src/middleware/require-auth.ts#L17) · [app/server/src/lib/auth.ts:46](../../../app/server/src/lib/auth.ts#L46)

测试入口：[tests/server/core.test.ts](../../../tests/server/core.test.ts) · [tests/server/upstream-errors.test.ts](../../../tests/server/upstream-errors.test.ts)。生成器未执行这些测试。

### 浏览组织活动

标识：`flow:github.activity.read`；性质：显式声明并关联源码，不是自动证明业务正确。

- 操作：`GET /api/admin/:org/activity`
- 能力：
- 读取：`sessions`
- 写入：`sessions`、`audit_logs`
- 不入队：
- 权限与资源：有效会话，requireOrgRole("member")；仅URL组织，允许列表与实际成员角色双重约束，上游按本人token判断资源权限。
- 响应与错误：200 {events}，输出actor、repo、时间及摘要。
- 数据与副作用：请求GitHub组织最近100条事件，不写本地活动表。
- 会话读取遇到过期会话才删除 sessions；没有有效会话返回401，不把界面显隐作为授权。
- GitHub 调用经全局错误处理发现令牌失效时才结束当前会话并审计；普通成功读取不写操作审计。
- 验证边界：core/upstream-errors 是通用鉴权或部分上游错误回归；本接口专属的成功负载与GitHub真实副作用尚未由这些测试完整证明。

源码：[app/server/src/routes/admin/activity.ts:9](../../../app/server/src/routes/admin/activity.ts#L9) · [app/server/src/middleware/require-auth.ts:17](../../../app/server/src/middleware/require-auth.ts#L17) · [app/server/src/lib/auth.ts:46](../../../app/server/src/lib/auth.ts#L46) · [app/server/src/middleware/require-org-role.ts:5](../../../app/server/src/middleware/require-org-role.ts#L5)

测试入口：[tests/server/core.test.ts](../../../tests/server/core.test.ts) · [tests/server/upstream-errors.test.ts](../../../tests/server/upstream-errors.test.ts)。生成器未执行这些测试。

### 读取组织资料

标识：`flow:github.organization.read`；性质：显式声明并关联源码，不是自动证明业务正确。

- 操作：`GET /api/admin/:org/org`
- 能力：
- 读取：`sessions`
- 写入：`sessions`、`audit_logs`
- 不入队：
- 权限与资源：有效会话，requireOrgRole("member")；仅URL组织，允许列表与实际成员角色双重约束，上游按本人token判断资源权限。
- 响应与错误：200 GitHub组织响应对象。
- 数据与副作用：向GitHub读取URL组织资料。
- 会话读取遇到过期会话才删除 sessions；没有有效会话返回401，不把界面显隐作为授权。
- GitHub 调用经全局错误处理发现令牌失效时才结束当前会话并审计；普通成功读取不写操作审计。
- 验证边界：core/upstream-errors 是通用鉴权或部分上游错误回归；本接口专属的成功负载与GitHub真实副作用尚未由这些测试完整证明。

源码：[app/server/src/routes/admin/org.ts:21](../../../app/server/src/routes/admin/org.ts#L21) · [app/server/src/middleware/require-auth.ts:17](../../../app/server/src/middleware/require-auth.ts#L17) · [app/server/src/lib/auth.ts:46](../../../app/server/src/lib/auth.ts#L46) · [app/server/src/middleware/require-org-role.ts:5](../../../app/server/src/middleware/require-org-role.ts#L5)

测试入口：[tests/server/core.test.ts](../../../tests/server/core.test.ts) · [tests/server/upstream-errors.test.ts](../../../tests/server/upstream-errors.test.ts)。生成器未执行这些测试。

### 查看组织概览

标识：`flow:github.overview.read`；性质：显式声明并关联源码，不是自动证明业务正确。

- 操作：`GET /api/admin/:org/overview`
- 能力：
- 读取：`invitations`、`invite_links`、`sessions`
- 写入：`sessions`、`audit_logs`
- 不入队：
- 权限与资源：有效会话，requireOrgRole("member")；仅URL组织，允许列表与实际成员角色双重约束，上游按本人token判断资源权限。
- 响应与错误：200 {role,org,counts}；成员/邀请/仓库子查询失败各降为空数组，组织主查询失败仍抛错。
- 数据与副作用：聚合GitHub组织、成员、邀请、仓库与本地24小时邀请数和活跃链接数，不发出邀请。
- 会话读取遇到过期会话才删除 sessions；没有有效会话返回401，不把界面显隐作为授权。
- GitHub 调用经全局错误处理发现令牌失效时才结束当前会话并审计；普通成功读取不写操作审计。
- 验证边界：core/upstream-errors 是通用鉴权或部分上游错误回归；本接口专属的成功负载与GitHub真实副作用尚未由这些测试完整证明。

源码：[app/server/src/routes/admin/overview.ts:10](../../../app/server/src/routes/admin/overview.ts#L10) · [app/server/src/middleware/require-auth.ts:17](../../../app/server/src/middleware/require-auth.ts#L17) · [app/server/src/lib/auth.ts:46](../../../app/server/src/lib/auth.ts#L46) · [app/server/src/middleware/require-org-role.ts:5](../../../app/server/src/middleware/require-org-role.ts#L5)

测试入口：[tests/server/core.test.ts](../../../tests/server/core.test.ts) · [tests/server/upstream-errors.test.ts](../../../tests/server/upstream-errors.test.ts)。生成器未执行这些测试。

### 查看组织安全能力

标识：`flow:github.security.read`；性质：显式声明并关联源码，不是自动证明业务正确。

- 操作：`GET /api/admin/:org/security`
- 能力：
- 读取：`sessions`
- 写入：`sessions`、`audit_logs`
- 不入队：
- 权限与资源：有效会话，requireOrgRole("member")；仅URL组织，允许列表与实际成员角色双重约束，上游按本人token判断资源权限。
- 响应与错误：200 {plan,two_factor_required,dependabot,secret_scanning,audit_log}；Dependabot失败落入嵌套error字段。
- 数据与副作用：读取GitHub组织计划，非free再查Dependabot；此接口是摘要，不配置安全策略或购买服务。
- 会话读取遇到过期会话才删除 sessions；没有有效会话返回401，不把界面显隐作为授权。
- GitHub 调用经全局错误处理发现令牌失效时才结束当前会话并审计；普通成功读取不写操作审计。
- 验证边界：core/upstream-errors 是通用鉴权或部分上游错误回归；本接口专属的成功负载与GitHub真实副作用尚未由这些测试完整证明。

源码：[app/server/src/routes/admin/security.ts:9](../../../app/server/src/routes/admin/security.ts#L9) · [app/server/src/middleware/require-auth.ts:17](../../../app/server/src/middleware/require-auth.ts#L17) · [app/server/src/lib/auth.ts:46](../../../app/server/src/lib/auth.ts#L46) · [app/server/src/middleware/require-org-role.ts:5](../../../app/server/src/middleware/require-org-role.ts#L5)

测试入口：[tests/server/core.test.ts](../../../tests/server/core.test.ts) · [tests/server/upstream-errors.test.ts](../../../tests/server/upstream-errors.test.ts)。生成器未执行这些测试。

### 查看组织成员角色

标识：`flow:github.members.list`；性质：显式声明并关联源码，不是自动证明业务正确。

- 操作：`GET /api/admin/:org/members`
- 能力：
- 读取：`sessions`
- 写入：`sessions`、`audit_logs`
- 不入队：
- 权限与资源：有效会话，requireOrgRole("member")；仅URL组织，允许列表与实际成员角色双重约束，上游按本人token判断资源权限。
- 响应与错误：200 {members,viewer_role}；单个成员详情失败将role/state设为?，名单请求失败仍抛错。
- 数据与副作用：分页读取GitHub成员并补角色，不改变组织成员关系。
- 会话读取遇到过期会话才删除 sessions；没有有效会话返回401，不把界面显隐作为授权。
- GitHub 调用经全局错误处理发现令牌失效时才结束当前会话并审计；普通成功读取不写操作审计。
- 验证边界：core/upstream-errors 是通用鉴权或部分上游错误回归；本接口专属的成功负载与GitHub真实副作用尚未由这些测试完整证明。

源码：[app/server/src/routes/admin/members.ts:10](../../../app/server/src/routes/admin/members.ts#L10) · [app/server/src/middleware/require-auth.ts:17](../../../app/server/src/middleware/require-auth.ts#L17) · [app/server/src/lib/auth.ts:46](../../../app/server/src/lib/auth.ts#L46) · [app/server/src/middleware/require-org-role.ts:5](../../../app/server/src/middleware/require-org-role.ts#L5)

测试入口：[tests/server/core.test.ts](../../../tests/server/core.test.ts) · [tests/server/upstream-errors.test.ts](../../../tests/server/upstream-errors.test.ts)。生成器未执行这些测试。

### 查看团队及规模

标识：`flow:github.teams.list`；性质：显式声明并关联源码，不是自动证明业务正确。

- 操作：`GET /api/admin/:org/teams`
- 能力：
- 读取：`sessions`
- 写入：`sessions`、`audit_logs`
- 不入队：
- 权限与资源：有效会话，requireOrgRole("member")；仅URL组织，允许列表与实际成员角色双重约束，上游按本人token判断资源权限。
- 响应与错误：200 {teams}，每项增加member_count/repo_count；计数子请求失败记0。
- 数据与副作用：分页读取团队及成员/仓库计数，不缓存成数据库实体。
- 会话读取遇到过期会话才删除 sessions；没有有效会话返回401，不把界面显隐作为授权。
- GitHub 调用经全局错误处理发现令牌失效时才结束当前会话并审计；普通成功读取不写操作审计。
- 验证边界：core/upstream-errors 是通用鉴权或部分上游错误回归；本接口专属的成功负载与GitHub真实副作用尚未由这些测试完整证明。

源码：[app/server/src/routes/admin/teams.ts:10](../../../app/server/src/routes/admin/teams.ts#L10) · [app/server/src/middleware/require-auth.ts:17](../../../app/server/src/middleware/require-auth.ts#L17) · [app/server/src/lib/auth.ts:46](../../../app/server/src/lib/auth.ts#L46) · [app/server/src/middleware/require-org-role.ts:5](../../../app/server/src/middleware/require-org-role.ts#L5)

测试入口：[tests/server/core.test.ts](../../../tests/server/core.test.ts) · [tests/server/upstream-errors.test.ts](../../../tests/server/upstream-errors.test.ts)。生成器未执行这些测试。

### 移除组织成员

标识：`flow:github.members.remove`；性质：显式声明并关联源码，不是自动证明业务正确。

- 操作：`DELETE /api/admin/:org/members/:login`
- 能力：
- 读取：`sessions`
- 写入：`audit_logs`、`sessions`
- 不入队：
- 权限与资源：有效会话，requireOrgRole("admin")；仅URL组织，组织owner和允许列表校验通过后，仍由本人token操作上游资源。
- 响应与错误：200 {ok:true}；login等于本人时400，其他失败保留上游状态映射。
- 数据与副作用：向GitHub删除组织membership，成功写member.remove审计。
- 会话读取遇到过期会话才删除 sessions；没有有效会话返回401，不把界面显隐作为授权。
- GitHub 调用经全局错误处理发现令牌失效时才结束当前会话并审计；普通成功读取不写操作审计。
- 验证边界：core/upstream-errors 是通用鉴权或部分上游错误回归；本接口专属的成功负载与GitHub真实副作用尚未由这些测试完整证明。

源码：[app/server/src/routes/admin/members.ts:29](../../../app/server/src/routes/admin/members.ts#L29) · [app/server/src/middleware/require-auth.ts:17](../../../app/server/src/middleware/require-auth.ts#L17) · [app/server/src/lib/auth.ts:46](../../../app/server/src/lib/auth.ts#L46) · [app/server/src/middleware/require-org-role.ts:5](../../../app/server/src/middleware/require-org-role.ts#L5)

测试入口：[tests/server/core.test.ts](../../../tests/server/core.test.ts) · [tests/server/upstream-errors.test.ts](../../../tests/server/upstream-errors.test.ts)。生成器未执行这些测试。

### 调整组织成员角色

标识：`flow:github.members.role`；性质：显式声明并关联源码，不是自动证明业务正确。

- 操作：`PATCH /api/admin/:org/members/:login/role`
- 能力：
- 读取：`sessions`
- 写入：`audit_logs`、`sessions`
- 不入队：
- 权限与资源：有效会话，requireOrgRole("admin")；仅URL组织，组织owner和允许列表校验通过后，仍由本人token操作上游资源。
- 响应与错误：200 {ok:true}；role不是admin/member为400。
- 数据与副作用：PUT GitHub membership角色，成功写member.role审计。
- 会话读取遇到过期会话才删除 sessions；没有有效会话返回401，不把界面显隐作为授权。
- GitHub 调用经全局错误处理发现令牌失效时才结束当前会话并审计；普通成功读取不写操作审计。
- 验证边界：core/upstream-errors 是通用鉴权或部分上游错误回归；本接口专属的成功负载与GitHub真实副作用尚未由这些测试完整证明。

源码：[app/server/src/routes/admin/members.ts:40](../../../app/server/src/routes/admin/members.ts#L40) · [app/server/src/middleware/require-auth.ts:17](../../../app/server/src/middleware/require-auth.ts#L17) · [app/server/src/lib/auth.ts:46](../../../app/server/src/lib/auth.ts#L46) · [app/server/src/middleware/require-org-role.ts:5](../../../app/server/src/middleware/require-org-role.ts#L5)

测试入口：[tests/server/core.test.ts](../../../tests/server/core.test.ts) · [tests/server/upstream-errors.test.ts](../../../tests/server/upstream-errors.test.ts)。生成器未执行这些测试。

### 修改组织资料与策略

标识：`flow:github.organization.update`；性质：显式声明并关联源码，不是自动证明业务正确。

- 操作：`PATCH /api/admin/:org/org`
- 能力：
- 读取：`sessions`
- 写入：`audit_logs`、`sessions`
- 不入队：
- 权限与资源：有效会话，requireOrgRole("admin")；仅URL组织，组织owner和允许列表校验通过后，仍由本人token操作上游资源。
- 响应与错误：200 GitHub组织响应；没有允许编辑字段为400。
- 数据与副作用：仅转发EDITABLE_KEYS字段，成功写org.update审计；并不修改本地部署配置。
- 会话读取遇到过期会话才删除 sessions；没有有效会话返回401，不把界面显隐作为授权。
- GitHub 调用经全局错误处理发现令牌失效时才结束当前会话并审计；普通成功读取不写操作审计。
- 验证边界：core/upstream-errors 是通用鉴权或部分上游错误回归；本接口专属的成功负载与GitHub真实副作用尚未由这些测试完整证明。

源码：[app/server/src/routes/admin/org.ts:30](../../../app/server/src/routes/admin/org.ts#L30) · [app/server/src/middleware/require-auth.ts:17](../../../app/server/src/middleware/require-auth.ts#L17) · [app/server/src/lib/auth.ts:46](../../../app/server/src/lib/auth.ts#L46) · [app/server/src/middleware/require-org-role.ts:5](../../../app/server/src/middleware/require-org-role.ts#L5)

测试入口：[tests/server/core.test.ts](../../../tests/server/core.test.ts) · [tests/server/upstream-errors.test.ts](../../../tests/server/upstream-errors.test.ts)。生成器未执行这些测试。

### 创建组织团队

标识：`flow:github.teams.create`；性质：显式声明并关联源码，不是自动证明业务正确。

- 操作：`POST /api/admin/:org/teams`
- 能力：
- 读取：`sessions`
- 写入：`audit_logs`、`sessions`
- 不入队：
- 权限与资源：有效会话，requireOrgRole("admin")；仅URL组织，组织owner和允许列表校验通过后，仍由本人token操作上游资源。
- 响应与错误：200 {ok:true,team}；缺name为400。
- 数据与副作用：调用GitHub创建团队，记录team.create审计。
- 会话读取遇到过期会话才删除 sessions；没有有效会话返回401，不把界面显隐作为授权。
- GitHub 调用经全局错误处理发现令牌失效时才结束当前会话并审计；普通成功读取不写操作审计。
- 验证边界：core/upstream-errors 是通用鉴权或部分上游错误回归；本接口专属的成功负载与GitHub真实副作用尚未由这些测试完整证明。

源码：[app/server/src/routes/admin/teams.ts:28](../../../app/server/src/routes/admin/teams.ts#L28) · [app/server/src/middleware/require-auth.ts:17](../../../app/server/src/middleware/require-auth.ts#L17) · [app/server/src/lib/auth.ts:46](../../../app/server/src/lib/auth.ts#L46) · [app/server/src/middleware/require-org-role.ts:5](../../../app/server/src/middleware/require-org-role.ts#L5)

测试入口：[tests/server/core.test.ts](../../../tests/server/core.test.ts) · [tests/server/upstream-errors.test.ts](../../../tests/server/upstream-errors.test.ts)。生成器未执行这些测试。

### 删除组织团队

标识：`flow:github.teams.delete`；性质：显式声明并关联源码，不是自动证明业务正确。

- 操作：`DELETE /api/admin/:org/teams/:slug`
- 能力：
- 读取：`sessions`
- 写入：`audit_logs`、`sessions`
- 不入队：
- 权限与资源：有效会话，requireOrgRole("admin")；仅URL组织，组织owner和允许列表校验通过后，仍由本人token操作上游资源。
- 响应与错误：200 {ok:true}。
- 数据与副作用：删除URL组织中指定slug的GitHub团队，记录team.delete审计。
- 会话读取遇到过期会话才删除 sessions；没有有效会话返回401，不把界面显隐作为授权。
- GitHub 调用经全局错误处理发现令牌失效时才结束当前会话并审计；普通成功读取不写操作审计。
- 验证边界：core/upstream-errors 是通用鉴权或部分上游错误回归；本接口专属的成功负载与GitHub真实副作用尚未由这些测试完整证明。

源码：[app/server/src/routes/admin/teams.ts:42](../../../app/server/src/routes/admin/teams.ts#L42) · [app/server/src/middleware/require-auth.ts:17](../../../app/server/src/middleware/require-auth.ts#L17) · [app/server/src/lib/auth.ts:46](../../../app/server/src/lib/auth.ts#L46) · [app/server/src/middleware/require-org-role.ts:5](../../../app/server/src/middleware/require-org-role.ts#L5)

测试入口：[tests/server/core.test.ts](../../../tests/server/core.test.ts) · [tests/server/upstream-errors.test.ts](../../../tests/server/upstream-errors.test.ts)。生成器未执行这些测试。

### 查看组织仓库列表

标识：`flow:github.repositories.list`；性质：显式声明并关联源码，不是自动证明业务正确。

- 操作：`GET /api/admin/:org/repos`
- 能力：
- 读取：`sessions`
- 写入：`sessions`、`audit_logs`
- 不入队：
- 权限与资源：有效会话，requireOrgRole("member")；仅URL组织，允许列表与实际成员角色双重约束，上游按本人token判断资源权限。
- 响应与错误：200 {repos}，仅下发列表所需字段。
- 数据与副作用：本人token分页读取GitHub组织仓库，按login/org缓存60秒。
- 会话读取遇到过期会话才删除 sessions；没有有效会话返回401，不把界面显隐作为授权。
- GitHub 调用经全局错误处理发现令牌失效时才结束当前会话并审计；普通成功读取不写操作审计。
- 验证边界：core/upstream-errors 是通用鉴权或部分上游错误回归；本接口专属的成功负载与GitHub真实副作用尚未由这些测试完整证明。

源码：[app/server/src/routes/admin/repos.ts:11](../../../app/server/src/routes/admin/repos.ts#L11) · [app/server/src/middleware/require-auth.ts:17](../../../app/server/src/middleware/require-auth.ts#L17) · [app/server/src/lib/auth.ts:46](../../../app/server/src/lib/auth.ts#L46) · [app/server/src/middleware/require-org-role.ts:5](../../../app/server/src/middleware/require-org-role.ts#L5)

测试入口：[tests/server/core.test.ts](../../../tests/server/core.test.ts) · [tests/server/upstream-errors.test.ts](../../../tests/server/upstream-errors.test.ts)。生成器未执行这些测试。

### 查看仓库信息与成员

标识：`flow:github.repositories.detail`；性质：显式声明并关联源码，不是自动证明业务正确。

- 操作：`GET /api/admin/:org/repos/:repo`
- 能力：
- 读取：`sessions`
- 写入：`sessions`、`audit_logs`
- 不入队：
- 权限与资源：有效会话，requireOrgRole("member")；仅URL组织，允许列表与实际成员角色双重约束，上游按本人token判断资源权限。
- 响应与错误：200 {info,branches,collaborators,hooks}；后三个子查询失败降为空数组。
- 数据与副作用：本人token读取仓库、分支、协作者和hooks，按login/org/repo缓存60秒。
- 会话读取遇到过期会话才删除 sessions；没有有效会话返回401，不把界面显隐作为授权。
- GitHub 调用经全局错误处理发现令牌失效时才结束当前会话并审计；普通成功读取不写操作审计。
- 验证边界：core/upstream-errors 是通用鉴权或部分上游错误回归；本接口专属的成功负载与GitHub真实副作用尚未由这些测试完整证明。

源码：[app/server/src/routes/admin/repos.ts:41](../../../app/server/src/routes/admin/repos.ts#L41) · [app/server/src/middleware/require-auth.ts:17](../../../app/server/src/middleware/require-auth.ts#L17) · [app/server/src/lib/auth.ts:46](../../../app/server/src/lib/auth.ts#L46) · [app/server/src/middleware/require-org-role.ts:5](../../../app/server/src/middleware/require-org-role.ts#L5)

测试入口：[tests/server/core.test.ts](../../../tests/server/core.test.ts) · [tests/server/upstream-errors.test.ts](../../../tests/server/upstream-errors.test.ts)。生成器未执行这些测试。

### 浏览仓库目录

标识：`flow:github.repositories.tree`；性质：显式声明并关联源码，不是自动证明业务正确。

- 操作：`GET /api/admin/:org/repos/:repo/tree`
- 能力：
- 读取：`sessions`
- 写入：`sessions`、`audit_logs`
- 不入队：
- 权限与资源：有效会话，requireOrgRole("member")；仅URL组织，允许列表与实际成员角色双重约束，上游按本人token判断资源权限。
- 响应与错误：200 {path,entries}；目录优先排序。
- 数据与副作用：按path/ref读取GitHub contents，不接触服务端本地文件。
- 会话读取遇到过期会话才删除 sessions；没有有效会话返回401，不把界面显隐作为授权。
- GitHub 调用经全局错误处理发现令牌失效时才结束当前会话并审计；普通成功读取不写操作审计。
- 验证边界：core/upstream-errors 是通用鉴权或部分上游错误回归；本接口专属的成功负载与GitHub真实副作用尚未由这些测试完整证明。

源码：[app/server/src/routes/admin/repos.ts:63](../../../app/server/src/routes/admin/repos.ts#L63) · [app/server/src/middleware/require-auth.ts:17](../../../app/server/src/middleware/require-auth.ts#L17) · [app/server/src/lib/auth.ts:46](../../../app/server/src/lib/auth.ts#L46) · [app/server/src/middleware/require-org-role.ts:5](../../../app/server/src/middleware/require-org-role.ts#L5)

测试入口：[tests/server/core.test.ts](../../../tests/server/core.test.ts) · [tests/server/upstream-errors.test.ts](../../../tests/server/upstream-errors.test.ts)。生成器未执行这些测试。

### 阅读仓库文件

标识：`flow:github.repositories.file`；性质：显式声明并关联源码，不是自动证明业务正确。

- 操作：`GET /api/admin/:org/repos/:repo/file`
- 能力：
- 读取：`sessions`
- 写入：`sessions`、`audit_logs`
- 不入队：
- 权限与资源：有效会话，requireOrgRole("member")；仅URL组织，允许列表与实际成员角色双重约束，上游按本人token判断资源权限。
- 响应与错误：200 文件元数据和解码content；超过1MB返回too_large且不附正文；缺path或目录为400。
- 数据与副作用：按path/ref从GitHub读文件，base64仅转utf8，不执行内容。
- 会话读取遇到过期会话才删除 sessions；没有有效会话返回401，不把界面显隐作为授权。
- GitHub 调用经全局错误处理发现令牌失效时才结束当前会话并审计；普通成功读取不写操作审计。
- 验证边界：core/upstream-errors 是通用鉴权或部分上游错误回归；本接口专属的成功负载与GitHub真实副作用尚未由这些测试完整证明。

源码：[app/server/src/routes/admin/repos.ts:81](../../../app/server/src/routes/admin/repos.ts#L81) · [app/server/src/middleware/require-auth.ts:17](../../../app/server/src/middleware/require-auth.ts#L17) · [app/server/src/lib/auth.ts:46](../../../app/server/src/lib/auth.ts#L46) · [app/server/src/middleware/require-org-role.ts:5](../../../app/server/src/middleware/require-org-role.ts#L5)

测试入口：[tests/server/core.test.ts](../../../tests/server/core.test.ts) · [tests/server/upstream-errors.test.ts](../../../tests/server/upstream-errors.test.ts)。生成器未执行这些测试。

### 浏览提交列表

标识：`flow:github.repositories.commits`；性质：显式声明并关联源码，不是自动证明业务正确。

- 操作：`GET /api/admin/:org/repos/:repo/commits`
- 能力：
- 读取：`sessions`
- 写入：`sessions`、`audit_logs`
- 不入队：
- 权限与资源：有效会话，requireOrgRole("member")；仅URL组织，允许列表与实际成员角色双重约束，上游按本人token判断资源权限。
- 响应与错误：200 {commits}，包含摘要、完整message及作者；per_page最多100。
- 数据与副作用：按sha/path/page读取GitHub提交并缓存30秒。
- 会话读取遇到过期会话才删除 sessions；没有有效会话返回401，不把界面显隐作为授权。
- GitHub 调用经全局错误处理发现令牌失效时才结束当前会话并审计；普通成功读取不写操作审计。
- 验证边界：core/upstream-errors 是通用鉴权或部分上游错误回归；本接口专属的成功负载与GitHub真实副作用尚未由这些测试完整证明。

源码：[app/server/src/routes/admin/repos.ts:98](../../../app/server/src/routes/admin/repos.ts#L98) · [app/server/src/middleware/require-auth.ts:17](../../../app/server/src/middleware/require-auth.ts#L17) · [app/server/src/lib/auth.ts:46](../../../app/server/src/lib/auth.ts#L46) · [app/server/src/middleware/require-org-role.ts:5](../../../app/server/src/middleware/require-org-role.ts#L5)

测试入口：[tests/server/core.test.ts](../../../tests/server/core.test.ts) · [tests/server/upstream-errors.test.ts](../../../tests/server/upstream-errors.test.ts)。生成器未执行这些测试。

### 查看提交差异

标识：`flow:github.repositories.commit`；性质：显式声明并关联源码，不是自动证明业务正确。

- 操作：`GET /api/admin/:org/repos/:repo/commits/:sha`
- 能力：
- 读取：`sessions`
- 写入：`sessions`、`audit_logs`
- 不入队：
- 权限与资源：有效会话，requireOrgRole("member")；仅URL组织，允许列表与实际成员角色双重约束，上游按本人token判断资源权限。
- 响应与错误：200 {sha,message,author,actor,stats,files,html_url}；单文件patch截到30000字符。
- 数据与副作用：从GitHub取指定提交，不本地checkout。
- 会话读取遇到过期会话才删除 sessions；没有有效会话返回401，不把界面显隐作为授权。
- GitHub 调用经全局错误处理发现令牌失效时才结束当前会话并审计；普通成功读取不写操作审计。
- 验证边界：core/upstream-errors 是通用鉴权或部分上游错误回归；本接口专属的成功负载与GitHub真实副作用尚未由这些测试完整证明。

源码：[app/server/src/routes/admin/repos.ts:130](../../../app/server/src/routes/admin/repos.ts#L130) · [app/server/src/middleware/require-auth.ts:17](../../../app/server/src/middleware/require-auth.ts#L17) · [app/server/src/lib/auth.ts:46](../../../app/server/src/lib/auth.ts#L46) · [app/server/src/middleware/require-org-role.ts:5](../../../app/server/src/middleware/require-org-role.ts#L5)

测试入口：[tests/server/core.test.ts](../../../tests/server/core.test.ts) · [tests/server/upstream-errors.test.ts](../../../tests/server/upstream-errors.test.ts)。生成器未执行这些测试。

### 浏览仓库议题

标识：`flow:github.repositories.issues`；性质：显式声明并关联源码，不是自动证明业务正确。

- 操作：`GET /api/admin/:org/repos/:repo/issues`
- 能力：
- 读取：`sessions`
- 写入：`sessions`、`audit_logs`
- 不入队：
- 权限与资源：有效会话，requireOrgRole("member")；仅URL组织，允许列表与实际成员角色双重约束，上游按本人token判断资源权限。
- 响应与错误：200 {issues}，过滤pull_request项。
- 数据与副作用：按state分页读GitHub issues，缓存30秒；不创建issue。
- 会话读取遇到过期会话才删除 sessions；没有有效会话返回401，不把界面显隐作为授权。
- GitHub 调用经全局错误处理发现令牌失效时才结束当前会话并审计；普通成功读取不写操作审计。
- 验证边界：core/upstream-errors 是通用鉴权或部分上游错误回归；本接口专属的成功负载与GitHub真实副作用尚未由这些测试完整证明。

源码：[app/server/src/routes/admin/repos.ts:154](../../../app/server/src/routes/admin/repos.ts#L154) · [app/server/src/middleware/require-auth.ts:17](../../../app/server/src/middleware/require-auth.ts#L17) · [app/server/src/lib/auth.ts:46](../../../app/server/src/lib/auth.ts#L46) · [app/server/src/middleware/require-org-role.ts:5](../../../app/server/src/middleware/require-org-role.ts#L5)

测试入口：[tests/server/core.test.ts](../../../tests/server/core.test.ts) · [tests/server/upstream-errors.test.ts](../../../tests/server/upstream-errors.test.ts)。生成器未执行这些测试。

### 阅读议题及评论

标识：`flow:github.repositories.issue`；性质：显式声明并关联源码，不是自动证明业务正确。

- 操作：`GET /api/admin/:org/repos/:repo/issues/:n`
- 能力：
- 读取：`sessions`
- 写入：`sessions`、`audit_logs`
- 不入队：
- 权限与资源：有效会话，requireOrgRole("member")；仅URL组织，允许列表与实际成员角色双重约束，上游按本人token判断资源权限。
- 响应与错误：200 议题详情与comments；数字n传给GitHub。
- 数据与副作用：读取GitHub议题和评论，不把评论写入本地库。
- 会话读取遇到过期会话才删除 sessions；没有有效会话返回401，不把界面显隐作为授权。
- GitHub 调用经全局错误处理发现令牌失效时才结束当前会话并审计；普通成功读取不写操作审计。
- 验证边界：core/upstream-errors 是通用鉴权或部分上游错误回归；本接口专属的成功负载与GitHub真实副作用尚未由这些测试完整证明。

源码：[app/server/src/routes/admin/repos.ts:202](../../../app/server/src/routes/admin/repos.ts#L202) · [app/server/src/middleware/require-auth.ts:17](../../../app/server/src/middleware/require-auth.ts#L17) · [app/server/src/lib/auth.ts:46](../../../app/server/src/lib/auth.ts#L46) · [app/server/src/middleware/require-org-role.ts:5](../../../app/server/src/middleware/require-org-role.ts#L5)

测试入口：[tests/server/core.test.ts](../../../tests/server/core.test.ts) · [tests/server/upstream-errors.test.ts](../../../tests/server/upstream-errors.test.ts)。生成器未执行这些测试。

### 浏览合并请求

标识：`flow:github.repositories.pulls`；性质：显式声明并关联源码，不是自动证明业务正确。

- 操作：`GET /api/admin/:org/repos/:repo/pulls`
- 能力：
- 读取：`sessions`
- 写入：`sessions`、`audit_logs`
- 不入队：
- 权限与资源：有效会话，requireOrgRole("member")；仅URL组织，允许列表与实际成员角色双重约束，上游按本人token判断资源权限。
- 响应与错误：200 {pulls}，含head/base/draft/mergeable等上游字段。
- 数据与副作用：按state读取GitHub PR并缓存30秒。
- 会话读取遇到过期会话才删除 sessions；没有有效会话返回401，不把界面显隐作为授权。
- GitHub 调用经全局错误处理发现令牌失效时才结束当前会话并审计；普通成功读取不写操作审计。
- 验证边界：core/upstream-errors 是通用鉴权或部分上游错误回归；本接口专属的成功负载与GitHub真实副作用尚未由这些测试完整证明。

源码：[app/server/src/routes/admin/repos.ts:177](../../../app/server/src/routes/admin/repos.ts#L177) · [app/server/src/middleware/require-auth.ts:17](../../../app/server/src/middleware/require-auth.ts#L17) · [app/server/src/lib/auth.ts:46](../../../app/server/src/lib/auth.ts#L46) · [app/server/src/middleware/require-org-role.ts:5](../../../app/server/src/middleware/require-org-role.ts#L5)

测试入口：[tests/server/core.test.ts](../../../tests/server/core.test.ts) · [tests/server/upstream-errors.test.ts](../../../tests/server/upstream-errors.test.ts)。生成器未执行这些测试。

### 阅读合并请求差异

标识：`flow:github.repositories.pull`；性质：显式声明并关联源码，不是自动证明业务正确。

- 操作：`GET /api/admin/:org/repos/:repo/pulls/:n`
- 能力：
- 读取：`sessions`
- 写入：`sessions`、`audit_logs`
- 不入队：
- 权限与资源：有效会话，requireOrgRole("member")；仅URL组织，允许列表与实际成员角色双重约束，上游按本人token判断资源权限。
- 响应与错误：200 PR详情、comments、files；files请求失败为空，单patch截到20000字符。
- 数据与副作用：读取GitHub PR/评论/文件，不执行分支内容、不合并。
- 会话读取遇到过期会话才删除 sessions；没有有效会话返回401，不把界面显隐作为授权。
- GitHub 调用经全局错误处理发现令牌失效时才结束当前会话并审计；普通成功读取不写操作审计。
- 验证边界：core/upstream-errors 是通用鉴权或部分上游错误回归；本接口专属的成功负载与GitHub真实副作用尚未由这些测试完整证明。

源码：[app/server/src/routes/admin/repos.ts:228](../../../app/server/src/routes/admin/repos.ts#L228) · [app/server/src/middleware/require-auth.ts:17](../../../app/server/src/middleware/require-auth.ts#L17) · [app/server/src/lib/auth.ts:46](../../../app/server/src/lib/auth.ts#L46) · [app/server/src/middleware/require-org-role.ts:5](../../../app/server/src/middleware/require-org-role.ts#L5)

测试入口：[tests/server/core.test.ts](../../../tests/server/core.test.ts) · [tests/server/upstream-errors.test.ts](../../../tests/server/upstream-errors.test.ts)。生成器未执行这些测试。

### 合并仓库请求

标识：`flow:github.repositories.merge`；性质：显式声明并关联源码，不是自动证明业务正确。

- 操作：`PUT /api/admin/:org/repos/:repo/pulls/:n/merge`
- 能力：
- 读取：`sessions`
- 写入：`audit_logs`、`sessions`
- 不入队：
- 权限与资源：有效会话，requireOrgRole("member")；仅URL组织，允许列表与实际成员角色双重约束，上游按本人token判断资源权限。
- 响应与错误：200 {ok:true,merged,sha,message}，merged取上游；局部catch返回上游status或500及merge_failed/message，不走同一脱敏路径。
- 数据与副作用：按merge_method、可选sha调用GitHub merge，成功写pr.merge审计并清repo/repos缓存；授权和分支保护仍由GitHub决定。
- 会话读取遇到过期会话才删除 sessions；没有有效会话返回401，不把界面显隐作为授权。
- GitHub 调用经全局错误处理发现令牌失效时才结束当前会话并审计；普通成功读取不写操作审计。
- 验证边界：core/upstream-errors 是通用鉴权或部分上游错误回归；本接口专属的成功负载与GitHub真实副作用尚未由这些测试完整证明。

源码：[app/server/src/routes/admin/repos.ts:259](../../../app/server/src/routes/admin/repos.ts#L259) · [app/server/src/middleware/require-auth.ts:17](../../../app/server/src/middleware/require-auth.ts#L17) · [app/server/src/lib/auth.ts:46](../../../app/server/src/lib/auth.ts#L46) · [app/server/src/middleware/require-org-role.ts:5](../../../app/server/src/middleware/require-org-role.ts#L5)

测试入口：[tests/server/core.test.ts](../../../tests/server/core.test.ts) · [tests/server/upstream-errors.test.ts](../../../tests/server/upstream-errors.test.ts)。生成器未执行这些测试。

### 变更议题状态

标识：`flow:github.repositories.issue_state`；性质：显式声明并关联源码，不是自动证明业务正确。

- 操作：`PATCH /api/admin/:org/repos/:repo/issues/:n`
- 能力：
- 读取：`sessions`
- 写入：`audit_logs`、`sessions`
- 不入队：
- 权限与资源：有效会话，requireOrgRole("member")；仅URL组织，允许列表与实际成员角色双重约束，上游按本人token判断资源权限。
- 响应与错误：200 {ok:true,state}。
- 数据与副作用：向GitHub PATCH open/closed状态，写issue.<state>审计并清repo缓存。
- 会话读取遇到过期会话才删除 sessions；没有有效会话返回401，不把界面显隐作为授权。
- GitHub 调用经全局错误处理发现令牌失效时才结束当前会话并审计；普通成功读取不写操作审计。
- 验证边界：core/upstream-errors 是通用鉴权或部分上游错误回归；本接口专属的成功负载与GitHub真实副作用尚未由这些测试完整证明。

源码：[app/server/src/routes/admin/repos.ts:285](../../../app/server/src/routes/admin/repos.ts#L285) · [app/server/src/middleware/require-auth.ts:17](../../../app/server/src/middleware/require-auth.ts#L17) · [app/server/src/lib/auth.ts:46](../../../app/server/src/lib/auth.ts#L46) · [app/server/src/middleware/require-org-role.ts:5](../../../app/server/src/middleware/require-org-role.ts#L5)

测试入口：[tests/server/core.test.ts](../../../tests/server/core.test.ts) · [tests/server/upstream-errors.test.ts](../../../tests/server/upstream-errors.test.ts)。生成器未执行这些测试。

### 回复仓库议题

标识：`flow:github.repositories.comment`；性质：显式声明并关联源码，不是自动证明业务正确。

- 操作：`POST /api/admin/:org/repos/:repo/issues/:n/comments`
- 能力：
- 读取：`sessions`
- 写入：`audit_logs`、`sessions`
- 不入队：
- 权限与资源：有效会话，requireOrgRole("member")；仅URL组织，允许列表与实际成员角色双重约束，上游按本人token判断资源权限。
- 响应与错误：200 {ok:true,id,html_url}；空白body为400 empty_body。
- 数据与副作用：POST GitHub评论，写issue.comment审计；评论正文不写审计。
- 会话读取遇到过期会话才删除 sessions；没有有效会话返回401，不把界面显隐作为授权。
- GitHub 调用经全局错误处理发现令牌失效时才结束当前会话并审计；普通成功读取不写操作审计。
- 验证边界：core/upstream-errors 是通用鉴权或部分上游错误回归；本接口专属的成功负载与GitHub真实副作用尚未由这些测试完整证明。

源码：[app/server/src/routes/admin/repos.ts:301](../../../app/server/src/routes/admin/repos.ts#L301) · [app/server/src/middleware/require-auth.ts:17](../../../app/server/src/middleware/require-auth.ts#L17) · [app/server/src/lib/auth.ts:46](../../../app/server/src/lib/auth.ts#L46) · [app/server/src/middleware/require-org-role.ts:5](../../../app/server/src/middleware/require-org-role.ts#L5)

测试入口：[tests/server/core.test.ts](../../../tests/server/core.test.ts) · [tests/server/upstream-errors.test.ts](../../../tests/server/upstream-errors.test.ts)。生成器未执行这些测试。

### 创建组织仓库

标识：`flow:github.repositories.create`；性质：显式声明并关联源码，不是自动证明业务正确。

- 操作：`POST /api/admin/:org/create-repo`
- 能力：
- 读取：`sessions`
- 写入：`audit_logs`、`sessions`
- 不入队：
- 权限与资源：有效会话，requireOrgRole("admin")；仅URL组织，组织owner和允许列表校验通过后，仍由本人token操作上游资源。
- 响应与错误：200 {ok:true,repo:{name,full_name,html_url}}；非法name为400。
- 数据与副作用：向GitHub创建仓库（auto_init默认true），写repo.create审计并清repos缓存。
- 会话读取遇到过期会话才删除 sessions；没有有效会话返回401，不把界面显隐作为授权。
- GitHub 调用经全局错误处理发现令牌失效时才结束当前会话并审计；普通成功读取不写操作审计。
- 验证边界：core/upstream-errors 是通用鉴权或部分上游错误回归；本接口专属的成功负载与GitHub真实副作用尚未由这些测试完整证明。

源码：[app/server/src/routes/admin/repos.ts:317](../../../app/server/src/routes/admin/repos.ts#L317) · [app/server/src/middleware/require-auth.ts:17](../../../app/server/src/middleware/require-auth.ts#L17) · [app/server/src/lib/auth.ts:46](../../../app/server/src/lib/auth.ts#L46) · [app/server/src/middleware/require-org-role.ts:5](../../../app/server/src/middleware/require-org-role.ts#L5)

测试入口：[tests/server/core.test.ts](../../../tests/server/core.test.ts) · [tests/server/upstream-errors.test.ts](../../../tests/server/upstream-errors.test.ts)。生成器未执行这些测试。

### 删除组织仓库

标识：`flow:github.repositories.delete`；性质：显式声明并关联源码，不是自动证明业务正确。

- 操作：`DELETE /api/admin/:org/repos/:repo`
- 能力：
- 读取：`sessions`
- 写入：`audit_logs`、`sessions`
- 不入队：
- 权限与资源：有效会话，requireOrgRole("admin")；仅URL组织，组织owner和允许列表校验通过后，仍由本人token操作上游资源。
- 响应与错误：200 {ok:true}。
- 数据与副作用：DELETE GitHub仓库，成功审计repo.delete，清repo/repos缓存。
- 会话读取遇到过期会话才删除 sessions；没有有效会话返回401，不把界面显隐作为授权。
- GitHub 调用经全局错误处理发现令牌失效时才结束当前会话并审计；普通成功读取不写操作审计。
- 验证边界：core/upstream-errors 是通用鉴权或部分上游错误回归；本接口专属的成功负载与GitHub真实副作用尚未由这些测试完整证明。

源码：[app/server/src/routes/admin/repos.ts:338](../../../app/server/src/routes/admin/repos.ts#L338) · [app/server/src/middleware/require-auth.ts:17](../../../app/server/src/middleware/require-auth.ts#L17) · [app/server/src/lib/auth.ts:46](../../../app/server/src/lib/auth.ts#L46) · [app/server/src/middleware/require-org-role.ts:5](../../../app/server/src/middleware/require-org-role.ts#L5)

测试入口：[tests/server/core.test.ts](../../../tests/server/core.test.ts) · [tests/server/upstream-errors.test.ts](../../../tests/server/upstream-errors.test.ts)。生成器未执行这些测试。

### 授权仓库协作者

标识：`flow:github.repositories.collaborator_put`；性质：显式声明并关联源码，不是自动证明业务正确。

- 操作：`PUT /api/admin/:org/repos/:repo/collaborators/:login`
- 能力：
- 读取：`sessions`
- 写入：`audit_logs`、`sessions`
- 不入队：
- 权限与资源：有效会话，requireOrgRole("admin")；仅URL组织，组织owner和允许列表校验通过后，仍由本人token操作上游资源。
- 响应与错误：200 {ok:true}；permission默认push。
- 数据与副作用：PUT GitHub协作者权限，可能触发GitHub邀请；写repo.collab.add审计并清repo缓存。
- 会话读取遇到过期会话才删除 sessions；没有有效会话返回401，不把界面显隐作为授权。
- GitHub 调用经全局错误处理发现令牌失效时才结束当前会话并审计；普通成功读取不写操作审计。
- 验证边界：core/upstream-errors 是通用鉴权或部分上游错误回归；本接口专属的成功负载与GitHub真实副作用尚未由这些测试完整证明。

源码：[app/server/src/routes/admin/repos.ts:352](../../../app/server/src/routes/admin/repos.ts#L352) · [app/server/src/middleware/require-auth.ts:17](../../../app/server/src/middleware/require-auth.ts#L17) · [app/server/src/lib/auth.ts:46](../../../app/server/src/lib/auth.ts#L46) · [app/server/src/middleware/require-org-role.ts:5](../../../app/server/src/middleware/require-org-role.ts#L5)

测试入口：[tests/server/core.test.ts](../../../tests/server/core.test.ts) · [tests/server/upstream-errors.test.ts](../../../tests/server/upstream-errors.test.ts)。生成器未执行这些测试。

### 移除仓库协作者

标识：`flow:github.repositories.collaborator_delete`；性质：显式声明并关联源码，不是自动证明业务正确。

- 操作：`DELETE /api/admin/:org/repos/:repo/collaborators/:login`
- 能力：
- 读取：`sessions`
- 写入：`audit_logs`、`sessions`
- 不入队：
- 权限与资源：有效会话，requireOrgRole("admin")；仅URL组织，组织owner和允许列表校验通过后，仍由本人token操作上游资源。
- 响应与错误：200 {ok:true}。
- 数据与副作用：DELETE GitHub协作者，审计repo.collab.remove并清repo缓存。
- 会话读取遇到过期会话才删除 sessions；没有有效会话返回401，不把界面显隐作为授权。
- GitHub 调用经全局错误处理发现令牌失效时才结束当前会话并审计；普通成功读取不写操作审计。
- 验证边界：core/upstream-errors 是通用鉴权或部分上游错误回归；本接口专属的成功负载与GitHub真实副作用尚未由这些测试完整证明。

源码：[app/server/src/routes/admin/repos.ts:366](../../../app/server/src/routes/admin/repos.ts#L366) · [app/server/src/middleware/require-auth.ts:17](../../../app/server/src/middleware/require-auth.ts#L17) · [app/server/src/lib/auth.ts:46](../../../app/server/src/lib/auth.ts#L46) · [app/server/src/middleware/require-org-role.ts:5](../../../app/server/src/middleware/require-org-role.ts#L5)

测试入口：[tests/server/core.test.ts](../../../tests/server/core.test.ts) · [tests/server/upstream-errors.test.ts](../../../tests/server/upstream-errors.test.ts)。生成器未执行这些测试。

### 核对组织邀请与本地历史

标识：`flow:invitation.admin.list`；性质：显式声明并关联源码，不是自动证明业务正确。

- 操作：`GET /api/admin/:org/invitations`
- 能力：
- 读取：`invitations`、`sessions`
- 写入：`sessions`、`audit_logs`
- 不入队：
- 权限与资源：有效会话，requireOrgRole("admin")；仅URL组织，组织owner和允许列表校验通过后，仍由本人token操作上游资源。
- 响应与错误：200 {pending,history}；本地最近200条历史含邮箱、备注、source_ip和链接token，只对组织owner开放。
- 数据与副作用：分页读取GitHub待接受邀请及本组织本地历史，不发信或补发。
- 会话读取遇到过期会话才删除 sessions；没有有效会话返回401，不把界面显隐作为授权。
- GitHub 调用经全局错误处理发现令牌失效时才结束当前会话并审计；普通成功读取不写操作审计。

源码：[app/server/src/routes/admin/invitations.ts:10](../../../app/server/src/routes/admin/invitations.ts#L10) · [app/server/src/middleware/require-auth.ts:17](../../../app/server/src/middleware/require-auth.ts#L17) · [app/server/src/lib/auth.ts:46](../../../app/server/src/lib/auth.ts#L46) · [app/server/src/middleware/require-org-role.ts:5](../../../app/server/src/middleware/require-org-role.ts#L5)

测试入口：[tests/server/invitations.test.ts](../../../tests/server/invitations.test.ts) · [tests/server/core.test.ts](../../../tests/server/core.test.ts) · [tests/server/console.test.ts](../../../tests/server/console.test.ts)。生成器未执行这些测试。

### 取消尚未接受的组织邀请

标识：`flow:invitation.admin.cancel`；性质：显式声明并关联源码，不是自动证明业务正确。

- 操作：`DELETE /api/admin/:org/invitations/:id`
- 能力：
- 读取：`sessions`
- 写入：`audit_logs`、`sessions`
- 不入队：
- 权限与资源：有效会话，requireOrgRole("admin")；仅URL组织，组织owner和允许列表校验通过后，仍由本人token操作上游资源。
- 响应与错误：200 {ok:true}；非有限数id为400。
- 数据与副作用：调用GitHub取消邀请，写invitation.cancel审计；不回写历史invitations状态或返还链接额度。
- 会话读取遇到过期会话才删除 sessions；没有有效会话返回401，不把界面显隐作为授权。
- GitHub 调用经全局错误处理发现令牌失效时才结束当前会话并审计；普通成功读取不写操作审计。

源码：[app/server/src/routes/admin/invitations.ts:22](../../../app/server/src/routes/admin/invitations.ts#L22) · [app/server/src/middleware/require-auth.ts:17](../../../app/server/src/middleware/require-auth.ts#L17) · [app/server/src/lib/auth.ts:46](../../../app/server/src/lib/auth.ts#L46) · [app/server/src/middleware/require-org-role.ts:5](../../../app/server/src/middleware/require-org-role.ts#L5)

测试入口：[tests/server/invitations.test.ts](../../../tests/server/invitations.test.ts) · [tests/server/core.test.ts](../../../tests/server/core.test.ts) · [tests/server/console.test.ts](../../../tests/server/console.test.ts)。生成器未执行这些测试。

### 查看组织邀请链接

标识：`flow:invitation.links.list`；性质：显式声明并关联源码，不是自动证明业务正确。

- 操作：`GET /api/admin/:org/invite-links`
- 能力：
- 读取：`invite_links`、`sessions`
- 写入：`sessions`、`audit_logs`
- 不入队：
- 权限与资源：有效会话，requireOrgRole("admin")；仅URL组织，组织owner和允许列表校验通过后，仍由本人token操作上游资源。
- 响应与错误：200 {links}；包含完整token及配额，不包含发起人加密token。
- 数据与副作用：仅按URL org读取链接，持有token即可走公开邀请流程，应保留owner门槛。
- 会话读取遇到过期会话才删除 sessions；没有有效会话返回401，不把界面显隐作为授权。
- GitHub 调用经全局错误处理发现令牌失效时才结束当前会话并审计；普通成功读取不写操作审计。

源码：[app/server/src/routes/admin/invite-links.ts:18](../../../app/server/src/routes/admin/invite-links.ts#L18) · [app/server/src/middleware/require-auth.ts:17](../../../app/server/src/middleware/require-auth.ts#L17) · [app/server/src/lib/auth.ts:46](../../../app/server/src/lib/auth.ts#L46) · [app/server/src/middleware/require-org-role.ts:5](../../../app/server/src/middleware/require-org-role.ts#L5)

测试入口：[tests/server/invitations.test.ts](../../../tests/server/invitations.test.ts) · [tests/server/core.test.ts](../../../tests/server/core.test.ts) · [tests/server/console.test.ts](../../../tests/server/console.test.ts)。生成器未执行这些测试。

### 创建限时组织邀请链接

标识：`flow:invitation.links.create`；性质：显式声明并关联源码，不是自动证明业务正确。

- 操作：`POST /api/admin/:org/invite-links`
- 能力：
- 读取：`sessions`
- 写入：`invite_links`、`audit_logs`、`sessions`
- 不入队：
- 权限与资源：有效会话，requireOrgRole("admin")；仅URL组织，组织owner和允许列表校验通过后，仍由本人token操作上游资源。
- 响应与错误：200 {ok:true,token,url,expires_at}；hours范围或max_uses整数范围不合法为400。
- 数据与副作用：生成18字节随机token，保存发起人token密文、有效期与配额，写invite_link.create；不立即发送邀请。
- 会话读取遇到过期会话才删除 sessions；没有有效会话返回401，不把界面显隐作为授权。
- GitHub 调用经全局错误处理发现令牌失效时才结束当前会话并审计；普通成功读取不写操作审计。

源码：[app/server/src/routes/admin/invite-links.ts:28](../../../app/server/src/routes/admin/invite-links.ts#L28) · [app/server/src/middleware/require-auth.ts:17](../../../app/server/src/middleware/require-auth.ts#L17) · [app/server/src/lib/auth.ts:46](../../../app/server/src/lib/auth.ts#L46) · [app/server/src/middleware/require-org-role.ts:5](../../../app/server/src/middleware/require-org-role.ts#L5)

测试入口：[tests/server/invitations.test.ts](../../../tests/server/invitations.test.ts) · [tests/server/core.test.ts](../../../tests/server/core.test.ts) · [tests/server/console.test.ts](../../../tests/server/console.test.ts)。生成器未执行这些测试。

### 启停组织邀请链接

标识：`flow:invitation.links.toggle`；性质：显式声明并关联源码，不是自动证明业务正确。

- 操作：`PATCH /api/admin/:org/invite-links/:token`
- 能力：
- 读取：`invite_links`、`sessions`
- 写入：`invite_links`、`audit_logs`、`sessions`
- 不入队：
- 权限与资源：有效会话，requireOrgRole("admin")；仅URL组织，组织owner和允许列表校验通过后，仍由本人token操作上游资源。
- 响应与错误：200 {ok:true}；token不属于该org为404 not_found。
- 数据与副作用：按token和org找链接后更新disabled并审计，不撤回已经发出的GitHub邀请。
- 会话读取遇到过期会话才删除 sessions；没有有效会话返回401，不把界面显隐作为授权。
- GitHub 调用经全局错误处理发现令牌失效时才结束当前会话并审计；普通成功读取不写操作审计。

源码：[app/server/src/routes/admin/invite-links.ts:60](../../../app/server/src/routes/admin/invite-links.ts#L60) · [app/server/src/middleware/require-auth.ts:17](../../../app/server/src/middleware/require-auth.ts#L17) · [app/server/src/lib/auth.ts:46](../../../app/server/src/lib/auth.ts#L46) · [app/server/src/middleware/require-org-role.ts:5](../../../app/server/src/middleware/require-org-role.ts#L5)

测试入口：[tests/server/invitations.test.ts](../../../tests/server/invitations.test.ts) · [tests/server/core.test.ts](../../../tests/server/core.test.ts) · [tests/server/console.test.ts](../../../tests/server/console.test.ts)。生成器未执行这些测试。

### 删除组织邀请链接

标识：`flow:invitation.links.delete`；性质：显式声明并关联源码，不是自动证明业务正确。

- 操作：`DELETE /api/admin/:org/invite-links/:token`
- 能力：
- 读取：`invite_links`、`sessions`
- 写入：`invite_links`、`audit_logs`、`sessions`
- 不入队：
- 权限与资源：有效会话，requireOrgRole("admin")；仅URL组织，组织owner和允许列表校验通过后，仍由本人token操作上游资源。
- 响应与错误：200 {ok:true}；没有匹配org/token为404 not_found。
- 数据与副作用：删除匹配链接并审计invite_link.delete；不删除邀请历史，不撤销GitHub既有邀请。
- 会话读取遇到过期会话才删除 sessions；没有有效会话返回401，不把界面显隐作为授权。
- GitHub 调用经全局错误处理发现令牌失效时才结束当前会话并审计；普通成功读取不写操作审计。

源码：[app/server/src/routes/admin/invite-links.ts:74](../../../app/server/src/routes/admin/invite-links.ts#L74) · [app/server/src/middleware/require-auth.ts:17](../../../app/server/src/middleware/require-auth.ts#L17) · [app/server/src/lib/auth.ts:46](../../../app/server/src/lib/auth.ts#L46) · [app/server/src/middleware/require-org-role.ts:5](../../../app/server/src/middleware/require-org-role.ts#L5)

测试入口：[tests/server/invitations.test.ts](../../../tests/server/invitations.test.ts) · [tests/server/core.test.ts](../../../tests/server/core.test.ts) · [tests/server/console.test.ts](../../../tests/server/console.test.ts)。生成器未执行这些测试。

### 读取组织管理员审计

标识：`flow:audit.organization.read`；性质：显式声明并关联源码，不是自动证明业务正确。

- 操作：`GET /api/admin/:org/logs`
- 能力：
- 读取：`audit_logs`、`sessions`
- 写入：`sessions`、`audit_logs`
- 不入队：
- 权限与资源：有效会话，requireOrgRole("admin")；仅URL组织，组织owner和允许列表校验通过后，仍由本人token操作上游资源。
- 响应与错误：200 {logs}；details解析为对象，limit最多500。
- 数据与副作用：只按URL org查询审计。与console审计不同，此处组织owner能看到完整邀请token；org为null的登录审计不返回。
- 会话读取遇到过期会话才删除 sessions；没有有效会话返回401，不把界面显隐作为授权。
- GitHub 调用经全局错误处理发现令牌失效时才结束当前会话并审计；普通成功读取不写操作审计。

源码：[app/server/src/routes/admin/logs.ts:9](../../../app/server/src/routes/admin/logs.ts#L9) · [app/server/src/middleware/require-auth.ts:17](../../../app/server/src/middleware/require-auth.ts#L17) · [app/server/src/lib/auth.ts:46](../../../app/server/src/lib/auth.ts#L46) · [app/server/src/middleware/require-org-role.ts:5](../../../app/server/src/middleware/require-org-role.ts#L5)

测试入口：[tests/server/console.test.ts](../../../tests/server/console.test.ts) · [tests/server/core.test.ts](../../../tests/server/core.test.ts)。生成器未执行这些测试。

### 解析本人控制台身份

标识：`flow:console.identity`；性质：显式声明并关联源码，不是自动证明业务正确。

- 操作：`GET /api/console/me`
- 能力：
- 读取：`sessions`、`role_assignments`、`departments`、`titles`
- 写入：`sessions`、`audit_logs`
- 不入队：
- 权限与资源：只需有效会话；回答当前登录者的称号/能力/被GitHub上限挡掉的能力，不接受自报role。
- 响应与错误：200 {login,avatar_url,org,github_role,title,titles,capabilities,blocked,head_of}。
- 数据与副作用：只计算当前身份；查GitHub失败按错误处理，不降级为非成员；存在会话不等于拥有console.access。
- 共同身份路径：读取当前sid及称号权限包，GitHub角色最多缓存60秒；仅过期/令牌失效才删除会话，令牌失效还写一次审计，不代表每次成功读都审计。

源码：[app/server/src/routes/console/me.ts:14](../../../app/server/src/routes/console/me.ts#L14) · [app/server/src/lib/access.ts:19](../../../app/server/src/lib/access.ts#L19) · [app/server/src/middleware/require-capability.ts:12](../../../app/server/src/middleware/require-capability.ts#L12)

测试入口：[tests/server/console.test.ts](../../../tests/server/console.test.ts)。生成器未执行这些测试。

### 按能力读取工作概览

标识：`flow:console.summary`；性质：显式声明并关联源码，不是自动证明业务正确。

- 操作：`GET /api/console/summary`
- 能力：`console.access`
- 读取：`applications`、`feedback`、`sessions`、`role_assignments`、`departments`、`titles`
- 写入：`sessions`、`audit_logs`
- 不入队：
- 权限与资源：console.access；applications、feedback、people三块分别再按applications.read、feedback.read及roles.manage或roles.department.manage过滤。
- 响应与错误：200 只含获授权的统计键；投递计数含全部五状态和7日数。
- 数据与副作用：读全局投递统计、CONSOLE_ORG意见数及指派/未归档部门数；不返回无权查看的统计键。
- 共同身份路径：读取当前sid及称号权限包，GitHub角色最多缓存60秒；仅过期/令牌失效才删除会话，令牌失效还写一次审计，不代表每次成功读都审计。

源码：[app/server/src/routes/console/me.ts:27](../../../app/server/src/routes/console/me.ts#L27) · [app/server/src/lib/access.ts:19](../../../app/server/src/lib/access.ts#L19) · [app/server/src/middleware/require-capability.ts:31](../../../app/server/src/middleware/require-capability.ts#L31)

测试入口：[tests/server/console.test.ts](../../../tests/server/console.test.ts)。生成器未执行这些测试。

### 读取称号与能力目录

标识：`flow:organization.catalogue`；性质：显式声明并关联源码，不是自动证明业务正确。

- 操作：`GET /api/console/catalogue`
- 能力：`console.access`
- 读取：`sessions`、`role_assignments`、`departments`、`titles`
- 写入：`sessions`、`audit_logs`
- 不入队：
- 权限与资源：console.access；供渲染的能力清单不能替代服务端授权。
- 响应与错误：200 {titles,crew,tones,capabilities,domains,role_base,implies,captain_only,department_icons,application_statuses}。
- 数据与副作用：称号显示与权限包来自titles；能力、色调、蕴含等来自源码常量，不写权限配置。
- 共同身份路径：读取当前sid及称号权限包，GitHub角色最多缓存60秒；仅过期/令牌失效才删除会话，令牌失效还写一次审计，不代表每次成功读都审计。

源码：[app/server/src/routes/console/catalogue.ts:12](../../../app/server/src/routes/console/catalogue.ts#L12) · [app/server/src/lib/access.ts:19](../../../app/server/src/lib/access.ts#L19) · [app/server/src/middleware/require-capability.ts:31](../../../app/server/src/middleware/require-capability.ts#L31)

测试入口：[tests/server/console.test.ts](../../../tests/server/console.test.ts)。生成器未执行这些测试。

### 读取部门及成员计数

标识：`flow:organization.departments.list`；性质：显式声明并关联源码，不是自动证明业务正确。

- 操作：`GET /api/console/departments`
- 能力：`console.access`
- 读取：`sessions`、`role_assignments`、`departments`、`titles`
- 写入：`sessions`、`audit_logs`
- 不入队：
- 权限与资源：console.access，读取全部部门配置；不是仅本人部门。
- 响应与错误：200 {departments}，含heads和crew_count，也保留归档标记。
- 数据与副作用：读取departments和role_assignments，写权限包不在此入口。
- 共同身份路径：读取当前sid及称号权限包，GitHub角色最多缓存60秒；仅过期/令牌失效才删除会话，令牌失效还写一次审计，不代表每次成功读都审计。

源码：[app/server/src/routes/console/departments.ts:30](../../../app/server/src/routes/console/departments.ts#L30) · [app/server/src/lib/access.ts:19](../../../app/server/src/lib/access.ts#L19) · [app/server/src/middleware/require-capability.ts:31](../../../app/server/src/middleware/require-capability.ts#L31)

测试入口：[tests/server/console.test.ts](../../../tests/server/console.test.ts)。生成器未执行这些测试。

### 新建组织部门

标识：`flow:organization.departments.create`；性质：显式声明并关联源码，不是自动证明业务正确。

- 操作：`POST /api/console/departments`
- 能力：`roles.manage`
- 读取：`sessions`、`role_assignments`、`departments`、`titles`
- 写入：`departments`、`audit_logs`、`sessions`
- 不入队：
- 权限与资源：roles.manage且GitHub组织owner（requireAdmiral）；舰长仅有roles.manage仍403 admiral_required。
- 响应与错误：201 {department}；400 captain_only_capability，409 department_exists。
- 数据与副作用：写新部门，roles.manage不得装进部门权限包；成功写department.create审计。
- 共同身份路径：读取当前sid及称号权限包，GitHub角色最多缓存60秒；仅过期/令牌失效才删除会话，令牌失效还写一次审计，不代表每次成功读都审计。

源码：[app/server/src/routes/console/departments.ts:37](../../../app/server/src/routes/console/departments.ts#L37) · [app/server/src/lib/role-store.ts:49](../../../app/server/src/lib/role-store.ts#L49) · [app/server/src/lib/access.ts:19](../../../app/server/src/lib/access.ts#L19) · [app/server/src/middleware/require-capability.ts:31](../../../app/server/src/middleware/require-capability.ts#L31)

测试入口：[tests/server/console.test.ts](../../../tests/server/console.test.ts)。生成器未执行这些测试。

### 修改或归档组织部门

标识：`flow:organization.departments.update`；性质：显式声明并关联源码，不是自动证明业务正确。

- 操作：`PATCH /api/console/departments/:department_id`
- 能力：`roles.manage`
- 读取：`sessions`、`role_assignments`、`departments`、`titles`
- 写入：`departments`、`audit_logs`、`sessions`
- 不入队：
- 权限与资源：roles.manage且GitHub组织owner（requireAdmiral）；舰长仅有roles.manage仍403 admiral_required。
- 响应与错误：200 {department}；未知id 404，非法舰长专属能力400。
- 数据与副作用：更新传入字段/归档标记；仅实际变化时审计department.update，未直接撤销其他称号。
- 共同身份路径：读取当前sid及称号权限包，GitHub角色最多缓存60秒；仅过期/令牌失效才删除会话，令牌失效还写一次审计，不代表每次成功读都审计。

源码：[app/server/src/routes/console/departments.ts:47](../../../app/server/src/routes/console/departments.ts#L47) · [app/server/src/lib/role-store.ts:49](../../../app/server/src/lib/role-store.ts#L49) · [app/server/src/lib/access.ts:19](../../../app/server/src/lib/access.ts#L19) · [app/server/src/middleware/require-capability.ts:31](../../../app/server/src/middleware/require-capability.ts#L31)

测试入口：[tests/server/console.test.ts](../../../tests/server/console.test.ts)。生成器未执行这些测试。

### 删除部门并撤销该部门指派

标识：`flow:organization.departments.delete`；性质：显式声明并关联源码，不是自动证明业务正确。

- 操作：`DELETE /api/console/departments/:department_id`
- 能力：`roles.manage`
- 读取：`sessions`、`role_assignments`、`departments`、`titles`
- 写入：`departments`、`role_assignments`、`audit_logs`、`sessions`
- 不入队：
- 权限与资源：roles.manage且GitHub组织owner（requireAdmiral）；舰长仅有roles.manage仍403 admiral_required。
- 响应与错误：200 {ok:true,removed}；不存在404 not_found。
- 数据与副作用：同一数据库事务删除该部门和其head/member指派，其他指派不变；审计被撤销者，种子标记防止重启复活。
- 共同身份路径：读取当前sid及称号权限包，GitHub角色最多缓存60秒；仅过期/令牌失效才删除会话，令牌失效还写一次审计，不代表每次成功读都审计。

源码：[app/server/src/routes/console/departments.ts:63](../../../app/server/src/routes/console/departments.ts#L63) · [app/server/src/lib/role-store.ts:49](../../../app/server/src/lib/role-store.ts#L49) · [app/server/src/lib/access.ts:19](../../../app/server/src/lib/access.ts#L19) · [app/server/src/middleware/require-capability.ts:31](../../../app/server/src/middleware/require-capability.ts#L31)

测试入口：[tests/server/console.test.ts](../../../tests/server/console.test.ts)。生成器未执行这些测试。

### 修改称号显示与权限包

标识：`flow:organization.titles.update`；性质：显式声明并关联源码，不是自动证明业务正确。

- 操作：`PATCH /api/console/titles/:title_id`
- 能力：`roles.manage`
- 读取：`sessions`、`role_assignments`、`departments`、`titles`
- 写入：`titles`、`audit_logs`、`sessions`
- 不入队：
- 权限与资源：roles.manage；admin/captain两级只有提督能改；提督固定全能力、乘客固定无能力，roles.manage只能进captain包。
- 响应与错误：200 {title}；400 title_capabilities_fixed/captain_only_capability，403 admiral_required，404 not_found。
- 数据与副作用：只更新允许的称号字段；实际变化才写title.update（不含旧新值），下一次请求读取新权限包。
- 共同身份路径：读取当前sid及称号权限包，GitHub角色最多缓存60秒；仅过期/令牌失效才删除会话，令牌失效还写一次审计，不代表每次成功读都审计。

源码：[app/server/src/routes/console/titles.ts:17](../../../app/server/src/routes/console/titles.ts#L17) · [app/server/src/lib/role-store.ts:49](../../../app/server/src/lib/role-store.ts#L49) · [app/server/src/lib/access.ts:19](../../../app/server/src/lib/access.ts#L19) · [app/server/src/middleware/require-capability.ts:31](../../../app/server/src/middleware/require-capability.ts#L31)

测试入口：[tests/server/console.test.ts](../../../tests/server/console.test.ts)。生成器未执行这些测试。

### 查看可管理的称号指派

标识：`flow:organization.assignments.list`；性质：显式声明并关联源码，不是自动证明业务正确。

- 操作：`GET /api/console/assignments`
- 能力：
- 读取：`sessions`、`role_assignments`、`departments`、`titles`
- 写入：`sessions`、`audit_logs`
- 不入队：
- 权限与资源：任一能力即可；roles.manage查全部，部门队长仅headOf范围，显式查询其他部门403 out_of_department_scope。
- 响应与错误：200 {assignments,captain}；captain只给登录名。
- 数据与副作用：读取筛选指派及现任舰长，不任命或移交。
- 共同身份路径：读取当前sid及称号权限包，GitHub角色最多缓存60秒；仅过期/令牌失效才删除会话，令牌失效还写一次审计，不代表每次成功读都审计。

源码：[app/server/src/routes/console/assignments.ts:34](../../../app/server/src/routes/console/assignments.ts#L34) · [app/server/src/lib/access.ts:19](../../../app/server/src/lib/access.ts#L19) · [app/server/src/middleware/require-capability.ts:31](../../../app/server/src/middleware/require-capability.ts#L31)

测试入口：[tests/server/console.test.ts](../../../tests/server/console.test.ts)。生成器未执行这些测试。

### 指派称号或移交舰长

标识：`flow:organization.assignments.grant`；性质：显式声明并关联源码，不是自动证明业务正确。

- 操作：`POST /api/console/assignments`
- 能力：
- 读取：`sessions`、`role_assignments`、`departments`、`titles`
- 写入：`role_assignments`、`audit_logs`、`sessions`
- 不入队：
- 权限与资源：任一能力；队长只任免自己部门member，captain只由提督或现任舰长任命；不能借本人token以外的凭据查账号。
- 响应与错误：201 {assignment}；400 部门/账号错误，403 跨部门或captain_required，409 assignment_exists；30次/分钟限流。
- 数据与副作用：先校验部门存在且未归档、查GitHub用户数字id；captain通过事务删旧插新保持唯一；审计指派/移交，不改变GitHub membership。
- 共同身份路径：读取当前sid及称号权限包，GitHub角色最多缓存60秒；仅过期/令牌失效才删除会话，令牌失效还写一次审计，不代表每次成功读都审计。

源码：[app/server/src/routes/console/assignments.ts:52](../../../app/server/src/routes/console/assignments.ts#L52) · [app/server/src/lib/role-store.ts:49](../../../app/server/src/lib/role-store.ts#L49) · [app/server/src/lib/access.ts:19](../../../app/server/src/lib/access.ts#L19) · [app/server/src/middleware/require-capability.ts:31](../../../app/server/src/middleware/require-capability.ts#L31)

测试入口：[tests/server/console.test.ts](../../../tests/server/console.test.ts) · [tests/server/rate-limits.test.ts](../../../tests/server/rate-limits.test.ts)。生成器未执行这些测试。

### 撤销称号指派

标识：`flow:organization.assignments.revoke`；性质：显式声明并关联源码，不是自动证明业务正确。

- 操作：`DELETE /api/console/assignments/:id`
- 能力：
- 读取：`sessions`、`role_assignments`、`departments`、`titles`
- 写入：`role_assignments`、`audit_logs`、`sessions`
- 不入队：
- 权限与资源：任一能力；队长只能撤自己部门member；captain仅提督或该行对应舰长本人可撤。
- 响应与错误：200 {ok:true}；404 not_found，403 out_of_department_scope/missing_capability，409 captain_transfer_required。
- 数据与副作用：删除指定指派并记role.revoke，其他指派不变；不删除GitHub组织成员。
- 共同身份路径：读取当前sid及称号权限包，GitHub角色最多缓存60秒；仅过期/令牌失效才删除会话，令牌失效还写一次审计，不代表每次成功读都审计。

源码：[app/server/src/routes/console/assignments.ts:98](../../../app/server/src/routes/console/assignments.ts#L98) · [app/server/src/lib/access.ts:19](../../../app/server/src/lib/access.ts#L19) · [app/server/src/middleware/require-capability.ts:31](../../../app/server/src/middleware/require-capability.ts#L31)

测试入口：[tests/server/console.test.ts](../../../tests/server/console.test.ts)。生成器未执行这些测试。

### 查看组织成员与称号持有者

标识：`flow:organization.people`；性质：显式声明并关联源码，不是自动证明业务正确。

- 操作：`GET /api/console/people`
- 能力：
- 读取：`sessions`、`role_assignments`、`departments`、`titles`
- 写入：`sessions`、`audit_logs`
- 不入队：
- 权限与资源：任一能力；队长也能看组织全名单，不按部门收窄。
- 响应与错误：200 {people}，含login/user_id/avatar_url/github_role/titles；按最高称号层级和登录名排序。
- 数据与副作用：用本人token取GitHub成员，再合并本地已有指派但离开组织的人；按数字id优先匹配改名用户，不同步写远端。
- 共同身份路径：读取当前sid及称号权限包，GitHub角色最多缓存60秒；仅过期/令牌失效才删除会话，令牌失效还写一次审计，不代表每次成功读都审计。

源码：[app/server/src/routes/console/people.ts:20](../../../app/server/src/routes/console/people.ts#L20) · [app/server/src/lib/access.ts:19](../../../app/server/src/lib/access.ts#L19) · [app/server/src/middleware/require-capability.ts:31](../../../app/server/src/middleware/require-capability.ts#L31)

测试入口：[tests/server/console.test.ts](../../../tests/server/console.test.ts)。生成器未执行这些测试。

### 按能力读取脱敏审计

标识：`flow:audit.console.read`；性质：显式声明并关联源码，不是自动证明业务正确。

- 操作：`GET /api/console/audit`
- 能力：`audit.read`
- 读取：`audit_logs`、`sessions`、`role_assignments`、`departments`、`titles`
- 写入：`sessions`、`audit_logs`
- 不入队：
- 权限与资源：audit.read；仅CONSOLE_ORG，action按转义后的字面前缀筛选；不是全库日志。
- 响应与错误：200 {logs}；details解析为对象；invite_link目标token及public:token操作者只保留前6位。
- 数据与副作用：读日志分页，不修改历史；org为空的登录/公开投递审计不在该结果中。
- 共同身份路径：读取当前sid及称号权限包，GitHub角色最多缓存60秒；仅过期/令牌失效才删除会话，令牌失效还写一次审计，不代表每次成功读都审计。

源码：[app/server/src/routes/console/audit.ts:29](../../../app/server/src/routes/console/audit.ts#L29) · [app/server/src/lib/access.ts:19](../../../app/server/src/lib/access.ts#L19) · [app/server/src/middleware/require-capability.ts:31](../../../app/server/src/middleware/require-capability.ts#L31)

测试入口：[tests/server/console.test.ts](../../../tests/server/console.test.ts)。生成器未执行这些测试。

### 筛选招新投递列表

标识：`flow:application.list`；性质：显式声明并关联源码，不是自动证明业务正确。

- 操作：`GET /api/console/applications`
- 能力：`applications.read`
- 读取：`applications`、`application_reviews`、`sessions`、`role_assignments`、`departments`、`titles`
- 写入：`sessions`、`audit_logs`
- 不入队：
- 权限与资源：applications.read；无部门/个人记录限制，有此能力可读全部候选人列表。
- 响应与错误：200 {items,total,counts}；特长摘要120字、last_review可空，来源IP/UA不下发；counts为未筛选的全局五状态计数。
- 数据与副作用：转义q中的LIKE通配符，按姓名/班级/邮箱搜索；查询latest review，不为列表记application.view。
- 共同身份路径：读取当前sid及称号权限包，GitHub角色最多缓存60秒；仅过期/令牌失效才删除会话，令牌失效还写一次审计，不代表每次成功读都审计。

源码：[app/server/src/routes/console/applications.ts:45](../../../app/server/src/routes/console/applications.ts#L45) · [app/server/src/lib/access.ts:19](../../../app/server/src/lib/access.ts#L19) · [app/server/src/middleware/require-capability.ts:31](../../../app/server/src/middleware/require-capability.ts#L31)

测试入口：[tests/server/console.test.ts](../../../tests/server/console.test.ts)。生成器未执行这些测试。

### 查看候选人详情与邮件状态

标识：`flow:application.detail`；性质：显式声明并关联源码，不是自动证明业务正确。

- 操作：`GET /api/console/applications/:application_id`
- 能力：`applications.read`
- 读取：`applications`、`application_reviews`、`mail_outbox`、`sessions`、`role_assignments`、`departments`、`titles`
- 写入：`audit_logs`、`sessions`
- 不入队：
- 权限与资源：applications.read；按UUID定位任意候选人，无部门范围限制。
- 响应与错误：200 {application,reviews,received_mail,mail}；404 not_found。邮件摘要不含地址/正文，application不含source_ip/UA。
- 数据与副作用：读简历、审核历史和mail_outbox摘要，写application.view审计，不触发发信。
- 共同身份路径：读取当前sid及称号权限包，GitHub角色最多缓存60秒；仅过期/令牌失效才删除会话，令牌失效还写一次审计，不代表每次成功读都审计。

源码：[app/server/src/routes/console/applications.ts:101](../../../app/server/src/routes/console/applications.ts#L101) · [app/server/src/lib/access.ts:19](../../../app/server/src/lib/access.ts#L19) · [app/server/src/middleware/require-capability.ts:31](../../../app/server/src/middleware/require-capability.ts#L31)

测试入口：[tests/server/console.test.ts](../../../tests/server/console.test.ts) · [tests/server/mail-outbox.test.ts](../../../tests/server/mail-outbox.test.ts)。生成器未执行这些测试。

### 导出候选人CSV

标识：`flow:application.export`；性质：显式声明并关联源码，不是自动证明业务正确。

- 操作：`GET /api/console/applications/export.csv`
- 能力：`applications.export`
- 读取：`applications`、`sessions`、`role_assignments`、`departments`、`titles`
- 写入：`audit_logs`、`sessions`
- 不入队：
- 权限与资源：applications.export；可选status过滤，其余不按部门收窄；5次/分钟。
- 响应与错误：200 text/csv附件，UTF-8 BOM、北京时间列、公式前缀转义；429 rate_limited。
- 数据与副作用：读取简历并记录application.export数量/状态；不写候选人或发信队列，文件导出后不由系统追踪。
- 共同身份路径：读取当前sid及称号权限包，GitHub角色最多缓存60秒；仅过期/令牌失效才删除会话，令牌失效还写一次审计，不代表每次成功读都审计。

源码：[app/server/src/routes/console/applications.ts:74](../../../app/server/src/routes/console/applications.ts#L74) · [app/server/src/lib/access.ts:19](../../../app/server/src/lib/access.ts#L19) · [app/server/src/middleware/require-capability.ts:31](../../../app/server/src/middleware/require-capability.ts#L31)

测试入口：[tests/server/console.test.ts](../../../tests/server/console.test.ts) · [tests/server/rate-limits.test.ts](../../../tests/server/rate-limits.test.ts)。生成器未执行这些测试。

### 审核投递、补备注与安排通知

标识：`flow:application.review`；性质：显式声明并关联源码，不是自动证明业务正确。

- 操作：`PATCH /api/console/applications/:application_id`
- 能力：`applications.review`
- 读取：`applications`、`application_reviews`、`mail_outbox`、`sessions`、`role_assignments`、`departments`、`titles`
- 写入：`applications`、`application_reviews`、`mail_outbox`、`audit_logs`、`sessions`
- 不入队：
- 权限与资源：applications.review；按id审核，状态变更必须携带expected_status和expected_review_id；取消分支规则仍唯一见application.cancel。
- 响应与错误：200 {application,review}；400 invalid_status/no_change/letter_required/letter_invalid，404 not_found，409 status_changed。
- 数据与副作用：变更到interview/accepted/rejected且notify不为false才渲染邮件；状态、审核行和邮件入队同事务，实际发送由后台worker。备注不写信或审计正文；本路由不新增任何取消规则。
- 共同身份路径：读取当前sid及称号权限包，GitHub角色最多缓存60秒；仅过期/令牌失效才删除会话，令牌失效还写一次审计，不代表每次成功读都审计。

源码：[app/server/src/routes/console/applications.ts:117](../../../app/server/src/routes/console/applications.ts#L117) · [app/server/src/lib/mail/mailer.ts:49](../../../app/server/src/lib/mail/mailer.ts#L49) · [app/server/src/lib/access.ts:19](../../../app/server/src/lib/access.ts#L19) · [app/server/src/middleware/require-capability.ts:31](../../../app/server/src/middleware/require-capability.ts#L31)

测试入口：[tests/server/console.test.ts](../../../tests/server/console.test.ts) · [tests/server/mail-outbox.test.ts](../../../tests/server/mail-outbox.test.ts)。生成器未执行这些测试。

### 提交加入我们申请

标识：`flow:application.submit`；性质：显式声明并关联源码，不是自动证明业务正确。

- 操作：`POST /api/portal/apply`
- 能力：
- 读取：`application_limits`、`mail_outbox`
- 写入：`applications`、`application_limits`、`mail_outbox`、`audit_logs`
- 不入队：
- 权限与资源：匿名；蜜罐、PoW、可选Turnstile、每IP分钟5次和IP(/64)/设备24小时各5份。
- 响应与错误：201 {id,submitted_at,message}；字段错误400附fields，429 apply_limited/rate_limited。蜜罐回相同201形状但不落库。
- 数据与副作用：计数与投递同事务，发设备cookie；记脱敏application.received审计，尽力入队已收到邮件（每小时总量限制），入队失败仅日志不回滚投递；无需会话。

源码：[app/server/src/routes/portal/apply.ts:118](../../../app/server/src/routes/portal/apply.ts#L118) · [app/server/src/lib/mail/mailer.ts:49](../../../app/server/src/lib/mail/mailer.ts#L49)

测试入口：[tests/server/applications.test.ts](../../../tests/server/applications.test.ts) · [tests/server/mail-outbox.test.ts](../../../tests/server/mail-outbox.test.ts) · [tests/server/rate-limits.test.ts](../../../tests/server/rate-limits.test.ts)。生成器未执行这些测试。

### 读取公开防滥用配置

标识：`flow:platform.public_config`；性质：显式声明并关联源码，不是自动证明业务正确。

- 操作：`GET /api/public/config`
- 能力：
- 读取：
- 写入：
- 不入队：
- 权限与资源：匿名可读；仅公开site key或null与PoW难度，不含Turnstile secret。
- 响应与错误：200 {turnstile_site_key,pow_difficulty}。
- 数据与副作用：只读配置，无业务数据库读取和写入，不调用验证码服务。

源码：[app/server/src/routes/portal/join.ts:47](../../../app/server/src/routes/portal/join.ts#L47)

测试入口：[tests/server/core.test.ts](../../../tests/server/core.test.ts) · [tests/server/configuration.test.ts](../../../tests/server/configuration.test.ts)。生成器未执行这些测试。

### 阅读公开组织架构

标识：`flow:organization.public`；性质：显式声明并关联源码，不是自动证明业务正确。

- 操作：`GET /api/public/org`
- 能力：
- 读取：`titles`、`departments`
- 写入：
- 不入队：
- 权限与资源：匿名可读；只下发称号/未归档部门显示信息及色调，不含人员或权限包。
- 响应与错误：200 {tones,titles,departments}。
- 数据与副作用：读取数据库显示配置与源码rank/tone，不修改组织结构。

源码：[app/server/src/routes/portal/org.ts:11](../../../app/server/src/routes/portal/org.ts#L11)

测试入口：[tests/server/console.test.ts](../../../tests/server/console.test.ts)。生成器未执行这些测试。

### 浏览公开文档清单

标识：`flow:documentation.list`；性质：显式声明并关联源码，不是自动证明业务正确。

- 操作：`GET /api/docs`
- 能力：
- 读取：
- 写入：
- 不入队：
- 权限与资源：匿名，只收DOC_FILES允许列表且文件存在。
- 响应与错误：200 {items:[{id,label,lang,file}]}。
- 数据与副作用：仅检查仓库公开文件是否存在；内部规范、运维和目录不会通过此API公开。

源码：[app/server/src/routes/portal/docs.ts:16](../../../app/server/src/routes/portal/docs.ts#L16)

测试入口：[tests/server/core.test.ts](../../../tests/server/core.test.ts)。生成器未执行这些测试。

### 阅读允许公开的文档

标识：`flow:documentation.read`；性质：显式声明并关联源码，不是自动证明业务正确。

- 操作：`GET /api/docs/:id`
- 能力：
- 读取：
- 写入：
- 不入队：
- 权限与资源：匿名；id必须命中固定DOC_FILES，不能用任意路径读取文件。
- 响应与错误：200 {id,label,lang,file,content}；未列入或文件缺失404。
- 数据与副作用：读取允许的UTF-8 Markdown，不访问业务数据库、不执行内容。

源码：[app/server/src/routes/portal/docs.ts:23](../../../app/server/src/routes/portal/docs.ts#L23)

测试入口：[tests/server/core.test.ts](../../../tests/server/core.test.ts)。生成器未执行这些测试。

### 检查公开邀请链接

标识：`flow:invitation.public.inspect`；性质：显式声明并关联源码，不是自动证明业务正确。

- 操作：`GET /api/join/:token`
- 能力：
- 读取：`invite_links`
- 写入：
- 不入队：
- 权限与资源：持有token可访问；不需要登录，不返回发起人的token密文。
- 响应与错误：200 {org,note,team_slug,expires_at,remaining_uses,valid,reason}；未知token404。
- 数据与副作用：读取链接状态并计算剩余额度，不预留额度、不调用GitHub、不发邀请。

源码：[app/server/src/routes/portal/join.ts:52](../../../app/server/src/routes/portal/join.ts#L52)

测试入口：[tests/server/invitations.test.ts](../../../tests/server/invitations.test.ts)。生成器未执行这些测试。

### 兑换组织邀请链接

标识：`flow:invitation.public.redeem`；性质：显式声明并关联源码，不是自动证明业务正确。

- 操作：`POST /api/join/:token`
- 能力：
- 读取：`invite_links`、`invite_attempts`
- 写入：`invite_links`、`invite_attempts`、`invitations`、`audit_logs`
- 不入队：
- 权限与资源：持有token，PoW/蜜罐/可选Turnstile及分钟限流；额度、禁用和过期在事务预留时再次校验；使用链接发起人密文中的token。
- 响应与错误：200 {ok:true,invitation_id,message}；404不存在，400输入/明确失败，409 invite_pending_review/invite_unavailable，503凭据失效或结果待核对。
- 数据与副作用：先事务预留再请求GitHub（可查团队和用户名），成功写邀请/尝试/审计；sent重放不重复发送，明确失败返还额度，不确定结果保留unknown待核对，不删除访问者会话。

源码：[app/server/src/routes/portal/join.ts:67](../../../app/server/src/routes/portal/join.ts#L67) · [app/server/src/lib/invite-reservation.ts:9](../../../app/server/src/lib/invite-reservation.ts#L9) · [app/server/src/lib/invite-reservation.ts:22](../../../app/server/src/lib/invite-reservation.ts#L22)

测试入口：[tests/server/invitations.test.ts](../../../tests/server/invitations.test.ts) · [tests/server/rate-limits.test.ts](../../../tests/server/rate-limits.test.ts)。生成器未执行这些测试。

### 读取意见分类与提交参数

标识：`flow:feedback.categories`；性质：显式声明并关联源码，不是自动证明业务正确。

- 操作：`GET /api/feedback/categories`
- 能力：
- 读取：
- 写入：
- 不入队：
- 权限与资源：匿名，只返回本部署CONSOLE_ORG及固定分类。
- 响应与错误：200 {categories,pow_difficulty,org}。
- 数据与副作用：读源码配置，不写数据库、不发信。

源码：[app/server/src/routes/portal/feedback.ts:24](../../../app/server/src/routes/portal/feedback.ts#L24)

测试入口：[tests/server/feedback-org.test.ts](../../../tests/server/feedback-org.test.ts) · [tests/server/core.test.ts](../../../tests/server/core.test.ts)。生成器未执行这些测试。

### 浏览已公开的意见与回复

标识：`flow:feedback.public.list`；性质：显式声明并关联源码，不是自动证明业务正确。

- 操作：`GET /api/feedback/public`
- 能力：
- 读取：`feedback`
- 写入：
- 不入队：
- 权限与资源：匿名；org按大小写不敏感匹配CONSOLE_ORG，否则回空列表；spam不公开。
- 响应与错误：200 {items}；正文截280字、含回复/状态/票数，不含contact/IP/UA；limit由合同限制且最终最多100。
- 数据与副作用：只读本组织反馈，不查询其他组织是否有记录。

源码：[app/server/src/routes/portal/feedback.ts:62](../../../app/server/src/routes/portal/feedback.ts#L62)

测试入口：[tests/server/feedback-org.test.ts](../../../tests/server/feedback-org.test.ts) · [tests/server/core.test.ts](../../../tests/server/core.test.ts)。生成器未执行这些测试。

### 提交组织意见

标识：`flow:feedback.submit`；性质：显式声明并关联源码，不是自动证明业务正确。

- 操作：`POST /api/feedback`
- 能力：
- 读取：`sessions`
- 写入：`feedback`、`audit_logs`、`sessions`
- 不入队：
- 权限与资源：匿名可提交；仅CONSOLE_ORG，5至5000字，固定分类，PoW/蜜罐/Turnstile与每分钟10次限流；sid仅补充提交人身份。
- 响应与错误：200 {ok:true,id,message}；非法org/内容/分类或人机校验失败400，超额429。
- 数据与副作用：写feedback及feedback.submit审计（80字预览）；有效sid补账号，过期sid可删除；联系方式截200字，不发送邮件。

源码：[app/server/src/routes/portal/feedback.ts:26](../../../app/server/src/routes/portal/feedback.ts#L26)

测试入口：[tests/server/feedback-org.test.ts](../../../tests/server/feedback-org.test.ts) · [tests/server/core.test.ts](../../../tests/server/core.test.ts) · [tests/server/rate-limits.test.ts](../../../tests/server/rate-limits.test.ts)。生成器未执行这些测试。

### 组织管理员读取待处理意见

标识：`flow:feedback.admin.list`；性质：显式声明并关联源码，不是自动证明业务正确。

- 操作：`GET /api/admin/:org/feedback`
- 能力：
- 读取：`feedback`、`sessions`
- 写入：`sessions`、`audit_logs`
- 不入队：
- 权限与资源：有效会话及URL org的GitHub admin，ALLOWED_ORGS限制；与控制台能力授权分开。
- 响应与错误：200 {items,counts}；最多500条，管理DTO不下发source_ip/UA/数字账号id。
- 数据与副作用：按org及可选status读列表与状态计数，不记查看审计。

源码：[app/server/src/routes/admin/feedback.ts:13](../../../app/server/src/routes/admin/feedback.ts#L13) · [app/server/src/lib/feedback-store.ts:22](../../../app/server/src/lib/feedback-store.ts#L22) · [app/server/src/middleware/require-org-role.ts:5](../../../app/server/src/middleware/require-org-role.ts#L5)

测试入口：[tests/server/feedback-org.test.ts](../../../tests/server/feedback-org.test.ts) · [tests/server/console.test.ts](../../../tests/server/console.test.ts) · [tests/server/core.test.ts](../../../tests/server/core.test.ts)。生成器未执行这些测试。

### 组织管理员处理意见状态与回复

标识：`flow:feedback.admin.update`；性质：显式声明并关联源码，不是自动证明业务正确。

- 操作：`PATCH /api/admin/:org/feedback/:id`
- 能力：
- 读取：`feedback`、`sessions`
- 写入：`feedback`、`audit_logs`、`sessions`
- 不入队：
- 权限与资源：有效会话及URL org的GitHub admin，ALLOWED_ORGS限制；与控制台能力授权分开。
- 响应与错误：200 {ok:true}；记录不属于org返回404，非法状态被合同/handler拒绝。
- 数据与副作用：更新status、reply、replied_by/replied_at及updated_at，审计feedback.update；回复将由公开列表展示，不发邮件。

源码：[app/server/src/routes/admin/feedback.ts:19](../../../app/server/src/routes/admin/feedback.ts#L19) · [app/server/src/lib/feedback-store.ts:22](../../../app/server/src/lib/feedback-store.ts#L22) · [app/server/src/middleware/require-org-role.ts:5](../../../app/server/src/middleware/require-org-role.ts#L5)

测试入口：[tests/server/feedback-org.test.ts](../../../tests/server/feedback-org.test.ts) · [tests/server/console.test.ts](../../../tests/server/console.test.ts) · [tests/server/core.test.ts](../../../tests/server/core.test.ts)。生成器未执行这些测试。

### 组织管理员删除组织意见

标识：`flow:feedback.admin.delete`；性质：显式声明并关联源码，不是自动证明业务正确。

- 操作：`DELETE /api/admin/:org/feedback/:id`
- 能力：
- 读取：`feedback`、`sessions`
- 写入：`feedback`、`audit_logs`、`sessions`
- 不入队：
- 权限与资源：有效会话及URL org的GitHub admin，ALLOWED_ORGS限制；与控制台能力授权分开。
- 响应与错误：200 {ok:true}；org/id不匹配404。
- 数据与副作用：删除反馈并审计feedback.delete，不能越过组织条件删除其他记录。

源码：[app/server/src/routes/admin/feedback.ts:32](../../../app/server/src/routes/admin/feedback.ts#L32) · [app/server/src/lib/feedback-store.ts:22](../../../app/server/src/lib/feedback-store.ts#L22) · [app/server/src/middleware/require-org-role.ts:5](../../../app/server/src/middleware/require-org-role.ts#L5)

测试入口：[tests/server/feedback-org.test.ts](../../../tests/server/feedback-org.test.ts) · [tests/server/console.test.ts](../../../tests/server/console.test.ts) · [tests/server/core.test.ts](../../../tests/server/core.test.ts)。生成器未执行这些测试。

### 控制台读取待处理意见

标识：`flow:feedback.console.list`；性质：显式声明并关联源码，不是自动证明业务正确。

- 操作：`GET /api/console/feedback`
- 能力：`feedback.read`
- 读取：`feedback`、`sessions`、`role_assignments`、`departments`、`titles`
- 写入：`sessions`、`audit_logs`
- 不入队：
- 权限与资源：feedback.read；资源固定CONSOLE_ORG，不接受客户端自报org。
- 响应与错误：200 {items,counts}；最多500条，管理DTO不下发source_ip/UA/数字账号id。
- 数据与副作用：按org及可选status读列表与状态计数，不记查看审计。
- 共同身份路径：读取当前sid及称号权限包，GitHub角色最多缓存60秒；仅过期/令牌失效才删除会话，令牌失效还写一次审计，不代表每次成功读都审计。

源码：[app/server/src/routes/console/feedback.ts:12](../../../app/server/src/routes/console/feedback.ts#L12) · [app/server/src/lib/feedback-store.ts:22](../../../app/server/src/lib/feedback-store.ts#L22) · [app/server/src/lib/access.ts:19](../../../app/server/src/lib/access.ts#L19) · [app/server/src/middleware/require-capability.ts:31](../../../app/server/src/middleware/require-capability.ts#L31)

测试入口：[tests/server/feedback-org.test.ts](../../../tests/server/feedback-org.test.ts) · [tests/server/console.test.ts](../../../tests/server/console.test.ts) · [tests/server/core.test.ts](../../../tests/server/core.test.ts)。生成器未执行这些测试。

### 控制台处理意见状态与回复

标识：`flow:feedback.console.update`；性质：显式声明并关联源码，不是自动证明业务正确。

- 操作：`PATCH /api/console/feedback/:id`
- 能力：`feedback.manage`
- 读取：`feedback`、`sessions`、`role_assignments`、`departments`、`titles`
- 写入：`feedback`、`audit_logs`、`sessions`
- 不入队：
- 权限与资源：feedback.manage；资源固定CONSOLE_ORG，不接受客户端自报org。
- 响应与错误：200 {ok:true}；记录不属于org返回404，非法状态被合同/handler拒绝。
- 数据与副作用：更新status、reply、replied_by/replied_at及updated_at，审计feedback.update；回复将由公开列表展示，不发邮件。
- 共同身份路径：读取当前sid及称号权限包，GitHub角色最多缓存60秒；仅过期/令牌失效才删除会话，令牌失效还写一次审计，不代表每次成功读都审计。

源码：[app/server/src/routes/console/feedback.ts:18](../../../app/server/src/routes/console/feedback.ts#L18) · [app/server/src/lib/feedback-store.ts:22](../../../app/server/src/lib/feedback-store.ts#L22) · [app/server/src/lib/access.ts:19](../../../app/server/src/lib/access.ts#L19) · [app/server/src/middleware/require-capability.ts:31](../../../app/server/src/middleware/require-capability.ts#L31)

测试入口：[tests/server/feedback-org.test.ts](../../../tests/server/feedback-org.test.ts) · [tests/server/console.test.ts](../../../tests/server/console.test.ts) · [tests/server/core.test.ts](../../../tests/server/core.test.ts)。生成器未执行这些测试。

### 控制台删除组织意见

标识：`flow:feedback.console.delete`；性质：显式声明并关联源码，不是自动证明业务正确。

- 操作：`DELETE /api/console/feedback/:id`
- 能力：`feedback.manage`
- 读取：`feedback`、`sessions`、`role_assignments`、`departments`、`titles`
- 写入：`feedback`、`audit_logs`、`sessions`
- 不入队：
- 权限与资源：feedback.manage；资源固定CONSOLE_ORG，不接受客户端自报org。
- 响应与错误：200 {ok:true}；org/id不匹配404。
- 数据与副作用：删除反馈并审计feedback.delete，不能越过组织条件删除其他记录。
- 共同身份路径：读取当前sid及称号权限包，GitHub角色最多缓存60秒；仅过期/令牌失效才删除会话，令牌失效还写一次审计，不代表每次成功读都审计。

源码：[app/server/src/routes/console/feedback.ts:31](../../../app/server/src/routes/console/feedback.ts#L31) · [app/server/src/lib/feedback-store.ts:22](../../../app/server/src/lib/feedback-store.ts#L22) · [app/server/src/lib/access.ts:19](../../../app/server/src/lib/access.ts#L19) · [app/server/src/middleware/require-capability.ts:31](../../../app/server/src/middleware/require-capability.ts#L31)

测试入口：[tests/server/feedback-org.test.ts](../../../tests/server/feedback-org.test.ts) · [tests/server/console.test.ts](../../../tests/server/console.test.ts) · [tests/server/core.test.ts](../../../tests/server/core.test.ts)。生成器未执行这些测试。

### 浏览论坛状态与本人私有列表

标识：`flow:forum.state`；性质：显式声明并关联源码，不是自动证明业务正确。

- 操作：`GET /api/forum/state`
- 能力：
- 读取：`forum_counters`、`forum_users`、`forum_tags`、`forum_topics`、`forum_posts`、`forum_likes`、`forum_notifications`、`forum_bookmarks`、`forum_follows`、`sessions`、`role_assignments`、`departments`、`titles`
- 写入：`forum_users`、`sessions`、`audit_logs`
- 不入队：
- 权限与资源：游客与成员均可读；通知、书签和真实通知设置仅本人可见，其他用户设置给默认值；关注关系公开。
- 响应与错误：200 {state}，帖子只有字段和摘要、没有正文；每IP(/64)分钟120次，超额429；显式HEAD回405且不计算state。
- 数据与副作用：读论坛表与公开内容分类；GET也可能通过forumViewer刷新本人用户；不发送邮件、不写帖子。
- 身份条件副作用：forumViewer仅在当前仍为组织成员时创建/刷新forum_users的角色、称号和GitHub头像；sid过期删除会话，上游拒绝token经全局处理时删会话并审计；游客不刷新成员记录。

源码：[app/server/src/routes/forum-api/topics.ts:21](../../../app/server/src/routes/forum-api/topics.ts#L21) · [app/server/src/lib/forum-store.ts:188](../../../app/server/src/lib/forum-store.ts#L188) · [app/server/src/routes/forum-api/viewer.ts:31](../../../app/server/src/routes/forum-api/viewer.ts#L31) · [app/server/src/lib/access.ts:19](../../../app/server/src/lib/access.ts#L19)

测试入口：[tests/server/forum.test.ts](../../../tests/server/forum.test.ts)。生成器未执行这些测试。

### 阅读单话题帖子正文

标识：`flow:forum.topic_posts`；性质：显式声明并关联源码，不是自动证明业务正确。

- 操作：`GET /api/forum/topics/:topic_id/posts`
- 能力：
- 读取：`forum_topics`、`forum_posts`、`forum_likes`、`sessions`、`role_assignments`、`departments`、`titles`、`forum_users`
- 写入：`forum_users`、`sessions`、`audit_logs`
- 不入队：
- 权限与资源：游客与成员均可读，无额外帖子级权限；与state可见性一致。
- 响应与错误：200 {posts}含正文；话题不存在404；每IP分钟60次。
- 数据与副作用：按话题读取帖子及点赞投影；软删正文为空；不把全论坛正文再次塞进首屏。
- 身份条件副作用：forumViewer仅在当前仍为组织成员时创建/刷新forum_users的角色、称号和GitHub头像；sid过期删除会话，上游拒绝token经全局处理时删会话并审计；游客不刷新成员记录。

源码：[app/server/src/routes/forum-api/topics.ts:28](../../../app/server/src/routes/forum-api/topics.ts#L28) · [app/server/src/lib/forum-store.ts:188](../../../app/server/src/lib/forum-store.ts#L188) · [app/server/src/routes/forum-api/viewer.ts:31](../../../app/server/src/routes/forum-api/viewer.ts#L31) · [app/server/src/lib/access.ts:19](../../../app/server/src/lib/access.ts#L19)

测试入口：[tests/server/forum.test.ts](../../../tests/server/forum.test.ts)。生成器未执行这些测试。

### 搜索话题帖子和用户

标识：`flow:forum.search`；性质：显式声明并关联源码，不是自动证明业务正确。

- 操作：`GET /api/forum/search`
- 能力：
- 读取：`forum_topics`、`forum_posts`、`forum_users`、`forum_likes`、`sessions`、`role_assignments`、`departments`、`titles`
- 写入：`forum_users`、`sessions`、`audit_logs`
- 不入队：
- 权限与资源：游客与成员均可搜索；只本人用户记录显示真实通知设置，不搜索已删帖子正文。
- 响应与错误：200 {results:{topics,posts,users}}；空词空结果；词过长400 validation_error，每IP分钟60次。
- 数据与副作用：标题、正文、username/displayName按转义的LIKE搜索，各类限量；返回帖子命中摘要，不将%当通配符。
- 身份条件副作用：forumViewer仅在当前仍为组织成员时创建/刷新forum_users的角色、称号和GitHub头像；sid过期删除会话，上游拒绝token经全局处理时删会话并审计；游客不刷新成员记录。

源码：[app/server/src/routes/forum-api/topics.ts:38](../../../app/server/src/routes/forum-api/topics.ts#L38) · [app/server/src/lib/forum-store.ts:188](../../../app/server/src/lib/forum-store.ts#L188) · [app/server/src/routes/forum-api/viewer.ts:31](../../../app/server/src/routes/forum-api/viewer.ts#L31) · [app/server/src/lib/access.ts:19](../../../app/server/src/lib/access.ts#L19)

测试入口：[tests/server/forum.test.ts](../../../tests/server/forum.test.ts)。生成器未执行这些测试。

### 发布成员话题与首帖

标识：`flow:forum.topics.create`；性质：显式声明并关联源码，不是自动证明业务正确。

- 操作：`POST /api/forum/topics`
- 能力：
- 读取：`forum_topics`、`forum_posts`、`forum_tags`、`forum_users`、`forum_notifications`、`forum_counters`、`forum_rate_events`、`sessions`、`role_assignments`、`departments`、`titles`、`forum_likes`
- 写入：`forum_topics`、`forum_posts`、`forum_tags`、`forum_notifications`、`forum_counters`、`forum_rate_events`、`forum_users`、`sessions`、`audit_logs`
- 不入队：
- 权限与资源：requireMember：有效sid且当前仍是CONSOLE_ORG成员；主体由服务端forumViewer确定，客户端userId/role不能赋权。
- 响应与错误：201 {changes,viewer,guestPolicy,topicId,postId}，帖子带正文；非法标题/分类/tag/空正文400，成员限流429。
- 数据与副作用：单事务创建话题、首帖、编号和必要新tag，处理最多10个@提及通知；成功后记topic限流事件，不发邮件。
- 身份条件副作用：forumViewer仅在当前仍为组织成员时创建/刷新forum_users的角色、称号和GitHub头像；sid过期删除会话，上游拒绝token经全局处理时删会话并审计；游客不刷新成员记录。

源码：[app/server/src/routes/forum-api/topics.ts:47](../../../app/server/src/routes/forum-api/topics.ts#L47) · [app/server/src/lib/forum-store.ts:188](../../../app/server/src/lib/forum-store.ts#L188) · [app/server/src/routes/forum-api/viewer.ts:31](../../../app/server/src/routes/forum-api/viewer.ts#L31) · [app/server/src/lib/access.ts:19](../../../app/server/src/lib/access.ts#L19)

测试入口：[tests/server/forum.test.ts](../../../tests/server/forum.test.ts)。生成器未执行这些测试。

### 置顶或取消置顶话题

标识：`flow:forum.topics.pin`；性质：显式声明并关联源码，不是自动证明业务正确。

- 操作：`POST /api/forum/topics/:topic_id/pin`
- 能力：`forum.topic.pin`
- 读取：`forum_topics`、`sessions`、`role_assignments`、`departments`、`titles`、`forum_users`、`forum_likes`
- 写入：`forum_topics`、`audit_logs`、`forum_users`、`sessions`
- 不入队：
- 权限与资源：requireMember：有效sid且当前仍是CONSOLE_ORG成员；主体由服务端forumViewer确定，客户端userId/role不能赋权。 此外必须具备forum.topic.pin，作用于指定话题。
- 响应与错误：200 {changes,viewer,guestPolicy}；只返回本次变动记录，成员自己的用户记录总携带，私有记录按本人范围投影。；缺能力403，话题不存在404。
- 数据与副作用：更新pinned；以CONSOLE_ORG记forum.topic.pin审计，只含话题id及开关，不含正文。
- 身份条件副作用：forumViewer仅在当前仍为组织成员时创建/刷新forum_users的角色、称号和GitHub头像；sid过期删除会话，上游拒绝token经全局处理时删会话并审计；游客不刷新成员记录。

源码：[app/server/src/routes/forum-api/topics.ts:67](../../../app/server/src/routes/forum-api/topics.ts#L67) · [app/server/src/lib/forum-store.ts:188](../../../app/server/src/lib/forum-store.ts#L188) · [app/server/src/routes/forum-api/viewer.ts:31](../../../app/server/src/routes/forum-api/viewer.ts#L31) · [app/server/src/lib/access.ts:19](../../../app/server/src/lib/access.ts#L19)

测试入口：[tests/server/forum.test.ts](../../../tests/server/forum.test.ts)。生成器未执行这些测试。

### 关闭或重新打开话题

标识：`flow:forum.topics.close`；性质：显式声明并关联源码，不是自动证明业务正确。

- 操作：`POST /api/forum/topics/:topic_id/close`
- 能力：`forum.topic.close`
- 读取：`forum_topics`、`sessions`、`role_assignments`、`departments`、`titles`、`forum_users`、`forum_likes`
- 写入：`forum_topics`、`audit_logs`、`forum_users`、`sessions`
- 不入队：
- 权限与资源：requireMember：有效sid且当前仍是CONSOLE_ORG成员；主体由服务端forumViewer确定，客户端userId/role不能赋权。 此外必须具备forum.topic.close，作用于指定话题。
- 响应与错误：200 {changes,viewer,guestPolicy}；只返回本次变动记录，成员自己的用户记录总携带，私有记录按本人范围投影。；缺能力403，话题不存在404。
- 数据与副作用：更新closed；以CONSOLE_ORG记forum.topic.close审计，只含话题id及开关，不含正文。
- 身份条件副作用：forumViewer仅在当前仍为组织成员时创建/刷新forum_users的角色、称号和GitHub头像；sid过期删除会话，上游拒绝token经全局处理时删会话并审计；游客不刷新成员记录。

源码：[app/server/src/routes/forum-api/topics.ts:67](../../../app/server/src/routes/forum-api/topics.ts#L67) · [app/server/src/lib/forum-store.ts:188](../../../app/server/src/lib/forum-store.ts#L188) · [app/server/src/routes/forum-api/viewer.ts:31](../../../app/server/src/routes/forum-api/viewer.ts#L31) · [app/server/src/lib/access.ts:19](../../../app/server/src/lib/access.ts#L19)

测试入口：[tests/server/forum.test.ts](../../../tests/server/forum.test.ts)。生成器未执行这些测试。

### 记录话题浏览数

标识：`flow:forum.topics.view`；性质：显式声明并关联源码，不是自动证明业务正确。

- 操作：`POST /api/forum/topics/:topic_id/view`
- 能力：
- 读取：`forum_topics`、`forum_topic_views`
- 写入：`forum_topics`、`forum_topic_views`
- 不入队：
- 权限与资源：游客或成员都可调用，不解析登录身份；按IP(/64)与话题去重。
- 响应与错误：204空体；不存在404，分钟60次超额429。
- 数据与副作用：事务清理超过1小时的去重记录，首次浏览才+1；IP只保留在短期去重表，不随帖子返回。

源码：[app/server/src/routes/forum-api/topics.ts:80](../../../app/server/src/routes/forum-api/topics.ts#L80) · [app/server/src/lib/forum-store.ts:188](../../../app/server/src/lib/forum-store.ts#L188)

测试入口：[tests/server/forum.test.ts](../../../tests/server/forum.test.ts)。生成器未执行这些测试。

### 成员或游客回复话题

标识：`flow:forum.posts.reply`；性质：显式声明并关联源码，不是自动证明业务正确。

- 操作：`POST /api/forum/posts`
- 能力：
- 读取：`forum_topics`、`forum_posts`、`forum_users`、`forum_notifications`、`forum_counters`、`forum_rate_events`、`role_assignments`、`audit_logs`、`sessions`、`departments`、`titles`、`forum_likes`
- 写入：`forum_posts`、`forum_topics`、`forum_users`、`forum_notifications`、`forum_counters`、`forum_rate_events`、`sessions`、`audit_logs`
- 不入队：
- 权限与资源：成员直接回复；游客需合法昵称、空蜜罐、PoW、可选Turnstile与IP/全站限流；已关闭话题仅forum.post.moderate可回，replyTo须同一话题。
- 响应与错误：201 {changes,viewer,guestPolicy,postId}含正文；404话题不存在；403关闭；400正文/昵称/冒名/PoW/验证码失败；429 rate_limited或guest_replies_paused。
- 数据与副作用：事务创建回复并更新最后活动、处理回复与提及通知；游客用户与回复同事务；PoW通过就记该IP尝试额度，成功才记全站额度；冒名检查读指派、历史登录审计及会话；不发送邮件。
- 身份条件副作用：forumViewer仅在当前仍为组织成员时创建/刷新forum_users的角色、称号和GitHub头像；sid过期删除会话，上游拒绝token经全局处理时删会话并审计；游客不刷新成员记录。

源码：[app/server/src/routes/forum-api/posts.ts:36](../../../app/server/src/routes/forum-api/posts.ts#L36) · [app/server/src/lib/forum-store.ts:188](../../../app/server/src/lib/forum-store.ts#L188) · [app/server/src/routes/forum-api/viewer.ts:31](../../../app/server/src/routes/forum-api/viewer.ts#L31) · [app/server/src/lib/access.ts:19](../../../app/server/src/lib/access.ts#L19)

测试入口：[tests/server/forum.test.ts](../../../tests/server/forum.test.ts)。生成器未执行这些测试。

### 编辑自己的帖子或执行版务

标识：`flow:forum.posts.edit`；性质：显式声明并关联源码，不是自动证明业务正确。

- 操作：`PATCH /api/forum/posts/:post_id`
- 能力：
- 读取：`forum_posts`、`sessions`、`role_assignments`、`departments`、`titles`、`forum_users`、`forum_likes`
- 写入：`forum_posts`、`audit_logs`、`forum_users`、`sessions`
- 不入队：
- 权限与资源：requireMember：有效sid且当前仍是CONSOLE_ORG成员；主体由服务端forumViewer确定，客户端userId/role不能赋权。 必须是作者本人，或者持有forum.post.moderate；能力不是作者分支的共同前提。
- 响应与错误：200 {changes,viewer,guestPolicy}；只返回本次变动记录，成员自己的用户记录总携带，私有记录按本人范围投影。；帖子正文随changes返回；404不存在、403他人帖子、409 post_deleted、400 empty_content。
- 数据与副作用：只更新正文/edited_at；只有编辑他人帖子才写forum.post.edit审计，不记录正文；不会因编辑重新发送提及通知。
- 身份条件副作用：forumViewer仅在当前仍为组织成员时创建/刷新forum_users的角色、称号和GitHub头像；sid过期删除会话，上游拒绝token经全局处理时删会话并审计；游客不刷新成员记录。

源码：[app/server/src/routes/forum-api/posts.ts:78](../../../app/server/src/routes/forum-api/posts.ts#L78) · [app/server/src/lib/forum-store.ts:188](../../../app/server/src/lib/forum-store.ts#L188) · [app/server/src/routes/forum-api/viewer.ts:31](../../../app/server/src/routes/forum-api/viewer.ts#L31) · [app/server/src/lib/access.ts:19](../../../app/server/src/lib/access.ts#L19)

测试入口：[tests/server/forum.test.ts](../../../tests/server/forum.test.ts)。生成器未执行这些测试。

### 软删除回复

标识：`flow:forum.posts.delete`；性质：显式声明并关联源码，不是自动证明业务正确。

- 操作：`DELETE /api/forum/posts/:post_id`
- 能力：
- 读取：`forum_posts`、`sessions`、`role_assignments`、`departments`、`titles`、`forum_users`、`forum_likes`
- 写入：`forum_posts`、`audit_logs`、`forum_users`、`sessions`
- 不入队：
- 权限与资源：requireMember：有效sid且当前仍是CONSOLE_ORG成员；主体由服务端forumViewer确定，客户端userId/role不能赋权。 作者本人或forum.post.moderate；第一帖禁止删除。
- 响应与错误：200 {changes,viewer,guestPolicy}；只返回本次变动记录，成员自己的用户记录总携带，私有记录按本人范围投影。；404不存在、403他人帖子、400 first_post；已软删重试返回现状。
- 数据与副作用：置deleted并清正文，保留点赞和书签；只在删除他人帖子时记forum.post.delete审计；幂等重试不重复执行删除。
- 身份条件副作用：forumViewer仅在当前仍为组织成员时创建/刷新forum_users的角色、称号和GitHub头像；sid过期删除会话，上游拒绝token经全局处理时删会话并审计；游客不刷新成员记录。

源码：[app/server/src/routes/forum-api/posts.ts:90](../../../app/server/src/routes/forum-api/posts.ts#L90) · [app/server/src/lib/forum-store.ts:188](../../../app/server/src/lib/forum-store.ts#L188) · [app/server/src/routes/forum-api/viewer.ts:31](../../../app/server/src/routes/forum-api/viewer.ts#L31) · [app/server/src/lib/access.ts:19](../../../app/server/src/lib/access.ts#L19)

测试入口：[tests/server/forum.test.ts](../../../tests/server/forum.test.ts)。生成器未执行这些测试。

### 切换本人点赞

标识：`flow:forum.posts.like`；性质：显式声明并关联源码，不是自动证明业务正确。

- 操作：`POST /api/forum/posts/:post_id/like`
- 能力：
- 读取：`forum_posts`、`forum_likes`、`forum_users`、`forum_notifications`、`forum_counters`、`sessions`、`role_assignments`、`departments`、`titles`
- 写入：`forum_likes`、`forum_notifications`、`forum_counters`、`forum_users`、`sessions`、`audit_logs`
- 不入队：
- 权限与资源：requireMember：有效sid且当前仍是CONSOLE_ORG成员；主体由服务端forumViewer确定，客户端userId/role不能赋权。 点赞主体固定本人，不接受代他人点赞。
- 响应与错误：200 {changes,viewer,guestPolicy}；只返回本次变动记录，成员自己的用户记录总携带，私有记录按本人范围投影。；404不存在，409 post_deleted；帖子投影不带全文。
- 数据与副作用：事务切换点赞；新点赞按作者通知设置生成一次通知（同人同帖不重复），取消不撤回已有通知，不写操作审计。
- 身份条件副作用：forumViewer仅在当前仍为组织成员时创建/刷新forum_users的角色、称号和GitHub头像；sid过期删除会话，上游拒绝token经全局处理时删会话并审计；游客不刷新成员记录。

源码：[app/server/src/routes/forum-api/posts.ts:101](../../../app/server/src/routes/forum-api/posts.ts#L101) · [app/server/src/lib/forum-store.ts:188](../../../app/server/src/lib/forum-store.ts#L188) · [app/server/src/routes/forum-api/viewer.ts:31](../../../app/server/src/routes/forum-api/viewer.ts#L31) · [app/server/src/lib/access.ts:19](../../../app/server/src/lib/access.ts#L19)

测试入口：[tests/server/forum.test.ts](../../../tests/server/forum.test.ts)。生成器未执行这些测试。

### 切换本人书签

标识：`flow:forum.posts.bookmark`；性质：显式声明并关联源码，不是自动证明业务正确。

- 操作：`POST /api/forum/posts/:post_id/bookmark`
- 能力：
- 读取：`forum_posts`、`forum_bookmarks`、`sessions`、`role_assignments`、`departments`、`titles`、`forum_users`、`forum_likes`
- 写入：`forum_bookmarks`、`forum_users`、`sessions`、`audit_logs`
- 不入队：
- 权限与资源：requireMember：有效sid且当前仍是CONSOLE_ORG成员；主体由服务端forumViewer确定，客户端userId/role不能赋权。 只能操作本人的书签；handler只检查帖子存在，未禁止为已软删帖子加书签。
- 响应与错误：200 {changes,viewer,guestPolicy}；只返回本次变动记录，成员自己的用户记录总携带，私有记录按本人范围投影。；404不存在；删除书签用changes.removed反馈。
- 数据与副作用：事务按userId/postId切换书签，不通知作者，不修改帖子正文。
- 身份条件副作用：forumViewer仅在当前仍为组织成员时创建/刷新forum_users的角色、称号和GitHub头像；sid过期删除会话，上游拒绝token经全局处理时删会话并审计；游客不刷新成员记录。

源码：[app/server/src/routes/forum-api/posts.ts:109](../../../app/server/src/routes/forum-api/posts.ts#L109) · [app/server/src/lib/forum-store.ts:188](../../../app/server/src/lib/forum-store.ts#L188) · [app/server/src/routes/forum-api/viewer.ts:31](../../../app/server/src/routes/forum-api/viewer.ts#L31) · [app/server/src/lib/access.ts:19](../../../app/server/src/lib/access.ts#L19)

测试入口：[tests/server/forum.test.ts](../../../tests/server/forum.test.ts)。生成器未执行这些测试。

### 切换本人关注关系

标识：`flow:forum.users.follow`；性质：显式声明并关联源码，不是自动证明业务正确。

- 操作：`POST /api/forum/users/:forum_user_id/follow`
- 能力：
- 读取：`forum_users`、`forum_follows`、`forum_notifications`、`forum_counters`、`sessions`、`role_assignments`、`departments`、`titles`、`forum_likes`
- 写入：`forum_follows`、`forum_notifications`、`forum_counters`、`forum_users`、`sessions`、`audit_logs`
- 不入队：
- 权限与资源：requireMember：有效sid且当前仍是CONSOLE_ORG成员；主体由服务端forumViewer确定，客户端userId/role不能赋权。 关注发起人固定本人，目标须存在且不是本人。
- 响应与错误：200 {changes,viewer,guestPolicy}；只返回本次变动记录，成员自己的用户记录总携带，私有记录按本人范围投影。；404未知用户，400 cannot_follow_self。
- 数据与副作用：事务切换关注；首次关注在对方允许通知且未曾通知时写通知与编号，取消关注不删除旧通知。
- 身份条件副作用：forumViewer仅在当前仍为组织成员时创建/刷新forum_users的角色、称号和GitHub头像；sid过期删除会话，上游拒绝token经全局处理时删会话并审计；游客不刷新成员记录。

源码：[app/server/src/routes/forum-api/people.ts:11](../../../app/server/src/routes/forum-api/people.ts#L11) · [app/server/src/lib/forum-store.ts:188](../../../app/server/src/lib/forum-store.ts#L188) · [app/server/src/routes/forum-api/viewer.ts:31](../../../app/server/src/routes/forum-api/viewer.ts#L31) · [app/server/src/lib/access.ts:19](../../../app/server/src/lib/access.ts#L19)

测试入口：[tests/server/forum.test.ts](../../../tests/server/forum.test.ts)。生成器未执行这些测试。

### 标记本人通知已读

标识：`flow:forum.notifications.read`；性质：显式声明并关联源码，不是自动证明业务正确。

- 操作：`POST /api/forum/notifications/:notification_id/read`
- 能力：
- 读取：`forum_notifications`、`sessions`、`role_assignments`、`departments`、`titles`、`forum_users`、`forum_likes`
- 写入：`forum_notifications`、`forum_users`、`sessions`、`audit_logs`
- 不入队：
- 权限与资源：requireMember：有效sid且当前仍是CONSOLE_ORG成员；主体由服务端forumViewer确定，客户端userId/role不能赋权。 SQL同时匹配通知id与recipient_id，不能读取/标记他人通知。
- 响应与错误：200 {changes,viewer,guestPolicy}；只返回本次变动记录，成员自己的用户记录总携带，私有记录按本人范围投影。；不存在或属于他人均404。
- 数据与副作用：仅更新本人该条read=1，不删通知；其他人的通知设置不下发。
- 身份条件副作用：forumViewer仅在当前仍为组织成员时创建/刷新forum_users的角色、称号和GitHub头像；sid过期删除会话，上游拒绝token经全局处理时删会话并审计；游客不刷新成员记录。

源码：[app/server/src/routes/forum-api/people.ts:20](../../../app/server/src/routes/forum-api/people.ts#L20) · [app/server/src/lib/forum-store.ts:188](../../../app/server/src/lib/forum-store.ts#L188) · [app/server/src/routes/forum-api/viewer.ts:31](../../../app/server/src/routes/forum-api/viewer.ts#L31) · [app/server/src/lib/access.ts:19](../../../app/server/src/lib/access.ts#L19)

测试入口：[tests/server/forum.test.ts](../../../tests/server/forum.test.ts)。生成器未执行这些测试。

### 标记本人全部通知已读

标识：`flow:forum.notifications.read_all`；性质：显式声明并关联源码，不是自动证明业务正确。

- 操作：`POST /api/forum/notifications/read-all`
- 能力：
- 读取：`forum_notifications`、`sessions`、`role_assignments`、`departments`、`titles`、`forum_users`、`forum_likes`
- 写入：`forum_notifications`、`forum_users`、`sessions`、`audit_logs`
- 不入队：
- 权限与资源：requireMember：有效sid且当前仍是CONSOLE_ORG成员；主体由服务端forumViewer确定，客户端userId/role不能赋权。 仅recipient_id等于本人。
- 响应与错误：200 {changes,viewer,guestPolicy}；只返回本次变动记录，成员自己的用户记录总携带，私有记录按本人范围投影。；没有未读通知仍返回合法空变更。
- 数据与副作用：UPDATE本人未读行并RETURNING id，据此只回变动通知，不清除别人的未读数。
- 身份条件副作用：forumViewer仅在当前仍为组织成员时创建/刷新forum_users的角色、称号和GitHub头像；sid过期删除会话，上游拒绝token经全局处理时删会话并审计；游客不刷新成员记录。

源码：[app/server/src/routes/forum-api/people.ts:26](../../../app/server/src/routes/forum-api/people.ts#L26) · [app/server/src/lib/forum-store.ts:188](../../../app/server/src/lib/forum-store.ts#L188) · [app/server/src/routes/forum-api/viewer.ts:31](../../../app/server/src/routes/forum-api/viewer.ts#L31) · [app/server/src/lib/access.ts:19](../../../app/server/src/lib/access.ts#L19)

测试入口：[tests/server/forum.test.ts](../../../tests/server/forum.test.ts)。生成器未执行这些测试。

### 修改本人论坛资料

标识：`flow:forum.profile.update`；性质：显式声明并关联源码，不是自动证明业务正确。

- 操作：`PATCH /api/forum/me/profile`
- 能力：
- 读取：`forum_users`、`role_assignments`、`sessions`、`audit_logs`、`departments`、`titles`、`forum_likes`
- 写入：`forum_users`、`sessions`、`audit_logs`
- 不入队：
- 权限与资源：requireMember：有效sid且当前仍是CONSOLE_ORG成员；主体由服务端forumViewer确定，客户端userId/role不能赋权。 只修改本人记录；允许昵称、签名、所在地、https网站与通知设置，不接收用户角色授权。
- 响应与错误：200 {changes,viewer,guestPolicy}；只返回本次变动记录，成员自己的用户记录总携带，私有记录按本人范围投影。；400昵称/控制字符/网址等错误；旧昵称未变时不因新昵称规则阻止修改其他字段。
- 数据与副作用：昵称NFKC与冒名检查后保存；冒名来源含已有成员/官方用户名、指派和登录过的组织账号；只更新提交字段，不更改GitHub资料。
- 身份条件副作用：forumViewer仅在当前仍为组织成员时创建/刷新forum_users的角色、称号和GitHub头像；sid过期删除会话，上游拒绝token经全局处理时删会话并审计；游客不刷新成员记录。

源码：[app/server/src/routes/forum-api/people.ts:32](../../../app/server/src/routes/forum-api/people.ts#L32) · [app/server/src/lib/forum-store.ts:188](../../../app/server/src/lib/forum-store.ts#L188) · [app/server/src/routes/forum-api/viewer.ts:31](../../../app/server/src/routes/forum-api/viewer.ts#L31) · [app/server/src/lib/access.ts:19](../../../app/server/src/lib/access.ts#L19)

测试入口：[tests/server/forum.test.ts](../../../tests/server/forum.test.ts)。生成器未执行这些测试。

### 上传本人论坛头像

标识：`flow:forum.avatar.upload`；性质：显式声明并关联源码，不是自动证明业务正确。

- 操作：`PUT /api/forum/me/avatar`
- 能力：
- 读取：`forum_avatars`、`forum_users`、`forum_rate_events`、`sessions`、`role_assignments`、`departments`、`titles`、`forum_likes`
- 写入：`forum_avatars`、`forum_users`、`forum_rate_events`、`sessions`、`audit_logs`
- 不入队：
- 权限与资源：requireMember：有效sid且当前仍是CONSOLE_ORG成员；主体由服务端forumViewer确定，客户端userId/role不能赋权。 onRequest阶段即鉴权并消费每小时10次额度，失败解码也算；只改本人头像。
- 响应与错误：200 {changes,viewer,guestPolicy}；只返回本次变动记录，成员自己的用户记录总携带，私有记录按本人范围投影。；413 avatar_too_large，415 unsupported_media_type，400非法图像/尺寸，429限流。
- 数据与副作用：PNG/JPEG/WebP最多2MB、4096×4096；sharp取首帧转256×256 WebP去元数据；按哈希写库并更新本人引用，同事务清理无人引用的旧头像。
- 身份条件副作用：forumViewer仅在当前仍为组织成员时创建/刷新forum_users的角色、称号和GitHub头像；sid过期删除会话，上游拒绝token经全局处理时删会话并审计；游客不刷新成员记录。

源码：[app/server/src/routes/forum-api/people.ts:80](../../../app/server/src/routes/forum-api/people.ts#L80) · [app/server/src/lib/forum-store.ts:188](../../../app/server/src/lib/forum-store.ts#L188) · [app/server/src/lib/forum-avatar.ts:16](../../../app/server/src/lib/forum-avatar.ts#L16) · [app/server/src/routes/forum-api/viewer.ts:31](../../../app/server/src/routes/forum-api/viewer.ts#L31) · [app/server/src/lib/access.ts:19](../../../app/server/src/lib/access.ts#L19)

测试入口：[tests/server/forum.test.ts](../../../tests/server/forum.test.ts)。生成器未执行这些测试。

### 恢复本人默认头像

标识：`flow:forum.avatar.clear`；性质：显式声明并关联源码，不是自动证明业务正确。

- 操作：`DELETE /api/forum/me/avatar`
- 能力：
- 读取：`forum_users`、`forum_avatars`、`sessions`、`role_assignments`、`departments`、`titles`、`forum_likes`
- 写入：`forum_users`、`forum_avatars`、`sessions`、`audit_logs`
- 不入队：
- 权限与资源：requireMember：有效sid且当前仍是CONSOLE_ORG成员；主体由服务端forumViewer确定，客户端userId/role不能赋权。 只清本人自定义头像。
- 响应与错误：200 {changes,viewer,guestPolicy}；只返回本次变动记录，成员自己的用户记录总携带，私有记录按本人范围投影。
- 数据与副作用：事务移除avatar_hash引用并删除无用户引用的旧头像，保留GitHub头像字段用于回退，不删除用户。
- 身份条件副作用：forumViewer仅在当前仍为组织成员时创建/刷新forum_users的角色、称号和GitHub头像；sid过期删除会话，上游拒绝token经全局处理时删会话并审计；游客不刷新成员记录。

源码：[app/server/src/routes/forum-api/people.ts:91](../../../app/server/src/routes/forum-api/people.ts#L91) · [app/server/src/lib/forum-store.ts:188](../../../app/server/src/lib/forum-store.ts#L188) · [app/server/src/routes/forum-api/viewer.ts:31](../../../app/server/src/routes/forum-api/viewer.ts#L31) · [app/server/src/lib/access.ts:19](../../../app/server/src/lib/access.ts#L19)

测试入口：[tests/server/forum.test.ts](../../../tests/server/forum.test.ts)。生成器未执行这些测试。

### 读取公开头像文件

标识：`flow:forum.avatar.read`；性质：显式声明并关联源码，不是自动证明业务正确。

- 操作：`GET /api/forum/avatars/:file`
- 能力：
- 读取：`forum_avatars`
- 写入：
- 不入队：
- 权限与资源：匿名；按合同限定的哈希.webp取文件，不接受磁盘路径。
- 响应与错误：200 image/webp二进制，immutable一年缓存、default-src none和nosniff；不存在404。
- 数据与副作用：按哈希读取SQLite内WebP数据，不读取私有快照文件或解析sid。

源码：[app/server/src/routes/forum-api/people.ts:99](../../../app/server/src/routes/forum-api/people.ts#L99) · [app/server/src/lib/forum-store.ts:188](../../../app/server/src/lib/forum-store.ts#L188)

测试入口：[tests/server/forum.test.ts](../../../tests/server/forum.test.ts)。生成器未执行这些测试。

### 辨认本机论坛运行模式

标识：`flow:forum.local.supervisor`；性质：显式声明并关联源码，不是自动证明业务正确。

- 操作：`interface:forum.local-supervisor`
- 能力：
- 读取：
- 写入：
- 不入队：
- 权限与资源：仅import.meta.dev，非开发404；不是登录身份或业务权限接口。
- 响应与错误：200 {module,instance,mode,contentSource,snapshotConfigured,realAuthentication:false,serverPersistence:false}，no-store。
- 数据与副作用：只读运行时配置与进程标识；snapshotConfigured只检查配置是否非空，不连接数据库或校验文件可用。
- 验证边界：所列为纯解析、内容转换或配置测试，不是本次启动Nitro或读取真实快照的证明。

源码：[app/forum/server/routes/__geek_forum.get.ts:4](../../../app/forum/server/routes/__geek_forum.get.ts#L4)

测试入口：[app/forum/tests/content-source.test.ts](../../../app/forum/tests/content-source.test.ts)。生成器未执行这些测试。

### 读取开发快照状态

标识：`flow:forum.local.state`；性质：显式声明并关联源码，不是自动证明业务正确。

- 操作：`interface:forum.local-state`
- 能力：
- 读取：
- 写入：
- 不入队：
- 权限与资源：仅开发且配置快照目录，GET/HEAD；不实现成员认证，不能把游客展示认成权限校验。
- 响应与错误：GET 200 {schemaVersion,mode,capturedAt,summary,state}；HEAD空体；未配置404，其他方法405，快照不可读/不合法503。
- 数据与副作用：读取content.json、asset-index.json和内容编辑层，解析后缓存当前进程；失败缓存清除以便重试；no-store/nosniff，无SQLite或写文件。
- 验证边界：所列为纯解析、内容转换或配置测试，不是本次启动Nitro或读取真实快照的证明。

源码：[app/forum/server/routes/api/local-forum/state.ts:13](../../../app/forum/server/routes/api/local-forum/state.ts#L13) · [app/forum/server/utils/local-snapshot.ts:45](../../../app/forum/server/utils/local-snapshot.ts#L45) · [app/forum/server/utils/local-snapshot.ts:58](../../../app/forum/server/utils/local-snapshot.ts#L58)

测试入口：[app/forum/tests/local-snapshot.test.ts](../../../app/forum/tests/local-snapshot.test.ts) · [app/forum/tests/local-curation.test.ts](../../../app/forum/tests/local-curation.test.ts) · [app/forum/tests/content-source.test.ts](../../../app/forum/tests/content-source.test.ts)。生成器未执行这些测试。

### 读取开发快照附件

标识：`flow:forum.local.asset`；性质：显式声明并关联源码，不是自动证明业务正确。

- 操作：`interface:forum.local-asset`
- 能力：
- 读取：
- 写入：
- 不入队：
- 权限与资源：仅开发配置快照且GET/HEAD；hash须在资产索引中、文件必须位于assets目录，不根据原始文件名开放路径。
- 响应与错误：200完整或206单段Range；HEAD同头无体；404缺条目/文件，416不可满足范围，500大小不符，503快照失败。
- 数据与副作用：读取索引及资产stat/文件流，类型和disposition来自索引；CSP禁止脚本，断连销毁流；多段/不识别Range回完整体；不修改快照。
- 验证边界：所列为纯解析、内容转换或配置测试，不是本次启动Nitro或读取真实快照的证明。

源码：[app/forum/server/routes/api/local-forum/assets/[hash].ts:15](../../../app/forum/server/routes/api/local-forum/assets/[hash].ts#L15) · [app/forum/server/utils/local-snapshot.ts:45](../../../app/forum/server/utils/local-snapshot.ts#L45) · [app/forum/server/utils/local-snapshot.ts:58](../../../app/forum/server/utils/local-snapshot.ts#L58)

测试入口：[app/forum/tests/local-snapshot.test.ts](../../../app/forum/tests/local-snapshot.test.ts)。生成器未执行这些测试。

### 提供论坛Markdown索引

标识：`flow:forum.markdown.index`；性质：显式声明并关联源码，不是自动证明业务正确。

- 操作：`interface:forum.llms`
- 能力：
- 读取：
- 写入：
- 不入队：
- 权限与资源：匿名GET/HEAD；只拦截llms.txt；其它方法/路径交后续处理器。
- 响应与错误：200 text/plain UTF-8加nosniff；快照加载失败503。
- 数据与副作用：site构建使用siteForumState，开发快照模式读只读投影，否则进程示例种子；预渲染可落成静态文件，不动态读取核心forum_*数据库。
- 验证边界：所列为纯解析、内容转换或配置测试，不是本次启动Nitro或读取真实快照的证明。

源码：[app/forum/server/middleware/forum-markdown.ts:36](../../../app/forum/server/middleware/forum-markdown.ts#L36) · [app/forum/server/middleware/forum-markdown.ts:55](../../../app/forum/server/middleware/forum-markdown.ts#L55)

测试入口：[app/forum/tests/forum-markdown.test.ts](../../../app/forum/tests/forum-markdown.test.ts) · [app/forum/tests/site-state.test.ts](../../../app/forum/tests/site-state.test.ts) · [app/forum/tests/content-source.test.ts](../../../app/forum/tests/content-source.test.ts)。生成器未执行这些测试。

### 提供话题Markdown正文

标识：`flow:forum.markdown.topic`；性质：显式声明并关联源码，不是自动证明业务正确。

- 操作：`interface:forum.topic-markdown`
- 能力：
- 读取：
- 写入：
- 不入队：
- 权限与资源：匿名GET/HEAD；路径按TOPIC_MARKDOWN匹配，不能二次解码冒充其他路由。
- 响应与错误：200 text/markdown UTF-8；未知话题404 text/plain；快照失败503。
- 数据与副作用：与索引同源：site内容/开发快照/示例种子；不包含浏览器新写内容或实时核心数据库帖子，构建静态输出与在线核心API分别取证。
- 验证边界：所列为纯解析、内容转换或配置测试，不是本次启动Nitro或读取真实快照的证明。

源码：[app/forum/server/middleware/forum-markdown.ts:26](../../../app/forum/server/middleware/forum-markdown.ts#L26) · [app/forum/server/middleware/forum-markdown.ts:55](../../../app/forum/server/middleware/forum-markdown.ts#L55)

测试入口：[app/forum/tests/forum-markdown.test.ts](../../../app/forum/tests/forum-markdown.test.ts) · [app/forum/tests/site-state.test.ts](../../../app/forum/tests/site-state.test.ts)。生成器未执行这些测试。

### 获取公开比赛列表

标识：`flow:competition.public.list`；性质：显式声明并关联源码，不是自动证明业务正确。

- 操作：`GET /api/public/competitions`
- 能力：
- 读取：`competitions`
- 写入：
- 不入队：
- 权限与资源：公开接口，无需登录；仅返回未下线比赛（offline=0）。
- 响应与错误：200 { competitions }；计算动态状态（registering/ongoing/closed/ended），不暴露内部字段与成员个人信息。
- 数据与副作用：只读查询，无数据库写入与副作用。

源码：[app/server/src/routes/portal/competitions.ts:10](../../../app/server/src/routes/portal/competitions.ts#L10) · [app/server/src/routes/portal/contracts.ts:11](../../../app/server/src/routes/portal/contracts.ts#L11) · [app/server/src/routes/portal/index.ts:9](../../../app/server/src/routes/portal/index.ts#L9) · [app/web/sites/portal/lib/competitions.ts:1](../../../app/web/sites/portal/lib/competitions.ts#L1) · [app/web/sites/portal/components/os/Windows.tsx:22](../../../app/web/sites/portal/components/os/Windows.tsx#L22) · [app/web/sites/portal/components/os/YugcOs.tsx:115](../../../app/web/sites/portal/components/os/YugcOs.tsx#L115) · [app/web/sites/portal/lib/osApps.ts:46](../../../app/web/sites/portal/lib/osApps.ts#L46) · [app/web/shared/lib/mock-api.ts:11](../../../app/web/shared/lib/mock-api.ts#L11)

测试入口：[tests/server/competitions.test.ts](../../../tests/server/competitions.test.ts) · [tests/web/portal-competitions.test.tsx](../../../tests/web/portal-competitions.test.tsx)。生成器未执行这些测试。

### 控制台查看比赛列表

标识：`flow:competition.console.list`；性质：显式声明并关联源码，不是自动证明业务正确。

- 操作：`GET /api/console/competitions`
- 能力：`console.access`
- 读取：`competitions`、`sessions`、`role_assignments`、`departments`、`titles`
- 写入：`sessions`、`audit_logs`
- 不入队：
- 权限与资源：需要 console.access 能力；返回全部比赛（含已下线 offline=1）。
- 响应与错误：200 { competitions }；每个条目包含 offline 标记和管理时间戳。
- 数据与副作用：仅在会话过期时删除会话并记审计日志，无业务表写入。

源码：[app/server/src/routes/console/competitions.ts:30](../../../app/server/src/routes/console/competitions.ts#L30) · [app/server/src/routes/console/contracts.ts:27](../../../app/server/src/routes/console/contracts.ts#L27) · [app/server/src/routes/console/index.ts:29](../../../app/server/src/routes/console/index.ts#L29) · [app/console/src/lib/competitions.ts:1](../../../app/console/src/lib/competitions.ts#L1) · [app/console/src/lib/nav.ts:32](../../../app/console/src/lib/nav.ts#L32) · [app/console/src/lib/permission-boundaries.ts:97](../../../app/console/src/lib/permission-boundaries.ts#L97) · [app/console/src/lib/types.ts:119](../../../app/console/src/lib/types.ts#L119) · [app/console/src/mock/console.ts:292](../../../app/console/src/mock/console.ts#L292) · [app/console/src/pages/Competitions.vue:1](../../../app/console/src/pages/Competitions.vue#L1) · [app/console/src/router.ts:26](../../../app/console/src/router.ts#L26)

测试入口：[tests/server/competitions.test.ts](../../../tests/server/competitions.test.ts) · [tests/console/competitions.test.ts](../../../tests/console/competitions.test.ts)。生成器未执行这些测试。

### 新建比赛

标识：`flow:competition.console.create`；性质：显式声明并关联源码，不是自动证明业务正确。

- 操作：`POST /api/console/competitions`
- 能力：`competitions.manage`
- 读取：`competitions`、`sessions`、`role_assignments`、`departments`、`titles`
- 写入：`competitions`、`audit_logs`、`sessions`
- 不入队：
- 权限与资源：需要 competitions.manage 能力；频控 30 次/分钟。
- 响应与错误：201 { competition }；起止与报名截止时间合法性校验失败 400 bad_range / deadline_after_end。
- 数据与副作用：写入 competitions 表并记录 competition.create 审计日志。

源码：[app/server/src/routes/console/competitions.ts:38](../../../app/server/src/routes/console/competitions.ts#L38) · [app/server/src/lib/competition-store.ts:119](../../../app/server/src/lib/competition-store.ts#L119) · [app/server/src/lib/db.ts:188](../../../app/server/src/lib/db.ts#L188) · [app/server/src/lib/roles.ts:87](../../../app/server/src/lib/roles.ts#L87)

测试入口：[tests/server/competitions.test.ts](../../../tests/server/competitions.test.ts) · [tests/console/competitions.test.ts](../../../tests/console/competitions.test.ts)。生成器未执行这些测试。

### 修改或下线比赛

标识：`flow:competition.console.update`；性质：显式声明并关联源码，不是自动证明业务正确。

- 操作：`PATCH /api/console/competitions/:competition_id`
- 能力：`competitions.manage`
- 读取：`competitions`、`competition_signups`、`competition_signup_settings`、`sessions`、`role_assignments`、`departments`、`titles`
- 写入：`competitions`、`audit_logs`、`sessions`
- 不入队：
- 权限与资源：需要 competitions.manage 能力；频控 60 次/分钟。
- 响应与错误：200 { competition }；已有报名时禁止修改比赛类型（409 competition_has_signups）；开放报名中禁止清空报名截止时间（409 signup_deadline_required）。
- 数据与副作用：更新 competitions 表对应字段并记录 competition.update 审计日志。

源码：[app/server/src/routes/console/competitions.ts:57](../../../app/server/src/routes/console/competitions.ts#L57)

测试入口：[tests/server/competitions.test.ts](../../../tests/server/competitions.test.ts) · [tests/console/competitions.test.ts](../../../tests/console/competitions.test.ts)。生成器未执行这些测试。

### 删除比赛

标识：`flow:competition.console.delete`；性质：显式声明并关联源码，不是自动证明业务正确。

- 操作：`DELETE /api/console/competitions/:competition_id`
- 能力：`competitions.manage`
- 读取：`competitions`、`competition_signups`、`sessions`、`role_assignments`、`departments`、`titles`
- 写入：`competitions`、`audit_logs`、`sessions`
- 不入队：
- 权限与资源：需要 competitions.manage 能力；频控 30 次/分钟。
- 响应与错误：200 { ok: true }；有报名记录（含软取消）的比赛不可删除（409 competition_has_signups）。
- 数据与副作用：从 competitions 物理删除记录并写 competition.delete 审计日志。

源码：[app/server/src/routes/console/competitions.ts:92](../../../app/server/src/routes/console/competitions.ts#L92)

测试入口：[tests/server/competitions.test.ts](../../../tests/server/competitions.test.ts) · [tests/console/competitions.test.ts](../../../tests/console/competitions.test.ts)。生成器未执行这些测试。

### 查看比赛花名册与去重统计

标识：`flow:competition.roster.read`；性质：显式声明并关联源码，不是自动证明业务正确。

- 操作：`GET /api/console/competitions/:competition_id/roster`
- 能力：`competitions.manage`
- 读取：`competitions`、`competition_signups`、`competition_teams`、`competition_team_members`、`competition_signup_settings`、`sessions`、`role_assignments`、`departments`、`titles`
- 写入：`sessions`、`audit_logs`
- 不入队：
- 权限与资源：登录且具备 competitions.manage 能力。
- 响应与错误：200 { roster }；包含统计汇总 summary、队伍明细及未入队人员列表。
- 数据与副作用：多表关联只读查询，不修改花名册或队伍状态。

源码：[app/server/src/routes/console/competition-roster.ts:15](../../../app/server/src/routes/console/competition-roster.ts#L15)

测试入口：[tests/server/competition-signups.test.ts](../../../tests/server/competition-signups.test.ts) · [tests/console/competitions.test.ts](../../../tests/console/competitions.test.ts)。生成器未执行这些测试。

### 更新比赛报名设置

标识：`flow:competition.signup_settings.update`；性质：显式声明并关联源码，不是自动证明业务正确。

- 操作：`PUT /api/console/competitions/:competition_id/signup-settings`
- 能力：`competitions.manage`
- 读取：`competitions`、`competition_signup_settings`、`competition_teams`、`sessions`、`role_assignments`、`departments`、`titles`
- 写入：`competition_signup_settings`、`audit_logs`、`sessions`
- 不入队：
- 权限与资源：登录且具备 competitions.manage 能力。
- 响应与错误：200 { settings }；校验队伍人数范围（1<=team_min<=team_max<=20），若已有锁定队伍超出新范围则拒绝修改（409 locked_teams_exceed_limit）。
- 数据与副作用：写入或更新 competition_signup_settings 表并写 competition.signup_settings.update 审计日志。

源码：[app/server/src/routes/console/competition-roster.ts:39](../../../app/server/src/routes/console/competition-roster.ts#L39)

测试入口：[tests/server/competition-signups.test.ts](../../../tests/server/competition-signups.test.ts) · [tests/console/competitions.test.ts](../../../tests/console/competitions.test.ts)。生成器未执行这些测试。

### 导出比赛花名册CSV

标识：`flow:competition.roster.export`；性质：显式声明并关联源码，不是自动证明业务正确。

- 操作：`GET /api/console/competitions/:competition_id/roster.csv`
- 能力：`competitions.manage`
- 读取：`competitions`、`competition_signups`、`competition_teams`、`competition_team_members`、`competition_signup_settings`、`sessions`、`role_assignments`、`departments`、`titles`
- 写入：`audit_logs`、`sessions`
- 不入队：
- 权限与资源：登录且具备 competitions.manage 能力；频控 5 次/分钟。
- 响应与错误：200 text/csv; charset=utf-8，含 UTF-8 BOM，附件下载；防 CSV 公式注入（=, +, -, @, \t, \r 前置单引号）。
- 数据与副作用：记录 competition.roster.export 审计日志（含比赛名称）。

源码：[app/server/src/routes/console/competition-roster.ts:76](../../../app/server/src/routes/console/competition-roster.ts#L76) · [app/server/src/lib/csv.ts:2](../../../app/server/src/lib/csv.ts#L2)

测试入口：[tests/server/competition-signups.test.ts](../../../tests/server/competition-signups.test.ts) · [tests/console/competitions.test.ts](../../../tests/console/competitions.test.ts)。生成器未执行这些测试。

### 获取我的参赛列表

标识：`flow:competition.signup.my_competitions`；性质：显式声明并关联源码，不是自动证明业务正确。

- 操作：`GET /api/me/competitions`
- 能力：
- 读取：`competitions`、`competition_signups`、`competition_teams`、`competition_team_members`、`competition_signup_settings`、`sessions`
- 写入：`sessions`、`audit_logs`
- 不入队：
- 权限与资源：登录且为组织活跃成员（memberOnly）；按当前 account_id 查询。
- 响应与错误：200 { competitions, pending_actions_count }；汇总个人参与的所有比赛看板与待办角标。
- 数据与副作用：只读查询，无业务写入。

源码：[app/server/src/routes/portal/competition-signups.ts:39](../../../app/server/src/routes/portal/competition-signups.ts#L39)

测试入口：[tests/server/competitions.test.ts](../../../tests/server/competitions.test.ts) · [tests/server/competition-signups.test.ts](../../../tests/server/competition-signups.test.ts)。生成器未执行这些测试。

### 获取个人参赛状态与看板

标识：`flow:competition.signup.my_status`；性质：显式声明并关联源码，不是自动证明业务正确。

- 操作：`GET /api/competitions/:id/my-status`
- 能力：
- 读取：`competitions`、`competition_signups`、`competition_teams`、`competition_team_members`、`competition_signup_settings`、`sessions`
- 写入：`sessions`、`audit_logs`
- 不入队：
- 权限与资源：登录且为组织活跃成员；按比赛 id 和当前 account_id 查询。
- 响应与错误：200 { status: { stage, role, team, signup, pending_invitations, pending_applications } }；比赛不存在或已下线回 404。
- 数据与副作用：状态机看板只读解析，报名结束后未锁定人员映射为 unplaced。

源码：[app/server/src/routes/portal/competition-signups.ts:51](../../../app/server/src/routes/portal/competition-signups.ts#L51)

测试入口：[tests/server/competitions.test.ts](../../../tests/server/competitions.test.ts) · [tests/server/competition-signups.test.ts](../../../tests/server/competition-signups.test.ts)。生成器未执行这些测试。

### 个人报名或登记意向

标识：`flow:competition.signup.submit`；性质：显式声明并关联源码，不是自动证明业务正确。

- 操作：`POST /api/competitions/:id/signup`
- 能力：
- 读取：`competitions`、`competition_signups`、`competition_signup_settings`、`sessions`
- 写入：`competition_signups`、`sessions`、`audit_logs`
- 不入队：
- 权限与资源：登录且为组织活跃成员；报名已截止或未开放时拒绝（400 signup_closed）。
- 响应与错误：201 { ok: true, signup }；重复提交为幂等更新（更新 note 与 looking_for_team）。
- 数据与副作用：插入或更新 competition_signups 表，状态置为 active。

源码：[app/server/src/routes/portal/competition-signups.ts:67](../../../app/server/src/routes/portal/competition-signups.ts#L67) · [app/server/src/lib/competition-signup-store.ts:276](../../../app/server/src/lib/competition-signup-store.ts#L276)

测试入口：[tests/server/competitions.test.ts](../../../tests/server/competitions.test.ts) · [tests/server/competition-signups.test.ts](../../../tests/server/competition-signups.test.ts)。生成器未执行这些测试。

### 取消个人报名

标识：`flow:competition.signup.cancel`；性质：显式声明并关联源码，不是自动证明业务正确。

- 操作：`DELETE /api/competitions/:id/signup`
- 能力：
- 读取：`competitions`、`competition_signups`、`competition_signup_settings`、`competition_team_members`、`sessions`
- 写入：`competition_signups`、`sessions`、`audit_logs`
- 不入队：
- 权限与资源：登录且为组织活跃成员；仅未锁定的队员允许取消报名。
- 响应与错误：200 { ok: true }；若处于锁定参赛队伍中则拒绝取消（409 in_locked_team）。
- 数据与副作用：软删除，更新 competition_signups 状态为 cancelled。

源码：[app/server/src/routes/portal/competition-signups.ts:89](../../../app/server/src/routes/portal/competition-signups.ts#L89)

测试入口：[tests/server/competitions.test.ts](../../../tests/server/competitions.test.ts) · [tests/server/competition-signups.test.ts](../../../tests/server/competition-signups.test.ts)。生成器未执行这些测试。

### 获取比赛队伍列表

标识：`flow:competition.teams.list`；性质：显式声明并关联源码，不是自动证明业务正确。

- 操作：`GET /api/competitions/:id/teams`
- 能力：
- 读取：`competitions`、`competition_teams`、`competition_team_members`、`sessions`
- 写入：`sessions`、`audit_logs`
- 不入队：
- 权限与资源：登录且为组织活跃成员。
- 响应与错误：200 { teams }；列出未解散队伍（recruiting 与 locked），附带队长信息与队员人数。
- 数据与副作用：只读查询，无业务写入。

源码：[app/server/src/routes/portal/competition-signups.ts:110](../../../app/server/src/routes/portal/competition-signups.ts#L110)

测试入口：[tests/server/competitions.test.ts](../../../tests/server/competitions.test.ts) · [tests/server/competition-signups.test.ts](../../../tests/server/competition-signups.test.ts)。生成器未执行这些测试。

### 获取找队友列表

标识：`flow:competition.free_agents.list`；性质：显式声明并关联源码，不是自动证明业务正确。

- 操作：`GET /api/competitions/:id/free-agents`
- 能力：
- 读取：`competitions`、`competition_signups`、`competition_team_members`、`sessions`
- 写入：`sessions`、`audit_logs`
- 不入队：
- 权限与资源：登录且为组织活跃成员。
- 响应与错误：200 { free_agents }；筛选 looking_for_team=1 且未加入任何队伍的报名者。
- 数据与副作用：只读查询，不泄露除必要展示外的敏感个人信息。

源码：[app/server/src/routes/portal/competition-signups.ts:128](../../../app/server/src/routes/portal/competition-signups.ts#L128)

测试入口：[tests/server/competitions.test.ts](../../../tests/server/competitions.test.ts) · [tests/server/competition-signups.test.ts](../../../tests/server/competition-signups.test.ts)。生成器未执行这些测试。

### 创建参赛队伍

标识：`flow:competition.teams.create`；性质：显式声明并关联源码，不是自动证明业务正确。

- 操作：`POST /api/competitions/:id/teams`
- 能力：
- 读取：`competitions`、`competition_signup_settings`、`competition_teams`、`competition_team_members`、`sessions`
- 写入：`competition_teams`、`competition_team_members`、`sessions`、`audit_logs`
- 不入队：
- 权限与资源：登录且为组织活跃成员；报名开放期间且个人尚未在活跃队伍中。
- 响应与错误：201 { ok: true, team }；队名比赛内唯一（重复 409 duplicate_team_name）；已在队伍中 409 already_in_team。
- 数据与副作用：事务写入 competition_teams（创建者设为队长）并在 competition_team_members 插入队长 active 记录。

源码：[app/server/src/routes/portal/competition-signups.ts:144](../../../app/server/src/routes/portal/competition-signups.ts#L144)

测试入口：[tests/server/competitions.test.ts](../../../tests/server/competitions.test.ts) · [tests/server/competition-signups.test.ts](../../../tests/server/competition-signups.test.ts)。生成器未执行这些测试。

### 申请加入队伍

标识：`flow:competition.teams.apply`；性质：显式声明并关联源码，不是自动证明业务正确。

- 操作：`POST /api/teams/:id/apply`
- 能力：
- 读取：`competitions`、`competition_signup_settings`、`competition_teams`、`competition_team_members`、`sessions`
- 写入：`competition_team_members`、`sessions`、`audit_logs`
- 不入队：
- 权限与资源：登录且为组织活跃成员；队伍须处于 recruiting 且未满员。
- 响应与错误：201 { ok: true, membership }；重复申请回 409 duplicate_application；队伍已锁定或解散 409 team_not_recruiting。
- 数据与副作用：在 competition_team_members 插入一条 applied 状态记录。

源码：[app/server/src/routes/portal/competition-signups.ts:168](../../../app/server/src/routes/portal/competition-signups.ts#L168)

测试入口：[tests/server/competitions.test.ts](../../../tests/server/competitions.test.ts) · [tests/server/competition-signups.test.ts](../../../tests/server/competition-signups.test.ts)。生成器未执行这些测试。

### 队长邀请队员入队

标识：`flow:competition.teams.invite`；性质：显式声明并关联源码，不是自动证明业务正确。

- 操作：`POST /api/teams/:id/invite`
- 能力：
- 读取：`competitions`、`competition_signup_settings`、`competition_teams`、`competition_team_members`、`sessions`
- 写入：`competition_team_members`、`sessions`、`audit_logs`
- 不入队：
- 权限与资源：调用者必须是该队伍队长；队伍处于 recruiting 且未满员。
- 响应与错误：201 { ok: true, membership }；被邀请人已在队或已有待处理邀请回 409。
- 数据与副作用：在 competition_team_members 插入一条 invited 状态记录。

源码：[app/server/src/routes/portal/competition-signups.ts:190](../../../app/server/src/routes/portal/competition-signups.ts#L190)

测试入口：[tests/server/competitions.test.ts](../../../tests/server/competitions.test.ts) · [tests/server/competition-signups.test.ts](../../../tests/server/competition-signups.test.ts)。生成器未执行这些测试。

### 响应入队申请或队长邀请

标识：`flow:competition.teams.respond`；性质：显式声明并关联源码，不是自动证明业务正确。

- 操作：`POST /api/teams/:id/respond`
- 能力：
- 读取：`competitions`、`competition_signup_settings`、`competition_teams`、`competition_team_members`、`sessions`
- 写入：`competition_team_members`、`sessions`、`audit_logs`
- 不入队：
- 权限与资源：受邀人响应邀请或队长审批入队申请；仅当事人或队长可操作对应记录。
- 响应与错误：200 { ok: true, membership }；action 必须为 accept、decline 或 withdraw。
- 数据与副作用：事务更新记录状态；若 accept 则验证队伍上限并更新为 active，同时撤销该账号在此比赛的其他申请与邀请。

源码：[app/server/src/routes/portal/competition-signups.ts:216](../../../app/server/src/routes/portal/competition-signups.ts#L216)

测试入口：[tests/server/competitions.test.ts](../../../tests/server/competitions.test.ts) · [tests/server/competition-signups.test.ts](../../../tests/server/competition-signups.test.ts)。生成器未执行这些测试。

### 队员退队或队长解散

标识：`flow:competition.teams.leave`；性质：显式声明并关联源码，不是自动证明业务正确。

- 操作：`POST /api/teams/:id/leave`
- 能力：
- 读取：`competitions`、`competition_signup_settings`、`competition_teams`、`competition_team_members`、`sessions`
- 写入：`competition_teams`、`competition_team_members`、`sessions`、`audit_logs`
- 不入队：
- 权限与资源：调用者须为队伍活跃成员；已锁定队伍不可退队（409 team_locked）。
- 响应与错误：200 { ok: true }；普通队员退队状态置为 left；队长退队触发全队 disbanded。
- 数据与副作用：事务更新成员与队伍状态，释放名额与找队意向。

源码：[app/server/src/routes/portal/competition-signups.ts:240](../../../app/server/src/routes/portal/competition-signups.ts#L240)

测试入口：[tests/server/competitions.test.ts](../../../tests/server/competitions.test.ts) · [tests/server/competition-signups.test.ts](../../../tests/server/competition-signups.test.ts)。生成器未执行这些测试。

### 队长转让队伍

标识：`flow:competition.teams.transfer`；性质：显式声明并关联源码，不是自动证明业务正确。

- 操作：`POST /api/teams/:id/transfer`
- 能力：
- 读取：`competitions`、`competition_teams`、`competition_team_members`、`sessions`
- 写入：`competition_teams`、`competition_team_members`、`sessions`、`audit_logs`
- 不入队：
- 权限与资源：调用者须为队伍当前队长；接任者须为队内 active 成员。
- 响应与错误：200 { ok: true }；接任者不是队内成员或已解散回 400/409。
- 数据与副作用：事务更新 competition_teams 的 leader_account_id 及队内成员身份标记。

源码：[app/server/src/routes/portal/competition-signups.ts:261](../../../app/server/src/routes/portal/competition-signups.ts#L261)

测试入口：[tests/server/competitions.test.ts](../../../tests/server/competitions.test.ts) · [tests/server/competition-signups.test.ts](../../../tests/server/competition-signups.test.ts)。生成器未执行这些测试。

### 队长解散队伍

标识：`flow:competition.teams.disband`；性质：显式声明并关联源码，不是自动证明业务正确。

- 操作：`DELETE /api/teams/:id`
- 能力：
- 读取：`competitions`、`competition_teams`、`competition_team_members`、`sessions`
- 写入：`competition_teams`、`competition_team_members`、`sessions`、`audit_logs`
- 不入队：
- 权限与资源：调用者须为队长；队伍未锁定（locked 队伍解散需先 unlock）。
- 响应与错误：200 { ok: true }；锁定队伍不可解散（409 team_locked）。
- 数据与副作用：事务更新 competition_teams 为 disbanded，全部成员记录更新为 disbanded。

源码：[app/server/src/routes/portal/competition-signups.ts:283](../../../app/server/src/routes/portal/competition-signups.ts#L283)

测试入口：[tests/server/competitions.test.ts](../../../tests/server/competitions.test.ts) · [tests/server/competition-signups.test.ts](../../../tests/server/competition-signups.test.ts)。生成器未执行这些测试。

### 队长确认锁定参赛队伍

标识：`flow:competition.teams.lock`；性质：显式声明并关联源码，不是自动证明业务正确。

- 操作：`POST /api/teams/:id/lock`
- 能力：
- 读取：`competitions`、`competition_signup_settings`、`competition_teams`、`competition_team_members`、`sessions`
- 写入：`competition_teams`、`competition_team_members`、`sessions`、`audit_logs`
- 不入队：
- 权限与资源：调用者须为队长；队伍处于 recruiting 且人数满足 [team_min, team_max]。
- 响应与错误：200 { ok: true, team }；人数不符合设置回 409 team_size_invalid。
- 数据与副作用：更新 competition_teams 状态为 locked，清空剩余待处理申请/邀请。

源码：[app/server/src/routes/portal/competition-signups.ts:304](../../../app/server/src/routes/portal/competition-signups.ts#L304)

测试入口：[tests/server/competitions.test.ts](../../../tests/server/competitions.test.ts) · [tests/server/competition-signups.test.ts](../../../tests/server/competition-signups.test.ts)。生成器未执行这些测试。

### 队长撤销锁定参赛队伍

标识：`flow:competition.teams.unlock`；性质：显式声明并关联源码，不是自动证明业务正确。

- 操作：`DELETE /api/teams/:id/lock`
- 能力：
- 读取：`competitions`、`competition_signup_settings`、`competition_teams`、`competition_team_members`、`sessions`
- 写入：`competition_teams`、`sessions`、`audit_logs`
- 不入队：
- 权限与资源：调用者须为队长；仅在报名尚未截止时允许解锁。
- 响应与错误：200 { ok: true, team }；报名已截止回 409 signup_closed。
- 数据与副作用：更新 competition_teams 状态回 recruiting，恢复队伍开放申请与邀请。

源码：[app/server/src/routes/portal/competition-signups.ts:325](../../../app/server/src/routes/portal/competition-signups.ts#L325)

测试入口：[tests/server/competitions.test.ts](../../../tests/server/competitions.test.ts) · [tests/server/competition-signups.test.ts](../../../tests/server/competition-signups.test.ts)。生成器未执行这些测试。

## 核验边界

- 这是源码与隔离运行时基线，不证明预发布或正式环境部署状态。
- 业务操作、基础设施和退役路由分别分类；自动 HEAD 单列。关闭静态托管提取，不枚举静态文件资源。
- 授权证据只覆盖直接可定位的检查，不推断所有条件、对象范围或间接调用。
- 请求 Schema 存在不等于请求语义完整；没有响应 Schema 的端点保持缺失，不生成虚假契约。
- 表结构来自空的内存数据库；没有读取业务记录，不代表旧库迁移已验证。
- 仅显式声明的业务流程有读写及副作用关系；没有声明的流程不伪造关系。
- 测试链接只是验证入口；生成器不把文件存在视为测试通过。
- app/forum 的 Nitro 接口和 Markdown 中间件单独按源码声明收录，不冒充本次实际启动过 Nitro；方法与挂载方式见对应源码及论坛合同。

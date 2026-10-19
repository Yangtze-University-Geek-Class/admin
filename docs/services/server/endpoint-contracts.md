# 业务接口契约与用例

> 按真实 handler、授权执行点与存储实现核对现有接口；关联目录中的业务用例，不向生产路由增加响应序列化 Schema。

状态：`current` · 更新：2026-10-18

## 口径与共同边界

本文是人工维护的行为契约，不是完整 OpenAPI。`application.cancel` 保留既有取消投递不变量，公共授权依赖与其他审核分支通过同一 PATCH 的 `application.review` 及本节追溯，不另造第二套取消规则。请求字段的机器约束仍以对应 routes 下的 contracts.ts 与 handler 为准；下文响应是源码分支的形状，未把测试入口标成每个分支均已验证。业务操作按显式非 HEAD 的方法路径计数；自动 HEAD 派生于 GET，论坛显式 HEAD /api/forum/state 另为 405，不能计为第二个业务用例。补充 Nitro 入口按声明单列。

- 核心写请求先由 middleware/http-policy.ts 校验 Origin / Fetch Metadata，外域拒绝 403 invalid_origin；缺 Origin 不自动拒绝所有非浏览器调用。输入 Schema 失败为 400 validation_error。全局错误体通常为 error、message、request_id，handler 自行 reply.send 的错误形状保留原样。
- 会话型接口读取 sessions；getSession 遇过期行会删除，不能把 GET 一律标为没有任何写入。经 http-policy 处理的上游令牌 401 会删当前会话、清 cookie，并仅在实际删除时写 auth.session_rejected 审计；其他上游 4xx 为同状态 upstream_rejected，5xx 为 internal_error。PR 合并代理与 OAuth 回跳的局部 catch 另见各用例。
- /api/admin/:org/* 以 URL 中 org、ALLOWED_ORGS 和调用者在该组织的实际 GitHub 角色为边界；不借控制台 capability 给上游授权。访问资源仍受调用者自己的 GitHub token 限制。
- 控制台能力由 sessions、role_assignments、departments、titles 及 GitHub 组织角色计算；角色缓存 60 秒，权限包每次读取。requireCapability 的多个参数是“任一满足”，并非全部同时拥有。缺能力 403 missing_capability；部门与对象范围仍在 handler 中继续校验。
- 流程 reads/writes 包含授权依赖与可能的条件写入，不能据数组推断每次请求都会写。forumViewer 对有效成员创建或刷新 forum_users，游客不写成员记录。外部 HTTP、文件读取、缓存和通知等副作用在各用例文字中明确，不能假装成 SQLite 外键。
- 测试路径只表示可复查入口。GitHub 代理多数尚无逐端点成功响应测试，已有 core/upstream-errors 只覆盖通用门禁和部分错误映射；Nitro 的纯函数/配置测试不等于启动服务器验证。

## 基础设施、退役路径与 HEAD 继承

当前隔离注册清单合计 **172 条方法路径**：92 个显式非 HEAD 业务操作（下文逐项说明）+ 24 个显式非 HEAD 退役项 + 4 个基础设施 GET + 51 个自动 HEAD + 1 个显式 HEAD。另有 5 个 Nitro/预渲染声明入口，独立列于文末，不混入 Fastify 注册数。

| 清单类别 | 方法路径 / 分组 | 实际行为及边界 | 源码与已有验证入口 |
|---|---|---|---|
| 基础设施（1） | `GET /healthz` | 200 `{ok:true,ts:Date.now()}`；handler 不查询数据库或外部依赖，因此不是全链路健康证明。 | [app.ts](../../../app/server/src/app.ts)，[catalog.test.ts](../../../tests/server/catalog.test.ts) |
| 基础设施（1） | `GET /` | 仅静态根目录不存在或明确 `staticRoot:false` 时注册占位响应：200 `{ok:true,note:"app/web/dist and app/console/dist not built yet"}`。目录工具关闭静态托管，故本次清单包含这一项。 | [app.ts](../../../app/server/src/app.ts)，[core.test.ts](../../../tests/server/core.test.ts) |
| 基础设施（2） | `GET /forum`、`GET /forum/*` | 直连核心服务时：production 为503 `{error:"forum_service_not_ready",message}`；开发为302到 `http://127.0.0.1:3456/`。正常 Docker 入口由 web 反代论坛，这两个 handler 不证明已配置反代。 | [app.ts](../../../app/server/src/app.ts)，[core.test.ts](../../../tests/server/core.test.ts) |
| 退役（24） | `/api/forum`、`/api/forum/*`、`/auth/forum/*`、`/forum/u/*` 各自的 `GET`、`POST`、`PUT`、`PATCH`、`DELETE`、`OPTIONS` | 共用 retired handler，410 `{error:"legacy_forum_retired",message}`，不映射或写入旧论坛。先匹配现有具体论坛接口，再由通配路径接住剩余请求；共同写请求Origin校验可能先回403。 | [app.ts](../../../app/server/src/app.ts)，[core.test.ts](../../../tests/server/core.test.ts) |
| 自动 HEAD（51） | 清单中 `registration: automatic-head` 的所有项 | 按相同 path 找对应 `GET`，继承其状态码、响应头、鉴权、限流和 handler 行为，最终不发送body。不会因为没有body就跳过会话处理、上游查询、投递查看/导出审计等副作用。4个基础设施和4个退役GET的HEAD也包含在51内。 | [目录注册观测](../../../scripts/catalog/collect.ts)，[project-catalog.test.ts](../../../tests/tooling/project-catalog.test.ts)；各GET的行为验证见各用例 |
| 显式 HEAD（1） | `HEAD /api/forum/state` | 405、`Allow: GET`、空体；单独handler不计算整份state，不花GET的120次额度，不调用forumViewer刷新用户。 | [topics.ts](../../../app/server/src/routes/forum-api/topics.ts)，[forum.test.ts](../../../tests/server/forum.test.ts) |

自动 HEAD 规则只适用于清单实际注册的51项，不能对所有GET自行补造。例如论坛 state、search、topic posts 显式关闭自动HEAD；state另有上述405处理器，其他未单独注册的HEAD仍受实际路由匹配和退役通配项约束。HEAD是读取方法，不经过核心写请求Origin门禁，但对应GET的会话、能力及资源范围校验仍有效。

有静态产物的模式另经 `@fastify/static` 和 app.ts 的 not-found handler：API/auth/healthz未知路径、含扩展名的缺失资源及非GET/HEAD请求为404；其他GET/HEAD按路径回控制台或官网SPA，并设no-cache。该模式的静态文件枚举不属于这172条关闭静态托管的隔离基线，也不由此文档声称已部署。

## 发起 GitHub 登录

`GET /auth/github` · `flow:identity.authorize`

权限与资源：匿名可发起；return_to仅接受PUBLIC_ORIGIN，否则回控制台。

响应与错误：302跳到GitHub授权地址。

数据与副作用：生成随机state并写签名oauth_state cookie，不创建会话；本次响应不向GitHub发送token交换请求。

本地表读取：无。本地表写入：无。

源码：[app/server/src/routes/admin/auth.ts:37](../../../app/server/src/routes/admin/auth.ts#L37)。验证入口：[tests/server/core.test.ts](../../../tests/server/core.test.ts)。

## 校验登录回调并建立统一会话

`GET /auth/callback` · `flow:identity.callback`

权限与资源：state与签名cookie必须相符且未过期；仅CONSOLE_ORG active成员成功。

响应与错误：成功302回return_to；取消/上游失败/非成员分别带signin结果回跳；缺参数或无效state为400，旧forum-state为410。

数据与副作用：调用GitHub换token、取用户、查本人组织成员状态；成功写sessions及auth.signin审计。非成员不建会话、审计拒绝并尽力撤销授权；失败日志不输出token。

本地表读取：无。本地表写入：sessions, audit_logs。

源码：[app/server/src/routes/admin/auth.ts:44](../../../app/server/src/routes/admin/auth.ts#L44)。验证入口：[tests/server/core.test.ts](../../../tests/server/core.test.ts)。

## 退出当前会话

`POST /auth/signout` · `flow:identity.signout`

权限与资源：仅销毁cookie sid对应本站会话；允许没有会话的幂等退出，仍受共同写请求Origin校验。

响应与错误：200 {ok:true}；不向调用者泄露sid是否存在。

数据与副作用：清sid和旧forum_sid cookie；实际读取到会话才写auth.signout，不撤销GitHub授权。

本地表读取：sessions。本地表写入：sessions, audit_logs。

源码：[app/server/src/routes/admin/auth.ts:81](../../../app/server/src/routes/admin/auth.ts#L81)。验证入口：[tests/server/core.test.ts](../../../tests/server/core.test.ts)、[tests/server/session-cleanup.test.ts](../../../tests/server/session-cleanup.test.ts)。

## 读取统一登录状态与控制台入口

`GET /auth/me` · `flow:identity.current`

权限与资源：只返回当前sid的身份；console_link是显示提示，不赋予后端权限。

响应与错误：200 {signed_in:false}或身份字段及console_link；GitHub拒绝token时200 {signed_in:false,session_expired:true}，其他角色查询失败仍保持登录但入口false。

数据与副作用：访问GitHub角色缓存和权限数据；过期/被拒token才删会话，拒绝token写审计；无其他业务写入。

本地表读取：sessions, role_assignments, departments, titles。本地表写入：sessions, audit_logs。

源码：[app/server/src/routes/admin/auth.ts:98](../../../app/server/src/routes/admin/auth.ts#L98)。验证入口：[tests/server/core.test.ts](../../../tests/server/core.test.ts)、[tests/server/console.test.ts](../../../tests/server/console.test.ts)。

## 列出本人组织

`GET /api/me/orgs` · `flow:github.organizations.list`

权限与资源：仅有效会话，读取本人active组织并按ALLOWED_ORGS过滤。

响应与错误：200 {orgs,allowed_orgs}；仅active成员组织并按配置过滤。

数据与副作用：GET /user/memberships/orgs，按登录名缓存120秒。

会话读取遇到过期会话才删除 sessions；没有有效会话返回401，不把界面显隐作为授权。

本地表读取：sessions。本地表写入：sessions, audit_logs。

源码：[app/server/src/routes/admin/orgs.ts:10](../../../app/server/src/routes/admin/orgs.ts#L10)。验证入口：[tests/server/core.test.ts](../../../tests/server/core.test.ts)、[tests/server/upstream-errors.test.ts](../../../tests/server/upstream-errors.test.ts)。

## 浏览组织活动

`GET /api/admin/:org/activity` · `flow:github.activity.read`

权限与资源：有效会话，requireOrgRole("member")；仅URL组织，允许列表与实际成员角色双重约束，上游按本人token判断资源权限。

响应与错误：200 {events}，输出actor、repo、时间及摘要。

数据与副作用：请求GitHub组织最近100条事件，不写本地活动表。

会话读取遇到过期会话才删除 sessions；没有有效会话返回401，不把界面显隐作为授权。

GitHub 调用经全局错误处理发现令牌失效时才结束当前会话并审计；普通成功读取不写操作审计。

验证边界：core/upstream-errors 是通用鉴权或部分上游错误回归；本接口专属的成功负载与GitHub真实副作用尚未由这些测试完整证明。

本地表读取：sessions。本地表写入：sessions, audit_logs。

源码：[app/server/src/routes/admin/activity.ts:9](../../../app/server/src/routes/admin/activity.ts#L9)。验证入口：[tests/server/core.test.ts](../../../tests/server/core.test.ts)、[tests/server/upstream-errors.test.ts](../../../tests/server/upstream-errors.test.ts)。

## 读取组织资料

`GET /api/admin/:org/org` · `flow:github.organization.read`

权限与资源：有效会话，requireOrgRole("member")；仅URL组织，允许列表与实际成员角色双重约束，上游按本人token判断资源权限。

响应与错误：200 GitHub组织响应对象。

数据与副作用：向GitHub读取URL组织资料。

会话读取遇到过期会话才删除 sessions；没有有效会话返回401，不把界面显隐作为授权。

GitHub 调用经全局错误处理发现令牌失效时才结束当前会话并审计；普通成功读取不写操作审计。

验证边界：core/upstream-errors 是通用鉴权或部分上游错误回归；本接口专属的成功负载与GitHub真实副作用尚未由这些测试完整证明。

本地表读取：sessions。本地表写入：sessions, audit_logs。

源码：[app/server/src/routes/admin/org.ts:21](../../../app/server/src/routes/admin/org.ts#L21)。验证入口：[tests/server/core.test.ts](../../../tests/server/core.test.ts)、[tests/server/upstream-errors.test.ts](../../../tests/server/upstream-errors.test.ts)。

## 查看组织概览

`GET /api/admin/:org/overview` · `flow:github.overview.read`

权限与资源：有效会话，requireOrgRole("member")；仅URL组织，允许列表与实际成员角色双重约束，上游按本人token判断资源权限。

响应与错误：200 {role,org,counts}；成员/邀请/仓库子查询失败各降为空数组，组织主查询失败仍抛错。

数据与副作用：聚合GitHub组织、成员、邀请、仓库与本地24小时邀请数和活跃链接数，不发出邀请。

会话读取遇到过期会话才删除 sessions；没有有效会话返回401，不把界面显隐作为授权。

GitHub 调用经全局错误处理发现令牌失效时才结束当前会话并审计；普通成功读取不写操作审计。

验证边界：core/upstream-errors 是通用鉴权或部分上游错误回归；本接口专属的成功负载与GitHub真实副作用尚未由这些测试完整证明。

本地表读取：invitations, invite_links, sessions。本地表写入：sessions, audit_logs。

源码：[app/server/src/routes/admin/overview.ts:10](../../../app/server/src/routes/admin/overview.ts#L10)。验证入口：[tests/server/core.test.ts](../../../tests/server/core.test.ts)、[tests/server/upstream-errors.test.ts](../../../tests/server/upstream-errors.test.ts)。

## 查看组织安全能力

`GET /api/admin/:org/security` · `flow:github.security.read`

权限与资源：有效会话，requireOrgRole("member")；仅URL组织，允许列表与实际成员角色双重约束，上游按本人token判断资源权限。

响应与错误：200 {plan,two_factor_required,dependabot,secret_scanning,audit_log}；Dependabot失败落入嵌套error字段。

数据与副作用：读取GitHub组织计划，非free再查Dependabot；此接口是摘要，不配置安全策略或购买服务。

会话读取遇到过期会话才删除 sessions；没有有效会话返回401，不把界面显隐作为授权。

GitHub 调用经全局错误处理发现令牌失效时才结束当前会话并审计；普通成功读取不写操作审计。

验证边界：core/upstream-errors 是通用鉴权或部分上游错误回归；本接口专属的成功负载与GitHub真实副作用尚未由这些测试完整证明。

本地表读取：sessions。本地表写入：sessions, audit_logs。

源码：[app/server/src/routes/admin/security.ts:9](../../../app/server/src/routes/admin/security.ts#L9)。验证入口：[tests/server/core.test.ts](../../../tests/server/core.test.ts)、[tests/server/upstream-errors.test.ts](../../../tests/server/upstream-errors.test.ts)。

## 查看组织成员角色

`GET /api/admin/:org/members` · `flow:github.members.list`

权限与资源：有效会话，requireOrgRole("member")；仅URL组织，允许列表与实际成员角色双重约束，上游按本人token判断资源权限。

响应与错误：200 {members,viewer_role}；单个成员详情失败将role/state设为?，名单请求失败仍抛错。

数据与副作用：分页读取GitHub成员并补角色，不改变组织成员关系。

会话读取遇到过期会话才删除 sessions；没有有效会话返回401，不把界面显隐作为授权。

GitHub 调用经全局错误处理发现令牌失效时才结束当前会话并审计；普通成功读取不写操作审计。

验证边界：core/upstream-errors 是通用鉴权或部分上游错误回归；本接口专属的成功负载与GitHub真实副作用尚未由这些测试完整证明。

本地表读取：sessions。本地表写入：sessions, audit_logs。

源码：[app/server/src/routes/admin/members.ts:10](../../../app/server/src/routes/admin/members.ts#L10)。验证入口：[tests/server/core.test.ts](../../../tests/server/core.test.ts)、[tests/server/upstream-errors.test.ts](../../../tests/server/upstream-errors.test.ts)。

## 查看团队及规模

`GET /api/admin/:org/teams` · `flow:github.teams.list`

权限与资源：有效会话，requireOrgRole("member")；仅URL组织，允许列表与实际成员角色双重约束，上游按本人token判断资源权限。

响应与错误：200 {teams}，每项增加member_count/repo_count；计数子请求失败记0。

数据与副作用：分页读取团队及成员/仓库计数，不缓存成数据库实体。

会话读取遇到过期会话才删除 sessions；没有有效会话返回401，不把界面显隐作为授权。

GitHub 调用经全局错误处理发现令牌失效时才结束当前会话并审计；普通成功读取不写操作审计。

验证边界：core/upstream-errors 是通用鉴权或部分上游错误回归；本接口专属的成功负载与GitHub真实副作用尚未由这些测试完整证明。

本地表读取：sessions。本地表写入：sessions, audit_logs。

源码：[app/server/src/routes/admin/teams.ts:10](../../../app/server/src/routes/admin/teams.ts#L10)。验证入口：[tests/server/core.test.ts](../../../tests/server/core.test.ts)、[tests/server/upstream-errors.test.ts](../../../tests/server/upstream-errors.test.ts)。

## 移除组织成员

`DELETE /api/admin/:org/members/:login` · `flow:github.members.remove`

权限与资源：有效会话，requireOrgRole("admin")；仅URL组织，组织owner和允许列表校验通过后，仍由本人token操作上游资源。

响应与错误：200 {ok:true}；login等于本人时400，其他失败保留上游状态映射。

数据与副作用：向GitHub删除组织membership，成功写member.remove审计。

会话读取遇到过期会话才删除 sessions；没有有效会话返回401，不把界面显隐作为授权。

GitHub 调用经全局错误处理发现令牌失效时才结束当前会话并审计；普通成功读取不写操作审计。

验证边界：core/upstream-errors 是通用鉴权或部分上游错误回归；本接口专属的成功负载与GitHub真实副作用尚未由这些测试完整证明。

本地表读取：sessions。本地表写入：audit_logs, sessions。

源码：[app/server/src/routes/admin/members.ts:29](../../../app/server/src/routes/admin/members.ts#L29)。验证入口：[tests/server/core.test.ts](../../../tests/server/core.test.ts)、[tests/server/upstream-errors.test.ts](../../../tests/server/upstream-errors.test.ts)。

## 调整组织成员角色

`PATCH /api/admin/:org/members/:login/role` · `flow:github.members.role`

权限与资源：有效会话，requireOrgRole("admin")；仅URL组织，组织owner和允许列表校验通过后，仍由本人token操作上游资源。

响应与错误：200 {ok:true}；role不是admin/member为400。

数据与副作用：PUT GitHub membership角色，成功写member.role审计。

会话读取遇到过期会话才删除 sessions；没有有效会话返回401，不把界面显隐作为授权。

GitHub 调用经全局错误处理发现令牌失效时才结束当前会话并审计；普通成功读取不写操作审计。

验证边界：core/upstream-errors 是通用鉴权或部分上游错误回归；本接口专属的成功负载与GitHub真实副作用尚未由这些测试完整证明。

本地表读取：sessions。本地表写入：audit_logs, sessions。

源码：[app/server/src/routes/admin/members.ts:40](../../../app/server/src/routes/admin/members.ts#L40)。验证入口：[tests/server/core.test.ts](../../../tests/server/core.test.ts)、[tests/server/upstream-errors.test.ts](../../../tests/server/upstream-errors.test.ts)。

## 修改组织资料与策略

`PATCH /api/admin/:org/org` · `flow:github.organization.update`

权限与资源：有效会话，requireOrgRole("admin")；仅URL组织，组织owner和允许列表校验通过后，仍由本人token操作上游资源。

响应与错误：200 GitHub组织响应；没有允许编辑字段为400。

数据与副作用：仅转发EDITABLE_KEYS字段，成功写org.update审计；并不修改本地部署配置。

会话读取遇到过期会话才删除 sessions；没有有效会话返回401，不把界面显隐作为授权。

GitHub 调用经全局错误处理发现令牌失效时才结束当前会话并审计；普通成功读取不写操作审计。

验证边界：core/upstream-errors 是通用鉴权或部分上游错误回归；本接口专属的成功负载与GitHub真实副作用尚未由这些测试完整证明。

本地表读取：sessions。本地表写入：audit_logs, sessions。

源码：[app/server/src/routes/admin/org.ts:30](../../../app/server/src/routes/admin/org.ts#L30)。验证入口：[tests/server/core.test.ts](../../../tests/server/core.test.ts)、[tests/server/upstream-errors.test.ts](../../../tests/server/upstream-errors.test.ts)。

## 创建组织团队

`POST /api/admin/:org/teams` · `flow:github.teams.create`

权限与资源：有效会话，requireOrgRole("admin")；仅URL组织，组织owner和允许列表校验通过后，仍由本人token操作上游资源。

响应与错误：200 {ok:true,team}；缺name为400。

数据与副作用：调用GitHub创建团队，记录team.create审计。

会话读取遇到过期会话才删除 sessions；没有有效会话返回401，不把界面显隐作为授权。

GitHub 调用经全局错误处理发现令牌失效时才结束当前会话并审计；普通成功读取不写操作审计。

验证边界：core/upstream-errors 是通用鉴权或部分上游错误回归；本接口专属的成功负载与GitHub真实副作用尚未由这些测试完整证明。

本地表读取：sessions。本地表写入：audit_logs, sessions。

源码：[app/server/src/routes/admin/teams.ts:28](../../../app/server/src/routes/admin/teams.ts#L28)。验证入口：[tests/server/core.test.ts](../../../tests/server/core.test.ts)、[tests/server/upstream-errors.test.ts](../../../tests/server/upstream-errors.test.ts)。

## 删除组织团队

`DELETE /api/admin/:org/teams/:slug` · `flow:github.teams.delete`

权限与资源：有效会话，requireOrgRole("admin")；仅URL组织，组织owner和允许列表校验通过后，仍由本人token操作上游资源。

响应与错误：200 {ok:true}。

数据与副作用：删除URL组织中指定slug的GitHub团队，记录team.delete审计。

会话读取遇到过期会话才删除 sessions；没有有效会话返回401，不把界面显隐作为授权。

GitHub 调用经全局错误处理发现令牌失效时才结束当前会话并审计；普通成功读取不写操作审计。

验证边界：core/upstream-errors 是通用鉴权或部分上游错误回归；本接口专属的成功负载与GitHub真实副作用尚未由这些测试完整证明。

本地表读取：sessions。本地表写入：audit_logs, sessions。

源码：[app/server/src/routes/admin/teams.ts:42](../../../app/server/src/routes/admin/teams.ts#L42)。验证入口：[tests/server/core.test.ts](../../../tests/server/core.test.ts)、[tests/server/upstream-errors.test.ts](../../../tests/server/upstream-errors.test.ts)。

## 查看组织仓库列表

`GET /api/admin/:org/repos` · `flow:github.repositories.list`

权限与资源：有效会话，requireOrgRole("member")；仅URL组织，允许列表与实际成员角色双重约束，上游按本人token判断资源权限。

响应与错误：200 {repos}，仅下发列表所需字段。

数据与副作用：本人token分页读取GitHub组织仓库，按login/org缓存60秒。

会话读取遇到过期会话才删除 sessions；没有有效会话返回401，不把界面显隐作为授权。

GitHub 调用经全局错误处理发现令牌失效时才结束当前会话并审计；普通成功读取不写操作审计。

验证边界：core/upstream-errors 是通用鉴权或部分上游错误回归；本接口专属的成功负载与GitHub真实副作用尚未由这些测试完整证明。

本地表读取：sessions。本地表写入：sessions, audit_logs。

源码：[app/server/src/routes/admin/repos.ts:11](../../../app/server/src/routes/admin/repos.ts#L11)。验证入口：[tests/server/core.test.ts](../../../tests/server/core.test.ts)、[tests/server/upstream-errors.test.ts](../../../tests/server/upstream-errors.test.ts)。

## 查看仓库信息与成员

`GET /api/admin/:org/repos/:repo` · `flow:github.repositories.detail`

权限与资源：有效会话，requireOrgRole("member")；仅URL组织，允许列表与实际成员角色双重约束，上游按本人token判断资源权限。

响应与错误：200 {info,branches,collaborators,hooks}；后三个子查询失败降为空数组。

数据与副作用：本人token读取仓库、分支、协作者和hooks，按login/org/repo缓存60秒。

会话读取遇到过期会话才删除 sessions；没有有效会话返回401，不把界面显隐作为授权。

GitHub 调用经全局错误处理发现令牌失效时才结束当前会话并审计；普通成功读取不写操作审计。

验证边界：core/upstream-errors 是通用鉴权或部分上游错误回归；本接口专属的成功负载与GitHub真实副作用尚未由这些测试完整证明。

本地表读取：sessions。本地表写入：sessions, audit_logs。

源码：[app/server/src/routes/admin/repos.ts:41](../../../app/server/src/routes/admin/repos.ts#L41)。验证入口：[tests/server/core.test.ts](../../../tests/server/core.test.ts)、[tests/server/upstream-errors.test.ts](../../../tests/server/upstream-errors.test.ts)。

## 浏览仓库目录

`GET /api/admin/:org/repos/:repo/tree` · `flow:github.repositories.tree`

权限与资源：有效会话，requireOrgRole("member")；仅URL组织，允许列表与实际成员角色双重约束，上游按本人token判断资源权限。

响应与错误：200 {path,entries}；目录优先排序。

数据与副作用：按path/ref读取GitHub contents，不接触服务端本地文件。

会话读取遇到过期会话才删除 sessions；没有有效会话返回401，不把界面显隐作为授权。

GitHub 调用经全局错误处理发现令牌失效时才结束当前会话并审计；普通成功读取不写操作审计。

验证边界：core/upstream-errors 是通用鉴权或部分上游错误回归；本接口专属的成功负载与GitHub真实副作用尚未由这些测试完整证明。

本地表读取：sessions。本地表写入：sessions, audit_logs。

源码：[app/server/src/routes/admin/repos.ts:63](../../../app/server/src/routes/admin/repos.ts#L63)。验证入口：[tests/server/core.test.ts](../../../tests/server/core.test.ts)、[tests/server/upstream-errors.test.ts](../../../tests/server/upstream-errors.test.ts)。

## 阅读仓库文件

`GET /api/admin/:org/repos/:repo/file` · `flow:github.repositories.file`

权限与资源：有效会话，requireOrgRole("member")；仅URL组织，允许列表与实际成员角色双重约束，上游按本人token判断资源权限。

响应与错误：200 文件元数据和解码content；超过1MB返回too_large且不附正文；缺path或目录为400。

数据与副作用：按path/ref从GitHub读文件，base64仅转utf8，不执行内容。

会话读取遇到过期会话才删除 sessions；没有有效会话返回401，不把界面显隐作为授权。

GitHub 调用经全局错误处理发现令牌失效时才结束当前会话并审计；普通成功读取不写操作审计。

验证边界：core/upstream-errors 是通用鉴权或部分上游错误回归；本接口专属的成功负载与GitHub真实副作用尚未由这些测试完整证明。

本地表读取：sessions。本地表写入：sessions, audit_logs。

源码：[app/server/src/routes/admin/repos.ts:81](../../../app/server/src/routes/admin/repos.ts#L81)。验证入口：[tests/server/core.test.ts](../../../tests/server/core.test.ts)、[tests/server/upstream-errors.test.ts](../../../tests/server/upstream-errors.test.ts)。

## 浏览提交列表

`GET /api/admin/:org/repos/:repo/commits` · `flow:github.repositories.commits`

权限与资源：有效会话，requireOrgRole("member")；仅URL组织，允许列表与实际成员角色双重约束，上游按本人token判断资源权限。

响应与错误：200 {commits}，包含摘要、完整message及作者；per_page最多100。

数据与副作用：按sha/path/page读取GitHub提交并缓存30秒。

会话读取遇到过期会话才删除 sessions；没有有效会话返回401，不把界面显隐作为授权。

GitHub 调用经全局错误处理发现令牌失效时才结束当前会话并审计；普通成功读取不写操作审计。

验证边界：core/upstream-errors 是通用鉴权或部分上游错误回归；本接口专属的成功负载与GitHub真实副作用尚未由这些测试完整证明。

本地表读取：sessions。本地表写入：sessions, audit_logs。

源码：[app/server/src/routes/admin/repos.ts:98](../../../app/server/src/routes/admin/repos.ts#L98)。验证入口：[tests/server/core.test.ts](../../../tests/server/core.test.ts)、[tests/server/upstream-errors.test.ts](../../../tests/server/upstream-errors.test.ts)。

## 查看提交差异

`GET /api/admin/:org/repos/:repo/commits/:sha` · `flow:github.repositories.commit`

权限与资源：有效会话，requireOrgRole("member")；仅URL组织，允许列表与实际成员角色双重约束，上游按本人token判断资源权限。

响应与错误：200 {sha,message,author,actor,stats,files,html_url}；单文件patch截到30000字符。

数据与副作用：从GitHub取指定提交，不本地checkout。

会话读取遇到过期会话才删除 sessions；没有有效会话返回401，不把界面显隐作为授权。

GitHub 调用经全局错误处理发现令牌失效时才结束当前会话并审计；普通成功读取不写操作审计。

验证边界：core/upstream-errors 是通用鉴权或部分上游错误回归；本接口专属的成功负载与GitHub真实副作用尚未由这些测试完整证明。

本地表读取：sessions。本地表写入：sessions, audit_logs。

源码：[app/server/src/routes/admin/repos.ts:130](../../../app/server/src/routes/admin/repos.ts#L130)。验证入口：[tests/server/core.test.ts](../../../tests/server/core.test.ts)、[tests/server/upstream-errors.test.ts](../../../tests/server/upstream-errors.test.ts)。

## 浏览仓库议题

`GET /api/admin/:org/repos/:repo/issues` · `flow:github.repositories.issues`

权限与资源：有效会话，requireOrgRole("member")；仅URL组织，允许列表与实际成员角色双重约束，上游按本人token判断资源权限。

响应与错误：200 {issues}，过滤pull_request项。

数据与副作用：按state分页读GitHub issues，缓存30秒；不创建issue。

会话读取遇到过期会话才删除 sessions；没有有效会话返回401，不把界面显隐作为授权。

GitHub 调用经全局错误处理发现令牌失效时才结束当前会话并审计；普通成功读取不写操作审计。

验证边界：core/upstream-errors 是通用鉴权或部分上游错误回归；本接口专属的成功负载与GitHub真实副作用尚未由这些测试完整证明。

本地表读取：sessions。本地表写入：sessions, audit_logs。

源码：[app/server/src/routes/admin/repos.ts:154](../../../app/server/src/routes/admin/repos.ts#L154)。验证入口：[tests/server/core.test.ts](../../../tests/server/core.test.ts)、[tests/server/upstream-errors.test.ts](../../../tests/server/upstream-errors.test.ts)。

## 阅读议题及评论

`GET /api/admin/:org/repos/:repo/issues/:n` · `flow:github.repositories.issue`

权限与资源：有效会话，requireOrgRole("member")；仅URL组织，允许列表与实际成员角色双重约束，上游按本人token判断资源权限。

响应与错误：200 议题详情与comments；数字n传给GitHub。

数据与副作用：读取GitHub议题和评论，不把评论写入本地库。

会话读取遇到过期会话才删除 sessions；没有有效会话返回401，不把界面显隐作为授权。

GitHub 调用经全局错误处理发现令牌失效时才结束当前会话并审计；普通成功读取不写操作审计。

验证边界：core/upstream-errors 是通用鉴权或部分上游错误回归；本接口专属的成功负载与GitHub真实副作用尚未由这些测试完整证明。

本地表读取：sessions。本地表写入：sessions, audit_logs。

源码：[app/server/src/routes/admin/repos.ts:202](../../../app/server/src/routes/admin/repos.ts#L202)。验证入口：[tests/server/core.test.ts](../../../tests/server/core.test.ts)、[tests/server/upstream-errors.test.ts](../../../tests/server/upstream-errors.test.ts)。

## 浏览合并请求

`GET /api/admin/:org/repos/:repo/pulls` · `flow:github.repositories.pulls`

权限与资源：有效会话，requireOrgRole("member")；仅URL组织，允许列表与实际成员角色双重约束，上游按本人token判断资源权限。

响应与错误：200 {pulls}，含head/base/draft/mergeable等上游字段。

数据与副作用：按state读取GitHub PR并缓存30秒。

会话读取遇到过期会话才删除 sessions；没有有效会话返回401，不把界面显隐作为授权。

GitHub 调用经全局错误处理发现令牌失效时才结束当前会话并审计；普通成功读取不写操作审计。

验证边界：core/upstream-errors 是通用鉴权或部分上游错误回归；本接口专属的成功负载与GitHub真实副作用尚未由这些测试完整证明。

本地表读取：sessions。本地表写入：sessions, audit_logs。

源码：[app/server/src/routes/admin/repos.ts:177](../../../app/server/src/routes/admin/repos.ts#L177)。验证入口：[tests/server/core.test.ts](../../../tests/server/core.test.ts)、[tests/server/upstream-errors.test.ts](../../../tests/server/upstream-errors.test.ts)。

## 阅读合并请求差异

`GET /api/admin/:org/repos/:repo/pulls/:n` · `flow:github.repositories.pull`

权限与资源：有效会话，requireOrgRole("member")；仅URL组织，允许列表与实际成员角色双重约束，上游按本人token判断资源权限。

响应与错误：200 PR详情、comments、files；files请求失败为空，单patch截到20000字符。

数据与副作用：读取GitHub PR/评论/文件，不执行分支内容、不合并。

会话读取遇到过期会话才删除 sessions；没有有效会话返回401，不把界面显隐作为授权。

GitHub 调用经全局错误处理发现令牌失效时才结束当前会话并审计；普通成功读取不写操作审计。

验证边界：core/upstream-errors 是通用鉴权或部分上游错误回归；本接口专属的成功负载与GitHub真实副作用尚未由这些测试完整证明。

本地表读取：sessions。本地表写入：sessions, audit_logs。

源码：[app/server/src/routes/admin/repos.ts:228](../../../app/server/src/routes/admin/repos.ts#L228)。验证入口：[tests/server/core.test.ts](../../../tests/server/core.test.ts)、[tests/server/upstream-errors.test.ts](../../../tests/server/upstream-errors.test.ts)。

## 合并仓库请求

`PUT /api/admin/:org/repos/:repo/pulls/:n/merge` · `flow:github.repositories.merge`

权限与资源：有效会话，requireOrgRole("member")；仅URL组织，允许列表与实际成员角色双重约束，上游按本人token判断资源权限。

响应与错误：200 {ok:true,merged,sha,message}，merged取上游；局部catch返回上游status或500及merge_failed/message，不走同一脱敏路径。

数据与副作用：按merge_method、可选sha调用GitHub merge，成功写pr.merge审计并清repo/repos缓存；授权和分支保护仍由GitHub决定。

会话读取遇到过期会话才删除 sessions；没有有效会话返回401，不把界面显隐作为授权。

GitHub 调用经全局错误处理发现令牌失效时才结束当前会话并审计；普通成功读取不写操作审计。

验证边界：core/upstream-errors 是通用鉴权或部分上游错误回归；本接口专属的成功负载与GitHub真实副作用尚未由这些测试完整证明。

本地表读取：sessions。本地表写入：audit_logs, sessions。

源码：[app/server/src/routes/admin/repos.ts:259](../../../app/server/src/routes/admin/repos.ts#L259)。验证入口：[tests/server/core.test.ts](../../../tests/server/core.test.ts)、[tests/server/upstream-errors.test.ts](../../../tests/server/upstream-errors.test.ts)。

## 变更议题状态

`PATCH /api/admin/:org/repos/:repo/issues/:n` · `flow:github.repositories.issue_state`

权限与资源：有效会话，requireOrgRole("member")；仅URL组织，允许列表与实际成员角色双重约束，上游按本人token判断资源权限。

响应与错误：200 {ok:true,state}。

数据与副作用：向GitHub PATCH open/closed状态，写issue.<state>审计并清repo缓存。

会话读取遇到过期会话才删除 sessions；没有有效会话返回401，不把界面显隐作为授权。

GitHub 调用经全局错误处理发现令牌失效时才结束当前会话并审计；普通成功读取不写操作审计。

验证边界：core/upstream-errors 是通用鉴权或部分上游错误回归；本接口专属的成功负载与GitHub真实副作用尚未由这些测试完整证明。

本地表读取：sessions。本地表写入：audit_logs, sessions。

源码：[app/server/src/routes/admin/repos.ts:285](../../../app/server/src/routes/admin/repos.ts#L285)。验证入口：[tests/server/core.test.ts](../../../tests/server/core.test.ts)、[tests/server/upstream-errors.test.ts](../../../tests/server/upstream-errors.test.ts)。

## 回复仓库议题

`POST /api/admin/:org/repos/:repo/issues/:n/comments` · `flow:github.repositories.comment`

权限与资源：有效会话，requireOrgRole("member")；仅URL组织，允许列表与实际成员角色双重约束，上游按本人token判断资源权限。

响应与错误：200 {ok:true,id,html_url}；空白body为400 empty_body。

数据与副作用：POST GitHub评论，写issue.comment审计；评论正文不写审计。

会话读取遇到过期会话才删除 sessions；没有有效会话返回401，不把界面显隐作为授权。

GitHub 调用经全局错误处理发现令牌失效时才结束当前会话并审计；普通成功读取不写操作审计。

验证边界：core/upstream-errors 是通用鉴权或部分上游错误回归；本接口专属的成功负载与GitHub真实副作用尚未由这些测试完整证明。

本地表读取：sessions。本地表写入：audit_logs, sessions。

源码：[app/server/src/routes/admin/repos.ts:301](../../../app/server/src/routes/admin/repos.ts#L301)。验证入口：[tests/server/core.test.ts](../../../tests/server/core.test.ts)、[tests/server/upstream-errors.test.ts](../../../tests/server/upstream-errors.test.ts)。

## 创建组织仓库

`POST /api/admin/:org/create-repo` · `flow:github.repositories.create`

权限与资源：有效会话，requireOrgRole("admin")；仅URL组织，组织owner和允许列表校验通过后，仍由本人token操作上游资源。

响应与错误：200 {ok:true,repo:{name,full_name,html_url}}；非法name为400。

数据与副作用：向GitHub创建仓库（auto_init默认true），写repo.create审计并清repos缓存。

会话读取遇到过期会话才删除 sessions；没有有效会话返回401，不把界面显隐作为授权。

GitHub 调用经全局错误处理发现令牌失效时才结束当前会话并审计；普通成功读取不写操作审计。

验证边界：core/upstream-errors 是通用鉴权或部分上游错误回归；本接口专属的成功负载与GitHub真实副作用尚未由这些测试完整证明。

本地表读取：sessions。本地表写入：audit_logs, sessions。

源码：[app/server/src/routes/admin/repos.ts:317](../../../app/server/src/routes/admin/repos.ts#L317)。验证入口：[tests/server/core.test.ts](../../../tests/server/core.test.ts)、[tests/server/upstream-errors.test.ts](../../../tests/server/upstream-errors.test.ts)。

## 删除组织仓库

`DELETE /api/admin/:org/repos/:repo` · `flow:github.repositories.delete`

权限与资源：有效会话，requireOrgRole("admin")；仅URL组织，组织owner和允许列表校验通过后，仍由本人token操作上游资源。

响应与错误：200 {ok:true}。

数据与副作用：DELETE GitHub仓库，成功审计repo.delete，清repo/repos缓存。

会话读取遇到过期会话才删除 sessions；没有有效会话返回401，不把界面显隐作为授权。

GitHub 调用经全局错误处理发现令牌失效时才结束当前会话并审计；普通成功读取不写操作审计。

验证边界：core/upstream-errors 是通用鉴权或部分上游错误回归；本接口专属的成功负载与GitHub真实副作用尚未由这些测试完整证明。

本地表读取：sessions。本地表写入：audit_logs, sessions。

源码：[app/server/src/routes/admin/repos.ts:338](../../../app/server/src/routes/admin/repos.ts#L338)。验证入口：[tests/server/core.test.ts](../../../tests/server/core.test.ts)、[tests/server/upstream-errors.test.ts](../../../tests/server/upstream-errors.test.ts)。

## 授权仓库协作者

`PUT /api/admin/:org/repos/:repo/collaborators/:login` · `flow:github.repositories.collaborator_put`

权限与资源：有效会话，requireOrgRole("admin")；仅URL组织，组织owner和允许列表校验通过后，仍由本人token操作上游资源。

响应与错误：200 {ok:true}；permission默认push。

数据与副作用：PUT GitHub协作者权限，可能触发GitHub邀请；写repo.collab.add审计并清repo缓存。

会话读取遇到过期会话才删除 sessions；没有有效会话返回401，不把界面显隐作为授权。

GitHub 调用经全局错误处理发现令牌失效时才结束当前会话并审计；普通成功读取不写操作审计。

验证边界：core/upstream-errors 是通用鉴权或部分上游错误回归；本接口专属的成功负载与GitHub真实副作用尚未由这些测试完整证明。

本地表读取：sessions。本地表写入：audit_logs, sessions。

源码：[app/server/src/routes/admin/repos.ts:352](../../../app/server/src/routes/admin/repos.ts#L352)。验证入口：[tests/server/core.test.ts](../../../tests/server/core.test.ts)、[tests/server/upstream-errors.test.ts](../../../tests/server/upstream-errors.test.ts)。

## 移除仓库协作者

`DELETE /api/admin/:org/repos/:repo/collaborators/:login` · `flow:github.repositories.collaborator_delete`

权限与资源：有效会话，requireOrgRole("admin")；仅URL组织，组织owner和允许列表校验通过后，仍由本人token操作上游资源。

响应与错误：200 {ok:true}。

数据与副作用：DELETE GitHub协作者，审计repo.collab.remove并清repo缓存。

会话读取遇到过期会话才删除 sessions；没有有效会话返回401，不把界面显隐作为授权。

GitHub 调用经全局错误处理发现令牌失效时才结束当前会话并审计；普通成功读取不写操作审计。

验证边界：core/upstream-errors 是通用鉴权或部分上游错误回归；本接口专属的成功负载与GitHub真实副作用尚未由这些测试完整证明。

本地表读取：sessions。本地表写入：audit_logs, sessions。

源码：[app/server/src/routes/admin/repos.ts:366](../../../app/server/src/routes/admin/repos.ts#L366)。验证入口：[tests/server/core.test.ts](../../../tests/server/core.test.ts)、[tests/server/upstream-errors.test.ts](../../../tests/server/upstream-errors.test.ts)。

## 核对组织邀请与本地历史

`GET /api/admin/:org/invitations` · `flow:invitation.admin.list`

权限与资源：有效会话，requireOrgRole("admin")；仅URL组织，组织owner和允许列表校验通过后，仍由本人token操作上游资源。

响应与错误：200 {pending,history}；本地最近200条历史含邮箱、备注、source_ip和链接token，只对组织owner开放。

数据与副作用：分页读取GitHub待接受邀请及本组织本地历史，不发信或补发。

会话读取遇到过期会话才删除 sessions；没有有效会话返回401，不把界面显隐作为授权。

GitHub 调用经全局错误处理发现令牌失效时才结束当前会话并审计；普通成功读取不写操作审计。

本地表读取：invitations, sessions。本地表写入：sessions, audit_logs。

源码：[app/server/src/routes/admin/invitations.ts:10](../../../app/server/src/routes/admin/invitations.ts#L10)。验证入口：[tests/server/invitations.test.ts](../../../tests/server/invitations.test.ts)、[tests/server/core.test.ts](../../../tests/server/core.test.ts)、[tests/server/console.test.ts](../../../tests/server/console.test.ts)。

## 取消尚未接受的组织邀请

`DELETE /api/admin/:org/invitations/:id` · `flow:invitation.admin.cancel`

权限与资源：有效会话，requireOrgRole("admin")；仅URL组织，组织owner和允许列表校验通过后，仍由本人token操作上游资源。

响应与错误：200 {ok:true}；非有限数id为400。

数据与副作用：调用GitHub取消邀请，写invitation.cancel审计；不回写历史invitations状态或返还链接额度。

会话读取遇到过期会话才删除 sessions；没有有效会话返回401，不把界面显隐作为授权。

GitHub 调用经全局错误处理发现令牌失效时才结束当前会话并审计；普通成功读取不写操作审计。

本地表读取：sessions。本地表写入：audit_logs, sessions。

源码：[app/server/src/routes/admin/invitations.ts:22](../../../app/server/src/routes/admin/invitations.ts#L22)。验证入口：[tests/server/invitations.test.ts](../../../tests/server/invitations.test.ts)、[tests/server/core.test.ts](../../../tests/server/core.test.ts)、[tests/server/console.test.ts](../../../tests/server/console.test.ts)。

## 查看组织邀请链接

`GET /api/admin/:org/invite-links` · `flow:invitation.links.list`

权限与资源：有效会话，requireOrgRole("admin")；仅URL组织，组织owner和允许列表校验通过后，仍由本人token操作上游资源。

响应与错误：200 {links}；包含完整token及配额，不包含发起人加密token。

数据与副作用：仅按URL org读取链接，持有token即可走公开邀请流程，应保留owner门槛。

会话读取遇到过期会话才删除 sessions；没有有效会话返回401，不把界面显隐作为授权。

GitHub 调用经全局错误处理发现令牌失效时才结束当前会话并审计；普通成功读取不写操作审计。

本地表读取：invite_links, sessions。本地表写入：sessions, audit_logs。

源码：[app/server/src/routes/admin/invite-links.ts:18](../../../app/server/src/routes/admin/invite-links.ts#L18)。验证入口：[tests/server/invitations.test.ts](../../../tests/server/invitations.test.ts)、[tests/server/core.test.ts](../../../tests/server/core.test.ts)、[tests/server/console.test.ts](../../../tests/server/console.test.ts)。

## 创建限时组织邀请链接

`POST /api/admin/:org/invite-links` · `flow:invitation.links.create`

权限与资源：有效会话，requireOrgRole("admin")；仅URL组织，组织owner和允许列表校验通过后，仍由本人token操作上游资源。

响应与错误：200 {ok:true,token,url,expires_at}；hours范围或max_uses整数范围不合法为400。

数据与副作用：生成18字节随机token，保存发起人token密文、有效期与配额，写invite_link.create；不立即发送邀请。

会话读取遇到过期会话才删除 sessions；没有有效会话返回401，不把界面显隐作为授权。

GitHub 调用经全局错误处理发现令牌失效时才结束当前会话并审计；普通成功读取不写操作审计。

本地表读取：sessions。本地表写入：invite_links, audit_logs, sessions。

源码：[app/server/src/routes/admin/invite-links.ts:28](../../../app/server/src/routes/admin/invite-links.ts#L28)。验证入口：[tests/server/invitations.test.ts](../../../tests/server/invitations.test.ts)、[tests/server/core.test.ts](../../../tests/server/core.test.ts)、[tests/server/console.test.ts](../../../tests/server/console.test.ts)。

## 启停组织邀请链接

`PATCH /api/admin/:org/invite-links/:token` · `flow:invitation.links.toggle`

权限与资源：有效会话，requireOrgRole("admin")；仅URL组织，组织owner和允许列表校验通过后，仍由本人token操作上游资源。

响应与错误：200 {ok:true}；token不属于该org为404 not_found。

数据与副作用：按token和org找链接后更新disabled并审计，不撤回已经发出的GitHub邀请。

会话读取遇到过期会话才删除 sessions；没有有效会话返回401，不把界面显隐作为授权。

GitHub 调用经全局错误处理发现令牌失效时才结束当前会话并审计；普通成功读取不写操作审计。

本地表读取：invite_links, sessions。本地表写入：invite_links, audit_logs, sessions。

源码：[app/server/src/routes/admin/invite-links.ts:60](../../../app/server/src/routes/admin/invite-links.ts#L60)。验证入口：[tests/server/invitations.test.ts](../../../tests/server/invitations.test.ts)、[tests/server/core.test.ts](../../../tests/server/core.test.ts)、[tests/server/console.test.ts](../../../tests/server/console.test.ts)。

## 删除组织邀请链接

`DELETE /api/admin/:org/invite-links/:token` · `flow:invitation.links.delete`

权限与资源：有效会话，requireOrgRole("admin")；仅URL组织，组织owner和允许列表校验通过后，仍由本人token操作上游资源。

响应与错误：200 {ok:true}；没有匹配org/token为404 not_found。

数据与副作用：删除匹配链接并审计invite_link.delete；不删除邀请历史，不撤销GitHub既有邀请。

会话读取遇到过期会话才删除 sessions；没有有效会话返回401，不把界面显隐作为授权。

GitHub 调用经全局错误处理发现令牌失效时才结束当前会话并审计；普通成功读取不写操作审计。

本地表读取：invite_links, sessions。本地表写入：invite_links, audit_logs, sessions。

源码：[app/server/src/routes/admin/invite-links.ts:74](../../../app/server/src/routes/admin/invite-links.ts#L74)。验证入口：[tests/server/invitations.test.ts](../../../tests/server/invitations.test.ts)、[tests/server/core.test.ts](../../../tests/server/core.test.ts)、[tests/server/console.test.ts](../../../tests/server/console.test.ts)。

## 读取组织管理员审计

`GET /api/admin/:org/logs` · `flow:audit.organization.read`

权限与资源：有效会话，requireOrgRole("admin")；仅URL组织，组织owner和允许列表校验通过后，仍由本人token操作上游资源。

响应与错误：200 {logs}；details解析为对象，limit最多500。

数据与副作用：只按URL org查询审计。与console审计不同，此处组织owner能看到完整邀请token；org为null的登录审计不返回。

会话读取遇到过期会话才删除 sessions；没有有效会话返回401，不把界面显隐作为授权。

GitHub 调用经全局错误处理发现令牌失效时才结束当前会话并审计；普通成功读取不写操作审计。

本地表读取：audit_logs, sessions。本地表写入：sessions, audit_logs。

源码：[app/server/src/routes/admin/logs.ts:9](../../../app/server/src/routes/admin/logs.ts#L9)。验证入口：[tests/server/console.test.ts](../../../tests/server/console.test.ts)、[tests/server/core.test.ts](../../../tests/server/core.test.ts)。

## 解析本人控制台身份

`GET /api/console/me` · `flow:console.identity`

权限与资源：只需有效会话；回答当前登录者的称号/能力/被GitHub上限挡掉的能力，不接受自报role。

响应与错误：200 {login,avatar_url,org,github_role,title,titles,capabilities,blocked,head_of}。

数据与副作用：只计算当前身份；查GitHub失败按错误处理，不降级为非成员；存在会话不等于拥有console.access。

共同身份路径：读取当前sid及称号权限包，GitHub角色最多缓存60秒；仅过期/令牌失效才删除会话，令牌失效还写一次审计，不代表每次成功读都审计。

本地表读取：sessions, role_assignments, departments, titles。本地表写入：sessions, audit_logs。

源码：[app/server/src/routes/console/me.ts:14](../../../app/server/src/routes/console/me.ts#L14)。验证入口：[tests/server/console.test.ts](../../../tests/server/console.test.ts)。

## 按能力读取工作概览

`GET /api/console/summary` · `flow:console.summary`

权限与资源：console.access；applications、feedback、people三块分别再按applications.read、feedback.read及roles.manage或roles.department.manage过滤。

响应与错误：200 只含获授权的统计键；投递计数含全部五状态和7日数。

数据与副作用：读全局投递统计、CONSOLE_ORG意见数及指派/未归档部门数；不返回无权查看的统计键。

共同身份路径：读取当前sid及称号权限包，GitHub角色最多缓存60秒；仅过期/令牌失效才删除会话，令牌失效还写一次审计，不代表每次成功读都审计。

本地表读取：applications, feedback, sessions, role_assignments, departments, titles。本地表写入：sessions, audit_logs。

源码：[app/server/src/routes/console/me.ts:27](../../../app/server/src/routes/console/me.ts#L27)。验证入口：[tests/server/console.test.ts](../../../tests/server/console.test.ts)。

## 读取称号与能力目录

`GET /api/console/catalogue` · `flow:organization.catalogue`

权限与资源：console.access；供渲染的能力清单不能替代服务端授权。

响应与错误：200 {titles,crew,tones,capabilities,domains,role_base,implies,captain_only,department_icons,application_statuses}。

数据与副作用：称号显示与权限包来自titles；能力、色调、蕴含等来自源码常量，不写权限配置。

共同身份路径：读取当前sid及称号权限包，GitHub角色最多缓存60秒；仅过期/令牌失效才删除会话，令牌失效还写一次审计，不代表每次成功读都审计。

本地表读取：sessions, role_assignments, departments, titles。本地表写入：sessions, audit_logs。

源码：[app/server/src/routes/console/catalogue.ts:12](../../../app/server/src/routes/console/catalogue.ts#L12)。验证入口：[tests/server/console.test.ts](../../../tests/server/console.test.ts)。

## 读取部门及成员计数

`GET /api/console/departments` · `flow:organization.departments.list`

权限与资源：console.access，读取全部部门配置；不是仅本人部门。

响应与错误：200 {departments}，含heads和crew_count，也保留归档标记。

数据与副作用：读取departments和role_assignments，写权限包不在此入口。

共同身份路径：读取当前sid及称号权限包，GitHub角色最多缓存60秒；仅过期/令牌失效才删除会话，令牌失效还写一次审计，不代表每次成功读都审计。

本地表读取：sessions, role_assignments, departments, titles。本地表写入：sessions, audit_logs。

源码：[app/server/src/routes/console/departments.ts:30](../../../app/server/src/routes/console/departments.ts#L30)。验证入口：[tests/server/console.test.ts](../../../tests/server/console.test.ts)。

## 新建组织部门

`POST /api/console/departments` · `flow:organization.departments.create`

权限与资源：roles.manage且GitHub组织owner（requireAdmiral）；舰长仅有roles.manage仍403 admiral_required。

响应与错误：201 {department}；400 captain_only_capability，409 department_exists。

数据与副作用：写新部门，roles.manage不得装进部门权限包；成功写department.create审计。

共同身份路径：读取当前sid及称号权限包，GitHub角色最多缓存60秒；仅过期/令牌失效才删除会话，令牌失效还写一次审计，不代表每次成功读都审计。

本地表读取：sessions, role_assignments, departments, titles。本地表写入：departments, audit_logs, sessions。

源码：[app/server/src/routes/console/departments.ts:37](../../../app/server/src/routes/console/departments.ts#L37)。验证入口：[tests/server/console.test.ts](../../../tests/server/console.test.ts)。

## 修改或归档组织部门

`PATCH /api/console/departments/:department_id` · `flow:organization.departments.update`

权限与资源：roles.manage且GitHub组织owner（requireAdmiral）；舰长仅有roles.manage仍403 admiral_required。

响应与错误：200 {department}；未知id 404，非法舰长专属能力400。

数据与副作用：更新传入字段/归档标记；仅实际变化时审计department.update，未直接撤销其他称号。

共同身份路径：读取当前sid及称号权限包，GitHub角色最多缓存60秒；仅过期/令牌失效才删除会话，令牌失效还写一次审计，不代表每次成功读都审计。

本地表读取：sessions, role_assignments, departments, titles。本地表写入：departments, audit_logs, sessions。

源码：[app/server/src/routes/console/departments.ts:47](../../../app/server/src/routes/console/departments.ts#L47)。验证入口：[tests/server/console.test.ts](../../../tests/server/console.test.ts)。

## 删除部门并撤销该部门指派

`DELETE /api/console/departments/:department_id` · `flow:organization.departments.delete`

权限与资源：roles.manage且GitHub组织owner（requireAdmiral）；舰长仅有roles.manage仍403 admiral_required。

响应与错误：200 {ok:true,removed}；不存在404 not_found。

数据与副作用：同一数据库事务删除该部门和其head/member指派，其他指派不变；审计被撤销者，种子标记防止重启复活。

共同身份路径：读取当前sid及称号权限包，GitHub角色最多缓存60秒；仅过期/令牌失效才删除会话，令牌失效还写一次审计，不代表每次成功读都审计。

本地表读取：sessions, role_assignments, departments, titles。本地表写入：departments, role_assignments, audit_logs, sessions。

源码：[app/server/src/routes/console/departments.ts:63](../../../app/server/src/routes/console/departments.ts#L63)。验证入口：[tests/server/console.test.ts](../../../tests/server/console.test.ts)。

## 修改称号显示与权限包

`PATCH /api/console/titles/:title_id` · `flow:organization.titles.update`

权限与资源：roles.manage；admin/captain两级只有提督能改；提督固定全能力、乘客固定无能力，roles.manage只能进captain包。

响应与错误：200 {title}；400 title_capabilities_fixed/captain_only_capability，403 admiral_required，404 not_found。

数据与副作用：只更新允许的称号字段；实际变化才写title.update（不含旧新值），下一次请求读取新权限包。

共同身份路径：读取当前sid及称号权限包，GitHub角色最多缓存60秒；仅过期/令牌失效才删除会话，令牌失效还写一次审计，不代表每次成功读都审计。

本地表读取：sessions, role_assignments, departments, titles。本地表写入：titles, audit_logs, sessions。

源码：[app/server/src/routes/console/titles.ts:17](../../../app/server/src/routes/console/titles.ts#L17)。验证入口：[tests/server/console.test.ts](../../../tests/server/console.test.ts)。

## 查看可管理的称号指派

`GET /api/console/assignments` · `flow:organization.assignments.list`

权限与资源：任一能力即可；roles.manage查全部，部门队长仅headOf范围，显式查询其他部门403 out_of_department_scope。

响应与错误：200 {assignments,captain}；captain只给登录名。

数据与副作用：读取筛选指派及现任舰长，不任命或移交。

共同身份路径：读取当前sid及称号权限包，GitHub角色最多缓存60秒；仅过期/令牌失效才删除会话，令牌失效还写一次审计，不代表每次成功读都审计。

本地表读取：sessions, role_assignments, departments, titles。本地表写入：sessions, audit_logs。

源码：[app/server/src/routes/console/assignments.ts:34](../../../app/server/src/routes/console/assignments.ts#L34)。验证入口：[tests/server/console.test.ts](../../../tests/server/console.test.ts)。

## 指派称号或移交舰长

`POST /api/console/assignments` · `flow:organization.assignments.grant`

权限与资源：任一能力；队长只任免自己部门member，captain只由提督或现任舰长任命；不能借本人token以外的凭据查账号。

响应与错误：201 {assignment}；400 部门/账号错误，403 跨部门或captain_required，409 assignment_exists；30次/分钟限流。

数据与副作用：先校验部门存在且未归档、查GitHub用户数字id；captain通过事务删旧插新保持唯一；审计指派/移交，不改变GitHub membership。

共同身份路径：读取当前sid及称号权限包，GitHub角色最多缓存60秒；仅过期/令牌失效才删除会话，令牌失效还写一次审计，不代表每次成功读都审计。

本地表读取：sessions, role_assignments, departments, titles。本地表写入：role_assignments, audit_logs, sessions。

源码：[app/server/src/routes/console/assignments.ts:52](../../../app/server/src/routes/console/assignments.ts#L52)。验证入口：[tests/server/console.test.ts](../../../tests/server/console.test.ts)、[tests/server/rate-limits.test.ts](../../../tests/server/rate-limits.test.ts)。

## 撤销称号指派

`DELETE /api/console/assignments/:id` · `flow:organization.assignments.revoke`

权限与资源：任一能力；队长只能撤自己部门member；captain仅提督或该行对应舰长本人可撤。

响应与错误：200 {ok:true}；404 not_found，403 out_of_department_scope/missing_capability，409 captain_transfer_required。

数据与副作用：删除指定指派并记role.revoke，其他指派不变；不删除GitHub组织成员。

共同身份路径：读取当前sid及称号权限包，GitHub角色最多缓存60秒；仅过期/令牌失效才删除会话，令牌失效还写一次审计，不代表每次成功读都审计。

本地表读取：sessions, role_assignments, departments, titles。本地表写入：role_assignments, audit_logs, sessions。

源码：[app/server/src/routes/console/assignments.ts:98](../../../app/server/src/routes/console/assignments.ts#L98)。验证入口：[tests/server/console.test.ts](../../../tests/server/console.test.ts)。

## 查看组织成员与称号持有者

`GET /api/console/people` · `flow:organization.people`

权限与资源：任一能力；队长也能看组织全名单，不按部门收窄。

响应与错误：200 {people}，含login/user_id/avatar_url/github_role/titles；按最高称号层级和登录名排序。

数据与副作用：用本人token取GitHub成员，再合并本地已有指派但离开组织的人；按数字id优先匹配改名用户，不同步写远端。

共同身份路径：读取当前sid及称号权限包，GitHub角色最多缓存60秒；仅过期/令牌失效才删除会话，令牌失效还写一次审计，不代表每次成功读都审计。

本地表读取：sessions, role_assignments, departments, titles。本地表写入：sessions, audit_logs。

源码：[app/server/src/routes/console/people.ts:20](../../../app/server/src/routes/console/people.ts#L20)。验证入口：[tests/server/console.test.ts](../../../tests/server/console.test.ts)。

## 按能力读取脱敏审计

`GET /api/console/audit` · `flow:audit.console.read`

权限与资源：audit.read；仅CONSOLE_ORG，action按转义后的字面前缀筛选；不是全库日志。

响应与错误：200 {logs}；details解析为对象；invite_link目标token及public:token操作者只保留前6位。

数据与副作用：读日志分页，不修改历史；org为空的登录/公开投递审计不在该结果中。

共同身份路径：读取当前sid及称号权限包，GitHub角色最多缓存60秒；仅过期/令牌失效才删除会话，令牌失效还写一次审计，不代表每次成功读都审计。

本地表读取：audit_logs, sessions, role_assignments, departments, titles。本地表写入：sessions, audit_logs。

源码：[app/server/src/routes/console/audit.ts:29](../../../app/server/src/routes/console/audit.ts#L29)。验证入口：[tests/server/console.test.ts](../../../tests/server/console.test.ts)。

## 筛选招新投递列表

`GET /api/console/applications` · `flow:application.list`

权限与资源：applications.read；无部门/个人记录限制，有此能力可读全部候选人列表。

响应与错误：200 {items,total,counts}；特长摘要120字、last_review可空，来源IP/UA不下发；counts为未筛选的全局五状态计数。

数据与副作用：转义q中的LIKE通配符，按姓名/班级/邮箱搜索；查询latest review，不为列表记application.view。

共同身份路径：读取当前sid及称号权限包，GitHub角色最多缓存60秒；仅过期/令牌失效才删除会话，令牌失效还写一次审计，不代表每次成功读都审计。

本地表读取：applications, application_reviews, sessions, role_assignments, departments, titles。本地表写入：sessions, audit_logs。

源码：[app/server/src/routes/console/applications.ts:48](../../../app/server/src/routes/console/applications.ts#L48)。验证入口：[tests/server/console.test.ts](../../../tests/server/console.test.ts)。

## 查看候选人详情与邮件状态

`GET /api/console/applications/:application_id` · `flow:application.detail`

权限与资源：applications.read；按UUID定位任意候选人，无部门范围限制。

响应与错误：200 {application,reviews,received_mail,mail}；404 not_found。邮件摘要不含地址/正文，application不含source_ip/UA。

数据与副作用：读简历、审核历史和mail_outbox摘要，写application.view审计，不触发发信。

共同身份路径：读取当前sid及称号权限包，GitHub角色最多缓存60秒；仅过期/令牌失效才删除会话，令牌失效还写一次审计，不代表每次成功读都审计。

本地表读取：applications, application_reviews, mail_outbox, sessions, role_assignments, departments, titles。本地表写入：audit_logs, sessions。

源码：[app/server/src/routes/console/applications.ts:104](../../../app/server/src/routes/console/applications.ts#L104)。验证入口：[tests/server/console.test.ts](../../../tests/server/console.test.ts)、[tests/server/mail-outbox.test.ts](../../../tests/server/mail-outbox.test.ts)。

## 导出候选人CSV

`GET /api/console/applications/export.csv` · `flow:application.export`

权限与资源：applications.export；可选status过滤，其余不按部门收窄；5次/分钟。

响应与错误：200 text/csv附件，UTF-8 BOM、北京时间列、公式前缀转义；429 rate_limited。

数据与副作用：读取简历并记录application.export数量/状态；不写候选人或发信队列，文件导出后不由系统追踪。

共同身份路径：读取当前sid及称号权限包，GitHub角色最多缓存60秒；仅过期/令牌失效才删除会话，令牌失效还写一次审计，不代表每次成功读都审计。

本地表读取：applications, sessions, role_assignments, departments, titles。本地表写入：audit_logs, sessions。

源码：[app/server/src/routes/console/applications.ts:77](../../../app/server/src/routes/console/applications.ts#L77)。验证入口：[tests/server/console.test.ts](../../../tests/server/console.test.ts)、[tests/server/rate-limits.test.ts](../../../tests/server/rate-limits.test.ts)。

## 审核投递、补备注与安排通知

`PATCH /api/console/applications/:application_id` · `flow:application.review`

权限与资源：applications.review；按id审核，状态变更必须携带expected_status和expected_review_id；取消分支规则仍唯一见application.cancel。

响应与错误：200 {application,review}；400 invalid_status/no_change/letter_required/letter_invalid，404 not_found，409 status_changed。

数据与副作用：变更到interview/accepted/rejected且notify不为false才渲染邮件；状态、审核行和邮件入队同事务，实际发送由后台worker。备注不写信或审计正文；本路由不新增任何取消规则。

共同身份路径：读取当前sid及称号权限包，GitHub角色最多缓存60秒；仅过期/令牌失效才删除会话，令牌失效还写一次审计，不代表每次成功读都审计。

本地表读取：applications, application_reviews, mail_outbox, sessions, role_assignments, departments, titles。本地表写入：applications, application_reviews, mail_outbox, audit_logs, sessions。

源码：[app/server/src/routes/console/applications.ts:120](../../../app/server/src/routes/console/applications.ts#L120)。验证入口：[tests/server/console.test.ts](../../../tests/server/console.test.ts)、[tests/server/mail-outbox.test.ts](../../../tests/server/mail-outbox.test.ts)。

## 提交加入我们申请

`POST /api/portal/apply` · `flow:application.submit`

权限与资源：匿名；蜜罐、PoW、可选Turnstile、每IP分钟5次和IP(/64)/设备24小时各5份。

响应与错误：201 {id,submitted_at,message}；字段错误400附fields，429 apply_limited/rate_limited。蜜罐回相同201形状但不落库。

数据与副作用：计数与投递同事务，发设备cookie；记脱敏application.received审计，尽力入队已收到邮件（每小时总量限制），入队失败仅日志不回滚投递；无需会话。

本地表读取：application_limits, mail_outbox。本地表写入：applications, application_limits, mail_outbox, audit_logs。

源码：[app/server/src/routes/portal/apply.ts:118](../../../app/server/src/routes/portal/apply.ts#L118)。验证入口：[tests/server/applications.test.ts](../../../tests/server/applications.test.ts)、[tests/server/mail-outbox.test.ts](../../../tests/server/mail-outbox.test.ts)、[tests/server/rate-limits.test.ts](../../../tests/server/rate-limits.test.ts)。

## 读取公开防滥用配置

`GET /api/public/config` · `flow:platform.public_config`

权限与资源：匿名可读；仅公开site key或null与PoW难度，不含Turnstile secret。

响应与错误：200 {turnstile_site_key,pow_difficulty}。

数据与副作用：只读配置，无业务数据库读取和写入，不调用验证码服务。

本地表读取：无。本地表写入：无。

源码：[app/server/src/routes/portal/join.ts:47](../../../app/server/src/routes/portal/join.ts#L47)。验证入口：[tests/server/core.test.ts](../../../tests/server/core.test.ts)、[tests/server/configuration.test.ts](../../../tests/server/configuration.test.ts)。

## 阅读公开组织架构

`GET /api/public/org` · `flow:organization.public`

权限与资源：匿名可读；只下发称号/未归档部门显示信息及色调，不含人员或权限包。

响应与错误：200 {tones,titles,departments}。

数据与副作用：读取数据库显示配置与源码rank/tone，不修改组织结构。

本地表读取：titles, departments。本地表写入：无。

源码：[app/server/src/routes/portal/org.ts:11](../../../app/server/src/routes/portal/org.ts#L11)。验证入口：[tests/server/console.test.ts](../../../tests/server/console.test.ts)。

## 浏览公开文档清单

`GET /api/docs` · `flow:documentation.list`

权限与资源：匿名，只收DOC_FILES允许列表且文件存在。

响应与错误：200 {items:[{id,label,lang,file}]}。

数据与副作用：仅检查仓库公开文件是否存在；内部规范、运维和目录不会通过此API公开。

本地表读取：无。本地表写入：无。

源码：[app/server/src/routes/portal/docs.ts:16](../../../app/server/src/routes/portal/docs.ts#L16)。验证入口：[tests/server/core.test.ts](../../../tests/server/core.test.ts)。

## 阅读允许公开的文档

`GET /api/docs/:id` · `flow:documentation.read`

权限与资源：匿名；id必须命中固定DOC_FILES，不能用任意路径读取文件。

响应与错误：200 {id,label,lang,file,content}；未列入或文件缺失404。

数据与副作用：读取允许的UTF-8 Markdown，不访问业务数据库、不执行内容。

本地表读取：无。本地表写入：无。

源码：[app/server/src/routes/portal/docs.ts:23](../../../app/server/src/routes/portal/docs.ts#L23)。验证入口：[tests/server/core.test.ts](../../../tests/server/core.test.ts)。

## 检查公开邀请链接

`GET /api/join/:token` · `flow:invitation.public.inspect`

权限与资源：持有token可访问；不需要登录，不返回发起人的token密文。

响应与错误：200 {org,note,team_slug,expires_at,remaining_uses,valid,reason}；未知token404。

数据与副作用：读取链接状态并计算剩余额度，不预留额度、不调用GitHub、不发邀请。

本地表读取：invite_links。本地表写入：无。

源码：[app/server/src/routes/portal/join.ts:52](../../../app/server/src/routes/portal/join.ts#L52)。验证入口：[tests/server/invitations.test.ts](../../../tests/server/invitations.test.ts)。

## 兑换组织邀请链接

`POST /api/join/:token` · `flow:invitation.public.redeem`

权限与资源：持有token，PoW/蜜罐/可选Turnstile及分钟限流；额度、禁用和过期在事务预留时再次校验；使用链接发起人密文中的token。

响应与错误：200 {ok:true,invitation_id,message}；404不存在，400输入/明确失败，409 invite_pending_review/invite_unavailable，503凭据失效或结果待核对。

数据与副作用：先事务预留再请求GitHub（可查团队和用户名），成功写邀请/尝试/审计；sent重放不重复发送，明确失败返还额度，不确定结果保留unknown待核对，不删除访问者会话。

本地表读取：invite_links, invite_attempts。本地表写入：invite_links, invite_attempts, invitations, audit_logs。

源码：[app/server/src/routes/portal/join.ts:67](../../../app/server/src/routes/portal/join.ts#L67)。验证入口：[tests/server/invitations.test.ts](../../../tests/server/invitations.test.ts)、[tests/server/rate-limits.test.ts](../../../tests/server/rate-limits.test.ts)。

## 读取意见分类与提交参数

`GET /api/feedback/categories` · `flow:feedback.categories`

权限与资源：匿名，只返回本部署CONSOLE_ORG及固定分类。

响应与错误：200 {categories,pow_difficulty,org}。

数据与副作用：读源码配置，不写数据库、不发信。

本地表读取：无。本地表写入：无。

源码：[app/server/src/routes/portal/feedback.ts:24](../../../app/server/src/routes/portal/feedback.ts#L24)。验证入口：[tests/server/feedback-org.test.ts](../../../tests/server/feedback-org.test.ts)、[tests/server/core.test.ts](../../../tests/server/core.test.ts)。

## 浏览已公开的意见与回复

`GET /api/feedback/public` · `flow:feedback.public.list`

权限与资源：匿名；org按大小写不敏感匹配CONSOLE_ORG，否则回空列表；spam不公开。

响应与错误：200 {items}；正文截280字、含回复/状态/票数，不含contact/IP/UA；limit由合同限制且最终最多100。

数据与副作用：只读本组织反馈，不查询其他组织是否有记录。

本地表读取：feedback。本地表写入：无。

源码：[app/server/src/routes/portal/feedback.ts:62](../../../app/server/src/routes/portal/feedback.ts#L62)。验证入口：[tests/server/feedback-org.test.ts](../../../tests/server/feedback-org.test.ts)、[tests/server/core.test.ts](../../../tests/server/core.test.ts)。

## 提交组织意见

`POST /api/feedback` · `flow:feedback.submit`

权限与资源：匿名可提交；仅CONSOLE_ORG，5至5000字，固定分类，PoW/蜜罐/Turnstile与每分钟10次限流；sid仅补充提交人身份。

响应与错误：200 {ok:true,id,message}；非法org/内容/分类或人机校验失败400，超额429。

数据与副作用：写feedback及feedback.submit审计（80字预览）；有效sid补账号，过期sid可删除；联系方式截200字，不发送邮件。

本地表读取：sessions。本地表写入：feedback, audit_logs, sessions。

源码：[app/server/src/routes/portal/feedback.ts:26](../../../app/server/src/routes/portal/feedback.ts#L26)。验证入口：[tests/server/feedback-org.test.ts](../../../tests/server/feedback-org.test.ts)、[tests/server/core.test.ts](../../../tests/server/core.test.ts)、[tests/server/rate-limits.test.ts](../../../tests/server/rate-limits.test.ts)。

## 组织管理员读取待处理意见

`GET /api/admin/:org/feedback` · `flow:feedback.admin.list`

权限与资源：有效会话及URL org的GitHub admin，ALLOWED_ORGS限制；与控制台能力授权分开。

响应与错误：200 {items,counts}；最多500条，管理DTO不下发source_ip/UA/数字账号id。

数据与副作用：按org及可选status读列表与状态计数，不记查看审计。

本地表读取：feedback, sessions。本地表写入：sessions, audit_logs。

源码：[app/server/src/routes/admin/feedback.ts:13](../../../app/server/src/routes/admin/feedback.ts#L13)。验证入口：[tests/server/feedback-org.test.ts](../../../tests/server/feedback-org.test.ts)、[tests/server/console.test.ts](../../../tests/server/console.test.ts)、[tests/server/core.test.ts](../../../tests/server/core.test.ts)。

## 组织管理员处理意见状态与回复

`PATCH /api/admin/:org/feedback/:id` · `flow:feedback.admin.update`

权限与资源：有效会话及URL org的GitHub admin，ALLOWED_ORGS限制；与控制台能力授权分开。

响应与错误：200 {ok:true}；记录不属于org返回404，非法状态被合同/handler拒绝。

数据与副作用：更新status、reply、replied_by/replied_at及updated_at，审计feedback.update；回复将由公开列表展示，不发邮件。

本地表读取：feedback, sessions。本地表写入：feedback, audit_logs, sessions。

源码：[app/server/src/routes/admin/feedback.ts:19](../../../app/server/src/routes/admin/feedback.ts#L19)。验证入口：[tests/server/feedback-org.test.ts](../../../tests/server/feedback-org.test.ts)、[tests/server/console.test.ts](../../../tests/server/console.test.ts)、[tests/server/core.test.ts](../../../tests/server/core.test.ts)。

## 组织管理员删除组织意见

`DELETE /api/admin/:org/feedback/:id` · `flow:feedback.admin.delete`

权限与资源：有效会话及URL org的GitHub admin，ALLOWED_ORGS限制；与控制台能力授权分开。

响应与错误：200 {ok:true}；org/id不匹配404。

数据与副作用：删除反馈并审计feedback.delete，不能越过组织条件删除其他记录。

本地表读取：feedback, sessions。本地表写入：feedback, audit_logs, sessions。

源码：[app/server/src/routes/admin/feedback.ts:32](../../../app/server/src/routes/admin/feedback.ts#L32)。验证入口：[tests/server/feedback-org.test.ts](../../../tests/server/feedback-org.test.ts)、[tests/server/console.test.ts](../../../tests/server/console.test.ts)、[tests/server/core.test.ts](../../../tests/server/core.test.ts)。

## 控制台读取待处理意见

`GET /api/console/feedback` · `flow:feedback.console.list`

权限与资源：feedback.read；资源固定CONSOLE_ORG，不接受客户端自报org。

响应与错误：200 {items,counts}；最多500条，管理DTO不下发source_ip/UA/数字账号id。

数据与副作用：按org及可选status读列表与状态计数，不记查看审计。

共同身份路径：读取当前sid及称号权限包，GitHub角色最多缓存60秒；仅过期/令牌失效才删除会话，令牌失效还写一次审计，不代表每次成功读都审计。

本地表读取：feedback, sessions, role_assignments, departments, titles。本地表写入：sessions, audit_logs。

源码：[app/server/src/routes/console/feedback.ts:12](../../../app/server/src/routes/console/feedback.ts#L12)。验证入口：[tests/server/feedback-org.test.ts](../../../tests/server/feedback-org.test.ts)、[tests/server/console.test.ts](../../../tests/server/console.test.ts)、[tests/server/core.test.ts](../../../tests/server/core.test.ts)。

## 控制台处理意见状态与回复

`PATCH /api/console/feedback/:id` · `flow:feedback.console.update`

权限与资源：feedback.manage；资源固定CONSOLE_ORG，不接受客户端自报org。

响应与错误：200 {ok:true}；记录不属于org返回404，非法状态被合同/handler拒绝。

数据与副作用：更新status、reply、replied_by/replied_at及updated_at，审计feedback.update；回复将由公开列表展示，不发邮件。

共同身份路径：读取当前sid及称号权限包，GitHub角色最多缓存60秒；仅过期/令牌失效才删除会话，令牌失效还写一次审计，不代表每次成功读都审计。

本地表读取：feedback, sessions, role_assignments, departments, titles。本地表写入：feedback, audit_logs, sessions。

源码：[app/server/src/routes/console/feedback.ts:18](../../../app/server/src/routes/console/feedback.ts#L18)。验证入口：[tests/server/feedback-org.test.ts](../../../tests/server/feedback-org.test.ts)、[tests/server/console.test.ts](../../../tests/server/console.test.ts)、[tests/server/core.test.ts](../../../tests/server/core.test.ts)。

## 控制台删除组织意见

`DELETE /api/console/feedback/:id` · `flow:feedback.console.delete`

权限与资源：feedback.manage；资源固定CONSOLE_ORG，不接受客户端自报org。

响应与错误：200 {ok:true}；org/id不匹配404。

数据与副作用：删除反馈并审计feedback.delete，不能越过组织条件删除其他记录。

共同身份路径：读取当前sid及称号权限包，GitHub角色最多缓存60秒；仅过期/令牌失效才删除会话，令牌失效还写一次审计，不代表每次成功读都审计。

本地表读取：feedback, sessions, role_assignments, departments, titles。本地表写入：feedback, audit_logs, sessions。

源码：[app/server/src/routes/console/feedback.ts:31](../../../app/server/src/routes/console/feedback.ts#L31)。验证入口：[tests/server/feedback-org.test.ts](../../../tests/server/feedback-org.test.ts)、[tests/server/console.test.ts](../../../tests/server/console.test.ts)、[tests/server/core.test.ts](../../../tests/server/core.test.ts)。

## 浏览论坛状态与本人私有列表

`GET /api/forum/state` · `flow:forum.state`

权限与资源：游客与成员均可读；通知、书签和真实通知设置仅本人可见，其他用户设置给默认值；关注关系公开。

响应与错误：200 {state}，帖子只有字段和摘要、没有正文；每IP(/64)分钟120次，超额429；显式HEAD回405且不计算state。

数据与副作用：读论坛表与公开内容分类；GET也可能通过forumViewer刷新本人用户；不发送邮件、不写帖子。

身份条件副作用：forumViewer仅在当前仍为组织成员时创建/刷新forum_users的角色、称号和GitHub头像；sid过期删除会话，上游拒绝token经全局处理时删会话并审计；游客不刷新成员记录。

本地表读取：forum_counters, forum_users, forum_tags, forum_topics, forum_posts, forum_likes, forum_notifications, forum_bookmarks, forum_follows, sessions, role_assignments, departments, titles。本地表写入：forum_users, sessions, audit_logs。

源码：[app/server/src/routes/forum-api/topics.ts:21](../../../app/server/src/routes/forum-api/topics.ts#L21)。验证入口：[tests/server/forum.test.ts](../../../tests/server/forum.test.ts)。

## 阅读单话题帖子正文

`GET /api/forum/topics/:topic_id/posts` · `flow:forum.topic_posts`

权限与资源：游客与成员均可读，无额外帖子级权限；与state可见性一致。

响应与错误：200 {posts}含正文；话题不存在404；每IP分钟60次。

数据与副作用：按话题读取帖子及点赞投影；软删正文为空；不把全论坛正文再次塞进首屏。

身份条件副作用：forumViewer仅在当前仍为组织成员时创建/刷新forum_users的角色、称号和GitHub头像；sid过期删除会话，上游拒绝token经全局处理时删会话并审计；游客不刷新成员记录。

本地表读取：forum_topics, forum_posts, forum_likes, sessions, role_assignments, departments, titles, forum_users。本地表写入：forum_users, sessions, audit_logs。

源码：[app/server/src/routes/forum-api/topics.ts:28](../../../app/server/src/routes/forum-api/topics.ts#L28)。验证入口：[tests/server/forum.test.ts](../../../tests/server/forum.test.ts)。

## 搜索话题帖子和用户

`GET /api/forum/search` · `flow:forum.search`

权限与资源：游客与成员均可搜索；只本人用户记录显示真实通知设置，不搜索已删帖子正文。

响应与错误：200 {results:{topics,posts,users}}；空词空结果；词过长400 validation_error，每IP分钟60次。

数据与副作用：标题、正文、username/displayName按转义的LIKE搜索，各类限量；返回帖子命中摘要，不将%当通配符。

身份条件副作用：forumViewer仅在当前仍为组织成员时创建/刷新forum_users的角色、称号和GitHub头像；sid过期删除会话，上游拒绝token经全局处理时删会话并审计；游客不刷新成员记录。

本地表读取：forum_topics, forum_posts, forum_users, forum_likes, sessions, role_assignments, departments, titles。本地表写入：forum_users, sessions, audit_logs。

源码：[app/server/src/routes/forum-api/topics.ts:38](../../../app/server/src/routes/forum-api/topics.ts#L38)。验证入口：[tests/server/forum.test.ts](../../../tests/server/forum.test.ts)。

## 发布成员话题与首帖

`POST /api/forum/topics` · `flow:forum.topics.create`

权限与资源：requireMember：有效sid且当前仍是CONSOLE_ORG成员；主体由服务端forumViewer确定，客户端userId/role不能赋权。

响应与错误：201 {changes,viewer,guestPolicy,topicId,postId}，帖子带正文；非法标题/分类/tag/空正文400，成员限流429。

数据与副作用：单事务创建话题、首帖、编号和必要新tag，处理最多10个@提及通知；成功后记topic限流事件，不发邮件。

身份条件副作用：forumViewer仅在当前仍为组织成员时创建/刷新forum_users的角色、称号和GitHub头像；sid过期删除会话，上游拒绝token经全局处理时删会话并审计；游客不刷新成员记录。

本地表读取：forum_topics, forum_posts, forum_tags, forum_users, forum_notifications, forum_counters, forum_rate_events, sessions, role_assignments, departments, titles, forum_likes。本地表写入：forum_topics, forum_posts, forum_tags, forum_notifications, forum_counters, forum_rate_events, forum_users, sessions, audit_logs。

源码：[app/server/src/routes/forum-api/topics.ts:47](../../../app/server/src/routes/forum-api/topics.ts#L47)。验证入口：[tests/server/forum.test.ts](../../../tests/server/forum.test.ts)。

## 置顶或取消置顶话题

`POST /api/forum/topics/:topic_id/pin` · `flow:forum.topics.pin`

权限与资源：requireMember：有效sid且当前仍是CONSOLE_ORG成员；主体由服务端forumViewer确定，客户端userId/role不能赋权。 此外必须具备forum.topic.pin，作用于指定话题。

响应与错误：200 {changes,viewer,guestPolicy}；只返回本次变动记录，成员自己的用户记录总携带，私有记录按本人范围投影。；缺能力403，话题不存在404。

数据与副作用：更新pinned；以CONSOLE_ORG记forum.topic.pin审计，只含话题id及开关，不含正文。

身份条件副作用：forumViewer仅在当前仍为组织成员时创建/刷新forum_users的角色、称号和GitHub头像；sid过期删除会话，上游拒绝token经全局处理时删会话并审计；游客不刷新成员记录。

本地表读取：forum_topics, sessions, role_assignments, departments, titles, forum_users, forum_likes。本地表写入：forum_topics, audit_logs, forum_users, sessions。

源码：[app/server/src/routes/forum-api/topics.ts:67](../../../app/server/src/routes/forum-api/topics.ts#L67)。验证入口：[tests/server/forum.test.ts](../../../tests/server/forum.test.ts)。

## 关闭或重新打开话题

`POST /api/forum/topics/:topic_id/close` · `flow:forum.topics.close`

权限与资源：requireMember：有效sid且当前仍是CONSOLE_ORG成员；主体由服务端forumViewer确定，客户端userId/role不能赋权。 此外必须具备forum.topic.close，作用于指定话题。

响应与错误：200 {changes,viewer,guestPolicy}；只返回本次变动记录，成员自己的用户记录总携带，私有记录按本人范围投影。；缺能力403，话题不存在404。

数据与副作用：更新closed；以CONSOLE_ORG记forum.topic.close审计，只含话题id及开关，不含正文。

身份条件副作用：forumViewer仅在当前仍为组织成员时创建/刷新forum_users的角色、称号和GitHub头像；sid过期删除会话，上游拒绝token经全局处理时删会话并审计；游客不刷新成员记录。

本地表读取：forum_topics, sessions, role_assignments, departments, titles, forum_users, forum_likes。本地表写入：forum_topics, audit_logs, forum_users, sessions。

源码：[app/server/src/routes/forum-api/topics.ts:67](../../../app/server/src/routes/forum-api/topics.ts#L67)。验证入口：[tests/server/forum.test.ts](../../../tests/server/forum.test.ts)。

## 记录话题浏览数

`POST /api/forum/topics/:topic_id/view` · `flow:forum.topics.view`

权限与资源：游客或成员都可调用，不解析登录身份；按IP(/64)与话题去重。

响应与错误：204空体；不存在404，分钟60次超额429。

数据与副作用：事务清理超过1小时的去重记录，首次浏览才+1；IP只保留在短期去重表，不随帖子返回。

本地表读取：forum_topics, forum_topic_views。本地表写入：forum_topics, forum_topic_views。

源码：[app/server/src/routes/forum-api/topics.ts:80](../../../app/server/src/routes/forum-api/topics.ts#L80)。验证入口：[tests/server/forum.test.ts](../../../tests/server/forum.test.ts)。

## 成员或游客回复话题

`POST /api/forum/posts` · `flow:forum.posts.reply`

权限与资源：成员直接回复；游客需合法昵称、空蜜罐、PoW、可选Turnstile与IP/全站限流；已关闭话题仅forum.post.moderate可回，replyTo须同一话题。

响应与错误：201 {changes,viewer,guestPolicy,postId}含正文；404话题不存在；403关闭；400正文/昵称/冒名/PoW/验证码失败；429 rate_limited或guest_replies_paused。

数据与副作用：事务创建回复并更新最后活动、处理回复与提及通知；游客用户与回复同事务；PoW通过就记该IP尝试额度，成功才记全站额度；冒名检查读指派、历史登录审计及会话；不发送邮件。

身份条件副作用：forumViewer仅在当前仍为组织成员时创建/刷新forum_users的角色、称号和GitHub头像；sid过期删除会话，上游拒绝token经全局处理时删会话并审计；游客不刷新成员记录。

本地表读取：forum_topics, forum_posts, forum_users, forum_notifications, forum_counters, forum_rate_events, role_assignments, audit_logs, sessions, departments, titles, forum_likes。本地表写入：forum_posts, forum_topics, forum_users, forum_notifications, forum_counters, forum_rate_events, sessions, audit_logs。

源码：[app/server/src/routes/forum-api/posts.ts:36](../../../app/server/src/routes/forum-api/posts.ts#L36)。验证入口：[tests/server/forum.test.ts](../../../tests/server/forum.test.ts)。

## 编辑自己的帖子或执行版务

`PATCH /api/forum/posts/:post_id` · `flow:forum.posts.edit`

权限与资源：requireMember：有效sid且当前仍是CONSOLE_ORG成员；主体由服务端forumViewer确定，客户端userId/role不能赋权。 必须是作者本人，或者持有forum.post.moderate；能力不是作者分支的共同前提。

响应与错误：200 {changes,viewer,guestPolicy}；只返回本次变动记录，成员自己的用户记录总携带，私有记录按本人范围投影。；帖子正文随changes返回；404不存在、403他人帖子、409 post_deleted、400 empty_content。

数据与副作用：只更新正文/edited_at；只有编辑他人帖子才写forum.post.edit审计，不记录正文；不会因编辑重新发送提及通知。

身份条件副作用：forumViewer仅在当前仍为组织成员时创建/刷新forum_users的角色、称号和GitHub头像；sid过期删除会话，上游拒绝token经全局处理时删会话并审计；游客不刷新成员记录。

本地表读取：forum_posts, sessions, role_assignments, departments, titles, forum_users, forum_likes。本地表写入：forum_posts, audit_logs, forum_users, sessions。

源码：[app/server/src/routes/forum-api/posts.ts:78](../../../app/server/src/routes/forum-api/posts.ts#L78)。验证入口：[tests/server/forum.test.ts](../../../tests/server/forum.test.ts)。

## 软删除回复

`DELETE /api/forum/posts/:post_id` · `flow:forum.posts.delete`

权限与资源：requireMember：有效sid且当前仍是CONSOLE_ORG成员；主体由服务端forumViewer确定，客户端userId/role不能赋权。 作者本人或forum.post.moderate；第一帖禁止删除。

响应与错误：200 {changes,viewer,guestPolicy}；只返回本次变动记录，成员自己的用户记录总携带，私有记录按本人范围投影。；404不存在、403他人帖子、400 first_post；已软删重试返回现状。

数据与副作用：置deleted并清正文，保留点赞和书签；只在删除他人帖子时记forum.post.delete审计；幂等重试不重复执行删除。

身份条件副作用：forumViewer仅在当前仍为组织成员时创建/刷新forum_users的角色、称号和GitHub头像；sid过期删除会话，上游拒绝token经全局处理时删会话并审计；游客不刷新成员记录。

本地表读取：forum_posts, sessions, role_assignments, departments, titles, forum_users, forum_likes。本地表写入：forum_posts, audit_logs, forum_users, sessions。

源码：[app/server/src/routes/forum-api/posts.ts:90](../../../app/server/src/routes/forum-api/posts.ts#L90)。验证入口：[tests/server/forum.test.ts](../../../tests/server/forum.test.ts)。

## 切换本人点赞

`POST /api/forum/posts/:post_id/like` · `flow:forum.posts.like`

权限与资源：requireMember：有效sid且当前仍是CONSOLE_ORG成员；主体由服务端forumViewer确定，客户端userId/role不能赋权。 点赞主体固定本人，不接受代他人点赞。

响应与错误：200 {changes,viewer,guestPolicy}；只返回本次变动记录，成员自己的用户记录总携带，私有记录按本人范围投影。；404不存在，409 post_deleted；帖子投影不带全文。

数据与副作用：事务切换点赞；新点赞按作者通知设置生成一次通知（同人同帖不重复），取消不撤回已有通知，不写操作审计。

身份条件副作用：forumViewer仅在当前仍为组织成员时创建/刷新forum_users的角色、称号和GitHub头像；sid过期删除会话，上游拒绝token经全局处理时删会话并审计；游客不刷新成员记录。

本地表读取：forum_posts, forum_likes, forum_users, forum_notifications, forum_counters, sessions, role_assignments, departments, titles。本地表写入：forum_likes, forum_notifications, forum_counters, forum_users, sessions, audit_logs。

源码：[app/server/src/routes/forum-api/posts.ts:101](../../../app/server/src/routes/forum-api/posts.ts#L101)。验证入口：[tests/server/forum.test.ts](../../../tests/server/forum.test.ts)。

## 切换本人书签

`POST /api/forum/posts/:post_id/bookmark` · `flow:forum.posts.bookmark`

权限与资源：requireMember：有效sid且当前仍是CONSOLE_ORG成员；主体由服务端forumViewer确定，客户端userId/role不能赋权。 只能操作本人的书签；handler只检查帖子存在，未禁止为已软删帖子加书签。

响应与错误：200 {changes,viewer,guestPolicy}；只返回本次变动记录，成员自己的用户记录总携带，私有记录按本人范围投影。；404不存在；删除书签用changes.removed反馈。

数据与副作用：事务按userId/postId切换书签，不通知作者，不修改帖子正文。

身份条件副作用：forumViewer仅在当前仍为组织成员时创建/刷新forum_users的角色、称号和GitHub头像；sid过期删除会话，上游拒绝token经全局处理时删会话并审计；游客不刷新成员记录。

本地表读取：forum_posts, forum_bookmarks, sessions, role_assignments, departments, titles, forum_users, forum_likes。本地表写入：forum_bookmarks, forum_users, sessions, audit_logs。

源码：[app/server/src/routes/forum-api/posts.ts:109](../../../app/server/src/routes/forum-api/posts.ts#L109)。验证入口：[tests/server/forum.test.ts](../../../tests/server/forum.test.ts)。

## 切换本人关注关系

`POST /api/forum/users/:forum_user_id/follow` · `flow:forum.users.follow`

权限与资源：requireMember：有效sid且当前仍是CONSOLE_ORG成员；主体由服务端forumViewer确定，客户端userId/role不能赋权。 关注发起人固定本人，目标须存在且不是本人。

响应与错误：200 {changes,viewer,guestPolicy}；只返回本次变动记录，成员自己的用户记录总携带，私有记录按本人范围投影。；404未知用户，400 cannot_follow_self。

数据与副作用：事务切换关注；首次关注在对方允许通知且未曾通知时写通知与编号，取消关注不删除旧通知。

身份条件副作用：forumViewer仅在当前仍为组织成员时创建/刷新forum_users的角色、称号和GitHub头像；sid过期删除会话，上游拒绝token经全局处理时删会话并审计；游客不刷新成员记录。

本地表读取：forum_users, forum_follows, forum_notifications, forum_counters, sessions, role_assignments, departments, titles, forum_likes。本地表写入：forum_follows, forum_notifications, forum_counters, forum_users, sessions, audit_logs。

源码：[app/server/src/routes/forum-api/people.ts:11](../../../app/server/src/routes/forum-api/people.ts#L11)。验证入口：[tests/server/forum.test.ts](../../../tests/server/forum.test.ts)。

## 标记本人通知已读

`POST /api/forum/notifications/:notification_id/read` · `flow:forum.notifications.read`

权限与资源：requireMember：有效sid且当前仍是CONSOLE_ORG成员；主体由服务端forumViewer确定，客户端userId/role不能赋权。 SQL同时匹配通知id与recipient_id，不能读取/标记他人通知。

响应与错误：200 {changes,viewer,guestPolicy}；只返回本次变动记录，成员自己的用户记录总携带，私有记录按本人范围投影。；不存在或属于他人均404。

数据与副作用：仅更新本人该条read=1，不删通知；其他人的通知设置不下发。

身份条件副作用：forumViewer仅在当前仍为组织成员时创建/刷新forum_users的角色、称号和GitHub头像；sid过期删除会话，上游拒绝token经全局处理时删会话并审计；游客不刷新成员记录。

本地表读取：forum_notifications, sessions, role_assignments, departments, titles, forum_users, forum_likes。本地表写入：forum_notifications, forum_users, sessions, audit_logs。

源码：[app/server/src/routes/forum-api/people.ts:20](../../../app/server/src/routes/forum-api/people.ts#L20)。验证入口：[tests/server/forum.test.ts](../../../tests/server/forum.test.ts)。

## 标记本人全部通知已读

`POST /api/forum/notifications/read-all` · `flow:forum.notifications.read_all`

权限与资源：requireMember：有效sid且当前仍是CONSOLE_ORG成员；主体由服务端forumViewer确定，客户端userId/role不能赋权。 仅recipient_id等于本人。

响应与错误：200 {changes,viewer,guestPolicy}；只返回本次变动记录，成员自己的用户记录总携带，私有记录按本人范围投影。；没有未读通知仍返回合法空变更。

数据与副作用：UPDATE本人未读行并RETURNING id，据此只回变动通知，不清除别人的未读数。

身份条件副作用：forumViewer仅在当前仍为组织成员时创建/刷新forum_users的角色、称号和GitHub头像；sid过期删除会话，上游拒绝token经全局处理时删会话并审计；游客不刷新成员记录。

本地表读取：forum_notifications, sessions, role_assignments, departments, titles, forum_users, forum_likes。本地表写入：forum_notifications, forum_users, sessions, audit_logs。

源码：[app/server/src/routes/forum-api/people.ts:26](../../../app/server/src/routes/forum-api/people.ts#L26)。验证入口：[tests/server/forum.test.ts](../../../tests/server/forum.test.ts)。

## 修改本人论坛资料

`PATCH /api/forum/me/profile` · `flow:forum.profile.update`

权限与资源：requireMember：有效sid且当前仍是CONSOLE_ORG成员；主体由服务端forumViewer确定，客户端userId/role不能赋权。 只修改本人记录；允许昵称、签名、所在地、https网站与通知设置，不接收用户角色授权。

响应与错误：200 {changes,viewer,guestPolicy}；只返回本次变动记录，成员自己的用户记录总携带，私有记录按本人范围投影。；400昵称/控制字符/网址等错误；旧昵称未变时不因新昵称规则阻止修改其他字段。

数据与副作用：昵称NFKC与冒名检查后保存；冒名来源含已有成员/官方用户名、指派和登录过的组织账号；只更新提交字段，不更改GitHub资料。

身份条件副作用：forumViewer仅在当前仍为组织成员时创建/刷新forum_users的角色、称号和GitHub头像；sid过期删除会话，上游拒绝token经全局处理时删会话并审计；游客不刷新成员记录。

本地表读取：forum_users, role_assignments, sessions, audit_logs, departments, titles, forum_likes。本地表写入：forum_users, sessions, audit_logs。

源码：[app/server/src/routes/forum-api/people.ts:32](../../../app/server/src/routes/forum-api/people.ts#L32)。验证入口：[tests/server/forum.test.ts](../../../tests/server/forum.test.ts)。

## 上传本人论坛头像

`PUT /api/forum/me/avatar` · `flow:forum.avatar.upload`

权限与资源：requireMember：有效sid且当前仍是CONSOLE_ORG成员；主体由服务端forumViewer确定，客户端userId/role不能赋权。 onRequest阶段即鉴权并消费每小时10次额度，失败解码也算；只改本人头像。

响应与错误：200 {changes,viewer,guestPolicy}；只返回本次变动记录，成员自己的用户记录总携带，私有记录按本人范围投影。；413 avatar_too_large，415 unsupported_media_type，400非法图像/尺寸，429限流。

数据与副作用：PNG/JPEG/WebP最多2MB、4096×4096；sharp取首帧转256×256 WebP去元数据；按哈希写库并更新本人引用，同事务清理无人引用的旧头像。

身份条件副作用：forumViewer仅在当前仍为组织成员时创建/刷新forum_users的角色、称号和GitHub头像；sid过期删除会话，上游拒绝token经全局处理时删会话并审计；游客不刷新成员记录。

本地表读取：forum_avatars, forum_users, forum_rate_events, sessions, role_assignments, departments, titles, forum_likes。本地表写入：forum_avatars, forum_users, forum_rate_events, sessions, audit_logs。

源码：[app/server/src/routes/forum-api/people.ts:80](../../../app/server/src/routes/forum-api/people.ts#L80)。验证入口：[tests/server/forum.test.ts](../../../tests/server/forum.test.ts)。

## 恢复本人默认头像

`DELETE /api/forum/me/avatar` · `flow:forum.avatar.clear`

权限与资源：requireMember：有效sid且当前仍是CONSOLE_ORG成员；主体由服务端forumViewer确定，客户端userId/role不能赋权。 只清本人自定义头像。

响应与错误：200 {changes,viewer,guestPolicy}；只返回本次变动记录，成员自己的用户记录总携带，私有记录按本人范围投影。

数据与副作用：事务移除avatar_hash引用并删除无用户引用的旧头像，保留GitHub头像字段用于回退，不删除用户。

身份条件副作用：forumViewer仅在当前仍为组织成员时创建/刷新forum_users的角色、称号和GitHub头像；sid过期删除会话，上游拒绝token经全局处理时删会话并审计；游客不刷新成员记录。

本地表读取：forum_users, forum_avatars, sessions, role_assignments, departments, titles, forum_likes。本地表写入：forum_users, forum_avatars, sessions, audit_logs。

源码：[app/server/src/routes/forum-api/people.ts:91](../../../app/server/src/routes/forum-api/people.ts#L91)。验证入口：[tests/server/forum.test.ts](../../../tests/server/forum.test.ts)。

## 读取公开头像文件

`GET /api/forum/avatars/:file` · `flow:forum.avatar.read`

权限与资源：匿名；按合同限定的哈希.webp取文件，不接受磁盘路径。

响应与错误：200 image/webp二进制，immutable一年缓存、default-src none和nosniff；不存在404。

数据与副作用：按哈希读取SQLite内WebP数据，不读取私有快照文件或解析sid。

本地表读取：forum_avatars。本地表写入：无。

源码：[app/server/src/routes/forum-api/people.ts:99](../../../app/server/src/routes/forum-api/people.ts#L99)。验证入口：[tests/server/forum.test.ts](../../../tests/server/forum.test.ts)。

## 辨认本机论坛运行模式

`interface:forum.local-supervisor` · `GET /__geek_forum` · `flow:forum.local.supervisor`

权限与资源：仅import.meta.dev，非开发404；不是登录身份或业务权限接口。

响应与错误：200 {module,instance,mode,contentSource,snapshotConfigured,realAuthentication:false,serverPersistence:false}，no-store。

数据与副作用：只读运行时配置与进程标识；snapshotConfigured只检查配置是否非空，不连接数据库或校验文件可用。

验证边界：所列为纯解析、内容转换或配置测试，不是本次启动Nitro或读取真实快照的证明。

SQLite读写：无。源码：[app/forum/server/routes/__geek_forum.get.ts](../../../app/forum/server/routes/__geek_forum.get.ts)。验证入口：[app/forum/tests/content-source.test.ts](../../../app/forum/tests/content-source.test.ts)。

## 读取开发快照状态

`interface:forum.local-state` · `GET,HEAD /api/local-forum/state` · `flow:forum.local.state`

权限与资源：仅开发且配置快照目录，GET/HEAD；不实现成员认证，不能把游客展示认成权限校验。

响应与错误：GET 200 {schemaVersion,mode,capturedAt,summary,state}；HEAD空体；未配置404，其他方法405，快照不可读/不合法503。

数据与副作用：读取content.json、asset-index.json和内容编辑层，解析后缓存当前进程；失败缓存清除以便重试；no-store/nosniff，无SQLite或写文件。

验证边界：所列为纯解析、内容转换或配置测试，不是本次启动Nitro或读取真实快照的证明。

SQLite读写：无。源码：[app/forum/server/routes/api/local-forum/state.ts](../../../app/forum/server/routes/api/local-forum/state.ts)。验证入口：[app/forum/tests/local-snapshot.test.ts](../../../app/forum/tests/local-snapshot.test.ts)、[app/forum/tests/local-curation.test.ts](../../../app/forum/tests/local-curation.test.ts)、[app/forum/tests/content-source.test.ts](../../../app/forum/tests/content-source.test.ts)。

## 读取开发快照附件

`interface:forum.local-asset` · `GET,HEAD /api/local-forum/assets/:hash` · `flow:forum.local.asset`

权限与资源：仅开发配置快照且GET/HEAD；hash须在资产索引中、文件必须位于assets目录，不根据原始文件名开放路径。

响应与错误：200完整或206单段Range；HEAD同头无体；404缺条目/文件，416不可满足范围，500大小不符，503快照失败。

数据与副作用：读取索引及资产stat/文件流，类型和disposition来自索引；CSP禁止脚本，断连销毁流；多段/不识别Range回完整体；不修改快照。

验证边界：所列为纯解析、内容转换或配置测试，不是本次启动Nitro或读取真实快照的证明。

SQLite读写：无。源码：[app/forum/server/routes/api/local-forum/assets/[hash].ts](../../../app/forum/server/routes/api/local-forum/assets/[hash].ts)。验证入口：[app/forum/tests/local-snapshot.test.ts](../../../app/forum/tests/local-snapshot.test.ts)。

## 提供论坛Markdown索引

`interface:forum.llms` · `GET,HEAD /llms.txt` · `flow:forum.markdown.index`

权限与资源：匿名GET/HEAD；只拦截llms.txt；其它方法/路径交后续处理器。

响应与错误：200 text/plain UTF-8加nosniff；快照加载失败503。

数据与副作用：site构建使用siteForumState，开发快照模式读只读投影，否则进程示例种子；预渲染可落成静态文件，不动态读取核心forum_*数据库。

验证边界：所列为纯解析、内容转换或配置测试，不是本次启动Nitro或读取真实快照的证明。

SQLite读写：无。源码：[app/forum/server/middleware/forum-markdown.ts](../../../app/forum/server/middleware/forum-markdown.ts)。验证入口：[app/forum/tests/forum-markdown.test.ts](../../../app/forum/tests/forum-markdown.test.ts)、[app/forum/tests/site-state.test.ts](../../../app/forum/tests/site-state.test.ts)、[app/forum/tests/content-source.test.ts](../../../app/forum/tests/content-source.test.ts)。

## 提供话题Markdown正文

`interface:forum.topic-markdown` · `GET,HEAD /t/:id.md` · `flow:forum.markdown.topic`

权限与资源：匿名GET/HEAD；路径按TOPIC_MARKDOWN匹配，不能二次解码冒充其他路由。

响应与错误：200 text/markdown UTF-8；未知话题404 text/plain；快照失败503。

数据与副作用：与索引同源：site内容/开发快照/示例种子；不包含浏览器新写内容或实时核心数据库帖子，构建静态输出与在线核心API分别取证。

验证边界：所列为纯解析、内容转换或配置测试，不是本次启动Nitro或读取真实快照的证明。

SQLite读写：无。源码：[app/forum/server/middleware/forum-markdown.ts](../../../app/forum/server/middleware/forum-markdown.ts)。验证入口：[app/forum/tests/forum-markdown.test.ts](../../../app/forum/tests/forum-markdown.test.ts)、[app/forum/tests/site-state.test.ts](../../../app/forum/tests/site-state.test.ts)。


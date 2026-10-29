# 业务接口契约与用例

> 按真实 handler、授权执行点与存储实现核对现有接口；关联目录中的业务用例，区分存量人工说明与已挂载的机器响应契约。

状态：`current` · 更新：2026-10-28

## 口径与共同边界

本文是人工维护的行为契约，不是完整 OpenAPI。`application.cancel` 保留既有取消投递不变量，公共授权依赖与其他审核分支通过同一 PATCH 的 `application.review` 及本节追溯，不另造第二套取消规则。请求字段的机器约束仍以对应 routes 下的 contracts.ts 与 handler 为准；下文响应是源码分支的形状，未把测试入口标成每个分支均已验证。业务操作按显式非 HEAD 的方法路径计数；自动 HEAD 派生于 GET，论坛显式 HEAD /api/forum/state 另为 405，不能计为第二个业务用例。补充 Nitro 入口按声明单列。

- 核心写请求先由 middleware/http-policy.ts 校验 Origin / Fetch Metadata，外域拒绝 403 invalid_origin；缺 Origin 不自动拒绝所有非浏览器调用。输入 Schema 失败为 400 validation_error。全局错误体通常为 error、message、request_id，handler 自行 reply.send 的错误形状保留原样。
- 会话型接口读取 sessions；getSession 遇过期行会删除，不能把 GET 一律标为没有任何写入。经 http-policy 处理的会话自身令牌 401 会删当前会话、清 cookie，并仅在实际删除时写 auth.session_rejected 审计；#274 review round 1 起没有业务路由会用会话令牌调 GitHub（那条路径已删，见下方说明），这条机制只作为通用基础设施留着；其他上游 4xx 为同状态 upstream_rejected，5xx 为 internal_error。OAuth 回跳的局部 catch 另见各用例。
- /api/admin/:org/* 按称号给的能力授权（requireGithub / requireManagedOrg），URL 中 org 必须是 CONSOLE_ORG（否则 403 org_not_managed），不看调用者的 GitHub 组织角色（#262 第四期）。上游由服务器接入的 GitHub 执行：配了 GitHub App 用安装令牌，没配用调用者自己的 GitHub 会话令牌（这时还受他自己的 GitHub 权限限制）。
- 控制台能力由 sessions、users（站内角色与成员资格）、role_assignments、departments、titles 计算，不调用 GitHub；只有还没记过站内角色的老账号补记一次 GitHub 组织角色（缓存 60 秒）；权限包每次读取。不是成员的账号没有任何能力。requireCapability 的多个参数是“任一满足”，并非全部同时拥有。缺能力 403 missing_capability；部门与对象范围仍在 handler 中继续校验。
- 流程 reads/writes 包含授权依赖与可能的条件写入，不能据数组推断每次请求都会写。forumViewer 对有效成员创建或刷新 forum_users，游客不写成员记录。外部 HTTP、文件读取、缓存和通知等副作用在各用例文字中明确，不能假装成 SQLite 外键。
- 测试路径只表示可复查入口。GitHub 代理多数尚无逐端点成功响应测试，已有 core/upstream-errors 只覆盖通用门禁和部分错误映射；Nitro 的纯函数/配置测试不等于启动服务器验证。

## 基础设施、退役路径与 HEAD 继承

当前隔离注册清单合计 **188 条方法路径**：103 个显式非 HEAD 业务操作（下文逐项说明）+ 24 个显式非 HEAD 退役项 + 4 个基础设施 GET + 56 个自动 HEAD + 1 个显式 HEAD。另有 5 个 Nitro/预渲染声明入口，独立列于文末，不混入 Fastify 注册数。

| 清单类别 | 方法路径 / 分组 | 实际行为及边界 | 源码与已有验证入口 |
|---|---|---|---|
| 基础设施（1） | `GET /healthz` | 200 `{ok:true,ts:Date.now()}`；handler 不查询数据库或外部依赖，因此不是全链路健康证明。 | [app.ts](../../../app/server/src/app.ts)，[catalog.test.ts](../../../tests/server/catalog.test.ts) |
| 基础设施（1） | `GET /` | 仅静态根目录不存在或明确 `staticRoot:false` 时注册占位响应：200 `{ok:true,note:"app/web/dist and app/console/dist not built yet"}`。目录工具关闭静态托管，故本次清单包含这一项。 | [app.ts](../../../app/server/src/app.ts)，[core.test.ts](../../../tests/server/core.test.ts) |
| 基础设施（2） | `GET /forum`、`GET /forum/*` | 直连核心服务时：production 为503 `{error:"forum_service_not_ready",message}`；开发为302到 `http://127.0.0.1:3456/`。正常 Docker 入口由 web 反代论坛，这两个 handler 不证明已配置反代。 | [app.ts](../../../app/server/src/app.ts)，[core.test.ts](../../../tests/server/core.test.ts) |
| 退役（24） | `/api/forum`、`/api/forum/*`、`/auth/forum/*`、`/forum/u/*` 各自的 `GET`、`POST`、`PUT`、`PATCH`、`DELETE`、`OPTIONS` | 共用 retired handler，410 `{error:"legacy_forum_retired",message}`，不映射或写入旧论坛。先匹配现有具体论坛接口，再由通配路径接住剩余请求；共同写请求Origin校验可能先回403。 | [app.ts](../../../app/server/src/app.ts)，[core.test.ts](../../../tests/server/core.test.ts) |
| 自动 HEAD（54） | 清单中 `registration: automatic-head` 的所有项 | 按相同 path 找对应 `GET`，继承其状态码、响应头、鉴权、限流和 handler 行为，最终不发送body。不会因为没有body就跳过会话处理、上游查询、投递查看/导出审计等副作用。4个基础设施和4个退役GET的HEAD也包含在54内。 | [目录注册观测](../../../scripts/catalog/collect.ts)，[project-catalog.test.ts](../../../tests/tooling/project-catalog.test.ts)；各GET的行为验证见各用例 |
| 显式 HEAD（1） | `HEAD /api/forum/state` | 405、`Allow: GET`、空体；单独handler不计算整份state，不花GET的120次额度，不调用forumViewer刷新用户。 | [topics.ts](../../../app/server/src/routes/forum-api/topics.ts)，[forum.test.ts](../../../tests/server/forum.test.ts) |

自动 HEAD 规则只适用于清单实际注册的56项，不能对所有GET自行补造。例如论坛 state、search、topic posts 显式关闭自动HEAD；state另有上述405处理器，其他未单独注册的HEAD仍受实际路由匹配和退役通配项约束。HEAD是读取方法，不经过核心写请求Origin门禁，但对应GET的会话、能力及资源范围校验仍有效。

有静态产物的模式另经 `@fastify/static` 和 app.ts 的 not-found handler：API/auth/healthz未知路径、含扩展名的缺失资源及非GET/HEAD请求为404；其他GET/HEAD按路径回控制台或官网SPA，并设no-cache。该模式的静态文件枚举不属于这188条关闭静态托管的隔离基线，也不由此文档声称已部署。

## 发起 GitHub 登录

`GET /auth/github` · `flow:identity.authorize`

权限与资源：匿名可发起；return_to仅接受PUBLIC_ORIGIN，否则回控制台；邀请码选填（#274 SPEC §3.2），query 带的 `invite` 格式不对直接丢弃，不报错，留给回调时再校验真假；按 IP 每分钟 20 次限流（#274 review round 1 SPEC §3.8，和 `/auth/google` 一样）。

响应与错误：302跳到GitHub授权地址。

数据与副作用：生成随机state并写签名oauth_state cookie（校验过格式的邀请码一并存入），不创建会话；本次响应不向GitHub发送token交换请求。

本地表读取：无。本地表写入：无。

源码：[app/server/src/routes/admin/auth.ts:40](../../../app/server/src/routes/admin/auth.ts#L40)。验证入口：[tests/server/core.test.ts](../../../tests/server/core.test.ts)。

## 列出本站启用的登录方式

`GET /auth/providers` · `flow:identity.providers`

权限与资源：匿名可读，不读会话、不需要能力。

响应与错误：200 {providers:[...]}，按GitHub、Google、邮箱的顺序，每项含id、name、kind、start、can_register，邮箱另有password；GitHub恒在（kind=redirect，start=/auth/github）；Google只在配了GOOGLE_CLIENT_ID与GOOGLE_CLIENT_SECRET时出现（kind=redirect，start=/auth/google）；邮箱只在配了发信商时出现（kind=email_code，start=/auth/email/start，password=/auth/email/password）。三种的can_register都是true：三种第一次登录都不用邀请码就能注册成注册用户（`level.registered`），邀请码选填，有效邀请码直接进极客班成员（`level.member`）；GitHub 那道「要是组织成员」的门已经去掉（#274 SPEC §3.2）。响应Schema固定字段。

数据与副作用：只读进程内的配置，不读写数据库、不请求GitHub或Google。

本地表读取：无。本地表写入：无。

源码：[app/server/src/routes/identity/providers.ts:23](../../../app/server/src/routes/identity/providers.ts#L23)。验证入口：[tests/server/identity.test.ts](../../../tests/server/identity.test.ts)。

## 命令行申请设备授权码（RFC 8628）

`POST /auth/device/code` · `flow:identity.device.code`

权限与资源：匿名；只有登记过的公开客户端geek-cli能发码，scope只认openid、profile；每分钟10次。

响应与错误：200 {device_code,user_code,verification_uri,verification_uri_complete,expires_in=600,interval=5}，user_code显示为XXXX-XXXX，verification_uri是<PUBLIC_ORIGIN>/device，Cache-Control: no-store；未登记客户端400 invalid_client，未知scope400 invalid_scope。

数据与副作用：写一行pending的device_grants，device_code只存sha256；顺手删掉过期超过一天且令牌已失效的旧行；不读会话、不请求GitHub。表单（application/x-www-form-urlencoded）与JSON都收。

本地表读取：无。本地表写入：device_grants。

源码：[app/server/src/routes/identity/device.ts:33](../../../app/server/src/routes/identity/device.ts#L33)、[app/server/src/lib/device-store.ts](../../../app/server/src/lib/device-store.ts)（`createGrant`）。验证入口：[tests/server/device-flow.test.ts](../../../tests/server/device-flow.test.ts)。

## 命令行轮询设备授权，批准后换一次性访问令牌

`POST /auth/device/token` · `flow:identity.device.token`

权限与资源：匿名，凭device_code与发码时相同的client_id；每分钟60次。

响应与错误：按RFC 8628 §3.5回400 authorization_pending、slow_down（轮询间隔加5秒写回）、access_denied（用户拒绝或账号不是active）、expired_token、invalid_grant（不存在或已换过令牌）、invalid_client、unsupported_grant_type；批准后200 {access_token,token_type:Bearer,expires_in=2592000,scope,account_id}，Cache-Control: no-store。

数据与副作用：判定顺序是invalid_grant（已换过令牌）、invalid_client、access_denied（已拒绝）、expired_token，pending再判slow_down并记last_poll_at，approved才发令牌；换令牌在一个BEGIN IMMEDIATE事务里，令牌只签发一次，库里只存sha256与到期时间，明文只在这条响应里。

本地表读取：device_grants、users、identities。本地表写入：device_grants。

源码：[app/server/src/routes/identity/device.ts:57](../../../app/server/src/routes/identity/device.ts#L57)、[app/server/src/lib/device-store.ts](../../../app/server/src/lib/device-store.ts)（`poll`）。验证入口：[tests/server/device-flow.test.ts](../../../tests/server/device-flow.test.ts)。

## 确认页按 user_code 读一次设备授权

`GET /api/identity/device` · `flow:identity.device.view`

权限与资源：要极客班会话（requireAuth），不要控制台能力；每分钟30次，user_code空间有限，查询也限流。

响应与错误：200 {user_code,client_id,client_name,scope,status,expires_at}，status是pending、approved、denied、consumed或expired；user_code不合法或不存在404 device_code_not_found；没登录401。

数据与副作用：只读，不改状态、不续期；不返回device_code与令牌。user_code输入对大小写、连字符和空格不敏感。

本地表读取：device_grants。本地表写入：无。

源码：[app/server/src/routes/identity/device.ts:91](../../../app/server/src/routes/identity/device.ts#L91)、[app/server/src/lib/device-store.ts](../../../app/server/src/lib/device-store.ts)（`describe`）。验证入口：[tests/server/device-flow.test.ts](../../../tests/server/device-flow.test.ts)、[tests/console/device.test.ts](../../../tests/console/device.test.ts)。

## 登录的人允许或拒绝一次设备授权

`POST /api/identity/device/approve` · `flow:identity.device.approve`

权限与资源：要极客班会话，且持有 `account.cli.login`（#274 SPEC §3.6，`level.registered` 就有，访客没有会话自然也没有）；授权绑定到会话的account_id（极客班账号，不是GitHub id）；每分钟20次；跨站写入受共同Origin校验与SameSite=Lax会话Cookie限制。

响应与错误：200 {ok:true,status:approved|denied}；没有会话401 not_signed_in；没有 `account.cli.login`403 {error:forbidden,node:"account.cli.login"}；不存在404 device_code_not_found；不是pending或已过期409 device_code_not_pending；decision不合法400 invalid_decision；允许时账号还没有登录邮箱（这个环境能发信）403 email_required，还没填真实姓名或年级 403 profile_required（#280），拒绝不拦（#273）。

数据与副作用：条件UPDATE只改pending且未过期的行，并发的确认只有一次生效；拒绝不写account_id；写操作记录（activity_events）的identity.device.approve或identity.device.deny，只含client_id与scope，不含device_code与令牌。

本地表读取：device_grants, perm_members, perm_entries。本地表写入：device_grants、activity_events。

源码：[app/server/src/routes/identity/device.ts:102](../../../app/server/src/routes/identity/device.ts#L102)、[app/server/src/lib/device-store.ts](../../../app/server/src/lib/device-store.ts)（`decide`）。验证入口：[tests/server/device-flow.test.ts](../../../tests/server/device-flow.test.ts)。

## 命令行凭设备令牌读极客班账号（OpenID）

`GET /auth/device/userinfo` · `flow:identity.device.userinfo`

权限与资源：只认Authorization: Bearer <access_token>（geek login换到的gk_…令牌），不读cookie、不要会话；#277起这个令牌不止在这个接口有效，`middleware/bearer-auth.ts`把它接到了`geek-cli`申请过scope（`forum apply competition repo`）的那些业务接口上，响应形状不变。

响应与错误：200 {sub,account_id,login,username,display_name,bio,avatar_url,scope,grade,grade_label,email_required,profile_required}，sub与account_id都是极客班账号；email_required、profile_required 同 /auth/me，命令行读到 true 就提示先到网页上绑邮箱、补姓名和年级（#280）；grade/grade_label 是年级展示用（按入学年份现算），不回真实姓名——命令行在这个接口和它接到的任何业务接口上都拿不到任何账号的 real_name，哪怕是本人（#277 的硬约束）；令牌缺失、不存在、过期或账号不是active时401 invalid_token，并带WWW-Authenticate: Bearer error="invalid_token"。

数据与副作用：按令牌的 sha256 查行、读 users/identities 保留 login；公开字段来自 account_profiles 经 public-profile 映射，空昵称回退 login，上传头像优先且可为本站相对路径。当前账号的 profiles.get() 可能兜底建档，不能称绝对只读；批量历史作者投影另走只查已有行的 findMany。不记录令牌明文。

本地表读取：device_grants、users、identities、account_profiles。本地表写入：account_profiles（仅本人缺行时兜底建档）。

源码：[app/server/src/routes/identity/device.ts:125](../../../app/server/src/routes/identity/device.ts#L125)、[app/server/src/lib/device-store.ts](../../../app/server/src/lib/device-store.ts)（`authenticate`）。验证入口：[tests/server/device-flow.test.ts](../../../tests/server/device-flow.test.ts)。

## 命令行撤销设备令牌（geek logout，#277）

`POST /auth/device/revoke` · `flow:identity.device.revoke`

权限与资源：只认Authorization: Bearer <access_token>，不读cookie、不要会话；每分钟30次。

响应与错误：200 {ok:true}，即便令牌缺失、不存在、已经撤销或已经过期也一样（RFC 7009的惯例，不回答「这个令牌是否存在过」）。

数据与副作用：按令牌的sha256查status=consumed且未过期的行，把token_expires_at改成当前时间（和自然过期走同一条判定，authenticate()不用再认一个新状态）；真的撤销成功才记一条操作记录identity.device.revoke（surface:'cli'），不记明文令牌。

本地表读取：device_grants。本地表写入：device_grants、activity_events（仅撤销成功时）。

源码：[app/server/src/routes/identity/device.ts](../../../app/server/src/routes/identity/device.ts)（`POST /auth/device/revoke`）、[app/server/src/lib/device-store.ts](../../../app/server/src/lib/device-store.ts)（`revoke`）、[app/server/src/middleware/bearer-auth.ts](../../../app/server/src/middleware/bearer-auth.ts)。验证入口：[tests/server/bearer-auth.test.ts](../../../tests/server/bearer-auth.test.ts)。

## 命令行查我自己的投递状态（geek apply status，#277）

`GET /api/me/applications` · `flow:application.my_status`

权限与资源：要求登录（`requireAuth`，cookie 或 Bearer 会话都行）；geek 命令行令牌还要带 `apply` scope（`middleware/bearer-auth.ts` 的 `SCOPE_BY_PREFIX`，没有回 403 `insufficient_scope`）。

响应与错误：200 {applications:[{id,status,created_at}]}，没有失败分支（登录和 scope 不够都在上一步被挡住）；不回姓名、班级、邮箱、特长——命令行拿不到这些字段，和拿不到 `real_name` 是同一条边界。

数据与副作用：只读；`applications` 表没有 `account_id`，按账号已绑定的登录邮箱（`identities` 表 `provider='email'` 的全部行，绑定时已经用 `normalizeEmail()` 存成小写）去配 `applications.email`（投递时原样保存大小写，这里按小写比较），一个账号没绑过邮箱直接回空列表；绑了多个邮箱时合并去重，按 `created_at` 倒序。

本地表读取：identities、applications。本地表写入：无。

源码：[app/server/src/routes/portal/my-applications.ts](../../../app/server/src/routes/portal/my-applications.ts)。验证入口：[tests/server/my-applications.test.ts](../../../tests/server/my-applications.test.ts)。

## 邮箱、Google 登录、账号页与注册邀请码（#262 第二、三期；资料/头像/邀请码兑换见 #274）

邮箱验证码和密码都能登录。GitHub、邮箱、Google 三种登录方式第一次登录都不用邀请码就能注册——邀请码选填（#274 SPEC §3.2，GitHub 组织资格那道门已经去掉）：不填或邀请码无效仍然注册成功，`org_state` 记 `not_member`、进 `level.registered`；邀请码有效时 `org_state` 记 `active`、直接进 `level.member`（默认邀请码只存在运维的钥匙串里，用 `dist/cli/account.js invite` 写进库，控制台邀请码页也能建）。权限只认极客班账号：不论用哪种方式登录，成员资格（`level.*`）与权限节点都按账号记下的给，不查、也不会再查 GitHub 组织角色（#274 review round 1 blocker，见上方「发起 GitHub 登录」一节）。以下接口都挂了响应 Schema；失败体保留 `attempts_left`、`retry_after`、`reauth`、`capability` 等扩展字段。

| 接口 · 流程 | 权限与资源 | 响应、错误与副作用 |
|---|---|---|
| `POST /auth/email/start` · `flow:identity.email.start` | 匿名；每分钟 10 次（按 IP）；同一邮箱 60 秒一封、每小时 5 封，同一 IP（IPv6 按 /64）每小时 20 封，计数存在 `email_challenges`，重启不清零 | 202 `{resend_after:60}`，写签名、HttpOnly 的 `email_challenge` cookie（path=/auth/email，10 分钟）；有没有账号响应都一样，没有账号的邮箱也真的发（填邀请码就能注册）。body 可带 `purpose:"reset"`（忘了密码，#273）：只把信换成「你的极客班重设密码验证码」，挑战还是登录用的那一种。邮箱格式不对 400 `bad_email`；太频繁 429 `rate_limited`，带 `Retry-After` 与 `retry_after`。只存验证码的 HMAC，这个浏览器上一次的码作废（别人替这个邮箱要码不影响本人手上的码）；信由 `mail.sendNow` 直接发，不进 `mail_outbox`，日志不记地址和验证码。 |
| `POST /auth/email/verify` · `flow:identity.email.verify` | 匿名，凭挑战 cookie；每分钟 30 次；同一个码最多错 5 次 | 200 `{return_to,registered}` 并写 `sid`；验证码不对 400 `invalid_code`（带 `attempts_left`），过期、用过或错满 5 次 400 `code_expired`；没有账号时不填 `invite_code` 就注册成注册用户，不是错误（#274 SPEC §3.2）；这个邮箱还没有账号、这次要注册时：填了 `invite_code`（会成为成员）就要同时带 `real_name` 和 `grade`（1–4 或 `graduated`），没填邀请码可以都不带，带了一项就两项都要（所有者 2026-10-24 22:05：只有极客班成员要填），缺了 400 `real_info_required`，姓名不对 400 `bad_real_name`，这两种都在核对验证码之后、占用之前回，验证码和邀请码都不作废，注册成功后写进 `account_profiles`；已有账号的登录不看这两项（#280：要不要注册在核对验证码之后才知道，所以 JSON Schema 不标必填）；邀请码不对 400 `invite_invalid`，同时记一次错（验证码不作废，还能再试）；真的要新建账号这一步，同一 IP 今天已建满 5 个、同一设备（`yugc_vid`）已建满 3 个，429 `{error:"rate_limited",bucket:"auth.register.daily",retry_after}`（#274 残留修复，SPEC §3.8，登录到已有账号不受影响）；账号停用 403 `account_disabled`。建号、兑换邀请码、占用验证码、建会话（provider=email）、删旧会话、写 `identity_audit` 与 `auth.register`/`auth.signin` 在一个 `BEGIN IMMEDIATE` 事务里，任何一步不成整体回滚。 |
| `POST /auth/email/password` · `flow:identity.email.password` | 匿名；每分钟 10 次（按 IP），另按邮箱 15 分钟 10 次 | 200 `{return_to}` 并写 `sid`；没账号、没设密码、密码不对一律 400 `invalid_credentials`，没有账号时也跑一次 bcrypt，响应时间不泄露邮箱是否注册；按邮箱超次数 429 `rate_limited`；停用 403 `account_disabled`。会话 provider=email。 |
| `POST /auth/email/reset` · `flow:identity.email.reset` | 匿名，凭 `/auth/email/start` 发的挑战 cookie；每分钟 10 次；同一个码最多错 5 次（#273，忘了密码） | body `{code,password}`；200 `{return_to}` 并写 `sid`（provider=email）。先看新密码：不到 8 位 400 `password_too_short`、超过 72 字节 400 `password_exceeds_bcrypt_limit`，这时不碰验证码；验证码不对 400 `invalid_code`（带 `attempts_left`），过期、用过或错满 400 `code_expired`；邮箱没有账号时不能顺手注册，回 400 `no_account`（不注册，验证码不作废，登录页转到「注册」）；停用 403 `account_disabled`。占用验证码、建会话、删旧会话、写 `users.password_hash`、`identity_audit`（`login` 与 `password_reset`）、审计 `auth.signin`（method=reset）与 `account.password`（action=reset）在一个 `BEGIN IMMEDIATE` 事务里；成功后这个邮箱的密码错误计数清零。 |
| `GET /auth/google` · `flow:identity.google.start` | 匿名；每分钟 20 次（按 IP）；没配凭据时 404 `provider_not_enabled` | 302 到 Google 授权页（openid email profile，带 state、nonce 与 PKCE S256）；state、nonce、verifier、return_to 和 `invite`（选填，#274 SPEC §3.2）存进签名 cookie `google_oauth_state`。 |
| `GET /auth/google/callback` · `flow:identity.google.callback` | 每分钟 10 次（按 IP）；state 与签名 cookie 相符；ID Token 用 Google JWKS 验签（RS256），核对 iss、aud、exp、nonce；按 Google `sub` 认人，不按邮箱合并账号 | cookie 的 `kind` 是 `google-link`（`POST /api/identity/link` 发起）时是绑定，不登录、不建号、不换会话：当前会话必须还是发起绑定的那个（账号和会话指纹都相符），否则不绑；绑上写 `identities`、`identity_audit`（`link`）与 `activity_events`（`auth.link`，只记 `provider`，不记 `sub` 和邮箱），Google 账号已属于别的账号写 `identity_audit`（`link_conflict`）、不改任何数据；结果一律 302 回发起时的页面 `?link=<linked|conflict|exists|cancelled|failed>&provider=google`（授权期间换了账号或重新登录算 `failed`），失败不去登录页（#291）。登录时成功 302 回 `return_to`，账号还没有登录邮箱、这个环境又能发信时改为 302 到 `/bind-email?return_to=<原路径>`（#273，Google 给的邮箱不算登录邮箱），邮箱有了但还没填真实姓名或年级时改为 302 到 `/complete-profile?return_to=<原路径>`（#280）；没有账号时不带邀请码也注册成功，不是错误；取消、上游失败、邀请码无效、Google 邮箱已属于别的账号、停用、真的要新建账号这一步同一 IP 今天已建满 5 个或同一设备已建满 3 个（#274 残留修复，SPEC §3.8，登录到已有账号不受影响）时 302 到 `/signin?signin=<cancelled|failed|invite_invalid|email_taken|account_disabled|registration_limited>&provider=google&return_to=<原路径>`；缺参数或 state 无效 400。外部请求在事务外，建号与会话同上一个事务；日志不输出令牌。 |
| `POST /api/identity/link` · `flow:identity.account.link` | 有效会话，这次登录不超过 10 分钟（geek 命令行令牌不算）；每账号每分钟 10 次；没配 Google 凭据时 404 `provider_not_enabled` | body `{provider:"google",return_to?}`（`provider` 只认 `google`，别的值 400）；200 `{authorize_url}`，写签名、HttpOnly 的 `google_oauth_state` cookie（path=/auth/google，10 分钟，`kind:"google-link"`，带账号 id 与会话指纹），`return_to` 只收本站地址、缺省 `/account`；超过 10 分钟 403 `step_up_required`；本账号已绑 Google 409 `identity_exists`，不去 Google。这个接口不绑定，只记下「给哪个账号、哪个会话绑」；真正的绑定在 `/auth/google/callback`（#291）。 |
| `GET /api/identity/me` · `flow:identity.account.view` | 任何有效会话，不要控制台能力 | 200 `{account_id,login,identities,has_password,password_updated_at,membership{state,org_role,via_invite},created_at,recent,available,email_required,real_name,grade,grade_label,profile_required,session{provider,created_at,expires_at,step_up_until}}`；`email_required`（#273）是账号还没有邮箱登录方式、这个环境又能发信，绑定邮箱页 `/bind-email` 读它；实名资料四项同 `/auth/me`（#280），补资料页 `/complete-profile` 读它；邮箱只给打码后的样子，每个邮箱另带身份 `id`（删邮箱用）和 `primary`（主邮箱，排在别的邮箱前面，#272）；`recent` 是本人最近 20 条 `identity_audit`；`available` 只可能是 `["email"]` 或 `[]`：发信打开、还不到 5 个邮箱时是 `["email"]`，满了或发信关着时是 `[]`（GitHub、Google 的绑定没做，不列）。没登录 401。只读。 |
| `POST /api/identity/email/start` · `flow:identity.account.email.start` | 有效会话，这次登录不超过 10 分钟；每分钟 10 次，发码限额同登录 | 202 `{resend_after:60}`，挑战绑定这个账号与这次会话，cookie path=/api/identity/email；一个账号最多 5 个邮箱（#272），这个邮箱已经绑在本账号上 409 `identity_exists`、已经有 5 个 409 `email_limit`，都不发信；超过 10 分钟 403 `step_up_required`（带 `reauth.return_to:"/account"`）；400 `bad_email`；429 `rate_limited`。 |
| `POST /api/identity/email/verify` · `flow:identity.account.email.verify` | 同一会话 | 200 `{ok:true}`；换了账号或会话、过期 400 `code_expired`；码不对 400 `invalid_code`；邮箱已属于别的账号 409 `identity_conflict`；已经绑在本账号上 409 `identity_exists`；已经有 5 个 409 `email_limit`。占用验证码、插入邮箱身份、写 `identity_audit` 在一个事务里；账号还没有主邮箱时这个就是主邮箱（`canonical_email`）。 |
| `POST /api/identity/email/remove` · `flow:identity.account.email.remove` | 有效会话，这次登录不超过 10 分钟；每分钟 10 次 | 200 `{ok:true}`：body `{identity_id}`（`GET /api/identity/me` 给的邮箱 `id`），删掉这个邮箱，之后不能再用它登录，下一轮 GitLab 同步从 GitLab 上删掉（#272）；主邮箱 409 `primary_email`，不是本账号的邮箱 404 `not_found`；超过 10 分钟 403 `step_up_required`。删身份、写 `identity_audit`（`unlink`）与 `identity.unlink` 在一个事务里，用这个邮箱登录的会话不动。 |
| `POST /api/identity/real-info` · `flow:identity.account.real_info` | 有效会话，不要控制台能力；每分钟 10 次 | body `{real_name,grade}`：`real_name` 先做 NFC 归一、去首尾空白、连续空白并成一个，2–32 个字，只能是文字、空格和「·」，不对 400 `bad_real_name`；`grade` 只能是 1–4 或 `graduated`（已毕业，存成五年前入学），不对 400；按北京时间的学年换算成入学年份存进 `account_profiles.enrollment_year`。只补还缺的那一项，已有的不覆盖；两项都已经有了 409 `real_info_locked`（本人不能再改，找有 `users.manage` 的管理员）。200 `{real_name,grade,grade_label,profile_required}`。写操作记录 `account.real_info`，`meta` 只有 `{filled,grade}`，不含姓名。 |
| `POST /api/identity/password` · `flow:identity.account.password` | 有效会话，账号已绑邮箱；每分钟 10 次 | 200 `{ok:true}`；没绑邮箱 409 `email_required`；不到 8 位 400 `password_too_short`，超过 72 字节 400 `password_exceeds_bcrypt_limit`；已有密码且登录超过 10 分钟时要 `current_password`，不对 400 `invalid_credentials`，没填 403 `step_up_required`；没有密码又超过 10 分钟 403 `step_up_required`。bcrypt cost 12，写 `users.password_hash` 与 `identity_audit`（`password_set` 或 `password_change`）。 |
| `GET /api/console/invites` · `flow:identity.invites.list` | `accounts.invites.manage`（提督默认有）；只看身份与称号，不调用 GitHub | 200 `{invites:[{id,code,note,max_uses,used_count,expires_at,disabled,created_by,created_at,updated_at,usable}]}`；401、403 `missing_capability`。只读。 |
| `POST /api/console/invites` · `flow:identity.invites.create` | 同上；每分钟 30 次 | 201 邀请码一行；邀请码 4–40 位字母、数字、`_`、`-`，存小写，重复 409 `invite_code_taken`，其他不合格 400；写 `invite.create` 审计。 |
| `PATCH /api/console/invites/:id` · `flow:identity.invites.update` | 同上；每分钟 30 次 | 200 邀请码一行；只改 note、max_uses、expires_at、disabled，邀请码本身不能改、不能删；没有这一行 404 `not_found`；有改动才写 `invite.update` 审计（记改了哪些字段）。 |
| `GET /api/identity/profile` · `flow:identity.profile.view` | 有效会话；不要控制台能力 | 200 `{username,display_name,bio,avatar_url,prefs}`；账号第一次读时由 `account_profiles` 兜底建一行（用户名按账号 id 派生，小写），不是 500。没登录 401 `not_signed_in`。只读。 |
| `PATCH /api/identity/profile` · `flow:identity.profile.update` | 需要 `account.profile.edit`；每账号每小时 30 次 | body 任选 `{display_name(1–32),bio(0–200),username(3–24，`^[a-z0-9_]+$`，不分大小写唯一),prefs:{start_note_seen_at,forum_theme}}`，回同 GET 形状；`prefs` 是合并写，不是整份替换；`username` 已被别的账号占用（不分大小写）409 `username_taken`，改回自己原来的名字不算占用。写 `account_profiles` 与审计 `profile.update`。 |
| `GET /api/identity/avatar/:file` · `flow:identity.avatar.read` | 匿名；`:file` 必须是 `^[0-9a-f]{64}\.webp$` | 200 `image/webp` 二进制，`Cache-Control: public, max-age=31536000, immutable`、`Content-Security-Policy: default-src 'none'`；哈希不存在 404。只读 `account_avatars`。 |
| `PUT /api/identity/avatar` · `flow:identity.avatar.upload` | 需要 `account.profile.edit`；每账号每小时 10 次 | 请求体就是图片本身（png/jpeg/webp/gif，≤2MB，像素 ≤4096×4096），sharp 转正方形 512×512 webp 后按内容 sha256 寻址存 `account_avatars`，回 `{avatar_url}`；类型不支持 415，字节解不出图片 400 `invalid_image`，超过像素上限 400 `image_too_large`，超过 2MB 由内容类型解析器直接 413 `avatar_too_large`。写 `account_profiles.avatar_hash` 与审计 `profile.avatar`。 |
| `POST /api/identity/invite/redeem` · `flow:identity.invite.redeem` | 需要 `account.invite.redeem` | body `{code}`；成功 200 `{level:"member"}`，把账号换成 `level.member`（事务里先查重、兑换邀请码、换组、提交后再让权限引擎的 revision 失效）；码不对或已用完 400 `invite_invalid`（计一次失败）；已经是成员 409 `already_member`；本账号过去一小时错够 10 次或本 IP（IPv6 按 /64）错够 20 次时 429 `{error:"rate_limited",bucket:"invite.redeem.fail.account"或"invite.redeem.fail.ip"}`（#274 review round 1，取代旧的 `invite_locked`，和通用错误码约定一致），带 `Retry-After` 与 `retry_after`（锁 1 小时），不再往下核对邀请码本身；这两个桶和 GitHub/Google/邮箱注册时填错邀请码共用同一套常量（`lib/identity-store.ts` 的 `INVITE_LOCK_*`/`hashIp`），猜码次数合并计。写 `perm_members`、`invite_codes`、`limit_events`（失败计次，按 `invite.redeem.fail.account`/`invite.redeem.fail.ip` 两个桶，IP 只存 sha256）与审计 `invite.redeem`。 |

本地表：邮箱登录读写 `email_challenges`、`users`、`identities`、`invite_codes`、`sessions`、`identity_audit`、`activity_events`；账号页读 `users`、`identities`、`identity_audit`，删邮箱时删 `identities`，写 `email_challenges`、`identities`、`users`、`identity_audit`；邀请码页读写 `invite_codes`，写 `activity_events`；账号资料与头像（#274）读写 `account_profiles`、`account_avatars`，邀请码兑换另外读写 `perm_members`、`limit_events`。

没有登录邮箱的账号（#273，所有者 2026-10-23 19:22：「之前只绑定了github账号没有绑定邮箱的再次进来或者登录的时候必须绑定邮箱」）：判定在 [lib/email-gate.ts](../../../app/server/src/lib/email-gate.ts)，只在这个环境能发信时要求。GitHub、Google 登录回调跳绑定邮箱页，对外授权的交互入口与同意页、设备授权的允许在服务端拦，`/auth/me`、`/api/identity/me`、`/api/console/me` 的 `email_required` 交给官网、论坛、控制台自己跳。

源码：[routes/identity/email.ts](../../../app/server/src/routes/identity/email.ts)、[routes/identity/google.ts](../../../app/server/src/routes/identity/google.ts)、[routes/identity/account.ts](../../../app/server/src/routes/identity/account.ts)、[routes/identity/profile.ts](../../../app/server/src/routes/identity/profile.ts)、[routes/console/invites.ts](../../../app/server/src/routes/console/invites.ts)、[lib/email-gate.ts](../../../app/server/src/lib/email-gate.ts)、[lib/email-login.ts](../../../app/server/src/lib/email-login.ts)、[lib/google.ts](../../../app/server/src/lib/google.ts)、[lib/invite-codes.ts](../../../app/server/src/lib/invite-codes.ts)、[lib/identity-store.ts](../../../app/server/src/lib/identity-store.ts)、[lib/account-profiles.ts](../../../app/server/src/lib/account-profiles.ts)、[lib/account-avatar.ts](../../../app/server/src/lib/account-avatar.ts)。验证入口：[tests/server/signin-methods.test.ts](../../../tests/server/signin-methods.test.ts)、[tests/console/signin.test.ts](../../../tests/console/signin.test.ts)、[tests/console/account.test.ts](../../../tests/console/account.test.ts)、[tests/server/profile.test.ts](../../../tests/server/profile.test.ts)。

## 对外授权（OIDC）与 GitLab 账号同步（GitLab 历史 #270）

GitHub #271 回归后的成员口径：active 账号的当前有效直接 level.member/level.alumni（NULL 或 expires_at > now）；owner-only 不代替该资格，旧 org_state/org_role 不授权。合法 alumni 可登录；其中当前有效直接 owner 为 admin/Owner 50，否则 member/Developer 30，owner 到期但 alumni 仍有效时降权而不封禁。member/alumni 到期或停用时 OIDC userinfo 401，GitLab 由下一轮同步封禁，不重建 sub/provider/GitLab id。name/picture 从统一公开资料映射，preferred_username 仍用 login；本节旧 #271（头像）/#272（邮箱）均为 GitLab 历史任务，不是当前 GitHub 同号范围。

同步防误封：每轮核验已有 sub 的远端受管绑定、管理员/服务账号保护及实际 active/blocked 状态；未知 HTTP/超时/429/5xx、身份失配、详情/分页不完整均不写远端。明确不再有资格的受管账号仍封禁，写前资格变动则同锁重算；详情错误在 200 响应的 error/last_error 返回，见 [OIDC 防误封合同](oidc.md#防误封与失败闭合github-271)。

不同源的应用（第一个是自建 GitLab）用极客班账号登录：核心服务内嵌的 OpenID Connect 签发者挂在 `/oidc/*`，签发者 `<PUBLIC_ORIGIN>/oidc`；没配 `OIDC_JWKS` 时下面 6 个 `/oidc` 操作照样注册，请求一律 404。协议细节、客户端登记和 GitLab 一侧的配置见 [对外授权与 GitLab 账号同步](oidc.md)。交互接口按核心写请求的 Origin 门禁处理；协议端点由下游服务器调用，不带 Origin。

| 接口 · 流程 | 权限与资源 | 响应、错误与副作用 |
|---|---|---|
| `GET /oidc/*` · `flow:identity.oidc.protocol` | 匿名或带 `sid`；按 IP 每分钟计数，发现文档、JWKS、userinfo 与 `POST /oidc/*` 合计 600 次，授权端点另计 120 次；授权端点只认登记过的 `client_id` 和完全一致的回调地址，PKCE 必须 `S256` | 原样交给 `oidc-provider`：发现文档、JWKS（只有公钥）、授权端点、userinfo。授权端点按本站 `sid` 判断是否登录：`sid` 账号与签发者会话一致且仍是成员时直接 303 回下游带 `code`，否则 303 到 `/oidc/interaction/<uid>`；未知客户端、错回调不跳转，回 400 的 HTML 错误页。读写 `oidc_payloads`，首次给某 sector 的账号写 `oauth_subjects`。 |
| `POST /oidc/*` · `flow:identity.oidc.token` | 下游服务器凭 `client_secret_basic` 或 `client_secret_post`；与发现文档、JWKS、userinfo 合计每个 IP 每分钟 600 次 | 换令牌 200 `{access_token,id_token,token_type,expires_in,scope}`（不发 refresh token）；客户端认证失败 401 `invalid_client`，授权码过期、用过或 PKCE 不对 400 `invalid_grant`；授权码重放时撤销这份授权和它发出的令牌。userinfo 对已停用或不再是成员的账号 401。另有 `POST /oidc/token/revocation`。读写 `oidc_payloads`，读 `oauth_clients`、`oauth_subjects`、`users`。 |
| `GET /oidc/interaction/:uid` · `flow:identity.oidc.interaction` | 浏览器；每分钟 30 次；交互按签名 cookie `oidc_interaction` 找，不认就回 400 HTML 错误页 `session_not_found` | 没 `sid` 303 到 `/signin?return_to=/oidc/interaction/<uid>`；账号不是成员时 303 回下游带 `error=access_denied`；账号还没有登录邮箱时 303 到 `/bind-email?return_to=/oidc/interaction/<uid>`（#273，绑好回到同一个交互；允许过这个应用、签发者会话还在时也先进交互，不直接发码），还没填真实姓名或年级时同样 303 到 `/complete-profile?return_to=/oidc/interaction/<uid>`（#280）；要登录时按 `sid` 账号登录（换过账号先删掉签发者里旧账号的会话），要同意时 303 到 `/authorize?uid=<uid>`。写 `oidc_payloads`。 |
| `GET /oidc/interaction/:uid/details` · `flow:identity.oidc.details` | 有效会话，且就是发起这次登录的账号；每分钟 30 次 | 200 `{client:{id,name,host},scopes,account:{login,name,picture},expires_at}`；没会话 401，账号还没有登录邮箱 403 `email_required`（#273），还没填真实姓名或年级 403 `profile_required`（#280），交互过期或客户端已停用 404 `interaction_expired`，不是要同意的交互或换了账号 409 `interaction_mismatch`。只读。 |
| `POST /oidc/interaction/:uid/confirm` · `flow:identity.oidc.confirm` | 同上；每分钟 20 次 | 200 `{redirect_to}`（浏览器去这里，由签发者 303 回下游带 `code`）；错误同 details，含 403 `email_required`、`profile_required`。保存授权（`oidc_payloads`），记进 `oauth_grants`，写审计 `oidc.consent`。 |
| `POST /oidc/interaction/:uid/abort` · `flow:identity.oidc.abort` | 同上；每分钟 20 次 | 200 `{redirect_to}`，下游收到 `error=access_denied`；错误同 details，但没有登录邮箱也能拒绝。把拒绝结果存进交互（`oidc_payloads`），写审计 `oidc.deny`。 |
| `GET /api/console/gitlab/accounts` · `flow:gitlab.accounts.list` | `gitlab.view` | 200 `{mode,gitlab_url,group,client_registered,accounts:[…]}`（`client_registered`：`gitlab` 客户端登记了没有），每行是一个极客班账号的 GitLab 用户 id、用户名、状态、组权限、最后一次错误和还要做的事（`dry-run` 时就是会做什么）；`off` 时照样列出。只读。 |
| `POST /api/console/gitlab/accounts/:account_id/resync` · `flow:gitlab.accounts.sync` | `gitlab.sync` 加 step-up；每分钟 30 次 | 200 `{mode,…这个账号同步后的状态}`；同步关着 409 `gitlab_sync_off`，没有这个账号 404 `account_not_found`。`on` 时调用 GitLab 管理接口建号、改组权限、封禁或解封、传头像（下载 GitHub 头像，#271）、同步邮箱（#272），写 `gitlab_accounts` 与审计 `gitlab.sync`，账号还没有 GitLab sector 的 `sub` 时写 `oauth_subjects`；`dry-run` 不写表、不调 GitLab。 |

本地表：签发者读 `oauth_clients`，读写 `oauth_subjects`、`oauth_grants`、`oidc_payloads`，读 `users`、`identities`、`perm_members`、`account_profiles` 拼声明，同意与拒绝写 `activity_events`；同步读 `users`、`identities`、`perm_members`、`account_profiles`、`account_avatars`，读写 `oauth_subjects`、`gitlab_accounts`，写 `activity_events`。各流程的完整读写见[项目目录](../../architecture/catalog/CATALOG.md#业务流程)。

源码：[routes/oidc/index.ts](../../../app/server/src/routes/oidc/index.ts)、[routes/console/gitlab.ts](../../../app/server/src/routes/console/gitlab.ts)、[lib/oidc-provider.ts](../../../app/server/src/lib/oidc-provider.ts)、[lib/oidc-store.ts](../../../app/server/src/lib/oidc-store.ts)、[lib/account-directory.ts](../../../app/server/src/lib/account-directory.ts)、[lib/gitlab-sync.ts](../../../app/server/src/lib/gitlab-sync.ts)。验证入口：[tests/server/oidc.test.ts](../../../tests/server/oidc.test.ts)、[tests/server/gitlab-sync.test.ts](../../../tests/server/gitlab-sync.test.ts)、[tests/console/authorize.test.ts](../../../tests/console/authorize.test.ts)。

## 校验登录回调，在一个事务里建号或找到账号并建立统一会话

`GET /auth/callback` · `flow:identity.callback`

权限与资源：state与签名cookie必须相符且未过期；按GitHub数字id匹配身份，不用会变的登录名。#274 SPEC §3.2 去掉了 GitHub 组织资格那道门：不论新用户还是老账号都不查 GitHub 组织，`/auth/github` 带来的 `invite` 选填——没有或无效仍然登录成功并建号（进 `level.registered`），有效时进 `level.member`（事务里核对、兑换，见 `lib/identity-store.ts` 的 `signInWithGithub`）。已停用的账号拒绝。

响应与错误：成功302回return_to；账号还没有登录邮箱、这个环境又能发信时改为302到<PUBLIC_ORIGIN>/bind-email?return_to=<原来要回的本站路径>，绑好再回去（#273）；邮箱有了但还没填真实姓名或年级时改为302到<PUBLIC_ORIGIN>/complete-profile?return_to=<原来要回的本站路径>，填好再回去（#280）；取消/上游失败302到<PUBLIC_ORIGIN>/signin?signin=<cancelled|failed>&return_to=<原来要回的本站路径>；邀请码无效302到同一个地址带 `signin=invite_invalid`（不建号，还能带着正确的码重新发起）；真的要新建账号这一步，同一 IP 今天已建满 5 个、同一设备（`yugc_vid`）已建满 3 个，302 到同一个地址带 `signin=registration_limited`，同样不建号、尽力撤销这次 GitHub 授权（#274 残留修复，SPEC §3.8，登录到已有账号不受影响）；账号停用302到同一个地址带 `signin=account_disabled`；原路径里残留的signin参数会去掉（#262）；缺参数或无效state为400，旧forum-state为410。`not_member`、`invite_pending` 不会再被这条流程抛出（#274：`org_state` 已弃用，见 `/auth/me` 一节）。

数据与副作用：外部请求在事务外做完；建号（邀请码选填）、刷新身份、沿merged_into走到终点、按GitHub id认领称号与论坛用户、写sessions（含openid、provider）、删请求带来的旧会话、写identity_audit与auth.signin/auth.register在一个BEGIN IMMEDIATE事务里，失败整体回滚、旧会话照常有效。邀请码无效、注册限额超了时不建会话、不建号、尽力撤销这次 GitHub 授权；停用账号同样不建会话、审计拒绝；失败日志不输出token。

本地表读取：identities, users, invite_codes。本地表写入：sessions, activity_events, users, identities, identity_audit, role_assignments, forum_users, perm_members, perm_state, invite_codes, site_owners。

源码：[app/server/src/routes/admin/auth.ts:35](../../../app/server/src/routes/admin/auth.ts#L35)、[app/server/src/lib/identity-store.ts](../../../app/server/src/lib/identity-store.ts)（`signInWithGithub`）。验证入口：[tests/server/core.test.ts](../../../tests/server/core.test.ts)、[tests/server/identity.test.ts](../../../tests/server/identity.test.ts)、[tests/server/signin-methods.test.ts](../../../tests/server/signin-methods.test.ts)。

## 退出当前会话

`POST /auth/signout` · `flow:identity.signout`

权限与资源：仅销毁cookie sid对应本站会话；允许没有会话的幂等退出，仍受共同写请求Origin校验。

响应与错误：200 {ok:true}；不向调用者泄露sid是否存在。

数据与副作用：清sid和旧forum_sid cookie；实际读取到会话才写auth.signout（带actor_account_id）和本人的identity_audit退出记录，不撤销GitHub授权。

本地表读取：sessions。本地表写入：sessions, activity_events, identity_audit。

源码：[app/server/src/routes/admin/auth.ts:94](../../../app/server/src/routes/admin/auth.ts#L94)。验证入口：[tests/server/core.test.ts](../../../tests/server/core.test.ts)、[tests/server/session-cleanup.test.ts](../../../tests/server/session-cleanup.test.ts)、[tests/server/identity.test.ts](../../../tests/server/identity.test.ts)。

## 读取统一登录状态与控制台入口

`GET /auth/me` · `flow:identity.current`

权限与资源：匿名也能读（CONTRACT-274 §1）；console_link是显示提示，不赋予后端权限。

响应与错误：没有有效会话时 200 `{signed_in:false,level,level_name,permissions,quota}`（访客身份摘要，不是401）：`level`/`level_name` 来自 `level.visitor`；`permissions` 把 `UI_NODES` 挨个判一遍，通配符已展开成具体节点的布尔值；`quota` 是投递每日额度（访客为 0）。GitHub拒绝token时 200 `{signed_in:false,session_expired:true,...访客身份摘要}`。登录了在旧字段（login、user_id、avatar_url、account_id、provider、console_link、email_required）基础上再加实名资料 `profile_required`/`real_name`/`grade`/`grade_label`（#280：`real_name` 只回本人；`grade` 是 1–4 或 `graduated`，由 `account_profiles.enrollment_year` 按北京时间的学年现算，每年 9 月 1 日升一级；`profile_required` 在成员或往届成员（`level.member`、`level.alumni`）缺姓名或年级时为 true，普通注册用户不要求，不看能不能发信）、 `level`/`level_name`/`department{id,name,tone}|null`/`titles[{id,name,department_id}]`（按账号算的权限分组，lib/permissions.ts 的 `groupsOf`）、`permissions`/`quota`（同上但按本账号判）、账号资料的 `prefs`/`username`/`display_name`/`bio`（`account_profiles`，第一次读时兜底建一行）、打码邮箱的 `identities`（`identity.accountView` 已脱敏）；其他角色查询失败仍保持登录但 `console_link` 为 false。

数据与副作用：会话联查账号，过期、没有账号（启动回填映射不到的旧会话）或账号不是active的会话按未登录处理并删除；`console_link` 仍按旧能力系统（`access.resolve`）算，还没记过站内角色的老账号用GitHub会话第一次请求时查一次GitHub组织角色并记下（这一步不影响 `level`——`level` 只认权限引擎的 `perm_members`，不读 `org_state`/`org_role`，见下方「`org_state` 已弃用」）；被拒token才删会话并写审计；无其他业务写入。

本地表读取：sessions, users, perm_members, perm_entries, account_profiles, identities。本地表写入：sessions, activity_events。

源码：[app/server/src/routes/admin/auth.ts:118](../../../app/server/src/routes/admin/auth.ts#L118)、[app/server/src/lib/permissions.ts](../../../app/server/src/lib/permissions.ts)（`groupsOf`、`check`、`meta`）、[app/server/src/lib/apply-quota.ts](../../../app/server/src/lib/apply-quota.ts)。验证入口：[tests/server/core.test.ts](../../../tests/server/core.test.ts)、[tests/server/console.test.ts](../../../tests/server/console.test.ts)、[tests/server/identity.test.ts](../../../tests/server/identity.test.ts)、[tests/server/legacy-database.test.ts](../../../tests/server/legacy-database.test.ts)。

`org_state`/`org_role` 已弃用（#274 SPEC §3.2）：GitHub 组织资格那道门已经去掉，这两列不再决定能不能登录、算不算极客班成员；只留给历史数据与控制台的旧能力系统（`access.resolve`，决定 `console_link` 与 `/api/console/*` 的能力，阶段 2 还没切换）过渡用。「是不是成员」统一看权限引擎的 `level.member` 组（`perm_members`），`GET /auth/me` 的 `level`、对外授权（OIDC、GitLab 同步）与比赛报名/组队的鉴权都读它，不读 `org_state`。

## 解析本人控制台身份

`GET /api/console/me` · `flow:console.identity`

权限与资源：只需有效会话（requireAuth）；不接受自报身份，全部由服务端按账号现查（CONTRACT-274 §5 把旧的站内角色/能力形状整体下线，见下方说明）。

响应与错误：200 {account_id,login,username,display_name,avatar_url,level,level_name,department,titles,permissions,provider,email_required,profile_required}；email_required为true时控制台先带人去绑定邮箱页（#273），profile_required为true时再去补资料页（#280）。

数据与副作用：只读。level/department/titles 来自权限引擎的 perm_members/perm_groups（不再是 role_assignments）；permissions 是 effective().allow 再加上「只在本部门范围内允许」的节点（users.view、apply.view、apply.review、activity.read、dept.manage），给前端判断导航显隐用，实际范围由各接口自己再收窄。

本地表读取：users, account_profiles, perm_members, perm_groups。本地表写入：无。

源码：[app/server/src/routes/console/me.ts](../../../app/server/src/routes/console/me.ts)。验证入口：[tests/server/console.test.ts](../../../tests/server/console.test.ts)、[tests/server/signin-methods.test.ts](../../../tests/server/signin-methods.test.ts)、[tests/console/account.test.ts](../../../tests/console/account.test.ts)。

## 按能力读取工作概览

`GET /api/console/summary` · `flow:console.summary`

权限与资源：只需有效会话（requireAuth，和 GET /api/console/me 共用）；每一块各按自己的权限节点单独判断是否下发，不是单一门禁。

响应与错误：200 只含获授权的统计键——apply.view（投递统计）、competition.score.review（candidates_pending，#278 落地前固定 0）、users.view（今日注册）、activity.read（今日被限流次数）、gitlab.view（GitLab 同步健康）、feedback.view（意见反馈计数），没有对应节点的键直接不出现在响应里。

数据与副作用：只读；今日注册、今日被限流分别按北京时间当天零点起统计。

本地表读取：applications, feedback, activity_events, users。本地表写入：无。

源码：[app/server/src/routes/console/me.ts](../../../app/server/src/routes/console/me.ts)。验证入口：[tests/server/console.test.ts](../../../tests/server/console.test.ts)。

## 新权限体系：节点、权限组、用户列表与操作记录（控制台，#274 CONTRACT §4、§5）

这批接口按 #274 的权限节点判定（`perm_nodes`/`perm_groups`/`perm_group_parents`/`perm_entries`/`perm_members`），
取代了旧的 Capability 体系（`departments`/`titles`/`role_assignments`，`routes/console/{titles,assignments,people,
audit}.ts`）：旧接口与旧控制台前端已经随 #274 一起删除，不再并存；上面「解析本人控制台身份」「按能力读取工作概览」
「读取部门及成员计数」三节虽然还是旧文件 `routes/console/{me,departments}.ts`，但内部判定也已经切到权限节点。

| 接口 · 流程 | 权限与资源 | 响应、错误与副作用 |
|---|---|---|
| `GET /api/console/permissions/nodes` · `flow:permissions.nodes.list` | 需要节点 `perm.view` | 200 `{nodes:[{node,domain,label,description,meta}],domains:[{id,label}]}`；节点目录是代码里 `lib/permission-nodes.ts` 的只读镜像，不查库。 |
| `GET /api/console/permissions/explain?account=&node=` · `flow:permissions.explain` | 同上 | 200 `{node,result:allow\|deny\|unset,hits:[{source,group,via,entry}],meta_value?}`；`node` 是通配或未登记节点 400 `unknown_node`；账号不存在 404。直接复用求值引擎自带的 `explainFor`（`lib/permissions.ts`），不重复判定逻辑。 |
| `GET /api/console/accounts/:id/effective` · `flow:permissions.accounts.effective` | 同上 | 200 `{account_id,groups:[{id,name,kind,via}],allow:[nodes],deny:[nodes],meta:{...}}`；账号不存在 404；复用引擎的 `effective()`。 |
| `GET /api/console/permission-groups` · `flow:permissions.groups.list` | 同上 | 200 `{groups:[{id,kind,name,description,weight,department_id,icon,tone,sort,system,parents,member_count,entries}]}`，按 `sort` 升序；`entries[].value` 保留原始三态（`true`/`false`/`null`，`null` 配 `meta_value`），不像判定引擎那样把 `null` 当 `false`。 |
| `POST /api/console/permission-groups` · `flow:permissions.groups.create` | 需要节点 `perm.manage` 且刚登录过（step-up，#273 同一个 10 分钟窗口，没有 403 `step_up_required`）；每分钟 30 次 | body `{id(custom.<slug>),name,description?,weight,parents?,icon?,tone?}`；201 权限组一行；`id` 格式不对 400 `invalid_group_id`；已存在 409 `group_exists`；父组不存在 400 `invalid_parent`。只能新建 `kind=custom`、`system=0` 的组。 |
| `PATCH /api/console/permission-groups/:id` · `flow:permissions.groups.update` | 同上 | body 任选 `{name,description,weight,parents,icon,tone,sort,entries:{add:[{node,value?,meta_value?,scope?,expires_at?}],remove:[entry_id]}}`；对 `system=1` 的种子组（部门、称号、身份等级）同样能改，不限自定义组；继承成环 400 `group_cycle`；父组不存在 400 `invalid_parent`；`entries.add` 的节点不是已登记节点、也匹配不到任何已登记节点的通配前缀 400 `unknown_node`；一条条目必须只给 `value` 或只给 `meta_value` 400 `invalid_entry`。 |
| `DELETE /api/console/permission-groups/:id` · `flow:permissions.groups.delete` | 同上 | `system=1` 的种子组 409 `system_group`，不能删；自定义组删除时一并删掉这个组的全部条目与成员资格（不另行提示在组里的账号）。 |
| `GET /api/console/permission-groups/:id/members` · `flow:permissions.groups.members.list` | 需要节点 `perm.view` | 200 `{members:[{account_id,username,display_name,avatar_url,expires_at,granted_by,created_at}]}`，按加入时间升序；组不存在 404。 |
| `POST /api/console/permission-groups/:id/members` · `flow:permissions.groups.members.add` | 需要节点 `perm.manage` 且刚登录过；body `{account_id,expires_at?}` | 组或账号不存在 404（`not_found`/`account_not_found`）；`level`、`department` 组每账号最多一个，同一事务里先删旧的再插入新的（和 `setExclusiveGroupMembership` 同一条规则）。 |
| `DELETE /api/console/permission-groups/:id/members/:account_id` · `flow:permissions.groups.members.remove` | 同上 | 这个账号本来就不在这个组里 404 `not_found`。 |
| `GET /api/console/users?q=&level=&department=&status=&cursor=` · `flow:users.list` | 有全站 `users.view` 的 allow 就看全部账号；只有按部门限定 scope 的 allow（部长）就只看本部门，查询参数改不了范围；两种都没有 403 `forbidden` | 200 `{items:[{account_id,username,display_name,real_name?,grade,grade_label,avatar_url,status,level,department,titles,providers,gitlab,last_login_at,created_at}],next_cursor,counts:{visitor_today,registered,member,alumni}}`；`real_name` 只回给有 `users.manage` 的调用者，`q` 也只在这时按真实姓名搜（只有 `users.view` 或部长范围的看得到年级、看不到姓名，#280）；`grade` 是 1–4、`graduated` 或 null；`department=dept.none` 筛出没有部门成员资格的账号；`cursor` 是按 `created_at,id` 的不透明游标，固定 50 条一页；`gitlab.state` 由 `gitlab_accounts.state`/`last_error` 映射成 `synced\|pending\|failed\|blocked\|none`；`counts.visitor_today` 在操作记录（阶段 3）落地前固定 0。 |
| `PATCH /api/console/users/:id` · `flow:users.update` | 需要节点 `users.manage` 且刚登录过；改 `status` 另外需要 `users.disable` | body 任选 `{status,level,department,titles,real_name,grade}`（#280：`real_name` 填 null 清空，或按补资料页的规则校验，不对 400 `bad_real_name`；`grade` 是 1–4、`graduated` 或 null，按当前学年换算成入学年份；成员或往届成员清空任一项后，下次登录要重新补资料）；账号不存在 404；部门不存在 400 `invalid_department`；称号不存在 400 `invalid_title`；会让站长一个不剩（停用最后一个站长，或把 `titles` 改成不含 `title.site.owner`）409 `last_owner`。`level`/`department` 按唯一约束换组；`department` 变了且这次请求没有同时给 `titles` 时，自动去掉不属于新部门的称号（站长等无部门称号不受影响）。 |
| `GET /api/console/activity` · `flow:audit.console.activity.list` | 需要节点 `activity.read`；部长只有按部门 scope 的 allow 时只看本部门范围（含 `dept.none`：没有部门成员资格的账号） | 200 `{items:[{id,at,account,visitor_id,surface,action,target_type,target_id,outcome,ip,ua,request_id,meta}],next_cursor,blocked_today:[{bucket,count}]}`；按 `at,id` 倒序，固定 50 条一页；没有 `activity.read.ip` 时 IP 按 IPv4 留前两段、IPv6 留前 4 组打码，有这个节点才给全量。 |
| `GET /api/console/activity.csv` · `flow:audit.console.activity.export` | 需要节点 `activity.export`（不经部门 scope，能导出全量） | 200 `text/csv`；最多 5000 行，不分页；每次导出写一条操作记录（`activity.export`，meta 记导出行数）。 |
| `GET /api/console/accounts/:id/activity` · `flow:audit.console.activity.account` | 需要节点 `activity.read`；部长按部门 scope 时目标账号不在自己范围内 403 `forbidden` | 200 `{items:[...同 /api/console/activity 的单条形状],next_cursor}`；没有记录是空列表，不是 404。 |

本地表：这批接口都只读写 #274 新权限体系自己的表——`perm_nodes`（只读，代码镜像）、`perm_groups`、`perm_group_parents`、`perm_entries`、`perm_members`；用户列表另外读 `users`、`account_profiles`、`identities`、`gitlab_accounts`，改身份另外写 `users.status`；成员列表再读 `account_profiles` 取用户名/头像；操作记录三个接口读 `activity_events`（JOIN `account_profiles` 取用户名/头像）。所有写操作都调用 `permissions.bump()` 让判定引擎的进程内缓存失效，并写一条 `perm.group.*`/`users.update` 审计。

owner 特殊边界（GitHub #271）：isSiteOwner/siteOwnerCount 只计 active 且直接 owner 资格 NULL 或 expires_at > now，disabled/merged/到期备份不算。users PATCH 任免/停用 owner、恢复带有效 owner 资格的账号、titles 全量保留临时 owner 导致永久化，均要求操作者当前有效 owner；组写口同样检查 actor。删除/停用最后有效 owner，或把唯一有效资格覆盖为过去/当前到期，回 409 last_owner。owner 组条目替换后要有有效无 scope 的根 allow，且无同组有效全局根 deny（含 value=null 的 meta wildcard）；未来临时 root/owner 仍允许，自然到期不自动恢复。引擎缓存只在 revision 未变且 now 位于 [evaluatedAt,minExpiry) 内复用，到期等值或时钟回退重读。

权限范围的实现细节：`requirePermission` 中间件按「不给 scope 就查全局」判定，命中的是全站无限定条目；但部长拿到的条目本身带了 `scope:{department:[...]}}`，用空 scope 去查永远查不到。所以 `GET /api/console/users` 与操作记录三个接口不能只靠 `requirePermission` 当门禁，改用 `lib/console-scope.ts` 的 `requireScopedPermission()`/`departmentScopedAccess()`：先查有没有全站 allow，没有再查有没有按部门限定的 allow，两种都没有才真的是没权限；只处理 `department` 这一个 scope 维度，不是通用的 scope 求交实现。

源码：[routes/console/permissions.ts](../../../app/server/src/routes/console/permissions.ts)、[routes/console/permission-groups.ts](../../../app/server/src/routes/console/permission-groups.ts)、[routes/console/accounts.ts](../../../app/server/src/routes/console/accounts.ts)、[routes/console/users.ts](../../../app/server/src/routes/console/users.ts)、[routes/console/activity.ts](../../../app/server/src/routes/console/activity.ts)、[lib/console-scope.ts](../../../app/server/src/lib/console-scope.ts)、[middleware/require-step-up.ts](../../../app/server/src/middleware/require-step-up.ts)、[lib/permissions.ts](../../../app/server/src/lib/permissions.ts)（`explainFor`、`effective`）。验证入口：[tests/server/console-permissions.test.ts](../../../tests/server/console-permissions.test.ts)、[tests/server/console-users.test.ts](../../../tests/server/console-users.test.ts)、[tests/server/activity.test.ts](../../../tests/server/activity.test.ts)。

## 前端批量上报白名单动作（访客也能调）

`POST /api/events` · `flow:audit.events.report`

权限与资源：不要求登录，访客也能调；限流键登录的人按账号，没登录的按 IP 哈希（不是访客 cookie——那个 cookie 能被清掉重发一个新的，按它限流等于没限），30 次每分钟，同一人多个标签页共享同一份配额。

请求：`{ surface?: "portal"|"forum"|"console", events: [...] }`；`surface` 不传按门户算（既有调用点兼容），一批事件只属于一个来源，不支持混着报。

响应与错误：200 {accepted,rejected}；单次最多 20 条、至少 1 条，`surface` 填了不认识的值或多余字段 400 validation_error。

数据与副作用：只有对应来源在 `lib/activity.ts` 的白名单（`EVENT_WHITELIST`=门户、`FORUM_EVENT_WHITELIST`、`CONSOLE_EVENT_WHITELIST`）里的动作才记一行 `activity_events`（`surface` 写成请求体那个值）；白名单外的全部丢弃，合并计一条 outcome=denied 的 `events.rejected`（meta 记被丢弃的动作名与条数），不逐条记垃圾数据；不记密码、验证码、令牌、地址栏查询串、邮箱、真实姓名或帖子正文（调用方自己决定 meta 放什么）。三端通用的 `page.view` 报路由名/路径，不带参数真实值；论坛另有 `forum.theme.change`（换主题，访客也报）、`forum.sticker.use`（插入表情，只记表情编号）。

本地表读取：无。本地表写入：activity_events。

源码：[app/server/src/routes/portal/events.ts](../../../app/server/src/routes/portal/events.ts)、[app/server/src/lib/activity.ts](../../../app/server/src/lib/activity.ts)（`EVENT_WHITELIST`/`FORUM_EVENT_WHITELIST`/`CONSOLE_EVENT_WHITELIST`）、[app/forum/app/composables/useActivityBeacon.ts](../../../app/forum/app/composables/useActivityBeacon.ts)、[app/console/src/lib/events.ts](../../../app/console/src/lib/events.ts)。验证入口：[tests/server/events.test.ts](../../../tests/server/events.test.ts)、[app/forum/tests/activity-beacon.test.ts](../../../app/forum/tests/activity-beacon.test.ts)。

## 筛选招新投递列表

`GET /api/console/applications` · `flow:application.list`

权限与资源：applications.read；无部门/个人记录限制，有此能力可读全部候选人列表。

响应与错误：200 {items,total,counts}；特长摘要120字、last_review可空，来源IP/UA不下发；counts为未筛选的全局五状态计数。

数据与副作用：转义q中的LIKE通配符，按姓名/班级/邮箱搜索；查询latest review，不为列表记application.view。

共同身份路径：读取当前sid、账号记下的站内角色与称号权限包，不调用 GitHub；只有还没记过站内角色的老账号，它的 GitHub 会话第一次用到时查一次 GitHub 组织角色并记下（缓存60秒）。仅过期/令牌失效才删除会话，令牌失效还写一次审计，不代表每次成功读都审计（#262 第四期）。

本地表读取：applications, application_reviews, sessions, role_assignments, departments, titles。本地表写入：sessions, activity_events。

源码：[app/server/src/routes/console/applications.ts:48](../../../app/server/src/routes/console/applications.ts#L48)。验证入口：[tests/server/console.test.ts](../../../tests/server/console.test.ts)。

## 查看候选人详情与邮件状态

`GET /api/console/applications/:application_id` · `flow:application.detail`

权限与资源：applications.read；按UUID定位任意候选人，无部门范围限制。

响应与错误：200 {application,reviews,received_mail,mail,letter_templates}；404 not_found。邮件摘要不含地址/正文，application不含source_ip/UA；letter_templates 是待面试、已录取、未通过三类各自启用的模板，只有 id、名称、是否默认（#285，改状态的「用哪一套信」下拉框用）。

数据与副作用：读简历、审核历史、mail_outbox摘要和启用的邮件模板名，写application.view审计，不触发发信。

共同身份路径：读取当前sid、账号记下的站内角色与称号权限包，不调用 GitHub；只有还没记过站内角色的老账号，它的 GitHub 会话第一次用到时查一次 GitHub 组织角色并记下（缓存60秒）。仅过期/令牌失效才删除会话，令牌失效还写一次审计，不代表每次成功读都审计（#262 第四期）。

本地表读取：applications, application_reviews, mail_outbox, sessions, role_assignments, departments, titles, mail_templates。本地表写入：activity_events, sessions。

源码：[app/server/src/routes/console/applications.ts:117](../../../app/server/src/routes/console/applications.ts#L117)。验证入口：[tests/server/console.test.ts](../../../tests/server/console.test.ts)、[tests/server/mail-outbox.test.ts](../../../tests/server/mail-outbox.test.ts)。

## 导出候选人CSV

`GET /api/console/applications/export.csv` · `flow:application.export`

权限与资源：applications.export；可选status过滤，其余不按部门收窄；5次/分钟。

响应与错误：200 text/csv附件，UTF-8 BOM、北京时间列、公式前缀转义；429 rate_limited。

数据与副作用：读取简历并记录application.export数量/状态；不写候选人或发信队列，文件导出后不由系统追踪。

共同身份路径：读取当前sid、账号记下的站内角色与称号权限包，不调用 GitHub；只有还没记过站内角色的老账号，它的 GitHub 会话第一次用到时查一次 GitHub 组织角色并记下（缓存60秒）。仅过期/令牌失效才删除会话，令牌失效还写一次审计，不代表每次成功读都审计（#262 第四期）。

本地表读取：applications, sessions, role_assignments, departments, titles。本地表写入：activity_events, sessions。

源码：[app/server/src/routes/console/applications.ts:77](../../../app/server/src/routes/console/applications.ts#L77)。验证入口：[tests/server/console.test.ts](../../../tests/server/console.test.ts)、[tests/server/rate-limits.test.ts](../../../tests/server/rate-limits.test.ts)。

## 审核投递、补备注与安排通知

`PATCH /api/console/applications/:application_id` · `flow:application.review`

权限与资源：applications.review；按id审核，状态变更必须携带expected_status和expected_review_id；取消分支规则仍唯一见application.cancel。

响应与错误：200 {application,review}；400 invalid_status/no_change/letter_required/letter_invalid/template_invalid，404 not_found，409 status_changed。响应 Schema 已挂载（#285）：成功体的 application、review 原样保留，失败体保留 application、fields 等扩展字段，回归见 `tests/server/mail-templates.test.ts` 的「改状态的接口挂上响应合同后」。可选 template_id（#285）：必须是同一类、已启用的模板，类别不符、已停用、不存在都是 400 template_invalid，状态不改、不入队；不传用这一类的默认模板；没有信的状态（已取消、改回已收到）或 notify 为 false 时忽略它。

数据与副作用：变更到interview/accepted/rejected且notify不为false才渲染邮件，用选中的模板；状态、审核行和邮件入队同事务，实际发送由后台worker。备注不写信或审计正文；本路由不新增任何取消规则。

共同身份路径：读取当前sid、账号记下的站内角色与称号权限包，不调用 GitHub；只有还没记过站内角色的老账号，它的 GitHub 会话第一次用到时查一次 GitHub 组织角色并记下（缓存60秒）。仅过期/令牌失效才删除会话，令牌失效还写一次审计，不代表每次成功读都审计（#262 第四期）。

本地表读取：applications, application_reviews, mail_outbox, sessions, role_assignments, departments, titles, mail_templates。本地表写入：applications, application_reviews, mail_outbox, activity_events, sessions。

源码：[app/server/src/routes/console/applications.ts:135](../../../app/server/src/routes/console/applications.ts#L135)。验证入口：[tests/server/console.test.ts](../../../tests/server/console.test.ts)、[tests/server/mail-outbox.test.ts](../../../tests/server/mail-outbox.test.ts)、[tests/server/mail-templates.test.ts](../../../tests/server/mail-templates.test.ts)。

## 投递详情里预览将要发的信

`POST /api/console/applications/:application_id/letter-preview` · `flow:application.letter_preview`

权限与资源：需要节点 apply.review（按部门范围，和改状态同一个节点），账号维度每分钟 240 次；审核人没有 mail.template.manage 也能预览自己要发的信。

响应与错误：200 {subject,html,text}；400 no_letter（只有待面试、已录取、未通过有信）、template_invalid（选的模板不存在、不是这一类或已停用）、letter_invalid（渲染不出来）；404 not_found。

数据与副作用：用这份投递的真实字段和页面上填的内容，按选的模板（不传用默认）渲染；不发信、不入队、不改状态、不写审核记录；待面试还没填时间、地点时用占位文字，真正改状态时仍然要求必填。

本地表读取：applications, mail_templates。本地表写入：无。

源码：[app/server/src/routes/console/applications.ts:209](../../../app/server/src/routes/console/applications.ts#L209)。验证入口：[tests/server/mail-templates.test.ts](../../../tests/server/mail-templates.test.ts)、[tests/server/applications.test.ts](../../../tests/server/applications.test.ts)。

## 查看招聘邮件模板与变量清单

`GET /api/console/mail-templates` · `flow:mail.template.list`

权限与资源：需要节点 mail.template.manage（默认只有站长的根通配 * 拿到，不往下发）。

响应与错误：200 {templates,kinds,block_kinds,variables,limits,mail,test_send}；templates 按信的类别、默认在前、名字排序，每套带 id、name、kind、enabled、is_default 和内容字段；variables 是代码里唯一一份变量清单（TEMPLATE_VARIABLES），编辑页的变量速查表只读它；limits 是各字段的长度上限；mail 只给 enabled、recipients 和回信地址是否已配置，不含发信商密钥和回信地址本身；test_send 是试发的次数上限。

数据与副作用：只读。

本地表读取：mail_templates。本地表写入：无。

源码：[app/server/src/routes/console/mail-templates.ts:133](../../../app/server/src/routes/console/mail-templates.ts#L133)。验证入口：[tests/server/mail-templates.test.ts](../../../tests/server/mail-templates.test.ts)。

## 新建一套招聘邮件模板

`POST /api/console/mail-templates` · `flow:mail.template.create`

权限与资源：需要节点 mail.template.manage，且刚登录过（step-up）。

响应与错误：201 模板；400 template_invalid 带 issues[{path,message}]（变量不在清单里、按钮路径不在官网、结构或长度不合规，或用示例数据渲不出来）；409 template_name_taken（同一类里名字不分大小写重复）。

数据与副作用：内容先过 normalizeContent，再用示例数据真渲两遍（第二遍说明、原因为空）才落库；这一类还没有默认、而且新模板启用时它成为默认；操作记录 mail.template.create 只记类别、名称和是否启用，不记内容；不入队任何邮件。

本地表读取：mail_templates。本地表写入：mail_templates, activity_events。

源码：[app/server/src/routes/console/mail-templates.ts:146](../../../app/server/src/routes/console/mail-templates.ts#L146)。验证入口：[tests/server/mail-templates.test.ts](../../../tests/server/mail-templates.test.ts)。

## 编辑、启停或设为默认一套招聘邮件模板

`PATCH /api/console/mail-templates/:template_id` · `flow:mail.template.update`

权限与资源：需要节点 mail.template.manage，且刚登录过（step-up）。

响应与错误：200 模板；404 not_found；400 template_invalid；409 template_name_taken、default_template（默认模板不能停用）、template_changed（expected_updated_at 与库里不同，说明别人改过）、template_disabled（停用的模板不能设为默认）。类别建好以后不能改。

数据与副作用：没给的项沿用库里的，整套再核对和试渲一遍；is_default 只能设成 true，同事务把同一类原来的默认取消，只改默认标记不动更新人和更新时间；操作记录 mail.template.update 只记改了哪几项，不记内容。已入队的信在入队时已渲成成品，改模板不影响它们。

本地表读取：mail_templates。本地表写入：mail_templates, activity_events。

源码：[app/server/src/routes/console/mail-templates.ts:164](../../../app/server/src/routes/console/mail-templates.ts#L164)。验证入口：[tests/server/mail-templates.test.ts](../../../tests/server/mail-templates.test.ts)。

## 删除一套招聘邮件模板

`DELETE /api/console/mail-templates/:template_id` · `flow:mail.template.delete`

权限与资源：需要节点 mail.template.manage，且刚登录过（step-up）。

响应与错误：200 {ok:true}；404 not_found；409 default_template（默认模板不能删，先把同一类里的另一套设为默认）。

数据与副作用：只删这一行 mail_templates；已入队或已发出的信不受影响（成品内容在 mail_outbox 里，不引用模板）；操作记录 mail.template.delete 只记类别和名称。

本地表读取：mail_templates。本地表写入：mail_templates, activity_events。

源码：[app/server/src/routes/console/mail-templates.ts:202](../../../app/server/src/routes/console/mail-templates.ts#L202)。验证入口：[tests/server/mail-templates.test.ts](../../../tests/server/mail-templates.test.ts)。

## 编辑时实时预览一套招聘邮件

`POST /api/console/mail-templates/preview` · `flow:mail.template.preview`

权限与资源：需要节点 mail.template.manage；不要求刚登录过（编辑时每停一下就请求一次），账号维度每分钟 240 次。给了 application_id 要另外有 apply.view（按部门范围），否则 403。

响应与错误：200 {subject,html,text}；400 template_required（template_id 和 draft 要给且只给一个）、template_invalid（draft 不合规）、preview_failed（渲染不出来）；404 not_found。

数据与副作用：渲染的是 template_id 对应的已存模板，或还没保存的 draft；不入队、不发信、不写投递和审核记录；没给 application_id 用示例投递，给了就用这份投递的真实字段，并记 mail.template.preview（只记模板 id 和投递 id）。

本地表读取：mail_templates, applications。本地表写入：activity_events。

源码：[app/server/src/routes/console/mail-templates.ts:214](../../../app/server/src/routes/console/mail-templates.ts#L214)。验证入口：[tests/server/mail-templates.test.ts](../../../tests/server/mail-templates.test.ts)。

## 向测试邮箱试发一封样信

`POST /api/console/mail-templates/test-send` · `flow:mail.template.test_send`

权限与资源：需要节点 mail.template.manage，且刚登录过（step-up）；每个账号每小时 10 封（桶 mail.test.hourly），全站每小时 30 封，超过回 429 rate_limited 并带 bucket 和 retry_after。

响应与错误：200 {status,skip_reason,error,subject,to}，status 是 sent、failed、skipped 或 pending，to 是脱敏后的地址；400 invalid_address、template_required、template_invalid、preview_failed；404 not_found。没配置发信商或收件地址不在白名单里回 skipped，不入队，也不占次数。

数据与副作用：只发给请求里填的这一个地址、一封，kind 为 recruitment.test，事件键 test:<随机 UUID>，主题前加「【测试】」；数据只用示例，不带任何真实投递人的内容，不读不写 applications 和 application_reviews；这种信只试一次、失败不重试，失败原因回给页面；操作记录 mail.template.test_send 只留脱敏邮箱和模板 id，不留邮箱明文和信的内容。

本地表读取：mail_templates, mail_outbox, limit_events。本地表写入：mail_outbox, limit_events, activity_events。

源码：[app/server/src/routes/console/mail-templates.ts:244](../../../app/server/src/routes/console/mail-templates.ts#L244)。验证入口：[tests/server/mail-templates.test.ts](../../../tests/server/mail-templates.test.ts)、[tests/server/mail-outbox.test.ts](../../../tests/server/mail-outbox.test.ts)。

## 读取招新总开关（#284）

`GET /api/console/applications/settings` · `flow:application.settings.read`

权限与资源：节点 `apply.view`，按 `requireScopedPermission` 判定（部门部长拿到的是按部门限定的 `apply.view`，也放行；开关全站只有一个，不分部门）。

响应与错误：200 `{open,updated_at}`，`open` 是布尔，`updated_at` 是最近一次开关的毫秒时间戳，从没改过为 `null`（等于默认开放）；没登录 401，没有节点 403 `forbidden`（`node: "apply.view"`）。

数据与副作用：只读 `app_state` 里键 `apply_open` 的一行；没有这一行是开放，读不懂的值也按开放算。

本地表读取：app_state。本地表写入：无。

源码：[app/server/src/routes/console/applications.ts:80](../../../app/server/src/routes/console/applications.ts#L80)、[app/server/src/lib/apply-settings.ts](../../../app/server/src/lib/apply-settings.ts)。验证入口：[tests/server/apply-switch.test.ts](../../../tests/server/apply-switch.test.ts)。

## 开放或关闭招新（#284）

`PATCH /api/console/applications/settings` · `flow:application.settings.update`

权限与资源：节点 `apply.settings`（`lib/permission-nodes.ts`，种子里只有站长的根通配 `*` 默认拿到，部门部长等 curated 列表没有），并且 10 分钟内登录过（`requireStepUp`，否则 403 `step_up_required`，状态不变）；每个账号 30 次/分钟。

响应与错误：200 `{open,updated_at}`（改完之后的状态）；请求体 Schema 只接受 `{open: boolean}`，缺字段、不是布尔或多出字段都 400 `validation_error`；没登录 401，没有节点 403 `forbidden`（`node: "apply.settings"`）。

数据与副作用：状态真的变了才写 `app_state`（键 `apply_open`，值 `1` 开放、`0` 关闭）并在同一个事务里写一条 `application.settings.update` 操作记录（`target_type` 为 `application_settings`，`meta` 只有 `{open}`）；再提交当前已有的值原样回当前状态，不写库、不记。关闭只拦新的投递：`POST /api/portal/apply` 回 403 `apply_closed`，`GET /api/public/config` 的 `apply_open` 变成 `false`；已经收到的投递照常列表、审核、发信，每日额度的规则不变。

本地表读取：app_state。本地表写入：app_state, activity_events。

源码：[app/server/src/routes/console/applications.ts:83](../../../app/server/src/routes/console/applications.ts#L83)、[app/server/src/lib/apply-settings.ts](../../../app/server/src/lib/apply-settings.ts)。验证入口：[tests/server/apply-switch.test.ts](../../../tests/server/apply-switch.test.ts)。

## 提交加入我们申请

`POST /api/portal/apply` · `flow:application.submit`

权限与资源：#274 SPEC §3 起要先登录并持有 `apply.submit`（`level.registered` 天然有，访客没有）——不再接受匿名投递；#284 起招新总开关关着时在权限之后直接 403 `apply_closed`（见下）；蜜罐、PoW、可选Turnstile之外，按账号每天（北京时间零点重置）核对 `meta.limit.apply.daily`（注册用户 3 份、极客班成员 `level.member` 不限，没有这个 meta 时兜底按 3 份算），另按来源 IP（IPv6 按 /64）每天最多 10 份、按设备（这个接口自己发的 cookie）每天最多 5 份；每IP每分钟 5 次的旧限流不变。

响应与错误：201 {id,submitted_at,message,quota:{apply_left_today,apply_daily_limit}}；字段错误400附fields；没登录401 `unauthenticated`（#274 review round 1：preHandler 只挂 requirePermission，不再多挂一个 requireAuth，避免它先回 `not_signed_in` 盖掉这个通用错误码），没有 `apply.submit`403 `forbidden`；三条限额任一超限统一 429 `{error:"rate_limited",bucket:"apply.daily",message,retry_after}`（到下一个北京零点），不细分是哪条线触发；另有按 IP 的路由级限流（5次/分钟）同样回 429 rate_limited。蜜罐回相同201形状但不落库，也不计数。招新总开关关着（#284）时 403 `{error:"apply_closed",message:"招新暂未开放"}`，在权限节点之后、蜜罐与字段校验之前判断，所以没登录仍先回 401。

数据与副作用：三条限额核对与写投递在同一个事务里（`limits.hitAll`，全有或全没有，中间没有 await），超限不留半份投递；续发或换发设备 cookie（1 年，仅本接口路径）；记脱敏application.received审计（含 `account_id`），尽力入队已收到邮件（每小时总量限制），入队失败仅日志不回滚投递。IP、设备只存 sha256（`lib/limits.ts` 的 `limit_events`），不存原文。总开关关着时被拒的请求什么都不写：不落 `applications`、不占 `limit_events` 里的任何一条额度、不入队信、不下发设备 cookie；`middleware/http-policy.ts` 按 403 记一条 outcome 为 `denied`、动作为 `http.apply_closed` 的操作记录（同一分钟同一对象合并）。路由级 5 次/分钟的限流在更早一步，被拒的请求照常计一次。

本地表读取：app_state, limit_events, mail_outbox。本地表写入：applications, limit_events, mail_outbox, activity_events。`application_limits` 表已不再由这个接口读写，留给历史数据（#274，新计数统一走 `limit_events`）。

源码：[app/server/src/routes/portal/apply.ts:119](../../../app/server/src/routes/portal/apply.ts#L119)、[app/server/src/lib/limits.ts](../../../app/server/src/lib/limits.ts)、[app/server/src/lib/apply-quota.ts](../../../app/server/src/lib/apply-quota.ts)、[app/server/src/lib/apply-settings.ts](../../../app/server/src/lib/apply-settings.ts)。验证入口：[tests/server/applications.test.ts](../../../tests/server/applications.test.ts)、[tests/server/apply-switch.test.ts](../../../tests/server/apply-switch.test.ts)、[tests/server/mail-outbox.test.ts](../../../tests/server/mail-outbox.test.ts)、[tests/server/rate-limits.test.ts](../../../tests/server/rate-limits.test.ts)。

**下游已同步**（#275、#279）：官网「加入我们」是桌面窗口（`app/web/sites/portal/components/os/JoinBox.tsx`），没登录时只显示「先注册再投递」，登录后显示当天还能投几份（注册用户 3 份、成员不限），与这个接口同版本上线。

## 读取公开防滥用配置

`GET /api/public/config` · `flow:platform.public_config`

权限与资源：匿名可读；仅公开site key或null、PoW难度和招新总开关的当前状态，不含Turnstile secret。

响应与错误：200 {turnstile_site_key,pow_difficulty,apply_open}；`apply_open` 是布尔（#284），没设过为 `true`。

数据与副作用：只读；`apply_open` 读 `app_state` 里键 `apply_open` 的一行，其余是配置，不写库，不调用验证码服务。

本地表读取：app_state。本地表写入：无。

源码：[app/server/src/routes/portal/public-config.ts:17](../../../app/server/src/routes/portal/public-config.ts#L17)（#274 review round 1：原来和邀请链接接口挤在 `join.ts` 里，邀请链接整段删除后单独搬出来；#284 起多下发 `apply_open`）。验证入口：[tests/server/core.test.ts](../../../tests/server/core.test.ts)、[tests/server/configuration.test.ts](../../../tests/server/configuration.test.ts)、[tests/server/apply-switch.test.ts](../../../tests/server/apply-switch.test.ts)。

## 阅读公开部门与称号（新权限体系，#274）

`GET /api/public/departments` · `flow:identity.departments.public`

权限与资源：匿名可读；60 秒缓存。读的是 #274 新权限体系的 `perm_groups`（`kind='department'`/`title`）。旧的 `GET /api/public/org`（读旧的 `departments`/`titles` 表，`flow:organization.public`）已随 #276 退场：论坛也改读这个接口之后，旧接口没有活的前端读者，连同路由、合同与目录条目一起删掉。

响应与错误：200 `{departments:[{id,name,tone,icon,description,titles:[{id,name,weight}]}]}`；按 `perm_groups.sort` 升序排列（AI/算法/硬件/网安/管理在前，`dept.none` 固定排最后，`sort` 字段本身不下发），每个部门下的称号按 `weight` 升序。

数据与副作用：只读 `perm_groups`，不修改组织结构，不需要会话。

本地表读取：perm_groups。本地表写入：无。

源码：[app/server/src/routes/portal/departments.ts](../../../app/server/src/routes/portal/departments.ts)。验证入口：[tests/server/profile.test.ts](../../../tests/server/profile.test.ts)。

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

#274 review round 1（CONTRACT-274 §8，blocker）：GitHub 组织邀请链接整段删除——`GET /api/join/:token`、`POST /api/join/:token`、`lib/invite-reservation.ts`、`tests/server/invitations.test.ts` 都已删除，`invite_links`/`invite_attempts`/`invitations` 三张旧表数据原样保留、不再有接口读写；注册邀请码（`invite_codes`，GitHub/邮箱/Google 三种登录共用、SPEC §3.2 选填）与这套旧机制无关，见「邮箱登录」一节与 `lib/invite-codes.ts`。

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

本地表读取：sessions。本地表写入：feedback, activity_events, sessions。

源码：[app/server/src/routes/portal/feedback.ts:26](../../../app/server/src/routes/portal/feedback.ts#L26)。验证入口：[tests/server/feedback-org.test.ts](../../../tests/server/feedback-org.test.ts)、[tests/server/core.test.ts](../../../tests/server/core.test.ts)、[tests/server/rate-limits.test.ts](../../../tests/server/rate-limits.test.ts)。

## 控制台读取待处理意见

`GET /api/console/feedback` · `flow:feedback.console.list`

权限与资源：需要节点 feedback.view（#274 切到权限节点体系，不是旧的 feedback.read）；资源固定CONSOLE_ORG，不接受客户端自报org。

响应与错误：200 {items,counts}；最多500条，管理DTO不下发source_ip/UA/数字账号id。

数据与副作用：按org及可选status读列表与状态计数，不记查看审计。

本地表读取：feedback。本地表写入：无。

源码：[app/server/src/routes/console/feedback.ts:12](../../../app/server/src/routes/console/feedback.ts#L12)。验证入口：[tests/server/feedback-org.test.ts](../../../tests/server/feedback-org.test.ts)、[tests/server/console.test.ts](../../../tests/server/console.test.ts)、[tests/server/core.test.ts](../../../tests/server/core.test.ts)。

## 控制台处理意见状态与回复

`PATCH /api/console/feedback/:id` · `flow:feedback.console.update`

权限与资源：需要节点 feedback.handle 且刚登录过（step-up，#274 切到权限节点体系）；资源固定CONSOLE_ORG，不接受客户端自报org。

响应与错误：200 {ok:true}；记录不属于org返回404，非法状态被合同/handler拒绝。

数据与副作用：更新status、reply、replied_by/replied_at及updated_at，审计feedback.update；回复将由公开列表展示，不发邮件。

本地表读取：feedback。本地表写入：feedback, activity_events。

源码：[app/server/src/routes/console/feedback.ts:18](../../../app/server/src/routes/console/feedback.ts#L18)。验证入口：[tests/server/feedback-org.test.ts](../../../tests/server/feedback-org.test.ts)、[tests/server/console.test.ts](../../../tests/server/console.test.ts)、[tests/server/core.test.ts](../../../tests/server/core.test.ts)。

## 控制台删除组织意见

`DELETE /api/console/feedback/:id` · `flow:feedback.console.delete`

权限与资源：需要节点 feedback.handle 且刚登录过（step-up）；资源固定CONSOLE_ORG，不接受客户端自报org。

响应与错误：200 {ok:true}；org/id不匹配404。

数据与副作用：删除反馈并审计feedback.delete，不能越过组织条件删除其他记录。

本地表读取：feedback。本地表写入：feedback, activity_events。

源码：[app/server/src/routes/console/feedback.ts:31](../../../app/server/src/routes/console/feedback.ts#L31)。验证入口：[tests/server/feedback-org.test.ts](../../../tests/server/feedback-org.test.ts)、[tests/server/console.test.ts](../../../tests/server/console.test.ts)、[tests/server/core.test.ts](../../../tests/server/core.test.ts)。

## 浏览论坛状态与本人私有列表

`GET /api/forum/state` · `flow:forum.state`

权限与资源：游客与成员均可读；通知、书签和真实通知设置仅本人可见，其他用户设置给默认值；关注关系公开。

响应与错误：200 {state}，帖子只有字段和摘要、没有正文；话题与帖子按 `COALESCE(topic.visibility, category.visibility, 'public')` 过滤；分类仅在自身可读或被合法可读话题引用时下发，用户新增标签、通知与书签不引用隐藏话题；每IP(/64)分钟120次，超额429；显式HEAD回405且不计算state。state.viewer除userId/kind/capabilities外另有level（"public"|"registered"|"member"，levelOf()按分级可见判出，游客恒为public）与nodes（这个账号持有的论坛写权限节点子集，游客恒为空数组，#276团队负责人追加），每个写接口的回答也带同一套viewer。

数据与副作用：读论坛表与公开内容分类；GET也可能通过forumViewer刷新本人用户；不发送邮件、不写帖子。

身份条件副作用：forumViewer按会话的账号（account_id）认人创建/刷新forum_users的角色、称号和头像，不再要求绑定GitHub——没有GitHub id（邮箱、Google登录）不算游客，是真实成员（#274 SPEC §3.6，论坛用户编号改成a<序号>，有GitHub id的仍是m<GitHub id>并保留GitHub头像）；sid过期删除会话，上游拒绝token经全局处理时删会话并审计；游客不刷新成员记录。

本地表读取：forum_counters, forum_users, forum_tags, forum_topics, forum_posts, forum_likes, forum_notifications, forum_bookmarks, forum_follows, sessions, role_assignments, departments, titles。本地表写入：forum_users, sessions, activity_events。

源码：[app/server/src/routes/forum-api/topics.ts:22](../../../app/server/src/routes/forum-api/topics.ts#L22)。验证入口：[tests/server/forum.test.ts](../../../tests/server/forum.test.ts)。

## 阅读单话题帖子正文

`GET /api/forum/topics/:topic_id/posts` · `flow:forum.topic_posts`

权限与资源：游客与成员均可读，无额外帖子级权限；与state可见性一致。

响应与错误：200 {posts}含正文；话题不存在404；每IP分钟60次。

数据与副作用：按话题读取帖子及点赞投影；软删正文为空；不把全论坛正文再次塞进首屏。

身份条件副作用：forumViewer按会话的账号（account_id）认人创建/刷新forum_users的角色、称号和头像，不再要求绑定GitHub——没有GitHub id（邮箱、Google登录）不算游客，是真实成员（#274 SPEC §3.6，论坛用户编号改成a<序号>，有GitHub id的仍是m<GitHub id>并保留GitHub头像）；sid过期删除会话，上游拒绝token经全局处理时删会话并审计；游客不刷新成员记录。

本地表读取：forum_topics, forum_posts, forum_likes, sessions, role_assignments, departments, titles, forum_users。本地表写入：forum_users, sessions, activity_events。

源码：[app/server/src/routes/forum-api/topics.ts:34](../../../app/server/src/routes/forum-api/topics.ts#L34)。验证入口：[tests/server/forum.test.ts](../../../tests/server/forum.test.ts)。

## 搜索话题帖子和用户

`GET /api/forum/search` · `flow:forum.search`

权限与资源：游客与成员均可搜索；只本人用户记录显示真实通知设置，不搜索已删帖子正文。

响应与错误：200 {results:{topics,posts,users}}；空词空结果；词过长400 validation_error，每IP分钟60次。

数据与副作用：标题、正文、username/displayName按转义的LIKE搜索，各类限量；返回帖子命中摘要，不将%当通配符。

身份条件副作用：forumViewer按会话的账号（account_id）认人创建/刷新forum_users的角色、称号和头像，不再要求绑定GitHub——没有GitHub id（邮箱、Google登录）不算游客，是真实成员（#274 SPEC §3.6，论坛用户编号改成a<序号>，有GitHub id的仍是m<GitHub id>并保留GitHub头像）；sid过期删除会话，上游拒绝token经全局处理时删会话并审计；游客不刷新成员记录。

本地表读取：forum_topics, forum_posts, forum_users, forum_likes, sessions, role_assignments, departments, titles。本地表写入：forum_users, sessions, activity_events。

源码：[app/server/src/routes/forum-api/topics.ts:50](../../../app/server/src/routes/forum-api/topics.ts#L50)。验证入口：[tests/server/forum.test.ts](../../../tests/server/forum.test.ts)。

## 读取site论坛Markdown索引

`GET /forum/llms.txt` · `flow:forum.site-markdown.index`

权限与资源：`forumViewer` 按同源 `sid` 解析游客/注册用户/成员，`levelOf` 与 `/api/forum/state` 共用读取等级；只从当前 viewer 已过滤的 state 生成，不读取静态 `published` JSON。

响应与错误：200 `text/plain; charset=utf-8`；只列当前可见分类、话题与首帖摘要，无可见话题返回空态说明；自动 HEAD；`Cache-Control: private, no-store`、`nosniff`；沿用论坛读取限流。

数据与副作用：不修改话题、正文或 visibility；GET 仍可能按既有 `forumViewer` 规则刷新本人论坛用户。源码：[app/server/src/routes/forum-api/markdown.ts](../../../app/server/src/routes/forum-api/markdown.ts)。验证：[tests/server/forum-category-visibility.test.ts](../../../tests/server/forum-category-visibility.test.ts)。

## 读取site话题Markdown正文

`GET /forum/t/:topic_id.md` · `flow:forum.site-markdown.topic`

权限与资源：先按有效可见性执行正文直链同一守卫，再用同一 viewer 的 state 与 `topicPosts()` 生成；历史显式 public 覆盖保留，分类收紧的继承话题立即隐藏。

响应与错误：200 `text/markdown; charset=utf-8`；未知 id 404；匿名缺所需等级 401 `unauthenticated`，已登录等级不足 403 `forbidden`，拒绝体不带标题或正文；自动 HEAD；`private, no-store`、`nosniff`。

数据与副作用：只读当前核心数据库正文，不读构建时 Markdown。源码与验证同上。

## 下载site旧帖图片

`GET /forum/published/:file` · `flow:forum.site-published.asset`

权限与资源：文件名只接受 16 位小写十六进制加 `.webp`；至少一篇当前 viewer 可见且未删除的正文引用它才可读，同一图片被多话题引用时取最宽有效可见性。

响应与错误：允许时 200 `image/webp`；非法名、磁盘缺文件、无引用或仅隐藏话题引用统一 404，不泄漏附件存在性；自动 HEAD；`private, no-store`、`nosniff`。

数据与副作用：读正文引用和 server 镜像内保留的源图片，不删除源文件、帖子或历史记录。验证：[tests/server/forum-category-visibility.test.ts](../../../tests/server/forum-category-visibility.test.ts)。

## 话题列表的游标分页（#276 CONTRACT §9）

`GET /api/forum/topics` · `flow:forum.topics.page`

权限与资源：谁都能调；按身份的分级可见（CONTRACT §1）在 SQL 层过滤，和 `/state`、`/search` 共用同一份判断，看不到的话题不出现、不计入翻页。

响应与错误：200 {topics,nextCursor}；按最后活跃时间倒序，游标是不透明字符串，解不出来当没有（回第一页）；limit 要求1–50的整数，不是回400 validation_error；q超过100字400。

数据与副作用：访客翻页上限（SPEC §3.8）——没带cursor的第一页不计数，带cursor起按访客id或IP哈希、北京日历日窗口计最多10次，第11次429 {bucket:"forum.visitor.pages"}；登录用户不限。

身份条件副作用：forumViewer按会话的账号认人创建/刷新forum_users，访客不写；sid过期删除会话。

本地表读取：forum_topics, forum_category_settings, sessions, perm_members, perm_entries, perm_groups, limit_events, forum_users。本地表写入：forum_users, sessions, limit_events。

源码：[app/server/src/routes/forum-api/topics.ts:67](../../../app/server/src/routes/forum-api/topics.ts#L67)。验证入口：[tests/server/forum-v2-endpoints.test.ts](../../../tests/server/forum-v2-endpoints.test.ts)。

## 发布成员话题与首帖

`POST /api/forum/topics` · `flow:forum.topics.create`

权限与资源：requireWriter：有效站内会话且账号 active；registered、邮箱和 Google 登录也可解析为论坛账号，不以 CONSOLE_ORG 成员资格授权；主体由服务端 forumViewer 确定，客户端 userId/role 不能赋权。 另需 forum.topic.create 节点。

响应与错误：201 {changes,viewer,topicId,postId}，帖子带正文；非法标题/分类/tag/空正文400，成员限流429。

数据与副作用：单事务创建话题、首帖、编号和必要新tag，处理最多10个@提及通知；成功后记topic限流事件，不发邮件。

身份条件副作用：forumViewer按会话的账号（account_id）认人创建/刷新forum_users的角色、称号和头像，不再要求绑定GitHub——没有GitHub id（邮箱、Google登录）不算游客，是真实成员（#274 SPEC §3.6，论坛用户编号改成a<序号>，有GitHub id的仍是m<GitHub id>并保留GitHub头像）；sid过期删除会话，上游拒绝token经全局处理时删会话并审计；游客不刷新成员记录。

本地表读取：forum_topics, forum_posts, forum_tags, forum_users, forum_notifications, forum_counters, forum_rate_events, sessions, role_assignments, departments, titles, forum_likes。本地表写入：forum_topics, forum_posts, forum_tags, forum_notifications, forum_counters, forum_rate_events, forum_users, sessions, activity_events。

源码：[app/server/src/routes/forum-api/topics.ts:86](../../../app/server/src/routes/forum-api/topics.ts#L86)。验证入口：[tests/server/forum.test.ts](../../../tests/server/forum.test.ts)。

## 置顶或取消置顶话题

`POST /api/forum/topics/:topic_id/pin` · `flow:forum.topics.pin`

权限与资源：requireMember：有效站内会话且账号 active；registered、邮箱和 Google 登录也可解析为论坛账号，不以 CONSOLE_ORG 成员资格授权；主体由服务端 forumViewer 确定，客户端 userId/role 不能赋权。 另按指定话题的分类 scope 核对 forum.moderate.pin 节点。

响应与错误：200 {changes,viewer}；只返回本次变动记录，成员自己的用户记录总携带，私有记录按本人范围投影。；缺能力403，话题不存在404。

数据与副作用：更新pinned；以CONSOLE_ORG记forum.topic.pin审计，只含话题id及开关，不含正文。

身份条件副作用：forumViewer按会话的账号（account_id）认人创建/刷新forum_users的角色、称号和头像，不再要求绑定GitHub——没有GitHub id（邮箱、Google登录）不算游客，是真实成员（#274 SPEC §3.6，论坛用户编号改成a<序号>，有GitHub id的仍是m<GitHub id>并保留GitHub头像）；sid过期删除会话，上游拒绝token经全局处理时删会话并审计；游客不刷新成员记录。

本地表读取：forum_topics, sessions, role_assignments, departments, titles, forum_users, forum_likes。本地表写入：forum_topics, activity_events, forum_users, sessions。

源码：[app/server/src/routes/forum-api/topics.ts:108](../../../app/server/src/routes/forum-api/topics.ts#L108)（和「关闭或重新打开话题」共用同一处 for 循环注册的调用点）。验证入口：[tests/server/forum.test.ts](../../../tests/server/forum.test.ts)。

## 关闭或重新打开话题

`POST /api/forum/topics/:topic_id/close` · `flow:forum.topics.close`

权限与资源：requireMember：有效站内会话且账号 active；registered、邮箱和 Google 登录也可解析为论坛账号，不以 CONSOLE_ORG 成员资格授权；主体由服务端 forumViewer 确定，客户端 userId/role 不能赋权。 另按指定话题的分类 scope 核对 forum.moderate.close 节点。

响应与错误：200 {changes,viewer}；只返回本次变动记录，成员自己的用户记录总携带，私有记录按本人范围投影。；缺能力403，话题不存在404。

数据与副作用：更新closed；以CONSOLE_ORG记forum.topic.close审计，只含话题id及开关，不含正文。

身份条件副作用：forumViewer按会话的账号（account_id）认人创建/刷新forum_users的角色、称号和头像，不再要求绑定GitHub——没有GitHub id（邮箱、Google登录）不算游客，是真实成员（#274 SPEC §3.6，论坛用户编号改成a<序号>，有GitHub id的仍是m<GitHub id>并保留GitHub头像）；sid过期删除会话，上游拒绝token经全局处理时删会话并审计；游客不刷新成员记录。

本地表读取：forum_topics, sessions, role_assignments, departments, titles, forum_users, forum_likes。本地表写入：forum_topics, activity_events, forum_users, sessions。

源码：[app/server/src/routes/forum-api/topics.ts:108](../../../app/server/src/routes/forum-api/topics.ts#L108)（和「置顶或取消置顶话题」共用同一处 for 循环注册的调用点）。验证入口：[tests/server/forum.test.ts](../../../tests/server/forum.test.ts)。

## 记录话题浏览数

`POST /api/forum/topics/:topic_id/view` · `flow:forum.topics.view`

权限与资源：游客或成员都可调用，不解析登录身份；按IP(/64)与话题去重。

响应与错误：204空体；不存在404，分钟60次超额429。

数据与副作用：事务清理超过1小时的去重记录，首次浏览才+1；IP只保留在短期去重表，不随帖子返回。

本地表读取：forum_topics, forum_topic_views。本地表写入：forum_topics, forum_topic_views。

源码：[app/server/src/routes/forum-api/topics.ts:142](../../../app/server/src/routes/forum-api/topics.ts#L142)。验证入口：[tests/server/forum.test.ts](../../../tests/server/forum.test.ts)。

## 改话题的可见范围（#276 CONTRACT §1）

`PATCH /api/forum/topics/:topic_id/visibility` · `flow:forum.topics.visibility`

权限与资源：requireMember之后按canModerate("forum.moderate.edit", 话题所在分类)判定（部门组的scope限定在本部门分类）；话题不存在404；权限不够403 forbidden。

响应与错误：200 {changes:{topics:[...]}}；非null值比分类基线更松回400 visibility_too_open（不能比分类更松，只能更严或跟随null）。

数据与副作用：UPDATE forum_topics.visibility（null表示跟随分类，生效值=COALESCE(topic.visibility, category.visibility, 'public')）；写审计forum.topic.visibility，只记目标值不记正文。

身份条件副作用：forumViewer按会话的账号认人创建/刷新forum_users；sid过期或账号停用删除会话。

本地表读取：forum_topics, forum_category_settings, forum_users, sessions, perm_members, perm_entries, perm_groups。本地表写入：forum_topics, activity_events, forum_users, sessions。

源码：[app/server/src/routes/forum-api/topics.ts:124](../../../app/server/src/routes/forum-api/topics.ts#L124)。验证入口：[tests/server/forum-v2-endpoints.test.ts](../../../tests/server/forum-v2-endpoints.test.ts)。

## 成员回复话题

`POST /api/forum/posts` · `flow:forum.posts.reply`

权限与资源：#276 CONTRACT §2 去掉游客回帖：需要登录且持 forum.reply.create（迁移种子只发给 level.member），访客401 signin_required，登录但没有该节点403 forbidden；分级可见（CONTRACT §1）在权限判定之后、建帖之前再判一次——看不到这个话题也不能回，401/403 响应不带标题；已关闭话题仅持 forum.moderate.edit（按分类限定 scope）可回，replyTo须同一话题。

响应与错误：201 {changes,viewer,postId}含正文；话题不存在404；关闭/看不到403；正文为空或replyTo不在同话题400；按账号每小时上限（meta.limit.forum.reply.hourly）、同IP每小时200次（全账号合计）、每分钟洪泛三条限额，超了都回429 rate_limited（各自的bucket）。

数据与副作用：事务创建回复并更新最后活动、处理回复与提及通知；不再有游客用户或PoW/蜜罐/Turnstile分支；不发送邮件。

身份条件副作用：forumViewer按会话的账号（account_id）认人创建/刷新forum_users的角色、称号和头像，不再要求绑定GitHub——没有GitHub id（邮箱、Google登录）不算游客，是真实成员（#274 SPEC §3.6，论坛用户编号改成a<序号>，有GitHub id的仍是m<GitHub id>并保留GitHub头像）；sid过期删除会话，上游拒绝token经全局处理时删会话并审计；游客不刷新成员记录。

本地表读取：forum_topics, forum_posts, forum_users, forum_notifications, forum_counters, forum_rate_events, forum_category_settings, perm_members, perm_entries, perm_groups, activity_events, sessions, forum_likes, limit_events。本地表写入：forum_posts, forum_topics, forum_users, forum_notifications, forum_counters, forum_rate_events, sessions, activity_events, limit_events。

源码：[app/server/src/routes/forum-api/posts.ts:39](../../../app/server/src/routes/forum-api/posts.ts#L39)。验证入口：[tests/server/forum.test.ts](../../../tests/server/forum.test.ts)、[tests/server/forum-v2-endpoints.test.ts](../../../tests/server/forum-v2-endpoints.test.ts)。

## 编辑自己的帖子或执行版务

`PATCH /api/forum/posts/:post_id` · `flow:forum.posts.edit`

权限与资源：requireMember：有效站内会话且账号 active；registered、邮箱和 Google 登录也可解析为论坛账号，不以 CONSOLE_ORG 成员资格授权；主体由服务端 forumViewer 确定，客户端 userId/role 不能赋权。 作者本人可编辑自己的帖子；编辑他人帖子另需目标分类 scope 下的 forum.moderate.edit。

响应与错误：200 {changes,viewer}；只返回本次变动记录，成员自己的用户记录总携带，私有记录按本人范围投影。；帖子正文随changes返回；404不存在、403他人帖子、409 post_deleted、400 empty_content。

数据与副作用：只更新正文/edited_at；只有编辑他人帖子才写forum.post.edit审计，不记录正文；不会因编辑重新发送提及通知。

身份条件副作用：forumViewer按会话的账号（account_id）认人创建/刷新forum_users的角色、称号和头像，不再要求绑定GitHub——没有GitHub id（邮箱、Google登录）不算游客，是真实成员（#274 SPEC §3.6，论坛用户编号改成a<序号>，有GitHub id的仍是m<GitHub id>并保留GitHub头像）；sid过期删除会话，上游拒绝token经全局处理时删会话并审计；游客不刷新成员记录。

本地表读取：forum_posts, sessions, role_assignments, departments, titles, forum_users, forum_likes。本地表写入：forum_posts, activity_events, forum_users, sessions。

源码：[app/server/src/routes/forum-api/posts.ts:63](../../../app/server/src/routes/forum-api/posts.ts#L63)。验证入口：[tests/server/forum.test.ts](../../../tests/server/forum.test.ts)。

## 软删除回复

`DELETE /api/forum/posts/:post_id` · `flow:forum.posts.delete`

权限与资源：requireMember：有效站内会话且账号 active；registered、邮箱和 Google 登录也可解析为论坛账号，不以 CONSOLE_ORG 成员资格授权；主体由服务端 forumViewer 确定，客户端 userId/role 不能赋权。 作者本人可删除自己的回复；删除他人回复另需目标分类 scope 下的 forum.moderate.delete；第一帖禁止删除。

响应与错误：200 {changes,viewer}；只返回本次变动记录，成员自己的用户记录总携带，私有记录按本人范围投影。；404不存在、403他人帖子、400 first_post；已软删重试返回现状。

数据与副作用：置deleted并清正文，保留点赞和书签；只在删除他人帖子时记forum.post.delete审计；幂等重试不重复执行删除。

身份条件副作用：forumViewer按会话的账号（account_id）认人创建/刷新forum_users的角色、称号和头像，不再要求绑定GitHub——没有GitHub id（邮箱、Google登录）不算游客，是真实成员（#274 SPEC §3.6，论坛用户编号改成a<序号>，有GitHub id的仍是m<GitHub id>并保留GitHub头像）；sid过期删除会话，上游拒绝token经全局处理时删会话并审计；游客不刷新成员记录。

本地表读取：forum_posts, sessions, role_assignments, departments, titles, forum_users, forum_likes。本地表写入：forum_posts, activity_events, forum_users, sessions。

源码：[app/server/src/routes/forum-api/posts.ts:75](../../../app/server/src/routes/forum-api/posts.ts#L75)。验证入口：[tests/server/forum.test.ts](../../../tests/server/forum.test.ts)。

## 切换本人点赞

`POST /api/forum/posts/:post_id/like` · `flow:forum.posts.like`

权限与资源：requireWriter：有效站内会话且账号 active；registered、邮箱和 Google 登录也可解析为论坛账号，不以 CONSOLE_ORG 成员资格授权；主体由服务端 forumViewer 确定，客户端 userId/role 不能赋权。 另需 forum.react；点赞主体固定本人，不接受代他人点赞。

响应与错误：200 {changes,viewer}；只返回本次变动记录，成员自己的用户记录总携带，私有记录按本人范围投影。；404不存在，409 post_deleted；帖子投影不带全文。

数据与副作用：事务切换点赞；新点赞按作者通知设置生成一次通知（同人同帖不重复），取消不撤回已有通知，不写操作审计。

身份条件副作用：forumViewer按会话的账号（account_id）认人创建/刷新forum_users的角色、称号和头像，不再要求绑定GitHub——没有GitHub id（邮箱、Google登录）不算游客，是真实成员（#274 SPEC §3.6，论坛用户编号改成a<序号>，有GitHub id的仍是m<GitHub id>并保留GitHub头像）；sid过期删除会话，上游拒绝token经全局处理时删会话并审计；游客不刷新成员记录。

本地表读取：forum_posts, forum_likes, forum_users, forum_notifications, forum_counters, sessions, role_assignments, departments, titles。本地表写入：forum_likes, forum_notifications, forum_counters, forum_users, sessions, activity_events。

源码：[app/server/src/routes/forum-api/posts.ts:86](../../../app/server/src/routes/forum-api/posts.ts#L86)。验证入口：[tests/server/forum.test.ts](../../../tests/server/forum.test.ts)。

## 切换本人书签

`POST /api/forum/posts/:post_id/bookmark` · `flow:forum.posts.bookmark`

权限与资源：requireWriter：有效站内会话且账号 active；registered、邮箱和 Google 登录也可解析为论坛账号，不以 CONSOLE_ORG 成员资格授权；主体由服务端 forumViewer 确定，客户端 userId/role 不能赋权。 另需 forum.react；仅操作本人书签，handler 检查帖子存在，未禁止为软删帖子加书签。

响应与错误：200 {changes,viewer}；只返回本次变动记录，成员自己的用户记录总携带，私有记录按本人范围投影。；404不存在；删除书签用changes.removed反馈。

数据与副作用：事务按userId/postId切换书签，不通知作者，不修改帖子正文。

身份条件副作用：forumViewer按会话的账号（account_id）认人创建/刷新forum_users的角色、称号和头像，不再要求绑定GitHub——没有GitHub id（邮箱、Google登录）不算游客，是真实成员（#274 SPEC §3.6，论坛用户编号改成a<序号>，有GitHub id的仍是m<GitHub id>并保留GitHub头像）；sid过期删除会话，上游拒绝token经全局处理时删会话并审计；游客不刷新成员记录。

本地表读取：forum_posts, forum_bookmarks, sessions, role_assignments, departments, titles, forum_users, forum_likes。本地表写入：forum_bookmarks, forum_users, sessions, activity_events。

源码：[app/server/src/routes/forum-api/posts.ts:94](../../../app/server/src/routes/forum-api/posts.ts#L94)。验证入口：[tests/server/forum.test.ts](../../../tests/server/forum.test.ts)。

## 给帖子加一个表情回应（#276 CONTRACT §4）

`PUT /api/forum/posts/:post_id/reactions/:sticker_id` · `flow:forum.reactions.add`

权限与资源：需要 forum.react 节点（迁移种子只发给 level.member）；访客401 signin_required，登录但没有该节点403 forbidden；帖子不存在404，已软删409 post_deleted。

响应与错误：200 {reactions:[{stickerId,shortcode,url,count,mine}]}（camelCase，和帖子记录里的reactions字段同一套对象；CONTRACT-276 §4原定sticker_id，偏差记在DECISIONS-LOG；url同表情包列表，按CDN开关给同源或CDN地址），只回这条帖子的表情聚合，不回整份changes或viewer；mine按当前看的人是不是也回应过这条表情判定；表情不存在/已停用400 unknown_sticker；超过meta.limit.forum.react.hourly回429 {bucket:"forum.react.hourly",retry_after}。

数据与副作用：按(post_id,account_id,sticker_id)主键INSERT OR IGNORE，重复加同一表情不报错也不重复计数；记一条outcome=ok的forum.react操作记录（meta.sticker_id，#274：原来没有，补上）。

身份条件副作用：forumViewer按会话的账号认人创建/刷新forum_users；sid过期或账号停用删除会话。

本地表读取：forum_posts, forum_stickers, forum_reactions, forum_users, sessions, perm_members, perm_entries, perm_groups, limit_events。本地表写入：forum_reactions, forum_users, sessions, limit_events, activity_events。

源码：[app/server/src/routes/forum-api/posts.ts:102](../../../app/server/src/routes/forum-api/posts.ts#L102)。验证入口：[tests/server/forum-v2-endpoints.test.ts](../../../tests/server/forum-v2-endpoints.test.ts)。

## 取消一条表情回应

`DELETE /api/forum/posts/:post_id/reactions/:sticker_id` · `flow:forum.reactions.remove`

权限与资源：同PUT同一个节点forum.react；不检查帖子是否已软删——取消自己的表情回应即使帖子已删也允许。

响应与错误：200 {reactions:[{stickerId,shortcode,url,count,mine}]}（camelCase，同PUT；mine取消后按当前看的人重算），回取消之后的表情聚合；帖子不存在404；这条不限额。

数据与副作用：按(post_id,account_id,sticker_id) DELETE forum_reactions，原本没有这条也不报错（幂等）；同样记一条outcome=ok的forum.react操作记录，meta.removed=true区分（#274：原来没有，补上）。

身份条件副作用：forumViewer按会话的账号认人创建/刷新forum_users；sid过期或账号停用删除会话。

本地表读取：forum_posts, forum_stickers, forum_reactions, forum_users, sessions, perm_members, perm_entries, perm_groups。本地表写入：forum_reactions, forum_users, sessions, activity_events。

源码：[app/server/src/routes/forum-api/posts.ts:113](../../../app/server/src/routes/forum-api/posts.ts#L113)。验证入口：[tests/server/forum-v2-endpoints.test.ts](../../../tests/server/forum-v2-endpoints.test.ts)。

## @ 提及自动补全（#276 CONTRACT §6）

`GET /api/forum/users/suggest` · `flow:forum.users.suggest`

权限与资源：requireMember——只要求有效登录会话，不要求level.member，注册用户也能用；访客401 signin_required。

响应与错误：200 {users:[{username,display_name,avatar_url}]}，snake_case，不回邮箱或任何账号内部字段；q必须1–24字，缺或超长400 validation_error。

数据与副作用：按username/display_name前缀、不分大小写匹配，只回status=active且forum_users.kind=member的账号；每账号每分钟30次，超了429 {bucket:"forum.suggest.per_minute"}。

身份条件副作用：forumViewer按会话的账号认人创建/刷新forum_users；sid过期或账号停用删除会话。

本地表读取：users, forum_users, sessions, perm_members, perm_entries, perm_groups, limit_events。本地表写入：forum_users, sessions, limit_events。

源码：[app/server/src/routes/forum-api/people.ts:12](../../../app/server/src/routes/forum-api/people.ts#L12)。验证入口：[tests/server/forum-v2-endpoints.test.ts](../../../tests/server/forum-v2-endpoints.test.ts)。

## 切换本人关注关系

`POST /api/forum/users/:forum_user_id/follow` · `flow:forum.users.follow`

权限与资源：requireWriter：有效站内会话且账号 active；registered、邮箱和 Google 登录也可解析为论坛账号，不以 CONSOLE_ORG 成员资格授权；主体由服务端 forumViewer 确定，客户端 userId/role 不能赋权。 另需 forum.react；关注发起人固定本人，目标须存在且不是本人。

响应与错误：200 {changes,viewer}；只返回本次变动记录，成员自己的用户记录总携带，私有记录按本人范围投影。；404未知用户，400 cannot_follow_self。

数据与副作用：事务切换关注；首次关注在对方允许通知且未曾通知时写通知与编号，取消关注不删除旧通知。

身份条件副作用：forumViewer按会话的账号（account_id）认人创建/刷新forum_users的角色、称号和头像，不再要求绑定GitHub——没有GitHub id（邮箱、Google登录）不算游客，是真实成员（#274 SPEC §3.6，论坛用户编号改成a<序号>，有GitHub id的仍是m<GitHub id>并保留GitHub头像）；sid过期删除会话，上游拒绝token经全局处理时删会话并审计；游客不刷新成员记录。

本地表读取：forum_users, forum_follows, forum_notifications, forum_counters, sessions, role_assignments, departments, titles, forum_likes。本地表写入：forum_follows, forum_notifications, forum_counters, forum_users, sessions, activity_events。

源码：[app/server/src/routes/forum-api/people.ts:24](../../../app/server/src/routes/forum-api/people.ts#L24)。验证入口：[tests/server/forum.test.ts](../../../tests/server/forum.test.ts)。

## 标记本人通知已读

`POST /api/forum/notifications/:notification_id/read` · `flow:forum.notifications.read`

权限与资源：requireMember：有效站内会话且账号 active；registered、邮箱和 Google 登录也可解析为论坛账号，不以 CONSOLE_ORG 成员资格授权；主体由服务端 forumViewer 确定，客户端 userId/role 不能赋权。 SQL 同时匹配通知 id 与 recipient_id，不能标记他人通知。

响应与错误：200 {changes,viewer}；只返回本次变动记录，成员自己的用户记录总携带，私有记录按本人范围投影。；不存在或属于他人均404。

数据与副作用：仅更新本人该条read=1，不删通知；其他人的通知设置不下发。

身份条件副作用：forumViewer按会话的账号（account_id）认人创建/刷新forum_users的角色、称号和头像，不再要求绑定GitHub——没有GitHub id（邮箱、Google登录）不算游客，是真实成员（#274 SPEC §3.6，论坛用户编号改成a<序号>，有GitHub id的仍是m<GitHub id>并保留GitHub头像）；sid过期删除会话，上游拒绝token经全局处理时删会话并审计；游客不刷新成员记录。

本地表读取：forum_notifications, sessions, role_assignments, departments, titles, forum_users, forum_likes。本地表写入：forum_notifications, forum_users, sessions, activity_events。

源码：[app/server/src/routes/forum-api/people.ts:33](../../../app/server/src/routes/forum-api/people.ts#L33)。验证入口：[tests/server/forum.test.ts](../../../tests/server/forum.test.ts)。

## 标记本人全部通知已读

`POST /api/forum/notifications/read-all` · `flow:forum.notifications.read_all`

权限与资源：requireMember：有效站内会话且账号 active；registered、邮箱和 Google 登录也可解析为论坛账号，不以 CONSOLE_ORG 成员资格授权；主体由服务端 forumViewer 确定，客户端 userId/role 不能赋权。 仅处理 recipient_id 等于本人的通知。

响应与错误：200 {changes,viewer}；只返回本次变动记录，成员自己的用户记录总携带，私有记录按本人范围投影。；没有未读通知仍返回合法空变更。

数据与副作用：UPDATE本人未读行并RETURNING id，据此只回变动通知，不清除别人的未读数。

身份条件副作用：forumViewer按会话的账号（account_id）认人创建/刷新forum_users的角色、称号和头像，不再要求绑定GitHub——没有GitHub id（邮箱、Google登录）不算游客，是真实成员（#274 SPEC §3.6，论坛用户编号改成a<序号>，有GitHub id的仍是m<GitHub id>并保留GitHub头像）；sid过期删除会话，上游拒绝token经全局处理时删会话并审计；游客不刷新成员记录。

本地表读取：forum_notifications, sessions, role_assignments, departments, titles, forum_users, forum_likes。本地表写入：forum_notifications, forum_users, sessions, activity_events。

源码：[app/server/src/routes/forum-api/people.ts:39](../../../app/server/src/routes/forum-api/people.ts#L39)。验证入口：[tests/server/forum.test.ts](../../../tests/server/forum.test.ts)。

公开资料投影说明（GitHub #271）：state/changes/user/search/suggest/@提及使用已有 account_profiles 的 username/display_name/bio/avatar_url，经纯 DTO mapper 转换；历史作者不必再次访问。canonical 昵称为空或没有上传头像时，identity-store 按 account_id 批量只读当前 login/avatar 作为 fallback，不读取 forum_users 的旧缓存、不按邮箱合并，也不返回 provider uid、状态、邮箱或实名；findMany 仍按批读取且不 ensure 缺行，legacy/guest/official 保留原投影，不重写作者 id/正文。对应回归为 tests/server/public-profile-consumers.test.ts。

## 修改本人论坛资料

`PATCH /api/forum/me/profile` · `flow:forum.profile.update`

权限与资源：requireMember：有效站内会话且账号 active；registered、邮箱和 Google 登录也可解析为论坛账号，不以 CONSOLE_ORG 成员资格授权；主体由服务端 forumViewer 确定，客户端 userId/role 不能赋权。 只修改本人记录；允许昵称、签名、所在地、https网站与通知设置，不接收用户角色授权。

响应与错误：200 {changes,viewer}；只返回本次变动记录，成员自己的用户记录总携带，私有记录按本人范围投影。；400昵称/控制字符/网址等错误；旧昵称未变时不因新昵称规则阻止修改其他字段。

数据与副作用：昵称 NFKC 与冒名检查后保存，检查和 @提及/搜索/建议都使用当前 canonical username。已有 account_profiles 行时，昵称/简介与 forum_users 兼容字段在同一事务写；缺行历史作者保留原字段，不隐式建档。location/website/notifyPrefs 仍只更新论坛字段，不更改 GitHub 资料。

身份条件副作用：forumViewer按会话的账号（account_id）认人创建/刷新forum_users的角色、称号和头像，不再要求绑定GitHub——没有GitHub id（邮箱、Google登录）不算游客，是真实成员（#274 SPEC §3.6，论坛用户编号改成a<序号>，有GitHub id的仍是m<GitHub id>并保留GitHub头像）；sid过期删除会话，上游拒绝token经全局处理时删会话并审计；游客不刷新成员记录。

本地表读取：forum_users, account_profiles, sessions, users, perm_members, perm_groups, activity_events, forum_likes。本地表写入：account_profiles, forum_users, sessions, activity_events。

源码：[app/server/src/routes/forum-api/people.ts:45](../../../app/server/src/routes/forum-api/people.ts#L45)。验证入口：[tests/server/forum.test.ts](../../../tests/server/forum.test.ts)。

## 上传本人论坛头像

`PUT /api/forum/me/avatar` · `flow:forum.avatar.upload`

权限与资源：requireMember：有效站内会话且账号 active；registered、邮箱和 Google 登录也可解析为论坛账号，不以 CONSOLE_ORG 成员资格授权；主体由服务端 forumViewer 确定，客户端 userId/role 不能赋权。 onRequest 阶段即鉴权并消费每小时 10 次额度，解码失败也计次；只改本人头像。

响应与错误：200 {changes,viewer}；只返回本次变动记录，成员自己的用户记录总携带，私有记录按本人范围投影。；413 avatar_too_large，415 unsupported_media_type，400非法图像/尺寸，429限流。

数据与副作用：PNG/JPEG/WebP最多2MB、4096×4096；sharp取首帧转256×256 WebP去元数据；按哈希写 forum_avatars 并更新本人旧引用；已有 canonical 档案时同事务写 account_avatars/account_profiles，公开投影优先统一头像路径；同事务按各表引用清理无人引用的旧头像，不做全库搬迁。

身份条件副作用：forumViewer按会话的账号（account_id）认人创建/刷新forum_users的角色、称号和头像，不再要求绑定GitHub——没有GitHub id（邮箱、Google登录）不算游客，是真实成员（#274 SPEC §3.6，论坛用户编号改成a<序号>，有GitHub id的仍是m<GitHub id>并保留GitHub头像）；sid过期删除会话，上游拒绝token经全局处理时删会话并审计；游客不刷新成员记录。

本地表读取：forum_avatars, forum_users, account_profiles, account_avatars, forum_rate_events, sessions, users, perm_members, perm_groups, forum_likes。本地表写入：account_profiles, account_avatars, forum_avatars, forum_users, forum_rate_events, sessions, activity_events。

源码：[app/server/src/routes/forum-api/people.ts:93](../../../app/server/src/routes/forum-api/people.ts#L93)。验证入口：[tests/server/forum.test.ts](../../../tests/server/forum.test.ts)。

## 恢复本人默认头像

`DELETE /api/forum/me/avatar` · `flow:forum.avatar.clear`

权限与资源：requireMember：有效站内会话且账号 active；registered、邮箱和 Google 登录也可解析为论坛账号，不以 CONSOLE_ORG 成员资格授权；主体由服务端 forumViewer 确定，客户端 userId/role 不能赋权。 只清本人自定义头像。

响应与错误：200 {changes,viewer}；只返回本次变动记录，成员自己的用户记录总携带，私有记录按本人范围投影。

数据与副作用：事务清除 forum_users 和已有 account_profiles 的 avatar_hash，各自清理无引用旧图；保留绑定头像字段作为公开 DTO 的回退，不删除用户、不为缺档案作者补建档案。

身份条件副作用：forumViewer按会话的账号（account_id）认人创建/刷新forum_users的角色、称号和头像，不再要求绑定GitHub——没有GitHub id（邮箱、Google登录）不算游客，是真实成员（#274 SPEC §3.6，论坛用户编号改成a<序号>，有GitHub id的仍是m<GitHub id>并保留GitHub头像）；sid过期删除会话，上游拒绝token经全局处理时删会话并审计；游客不刷新成员记录。

本地表读取：forum_users, forum_avatars, account_profiles, account_avatars, sessions, users, perm_members, perm_groups, forum_likes。本地表写入：account_profiles, account_avatars, forum_users, forum_avatars, sessions, activity_events。

源码：[app/server/src/routes/forum-api/people.ts:104](../../../app/server/src/routes/forum-api/people.ts#L104)。验证入口：[tests/server/forum.test.ts](../../../tests/server/forum.test.ts)。

## 读取公开头像文件

`GET /api/forum/avatars/:file` · `flow:forum.avatar.read`

权限与资源：匿名；按合同限定的哈希.webp取文件，不接受磁盘路径。

响应与错误：200 image/webp二进制，immutable一年缓存、default-src none和nosniff；不存在404。

数据与副作用：按哈希读取SQLite内WebP数据，不读取私有快照文件或解析sid。

本地表读取：forum_avatars。本地表写入：无。

源码：[app/server/src/routes/forum-api/people.ts:112](../../../app/server/src/routes/forum-api/people.ts#L112)。验证入口：[tests/server/forum.test.ts](../../../tests/server/forum.test.ts)。

## 读表情包列表（#276 CONTRACT §3）

`GET /api/forum/stickers` · `flow:forum.stickers.list`

权限与资源：公开只读，不要求登录，不判身份。

响应与错误：200 {packs:[{id,name,stickers:[{id,shortcode,label,url}]}]}，只含enabled=1的包与表情；进程内缓存60秒，控制台改过表情后显式invalidate这个key。url由服务端按CDN开关决定（#286，STATIC_CDN_BASE）：开关关闭全是同源/api/forum/stickers/<哈希>.webp；开关打开，清单（app/server/assets/stickers/manifest.json）里的内置表情是CDN绝对地址https://cdn.yangtzeu.work/geek-public/static/site/forum/stickers/<哈希>.webp，站长在控制台上传的、不在清单里的仍是同源地址。

数据与副作用：纯读，不写任何表；短码即表情id，前端据此渲染正文里的短码。

本地表读取：forum_sticker_packs, forum_stickers。本地表写入：无。

源码：[app/server/src/routes/forum-api/stickers.ts:11](../../../app/server/src/routes/forum-api/stickers.ts#L11)。验证入口：[tests/server/forum-v2-endpoints.test.ts](../../../tests/server/forum-v2-endpoints.test.ts)。

## 按内容哈希取表情图片

`GET /api/forum/stickers/:file` · `flow:forum.stickers.read_file`

权限与资源：公开只读，不要求登录；文件名必须是64位小写十六进制哈希加.webp。

响应与错误：200 webp图片，Cache-Control: public, max-age=31536000, immutable（middleware/http-policy.ts 给/api响应统一加的no-store对这条路径的200不生效，#286；404仍是no-store），不带Content-Encoding；不存在404 not_found，不泄露哈希是否曾经存在过。开关打开时内置表情的图片由CDN提供，这条路由是退路，也是站长上传的表情的唯一来源。

数据与副作用：纯读，按sha256寻址；内容永不改变，不需要失效缓存。

本地表读取：forum_sticker_files。本地表写入：无。

源码：[app/server/src/routes/forum-api/stickers.ts:13](../../../app/server/src/routes/forum-api/stickers.ts#L13)。验证入口：[tests/server/forum-v2-endpoints.test.ts](../../../tests/server/forum-v2-endpoints.test.ts)。

## 帖子正文的图片上传（#276 CONTRACT §5）

`PUT /api/forum/uploads` · `flow:forum.uploads.create`

权限与资源：需要forum.upload.image节点（level.member才有），由onRequest在读请求体之前就判定——访客连大请求体都不会被读进内存，直接401 signin_required；登录但没有该节点403 forbidden。

响应与错误：200 {url,width,height}；超过5MB请求体413 upload_too_large；超过4096×4096像素在解码前拦住400 image_too_large；不支持的内容类型415 unsupported_media_type；解不出图片400 invalid_image；超过meta.limit.forum.upload.hourly回429 {bucket:"forum.upload.hourly"}（限额检查排在类型校验和解码之前，坏请求也占额度）。

数据与副作用：PNG/JPEG/WebP统一转webp（sharp quality 85），GIF若是动图原样保留；按sha256内容寻址存forum_upload_files，去重不重复存；写审计forum.upload.image。

身份条件副作用：forumViewer按会话的账号认人创建/刷新forum_users；sid过期或账号停用删除会话。

本地表读取：forum_users, sessions, perm_members, perm_entries, perm_groups, limit_events。本地表写入：forum_upload_files, activity_events, forum_users, sessions, limit_events。

源码：[app/server/src/routes/forum-api/uploads.ts:50](../../../app/server/src/routes/forum-api/uploads.ts#L50)。验证入口：[tests/server/forum-v2-endpoints.test.ts](../../../tests/server/forum-v2-endpoints.test.ts)。

## 按内容哈希取上传的图片

`GET /api/forum/uploads/:file` · `flow:forum.uploads.read_file`

权限与资源：公开只读，不要求登录（帖子本身的可见范围由话题可见范围管，这里只管「有没有这个哈希」）。

响应与错误：200原图（png/jpeg/webp转码后的webp，gif原样保留动图），immutable长期缓存；不存在404。

数据与副作用：纯读，按sha256寻址。

本地表读取：forum_upload_files。本地表写入：无。

源码：[app/server/src/routes/forum-api/uploads.ts:65](../../../app/server/src/routes/forum-api/uploads.ts#L65)。验证入口：[tests/server/forum-v2-endpoints.test.ts](../../../tests/server/forum-v2-endpoints.test.ts)。

## 控制台论坛管理：分类可见范围（#276 CONTRACT §8）

`GET /api/console/forum/categories` · `flow:console.forum.categories.list`

权限与资源：requirePermission("forum.category.manage")——没有效会话401 unauthenticated，没有这个节点403 forbidden（带node）。

响应与错误：200 {categories:[{id,name,visibility,topic_count}]}，按curation.json的分类顺序；topic_count是真实话题数，不按身份过滤（管理员看全量）。

数据与副作用：纯读；只有loadSession发现会话过期才会删那一行会话。

本地表读取：sessions, users, perm_members, perm_entries, perm_groups, forum_topics, forum_category_settings。本地表写入：sessions。

源码：[app/server/src/routes/console/forum.ts:18](../../../app/server/src/routes/console/forum.ts#L18)。验证入口：[tests/server/forum-v2-endpoints.test.ts](../../../tests/server/forum-v2-endpoints.test.ts)。

## 控制台改一个分类的可见范围

`PATCH /api/console/forum/categories/:id` · `flow:console.forum.categories.update`

权限与资源：requirePermission("forum.category.manage") + requireStepUp（所有写操作要求刚登录过，10分钟窗口）；没权限403 forbidden，没step-up 403 step_up_required；未知分类404 not_found。

响应与错误：200 {id,visibility}。

数据与副作用：按category_id upsert forum_category_settings（ON CONFLICT覆盖），写审计forum.category.visibility。

本地表读取：sessions, users, perm_members, perm_entries, perm_groups, forum_category_settings。本地表写入：forum_category_settings, activity_events, sessions。

源码：[app/server/src/routes/console/forum.ts:22](../../../app/server/src/routes/console/forum.ts#L22)。验证入口：[tests/server/forum-v2-endpoints.test.ts](../../../tests/server/forum-v2-endpoints.test.ts)。

## 控制台论坛管理：表情包与表情

`GET /api/console/forum/stickers` · `flow:console.forum.stickers.list`

权限与资源：requirePermission("forum.sticker.manage")；没权限403 forbidden。

响应与错误：200 {packs:[{id,name,sort,enabled,stickers:[{id,shortcode,label,url,sort,enabled,use_count}]}]}，含停用的包/表情（管理员要看得到才能重新启用）；url同公开列表，按CDN开关给同源或CDN地址。

数据与副作用：纯读；use_count由forum_reactions按sticker_id聚合算出，不是单独维护的列。

本地表读取：sessions, users, perm_members, perm_entries, perm_groups, forum_sticker_packs, forum_stickers, forum_reactions。本地表写入：sessions。

源码：[app/server/src/routes/console/forum.ts:36](../../../app/server/src/routes/console/forum.ts#L36)。验证入口：[tests/server/forum-v2-endpoints.test.ts](../../../tests/server/forum-v2-endpoints.test.ts)。

## 控制台改表情包或单个表情

`PATCH /api/console/forum/sticker-packs/:id`、`PATCH /api/console/forum/stickers/:id` · `flow:console.forum.sticker_packs.update`、`flow:console.forum.stickers.update`

权限与资源：都是requirePermission("forum.sticker.manage") + requireStepUp；未知id404 not_found。

响应与错误：200 {ok:true}。

数据与副作用：按传了的字段UPDATE对应表（forum_sticker_packs 或 forum_stickers）；成功后invalidate公开列表缓存（forum:stickers）；写审计forum.sticker_pack.update 或 forum.sticker.update。

本地表读取：sessions, users, perm_members, perm_entries, perm_groups, forum_sticker_packs 或 forum_stickers。本地表写入：对应表, activity_events, sessions。

源码：[app/server/src/routes/console/forum.ts:57](../../../app/server/src/routes/console/forum.ts#L57)（sticker-packs/:id）、[:68](../../../app/server/src/routes/console/forum.ts#L68)（stickers/:id）。验证入口：[tests/server/forum-v2-endpoints.test.ts](../../../tests/server/forum-v2-endpoints.test.ts)。

## 控制台新建表情包

`POST /api/console/forum/sticker-packs` · `flow:console.forum.sticker_packs.create`

权限与资源：requirePermission("forum.sticker.manage") + requireStepUp；body {id,name}，id 是小写字母、数字和连字符（1–40 位，字母或数字开头），name 1–64 字，前后空白去掉。

响应与错误：201 {id,name}；id 已被占用回409 pack_id_taken；格式不对400。

数据与副作用：插一行 forum_sticker_packs（enabled=1，sort 排在现有最后）；新包是空的，公开面板只画有表情的包，往里加表情后才出现；成功后invalidate公开列表缓存，写审计forum.sticker_pack.create。

本地表读取：sessions, users, perm_members, perm_entries, perm_groups, forum_sticker_packs。本地表写入：forum_sticker_packs, activity_events, sessions。

源码：[app/server/src/routes/console/forum.ts:46](../../../app/server/src/routes/console/forum.ts#L46)。验证入口：[tests/server/forum-v2-endpoints.test.ts](../../../tests/server/forum-v2-endpoints.test.ts)。

## 控制台给表情包新增一个表情

`PUT /api/console/forum/sticker-packs/:id/stickers` · `flow:console.forum.stickers.create`

权限与资源：requirePermission("forum.sticker.manage") + requireStepUp；请求体是图片本身（PNG/JPEG/WebP，≤2MB），类型不对415。

响应与错误：201 {id,shortcode,label}；shortcode已被（含停用的旧表情）占用回409 shortcode_taken，不会撞成裸的500；表情包不存在404 not_found。

数据与副作用：复用头像同一套转码（256×256 webp，按sha256去重存forum_sticker_files），表情id就是shortcode；成功后invalidate公开列表缓存，写审计forum.sticker.create。

本地表读取：sessions, users, perm_members, perm_entries, perm_groups, forum_stickers。本地表写入：forum_sticker_files, forum_stickers, activity_events, sessions。

源码：[app/server/src/routes/console/forum.ts:80](../../../app/server/src/routes/console/forum.ts#L80)。验证入口：[tests/server/forum-v2-endpoints.test.ts](../../../tests/server/forum-v2-endpoints.test.ts)。

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

## 提供论坛Markdown索引（Nitro入口）

`interface:forum.llms` · `GET,HEAD /llms.txt` · `flow:forum.markdown.index`

权限与资源：demo 与明确本机快照模式按本地来源生成；site 开发模式把请求、cookie 和方法代理到核心 `/forum/llms.txt`，不读取 `published` 源正文。

响应与错误：demo/快照 200 `text/plain`；site 原样返回核心的200/429等状态、`private, no-store` 与权限投影，失败不回退静态索引。

数据与副作用：demo/快照无SQLite；site 的数据/副作用由上面的核心动态出口承担。生产 site 镜像不携带此文件，外部入口由web直达核心。

验证：[tests/tooling/forum-site-content.test.ts](../../../tests/tooling/forum-site-content.test.ts)、[app/forum/tests/forum-markdown.test.ts](../../../app/forum/tests/forum-markdown.test.ts)。

## 提供话题Markdown正文（Nitro入口）

`interface:forum.topic-markdown` · `GET,HEAD /t/:id.md` · `flow:forum.markdown.topic`

权限与资源：demo/快照按原本地合同生成；site 开发代理核心 `/forum/t/:id.md`，不能二次解码路径，不能在核心拒绝后回退源正文。

响应与错误：demo/快照未知话题404；site原样返回核心的200/401/403/404与缓存头。生产 site 镜像不含 `t/*.md`，直接访问论坛容器返回404。

数据与副作用：demo/快照无SQLite；site由核心按当前viewer读取。验证同上。

## 代理site旧帖图片（Nitro入口）

`interface:forum.published-proxy` · `GET,HEAD /published/:file` · `flow:forum.published.proxy`

权限与资源：site 开发仅匹配16位小写十六进制webp并代理核心 `/forum/published/:file`；demo继续使用自己的public静态图片。

响应与错误：site原样返回核心200/404和`private, no-store`；失败不回退本地图片。生产 site 镜像删除published目录，外部入口由web直达核心。

数据与副作用：Nitro本身不读写SQLite。验证：[tests/tooling/forum-site-content.test.ts](../../../tests/tooling/forum-site-content.test.ts)。

## 比赛信息发布

五个比赛操作（#238）的请求字段、成功响应以及共同 `4xx` / `5xx` 错误体由 [competition-contract.ts](../../../app/server/src/lib/competition-contract.ts) 与所属路由 `contracts.ts` 实际挂载。公开 DTO 与控制台 DTO 分开，控制台仅多 `offline`；内部创建/更新时间、成员和权限信息不混入公开回答。既有其他端点仍按目录记录响应 Schema 缺口，不因此声称全站已是完整 OpenAPI。

| 操作与用例 | 权限与资源 | 成功、失败和副作用 |
|---|---|---|
| `GET /api/public/competitions` · `flow:competition.public.list` | 匿名，只返回未下线赛事 | 200 `{ competitions }`；六种时间状态（含规划中 `planning`，#278 重开）与排序见 [API](../../architecture/API.md)「比赛信息发布合同」。不读取会话或成员、不写库、不发外部请求；空列表合法。 |
| `GET /api/console/competitions` · `flow:competition.console.list` | 有效 `sid` 与 `console.access`；页面导航仍需 `competitions.manage` | 200 `{ competitions }` 含 `offline`；401 未登录、403 缺能力。共同身份路径会读称号/部门与 GitHub 角色缓存；会话过期或令牌被拒才产生删除/审计等条件副作用。 |
| `POST /api/console/competitions` · `flow:competition.create` | `competitions.manage`，每分钟 30 次，固定本环境组织 | 201 `{ competition }`；400 `validation_error` / `bad_name` / `bad_url` / `bad_range` / `deadline_after_end`，401、403、429；比赛与 `competition.create` 审计在同一事务提交。 |
| `PATCH /api/console/competitions/:competition_id` · `flow:competition.update` | 同一管理能力，每分钟 60 次 | 200 `{ competition }`；在原记录与补丁合并后验证，缺记录 404，其他拒绝同新建。省略字段保留，null 清空可空字段；下线不删除，恢复沿用原 id。更新与审计同一事务。 |
| `DELETE /api/console/competitions/:competition_id` · `flow:competition.delete` | 同一管理能力，每分钟 30 次 | 200 `{ ok: true }`，真删；不存在或重复删除 404。删除与审计同一事务，审计失败返回 500 且保留赛事。 |

这些操作不实现参赛、队伍或通知邮件；报名与组队由下面 #239 的接口承担，比赛写入与报名设置共用同一张错误码表。写入与审计任何一步失败都回滚；GitHub 身份检查在事务前完成，不把网络等待放进 SQLite 事务。源码：[console/competitions.ts](../../../app/server/src/routes/console/competitions.ts)、[portal/competitions.ts](../../../app/server/src/routes/portal/competitions.ts)、[competition-store.ts](../../../app/server/src/lib/competition-store.ts)。验证入口：[真实路由与审计故障回归](../../../tests/server/competitions.test.ts)、[两尺寸浏览器业务回归](../../../tests/e2e/competitions.spec.mts)。

新增 `competitions.manage` 同时扩展 `POST /api/console/departments`、`PATCH /api/console/departments/:department_id`、`PATCH /api/console/titles/:title_id` 的权限包枚举。这三条在原有行为上补成功响应 Schema：部门保留 `created_at`、`updated_at`、`heads`、`crew_count` 与原有全部字段；称号保留显示字段及 `capabilities`。它们的授权、存储与审计执行逻辑不变，错误仍走原处理器。既有权限包不会因能力清单新增而自动获得管理比赛权限；有权限的管理者可通过原接口明确授予，回归见 `tests/server/competitions.test.ts`。

## 比赛报名、组队与积分（#239）

比赛、队伍、成员与积分的请求体、成功响应和共同 `4xx` / `5xx` 错误体由 [competition-contract.ts](../../../app/server/src/lib/competition-contract.ts) 与两个 `contracts.ts` 实际挂载；门户成员接口的响应是我的状态、队伍、找队友、我的参赛或天梯，控制台接口的响应是设置、名单、积分记录或 CSV。所有报名/团队写操作「未定榜、不在规划中、已开放报名且在报名中」才可执行：规划中（`planning`，#278 重开）回 409 `competition_planning`，截止后整场只读；写操作在事务里重读状态再写，成功都回最新状态。规则只在 [competition-signup-store.ts](../../../app/server/src/lib/competition-signup-store.ts) 与 [competition-score-store.ts](../../../app/server/src/lib/competition-score-store.ts)，路由只做鉴权、限流与错误码映射。门户成功写操作与 `activity_events` 同事务，操作记录失败回滚；成功立即失效本场公开缓存。定榜后报名及设置拒409 `competition_finalized`，延长日期也不解除冻结；成员榜同用冻结名次。

| 方法与路径 | 谁 | 成功与副作用 |
|---|---|---|
| `GET /api/me/competitions` · `flow:competition.me.list` | 登录且是极客班成员 | 200 `{ items, pending_total }`：我报名的比赛与状态、队伍摘要、本人待处理数；只读，不写审计。 |
| `GET /api/competitions/:id/my-status` · `flow:competition.my_status` | 同上 | 200 我的状态：`settings`、`writable`、`signup`、`state`、`team`、`role`、`pending`、`stats`、`actions`；`actions` 只列此刻服务端会接受的操作。 |
| `POST /api/competitions/:id/signup` · `flow:competition.signup.upsert` | 同上，30 次/分钟 | 200 我的状态；重复报名幂等，保留 `created_at`，已取消的报名恢复为 `active`。 |
| `DELETE /api/competitions/:id/signup` · `flow:competition.signup.cancel` | 同上，30 次/分钟 | 200 我的状态；报名改 `cancelled`、队员退出、单人的队伍解散，本人待处理项关闭；已确认的队伍要先撤销确认。 |
| `GET /api/competitions/:id/teams` · `flow:competition.teams.list` | 同上 | 200 `{ teams }`：未解散队伍与在队成员；不含任何人的待处理项。 |
| `GET /api/competitions/:id/free-agents` · `flow:competition.free_agents.list` | 同上 | 200 `{ people }`：已报名、在找队伍且未入队的人与本人留言。 |
| `POST /api/competitions/:id/teams` · `flow:competition.team.create` | 同上，30 次/分钟 | 201 我的状态；建队人即领队，不隐式报名。 |
| `POST /api/teams/:id/apply` · `flow:competition.team.apply` | 同上，30 次/分钟 | 201 我的状态；写一条 `applied` 成员关系。 |
| `POST /api/teams/:id/invite` · `flow:competition.team.invite` | 领队，30 次/分钟 | 201 我的状态；被邀请人须已报名、未入队且账号 active。 |
| `POST /api/teams/:id/respond` · `flow:competition.team.respond` | 领队或当事人，30 次/分钟 | 200 我的状态；`accept`、`decline`、`withdraw`，成员关系必须属于路径上的队伍。 |
| `POST /api/teams/:id/leave` · `flow:competition.team.leave` | 队员，30 次/分钟 | 200 我的状态；领队不能直接退出。 |
| `POST /api/teams/:id/transfer` · `flow:competition.team.transfer` | 领队，30 次/分钟 | 200 我的状态；同一事务改队伍领队与两条成员关系的角色。 |
| `DELETE /api/teams/:id` · `flow:competition.team.disband` | 领队，30 次/分钟 | 200 我的状态；队伍与成员记录只改状态。 |
| `POST /api/teams/:id/lock`、`DELETE /api/teams/:id/lock` · `flow:competition.team.lock`、`flow:competition.team.unlock` | 领队，30 次/分钟 | 200 我的状态；确认参赛关闭本队其余待处理项，撤销确认回到招募中。 |
| `POST /api/teams/:id/plaza`、`DELETE /api/teams/:id/plaza` · `flow:competition.team.plaza.publish`、`flow:competition.team.plaza.withdraw`（#278 重开） | 领队，30 次/分钟 | 200 我的状态；开关「还在招募」、写备注与想要的技能，和 `status` 的 recruiting/locked 是两件事；撤下只关广播，备注与技能照留。 |
| `GET /api/team-plaza` · `flow:competition.team_plaza.list`（#278 重开） | 登录且持有报名或组队任一权限节点 | 200 `{ items: [{ kind, competition_id, competition_name, note, since, person, team_id, team_name, slogan, leader, member_count, team_max, wanted_skills }], next_cursor }`；跨「当前在报名中」的全部比赛汇总想找队伍的人（`kind:"seeking_team"`）与还在招募的队伍（`kind:"recruiting_team"`），两种条目合成一张表，另一种用不到的字段为 `null`；支持 `competition_id`、`kind`、`keyword` 筛选与 `cursor`/`limit` 分页（默认 20、最多 50），只读不产生任何写入。 |
| `GET /api/competitions/:id/leaderboard` · `flow:competition.leaderboard.read` | 登录且是极客班成员 | 200 `{ updated_at, individuals, teams }`；没有开启积分 409 `scoring_not_enabled`。 |
| `GET /api/public/competitions/:id` · `flow:competition.public.detail` | 匿名 | 200 单场公开信息与报名摘要；下线与不存在都 404。#278 起成功与失败都带 `Access-Control-Allow-Origin: *`、按 IP 限流，并加了官网相关字段，见下一节。 |
| `PUT /api/console/competitions/:competition_id/signup-settings` · `flow:competition.signup_settings.update` | `competitions.manage`，30 次/分钟 | 200 `{ settings }`；写 `competition.signup_settings.update` 审计，与写入同一事务。 |
| `GET /api/console/competitions/:competition_id/roster` · `flow:competition.roster.read` | 同上 | 200 `{ settings, stats, signups, teams }`；报名含已取消的，队伍含已解散的。 |
| `GET /api/console/competitions/:competition_id/roster.csv` · `flow:competition.roster.export` | 同上，5 次/分钟 | 200 `text/csv`（BOM、CRLF、北京时间列），写 `competition.roster.export` 审计（`details { rows }`）。 |
| `GET`、`POST /api/console/competitions/:competition_id/score-events` · `flow:competition.score_events.list`、`flow:competition.score_events.create` | `competition.score.review`；写再要 step-up，30 次/分钟 | 200 `{ events }`；201 `{ event }`，写 `competition.score.add` 审计。#278 起登记不收 `points`：Issue 和 PR 带两档 `importance` / `core`、扣分不带，分值由服务端查表，见下一节。 |
| `POST /api/console/competitions/:competition_id/score-events/:event_id/revoke` · `flow:competition.score_events.revoke` | 同上，30 次/分钟 | 200 `{ event }`；只改状态并记撤销人与原因，写 `competition.score.revoke` 审计；审核/撤销本人记录403 `self_review`（包括本人扣分）。 |

错误的形状与其它接口一致（`{ error, message }`）。状态冲突一律 409，输入不合法才 400：

| 状态码 | `error` | 场景 |
|---|---|---|
| 400 | `bad_note`、`bad_team_name`、`bad_slogan`、`bad_message`、`bad_team_size`、`bad_repo`、`bad_number`、`bad_levels` | 备注、队名、口号、留言、人数、仓库、编号不合法，或 Issue / PR 没选两档、扣分选了两档 |
| 401 | `not_signed_in` | 没有会话 |
| 403 | `not_member`、`not_team_leader` | 不是极客班成员；不是本队领队 |
| 404 | `not_found`、`team_not_found` | 比赛不存在或下线、队伍不存在或已解散、成员关系不属于路径上的队伍 |
| 409 | `competition_planning` | 比赛还在规划中，组织者还没开放报名（#278 重开，压过下面两条） |
| 409 | `signup_not_enabled`、`signup_closed` | 未开放报名；不在报名中（截止后整场只读） |
| 409 | `not_signed_up`、`individual_competition`、`already_in_team` | 未报名；个人赛不能组队；已在队 |
| 409 | `already_applied`、`already_invited`、`invitee_not_signed_up`、`target_not_member` | 已有待处理关系；对方未报名；对方账号已停用或已不是成员 |
| 409 | `team_full`、`team_too_small`、`team_locked`、`duplicate_team_name`、`is_team_leader`、`invalid_state` | 满员；人数不够确认；队伍已确认；队名重复；领队要先转让或解散；申请或邀请已处理 |
| 409 | `deadline_required`、`has_signups`、`kind_locked`、`team_size_conflict` | 控制台：开报名缺截止时间；有报名后改形式或删比赛；有报名后改内外部；新人数与现有队伍冲突 |
| 409 | `scoring_not_enabled`、`duplicate_score_event`、`already_revoked` | 没有开启积分；同一条 Issue/PR 已记分；这条积分已撤销 |
| 429 | `rate_limited` | 成员写操作超 30 次/分钟，或名单导出超 5 次/分钟 |

验证入口：[报名、组队与名单](../../../tests/server/competition-signups.test.ts)、[积分与天梯](../../../tests/server/competition-scores.test.ts)、[旧库重启与种子](../../../tests/server/legacy-database.test.ts)。

## 比赛官网托管、公开接口、贡献收集、定榜与兑奖（#278）

规则来自交接目录的 CONTRACT-278 与所有者 2026-10-24 13:45、16:59 的补充：只有标记「有用」的 Issue / MR 加分，按重要程度 × 核心度两档查表得基础分（不看代码行数），再乘这场比赛的年级系数，每人每周「一般 × 边缘」只算 1 条；天梯几秒到十几秒内更新，奖项可选，定榜后凭兑奖码兑奖。表、系数默认值与模拟见 [COMPETITION-APP「计分规则」](../../plan/COMPETITION-APP.md#计分规则2026-10-24)，规则只在 [competition-rubric.ts](../../../app/server/src/lib/competition-rubric.ts) 一份。请求体、成功响应与共同错误体由 [competition-contract.ts](../../../app/server/src/lib/competition-contract.ts) 与两个 `contracts.ts` 挂载；控制台写操作全部要 step-up（10 分钟内登录过），和写入同一事务记操作记录（surface `console`，action 前缀 `competition.`）。

| 方法与路径 | 谁 | 成功与副作用 |
|---|---|---|
| `GET /c/:slug`、`GET /c/:slug/*` · `flow:competition.site.redirect`、`flow:competition.site.serve` | 匿名 | 读已发布版本的文件：目录回 `index.html`，没有扩展名但有同名目录的 301 到带 `/` 的地址；比赛下线、不是内部赛、没发布或文件不存在 404。所有响应带 sandbox CSP（见 [SECURITY](../../architecture/SECURITY.md)「比赛官网」）、`Cache-Control`（HTML 是 `no-cache`，换版本后浏览器不会拿旧页面去找已经不在的资源文件；其它文件 `public, max-age=300`）、`nosniff`、`Access-Control-Allow-Origin: *`，去掉 `Set-Cookie`。 |
| `GET /c/:slug/~preview/:version_id/*` · `flow:competition.site.serve` | 会话有 `competition.site.publish` | 302 到 `~preview/<version_id>.<到期秒>.<签名>/`，签名覆盖比赛、版本与到期时间（HMAC，`SESSION_SECRET`），一小时有效；签名地址不看会话（sandbox 页面的子资源请求不带 cookie），`Cache-Control: private, no-store`。没有权限、版本没通过或不属于这场比赛一律 404，不暴露版本在不在。没有 slug 的比赛用比赛 id 预览。 |
| `GET /api/console/competitions/:competition_id/site` · `flow:competition.site.read` | `competition.manage` 或 `competition.site.publish` | 200 `{ slug, live_version_id, site_url, versions }`；每个版本带 `report`（逐条原因）、上传人、`preview_url`（只有通过的版本有）。 |
| `POST /api/console/competitions/:competition_id/site/versions` · `flow:competition.site.upload` | `competition.site.publish` + step-up，10 次/分钟 | 请求体是 zip（`Content-Type: application/zip`，上限 20MB）；201 版本行；校验不通过 422 `{ error: "site_rejected", report }`，只留一条 `rejected` 版本、不落文件；外部赛 409 `competition_not_internal`。校验规则见 [lib/site-package.ts](../../../app/server/src/lib/site-package.ts)：≤500 个文件、解压后 ≤50MB、扩展名白名单、拒绝绝对路径、`..`、空段、以 `.` 开头的段、符号链接、加密、zip64、重复文件，解压时按声明大小封顶并核对 CRC；根目录要有 `index.html` 与 `yzgc-site.json`（`name`、`version`、`sdk`，可选的 `competition_id` 要等于这场比赛）。写 `competition.site.upload`。 |
| `POST /api/console/competitions/:competition_id/site/publish` · `flow:competition.site.publish` | 同上，30 次/分钟 | body `{ version_id, slug? }`；200 发布状态。第一次发布必须带 slug（`^[a-z0-9][a-z0-9-]{2,31}$`），之后不能改（409 `slug_locked`），被别的比赛占用 409 `slug_taken`；回滚就是发布旧版本。写 `competition.site.publish`（带上一个在线版本）。 |
| `DELETE /api/console/competitions/:competition_id/site` · `flow:competition.site.unpublish` | 同上 | 200 发布状态；在线版本置空，版本与 slug 保留；没发布 404 `not_published`。写 `competition.site.unpublish`。 |
| `GET /api/public/competitions/:id`（扩展）· `flow:competition.public.detail` | 匿名 | 在原字段上加 `site_url`（已发布时 `/c/<slug>/`）、`app_url`（门户比赛窗口深链 `/?open=competitions&competition=<id>`）、`prizes`、`grade_factors`（`[{ grade, label, factor }]`）、`scoring`（`{ importance: [{ key, label }], core: [{ key, label, hint }], points: [{ kind, importance, core, points }]（18 格）, penalty, trivial_per_week, trivial_percent }`）、`finalized_at`；列表接口每场同样带这些字段。 |
| `GET /api/public/competitions/:id/leaderboard`、`/feed?cursor=&limit=`、`/stats`、`/snapshot` · `flow:competition.public.leaderboard`、`flow:competition.public.feed`、`flow:competition.public.stats`、`flow:competition.public.snapshot` | 匿名，按 IP 每分钟 120 次（四个接口加单场接口、人员、队伍共用一个桶） | 天梯 `{ updated_at, individuals: [{ rank, username, display_name, avatar_url, team_name, score }], teams: [{ rank, name, members, score }] }`；动态 `{ items: [{ id, at, username, display_name, avatar_url, kind, title, url, points, importance, core }], next_cursor }`（有效积分，新的在前，扣分不给标题、链接和原因；两档在扣分和两档评定之前的记录上为 null；被防刷记成 0 分的照样出现）；统计 `{ participants, teams, merged_prs, accepted_issues, total_points, updated_at }`；快照一次给齐四样（SDK 轮询用，CONTRACT 之外加的一条）。分数都是加权后的；定榜后个人名次按定榜快照。服务端缓存 10 秒，加分、撤销、标记有用、改规则、发布官网、定榜时按比赛清掉。成功、404 与 429 都带 `Access-Control-Allow-Origin: *`，不带 `Access-Control-Allow-Credentials`；不读会话。429 `{ error: "rate_limited", bucket: "public.competition.per_minute", retry_after }` 带 `Retry-After`。 |
| `GET /api/public/competitions/:id/participants?cursor=&limit=` · `flow:competition.public.participants` | 匿名，限流与缓存同上 | 人员（站点包必带，CONTRACT 之外加的一条，和天梯不同：给全部已报名、未取消的人，不是只有拿过分的人）：`{ items: [{ username, display_name, avatar_url, department: { id, name, tone } \| null }], next_cursor }`；`limit` 1–200，默认 100；按报名时间与本场隔离SHA-256摘要分页，游标只编码时间与摘要，不含account_id；旧账号ID游标回第一页（见 `lib/competition-public.ts` 的 `decodeParticipantCursor`）；部门字段和 `permissions.accountGroupsView().department` 同一份口径，没分配部门为 `null`。 |
| `GET /api/public/competitions/:id/teams` · `flow:competition.public.teams` | 匿名，限流与缓存同上 | 队伍（站点包必带，CONTRACT 之外加的一条，和天梯不同：给全部未解散的队，不是只有拿过分的队）：`{ enabled, team_min, team_max, teams: [{ name, slogan, status, member_count, members }] }`；这场比赛是个人赛时 `enabled` 为 `false`、`teams` 为空数组，不是 404 或 409——站点包用了这个接口但比赛是个人赛，调用方据此跳过「队伍」这一段。 |
| `GET /api/console/competitions/:competition_id/score-preview?account_id=&kind=&importance=&core=&at=` · `flow:competition.score_events.preview` | `competition.score.review` | 200 `{ points, grade, grade_factor, damp_percent, weighted_points }`：和登记同一段算法（两档查表、此刻的年级系数、`at`（贡献时间，缺省为现在）所在那一周的防刷），不写库；控制台的两个下拉框选完就调。扣分不带两档，带了 400 `bad_levels`；没报名 409 `not_signed_up`。 |
| `GET /api/console/competitions/:competition_id/candidates?status=&cursor=` · `flow:competition.candidates.list` | `competition.score.review` | 200 `{ items, next_cursor, counts, last_run }`，每页 50 条，新的在前；每条带标签上的两档 `importance` / `core`（标签不全时为 null）；`last_run` 是这个进程里最近一次收集（重启后为 null，直到下一轮）。 |
| `POST …/candidates/:candidate_id/accept` · `flow:competition.candidates.accept` | `competition.score.review` + step-up，60 次/分钟 | body `{ importance, core, reason? }`（两档必填，控制台默认选标签上的两档），没选或选错 400 `bad_levels`；同一事务写积分（登记人是审核人，两档查表、按记分时刻的年级加权、按贡献时间套防刷）并把候选置为 `accepted`（`accepted_via = console`）。审核自己的贡献 403 `self_review`；已经标记过 409 `already_accepted`；同一条已有积分 409 `duplicate_score_event`。写 `competition.candidate.accept`。 |
| `POST …/candidates/:candidate_id/reject` · `flow:competition.candidates.reject` | 同上 | body `{ reason }`；已经加过分的连同积分一起撤销。写 `competition.candidate.reject`。积分记录页撤销一条来自候选的积分时，候选跟着变成驳回。 |
| `POST …/candidates/collect` · `flow:competition.candidates.collect` | 同上，6 次/分钟 | 立即收集一次，200 `{ last_run: { at, fetched, created, skipped, accepted, revoked, error } }`；GitLab 同步是 off 或没配 URL 时 409 `gitlab_sync_off`。写 `competition.candidate.collect`。 |
| `GET`、`PUT /api/console/competitions/:competition_id/rules` · `flow:competition.rules.read`、`flow:competition.rules.update` | 看：`competition.manage` 或 `competition.score.review`；改：`competition.manage` + step-up，30 次/分钟 | body `{ grade_factors: { year1…none: 50–500 }, prizes: [{ from, to, amount_cny, title }], gitlab_projects: [] }` 整份替换；系数是百分数（350 = 3.5，第一期默认 350 / 220 / 140 / 100 / 100 / 100）；GET 另带只读的 `scoring`（与公开接口同形）；奖项名次从小到大不重叠、最多 20 档、金额 ≤100000；项目最多 10 个。定榜后 409 `competition_finalized`。写 `competition.rules.update`（带改前改后）。 |
| `GET`、`POST`、`DELETE /api/console/competitions/:competition_id/final` · `flow:competition.final.read`、`flow:competition.finalize`、`flow:competition.unfinalize` | `competition.manage`，写要 step-up，10 次/分钟 | 没定榜时 GET 给现在的严格名次与将要发的奖（`preview`）；POST 定榜：比赛结束后才行（409 `not_ended`），冻结名次快照，按奖项表给分数大于 0 的个人发兑奖码，回 201；之后积分、规则、候选的写入都 409 `competition_finalized`。DELETE 撤销定榜：有奖已核销 409 `prizes_redeemed`，否则删掉快照与兑奖码。控制台只看到兑奖码末四位。写 `competition.finalize` / `competition.unfinalize`（只记末四位）。 |
| `GET /api/me/competition-results` · `flow:competition.me.results` | 登录且是极客班成员 | 200 `{ items: [{ competition_id, name, finalized_at, rank, points, prize: { amount_cny, title, code, redeemed_at } \| null }] }`：本人报名过、已经定榜的比赛；兑奖码明文只在这里给本人看。 |
| `POST /api/console/prizes/lookup`、`POST /api/console/prizes/redeem` · `flow:competition.prize.lookup`、`flow:competition.prize.redeem` | `competition.prize.redeem`；核销再要 step-up | body `{ code }`（不分大小写，空格与连字符可有可无，I/L 当 1、O 当 0）；200 `{ prize }`：比赛、名次、分数、金额、奖项名、得奖人（昵称与用户名，不含真实姓名，#280）、核销时间与核销人。查不到 404 `code_not_found`；已经核销 409 `already_redeemed`（带上次核销的那张奖）。输错的码每人每小时 20 次（`competition.prize.lookup.fail`），超了 429。核销写 `competition.prize.redeem`，查不到的查找写一条 `denied`，记录里只有末四位。 |

收集任务：`buildApp({ gitlabSync: true })`（只有 `index.ts` 打开）同时启动，GitLab 同步不是 off 时每 10 分钟一轮，每一轮开始时才看模式；只收内部赛、没下线、开了积分、已开始、没定榜、结束后 30 天内、配了 GitLab 项目的比赛；一轮最多300个GitLab请求，每类列表最多十页；MR/Issue、标签事件、closed_by均须取全，十页仍有下一页、循环游标、超时/429/HTTP失败或预算耗尽时整轮不写，`last_run.error`说明失败（created/accepted/revoked归0），绝不把失败当作移除标签。HTTP在事务外，应用完整快照时在事务内重查比赛时间/定榜/项目/报名/候选，审计失败整轮回滚。MR 按合并时间、Issue 按创建时间落在比赛窗口内才收，Issue 还要带「有用」标签或已经被合并的 MR 关闭；不看改动行数。两档来自标签：`重要程度::一般|重要|关键`、`核心度::边缘|业务|核心` 各要正好一个，缺或多就是 null；作者经 `gitlab_accounts` 对到账号且已报名，否则记 `skipped`。自动加分要「有用」和两个两档标签都满足：资源标签事件里最后一次是加上、加的人对得上账号、有 `competition.score.review`、不是作者本人，才按两档查表自动加分（贡献时间是合并 / 创建时间，防刷按它所在那一周；操作记录 surface `system`，账号是打标签的人）；否则候选留在待确认，`note` 写原因（例如有「有用」但两档标签不全）。加分之后再改两档标签不重算。标签被拿掉时只撤销经标签自动加的分并把候选退回待确认，控制台确认的不动；定榜后不再收集；等待HTTP时发生定榜也不应用迟到快照。演练矩阵、身份集成前置和网络边界见[首场个人赛演练](competition-rehearsal.md)。

防止错误撤分：列表和标签事件完整连续分页（最多 10 页，跳页/循环/截断失败），labels 必须完整 string[]；HTTP 失败、超时、429/5xx、畸形标签/事件不视为标签移除。事件的 id、时间、标签名和 add/remove 动作必须完整；坏事件不能被忽略后把旧 remove 当成最新。自动撤分须完整事件集明确最新 action=remove；缺证据保分。作者和审核人经异步 accountForGitlabUser 重新核验 OIDC 绑定，身份失配/受保护/无 sub 的不归属；身份核验 HTTP 错误中止本轮。所有等待完成后再次检查三标签审核人当前 active 与审核节点，停用/到期不能自动计分。归属核验也计入每轮最多 300 次请求的预算。

验证入口：[官网托管与站点包](../../../tests/server/competition-site.test.ts)、[两档基础分表](../../../tests/server/competition-rubric.test.ts)、[积分、两档与防刷](../../../tests/server/competition-scores.test.ts)、[公开接口与年级系数](../../../tests/server/competition-public.test.ts)、[贡献收集与「有用」标签](../../../tests/server/competition-candidates.test.ts)、[定榜、兑奖与迁移](../../../tests/server/competition-prizes.test.ts)。

## 一键系统备份（#282）

所有者 2026-10-24 22:22 的诉求：论坛和全系统数据要能一键打包下载，方便原服务器出故障或要搬到新机器时恢复；预发布和正式各自独立备份，不共享数据。打包逻辑在 [lib/system-backup.ts](../../../app/server/src/lib/system-backup.ts)（在线备份出 `data.db` 的快照副本，清空副本里的短时安全数据后流式打包）与 [lib/tar-stream.ts](../../../app/server/src/lib/tar-stream.ts)（纯 Node 的流式 tar+gzip，不缓冲整份归档）；恢复用命令行脚本 [scripts/backup-restore.mjs](../../../scripts/backup-restore.mjs)。内容、排除项与跨环境搬迁步骤见 [BACKUP](../../ops/BACKUP.md)。

| 方法与路径 | 谁 | 成功与副作用 |
|---|---|---|
| `GET /api/console/backup` · `flow:platform.system_backup` | 需要节点 `system.backup`（种子里只有站长的根通配 `*` 默认拿到，部门部长没有），并且 10 分钟内登录过（否则 403 `step_up_required`，不打归档） | 200 `application/gzip` 流，`Content-Disposition` 带 `yzgc-backup-<environment>-<日期>.tar.gz`；内容是 `manifest.json` + `data.db` 快照 + `sites/` 下的站点文件；清空快照副本里的 sessions、device_grants、oauth_grants、oidc_payloads、email_challenges、invite_attempts、application_limits、limit_events、forum_rate_events，账号与密码哈希保留；单账号 5 分钟限 1 次；写 `system.backup.export`（只记文件数、表名与排除了哪些表，不记归档内容）。 |

验证入口：[打包与流式 tar+gzip](../../../tests/server/system-backup.test.ts)、[tar-stream.ts 单测](../../../tests/server/tar-stream.test.ts)、[下载路由、权限与限流](../../../tests/server/backup-route.test.ts)、[恢复脚本](../../../tests/tooling/backup-restore.test.ts)。


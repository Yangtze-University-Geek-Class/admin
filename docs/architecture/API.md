# API 与数据契约

> 模块自有 Schema、明确错误语义和外部副作用约定。

状态：`current` · 更新：2026-09-23

## 合同

各路由模块 contracts.ts 拥有本模块请求 Schema。http-contracts 提供公共参数验证；文档 ID 等非数字标识必须有模块例外。TypeScript 泛型不代替运行时校验，用户不得提供待执行的 Schema。

JSON 写操作定义类型、长度、范围、枚举与必填项，拒绝未知字段。分页为有界正整数，验证后转换。SQL 值仍参数化。

## 接口族

portal 包括 /api/docs、/api/feedback、/api/join/:token、/api/portal/apply、/api/public/config；admin 包括 /auth/*、/api/me/orgs、`/api/admin/:org/*`；极客班控制台包括 `/api/console/*`（组织固定为 `CONSOLE_ORG`，按能力授权，见下方「极客班控制台」）；另有基础设施端点 `/healthz` 与 server 自身的 `/forum` 占位（逐条见下方「端点清单」）。旧 `/api/forum` 及其子路径、`/auth/forum/*`、`/forum/u/*` 返回 410 legacy_forum_retired。新论坛是独立服务 `app/forum`（[forum 合同](../services/forum/README.md)），上游没有论坛业务 API，不将旧 API 改为模拟成功。开发态 `/forum/*` 跳转新首页，生产由 web 容器把 `/forum/*` 反代到 forum 容器；服务未就绪时核心返回 503。

核心 OAuth 回调和 sid 保留，oauth_state 保持签名和有效期检查；不再创建旧 forum_sid。Nuxt 的选择示例用户不进入此会话模型，不为其签发真实权限。开发专用 `/__geek_forum` 仅标记受控预览进程，明确 realAuthentication=false / serverPersistence=false、contentSource 和 snapshotConfigured（快照目录已配置，不是数据库连接），生产不提供该标记。dev 专用、仅 GET/HEAD 的 `/api/local-forum/state`（整份只读快照文档）和 `/api/local-forum/assets/:hash`（按索引提供附件，支持单段 Range，多段请求退化为完整正文）只在设置快照目录时存在，静态产物中没有；它们没有会话，也不是业务写接口。机器码：404 `local_snapshot_not_configured` / `asset_not_found` / `asset_missing_on_disk`，405 `method_not_allowed`，416 `range_not_satisfiable`，500 `asset_size_mismatch`，503 `invalid_document` / `invalid_state` / `invalid_asset_index` / `snapshot_unavailable`。dev 错误处理器会在错误体附带堆栈，这是这些路由不进生产的原因之一。后续真实论坛 API 必须另立契约及权限测试。

管理端意见箱 `GET /api/admin/:org/feedback` 返回 `{ items, counts }`，`items` 只含具名列 `id`、`category`、`content`、`contact`、`submitter_login`、`status`、`reply`、`replied_by`、`replied_at`、`created_at`（`app/server/src/lib/feedback-store.ts` 的 `AdminFeedbackItem`，管理端与控制台 `GET /api/console/feedback` 共用同一份 SQL）；提交者 `source_ip`、`user_agent`、`submitter_id` 以及 `votes`、`updated_at` 只留在服务端，不下发浏览器。回归测试见 `tests/server/core.test.ts`。

## 端点清单

来源是 `app/server/src/app.ts` 与 `routes/**`。所有 POST/PUT/PATCH/DELETE 先经 `middleware/http-policy.ts` 核对 Origin 与 Fetch Metadata，不符返回 403 `invalid_origin`。`/api/*` 与 `/auth/*` 响应一律 `Cache-Control: no-store`。表中「无」表示没有路由级限流（`@fastify/rate-limit` 以 `global: false` 注册）。

| 方法与路径 | 鉴权 | 限流 | 成功 | 主要错误与说明 |
|---|---|---|---|---|
| `GET /api/public/config` | 匿名 | 无 | 200 `{ turnstile_site_key, pow_difficulty }` | — |
| `GET /api/docs` | 匿名 | 无 | 200 `{ items }`，只列白名单文档（产品介绍、用户指南，中英各一） | — |
| `GET /api/docs/:id` | 匿名 | 无 | 200 `{ id, label, lang, file, content }` | 404 `doc not found` / `doc file missing` |
| `GET /api/feedback/categories` | 匿名 | 无 | 200 `{ categories, pow_difficulty }` | — |
| `POST /api/feedback` | 匿名；带有效 `sid` 时记录提交者 | 10 次/分钟 | 200 `{ ok, id, message }` | 400：字段、PoW、蜜罐（`请求被拒绝`）、Turnstile |
| `GET /api/feedback/public?org=&limit=` | **匿名**，不校验 `ALLOWED_ORGS` | 无 | 200 `{ items }`：该组织非 `spam` 反馈按时间倒序，含 `category`、`content`（截到前 280 字）、`status`、管理员 `reply`、`votes`；缺 `org` 时 `items` 为空 | `limit` 默认 20、取 `min(limit, 100)`，**未做整数与下界校验**：负数会让 SQLite 取消行数上限，非整数触发 SQLite `datatype mismatch` 而返回 500。这是已知缺口，与上文「分页为有界正整数」不符，待修 |
| `GET /api/join/:token` | 匿名（链接令牌即能力） | 无 | 200 `{ org, note, team_slug, expires_at, remaining_uses, valid, reason }` | 404 `邀请链接不存在` |
| `POST /api/join/:token` | 匿名 | 5 次/分钟 | 200 `{ ok, invitation_id, message }` | 400：字段、PoW、蜜罐、Turnstile 或已知失败；404；503：发起人 token 失效或结果待核对 |
| `POST /api/portal/apply` | 匿名 | 5 次/分钟 | 201 | 见「投递简历端点」 |
| `GET /auth/github` | 匿名 | 无 | 302 到 GitHub 授权页，写入签名的 `oauth_state` cookie | — |
| `GET /auth/callback` | `oauth_state` cookie | 无 | 302 回允许列表内的 `return_to`，签发 `sid` | 400 `missing_params` / `invalid_state` / GitHub 回传的 `error`；410 `legacy_forum_retired`（`state` 以 `forum-` 开头） |
| `POST /auth/signout` | 可选 `sid` | 无 | 200 `{ ok: true }`，清除 `sid` 与旧 `forum_sid` cookie | — |
| `GET /auth/me` | 可选 `sid` | 无 | 200 `{ signed_in: false }` 或 `{ signed_in: true, login, user_id, avatar_url }` | — |
| `GET /api/me/orgs` | `sid` | 无 | 200 `{ orgs, allowed_orgs }`，按 `ALLOWED_ORGS` 过滤，缓存 120 秒 | 401 `not_signed_in` / `session_expired` |
| `/api/admin/:org/*` | `sid` + `ALLOWED_ORGS` + GitHub 组织角色 | 无 | 按路由 | 401 `not_signed_in` / `session_expired`；403 `org_not_whitelisted` / `not_a_member_of_org` / `requires_org_admin` |
| `GET /api/console/me` | `sid` | 无 | 200 `ConsoleMe`（见「极客班控制台」） | 401 `not_signed_in` / `session_expired` |
| `GET /api/console/catalogue` | `console.access` | 无 | 200 `{ titles, crew, tones, capabilities, domains, role_base, implies, captain_only, department_icons, application_statuses }` | 401；403 `missing_capability` |
| `GET /api/console/summary` | `console.access` | 无 | 200，只含调用者有权看的键：`applications? { total, by_status, last_7d }`、`feedback? { open, total }`、`people? { assignments, departments }` | 401；403 |
| `GET /api/console/departments` | `console.access` | 无 | 200 `{ departments: [{ …, head_capabilities, member_capabilities, heads, crew_count }] }`，已归档的排在最后 | 401；403 |
| `POST /api/console/departments` | `roles.manage` | 无 | 201 `{ department }`，审计 `department.create` | 400 `validation_error` / `captain_only_capability`；409 `department_exists` |
| `PATCH /api/console/departments/:department_id` | `roles.manage` | 无 | 200 `{ department }`，审计 `department.update`（details `{ changed }`） | 400；404 `not_found` |
| `GET /api/console/assignments?department_id=&role=` | `roles.manage` 或 `roles.department.manage` | 无 | 200 `{ assignments, captain, bootstrap_active }`；只有后者时只返回本人负责部门的行 | 401；403 `missing_capability` / `out_of_department_scope` |
| `POST /api/console/assignments` | `roles.manage`；或 `roles.department.manage` 且 `role=member`、部门属于本人 | 30 次/分钟 | 201 `{ assignment }`，审计 `role.assign`（details `{ role, department_id, note_length }`）或 `role.captain.transfer`（`{ from, to }`） | 400 `department_required` / `department_not_allowed` / `unknown_department` / `github_user_not_found`；403 `missing_capability` / `out_of_department_scope` / `captain_required`；409 `assignment_exists` |
| `DELETE /api/console/assignments/:id` | 同上，按目标行判断 | 无 | 200 `{ ok: true }`，审计 `role.revoke` | 404；409 `captain_transfer_required` |
| `GET /api/console/applications?status=&q=&limit=&offset=` | `applications.read` | 无 | 200 `{ items, total, counts }`，`items` 只含 `id`、`name`、`class_name`、`email`、`strengths_excerpt`（≤120 字）、`status`、`created_at`、`last_review` | 401；403 |
| `GET /api/console/applications/export.csv?status=` | `applications.export` | 5 次/分钟 | 200 `text/csv; charset=utf-8`，UTF-8 BOM，`attachment; filename="applications-YYYYMMDD.csv"`；审计 `application.export`（`{ count, status }`） | 403 |
| `GET /api/console/applications/:application_id` | `applications.read` | 无 | 200 `{ application, reviews }`（含完整 `strengths`），审计 `application.view` | 400（非 UUID）；404 |
| `PATCH /api/console/applications/:application_id` | `applications.review` | 无 | 200 `{ application, review }`；同一事务更新状态并追加 `application_reviews`；审计 `application.review`（`{ from, to, has_note }`，不记备注原文） | 400 `no_change`；404 |
| `GET /api/console/feedback?status=&limit=` | `feedback.read` | 无 | 200 `{ items, counts }`，形状同管理端意见箱，组织固定为 `CONSOLE_ORG` | 401；403 |
| `PATCH /api/console/feedback/:id` | `feedback.manage` | 无 | 200 `{ ok: true }`，审计 `feedback.update` | 400；404 |
| `DELETE /api/console/feedback/:id` | `feedback.manage` | 无 | 200 `{ ok: true }`，审计 `feedback.delete` | 404 |
| `GET /api/console/audit?limit=&offset=&action=` | `audit.read` | 无 | 200 `{ logs }`，只含 `org = CONSOLE_ORG` 的行，`action` 按前缀匹配 | 401；403 |
| `GET /healthz` | 匿名 | 无 | 200 `{ ok: true, ts }` | — |
| `GET /forum`、`GET /forum/*`（server 自身） | 匿名 | 无 | 开发态 302 到 `http://127.0.0.1:3456/` | 生产 503 `forum_service_not_ready`。容器栈里 web nginx 先把 `/forum/*` 反代到 forum 容器，只有直连 server 才会走到这里 |

`/api/admin/:org/*` 的角色要求：`overview`、`activity`、`security`、`GET org`、`GET members`、`GET teams`、仓库、提交、Issue 与 PR 的读取，以及 PR 合并、Issue/PR 状态修改和评论只要求 `member`，最终由会话里 GitHub token 自身的仓库权限裁决；`invite-links`、`invitations`、`feedback`、`logs`、`PATCH org`、成员移除与改角色、团队创建与删除、`create-repo`、仓库删除、协作者增删要求 `admin`。

## 极客班控制台

`/api/console/*` 是极客班控制台的接口族，路由在 `app/server/src/routes/console/`，输入协议在其 `contracts.ts`（所有 body 与 query 都 `additionalProperties:false`，未知字段 400 `validation_error`）。组织固定为环境变量 `CONSOLE_ORG`（默认 `Yangtze-University-Geek-Class`），路径里没有 `:org`。

- **授权**：先 `requireAuth`，再 `middleware/require-capability.ts` 的 `requireCapability(...anyOf)`。同一请求只解析一次身份（`req.access`）。缺能力返回 `403 { error: "missing_capability", capability, any_of, reason?, message }`：`capability` 是 `anyOf[0]`，`reason` 只在被 GitHub 上限挡掉时出现（`github_admin_required` / `github_membership_required`），`message` 为「需要「{能力中文名}」权限」。按钮只是提示，授权只在服务端。
- **身份**：`GET /api/console/me` 返回 `{ login, avatar_url, org, github_role, title, titles, capabilities, blocked, bootstrap, head_of }`。`TitleView = { id, label, tag, icon, tone, department, source, assignment_id }`，`source ∈ assignment | bootstrap | github | none`；`capabilities` 按能力清单顺序。能力模型、GitHub 上限与临时代任规则见 [SECURITY](SECURITY.md)。
- **GitHub 调用**：只用会话里调用者自己的 token（组织角色查询、指派时的 `GET /users/{login}`）。GitHub 角色缓存 60 秒（错误不缓存）；GitHub 出错走下文「错误」的统一映射，**不**当成「不是组织成员」。
- **契约细节**：投递路径参数叫 `:application_id` 并按 UUID 校验（`:id` 会被公共校验强制成数字）；`export.csv` 是静态路由，优先于 `/:application_id`。`limit` 1–200（意见箱 1–500），`offset` 0–99999999，`q` ≤100 字，按 LIKE 匹配姓名、班级、邮箱并转义 `%`、`_`、`\`。CSV 以 `= + - @ \t \r` 开头的单元格前加 `'`，防表格公式注入。
- **审计**：所有控制台写操作以及投递的查看、导出都以 `org = CONSOLE_ORG` 写审计，现有 `GET /api/admin/:org/logs` 也能看到。审核备注只存 `application_reviews`，不进审计。
- **旧接口不变**：`/api/admin/:org/*` 仍只由 GitHub 组织角色控制，本次没有加能力检查。
- **Mock**：开发预览 `?__data=mock` 覆盖控制台所有 GET（`?__persona=` 切换身份），写请求照旧返回 501 `mock_read_only`，不伪造写成功。
- 回归测试见 `tests/server/console.test.ts`。

## 投递简历端点

`POST /api/portal/apply` 是官网「投递简历」的匿名写接口：无会话、无 cookie 依赖；成功时写一行 `applications`（含来源 IP 与 User-Agent）和一条 `audit_logs` 审计。前端页面与本节同批发布，字段名与 PoW 摘要输入属于跨端契约，改一端必须同时改另一端。

| 请求字段 | 约束 |
|---|---|
| `name` | 必填，trim 后 2–40 字符，禁止控制字符 |
| `className` | 必填，trim 后 2–40 字符，只允许中文、字母、数字、空格、`·`、`-` |
| `email` | 必填，≤120 字符，形如 `x@y.z` |
| `strengths` | 必填，trim 后 10–2000 字符 |
| `website`、`homepage`、`url_ref` | 蜜罐字段（`middleware/pow.ts` 的 `checkHoneypot`）：任一非空即按机器人处理；前端只渲染隐藏的 `website` |
| `pow` | `{ timestamp, nonce }`；摘要输入固定为 `apply:<trim 后 name>:<trim 后 email>`，难度取 `/api/public/config` 的 `pow_difficulty` |
| `turnstile_token` | 只在 `/api/public/config` 的 `turnstile_site_key` 非空时校验，空字符串视为未提供 |

响应与错误码：

- `201 { id, submitted_at, message }`：`id` 为 UUID，`submitted_at` 为毫秒时间戳，`message` 为中文提示；响应不回显 `strengths` 或其它请求字段。
- `400 { error, fields }`：字段校验失败的逐字段中文错误，`fields` 只包含出错字段，`error` 等于首个出错字段的提示；校验失败不写库。
- `400 { error }`：PoW 与 Turnstile 失败沿用公开表单既有形状（`防滥用校验失败，请刷新页面重试`、`人机验证失败，请刷新重试`）。蜜罐命中不返回 400，见下文。
- `429`：限流，路由级 5 次/分钟/客户端。

边界行为：蜜罐检查在字段校验之前，命中时返回与成功完全一致的 `201` 形状但不落库，不向脚本暴露陷阱；公开表单通用的蜜罐 400 `请求被拒绝` 在本端点走不到。字段约束在路由内单一校验层实现，该端点不注册 `contracts.ts` body schema；除三个蜜罐字段外，未知字段被忽略而不是让投递失败。落库与审计见 `app/server/src/routes/portal/apply.ts`、[server 合同](../services/server/README.md) 与 [数据模型](../services/server/data-model.md)：审计动作 `public:apply` / `application.received` 记录目标 id 和来源 IP（`ip` 列），details 只含脱敏邮箱、班级、`name_length` 和 `strengths_length`，不记姓名与完整 `strengths`。回归测试见 `tests/server/applications.test.ts`。

## 错误

校验 400、未登录 401、权限/来源 403、不存在 404、冲突 409、请求体超限 413、不支持的 Content-Type 415、频率限制 429、服务异常 5xx。错误体含机器码 error、必要 message 和可用的 request_id；不得暴露 Token、SQL、完整外部响应或堆栈。

路由未自行捕获的 GitHub 上游错误（Octokit 只带 `status`）由 `app/server/src/middleware/http-policy.ts` 统一处理：上游 4xx 按原状态码返回，机器码 `upstream_rejected`，message 是按状态码给出的中文说明，不回显上游原文；上游 5xx、无状态码或状态码无效的异常一律脱敏为 5xx `internal_error`。公开邀请 `POST /api/join/:token` 自行处理上游错误：明确失败返回 `400 { error }`，按上游状态区分「该用户已在组织中」、422 拒绝、GitHub 用户名不存在与其它失败；结果不确定时返回 503。回归测试见 `tests/server/upstream-errors.test.ts` 与 `tests/server/invitations.test.ts`。

## 幂等与验证

核心邀请按链接与标准化收件人记录，成功重试复用结果；明确失败补偿，未知结果保留额度并待核对。PR 合并带 head SHA；评论并关闭先确认，再依次等待成功。旧论坛软删除策略已经退出运行，其历史测试不能作为新论坛后端行为证明。

测试覆盖正常、非法字段、未知字段、边界、角色、缺失资源和并发。Mock 是只读预览，不伪造写成功。新 DTO 使用具名类型；复杂上游宽类型限制在适配边界并说明理由。

官方依据：https://fastify.dev/docs/latest/Reference/Validation-and-Serialization/ ，https://fastify.dev/docs/latest/Guides/Testing/

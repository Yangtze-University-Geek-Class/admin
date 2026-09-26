# API 与数据契约

> 模块自有 Schema、明确错误语义和外部副作用约定。

状态：`current` · 更新：2026-09-26

## 合同

各路由模块 contracts.ts 拥有本模块请求 Schema。http-contracts 提供公共参数验证；文档 ID 等非数字标识必须有模块例外。TypeScript 泛型不代替运行时校验，用户不得提供待执行的 Schema。

JSON 写操作定义类型、长度、范围、枚举与必填项，拒绝未知字段。分页为有界正整数，验证后转换。SQL 值仍参数化。

## 接口族

portal 包括 /api/docs、/api/feedback、/api/join/:token、/api/portal/apply、/api/public/config、/api/public/org；admin 包括 /auth/*、/api/me/orgs、`/api/admin/:org/*`；极客班控制台包括 `/api/console/*`（组织固定为 `CONSOLE_ORG`，按能力授权，见下方「极客班控制台」）；论坛接口 `/api/forum/*`（#57，见下方「论坛」与 [ADR-0004](../decisions/0004-forum-backend-in-core-server.md)）；另有基础设施端点 `/healthz` 与 server 自身的 `/forum` 占位（逐条见下方「端点清单」）。`/api/forum` 下新接口没有注册的旧路径、`/auth/forum/*`、`/forum/u/*` 返回 410 legacy_forum_retired，不把旧接口映射成新接口。论坛页面是独立服务 `app/forum`（[forum 合同](../services/forum/README.md)）的静态产物，数据经同域 `/api/forum/*` 读写。开发态 `/forum/*` 跳转新首页，生产由 web 容器把 `/forum/*` 反代到 forum 容器；直连 server 的 `/forum` 返回 503。

核心 OAuth 回调和 sid 保留，oauth_state 保持签名和有效期检查；不再创建旧 forum_sid。官网、论坛、控制台共用这一个登录：官网菜单栏和论坛（快照模式）只经同域 `GET /auth/me` 读会话显示身份，退出调 `POST /auth/signout`，论坛没有自己的登录接口。Nuxt 的选择示例用户不进入此会话模型，不为其签发真实权限。开发专用 `/__geek_forum` 仅标记受控预览进程，明确 realAuthentication=false / serverPersistence=false、contentSource 和 snapshotConfigured（快照目录已配置，不是数据库连接），生产不提供该标记。dev 专用、仅 GET/HEAD 的 `/api/local-forum/state`（整份只读快照文档）和 `/api/local-forum/assets/:hash`（按索引提供附件，支持单段 Range，多段请求退化为完整正文）只在设置快照目录时存在，静态产物中没有；它们没有会话，也不是业务写接口。机器码：404 `local_snapshot_not_configured` / `asset_not_found` / `asset_missing_on_disk`，405 `method_not_allowed`，416 `range_not_satisfiable`，500 `asset_size_mismatch`，503 `invalid_document` / `invalid_state` / `invalid_asset_index` / `snapshot_unavailable`。dev 错误处理器会在错误体附带堆栈，这是这些路由不进生产的原因之一。真实的论坛接口在核心服务，契约与权限测试见下方「论坛」。

管理端意见箱 `GET /api/admin/:org/feedback` 返回 `{ items, counts }`，`items` 只含具名列 `id`、`category`、`content`、`contact`、`submitter_login`、`status`、`reply`、`replied_by`、`replied_at`、`created_at`（`app/server/src/lib/feedback-store.ts` 的 `AdminFeedbackItem`，管理端与控制台 `GET /api/console/feedback` 共用同一份 SQL）；提交者 `source_ip`、`user_agent`、`submitter_id` 以及 `votes`、`updated_at` 只留在服务端，不下发浏览器。回归测试见 `tests/server/core.test.ts`。

## 端点清单

来源是 `app/server/src/app.ts` 与 `routes/**`。所有 POST/PUT/PATCH/DELETE 先经 `middleware/http-policy.ts` 核对 Origin 与 Fetch Metadata，不符返回 403 `invalid_origin`。`/api/*` 与 `/auth/*` 响应一律 `Cache-Control: no-store`，唯一的例外是论坛头像 `GET /api/forum/avatars/<hash>.webp` 的 200 响应（按内容哈希寻址，长期缓存）。表中「无」表示没有路由级限流（`@fastify/rate-limit` 以 `global: false` 注册）。按 IP 的限流、审计与投递里记的来源 IP 都取 Fastify 的 `req.ip`：部署环境 `TRUST_PROXY=2`，只信任宿主 nginx 与 web 容器 nginx 各自追加的那段 `X-Forwarded-For`，客户端自己带的最左边几段不算（见 [ENVIRONMENTS](../ops/ENVIRONMENTS.md) 与 [SECURITY](SECURITY.md)）。

| 方法与路径 | 鉴权 | 限流 | 成功 | 主要错误与说明 |
|---|---|---|---|---|
| `GET /api/public/config` | 匿名 | 无 | 200 `{ turnstile_site_key, pow_difficulty }` | — |
| `GET /api/public/org` | 匿名 | 无 | 200 `{ tones, titles, departments }`：`tones` 是色调 id → 浅色色值；`titles` 按 admin、captain、head、member、alumni、guest 排，每项 `{ id, label, tag, icon, tone, description, rank }`，读 `titles` 表（控制台改过的名字立刻生效）；`departments` 只含未归档部门的 `{ id, name, tag, icon, tone, description }`。不含权限包，不含任何人。官网「组织架构」窗口与论坛称号读它 | — |
| `GET /api/docs` | 匿名 | 无 | 200 `{ items }`，只列白名单文档（产品介绍、用户指南，中英各一） | — |
| `GET /api/docs/:id` | 匿名 | 无 | 200 `{ id, label, lang, file, content }` | 404 `doc not found` / `doc file missing` |
| `GET /api/feedback/categories` | 匿名 | 无 | 200 `{ categories, pow_difficulty }` | — |
| `POST /api/feedback` | 匿名；带有效 `sid` 时记录提交者 | 10 次/分钟 | 200 `{ ok, id, message }` | 400：字段、PoW、蜜罐（`请求被拒绝`）、Turnstile |
| `GET /api/feedback/public?org=&limit=` | **匿名**，不校验 `ALLOWED_ORGS` | 无 | 200 `{ items }`：该组织非 `spam` 反馈按时间倒序，含 `category`、`content`（截到前 280 字）、`status`、管理员 `reply`、`votes`；缺 `org` 时 `items` 为空 | `limit` 默认 20、取 `min(limit, 100)`，**未做整数与下界校验**：负数会让 SQLite 取消行数上限，非整数触发 SQLite `datatype mismatch` 而返回 500。这是已知缺口，与上文「分页为有界正整数」不符，待修 |
| `GET /api/join/:token` | 匿名（链接令牌即能力） | 无 | 200 `{ org, note, team_slug, expires_at, remaining_uses, valid, reason }` | 404 `邀请链接不存在` |
| `POST /api/join/:token` | 匿名 | 5 次/分钟 | 200 `{ ok, invitation_id, message }` | 400：字段、PoW、蜜罐、Turnstile 或已知失败；404；503：发起人 token 失效或结果待核对 |
| `POST /api/portal/apply` | 匿名 | 5 次/分钟 | 201 | 见「加入我们（投递）端点」 |
| `GET /auth/github` | 匿名 | 无 | 302 到 GitHub 授权页，写入签名的 `oauth_state` cookie | — |
| `GET /auth/callback` | `oauth_state` cookie | 无 | 一律 302 回允许列表内的 `return_to`（不合规时 `<PUBLIC_ORIGIN>/console`）。登录者在 `CONSOLE_ORG` 是 `active` 成员：签发 `sid`，审计 `auth.signin`。其余情况不签发 `sid`，在回跳地址上加 `signin` 参数：`not_member`（成员查询 404）、`invite_pending`（成员状态 `pending`），这两种审计 `auth.signin_denied` 并尽力撤销这次授权（`DELETE /applications/{client_id}/grant`）；`cancelled`（GitHub 回传 `error=access_denied`）；`failed`（GitHub 回传其它 `error`，或换 token、取 `/user`、查成员身份出错，含 403 与超时） | 400 `missing_params`（缺 `state`，或 `code` 与 `error` 都没有）/ `invalid_state`（state 签名、有效期或 cookie 不符，GitHub 回传 `error` 时也先做这项检查）；410 `legacy_forum_retired`（`state` 以 `forum-` 开头）。这些情况返回 JSON，不跳转。规则见 [SECURITY](SECURITY.md)「登录门槛」 |
| `POST /auth/signout` | 可选 `sid` | 无 | 200 `{ ok: true }`，清除 `sid` 与旧 `forum_sid` cookie | — |
| `GET /auth/me` | 可选 `sid` | 无 | 200 `{ signed_in: false }` 或 `{ signed_in: true, login, user_id, avatar_url, console_link }`。`console_link` 是布尔值：登录者持有 `console.access`、`github.org.read`、`feedback.read` 之外的任意能力时为 true（提督、舰长、队长、带部门权限包的舰员），普通舰员与领航员为 false；官网与论坛只在它为 true 时显示「控制台」入口，控制台准入不变。按 `computeAccess` 计算（GitHub 角色缓存 60 秒），GitHub 查询失败时为 false，不让本接口失败 | — |
| `GET /api/me/orgs` | `sid` | 无 | 200 `{ orgs, allowed_orgs }`，按 `ALLOWED_ORGS` 过滤，缓存 120 秒 | 401 `not_signed_in` / `session_expired` |
| `/api/admin/:org/*` | `sid` + `ALLOWED_ORGS` + GitHub 组织角色 | 无 | 按路由 | 401 `not_signed_in` / `session_expired`；403 `org_not_whitelisted` / `not_a_member_of_org` / `requires_org_admin` |
| `GET /api/console/me` | `sid` | 无 | 200 `ConsoleMe`（见「极客班控制台」） | 401 `not_signed_in` / `session_expired` |
| `GET /api/console/catalogue` | `console.access` | 无 | 200 `{ titles, crew, tones, capabilities, domains, role_base, implies, captain_only, department_icons, application_statuses }`；`titles`（含 admin，带 `rank` 与 `description`）与 `role_base` 读 `titles` 表：admin 永远是全部能力，guest 为空 | 401；403 `missing_capability` |
| `PATCH /api/console/titles/:title_id` | `roles.manage` | 无 | 200 `{ title: { id, label, tag, icon, tone, description, capabilities } }`，审计 `title.update`（details `{ changed }`）；body 是 `label`（1–8 字）、`tag`（`^[A-Z][A-Z0-9-]{1,15}$`）、`icon`（`department_icons` 之一）、`tone`、`description`（≤200 字）、`capabilities` 的非空子集 | 400 `validation_error`（未知称号、未知字段、空 body、名字只有空白）/ `title_capabilities_fixed`（改 admin 或 guest 的权限）/ `captain_only_capability`（`roles.manage` 放进 captain 以外的包）；403 `missing_capability` / `admiral_required`（admin、captain 两个称号只有 admin 本人能改） |
| `GET /api/console/summary` | `console.access` | 无 | 200，只含调用者有权看的键：`applications? { total, by_status, last_7d }`、`feedback? { open, total }`、`people? { assignments, departments }` | 401；403 |
| `GET /api/console/departments` | `console.access` | 无 | 200 `{ departments: [{ …, head_capabilities, member_capabilities, heads, crew_count }] }`，已归档的排在最后 | 401；403 |
| `POST /api/console/departments` | `roles.manage` | 无 | 201 `{ department }`，审计 `department.create` | 400 `validation_error` / `captain_only_capability`；409 `department_exists` |
| `PATCH /api/console/departments/:department_id` | `roles.manage` | 无 | 200 `{ department }`，审计 `department.update`（details `{ changed }`） | 400；404 `not_found` |
| `DELETE /api/console/departments/:department_id` | `roles.manage` | 无 | 200 `{ ok: true, removed }`：同一事务删除部门和它的全部 head / member 指派（`removed` 是撤掉的条数），审计 `department.delete`（details `{ name, removed: [{ github_login, role }] }`）；默认部门只在第一次启动写入（`console_seeds`），删掉后重启不会补回 | 403；404 `not_found` |
| `GET /api/console/assignments?department_id=&role=` | `roles.manage` 或 `roles.department.manage` | 无 | 200 `{ assignments, captain }`；只有后者时只返回本人负责部门的行 | 401；403 `missing_capability` / `out_of_department_scope` |
| `POST /api/console/assignments` | `roles.manage`；或 `roles.department.manage` 且 `role=member`、部门属于本人 | 30 次/分钟 | 201 `{ assignment }`，审计 `role.assign`（details `{ role, department_id, note_length }`）或 `role.captain.transfer`（`{ from, to }`） | 400 `department_required` / `department_not_allowed` / `unknown_department` / `github_user_not_found`；403 `missing_capability` / `out_of_department_scope` / `captain_required`；409 `assignment_exists` |
| `DELETE /api/console/assignments/:id` | 同上，按目标行判断；captain 那条只有本人或 admin 能撤 | 无 | 200 `{ ok: true }`，审计 `role.revoke` | 404；409 `captain_transfer_required` |
| `GET /api/console/people` | `roles.manage` 或 `roles.department.manage` | 无 | 200 `{ people: [{ login, user_id, avatar_url, github_role, titles }] }`：用调用者自己的 token 列出 `CONSOLE_ORG` 的全部正式成员（按 admin / member 各列一次），每人的 `titles` 按 `computeAccess` 计算，与本人登录后看到的一致（owner 是 admin，没有指派的成员是 member、`source: "github"`）；有指派但已不在组织里的人也列出，`github_role: null`；按主称号层级、再按登录名排序 | 401；403；GitHub 出错按「错误」统一映射 |
| `GET /api/console/applications?status=&q=&limit=&offset=` | `applications.read` | 无 | 200 `{ items, total, counts }`，`items` 只含 `id`、`name`、`class_name`、`email`、`strengths_excerpt`（≤120 字）、`status`、`created_at`、`last_review` | 401；403 |
| `GET /api/console/applications/export.csv?status=` | `applications.export` | 5 次/分钟 | 200 `text/csv; charset=utf-8`，UTF-8 BOM，`attachment; filename="applications-YYYYMMDD.csv"`；审计 `application.export`（`{ count, status }`） | 403 |
| `GET /api/console/applications/:application_id` | `applications.read` | 无 | 200 `{ application, reviews }`（含完整 `strengths`），审计 `application.view` | 400（非 UUID）；404 |
| `PATCH /api/console/applications/:application_id` | `applications.review` | 无 | 200 `{ application, review }`；同一事务更新状态并追加 `application_reviews`；审计 `application.review`（`{ from, to, has_note }`，不记备注原文） | 400 `no_change`；404 |
| `GET /api/console/feedback?status=&limit=` | `feedback.read` | 无 | 200 `{ items, counts }`，形状同管理端意见箱，组织固定为 `CONSOLE_ORG` | 401；403 |
| `PATCH /api/console/feedback/:id` | `feedback.manage` | 无 | 200 `{ ok: true }`，审计 `feedback.update` | 400；404 |
| `DELETE /api/console/feedback/:id` | `feedback.manage` | 无 | 200 `{ ok: true }`，审计 `feedback.delete` | 404 |
| `GET /api/console/audit?limit=&offset=&action=` | `audit.read` | 无 | 200 `{ logs }`，只含 `org = CONSOLE_ORG` 的行，`action` 按前缀匹配；邀请链接 token 只下发前 6 位加 `…`（`invite_link.*` 的 `target`、`invite.*` 的 `public:<token>` 操作者） | 401；403 |
| `/api/forum/*` | 可选 `sid`（按端点区分成员与游客） | 按端点 | 见下方「论坛」 | 见下方「论坛」 |
| `GET /healthz` | 匿名 | 无 | 200 `{ ok: true, ts }` | — |
| `GET /forum`、`GET /forum/*`（server 自身） | 匿名 | 无 | 开发态 302 到 `http://127.0.0.1:3456/` | 生产 503 `forum_service_not_ready`（论坛页面由 forum 容器提供）。容器栈里 web nginx 先把 `/forum/*` 反代到 forum 容器，只有直连 server 才会走到这里 |

`/api/admin/:org/*` 的角色要求：`overview`、`activity`、`security`、`GET org`、`GET members`、`GET teams`、仓库、提交、Issue 与 PR 的读取，以及 PR 合并、Issue/PR 状态修改和评论只要求 `member`，最终由会话里 GitHub token 自身的仓库权限裁决；`invite-links`、`invitations`、`feedback`、`logs`、`PATCH org`、成员移除与改角色、团队创建与删除、`create-repo`、仓库删除、协作者增删要求 `admin`。

## 极客班控制台

`/api/console/*` 是极客班控制台的接口族，路由在 `app/server/src/routes/console/`，输入协议在其 `contracts.ts`（所有 body 与 query 都 `additionalProperties:false`，未知字段 400 `validation_error`）。组织固定为环境变量 `CONSOLE_ORG`（默认 `Yangtze-University-Geek-Class`），路径里没有 `:org`。

- **授权**：先 `requireAuth`，再 `middleware/require-capability.ts` 的 `requireCapability(...anyOf)`。同一请求只解析一次身份（`req.access`）。缺能力返回 `403 { error: "missing_capability", capability, any_of, reason?, message }`：`capability` 是 `anyOf[0]`，`reason` 只在被 GitHub 上限挡掉时出现（`github_admin_required` / `github_membership_required`），`message` 为「需要「{能力中文名}」权限」。按钮只是提示，授权只在服务端。
- **身份**：`GET /api/console/me` 返回 `{ login, avatar_url, org, github_role, title, titles, capabilities, blocked, head_of }`。`TitleView = { id, label, tag, icon, tone, department, source, assignment_id }`，`source ∈ assignment | github | none`；`capabilities` 按能力清单顺序。能力模型、GitHub 上限与 admin（组织 owner）规则见 [SECURITY](SECURITY.md)。
- **GitHub 调用**：只用会话里调用者自己的 token（组织角色查询、指派时的 `GET /users/{login}`）。GitHub 角色缓存 60 秒（错误不缓存）；GitHub 出错走下文「错误」的统一映射，**不**当成「不是组织成员」。
- **契约细节**：投递路径参数叫 `:application_id` 并按 UUID 校验（`:id` 会被公共校验强制成数字）；`export.csv` 是静态路由，优先于 `/:application_id`。`limit` 1–200（意见箱 1–500），`offset` 0–99999999，`q` ≤100 字，按 LIKE 匹配姓名、班级、邮箱并转义 `%`、`_`、`\`。CSV 以 `= + - @ \t \r` 开头的单元格前加 `'`，防表格公式注入。
- **审计**：所有控制台写操作以及投递的查看、导出都以 `org = CONSOLE_ORG` 写审计，现有 `GET /api/admin/:org/logs` 也能看到。审核备注只存 `application_reviews`，不进审计。`GET /api/console/audit` 把邀请链接 token 截成前 6 位：`audit.read` 可以放进任何部门权限包、不要求 GitHub 组织管理员，而完整 token 能直接调用 `POST /api/join/:token`，用链接发起人的授权发出组织邀请。旧 `GET /api/admin/:org/logs` 只给组织管理员，仍返回原值。
- **旧接口不变**：`/api/admin/:org/*` 仍只由 GitHub 组织角色控制，本次没有加能力检查。
- **Mock**：开发预览 `?__data=mock` 覆盖控制台所有 GET（`?__persona=` 切换身份），写请求照旧返回 501 `mock_read_only`，不伪造写成功。
- 回归测试见 `tests/server/console.test.ts`。

## 论坛

`/api/forum/*` 是论坛前端（`app/forum`）的数据接口（#57，[ADR-0004](../decisions/0004-forum-backend-in-core-server.md)），路由在 `app/server/src/routes/forum-api/`，输入协议在其 `contracts.ts`（body 一律拒绝未知字段），存储见 [数据模型](../services/server/data-model.md)「论坛」。请求与响应都是 JSON（头像上传除外）；写请求走同一个 Origin 校验。

- **身份**：带有效 `sid` 的是成员，论坛用户 id 是 `m<GitHub user_id>`，第一次请求时建，之后每次请求刷新 `role`（GitHub 组织 owner 为 `admin`，其余 `member`）与 `title`（`computeAccess` 排序最高的称号，形如 `{ id, department? }`）；昵称、签名、上传的头像由本人改，刷新不覆盖。没有 `sid`、`sid` 失效的是游客。带有效 `sid`、但 GitHub 组织角色查到已不是 `CONSOLE_ORG` 成员的（登录后被移出组织）也按游客处理：不建、不刷新论坛用户，显式称号给的 `forum.*` 也不算；组织角色缓存 60 秒，移出后最长 60 秒生效。
- **授权**：成员的论坛能力 = `computeAccess` 算出的 `forum.*`（与 `/api/console/me` 同一条路径，控制台改的权限包下一次请求就生效）。`forum.topic.pin` 置顶，`forum.topic.close` 关闭，`forum.post.moderate` 编辑或删除他人帖子、在已关闭话题里回复。GitHub 角色查询出错时成员的请求失败（上游 4xx → `upstream_rejected`，5xx → `internal_error`），不降级成游客。
- **返回的 `state`**：与 `app/forum/app/data/types.ts` 的 `ForumState`（`version: 1`，`seededAt: 0`）同形，另加 `viewer: { userId, kind: "guest" | "member", capabilities }`（只含 `forum.*`）与 `guestPolicy: { powDifficulty, turnstileSiteKey, nameMax: 20, contentMax: 2000 }`。`users[]` 每项另有 `kind: "member" | "guest" | "official"`；`notifyPrefs` 只有看的人自己的是真实值，别人的一律是这一类用户的初始值（成员全开，游客与官方账号全关），字段照常存在；成员总有 `avatarUrl`（上传过是 `/api/forum/avatars/<hash>.webp`，否则是 GitHub 头像），游客与官方账号没有。`notifications`、`bookmarks` 只含看的人自己的，游客两者都是空数组；`follows` 全部下发。分类、精选标签来自 `app/forum/content/curation.json`（按 `categoryOrder` 排），后面接用户建的标签。删除是软删除：`deleted: true`、`content: ""`。
- **编号**：旧帖 `t<n>`（<1000）与首帖 `body-<n>`，新话题从 `t1001`、新帖子从 `p10001` 起，游客 `g<n>`（用户名 `guest-<n>`），通知 `n<n>`，新标签 `tag-<n>`；都由数据库计数器得出。
- **按 IP 计数**：游客回复限流、浏览去重、`state` 与浏览接口的限流按 `req.ip` 计；IPv6 按 /64 前缀计（`lib/forum-rules.ts` 的 `ipSubject`），IPv4 映射的 IPv6 按 IPv4 计。
- **昵称**：游客昵称与成员的 `displayName` 用允许清单（`lib/forum-rules.ts` 的 `isAllowedName`，先做 NFKC，全角字母和数字变成半角）：只收汉字、平假名、片假名、韩文（不含显示成空白的填充字）、拉丁字母里的基本拉丁、拉丁-1、拉丁扩展 A、拼音声调字母 U+01CD–U+01DC 与 U+1E00–U+1EFF、ASCII 数字、长音符 ー，以及空格和 `- _ . · ・ '`；空格不能在首尾或连着用，至少要有一个字或数字。其它都拒绝：看不见的字符、表情、西里尔与希腊等其它文字、IPA 与小型大写这类形近拉丁字母；NFKC 之后 `µ` 是希腊字母，也拒绝。错误码是 `invalid_guest_name` / `invalid_display_name`，`message` 是「昵称只能用汉字、字母、假名、韩文、数字、空格和 - _ . · ・ ' 这几个符号，空格不能连着用」，空名字另有长度提示。规则只管新写入，库里已有的昵称不改。判断重名时两边都按 `nameKey` 归一：NFKC、不分大小写、去掉附加符号（é 和 e、が 和 か 算同一个）、连续空白算一个。
- **错误体**：`{ error, message, request_id }`，`message` 是中文，可以直接给用户看。Schema 校验失败是 400 `validation_error`（提示写明哪个字段），路径里的编号格式不对也是 400。

| 方法与路径 | 谁能用 | 限流 | 成功 | 主要错误 |
|---|---|---|---|---|
| `GET /api/forum/state` | 所有人 | 每个 IP 120 次/分钟（进程内计数，重启清零） | 200 `{ state }`；`HEAD` 回 405（`Allow: GET`），不算 state、不另占额度 | 429 `rate_limited`；GitHub 出错见上 |
| `POST /api/forum/topics` | 成员 | 每人 10 次/分钟 | 201 `{ state, topicId, postId }`；body `{ title(1–120，去首尾空白后非空), categoryId, tags?: string[](≤5，每项是已有标签 id 或 ≤20 字的名字), content(1–20000) }`。名字按 slug（英文）或名字（中文，不分大小写）找已有标签，找不到才新建 | 401 `signin_required`；400 `validation_error` / `invalid_title` / `unknown_category` / `invalid_tag` / `empty_content`；429 `rate_limited` |
| `POST /api/forum/posts` | 成员、游客 | 成员每人 30 次/分钟；游客每个 IP 5 次/分钟、30 次/天，全站游客合计 200 次/小时 | 201 `{ state, postId }`；body `{ topicId, content, replyToPostId? }`，游客另带 `guest: { name(1–20) }`、`pow: { timestamp, nonce }`、蜜罐 `website`（必须为空）、`turnstileToken`（`guestPolicy.turnstileSiteKey` 非空时必填）。PoW 摘要输入是 `${topicId}:${content}`（正文原样，不去空白），难度同 `pow_difficulty`；游客正文 ≤2000、成员 ≤20000。话题已关闭时只有持 `forum.post.moderate` 的人能回 | 404 `not_found`；403 `forbidden`（话题已关闭）；400 `validation_error` / `invalid_reply_target`（被回复的帖子不在这个话题）/ `empty_content` / `request_rejected`（蜜罐）/ `content_too_long` / `invalid_guest_name`（空、超长或有允许清单以外的字符）/ `guest_name_taken`（按 `nameKey` 与成员或官方账号的昵称、用户名相同，或是本地知道的组织成员的登录名：控制台里有称号的人、登录过的人，没打开过论坛的也算）/ `pow_invalid` / `turnstile_failed`；429 `rate_limited`（这个 IP 超了）/ `guest_replies_paused`（全站游客回复超了，所有游客暂停，成员照常） |
| `PATCH /api/forum/posts/:id` | 作者（成员）或 `forum.post.moderate` | 无 | 200 `{ state }`；body `{ content }`，写 `editedAt`；改他人帖子审计 `forum.post.edit`（details `{ topic_id, author_id }`） | 401；403 `forbidden`；404；409 `post_deleted`；400 `empty_content` |
| `DELETE /api/forum/posts/:id` | 作者（成员）或 `forum.post.moderate` | 无 | 200 `{ state }`，软删除；已删的再删直接返回；删他人帖子审计 `forum.post.delete` | 401；403；404；400 `first_post`（话题的第一帖不能删） |
| `POST /api/forum/posts/:id/like` | 成员 | 无 | 200 `{ state }`，切换 | 401；404；409 `post_deleted` |
| `POST /api/forum/posts/:id/bookmark` | 成员 | 无 | 200 `{ state }`，切换 | 401；404 |
| `POST /api/forum/users/:id/follow` | 成员 | 无 | 200 `{ state }`，切换 | 401；404；400 `cannot_follow_self` |
| `POST /api/forum/topics/:id/pin` | `forum.topic.pin` | 无 | 200 `{ state }`；body `{ pinned: boolean }`；审计 `forum.topic.pin`（details `{ pinned }`） | 401；403 `forbidden`；404 |
| `POST /api/forum/topics/:id/close` | `forum.topic.close` | 无 | 200 `{ state }`；body `{ closed: boolean }`；审计 `forum.topic.close`（details `{ closed }`） | 401；403；404 |
| `POST /api/forum/topics/:id/view` | 所有人 | 每个 IP 60 次/分钟（进程内计数）；同一 IP 同一话题 1 小时只算一次浏览 | 204 | 404；429 `rate_limited` |
| `POST /api/forum/notifications/:id/read` | 成员 | 无 | 200 `{ state }` | 401；404（不存在或不是自己的） |
| `POST /api/forum/notifications/read-all` | 成员 | 无 | 200 `{ state }` | 401 |
| `PATCH /api/forum/me/profile` | 成员 | 无 | 200 `{ state }`；body 至少一项：`displayName`（1–30，去首尾空白后非空，只收允许清单里的字符；按 `nameKey` 不能等于官方账号的昵称或用户名、别人的用户名，或控制台里有称号、登录过的别人的登录名，和别的成员昵称相同可以）、`bio`（个人签名 ≤200，可换行）、`location`（≤60）、`website`（空串清空，否则 `https://`、≤200、不带账号密码）、`notifyPrefs: { reply?, like?, follow? }` | 401；400 `validation_error` / `invalid_display_name` / `display_name_taken` / `invalid_bio` / `invalid_location` / `invalid_website` |
| `PUT /api/forum/me/avatar` | 成员 | 每人 10 次/小时，每次上传都计数（解码失败也算） | 200 `{ state }`；登录与次数在读请求体之前（onRequest）核对，游客和超了次数的请求体不会被读进内存。请求体是图片本身，`Content-Type` 为 `image/png`、`image/jpeg` 或 `image/webp`，≤2MB。sharp 解码（像素上限 4096×4096，超了在解码前拒绝；动图只取第一帧），按 EXIF 摆正，居中裁成正方形，缩到 256×256 WebP，按内容 sha256 存库；换头像后没人用的旧图删除 | 401；415 `unsupported_media_type`；413 `avatar_too_large`；400 `invalid_image` / `image_too_large`；429 |
| `DELETE /api/forum/me/avatar` | 成员 | 无 | 200 `{ state }`，回到 GitHub 头像 | 401 |
| `GET /api/forum/avatars/<hash>.webp` | 所有人 | 无 | 200 `image/webp`，`Cache-Control: public, max-age=31536000, immutable`，`Content-Security-Policy: default-src 'none'` | 400（不是 64 位小写十六进制 + `.webp`）；404（`no-store`） |

路径里的 `:id` 在代码里分别叫 `:topic_id`、`:post_id`、`:forum_user_id`、`:notification_id`（公共校验会把名为 `:id` 的参数强制成数字），格式分别是 `t<n>`、`p<n>` / `body-<n>`、`m<n>` / `g<n>` / `u-<名字>`、`n<n>`。不带请求体的写接口（点赞、收藏、关注、浏览、已读）不要发 `Content-Type: application/json` 的空 body，Fastify 会按空 JSON 拒绝（400）。

通知规则与论坛前端 store 一致：回复通知话题作者与被回复的人，@提及（代码块里的不算）、点赞（每人每帖一次）、关注（每人一次）各一种；只发给成员，不给自己；回复通知与点赞、关注通知看收件人的 `notifyPrefs`，@提及没有开关，一条帖子最多通知 10 个被 @ 的人（按出现顺序，再多的不通知）。游客回复也会通知话题作者，`actorId` 是游客用户。

回归测试见 `tests/server/forum.test.ts`（真实路由、内存库、夹具内容 `tests/server/fixtures/forum-content/`）。

## 加入我们（投递）端点

`POST /api/portal/apply` 是官网「加入我们」（`/join-us` 信封页）的匿名写接口：无会话、无 cookie 依赖；成功时写一行 `applications`（含来源 IP 与 User-Agent）和一条 `audit_logs` 审计。前端页面与本节同批发布，字段名与 PoW 摘要输入属于跨端契约，改一端必须同时改另一端。

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

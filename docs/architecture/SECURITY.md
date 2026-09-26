# 安全模型与防护边界

> 区分保留核心服务的真实安全边界与原仓论坛的浏览器演示；新论坛尚不具备生产安全条件。

状态：`current` · 更新：2026-09-26

## 核心服务

保留 portal/admin 的服务端 requireAuth、GitHub active membership 校验及按组织审计；极客班控制台另按能力授权（见下节）。GitHub token 用 AES-256-GCM 加密，密钥解码必须为 32 字节；sid 是服务器会话，不在浏览器状态中产生管理权限。OAuth state 签名并检查十分钟有效期，回跳来源使用允许列表。Cookie 的 HttpOnly/Secure/SameSite 和共享 Domain 均需按真实部署验证，不称为完整 CSRF 或子域隔离。

**登录门槛：只有 `CONSOLE_ORG` 的 active 成员能登录。** 官网、论坛、控制台共用这一个登录和同一个 `sid`。`/auth/callback` 通过签名 state 校验、换到 token、取到 `/user` 之后，用这个 token 调 `GET /user/memberships/orgs/{CONSOLE_ORG}`（`app/server/src/lib/github.ts` 的 `getOwnMembership`，OAuth scope 含 `read:org`），查的是登录者自己的成员状态，不按用户名查别人。结果处理（`app/server/src/routes/admin/auth.ts`）：

- `active`：建会话、写 `sid`、审计 `auth.signin`，回到 `return_to`。
- 不是成员（GitHub 返回 404）或邀请还没接受（`pending`）：不建会话、不写 `sid`、不保存 token；审计 `auth.signin_denied`（`actor` 与 `target` 是 GitHub 登录名，`details` 为 `{ org, reason }`，`reason` 取 `not_member` 或 `pending`）；尽力撤销这个用户对本应用的授权（`DELETE /applications/{client_id}/grant`，用应用自己的 client_id 与 secret 做 Basic 认证），撤销失败只记警告日志；302 回到 `return_to` 并带 `?signin=not_member` 或 `?signin=invite_pending`。这条审计的 `org` 列为空，和登录、登出一样不经任何审计接口返回，只能在数据库里查。
- 换 token、取 `/user` 或成员查询出错（包括组织限制 OAuth App 访问时 GitHub 返回的 403）：一律 `?signin=failed`，**不**当成「不是成员」；服务端只记一条带 `code`、`status`、request id 的错误日志，不含 token 和上游响应。
- 用户在 GitHub 授权页取消（`error=access_denied`）回 `?signin=cancelled`，GitHub 回传其它 `error` 回 `?signin=failed`。

以上回跳都先要求 state 有效，目标是校验过的 `return_to`（只接受 `PUBLIC_ORIGIN`，否则回 `<PUBLIC_ORIGIN>/console`）。缺 `state`、既无 `code` 也无 `error`、state 签名或 cookie 不符，仍就地返回 400 JSON，不跳转；以 `forum-` 开头的旧论坛 state 返回 410。换 token、取 `/user`、撤销授权的请求 15 秒超时；Octokit 当前版本不读 `request.timeout`，所以默认的 Octokit 给它用的 `fetch` 套了 15 秒的 `AbortSignal.timeout`（`lib/github.ts` 的 `withTimeout`），成员查询和控制台的所有 GitHub 调用同样 15 秒超时。GitHub 连不上时登录尽快以 `failed` 回到原页面。不是成员的人拿不到会话：官网公开页面和论坛帖子不登录照样能看，控制台对他们只有登录页。

公开邀请/反馈/加入我们投递有限流、蜜罐、PoW 和可选 Turnstile。论坛的游客回复（`POST /api/forum/posts` 不带 `sid`）是另一个匿名写入口，同样要蜜罐、PoW（摘要输入 `${topicId}:${content}`）与可选 Turnstile，正文 ≤2000 字、昵称 1–20 字，昵称不能含控制字符或看不见的字符（`\p{Cf}` 的零宽、双向控制、BOM 等，以及行分隔符、韩文填充字、盲文空格等显示成空白的字符），归一后为空的名字也拒绝，拉丁字母也不能和西里尔、希腊字母混写（挡住 `bоb` 这类形近冒名；整个名字都用西里尔字母写成的形近名字不在这条规则里），按 NFKC 归一、去掉这些字符与附加符号、不分大小写之后不能与成员或官方账号的昵称、用户名相同（成员改昵称也不能用这些字符，也不能等于官方账号的名字或别人的用户名）；每个 IP 5 次/分钟、30 次/天，IPv6 按 /64 前缀计，全站游客回复合计每小时 200 次，超了所有游客暂停回复（`guest_replies_paused`），成员不受影响（都记在 `forum_rate_events`，重启不清零）；`GET /api/forum/state` 每个 IP 120 次/分钟、浏览接口 60 次/分钟（进程内计数）；游客不能发帖、编辑、删除或做其它写操作，每条游客回复是一个单独的游客用户，不能冒用成员身份。游客的来源 IP 只存在限流记录（最多一天）和浏览去重（最多一小时）里，不随帖子下发。反馈摘要与管理员回复经 `GET /api/feedback/public` 匿名可读：只要给出组织名即可读取该组织非 `spam` 反馈的前 280 字、状态、回复和票数，不校验 `ALLOWED_ORGS`，`limit` 也没有下界校验（见 [API](API.md) 端点清单）；反馈正文因此按公开内容对待，用户指南已提示勿提交敏感信息。「加入我们」投递没有任何读取接口。邀请先预留额度、再请求上游，明确失败补偿、未知结果保留待核对，不把超时解释为未发送。写请求核对 Origin 与 Fetch Metadata，返回错误不打印 token 或完整上游响应。鉴权 API 禁止缓存。公开文档使用允许列表，不公开内部运维、安全、规范和审查内容。

**客户端 IP 从哪来**：上面所有按 IP 的限流（邀请、反馈、投递、论坛），以及审计和投递里记的来源 IP，都取 Fastify 的 `req.ip`。部署链路是客户端 → 宿主 nginx → web 容器 nginx → server，两层 nginx 各往 `X-Forwarded-For` 末尾追加一段，所以两个环境都是 `TRUST_PROXY=2`：只信任这两层，客户端自己带的最左边几段不算。2026-09-26 之前两个环境写的是 `true`，信任整条链，`req.ip` 取的是客户端能随便填的最左边一段，换着填就能绕过所有按 IP 的限流，写进审计和投递的 IP 也能伪造（#116 审查发现，轮换 `X-Forwarded-For` 8 次 8 次成功）。改了反代拓扑要同时改两份 env 模板和 `scripts/deployment-environment.mjs` 的 `PROXY_HOPS`，`pnpm check:environments` 与 `tests/tooling/deployment-environment.test.ts` 核对层数与两份 nginx 配置一致。本机开发不设 `TRUST_PROXY`，只信任回环上的代理。

## 极客班控制台：称号与能力

控制台 `/api/console/*` 在「GitHub 组织角色」之外，加了一层**称号 → 能力**授权。称号和部门都是数据，由提督（以及权限包里有 `roles.manage` 的舰长）在控制台维护，不改代码；代码里固定的只有称号 id 与层级、能力清单、色调调色板和图标清单。规则与默认值在 `app/server/src/lib/roles.ts`，持久化在 `lib/role-store.ts`，判定在 `middleware/require-capability.ts`，端点与错误码见 [API](API.md)。

- **称号是数据**：称号 id 固定为 `admin` / `captain` / `head` / `member` / `alumni` / `guest`，每个称号的名字、英文标签、图标、色调、说明和权限包存在 `titles` 表。服务启动时把 `roles.ts` 的默认值写进去（`INSERT OR IGNORE`），已有的行不覆盖：第一次启动之后以数据库为准，重启、升级都不会把控制台里改过的值改回去。默认值是所有者 2026-09-25 定的星舰命名：提督（ADMIRAL，GitHub 组织的 owner）、舰长（CAPTAIN）、队长（LEADER）、舰员（CREW，GitHub 组织 active 成员自动获得）、领航员（NAVIGATOR，已毕业的学长学姐）、乘客（PASSENGER，没登录的人，只能看帖子）。队长显示为「{部门名} · {队长称号的名字}」、用部门的图标和色调；属于部门的舰员显示为「{部门名} · {舰员称号的名字}」、标签取舰员称号的标签、用部门图标和固定的 slate 色调。
- **层级固定在代码里**：提督 0、舰长 1、队长 2、带部门的舰员 3、领航员 4、舰员 5、乘客 9（`TITLES[*].rank` 与 `CREW_TITLE.rank`），因为「提督 = 组织 owner」「舰长只有一个」「队长属于部门」这些规则靠它执行，控制台改不了。一个人可有多个称号，主称号取 rank 最小者。显式指派存在 `role_assignments` 表；有显式领航员时不再自动派生舰员称号。
- **谁能改称号**：`PATCH /api/console/titles/:title_id` 要 `roles.manage`。服务端强制两条固定规则（`titleBundleError`）：提督的权限包永远是全部能力、乘客永远没有，这两个称号的权限包不能改（400 `title_capabilities_fixed`，名字、标签等显示字段可以改），读取时也不看库里存的值；`roles.manage` 只能放进舰长的权限包（400 `captain_only_capability`）。最高的两级（提督、舰长）只有提督本人能改（403 `admiral_required`）：否则持有 `roles.manage` 的舰长能把自己的权限包改宽，提督就管不住舰长。名字不能只有空白。图标只能取 `DEPARTMENT_ICONS` 里的一个，色调只能取固定调色板里的一个。有实际改动时审计 `title.update`。错误提示里的称号名字取当前库里的名字。遗留：舰长仍能改部门权限包，再把自己指派为某部门队长来叠加权限——提督要真正收窄舰长，就从舰长的权限包里拿掉 `roles.manage`。权限包改动在下一次请求就对所有持有该称号的人生效（每次请求都重新读称号设置）。
- **提督 = GitHub 组织 owner**：`CONSOLE_ORG` 的组织 owner（GitHub 组织角色 `admin`）自动获得提督称号（`source: "github"`），不经指派、不能在控制台撤下，拥有全部能力，不管有没有舰长。旧的「没有舰长时组织 admin 临时代任舰长（bootstrap）」已删除：`/api/console/me` 不再有 `bootstrap` 字段，`/api/console/assignments` 不再有 `bootstrap_active`，`source` 也不再有 `bootstrap`。
- **舰长**：全站最多一位（部分唯一索引 `uq_role_assignments_captain`）。只有提督或现任舰长能任命或移交舰长，其他人 403 `captain_required`；移交在单个事务里删掉旧行、插入新行。captain 行只能由舰长本人卸任或由提督撤下，其他人 409 `captain_transfer_required`；撤下后暂时没有舰长，提督不受影响。舰长的权限包默认是全部能力（含 `roles.manage`），只有提督能在控制台改。
- **部门**是数据（`departments` 表，默认 招新部 / 技术部 / 社区部 / 项目部），每个部门有队长与舰员两份**权限包**，叠加在队长、舰员称号自己的权限包之上。新增部门、改称号都不改代码；新增「能力」才需要改代码，因为能力必须有执行点。持有 `roles.manage` 的人可以删除部门（`DELETE /api/console/departments/:id`）：同一事务里撤掉这个部门的全部队长与舰员指派并审计被撤掉的人（`department.delete`），他们的其它称号不受影响；默认部门只在第一次启动写入（`console_seeds` 标记），删掉后重启不会复活。
- **能力**是扁平清单（`console.* github.* forum.* applications.* feedback.* audit.* roles.*`），取蕴含闭包（`*.manage` → `*.read`，任何 `github.*.manage` → `github.org.read`，`roles.manage` → `roles.department.manage`）。提督拥有全部能力（按清单动态计算）；`roles.manage` 只有提督和舰长的权限包里能有，不能放进部门权限包，也不能放进队长、舰员、领航员的称号权限包（服务端拒绝，`captain_only_capability`）。
- **GitHub 上限**：GitHub 操作一律用会话里用户自己的 token，控制台**不能授予任何 GitHub 权力**。最终 `github.*` 能力 = 称号给的能力 ∩ 用户在 `CONSOLE_ORG` 的 GitHub 角色上限（admin：全部；member：只有 `github.org.read`；非成员：无）。被挡掉的能力放进 `blocked`（`github_admin_required` / `github_membership_required`）。非 GitHub 能力（投递、意见箱、审计、称号管理、论坛）不需要组织身份。
- **队长范围**：`roles.department.manage` 只允许任免自己负责部门的舰员，跨部门返回 403 `out_of_department_scope`。成员全名单 `GET /api/console/people` 不按部门收窄：持有 `roles.department.manage` 的队长也能看到整个组织的成员（登录名、头像、GitHub 组织角色）和每个人的称号；名单用调用者自己的 token 向 GitHub 列组织成员。
- **失败语义**：GitHub 角色查询出错时交给 `http-policy` 统一映射（上游 4xx → `upstream_rejected`，5xx → `internal_error`），**不**当成「不是组织成员」，避免 GitHub 一时出错就把提督当成非成员、收掉他的权限。
- **公开的组织架构**：`GET /api/public/org` 匿名可读，只给称号与未归档部门的显示信息（名字、标签、图标、色调、说明、层级）和色调色值，不含权限包、不含任何人。官网「组织架构」窗口和论坛的称号徽章读它，读不到时用各自内置的默认值。
- **审计**：控制台写操作（含 `title.update`）、投递查看与导出一律以 `org = CONSOLE_ORG` 审计；审核备注只存在 `application_reviews`，不进审计。控制台审计接口不下发完整的邀请链接 token（只留前 6 位），否则持有 `audit.read` 的非组织管理员就能借链接发起人的 GitHub 授权发邀请，越过 GitHub 上限。
- **旧接口不变**：`/api/admin/:org/*` 仍只由 GitHub 组织角色控制。
- **论坛能力在服务端执行**（#57）：带 `sid` 但组织角色查到已不是 `CONSOLE_ORG` 成员的会话在论坛按游客处理，不建论坛用户，称号给的 `forum.*` 也不算。`/api/forum/*` 用同一个 `computeAccess` 算出的 `forum.*` 判定置顶（`forum.topic.pin`）、关闭（`forum.topic.close`）、编辑或删除他人帖子与在已关闭话题回复（`forum.post.moderate`），控制台里改过的称号与部门权限包下一次请求就生效；`forum.category.manage` 与 `forum.badge.assign` 仍没有接口。`state.viewer.capabilities` 下发给前端只用于显示按钮，授权只在服务端。动他人帖子、置顶、关闭以 `org = CONSOLE_ORG` 写审计，details 只有帖子与话题编号、作者编号或开关，不记正文。

**个人信息**：投递（姓名、班级、邮箱、特长）对所有持有 `applications.read` 的人完整可见；列表与详情不下发来源 IP 和 User-Agent。只有查看详情和导出会被审计，CSV 离开系统后无法追踪。

**残余风险**：成员身份只在登录时检查，登录后被移出组织的人，会话在 7 天有效期内仍在：`github.*` 能力随 60 秒角色缓存失效，控制台里显式称号给的非 GitHub 能力仍有效，没有显式称号的人变成乘客。论坛不一样：组织角色查到不是成员就按游客处理（最长 60 秒后生效），不能发帖、编辑、删除、点赞、收藏、关注，回复只能走游客那条路（昵称、PoW、按 IP 限流），称号给的 `forum.*` 也不算；这个人以前发的帖子和论坛用户留着。登录门槛不看称号，已经不在组织里的领航员也登录不了。组织若开启 OAuth App 访问限制而对应环境的 OAuth App 没被批准，所有人的登录都会以 `failed` 结束。GitHub 角色缓存 60 秒，撤销组织 owner 最长 60 秒后才失去提督。组织里有几位 owner 就有几位提督，每位都拥有控制台全部能力并能改所有称号的权限包，所以给 GitHub 组织加 owner 就等于给控制台最高权限。提督和舰长可以把队长、舰员、领航员的称号权限包改宽（`roles.manage` 除外），改动立即对所有持有该称号的人生效，`title.update` 审计只记改了哪些字段，不记改前改后的值。舰长的 GitHub 账号丢失时由提督在控制台撤下 captain 行、重新任命；没有提督能登录、也没有舰长时，控制台里没人能任命舰长或改称号。官网和论坛在 `/api/public/org` 读不到时显示内置的默认称号，可能与控制台里改过的不一致。论坛用户的称号与角色在本人下一次请求论坛时才刷新，别人看到的是他最近一次访问时的称号。`/auth/me` 的 `console_link` 只决定显不显示入口，GitHub 查询失败时为 false。按钮显隐只是提示，授权只在服务端。

## 论坛代码替换的边界

旧 React/Fastify 论坛已退出活动构建，核心不打开 forum.db、不注册旧写接口、不创建 forum_sid。旧 API 返回 410，生产未接好服务时论坛入口返回 503。旧数据库和附件保持原样，不能以清理代码为名删数据。

采用的 Tuff Forum 当前只有 Pinia/localStorage 演示，任意示例账号选择不是认证，UI 权限 helper 不是服务器授权，CDP 观察浏览器存储不是数据库审计。页面有显式提醒，只绑定本机回环端口，不将其发布为生产内部论坛。核心真实 GitHub 会话绝不接受示例 user ID/role 赋权。本机快照模式通过 dev 专用、仅 GET/HEAD 的 `/api/local-forum/*` 只读提供投影：哈希白名单、目录逃逸检查、索引给定的类型与 disposition、大小核对、no-store、nosniff 和禁止脚本的 CSP，错误体只含机器码（dev 错误处理器仍会附带堆栈，因此这些路由不进生产）；前端的论坛会话固定为游客、不渲染示例登录、论坛状态不写 localStorage；顶栏的全站 GitHub 登录只经同域 `/auth/me` 显示是谁，论坛没有据此授权的服务端。它没有给论坛增加任何授权，投影含真实成员公开资料，只能在所有者授权范围内本机使用。

旧论坛的密码策略、上传重新编码、归档后端保护等实现已经随旧源码退役；这些不能继续被列为新论坛已具备的防护。新的论坛后端（#57，核心服务 `/api/forum/*`，[ADR-0004](../decisions/0004-forum-backend-in-core-server.md)）重新实现了身份（只认 `sid`）、授权（`forum.*` 能力）、游客滥用防护、计数与事务（编号来自数据库计数器，写操作在事务里）、审计和头像上传：头像只收 PNG / JPEG / WebP、≤2MB，登录与每小时 10 次的额度在读请求体之前核对，每次上传都计数（解码失败也算），以 sharp 解码出的真实格式为准，解码前按像素上限（4096×4096）拒绝解压炸弹，动图只取第一帧，重新编码成 256×256 WebP、不带原图元数据，按内容哈希以 `image/webp`、`nosniff`、`default-src 'none'` 提供。`state` 里别人的通知设置不下发真实值（给初始值），一条帖子的 @提及最多通知 10 人。帖子正文按 Markdown 原样存储，服务端不做 HTML 净化：输出到页面前转义原始 HTML、拦 `javascript:` 等链接由论坛前端的渲染器负责（#107 核对并补测试），这一层没通过验收之前，论坛写入口就是站点脚本注入的入口。

## 工具与供应链

上游 MIT 声明保留，固定源码提交及两个独立锁文件。论坛按其 pnpm 配置禁止自动安装 Electron peer，保留安装脚本允许列表。未自动注册 Cloudflare 或购买服务。

核心自动测试用内存库和模拟 GitHub；论坛测试使用确定性数据和新建浏览器 profile。浏览器工具仅关闭本次启动的进程组，禁止使用通用名称匹配结束用户浏览器。历史源码备份和运行缓存不进入版本控制。

## 发布和残余风险

**单一 origin 的代价**：每个环境只有一个域名（`PUBLIC_ORIGIN`），官网、管理端（`/admin`、`/console`）和论坛（`/forum`，上游 Nuxt 代码）同源。写请求的 Origin 校验与 `return_to` 只接受这一个 origin，旧管理端子域一律拒绝；但同源也意味着官网或论坛页面上的任何脚本注入都能带着 `sid`（host-only、`Path=/`）调用管理端接口，旧的「管理端独立域名」隔离不再存在。因此三端共用的 CSP（`script-src 'self'`，宿主 nginx 下发）与论坛/Markdown 的输出净化是管理端权限的直接防线，放宽其中任何一项都要按管理端风险评审。论坛页面是唯一带自己 CSP 的上游：同一份站点策略，只在 `script-src` 里多出论坛构建产物中全部内联脚本的 sha256（现在是 importmap、配色、`__NUXT__` 配置三段，都是构建生成的，不含用户内容），由 `app/forum/scripts/csp-header.mjs` 在镜像构建时算出，脚本标签认不全就让构建失败；宿主只在 `/forum/` 下、上游已带 CSP 时不再叠加，其它路径一律照发站点策略，上游再带一份也只会更严（#78）。不允许为此改用 `'unsafe-inline'`，脚本里有断言。

两个环境（正式 tag `vX.Y.Z` → 正式栈、预发布 tag `vX.Y.Z-rc.N` → 预发布栈）必须完全隔离：独立目录、独立 compose 项目、独立端口、独立命名卷、独立密钥、独立域名；Cookie 使用 host-only（不写 `Domain`），禁止 `.yangtzeu.work` 这种父域共享，预发布不得读取正式环境的会话或数据。密钥只经 CI/CD 从 GitHub 环境级 secrets 注入渲染后的运行时 `.env`，仓库模板里的密钥字段保持空值（见 [ENVIRONMENTS](../ops/ENVIRONMENTS.md)）。

全站 GitHub 登录与登录门槛已在代码里实现，由 `tests/server/core.test.ts` 用模拟的 GitHub 响应覆盖；**未验证**：带成员校验的登录还没有用真实 GitHub 走完一次往返：所有者还没用新建的本机 OAuth 应用试过，预发布与正式环境也没有验证过。论坛的服务端身份、授权与存储已在核心服务实现（#57），**未验证**：没有在预发布或正式环境走过一遍，前端接入在 #107；旧论坛账号与 GitHub 登录的关联、内部 Hub、TLS、域名、Nginx、CSRF、OAuth Provider 和迁移恢复尚需完成；上游 Cloudflare PRD 只是提议。现有部署模板不等于已在目标机器应用。数据层仍是 SQLite + 命名卷，没有多实例隔离或多节点一致性验证；Postgres 迁移未做。没有完整依赖漏洞审计、WCAG/ASVS 认证或多实例验证。

旧部署文档曾暴露服务器登录凭据（原记录文件 `docs/ops/FORUM-SUBDOMAIN.md` 已随子域模型退役删除，事件记录保留在本节），已从当前工作区移除，但所有者仍需轮换并评估 Git 历史和传播副本。本轮不使用凭据、不擅自重写历史。check:secrets 只检查部分当前文本模式，不证明历史泄漏消失。

依据是当前代码、[forum 服务合同](../services/forum/README.md)、[采用决策](../decisions/0003-adopt-tuff-forum.md) 和 [官方参考范围](../conventions/REFERENCES.md)。

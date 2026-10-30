# ADR-0005：统一登录先在核心服务里建内部身份，对外授权接在它之上

> 已接受的方案（`accepted`），尚未实施：产品上叫「长江大学极客班统一登录」，GitHub（已有）、Google、邮箱验证码（以后可能有微信）都是绑定在同一个极客班账号（内部 OpenID）上的登录方式，会话、权限和审计都以账号为主语；先在 `app/server` 里建身份表、改会话、改三端的登录界面，不引入成品 IdP 或认证库；对外授权（OIDC）等第一个下游应用出现时接在内部身份之上，内嵌在 `app/server`，不另起授权服务器。头像、昵称等个人资料也归极客班账号，官网、论坛、控制台和比赛用同一份，改一处各端同步（决策 10）。GitHub 组织门槛不动：第一次建号仍要用 GitHub 证明是组织成员。

状态：`accepted`（部分实施，见「2026-10-23 修订」「2026-10-23 第二次修订」「2026-10-23 第三次修订」与「实施状态与业务交付清单」）· 更新：2026-10-23 · 依据：#237 正文「确认依据」里 2026-10-16 00:22 的会话原话、2026-10-18 的两条补充，以及 2026-10-19 对登录方式和统一资料的要求（见「背景」）。2026-10-19 所有者在会话里要求合并本方案的 PR #242 并关闭 #237，原话记在 PR #242 正文「确认记录」和 `notes/`，本行据此由 `proposed` 改为 `accepted`。「待确认」各项照旧保留：没答复的按文中默认，资格来源（A 或 B）在交付 2 建单前选定；业务交付清单的每一项仍要所有者逐个批准后才建 issue、开工。

## 2026-10-23 第三次修订（#262 第六期）

2026-10-23 13:52 所有者看到「密码至少 15 位」后在会话里表示：设计得太复杂，只要支持（两个密码例子，是所有者的真实密码，已本地核对，不公开）这种写法就行。据此把下面「2026-10-23 修订」第 2 条的最短长度改成 8 位，不要求大小写、数字或符号；上限仍是 UTF-8 72 字节（bcrypt），只在 `/account` 设、设密码要求这次登录不超过 10 分钟或填当前密码，这些不变。代价：8 位左右的密码比 15 位容易被猜中，在线猜测靠按 IP 每分钟 10 次与按邮箱 15 分钟 10 次的限次挡，见 [SECURITY](../architecture/SECURITY.md)「邮箱、Google 登录与邀请码注册」。

## 2026-10-23 第二次修订（#262 第四期）

2026-10-23 07:52 所有者在会话里表示：没必要再用 GitHub 了，因为权限都要放权；所有者的 GitHub 账号目前被封，想看到自己相关的权限，所以与 GitHub 相关的权限要放权；之后可能不只连接 GitHub，因为还要做自己的仓库；01:30 还表示：现在通过 GitHub 注册的都算组织成员，权限按站内称号认定。下一节第 3 条「资格与会话」以及决策 6 里与之冲突的部分以本节为准。第 1 条是这几句话的直接意思；第 2 到 5 条是 agent 按它做的具体设计，所有者还没有逐条确认，验收时一并确认：

1. **权限只认极客班账号**：账号记着成员资格与站内角色（`users.org_state`、`users.org_role`：管理员即提督、成员即舰员，或不是成员）。不论用哪种方式登录，能力都按它和称号给，不调用 GitHub、不看本人在 GitHub 组织里的角色，也不再有「GitHub 上限」（`/api/console/me` 去掉 `github_role` 与 `blocked`，加 `site_role` 与 `github`）。
2. **角色从哪来**：用邀请码注册的人记为成员；GitHub 新用户第一次登录时仍要是 `CONSOLE_ORG` 的 active 成员，记为成员，组织 owner 也一样（站内一位管理员都没有时除外，那时记为管理员，给空库起步），这样能改 GitHub 组织角色的人造不出提督；回填建的老账号还没记过时，它的 GitHub 会话第一次用到时按组织角色补记一次（owner 记为管理员，延续它以前的身份）。记下之后 GitHub 组织的变化不再影响站内：再用 GitHub 登录不查组织，只看站内角色。
3. **谁来改**：提督在控制台「成员与权限」里改别人的站内角色（`PATCH /api/console/people/:account_id/site-role`），不能改掉最后一位管理员；改成「不是成员」后不能再登录，已有会话下一次请求起没有任何能力，称号留着。
4. **GitHub 由服务器接入**：控制台的 GitHub 组织页面由服务器读写 `CONSOLE_ORG`（`lib/github-connection.ts`）：配了 GitHub App（`GH_APP_ID`、`GH_APP_PRIVATE_KEY`）用 App 的安装令牌，没配时退回本人的 GitHub 会话令牌，都没有回 409 `github_not_connected`。以后接自建 GitLab 照这个形状另写一个接入，称号判定不变。
5. **代价**：被移出 GitHub 组织的人站内照旧，要在控制台改站内角色；配了 App 之后 `github.*` 能力等于把 App 的那部分权限交给持有称号的人，GitHub 上记的操作者是 App。见 [SECURITY](../architecture/SECURITY.md)「权限只认极客班账号」的残余风险。

## 2026-10-23 修订（#262 第二、三期，所有者决定）

2026-10-23 所有者在会话里定了三件事，下文决策 4、5、6、7 里与之冲突的部分以本节为准：

- 「目前开放注册，现在的github注册的都算组织成员，后续需要邀请码去注册，在我们的admin控制台再额外加个邀请码的逻辑」，并给了一个默认邀请码（原文只存在运维的钥匙串里，不进仓库、文档和日志）。
- 「验证码和密码都支持」：邮箱既能用验证码登录，也能用在账号页设的密码登录。
- 「按站内称号认」：邮箱、Google 会话的控制台能力按站内称号给，不另做资格凭据。

据此实施（源码与测试见 #262，现行行为以 [SECURITY](../architecture/SECURITY.md)「邮箱、Google 登录与邀请码注册」与 [接口行为契约](../services/server/endpoint-contracts.md) 为准）：

1. **准入（替换决策 4、5 的「只有 GitHub 能建号」「第二渠道只能命中已绑定账号」）**：GitHub 登录照旧只对 `CONSOLE_ORG` 的 active 成员开放、不用邀请码；邮箱或 Google 第一次登录、还没有极客班账号时，凭一个可用的邀请码注册（新表 `invite_codes`，控制台 `/console/invites` 管理，能力 `accounts.invites.manage`，提督默认有）。建号、兑换邀请码、占用验证码与建会话在同一个事务里。仍然不按邮箱自动合并账号：Google 邮箱已属于别的账号时拒绝（`email_taken`）。
2. **邮箱密码（补充决策 5）**：密码只在 `/account` 设，至少 15 位（已被「2026-10-23 第三次修订」改成至少 8 位，保留作记录），bcrypt；设密码、绑定邮箱要求这次登录不超过 10 分钟或填当前密码。
3. **资格与会话（替换决策 6 的资格凭据、实时核验与 `membership_verification_required` / `membership_unavailable`；本条已被「2026-10-23 第二次修订」取代，保留作记录）**：没有实施「保留本人 GitHub 资格凭据 7 天」与「第二渠道每次登录实时查组织」。邮箱、Google 会话不调用 GitHub：成员资格看账号上记下的组织角色（最近一次 GitHub 会话查到的）或是否用邀请码注册；提督、舰员称号按记下的角色给；`github.*` 能力一律挡掉，要本人 GitHub 令牌的接口在调用 GitHub 之前回 403 `github_session_required`。`sessions.access_token_encrypted` 仍是 NOT NULL，非 GitHub 会话存空串加密后的值。账号上记的角色在 GitHub 会话实时查到时更新，再用 GitHub 登录被组织拒绝时清空；代价写在 SECURITY 的残余风险里：被移出组织、之后再也不用 GitHub 登录的人，记下的角色不会自己过期。
4. **注册入口（替换决策 7 的「没有单独的注册页」）**：仍没有单独的注册页，注册就在 `/signin` 上完成——邮箱表单或 Google 跳转遇到没有账号时，页面要邀请码，按钮变成「注册并登录」或「用 Google 注册」。
5. **渠道管理（决策 6、业务交付第 2 项的一部分）**：`/account` 已有，只能绑定邮箱；GitHub、Google 的绑定、任何解绑与账号合并都没做。
6. **Google**：代码已接好，没配 `GOOGLE_CLIENT_ID` 与 `GOOGLE_CLIENT_SECRET` 时不出现；凭据、同意屏幕与隐私政策页仍是上线前提（「登录方式」一节的表格）。

## 背景

2026-10-18 的会话里，所有者提出的要点（原文不入库）：

- 02:58：登录本质是多个授权登录，最后统一成一个 SSO 登录的 OpenID，之后其它授权登录都挂在它下面
- 03:01：登录和注册要和后端、数据库以及对应的前端界面一起考虑

2026-10-19 的会话里，所有者提出的要点（原文不入库）：登录不再以 GitHub 为主，改为长江大学极客班统一登录的自有 OAuth；其它登录方式（Google、GitHub、邮箱验证码）通过统一账号绑定，并确认能否支持谷歌登录、GitHub 登录与邮箱认证登录。可行性与设计见下文「登录方式：GitHub、Google 与邮箱验证码」。

同日补充：「还有我们登录sso无论哪个渠道的登录，邮箱登录，还有谷歌登录，还是github登录，都统一一个openid的唯一身份信息，然后对应每个账号绑定了对应不同渠道的信息，还有我们的sso登录是对应我们的整个服务的，我们的所有的登录都是统一的」。决策 2、5、7 就是这句话的落地：一个极客班账号（内部 OpenID）挂多个渠道身份，官网、论坛、控制台和以后的业务共用一个会话；落到接口、表和各业务上的写法见 [UNIFIED-LOGIN](../plan/UNIFIED-LOGIN.md)。

同日晚些时候：「还有因为统一sso登录了，所有用户是我们自己维护的一套，全局的头像还有相关的信息比赛，首页，管理后端，论坛都是用一套的，而且可以同步的更改，其他的你看看有没有更好的解决方案」。决策 10 是这句话的落地：头像、昵称等资料跟着极客班账号走，各端读同一份，改了之后各端下一次请求就是新的。

所以本方案同时回答三件事：数据库里身份和资料怎么存，后端怎么签发会话、以后怎么对外授权，三端界面怎么改。

**现在的事实**（来自 2026-10-18 的 `origin/stage`，不是规划）：

- 全站只有一个登录：核心服务的 GitHub OAuth 回调（`app/server/src/routes/admin/auth.ts:44-79`）换到 token 后，用这个 token 查登录者自己的 `GET /user/memberships/orgs/{CONSOLE_ORG}`（`app/server/src/lib/github.ts:38-47`），只有 `active` 成员才签发 `sid`；`pending` 与非成员不建会话、审计 `auth.signin_denied`，并尽力撤销这次授权。
- 会话是 SQLite 里的 `sessions` 一行（`app/server/src/lib/db.ts:23-31`）：`id`、`login`、`user_id`（GitHub 数字 id）、`avatar_url`、`access_token_encrypted`（`NOT NULL`）、`created_at`、`expires_at`，没有外键，索引只有 `login` 上的 `idx_sessions_login`，`user_id` 上没有。GitHub token 用 AES-256-GCM 加密（`app/server/src/lib/crypto.ts:12-27`），有效期 7 天（`app/server/src/lib/auth.ts` 的 `SESSION_TTL_MS`）。每次登录都签发一个新的随机 `sid`，不处理请求里已有的旧 `sid`，也没有续期。
- 官网、论坛、控制台同域，共用这个 host-only `sid`（[ADR-0004](0004-forum-backend-in-core-server.md)、[ARCHITECTURE](../architecture/ARCHITECTURE.md)）；host-only 来自部署配置（两个环境的 `COOKIE_DOMAIN` 都留空），不是代码写死的。论坛没有自己的登录。
- 会话里的 GitHub token 不只是身份，还是管理操作的上游凭据。直接读 `session.accessToken` 的有 14 个文件、36 处（`git grep -n 'session[!?]*\.accessToken' app/server/src`；`routes/admin/repos.ts` 占 17 处，另有 `middleware/require-capability.ts:15`、`middleware/require-org-role.ts:18`、`routes/admin/invite-links.ts:48`，邀请链接用发起人的 token）；`routes/admin/auth.ts:103` 与 `middleware/require-auth.ts:34` 经局部变量 `s.accessToken` 传递，不在这 36 处里。访问判定 `lib/access.ts:24` 每次都用这个 token 向 GitHub 查组织角色（缓存 60 秒），没有按渠道分支。控制台的 `github.*` 能力 = 称号给的能力 ∩ 这个 token 在组织里的角色上限（[SECURITY](../architecture/SECURITY.md)）。
- 业务数据以 GitHub 账号为主语：`role_assignments` 存 `github_login` 与 `github_user_id`（`lib/role-store.ts:184`）、论坛的 `forum_users`（`app/server/src/lib/db.ts:199-218`，id 形如 `m<github_user_id>`）、审计的 actor 是登录名。库里没有通用的 `users` / `identities` / `identity_audit`；没有迁移框架，建表一律 `CREATE TABLE IF NOT EXISTS` + 启动幂等回填 + `console_seeds` 标记（`docs/services/server/data-model.md`）。
- 前端：官网、控制台、论坛各有一套登录入口，网址都写死 `/auth/github?return_to=…`，失败文案都专指 GitHub。官网在 `app/web/sites/portal/lib/account.ts:14`（登录地址）、`:29`（读 `/auth/me`）、`:44`（退出）；控制台在 `app/console/src/lib/runtime.ts:42`、`lib/signin.ts:22-32`（「这个 GitHub 账号不在极客班的 GitHub 组织里」）、`pages/ConsoleRoot.vue:26`；论坛在 `app/forum/app/composables/useSiteLinks.ts:14`、`useSiteAccount.ts`、`components/LoginModal.vue`、`shared/signin-outcomes.ts:9-14`。`/auth/me`（`routes/admin/auth.ts:98`）返回 `signed_in`、`login`、`user_id`、`avatar_url`、`console_link`，三端按这几个字段显示头像菜单。
- 「注册」：没有自助注册。想加入的人在官网「加入我们」投递（`routes/portal/apply.ts`），通过后被邀请进 GitHub 组织（`routes/portal/join.ts`、`routes/admin/invite-links.ts`），接受邀请后第一次用 GitHub 登录才有会话。控制台登录失败的 `not_member` 引到 `/join-us`（`app/console/src/lib/signin.ts:29`）。
- 部署是一台 2 核 2 GB 的目标机、同机两套完整 Docker 栈（`/opt/yzgc/production`、`/opt/yzgc/preview`，[DEPLOY](../ops/DEPLOY.md)、[ENVIRONMENTS](../ops/ENVIRONMENTS.md)），单实例 SQLite + 命名卷，没有多实例协调（`docs/services/server/README.md`「已知限制」）。

**谁在等**：#229（内部 OpenID 底座）与 #228（绑定/解绑/合并接口）都以 `not planned` 关闭，等本方案决定是否沿用。后续内部服务都用同一个极客班账号登录，是 2026-10-05 的调研稿（本地，未入库）和 2026-10-18 的会话反复提出的目标，现在还没有哪个下游应用已经开工。#203（CLI 设备授权）同样以 `not planned` 关闭，不算需求方。

**要回答的问题**：#237 正文列的五个——谁要 SSO、选型怎么选、身份模型是否采用 `users`/`identities`、现有会话与论坛账号怎么迁、拆出哪些实现 issue；加上 2026-10-18 补充的一条：三层（数据库、后端、前端）各改什么。

## 决策

1. 内部身份先行，在 `app/server` 里做，统一账号与渠道管理不新增容器、数据库和进程。不引入成品 IdP（Casdoor），也不引入认证库（Auth.js、better-auth），理由见「考虑过的方案」。
2. 身份模型采用内部 OpenID 底座（#229 的方案）：`users`（内部 OpenID 为主键，绝不用自增或渠道 id）、`identities`（一个用户挂 N 条第三方凭据，`provider_uid` 用不可变的 GitHub 数字 id，`UNIQUE(provider, provider_uid)`）、`identity_audit`（`link` / `unlink` / `login` / `merge` 留痕）。`sessions` 加可空影子列 `openid` / `provider` 并双写，读写路径先继续以旧列为准。DDL 沿用 #229，按审查结果改六处：
   - `users.id` 用 128 位纯随机，不含时间戳（#229 用的 ULID 前 10 个字符是毫秒时间，对外发出去会泄露首次登录时间）。ULID 只留给 `identities.id`、`identity_audit.id` 这类不外发的内部 id。
   - `users` 加 `CHECK`：`status='merged'` 时 `merged_into` 非空；`merged_into` 加外键。
   - `canonical_email` 仅作已验证联系方式，不作主体标识，不凭相同邮箱、昵称或登录名自动合并账号。渠道身份只按 `(provider, provider_uid)` 识别；绑定冲突回 409，两边重新认证且明确确认后才能进入合并流程。
   - `provider_union_id` 的唯一索引改成普通索引：同一个人在微信的网站应用和小程序下是两个 `openid`、同一个 `unionid`，两行 `identities` 会撞上原来的唯一约束。`provider` 带应用标识（`wechat:<appid>`）或另加 `provider_app` 列并入唯一约束。
   - 登录命中已有身份后要检查 `users.status`：`disabled` 拒绝并写审计，`merged` 沿 `merged_into` 走到终点（限制链长、检测环）。
   - 登录事务、部分升级回滚、ULID 时间上限这三处按 Kaiserunix/geek-admin 的补丁 `463d95e` 改（#229 原版里 `createSession` 失败时旧 `sid` 已销毁、`users` 行已提交）。
3. 对外主体标识要稳定。`users.id` 是内部主键，永不改、永不复用、永不删，合并或停用的 id 也保留。将来对外授权用的 `sub` 按下游的 sector 单独生成高熵随机值，持久化在 `oauth_subjects(sector_id, user_id, sub)`；`UNIQUE(sector_id, user_id)` 与 `UNIQUE(sector_id, sub)` 保证映射稳定，不在每次登录时重算，不随签名密钥轮换而改变。下游按 `(iss, sub)` 识别用户，内部 id 不下发给下游。已向下游签发主体的账号不支持通用自动合并：合并前检查两个账号的主体映射，有任何已有授权映射时先回 409，交由另行确认的下游迁移流程处理，不能跟随 `merged_into` 后悄悄换掉 `sub`。`rollback-identity.mjs` 只在地基阶段可用：`identities` 里出现非 GitHub 渠道、或有下游持有 `sub` 之后，不再回滚，只向前修复。
4. 准入门槛不动：只有 `CONSOLE_ORG` 的 `active` 成员能建内部身份、能拿到会话，非组织成员不建身份（#226 的决定记录，2026-10-14）。顺序是先过组织门槛，再落内部身份、建会话；不是成员的人既没有会话也不留身份。
5. 登录方式是 GitHub（已有）、Google 与邮箱验证码，三者都只是同一个极客班账号名下的 `identities`；登录页和失败文案统一叫「极客班统一登录」，不再写「GitHub 登录」。GitHub 仍是唯一能建身份的渠道，因为只有它能证明组织成员资格（决策 4）；Google 与邮箱只能命中已在 `/account` 绑定过的账号，没绑定时拒绝并提示先用 GitHub 登录再绑定，不建新账号（是否放开见「登录方式」一节的待确认 1）。微信同理：它的 OAuth 只给 `openid` / `unionid` / 昵称 / 头像，不给邮箱、不带组织身份，资质到位前不接。QQ 不做：需要主体资质，服务器在境外且站点无国内备案（#237 正文）。
6. 非 GitHub 渠道的会话要有明确语义，现在的代码里没有：
   - `sessions.provider` 必填；`login` 取内部身份对应的 GitHub 登录名，不取第三方昵称（否则可能撞上别人的 GitHub 登录名，拿到别人的指派和缓存的组织角色）。
   - `sessions.access_token_encrypted` 改为可空，不用空串占位；非 GitHub 会话的 `github.*` 能力始终为空。资格查询与 GitHub 管理操作分开：后者仍只接受本次 GitHub 会话的本人 token，不能从账号绑定信息借用凭据。
   - 第二渠道不能只凭旧快照签发新会话。渠道管理交付中，已绑定的 GitHub 身份保留一份本人的加密资格凭据及 `credential_expires_at`，采用既有 AES-256-GCM，归属以不可变 GitHub uid 和内部账号核对；仅资格查询模块可读取，不出现在 `/auth/me`、渠道列表、审计或日志中。保留期限从本人最近一次成功 GitHub 认证起最多 7 天，与当前会话期限相同；普通请求和第二渠道登录不延长它，解除绑定、停用或明确令牌失效时清除密文。未实施该存储与清理合同前，第二渠道不启用。
   - 每次第二渠道新登录，在签发 `sid` 前都用上述本人凭据实时调用 `GET /user/memberships/orgs/{CONSOLE_ORG}`，只接受 `active`，不复用快照；`users` 的 `org_state`、`org_checked_at` 只供已有会话的资格查询，以及资格模块检查别的账号时只读复用（不签发、不保留会话）。缓存从查询开始计时最多 60 秒，按内部账号、组织和凭据版本隔离；重启、过期、未来时间戳或未知状态均须重新查询，禁止遇错延长旧结果。现有 `lib/access.ts` 的角色缓存是选择 60 秒上限的依据，不是未来资格校验已经实现的证明。
   - 本人凭据缺失、过期或被 GitHub 以 401 拒绝时，不签发新的第二渠道会话；已有第二渠道会话的受保护业务返回 `403 membership_verification_required`，引导 GitHub 重新认证后回原账号。超时、403、429 或 5xx 属于查询失败，返回 `503 membership_unavailable` 并允许重试，不当成退出组织，也不以旧快照放行。主会话本身无效才使用 401；GitHub 会话 token 失效仍遵循现有 `session_expired` 语义。
   - 确认 `pending`、非成员或本地账号停用时，在同一事务中使资格版本失效、撤销该账号会话并记审计；异步旧查询只可在版本未变时落库或签发会话，避免撤销后被旧结果恢复。新登录的准入失败沿用 `not_member` / `invite_pending` 的回跳，不泄漏身份关联。外部移出组织没有已实现的即时通知：新登录实时查询；已有会话的下一次受保护请求最多复用 60 秒的成功结果，随后必须重查，不能承诺零延迟撤销。后续 OIDC 同时撤销本站授权码、刷新令牌及授权记录；下游已有令牌与会话的失效上限须在应用授权交付中单独验证。
   - 控制台的 `github.*` 继续依赖用户自己的 GitHub token，不改成组织级 Bot / GitHub App 凭据：那会改变「控制台不能授予任何 GitHub 权力」这条既有安全口径（[SECURITY](../architecture/SECURITY.md)），是另一件事，需要单独授权。
   - 资格来源另有一种做法，待所有者确认（「登录方式」一节的待确认 2）：组织安装一个只读 GitHub App，只申请组织「Members」读权限并订阅 `organization` 事件；第二渠道的资格查询改用它的 installation token，按绑定的不可变 GitHub uid 查成员状态，收到 `member_removed` 立即撤销该账号的会话。采用后，上文「本人资格凭据最多保留 7 天」一条不再需要；实时核验、60 秒缓存、403/503 语义与撤销规则不变。这个 App 只读成员关系，不参与任何 `github.*` 裁决，上一条的安全口径不变。
7. 三端界面不再各写一份 GitHub 入口。后端提供可用渠道列表和登录地址（`GET /auth/providers`），统一登录页（标题「长江大学极客班统一登录」）按它渲染 GitHub、Google 按钮与邮箱验证码表单；失败文案按渠道写，不专指 GitHub；`/auth/me` 只加字段（`provider`、`account_id`；第二渠道交付再加 `membership_state`，见决策 6；统一资料交付再加 `profile`，见决策 10），已有字段不改，没改的前端照常能用。三端入口都回到同一个 `/signin?return_to=…` 登录页，由它读取渠道列表；各端只展示登录结果和头像菜单。账号页 `/account` 由现有控制台前端包承载，使用 Tuffex，按有效全站会话访问而不是要求 `console.access`；官网和论坛头像菜单链接到这里，不各做一套绑定界面。官网桌面沿用现有 DOM 界面做法。注册流程（投递、邀请、第一次登录）不变，第一次登录时自动建 `users` 与 `identities`，没有单独的注册页。
8. 对外授权（OIDC）推迟，不否决。它建在内部身份之上，内嵌在 `app/server`（`node-oidc-provider` 官方文档有挂进 Fastify 的写法），`sid` 不换，授权码与令牌放单独的表。现在不加依赖，立项条件见「对外授权的立项条件与重新评估」。
9. 本次不接第二 provider、不做绑定/解绑/合并接口、不改现有登录准入、不动 #229 的分支，也不写任何 `app/` 代码（#237 正文的「不做什么」）。它们进「业务交付清单」，等本方案被确认后逐项建 issue；数据库、接口、前端与验证是同一业务的内部步骤，不各立一个任务。
10. 头像、昵称等个人资料归极客班账号：新表 `user_profiles` 一个账号一行，官网、论坛、控制台和比赛都按 `account_id` 读这一份；读取时取，业务表不存名字或头像快照，所以改一处，各端下一次请求就是新的。昵称规则和头像处理沿用论坛现有的（同一套校验，`sharp` 裁图、按内容哈希寻址），不加依赖；论坛的资料接口保留路径，改为写这一份。编辑页 `/account/profile` 和 `/account` 一样由控制台前端包承载。初始值取论坛已有资料，没有就取 GitHub 登录名和头像；用户名跟随 GitHub 登录名，本人不能改；不导入 Google 的昵称和头像。昵称只用于显示，不参与认人和授权：认人仍按 `account_id`，会话的 `login` 仍是 GitHub 登录名（决策 2、6）。实施规格见 [统一资料（交付 4）](../plan/UNIFIED-LOGIN.md#统一资料交付-4)。

## 考虑过的方案

按本项目的真实约束对比（2 核 2 GB 且同机两套栈；单实例 SQLite、无迁移框架、三端同源）：

| 维度 | A. 内嵌 OIDC 授权服务（node-oidc-provider） | B. 成品 IdP（Casdoor） | C. 扩展现有后端，先立内部身份（采用） | D. 认证库（Auth.js、better-auth） |
|---|---|---|---|---|
| 新增组件 | 不需要新容器；在 `app/server` 的 Fastify 里挂 authorize / token / userinfo / jwks，要加 `oidc-provider` 与 `@fastify/middie` 两个生产依赖，另做客户端注册、同意页、签名密钥轮换 | 新容器 + 自己的数据库 + 管理界面 | 无 | 新依赖，自带 user / session / account 表和 cookie |
| 2C2G 上的代价 | 进程内的库，不另占容器；Node 22 上能否跑通、内存增加多少没有实测。`app/server` 镜像是 `node:22`，与 forum 的 Node ≥26 构建无关 | 多一个数据库和常驻进程，两套栈各一份 | 低 | 低 |
| 攻击面 | 新增授权端点，需要单独安全评审 | 默认配置与升级节奏在上游，密钥与回调在第三方界面里 | 复用已验证的签名 state、`return_to` 白名单、Origin 校验、会话模型 | 换掉会话层，等于把登录与会话重新评审一遍 |
| 与现有 `sid` 的关系 | `sid` 不换：授权码与令牌放单独的表，登录页读 `sid` 判断是否已登录；库自带的 `_interaction`、`_session` cookie 要和 `sid` 一起设计 | 多维护一份用户目录 | 直接演进 `sessions` | 要把 `sessions` 与 `sid` 换成库的会话；14 个文件、36 处读 `session.accessToken` 的代码都受影响。Auth.js 的 JWT 策略不落库，与「服务端可撤销、GitHub token 加密存库」冲突 |
| 能否支撑「多渠道 → 统一 openid → 以后对外授权」 | 只负责对外那一半，需要先有稳定的内部用户与独立的 `sub` 映射 | 能，但用户目录在别处 | 负责前一半：身份、会话、审计 | Auth.js 是登录客户端，不是授权服务器，不能给别的应用发授权；better-auth 的 oidcProvider 插件在 1.7 rc 被移除，改由 `@better-auth/oauth-provider` 取代，接口仍在变 |
| 维护状态 | 活跃（OpenID 认证过的 Node 实现） | 活跃 | 自己维护 | Auth.js 自 2025-09-22 由 Better Auth 团队接手，只做安全与紧急修复，官方建议新项目用 Better Auth；官方适配只有 Next、Express、SvelteKit 等，没有 Fastify |
| 结论 | 推迟，接在 C 之上 | 不采用 | 采用，先做 | 不采用 |

A 和 C 不是二选一，是先后：A 需要稳定的内部用户与独立的 `sub` 映射，C 先把它立起来。原稿否决 A 的几条理由——要新进程、要把 `sid` 换成 OIDC 会话、与 forum 的 Node ≥26 构建共存——核对后都不成立（见上表），保留的理由只有一条：现在没有下游应用已经开工，提前接 A 只会先付出安全评审和维护成本。2026-10-05 与 2026-10-18 的目标是后续内部服务都用同一个账号，所以这是推迟，不是否决。

不用 D 的原因：要解决的核心是数据模型（`users` 随机 id + `identities` 唯一约束 + 审计），库帮不上；而会话表、`sid`、组织门槛、签名 state、撤销授权这些定制逻辑，换库等于重写。将来新增渠道觉得协议代码重复时，再单独评估 `arctic`、`openid-client` 这类只做上游客户端的库（新增生产依赖需要批准）。

身份模型的取舍：另有一种做法是「不动 `sessions`，直接再加一张渠道表」。被否：渠道表与 `sessions.login` 之间没有稳定主键可挂（`login` 可改、`user_id` 有的旧会话为空），迟早要补一次内部主键；#229 的「先双写影子列、不读」把这次切换拆成可回滚的两步。

资料放在哪的取舍（决策 10）：

| 做法 | 改一处、各端同步 | 代价 | 结论 |
|---|---|---|---|
| A. 各端各存一份（论坛现在这样） | 做不到：官网、控制台和比赛看不到论坛里改的昵称和头像 | 每个业务各做一套编辑、校验和头像存储 | 不采用 |
| B. 一律显示 GitHub 登录名和头像 | 只能去 GitHub 改；会话记的是登录时的登录名和头像地址，要重新登录才更新 | 不用开发，但论坛已有的昵称和上传头像作废，邮箱、Google 会话也只能显示 GitHub 资料 | 不采用；交付 4 之前的过渡做法 |
| C. 账号级统一资料（采用） | 做得到：各端读同一份，读取时取、不存快照 | 一张表、一个编辑页；论坛接口改写这一份，回滚期间在同一事务里给论坛旧列镜像写一份 | 采用 |
| D. 外部头像服务（Gravatar） | 只管头像，不管昵称 | 按邮箱哈希取图，等于把成员邮箱的哈希交给第三方；国内访问不稳定 | 不采用 |

## 业务边界与三层合同

本地的 `users.id` 是极客班账号主键，文中沿用「内部 OpenID」这个项目称呼；它不是第三方的 `openid`，也不是对外协议里的 `sub`。SSO 是「同一个账号与登录会话可用于多个应用」的产品能力。OAuth 2.0 负责应用获取授权；下游要用授权结果登录时采用 OIDC，并校验 ID Token，不能把一个 access token 当成用户身份。现在三端同源，先共用 `sid`；未来跨 origin 的应用走授权码流程，不共享父域 cookie。

以用户可完成的业务组织交付：

| 业务能力 | 数据库模型与不变量 | 后端合同 | 前端表现与可验收结果 |
|---|---|---|---|
| 统一账号与一次登录 | `users` 稳定随机 id；`identities` 挂不可变渠道 uid；`sessions.openid` 指向内部账号，`provider` 表示本次登录来源；角色、论坛和审计加内部账号引用，旧记录保留 | GitHub 组织准入成功后，在一个事务里解析身份、建新会话、撤销当前旧会话；`/auth/me` 保留旧字段并新增 `account_id`、`provider`；三端读取同一会话；退出撤销该会话 | 三端都进入同一登录页，成功回原页面；官网登录后进入论坛与控制台不再要求重复登录；任一端退出，其他端再次请求时显示退出；GitHub 改登录名不丢称号、帖子与业务记录 |
| 渠道与账号管理 | 一个账号可绑定多个渠道，但一个渠道身份只能属于一个账号；保留一个可刷新资格的 GitHub 身份、限期加密资格凭据及资格版本；`identity_audit` 只记操作、结果与内部账号 | 绑定、解绑须近期重新认证；冲突 409；禁止删除最后一个 GitHub 身份；第二渠道新登录实时核验 active，已有会话最多复用 60 秒资格结果；撤销与会话失效原子提交，详见决策 6 | `/account` 统一展示渠道状态、绑定/解绑结果；资格凭据需刷新时引导 GitHub 重认证回原账号，上游临时失败可重试；未配置渠道不出现可点按钮；Google 凭据或微信资质未到位不阻塞统一登录本身 |
| 统一资料 | `user_profiles` 一个账号一行：用户名、昵称、签名、所在地、网站、头像来源与上传图的内容哈希、`version`；业务表只存 `account_id`，不存名字或头像快照 | `/auth/me` 加 `profile`；资料与头像接口带 `version`，并发修改回 409；服务端把头像解析成 `{ url, color, initial }`；论坛资料接口保留路径、改写同一份 | 在 `/account/profile` 改头像或昵称后，官网、论坛、控制台和比赛下一次请求就显示新的，开着的页面自动刷新；认人的地方昵称旁显示 @用户名 |
| 应用授权登录（后续） | `oauth_clients` 保存受控客户端与精确回调；`oauth_subjects` 持久化 sector 与主体映射；授权、授权码、令牌单独存储，可撤销、可过期；密钥不入业务响应 | OIDC Authorization Code + PKCE S256；授权码一次性使用；校验 client、redirect_uri、scope；下游验证 issuer、audience、签名、有效期、nonce；已登录 `sid` 可进入授权页 | 控制台登记客户端；用户看到应用、所需权限与允许/拒绝；回调后下游识别同一用户；用户可撤销授权。单点登出需要下游支持对应协议后另验收，不能由清除本站 cookie 推定 |

数据库迁移是业务交付内部的步骤：加表和可空外键 → 幂等回填 → 双写比对 → 切换读取 → 保留兼容列。先在虚构历史库验证重跑、部分失败恢复、重复渠道、GitHub 改名、停用与合并链。角色与论坛仅按不可变 GitHub uid 关联既有内部身份，不能只凭可能复用的 `github_login` 认领；缺 uid 或有冲突时保留旧行并报告，待重新认证或人工核对。已存的论坛用户、帖子主键和审计 actor 文本不重写，新内部外键与旧字段并存。登录事务失败时旧会话仍有效；明确过期或停用的会话拒绝访问，不因缺少迁移值而悄悄放行。

### 接口与状态对应

以下新增接口是待实施合同，不属于本 PR 已上线接口；兼容入口保留，不给第三方应用复用管理端 GitHub token。

| 方法与路径 | 会话、入参与结果 | 前端处理 |
|---|---|---|
| `GET /auth/providers` | 匿名；只返回已启用渠道的 `id`、`name`、本站登录路径及 `can_register`，不下发 client secret；统一账号阶段只有 GitHub，多渠道交付再加 `google` 与 `email`（`email` 没有跳转地址，登录页显示邮箱表单） | 统一登录页读取，加载/失败/无可用渠道分别显示；失败不退回写死的渠道入口 |
| `GET /auth/github`、`GET /auth/callback` | 保留现有入口；校验 state、cookie、有效期与 return_to；组织 active 才落身份和会话；失败不留下半个账号 | 失败改回统一登录页 `/signin?signin=<原因>&return_to=…`（现状是回原页面，待所有者确认），保留 `not_member`、`invite_pending`、`cancelled`、`failed` 的引导；尚未入组继续投递/接受邀请，没有开放注册按钮 |
| `GET /auth/google`、`GET /auth/google/callback`、`POST /auth/email/start`、`POST /auth/email/verify` | 多渠道交付；匿名；只命中已绑定账号，资格校验同决策 6；细节见「登录方式」一节 | 统一登录页按 `/auth/providers` 显示；未绑定时提示先用 GitHub 登录再绑定；邮箱表单不提示邮箱是否注册 |
| `GET /auth/me` | 未登录维持 `{ signed_in: false }`；已登录保留 `login/user_id/avatar_url/console_link`，新增内部 `account_id` 与本次 `provider`，第二渠道交付时再加 `membership_state`，统一资料交付时再加 `profile`；`user_id` 仍是 GitHub uid，不能偷换语义。资格暂不可核验时保留有效登录，只返回 `verification_required` 或 `unavailable` 状态且 `console_link: false`；已确认退出组织并撤销会话时返回未登录 | 三端继续兼容旧字段；内部业务使用 `account_id`；资格需刷新进入 GitHub 认证，上游失败显示重试，受保护接口仍按决策 6 拒绝；展示的昵称、头像等资料不充当授权依据 |
| `POST /auth/signout` | 有 Origin/Fetch Metadata 检查；撤销当前 `sid`，清 host-only cookie；不等于撤销 GitHub 授权或所有下游会话 | 返回原端退出态，清缓存身份；其他端的下一次请求同步失效 |
| `GET /api/identity/me` | 有效会话；只返回本人渠道与是否可解绑，不含上游 token、微信 unionid 或他人关联 | `/account` 展示绑定状态；不要求持有控制台业务能力 |
| `POST /api/identity/link`、`POST /api/identity/unlink`（邮箱的绑定另走 `POST /api/identity/email/start`、`/verify`） | 有效会话、近期重新认证、Origin 和限流；绑定使用与当前账号及操作绑定的一次性 state；成功重新读取本人信息；冲突 409。仅 step-up 证明缺失或过期返回 `403 step_up_required`，不撤销仍有效的 sid；`401` 只用于主会话无效 | 保留正在操作的渠道与当前登录，引导重新认证后再提交；解绑最后一个 GitHub 身份时引导先恢复资格刷新方式 |
| `POST /api/identity/merge` | 两个账号分别重认证且用户明确确认；事务迁移可合并关联，冲突、既有下游主体或不能自动合并的记录回 409；不凭邮箱自动合并 | 先展示影响再确认；无法自动合并时保留两个账号，不显示成功 |
| `GET /oauth/authorize`、`POST /oauth/token`、`GET /oauth/userinfo`、`GET /.well-known/openid-configuration` | 后续 OIDC 模块；token/userinfo 使用协议凭据，不复用控制台能力或 GitHub token；discovery、JWKS、撤销与登出契约一并交付 | 独立下游登录与同意/拒绝流程，不能用三端同源 `sid` 测试冒充跨应用验收 |

### 与比赛业务的关系

#243 / #238 只交付比赛信息发布：`competitions` 记录赛事事实，公开列表匿名可读，控制台写入仍走现有 `competitions.manage`。它不需要为了 SSO 等待新表，也不把 GitHub 登录名加进比赛记录充当未来参赛者标识。#239 的报名、队伍、队员等后续个人业务应引用稳定的内部账号；具体状态机和接口在该业务自身确定，不能把「登录表做好」写成报名组队已经完成。公开赛事资料、本人参赛记录、管理权限是不同的读取范围。#239 的方案（[`plan/COMPETITION-APP.md`](../plan/COMPETITION-APP.md)，`accepted`、未实施）按本 ADR 的 `account_id` 识别参赛者，名单上的昵称和头像读取时取统一资料（决策 10），排在交付第 1 项之后实施。

## 登录方式：GitHub、Google 与邮箱验证码

2026-10-19 所有者要求统一登录支持 GitHub、Google 与邮箱认证登录，其他登录方式都绑定到同一个极客班账号。按官方文档与本仓库现状核对（2026-10-19）：三种都能做，不新增容器或生产依赖；Google 要所有者先建凭据、补隐私政策；邮箱验证码要一条即时发信通道；三种方式背后的成员资格仍来自 GitHub 组织。

| 方式 | 结论 | `identities` 的键 | 前置条件 | 限制 |
|---|---|---|---|---|
| GitHub | 已上线，保留 | `github` + GitHub 数字 id | 无：生产与开发用的 OAuth App 凭据已在所有者的凭据库 | 唯一能建号、能证明组织成员的方式；控制台 `github.*` 只认本次 GitHub 会话的本人 token |
| Google | 可做：OIDC 授权码 + PKCE S256 + state + nonce | `google` + ID Token 的 `sub` | 所有者建 Google Cloud 项目（开发与生产分开）、外部同意屏幕和「Web 应用」客户端，登记回调 `https://<站点域名>/auth/google/callback`；凭据库目前没有 Google 凭据；官网新增隐私政策页并在首页链接；要让同意屏幕显示应用名称和 Logo，再在 Search Console 验证域名后做品牌验证 | 中国大陆网络通常打不开 Google 登录页，只能作可选方式；只申请 `openid email profile`：只请求这几项（含 Sign in with Google）时，发布状态为 Testing 也不用登记测试用户、不显示未验证提示、授权不会 7 天过期；以后加别的 scope 就不再豁免——Testing 限 100 名测试用户、授权 7 天过期，敏感或受限 scope 未通过应用验证前限 100 名新用户；品牌验证只管同意屏幕显示应用名称和 Logo |
| 邮箱验证码 | 可做：6 位验证码，不做密码 | `email` + 规范化邮箱（去首尾空格、转小写） | 一条即时发信通道：现有 `mail_outbox` 每 15 秒发一遍、失败按 1 分钟到 6 小时退避，而验证码 10 分钟就过期；沿用阿里云邮件推送在前、Resend 兜底和现有发件域名 | 到达率取决于收件方，QQ、163、Gmail、Outlook 要实测是否进垃圾箱 |

账号与绑定：

- 「极客班账号」是 `users` 的一行；三种方式都是它名下的 `identities`，`UNIQUE(provider, provider_uid)`；`sessions.provider` 记本次用的方式。三端显示的名字和头像取账号的个人资料（决策 10；有资料之前是绑定 GitHub 的登录名和头像），会话的 `login` 仍是 GitHub 登录名（决策 6），不显示 Google 昵称或邮箱。
- 建号：第一次必须用 GitHub 登录并通过组织门槛（决策 4、5）。Google、邮箱只命中已绑定的账号；未绑定时拒绝，提示「先用 GitHub 登录，再到账号页绑定」。
- 绑定在 `/account`：已登录、近期重新认证、当场完成新方式的认证（Google 走一次授权，邮箱收一次验证码），一次性 state 或验证码与当前账号和本次操作绑定。该方式已属于别的账号时回 `409 identity_conflict`，不说明属于谁。
- 不按邮箱合并：Google 返回的邮箱与某个账号已绑定的邮箱相同，也不自动登录或绑定；要用邮箱登录就单独绑定邮箱。`email_verified` 不为真的 Google 邮箱不写入 `canonical_email`。
- 解绑：近期重新认证；不能解绑最后一种登录方式，也不能解绑唯一的 GitHub（决策 6）。

Google 登录：

1. `GET /auth/google?return_to=…`：生成 state、nonce 和 PKCE `code_verifier`，按现有 GitHub state 的签名 cookie 做法保存；跳到 Google 授权页，`scope=openid email profile`、`prompt=select_account`。绑定从 `/account` 发起，state 另外绑定当前账号与操作。
2. `GET /auth/google/callback`：校验 state 与 cookie → 用授权码、client secret 和 verifier 换 token → 校验 ID Token 的 `iss`（`https://accounts.google.com` 或 `accounts.google.com`）、`aud`（本站 client id）、`exp` 与 `nonce`。Google 允许不验签的前提是 ID Token 直接来自它的 token 端点；本站仍按 Google 的 JWKS 验签，用 Node 自带的 `crypto`，不加依赖。
3. 按 `(google, sub)` 找账号 → 资格校验（决策 6）→ 同一事务建会话。不保存 Google 的 access token。

邮箱验证码登录：

1. `POST /auth/email/start { email, return_to }`：规范化邮箱；同一邮箱 60 秒内不重发，按邮箱每小时 5 次、按 IP 每小时 20 次限流。只有邮箱已绑定且账号可用时才生成验证码并发信；不论是否绑定都回同样的 `202 { resend_after: 60 }`，用短期 HttpOnly cookie 绑定这次挑战——不泄露邮箱是否注册，也不向未绑定的地址发信。
2. 验证码 6 位、10 分钟有效、库里只存带服务端密钥的 HMAC、最多试 5 次，成功即作废；重新获取会让旧码失效。挑战存在新表 `email_challenges`（随机 id、用途 `signin` / `link`、规范化邮箱的 HMAC（绑定挑战另存地址原文）、账号、`code_hmac`、尝试次数、创建、过期与使用时间），过期行定期清理。
3. `POST /auth/email/verify { code }`：凭 cookie 找挑战；成功 → 资格校验 → 建会话。验证码不对回 `400 invalid_code`；过期或次数用尽回 `400 code_expired`，要求重新获取。
4. 发送走即时通道，但请求不等发信：`start` 做完规范化、限流和建挑战就回 202；邮箱已绑定时把发信交给进程内即时队列，响应之后马上投递（阿里云邮件推送在前，失败马上改走 Resend），不进 `mail_outbox`。已绑定或未绑定、投递成功或失败，`start` 的状态码和响应体都相同，响应也不因发信变慢；两路都失败只记日志，不改变响应，用户 60 秒后可重新获取。邮件正文只有验证码、有效期和「不是本人操作请忽略」，不放登录链接（邮箱的安全扫描会预先打开链接，也便于钓鱼仿冒）。
5. 绑定邮箱：`POST /api/identity/email/start`、`POST /api/identity/email/verify`，要求已登录、近期重新认证、Origin 检查；成功写 `identities` 与 `identity_audit`，可同步为 `users.canonical_email`，仍不作主体。

资格来源（待确认 2）：Google 与邮箱会话同样必须是组织 `active` 成员（决策 4、6）。

| 做法 | 怎么查 | 用户感受 | 代价 |
|---|---|---|---|
| A. 只读 GitHub App（推荐） | 组织安装只申请「Members」读权限的 GitHub App 并订阅 `organization` 事件；登录时用 installation token 按 GitHub uid 取当前登录名，再查 `GET /orgs/{org}/memberships/{username}`；收到 `member_removed` 立即撤销会话 | 绑定后一直能用 Google 或邮箱登录；移出组织即时生效 | 组织所有者安装授权；服务器多一把 App 私钥和 webhook 密钥；新增 `POST /webhooks/github`（校验 `X-Hub-Signature-256`） |
| B. 本人 GitHub 凭据（决策 6 现文） | 用最近一次 GitHub 认证留下的本人加密凭据实时查 `GET /user/memberships/orgs/{CONSOLE_ORG}`，最多保留 7 天 | 超过 7 天没用 GitHub 登录，Google 和邮箱登录会被拒，要先用 GitHub 重新验证 | 不新增组织级凭据；移出组织靠下一次实时查询发现 |

所有者要准备的：

1. Google：建项目、外部同意屏幕（应用名「长江大学极客班」、支持邮箱、授权域名）和「Web 应用」客户端，登记生产、预览与本地回调；client id 与 secret 存进凭据库和 CI 环境（建议 `YZGC_GOOGLE_CLIENT_ID`、`YZGC_GOOGLE_CLIENT_SECRET`）；官网新增隐私政策页并在首页链接；Search Console 验证域名后提交品牌验证（让同意屏幕显示应用名称和 Logo；只用 `openid email profile` 不需要应用验证）。
2. 邮箱：确认发件域名的 SPF、DKIM、DMARC，同意新增即时发信路径。
3. 资格来源选 A 时：在组织安装只读 GitHub App，私钥与 webhook 密钥进凭据库和 CI。

验证：

- 本地：模拟 Google 的 token 与 JWKS 端点和发信服务，覆盖 state、nonce、PKCE 错误与重放，`aud` 不符，ID Token 过期，未绑定，绑定冲突 409，验证码错 5 次、过期、重发冷却、限流，邮箱已绑定/未绑定 × 投递成功/失败四种组合下 `start` 的状态码与响应体相同，邮箱大小写，并发校验，非成员与 `pending`，资格查询失败的 403 与 503。
- 真实往返：Google 用测试账号走完登录与绑定；邮箱验证码用本机收码工具的邮箱（飞书企业邮、QQ 邮箱、两个 Gmail、Outlook）实测送达时间、是否进垃圾箱和完整登录。结果记进实施 PR，模拟结果不能代替。

待确认：

1. 建号范围：保持 #226（只有 GitHub 组织 `active` 成员能建号，Google 和邮箱先绑后用；推荐），还是允许没有 GitHub 的人用 Google 或邮箱建「极客班账号」。后者要把账号与成员资格拆开，并重审论坛、比赛等「登录即成员」的口径（见立项条件 2）。
2. 资格来源：A 只读 GitHub App（推荐），或 B 7 天本人凭据。
3. 「我们自己的 OAuth 登录」：官网、论坛、控制台同域，继续共用 `sid` 就已经是单点登录；对外的 OIDC 授权（让别的应用用极客班账号登录）本期一起做，还是按决策 8 等第一个独立应用出现（推荐后者）。

## 后果

- 统一账号、数据库兼容迁移、后端会话和三端登录回归作为一项完整交付验收；双写只是内部实施步骤，不将没有用户可见结果的地基单独报完成。
- 其他登录方式的凭据、发信通道和资质与统一登录拆开：GitHub 先完成统一账号，Google、邮箱验证码（以及以后的微信）各自就绪后接入同一账号管理，不推迟现有三端的一次登录。
- 核心服务承担认证职责，不增加常驻容器；不将用户 GitHub token 换成组织级凭据，不改变现有 GitHub 权力上限。
- 多渠道或下游主体一旦实际使用，停止破坏性身份回滚，只向前修复；独立回滚只适用于尚未对外引用、能完整恢复旧读路径的迁移阶段。
- 头像、昵称从论坛升到账号一级（决策 10）：各端不再各存一份，改一处全站同步；代价是显示时多按 `account_id` 取一次资料，回滚期间论坛旧列要在同一事务里镜像写一份。

## 实施状态与业务交付清单

2026-10-23：第 1 项已由 #262（PR #268）实施；第 2 项按「2026-10-23 修订」实施了邮箱验证码与密码、Google 登录、邀请码注册、`/account` 与邮箱绑定，没做 GitHub/Google 的绑定、解绑、合并与决策 6 的资格凭据；成员资格按「2026-10-23 第二次修订」改成只认站内角色；第 3 项由 #270 实施：按决策 8 内嵌 `oidc-provider`（只加这一个生产依赖，不用 `@fastify/middie`），首个下游是自建 GitLab，同意页 `/authorize`，`sub` 按 sector 存在 `oauth_subjects`，并按极客班账号在 GitLab 上建号、进组、封禁（[对外授权与 GitLab 账号同步](../services/server/oidc.md)）；拒绝、错回调、重放、PKCE 与撤销由 `tests/server/oidc.test.ts` 覆盖，真实 GitLab 往返在预发布验收后才算交付，单点登出没做；第 4 项未实施。下面是 2026-10-19 写下时的原状，保留作记录：

未实施。本 ADR 只产出方案：没有改任何 `app/` 代码，没有建表，没有接第二 provider，没有动 #229 的分支与 PR。当前三端共享 GitHub `sid` 是既有能力；稳定内部账号、多渠道 SSO、统一资料与下游 OIDC 登录均不能标为已交付。2026-10-19 所有者要求合并 #242 与 #243、关闭对应 issue，本 ADR 据此改为 `accepted`；下表各项都还没建 issue，要所有者逐个批准后才建单、开工。

| 序 | 业务事项 | 痛点与方案 | 最终效果与验收 | 依赖 |
|---|---|---|---|---|
| 1 | 统一账号与登录 | GitHub 登录名承担内部主体，无法稳定承接其他渠道；在同一事项里完成身份表、会话与业务关联迁移、统一登录页、三端接入和退出同步 | GitHub 登录一次跨三端使用；改名不丢权限/帖子；旧库升级重跑不重复建号；失败不破坏旧会话；未入组拒绝；服务端真实路由与浏览器回跳通过 | 方案确认；无需等待微信资质 |
| 2 | 多渠道登录与账号管理 | 新渠道要接到同一账号且不能误绑；首批 Google 与邮箱验证码，完成绑定、解绑、冲突处理、决策 6 的资格来源、实时准入与撤销、以及 `/account` | 绑定后第二渠道回原账号；未绑定、pending、移出组织后新登录均拒绝；已有会话资格缓存的 60 秒边界、过期/重启/上游失败、7 天凭据清理（资格来源选 B）或 webhook 即时撤销（选 A）、撤销与并发旧结果逐项回归；Google 与邮箱各自的登录、绑定、冲突和失败路径通过；禁止解绑最后一个 GitHub；资格刷新和 step-up 的 403 不误退出，主会话无效才按 401 退出 | 1；Google 客户端、隐私政策与域名验证；邮件即时发送通道；资格来源的决定 |
| 3 | 应用授权登录 | 独立应用不能使用同源 `sid`；以 OIDC 连接内部身份、客户端登记、同意页和稳定 `sub` 映射 | 至少一个独立 origin 的受控下游完整登录；拒绝、错回调、重放、PKCE 错误与撤销用例通过；密钥轮换不变 `sub`；所宣称的登出范围经过实际验证 | 1；首个下游与 scope 已确定；依赖准入另行确认 |
| 4 | 统一资料 | 头像和昵称只有论坛有，官网和控制台显示 GitHub 登录名和头像，各端各显示各的；改为账号级的一份资料，`/account/profile` 统一编辑，各端读取时取，论坛资料接口改写同一份 | 改头像或昵称后官网、论坛、控制台和比赛下一次请求就是新的，开着的页面自动刷新；论坛已有资料原样迁入、回填可重跑；两处同时改时后保存的一方看到冲突提示，不静默覆盖；冒用官方名或别人的用户名被拒；管理员重置留审计；回滚到旧镜像后论坛照常显示 | 1；可与 2 并行 |

第 1、2、4 项落到字段、错误码、表、文件与测试的实施规格见 [`plan/UNIFIED-LOGIN.md`](../plan/UNIFIED-LOGIN.md)（同为 `accepted`、未实施，含方案草图与四个候选 issue）；它建议把第 2 项拆成「邮箱验证码、账号页与成员资格」和「Google 登录」两个候选，待所有者确认。每项都是数据库、接口、UI、迁移与验证同行的业务交付，不再按三层拆 issue。每个新事项仍需所有者确认；本次只修订现有 #237 的方案。迁移演练、带模拟上游的本地 API、PR 样板预览、真实 OAuth 往返、所有者验收分开记录。

## 对外授权的立项条件与重新评估

出现下面第 1 条时，提出第 3 项的建单候选（仍需逐个确认）；出现第 2 条及以后任一条时，回到本 ADR 重新评估选型（是否改选 B 或别的方案）：

1. 第一个下游应用（内部服务、独立子域或第三方）提出要用极客班账号登录；或者出现第二个 origin 或第二个后勤服务，host-only `sid` 不再够用。
2. 需要非 GitHub 身份建号：出现「没有 GitHub 账号也必须是成员」的真实场景（今天被 #226 的决定否掉；是否放开见「登录方式」一节的待确认 1）。
3. 控制台要脱离用户 GitHub token：36 处用户 token 调用点改走应用级凭据时（那是一次安全模型变更，会同时改变 `github.*` 的裁决口径）。
4. 单实例假设被打破：上多实例或迁 Postgres 时，会话与身份存储需要重新设计。
5. 第二个 provider 被要求独立完成认证（而不是只做上游绑定）——那意味着平台要自己签发身份。

已有下游持有 `sub` 之后，回滚脚本停止使用，改为只向前修复。

## 参考资料

- #237（本方案）：统一登录（SSO）规划：先定方案，再拆实现。
- #57（已完成）：论坛后端与论坛资料；决策 10 沿用它的昵称规则与头像管线。
- PR #229（`task/226/openid_identity`，已关闭）：内部 OpenID 底座；本 ADR 采用它的三表 DDL、影子列双写与回滚脚本口径，并按决策 2 改六处。后续补丁：Kaiserunix/geek-admin 的 `463d95e`（登录事务、影子列读路径、部分升级回滚、ULID 时间上限）。
- #226（`not planned`）：身份底座；其决定记录「不允许非组织成员建内部身份」「第二渠道选微信，微信只能命中已绑定身份」是决策 4、5 的依据。
- #228（`not planned`）：绑定/解绑/合并与 step-up；进业务交付第 2 项。
- #203（`not planned`）：CLI 设备授权，已取消，不作为需求方。
- Auth.js 并入 Better Auth 的公告（https://better-auth.com/blog/authjs-joins-better-auth，2025-09-22）。
- panva/node-oidc-provider 官方文档：Fastify 挂载、Adapter 接口、`findAccount`。
- [OpenID Connect Core 1.0](https://openid.net/specs/openid-connect-core-1_0.html)：§2 的主体标识、§5.7 的声明稳定性与唯一性、§8 的 pairwise sector；2026-10-19 核对。邮箱或昵称不构成账号主键，外部身份按 issuer 与 subject 识别。
- [RFC 9700](https://www.rfc-editor.org/rfc/rfc9700.html)：§2.1 的授权码、PKCE 与回调匹配要求；2026-10-19 核对。本项目计划对所有客户端统一要求 S256，作为自身更严格的接入策略。
- [Google OpenID Connect](https://developers.google.com/identity/openid-connect/openid-connect)：`sub` 在所有 Google 账号中唯一且不变，邮箱可能变化、不能作主标识；`scope` 须以 `openid` 开头；`nonce` 防重放；只有直接来自 Google 的 ID Token 才可不验签；2026-10-19 核对。
- Google Cloud 帮助 [Brand verification requirements](https://support.google.com/cloud/answer/13464321) 与 [When is verification not needed](https://support.google.com/cloud/answer/13464323)：首页须在自有且已验证的域名上、不能只是登录页，首页与同意屏幕链接同一份隐私政策，开发与生产分开项目；[OAuth App Verification Help Center](https://support.google.com/cloud/answer/13463073)：只用非敏感 scope 不必做应用验证，要在同意屏幕显示应用名称和 Logo 才做品牌验证；[Unverified apps](https://support.google.com/cloud/answer/7454865)：未验证提示页和 100 名新用户上限针对敏感或受限 scope；[Manage App Audience](https://support.google.com/cloud/answer/15549945)：Testing 状态限 100 名测试用户、显示提示、授权 7 天过期，只请求 `openid email profile`（含 Sign in with Google）时这三条都不适用；2026-10-19 核对。
- GitHub REST [Get organization membership for a user](https://docs.github.com/rest/orgs/members#get-organization-membership-for-a-user)：支持 GitHub App installation token，需组织「Members」读权限；[organization 事件](https://docs.github.com/webhooks/webhook-events-and-payloads#organization)的订阅同样只需 Members 读权限，含 `member_added`、`member_removed`、`member_invited`；2026-10-19 核对。
- 本仓库发信现状：`mail_outbox` 每 15 秒发一遍，阿里云邮件推送在前、Resend 兜底，失败按 1 分钟到 6 小时退避（[server README](../services/server/README.md)「发信」）。
- [SECURITY](../architecture/SECURITY.md)「登录门槛」、[ADR-0004](0004-forum-backend-in-core-server.md)、[ARCHITECTURE](../architecture/ARCHITECTURE.md)「目标结构，尚未完整实现」。

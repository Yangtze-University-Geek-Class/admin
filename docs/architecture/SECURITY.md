# 安全模型与防护边界

> 区分核心后端授权、论坛服务端模式与本机演示；代码防护、真实环境配置和人工验收分别取证。

状态：`current` · 更新：2026-10-30

## 核心服务

保留 portal/admin 的服务端 requireAuth 及按组织审计；权限只认极客班账号的站内角色与称号（#262 第四期，见下文「权限只认极客班账号」），登录与业务授权均不再查询 GitHub 组织角色；有效成员摘要与普通登录身份分开判定。GitHub token 用 AES-256-GCM 加密，密钥解码必须为 32 字节；sid 是服务器会话，不在浏览器状态中产生管理权限。OAuth state 签名并检查十分钟有效期，回跳来源使用允许列表。Cookie 的 HttpOnly/Secure/SameSite 和共享 Domain 均需按真实部署验证，不称为完整 CSRF 或子域隔离。

**会话行的保留时间**：`sid` 有效期 7 天（`app/server/src/lib/auth.ts` 的 `SESSION_TTL_MS`）；`expires_at <= now` 即失效，请求鉴权与主动清理使用同一边界，不保留到期毫秒的额外访问窗口。过期会话由服务主动删除，不依赖本人再来访问：进程启动时清一次，之后每小时按 `expires_at` 批量 `DELETE`（`SESSION_CLEANUP_INTERVAL_MS`，计时器 unref，`app.close()` 时停掉）；一趟清理出错只记日志（带 SQLite 错误码），不抛出、不影响请求（#128）。所以服务运行期间，`sessions` 里的一行最多在过期后再留一个清理间隔（1 小时）；停机期间到期的行在下次启动时删掉。清理和登出都只删本站的会话行，**不**撤销 GitHub 端已经给出的授权（用户不登录也不会自动失去授权过的那几项；在 GitHub 上撤销要另做。配了 GitHub App 时 GitHub 登录只申请 `read:user user:email read:org`，没配时还要 `admin:org`、`repo`）。

**删掉的会话在库文件里也不留字节**：SQLite 默认只把删掉的行标成空闲，字节还在页里，在线备份会原样带走。`app/server/src/lib/db.ts` 给每个连接打开 `secure_delete`，删行、改短字段时把腾出来的空间写成 0；每趟清理删完之后做一次 `wal_checkpoint(TRUNCATE)`（`truncateWal`），把 WAL 写回库文件再截断：`data.db` 里的旧页被检查点覆盖，`-wal` 截成 0 字节。登出、读到过期、GitHub 拒绝令牌（#164）删掉的会话也在下一趟清理后不留字节。有别的连接正在读时这一趟截不成，不等待（不让事件循环卡在默认 5 秒的锁等待上），日志记 `wal truncate deferred`，下一趟再截。SQLite 在线 backup API 做的备份读的是最新的页，不带删掉的会话。`tests/server/session-cleanup.test.ts` 按字节核对 `data.db`、`-wal` 和在线备份里找不到被删会话的密文。

**还剩的**：打开 `secure_delete` 之前删掉的行（本改动上线前预发布、正式库里删过的会话），字节留在空闲空间里，要等被新数据覆盖；本机实测正常运行几趟之后 30 条里还剩 3 条，做一次 `VACUUM` 后为 0。在预发布、正式库上做 `VACUUM` 是对业务数据库的维护操作，要先获得授权，另开 issue。上面这些保证只到文件为止：`data.db`、`-wal` 和在线备份这几个文件里找不到被删会话的字节；`-wal` 截断时交还给文件系统的块并没有写成 0，文件系统释放的块、卷或磁盘的块级快照和裸盘镜像不在范围内，卷本身泄漏时这些块里可能还有旧密文。

**密码换掉之后旧会话、命令行令牌和对外授权一起作废**（2026-10-29 安全复核；#332 起包括令牌与授权）：`POST /auth/email/reset` 与 `POST /api/identity/password` 成功后，在写新密码的同一个 `BEGIN IMMEDIATE` 事务里调用 `lib/account-revoke.ts` 的 `revokeAccountCredentials`，只针对这一个账号：删掉除「本次新签发/当前会话」以外的全部 `sessions` 行；把它已兑换的 `gk_` 命令行令牌的 `token_expires_at` 改成现在（和 `geek logout` 同一判定，`device_grants`），已批准但还没兑换的设备授权的 `expires_at` 也改成现在；删掉它在各应用上的对外授权（`oauth_grants` 与 `oidc_payloads` 里的 Grant，连同它们的授权码和访问令牌），下次登录同一应用要重新同意。任何一步抛错，新密码、新会话与验证码占用一起回滚，密码不变、令牌仍有效。写 `auth.credentials_revoked`，meta 为 `{ sessions, cli_tokens, cli_grants, oidc_grants }` 四个数量。在此之前重置密码只删发起请求的那条 sid，账号被盗后受害者改密码也踢不掉攻击者手里的旧会话。用户名与昵称的占用判定同时扩到论坛命名空间（`forum.identityNameTaken`：官方账号名、其他成员用户名、`orgLogins` 历史登录名），避免把 `/api/identity/profile` 改成官方账号名后在匿名 `/api/forum/state` 里出现两个同名账号。

**匿名入口的抗滥用与枚举**（2026-10-29 安全复核）：`POST /api/feedback` 与 `POST /api/portal/apply`（需要 `apply.submit`，不是匿名入口）共用的 PoW 证明加了去重——摘要进 `limit_events` 的 `pow.nonce` 桶，去重窗口 10 分钟（滑动），等于证明的整个有效时段（时间戳允许前后各 5 分钟偏差），同一份 `{timestamp,nonce}` 在有效期内第二次提交一律 400，未来时间戳的证明也一样（`tests/server/anonymous-surface-hardening.test.ts`）。OIDC 的协议端点（`/oidc/token`、`/oidc/token/revocation`、`/oidc/me` 等）对带 `Origin` 的请求统一回 401 `invalid_client`：`oidc-provider` 的 per-client Origin 校验排在客户端认证之前，原来已知 `client_id` 回 400、未知回 401，等于一个 `client_id` 枚举 oracle；目前的下游（GitLab）在服务器端调用这些端点、不带 `Origin`；发现文档与 JWKS 不认客户端，不在这条规则之内，带 `Origin` 照样返回。

**登录门槛：开放注册，邀请码选填**（#274，SPEC §3.2）。GitHub、Google、邮箱三种方式第一次登录都可以建号：不填邀请码建成注册用户（`level.registered`），填了有效邀请码建成极客班成员（`level.member`），填了但无效回 `invite_invalid`，不悄悄降级。登录不再查 GitHub 组织，身份和权限只看站内的权限表（见下文「权限只认极客班账号」）。官网、论坛、控制台共用这一个登录和同一个 `sid`。建号受注册限额约束：同一个 IP（哈希）每个北京日 5 个、同一个设备（`yugc_vid`）每个北京日 3 个，超了 GitHub、Google 回跳带 `signin=registration_limited`，邮箱回 429 `bucket: "auth.register.daily"`（`lib/register-limits.ts`）；填错邀请码与 `POST /api/identity/invite/redeem` 共用同一套按 IP 的猜码锁定。以下是 GitHub 这条路：`/auth/callback` 通过签名 state 校验、换到 token、取到 `/user` 之后（`routes/admin/auth.ts`）：

- 按 GitHub **数字 id** 找身份，沿 `merged_into` 走到终点账号；没有就建号。建号、兑换邀请码、插入会话、删掉请求带来的旧 `sid` 在一个 `BEGIN IMMEDIATE` 事务里（`lib/identity-store.ts` 的 `signInWithGithub`），任何一步失败整体回滚、按 `failed` 回登录页，旧会话照常有效。成功后写 `sid`，操作记录记 `auth.signin`（新号记 `auth.register`），回到 `return_to`。只有登录名、没有 GitHub id 的旧称号**不认领**：旧登录名可能已被别人注册。
- 终点账号已停用：不建会话，撤销本应用的授权，操作记录记 `auth.signin_denied`（`outcome=denied`，`meta.reason` 为 `account_disabled`；被注册限额挡下的是 `outcome=limited`、`registration_limited`），回 `signin=<原因>`；合并链超过 8 跳或成环按 `failed`。读会话时没有账号或账号不是 `active` 的，一律按未登录处理并删掉这一行。
- 换 token 或取 `/user` 出错：一律按 `signin=failed` 回统一登录页；服务端只记一条带 `code`、`status`、request id 的错误日志，不含 token 和上游响应。
- 用户在 GitHub 授权页取消（`error=access_denied`）按 `signin=cancelled` 回登录页，GitHub 回传其它 `error` 按 `signin=failed` 回登录页。

以上回跳都先要求 state 有效，目标是校验过的 `return_to`（只接受 `PUBLIC_ORIGIN`，否则回 `<PUBLIC_ORIGIN>/console`）。**失败一律去统一登录页**：302 到 `${PUBLIC_ORIGIN}/signin?signin=<原因>&return_to=<原来要回的本站路径>`（`routes/admin/auth.ts` 的 `signinFailureUrl`），原路径里残留的 `signin` 参数先去掉；登录页与官网、论坛、控制台的「登录」入口都从这里出发，原因在登录页说清后可以直接换一种方式重试（#262）。登录页对 `return_to` 再做一次同源校验：只接受以单个 `/` 开头的同源路径（拒绝 `//`、`/\`、控制字符、绝对 URL 和带着用户名密码的地址），不合格一律回 `/console`，并且不回到 `/signin` 自己（`app/console/src/lib/signin.ts` 的 `safeReturnPath`）；服务端另按 `PUBLIC_ORIGIN` 校验一次（`lib/safe-return.ts`）。缺 `state`、既无 `code` 也无 `error`、state 签名或 cookie 不符，仍就地返回 400 JSON，不跳转；以 `forum-` 开头的旧论坛 state 返回 410。换 token、取 `/user`、撤销授权的请求 15 秒超时；Octokit 当前版本不读 `request.timeout`，所以默认的 Octokit 给它用的 `fetch` 套了 15 秒的 `AbortSignal.timeout`（`lib/github-http.ts` 的 `withTimeout`）。GitHub 连不上时登录尽快以 `failed` 回到登录页。注册用户能拿到会话，能做什么由权限节点决定：控制台要 `console.access`，没有时只显示「还不能使用控制台」。

公开邀请/反馈/加入我们投递有限流、蜜罐、PoW 和可选 Turnstile。意见箱只收 `CONSOLE_ORG` 的意见：`POST /api/feedback` 的组织名不分大小写认它、按配置写法落库，别的组织名回 400、不落库（#129）。论坛的游客回复（`POST /api/forum/posts` 不带 `sid`）是另一个匿名写入口，同样要蜜罐、PoW（摘要输入 `${topicId}:${content}`）与可选 Turnstile，正文 ≤2000 字、昵称 1–20 字，昵称先做 NFKC、去掉首尾空白，再按允许清单收字符（`isAllowedName`），存的就是校验过的这个写法（不换行空格、全角空格这类字符存成普通空格，不会原样存下来显示得像没有空格）：汉字、常用拉丁字母（含拼音声调、越南文）、平假名、片假名、韩文（只收合成好的音节，单独的字母不收）、ASCII 数字，以及空格和 `- _ . · ・ '`，空格不能在首尾或连着用；看不见的字符、表情、其它文字（西里尔、希腊、亚美尼亚等的形近字母）和 IPA、小型大写这类形近拉丁字母都进不来。原来的屏蔽清单拦一种漏一种（第三轮审查又找到未分配的可忽略字符 U+2065、U+FFF0、U+E0080 和亚美尼亚、傈僳、切罗基的形近字母），所以换成允许清单。按 NFKC、不分大小写、去掉附加符号、把形近字折成同一个（ı 和 i、片假名カ和汉字力这类）、去掉所有空白和 `- _ . · ・ '` 之后（「极 客班」「极客班.」都算「极客班」），昵称不能与成员或官方账号的昵称、用户名相同，也不能是本地知道的组织成员的登录名：控制台里有称号的人（`role_assignments`）和登录过的人（审计里的 `auth.signin` 与当前会话，包括登录过的组织 owner），没打开过论坛的也算；成员改昵称同样只收这些字符，也不能等于官方账号的名字、别人的用户名或这些人里别人的登录名。昵称被占的回答（`guest_name_taken`）会透露某个名字是不是登录过或有称号的组织成员，所以这项检查放在限流和 PoW 之后；PoW 通过后每次尝试都记一次这个 IP 的回复额度，不管后面是昵称被占、人机验证没过还是发出去了，匿名探测和回复共用下面的额度、要先解 PoW，开了 Turnstile 时也分不出被占和没被占在额度上的差别。游客回复每个 IP 5 次/分钟、30 次/天，IPv6 按 /64 前缀计，全站游客回复合计每小时 200 次，超了所有游客暂停回复（`guest_replies_paused`），成员不受影响（都记在 `forum_rate_events`，重启不清零）；`GET /api/forum/state` 每个 IP 120 次/分钟、浏览接口 60 次/分钟（进程内计数）；游客不能发帖、编辑、删除或做其它写操作，每条游客回复是一个单独的游客用户，不能冒用成员身份。游客的来源 IP 只存在限流记录（最多一天）和浏览去重（最多一小时）里，不随帖子下发。反馈摘要与管理员回复经 `GET /api/feedback/public` 匿名可读：只返回 `CONSOLE_ORG`（组织名不分大小写）下非 `spam` 反馈的前 280 字、状态、回复和票数，别的组织名一律返回空列表，库里别的组织的历史行不再公开（#129）；`org` 与 `limit` 经本端点的 querystring 合同校验（`org` 不超过 39 字、重复给出回 400，`limit` 为正整数），最多返回 100 条（见 [API](API.md) 端点清单）；反馈正文因此按公开内容对待，用户指南已提示勿提交敏感信息。「加入我们」投递没有匿名读取接口；控制台的读取、详情和导出分别按对应能力授权，见 [API](API.md)。邀请先预留额度、再请求上游，明确失败补偿、未知结果保留待核对，不把超时解释为未发送。写请求核对 Origin 与 Fetch Metadata，返回错误不打印 token 或完整上游响应。鉴权 API 禁止缓存。公开文档使用允许列表，不公开内部运维、安全、规范和审查内容。论坛昵称的冒名检查还剩一个缺口：从没登录过、也没有称号的组织成员（包括从没登录过的组织 owner），本地没有这些人的登录名，游客和成员仍能用这些名字。

**客户端 IP 从哪来**：上面所有按 IP 的限流（邀请、反馈、投递、论坛），以及审计和投递里记的来源 IP，都取 Fastify 的 `req.ip`。部署链路是客户端 → 宿主 nginx → web 容器 nginx → server，两层 nginx 各往 `X-Forwarded-For` 末尾追加一段，所以两个环境都是 `TRUST_PROXY=2`：只信任这两层，客户端自己带的最左边几段不算。2026-09-26 之前两个环境写的是 `true`，信任整条链，`req.ip` 取的是客户端能随便填的最左边一段，换着填就能绕过所有按 IP 的限流，写进审计和投递的 IP 也能伪造（#116 审查发现，轮换 `X-Forwarded-For` 8 次 8 次成功）。改了反代拓扑要同时改两份 env 模板和 `scripts/deployment-environment.mjs` 的 `PROXY_HOPS`，`pnpm check:environments` 与 `tests/tooling/deployment-environment.test.ts` 核对层数与两份 nginx 配置一致。本机开发不设 `TRUST_PROXY`，只信任回环上的代理。

## 设备授权（RFC 8628，给 `geek login` 预留）

命令行的登录不走浏览器会话，按 RFC 8628 的 device authorization grant 换取受 scope 与既有权限节点双重约束的令牌（#262，源码 `app/server/src/lib/device-store.ts`、`app/server/src/routes/identity/device.ts`，接口见 [API](API.md)）：

- **授权对象是极客班账号**：确认页要极客班 SSO 会话，允许操作还要 `account.cli.login`，写进 `device_grants.account_id` 的是会话的 `account_id`（`users.id`），不是 GitHub id；账号不是 `active` 时确认后的轮询回 `access_denied`，已有令牌在 `/auth/device/userinfo` 立即失效，不用等过期。
- **凭据不入库、只发一次**：`device_code`（32 字节随机数）与 `access_token`（`gk_` 前缀加 32 字节随机数）只把 sha256 存进 `device_grants`，明文只出现在发码与换令牌的响应里；换过令牌的行改成 `consumed` 且记下令牌哈希，同一个 `device_code` 再轮询只会得到 `invalid_grant`。令牌 30 天到期，到期或账号停用后 `device_grants` 里的哈希不再能换成身份；改密码或重设密码时，这个账号已兑换的令牌一并到期（#332）。
- **时限与节奏**：`user_code` 8 位、字符集去掉元音与易混字符（`BCDFGHJKLMNPQRSTVWXZ`），10 分钟有效；默认轮询间隔 5 秒，提前轮询回 `slow_down` 并把这一行的间隔加 5 秒写回，凭据泄漏时留给暴力尝试的窗口更小。
- **限流按接口分开**：发码 10 次/分钟、轮询 60 次/分钟、确认页读取 30 次/分钟（`user_code` 空间有限，查询也要挡枚举）、确认 20 次/分钟，都按 IP 计，超额 429。`user_code` 输入的字符集与长度先做校验，不合法按不存在处理。
- **确认页防钓鱼**：`/device` 显示客户端名（目前只有「极客班命令行」）、请求的 `scope`（逐项说成人话）、终端里那串代码与剩余时间，并在允许/拒绝上方明说「只有你刚在自己的电脑上运行了 `geek login`、终端里就是这串代码时才允许，别人发给你的代码不要确认」。代码不是 `pending` 或已经过期时不给按钮，只说明原因（过期、已被拒绝、已用过）。
- **跨站写入**：`POST /api/identity/device/approve` 是普通写请求，先经 `middleware/http-policy.ts` 的 Origin / Fetch Metadata 校验（外域 403 `invalid_origin`），会话 Cookie 是 `SameSite=Lax`，第三方站点不能带着会话替你确认。
- **接口面最小**：`/auth/device/userinfo` 的 `sub/account_id/login/scope` 保持兼容，新增 `username/display_name/bio`，`avatar_url` 改读统一公开 DTO（上传头像可为 `/api/identity/avatar/<hash>.webp` 相对路径，否则回退绑定头像）；另有年级与邮箱/资料闸标记，不回 prefs、邮箱、`real_name`。设备令牌还可调用既有四类 scope 业务与 `GET /api/console/me`，默认拒绝其它控制台/账号/OIDC 接口，scope 不替代权限节点且永远不能通过 step-up，完整白名单见 [API](API.md)「geek 命令行令牌」。`verification_uri` 由 `PUBLIC_ORIGIN` 拼出，各环境指向自己。
- **审计不留凭据**：允许与拒绝各写一条 `identity.device.approve` / `identity.device.deny`（`actor` 是操作者登录名、另记 `actor_account_id`），`details` 只有 `client_id` 与 `scope`，不记 `device_code`、令牌与 `user_code`；审计 `org` 列为空，不经任何接口返回。

## 邮箱、Google 登录与邀请码注册（#262）

2026-10-23 的决定：目前开放注册，现在通过 GitHub 注册的都算组织成员，后续改为需要邀请码才能注册；验证码和密码两种登录都支持；权限按站内称号认定。源码在 `lib/email-login.ts`、`lib/google.ts`、`lib/invite-codes.ts`、`lib/identity-store.ts`、`routes/identity/email.ts`、`google.ts`、`account.ts` 与 `routes/console/invites.ts`，接口见 [API](API.md)。

- **邀请码选填**（#274）：邮箱或 Google 第一次登录、还没有极客班账号时直接建号，不填邀请码是注册用户，填了可用的邀请码（没停用、没过期、次数没用完）是极客班成员，填了但无效回 `invite_invalid`。建号、兑换邀请码、占用验证码、建会话在一个 `BEGIN IMMEDIATE` 事务里，任何一步不成整体回滚，邀请码不白用、验证码不白丢。邀请码无效对外只说「无效」，不区分不存在、停用、过期或用完；填错的次数按 IP 计入猜码锁定。
- **验证码**：6 位数字，10 分钟有效，同一个码最多错 5 次；库里只存 HMAC（密钥派生自 `SESSION_SECRET`），不存原文，日志不记地址和验证码。挑战 id 放在签名、HttpOnly 的 cookie 里，登录用 `Path=/auth/email`，绑定用 `Path=/api/identity/email`；绑定的挑战还记着发起的账号和会话指纹，换了会话就不算数。发码限额按收件箱（60 秒一封、每小时 5 封）和来源 IP（IPv6 按 /64，每小时 20 封）计，数在 `email_challenges` 表里，重启不清零；超额 429 带 `Retry-After`。`/auth/email/start` 对有没有账号的邮箱响应一样，不泄露邮箱是否注册。
- **密码**：在账号页设，忘了时在登录页重设，至少 8 位、UTF-8 不超过 72 字节（bcrypt 上限），不要求大小写、数字或符号（2026-10-23 的决定，原来是至少 15 位），bcrypt cost 12。短密码更容易被猜中，在线猜测靠下面按 IP 与按邮箱的限次挡。密码登录对没账号、没设密码、密码不对回同一个错误，没有账号时也跑一次 bcrypt，响应时间不随邮箱是否注册变化；按 IP 每分钟 10 次之外，按邮箱另计 15 分钟 10 次（进程内计数）。设密码、绑定邮箱要求这次登录不超过 10 分钟（`step_up_required`）；已有密码时也可以填当前密码代替。忘了密码在登录页点「忘记密码？」，用邮箱验证码直接设新密码并登录（`POST /auth/email/reset`，#273）：和验证码登录是同一种挑战、同样的限次，先查新密码合规再碰验证码，邮箱没有账号时和验证码登录一样回 `invite_required`、不注册，登录页转到「注册」；能收到这个邮箱验证码的人本来就能用验证码登录，重设不多给权限。重设写 `identity_audit` 的 `password_reset` 与审计 `account.password`，旧密码立刻失效。
- **登录邮箱必绑**（#273，2026-10-23 19:22 的要求概括为：之前只绑定了 GitHub 账号、没有绑定邮箱的人，再次进来或登录时必须绑定邮箱）：这个环境能发信时，没有邮箱登录方式的账号（只绑了 GitHub 或 Google）要先绑邮箱，判定在 `lib/email-gate.ts`。GitHub、Google 登录回调照常签发 `sid`，再改跳 `/bind-email?return_to=<原路径>`；对外授权的交互入口跳过去（允许过这个应用、签发者会话还在的也先进交互，不直接发授权码），同意页的详情与允许、设备授权的允许回 403 `email_required`，拒绝不拦；官网、论坛、控制台按 `/auth/me` 的 `email_required` 自己跳。绑定还是账号页那组接口，要求这次登录不超过 10 分钟。发不出信的环境不要求，收不到验证码就绑不上，不能把人关在门外。
- **实名资料必填**（#280，2026-10-24 13:45 的要求概括为：之后实行实名制，不论是之前登录的还是之后新注册的极客班成员，所有注册成员都要填写所在年级）：每个账号都要有真实姓名和年级，缺了先补，不看能不能发信。关口和绑邮箱同一处（`lib/email-gate.ts`），先邮箱后资料：登录回调与对外授权的交互入口跳 `/complete-profile?return_to=<原路径>`，同意页的详情与允许、设备授权的允许回 403 `profile_required`，拒绝不拦；官网、论坛、控制台按 `/auth/me` 的 `profile_required` 自己跳。邮箱注册时就要填（`/auth/email/verify` 只在要建号时要求，缺了 400 `real_info_required`，验证码和邀请码都不作废）。本人通过 `POST /api/identity/real-info` 只能填一次，之后由有 `users.manage` 的管理员在控制台改（要刚登录过）。年级不存，存入学年份，按北京时间的学年现算，下拉框只有大一到大四，不接受自己填写。
- **日志**：请求日志不记 `/auth/*` 的查询串（`app.ts` 的 `requestLogFields`），OAuth 的 code、state 与 `/auth/google?invite=` 带的邀请码不进日志。
- **Google**：两个接口按 IP 限流（发起每分钟 20 次，回调每分钟 10 次），挡住反复走授权试邀请码。OIDC 授权码加 PKCE S256、state 与 nonce，只申请 `openid email profile`；ID Token 用 Google 的 JWKS 验签（RS256），核对 `iss`、`aud`、`exp`、`nonce`。按 Google 的 `sub` 认人，**不按邮箱自动合并账号**：Google 邮箱已经属于别的极客班账号时拒绝（`email_taken`），要用邮箱验证码登录那个账号。没配 `GOOGLE_CLIENT_ID` 与 `GOOGLE_CLIENT_SECRET` 时两个接口都是 404，登录页也不出现 Google。
- **没有 GitHub 令牌的会话**：邮箱、Google 会话没有本人的 GitHub 令牌，也不需要：权限照常按账号给（见下文「权限只认极客班账号」），#274 起服务器不再代理 GitHub 组织。
- **运维建号**：`dist/cli/account.js provision` 只在服务器容器里由维护者执行，按 GitHub 数字 id 找到或建立账号、按 `--org-role` 设定身份（`admin` 进站长组，`member` 进成员）、绑定邮箱，不开 HTTP 接口；密码不由它设，本人用验证码登录后在账号页设。

**残余风险**：没有登录邮箱的会话在服务端只在登录回调、对外授权和设备授权这几处被拦，其余接口照常可用；绑定邮箱靠页面引导，不是权限门。能发信但投递一直失败时，没有登录邮箱的人收不到验证码，会停在绑定邮箱页，只能退出登录。重设密码和账号页改密码都会结束这个账号在本站的其它会话，并吊销命令行令牌与对外授权（见上面「密码换掉之后」一条，#332）。改密码要求刚登录过或知道当前密码，重设密码要求能收到登录邮箱的验证码；掌握这两样的人能把账号改回自己的，这种情况要在控制台停用账号。邀请码一旦外泄，在停用前任何人都能凭它注册（次数和过期时间可以限住）。站内角色不随 GitHub 组织变化的风险见下节。

## 权限只认极客班账号（#262 第四期，#274 改成权限节点）

2026-10-23 的决定：与 GitHub 相关的权限要放权；之后可能不只连接 GitHub，因为还要做自己的仓库。源码在 `lib/permissions.ts`（求值引擎）、`lib/access.ts`（身份摘要）与 `lib/identity-store.ts`（建号时定身份）。

- **身份只看权限表**：每个账号在 `perm_members` 里属于一个身份组（注册用户、极客班成员、往届成员；没登录的访客按访客组求值）、至多一个部门、若干称号，能做什么由这些组的条目按「拒绝优先」求出（详见下文「极客班控制台：权限节点模型」）。不论用 GitHub、邮箱还是 Google 登录都一样，不调用 GitHub、不看本人在 GitHub 组织里的角色；请求路径上没有任何地方再按 GitHub 角色同步身份，控制台里改过的身份不会被改回去。
- **有效成员摘要**（GitHub #271）：`membershipOf/isMember/getAccountClaims/listAccountsForSync` 共用 active + 当前有效直接 member/alumni 资格（`expires_at` 为 NULL 或严格大于 now），不看回滚专用角色列；owner-only 不获得 OIDC 资格，普通 alumni 不获得额外写节点。有效直接 owner 只在成员资格成立时把对外 `site_role` 提升为 admin。论坛 `kind=member` 另指已登录身份，registered 仍能按其真实节点读取，不能混淆成游客或自动授予写权限。
- **谁能改**：改身份、部门、称号要 `users.manage` 加 step-up；站长称号只有站长能授予或撤销，最后一位站长不能被降级、删除，站长组的 `*` 条目不能删（409 `last_owner`）。
- **停用**：停用要 `users.disable`；停用的账号读会话时按未登录处理，登录回调不建会话。

**残余风险**：旧的 `users.org_state`、`users.org_role` 列还在，建号时照写（注册用户写 `not_member`），只给回滚到 #274 之前的镜像用；新代码不读它们判定权限。

## 对外授权与 GitLab 账号同步（#270）

GitHub 账号被封后改用自建 GitLab，2026-10-23 的决定：GitLab 那边的登录走极客班的 SSO 统一登录，因为数据都要一起统计；所有有极客班登录身份的人都有对应的 GitLab 账号。源码在 `lib/oidc-provider.ts`、`lib/oidc-store.ts`、`lib/account-directory.ts`、`lib/gitlab-sync.ts`、`routes/oidc/` 与 `routes/console/gitlab.ts`，协议细节见 [对外授权与 GitLab 账号同步](../services/server/oidc.md)。

- **签发者**：内嵌的 `oidc-provider` 9.12.2，签发者 `<PUBLIC_ORIGIN>/oidc`。只做授权码流程，所有客户端都要 PKCE `S256`；动态注册、implicit、hybrid、单点登出、refresh token 都不开。回调地址按登记的完全一致匹配，只收 `https`（本机 `127.0.0.1`、`localhost` 除外），同一客户端的回调必须同一个主机。授权码 10 分钟、一次性，重放时撤销这份授权和它发出的令牌。改密码或重设密码时，这个账号在各应用上的授权一并撤销（#332）。
- **登录状态以 `sid` 为准**：签发者自己的会话只是缓存；`sid` 没了、换了账号、或账号已经不是成员时都回到交互入口，不成员的带 `access_denied` 回下游。已经发出的访问令牌在 userinfo 处按账号当前状态判断，停用或不再是成员立刻 401。
- **同意**：第一次登录某个应用要本人在 `/authorize` 允许，页面写明应用名、回到哪个主机和要的信息；同意与拒绝接口要 `sid`，只认发起这次登录的账号（别人 409），经核心写请求的 Origin 门禁（外域 403），写审计 `oidc.consent` / `oidc.deny`。
- **主体标识**：`sub` 按下游 sector（回调主机）生成 32 字节随机值存 `oauth_subjects`，不同下游拿到的不同，内部 `account_id` 不下发；换签名密钥不变。声明只有 `openid`、`profile`、`email`，邮箱只给验证过的。
- **密钥**：签名私钥 `OIDC_JWKS` 与 GitLab 管理员令牌 `GITLAB_API_TOKEN` 是环境级密钥，只在目标机 `.env.<环境>` 与 CI 的环境 secrets；JWKS 端点只发公钥。客户端只能在服务器容器里用 `dist/cli/oidc.js` 登记，`client_secret` 只输出一次，库里存 AES-256-GCM 密文。签发者的 cookie 用 `SESSION_SECRET` 派生的密钥签名。
- **限流**：协议端点按 IP 每分钟计数，下游服务器调用（发现文档、JWKS、换令牌、撤销、userinfo）合计 600 次，浏览器跳转（授权端点）另计 120 次，GitLab 一个 IP 上的调用不挤占校园网共用出口的浏览器；交互入口与详情 30 次，同意与拒绝 20 次，控制台的立即同步 30 次。交互入口与同意页接口的回复不缓存（`no-store`）。
- **GitLab 同步**：`GITLAB_SYNC=on` 时按极客班账号在 GitLab 上建号（随机密码、`skip_confirmation`）、放进组（有效 member/alumni Developer，有当前有效直接 `title.site.owner` 的 active 成员 Owner，按权限表判定，不看旧的 `org_role`）、停用与不再是成员的封禁；按 OIDC 身份（`extern_uid` = 这个账号在 `gitlab` 客户端 sector 的 `sub`，sector 取客户端的回调主机，不取 `GITLAB_URL`）认人，不按邮箱或用户名合并；还没同步过就离开、但用极客班登录过 GitLab 的，按身份找到 GitLab 自动建的号并封禁。不删除用户和仓库，不碰不是同步建的用户（如 root）。管理员令牌只在服务端用，调 GitLab 不跟随跳转，失败只记错误码（如 `gitlab_create_409`、`gitlab_unreachable`），不记 GitLab 的响应体。

**残余风险**：GitLab 侧已登录的会话不随极客班退出或停用立即结束，靠同步封禁收口：`GITLAB_SYNC=on` 时最长差一个同步周期（10 分钟）；不是 `on` 时没有人封禁，所以 GitLab 的统一登录要在同步开成 `on` 之后再打开。`GITLAB_API_TOKEN` 是 GitLab 管理员级 `api` 令牌，外泄等于交出整台 GitLab，只放目标机与 CI secrets，按 GitLab 的令牌有效期轮换。`oidc-provider` 依赖的 `jose` 6.2.13 发布时间很近，升级要跟着看安全公告。GitLab 的 SSH 不对外开放，成员用个人访问令牌走 HTTPS 推拉，这个令牌由本人在 GitLab 上管理，不受极客班停用的即时影响（账号被封禁后令牌随之不能用）。

**GitLab 防误封与贡献采集**（GitHub #271）：每次对账以本地有效资格为权威，但写远端之前必须用既有 sub 精确核验受管身份；管理员、服务账号、保留账号、无有效映射对象不变更。HTTP 失败、超时、429/5xx、畸形或未读完的分页不视为撤权证据；有效映射且明确停用的账号仍封禁，远端状态漂移下一轮收敛。等待时资格变化在账号锁内重读并重算，已发请求靠补偿与下轮恢复，不承诺分布式原子性。贡献作者/审核人也实时核验绑定；审核人在所有 HTTP 等待完成后仍须 active 且有审核节点。自动撤分只接受完整标签事件中明确的最新 remove，错误/缺数据只报错保分；不把已确认的正常撤销永久跳过。同步锁不跨环境，双环境同时 on 的权威冲突必须由外部配置解决，不按邮箱合并、不重生成 sub 或签名 key。

## 极客班控制台：权限节点模型（#274）

控制台 `/api/console/*` 按**权限节点**授权，取代了旧的「站内角色 + 称号 → 能力」模型：称号、部门不再是固定层级（提督/舰长/队长/舰员/领航员/乘客）加能力蕴含闭包，而是组（`perm_groups`）、继承（`perm_group_parents`）与条目（`perm_entries`）三张表拼出来的、所有者在控制台自己维护的图。代码里固定的只有节点目录（`lib/permission-nodes.ts`，全部 `PERMISSION_NODES`，是不是「必须有执行点」由代码保证）；组、继承、默认条目是种子数据，由所有者在控制台改，不改代码。引擎是纯函数 `explain`/`evaluate`（`lib/permissions.ts`），判定在 `middleware/require-permission.ts`（全局）与 `lib/console-scope.ts` 的 `requireScopedPermission`（部门范围）；旧的 `require-capability.ts`、`require-github.ts`、`roles.ts`/`role-store.ts`、`titles` 表、`role_assignments`、`/api/console/people`、`/api/admin/:org/*` 均已删除或退役，不再是现行契约。端点与错误码见 [API](API.md)。

- **数据形状**：`perm_groups`（`kind` 是 `level` / `department` / `title` / `custom`；`system=1` 的系统组不能删除）、`perm_group_parents`（组继承边，支持菱形继承）、`perm_entries`（`subject_type` 是 `account` 或 `group`；一条条目对一个节点给 `value`（允许/拒绝）、可选 `scope`（目前只实现 `department` 一个维度）、可选 `meta_value`（限额类节点的数值）、可选过期时间）、`perm_members`（账号属于哪些组，level/department 类每账号最多一个，写入前用 `lib/permissions.ts` 的 `setExclusiveGroupMembership()` 先删旧的再插入新的，可选过期时间）。
- **判定规则**（`explain`/`evaluate`，和 ibuki-next 的权限引擎逐行一致）：节点匹配——完全相同、`*` 通配全部、`xxx.*` 匹配 `xxx.` 前缀；scope 匹配——条目没给 scope 就对任何请求成立，给了某个维度（如 `department`）而请求没给这个维度就不成立；账号直接条目和它所在组（含递归继承）的条目一起参与判定，**命中里只要有一条 deny 就是 deny，否则有 allow 才是 allow，都没有命中是 unset（按拒绝处理）**——deny 不分条目挂在账号还是哪一层组，也不比「更具体」，只要命中就赢。
- **等级与部门是组，不是角色字段**：`level.visitor → level.registered → level.member`（注册时或注册后用邀请码升级）与旁支 `level.alumni`（已毕业，读权限同成员，写权限由所有者在控制台单独配）构成继承链，越往上权限越多；登录但没有邀请码的注册用户能读但不能发帖回帖（没有 `forum.topic.create` 等节点，只有 `level.member` 才有）。五个部门（AI、算法、硬件、网安、管理）各是一个 `department` 组，外加占位组 `dept.none`（没有部门）；每个部门下有 `title.<dept>.staff` / `.deputy` / `.head` 三级 `title` 组，父组是该部门。`title.management.head`（管理部部长）直接拿一份不限部门的能力清单，不是按部门 scope 给。
- **站长（`title.site.owner`）**：只认 active 账号当前有效的直接资格（NULL 或 `expires_at > now`），不因继承成为站长；`isSiteOwner/siteOwnerCount` 排除 disabled、merged 和到期资格。`console/users.ts` 与 `permission-groups.ts` 都要求操作者当前有效 owner 才能任免/停用 owner、恢复带有效 owner 资格的停用账号、或借 `titles` 全量保留把临时 owner 延为永久。删除/停用最后有效 owner、把其唯一资格覆盖为当前或过去到期，都回 409 `last_owner`。改 owner 组继承或条目同样要求有效 owner；替换该组自身根条目时，必须保留当前有效、无 scope 的 `node:"*", value:true`，且不能有同组有效无 scope 的 deny `*`（包括 `value:null` 的 meta wildcard）；有限 scope 或已到期的 allow 不是等价替代。正常的未来临时资格和根条目仍允许，不自动续期。
- **时间敏感缓存**：除 `perm_state.revision` 外还以 `[evaluatedAt, minExpiry)` 限制复用，最近未来成员资格或已解析 allow/deny/meta 条目到期（含继承和访客条目）时重读；到期等值与回拨到求值时间之前也失效。写入依然必须 bump revision，避免暖缓存让已经过期的权限继续可用。
- **部门范围的节点**：非管理部门的部长拿到的是**按本部门 scope 限定**的 `users.view`、`apply.view`、`apply.review`、`activity.read`、`dept.manage`（种子里没有任何账号直接持有这几个节点不限定 scope 的版本，除了站长的 `*`）。这类「列表要不要按部门过滤」的接口不能只用 `requirePermission` 当门禁（那只认不限定 scope 的全局 allow，部长一律 403）：改用 `requireScopedPermission(node)`，由 `lib/console-scope.ts` 的 `departmentScopedAccess()` 判定——有不限定 scope 的 allow 就是 `full`（不过滤）；没有但有按部门限定的 allow 就是 `scoped`（范围写进 `req.departmentScope`，路由自己在 SQL 里按部门过滤，如 `console/users.ts` 的用户列表与计数）；都没有是 `none`（403）。**部门级的 deny 会从部门级的 allow 集合里减掉**（有 deny 即 deny），即使一个部门同时有允许和单独针对这个部门的拒绝条目。`apply.view`/`apply.review` 虽然按这个口径放行，但 `applications` 表本身没有部门列（投递提交时不分部门），命中范围的部长看到的是全部投递，和站长一样——不是遗漏，是没有可过滤的维度。`dept.manage` 目前只在种子与节点目录里存在，还没有任何路由的执行点强制它，不算真正生效的权限，只是预留。
- **写操作要求刚登录过**：`console/permission-groups.ts`、`console/users.ts` 的写接口，以及 `console/applications.ts` 的招新总开关（#284，节点 `apply.settings`，种子里只有站长），在 `requirePermission`/`requireScopedPermission` 之后再挂 `requireStepUp`（`middleware/require-step-up.ts`），会话必须是最近 10 分钟内创建的，否则 403 `step_up_required`，和账号页绑定邮箱/设密码同一个窗口长度（各自独立定义常量，数值保持一致）。
- **`console.access`**：是否显示控制台入口由这一个节点决定（`/auth/me` 的 `console_link` 直接查 `permissions.check(accountId, "console.access")`），不看任何旧的能力白名单。
- **种子只应用一次**：`lib/migrations/2026-10-yugc-v2.ts` 的种子（默认组、继承边、默认条目）和旧 `role_assignments` 到新组的映射，由 `perm_seed_applied(key, applied_at)` 台账按稳定 key 记一次，应用过之后不管所有者怎么改（删掉条目、收紧某个限额、撤销某人的 `title.site.owner`、把某人从 `level.member` 降回 `level.registered`），服务器重启都不会把种子的原值种回来——这张迁移在 `createDatabase()` 里无条件重跑，旧实现按「现在的状态符不符合种子」判断要不要写，分不清「所有者故意改掉了」和「从来没种过」，是曾经的真实回归点。台账从空表第一次创建时按当前已有的组/边/条目/映射回填（已知局限：台账上线前就已经被所有者删掉的种子，回填时已经不存在，会在上线后的这一次启动被种回来最后一次，此后台账记住、不会再种第二次）。
- **旧 GitHub 用户补齐**（#306）：升级到账号体系之前，「谁是 GitHub 用户」只写在会话、`forum_users.github_user_id` 与 `role_assignments.github_user_id` 里；`backfillIdentity` 只给未过期会话建号。`lib/migrations/2026-10-legacy-github.ts` 在升级前就存在（早于 `console_seeds.identity_v1`）的论坛用户和名册行里，给还没有 GitHub 身份的人补账号和身份，认领论坛用户与名册，并按旧记录恢复成员资格（论坛旧管理员 → 成员与站长，论坛成员与名册里的成员、队长、舰长 → 成员，只有往届 → 往届成员）；已建账号里停在自动授予（来源 `migration:2026-10-yugc-v2` 或 `github-signin`）的注册用户的旧成员同样恢复，控制台或邀请码给过的不动。两步各用 `console_seeds` 标记只跑一次（`legacy_github_v1`、`legacy_github_v1_levels`），之后所有者怎么改都不会被改回；只补不删，不动任何旧表行。种子台账的回填也改了：账号还没有任何权限成员记录的名册行不再预先记成已映射，否则启动回填刚认领的名册行会被 `mapRoleAssignments` 跳过。
- **操作记录**：控制台写操作的轨迹走 `app.services.activity.recordActivity()`，落 `activity_events`（`console/activity.ts` 的 `GET /api/console/activity`、`.csv` 读取，`activity.read`/`activity.export`，IP 默认打码，部长按本部门范围过滤）；403 拒绝与 429 限流经 `middleware/http-policy.ts` 的 `recordDenialOrLimit` 统一记一条，`meta` 带方法、匹配到的路由模板（例如 `/api/console/security/blocks/:ip`，没匹配到路由为 `null`）与状态码（#333），不记原始路径、查询串和请求体；同一主体（账号，没账号按访客编号，都没有按 IP）、同一动作、同一方法/路由模板/状态码、同一分钟只留一行、`meta.count` 累加，不会被刷屏灌满。旧的 `audit_logs` 表只保留历史数据，启动时把尚未复制的行一次性搬进 `activity_events`（按水位线增量、不重复），其中 `invite_link.*` 的邀请链接 token 只留前 6 位再搬，不把完整 token 带进新表。
- **公开的组织架构**：`GET /api/public/departments` 匿名可读，只给部门与称号的显示信息（名字、图标、色调、说明、层级），不含权限、不含任何人。
- **论坛能力在服务端执行**（#57，#274）：登录但没有对应节点的账号在论坛能读不能写（没有 `forum.topic.create`/`forum.reply.create`/`forum.react` 等节点时，`routes/forum-api/viewer.ts` 的 `requireWriter()` 挡住，不再看旧的 `access.member`/组织角色）；置顶（`forum.moderate.pin`）、关闭（`forum.moderate.close`）、编辑或删除他人帖子（`forum.moderate.edit`/`.delete`）按话题所在分类 scope 判定，`lib/console-scope.ts` 的部门级 deny 规则同样适用。动他人帖子、置顶、关闭写审计（`storage.audit`，细节同旧机制但只记开关与编号，不记正文）。

**统一公开资料**（GitHub #271）：`public-profile.ts` 只映射用户名、昵称、简介和头像；canonical 昵称为空或没有上传头像时，回退值由 `identity-store.publicFallbacks()` 按账号批量只读当前登录名与绑定头像，不再读 `forum_users` 的历史缓存，不按邮箱合并，也不返回 provider uid、状态、邮箱或实名。论坛、设备 userinfo 与 OIDC 账号目录共用此公开来源，不把 prefs、邮箱或真实姓名混入 DTO。论坛对历史作者批量只读已有 `account_profiles`，缺行保留旧资料，不隐式建档；canonical 与旧论坛字段已有冲突时 canonical 优先，旧数据/图片不作批量覆盖。旧论坛昵称/简介/头像写口仅在有 canonical 档案时同事务兼容写入，清除头像同步清引用；所在地、网站和通知设置仍归论坛。发布前仍需只读核对既有冲突，不把代码投影说成数据迁移或全库资料已一致。

**个人信息**：投递（姓名、班级、邮箱、特长）对所有持有 `apply.view` 的人完整可见；列表与详情不下发来源 IP 和 User-Agent。只有查看详情和导出会被记录，CSV 离开系统后无法追踪。

**真实姓名**（#280）：存在 `account_profiles.real_name`，只回给本人（`/auth/me`、`/api/identity/me`）和有 `users.manage` 的管理员（控制台用户列表与抽屉，也只有这时能按姓名搜）；只有 `users.view` 或部长范围的人看得到年级、看不到姓名。论坛、天梯、比赛官网、对外授权的声明和 GitLab 同步都不读这一列，`tests/server/real-info.test.ts` 列出允许读写 `real_name` 的服务端文件，多一个就失败。操作记录不写姓名：本人填写记 `account.real_info`，`meta` 只有填了哪几项和年级；管理员修改记 `users.update`，前后快照只有 `has_real_name`、`enrollment_year` 和 `real_name_changed`。

**残余风险**：操作时最后有效站长受到保护，但未来临时资格或根条目可以自然到期，届时即时撤权，没有“至少一位永久站长”或自动恢复政策；若全部资格到期，或唯一站长丢失登录方式，控制台里没有第二个人能把权限还给他（代码层面的保护是「不让最后一位站长消失」，不是「保证总能恢复访问」），这种情况下需要运维直接改数据库。部门部长能看到的「用户/投递/操作记录」计数和列表按部门收窄，但部门部长管理权限组（`perm.manage`）本身是一个独立、不限部门的节点，拿到它的人能改任何组的继承与条目（站长组除外）；权限包要按这个来审。`dept.manage` 还没有执行点，种子里发了但目前只是摆设。应用层 scope 目前只实现了 `department` 一个维度，别的维度（如按分类的论坛版务）各自在各自的路由里判定，不经 `console-scope.ts` 统一处理。一键系统备份（#282，`system.backup`）的归档里带着全部账号与密码哈希，种子里不发给部门部长、不在 `title.management.head` 的清单里，只有站长的根通配 `*` 默认拿到；谁拿到这个节点就能下载整站数据，权限包审查要单独留意有没有被顺手发给了别的组。归档已经把短时安全数据（会话、设备授权、OIDC 临时授权与令牌、邮箱验证码、各种限流计数）清空，也不含任何真实密钥，见 [BACKUP](../ops/BACKUP.md)。

**发信里的个人信息**（#148，[mail](../services/server/mail.md)）：招新的信里写着投递人的姓名、班级、邮箱、投递时间、报名编号，「已收到」那封还有特长原文。这些信在 `mail_outbox` 里等着发的时候（`pending`、`sending`，最长到第 6 次失败，约 8 个半小时）带着收件地址、HTML 和纯文本；发出、放弃或不发之后这三列改成 NULL，只留收件地址的 sha256、主题和结果，不发的信（没有配置发信商、发信白名单模式下不在名单里）写入时就不存。控制台看到的每封信的结果（`MailSummary`）不含地址和正文。`last_error` 和日志只记发信商名、HTTP 状态、对方的错误码（只留字母、数字和 `. _ -`）和信的编号，不记密钥、收件地址、正文和对方回答的原文；投递的「已收到」写不进队列时只记投递编号和错误码。审核备注不进信里，审计 `application.review` 只记这次有没有写信。发信商的密钥（`MAIL_ALIYUN_ACCESS_KEY_*`、`MAIL_RESEND_API_KEY`）和预发布白名单 `MAIL_ALLOWLIST`（里面是真人的邮箱）是环境级 secrets，仓库里留空（[ENVIRONMENTS](../ops/ENVIRONMENTS.md)）；配置写错时启动失败，错误信息不带配置的值。信里的链接只能指向正式与预发布站点，回信地址与发件地址只收一个普通的邮箱地址，主题里没有换行，不会被拼出额外的邮件头。信交给阿里云或 Resend 之后，信的内容与收件地址按对方的保存规则留存，不在本服务的控制范围内。

**招聘邮件模板与测试邮箱试发**（#285，[mail](../services/server/mail.md)「邮件模板」）：信的内容是库里的模板，可以由有节点 `mail.template.manage` 的人改，所以防护放在渲染这一处而不是靠模板作者自觉。模板里只有带 `{{变量名}}` 的文字，变量清单固定在代码里，没有表达式；保存时不认识的变量、别的类别的变量、指向官网以外的按钮路径都当场回 400；变量的值先替换进文字字段，再由 `renderEnvelope` 统一转义，模板写不了 HTML、CSS、脚本和任意链接，投递人在姓名、特长里写的 `<script>`、`<img onerror>`、`javascript:` 和外站链接只会当成文字显示。节点默认只有站长的根通配拿到、不往下发：试发会真的往外发信，预览还能带投递的真实字段（另外要有 `apply.view`）。试发要刚登录过（step-up），只发到请求里填的一个地址、一封，数据只用示例，不读不写投递和审核记录；每个账号每小时 10 封、全站每小时 30 封，超过回 429；主题前加「【测试】」；这种信只试一次、失败不重试；操作记录只留脱敏的邮箱和模板 id，不留邮箱明文和信的内容。剩下的风险：持有该节点的人能用试发让「长江大学极客班」的发件地址向任意一个自己填的邮箱发出一封内容可控的样信（文字是自己写的模板，数据是示例），每个账号一小时 10 封，对方地址不在白名单时不发；这和能改模板、改状态发信是同一档信任，所以才不下放。控制台里的预览放在不带任何权限的 `sandbox` iframe 里（`srcdoc`，不执行脚本、不能访问页面），预览的 HTML 和真正发信走同一条渲染路径（`mailer.ts` 的 `previewLetter` 调 `recruitmentLetter`）。

**投递确认信被拿来发给别人**（#148、#169）：投递接口不用登录，谁都能填别人的邮箱，服务器就会以「长江大学极客班」的名义发一封带投递人自己写的文字（姓名、特长原文）的「已收到」。2026-09-27 要求信本身不限、改在投递时限次数（每个设备或每个 IP 的申请次数上限为 5 次）：同一个来源 IP（IPv6 按 /64）、同一个设备各自 24 小时内最多 5 份成功的投递，第 6 份回 429、不落库、不发信（`routes/portal/apply.ts` 的 `APPLY_LIMITS`）。设备是投递接口发的 httpOnly cookie，只发给投递接口；计数表 `application_limits` 只存 IP（/64）和设备 id 的 sha256，最多留 24 小时。确认信只剩全站每小时 200 封（`lib/mail/mailer.ts` 的 `RECEIVED_LETTER_LIMITS`），防止换很多 IP 刷光发信额度、改状态的正式通知发不出去。改状态的信要「审核投递」能力才能触发，不设上限。投递接口不收末尾带点的域名、带引号的本地部分和 IP 字面量。剩下的风险：换 IP 又清 cookie 的人每个 IP 每天仍能让 5 个任意邮箱各收到一封带自己文字的信，同一个收件箱可能从不同 IP 收到多封；Turnstile 没开时（两个环境现在都没开），批量投递还受每个 IP 每分钟 5 次、工作量证明和蜜罐限制；换很多 IP 的人仍能把全站每小时 200 封打满，那一小时里真正投递的人收不到确认信。校园网、宿舍、热点共用一个出口 IP（或 IPv6 同一个 /64）时，同一出口一天里第 6 个人投递不了（页面写明原因，第二天可以再投）。预发布环境从 #169 起默认向所有人发信（`MAIL_RECIPIENTS=all`），在预发布测试投递或改状态会向真实邮箱发送包含预发布域名 `prev.yangtzeu.work` 链接的邮件，不再受白名单过滤拦截。开发信前要开 Turnstile 的话，见 [ENVIRONMENTS](../ops/ENVIRONMENTS.md)。另外，控制台改状态带着页面上看到的状态和审核记录的版本号（`expected_status`、`expected_review_id`，最大的审核记录 id），别人刚处理过（包括改走又改回）时回 409、不发信，不会按旧画面给投递人发出互相矛盾的信；改状态不带这两项的请求（部署前打开的旧页面）同样回 409。

**残余风险**：降级、摘掉称号或停用之后，对方已有的会话还在 7 天有效期内，但从下一次请求起按它现在所在的组判定；论坛里没有 `forum.*` 写节点就只能读，这个人以前发的帖子和论坛用户留着。持有 `perm.manage` 的人能把站长组以外任何组的条目改宽，改动对组里所有人生效。官网和论坛在 `/api/public/org` 读不到时显示内置的默认称号，可能与控制台里改过的不一致（#275 换成 `/api/public/departments` 后这条退场）。论坛用户的称号在本人下一次请求论坛时才刷新，别人看到的是他最近一次访问时的称号。`/auth/me` 的 `console_link` 只决定显不显示入口，按钮显隐只是提示，授权只在服务端。

## 比赛报名与组队的数据可见范围（#239）

报名、队伍与积分都按极客班账号 `account_id` 认人（会话里的 `users.id`），不按会变的 GitHub 登录名；比赛表不存名字、头像或联系方式，读取时从账号与绑定的 GitHub 身份取，名单 CSV 用导出那一刻的值。

- **匿名与本场无关的成员**：公开接口只有赛事事实与报名摘要（是否开放、个人或团队、人数、积分），不含报名人数、队伍、成员或任何待处理信息。匿名的公开接口（单场、天梯、动态、统计、快照）放开 `Access-Control-Allow-Origin: *`，只读、不读会话，给托管的比赛官网与 SDK 用；人只给昵称、用户名与头像，见下一节。
- **成员**：登录且是极客班成员才能读写；成员守卫只看会话账号与组织身份，比赛路由不自己调 GitHub。成员能看到统计数字、未解散队伍的在队成员（账号、登录名、头像、角色）与「找队友」里本人写的留言。
- **待处理的范围**：门户的待处理只含当事人自己的申请与邀请，以及本人所在队伍的待处理项（含申请留言）；其他队伍与匿名看不到任何待处理。本队普通队员能看见本队的申请，但只有领队能操作，服务端按记录判断「关系是否属于这支队伍」和角色，越权回 403 `not_team_leader` 或 404，不靠按钮是否显示；被拒绝、撤回、退出的历史不出现在门户。
- **组织者**：名单、设置与积分复用 `competitions.manage`，没有新增能力；名单含已取消与已解散的记录，只在控制台下发。导出 CSV 写 `competition.roster.export` 审计（只有比赛 id 与行数），单元格走 `csvCell` 防公式注入；报名设置写 `competition.signup_settings.update`，移出报名（#342，另要 step-up）写 `competition.signup.remove`（只有被移出的账号与对队伍做了什么），积分登记与撤销写 `competition.score.add` / `competition.score.revoke`，`details` 不记留言、队名原文与撤销原因的全文。写入与审计同一事务，审计失败一起回滚。
- **自助操作留痕**：门户报名、组队与取消写 `activity_events`，与业务写入同一事务，操作记录失败则业务回滚；不写旧 `audit_logs` 或本人的 `identity_audit`。成功即时失效本场公开缓存，人员/统计不会保留取消前的结果。
- **限流**：成员写操作每人每分钟 30 次、名单导出每分钟 5 次，超额 429；读接口不限流，靠登录与成员门槛限制访问面。

## 比赛官网与兑奖码（#278）

- **托管的官网是不受信任的代码**：站点包由比赛方上传，服务端只做结构校验（大小、文件数、扩展名白名单、路径、符号链接、加密、重复、CRC），不审内容。所以 `/c/<slug>/*` 的每个响应都带 `Content-Security-Policy: sandbox allow-scripts allow-popups allow-popups-to-escape-sandbox; default-src 'self'; connect-src 'self'; img-src 'self' data:; style-src 'self' 'unsafe-inline'; font-src 'self'; frame-ancestors 'none'`：页面来源是 null，读不到主站的 `sid`、localStorage 与 IndexedDB，不能提交表单，也不能把顶层页面导走（只允许开新窗口），网络请求只能连本站；不加载外部脚本、字体和图片；不能被嵌进别的页面。响应去掉 `Set-Cookie`。只有内部赛、没下线、已发布的版本对外可见。
- **预览不靠 cookie**：sandbox 页面里的子资源请求不带 cookie，所以预览先在 `~preview/<版本>/` 用会话核对 `competition.site.publish`，通过后跳到带 HMAC 签名（`SESSION_SECRET`，覆盖比赛、版本与到期）的地址，一小时后失效；没权限与版本不存在都回 404。
- **公开接口不给身份**：天梯、动态、统计只给昵称、`@用户名` 与头像，不给真实姓名、邮箱、`account_id`、学号或兑奖码；扣分不给原因。按 IP 每分钟 120 次（`limit_events` 里只存 IP 的哈希），服务端缓存 10 秒，刷榜不会打到数据库。残余风险：同一个出口 IP 后面人很多时会一起被限流。
- **「有用」才加分，经得起核实**：GitLab 上的「有用」标签要经资源标签事件核实打标签的人：对得上 `gitlab_accounts` 里的账号、此刻持有 `competition.score.review`、不是作者本人，才自动加分；否则留在待确认。控制台确认、驳回、手工积分与撤销同样不能审自己的贡献或撤本人的扣分（403 `self_review`），要 step-up，并经 `recordActivity` 记下操作人。年级只按 `account_profiles.enrollment_year` 由服务端算，本人改不了系数。
- **兑奖码**：定榜时给每个得奖人生成 80 位随机的 `YUGC-XXXX-XXXX-XXXX-XXXX`（Crockford Base32，`crypto.randomBytes`），库里只存 sha256 哈希（查找用）、AES-GCM 密文（本人在「我的参赛」里看明文用）和末四位；操作记录、控制台列表与日志只有末四位。核销要 `competition.prize.redeem` 加 step-up，同一个码只能核销一次；输错的码每个账号每小时 20 次，防止逐个试。撤销定榜只在一张都没核销时允许。
- **上传与改规则**：上传、发布、改年级系数与奖项、定榜都要对应节点加 step-up，写入与操作记录同一事务；定榜后积分、规则、候选、报名和报名设置都不能再改；成员与公开榜同用冻结严格名次。人员游标只含比赛隔离摘要，不编码account_id。收集必须完整分页后原子应用，HTTP失败/预算耗尽不误撤旧分；网络等待期间定榜时拒绝迟到快照。身份到期/停用集成哨兵与未验收边界见[首场个人赛矩阵](../services/server/competition-rehearsal.md)。

## 论坛代码替换的边界

旧 React/Fastify 论坛已退出活动构建，核心不打开 forum.db、不注册旧写接口、不创建 forum_sid。旧 API 返回 410，生产未接好服务时论坛入口返回 503。旧数据库和附件保持原样，不能以清理代码为名删数据。

采用的 Tuff Forum 保留本机 Pinia/localStorage 演示模式：任意示例账号选择不是认证，UI 权限 helper 不是服务器授权，CDP 观察浏览器存储不是数据库审计。演示只用于本机，不作为生产内部论坛；当前服务端模式另经核心 `/api/forum/*` 的身份、授权与持久化路径，见下段。核心真实 GitHub 会话绝不接受示例 user ID/role 赋权。本机快照模式通过 dev 专用、仅 GET/HEAD 的 `/api/local-forum/*` 只读提供投影：哈希白名单、目录逃逸检查、索引给定的类型与 disposition、大小核对、no-store、nosniff 和禁止脚本的 CSP，错误体只含机器码（dev 错误处理器仍会附带堆栈，因此这些路由不进生产）；前端的论坛会话固定为游客、不渲染示例登录、论坛状态不写 localStorage；顶栏的全站 GitHub 登录只经同域 `/auth/me` 显示是谁，论坛没有据此授权的服务端。它没有给论坛增加任何授权，投影含真实成员公开资料，只能在获得授权的范围内本机使用。

site 模式不再把旧帖正文、`llms.txt`、`t/*.md` 或 `published/*.webp` 放进客户端/静态镜像后只在 UI 隐藏。网页 bootstrap 为空；身份变化先清空旧投影并使迟到的 state、正文、搜索和写回答失效。外部 `/forum/llms.txt`、`/forum/t/:id.md`、`/forum/published/:file` 由核心按当前 `sid` 和有效可见性实时授权，文本与图片都 `private, no-store`；图片拒绝统一 404。demo 与明确本机快照仍是隔离的本地数据合同。已经被公开浏览器或代理缓存过的旧静态内容无法由本次代码回收。

旧论坛的密码策略、上传重新编码、归档后端保护等实现已经随旧源码退役；这些不能继续被列为新论坛已具备的防护。新的论坛后端（#57，核心服务 `/api/forum/*`，[ADR-0004](../decisions/0004-forum-backend-in-core-server.md)）重新实现了身份（只认 `sid`）、授权（`forum.*` 能力）、游客滥用防护、计数与事务（编号来自数据库计数器，写操作在事务里）、审计和头像上传：头像只收 PNG / JPEG / WebP、≤2MB，登录与每小时 10 次的额度在读请求体之前核对，每次上传都计数（解码失败也算），以 sharp 解码出的真实格式为准，解码前按像素上限（4096×4096）拒绝解压炸弹，动图只取第一帧，重新编码成 256×256 WebP、不带原图元数据，按内容哈希以 `image/webp`、`nosniff`、`default-src 'none'` 提供。`state` 里别人的通知设置不下发真实值（给初始值），一条帖子的 @提及最多通知 10 人。帖子正文按 Markdown 原样存储，服务端不做 HTML 净化：输出到页面前转义原始 HTML、拦 `javascript:` 等链接由论坛前端的渲染器负责（#107 核对并补测试），这一层没通过验收之前，论坛写入口就是站点脚本注入的入口。

## 访问防护与全站上限（#333）

- **按真实客户端 IP 计分**：服务端用 Fastify 的 `req.ip`（沿用 `TRUST_PROXY=2`，只信任 HK Caddy 与 web nginx 两层），不再读客户端自己带的头。429 记 2 分；`/api/`、`/auth/` 下的 400、409、413、422 记 1 分（401 与 403 不计，它们是正常的未登录与权限探测，`invalid_origin` 也不计）；密码、邀请码失败各加 3 分，验证码只有真的比对过才加 3 分（猜错，含用完挑战的第 5 次；过期、已用、没有挑战只算普通的 400），PoW 校验失败（含重放）加 3 分。窗口 10 分钟，总分到 120 分封禁（`SHIELD_THRESHOLD`、`SHIELD_WINDOW_MINUTES`）。
- **外站诱导的浏览器请求**：浏览器写着 `Sec-Fetch-Site: cross-site`、且没有 Origin 或 Origin 不是本站的请求（别的网站用 `<img>`、`<script>`、无 cors 的 fetch 让访客的浏览器发来），不触发蜜罐封禁，也不按 429/4xx 计分，否则任何外站页面都能让它的访客、乃至同一个校园出口后面的所有人被封。Origin 写成本站却说 cross-site 的视为伪造，照常计分。这两个头是客户端写的线索，不是授权：鉴权、Origin 核对（跨站写请求照样 403 `invalid_origin`）、路由限流、全站上限与生效中的封禁都照旧；脚本也能带上这个头躲开启发式加分，躲开的只是加分，底下的限制照样拦它（`lib/shield.ts` 的 `crossSiteBrowserRequest`）。
- **逐级加长，安静后归零**：封禁依次为 15 分钟、1 小时、6 小时、24 小时（`SHIELD_BLOCK_MINUTES`），到顶为止；上一段封禁结束后安静满 24 小时（`SHIELD_DECAY_HOURS`）级别归零。被封禁的请求不再计分。`SHIELD_ALLOWLIST` 里的网段永远不计分、不封禁，留空 = 没有豁免。
- **落库与审计**：封禁表 `ip_blocks`、信号表 `shield_signals` 在 SQLite 里，重启后仍然有效；每次封禁写 `security.block`（系统记录），查看与解封分别写 `security.blocks.view`、`security.block.clear`。解封和对应审计在同一个事务里提交；审计失败则保持原封禁，不出现返回错误却已解封的状态。站长（根通配 `*`）默认拿到 `security.manage`，部长与其它角色没有。
- **限流计数落库**：`@fastify/rate-limit` 的计数写在 `rate_limit_counters`（`lib/rate-store.ts`），重启后同一窗口内的次数不清零。
- **全站北京日上限**：发码（`SITE_QUOTA_EMAIL_DAILY`，默认 2000）、注册（`SITE_QUOTA_REGISTER_DAILY`，默认 300）、意见箱（`SITE_QUOTA_FEEDBACK_DAILY`，默认 200）、设备码（`SITE_QUOTA_DEVICE_CODE_DAILY`，默认 500）；同一收件人每天 `EMAIL_RECIPIENT_QUOTA_DAILY`（默认 10）封，换 IP 无效（#319）。计数走 `limit_events`，按北京日零点重置，`-1` 为不限。
- **没有 visitor cookie 的注册**：按 IP 另计 `REGISTER_NO_COOKIE_IP_DAILY`（默认 3），丢掉 cookie 不能绕过设备限额。
- **边缘与 nginx**：web 容器的 nginx 按真实客户端 IP 限流，只从隧道两端和 Docker 网段读取 `X-Forwarded-For`；写请求（除 GET、HEAD、OPTIONS）突发 60、每秒 5 个，读桶突发 200、每秒 30 个，连接每个 IP 最多 100 个。与 server 共用 `SHIELD_ENABLED` 和 `SHIELD_ALLOWLIST`：关闭或白名单来源不进入 nginx 限流桶；应用路由自身的限额与全站配额不因此取消。信任名单不能放宽。HK 入口 WAF、人机挑战不在本次范围，对应 GitLab #326。
- **剩余风险**：IP级防护不能区分校园NAT后的不同使用者，登录用户也可能被同一出口的异常请求牵连。控制台 `/console/security` 允许持有 `security.manage` 的管理员核对并确认解封，写入还要求近期登录。阈值没有因拒绝样本而下调；成功请求基线与真实环境验收仍需另验。防护不替代Turnstile（未配置）与人工复核。
- **蜜罐与法律告知（#333 追加）**：`/.env`、`/.git/`、`/wp-login.php`、`/wp-admin`、`/phpmyadmin`、`/actuator/`、`/server-status`、`/.aws/` 等常见扫描目标（前缀表是 `lib/shield.ts` 的 `HONEYPOT_PREFIXES`，web nginx 的 `location ~*` 由同一份生成，`tests/tooling/abuse-notices.test.ts` 核对）第一次命中就直接封禁，回 404。nginx 按规整后的路径匹配、转发原始请求行，server 也按同样的规整写法比较（解一次百分号编码、合并重复的 `/`、解析 `.` 与 `..`），`/%2Eenv`、`//.env` 绕不过去。被拦下的回应（403 `ip_blocked`、429、蜜罐 404）带一句中文 `notice`（`SHIELD_NOTICE`）：本次请求已被安全策略限制，援引《网络安全法》第二十九条，要求未经授权的自动化工具与 AI 代理停止操作、不得绕过，已授权的维护与测试按站方约定范围进行。正常回应不带。`/.well-known/security.txt`（RFC 9116）从 `PUBLIC_ORIGIN` 拼，Contact 指向意见箱；被封禁的来源也拿得到，误封的人能找到站方。
- **临时合成蜜罐**：上述404是默认行为；管理员在 `/console/security` 确认开启后，仅 `GEEK_DEPLOYMENT_ENVIRONMENT=production` 且基础防护开启的实例，对未封禁、非白名单、非跨站诱导来源的首次GET/HEAD返回200合成诊断（HEAD无正文），同时封禁该来源；已有封禁优先，后续仍403。`app_state.security_decoy_until` 保存截止时间，缺失/损坏关闭，单次1–60分钟，到期等值关闭，重启不续期，不增加环境键或真实漏洞。配置与 `security.decoy.update` 同事务；命中封禁与 `security.decoy.hit` 同事务，审计失败不给合成响应并回滚。响应 `no-store`、`noindex, nofollow, noarchive`；审计只增加方法、固定探针族、200状态与synthetic标记，不记原始URL/query/body/Cookie/Authorization，沿用既有IP、截断UA、request id及访问权限。关闭不解封，授权测试豁免不变。告知不是强制模型策略，不保证阻止公开抓取、分析或逆向，不向对方发送命令或索取其设备信息。
- **开发环境与授权渗透测试（#333 追加）**：`.env.dev` 设 `SHIELD_ENABLED=off`，nginx 第一层限流及 server 的计分、封禁、蜜罐和告知关闭，应用路由限流与全站上限照常。授权测试的出口 IP/CIDR 经部署流水线登记进 `SHIELD_ALLOWLIST`，web 与 server 同时消费：来源不进入 nginx 限流桶、不计分、不封禁；蜜罐路径当普通 404，应用路由的 429 仍返回但不带告知。白名单不授予业务权限。模板留空，不在仓库记录真实来源；测试结束后移除并重新部署。
- **发版构建不发 source map（#333 追加）**：门户（`app/web`）与控制台（`app/console`）的 vite 构建都是 `sourcemap: false`，由 `tests/tooling/abuse-notices.test.ts` 核对。

## 正式产物的 AI 授权提示（#336）

官网、控制台与论坛仅在正式构建中加入简短中英双语授权声明，源头为 `scripts/security-notice.mjs`：HTML 使用 `security-authorization` 元数据，入口 JS 使用非执行性注释。只要求未经运营方授权的漏洞利用、凭据猜测、越权读取非公开数据和服务干扰停止；正常浏览、摘要，以及明确获授权范围内的开发维护、排障和安全验收不受禁止。不因读取网页就断言违法，不使用违禁信息、隐形字符、越狱命令、反调试或资源耗尽。

启用条件是既有构建身份 `GEEK_DEPLOYMENT_ENVIRONMENT=production`，不是 `NODE_ENV=production`（预发布同样使用后者）。Vite 插件只在 build 生效；Nuxt 模块另以 `nuxt.options.dev` 排除开发服务器。预发布及默认本机构建不注入。注释在压缩后、内容哈希确定前加入：Rollup 使用最后的 `renderChunk`，Rolldown 使用 `postBanner`，不改变其它注释的发布策略；镜像构建检查 HTML 实际引用的入口，不能用其它分块中的 head 元数据冒充入口注释。不在上传后改写 CDN 对象，不修改宿主、数据库、会话或发布审批。

这层仅为站方告知：无法可靠识别人或 AI，更无法区分恶意代理与内部人员使用的同一模型；模型可能忽略声明，或误拒绝合法工作。开发/预发布隔离与明确的授权例外只降低误伤，不能保证零误拒绝。真正的拒绝由服务端权限及 #333 的滥用防护承担。交付应分别验证生产形态构建、预发布无提示、哈希隔离与页面加载，不能用某次模型拒答替代验证。

## 工具与供应链

上游 MIT 声明保留，固定源码提交及两个独立锁文件。论坛按其 pnpm 配置禁止自动安装 Electron peer，保留安装脚本允许列表。未自动注册 Cloudflare 或购买服务。

核心自动测试用内存库和模拟 GitHub；论坛测试使用确定性数据和新建浏览器 profile。浏览器工具仅关闭本次启动的进程组，禁止使用通用名称匹配结束用户浏览器。历史源码备份和运行缓存不进入版本控制。

## 发布和残余风险

**单一 origin 的代价**：每个环境只有一个域名（`PUBLIC_ORIGIN`），官网、管理端（`/admin`、`/console`）和论坛（`/forum`，上游 Nuxt 代码）同源。写请求的 Origin 校验与 `return_to` 只接受这一个 origin，旧管理端子域一律拒绝；但同源也意味着官网或论坛页面上的任何脚本注入都能带着 `sid`（host-only、`Path=/`）调用管理端接口，旧的「管理端独立域名」隔离不再存在。因此三端共用的 CSP（`script-src 'self'`，宿主 nginx 下发）与论坛/Markdown 的输出净化是管理端权限的直接防线，放宽其中任何一项都要按管理端风险评审。论坛页面是唯一带自己 CSP 的上游：同一份站点策略，只在 `script-src` 里多出论坛构建产物中全部内联脚本的 sha256（现在是 importmap、配色、`__NUXT__` 配置三段，都是构建生成的，不含用户内容），由 `app/forum/scripts/csp-header.mjs` 在镜像构建时算出，脚本标签认不全就让构建失败；宿主只在 `/forum/` 下、上游已带 CSP 时不再叠加，其它路径一律照发站点策略，上游再带一份也只会更严（#78）。不允许为此改用 `'unsafe-inline'`，脚本里有断言。

两个环境（正式 tag `vX.Y.Z` → 正式栈、预发布 tag `vX.Y.Z-rc.N` → 预发布栈）必须完全隔离：独立目录、独立 compose 项目、独立端口、独立命名卷、独立密钥、独立域名；Cookie 使用 host-only（不写 `Domain`），禁止 `.yangtzeu.work` 这种父域共享，预发布不得读取正式环境的会话或数据。密钥只经 CI/CD 从 GitHub 环境级 secrets 注入渲染后的运行时 `.env`，仓库模板里的密钥字段保持空值（见 [ENVIRONMENTS](../ops/ENVIRONMENTS.md)）。

全站 GitHub 登录与登录门槛、论坛服务端身份/授权/存储以及前端接入均已存在于源码，自动回归使用模拟外部响应。真实 OAuth 往返、环境安全配置和论坛业务的当前验收状态应按具体提交查发布记录，不在本规范复制一份随时间过期的“尚未上线”结论；源码、目录或部署模板本身不证明这些验收已经完成。旧论坛账号认领、内部 Hub 与上游 Cloudflare PRD 不能当作已实现能力。数据层仍是 SQLite + 命名卷，没有多实例隔离或多节点一致性验证；Postgres 迁移未做。没有完整依赖漏洞审计、WCAG/ASVS 认证或多实例验证。

旧部署文档曾暴露服务器登录凭据（原记录文件 `docs/ops/FORUM-SUBDOMAIN.md` 已随子域模型退役删除，事件记录保留在本节），已从当前工作区移除，但这份凭据仍需轮换，并评估 Git 历史和传播副本。本轮不使用凭据、不擅自重写历史。check:secrets 只检查部分当前文本模式，不证明历史泄漏消失。

依据是当前代码、[forum 服务合同](../services/forum/README.md)、[采用决策](../decisions/0003-adopt-tuff-forum.md) 和 [官方参考范围](../conventions/REFERENCES.md)。

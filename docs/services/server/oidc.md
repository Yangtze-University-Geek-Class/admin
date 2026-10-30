# Server 对外授权与 GitLab 账号同步（OIDC）

> 不同源的应用用极客班账号登录：核心服务内嵌一个 OpenID Connect 签发者，第一个下游是自建的 GitLab（正式 `https://yangtzeu.work/gitlab`；#335 搬家前是子域名 `git.yangtzeu.work`，现在只做跳转）。同一模块按极客班账号在 GitLab 上建好用户、放进 `geek` 组，离开的封禁。

状态：`current` · 更新：2026-10-30 · 源码：`app/server/src/lib/oidc-store.ts`、`lib/oidc-provider.ts`、`lib/account-directory.ts`、`lib/gitlab-sync.ts`、`routes/oidc/`、`routes/console/gitlab.ts`、`cli/oidc.ts`；同意页 `app/console/src/pages/Authorize.vue` · 上级合同：[server](README.md) · 历史来源：GitLab geek/admin #270、#271（头像）、#272（邮箱）；当前回归：GitHub Yangtze-University-Geek-Class/admin #271（不同命名空间，旧声明见 `docs/history/changes/gitlab/271.json`） · 决策：[ADR-0005](../../decisions/0005-sso-extend-core-server.md) 决策 3、8

## 签发者与端点

签发者是 `<PUBLIC_ORIGIN>/oidc`（正式 `https://yangtzeu.work/oidc`，预发布 `https://prev.yangtzeu.work/oidc`），由 `oidc-provider` 9.12.2 实现，挂在 Fastify 的 `/oidc/*` 下，不另起进程。没配 `OIDC_JWKS` 时路由照样注册，请求一律 404（本机、测试与项目地图都是这样）。

| 端点 | 用途 |
|---|---|
| `GET /oidc/.well-known/openid-configuration` | 发现文档 |
| `GET /oidc/jwks` | 验 ID Token 用的公钥（只有公钥部分） |
| `GET /oidc/auth` | 授权端点，浏览器从下游跳来 |
| `POST /oidc/token` | 换令牌，下游服务器调用，`client_secret_basic` 或 `client_secret_post` |
| `GET\|POST /oidc/me` | userinfo |
| `POST /oidc/token/revocation` | 撤销令牌 |
| `GET /oidc/interaction/:uid` | 交互入口：要登录或要本人同意时，签发者把浏览器带到这里 |
| `GET /oidc/interaction/:uid/details`、`POST …/confirm`、`POST …/abort` | 同意页 `/authorize?uid=` 读取与提交，要 `sid` |

只做授权码流程，PKCE 必须用 `S256`；不发 refresh token，访问令牌与 ID Token 1 小时，授权码 10 分钟，交互 10 分钟，签发者自己的会话 7 天，授权记录 180 天。动态注册、单点登出、implicit 与 hybrid 都不开，`OPTIONS` 不接（下游在服务端换令牌，不需要浏览器跨域）。声明只有三组：`openid`（`sub`）、`profile`（`name`、`preferred_username`、`picture`）、`email`（`email`、`email_verified`，只给验证过的 `canonical_email`）。`name` 与 `picture` 从统一账号资料 `account_profiles` 经 `public-profile.ts` / `account-directory.ts` 投影：空昵称回退当前账号登录名，上传头像转成 `<PUBLIC_ORIGIN>/api/identity/avatar/<hash>.webp` 绝对地址，否则用当前绑定的 GitHub 头像。论坛的同一 fallback 由 `identity-store.publicFallbacks()` 批量只读，不把历史 `forum_users` 缓存当身份事实。`preferred_username` 仍是 `account.login`，不因公开 username 改名而重建主体。真实姓名和年级（#280）不进任何声明，GitLab 上看到的仍是显示名；`tests/server/real-info.test.ts` 核对签发声明和 GitLab 同步的账号目录里没有真实姓名。

协议端点按 IP 每分钟计数，下游服务器调用和浏览器跳转分开算：发现文档、JWKS、换令牌、撤销与 userinfo 合计 600 次（GitLab 每次登录都要从它自己的服务器调好几次，一个班同时登录都算在它一个 IP 上），其余（授权端点）120 次；交互入口与详情每分钟 30 次，同意与拒绝每分钟 20 次，超额 429 `rate_limited`。`/oidc/` 下经 Fastify 回复的（交互入口、同意页的三个接口）都带 `Cache-Control: no-store`；协议端点的缓存头由 `oidc-provider` 自己定。`oidc-provider` 内部出错（`server_error`）时记一条错误日志，只有路径、错误类型和错误代码。

## 登录与同意

**资格口径**：`identity-store` 的摘要、`isMember`、claims 和同步名单统一认 active 账号上当前有效的**直接** `level.member` 或 `level.alumni`，有效期为 NULL 或 `expires_at > now`；等值到期即失效。`title.site.owner` 不替代这两个身份组，旧 `org_state/org_role` 也不授予资格。合法 alumni 可登录，有效直接 owner 的 `site_role=admin`，否则为 member；这是对外身份口径，不给普通 alumni 额外论坛写节点。下文“成员”均指此口径。

1. 下游把浏览器带到 `/oidc/auth`。签发者自己的会话只是缓存，是否登录、是谁以本站 `sid` 为准：`sid` 没了、换了账号、或会话里的账号已经不是成员时都回到交互入口。
2. 交互入口没有 `sid` 时 303 到 `/signin?return_to=/oidc/interaction/<uid>`，登录完回到这里；账号不是有效成员（停用/合并、直接 member/alumni 资格缺失或到期）时带 `error=access_denied` 回到下游；账号还没有登录邮箱（这个环境能发信时，#273）303 到 `/bind-email?return_to=/oidc/interaction/<uid>`，绑好回到同一个交互接着走；邮箱有了但还没填真实姓名或年级（#280）同样 303 到 `/complete-profile?return_to=/oidc/interaction/<uid>`，填好回来接着走；允许过这个应用、签发者的会话也还在时同样先进交互（`routes/oidc` 把这种会话记成没有极客班账号），不直接发授权码，同意页读详情和点允许也回 403 `email_required` 或 `profile_required`，拒绝不拦；这个浏览器换过极客班账号时先删掉签发者里旧账号的会话，再按现在的账号登录，不走 `oidc-provider` 自带的「先登出」确认页。
3. 第一次登录某个应用要本人同意：303 到 `/authorize?uid=<uid>`，页面写明应用名、回到哪个主机、要哪些信息和当前账号。允许后授权记在 `oauth_grants`，之后同一账号从同一应用登录不再问，换浏览器也不问；拒绝时带 `error=access_denied` 回到下游。同意与拒绝写审计 `oidc.consent`、`oidc.deny`。
4. 授权码重放时按规范撤销这份授权和它发出的令牌，下次登录要重新同意。

`sub` 按下游的 sector 生成 32 字节随机值（sector 在登记客户端或第一次改回调时钉进 `oauth_clients.sector_id`，之后回调换到别的主机也不变；钉住之前登记的旧行按第一个回调的主机算，见下节），存在 `oauth_subjects`，不随登录或换签名密钥变化；GitLab 拿到的 `sub` 和别的应用不同，内部的 `account_id` 不下发。账号停用或不再是成员后，已经发出的访问令牌在 userinfo 处立刻失效（401），新的登录被拒；GitLab 上已登录的会话由下面的同步封禁收口：`GITLAB_SYNC=on` 时最长差一个同步周期（10 分钟）。同步不是 `on` 时没有人封禁，所以 GitLab 一侧的统一登录要在 `on` 之后再打开（见「GitLab 一侧的配置」）。

## 客户端与密钥

客户端只能用命令行登记，没有接口和页面。命令在目标机的 server 容器里执行，和服务共用同一个库：

```bash
# 生成签名私钥（RSA 2048 的 JWK Set，输出一行 base64），原样写进目标机 .env.<环境> 的 OIDC_JWKS（环境文件的密钥不收引号，不用 JSON 原文）
docker compose … exec server node app/server/dist/cli/oidc.js keygen > 某个 0600 文件
# 登记 GitLab；client_secret 只输出这一次，库里只存 AES-256-GCM 密文
# 回调用本环境 env 的 GITLAB_URL 拼；--sector 填 GITLAB_OIDC_SECTOR，不给就是回调的主机
docker compose … exec server node app/server/dist/cli/oidc.js client add --name GitLab --client-id gitlab \
  --redirect-uri <GITLAB_URL>/users/auth/openid_connect/callback --sector <GITLAB_OIDC_SECTOR>
# 列出（带 sector）、换 secret（旧的立即失效）、停用、恢复
… oidc.js client list | client rotate --client-id gitlab | client disable --client-id gitlab | client enable --client-id gitlab
# 下游换地址（#335）：先加新回调，新地址验过再去掉旧的；sector 不变，至少留一个回调；有改动时写审计 oidc.client.redirects
… oidc.js client add-redirect --client-id gitlab --redirect-uri <新回调> | client remove-redirect --client-id gitlab --redirect-uri <旧回调>
```

回调地址只收 `https`（本机 `127.0.0.1`、`localhost` 可以用 `http`），不带锚点和账号口令。没给 `--sector` 登记时，同一客户端的回调地址必须同一个主机，这个主机就是 sector；sector 一经钉住（登记时，或第一次 `add-redirect`/`remove-redirect` 时把旧行的主机写进 `sector_id`），回调可以跨主机，sector 不跟着变（#335：GitLab 从子域名搬到主站路径，成员的 `sub` 不能变）。回调跨主机时 `oidc-provider` 要求客户端写明 `sector_identifier_uri`：客户端元数据一直带 `https://<sector>/`，签发者配置 `sectorIdentifierUriValidate` 返回 false，不去取这个地址；`pairwiseIdentifier` 用的是同一个 sector。同步客户端由 `GITLAB_OIDC_CLIENT` 选择：正式保留 `gitlab`，独立预发布使用 `gitlab_preview`；标识只收3–64位小写字母、数字和下划线。同步按选定客户端钉住的 sector 算 `sub`，不按 API 基址猜 sector；`GITLAB_OIDC_SECTOR`（主机名，可带端口）写明本环境期望的 sector，客户端的 sector 和它不一样时整轮跳过并报 `gitlab_sector_mismatch`。签发者的 cookie 用 `SESSION_SECRET` 派生的密钥签名（`oidc_session`、`oidc_interaction`、`oidc_resume`），换 `SESSION_SECRET` 会让进行中的登录失效，不影响 `sub`。

## 数据

| 表 | 内容 | 读写方 |
|---|---|---|
| `oauth_clients` | 登记的下游：名称、回调地址、钉住的 sector（`sector_id`，旧行为空）、加密的 secret、`active`/`disabled` | `lib/oidc-store.ts` |
| `oauth_subjects` | `(sector_id, user_id) → sub`，两个方向都唯一 | `lib/oidc-store.ts` |
| `oauth_grants` | 本人允许过的 `(user_id, client_id) → grant_id` | `lib/oidc-store.ts` |
| `oidc_payloads` | `oidc-provider` 的会话、交互、授权码、令牌、授权（按 `expires_at` 每小时顺手清一次过期行） | `lib/oidc-store.ts` |
| `gitlab_accounts` | 极客班账号对应的 GitLab 用户 id、用户名、状态、组权限、传上去的头像来自哪里、最后一次错误 | `lib/gitlab-sync.ts` |

列与约束见 [数据模型](data-model.md)。

## GitLab 账号同步

`GITLAB_SYNC` 是 `off`（默认）、`dry-run`（只算出要做什么，不写表、不改 GitLab）或 `on`。不是 `off` 时要有 `GITLAB_URL`（HTTP(S) 基址，可带部署子路径；去掉尾斜杠，拒绝凭据、查询与锚点），`on` 时还要本实例独立的 `GITLAB_API_TOKEN`（管理员 `api` 令牌；`dry-run` 不调用 GitLab）；`GITLAB_GROUP` 默认 `geek`。API 请求保留完整基址后追加 `/api/v4`，不跟随重定向。`on` 启动即对账，此后每10分钟一次，同账号串行并在轮到时重读资格；停机排空当前账号。

- 每个有效成员在本环境的 GitLab 上有一个用户，按 `openid_connect` / 原 `sub` 认人；sector 取 `GITLAB_OIDC_CLIENT` 客户端钉住的 sector，不取 API 基址。客户端未登记时整轮跳过并报 `gitlab_client_missing`，sector 和 `GITLAB_OIDC_SECTOR` 不一样时报 `gitlab_sector_mismatch`。先精确找身份、找到沿用、没有才建号；新实例不得沿用另一个实例的数字用户 ID。
- 用户名在第一次建号时定下，之后不改：有 GitHub 的用 GitHub 登录名，没有的用站内登录名；GitLab 的保留名、和组同名、或已被别人占用时依次加 `_yz`、`_yz2`。邮箱用验证过的 `canonical_email`，没有或在 GitLab 上被占用时用 `<用户名>@noreply.<sector>`（正式的 sector 搬家后仍是 `git.yangtzeu.work`，地址不变）。建号带 `skip_confirmation` 与随机密码，成员不用密码登录。
- 资料在建号时补一次：统一账号资料优先（昵称、简介），不是读旧 `forum_users` 作为另一事实源。`gitlab-sync.profileFor()` 在有 GitHub 身份且本地简介为空时匿名读 GitHub 公开资料作既有兜底；所在地/网站不在统一 DTO 内，仍仅来自该次公开资料。网站不是合规 http(s) 网址就不传，读取失败不阻止建号。本次不增加对已建 GitLab 用户昵称/简介的持续回写，也不按新 username 重建用户。
- 头像（#271）单独一步（还要做的事是 `set_avatar`）：有统一账号上传的头像用它（WebP；旧论坛写口已兼容写入），没有时用 GitHub 头像，向 GitHub 要 256 像素的（`?s=256`，没记下头像地址的按 GitHub 数字 id 取），匿名下载。GitLab 收下（200）后在 `avatar_source` 记下来源（统一账号头像沿用兼容标记 `forum:` 加散列，GitHub 头像是地址）；来源变了（例如在论坛上换了头像）再传，没变不再传。还没记过来源的会传一次：以前版本建好的号这样补上头像；GitLab 在登录时自动建、被同步接管的号也一样，成员在这之前自己在 GitLab 换的头像会被盖掉一次，之后只有论坛或 GitHub 那边的来源变了才会再盖。拿不到能传的图或 GitLab 没收都算失败，写进 `last_error`、下一轮再试，直到传上去或来源变了：GitHub 连不上（`github_avatar_unreachable`）或不是 200（`github_avatar_<状态码>`）、回的不是 PNG、JPEG、GIF、WebP（`github_avatar_not_image`）、超过 GitLab 的 200 KiB 上限（`avatar_too_large`）、论坛里已经没有这张图（`forum_avatar_missing`）、GitLab 不是 200（`gitlab_avatar_<状态码>`）。一直传不上去的，控制台成员页能看到原因，成员在论坛上换个头像就会按新的来源重传。
- 邮箱（#272）也是单独一步（`set_emails`）：GitLab 按提交里的作者邮箱认人，只认用户名下已确认的邮箱，而 GitLab 没配发信，成员自己在 GitLab 加的邮箱确认不了，所以由同步加。要有的邮箱是：主邮箱（账号页绑的第一个邮箱，`canonical_email`）写成 GitLab 的主邮箱（`PUT /users/:id` 带 `skip_reconfirmation`），只绑了 GitHub、没有主邮箱的留着建号时的占位地址；账号页绑的其它邮箱，和 GitHub 的两种 noreply 邮箱（`<数字 id>+<登录名>@users.noreply.github.com` 与旧式的 `<登录名>@users.noreply.github.com`，在 GitHub 网页上提交、或打开了邮箱保护时提交里用的是它），以已确认的次邮箱加上（`POST /users/:id/emails` 带 `skip_confirmation`），GitLab 上已有但没确认的删掉重加。以前同步过去、现在不要的（账号页删掉的邮箱），和换成真邮箱后 GitLab 留成次邮箱的占位地址，从 GitLab 删掉；GitLab 现在的主邮箱不删。每一轮做完在 `emails_source` 记下 GitLab 上实际有、由同步管的邮箱（JSON：主邮箱和其它邮箱），要有的邮箱和它一样时不调 GitLab。有一项被拒（例如邮箱已经在别的 GitLab 用户名下，加次邮箱回 400，改主邮箱回 409）就写 `gitlab_email_<状态码>`，别的项照样做；这时记下的只有做成的，和要有的不一样，下一轮再试，这一轮加上去的邮箱以后在极客班删掉也照样从 GitLab 删；查不到 GitLab 用户写 `gitlab_lookup_<状态码>`。头像和邮箱两步互不耽误：一个失败另一个照做，`last_error` 记先失败的那个。
- 组权限：有效 member/alumni 为 Developer（30），其中 active 且有当前有效直接 `title.site.owner` 的为 Owner（50）；角色变了就改。owner 到期但 alumni 仍有效时降为 30、不封禁；member/alumni 资格到期或账号停用则封禁。正常登录和两轮对账不重建 `sub`、provider 绑定或 GitLab 用户 id。
- 停用、不再是成员的封禁（`block`），回来的解封；从不删除 GitLab 用户和他们的仓库。不是同步建的 GitLab 用户（例如 root）不碰。
- 还没同步过就离开的：只要他在 GitLab 的 sector 有过 `sub`（用极客班登录过 GitLab，GitLab 可能已经自动建了号），每一轮都按身份去 GitLab 找（还要做的事是 `find_and_block`），找到就记下这个用户并封禁；找不到、或者找的时候 GitLab 出错，这一轮什么也不改、不写审计（出错只算进这一轮的失败数），下一轮照样找，因为他可能回来、用极客班登录一次（GitLab 又自动建号）、在下一轮之前又离开。没有 `sub` 的不去找。
- 调 GitLab 管理接口不跟随跳转（跳到别的源时管理员令牌会跟过去），遇到跳转按 `gitlab_unreachable` 记。
- 失败写进 `last_error`（`gitlab_unreachable`、`gitlab_create_<状态码>`、`gitlab_member_<状态码>`、`gitlab_avatar_<状态码>` 等），下一轮再试；写审计 `gitlab.sync`。控制台成员页的「GitLab」列显示这些状态和错误，能管理称号的人可以对有错或还有事要做的账号点「立即同步」。

控制台接口：`GET /api/console/gitlab/accounts`（`gitlab.view`）列出每个账号的 GitLab 用户名、状态、组权限、最后一次错误和还要做的事，`client_registered` 说明 `gitlab` 客户端登记了没有；`POST /api/console/gitlab/accounts/:account_id/resync`（`gitlab.sync` 加 step-up，每分钟 30 次）立即同步一个账号，同步关着时 409 `gitlab_sync_off`，客户端没登记时 200 带 `error: gitlab_client_missing`，sector 对不上时 200 带 `error: gitlab_sector_mismatch`。

门户项目读取与管理接口分开（GitLab #308）：`GET /api/me/gitlab/projects` 使用相同有效直接成员口径，在外部等待后重查资格；不需要 `gitlab.view`，不下发账号映射或管理字段。游客仍读公开接口；上游不可用不冒充空项目，返回最小项目 DTO 并 `no-store`。

### 防误封与失败闭合（GitHub #271）

本地 active 与有效直接 member/alumni 是资格权威，远端数字 id 只是缓存。`on` 每轮（包括本地记录已 blocked、计划为空时）读取 `/users/:id`，用既有 sector 的 **existing sub** 精确核对唯一的 `openid_connect` 绑定；同 provider 有多条绑定时拒绝，不因其中一条匹配而接管。不为已有映射补造 sub，不凭邮箱或用户名接管。详情必须含有效 id、用户名、active/blocked 状态、明确 is_admin 与 identities；管理员、bot、非 human 服务账号、保留用户名及绑定冲突对象拒绝一切写入。找身份时完整连续分页后才判断唯一或不存在，最多 10 页，跳页、循环、损坏或截断均不是“不存在”。

HTTP 失败、超时、429/5xx、详情不完整、身份失配与缺失 sub 均保留远端状态，记录 `gitlab_lookup_<状态码>`、`gitlab_unreachable`、`gitlab_user_incomplete`、`gitlab_identity_mismatch`、`gitlab_subject_missing`、`gitlab_user_protected`、`gitlab_lookup_incomplete`、`gitlab_identity_ambiguous` 或 `gitlab_pagination_incomplete`，恢复后重新核验。未管理账号不写入；完整证明失去资格的受管账号仍封禁，远端被手工解封后下一轮重新撤权，不能以“全部跳过”替代撤权。

每个远端写请求前重读本地 status/member/site_role；等待 HTTP 期间资格变化则在既有账号锁内最多重算两次，持续变化记 `gitlab_account_changed` 留待下轮。已发出的 block 不能撤回，本轮发现恢复后补偿 unblock；这不是分布式原子事务。锁只覆盖单实例；每个 GitLab 只能由对应环境写。双环境都 on 的前提是 API 目标、令牌、客户端和绑定已分别隔离，不能让两份名单共写同一实例。

下游贡献归属 `accountForGitlabUser()` 改为异步核验绑定后返回账号；未知 HTTP 向收集器报告错误，不把缓存 id 当成作者/审核人。详见接口行为契约的贡献收集段落。

## GitLab 一侧的配置

正式实例搬到正式入口的 `/gitlab`（#335，经 `gitlab-cutover` 的 `move-production-path`，见 [GitLab 运维合同](../../ops/GITLAB.md#搬到正式入口的-gitlab335)），旧主机只做 301；独立预发布位于已有预发布域名的 `/gitlab`。正式接管仍须完整保全旧 sector/sub、用户 ID 与成员资格：先排空旧预发布写者，再按稳定 provider+provider_uid 对账迁移，缺身份或冲突整批拒绝；开启正式同步并逐人核验后才切正式 issuer。独立预发布需要自己的客户端、回调、API令牌和新绑定，不能仅替换 URL 后复用旧 `gitlab_accounts`。旧预发布客户端与旧 sector 记录在正式改接完成前保留，不能为启动新实例先破坏现有登录链。初始化与运行验收是两件事，完整运维边界见 [GitLab 运维合同](../../ops/GITLAB.md#极客班统一登录oidc契约)。

```ruby
gitlab_rails['omniauth_enabled'] = true
gitlab_rails['omniauth_allow_single_sign_on'] = ['openid_connect']
gitlab_rails['omniauth_block_auto_created_users'] = false
gitlab_rails['omniauth_auto_sign_in_with_provider'] = 'openid_connect'
gitlab_rails['omniauth_sync_profile_from_provider'] = ['openid_connect']
gitlab_rails['omniauth_sync_profile_attributes'] = ['name']
gitlab_rails['omniauth_providers'] = [{
  name: 'openid_connect', label: '极客班统一登录',
  args: {
    name: 'openid_connect', scope: ['openid', 'profile', 'email'], response_type: 'code',
    issuer: 'https://yangtzeu.work/oidc', discovery: true, client_auth_method: 'basic', uid_field: 'sub', pkce: true,
    client_options: { identifier: 'gitlab', secret: File.read('/etc/gitlab/yzgc-oidc-secret').strip,
                      redirect_uri: File.read('/etc/gitlab/yzgc-gitlab-url').strip + '/users/auth/openid_connect/callback' },
  },
}]
```

回调读 GitLab 配置挂载里的 `yzgc-gitlab-url`（一行，等于本环境的 `GITLAB_URL`，搬家脚本写它）。自动跳转打开后 root 从 `/users/sign_in?auto_sign_in=false` 用密码登录。SSH 不对外开放，成员用 HTTPS 推拉代码时在 GitLab 的「访问令牌」里建个人令牌，当作密码用。

## 不做的事

- 不从 GitLab 往回同步任何东西；GitLab 上改的资料不回写极客班。
- 不删除 GitLab 用户；不管理 GitLab 组以外的项目权限。
- 不开放动态注册客户端，不做单点登出（退出极客班不会让 GitLab 退出，封禁由同步完成）。

## 测试

- GitHub #271 新回归：`tests/server/identity-eligibility.test.ts`、`tests/server/oidc-eligibility.test.ts` 和 `tests/server/public-profile-consumers.test.ts`。使用真实内存路由及合成下游验证资格到期、alumni/owner 30/50、两轮身份稳定与公开资料来源；不是已部署或真实 GitLab 已验收的证明。

- `tests/server/oidc.test.ts`：发现文档与 JWKS、没登录去 `/signin`、首次同意与记住同意、pairwise `sub`、授权码重放撤销授权、错回调与未知客户端不跳转、PKCE 缺失与错误、拒绝、同意接口只认发起登录的账号、换账号、`sid` 结束后重新登录、不再是成员、停用客户端、过期交互、没配密钥时 404、限流（服务器调用与浏览器跳转分开算）、同意页详情不缓存、回调地址校验与钉住 sector、GitLab 换到另一主机的路径后 `sub` 不变且旧回调去掉后不再被接受（#335）。
- `tests/server/gitlab-sync.test.ts`：用假的 GitLab 管理接口与 GitHub 公开资料核对建号、邮箱回退、用户名加后缀、封禁与解封、按身份沿用、没同步过就离开的按身份找到并封禁、立即同步与定时对账不同时做同一个账号、sector 取 `gitlab` 客户端、没登记客户端时不建号、不合法的网站不传、停下时结束这一轮、论坛资料优先、失败记录与重试、邮箱同步（noreply 邮箱、换掉占位地址、加和删其它邮箱、没确认的重加、被拒后重试、一直被拒时删掉的邮箱照样删、头像失败不耽误邮箱、没变时不调 GitLab）、`dry-run` 与 `off`、控制台两个接口、GitLab 在主站路径下时链接、API 基址与控制台跟着 `GITLAB_URL` 走而 `sub` 与 noreply 地址沿用旧 sector、sector 对不上时不调 GitLab（#335）、`GITLAB_*` 与 `OIDC_JWKS` 的配置校验。
- `tests/console/authorize.test.ts`：同意页的纯逻辑（交互编号、接口地址、登录回跳、文案）。

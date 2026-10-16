# ADR-0005：统一登录先在核心服务里扩展，不引入独立授权服务器

> 现阶段三端同源共用一个 `sid`，「统一登录」的实际缺口是第二身份源与将来的内部 Hub，不是缺一个身份提供方；先按 [ADR-0004](0004-forum-backend-in-core-server.md) 的同一思路在 `app/server` 里扩展，身份模型采用内部 OpenID 底座（[PR #229](https://github.com/Yangtze-University-Geek-Class/admin/pull/229)），GitHub 组织门槛不动。

状态：`proposed` · 更新：2026-10-16 · 依据：项目所有者 2026-10-16 00:22 的会话指令（按统一登录与比赛模块两条规划梳理 issue）；本方案由 #237 追踪，所有者确认后本行改为 `accepted`。

## 背景

**现在的事实**（全部来自当前 `stage` 的代码与文档，不是规划）：

- 全站只有一个登录：核心服务的 GitHub OAuth 回调（`app/server/src/routes/admin/auth.ts:44-79`）换到 token 后，用这个 token 查登录者自己的 `GET /user/memberships/orgs/{CONSOLE_ORG}`（`app/server/src/lib/github.ts:38-47`），只有 `active` 成员才签发 `sid`；`pending` 与非成员不建会话、审计 `auth.signin_denied`，并尽力撤销这次授权。
- 会话是 SQLite 里的 `sessions` 一行（`app/server/src/lib/db.ts:23-31`）：`id`、`login`、`user_id`（GitHub 数字 id）、`avatar_url`、`access_token_encrypted`、`created_at`、`expires_at`，没有外键（`user_id` 上只有 `idx_sessions_login`）。GitHub token 用 AES-256-GCM 加密（`app/server/src/lib/crypto.ts:12-27`），有效期 7 天（`app/server/src/lib/auth.ts` 的 `SESSION_TTL_MS`），没有轮换、没有滑动续期。
- 官网、论坛、控制台同域，共用这个 host-only `sid`（[ADR-0004](0004-forum-backend-in-core-server.md)、[ARCHITECTURE](../architecture/ARCHITECTURE.md)）；论坛没有自己的登录。
- **会话里的 GitHub token 不只是身份，还是管理操作的上游凭据**：14 个文件、36 处用 `req.session.accessToken` 调 GitHub（`routes/admin/repos.ts` 占 17 处，`routes/admin/auth.ts:103`、`middleware/require-capability.ts:15`、`middleware/require-org-role.ts:18`，邀请链接还会用**发起人**的 token，`routes/admin/invite-links.ts:48`）。控制台的 `github.*` 能力 = 称号给的能力 ∩ 这个 token 在组织里的角色上限（[SECURITY](../architecture/SECURITY.md)）。
- 库里**没有**通用身份表：只有论坛自己的 `forum_users`（`app/server/src/lib/db.ts:199-218`，id 形如 `m<github_user_id>`）；没有 `identities` / `identity_audit`；**没有迁移框架**，建表一律 `CREATE TABLE IF NOT EXISTS` + 启动幂等回填 + `console_seeds` 标记（`docs/services/server/data-model.md`）。
- 部署是一台 2 核 2 GB 的目标机、同机两套完整 Docker 栈（`/opt/yzgc/production`、`/opt/yzgc/preview`，[DEPLOY](../ops/DEPLOY.md)、[ENVIRONMENTS](../ops/ENVIRONMENTS.md)），单实例 SQLite + 命名卷，没有多实例协调（`docs/services/server/README.md`「已知限制」）。

**谁在等**：所有者 2026-10-16 00:22 把「统一登录（SSO）规划」列为两条待规划主线之一；[#229](https://github.com/Yangtze-University-Geek-Class/admin/pull/229)（内部 OpenID 底座）与 #228（绑定/解绑/合并接口）都以 `not planned` 关闭，等本方案决定是否沿用；#203 的 CLI 设备授权、以及将来的内部 Hub 与服务注册，都要先知道身份从哪里来。

**要回答的问题**：#237 正文列的五个——谁要 SSO、三种选型怎么选、身份模型是否采用 `users`/`identities`、现有会话与论坛账号怎么迁、拆出哪些实现 issue。

## 决策

1. **选型：继续在核心服务里扩展，不引入独立授权服务器，也不引入成品 IdP。** 阶段 1 只在 `app/server` 里做身份地基与第二上游，不新增容器、不新增数据库、不新增进程。
2. **身份模型采用内部 OpenID 底座**（#229 的方案）：`users`（内部 OpenID 为主键，随机 ULID，**绝不用自增或渠道 id**）+ `identities`（一个用户挂 N 条第三方凭据，`provider_uid` 用**不可变的 GitHub 数字 id**，`UNIQUE(provider, provider_uid)`）+ `identity_audit`（`link` / `unlink` / `login` / `merge` 留痕）。`sessions` 只加可空影子列 `openid` / `provider` 并**双写**，读写路径继续以旧列为准；表结构沿用 #229 已定稿的 DDL，不重新设计。
3. **准入门槛不动**：只有 `CONSOLE_ORG` 的 active 成员能建内部身份、能拿到会话；**不允许非组织成员建身份**（所有者 2026-10-14 已定）。顺序是先过组织门槛、再落内部身份与建会话，不是成员的人既没有会话也不留身份。
4. **第二上游只做绑定，不做建号**：微信（已定的第二渠道）的 OAuth 只给 `openid` / `unionid` / 昵称 / 头像，不给邮箱、不带组织身份，因此它**永远不能新建身份**，只能命中已绑定过微信的既有内部身份，否则拒绝并提示先用 GitHub 登录再绑定。QQ 不做：需要主体资质，服务器在境外且站点无国内备案（#237 正文）。
5. **控制台的 `github.*` 继续依赖会话里的用户 GitHub token**，不改成组织级 Bot / GitHub App 凭据。也就是说：**任何非 GitHub 身份登录的人，在控制台里都拿不到 `github.*`**，这是现实约束（36 处调用点），不是本次要解决的问题；改成应用级凭据会改变「控制台不能授予任何 GitHub 权力」这条既有安全口径（[SECURITY](../architecture/SECURITY.md)），属另一件事，需要单独授权。
6. **本次不接第二 provider、不做绑定/解绑/合并接口、不改现有登录准入、不动 #229 的分支**（#237 正文的「不做什么」）。它们进「拆分清单」，等本方案被确认后按依赖逐个建 issue。

## 考虑过的方案

三种选型按本项目的真实约束对比（资源是 2 核 2 GB 且同机两套栈；现状是单实例 SQLite、无迁移框架、三端同源）：

| 维度 | A. 自建授权服务器（node-oidc-provider） | B. 成品 IdP（Casdoor） | C. 继续扩展现有后端（**采用**） |
|---|---|---|---|
| 新增组件 | 新进程（可同容器），需实现 authorize / token / userinfo / jwks 与同意页、客户端注册表 | 新容器 + **自己的数据库**（MySQL/PostgreSQL）+ 管理界面 + 升级与密钥维护 | 无。仍是 `server` 一个容器 |
| 2C2G 上的代价 | 中：与 forum 的 Node ≥26 构建、两套栈共存时内存紧张 | 高：多一个 DB 与一个常驻 Go 进程，两套栈要各跑一份 | 低：只在已有进程里加表与路由 |
| 攻击面 | 新增一套 OAuth/OIDC 授权端点，都要自己做安全评审 | 依赖上游项目的默认配置与升级节奏，密钥与回调都在第三方界面里 | 复用已验证的签名 state、`return_to` 白名单、Origin 校验、会话模型 |
| 与现有 `sid` 的关系 | 要么把 `sid` 换成 OIDC 会话，要么做双轨（更复杂） | 同上，且要多维护一份用户目录 | 直接演进 `sessions`，官网/论坛/控制台零改动 |
| 与 GitHub token 的关系 | 不解决 36 处调用点 | 不解决 | 不解决（本次明确不解决） |
| 迁移成本 | 高：会话、论坛账号、控制台称号都要重新对账 | 最高：还要把本地身份导进第三方库 | 低：#229 已给出「建表 + 影子列 + 启动幂等回填 + 独立回滚脚本」的完整路径 |
| 现在有没有消费者 | 没有。三端同源，没有跨域单点登录的需求 | 同上 | — |
| 资质/备案 | 不涉及 | 不涉及 | 不涉及（QQ 的资质问题与选型无关，选哪个都做不了 QQ） |

**A/B 被否的真正理由不是技术差，而是现在没有「消费者」**：三端同源共用 `sid`，跨域或跨服务的单点登录今天不存在；内部 Hub 还停留在「目标结构，尚未完整实现」（[ARCHITECTURE](../architecture/ARCHITECTURE.md)）。在没有第二个 origin、第二个服务之前引入身份提供方，只会把 2C2G 的资源、升级面与安全评审面先花掉，换不到任何用户可见的东西——这正是 #226 与 #229 被关闭时给出的同一个理由。等 Hub 真的成为独立服务/独立 origin 时再评估 A（那时 OIDC 才有意义），见「重新评估的条件」。

**身份模型的取舍**：另有一种做法是「不动 `sessions`，直接再加一张渠道表」。被否：渠道表与 `sessions.login` 之间没有稳定主键可挂（`login` 可改、`user_id` 有的旧会话为空），迟早要补一次内部主键；#229 的「先双写影子列、不读」正是为了把这次切换拆成可回滚的两步。

## 后果

- **好处**：不增加任何常驻组件与数据库，2C2G 上的余量留给现有三端；身份切换可以分步、随时回滚（#229 的 `rollback-identity.mjs` 只清影子列与三张新表，旧列自始至终没动过）；`users`/`identities` 一旦落地，微信、将来的 Hub 与 CLI 设备授权都挂得上，不必再改一次身份模型。
- **代价**：核心服务继续承担认证职责，`app/server` 的职责面不再收窄；`sessions` 会带着两个只写不读的影子列跑一段时间（阶段 1 的正常中间态，不是遗漏）。
- **明确不做、也不因为本决策而改变**：非 GitHub 登录在控制台里拿不到 `github.*`（36 处用户 token 调用点）；不做 QQ；不做非组织成员注册；不引入迁移框架（沿用 `CREATE TABLE IF NOT EXISTS` + 幂等回填 + 独立回滚脚本）。
- **风险**：改动触及核心登录与会话，而阶段 1 没有用户可见收益——#229 正是因为这一点被暂缓。所以阶段 1 的验收必须是「行为零变化 + 影子列与身份表正确」的机器证明，不能放宽既有登录测试。

## 实施状态

**未实施。** 本 ADR 只产出方案：没有改任何 `app/` 代码，没有建表，没有接第二 provider，没有动 #229 的分支与 PR（`task/226/openid_identity` 原样保留）。`sessions.openid` / `provider` 两个影子列、`users` / `identities` / `identity_audit` 三张表在当前 `stage` 上都不存在。

**拆分清单**（#237 验收条件 3：每项要有痛点、方案、最终效果，且**由所有者逐个确认后才建 issue**）：

| 序 | 事项 | 依赖 | 内容概要 |
|---|---|---|---|
| 1 | 内部身份地基 | 无 | 痛点：`sessions` 直接以 GitHub 账号为主语，没有内部身份，渠道加不进来。方案：建 `users`/`identities`/`identity_audit` 三张表 + `sessions` 双写影子列 + 启动幂等回填 + 独立回滚脚本；登录成功后轮换 `sid`。最终效果：库里每个登录者都有一条随机内部 OpenID，影子列与新列一致，接口与页面行为零变化（即 #229 的内容，按本 ADR 重新提交）。 |
| 2 | 会话与授权改读内部身份 | 1 | 痛点：影子列只写不读，`sessions.login` 仍是唯一主语，改渠道要先登录。方案：读写路径逐步切到 `openid`，`login` 降为「当前 GitHub 登录名」这一条渠道属性；切完删影子列。最终效果：会话主语是内部 OpenID，换渠道不影响会话。 |
| 3 | 第二上游：微信 OAuth 绑定 | 1、2（**且需主体资质**） | 痛点：成员只有 GitHub 一条进路。方案：微信只做上游——已登录用户走绑定流程把微信挂到既有身份；微信登录只命中已绑定身份，新建一律拒绝。最终效果：绑过微信的成员能用微信登录，未绑定的人得到明确提示。**前置：微信开放平台备案审核；未通过前本项不启动。** |
| 4 | 绑定 / 解绑 / 合并接口与 step-up | 1、2 | 痛点：挂第三条渠道时没有任何管理入口，且解绑可能把人锁在门外。方案：`GET /api/identity/me`、`POST /api/identity/link|unlink|merge`；解绑前校验剩余可登录身份 ≥1；`provider_uid` 已被他人绑定时回 409 引导合并，不静默覆盖；合并要两边验证；解绑与合并限流；全程写 `identity_audit`（即 #228 的内容）。最终效果：成员能自助管理渠道，且不会把自己锁在门外。 |
| 5 | 内部 Hub / 跨服务 SSO | 1、2，且 Hub 先成为独立服务 | 痛点：现在三端同源，没有跨域登录需求；Hub 一旦独立，`sid` 的 host-only cookie 就带不过去。方案：先定 Hub 的部署形态，再决定是否用 OIDC（届时回到本 ADR 的「重新评估的条件」）。最终效果：Hub 与三端单点登录、单点登出。**本项现在不建**，等 Hub 立项。 |

## 重新评估的条件

出现下面任一条时回到本 ADR，重新评估是否引入 A（OIDC 授权服务器）或 B（成品 IdP）：

1. **出现第二个 origin 或第二个后勤服务**：内部 Hub、独立子域或独立服务上线，host-only `sid` 不再够用。
2. **需要非 GitHub 身份建号**：出现「没有 GitHub 账号也必须是成员」的真实场景（今天被所有者明确否掉）。
3. **控制台要脱离用户 GitHub token**：36 处用户 token 调用点改走应用级凭据时（那是一次安全模型变更，会同时改变 `github.*` 的裁决口径）。
4. **单实例假设被打破**：上多实例或迁 Postgres 时，会话与身份存储需要重新设计。
5. **第二个 provider 被要求独立完成认证**（而不是只做上游绑定）——那意味着平台要自己签发身份，选型 A/B 重新进入比较。

## 参考资料

- #237（本方案）：统一登录（SSO）规划：先定方案，再拆实现。
- PR #229（`task/226/openid_identity`，保留未合）：内部 OpenID 底座；本 ADR 采用它的三表 DDL、影子列双写与回滚脚本口径。
- #226（`not planned`）：身份底座；其决定记录「不允许非组织成员建内部身份」「第二渠道选微信，微信只能命中已绑定身份」是本 ADR 第 3、4 条的依据。
- #228（`not planned`）：绑定/解绑/合并与 step-up；进拆分清单第 4 项。
- #203（已关闭）：CLI 设备授权，将来挂在同一套身份上。
- [SECURITY](../architecture/SECURITY.md)「登录门槛」、[ADR-0004](0004-forum-backend-in-core-server.md)、[ARCHITECTURE](../architecture/ARCHITECTURE.md)「目标结构，尚未完整实现」。

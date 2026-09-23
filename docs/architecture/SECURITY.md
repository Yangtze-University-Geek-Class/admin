# 安全模型与防护边界

> 区分保留核心服务的真实安全边界与原仓论坛的浏览器演示；新论坛尚不具备生产安全条件。

状态：`current` · 更新：2026-09-24

## 核心服务

保留 portal/admin 的服务端 requireAuth、GitHub active membership 校验及按组织审计；极客班控制台另按能力授权（见下节）。GitHub token 用 AES-256-GCM 加密，密钥解码必须为 32 字节；sid 是服务器会话，不在浏览器状态中产生管理权限。OAuth state 签名并检查十分钟有效期，回跳来源使用允许列表。Cookie 的 HttpOnly/Secure/SameSite 和共享 Domain 均需按真实部署验证，不称为完整 CSRF 或子域隔离。

公开邀请/反馈/投递简历有限流、蜜罐、PoW 和可选 Turnstile。反馈摘要与管理员回复经 `GET /api/feedback/public` 匿名可读：只要给出组织名即可读取该组织非 `spam` 反馈的前 280 字、状态、回复和票数，不校验 `ALLOWED_ORGS`，`limit` 也没有下界校验（见 [API](API.md) 端点清单）；反馈正文因此按公开内容对待，用户指南已提示勿提交敏感信息。投递简历没有任何读取接口。邀请先预留额度、再请求上游，明确失败补偿、未知结果保留待核对，不把超时解释为未发送。写请求核对 Origin 与 Fetch Metadata，返回错误不打印 token 或完整上游响应。鉴权 API 禁止缓存。公开文档使用允许列表，不公开内部运维、安全、规范和审查内容。

## 极客班控制台：称号与能力

控制台 `/api/console/*` 在「GitHub 组织角色」之外，加了一层由班长维护的**称号 → 能力**授权。模型的唯一来源是 `app/server/src/lib/roles.ts`，判定在 `middleware/require-capability.ts`，端点与错误码见 [API](API.md)。

- **称号**：班长（CAPTAIN）、部门负责人（`{部门} · 负责人`，HEAD）、部门干事（`{部门} · 干事`，CREW）、领航员（NAVIGATOR，已毕业的学长学姐）、极客班成员（MEMBER，GitHub 组织 active 成员自动获得）、访客（GUEST）。一个人可有多个称号，主称号取 rank 最小者。显式指派存在 `role_assignments` 表；有显式领航员时不再自动派生成员称号。
- **部门**是数据（`departments` 表，默认 招新部 / 技术部 / 社区部 / 项目部），每个部门有负责人与干事两份**权限包**。新增部门不改代码；新增「能力」才需要改代码，因为能力必须有执行点。
- **能力**是扁平清单（`console.* github.* forum.* applications.* feedback.* audit.* roles.*`），取蕴含闭包（`*.manage` → `*.read`，任何 `github.*.manage` → `github.org.read`，`roles.manage` → `roles.department.manage`）。班长拥有全部能力（按清单动态计算）；`roles.manage` 仅班长持有，不能放进部门权限包（服务端拒绝，`captain_only_capability`）。
- **GitHub 上限**：GitHub 操作一律用会话里用户自己的 token，控制台**不能授予任何 GitHub 权力**。最终 `github.*` 能力 = 称号给的能力 ∩ 用户在 `CONSOLE_ORG` 的 GitHub 角色上限（admin：全部；member：只有 `github.org.read`；非成员：无）。被挡掉的能力放进 `blocked`（`github_admin_required` / `github_membership_required`）。非 GitHub 能力（投递、意见箱、审计、称号管理、论坛）不需要组织身份。
- **班长临时代任（bootstrap）**：没有显式 captain 行时，`CONSOLE_ORG` 的每一位 GitHub 组织 admin 都临时是班长（`source: "bootstrap"`，`bootstrap: true`），控制台显示横幅提醒尽快正式指定。一旦存在显式 captain 行，临时代任对所有人立刻失效；显式班长全站唯一（部分唯一索引 `uq_role_assignments_captain`），移交在单个事务里完成。captain 行只能由班长本人删除（删除后恢复临时代任）。
- **负责人范围**：`roles.department.manage` 只允许任免自己负责部门的干事，跨部门返回 403 `out_of_department_scope`。
- **失败语义**：GitHub 角色查询出错时交给 `http-policy` 统一映射（上游 4xx → `upstream_rejected`，5xx → `internal_error`），**不**当成「不是组织成员」，避免把临时代任的班长锁在外面。
- **审计**：控制台写操作、投递查看与导出一律以 `org = CONSOLE_ORG` 审计；审核备注只存在 `application_reviews`，不进审计。
- **旧接口不变**：`/api/admin/:org/*` 仍只由 GitHub 组织角色控制；论坛类能力目前只记录和展示，论坛没有服务端执行点。

**个人信息**：投递（姓名、班级、邮箱、特长）对所有持有 `applications.read` 的人完整可见；列表与详情不下发来源 IP 和 User-Agent。只有查看详情和导出会被审计，CSV 离开系统后无法追踪。

**残余风险**：GitHub 角色缓存 60 秒，撤销组织 admin 最长 60 秒后生效；临时代任期间所有组织 admin 都是班长，上线后应尽快正式指定；班长的 GitHub 账号丢失时，只能由授权运维直接删除 captain 行以恢复临时代任（尚未写进运维手册）；称号清单在论坛另有一份副本，一致性测试只覆盖默认部门，数据库里新增的部门论坛看不到；按钮显隐只是提示，授权只在服务端。

## 论坛代码替换的边界

旧 React/Fastify 论坛已退出活动构建，核心不打开 forum.db、不注册旧写接口、不创建 forum_sid。旧 API 返回 410，生产未接好服务时论坛入口返回 503。旧数据库和附件保持原样，不能以清理代码为名删数据。

采用的 Tuff Forum 当前只有 Pinia/localStorage 演示，任意示例账号选择不是认证，UI 权限 helper 不是服务器授权，CDP 观察浏览器存储不是数据库审计。页面有显式提醒，只绑定本机回环端口，不将其发布为生产内部论坛。核心真实 GitHub 会话绝不接受示例 user ID/role 赋权。本机快照模式通过 dev 专用、仅 GET/HEAD 的 `/api/local-forum/*` 只读提供投影：哈希白名单、目录逃逸检查、索引给定的类型与 disposition、大小核对、no-store、nosniff 和禁止脚本的 CSP，错误体只含机器码（dev 错误处理器仍会附带堆栈，因此这些路由不进生产）；前端固定游客、示例登录改为只读说明、论坛状态不写 localStorage。它没有增加任何认证或授权，投影含真实成员公开资料，只能在所有者授权范围内本机使用。

旧论坛的密码策略、上传重新编码、归档后端保护等实现已经随旧源码退役；这些不能继续被列为新论坛已具备的防护。未来接入真实后端时必须重新实现并验证身份、授权、内容净化、滥用防护、上传、计数/事务和审计，而不是仅打开新页面。

## 工具与供应链

上游 MIT 声明保留，固定源码提交及两个独立锁文件。论坛按其 pnpm 配置禁止自动安装 Electron peer，保留安装脚本允许列表。未自动注册 Cloudflare 或购买服务。

核心自动测试用内存库和模拟 GitHub；论坛测试使用确定性数据和新建浏览器 profile。浏览器工具仅关闭本次启动的进程组，禁止使用通用名称匹配结束用户浏览器。历史源码备份和运行缓存不进入版本控制。

## 发布和残余风险

**单一 origin 的代价**：每个环境只有一个域名（`PUBLIC_ORIGIN`），官网、管理端（`/admin`、`/console`）和论坛（`/forum`，上游 Nuxt 代码）同源。写请求的 Origin 校验与 `return_to` 只接受这一个 origin，旧管理端子域一律拒绝；但同源也意味着官网或论坛页面上的任何脚本注入都能带着 `sid`（host-only、`Path=/`）调用管理端接口，旧的「管理端独立域名」隔离不再存在。因此三端共用的 CSP（`script-src 'self'`，宿主 nginx 下发）与论坛/Markdown 的输出净化是管理端权限的直接防线，放宽其中任何一项都要按管理端风险评审。

两个环境（`main` → 正式栈、`stage` → 预发布栈）必须完全隔离：独立目录、独立 compose 项目、独立端口、独立命名卷、独立密钥、独立域名；Cookie 使用 host-only（不写 `Domain`），禁止 `.yangtzeu.work` 这种父域共享，预发布不得读取正式环境的会话或数据。密钥只经 CI/CD 从 GitHub 环境级 secrets 注入渲染后的运行时 `.env`，仓库模板里的密钥字段保持空值（见 [ENVIRONMENTS](../ops/ENVIRONMENTS.md)）。

真实统一认证、服务器角色、存储、内部 Hub、TLS、域名、Nginx、CSRF、OAuth Provider 和迁移恢复尚需完成；上游 Cloudflare PRD 只是提议。现有部署模板不等于已在目标机器应用。数据层仍是 SQLite + 命名卷，没有多实例隔离或多节点一致性验证；Postgres 迁移未做。没有完整依赖漏洞审计、WCAG/ASVS 认证或多实例验证。

旧部署文档曾暴露服务器登录凭据（原记录文件 `docs/ops/FORUM-SUBDOMAIN.md` 已随子域模型退役删除，事件记录保留在本节），已从当前工作区移除，但所有者仍需轮换并评估 Git 历史和传播副本。本轮不使用凭据、不擅自重写历史。check:secrets 只检查部分当前文本模式，不证明历史泄漏消失。

依据是当前代码、[forum 服务合同](../services/forum/README.md)、[采用决策](../decisions/0003-adopt-tuff-forum.md) 和 [官方参考范围](../conventions/REFERENCES.md)。

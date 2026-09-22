# 安全模型与防护边界

> 区分保留核心服务的真实安全边界与原仓论坛的浏览器演示；新论坛尚不具备生产安全条件。

状态：`current` · 更新：2026-09-13

## 核心服务

保留 portal/admin 的服务端 requireAuth、GitHub active membership 校验及按组织审计。GitHub token 用 AES-256-GCM 加密，密钥解码必须为 32 字节；sid 是服务器会话，不在浏览器状态中产生管理权限。OAuth state 签名并检查十分钟有效期，回跳来源使用允许列表。Cookie 的 HttpOnly/Secure/SameSite 和共享 Domain 均需按真实部署验证，不称为完整 CSRF 或子域隔离。

公开邀请/反馈有限流、蜜罐、PoW 和可选 Turnstile。邀请先预留额度、再请求上游，明确失败补偿、未知结果保留待核对，不把超时解释为未发送。写请求核对 Origin 与 Fetch Metadata，返回错误不打印 token 或完整上游响应。鉴权 API 禁止缓存。公开文档使用允许列表，不公开内部运维、安全、规范和审查内容。

## 论坛代码替换的边界

旧 React/Fastify 论坛已退出活动构建，核心不打开 forum.db、不注册旧写接口、不创建 forum_sid。旧 API 返回 410，生产未接好服务时论坛入口返回 503。旧数据库和附件保持原样，不能以清理代码为名删数据。

采用的 Tuff Forum 当前只有 Pinia/localStorage 演示，任意示例账号选择不是认证，UI 权限 helper 不是服务器授权，CDP 观察浏览器存储不是数据库审计。页面有显式提醒，只绑定本机回环端口，不将其发布为生产内部论坛。核心真实 GitHub 会话绝不接受示例 user ID/role 赋权。本机快照模式通过 dev 专用、仅 GET/HEAD 的 `/api/local-forum/*` 只读提供投影：哈希白名单、目录逃逸检查、索引给定的类型与 disposition、大小核对、no-store、nosniff 和禁止脚本的 CSP，错误体只含机器码（dev 错误处理器仍会附带堆栈，因此这些路由不进生产）；前端固定游客、示例登录改为只读说明、论坛状态不写 localStorage。它没有增加任何认证或授权，投影含真实成员公开资料，只能在所有者授权范围内本机使用。

旧论坛的密码策略、上传重新编码、归档后端保护等实现已经随旧源码退役；这些不能继续被列为新论坛已具备的防护。未来接入真实后端时必须重新实现并验证身份、授权、内容净化、滥用防护、上传、计数/事务和审计，而不是仅打开新页面。

## 工具与供应链

上游 MIT 声明保留，固定源码提交及两个独立锁文件。论坛按其 pnpm 配置禁止自动安装 Electron peer，保留安装脚本允许列表。未自动注册 Cloudflare 或购买服务。

核心自动测试用内存库和模拟 GitHub；论坛测试使用确定性数据和新建浏览器 profile。浏览器工具仅关闭本次启动的进程组，禁止使用通用名称匹配结束用户浏览器。历史源码备份和运行缓存不进入版本控制。

## 发布和残余风险

两个环境（`main` → 正式栈、`stage` → 预发布栈）必须完全隔离：独立目录、独立 compose 项目、独立端口、独立命名卷、独立密钥、独立域名；Cookie 使用 host-only（不写 `Domain`），禁止 `.yangtzeu.work` 这种父域共享，预发布不得读取正式环境的会话或数据。密钥只经 CI/CD 从 GitHub 环境级 secrets 注入渲染后的运行时 `.env`，仓库模板里的密钥字段保持空值（见 [ENVIRONMENTS](../ops/ENVIRONMENTS.md)）。

真实统一认证、服务器角色、存储、内部 Hub、TLS、域名、Nginx、CSRF、OAuth Provider 和迁移恢复尚需完成；上游 Cloudflare PRD 只是提议。现有部署模板不等于已在目标机器应用。数据层仍是 SQLite + 命名卷，没有多实例隔离或多节点一致性验证；Postgres 迁移未做。没有完整依赖漏洞审计、WCAG/ASVS 认证或多实例验证。

旧部署文档曾暴露服务器登录凭据（原记录文件 `docs/ops/FORUM-SUBDOMAIN.md` 已随子域模型退役删除，事件记录保留在本节），已从当前工作区移除，但所有者仍需轮换并评估 Git 历史和传播副本。本轮不使用凭据、不擅自重写历史。check:secrets 只检查部分当前文本模式，不证明历史泄漏消失。

依据是当前代码、[forum 服务合同](../services/forum/README.md)、[采用决策](../decisions/0003-adopt-tuff-forum.md) 和 [官方参考范围](../conventions/REFERENCES.md)。

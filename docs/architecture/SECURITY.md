# 安全模型

> 威胁模型 + 当前防护层。涉及限流、验证码、可能暴露的数据之前先读这篇；安全姿态变化时必须更新。
> English: [SECURITY.en.md](./SECURITY.en.md)

记录本项目的威胁模型 + 当前防护层。任何改动都要更新此文件。

---

## 威胁模型

我们认真应对：

1. **公开接口被脚本批量打爆**（注册大量 spam invitation / spam feedback）
2. **OAuth token 被未授权读出**（数据库泄漏 / 服务器被入侵后的纵深防御）
3. **未授权 user 拿到 admin API 数据**（横向越权 / 角色提升）
4. **XSS / clickjacking / CSRF 攻击**
5. **session 劫持 / replay**
6. **Cloudflare Turnstile 被绕过**（自动化 captcha solver）

我们不重点应对：

- 国家级 APT 渗透
- 物理服务器接管
- 内部 admin 滥用权限（信任 GitHub 的 admin 角色）

---

## 当前防护层

### 1. 公开接口反滥用

每个公开 POST 接口（`/api/feedback`、`/api/join/:token`）通过 `server/src/middleware/pow.ts` 的 `preflightPublicSubmission()`：

#### 1.1 IP 频率限制
- `/api/feedback`：10 次/分钟
- `/api/join/:token`：5 次/分钟
- 实现：`@fastify/rate-limit`

#### 1.2 Honeypot 蜜罐字段
- 表单内有 `<input name="website">`，CSS 隐藏到屏幕外，`tabIndex={-1}`，`aria-hidden="true"`
- 真人看不见、不会填；自动表单填写脚本会填
- 服务端检查到此字段非空直接 400

#### 1.3 Proof-of-Work 工作量证明
- 客户端在每次提交前算 SHA-256：`sha256("${timestamp}:${bodyHash}:${nonce}")` 必须以 N 个 `0` 开头
- `POW_DIFFICULTY` 默认 3（16^3=4096 次期望哈希，秒级完成，低端机也可接受）
- 服务端校验：时钟漂移 ±5 分钟内、nonce 合法、hash 前缀真的是 N 个 0
- 攻击者要批量发请求必须为每条付出 CPU；调高难度指数级放大成本
- 可调高到 4/5（各 10x 更难）或维持 3，通过 `.env` 的 `POW_DIFFICULTY` 控制

#### 1.4 Cloudflare Turnstile（可选）
- 配 `TURNSTILE_SITE_KEY` + `TURNSTILE_SECRET_KEY` 启用
- 在 PoW 之上额外一层；CF 自适应分析比纯 PoW 难绕过
- 真人无感（绝大多数零交互通过），自动化要付出大量精力

#### 1.5 内容校验
- 长度 5-5000 字
- GitHub username 必须匹配 `^[a-zA-Z0-9](?:[a-zA-Z0-9]|-(?=[a-zA-Z0-9])){0,38}$`
- 邮箱必须匹配标准正则
- 备注 ≤ 280 字

### 2. OAuth token 保护

#### 2.1 落库加密
- `server/src/lib/crypto.ts` 用 AES-256-GCM（12 字节随机 IV，16 字节 auth tag）
- `ENCRYPTION_KEY` 必须 base64 解出 32 字节
- 加密对象：`sessions.access_token`、`invite_links.created_by_token`
- 服务器被入侵且攻击者读到 SQLite 文件，但拿不到 `.env` 里的 `ENCRYPTION_KEY`，token 仍不可用

#### 2.2 Session cookie 强化
- `httpOnly: true` — JS 不可读
- `secure: true` — 只走 HTTPS
- `sameSite: "lax"` — 防 CSRF
- 7 天 TTL，过期自动清理
- 服务器侧也有 session 记录（不是纯 JWT），可强制失效

#### 2.3 OAuth state 校验
- `/auth/github` 生成随机 state + return_to 写入 `oauth_state` cookie
- callback 时严格比对，防止 OAuth callback injection

### 3. 权限校验

#### 3.1 双层 preHandler
- `requireAuth` — session cookie 必须有效，加密 token 必须能解密
- `requireOrgRole("admin"|"member")` — 用 session token 调 `GET /orgs/{org}/memberships/{login}` 实时拿角色
- 不缓存权限，GitHub 端的实时角色就是真相

#### 3.2 user-token 模型
- 所有 admin API 调用都用**登录用户自己的** OAuth token
- 即便我们后端代码有 bug 越权，GitHub API 也会用真实权限拒绝
- 唯一例外：公开 invite-link 用 admin 加密存的 token（仅限发 invitation 这一次性动作）

### 4. 浏览器侧防护（nginx response headers）

#### 4.1 HSTS
`Strict-Transport-Security: max-age=63072000; includeSubDomains` — 2 年内强制 HTTPS

#### 4.2 CSP（Content Security Policy）
```
default-src 'self';
script-src 'self' https://challenges.cloudflare.com;
style-src 'self' 'unsafe-inline';
img-src 'self' data: https://avatars.githubusercontent.com https://*.githubusercontent.com;
font-src 'self' data:;
connect-src 'self' https://challenges.cloudflare.com;
frame-src https://challenges.cloudflare.com;
frame-ancestors 'none';
base-uri 'self';
form-action 'self' https://github.com
```
注入的 `<script>` 不会执行；iframe 嵌入被禁止。

#### 4.3 其它
- `X-Frame-Options: DENY` — 防 clickjacking
- `X-Content-Type-Options: nosniff` — 防 MIME sniff
- `Referrer-Policy: strict-origin-when-cross-origin` — 减少 referer 泄漏
- `Permissions-Policy: geolocation=(), camera=(), microphone=(), payment=(), usb=()` — 禁用未用 API
- `Cross-Origin-Opener-Policy: same-origin` — 隔离 `window.opener`

### 5. 服务端代码侧

- 没有 `eval` / `Function(...)` / `dangerouslySetInnerHTML`
- 所有 SQL 用 better-sqlite3 prepared statement（不拼接）
- Octokit 自动处理 URL 编码
- `client_max_body_size 1m` — 防超大 body DoS

---

## 已知不防护的攻击面

- **GitHub 自身被攻破**：超出我们的控制
- **OAuth App secret 泄漏**：会被立即吊销并重发；secret 只在 `.env`（chmod 600）
- **服务器 root 被入侵**：超出应用层控制，依赖系统加固 + 备份
- **Cloudflare Turnstile 0day**：依赖 CF 团队修

---

## 调试 / 关闭防护

| 想做什么 | 怎么做 |
|---|---|
| 临时关闭 PoW（本地开发） | `POW_DIFFICULTY=0` 设到 `.env` |
| 调高 PoW 难度 | `POW_DIFFICULTY=6`（10 倍 CPU 成本） |
| 开启 Turnstile | 设 `TURNSTILE_SITE_KEY` + `TURNSTILE_SECRET_KEY` |
| 关闭 Turnstile | 把上面两个清空 |
| 查看公开接口的失败原因 | 看 `audit_logs` 里 `invite.failed` / `feedback.submit` 的 details JSON |
| 看请求是不是被 honeypot 拦了 | 服务端日志会有 "请求被拒绝" |

---

## 已加固的不变式

- OAuth token 必须 AES-256-GCM 加密落库（never plaintext）
- 公开 POST 必须经过 PoW + honeypot
- admin API 必须双 preHandler（requireAuth + requireOrgRole）
- audit_logs 不出现在任何公开响应里
- session cookie 必须 httpOnly + secure + sameSite=lax
- 改动 OAuth scope / encryption key 视为重大事件

---

## 报告漏洞

私下联系 `Yangtze-University-Geek-Class` 组织 owner（GitHub login: Crosery）。

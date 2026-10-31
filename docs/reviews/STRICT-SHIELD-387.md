# #387 严格防护与动态来源白名单：贡献与审查交接

状态：待独立审查 · 未提交 · 未推送 · 未创建 MR · 未部署

- 任务：GitLab issue `#387`
- 分支：`task/387/strict_shield`
- Worktree：`.claude/worktrees/task-387`
- 基线：`gitlab/stage d0c1ece932fd`
- 实现者：OMP `gpt-6-astra`
- 目标：在现有 `/console/security` 页面增加严格防护、动态 IP/CIDR 白名单和安全策略控制，不启用生产策略，不实现 L3/L4 DDoS 清洗。

## 1. 贡献范围

### 1.1 控制台页面

所有新增控制项都在 `app/console/src/pages/Security.vue`：

- 「快速防护」：严格模式开关、短窗口秒数、触发分、基础防护状态、白名单数量、策略版本。
- 「放行白名单」：添加和删除 IPv4、IPv6、单地址 CIDR、网段 CIDR；使用 Tuffex `TxForm`、`TxInput`、`TxButton`、`TxDataTable`、`TxEmptyState`、`TxStatusBadge`、`TxSwitch`。
- 保留原有合成蜜罐、当前封禁和最近蜜罐命中卡片。
- 失败状态显示 `ErrorAlert` / `ErrorPanel`；加载失败不会伪装成“已关闭”。
- 严格模式默认关闭；基础防护关闭时开关禁用。

### 1.2 服务端接口

| 方法 | 路径 | 权限 | 作用 |
|---|---|---|---|
| `GET` | `/api/console/security/policy` | `security.manage` | 读取严格策略、版本、基础防护状态和白名单数量 |
| `PUT` | `/api/console/security/policy` | `security.manage` + step-up | 更新严格模式参数，必须携带当前 `version` |
| `GET` | `/api/console/security/allowlist` | `security.manage` | 读取已启用白名单，管理员接口才返回规范化 CIDR |
| `POST` | `/api/console/security/allowlist` | `security.manage` + step-up | 添加白名单，必须携带当前 `version` |
| `DELETE` | `/api/console/security/allowlist/:id` | `security.manage` + step-up | 删除白名单，body 为 `{ confirm: true, version }` |

所有写接口继续经过 Origin / Fetch Metadata 门禁。写入与对应 `activity_events` 审计在同一个 SQLite immediate transaction 中完成。

### 1.3 数据保护

新增 `security_ip_allowlist`：

- `cidr_encrypted`：使用现有 `ENCRYPTION_KEY` 的 AES-GCM 保存完整规范化 CIDR。
- `cidr_hash`：使用 HMAC-SHA256，仅用于去重和唯一约束，不可反推出完整 CIDR。
- `note`：最多 160 字。
- `created_by`、时间戳和 `enabled`：用于管理员展示与审计关联。
- 不把完整 IP/CIDR 写进安全变更审计的 `meta`。

运行策略写入加密的 `app_state.security_runtime_policy`，默认值：

```json
{
  "strict_mode": false,
  "strict_threshold": 20,
  "strict_window_seconds": 15,
  "version": 0
}
```

## 2. 核心行为

### 2.1 严格防护

`app/server/src/lib/shield.ts` 在现有普通评分逻辑之外增加短窗口评分：

1. 请求信号先正常写入 `shield_signals`。
2. 严格模式开启时，在 `strict_window_seconds` 内累计分值。
3. `strictTotal >= strict_threshold` 时，直接进入已有临时 IP 封禁，原因是 `strict_burst`。
4. 不生成挑战，不进入无限排队，不改变业务权限。
5. 普通 `SHIELD_THRESHOLD` 逻辑仍保留。

### 2.2 动态白名单

- 静态环境变量 `SHIELD_ALLOWLIST` 与数据库白名单取 OR。
- 白名单动态影响 server shield 的检查、计分、封禁和蜜罐处理。
- 白名单不授予登录、管理或任何业务权限。
- IPv4 / IPv6 规范化后检查重叠网段；重叠返回 `409 allowlist_overlap`。
- 非法地址或前缀返回 400。
- 当前**不会**动态修改 web nginx 的普通 `limit_req` 桶；不能把本功能描述为边缘层全链路白名单。

### 2.3 并发版本

策略和白名单共用一个单调 `version`：

- 策略更新：校验当前版本，成功后版本 +1。
- 白名单新增：校验当前版本，成功后版本 +1。
- 白名单删除：校验当前版本，成功后版本 +1，并返回新的版本。
- 版本不匹配统一返回 `409 security_policy_conflict`。
- 路由使用 immediate transaction，在读取版本和写入之间持有 SQLite 写锁。

### 2.4 失败关闭与缓存

`app/server/src/lib/security-policy.ts` 的变更方法：

- 不把未提交的运行策略或白名单写入长期缓存。
- 数据库变更后只失效运行策略 / 白名单缓存。
- 审计失败导致事务回滚后，下一次读取从数据库重建旧状态。
- 白名单匹配缓存不会在审计失败后继续暴露已回滚的条目。

## 3. 关键文件

### 服务端

- `app/server/src/lib/security-policy.ts`
  - CIDR 解析、IPv4 / IPv6 规范化、范围重叠判断、加密存储、版本和缓存。
- `app/server/src/lib/shield.ts`
  - 严格短窗口评分、`strict_burst` 封禁、动态白名单回调。
- `app/server/src/lib/db.ts`
  - `security_ip_allowlist` 表。
- `app/server/src/services.ts`
  - 注入 `securityPolicy`，接入 shield。
- `app/server/src/routes/console/security.ts`
  - 权限、step-up、事务和审计。
- `app/server/src/routes/console/contracts.ts`
  - 请求、响应和失败体 Schema。

### 控制台

- `app/console/src/pages/Security.vue`
- `app/console/src/lib/types.ts`
- `app/console/src/mock/console.ts`
- `tests/console/security.test.ts`

### 回归与文档

- `tests/server/abuse-shield.test.ts`
- `tests/server/legacy-database.test.ts`
- `docs/changes/387.json`
- `docs/architecture/API.md`
- `docs/architecture/SECURITY.md`
- `docs/services/server/README.md`
- `docs/services/server/endpoint-contracts.md`
- `docs/services/console/README.md`
- `notes/2026-10-31/crosery/task_387_strict_shield.md`

## 4. 审查重点

请独立复核以下项目，不要只看类型检查结果：

1. `securityPolicy.setRuntime()`、`add()`、`remove()` 是否都在事务锁内校验版本。
2. 审计触发异常时，`app_state`、白名单表、缓存和响应是否保持旧状态。
3. IPv4、IPv6、单地址、`/0`、边界前缀和重叠网段是否没有绕过判断。
4. 完整 CIDR 是否只在管理员响应中出现，数据库、审计和错误信息是否避免泄露不必要的原始地址。
5. 动态白名单是否只影响 server shield，而没有误授业务权限或错误宣称 nginx / DDoS 能力。
6. 严格模式是否保持默认关闭，基础防护关闭时是否拒绝开启。
7. 所有新增写接口是否同时具备权限、step-up、Origin / Fetch Metadata 和审计。
8. 控制台策略读取失败时是否不会把错误状态渲染成“关闭”。
9. mock 合法写请求是否仍然返回 `501 mock_read_only`，没有伪造成功。
10. 回滚旧镜像时，新表和加密策略是否不会破坏旧代码启动；恢复新代码后数据仍可消费。

## 5. 已执行验证

以下结果来自当前 worktree 的真实执行：

```text
pnpm typecheck                         PASS
pnpm build                             PASS
pnpm check:catalog                     PASS
pnpm exec vitest run \
  tests/console/security.test.ts \
  tests/server/abuse-shield.test.ts \
  --maxWorkers=2                       PASS · 2 files · 24 tests
pnpm exec vitest run \
  tests/server/abuse-shield.test.ts \
  tests/server/legacy-database.test.ts \
  --maxWorkers=2                       PASS · 2 files · 31 tests
check-doc-sync                         PASS · 8 groups
check-architecture                     PASS · 26 files · 110 nodes
git diff --check                      PASS
```

隔离 mock 浏览器已真实打开 `/console/security`，观察到快速防护、放行白名单、合成蜜罐、当前封禁和最近蜜罐命中卡片；无页面错误。临时预览服务和浏览器标签页已关闭。

## 6. 未包含内容与合并边界

本贡献没有：

- 提交、推送、创建 MR、移动或删除 tag。
- 部署到预发布或生产。
- 开启生产严格策略。
- 修改生产数据或复制跨环境数据。
- 接入外部 WAF、ASN 信誉、L3/L4 清洗或公网 DDoS 服务。
- 修改 web nginx 动态限流配置。

建议审查顺序：先审 `security-policy.ts` 和 `security.ts` 的事务 / 版本语义，再审 `shield.ts` 的信号路径，最后审页面、mock、测试和文档一致性。审查通过后由有权限的 AI 按仓库既有流程提交到 `task/387/strict_shield`，创建 MR 合入 `stage`；当前 worktree 不应直接部署或合并到 `main`。

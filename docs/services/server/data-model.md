# Server 数据模型（data.db）

> data.db 每张表的用途、写入方、读取方和个人信息字段，以及当前没有消费者的表、列和索引；表结构以 `app/server/src/lib/db.ts` 为唯一来源。

状态：`current` · 更新：2026-09-25 · 源码：`app/server/src/lib/db.ts` · 上级合同：[server](README.md)

## 约定

- 2026-09-23 控制台只新增了 `departments`、`role_assignments`、`application_reviews` 三张表和 `idx_applications_status_created` 等索引，没有 `ALTER` 任何已有表。
- 存储是 SQLite（better-sqlite3，WAL，`foreign_keys = ON`）。`DB_PATH` 指向命名卷里的文件，容器内为 `/data/data.db`；Postgres 迁移没有做。
- `createDatabase` 在启动时执行 `CREATE TABLE/INDEX IF NOT EXISTS`。没有迁移框架，也没有 schema 版本记录：修改 `CREATE` 语句不会改动已有库的结构。
- 所有 `*_at` 列都是 `Date.now()` 毫秒时间戳。
- 本文只记录表级事实和关键字段名，列类型与约束以 `db.ts` 为准。改表时同步修改本文。

## 表

| 表 | 用途 | 写入方 | 读取方 | 敏感字段与备注 |
|---|---|---|---|---|
| `sessions` | 服务器会话（`sid`） | `lib/auth.ts`：登录时创建，登出或读取时发现过期即删除 | `lib/auth.ts`：只按 `id` 查询 | `access_token_encrypted`（AES-256-GCM 加密的 GitHub token） |
| `invite_links` | 邀请链接（能力令牌） | admin `invite-links.ts`（创建、禁用、删除）；`lib/invite-reservation.ts`（预留和补偿 `current_uses`） | portal `join.ts`；admin `invite-links.ts`、`overview.ts` | `created_by_token_encrypted`（发起人加密 token） |
| `invite_attempts` | 按「链接 + 标准化收件人」记录的邀请尝试，状态为 `reserved` / `sent` / `failed` / `unknown` | `lib/invite-reservation.ts`；portal `join.ts`（标记 `sent`） | `lib/invite-reservation.ts`（重试时复用结果） | `UNIQUE(token, recipient)` |
| `invitations` | 邀请发送记录 | portal `join.ts` | admin `invitations.ts`、`overview.ts` | 收件人 GitHub 用户名或邮箱、`source_ip`、`user_agent` |
| `feedback` | 意见反馈 | portal `POST /api/feedback`；admin `feedback.ts`（处理、回复、删除） | admin `feedback.ts`；portal `GET /api/feedback/public`（匿名可读） | `contact`、`source_ip`、`user_agent`。匿名接口只返回 `id`、`category`、`content`（截到前 280 字）、`status`、`reply`、`votes`、`created_at`、`replied_at`，见 [API](../../architecture/API.md) |
| `applications` | 加入我们投递 | portal `POST /api/portal/apply`；控制台 `PATCH /api/console/applications/:application_id`（只改 `status`） | 控制台 `GET /api/console/applications*`（需 `applications.read`；导出需 `applications.export`） | `name`、`class_name`、`email`、`strengths`、`source_ip`、`user_agent`，全部属于候选人个人信息；控制台不下发 `source_ip` 与 `user_agent`。`status` 取值 `received`（默认）/ `reviewing` / `interview` / `accepted` / `rejected` |
| `application_reviews` | 投递审核历史（追加式，避免 `ALTER TABLE applications`） | 控制台 `PATCH /api/console/applications/:application_id`，与状态更新同一事务 | 控制台投递列表（`last_review`）与详情（`reviews`） | `note` ≤2000 字，属于候选人相关信息，不写进审计；外键 `ON DELETE CASCADE` |
| `departments` | 部门与两份权限包（队长 / 舰员） | `lib/role-store.ts`：启动时 `INSERT OR IGNORE` 写入 4 个默认部门（已改过的不覆盖）；控制台 `POST/PATCH /api/console/departments` | `lib/access.ts`（计算能力）；控制台 `GET /api/console/departments` | 无个人信息。`head_capabilities` / `member_capabilities` 是 JSON 数组，只含可下放的能力；`archived=1` 的部门不再授予称号 |
| `role_assignments` | 显式称号指派（captain / head / member / alumni） | 控制台 `POST/DELETE /api/console/assignments` | `lib/access.ts`（按 `github_user_id`，或尚无 id 时按小写 `github_login` 匹配）；控制台 `GET /api/console/assignments` | `github_login`（小写）、`github_user_id`、`note`（≤200 字）、`granted_by`。`UNIQUE(github_login, role, department_id)`；部分唯一索引 `uq_role_assignments_captain` 保证显式舰长唯一 |
| `audit_logs` | 审计记录 | `storage.audit()`，各路由调用；控制台写操作与投递查看/导出以 `org = CONSOLE_ORG` 写入 | admin `GET /api/admin/:org/logs`，只返回 `org = :org` 的行；控制台 `GET /api/console/audit`，只返回 `org = CONSOLE_ORG` 的行 | `ip` 列记录来源 IP。`org` 为空的记录（登录 `auth.signin`、被拒的登录 `auth.signin_denied`、登出、加入我们投递）不会通过任何接口返回；`auth.signin_denied` 的 details 是 `{ org, reason }` |
| `app_state` | 键值状态 | 无 | 无 | 未使用，见下节 |

## 未使用的表、列和索引

下列对象由 `db.ts` 创建，但当前代码没有消费者。在出现消费者之前，不能把它们写成已有能力。

- `app_state` 表：`src` 中没有任何读写，按预留处理（例如以后存 schema 版本）。
- `feedback.votes` 列：没有写入路径，值恒为默认的 0，只被 `GET /api/feedback/public` 原样返回。
- `idx_sessions_login` 索引：会话只按 `id` 查询和删除，没有按 `login` 的查询。
- `idx_applications_email` 索引：没有按邮箱查询 `applications` 的代码，可以视为给将来去重预留。

删除这些对象属于代码和数据库变更，要另开 issue。只删 `CREATE INDEX` 语句不会移除已有库里的索引。

## 验证

```bash
grep -rn "app_state\|votes\|idx_sessions_login\|idx_applications_email" app/server/src   # 核对「未使用」结论
pnpm test                                                                                   # 真实路由 + 内存 data.db
```

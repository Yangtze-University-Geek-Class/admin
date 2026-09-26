# Server 数据模型（data.db）

> data.db 每张表的用途、写入方、读取方和个人信息字段，以及当前没有消费者的表、列和索引；表结构以 `app/server/src/lib/db.ts` 为唯一来源。

状态：`current` · 更新：2026-09-26 · 源码：`app/server/src/lib/db.ts` · 上级合同：[server](README.md)

## 约定

- 2026-09-23 控制台只新增了 `departments`、`role_assignments`、`application_reviews` 三张表和 `idx_applications_status_created` 等索引，没有 `ALTER` 任何已有表。2026-09-25（#56）再新增 `titles` 与 `console_seeds` 两张表，同样不改已有表。2026-09-26（#57，[ADR-0004](../../decisions/0004-forum-backend-in-core-server.md)）新增论坛的 12 张 `forum_*` 表，也不改已有表。
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
| `departments` | 部门与两份权限包（队长 / 舰员） | `lib/role-store.ts`：第一次启动写入 4 个默认部门（`console_seeds` 标记之后不再写）；控制台 `POST/PATCH/DELETE /api/console/departments` | `lib/access.ts`（计算能力）；控制台 `GET /api/console/departments` | 无个人信息。`head_capabilities` / `member_capabilities` 是 JSON 数组，只含可下放的能力；`archived=1` 的部门不再授予称号 |
| `titles` | 称号设置：六个固定 id（admin / captain / head / member / alumni / guest）各一行的名字、英文标签、图标、色调、说明与权限包 | `lib/role-store.ts`：启动时 `INSERT OR IGNORE` 写入代码里的默认值，之后以库为准；控制台 `PATCH /api/console/titles/:title_id` | `lib/access.ts`（计算能力）、控制台 `GET /api/console/catalogue`、匿名 `GET /api/public/org`（不含权限包） | 无个人信息。`capabilities` 是 JSON 数组；admin 读出时永远是全部能力、guest 永远为空，库里存了什么都不算；`updated_by` 是最后修改人的登录名 |
| `console_seeds` | 一次性播种的标记（目前只有 `departments`） | `lib/role-store.ts`：第一次启动写默认部门后记下；上线前已有部门的库只补记标记 | `lib/role-store.ts` | 无个人信息。有这条标记后不再写默认部门，控制台删掉的默认部门重启后不会复活 |
| `role_assignments` | 显式称号指派（captain / head / member / alumni） | 控制台 `POST/DELETE /api/console/assignments` | `lib/access.ts`（按 `github_user_id`，或尚无 id 时按小写 `github_login` 匹配）；控制台 `GET /api/console/assignments` | `github_login`（小写）、`github_user_id`、`note`（≤200 字）、`granted_by`。`UNIQUE(github_login, role, department_id)`；部分唯一索引 `uq_role_assignments_captain` 保证显式舰长唯一 |
| `audit_logs` | 审计记录 | `storage.audit()`，各路由调用；控制台写操作与投递查看/导出、论坛版务（`forum.post.edit` / `forum.post.delete` 动他人帖子，`forum.topic.pin` / `forum.topic.close`，details 不含正文）以 `org = CONSOLE_ORG` 写入 | admin `GET /api/admin/:org/logs`，只返回 `org = :org` 的行；控制台 `GET /api/console/audit`，只返回 `org = CONSOLE_ORG` 的行 | `ip` 列记录来源 IP。`org` 为空的记录（登录 `auth.signin`、被拒的登录 `auth.signin_denied`、登出、加入我们投递）不会通过任何接口返回；`auth.signin_denied` 的 details 是 `{ org, reason }` |
| `app_state` | 键值状态 | 无 | 无 | 未使用，见下节 |

### 论坛（`forum_*`，#57）

论坛的编号都是字符串，与论坛前端的 `ForumState` 一致：话题 `t<n>`（旧帖沿用旧编号、都小于 1000，新话题从 `t1001` 起）、帖子 `p<n>`（从 `p10001` 起；旧帖首帖是 `body-<n>`）、成员 `m<GitHub user_id>`、游客 `g<n>`、官方账号 `u-geekclass`、通知 `n<n>`、用户建的标签 `tag-<n>`。新编号只从 `forum_counters` 取。分类和精选标签不入库，来自 `app/forum/content/curation.json`。写入方都是 `lib/forum-store.ts`（由 `routes/forum-api/*` 调用），读取方是它的 `state()`（整份论坛状态）与各路由的存在性检查，下表只写表特有的部分。

| 表 | 用途 | 写入时机 | 读取与下发 | 个人信息与备注 |
|---|---|---|---|---|
| `forum_counters` | 五个计数器 `topic`、`post`、`notification`、`tag`、`guest` | 启动播种时 `INSERT OR IGNORE` 起点（1000、10000、0、0、0）；每次取新编号加一 | `state.counters`（不含 `guest`） | 无 |
| `forum_users` | 论坛用户：成员、游客、官方账号 | 成员第一次带 `sid` 请求时建，之后每次请求刷新 `role`、`title`、`github_avatar_url`、GitHub 改名后的 `username`；账号资料接口改 `display_name`、`bio`、`location`、`website`、`notify_*`；头像接口改 `avatar_hash`；每条游客回复建一个游客；播种建官方账号 | `state.users`（全部下发，不含 `github_user_id`、`updated_at`；`notify_*` 只给本人真实值，别人的给初始值） | `github_user_id`（`UNIQUE`）、`username`（GitHub 登录名，`UNIQUE COLLATE NOCASE`）、`display_name`、`bio`、`location`、`website`、`github_avatar_url` 都是个人信息，除 `github_user_id` 外公开展示。游客的昵称由游客自己填，不能含看不见的字符，归一后（NFKC、去掉看不见的字符与附加符号、不分大小写）不能与成员或官方账号的昵称、用户名相同，也不能是 `role_assignments.github_login` 里的登录名；成员的 `display_name` 同样不能含这些字符，也不能等于官方账号的名字或别人的用户名 |
| `forum_topics` | 话题 | 播种（没有才插入）；成员发帖；回复刷新 `last_activity_at`；浏览数；置顶、关闭 | `state.topics` | `tag_ids` 是 JSON 数组；`category_id` 只能是 curation.json 里的分类 |
| `forum_posts` | 帖子（话题首帖和回复） | 播种首帖；发帖、回复；编辑写 `edited_at`；软删除把 `deleted` 置 1 并清空 `content` | `state.posts` | `content` 是用户写的 Markdown，原样存储，渲染时由前端净化 |
| `forum_likes` | 点赞 | 点赞切换 | `state.posts[].likeUserIds` | 无 |
| `forum_bookmarks` | 收藏 | 收藏切换 | `state.bookmarks`，只下发看的人自己的 | 无 |
| `forum_follows` | 关注 | 关注切换；`CHECK` 不能关注自己 | `state.follows`，全部下发 | 无 |
| `forum_notifications` | 通知：回复、@提及、点赞、关注 | 回复、发帖、点赞、关注时按规则写（只写给成员，不给自己）；标记已读 | `state.notifications`，只下发收件人自己的 | 无 |
| `forum_tags` | 用户发帖时新建的标签 | 发帖时按名字找不到已有标签才建 | `state.tags`（接在精选标签后） | `created_by` 是论坛用户 id |
| `forum_avatars` | 上传的头像（256×256 WebP 的 BLOB），按内容 sha256 寻址 | 上传头像；换掉或删掉后没人引用的旧图同一事务删除 | `GET /api/forum/avatars/<hash>.webp` | 头像是用户上传的图片，公开可读；重新编码后不含原图元数据 |
| `forum_topic_views` | 浏览数去重：同一 IP 同一话题一小时一次 | 浏览接口；每次写入前删掉一小时以前的行 | 只在浏览接口里查 | `ip` 是来源 IP（IPv6 存 /64 前缀），最多保留一小时 |
| `forum_rate_events` | 限流记录：游客回复（`guestPost` 按 IP，IPv6 按 /64；`guestPostSite` 是全站游客回复总量，`subject` 固定为 `site`）、成员发帖与回复（按论坛用户 id）、头像上传（按论坛用户 id） | 游客回复、发帖、回复在动作成功后写一行，头像在读请求体之前就写（每次上传都算）；每次写入前删掉一天以前的行 | 只在限流判断里查 | 游客回复的 `subject` 是来源 IP 或 /64 前缀，最多保留一天 |

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

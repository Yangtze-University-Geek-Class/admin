import Database from "better-sqlite3";
import { mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { APP_ROOT } from "../config.js";
import { backfillIdentity } from "./identity-store.js";
import { runYugcV2Migration } from "./migrations/2026-10-yugc-v2.js";
import { DEFAULT_GRADE_FACTORS } from "./competition-rubric.js";
import { runForumV2Migration } from "./migrations/2026-10-forum-v2.js";
import { loadStickerManifest } from "./sticker-manifest.js";
import { runMailTemplatesMigration } from "./migrations/2026-10-mail-templates.js";
import type { ActivityOutcome, ActivitySurface } from "./activity.js";

/** 审计里的操作者：GitHub 登录名，或带上极客班账号的会话（写进 actor_account_id，#262）。 */
export type AuditActor = string | { login: string; account_id?: string | null };

const DEFAULT_STICKER_ASSETS_DIR = resolve(APP_ROOT, "server/assets/stickers");

/** `stickerAssetsDir`（#276、#286）：内置表情包目录（manifest.json 与各包的目录），启动时照清单把没有的包和表情种进库；
 * 默认就是仓库里的真实素材（这批表情是通用素材，不像论坛分类/标签要按测试隔离出一份夹具），`cli/*.ts` 与既有测试不用跟着传。 */
export function createDatabase(path: string, stickerAssetsDir: string = DEFAULT_STICKER_ASSETS_DIR) {
// 清单读不出来就在打开数据库之前失败；读到的清单同时给迁移播种和调用方（接口按它决定图片走不走 CDN）。
const stickerManifest = loadStickerManifest(stickerAssetsDir);
if (path !== ":memory:") mkdirSync(dirname(path), { recursive: true });

const db = new Database(path);
db.pragma("journal_mode = WAL");
db.pragma("foreign_keys = ON");
// 删行、改短字段时把腾出来的空间写成 0（SQLite 默认不写，被删会话里加密的 GitHub token 会留在页的空闲块里，
// 在线备份照样带走）。只对新写的页生效；库文件里的旧页靠会话清理每趟 truncateWal 的检查点盖掉，-wal 截成 0 字节
// （lib/auth.ts，#128；交还给文件系统的块不写 0，见 docs/architecture/SECURITY.md）。
db.pragma("secure_delete = ON");

db.exec(`
CREATE TABLE IF NOT EXISTS app_state (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS sessions (
  id TEXT PRIMARY KEY,
  login TEXT NOT NULL,
  user_id INTEGER,
  avatar_url TEXT,
  access_token_encrypted TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_sessions_login ON sessions(login);

CREATE TABLE IF NOT EXISTS invite_links (
  token TEXT PRIMARY KEY,
  org TEXT NOT NULL,
  created_by TEXT NOT NULL,
  created_by_token_encrypted TEXT NOT NULL,
  note TEXT,
  max_uses INTEGER NOT NULL,
  current_uses INTEGER NOT NULL DEFAULT 0,
  expires_at INTEGER NOT NULL,
  team_slug TEXT,
  disabled INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_invite_links_org ON invite_links(org);

CREATE TABLE IF NOT EXISTS invitations (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  org TEXT NOT NULL,
  invite_link_token TEXT,
  github_login TEXT,
  email TEXT,
  note TEXT,
  source_ip TEXT,
  user_agent TEXT,
  github_invitation_id INTEGER,
  status TEXT NOT NULL,
  error_message TEXT,
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_invitations_org_created ON invitations(org, created_at DESC);

CREATE TABLE IF NOT EXISTS feedback (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  org TEXT NOT NULL,
  content TEXT NOT NULL,
  category TEXT,
  contact TEXT,
  submitter_login TEXT,
  submitter_id INTEGER,
  source_ip TEXT,
  user_agent TEXT,
  status TEXT NOT NULL DEFAULT 'open',
  reply TEXT,
  replied_by TEXT,
  replied_at INTEGER,
  votes INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_feedback_org_status ON feedback(org, status, created_at DESC);

CREATE TABLE IF NOT EXISTS applications (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  class_name TEXT NOT NULL,
  email TEXT NOT NULL,
  strengths TEXT NOT NULL,
  source_ip TEXT,
  user_agent TEXT,
  status TEXT NOT NULL DEFAULT 'received',
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_applications_email ON applications(email);

CREATE TABLE IF NOT EXISTS audit_logs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  org TEXT,
  actor TEXT NOT NULL,
  action TEXT NOT NULL,
  target TEXT,
  details TEXT,
  ip TEXT,
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_audit_org_created ON audit_logs(org, created_at DESC);
-- 登录过的人（auth.signedInLogins）：论坛每次核对游客昵称、成员改昵称都要查，审计越积越多也只读登录那几行。
CREATE INDEX IF NOT EXISTS idx_audit_signin_actor ON audit_logs(actor) WHERE action = 'auth.signin';
`);


  db.exec(`CREATE TABLE IF NOT EXISTS invite_attempts (
    id TEXT PRIMARY KEY, token TEXT NOT NULL, recipient TEXT NOT NULL,
    state TEXT NOT NULL, github_invitation_id INTEGER, created_at INTEGER NOT NULL,
    UNIQUE(token, recipient)
  );`);

// 极客班控制台：部门、称号指派与投递审核历史。只新增表和索引，不改动已有表（没有迁移框架）。
db.exec(`
CREATE TABLE IF NOT EXISTS console_seeds (
  name TEXT PRIMARY KEY,
  seeded_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS titles (
  id TEXT PRIMARY KEY CHECK (id IN ('admin','captain','head','member','alumni','guest')),
  label TEXT NOT NULL,
  tag TEXT NOT NULL,
  icon TEXT NOT NULL,
  tone TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  capabilities TEXT NOT NULL DEFAULT '[]',
  updated_by TEXT,
  updated_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS departments (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  tag TEXT NOT NULL,
  icon TEXT NOT NULL,
  tone TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  head_capabilities TEXT NOT NULL,
  member_capabilities TEXT NOT NULL DEFAULT '[]',
  sort_order INTEGER NOT NULL DEFAULT 100,
  archived INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS role_assignments (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  github_login TEXT NOT NULL,
  github_user_id INTEGER,
  role TEXT NOT NULL CHECK (role IN ('captain','head','member','alumni')),
  department_id TEXT NOT NULL DEFAULT '',
  note TEXT,
  granted_by TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  CHECK ((role = 'head' AND department_id <> '') OR (role IN ('captain','alumni') AND department_id = '') OR role = 'member'),
  UNIQUE (github_login, role, department_id)
);
CREATE INDEX IF NOT EXISTS idx_role_assignments_login ON role_assignments(github_login);
CREATE INDEX IF NOT EXISTS idx_role_assignments_user ON role_assignments(github_user_id);
CREATE INDEX IF NOT EXISTS idx_role_assignments_department ON role_assignments(department_id, role);
CREATE UNIQUE INDEX IF NOT EXISTS uq_role_assignments_captain ON role_assignments(role) WHERE role = 'captain';

CREATE TABLE IF NOT EXISTS application_reviews (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  application_id TEXT NOT NULL REFERENCES applications(id) ON DELETE CASCADE,
  from_status TEXT NOT NULL,
  to_status TEXT NOT NULL,
  note TEXT,
  reviewer TEXT NOT NULL,
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_application_reviews_app ON application_reviews(application_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_applications_status_created ON applications(status, created_at DESC);
`);

// 比赛（#238）：官网桌面「比赛」应用读的公开赛事信息。只新增本表与索引，不改动已有表（没有迁移框架）。
// 时间是 UTC 毫秒时间戳（`Date.now()`），界面按北京时间显示；`offline` 只表示「下线」，不表示「进行中/已结束」——
// 那两种由 `start_at` / `end_at` / `signup_deadline` 与当前时间算出来，免得靠定时任务去翻状态。
db.exec(`
CREATE TABLE IF NOT EXISTS competitions (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('internal','external')),
  start_at INTEGER NOT NULL,
  end_at INTEGER NOT NULL,
  signup_deadline INTEGER,
  url TEXT,
  description TEXT NOT NULL DEFAULT '',
  offline INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  CHECK (end_at >= start_at),
  CHECK (url IS NULL OR url LIKE 'https://%'),
  CHECK (signup_deadline IS NULL OR signup_deadline <= end_at)
);
CREATE INDEX IF NOT EXISTS idx_competitions_offline_start ON competitions(offline, start_at);
`);

// 论坛（#57，ADR-0004）：/api/forum/* 的全部数据。只新增 forum_* 表和索引，不改已有表。
// 编号是字符串（t73、body-73、p10001、m<GitHub id>、g<n>、n<n>、tag-<n>），与论坛前端的 ForumState 一致；
// 新编号从 forum_counters 取，不用时间或随机数。
db.exec(`
CREATE TABLE IF NOT EXISTS forum_counters (
  -- member：没有 GitHub id 的成员论坛用户 id（a<n>，#274 SPEC §3.6）。
  name TEXT PRIMARY KEY CHECK (name IN ('topic','post','notification','tag','guest','member')),
  value INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS forum_avatars (
  hash TEXT PRIMARY KEY,
  data BLOB NOT NULL,
  created_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS forum_users (
  id TEXT PRIMARY KEY,
  kind TEXT NOT NULL CHECK (kind IN ('member','guest','official')),
  github_user_id INTEGER UNIQUE,
  username TEXT NOT NULL UNIQUE COLLATE NOCASE,
  display_name TEXT NOT NULL,
  bio TEXT NOT NULL DEFAULT '',
  location TEXT NOT NULL DEFAULT '',
  website TEXT NOT NULL DEFAULT '',
  avatar_color TEXT NOT NULL,
  github_avatar_url TEXT,
  avatar_hash TEXT REFERENCES forum_avatars(hash),
  role TEXT NOT NULL DEFAULT 'member' CHECK (role IN ('admin','moderator','member')),
  title TEXT,
  notify_reply INTEGER NOT NULL DEFAULT 1,
  notify_like INTEGER NOT NULL DEFAULT 1,
  notify_follow INTEGER NOT NULL DEFAULT 1,
  joined_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS forum_tags (
  id TEXT PRIMARY KEY,
  slug TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  color TEXT NOT NULL,
  created_by TEXT NOT NULL REFERENCES forum_users(id),
  created_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS forum_topics (
  id TEXT PRIMARY KEY,
  slug TEXT NOT NULL,
  title TEXT NOT NULL,
  category_id TEXT NOT NULL,
  tag_ids TEXT NOT NULL DEFAULT '[]',
  author_id TEXT NOT NULL REFERENCES forum_users(id),
  created_at INTEGER NOT NULL,
  last_activity_at INTEGER NOT NULL,
  views INTEGER NOT NULL DEFAULT 0,
  pinned INTEGER NOT NULL DEFAULT 0,
  closed INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_forum_topics_author ON forum_topics(author_id, created_at);

CREATE TABLE IF NOT EXISTS forum_posts (
  id TEXT PRIMARY KEY,
  topic_id TEXT NOT NULL REFERENCES forum_topics(id),
  author_id TEXT NOT NULL REFERENCES forum_users(id),
  content TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  edited_at INTEGER,
  reply_to_post_id TEXT,
  deleted INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_forum_posts_topic ON forum_posts(topic_id, created_at);
CREATE INDEX IF NOT EXISTS idx_forum_posts_author ON forum_posts(author_id, created_at);

CREATE TABLE IF NOT EXISTS forum_likes (
  post_id TEXT NOT NULL REFERENCES forum_posts(id),
  user_id TEXT NOT NULL REFERENCES forum_users(id),
  created_at INTEGER NOT NULL,
  PRIMARY KEY (post_id, user_id)
);

CREATE TABLE IF NOT EXISTS forum_bookmarks (
  user_id TEXT NOT NULL REFERENCES forum_users(id),
  post_id TEXT NOT NULL REFERENCES forum_posts(id),
  created_at INTEGER NOT NULL,
  PRIMARY KEY (user_id, post_id)
);

CREATE TABLE IF NOT EXISTS forum_follows (
  follower_id TEXT NOT NULL REFERENCES forum_users(id),
  followee_id TEXT NOT NULL REFERENCES forum_users(id),
  created_at INTEGER NOT NULL,
  PRIMARY KEY (follower_id, followee_id),
  CHECK (follower_id <> followee_id)
);

CREATE TABLE IF NOT EXISTS forum_notifications (
  id TEXT PRIMARY KEY,
  recipient_id TEXT NOT NULL REFERENCES forum_users(id),
  type TEXT NOT NULL CHECK (type IN ('reply','like','follow','mention','system')),
  actor_id TEXT NOT NULL REFERENCES forum_users(id),
  topic_id TEXT,
  post_id TEXT,
  created_at INTEGER NOT NULL,
  read INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_forum_notifications_recipient ON forum_notifications(recipient_id, created_at DESC);

CREATE TABLE IF NOT EXISTS forum_topic_views (
  topic_id TEXT NOT NULL,
  ip TEXT NOT NULL,
  viewed_at INTEGER NOT NULL,
  PRIMARY KEY (topic_id, ip)
);
CREATE INDEX IF NOT EXISTS idx_forum_topic_views_at ON forum_topic_views(viewed_at);

CREATE TABLE IF NOT EXISTS forum_rate_events (
  bucket TEXT NOT NULL,
  subject TEXT NOT NULL,
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_forum_rate_events_subject ON forum_rate_events(bucket, subject, created_at);
CREATE INDEX IF NOT EXISTS idx_forum_rate_events_at ON forum_rate_events(created_at);
`);

// forum_counters.name 的 CHECK 原来不认 'member'（#274 SPEC §3.6 新增，没有 GitHub id 的成员论坛用户编号）：
// 已经建过表的库（CREATE TABLE IF NOT EXISTS 不会补）要重建表才能放开；SQLite 不能直接改 CHECK。
// 新库的 CREATE TABLE 已经带 'member'，这里按 sqlite_master 的建表语句判断，不用重建时原样跳过。
(() => {
  const existing = db.prepare("SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'forum_counters'").get() as { sql: string } | undefined;
  if (existing && !existing.sql.includes("'member'")) {
    db.transaction(() => {
      db.exec(`
        CREATE TABLE forum_counters_new (
          name TEXT PRIMARY KEY CHECK (name IN ('topic','post','notification','tag','guest','member')),
          value INTEGER NOT NULL
        );
        INSERT INTO forum_counters_new SELECT * FROM forum_counters;
        DROP TABLE forum_counters;
        ALTER TABLE forum_counters_new RENAME TO forum_counters;
      `);
    })();
  }
})();

// 发信队列（#148，lib/mail/outbox.ts）：一个事件一行（event_key 唯一），发出、放弃或跳过之后清掉收件地址和正文，只留哈希和主题。
db.exec(`
CREATE TABLE IF NOT EXISTS mail_outbox (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  event_key TEXT NOT NULL UNIQUE,
  kind TEXT NOT NULL,
  application_id TEXT,
  review_id INTEGER,
  recipient TEXT,
  recipient_hash TEXT NOT NULL,
  limit_hash TEXT NOT NULL,
  source_hash TEXT,
  subject TEXT NOT NULL,
  html TEXT,
  text TEXT,
  reply_to TEXT,
  status TEXT NOT NULL CHECK (status IN ('pending','sending','sent','failed','skipped')),
  skip_reason TEXT,
  attempts INTEGER NOT NULL DEFAULT 0,
  next_attempt_at INTEGER NOT NULL,
  provider TEXT,
  provider_message_id TEXT,
  last_error TEXT,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  sent_at INTEGER
);
CREATE INDEX IF NOT EXISTS idx_mail_outbox_due ON mail_outbox(status, next_attempt_at);
CREATE INDEX IF NOT EXISTS idx_mail_outbox_review ON mail_outbox(review_id);
CREATE INDEX IF NOT EXISTS idx_mail_outbox_limit ON mail_outbox(kind, limit_hash, created_at);
CREATE INDEX IF NOT EXISTS idx_mail_outbox_source ON mail_outbox(kind, source_hash, created_at);
CREATE INDEX IF NOT EXISTS idx_mail_outbox_kind_at ON mail_outbox(kind, created_at);
`);

// 投递次数（#169，routes/portal/apply.ts 的 APPLY_LIMITS）：每份成功的投递按来源 IP 和设备各记一行，
// 只存 sha256 和时间，超过计数窗口的在下一次投递时删掉。
db.exec(`
CREATE TABLE IF NOT EXISTS application_limits (
  bucket TEXT NOT NULL CHECK (bucket IN ('source','device')),
  subject_hash TEXT NOT NULL,
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_application_limits_subject ON application_limits(bucket, subject_hash, created_at);
CREATE INDEX IF NOT EXISTS idx_application_limits_at ON application_limits(created_at);
`);

// 旧的「评估中」改回「已收到」（#148）。每次启动都跑一遍，没有这样的行时什么也不改；
// application_reviews 里的 reviewing 是历史，不动。
db.prepare("UPDATE applications SET status = 'received' WHERE status = 'reviewing'").run();

// 统一登录（#262，docs/plan/UNIFIED-LOGIN.md「数据库」）：users 一行是一个极客班账号（id 就是接口里的 account_id），
// identities 一行是一种登录方式（同一个 GitHub 账号只能绑定一个账号），identity_audit 是给本人看的账号记录。
// 只有 lib/identity-store.ts 读写这三张表。
db.exec(`
CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY,
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','disabled','merged')),
  merged_into TEXT REFERENCES users(id),
  canonical_email TEXT,
  org_state TEXT NOT NULL DEFAULT 'active' CHECK (org_state IN ('active','pending','not_member','unknown')),
  org_checked_at INTEGER,
  membership_version INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  CHECK ((status = 'merged') = (merged_into IS NOT NULL)),
  CHECK (merged_into <> id)
);

CREATE TABLE IF NOT EXISTS identities (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id),
  provider TEXT NOT NULL CHECK (provider IN ('github','google','email')),
  provider_uid TEXT NOT NULL,
  provider_union_id TEXT,
  email TEXT,
  email_verified INTEGER NOT NULL DEFAULT 0,
  login TEXT,
  avatar_url TEXT,
  created_at INTEGER NOT NULL,
  last_login_at INTEGER,
  UNIQUE (provider, provider_uid)
);
CREATE INDEX IF NOT EXISTS idx_identities_user ON identities(user_id);
CREATE UNIQUE INDEX IF NOT EXISTS uq_identities_github_user ON identities(user_id) WHERE provider = 'github';
CREATE INDEX IF NOT EXISTS idx_identities_union ON identities(provider, provider_union_id) WHERE provider_union_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS identity_audit (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id TEXT NOT NULL REFERENCES users(id),
  action TEXT NOT NULL,
  provider TEXT,
  result TEXT NOT NULL CHECK (result IN ('ok','denied','failed')),
  reason TEXT,
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_identity_audit_user ON identity_audit(user_id, created_at DESC);
`);

// 设备授权（#262，RFC 8628，为 `geek login` 预留）：一行是一次授权。device_code 与 access_token 只存 sha256；
// status 只写四个真实状态，`expired` 由 expires_at 现算。只有 lib/device-store.ts 读写这张表。
db.exec(`
CREATE TABLE IF NOT EXISTS device_grants (
  id TEXT PRIMARY KEY,
  device_code_hash TEXT NOT NULL UNIQUE,
  user_code TEXT NOT NULL UNIQUE,
  client_id TEXT NOT NULL,
  scope TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('pending','approved','denied','consumed')),
  account_id TEXT,
  interval_s INTEGER NOT NULL,
  created_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL,
  last_poll_at INTEGER,
  decided_at INTEGER,
  token_hash TEXT UNIQUE,
  token_expires_at INTEGER
);
CREATE INDEX IF NOT EXISTS idx_device_grants_account ON device_grants(account_id);
`);

// 对外授权（#270，ADR-0005 决策 3、8）：只有 lib/oidc-store.ts 读写这四张表。
// oauth_clients：登记的下游应用，client secret 用 ENCRYPTION_KEY 加密存；redirect_uris 是 JSON 数组，精确匹配；
//   sector_id 是登记时钉住的 sector（第一个回调的主机），换回调地址不变（#335），旧行为空时按第一个回调的主机算。
// oauth_subjects：给下游的 `sub`，按 sector 各生成一个随机值，一经生成不改，不随签名密钥轮换。
// oauth_grants：本人在授权页点过「允许」的应用，下次登录同一个应用不再问。
// oidc_payloads：oidc-provider 的授权码、令牌、交互与会话，过期的随写入顺手清掉。
db.exec(`
CREATE TABLE IF NOT EXISTS oauth_clients (
  client_id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  secret_encrypted TEXT NOT NULL,
  redirect_uris TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','disabled')),
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS oauth_subjects (
  sector_id TEXT NOT NULL,
  user_id TEXT NOT NULL REFERENCES users(id),
  sub TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  PRIMARY KEY (sector_id, user_id),
  UNIQUE (sector_id, sub)
);

CREATE TABLE IF NOT EXISTS oauth_grants (
  user_id TEXT NOT NULL REFERENCES users(id),
  client_id TEXT NOT NULL REFERENCES oauth_clients(client_id),
  grant_id TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  PRIMARY KEY (user_id, client_id)
);

CREATE TABLE IF NOT EXISTS oidc_payloads (
  model TEXT NOT NULL,
  id TEXT NOT NULL,
  payload TEXT NOT NULL,
  grant_id TEXT,
  uid TEXT,
  user_code TEXT,
  expires_at INTEGER,
  consumed_at INTEGER,
  PRIMARY KEY (model, id)
);
CREATE INDEX IF NOT EXISTS idx_oidc_payloads_grant ON oidc_payloads(grant_id) WHERE grant_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_oidc_payloads_uid ON oidc_payloads(model, uid) WHERE uid IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_oidc_payloads_user_code ON oidc_payloads(model, user_code) WHERE user_code IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_oidc_payloads_expires ON oidc_payloads(expires_at) WHERE expires_at IS NOT NULL;
`);

// GitLab 账号（#270）：一个极客班账号对应的 GitLab 用户。用户名在第一次同步时定下、之后不改；gitlab_user_id 在 GitLab 上
// 建好之后才有。只有 lib/gitlab-sync.ts 读写。
db.exec(`
CREATE TABLE IF NOT EXISTS gitlab_accounts (
  account_id TEXT PRIMARY KEY REFERENCES users(id),
  gitlab_user_id INTEGER UNIQUE,
  username TEXT NOT NULL UNIQUE COLLATE NOCASE,
  state TEXT NOT NULL CHECK (state IN ('pending','active','blocked')),
  access_level INTEGER,
  last_error TEXT,
  last_error_at INTEGER,
  synced_at INTEGER,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
`);

// 比赛报名与组队（#239，docs/plan/COMPETITION-APP.md「数据库（草图）」）：只新增表，不改 #238 的 `competitions`。
// `account_id` 是极客班账号（#262 的 users.id）：报名、队伍与成员都按账号认人，不按 GitHub 登录名。
// 所有状态变化只改 status 与时间列，不物理删除；外键引用 users(id)，所以这段排在统一登录的表之后。
// 与草图的两处差异（主线要求）：报名设置多 `scoring`（积分开关），`updated_by` 允许 NULL（系统种子）。
db.exec(`
CREATE TABLE IF NOT EXISTS competition_signup_settings (
  competition_id TEXT PRIMARY KEY REFERENCES competitions(id) ON DELETE CASCADE,
  enabled INTEGER NOT NULL DEFAULT 0 CHECK (enabled IN (0, 1)),
  participation TEXT NOT NULL CHECK (participation IN ('individual', 'team')),
  team_min INTEGER,
  team_max INTEGER,
  scoring TEXT NOT NULL DEFAULT 'none' CHECK (scoring IN ('none', 'contribution')),
  updated_at INTEGER NOT NULL,
  updated_by TEXT REFERENCES users(id),
  CHECK ((participation = 'individual' AND team_min IS NULL AND team_max IS NULL)
      OR (participation = 'team' AND team_min IS NOT NULL AND team_max IS NOT NULL
          AND team_min BETWEEN 1 AND 20 AND team_max BETWEEN team_min AND 20))
);

CREATE TABLE IF NOT EXISTS competition_signups (
  id TEXT PRIMARY KEY,
  competition_id TEXT NOT NULL REFERENCES competitions(id) ON DELETE CASCADE,
  account_id TEXT NOT NULL REFERENCES users(id),
  status TEXT NOT NULL CHECK (status IN ('active', 'cancelled')),
  looking_for_team INTEGER NOT NULL DEFAULT 0 CHECK (looking_for_team IN (0, 1)),
  note TEXT NOT NULL DEFAULT '' CHECK (length(note) <= 200),
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  cancelled_at INTEGER,
  UNIQUE (competition_id, account_id)
);
CREATE INDEX IF NOT EXISTS idx_competition_signups_account ON competition_signups(account_id);

CREATE TABLE IF NOT EXISTS competition_teams (
  id TEXT PRIMARY KEY,
  competition_id TEXT NOT NULL REFERENCES competitions(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  name_key TEXT NOT NULL,
  slogan TEXT NOT NULL DEFAULT '',
  leader_account_id TEXT NOT NULL REFERENCES users(id),
  status TEXT NOT NULL CHECK (status IN ('recruiting', 'locked', 'disbanded')),
  locked_at INTEGER,
  disbanded_at INTEGER,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_competition_teams_name
  ON competition_teams(competition_id, name_key) WHERE status <> 'disbanded';
CREATE INDEX IF NOT EXISTS idx_competition_teams_competition ON competition_teams(competition_id, status);

CREATE TABLE IF NOT EXISTS competition_team_members (
  id TEXT PRIMARY KEY,
  team_id TEXT NOT NULL REFERENCES competition_teams(id) ON DELETE CASCADE,
  competition_id TEXT NOT NULL REFERENCES competitions(id) ON DELETE CASCADE,
  account_id TEXT NOT NULL REFERENCES users(id),
  role TEXT NOT NULL CHECK (role IN ('leader', 'member')),
  status TEXT NOT NULL CHECK (status IN
    ('applied', 'invited', 'active', 'declined', 'withdrawn', 'left', 'removed', 'disbanded')),
  message TEXT NOT NULL DEFAULT '' CHECK (length(message) <= 100),
  created_by TEXT NOT NULL REFERENCES users(id),
  decided_by TEXT REFERENCES users(id),
  created_at INTEGER NOT NULL,
  decided_at INTEGER,
  updated_at INTEGER NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_team_members_active
  ON competition_team_members(competition_id, account_id) WHERE status = 'active';
CREATE UNIQUE INDEX IF NOT EXISTS uq_team_members_pending
  ON competition_team_members(team_id, account_id) WHERE status IN ('applied', 'invited');
CREATE INDEX IF NOT EXISTS idx_team_members_team ON competition_team_members(team_id, status);
CREATE INDEX IF NOT EXISTS idx_team_members_account ON competition_team_members(account_id, status);

CREATE TABLE IF NOT EXISTS competition_score_events (
  id TEXT PRIMARY KEY,
  competition_id TEXT NOT NULL REFERENCES competitions(id) ON DELETE CASCADE,
  account_id TEXT NOT NULL REFERENCES users(id),
  kind TEXT NOT NULL CHECK (kind IN ('issue', 'pr', 'penalty')),
  repo TEXT,
  number INTEGER,
  points INTEGER NOT NULL,
  reason TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'revoked')),
  created_by TEXT NOT NULL REFERENCES users(id),
  created_at INTEGER NOT NULL,
  revoked_by TEXT REFERENCES users(id),
  revoked_at INTEGER,
  revoke_reason TEXT,
  CHECK ((kind = 'issue' AND points BETWEEN 5 AND 30)
      OR (kind = 'pr' AND points BETWEEN 15 AND 100)
      OR (kind = 'penalty' AND points = -50))
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_competition_score_events_repo
  ON competition_score_events(competition_id, kind, repo, number)
  WHERE status = 'active' AND kind IN ('issue', 'pr');
CREATE INDEX IF NOT EXISTS idx_competition_score_events_competition ON competition_score_events(competition_id, created_at);
CREATE INDEX IF NOT EXISTS idx_competition_score_events_account ON competition_score_events(competition_id, account_id);
`);

// 已有表加列：SQLite 的 ADD COLUMN 没有 IF NOT EXISTS，先看 PRAGMA table_info。新列都可空，换回旧镜像时
// 旧代码的 INSERT 不写它们也照常成功；再上线时由下面的回填补齐回滚期间的数据。
function addColumn(table: string, column: string, definition: string) {
  const columns = db.pragma(`table_info(${table})`) as { name: string }[];
  if (!columns.some(item => item.name === column)) db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`);
}
addColumn("sessions", "openid", "TEXT REFERENCES users(id)");
addColumn("sessions", "provider", "TEXT");
addColumn("role_assignments", "account_id", "TEXT REFERENCES users(id)");
addColumn("forum_users", "account_id", "TEXT REFERENCES users(id)");
// 审计不加外键：审计行要比任何账号状态活得久
addColumn("audit_logs", "actor_account_id", "TEXT");

// 邮箱验证码、密码、Google 登录与邀请码注册（#262，所有者 2026-10-23 的决定，见 ADR-0005「2026-10-23 修订」）。
// invite_codes：控制台管理的注册邀请码，用邮箱或 Google 第一次登录建号时要填；只有 lib/invite-codes.ts 读写。
// email_challenges：一次「获取验证码」一行，库里只有验证码的 HMAC；只有 lib/email-login.ts 读写，过期一小时后随会话清理删掉。
db.exec(`
CREATE TABLE IF NOT EXISTS invite_codes (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  code TEXT NOT NULL UNIQUE,
  note TEXT NOT NULL DEFAULT '',
  max_uses INTEGER CHECK (max_uses IS NULL OR max_uses > 0),
  used_count INTEGER NOT NULL DEFAULT 0,
  expires_at INTEGER,
  disabled INTEGER NOT NULL DEFAULT 0 CHECK (disabled IN (0, 1)),
  created_by TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS email_challenges (
  id TEXT PRIMARY KEY,
  purpose TEXT NOT NULL CHECK (purpose IN ('signin', 'link')),
  email TEXT NOT NULL,
  limit_key TEXT NOT NULL,
  account_id TEXT REFERENCES users(id),
  session_hash TEXT,
  return_to TEXT,
  code_hmac TEXT NOT NULL,
  attempts INTEGER NOT NULL DEFAULT 0,
  ip_key TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL,
  used_at INTEGER,
  CHECK (purpose = 'signin' OR (account_id IS NOT NULL AND session_hash IS NOT NULL))
);
CREATE INDEX IF NOT EXISTS idx_email_challenges_limit ON email_challenges(limit_key, created_at);
CREATE INDEX IF NOT EXISTS idx_email_challenges_ip ON email_challenges(ip_key, created_at);
`);
// org_role：站内角色（admin 是提督、member 是舰员、空是还没有角色），不论用哪种方式登录都按它给称号（#262 第四期，
// 权限只认极客班账号）；回填建的老账号第一次用 GitHub 会话时按 GitHub 组织角色补记一次，之后只由控制台改；
// handle：没有绑定 GitHub 的账号的登录名（yz_ 开头，GitHub 登录名不含下划线，撞不上）；
// invite_code_id：用哪个邀请码注册的；password_hash：bcrypt，没设过密码为空。
addColumn("users", "org_role", "TEXT");
addColumn("users", "handle", "TEXT");
addColumn("users", "invite_code_id", "INTEGER REFERENCES invite_codes(id)");
addColumn("users", "password_hash", "TEXT");
addColumn("users", "password_updated_at", "INTEGER");
// avatar_source：传到 GitLab 的头像来自哪里（论坛头像 forum:<散列>，或 GitHub 头像地址），空是还没传过；来源变了再传（#271）。
addColumn("gitlab_accounts", "avatar_source", "TEXT");
// emails_source：上次同步到 GitLab 的邮箱（JSON：主邮箱与其它邮箱），空是还没同步过；绑定的邮箱变了再同步（#272）。
addColumn("gitlab_accounts", "emails_source", "TEXT");
// 每个账号 GitHub、Google 各最多一个身份，邮箱可以有几个（#272，上限是 identity-store 的 EMAILS_MAX）。#262 建的同名索引连邮箱也只许一个，
// 没有 WHERE 的就是它，删掉按新定义重建；名字不变，换回旧镜像时它的 CREATE UNIQUE INDEX IF NOT EXISTS 跳过，不会因为多出来的邮箱启动失败
const userProviderIndex = db.prepare("SELECT sql FROM sqlite_master WHERE type = 'index' AND name = 'uq_identities_user_provider'").get() as { sql: string } | undefined;
if (userProviderIndex && !/\bWHERE\b/i.test(userProviderIndex.sql)) db.exec("DROP INDEX uq_identities_user_provider");
db.exec(`
CREATE UNIQUE INDEX IF NOT EXISTS uq_users_handle ON users(handle) WHERE handle IS NOT NULL;
-- 每个账号每种登录方式最多一个（规格「待确认 7」的默认），邮箱除外（#272，见上面）
CREATE UNIQUE INDEX IF NOT EXISTS uq_identities_user_provider ON identities(user_id, provider) WHERE provider <> 'email';
CREATE INDEX IF NOT EXISTS idx_sessions_openid ON sessions(openid);
CREATE INDEX IF NOT EXISTS idx_role_assignments_account ON role_assignments(account_id);
CREATE UNIQUE INDEX IF NOT EXISTS uq_forum_users_account ON forum_users(account_id) WHERE account_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_audit_actor_account ON audit_logs(actor_account_id) WHERE actor_account_id IS NOT NULL;
-- 邀请码注册的成员：第四期起站内角色记成 member（舰员），之前注册的补上；可以重跑
UPDATE users SET org_role = 'member' WHERE org_role IS NULL AND invite_code_id IS NOT NULL AND org_state = 'active';
`);
// 每次启动都回填一遍（全是带条件的更新，可以重跑）：给还在用的旧会话建号、映射会话、认领称号和论坛用户。
const identityBackfill = backfillIdentity(db, Date.now());

// 权限节点、组、成员、条目（#274 SPEC §3.6）：只有 lib/permissions.ts 和 lib/migrations/2026-10-yugc-v2.ts 读写。
// perm_nodes 是代码里 permission-nodes.ts 的镜像，启动时整表同步；perm_groups/perm_entries 是种子，已存在不覆盖
// （所有者可能在控制台改过名字、说明、条目）。身份与部门互斥（每账号最多一个 level 组、一个 department 组）
// 由 lib/permissions.ts 的 setExclusiveGroupMembership() 在写入时保证，不用触发器。
db.exec(`
CREATE TABLE IF NOT EXISTS perm_nodes (
  node TEXT PRIMARY KEY,
  domain TEXT NOT NULL,
  label TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  meta INTEGER NOT NULL DEFAULT 0 CHECK (meta IN (0, 1)),
  sort INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS perm_groups (
  id TEXT PRIMARY KEY,
  kind TEXT NOT NULL CHECK (kind IN ('level', 'department', 'title', 'custom')),
  name TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  weight INTEGER NOT NULL DEFAULT 0,
  department_id TEXT,
  icon TEXT,
  tone TEXT,
  sort INTEGER NOT NULL DEFAULT 0,
  system INTEGER NOT NULL DEFAULT 0 CHECK (system IN (0, 1)),
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS perm_group_parents (
  group_id TEXT NOT NULL REFERENCES perm_groups(id) ON DELETE CASCADE,
  parent_id TEXT NOT NULL REFERENCES perm_groups(id) ON DELETE CASCADE,
  PRIMARY KEY (group_id, parent_id)
);

CREATE TABLE IF NOT EXISTS perm_entries (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  subject_type TEXT NOT NULL CHECK (subject_type IN ('group', 'account')),
  subject_id TEXT NOT NULL,
  node TEXT NOT NULL,
  value INTEGER CHECK (value IS NULL OR value IN (0, 1)),
  meta_value TEXT,
  scope TEXT NOT NULL DEFAULT '{}',
  expires_at INTEGER,
  granted_by TEXT NOT NULL DEFAULT '',
  created_at INTEGER NOT NULL,
  CHECK ((value IS NULL) <> (meta_value IS NULL))
);
CREATE INDEX IF NOT EXISTS idx_perm_entries_subject ON perm_entries(subject_type, subject_id);
CREATE INDEX IF NOT EXISTS idx_perm_entries_node ON perm_entries(node);

CREATE TABLE IF NOT EXISTS perm_members (
  account_id TEXT NOT NULL REFERENCES users(id),
  group_id TEXT NOT NULL REFERENCES perm_groups(id),
  expires_at INTEGER,
  granted_by TEXT NOT NULL DEFAULT '',
  created_at INTEGER NOT NULL,
  PRIMARY KEY (account_id, group_id)
);
CREATE INDEX IF NOT EXISTS idx_perm_members_group ON perm_members(group_id);

CREATE TABLE IF NOT EXISTS perm_state (
  key TEXT PRIMARY KEY,
  value INTEGER NOT NULL
);

-- 种子只应用一次的台账（#274 残留修复 C）：组、继承边、条目、role_assignments 映射各自按稳定 key 记一次
-- 「已经处理过」，往后重启不再重复判断"现在的状态是不是种子要的样子"——那种判法分不清"所有者故意改掉了"
-- 和"从来没种过"，重启就会把所有者删掉的条目、收紧的 meta、撤销的授权又种回来。
CREATE TABLE IF NOT EXISTS perm_seed_applied (
  key TEXT PRIMARY KEY,
  applied_at INTEGER NOT NULL
);
`);

// 账号资料与头像（#274）：论坛、控制台、GitLab 同步、OIDC userinfo、命令行统一读这里。
// account_avatars 按内容寻址，和 forum_avatars 结构一致但分开存（两边迁移节奏不同）。
db.exec(`
CREATE TABLE IF NOT EXISTS account_profiles (
  account_id TEXT PRIMARY KEY REFERENCES users(id),
  username TEXT UNIQUE COLLATE NOCASE,
  display_name TEXT NOT NULL DEFAULT '',
  bio TEXT NOT NULL DEFAULT '',
  avatar_hash TEXT,
  prefs TEXT NOT NULL DEFAULT '{}',
  updated_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS account_avatars (
  hash TEXT PRIMARY KEY,
  data BLOB NOT NULL,
  mime TEXT NOT NULL,
  created_at INTEGER NOT NULL
);
`);
// GitHub 头像识别结论（#343，lib/github-avatars.ts）：按头像地址记是不是 GitHub 自动生成的像素图（identicon 不算头像，统一头像改用
// NANO 默认头像）；真头像在 account_avatars 存一份 512 WebP（avatar_hash），网站和比赛页显示这份同源副本，转不出来时为空、照常显示 GitHub 地址。
// 没有这行就是还没识别；结论超过 7 天重看一次。
db.exec(`
CREATE TABLE IF NOT EXISTS github_avatar_checks (
  url TEXT PRIMARY KEY,
  verdict TEXT NOT NULL CHECK (verdict IN ('real', 'identicon')),
  avatar_hash TEXT,
  checked_at INTEGER NOT NULL
);
`);
// 实名信息（#280）：真实姓名只给本人和有 users.manage 的管理员看；年级不存，存入学年份，由 lib/grade.ts 按学年现算
addColumn("account_profiles", "real_name", "TEXT");
addColumn("account_profiles", "enrollment_year", "INTEGER");

// activity_events.surface 的 CHECK 原来不认 'gitlab'（#370，GitLab 项目事件进操作记录）：已经建过表的库（CREATE TABLE IF NOT EXISTS
// 不会补）要重建表才能放开，SQLite 不能直接改 CHECK。没有其它表引用它，所以不用关外键检查。重建时把五个索引一起建回来；
// 按 sqlite_master 的建表语句判断，重复执行安全；新库表还不存在，这里什么也不做，下面的 CREATE TABLE 直接带上新的 CHECK。
(() => {
  const existing = db.prepare("SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'activity_events'").get() as { sql: string } | undefined;
  if (existing && !existing.sql.includes("'gitlab'")) {
    db.transaction(() => {
      db.exec(`
        CREATE TABLE activity_events_new (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          at INTEGER NOT NULL,
          account_id TEXT,
          visitor_id TEXT,
          surface TEXT NOT NULL CHECK (surface IN ('portal', 'forum', 'console', 'cli', 'api', 'system', 'gitlab')),
          action TEXT NOT NULL,
          target_type TEXT,
          target_id TEXT,
          outcome TEXT NOT NULL CHECK (outcome IN ('ok', 'denied', 'limited', 'error')),
          ip TEXT,
          ua TEXT,
          request_id TEXT,
          meta TEXT NOT NULL DEFAULT '{}'
        );
        INSERT INTO activity_events_new(id, at, account_id, visitor_id, surface, action, target_type, target_id, outcome, ip, ua, request_id, meta)
          SELECT id, at, account_id, visitor_id, surface, action, target_type, target_id, outcome, ip, ua, request_id, meta FROM activity_events;
        DROP TABLE activity_events;
        ALTER TABLE activity_events_new RENAME TO activity_events;
        CREATE INDEX IF NOT EXISTS idx_activity_events_at ON activity_events(at);
        CREATE INDEX IF NOT EXISTS idx_activity_events_account ON activity_events(account_id, at);
        CREATE INDEX IF NOT EXISTS idx_activity_events_visitor ON activity_events(visitor_id, at);
        CREATE INDEX IF NOT EXISTS idx_activity_events_action ON activity_events(action, at);
        CREATE INDEX IF NOT EXISTS idx_activity_events_outcome ON activity_events(outcome, at);
      `);
    })();
  }
})();
// 操作记录与限额（#274 SPEC §3.7、§3.8）：写入只走 lib/activity.ts 的 recordActivity()；
// limit_events 是通用计数表，取代 application_limits 那种一事一表的模式（旧表保留，不再新增同类表）。
db.exec(`
CREATE TABLE IF NOT EXISTS activity_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  at INTEGER NOT NULL,
  account_id TEXT,
  visitor_id TEXT,
  surface TEXT NOT NULL CHECK (surface IN ('portal', 'forum', 'console', 'cli', 'api', 'system', 'gitlab')),
  action TEXT NOT NULL,
  target_type TEXT,
  target_id TEXT,
  outcome TEXT NOT NULL CHECK (outcome IN ('ok', 'denied', 'limited', 'error')),
  ip TEXT,
  ua TEXT,
  request_id TEXT,
  meta TEXT NOT NULL DEFAULT '{}'
);
CREATE INDEX IF NOT EXISTS idx_activity_events_at ON activity_events(at);
CREATE INDEX IF NOT EXISTS idx_activity_events_account ON activity_events(account_id, at);
CREATE INDEX IF NOT EXISTS idx_activity_events_visitor ON activity_events(visitor_id, at);
CREATE INDEX IF NOT EXISTS idx_activity_events_action ON activity_events(action, at);
CREATE INDEX IF NOT EXISTS idx_activity_events_outcome ON activity_events(outcome, at);

CREATE TABLE IF NOT EXISTS limit_events (
  bucket TEXT NOT NULL,
  subject TEXT NOT NULL,
  at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_limit_events_subject ON limit_events(bucket, subject, at);
CREATE INDEX IF NOT EXISTS idx_limit_events_at ON limit_events(at);

-- 访问防护（#333，lib/shield.ts）：异常信号按 IP 计分（窗口外的每天清一次）、生效中与最近结束的封禁（级别、结束时刻）。
-- 只有 lib/shield.ts 读写这两张表。
CREATE TABLE IF NOT EXISTS shield_signals (
  ip TEXT NOT NULL,
  at INTEGER NOT NULL,
  points INTEGER NOT NULL,
  reason TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_shield_signals_ip ON shield_signals(ip, at);
CREATE INDEX IF NOT EXISTS idx_shield_signals_at ON shield_signals(at);
CREATE TABLE IF NOT EXISTS ip_blocks (
  ip TEXT PRIMARY KEY,
  level INTEGER NOT NULL DEFAULT 0,
  blocked_until INTEGER NOT NULL DEFAULT 0,
  reason TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_ip_blocks_until ON ip_blocks(blocked_until);

-- 严格防护的运行策略与管理员维护的动态 IP/CIDR 白名单（#387）。完整网段加密保存，哈希仅用于去重；匹配缓存由 security-policy.ts 重建。
CREATE TABLE IF NOT EXISTS security_ip_allowlist (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  cidr_hash TEXT NOT NULL UNIQUE,
  cidr_encrypted TEXT NOT NULL,
  note TEXT NOT NULL DEFAULT '',
  enabled INTEGER NOT NULL DEFAULT 1 CHECK(enabled IN (0, 1)),
  created_by TEXT REFERENCES users(id) ON DELETE SET NULL,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_security_ip_allowlist_enabled ON security_ip_allowlist(enabled, id);

-- 接口限流的固定窗口计数（#333，lib/rate-store.ts，@fastify/rate-limit 的 store）：重启后同一窗口内的次数不清零。
-- 过期行由清理任务按窗口起点删掉。
CREATE TABLE IF NOT EXISTS rate_limit_counters (
  key TEXT PRIMARY KEY,
  hits INTEGER NOT NULL,
  window_start INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_rate_limit_counters_start ON rate_limit_counters(window_start);
`);
// 话题可见范围（#274 建表，#276 使用）：NULL 表示跟随分类，非 NULL 是版主调高过的覆盖值（CONTRACT-276 §1）。
// #274 最初建的列是 `NOT NULL DEFAULT 'public'`——那时还没有分级可见、没有人调用过还不存在的 PATCH visibility
// 接口，所有已有行的 'public' 都是列默认值，不是谁真的设置过；这里把列放宽成可空，并把这些默认值改成 NULL
// （含义不变：跟随分类，只是之前的列定义没法表达"跟随"这件事，会让分类改成 registered/member 之后，这些行
// 仍然显示 'public'，变成可见性泄漏）。按 PRAGMA table_info 的 notnull 标志判断要不要重建，可以重复执行。
(() => {
  const columns = db.pragma("table_info(forum_topics)") as { name: string; notnull: number }[];
  const visibility = columns.find(column => column.name === "visibility");
  if (visibility && visibility.notnull === 1) {
    // forum_topics 是好几张表的外键父表（forum_posts.topic_id 等）：FK 检查开着时重建它会在 DROP TABLE
    // 那一步报 FOREIGN KEY constraint failed——SQLite 的已知限制，父表被删掉的那一刻子表还在引用它就不让
    // 删，哪怕马上会建回同名的新表。按 SQLite 自己的重建表指南，这类操作要先关掉 FK 检查（不能在事务内切，
    // 对已经开始的事务不生效），建完再开，开完用 foreign_key_check 核对真的没有留下悬空引用。
    db.pragma("foreign_keys = OFF");
    try {
      db.transaction(() => {
        db.exec(`
          CREATE TABLE forum_topics_new (
            id TEXT PRIMARY KEY,
            slug TEXT NOT NULL,
            title TEXT NOT NULL,
            category_id TEXT NOT NULL,
            tag_ids TEXT NOT NULL DEFAULT '[]',
            author_id TEXT NOT NULL REFERENCES forum_users(id),
            created_at INTEGER NOT NULL,
            last_activity_at INTEGER NOT NULL,
            views INTEGER NOT NULL DEFAULT 0,
            pinned INTEGER NOT NULL DEFAULT 0,
            closed INTEGER NOT NULL DEFAULT 0,
            visibility TEXT CHECK (visibility IS NULL OR visibility IN ('public', 'registered', 'member'))
          );
          INSERT INTO forum_topics_new(id, slug, title, category_id, tag_ids, author_id, created_at, last_activity_at, views, pinned, closed, visibility)
            SELECT id, slug, title, category_id, tag_ids, author_id, created_at, last_activity_at, views, pinned, closed, NULL FROM forum_topics;
          DROP TABLE forum_topics;
          ALTER TABLE forum_topics_new RENAME TO forum_topics;
          CREATE INDEX IF NOT EXISTS idx_forum_topics_author ON forum_topics(author_id, created_at);
        `);
      })();
      const dangling = db.pragma("foreign_key_check(forum_topics)") as unknown[];
      if (dangling.length > 0) throw new Error(`forum_topics 重建后出现悬空外键：${JSON.stringify(dangling)}`);
    } finally {
      db.pragma("foreign_keys = ON");
    }
  }
})();
addColumn("forum_topics", "visibility", "TEXT CHECK (visibility IS NULL OR visibility IN ('public', 'registered', 'member'))");
// 新称号体系（#276 CONTRACT §9）：部门与称号，JSON `{ department, titles }`，和 /auth/me 同一套数据；
// 没有就是还没请求过（第一次登录的请求会立即回填，见 forum-store.ts 的 ensureMember）。
addColumn("forum_users", "account_titles", "TEXT");

// 论坛 v2（#276）：分类可见范围种子、表情包、表情回应、上传图片。forum_categories 本身仍是 curation.json
// 的客户端常量，不落库；这里只存「哪个分类该是什么可见范围」这一份设置。
db.exec(`
CREATE TABLE IF NOT EXISTS forum_category_settings (
  category_id TEXT PRIMARY KEY,
  visibility TEXT NOT NULL CHECK (visibility IN ('public', 'registered', 'member')),
  updated_at INTEGER NOT NULL,
  updated_by TEXT
);

CREATE TABLE IF NOT EXISTS forum_sticker_packs (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  sort INTEGER NOT NULL DEFAULT 0,
  enabled INTEGER NOT NULL DEFAULT 1 CHECK (enabled IN (0, 1)),
  created_at INTEGER NOT NULL
);

-- 表情图片按内容寻址，和 forum_avatars / account_avatars 同一种存法。
CREATE TABLE IF NOT EXISTS forum_sticker_files (
  hash TEXT PRIMARY KEY,
  mime TEXT NOT NULL,
  bytes BLOB NOT NULL,
  created_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS forum_stickers (
  id TEXT PRIMARY KEY,
  pack_id TEXT NOT NULL REFERENCES forum_sticker_packs(id),
  shortcode TEXT NOT NULL UNIQUE,
  label TEXT NOT NULL,
  file_hash TEXT NOT NULL REFERENCES forum_sticker_files(hash),
  sort INTEGER NOT NULL DEFAULT 0,
  enabled INTEGER NOT NULL DEFAULT 1 CHECK (enabled IN (0, 1))
);
CREATE INDEX IF NOT EXISTS idx_forum_stickers_pack ON forum_stickers(pack_id, sort);

CREATE TABLE IF NOT EXISTS forum_reactions (
  post_id TEXT NOT NULL REFERENCES forum_posts(id),
  account_id TEXT NOT NULL REFERENCES users(id),
  sticker_id TEXT NOT NULL REFERENCES forum_stickers(id),
  created_at INTEGER NOT NULL,
  PRIMARY KEY (post_id, account_id, sticker_id)
);
CREATE INDEX IF NOT EXISTS idx_forum_reactions_sticker ON forum_reactions(sticker_id);

-- 上传图片按内容寻址，和头像同一种存法；多存 width/height 给 PUT 响应用，不用每次读图再解码一遍。
CREATE TABLE IF NOT EXISTS forum_upload_files (
  hash TEXT PRIMARY KEY,
  mime TEXT NOT NULL,
  bytes BLOB NOT NULL,
  width INTEGER NOT NULL,
  height INTEGER NOT NULL,
  uploaded_by TEXT REFERENCES users(id),
  created_at INTEGER NOT NULL
);

-- 招聘邮件模板（#285）：blocks、footer 是 JSON 文本，结构由 lib/mail/template-content.ts 的 normalizeContent 在写入前核对；
-- 按钮文字和路径要么都有、要么都没有；默认模板必须是启用的；同一类信里名字不重复（不分大小写），默认只有一个。
-- 首次启动的种子由 lib/migrations/2026-10-mail-templates.ts 写入。
CREATE TABLE IF NOT EXISTS mail_templates (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('received','interview','accepted','rejected')),
  subject TEXT NOT NULL,
  preheader TEXT NOT NULL DEFAULT '',
  kicker TEXT NOT NULL DEFAULT '',
  greeting TEXT NOT NULL DEFAULT '{{称呼}}',
  blocks TEXT NOT NULL,
  button_label TEXT,
  button_path TEXT,
  footer TEXT NOT NULL DEFAULT '[]',
  enabled INTEGER NOT NULL DEFAULT 1 CHECK (enabled IN (0, 1)),
  is_default INTEGER NOT NULL DEFAULT 0 CHECK (is_default IN (0, 1)),
  created_by TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  updated_by TEXT NOT NULL,
  updated_at INTEGER NOT NULL,
  CHECK ((button_label IS NULL) = (button_path IS NULL)),
  CHECK (is_default = 0 OR enabled = 1)
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_mail_templates_kind_name ON mail_templates(kind, name COLLATE NOCASE);
CREATE UNIQUE INDEX IF NOT EXISTS idx_mail_templates_default ON mail_templates(kind) WHERE is_default = 1;
`);

// 账号、权限、操作记录统一迁移（#274，lib/migrations/2026-10-yugc-v2.ts）：种子只增不改所有者改过的数据，
// 账号身份与 role_assignments 映射只在账号还没有对应分组时写入，可以重复执行。报告供迁移演练与 MR 贴数用。
const yugcV2Migration = runYugcV2Migration(db, Date.now());
// 论坛 v2 迁移（#276，lib/migrations/2026-10-forum-v2.ts）：分类可见范围种子、表情包种子（#286 起照清单播种），同样只增不改、可重复执行。
const forumV2Migration = runForumV2Migration(db, Date.now(), stickerAssetsDir, stickerManifest);
// 招聘邮件模板迁移（#285，lib/migrations/2026-10-mail-templates.ts）：把四类信现在的内容种成「默认」模板，另加一套面试邀请的简短版；种子只插一次、可重复执行。
runMailTemplatesMigration(db, Date.now());

// 第一期开源贡献赛（#239）：比赛与报名设置种子，用 `console_seeds` 标记，只插一次。
// 组织者之后把比赛删掉或改掉，重启也不再补回来。
const COMPETITION_SEED = "competition_oss_2026_1";
const COMPETITION_SEED_ID = "oss-challenge-2026-1";
// 截止与结束取当天 23:59:59.999，与控制台只填日期时存的日末一致（官网就写成「11-15（周日）」，不带时刻）。
const COMPETITION_SEED_DEADLINE = Date.parse("2026-11-15T23:59:59.999+08:00");
{
  const seeded = db.transaction(() => {
    if (db.prepare("SELECT 1 AS n FROM console_seeds WHERE name = ?").get(COMPETITION_SEED)) return;
    const now = Date.now();
    db.prepare(`INSERT OR IGNORE INTO competitions(id, name, kind, start_at, end_at, signup_deadline, url, description, offline, created_at, updated_at)
      VALUES(?, ?, 'internal', ?, ?, ?, NULL, ?, 0, ?, ?)`).run(
      COMPETITION_SEED_ID,
      "极客班开源实战贡献挑战赛 · 2026 第一期",
      Date.parse("2026-10-21T00:00:00+08:00"),
      COMPETITION_SEED_DEADLINE,
      COMPETITION_SEED_DEADLINE,
      // 第一段是官网 Hero 上的一句介绍，全文在「概览」里按段显示
      "面向极客班成员的开源实战贡献赛：在组织认可的开源仓库里提交 Issue 与 PR，按合入结果计分，积分天梯实时更新。\n"
        + "计分：合入的 Issue +5～+30，合入的 PR +15～+100；作弊（刷量、抄袭、冒名或虚假贡献）每次 −50。分数由组织者核实后登记，可追溯、可撤销。\n"
        + "个人赛，按个人合入结果计分。比赛时间 2026-10-21 至 2026-11-15 23:59:59（北京时间）。",
      now,
      now,
    );
    // 个人赛（所有者 2026-10-24 23:38 说明第一个内部赛事不是团队赛），team_min/team_max 留空。
    db.prepare(`INSERT OR IGNORE INTO competition_signup_settings(competition_id, enabled, participation, team_min, team_max, scoring, updated_at, updated_by)
      VALUES(?, 1, 'individual', NULL, NULL, 'contribution', ?, NULL)`).run(COMPETITION_SEED_ID, now);
    db.prepare("INSERT OR IGNORE INTO console_seeds(name, seeded_at) VALUES(?, ?)").run(COMPETITION_SEED, now);
  });
  seeded();
}

// 更正：第一期原来按团队赛种的库（#239 上线时 participation='team'，team_min/team_max 1–3），
// 所有者 2026-10-24 23:38 告知第一期其实是个人赛。还没人报名或建队时才改回个人赛；真的已经有报名
// 或队伍（组织者已经在用团队模式）就不动，交组织者在控制台手工处理。可以重复执行：改完之后
// participation 已经是 'individual'，下次启动不再匹配 'team' 条件。
{
  const row = db.prepare("SELECT participation FROM competition_signup_settings WHERE competition_id = ?").get(COMPETITION_SEED_ID) as { participation: string } | undefined;
  if (row?.participation === "team") {
    const existing = db.prepare(
      "SELECT (SELECT COUNT(*) FROM competition_signups WHERE competition_id = ?) + (SELECT COUNT(*) FROM competition_teams WHERE competition_id = ?) AS n",
    ).get(COMPETITION_SEED_ID, COMPETITION_SEED_ID) as { n: number };
    if (existing.n === 0) {
      db.prepare("UPDATE competition_signup_settings SET participation = 'individual', team_min = NULL, team_max = NULL, updated_at = ? WHERE competition_id = ?")
        .run(Date.now(), COMPETITION_SEED_ID);
    }
  }
}

// 更正（#288）：第一期按团队赛种下的库，描述第三行写着「1–3 人组队……」。上面只改赛制字段，描述留在库里，
// 官网、桌面比赛窗口、公开接口和命令行都照着显示。赛制已经是个人赛时，把种子原文那一行换成个人赛的说法；
// 组织者改过这一行就不匹配，不动。可以重复执行：换完之后旧行不在了。
{
  const SEED_TEAM_LINE = "1–3 人组队（一个人也可以自成一队），队伍积分是在队成员积分之和。比赛时间 2026-10-21 至 2026-11-15 23:59:59（北京时间）。";
  const SEED_INDIVIDUAL_LINE = "个人赛，按个人合入结果计分。比赛时间 2026-10-21 至 2026-11-15 23:59:59（北京时间）。";
  const row = db.prepare(`SELECT c.description AS description, s.participation AS participation
    FROM competitions c JOIN competition_signup_settings s ON s.competition_id = c.id WHERE c.id = ?`).get(COMPETITION_SEED_ID) as { description: string; participation: string } | undefined;
  if (row?.participation === "individual" && row.description.includes(SEED_TEAM_LINE)) {
    db.prepare("UPDATE competitions SET description = ?, updated_at = ? WHERE id = ?")
      .run(row.description.replace(SEED_TEAM_LINE, SEED_INDIVIDUAL_LINE), Date.now(), COMPETITION_SEED_ID);
  }
}

// 比赛官网托管、GitLab 贡献收集、年级系数与奖项、定榜与兑奖码（#278，CONTRACT-278）：只新增表与可空列。
// 站点文件不进库，放在数据卷 `sites/<competition_id>/<version_id>/`（lib/competition-site-store.ts）；
// 候选贡献由 lib/competition-candidates.ts 写；规则与奖项由 lib/competition-rules-store.ts 写；
// 定榜与兑奖码由 lib/competition-prizes.ts 写，兑奖码只存散列、密文和末四位，不存明文。
db.exec(`
CREATE TABLE IF NOT EXISTS competition_site_versions (
  id TEXT PRIMARY KEY,
  competition_id TEXT NOT NULL REFERENCES competitions(id) ON DELETE CASCADE,
  version TEXT NOT NULL,
  size INTEGER NOT NULL,
  files INTEGER NOT NULL,
  sha256 TEXT NOT NULL,
  uploaded_by TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('passed', 'rejected')),
  report TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_competition_site_versions_competition ON competition_site_versions(competition_id, created_at);

CREATE TABLE IF NOT EXISTS competition_sites (
  competition_id TEXT PRIMARY KEY REFERENCES competitions(id) ON DELETE CASCADE,
  slug TEXT NOT NULL UNIQUE,
  live_version_id TEXT REFERENCES competition_site_versions(id),
  updated_at INTEGER NOT NULL,
  updated_by TEXT
);

CREATE TABLE IF NOT EXISTS competition_gitlab_sources (
  competition_id TEXT NOT NULL REFERENCES competitions(id) ON DELETE CASCADE,
  project_path TEXT NOT NULL,
  PRIMARY KEY (competition_id, project_path)
);

-- accepted_via：label 是有 competition.score.review 的人在 GitLab 上打了「有用」标签，console 是控制台「标记有用」；
-- note：最近一次核对时没有计分的原因（例如标签是自己打的）；contributed_at：MR 的合并时间或 Issue 的创建时间。
-- importance、core：标记有用时选的重要程度（normal/important/critical）与核心度（edge/business/core），final_points 是查表得到的基础分。
CREATE TABLE IF NOT EXISTS competition_score_candidates (
  id TEXT PRIMARY KEY,
  competition_id TEXT NOT NULL REFERENCES competitions(id) ON DELETE CASCADE,
  account_id TEXT NOT NULL REFERENCES users(id),
  kind TEXT NOT NULL CHECK (kind IN ('pr', 'issue')),
  gitlab_project TEXT NOT NULL,
  gitlab_iid INTEGER NOT NULL,
  url TEXT NOT NULL,
  title TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'accepted', 'rejected')),
  reviewed_by TEXT REFERENCES users(id),
  reviewed_at INTEGER,
  importance TEXT CHECK (importance IS NULL OR importance IN ('normal', 'important', 'critical')),
  core TEXT CHECK (core IS NULL OR core IN ('edge', 'business', 'core')),
  final_points INTEGER,
  reason TEXT,
  score_event_id TEXT,
  accepted_via TEXT CHECK (accepted_via IS NULL OR accepted_via IN ('label', 'console')),
  note TEXT,
  contributed_at INTEGER NOT NULL,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  UNIQUE (competition_id, kind, gitlab_project, gitlab_iid)
);
CREATE INDEX IF NOT EXISTS idx_competition_score_candidates_status ON competition_score_candidates(competition_id, status, created_at);
CREATE INDEX IF NOT EXISTS idx_competition_score_candidates_event ON competition_score_candidates(score_event_id) WHERE score_event_id IS NOT NULL;

-- grade_factors：年级 → 系数（百分数，350 = 3.5）；prizes：[{ from, to, amount_cny, title }]，没有奖项是 []。
CREATE TABLE IF NOT EXISTS competition_rules (
  competition_id TEXT PRIMARY KEY REFERENCES competitions(id) ON DELETE CASCADE,
  grade_factors TEXT NOT NULL,
  prizes TEXT NOT NULL DEFAULT '[]',
  updated_at INTEGER NOT NULL,
  updated_by TEXT
);

-- standings：定榜那一刻的个人名次快照（JSON），之后加分、撤销都不再改它。
CREATE TABLE IF NOT EXISTS competition_finals (
  competition_id TEXT PRIMARY KEY REFERENCES competitions(id) ON DELETE CASCADE,
  finalized_at INTEGER NOT NULL,
  finalized_by TEXT NOT NULL REFERENCES users(id),
  standings TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS competition_prizes (
  id TEXT PRIMARY KEY,
  competition_id TEXT NOT NULL REFERENCES competitions(id) ON DELETE CASCADE,
  account_id TEXT NOT NULL REFERENCES users(id),
  rank INTEGER NOT NULL,
  points INTEGER NOT NULL,
  amount_cny INTEGER NOT NULL,
  title TEXT NOT NULL DEFAULT '',
  code_hash TEXT NOT NULL UNIQUE,
  code_cipher TEXT NOT NULL,
  code_hint TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  redeemed_at INTEGER,
  redeemed_by TEXT REFERENCES users(id),
  UNIQUE (competition_id, account_id)
);
`);
// 记分那一刻的年级与系数（#278）：grade 取 lib/grade.ts 的结果（1–4、graduated，没填为 none），grade_factor 是百分数，
// weighted_points = round(points × grade_factor × damp_percent / 10000)。#278 之前的行三列都为空，天梯按 points 算（系数 1）。
addColumn("competition_score_events", "grade", "TEXT");
addColumn("competition_score_events", "grade_factor", "INTEGER");
addColumn("competition_score_events", "weighted_points", "INTEGER");
// 两档评定（#278，所有者 2026-10-24 16:59）：importance、core 是标记有用时选的重要程度与核心度，points 由它们查表
// （lib/competition-rubric.ts），不再手填；damp_percent 是防刷折扣（同一周第 2 条起的「一般 × 边缘」记 0），
// contributed_at 是贡献发生的时间（MR 合并、Issue 创建，控制台手工登记时等于登记时间），防刷按它分周。
// 之前登记的行四列都为空：分数照旧，不补评定，防刷不回头算。
addColumn("competition_score_events", "importance", "TEXT");
addColumn("competition_score_events", "core", "TEXT");
addColumn("competition_score_events", "damp_percent", "INTEGER");
addColumn("competition_score_events", "contributed_at", "INTEGER");

// 组队广场（#278 重开，所有者 2026-10-24 22:25）：队伍自己的「还在招募」广播，和 status 的 recruiting/locked
// 是两件事——status 决定还能不能被申请，plaza_recruiting 决定要不要在广场上公开求人，领队单独开关。
// 旧队伍都是 0/空/NULL，不在广场出现，不影响既有的报名、组队与积分流程。
addColumn("competition_teams", "plaza_recruiting", "INTEGER NOT NULL DEFAULT 0 CHECK (plaza_recruiting IN (0, 1))");
addColumn("competition_teams", "plaza_note", "TEXT NOT NULL DEFAULT ''");
addColumn("competition_teams", "plaza_skills", "TEXT NOT NULL DEFAULT '[]'");
addColumn("competition_teams", "plaza_updated_at", "INTEGER");

// 规划中状态（#278，所有者 2026-10-25 01:03 说明比赛有规划中、进行中、已结束等状态）：组织者还在筹备、
// 还没准备好开放报名时打开，`competitionStatus` 在开赛前把它算成 "planning"，报名与组队一律拒绝；一旦过了
// 开赛时间，这个标记就不再生效，照原有规则走进行中/已结束（不会把已经开赛的比赛卡在「规划中」，见 competition-store.ts）。
// 旧比赛都是 0，行为不变。
addColumn("competitions", "planning", "INTEGER NOT NULL DEFAULT 0 CHECK (planning IN (0, 1))");
// 对外授权应用钉住的 sector（#335）：空的旧行不回填，第一次换回调地址时由 oidc-store 钉住当时的值。
addColumn("oauth_clients", "sector_id", "TEXT");

// 第一期的计分规则、奖项与 GitLab 项目（#278，所有者 2026-10-24 13:45）：用 `console_seeds` 标记，只插一次；
// 组织者之后在控制台改掉，重启也不再补回来。比赛本身被删掉时什么也不插。
const COMPETITION_RULES_SEED = "competition_oss_2026_1_rules";
{
  const seeded = db.transaction(() => {
    if (db.prepare("SELECT 1 AS n FROM console_seeds WHERE name = ?").get(COMPETITION_RULES_SEED)) return;
    const now = Date.now();
    if (db.prepare("SELECT 1 AS n FROM competitions WHERE id = ?").get(COMPETITION_SEED_ID)) {
      db.prepare("INSERT OR IGNORE INTO competition_rules(competition_id, grade_factors, prizes, updated_at, updated_by) VALUES(?, ?, ?, ?, NULL)").run(
        COMPETITION_SEED_ID,
        JSON.stringify(DEFAULT_GRADE_FACTORS),
        JSON.stringify([
          { from: 1, to: 1, amount_cny: 700, title: "GPT 5x 订阅的价格" },
          { from: 2, to: 3, amount_cny: 140, title: "GPT Plus 订阅的价格" },
          { from: 4, to: 8, amount_cny: 70, title: "" },
        ]),
        now,
      );
      db.prepare("INSERT OR IGNORE INTO competition_gitlab_sources(competition_id, project_path) VALUES(?, ?)").run(COMPETITION_SEED_ID, "geek/admin");
    }
    db.prepare("INSERT OR IGNORE INTO console_seeds(name, seeded_at) VALUES(?, ?)").run(COMPETITION_RULES_SEED, now);
  });
  seeded();
}

/**
 * 没有 FastifyRequest 的调用方专用的操作记录写入口（CLI、后台同步、identity-store/device 这类深层库函数）：
 * #274 item I 之前写的是 audit_logs，SPEC §3.6 第 7 条已经把那张表的历史数据一次性复制进了 activity_events
 * （见 migrations/2026-10-yugc-v2.ts 的 copyAuditLogsToActivity），现在起路由和库函数都不再写 audit_logs（表留着）。
 * 唯一的例外是启动时的身份回填（identity-store.ts 的 backfillIdentity）：它在 activity_events 建表之前运行，仍往
 * audit_logs 留一条 identity.backfill，随后由同一次启动的迁移第 7 步按水位线复制进操作记录。有 req 的路由直接调 `services.activity.recordActivity(req, ...)`，不经过这里——两边都调会变成
 * 两条一模一样的记录。account_id 之外的那些字段（visitor_id/ua/request_id）在这些调用方手里本来就没有，留空。
 */
function audit(actor: AuditActor, action: string, target?: string, details?: unknown, ip?: string, opts: { surface?: ActivitySurface; outcome?: ActivityOutcome } = {}) {
  const accountId = typeof actor === "string" ? null : actor.account_id ?? null;
  db.prepare(`
    INSERT INTO activity_events(at, account_id, visitor_id, surface, action, target_type, target_id, outcome, ip, ua, request_id, meta)
    VALUES (?, ?, NULL, ?, ?, NULL, ?, ?, ?, NULL, NULL, ?)
  `).run(Date.now(), accountId, opts.surface ?? "system", action, target ?? null, opts.outcome ?? "ok", ip ?? null, JSON.stringify(details ?? {}));
}

return { db, audit, identityBackfill, yugcV2Migration, forumV2Migration, stickerManifest };
}

/**
 * 把 WAL 写回库文件并截成 0 字节（`wal_checkpoint(TRUNCATE)`），返回这次截成没有（#128）。
 * 有别的连接正在读（例如外部的在线备份）时截不成：这时不等待（busy_timeout 临时设成 0），
 * 免得同步调用把事件循环卡在 better-sqlite3 默认的 5 秒等待上，留给调用方下一趟再试。内存库没有 WAL，算截成。
 */
export function truncateWal(db: Database.Database): boolean {
  const timeout = db.pragma("busy_timeout", { simple: true }) as number;
  db.pragma("busy_timeout = 0");
  try {
    const [result] = db.pragma("wal_checkpoint(TRUNCATE)") as { busy: number }[];
    return result?.busy === 0;
  } finally {
    db.pragma(`busy_timeout = ${timeout}`);
  }
}

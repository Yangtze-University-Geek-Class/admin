import Database from "better-sqlite3";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";

export function createDatabase(path: string) {
if (path !== ":memory:") mkdirSync(dirname(path), { recursive: true });

const db = new Database(path);
db.pragma("journal_mode = WAL");
db.pragma("foreign_keys = ON");

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

// 论坛（#57，ADR-0004）：/api/forum/* 的全部数据。只新增 forum_* 表和索引，不改已有表。
// 编号是字符串（t73、body-73、p10001、m<GitHub id>、g<n>、n<n>、tag-<n>），与论坛前端的 ForumState 一致；
// 新编号从 forum_counters 取，不用时间或随机数。
db.exec(`
CREATE TABLE IF NOT EXISTS forum_counters (
  name TEXT PRIMARY KEY CHECK (name IN ('topic','post','notification','tag','guest')),
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
function audit(org: string | null, actor: string, action: string, target?: string, details?: unknown, ip?: string) {
  db.prepare(
    "INSERT INTO audit_logs(org, actor, action, target, details, ip, created_at) VALUES(?, ?, ?, ?, ?, ?, ?)"
  ).run(org, actor, action, target ?? null, details ? JSON.stringify(details) : null, ip ?? null, Date.now());
}

return { db, audit };
}

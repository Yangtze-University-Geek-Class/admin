import Database from "better-sqlite3";
import { mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";

const FORUM_DB_PATH =
  process.env.FORUM_DB_PATH ?? resolve(dirname(process.env.DB_PATH ?? "./data/data.db"), "forum.db");
mkdirSync(dirname(FORUM_DB_PATH), { recursive: true });

export const forumDb = new Database(FORUM_DB_PATH);
forumDb.pragma("journal_mode = WAL");
forumDb.pragma("foreign_keys = ON");

forumDb.exec(`
CREATE TABLE IF NOT EXISTS forum_users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  username TEXT NOT NULL UNIQUE,
  display_name TEXT,
  password_bcrypt TEXT,
  github_id INTEGER UNIQUE,
  github_login TEXT,
  email TEXT,
  avatar_url TEXT,
  signature TEXT,
  bio TEXT,
  role TEXT NOT NULL DEFAULT 'member',
  legacy_mbbs_id INTEGER UNIQUE,
  legacy_qq_uid TEXT,
  thread_count INTEGER NOT NULL DEFAULT 0,
  post_count INTEGER NOT NULL DEFAULT 0,
  liked_count INTEGER NOT NULL DEFAULT 0,
  last_seen_at INTEGER,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_forum_users_github_login ON forum_users(github_login);
CREATE INDEX IF NOT EXISTS idx_forum_users_legacy_mbbs_id ON forum_users(legacy_mbbs_id);

CREATE TABLE IF NOT EXISTS forum_categories (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  slug TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  description TEXT,
  icon TEXT,
  color TEXT,
  parent_id INTEGER,
  sort INTEGER NOT NULL DEFAULT 0,
  hidden INTEGER NOT NULL DEFAULT 0,
  thread_count INTEGER NOT NULL DEFAULT 0,
  legacy_mbbs_id INTEGER UNIQUE,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  FOREIGN KEY (parent_id) REFERENCES forum_categories(id)
);
CREATE INDEX IF NOT EXISTS idx_forum_categories_parent ON forum_categories(parent_id, sort);

CREATE TABLE IF NOT EXISTS forum_tags (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  slug TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  color TEXT,
  bg_color TEXT,
  description TEXT,
  legacy_mbbs_id INTEGER UNIQUE,
  created_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS forum_threads (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  category_id INTEGER NOT NULL,
  user_id INTEGER NOT NULL,
  title TEXT NOT NULL,
  content TEXT NOT NULL,
  content_format TEXT NOT NULL DEFAULT 'markdown',
  view_count INTEGER NOT NULL DEFAULT 0,
  reply_count INTEGER NOT NULL DEFAULT 0,
  is_sticky INTEGER NOT NULL DEFAULT 0,
  is_essence INTEGER NOT NULL DEFAULT 0,
  is_locked INTEGER NOT NULL DEFAULT 0,
  is_deleted INTEGER NOT NULL DEFAULT 0,
  last_posted_user_id INTEGER,
  last_posted_at INTEGER,
  legacy_mbbs_id INTEGER UNIQUE,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  FOREIGN KEY (category_id) REFERENCES forum_categories(id),
  FOREIGN KEY (user_id) REFERENCES forum_users(id)
);
CREATE INDEX IF NOT EXISTS idx_forum_threads_category_sticky ON forum_threads(category_id, is_sticky DESC, last_posted_at DESC);
CREATE INDEX IF NOT EXISTS idx_forum_threads_user ON forum_threads(user_id);
CREATE INDEX IF NOT EXISTS idx_forum_threads_last_posted ON forum_threads(last_posted_at DESC);

CREATE TABLE IF NOT EXISTS forum_posts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  thread_id INTEGER NOT NULL,
  user_id INTEGER NOT NULL,
  reply_post_id INTEGER,
  content TEXT NOT NULL,
  content_format TEXT NOT NULL DEFAULT 'markdown',
  like_count INTEGER NOT NULL DEFAULT 0,
  is_deleted INTEGER NOT NULL DEFAULT 0,
  legacy_mbbs_id INTEGER UNIQUE,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  FOREIGN KEY (thread_id) REFERENCES forum_threads(id),
  FOREIGN KEY (user_id) REFERENCES forum_users(id)
);
CREATE INDEX IF NOT EXISTS idx_forum_posts_thread ON forum_posts(thread_id, created_at);
CREATE INDEX IF NOT EXISTS idx_forum_posts_user ON forum_posts(user_id);

CREATE TABLE IF NOT EXISTS forum_thread_tags (
  thread_id INTEGER NOT NULL,
  tag_id INTEGER NOT NULL,
  PRIMARY KEY (thread_id, tag_id),
  FOREIGN KEY (thread_id) REFERENCES forum_threads(id),
  FOREIGN KEY (tag_id) REFERENCES forum_tags(id)
);

CREATE TABLE IF NOT EXISTS forum_likes (
  user_id INTEGER NOT NULL,
  post_id INTEGER NOT NULL,
  created_at INTEGER NOT NULL,
  PRIMARY KEY (user_id, post_id),
  FOREIGN KEY (user_id) REFERENCES forum_users(id),
  FOREIGN KEY (post_id) REFERENCES forum_posts(id)
);

CREATE TABLE IF NOT EXISTS forum_notifications (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL,
  from_user_id INTEGER,
  type TEXT NOT NULL,
  thread_id INTEGER,
  post_id INTEGER,
  title TEXT,
  body TEXT,
  read_at INTEGER,
  created_at INTEGER NOT NULL,
  FOREIGN KEY (user_id) REFERENCES forum_users(id)
);
CREATE INDEX IF NOT EXISTS idx_forum_notifications_user_unread ON forum_notifications(user_id, read_at, created_at DESC);

CREATE TABLE IF NOT EXISTS forum_settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS forum_sessions (
  id TEXT PRIMARY KEY,
  user_id INTEGER NOT NULL,
  source TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL,
  FOREIGN KEY (user_id) REFERENCES forum_users(id)
);
CREATE INDEX IF NOT EXISTS idx_forum_sessions_user ON forum_sessions(user_id);

CREATE TABLE IF NOT EXISTS forum_groups (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL UNIQUE,
  description TEXT,
  icon TEXT,
  color TEXT,
  is_default INTEGER NOT NULL DEFAULT 0,
  sort INTEGER NOT NULL DEFAULT 0,
  legacy_mbbs_id INTEGER UNIQUE,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS forum_group_permissions (
  group_id INTEGER NOT NULL,
  permission TEXT NOT NULL,
  PRIMARY KEY (group_id, permission),
  FOREIGN KEY (group_id) REFERENCES forum_groups(id)
);
CREATE INDEX IF NOT EXISTS idx_forum_group_perm_perm ON forum_group_permissions(permission);

CREATE TABLE IF NOT EXISTS forum_user_groups (
  user_id INTEGER NOT NULL,
  group_id INTEGER NOT NULL,
  PRIMARY KEY (user_id, group_id),
  FOREIGN KEY (user_id) REFERENCES forum_users(id),
  FOREIGN KEY (group_id) REFERENCES forum_groups(id)
);
CREATE INDEX IF NOT EXISTS idx_forum_user_groups_group ON forum_user_groups(group_id);
`);

export type ForumUser = {
  id: number;
  username: string;
  display_name: string | null;
  password_bcrypt: string | null;
  github_id: number | null;
  github_login: string | null;
  email: string | null;
  avatar_url: string | null;
  signature: string | null;
  bio: string | null;
  role: string;
  legacy_mbbs_id: number | null;
  legacy_qq_uid: string | null;
  thread_count: number;
  post_count: number;
  liked_count: number;
  last_seen_at: number | null;
  created_at: number;
  updated_at: number;
};

export type ForumCategory = {
  id: number;
  slug: string;
  name: string;
  description: string | null;
  icon: string | null;
  color: string | null;
  parent_id: number | null;
  sort: number;
  hidden: number;
  thread_count: number;
  legacy_mbbs_id: number | null;
  created_at: number;
  updated_at: number;
};

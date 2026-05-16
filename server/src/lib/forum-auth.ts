import { randomBytes } from "node:crypto";
import { forumDb, type ForumUser } from "./forum-db.js";

const FORUM_SESSION_TTL_MS = 14 * 24 * 60 * 60 * 1000;

export function createForumSession(userId: number, source: "password" | "github" | "bind"): string {
  const id = randomBytes(24).toString("base64url");
  const now = Date.now();
  forumDb
    .prepare("INSERT INTO forum_sessions (id, user_id, source, created_at, expires_at) VALUES (?, ?, ?, ?, ?)")
    .run(id, userId, source, now, now + FORUM_SESSION_TTL_MS);
  forumDb.prepare("UPDATE forum_users SET last_seen_at = ? WHERE id = ?").run(now, userId);
  return id;
}

export function getForumUserBySession(sid: string): ForumUser | null {
  const row = forumDb
    .prepare(
      `SELECT u.* FROM forum_users u
       JOIN forum_sessions s ON s.user_id = u.id
       WHERE s.id = ? AND s.expires_at > ?`,
    )
    .get(sid, Date.now()) as ForumUser | undefined;
  return row ?? null;
}

export function destroyForumSession(sid: string) {
  forumDb.prepare("DELETE FROM forum_sessions WHERE id = ?").run(sid);
}

export function publicForumUser(u: ForumUser) {
  return {
    id: u.id,
    username: u.username,
    display_name: u.display_name,
    avatar_url: u.avatar_url,
    role: u.role,
    signature: u.signature,
    bio: u.bio,
    github_login: u.github_login,
    thread_count: u.thread_count,
    post_count: u.post_count,
    liked_count: u.liked_count,
    last_seen_at: u.last_seen_at,
    created_at: u.created_at,
  };
}

export function selfForumUser(u: ForumUser) {
  return {
    ...publicForumUser(u),
    email: u.email,
    has_password: Boolean(u.password_bcrypt),
    has_github: Boolean(u.github_id),
    legacy_mbbs_id: u.legacy_mbbs_id,
  };
}

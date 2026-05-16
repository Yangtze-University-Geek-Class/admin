import type { FastifyInstance } from "fastify";
import { forumDb } from "../../lib/forum-db.js";
import { requireForumTeacherOrAdmin } from "../../middleware/require-forum-auth.js";

const DAY_MS = 24 * 60 * 60 * 1000;

export default async function forumTeacherRoutes(app: FastifyInstance) {
  app.get(
    "/api/forum/teacher/overview",
    { preHandler: requireForumTeacherOrAdmin },
    async () => {
      const now = Date.now();
      const counts = {
        total_members: (forumDb.prepare("SELECT COUNT(*) AS c FROM forum_users WHERE role != 'banned'").get() as any).c,
        admin: (forumDb.prepare("SELECT COUNT(*) AS c FROM forum_users WHERE role = 'admin'").get() as any).c,
        teacher: (forumDb.prepare("SELECT COUNT(*) AS c FROM forum_users WHERE role = 'teacher'").get() as any).c,
        member: (forumDb.prepare("SELECT COUNT(*) AS c FROM forum_users WHERE role = 'member'").get() as any).c,
        banned: (forumDb.prepare("SELECT COUNT(*) AS c FROM forum_users WHERE role = 'banned'").get() as any).c,
        threads_total: (forumDb
          .prepare(
            `SELECT COUNT(*) AS c FROM forum_threads t JOIN forum_categories c ON c.id = t.category_id
             WHERE t.is_deleted = 0 AND c.is_legacy = 0`,
          )
          .get() as any).c,
        posts_total: (forumDb
          .prepare(
            `SELECT COUNT(*) AS c FROM forum_posts p JOIN forum_threads t ON t.id = p.thread_id JOIN forum_categories c ON c.id = t.category_id
             WHERE p.is_deleted = 0 AND c.is_legacy = 0`,
          )
          .get() as any).c,
        threads_today: (forumDb
          .prepare(
            `SELECT COUNT(*) AS c FROM forum_threads t JOIN forum_categories c ON c.id = t.category_id
             WHERE t.is_deleted = 0 AND c.is_legacy = 0 AND t.created_at > ?`,
          )
          .get(now - DAY_MS) as any).c,
        posts_today: (forumDb
          .prepare(
            `SELECT COUNT(*) AS c FROM forum_posts p JOIN forum_threads t ON t.id = p.thread_id JOIN forum_categories c ON c.id = t.category_id
             WHERE p.is_deleted = 0 AND c.is_legacy = 0 AND p.created_at > ?`,
          )
          .get(now - DAY_MS) as any).c,
        active_users_7d: (forumDb
          .prepare("SELECT COUNT(DISTINCT id) AS c FROM forum_users WHERE last_seen_at > ?")
          .get(now - 7 * DAY_MS) as any).c,
      };

      const category_breakdown = forumDb
        .prepare(
          `SELECT c.id, c.slug, c.name, c.thread_count,
                  (SELECT COUNT(*) FROM forum_posts p JOIN forum_threads t ON t.id = p.thread_id
                   WHERE t.category_id = c.id AND p.is_deleted = 0) AS post_count
           FROM forum_categories c WHERE c.is_legacy = 0 AND c.hidden = 0 ORDER BY c.sort, c.id`,
        )
        .all();

      const top_contributors = forumDb
        .prepare(
          `SELECT id, username, display_name, avatar_url, role, thread_count, post_count, liked_count
           FROM forum_users WHERE role != 'banned'
           ORDER BY (thread_count * 3 + post_count + liked_count) DESC LIMIT 10`,
        )
        .all();

      const recent_threads = forumDb
        .prepare(
          `SELECT t.id, t.title, t.created_at, t.reply_count, t.view_count,
                  u.id AS u_id, u.username AS u_username, u.display_name AS u_display_name, u.avatar_url AS u_avatar_url, u.role AS u_role,
                  c.slug AS c_slug, c.name AS c_name
           FROM forum_threads t JOIN forum_users u ON u.id = t.user_id JOIN forum_categories c ON c.id = t.category_id
           WHERE t.is_deleted = 0 AND c.is_legacy = 0 ORDER BY t.created_at DESC LIMIT 15`,
        )
        .all();

      const recent_signups = forumDb
        .prepare(
          `SELECT id, username, display_name, avatar_url, role, github_login, created_at
           FROM forum_users ORDER BY created_at DESC LIMIT 10`,
        )
        .all();

      return {
        counts,
        category_breakdown,
        top_contributors,
        recent_threads: (recent_threads as any[]).map((r) => ({
          id: r.id,
          title: r.title,
          created_at: r.created_at,
          reply_count: r.reply_count,
          view_count: r.view_count,
          author: { id: r.u_id, username: r.u_username, display_name: r.u_display_name, avatar_url: r.u_avatar_url, role: r.u_role },
          category: { slug: r.c_slug, name: r.c_name },
        })),
        recent_signups,
      };
    },
  );
}

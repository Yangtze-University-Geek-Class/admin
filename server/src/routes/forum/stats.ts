import type { FastifyInstance } from "fastify";
import { forumDb } from "../../lib/forum-db.js";

export default async function forumStatsRoutes(app: FastifyInstance) {
  app.get("/api/forum/stats", async () => {
    const members = (forumDb.prepare("SELECT COUNT(*) AS c FROM forum_users WHERE role != 'banned'").get() as any).c;
    const threads = (forumDb
      .prepare(
        `SELECT COUNT(*) AS c FROM forum_threads t
         JOIN forum_categories c ON c.id = t.category_id
         WHERE t.is_deleted = 0 AND c.is_legacy = 0`,
      )
      .get() as any).c;
    const posts = (forumDb
      .prepare(
        `SELECT COUNT(*) AS c FROM forum_posts p
         JOIN forum_threads t ON t.id = p.thread_id
         JOIN forum_categories c ON c.id = t.category_id
         WHERE p.is_deleted = 0 AND c.is_legacy = 0`,
      )
      .get() as any).c;
    const categories = (forumDb
      .prepare("SELECT COUNT(*) AS c FROM forum_categories WHERE hidden = 0 AND is_legacy = 0")
      .get() as any).c;

    const newCats = forumDb
      .prepare(
        `SELECT id, slug, name, description, thread_count
         FROM forum_categories
         WHERE is_legacy = 0 AND hidden = 0
         ORDER BY sort, id`,
      )
      .all();

    const archive = {
      threads: (forumDb
        .prepare(
          `SELECT COUNT(*) AS c FROM forum_threads t
           JOIN forum_categories c ON c.id = t.category_id
           WHERE t.is_deleted = 0 AND c.is_legacy = 1`,
        )
        .get() as any).c,
      categories: (forumDb
        .prepare("SELECT COUNT(*) AS c FROM forum_categories WHERE hidden = 0 AND is_legacy = 1")
        .get() as any).c,
    };

    const recent = forumDb
      .prepare(
        `SELECT t.id, t.title, t.created_at, t.reply_count, t.view_count,
                u.username AS u_username, u.display_name AS u_display_name,
                c.slug AS c_slug, c.name AS c_name
         FROM forum_threads t
         JOIN forum_users u ON u.id = t.user_id
         JOIN forum_categories c ON c.id = t.category_id
         WHERE t.is_deleted = 0 AND c.hidden = 0 AND c.is_legacy = 0
         ORDER BY t.last_posted_at DESC LIMIT 8`,
      )
      .all();

    return {
      counts: { members, threads, posts, categories },
      groups: newCats,
      archive,
      recent_threads: recent.map((r: any) => ({
        id: r.id,
        title: r.title,
        created_at: r.created_at,
        reply_count: r.reply_count,
        view_count: r.view_count,
        author: { username: r.u_username, display_name: r.u_display_name },
        category: { slug: r.c_slug, name: r.c_name },
      })),
    };
  });
}

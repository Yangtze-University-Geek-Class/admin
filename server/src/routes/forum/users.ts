import type { FastifyInstance } from "fastify";
import { forumDb } from "../../lib/forum-db.js";
import { publicForumUser } from "../../lib/forum-auth.js";
import { requireForumAuth } from "../../middleware/require-forum-auth.js";

export default async function forumUsersRoutes(app: FastifyInstance) {
  app.get<{ Params: { username: string } }>("/api/forum/users/:username", async (req, reply) => {
    const user = forumDb
      .prepare("SELECT * FROM forum_users WHERE lower(username) = lower(?)")
      .get(req.params.username) as any;
    if (!user) return reply.code(404).send({ error: "not_found" });
    const recentThreads = forumDb
      .prepare(
        `SELECT t.id, t.title, t.reply_count, t.view_count, t.created_at, c.slug AS category_slug, c.name AS category_name
         FROM forum_threads t JOIN forum_categories c ON c.id = t.category_id
         WHERE t.user_id = ? AND t.is_deleted = 0 ORDER BY t.created_at DESC LIMIT 10`,
      )
      .all(user.id);
    return { user: publicForumUser(user), recent_threads: recentThreads };
  });

  app.patch<{ Body: { display_name?: string; signature?: string; bio?: string; email?: string; avatar_url?: string } }>(
    "/api/forum/me/profile",
    { preHandler: requireForumAuth },
    async (req, reply) => {
      const fields: string[] = [];
      const values: any[] = [];
      for (const k of ["display_name", "signature", "bio", "email", "avatar_url"] as const) {
        if (req.body && k in req.body) { fields.push(`${k} = ?`); values.push((req.body as any)[k]); }
      }
      if (!fields.length) return reply.code(400).send({ error: "no_changes" });
      fields.push("updated_at = ?");
      values.push(Date.now(), req.forumUser!.id);
      forumDb.prepare(`UPDATE forum_users SET ${fields.join(", ")} WHERE id = ?`).run(...values);
      return { ok: true };
    },
  );

  app.get("/api/forum/me/notifications", { preHandler: requireForumAuth }, async (req) => {
    const rows = forumDb
      .prepare(
        `SELECT n.*, u.username AS from_username, u.display_name AS from_display_name, u.avatar_url AS from_avatar_url
         FROM forum_notifications n
         LEFT JOIN forum_users u ON u.id = n.from_user_id
         WHERE n.user_id = ? ORDER BY n.created_at DESC LIMIT 50`,
      )
      .all(req.forumUser!.id);
    const unread = (forumDb
      .prepare("SELECT COUNT(*) AS c FROM forum_notifications WHERE user_id = ? AND read_at IS NULL")
      .get(req.forumUser!.id) as any).c;
    return { notifications: rows, unread };
  });

  app.post("/api/forum/me/notifications/read-all", { preHandler: requireForumAuth }, async (req) => {
    forumDb
      .prepare("UPDATE forum_notifications SET read_at = ? WHERE user_id = ? AND read_at IS NULL")
      .run(Date.now(), req.forumUser!.id);
    return { ok: true };
  });
}

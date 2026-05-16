import type { FastifyInstance } from "fastify";
import { forumDb } from "../../lib/forum-db.js";
import { requireForumAuth } from "../../middleware/require-forum-auth.js";

export default async function forumPostsRoutes(app: FastifyInstance) {
  app.post<{ Body: { thread_id: number; content: string; reply_post_id?: number; content_format?: "markdown" | "html" } }>(
    "/api/forum/posts",
    { preHandler: requireForumAuth },
    async (req, reply) => {
      const { thread_id, content, reply_post_id, content_format } = req.body ?? ({} as any);
      if (!thread_id || !content) return reply.code(400).send({ error: "missing_fields" });
      const t = forumDb.prepare("SELECT * FROM forum_threads WHERE id = ? AND is_deleted = 0").get(thread_id) as any;
      if (!t) return reply.code(404).send({ error: "thread_not_found" });
      if (t.is_locked && req.forumUser!.role === "member") {
        return reply.code(403).send({ error: "thread_locked" });
      }
      const now = Date.now();
      const r = forumDb
        .prepare(
          `INSERT INTO forum_posts (thread_id, user_id, reply_post_id, content, content_format, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, ?)`,
        )
        .run(thread_id, req.forumUser!.id, reply_post_id ?? null, content, content_format ?? "markdown", now, now);
      forumDb
        .prepare("UPDATE forum_threads SET reply_count = reply_count + 1, last_posted_user_id = ?, last_posted_at = ?, updated_at = ? WHERE id = ?")
        .run(req.forumUser!.id, now, now, thread_id);
      forumDb.prepare("UPDATE forum_users SET post_count = post_count + 1 WHERE id = ?").run(req.forumUser!.id);

      if (t.user_id !== req.forumUser!.id) {
        forumDb
          .prepare(
            `INSERT INTO forum_notifications (user_id, from_user_id, type, thread_id, post_id, title, created_at)
             VALUES (?, ?, 'reply', ?, ?, ?, ?)`,
          )
          .run(t.user_id, req.forumUser!.id, thread_id, Number(r.lastInsertRowid), t.title, now);
      }
      if (reply_post_id) {
        const parent = forumDb.prepare("SELECT user_id FROM forum_posts WHERE id = ?").get(reply_post_id) as any;
        if (parent && parent.user_id !== req.forumUser!.id && parent.user_id !== t.user_id) {
          forumDb
            .prepare(
              `INSERT INTO forum_notifications (user_id, from_user_id, type, thread_id, post_id, title, created_at)
               VALUES (?, ?, 'reply', ?, ?, ?, ?)`,
            )
            .run(parent.user_id, req.forumUser!.id, thread_id, Number(r.lastInsertRowid), t.title, now);
        }
      }
      return { ok: true, id: r.lastInsertRowid };
    },
  );

  app.delete<{ Params: { id: string } }>(
    "/api/forum/posts/:id",
    { preHandler: requireForumAuth },
    async (req, reply) => {
      const id = Number(req.params.id);
      const p = forumDb.prepare("SELECT * FROM forum_posts WHERE id = ?").get(id) as any;
      if (!p) return reply.code(404).send({ error: "not_found" });
      const user = req.forumUser!;
      if (p.user_id !== user.id && user.role !== "admin" && user.role !== "mod") {
        return reply.code(403).send({ error: "forbidden" });
      }
      forumDb.prepare("UPDATE forum_posts SET is_deleted = 1, updated_at = ? WHERE id = ?").run(Date.now(), id);
      forumDb.prepare("UPDATE forum_threads SET reply_count = MAX(0, reply_count - 1) WHERE id = ?").run(p.thread_id);
      return { ok: true };
    },
  );

  app.post<{ Params: { id: string } }>(
    "/api/forum/posts/:id/like",
    { preHandler: requireForumAuth },
    async (req, reply) => {
      const id = Number(req.params.id);
      const p = forumDb.prepare("SELECT * FROM forum_posts WHERE id = ? AND is_deleted = 0").get(id) as any;
      if (!p) return reply.code(404).send({ error: "not_found" });
      const exists = forumDb
        .prepare("SELECT 1 FROM forum_likes WHERE user_id = ? AND post_id = ?")
        .get(req.forumUser!.id, id);
      if (exists) {
        forumDb.prepare("DELETE FROM forum_likes WHERE user_id = ? AND post_id = ?").run(req.forumUser!.id, id);
        forumDb.prepare("UPDATE forum_posts SET like_count = MAX(0, like_count - 1) WHERE id = ?").run(id);
        forumDb.prepare("UPDATE forum_users SET liked_count = MAX(0, liked_count - 1) WHERE id = ?").run(p.user_id);
        return { ok: true, liked: false };
      } else {
        forumDb
          .prepare("INSERT INTO forum_likes (user_id, post_id, created_at) VALUES (?, ?, ?)")
          .run(req.forumUser!.id, id, Date.now());
        forumDb.prepare("UPDATE forum_posts SET like_count = like_count + 1 WHERE id = ?").run(id);
        forumDb.prepare("UPDATE forum_users SET liked_count = liked_count + 1 WHERE id = ?").run(p.user_id);
        return { ok: true, liked: true };
      }
    },
  );
}

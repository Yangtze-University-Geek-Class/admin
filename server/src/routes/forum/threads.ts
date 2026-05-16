import type { FastifyInstance } from "fastify";
import { forumDb } from "../../lib/forum-db.js";
import { publicForumUser } from "../../lib/forum-auth.js";
import { attachForumUser, requireForumAuth } from "../../middleware/require-forum-auth.js";
import { hasCategoryPermission, hasPermission } from "../../lib/forum-permissions.js";

const PAGE_SIZE = 20;

export default async function forumThreadsRoutes(app: FastifyInstance) {
  app.get<{ Querystring: { category?: string; page?: string; q?: string; sort?: "latest" | "hot" } }>(
    "/api/forum/threads",
    async (req) => {
      const page = Math.max(1, Number(req.query.page ?? 1));
      const offset = (page - 1) * PAGE_SIZE;
      const where: string[] = ["t.is_deleted = 0"];
      const args: any[] = [];
      if (req.query.category) {
        const cat = forumDb.prepare("SELECT id FROM forum_categories WHERE slug = ?").get(req.query.category) as any;
        if (cat) {
          where.push("(t.category_id = ? OR t.category_id IN (SELECT id FROM forum_categories WHERE parent_id = ?))");
          args.push(cat.id, cat.id);
        }
      }
      if (req.query.q) {
        where.push("t.title LIKE ?");
        args.push(`%${req.query.q}%`);
      }
      const orderBy = req.query.sort === "hot"
        ? "t.view_count DESC, t.reply_count DESC, t.last_posted_at DESC"
        : "t.is_sticky DESC, t.last_posted_at DESC";
      const sql = `
        SELECT t.*,
               u.id AS u_id, u.username AS u_username, u.display_name AS u_display_name, u.avatar_url AS u_avatar_url, u.role AS u_role,
               lu.id AS lu_id, lu.username AS lu_username, lu.display_name AS lu_display_name, lu.avatar_url AS lu_avatar_url,
               c.slug AS category_slug, c.name AS category_name
        FROM forum_threads t
        JOIN forum_users u ON u.id = t.user_id
        LEFT JOIN forum_users lu ON lu.id = t.last_posted_user_id
        JOIN forum_categories c ON c.id = t.category_id
        WHERE ${where.join(" AND ")}
        ORDER BY ${orderBy}
        LIMIT ? OFFSET ?`;
      const rows = forumDb.prepare(sql).all(...args, PAGE_SIZE, offset) as any[];
      const total = (forumDb
        .prepare(`SELECT COUNT(*) AS c FROM forum_threads t WHERE ${where.join(" AND ")}`)
        .get(...args) as any).c;
      return {
        threads: rows.map((r) => ({
          id: r.id,
          title: r.title,
          view_count: r.view_count,
          reply_count: r.reply_count,
          is_sticky: r.is_sticky,
          is_essence: r.is_essence,
          is_locked: r.is_locked,
          last_posted_at: r.last_posted_at,
          created_at: r.created_at,
          author: { id: r.u_id, username: r.u_username, display_name: r.u_display_name, avatar_url: r.u_avatar_url, role: r.u_role },
          last_poster: r.lu_id ? { id: r.lu_id, username: r.lu_username, display_name: r.lu_display_name, avatar_url: r.lu_avatar_url } : null,
          category: { slug: r.category_slug, name: r.category_name },
        })),
        page, page_size: PAGE_SIZE, total,
      };
    },
  );

  app.get<{ Params: { id: string }; Querystring: { page?: string } }>(
    "/api/forum/threads/:id",
    async (req, reply) => {
      const id = Number(req.params.id);
      const t = forumDb
        .prepare(
          `SELECT t.*,
                  u.id AS u_id, u.username AS u_username, u.display_name AS u_display_name, u.avatar_url AS u_avatar_url, u.role AS u_role, u.signature AS u_signature,
                  c.slug AS category_slug, c.name AS category_name
           FROM forum_threads t
           JOIN forum_users u ON u.id = t.user_id
           JOIN forum_categories c ON c.id = t.category_id
           WHERE t.id = ? AND t.is_deleted = 0`,
        )
        .get(id) as any;
      if (!t) return reply.code(404).send({ error: "not_found" });
      forumDb.prepare("UPDATE forum_threads SET view_count = view_count + 1 WHERE id = ?").run(id);

      const page = Math.max(1, Number(req.query.page ?? 1));
      const offset = (page - 1) * PAGE_SIZE;
      const posts = forumDb
        .prepare(
          `SELECT p.*,
                  u.id AS u_id, u.username AS u_username, u.display_name AS u_display_name, u.avatar_url AS u_avatar_url, u.role AS u_role, u.signature AS u_signature
           FROM forum_posts p
           JOIN forum_users u ON u.id = p.user_id
           WHERE p.thread_id = ? AND p.is_deleted = 0
           ORDER BY p.created_at ASC
           LIMIT ? OFFSET ?`,
        )
        .all(id, PAGE_SIZE, offset) as any[];

      await attachForumUser(req);
      let likedPostIds = new Set<number>();
      if (req.forumUser) {
        const ids = posts.map((p) => p.id);
        if (ids.length) {
          const placeholders = ids.map(() => "?").join(",");
          const rows = forumDb
            .prepare(`SELECT post_id FROM forum_likes WHERE user_id = ? AND post_id IN (${placeholders})`)
            .all(req.forumUser.id, ...ids) as any[];
          likedPostIds = new Set(rows.map((r) => r.post_id));
        }
      }

      return {
        thread: {
          id: t.id,
          title: t.title,
          content: t.content,
          content_format: t.content_format,
          view_count: t.view_count + 1,
          reply_count: t.reply_count,
          is_sticky: t.is_sticky,
          is_essence: t.is_essence,
          is_locked: t.is_locked,
          last_posted_at: t.last_posted_at,
          created_at: t.created_at,
          updated_at: t.updated_at,
          author: { id: t.u_id, username: t.u_username, display_name: t.u_display_name, avatar_url: t.u_avatar_url, role: t.u_role, signature: t.u_signature },
          category: { slug: t.category_slug, name: t.category_name },
        },
        posts: posts.map((p) => ({
          id: p.id,
          content: p.content,
          content_format: p.content_format,
          like_count: p.like_count,
          liked: likedPostIds.has(p.id),
          reply_post_id: p.reply_post_id,
          created_at: p.created_at,
          author: { id: p.u_id, username: p.u_username, display_name: p.u_display_name, avatar_url: p.u_avatar_url, role: p.u_role, signature: p.u_signature },
        })),
        page, page_size: PAGE_SIZE,
      };
    },
  );

  app.post<{ Body: { category_id: number; title: string; content: string; content_format?: "markdown" | "html" } }>(
    "/api/forum/threads",
    { preHandler: requireForumAuth },
    async (req, reply) => {
      const { category_id, title, content, content_format } = req.body ?? ({} as any);
      if (!category_id || !title || !content) return reply.code(400).send({ error: "missing_fields" });
      if (title.length > 200) return reply.code(400).send({ error: "title_too_long" });
      const cat = forumDb.prepare("SELECT id, legacy_mbbs_id FROM forum_categories WHERE id = ?").get(category_id) as any;
      if (!cat) return reply.code(400).send({ error: "invalid_category" });
      if (!hasCategoryPermission(req.forumUser!.id, cat.legacy_mbbs_id, "createThread", req.forumUser!.role)) {
        return reply.code(403).send({ error: "forbidden", message: "你所在的组没有在此分类发帖的权限" });
      }
      const now = Date.now();
      const r = forumDb
        .prepare(
          `INSERT INTO forum_threads (category_id, user_id, title, content, content_format, last_posted_user_id, last_posted_at, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        )
        .run(category_id, req.forumUser!.id, title, content, content_format ?? "markdown", req.forumUser!.id, now, now, now);
      forumDb.prepare("UPDATE forum_users SET thread_count = thread_count + 1 WHERE id = ?").run(req.forumUser!.id);
      forumDb.prepare("UPDATE forum_categories SET thread_count = thread_count + 1 WHERE id = ?").run(category_id);
      return { ok: true, id: r.lastInsertRowid };
    },
  );

  app.patch<{ Params: { id: string }; Body: { title?: string; content?: string; is_sticky?: number; is_essence?: number; is_locked?: number } }>(
    "/api/forum/threads/:id",
    { preHandler: requireForumAuth },
    async (req, reply) => {
      const id = Number(req.params.id);
      const t = forumDb.prepare("SELECT * FROM forum_threads WHERE id = ?").get(id) as any;
      if (!t) return reply.code(404).send({ error: "not_found" });
      const user = req.forumUser!;
      const isOwner = t.user_id === user.id;
      const isMod = user.role === "admin" || user.role === "mod";
      if (!isOwner && !isMod) return reply.code(403).send({ error: "forbidden" });

      const fields: string[] = [];
      const values: any[] = [];
      if (req.body?.title !== undefined) { fields.push("title = ?"); values.push(req.body.title); }
      if (req.body?.content !== undefined) { fields.push("content = ?"); values.push(req.body.content); }
      if (isMod) {
        for (const k of ["is_sticky", "is_essence", "is_locked"] as const) {
          if (req.body && k in req.body) { fields.push(`${k} = ?`); values.push((req.body as any)[k]); }
        }
      }
      if (!fields.length) return reply.code(400).send({ error: "no_changes" });
      fields.push("updated_at = ?");
      values.push(Date.now(), id);
      forumDb.prepare(`UPDATE forum_threads SET ${fields.join(", ")} WHERE id = ?`).run(...values);
      return { ok: true };
    },
  );

  app.delete<{ Params: { id: string } }>(
    "/api/forum/threads/:id",
    { preHandler: requireForumAuth },
    async (req, reply) => {
      const id = Number(req.params.id);
      const t = forumDb.prepare("SELECT * FROM forum_threads WHERE id = ?").get(id) as any;
      if (!t) return reply.code(404).send({ error: "not_found" });
      const user = req.forumUser!;
      if (t.user_id !== user.id && user.role !== "admin" && user.role !== "mod") {
        return reply.code(403).send({ error: "forbidden" });
      }
      forumDb.prepare("UPDATE forum_threads SET is_deleted = 1, updated_at = ? WHERE id = ?").run(Date.now(), id);
      forumDb.prepare("UPDATE forum_categories SET thread_count = MAX(0, thread_count - 1) WHERE id = ?").run(t.category_id);
      return { ok: true };
    },
  );
}

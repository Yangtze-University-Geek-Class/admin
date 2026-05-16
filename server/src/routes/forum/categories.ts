import type { FastifyInstance } from "fastify";
import { forumDb } from "../../lib/forum-db.js";
import { requireForumAdmin } from "../../middleware/require-forum-auth.js";

export default async function forumCategoriesRoutes(app: FastifyInstance) {
  app.get<{ Querystring: { include_legacy?: string } }>(
    "/api/forum/categories",
    async (req) => {
      const includeLegacy = req.query.include_legacy === "1";
      const where = includeLegacy ? "hidden = 0" : "hidden = 0 AND is_legacy = 0";
      const cats = forumDb
        .prepare(
          `SELECT id, slug, name, description, icon, color, parent_id, sort, hidden, is_legacy, thread_count
           FROM forum_categories
           WHERE ${where}
           ORDER BY COALESCE(parent_id, id), sort, id`,
        )
        .all();
      return { categories: cats };
    },
  );

  app.get("/api/forum/archive/categories", async () => {
    const cats = forumDb
      .prepare(
        `SELECT id, slug, name, description, icon, color, parent_id, sort, thread_count
         FROM forum_categories
         WHERE is_legacy = 1 AND hidden = 0
         ORDER BY COALESCE(parent_id, id), sort, id`,
      )
      .all();
    return { categories: cats };
  });

  app.post<{ Body: { slug: string; name: string; description?: string; parent_id?: number | null; color?: string; icon?: string; sort?: number } }>(
    "/api/forum/categories",
    { preHandler: requireForumAdmin },
    async (req, reply) => {
      const { slug, name, description, parent_id, color, icon, sort } = req.body ?? ({} as any);
      if (!slug || !name) return reply.code(400).send({ error: "missing_fields" });
      const dup = forumDb.prepare("SELECT id FROM forum_categories WHERE slug = ?").get(slug);
      if (dup) return reply.code(409).send({ error: "slug_taken" });
      const now = Date.now();
      const r = forumDb
        .prepare(
          `INSERT INTO forum_categories (slug, name, description, icon, color, parent_id, sort, hidden, thread_count, is_legacy, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, 0, 0, 0, ?, ?)`,
        )
        .run(slug, name, description ?? null, icon ?? null, color ?? null, parent_id ?? null, sort ?? 0, now, now);
      return { ok: true, id: r.lastInsertRowid };
    },
  );

  app.patch<{ Params: { id: string }; Body: Partial<{ name: string; description: string; color: string; icon: string; sort: number; hidden: number; parent_id: number | null }> }>(
    "/api/forum/categories/:id",
    { preHandler: requireForumAdmin },
    async (req, reply) => {
      const id = Number(req.params.id);
      const cur = forumDb.prepare("SELECT id FROM forum_categories WHERE id = ?").get(id);
      if (!cur) return reply.code(404).send({ error: "not_found" });
      const fields: string[] = [];
      const values: any[] = [];
      for (const k of ["name", "description", "color", "icon", "sort", "hidden", "parent_id"] as const) {
        if (req.body && k in req.body) {
          fields.push(`${k} = ?`);
          values.push((req.body as any)[k]);
        }
      }
      if (!fields.length) return reply.code(400).send({ error: "no_changes" });
      fields.push("updated_at = ?");
      values.push(Date.now(), id);
      forumDb.prepare(`UPDATE forum_categories SET ${fields.join(", ")} WHERE id = ?`).run(...values);
      return { ok: true };
    },
  );

  app.delete<{ Params: { id: string } }>(
    "/api/forum/categories/:id",
    { preHandler: requireForumAdmin },
    async (req, reply) => {
      const id = Number(req.params.id);
      const hasThreads = forumDb
        .prepare("SELECT 1 FROM forum_threads WHERE category_id = ? AND is_deleted = 0 LIMIT 1")
        .get(id);
      if (hasThreads) return reply.code(409).send({ error: "has_threads" });
      const hasChildren = forumDb.prepare("SELECT 1 FROM forum_categories WHERE parent_id = ? LIMIT 1").get(id);
      if (hasChildren) return reply.code(409).send({ error: "has_children" });
      forumDb.prepare("DELETE FROM forum_categories WHERE id = ?").run(id);
      return { ok: true };
    },
  );
}

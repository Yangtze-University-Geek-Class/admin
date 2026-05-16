import type { FastifyInstance } from "fastify";
import { forumDb } from "../../lib/forum-db.js";
import { requireForumAdmin } from "../../middleware/require-forum-auth.js";

const VALID_ROLES = new Set(["member", "mod", "admin", "banned"]);

export default async function forumAdminUsersRoutes(app: FastifyInstance) {
  app.get<{ Querystring: { q?: string; page?: string; role?: string } }>(
    "/api/forum/admin/users",
    { preHandler: requireForumAdmin },
    async (req) => {
      const page = Math.max(1, Number(req.query.page ?? 1));
      const pageSize = 50;
      const offset = (page - 1) * pageSize;
      const where: string[] = [];
      const args: any[] = [];
      if (req.query.q) {
        where.push("(lower(username) LIKE ? OR lower(display_name) LIKE ? OR lower(github_login) LIKE ?)");
        const pat = `%${req.query.q.toLowerCase()}%`;
        args.push(pat, pat, pat);
      }
      if (req.query.role && VALID_ROLES.has(req.query.role)) {
        where.push("role = ?");
        args.push(req.query.role);
      }
      const whereSql = where.length ? `WHERE ${where.join(" AND ")}` : "";
      const rows = forumDb
        .prepare(
          `SELECT id, username, display_name, avatar_url, email, role, github_login, legacy_mbbs_id, thread_count, post_count, last_seen_at, created_at
           FROM forum_users ${whereSql} ORDER BY id DESC LIMIT ? OFFSET ?`,
        )
        .all(...args, pageSize, offset);
      const total = (forumDb
        .prepare(`SELECT COUNT(*) AS c FROM forum_users ${whereSql}`)
        .get(...args) as any).c;
      return { users: rows, page, page_size: pageSize, total };
    },
  );

  app.patch<{ Params: { id: string }; Body: { role?: string } }>(
    "/api/forum/admin/users/:id/role",
    { preHandler: requireForumAdmin },
    async (req, reply) => {
      const id = Number(req.params.id);
      const role = req.body?.role;
      if (!role || !VALID_ROLES.has(role)) return reply.code(400).send({ error: "invalid_role" });
      const target = forumDb.prepare("SELECT id, role FROM forum_users WHERE id = ?").get(id) as any;
      if (!target) return reply.code(404).send({ error: "not_found" });
      if (target.id === req.forumUser!.id && role !== "admin") {
        return reply.code(400).send({ error: "cannot_demote_self" });
      }
      forumDb.prepare("UPDATE forum_users SET role = ?, updated_at = ? WHERE id = ?").run(role, Date.now(), id);

      // sync group membership
      const adminGroup = forumDb.prepare("SELECT id FROM forum_groups WHERE name = '负责人'").get() as any;
      const memberGroup = forumDb.prepare("SELECT id FROM forum_groups WHERE name = '成员'").get() as any;
      forumDb.prepare("DELETE FROM forum_user_groups WHERE user_id = ? AND group_id IN (?, ?)").run(id, adminGroup?.id, memberGroup?.id);
      if (role === "admin" || role === "mod") {
        if (adminGroup) forumDb.prepare("INSERT OR IGNORE INTO forum_user_groups (user_id, group_id) VALUES (?, ?)").run(id, adminGroup.id);
      } else if (role === "member") {
        if (memberGroup) forumDb.prepare("INSERT OR IGNORE INTO forum_user_groups (user_id, group_id) VALUES (?, ?)").run(id, memberGroup.id);
      }
      return { ok: true };
    },
  );
}

import type { FastifyInstance } from "fastify";
import bcrypt from "bcryptjs";
import { forumDb } from "../../lib/forum-db.js";
import { requireForumAdmin, requireForumTeacherOrAdmin } from "../../middleware/require-forum-auth.js";
import { syncRoleToGroup } from "../../lib/forum-permissions.js";

const VALID_ROLES = new Set(["member", "mod", "admin", "teacher", "banned"]);

export default async function forumAdminUsersRoutes(app: FastifyInstance) {
  app.get<{ Querystring: { q?: string; page?: string; role?: string } }>(
    "/api/forum/admin/users",
    { preHandler: requireForumTeacherOrAdmin },
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
      syncRoleToGroup(id, role);
      return { ok: true };
    },
  );

  app.post<{ Body: { username: string; display_name?: string; email?: string; password: string } }>(
    "/api/forum/admin/teachers",
    { preHandler: requireForumAdmin },
    async (req, reply) => {
      const { username, display_name, email, password } = req.body ?? ({} as any);
      if (!username || !password) return reply.code(400).send({ error: "missing_fields" });
      if (!/^[a-zA-Z0-9_一-龥\-]{2,32}$/.test(username)) return reply.code(400).send({ error: "invalid_username" });
      if (password.length < 6) return reply.code(400).send({ error: "password_too_short" });
      const dup = forumDb
        .prepare("SELECT id FROM forum_users WHERE lower(username) = lower(?)")
        .get(username);
      if (dup) return reply.code(409).send({ error: "username_taken" });
      const hash = await bcrypt.hash(password, 10);
      const now = Date.now();
      const r = forumDb
        .prepare(
          `INSERT INTO forum_users (username, display_name, password_bcrypt, email, role, created_at, updated_at)
           VALUES (?, ?, ?, ?, 'teacher', ?, ?)`,
        )
        .run(username, display_name ?? username, hash, email ?? null, now, now);
      const userId = Number(r.lastInsertRowid);
      syncRoleToGroup(userId, "teacher");
      return { ok: true, user_id: userId, username, role: "teacher" };
    },
  );
}

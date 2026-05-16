import type { FastifyInstance } from "fastify";
import bcrypt from "bcryptjs";
import { forumDb } from "../../lib/forum-db.js";
import { requireForumAdmin, requireForumTeacherOrAdmin } from "../../middleware/require-forum-auth.js";

const VALID_ROLES = new Set(["member", "mod", "admin", "teacher", "banned"]);
const TEACHER_GROUP_NAME = "老师";
const ADMIN_GROUP_NAME = "负责人";
const MEMBER_GROUP_NAME = "成员";

function ensureGroup(name: string, isDefault: 0 | 1, sort: number, color: string | null, description: string) {
  const existing = forumDb.prepare("SELECT id FROM forum_groups WHERE name = ?").get(name) as any;
  if (existing) return existing.id as number;
  const now = Date.now();
  const r = forumDb
    .prepare(
      "INSERT INTO forum_groups (name, description, color, is_default, sort, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)",
    )
    .run(name, description, color, isDefault, sort, now, now);
  return Number(r.lastInsertRowid);
}

function syncRoleToGroup(userId: number, role: string) {
  const adminGid = ensureGroup(ADMIN_GROUP_NAME, 0, 3, "#003F88", "管理员，拥有全部权限");
  const memberGid = ensureGroup(MEMBER_GROUP_NAME, 0, 2, "#0969da", "登录用户");
  const teacherGid = ensureGroup(TEACHER_GROUP_NAME, 0, 4, "#7C3AED", "校内老师，可查看全部状态");
  forumDb
    .prepare("DELETE FROM forum_user_groups WHERE user_id = ? AND group_id IN (?, ?, ?)")
    .run(userId, adminGid, memberGid, teacherGid);
  const ins = forumDb.prepare("INSERT OR IGNORE INTO forum_user_groups (user_id, group_id) VALUES (?, ?)");
  if (role === "admin" || role === "mod") ins.run(userId, adminGid);
  else if (role === "teacher") ins.run(userId, teacherGid);
  else if (role === "member") ins.run(userId, memberGid);
}

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

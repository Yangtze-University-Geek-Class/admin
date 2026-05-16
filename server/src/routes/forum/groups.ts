import type { FastifyInstance } from "fastify";
import { forumDb } from "../../lib/forum-db.js";
import { requireForumAdmin } from "../../middleware/require-forum-auth.js";

export default async function forumGroupsRoutes(app: FastifyInstance) {
  app.get("/api/forum/groups", async () => {
    const groups = forumDb
      .prepare(
        `SELECT g.*, COUNT(ug.user_id) AS member_count,
                (SELECT COUNT(*) FROM forum_group_permissions WHERE group_id = g.id) AS permission_count
         FROM forum_groups g LEFT JOIN forum_user_groups ug ON ug.group_id = g.id
         GROUP BY g.id ORDER BY g.sort, g.id`,
      )
      .all();
    return { groups };
  });

  app.get<{ Params: { id: string } }>("/api/forum/groups/:id", async (req, reply) => {
    const id = Number(req.params.id);
    const g = forumDb.prepare("SELECT * FROM forum_groups WHERE id = ?").get(id) as any;
    if (!g) return reply.code(404).send({ error: "not_found" });
    const perms = forumDb
      .prepare("SELECT permission FROM forum_group_permissions WHERE group_id = ? ORDER BY permission")
      .all(id)
      .map((r: any) => r.permission);
    const members = forumDb
      .prepare(
        `SELECT u.id, u.username, u.display_name, u.avatar_url, u.role
         FROM forum_users u
         JOIN forum_user_groups ug ON ug.user_id = u.id
         WHERE ug.group_id = ?
         ORDER BY u.id`,
      )
      .all(id);
    return { group: g, permissions: perms, members };
  });

  app.post<{ Params: { id: string }; Body: { user_id: number } }>(
    "/api/forum/groups/:id/members",
    { preHandler: requireForumAdmin },
    async (req, reply) => {
      const groupId = Number(req.params.id);
      const userId = Number(req.body?.user_id);
      if (!userId) return reply.code(400).send({ error: "missing_user_id" });
      forumDb
        .prepare("INSERT OR IGNORE INTO forum_user_groups (user_id, group_id) VALUES (?, ?)")
        .run(userId, groupId);
      return { ok: true };
    },
  );

  app.delete<{ Params: { id: string; user_id: string } }>(
    "/api/forum/groups/:id/members/:user_id",
    { preHandler: requireForumAdmin },
    async (req) => {
      const groupId = Number(req.params.id);
      const userId = Number(req.params.user_id);
      forumDb
        .prepare("DELETE FROM forum_user_groups WHERE user_id = ? AND group_id = ?")
        .run(userId, groupId);
      return { ok: true };
    },
  );
}

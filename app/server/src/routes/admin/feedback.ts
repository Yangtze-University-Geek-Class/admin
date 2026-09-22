import type { FastifyInstance } from "fastify";
import { requireAuth } from "../../middleware/require-auth.js";
import { requireOrgRole } from "../../middleware/require-org-role.js";

const VALID_STATUS = ["open", "triaged", "in_progress", "done", "wont_do", "spam"];

export default async function adminFeedbackRoutes(app: FastifyInstance) {
  const { audit, db } = app.services.storage;
  app.addHook("preHandler", requireAuth);

  app.get<{ Params: { org: string }; Querystring: { status?: string; limit?: string } }>(
    "/api/admin/:org/feedback",
    { preHandler: requireOrgRole("admin") },
    async (req) => {
      const { org } = req.params;
      const limit = Math.min(Number(req.query.limit ?? 200), 500);
      let sql = "SELECT * FROM feedback WHERE org = ?";
      const params: any[] = [org];
      if (req.query.status) { sql += " AND status = ?"; params.push(req.query.status); }
      sql += " ORDER BY created_at DESC LIMIT ?";
      params.push(limit);
      const rows = db.prepare(sql).all(...params);

      const counts = db.prepare(
        "SELECT status, COUNT(*) as n FROM feedback WHERE org = ? GROUP BY status"
      ).all(org) as { status: string; n: number }[];

      return {
        items: rows,
        counts: Object.fromEntries(counts.map((c) => [c.status, c.n])),
      };
    }
  );

  app.patch<{ Params: { org: string; id: string }; Body: { status?: string; reply?: string } }>(
    "/api/admin/:org/feedback/:id",
    { preHandler: requireOrgRole("admin") },
    async (req, reply) => {
      const { org, id } = req.params;
      const idNum = Number(id);
      const { status, reply: replyText } = req.body;
      const row = db.prepare("SELECT * FROM feedback WHERE id = ? AND org = ?").get(idNum, org);
      if (!row) return reply.code(404).send({ error: "意见不存在" });

      const updates: string[] = ["updated_at = ?"];
      const args: any[] = [Date.now()];
      if (status) {
        if (!VALID_STATUS.includes(status)) return reply.code(400).send({ error: "状态无效" });
        updates.push("status = ?"); args.push(status);
      }
      if (replyText !== undefined) {
        updates.push("reply = ?", "replied_by = ?", "replied_at = ?");
        args.push(replyText.trim() || null, req.session!.login, Date.now());
      }
      args.push(idNum);
      db.prepare(`UPDATE feedback SET ${updates.join(", ")} WHERE id = ?`).run(...args);

      audit(org, req.session!.login, "feedback.update", id, { status, has_reply: Boolean(replyText) }, req.ip);
      return { ok: true };
    }
  );

  app.delete<{ Params: { org: string; id: string } }>(
    "/api/admin/:org/feedback/:id",
    { preHandler: requireOrgRole("admin") },
    async (req, reply) => {
      const { org, id } = req.params;
      const r = db.prepare("DELETE FROM feedback WHERE id = ? AND org = ?").run(Number(id), org);
      if (r.changes === 0) return reply.code(404).send({ error: "意见不存在" });
      audit(org, req.session!.login, "feedback.delete", id, undefined, req.ip);
      return { ok: true };
    }
  );
}

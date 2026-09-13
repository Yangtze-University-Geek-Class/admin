import type { FastifyInstance } from "fastify";
import { requireAuth } from "../../middleware/require-auth.js";
import { requireOrgRole } from "../../middleware/require-org-role.js";

export default async function logsRoutes(app: FastifyInstance) {
  const { db } = app.services.storage;
  app.addHook("preHandler", requireAuth);

  app.get<{ Params: { org: string }; Querystring: { limit?: string; offset?: string } }>(
    "/api/admin/:org/logs",
    { preHandler: requireOrgRole("admin") },
    async (req) => {
      const { org } = req.params;
      const limit = Math.min(Number(req.query.limit ?? 100), 500);
      const offset = Number(req.query.offset ?? 0);
      const rows = db.prepare(
        "SELECT id, actor, action, target, details, ip, created_at FROM audit_logs WHERE org = ? ORDER BY created_at DESC LIMIT ? OFFSET ?"
      ).all(org, limit, offset);
      return { logs: rows.map((r: any) => ({ ...r, details: r.details ? JSON.parse(r.details) : null })) };
    }
  );
}

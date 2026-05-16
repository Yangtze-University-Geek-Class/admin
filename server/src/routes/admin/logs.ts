import type { FastifyInstance } from "fastify";
import { requireAuth } from "../../middleware/require-auth.js";
import { db } from "../../lib/db.js";

export default async function logsRoutes(app: FastifyInstance) {
  app.addHook("preHandler", requireAuth);

  app.get<{ Querystring: { limit?: string; offset?: string } }>("/api/admin/logs", async (req) => {
    const limit = Math.min(Number(req.query.limit ?? 100), 500);
    const offset = Number(req.query.offset ?? 0);
    const rows = db.prepare(
      "SELECT id, actor, action, target, details, ip, created_at FROM audit_logs ORDER BY created_at DESC LIMIT ? OFFSET ?"
    ).all(limit, offset);
    return { logs: rows.map((r: any) => ({ ...r, details: r.details ? JSON.parse(r.details) : null })) };
  });
}

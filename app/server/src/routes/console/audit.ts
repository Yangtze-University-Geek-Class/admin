import type { FastifyInstance } from "fastify";
import { requireAuth } from "../../middleware/require-auth.js";
import { requireCapability } from "../../middleware/require-capability.js";

/** 审计日志：只查 org = CONSOLE_ORG 的行；action 按前缀匹配。 */
export default async function consoleAuditRoutes(app: FastifyInstance) {
  const { config } = app.services;
  const { db } = app.services.storage;
  app.addHook("preHandler", requireAuth);

  app.get<{ Querystring: { limit?: string; offset?: string; action?: string } }>(
    "/api/console/audit",
    { preHandler: requireCapability("audit.read") },
    async (req) => {
      const limit = Number(req.query.limit ?? 100);
      const offset = Number(req.query.offset ?? 0);
      const params: unknown[] = [config.consoleOrg];
      let sql = "SELECT id, actor, action, target, details, ip, created_at FROM audit_logs WHERE org = ?";
      if (req.query.action) {
        sql += " AND action LIKE ? ESCAPE '\\'";
        params.push(`${req.query.action.replace(/[\\%_]/g, match => `\\${match}`)}%`);
      }
      sql += " ORDER BY created_at DESC, id DESC LIMIT ? OFFSET ?";
      const rows = db.prepare(sql).all(...params, limit, offset) as { details: string | null }[];
      return { logs: rows.map(row => ({ ...row, details: row.details ? JSON.parse(row.details) : null })) };
    },
  );
}

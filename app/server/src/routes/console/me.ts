import type { FastifyInstance } from "fastify";
import { requireAuth } from "../../middleware/require-auth.js";
import { requireCapability, resolveAccess } from "../../middleware/require-capability.js";
import { APPLICATION_STATUS_IDS, orderedCapabilities } from "../../lib/roles.js";

const DAY_MS = 24 * 60 * 60 * 1000;

export default async function consoleMeRoutes(app: FastifyInstance) {
  const { config, roles, feedback } = app.services;
  const { db } = app.services.storage;
  app.addHook("preHandler", requireAuth);

  /** 当前用户在极客班控制台的身份：称号、能力与被 GitHub 上限挡掉的能力。只需要登录。 */
  app.get("/api/console/me", async (req) => {
    const access = await resolveAccess(req);
    return {
      login: req.session!.login, avatar_url: req.session!.avatar_url, org: config.consoleOrg,
      github_role: access.githubRole,
      title: access.titles[0], titles: access.titles,
      capabilities: orderedCapabilities(access.capabilities),
      blocked: access.blocked,
      head_of: access.headOf,
    };
  });

  /** 概览统计：只返回调用者有权限看的键。 */
  app.get("/api/console/summary", { preHandler: requireCapability("console.access") }, async (req) => {
    const access = req.access!;
    const result: Record<string, unknown> = {};
    if (access.capabilities.has("applications.read")) {
      const rows = db.prepare("SELECT status, COUNT(*) AS n FROM applications GROUP BY status").all() as { status: string; n: number }[];
      const byStatus: Record<string, number> = Object.fromEntries(APPLICATION_STATUS_IDS.map(id => [id, 0]));
      for (const row of rows) byStatus[row.status] = row.n;
      const lastWeek = db.prepare("SELECT COUNT(*) AS n FROM applications WHERE created_at >= ?").get(Date.now() - 7 * DAY_MS) as { n: number };
      result.applications = { total: rows.reduce((sum, row) => sum + row.n, 0), by_status: byStatus, last_7d: lastWeek.n };
    }
    if (access.capabilities.has("feedback.read")) result.feedback = feedback.countFeedback(config.consoleOrg);
    if (access.capabilities.has("roles.manage") || access.capabilities.has("roles.department.manage")) {
      result.people = { assignments: roles.countAssignments(), departments: roles.listDepartments().filter(item => !item.archived).length };
    }
    return result;
  });
}

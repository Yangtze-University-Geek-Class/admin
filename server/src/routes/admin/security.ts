import type { FastifyInstance } from "fastify";
import { ORG, octokitService } from "../../lib/github.js";
import { requireAuth } from "../../middleware/require-auth.js";

export default async function securityRoutes(app: FastifyInstance) {
  app.addHook("preHandler", requireAuth);

  app.get("/api/admin/security", async () => {
    const octokit = octokitService();
    const result: any = { dependabot_alerts: [], audit_log_supported: false, secret_scanning_supported: false };
    try {
      const alerts = await octokit.paginate("GET /orgs/{org}/dependabot/alerts", { org: ORG, per_page: 100, state: "open" });
      result.dependabot_alerts = alerts;
    } catch (e) {
      result.dependabot_error = (e as Error).message;
    }
    return result;
  });
}

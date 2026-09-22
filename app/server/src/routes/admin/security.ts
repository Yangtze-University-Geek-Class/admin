import type { FastifyInstance } from "fastify";
import { requireAuth } from "../../middleware/require-auth.js";
import { requireOrgRole } from "../../middleware/require-org-role.js";

export default async function securityRoutes(app: FastifyInstance) {
  const { octokitWith } = app.services.github;
  app.addHook("preHandler", requireAuth);

  app.get<{ Params: { org: string } }>("/api/admin/:org/security", {
    preHandler: requireOrgRole("member"),
  }, async (req) => {
    const { org } = req.params;
    const octokit = octokitWith(req.session!.accessToken);
    const orgRes = await octokit.request("GET /orgs/{org}", { org });
    const plan = (orgRes.data as any).plan?.name ?? "free";
    const isFree = plan === "free";

    const result: any = {
      plan,
      two_factor_required: (orgRes.data as any).two_factor_requirement_enabled ?? false,
      dependabot: { supported: !isFree, alerts: [] as any[], reason: isFree ? "组织级 Dependabot alerts API 需要 GitHub Pro / Team / Enterprise" : null },
      secret_scanning: { supported: !isFree, reason: isFree ? "需要 GitHub Advanced Security (Pro+)" : null },
      audit_log: { supported: false, reason: "组织级 audit log API 仅 GitHub Enterprise Cloud 提供" },
    };

    if (!isFree) {
      try {
        const alerts = await octokit.paginate("GET /orgs/{org}/dependabot/alerts", { org, per_page: 100, state: "open" } as any);
        result.dependabot.alerts = alerts;
      } catch (e) {
        result.dependabot.error = (e as Error).message;
      }
    }
    return result;
  });
}

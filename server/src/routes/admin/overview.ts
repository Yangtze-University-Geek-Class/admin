import type { FastifyInstance } from "fastify";
import { ORG, octokitService } from "../../lib/github.js";
import { requireAuth } from "../../middleware/require-auth.js";
import { db } from "../../lib/db.js";

export default async function overviewRoutes(app: FastifyInstance) {
  app.addHook("preHandler", requireAuth);

  app.get("/api/admin/overview", async () => {
    const octokit = octokitService();
    const [orgRes, members, invites, repos] = await Promise.all([
      octokit.request("GET /orgs/{org}", { org: ORG }),
      octokit.paginate("GET /orgs/{org}/members", { org: ORG, per_page: 100 }),
      octokit.paginate("GET /orgs/{org}/invitations", { org: ORG, per_page: 100 }),
      octokit.paginate("GET /orgs/{org}/repos", { org: ORG, per_page: 100, type: "all" }),
    ]);

    const recentInvites = db.prepare(
      "SELECT COUNT(*) as n FROM invitations WHERE created_at > ?"
    ).get(Date.now() - 24 * 60 * 60 * 1000) as { n: number };

    return {
      org: {
        login: orgRes.data.login,
        name: orgRes.data.name,
        description: orgRes.data.description,
        avatar_url: orgRes.data.avatar_url,
        html_url: orgRes.data.html_url,
        plan: (orgRes.data as any).plan?.name ?? null,
        disk_usage_mb: (orgRes.data as any).disk_usage ?? 0,
        public_repos: orgRes.data.public_repos,
        total_private_repos: (orgRes.data as any).total_private_repos ?? 0,
        created_at: orgRes.data.created_at,
        billing_email: (orgRes.data as any).billing_email ?? null,
        two_factor_required: (orgRes.data as any).two_factor_requirement_enabled ?? false,
      },
      counts: {
        members: members.length,
        repos: repos.length,
        pending_invites: invites.length,
        invites_24h: recentInvites.n,
      },
    };
  });
}

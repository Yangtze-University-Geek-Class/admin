import type { FastifyInstance } from "fastify";
import { requireAuth } from "../../middleware/require-auth.js";
import { requireOrgRole } from "../../middleware/require-org-role.js";

export default async function overviewRoutes(app: FastifyInstance) {
  const { octokitWith } = app.services.github;
  const { db } = app.services.storage;
  app.addHook("preHandler", requireAuth);

  app.get<{ Params: { org: string } }>("/api/admin/:org/overview", {
    preHandler: requireOrgRole("member"),
  }, async (req) => {
    const { org } = req.params;
    const octokit = octokitWith(req.session!.accessToken);
    const [orgRes, members, invites, repos] = await Promise.all([
      octokit.request("GET /orgs/{org}", { org }),
      octokit.paginate("GET /orgs/{org}/members", { org, per_page: 100 }).catch(() => []),
      octokit.paginate("GET /orgs/{org}/invitations", { org, per_page: 100 }).catch(() => []),
      octokit.paginate("GET /orgs/{org}/repos", { org, per_page: 100, type: "all" }).catch(() => []),
    ]);

    const recentInvites = db.prepare(
      "SELECT COUNT(*) as n FROM invitations WHERE org = ? AND created_at > ?"
    ).get(org, Date.now() - 24 * 60 * 60 * 1000) as { n: number };

    const activeLinks = db.prepare(
      "SELECT COUNT(*) as n FROM invite_links WHERE org = ? AND disabled = 0 AND expires_at > ?"
    ).get(org, Date.now()) as { n: number };

    return {
      role: req.orgRole,
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
        active_invite_links: activeLinks.n,
      },
    };
  });
}

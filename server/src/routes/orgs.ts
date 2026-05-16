import type { FastifyInstance } from "fastify";
import { octokitWith } from "../lib/github.js";
import { requireAuth } from "../middleware/require-auth.js";
import { config } from "../config.js";

export default async function orgsRoutes(app: FastifyInstance) {
  app.addHook("preHandler", requireAuth);

  app.get("/api/me/orgs", async (req) => {
    const octokit = octokitWith(req.session!.accessToken);
    const all = await octokit.paginate("GET /user/memberships/orgs", { per_page: 100, state: "active" });
    const filtered = config.allowedOrgs.length > 0
      ? all.filter((m: any) => config.allowedOrgs.includes(String(m.organization.login).toLowerCase()))
      : all;
    const enriched = filtered.map((m: any) => ({
      login: m.organization.login,
      name: m.organization.name ?? m.organization.login,
      avatar_url: m.organization.avatar_url,
      role: m.role as "admin" | "member",
      state: m.state,
      html_url: m.organization.html_url ?? `https://github.com/${m.organization.login}`,
    }));
    return { orgs: enriched, allowed_orgs: config.allowedOrgs };
  });
}

import type { FastifyInstance } from "fastify";
import { ORG, octokitService } from "../../lib/github.js";
import { requireAuth } from "../../middleware/require-auth.js";
import { audit } from "../../lib/db.js";

export default async function teamsRoutes(app: FastifyInstance) {
  app.addHook("preHandler", requireAuth);

  app.get("/api/admin/teams", async () => {
    const octokit = octokitService();
    const teams = await octokit.paginate("GET /orgs/{org}/teams", { org: ORG, per_page: 100 });
    const enriched = await Promise.all(
      teams.map(async (t) => {
        const [members, repos] = await Promise.all([
          octokit.paginate("GET /orgs/{org}/teams/{team_slug}/members", { org: ORG, team_slug: t.slug, per_page: 100 }).catch(() => []),
          octokit.paginate("GET /orgs/{org}/teams/{team_slug}/repos", { org: ORG, team_slug: t.slug, per_page: 100 }).catch(() => []),
        ]);
        return { ...t, member_count: members.length, repo_count: repos.length };
      })
    );
    return { teams: enriched };
  });

  app.post<{ Body: { name: string; description?: string; privacy?: "secret" | "closed" } }>(
    "/api/admin/teams",
    async (req, reply) => {
      const { name, description, privacy } = req.body;
      if (!name) return reply.code(400).send({ error: "name 必填" });
      const octokit = octokitService();
      const res = await octokit.request("POST /orgs/{org}/teams", { org: ORG, name, description, privacy });
      audit(req.session!.login, "team.create", res.data.slug, { name }, req.ip);
      return { ok: true, team: res.data };
    }
  );

  app.delete<{ Params: { slug: string } }>("/api/admin/teams/:slug", async (req) => {
    const { slug } = req.params;
    const octokit = octokitService();
    await octokit.request("DELETE /orgs/{org}/teams/{team_slug}", { org: ORG, team_slug: slug });
    audit(req.session!.login, "team.delete", slug, undefined, req.ip);
    return { ok: true };
  });
}

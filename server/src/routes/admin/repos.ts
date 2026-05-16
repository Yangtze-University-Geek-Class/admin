import type { FastifyInstance } from "fastify";
import { ORG, octokitService } from "../../lib/github.js";
import { requireAuth } from "../../middleware/require-auth.js";

export default async function reposRoutes(app: FastifyInstance) {
  app.addHook("preHandler", requireAuth);

  app.get("/api/admin/repos", async () => {
    const octokit = octokitService();
    const repos = await octokit.paginate("GET /orgs/{org}/repos", { org: ORG, per_page: 100, type: "all" });
    return {
      repos: repos.map((r) => ({
        name: r.name,
        full_name: r.full_name,
        visibility: r.visibility,
        default_branch: r.default_branch,
        size_kb: r.size,
        pushed_at: r.pushed_at,
        updated_at: r.updated_at,
        stargazers_count: r.stargazers_count,
        forks_count: r.forks_count,
        open_issues_count: r.open_issues_count,
        archived: r.archived,
        language: r.language,
        topics: r.topics ?? [],
        html_url: r.html_url,
      })),
    };
  });

  app.get<{ Params: { repo: string } }>("/api/admin/repos/:repo", async (req) => {
    const octokit = octokitService();
    const { repo } = req.params;
    const [info, branches, collabs, hooks] = await Promise.all([
      octokit.request("GET /repos/{owner}/{repo}", { owner: ORG, repo }),
      octokit.paginate("GET /repos/{owner}/{repo}/branches", { owner: ORG, repo, per_page: 100 }),
      octokit.paginate("GET /repos/{owner}/{repo}/collaborators", { owner: ORG, repo, per_page: 100 }),
      octokit.paginate("GET /repos/{owner}/{repo}/hooks", { owner: ORG, repo, per_page: 100 }).catch(() => []),
    ]);
    return {
      info: info.data,
      branches: branches.map((b: any) => ({ name: b.name, protected: b.protected })),
      collaborators: collabs.map((c: any) => ({ login: c.login, avatar_url: c.avatar_url, role: c.role_name, permissions: c.permissions })),
      hooks: hooks.map((h: any) => ({ id: h.id, name: h.name, active: h.active, events: h.events, url: h.config?.url })),
    };
  });
}

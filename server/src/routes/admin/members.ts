import type { FastifyInstance } from "fastify";
import { requireAuth } from "../../middleware/require-auth.js";
import { requireOrgRole } from "../../middleware/require-org-role.js";

export default async function membersRoutes(app: FastifyInstance) {
  const { octokitWith } = app.services.github;
  const { audit } = app.services.storage;
  app.addHook("preHandler", requireAuth);

  app.get<{ Params: { org: string } }>("/api/admin/:org/members", {
    preHandler: requireOrgRole("member"),
  }, async (req) => {
    const { org } = req.params;
    const octokit = octokitWith(req.session!.accessToken);
    const members = await octokit.paginate("GET /orgs/{org}/members", { org, per_page: 100 });
    const enriched = await Promise.all(
      members.map(async (m) => {
        try {
          const ms = await octokit.request("GET /orgs/{org}/memberships/{username}", { org, username: m.login });
          return { login: m.login, id: m.id, avatar_url: m.avatar_url, html_url: m.html_url, role: ms.data.role, state: ms.data.state };
        } catch {
          return { login: m.login, id: m.id, avatar_url: m.avatar_url, html_url: m.html_url, role: "?", state: "?" };
        }
      })
    );
    return { members: enriched, viewer_role: req.orgRole };
  });

  app.delete<{ Params: { org: string; login: string } }>("/api/admin/:org/members/:login", {
    preHandler: requireOrgRole("admin"),
  }, async (req, reply) => {
    const { org, login } = req.params;
    if (login === req.session!.login) return reply.code(400).send({ error: "不能移除自己" });
    const octokit = octokitWith(req.session!.accessToken);
    await octokit.request("DELETE /orgs/{org}/memberships/{username}", { org, username: login });
    audit(org, req.session!.login, "member.remove", login, undefined, req.ip);
    return { ok: true };
  });

  app.patch<{ Params: { org: string; login: string }; Body: { role: "admin" | "member" } }>(
    "/api/admin/:org/members/:login/role",
    { preHandler: requireOrgRole("admin") },
    async (req, reply) => {
      const { org, login } = req.params;
      const { role } = req.body;
      if (role !== "admin" && role !== "member") return reply.code(400).send({ error: "role 必须是 admin 或 member" });
      const octokit = octokitWith(req.session!.accessToken);
      await octokit.request("PUT /orgs/{org}/memberships/{username}", { org, username: login, role });
      audit(org, req.session!.login, "member.role", login, { role }, req.ip);
      return { ok: true };
    }
  );
}

import type { FastifyInstance } from "fastify";
import { ORG, octokitService } from "../../lib/github.js";
import { requireAuth } from "../../middleware/require-auth.js";
import { audit } from "../../lib/db.js";

export default async function membersRoutes(app: FastifyInstance) {
  app.addHook("preHandler", requireAuth);

  app.get("/api/admin/members", async () => {
    const octokit = octokitService();
    const members = await octokit.paginate("GET /orgs/{org}/members", { org: ORG, per_page: 100 });
    const enriched = await Promise.all(
      members.map(async (m) => {
        try {
          const ms = await octokit.request("GET /orgs/{org}/memberships/{username}", { org: ORG, username: m.login });
          return {
            login: m.login,
            id: m.id,
            avatar_url: m.avatar_url,
            html_url: m.html_url,
            role: ms.data.role,
            state: ms.data.state,
          };
        } catch {
          return { login: m.login, id: m.id, avatar_url: m.avatar_url, html_url: m.html_url, role: "?", state: "?" };
        }
      })
    );
    return { members: enriched };
  });

  app.delete<{ Params: { login: string } }>("/api/admin/members/:login", async (req, reply) => {
    const { login } = req.params;
    if (login === req.session!.login) return reply.code(400).send({ error: "不能移除自己" });
    const octokit = octokitService();
    await octokit.request("DELETE /orgs/{org}/memberships/{username}", { org: ORG, username: login });
    audit(req.session!.login, "member.remove", login, undefined, req.ip);
    return { ok: true };
  });

  app.patch<{ Params: { login: string }; Body: { role: "admin" | "member" } }>(
    "/api/admin/members/:login/role",
    async (req, reply) => {
      const { login } = req.params;
      const { role } = req.body;
      if (role !== "admin" && role !== "member") return reply.code(400).send({ error: "role 必须是 admin 或 member" });
      const octokit = octokitService();
      await octokit.request("PUT /orgs/{org}/memberships/{username}", { org: ORG, username: login, role });
      audit(req.session!.login, "member.role", login, { role }, req.ip);
      return { ok: true };
    }
  );

  app.get("/api/admin/outside_collaborators", async () => {
    const octokit = octokitService();
    const list = await octokit.paginate("GET /orgs/{org}/outside_collaborators", { org: ORG, per_page: 100 });
    return { outside_collaborators: list };
  });
}

import type { FastifyInstance } from "fastify";
import { octokitWith } from "../../lib/github.js";
import { requireAuth } from "../../middleware/require-auth.js";
import { requireOrgRole } from "../../middleware/require-org-role.js";
import { audit, db } from "../../lib/db.js";

export default async function invitationsRoutes(app: FastifyInstance) {
  app.addHook("preHandler", requireAuth);

  app.get<{ Params: { org: string } }>("/api/admin/:org/invitations", {
    preHandler: requireOrgRole("admin"),
  }, async (req) => {
    const { org } = req.params;
    const octokit = octokitWith(req.session!.accessToken);
    const pending = await octokit.paginate("GET /orgs/{org}/invitations", { org, per_page: 100 });
    const history = db.prepare(
      "SELECT id, invite_link_token, github_login, email, note, source_ip, github_invitation_id, status, error_message, created_at FROM invitations WHERE org = ? ORDER BY created_at DESC LIMIT 200"
    ).all(org);
    return { pending, history };
  });

  app.delete<{ Params: { org: string; id: string } }>("/api/admin/:org/invitations/:id", {
    preHandler: requireOrgRole("admin"),
  }, async (req, reply) => {
    const { org, id } = req.params;
    const n = Number(id);
    if (!Number.isFinite(n)) return reply.code(400).send({ error: "invalid id" });
    const octokit = octokitWith(req.session!.accessToken);
    await octokit.request("DELETE /orgs/{org}/invitations/{invitation_id}", { org, invitation_id: n });
    audit(org, req.session!.login, "invitation.cancel", String(n), undefined, req.ip);
    return { ok: true };
  });
}

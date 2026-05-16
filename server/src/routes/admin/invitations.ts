import type { FastifyInstance } from "fastify";
import { ORG, octokitService } from "../../lib/github.js";
import { requireAuth } from "../../middleware/require-auth.js";
import { audit, db } from "../../lib/db.js";

export default async function invitationsRoutes(app: FastifyInstance) {
  app.addHook("preHandler", requireAuth);

  app.get("/api/admin/invitations", async () => {
    const octokit = octokitService();
    const pending = await octokit.paginate("GET /orgs/{org}/invitations", { org: ORG, per_page: 100 });
    const history = db.prepare(
      "SELECT id, github_login, email, note, source_ip, turnstile_passed, github_invitation_id, status, error_message, created_at FROM invitations ORDER BY created_at DESC LIMIT 200"
    ).all();
    return { pending, history };
  });

  app.delete<{ Params: { id: string } }>("/api/admin/invitations/:id", async (req, reply) => {
    const id = Number(req.params.id);
    if (!Number.isFinite(id)) return reply.code(400).send({ error: "invalid id" });
    const octokit = octokitService();
    await octokit.request("DELETE /orgs/{org}/invitations/{invitation_id}", { org: ORG, invitation_id: id });
    audit(req.session!.login, "invitation.cancel", String(id), undefined, req.ip);
    return { ok: true };
  });
}

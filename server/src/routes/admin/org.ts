import type { FastifyInstance } from "fastify";
import { ORG, octokitService } from "../../lib/github.js";
import { requireAuth } from "../../middleware/require-auth.js";
import { audit } from "../../lib/db.js";

const EDITABLE_KEYS = [
  "name",
  "description",
  "company",
  "email",
  "location",
  "blog",
  "twitter_username",
  "billing_email",
  "default_repository_permission",
  "members_can_create_repositories",
  "members_can_create_public_repositories",
  "members_can_create_private_repositories",
  "members_can_create_internal_repositories",
  "members_can_fork_private_repositories",
  "members_can_create_pages",
  "members_can_create_public_pages",
  "members_can_create_private_pages",
  "members_can_invite_outside_collaborators",
  "members_can_delete_repositories",
  "members_can_change_repo_visibility",
  "members_can_delete_issues",
] as const;

export default async function orgRoutes(app: FastifyInstance) {
  app.addHook("preHandler", requireAuth);

  app.get("/api/admin/org", async () => {
    const octokit = octokitService();
    const res = await octokit.request("GET /orgs/{org}", { org: ORG });
    return res.data;
  });

  app.patch<{ Body: Record<string, unknown> }>("/api/admin/org", async (req, reply) => {
    const update: Record<string, unknown> = {};
    for (const k of EDITABLE_KEYS) {
      if (k in req.body) update[k] = req.body[k];
    }
    if (Object.keys(update).length === 0) return reply.code(400).send({ error: "no editable fields" });
    const octokit = octokitService();
    const res = await octokit.request("PATCH /orgs/{org}", { org: ORG, ...update });
    audit(req.session!.login, "org.update", ORG, update, req.ip);
    return res.data;
  });
}

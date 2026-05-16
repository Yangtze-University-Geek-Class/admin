import type { FastifyInstance } from "fastify";
import { ORG, octokitService } from "../../lib/github.js";
import { requireAuth } from "../../middleware/require-auth.js";

export default async function activityRoutes(app: FastifyInstance) {
  app.addHook("preHandler", requireAuth);

  app.get("/api/admin/activity", async () => {
    const octokit = octokitService();
    const events = await octokit.request("GET /orgs/{org}/events", { org: ORG, per_page: 100 });
    return {
      events: (events.data as any[]).map((e) => ({
        id: e.id,
        type: e.type,
        actor: e.actor?.login,
        actor_avatar: e.actor?.avatar_url,
        repo: e.repo?.name,
        created_at: e.created_at,
        payload_summary: summarize(e),
      })),
    };
  });
}

function summarize(e: any): string {
  switch (e.type) {
    case "PushEvent":
      return `push ${e.payload?.commits?.length ?? 0} commit(s) to ${e.payload?.ref ?? ""}`;
    case "PullRequestEvent":
      return `PR ${e.payload?.action} #${e.payload?.number}: ${e.payload?.pull_request?.title ?? ""}`;
    case "IssuesEvent":
      return `issue ${e.payload?.action} #${e.payload?.issue?.number}: ${e.payload?.issue?.title ?? ""}`;
    case "CreateEvent":
      return `create ${e.payload?.ref_type} ${e.payload?.ref ?? ""}`;
    case "DeleteEvent":
      return `delete ${e.payload?.ref_type} ${e.payload?.ref ?? ""}`;
    case "ReleaseEvent":
      return `release ${e.payload?.action}: ${e.payload?.release?.tag_name ?? ""}`;
    case "ForkEvent":
      return `fork`;
    case "WatchEvent":
      return `star`;
    default:
      return e.type;
  }
}

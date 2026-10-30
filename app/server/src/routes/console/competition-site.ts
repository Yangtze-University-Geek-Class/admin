import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { requireAuth } from "../../middleware/require-auth.js";
import { requirePermission } from "../../middleware/require-permission.js";
import { requireStepUp } from "../../middleware/require-step-up.js";
import { SITE_ERRORS, type SiteError, type SiteVersion } from "../../lib/competition-site-store.js";
import { publicCachePrefix } from "../../lib/competition-public.js";
import { SITE_LIMITS } from "../../lib/site-package.js";

/**
 * 控制台「官网」页签（#278，CONTRACT-278 §1）：看版本、上传站点包、发布或回滚、下线。
 * 看要 competition.manage 或 competition.site.publish；上传、发布、下线要 competition.site.publish 加 step-up，全部记操作记录。
 * 上传的请求体就是 zip（Content-Type: application/zip），上限 20MB，只有内部赛能传。
 */
export default async function consoleCompetitionSiteRoutes(app: FastifyInstance) {
  const { competitionSites: sites, competitions, permissions, competitionPublic, cache, clock } = app.services;
  const { db } = app.services.storage;
  app.addHook("preHandler", requireAuth);
  app.addContentTypeParser("application/zip", { parseAs: "buffer", bodyLimit: SITE_LIMITS.zipBytes }, (_req, body, done) => done(null, body));
  const publish = [requirePermission("competition.site.publish"), requireStepUp];

  async function canView(req: FastifyRequest, reply: FastifyReply) {
    const accountId = req.session!.account_id;
    if (!permissions.check(accountId, "competition.manage") && !permissions.check(accountId, "competition.site.publish")) {
      return reply.code(403).send({ error: "forbidden", node: "competition.site.publish", message: "需要「competition.manage」或「competition.site.publish」权限" });
    }
  }

  const refuse = (reply: FastifyReply, error: SiteError) => reply.code(SITE_ERRORS[error].status).send({ error, message: SITE_ERRORS[error].message });
  const missingCompetition = (reply: FastifyReply) => reply.code(404).send({ error: "not_found", message: "比赛不存在" });

  function versionView(competitionId: string, slug: string | null, version: SiteVersion) {
    const person = competitionPublic.personOf(version.uploaded_by);
    return {
      id: version.id, version: version.version, size: version.size, files: version.files, sha256: version.sha256,
      status: version.status, report: version.report,
      uploaded_by: { account_id: version.uploaded_by, username: person.username, display_name: person.display_name },
      created_at: version.created_at,
      preview_url: version.status === "passed" ? `/c/${encodeURIComponent(slug ?? competitionId)}/~preview/${version.id}/` : null,
    };
  }
  function stateView(competitionId: string) {
    const state = sites.state(competitionId);
    const record = competitions.get(competitionId);
    return {
      slug: state.slug,
      live_version_id: state.live_version_id,
      site_url: state.slug && state.live_version_id && record && !record.offline && record.kind === "internal" ? `/c/${state.slug}/` : null,
      versions: state.versions.map(version => versionView(competitionId, state.slug, version)),
    };
  }

  app.get<{ Params: { competition_id: string } }>("/api/console/competitions/:competition_id/site", { preHandler: canView }, async (req, reply) => {
    if (!competitions.get(req.params.competition_id)) return missingCompetition(reply);
    return stateView(req.params.competition_id);
  });

  app.post<{ Params: { competition_id: string }; Body: Buffer }>(
    "/api/console/competitions/:competition_id/site/versions",
    { preHandler: publish, bodyLimit: SITE_LIMITS.zipBytes, config: { rateLimit: { max: 10, timeWindow: "1 minute" } } },
    async (req, reply) => {
      const id = req.params.competition_id;
      const record = competitions.get(id);
      if (!record) return missingCompetition(reply);
      if (record.kind !== "internal") return reply.code(409).send({ error: "competition_not_internal", message: "只有内部赛能托管官网" });
      if (!Buffer.isBuffer(req.body)) return reply.code(415).send({ error: "unsupported_media_type", message: "请求体要是 zip（Content-Type: application/zip）" });
      const version = sites.upload(id, req.body, req.session!.account_id, clock());
      app.services.activity.recordActivity(req, {
        action: "competition.site.upload", surface: "console", target_type: "competition_site_version", target_id: version.id,
        outcome: version.status === "passed" ? "ok" : "error",
        meta: { competition_id: id, version: version.version, size: version.size, files: version.files, sha256: version.sha256, status: version.status },
      });
      if (version.status !== "passed") return reply.code(422).send({ error: "site_rejected", message: "站点包没有通过校验", report: version.report });
      return reply.code(201).send(versionView(id, sites.state(id).slug, version));
    },
  );

  app.post<{ Params: { competition_id: string }; Body: { version_id: string; slug?: string } }>(
    "/api/console/competitions/:competition_id/site/publish",
    { preHandler: publish, config: { rateLimit: { max: 30, timeWindow: "1 minute" } } },
    async (req, reply) => {
      const id = req.params.competition_id;
      const record = competitions.get(id);
      if (!record) return missingCompetition(reply);
      if (record.kind !== "internal") return reply.code(409).send({ error: "competition_not_internal", message: "只有内部赛能托管官网" });
      const before = sites.state(id).live_version_id;
      // 先校验、再同步对象存储、最后才写库：同步失败时在线版本不变，资源仍从服务端回。
      const refusal = sites.checkPublish(id, req.body.version_id, req.body.slug);
      if (refusal) return refuse(reply, refusal);
      try {
        await sites.mirrorToStorage(id, req.body.version_id);
      } catch {
        return reply.code(503).send({ error: "storage_unavailable", message: "官网文件没能同步到对象存储，这次没有发布，过一会儿再试" });
      }
      const result = db.transaction(() => {
        const published = sites.publish(id, req.body.version_id, req.body.slug, req.session!.account_id, clock());
        if (published.ok) {
          app.services.activity.recordActivity(req, {
            action: "competition.site.publish", surface: "console", target_type: "competition", target_id: id, outcome: "ok",
            meta: { version_id: req.body.version_id, previous_version_id: before, slug: published.value.slug },
          });
        }
        return published;
      })();
      if (!result.ok) return refuse(reply, result.error);
      cache.invalidate(publicCachePrefix(id));
      return stateView(id);
    },
  );

  app.delete<{ Params: { competition_id: string } }>(
    "/api/console/competitions/:competition_id/site",
    { preHandler: publish, config: { rateLimit: { max: 30, timeWindow: "1 minute" } } },
    async (req, reply) => {
      const id = req.params.competition_id;
      if (!competitions.get(id)) return missingCompetition(reply);
      const before = sites.state(id).live_version_id;
      const result = db.transaction(() => {
        const removed = sites.unpublish(id, req.session!.account_id, clock());
        if (removed.ok) {
          app.services.activity.recordActivity(req, {
            action: "competition.site.unpublish", surface: "console", target_type: "competition", target_id: id, outcome: "ok", meta: { previous_version_id: before },
          });
        }
        return removed;
      })();
      if (!result.ok) return refuse(reply, result.error);
      cache.invalidate(publicCachePrefix(id));
      return stateView(id);
    },
  );
}

import type { FastifyInstance } from "fastify";
import { requireAuth } from "../../middleware/require-auth.js";

const PUBLIC_PROJECTS_CACHE_KEY = "gitlab:public-projects";
const PUBLIC_PROJECTS_CACHE_TTL_MS = 5 * 60_000;
const MEMBER_PROJECTS_CACHE_KEY = "gitlab:member-projects";

/**
 * 公开的代码仓库列表（#274）：门户「代码仓库」应用用它，只给 `visibility = public` 的项目，不需要登录。
 * GitLab 没配或连不上时给空列表加 `unavailable: true`，不让门户跟着报错。
 */
export default async function portalGitlabRoutes(app: FastifyInstance) {
  const { gitlab, cache } = app.services;
  app.get("/api/public/gitlab", async (_req, reply) => {
    if (!gitlab.url) return reply.code(503).send({ error: "gitlab_unavailable", message: "代码仓库暂不可用" });
    return reply.header("Cache-Control", "no-store").redirect(`${gitlab.url}/${encodeURIComponent(gitlab.group)}`);
  });

  app.get("/api/public/gitlab/projects", async () => {
    const { projects, available } = await cache.cached(PUBLIC_PROJECTS_CACHE_KEY, PUBLIC_PROJECTS_CACHE_TTL_MS, () => gitlab.listProjects());
    if (!available) return { projects: [], unavailable: true };
    return {
      projects: projects.filter(project => project.visibility === "public")
        .map(({ name, path_with_namespace, description, web_url, http_url_to_repo, last_activity_at }) =>
          ({ name, path_with_namespace, description, web_url, http_url_to_repo, last_activity_at })),
    };
  });

  app.get("/api/me/gitlab/projects", { preHandler: requireAuth }, async (req, reply) => {
    const accountId = req.session?.account_id;
    if (!accountId || !app.services.identity.isMember(accountId)) return reply.code(403).send({ error: "not_member", message: "代码仓库仅向有效极客班成员开放" });
    const { projects, available } = await cache.cached(MEMBER_PROJECTS_CACHE_KEY, PUBLIC_PROJECTS_CACHE_TTL_MS, () => gitlab.listProjects());
    // 网络等待期间成员资格可能到期或被撤销，不能把迟到的私有列表发出去。
    if (!app.services.identity.isMember(accountId)) return reply.code(403).send({ error: "not_member", message: "代码仓库仅向有效极客班成员开放" });
    if (!available) return { projects: [], unavailable: true };
    return {
      projects: projects.map(({ name, path_with_namespace, description, web_url, http_url_to_repo, last_activity_at }) =>
        ({ name, path_with_namespace, description, web_url, http_url_to_repo, last_activity_at })),
    };
  });
}

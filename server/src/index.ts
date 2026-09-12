import Fastify from "fastify";
import cookie from "@fastify/cookie";
import rateLimit from "@fastify/rate-limit";
import fastifyStatic from "@fastify/static";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { existsSync } from "node:fs";
import { config } from "./config.js";
import authRoutes from "./routes/admin/auth.js";
import joinRoutes from "./routes/portal/join.js";
import orgsRoutes from "./routes/admin/orgs.js";
import feedbackRoutes from "./routes/portal/feedback.js";
import adminFeedbackRoutes from "./routes/admin/feedback.js";
import docsRoutes from "./routes/portal/docs.js";
import overviewRoutes from "./routes/admin/overview.js";
import membersRoutes from "./routes/admin/members.js";
import reposRoutes from "./routes/admin/repos.js";
import invitationsRoutes from "./routes/admin/invitations.js";
import inviteLinksRoutes from "./routes/admin/invite-links.js";
import teamsRoutes from "./routes/admin/teams.js";
import activityRoutes from "./routes/admin/activity.js";
import securityRoutes from "./routes/admin/security.js";
import orgRoutes from "./routes/admin/org.js";
import logsRoutes from "./routes/admin/logs.js";
import forumRoutes from "./routes/forum/index.js";

const here = dirname(fileURLToPath(import.meta.url));
const webDist = resolve(here, "../../web/dist");

/**
 * 按 host（必要时结合 path）决定回哪一份 SPA 入口。
 *
 * 构建产物是 dist/sites/<端>/index.html 三份，每个端只加载自己的 chunk。
 * 论坛在启用子域前挂在官网的 /forum 路径下，所以那条规则要看 pathname。
 */
function resolveSiteEntry(host: string | undefined, url: string): string {
  const hosts = config.siteHosts;
  const hostname = (host ?? "").split(":")[0].toLowerCase();
  const pathname = url.split("?")[0];

  if (hostname === hosts.admin.toLowerCase()) return "sites/admin/index.html";
  if (hostname === hosts.forum.toLowerCase()) return "sites/forum/index.html";
  if (hostname === hosts.portal.toLowerCase()) {
    return pathname.startsWith("/forum") ? "sites/forum/index.html" : "sites/portal/index.html";
  }
  // 本地开发与直连 IP：没有匹配的域名，回官网
  return "sites/portal/index.html";
}

async function main() {
  const app = Fastify({
    logger: { transport: process.env.NODE_ENV === "production" ? undefined : { target: "pino-pretty" } },
    trustProxy: true,
  });

  await app.register(cookie, { secret: config.sessionSecret });
  await app.register(rateLimit, { global: false });

  await app.register(authRoutes);
  await app.register(joinRoutes);
  await app.register(orgsRoutes);
  await app.register(feedbackRoutes);
  await app.register(adminFeedbackRoutes);
  await app.register(docsRoutes);
  await app.register(overviewRoutes);
  await app.register(membersRoutes);
  await app.register(reposRoutes);
  await app.register(invitationsRoutes);
  await app.register(inviteLinksRoutes);
  await app.register(teamsRoutes);
  await app.register(activityRoutes);
  await app.register(securityRoutes);
  await app.register(orgRoutes);
  await app.register(logsRoutes);
  await app.register(forumRoutes);

  app.get("/healthz", async () => ({ ok: true, ts: Date.now() }));

  if (existsSync(webDist)) {
    await app.register(fastifyStatic, { root: webDist, prefix: "/" });
    app.setNotFoundHandler((req, reply) => {
      if (req.url.startsWith("/api") || req.url.startsWith("/auth") || req.url.startsWith("/healthz")) {
        return reply.code(404).send({ error: "not_found" });
      }
      return reply.sendFile(resolveSiteEntry(req.headers.host, req.url));
    });
  } else {
    app.get("/", async () => ({ ok: true, note: "web/dist not built yet" }));
  }

  await app.listen({ port: config.port, host: "127.0.0.1" });
  app.log.info(`yzgc-admin listening on 127.0.0.1:${config.port}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

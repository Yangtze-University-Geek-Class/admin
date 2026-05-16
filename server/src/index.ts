import Fastify from "fastify";
import cookie from "@fastify/cookie";
import rateLimit from "@fastify/rate-limit";
import fastifyStatic from "@fastify/static";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { existsSync } from "node:fs";
import { config } from "./config.js";

import authRoutes from "./routes/auth.js";
import joinRoutes from "./routes/join.js";
import orgsRoutes from "./routes/orgs.js";
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

const here = dirname(fileURLToPath(import.meta.url));
const webDist = resolve(here, "../../web/dist");

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

  app.get("/healthz", async () => ({ ok: true, ts: Date.now() }));

  if (existsSync(webDist)) {
    await app.register(fastifyStatic, { root: webDist, prefix: "/", wildcard: false });
    app.setNotFoundHandler((req, reply) => {
      if (req.url.startsWith("/api") || req.url.startsWith("/auth") || req.url.startsWith("/healthz")) {
        return reply.code(404).send({ error: "not_found" });
      }
      return reply.sendFile("index.html");
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

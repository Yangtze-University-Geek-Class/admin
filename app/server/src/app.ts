import portalRoutes from "./routes/portal/index.js";
import adminRoutes from "./routes/admin/index.js";
import consoleRoutes from "./routes/console/index.js";
import forumRoutes from "./routes/forum-api/index.js";
import Fastify from "fastify";
import cookie from "@fastify/cookie";
import rateLimit from "@fastify/rate-limit";
import fastifyStatic from "@fastify/static";
import { resolve } from "node:path";
import { existsSync } from "node:fs";
import { APP_ROOT, type AppConfig } from "./config.js";
import { createServices, type AppServices, type ServiceOverrides } from "./services.js";
import { registerHttpPolicy } from "./middleware/http-policy.js";

/** 官网产物（app/web）与控制台产物（app/console）分开构建，静态托管时两个目录叠在一起。 */
const webDist = resolve(APP_ROOT, "web/dist");
const consoleDist = resolve(APP_ROOT, "console/dist");

/**
 * 管理端 SPA 的路径与入口：每个环境只有一个域名，管理端靠路径区分，与 Host 无关。
 * 服务端只在这里定义一次；web 镜像内 nginx 的 location 必须与之一致（app/web/Dockerfile）。
 * 管理端是独立的 Vue 包 app/console（极客班控制台），产物入口在 app/console/dist/sites/console/index.html。
 */
export const ADMIN_SPA_PATHS = Object.freeze({ exact: ["/signin"], prefixes: ["/admin", "/console"] });
export const ADMIN_SPA_ENTRY = "sites/console/index.html";
export const PORTAL_SPA_ENTRY = "sites/portal/index.html";

/** 按路径决定回哪一份 SPA 入口：控制台或官网。论坛归 app/forum，绝不回退到旧 React 论坛。 */
export function resolveSiteEntry(url: string): string {
  const path = url.split(/[?#]/)[0];
  const admin = ADMIN_SPA_PATHS.exact.includes(path)
    || ADMIN_SPA_PATHS.prefixes.some(prefix => path === prefix || path.startsWith(`${prefix}/`));
  return admin ? ADMIN_SPA_ENTRY : PORTAL_SPA_ENTRY;
}

/** `staticRoot`：false 关闭静态托管；不传时依次查找 app/web/dist 与 app/console/dist。 */
export type BuildAppOptions = { config: AppConfig; services?: AppServices; overrides?: ServiceOverrides; staticRoot?: string | string[] | false; logger?: boolean };
export async function buildApp(options: BuildAppOptions) {
  const config = options.config;
  const services = options.services ?? createServices(config, options.overrides);
  const app = Fastify({
    logger: options.logger ?? false,
    trustProxy: config.trustProxy,
    ajv: { customOptions: { removeAdditional: false, coerceTypes: false } },
  });

  app.decorate("services", services);
  app.addHook("onClose", async () => { if (!options.services) services.close(); });
  registerHttpPolicy(app);
  await app.register(cookie, { secret: config.sessionSecret });
  await app.register(rateLimit, { global: false });

  await app.register(portalRoutes);
  await app.register(adminRoutes);
  await app.register(consoleRoutes);
  await app.register(forumRoutes);
  // 旧论坛接口已退役，不映射成新接口：新论坛接口（routes/forum-api）注册的具体路径优先匹配，
  // /api/forum 下其余的旧路径，以及 /auth/forum/*、/forum/u/*，一律 410。
  const retired = async (_req: unknown, reply: import("fastify").FastifyReply) => reply.code(410).send({
    error: "legacy_forum_retired", message: "旧论坛接口已停用。新论坛的接口见 /api/forum/state。",
  });
  for (const url of ["/api/forum", "/api/forum/*", "/auth/forum/*", "/forum/u/*"]) {
    app.route({ method: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"], url, handler: retired });
  }
  // 论坛页面由 forum 容器提供（web 容器按 /forum/ 反代）；只有直连核心服务才会走到这里。
  for (const url of ["/forum", "/forum/*"]) {
    app.get(url, async (_req, reply) => {
      if (config.production) return reply.code(503).send({ error: "forum_service_not_ready", message: "论坛页面由 forum 容器提供，核心服务不托管论坛页面。" });
      return reply.redirect("http://127.0.0.1:3456/");
    });
  }

  app.get("/healthz", async () => ({ ok: true, ts: Date.now() }));

  const staticRoots = options.staticRoot === false ? [] : [options.staticRoot ?? [webDist, consoleDist]].flat().filter(root => existsSync(root));
  if (staticRoots.length) {
    await app.register(fastifyStatic, { root: staticRoots, prefix: "/" });
    app.setNotFoundHandler((req, reply) => {
      if (req.url.startsWith("/api") || req.url.startsWith("/auth") || req.url.startsWith("/healthz")) {
        return reply.code(404).send({ error: "not_found" });
      }
      if (/\.[a-z0-9]+(?:\?|$)/i.test(req.url) || !["GET", "HEAD"].includes(req.method)) return reply.code(404).send({ error: "not_found" });
      reply.header("Cache-Control", "no-cache");
      return reply.sendFile(resolveSiteEntry(req.url));
    });
  } else {
    app.get("/", async () => ({ ok: true, note: "app/web/dist and app/console/dist not built yet" }));
  }

  return app;
}

import portalRoutes from "./routes/portal/index.js";
import adminRoutes from "./routes/admin/index.js";
import consoleRoutes from "./routes/console/index.js";
import forumRoutes from "./routes/forum-api/index.js";
import identityRoutes from "./routes/identity/index.js";
import oidcRoutes from "./routes/oidc/index.js";
import siteRoutes from "./routes/sites/index.js";
import Fastify, { type RouteOptions } from "fastify";
import cookie from "@fastify/cookie";
import rateLimit from "@fastify/rate-limit";
import fastifyStatic from "@fastify/static";
import { resolve } from "node:path";
import { existsSync } from "node:fs";
import { APP_ROOT, type AppConfig } from "./config.js";
import { createServices, type AppServices, type ServiceOverrides } from "./services.js";
import { backfillObjectStorage } from "./lib/object-storage-backfill.js";
import { rateLimited, registerHttpPolicy } from "./middleware/http-policy.js";
import { registerShield } from "./middleware/shield.js";
import { registerBearerAuth } from "./middleware/bearer-auth.js";
import { startActivityCleanup } from "./lib/activity.js";

/** 官网产物（app/web）与控制台产物（app/console）分开构建，静态托管时两个目录叠在一起。 */
const webDist = resolve(APP_ROOT, "web/dist");
const consoleDist = resolve(APP_ROOT, "console/dist");

/**
 * 管理端 SPA 的路径与入口：每个环境只有一个域名，管理端靠路径区分，与 Host 无关。
 * 服务端只在这里定义一次；web 镜像内 nginx 的 location 必须与之一致（app/web/Dockerfile）。
 * 管理端是独立的 Vue 包 app/console（极客班控制台），产物入口在 app/console/dist/sites/console/index.html。
 */
export const ADMIN_SPA_PATHS = Object.freeze({ exact: ["/signin", "/device", "/account", "/authorize", "/bind-email", "/complete-profile"], prefixes: ["/admin", "/console"] });
export const ADMIN_SPA_ENTRY = "sites/console/index.html";
export const PORTAL_SPA_ENTRY = "sites/portal/index.html";

/** 按路径决定回哪一份 SPA 入口：控制台或官网。论坛归 app/forum，绝不回退到旧 React 论坛。 */
export function resolveSiteEntry(url: string): string {
  const path = url.split(/[?#]/)[0];
  const admin = ADMIN_SPA_PATHS.exact.includes(path)
    || ADMIN_SPA_PATHS.prefixes.some(prefix => path === prefix || path.startsWith(`${prefix}/`));
  return admin ? ADMIN_SPA_ENTRY : PORTAL_SPA_ENTRY;
}

/**
 * `staticRoot`：false 关闭静态托管；不传时依次查找 app/web/dist 与 app/console/dist。
 * `mailWorker`：开发信循环（每 15 秒发一次到期的信，app.close() 时停下）；只有 index.ts 打开，测试直接调 services.mail.drain()。
 * `sessionCleanup`：定时清过期会话（启动时一次，之后每小时；app.close() 时停下）；index.ts 和本机预览（scripts/local-preview.mjs）打开，测试直接调 auth.cleanupExpiredSessions()。
 * `gitlabSync`：GITLAB_SYNC=on 时定时对一次 GitLab 账号（启动时一次，之后每 10 分钟；app.close() 时等它停下）；GitLab 项目事件拉取（#370）也由这个选项决定开不开，但它不看 GITLAB_SYNC，间隔为 0 时不排定时器；只有 index.ts 打开，测试直接调 gitlab.reconcile() 或 gitlabEvents.collectOnce()。
 *   同一个开关也开比赛贡献收集（#278，GitLab 同步不是 off 时每 10 分钟一轮）；测试直接调 competitionCandidates.collect()。
 * `objectStorageBackfill`：启动后台回填头像与论坛图片到对象存储（#352），只在对象存储开启时跑，只记数量；index.ts 打开，测试不跑。
 * `githubAvatarCheck`：识别 GitHub 头像是不是自动生成的像素图（#343，启动时一轮，之后每 10 分钟；app.close() 时等它停下）；
 *   只有 index.ts 打开，测试直接调 githubAvatars.runOnce()。
 */
/**
 * 请求日志的字段：同 Fastify 默认，只是 `/auth/*` 不记查询串——里面有 OAuth 的 code、state 和注册邀请码（#262）；
 * `/oidc/*` 同样不记（下游应用带来的 state、nonce 与 PKCE 参数，#270）。
 */
export function requestLogFields(req: { method: string; url: string; host?: string; ip?: string; socket?: { remotePort?: number } }) {
  const url = req.url.startsWith("/auth/") || req.url.startsWith("/oidc/") ? req.url.split("?")[0] : req.url;
  return { method: req.method, url, host: req.host, remoteAddress: req.ip, remotePort: req.socket?.remotePort };
}

export type BuildAppOptions = {
  config: AppConfig; services?: AppServices; overrides?: ServiceOverrides; staticRoot?: string | string[] | false; logger?: boolean;
  mailWorker?: boolean; sessionCleanup?: boolean; gitlabSync?: boolean; activityCleanup?: boolean; githubAvatarCheck?: boolean; objectStorageBackfill?: boolean; observeRoute?: (route: RouteOptions) => void;
};
export async function buildApp(options: BuildAppOptions) {
  const config = options.config;
  const services = options.services ?? createServices(config, options.overrides);
  const app = Fastify({
    logger: options.logger ? { serializers: { req: requestLogFields } } : false,
    trustProxy: config.trustProxy,
    ajv: { customOptions: { removeAdditional: false, coerceTypes: false } },
  });
  // 目录工具在 ready 后读取最终 Schema；必须在根路由和所有子插件之前观测注册。
  if (options.observeRoute) app.addHook("onRoute", options.observeRoute);

  app.decorate("services", services);
  let stopActivityCleanup: (() => void) | null = null;
  app.addHook("onClose", async () => {
    // 先等发信循环收尾，再关库
    if (options.mailWorker) await services.mail.stop();
    if (options.sessionCleanup) services.auth.stopCleanup();
    if (options.gitlabSync) await services.gitlab.stop();
    if (options.gitlabSync) await services.competitionCandidates.stop();
    if (options.gitlabSync) await services.gitlabEvents.stop();
    if (options.githubAvatarCheck) await services.githubAvatars.stop();
    stopActivityCleanup?.();
    if (!options.services) services.close();
  });
  // 应用就绪（listen 之前）才开发信循环：路由注册失败时不会留下一个没人关的定时器
  if (options.mailWorker) app.addHook("onReady", async () => { services.mail.start(app.log); });
  if (options.sessionCleanup) app.addHook("onReady", async () => { services.auth.startCleanup(app.log); });
  if (options.gitlabSync) app.addHook("onReady", async () => { services.gitlab.start(app.log); services.competitionCandidates.start(app.log); services.gitlabEvents.start(app.log); });
  if (options.githubAvatarCheck) app.addHook("onReady", async () => { services.githubAvatars.start(app.log); });
  if (options.objectStorageBackfill) {
    app.addHook("onReady", async () => {
      // 后台跑，不挡启动；失败只记一行，下次启动再补。
      void backfillObjectStorage(services.storage.db, services.objectStorage, app.log).catch(() => app.log.warn("对象存储回填中断"));
    });
  }
  // 操作记录每天清一次过期行、按 90 天打码 IP（lib/activity.ts，SPEC §3.7），顺带清 lib/limits.ts 的
  // limit_events（SPEC §3.8）；测试直接调 services.activity.pruneExpired() / services.limits.pruneAll()。
  // 访问防护的信号窗口与封禁表（#333）、限流计数的过期行，和上面两张表一起每天清一次。
  if (options.activityCleanup) app.addHook("onReady", async () => {
    stopActivityCleanup = startActivityCleanup(services.activity, app.log, services.limits, [
      { label: "shield", prune: () => services.shield.prune() },
      { label: "rate limit counters", prune: () => services.rateLimits.pruneBefore(Date.now() - 24 * 3600_000) },
    ]);
  });
  // #274 残留修复 N：迁移报告只在启动时记一次，只记数量（表的前后行数、各类 this_run 计数），
  // 不记 unmapped_heads 里真实的 GitHub 登录名——那是个人数据，只记条数。
  app.addHook("onReady", async () => {
    const report = services.storage.yugcV2Migration;
    app.log.info({
      msg: "yugc-v2 迁移报告",
      tables: report.tables,
      unmapped_heads_count: report.unmapped_heads.length,
      unmapped_capabilities_count: report.unmapped_capabilities.length,
      forum_users_linked_this_run: report.forum_users_linked_this_run,
      account_profiles_created_this_run: report.account_profiles_created_this_run,
      activity_events_copied_this_run: report.activity_events_copied_this_run,
      skipped_role_assignments: report.skipped_role_assignments,
    });
  });
  registerHttpPolicy(app);
  // 访问防护（#333）：封禁的 IP 在路由之前就被拦下；计分在响应结束后做
  registerShield(app);
  await app.register(cookie, { secret: config.sessionSecret });
  // geek 命令行的 Bearer 鉴权（#277）：必须在 cookie 插件之后挂，它要读 req.cookies 判断「同一个请求
  // 不能同时带 cookie 和 Bearer」。
  registerBearerAuth(app);
  // 只限写了 config.rateLimit 的路由；超额一律 429 rate_limited，路由不另写 errorResponseBuilder（#191）。
  // 计数落库（#333，lib/rate-store.ts），重启后同一窗口内的次数不清零。
  await app.register(rateLimit, { global: false, store: services.rateLimits.Store, errorResponseBuilder: () => rateLimited() });

  await app.register(portalRoutes);
  await app.register(adminRoutes);
  await app.register(identityRoutes);
  await app.register(consoleRoutes);
  await app.register(forumRoutes);
  await app.register(oidcRoutes);
  // 比赛官网（#278）：/c/<slug>/ 由这里直接读数据卷里的站点文件，web 镜像的 nginx 把 /c/ 反代过来。
  await app.register(siteRoutes);
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
      if (req.url.startsWith("/api") || req.url.startsWith("/auth") || req.url.startsWith("/oidc") || req.url.startsWith("/healthz")) {
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

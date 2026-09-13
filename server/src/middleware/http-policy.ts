import type { FastifyInstance } from "fastify";

/** Fail closed for browser cross-origin writes; bearer-only clients remain usable. */
export function registerHttpPolicy(app: FastifyInstance) {
  app.addHook("onRequest", async (req, reply) => {
    const cfg = app.services.config;
    if (["GET", "HEAD", "OPTIONS"].includes(req.method)) return;
    const origin = req.headers.origin;
    const allowed = new Set([cfg.publicOrigin, cfg.siteOrigin, `${new URL(cfg.siteOrigin).protocol}//${cfg.siteHosts.forum}`]);
    // Dev requests are proxied from the Vite origin configured in PUBLIC_ORIGIN.
    if (origin && !allowed.has(origin)) return reply.code(403).send({ error: "invalid_origin", message: "请求来源不被允许" });
    if (!origin && req.headers["sec-fetch-site"] === "cross-site") return reply.code(403).send({ error: "invalid_origin" });
  });
  app.addHook("onSend", async (req, reply, payload) => {
    reply.header("X-Content-Type-Options", "nosniff");
    reply.header("X-Frame-Options", "DENY");
    reply.header("Referrer-Policy", "strict-origin-when-cross-origin");
    if (req.url.startsWith("/auth") || req.url.startsWith("/api")) reply.header("Cache-Control", "no-store");
    return payload;
  });
  app.setErrorHandler((cause, req, reply) => {
    const error = cause as { statusCode?: number; code?: string; message: string; validation?: unknown };
    const status = error.statusCode && error.statusCode >= 400 && error.statusCode <= 599 ? error.statusCode : 500;
    if (status >= 500) req.log.error({ code: error.code, status, requestId: req.id }, "request failed");
    return reply.code(status).send({
      error: error.validation ? "validation_error" : status >= 500 ? "internal_error" : error.code ?? "request_error",
      message: status >= 500 ? "服务暂时不可用，请稍后重试" : error.message,
      request_id: req.id,
    });
  });
}

import type { FastifyInstance } from "fastify";

/** User-facing summaries for GitHub 4xx; the upstream text itself is never echoed. */
const UPSTREAM_MESSAGES: Record<number, string> = {
  401: "GitHub 授权已失效，请重新登录",
  403: "GitHub 拒绝了该操作（权限不足或触发频率限制）",
  404: "GitHub 上找不到该资源",
  409: "操作与 GitHub 上的当前状态冲突",
  422: "GitHub 拒绝了请求（参数无效或同名资源已存在）",
  429: "GitHub 请求过于频繁，请稍后重试",
};

/** Fail closed for browser cross-origin writes; bearer-only clients remain usable. */
export function registerHttpPolicy(app: FastifyInstance) {
  app.addHook("onRequest", async (req, reply) => {
    const cfg = app.services.config;
    if (["GET", "HEAD", "OPTIONS"].includes(req.method)) return;
    const origin = req.headers.origin;
    // One origin per environment (portal, admin and forum share it); dev requests are proxied from the Vite origin in PUBLIC_ORIGIN.
    if (origin && origin !== cfg.publicOrigin) return reply.code(403).send({ error: "invalid_origin", message: "请求来源不被允许" });
    if (!origin && req.headers["sec-fetch-site"] === "cross-site") return reply.code(403).send({ error: "invalid_origin" });
  });
  app.addHook("onSend", async (req, reply, payload) => {
    reply.header("X-Content-Type-Options", "nosniff");
    reply.header("X-Frame-Options", "DENY");
    reply.header("Referrer-Policy", "strict-origin-when-cross-origin");
    // 唯一的例外：论坛头像按内容哈希寻址、内容永不改变，成功的响应由路由自己下发长期缓存。
    const immutable = reply.statusCode === 200 && req.url.startsWith("/api/forum/avatars/");
    if ((req.url.startsWith("/auth") || req.url.startsWith("/api")) && !immutable) reply.header("Cache-Control", "no-store");
    return payload;
  });
  app.setErrorHandler((cause, req, reply) => {
    const error = cause as { statusCode?: number; status?: number; code?: string; message: string; validation?: unknown };
    // Octokit's RequestError only carries `status`; Fastify's own errors carry `statusCode`.
    const upstream = error.statusCode === undefined && typeof error.status === "number";
    const raw = error.statusCode ?? error.status;
    const status = raw && raw >= 400 && raw <= 599 ? raw : 500;
    if (status >= 500) req.log.error({ code: error.code, status, requestId: req.id }, "request failed");
    else if (upstream) req.log.warn({ status, requestId: req.id }, "upstream request rejected");
    return reply.code(status).send({
      error: error.validation ? "validation_error" : status >= 500 ? "internal_error" : upstream ? "upstream_rejected" : error.code ?? "request_error",
      message: status >= 500 ? "服务暂时不可用，请稍后重试" : upstream ? UPSTREAM_MESSAGES[status] ?? `GitHub 拒绝了该请求（HTTP ${status}）` : error.message,
      request_id: req.id,
    });
  });
}

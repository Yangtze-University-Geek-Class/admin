import type { FastifyInstance } from "fastify";
import { endRejectedSession, isRejectedToken } from "./require-auth.js";

/** User-facing summaries for GitHub 4xx; the upstream text itself is never echoed. */
const UPSTREAM_MESSAGES: Record<number, string> = {
  401: "GitHub 授权已失效，请重新登录",
  403: "GitHub 拒绝了该操作（权限不足或触发频率限制）",
  404: "GitHub 上找不到该资源",
  409: "操作与 GitHub 上的当前状态冲突",
  422: "GitHub 拒绝了请求（参数无效或同名资源已存在）",
  429: "GitHub 请求过于频繁，请稍后重试",
};

/**
 * 限流的 429，经下面的错误处理器回 `{ error: "rate_limited", message, request_id }`。路由自己数次数时 throw 它；
 * app.ts 注册 `@fastify/rate-limit` 时把它设成默认的 errorResponseBuilder，路由级 `config.rateLimit` 不用各写一遍（#191）。
 * 插件把 errorResponseBuilder 的返回值当错误抛出，错误处理器只认 `statusCode` 与 `code`：返回
 * `{ statusCode, error, message }` 这样的普通对象会被回成 `request_error`。
 * 不看插件传进来的 respCtx，也就不处理 ban：插件 ban 时给的是 403，用它仍回 429。现在没有路由配 ban，
 * 以后要配时让 builder 按 respCtx.ban 回 403。
 */
export const rateLimited = () => Object.assign(new Error("操作太频繁，请稍后再试"), { statusCode: 429, code: "rate_limited" });

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
    // 带会话的请求调 GitHub 用的都是这个会话自己的令牌。邀请链接用发起人的令牌，但 join.ts 不加载会话（req.session 为空）、
    // 也自己接住上游错误，不会走到这里；以后有路由在加载会话之后用别人的令牌调 GitHub，要自己接住它的 401。
    // GitHub 拒绝了它，这个会话就没用了：结束会话，和会话到期一样回 401 session_expired，页面按未登录处理（#164）。
    if (req.session && isRejectedToken(cause)) {
      endRejectedSession(req, reply, req.session);
      return reply.code(401).send({ error: "session_expired", message: "登录已失效，请重新登录", request_id: req.id });
    }
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

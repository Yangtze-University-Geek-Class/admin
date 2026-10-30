import type { FastifyInstance, FastifyRequest } from "fastify";
import type { ActivitySurface } from "../lib/activity.js";

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

/** 粗按 URL 前缀分 surface（SPEC §3.7 的 activity_events.surface）；只用来分类，不影响鉴权。 */
function surfaceFor(url: string): ActivitySurface {
  if (url.startsWith("/api/console/")) return "console";
  if (url.startsWith("/api/forum/")) return "forum";
  if (url.startsWith("/auth/device/") || url.startsWith("/oidc/")) return "cli";
  if (url.startsWith("/api/events")) return "api";
  return "portal";
}

/**
 * 403/429 响应体里已经带了最具体的线索：权限中间件回 `{ error: "forbidden", node }`，限额回
 * `{ error: "rate_limited", bucket }`（路由自己数的）或没有 bucket（`@fastify/rate-limit` 插件按路由限流的）。
 * 按这个顺序取 action，取不到就退回 `http.<error>`，保证每一条都有可读的名字。
 */
function actionFor(body: unknown): string {
  const b = body as { node?: unknown; bucket?: unknown; error?: unknown } | null;
  if (typeof b?.node === "string") return b.node;
  if (typeof b?.bucket === "string") return b.bucket;
  if (typeof b?.error === "string") return `http.${b.error}`;
  return "http.denied";
}

/**
 * 所有被 403 拒绝、被 429 拦下的请求记一条操作记录（SPEC §3.7「所有被 403 拒绝的请求记 outcome = 'denied'，
 * 被 429 拦下的记 outcome = 'limited'」），集中在这一个钩子里做，不要求每个路由自己记——这样新加的写接口
 * 天然就有这条覆盖，不会漏。放在 onSend（有响应体可读）而不是 onResponse（没有）。
 * 记下方法、匹配到的路由模板（`/api/console/security/blocks/:ip`，不是实际地址，没匹配到路由是 null）与状态码（#333），
 * 不记原始路径、查询串和请求体：排查时能分清是哪个接口被拦，又不把路径里的编号、地址带进记录。
 */
function recordDenialOrLimit(req: FastifyRequest, statusCode: number, payload: unknown): void {
  if (statusCode !== 403 && statusCode !== 429) return;
  // 被访问防护拦下的请求（#333）不逐条记：封禁本身已经写了审计，攻击时逐条写会把操作记录撑大
  if (req.shieldBlocked) return;
  let body: unknown = null;
  if (typeof payload === "string") { try { body = JSON.parse(payload); } catch { /* 不是 JSON，按通用名记 */ } }
  // console/activity.ts 的 blocked_today 按 meta.bucket 分组统计；只有路由自己数的限额（回了 bucket 字段的）
  // 才有名字可分组，@fastify/rate-limit 插件按路由限流的通用 429 没有 bucket，不写这个字段。
  const bucket = (body as { bucket?: unknown } | null)?.bucket;
  req.server.services.activity.recordDenial(req, {
    action: actionFor(body), surface: surfaceFor(req.url), outcome: statusCode === 429 ? "limited" : "denied",
    meta: typeof bucket === "string" ? { bucket } : undefined,
  }, { method: req.method, route: req.routeOptions.url ?? null, status: statusCode });
}

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
    // 例外：论坛头像、账号头像（#274）、论坛表情图片（#286）都按内容哈希寻址、内容永不改变，NANO 默认头像（#343）地址带版本号，
    // 成功的响应由路由自己下发长期缓存。表情的列表接口（/api/forum/stickers，没有斜杠与哈希）不在其中，仍然不缓存。
    const immutable = reply.statusCode === 200
      && (req.url.startsWith("/api/forum/avatars/") || req.url.startsWith("/api/identity/avatar/") || req.url.startsWith("/api/forum/stickers/")
        || req.url.startsWith("/api/identity/default-avatar/"));
    if ((req.url.startsWith("/auth") || req.url.startsWith("/api") || req.url.startsWith("/oidc/")) && !immutable) reply.header("Cache-Control", "no-store");
    recordDenialOrLimit(req, reply.statusCode, payload);
    return payload;
  });
  app.setErrorHandler((cause, req, reply) => {
    const error = cause as { statusCode?: number; status?: number; code?: string; message: string; validation?: unknown; extra?: Record<string, unknown> };
    // #274 item I 的 extras d：这里原来有一段专接「会话自己的 GitHub 令牌被 401」的分支（#164），删 GitHub
    // 组织管理、lib/github-connection.ts 和 /api/join/:token 之后，服务端生产代码不再用会话自己的令牌调
    // GitHub（services.ts 的 github 工厂只给既有测试用，见那边的注释），这个分支永远不会被真实触发，删掉。
    // Octokit's RequestError only carries `status`; Fastify's own errors carry `statusCode`.
    const upstream = error.statusCode === undefined && typeof error.status === "number";
    const raw = error.statusCode ?? error.status;
    const status = raw && raw >= 400 && raw <= 599 ? raw : 500;
    // GitHub App 用不了（503）照实说，让管理员知道该查 App 的配置；别的 5xx 一律只说「服务暂时不可用」
    const masked = status >= 500 && error.code !== "github_connection_failed";
    if (status >= 500) req.log.error({ code: error.code, status, upstreamStatus: (cause as { upstreamStatus?: unknown }).upstreamStatus, requestId: req.id }, "request failed");
    else if (upstream) req.log.warn({ status, requestId: req.id }, "upstream request rejected");
    // #276 修复：ForumError 的 `extra`（CONTRACT-276 §1 的 401 `need`、403 的 `node`+`need`）一直没有真的铺进响应体——
    // 这里原来只回 `{ error, message, request_id }` 三个字段，视觉上看不出来，论坛前端据 `need` 判断缺哪一级的分支
    // 一直拿不到这个字段。masked/upstream/validation 这三支是别的中间件/插件自己造的错误对象，不会带 `extra`，
    // 这里仍然显式排掉，不让以后哪个 5xx 错误顺手挂了个 extra 就泄出去。
    const extra = !masked && !upstream && !error.validation ? error.extra : undefined;
    return reply.code(status).send({
      error: error.validation ? "validation_error" : masked ? "internal_error" : upstream ? "upstream_rejected" : error.code ?? "request_error",
      message: masked ? "服务暂时不可用，请稍后重试" : upstream ? UPSTREAM_MESSAGES[status] ?? `GitHub 拒绝了该请求（HTTP ${status}）` : error.message,
      request_id: req.id,
      ...(extra ?? {}),
    });
  });
}

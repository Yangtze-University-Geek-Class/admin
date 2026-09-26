import type { FastifyReply, FastifyRequest } from "fastify";


declare module "fastify" {
  interface FastifyRequest {
    session?: {
      id: string;
      login: string;
      user_id: number | null;
      avatar_url: string | null;
      accessToken: string;
    };
    orgRole?: "admin" | "member" | null;
  }
}

export async function requireAuth(req: FastifyRequest, reply: FastifyReply) {
  const sid = req.cookies?.sid;
  if (!sid) return reply.code(401).send({ error: "not_signed_in" });
  if (!loadSession(req)) return reply.code(401).send({ error: "session_expired" });
}

/** 有有效的 `sid` 就挂到 req.session 并返回 true；没有或已过期返回 false，不回复。给「游客也能用」的接口（论坛）用。 */
export function loadSession(req: FastifyRequest): boolean {
  if (req.session) return true;
  const sid = req.cookies?.sid;
  const s = sid ? req.server.services.auth.getSession(sid) : null;
  if (!s) return false;
  req.session = {
    id: s.id,
    login: s.login,
    user_id: s.user_id,
    avatar_url: s.avatar_url,
    accessToken: s.accessToken,
  };
  return true;
}

/** 清掉统一登录的 cookie：退出登录时，和会话里的 GitHub 令牌失效时。`forum_sid` 是旧论坛留下的，一起清。 */
export function clearSessionCookies(reply: FastifyReply): void {
  const { cookieDomain } = reply.server.services.config;
  reply.clearCookie("sid", { path: "/", domain: cookieDomain });
  reply.clearCookie("forum_sid", { path: "/", domain: cookieDomain });
}

/**
 * GitHub 用 401 拒绝了这次调用用的令牌（Octokit 的错误只带 `status`；Fastify 自己的错误带 `statusCode`，不算）。
 * GitHub 只在令牌本身无效时回 401：被用户撤销，或同一用户的令牌超过 10 个时被收回。权限不够是 403 或 404。
 */
export function isRejectedToken(error: unknown): boolean {
  const e = error as { status?: unknown; statusCode?: unknown } | null | undefined;
  return e?.statusCode === undefined && e?.status === 401;
}

/**
 * 会话里存的 GitHub 令牌已经失效，这个会话再也查不了组织角色：删掉它、清 cookie，之后的请求按未登录处理（#164）。
 * 同一页面的几个请求一起碰到时，只有真正删掉会话的那一个记审计 `auth.session_rejected`。
 */
export function endRejectedSession(req: FastifyRequest, reply: FastifyReply, session: { id: string; login: string }): void {
  const { auth, storage } = req.server.services;
  if (auth.destroySession(session.id)) storage.audit(null, session.login, "auth.session_rejected", session.login, undefined, req.ip);
  clearSessionCookies(reply);
  req.log.warn({ requestId: req.id }, "session ended: GitHub rejected its token");
}

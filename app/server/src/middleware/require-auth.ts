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

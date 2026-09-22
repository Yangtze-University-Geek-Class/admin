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
  const s = req.server.services.auth.getSession(sid);
  if (!s) return reply.code(401).send({ error: "session_expired" });
  req.session = {
    id: s.id,
    login: s.login,
    user_id: s.user_id,
    avatar_url: s.avatar_url,
    accessToken: s.accessToken,
  };
}

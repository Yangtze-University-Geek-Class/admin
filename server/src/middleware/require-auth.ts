import type { FastifyReply, FastifyRequest } from "fastify";
import { config } from "../config.js";
import { getSession } from "../lib/auth.js";

declare module "fastify" {
  interface FastifyRequest {
    session?: { id: string; login: string; accessToken: string };
  }
}

export async function requireAuth(req: FastifyRequest, reply: FastifyReply) {
  const sid = req.cookies?.sid;
  if (!sid) return reply.code(401).send({ error: "not_signed_in" });
  const s = getSession(sid);
  if (!s) return reply.code(401).send({ error: "session_expired" });
  if (s.login !== config.adminLogin) return reply.code(403).send({ error: "forbidden" });
  req.session = { id: s.id, login: s.login, accessToken: s.access_token };
}

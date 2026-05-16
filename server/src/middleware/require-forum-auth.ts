import type { FastifyReply, FastifyRequest } from "fastify";
import { getForumUserBySession } from "../lib/forum-auth.js";
import type { ForumUser } from "../lib/forum-db.js";

declare module "fastify" {
  interface FastifyRequest {
    forumUser?: ForumUser;
  }
}

export async function requireForumAuth(req: FastifyRequest, reply: FastifyReply) {
  const sid = req.cookies?.forum_sid;
  if (!sid) return reply.code(401).send({ error: "not_signed_in" });
  const user = getForumUserBySession(sid);
  if (!user) return reply.code(401).send({ error: "session_expired" });
  if (user.role === "banned") return reply.code(403).send({ error: "banned" });
  req.forumUser = user;
}

export async function attachForumUser(req: FastifyRequest) {
  const sid = req.cookies?.forum_sid;
  if (!sid) return;
  const user = getForumUserBySession(sid);
  if (user && user.role !== "banned") req.forumUser = user;
}

export async function requireForumAdmin(req: FastifyRequest, reply: FastifyReply) {
  await requireForumAuth(req, reply);
  if (reply.sent) return;
  if (req.forumUser?.role !== "admin" && req.forumUser?.role !== "mod") {
    return reply.code(403).send({ error: "forbidden" });
  }
}

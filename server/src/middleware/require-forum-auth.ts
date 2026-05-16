import type { FastifyReply, FastifyRequest } from "fastify";
import { getForumUserBySession } from "../lib/forum-auth.js";
import type { ForumUser } from "../lib/forum-db.js";
import { extractBearer, resolveBearerToForumUser } from "../lib/forum-bearer.js";

declare module "fastify" {
  interface FastifyRequest {
    forumUser?: ForumUser;
  }
}

async function resolveForumUser(req: FastifyRequest): Promise<ForumUser | null> {
  const sid = req.cookies?.forum_sid;
  if (sid) {
    const user = getForumUserBySession(sid);
    if (user) return user;
  }
  const bearer = extractBearer(req as any);
  if (bearer) {
    return await resolveBearerToForumUser(bearer);
  }
  return null;
}

export async function requireForumAuth(req: FastifyRequest, reply: FastifyReply) {
  const user = await resolveForumUser(req);
  if (!user) return reply.code(401).send({ error: "not_signed_in" });
  if (user.role === "banned") return reply.code(403).send({ error: "banned" });
  req.forumUser = user;
}

export async function attachForumUser(req: FastifyRequest) {
  const user = await resolveForumUser(req);
  if (user && user.role !== "banned") req.forumUser = user;
}

export async function requireForumAdmin(req: FastifyRequest, reply: FastifyReply) {
  await requireForumAuth(req, reply);
  if (reply.sent) return;
  if (req.forumUser?.role !== "admin" && req.forumUser?.role !== "mod") {
    return reply.code(403).send({ error: "forbidden" });
  }
}

export async function requireForumTeacherOrAdmin(req: FastifyRequest, reply: FastifyReply) {
  await requireForumAuth(req, reply);
  if (reply.sent) return;
  const role = req.forumUser?.role;
  if (role !== "admin" && role !== "mod" && role !== "teacher") {
    return reply.code(403).send({ error: "forbidden", message: "仅老师或负责人可访问" });
  }
}

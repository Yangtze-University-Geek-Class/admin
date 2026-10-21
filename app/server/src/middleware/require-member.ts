import type { FastifyReply, FastifyRequest } from "fastify";
import { resolveAccess } from "./require-capability.js";

/**
 * 报名与组队只对极客班成员开放（#239）：会话必须有统一账号，且这个账号是组织的 active 成员。
 *
 * 认人只看会话里的 `account_id`，不按 GitHub 登录名兜底——登录名会改，旧名还可能被别人注册。
 * 成员资格只在这里判一次：今天走 `resolveAccess(req)`（本人 token 查组织角色，缓存 60 秒），
 * ADR-0005 交付 2 的资格模块上线后只改这一处，比赛路由不直接读 `access.orgRole`。
 */
export async function requireMember(req: FastifyRequest, reply: FastifyReply) {
  if (!req.session?.account_id) return reply.code(401).send({ error: "not_signed_in", message: "请先登录" });
  const access = await resolveAccess(req);
  if (access.githubRole === null) {
    return reply.code(403).send({ error: "not_member", message: "报名与组队只对极客班成员开放" });
  }
}

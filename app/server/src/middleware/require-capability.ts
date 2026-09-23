import type { FastifyReply, FastifyRequest } from "fastify";
import { capabilityLabel, type Access, type Capability } from "../lib/roles.js";

declare module "fastify" {
  interface FastifyRequest {
    /** 本次请求的控制台身份；同一请求只解析一次。 */
    access?: Access;
  }
}

/** 解析并缓存到 req.access。GitHub 调用出错直接抛给 http-policy，不当成「不是组织成员」。 */
export async function resolveAccess(req: FastifyRequest): Promise<Access> {
  if (req.access) return req.access;
  const session = req.session!;
  req.access = await req.server.services.access.resolve({ login: session.login, userId: session.user_id, accessToken: session.accessToken });
  return req.access;
}

/** 缺少能力时的统一 403 体。`reason` 只在被 GitHub 上限挡掉时出现。 */
export function missingCapability(access: Access, anyOf: Capability[]) {
  const [first] = anyOf;
  const blocked = access.blocked.find(item => anyOf.includes(item.capability));
  return {
    error: "missing_capability", capability: first, any_of: anyOf,
    ...(blocked ? { reason: blocked.reason } : {}),
    message: `需要「${capabilityLabel(first)}」权限`,
  };
}

/** 要求调用者至少持有 anyOf 中的一项能力。需在 requireAuth 之后使用。 */
export function requireCapability(...anyOf: Capability[]) {
  return async (req: FastifyRequest, reply: FastifyReply) => {
    if (!req.session) return reply.code(401).send({ error: "not_signed_in" });
    const access = await resolveAccess(req);
    if (!anyOf.some(capability => access.capabilities.has(capability))) return reply.code(403).send(missingCapability(access, anyOf));
  };
}

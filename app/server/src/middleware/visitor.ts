import { randomUUID } from "node:crypto";
import type { FastifyReply, FastifyRequest } from "fastify";

declare module "fastify" {
  interface FastifyRequest {
    /** 访客标识（#274 SPEC §3.x）：没登录也有，给限额、操作记录当「这是谁」用；不参与任何权限判定。 */
    visitorId?: string;
  }
}

export const VISITOR_COOKIE = "yugc_vid";
const TTL_S = 365 * 24 * 3600;
/** 标准 UUID（含随机版本号与变体位），不管大小写；带来的 cookie 不合这个形状就当没有，重发一个。 */
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** 请求原本带没带一个合法的访客 cookie（在 attachVisitorId 之前调用）：没带的注册按更严的无 cookie 额度算（#333）。 */
export function hasVisitorCookie(req: FastifyRequest): boolean {
  const existing = req.cookies?.[VISITOR_COOKIE];
  return Boolean(existing && UUID_RE.test(existing));
}

/**
 * 访客 cookie（#274 SPEC §3.x）：门户、论坛接口第一次收到请求、还没有这个 cookie 时发一个随机 UUID——
 * HttpOnly、SameSite=Lax，生产环境再加 Secure，1 年有效期。已经带着合法的就原样沿用，不重发、不续期
 * （访客长期不来也不用管，1 年后自然过期，下次重新发一个）。`req.visitorId` 之后随便哪段代码都能读到，
 * 不单独再查一次 cookie。
 */
export async function attachVisitorId(req: FastifyRequest, reply: FastifyReply): Promise<void> {
  const existing = req.cookies?.[VISITOR_COOKIE];
  if (existing && UUID_RE.test(existing)) {
    req.visitorId = existing.toLowerCase();
    return;
  }
  const id = randomUUID();
  req.visitorId = id;
  const { cookieDomain, cookieSecure } = req.server.services.config;
  reply.setCookie(VISITOR_COOKIE, id, { httpOnly: true, secure: cookieSecure, sameSite: "lax", path: "/", domain: cookieDomain, maxAge: TTL_S });
}

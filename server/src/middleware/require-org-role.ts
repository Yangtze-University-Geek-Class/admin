import type { FastifyReply, FastifyRequest } from "fastify";
import { getOrgRole } from "../lib/github.js";

export function requireOrgRole(minRole: "admin" | "member") {
  return async (req: FastifyRequest, reply: FastifyReply) => {
    if (!req.session) return reply.code(401).send({ error: "not_signed_in" });
    const org = (req.params as { org?: string }).org;
    if (!org) return reply.code(400).send({ error: "missing org" });
    const role = await getOrgRole(req.session.accessToken, org, req.session.login);
    req.orgRole = role;
    if (role === null) return reply.code(403).send({ error: "not_a_member_of_org", org });
    if (minRole === "admin" && role !== "admin") {
      return reply.code(403).send({ error: "requires_org_admin", org, your_role: role });
    }
  };
}

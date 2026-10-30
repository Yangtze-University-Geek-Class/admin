import type { FastifyInstance } from "fastify";
import { requireAuth } from "../../middleware/require-auth.js";
import { requirePermission } from "../../middleware/require-permission.js";
import { requireStepUp } from "../../middleware/require-step-up.js";
import { InviteCodeError, inviteUsable, type InviteInput, type InvitePatch } from "../../lib/invite-codes.js";

/**
 * 注册邀请码（#262，所有者 2026-10-23 提出在 admin 控制台再加一层邀请码逻辑）：控制台列出、新建、修改、停用。
 * 节点 `invite.manage`（CONTRACT-274 §5）。
 */
export default async function consoleInviteRoutes(app: FastifyInstance) {
  const { invites } = app.services;
  app.addHook("preHandler", requireAuth);
  const manage = { preHandler: requirePermission("invite.manage") };
  const write = { preHandler: [requirePermission("invite.manage"), requireStepUp], config: { rateLimit: { max: 30, timeWindow: "1 minute" } } };

  app.get("/api/console/invites", manage, async () => ({ invites: invites.list() }));

  app.post<{ Body: InviteInput }>("/api/console/invites", write, async (req, reply) => {
    try {
      const invite = invites.create(req.body, req.session!.login);
      app.services.activity.recordActivity(req, { action: "invite.create", surface: "console", target_type: "invite_code", target_id: invite.code, outcome: "ok", meta: { id: invite.id, max_uses: invite.max_uses, expires_at: invite.expires_at } });
      return reply.code(201).send({ ...invite, usable: inviteUsable(invite, Date.now()) });
    } catch (error) {
      if (error instanceof InviteCodeError) return reply.code(error.code === "invite_code_taken" ? 409 : 400).send({ error: error.code, message: error.message });
      throw error;
    }
  });

  app.patch<{ Params: { id: string }; Body: InvitePatch }>("/api/console/invites/:id", write, async (req, reply) => {
    const id = Number(req.params.id);
    const changed = invites.update(id, req.body);
    if (changed === null) return reply.code(404).send({ error: "not_found", message: "没有这个邀请码" });
    const invite = invites.get(id)!;
    if (changed.length) app.services.activity.recordActivity(req, { action: "invite.update", surface: "console", target_type: "invite_code", target_id: invite.code, outcome: "ok", meta: { id, fields: changed, disabled: invite.disabled } });
    return { ...invite, usable: inviteUsable(invite, Date.now()) };
  });
}

import { isIP } from "node:net";
import type { FastifyInstance } from "fastify";
import { requireAuth } from "../../middleware/require-auth.js";
import { requirePermission } from "../../middleware/require-permission.js";
import { requireStepUp } from "../../middleware/require-step-up.js";

/**
 * 访问防护的封禁列表与解封（#333，lib/shield.ts）：节点 `security.manage`，种子里只有站长的根通配 `*` 默认拿到。
 * 列表与解封都写操作记录；解封立刻结束生效中的封禁，级别归零，下一次封禁从第一级（默认 15 分钟）重新算。
 * 没有生效中的封禁时解封回 404，不写记录。
 */
export default async function securityRoutes(app: FastifyInstance) {
  const { shield, decoy, storage, activity } = app.services;
  app.addHook("preHandler", requireAuth);
  const manage = { preHandler: requirePermission("security.manage") };
  const clear = { preHandler: [requirePermission("security.manage"), requireStepUp] };

  app.get("/api/console/security/decoy", manage, async () => decoy.get());
  app.put<{ Body: { enabled: true; duration_minutes: number } | { enabled: false } }>("/api/console/security/decoy", clear, async (req) => {
    return storage.db.transaction(() => {
      const minutes = req.body.enabled ? req.body.duration_minutes : null;
      const status = decoy.setEnabled(req.body.enabled, minutes ?? undefined);
      activity.recordActivity(req, {
        action: "security.decoy.update", surface: "console", outcome: "ok",
        meta: { enabled: req.body.enabled, duration_minutes: minutes, expires_at: status.expires_at },
      });
      return status;
    }).immediate();
  });

  app.get("/api/console/security/blocks", manage, async (req) => {
    const blocks = shield.list();
    app.services.activity.recordActivity(req, { action: "security.blocks.view", surface: "console", outcome: "ok", meta: { count: blocks.length } });
    return { blocks };
  });

  app.delete<{ Params: { ip: string } }>("/api/console/security/blocks/:ip", clear, async (req, reply) => {
    const ip = req.params.ip;
    if (!isIP(ip)) return reply.code(400).send({ error: "bad_ip", message: "IP 地址格式不对" });
    const cleared = app.services.storage.db.transaction(() => {
      const block = shield.unblock(ip);
      if (block) app.services.activity.recordActivity(req, { action: "security.block.clear", surface: "console", target_type: "ip", target_id: ip, outcome: "ok", meta: { level: block.level } });
      return block;
    }).immediate();
    if (!cleared) return reply.code(404).send({ error: "not_found", message: "这个地址没有生效中的封禁" });
    return { ip, cleared: true };
  });
}

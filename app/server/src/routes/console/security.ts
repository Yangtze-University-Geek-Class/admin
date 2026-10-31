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
  const { shield, decoy, securityPolicy, storage, activity } = app.services;
  app.addHook("preHandler", requireAuth);
  const manage = { preHandler: requirePermission("security.manage") };
  const clear = { preHandler: [requirePermission("security.manage"), requireStepUp] };

  app.get("/api/console/security/decoy", manage, async () => decoy.get());
  app.put<{ Body: { enabled: true; duration_minutes: number } | { enabled: true; permanent: true } | { enabled: false } }>("/api/console/security/decoy", clear, async (req) => {
    return storage.db.transaction(() => {
      const body = req.body;
      // 合同已保证 permanent 与 duration_minutes 二选一；这里只做映射。
      const duration = body.enabled ? ("permanent" in body ? "permanent" : body.duration_minutes) : undefined;
      const status = decoy.setEnabled(body.enabled, duration);
      activity.recordActivity(req, {
        action: "security.decoy.update", surface: "console", outcome: "ok",
        meta: {
          enabled: body.enabled, duration_minutes: typeof duration === "number" ? duration : null,
          permanent: duration === "permanent", expires_at: status.expires_at,
        },
      });
      return status;
    }).immediate();
  });

  app.get("/api/console/security/policy", manage, async (req) => {
    const result = securityPolicy.get();
    activity.recordActivity(req, { action: "security.policy.view", surface: "console", outcome: "ok", meta: { version: result.version, allowlist_count: result.allowlist_count } });
    return result;
  });
  app.put<{ Body: { strict_mode: boolean; strict_threshold: number; strict_window_seconds: number; version: number } }>("/api/console/security/policy", clear, async (req) => {
    return storage.db.transaction(() => {
      const result = securityPolicy.setRuntime(req.body);
      activity.recordActivity(req, { action: "security.policy.update", surface: "console", outcome: "ok", meta: { strict_mode: result.strict_mode, strict_threshold: result.strict_threshold, strict_window_seconds: result.strict_window_seconds, version: result.version } });
      return result;
    }).immediate();
  });
  app.get("/api/console/security/allowlist", manage, async (req) => {
    const items = securityPolicy.list();
    activity.recordActivity(req, { action: "security.allowlist.view", surface: "console", outcome: "ok", meta: { count: items.length } });
    return { items };
  });
  app.post<{ Body: { cidr: string; note: string; version: number } }>("/api/console/security/allowlist", clear, async (req, reply) => {
    const entry = storage.db.transaction(() => {
      const created = securityPolicy.add({ cidr: req.body.cidr, note: req.body.note, createdBy: req.session!.account_id, version: req.body.version });
      activity.recordActivity(req, { action: "security.allowlist.add", surface: "console", target_type: "security_allowlist", target_id: String(created.id), outcome: "ok", meta: { entry_id: created.id } });
      return created;
    }).immediate();
    return reply.code(201).send(entry);
  });
  app.delete<{ Params: { id: string }; Body: { confirm: true; version: number } }>("/api/console/security/allowlist/:id", clear, async (req) => {
    return storage.db.transaction(() => {
      const id = Number(req.params.id);
      const version = securityPolicy.remove(id, req.body.version);
      activity.recordActivity(req, { action: "security.allowlist.remove", surface: "console", target_type: "security_allowlist", target_id: String(id), outcome: "ok", meta: { entry_id: id } });
      return { ok: true as const, version };
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

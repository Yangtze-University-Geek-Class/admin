import { randomBytes } from "node:crypto";
import type { FastifyInstance } from "fastify";
import { requireAuth } from "../../middleware/require-auth.js";
import { requireOrgRole } from "../../middleware/require-org-role.js";
import { audit, db } from "../../lib/db.js";
import { encrypt } from "../../lib/crypto.js";

type CreateBody = {
  hours: number;
  max_uses: number;
  note?: string;
  team_slug?: string | null;
};

export default async function inviteLinksRoutes(app: FastifyInstance) {
  app.addHook("preHandler", requireAuth);

  app.get<{ Params: { org: string } }>("/api/admin/:org/invite-links", {
    preHandler: requireOrgRole("admin"),
  }, async (req) => {
    const { org } = req.params;
    const rows = db.prepare(
      "SELECT token, org, created_by, note, max_uses, current_uses, expires_at, team_slug, disabled, created_at FROM invite_links WHERE org = ? ORDER BY created_at DESC"
    ).all(org);
    return { links: rows };
  });

  app.post<{ Params: { org: string }; Body: CreateBody }>("/api/admin/:org/invite-links", {
    preHandler: requireOrgRole("admin"),
  }, async (req, reply) => {
    const { org } = req.params;
    const { hours, max_uses, note, team_slug } = req.body;
    if (!Number.isFinite(hours) || hours <= 0 || hours > 24 * 365) {
      return reply.code(400).send({ error: "hours 必须在 1 到 8760 之间" });
    }
    if (!Number.isInteger(max_uses) || max_uses < 1 || max_uses > 1000) {
      return reply.code(400).send({ error: "max_uses 必须在 1 到 1000 之间" });
    }
    const token = randomBytes(18).toString("base64url");
    const now = Date.now();
    const expires = now + hours * 60 * 60 * 1000;
    db.prepare(
      "INSERT INTO invite_links(token, org, created_by, created_by_token_encrypted, note, max_uses, current_uses, expires_at, team_slug, disabled, created_at) VALUES(?, ?, ?, ?, ?, ?, 0, ?, ?, 0, ?)"
    ).run(
      token,
      org,
      req.session!.login,
      encrypt(req.session!.accessToken),
      note ?? null,
      max_uses,
      expires,
      team_slug ?? null,
      now
    );
    audit(org, req.session!.login, "invite_link.create", token, { hours, max_uses, note, team_slug }, req.ip);
    const joinBase = process.env.SITE_ORIGIN || process.env.PUBLIC_ORIGIN;
    return { ok: true, token, url: `${joinBase}/join/${token}`, expires_at: expires };
  });

  app.patch<{ Params: { org: string; token: string }; Body: { disabled?: boolean } }>(
    "/api/admin/:org/invite-links/:token",
    { preHandler: requireOrgRole("admin") },
    async (req, reply) => {
      const { org, token } = req.params;
      const { disabled } = req.body;
      const row = db.prepare("SELECT * FROM invite_links WHERE token = ? AND org = ?").get(token, org);
      if (!row) return reply.code(404).send({ error: "not_found" });
      db.prepare("UPDATE invite_links SET disabled = ? WHERE token = ?").run(disabled ? 1 : 0, token);
      audit(org, req.session!.login, "invite_link.toggle", token, { disabled }, req.ip);
      return { ok: true };
    }
  );

  app.delete<{ Params: { org: string; token: string } }>(
    "/api/admin/:org/invite-links/:token",
    { preHandler: requireOrgRole("admin") },
    async (req, reply) => {
      const { org, token } = req.params;
      const r = db.prepare("DELETE FROM invite_links WHERE token = ? AND org = ?").run(token, org);
      if (r.changes === 0) return reply.code(404).send({ error: "not_found" });
      audit(org, req.session!.login, "invite_link.delete", token, undefined, req.ip);
      return { ok: true };
    }
  );
}

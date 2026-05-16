import type { FastifyInstance } from "fastify";
import { audit, db } from "../lib/db.js";
import { octokitWith } from "../lib/github.js";
import { decrypt } from "../lib/crypto.js";
import { verifyTurnstile } from "../middleware/turnstile.js";
import { preflightPublicSubmission, powDifficulty } from "../middleware/pow.js";
import { turnstileEnabled, config } from "../config.js";

type Body = {
  github_login?: string; email?: string; note?: string;
  turnstile_token?: string;
  pow?: { timestamp: number; nonce: string };
  website?: string; // honeypot
};
type LinkRow = {
  token: string; org: string; created_by: string; created_by_token_encrypted: string;
  note: string | null; max_uses: number; current_uses: number; expires_at: number;
  team_slug: string | null; disabled: number; created_at: number;
};

const LOGIN_REGEX = /^[a-zA-Z0-9](?:[a-zA-Z0-9]|-(?=[a-zA-Z0-9])){0,38}$/;
const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function loadLink(token: string): LinkRow | null {
  const row = db.prepare("SELECT * FROM invite_links WHERE token = ?").get(token) as LinkRow | undefined;
  return row ?? null;
}

function linkStatus(row: LinkRow): { ok: true } | { ok: false; reason: string } {
  if (row.disabled) return { ok: false, reason: "邀请链接已被禁用" };
  if (row.expires_at < Date.now()) return { ok: false, reason: "邀请链接已过期" };
  if (row.current_uses >= row.max_uses) return { ok: false, reason: "邀请链接使用次数已用完" };
  return { ok: true };
}

export default async function joinRoutes(app: FastifyInstance) {
  app.get("/api/public/config", async () => ({
    turnstile_site_key: turnstileEnabled() ? config.turnstile.siteKey : null,
    pow_difficulty: powDifficulty(),
  }));

  app.get<{ Params: { token: string } }>("/api/join/:token", async (req, reply) => {
    const row = loadLink(req.params.token);
    if (!row) return reply.code(404).send({ error: "邀请链接不存在" });
    const s = linkStatus(row);
    return {
      org: row.org,
      note: row.note,
      team_slug: row.team_slug,
      expires_at: row.expires_at,
      remaining_uses: Math.max(0, row.max_uses - row.current_uses),
      valid: s.ok,
      reason: s.ok ? null : s.reason,
    };
  });

  app.post<{ Params: { token: string }; Body: Body }>(
    "/api/join/:token",
    { config: { rateLimit: { max: 5, timeWindow: "1 minute" } } },
    async (req, reply) => {
      const row = loadLink(req.params.token);
      if (!row) return reply.code(404).send({ error: "邀请链接不存在" });
      const s = linkStatus(row);
      if (!s.ok) return reply.code(400).send({ error: s.reason });

      const { github_login, email, note, turnstile_token } = req.body ?? {};
      const bodyForHash = `join:${req.params.token}:${(github_login ?? "").trim()}:${(email ?? "").trim()}`;
      if (!(await preflightPublicSubmission(req, reply, bodyForHash))) return;
      const login = github_login?.trim();
      const mail = email?.trim();
      const noteText = note?.trim().slice(0, 280);

      if (!login && !mail) return reply.code(400).send({ error: "需要填写 GitHub 用户名或邮箱" });
      if (login && !LOGIN_REGEX.test(login)) return reply.code(400).send({ error: "GitHub 用户名格式无效" });
      if (mail && !EMAIL_REGEX.test(mail)) return reply.code(400).send({ error: "邮箱格式无效" });

      const captchaOk = await verifyTurnstile(turnstile_token, req.ip);
      if (!captchaOk) return reply.code(400).send({ error: "人机验证失败，请刷新重试" });

      const insertStmt = db.prepare(
        "INSERT INTO invitations(org, invite_link_token, github_login, email, note, source_ip, user_agent, status, error_message, created_at) VALUES(?, ?, ?, ?, ?, ?, ?, ?, ?, ?)"
      );

      let token: string;
      try {
        token = decrypt(row.created_by_token_encrypted);
      } catch {
        insertStmt.run(row.org, row.token, login ?? null, mail ?? null, noteText ?? null, req.ip, req.headers["user-agent"] ?? null, "failed", "邀请链接的发起人 token 失效", Date.now());
        return reply.code(503).send({ error: "邀请链接的发起人 token 失效，请联系管理员重新生成链接" });
      }

      const octokit = octokitWith(token);
      try {
        let body: Record<string, unknown>;
        let teamIds: number[] | undefined;
        if (row.team_slug) {
          try {
            const t = await octokit.request("GET /orgs/{org}/teams/{team_slug}", { org: row.org, team_slug: row.team_slug });
            teamIds = [t.data.id];
          } catch {}
        }
        if (login) {
          const user = await octokit.users.getByUsername({ username: login });
          body = { invitee_id: user.data.id, role: "direct_member" };
          if (teamIds) body.team_ids = teamIds;
        } else {
          body = { email: mail, role: "direct_member" };
          if (teamIds) body.team_ids = teamIds;
        }
        const inv = await octokit.request("POST /orgs/{org}/invitations", { org: row.org, ...body });
        const r = insertStmt.run(row.org, row.token, login ?? null, mail ?? null, noteText ?? null, req.ip, req.headers["user-agent"] ?? null, "sent", null, Date.now());
        db.prepare("UPDATE invitations SET github_invitation_id = ? WHERE id = ?").run(inv.data.id, r.lastInsertRowid);
        db.prepare("UPDATE invite_links SET current_uses = current_uses + 1 WHERE token = ?").run(row.token);
        audit(row.org, `public:${row.token}`, "invite.sent", login ?? mail ?? "", { invitation_id: inv.data.id }, req.ip);
        return { ok: true, invitation_id: inv.data.id, message: "邀请已发出，请到 GitHub 邮箱或通知中心接受。" };
      } catch (e) {
        const message = (e as Error).message;
        insertStmt.run(row.org, row.token, login ?? null, mail ?? null, noteText ?? null, req.ip, req.headers["user-agent"] ?? null, "failed", message, Date.now());
        audit(row.org, `public:${row.token}`, "invite.failed", login ?? mail ?? "", { error: message }, req.ip);
        const friendly = message.includes("Already") ? "该用户已在组织中" : message.includes("422") ? "GitHub 拒绝邀请（账号不存在或邮箱已被邀请）" : "邀请失败，稍后重试";
        return reply.code(400).send({ error: friendly });
      }
    }
  );
}

import { reserveInvite, failInvite } from "../../lib/invite-reservation.js";
import type { FastifyInstance } from "fastify";

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

function loadLink(db: import("better-sqlite3").Database, token: string): LinkRow | null {
  const row = db.prepare("SELECT * FROM invite_links WHERE token = ?").get(token) as LinkRow | undefined;
  return row ?? null;
}

/** Copy for a known (quota-released) invite failure, chosen by upstream status and keywords; GitHub's text is never echoed. */
function inviteFailureCopy(cause: unknown, invitationSubmitted: boolean): string {
  const { status, message } = cause as { status?: number; message?: unknown };
  if (status === 422) return /already a (part|member) of/i.test(String(message ?? "")) ? "该用户已在组织中" : "GitHub 拒绝邀请（账号不存在或邮箱已被邀请）";
  if (status === 404 && !invitationSubmitted) return "GitHub 用户名不存在，请检查拼写";
  return "邀请失败，稍后重试";
}

function linkStatus(row: LinkRow): { ok: true } | { ok: false; reason: string } {
  if (row.disabled) return { ok: false, reason: "邀请链接已被禁用" };
  if (row.expires_at < Date.now()) return { ok: false, reason: "邀请链接已过期" };
  if (row.current_uses >= row.max_uses) return { ok: false, reason: "邀请链接使用次数已用完" };
  return { ok: true };
}

export default async function joinRoutes(app: FastifyInstance) {
  const { audit, db } = app.services.storage;
  const { octokitWith } = app.services.github;
  const { decrypt } = app.services.crypto;
  const { verifyTurnstile } = app.services.turnstile;
  const { preflightPublicSubmission, powDifficulty } = app.services.publicSubmission;
  const { config } = app.services;
  const { turnstileEnabled } = app.services.turnstile;
  app.get("/api/public/config", async () => ({
    turnstile_site_key: turnstileEnabled() ? config.turnstile.siteKey : null,
    pow_difficulty: powDifficulty(),
  }));

  app.get<{ Params: { token: string } }>("/api/join/:token", async (req, reply) => {
    const row = loadLink(db, req.params.token);
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
      const row = loadLink(db, req.params.token);
      if (!row) return reply.code(404).send({ error: "邀请链接不存在" });

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

      const attempt = reserveInvite(db, row.token, login ? `login:${login.toLowerCase()}` : `email:${mail!.toLowerCase()}`);
      if (attempt.state === "sent") return { ok: true, invitation_id: attempt.github_invitation_id, message: "邀请已发出，请查看 GitHub 通知。" };
      const octokit = octokitWith(token);
      let invitationSubmitted = false;
      let invitationConfirmed = false;
      try {
        let body: Record<string, unknown>;
        let teamIds: number[] | undefined;
        if (row.team_slug) {
          try {
            const t = await octokit.request("GET /orgs/{org}/teams/{team_slug}", { org: row.org, team_slug: row.team_slug });
            teamIds = [t.data.id];
          } catch { throw new Error("invite_team_unavailable"); }
        }
        if (login) {
          const user = await octokit.users.getByUsername({ username: login });
          body = { invitee_id: user.data.id, role: "direct_member" };
          if (teamIds) body.team_ids = teamIds;
        } else {
          body = { email: mail, role: "direct_member" };
          if (teamIds) body.team_ids = teamIds;
        }
        invitationSubmitted = true;
        const inv = await octokit.request("POST /orgs/{org}/invitations", { org: row.org, ...body });
        invitationConfirmed = true;
        db.transaction(() => {
        const r = insertStmt.run(row.org, row.token, login ?? null, mail ?? null, noteText ?? null, req.ip, req.headers["user-agent"] ?? null, "sent", null, Date.now());
        db.prepare("UPDATE invitations SET github_invitation_id = ? WHERE id = ?").run(inv.data.id, r.lastInsertRowid);
        db.prepare("UPDATE invite_attempts SET state = 'sent', github_invitation_id = ? WHERE id = ?").run(inv.data.id, attempt.id);
        audit(row.org, `public:${row.token}`, "invite.sent", login ?? mail ?? "", { invitation_id: inv.data.id }, req.ip);
        })();
        return { ok: true, invitation_id: inv.data.id, message: "邀请已发出，请到 GitHub 邮箱或通知中心接受。" };
      } catch (e) {
        const status = (e as { status?: number }).status;
        const knownFailure = !invitationConfirmed && (!invitationSubmitted || Boolean(status && status >= 400 && status < 500));
        failInvite(db, attempt.id, row.token, knownFailure);
        const message = knownFailure ? "邀请未发送" : "邀请结果待管理员核对";
        insertStmt.run(row.org, row.token, login ?? null, mail ?? null, noteText ?? null, req.ip, req.headers["user-agent"] ?? null, knownFailure ? "failed" : "pending_admin", message, Date.now());
        audit(row.org, `public:${row.token}`, "invite.failed", login ?? mail ?? "", { error: message }, req.ip);
        return reply.code(knownFailure ? 400 : 503).send({ error: knownFailure ? inviteFailureCopy(e, invitationSubmitted) : "邀请结果待核对，请勿重复提交并联系管理员" });
      }
    }
  );
}

import type { FastifyInstance } from "fastify";
import { audit, db } from "../lib/db.js";
import { ORG, octokitService } from "../lib/github.js";
import { verifyTurnstile } from "../middleware/turnstile.js";
import { turnstileEnabled, config } from "../config.js";

type Body = { github_login?: string; email?: string; note?: string; turnstile_token?: string };

const LOGIN_REGEX = /^[a-zA-Z0-9](?:[a-zA-Z0-9]|-(?=[a-zA-Z0-9])){0,38}$/;
const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export default async function publicRoutes(app: FastifyInstance) {
  app.get("/api/config", async () => ({
    org: ORG,
    turnstile_site_key: turnstileEnabled() ? config.turnstile.siteKey : null,
  }));

  app.post<{ Body: Body }>("/api/invite", {
    config: { rateLimit: { max: 5, timeWindow: "1 minute" } },
  }, async (req, reply) => {
    const { github_login, email, note, turnstile_token } = req.body ?? {};
    const login = github_login?.trim();
    const mail = email?.trim();
    const noteText = note?.trim().slice(0, 280);

    if (!login && !mail) {
      return reply.code(400).send({ error: "需要填写 GitHub 用户名或邮箱" });
    }
    if (login && !LOGIN_REGEX.test(login)) {
      return reply.code(400).send({ error: "GitHub 用户名格式无效" });
    }
    if (mail && !EMAIL_REGEX.test(mail)) {
      return reply.code(400).send({ error: "邮箱格式无效" });
    }

    const captchaOk = await verifyTurnstile(turnstile_token, req.ip);
    if (!captchaOk) {
      return reply.code(400).send({ error: "人机验证失败，请刷新重试" });
    }

    const stmt = db.prepare(
      "INSERT INTO invitations(github_login, email, note, source_ip, user_agent, turnstile_passed, status, created_at) VALUES(?, ?, ?, ?, ?, ?, ?, ?)"
    );

    let octokit;
    try {
      octokit = octokitService();
    } catch {
      const row = stmt.run(login ?? null, mail ?? null, noteText ?? null, req.ip, req.headers["user-agent"] ?? null, captchaOk ? 1 : 0, "pending_admin", Date.now());
      audit("public", "invite.deferred", login ?? mail, { reason: "service_token_missing" }, req.ip);
      return reply.code(202).send({ ok: false, deferred: true, message: "申请已记录，管理员上线后将处理。", id: row.lastInsertRowid });
    }

    try {
      let body: Record<string, unknown>;
      if (login) {
        const user = await octokit.users.getByUsername({ username: login });
        body = { invitee_id: user.data.id, role: "direct_member" };
      } else {
        body = { email: mail, role: "direct_member" };
      }
      const inv = await octokit.request("POST /orgs/{org}/invitations", { org: ORG, ...body });
      const row = stmt.run(login ?? null, mail ?? null, noteText ?? null, req.ip, req.headers["user-agent"] ?? null, captchaOk ? 1 : 0, "sent", Date.now());
      db.prepare("UPDATE invitations SET github_invitation_id = ? WHERE id = ?").run(inv.data.id, row.lastInsertRowid);
      audit("public", "invite.sent", login ?? mail, { invitation_id: inv.data.id }, req.ip);
      return { ok: true, invitation_id: inv.data.id, message: "邀请已发出，请到 GitHub 邮箱或通知中心接受。" };
    } catch (e) {
      const message = (e as Error).message;
      stmt.run(login ?? null, mail ?? null, noteText ?? null, req.ip, req.headers["user-agent"] ?? null, captchaOk ? 1 : 0, "failed", Date.now());
      audit("public", "invite.failed", login ?? mail, { error: message }, req.ip);
      const friendly = message.includes("Already") ? "该用户已在组织中" : message.includes("422") ? "GitHub 拒绝邀请（账号不存在或邮箱已被邀请）" : "邀请失败，稍后重试";
      return reply.code(400).send({ error: friendly });
    }
  });
}

import { randomBytes } from "node:crypto";
import type { FastifyInstance } from "fastify";
import bcrypt from "bcryptjs";
import { config } from "../../config.js";
import { forumDb } from "../../lib/forum-db.js";
import { createForumSession, destroyForumSession, selfForumUser } from "../../lib/forum-auth.js";
import { setForumCookieOnReply } from "../../lib/forum-github.js";
import { attachForumUser, requireForumAuth } from "../../middleware/require-forum-auth.js";

function isValidUsername(s: string): boolean {
  return /^[a-zA-Z0-9_一-龥\-]{2,32}$/.test(s);
}

function setForumCookie(reply: any, sid: string) {
  setForumCookieOnReply(reply, sid);
}

export default async function forumAuthRoutes(app: FastifyInstance) {
  app.get("/api/forum/me", async (req) => {
    await attachForumUser(req);
    if (!req.forumUser) return { signed_in: false };
    return { signed_in: true, user: selfForumUser(req.forumUser) };
  });

  app.post<{ Body: { username: string; password: string } }>(
    "/api/forum/auth/login",
    async (req, reply) => {
      const { username, password } = req.body ?? ({} as any);
      if (!username || !password) return reply.code(400).send({ error: "missing_fields" });
      const user = forumDb
        .prepare("SELECT * FROM forum_users WHERE lower(username) = lower(?) OR lower(email) = lower(?)")
        .get(username, username) as any;
      if (!user || !user.password_bcrypt) {
        return reply.code(401).send({ error: "invalid_credentials" });
      }
      const ok = await bcrypt.compare(password, user.password_bcrypt);
      if (!ok) return reply.code(401).send({ error: "invalid_credentials" });
      const sid = createForumSession(user.id, "password");
      setForumCookie(reply, sid);
      return { ok: true, user: selfForumUser(user) };
    },
  );

  app.post<{ Body: { username: string; password: string; email?: string; display_name?: string } }>(
    "/api/forum/auth/register",
    async (req, reply) => {
      const { username, password, email, display_name } = req.body ?? ({} as any);
      if (!username || !password) return reply.code(400).send({ error: "missing_fields" });
      if (!isValidUsername(username)) return reply.code(400).send({ error: "invalid_username" });
      if (password.length < 6) return reply.code(400).send({ error: "password_too_short" });
      const existing = forumDb
        .prepare("SELECT id FROM forum_users WHERE lower(username) = lower(?)")
        .get(username);
      if (existing) return reply.code(409).send({ error: "username_taken" });
      const hash = await bcrypt.hash(password, 10);
      const now = Date.now();
      const r = forumDb
        .prepare(
          `INSERT INTO forum_users (username, display_name, password_bcrypt, email, role, created_at, updated_at)
           VALUES (?, ?, ?, ?, 'member', ?, ?)`,
        )
        .run(username, display_name ?? username, hash, email ?? null, now, now);
      const sid = createForumSession(Number(r.lastInsertRowid), "password");
      setForumCookie(reply, sid);
      const fresh = forumDb.prepare("SELECT * FROM forum_users WHERE id = ?").get(r.lastInsertRowid) as any;
      return { ok: true, user: selfForumUser(fresh) };
    },
  );

  app.post("/api/forum/auth/logout", async (req, reply) => {
    const sid = req.cookies?.forum_sid;
    if (sid) destroyForumSession(sid);
    const adminSid = req.cookies?.sid;
    if (adminSid) {
      const { destroySession } = await import("../../lib/auth.js");
      destroySession(adminSid);
    }
    reply.clearCookie("forum_sid", { path: "/", domain: config.cookieDomain });
    reply.clearCookie("sid", { path: "/", domain: config.cookieDomain });
    return { ok: true };
  });

  app.get<{ Querystring: { bind?: "1"; return_to?: string } }>(
    "/auth/forum/github",
    async (req, reply) => {
      const state = `forum-${randomBytes(16).toString("base64url")}`;
      const bindMode = req.query.bind === "1";
      const returnTo = req.query.return_to ?? "/";
      const payload = `${state}|${bindMode ? "bind" : "login"}|${encodeURIComponent(returnTo)}`;
      if (bindMode) {
        await attachForumUser(req);
        if (!req.forumUser) return reply.code(401).send({ error: "not_signed_in" });
      }
      reply.setCookie("forum_oauth_state", payload, {
        httpOnly: true, secure: true, sameSite: "lax", path: "/auth", maxAge: 600,
        domain: config.cookieDomain,
      });
      const u = new URL("https://github.com/login/oauth/authorize");
      u.searchParams.set("client_id", config.oauth.clientId);
      u.searchParams.set("redirect_uri", `${config.publicOrigin}/auth/callback`);
      u.searchParams.set("scope", "read:user user:email");
      u.searchParams.set("state", state);
      return reply.redirect(u.toString());
    },
  );

  app.post<{ Body: { password: string } }>(
    "/api/forum/auth/set-password",
    { preHandler: requireForumAuth },
    async (req, reply) => {
      const { password } = req.body ?? ({} as any);
      if (!password || password.length < 6) return reply.code(400).send({ error: "password_too_short" });
      const hash = await bcrypt.hash(password, 10);
      forumDb
        .prepare("UPDATE forum_users SET password_bcrypt = ?, updated_at = ? WHERE id = ?")
        .run(hash, Date.now(), req.forumUser!.id);
      return { ok: true };
    },
  );

  app.get("/api/forum/auth/providers", async () => ({
    github: true,
    password: true,
  }));

  app.delete("/api/forum/auth/github", { preHandler: requireForumAuth }, async (req, reply) => {
    if (!req.forumUser!.password_bcrypt) {
      return reply.code(400).send({ error: "set_password_first" });
    }
    forumDb
      .prepare("UPDATE forum_users SET github_id = NULL, github_login = NULL, updated_at = ? WHERE id = ?")
      .run(Date.now(), req.forumUser!.id);
    return { ok: true };
  });
}

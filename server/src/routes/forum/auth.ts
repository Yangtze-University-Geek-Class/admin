import { randomBytes } from "node:crypto";
import type { FastifyInstance } from "fastify";
import bcrypt from "bcryptjs";
import { request as undiciRequest } from "undici";
import { config } from "../../config.js";
import { forumDb } from "../../lib/forum-db.js";
import { createForumSession, destroyForumSession, publicForumUser, selfForumUser } from "../../lib/forum-auth.js";
import { attachForumUser, requireForumAuth } from "../../middleware/require-forum-auth.js";

const COOKIE_OPTS = {
  httpOnly: true,
  secure: true,
  sameSite: "lax" as const,
  path: "/",
  maxAge: 14 * 24 * 60 * 60,
};

function setForumCookie(reply: any, sid: string) {
  reply.setCookie("forum_sid", sid, COOKIE_OPTS);
}

function isValidUsername(s: string): boolean {
  return /^[a-zA-Z0-9_一-龥\-]{2,32}$/.test(s);
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
    reply.clearCookie("forum_sid", { path: "/" });
    return { ok: true };
  });

  app.get<{ Querystring: { bind?: "1"; return_to?: string } }>(
    "/auth/forum/github",
    async (req, reply) => {
      const state = randomBytes(16).toString("base64url");
      const bindMode = req.query.bind === "1";
      const returnTo = req.query.return_to ?? "/forum";
      const payload = `${state}|${bindMode ? "bind" : "login"}|${encodeURIComponent(returnTo)}`;
      if (bindMode) {
        await attachForumUser(req);
        if (!req.forumUser) return reply.code(401).send({ error: "not_signed_in" });
      }
      reply.setCookie("forum_oauth_state", payload, {
        httpOnly: true, secure: true, sameSite: "lax", path: "/auth", maxAge: 600,
      });
      const u = new URL("https://github.com/login/oauth/authorize");
      u.searchParams.set("client_id", config.oauth.clientId);
      u.searchParams.set("redirect_uri", `${config.publicOrigin}/auth/forum/callback`);
      u.searchParams.set("scope", "read:user user:email");
      u.searchParams.set("state", state);
      return reply.redirect(u.toString());
    },
  );

  app.get<{ Querystring: { code?: string; state?: string; error?: string } }>(
    "/auth/forum/callback",
    async (req, reply) => {
      const { code, state, error } = req.query;
      if (error) return reply.code(400).send({ error });
      const cookieRaw = req.cookies?.forum_oauth_state ?? "";
      const [cookieState, mode, returnToEnc] = cookieRaw.split("|");
      if (!code || !state || state !== cookieState) {
        return reply.code(400).send({ error: "invalid_state" });
      }
      const returnTo = decodeURIComponent(returnToEnc ?? "/forum");
      reply.clearCookie("forum_oauth_state", { path: "/auth" });

      const tokenRes = await undiciRequest("https://github.com/login/oauth/access_token", {
        method: "POST",
        headers: { Accept: "application/json", "Content-Type": "application/json" },
        body: JSON.stringify({
          client_id: config.oauth.clientId,
          client_secret: config.oauth.clientSecret,
          code,
          redirect_uri: `${config.publicOrigin}/auth/forum/callback`,
        }),
      });
      const tokenBody = (await tokenRes.body.json()) as any;
      const accessToken = tokenBody.access_token as string | undefined;
      if (!accessToken) return reply.code(400).send({ error: "token_exchange_failed" });

      const userRes = await undiciRequest("https://api.github.com/user", {
        headers: {
          Authorization: `Bearer ${accessToken}`,
          "User-Agent": "yzgc-forum",
          Accept: "application/vnd.github+json",
        },
      });
      const gh = (await userRes.body.json()) as { id: number; login: string; avatar_url: string; email: string | null; name: string | null };
      if (!gh.id || !gh.login) return reply.code(400).send({ error: "fetch_user_failed" });

      const now = Date.now();

      if (mode === "bind") {
        await attachForumUser(req);
        if (!req.forumUser) return reply.code(401).send({ error: "not_signed_in" });
        const occupied = forumDb
          .prepare("SELECT id FROM forum_users WHERE github_id = ? AND id != ?")
          .get(gh.id, req.forumUser.id);
        if (occupied) return reply.code(409).send({ error: "github_already_bound_other" });
        forumDb
          .prepare("UPDATE forum_users SET github_id = ?, github_login = ?, avatar_url = COALESCE(avatar_url, ?), updated_at = ? WHERE id = ?")
          .run(gh.id, gh.login, gh.avatar_url, now, req.forumUser.id);
        return reply.redirect(returnTo);
      }

      const existing = forumDb.prepare("SELECT * FROM forum_users WHERE github_id = ?").get(gh.id) as any;
      let userId: number;
      if (existing) {
        userId = existing.id;
        forumDb
          .prepare("UPDATE forum_users SET github_login = ?, avatar_url = COALESCE(avatar_url, ?), updated_at = ? WHERE id = ?")
          .run(gh.login, gh.avatar_url, now, userId);
      } else {
        let username = gh.login;
        let n = 1;
        while (forumDb.prepare("SELECT 1 FROM forum_users WHERE lower(username) = lower(?)").get(username)) {
          username = `${gh.login}-${++n}`;
        }
        const r = forumDb
          .prepare(
            `INSERT INTO forum_users (username, display_name, github_id, github_login, email, avatar_url, role, created_at, updated_at)
             VALUES (?, ?, ?, ?, ?, ?, 'member', ?, ?)`,
          )
          .run(username, gh.name ?? gh.login, gh.id, gh.login, gh.email, gh.avatar_url, now, now);
        userId = Number(r.lastInsertRowid);
      }
      const sid = createForumSession(userId, "github");
      setForumCookie(reply, sid);
      return reply.redirect(returnTo);
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

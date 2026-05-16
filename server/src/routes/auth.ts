import { randomBytes } from "node:crypto";
import type { FastifyInstance } from "fastify";
import { config } from "../config.js";
import {
  buildAuthorizeUrl,
  createSession,
  destroySession,
  exchangeCode,
  fetchAuthenticatedLogin,
} from "../lib/auth.js";
import { storeServiceToken } from "../lib/github.js";
import { audit } from "../lib/db.js";

export default async function authRoutes(app: FastifyInstance) {
  app.get("/auth/github", async (req, reply) => {
    const state = randomBytes(16).toString("base64url");
    reply.setCookie("oauth_state", state, {
      httpOnly: true, secure: true, sameSite: "lax", path: "/auth", maxAge: 600,
    });
    return reply.redirect(buildAuthorizeUrl(state));
  });

  app.get<{ Querystring: { code?: string; state?: string; error?: string } }>(
    "/auth/callback",
    async (req, reply) => {
      const { code, state, error } = req.query;
      if (error) return reply.code(400).send({ error });
      const cookieState = req.cookies?.oauth_state;
      if (!code || !state || state !== cookieState) {
        return reply.code(400).send({ error: "invalid_state" });
      }
      reply.clearCookie("oauth_state", { path: "/auth" });
      const token = await exchangeCode(code);
      const login = await fetchAuthenticatedLogin(token);
      if (login !== config.adminLogin) {
        return reply.code(403).send({ error: "forbidden", login });
      }
      const sid = createSession(login, token);
      storeServiceToken(token);
      audit(login, "auth.signin", login, undefined, req.ip);
      reply.setCookie("sid", sid, {
        httpOnly: true, secure: true, sameSite: "lax", path: "/", maxAge: 7 * 24 * 60 * 60,
      });
      return reply.redirect("/admin");
    }
  );

  app.post("/auth/signout", async (req, reply) => {
    const sid = req.cookies?.sid;
    if (sid) {
      destroySession(sid);
      audit(req.session?.login ?? "unknown", "auth.signout", undefined, undefined, req.ip);
    }
    reply.clearCookie("sid", { path: "/" });
    return { ok: true };
  });

  app.get("/auth/me", async (req) => {
    const sid = req.cookies?.sid;
    if (!sid) return { signed_in: false };
    const s = (await import("../lib/auth.js")).getSession(sid);
    if (!s) return { signed_in: false };
    return { signed_in: true, login: s.login, is_admin: s.login === config.adminLogin };
  });
}

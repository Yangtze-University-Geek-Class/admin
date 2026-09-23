import { safeReturnTo } from "../../lib/safe-return.js";
import { randomBytes } from "node:crypto";
import type { FastifyInstance } from "fastify";
import { readOAuthState, setOAuthState } from "../../middleware/oauth-state.js";

export default async function authRoutes(app: FastifyInstance) {
  const { buildAuthorizeUrl,
  createSession,
  destroySession,
  exchangeCode,
  fetchAuthenticatedUser,
  getSession, } = app.services.auth;
  const { audit } = app.services.storage;
  const { config } = app.services;
  app.get("/auth/github", async (req, reply) => {
    const state = randomBytes(16).toString("base64url");
    const returnTo = safeReturnTo((req.query as { return_to?: string }).return_to, config, `${config.publicOrigin}/console`);
    setOAuthState(reply, config, "oauth_state", { state, kind: "admin", returnTo });
    return reply.redirect(buildAuthorizeUrl(state));
  });

  app.get<{ Querystring: { code?: string; state?: string; error?: string } }>(
    "/auth/callback",
    async (req, reply) => {
      const { code, state, error } = req.query;
      if (error) return reply.code(400).send({ error });
      if (!code || !state) return reply.code(400).send({ error: "missing_params" });
      if (state.startsWith("forum-")) return reply.code(410).send({ error: "legacy_forum_retired" });
      const flow = readOAuthState(req, reply, "oauth_state", state);
      if (!flow) {
        return reply.code(400).send({ error: "invalid_state" });
      }
      const returnTo = flow.returnTo;
      const token = await exchangeCode(code);
      const user = await fetchAuthenticatedUser(token);
      const sid = createSession(user.login, user.id, user.avatar_url, token);
      audit(null, user.login, "auth.signin", user.login, undefined, req.ip);
      reply.setCookie("sid", sid, {
        httpOnly: true, secure: config.cookieSecure, sameSite: "lax", path: "/", maxAge: 7 * 24 * 60 * 60,
        domain: config.cookieDomain,
      });
      return reply.redirect(safeReturnTo(returnTo, config, `${config.publicOrigin}/console`));
    }
  );

  app.post("/auth/signout", async (req, reply) => {
    const sid = req.cookies?.sid;
    if (sid) {
      const s = getSession(sid);
      destroySession(sid);
      if (s) audit(null, s.login, "auth.signout", undefined, undefined, req.ip);
    }
    reply.clearCookie("sid", { path: "/", domain: config.cookieDomain });
    reply.clearCookie("forum_sid", { path: "/", domain: config.cookieDomain });
    return { ok: true };
  });

  app.get("/auth/me", async (req) => {
    const sid = req.cookies?.sid;
    if (!sid) return { signed_in: false };
    const s = getSession(sid);
    if (!s) return { signed_in: false };
    return { signed_in: true, login: s.login, user_id: s.user_id, avatar_url: s.avatar_url };
  });
}

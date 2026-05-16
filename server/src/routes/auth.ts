import { randomBytes } from "node:crypto";
import type { FastifyInstance } from "fastify";
import {
  buildAuthorizeUrl,
  createSession,
  destroySession,
  exchangeCode,
  fetchAuthenticatedUser,
  getSession,
} from "../lib/auth.js";
import { audit } from "../lib/db.js";
import { config } from "../config.js";
import { handleForumGithubCallback, issueForumSessionForGithub } from "../lib/forum-github.js";

function externalize(returnTo: string): string {
  if (/^https?:\/\//.test(returnTo)) return returnTo;
  if (config.siteOrigin && config.siteOrigin !== config.publicOrigin) {
    return `${config.siteOrigin}${returnTo.startsWith("/") ? returnTo : "/" + returnTo}`;
  }
  return returnTo;
}

export default async function authRoutes(app: FastifyInstance) {
  app.get("/auth/github", async (req, reply) => {
    const state = randomBytes(16).toString("base64url");
    const returnTo = (req.query as { return_to?: string }).return_to ?? "/admin";
    reply.setCookie("oauth_state", `${state}|${encodeURIComponent(returnTo)}`, {
      httpOnly: true, secure: true, sameSite: "lax", path: "/auth", maxAge: 600,
      domain: (await import("../config.js")).config.cookieDomain,
    });
    return reply.redirect(buildAuthorizeUrl(state));
  });

  app.get<{ Querystring: { code?: string; state?: string; error?: string } }>(
    "/auth/callback",
    async (req, reply) => {
      const { code, state, error } = req.query;
      if (error) return reply.code(400).send({ error });
      if (!code || !state) return reply.code(400).send({ error: "missing_params" });
      if (state.startsWith("forum-")) {
        return handleForumGithubCallback(req, reply, code, state);
      }
      const cookieRaw = req.cookies?.oauth_state ?? "";
      const [cookieState, returnToEnc] = cookieRaw.split("|");
      if (state !== cookieState) {
        return reply.code(400).send({ error: "invalid_state" });
      }
      const returnTo = decodeURIComponent(returnToEnc ?? "/admin");
      reply.clearCookie("oauth_state", { path: "/auth", domain: config.cookieDomain });
      const token = await exchangeCode(code);
      const user = await fetchAuthenticatedUser(token);
      const sid = createSession(user.login, user.id, user.avatar_url, token);
      audit(null, user.login, "auth.signin", user.login, undefined, req.ip);
      reply.setCookie("sid", sid, {
        httpOnly: true, secure: true, sameSite: "lax", path: "/", maxAge: 7 * 24 * 60 * 60,
        domain: config.cookieDomain,
      });
      issueForumSessionForGithub(reply, user);
      return reply.redirect(externalize(returnTo));
    }
  );

  app.post("/auth/signout", async (req, reply) => {
    const sid = req.cookies?.sid;
    if (sid) {
      const s = getSession(sid);
      destroySession(sid);
      if (s) audit(null, s.login, "auth.signout", undefined, undefined, req.ip);
    }
    const forumSid = req.cookies?.forum_sid;
    if (forumSid) {
      const { destroyForumSession } = await import("../lib/forum-auth.js");
      destroyForumSession(forumSid);
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

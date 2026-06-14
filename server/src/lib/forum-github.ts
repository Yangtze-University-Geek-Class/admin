import type { FastifyReply, FastifyRequest } from "fastify";
import { request as undiciRequest } from "undici";
import { config } from "../config.js";
import { forumDb } from "./forum-db.js";
import { createForumSession } from "./forum-auth.js";
import { syncRoleToGroup } from "./forum-permissions.js";
import { attachForumUser } from "../middleware/require-forum-auth.js";

export type GithubUserBasic = {
  id: number;
  login: string;
  avatar_url: string;
  email: string | null;
  name: string | null;
};

export function upsertForumUserFromGithub(gh: GithubUserBasic): number {
  const now = Date.now();
  const existing = forumDb.prepare("SELECT id FROM forum_users WHERE github_id = ?").get(gh.id) as any;
  if (existing) {
    forumDb
      .prepare(
        "UPDATE forum_users SET github_login = ?, avatar_url = COALESCE(avatar_url, ?), updated_at = ? WHERE id = ?",
      )
      .run(gh.login, gh.avatar_url, now, existing.id);
    return existing.id;
  }
  let username = gh.login.replace(/[^a-zA-Z0-9_\-]/g, "").slice(0, 32) || `gh${gh.id}`;
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
  const newId = Number(r.lastInsertRowid);
  syncRoleToGroup(newId, "member");
  return newId;
}

export function setForumCookieOnReply(reply: FastifyReply, sid: string) {
  reply.setCookie("forum_sid", sid, {
    httpOnly: true,
    secure: true,
    sameSite: "lax",
    path: "/",
    maxAge: 14 * 24 * 60 * 60,
    domain: config.cookieDomain,
  });
}

export function issueForumSessionForGithub(reply: FastifyReply, gh: GithubUserBasic): number {
  const userId = upsertForumUserFromGithub(gh);
  const sid = createForumSession(userId, "github");
  setForumCookieOnReply(reply, sid);
  return userId;
}

function externalizeForumReturn(returnTo: string): string {
  if (/^https?:\/\//.test(returnTo)) return returnTo;
  if (config.siteOrigin && config.siteOrigin !== config.publicOrigin) {
    return `${config.siteOrigin}${returnTo.startsWith("/") ? returnTo : "/" + returnTo}`;
  }
  return returnTo;
}

export async function handleForumGithubCallback(req: FastifyRequest, reply: FastifyReply, code: string, state: string) {
  const cookieRaw = req.cookies?.forum_oauth_state ?? "";
  const [cookieState, mode, returnToEnc] = cookieRaw.split("|");
  if (state !== cookieState) return reply.code(400).send({ error: "invalid_state" });
  const returnTo = decodeURIComponent(returnToEnc ?? "/");
  reply.clearCookie("forum_oauth_state", { path: "/auth" });

  const tokenRes = await undiciRequest("https://github.com/login/oauth/access_token", {
    method: "POST",
    headers: { Accept: "application/json", "Content-Type": "application/json" },
    body: JSON.stringify({
      client_id: config.oauth.clientId,
      client_secret: config.oauth.clientSecret,
      code,
      redirect_uri: `${config.publicOrigin}/auth/callback`,
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
  const gh = (await userRes.body.json()) as GithubUserBasic;
  if (!gh.id || !gh.login) return reply.code(400).send({ error: "fetch_user_failed" });

  if (mode === "bind") {
    await attachForumUser(req);
    if (!req.forumUser) return reply.code(401).send({ error: "not_signed_in" });
    const occupied = forumDb
      .prepare("SELECT id FROM forum_users WHERE github_id = ? AND id != ?")
      .get(gh.id, req.forumUser.id);
    if (occupied) return reply.code(409).send({ error: "github_already_bound_other" });
    forumDb
      .prepare("UPDATE forum_users SET github_id = ?, github_login = ?, avatar_url = COALESCE(avatar_url, ?), updated_at = ? WHERE id = ?")
      .run(gh.id, gh.login, gh.avatar_url, Date.now(), req.forumUser.id);
    return reply.redirect(externalizeForumReturn(returnTo));
  }

  issueForumSessionForGithub(reply, gh);
  return reply.redirect(externalizeForumReturn(returnTo));
}

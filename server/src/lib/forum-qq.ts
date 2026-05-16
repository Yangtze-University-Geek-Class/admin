import type { FastifyReply, FastifyRequest } from "fastify";
import { request as undiciRequest } from "undici";
import { config } from "../config.js";
import { forumDb } from "./forum-db.js";
import { createForumSession } from "./forum-auth.js";
import { setForumCookieOnReply } from "./forum-github.js";
import { attachForumUser } from "../middleware/require-forum-auth.js";

type QqUserInfo = {
  openid: string;
  nickname: string;
  figureurl_qq_2?: string;
  figureurl_qq_1?: string;
};

function externalizeForumReturn(returnTo: string): string {
  if (/^https?:\/\//.test(returnTo)) return returnTo;
  if (config.siteOrigin && config.siteOrigin !== config.publicOrigin) {
    return `${config.siteOrigin}${returnTo.startsWith("/") ? returnTo : "/" + returnTo}`;
  }
  return returnTo;
}

async function exchangeQqCode(code: string, redirectUri: string): Promise<string> {
  const u = new URL("https://graph.qq.com/oauth2.0/token");
  u.searchParams.set("grant_type", "authorization_code");
  u.searchParams.set("client_id", config.qq.appId);
  u.searchParams.set("client_secret", config.qq.appKey);
  u.searchParams.set("code", code);
  u.searchParams.set("redirect_uri", redirectUri);
  u.searchParams.set("fmt", "json");
  const r = await undiciRequest(u.toString());
  const body = (await r.body.json()) as any;
  if (body.error) throw new Error(`qq_token_failed: ${body.error_description ?? body.error}`);
  return body.access_token;
}

async function fetchQqOpenid(accessToken: string): Promise<string> {
  const u = new URL("https://graph.qq.com/oauth2.0/me");
  u.searchParams.set("access_token", accessToken);
  u.searchParams.set("fmt", "json");
  const r = await undiciRequest(u.toString());
  const body = (await r.body.json()) as any;
  if (!body.openid) throw new Error(`qq_openid_failed: ${JSON.stringify(body)}`);
  return body.openid;
}

async function fetchQqUserInfo(accessToken: string, openid: string): Promise<QqUserInfo> {
  const u = new URL("https://graph.qq.com/user/get_user_info");
  u.searchParams.set("access_token", accessToken);
  u.searchParams.set("oauth_consumer_key", config.qq.appId);
  u.searchParams.set("openid", openid);
  const r = await undiciRequest(u.toString());
  const body = (await r.body.json()) as any;
  if (body.ret && body.ret !== 0) throw new Error(`qq_userinfo_failed: ${body.msg ?? "unknown"}`);
  return { openid, nickname: body.nickname ?? `QQ用户${openid.slice(-6)}`, figureurl_qq_2: body.figureurl_qq_2, figureurl_qq_1: body.figureurl_qq_1 };
}

function upsertForumUserFromQq(info: QqUserInfo): number {
  const now = Date.now();
  const existing = forumDb.prepare("SELECT id FROM forum_users WHERE qq_openid = ?").get(info.openid) as any;
  if (existing) {
    forumDb
      .prepare("UPDATE forum_users SET avatar_url = COALESCE(avatar_url, ?), updated_at = ? WHERE id = ?")
      .run(info.figureurl_qq_2 ?? info.figureurl_qq_1 ?? null, now, existing.id);
    return existing.id;
  }
  let username = `qq-${info.openid.slice(0, 12)}`;
  let n = 1;
  while (forumDb.prepare("SELECT 1 FROM forum_users WHERE lower(username) = lower(?)").get(username)) {
    username = `qq-${info.openid.slice(0, 12)}-${++n}`;
  }
  const r = forumDb
    .prepare(
      `INSERT INTO forum_users (username, display_name, qq_openid, avatar_url, role, created_at, updated_at)
       VALUES (?, ?, ?, ?, 'member', ?, ?)`,
    )
    .run(username, info.nickname, info.openid, info.figureurl_qq_2 ?? info.figureurl_qq_1 ?? null, now, now);
  return Number(r.lastInsertRowid);
}

export async function handleForumQqCallback(req: FastifyRequest, reply: FastifyReply, code: string, state: string) {
  const cookieRaw = req.cookies?.forum_qq_state ?? "";
  const [cookieState, mode, returnToEnc] = cookieRaw.split("|");
  if (state !== cookieState) return reply.code(400).send({ error: "invalid_state" });
  const returnTo = decodeURIComponent(returnToEnc ?? "/");
  reply.clearCookie("forum_qq_state", { path: "/auth" });

  const redirectUri = `${config.publicOrigin}/auth/callback`;
  const accessToken = await exchangeQqCode(code, redirectUri);
  const openid = await fetchQqOpenid(accessToken);
  const info = await fetchQqUserInfo(accessToken, openid);

  if (mode === "bind") {
    await attachForumUser(req);
    if (!req.forumUser) return reply.code(401).send({ error: "not_signed_in" });
    const occupied = forumDb
      .prepare("SELECT id FROM forum_users WHERE qq_openid = ? AND id != ?")
      .get(openid, req.forumUser.id);
    if (occupied) return reply.code(409).send({ error: "qq_already_bound_other" });
    forumDb
      .prepare("UPDATE forum_users SET qq_openid = ?, avatar_url = COALESCE(avatar_url, ?), updated_at = ? WHERE id = ?")
      .run(openid, info.figureurl_qq_2 ?? null, Date.now(), req.forumUser.id);
    return reply.redirect(externalizeForumReturn(returnTo));
  }

  const userId = upsertForumUserFromQq(info);
  const sid = createForumSession(userId, "github");
  setForumCookieOnReply(reply, sid);
  return reply.redirect(externalizeForumReturn(returnTo));
}

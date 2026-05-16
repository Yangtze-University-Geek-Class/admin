import { randomBytes } from "node:crypto";
import { request as undiciRequest } from "undici";
import { config } from "../config.js";
import { db } from "./db.js";
import { decrypt, encrypt } from "./crypto.js";

const SESSION_TTL_MS = 7 * 24 * 60 * 60 * 1000;

export type Session = {
  id: string;
  login: string;
  user_id: number | null;
  avatar_url: string | null;
  accessToken: string;
  expires_at: number;
};

export function createSession(
  login: string,
  userId: number | null,
  avatarUrl: string | null,
  accessToken: string
): string {
  const id = randomBytes(24).toString("base64url");
  const now = Date.now();
  db.prepare(
    "INSERT INTO sessions(id, login, user_id, avatar_url, access_token_encrypted, created_at, expires_at) VALUES(?, ?, ?, ?, ?, ?, ?)"
  ).run(id, login, userId, avatarUrl, encrypt(accessToken), now, now + SESSION_TTL_MS);
  return id;
}

export function getSession(id: string): Session | null {
  const row = db.prepare("SELECT * FROM sessions WHERE id = ?").get(id) as any;
  if (!row) return null;
  if (row.expires_at < Date.now()) {
    db.prepare("DELETE FROM sessions WHERE id = ?").run(id);
    return null;
  }
  try {
    return {
      id: row.id,
      login: row.login,
      user_id: row.user_id,
      avatar_url: row.avatar_url,
      accessToken: decrypt(row.access_token_encrypted),
      expires_at: row.expires_at,
    };
  } catch {
    return null;
  }
}

export function destroySession(id: string) {
  db.prepare("DELETE FROM sessions WHERE id = ?").run(id);
}

export function buildAuthorizeUrl(state: string): string {
  const u = new URL("https://github.com/login/oauth/authorize");
  u.searchParams.set("client_id", config.oauth.clientId);
  u.searchParams.set("redirect_uri", `${config.publicOrigin}/auth/callback`);
  u.searchParams.set("scope", config.oauth.scope);
  u.searchParams.set("state", state);
  return u.toString();
}

export async function exchangeCode(code: string): Promise<string> {
  const res = await undiciRequest("https://github.com/login/oauth/access_token", {
    method: "POST",
    headers: { Accept: "application/json", "Content-Type": "application/json" },
    body: JSON.stringify({
      client_id: config.oauth.clientId,
      client_secret: config.oauth.clientSecret,
      code,
      redirect_uri: `${config.publicOrigin}/auth/callback`,
    }),
  });
  const body = (await res.body.json()) as { access_token?: string; error?: string; error_description?: string };
  if (!body.access_token) {
    throw new Error(`oauth exchange failed: ${body.error_description ?? body.error ?? "unknown"}`);
  }
  return body.access_token;
}

export async function fetchAuthenticatedUser(accessToken: string): Promise<{ login: string; id: number; avatar_url: string; email: string | null; name: string | null }> {
  const res = await undiciRequest("https://api.github.com/user", {
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "User-Agent": "yzgc-admin",
      Accept: "application/vnd.github+json",
    },
  });
  const body = (await res.body.json()) as { login?: string; id?: number; avatar_url?: string; email?: string | null; name?: string | null };
  if (!body.login || !body.id) throw new Error("failed to fetch user");
  return { login: body.login, id: body.id, avatar_url: body.avatar_url ?? "", email: body.email ?? null, name: body.name ?? null };
}

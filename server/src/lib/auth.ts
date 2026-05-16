import { randomBytes } from "node:crypto";
import { request as undiciRequest } from "undici";
import { config } from "../config.js";
import { db } from "./db.js";

const SESSION_TTL_MS = 7 * 24 * 60 * 60 * 1000;

export function createSession(login: string, accessToken: string): string {
  const id = randomBytes(24).toString("base64url");
  const now = Date.now();
  db.prepare(
    "INSERT INTO sessions(id, login, access_token, created_at, expires_at) VALUES(?, ?, ?, ?, ?)"
  ).run(id, login, accessToken, now, now + SESSION_TTL_MS);
  return id;
}

export type Session = { id: string; login: string; access_token: string; expires_at: number };

export function getSession(id: string): Session | null {
  const row = db.prepare("SELECT * FROM sessions WHERE id = ?").get(id) as Session | undefined;
  if (!row) return null;
  if (row.expires_at < Date.now()) {
    db.prepare("DELETE FROM sessions WHERE id = ?").run(id);
    return null;
  }
  return row;
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
  u.searchParams.set("allow_signup", "false");
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

export async function fetchAuthenticatedLogin(accessToken: string): Promise<string> {
  const res = await undiciRequest("https://api.github.com/user", {
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "User-Agent": "yzgc-admin",
      Accept: "application/vnd.github+json",
    },
  });
  const body = (await res.body.json()) as { login?: string };
  if (!body.login) throw new Error("failed to fetch user");
  return body.login;
}

import { randomBytes } from "node:crypto";
import { request as defaultRequest } from "undici";
import type Database from "better-sqlite3";
import type { AppConfig } from "../config.js";
import type { createCrypto } from "./crypto.js";
import { GITHUB_TIMEOUT_MS } from "./github.js";
export type Session = {
  id: string;
  login: string;
  user_id: number | null;
  avatar_url: string | null;
  accessToken: string;
  expires_at: number;
};

export function createAuth(db: Database.Database, crypto: ReturnType<typeof createCrypto>, config: AppConfig, undiciRequest = defaultRequest) {
const { encrypt, decrypt } = crypto;
const SESSION_TTL_MS = 7 * 24 * 60 * 60 * 1000;

function createSession(
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

function getSession(id: string): Session | null {
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

function destroySession(id: string) {
  db.prepare("DELETE FROM sessions WHERE id = ?").run(id);
}

/**
 * 登录过的人：审计里每条 auth.signin 的登录名（只有 CONSOLE_ORG 的 active 成员能登录，所以都是组织成员，
 * 包括组织 owner），加上当前会话。论坛用它挡游客冒名；从没登录过的组织成员不在这里。
 */
function signedInLogins(): string[] {
  return (db.prepare("SELECT actor AS login FROM audit_logs WHERE action = 'auth.signin' UNION SELECT login FROM sessions").all() as { login: string }[])
    .map(row => row.login);
}

function buildAuthorizeUrl(state: string): string {
  const u = new URL("https://github.com/login/oauth/authorize");
  u.searchParams.set("client_id", config.oauth.clientId);
  u.searchParams.set("redirect_uri", `${config.publicOrigin}/auth/callback`);
  u.searchParams.set("scope", config.oauth.scope);
  u.searchParams.set("state", state);
  return u.toString();
}

async function exchangeCode(code: string): Promise<string> {
  const res = await undiciRequest("https://github.com/login/oauth/access_token", {
    method: "POST",
    headersTimeout: GITHUB_TIMEOUT_MS, bodyTimeout: GITHUB_TIMEOUT_MS,
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
    // 只带 GitHub 的错误枚举（bad_verification_code、incorrect_client_credentials……），日志据此分得清配置错误和超时；不带说明文字
    throw Object.assign(new Error("oauth exchange failed"), { code: body.error ?? "oauth_exchange_failed", status: res.statusCode });
  }
  return body.access_token;
}

async function fetchAuthenticatedUser(accessToken: string): Promise<{ login: string; id: number; avatar_url: string; email: string | null; name: string | null }> {
  const res = await undiciRequest("https://api.github.com/user", {
    headersTimeout: GITHUB_TIMEOUT_MS, bodyTimeout: GITHUB_TIMEOUT_MS,
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "User-Agent": "yzgc-admin",
      Accept: "application/vnd.github+json",
    },
  });
  const body = (await res.body.json()) as { login?: string; id?: number; avatar_url?: string; email?: string | null; name?: string | null };
  if (!body.login || !body.id) throw Object.assign(new Error("failed to fetch user"), { code: "github_user_failed", status: res.statusCode });
  return { login: body.login, id: body.id, avatar_url: body.avatar_url ?? "", email: body.email ?? null, name: body.name ?? null };
}

/**
 * 撤销这个用户对本应用的授权（整条 grant，不只是这个 token）。登录被拒的非成员已经在 GitHub 上授了权限，
 * 服务端不存他的 token，也不该让这份授权一直挂在他的账号里。成功是 204；其它结果抛出，由调用方记日志后忽略。
 */
async function revokeGrant(accessToken: string): Promise<void> {
  const basic = Buffer.from(`${config.oauth.clientId}:${config.oauth.clientSecret}`).toString("base64");
  const res = await undiciRequest(`https://api.github.com/applications/${encodeURIComponent(config.oauth.clientId)}/grant`, {
    method: "DELETE",
    headersTimeout: GITHUB_TIMEOUT_MS, bodyTimeout: GITHUB_TIMEOUT_MS,
    headers: {
      Authorization: `Basic ${basic}`,
      "User-Agent": "yzgc-admin",
      Accept: "application/vnd.github+json",
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ access_token: accessToken }),
  });
  await res.body?.dump?.();
  if (res.statusCode !== 204) throw Object.assign(new Error("grant revoke failed"), { code: "github_revoke_failed", status: res.statusCode });
}

return { createSession, getSession, destroySession, signedInLogins, buildAuthorizeUrl, exchangeCode, fetchAuthenticatedUser, revokeGrant };
}

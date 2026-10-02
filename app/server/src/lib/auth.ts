import { randomBytes } from "node:crypto";
import { request as defaultRequest } from "undici";
import type Database from "better-sqlite3";
import type { AppConfig } from "../config.js";
import type { createCrypto } from "./crypto.js";
import { truncateWal } from "./db.js";
import { GITHUB_TIMEOUT_MS } from "./github.js";
export type Session = {
  id: string;
  login: string;
  user_id: number | null;
  avatar_url: string | null;
  accessToken: string;
  expires_at: number;
};

/** 清理循环只记日志：一次清理失败不影响服务，也不抛出（#128）。 */
export type SessionCleanupLogger = {
  info(details: Record<string, unknown>, message: string): void;
  error(details: Record<string, unknown>, message: string): void;
};

/** 过期会话的清理间隔：每小时一次；启动时还会先清一次（#128）。 */
export const SESSION_CLEANUP_INTERVAL_MS = 60 * 60 * 1000;

/** 会话有效期：签发后 7 天。 */
export const SESSION_TTL_MS = 7 * 24 * 60 * 60 * 1000;

export function createAuth(db: Database.Database, crypto: ReturnType<typeof createCrypto>, config: AppConfig, undiciRequest = defaultRequest, clock: () => number = Date.now) {
const { encrypt, decrypt } = crypto;

function createSession(
  login: string,
  userId: number | null,
  avatarUrl: string | null,
  accessToken: string
): string {
  const id = randomBytes(24).toString("base64url");
  const now = clock();
  db.prepare(
    "INSERT INTO sessions(id, login, user_id, avatar_url, access_token_encrypted, created_at, expires_at) VALUES(?, ?, ?, ?, ?, ?, ?)"
  ).run(id, login, userId, avatarUrl, encrypt(accessToken), now, now + SESSION_TTL_MS);
  return id;
}

function getSession(id: string): Session | null {
  const row = db.prepare("SELECT * FROM sessions WHERE id = ?").get(id) as any;
  if (!row) return null;
  if (row.expires_at < clock()) {
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

/** 删掉会话；返回这次是否真的删掉了一行（已经删过或本来就没有时为 false）。 */
function destroySession(id: string): boolean {
  return db.prepare("DELETE FROM sessions WHERE id = ?").run(id).changes > 0;
}

/**
 * 清一趟（#128）：删掉所有已过期的会话，再截断 WAL；返回删掉的行数和 WAL 截成没有。登录一次就不再回来的人，
 * 他的会话行和里面加密的高权限 GitHub token 不能一直留在库里；测试直接调这个函数，不用等计时器。
 * secure_delete（lib/db.ts）只让新写的页不带被删的内容，旧页还在 -wal 和库文件里，截断 WAL 之后才被覆盖；
 * 所以每趟都截，登出、读到过期、GitHub 拒绝令牌（#164）时删掉的会话也一起清掉。
 */
function cleanupExpiredSessions(): { deleted: number; walTruncated: boolean } {
  const deleted = db.prepare("DELETE FROM sessions WHERE expires_at < ?").run(clock()).changes;
  return { deleted, walTruncated: truncateWal(db) };
}

let cleanupTimer: ReturnType<typeof setInterval> | null = null;

/**
 * 打开定时清理（buildApp 的 sessionCleanup，只有真实进程调用；测试直接调 cleanupExpiredSessions）。
 * 立即清一次，之后每小时清一次；计时器 unref，不阻止进程退出；单次出错只记日志，不抛出、不影响请求。
 */
function startCleanup(logger: SessionCleanupLogger): void {
  if (cleanupTimer) return;
  const run = () => {
    try {
      const { deleted, walTruncated } = cleanupExpiredSessions();
      if (deleted > 0) logger.info({ deleted }, "expired sessions removed");
      if (!walTruncated) logger.info({}, "wal truncate deferred: another connection is reading");
    } catch (error) {
      // code 是 SQLite 的错误枚举（SQLITE_BUSY、SQLITE_CORRUPT……），不含数据
      logger.error({ error: (error as Error)?.name ?? "error", code: (error as { code?: unknown })?.code }, "session cleanup failed");
    }
  };
  run();
  cleanupTimer = setInterval(run, SESSION_CLEANUP_INTERVAL_MS);
  cleanupTimer.unref();
}

/** 关停时停掉定时清理（buildApp 的 onClose）。 */
function stopCleanup(): void {
  if (cleanupTimer) clearInterval(cleanupTimer);
  cleanupTimer = null;
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

return { createSession, getSession, destroySession, signedInLogins, buildAuthorizeUrl, exchangeCode, fetchAuthenticatedUser, revokeGrant, cleanupExpiredSessions, startCleanup, stopCleanup };
}

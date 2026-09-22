import { createHash } from "node:crypto";
import type { FastifyReply, FastifyRequest } from "fastify";
import type { AppConfig } from "../config.js";

export type OAuthState = {
  state: string;
  kind: "admin" | "forum-login" | "forum-bind";
  returnTo: string;
  issuedAt: number;
  userId?: number;
  sessionHash?: string;
};
export type OAuthCookie = "oauth_state" | "forum_oauth_state";
const TTL_MS = 10 * 60_000;

export const sessionFingerprint = (sid: string) => createHash("sha256").update(sid).digest("hex");

export function setOAuthState(reply: FastifyReply, config: AppConfig, name: OAuthCookie, state: Omit<OAuthState, "issuedAt">) {
  reply.setCookie(name, JSON.stringify({ ...state, issuedAt: Date.now() }), {
    signed: true, httpOnly: true, secure: config.cookieSecure, sameSite: "lax",
    path: "/auth", domain: config.cookieDomain, maxAge: TTL_MS / 1000,
  });
}

/** Cookie integrity and server-checked expiry; GitHub still owns code single-use. */
export function readOAuthState(req: FastifyRequest, reply: FastifyReply, name: OAuthCookie, expected: string): OAuthState | null {
  reply.clearCookie(name, { path: "/auth", domain: req.server.services.config.cookieDomain });
  const raw = req.cookies?.[name];
  if (!raw || raw.length > 8192) return null;
  const signed = req.unsignCookie(raw);
  if (!signed.valid || !signed.value) return null;
  try {
    const value = JSON.parse(signed.value) as OAuthState;
    if (!value || value.state !== expected || typeof value.returnTo !== "string" ||
      !Number.isFinite(value.issuedAt) || value.issuedAt > Date.now() || Date.now() - value.issuedAt > TTL_MS) return null;
    if (name === "oauth_state" ? value.kind !== "admin" : !["forum-login", "forum-bind"].includes(value.kind)) return null;
    if (value.kind === "forum-bind" && (!Number.isSafeInteger(value.userId) || typeof value.sessionHash !== "string")) return null;
    return value;
  } catch { return null; }
}

export function setForumSessionCookie(reply: FastifyReply, config: AppConfig, sid: string) {
  reply.setCookie("forum_sid", sid, {
    httpOnly: true, secure: config.cookieSecure, sameSite: "lax", path: "/",
    maxAge: 14 * 24 * 60 * 60, domain: config.cookieDomain,
  });
}

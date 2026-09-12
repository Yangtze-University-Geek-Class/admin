import { config as loadEnv } from "dotenv";
loadEnv();

function req(key: string): string {
  const v = process.env[key];
  if (!v) throw new Error(`missing env: ${key}`);
  return v;
}

export const config = {
  port: Number(process.env.PORT ?? 3000),
  publicOrigin: req("PUBLIC_ORIGIN"),
  siteOrigin: process.env.SITE_ORIGIN ?? process.env.PUBLIC_ORIGIN ?? "",
  cookieDomain: process.env.COOKIE_DOMAIN || undefined,
  oauth: {
    clientId: req("OAUTH_CLIENT_ID"),
    clientSecret: req("OAUTH_CLIENT_SECRET"),
    scope: "read:user user:email admin:org read:org repo",
  },
  sessionSecret: req("SESSION_SECRET"),
  encryptionKey: req("ENCRYPTION_KEY"),
  dbPath: process.env.DB_PATH ?? "./data/data.db",
  // empty = unrestricted (any org the user has membership in)
  allowedOrgs: (process.env.ALLOWED_ORGS ?? "")
    .split(",")
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean),
  turnstile: {
    siteKey: process.env.TURNSTILE_SITE_KEY ?? "",
    secretKey: process.env.TURNSTILE_SECRET_KEY ?? "",
  },
  // 三端各自的域名，用于把 SPA fallback 指到对应的 index.html。
  // admin 默认跟随 PUBLIC_ORIGIN（OAuth 回调所在域名），portal 跟随 SITE_ORIGIN。
  siteHosts: {
    admin: process.env.ADMIN_HOST || hostOf(process.env.PUBLIC_ORIGIN ?? ""),
    portal: process.env.PORTAL_HOST || hostOf(process.env.SITE_ORIGIN ?? process.env.PUBLIC_ORIGIN ?? ""),
    forum: process.env.FORUM_HOST || "forum.yangtzeu.work",
  },
};

/** 取 URL 的 host，取不到就回退成输入本身。 */
function hostOf(origin: string): string {
  try {
    return new URL(origin).host;
  } catch {
    return origin;
  }
}

export const turnstileEnabled = () =>
  Boolean(config.turnstile.siteKey && config.turnstile.secretKey);

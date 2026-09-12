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
  // 全部从既有变量推导，不硬编码任何域名：
  //   admin  ← PUBLIC_ORIGIN（OAuth 回调所在域名，本来就必须配对）
  //   portal ← SITE_ORIGIN
  //   forum  ← portal 域名加 forum. 前缀，或显式 FORUM_HOST
  // 前端在 web/shared/config/app.config.json 里另有一份（构建期常量），
  // 两边必须一致 —— 见 .env.example 的说明。
  siteHosts: {
    admin: process.env.ADMIN_HOST || hostOf(process.env.PUBLIC_ORIGIN ?? ""),
    portal: process.env.PORTAL_HOST || hostOf(process.env.SITE_ORIGIN ?? process.env.PUBLIC_ORIGIN ?? ""),
    forum:
      process.env.FORUM_HOST ||
      `forum.${hostOf(process.env.SITE_ORIGIN ?? process.env.PUBLIC_ORIGIN ?? "")}`,
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

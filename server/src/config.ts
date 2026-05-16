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
};

export const turnstileEnabled = () =>
  Boolean(config.turnstile.siteKey && config.turnstile.secretKey);

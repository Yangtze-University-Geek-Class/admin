import { config as loadEnv } from "dotenv";
loadEnv();

function req(key: string): string {
  const v = process.env[key];
  if (!v) throw new Error(`missing env: ${key}`);
  return v;
}

export const config = {
  port: Number(process.env.PORT ?? 3000),
  org: req("ORG"),
  adminLogin: req("ADMIN_LOGIN"),
  publicOrigin: req("PUBLIC_ORIGIN"),
  oauth: {
    clientId: req("OAUTH_CLIENT_ID"),
    clientSecret: req("OAUTH_CLIENT_SECRET"),
    scope: "read:user user:email admin:org",
  },
  sessionSecret: req("SESSION_SECRET"),
  encryptionKey: req("ENCRYPTION_KEY"),
  dbPath: process.env.DB_PATH ?? "./data/data.db",
  turnstile: {
    siteKey: process.env.TURNSTILE_SITE_KEY ?? "",
    secretKey: process.env.TURNSTILE_SECRET_KEY ?? "",
  },
};

export const turnstileEnabled = () =>
  Boolean(config.turnstile.siteKey && config.turnstile.secretKey);

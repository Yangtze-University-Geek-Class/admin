import { config as loadEnv } from "dotenv";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { readFileSync } from "node:fs";

/** 仓库根：geek_main/。配置、docs、pnpm 工作区清单都在这里。 */
export const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");
/** 服务根：geek_main/app/。所有可部署服务都在 app/<service> 下。 */
export const APP_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
/** GitHub 用户名 / 组织名：字母数字与单个连字符，1–39 字符。 */
export const GITHUB_LOGIN_REGEX = /^[A-Za-z0-9](?:[A-Za-z0-9]|-(?=[A-Za-z0-9])){0,38}$/;
export const DEFAULT_CONSOLE_ORG = "Yangtze-University-Geek-Class";
export function createConfig(env: Record<string, string | undefined>) {
  const required = (key: string): string => {
    const value = env[key];
    if (!value) throw new Error(`missing env: ${key}`);
    return value;
  };
  const origin = (value: string): string => {
    const url = new URL(value);
    if (!["http:", "https:"].includes(url.protocol) || url.username || url.password || url.pathname !== "/" || url.search || url.hash) {
      throw new Error("site origins must be plain HTTP(S) origins");
    }
    return url.origin;
  };
  const publicOrigin = origin(required("PUBLIC_ORIGIN"));
  const siteOrigin = origin(env.SITE_ORIGIN || publicOrigin);
  const production = env.NODE_ENV === "production";
  if (production && [publicOrigin, siteOrigin].some(value => !value.startsWith("https:"))) throw new Error("production requires HTTPS origins");
  const port = Number(env.PORT ?? 3000);
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error("invalid PORT");
  const powDifficulty = Number(env.POW_DIFFICULTY ?? 3);
  if (!Number.isInteger(powDifficulty) || powDifficulty < 0 || powDifficulty > 5) throw new Error("POW_DIFFICULTY must be an integer from 0 to 5");
  const dbPath = env.DB_PATH === ":memory:" ? ":memory:" : resolve(REPO_ROOT, env.DB_PATH ?? "data/data.db");
  const forumDbPath = env.FORUM_DB_PATH === ":memory:" ? ":memory:" : resolve(REPO_ROOT, env.FORUM_DB_PATH ?? (dbPath === ":memory:" ? "data/forum.db" : resolve(dirname(dbPath), "forum.db")));
  const sessionSecret = required("SESSION_SECRET");
  if (sessionSecret.length < 32) throw new Error("SESSION_SECRET must contain at least 32 characters");
  const encryptionKey = required("ENCRYPTION_KEY");
  if (Buffer.from(encryptionKey, "base64").length !== 32) throw new Error("ENCRYPTION_KEY must decode to 32 bytes");
  const host = (value: string | undefined, fallback: string) => {
    const result = (value || fallback).toLowerCase();
    if (!/^[a-z0-9.-]+$/.test(result)) throw new Error("site host must be a hostname without a port");
    return result;
  };
  const portalHost = host(env.PORTAL_HOST, new URL(siteOrigin).hostname);
  // 容器里必须监听 0.0.0.0，本机开发仍默认回环；见 deploy/env/.env.<环境> 的 HOST。
  const listenHost = (env.HOST || "127.0.0.1").trim();
  if (!/^[a-z0-9.-]+$/i.test(listenHost)) throw new Error("HOST must be an address without a port");
  // 反向代理在 compose 网络里不是回环地址，故用显式开关决定是否信任 X-Forwarded-*。
  const trustProxy = (() => {
    const raw = (env.TRUST_PROXY ?? "").trim();
    if (raw === "" ) return "loopback" as const;
    if (["1", "true", "yes"].includes(raw.toLowerCase())) return true;
    if (["0", "false", "no"].includes(raw.toLowerCase())) return false;
    return raw;
  })();
  const allowedOrgs = (env.ALLOWED_ORGS ?? "").split(",").map(value => value.trim().toLowerCase()).filter(Boolean);
  // 极客班控制台固定管理的 GitHub 组织（非密钥）；本机与测试可不设。
  const consoleOrg = (env.CONSOLE_ORG ?? "").trim() || DEFAULT_CONSOLE_ORG;
  if (!GITHUB_LOGIN_REGEX.test(consoleOrg)) throw new Error("CONSOLE_ORG must be a GitHub organization login");
  if (allowedOrgs.length > 0 && !allowedOrgs.includes(consoleOrg.toLowerCase())) throw new Error("ALLOWED_ORGS must include CONSOLE_ORG");
  return {
    production, port, publicOrigin, siteOrigin, host: listenHost, trustProxy, consoleOrg,
    cookieDomain: env.COOKIE_DOMAIN || undefined,
    cookieSecure: publicOrigin.startsWith("https:"),
    oauth: { clientId: required("OAUTH_CLIENT_ID"), clientSecret: required("OAUTH_CLIENT_SECRET"), scope: "read:user user:email admin:org read:org repo" },
    sessionSecret, encryptionKey, dbPath, forumDbPath,
    uploadDir: resolve(REPO_ROOT, env.FORUM_UPLOAD_DIR ?? "data/forum-uploads"),
    allowedOrgs,
    turnstile: { siteKey: env.TURNSTILE_SITE_KEY ?? "", secretKey: env.TURNSTILE_SECRET_KEY ?? "" },
    powDifficulty,
    siteHosts: { admin: host(env.ADMIN_HOST, new URL(publicOrigin).hostname), portal: portalHost, forum: host(env.FORUM_HOST, `forum.${portalHost}`) },
  };
}
export type AppConfig = ReturnType<typeof createConfig>;
export function loadConfig(): AppConfig {
  loadEnv({ path: resolve(REPO_ROOT, ".env") });
  const config = createConfig(process.env);
  if (config.production) {
    const frontend = JSON.parse(readFileSync(resolve(APP_ROOT, "web/shared/config/app.config.json"), "utf8")) as { sites: Record<string, { host: string }> };
    assertSiteHosts(config, frontend.sites);
  }
  return config;
}

export function assertSiteHosts(config: AppConfig, sites: Record<string, { host: string }>) {
  for (const site of ["portal", "forum", "admin"] as const) {
    if (config.siteHosts[site] !== sites[site]?.host?.toLowerCase()) throw new Error(`Frontend/backend hostname mismatch: ${site}`);
  }
}

import { config as loadEnv } from "dotenv";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

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
  // 每个环境只有一个对外 origin：OAuth 回调、邀请链接、登录回跳与写请求的 Origin 校验都只认它。
  // 管理端不再占独立域名，而是同一 origin 下的 /admin、/console 路径（见 app.ts 的 resolveSiteEntry）。
  const publicOrigin = (() => {
    const url = new URL(required("PUBLIC_ORIGIN"));
    if (!["http:", "https:"].includes(url.protocol) || url.username || url.password || url.pathname !== "/" || url.search || url.hash) {
      throw new Error("PUBLIC_ORIGIN must be a plain HTTP(S) origin");
    }
    return url.origin;
  })();
  const production = env.NODE_ENV === "production";
  if (production && !publicOrigin.startsWith("https:")) throw new Error("production requires an HTTPS PUBLIC_ORIGIN");
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
    production, port, publicOrigin, host: listenHost, trustProxy, consoleOrg,
    cookieDomain: env.COOKIE_DOMAIN || undefined,
    cookieSecure: publicOrigin.startsWith("https:"),
    oauth: { clientId: required("OAUTH_CLIENT_ID"), clientSecret: required("OAUTH_CLIENT_SECRET"), scope: "read:user user:email admin:org read:org repo" },
    sessionSecret, encryptionKey, dbPath, forumDbPath,
    uploadDir: resolve(REPO_ROOT, env.FORUM_UPLOAD_DIR ?? "data/forum-uploads"),
    // 论坛的公开内容（分类、标签、公开旧帖），启动时读来播种。不是环境变量：仓库里和镜像里都在同一个相对位置
    // （app/server/Dockerfile 把两份 JSON 复制到 /app/app/forum/content）；测试直接换成夹具目录。
    forumContentDir: resolve(APP_ROOT, "forum/content"),
    allowedOrgs,
    turnstile: { siteKey: env.TURNSTILE_SITE_KEY ?? "", secretKey: env.TURNSTILE_SECRET_KEY ?? "" },
    powDifficulty,
  };
}
export type AppConfig = ReturnType<typeof createConfig>;
export function loadConfig(): AppConfig {
  loadEnv({ path: resolve(REPO_ROOT, ".env") });
  return createConfig(process.env);
}

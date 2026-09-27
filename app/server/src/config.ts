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
  // 反向代理在 compose 网络里不是回环地址，要显式说明信任几层。部署写层数（宿主 nginx → web 容器 nginx → server，
  // 两层，见 deploy/env/.env.<环境>）：只取 X-Forwarded-For 从右数第 2 个地址当客户端，客户端自己填的最左边几段不算数。
  // 写 true 会一路信任到最左边，那一段是客户端随便填的，按 IP 的限流、审计 IP 都能被伪造。
  const trustProxy = (() => {
    const raw = (env.TRUST_PROXY ?? "").trim();
    const lower = raw.toLowerCase();
    if (raw === "") return "loopback" as const;
    if (/^\d+$/.test(raw)) {
      const hops = Number(raw);
      if (hops > 10) throw new Error("TRUST_PROXY hop count must be at most 10");
      return hops === 0 ? false : hops;
    }
    if (["true", "yes"].includes(lower)) return true;
    if (["false", "no"].includes(lower)) return false;
    if (/^[-+]?(?:\d+\.?\d*|\.\d+)$/.test(raw)) throw new Error("TRUST_PROXY must be true, false, a hop count (0–10) or a list of proxy addresses");
    return raw;
  })();
  const allowedOrgs = (env.ALLOWED_ORGS ?? "").split(",").map(value => value.trim().toLowerCase()).filter(Boolean);
  // 极客班控制台固定管理的 GitHub 组织（非密钥）；本机与测试可不设。
  const consoleOrg = (env.CONSOLE_ORG ?? "").trim() || DEFAULT_CONSOLE_ORG;
  if (!GITHUB_LOGIN_REGEX.test(consoleOrg)) throw new Error("CONSOLE_ORG must be a GitHub organization login");
  if (allowedOrgs.length > 0 && !allowedOrgs.includes(consoleOrg.toLowerCase())) throw new Error("ALLOWED_ORGS must include CONSOLE_ORG");
  // 发信（#148，lib/mail/）：全部可选，都不设时不发信（本机与测试），投递和改状态照常，信记成 skipped/mail_disabled。
  // 发信商要同时有密钥和发件地址才算配置好；阿里云的两把密钥要么都有、要么都没有。地址格式在 lib/mail/mailer.ts 里核对。
  const mail = (() => {
    const value = (key: string) => (env[key] ?? "").trim();
    const aliyunKeyId = value("MAIL_ALIYUN_ACCESS_KEY_ID");
    const aliyunKeySecret = value("MAIL_ALIYUN_ACCESS_KEY_SECRET");
    if (Boolean(aliyunKeyId) !== Boolean(aliyunKeySecret)) throw new Error("MAIL_ALIYUN_ACCESS_KEY_ID and MAIL_ALIYUN_ACCESS_KEY_SECRET must be set together");
    const aliyunFrom = value("MAIL_ALIYUN_FROM");
    const resendKey = value("MAIL_RESEND_API_KEY");
    const resendFrom = value("MAIL_RESEND_FROM");
    // 没写时按白名单处理（白名单空就谁也不发，本机不会误发）；预发布和正式的 env 模板都显式写 all（#169）。
    const recipients = value("MAIL_RECIPIENTS").toLowerCase() || "allowlist";
    if (recipients !== "all" && recipients !== "allowlist") throw new Error("MAIL_RECIPIENTS must be all or allowlist");
    return {
      aliyun: aliyunKeyId && aliyunFrom ? { accessKeyId: aliyunKeyId, accessKeySecret: aliyunKeySecret, from: aliyunFrom } : null,
      resend: resendKey && resendFrom ? { apiKey: resendKey, from: resendFrom } : null,
      assetBase: value("MAIL_ASSET_BASE") || "https://cdn.crosery.com/yzgc/mail/v1/",
      // 空 = 信里不请人直接回复，改成指向官网意见箱
      replyTo: value("MAIL_REPLY_TO") || null,
      recipients: recipients as "all" | "allowlist",
      allowlist: [...new Set(value("MAIL_ALLOWLIST").split(",").map(item => item.trim().toLowerCase()).filter(Boolean))],
    };
  })();
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
    mail,
  };
}
export type AppConfig = ReturnType<typeof createConfig>;
export type MailConfig = AppConfig["mail"];
export function loadConfig(): AppConfig {
  loadEnv({ path: resolve(REPO_ROOT, ".env") });
  return createConfig(process.env);
}

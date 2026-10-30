import { config as loadEnv } from "dotenv";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { parseStaticCdnBase, parseStaticCdnOrigin } from "./lib/static-cdn.js";
import { isHttpsOrigin, type ObjectStorageConfig } from "./lib/object-storage.js";
import { parseShieldAllowlist } from "./lib/shield.js";
import { NANO_AVATAR_VERSION } from "./lib/nano-avatar.js";

/** 仓库根：geek_main/。配置、docs、pnpm 工作区清单都在这里。 */
export const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");
/** 服务根：geek_main/app/。所有可部署服务都在 app/<service> 下。 */
export const APP_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
/** 极客班固定管理的 GitHub 组织：只给 feedback.org 归一化与审计历史数据用（#129），不是环境变量——
 * #276 挪来的清理（从 #274 遗留）：这个部署从来没有也不会配别的组织，`CONSOLE_ORG` 环境变量读取、
 * 校验与 deploy 两份 .env 契约里的声明都已去掉，谁要用这个组织名直接导入这个常量。 */
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
  // 发信（#148，lib/mail/）：全部可选，都不设时不发信（本机与测试），投递和改状态照常，信记成 skipped/mail_disabled。
  // 发信商要同时有密钥和发件地址才算配置好；阿里云的两把密钥要么都有、要么都没有。地址格式在 lib/mail/mailer.ts 里核对。
  const mail = (() => {
    const value = (key: string) => (env[key] ?? "").trim();
    // 图片地址前缀没写时由 CDN 源站派生（#360）；源站也没有就留空，发信模块启动时核对并失败关闭，不发没有图片地址的信。
    const cdnOrigin = parseStaticCdnOrigin(env.STATIC_CDN_ORIGIN);
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
      assetBase: value("MAIL_ASSET_BASE") || (cdnOrigin ? `${cdnOrigin}/yzgc/mail/v1/` : ""),
      // 空 = 信里不请人直接回复，改成指向官网意见箱
      replyTo: value("MAIL_REPLY_TO") || null,
      recipients: recipients as "all" | "allowlist",
      allowlist: [...new Set(value("MAIL_ALLOWLIST").split(",").map(item => item.trim().toLowerCase()).filter(Boolean))],
    };
  })();
  // Google 登录（#262）：两项都设才启用，只设一项让启动失败；都不设时登录页不出现 Google（本机、测试与凭据到位之前）。
  const google = (() => {
    const clientId = (env.GOOGLE_CLIENT_ID ?? "").trim();
    const clientSecret = (env.GOOGLE_CLIENT_SECRET ?? "").trim();
    if (Boolean(clientId) !== Boolean(clientSecret)) throw new Error("GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET must be set together");
    return clientId ? { clientId, clientSecret } : null;
  })();
  // 对外授权（#270，ADR-0005 决策 8）：OIDC_JWKS 是签名私钥（JWK Set 的 JSON，或它的 base64，`node dist/cli/oidc.js keygen` 生成）。
  // 没设时不开 /oidc（本机与测试）；设了但读不出来让启动失败，错误信息不带配置的值。签发者固定是 PUBLIC_ORIGIN + /oidc。
  const oidc = (() => {
    const raw = (env.OIDC_JWKS ?? "").trim();
    if (!raw) return null;
    let jwks: { keys?: unknown };
    try { jwks = JSON.parse(raw.startsWith("{") ? raw : Buffer.from(raw, "base64").toString("utf8")) as { keys?: unknown }; } catch { throw new Error("OIDC_JWKS is not a readable JWK Set"); }
    const keys = Array.isArray(jwks.keys) ? jwks.keys as Record<string, unknown>[] : [];
    if (keys.length === 0 || keys.some(key => typeof key?.kty !== "string" || typeof key?.d !== "string")) throw new Error("OIDC_JWKS must be a JWK Set of private keys");
    if (!keys.some(key => key.kty === "RSA")) throw new Error("OIDC_JWKS must contain an RSA key (ID tokens are signed with RS256)");
    return { issuer: `${publicOrigin}/oidc`, jwks: { keys } };
  })();
  // GitLab 账号同步（#270）：GITLAB_SYNC 是 off（不同步）、dry-run（只算出要做什么，不调 GitLab）或 on。不是 off 时要有
  // GITLAB_URL（GitLab 的 HTTP(S) 基址，可带部署子路径），on 时还要 GITLAB_API_TOKEN（管理员令牌，api 范围）；GITLAB_GROUP 是成员进的组，默认 geek。
  const gitlab = (() => {
    const value = (key: string) => (env[key] ?? "").trim();
    const mode = value("GITLAB_SYNC").toLowerCase() || "off";
    if (mode !== "off" && mode !== "dry-run" && mode !== "on") throw new Error("GITLAB_SYNC must be off, dry-run or on");
    const rawUrl = value("GITLAB_URL");
    let url: string | null = null;
    if (rawUrl) {
      const parsed = (() => { try { return new URL(rawUrl); } catch { return null; } })();
      if (!parsed || !["http:", "https:"].includes(parsed.protocol) || parsed.search || parsed.hash || parsed.username || parsed.password) {
        throw new Error("GITLAB_URL must be an HTTP(S) base URL without credentials, query or fragment");
      }
      url = `${parsed.origin}${parsed.pathname.replace(/\/+$/, "")}`;
    }
    const token = value("GITLAB_API_TOKEN") || null;
    const group = value("GITLAB_GROUP") || "geek";
    const clientId = value("GITLAB_OIDC_CLIENT") || "gitlab";
    if (!/^[a-z0-9_]{3,64}$/.test(clientId)) throw new Error("GITLAB_OIDC_CLIENT must be a client identifier");
    // GITLAB_OIDC_SECTOR：这个客户端的 pairwise sector（主机名，可带端口）。GitLab 换地址时它不跟着换，成员的 sub 才不变（#335）；空 = 不核对。
    const sector = value("GITLAB_OIDC_SECTOR").toLowerCase() || null;
    if (sector && !/^[a-z0-9]([a-z0-9.-]*[a-z0-9])?(:[0-9]{1,5})?$/.test(sector)) throw new Error("GITLAB_OIDC_SECTOR must be a host name");
    if (!/^[A-Za-z0-9_.-]{1,255}$/.test(group)) throw new Error("GITLAB_GROUP must be a group path");
    if (mode !== "off" && !url) throw new Error("GITLAB_SYNC needs GITLAB_URL");
    if (mode === "on" && !token) throw new Error("GITLAB_SYNC=on needs GITLAB_API_TOKEN");
    return { mode: mode as "off" | "dry-run" | "on", url, token, group, clientId, sector };
  })();
  // 访问防护（#333，lib/shield.ts）：按真实客户端 IP（req.ip，沿用上面的 TRUST_PROXY）累计异常信号，超过阈值就封禁，再犯逐级加长。
  // 全部可调，默认值按现有流量留余量；校园出口 NAT（一个 IP 后面很多人）不能被一次正常使用误伤，所以阈值按 10 分钟计，封禁从 15 分钟起。
  const shield = (() => {
    const blockMinutes = ((env.SHIELD_BLOCK_MINUTES ?? "").trim() || "15,60,360,1440").split(",").map(item => item.trim());
    if (!blockMinutes.every(item => /^\d+$/.test(item) && Number(item) >= 1 && Number(item) <= 10080)) {
      throw new Error("SHIELD_BLOCK_MINUTES must be a comma-separated list of minutes from 1 to 10080");
    }
    // 开发环境（.env.dev）设 off：计分、封禁、蜜罐与告知都不生效；全站上限与限流计数照常。
    const enabled = (env.SHIELD_ENABLED ?? "").trim() || "on";
    if (enabled !== "on" && enabled !== "off") throw new Error("SHIELD_ENABLED must be on or off");
    return {
      enabled: enabled === "on",
      allowlist: parseShieldAllowlist((env.SHIELD_ALLOWLIST ?? "").split(",")),
      thresholdPoints: wholeEnv(env, "SHIELD_THRESHOLD", 120, 1, 1_000_000),
      windowMs: wholeEnv(env, "SHIELD_WINDOW_MINUTES", 10, 1, 1440) * 60_000,
      blockMs: blockMinutes.map(item => Number(item) * 60_000),
      decayMs: wholeEnv(env, "SHIELD_DECAY_HOURS", 24, 1, 8760) * 3600_000,
    };
  })();
  // 全站北京日上限（#319、#333）与新注册的额度：-1 表示不限。默认值按现有流量留余量，发码与注册的上限可按需调高。
  const quotas = {
    siteEmail: wholeEnv(env, "SITE_QUOTA_EMAIL_DAILY", 2000, -1, 1_000_000),
    siteRegister: wholeEnv(env, "SITE_QUOTA_REGISTER_DAILY", 300, -1, 1_000_000),
    siteFeedback: wholeEnv(env, "SITE_QUOTA_FEEDBACK_DAILY", 200, -1, 1_000_000),
    siteDeviceCode: wholeEnv(env, "SITE_QUOTA_DEVICE_CODE_DAILY", 500, -1, 1_000_000),
    emailRecipient: wholeEnv(env, "EMAIL_RECIPIENT_QUOTA_DAILY", 10, -1, 1000),
    registerNoCookieIp: wholeEnv(env, "REGISTER_NO_COOKIE_IP_DAILY", 3, -1, 1000),
  };
  return {
    production, port, publicOrigin, host: listenHost, trustProxy, shield, quotas,
    deploymentEnvironment: env.GEEK_DEPLOYMENT_ENVIRONMENT ?? "local",
    oidc, gitlab,
    cookieDomain: env.COOKIE_DOMAIN || undefined,
    cookieSecure: publicOrigin.startsWith("https:"),
    // #274 review round 1（CONTRACT-274 §8）：GitHub 组织那道门去掉之后，登录只要读身份和邮箱，
    // 不再需要管理组织、仓库的范围（原来给控制台 GitHub 组织页面用的 admin:org/read:org/repo 已经没有读者）。
    oauth: { clientId: required("OAUTH_CLIENT_ID"), clientSecret: required("OAUTH_CLIENT_SECRET"), scope: "read:user user:email" },
    google,
    sessionSecret, encryptionKey, dbPath, forumDbPath,
    uploadDir: resolve(REPO_ROOT, env.FORUM_UPLOAD_DIR ?? "data/forum-uploads"),
    // 论坛的公开内容（分类、标签、公开旧帖），启动时读来播种。不是环境变量：仓库里和镜像里都在同一个相对位置
    // （app/server/Dockerfile 把两份 JSON 复制到 /app/app/forum/content）；测试直接换成夹具目录。
    forumContentDir: resolve(APP_ROOT, "forum/content"),
    // 公开旧帖里的图片源文件由核心按当前话题可见性提供；forum 静态镜像不再携带这些文件。
    forumPublishedDir: resolve(APP_ROOT, "forum/public/published"),
    // 内置表情包（#276、#286）：清单 manifest.json 与各包的图片，仓库里的通用素材，不按环境或测试换目录。
    stickerAssetsDir: resolve(APP_ROOT, "server/assets/stickers"),
    // NANO 默认头像（#343）：和 GitLab 前置是同一份文件，镜像按仓库里的相对位置带上（app/server/Dockerfile），不按环境换目录。
    nanoAvatarDir: resolve(REPO_ROOT, "deploy/gitlab/ui/nano-avatars", NANO_AVATAR_VERSION),
    // 静态资源 CDN 开关（#146、#286）：构建参数 STATIC_CDN_BASE 由 app/server/Dockerfile 带进运行环境，空 = 同源；
    // 非空只能是 STATIC_CDN_ORIGIN 派生的 yzgc/static/site/ 地址，别的值直接让启动失败。STATIC_CDN_ORIGIN 来自 deploy/env 的环境文件（#360）。
    staticCdnBase: parseStaticCdnBase(env.STATIC_CDN_BASE, env.STATIC_CDN_ORIGIN),
    // 用户文件对象存储（#352）：头像与论坛图片写七牛；三项密钥都留空 = 关闭，文件照旧存在库里。
    objectStorage: parseObjectStorage(env),
    turnstile: { siteKey: env.TURNSTILE_SITE_KEY ?? "", secretKey: env.TURNSTILE_SECRET_KEY ?? "" },
    powDifficulty,
    mail,
  };
}
/**
 * 用户文件对象存储（#352）：端点、区域、前缀、公开地址和三项密钥都从环境来。三项密钥全空 = 关闭（返回 null）；
 * 只填一部分、或者非密钥项不合法就启动失败，不静默关掉。错误信息只写变量名，不回显值。
 */
function parseObjectStorage(env: Record<string, string | undefined>): ObjectStorageConfig | null {
  const bucket = (env.OBJECT_STORAGE_BUCKET ?? "").trim();
  const accessKeyId = (env.OBJECT_STORAGE_ACCESS_KEY_ID ?? "").trim();
  const secretAccessKey = (env.OBJECT_STORAGE_SECRET_ACCESS_KEY ?? "").trim();
  const filled = [bucket, accessKeyId, secretAccessKey].filter(value => value !== "").length;
  if (filled === 0) return null;
  if (filled !== 3) throw new Error("OBJECT_STORAGE_BUCKET、OBJECT_STORAGE_ACCESS_KEY_ID、OBJECT_STORAGE_SECRET_ACCESS_KEY 要么都填，要么都留空");
  if (!/^[a-z0-9][a-z0-9-]{1,61}[a-z0-9]$/.test(bucket)) throw new Error("OBJECT_STORAGE_BUCKET 只能是小写字母、数字和连字符");
  const endpoint = (env.OBJECT_STORAGE_ENDPOINT ?? "").trim();
  if (!isHttpsOrigin(endpoint)) throw new Error("OBJECT_STORAGE_ENDPOINT 必须是 https 源（不带路径与尾斜杠）");
  const region = (env.OBJECT_STORAGE_REGION ?? "").trim();
  if (!/^[a-z0-9-]+$/.test(region)) throw new Error("OBJECT_STORAGE_REGION 不合法");
  const prefix = (env.OBJECT_STORAGE_PREFIX ?? "").trim();
  if (!/^[a-z0-9][a-z0-9_-]*(?:\/[a-z0-9][a-z0-9_-]*)*\/$/.test(prefix)) throw new Error("OBJECT_STORAGE_PREFIX 必须是以 / 结尾的桶内目录");
  const publicBase = (env.OBJECT_STORAGE_PUBLIC_BASE ?? "").trim();
  if (!publicBase.endsWith("/") || !isHttpsOrigin(publicBase.slice(0, -1))) throw new Error("OBJECT_STORAGE_PUBLIC_BASE 必须是 https 源加 /");
  return { endpoint, region, bucket, accessKeyId, secretAccessKey, prefix, publicBase };
}
/** 整数配置项：不设用默认值，设了必须是 min 到 max 之间的整数（写错就启动失败，不静默用默认值）。 */
function wholeEnv(env: Record<string, string | undefined>, key: string, fallback: number, min: number, max: number): number {
  const raw = (env[key] ?? "").trim();
  if (raw === "") return fallback;
  const value = Number(raw);
  if (!/^-?\d+$/.test(raw) || !Number.isInteger(value) || value < min || value > max) throw new Error(`${key} must be an integer from ${min} to ${max}`);
  return value;
}
export type AppConfig = ReturnType<typeof createConfig>;
export type MailConfig = AppConfig["mail"];
export function loadConfig(): AppConfig {
  loadEnv({ path: resolve(REPO_ROOT, ".env") });
  return createConfig(process.env);
}

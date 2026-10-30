import { createHash } from "node:crypto";
import { ipSubject } from "./forum-rules.js";
import type { LimitCheck, LimitsService } from "./limits.js";
import { SITE_BUCKETS, quotaFull, siteCheck, siteQuotaRefusal } from "./site-quota.js";

/**
 * 新建账号限额（#274 SPEC §3.8）：同一 IP 每天最多 5 个新账号，同一设备每天最多 3 个。只在真的要插入新账号
 * 那一刻才计数——登录到已有账号不算；调用方（lib/identity-store.ts 的 signInWithGithub / signInSecondChannel）
 * 只在确认这次会新建账号时才调用 `registrationGuardFor` 返回的闭包，hitAll 一次核对、一次写入两个桶，
 * 全有或全没有。超限统一回 `auth.register.daily`，不细分是哪条线触发，不给探测哪条线更松的机会
 * （和 routes/portal/apply.ts 的 apply.daily 同一个口径）。IP、设备都只存 sha256，不存原文。
 *
 * 没有 visitor cookie 的请求（#333）：每次都拿到新的设备 id，按设备限额等于没有，所以另按 IP 计一个更严的额度
 * （`registerNoCookieIp`，config.ts 的 REGISTER_NO_COOKIE_IP_DAILY）。全站的注册上限（SITE_QUOTA_REGISTER_DAILY）也在这里一起核对。
 *
 * 这个模块是纯函数、不碰 Fastify 请求：IP 与设备 id（`yugc_vid`，没有就现发一个）由路由层
 * （middleware/visitor.ts 的 attachVisitorId）摘出来再传进来——`lib/` 不能依赖 `middleware/`
 * （scripts/check-boundaries.mjs 的既有边界），这里只认已经摘好的两个字符串。
 */
export const REGISTER_IP_DAILY_MAX = 5;
export const REGISTER_DEVICE_DAILY_MAX = 3;
export const REGISTER_LIMITED_MESSAGE = "今天新注册的账号太多了，北京时间零点以后可以再注册。";
const sha256 = (value: string) => createHash("sha256").update(value).digest("hex");

/**
 * `ip`：这次请求的 `req.ip`（内部按 /64 规整 IPv6）；`device`：这次请求的设备 id（`req.visitorId`）；
 * `cookie`：请求原本带没带 visitor cookie（在 attachVisitorId 之前取）；`quotas`：config.ts 的 `quotas`。
 * 返回一个闭包；真正要建号那一刻（`signInWithGithub`/`signInSecondChannel` 的事务里，紧挨着
 * `insertUser`/`insertAccount` 之前）才调用它核对并计数。
 */
export function registrationGuardFor(limits: LimitsService, ip: string, device: string, options: { cookie: boolean; quotas: { siteRegister: number; registerNoCookieIp: number } }): () => boolean {
  const ipHash = sha256(ipSubject(ip));
  const deviceHash = sha256(device);
  return () => {
    const checks: LimitCheck[] = [
      { bucket: "auth.register.daily.ip", subject: ipHash, window: "day-bj", max: REGISTER_IP_DAILY_MAX },
      { bucket: "auth.register.daily.device", subject: deviceHash, window: "day-bj", max: REGISTER_DEVICE_DAILY_MAX },
      siteCheck(SITE_BUCKETS.register, options.quotas.siteRegister),
    ];
    if (!options.cookie) checks.push({ bucket: "auth.register.nocookie.daily.ip", subject: ipHash, window: "day-bj", max: options.quotas.registerNoCookieIp });
    return limits.hitAll(checks).every(outcome => outcome.ok);
  };
}

/**
 * `/auth/email/verify` 这类 JSON 接口用：算好 retry_after（到下一个北京零点），回统一的 429 体。
 * 全站注册上限已经用完时回 `site_quota_exceeded`，否则是按 IP、设备、无 cookie 的 `auth.register.daily`。
 */
export function registrationLimitedBody(limits: LimitsService, now: number, siteRegister: number): { retryAfter: number; body: { error: "rate_limited"; bucket: "auth.register.daily"; message: string; retry_after: number } | ReturnType<typeof siteQuotaRefusal>["body"] } {
  if (quotaFull(limits, siteCheck(SITE_BUCKETS.register, siteRegister), now)) return siteQuotaRefusal(limits, SITE_BUCKETS.register, now);
  const retryAfter = Math.max(1, Math.ceil((limits.beijingDayBounds(now).end - now) / 1000));
  return { retryAfter, body: { error: "rate_limited", bucket: "auth.register.daily", message: REGISTER_LIMITED_MESSAGE, retry_after: retryAfter } };
}

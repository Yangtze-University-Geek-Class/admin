import type { LimitCheck, LimitsService } from "./limits.js";
import { limitKey } from "./mail/outbox.js";

/**
 * 全站每个北京日的上限（#333、#319）：计数走 `limit_events`（lib/limits.ts），按北京日历日零点重置，主体固定为 `site`。
 * `max` 取 config.ts 的 `quotas`，-1 表示不限。超了由路由回 429 `site_quota_exceeded`（发码、注册、意见箱、设备码）。
 */
export const SITE_BUCKETS = {
  email: "site.email.daily",
  register: "site.register.daily",
  feedback: "site.feedback.daily",
  deviceCode: "site.device_code.daily",
} as const;
export type SiteBucket = (typeof SITE_BUCKETS)[keyof typeof SITE_BUCKETS];

const SITE_MESSAGES: Record<SiteBucket, string> = {
  [SITE_BUCKETS.email]: "今天发出的验证码已达全站上限，北京时间零点后再试。",
  [SITE_BUCKETS.register]: "今天全站新注册的账号已达上限，北京时间零点后再试。",
  [SITE_BUCKETS.feedback]: "今天全站收到的意见已达上限，北京时间零点后再试。",
  [SITE_BUCKETS.deviceCode]: "今天全站发起的命令行登录已达上限，北京时间零点后再试。",
};

export function siteCheck(bucket: SiteBucket, max: number): LimitCheck {
  return { bucket, subject: "site", window: "day-bj", max };
}

/** 这一项已经用完了（只读，不计数）。 */
export function quotaFull(limits: LimitsService, check: LimitCheck, now?: number): boolean {
  return check.max !== -1 && limits.count({ bucket: check.bucket, subject: check.subject, window: check.window, now }) >= check.max;
}

/** 全站上限的 429 体（`site_quota_exceeded`）与 Retry-After 秒数；到下一个北京零点。 */
export function siteQuotaRefusal(limits: LimitsService, bucket: SiteBucket, now: number) {
  const retryAfter = Math.max(1, Math.ceil((limits.beijingDayBounds(now).end - now) / 1000));
  return { retryAfter, body: { error: "site_quota_exceeded" as const, bucket, message: SITE_MESSAGES[bucket], retry_after: retryAfter } };
}

/**
 * 发码的两道日上限（#319、#333）：同一收件人每个北京日最多 `emailRecipient` 次（主体是 lib/mail/outbox.ts 的 limitKey，
 * 换 IP、换浏览器都算在一起）；全站每日 `siteEmail` 次。登录、绑定邮箱、重设密码、重发都走同一个 `/auth/email/start` 口径，
 * 两个入口共用这一组检查。先看后记：有一道用完就不发（不占挑战），发成功后再各记一笔。
 */
export const RECIPIENT_BUCKET = "email.recipient.daily";
const RECIPIENT_MESSAGE = "今天发给这个邮箱的验证码已达上限，北京时间零点后再试。";
export function emailQuotaChecks(email: string, quotas: { siteEmail: number; emailRecipient: number }): { recipient: LimitCheck; site: LimitCheck } {
  return {
    recipient: { bucket: RECIPIENT_BUCKET, subject: limitKey(email), window: "day-bj", max: quotas.emailRecipient },
    site: siteCheck(SITE_BUCKETS.email, quotas.siteEmail),
  };
}
/** 任一道已经用完：返回 429 的体与 Retry-After；都没用完返回 null。 */
export function emailQuotaRefusal(limits: LimitsService, checks: { recipient: LimitCheck; site: LimitCheck }, now: number) {
  if (quotaFull(limits, checks.recipient, now)) {
    const retryAfter = Math.max(1, Math.ceil((limits.beijingDayBounds(now).end - now) / 1000));
    return { retryAfter, body: { error: "rate_limited" as const, bucket: RECIPIENT_BUCKET, message: RECIPIENT_MESSAGE, retry_after: retryAfter } };
  }
  if (quotaFull(limits, checks.site, now)) return siteQuotaRefusal(limits, SITE_BUCKETS.email, now);
  return null;
}
export function spendEmailQuota(limits: LimitsService, checks: { recipient: LimitCheck; site: LimitCheck }): void {
  limits.hit(checks.recipient);
  limits.hit(checks.site);
}

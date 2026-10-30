import bcrypt from "bcryptjs";
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { normalizeRealName } from "../../lib/account-profiles.js";
import { revokeAccountCredentials } from "../../lib/account-revoke.js";
import { CODE_TTL_MS, RESEND_AFTER_S, normalizeEmail, type CheckResult } from "../../lib/email-login.js";
import { gatedReturn } from "../../lib/email-gate.js";
import { enrollmentYearFor, isSelectableGrade, type SelectableGrade } from "../../lib/grade.js";
import type { LoginCodePurpose } from "../../lib/mail/login-code.js";
import { PASSWORD_MIN_LENGTH, createLoginThrottle, hashPassword, passwordError } from "../../lib/password-policy.js";
import { registrationGuardFor, registrationLimitedBody } from "../../lib/register-limits.js";
import { safeReturnTo } from "../../lib/safe-return.js";
import { rateLimited } from "../../middleware/http-policy.js";
import { setSessionCookie } from "../../middleware/require-auth.js";
import { attachVisitorId } from "../../middleware/visitor.js";

/**
 * 邮箱登录（#262，所有者 2026-10-23 决定验证码和密码都支持；#274 邀请码改选填，SPEC §3.2）：
 * - `POST /auth/email/start`：发 6 位验证码。不论邮箱有没有账号响应都一样（202 + 挑战 cookie），没有账号的邮箱也真的发。
 * - `POST /auth/email/verify`：核对验证码后登录；没有账号时不填邀请码就注册成注册用户，填了且有效注册成成员，
 *   填了但无效回 `invite_invalid` 并记一次失败（验证码不作废，还可以再试）。只在真的要新建账号这一步，
 *   同一 IP 今天已建满 5 个、同一设备已建满 3 个（lib/register-limits.ts）回 429 `auth.register.daily`，
 *   登录到已有账号不受影响（#274 SPEC §3.8）。新注册时必须带真实姓名和年级（#280），缺了或不合格回 400
 *   `real_info_required` / `bad_real_name`，验证码和邀请码都不作废，填好再提交一次。
 * - `POST /auth/email/password`：邮箱加密码登录。密码在账号页设（至少 8 位）；没账号、没设密码、密码不对一律回同一个错误。
 * - `POST /auth/email/reset`（#273，忘了密码）：用 `/auth/email/start` 发的验证码（`purpose: "reset"` 只改信的文字，
 *   挑战还是登录用的那一种）核对邮箱，设新密码并登录。不能注册：邮箱没有账号回 `no_account`，验证码不作废。
 * 成功都写 `sid` 并回 `{ return_to }`，前端整页跳转；账号缺姓名或年级时 `return_to` 先指向补资料页（lib/email-gate.ts）。
 */
export const CHALLENGE_COOKIE = "email_challenge";
/** 没有账号时也跑一次 bcrypt，响应时间不随邮箱是否注册变化（cost 与 lib/password-policy.ts 的 12 相同）；第一次用到时才算。 */
let dummyHash: Promise<string> | null = null;
const dummy = () => (dummyHash ??= bcrypt.hash("yzgc-no-such-account", 12));

/** 挑战 cookie：签名、HttpOnly、10 分钟；登录用 path=/auth/email，绑定用 path=/api/identity/email。 */
export function setChallengeCookie(reply: FastifyReply, id: string, path: string): void {
  const { cookieDomain, cookieSecure } = reply.server.services.config;
  reply.setCookie(CHALLENGE_COOKIE, id, { signed: true, httpOnly: true, secure: cookieSecure, sameSite: "lax", path, domain: cookieDomain, maxAge: CODE_TTL_MS / 1000 });
}
export function readChallengeCookie(req: FastifyRequest): string | null {
  const raw = req.cookies?.[CHALLENGE_COOKIE];
  if (!raw || raw.length > 512) return null;
  const signed = req.unsignCookie(raw);
  return signed.valid && signed.value ? signed.value : null;
}
export function clearChallengeCookie(reply: FastifyReply, path: string): void {
  reply.clearCookie(CHALLENGE_COOKIE, { path, domain: reply.server.services.config.cookieDomain });
}

/**
 * 发验证码信：不等发信就回响应（`void`），投递结果只记日志（发信商、错误码），不记地址和验证码。
 * 验证码原文只在这里交给发信模块，不落库、不进日志。
 */
export function sendCode(req: FastifyRequest, to: string, code: string, purpose: LoginCodePurpose, challengeId: string): void {
  const { mail } = req.server.services;
  const letter = mail.loginCodeLetter(code, purpose, CODE_TTL_MS / 60_000);
  void mail.sendNow(to, letter, `yzgc-code-${challengeId}`)
    .then(result => {
      if (result.status === "sent") req.log.info({ provider: result.provider, purpose, requestId: req.id }, "login code sent");
      else req.log.warn({ status: result.status, error: result.error, purpose, requestId: req.id }, "login code not sent");
    })
    .catch(() => req.log.error({ purpose, requestId: req.id }, "login code send crashed"));
}

/** 发码太频繁的 429：与 #191 的 rate_limited 同形，另带 Retry-After 与 `retry_after`（秒），登录页按它倒计时。 */
export function tooSoon(reply: FastifyReply, retryAfter: number): FastifyReply {
  const seconds = Math.max(1, retryAfter);
  return reply.code(429).header("Retry-After", String(seconds)).send({
    error: "rate_limited", message: `发得太频繁了，${seconds} 秒后再试`, retry_after: seconds, request_id: reply.request.id,
  });
}

export default async function emailRoutes(app: FastifyInstance) {
  const { config, emailLogin, identity } = app.services;
  const throttle = createLoginThrottle();
  const fallback = `${config.publicOrigin}/console`;
  /**
   * 验证码核对不过：验证码登录和重设密码回同样的错误。400 不经 middleware/http-policy.ts 的 403/429 通用记录
   * 钩子，这里自己记一条 auth.signin_failed（#274 review round 1，SPEC §3.7「auth.* 的失败」），meta 只留
   * 种类，不留邮箱和验证码。
   */
  const codeFailure = (req: FastifyRequest, reply: FastifyReply, checked: Exclude<CheckResult, { ok: true }>) => {
    app.services.activity.recordActivity(req, { action: "auth.signin_failed", surface: "portal", outcome: "denied", meta: { provider: "email", method: "code", reason: checked.error } });
    return checked.error === "invalid_code"
      ? reply.code(400).send({ error: "invalid_code", message: `验证码不对，还可以试 ${checked.attemptsLeft} 次`, attempts_left: checked.attemptsLeft })
      : reply.code(400).send({ error: "code_expired", message: "验证码已失效，请重新获取" });
  };
  /** 账号停用：三种邮箱登录回同样的 403（#274：组织门槛去掉后，「不是成员」不会再是登录失败的原因）。 */
  const refused = (reply: FastifyReply) => reply.code(403).send({ error: "account_disabled", message: "这个极客班账号已停用" });

  app.post<{ Body: { email: string; return_to?: string; purpose?: "signin" | "reset" } }>(
    "/auth/email/start",
    { config: { rateLimit: { max: 10, timeWindow: "1 minute" } } },
    async (req, reply) => {
      const email = normalizeEmail(req.body.email);
      if (!email) return reply.code(400).send({ error: "bad_email", message: "邮箱格式不对" });
      const returnTo = safeReturnTo(req.body.return_to, config, fallback);
      const started = emailLogin.start({ purpose: "signin", email, ip: req.ip, replaces: readChallengeCookie(req), returnTo });
      if (!started.ok) return tooSoon(reply, started.retryAfter);
      sendCode(req, email, started.code, req.body.purpose === "reset" ? "reset" : "signin", started.id);
      setChallengeCookie(reply, started.id, "/auth/email");
      return reply.code(202).send({ resend_after: RESEND_AFTER_S });
    },
  );

  app.post<{ Body: { code: string; invite_code?: string; real_name?: string; grade?: SelectableGrade } }>(
    "/auth/email/verify",
    { config: { rateLimit: { max: 30, timeWindow: "1 minute" } } },
    async (req, reply) => {
      const id = readChallengeCookie(req);
      const checked = emailLogin.check(id, req.body.code, "signin");
      if (!checked.ok) return codeFailure(req, reply, checked);
      const { challenge } = checked;
      // 这个邮箱还没有账号、这一步会注册：填了邀请码（会成为成员）就要姓名和年级（#280，所有者 2026-10-24 22:05 只拦成员）；
      // 不填邀请码可以不填这两项，填了就一起校验。验证码已经核对过本人，回这个错误不会泄露邮箱有没有注册
      let realInfo: { name: string; enrollmentYear: number } | null = null;
      const wantsMember = Boolean(req.body.invite_code?.trim());
      const givesRealInfo = req.body.real_name !== undefined || req.body.grade !== undefined;
      if (identity.passwordFor(challenge.email) === null && (wantsMember || givesRealInfo)) {
        if (req.body.real_name === undefined || !isSelectableGrade(req.body.grade)) {
          return reply.code(400).send({ error: "real_info_required", message: wantsMember ? "填了邀请码要同时填姓名和年级" : "姓名和年级要一起填" });
        }
        const name = normalizeRealName(req.body.real_name);
        if (!name) return reply.code(400).send({ error: "bad_real_name", message: "姓名填 2 到 32 个字，只能是文字、空格和「·」" });
        realInfo = { name, enrollmentYear: enrollmentYearFor(req.body.grade, app.services.clock()) };
      }
      await attachVisitorId(req, reply);
      const registrationLimit = registrationGuardFor(app.services.limits, req.ip, req.visitorId!);
      const result = identity.signInWithEmailCode({
        email: challenge.email, invite: req.body.invite_code?.trim() || null,
        previousSid: req.cookies?.sid ?? null, ip: req.ip, claim: () => emailLogin.claim(challenge.id), registrationLimit,
      });
      if (!result.ok) {
        switch (result.reason) {
          case "invite_invalid": {
            const left = emailLogin.penalize(challenge.id);
            app.services.activity.recordActivity(req, { action: "auth.signin_failed", surface: "portal", outcome: "denied", meta: { provider: "email", method: "code", reason: "invite_invalid" } });
            return reply.code(400).send({ error: "invite_invalid", message: left > 0 ? `邀请码无效，还可以试 ${left} 次` : "邀请码无效，验证码已失效，请重新获取", attempts_left: left });
          }
          case "account_disabled":
            // #274 item I：这条分支以前只靠 identity-store.ts 内部的 deps.audit() 记一条 auth.signin_denied，
            // 那条内部调用现在删掉了（和路由这边的 recordActivity 是同一个事件，不该记两遍），这里补上。
            app.services.activity.recordActivity(req, { action: "auth.signin_denied", surface: "portal", outcome: "denied", meta: { provider: "email", method: "code", reason: "account_disabled" }, account_id: result.accountId ?? null });
            return refused(reply);
          case "registration_limited": {
            const { retryAfter, body } = registrationLimitedBody(app.services.limits, Date.now());
            return reply.code(429).header("Retry-After", String(retryAfter)).send(body);
          }
          default:
            return reply.code(400).send({ error: "code_expired", message: "验证码已失效，请重新获取" });
        }
      }
      if (result.registered && realInfo) app.services.profiles.setRealInfo(result.accountId, realInfo.name, realInfo.enrollmentYear);
      clearChallengeCookie(reply, "/auth/email");
      setSessionCookie(reply, result.sid);
      app.services.activity.recordActivity(req, { action: result.registered ? "auth.register" : "auth.signin", surface: "portal", outcome: "ok", meta: { provider: "email", method: "code" }, account_id: result.accountId });
      return { return_to: gatedReturn(app.services, config.publicOrigin, result.accountId, challenge.return_to ?? fallback), registered: result.registered };
    },
  );

  app.post<{ Body: { email: string; password: string; return_to?: string } }>(
    "/auth/email/password",
    { config: { rateLimit: { max: 10, timeWindow: "1 minute" } } },
    async (req, reply) => {
      const wrong = () => reply.code(400).send({ error: "invalid_credentials", message: "邮箱或密码不对" });
      const email = normalizeEmail(req.body.email);
      if (!email) return wrong();
      // 按邮箱另计次数（15 分钟 10 次），在按 IP 的限流之外：换 IP 也不能对一个邮箱无限猜
      if (!throttle.take(email)) throw rateLimited();
      const record = identity.passwordFor(email);
      const matched = await bcrypt.compare(req.body.password, record?.hash ?? await dummy());
      if (!record?.hash || !matched) {
        app.services.activity.recordActivity(req, { action: "auth.signin_failed", surface: "portal", outcome: "denied", meta: { provider: "email", method: "password", reason: "invalid_credentials" } });
        return wrong();
      }
      const result = identity.signInWithPassword({ email, previousSid: req.cookies?.sid ?? null, ip: req.ip });
      // 密码登录不建号（register: false），没成功只会是账号停用（#274 item I：补一条 recordActivity，理由同上面验证码分支）
      if (!result.ok) {
        app.services.activity.recordActivity(req, { action: "auth.signin_denied", surface: "portal", outcome: "denied", meta: { provider: "email", method: "password", reason: "account_disabled" }, account_id: result.accountId ?? null });
        return refused(reply);
      }
      throttle.reset(email);
      setSessionCookie(reply, result.sid);
      app.services.activity.recordActivity(req, { action: "auth.signin", surface: "portal", outcome: "ok", meta: { provider: "email", method: "password" }, account_id: result.accountId });
      return { return_to: gatedReturn(app.services, config.publicOrigin, result.accountId, safeReturnTo(req.body.return_to, config, fallback)) };
    },
  );

  app.post<{ Body: { code: string; password: string } }>(
    "/auth/email/reset",
    { config: { rateLimit: { max: 10, timeWindow: "1 minute" } } },
    async (req, reply) => {
      // 先看新密码合不合规：不合规不碰验证码，免得白白用掉一次尝试
      const invalid = passwordError(req.body.password);
      if (invalid) {
        return reply.code(400).send({ error: invalid, message: invalid === "password_too_short" ? `密码至少 ${PASSWORD_MIN_LENGTH} 位` : "密码太长了（不能超过 72 个字节）" });
      }
      const checked = emailLogin.check(readChallengeCookie(req), req.body.code, "signin");
      if (!checked.ok) return codeFailure(req, reply, checked);
      const { challenge } = checked;
      const hash = await hashPassword(req.body.password);
      const result = identity.resetPassword({
        email: challenge.email, hash, previousSid: req.cookies?.sid ?? null, ip: req.ip, claim: () => emailLogin.claim(challenge.id),
        // 旧会话、命令行令牌与对外授权一律作废，只留这次刚签发的一条（PENTEST-20261029 finding 14；#332）。和新密码、验证码占用在同一个事务里。
        afterWrite: (accountId, sid) => revokeAccountCredentials(app.services, req, accountId, sid),
      });
      if (!result.ok) {
        switch (result.reason) {
          case "no_account":
            app.services.activity.recordActivity(req, { action: "auth.password_reset_failed", surface: "portal", outcome: "denied", meta: { provider: "email", reason: "no_account" } });
            return reply.code(400).send({ error: "no_account", message: "这个邮箱还没有极客班账号" });
          case "account_disabled":
            // #274 item I：理由同上面两处——identity-store.ts 内部那条 deps.audit() 删掉了，这里补上。
            app.services.activity.recordActivity(req, { action: "auth.signin_denied", surface: "portal", outcome: "denied", meta: { provider: "email", reason: "account_disabled" }, account_id: result.accountId ?? null });
            return refused(reply);
          default:
            return reply.code(400).send({ error: "code_expired", message: "验证码已失效，请重新获取" });
        }
      }
      // 新密码已经生效：这个邮箱之前猜错的次数清零
      throttle.reset(challenge.email);
      clearChallengeCookie(reply, "/auth/email");
      setSessionCookie(reply, result.sid);
      app.services.activity.recordActivity(req, { action: "auth.password_reset", surface: "portal", outcome: "ok", meta: { provider: "email" }, account_id: result.accountId });
      return { return_to: gatedReturn(app.services, config.publicOrigin, result.accountId, challenge.return_to ?? fallback) };
    },
  );
}

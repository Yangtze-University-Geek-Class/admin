import bcrypt from "bcryptjs";
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { RESEND_AFTER_S, normalizeEmail } from "../../lib/email-login.js";
import { PASSWORD_MIN_LENGTH, hashPassword, passwordError } from "../../lib/password-policy.js";
import { sessionFingerprint } from "../../middleware/oauth-state.js";
import { requireAuth } from "../../middleware/require-auth.js";
import { EMAILS_MAX } from "../../lib/identity-store.js";
import { clearChallengeCookie, readChallengeCookie, sendCode, setChallengeCookie, tooSoon } from "./email.js";
import { loginProviders } from "./providers.js";
import { emailRequired, profileRequired } from "../../lib/email-gate.js";
import { emailQuotaChecks, emailQuotaRefusal, spendEmailQuota } from "../../lib/site-quota.js";
import { normalizeRealName } from "../../lib/account-profiles.js";
import { enrollmentYearFor, type SelectableGrade } from "../../lib/grade.js";
import { revokeAccountCredentials } from "../../lib/account-revoke.js";

/** 绑定邮箱、设密码前要求这次登录不超过 10 分钟（规格「重新验证」）；超时回 403 step_up_required，不是退出。 */
export const STEP_UP_MS = 10 * 60_000;
const CHALLENGE_PATH = "/api/identity/email";

/**
 * 账号页 `/account` 的接口（#262）：任何有效会话都能用，不要 `console.access`。
 * - `GET /api/identity/me`：登录方式、有没有密码、成员资格、这次登录、最近账号记录；`email_required`：还要先绑邮箱（#273）；
 *   `real_name`、`grade`、`grade_label`、`profile_required`：本人的姓名和年级，缺了要先补（#280）。
 * - `POST /api/identity/email/start`、`/verify`：给账号绑定邮箱（绑好才能用邮箱验证码或密码登录）。一个账号最多绑 `EMAILS_MAX` 个，
 *   第一个是主邮箱；GitLab 同步把它们都加到 GitLab 用户名下，按提交里的邮箱认人（#272）。
 * - `POST /api/identity/email/remove`：删掉一个不是主邮箱的邮箱，同样要求 10 分钟内刚登录过。
 * - `POST /api/identity/password`：设置或修改密码（至少 8 位）。已有密码时要填当前密码，或者 10 分钟内刚登录过
 *   （忘了密码就用验证码登录后直接设新的）；还没有密码时要 10 分钟内刚登录过。
 * - `POST /api/identity/real-info`（#280）：补资料页提交真实姓名和年级。只能在缺资料时由本人提交，只补缺的那一项；
 *   两项都有了回 409，之后要改找有 `users.manage` 的管理员在控制台改（防止为了比赛按年级加分去改年级）。
 */
export default async function accountRoutes(app: FastifyInstance) {
  const { emailLogin, identity, mail, google, profiles } = app.services;
  const writes = { preHandler: requireAuth, config: { rateLimit: { max: 10, timeWindow: "1 minute" } } };

  // geek 命令行的令牌不是一次登录（middleware/bearer-auth.ts），永远不算刚登录过
  const fresh = (req: FastifyRequest) => req.via !== "cli" && Date.now() - req.session!.created_at <= STEP_UP_MS;
  const emailExists = (reply: FastifyReply) => reply.code(409).send({ error: "identity_exists", message: "这个邮箱已经绑在你的账号上了" });
  const emailLimit = (reply: FastifyReply) => reply.code(409).send({ error: "email_limit", message: `一个账号最多绑 ${EMAILS_MAX} 个邮箱，先删掉一个再加` });
  const stepUp = (reply: FastifyReply) => reply.code(403).send({
    error: "step_up_required", message: "这一步要求刚登录过，请重新登录后再试", reauth: { return_to: "/account" },
  });

  const realInfoView = (accountId: string) => {
    const real = profiles.realInfo(accountId);
    return { real_name: real.real_name, grade: real.grade, grade_label: real.grade_label, profile_required: profileRequired(app.services, accountId) };
  };

  app.get("/api/identity/me", { preHandler: requireAuth }, async (req) => {
    const session = req.session!;
    const view = identity.accountView(session.account_id);
    // `available`：账号页上现在就能绑定的方式。只有邮箱，没到上限就还能再加；GitHub 没有绑定接口；Google 的绑定接口（POST /api/identity/link，#291）
    // 目前只有官网资料窗口在用，账号页还没有入口，所以不列出来
    const available = loginProviders({ mailEnabled: mail.sendingEnabled, googleEnabled: google.enabled })
      .map(provider => provider.id).filter((id): id is "email" => id === "email" && identity.emailAddRefusal(session.account_id) === null);
    return {
      account_id: session.account_id,
      ...view,
      available,
      email_required: emailRequired(app.services, session.account_id),
      ...realInfoView(session.account_id),
      session: { provider: session.provider, created_at: session.created_at, expires_at: session.expires_at, step_up_until: session.created_at + STEP_UP_MS },
    };
  });

  app.post<{ Body: { email: string } }>("/api/identity/email/start", writes, async (req, reply) => {
    const session = req.session!;
    const email = normalizeEmail(req.body.email);
    if (!email) return reply.code(400).send({ error: "bad_email", message: "邮箱格式不对" });
    if (!fresh(req)) return stepUp(reply);
    const refusal = identity.emailAddRefusal(session.account_id, email);
    if (refusal) return refusal === "identity_exists" ? emailExists(reply) : emailLimit(reply);
    // 绑定邮箱也要发码，和登录用同一套发码上限（#319、#333）
    const quota = emailQuotaChecks(email, app.services.config.quotas);
    const refused = emailQuotaRefusal(app.services.limits, quota, app.services.clock());
    if (refused) return reply.code(429).header("Retry-After", String(refused.retryAfter)).send(refused.body);
    const started = emailLogin.start({ purpose: "link", email, ip: req.ip, replaces: readChallengeCookie(req), accountId: session.account_id, sessionHash: sessionFingerprint(session.id) });
    if (!started.ok) return tooSoon(reply, started.retryAfter);
    spendEmailQuota(app.services.limits, quota);
    sendCode(req, email, started.code, "link", started.id);
    setChallengeCookie(reply, started.id, CHALLENGE_PATH);
    return reply.code(202).send({ resend_after: RESEND_AFTER_S });
  });

  app.post<{ Body: { code: string } }>("/api/identity/email/verify", writes, async (req, reply) => {
    const session = req.session!;
    const expired = () => reply.code(400).send({ error: "code_expired", message: "验证码已失效，请重新获取" });
    const checked = emailLogin.check(readChallengeCookie(req), req.body.code, "link");
    if (!checked.ok) {
      return checked.error === "invalid_code"
        ? reply.code(400).send({ error: "invalid_code", message: `验证码不对，还可以试 ${checked.attemptsLeft} 次`, attempts_left: checked.attemptsLeft })
        : expired();
    }
    const { challenge } = checked;
    // 只认发起绑定的那个会话：换了账号或重新登录过，这个验证码就不算数
    if (challenge.account_id !== session.account_id || challenge.session_hash !== sessionFingerprint(session.id)) return expired();
    const result = identity.linkEmail({ accountId: session.account_id, email: challenge.email, login: session.login, ip: req.ip, claim: () => emailLogin.claim(challenge.id) });
    if (!result.ok) {
      if (result.reason === "code_expired") return expired();
      if (result.reason === "email_limit") return emailLimit(reply);
      if (result.reason === "identity_exists") return emailExists(reply);
      return reply.code(409).send({ error: "identity_conflict", message: "这个邮箱已经绑定了别的极客班账号" });
    }
    clearChallengeCookie(reply, CHALLENGE_PATH);
    // #274 review round 1（SPEC §3.7「auth.* 的绑定、解绑」）：只记种类，不记邮箱本身。
    app.services.activity.recordActivity(req, { action: "auth.email_link", surface: "portal", outcome: "ok" });
    return { ok: true };
  });

  app.post<{ Body: { identity_id: string } }>("/api/identity/email/remove", writes, async (req, reply) => {
    const session = req.session!;
    if (!fresh(req)) return stepUp(reply);
    const result = identity.unlinkEmail({ accountId: session.account_id, identityId: req.body.identity_id, login: session.login, ip: req.ip });
    if (!result.ok) {
      return result.reason === "primary_email"
        ? reply.code(409).send({ error: "primary_email", message: "主邮箱用来收验证码和通知，不能删" })
        : reply.code(404).send({ error: "not_found", message: "这个邮箱已经不在你的账号上了" });
    }
    app.services.activity.recordActivity(req, { action: "auth.email_unlink", surface: "portal", outcome: "ok" });
    return { ok: true };
  });

  app.post<{ Body: { password: string; current_password?: string } }>("/api/identity/password", writes, async (req, reply) => {
    const session = req.session!;
    const view = identity.accountView(session.account_id);
    if (!view.identities.some(item => item.provider === "email")) {
      return reply.code(409).send({ error: "email_required", message: "密码登录用邮箱作账号，先绑定邮箱再设密码" });
    }
    const invalid = passwordError(req.body.password);
    if (invalid) {
      return reply.code(400).send({ error: invalid, message: invalid === "password_too_short" ? `密码至少 ${PASSWORD_MIN_LENGTH} 位` : "密码太长了（不能超过 72 个字节）" });
    }
    const hadPassword = identity.passwordHashOf(session.account_id) !== null;
    if (!fresh(req)) {
      const hash = identity.passwordHashOf(session.account_id);
      const given = req.body.current_password;
      if (!hash || typeof given !== "string" || !given) return stepUp(reply);
      if (!(await bcrypt.compare(given, hash))) {
        app.services.activity.recordActivity(req, { action: "auth.password_change_failed", surface: "portal", outcome: "denied", meta: { reason: "invalid_credentials" } });
        return reply.code(400).send({ error: "invalid_credentials", message: "当前密码不对" });
      }
    }
    // 先算哈希（几百毫秒），算完再确认这次会话还在：期间被登出/被吊销的请求不该继续写密码（CodeRabbit 复审）
    const nextHash = await hashPassword(req.body.password);
    if (!app.services.auth.getSession(session.id)) return reply.code(401).send({ error: "not_signed_in", message: "请先登录" });
    // 改密码后其它会话作废，只留当前这次（PENTEST-20261029 finding 14）；不这么做，盗号者手里的 sid 还能继续用。
    // 命令行令牌和对外授权一并吊销（#332）。吊销和密码写入在同一个事务里（见 lib/account-revoke.ts）：任何一步失败整体回滚。
    identity.setPassword(session.account_id, nextHash, { login: session.login, ip: req.ip }, () => {
      revokeAccountCredentials(app.services, req, session.account_id, session.id);
    });
    app.services.activity.recordActivity(req, { action: hadPassword ? "auth.password_change" : "auth.password_set", surface: "portal", outcome: "ok" });
    return { ok: true };
  });

  app.post<{ Body: { real_name: string; grade: SelectableGrade } }>("/api/identity/real-info", writes, async (req, reply) => {
    const accountId = req.session!.account_id;
    const current = profiles.realInfo(accountId);
    if (current.real_name && current.grade !== null) {
      return reply.code(409).send({ error: "real_info_locked", message: "姓名和年级已经填过了，要改请找管理员" });
    }
    const realName = normalizeRealName(req.body.real_name);
    if (!realName) return reply.code(400).send({ error: "bad_real_name", message: "姓名填 2 到 32 个字，只能是文字、空格和「·」" });
    profiles.setRealInfo(accountId, current.real_name ?? realName, current.grade === null ? enrollmentYearFor(req.body.grade, app.services.clock()) : current.enrollment_year);
    // 只记年级和补了哪几项，不记姓名
    const filled = [...(current.real_name ? [] : ["real_name"]), ...(current.grade === null ? ["grade"] : [])];
    const view = realInfoView(accountId);
    app.services.activity.recordActivity(req, { action: "account.real_info", surface: "portal", outcome: "ok", meta: { filled, grade: view.grade } });
    return view;
  });
}

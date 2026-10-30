import { randomBytes } from "node:crypto";
import type { FastifyInstance } from "fastify";
import { normalizeEmail } from "../../lib/email-login.js";
import { normalizeInviteCode } from "../../lib/invite-codes.js";
import { registrationGuardFor } from "../../lib/register-limits.js";
import { loadSession } from "../../lib/session.js";
import { linkResultUrl, safeReturnTo, signinFailureUrl, type SigninOutcome } from "../../lib/safe-return.js";
import { gatedReturn } from "../../lib/email-gate.js";
import { readOAuthState, sessionFingerprint, setOAuthState } from "../../middleware/oauth-state.js";
import { requireAuth, setSessionCookie } from "../../middleware/require-auth.js";
import { attachVisitorId } from "../../middleware/visitor.js";
import { STEP_UP_MS } from "./account.js";

/**
 * Google 登录（#262，ADR-0005「Google 登录」；#274 邀请码改选填，SPEC §3.2）：`GET /auth/google` 生成 state、nonce
 * 与 PKCE，存进签名 cookie 后跳 Google；`GET /auth/google/callback` 换 token、验 ID Token、按 Google 的 `sub` 登录。
 * 没有账号时不填 `/auth/google?invite=` 就注册成注册用户，填了且有效注册成成员，填了但无效回登录页
 * `signin=invite_invalid&provider=google`（不建号，还能重新发起）。
 * 绑定（#291）：`POST /api/identity/link { provider: "google" }` 只给已登录、且这次登录不超过 10 分钟的人，把「这是绑定、绑给哪个账号、哪个会话」
 * 写进同一个签名 cookie（kind 为 google-link）再返回 Google 的授权地址；回调看到 google-link 时不登录、不建号、不换会话，
 * 核对当前会话还是发起绑定的那个，再把 Google 的 `sub` 绑到这个账号上，结果用 `?link=<结果>&provider=google` 带回发起时的页面（默认 `/account`）。
 * 没配 GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET 时这几个接口都回 404 provider_not_enabled，登录页也不出现 Google。
 */
export default async function googleRoutes(app: FastifyInstance) {
  const { config, google, identity } = app.services;
  const fallback = `${config.publicOrigin}/console`;

  // 限流按 IP：回调里会试邀请码、会用我们的密钥去 Google 换 token，不能让人反复刷
  app.get<{ Querystring: { return_to?: string; invite?: string } }>("/auth/google", { config: { rateLimit: { max: 20, timeWindow: "1 minute" } } }, async (req, reply) => {
    if (!google.enabled) return reply.code(404).send({ error: "provider_not_enabled", message: "本站没有启用 Google 登录" });
    const state = randomBytes(16).toString("base64url");
    const nonce = randomBytes(16).toString("base64url");
    const verifier = randomBytes(32).toString("base64url");
    const invite = normalizeInviteCode(req.query.invite) ?? undefined;
    const returnTo = safeReturnTo(req.query.return_to, config, fallback);
    setOAuthState(reply, config, "google_oauth_state", { state, kind: "google-signin", returnTo, nonce, verifier, ...(invite ? { invite } : {}) });
    return reply.redirect(google.authorizeUrl({ state, nonce, verifier }));
  });

  // 绑定不走 GET：别的页面带着已登录的浏览器跳过来也发起不了；要求刚登录过，和绑定邮箱同一条规则（账号被盗用时不能悄悄多绑一个登录方式）。
  // 限流按账号：限流键读 req.session，所以挂在 preHandler（要排在 requireAuth 之后），见 middleware/require-permission.ts 的说明
  app.post<{ Body: { provider: "google"; return_to?: string } }>("/api/identity/link", {
    preHandler: requireAuth,
    config: { rateLimit: { max: 10, timeWindow: "1 minute", keyGenerator: req => req.session!.account_id, hook: "preHandler" } },
  }, async (req, reply) => {
    if (!google.enabled) return reply.code(404).send({ error: "provider_not_enabled", message: "本站没有启用 Google 登录" });
    const session = req.session!;
    if (req.via === "cli" || Date.now() - session.created_at > STEP_UP_MS) {
      return reply.code(403).send({ error: "step_up_required", message: "这一步要求刚登录过，请重新登录后再试", reauth: { return_to: "/account" } });
    }
    if (identity.hasGoogle(session.account_id)) return reply.code(409).send({ error: "identity_exists", message: "你的账号已经绑定了 Google" });
    const state = randomBytes(16).toString("base64url");
    const nonce = randomBytes(16).toString("base64url");
    const verifier = randomBytes(32).toString("base64url");
    const returnTo = safeReturnTo(req.body.return_to, config, `${config.publicOrigin}/account`);
    setOAuthState(reply, config, "google_oauth_state", {
      state, kind: "google-link", returnTo, nonce, verifier, accountId: session.account_id, sessionHash: sessionFingerprint(session.id),
    });
    return { authorize_url: google.authorizeUrl({ state, nonce, verifier }) };
  });

  app.get<{ Querystring: { code?: string; state?: string; error?: string } }>("/auth/google/callback", { config: { rateLimit: { max: 10, timeWindow: "1 minute" } } }, async (req, reply) => {
    if (!google.enabled) return reply.code(404).send({ error: "provider_not_enabled", message: "本站没有启用 Google 登录" });
    const { code, state, error } = req.query;
    // 同 /auth/callback：重复参数是数组，先收敛类型再读（PENTEST-20261029 finding 31）
    if (typeof state !== "string" || (code !== undefined && typeof code !== "string") || (error !== undefined && typeof error !== "string")) {
      return reply.code(400).send({ error: "invalid_state" });
    }
    if (!state || (!code && !error)) return reply.code(400).send({ error: "missing_params" });
    const flow = readOAuthState(req, reply, "google_oauth_state", state);
    if (!flow) return reply.code(400).send({ error: "invalid_state" });
    const linking = flow.kind === "google-link";
    const back = safeReturnTo(flow.returnTo, config, linking ? `${config.publicOrigin}/account` : fallback);
    // 绑定失败留在发起时的页面和原来的账号里，登录失败才回统一登录页
    const fail = (outcome: SigninOutcome) => linking
      ? reply.redirect(linkResultUrl(back, "google", outcome === "cancelled" ? "cancelled" : "failed"))
      : reply.redirect(signinFailureUrl(config.publicOrigin, back, outcome, { provider: "google" }));
    if (error || !code) return fail(error === "access_denied" ? "cancelled" : "failed");
    const claims = await google.exchange(code, flow.verifier!)
      .then(idToken => google.verifyIdToken(idToken, flow.nonce!))
      .catch((cause: { code?: string; status?: number; upstream?: string }) => {
        req.log.error({ code: cause?.code, status: cause?.status, upstream: cause?.upstream, requestId: req.id }, "google sign-in failed");
        return null;
      });
    if (!claims) return fail("failed");
    if (linking) {
      // 只认发起绑定的那个会话：换了账号、重新登录过或会话过期，这次授权作废，不绑
      if (!loadSession(req) || req.session!.account_id !== flow.accountId || sessionFingerprint(req.session!.id) !== flow.sessionHash) {
        return reply.redirect(linkResultUrl(back, "google", "failed"));
      }
      let linked;
      try {
        linked = identity.linkGoogle({ accountId: flow.accountId!, sub: claims.sub, email: claims.email ? normalizeEmail(claims.email) : null, login: req.session!.login, ip: req.ip });
      } catch (cause) {
        req.log.error({ code: (cause as { code?: string })?.code ?? "link_transaction_failed", requestId: req.id }, "google link failed");
        return fail("failed");
      }
      if (!linked.ok) return reply.redirect(linkResultUrl(back, "google", linked.reason === "identity_conflict" ? "conflict" : "exists"));
      // 只记种类，不记 Google 的 sub 和邮箱
      app.services.activity.recordActivity(req, { action: "auth.link", surface: "portal", outcome: "ok", meta: { provider: "google" }, account_id: flow.accountId });
      return reply.redirect(linkResultUrl(back, "google", "linked"));
    }
    let result;
    try {
      await attachVisitorId(req, reply);
      const registrationLimit = registrationGuardFor(app.services.limits, req.ip, req.visitorId!);
      result = identity.signInWithGoogle({
        sub: claims.sub, email: claims.email ? normalizeEmail(claims.email) : null, invite: flow.invite ?? null,
        previousSid: req.cookies?.sid ?? null, ip: req.ip, registrationLimit,
      });
    } catch (cause) {
      req.log.error({ code: (cause as { code?: string })?.code ?? "signin_transaction_failed", requestId: req.id }, "google sign-in transaction failed");
      return fail("failed");
    }
    if (!result.ok) {
      app.services.activity.recordActivity(req, { action: "auth.signin_denied", surface: "portal", outcome: "denied", meta: { provider: "google", reason: result.reason }, account_id: result.accountId ?? null });
      return fail(result.reason === "code_expired" ? "failed" : result.reason);
    }
    setSessionCookie(reply, result.sid);
    app.services.activity.recordActivity(req, { action: result.registered ? "auth.register" : "auth.signin", surface: "portal", outcome: "ok", meta: { provider: "google" }, account_id: result.accountId });
    // 账号还没有登录邮箱（#273，Google 给的邮箱不算登录邮箱）或者缺姓名、年级（#280）：先到对应的页面，办好再回 return_to
    return reply.redirect(gatedReturn(app.services, config.publicOrigin, result.accountId, back));
  });
}

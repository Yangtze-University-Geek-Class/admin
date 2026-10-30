import { safeReturnTo, signinFailureUrl, type SigninOutcome } from "../../lib/safe-return.js";
import { emailRequired, gatedReturn, profileRequired } from "../../lib/email-gate.js";
import { normalizeInviteCode } from "../../lib/invite-codes.js";
import { applyQuota } from "../../lib/apply-quota.js";
import { registrationGuardFor } from "../../lib/register-limits.js";
import { UI_NODES } from "../../lib/permission-nodes.js";
import { randomBytes } from "node:crypto";
import type { FastifyInstance, FastifyRequest } from "fastify";
import { readOAuthState, setOAuthState } from "../../middleware/oauth-state.js";
import { clearSessionCookies, setSessionCookie } from "../../middleware/require-auth.js";
import { attachVisitorId, hasVisitorCookie } from "../../middleware/visitor.js";

export default async function authRoutes(app: FastifyInstance) {
  const { buildAuthorizeUrl,
  destroySession,
  exchangeCode,
  fetchAuthenticatedUser,
  getSession,
  revokeGrant, } = app.services.auth;
  const { config, identity } = app.services;
  /** 被拒的 GitHub 登录尽力撤销这次授权：服务端不存他的 token，也不该让这份授权一直挂在他的账号里。 */
  const revoke = (req: FastifyRequest, token: string) => revokeGrant(token).catch((cause: { code?: string; status?: number }) => {
    req.log.warn({ code: cause?.code, status: cause?.status, requestId: req.id }, "github grant revoke failed");
  });

  /**
   * 换 token、查用户。#274：不再查 GitHub 组织资格——组织那道门已经去掉（SPEC §3.2），邀请码和邮箱、Google 一样选填。
   * 只在真的要新建账号这一步，同一 IP 今天已建满 5 个、同一设备已建满 3 个（lib/register-limits.ts）回
   * `registration_limited`，登录到已有账号不受影响（#274 残留修复，SPEC §3.8）。
   */
  async function signInWithGitHub(code: string) {
    const token = await exchangeCode(code);
    const user = await fetchAuthenticatedUser(token);
    return { token, user };
  }
  // #274 review round 1（SPEC §3.8）：按 IP 限流，和 /auth/google 一样——回调里会试邀请码、会建新账号，不能让人反复刷。
  app.get<{ Querystring: { return_to?: string; invite?: string } }>("/auth/github", { config: { rateLimit: { max: 20, timeWindow: "1 minute" } } }, async (req, reply) => {
    const state = randomBytes(16).toString("base64url");
    const returnTo = safeReturnTo(req.query.return_to, config, `${config.publicOrigin}/console`);
    const invite = normalizeInviteCode(req.query.invite) ?? undefined;
    setOAuthState(reply, config, "oauth_state", { state, kind: "admin", returnTo, ...(invite ? { invite } : {}) });
    return reply.redirect(buildAuthorizeUrl(state));
  });

  app.get<{ Querystring: { code?: string; state?: string; error?: string } }>(
    "/auth/callback",
    async (req, reply) => {
      const { code, state, error } = req.query;
      // 重复的查询参数会解析成数组，不先收敛类型的话 state.startsWith 会抛 500（PENTEST-20261029 finding 31）
      if (typeof state !== "string" || (code !== undefined && typeof code !== "string") || (error !== undefined && typeof error !== "string")) {
        return reply.code(400).send({ error: "invalid_state" });
      }
      if (!state || (!code && !error)) return reply.code(400).send({ error: "missing_params" });
      if (state.startsWith("forum-")) return reply.code(410).send({ error: "legacy_forum_retired" });
      const flow = readOAuthState(req, reply, "oauth_state", state);
      if (!flow) {
        return reply.code(400).send({ error: "invalid_state" });
      }
      // 从这里起不停在接口的错误页：成功就带着 sid 回到 return_to，没成功回到统一登录页并带上原因与原来的 return_to。
      const back = safeReturnTo(flow.returnTo, config, `${config.publicOrigin}/console`);
      const fail = (outcome: SigninOutcome) => reply.redirect(signinFailureUrl(config.publicOrigin, back, outcome));
      if (error || !code) return fail(error === "access_denied" ? "cancelled" : "failed");
      const result = await signInWithGitHub(code).catch((cause: { code?: string; status?: number }) => {
        req.log.error({ code: cause?.code, status: cause?.status, requestId: req.id }, "github sign-in failed");
        return null;
      });
      if (!result) return fail("failed");
      const { token, user } = result;
      const account = { id: user.id, login: user.login, avatarUrl: user.avatar_url || null };
      // 外部请求到此做完；建号（邀请码选填）、认领、插入会话、删旧会话、审计在一个事务里（lib/identity-store.ts），失败整体回滚。
      let signin;
      try {
        const hadCookie = hasVisitorCookie(req);
        await attachVisitorId(req, reply);
        const registrationLimit = registrationGuardFor(app.services.limits, req.ip, req.visitorId!, { cookie: hadCookie, quotas: app.services.config.quotas });
        signin = identity.signInWithGithub({ github: account, accessToken: token, invite: flow.invite ?? null, previousSid: req.cookies?.sid ?? null, ip: req.ip, registrationLimit });
      } catch (cause) {
        req.log.error({ code: (cause as { code?: string })?.code ?? "signin_transaction_failed", requestId: req.id }, "sign-in transaction failed");
        return fail("failed");
      }
      if (!signin.ok) {
        await revoke(req, token);
        // #274 review round 1（SPEC §3.7/§3.8）：registration_limited 是注册限额挡下来的，记 limited，不是普通的 denied。
        app.services.activity.recordActivity(req, {
          action: "auth.signin_denied", surface: "portal", outcome: signin.reason === "registration_limited" ? "limited" : "denied",
          meta: { provider: "github", reason: signin.reason }, account_id: signin.accountId ?? null,
        });
        return fail(signin.reason);
      }
      setSessionCookie(reply, signin.sid);
      app.services.activity.recordActivity(req, {
        action: signin.registered ? "auth.register" : "auth.signin", surface: "portal", outcome: "ok",
        meta: { provider: "github" }, account_id: signin.accountId,
      });
      // 账号还没有登录邮箱（#273）或者缺姓名、年级（#280）：先到对应的页面，办好再回 return_to
      return reply.redirect(gatedReturn(app.services, config.publicOrigin, signin.accountId, back));
    }
  );

  app.post("/auth/signout", async (req, reply) => {
    const sid = req.cookies?.sid;
    if (sid) {
      const s = getSession(sid);
      destroySession(sid);
      if (s) {
        identity.recordSignout(s.account_id, s.provider);
        app.services.activity.recordActivity(req, { action: "auth.signout", surface: "portal", outcome: "ok", account_id: s.account_id });
      }
    }
    clearSessionCookies(reply);
    return { ok: true };
  });

  /** `level.registered` → `registered`：CONTRACT-274 §1 的 `level` 不带 `level.` 前缀。 */
  const bareLevel = (level: string) => level.replace(/^level\./, "");

  /**
   * CONTRACT-274 §1 的 `identities`：`{ emails: [打码], google: 是否绑定, github: 登录名 | null }`。
   * `identity.accountView()` 的 identities 数组已经按 lib/email-login.ts 的 maskEmail 处理过邮箱，不重复脱敏。
   */
  function identitySummary(identities: { provider: "github" | "email" | "google"; label: string }[]) {
    return {
      emails: identities.filter(item => item.provider === "email").map(item => item.label),
      google: identities.some(item => item.provider === "google"),
      github: identities.find(item => item.provider === "github")?.label ?? null,
    };
  }

  /**
   * 访客身份摘要（CONTRACT-274 §1）：没登录也回 200（不是 401），给 `level`/`level_name`、`permissions`
   * （UI_NODES 里访客实际放行的那些，CONTRACT 要求是节点名数组，不是逐个布尔值的表）、`quota`（目前只有投递每日额度）。
   */
  function visitorIdentity() {
    const { permissions, limits } = app.services;
    const groups = permissions.groupsOf(null);
    return {
      level: bareLevel(groups.level), level_name: groups.level_name,
      permissions: UI_NODES.filter(node => permissions.check(null, node)),
      quota: applyQuota({ permissions, limits }, null, Date.now()),
    };
  }

  /**
   * `email_required`（#273）：账号还没有登录邮箱、这个环境又能发信，官网、论坛、控制台读到 true 就跳到绑定邮箱页。
   * `profile_required`（#280）：缺真实姓名或年级，读到 true 就跳到补资料页。`real_name` 只回给本人（这个接口
   * 只回当前会话自己的资料）；`grade` 是 1–4 或 `graduated`，`grade_label` 是「大一」…「已毕业」，没填时都是 null。
   *
   * #274 review round 1（CONTRACT-274 §1，blocker）：`console_link` 改成直接查新权限引擎的 `console.access`
   * 节点。原来这里走 `access.resolve()`（旧能力系统），GitHub 会话第一次用到时会借会话自带的令牌实时查一次
   * GitHub 组织角色，查到的结果又会回写站内角色——任何 GitHub 组织管理员只要调用过一次 `/auth/me`，不填邀请码
   * 也能被悄悄提升为成员甚至站长，绕开邀请码制度；这个洞已经在 lib/access.ts 堵上（resolve() 不再查 GitHub），
   * 这里跟着改成不调用 access.resolve、不调用 GitHub，`session_expired` 这个分支也一起去掉——它原来专门服务于
   * access.resolve 里那次 GitHub API 调用失败的识别，这类调用在 /auth/me 里已经不存在了；真的调 GitHub（登录
   * 本身）出错仍由 middleware/http-policy.ts 的通用兜底处理，不受这次改动影响。
   * 登录了在旧字段基础上加 `level`/`level_name`/`department`/`titles`（lib/permissions.ts 的 groupsOf）、
   * `permissions`/`quota`、账号资料的 `prefs`/`username`/`display_name`/`bio`，`avatar_url` 是统一头像（lib/avatars.ts，#343：
   * 上传的、GitHub 的、NANO 默认头像），以及打码邮箱与绑定渠道的 `identities`。
   */
  app.get("/auth/me", async (req) => {
    const sid = req.cookies?.sid;
    if (!sid) return { signed_in: false, ...visitorIdentity() };
    const s = getSession(sid);
    if (!s) return { signed_in: false, ...visitorIdentity() };
    const { permissions, limits, profiles, identity } = app.services;
    const groups = permissions.groupsOf(s.account_id);
    const profile = profiles.get(s.account_id);
    const real = profiles.realInfo(s.account_id);
    // account_id：极客班账号（官网、论坛、控制台读到的是同一个值）；provider：这次的登录方式。user_id 仍是 GitHub 数字 id。
    return {
      signed_in: true, login: s.login, user_id: s.user_id, avatar_url: app.services.avatars.urlOf(s.account_id),
      account_id: s.account_id, provider: s.provider, console_link: permissions.check(s.account_id, "console.access"),
      email_required: emailRequired(app.services, s.account_id), profile_required: profileRequired(app.services, s.account_id),
      real_name: real.real_name, grade: real.grade, grade_label: real.grade_label,
      level: bareLevel(groups.level), level_name: groups.level_name, department: groups.department, titles: groups.titles,
      permissions: UI_NODES.filter(node => permissions.check(s.account_id, node)),
      quota: applyQuota({ permissions, limits }, s.account_id, Date.now()),
      prefs: profile.prefs, username: profile.username, display_name: profile.display_name, bio: profile.bio,
      identities: identitySummary(identity.accountView(s.account_id).identities),
    };
  });
}

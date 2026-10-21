import { safeReturnTo } from "../../lib/safe-return.js";
import { randomBytes } from "node:crypto";
import type { FastifyInstance, FastifyRequest } from "fastify";
import { readOAuthState, setOAuthState } from "../../middleware/oauth-state.js";
import { clearSessionCookies, endRejectedSession, isRejectedToken } from "../../middleware/require-auth.js";
import type { Capability } from "../../lib/roles.js";

/** 普通舰员、领航员默认就有的能力：只有这些时不在头像菜单里显示「控制台」。 */
const CONSOLE_LINK_IGNORED: ReadonlySet<Capability> = new Set<Capability>(["console.access", "github.org.read", "feedback.read"]);

/** 登录没成功的原因，写进统一登录页地址的 `signin` 参数，由登录页（app/console/src/pages/SignIn.vue）给出说明。 */
export type SigninOutcome = "not_member" | "invite_pending" | "cancelled" | "failed" | "account_disabled";

/**
 * 登录没成功时回到统一登录页（#262）：`/signin?signin=<原因>&return_to=<原来要回的本站路径>`。
 * 三端的「登录」都从这个页面出发，失败也回到这里说清原因、可以直接换一种方式重试；登录页会再按同源校验 return_to。
 */
function signinFailureUrl(publicOrigin: string, back: string, outcome: SigninOutcome): string {
  const target = new URL(back);
  target.searchParams.delete("signin");
  const url = new URL("/signin", publicOrigin);
  url.searchParams.set("signin", outcome);
  url.searchParams.set("return_to", `${target.pathname}${target.search}${target.hash}`);
  return url.toString();
}

export default async function authRoutes(app: FastifyInstance) {
  const { buildAuthorizeUrl,
  destroySession,
  exchangeCode,
  fetchAuthenticatedUser,
  getSession,
  revokeGrant, } = app.services.auth;
  const { audit } = app.services.storage;
  const { config, github, identity } = app.services;
  /** 被拒的 GitHub 登录尽力撤销这次授权：服务端不存他的 token，也不该让这份授权一直挂在他的账号里。 */
  const revoke = (req: FastifyRequest, token: string) => revokeGrant(token).catch((cause: { code?: string; status?: number }) => {
    req.log.warn({ code: cause?.code, status: cause?.status, requestId: req.id }, "github grant revoke failed");
  });

  async function signInWithGitHub(code: string) {
    const token = await exchangeCode(code);
    const user = await fetchAuthenticatedUser(token);
    const membership = await github.getOwnMembership(token, config.consoleOrg);
    return { token, user, membership };
  }
  app.get("/auth/github", async (req, reply) => {
    const state = randomBytes(16).toString("base64url");
    const returnTo = safeReturnTo((req.query as { return_to?: string }).return_to, config, `${config.publicOrigin}/console`);
    setOAuthState(reply, config, "oauth_state", { state, kind: "admin", returnTo });
    return reply.redirect(buildAuthorizeUrl(state));
  });

  app.get<{ Querystring: { code?: string; state?: string; error?: string } }>(
    "/auth/callback",
    async (req, reply) => {
      const { code, state, error } = req.query;
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
      const { token, user, membership } = result;
      const account = { id: user.id, login: user.login, avatarUrl: user.avatar_url || null };
      // 只有极客班 GitHub 组织的正式成员能登录。不是成员（包括邀请还没接受）不建号、不建会话，照旧可以不登录浏览。
      if (membership !== "active") {
        identity.recordGithubDenied({ github: account, reason: membership ?? "not_member", ip: req.ip });
        await revoke(req, token);
        return fail(membership === "pending" ? "invite_pending" : "not_member");
      }
      // 外部请求到此做完；建号、认领、插入会话、删旧会话、审计在一个事务里（lib/identity-store.ts），失败整体回滚。
      let signin;
      try {
        signin = identity.signInWithGithub({ github: account, accessToken: token, previousSid: req.cookies?.sid ?? null, ip: req.ip });
      } catch (cause) {
        req.log.error({ code: (cause as { code?: string })?.code ?? "signin_transaction_failed", requestId: req.id }, "sign-in transaction failed");
        return fail("failed");
      }
      if (!signin.ok) {
        await revoke(req, token);
        return fail(signin.reason);
      }
      reply.setCookie("sid", signin.sid, {
        httpOnly: true, secure: config.cookieSecure, sameSite: "lax", path: "/", maxAge: 7 * 24 * 60 * 60,
        domain: config.cookieDomain,
      });
      return reply.redirect(back);
    }
  );

  app.post("/auth/signout", async (req, reply) => {
    const sid = req.cookies?.sid;
    if (sid) {
      const s = getSession(sid);
      destroySession(sid);
      if (s) {
        audit(null, { login: s.login, account_id: s.account_id }, "auth.signout", undefined, undefined, req.ip);
        identity.recordSignout(s.account_id, s.provider);
      }
    }
    clearSessionCookies(reply);
    return { ok: true };
  });

  /**
   * `console_link`：官网与论坛的头像菜单是否显示「控制台」。持有 console.access、github.org.read、feedback.read
   * 之外的任意能力才算管理者（提督、舰长、队长、带部门权限包的舰员）；普通舰员和领航员为 false。
   * 这只决定显不显示入口，控制台的准入仍按能力判定。GitHub 角色查询失败时按 false 处理，不让 /auth/me 失败；
   * 只有 GitHub 拒绝了会话里的令牌时例外：会话已经没用，结束它并回 `{ signed_in: false, session_expired: true }`（#164）。
   */
  app.get("/auth/me", async (req, reply) => {
    const sid = req.cookies?.sid;
    if (!sid) return { signed_in: false };
    const s = getSession(sid);
    if (!s) return { signed_in: false };
    const consoleLink = await app.services.access.resolve({ login: s.login, userId: s.user_id, accountId: s.account_id, accessToken: s.accessToken })
      .then(access => [...access.capabilities].some(capability => !CONSOLE_LINK_IGNORED.has(capability)))
      .catch((cause: { code?: string; status?: number }) => {
        if (isRejectedToken(cause)) return null;
        req.log.warn({ code: cause?.code, status: cause?.status, requestId: req.id }, "console link access check failed");
        return false;
      });
    if (consoleLink === null) {
      endRejectedSession(req, reply, s);
      return { signed_in: false, session_expired: true };
    }
    // account_id：极客班账号（官网、论坛、控制台读到的是同一个值）；provider：这次的登录方式。user_id 仍是 GitHub 数字 id。
    return { signed_in: true, login: s.login, user_id: s.user_id, avatar_url: s.avatar_url, account_id: s.account_id, provider: s.provider, console_link: consoleLink };
  });
}

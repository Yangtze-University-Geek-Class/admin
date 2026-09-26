import { safeReturnTo } from "../../lib/safe-return.js";
import { randomBytes } from "node:crypto";
import type { FastifyInstance } from "fastify";
import { readOAuthState, setOAuthState } from "../../middleware/oauth-state.js";
import type { Capability } from "../../lib/roles.js";

/** 普通舰员、领航员默认就有的能力：只有这些时不在头像菜单里显示「控制台」。 */
const CONSOLE_LINK_IGNORED: ReadonlySet<Capability> = new Set<Capability>(["console.access", "github.org.read", "feedback.read"]);

/** 登录没成功的原因，写进回跳地址的 `signin` 参数，由回到的页面（论坛、控制台登录页）给出说明。 */
export type SigninOutcome = "not_member" | "invite_pending" | "cancelled" | "failed";

function withSigninOutcome(target: string, outcome: SigninOutcome): string {
  const url = new URL(target);
  url.searchParams.set("signin", outcome);
  return url.toString();
}

export default async function authRoutes(app: FastifyInstance) {
  const { buildAuthorizeUrl,
  createSession,
  destroySession,
  exchangeCode,
  fetchAuthenticatedUser,
  getSession,
  revokeGrant, } = app.services.auth;
  const { audit } = app.services.storage;
  const { config, github } = app.services;

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
      // 从这里起一律回到发起登录的页面：成功就带着 sid 回去，没成功也回去并带上原因，不停在接口的错误页。
      const back = safeReturnTo(flow.returnTo, config, `${config.publicOrigin}/console`);
      if (error || !code) return reply.redirect(withSigninOutcome(back, error === "access_denied" ? "cancelled" : "failed"));
      const result = await signInWithGitHub(code).catch((cause: { code?: string; status?: number }) => {
        req.log.error({ code: cause?.code, status: cause?.status, requestId: req.id }, "github sign-in failed");
        return null;
      });
      if (!result) return reply.redirect(withSigninOutcome(back, "failed"));
      const { token, user, membership } = result;
      // 只有极客班 GitHub 组织的正式成员能登录。不是成员（包括邀请还没接受）不建会话，照旧可以不登录浏览。
      if (membership !== "active") {
        audit(null, user.login, "auth.signin_denied", user.login, { org: config.consoleOrg, reason: membership ?? "not_member" }, req.ip);
        await revokeGrant(token).catch((cause: { code?: string; status?: number }) => {
          req.log.warn({ code: cause?.code, status: cause?.status, requestId: req.id }, "github grant revoke failed");
        });
        return reply.redirect(withSigninOutcome(back, membership === "pending" ? "invite_pending" : "not_member"));
      }
      const sid = createSession(user.login, user.id, user.avatar_url, token);
      audit(null, user.login, "auth.signin", user.login, undefined, req.ip);
      reply.setCookie("sid", sid, {
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
      if (s) audit(null, s.login, "auth.signout", undefined, undefined, req.ip);
    }
    reply.clearCookie("sid", { path: "/", domain: config.cookieDomain });
    reply.clearCookie("forum_sid", { path: "/", domain: config.cookieDomain });
    return { ok: true };
  });

  /**
   * `console_link`：官网与论坛的头像菜单是否显示「控制台」。持有 console.access、github.org.read、feedback.read
   * 之外的任意能力才算管理者（提督、舰长、队长、带部门权限包的舰员）；普通舰员和领航员为 false。
   * 这只决定显不显示入口，控制台的准入仍按能力判定。GitHub 角色查询失败时按 false 处理，不让 /auth/me 失败。
   */
  app.get("/auth/me", async (req) => {
    const sid = req.cookies?.sid;
    if (!sid) return { signed_in: false };
    const s = getSession(sid);
    if (!s) return { signed_in: false };
    const consoleLink = await app.services.access.resolve({ login: s.login, userId: s.user_id, accessToken: s.accessToken })
      .then(access => [...access.capabilities].some(capability => !CONSOLE_LINK_IGNORED.has(capability)))
      .catch((cause: { code?: string; status?: number }) => {
        req.log.warn({ code: cause?.code, status: cause?.status, requestId: req.id }, "console link access check failed");
        return false;
      });
    return { signed_in: true, login: s.login, user_id: s.user_id, avatar_url: s.avatar_url, console_link: consoleLink };
  });
}

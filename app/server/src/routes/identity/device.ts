import type { FastifyInstance } from "fastify";
import { publicProfile } from "../../lib/public-profile.js";
import {
  DEVICE_CLIENTS, DEVICE_CODE_TTL_MS, DEVICE_GRANT_TYPE,
  displayUserCode, normalizeScope, type DeviceClientId,
} from "../../lib/device-store.js";
import { emailRequired, gateRefusal, gateRefusalBody, profileRequired } from "../../lib/email-gate.js";
import { SITE_BUCKETS, siteCheck, siteQuotaRefusal } from "../../lib/site-quota.js";
import { requireAuth } from "../../middleware/require-auth.js";
import { requirePermission } from "../../middleware/require-permission.js";

type CodeBody = { client_id?: string; scope?: string };
type TokenBody = { grant_type?: string; device_code?: string; client_id?: string };
type ApproveBody = { user_code?: string; decision?: "approve" | "deny" };

/** RFC 6749 §5.2 / RFC 8628 §3.5 的错误体：只回 error 与说明，不回内部状态。 */
const oauthError = (error: string, description?: string) => (description ? { error, error_description: description } : { error });

/**
 * 设备授权（#262，为 `geek login` 预留）：/auth/device/code 与 /auth/device/token 按 RFC 8628 给命令行用，
 * /api/identity/device* 是浏览器里的确认页（要极客班 SSO 会话）。授权绑定到会话的 account_id，不是 GitHub id。
 */
export default async function deviceRoutes(app: FastifyInstance) {
  const { device, config } = app.services;

  // RFC 8628 的请求是 application/x-www-form-urlencoded（JSON 也收，方便调试与测试）：
  // 只在这个插件作用域里解析，不影响其它路由；不引入 formbody 依赖。
  app.addContentTypeParser("application/x-www-form-urlencoded", { parseAs: "string" }, (_req, body, done) => {
    try {
      done(null, Object.fromEntries(new URLSearchParams(body as string)));
    } catch (cause) {
      done(cause as Error);
    }
  });

  app.post<{ Body: CodeBody }>(
    "/auth/device/code",
    { config: { rateLimit: { max: 10, timeWindow: "1 minute" } } },
    async (req, reply) => {
      const body = req.body ?? {};
      const clientId = typeof body.client_id === "string" ? body.client_id : "";
      if (!DEVICE_CLIENTS[clientId as DeviceClientId]) return reply.code(400).send(oauthError("invalid_client", "未登记的客户端"));
      const scope = normalizeScope(clientId, typeof body.scope === "string" ? body.scope : undefined);
      if (!scope) return reply.code(400).send(oauthError("invalid_scope", "不支持的 scope"));
      // 全站每个北京日的设备授权码上限（#333）：超了不发码，用 site_quota_exceeded 说明原因
      const quota = app.services.limits.hit(siteCheck(SITE_BUCKETS.deviceCode, config.quotas.siteDeviceCode));
      if (!quota.ok) {
        const refused = siteQuotaRefusal(app.services.limits, SITE_BUCKETS.deviceCode, app.services.clock());
        return reply.code(429).header("Retry-After", String(refused.retryAfter)).send(refused.body);
      }
      const grant = device.createGrant({ clientId, scope });
      // verification_uri 跟随环境的唯一 origin，不写死域名。
      const verificationUri = `${config.publicOrigin}/device`;
      reply.header("Cache-Control", "no-store");
      return {
        device_code: grant.deviceCode,
        user_code: displayUserCode(grant.userCode),
        verification_uri: verificationUri,
        verification_uri_complete: `${verificationUri}?user_code=${encodeURIComponent(displayUserCode(grant.userCode))}`,
        expires_in: DEVICE_CODE_TTL_MS / 1000,
        interval: grant.interval,
      };
    },
  );

  app.post<{ Body: TokenBody }>(
    "/auth/device/token",
    { config: { rateLimit: { max: 60, timeWindow: "1 minute" } } },
    async (req, reply) => {
      const body = req.body ?? {};
      if (body.grant_type !== DEVICE_GRANT_TYPE) {
        return reply.code(400).send(oauthError("unsupported_grant_type", `grant_type 必须是 ${DEVICE_GRANT_TYPE}`));
      }
      const result = device.poll({
        deviceCode: typeof body.device_code === "string" ? body.device_code : undefined,
        clientId: typeof body.client_id === "string" ? body.client_id : undefined,
      });
      reply.header("Cache-Control", "no-store");
      if (result.kind === "error") {
        const descriptions: Record<typeof result.error, string> = {
          invalid_grant: "device_code 无效或已使用",
          invalid_client: "client_id 与发码时不一致",
          expired_token: "device_code 已过期",
          access_denied: "用户拒绝了这次授权",
          authorization_pending: "用户还没有确认",
          slow_down: "轮询过快，请按 interval 等待",
        };
        return reply.code(400).send(oauthError(result.error, descriptions[result.error]));
      }
      return {
        access_token: result.accessToken,
        token_type: "Bearer",
        expires_in: result.expiresIn,
        scope: result.scope,
        account_id: result.accountId,
      };
    },
  );

  app.get<{ Querystring: { user_code?: string } }>(
    "/api/identity/device",
    // RFC 8628 §5.1：user_code 空间有限，查询也限流，挂不上穷举。
    { preHandler: requireAuth, config: { rateLimit: { max: 30, timeWindow: "1 minute" } } },
    async (req, reply) => {
      const view = device.describe(req.query.user_code);
      if (!view) return reply.code(404).send({ error: "device_code_not_found" });
      return view;
    },
  );

  app.post<{ Body: ApproveBody }>(
    "/api/identity/device/approve",
    // #274 SPEC §3.2：命令行登录按权限节点 account.cli.login 判定（注册用户起步就有，不再是「登录就行」的隐性放行）。
    // preHandler 只挂 requirePermission（它自己调 loadSession 判定登录态），不再多挂一个 requireAuth——两个一起
    // 挂时 requireAuth 先跑、先回它自己的 401 not_signed_in，没登录时拿不到 requirePermission 回的通用 401
    // unauthenticated（#274 item I 的 extras c，和 portal/apply.ts 同一个 bug）。
    { preHandler: [requirePermission("account.cli.login")], config: { rateLimit: { max: 20, timeWindow: "1 minute" } } },
    async (req, reply) => {
      const session = req.session!;
      const body = req.body ?? {};
      const decision = body.decision === "approve" || body.decision === "deny" ? body.decision : null;
      if (!decision) return reply.code(400).send({ error: "invalid_decision" });
      // 还没有登录邮箱（#273）或者缺姓名、年级（#280）的账号：先办好再允许；拒绝不拦
      const refusal = decision === "approve" ? gateRefusal(app.services, session.account_id) : null;
      if (refusal) return reply.code(403).send(gateRefusalBody(refusal, "确认命令行的登录"));
      // 命令行设备码另加每个账号每天 20 次（SPEC §3.8），沿用现有的每分钟 20 次路由限流；只数真的确认登录的
      // （approve），拒绝（deny）不占这个额度。
      if (decision === "approve") {
        const cliDaily = app.services.limits.hit({ bucket: "account.cli.login.daily", subject: session.account_id, window: "day-bj", max: 20 });
        if (!cliDaily.ok) {
          return reply.code(429).header("Retry-After", String(cliDaily.retry_after)).send({
            error: "rate_limited", bucket: "account.cli.login.daily", message: "今天命令行登录次数太多了，明天再试", retry_after: cliDaily.retry_after,
          });
        }
      }
      const result = device.decide({ userCode: body.user_code, accountId: session.account_id, decision });
      if (!result) return reply.code(404).send({ error: "device_code_not_found" });
      if (!result.ok) return reply.code(409).send({ error: "device_code_not_pending" });
      // 操作记录只留客户端与 scope，不留 device_code 与令牌（它们是凭据）。
      app.services.activity.recordActivity(req, {
        action: decision === "approve" ? "identity.device.approve" : "identity.device.deny", surface: "cli",
        outcome: decision === "approve" ? "ok" : "denied", meta: { client_id: result.clientId, scope: result.scope },
      });
      return { ok: true, status: decision === "approve" ? "approved" : "denied" };
    },
  );

  app.get("/auth/device/userinfo", async (req, reply) => {
    const authorization = req.headers.authorization ?? "";
    const token = authorization.startsWith("Bearer ") ? authorization.slice("Bearer ".length).trim() : "";
    const identity = device.authenticate(token);
    if (!identity) {
      reply.header("WWW-Authenticate", 'Bearer error="invalid_token"');
      return reply.code(401).send({ error: "invalid_token" });
    }
    // 年级给命令行展示身份用；真实姓名不在这里（#277 的硬约束：命令行拿不到任何账号的真实姓名，
    // 哪怕是本人——account-profiles.ts 的注释也只把这一项许给本人浏览器会话和有 users.manage 的管理员）。
    const { grade, grade_label } = app.services.profiles.realInfo(identity.accountId);
    // 头像是统一头像（lib/avatars.ts，#343），和网页上看到的同一张
    const profile = publicProfile(app.services.profiles.get(identity.accountId), { login: identity.login, avatarUrl: app.services.avatars.urlOf(identity.accountId) });
    return {
      sub: identity.accountId,
      account_id: identity.accountId,
      login: identity.login,
      ...profile,
      scope: identity.scope,
      grade,
      grade_label,
      // 命令行读到 true 就提示先到网页上绑邮箱、补姓名和年级（#280），补齐前不做别的操作
      email_required: emailRequired(app.services, identity.accountId),
      profile_required: profileRequired(app.services, identity.accountId),
    };
  });

  /**
   * `geek logout`（#277）：撤销这个令牌，之后同一个令牌再调任何接口都回 401。按 RFC 7009 的惯例，令牌
   * 本来就无效或已经撤销过也回 200——撤销接口不用来探测一个令牌是否存在过。中间件已经按同一个
   * Authorization 头把身份挂到了 req.session（见 middleware/bearer-auth.ts），这里只需要再读一次 token
   * 本身去撤销；真的撤掉了才记一条操作记录，省得空撤销把表灌满。
   */
  app.post("/auth/device/revoke", { config: { rateLimit: { max: 30, timeWindow: "1 minute" } } }, async (req, reply) => {
    const authorization = req.headers.authorization ?? "";
    const token = authorization.startsWith("Bearer ") ? authorization.slice("Bearer ".length).trim() : "";
    const revoked = device.revoke(token);
    reply.header("Cache-Control", "no-store");
    if (revoked) app.services.activity.recordActivity(req, { action: "identity.device.revoke", surface: "cli", outcome: "ok" });
    return { ok: true };
  });
}

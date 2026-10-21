import type { FastifyInstance } from "fastify";
import {
  DEVICE_CLIENTS, DEVICE_CODE_TTL_MS, DEVICE_GRANT_TYPE,
  displayUserCode, normalizeScope, type DeviceClientId,
} from "../../lib/device-store.js";
import { requireAuth } from "../../middleware/require-auth.js";

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
  const { device, config, storage } = app.services;

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
    { preHandler: requireAuth, config: { rateLimit: { max: 20, timeWindow: "1 minute" } } },
    async (req, reply) => {
      const session = req.session!;
      const body = req.body ?? {};
      const decision = body.decision === "approve" || body.decision === "deny" ? body.decision : null;
      if (!decision) return reply.code(400).send({ error: "invalid_decision" });
      const result = device.decide({ userCode: body.user_code, accountId: session.account_id, decision });
      if (!result) return reply.code(404).send({ error: "device_code_not_found" });
      if (!result.ok) return reply.code(409).send({ error: "device_code_not_pending" });
      // 审计只留客户端与 scope，不留 device_code 与令牌（它们是凭据）。
      storage.audit(
        null,
        { login: session.login, account_id: session.account_id },
        decision === "approve" ? "identity.device.approve" : "identity.device.deny",
        undefined,
        { client_id: result.clientId, scope: result.scope },
        req.ip,
      );
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
    return {
      sub: identity.accountId,
      account_id: identity.accountId,
      login: identity.login,
      avatar_url: identity.avatarUrl,
      scope: identity.scope,
    };
  });
}

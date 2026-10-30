import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import type { IncomingMessage } from "node:http";
import type Provider from "oidc-provider";
import { gateRefusal, gateRefusalBody, gatedReturn } from "../../lib/email-gate.js";
import { registerContracts } from "../../lib/http-contracts.js";
import { OIDC_SCOPES, SITE_ACCOUNT, oidcErrorPage, type SiteAccountRequest } from "../../lib/oidc-provider.js";
import { loadSession, requireAuth } from "../../middleware/require-auth.js";
import { oidcContracts, oidcProtocolResponse } from "./contracts.js";

/** 授权页（控制台前端包 app/console/src/pages/Authorize.vue）；与 app.ts 的 ADMIN_SPA_PATHS、web 镜像里 nginx 的入口一致。 */
export const AUTHORIZE_PAGE = "/authorize";
/** 下游的服务器调的协议端点：发现文档、公钥、换令牌、撤销、userinfo。浏览器只来 /oidc/auth。 */
const SERVER_ENDPOINT = /^\/oidc\/(?:\.well-known\/openid-configuration|jwks|token(?:\/revocation)?|me)(?:[/?]|$)/;
/** 其中按客户端做 Origin 校验的端点：换令牌、撤销、userinfo。发现文档和公钥不认客户端，没有可枚举的差异。 */
const CLIENT_ENDPOINT = /^\/oidc\/(?:token(?:\/revocation)?|me)(?:[/?]|$)/;
/**
 * 协议端点每个 IP 每分钟的次数，服务器调用和浏览器跳转分开算：GitLab 每次登录要从它自己的服务器调好几次（发现文档、公钥、换令牌、
 * userinfo），一个班同时登录都算在它一个 IP 上，不能和校园网里共用出口的浏览器抢同一份额度。
 */
export const OIDC_PROTOCOL_LIMIT = { server: 600, browser: 120 } as const;

/**
 * 对外授权（#270，ADR-0005 决策 8）：`/oidc/*` 的协议端点原样交给 oidc-provider（发现文档、JWKS、授权、换令牌、userinfo、撤销），
 * 交互由这里接：没登录去 /signin，登录了用 sid 里的账号；账号还没有登录邮箱时先去绑定邮箱页（#273）；要本人同意时去授权页，授权页经下面三个接口读取和提交。
 * 没配 OIDC_JWKS 时路由照样注册（项目地图按源码列出它们），请求一律按 404 处理。
 */
export default async function oidcRoutes(app: FastifyInstance) {
  const { oidc, directory, oidcStore, config } = app.services;
  const provider = oidc?.provider as Provider;
  // 协议端点的回复不经 Fastify 的错误处理器，oidc-provider 内部出错只发这个事件；只记路径、错误类型与错误代码，不记查询串
  provider?.on("server_error", (ctx: { path?: string }, error: Error & { code?: unknown }) => {
    app.log.error({ path: ctx.path, error: error?.name ?? "error", code: typeof error?.code === "string" ? error.code : undefined }, "oidc server error");
  });
  const origin = new URL(config.publicOrigin);
  const enabled = async (_req: FastifyRequest, reply: FastifyReply) => {
    if (!oidc) return reply.callNotFound();
  };

  /**
   * 交给 oidc-provider 之前：按 PUBLIC_ORIGIN 定协议和主机（web 容器的 nginx 会把 X-Forwarded-Proto 改成 http），记下这次的极客班账号。
   * 账号还没有登录邮箱（#273）或者缺姓名、年级（#280）时记成 null：oidc-provider 回到交互，由交互带人去对应的页面；
   * 允许过这个应用、oidc-provider 的会话还在的也一样。
   */
  const prepared = (req: FastifyRequest): IncomingMessage => {
    const raw = req.raw as SiteAccountRequest;
    raw.headers["x-forwarded-proto"] = origin.protocol.slice(0, -1);
    raw.headers["x-forwarded-host"] = origin.host;
    const accountId = req.session?.account_id ?? null;
    raw[SITE_ACCOUNT] = accountId && !gateRefusal(app.services, accountId) ? accountId : null;
    return raw;
  };
  const errorPage = (reply: FastifyReply, code: string, status = 400) =>
    reply.code(status).header("Cache-Control", "no-store").type("text/html; charset=utf-8").send(oidcErrorPage(code));
  const interactionOf = async (req: FastifyRequest, reply: FastifyReply, uid: string) => {
    try {
      const details = await provider.interactionDetails(prepared(req), reply.raw);
      return details.uid === uid ? details : null;
    } catch {
      return null;
    }
  };
  const redirectTo = (req: FastifyRequest, reply: FastifyReply, result: Parameters<Provider["interactionResult"]>[2], merge = true) =>
    provider.interactionResult(prepared(req), reply.raw, result, { mergeWithLastSubmission: merge });

  await app.register(async scope => {
    scope.addHook("onRequest", enabled);
    registerContracts(scope, oidcContracts);

    // 交互入口：oidc-provider 要登录或要本人同意时把浏览器带到这里
    scope.get<{ Params: { uid: string } }>("/oidc/interaction/:uid", { config: { rateLimit: { max: 30, timeWindow: "1 minute" } } }, async (req, reply) => {
      const { uid } = req.params;
      const details = await interactionOf(req, reply, uid);
      if (!details) return errorPage(reply, "session_not_found");
      if (!loadSession(req)) return reply.redirect(`/signin?return_to=${encodeURIComponent(`/oidc/interaction/${uid}`)}`, 303);
      const accountId = req.session!.account_id;
      if (!directory.oidcAccount(accountId)) {
        // 停用的、不是成员的账号：回到应用，告诉它被拒绝了
        return reply.redirect(await redirectTo(req, reply, { error: "access_denied", error_description: "the account is not an active member" }, false), 303);
      }
      // 还没有登录邮箱（#273）或者缺姓名、年级（#280）的账号：先去办好，办好回到这个交互接着走
      const interaction = `/oidc/interaction/${encodeURIComponent(uid)}`;
      if (gateRefusal(app.services, accountId)) return reply.redirect(gatedReturn(app.services, config.publicOrigin, accountId, interaction), 303);
      if (details.prompt.name === "login") {
        if (details.session?.accountId && details.session.accountId !== accountId) {
          // 这个浏览器换了极客班账号：oidc-provider 的会话还是上一个账号的。删掉那份会话再按现在的账号登录，
          // 不走它自带的「先登出」确认页（单点登出没有开）
          await (await provider.Session.findByUid(details.session.uid))?.destroy();
          delete (details as { session?: unknown }).session;
          await details.save(Math.max(1, details.exp - Math.floor(Date.now() / 1000)));
        }
        return reply.redirect(await redirectTo(req, reply, { login: { accountId } }, false), 303);
      }
      if (details.prompt.name === "consent") {
        if (details.session?.accountId !== accountId) return errorPage(reply, "session_not_found");
        return reply.redirect(`${AUTHORIZE_PAGE}?uid=${encodeURIComponent(uid)}`, 303);
      }
      return errorPage(reply, "invalid_request");
    });

    /** 授权页要的：哪个应用、回到哪个主机、要哪些信息、当前账号。交互过期 404；不是要同意的交互、或者换了账号 409。 */
    const consentOf = async (req: FastifyRequest<{ Params: { uid: string } }>, reply: FastifyReply) => {
      const details = await interactionOf(req, reply, req.params.uid);
      if (!details) { void reply.code(404).send({ error: "interaction_expired", message: "这次登录已经过期，回到应用重新点一次登录" }); return null; }
      if (details.prompt.name !== "consent" || details.session?.accountId !== req.session!.account_id) {
        void reply.code(409).send({ error: "interaction_mismatch", message: "当前登录的账号和发起这次登录的不一致，回到应用重新点一次登录" });
        return null;
      }
      return details;
    };

    /** 授权页读详情、点允许之前同样要先有登录邮箱（#273）、姓名和年级（#280）：缺时回 403 email_required 或 profile_required 并返回 true；拒绝不拦。 */
    const refusedByGate = (req: FastifyRequest, reply: FastifyReply) => {
      const refusal = gateRefusal(app.services, req.session!.account_id);
      if (!refusal) return false;
      void reply.code(403).send(gateRefusalBody(refusal, "用极客班账号登录这个应用"));
      return true;
    };

    scope.get<{ Params: { uid: string } }>("/oidc/interaction/:uid/details", { preHandler: requireAuth, config: { rateLimit: { max: 30, timeWindow: "1 minute" } } }, async (req, reply) => {
      if (refusedByGate(req, reply)) return reply;
      const details = await consentOf(req, reply);
      if (!details) return reply;
      const clientId = String(details.params.client_id);
      const client = oidcStore.getClient(clientId);
      const account = directory.oidcAccount(req.session!.account_id);
      if (!client || !account) return reply.code(404).send({ error: "interaction_expired", message: "这次登录已经过期，回到应用重新点一次登录" });
      const requested = String(details.params.scope ?? "").split(" ");
      return {
        client: { id: client.client_id, name: client.name, host: new URL(String(details.params.redirect_uri)).host },
        scopes: OIDC_SCOPES.filter(scope => requested.includes(scope)),
        account: { login: account.login, name: account.name, picture: account.picture },
        expires_at: details.exp * 1000,
      };
    });

    scope.post<{ Params: { uid: string } }>("/oidc/interaction/:uid/confirm", { preHandler: requireAuth, config: { rateLimit: { max: 20, timeWindow: "1 minute" } } }, async (req, reply) => {
      if (refusedByGate(req, reply)) return reply;
      const details = await consentOf(req, reply);
      if (!details) return reply;
      const accountId = req.session!.account_id;
      const clientId = String(details.params.client_id);
      const missing = details.prompt.details as { missingOIDCScope?: string[]; missingOIDCClaims?: string[]; missingResourceScopes?: Record<string, string[]> };
      const grant = (details.grantId ? await provider.Grant.find(details.grantId) : undefined) ?? new provider.Grant({ accountId, clientId });
      if (missing.missingOIDCScope) grant.addOIDCScope(missing.missingOIDCScope.join(" "));
      if (missing.missingOIDCClaims) grant.addOIDCClaims(missing.missingOIDCClaims);
      for (const [resource, scopes] of Object.entries(missing.missingResourceScopes ?? {})) grant.addResourceScope(resource, scopes.join(" "));
      const grantId = await grant.save();
      oidcStore.rememberGrant(accountId, clientId, grantId);
      app.services.activity.recordActivity(req, { action: "oidc.consent", surface: "cli", target_type: "oidc_client", target_id: clientId, outcome: "ok", meta: { scope: grant.getOIDCScope() } });
      return { redirect_to: await redirectTo(req, reply, { consent: { grantId } }) };
    });

    scope.post<{ Params: { uid: string } }>("/oidc/interaction/:uid/abort", { preHandler: requireAuth, config: { rateLimit: { max: 20, timeWindow: "1 minute" } } }, async (req, reply) => {
      const details = await consentOf(req, reply);
      if (!details) return reply;
      const clientId = String(details.params.client_id);
      app.services.activity.recordActivity(req, { action: "oidc.deny", surface: "cli", target_type: "oidc_client", target_id: clientId, outcome: "denied" });
      return { redirect_to: await redirectTo(req, reply, { error: "access_denied", error_description: "End-User aborted interaction" }, false) };
    });
  });

  // 协议端点：请求体由 oidc-provider 自己读，所以这一层去掉 Fastify 的解析器，原始请求流原样交过去。
  // 不接 OPTIONS：下游在服务端换令牌、读 userinfo，不需要浏览器跨域
  await app.register(async scope => {
    scope.addHook("onRequest", enabled);
    scope.removeAllContentTypeParsers();
    scope.addContentTypeParser("*", (_req, _payload, done) => done(null));
    const callback = provider?.callback();
    scope.route({
      method: ["GET", "POST"],
      url: "/oidc/*",
      schema: { response: oidcProtocolResponse },
      config: {
        rateLimit: {
          timeWindow: "1 minute",
          keyGenerator: (req: FastifyRequest) => `${SERVER_ENDPOINT.test(req.url) ? "server" : "browser"}:${req.ip}`,
          max: (_req: FastifyRequest, key: string) => key.startsWith("server:") ? OIDC_PROTOCOL_LIMIT.server : OIDC_PROTOCOL_LIMIT.browser,
        },
      },
      handler(req, reply) {
        /**
         * PENTEST-20261029 finding 25：oidc-provider 的 per-client Origin 校验排在客户端认证之前，
         * 已知 client_id 回 400「origin ... not allowed for client」、未知的回 401 invalid_client，
         * 未认证的人拿它当 client_id 枚举 oracle。带 Origin 的浏览器请求统一挡回同一句 401；
         * 下游服务器换令牌/读 userinfo 不带 Origin，不受影响。
         */
        // 这里不看 Origin 是不是本站：换令牌是下游服务器的事，带 Origin 的一定是浏览器，浏览器本来就用不了这两个端点。
        if (typeof req.headers.origin === "string" && CLIENT_ENDPOINT.test(req.url)) {
          return reply.code(401).header("Cache-Control", "no-store")
            .send({ error: "invalid_client", error_description: "client authentication failed" });
        }
        loadSession(req);
        const raw = prepared(req) as IncomingMessage & { originalUrl?: string };
        raw.originalUrl = req.url;
        raw.url = req.url.slice("/oidc".length) || "/";
        reply.hijack();
        void callback(raw, reply.raw);
      },
    });
  });
}

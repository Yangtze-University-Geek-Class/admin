import { createHmac } from "node:crypto";
import type { IncomingMessage } from "node:http";
import Provider, { interactionPolicy, type Adapter, type Configuration, type JWKS, type KoaContextWithOIDC } from "oidc-provider";
import type { OidcStore } from "./oidc-store.js";
import type { OidcAccount } from "./account-directory.js";

/**
 * 内嵌的 OIDC 授权服务（#270，ADR-0005 决策 8）：oidc-provider 挂在 `/oidc` 下（routes/oidc），签发者是 `<PUBLIC_ORIGIN>/oidc`。
 * 只做授权码 + PKCE S256，不发刷新令牌、不开动态登记和单点登出；`sub` 按 sector 取 oauth_subjects 里的随机值（决策 3）。
 * 登录不另做：没有极客班会话（sid）就去 /signin，有会话就用会话里的账号。
 */

/** oidc-provider 自己的 cookie：和统一登录的 sid 分开命名，一眼认得出是哪一边的。 */
export const OIDC_COOKIE_NAMES = { session: "oidc_session", interaction: "oidc_interaction", resume: "oidc_resume" } as const;
/** 能申请的 scope；`offline_access` 不开（不发刷新令牌）。 */
export const OIDC_SCOPES = ["openid", "profile", "email"] as const;
/** routes/oidc 在把请求交给 oidc-provider 之前，在原始请求上记下这次请求的极客班账号（按 sid，没登录为 null）。 */
export const SITE_ACCOUNT = Symbol("yzgc.siteAccount");
export type SiteAccountRequest = IncomingMessage & { [SITE_ACCOUNT]?: string | null };

/** 各种凭据的有效期（秒）。授权码 10 分钟内一次有效；交互 10 分钟；oidc-provider 的会话与 sid 一样 7 天；本人允许过的授权留 180 天。 */
export const OIDC_TTL = { AccessToken: 60 * 60, AuthorizationCode: 10 * 60, IdToken: 60 * 60, Interaction: 10 * 60, Session: 7 * 24 * 60 * 60, Grant: 180 * 24 * 60 * 60 } as const;

const ERROR_TEXT: Record<string, string> = {
  invalid_client: "这个应用没有在极客班登记，或者已经停用。",
  invalid_redirect_uri: "应用给的回调地址和登记的不一致，这次登录不能继续。",
  invalid_request: "应用发来的登录请求不完整，回到应用重新点一次登录。",
  session_not_found: "这次登录已经过期，回到应用重新点一次登录。",
  access_denied: "这次登录被拒绝了。",
  unauthorized_client: "这个应用不能用这种方式登录。",
  server_error: "服务暂时出了问题，稍后再试一次。",
};

const escapeHtml = (value: string) => value.replace(/[&<>"']/g, ch => `&#${ch.charCodeAt(0)};`);

/** 授权出错时给浏览器看的页面：中文说明加错误代码，不回显请求里的内容。 */
export function oidcErrorPage(error: string): string {
  const code = /^[a-z_]{1,64}$/.test(error) ? error : "server_error";
  const text = ERROR_TEXT[code] ?? "这次登录没有完成，回到应用重新点一次登录。";
  return `<!doctype html>
<html lang="zh-CN">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>登录没有完成 · 长江大学极客班</title>
<style>
body{margin:0;min-height:100vh;display:grid;place-items:center;padding:24px 16px;box-sizing:border-box;background:#f4f5f8;color:#1f2329;font:15px/1.6 -apple-system,BlinkMacSystemFont,"PingFang SC","Microsoft YaHei",sans-serif}
main{max-width:420px;width:100%;padding:28px 24px;border-radius:16px;background:#fff;box-shadow:0 8px 24px rgba(31,35,41,.08)}
h1{margin:0 0 8px;font-size:20px;font-weight:650}
p{margin:0 0 16px;color:#4e5969}
code{font:12px ui-monospace,SFMono-Regular,Menlo,monospace;color:#86909c}
a{display:inline-block;margin-top:4px;color:#3346c8;text-decoration:none;font-weight:600}
</style>
</head>
<body>
<main>
<h1>登录没有完成</h1>
<p>${escapeHtml(text)}</p>
<code>${escapeHtml(code)}</code><br>
<a href="/">回到极客班官网</a>
</main>
</body>
</html>`;
}

export type OidcProviderDeps = {
  issuer: string;
  jwks: JWKS;
  sessionSecret: string;
  store: OidcStore;
  accounts: { oidcAccount(accountId: string): OidcAccount | null };
};

export function createOidcProvider(deps: OidcProviderDeps): Provider {
  // cookie 签名密钥从 SESSION_SECRET 派生，不另设密钥；换 SESSION_SECRET 时这些 cookie 一起作废
  const cookieKey = createHmac("sha256", deps.sessionSecret).update("yzgc-oidc-cookies-v1").digest("base64url");

  const policy = interactionPolicy.base();
  // 极客班会话才是登录状态：oidc-provider 自己的会话只是缓存。sid 没了（退出、过期、被停用）、换了别的账号，
  // 或者账号还没有登录邮箱（routes/oidc 记成 null，#273），都要重新走一次登录交互，交互里再按 sid 决定是谁（routes/oidc）。会话里的账号已经不是成员时 findAccount 查不到，
  // ctx.oidc.account 为空，也回到交互，由交互回 access_denied
  policy.get("login")!.checks.push(new interactionPolicy.Check("site_session", "the site session is missing or belongs to another account", (ctx) => {
    const account = (ctx.req as SiteAccountRequest)[SITE_ACCOUNT];
    return account && account === ctx.oidc.session?.accountId && ctx.oidc.account ? interactionPolicy.Check.NO_NEED_TO_PROMPT : interactionPolicy.Check.REQUEST_PROMPT;
  }));

  const configuration: Configuration = {
    adapter: (name: string) => deps.store.adapterFor(name) as unknown as Adapter,
    clients: [],
    jwks: deps.jwks,
    async findAccount(_ctx, id) {
      const account = deps.accounts.oidcAccount(id);
      if (!account) return undefined;
      return {
        accountId: id,
        async claims() {
          return {
            sub: id,
            name: account.name,
            preferred_username: account.login,
            ...(account.picture ? { picture: account.picture } : {}),
            ...(account.email ? { email: account.email, email_verified: true } : {}),
          };
        },
      };
    },
    claims: { openid: ["sub"], profile: ["name", "preferred_username", "picture"], email: ["email", "email_verified"] },
    scopes: [...OIDC_SCOPES],
    subjectTypes: ["pairwise"],
    async pairwiseIdentifier(_ctx, accountId, client) {
      // 客户端都登记成 pairwise。sector 取库里钉住的值，不用 oidc-provider 按 redirect_uris[0] 现算的：
      // 应用换了回调地址（#335 GitLab 从子域名搬到主站路径），成员的 sub 也不能变
      const sector = deps.store.sectorOf(String(client.clientId));
      if (!sector) throw new Error("client has no sector identifier");
      return deps.store.subjectFor(sector, accountId);
    },
    // 客户端元数据里的 sector_identifier_uri 只是钉住的 sector（oidc-store clientMetadata），没有可取的文档；
    // 客户端只由服务器命令登记，不开动态注册，所以不去取它
    sectorIdentifierUriValidate: () => false,
    pkce: { required: () => true },
    responseTypes: ["code"],
    clientAuthMethods: ["client_secret_basic", "client_secret_post"],
    features: {
      devInteractions: { enabled: false },
      rpInitiatedLogout: { enabled: false },
      registration: { enabled: false },
      introspection: { enabled: false },
      revocation: { enabled: true },
      userinfo: { enabled: true },
    },
    issueRefreshToken: async () => false,
    ttl: { ...OIDC_TTL },
    interactions: { policy, url: (_ctx, interaction) => `/oidc/interaction/${interaction.uid}` },
    cookies: { keys: [cookieKey], names: { ...OIDC_COOKIE_NAMES }, long: { httpOnly: true, sameSite: "lax" }, short: { httpOnly: true, sameSite: "lax" } },
    // 本人在授权页允许过这个应用，就沿用那次的授权：先看这次交互的结果，再看 oidc-provider 会话里的，最后看 oauth_grants 记下的
    async loadExistingGrant(ctx: KoaContextWithOIDC) {
      const accountId = ctx.oidc.session?.accountId;
      const clientId = ctx.oidc.client?.clientId;
      if (!accountId || !clientId) return undefined;
      const grantId = ctx.oidc.result?.consent?.grantId || ctx.oidc.session!.grantIdFor(clientId) || deps.store.rememberedGrant(accountId, clientId);
      if (!grantId) return undefined;
      const grant = await ctx.oidc.provider.Grant.find(grantId);
      return grant && grant.accountId === accountId && grant.clientId === clientId ? grant : undefined;
    },
    async renderError(ctx, out) {
      ctx.type = "html";
      ctx.body = oidcErrorPage(String(out.error ?? "server_error"));
    },
  };

  const provider = new Provider(deps.issuer, configuration);
  // 协议与主机由 routes/oidc 按 PUBLIC_ORIGIN 写进 X-Forwarded-Proto / X-Forwarded-Host，不信客户端带来的
  provider.proxy = true;
  return provider;
}

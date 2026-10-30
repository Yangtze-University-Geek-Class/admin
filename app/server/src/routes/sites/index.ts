import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { loadSession } from "../../lib/session.js";

/**
 * 比赛官网的同域托管（#278，CONTRACT-278 §1）：`/c/<slug>/…` 读已发布版本的文件，`/c/<slug>/~preview/<version_id>/…` 读任一通过校验的版本。
 * 所有响应带 sandbox CSP：页面的来源是 null，读不到主站的 cookie 和存储，只能匿名调同源的 /api/public/*。
 * 对象存储开启（#360）时，在线版本的静态资源（js、css、图片、字体）302 到公开桶 `contest-sites/` 下的地址；HTML 仍由这里回，
 * CSP 的 default-src、style-src、img-src、font-src 各多放行这一个前缀（不放行整个 CDN 域名）。桶里的版本对不上时同源回文件。
 * 不设 cookie，也不回 Set-Cookie。比赛下线、不是内部赛、没发布或文件不存在都是 404。
 * 预览：直接打开 `~preview/<version_id>/` 时检查会话有没有 competition.site.publish（没有也回 404，不暴露版本在不在），
 * 通过后跳到带签名的 `~preview/<version_id>.<到期>.<签名>/`。sandbox 页面里的子资源请求不带 cookie，所以后面的文件靠这段签名放行，一小时后失效。
 * 模块脚本和带 crossorigin 的样式按 CORS 方式请求（来源 null），所以文件响应也带 `Access-Control-Allow-Origin: *`。
 * 已发布版本的 HTML 回 no-cache、其它文件缓存 5 分钟：换版本后资源文件名跟着变，浏览器手里旧的 index.html 会指向已经没有的文件。
 */
/** 对象存储没开启时的 CSP（与 #278 相同）。 */
export const SITE_CSP = "sandbox allow-scripts allow-popups allow-popups-to-escape-sandbox; default-src 'self'; connect-src 'self'; img-src 'self' data:; style-src 'self' 'unsafe-inline'; font-src 'self'; frame-ancestors 'none'";
/** 对象存储开启时：资源前缀（公开地址里 `contest-sites/` 的那一段，来自环境）加进 default-src、img-src、style-src、font-src。 */
export function siteCsp(cdnPrefix: string | null): string {
  if (!cdnPrefix) return SITE_CSP;
  return [
    "sandbox allow-scripts allow-popups allow-popups-to-escape-sandbox",
    `default-src 'self' ${cdnPrefix}`,
    "connect-src 'self'",
    `img-src 'self' data: ${cdnPrefix}`,
    `style-src 'self' 'unsafe-inline' ${cdnPrefix}`,
    `font-src 'self' ${cdnPrefix}`,
    "frame-ancestors 'none'",
  ].join("; ");
}
const PREVIEW_PREFIX = "~preview/";
// 回的是文件或跳转，不是 JSON：Schema 只登记状态码与内容类型（Buffer 与 text/plain 不经过序列化）
const missingPage = { type: "string", description: "text/plain; charset=utf-8：没有这个页面" };
const redirectSchema = { schema: { response: { 301: { type: "string", description: "跳到带 / 的地址" }, 404: missingPage } } };
const fileSchema = {
  schema: {
    response: {
      200: { type: "string", description: "站点文件，Content-Type 按扩展名" },
      301: { type: "string", description: "目录或预览地址补 /" },
      302: { type: "string", description: "预览：换成一小时有效的签名地址" },
      404: missingPage,
    },
  },
};
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

export default async function siteRoutes(app: FastifyInstance) {
  const { competitionSites: sites, competitions, permissions, clock } = app.services;
  const csp = siteCsp(sites.cdnPrefix());

  app.addHook("onSend", async (_req, reply, payload) => {
    reply.header("Content-Security-Policy", csp);
    reply.header("X-Content-Type-Options", "nosniff");
    reply.header("Referrer-Policy", "strict-origin-when-cross-origin");
    reply.header("Access-Control-Allow-Origin", "*");
    reply.removeHeader("set-cookie");
    return payload;
  });

  const missing = (reply: FastifyReply) => reply.code(404).header("Cache-Control", "no-store").type("text/plain; charset=utf-8").send("没有这个页面");

  /** 内部赛、没下线：只有这样的比赛的官网对外可见。 */
  const hostable = (competitionId: string) => {
    const record = competitions.get(competitionId);
    return Boolean(record && !record.offline && record.kind === "internal");
  };

  function serve(reply: FastifyReply, competitionId: string, versionId: string, path: string, cacheControl: (contentType: string) => string) {
    const hit = sites.readSiteFile(competitionId, versionId, path);
    if (hit.kind === "redirect") return reply.header("Cache-Control", "no-store").redirect(hit.location, 301);
    if (hit.kind === "missing") return missing(reply);
    return reply.header("Cache-Control", cacheControl(hit.contentType)).type(hit.contentType).send(hit.data);
  }

  app.get<{ Params: { slug: string } }>("/c/:slug", redirectSchema, async (req, reply) => reply.header("Cache-Control", "no-store").redirect(`/c/${encodeURIComponent(req.params.slug)}/`, 301));

  app.get<{ Params: { slug: string; "*": string } }>("/c/:slug/*", fileSchema, async (req: FastifyRequest<{ Params: { slug: string; "*": string } }>, reply) => {
    const { slug } = req.params;
    const rest = req.params["*"] ?? "";
    if (rest === "~preview" || rest.startsWith(PREVIEW_PREFIX)) {
      const after = rest.slice(PREVIEW_PREFIX.length);
      const slash = after.indexOf("/");
      const segment = slash < 0 ? after : after.slice(0, slash);
      const inner = slash < 0 ? null : after.slice(slash + 1);
      const competitionId = sites.competitionForPreview(slug);
      if (!competitionId || !segment || !competitions.get(competitionId)) return missing(reply);
      if (UUID.test(segment)) {
        if (!loadSession(req) || !permissions.check(req.session!.account_id, "competition.site.publish") || !sites.passedVersion(competitionId, segment)) return missing(reply);
        const token = sites.previewToken(competitionId, segment, clock());
        return reply.header("Cache-Control", "no-store").redirect(`/c/${encodeURIComponent(slug)}/~preview/${token}/${(inner ?? "").split("/").map(encodeURIComponent).join("/")}`, 302);
      }
      const versionId = sites.verifyPreviewToken(competitionId, segment, clock());
      if (!versionId || !sites.passedVersion(competitionId, versionId)) return missing(reply);
      if (inner === null) return reply.header("Cache-Control", "no-store").redirect(`${segment}/`, 301);
      return serve(reply, competitionId, versionId, inner, () => "private, no-store");
    }
    const live = sites.live(slug);
    if (!live || !hostable(live.competition_id)) return missing(reply);
    const cdn = sites.assetUrl(live.competition_id, live.version_id, rest);
    if (cdn) return reply.header("Cache-Control", "public, max-age=300").redirect(cdn, 302);
    return serve(reply, live.competition_id, live.version_id, rest, type => (type.startsWith("text/html") ? "no-cache" : "public, max-age=300"));
  });
}

import type { FastifyInstance } from "fastify";
import { SHIELD_NOTICE, crossSiteBrowserRequest, honeypotFamily, requestPath } from "../lib/shield.js";
import { DECOY_RESPONSE } from "../lib/security-decoy.js";

declare module "fastify" {
  interface FastifyRequest {
    /** 这次请求是被访问防护拦下的（403 ip_blocked）：不再计分，也不写操作记录。 */
    shieldBlocked?: boolean;
  }
}

/** 健康检查不拦：容器的存活探测和负载均衡的检查都走这里，封禁一个 IP 不能让它看起来像服务挂了。 */
const HEALTH_PATH = "/healthz";
const SECURITY_TXT_PATH = "/.well-known/security.txt";
const DECOY_BODY = JSON.stringify(DECOY_RESPONSE);
const DECOY_BYTES = Buffer.byteLength(DECOY_BODY);

/**
 * 访问防护的钩子（#333，lib/shield.ts）：onRequest 里先查封禁，命中回 403 `ip_blocked`，`request_id` 与
 * `retry_after`（秒）照常给，前端据此提示；命中蜜罐路径（#333 追加）直接封禁，回 404；被拦下的回应都带 `notice`
 * 法律告知（403、蜜罐 404，以及 onSend 里补的 429）。onResponse 按状态码记分。SHIELD_ENABLED=off（开发环境）时
 * 计分、封禁、蜜罐与告知都不生效；SHIELD_ALLOWLIST 里的来源不计分、不封，蜜罐路径当普通的 404，429 也不带告知。
 * 外站让访客浏览器发来的请求（lib/shield.ts 的 crossSiteBrowserRequest）不触发蜜罐、不按状态码计分，生效中的封禁照拦。
 * `/.well-known/security.txt` 按 RFC 9116 从 PUBLIC_ORIGIN 拼，联系方式指向意见箱：两种开关下都提供，被封禁的
 * 来源也拿得到（误封的人要靠它找到站方）。路径按 nginx 的规整写法比较（lib/shield.ts 的 requestPath）。
 */
export function registerShield(app: FastifyInstance) {
  const { publicOrigin } = app.services.config;
  const expires = new Date(Date.now() + 365 * 24 * 3600_000).toISOString().replace(/\.\d{3}Z$/, "Z");
  const securityTxt = [
    `Contact: ${publicOrigin}/?open=feedback`,
    `Expires: ${expires}`,
    "Preferred-Languages: zh, en",
    "",
  ].join("\n");
  app.addHook("onRequest", async (req, reply) => {
    const path = requestPath(req.url);
    if (path === HEALTH_PATH) return;
    if (path === SECURITY_TXT_PATH) return reply.type("text/plain; charset=utf-8").send(securityTxt);
    const { shield } = app.services;
    if (!shield.enabled) return;
    const block = shield.check(req.ip);
    if (block) {
      req.shieldBlocked = true;
      return reply.code(403).send({
        error: "ip_blocked",
        message: "这个网络地址因为短时间内的异常请求被暂时限制，请稍后再试。",
        request_id: req.id,
        retry_after: block.retry_after,
        notice: SHIELD_NOTICE,
      });
    }
    const probe = honeypotFamily(path);
    if (probe && !shield.allowlisted(req.ip) && !crossSiteBrowserRequest(req.headers, publicOrigin)) {
      if ((req.method === "GET" || req.method === "HEAD") && app.services.decoy.get().active) {
        app.services.storage.db.transaction(() => {
          shield.trap(req.ip, "honeypot");
          app.services.activity.recordActivity(req, {
            action: "security.decoy.hit", surface: "system", target_type: "security_probe", target_id: probe, outcome: "denied",
            meta: { method: req.method, probe, status: 200, synthetic: true },
          });
        }).immediate();
        return reply.type("application/json; charset=utf-8")
          .header("Cache-Control", "no-store").header("X-Robots-Tag", "noindex, nofollow, noarchive")
          .header("Content-Length", DECOY_BYTES).send(req.method === "HEAD" ? undefined : DECOY_BODY);
      }
      shield.trap(req.ip, "honeypot");
      return reply.code(404).send({ error: "not_found", message: "没有这个页面。", request_id: req.id, notice: SHIELD_NOTICE });
    }
  });
  app.addHook("onSend", async (req, reply, payload) => {
    const { shield } = app.services;
    if (!shield.enabled || reply.statusCode !== 429 || typeof payload !== "string" || shield.allowlisted(req.ip)) return payload;
    try {
      const body = JSON.parse(payload) as Record<string, unknown>;
      if (body && typeof body === "object" && !("notice" in body)) return JSON.stringify({ ...body, notice: SHIELD_NOTICE });
    } catch { /* 不是 JSON 的 429 原样返回 */ }
    return payload;
  });
  app.addHook("onResponse", async (req, reply) => {
    if (req.shieldBlocked || crossSiteBrowserRequest(req.headers, publicOrigin)) return;
    app.services.shield.observe(req.ip, reply.statusCode, req.url);
  });
}

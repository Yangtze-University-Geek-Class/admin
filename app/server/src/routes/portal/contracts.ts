import { body, object, text, type RouteContracts } from "../../lib/http-contracts.js";
const proof = object({ timestamp: { type: "integer" }, nonce: text(32, 1) }, ["timestamp", "nonce"]);
const abuse = { pow: proof, website: text(200), homepage: text(200), url_ref: text(200), turnstile_token: text(4096) };
export const portalContracts: RouteContracts = {
  "GET /api/public/org": { querystring: object({}) },
  "GET /api/docs/:id": { params: object({ id: text(64, 1) }, ["id"]) },
  "POST /api/join/:token": body({ github_login: text(39), email: text(254), note: text(280), ...abuse }),
  // 重复的 org 参数会被解析成数组，在合同这里回 400，不进路由变成 500（#129）。合同整份替换公共 querystring，limit 的规则照抄。
  "GET /api/feedback/public": { querystring: object({ org: text(39), limit: { type: "string", pattern: "^[1-9][0-9]{0,3}$" } }, [], true) },
  "POST /api/feedback": body({ org: text(39, 1), content: text(5000, 5), category: text(20), contact: text(200), ...abuse }, ["org", "content"]),
};

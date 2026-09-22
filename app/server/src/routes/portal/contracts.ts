import { body, object, text, type RouteContracts } from "../../lib/http-contracts.js";
const proof = object({ timestamp: { type: "integer" }, nonce: text(32, 1) }, ["timestamp", "nonce"]);
const abuse = { pow: proof, website: text(200), homepage: text(200), url_ref: text(200), turnstile_token: text(4096) };
export const portalContracts: RouteContracts = {
  "GET /api/docs/:id": { params: object({ id: text(64, 1) }, ["id"]) },
  "POST /api/join/:token": body({ github_login: text(39), email: text(254), note: text(280), ...abuse }),
  "POST /api/feedback": body({ org: text(39, 1), content: text(5000, 5), category: text(20), contact: text(200), ...abuse }, ["org", "content"]),
};

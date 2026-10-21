import { body, limitParam, object, text, type RouteContracts } from "../../lib/http-contracts.js";
import {
  competitionFailures, competitionIdParam, competitionLeaderboard, freeAgentList, myCompetitionList, myStatus,
  publicCompetition, publicCompetitionList, signupBody, teamIdParam, teamList,
} from "../../lib/competition-contract.js";
const proof = object({ timestamp: { type: "integer" }, nonce: text(32, 1) }, ["timestamp", "nonce"]);
const abuse = { pow: proof, website: text(200), homepage: text(200), url_ref: text(200), turnstile_token: text(4096) };
export const portalContracts: RouteContracts = {
  "GET /api/public/competitions": { querystring: object({}), response: { 200: publicCompetitionList, ...competitionFailures } },
  "GET /api/public/competitions/:id": { ...competitionIdParam, response: { 200: publicCompetition, ...competitionFailures } },
  "GET /api/public/org": { querystring: object({}) },
  "GET /api/docs/:id": { params: object({ id: text(64, 1) }, ["id"]) },
  "POST /api/join/:token": body({ github_login: text(39), email: text(254), note: text(280), ...abuse }),
  // 重复的 org 参数会被解析成数组，在合同这里回 400，不进路由变成 500（#129）。合同整份替换公共 querystring，limit 引用公共规则。
  "GET /api/feedback/public": { querystring: object({ org: text(39), limit: limitParam }, [], true) },
  "POST /api/feedback": body({ org: text(39, 1), content: text(5000, 5), category: text(20), contact: text(200), ...abuse }, ["org", "content"]),

  // 报名与组队（#239）：全部要求登录且是极客班成员；写操作每人每分钟 30 次。
  "GET /api/me/competitions": { response: { 200: myCompetitionList, ...competitionFailures } },
  "GET /api/competitions/:id/my-status": { ...competitionIdParam, response: { 200: myStatus, ...competitionFailures } },
  "POST /api/competitions/:id/signup": { ...competitionIdParam, body: signupBody.signup, response: { 200: myStatus, ...competitionFailures } },
  "DELETE /api/competitions/:id/signup": { ...competitionIdParam, response: { 200: myStatus, ...competitionFailures } },
  "GET /api/competitions/:id/teams": { ...competitionIdParam, response: { 200: teamList, ...competitionFailures } },
  "GET /api/competitions/:id/free-agents": { ...competitionIdParam, response: { 200: freeAgentList, ...competitionFailures } },
  "POST /api/competitions/:id/teams": { ...competitionIdParam, body: signupBody.teamCreate, response: { 201: myStatus, ...competitionFailures } },
  "POST /api/teams/:id/apply": { ...teamIdParam, body: signupBody.apply, response: { 201: myStatus, ...competitionFailures } },
  "POST /api/teams/:id/invite": { ...teamIdParam, body: signupBody.invite, response: { 201: myStatus, ...competitionFailures } },
  "POST /api/teams/:id/respond": { ...teamIdParam, body: signupBody.respond, response: { 200: myStatus, ...competitionFailures } },
  "POST /api/teams/:id/leave": { ...teamIdParam, response: { 200: myStatus, ...competitionFailures } },
  "POST /api/teams/:id/transfer": { ...teamIdParam, body: signupBody.transfer, response: { 200: myStatus, ...competitionFailures } },
  "DELETE /api/teams/:id": { ...teamIdParam, response: { 200: myStatus, ...competitionFailures } },
  "POST /api/teams/:id/lock": { ...teamIdParam, response: { 200: myStatus, ...competitionFailures } },
  "DELETE /api/teams/:id/lock": { ...teamIdParam, response: { 200: myStatus, ...competitionFailures } },
  "GET /api/competitions/:id/leaderboard": { ...competitionIdParam, response: { 200: competitionLeaderboard, ...competitionFailures } },
};

import {
  choices, integer, nullableText, object, text, type RouteContracts,
} from "../../lib/http-contracts.js";

/** 一种登录方式（规格「接口」的 Providers）：前端按这个列表渲染按钮，不写死任何渠道。 */
const provider = object({
  id: choices("github", "google", "email"),
  name: text(40, 1),
  kind: choices("redirect", "email_code"),
  start: text(200, 1),
  can_register: { type: "boolean" },
}, ["id", "name", "kind", "start", "can_register"]);

// 设备授权（RFC 8628）：错误体带 OAuth 的 error / error_description，并保留共同错误处理器的扩展字段。
const failure = object({
  error: { type: "string" },
  error_description: { type: "string" },
  message: { type: "string" },
  request_id: { type: "string" },
}, ["error"], true);
const deviceFailures = { "4xx": failure, "5xx": failure };

const deviceStatus = choices("pending", "approved", "denied", "expired", "consumed");
const deviceCodeResult = object({
  device_code: text(128, 1),
  user_code: text(9, 1),
  verification_uri: text(500, 1),
  verification_uri_complete: text(600, 1),
  expires_in: integer(0),
  interval: integer(1),
}, ["device_code", "user_code", "verification_uri", "verification_uri_complete", "expires_in", "interval"]);
const deviceTokenResult = object({
  access_token: text(128, 1),
  token_type: choices("Bearer"),
  expires_in: integer(0),
  scope: text(200),
  account_id: text(64, 1),
}, ["access_token", "token_type", "expires_in", "scope", "account_id"]);
const deviceView = object({
  user_code: text(9, 1),
  client_id: text(64, 1),
  client_name: text(40, 1),
  scope: text(200),
  status: deviceStatus,
  expires_at: integer(0),
}, ["user_code", "client_id", "client_name", "scope", "status", "expires_at"]);
const deviceDecision = object({
  ok: { type: "boolean", const: true },
  status: choices("approved", "denied"),
}, ["ok", "status"]);
const deviceProfile = object({
  sub: text(64, 1),
  account_id: text(64, 1),
  login: text(40),
  avatar_url: nullableText(500),
  scope: text(200),
}, ["sub", "account_id", "login", "avatar_url", "scope"]);

export const identityContracts: RouteContracts = {
  "GET /auth/providers": {
    querystring: object({}),
    response: { 200: object({ providers: { type: "array", items: provider, maxItems: 3 } }, ["providers"]) },
  },
  // 字段不设 required：缺参数也要按 RFC 8628 回 invalid_client / invalid_grant，而不是通用的 validation_error。
  "POST /auth/device/code": {
    querystring: object({}),
    body: object({ client_id: text(64), scope: text(200) }),
    response: { 200: deviceCodeResult, ...deviceFailures },
  },
  "POST /auth/device/token": {
    querystring: object({}),
    body: object({ grant_type: text(120), device_code: text(128), client_id: text(64) }),
    response: { 200: deviceTokenResult, ...deviceFailures },
  },
  "GET /api/identity/device": {
    querystring: object({ user_code: text(32) }),
    response: { 200: deviceView, ...deviceFailures },
  },
  "POST /api/identity/device/approve": {
    querystring: object({}),
    body: object({ user_code: text(32), decision: choices("approve", "deny") }),
    response: { 200: deviceDecision, ...deviceFailures },
  },
  "GET /auth/device/userinfo": {
    querystring: object({}),
    response: { 200: deviceProfile, ...deviceFailures },
  },
};

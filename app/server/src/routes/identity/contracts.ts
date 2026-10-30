import {
  choices, integer, nullableText, object, text, type RouteContracts,
} from "../../lib/http-contracts.js";
import { EMAILS_MAX } from "../../lib/identity-store.js";

const pattern = (source: string) => ({ type: "string", pattern: source });
/** 账号资料（#274 CONTRACT §2）。`prefs` 的具体字段由业务自行解释，合同只约束整体是个对象。 */
const profileView = object({
  username: text(24, 1), display_name: text(32, 1), bio: text(200),
  avatar_url: { anyOf: [text(500), { type: "null" }] },
  // `additionalProperties: true`：prefs 的字段由业务自行解释（见上），响应序列化(fast-json-stringify)
  // 对没声明 additionalProperties 的裸 object 只会输出 `{}`，必须显式打开才能把内容序列化出来。
  prefs: { type: "object", additionalProperties: true },
}, ["username", "display_name", "bio", "avatar_url", "prefs"]);

/** 一种登录方式（规格「接口」的 Providers）：前端按这个列表渲染按钮，不写死任何渠道。 */
const provider = object({
  id: choices("github", "google", "email"),
  name: text(40, 1),
  kind: choices("redirect", "email_code"),
  start: text(200, 1),
  can_register: { type: "boolean" },
  password: text(200, 1),
}, ["id", "name", "kind", "start", "can_register"]);

// 错误体：设备授权（RFC 8628）带 OAuth 的 error / error_description，邮箱登录与账号页带 attempts_left、retry_after、reauth；
// 都保留共同错误处理器的扩展字段，不因补了成功响应的合同而被删掉。
const failure = object({
  error: { type: "string" },
  error_description: { type: "string" },
  message: { type: "string" },
  request_id: { type: "string" },
}, ["error"], true);
const failures = { "4xx": failure, "5xx": failure };

// 邮箱、Google 与账号页（#262 第二期）
const email = text(254, 3);
const code = text(16);
const returnTo = text(2048);
const inviteCode = text(40);
const timestamp = integer(0);
const nullableTimestamp = { anyOf: [integer(0), { type: "null" }] };
const loginProvider = choices("github", "email", "google");
const codeSent = object({ resend_after: integer(1) }, ["resend_after"]);
const signedIn = object({ return_to: text(2048, 1), registered: { type: "boolean" } }, ["return_to"]);
const done = object({ ok: { type: "boolean", const: true } }, ["ok"]);
const googleLink = object({ authorize_url: text(2048, 1) }, ["authorize_url"]);
// 实名信息（#280）：下拉框能选大一到大四（1–4）和已毕业（"graduated"）；真实姓名的字符规则在 lib/account-profiles.ts
const selectableGrade = { anyOf: [{ type: "integer", enum: [1, 2, 3, 4] }, { type: "string", enum: ["graduated"] }] };
const realName = text(64, 1);
const realInfoView = {
  real_name: { anyOf: [text(64, 1), { type: "null" }] },
  grade: { anyOf: [selectableGrade, choices("graduated"), { type: "null" }] },
  grade_label: { anyOf: [text(8, 1), { type: "null" }] },
  profile_required: { type: "boolean" },
};
const accountView = object({
  account_id: text(64, 1),
  login: text(100, 1),
  // GitHub、Google 各一个，邮箱最多 EMAILS_MAX 个（#272）；邮箱另带身份 id（删邮箱用）与是不是主邮箱
  identities: {
    type: "array", maxItems: 2 + EMAILS_MAX,
    items: object({
      provider: loginProvider, label: text(254), linked_at: timestamp, last_login_at: nullableTimestamp, id: text(64, 1), primary: { type: "boolean" },
    }, ["provider", "label", "linked_at", "last_login_at"]),
  },
  has_password: { type: "boolean" },
  password_updated_at: nullableTimestamp,
  membership: object({
    state: choices("active", "pending", "not_member", "unknown"), org_role: nullableText(20), via_invite: { type: "boolean" },
  }, ["state", "org_role", "via_invite"]),
  created_at: timestamp,
  recent: {
    type: "array", maxItems: 20,
    items: object({ at: timestamp, action: text(64, 1), provider: nullableText(20), result: choices("ok", "denied", "failed") }, ["at", "action", "provider", "result"]),
  },
  available: { type: "array", items: choices("email"), maxItems: 1 },
  email_required: { type: "boolean" },
  ...realInfoView,
  session: object({
    provider: loginProvider, created_at: timestamp, expires_at: timestamp, step_up_until: timestamp,
  }, ["provider", "created_at", "expires_at", "step_up_until"]),
}, ["account_id", "login", "identities", "has_password", "password_updated_at", "membership", "created_at", "recent", "available", "email_required", "real_name", "grade", "grade_label", "profile_required", "session"]);

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
// 命令行拿不到 real_name（#277 的硬约束），只给年级——身份展示够用，不碰姓名
const deviceProfile = object({
  sub: text(64, 1),
  account_id: text(64, 1),
  login: text(40),
  username: text(40),
  display_name: text(80),
  bio: text(200),
  avatar_url: nullableText(500),
  scope: text(200),
  grade: { anyOf: [selectableGrade, choices("graduated"), { type: "null" }] },
  grade_label: { anyOf: [text(8, 1), { type: "null" }] },
  email_required: { type: "boolean" },
  profile_required: { type: "boolean" },
}, ["sub", "account_id", "login", "username", "display_name", "bio", "avatar_url", "scope", "grade", "grade_label", "email_required", "profile_required"]);

export const identityContracts: RouteContracts = {
  "GET /auth/providers": {
    querystring: object({}),
    response: { 200: object({ providers: { type: "array", items: provider, maxItems: 3 } }, ["providers"]) },
  },
  // 字段不设 required：缺参数也要按 RFC 8628 回 invalid_client / invalid_grant，而不是通用的 validation_error。
  "POST /auth/device/code": {
    querystring: object({}),
    body: object({ client_id: text(64), scope: text(200) }),
    response: { 200: deviceCodeResult, ...failures },
  },
  "POST /auth/device/token": {
    querystring: object({}),
    body: object({ grant_type: text(120), device_code: text(128), client_id: text(64) }),
    response: { 200: deviceTokenResult, ...failures },
  },
  "GET /api/identity/device": {
    querystring: object({ user_code: text(32) }),
    response: { 200: deviceView, ...failures },
  },
  "POST /api/identity/device/approve": {
    querystring: object({}),
    body: object({ user_code: text(32), decision: choices("approve", "deny") }),
    response: { 200: deviceDecision, ...failures },
  },
  "GET /auth/device/userinfo": {
    querystring: object({}),
    response: { 200: deviceProfile, ...failures },
  },
  // RFC 7009 式幂等：令牌缺失、不存在、已撤销或已过期都回同一个 200，不区分哪种情况。
  "POST /auth/device/revoke": {
    querystring: object({}),
    response: { 200: done },
  },
  "POST /auth/email/start": {
    querystring: object({}),
    body: object({ email, return_to: returnTo, purpose: choices("signin", "reset") }, ["email"]),
    response: { 202: codeSent, ...failures },
  },
  "POST /auth/email/verify": {
    querystring: object({}),
    // 新注册时姓名和年级必填（#280）；邮箱已经有账号时不看这两项。是不是新注册要核对过验证码才知道，所以合同里不设 required
    body: object({ code, invite_code: inviteCode, real_name: realName, grade: selectableGrade }, ["code"]),
    response: { 200: signedIn, ...failures },
  },
  "POST /auth/email/password": {
    querystring: object({}),
    body: object({ email, password: text(200, 1), return_to: returnTo }, ["email", "password"]),
    response: { 200: signedIn, ...failures },
  },
  "POST /auth/email/reset": {
    querystring: object({}),
    body: object({ code, password: text(200, 1) }, ["code", "password"]),
    response: { 200: signedIn, ...failures },
  },
  // 两个 Google 接口成功时都是 302 跳转、没有响应体，只约束失败体
  "GET /auth/google": { querystring: object({ return_to: returnTo, invite: inviteCode }), response: failures },
  // Google 回调还会带 scope、authuser、prompt、hd、iss 等参数，不一一列出
  "GET /auth/google/callback": { querystring: object({ code: text(2048), state: text(128), error: text(128) }, [], true), response: failures },
  // 绑定 Google（#291）：返回 Google 的授权地址，页面再跳过去；回调是上面那个 GET，成功与失败都是 302 回官网
  "POST /api/identity/link": { querystring: object({}), body: object({ provider: choices("google"), return_to: returnTo }, ["provider"]), response: { 200: googleLink, ...failures } },
  "GET /api/identity/me": { querystring: object({}), response: { 200: accountView, ...failures } },
  "POST /api/identity/email/start": { querystring: object({}), body: object({ email }, ["email"]), response: { 202: codeSent, ...failures } },
  "POST /api/identity/email/verify": { querystring: object({}), body: object({ code }, ["code"]), response: { 200: done, ...failures } },
  "POST /api/identity/email/remove": { querystring: object({}), body: object({ identity_id: text(64, 1) }, ["identity_id"]), response: { 200: done, ...failures } },
  "POST /api/identity/real-info": {
    querystring: object({}),
    body: object({ real_name: realName, grade: selectableGrade }, ["real_name", "grade"]),
    response: { 200: object(realInfoView, ["real_name", "grade", "grade_label", "profile_required"]), ...failures },
  },
  "POST /api/identity/password": {
    querystring: object({}),
    body: object({ password: text(200, 1), current_password: text(200) }, ["password"]),
    response: { 200: done, ...failures },
  },
  // 账号资料、头像与邀请码兑换（#274 CONTRACT §2）
  "GET /api/identity/profile": { querystring: object({}), response: { 200: profileView, ...failures } },
  "PATCH /api/identity/profile": {
    querystring: object({}),
    body: object({
      display_name: text(32, 1), bio: text(200), username: pattern("^[a-z0-9_]{3,24}$"),
      prefs: object({ start_note_seen_at: { anyOf: [integer(0), { type: "null" }] }, forum_theme: { anyOf: [choices("sky", "light", "dark"), { type: "null" }] } }, [], true),
    }),
    response: { 200: profileView, ...failures },
  },
  // 响应是 webp 字节流，不是 JSON；caching、公开读取见 lib/account-avatar.ts。
  "GET /api/identity/avatar/:file": {
    params: object({ file: pattern("^[0-9a-f]{64}\\.webp$") }, ["file"]),
    response: { 200: { type: "string", description: "image/webp; binary" } },
  },
  // NANO 默认头像（#343，lib/nano-avatar.ts）：响应是 PNG 字节流，版本号不对或编号不在 1–8 时 404。
  "GET /api/identity/default-avatar/:version/:file": {
    params: object({ version: pattern("^[0-9]{8}$"), file: pattern("^[1-8]\\.png$") }, ["version", "file"]),
    response: { 200: { type: "string", description: "image/png; binary" } },
  },
  "PUT /api/identity/avatar": { querystring: object({}), response: { 200: object({ avatar_url: { anyOf: [text(500), { type: "null" }] } }, ["avatar_url"]), ...failures } },
  "POST /api/identity/invite/redeem": {
    querystring: object({}),
    body: object({ code: inviteCode }, ["code"]),
    response: { 200: object({ level: { type: "string", const: "member" } }, ["level"]), ...failures },
  },
};

import { choices, integer, object, text, type RouteContracts } from "../../lib/http-contracts.js";
import { APPLICATION_STATUS_IDS } from "../../lib/roles.js";
import { FEEDBACK_STATUSES } from "../../lib/feedback-store.js";
import { INVITE_CODE_PATTERN } from "../../lib/invite-codes.js";
import { mailTemplateContracts, templateId } from "../../lib/mail/template-contract.js";
import { FORUM_LIMITS } from "../../lib/forum-rules.js";
import {
  competitionFields, competitionFailures, competitionDeleted, consoleCompetitionList, consoleCompetitionResult,
  competitionRoster, signupSettingsResult, signupBody, consoleCompetitionIdParam, scoreEventList, scoreEventResult, scoreEventParam,
  scorePreview, scorePreviewQuery,
  consoleSiteState, consoleSiteVersion, sitePublishBody, candidateList, candidateResult, collectResult, candidateQuery, candidateParam, candidateBody,
  rulesView, rulesBody, finalView, redeemResult, prizeCodeBody,
} from "../../lib/competition-contract.js";

const UUID_PATTERN = "^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$";
/** 论坛分类 id（#276）：和 forum-api/contracts.ts 发帖用的同一条规则，app/forum/content/curation.json 的分类 id。 */
const forumCategoryId = { type: "string", pattern: "^[a-z0-9][a-z0-9-]{0,39}$" };
/** 表情包/表情 id（#276）：表情 id 就是它的短码。 */
const stickerPackId = { type: "string", pattern: "^[a-z0-9][a-z0-9-]{0,39}$" };
const stickerShortcode = { type: "string", pattern: FORUM_LIMITS.stickerShortcodePattern.source };
const visibilityChoice = choices("public", "registered", "member");

/** 极客班账号 id：26 位 Crockford Base32（lib/identity-store.ts 的 newAccountId）。 */
const accountId = { type: "string", pattern: "^[0-9A-HJKMNP-TV-Z]{26}$" };
const nullableInteger = { anyOf: [integer(), { type: "null" }] };
const nullableString = (max: number) => ({ anyOf: [text(max), { type: "null" }] });
// 失败体保留共同错误处理器的扩展字段（capability、any_of）
const consoleFailures = {
  "4xx": object({ error: { type: "string" }, message: { type: "string" }, request_id: { type: "string" }, capability: { type: "string" }, any_of: { type: "array", items: { type: "string" } } }, ["error"], true),
  "5xx": object({ error: { type: "string" }, message: { type: "string" }, request_id: { type: "string" } }, ["error"], true),
};
/** 查询串里的有界正整数（coerceTypes 关闭，查询值都是字符串）。 */
const LIMIT_PATTERNS = { 200: "^(?:[1-9][0-9]?|1[0-9]{2}|200)$", 500: "^(?:[1-9][0-9]?|[1-4][0-9]{2}|500)$" } as const;
const limit = (max: keyof typeof LIMIT_PATTERNS) => ({ type: "string", pattern: LIMIT_PATTERNS[max] });
const offset = { type: "string", pattern: "^[0-9]{1,8}$" };
const noQuery = { querystring: object({}) };
const nullableCount = { anyOf: [integer(0), { type: "null" }] };
// GitLab 同步（#270）：一个要做的动作，和成员页上一个账号的同步状态
const gitlabAction = {
  oneOf: [
    object({ kind: choices("create"), username: text(64, 1), access_level: integer(10, 50) }, ["kind", "username", "access_level"]),
    object({ kind: choices("block", "unblock", "find_and_block", "set_avatar", "set_emails") }, ["kind"]),
    object({ kind: choices("set_access"), access_level: integer(10, 50) }, ["kind", "access_level"]),
  ],
};
const gitlabAccountView = object({
  account_id: accountId, login: text(100, 1), username: nullableString(64), gitlab_user_id: nullableInteger,
  state: { anyOf: [choices("pending", "active", "blocked"), { type: "null" }] }, access_level: nullableInteger,
  last_error: nullableString(64), last_error_at: nullableCount, synced_at: nullableCount, pending: { type: "array", items: gitlabAction },
}, ["account_id", "login", "username", "gitlab_user_id", "state", "access_level", "last_error", "last_error_at", "synced_at", "pending"]);
const gitlabSettingsResult = object({
  sync_mode: choices("off", "dry-run", "on"), group_path: text(255, 1), interval_minutes: integer(5, 1440), token_configured: { type: "boolean" },
}, ["sync_mode", "group_path", "interval_minutes", "token_configured"]);
const inviteView = object({
  id: integer(), code: text(40, 1), note: text(100), max_uses: nullableCount, used_count: integer(0), expires_at: nullableCount,
  disabled: { type: "boolean" }, created_by: text(100), created_at: integer(0), updated_at: integer(0), usable: { type: "boolean" },
}, ["id", "code", "note", "max_uses", "used_count", "expires_at", "disabled", "created_by", "created_at", "updated_at", "usable"]);
// 失败体保留共同错误处理器的扩展字段（如 capability）
const inviteFailures = {
  "4xx": object({ error: { type: "string" }, message: { type: "string" }, request_id: { type: "string" }, capability: { type: "string" } }, ["error"], true),
  "5xx": object({ error: { type: "string" }, message: { type: "string" }, request_id: { type: "string" } }, ["error"], true),
};
// 招新总开关（#284）：updated_at 是最近一次开关的时间，从没动过为 null
const applySettingsResult = object({ open: { type: "boolean" }, updated_at: nullableCount }, ["open", "updated_at"]);
const applicationParams = { params: object({ application_id: { type: "string", pattern: UUID_PATTERN } }, ["application_id"]) };
// 比赛 id 是 UUID，但种子比赛用的是可读 slug（oss-challenge-2026-1），路径参数不能只收 UUID。
const competitionParams = consoleCompetitionIdParam;

// #274 新权限体系（CONTRACT-274 §5）：权限节点、权限组、按节点算出来的用户列表。
// 权限组 id 不是数字（level.member、dept.ai、title.ai.staff、custom.<slug>……），`:id` 不能用
// registerContracts 默认给 `:id` 的数字正则，这里的每个路由都要显式覆盖 params。
const groupId = { type: "string", pattern: "^[a-z][a-z0-9_]*(\\.[a-z0-9_]+)*$" };
// 自由形态的对象（scope、meta、条目的 meta）：响应序列化用 fast-json-stringify，裸 `{type:"object"}`
// 没有 additionalProperties:true 会被序列化成空对象（这次改动里已经踩过一次这个坑，profile.ts 的 prefs 字段）。
const freeObject = { type: "object", additionalProperties: true };
const nodeView = object({
  node: { type: "string" }, domain: { type: "string" }, label: text(64, 1), description: text(300), meta: { type: "boolean" },
}, ["node", "domain", "label", "description", "meta"]);
const entryView = object({
  id: integer(), node: { type: "string" }, value: { anyOf: [{ type: "boolean" }, { type: "null" }] },
  meta_value: { anyOf: [text(200), { type: "null" }] }, scope: freeObject, expires_at: nullableCount,
}, ["id", "node", "value", "meta_value", "scope", "expires_at"]);
const groupView = object({
  id: groupId, kind: choices("level", "department", "title", "custom"), name: text(64, 1), description: text(200),
  weight: integer(0, 100000), department_id: { anyOf: [groupId, { type: "null" }] },
  icon: { anyOf: [text(64), { type: "null" }] }, tone: { anyOf: [text(32), { type: "null" }] },
  sort: integer(0, 100000), system: { type: "boolean" }, parents: { type: "array", items: groupId },
  member_count: integer(0), entries: { type: "array", items: entryView },
}, ["id", "kind", "name", "description", "weight", "department_id", "icon", "tone", "sort", "system", "parents", "member_count", "entries"]);
// display_name 读出来允许空字符串（minLength 0）：account-profiles.ts 的 ensure() 给新账号兜底写的是 ""，
// 不是 null；这里是 anyOf，fast-json-stringify 序列化时要能分支选中，minLength:1 的话空字符串两边都不匹配，
// 会直接抛 TypeError（这次改动踩过一次，GET /api/console/me 对刚建号、还没设过昵称的账号 500）。写接口
// （PATCH /api/identity/profile 等）仍然不让把它显式改成空，这里只管「读」。
const groupMemberView = object({
  account_id: accountId, username: { anyOf: [text(24, 1), { type: "null" }] }, display_name: { anyOf: [text(32, 0), { type: "null" }] },
  avatar_url: { anyOf: [text(500), { type: "null" }] }, expires_at: nullableCount, granted_by: text(100), created_at: integer(0),
}, ["account_id", "username", "display_name", "avatar_url", "expires_at", "granted_by", "created_at"]);
const explainHit = object({
  source: choices("account", "group"), group: { anyOf: [object({ id: groupId, name: text(64, 1) }, ["id", "name"]), { type: "null" }] },
  via: { type: "array", items: groupId },
  entry: object({ node: { type: "string" }, value: { type: "boolean" }, scope: freeObject, expires_at: nullableCount }, ["node", "value", "scope", "expires_at"]),
}, ["source", "group", "via", "entry"]);
const explainResult = object({
  node: { type: "string" }, result: choices("allow", "deny", "unset"), hits: { type: "array", items: explainHit },
  meta_value: { anyOf: [text(200), { type: "null" }] },
}, ["node", "result", "hits"]);
const effectiveResult = object({
  account_id: accountId,
  groups: { type: "array", items: object({ id: groupId, name: text(64, 1), kind: text(16, 1), via: { type: "array", items: groupId } }, ["id", "name", "kind", "via"]) },
  allow: { type: "array", items: { type: "string" } }, deny: { type: "array", items: { type: "string" } }, meta: freeObject,
}, ["account_id", "groups", "allow", "deny", "meta"]);
const userDepartmentView = { anyOf: [object({ id: groupId, name: text(64, 1), tone: { anyOf: [text(32), { type: "null" }] } }, ["id", "name", "tone"]), { type: "null" }] };
const userTitleView = object({ id: groupId, name: text(64, 1), department_id: { anyOf: [groupId, { type: "null" }] } }, ["id", "name", "department_id"]);
const gitlabStateView = object({ state: choices("synced", "pending", "failed", "blocked", "none"), gitlab_user_id: { anyOf: [integer(1), { type: "null" }] } }, ["state", "gitlab_user_id"]);
// 实名信息（#280）：下拉框只能选 1–4，读出来的年级还可能是已毕业。`real_name` 只回给有 users.manage 的调用者，所以不设 required
const selectableGrade = { anyOf: [{ type: "integer", enum: [1, 2, 3, 4] }, { type: "string", enum: ["graduated"] }] };
const userView = object({
  account_id: accountId, username: { anyOf: [text(24, 1), { type: "null" }] }, display_name: { anyOf: [text(32, 0), { type: "null" }] },
  real_name: { anyOf: [text(64, 1), { type: "null" }] }, grade: { anyOf: [selectableGrade, choices("graduated"), { type: "null" }] }, grade_label: { anyOf: [text(8, 1), { type: "null" }] },
  avatar_url: { anyOf: [text(500), { type: "null" }] }, status: choices("active", "disabled"), level: choices("registered", "member", "alumni"),
  department: userDepartmentView, titles: { type: "array", items: userTitleView },
  providers: { type: "array", items: choices("email", "google", "github") }, gitlab: gitlabStateView,
  last_login_at: nullableCount, created_at: integer(0),
}, ["account_id", "username", "display_name", "grade", "grade_label", "avatar_url", "status", "level", "department", "titles", "providers", "gitlab", "last_login_at", "created_at"]);
const usersListResult = object({
  items: { type: "array", items: userView }, next_cursor: { anyOf: [text(2000), { type: "null" }] },
  counts: object({ visitor_today: integer(0), registered: integer(0), member: integer(0), alumni: integer(0) }, ["visitor_today", "registered", "member", "alumni"]),
}, ["items", "next_cursor", "counts"]);
const meResult = object({
  account_id: accountId, login: text(100, 1), username: { anyOf: [text(24, 1), { type: "null" }] }, display_name: { anyOf: [text(32, 0), { type: "null" }] },
  avatar_url: { anyOf: [text(500), { type: "null" }] }, level: choices("registered", "member", "alumni"), level_name: text(16, 1),
  department: userDepartmentView, titles: { type: "array", items: userTitleView }, permissions: { type: "array", items: { type: "string" } },
  provider: choices("github", "email", "google"), email_required: { type: "boolean" }, profile_required: { type: "boolean" },
}, ["account_id", "login", "username", "display_name", "avatar_url", "level", "level_name", "department", "titles", "permissions", "provider", "email_required", "profile_required"]);
// 概览：只回调用者有权看的键，所以响应体里全部字段都不是必填。
const summaryResult = object({
  applications: object({ total: integer(0), by_status: freeObject, last_7d: integer(0) }, ["total", "by_status", "last_7d"]),
  candidates_pending: integer(0), registrations_today: integer(0), blocked_today: integer(0),
  gitlab: object({ mode: choices("off", "dry-run", "on"), healthy: { type: "boolean" }, last_run: { anyOf: [object({ at: integer(0), changed: integer(0), failed: integer(0) }, ["at", "changed", "failed"]), { type: "null" }] } }, ["mode", "healthy", "last_run"]),
  feedback: freeObject,
});
const activityAccountView = { anyOf: [object({ id: accountId, username: { anyOf: [text(24, 1), { type: "null" }] }, display_name: { anyOf: [text(32, 0), { type: "null" }] }, avatar_url: { anyOf: [text(500), { type: "null" }] } }, ["id", "username", "display_name", "avatar_url"]), { type: "null" }] };
const activityItemView = object({
  id: integer(), at: integer(0), account: activityAccountView, visitor_id: { anyOf: [text(64), { type: "null" }] },
  surface: choices("portal", "forum", "console", "cli", "api", "system"), action: text(100, 1),
  target_type: { anyOf: [text(32), { type: "null" }] }, target_id: { anyOf: [text(100), { type: "null" }] },
  outcome: choices("ok", "denied", "limited", "error"), ip: { anyOf: [text(64), { type: "null" }] }, ua: { anyOf: [text(300), { type: "null" }] },
  request_id: { anyOf: [text(64), { type: "null" }] }, meta: freeObject,
}, ["id", "at", "account", "visitor_id", "surface", "action", "target_type", "target_id", "outcome", "ip", "ua", "request_id", "meta"]);
const activityListResult = object({
  items: { type: "array", items: activityItemView }, next_cursor: { anyOf: [text(2000), { type: "null" }] },
  blocked_today: { type: "array", items: object({ bucket: { type: "string" }, count: integer(0) }, ["bucket", "count"]) },
}, ["items", "next_cursor", "blocked_today"]);
const accountActivityListResult = object({ items: { type: "array", items: activityItemView }, next_cursor: { anyOf: [text(2000), { type: "null" }] } }, ["items", "next_cursor"]);
const activityQuery = object({
  account: accountId, visitor: text(64), action: text(100), surface: choices("portal", "forum", "console", "cli", "api", "system"),
  outcome: choices("ok", "denied", "limited", "error"), from: { type: "string", pattern: "^[0-9]{1,15}$" }, to: { type: "string", pattern: "^[0-9]{1,15}$" },
  cursor: text(2000),
});

/** `/api/console/*` 的输入协议源。所有 body 与 query 都拒绝未知字段。 */
export const consoleContracts: RouteContracts = {
  "GET /api/console/me": { ...noQuery, response: { 200: meResult } },
  "GET /api/console/summary": { ...noQuery, response: { 200: summaryResult } },
  // 部门是固定清单（SPEC §1），不再支持控制台里新建/改名/归档/删除，写路由跟着一起删；只留这条只读列表（部门 + 人数）。
  // GitLab 账号同步（#270）：mode 是 off、dry-run 或 on；pending 是现在还要做的事，dry-run 时只列出、不做
  "GET /api/console/gitlab/accounts": {
    ...noQuery,
    response: { 200: object({
      mode: choices("off", "dry-run", "on"), gitlab_url: nullableString(255), group: text(255, 1), client_registered: { type: "boolean" },
      accounts: { type: "array", items: gitlabAccountView },
    }, ["mode", "gitlab_url", "group", "client_registered", "accounts"]), ...consoleFailures },
  },
  "POST /api/console/gitlab/accounts/:account_id/resync": {
    ...noQuery,
    params: object({ account_id: accountId }, ["account_id"]),
    response: { 200: object({
      mode: choices("dry-run", "on"), account_id: accountId, login: text(100, 1), actions: { type: "array", items: gitlabAction },
      applied: { type: "boolean" }, error: nullableString(64),
    }, ["mode", "account_id", "login", "actions", "applied", "error"]), ...consoleFailures },
  },
  // 控制台概览（#274）：同步开关、能不能连上、GitLab 版本号、上一轮对账小结、过去 24 小时还在失败状态的账号数
  "GET /api/console/gitlab/status": {
    ...noQuery,
    response: { 200: object({
      mode: choices("off", "dry-run", "on"), url: nullableString(255), group: text(255, 1), token_configured: { type: "boolean" },
      version: nullableString(32), healthy: { type: "boolean" },
      last_run: { anyOf: [object({ at: integer(0), changed: integer(0), failed: integer(0) }, ["at", "changed", "failed"]), { type: "null" }] },
      errors_24h: integer(0),
    }, ["mode", "url", "group", "token_configured", "version", "healthy", "last_run", "errors_24h"]), ...consoleFailures },
  },
  "GET /api/console/gitlab/projects": {
    ...noQuery,
    response: { 200: object({
      groups: { type: "array", items: object({ id: integer(1), full_path: text(255, 1), name: text(255, 1), visibility: text(20, 1) }, ["id", "full_path", "name", "visibility"]) },
      projects: { type: "array", items: object({
        id: integer(1), path_with_namespace: text(255, 1), name: text(255, 1), description: nullableString(2000), visibility: text(20, 1),
        web_url: text(500, 1), http_url_to_repo: text(500, 1), ssh_url_to_repo: text(500, 1), last_activity_at: nullableString(40), star_count: integer(0),
      }, ["id", "path_with_namespace", "name", "description", "visibility", "web_url", "http_url_to_repo", "ssh_url_to_repo", "last_activity_at", "star_count"]) },
    }, ["groups", "projects"]), ...consoleFailures },
  },
  "GET /api/console/gitlab/settings": {
    ...noQuery,
    response: { 200: gitlabSettingsResult, ...consoleFailures },
  },
  "PATCH /api/console/gitlab/settings": {
    ...noQuery,
    body: object({ sync_mode: choices("off", "dry-run", "on"), group_path: text(255, 1), interval_minutes: integer(5, 1440) }),
    response: { 200: gitlabSettingsResult, ...consoleFailures },
  },
  "GET /api/console/applications": {
    querystring: object({ status: choices(...APPLICATION_STATUS_IDS), q: text(100), limit: limit(200), offset }),
  },
  "GET /api/console/applications/settings": { ...noQuery, response: { 200: applySettingsResult, ...consoleFailures } },
  "PATCH /api/console/applications/settings": {
    ...noQuery,
    body: object({ open: { type: "boolean" } }, ["open"]),
    response: { 200: applySettingsResult, ...consoleFailures },
  },
  "GET /api/console/applications/export.csv": { querystring: object({ status: choices(...APPLICATION_STATUS_IDS) }) },
  "GET /api/console/applications/:application_id": { ...noQuery, ...applicationParams },
  "PATCH /api/console/applications/:application_id": {
    ...noQuery, ...applicationParams,
    // 空 body 交给路由返回 400 no_change，而不是笼统的 validation_error；状态值在路由里核对，回 400 invalid_status。
    // letter 是改状态时发的信的内容（#148）：待面试的时间、地点、说明，已录取的「接下来」，未通过的原因。
    // expected_status、expected_review_id 是控制台页面上看到的状态和审核记录的版本号（最大的审核记录 id，没有记录时是 0），
    // 和库里不同时回 409 status_changed，不改也不发信；要改状态时两项都得带。
    // template_id（#285）是这次发信选的模板，不传用这一类信的默认模板；要发信时必须是同一类、已启用的模板，否则回 400 template_invalid。
    body: object({
      status: text(32), expected_status: choices(...APPLICATION_STATUS_IDS), expected_review_id: integer(0), note: text(2000), notify: { type: "boolean" },
      template_id: templateId,
      letter: object({ time: text(60), place: text(120), notes: text(1000), message: text(1000) }),
    }),
    // 成功回 { application, review }，两项原样保留（开放对象）；失败体用共同的开放形状，409 status_changed 另带 application，400 letter_required 另带 fields。
    response: { 200: object({ application: freeObject, review: freeObject }), ...consoleFailures },
  },
  // 招聘邮件模板（#285）：模板的增删改查、预览、试发，以及投递详情里的信预览
  ...mailTemplateContracts,
  "GET /api/console/feedback": { querystring: object({ status: choices(...FEEDBACK_STATUSES), limit: limit(500) }) },
  "PATCH /api/console/feedback/:id": {
    ...noQuery,
    body: { ...object({ status: choices(...FEEDBACK_STATUSES), reply: text(5000) }), minProperties: 1 },
  },
  "GET /api/console/competitions": { ...noQuery, response: { 200: consoleCompetitionList, ...competitionFailures } },
  "POST /api/console/competitions": {
    ...noQuery,
    body: object({ ...competitionFields }, ["name", "kind", "start_at", "end_at"]),
    response: { 201: consoleCompetitionResult, ...competitionFailures },
  },
  "PATCH /api/console/competitions/:competition_id": {
    ...noQuery, ...competitionParams,
    body: { ...object({ ...competitionFields, offline: { type: "boolean" } }), minProperties: 1 },
    response: { 200: consoleCompetitionResult, ...competitionFailures },
  },
  "DELETE /api/console/competitions/:competition_id": { ...noQuery, ...competitionParams, response: { 200: competitionDeleted, ...competitionFailures } },
  "PUT /api/console/competitions/:competition_id/signup-settings": {
    ...noQuery, ...competitionParams,
    body: signupBody.settings,
    response: { 200: signupSettingsResult, ...competitionFailures },
  },
  "GET /api/console/competitions/:competition_id/roster": { ...noQuery, ...competitionParams, response: { 200: competitionRoster, ...competitionFailures } },
  // 200 是 text/csv 字符串（UTF-8 BOM、CRLF 换行），处理函数先设 Content-Type，Fastify 不会再按 JSON 序列化它；失败仍是 JSON。
  "GET /api/console/competitions/:competition_id/roster.csv": {
    ...noQuery, ...competitionParams,
    response: { 200: { type: "string", description: "text/csv; charset=utf-8" }, ...competitionFailures },
  },
  "GET /api/console/competitions/:competition_id/score-events": { ...noQuery, ...competitionParams, response: { 200: scoreEventList, ...competitionFailures } },
  "GET /api/console/competitions/:competition_id/score-preview": { ...competitionParams, ...scorePreviewQuery, response: { 200: scorePreview, ...competitionFailures } },
  "POST /api/console/competitions/:competition_id/score-events": {
    ...noQuery, ...competitionParams,
    body: signupBody.scoreEvent,
    response: { 201: scoreEventResult, ...competitionFailures },
  },
  "POST /api/console/competitions/:competition_id/score-events/:event_id/revoke": {
    ...noQuery, ...scoreEventParam,
    body: signupBody.revoke,
    response: { 200: scoreEventResult, ...competitionFailures },
  },
  // 比赛官网托管（#278）：上传的请求体是 zip（application/zip），不在这里写 body Schema
  "GET /api/console/competitions/:competition_id/site": { ...noQuery, ...competitionParams, response: { 200: consoleSiteState, ...competitionFailures } },
  "POST /api/console/competitions/:competition_id/site/versions": { ...noQuery, ...competitionParams, response: { 201: consoleSiteVersion, ...competitionFailures } },
  "POST /api/console/competitions/:competition_id/site/publish": { ...noQuery, ...competitionParams, body: sitePublishBody, response: { 200: consoleSiteState, ...competitionFailures } },
  "DELETE /api/console/competitions/:competition_id/site": { ...noQuery, ...competitionParams, response: { 200: consoleSiteState, ...competitionFailures } },
  // GitLab 候选贡献（#278）
  "GET /api/console/competitions/:competition_id/candidates": { ...competitionParams, ...candidateQuery, response: { 200: candidateList, ...competitionFailures } },
  "POST /api/console/competitions/:competition_id/candidates/:candidate_id/accept": { ...noQuery, ...candidateParam, body: candidateBody.accept, response: { 200: candidateResult, ...competitionFailures } },
  "POST /api/console/competitions/:competition_id/candidates/:candidate_id/reject": { ...noQuery, ...candidateParam, body: candidateBody.reject, response: { 200: candidateResult, ...competitionFailures } },
  "POST /api/console/competitions/:competition_id/candidates/collect": { ...noQuery, ...competitionParams, response: { 200: collectResult, ...competitionFailures } },
  // 年级系数、奖项与 GitLab 项目；定榜与兑奖（#278）
  "GET /api/console/competitions/:competition_id/rules": { ...noQuery, ...competitionParams, response: { 200: rulesView, ...competitionFailures } },
  "PUT /api/console/competitions/:competition_id/rules": { ...noQuery, ...competitionParams, body: rulesBody, response: { 200: rulesView, ...competitionFailures } },
  "GET /api/console/competitions/:competition_id/final": { ...noQuery, ...competitionParams, response: { 200: finalView, ...competitionFailures } },
  "POST /api/console/competitions/:competition_id/final": { ...noQuery, ...competitionParams, response: { 201: finalView, ...competitionFailures } },
  "DELETE /api/console/competitions/:competition_id/final": { ...noQuery, ...competitionParams, response: { 200: finalView, ...competitionFailures } },
  "POST /api/console/prizes/lookup": { ...noQuery, body: prizeCodeBody, response: { 200: redeemResult, ...competitionFailures } },
  "POST /api/console/prizes/redeem": { ...noQuery, body: prizeCodeBody, response: { 200: redeemResult, ...competitionFailures } },
  "DELETE /api/console/feedback/:id": noQuery,
  // 注册邀请码（#262）：次数上限、过期时间可以为空（不限）；邀请码本身建好后不能改
  "GET /api/console/invites": { ...noQuery, response: { 200: object({ invites: { type: "array", items: inviteView } }, ["invites"]), ...inviteFailures } },
  "POST /api/console/invites": {
    ...noQuery,
    body: object({
      code: { type: "string", pattern: INVITE_CODE_PATTERN }, note: text(100),
      max_uses: { anyOf: [integer(1, 100000), { type: "null" }] }, expires_at: { anyOf: [integer(0), { type: "null" }] },
    }, ["code"]),
    response: { 201: inviteView, ...inviteFailures },
  },
  "PATCH /api/console/invites/:id": {
    ...noQuery,
    body: object({
      note: text(100), max_uses: { anyOf: [integer(1, 100000), { type: "null" }] },
      expires_at: { anyOf: [integer(0), { type: "null" }] }, disabled: { type: "boolean" },
    }),
    response: { 200: inviteView, ...inviteFailures },
  },
  // #274 新权限体系（CONTRACT-274 §5）
  "GET /api/console/permissions/nodes": {
    ...noQuery,
    response: { 200: object({ nodes: { type: "array", items: nodeView }, domains: { type: "array", items: object({ id: { type: "string" }, label: text(32, 1) }, ["id", "label"]) } }, ["nodes", "domains"]) },
  },
  "GET /api/console/permissions/explain": {
    querystring: object({ account: accountId, node: { type: "string", minLength: 1, maxLength: 128 } }, ["account", "node"]),
    response: { 200: explainResult },
  },
  "GET /api/console/accounts/:id/effective": { ...noQuery, params: object({ id: accountId }, ["id"]), response: { 200: effectiveResult } },
  // 操作记录（CONTRACT-274 §4），取代旧的 /api/console/audit。
  "GET /api/console/activity": { querystring: activityQuery, response: { 200: activityListResult } },
  "GET /api/console/activity.csv": { querystring: activityQuery, response: { 200: { type: "string", description: "text/csv; charset=utf-8" } } },
  "GET /api/console/accounts/:id/activity": {
    querystring: activityQuery, params: object({ id: accountId }, ["id"]), response: { 200: accountActivityListResult },
  },
  "GET /api/console/permission-groups": { ...noQuery, response: { 200: object({ groups: { type: "array", items: groupView } }, ["groups"]) } },
  "POST /api/console/permission-groups": {
    ...noQuery,
    // id 的 custom.<slug> 格式校验留给路由自己做（回具体的 invalid_group_id），这里只管长度，
    // 不然格式不对会先被 Schema 挡成笼统的 validation_error。
    body: object({
      id: text(64, 1), name: text(64, 1), description: text(200),
      weight: integer(0, 100000), parents: { type: "array", items: groupId }, icon: text(64), tone: text(32),
    }, ["id", "name", "weight"]),
    response: { 201: groupView },
  },
  "PATCH /api/console/permission-groups/:id": {
    querystring: object({}),
    params: object({ id: groupId }, ["id"]),
    body: object({
      name: text(64, 1), description: text(200), weight: integer(0, 100000), parents: { type: "array", items: groupId },
      icon: { anyOf: [text(64), { type: "null" }] }, tone: { anyOf: [text(32), { type: "null" }] }, sort: integer(0, 100000),
      entries: object({
        add: { type: "array", items: object({ node: { type: "string" }, value: { type: "boolean" }, meta_value: text(200), scope: freeObject, expires_at: integer(0) }, ["node"]) },
        remove: { type: "array", items: integer(1) },
      }),
    }),
    response: { 200: groupView },
  },
  "DELETE /api/console/permission-groups/:id": {
    querystring: object({}), params: object({ id: groupId }, ["id"]),
    response: { 200: object({ ok: { type: "boolean" } }, ["ok"]) },
  },
  "GET /api/console/permission-groups/:id/members": {
    ...noQuery,
    params: object({ id: groupId }, ["id"]),
    response: { 200: object({ members: { type: "array", items: groupMemberView } }, ["members"]) },
  },
  "POST /api/console/permission-groups/:id/members": {
    querystring: object({}),
    params: object({ id: groupId }, ["id"]),
    body: object({ account_id: accountId, expires_at: integer(0) }, ["account_id"]),
    response: { 201: object({ ok: { type: "boolean" } }, ["ok"]) },
  },
  "DELETE /api/console/permission-groups/:id/members/:account_id": {
    querystring: object({}),
    params: object({ id: groupId, account_id: accountId }, ["id", "account_id"]),
    response: { 200: object({ ok: { type: "boolean" } }, ["ok"]) },
  },
  "GET /api/console/users": {
    querystring: object({
      q: text(100), level: choices("registered", "member", "alumni"), department: groupId,
      status: choices("active", "disabled"), cursor: text(2000),
    }),
    response: { 200: usersListResult },
  },
  "PATCH /api/console/users/:id": {
    querystring: object({}),
    params: object({ id: accountId }, ["id"]),
    body: object({
      status: choices("active", "disabled"), level: choices("registered", "member", "alumni"),
      department: { anyOf: [groupId, { type: "null" }] }, titles: { type: "array", items: groupId },
      real_name: { anyOf: [text(64, 1), { type: "null" }] }, grade: { anyOf: [selectableGrade, { type: "null" }] },
    }),
    // #274 残留修复 D：回和列表一样形状的完整行（userView），不是只有 account_id——否则控制台改完一行，
    // 不重新拉一次列表就看不到刚改的用户名、等级、部门这些字段。
    response: { 200: userView },
  },

  // ---- #276 论坛管理（分类可见范围、表情包） ---------------------------------------------------
  "GET /api/console/forum/categories": {
    querystring: object({}),
    response: { 200: object({ categories: { type: "array", items: object({ id: forumCategoryId, name: text(64, 1), visibility: visibilityChoice, topic_count: integer(0) }, ["id", "name", "visibility", "topic_count"]) } }, ["categories"]) },
  },
  "PATCH /api/console/forum/categories/:id": {
    querystring: object({}), params: object({ id: forumCategoryId }, ["id"]),
    body: object({ visibility: visibilityChoice }, ["visibility"]),
    response: { 200: object({ id: forumCategoryId, visibility: visibilityChoice }, ["id", "visibility"]) },
  },
  "GET /api/console/forum/stickers": {
    querystring: object({}),
    response: {
      200: object({
        packs: {
          type: "array",
          items: object({
            id: stickerPackId, name: text(64, 1), sort: integer(0, 100000), enabled: { type: "boolean" },
            stickers: {
              type: "array",
              items: object({
                id: stickerPackId, shortcode: stickerShortcode, label: text(FORUM_LIMITS.stickerLabelMax, 1), url: text(200, 1),
                sort: integer(0, 100000), enabled: { type: "boolean" }, use_count: integer(0),
              }, ["id", "shortcode", "label", "url", "sort", "enabled", "use_count"]),
            },
          }, ["id", "name", "sort", "enabled", "stickers"]),
        },
      }, ["packs"]),
    },
  },
  "POST /api/console/forum/sticker-packs": {
    querystring: object({}),
    body: object({ id: stickerPackId, name: text(64, 1) }, ["id", "name"]),
    response: { 201: object({ id: stickerPackId, name: text(64, 1) }, ["id", "name"]) },
  },
  "PATCH /api/console/forum/sticker-packs/:id": {
    querystring: object({}), params: object({ id: stickerPackId }, ["id"]),
    body: object({ name: text(64, 1), sort: integer(0, 100000), enabled: { type: "boolean" } }),
    response: { 200: object({ ok: { type: "boolean" } }, ["ok"]) },
  },
  "PATCH /api/console/forum/stickers/:id": {
    querystring: object({}), params: object({ id: stickerPackId }, ["id"]),
    body: object({ label: text(FORUM_LIMITS.stickerLabelMax, 1), sort: integer(0, 100000), enabled: { type: "boolean" } }),
    response: { 200: object({ ok: { type: "boolean" } }, ["ok"]) },
  },
  // 请求体是图片本身（同头像处理），这里只管路径与查询串；内容类型由路由自己的 addContentTypeParser 接。
  "PUT /api/console/forum/sticker-packs/:id/stickers": {
    params: object({ id: stickerPackId }, ["id"]),
    querystring: object({ shortcode: stickerShortcode, label: text(FORUM_LIMITS.stickerLabelMax, 1) }, ["shortcode", "label"]),
    response: { 201: object({ id: stickerPackId, shortcode: stickerShortcode, label: text(FORUM_LIMITS.stickerLabelMax, 1) }, ["id", "shortcode", "label"]) },
  },
};

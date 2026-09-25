import { choices, integer, object, text, type RouteContracts } from "../../lib/http-contracts.js";
import {
  APPLICATION_STATUS_IDS, ASSIGNABLE_ROLES, CAPABILITY_IDS, DEPARTMENT_ICONS, DEPARTMENT_ID_PATTERN, DEPARTMENT_TAG_PATTERN, TITLE_IDS, TITLE_TAG_PATTERN, TONE_IDS,
} from "../../lib/roles.js";
import { FEEDBACK_STATUSES } from "../../lib/feedback-store.js";

/** 与 config.GITHUB_LOGIN_REGEX 一致；这里写成 JSON Schema 可用的字符串。 */
const GITHUB_LOGIN_PATTERN = "^[A-Za-z0-9](?:[A-Za-z0-9]|-(?=[A-Za-z0-9])){0,38}$";
const UUID_PATTERN = "^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$";

const login = { type: "string", pattern: GITHUB_LOGIN_PATTERN };
const departmentId = { type: "string", pattern: DEPARTMENT_ID_PATTERN };
/** 权限包：只接受清单内的能力 id；仅舰长能力在路由里单独拒绝（captain_only_capability），重复项在存储时去重。 */
const bundle = { type: "array", items: choices(...CAPABILITY_IDS), maxItems: CAPABILITY_IDS.length * 2 };
/** 查询串里的有界正整数（coerceTypes 关闭，查询值都是字符串）。 */
const LIMIT_PATTERNS = { 200: "^(?:[1-9][0-9]?|1[0-9]{2}|200)$", 500: "^(?:[1-9][0-9]?|[1-4][0-9]{2}|500)$" } as const;
const limit = (max: keyof typeof LIMIT_PATTERNS) => ({ type: "string", pattern: LIMIT_PATTERNS[max] });
const offset = { type: "string", pattern: "^[0-9]{1,8}$" };
const noQuery = { querystring: object({}) };
const departmentFields = {
  name: text(12, 2), tag: { type: "string", pattern: DEPARTMENT_TAG_PATTERN },
  icon: choices(...DEPARTMENT_ICONS), tone: choices(...TONE_IDS), description: text(200),
  head_capabilities: bundle, member_capabilities: bundle, sort_order: integer(0, 10000),
};
const applicationParams = { params: object({ application_id: { type: "string", pattern: UUID_PATTERN } }, ["application_id"]) };

/** `/api/console/*` 的输入协议源。所有 body 与 query 都拒绝未知字段。 */
export const consoleContracts: RouteContracts = {
  "GET /api/console/me": noQuery,
  "GET /api/console/catalogue": noQuery,
  "GET /api/console/summary": noQuery,
  "GET /api/console/departments": noQuery,
  "POST /api/console/departments": {
    ...noQuery,
    body: object({ id: departmentId, ...departmentFields }, ["id", "name", "tag", "icon", "tone", "head_capabilities"]),
  },
  "PATCH /api/console/titles/:title_id": {
    ...noQuery,
    params: object({ title_id: choices(...TITLE_IDS) }, ["title_id"]),
    body: {
      ...object({
        label: { ...text(8, 1), pattern: "\\S" }, tag: { type: "string", pattern: TITLE_TAG_PATTERN }, icon: choices(...DEPARTMENT_ICONS),
        tone: choices(...TONE_IDS), description: text(200), capabilities: bundle,
      }),
      minProperties: 1,
    },
  },
  "PATCH /api/console/departments/:department_id": {
    ...noQuery,
    params: object({ department_id: departmentId }, ["department_id"]),
    body: { ...object({ ...departmentFields, archived: { type: "boolean" } }), minProperties: 1 },
  },
  "DELETE /api/console/departments/:department_id": {
    ...noQuery,
    params: object({ department_id: departmentId }, ["department_id"]),
  },
  "GET /api/console/assignments": {
    querystring: object({ department_id: departmentId, role: choices(...ASSIGNABLE_ROLES) }),
  },
  "POST /api/console/assignments": {
    ...noQuery,
    body: object({ github_login: login, role: choices(...ASSIGNABLE_ROLES), department_id: departmentId, note: text(200) }, ["github_login", "role"]),
  },
  "DELETE /api/console/assignments/:id": noQuery,
  "GET /api/console/people": noQuery,
  "GET /api/console/applications": {
    querystring: object({ status: choices(...APPLICATION_STATUS_IDS), q: text(100), limit: limit(200), offset }),
  },
  "GET /api/console/applications/export.csv": { querystring: object({ status: choices(...APPLICATION_STATUS_IDS) }) },
  "GET /api/console/applications/:application_id": { ...noQuery, ...applicationParams },
  "PATCH /api/console/applications/:application_id": {
    ...noQuery, ...applicationParams,
    // 空 body 交给路由返回 400 no_change，而不是笼统的 validation_error。
    body: object({ status: choices(...APPLICATION_STATUS_IDS), note: text(2000) }),
  },
  "GET /api/console/feedback": { querystring: object({ status: choices(...FEEDBACK_STATUSES), limit: limit(500) }) },
  "PATCH /api/console/feedback/:id": {
    ...noQuery,
    body: { ...object({ status: choices(...FEEDBACK_STATUSES), reply: text(5000) }), minProperties: 1 },
  },
  "DELETE /api/console/feedback/:id": noQuery,
  "GET /api/console/audit": { querystring: object({ limit: limit(200), offset, action: text(64) }) },
};

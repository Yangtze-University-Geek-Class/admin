import { choices, integer, nullableText, object, text } from "./http-contracts.js";

// Date 的有效上限须留出北京时间的八小时偏移，避免公开列表出现 NaN 日期。
const timestamp = integer(0, 8_640_000_000_000_000 - 8 * 3600_000);
export const competitionFields = {
  name: text(80, 2),
  kind: choices("internal", "external"),
  start_at: timestamp,
  end_at: timestamp,
  signup_deadline: { anyOf: [timestamp, { type: "null" }] },
  url: { anyOf: [{ ...text(500, 1), pattern: "^https://\\S+$" }, { type: "null" }] },
  description: text(1000),
};

/** 报名设置。请求体用带边界的整数（team_min/team_max 1–20），响应体不再校验下界（人数已入库）。 */
export const signupSettingsFields = {
  enabled: { type: "boolean" },
  participation: choices("individual", "team"),
  team_min: integer(1, 20),
  team_max: integer(1, 20),
  scoring: choices("none", "contribution"),
};
const signupSummary = object(signupSettingsFields, Object.keys(signupSettingsFields));

const baseFields = {
  id: text(128, 1), ...competitionFields,
  status: choices("upcoming", "registering", "closed", "ongoing", "ended"),
};
const publicFields = { ...baseFields, signup: signupSummary };
const publicRecord = object(publicFields, Object.keys(publicFields));
const consoleFields = { ...baseFields, offline: { type: "boolean" } };
const consoleRecord = object(consoleFields, Object.keys(consoleFields));

export const publicCompetitionList = object({ competitions: { type: "array", items: publicRecord } }, ["competitions"]);
/** 单场公开接口的响应：与列表项字段完全一致。 */
export const publicCompetition = publicRecord;
export const consoleCompetitionList = object({ competitions: { type: "array", items: consoleRecord } }, ["competitions"]);
export const consoleCompetitionResult = object({ competition: consoleRecord }, ["competition"]);
export const competitionDeleted = object({ ok: { type: "boolean", const: true } }, ["ok"]);

// 报名、组队与名单（#239）：请求体只收契约里的字段，响应契约列出接口给出的全部字段
// （fast-json-stringify 会丢掉契约外的字段，少写一个就等于接口不返回它）。
const number = { type: "integer" };
const stateValues = ["none", "signed_up", "in_team", "confirmed", "unplaced"] as const;

const personFields = { account_id: text(64, 1), login: text(64), avatar_url: nullableText(500) };
const person = object(personFields, Object.keys(personFields));
const teamMember = object({ ...personFields, role: choices("leader", "member"), joined_at: number }, ["account_id", "login", "avatar_url", "role", "joined_at"]);
const teamFields = {
  id: text(64, 1), name: text(30, 1), slogan: text(60),
  status: choices("recruiting", "locked"),
  leader_account_id: text(64, 1),
  members: { type: "array", items: teamMember },
  member_count: number, created_at: number,
};
const team = object(teamFields, Object.keys(teamFields));
const pending = object({
  membership_id: text(64, 1),
  kind: choices("application", "invitation"),
  team_id: text(64, 1), team_name: text(30, 1),
  person, message: text(100), created_at: number,
}, ["membership_id", "kind", "team_id", "team_name", "person", "message", "created_at"]);
const stats = object({
  signups: number, teams: number, locked_teams: number, confirmed_people: number, unplaced: number,
}, ["signups", "teams", "locked_teams", "confirmed_people", "unplaced"]);
const mySignup = object({
  status: choices("active", "cancelled"), note: text(200), looking_for_team: { type: "boolean" },
  created_at: number, updated_at: number,
}, ["status", "note", "looking_for_team", "created_at", "updated_at"]);

const myStatusFields = {
  competition_id: text(128, 1),
  settings: signupSummary,
  writable: { type: "boolean" },
  signup: { anyOf: [mySignup, { type: "null" }] },
  state: choices(...stateValues),
  team: { anyOf: [team, { type: "null" }] },
  role: { anyOf: [choices("leader", "member"), { type: "null" }] },
  pending: { type: "array", items: pending },
  stats,
  actions: { type: "array", items: { type: "string" } },
};
/** `GET .../my-status` 与全部成员写操作的响应体：操作完就是最新的「我的状态」。 */
export const myStatus = object(myStatusFields, Object.keys(myStatusFields));

const myTeamSummary = object({ id: text(64, 1), name: text(30, 1), status: choices("recruiting", "locked"), member_count: number, team_max: number },
  ["id", "name", "status", "member_count", "team_max"]);
const myCompetitionItem = object({
  competition_id: text(128, 1), name: text(80, 1), kind: choices("internal", "external"),
  status: choices("upcoming", "registering", "closed", "ongoing", "ended"),
  start_at: number, end_at: number, signup_deadline: { anyOf: [number, { type: "null" }] },
  state: choices(...stateValues), team: { anyOf: [myTeamSummary, { type: "null" }] },
  pending_count: number,
}, ["competition_id", "name", "kind", "status", "start_at", "end_at", "signup_deadline", "state", "team", "pending_count"]);
export const myCompetitionList = object({
  items: { type: "array", items: myCompetitionItem }, pending_total: number,
}, ["items", "pending_total"]);

export const teamList = object({ teams: { type: "array", items: team } }, ["teams"]);
export const freeAgentList = object({
  people: { type: "array", items: object({ ...personFields, note: text(200), since: number }, ["account_id", "login", "avatar_url", "note", "since"]) },
}, ["people"]);

/**
 * 控制台名单：报名含已取消、队伍含已解散；`status` 在 `team` 的基础上多一个 `disbanded`。
 * 响应契约里的状态枚举按名单实际返回的值写，避免序列化时把 disbanded 丢掉。
 */
const rosterTeam = object({ ...teamFields, status: choices("recruiting", "locked", "disbanded"), disbanded_at: { anyOf: [number, { type: "null" }] } },
  ["id", "name", "slogan", "status", "leader_account_id", "members", "member_count", "created_at", "disbanded_at"]);
const rosterSignup = object({
  ...personFields,
  status: choices("active", "cancelled"), note: text(200), looking_for_team: { type: "boolean" },
  team_id: { anyOf: [text(64, 1), { type: "null" }] },
  team_name: { anyOf: [text(30, 1), { type: "null" }] },
  role: { anyOf: [choices("leader", "member"), { type: "null" }] },
  created_at: number, updated_at: number, cancelled_at: { anyOf: [number, { type: "null" }] },
}, ["account_id", "login", "avatar_url", "status", "note", "looking_for_team", "team_id", "team_name", "role", "created_at", "updated_at", "cancelled_at"]);
export const competitionRoster = object({
  settings: signupSummary, stats,
  signups: { type: "array", items: rosterSignup },
  teams: { type: "array", items: rosterTeam },
}, ["settings", "stats", "signups", "teams"]);
export const signupSettingsResult = object({ settings: signupSummary }, ["settings"]);

// 积分账本（#239 第二部分）：控制台登记与撤销，门户只读天梯。
const scoreEventFields = {
  id: text(64, 1), competition_id: text(128, 1), person,
  kind: choices("issue", "pr", "penalty"),
  repo: { anyOf: [text(140), { type: "null" }] },
  number: { anyOf: [number, { type: "null" }] },
  points: number, reason: text(200), status: choices("active", "revoked"),
  created_by_login: text(64), created_at: number,
  revoked_at: { anyOf: [number, { type: "null" }] },
  revoke_reason: { anyOf: [text(200), { type: "null" }] },
};
const scoreEvent = object(scoreEventFields, Object.keys(scoreEventFields));
export const scoreEventList = object({ events: { type: "array", items: scoreEvent } }, ["events"]);
export const scoreEventResult = object({ event: scoreEvent }, ["event"]);

const leaderboardIndividual = object({
  rank: number, person, team: { anyOf: [object({ id: text(64, 1), name: text(30, 1) }, ["id", "name"]), { type: "null" }] },
  points: number, issues: number, prs: number, penalties: number,
}, ["rank", "person", "team", "points", "issues", "prs", "penalties"]);
const leaderboardTeam = object({
  rank: number, team: object({ id: text(64, 1), name: text(30, 1), status: choices("recruiting", "locked") }, ["id", "name", "status"]),
  points: number, member_count: number,
}, ["rank", "team", "points", "member_count"]);
export const competitionLeaderboard = object({
  updated_at: number,
  individuals: { type: "array", items: leaderboardIndividual },
  teams: { type: "array", items: leaderboardTeam },
}, ["updated_at", "individuals", "teams"]);

/** 报名与组队接口的入参（请求体只收这些字段）。 */
export const signupBody = {
  signup: object({ note: text(200), looking_for_team: { type: "boolean" } }),
  teamCreate: object({ name: text(30, 2), slogan: text(60) }, ["name"]),
  apply: object({ message: text(100) }),
  invite: object({ account_id: text(64, 1) }, ["account_id"]),
  respond: object({ membership_id: text(64, 1), action: choices("accept", "decline", "withdraw") }, ["membership_id", "action"]),
  transfer: object({ account_id: text(64, 1) }, ["account_id"]),
  settings: object(signupSettingsFields, Object.keys(signupSettingsFields)),
  scoreEvent: object({
    account_id: text(64, 1), kind: choices("issue", "pr", "penalty"),
    repo: text(140), number: integer(1, 1_000_000), points: integer(-50, 100), reason: text(200),
  }, ["account_id", "kind", "points"]),
  revoke: object({ reason: text(200) }),
};

/** 比赛、队伍与积分的路径参数：比赛 id 是 UUID 或种子里的 slug，不能按纯数字校验。 */
export const competitionIdParam = { params: object({ id: text(128, 1) }, ["id"]) };
export const consoleCompetitionIdParam = { params: object({ competition_id: text(128, 1) }, ["competition_id"]) };
export const teamIdParam = { params: object({ id: text(64, 1) }, ["id"]) };
export const scoreEventParam = {
  params: object({ competition_id: text(128, 1), event_id: text(64, 1) }, ["competition_id", "event_id"]),
};


// 保留共同错误处理器的扩展字段（如 capability），不因成功响应补契约而改变拒绝路径。
const failure = object({
  error: { type: "string" }, message: { type: "string" },
  request_id: { type: "string" }, capability: { type: "string" },
}, ["error"], true);
export const competitionFailures = { "4xx": failure, "5xx": failure };

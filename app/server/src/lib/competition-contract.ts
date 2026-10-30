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
  // 规划中（#278，所有者 2026-10-25）：开赛前拒绝报名与组队；创建、修改都可选，不填按不规划处理。
  planning: { type: "boolean" },
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
  status: choices("planning", "upcoming", "registering", "closed", "ongoing", "ended"),
};
// #278：官网地址（已发布时 /c/<slug>/）、门户深链、可选的奖项、年级系数和定榜时间
const prizeTierFields = { from: integer(1, 100), to: integer(1, 100), amount_cny: integer(0, 100_000), title: text(40) };
export const prizeTier = object(prizeTierFields, Object.keys(prizeTierFields));
const publicGradeFactor = object({ grade: text(16, 1), label: text(16, 1), factor: { type: "number" } }, ["grade", "label", "factor"]);
// 两档评定（所有者 2026-10-24 16:59）：重要程度 × 核心度查基础分表，官网、门户、控制台照着 `scoring` 画表
const importanceValue = choices("normal", "important", "critical");
const coreValue = choices("edge", "business", "core");
const scoringFields = {
  importance: { type: "array", items: object({ key: importanceValue, label: text(8, 1) }, ["key", "label"]) },
  core: { type: "array", items: object({ key: coreValue, label: text(8, 1), hint: text(40) }, ["key", "label", "hint"]) },
  points: { type: "array", items: object({ kind: choices("issue", "pr"), importance: importanceValue, core: coreValue, points: { type: "integer" } }, ["kind", "importance", "core", "points"]) },
  penalty: { type: "integer" },
  trivial_per_week: { type: "integer" },
  trivial_percent: { type: "integer" },
};
const scoring = object(scoringFields, Object.keys(scoringFields));
const publicFields = {
  ...baseFields, signup: signupSummary,
  site_url: nullableText(200), app_url: text(300, 1),
  prizes: { type: "array", items: prizeTier },
  grade_factors: { type: "array", items: publicGradeFactor },
  scoring,
  finalized_at: { anyOf: [timestamp, { type: "null" }] },
};
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
// 组队广场广播（#278 重开）：和 status 的 recruiting/locked 是两件事，领队单独开关，见 competition-signup-store.ts 的 TeamPlaza。
const teamPlaza = object({
  recruiting: { type: "boolean" }, note: text(150), wanted_skills: { type: "array", maxItems: 10, items: text(20) },
  updated_at: { anyOf: [number, { type: "null" }] },
}, ["recruiting", "note", "wanted_skills", "updated_at"]);
const teamFields = {
  id: text(64, 1), name: text(30, 1), slogan: text(60),
  status: choices("recruiting", "locked"),
  leader_account_id: text(64, 1),
  members: { type: "array", items: teamMember },
  member_count: number, created_at: number,
  plaza: teamPlaza,
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
  status: choices("planning", "upcoming", "registering", "closed", "ongoing", "ended"),
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
  ["id", "name", "slogan", "status", "leader_account_id", "members", "member_count", "created_at", "plaza", "disbanded_at"]);
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
/** 控制台移出（#342）的结果：对队伍做了什么，已确认的队伍是否退回招募中。 */
export const signupRemoveResult = object({
  team_action: choices("none", "left", "transferred", "disbanded"), unlocked: { type: "boolean" },
}, ["team_action", "unlocked"]);

// 积分账本（#239 第二部分）：控制台登记与撤销，门户只读天梯。
const scoreEventFields = {
  id: text(64, 1), competition_id: text(128, 1), person,
  kind: choices("issue", "pr", "penalty"),
  repo: { anyOf: [text(140), { type: "null" }] },
  number: { anyOf: [number, { type: "null" }] },
  points: number,
  importance: { anyOf: [importanceValue, { type: "null" }] },
  core: { anyOf: [coreValue, { type: "null" }] },
  grade: { anyOf: [choices("year1", "year2", "year3", "year4", "graduated", "none"), { type: "null" }] },
  grade_factor: { anyOf: [number, { type: "null" }] },
  damp_percent: { anyOf: [number, { type: "null" }] },
  weighted_points: number,
  contributed_at: { anyOf: [number, { type: "null" }] },
  reason: text(200), status: choices("active", "revoked"),
  created_by_login: text(64), created_at: number,
  revoked_at: { anyOf: [number, { type: "null" }] },
  revoke_reason: { anyOf: [text(200), { type: "null" }] },
};
const scoreEvent = object(scoreEventFields, Object.keys(scoreEventFields));
export const scoreEventList = object({ events: { type: "array", items: scoreEvent } }, ["events"]);
export const scoreEventResult = object({ event: scoreEvent }, ["event"]);
/** 登记前试算：和真正登记用同一套算法，不写库。`at` 是贡献发生的时间（候选的 contributed_at），不给按现在算。 */
export const scorePreviewQuery = {
  querystring: object({
    account_id: text(64, 1), kind: choices("issue", "pr", "penalty"), importance: importanceValue, core: coreValue,
    at: { type: "string", pattern: "^[0-9]{1,15}$" },
  }, ["account_id", "kind"]),
};
export const scorePreview = object({
  points: number,
  grade: { anyOf: [choices("year1", "year2", "year3", "year4", "graduated", "none"), { type: "null" }] },
  grade_factor: number, damp_percent: number, weighted_points: number,
}, ["points", "grade", "grade_factor", "damp_percent", "weighted_points"]);

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
  plaza: object({ recruiting: { type: "boolean" }, note: text(150), wanted_skills: { type: "array", maxItems: 10, items: text(20) } }, ["recruiting"]),
  scoreEvent: object({
    account_id: text(64, 1), kind: choices("issue", "pr", "penalty"),
    repo: text(140), number: integer(1, 1_000_000), importance: importanceValue, core: coreValue, reason: text(200),
  }, ["account_id", "kind"]),
  revoke: object({ reason: text(200) }),
};

// ── 组队广场（#278 重开）：跨比赛一张列表，和 publicFeed 对 pr/issue/penalty 的处理一样，两种条目合成一张
// 扁平表，`kind` 决定哪些字段有值，另一种用不到的字段为 null，不单独开 oneOf。
const plazaEntry = object({
  kind: choices("seeking_team", "recruiting_team"),
  competition_id: text(128, 1), competition_name: text(80, 1),
  note: text(150), since: number,
  person: { anyOf: [person, { type: "null" }] },
  team_id: { anyOf: [text(64, 1), { type: "null" }] },
  team_name: { anyOf: [text(30, 1), { type: "null" }] },
  slogan: { anyOf: [text(60), { type: "null" }] },
  leader: { anyOf: [person, { type: "null" }] },
  member_count: { anyOf: [number, { type: "null" }] },
  team_max: { anyOf: [number, { type: "null" }] },
  wanted_skills: { anyOf: [{ type: "array", items: text(20) }, { type: "null" }] },
}, ["kind", "competition_id", "competition_name", "note", "since", "person", "team_id", "team_name", "slogan", "leader", "member_count", "team_max", "wanted_skills"]);
export const teamPlazaPage = object({ items: { type: "array", items: plazaEntry }, next_cursor: nullableText(200) }, ["items", "next_cursor"]);
export const teamPlazaQuery = {
  querystring: object({
    competition_id: text(128, 1), kind: choices("seeking_team", "recruiting_team"), keyword: text(60),
    cursor: text(200), limit: { type: "string", pattern: "^(?:[1-9][0-9]?|50)$" },
  }),
};

// ── #278 公开接口（官网 SDK）：只有昵称、@用户名、头像、队名、分数、贡献标题与链接、时间 ──
const publicPersonFields = { username: text(64), display_name: text(64), avatar_url: nullableText(500) };
const publicPerson = object(publicPersonFields, Object.keys(publicPersonFields));
export const publicLeaderboard = object({
  updated_at: number,
  individuals: { type: "array", items: object({ rank: number, ...publicPersonFields, team_name: nullableText(30), score: number }, ["rank", "username", "display_name", "avatar_url", "team_name", "score"]) },
  teams: { type: "array", items: object({ rank: number, name: text(30), members: { type: "array", items: publicPerson }, score: number }, ["rank", "name", "members", "score"]) },
}, ["updated_at", "individuals", "teams"]);
export const publicFeed = object({
  items: { type: "array", items: object({
    id: text(64, 1), at: number, ...publicPersonFields, kind: choices("pr", "issue", "penalty"),
    title: nullableText(200), url: nullableText(500), points: number,
    importance: { anyOf: [importanceValue, { type: "null" }] }, core: { anyOf: [coreValue, { type: "null" }] },
  }, ["id", "at", "username", "display_name", "avatar_url", "kind", "title", "url", "points", "importance", "core"]) },
  next_cursor: nullableText(200),
}, ["items", "next_cursor"]);
export const publicStats = object({
  participants: number, teams: number, merged_prs: number, accepted_issues: number, total_points: number, updated_at: number,
}, ["participants", "teams", "merged_prs", "accepted_issues", "total_points", "updated_at"]);
export const publicSnapshot = object({ competition: publicRecord, leaderboard: publicLeaderboard, feed: publicFeed, stats: publicStats }, ["competition", "leaderboard", "feed", "stats"]);
export const publicFeedQuery = { querystring: object({ cursor: text(200), limit: { type: "string", pattern: "^(?:[1-9]|[1-4][0-9]|50)$" } }) };

// ── #278 站点包必带的两个接口：人员（全部已报名，不是只有拿过分的）、队伍（全部未解散，个人赛 enabled=false） ──
const publicDepartment = { anyOf: [object({ id: text(64, 1), name: text(64, 1), tone: { anyOf: [text(20), { type: "null" }] } }, ["id", "name", "tone"]), { type: "null" }] };
export const publicParticipants = object({
  items: { type: "array", items: object({ ...publicPersonFields, department: publicDepartment }, ["username", "display_name", "avatar_url", "department"]) },
  next_cursor: nullableText(200),
}, ["items", "next_cursor"]);
export const publicParticipantsQuery = { querystring: object({ cursor: text(200), limit: { type: "string", pattern: "^(?:[1-9][0-9]?|1[0-9]{2}|200)$" } }) };
export const publicTeams = object({
  enabled: { type: "boolean" }, team_min: number, team_max: number,
  teams: { type: "array", items: object({
    name: text(30), slogan: text(60), status: choices("recruiting", "locked"), member_count: number,
    members: { type: "array", items: publicPerson },
  }, ["name", "slogan", "status", "member_count", "members"]) },
}, ["enabled", "team_min", "team_max", "teams"]);
/** 本人参加过、已定榜的比赛的结果（门户「我的参赛」）：兑奖码只在这里给本人看。 */
export const myCompetitionResults = object({
  items: { type: "array", items: object({
    competition_id: text(128, 1), name: text(80, 1), finalized_at: number, rank: { anyOf: [number, { type: "null" }] }, points: number,
    prize: { anyOf: [object({ amount_cny: number, title: text(40), code: text(32, 1), redeemed_at: { anyOf: [number, { type: "null" }] } }, ["amount_cny", "title", "code", "redeemed_at"]), { type: "null" }] },
  }, ["competition_id", "name", "finalized_at", "rank", "points", "prize"]) },
}, ["items"]);

// ── #278 控制台：官网、候选贡献、规则、定榜与兑奖 ──
const consolePersonFields = { account_id: text(64, 1), ...publicPersonFields };
const consolePerson = object(consolePersonFields, Object.keys(consolePersonFields));
const nullablePerson = { anyOf: [consolePerson, { type: "null" }] };
const siteVersion = object({
  id: text(64, 1), version: text(32), size: number, files: number, sha256: text(64), status: choices("passed", "rejected"),
  report: { type: "array", items: text(400) },
  uploaded_by: object({ account_id: text(64, 1), username: text(64), display_name: text(64) }, ["account_id", "username", "display_name"]),
  created_at: number, preview_url: nullableText(300),
}, ["id", "version", "size", "files", "sha256", "status", "report", "uploaded_by", "created_at", "preview_url"]);
export const consoleSiteVersion = siteVersion;
export const consoleSiteState = object({
  slug: nullableText(32), live_version_id: nullableText(64), site_url: nullableText(200), versions: { type: "array", items: siteVersion },
}, ["slug", "live_version_id", "site_url", "versions"]);
export const sitePublishBody = object({ version_id: text(64, 1), slug: { type: "string", pattern: "^[a-z0-9][a-z0-9-]{2,31}$" } }, ["version_id"]);

const collectRun = object({
  at: number, fetched: number, created: number, skipped: number, accepted: number, revoked: number, error: nullableText(64),
}, ["at", "fetched", "created", "skipped", "accepted", "revoked", "error"]);
const candidate = object({
  id: text(64, 1), account: consolePerson, kind: choices("pr", "issue"), gitlab_project: text(255, 1), gitlab_iid: number,
  url: text(500), title: text(200),
  importance: { anyOf: [importanceValue, { type: "null" }] }, core: { anyOf: [coreValue, { type: "null" }] },
  status: choices("pending", "accepted", "rejected"), final_points: { anyOf: [number, { type: "null" }] }, reason: nullableText(200),
  reviewed_by: nullablePerson, reviewed_at: { anyOf: [number, { type: "null" }] },
  accepted_via: { anyOf: [choices("label", "console"), { type: "null" }] }, note: nullableText(300),
  contributed_at: number, created_at: number,
}, ["id", "account", "kind", "gitlab_project", "gitlab_iid", "url", "title", "importance", "core", "status", "final_points", "reason",
  "reviewed_by", "reviewed_at", "accepted_via", "note", "contributed_at", "created_at"]);
export const candidateList = object({
  items: { type: "array", items: candidate }, next_cursor: nullableText(80),
  counts: object({ pending: number, accepted: number, rejected: number }, ["pending", "accepted", "rejected"]),
  last_run: { anyOf: [collectRun, { type: "null" }] },
}, ["items", "next_cursor", "counts", "last_run"]);
export const candidateResult = object({ candidate }, ["candidate"]);
export const collectResult = object({ last_run: collectRun }, ["last_run"]);
export const candidateQuery = { querystring: object({ status: choices("pending", "accepted", "rejected"), cursor: { type: "string", pattern: "^[0-9]{1,15}_[0-9a-f-]{36}$" } }) };
export const candidateParam = { params: object({ competition_id: text(128, 1), candidate_id: text(64, 1) }, ["competition_id", "candidate_id"]) };
export const candidateBody = {
  accept: object({ importance: importanceValue, core: coreValue, reason: text(200) }, ["importance", "core"]),
  reject: object({ reason: text(200, 1) }, ["reason"]),
};

const gradeFactorsFields = Object.fromEntries(["year1", "year2", "year3", "year4", "graduated", "none"].map(key => [key, integer(50, 500)]));
const gradeFactorsObject = object(gradeFactorsFields, Object.keys(gradeFactorsFields));
export const rulesView = object({
  grade_factors: gradeFactorsObject,
  grades: { type: "array", items: object({ grade: text(16, 1), label: text(16, 1) }, ["grade", "label"]) },
  prizes: { type: "array", items: prizeTier },
  gitlab_projects: { type: "array", items: text(255, 1) },
  scoring,
  updated_at: { anyOf: [number, { type: "null" }] }, updated_by: nullablePerson, finalized: { type: "boolean" },
}, ["grade_factors", "grades", "prizes", "gitlab_projects", "scoring", "updated_at", "updated_by", "finalized"]);
export const rulesBody = object({
  grade_factors: gradeFactorsObject,
  prizes: { type: "array", maxItems: 20, items: prizeTier },
  gitlab_projects: { type: "array", maxItems: 10, items: { type: "string", pattern: "^[A-Za-z0-9_.-]+(?:/[A-Za-z0-9_.-]+){1,4}$", maxLength: 255 } },
}, ["grade_factors", "prizes", "gitlab_projects"]);

const prizeFields = {
  id: text(64, 1), competition_id: text(128, 1), rank: number, points: number, amount_cny: number, title: text(40),
  account: consolePerson, code_hint: text(4), created_at: number,
  redeemed_at: { anyOf: [number, { type: "null" }] }, redeemed_by: nullablePerson,
};
const prize = object(prizeFields, Object.keys(prizeFields));
export const finalView = object({
  finalized_at: { anyOf: [number, { type: "null" }] }, finalized_by: nullablePerson,
  standings: { type: "array", items: object({ rank: number, points: number, account: consolePerson }, ["rank", "points", "account"]) },
  prizes: { type: "array", items: prize },
  preview: { type: "array", items: object({
    rank: number, points: number, account: consolePerson,
    amount_cny: { anyOf: [number, { type: "null" }] }, title: { anyOf: [text(40), { type: "null" }] },
  }, ["rank", "points", "account", "amount_cny", "title"]) },
}, ["finalized_at", "finalized_by", "standings", "prizes", "preview"]);
export const redeemResult = object({
  prize: object({ ...prizeFields, competition_name: text(80) }, [...Object.keys(prizeFields), "competition_name"]),
}, ["prize"]);
export const prizeCodeBody = object({ code: text(64, 1) }, ["code"]);

/** 比赛、队伍与积分的路径参数：比赛 id 是 UUID 或种子里的 slug，不能按纯数字校验。 */
export const competitionIdParam = { params: object({ id: text(128, 1) }, ["id"]) };
export const consoleCompetitionIdParam = { params: object({ competition_id: text(128, 1) }, ["competition_id"]) };
export const teamIdParam = { params: object({ id: text(64, 1) }, ["id"]) };
export const scoreEventParam = {
  params: object({ competition_id: text(128, 1), event_id: text(64, 1) }, ["competition_id", "event_id"]),
};
export const signupAccountParam = {
  params: object({ competition_id: text(128, 1), account_id: text(64, 1) }, ["competition_id", "account_id"]),
};


// 保留共同错误处理器的扩展字段（如 capability），不因成功响应补契约而改变拒绝路径。
const failure = object({
  error: { type: "string" }, message: { type: "string" },
  request_id: { type: "string" }, capability: { type: "string" },
}, ["error"], true);
export const competitionFailures = { "4xx": failure, "5xx": failure };

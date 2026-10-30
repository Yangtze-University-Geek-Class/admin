// 比赛报名与组队（#239）：全部业务规则在服务端，只接普通参数与 `now`，不碰 HTTP。
//
// 认人只认极客班账号 `account_id`（会话里的 `users.id`），不按 GitHub 登录名兜底；昵称与头像读取时从绑定的
// GitHub 身份取最新值，比赛表不存快照。所有写操作在一个事务里重读状态再写，唯一索引兜底并发；
// 状态冲突返回稳定的错误码，路由映射成 400 / 403 / 404 / 409，不在路由里重复判断规则。
import { randomUUID } from "node:crypto";
import type Database from "better-sqlite3";
import { competitionStatus, type CompetitionRecord, type CompetitionStore } from "./competition-store.js";
import type { Avatars } from "./avatars.js";

export type SignupParticipation = "individual" | "team";
export type SignupScoring = "none" | "contribution";

/** 报名设置；没有设置行的比赛按默认值（未开放报名）处理，旧比赛的行为不变。 */
export type SignupSettings = {
  enabled: boolean;
  participation: SignupParticipation;
  team_min: number;
  team_max: number;
  scoring: SignupScoring;
};
export const DEFAULT_SIGNUP_SETTINGS: SignupSettings = Object.freeze({
  enabled: false, participation: "individual", team_min: 1, team_max: 1, scoring: "none",
});

/** 一个人的公开资料：账号、绑定的 GitHub 登录名与头像（统一头像，lib/avatars.ts，#343；统一资料上线前就是这个形状）。 */
export type Person = { account_id: string; login: string; avatar_url: string | null };
export type TeamMember = Person & { role: "leader" | "member"; joined_at: number };
/**
 * 队伍在组队广场（#278 重开）的广播状态：和 `status` 的 recruiting/locked 是两件事——`status` 决定还能不能
 * 被申请，这里决定要不要在广场公开求人；领队单独开关，不跟着 lock/unlock 联动。
 */
export type TeamPlaza = { recruiting: boolean; note: string; wanted_skills: string[]; updated_at: number | null };
export type Team = {
  id: string; name: string; slogan: string;
  status: "recruiting" | "locked";
  leader_account_id: string;
  members: TeamMember[];
  member_count: number;
  created_at: number;
  plaza: TeamPlaza;
};
export type Pending = {
  membership_id: string;
  kind: "application" | "invitation";
  team_id: string;
  team_name: string;
  person: Person;
  message: string;
  created_at: number;
};
export type Stats = { signups: number; teams: number; locked_teams: number; confirmed_people: number; unplaced: number };
export type MyState = "none" | "signed_up" | "in_team" | "confirmed" | "unplaced";
export type SignupAction =
  | "signup" | "update_signup" | "cancel_signup"
  | "create_team" | "apply" | "invite" | "lock" | "unlock" | "transfer" | "disband" | "leave";
export type MyStatus = {
  competition_id: string;
  settings: SignupSettings;
  writable: boolean;
  signup: { status: "active" | "cancelled"; note: string; looking_for_team: boolean; created_at: number; updated_at: number } | null;
  state: MyState;
  team: Team | null;
  role: "leader" | "member" | null;
  pending: Pending[];
  stats: Stats;
  actions: SignupAction[];
};
export type MyCompetitionItem = {
  competition_id: string; name: string; kind: "internal" | "external"; status: string;
  start_at: number; end_at: number; signup_deadline: number | null;
  state: MyState;
  team: { id: string; name: string; status: "recruiting" | "locked"; member_count: number; team_max: number } | null;
  pending_count: number;
};
export type FreeAgent = Person & { note: string; since: number };
/** 控制台名单：含已取消的报名与已解散的队伍。 */
export type RosterSignup = Person & {
  status: "active" | "cancelled"; note: string; looking_for_team: boolean;
  team_id: string | null; team_name: string | null; role: "leader" | "member" | null;
  created_at: number; updated_at: number; cancelled_at: number | null;
};
export type RosterTeam = Omit<Team, "status"> & { status: "recruiting" | "locked" | "disbanded"; disbanded_at: number | null };
export type Roster = { settings: SignupSettings; stats: Stats; signups: RosterSignup[]; teams: RosterTeam[] };
/** 控制台移出（#342）对队伍做了什么：不在队伍里、退出、交出领队后退出、解散；`unlocked` 是已确认的队伍是否退回了招募中。 */
export type SignupRemoval = { team_action: "none" | "left" | "transferred" | "disbanded"; unlocked: boolean };

/**
 * 业务错误的稳定错误码。状态冲突一律 409（输入不合法才 400），与报名、组队的提示文案一一对应。
 * 控制台的报名设置与 #238 的比赛写入共用这张表，审计与路由不另写一份。
 */
export type SignupErrorCode =
  | "not_found" | "team_not_found" | "not_team_leader"
  | "competition_planning" | "signup_not_enabled" | "signup_closed" | "not_signed_up" | "individual_competition"
  | "already_in_team" | "already_applied" | "already_invited" | "invitee_not_signed_up" | "target_not_member"
  | "team_full" | "team_too_small" | "team_locked" | "duplicate_team_name" | "is_team_leader" | "invalid_state"
  | "bad_note" | "bad_team_name" | "bad_slogan" | "bad_message" | "bad_team_size"
  | "deadline_required" | "has_signups" | "kind_locked" | "team_size_conflict"
  | "bad_plaza_note" | "bad_plaza_skills" | "competition_finalized";

export const SIGNUP_ERRORS: Record<SignupErrorCode, { status: number; message: string }> = {
  competition_finalized: { status: 409, message: "这场比赛已经定榜，名单与报名设置不能再改" },
  not_found: { status: 404, message: "比赛不存在或已下线" },
  team_not_found: { status: 404, message: "队伍不存在或已解散" },
  not_team_leader: { status: 403, message: "只有领队能做这个操作" },
  // 规划中（#278）：组织者还在筹备，开赛前一律拒绝报名与组队，和「还没开放」「已经截止」是三件不同的事。
  competition_planning: { status: 409, message: "比赛还在规划中，暂未开放报名" },
  signup_not_enabled: { status: 409, message: "这场比赛还没有开放报名" },
  signup_closed: { status: 409, message: "报名已截止，这场比赛进入只读" },
  not_signed_up: { status: 409, message: "请先报名这场比赛" },
  individual_competition: { status: 409, message: "个人赛不能组队" },
  already_in_team: { status: 409, message: "你已经在队伍里了" },
  already_applied: { status: 409, message: "已经申请过这支队伍，等领队处理" },
  already_invited: { status: 409, message: "已经邀请过这位成员，等对方处理" },
  invitee_not_signed_up: { status: 409, message: "对方还没有报名这场比赛" },
  target_not_member: { status: 409, message: "对方不是极客班成员，或账号已停用" },
  team_full: { status: 409, message: "队伍已满员" },
  team_too_small: { status: 409, message: "在队人数还没到最低人数" },
  team_locked: { status: 409, message: "队伍已确认参赛，请先撤销确认" },
  duplicate_team_name: { status: 409, message: "已经有同名队伍" },
  is_team_leader: { status: 409, message: "领队要先转让领队或解散队伍" },
  invalid_state: { status: 409, message: "这条申请或邀请已经处理过了" },
  bad_note: { status: 400, message: "备注最多 200 字" },
  bad_team_name: { status: 400, message: "队名需要 2–30 个字符" },
  bad_slogan: { status: 400, message: "口号最多 60 字" },
  bad_message: { status: 400, message: "留言最多 100 字" },
  bad_team_size: { status: 400, message: "每队人数要在 1–20 之间，且最低不超过最高" },
  deadline_required: { status: 409, message: "开放报名前要先设置报名截止时间" },
  has_signups: { status: 409, message: "已经有报名记录，不能删除或改变参赛形式" },
  kind_locked: { status: 409, message: "已经有未取消的报名，不能改内外部" },
  team_size_conflict: { status: 409, message: "新的人数范围与现有队伍冲突" },
  bad_plaza_note: { status: 400, message: "组队广场的备注最多 150 字" },
  bad_plaza_skills: { status: 400, message: "想要的技能最多 10 项，每项最多 20 字" },
};

export type SignupFailure = { ok: false; error: SignupErrorCode };
export type SignupResult<T> = { ok: true; value: T } | SignupFailure;
const failure = (error: SignupErrorCode): SignupFailure => ({ ok: false, error });

type SettingsRow = {
  competition_id: string; enabled: number; participation: string; team_min: number | null; team_max: number | null;
  scoring: string; updated_at: number; updated_by: string | null;
};
type SignupRow = {
  id: string; competition_id: string; account_id: string; status: string; looking_for_team: number;
  note: string; created_at: number; updated_at: number; cancelled_at: number | null;
};
type TeamRow = {
  id: string; competition_id: string; name: string; name_key: string; slogan: string; leader_account_id: string;
  status: string; locked_at: number | null; disbanded_at: number | null; created_at: number; updated_at: number;
  plaza_recruiting: number; plaza_note: string; plaza_skills: string; plaza_updated_at: number | null;
};
type MemberRow = {
  id: string; team_id: string; competition_id: string; account_id: string; role: string; status: string;
  message: string; created_by: string; decided_by: string | null; created_at: number; decided_at: number | null;
  updated_at: number;
};
type ProfileRow = { id: string; login: string | null; status: string };
type CountRow = { n: number };

const SIGNUP_COLUMNS = "id, competition_id, account_id, status, looking_for_team, note, created_at, updated_at, cancelled_at";
// plaza_* 四列（#278 重开）只在 teamView() 读出、setPlaza() 改写；insertTeam 建队时按字面量给默认值（不招募、无备注、空技能、未改过）。
const TEAM_COLUMNS = "id, competition_id, name, name_key, slogan, leader_account_id, status, locked_at, disbanded_at, created_at, updated_at, "
  + "plaza_recruiting, plaza_note, plaza_skills, plaza_updated_at";
const MEMBER_COLUMNS = "id, team_id, competition_id, account_id, role, status, message, created_by, decided_by, created_at, decided_at, updated_at";

/** 按 Unicode 字符数（不是 UTF-16 码元）计长，和 #238 的比赛名称同口径。 */
const charLength = (value: string) => [...value].length;
/** 队名查重键：trim + NFKC + 小写。 */
export const teamNameKey = (name: string) => name.trim().normalize("NFKC").toLowerCase();

/** `plaza_skills` 列存的 JSON 字符串数组解出来；坏数据（不该发生）当空数组，不让一整行读不出来。 */
export function parsePlazaSkills(raw: string): string[] {
  try {
    const parsed = JSON.parse(raw) as unknown;
    return Array.isArray(parsed) ? parsed.filter((item): item is string => typeof item === "string") : [];
  } catch {
    return [];
  }
}

/** 可写 = 已开放报名且在报名中（截止前、结束前）。未开放、规划中与不在报名中分开的错误码见 `writeFailure`。 */
export function signupWritable(
  record: Pick<CompetitionRecord, "start_at" | "end_at" | "signup_deadline" | "planning">,
  settings: SignupSettings,
  now: number,
): boolean {
  return settings.enabled && competitionStatus(record, now) === "registering";
}

function writeFailure(record: CompetitionRecord, settings: SignupSettings, now: number, finalized: boolean): SignupFailure | null {
  if (finalized) return failure("competition_finalized");
  // 规划中压过「还没开放」：组织者还在筹备，不该先看到「没开放报名」这种听起来随时会开的提示。
  if (competitionStatus(record, now) === "planning") return failure("competition_planning");
  if (!settings.enabled) return failure("signup_not_enabled");
  if (competitionStatus(record, now) !== "registering") return failure("signup_closed");
  return null;
}

function toSettings(row: SettingsRow | undefined): SignupSettings {
  if (!row) return { ...DEFAULT_SIGNUP_SETTINGS };
  return {
    enabled: row.enabled === 1,
    participation: row.participation === "team" ? "team" : "individual",
    team_min: row.team_min ?? 1,
    team_max: row.team_max ?? 1,
    scoring: row.scoring === "contribution" ? "contribution" : "none",
  };
}

/** better-sqlite3 的 `get()` 给 `unknown`；COUNT 语句统一按这一行读，免得每处各写一次断言。 */
function count(statement: Database.Statement, ...params: unknown[]): number {
  return ((statement.get(...params) as CountRow | undefined)?.n) ?? 0;
}

export interface CompetitionSignupStore {
  settingsOf(competitionId: string): SignupSettings;
  signupSummaries(): Map<string, SignupSettings>;
  hasSignups(competitionId: string): boolean;
  /** 未取消的报名才挡住参赛形式与内外部；历史行（已取消）只挡真删。 */
  hasActiveSignups(competitionId: string): boolean;
  signupEnabled(competitionId: string): boolean;
  myStatus(competitionId: string, accountId: string, now: number): SignupResult<MyStatus>;
  myCompetitions(accountId: string, now: number): { items: MyCompetitionItem[]; pending_total: number };
  signUp(competitionId: string, accountId: string, input: { note?: string; looking_for_team?: boolean }, now: number): SignupResult<MyStatus>;
  cancelSignUp(competitionId: string, accountId: string, now: number): SignupResult<MyStatus>;
  teams(competitionId: string): SignupResult<Team[]>;
  freeAgents(competitionId: string): SignupResult<FreeAgent[]>;
  createTeam(competitionId: string, accountId: string, input: { name: string; slogan?: string }, now: number): SignupResult<MyStatus>;
  apply(teamId: string, accountId: string, message: string, now: number): SignupResult<MyStatus>;
  invite(teamId: string, accountId: string, targetAccountId: string, now: number): SignupResult<MyStatus>;
  respond(teamId: string, accountId: string, membershipId: string, action: "accept" | "decline" | "withdraw", now: number): SignupResult<MyStatus>;
  leave(teamId: string, accountId: string, now: number): SignupResult<MyStatus>;
  transfer(teamId: string, accountId: string, targetAccountId: string, now: number): SignupResult<MyStatus>;
  disband(teamId: string, accountId: string, now: number): SignupResult<MyStatus>;
  lock(teamId: string, accountId: string, now: number): SignupResult<MyStatus>;
  unlock(teamId: string, accountId: string, now: number): SignupResult<MyStatus>;
  setPlaza(teamId: string, accountId: string, input: { recruiting: boolean; note?: string; wanted_skills?: string[] }, now: number): SignupResult<MyStatus>;
  withdrawPlaza(teamId: string, accountId: string, now: number): SignupResult<MyStatus>;
  roster(competitionId: string): SignupResult<Roster>;
  removeSignup(competitionId: string, accountId: string, actorAccountId: string, now: number): SignupResult<SignupRemoval>;
  updateSettings(competitionId: string, input: SignupSettings, updatedBy: string, now: number): SignupResult<SignupSettings>;
  person(accountId: string): Person;
  /** 本场未取消的报名，按报名先后；排行榜用它保证 0 分的人也列出。 */
  activeSignups(competitionId: string): (Person & { created_at: number })[];
}

export function createCompetitionSignupStore(db: Database.Database, competitions: Pick<CompetitionStore, "get">, avatars: Pick<Avatars, "urlOf">): CompetitionSignupStore {
  const selectFinal = db.prepare("SELECT 1 FROM competition_finals WHERE competition_id = ?");
  const isFinalized = (id: string) => Boolean(selectFinal.get(id));
  const selectSettings = db.prepare("SELECT * FROM competition_signup_settings WHERE competition_id = ?");
  const selectAllSettings = db.prepare("SELECT * FROM competition_signup_settings");
  const upsertSettings = db.prepare(`INSERT INTO competition_signup_settings(competition_id, enabled, participation, team_min, team_max, scoring, updated_at, updated_by)
    VALUES(@competition_id, @enabled, @participation, @team_min, @team_max, @scoring, @now, @updated_by)
    ON CONFLICT(competition_id) DO UPDATE SET
      enabled = excluded.enabled, participation = excluded.participation, team_min = excluded.team_min,
      team_max = excluded.team_max, scoring = excluded.scoring, updated_at = excluded.updated_at, updated_by = excluded.updated_by`);

  const selectSignup = db.prepare(`SELECT ${SIGNUP_COLUMNS} FROM competition_signups WHERE competition_id = ? AND account_id = ?`);
  const selectSignups = db.prepare(`SELECT ${SIGNUP_COLUMNS} FROM competition_signups WHERE competition_id = ? ORDER BY created_at, account_id`);
  const selectActiveSignups = db.prepare(`SELECT ${SIGNUP_COLUMNS} FROM competition_signups WHERE competition_id = ? AND status = 'active' ORDER BY created_at, account_id`);
  const insertSignup = db.prepare(`INSERT INTO competition_signups(${SIGNUP_COLUMNS})
    VALUES(@id, @competition_id, @account_id, 'active', @looking_for_team, @note, @now, @now, NULL)`);
  const reactivateSignup = db.prepare(`UPDATE competition_signups
    SET status = 'active', looking_for_team = @looking_for_team, note = @note, updated_at = @now, cancelled_at = NULL
    WHERE id = @id`);
  const cancelSignupRow = db.prepare("UPDATE competition_signups SET status = 'cancelled', cancelled_at = ?, updated_at = ? WHERE id = ?");
  const countActiveSignups = db.prepare("SELECT COUNT(*) AS n FROM competition_signups WHERE competition_id = ? AND status = 'active'");
  const countAnySignups = db.prepare("SELECT COUNT(*) AS n FROM competition_signups WHERE competition_id = ?");
  const selectActiveSignupIds = db.prepare("SELECT competition_id FROM competition_signups WHERE account_id = ? AND status = 'active'");

  const selectTeam = db.prepare(`SELECT ${TEAM_COLUMNS} FROM competition_teams WHERE id = ?`);
  const selectTeams = db.prepare(`SELECT ${TEAM_COLUMNS} FROM competition_teams WHERE competition_id = ? AND status <> 'disbanded' ORDER BY created_at, id`);
  const selectAllTeams = db.prepare(`SELECT ${TEAM_COLUMNS} FROM competition_teams WHERE competition_id = ? ORDER BY created_at, id`);
  const selectTeamByName = db.prepare("SELECT id FROM competition_teams WHERE competition_id = ? AND name_key = ? AND status <> 'disbanded'");
  const insertTeam = db.prepare(`INSERT INTO competition_teams(${TEAM_COLUMNS})
    VALUES(@id, @competition_id, @name, @name_key, @slogan, @leader_account_id, 'recruiting', NULL, NULL, @now, @now, 0, '', '[]', NULL)`);
  const setTeamLeader = db.prepare("UPDATE competition_teams SET leader_account_id = ?, updated_at = ? WHERE id = ?");
  const setTeamStatus = db.prepare("UPDATE competition_teams SET status = ?, locked_at = ?, updated_at = ? WHERE id = ?");
  const disbandTeamRow = db.prepare("UPDATE competition_teams SET status = 'disbanded', locked_at = NULL, disbanded_at = ?, updated_at = ? WHERE id = ?");
  // 组队广场（#278 重开）：领队单独改，不跟队伍状态联动；plaza_skills 存 JSON 字符串数组。
  const setTeamPlazaRow = db.prepare(`UPDATE competition_teams
    SET plaza_recruiting = @recruiting, plaza_note = @note, plaza_skills = @skills, plaza_updated_at = @now
    WHERE id = @id`);

  const selectMember = db.prepare(`SELECT ${MEMBER_COLUMNS} FROM competition_team_members WHERE id = ?`);
  const selectMembers = db.prepare(`SELECT ${MEMBER_COLUMNS} FROM competition_team_members WHERE team_id = ? AND status = 'active'
    ORDER BY (role = 'leader') DESC, created_at, id`);
  const selectTeamMembers = db.prepare(`SELECT ${MEMBER_COLUMNS} FROM competition_team_members WHERE team_id = ? ORDER BY created_at, id`);
  const selectActiveMembership = db.prepare(`SELECT ${MEMBER_COLUMNS} FROM competition_team_members
    WHERE competition_id = ? AND account_id = ? AND status = 'active'`);
  const selectMembershipOfAccount = db.prepare(`SELECT ${MEMBER_COLUMNS} FROM competition_team_members
    WHERE team_id = ? AND account_id = ? AND status = 'active'`);
  const selectPendingBetween = db.prepare(`SELECT ${MEMBER_COLUMNS} FROM competition_team_members
    WHERE team_id = ? AND account_id = ? AND status IN ('applied', 'invited')`);
  // 领队被移出时接任的人：除领队外最早入队的在队成员，同时刻按 id，和 selectMembers 的顺序一致。
  const selectSuccessor = db.prepare(`SELECT ${MEMBER_COLUMNS} FROM competition_team_members
    WHERE team_id = ? AND status = 'active' AND id <> ? ORDER BY created_at, id LIMIT 1`);
  const insertMember = db.prepare(`INSERT INTO competition_team_members(${MEMBER_COLUMNS})
    VALUES(@id, @team_id, @competition_id, @account_id, @role, @status, @message, @created_by, NULL, @now, NULL, @now)`);
  const decideMember = db.prepare(`UPDATE competition_team_members SET status = @status, decided_by = @decided_by,
    decided_at = @now, updated_at = @now WHERE id = @id`);
  const setMemberRole = db.prepare("UPDATE competition_team_members SET role = ?, updated_at = ? WHERE id = ?");
  const countActiveMembers = db.prepare("SELECT COUNT(*) AS n FROM competition_team_members WHERE team_id = ? AND status = 'active'");
  const countConfirmedPeople = db.prepare(`SELECT COUNT(*) AS n FROM competition_team_members m
    JOIN competition_teams t ON t.id = m.team_id WHERE m.competition_id = ? AND m.status = 'active' AND t.status = 'locked'`);
  const selectPendingForAccount = db.prepare(`SELECT m.*, t.name AS team_name FROM competition_team_members m
    JOIN competition_teams t ON t.id = m.team_id
    WHERE m.status IN ('applied', 'invited') AND m.account_id = ? ORDER BY m.created_at, m.id`);
  const selectPendingForTeam = db.prepare(`SELECT m.*, t.name AS team_name FROM competition_team_members m
    JOIN competition_teams t ON t.id = m.team_id
    WHERE m.status IN ('applied', 'invited') AND m.team_id = ? ORDER BY m.created_at, m.id`);
  const selectPendingForUnion = db.prepare(`SELECT m.*, t.name AS team_name FROM competition_team_members m
    JOIN competition_teams t ON t.id = m.team_id
    WHERE m.status IN ('applied', 'invited') AND (m.account_id = @account OR m.team_id = @team)
    ORDER BY m.created_at, m.id`);
  const closeAccountPending = db.prepare(`UPDATE competition_team_members
    SET status = CASE status WHEN 'applied' THEN 'withdrawn' ELSE 'declined' END, decided_by = @decided_by, decided_at = @now, updated_at = @now
    WHERE competition_id = @competition AND account_id = @account AND status IN ('applied', 'invited') AND id <> @except`);
  const closeTeamPending = db.prepare(`UPDATE competition_team_members
    SET status = CASE status WHEN 'applied' THEN 'declined' ELSE 'withdrawn' END, decided_by = @decided_by, decided_at = @now, updated_at = @now
    WHERE team_id = @team AND status IN ('applied', 'invited') AND id <> @except`);
  const closeDisbandedMembers = db.prepare(`UPDATE competition_team_members SET status = CASE
      WHEN status = 'active' THEN 'disbanded'
      WHEN status = 'applied' THEN 'declined'
      ELSE 'withdrawn' END,
    decided_by = @decided_by, decided_at = @now, updated_at = @now
    WHERE team_id = @team AND status IN ('active', 'applied', 'invited')`);
  const countTeams = db.prepare("SELECT COUNT(*) AS n FROM competition_teams WHERE competition_id = ? AND status = ?");
  const largestTeam = db.prepare(`SELECT COALESCE(MAX(n), 0) AS n FROM (
    SELECT COUNT(*) AS n FROM competition_team_members m JOIN competition_teams t ON t.id = m.team_id
    WHERE m.competition_id = ? AND m.status = 'active' AND t.status <> 'disbanded' GROUP BY m.team_id)`);
  const largestLockedTeam = db.prepare(`SELECT COALESCE(MAX(n), 0) AS n FROM (
    SELECT COUNT(*) AS n FROM competition_team_members m JOIN competition_teams t ON t.id = m.team_id
    WHERE m.competition_id = ? AND m.status = 'active' AND t.status = 'locked' GROUP BY m.team_id)`);
  const countOpenTeams = db.prepare(`SELECT COUNT(*) AS n FROM competition_teams t
    WHERE t.competition_id = @competition AND t.status = 'recruiting'
      AND (SELECT COUNT(*) FROM competition_team_members m WHERE m.team_id = t.id AND m.status = 'active') < @team_max
      AND NOT EXISTS (SELECT 1 FROM competition_team_members m
        WHERE m.team_id = t.id AND m.account_id = @account AND m.status IN ('applied', 'invited'))`);
  const countUnplaced = db.prepare(`SELECT COUNT(*) AS n FROM competition_signups s
    WHERE s.competition_id = ? AND s.status = 'active'
      AND NOT EXISTS (SELECT 1 FROM competition_team_members m WHERE m.competition_id = s.competition_id AND m.account_id = s.account_id AND m.status = 'active')`);

  // 身份表由 lib/identity-store.ts 写；这里只读登录名与账号状态给名单和成员检查，不碰会话与账号状态机。
  // 没有绑定 GitHub 的账号（邮箱、Google 注册，#262）用账号自己的 yz_ 登录名。头像统一由 lib/avatars.ts 算（#343）。
  const selectProfile = db.prepare(`SELECT u.id AS id, COALESCE(i.login, u.handle) AS login, u.status AS status
    FROM users u LEFT JOIN identities i ON i.user_id = u.id AND i.provider = 'github' WHERE u.id = ?`);
  // #274 SPEC §3.2：成员资格不再看 org_state，看权限引擎的 level.member 组（perm_members），和 requireCompetitionNode 同一个口径。
  const selectLevelMember = db.prepare("SELECT 1 FROM perm_members WHERE account_id = ? AND group_id = 'level.member' AND (expires_at IS NULL OR expires_at > ?)");
  const selectFreeAgents = db.prepare(`SELECT s.account_id AS account_id, s.note AS note, s.created_at AS since
    FROM competition_signups s
    WHERE s.competition_id = ? AND s.status = 'active' AND s.looking_for_team = 1
      AND NOT EXISTS (SELECT 1 FROM competition_team_members m WHERE m.competition_id = s.competition_id AND m.account_id = s.account_id AND m.status = 'active')
    ORDER BY s.created_at, s.account_id`);

  function person(accountId: string): Person {
    const row = selectProfile.get(accountId) as ProfileRow | undefined;
    return { account_id: accountId, login: row?.login ?? "", avatar_url: avatars.urlOf(accountId) };
  }

  /**
   * 对方现在算不算成员：账号启用，且还在 `level.member` 组里（#274 SPEC §3.2，不再看 GitHub 组织资格）。
   * 被邀请、被转让队长的人要是已经被站长改成「注册用户」（不再是成员），这里挡住，不留半成的队伍状态。
   */
  function isActiveAccount(accountId: string, now: number): boolean {
    const row = selectProfile.get(accountId) as ProfileRow | undefined;
    return row?.status === "active" && Boolean(selectLevelMember.get(accountId, now));
  }

  function settingsOf(competitionId: string): SignupSettings {
    return toSettings(selectSettings.get(competitionId) as SettingsRow | undefined);
  }

  /** 门户只看未下线的比赛：不存在与已下线都当 404，记录本身保留。 */
  function portalCompetitionOf(id: string): CompetitionRecord | null {
    const record = competitions.get(id);
    return record && !record.offline ? record : null;
  }

  function membersOf(teamId: string): TeamMember[] {
    return (selectMembers.all(teamId) as MemberRow[]).map(row => ({
      ...person(row.account_id), role: row.role === "leader" ? "leader" : "member", joined_at: row.created_at,
    }));
  }

  function teamView(row: TeamRow): Team {
    const members = membersOf(row.id);
    return {
      id: row.id, name: row.name, slogan: row.slogan,
      status: row.status === "locked" ? "locked" : "recruiting",
      leader_account_id: row.leader_account_id, members, member_count: members.length, created_at: row.created_at,
      plaza: { recruiting: row.plaza_recruiting === 1, note: row.plaza_note, wanted_skills: parsePlazaSkills(row.plaza_skills), updated_at: row.plaza_updated_at },
    };
  }

  function statsOf(competitionId: string, settings: SignupSettings): Stats {
    const signups = count(countActiveSignups, competitionId);
    return {
      signups,
      teams: count(countTeams, competitionId, "recruiting") + count(countTeams, competitionId, "locked"),
      locked_teams: count(countTeams, competitionId, "locked"),
      confirmed_people: settings.participation === "individual" ? signups : count(countConfirmedPeople, competitionId),
      unplaced: settings.participation === "team" ? count(countUnplaced, competitionId) : 0,
    };
  }

  function pendingItems(competitionId: string, accountId: string, teamId: string | null): Pending[] {
    const rows = teamId
      ? (selectPendingForUnion.all({ account: accountId, team: teamId }) as (MemberRow & { team_name: string })[])
      : (selectPendingForAccount.all(accountId) as (MemberRow & { team_name: string })[]);
    return rows
      .filter(row => row.competition_id === competitionId)
      .map(row => ({
        membership_id: row.id,
        kind: row.status === "applied" ? "application" : "invitation",
        team_id: row.team_id,
        team_name: row.team_name,
        person: person(row.account_id),
        message: row.message,
        created_at: row.created_at,
      }));
  }

  /** 角标口径：发给我的邀请 +（我是领队时）本队收到的申请；我发出的申请不算。 */
  function pendingCount(competitionId: string, accountId: string, teamId: string | null): number {
    const invited = (selectPendingForAccount.all(accountId) as (MemberRow & { team_name: string })[])
      .filter(row => row.competition_id === competitionId && row.status === "invited").length;
    const applied = teamId
      ? (selectPendingForTeam.all(teamId) as (MemberRow & { team_name: string })[]).filter(row => row.status === "applied").length
      : 0;
    return invited + applied;
  }

  function stateOf(record: CompetitionRecord, settings: SignupSettings, signup: SignupRow | null, team: Team | null, now: number): MyState {
    if (!signup || signup.status !== "active") return "none";
    if (settings.participation === "individual") return record.kind === "internal" ? "confirmed" : "signed_up";
    const open = competitionStatus(record, now) === "registering";
    if (team) return team.status === "locked" ? "confirmed" : open ? "in_team" : "unplaced";
    return open ? "signed_up" : "unplaced";
  }

  const ACTION_ORDER: SignupAction[] = ["signup", "update_signup", "cancel_signup", "create_team", "apply", "invite", "lock", "unlock", "transfer", "disband", "leave"];

  /** 仅列此刻服务端会接受的操作；不可写时为空。 */
  function actionsFor(record: CompetitionRecord, settings: SignupSettings, signup: SignupRow | null, team: Team | null, accountId: string, now: number): SignupAction[] {
    if (isFinalized(record.id) || !signupWritable(record, settings, now)) return [];
    if (!signup || signup.status !== "active") return ["signup"];
    const actions = new Set<SignupAction>(["update_signup", "cancel_signup"]);
    if (settings.participation === "team") {
      const role = team?.members.find(member => member.account_id === accountId)?.role ?? null;
      // 锁定后不能取消报名；领队队里还有别人时要先转让或解散，也不能直接取消。
      if (team?.status === "locked" || (role === "leader" && team !== null && team.member_count > 1)) actions.delete("cancel_signup");
      if (!team) {
        actions.add("create_team");
        if (count(countOpenTeams, { competition: record.id, team_max: settings.team_max, account: accountId }) > 0) actions.add("apply");
      } else if (team.status === "locked") {
        if (role === "leader") actions.add("unlock");
      } else if (role === "leader") {
        if (team.member_count > 1) actions.add("transfer");
        if (team.member_count < settings.team_max) actions.add("invite");
        if (team.member_count >= settings.team_min) actions.add("lock");
        actions.add("disband");
      } else {
        actions.add("leave");
      }
    }
    return ACTION_ORDER.filter(action => actions.has(action));
  }

  function buildMyStatus(record: CompetitionRecord, accountId: string, now: number): MyStatus {
    const settings = settingsOf(record.id);
    const signup = (selectSignup.get(record.id, accountId) as SignupRow | undefined) ?? null;
    const membership = selectActiveMembership.get(record.id, accountId) as MemberRow | undefined;
    const teamRow = membership ? selectTeam.get(membership.team_id) as TeamRow | undefined : undefined;
    const team = teamRow ? teamView(teamRow) : null;
    return {
      competition_id: record.id,
      settings,
      writable: !isFinalized(record.id) && signupWritable(record, settings, now),
      signup: signup
        ? {
            status: signup.status === "cancelled" ? "cancelled" : "active",
            note: signup.note, looking_for_team: signup.looking_for_team === 1,
            created_at: signup.created_at, updated_at: signup.updated_at,
          }
        : null,
      state: stateOf(record, settings, signup, team, now),
      team,
      role: membership ? (membership.role === "leader" ? "leader" : "member") : null,
      pending: pendingItems(record.id, accountId, teamRow?.id ?? null),
      stats: statsOf(record.id, settings),
      actions: actionsFor(record, settings, signup, team, accountId, now),
    };
  }

  function myStatus(competitionId: string, accountId: string, now: number): SignupResult<MyStatus> {
    const record = portalCompetitionOf(competitionId);
    if (!record) return failure("not_found");
    return { ok: true, value: buildMyStatus(record, accountId, now) };
  }

  /** 写操作的公共入口：事务里重读状态再写，返回最新的「我的状态」。 */
  function mutate(competitionId: string, accountId: string, now: number, run: (record: CompetitionRecord) => SignupFailure | null): SignupResult<MyStatus> {
    const record = portalCompetitionOf(competitionId);
    if (!record) return failure("not_found");
    const blocked = db.transaction(() => run(record))();
    if (blocked) return blocked;
    return { ok: true, value: buildMyStatus(record, accountId, now) };
  }

  function signUp(competitionId: string, accountId: string, input: { note?: string; looking_for_team?: boolean }, now: number): SignupResult<MyStatus> {
    return mutate(competitionId, accountId, now, record => {
      const settings = settingsOf(record.id);
      const blocked = writeFailure(record, settings, now, isFinalized(record.id));
      if (blocked) return blocked;
      const note = (input.note ?? "").trim();
      if (charLength(note) > 200) return failure("bad_note");
      // 个人赛没有队伍可找，勾选按未勾选存，前端不需要自己再清一次。
      const looking = settings.participation === "team" && input.looking_for_team === true ? 1 : 0;
      const existing = selectSignup.get(record.id, accountId) as SignupRow | undefined;
      if (existing) {
        reactivateSignup.run({ id: existing.id, looking_for_team: looking, note, now });
      } else {
        insertSignup.run({ id: randomUUID(), competition_id: record.id, account_id: accountId, looking_for_team: looking, note, now });
      }
      return null;
    });
  }

  function cancelSignUp(competitionId: string, accountId: string, now: number): SignupResult<MyStatus> {
    return mutate(competitionId, accountId, now, record => {
      const blocked = writeFailure(record, settingsOf(record.id), now, isFinalized(record.id));
      if (blocked) return blocked;
      const signup = selectSignup.get(record.id, accountId) as SignupRow | undefined;
      if (!signup || signup.status !== "active") return failure("not_signed_up");
      const membership = selectActiveMembership.get(record.id, accountId) as MemberRow | undefined;
      if (membership) {
        const team = selectTeam.get(membership.team_id) as TeamRow | undefined;
        if (team) {
          if (team.status === "locked") return failure("team_locked");
          const size = count(countActiveMembers, team.id);
          if (membership.role === "leader" && size > 1) return failure("is_team_leader");
          // 领队只有自己一人时队伍随之解散；普通队员退出。
          if (membership.role === "leader") {
            disbandTeamRow.run(now, now, team.id);
            closeDisbandedMembers.run({ team: team.id, decided_by: accountId, now });
          } else {
            decideMember.run({ id: membership.id, status: "left", decided_by: accountId, now });
          }
        } else {
          decideMember.run({ id: membership.id, status: "left", decided_by: accountId, now });
        }
      }
      closeAccountPending.run({ competition: record.id, account: accountId, except: "", decided_by: accountId, now });
      cancelSignupRow.run(now, now, signup.id);
      return null;
    });
  }

  function teams(competitionId: string): SignupResult<Team[]> {
    if (!portalCompetitionOf(competitionId)) return failure("not_found");
    return { ok: true, value: (selectTeams.all(competitionId) as TeamRow[]).map(teamView) };
  }

  function freeAgents(competitionId: string): SignupResult<FreeAgent[]> {
    if (!portalCompetitionOf(competitionId)) return failure("not_found");
    return {
      ok: true,
      value: (selectFreeAgents.all(competitionId) as { account_id: string; note: string; since: number }[])
        .map(row => ({ ...person(row.account_id), note: row.note, since: row.since })),
    };
  }

  function createTeam(competitionId: string, accountId: string, input: { name: string; slogan?: string }, now: number): SignupResult<MyStatus> {
    return mutate(competitionId, accountId, now, record => {
      const settings = settingsOf(record.id);
      const blocked = writeFailure(record, settings, now, isFinalized(record.id));
      if (blocked) return blocked;
      const signup = selectSignup.get(record.id, accountId) as SignupRow | undefined;
      if (!signup || signup.status !== "active") return failure("not_signed_up");
      if (settings.participation !== "team") return failure("individual_competition");
      if (selectActiveMembership.get(record.id, accountId)) return failure("already_in_team");
      const name = input.name.trim();
      const slogan = (input.slogan ?? "").trim();
      if (charLength(name) < 2 || charLength(name) > 30) return failure("bad_team_name");
      if (charLength(slogan) > 60) return failure("bad_slogan");
      const nameKey = teamNameKey(name);
      if (selectTeamByName.get(record.id, nameKey)) return failure("duplicate_team_name");
      const teamId = randomUUID();
      insertTeam.run({ id: teamId, competition_id: record.id, name, name_key: nameKey, slogan, leader_account_id: accountId, now });
      insertMember.run({
        id: randomUUID(), team_id: teamId, competition_id: record.id, account_id: accountId,
        role: "leader", status: "active", message: "", created_by: accountId, now,
      });
      return null;
    });
  }

  /** 队伍写操作的公共前置：队伍存在、比赛未下线、可写。返回比赛记录或失败码。 */
  function teamContext(team: TeamRow, now: number): SignupFailure | CompetitionRecord {
    const record = portalCompetitionOf(team.competition_id);
    if (!record) return failure("not_found");
    const blocked = writeFailure(record, settingsOf(record.id), now, isFinalized(record.id));
    return blocked ?? record;
  }

  const isFailure = (value: SignupFailure | CompetitionRecord): value is SignupFailure => "ok" in value && value.ok === false;

  function apply(teamId: string, accountId: string, message: string, now: number): SignupResult<MyStatus> {
    const team = selectTeam.get(teamId) as TeamRow | undefined;
    if (!team) return failure("team_not_found");
    const context = teamContext(team, now);
    if (isFailure(context)) return context;
    if (team.status === "disbanded") return failure("team_not_found");
    const settings = settingsOf(context.id);
    if (settings.participation !== "team") return failure("individual_competition");
    return mutate(context.id, accountId, now, () => {
      const signup = selectSignup.get(context.id, accountId) as SignupRow | undefined;
      if (!signup || signup.status !== "active") return failure("not_signed_up");
      if (selectActiveMembership.get(context.id, accountId)) return failure("already_in_team");
      if (team.status === "locked") return failure("team_locked");
      if (count(countActiveMembers, team.id) >= settings.team_max) return failure("team_full");
      const pending = selectPendingBetween.get(team.id, accountId) as MemberRow | undefined;
      if (pending) return failure(pending.status === "invited" ? "already_invited" : "already_applied");
      const note = message.trim();
      if (charLength(note) > 100) return failure("bad_message");
      insertMember.run({
        id: randomUUID(), team_id: team.id, competition_id: context.id, account_id: accountId,
        role: "member", status: "applied", message: note, created_by: accountId, now,
      });
      return null;
    });
  }

  function invite(teamId: string, accountId: string, targetAccountId: string, now: number): SignupResult<MyStatus> {
    const team = selectTeam.get(teamId) as TeamRow | undefined;
    if (!team) return failure("team_not_found");
    const context = teamContext(team, now);
    if (isFailure(context)) return context;
    if (team.status === "disbanded") return failure("team_not_found");
    if (team.leader_account_id !== accountId) return failure("not_team_leader");
    const settings = settingsOf(context.id);
    if (settings.participation !== "team") return failure("individual_competition");
    return mutate(context.id, accountId, now, () => {
      if (targetAccountId === accountId) return failure("already_in_team");
      const target = selectSignup.get(context.id, targetAccountId) as SignupRow | undefined;
      if (!target || target.status !== "active") return failure("invitee_not_signed_up");
      if (!isActiveAccount(targetAccountId, now)) return failure("target_not_member");
      if (selectActiveMembership.get(context.id, targetAccountId)) return failure("already_in_team");
      if (team.status === "locked") return failure("team_locked");
      if (count(countActiveMembers, team.id) >= settings.team_max) return failure("team_full");
      const pending = selectPendingBetween.get(team.id, targetAccountId) as MemberRow | undefined;
      if (pending) return failure(pending.status === "applied" ? "already_applied" : "already_invited");
      insertMember.run({
        id: randomUUID(), team_id: team.id, competition_id: context.id, account_id: targetAccountId,
        role: "member", status: "invited", message: "", created_by: accountId, now,
      });
      return null;
    });
  }

  function respond(teamId: string, accountId: string, membershipId: string, action: "accept" | "decline" | "withdraw", now: number): SignupResult<MyStatus> {
    const team = selectTeam.get(teamId) as TeamRow | undefined;
    if (!team) return failure("team_not_found");
    const membership = selectMember.get(membershipId) as MemberRow | undefined;
    // 成员关系必须属于路径上的队伍，别的队伍的待处理项一律当不存在。
    if (!membership || membership.team_id !== teamId) return failure("not_found");
    const context = teamContext(team, now);
    if (isFailure(context)) return context;
    if (team.status === "disbanded") return failure("team_not_found");
    if (membership.status !== "applied" && membership.status !== "invited") return failure("invalid_state");
    const settings = settingsOf(context.id);
    if (settings.participation !== "team") return failure("individual_competition");
    // 申请：领队同意或拒绝，申请人撤回；邀请：被邀请人接受或拒绝，领队撤回。
    const leader = team.leader_account_id === accountId;
    if (membership.status === "applied" && action !== "withdraw" && !leader) return failure("not_team_leader");
    if (membership.status === "applied" && action === "withdraw" && membership.account_id !== accountId) return failure("not_found");
    if (membership.status === "invited" && action === "withdraw" && !leader) return failure("not_team_leader");
    if (membership.status === "invited" && action !== "withdraw" && membership.account_id !== accountId) return failure("not_found");
    return mutate(context.id, accountId, now, () => {
      if (action !== "accept") {
        decideMember.run({ id: membership.id, status: action === "decline" ? "declined" : "withdrawn", decided_by: accountId, now });
        return null;
      }
      if (team.status === "locked") return failure("team_locked");
      const size = count(countActiveMembers, team.id);
      if (size >= settings.team_max) return failure("team_full");
      const subject = selectSignup.get(context.id, membership.account_id) as SignupRow | undefined;
      if (!subject || subject.status !== "active") return failure("not_signed_up");
      if (!isActiveAccount(membership.account_id, now)) return failure("target_not_member");
      if (selectActiveMembership.get(context.id, membership.account_id)) return failure("already_in_team");
      decideMember.run({ id: membership.id, status: "active", decided_by: accountId, now });
      // 入队成功后，这个人在本场其他待处理申请与邀请自动关闭；满员时本队其余待处理项也关闭。
      closeAccountPending.run({ competition: context.id, account: membership.account_id, except: membership.id, decided_by: accountId, now });
      if (size + 1 >= settings.team_max) closeTeamPending.run({ team: team.id, except: membership.id, decided_by: accountId, now });
      return null;
    });
  }

  function leave(teamId: string, accountId: string, now: number): SignupResult<MyStatus> {
    const team = selectTeam.get(teamId) as TeamRow | undefined;
    if (!team) return failure("team_not_found");
    const context = teamContext(team, now);
    if (isFailure(context)) return context;
    if (team.status === "disbanded") return failure("team_not_found");
    const membership = selectMembershipOfAccount.get(teamId, accountId) as MemberRow | undefined;
    if (!membership) return failure("not_found");
    if (team.status === "locked") return failure("team_locked");
    if (membership.role === "leader") return failure("is_team_leader");
    return mutate(context.id, accountId, now, () => {
      decideMember.run({ id: membership.id, status: "left", decided_by: accountId, now });
      return null;
    });
  }

  function transfer(teamId: string, accountId: string, targetAccountId: string, now: number): SignupResult<MyStatus> {
    const team = selectTeam.get(teamId) as TeamRow | undefined;
    if (!team) return failure("team_not_found");
    const context = teamContext(team, now);
    if (isFailure(context)) return context;
    if (team.status === "disbanded") return failure("team_not_found");
    if (team.leader_account_id !== accountId) return failure("not_team_leader");
    if (team.status === "locked") return failure("team_locked");
    const target = selectMembershipOfAccount.get(teamId, targetAccountId) as MemberRow | undefined;
    if (!target) return failure("not_found");
    if (!isActiveAccount(targetAccountId, now)) return failure("target_not_member");
    return mutate(context.id, accountId, now, () => {
      const current = selectMembershipOfAccount.get(teamId, accountId) as MemberRow | undefined;
      setTeamLeader.run(targetAccountId, now, teamId);
      setMemberRole.run("leader", now, target.id);
      if (current) setMemberRole.run("member", now, current.id);
      return null;
    });
  }

  function disband(teamId: string, accountId: string, now: number): SignupResult<MyStatus> {
    const team = selectTeam.get(teamId) as TeamRow | undefined;
    if (!team) return failure("team_not_found");
    const context = teamContext(team, now);
    if (isFailure(context)) return context;
    if (team.status === "disbanded") return failure("team_not_found");
    if (team.leader_account_id !== accountId) return failure("not_team_leader");
    return mutate(context.id, accountId, now, () => {
      disbandTeamRow.run(now, now, teamId);
      closeDisbandedMembers.run({ team: teamId, decided_by: accountId, now });
      return null;
    });
  }

  function lock(teamId: string, accountId: string, now: number): SignupResult<MyStatus> {
    const team = selectTeam.get(teamId) as TeamRow | undefined;
    if (!team) return failure("team_not_found");
    const context = teamContext(team, now);
    if (isFailure(context)) return context;
    if (team.status === "disbanded") return failure("team_not_found");
    if (team.leader_account_id !== accountId) return failure("not_team_leader");
    if (team.status === "locked") return failure("invalid_state");
    if (count(countActiveMembers, teamId) < settingsOf(context.id).team_min) return failure("team_too_small");
    return mutate(context.id, accountId, now, () => {
      setTeamStatus.run("locked", now, now, teamId);
      closeTeamPending.run({ team: teamId, except: "", decided_by: accountId, now });
      return null;
    });
  }

  /**
   * 组队广场广播（#278 重开）：领队开关「还在招募」、写一句话和想要的技能，和 `lock`/`unlock` 独立——
   * 锁定的队伍就算开着广播也不会出现在广场（`competition-team-plaza.ts` 的可见性规则另外判断）。
   */
  function setPlaza(teamId: string, accountId: string, input: { recruiting: boolean; note?: string; wanted_skills?: string[] }, now: number): SignupResult<MyStatus> {
    const team = selectTeam.get(teamId) as TeamRow | undefined;
    if (!team) return failure("team_not_found");
    const context = teamContext(team, now);
    if (isFailure(context)) return context;
    if (team.status === "disbanded") return failure("team_not_found");
    if (team.leader_account_id !== accountId) return failure("not_team_leader");
    const note = (input.note ?? "").trim();
    if (charLength(note) > 150) return failure("bad_plaza_note");
    const skills = (input.wanted_skills ?? []).map(item => item.trim()).filter(Boolean);
    if (skills.length > 10 || skills.some(item => charLength(item) > 20)) return failure("bad_plaza_skills");
    return mutate(context.id, accountId, now, () => {
      setTeamPlazaRow.run({ id: teamId, recruiting: input.recruiting ? 1 : 0, note, skills: JSON.stringify(skills), now });
      return null;
    });
  }

  /** 撤下广场广播：关掉「还在招募」，备注和技能照留，之后重新开启不用再填一次。 */
  function withdrawPlaza(teamId: string, accountId: string, now: number): SignupResult<MyStatus> {
    const team = selectTeam.get(teamId) as TeamRow | undefined;
    if (!team) return failure("team_not_found");
    const context = teamContext(team, now);
    if (isFailure(context)) return context;
    if (team.status === "disbanded") return failure("team_not_found");
    if (team.leader_account_id !== accountId) return failure("not_team_leader");
    return mutate(context.id, accountId, now, () => {
      setTeamPlazaRow.run({ id: teamId, recruiting: 0, note: team.plaza_note, skills: team.plaza_skills, now });
      return null;
    });
  }

  function unlock(teamId: string, accountId: string, now: number): SignupResult<MyStatus> {
    const team = selectTeam.get(teamId) as TeamRow | undefined;
    if (!team) return failure("team_not_found");
    const context = teamContext(team, now);
    if (isFailure(context)) return context;
    if (team.status === "disbanded") return failure("team_not_found");
    if (team.leader_account_id !== accountId) return failure("not_team_leader");
    if (team.status !== "locked") return failure("invalid_state");
    return mutate(context.id, accountId, now, () => {
      setTeamStatus.run("recruiting", null, now, teamId);
      return null;
    });
  }

  function myCompetitions(accountId: string, now: number): { items: MyCompetitionItem[]; pending_total: number } {
    const joined = new Set((selectActiveSignupIds.all(accountId) as { competition_id: string }[]).map(row => row.competition_id));
    const items: MyCompetitionItem[] = [];
    let pendingTotal = 0;
    for (const id of joined) {
      const record = portalCompetitionOf(id);
      if (!record) continue;
      const settings = settingsOf(id);
      const membership = selectActiveMembership.get(id, accountId) as MemberRow | undefined;
      const teamRow = membership ? selectTeam.get(membership.team_id) as TeamRow | undefined : undefined;
      const pending = pendingCount(id, accountId, teamRow?.id ?? null);
      pendingTotal += pending;
      items.push({
        competition_id: record.id, name: record.name, kind: record.kind,
        status: competitionStatus(record, now), start_at: record.start_at, end_at: record.end_at,
        signup_deadline: record.signup_deadline,
        state: stateOf(record, settings, (selectSignup.get(id, accountId) as SignupRow | undefined) ?? null, teamRow ? teamView(teamRow) : null, now),
        team: teamRow
          ? {
              id: teamRow.id, name: teamRow.name, status: teamRow.status === "locked" ? "locked" : "recruiting",
              member_count: count(countActiveMembers, teamRow.id), team_max: settings.team_max,
            }
          : null,
        pending_count: pending,
      });
    }
    // 与官网同一套时间线顺序：还能赶上的在前、已结束的在后。
    items.sort((a, b) => {
      const endedA = now > a.end_at;
      const endedB = now > b.end_at;
      if (endedA !== endedB) return endedA ? 1 : -1;
      const byStart = endedA ? b.start_at - a.start_at : a.start_at - b.start_at;
      return byStart || (a.competition_id < b.competition_id ? -1 : a.competition_id > b.competition_id ? 1 : 0);
    });
    return { items, pending_total: pendingTotal };
  }

  /** 控制台名单：全部报名（含已取消）与全部队伍（含已解散）。比赛不存在才 404，下线不看。 */
  function roster(competitionId: string): SignupResult<Roster> {
    if (!competitions.get(competitionId)) return failure("not_found");
    const settings = settingsOf(competitionId);
    const teamRows = selectAllTeams.all(competitionId) as TeamRow[];
    const teamNames = new Map(teamRows.map(row => [row.id, row.name]));
    const activeMembership = new Map<string, MemberRow>();
    for (const team of teamRows) {
      for (const member of selectTeamMembers.all(team.id) as MemberRow[]) {
        if (member.status === "active") activeMembership.set(member.account_id, member);
      }
    }
    const signups: RosterSignup[] = (selectSignups.all(competitionId) as SignupRow[]).map(row => {
      const membership = activeMembership.get(row.account_id);
      return {
        ...person(row.account_id),
        status: row.status === "cancelled" ? "cancelled" : "active",
        note: row.note,
        looking_for_team: row.looking_for_team === 1,
        team_id: membership?.team_id ?? null,
        team_name: membership ? teamNames.get(membership.team_id) ?? null : null,
        role: membership ? (membership.role === "leader" ? "leader" : "member") : null,
        created_at: row.created_at,
        updated_at: row.updated_at,
        cancelled_at: row.cancelled_at,
      };
    });
    const teamsView: RosterTeam[] = teamRows.map(row => ({
      ...teamView(row),
      status: row.status === "disbanded" ? "disbanded" : row.status === "locked" ? "locked" : "recruiting",
      disbanded_at: row.disbanded_at,
    }));
    return { ok: true, value: { settings, stats: statsOf(competitionId, settings), signups, teams: teamsView } };
  }

  /**
   * 控制台移出（#342）：管理员取消一个人的有效报名。和本人取消不同，报名截止后、队伍已确认、领队队里还有别人时
   * 都照样移出：队员退出；领队先把领队交给最早入队的队员再退出；只有领队一人的队伍解散；已确认的队伍因此低于
   * 最低人数时退回招募中。只拦比赛不存在、已定榜和没有有效报名；比赛下线不看，和名单一致。
   */
  function removeSignup(competitionId: string, accountId: string, actorAccountId: string, now: number): SignupResult<SignupRemoval> {
    if (!competitions.get(competitionId)) return failure("not_found");
    return db.transaction((): SignupResult<SignupRemoval> => {
      if (isFinalized(competitionId)) return failure("competition_finalized");
      const signup = selectSignup.get(competitionId, accountId) as SignupRow | undefined;
      if (!signup || signup.status !== "active") return failure("not_signed_up");
      let teamAction: SignupRemoval["team_action"] = "none";
      let unlocked = false;
      const membership = selectActiveMembership.get(competitionId, accountId) as MemberRow | undefined;
      if (membership) {
        const team = selectTeam.get(membership.team_id) as TeamRow | undefined;
        const successor = team && membership.role === "leader" ? selectSuccessor.get(team.id, membership.id) as MemberRow | undefined : undefined;
        if (team && membership.role === "leader" && !successor) {
          disbandTeamRow.run(now, now, team.id);
          closeDisbandedMembers.run({ team: team.id, decided_by: actorAccountId, now });
          teamAction = "disbanded";
        } else {
          if (team && successor) {
            setTeamLeader.run(successor.account_id, now, team.id);
            setMemberRole.run("leader", now, successor.id);
            setMemberRole.run("member", now, membership.id);
          }
          decideMember.run({ id: membership.id, status: "left", decided_by: actorAccountId, now });
          teamAction = successor ? "transferred" : "left";
          if (team?.status === "locked" && count(countActiveMembers, team.id) < settingsOf(competitionId).team_min) {
            setTeamStatus.run("recruiting", null, now, team.id);
            unlocked = true;
          }
        }
      }
      closeAccountPending.run({ competition: competitionId, account: accountId, except: "", decided_by: actorAccountId, now });
      cancelSignupRow.run(now, now, signup.id);
      return { ok: true, value: { team_action: teamAction, unlocked } };
    })();
  }

  /** 报名设置（控制台）：全量写入，写前按已有数据判冲突，与审计在同一个事务里。 */
  function updateSettings(competitionId: string, input: SignupSettings, updatedBy: string, now: number): SignupResult<SignupSettings> {
    const record = competitions.get(competitionId);
    if (!record) return failure("not_found");
    if (isFinalized(competitionId)) return failure("competition_finalized");
    if (input.participation === "team" && !(input.team_min >= 1 && input.team_max <= 20 && input.team_min <= input.team_max)) {
      return failure("bad_team_size");
    }
    if (input.enabled && record.signup_deadline === null) return failure("deadline_required");
    if (input.participation !== settingsOf(competitionId).participation && count(countActiveSignups, competitionId) > 0) return failure("has_signups");
    if (input.participation === "team") {
      if (input.team_max < count(largestTeam, competitionId)) return failure("team_size_conflict");
      const confirmed = count(largestLockedTeam, competitionId);
      if (confirmed > 0 && input.team_min > confirmed) return failure("team_size_conflict");
    }
    const stored = db.transaction(() => {
      upsertSettings.run({
        competition_id: competitionId,
        enabled: input.enabled ? 1 : 0,
        participation: input.participation,
        team_min: input.participation === "team" ? input.team_min : null,
        team_max: input.participation === "team" ? input.team_max : null,
        scoring: input.scoring,
        now,
        updated_by: updatedBy,
      });
      return settingsOf(competitionId);
    })();
    return { ok: true, value: stored };
  }

  return {
    settingsOf,
    signupSummaries: () => new Map((selectAllSettings.all() as SettingsRow[]).map(row => [row.competition_id, toSettings(row)])),
    hasSignups: (competitionId: string) => count(countAnySignups, competitionId) > 0,
    hasActiveSignups: (competitionId: string) => count(countActiveSignups, competitionId) > 0,
    signupEnabled: (competitionId: string) => settingsOf(competitionId).enabled,
    myStatus, myCompetitions, signUp, cancelSignUp, teams, freeAgents, createTeam,
    apply, invite, respond, leave, transfer, disband, lock, unlock, setPlaza, withdrawPlaza,
    roster, removeSignup, updateSettings, person,
    activeSignups: (competitionId: string) =>
      (selectActiveSignups.all(competitionId) as SignupRow[]).map(row => ({ ...person(row.account_id), created_at: row.created_at })),
  };
}

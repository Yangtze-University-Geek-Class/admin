// 比赛报名与组队（#239）：支持内部赛报名、外部赛意向与双向确认组队机制。
// 持久化存储于 SQLite，纯参数接口，授权判定在调用方路由。
import { randomUUID } from "node:crypto";
import type Database from "better-sqlite3";
import { competitionStatus, type CompetitionRecord } from "./competition-store.js";
import { csvCell } from "./csv.js";
import { beijingDateTime } from "./beijing-time.js";

export type ParticipationType = "individual" | "team";
export type SignupStatus = "active" | "cancelled";
export type TeamStatus = "recruiting" | "locked" | "disbanded";
export type MemberRole = "leader" | "member";
export type MemberStatus =
  | "applied"
  | "invited"
  | "active"
  | "declined"
  | "withdrawn"
  | "left"
  | "removed"
  | "disbanded";

export type SignupSettingsRecord = {
  competition_id: string;
  enabled: boolean;
  participation: ParticipationType;
  team_min: number | null;
  team_max: number | null;
  updated_at: number;
  updated_by: string;
};

export type SignupRecord = {
  id: string;
  competition_id: string;
  account_id: string;
  status: SignupStatus;
  looking_for_team: boolean;
  note: string;
  created_at: number;
  updated_at: number;
  cancelled_at: number | null;
};

export type TeamMemberRecord = {
  id: string;
  team_id: string;
  competition_id: string;
  account_id: string;
  role: MemberRole;
  status: MemberStatus;
  message: string;
  created_by: string;
  decided_by: string | null;
  created_at: number;
  decided_at: number | null;
  updated_at: number;
};

export type TeamRecord = {
  id: string;
  competition_id: string;
  name: string;
  name_key: string;
  slogan: string;
  leader_account_id: string;
  status: TeamStatus;
  locked_at: number | null;
  disbanded_at: number | null;
  created_at: number;
  updated_at: number;
};

export type Member = {
  account_id: string;
  name: string;
  avatar_url: string | null;
};

export type PendingItem = {
  membership_id: string;
  type: "applied" | "invited";
  direction: "incoming" | "outgoing";
  team: { id: string; name: string; member_count: number };
  user: Member;
  message: string;
  created_at: number;
};

export type TeamWithMembers = {
  id: string;
  name: string;
  slogan: string;
  status: "recruiting" | "locked";
  leader: Member;
  members: (Member & { role: "leader" | "member" })[];
  member_count: number;
  my_relation: "none" | "applied" | "invited" | "member" | "leader";
  can_apply: boolean;
  pending?: PendingItem[];
};

export type State = "none" | "signed_up" | "in_team" | "confirmed" | "unplaced";

export type MyStatus = {
  writable: boolean;
  state: State;
  signup: { note: string; looking_for_team: boolean; created_at: number } | null;
  team: {
    id: string;
    name: string;
    status: "recruiting" | "locked";
    role: "leader" | "member";
    member_count: number;
  } | null;
  pending: PendingItem[];
  actions: string[];
  stats: {
    signups: number;
    teams: number;
    confirmed_teams: number;
    confirmed_participants: number;
    unplaced: number;
  };
};

export type MyCompetitions = {
  pending_count: number;
  pending: (PendingItem & { competition: { id: string; name: string } })[];
  competitions: {
    competition: CompetitionRecord;
    state: State;
    team: MyStatus["team"];
    signed_up_at: number;
  }[];
};

export type FreeAgent = {
  account_id: string;
  name: string;
  avatar_url: string | null;
  note: string;
  created_at: number;
};

export type RosterSummary = {
  total_signups: number;
  teams_count: number;
  confirmed_teams: number;
  confirmed_participants: number;
  unassigned_count: number;
};

export type CompetitionRoster = {
  competition_id: string;
  settings: SignupSettingsRecord | null;
  summary: RosterSummary;
  signups: (SignupRecord & { user: Member })[];
  teams: {
    id: string;
    name: string;
    slogan: string;
    status: TeamStatus;
    leader: Member;
    members: (Member & { role: MemberRole; status: MemberStatus })[];
    member_count: number;
    created_at: number;
  }[];
  unassigned: Member[];
};

export interface CompetitionSignupStore {
  getSettings(competitionId: string): SignupSettingsRecord | null;

  updateSettings(
    competitionId: string,
    data: {
      enabled: boolean;
      participation: ParticipationType;
      team_min?: number | null;
      team_max?: number | null;
    },
    updatedBy: string,
    now: number,
  ): { ok: true; settings: SignupSettingsRecord } | { ok: false; error: string; message: string };

  hasActiveSignups(competitionId: string): boolean;
  hasAnySignups(competitionId: string): boolean;

  signup(
    competitionId: string,
    accountId: string,
    data: { note?: string; looking_for_team?: boolean },
    now: number,
  ): { ok: true; signup: SignupRecord } | { ok: false; error: string; message: string };

  cancelSignup(
    competitionId: string,
    accountId: string,
    now: number,
  ): { ok: true } | { ok: false; error: string; message: string };

  createTeam(
    competitionId: string,
    leaderAccountId: string,
    data: { name: string; slogan?: string },
    now: number,
  ): { ok: true; team: TeamWithMembers } | { ok: false; error: string; message: string };

  applyToTeam(
    teamId: string,
    applicantAccountId: string,
    data: { message?: string },
    now: number,
  ): { ok: true; membership_id: string; status: MemberStatus } | { ok: false; error: string; message: string };

  inviteToTeam(
    teamId: string,
    leaderAccountId: string,
    data: { account_id: string; message?: string },
    now: number,
  ): { ok: true; membership_id: string; status: MemberStatus } | { ok: false; error: string; message: string };

  respondToMembership(
    teamId: string,
    membershipId: string,
    actorAccountId: string,
    action: "accept" | "decline" | "withdraw",
    now: number,
  ): { ok: true; status: MemberStatus } | { ok: false; error: string; message: string };

  leaveTeam(
    teamId: string,
    actorAccountId: string,
    now: number,
  ): { ok: true; action: "left" } | { ok: false; error: string; message: string };

  transferTeam(
    teamId: string,
    leaderAccountId: string,
    targetAccountId: string,
    now: number,
  ): { ok: true; leader_account_id: string } | { ok: false; error: string; message: string };

  disbandTeam(
    teamId: string,
    leaderAccountId: string,
    now: number,
  ): { ok: true; action: "disbanded" } | { ok: false; error: string; message: string };

  lockTeam(
    teamId: string,
    leaderAccountId: string,
    now: number,
  ): { ok: true; status: "locked" } | { ok: false; error: string; message: string };

  unlockTeam(
    teamId: string,
    leaderAccountId: string,
    now: number,
  ): { ok: true; status: "recruiting" } | { ok: false; error: string; message: string };

  getFreeAgents(competitionId: string): FreeAgent[];

  getMyStatus(competitionId: string, accountId: string, now: number): MyStatus;

  getMyCompetitions(accountId: string, now: number): MyCompetitions;

  listTeams(competitionId: string, viewerAccountId?: string): TeamWithMembers[];

  getRoster(competitionId: string): CompetitionRoster | null;

  exportRosterCsv(competitionId: string, compName: string): string | null;
}

export function createCompetitionSignupStore(db: Database.Database): CompetitionSignupStore {
  const getCompStmt = db.prepare<[string], CompetitionRecord>(
    "SELECT * FROM competitions WHERE id = ? AND offline = 0",
  );

  const getSettingsRowStmt = db.prepare<[string], {
    competition_id: string;
    enabled: number;
    participation: ParticipationType;
    team_min: number | null;
    team_max: number | null;
    updated_at: number;
    updated_by: string;
  }>("SELECT * FROM competition_signup_settings WHERE competition_id = ?");

  function getSettingsRecord(competitionId: string): SignupSettingsRecord | null {
    const row = getSettingsRowStmt.get(competitionId);
    if (!row) return null;
    return {
      competition_id: row.competition_id,
      enabled: row.enabled === 1,
      participation: row.participation,
      team_min: row.team_min,
      team_max: row.team_max,
      updated_at: row.updated_at,
      updated_by: row.updated_by,
    };
  }

  function resolveMember(accountId: string): Member {
    const sessionRow = db.prepare<[string, number], { login: string; avatar_url: string | null }>(
      "SELECT login, avatar_url FROM sessions WHERE login = ? OR user_id = ? ORDER BY expires_at DESC LIMIT 1",
    ).get(accountId, Number(accountId) || -1);

    if (sessionRow) {
      return {
        account_id: accountId,
        name: sessionRow.login,
        avatar_url: sessionRow.avatar_url,
      };
    }

    return {
      account_id: accountId,
      name: accountId,
      avatar_url: null,
    };
  }

  function isWritable(comp: CompetitionRecord, settings: SignupSettingsRecord | null, now: number): { writable: true } | { writable: false; error: string; message: string } {
    if (!settings || !settings.enabled) {
      return { writable: false, error: "signup_not_enabled", message: "该比赛尚未开放报名" };
    }
    const status = competitionStatus(comp, now);
    if (status !== "registering") {
      return { writable: false, error: "signup_closed", message: "该比赛当前不在报名时间内" };
    }
    return { writable: true };
  }

  const getSignupRowStmt = db.prepare<[string, string], {
    id: string;
    competition_id: string;
    account_id: string;
    status: SignupStatus;
    looking_for_team: number;
    note: string;
    created_at: number;
    updated_at: number;
    cancelled_at: number | null;
  }>("SELECT * FROM competition_signups WHERE competition_id = ? AND account_id = ?");

  function getSignupRecord(competitionId: string, accountId: string): SignupRecord | null {
    const row = getSignupRowStmt.get(competitionId, accountId);
    if (!row) return null;
    return {
      ...row,
      looking_for_team: row.looking_for_team === 1,
    };
  }

  const getTeamByIdStmt = db.prepare<[string], TeamRecord>(
    "SELECT * FROM competition_teams WHERE id = ?",
  );

  const getActiveTeamMembersStmt = db.prepare<[string], TeamMemberRecord>(
    "SELECT * FROM competition_team_members WHERE team_id = ? AND status = 'active' ORDER BY role DESC, created_at ASC",
  );

  const getAllTeamMembersStmt = db.prepare<[string], TeamMemberRecord>(
    "SELECT * FROM competition_team_members WHERE team_id = ? ORDER BY role DESC, created_at ASC",
  );

  const countActiveMembersStmt = db.prepare<[string], { count: number }>(
    "SELECT COUNT(*) AS count FROM competition_team_members WHERE team_id = ? AND status = 'active'",
  );

  function findUserActiveTeam(competitionId: string, accountId: string): TeamRecord | null {
    return db.prepare<[string, string], TeamRecord>(
      `SELECT t.* FROM competition_teams t
       JOIN competition_team_members m ON t.id = m.team_id
       WHERE m.competition_id = ? AND m.account_id = ? AND m.status = 'active' AND t.status != 'disbanded'
       LIMIT 1`,
    ).get(competitionId, accountId) ?? null;
  }

  function getPendingItemsForTeam(team: TeamRecord): PendingItem[] {
    const rows = db.prepare<[string], TeamMemberRecord>(
      "SELECT * FROM competition_team_members WHERE team_id = ? AND status IN ('applied', 'invited') ORDER BY created_at ASC",
    ).all(team.id);

    const count = countActiveMembersStmt.get(team.id)?.count ?? 0;

    return rows.map(r => {
      const isApplied = r.status === "applied";
      return {
        membership_id: r.id,
        type: isApplied ? "applied" : "invited",
        direction: isApplied ? "incoming" : "outgoing",
        team: { id: team.id, name: team.name, member_count: count },
        user: resolveMember(r.account_id),
        message: r.message,
        created_at: r.created_at,
      };
    });
  }

  function getFullTeam(teamId: string, viewerAccountId?: string): TeamWithMembers | null {
    const team = getTeamByIdStmt.get(teamId);
    if (!team) return null;
    const activeMembers = getActiveTeamMembersStmt.all(teamId);
    const member_count = activeMembers.length;
    const leader = resolveMember(team.leader_account_id);
    const members = activeMembers.map(m => ({
      ...resolveMember(m.account_id),
      role: m.role as "leader" | "member",
    }));

    let my_relation: TeamWithMembers["my_relation"] = "none";
    if (viewerAccountId) {
      if (team.leader_account_id === viewerAccountId) {
        my_relation = "leader";
      } else {
        const mem = db.prepare<[string, string], { status: MemberStatus }>(
          "SELECT status FROM competition_team_members WHERE team_id = ? AND account_id = ? AND status IN ('active', 'applied', 'invited') LIMIT 1",
        ).get(teamId, viewerAccountId);
        if (mem) {
          if (mem.status === "active") my_relation = "member";
          else if (mem.status === "applied") my_relation = "applied";
          else if (mem.status === "invited") my_relation = "invited";
        }
      }
    }

    const settings = getSettingsRecord(team.competition_id);
    const team_max = settings?.team_max ?? 20;
    const can_apply =
      team.status === "recruiting" &&
      member_count < team_max &&
      my_relation === "none";

    const isLeader = viewerAccountId && team.leader_account_id === viewerAccountId;
    const pending = isLeader ? getPendingItemsForTeam(team) : undefined;

    return {
      id: team.id,
      name: team.name,
      slogan: team.slogan,
      status: team.status as "recruiting" | "locked",
      leader,
      members,
      member_count,
      my_relation,
      can_apply,
      pending,
    };
  }

  function computeStats(competitionId: string, comp: CompetitionRecord, settings: SignupSettingsRecord | null) {
    const activeSignups = db.prepare<[string], { count: number }>(
      "SELECT COUNT(*) AS count FROM competition_signups WHERE competition_id = ? AND status = 'active'",
    ).get(competitionId)?.count ?? 0;

    const nonDisbandedTeams = db.prepare<[string], { count: number }>(
      "SELECT COUNT(*) AS count FROM competition_teams WHERE competition_id = ? AND status != 'disbanded'",
    ).get(competitionId)?.count ?? 0;

    const confirmedTeams = db.prepare<[string], { count: number }>(
      "SELECT COUNT(*) AS count FROM competition_teams WHERE competition_id = ? AND status = 'locked'",
    ).get(competitionId)?.count ?? 0;

    let confirmed_participants = 0;
    if (settings?.participation === "individual" && comp.kind === "internal") {
      confirmed_participants = activeSignups;
    } else {
      const lockedMembers = db.prepare<[string], { count: number }>(
        `SELECT COUNT(*) AS count FROM competition_team_members m
         JOIN competition_teams t ON m.team_id = t.id
         WHERE m.competition_id = ? AND m.status = 'active' AND t.status = 'locked'`,
      ).get(competitionId)?.count ?? 0;
      confirmed_participants = lockedMembers;
    }

    let unplaced = 0;
    if (settings?.participation === "team") {
      const unplacedCount = db.prepare<[string], { count: number }>(
        `SELECT COUNT(*) AS count FROM competition_signups s
         WHERE s.competition_id = ? AND s.status = 'active'
           AND NOT EXISTS (
             SELECT 1 FROM competition_team_members m
             WHERE m.competition_id = s.competition_id AND m.account_id = s.account_id AND m.status = 'active'
           )`,
      ).get(competitionId)?.count ?? 0;
      unplaced = unplacedCount;
    }

    return {
      signups: activeSignups,
      teams: nonDisbandedTeams,
      confirmed_teams: confirmedTeams,
      confirmed_participants,
      unplaced,
    };
  }

  return {
    getSettings(competitionId) {
      return getSettingsRecord(competitionId);
    },

    updateSettings(competitionId, data, updatedBy, now) {
      const comp = getCompStmt.get(competitionId);
      if (!comp) return { ok: false, error: "not_found", message: "比赛不存在" };

      if (data.enabled && comp.signup_deadline === null) {
        return { ok: false, error: "signup_deadline_required", message: "开放报名必须设置报名截止时间" };
      }

      if (data.participation === "individual") {
        if (data.team_min != null || data.team_max != null) {
          return { ok: false, error: "bad_team_size", message: "个人赛不可设置队伍人数" };
        }
      } else {
        if (
          data.team_min == null ||
          data.team_max == null ||
          !Number.isInteger(data.team_min) ||
          !Number.isInteger(data.team_max) ||
          data.team_min < 1 ||
          data.team_max > 20 ||
          data.team_min > data.team_max
        ) {
          return { ok: false, error: "bad_team_size", message: "团队赛人数范围须为 1 至 20 之间，且下限不大于上限" };
        }
      }

      const activeSignupCount = db.prepare<[string], { count: number }>(
        "SELECT COUNT(*) AS count FROM competition_signups WHERE competition_id = ? AND status = 'active'",
      ).get(competitionId)?.count ?? 0;

      const currentSettings = getSettingsRecord(competitionId);
      if (activeSignupCount > 0 && currentSettings && currentSettings.participation !== data.participation) {
        return { ok: false, error: "competition_has_signups", message: "已有未取消的报名记录，无法修改参赛形式" };
      }

      if (data.participation === "team") {
        const teamMax = data.team_max!;
        const teamMin = data.team_min!;
        const maxActiveMembers = db.prepare<[string], { max_c: number | null }>(
          `SELECT MAX(cnt) AS max_c FROM (
             SELECT COUNT(*) as cnt FROM competition_team_members m
             JOIN competition_teams t ON m.team_id = t.id
             WHERE m.competition_id = ? AND m.status = 'active' AND t.status != 'disbanded'
             GROUP BY m.team_id
           )`,
        ).get(competitionId)?.max_c ?? 0;

        if (maxActiveMembers > teamMax) {
          return { ok: false, error: "team_size_conflict", message: "队伍人数上限不能小于当前未解散队伍的在队人数" };
        }

        const minLockedMembers = db.prepare<[string], { min_c: number | null }>(
          `SELECT MIN(cnt) AS min_c FROM (
             SELECT COUNT(*) as cnt FROM competition_team_members m
             JOIN competition_teams t ON m.team_id = t.id
             WHERE m.competition_id = ? AND m.status = 'active' AND t.status = 'locked'
             GROUP BY m.team_id
           )`,
        ).get(competitionId)?.min_c;

        if (minLockedMembers != null && minLockedMembers < teamMin) {
          return { ok: false, error: "team_size_conflict", message: "队伍人数下限不能大于已有已锁定队伍的人数" };
        }
      }

      db.prepare(
        `INSERT INTO competition_signup_settings (competition_id, enabled, participation, team_min, team_max, updated_at, updated_by)
         VALUES (?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(competition_id) DO UPDATE SET
           enabled = excluded.enabled,
           participation = excluded.participation,
           team_min = excluded.team_min,
           team_max = excluded.team_max,
           updated_at = excluded.updated_at,
           updated_by = excluded.updated_by`,
      ).run(
        competitionId,
        data.enabled ? 1 : 0,
        data.participation,
        data.team_min ?? null,
        data.team_max ?? null,
        now,
        updatedBy,
      );

      return { ok: true, settings: getSettingsRecord(competitionId)! };
    },

    hasActiveSignups(competitionId) {
      const row = db.prepare<[string], { count: number }>(
        "SELECT COUNT(*) AS count FROM competition_signups WHERE competition_id = ? AND status = 'active'",
      ).get(competitionId);
      return (row?.count ?? 0) > 0;
    },

    hasAnySignups(competitionId) {
      const row = db.prepare<[string], { count: number }>(
        "SELECT COUNT(*) AS count FROM competition_signups WHERE competition_id = ?",
      ).get(competitionId);
      return (row?.count ?? 0) > 0;
    },

    signup(competitionId, accountId, data, now) {
      const comp = getCompStmt.get(competitionId);
      if (!comp) return { ok: false, error: "not_found", message: "比赛不存在或已下线" };

      const settings = getSettingsRecord(competitionId);
      const writableCheck = isWritable(comp, settings, now);
      if (!writableCheck.writable) return { ok: false, error: writableCheck.error, message: writableCheck.message };

      const note = data.note?.trim() ?? "";
      if (Array.from(note).length > 200) {
        return { ok: false, error: "bad_note", message: "备注不能超过 200 个字符" };
      }
      const looking_for_team = data.looking_for_team ? 1 : 0;

      const existing = getSignupRecord(competitionId, accountId);
      if (existing) {
        db.prepare(
          `UPDATE competition_signups
           SET status = 'active', looking_for_team = ?, note = ?, updated_at = ?, cancelled_at = NULL
           WHERE competition_id = ? AND account_id = ?`,
        ).run(looking_for_team, note, now, competitionId, accountId);
      } else {
        const id = randomUUID();
        db.prepare(
          `INSERT INTO competition_signups (id, competition_id, account_id, status, looking_for_team, note, created_at, updated_at, cancelled_at)
           VALUES (?, ?, ?, 'active', ?, ?, ?, ?, NULL)`,
        ).run(id, competitionId, accountId, looking_for_team, note, now, now);
      }

      return { ok: true, signup: getSignupRecord(competitionId, accountId)! };
    },

    cancelSignup(competitionId, accountId, now) {
      const comp = getCompStmt.get(competitionId);
      if (!comp) return { ok: false, error: "not_found", message: "比赛不存在或已下线" };

      const settings = getSettingsRecord(competitionId);
      const writableCheck = isWritable(comp, settings, now);
      if (!writableCheck.writable) return { ok: false, error: writableCheck.error, message: writableCheck.message };

      const signup = getSignupRecord(competitionId, accountId);
      if (!signup || signup.status === "cancelled") {
        return { ok: false, error: "not_signed_up", message: "尚未报名或已取消" };
      }

      const activeMember = db.prepare<[string, string], TeamMemberRecord>(
        `SELECT m.* FROM competition_team_members m
         JOIN competition_teams t ON m.team_id = t.id
         WHERE m.competition_id = ? AND m.account_id = ? AND m.status = 'active' AND t.status != 'disbanded'
         LIMIT 1`,
      ).get(competitionId, accountId);

      const tx = db.transaction(() => {
        if (activeMember) {
          const team = getTeamByIdStmt.get(activeMember.team_id)!;
          if (team.status === "locked") {
            throw Object.assign(new Error("team_locked"), { code: "team_locked", msg: "队伍已确认锁定，请先撤销确认参赛" });
          }

          if (activeMember.role === "leader") {
            const memberCount = countActiveMembersStmt.get(team.id)!.count;
            if (memberCount > 1) {
              throw Object.assign(new Error("is_team_leader"), {
                code: "is_team_leader",
                msg: "您当前是队伍队长且队内还有其他成员，请先转让队长或解散队伍",
              });
            }
            db.prepare(
              "UPDATE competition_teams SET status = 'disbanded', disbanded_at = ?, updated_at = ? WHERE id = ?",
            ).run(now, now, team.id);
            db.prepare(
              "UPDATE competition_team_members SET status = 'disbanded', updated_at = ? WHERE team_id = ? AND status IN ('active', 'applied', 'invited')",
            ).run(now, team.id);
          } else {
            db.prepare(
              "UPDATE competition_team_members SET status = 'left', updated_at = ? WHERE id = ?",
            ).run(now, activeMember.id);
          }
        }

        db.prepare(
          "UPDATE competition_signups SET status = 'cancelled', cancelled_at = ?, updated_at = ? WHERE competition_id = ? AND account_id = ?",
        ).run(now, now, competitionId, accountId);

        db.prepare(
          "UPDATE competition_team_members SET status = 'withdrawn', updated_at = ? WHERE competition_id = ? AND account_id = ? AND status IN ('applied', 'invited')",
        ).run(now, competitionId, accountId);
      });

      try {
        tx();
      } catch (err: any) {
        if (err.code) return { ok: false, error: err.code, message: err.msg };
        throw err;
      }

      return { ok: true };
    },

    createTeam(competitionId, leaderAccountId, data, now) {
      const comp = getCompStmt.get(competitionId);
      if (!comp) return { ok: false, error: "not_found", message: "比赛不存在或已下线" };

      const settings = getSettingsRecord(competitionId);
      const writableCheck = isWritable(comp, settings, now);
      if (!writableCheck.writable) return { ok: false, error: writableCheck.error, message: writableCheck.message };

      if (settings?.participation !== "team") {
        return { ok: false, error: "individual_competition", message: "个人赛不能创建队伍" };
      }

      const leaderSignup = getSignupRecord(competitionId, leaderAccountId);
      if (!leaderSignup || leaderSignup.status !== "active") {
        return { ok: false, error: "not_signed_up", message: "须先报名方可建队" };
      }

      const trimmedName = data.name.trim();
      const nameLength = Array.from(trimmedName).length;
      if (nameLength < 2 || nameLength > 30) {
        return { ok: false, error: "bad_team_name", message: "队伍名称须在 2 至 30 个字符之间" };
      }

      const slogan = data.slogan?.trim() ?? "";
      if (Array.from(slogan).length > 60) {
        return { ok: false, error: "bad_slogan", message: "口号长度不能超过 60 个字符" };
      }

      const activeTeam = findUserActiveTeam(competitionId, leaderAccountId);
      if (activeTeam) {
        return { ok: false, error: "already_in_team", message: "您已在其他队伍中" };
      }

      const nameKey = trimmedName.normalize("NFKC").toLowerCase();
      const dup = db.prepare<[string, string], { id: string }>(
        "SELECT id FROM competition_teams WHERE competition_id = ? AND name_key = ? AND status != 'disbanded'",
      ).get(competitionId, nameKey);
      if (dup) {
        return { ok: false, error: "duplicate_team_name", message: "该比赛中已存在同名队伍" };
      }

      const teamId = randomUUID();
      const memberId = randomUUID();

      const tx = db.transaction(() => {
        db.prepare(
          `INSERT INTO competition_teams (id, competition_id, name, name_key, slogan, leader_account_id, status, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, 'recruiting', ?, ?)`,
        ).run(teamId, competitionId, trimmedName, nameKey, slogan, leaderAccountId, now, now);

        db.prepare(
          `INSERT INTO competition_team_members (id, team_id, competition_id, account_id, role, status, message, created_by, created_at, updated_at)
           VALUES (?, ?, ?, ?, 'leader', 'active', '', ?, ?, ?)`,
        ).run(memberId, teamId, competitionId, leaderAccountId, leaderAccountId, now, now);

        db.prepare(
          "UPDATE competition_team_members SET status = 'withdrawn', updated_at = ? WHERE competition_id = ? AND account_id = ? AND id != ? AND status IN ('applied', 'invited')",
        ).run(now, competitionId, leaderAccountId, memberId);
      });
      tx();

      return { ok: true, team: getFullTeam(teamId, leaderAccountId)! };
    },

    applyToTeam(teamId, applicantAccountId, data, now) {
      const team = getTeamByIdStmt.get(teamId);
      if (!team || team.status === "disbanded") {
        return { ok: false, error: "team_not_found", message: "队伍不存在或已解散" };
      }

      const comp = getCompStmt.get(team.competition_id);
      if (!comp) return { ok: false, error: "not_found", message: "比赛不存在或已下线" };

      const settings = getSettingsRecord(team.competition_id);
      const writableCheck = isWritable(comp, settings, now);
      if (!writableCheck.writable) return { ok: false, error: writableCheck.error, message: writableCheck.message };

      if (team.status === "locked") {
        return { ok: false, error: "team_locked", message: "该队伍已确认锁定参赛，不再接受申请" };
      }

      const signup = getSignupRecord(team.competition_id, applicantAccountId);
      if (!signup || signup.status !== "active") {
        return { ok: false, error: "not_signed_up", message: "须先报名方可申请入队" };
      }

      const inActiveTeam = findUserActiveTeam(team.competition_id, applicantAccountId);
      if (inActiveTeam) {
        return { ok: false, error: "already_in_team", message: "您已在其他队伍中" };
      }

      const activeCount = countActiveMembersStmt.get(teamId)!.count;
      const teamMax = settings?.team_max ?? 20;
      if (activeCount >= teamMax) {
        return { ok: false, error: "team_full", message: "队伍人数已达上限" };
      }

      const message = data.message?.trim() ?? "";
      if (Array.from(message).length > 100) {
        return { ok: false, error: "bad_message", message: "申请附言不能超过 100 个字符" };
      }

      const existing = db.prepare<[string, string], TeamMemberRecord>(
        "SELECT * FROM competition_team_members WHERE team_id = ? AND account_id = ? AND status IN ('active', 'applied', 'invited')",
      ).get(teamId, applicantAccountId);

      if (existing) {
        if (existing.status === "active") return { ok: false, error: "already_in_team", message: "您已在队伍中" };
        if (existing.status === "applied") return { ok: false, error: "already_applied", message: "您已提交过申请，等待队长处理" };
        if (existing.status === "invited") {
          const tx = db.transaction(() => {
            db.prepare(
              "UPDATE competition_team_members SET status = 'active', decided_by = ?, decided_at = ?, updated_at = ? WHERE id = ?",
            ).run(applicantAccountId, now, now, existing.id);

            db.prepare(
              "UPDATE competition_team_members SET status = 'withdrawn', updated_at = ? WHERE competition_id = ? AND account_id = ? AND id != ? AND status IN ('applied', 'invited')",
            ).run(now, team.competition_id, applicantAccountId, existing.id);

            if (activeCount + 1 >= teamMax) {
              db.prepare(
                "UPDATE competition_team_members SET status = 'declined', decided_by = 'system', decided_at = ?, updated_at = ? WHERE team_id = ? AND status IN ('applied', 'invited')",
              ).run(now, now, teamId);
            }
          });
          tx();
          return { ok: true, membership_id: existing.id, status: "active" };
        }
      }

      const memberId = randomUUID();
      db.prepare(
        `INSERT INTO competition_team_members (id, team_id, competition_id, account_id, role, status, message, created_by, created_at, updated_at)
         VALUES (?, ?, ?, ?, 'member', 'applied', ?, ?, ?, ?)`,
      ).run(memberId, teamId, team.competition_id, applicantAccountId, message, applicantAccountId, now, now);

      return { ok: true, membership_id: memberId, status: "applied" };
    },

    inviteToTeam(teamId, leaderAccountId, data, now) {
      const team = getTeamByIdStmt.get(teamId);
      if (!team || team.status === "disbanded") {
        return { ok: false, error: "team_not_found", message: "队伍不存在或已解散" };
      }

      if (team.leader_account_id !== leaderAccountId) {
        return { ok: false, error: "not_team_leader", message: "只有队长可以发送组队邀请" };
      }

      const comp = getCompStmt.get(team.competition_id);
      if (!comp) return { ok: false, error: "not_found", message: "比赛不存在或已下线" };

      const settings = getSettingsRecord(team.competition_id);
      const writableCheck = isWritable(comp, settings, now);
      if (!writableCheck.writable) return { ok: false, error: writableCheck.error, message: writableCheck.message };

      if (team.status === "locked") {
        return { ok: false, error: "team_locked", message: "该队伍已确认锁定参赛，不再发送邀请" };
      }

      const inviteeAccountId = data.account_id.trim();
      if (inviteeAccountId === leaderAccountId) {
        return { ok: false, error: "already_in_team", message: "不能邀请自己" };
      }

      const inviteeSignup = getSignupRecord(team.competition_id, inviteeAccountId);
      if (!inviteeSignup || inviteeSignup.status !== "active") {
        return { ok: false, error: "invitee_not_signed_up", message: "对方尚未报名本场比赛" };
      }

      const inActiveTeam = findUserActiveTeam(team.competition_id, inviteeAccountId);
      if (inActiveTeam) {
        return { ok: false, error: "already_in_team", message: "对方已在其他队伍中" };
      }

      const activeCount = countActiveMembersStmt.get(teamId)!.count;
      const teamMax = settings?.team_max ?? 20;
      if (activeCount >= teamMax) {
        return { ok: false, error: "team_full", message: "队伍人数已达上限" };
      }

      const message = data.message?.trim() ?? "";
      if (Array.from(message).length > 100) {
        return { ok: false, error: "bad_message", message: "邀请附言不能超过 100 个字符" };
      }

      const existing = db.prepare<[string, string], TeamMemberRecord>(
        "SELECT * FROM competition_team_members WHERE team_id = ? AND account_id = ? AND status IN ('active', 'applied', 'invited')",
      ).get(teamId, inviteeAccountId);

      if (existing) {
        if (existing.status === "active") return { ok: false, error: "already_in_team", message: "对方已在队伍中" };
        if (existing.status === "invited") return { ok: false, error: "already_invited", message: "已向对方发出过邀请，等待对方处理" };
        if (existing.status === "applied") {
          const tx = db.transaction(() => {
            db.prepare(
              "UPDATE competition_team_members SET status = 'active', decided_by = ?, decided_at = ?, updated_at = ? WHERE id = ?",
            ).run(leaderAccountId, now, now, existing.id);

            db.prepare(
              "UPDATE competition_team_members SET status = 'withdrawn', updated_at = ? WHERE competition_id = ? AND account_id = ? AND id != ? AND status IN ('applied', 'invited')",
            ).run(now, team.competition_id, inviteeAccountId, existing.id);

            if (activeCount + 1 >= teamMax) {
              db.prepare(
                "UPDATE competition_team_members SET status = 'declined', decided_by = 'system', decided_at = ?, updated_at = ? WHERE team_id = ? AND status IN ('applied', 'invited')",
              ).run(now, now, teamId);
            }
          });
          tx();
          return { ok: true, membership_id: existing.id, status: "active" };
        }
      }

      const memberId = randomUUID();
      db.prepare(
        `INSERT INTO competition_team_members (id, team_id, competition_id, account_id, role, status, message, created_by, created_at, updated_at)
         VALUES (?, ?, ?, ?, 'member', 'invited', ?, ?, ?, ?)`,
      ).run(memberId, teamId, team.competition_id, inviteeAccountId, message, leaderAccountId, now, now);

      return { ok: true, membership_id: memberId, status: "invited" };
    },

    respondToMembership(teamId, membershipId, actorAccountId, action, now) {
      const team = getTeamByIdStmt.get(teamId);
      if (!team || team.status === "disbanded") {
        return { ok: false, error: "team_not_found", message: "队伍不存在或已解散" };
      }

      const comp = getCompStmt.get(team.competition_id);
      if (!comp) return { ok: false, error: "not_found", message: "比赛不存在或已下线" };

      const settings = getSettingsRecord(team.competition_id);
      const writableCheck = isWritable(comp, settings, now);
      if (!writableCheck.writable) return { ok: false, error: writableCheck.error, message: writableCheck.message };

      const membership = db.prepare<[string], TeamMemberRecord>(
        "SELECT * FROM competition_team_members WHERE id = ?",
      ).get(membershipId);

      if (!membership || membership.team_id !== teamId) {
        return { ok: false, error: "not_found", message: "成员申请或邀请不存在" };
      }

      if (membership.status !== "applied" && membership.status !== "invited") {
        return { ok: false, error: "invalid_state", message: "该记录已非等待处理状态" };
      }

      if (membership.status === "applied") {
        if (action === "accept" || action === "decline") {
          if (team.leader_account_id !== actorAccountId) {
            return { ok: false, error: "not_team_leader", message: "只有队长可以同意或拒绝入队申请" };
          }
        } else if (action === "withdraw") {
          if (membership.account_id !== actorAccountId) {
            return { ok: false, error: "forbidden", message: "只有申请人可以撤回申请" };
          }
        }
      } else if (membership.status === "invited") {
        if (action === "accept" || action === "decline") {
          if (membership.account_id !== actorAccountId) {
            return { ok: false, error: "forbidden", message: "只有受邀人可以接受或拒绝邀请" };
          }
        } else if (action === "withdraw") {
          if (team.leader_account_id !== actorAccountId) {
            return { ok: false, error: "not_team_leader", message: "只有队长可以撤回邀请" };
          }
        }
      }

      if (action === "decline" || action === "withdraw") {
        const nextStatus = action === "decline" ? "declined" : "withdrawn";
        db.prepare(
          "UPDATE competition_team_members SET status = ?, decided_by = ?, decided_at = ?, updated_at = ? WHERE id = ?",
        ).run(nextStatus, actorAccountId, now, now, membershipId);
        return { ok: true, status: nextStatus };
      }

      const activeCount = countActiveMembersStmt.get(teamId)!.count;
      const teamMax = settings?.team_max ?? 20;
      if (activeCount >= teamMax) {
        return { ok: false, error: "team_full", message: "队伍人数已达上限，无法确认加入" };
      }

      const inActiveTeam = findUserActiveTeam(team.competition_id, membership.account_id);
      if (inActiveTeam) {
        return { ok: false, error: "already_in_team", message: "该成员已在其他队伍中" };
      }

      const tx = db.transaction(() => {
        db.prepare(
          "UPDATE competition_team_members SET status = 'active', decided_by = ?, decided_at = ?, updated_at = ? WHERE id = ?",
        ).run(actorAccountId, now, now, membershipId);

        db.prepare(
          "UPDATE competition_team_members SET status = 'withdrawn', updated_at = ? WHERE competition_id = ? AND account_id = ? AND id != ? AND status IN ('applied', 'invited')",
        ).run(now, team.competition_id, membership.account_id, membershipId);

        if (activeCount + 1 >= teamMax) {
          db.prepare(
            "UPDATE competition_team_members SET status = 'declined', decided_by = 'system', decided_at = ?, updated_at = ? WHERE team_id = ? AND status IN ('applied', 'invited')",
          ).run(now, now, teamId);
        }
      });
      tx();

      return { ok: true, status: "active" };
    },

    leaveTeam(teamId, actorAccountId, now) {
      const team = getTeamByIdStmt.get(teamId);
      if (!team || team.status === "disbanded") {
        return { ok: false, error: "team_not_found", message: "队伍不存在或已解散" };
      }

      const comp = getCompStmt.get(team.competition_id);
      if (!comp) return { ok: false, error: "not_found", message: "比赛不存在或已下线" };

      const settings = getSettingsRecord(team.competition_id);
      const writableCheck = isWritable(comp, settings, now);
      if (!writableCheck.writable) return { ok: false, error: writableCheck.error, message: writableCheck.message };

      if (team.status === "locked") {
        return { ok: false, error: "team_locked", message: "队伍已锁定参赛，成员不能退出" };
      }

      if (team.leader_account_id === actorAccountId) {
        return { ok: false, error: "is_team_leader", message: "队长不能直接退出，请先转让队长或解散队伍" };
      }

      const member = db.prepare<[string, string], TeamMemberRecord>(
        "SELECT * FROM competition_team_members WHERE team_id = ? AND account_id = ? AND status = 'active'",
      ).get(teamId, actorAccountId);

      if (!member) {
        return { ok: false, error: "not_in_team", message: "您不是该队伍在队成员" };
      }

      db.prepare(
        "UPDATE competition_team_members SET status = 'left', updated_at = ? WHERE id = ?",
      ).run(now, member.id);

      return { ok: true, action: "left" };
    },

    transferTeam(teamId, leaderAccountId, targetAccountId, now) {
      const team = getTeamByIdStmt.get(teamId);
      if (!team || team.status === "disbanded") {
        return { ok: false, error: "team_not_found", message: "队伍不存在或已解散" };
      }

      if (team.leader_account_id !== leaderAccountId) {
        return { ok: false, error: "not_team_leader", message: "只有队长可以转让队伍" };
      }

      const comp = getCompStmt.get(team.competition_id);
      if (!comp) return { ok: false, error: "not_found", message: "比赛不存在或已下线" };

      const settings = getSettingsRecord(team.competition_id);
      const writableCheck = isWritable(comp, settings, now);
      if (!writableCheck.writable) return { ok: false, error: writableCheck.error, message: writableCheck.message };

      if (targetAccountId === leaderAccountId) {
        return { ok: true, leader_account_id: leaderAccountId };
      }

      const targetMember = db.prepare<[string, string], TeamMemberRecord>(
        "SELECT * FROM competition_team_members WHERE team_id = ? AND account_id = ? AND status = 'active'",
      ).get(teamId, targetAccountId);

      if (!targetMember) {
        return { ok: false, error: "target_not_in_team", message: "目标成员不在队伍中" };
      }

      const tx = db.transaction(() => {
        db.prepare(
          "UPDATE competition_teams SET leader_account_id = ?, updated_at = ? WHERE id = ?",
        ).run(targetAccountId, now, teamId);

        db.prepare(
          "UPDATE competition_team_members SET role = 'leader', updated_at = ? WHERE id = ?",
        ).run(now, targetMember.id);

        db.prepare(
          "UPDATE competition_team_members SET role = 'member', updated_at = ? WHERE team_id = ? AND account_id = ?",
        ).run(now, teamId, leaderAccountId);
      });
      tx();

      return { ok: true, leader_account_id: targetAccountId };
    },

    disbandTeam(teamId, leaderAccountId, now) {
      const team = getTeamByIdStmt.get(teamId);
      if (!team || team.status === "disbanded") {
        return { ok: false, error: "team_not_found", message: "队伍不存在或已解散" };
      }

      if (team.leader_account_id !== leaderAccountId) {
        return { ok: false, error: "not_team_leader", message: "只有队长可以解散队伍" };
      }

      const comp = getCompStmt.get(team.competition_id);
      if (!comp) return { ok: false, error: "not_found", message: "比赛不存在或已下线" };

      const settings = getSettingsRecord(team.competition_id);
      const writableCheck = isWritable(comp, settings, now);
      if (!writableCheck.writable) return { ok: false, error: writableCheck.error, message: writableCheck.message };

      const tx = db.transaction(() => {
        db.prepare(
          "UPDATE competition_teams SET status = 'disbanded', disbanded_at = ?, updated_at = ? WHERE id = ?",
        ).run(now, now, teamId);

        db.prepare(
          "UPDATE competition_team_members SET status = 'disbanded', updated_at = ? WHERE team_id = ? AND status IN ('active', 'applied', 'invited')",
        ).run(now, teamId);
      });
      tx();

      return { ok: true, action: "disbanded" };
    },

    lockTeam(teamId, leaderAccountId, now) {
      const team = getTeamByIdStmt.get(teamId);
      if (!team || team.status === "disbanded") {
        return { ok: false, error: "team_not_found", message: "队伍不存在或已解散" };
      }

      if (team.leader_account_id !== leaderAccountId) {
        return { ok: false, error: "not_team_leader", message: "只有队长可以确认参赛" };
      }

      const comp = getCompStmt.get(team.competition_id);
      if (!comp) return { ok: false, error: "not_found", message: "比赛不存在或已下线" };

      const settings = getSettingsRecord(team.competition_id);
      const writableCheck = isWritable(comp, settings, now);
      if (!writableCheck.writable) return { ok: false, error: writableCheck.error, message: writableCheck.message };

      if (team.status === "locked") {
        return { ok: false, error: "already_locked", message: "队伍已锁定确认参赛" };
      }

      const activeCount = countActiveMembersStmt.get(teamId)!.count;
      const teamMin = settings?.team_min ?? 1;
      const teamMax = settings?.team_max ?? 20;

      if (activeCount < teamMin) {
        return { ok: false, error: "team_too_small", message: `队伍人数未达下限（至少 ${teamMin} 人）` };
      }
      if (activeCount > teamMax) {
        return { ok: false, error: "team_full", message: `队伍人数超出上限（最多 ${teamMax} 人）` };
      }

      const tx = db.transaction(() => {
        db.prepare(
          "UPDATE competition_teams SET status = 'locked', locked_at = ?, updated_at = ? WHERE id = ?",
        ).run(now, now, teamId);

        db.prepare(
          "UPDATE competition_team_members SET status = 'declined', decided_by = ?, decided_at = ?, updated_at = ? WHERE team_id = ? AND status IN ('applied', 'invited')",
        ).run(leaderAccountId, now, now, teamId);
      });
      tx();

      return { ok: true, status: "locked" };
    },

    unlockTeam(teamId, leaderAccountId, now) {
      const team = getTeamByIdStmt.get(teamId);
      if (!team || team.status === "disbanded") {
        return { ok: false, error: "team_not_found", message: "队伍不存在或已解散" };
      }

      if (team.leader_account_id !== leaderAccountId) {
        return { ok: false, error: "not_team_leader", message: "只有队长可以撤销确认参赛" };
      }

      const comp = getCompStmt.get(team.competition_id);
      if (!comp) return { ok: false, error: "not_found", message: "比赛不存在或已下线" };

      const settings = getSettingsRecord(team.competition_id);
      const writableCheck = isWritable(comp, settings, now);
      if (!writableCheck.writable) return { ok: false, error: writableCheck.error, message: writableCheck.message };

      if (team.status !== "locked") {
        return { ok: false, error: "not_locked", message: "队伍当前未锁定" };
      }

      db.prepare(
        "UPDATE competition_teams SET status = 'recruiting', locked_at = NULL, updated_at = ? WHERE id = ?",
      ).run(now, teamId);

      return { ok: true, status: "recruiting" };
    },

    getFreeAgents(competitionId) {
      const rows = db.prepare<[string], {
        account_id: string;
        note: string;
        created_at: number;
      }>(
        `SELECT s.account_id, s.note, s.created_at
         FROM competition_signups s
         WHERE s.competition_id = ? AND s.status = 'active' AND s.looking_for_team = 1
           AND NOT EXISTS (
             SELECT 1 FROM competition_team_members m
             WHERE m.competition_id = s.competition_id AND m.account_id = s.account_id AND m.status = 'active'
           )
         ORDER BY s.created_at ASC`,
      ).all(competitionId);

      return rows.map(r => ({
        ...resolveMember(r.account_id),
        note: r.note,
        created_at: r.created_at,
      }));
    },

    getMyStatus(competitionId, accountId, now) {
      const comp = getCompStmt.get(competitionId);
      const settings = getSettingsRecord(competitionId);
      const writable = comp ? isWritable(comp, settings, now).writable : false;

      const signup = getSignupRecord(competitionId, accountId);
      const activeTeam = findUserActiveTeam(competitionId, accountId);
      const team = activeTeam ? getFullTeam(activeTeam.id, accountId) : null;

      const pendingRows = db.prepare<[string, string, string], {
        membership_id: string;
        team_id: string;
        team_name: string;
        account_id: string;
        status: MemberStatus;
        message: string;
        created_at: number;
        leader_account_id: string;
      }>(
        `SELECT m.id AS membership_id, t.id AS team_id, t.name AS team_name, m.account_id, m.status, m.message, m.created_at, t.leader_account_id
         FROM competition_team_members m
         JOIN competition_teams t ON m.team_id = t.id
         WHERE m.competition_id = ? AND t.status != 'disbanded'
           AND (
             (m.account_id = ? AND m.status = 'invited')
             OR (t.leader_account_id = ? AND m.status = 'applied')
           )
         ORDER BY m.created_at ASC`,
      ).all(competitionId, accountId, accountId);

      const pending: PendingItem[] = pendingRows.map(r => {
        const isApplied = r.status === "applied";
        const count = countActiveMembersStmt.get(r.team_id)?.count ?? 0;
        const otherAccountId = isApplied ? r.account_id : r.leader_account_id;
        return {
          membership_id: r.membership_id,
          type: isApplied ? "applied" : "invited",
          direction: "incoming",
          team: { id: r.team_id, name: r.team_name, member_count: count },
          user: resolveMember(otherAccountId),
          message: r.message,
          created_at: r.created_at,
        };
      });

      const compStatus = comp ? competitionStatus(comp, now) : "ended";
      const isInternal = comp?.kind === "internal";
      const isTeam = settings?.participation === "team";

      let state: State = "none";
      if (!signup || signup.status === "cancelled") {
        state = "none";
      } else if (compStatus === "ended" || compStatus === "closed") {
        if (!isTeam) {
          state = isInternal ? "confirmed" : "signed_up";
        } else {
          if (team && team.status === "locked") state = "confirmed";
          else state = "unplaced";
        }
      } else {
        if (!isTeam) {
          state = isInternal ? "confirmed" : "signed_up";
        } else {
          if (!team) state = "signed_up";
          else if (team.status === "recruiting") state = "in_team";
          else if (team.status === "locked") state = "confirmed";
          else state = "signed_up";
        }
      }

      const actions: string[] = [];
      if (writable) {
        if (!signup || signup.status === "cancelled") {
          actions.push("signup");
        } else {
          actions.push("cancel_signup");
          if (isTeam) {
            if (!team) {
              actions.push("create_team");
            } else if (team.my_relation === "leader") {
              if (team.status === "recruiting") {
                const teamMin = settings?.team_min ?? 1;
                const teamMax = settings?.team_max ?? 20;
                if (team.member_count >= teamMin && team.member_count <= teamMax) {
                  actions.push("lock");
                }
                actions.push("transfer", "disband", "invite");
              } else if (team.status === "locked") {
                actions.push("unlock");
              }
            } else if (team.my_relation === "member") {
              if (team.status !== "locked") {
                actions.push("leave");
              }
            }
          }
        }
      }

      const stats = comp ? computeStats(competitionId, comp, settings) : { signups: 0, teams: 0, confirmed_teams: 0, confirmed_participants: 0, unplaced: 0 };

      return {
        writable,
        state,
        signup: signup && signup.status === "active" ? { note: signup.note, looking_for_team: signup.looking_for_team, created_at: signup.created_at } : null,
        team: team
          ? {
              id: team.id,
              name: team.name,
              status: team.status,
              role: team.my_relation === "leader" ? "leader" : "member",
              member_count: team.member_count,
            }
          : null,
        pending,
        actions,
        stats,
      };
    },

    getMyCompetitions(accountId, now) {
      const rows = db.prepare<[string], {
        competition_id: string;
        created_at: number;
      }>(
        `SELECT DISTINCT competition_id, created_at
         FROM competition_signups
         WHERE account_id = ? AND status = 'active'
         ORDER BY created_at DESC`,
      ).all(accountId);

      const competitions: MyCompetitions["competitions"] = [];
      for (const r of rows) {
        const comp = getCompStmt.get(r.competition_id);
        if (!comp) continue;
        const myStatus = this.getMyStatus(comp.id, accountId, now);
        competitions.push({
          competition: comp,
          state: myStatus.state,
          team: myStatus.team,
          signed_up_at: r.created_at,
        });
      }

      const pendingRows = db.prepare<[string, string], {
        membership_id: string;
        team_id: string;
        team_name: string;
        competition_id: string;
        comp_name: string;
        account_id: string;
        status: MemberStatus;
        message: string;
        created_at: number;
        leader_account_id: string;
      }>(
        `SELECT m.id AS membership_id, t.id AS team_id, t.name AS team_name, c.id AS competition_id, c.name AS comp_name,
                m.account_id, m.status, m.message, m.created_at, t.leader_account_id
         FROM competition_team_members m
         JOIN competition_teams t ON m.team_id = t.id
         JOIN competitions c ON m.competition_id = c.id
         WHERE c.offline = 0 AND t.status != 'disbanded'
           AND (
             (m.account_id = ? AND m.status = 'invited')
             OR (t.leader_account_id = ? AND m.status = 'applied')
           )
         ORDER BY m.created_at DESC`,
      ).all(accountId, accountId);

      const pending = pendingRows.map(r => {
        const isApplied = r.status === "applied";
        const count = countActiveMembersStmt.get(r.team_id)?.count ?? 0;
        const otherAccountId = isApplied ? r.account_id : r.leader_account_id;
        return {
          membership_id: r.membership_id,
          type: (isApplied ? "applied" : "invited") as "applied" | "invited",
          direction: "incoming" as const,
          team: { id: r.team_id, name: r.team_name, member_count: count },
          user: resolveMember(otherAccountId),
          message: r.message,
          created_at: r.created_at,
          competition: { id: r.competition_id, name: r.comp_name },
        };
      });

      return {
        pending_count: pending.length,
        pending,
        competitions,
      };
    },

    listTeams(competitionId, viewerAccountId) {
      const teams = db.prepare<[string], TeamRecord>(
        "SELECT * FROM competition_teams WHERE competition_id = ? AND status != 'disbanded' ORDER BY created_at DESC",
      ).all(competitionId);
      return teams.map(t => getFullTeam(t.id, viewerAccountId)!);
    },

    getRoster(competitionId) {
      const comp = getCompStmt.get(competitionId);
      if (!comp) return null;

      const settings = getSettingsRecord(competitionId);
      const signups = db.prepare<[string], {
        id: string;
        competition_id: string;
        account_id: string;
        status: SignupStatus;
        looking_for_team: number;
        note: string;
        created_at: number;
        updated_at: number;
        cancelled_at: number | null;
      }>(
        "SELECT * FROM competition_signups WHERE competition_id = ? ORDER BY created_at ASC",
      ).all(competitionId).map(s => ({
        ...s,
        looking_for_team: s.looking_for_team === 1,
        user: resolveMember(s.account_id),
      }));

      const teamRows = db.prepare<[string], TeamRecord>(
        "SELECT * FROM competition_teams WHERE competition_id = ? ORDER BY created_at ASC",
      ).all(competitionId);

      const teams = teamRows.map(t => {
        const allMembers = getAllTeamMembersStmt.all(t.id);
        const activeMembers = allMembers.filter(m => m.status === "active");
        return {
          id: t.id,
          name: t.name,
          slogan: t.slogan,
          status: t.status,
          leader: resolveMember(t.leader_account_id),
          members: allMembers.map(m => ({
            ...resolveMember(m.account_id),
            role: m.role,
            status: m.status,
          })),
          member_count: activeMembers.length,
          created_at: t.created_at,
        };
      });

      const unassignedAccounts = db.prepare<[string], { account_id: string }>(
        `SELECT s.account_id FROM competition_signups s
         WHERE s.competition_id = ? AND s.status = 'active'
           AND NOT EXISTS (
             SELECT 1 FROM competition_team_members m
             WHERE m.competition_id = s.competition_id AND m.account_id = s.account_id AND m.status = 'active'
           )`,
      ).all(competitionId);

      const summary = computeStats(competitionId, comp, settings);

      return {
        competition_id: competitionId,
        settings,
        summary: {
          total_signups: summary.signups,
          teams_count: summary.teams,
          confirmed_teams: summary.confirmed_teams,
          confirmed_participants: summary.confirmed_participants,
          unassigned_count: summary.unplaced,
        },
        signups,
        teams,
        unassigned: unassignedAccounts.map(u => resolveMember(u.account_id)),
      };
    },

    exportRosterCsv(competitionId, compName) {
      const roster = this.getRoster(competitionId);
      if (!roster) return null;

      const headers = [
        "序号", "账号", "姓名", "参赛形式", "状态", "队伍", "队内角色", "参赛备注", "登记时间",
      ];

      const userTeamMap = new Map<string, { teamName: string; role: string }>();
      for (const t of roster.teams) {
        for (const m of t.members) {
          if (m.status === "active") {
            userTeamMap.set(m.account_id, {
              teamName: t.name,
              role: m.role === "leader" ? "队长" : "队员",
            });
          }
        }
      }

      const rows: string[][] = [];
      let index = 1;
      for (const s of roster.signups) {
        const teamInfo = userTeamMap.get(s.account_id);
        const participationStr = roster.settings?.participation === "team" ? "团队赛" : "个人赛";
        const statusStr = s.status === "active" ? "已报名" : "已取消";

        rows.push([
          String(index++),
          s.account_id,
          s.user.name,
          participationStr,
          statusStr,
          teamInfo?.teamName ?? "（未入队）",
          teamInfo?.role ?? "—",
          s.note || "—",
          beijingDateTime(s.created_at),
        ]);
      }

      const csvLines = [
        headers.map(csvCell).join(","),
        ...rows.map(row => row.map(csvCell).join(",")),
      ];

      return "﻿" + csvLines.join("\r\n");
    },
  };
}

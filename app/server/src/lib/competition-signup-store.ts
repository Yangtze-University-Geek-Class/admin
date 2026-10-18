// 比赛报名与组队（#239）：支持内部赛报名、外部赛意向与双向确认组队机制。
// 持久化存储于 SQLite，纯参数接口，授权判定在调用方路由。
import { randomUUID } from "node:crypto";
import type Database from "better-sqlite3";
import { competitionStatus, type CompetitionRecord } from "./competition-store.js";
import { csvCell } from "./csv.js";
import { beijingDateTime } from "./beijing-time.js";

export type SignupKind = "internal" | "external";
export type SignupStatus = "registered" | "intent" | "cancelled";
export type TeamStatus = "recruiting" | "confirmed" | "disbanded";
export type MemberRole = "leader" | "member";
export type MemberStatus = "confirmed" | "pending_invite" | "pending_apply" | "rejected";

export type SignupRecord = {
  id: string;
  competition_id: string;
  github_login: string;
  github_user_id: number | null;
  kind: SignupKind;
  status: SignupStatus;
  note: string;
  contact: string;
  created_at: number;
  updated_at: number;
};

export type TeamMemberRecord = {
  id: string;
  team_id: string;
  competition_id: string;
  github_login: string;
  github_user_id: number | null;
  role: MemberRole;
  status: MemberStatus;
  created_at: number;
  updated_at: number;
};

export type TeamRecord = {
  id: string;
  competition_id: string;
  name: string;
  leader_login: string;
  leader_user_id: number | null;
  status: TeamStatus;
  max_members: number;
  slogan: string;
  created_at: number;
  updated_at: number;
};

export type TeamWithMembers = TeamRecord & {
  members: TeamMemberRecord[];
  confirmed_count: number;
};

export type RosterSummary = {
  total_signups: number;
  internal_registered: number;
  external_intents: number;
  teams_count: number;
  confirmed_participants: number;
  unassigned_count: number;
};

export type CompetitionRoster = {
  competition_id: string;
  summary: RosterSummary;
  signups: SignupRecord[];
  teams: TeamWithMembers[];
  unassigned_logins: string[];
};

export type MyCompetitionStatus = {
  signup: SignupRecord | null;
  confirmed_team: TeamWithMembers | null;
  pending_invites: { membership_id: string; team: TeamRecord }[];
  pending_applications: { membership_id: string; team: TeamRecord }[];
};

export interface CompetitionSignupStore {
  signup(
    competitionId: string,
    user: { login: string; userId: number | null },
    data: { note?: string; contact?: string },
    now: number,
  ): { ok: true; signup: SignupRecord } | { ok: false; error: string; message: string };

  cancelSignup(
    competitionId: string,
    login: string,
    now: number,
  ): { ok: true } | { ok: false; error: string; message: string };

  createTeam(
    competitionId: string,
    leader: { login: string; userId: number | null },
    data: { name: string; slogan?: string; maxMembers?: number },
    now: number,
  ): { ok: true; team: TeamWithMembers } | { ok: false; error: string; message: string };

  applyToTeam(
    teamId: string,
    applicant: { login: string; userId: number | null },
    now: number,
  ): { ok: true; membership_id: string } | { ok: false; error: string; message: string };

  inviteToTeam(
    teamId: string,
    leaderLogin: string,
    invitee: { login: string; userId?: number | null },
    now: number,
  ): { ok: true; membership_id: string } | { ok: false; error: string; message: string };

  respondToMembership(
    membershipId: string,
    actorLogin: string,
    action: "accept" | "reject",
    now: number,
  ): { ok: true; status: MemberStatus } | { ok: false; error: string; message: string };

  leaveTeam(
    teamId: string,
    actorLogin: string,
    now: number,
  ): { ok: true; action: "left" | "disbanded" } | { ok: false; error: string; message: string };

  getMyStatus(competitionId: string, login: string): MyCompetitionStatus;

  listTeams(competitionId: string): TeamWithMembers[];

  getRoster(competitionId: string): CompetitionRoster | null;

  exportRosterCsv(competitionId: string, compName: string): string | null;
}

export function createCompetitionSignupStore(db: Database.Database): CompetitionSignupStore {
  const getCompStmt = db.prepare<[string], CompetitionRecord>(
    "SELECT * FROM competitions WHERE id = ? AND offline = 0",
  );

  const getSignupStmt = db.prepare<[string, string], SignupRecord>(
    "SELECT * FROM competition_signups WHERE competition_id = ? AND github_login = ?",
  );

  const insertSignupStmt = db.prepare(
    `INSERT INTO competition_signups (id, competition_id, github_login, github_user_id, kind, status, note, contact, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(competition_id, github_login) DO UPDATE SET
       status = excluded.status,
       note = excluded.note,
       contact = excluded.contact,
       github_user_id = COALESCE(excluded.github_user_id, competition_signups.github_user_id),
       updated_at = excluded.updated_at`,
  );

  const getTeamByIdStmt = db.prepare<[string], TeamRecord>(
    "SELECT * FROM competition_teams WHERE id = ?",
  );

  const getTeamMembersStmt = db.prepare<[string], TeamMemberRecord>(
    "SELECT * FROM competition_team_members WHERE team_id = ? ORDER BY role DESC, created_at ASC",
  );

  const countConfirmedMembersStmt = db.prepare<[string], { count: number }>(
    "SELECT COUNT(*) AS count FROM competition_team_members WHERE team_id = ? AND status = 'confirmed'",
  );

  const findUserConfirmedTeamStmt = db.prepare<[string, string], TeamRecord>(
    `SELECT t.* FROM competition_teams t
     JOIN competition_team_members m ON t.id = m.team_id
     WHERE m.competition_id = ? AND m.github_login = ? AND m.status = 'confirmed' AND t.status != 'disbanded'
     LIMIT 1`,
  );

  const getMembershipByIdStmt = db.prepare<[string], TeamMemberRecord>(
    "SELECT * FROM competition_team_members WHERE id = ?",
  );

  const getMembershipByTeamAndUserStmt = db.prepare<[string, string], TeamMemberRecord>(
    "SELECT * FROM competition_team_members WHERE team_id = ? AND github_login = ?",
  );

  function getFullTeam(teamId: string): TeamWithMembers | null {
    const team = getTeamByIdStmt.get(teamId);
    if (!team) return null;
    const members = getTeamMembersStmt.all(teamId);
    const confirmed_count = members.filter(m => m.status === "confirmed").length;
    return { ...team, members, confirmed_count };
  }

  return {
    signup(competitionId, user, data, now) {
      const comp = getCompStmt.get(competitionId);
      if (!comp) return { ok: false, error: "competition_not_found", message: "比赛不存在或已下线" };
      const status = competitionStatus(comp, now);
      if (status !== "registering") {
        return { ok: false, error: "signup_closed", message: "该比赛当前不在报名时间内" };
      }

      const signupKind: SignupKind = comp.kind;
      const signupStatus: SignupStatus = comp.kind === "internal" ? "registered" : "intent";
      const id = randomUUID();
      const note = data.note?.trim() ?? "";
      const contact = data.contact?.trim() ?? "";

      insertSignupStmt.run(
        id,
        competitionId,
        user.login,
        user.userId,
        signupKind,
        signupStatus,
        note,
        contact,
        now,
        now,
      );

      const saved = getSignupStmt.get(competitionId, user.login)!;
      return { ok: true, signup: saved };
    },

    cancelSignup(competitionId, login, now) {
      const existing = getSignupStmt.get(competitionId, login);
      if (!existing || existing.status === "cancelled") {
        return { ok: false, error: "not_signed_up", message: "尚未报名或已取消" };
      }

      // 检查是否为进行中队伍的队长
      const leadingTeam = db.prepare<[string, string], { id: string }>(
        "SELECT id FROM competition_teams WHERE competition_id = ? AND leader_login = ? AND status != 'disbanded'",
      ).get(competitionId, login);
      if (leadingTeam) {
        return { ok: false, error: "is_team_leader", message: "您当前是参赛队伍队长，请先解散队伍再取消报名" };
      }

      // 如果是队伍成员，退队
      db.prepare(
        "DELETE FROM competition_team_members WHERE competition_id = ? AND github_login = ?",
      ).run(competitionId, login);

      db.prepare(
        "UPDATE competition_signups SET status = 'cancelled', updated_at = ? WHERE competition_id = ? AND github_login = ?",
      ).run(now, competitionId, login);

      return { ok: true };
    },

    createTeam(competitionId, leader, data, now) {
      const comp = getCompStmt.get(competitionId);
      if (!comp) return { ok: false, error: "competition_not_found", message: "比赛不存在或已下线" };
      const status = competitionStatus(comp, now);
      if (status === "ended") {
        return { ok: false, error: "competition_ended", message: "比赛已结束，无法新建队伍" };
      }

      const name = data.name.trim();
      if (!name) return { ok: false, error: "bad_team_name", message: "队伍名称不能为空" };

      const maxMembers = Math.min(20, Math.max(1, data.maxMembers ?? 5));
      const slogan = data.slogan?.trim() ?? "";

      // 检查队长是否已加入确认队伍
      const existingTeam = findUserConfirmedTeamStmt.get(competitionId, leader.login);
      if (existingTeam) {
        return { ok: false, error: "already_in_team", message: "您已在其他队伍中确认参赛，无法建队" };
      }

      // 检查队伍名重复
      const dup = db.prepare<[string, string], { id: string }>(
        "SELECT id FROM competition_teams WHERE competition_id = ? AND name = ? AND status != 'disbanded'",
      ).get(competitionId, name);
      if (dup) {
        return { ok: false, error: "duplicate_team_name", message: "该比赛中已存在同名队伍" };
      }

      const teamId = randomUUID();
      const memberId = randomUUID();

      const tx = db.transaction(() => {
        db.prepare(
          `INSERT INTO competition_teams (id, competition_id, name, leader_login, leader_user_id, status, max_members, slogan, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, 'recruiting', ?, ?, ?, ?)`,
        ).run(teamId, competitionId, name, leader.login, leader.userId, maxMembers, slogan, now, now);

        db.prepare(
          `INSERT INTO competition_team_members (id, team_id, competition_id, github_login, github_user_id, role, status, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, 'leader', 'confirmed', ?, ?)`,
        ).run(memberId, teamId, competitionId, leader.login, leader.userId, now, now);

        // 如果队长还没有报名记录，自动补一条登记
        const existingSignup = getSignupStmt.get(competitionId, leader.login);
        if (!existingSignup || existingSignup.status === "cancelled") {
          const signupKind: SignupKind = comp.kind;
          const signupStatus: SignupStatus = comp.kind === "internal" ? "registered" : "intent";
          insertSignupStmt.run(
            randomUUID(),
            competitionId,
            leader.login,
            leader.userId,
            signupKind,
            signupStatus,
            "建队自动登记",
            "",
            now,
            now,
          );
        }
      });
      tx();

      return { ok: true, team: getFullTeam(teamId)! };
    },

    applyToTeam(teamId, applicant, now) {
      const team = getTeamByIdStmt.get(teamId);
      if (!team || team.status === "disbanded") {
        return { ok: false, error: "team_not_found", message: "队伍不存在或已解散" };
      }

      const comp = getCompStmt.get(team.competition_id);
      if (!comp || competitionStatus(comp, now) === "ended") {
        return { ok: false, error: "competition_ended", message: "比赛已结束" };
      }

      const confirmedCount = countConfirmedMembersStmt.get(teamId)!.count;
      if (confirmedCount >= team.max_members) {
        return { ok: false, error: "team_full", message: "队伍人数已达上限" };
      }

      const inConfirmedTeam = findUserConfirmedTeamStmt.get(team.competition_id, applicant.login);
      if (inConfirmedTeam) {
        return { ok: false, error: "already_in_team", message: "您已在其他队伍中确认参赛" };
      }

      const existing = getMembershipByTeamAndUserStmt.get(teamId, applicant.login);
      if (existing) {
        if (existing.status === "confirmed") {
          return { ok: false, error: "already_in_team", message: "您已是该队伍正式成员" };
        }
        if (existing.status === "pending_apply") {
          return { ok: false, error: "already_applied", message: "您已提交申请，请等待队长确认" };
        }
        if (existing.status === "pending_invite") {
          // 队长先前已邀请，申请人主动加入 -> 双方确认，直接成为 confirmed
          db.prepare(
            "UPDATE competition_team_members SET status = 'confirmed', updated_at = ? WHERE id = ?",
          ).run(now, existing.id);
          return { ok: true, membership_id: existing.id };
        }
      }

      const memberId = randomUUID();
      db.prepare(
        `INSERT INTO competition_team_members (id, team_id, competition_id, github_login, github_user_id, role, status, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, 'member', 'pending_apply', ?, ?)
         ON CONFLICT(team_id, github_login) DO UPDATE SET
           status = 'pending_apply',
           role = 'member',
           updated_at = excluded.updated_at`,
      ).run(memberId, teamId, team.competition_id, applicant.login, applicant.userId, now, now);

      // 确保申请人有该赛事的登记记录
      const existingSignup = getSignupStmt.get(team.competition_id, applicant.login);
      if (!existingSignup || existingSignup.status === "cancelled") {
        const signupKind: SignupKind = comp.kind;
        const signupStatus: SignupStatus = comp.kind === "internal" ? "registered" : "intent";
        insertSignupStmt.run(
          randomUUID(),
          team.competition_id,
          applicant.login,
          applicant.userId,
          signupKind,
          signupStatus,
          "申请入队自动登记",
          "",
          now,
          now,
        );
      }

      return { ok: true, membership_id: memberId };
    },

    inviteToTeam(teamId, leaderLogin, invitee, now) {
      const team = getTeamByIdStmt.get(teamId);
      if (!team || team.status === "disbanded") {
        return { ok: false, error: "team_not_found", message: "队伍不存在或已解散" };
      }

      if (team.leader_login.toLowerCase() !== leaderLogin.toLowerCase()) {
        return { ok: false, error: "not_team_leader", message: "只有队长可以发送邀请" };
      }

      const comp = getCompStmt.get(team.competition_id);
      if (!comp || competitionStatus(comp, now) === "ended") {
        return { ok: false, error: "competition_ended", message: "比赛已结束" };
      }

      const confirmedCount = countConfirmedMembersStmt.get(teamId)!.count;
      if (confirmedCount >= team.max_members) {
        return { ok: false, error: "team_full", message: "队伍人数已达上限" };
      }

      const inConfirmedTeam = findUserConfirmedTeamStmt.get(team.competition_id, invitee.login);
      if (inConfirmedTeam) {
        return { ok: false, error: "already_in_team", message: "该用户已在其他队伍中确认参赛" };
      }

      const existing = getMembershipByTeamAndUserStmt.get(teamId, invitee.login);
      if (existing) {
        if (existing.status === "confirmed") {
          return { ok: false, error: "already_in_team", message: "该用户已在队伍中" };
        }
        if (existing.status === "pending_invite") {
          return { ok: false, error: "already_invited", message: "已发送过邀请，等待对方确认" };
        }
        if (existing.status === "pending_apply") {
          // 对方先前已申请，队长主动邀请 -> 双方确认，直接成为 confirmed
          db.prepare(
            "UPDATE competition_team_members SET status = 'confirmed', updated_at = ? WHERE id = ?",
          ).run(now, existing.id);
          return { ok: true, membership_id: existing.id };
        }
      }

      const memberId = randomUUID();
      db.prepare(
        `INSERT INTO competition_team_members (id, team_id, competition_id, github_login, github_user_id, role, status, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, 'member', 'pending_invite', ?, ?)
         ON CONFLICT(team_id, github_login) DO UPDATE SET
           status = 'pending_invite',
           role = 'member',
           updated_at = excluded.updated_at`,
      ).run(memberId, teamId, team.competition_id, invitee.login, invitee.userId ?? null, now, now);

      return { ok: true, membership_id: memberId };
    },

    respondToMembership(membershipId, actorLogin, action, now) {
      const membership = getMembershipByIdStmt.get(membershipId);
      if (!membership) {
        return { ok: false, error: "membership_not_found", message: "申请或邀请记录不存在" };
      }

      const team = getTeamByIdStmt.get(membership.team_id);
      if (!team || team.status === "disbanded") {
        return { ok: false, error: "team_disbanded", message: "队伍已解散" };
      }

      // 权限核对：
      // 如果是 pending_invite，只有被邀请人自己（github_login）可以确认/拒绝
      if (membership.status === "pending_invite") {
        if (membership.github_login.toLowerCase() !== actorLogin.toLowerCase()) {
          return { ok: false, error: "forbidden", message: "只有被邀请人可以处理该邀请" };
        }
      } else if (membership.status === "pending_apply") {
        // 如果是 pending_apply，只有队长可以确认/拒绝
        if (team.leader_login.toLowerCase() !== actorLogin.toLowerCase()) {
          return { ok: false, error: "forbidden", message: "只有队长可以审批入队申请" };
        }
      } else {
        return { ok: false, error: "invalid_state", message: "该申请或邀请已处于非等待状态" };
      }

      if (action === "reject") {
        db.prepare(
          "UPDATE competition_team_members SET status = 'rejected', updated_at = ? WHERE id = ?",
        ).run(now, membershipId);
        return { ok: true, status: "rejected" };
      }

      // 接收确认：核对满员与是否已在其他队
      const confirmedCount = countConfirmedMembersStmt.get(team.id)!.count;
      if (confirmedCount >= team.max_members) {
        return { ok: false, error: "team_full", message: "队伍人数已达上限，无法确认加入" };
      }

      const alreadyInTeam = findUserConfirmedTeamStmt.get(membership.competition_id, membership.github_login);
      if (alreadyInTeam && alreadyInTeam.id !== team.id) {
        return { ok: false, error: "already_in_team", message: "该成员已在其他队伍中确认参赛" };
      }

      const tx = db.transaction(() => {
        db.prepare(
          "UPDATE competition_team_members SET status = 'confirmed', updated_at = ? WHERE id = ?",
        ).run(now, membershipId);

        // 如果加上这名成员刚好满员，更新队伍状态为 confirmed
        if (confirmedCount + 1 >= team.max_members) {
          db.prepare("UPDATE competition_teams SET status = 'confirmed', updated_at = ? WHERE id = ?").run(now, team.id);
        }

        // 自动拒绝该用户在该比赛其他队伍的待处理邀请或申请，避免双向悬空
        db.prepare(
          `UPDATE competition_team_members SET status = 'rejected', updated_at = ?
           WHERE competition_id = ? AND github_login = ? AND id != ? AND status IN ('pending_invite', 'pending_apply')`,
        ).run(now, membership.competition_id, membership.github_login, membershipId);
      });
      tx();

      return { ok: true, status: "confirmed" };
    },

    leaveTeam(teamId, actorLogin, now) {
      const team = getTeamByIdStmt.get(teamId);
      if (!team || team.status === "disbanded") {
        return { ok: false, error: "team_not_found", message: "队伍不存在或已解散" };
      }

      const isLeader = team.leader_login.toLowerCase() === actorLogin.toLowerCase();
      if (isLeader) {
        // 队长退队直接解散队伍
        const tx = db.transaction(() => {
          db.prepare(
            "UPDATE competition_teams SET status = 'disbanded', updated_at = ? WHERE id = ?",
          ).run(now, teamId);
          db.prepare(
            "DELETE FROM competition_team_members WHERE team_id = ?",
          ).run(teamId);
        });
        tx();
        return { ok: true, action: "disbanded" };
      }

      // 普通队员退队
      const member = getMembershipByTeamAndUserStmt.get(teamId, actorLogin);
      if (!member || member.status !== "confirmed") {
        return { ok: false, error: "not_in_team", message: "您不是该队伍的正式成员" };
      }

      const tx = db.transaction(() => {
        db.prepare("DELETE FROM competition_team_members WHERE id = ?").run(member.id);
        if (team.status === "confirmed") {
          db.prepare("UPDATE competition_teams SET status = 'recruiting', updated_at = ? WHERE id = ?").run(now, teamId);
        }
      });
      tx();

      return { ok: true, action: "left" };
    },

    getMyStatus(competitionId, login) {
      const signup = getSignupStmt.get(competitionId, login) ?? null;
      const confirmedTeamRecord = findUserConfirmedTeamStmt.get(competitionId, login);
      const confirmed_team = confirmedTeamRecord ? getFullTeam(confirmedTeamRecord.id) : null;

      const pending_invites = (db.prepare<[string, string], TeamMemberRecord & TeamRecord>(
        `SELECT m.id AS membership_id, t.* FROM competition_team_members m
         JOIN competition_teams t ON m.team_id = t.id
         WHERE m.competition_id = ? AND m.github_login = ? AND m.status = 'pending_invite' AND t.status != 'disbanded'`,
      ).all(competitionId, login) as unknown as { membership_id: string; id: string; competition_id: string; name: string; leader_login: string; leader_user_id: number | null; status: TeamStatus; max_members: number; slogan: string; created_at: number; updated_at: number }[]).map(row => ({
        membership_id: row.membership_id,
        team: {
          id: row.id,
          competition_id: row.competition_id,
          name: row.name,
          leader_login: row.leader_login,
          leader_user_id: row.leader_user_id,
          status: row.status,
          max_members: row.max_members,
          slogan: row.slogan,
          created_at: row.created_at,
          updated_at: row.updated_at,
        },
      }));

      const pending_applications = (db.prepare<[string, string], TeamMemberRecord & TeamRecord>(
        `SELECT m.id AS membership_id, t.* FROM competition_team_members m
         JOIN competition_teams t ON m.team_id = t.id
         WHERE m.competition_id = ? AND m.github_login = ? AND m.status = 'pending_apply' AND t.status != 'disbanded'`,
      ).all(competitionId, login) as unknown as { membership_id: string; id: string; competition_id: string; name: string; leader_login: string; leader_user_id: number | null; status: TeamStatus; max_members: number; slogan: string; created_at: number; updated_at: number }[]).map(row => ({
        membership_id: row.membership_id,
        team: {
          id: row.id,
          competition_id: row.competition_id,
          name: row.name,
          leader_login: row.leader_login,
          leader_user_id: row.leader_user_id,
          status: row.status,
          max_members: row.max_members,
          slogan: row.slogan,
          created_at: row.created_at,
          updated_at: row.updated_at,
        },
      }));

      return {
        signup,
        confirmed_team,
        pending_invites,
        pending_applications,
      };
    },

    listTeams(competitionId) {
      const teams = db.prepare<[string], TeamRecord>(
        "SELECT * FROM competition_teams WHERE competition_id = ? AND status != 'disbanded' ORDER BY created_at DESC",
      ).all(competitionId);
      return teams.map(t => getFullTeam(t.id)!);
    },

    getRoster(competitionId) {
      const comp = getCompStmt.get(competitionId);
      if (!comp) return null;

      const signups = db.prepare<[string], SignupRecord>(
        "SELECT * FROM competition_signups WHERE competition_id = ? AND status != 'cancelled' ORDER BY created_at ASC",
      ).all(competitionId);

      const teams = db.prepare<[string], TeamRecord>(
        "SELECT * FROM competition_teams WHERE competition_id = ? AND status != 'disbanded' ORDER BY created_at ASC",
      ).all(competitionId).map(t => getFullTeam(t.id)!);

      // 去重统计已确认参赛人员：
      // 在内部赛中，所有 status == 'registered' 的成员都是正式报名；
      // 在团队赛中，所有 confirmed_team 成员也是确认参赛；两者合并去重
      const confirmedUserSet = new Set<string>();
      if (comp.kind === "internal") {
        for (const s of signups) {
          if (s.status === "registered") confirmedUserSet.add(s.github_login.toLowerCase());
        }
      }
      for (const t of teams) {
        for (const m of t.members) {
          if (m.status === "confirmed") confirmedUserSet.add(m.github_login.toLowerCase());
        }
      }

      // 未成队人员：登记了意向/报名，但尚未在任何 confirmed 队伍中的人员
      const teamConfirmedLogins = new Set<string>();
      for (const t of teams) {
        for (const m of t.members) {
          if (m.status === "confirmed") teamConfirmedLogins.add(m.github_login.toLowerCase());
        }
      }
      const unassigned_logins = signups
        .filter(s => !teamConfirmedLogins.has(s.github_login.toLowerCase()))
        .map(s => s.github_login);

      const summary: RosterSummary = {
        total_signups: signups.length,
        internal_registered: signups.filter(s => s.kind === "internal" && s.status === "registered").length,
        external_intents: signups.filter(s => s.kind === "external" && s.status === "intent").length,
        teams_count: teams.length,
        confirmed_participants: confirmedUserSet.size,
        unassigned_count: unassigned_logins.length,
      };

      return {
        competition_id: competitionId,
        summary,
        signups,
        teams,
        unassigned_logins,
      };
    },

    exportRosterCsv(competitionId, compName) {
      const roster = this.getRoster(competitionId);
      if (!roster) return null;

      // 生成带 UTF-8 BOM 的 CSV 文本
      const headers = [
        "序号", "GitHub 账号", "登记类型", "状态", "队伍", "队内角色", "联系方式", "参赛备注", "登记时间",
      ];

      // 建立 user -> team / role 索引
      const userTeamMap = new Map<string, { teamName: string; role: string }>();
      for (const t of roster.teams) {
        for (const m of t.members) {
          if (m.status === "confirmed") {
            userTeamMap.set(m.github_login.toLowerCase(), {
              teamName: t.name,
              role: m.role === "leader" ? "队长" : "队员",
            });
          }
        }
      }

      const rows: string[][] = [];
      let index = 1;
      for (const s of roster.signups) {
        const teamInfo = userTeamMap.get(s.github_login.toLowerCase());
        rows.push([
          String(index++),
          s.github_login,
          s.kind === "internal" ? "内部赛正式报名" : "外部赛意向",
          s.status === "registered" ? "已报名" : s.status === "intent" ? "意向登记" : "已取消",
          teamInfo?.teamName ?? "（个人未成队）",
          teamInfo?.role ?? "—",
          s.contact || "—",
          s.note || "—",
          beijingDateTime(s.created_at),
        ]);
      }

      const csvLines = [
        headers.map(csvCell).join(","),
        ...rows.map(row => row.map(csvCell).join(",")),
      ];

      // 返回 UTF-8 BOM 加上 CSV 内容
      return "﻿" + csvLines.join("\r\n");
    },
  };
}

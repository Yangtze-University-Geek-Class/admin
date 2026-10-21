// 比赛积分账本与天梯（#239 第二部分）：组织者登记 Issue / PR / 扣分，天梯按报名与队伍现算。
//
// 规则与报名组队一样只在服务端：只接普通参数与 `now`；一条记录只改状态（active / revoked），撤销留痕。
// 个人榜包含本场全部 active 报名者（0 分也列），队伍分 = 当前在队成员个人分之和；人数与成员来自报名存储。
import { randomUUID } from "node:crypto";
import type Database from "better-sqlite3";
import type { CompetitionStore } from "./competition-store.js";
import type { CompetitionSignupStore, Person } from "./competition-signup-store.js";

export type ScoreKind = "issue" | "pr" | "penalty";
/** `created_by_login` 取登记人账号当前绑定的 GitHub 登录名，不存快照。 */
export type ScoreEvent = {
  id: string;
  competition_id: string;
  person: Person;
  kind: ScoreKind;
  repo: string | null;
  number: number | null;
  points: number;
  reason: string;
  status: "active" | "revoked";
  created_by_login: string;
  created_at: number;
  revoked_at: number | null;
  revoke_reason: string | null;
};
export type LeaderboardIndividual = {
  rank: number;
  person: Person;
  team: { id: string; name: string } | null;
  points: number;
  issues: number;
  prs: number;
  penalties: number;
};
export type LeaderboardTeam = {
  rank: number;
  team: { id: string; name: string; status: "recruiting" | "locked" };
  points: number;
  member_count: number;
};
export type Leaderboard = { updated_at: number; individuals: LeaderboardIndividual[]; teams: LeaderboardTeam[] };

export type ScoreErrorCode =
  | "not_found" | "scoring_not_enabled" | "not_signed_up"
  | "bad_repo" | "bad_number" | "bad_points" | "duplicate_score_event" | "already_revoked";
export const SCORE_ERRORS: Record<ScoreErrorCode, { status: number; message: string }> = {
  not_found: { status: 404, message: "比赛或积分记录不存在" },
  scoring_not_enabled: { status: 409, message: "这场比赛没有开启积分" },
  not_signed_up: { status: 409, message: "这位成员没有报名这场比赛" },
  bad_repo: { status: 400, message: "请填写 owner/name 形式的仓库" },
  bad_number: { status: 400, message: "Issue 或 PR 编号必须是正整数" },
  bad_points: { status: 400, message: "分值超出这种记录的允许范围" },
  duplicate_score_event: { status: 409, message: "同一条 Issue 或 PR 已经记过分" },
  already_revoked: { status: 409, message: "这条积分已经撤销过了" },
};
export type ScoreFailure = { ok: false; error: ScoreErrorCode };
export type ScoreResult<T> = { ok: true; value: T } | ScoreFailure;
const failure = (error: ScoreErrorCode): ScoreFailure => ({ ok: false, error });

/** Issue 与 PR 的分值范围；扣分固定 -50（表上另有 CHECK 兜底）。 */
export const SCORE_POINTS: Record<ScoreKind, { min: number; max: number }> = {
  issue: { min: 5, max: 30 },
  pr: { min: 15, max: 100 },
  penalty: { min: -50, max: -50 },
};
export const REPO_PATTERN = /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/;

export type ScoreEventInput = { account_id: string; kind: ScoreKind; repo?: string | null; number?: number | null; points: number; reason?: string };

type EventRow = {
  id: string; competition_id: string; account_id: string; kind: string; repo: string | null; number: number | null;
  points: number; reason: string; status: string; created_by: string; created_at: number;
  revoked_by: string | null; revoked_at: number | null; revoke_reason: string | null;
};
type TotalsRow = { account_id: string; kind: string; points: number; status: string };

export interface CompetitionScoreStore {
  list(competitionId: string): ScoreResult<ScoreEvent[]>;
  add(competitionId: string, actorAccountId: string, input: ScoreEventInput, now: number): ScoreResult<ScoreEvent>;
  revoke(competitionId: string, actorAccountId: string, eventId: string, reason: string, now: number): ScoreResult<ScoreEvent>;
  leaderboard(competitionId: string): ScoreResult<Leaderboard>;
}

export function createCompetitionScoreStore(
  db: Database.Database,
  competitions: Pick<CompetitionStore, "get">,
  signups: CompetitionSignupStore,
): CompetitionScoreStore {
  const selectEvents = db.prepare("SELECT * FROM competition_score_events WHERE competition_id = ? ORDER BY created_at DESC, rowid DESC");
  const selectEvent = db.prepare("SELECT * FROM competition_score_events WHERE competition_id = ? AND id = ?");
  const selectDuplicate = db.prepare(`SELECT id FROM competition_score_events
    WHERE competition_id = ? AND kind = ? AND repo = ? AND number = ? AND status = 'active'`);
  const insertEvent = db.prepare(`INSERT INTO competition_score_events(id, competition_id, account_id, kind, repo, number, points, reason, status, created_by, created_at)
    VALUES(@id, @competition_id, @account_id, @kind, @repo, @number, @points, @reason, 'active', @created_by, @now)`);
  const revokeEvent = db.prepare("UPDATE competition_score_events SET status = 'revoked', revoked_by = ?, revoked_at = ?, revoke_reason = ? WHERE id = ?");
  const selectTotals = db.prepare("SELECT account_id, kind, points, status FROM competition_score_events WHERE competition_id = ?");
  const selectLatestTouch = db.prepare("SELECT COALESCE(MAX(COALESCE(revoked_at, created_at)), 0) AS n FROM competition_score_events WHERE competition_id = ?");

  const eventView = (row: EventRow): ScoreEvent => ({
    id: row.id,
    competition_id: row.competition_id,
    person: signups.person(row.account_id),
    kind: row.kind as ScoreKind,
    repo: row.repo,
    number: row.number,
    points: row.points,
    reason: row.reason,
    status: row.status === "revoked" ? "revoked" : "active",
    created_by_login: signups.person(row.created_by).login,
    created_at: row.created_at,
    revoked_at: row.revoked_at,
    revoke_reason: row.revoke_reason,
  });

  function list(competitionId: string): ScoreResult<ScoreEvent[]> {
    if (!competitions.get(competitionId)) return failure("not_found");
    return { ok: true, value: (selectEvents.all(competitionId) as EventRow[]).map(eventView) };
  }

  function add(competitionId: string, actorAccountId: string, input: ScoreEventInput, now: number): ScoreResult<ScoreEvent> {
    if (!competitions.get(competitionId)) return failure("not_found");
    if (signups.settingsOf(competitionId).scoring !== "contribution") return failure("scoring_not_enabled");
    if (!signups.activeSignups(competitionId).some(person => person.account_id === input.account_id)) return failure("not_signed_up");
    const range = SCORE_POINTS[input.kind];
    if (input.points < range.min || input.points > range.max) return failure("bad_points");
    const reason = (input.reason ?? "").trim();
    // 只有 Issue 与 PR 带仓库和编号；扣分是一条针对人的记录，不带这两个字段。
    const repo = input.kind === "penalty" ? null : (input.repo ?? "").trim();
    const number = input.kind === "penalty" ? null : input.number ?? null;
    if (input.kind !== "penalty") {
      if (!repo || !REPO_PATTERN.test(repo)) return failure("bad_repo");
      if (!number || !Number.isInteger(number) || number < 1) return failure("bad_number");
    }
    if (selectDuplicate.get(competitionId, input.kind, repo, number)) return failure("duplicate_score_event");
    const id = randomUUID();
    insertEvent.run({
      id, competition_id: competitionId, account_id: input.account_id, kind: input.kind,
      repo, number, points: input.points, reason, created_by: actorAccountId, now,
    });
    return { ok: true, value: eventView(selectEvent.get(competitionId, id) as EventRow) };
  }

  function revoke(competitionId: string, actorAccountId: string, eventId: string, reason: string, now: number): ScoreResult<ScoreEvent> {
    const row = selectEvent.get(competitionId, eventId) as EventRow | undefined;
    if (!row) return failure("not_found");
    if (row.status === "revoked") return failure("already_revoked");
    revokeEvent.run(actorAccountId, now, reason.trim(), eventId);
    return { ok: true, value: eventView(selectEvent.get(competitionId, eventId) as EventRow) };
  }

  /** 天梯：同分按最早报名，并列同名次（1,1,3）；队伍分 = 当前在队成员的个人分之和。 */
  function leaderboard(competitionId: string): ScoreResult<Leaderboard> {
    const record = competitions.get(competitionId);
    if (!record || record.offline) return failure("not_found");
    if (signups.settingsOf(competitionId).scoring !== "contribution") return failure("scoring_not_enabled");
    const totals = new Map<string, { points: number; issues: number; prs: number; penalties: number }>();
    for (const row of selectTotals.all(competitionId) as TotalsRow[]) {
      if (row.status !== "active") continue;
      const entry = totals.get(row.account_id) ?? { points: 0, issues: 0, prs: 0, penalties: 0 };
      entry.points += row.points;
      if (row.kind === "issue") entry.issues += 1;
      else if (row.kind === "pr") entry.prs += 1;
      else entry.penalties += 1;
      totals.set(row.account_id, entry);
    }
    const teamsResult = signups.teams(competitionId);
    const teamViews = teamsResult.ok ? teamsResult.value : [];
    const teamOf = new Map<string, { id: string; name: string; status: "recruiting" | "locked" }>();
    for (const team of teamViews) {
      for (const member of team.members) teamOf.set(member.account_id, { id: team.id, name: team.name, status: team.status });
    }
    const rows = signups.activeSignups(competitionId).map(person => {
      const total = totals.get(person.account_id) ?? { points: 0, issues: 0, prs: 0, penalties: 0 };
      const team = teamOf.get(person.account_id);
      return {
        rank: 0, person,
        team: team ? { id: team.id, name: team.name } : null,
        points: total.points, issues: total.issues, prs: total.prs, penalties: total.penalties,
        signed_up_at: person.created_at,
      };
    });
    rows.sort((a, b) => b.points - a.points || a.signed_up_at - b.signed_up_at
      || (a.person.account_id < b.person.account_id ? -1 : 1));
    let lastPoints: number | null = null;
    let lastRank = 0;
    const individuals: LeaderboardIndividual[] = rows.map(({ signed_up_at: _signedUpAt, ...row }, index) => {
      if (row.points !== lastPoints) {
        lastRank = index + 1;
        lastPoints = row.points;
      }
      return { ...row, rank: lastRank };
    });

    const teamRows = teamViews.map(team => ({
      rank: 0,
      team: { id: team.id, name: team.name, status: team.status },
      points: team.members.reduce((sum, member) => sum + (totals.get(member.account_id)?.points ?? 0), 0),
      member_count: team.member_count,
      created_at: team.created_at,
    }));
    teamRows.sort((a, b) => b.points - a.points || a.created_at - b.created_at || (a.team.id < b.team.id ? -1 : 1));
    lastPoints = null;
    lastRank = 0;
    const teams: LeaderboardTeam[] = teamRows.map(({ created_at: _createdAt, ...row }, index) => {
      if (row.points !== lastPoints) {
        lastRank = index + 1;
        lastPoints = row.points;
      }
      return { ...row, rank: lastRank };
    });

    return {
      ok: true,
      value: {
        updated_at: (selectLatestTouch.get(competitionId) as { n: number }).n,
        individuals,
        teams,
      },
    };
  }

  return { list, add, revoke, leaderboard };
}

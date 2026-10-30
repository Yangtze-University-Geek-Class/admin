// 比赛的公开读模型（#278，CONTRACT-278 §2）：官网 SDK 与匿名访客读的天梯、贡献动态、统计和整份快照。
//
// 只给公开字段：昵称、@用户名、头像、队名、分数、贡献标题与链接、时间。不给邮箱、account_id、真实姓名、IP，
// 扣分不给原因。人的展示资料取统一资料 account_profiles（用户名、显示名、头像），没上传头像时用 GitHub 头像。
// 定榜之后个人名次换成定榜快照里的严格名次（和发奖用的一致），定榜前同分并列（1,1,3）。
import { createHash } from "node:crypto";
import type Database from "better-sqlite3";
import { toPublicCompetition, type CompetitionRecord, type CompetitionStore } from "./competition-store.js";
import type { CompetitionSignupStore } from "./competition-signup-store.js";
import type { CompetitionScoreStore } from "./competition-score-store.js";
import { GRADE_KEYS, GRADE_KEY_LABELS, type CompetitionRulesStore, type PrizeTier } from "./competition-rules-store.js";
import { isCore, isImportance, scoringView, type Core, type Importance } from "./competition-rubric.js";
import type { CompetitionSiteStore } from "./competition-site-store.js";

export type PublicPerson = { username: string; display_name: string; avatar_url: string | null };
export type PublicLeaderboard = {
  updated_at: number;
  individuals: (PublicPerson & { rank: number; team_name: string | null; score: number })[];
  teams: { rank: number; name: string; members: PublicPerson[]; score: number }[];
};
export type PublicFeedItem = PublicPerson & {
  id: string; at: number; kind: "pr" | "issue" | "penalty"; title: string | null; url: string | null; points: number;
  importance: Importance | null; core: Core | null;
};
export type PublicFeed = { items: PublicFeedItem[]; next_cursor: string | null };
export type PublicStats = { participants: number; teams: number; merged_prs: number; accepted_issues: number; total_points: number; updated_at: number };
export type PublicGradeFactor = { grade: string; label: string; factor: number };
/** 部门身份摘要（与 `permissions.accountGroupsView().department` 同一份口径）：没分配部门为 null。 */
export type PublicDepartment = { id: string; name: string; tone: string | null } | null;
export type PublicParticipant = PublicPerson & { department: PublicDepartment };
export type PublicParticipants = { items: PublicParticipant[]; next_cursor: string | null };
export type PublicTeamEntry = { name: string; slogan: string; status: "recruiting" | "locked"; member_count: number; members: PublicPerson[] };
/** 队伍（#278 站点包的「队伍」接口）：个人赛 `enabled` 为 false、`teams` 为空，站点据此跳过这一段，不报错。 */
export type PublicTeams = { enabled: boolean; team_min: number; team_max: number; teams: PublicTeamEntry[] };

export const PARTICIPANTS_PAGE_SIZE = 100;
export const PARTICIPANTS_PAGE_MAX = 200;

export const FEED_PAGE_SIZE = 20;
export const FEED_PAGE_MAX = 50;
/** 公开接口的服务端缓存：天梯「几秒到十几秒」内更新（所有者 2026-10-24），写入时按比赛主动清掉。 */
export const PUBLIC_CACHE_TTL_MS = 10_000;
export const publicCacheKey = (competitionId: string, part: string) => `competition-public:${competitionId}:${part}`;
export const publicCachePrefix = (competitionId: string) => `competition-public:${competitionId}:`;

/** 门户比赛窗口里这场比赛的深链（`?open=competitions&competition=<id>`，YugcOs 打开窗口、CompetitionsApp 选中这场）。 */
export const competitionAppUrl = (competitionId: string) => `/?open=competitions&competition=${encodeURIComponent(competitionId)}`;

type ProfileRow = { username: string | null; display_name: string };
type FeedRow = {
  id: string; account_id: string; kind: string; points: number; weighted_points: number | null; created_at: number;
  importance: string | null; core: string | null; title: string | null; url: string | null;
};

const encodeCursor = (at: number, id: string) => Buffer.from(`${at}:${id}`, "utf8").toString("base64url");
function decodeCursor(cursor: string): { at: number; id: string } | null {
  const text = Buffer.from(cursor, "base64url").toString("utf8");
  const match = /^([0-9]{1,15}):([0-9a-f-]{36})$/.exec(text);
  return match ? { at: Number(match[1]), id: match[2] } : null;
}
/** 人员游标只含本场比赛隔离的单向摘要，不能把内部 account_id 编成 base64 下发。 */
function decodeParticipantCursor(cursor: string): { at: number; id: string } | null {
  const text = Buffer.from(cursor, "base64url").toString("utf8");
  const match = /^([0-9]{1,15}):([0-9a-f]{64})$/.exec(text);
  return match ? { at: Number(match[1]), id: match[2] } : null;
}

export function createCompetitionPublic(db: Database.Database, deps: {
  competitions: Pick<CompetitionStore, "get">;
  signups: Pick<CompetitionSignupStore, "settingsOf" | "person" | "activeSignups" | "teams">;
  scores: Pick<CompetitionScoreStore, "leaderboard">;
  rules: Pick<CompetitionRulesStore, "get">;
  sites: Pick<CompetitionSiteStore, "site">;
}) {
  const selectProfile = db.prepare("SELECT username, display_name FROM account_profiles WHERE account_id = ?");
  const selectFinal = db.prepare("SELECT finalized_at, standings FROM competition_finals WHERE competition_id = ?");
  const selectFeedFirst = db.prepare(`SELECT e.id, e.account_id, e.kind, e.points, e.weighted_points, e.created_at, e.importance, e.core, c.title, c.url
    FROM competition_score_events e LEFT JOIN competition_score_candidates c ON c.score_event_id = e.id
    WHERE e.competition_id = ? AND e.status = 'active' ORDER BY e.created_at DESC, e.id DESC LIMIT ?`);
  const selectFeedAfter = db.prepare(`SELECT e.id, e.account_id, e.kind, e.points, e.weighted_points, e.created_at, e.importance, e.core, c.title, c.url
    FROM competition_score_events e LEFT JOIN competition_score_candidates c ON c.score_event_id = e.id
    WHERE e.competition_id = ? AND e.status = 'active' AND (e.created_at < ? OR (e.created_at = ? AND e.id < ?))
    ORDER BY e.created_at DESC, e.id DESC LIMIT ?`);
  const selectCounts = db.prepare(`SELECT
      SUM(CASE WHEN kind = 'pr' THEN 1 ELSE 0 END) AS prs,
      SUM(CASE WHEN kind = 'issue' THEN 1 ELSE 0 END) AS issues,
      COALESCE(SUM(COALESCE(weighted_points, points)), 0) AS total
    FROM competition_score_events WHERE competition_id = ? AND status = 'active'`);

  /**
   * 一批账号各自的部门（与 `permissions.accountGroupsView().department` 同一份口径：只看直接成员资格、
   * 同一账号最多一个部门组）。批量查，避免「人员」接口对每一行都单独查一次库。没有部门组的账号不在
   * 返回的 Map 里，调用方按 `get(id) ?? null` 取。
   */
  function departmentsOf(accountIds: string[], now: number): Map<string, PublicDepartment> {
    const map = new Map<string, PublicDepartment>();
    if (accountIds.length === 0) return map;
    const placeholders = accountIds.map(() => "?").join(", ");
    const rows = db.prepare(`SELECT m.account_id AS account_id, g.id AS id, g.name AS name, g.tone AS tone
      FROM perm_members m JOIN perm_groups g ON g.id = m.group_id
      WHERE g.kind = 'department' AND m.account_id IN (${placeholders}) AND (m.expires_at IS NULL OR m.expires_at > ?)`)
      .all(...accountIds, now) as { account_id: string; id: string; name: string; tone: string | null }[];
    for (const row of rows) map.set(row.account_id, { id: row.id, name: row.name, tone: row.tone });
    return map;
  }

  /** 一个人的公开资料；头像是 signups.person 给的统一头像（lib/avatars.ts，#343：上传的、GitHub 的、NANO 默认头像）。 */
  function personOf(accountId: string): PublicPerson {
    const row = selectProfile.get(accountId) as ProfileRow | undefined;
    const fallback = deps.signups.person(accountId);
    const username = row?.username || fallback.login || "member";
    return {
      username,
      display_name: row?.display_name?.trim() || username,
      avatar_url: fallback.avatar_url,
    };
  }

  /** 门户与官网能看到的比赛：存在且没下线。 */
  function visible(competitionId: string): CompetitionRecord | null {
    const record = deps.competitions.get(competitionId);
    return record && !record.offline ? record : null;
  }

  function finalOf(competitionId: string): { finalized_at: number; ranks: Map<string, number> } | null {
    const row = selectFinal.get(competitionId) as { finalized_at: number; standings: string } | undefined;
    if (!row) return null;
    const ranks = new Map<string, number>();
    try {
      for (const item of JSON.parse(row.standings) as { account_id: string; rank: number }[]) ranks.set(item.account_id, item.rank);
    } catch { /* 快照读不出来时按并列名次显示 */ }
    return { finalized_at: row.finalized_at, ranks };
  }

  const gradeFactors = (competitionId: string): PublicGradeFactor[] => {
    const factors = deps.rules.get(competitionId).grade_factors;
    return GRADE_KEYS.map(key => ({ grade: key, label: GRADE_KEY_LABELS[key], factor: factors[key] / 100 }));
  };

  /** 公开比赛对象：在 #238 的字段上加官网地址、门户深链、奖项、年级系数、两档计分表与定榜时间。 */
  function competition(record: CompetitionRecord, now: number) {
    const site = deps.sites.site(record.id);
    const prizes: PrizeTier[] = deps.rules.get(record.id).prizes;
    return {
      ...toPublicCompetition(record, now),
      signup: deps.signups.settingsOf(record.id),
      site_url: record.kind === "internal" && site?.live_version_id ? `/c/${site.slug}/` : null,
      app_url: competitionAppUrl(record.id),
      prizes,
      grade_factors: gradeFactors(record.id),
      scoring: scoringView(),
      finalized_at: finalOf(record.id)?.finalized_at ?? null,
    };
  }

  function leaderboard(competitionId: string): PublicLeaderboard | null {
    if (!visible(competitionId)) return null;
    const result = deps.scores.leaderboard(competitionId);
    if (!result.ok) return { updated_at: 0, individuals: [], teams: [] };
    const final = finalOf(competitionId);
    const individuals = result.value.individuals.map(row => ({
      rank: final?.ranks.get(row.person.account_id) ?? row.rank,
      ...personOf(row.person.account_id),
      team_name: row.team?.name ?? null,
      score: row.points,
    }));
    if (final) individuals.sort((a, b) => a.rank - b.rank);
    const teamsResult = deps.signups.teams(competitionId);
    const members = new Map<string, PublicPerson[]>();
    if (teamsResult.ok) for (const team of teamsResult.value) members.set(team.id, team.members.map(member => personOf(member.account_id)));
    return {
      updated_at: result.value.updated_at,
      individuals,
      teams: result.value.teams.map(row => ({ rank: row.rank, name: row.team.name, members: members.get(row.team.id) ?? [], score: row.points })),
    };
  }

  /** 贡献动态：有效的积分记录，新的在前；`cursor` 不合法时当第一页。 */
  function feed(competitionId: string, cursor: string | null, limit = FEED_PAGE_SIZE): PublicFeed | null {
    if (!visible(competitionId)) return null;
    const size = Math.min(Math.max(1, limit), FEED_PAGE_MAX);
    const after = cursor ? decodeCursor(cursor) : null;
    const rows = (after
      ? selectFeedAfter.all(competitionId, after.at, after.at, after.id, size + 1)
      : selectFeedFirst.all(competitionId, size + 1)) as FeedRow[];
    const page = rows.slice(0, size);
    const last = page[page.length - 1];
    return {
      items: page.map(row => ({
        id: row.id,
        at: row.created_at,
        ...personOf(row.account_id),
        kind: row.kind === "penalty" ? "penalty" : row.kind === "issue" ? "issue" : "pr",
        title: row.kind === "penalty" ? null : row.title,
        url: row.kind === "penalty" ? null : row.url,
        points: row.weighted_points ?? row.points,
        importance: isImportance(row.importance) ? row.importance : null,
        core: isCore(row.core) ? row.core : null,
      })),
      next_cursor: rows.length > size && last ? encodeCursor(last.created_at, last.id) : null,
    };
  }

  /**
   * 人员（#278 站点包的「人员」接口）：已报名、未取消的全部参赛者，不是只有拿过分的人（和天梯不同）。
   * 按报名时间、比赛内摘要升序分页；一页最多 `PARTICIPANTS_PAGE_MAX` 条。
   */
  function participants(competitionId: string, cursor: string | null, limit = PARTICIPANTS_PAGE_SIZE): PublicParticipants | null {
    if (!visible(competitionId)) return null;
    const size = Math.min(Math.max(1, limit), PARTICIPANTS_PAGE_MAX);
    const all = deps.signups.activeSignups(competitionId).map(row => ({
      ...row, cursor_id: createHash("sha256").update(`${competitionId}:${row.account_id}`).digest("hex"),
    })).sort((a, b) => a.created_at - b.created_at || a.cursor_id.localeCompare(b.cursor_id));
    const after = cursor ? decodeParticipantCursor(cursor) : null;
    const start = after ? all.findIndex(row => row.created_at > after.at || (row.created_at === after.at && row.cursor_id > after.id)) : 0;
    const slice = start < 0 ? [] : all.slice(start, start + size + 1);
    const page = slice.slice(0, size);
    const departments = departmentsOf(page.map(row => row.account_id), Date.now());
    const last = page[page.length - 1];
    return {
      items: page.map(row => ({ ...personOf(row.account_id), department: departments.get(row.account_id) ?? null })),
      next_cursor: slice.length > size && last ? encodeCursor(last.created_at, last.cursor_id) : null,
    };
  }

  /**
   * 队伍（#278 站点包的「队伍」接口）：全部未解散的队伍，不是只有拿过分的队（和天梯不同）。个人赛
   * `enabled` 为 false、`teams` 为空数组——站点包用了这个接口但这场比赛是个人赛时，这样区分，不报错。
   */
  function teams(competitionId: string): PublicTeams | null {
    if (!visible(competitionId)) return null;
    const settings = deps.signups.settingsOf(competitionId);
    if (settings.participation !== "team") return { enabled: false, team_min: settings.team_min, team_max: settings.team_max, teams: [] };
    const result = deps.signups.teams(competitionId);
    const rows = result.ok ? result.value : [];
    return {
      enabled: true, team_min: settings.team_min, team_max: settings.team_max,
      teams: rows.map(team => ({
        name: team.name, slogan: team.slogan, status: team.status, member_count: team.member_count,
        members: team.members.map(member => personOf(member.account_id)),
      })),
    };
  }

  function stats(competitionId: string): PublicStats | null {
    if (!visible(competitionId)) return null;
    const board = deps.scores.leaderboard(competitionId);
    const counts = selectCounts.get(competitionId) as { prs: number | null; issues: number | null; total: number };
    const teamsResult = deps.signups.teams(competitionId);
    return {
      participants: deps.signups.activeSignups(competitionId).length,
      teams: teamsResult.ok ? teamsResult.value.length : 0,
      merged_prs: counts.prs ?? 0,
      accepted_issues: counts.issues ?? 0,
      total_points: counts.total,
      updated_at: board.ok ? board.value.updated_at : 0,
    };
  }

  return { personOf, visible, competition, leaderboard, participants, teams, feed, stats, finalOf };
}
export type CompetitionPublic = ReturnType<typeof createCompetitionPublic>;

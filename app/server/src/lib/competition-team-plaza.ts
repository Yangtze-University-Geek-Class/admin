// 组队广场（#278 重开，所有者 2026-10-24 22:25 要求做一个跨比赛的组队广场，方便用户快速找到心仪的队友）：
// 汇总当前所有「在报名中」的比赛里，还没组队、想找队伍的人（复用 signup 的
// looking_for_team + note）与还在招募、开了广场广播的队伍（competition-signup-store.ts 的 setPlaza/
// withdrawPlaza），按时间倒序合成一张跨比赛的列表。
//
// 只做聚合与筛选，不改任何状态；申请、邀请、开关广播都走各自现有的接口（apply/invite、teams/:id/plaza）。
// 可见性跟着各自比赛的报名设置走：没开放报名、不在报名窗口内的比赛不出现在广场上——判定口径与
// `signupWritable` 一致，不另开一套规则。
import type Database from "better-sqlite3";
import type { CompetitionStore } from "./competition-store.js";
import { parsePlazaSkills, signupWritable, type CompetitionSignupStore, type Person } from "./competition-signup-store.js";

export type PlazaKind = "seeking_team" | "recruiting_team";

/**
 * 两种条目合成一张扁平表（和 `publicFeed` 对 pr/issue/penalty 的处理一样）：`kind` 决定哪些字段有值，
 * 另一种条目用不到的字段为 null，不单独开 oneOf——契约和前端只认一种形状。
 */
export type PlazaEntry = {
  kind: PlazaKind;
  competition_id: string; competition_name: string;
  note: string; since: number;
  person: Person | null; // 仅 seeking_team：想找队伍的人
  team_id: string | null; team_name: string | null; slogan: string | null; // 仅 recruiting_team
  leader: Person | null; member_count: number | null; team_max: number | null; // 仅 recruiting_team
  wanted_skills: string[] | null; // 仅 recruiting_team
};
export type PlazaQuery = { competitionId?: string; kind?: PlazaKind; keyword?: string; cursor?: string | null; limit?: number };
export type PlazaPage = { items: PlazaEntry[]; next_cursor: string | null };

export const PLAZA_PAGE_SIZE = 20;
export const PLAZA_PAGE_MAX = 50;

type SeekingRow = { competition_id: string; account_id: string; note: string; since: number };
type RecruitingRow = {
  id: string; competition_id: string; name: string; slogan: string; leader_account_id: string;
  note: string; skills: string; since: number | null; member_count: number;
};
/** 排序与分页只看这三样：时间倒序，新广播/新报名在前；同一时间按种类、id 兜底，排序稳定。 */
type RankKey = { since: number; kind: PlazaKind; id: string };

function compareDesc(a: RankKey, b: RankKey): number {
  if (a.since !== b.since) return b.since - a.since;
  if (a.kind !== b.kind) return a.kind < b.kind ? -1 : 1;
  return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
}

const encodePlazaCursor = (key: RankKey) => Buffer.from(`${key.since}:${key.kind}:${key.id}`, "utf8").toString("base64url");
function decodePlazaCursor(cursor: string): RankKey | null {
  const text = Buffer.from(cursor, "base64url").toString("utf8");
  const match = /^([0-9]{1,15}):(seeking_team|recruiting_team):([0-9A-Za-z-]{1,36})$/.exec(text);
  return match ? { since: Number(match[1]), kind: match[2] as PlazaKind, id: match[3] } : null;
}

export interface CompetitionTeamPlaza {
  list(query: PlazaQuery, now: number): PlazaPage;
}

export function createCompetitionTeamPlaza(db: Database.Database, deps: {
  competitions: Pick<CompetitionStore, "listPublic">;
  signups: Pick<CompetitionSignupStore, "settingsOf" | "person">;
}): CompetitionTeamPlaza {
  function list(query: PlazaQuery, now: number): PlazaPage {
    const keyword = (query.keyword ?? "").trim().toLowerCase();
    // 「当前在报名中」＝未下线、已开放报名、还在报名窗口内——和各自比赛页面上「能不能报名」的判断完全一致。
    const eligible = deps.competitions.listPublic(now)
      .filter(record => !query.competitionId || record.id === query.competitionId)
      .filter(record => signupWritable(record, deps.signups.settingsOf(record.id), now));
    if (eligible.length === 0) return { items: [], next_cursor: null };
    const names = new Map(eligible.map(record => [record.id, record.name]));
    const ids = eligible.map(record => record.id);
    const placeholders = ids.map(() => "?").join(", ");

    const ranked: { key: RankKey; entry: PlazaEntry }[] = [];

    if (query.kind !== "recruiting_team") {
      // 想找队伍的人：复用报名时勾的 looking_for_team + note，和空闲人员列表同一个排除条件（已在队里的不算）。
      const rows = db.prepare(`SELECT s.competition_id AS competition_id, s.account_id AS account_id, s.note AS note, s.created_at AS since
        FROM competition_signups s
        WHERE s.status = 'active' AND s.looking_for_team = 1 AND s.competition_id IN (${placeholders})
          AND NOT EXISTS (SELECT 1 FROM competition_team_members m
            WHERE m.competition_id = s.competition_id AND m.account_id = s.account_id AND m.status = 'active')`)
        .all(...ids) as SeekingRow[];
      for (const row of rows) {
        if (keyword && !row.note.toLowerCase().includes(keyword)) continue;
        ranked.push({
          key: { since: row.since, kind: "seeking_team", id: row.account_id },
          entry: {
            kind: "seeking_team", competition_id: row.competition_id, competition_name: names.get(row.competition_id) ?? "",
            note: row.note, since: row.since, person: deps.signups.person(row.account_id),
            team_id: null, team_name: null, slogan: null, leader: null, member_count: null, team_max: null, wanted_skills: null,
          },
        });
      }
    }

    if (query.kind !== "seeking_team") {
      // 还在招募的队伍：领队开了广场广播（plaza_recruiting）且还没满员；满没满员这里现算，不信队伍自己开着没关。
      const rows = db.prepare(`SELECT t.id AS id, t.competition_id AS competition_id, t.name AS name, t.slogan AS slogan,
          t.leader_account_id AS leader_account_id, t.plaza_note AS note, t.plaza_skills AS skills, t.plaza_updated_at AS since,
          (SELECT COUNT(*) FROM competition_team_members m WHERE m.team_id = t.id AND m.status = 'active') AS member_count
        FROM competition_teams t
        WHERE t.status = 'recruiting' AND t.plaza_recruiting = 1 AND t.competition_id IN (${placeholders})`)
        .all(...ids) as RecruitingRow[];
      for (const row of rows) {
        const settings = deps.signups.settingsOf(row.competition_id);
        if (row.member_count >= settings.team_max) continue;
        const skills = parsePlazaSkills(row.skills);
        const haystack = keyword ? `${row.note} ${row.name} ${skills.join(" ")}`.toLowerCase() : "";
        if (keyword && !haystack.includes(keyword)) continue;
        ranked.push({
          key: { since: row.since ?? 0, kind: "recruiting_team", id: row.id },
          entry: {
            kind: "recruiting_team", competition_id: row.competition_id, competition_name: names.get(row.competition_id) ?? "",
            note: row.note, since: row.since ?? 0, person: null,
            team_id: row.id, team_name: row.name, slogan: row.slogan, leader: deps.signups.person(row.leader_account_id),
            member_count: row.member_count, team_max: settings.team_max, wanted_skills: skills,
          },
        });
      }
    }

    ranked.sort((a, b) => compareDesc(a.key, b.key));
    const size = Math.min(Math.max(1, query.limit ?? PLAZA_PAGE_SIZE), PLAZA_PAGE_MAX);
    const after = query.cursor ? decodePlazaCursor(query.cursor) : null;
    const start = after ? ranked.findIndex(row => compareDesc(row.key, after) > 0) : 0;
    const slice = start < 0 ? [] : ranked.slice(start, start + size + 1);
    const page = slice.slice(0, size);
    const last = page[page.length - 1];
    return {
      items: page.map(row => row.entry),
      next_cursor: slice.length > size && last ? encodePlazaCursor(last.key) : null,
    };
  }

  return { list };
}
export type CompetitionTeamPlazaStore = ReturnType<typeof createCompetitionTeamPlaza>;

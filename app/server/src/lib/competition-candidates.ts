// GitLab 贡献收集与「有用」标记（#278，CONTRACT-278 §4，所有者 2026-10-24 13:45）。
//
// 后台每 10 分钟（GitLab 同步不是 off 时）把比赛配置的 GitLab 项目里、比赛时间窗内的贡献收成候选：
//   - 已合并的 MR（按合并时间算窗口）；
//   - 带「有用」标签或被 MR 关闭的 Issue（按创建时间算窗口，closed_by）；
//   - 合进任意分支的 MR 正文写了关闭关键字指向的 Issue（按 MR 合并时间算，见 closingIssueIids；Issue 开着关着都收）。
// 作者经 gitlab_accounts 对到极客班账号，且这个账号已报名这场比赛，否则跳过。唯一约束保证重复拉取不产生重复行。
// 分数不看改动行数（所有者 2026-10-24 16:59），只看审核人选的重要程度和核心度（lib/competition-rubric.ts）。
//
// 只有被标记「有用」的候选才加分，两条路：
//   1. GitLab 标签：「有用」加一个 `重要程度::一般|重要|关键`、一个 `核心度::边缘|业务|核心`。这三个标签各自最后一次
//      都是被加上，加的人对得上极客班账号、有 competition.score.review、而且不是作者本人——满足就按两档自动加分
//      （登记人是打「有用」的人）；不满足的留在待确认，note 写原因。待确认的候选记下标签上现在的两档，控制台默认选它。
//   2. 控制台「标记有用」（accept）时选两档，审核人不能是作者本人。
// 加分之后再改两档标签不改分，要改分到控制台驳回后重新标记。
// 标签被拿掉：经标签自动加的分撤销、候选回到待确认；控制台确认的不受影响；定榜之后什么都不再改。
// 只有这个模块读写 competition_score_candidates；加分、撤销写 competition_score_events 走 competition-score-store。
import { randomUUID } from "node:crypto";
import type Database from "better-sqlite3";
import type { AuditActor } from "./db.js";
import type { CompetitionRecord, CompetitionStore } from "./competition-store.js";
import type { CompetitionSignupStore } from "./competition-signup-store.js";
import type { CompetitionScoreStore, ScoreErrorCode } from "./competition-score-store.js";
import type { CompetitionRulesStore } from "./competition-rules-store.js";
import { CORE, CORE_LABELS, IMPORTANCE, IMPORTANCE_LABELS, basePoints, isCore, isImportance, type Core, type Importance } from "./competition-rubric.js";
import type { ActivityOutcome, ActivitySurface } from "./activity.js";

export const USEFUL_LABEL = "有用";
/** 两档评定的 GitLab 标签：`重要程度::一般` 这样，一个前缀只能有一个。 */
export const IMPORTANCE_LABEL_PREFIX = "重要程度::";
export const CORE_LABEL_PREFIX = "核心度::";
const IMPORTANCE_BY_LABEL = new Map(IMPORTANCE.map(key => [`${IMPORTANCE_LABEL_PREFIX}${IMPORTANCE_LABELS[key]}`, key] as const));
const CORE_BY_LABEL = new Map(CORE.map(key => [`${CORE_LABEL_PREFIX}${CORE_LABELS[key]}`, key] as const));
export const COLLECT_INTERVAL_MS = 10 * 60_000;
/** 比赛结束后还继续收集多久（迟到的标签、合并），定榜后停。 */
export const COLLECT_GRACE_MS = 30 * 24 * 3600_000;
/** 一次收集最多发多少个 GitLab 请求；未取全时整轮不应用，避免部分结果误计分。 */
export const COLLECT_REQUEST_BUDGET = 300;
const LIST_PAGES_MAX = 10;
const CANDIDATE_PAGE = 50;

export type CandidateStatus = "pending" | "accepted" | "rejected";
export type CandidateRow = {
  id: string; competition_id: string; account_id: string; kind: "pr" | "issue"; gitlab_project: string; gitlab_iid: number;
  url: string; title: string; importance: Importance | null; core: Core | null; status: CandidateStatus;
  reviewed_by: string | null; reviewed_at: number | null; final_points: number | null; reason: string | null;
  score_event_id: string | null; accepted_via: "label" | "console" | null; note: string | null;
  contributed_at: number; created_at: number; updated_at: number;
};
export type CollectRun = {
  at: number; fetched: number; created: number; skipped: number; accepted: number; revoked: number; error: string | null;
};
export type CandidateError = "not_found" | "candidate_not_found" | "self_review" | "already_accepted" | "already_rejected"
  | "competition_finalized" | "gitlab_sync_off" | ScoreErrorCode;
export const CANDIDATE_ERRORS: Partial<Record<CandidateError, { status: number; message: string }>> = {
  candidate_not_found: { status: 404, message: "这条候选贡献不存在" },
  self_review: { status: 403, message: "不能审核自己的贡献" },
  already_accepted: { status: 409, message: "这条贡献已经标记为有用" },
  already_rejected: { status: 409, message: "这条贡献已经驳回" },
  gitlab_sync_off: { status: 409, message: "GitLab 同步关着或没配好，收集不了贡献" },
};

/** 标签上的两档：每个前缀恰好一个、名字对得上才算；没有或不止一个就是 null。 */
export function levelsFromLabels(labels: string[]): { importance: Importance | null; core: Core | null } {
  const pick = <T>(prefix: string, table: Map<string, T>): T | null => {
    const found = labels.filter(label => label.startsWith(prefix));
    return found.length === 1 ? table.get(found[0]) ?? null : null;
  };
  return { importance: pick(IMPORTANCE_LABEL_PREFIX, IMPORTANCE_BY_LABEL), core: pick(CORE_LABEL_PREFIX, CORE_BY_LABEL) };
}

const REF = String.raw`(?:[\w.-]+(?:\/[\w.-]+)+)?#\d+\b`;
/** GitLab 官方关闭关键字（大小写不计，后面可带冒号），接一个或多个编号，用逗号或 and 连接。 */
const CLOSING_RE = new RegExp(String.raw`\b(?:close[sd]?|closing|fix(?:es|ed)?|fixing|resolve[sd]?|resolving|implement(?:s|ed)?|implementing):?\s+(${REF}(?:\s*(?:,|and)\s*${REF})*)`, "gi");
const REF_RE = /((?:[\w.-]+(?:\/[\w.-]+)+)?)#(\d+)\b/g;
const issueKey = (project: string, iid: number) => `${project}#${iid}`;
/** 正文里关闭本项目 Issue 的编号（去重）。`#n` 与本项目完整路径的 `group/project#n` 算；`Refs`、`Related to` 与其它项目都不算。 */
export function closingIssueIids(description: unknown, project: string): number[] {
  if (typeof description !== "string") return [];
  const iids = new Set<number>();
  for (const match of description.matchAll(CLOSING_RE)) {
    for (const [, path, iid] of match[1].matchAll(REF_RE)) {
      if (path && path.toLowerCase() !== project.toLowerCase()) continue;
      iids.add(Number(iid));
    }
  }
  return [...iids];
}
/** 这条候选的结果还要看标签：待确认等标签自动计分，经标签加的分要等「有用」被拿掉。控制台确认或驳回的，标签改不了结果。 */
const labelsMatter = (row: CandidateRow) => row.status === "pending" || (row.status === "accepted" && row.accepted_via === "label");

type GitlabReader = {
  readonly mode: "off" | "dry-run" | "on";
  readonly url: string | null;
  readApi(path: string): Promise<{ status: number; data: unknown; nextPage: number | null }>;
  accountForGitlabUser(gitlabUserId: number): string | null | Promise<string | null>;
};
type Logger = { info(details: Record<string, unknown>, message: string): void; error(details: Record<string, unknown>, message: string): void; warn(details: Record<string, unknown>, message: string): void };
type GitlabItem = {
  iid?: unknown; title?: unknown; web_url?: unknown; author?: { id?: unknown } | null; labels?: unknown;
  merged_at?: unknown; created_at?: unknown; state?: unknown; merge_requests_count?: unknown; description?: unknown;
};
type LabelEvent = { id?: unknown; action?: unknown; created_at?: unknown; label?: { name?: unknown } | null; user?: { id?: unknown; username?: unknown } | null };

export function createCompetitionCandidates(db: Database.Database, deps: {
  competitions: Pick<CompetitionStore, "get" | "list">;
  signups: Pick<CompetitionSignupStore, "settingsOf" | "activeSignups">;
  scores: Pick<CompetitionScoreStore, "add" | "isFinalized">;
  rules: Pick<CompetitionRulesStore, "get">;
  gitlab: GitlabReader;
  canReview: (accountId: string) => boolean;
  audit: (actor: AuditActor, action: string, target?: string, details?: unknown, ip?: string, opts?: { surface?: ActivitySurface; outcome?: ActivityOutcome }) => void;
  onScoresChanged: (competitionId: string) => void;
  clock?: () => number;
}) {
  const clock = deps.clock ?? Date.now;
  const selectOne = db.prepare("SELECT * FROM competition_score_candidates WHERE competition_id = ? AND id = ?");
  const selectByKey = db.prepare("SELECT * FROM competition_score_candidates WHERE competition_id = ? AND kind = ? AND gitlab_project = ? AND gitlab_iid = ?");
  const insertCandidate = db.prepare(`INSERT OR IGNORE INTO competition_score_candidates(id, competition_id, account_id, kind, gitlab_project, gitlab_iid, url, title,
      status, contributed_at, created_at, updated_at)
    VALUES(@id, @competition_id, @account_id, @kind, @gitlab_project, @gitlab_iid, @url, @title, 'pending', @contributed_at, @now, @now)`);
  const refreshCandidate = db.prepare("UPDATE competition_score_candidates SET title = ?, url = ?, updated_at = ? WHERE id = ? AND (title <> ? OR url <> ?)");
  const setLevels = db.prepare(`UPDATE competition_score_candidates SET importance = @importance, core = @core, updated_at = @now
    WHERE id = @id AND status = 'pending' AND (IFNULL(importance, '') <> IFNULL(@importance, '') OR IFNULL(core, '') <> IFNULL(@core, ''))`);
  const setNote = db.prepare("UPDATE competition_score_candidates SET note = ?, updated_at = ? WHERE id = ? AND IFNULL(note, '') <> IFNULL(?, '')");
  const markAccepted = db.prepare(`UPDATE competition_score_candidates SET status = 'accepted', accepted_via = @via, reviewed_by = @by, reviewed_at = @now,
      importance = @importance, core = @core, final_points = @points, reason = @reason, score_event_id = @event, note = NULL, updated_at = @now WHERE id = @id`);
  const markRejected = db.prepare(`UPDATE competition_score_candidates SET status = 'rejected', accepted_via = NULL, reviewed_by = @by, reviewed_at = @now,
      final_points = NULL, reason = @reason, score_event_id = NULL, note = NULL, updated_at = @now WHERE id = @id`);
  const markPending = db.prepare(`UPDATE competition_score_candidates SET status = 'pending', accepted_via = NULL, reviewed_by = NULL, reviewed_at = NULL,
      final_points = NULL, reason = NULL, score_event_id = NULL, note = @note, updated_at = @now WHERE id = @id`);
  const revokeEvent = db.prepare("UPDATE competition_score_events SET status = 'revoked', revoked_by = ?, revoked_at = ?, revoke_reason = ? WHERE id = ? AND status = 'active'");
  const selectByEvent = db.prepare("SELECT * FROM competition_score_candidates WHERE score_event_id = ?");
  // 作者已经不在名单上（本人取消或控制台移出，#342）的候选不列、不计数；行和已登记的积分都留着，重新报名后照常出现。
  const AUTHOR_SIGNED_UP = `EXISTS (SELECT 1 FROM competition_signups s
    WHERE s.competition_id = c.competition_id AND s.account_id = c.account_id AND s.status = 'active')`;
  const countByStatus = db.prepare(`SELECT c.status AS status, COUNT(*) AS n FROM competition_score_candidates c
    WHERE c.competition_id = ? AND ${AUTHOR_SIGNED_UP} GROUP BY c.status`);
  const pendingAll = db.prepare(`SELECT COUNT(*) AS n FROM competition_score_candidates c
    WHERE c.status = 'pending' AND ${AUTHOR_SIGNED_UP}
      AND NOT EXISTS (SELECT 1 FROM competition_finals f WHERE f.competition_id = c.competition_id)`);

  const lastRuns = new Map<string, CollectRun>();
  const running = new Map<string, Promise<CollectRun>>();
  /** start 时注入的日志；收集中跳过单个编号时写一行原因（和 gitlab-sync 一样，只在定时器开着时有）。 */
  let activeLogger: Logger | null = null;

  function view(row: CandidateRow, personOf: (accountId: string) => { account_id: string; username: string; display_name: string; avatar_url: string | null }) {
    return {
      id: row.id, account: personOf(row.account_id), kind: row.kind, gitlab_project: row.gitlab_project, gitlab_iid: row.gitlab_iid,
      url: row.url, title: row.title, importance: row.importance, core: row.core, status: row.status,
      final_points: row.final_points, reason: row.reason,
      reviewed_by: row.reviewed_by ? personOf(row.reviewed_by) : null, reviewed_at: row.reviewed_at,
      accepted_via: row.accepted_via, note: row.note, contributed_at: row.contributed_at, created_at: row.created_at,
    };
  }

  function list(competitionId: string, status: CandidateStatus | null, cursor: string | null) {
    const params: unknown[] = [competitionId];
    let where = `c.competition_id = ? AND ${AUTHOR_SIGNED_UP}`;
    if (status) { where += " AND c.status = ?"; params.push(status); }
    const after = cursor ? /^([0-9]{1,15})_([0-9a-f-]{36})$/.exec(cursor) : null;
    if (after) { where += " AND (c.created_at < ? OR (c.created_at = ? AND c.id < ?))"; params.push(Number(after[1]), Number(after[1]), after[2]); }
    const rows = db.prepare(`SELECT c.* FROM competition_score_candidates c WHERE ${where} ORDER BY c.created_at DESC, c.id DESC LIMIT ?`)
      .all(...params, CANDIDATE_PAGE + 1) as CandidateRow[];
    const page = rows.slice(0, CANDIDATE_PAGE);
    const last = page[page.length - 1];
    const counts = { pending: 0, accepted: 0, rejected: 0 };
    for (const row of countByStatus.all(competitionId) as { status: CandidateStatus; n: number }[]) counts[row.status] = row.n;
    return { rows: page, next_cursor: rows.length > CANDIDATE_PAGE && last ? `${last.created_at}_${last.id}` : null, counts, last_run: lastRuns.get(competitionId) ?? null };
  }

  const get = (competitionId: string, candidateId: string) => (selectOne.get(competitionId, candidateId) as CandidateRow | undefined) ?? null;

  /** 加分并把候选置为 accepted；防刷按贡献发生的那一周数。调用方在事务里。 */
  function acceptRow(row: CandidateRow, actorAccountId: string, via: "label" | "console", levels: { importance: Importance; core: Core }, reason: string, now: number):
    { ok: true; value: CandidateRow } | { ok: false; error: CandidateError } {
    const created = deps.scores.add(row.competition_id, actorAccountId, {
      account_id: row.account_id, kind: row.kind, repo: row.gitlab_project, number: row.gitlab_iid,
      importance: levels.importance, core: levels.core, reason, contributed_at: row.contributed_at,
    }, now);
    if (!created.ok) return { ok: false, error: created.error };
    markAccepted.run({ id: row.id, via, by: actorAccountId, now, ...levels, points: created.value.points, reason, event: created.value.id });
    return { ok: true, value: get(row.competition_id, row.id)! };
  }

  /** 控制台「标记有用」：审核人选两档（表单默认选标签上记下的两档）；审核人不能是作者。 */
  function accept(competitionId: string, candidateId: string, actorAccountId: string, input: { importance: Importance; core: Core; reason?: string }, now: number):
    { ok: true; value: CandidateRow } | { ok: false; error: CandidateError } {
    if (!deps.competitions.get(competitionId)) return { ok: false, error: "not_found" };
    const row = get(competitionId, candidateId);
    if (!row) return { ok: false, error: "candidate_not_found" };
    if (deps.scores.isFinalized(competitionId)) return { ok: false, error: "competition_finalized" };
    if (row.status === "accepted") return { ok: false, error: "already_accepted" };
    if (row.account_id === actorAccountId) return { ok: false, error: "self_review" };
    const { importance, core } = input;
    if (!isImportance(importance) || !isCore(core)) return { ok: false, error: "bad_levels" };
    const reason = (input.reason ?? "").trim() || `控制台标记有用：${row.kind === "pr" ? "MR" : "Issue"} ${row.gitlab_project}#${row.gitlab_iid}`;
    return acceptRow(row, actorAccountId, "console", { importance, core }, reason.slice(0, 200), now);
  }

  /** 驳回；已经加过分的连同积分记录一起撤销。 */
  function reject(competitionId: string, candidateId: string, actorAccountId: string, reason: string, now: number):
    { ok: true; value: CandidateRow } | { ok: false; error: CandidateError } {
    if (!deps.competitions.get(competitionId)) return { ok: false, error: "not_found" };
    const row = get(competitionId, candidateId);
    if (!row) return { ok: false, error: "candidate_not_found" };
    if (deps.scores.isFinalized(competitionId)) return { ok: false, error: "competition_finalized" };
    if (row.status === "rejected") return { ok: false, error: "already_rejected" };
    if (row.account_id === actorAccountId) return { ok: false, error: "self_review" };
    const text = reason.trim().slice(0, 200);
    if (row.score_event_id) revokeEvent.run(actorAccountId, now, `候选贡献被驳回：${text}`.slice(0, 200), row.score_event_id);
    markRejected.run({ id: row.id, by: actorAccountId, now, reason: text });
    return { ok: true, value: get(competitionId, candidateId)! };
  }

  /** 控制台在积分记录页撤销了一条来自候选的积分：候选跟着变成驳回，免得两边对不上。 */
  function onEventRevoked(eventId: string, actorAccountId: string, reason: string, now: number): void {
    const row = selectByEvent.get(eventId) as CandidateRow | undefined;
    if (row) markRejected.run({ id: row.id, by: actorAccountId, now, reason: reason.trim().slice(0, 200) || "积分记录被撤销" });
  }

  function pendingCount(): number {
    return (pendingAll.get() as { n: number }).n;
  }

  // ── 收集 ──────────────────────────────────────────────────────────

  /** 这场比赛现在要不要收集：内部赛、没下线、开了积分、已开始、没定榜、在结束后的宽限期内、配了项目。 */
  function collectable(record: CompetitionRecord, now: number): boolean {
    return record.kind === "internal" && !record.offline && now >= record.start_at && now <= record.end_at + COLLECT_GRACE_MS
      && deps.signups.settingsOf(record.id).scoring === "contribution" && !deps.scores.isFinalized(record.id)
      && deps.rules.get(record.id).gitlab_projects.length > 0;
  }

  async function runCollect(record: CompetitionRecord): Promise<CollectRun> {
    const now = clock();
    const run: CollectRun = { at: now, fetched: 0, created: 0, skipped: 0, accepted: 0, revoked: 0, error: null };
    let budget = COLLECT_REQUEST_BUDGET;
    const spendBudget = () => {
      if (budget-- <= 0) throw Object.assign(new Error("budget"), { code: "request_budget_exhausted" });
    };
    const read = async (path: string) => {
      spendBudget();
      return deps.gitlab.readApi(path);
    };
    const accounts = new Map<number, Promise<string | null>>();
    const accountFor = (userId: number): Promise<string | null> => {
      const existing = accounts.get(userId);
      if (existing) return existing;
      spendBudget();
      const pending = Promise.resolve(deps.gitlab.accountForGitlabUser(userId));
      accounts.set(userId, pending);
      return pending;
    };
    const readList = async <T>(path: string): Promise<T[]> => {
      const items: T[] = [];
      let page: number | null = 1;
      const seen = new Set<number>();
      for (let count = 0; page !== null && count < LIST_PAGES_MAX; count++) {
        if (seen.has(page)) throw Object.assign(new Error("pagination"), { code: "gitlab_pagination_incomplete" });
        seen.add(page);
        const result = await read(`${path}${path.includes("?") ? "&" : "?"}per_page=100&page=${page}`);
        if (result.status !== 200 || !Array.isArray(result.data)) throw Object.assign(new Error("list"), { code: `gitlab_http_${result.status}` });
        items.push(...(result.data as T[]));
        const next: number | null = result.nextPage ?? (result.data.length === 100 ? page + 1 : null);
        if (next !== null && next !== page + 1) throw Object.assign(new Error("pagination"), { code: "gitlab_pagination_incomplete" });
        page = next;
      }
      if (page !== null) throw Object.assign(new Error("pagination"), { code: "gitlab_pagination_incomplete" });
      return items;
    };
    const projects = [...deps.rules.get(record.id).gitlab_projects];
    const since = new Date(record.start_at).toISOString();
    const until = new Date(record.end_at).toISOString();
    const inWindow = (value: unknown) => {
      const at = typeof value === "string" ? Date.parse(value) : Number.NaN;
      return Number.isFinite(at) && at >= record.start_at && at <= record.end_at ? at : null;
    };
    const urlOf = (value: unknown, project: string, kind: "pr" | "issue", iid: number) => {
      if (typeof value === "string" && /^https?:\/\/[^\s]+$/.test(value)) return value.slice(0, 500);
      return `${deps.gitlab.url ?? ""}/${project}/-/${kind === "pr" ? "merge_requests" : "issues"}/${iid}`;
    };
    const labelsOf = (item: GitlabItem): string[] => {
      if (!Array.isArray(item.labels) || item.labels.some(label => typeof label !== "string")) {
        throw Object.assign(new Error("labels"), { code: "gitlab_data_incomplete" });
      }
      return item.labels;
    };

    type LatestLabel = { action: "add" | "remove"; userId: number | null; username: string | null; accountId: string | null };
    /** 先取全事件，再核验各标签最后操作者的远端 OIDC 身份；坏事件不能被跳过后误判撤销。 */
    async function latestLabelEvents(project: string, kind: "pr" | "issue", iid: number): Promise<Map<string, LatestLabel>> {
      const resource = kind === "pr" ? "merge_requests" : "issues";
      const events = await readList<LabelEvent>(`/projects/${encodeURIComponent(project)}/${resource}/${iid}/resource_label_events`);
      const latest = new Map<string, LabelEvent>();
      for (const event of events) {
        const name = event?.label?.name;
        const userId = event?.user?.id;
        const username = event?.user?.username;
        if (!event || !Number.isSafeInteger(event.id) || Number(event.id) <= 0
          || !Number.isFinite(Date.parse(String(event.created_at ?? "")))
          || typeof name !== "string" || !name || (event.action !== "add" && event.action !== "remove")
          || (userId !== undefined && userId !== null && (!Number.isSafeInteger(userId) || Number(userId) <= 0))
          || (username !== undefined && username !== null && typeof username !== "string")) {
          throw Object.assign(new Error("event"), { code: "gitlab_data_incomplete" });
        }
        const known = latest.get(name);
        const at = Date.parse(String(event.created_at));
        const knownAt = known ? Date.parse(String(known.created_at)) : -Infinity;
        if (!known || at > knownAt || (at === knownAt && Number(event.id) > Number(known.id))) latest.set(name, event);
      }
      const resolved = await Promise.all([...latest].map(async ([name, event]) => {
        const userId = typeof event.user?.id === "number" ? event.user.id : null;
        return [name, {
          action: event.action as "add" | "remove",
          userId,
          username: typeof event.user?.username === "string" ? event.user.username : null,
          accountId: userId === null ? null : await accountFor(userId),
        }] as const;
      }));
      return new Map(resolved);
    }

    type SnapshotEntry = {
      kind: "pr" | "issue";
      project: string;
      iid: number;
      title: string;
      url: string;
      labels: string[];
      contributedAt: number;
      authorAccountId: string;
      events: Map<string, LatestLabel> | null;
    };
    const snapshot: SnapshotEntry[] = [];
    /** MR 正文关闭的 Issue（键为 项目#编号），记最早一次合并的时间；列表里已经按规则进来的不再重复准备。 */
    const closingRefs = new Map<string, { project: string; iid: number; contributedAt: number }>();
    const preparedIssues = new Set<string>();

    const prepare = async (kind: "pr" | "issue", project: string, item: GitlabItem, contributedAt: number) => {
      const iid = Number(item.iid);
      const authorId = item.author?.id;
      const authorAccountId = typeof authorId === "number" && Number.isSafeInteger(authorId) && authorId > 0
        ? await accountFor(authorId) : null;
      if (!authorAccountId) { run.skipped++; return; }
      const labels = labelsOf(item);
      const known = selectByKey.get(record.id, kind, project, iid) as CandidateRow | undefined;
      const needsEvents = labels.includes(USEFUL_LABEL) || (known?.status === "accepted" && known.accepted_via === "label");
      snapshot.push({
        kind, project, iid, labels, contributedAt, authorAccountId,
        title: (typeof item.title === "string" ? item.title : `${kind === "pr" ? "MR" : "Issue"} ${iid}`).slice(0, 200),
        url: urlOf(item.web_url, project, kind, iid),
        events: needsEvents ? await latestLabelEvents(project, kind, iid) : null,
      });
    };

    /** 以下函数只消费已完成的快照；不发 HTTP，可安全放进同步 SQLite 事务。 */
    const applyLabel = (row: CandidateRow, labels: string[], events: Map<string, LatestLabel> | null) => {
      const labelAdder = (name: string, event: LatestLabel | undefined): { account: string } | { note: string } => {
        if (!event || event.action !== "add") return { note: `有「${name}」标签，但读不到是谁加的，先留在待确认` };
        const reviewer = event.accountId;
        if (!reviewer) return { note: `「${name}」标签由 GitLab 用户 ${event.username ?? event.userId} 添加，对不上极客班账号，未计分` };
        if (reviewer === row.account_id) return { note: `「${name}」标签是作者自己加的，未计分` };
        if (!deps.canReview(reviewer)) return { note: `「${name}」标签由 ${event.username ?? reviewer} 添加，这个账号没有审核积分的权限，未计分` };
        return { account: reviewer };
      };

      const labeled = labels.includes(USEFUL_LABEL);
      if (row.status === "pending") {
        const levels = levelsFromLabels(labels);
        setLevels.run({ id: row.id, ...levels, now: clock() });
        if (!labeled) return;
        const keep = (note: string) => { setNote.run(note, clock(), row.id, note); };
        if (!levels.importance || !levels.core) {
          keep(`有「有用」标签，但重要程度和核心度要各有一个标签（${IMPORTANCE_LABEL_PREFIX}一般/重要/关键、${CORE_LABEL_PREFIX}边缘/业务/核心），先留在待确认`);
          return;
        }
        if (!events) { keep("有「有用」标签，但读不到是谁加的，先留在待确认"); return; }
        const useful = labelAdder(USEFUL_LABEL, events.get(USEFUL_LABEL));
        if ("note" in useful) { keep(useful.note); return; }
        for (const name of [`${IMPORTANCE_LABEL_PREFIX}${IMPORTANCE_LABELS[levels.importance]}`, `${CORE_LABEL_PREFIX}${CORE_LABELS[levels.core]}`]) {
          const adder = labelAdder(name, events.get(name));
          if ("note" in adder) { keep(adder.note); return; }
        }
        const reviewer = useful.account;
        const username = events.get(USEFUL_LABEL)?.username ?? null;
        const reason = `GitLab 上由 ${username ?? "审核人"} 标记「有用」`;
        const accepted = { importance: levels.importance, core: levels.core };
        const result = acceptRow(row, reviewer, "label", accepted, reason, clock());
        if (result.ok) {
          deps.audit({ login: username ?? "gitlab", account_id: reviewer }, "competition.candidate.accept", row.id,
            { competition_id: row.competition_id, via: "label", points: result.value.final_points, ...accepted, kind: row.kind }, undefined, { surface: "system" });
          run.accepted++;
        } else {
          const text = result.error === "duplicate_score_event" ? "已经有同一条贡献的积分记录，未重复计分" : `自动计分没成功（${result.error}）`;
          setNote.run(text, clock(), row.id, text);
        }
        return;
      }
      if (!labeled && row.status === "accepted" && row.accepted_via === "label" && row.score_event_id) {
        const event = events?.get(USEFUL_LABEL);
        if (!event || event.action !== "remove") return;
        const eventId = row.score_event_id;
        revokeEvent.run(event.accountId, clock(), "GitLab 上的「有用」标签被移除", eventId);
        markPending.run({ id: row.id, now: clock(), note: "「有用」标签被移除，经标签加的分已撤销" });
        deps.audit({ login: event.username ?? "gitlab", account_id: event.accountId }, "competition.candidate.label_removed", row.id,
          { competition_id: row.competition_id, score_event_id: eventId }, undefined, { surface: "system" });
        run.revoked++;
      }
    };

    const upsert = (entry: SnapshotEntry) => {
      const existing = selectByKey.get(record.id, entry.kind, entry.project, entry.iid) as CandidateRow | undefined;
      if (existing) {
        refreshCandidate.run(entry.title, entry.url, clock(), existing.id, entry.title, entry.url);
        return selectByKey.get(record.id, entry.kind, entry.project, entry.iid) as CandidateRow;
      }
      insertCandidate.run({
        id: randomUUID(), competition_id: record.id, account_id: entry.authorAccountId, kind: entry.kind,
        gitlab_project: entry.project, gitlab_iid: entry.iid, url: entry.url, title: entry.title,
        contributed_at: entry.contributedAt, now: clock(),
      });
      run.created++;
      return selectByKey.get(record.id, entry.kind, entry.project, entry.iid) as CandidateRow;
    };

    try {
      for (const project of projects) {
        const encoded = encodeURIComponent(project);
        const mrs = await readList<GitlabItem>(`/projects/${encoded}/merge_requests?state=merged&updated_after=${encodeURIComponent(since)}&order_by=updated_at`);
        for (const item of mrs) {
          if (!Number.isSafeInteger(item.iid) || Number(item.iid) < 1 || item.state !== "merged") continue;
          const mergedAt = inWindow(item.merged_at);
          if (mergedAt === null) continue;
          run.fetched++;
          await prepare("pr", project, item, mergedAt);
          for (const iid of closingIssueIids(item.description, project)) {
            const key = issueKey(project, iid);
            const known = closingRefs.get(key);
            if (!known || mergedAt < known.contributedAt) closingRefs.set(key, { project, iid, contributedAt: mergedAt });
          }
        }
        const issues = await readList<GitlabItem>(`/projects/${encoded}/issues?created_after=${encodeURIComponent(since)}&created_before=${encodeURIComponent(until)}`);
        for (const item of issues) {
          if (!Number.isSafeInteger(item.iid) || Number(item.iid) < 1) continue;
          const createdAt = inWindow(item.created_at);
          if (createdAt === null) continue;
          const labels = labelsOf(item);
          const iid = Number(item.iid);
          const known = selectByKey.get(record.id, "issue", project, iid) as CandidateRow | undefined;
          let qualifies = Boolean(known) || labels.includes(USEFUL_LABEL);
          if (!qualifies && item.state === "closed" && Number(item.merge_requests_count) > 0) {
            const closedBy = await readList<GitlabItem>(`/projects/${encoded}/issues/${iid}/closed_by`);
            qualifies = closedBy.some(mr => mr?.state === "merged");
          }
          if (!qualifies) continue;
          run.fetched++;
          await prepare("issue", project, item, createdAt);
          preparedIssues.add(issueKey(project, iid));
        }
      }
      // GitLab 只在合进默认分支时自动关 Issue，合进 stage 的 MR 不会让 closed_by 有结果，所以这里认正文的关闭关键字。
      // Issue 不要求已经关闭（团队合进 stage 后不一定马上关）。不用 related_merge_requests：它还包括只写 Refs 的 MR。
      // `#n` 只指 Issue（MR 写作 `!n`）。404、403、5xx 只跳过这一个编号并记日志，其它失败整轮不应用。
      for (const ref of closingRefs.values()) {
        const key = issueKey(ref.project, ref.iid);
        if (preparedIssues.has(key)) continue;
        // 驳回或控制台确认过的候选，标签改不了结果，就不再读详情省预算；待确认和经标签加分的仍要读，标签的变化要跟着来。
        const known = selectByKey.get(record.id, "issue", ref.project, ref.iid) as CandidateRow | undefined;
        if (known && !labelsMatter(known)) continue;
        const result = await read(`/projects/${encodeURIComponent(ref.project)}/issues/${ref.iid}`);
        if (result.status === 403 || result.status === 404 || result.status >= 500) {
          run.skipped++;
          activeLogger?.warn({ project: ref.project, iid: ref.iid, status: result.status }, "competition collect skipped a closing reference");
          continue;
        }
        if (result.status !== 200 || !result.data || typeof result.data !== "object") {
          throw Object.assign(new Error("issue"), { code: `gitlab_http_${result.status}` });
        }
        const item = result.data as GitlabItem;
        if (Number(item.iid) !== ref.iid) continue;
        run.fetched++;
        await prepare("issue", ref.project, item, ref.contributedAt);
        preparedIssues.add(key);
      }

      db.transaction(() => {
        const current = deps.competitions.get(record.id);
        const currentProjects = deps.rules.get(record.id).gitlab_projects;
        if (!current || !collectable(current, clock()) || current.start_at !== record.start_at || current.end_at !== record.end_at
          || JSON.stringify(currentProjects) !== JSON.stringify(projects) || deps.gitlab.mode === "off") {
          throw Object.assign(new Error("state changed"), { code: "collection_state_changed" });
        }
        const signedUp = new Set(deps.signups.activeSignups(record.id).map(person => person.account_id));
        for (const entry of snapshot) {
          if (!signedUp.has(entry.authorAccountId)) { run.skipped++; continue; }
          const existing = selectByKey.get(record.id, entry.kind, entry.project, entry.iid) as CandidateRow | undefined;
          if (existing && existing.account_id !== entry.authorAccountId) { run.skipped++; continue; }
          const row = upsert(entry);
          applyLabel(row, entry.labels, entry.events);
        }
      })();
    } catch (error) {
      run.created = run.accepted = run.revoked = 0;
      run.error = (error as { code?: unknown }).code ? String((error as { code: unknown }).code) : "collect_failed";
    }
    if (run.accepted || run.revoked) deps.onScoresChanged(record.id);
    lastRuns.set(record.id, run);
    return run;
  }

  /** 收集一场比赛；同一场正在跑时等它跑完，不并发跑两遍。GitLab 同步 off 或没配好时不跑。 */
  async function collect(competitionId: string): Promise<{ ok: true; value: CollectRun } | { ok: false; error: CandidateError }> {
    const record = deps.competitions.get(competitionId);
    if (!record) return { ok: false, error: "not_found" };
    if (deps.scores.isFinalized(competitionId)) return { ok: false, error: "competition_finalized" };
    if (deps.gitlab.mode === "off" || !deps.gitlab.url) return { ok: false, error: "gitlab_sync_off" };
    const current = running.get(competitionId);
    if (current) return { ok: true, value: await current };
    const task = runCollect(record).finally(() => running.delete(competitionId));
    running.set(competitionId, task);
    return { ok: true, value: await task };
  }

  async function collectAll(): Promise<CollectRun[]> {
    if (deps.gitlab.mode === "off" || !deps.gitlab.url) return [];
    const now = clock();
    const runs: CollectRun[] = [];
    for (const record of deps.competitions.list(now)) {
      if (!collectable(record, now)) continue;
      const result = await collect(record.id);
      if (result.ok) runs.push(result.value);
    }
    return runs;
  }

  let timer: ReturnType<typeof setInterval> | null = null;
  let stopping = false;
  let loop: Promise<unknown> | null = null;
  /** 每 10 分钟收一轮（启动时先收一轮）；每一轮开始时才看 GitLab 同步开没开，控制台改设置不用重排定时器。 */
  function start(logger: Logger): void {
    activeLogger = logger;
    if (timer) return;
    stopping = false;
    const tick = () => {
      if (stopping || loop) return;
      loop = collectAll().then(runs => {
        const failed = runs.filter(item => item.error);
        if (failed.length) logger.error({ errors: failed.map(item => item.error) }, "competition collect failed");
        else if (runs.some(item => item.created || item.accepted || item.revoked)) {
          logger.info({ created: runs.reduce((sum, item) => sum + item.created, 0), accepted: runs.reduce((sum, item) => sum + item.accepted, 0) }, "competition collect finished");
        }
      }).catch(error => logger.error({ error: (error as Error)?.name ?? "error" }, "competition collect failed")).finally(() => { loop = null; });
    };
    tick();
    timer = setInterval(tick, COLLECT_INTERVAL_MS);
    timer.unref();
  }
  async function stop(): Promise<void> {
    stopping = true;
    if (timer) clearInterval(timer);
    timer = null;
    await loop?.catch(() => undefined);
  }

  return { list, get, view, accept, reject, onEventRevoked, pendingCount, collect, collectAll, collectable, start, stop };
}
export type CompetitionCandidates = ReturnType<typeof createCompetitionCandidates>;

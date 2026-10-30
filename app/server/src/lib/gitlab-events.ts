import type Database from "better-sqlite3";
import { RETENTION_MS, type ExternalActivityInput } from "./activity.js";

/**
 * GitLab 项目事件进操作记录（#370）：按 GITLAB_EVENTS_INTERVAL_MINUTES 分钟的固定间隔只读地拉取 GITLAB_GROUP 下每个项目的
 * `GET /projects/:id/events`。间隔为 0 时关闭，空为 10 分钟；需要 GITLAB_URL 与 GITLAB_API_TOKEN。这一条不看 GITLAB_SYNC
 * （那个开关只管账号对账的写入），每个环境读的是自己的 GitLab，所以正式与预发布各自独立拉取。每个项目记一个游标（app_state，键
 * `gitlab_events_cursor:<项目编号>`，值是已经处理过的最大事件编号），只取游标之后的新事件，写进 activity_events：
 * surface `gitlab`，动作 `gitlab.<对象>.<动作>`，带项目路径、对象类型、编号和 GitLab 链接。
 *
 * 不记提交说明、评论正文、diff 或分支内容：只读 GitLab 事件里的动作、对象类型与编号、作者编号、时间，以及推送事件的分支名与提交数量。
 * 作者按 gitlab_accounts.gitlab_user_id 对到极客班账号；对不上的照样写，账号为空、meta.linked 为 false。
 *
 * 失败的那个项目整轮不写（抓取与写入分两步，写入在一个事务里，游标和事件一起前进）；其它项目照常。
 * 每个项目一轮最多翻 EVENTS_PAGES_MAX 页，到上限仍有下一页时停下、写已经拿到的、游标跟到拿到的最新一条，并记一条告警。
 */
export const EVENTS_PAGE_SIZE = 100;
/** 一个项目一轮最多翻这么多页（每页 100 条，共 500 条）。 */
export const EVENTS_PAGES_MAX = 5;
/** 组内项目最多翻这么多页（每页 100 个）。 */
export const EVENTS_PROJECTS_PAGES_MAX = 10;
export const EVENTS_CURSOR_PREFIX = "gitlab_events_cursor:";

/** 这个模块需要的 GitLab 能力：同一个只读请求函数、地址与组、是否配了令牌，以及按 GitLab 用户编号找账号（不发请求）。 */
export type GitlabEventsSource = {
  /** GITLAB_URL 与 GITLAB_API_TOKEN 都配了；缺一不可拉取。 */
  readonly configured: boolean;
  readonly url: string | null;
  readonly group: string;
  readApi(path: string): Promise<{ status: number; data: unknown; nextPage: number | null }>;
  mappedAccount(gitlabUserId: number): string | null;
};
export type GitlabEventsLogger = {
  info(details: Record<string, unknown>, message: string): void;
  warn(details: Record<string, unknown>, message: string): void;
  error(details: Record<string, unknown>, message: string): void;
};
export type GitlabEventsRun = {
  at: number; projects: number; written: number; failed: number; truncated: number; error: string | null; skipped: string | null;
};

type ParsedEvent = {
  id: number; projectId: number; createdAt: number; action: string; targetType: string | null; targetIid: number | null; targetId: number | null;
  authorId: number | null; authorUsername: string | null; push: boolean; ref: string | null; commitCount: number | null; commitTo: string | null;
  noteable: { type: string; iid: number } | null;
};

const SHA_RE = /^[0-9a-f]{7,64}$/;
const PROJECT_PATH_RE = /^[A-Za-z0-9_.-]+(?:\/[A-Za-z0-9_.-]+)*$/;

function codeError(code: string): Error {
  return Object.assign(new Error(code), { code });
}

/** 文字转成适合放进动作名与对象类型的片段：`pushed to` → `pushed_to`，`DiffNote` → `diff_note`。 */
function slug(value: string): string {
  return value.replace(/([a-z0-9])([A-Z])/g, "$1_$2").toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "") || "other";
}

const isInt = (value: unknown): value is number => typeof value === "number" && Number.isSafeInteger(value);
const orNull = (value: unknown): string | null => (typeof value === "string" && value.trim() ? value.trim() : null);

/** 只留需要的字段；缺了编号、时间或动作名的事件视为数据不完整，整个项目这一轮不写。 */
function parseEvent(raw: unknown, projectId: number): ParsedEvent {
  const item = (raw ?? {}) as Record<string, unknown>;
  const createdAt = typeof item.created_at === "string" ? Date.parse(item.created_at) : Number.NaN;
  if (!isInt(item.id) || item.id <= 0 || !Number.isFinite(createdAt) || typeof item.action_name !== "string") {
    throw codeError("gitlab_data_incomplete");
  }
  const push = item.push_data && typeof item.push_data === "object" ? item.push_data as Record<string, unknown> : null;
  const note = item.note && typeof item.note === "object" ? item.note as Record<string, unknown> : null;
  const noteableType = note ? orNull(note.noteable_type) : null;
  const noteable = noteableType && isInt(note?.noteable_iid) ? { type: noteableType, iid: note!.noteable_iid as number } : null;
  return {
    id: item.id, projectId, createdAt, action: item.action_name.trim().toLowerCase(),
    targetType: orNull(item.target_type), targetIid: isInt(item.target_iid) ? item.target_iid : null,
    targetId: isInt(item.target_id) ? item.target_id : null,
    authorId: isInt(item.author_id) ? item.author_id : null, authorUsername: orNull(item.author_username),
    push: push !== null, ref: push ? orNull(push.ref) : null, commitCount: push && isInt(push.commit_count) ? push.commit_count : null,
    commitTo: push && typeof push.commit_to === "string" && SHA_RE.test(push.commit_to) ? push.commit_to : null,
    noteable,
  };
}

/** 评论归到它所在的对象（议题、合并请求）上，动作统一写 `note`；推送与项目级事件没有对象类型。 */
function objectOf(event: ParsedEvent): { type: string | null; iid: number | null; action: string } {
  if (event.targetType && /Note$/.test(event.targetType)) {
    return { type: event.noteable?.type ?? event.targetType, iid: event.noteable?.iid ?? null, action: `gitlab.note.${slug(event.action)}` };
  }
  if (event.targetType) return { type: event.targetType, iid: event.targetIid, action: `gitlab.${slug(event.targetType)}.${slug(event.action)}` };
  return { type: null, iid: null, action: `gitlab.${event.push ? "push" : "project"}.${slug(event.action)}` };
}

/** GitLab 网页上对应的位置：议题、合并请求、里程碑、评论所在页、提交；其它回项目首页。 */
function linkOf(base: string, path: string, event: ParsedEvent, object: ReturnType<typeof objectOf>): string {
  const project = `${base}/${path}`;
  if (event.targetType && /Note$/.test(event.targetType)) {
    const route = event.noteable?.type === "Issue" ? "issues" : event.noteable?.type === "MergeRequest" ? "merge_requests" : null;
    if (route && event.noteable) return `${project}/-/${route}/${event.noteable.iid}${event.targetId !== null ? `#note_${event.targetId}` : ""}`;
  }
  if (object.iid !== null && object.type === "Issue") return `${project}/-/issues/${object.iid}`;
  if (object.iid !== null && object.type === "MergeRequest") return `${project}/-/merge_requests/${object.iid}`;
  if (object.iid !== null && object.type === "Milestone") return `${project}/-/milestones/${object.iid}`;
  if (event.commitTo) return `${project}/-/commit/${event.commitTo}`;
  return project;
}

export function createGitlabEvents(db: Database.Database, deps: {
  gitlab: GitlabEventsSource;
  activity: { recordExternal(rows: ExternalActivityInput[]): number };
  intervalMinutes: number;
  clock?: () => number;
}) {
  const { gitlab, activity } = deps;
  const clock = deps.clock ?? Date.now;
  const readCursor = db.prepare("SELECT value FROM app_state WHERE key = ?");
  const writeCursor = db.prepare(
    "INSERT INTO app_state(key, value, updated_at) VALUES(?, ?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at",
  );

  const cursorOf = (projectId: number): number | null => {
    const row = readCursor.get(`${EVENTS_CURSOR_PREFIX}${projectId}`) as { value: string } | undefined;
    const value = row ? Number(row.value) : Number.NaN;
    return Number.isSafeInteger(value) && value > 0 ? value : null;
  };

  async function read(path: string) {
    const result = await gitlab.readApi(path);
    if (result.status !== 200) throw codeError(`gitlab_http_${result.status}`);
    return result;
  }

  /** 组内全部项目（含子组）的编号与路径；翻到上限仍有下一页时只取前面的，并把 truncated 记下来。 */
  async function groupProjects(): Promise<{ projects: { id: number; path: string }[]; truncated: boolean }> {
    const projects: { id: number; path: string }[] = [];
    const group = encodeURIComponent(gitlab.group);
    let page: number | null = 1;
    const seen = new Set<number>();
    for (let count = 0; page !== null; count++) {
      if (count >= EVENTS_PROJECTS_PAGES_MAX) return { projects, truncated: true };
      if (seen.has(page)) throw codeError("gitlab_pagination_incomplete");
      seen.add(page);
      const result = await read(`/groups/${group}/projects?include_subgroups=true&per_page=${EVENTS_PAGE_SIZE}&page=${page}`);
      if (!Array.isArray(result.data)) throw codeError("gitlab_data_incomplete");
      for (const raw of result.data as Record<string, unknown>[]) {
        if (!isInt(raw.id) || typeof raw.path_with_namespace !== "string" || !PROJECT_PATH_RE.test(raw.path_with_namespace)) continue;
        projects.push({ id: raw.id, path: raw.path_with_namespace });
      }
      const next: number | null = result.nextPage ?? (result.data.length === EVENTS_PAGE_SIZE ? page + 1 : null);
      if (next !== null && next !== page + 1) throw codeError("gitlab_pagination_incomplete");
      page = next;
    }
    return { projects, truncated: false };
  }

  /**
   * 一个项目游标之后的新事件，新的在前。按编号碰到游标就停；事件早于保留期也停（它们写进去马上就会被清掉）。
   * 翻到 EVENTS_PAGES_MAX 页仍有下一页时 truncated 为真。
   */
  async function eventsAfter(projectId: number, cursor: number | null, now: number): Promise<{ events: ParsedEvent[]; truncated: boolean }> {
    const events: ParsedEvent[] = [];
    let page: number | null = 1;
    const seen = new Set<number>();
    for (let count = 0; page !== null; count++) {
      if (count >= EVENTS_PAGES_MAX) return { events, truncated: true };
      if (seen.has(page)) throw codeError("gitlab_pagination_incomplete");
      seen.add(page);
      const result = await read(`/projects/${projectId}/events?per_page=${EVENTS_PAGE_SIZE}&page=${page}`);
      if (!Array.isArray(result.data)) throw codeError("gitlab_data_incomplete");
      for (const raw of result.data) {
        const event = parseEvent(raw, projectId);
        if (cursor !== null && event.id <= cursor) return { events, truncated: false };
        if (event.createdAt < now - RETENTION_MS) return { events, truncated: false };
        events.push(event);
      }
      const next: number | null = result.nextPage ?? (result.data.length === EVENTS_PAGE_SIZE ? page + 1 : null);
      if (next !== null && next !== page + 1) throw codeError("gitlab_pagination_incomplete");
      page = next;
    }
    return { events, truncated: false };
  }

  function rowOf(event: ParsedEvent, path: string): ExternalActivityInput {
    const object = objectOf(event);
    const accountId = event.authorId === null ? null : gitlab.mappedAccount(event.authorId);
    const base = gitlab.url ?? "";
    const meta: Record<string, unknown> = {
      project: path, url: linkOf(base, path, event, object), gitlab_event_id: event.id,
      gitlab_user_id: event.authorId, gitlab_username: event.authorUsername, linked: accountId !== null,
    };
    if (event.ref) meta.ref = event.ref;
    if (event.commitCount !== null) meta.commit_count = event.commitCount;
    return {
      at: event.createdAt, account_id: accountId, surface: "gitlab", action: object.action,
      target_type: object.type, target_id: object.iid !== null ? String(object.iid) : null, outcome: "ok", meta,
    };
  }

  /** 一个项目：先抓完（失败就抛出，什么也不写），再在一个事务里写事件并把游标推到最新一条。 */
  async function collectProject(project: { id: number; path: string }, now: number): Promise<{ written: number; truncated: boolean }> {
    const cursor = cursorOf(project.id);
    const { events, truncated } = await eventsAfter(project.id, cursor, now);
    // 事件是新的在前；写进去按时间从旧到新，行编号才和发生的先后一致
    const rows = [...events].reverse().map(event => rowOf(event, project.path));
    const newest = events.reduce((max, event) => Math.max(max, event.id), cursor ?? 0);
    db.transaction(() => {
      activity.recordExternal(rows);
      if (newest > (cursor ?? 0)) writeCursor.run(`${EVENTS_CURSOR_PREFIX}${project.id}`, String(newest), now);
    })();
    return { written: rows.length, truncated };
  }

  let running: Promise<GitlabEventsRun> | null = null;
  let stopping = false;
  let logger: GitlabEventsLogger = { info() {}, warn() {}, error() {} };

  /** 跑一轮。间隔为 0 时什么也不做（不调 GitLab）；缺地址或令牌报错、不调 GitLab；上一轮还没跑完就返回同一个结果。 */
  function collectOnce(): Promise<GitlabEventsRun> {
    if (running) return running;
    running = (async (): Promise<GitlabEventsRun> => {
      const at = clock();
      if (deps.intervalMinutes === 0) return { at, projects: 0, written: 0, failed: 0, truncated: 0, error: null, skipped: "events_off" };
      if (!gitlab.configured || !gitlab.url) return { at, projects: 0, written: 0, failed: 0, truncated: 0, error: "gitlab_not_configured", skipped: null };
      let listing: Awaited<ReturnType<typeof groupProjects>>;
      try {
        listing = await groupProjects();
      } catch (error) {
        return { at, projects: 0, written: 0, failed: 0, truncated: 0, error: (error as { code?: string }).code ?? "gitlab_unreachable", skipped: null };
      }
      let written = 0;
      let failed = 0;
      let truncated = listing.truncated ? 1 : 0;
      for (const project of listing.projects) {
        if (stopping) break;
        try {
          const result = await collectProject(project, clock());
          written += result.written;
          if (result.truncated) truncated += 1;
        } catch (error) {
          failed += 1;
          // 只记项目编号与错误码：不记事件内容、用户名或令牌
          logger.warn({ project_id: project.id, error: (error as { code?: string }).code ?? "error" }, "gitlab events fetch failed; nothing written for this project");
        }
      }
      return { at, projects: listing.projects.length, written, failed, truncated, error: null, skipped: null };
    })().finally(() => { running = null; });
    return running;
  }

  let timer: ReturnType<typeof setInterval> | null = null;

  /** 启动后立即跑一轮，之后每 intervalMinutes 分钟一轮；间隔为 0 时不排定时器。 */
  function start(log: GitlabEventsLogger): void {
    logger = log;
    if (timer || deps.intervalMinutes === 0) return;
    stopping = false;
    const tick = () => {
      if (stopping) return;
      collectOnce().then(run => {
        if (run.error) logger.warn({ error: run.error }, "gitlab events skipped");
        else if (run.truncated) logger.warn({ projects: run.projects, truncated: run.truncated }, "gitlab events page cap reached; older events not fetched");
        else if (run.written) logger.info({ projects: run.projects, written: run.written }, "gitlab events collected");
      }).catch(error => logger.error({ error: (error as Error)?.name ?? "error" }, "gitlab events failed"));
    };
    tick();
    timer = setInterval(tick, deps.intervalMinutes * 60_000);
    timer.unref();
  }
  async function stop(): Promise<void> {
    stopping = true;
    if (timer) clearInterval(timer);
    timer = null;
    await running?.catch(() => undefined);
  }

  return { collectOnce, start, stop, cursorOf };
}
export type GitlabEvents = ReturnType<typeof createGitlabEvents>;

// 比赛（#238）：官方赛事信息的持久化。只接收普通参数；授权判断在调用方（控制台路由）。
//
// `status` 不入库，按时间戳现算；官网按同一规则更新状态，跨端一致性由回归测试核对。
import { randomUUID } from "node:crypto";
import type Database from "better-sqlite3";

export type CompetitionKind = "internal" | "external";
/** 状态由时间算出来，不入库：未开始 / 报名中 / 报名已截止 / 进行中 / 已结束。 */
export type CompetitionStatus = "upcoming" | "registering" | "closed" | "ongoing" | "ended";

export type CompetitionRecord = {
  id: string; name: string; kind: CompetitionKind;
  start_at: number; end_at: number; signup_deadline: number | null;
  url: string | null; description: string; offline: boolean;
  created_at: number; updated_at: number;
};

/** 建与改的入参（路由已经从 JSON Schema 拿到并归一过类型）。 */
export type CompetitionDraft = {
  name: string; kind: CompetitionKind;
  start_at: number; end_at: number; signup_deadline: number | null;
  url: string | null; description: string;
};
export type CompetitionInput = Omit<CompetitionDraft, "signup_deadline" | "url" | "description"> &
  Partial<Pick<CompetitionDraft, "signup_deadline" | "url" | "description">>;
export type CompetitionPatch = Partial<CompetitionInput> & { offline?: boolean };

/** 公开列表与官网前端用的形状：不含 `offline`、`created_at`、`updated_at` 这些内部字段。 */
export type PublicCompetition = {
  id: string; name: string; kind: CompetitionKind;
  start_at: number; end_at: number; signup_deadline: number | null;
  url: string | null; description: string; status: CompetitionStatus;
};
/** 控制台的形状：多一个 `offline`，它要能看到并恢复已下线的比赛。 */
export type ConsoleCompetition = PublicCompetition & { offline: boolean };

type CompetitionRow = {
  id: string; name: string; kind: string; start_at: number; end_at: number; signup_deadline: number | null;
  url: string | null; description: string; offline: number; created_at: number; updated_at: number;
};

/** 比赛（`competitions` 表）的读写接口；写操作都带上 `updated_at`，调用方负责审计与授权。 */
export interface CompetitionStore {
  /** 全部比赛（含已下线），按「还能赶上的在前、已结束的在后」排。控制台要看到下线的，公开接口自己再筛。 */
  list(now: number): CompetitionRecord[];
  /** 未下线的比赛，公开接口用。 */
  listPublic(now: number): CompetitionRecord[];
  get(id: string): CompetitionRecord | null;
  insert(id: string, input: CompetitionInput, now: number): CompetitionRecord | null;
  update(id: string, patch: CompetitionPatch, now: number): CompetitionRecord | null;
  /** 真删。控制台页面上的「下线」走 `update({ offline: true })`，删除是另一回事。 */
  remove(id: string): boolean;
}

/**
 * 现在这场比赛处在哪个阶段。顺序是「先看有没有结束、再看报名、最后看有没有开始」：
 * 截止时间在 `start_at` 之后（比赛已开始但还能补报）时，报名中要压过进行中，不能因为比赛开始就说报名关了。
 */
export function competitionStatus(record: Pick<CompetitionRecord, "start_at" | "end_at" | "signup_deadline">, now: number): CompetitionStatus {
  if (now > record.end_at) return "ended";
  if (record.signup_deadline !== null && now <= record.signup_deadline) return "registering";
  if (now >= record.start_at) return "ongoing";
  // 比赛还没开始、报名也截止了：报不了名，但还没开场，对外说「报名已截止」。
  return record.signup_deadline === null ? "upcoming" : "closed";
}

/**
 * 时间线顺序：**还能赶上的一律排在已经结束的前面**。还能赶上的按开始时间正序（最近要发生的在最上面），
 * 已经结束的按开始时间倒序（刚结束的在最上面）。同一时间按 id 兜底，排序稳定。
 * 不这样排的话，一场两年后的比赛会压在明天的比赛上面，「哪天截止」就看不出来了。
 */
export function compareCompetitions(
  a: Pick<CompetitionRecord, "start_at" | "end_at" | "id">,
  b: Pick<CompetitionRecord, "start_at" | "end_at" | "id">,
  now: number,
): number {
  const ended = (record: Pick<CompetitionRecord, "end_at">) => now > record.end_at;
  if (ended(a) !== ended(b)) return ended(a) ? 1 : -1;
  const byStart = ended(a) ? b.start_at - a.start_at : a.start_at - b.start_at;
  return byStart || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
}

/**
 * 时间的先后关系在路由里先判，不靠库上的 CHECK 抛 500。返回 null 表示合法。
 * `url` 与 `kind` 无关；输入契约检查形状，这里解析地址，拒绝只有 https 前缀的无效链接。
 */
export function competitionError(draft: CompetitionDraft): "bad_name" | "bad_range" | "deadline_after_end" | "bad_url" | null {
  if ([...draft.name.trim()].length < 2) return "bad_name";
  if (draft.end_at < draft.start_at) return "bad_range";
  if (draft.signup_deadline !== null && draft.signup_deadline > draft.end_at) return "deadline_after_end";
  if (draft.url) {
    try {
      if (new URL(draft.url).protocol !== "https:") return "bad_url";
    } catch {
      return "bad_url";
    }
  }
  return null;
}

function toRecord(row: CompetitionRow): CompetitionRecord {
  return { ...row, kind: row.kind as CompetitionKind, offline: row.offline === 1 };
}

/** 记录转成公开形状，`status` 现算；`now` 由调用方传入，前后端与测试都不会各读一次钟。 */
export function toPublicCompetition(record: CompetitionRecord, now: number): PublicCompetition {
  return {
    id: record.id, name: record.name, kind: record.kind,
    start_at: record.start_at, end_at: record.end_at, signup_deadline: record.signup_deadline,
    url: record.url, description: record.description,
    status: competitionStatus(record, now),
  };
}

export function toConsoleCompetition(record: CompetitionRecord, now: number): ConsoleCompetition {
  return { ...toPublicCompetition(record, now), offline: record.offline };
}

/** 比赛 id 用 `randomUUID()`（与投递、邀请令牌一致），不用自增号，也不暴露创建顺序。 */
export function newCompetitionId(): string {
  return randomUUID();
}

const COLUMNS = "id, name, kind, start_at, end_at, signup_deadline, url, description, offline, created_at, updated_at";

export function createCompetitionStore(db: Database.Database): CompetitionStore {
  const selectAll = db.prepare(`SELECT ${COLUMNS} FROM competitions`);
  const selectOne = db.prepare(`SELECT ${COLUMNS} FROM competitions WHERE id = ?`);
  const insert = db.prepare(`INSERT INTO competitions(id, name, kind, start_at, end_at, signup_deadline, url, description, offline, created_at, updated_at)
    VALUES(@id, @name, @kind, @start_at, @end_at, @signup_deadline, @url, @description, 0, @now, @now)`);
  const update = db.prepare(`UPDATE competitions SET
    name = @name, kind = @kind, start_at = @start_at, end_at = @end_at, signup_deadline = @signup_deadline,
    url = @url, description = @description, offline = @offline, updated_at = @now
    WHERE id = @id`);
  const remove = db.prepare("DELETE FROM competitions WHERE id = ?");

  const get = (id: string): CompetitionRecord | null => {
    const row = selectOne.get(id) as CompetitionRow | undefined;
    return row ? toRecord(row) : null;
  };
  const list = (now: number): CompetitionRecord[] =>
    (selectAll.all() as CompetitionRow[]).map(toRecord).sort((a, b) => compareCompetitions(a, b, now));

  return {
    list,
    listPublic: (now: number) => list(now).filter(record => !record.offline),
    get,
    insert: (id, input, now) => {
      insert.run({
        id, now,
        name: input.name, kind: input.kind, start_at: input.start_at, end_at: input.end_at,
        signup_deadline: input.signup_deadline ?? null, url: input.url ?? null, description: input.description ?? "",
      });
      return get(id);
    },
    /**
     * 改一条。补丁没给的字段保持原值。`url` 与 `kind` 无关：内部比赛也可以挂自己的比赛官网链接，
     * 没给就保持原值，显式传 null 才清掉（表上只约束「填了必须是 https」）。
     */
    update: (id, patch, now) => {
      const current = get(id);
      if (!current) return null;
      const kind = patch.kind ?? current.kind;
      update.run({
        id, now, kind,
        // 与 signup_deadline 一样按 undefined 判「没给」：合同允许显式传 url: null 清掉官方链接
        url: patch.url === undefined ? current.url : patch.url,
        name: patch.name ?? current.name,
        start_at: patch.start_at ?? current.start_at,
        end_at: patch.end_at ?? current.end_at,
        signup_deadline: patch.signup_deadline === undefined ? current.signup_deadline : patch.signup_deadline,
        description: patch.description ?? current.description,
        offline: (patch.offline ?? current.offline) ? 1 : 0,
      });
      return get(id);
    },
    remove: id => remove.run(id).changes > 0,
  };
}

// 比赛（#238）的数据：官网桌面「比赛」窗口读 GET /api/public/competitions。
//
// 状态由服务端按时间算好（`status`），页面上的「报名中 / 进行中 / 已结束」跟着服务端走；
// 窗口开着的时候按时间戳本地重算一次，免得在午夜前后停在旧状态上。
// 读不到（离线、接口不通、开发预览没有这份数据）时标记失败，窗口显示「读不到」而不是冒充「没有比赛」。
import { useEffect, useState } from "react";
import { api } from "@shared/lib/api";

export type CompetitionKind = "internal" | "external";
export type CompetitionStatus = "registering" | "closed" | "ongoing" | "ended";
export type Competition = {
  id: string; name: string; kind: CompetitionKind;
  start_at: number; end_at: number; signup_deadline: number | null;
  url: string | null; description: string; status: CompetitionStatus;
};

export const COMPETITIONS_URL = "/api/public/competitions";

const KINDS: CompetitionKind[] = ["internal", "external"];
const STATUSES: CompetitionStatus[] = ["registering", "closed", "ongoing", "ended"];
/** 只认识要用的那几个字段：缺 `id`、名称或起止时间的条目直接丢掉，不显示半条。 */
type RawCompetition = { id?: unknown; name?: unknown; kind?: unknown; start_at?: unknown; end_at?: unknown; signup_deadline?: unknown; url?: unknown; description?: unknown; status?: unknown };

const asNumber = (value: unknown): number | null => (typeof value === "number" && Number.isFinite(value) ? value : null);
const asText = (value: unknown): string => (typeof value === "string" ? value : "");

/**
 * 读一条比赛。`id`、名称、起止时间缺一不可。服务端给的 `status` 认不出时按时间现算，
 * 不把状态显示错；外部比赛才带链接，且只收 https。
 */
export function readCompetition(value: unknown): Competition | null {
  if (typeof value !== "object" || value === null) return null;
  const raw = value as RawCompetition;
  const id = asText(raw.id);
  const name = asText(raw.name);
  const start = asNumber(raw.start_at);
  const end = asNumber(raw.end_at);
  if (!id || !name || start === null || end === null) return null;
  const kind = KINDS.includes(raw.kind as CompetitionKind) ? (raw.kind as CompetitionKind) : "internal";
  const signup_deadline = asNumber(raw.signup_deadline);
  const status = STATUSES.includes(raw.status as CompetitionStatus)
    ? (raw.status as CompetitionStatus)
    : statusAt({ start_at: start, end_at: end, signup_deadline }, Date.now());
  const link = asText(raw.url);
  const url = kind === "external" && /^https:\/\/\S+$/.test(link) ? link : null;
  return { id, name, kind, start_at: start, end_at: end, signup_deadline, url, description: asText(raw.description), status };
}

/** 服务端 `competitionStatus` 的同一套口径，用于接口没给状态或值认不出时兜底。 */
export function statusAt(record: { start_at: number; end_at: number; signup_deadline: number | null }, now: number): CompetitionStatus {
  if (now > record.end_at) return "ended";
  if (record.signup_deadline !== null && now <= record.signup_deadline) return "registering";
  if (now >= record.start_at) return "ongoing";
  return record.signup_deadline === null ? "registering" : "closed";
}

/** 读响应：只留读得出来的条目，保持服务端给的顺序。 */
export function readCompetitions(body: unknown): Competition[] {
  const list = typeof body === "object" && body !== null && Array.isArray((body as { competitions?: unknown }).competitions)
    ? ((body as { competitions: unknown[] }).competitions)
    : [];
  return list.map(readCompetition).filter((item): item is Competition => item !== null);
}

export type CompetitionFeed = { items: Competition[]; failed: boolean; loading: boolean };

/**
 * 窗口打开时读一次，关掉即取消。窗口开着时每 60 秒按当前时间重算一次状态：
 * 报名在半夜截止、或比赛当天开始时，界面不用等刷新就能跟上。
 */
export function useCompetitions(): CompetitionFeed {
  const [items, setItems] = useState<Competition[]>([]);
  const [failed, setFailed] = useState(false);
  const [loading, setLoading] = useState(true);
  const [, tick] = useState(0);

  useEffect(() => {
    const controller = new AbortController();
    api<unknown>(COMPETITIONS_URL, { signal: controller.signal, headers: { Accept: "application/json" } }).then(
      (body) => {
        if (controller.signal.aborted) return;
        setItems(readCompetitions(body));
        setFailed(false);
        setLoading(false);
      },
      () => {
        if (controller.signal.aborted) return;
        setFailed(true);
        setLoading(false);
      },
    );
    const timer = window.setInterval(() => { if (!controller.signal.aborted) tick((n) => n + 1); }, 60_000);
    return () => { controller.abort(); window.clearInterval(timer); };
  }, []);

  const now = Date.now();
  return { items: items.map((item) => ({ ...item, status: statusAt(item, now) })), failed, loading };
}

/** 时间戳 → 北京时间的 `YYYY-MM-DD`。 */
export function beijingDay(at: number): string {
  const d = new Date(at + 8 * 3600_000);
  const pad = (value: number) => String(value).padStart(2, "0");
  return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;
}

/** 北京时间的某一天 → 时间戳；`start` 是当天 00:00:00.000，`end` 是当天末毫秒。日期不存在时给 null。 */
export function beijingDayEdge(date: string, edge: "start" | "end"): number | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return null;
  const [y, m, d] = date.split("-").map(Number);
  const midnight = Date.UTC(y, m - 1, d) - 8 * 3600_000;
  if (beijingDay(midnight) !== date) return null;
  return edge === "start" ? midnight : midnight + 24 * 3600_000 - 1;
}

/** 「10-18」这种短日期；列表里不重复写年份。 */
export function shortDay(at: number): string {
  return beijingDay(at).slice(5);
}

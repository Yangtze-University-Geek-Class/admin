// 比赛窗口（#265）的日期与文案：都按北京时间算的纯函数，组件只负责摆放。
//
// 控制台只填日期（app/console/src/pages/Competitions.vue），存下来的开赛是当天 00:00:00.000、
// 结束与报名截止是当天 23:59:59.999；接口也允许精确时间，所以这两种都要说得通：
// 落在整天边界上的不写钟点，其余写到分钟。单测在 tests/web/portal-competitions.test.tsx。
import { beijingDay, beijingDayEdge, dayRange, shortDay, type Competition, type CompetitionKind, type CompetitionStatus, type SignupSettings } from "./competitions";

/** 状态文案：与服务端 `competitionStatus` 的五个值一一对应。 */
export const STATUS_TEXT: Record<CompetitionStatus, string> = { upcoming: "未开始", registering: "报名中", closed: "报名已截止", ongoing: "进行中", ended: "已结束" };
export const KIND_TEXT: Record<CompetitionKind, string> = { internal: "内部", external: "外部" };

const HOUR = 3600_000;
const DAY = 24 * HOUR;
const WEEKDAYS = ["周日", "周一", "周二", "周三", "周四", "周五", "周六"] as const;
const pad = (value: number) => String(value).padStart(2, "0");
/** 北京时间的日序号：同一天的两个时间戳得到同一个数，相减就是隔了几天。 */
const dayIndex = (at: number) => Math.floor((at + 8 * HOUR) / DAY);

/** 北京时间是星期几：`周日` … `周六`。 */
export function beijingWeekday(at: number): string {
  return WEEKDAYS[new Date(at + 8 * HOUR).getUTCDay()];
}

/** 北京时间的 `HH:mm`。 */
export function beijingClock(at: number): string {
  const d = new Date(at + 8 * HOUR);
  return `${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}`;
}

/** 是不是北京时间某天的 00:00:00.000 / 23:59:59.999（控制台只填日期时存的就是这两个点）。 */
export const isDayStart = (at: number): boolean => beijingDayEdge(beijingDay(at), "start") === at;
export const isDayEnd = (at: number): boolean => beijingDayEdge(beijingDay(at), "end") === at;

/** `10-25（周日）`；不是今年的带年份。 */
export function dayLabel(at: number, now = Date.now()): string {
  return `${shortDay(at, now)}（${beijingWeekday(at)}）`;
}

/** 报名截止总写到分钟：`10-25（周日）23:59`，一眼看出截止当天整天都还能报。全角括号后面不再空格。 */
export function deadlineLabel(at: number, now = Date.now()): string {
  return `${dayLabel(at, now)}${beijingClock(at)}`;
}

/** 开赛、结束这种时间点：落在整天边界上只写日期，否则写到分钟（`10-26（周一）09:30`）。 */
export function pointLabel(at: number, now = Date.now()): string {
  return isDayStart(at) || isDayEnd(at) ? dayLabel(at, now) : `${dayLabel(at, now)}${beijingClock(at)}`;
}

/** 日期后面接字：以钟点结尾时空一格（`09:30 开赛`），以全角括号结尾直接接上（`10-26（周一）开赛`）。 */
const joinWord = (label: string, word: string): string => (/\d$/.test(label) ? `${label} ${word}` : `${label}${word}`);

/** 从今天（北京时间）到 `at` 那天隔几天：今天 0，明天 1，已经过去是负数。 */
export function daysUntil(at: number, now = Date.now()): number {
  return dayIndex(at) - dayIndex(now);
}

type Timing = Pick<Competition, "status" | "start_at" | "end_at" | "signup_deadline">;

/** 状态旁边的一句：报名中说还剩几天，没开赛说几天后开赛，进行中说几天后结束；已结束不说。 */
export function statusHint(item: Timing, now = Date.now()): string | null {
  if (item.status === "registering" && item.signup_deadline !== null) {
    const days = daysUntil(item.signup_deadline, now);
    return days <= 0 ? "今天截止" : days === 1 ? "明天截止" : `还剩 ${days} 天`;
  }
  if (item.status === "upcoming" || item.status === "closed") {
    const days = daysUntil(item.start_at, now);
    return days <= 0 ? "今天开赛" : days === 1 ? "明天开赛" : `${days} 天后开赛`;
  }
  if (item.status === "ongoing") {
    const days = daysUntil(item.end_at, now);
    return days <= 0 ? "今天结束" : days === 1 ? "明天结束" : `还有 ${days} 天结束`;
  }
  return null;
}

/** 卡片上最要紧的那个日期：报名中写截止日，没开赛写开赛日，进行中写结束日，已结束写起止。 */
export function cardWhen(item: Timing, now = Date.now()): string {
  switch (item.status) {
    case "registering":
      return `截止 ${dayLabel(item.signup_deadline ?? item.start_at, now)}`;
    case "upcoming":
    case "closed":
      return `${shortDay(item.start_at, now)} 开赛`;
    case "ongoing":
      return `${shortDay(item.end_at, now)} 结束`;
    default:
      return dayRange(item.start_at, item.end_at, now);
  }
}

export type Fact = { main: string; sub: string };

/** 要点格子「报名截止」。没登记截止时间时如实说，并说清以谁为准。 */
export function deadlineFact(item: Pick<Competition, "kind" | "signup_deadline">, now = Date.now()): Fact {
  if (item.signup_deadline === null) return { main: "没有登记", sub: item.kind === "external" ? "以比赛官网为准" : "以组织者通知为准" };
  return { main: deadlineLabel(item.signup_deadline, now), sub: now > item.signup_deadline ? "已截止 · 北京时间" : "北京时间" };
}

/** 要点格子「比赛时间」：一行日期，一行钟点或天数。 */
export function scheduleFact(start: number, end: number, now = Date.now()): Fact {
  const allDay = isDayStart(start) && isDayEnd(end);
  if (beijingDay(start) === beijingDay(end)) {
    return { main: dayLabel(start, now), sub: allDay ? "全天" : `${beijingClock(start)} 至 ${beijingClock(end)}` };
  }
  return {
    main: `${shortDay(start, now)} 至 ${shortDay(end, now)}`,
    sub: allDay ? `共 ${dayIndex(end) - dayIndex(start) + 1} 天` : `${beijingClock(start)} 开始 · ${beijingClock(end)} 结束`,
  };
}

/** 官网链接显示成域名，点之前就知道要去哪。 */
export function siteHost(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return url;
  }
}

/** 参赛形式：`个人赛`、`团队赛 · 每队 1–3 人`（人数固定时写 `每队 3 人`）。 */
export function participationText(settings: Pick<SignupSettings, "participation" | "team_min" | "team_max">): string {
  if (settings.participation === "individual") return "个人赛";
  const size = settings.team_min === settings.team_max ? `${settings.team_max}` : `${settings.team_min}–${settings.team_max}`;
  return `团队赛 · 每队 ${size} 人`;
}

/** 要点格子「报名方式」：外部比赛在官网报；内部比赛开了在线报名（#239）就在这里报，没开时按组织者通知。 */
export function signupFact(item: Pick<Competition, "kind" | "url"> & { signup?: SignupSettings }): Fact {
  if (item.kind === "external") return item.url ? { main: "在比赛官网报名", sub: siteHost(item.url) } : { main: "按主办方通知报名", sub: "组织者还没登记官网" };
  if (item.signup?.enabled) return { main: "在这里在线报名", sub: participationText(item.signup) };
  return { main: "按组织者通知报名", sub: "在线报名还没开放" };
}

export type StepState = "done" | "now" | "next" | "later";
/** `at` 是节点的时刻（比赛日取当天开始），时间线按它算进度。 */
export type ScheduleStep = { key: "deadline" | "start" | "end" | "day"; label: string; when: string; state: StepState; at: number };

/**
 * 赛程：报名截止、开赛、结束按时间排（允许开赛后再截止报名）；整天的单日比赛合成一个「比赛日」。
 * 过去的是 done，正在进行的比赛日是 now，第一个还没到的是 next。边界与 `statusAt` 一致：截止与结束那一刻还不算过去。
 * 报名一直开到比赛最后一刻（截止 = 结束）时合成一个节点，写到分钟，不在同一个点上画两个圆。
 */
export function scheduleSteps(item: Pick<Competition, "start_at" | "end_at" | "signup_deadline">, now = Date.now()): ScheduleStep[] {
  const points: { key: ScheduleStep["key"]; label: string; when: string; from: number; until: number }[] = [];
  const merged = item.signup_deadline === item.end_at;
  if (item.signup_deadline !== null && !merged) {
    points.push({ key: "deadline", label: "报名截止", when: deadlineLabel(item.signup_deadline, now), from: item.signup_deadline, until: item.signup_deadline });
  }
  if (beijingDay(item.start_at) === beijingDay(item.end_at) && isDayStart(item.start_at) && isDayEnd(item.end_at)) {
    points.push({ key: "day", label: merged ? "比赛日 · 报名截止" : "比赛日", when: joinWord(dayLabel(item.start_at, now), "全天"), from: item.start_at, until: item.end_at });
  } else {
    points.push({ key: "start", label: "开赛", when: pointLabel(item.start_at, now), from: item.start_at, until: item.start_at - 1 });
    points.push(merged
      ? { key: "end", label: "报名截止 · 结束", when: deadlineLabel(item.end_at, now), from: item.end_at, until: item.end_at }
      : { key: "end", label: "结束", when: pointLabel(item.end_at, now), from: item.end_at, until: item.end_at });
  }
  points.sort((a, b) => a.from - b.from);
  let nextGiven = false;
  return points.map(({ key, label, when, from, until }) => {
    let state: StepState;
    if (now > until) state = "done";
    else if (key === "day" && now >= from) state = "now";
    else if (!nextGiven) {
      state = "next";
      nextGiven = true;
    } else state = "later";
    return { key, label, when, state, at: from };
  });
}

/**
 * 时间线进度条推到哪：0 = 第一个节点，1 = 最后一个节点；两个节点之间按时间线性插值。
 * 节点等距排开，所以这里算的是「走过了几段」除以总段数，不是总时长的比例。
 */
export function timelineProgress(steps: readonly Pick<ScheduleStep, "at">[], now = Date.now()): number {
  const last = steps.length - 1;
  if (last < 0) return 0;
  if (now >= steps[last]!.at) return 1;
  if (last === 0 || now <= steps[0]!.at) return 0;
  let index = 0;
  while (index < last - 1 && now >= steps[index + 1]!.at) index += 1;
  const from = steps[index]!.at;
  const span = steps[index + 1]!.at - from;
  const part = span > 0 ? Math.min(1, Math.max(0, (now - from) / span)) : 1;
  return Math.round(((index + part) / last) * 10_000) / 10_000;
}

export type CompetitionAction = { text: string; link: { href: string; label: string } | null };

/** 底部操作条：一句现在该怎么办，加上真能点的那一个按钮。现在唯一能点的是比赛官网；没有官网就不放按钮。 */
export function competitionAction(item: Pick<Competition, "status" | "kind" | "url" | "start_at" | "end_at" | "signup_deadline">, now = Date.now()): CompetitionAction {
  const link = item.url ? { href: item.url, label: item.status === "registering" && item.kind === "external" ? "去官网报名" : "查看比赛官网" } : null;
  switch (item.status) {
    case "registering": {
      const due = deadlineLabel(item.signup_deadline ?? item.end_at, now);
      if (item.kind === "internal") return { text: `报名截止 ${due}。在线报名开放前，按组织者的通知报名。`, link };
      return { text: item.url ? `报名截止 ${due}，在比赛官网完成报名。` : `报名截止 ${due}，报名方式以主办方通知为准。`, link };
    }
    case "upcoming":
      return { text: `还没登记报名截止时间，${joinWord(pointLabel(item.start_at, now), "开赛")}。`, link };
    case "closed":
      return { text: `报名已截止，${joinWord(pointLabel(item.start_at, now), "开赛")}。`, link };
    case "ongoing":
      return { text: `比赛进行中，${joinWord(pointLabel(item.end_at, now), "结束")}。`, link };
    default:
      return { text: `比赛已于 ${joinWord(pointLabel(item.end_at, now), "结束")}。`, link };
  }
}

export type CompetitionFilter = { query: string; open: boolean; kind: CompetitionKind | null };
export const NO_FILTER: CompetitionFilter = { query: "", open: false, kind: null };

/** 搜索：名称或介绍里包含每个关键词（不分大小写，空格隔开的词都要命中）。 */
export function matchesQuery(item: Pick<Competition, "name" | "description">, query: string): boolean {
  const words = query.trim().toLowerCase().split(/\s+/).filter(Boolean);
  if (words.length === 0) return true;
  const text = `${item.name}\n${item.description}`.toLowerCase();
  return words.every((word) => text.includes(word));
}

/** 「可报名」= 现在报名中；类型为空表示内部外部都要；三个条件同时满足才留下，顺序不变。 */
export function applyFilter<T extends Pick<Competition, "status" | "kind" | "name" | "description">>(items: readonly T[], filter: CompetitionFilter): T[] {
  return items.filter((item) => (!filter.open || item.status === "registering") && (filter.kind === null || item.kind === filter.kind) && matchesQuery(item, filter.query));
}

// @vitest-environment jsdom
// 比赛窗口（#238）：列表、筛选、外部链接与内部比赛不放按钮、读不到时的说法、以及纯函数的读入与日期换算。
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { Competitions } from "../../app/web/sites/portal/components/os/Windows";
import { COMPETITIONS_URL, beijingDay, beijingDayEdge, dayRange, readCompetition, readCompetitions, shortDay, statusAt } from "../../app/web/sites/portal/lib/competitions";
import { competitionStatus } from "../../app/server/src/lib/competition-store";

// 开发态默认走只读样板数据；这里切到真实数据源，让窗口真的去请求列表（请求由 fetch 桩接住）。
beforeEach(() => localStorage.setItem("yugc:dev-data-source", "live"));
afterEach(() => {
  cleanup();
  localStorage.clear();
  vi.unstubAllGlobals();
});

const json = (body: unknown) => new Response(JSON.stringify(body), { status: 200, headers: { "content-type": "application/json" } });
const HOUR = 3600_000;
const DAY = 24 * HOUR;
const NOW = Date.now();

const INTERNAL = {
  id: "c1", name: "极客班算法挑战赛", kind: "internal", start_at: NOW + 6 * DAY, end_at: NOW + 6 * DAY + 6 * HOUR,
  signup_deadline: NOW + 4 * DAY, url: null, description: "班内选拔", status: "registering",
};
const EXTERNAL = {
  id: "c2", name: "蓝桥杯省赛", kind: "external", start_at: NOW + 20 * DAY, end_at: NOW + 20 * DAY + 4 * HOUR,
  signup_deadline: NOW + 12 * DAY, url: "https://dasai.lanqiao.cn/", description: "以学校为单位报名", status: "registering",
};

it("列出比赛，外部比赛给官方链接，内部比赛不显示链接", async () => {
  vi.stubGlobal("fetch", vi.fn(async () => json({ competitions: [INTERNAL, EXTERNAL] })));
  render(<Competitions />);
  await waitFor(() => expect(screen.getByText("极客班算法挑战赛")).toBeTruthy());
  expect(screen.getByText("蓝桥杯省赛")).toBeTruthy();
  const link = screen.getByRole("link", { name: /查看官方页面/ });
  expect(link.getAttribute("href")).toBe("https://dasai.lanqiao.cn/");
  expect(link.getAttribute("rel")).toContain("noopener");
  expect(link.getAttribute("rel")).toContain("noreferrer");
  // 只有外部那条有链接；内部那条不给假按钮
  expect(screen.getAllByRole("link")).toHaveLength(1);
  expect(fetch).toHaveBeenCalledWith(COMPETITIONS_URL, expect.objectContaining({ signal: expect.any(AbortSignal) }));
});

it("按内部 / 外部筛选，筛空时说清这个类型下没有", async () => {
  vi.stubGlobal("fetch", vi.fn(async () => json({ competitions: [INTERNAL, EXTERNAL] })));
  render(<Competitions />);
  await waitFor(() => expect(screen.getByText("极客班算法挑战赛")).toBeTruthy());

  fireEvent.click(screen.getByRole("button", { name: "内部" }));
  expect(screen.getByText("极客班算法挑战赛")).toBeTruthy();
  expect(screen.queryByText("蓝桥杯省赛")).toBeNull();

  fireEvent.click(screen.getByRole("button", { name: "外部" }));
  expect(screen.getByText("蓝桥杯省赛")).toBeTruthy();
  expect(screen.queryByText("极客班算法挑战赛")).toBeNull();
  // 当前选中项给读屏也报出来
  expect(screen.getByRole("button", { name: "外部" }).getAttribute("aria-pressed")).toBe("true");
});

it("一条都没有和读不到是两句不同的话", async () => {
  vi.stubGlobal("fetch", vi.fn(async () => json({ competitions: [] })));
  const empty = render(<Competitions />);
  await waitFor(() => expect(screen.getByText("现在还没有登记的比赛。")).toBeTruthy());
  empty.unmount();

  vi.stubGlobal("fetch", vi.fn(async () => new Response("down", { status: 502 })));
  render(<Competitions />);
  await waitFor(() => expect(screen.getByText(/没加载出来/)).toBeTruthy());
  expect(screen.queryByText("现在还没有登记的比赛。")).toBeNull();
});

it("窗口关掉就取消请求", () => {
  let signal: AbortSignal | undefined;
  vi.stubGlobal("fetch", vi.fn((_url: string, init?: RequestInit) => {
    signal = init?.signal ?? undefined;
    return new Promise<Response>(() => {});
  }));
  const view = render(<Competitions />);
  expect(signal?.aborted).toBe(false);
  view.unmount();
  expect(signal?.aborted).toBe(true);
});

it("状态由时间算出来，截止当天整天都还算报名中", () => {
  const at = (start: number, end: number, deadline: number | null) => ({ start_at: start, end_at: end, signup_deadline: deadline });
  expect(statusAt(at(NOW + HOUR, NOW + 2 * HOUR, NOW + 30 * 60_000), NOW)).toBe("registering");
  expect(statusAt(at(NOW + HOUR, NOW + 2 * HOUR, null), NOW)).toBe("upcoming");
  expect(statusAt(at(NOW + HOUR, NOW + 2 * HOUR, NOW - 1), NOW)).toBe("closed");
  expect(statusAt(at(NOW - HOUR, NOW + HOUR, NOW - 1), NOW)).toBe("ongoing");
  // 已开场但还能补报：报名中压过进行中
  expect(statusAt(at(NOW - HOUR, NOW + HOUR, NOW + HOUR), NOW)).toBe("registering");
  expect(statusAt(at(NOW - 2 * HOUR, NOW - 1, null), NOW)).toBe("ended");
});

it("展示的状态按本地时间算，服务端给的 status 不作数", async () => {
  // 服务端这条说「报名中」，但时间戳说已经结束了：以时间戳为准
  vi.stubGlobal("fetch", vi.fn(async () => json({ competitions: [{ ...INTERNAL, status: "registering", start_at: NOW - 2 * HOUR, end_at: NOW - HOUR, signup_deadline: NOW - 3 * HOUR }] })));
  const view = render(<Competitions />);
  await waitFor(() => expect(screen.getByText("极客班算法挑战赛")).toBeTruthy());
  expect(screen.getByText("已结束")).toBeTruthy();
  expect(screen.queryByText("报名中")).toBeNull();
  view.unmount();
});

it("窗口开着时每 60 秒按时间重算：到点后不用刷新就变成已结束", async () => {
  vi.useFakeTimers();
  try {
    vi.setSystemTime(NOW);
    vi.stubGlobal("fetch", vi.fn(async () => json({ competitions: [{ ...INTERNAL, start_at: NOW + 30 * 60_000, end_at: NOW + 45 * 60_000, signup_deadline: NOW + 10 * 60_000 }, { ...EXTERNAL, signup_deadline: null }] })));
    render(<Competitions />);
    await vi.waitFor(() => expect(screen.getByText("报名中")).toBeTruthy());
    expect(screen.getAllByRole("listitem")[0].textContent).toContain(INTERNAL.name);
    // 时间推过结束点，再等一次重算
    vi.setSystemTime(NOW + 60 * 60_000);
    await vi.advanceTimersByTimeAsync(60_000);
    await vi.waitFor(() => expect(screen.getByText("已结束")).toBeTruthy());
    expect(screen.getAllByRole("listitem")[0].textContent).toContain(EXTERNAL.name);
  } finally {
    vi.useRealTimers();
  }
});

it("接口给的条目缺字段就丢掉，链接只收 https，认不出的状态按时间补", () => {
  expect(readCompetition({ id: "c1", name: "A", start_at: 1, end_at: 2 })).toMatchObject({ id: "c1", kind: "internal", url: null, status: "ended" });
  expect(readCompetition({ name: "没有 id", start_at: 1, end_at: 2 })).toBeNull();
  expect(readCompetition({ id: "c1", start_at: 1, end_at: 2 })).toBeNull();
  expect(readCompetition({ id: "c1", name: "A", start_at: 1 })).toBeNull();
  expect(readCompetition("nope")).toBeNull();
  // 所有比赛都能挂自己的官网链接；只收 https
  expect(readCompetition({ id: "c1", name: "A", start_at: 1, end_at: 2, url: "https://example.test/x" })!.url).toBe("https://example.test/x");
  expect(readCompetition({ id: "c2", name: "B", kind: "external", start_at: 1, end_at: 2, url: "http://example.test/x" })!.url).toBeNull();
  expect(readCompetition({ id: "c2", name: "B", kind: "external", start_at: 1, end_at: 2, url: "https://example.test/x" })!.url).toBe("https://example.test/x");
  expect(readCompetitions({ competitions: [{ id: "c1", name: "A", start_at: 1, end_at: 2 }, "junk", null] })).toHaveLength(1);
  expect(() => readCompetitions(null)).toThrow();
});

it("接口结构损坏时显示加载失败，不冒充空列表", async () => {
  vi.stubGlobal("fetch", vi.fn(async () => json({ error: "unexpected_response" })));
  render(<Competitions />);
  await waitFor(() => expect(screen.getByText(/没加载出来/)).toBeTruthy());
  expect(screen.queryByText("现在还没有登记的比赛。")).toBeNull();
});

it("不显示无法表示的日期或无法解析的官方链接", () => {
  expect(readCompetition({ ...INTERNAL, start_at: 1e30, end_at: 1e31 })).toBeNull();
  expect(readCompetition({ ...INTERNAL, end_at: 8_640_000_000_000_000 })).toBeNull();
  expect(readCompetition({ ...INTERNAL, signup_deadline: 1e30 })?.signup_deadline).toBeNull();
  for (const url of ["https://?", "https://#", "https://[bad-host]"]) {
    expect(readCompetition({ ...INTERNAL, url })?.url).toBeNull();
  }
});

it("按北京时间显示日期，跨零点算作后一天", () => {
  expect(beijingDay(Date.parse("2026-10-15T16:30:00Z"))).toBe("2026-10-16");
  expect(beijingDayEdge("2026-10-16", "start")).toBe(Date.parse("2026-10-15T16:00:00Z"));
  expect(beijingDayEdge("2026-10-16", "end")).toBe(Date.parse("2026-10-16T15:59:59.999Z"));
  expect(beijingDayEdge("2026-02-30", "start")).toBeNull();
  expect(shortDay(Date.parse("2026-10-15T16:30:00Z"), Date.parse("2026-10-01T00:00:00Z"))).toBe("10-16");
});

it("跨年日期保留年份，并按北京时间判断当前年", () => {
  const beforeNewYear = Date.parse("2026-12-31T15:59:59Z");
  const afterNewYear = Date.parse("2026-12-31T16:00:00Z");
  expect(shortDay(Date.parse("2025-10-20T00:00:00+08:00"), beforeNewYear)).toBe("2025-10-20");
  expect(shortDay(afterNewYear, beforeNewYear)).toBe("2027-01-01");
  expect(shortDay(afterNewYear, afterNewYear)).toBe("01-01");
  expect(shortDay(beforeNewYear, afterNewYear)).toBe("2026-12-31");
});

it("同一天的比赛只写一个日期，跨天才写「起，到」", () => {
  const now = Date.parse("2026-10-01T00:00:00+08:00");
  const at = (text: string) => Date.parse(`${text}+08:00`);
  expect(dayRange(at("2026-10-26T00:00:00"), at("2026-10-26T23:59:59.999"), now)).toBe("10-26");
  expect(dayRange(at("2026-10-26T00:00:00"), at("2026-10-28T23:59:59.999"), now)).toBe("10-26 起，到 10-28");
  // UTC 里跨了一天，北京时间仍是同一天：按北京时间算
  expect(dayRange(Date.parse("2026-10-25T16:00:00Z"), Date.parse("2026-10-26T15:59:59.999Z"), now)).toBe("10-26");
  expect(dayRange(at("2026-12-31T00:00:00"), at("2027-01-01T23:59:59.999"), now)).toBe("12-31 起，到 2027-01-01");
});

it("窗口里一天内的比赛不写成「某日起，到同一日」", async () => {
  const day = beijingDay(NOW + 6 * DAY);
  const oneDay = { ...INTERNAL, start_at: beijingDayEdge(day, "start") as number, end_at: beijingDayEdge(day, "end") as number };
  vi.stubGlobal("fetch", vi.fn(async () => json({ competitions: [oneDay] })));
  render(<Competitions />);
  await waitFor(() => expect(screen.getByText("极客班算法挑战赛")).toBeTruthy());
  expect(screen.getByText(shortDay(oneDay.start_at))).toBeTruthy();
  expect(screen.queryByText(/起，到/)).toBeNull();
});

// 服务端（competitionStatus）与官网（statusAt）各写了一份同一套口径，这里按 org 默认值那条先例逐点比对：
// 任一侧改了边界，这条会红，不会出现「官网说报名中、控制台说已截止」的静默分叉。
it("官网的 statusAt 与服务端的 competitionStatus 逐点一致", () => {
  const NOW = 1_800_000_000_000;
  const HOUR = 3600_000;
  const rows = [
    { start_at: NOW + HOUR, end_at: NOW + 2 * HOUR, signup_deadline: NOW + 30 * 60_000 },
    { start_at: NOW + HOUR, end_at: NOW + 2 * HOUR, signup_deadline: null },
    { start_at: NOW + HOUR, end_at: NOW + 2 * HOUR, signup_deadline: NOW - 1 },
    { start_at: NOW - HOUR, end_at: NOW + HOUR, signup_deadline: NOW - 1 },
    { start_at: NOW - HOUR, end_at: NOW + HOUR, signup_deadline: NOW + HOUR },
    { start_at: NOW - 2 * HOUR, end_at: NOW - 1, signup_deadline: null },
    // 边界本身：截止与结束那一刻
    { start_at: NOW + HOUR, end_at: NOW + 2 * HOUR, signup_deadline: NOW },
    { start_at: NOW, end_at: NOW + HOUR, signup_deadline: NOW + 1 },
    { start_at: NOW - HOUR, end_at: NOW, signup_deadline: null },
  ];
  for (const row of rows) {
    expect(statusAt(row, NOW)).toBe(competitionStatus(row, NOW));
  }
});

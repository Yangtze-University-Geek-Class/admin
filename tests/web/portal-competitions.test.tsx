// @vitest-environment jsdom
// 比赛窗口（#238）：列表、筛选、外部链接与内部比赛不放按钮、读不到时的说法、以及纯函数的读入与日期换算。
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { Competitions } from "../../app/web/sites/portal/components/os/Windows";
import { COMPETITIONS_URL, beijingDay, beijingDayEdge, readCompetition, readCompetitions, shortDay, statusAt } from "../../app/web/sites/portal/lib/competitions";

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
  expect(link.getAttribute("rel")).toBe("noreferrer");
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
  expect(statusAt(at(NOW + HOUR, NOW + 2 * HOUR, null), NOW)).toBe("registering");
  expect(statusAt(at(NOW + HOUR, NOW + 2 * HOUR, NOW - 1), NOW)).toBe("closed");
  expect(statusAt(at(NOW - HOUR, NOW + HOUR, NOW - 1), NOW)).toBe("ongoing");
  // 已开场但还能补报：报名中压过进行中
  expect(statusAt(at(NOW - HOUR, NOW + HOUR, NOW + HOUR), NOW)).toBe("registering");
  expect(statusAt(at(NOW - 2 * HOUR, NOW - 1, null), NOW)).toBe("ended");
});

it("接口给的条目缺字段就丢掉，链接只收 https，认不出的状态按时间补", () => {
  expect(readCompetition({ id: "c1", name: "A", start_at: 1, end_at: 2 })).toMatchObject({ id: "c1", kind: "internal", url: null, status: "ended" });
  expect(readCompetition({ name: "没有 id", start_at: 1, end_at: 2 })).toBeNull();
  expect(readCompetition({ id: "c1", start_at: 1, end_at: 2 })).toBeNull();
  expect(readCompetition({ id: "c1", name: "A", start_at: 1 })).toBeNull();
  expect(readCompetition("nope")).toBeNull();
  // 内部比赛即使带了链接也不给（只在外部比赛上渲染链接）
  expect(readCompetition({ id: "c1", name: "A", start_at: 1, end_at: 2, url: "https://example.test/x" })!.url).toBeNull();
  expect(readCompetition({ id: "c2", name: "B", kind: "external", start_at: 1, end_at: 2, url: "http://example.test/x" })!.url).toBeNull();
  expect(readCompetition({ id: "c2", name: "B", kind: "external", start_at: 1, end_at: 2, url: "https://example.test/x" })!.url).toBe("https://example.test/x");
  expect(readCompetitions({ competitions: [{ id: "c1", name: "A", start_at: 1, end_at: 2 }, "junk", null] })).toHaveLength(1);
  expect(readCompetitions(null)).toEqual([]);
});

it("按北京时间显示日期，跨零点算作后一天", () => {
  expect(beijingDay(Date.parse("2026-10-15T16:30:00Z"))).toBe("2026-10-16");
  expect(beijingDayEdge("2026-10-16", "start")).toBe(Date.parse("2026-10-15T16:00:00Z"));
  expect(beijingDayEdge("2026-10-16", "end")).toBe(Date.parse("2026-10-16T15:59:59.999Z"));
  expect(beijingDayEdge("2026-02-30", "start")).toBeNull();
  expect(shortDay(Date.parse("2026-10-15T16:30:00Z"))).toBe("10-16");
});

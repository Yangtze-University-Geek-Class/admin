// @vitest-environment jsdom
// 比赛窗口（#265）：桌面列表加详情、搜索与筛选、键盘换比赛、手机进出详情、加载 / 没有 / 筛空 / 读不到四种状态，
// 以及读入、北京时间、文案与赛程这些纯函数。
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import CompetitionsApp, { type PhoneNav } from "../../app/web/sites/portal/components/os/competitions/CompetitionsApp";
import { COMPETITIONS_URL, beijingDay, beijingDayEdge, dayRange, NO_SIGNUP, readCompetition, readCompetitions, shortDay, statusAt } from "../../app/web/sites/portal/lib/competitions";
import {
  applyFilter, cardWhen, competitionAction, dayLabel, deadlineFact, deadlineLabel, matchesQuery, NO_FILTER, pointLabel,
  scheduleFact, scheduleSteps, signupFact, siteHost, statusHint,
} from "../../app/web/sites/portal/lib/competitionLabels";
import { competitionStatus } from "../../app/server/src/lib/competition-store";

// 开发态默认走只读样板数据；这里切到真实数据源，让窗口真的去请求列表（请求由 fetch 桩接住）。
beforeEach(() => localStorage.setItem("yugc:dev-data-source", "live"));
afterEach(() => {
  cleanup();
  localStorage.clear();
  vi.unstubAllGlobals();
});

const json = (body: unknown) => new Response(JSON.stringify(body), { status: 200, headers: { "content-type": "application/json" } });
const serve = (...items: unknown[]) => vi.stubGlobal("fetch", vi.fn(async () => json({ competitions: items })));
const HOUR = 3600_000;
const DAY = 24 * HOUR;
const NOW = Date.now();

const INTERNAL = {
  id: "c1", name: "极客班算法挑战赛", kind: "internal", start_at: NOW + 6 * DAY, end_at: NOW + 6 * DAY + 6 * HOUR,
  signup_deadline: NOW + 4 * DAY, url: null, description: "班内选拔，前五名代表学院参加校赛", status: "registering",
};
const EXTERNAL = {
  id: "c2", name: "蓝桥杯省赛", kind: "external", start_at: NOW + 20 * DAY, end_at: NOW + 20 * DAY + 4 * HOUR,
  signup_deadline: NOW + 12 * DAY, url: "https://dasai.lanqiao.cn/", description: "以学校为单位报名", status: "registering",
};
const UPCOMING = {
  id: "c3", name: "数学建模竞赛", kind: "external", start_at: NOW + 30 * DAY, end_at: NOW + 32 * DAY,
  signup_deadline: null, url: "https://www.mcm.edu.cn/", description: "", status: "upcoming",
};
const ENDED = {
  id: "c4", name: "春季编程挑战赛", kind: "internal", start_at: NOW - 30 * DAY, end_at: NOW - 30 * DAY + 3 * HOUR,
  signup_deadline: NOW - 35 * DAY, url: null, description: "上学期的练习赛", status: "ended",
};

const list = () => screen.getByRole("list", { name: "比赛列表" });
const card = (name: string) => within(list()).getByRole("button", { name: new RegExp(name) });
const detailHeading = () => screen.getByRole("heading", { level: 3 });
const chip = (name: RegExp | string) => within(screen.getByRole("group", { name: "筛选比赛" })).getByRole("button", { name });

describe("桌面：左边列表、右边详情", () => {
  it("默认选中第一场并显示详情；点别的卡片换详情；外部比赛报名中给「去官网报名」，内部比赛不放点不动的按钮", async () => {
    serve(INTERNAL, EXTERNAL);
    render(<CompetitionsApp />);
    await waitFor(() => expect(card(INTERNAL.name)).toBeTruthy());
    expect(card(INTERNAL.name).getAttribute("aria-current")).toBe("true");
    expect(card(EXTERNAL.name).getAttribute("aria-current")).toBeNull();
    expect(detailHeading().textContent).toBe(INTERNAL.name);
    const internal = screen.getByRole("region", { name: INTERNAL.name });
    expect(within(internal).getByText("报名中")).toBeTruthy();
    expect(within(internal).getByText("内部赛")).toBeTruthy();
    expect(within(internal).getByText(/在线报名开放前，按组织者的通知报名。/)).toBeTruthy();
    // 内部比赛没有官网：详情里一个按钮、一个链接都没有（报名、组队这些还做不了的入口不放）
    expect(within(internal).queryAllByRole("link")).toHaveLength(0);
    expect(within(internal).queryAllByRole("button")).toHaveLength(0);
    expect(screen.queryAllByRole("button").filter((button) => /组队|队伍|人数|立即报名|我要报名/.test(button.textContent ?? ""))).toEqual([]);

    fireEvent.click(card(EXTERNAL.name));
    expect(card(EXTERNAL.name).getAttribute("aria-current")).toBe("true");
    const external = screen.getByRole("region", { name: EXTERNAL.name });
    // 官网链接在 Hero 的标签里，主按钮是 Hero 里的「去官网报名」（手机上主按钮改在底部操作条）
    const hero = external.querySelector<HTMLElement>(".pt-cx-hero")!;
    const go = within(external).getByRole("link", { name: /去官网报名/ });
    expect(go.closest(".pt-cx-hero")).toBe(hero);
    expect(go.classList.contains("is-hero")).toBe(true);
    expect(go.getAttribute("href")).toBe(EXTERNAL.url);
    expect(go.getAttribute("target")).toBe("_blank");
    expect(go.getAttribute("rel")).toContain("noopener");
    expect(go.getAttribute("rel")).toContain("noreferrer");
    const site = within(external).getByRole("link", { name: /dasai\.lanqiao\.cn/ });
    expect(site.classList.contains("pt-cx-hero-tag")).toBe(true);
    expect(site.closest(".pt-cx-hero")).toBe(hero);
    expect(site.getAttribute("rel")).toBe("noopener noreferrer");
    expect(within(hero).getByText("外部赛")).toBeTruthy();
    expect(within(hero).getByText("报名中")).toBeTruthy();
    // 外部比赛的链接都指向登记的官网，没有别的去处
    expect(within(external).getAllByRole("link").map((link) => link.getAttribute("href"))).toEqual([EXTERNAL.url, EXTERNAL.url]);
    expect(within(external).getByText("在比赛官网报名")).toBeTruthy();
    expect(fetch).toHaveBeenCalledWith(COMPETITIONS_URL, expect.objectContaining({ signal: expect.any(AbortSignal) }));
  });

  it("「全部 / 可报名」带数量，内部 / 外部可叠加；搜索名称或介绍；筛空时说清并能一键清除", async () => {
    serve(INTERNAL, EXTERNAL, UPCOMING, ENDED);
    render(<CompetitionsApp />);
    await waitFor(() => expect(card(INTERNAL.name)).toBeTruthy());
    const names = () => within(list()).getAllByRole("button").map((button) => button.querySelector("b")?.textContent);
    expect(names()).toEqual([INTERNAL.name, EXTERNAL.name, UPCOMING.name, ENDED.name]);
    expect(chip(/^全部/).textContent).toContain("4");
    expect(chip(/^可报名/).textContent).toContain("2");
    expect(chip(/^全部/).getAttribute("aria-pressed")).toBe("true");

    fireEvent.click(chip(/^可报名/));
    expect(names()).toEqual([INTERNAL.name, EXTERNAL.name]);
    expect(chip(/^可报名/).getAttribute("aria-pressed")).toBe("true");
    expect(chip(/^全部/).getAttribute("aria-pressed")).toBe("false");
    fireEvent.click(chip("外部"));
    expect(names()).toEqual([EXTERNAL.name]);
    // 选中的跟着换：原来选中的被筛掉了，详情显示剩下的第一场
    expect(detailHeading().textContent).toBe(EXTERNAL.name);
    expect(screen.getByText("筛出 1 场比赛")).toBeTruthy();

    fireEvent.click(chip(/^全部/));
    expect(names()).toHaveLength(4);
    expect(chip("外部").getAttribute("aria-pressed")).toBe("false");
    expect(chip(/^可报名/).getAttribute("aria-pressed")).toBe("false");

    const search = screen.getByRole("searchbox", { name: "搜索比赛" });
    fireEvent.change(search, { target: { value: "选拔" } });
    expect(names()).toEqual([INTERNAL.name]);
    fireEvent.change(search, { target: { value: "没有这场比赛" } });
    expect(screen.queryByRole("list", { name: "比赛列表" })).toBeNull();
    expect(screen.getByText("没有符合条件的比赛")).toBeTruthy();
    expect(screen.getByText("换个关键词或筛选条件，或者清除筛选看全部 4 场。")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "清除筛选" }));
    expect(names()).toHaveLength(4);
    expect((screen.getByRole("searchbox", { name: "搜索比赛" }) as HTMLInputElement).value).toBe("");
  });

  it("键盘：列表只有选中那张在 Tab 顺序里，上下键、Home、End 换比赛，焦点跟着走", async () => {
    serve(INTERNAL, EXTERNAL, UPCOMING);
    render(<CompetitionsApp />);
    await waitFor(() => expect(card(INTERNAL.name)).toBeTruthy());
    const cards = () => within(list()).getAllByRole("button");
    expect(cards().map((button) => button.tabIndex)).toEqual([0, -1, -1]);
    cards()[0].focus();
    fireEvent.keyDown(cards()[0], { key: "ArrowDown" });
    expect(document.activeElement).toBe(card(EXTERNAL.name));
    expect(card(EXTERNAL.name).getAttribute("aria-current")).toBe("true");
    expect(detailHeading().textContent).toBe(EXTERNAL.name);
    expect(cards().map((button) => button.tabIndex)).toEqual([-1, 0, -1]);
    fireEvent.keyDown(document.activeElement!, { key: "End" });
    expect(document.activeElement).toBe(card(UPCOMING.name));
    fireEvent.keyDown(document.activeElement!, { key: "ArrowDown" });
    expect(document.activeElement).toBe(card(UPCOMING.name));
    fireEvent.keyDown(document.activeElement!, { key: "Home" });
    expect(document.activeElement).toBe(card(INTERNAL.name));
    fireEvent.keyDown(document.activeElement!, { key: "ArrowUp" });
    expect(document.activeElement).toBe(card(INTERNAL.name));
    expect(detailHeading().textContent).toBe(INTERNAL.name);
  });
});

describe("手机：列表点进详情再返回", () => {
  it("进详情借标题栏返回键回「比赛列表」，焦点给标题；返回后焦点回到那张卡片；Esc 也能返回", async () => {
    serve(INTERNAL, EXTERNAL);
    const nav = vi.fn<(value: PhoneNav | null) => void>();
    render(<CompetitionsApp phone onPhoneNav={nav} />);
    await waitFor(() => expect(card(EXTERNAL.name)).toBeTruthy());
    // 列表里不标选中、每张卡片都能 Tab 到；搜索框不让窗口一打开就抢焦点（会弹键盘）
    expect(screen.queryByRole("heading", { level: 3 })).toBeNull();
    expect(within(list()).getAllByRole("button").map((button) => [button.tabIndex, button.getAttribute("aria-current")])).toEqual([[0, null], [0, null]]);
    expect(screen.getByRole("searchbox", { name: "搜索比赛" }).hasAttribute("data-no-autofocus")).toBe(true);
    expect(nav).not.toHaveBeenCalledWith(expect.objectContaining({ backText: "比赛列表" }));

    fireEvent.click(card(EXTERNAL.name));
    expect(detailHeading().textContent).toBe(EXTERNAL.name);
    expect(document.activeElement).toBe(detailHeading());
    expect(screen.queryByRole("list", { name: "比赛列表" })).toBeNull();
    expect(screen.queryByRole("searchbox")).toBeNull();
    // 手机上主按钮在底部操作条（拇指够得着），Hero 里只放官网链接
    const go = screen.getByRole("link", { name: /去官网报名/ });
    expect(go.closest(".pt-cx-act")).not.toBeNull();
    expect(go.closest(".pt-cx-hero")).toBeNull();
    expect(screen.getByRole("link", { name: /dasai\.lanqiao\.cn/ }).classList.contains("pt-cx-hero-tag")).toBe(true);
    const back = nav.mock.lastCall?.[0];
    expect(back).toMatchObject({ backText: "比赛列表", backLabel: "返回比赛列表" });

    act(() => back!.onBack());
    expect(screen.queryByRole("heading", { level: 3 })).toBeNull();
    expect(document.activeElement).toBe(card(EXTERNAL.name));
    expect(nav.mock.lastCall?.[0]).toBeNull();

    fireEvent.click(card(INTERNAL.name));
    expect(detailHeading().textContent).toBe(INTERNAL.name);
    fireEvent.keyDown(detailHeading(), { key: "Escape" });
    expect(screen.queryByRole("heading", { level: 3 })).toBeNull();
    expect(document.activeElement).toBe(card(INTERNAL.name));
  });
});

describe("加载中、没有比赛、筛空、读不到", () => {
  it("加载中给读屏报「正在读取比赛…」，窗口关掉就取消请求", () => {
    let signal: AbortSignal | undefined;
    vi.stubGlobal("fetch", vi.fn((_url: string, init?: RequestInit) => {
      signal = init?.signal ?? undefined;
      return new Promise<Response>(() => {});
    }));
    const view = render(<CompetitionsApp />);
    expect(screen.getByRole("status").textContent).toBe("正在读取比赛…");
    expect(view.container.querySelector(".pt-cx")?.getAttribute("aria-busy")).toBe("true");
    expect(signal?.aborted).toBe(false);
    view.unmount();
    expect(signal?.aborted).toBe(true);
  });

  it("一场都没有时说清比赛从哪来，不给「重试」", async () => {
    serve();
    render(<CompetitionsApp />);
    await waitFor(() => expect(screen.getByText("现在还没有登记的比赛")).toBeTruthy());
    expect(screen.getByText(/比赛由组织者在控制台登记/)).toBeTruthy();
    expect(screen.queryByRole("button", { name: /重试/ })).toBeNull();
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("读不到时说没加载出来并给「重试」，重试再请求一次；接口结构坏了也不冒充空列表", async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response("down", { status: 502 }))
      .mockResolvedValueOnce(json({ competitions: [INTERNAL] }));
    vi.stubGlobal("fetch", fetchMock);
    render(<CompetitionsApp />);
    const alert = await screen.findByRole("alert");
    expect(alert.textContent).toContain("比赛列表没加载出来");
    expect(screen.queryByText("现在还没有登记的比赛")).toBeNull();
    fireEvent.click(within(alert).getByRole("button", { name: /重试/ }));
    await waitFor(() => expect(card(INTERNAL.name)).toBeTruthy());
    expect(fetchMock).toHaveBeenCalledTimes(2);
    cleanup();

    vi.stubGlobal("fetch", vi.fn(async () => json({ error: "unexpected_response" })));
    render(<CompetitionsApp />);
    expect((await screen.findByRole("alert")).textContent).toContain("没加载出来");
    expect(screen.queryByText("现在还没有登记的比赛")).toBeNull();
  });
});

describe("状态按本地时间算", () => {
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
    serve({ ...INTERNAL, status: "registering", start_at: NOW - 2 * HOUR, end_at: NOW - HOUR, signup_deadline: NOW - 3 * HOUR });
    render(<CompetitionsApp />);
    await waitFor(() => expect(card(INTERNAL.name)).toBeTruthy());
    expect(within(card(INTERNAL.name)).getByText("已结束")).toBeTruthy();
    expect(screen.queryByText("报名中")).toBeNull();
  });

  it("窗口开着时每 60 秒按时间重算：到点后不用刷新就变成已结束、排到后面", async () => {
    vi.useFakeTimers();
    try {
      vi.setSystemTime(NOW);
      serve({ ...INTERNAL, start_at: NOW + 30 * 60_000, end_at: NOW + 45 * 60_000, signup_deadline: NOW + 10 * 60_000 }, { ...EXTERNAL, signup_deadline: null });
      render(<CompetitionsApp />);
      await vi.waitFor(() => expect(within(card(INTERNAL.name)).getByText("报名中")).toBeTruthy());
      expect(within(list()).getAllByRole("button")[0].textContent).toContain(INTERNAL.name);
      // 时间推过结束点，再等一次重算
      vi.setSystemTime(NOW + 60 * 60_000);
      await vi.advanceTimersByTimeAsync(60_000);
      await vi.waitFor(() => expect(within(card(INTERNAL.name)).getByText("已结束")).toBeTruthy());
      expect(within(list()).getAllByRole("button")[0].textContent).toContain(EXTERNAL.name);
    } finally {
      vi.useRealTimers();
    }
  });

  // 服务端（competitionStatus）与官网（statusAt）各写了一份同一套口径，这里按 org 默认值那条先例逐点比对：
  // 任一侧改了边界，这条会红，不会出现「官网说报名中、控制台说已截止」的静默分叉。
  it("官网的 statusAt 与服务端的 competitionStatus 逐点一致", () => {
    const NOW = 1_800_000_000_000;
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
});

describe("读入与北京时间", () => {
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
    // 新的 signup 字段（#239）：内部赛开了在线报名才认，外部赛一律在官网报名
    const signup = { enabled: true, participation: "team", team_min: 1, team_max: 3, scoring: "contribution" };
    expect(readCompetition({ ...INTERNAL, signup })?.signup).toEqual(signup);
    expect(readCompetition(INTERNAL)?.signup).toEqual(NO_SIGNUP);
    expect(readCompetition({ ...EXTERNAL, signup })?.signup).toEqual(NO_SIGNUP);
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

  it("同一天的比赛只写一个日期，跨天才写「10-26 至 10-28」", () => {
    const now = Date.parse("2026-10-01T00:00:00+08:00");
    const at = (text: string) => Date.parse(`${text}+08:00`);
    expect(dayRange(at("2026-10-26T00:00:00"), at("2026-10-26T23:59:59.999"), now)).toBe("10-26");
    expect(dayRange(at("2026-10-26T00:00:00"), at("2026-10-28T23:59:59.999"), now)).toBe("10-26 至 10-28");
    // UTC 里跨了一天，北京时间仍是同一天：按北京时间算
    expect(dayRange(Date.parse("2026-10-25T16:00:00Z"), Date.parse("2026-10-26T15:59:59.999Z"), now)).toBe("10-26");
    expect(dayRange(at("2026-12-31T00:00:00"), at("2027-01-01T23:59:59.999"), now)).toBe("12-31 至 2027-01-01");
  });

  it("窗口里一整天的比赛写「全天」，赛程合成一个「比赛日」", async () => {
    const day = beijingDay(NOW + 6 * DAY);
    serve({ ...INTERNAL, start_at: beijingDayEdge(day, "start"), end_at: beijingDayEdge(day, "end") });
    render(<CompetitionsApp />);
    await waitFor(() => expect(card(INTERNAL.name)).toBeTruthy());
    const detail = screen.getByRole("region", { name: INTERNAL.name });
    expect(within(detail).getByText("全天")).toBeTruthy();
    expect(within(detail).getByText("比赛日")).toBeTruthy();
    expect(within(detail).queryByText(/ 至 /)).toBeNull();
  });
});

describe("日期与文案（北京时间 2026-10-20 周二 10:00）", () => {
  const at = (text: string) => Date.parse(`${text}+08:00`);
  const now = at("2026-10-20T10:00:00");
  const start = (date: string) => at(`${date}T00:00:00`);
  const end = (date: string) => at(`${date}T23:59:59.999`);

  it("日期带星期，截止写到分钟，整天边界上的时间点不写钟点", () => {
    expect(dayLabel(start("2026-10-25"), now)).toBe("10-25（周日）");
    expect(deadlineLabel(end("2026-10-25"), now)).toBe("10-25（周日）23:59");
    expect(pointLabel(start("2026-10-26"), now)).toBe("10-26（周一）");
    expect(pointLabel(end("2026-10-26"), now)).toBe("10-26（周一）");
    expect(pointLabel(at("2026-10-26T09:30:00"), now)).toBe("10-26（周一）09:30");
    expect(dayLabel(start("2027-01-02"), now)).toBe("2027-01-02（周六）");
  });

  it("状态旁边的一句：还剩几天、几天后开赛、几天后结束", () => {
    const item = (status: "registering" | "upcoming" | "closed" | "ongoing" | "ended", deadline: number | null) => ({ status, start_at: start("2026-10-23"), end_at: end("2026-10-24"), signup_deadline: deadline });
    expect(statusHint(item("registering", end("2026-10-20")), now)).toBe("今天截止");
    expect(statusHint(item("registering", end("2026-10-21")), now)).toBe("明天截止");
    expect(statusHint(item("registering", end("2026-10-25")), now)).toBe("还剩 5 天");
    expect(statusHint(item("upcoming", null), now)).toBe("3 天后开赛");
    expect(statusHint(item("closed", end("2026-10-19")), now)).toBe("3 天后开赛");
    expect(statusHint({ status: "ongoing", start_at: start("2026-10-19"), end_at: end("2026-10-20"), signup_deadline: null }, now)).toBe("今天结束");
    expect(statusHint(item("ended", null), now)).toBeNull();
  });

  it("卡片只写最要紧的那个日期", () => {
    const base = { start_at: start("2026-11-02"), end_at: end("2026-11-03"), signup_deadline: end("2026-10-25") };
    expect(cardWhen({ ...base, status: "registering" }, now)).toBe("截止 10-25（周日）");
    expect(cardWhen({ ...base, status: "closed" }, now)).toBe("11-02 开赛");
    expect(cardWhen({ ...base, status: "ongoing" }, now)).toBe("11-03 结束");
    expect(cardWhen({ ...base, status: "ended" }, now)).toBe("11-02 至 11-03");
  });

  it("三格要点：没登记截止就说以谁为准；整天写「全天」「共几天」；报名方式按内外部和有无官网", () => {
    expect(deadlineFact({ kind: "internal", signup_deadline: null }, now)).toEqual({ main: "没有登记", sub: "以组织者通知为准" });
    expect(deadlineFact({ kind: "external", signup_deadline: null }, now)).toEqual({ main: "没有登记", sub: "以比赛官网为准" });
    expect(deadlineFact({ kind: "internal", signup_deadline: end("2026-10-25") }, now)).toEqual({ main: "10-25（周日）23:59", sub: "北京时间" });
    expect(deadlineFact({ kind: "internal", signup_deadline: end("2026-10-19") }, now).sub).toBe("已截止 · 北京时间");
    expect(scheduleFact(start("2026-10-26"), end("2026-10-26"), now)).toEqual({ main: "10-26（周一）", sub: "全天" });
    expect(scheduleFact(at("2026-10-26T09:00:00"), at("2026-10-26T12:00:00"), now)).toEqual({ main: "10-26（周一）", sub: "09:00 至 12:00" });
    expect(scheduleFact(start("2026-10-26"), end("2026-10-28"), now)).toEqual({ main: "10-26 至 10-28", sub: "共 3 天" });
    expect(scheduleFact(at("2026-10-26T09:00:00"), at("2026-10-27T18:00:00"), now)).toEqual({ main: "10-26 至 10-27", sub: "09:00 开始 · 18:00 结束" });
    expect(signupFact({ kind: "external", url: "https://www.mcm.edu.cn/" })).toEqual({ main: "在比赛官网报名", sub: "mcm.edu.cn" });
    expect(signupFact({ kind: "external", url: null })).toEqual({ main: "按主办方通知报名", sub: "组织者还没登记官网" });
    expect(signupFact({ kind: "internal", url: null })).toEqual({ main: "按组织者通知报名", sub: "在线报名还没开放" });
    expect(siteHost("https://dasai.lanqiao.cn/web")).toBe("dasai.lanqiao.cn");
  });

  it("赛程按时间排，过去的标已过；截止与结束那一刻还不算过去，和 statusAt 一致", () => {
    const item = { start_at: start("2026-10-23"), end_at: end("2026-10-24"), signup_deadline: end("2026-10-21") };
    const states = (at: number) => scheduleSteps(item, at).map((step) => `${step.label}:${step.state}`);
    expect(states(now)).toEqual(["报名截止:next", "开赛:later", "结束:later"]);
    expect(states(item.signup_deadline)).toEqual(["报名截止:next", "开赛:later", "结束:later"]);
    expect(states(item.signup_deadline + 1)).toEqual(["报名截止:done", "开赛:next", "结束:later"]);
    expect(states(item.start_at)).toEqual(["报名截止:done", "开赛:done", "结束:next"]);
    expect(states(item.end_at)).toEqual(["报名截止:done", "开赛:done", "结束:next"]);
    expect(states(item.end_at + 1)).toEqual(["报名截止:done", "开赛:done", "结束:done"]);
    for (const point of [now, item.signup_deadline, item.signup_deadline + 1, item.start_at, item.end_at, item.end_at + 1]) {
      const done = scheduleSteps(item, point).filter((step) => step.state === "done").length;
      expect({ registering: 0, closed: 1, ongoing: 2, ended: 3, upcoming: -1 }[statusAt(item, point)]).toBe(done);
    }
    const oneDay = { start_at: start("2026-10-26"), end_at: end("2026-10-26"), signup_deadline: null };
    expect(scheduleSteps(oneDay, now)).toEqual([{ key: "day", label: "比赛日", when: "10-26（周一）全天", state: "next", at: start("2026-10-26") }]);
    expect(scheduleSteps(oneDay, at("2026-10-26T15:00:00"))[0].state).toBe("now");
    expect(scheduleSteps(oneDay, end("2026-10-26") + 1)[0].state).toBe("done");
  });

  it("操作条：外部比赛报名中去官网报名，其余是查看比赛官网；没有官网不放按钮", () => {
    const base = { start_at: start("2026-11-02"), end_at: end("2026-11-03"), signup_deadline: end("2026-10-25") };
    expect(competitionAction({ ...base, status: "registering", kind: "internal", url: null }, now)).toEqual({ text: "报名截止 10-25（周日）23:59。在线报名开放前，按组织者的通知报名。", link: null });
    expect(competitionAction({ ...base, status: "registering", kind: "external", url: "https://ccpc.io/" }, now)).toEqual({
      text: "报名截止 10-25（周日）23:59，在比赛官网完成报名。", link: { href: "https://ccpc.io/", label: "去官网报名" },
    });
    expect(competitionAction({ ...base, status: "registering", kind: "external", url: null }, now).text).toBe("报名截止 10-25（周日）23:59，报名方式以主办方通知为准。");
    expect(competitionAction({ ...base, status: "closed", kind: "external", url: "https://ccpc.io/" }, now)).toEqual({
      text: "报名已截止，11-02（周一）开赛。", link: { href: "https://ccpc.io/", label: "查看比赛官网" },
    });
    expect(competitionAction({ ...base, status: "ended", kind: "internal", url: null }, now).text).toBe("比赛已于 11-03（周二）结束。");
    expect(competitionAction({ ...base, start_at: at("2026-11-02T09:30:00"), status: "upcoming", kind: "internal", url: null, signup_deadline: null }, now).text).toBe("还没登记报名截止时间，11-02（周一）09:30 开赛。");
  });

  it("搜索不分大小写、空格隔开的词都要命中；筛选条件叠加且不打乱顺序", () => {
    const items = [
      { id: "a", name: "CCPC 哈尔滨站", description: "区域赛", status: "registering" as const, kind: "external" as const },
      { id: "b", name: "校内算法赛", description: "ACM 规则", status: "upcoming" as const, kind: "internal" as const },
      { id: "c", name: "黑客松", description: "两天一夜", status: "registering" as const, kind: "internal" as const },
    ];
    expect(matchesQuery(items[0], "ccpc 哈尔滨")).toBe(true);
    expect(matchesQuery(items[0], "ccpc 上海")).toBe(false);
    expect(matchesQuery(items[1], "  acm ")).toBe(true);
    expect(applyFilter(items, NO_FILTER).map((item) => item.id)).toEqual(["a", "b", "c"]);
    expect(applyFilter(items, { ...NO_FILTER, open: true }).map((item) => item.id)).toEqual(["a", "c"]);
    expect(applyFilter(items, { ...NO_FILTER, open: true, kind: "internal" }).map((item) => item.id)).toEqual(["c"]);
    expect(applyFilter(items, { ...NO_FILTER, query: "赛" }).map((item) => item.id)).toEqual(["a", "b"]);
  });
});

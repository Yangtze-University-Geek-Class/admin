// 比赛（#238）控制台页面的纯逻辑：北京时间换算、表单校验、提交正文。不渲染组件，只测这些函数。
import { describe, expect, it, vi } from "vitest";
import { KIND_TEXT, STATUS_TEXT, beijingDate, dateEdge, emptyForm, formErrors, formFrom, formPayload, isOneDay } from "../../app/console/src/lib/competitions";
import { routeConsole } from "../../app/console/src/mock/console";
import type { CompetitionRecord } from "../../app/console/src/lib/types";
import { mockApi } from "../../app/web/shared/lib/mock-api";

/** 北京时间的某个时刻 → 时间戳（测试里手算，避免用被测函数验证自己）。 */
const bj = (iso: string) => Date.parse(`${iso}+08:00`);

describe("beijing date conversion", () => {
  it("reads a timestamp as the Beijing calendar date", () => {
    // 北京时间 2026-10-16 00:30 与 UTC 的 2026-10-15 16:30 是同一天
    expect(beijingDate(bj("2026-10-16T00:30:00"))).toBe("2026-10-16");
    expect(beijingDate(Date.parse("2026-10-15T16:30:00Z"))).toBe("2026-10-16");
    expect(beijingDate(null)).toBe("");
    expect(beijingDate(undefined)).toBe("");
  });

  it("maps a date to the start and the end of that Beijing day", () => {
    expect(dateEdge("2026-10-16", "start")).toBe(bj("2026-10-16T00:00:00.000"));
    expect(dateEdge("2026-10-16", "end")).toBe(bj("2026-10-16T23:59:59.999"));
    // 一天正好 24 小时，跨零点就是下一天的开始
    expect(dateEdge("2026-10-16", "end")! + 1).toBe(dateEdge("2026-10-17", "start"));
  });

  it("refuses a malformed or non-existent date instead of rolling it over", () => {
    expect(dateEdge("", "start")).toBeNull();
    expect(dateEdge("2026-10-16T00:00", "start")).toBeNull();
    expect(dateEdge("2026-2-3", "start")).toBeNull();
    // Date 会把 2 月 30 日进位到 3 月，换算回来对不上，必须当作非法
    expect(dateEdge("2026-02-30", "start")).toBeNull();
  });

  it("treats a competition whose start and end fall on the same Beijing day as a one-day event", () => {
    const start = dateEdge("2026-10-26", "start") as number;
    expect(isOneDay({ start_at: start, end_at: dateEdge("2026-10-26", "end") as number })).toBe(true);
    expect(isOneDay({ start_at: start, end_at: dateEdge("2026-10-27", "start") as number })).toBe(false);
    // UTC 里还是 10 月 25 日，北京时间已经是 26 日：按北京时间算同一天
    expect(isOneDay({ start_at: Date.parse("2026-10-25T16:00:00Z"), end_at: Date.parse("2026-10-26T15:59:59.999Z") })).toBe(true);
  });
});

describe("form validation", () => {
  const filled = (patch: Partial<ReturnType<typeof emptyForm>> = {}) => ({ ...emptyForm(), name: "极客班算法挑战赛", startDate: "2026-10-16", endDate: "2026-10-18", ...patch });

  it("accepts a well-formed internal competition", () => {
    expect(formErrors(filled())).toEqual({});
    expect(formErrors(filled({ deadlineDate: "2026-10-15" }))).toEqual({});
  });

  it("checks the name length the server enforces", () => {
    expect(formErrors(filled({ name: "赛" })).name).toContain("至少 2 个字");
    expect(formErrors(filled({ name: "x".repeat(81) })).name).toContain("最多 80 个字");
    expect(formErrors(filled({ name: `  ${"x".repeat(80)}  ` })).name).toBeUndefined();
    expect(formErrors(filled({ name: "𠮷" })).name).toContain("至少 2 个字");
    expect(formErrors(filled({ name: "𠮷".repeat(80) })).name).toBeUndefined();
  });

  it("keeps the end not before the start, and compares dates not strings", () => {
    expect(formErrors(filled({ endDate: "2026-10-15" })).endDate).toContain("不能早于开始日期");
    expect(formErrors(filled({ endDate: "2026-10-16" })).endDate).toBeUndefined();
    expect(formErrors(filled({ startDate: "" })).startDate).toContain("请选开始日期");
  });

  it("keeps the signup deadline no later than the end of the competition", () => {
    expect(formErrors(filled({ deadlineDate: "2026-10-19" })).deadlineDate).toContain("不能晚于比赛结束");
    expect(formErrors(filled({ deadlineDate: "2026-10-18" })).deadlineDate).toBeUndefined();
  });

  it("treats the link as optional for every kind, but rejects a non-https one", () => {
    // 不填就不跳转，任何类型都不报错
    expect(formErrors(filled({ kind: "external" })).url).toBeUndefined();
    expect(formErrors(filled({ kind: "internal" })).url).toBeUndefined();
    // 填了就必须是 https，与 kind 无关
    expect(formErrors(filled({ kind: "external", url: "http://example.test/c" })).url).toContain("https://");
    expect(formErrors(filled({ kind: "internal", url: "http://example.test/c" })).url).toContain("https://");
    expect(formErrors(filled({ kind: "internal", url: "https://example.test/c" })).url).toBeUndefined();
  });

  it("rejects malformed HTTPS URLs and overlong text before submitting", () => {
    for (const kind of ["internal", "external"] as const) {
      for (const url of ["https://?", "https://#", "https://[bad-host]", `https://example.test/${"x".repeat(500)}`]) {
        expect(formErrors(filled({ kind, url })).url).toBeTruthy();
      }
    }
    expect(formErrors(filled({ description: "x".repeat(1001) }))).toHaveProperty("description");
    expect(formErrors(filled({ description: "𠮷".repeat(1000) })).description).toBeUndefined();
    expect(formErrors(filled({ url: `https://example.test/${"𠮷".repeat(479)}` })).url).toBeUndefined();
  });
});

describe("payload", () => {
  it("covers the whole day: start at 00:00, end and deadline at the last millisecond", () => {
    const payload = formPayload({ ...emptyForm(), name: " 极客班算法挑战赛 ", startDate: "2026-10-16", endDate: "2026-10-18", deadlineDate: "2026-10-18", description: " 班内选拔 " });
    expect(payload).toEqual({
      name: "极客班算法挑战赛", kind: "internal",
      start_at: bj("2026-10-16T00:00:00.000"),
      end_at: bj("2026-10-18T23:59:59.999"),
      signup_deadline: bj("2026-10-18T23:59:59.999"),
      url: null, description: "班内选拔",
    });
  });

  it("sends no deadline and no url when they are not filled, and trims a filled link for any kind", () => {
    expect(formPayload({ ...emptyForm(), name: "x", startDate: "2026-10-16", endDate: "2026-10-16" }))
      .toMatchObject({ signup_deadline: null, url: null });
    expect(formPayload({ ...emptyForm(), name: "x", kind: "external", url: " https://example.test/c ", startDate: "2026-10-16", endDate: "2026-10-16" }))
      .toMatchObject({ url: "https://example.test/c" });
    // 内部比赛同样带上自己的官网链接
    expect(formPayload({ ...emptyForm(), name: "x", kind: "internal", url: " https://example.test/in ", startDate: "2026-10-16", endDate: "2026-10-16" }))
      .toMatchObject({ url: "https://example.test/in" });
  });
});

describe("round trip and labels", () => {
  it("fills the form from a record and gives back the same timestamps", () => {
    const record = {
      name: "蓝桥杯省赛", kind: "external" as const,
      start_at: bj("2026-10-16T09:00:00.000"), end_at: bj("2026-10-17T18:00:00.000"),
      signup_deadline: bj("2026-10-15T23:59:59.999"), url: "https://dasai.lanqiao.cn/", description: "以学校为单位报名。",
    };
    const form = formFrom(record);
    expect(form).toMatchObject({ startDate: "2026-10-16", endDate: "2026-10-17", deadlineDate: "2026-10-15" });
    // 同一天再提交会把时刻归到当天的边界，这是页面的口径（表单只到天）
    expect(formPayload(form)).toEqual({
      name: record.name, kind: "external",
      start_at: bj("2026-10-16T00:00:00.000"), end_at: bj("2026-10-17T23:59:59.999"),
      signup_deadline: bj("2026-10-15T23:59:59.999"), url: record.url, description: record.description,
    });
    expect(formPayload(form, record)).toEqual({});
    expect(formPayload({ ...form, url: "", deadlineDate: "" }, record)).toEqual({ url: null, signup_deadline: null });
    expect(formPayload({ ...form, endDate: "2026-10-18" }, record)).toEqual({ end_at: bj("2026-10-18T23:59:59.999") });
  });

  it("has a label for every status and kind the server can send", () => {
    expect(Object.values(STATUS_TEXT).sort()).toEqual(["未开始", "已结束", "报名中", "报名已截止", "进行中"].sort());
    expect(KIND_TEXT).toEqual({ internal: "内部", external: "外部" });
  });
});

it("recalculates preview status and ordering on every read", () => {
  const read = () => (routeConsole(new URL("http://mock.local/api/console/competitions")) as { competitions: CompetitionRecord[] }).competitions;
  const first = read().find(row => row.id === "c1001")!;
  const clock = vi.spyOn(Date, "now").mockReturnValue(first.end_at + 1);
  try {
    const rows = read();
    expect(rows.find(row => row.id === "c1001")?.status).toBe("ended");
    expect(rows.map(row => row.id)).toEqual(["c1002", "c1001", "c1003"]);
    clock.mockReturnValue(Math.max(...rows.map(row => row.end_at)) + 1);
    expect(read().map(row => row.id)).toEqual(["c1002", "c1001", "c1003"]);
  } finally {
    clock.mockRestore();
  }
});

it("keeps both preview signup deadlines at the end of their Beijing day", async () => {
  const consoleFeed = routeConsole(new URL("http://mock.local/api/console/competitions")) as { competitions: CompetitionRecord[] };
  const portalFeed = await mockApi<{ competitions: { signup_deadline: number | null }[] }>("/api/public/competitions");
  for (const row of [...consoleFeed.competitions, ...portalFeed.competitions]) {
    if (row.signup_deadline === null) continue;
    const at = new Date(row.signup_deadline);
    expect([at.getUTCHours(), at.getUTCMinutes(), at.getUTCSeconds(), at.getUTCMilliseconds()]).toEqual([15, 59, 59, 999]);
  }
});

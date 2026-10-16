// 比赛（#238）控制台页面的纯逻辑：北京时间换算、表单校验、提交正文。不渲染组件，只测这些函数。
import { describe, expect, it } from "vitest";
import { KIND_TEXT, STATUS_TEXT, beijingDate, dateEdge, emptyForm, formErrors, formFrom, formPayload } from "../../app/console/src/lib/competitions";

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

  it("requires an https link for an external competition and ignores the link for an internal one", () => {
    expect(formErrors(filled({ kind: "external" })).url).toContain("要填官方链接");
    expect(formErrors(filled({ kind: "external", url: "http://example.test/c" })).url).toContain("https://");
    expect(formErrors(filled({ kind: "external", url: "https://example.test/c" })).url).toBeUndefined();
    // 内部比赛留着上次填的外部链接不算错——提交时会丢掉
    expect(formErrors(filled({ url: "http://nope" })).url).toBeUndefined();
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

  it("sends no deadline and no url when they are not filled, and no url for internal", () => {
    expect(formPayload({ ...emptyForm(), name: "x", startDate: "2026-10-16", endDate: "2026-10-16" }))
      .toMatchObject({ signup_deadline: null, url: null });
    expect(formPayload({ ...emptyForm(), name: "x", kind: "external", url: " https://example.test/c ", startDate: "2026-10-16", endDate: "2026-10-16" }))
      .toMatchObject({ url: "https://example.test/c" });
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
  });

  it("has a label for every status and kind the server can send", () => {
    expect(Object.values(STATUS_TEXT).sort()).toEqual(["已结束", "报名中", "报名已截止", "进行中"].sort());
    expect(KIND_TEXT).toEqual({ internal: "内部", external: "外部" });
  });
});

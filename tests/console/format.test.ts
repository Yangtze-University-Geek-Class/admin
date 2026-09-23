import { describe, expect, it } from "vitest";
import { fmtRelative } from "../../app/console/src/lib/format";

describe("fmtRelative", () => {
  const now = Date.UTC(2026, 8, 24, 12, 0, 0);
  it("describes the past", () => {
    expect(fmtRelative(now - 20_000, now)).toBe("刚刚");
    expect(fmtRelative(now - 5 * 60_000, now)).toBe("5 分钟前");
    expect(fmtRelative(now - 3 * 3_600_000, now)).toBe("3 小时前");
    expect(fmtRelative(now - 2 * 86_400_000, now)).toBe("2 天前");
  });
  it("describes the future instead of calling it just now", () => {
    expect(fmtRelative(now + 2 * 86_400_000, now)).toBe("2 天后");
    expect(fmtRelative(now + 90 * 60_000, now)).toBe("2 小时后");
  });
  it("prints a placeholder for missing values", () => {
    expect(fmtRelative(null, now)).toBe("-");
    expect(fmtRelative("not a date", now)).toBe("-");
  });
});

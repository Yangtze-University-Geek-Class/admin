import { describe, expect, it } from "vitest";
import { GLYPH_COLS, GLYPH_ROWS, SUB, glyph, layoutLines, seeded, sequenceAt } from "../../app/web/sites/portal/lib/ledFont";
import { appConfig } from "../../app/web/shared/config";

describe("官网 LED 点阵字库", () => {
  it("每个字形都是 5×7，排版尺寸按细分倍数计算", () => {
    const { cols, rows, leds } = layoutLines(["GEEK"]);
    const letter = GLYPH_COLS * SUB;
    expect(cols).toBe(4 * letter + 3 * SUB);
    expect(rows).toBe(GLYPH_ROWS * SUB);
    // 每个点亮的字形像素展开成 SUB×SUB 颗 LED
    const litPixels = [..."GEEK"].reduce((sum, ch) => sum + glyph(ch).join("").split("#").length - 1, 0);
    expect(leds).toHaveLength(litPixels * SUB * SUB);
    expect(leds.every((led) => led.col >= 0 && led.col < cols && led.row >= 0 && led.row < rows)).toBe(true);
    expect(Math.min(...leds.map((led) => led.u))).toBe(0);
  });

  it("首页舞台配置里的每个词都能用字库排出来，缺字直接报错", () => {
    for (const chapter of appConfig.portal.stage.chapters) expect(() => layoutLines([chapter.word])).not.toThrow();
    expect(() => glyph("Z")).toThrow(/LED 字库没有字母/);
  });

  it("确定性随机数：同一种子序列相同，所以向上滚动能精确倒放", () => {
    const a = seeded(42);
    const b = seeded(42);
    const first = Array.from({ length: 5 }, () => a());
    expect(Array.from({ length: 5 }, () => b())).toEqual(first);
    expect(first.every((value) => value >= 0 && value < 1)).toBe(true);
  });

  it("滚动进度 → 章节：两端停顿、过渡单调、过半切换当前章", () => {
    expect(sequenceAt(0, 4)).toEqual({ from: 0, to: 1, t: 0, nearest: 0 });
    expect(sequenceAt(1, 4)).toMatchObject({ from: 2, to: 3, t: 1, nearest: 3 });
    // 每章开头的停顿区里过渡量恒为 0
    expect(sequenceAt(0.05, 4).t).toBe(0);
    let previous = -1;
    for (let step = 0; step <= 100; step += 1) {
      const { from, t } = sequenceAt(step / 100, 4);
      const position = from + t;
      expect(position).toBeGreaterThanOrEqual(previous);
      previous = position;
    }
    expect(sequenceAt(0.5, 3)).toMatchObject({ from: 1, t: 0, nearest: 1 });
    expect(sequenceAt(0.3, 1)).toEqual({ from: 0, to: 0, t: 0, nearest: 0 });
  });
});

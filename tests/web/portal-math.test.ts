import { describe, expect, it } from "vitest";
import { containDistance, coverDistance, distanceForPixelHeight, fitInBand, letterFolds, pixelToCameraPlane, viewOffset } from "../../app/web/sites/portal/lib/cameraMath";
import { clamp01, damp, ease, lerp, span } from "../../app/web/sites/portal/lib/motion";
import { DAYS, LEVEL_COLORS, WEEKS, decorativeLevels } from "../../app/web/sites/portal/lib/skyline";

const tanHalf = (fov: number) => Math.tan((fov * Math.PI) / 360);

describe("相机与摆放", () => {
  it("cover：屏幕在两个方向上都铺满视口（宽屏受高度限制，竖屏受宽度限制）", () => {
    for (const aspect of [16 / 10, 21 / 9, 9 / 19.5]) {
      const d = coverDistance(34, aspect, 1.1, 0.6875);
      const visibleH = 2 * d * tanHalf(34);
      const visibleW = visibleH * aspect;
      expect(visibleH).toBeLessThanOrEqual(0.6875 + 1e-9);
      expect(visibleW).toBeLessThanOrEqual(1.1 + 1e-9);
      expect(Math.max(visibleH / 0.6875, visibleW / 1.1)).toBeCloseTo(1, 6);
    }
    expect(coverDistance(34, 1.6, 1.1, 0.6875, 0.88)).toBeCloseTo(coverDistance(34, 1.6, 1.1, 0.6875) * 0.88);
  });

  it("contain：平面完整落在视口内", () => {
    const d = containDistance(30, 1.6, 2, 1, 0.8);
    const visibleH = 2 * d * tanHalf(30);
    expect(visibleH * 1.6 * 0.8).toBeGreaterThanOrEqual(2 - 1e-9);
    expect(visibleH * 0.8).toBeGreaterThanOrEqual(1 - 1e-9);
  });

  it("按像素高度反推距离：与 pixelToCameraPlane 的缩放一致", () => {
    const d = distanceForPixelHeight(30, 900, 1, 450);
    const top = pixelToCameraPlane(0, 0, 1440, 900, 30, d);
    // 世界高 1 的平面占 450px：可视半高 = 900px 对应的世界半高
    expect(top.y * 2).toBeCloseTo(2, 6);
  });

  it("像素 → 相机平面：中心是原点，四角对称，y 轴向上", () => {
    expect(pixelToCameraPlane(720, 450, 1440, 900, 30, 2)).toEqual({ x: 0, y: 0 });
    const tl = pixelToCameraPlane(0, 0, 1440, 900, 30, 2);
    const br = pixelToCameraPlane(1440, 900, 1440, 900, 30, 2);
    expect(tl.x).toBeCloseTo(-br.x);
    expect(tl.y).toBeCloseTo(-br.y);
    expect(tl.y).toBeGreaterThan(0);
    expect(tl.x / tl.y).toBeCloseTo(-1.6);
  });

  it("镜头偏移随 shift 归零，并夹紧在 0..1", () => {
    expect(viewOffset(1440, 900, -0.17, 0.02, 1)).toEqual({ x: -0.17 * 1440, y: 0.02 * 900 });
    const zero = viewOffset(1440, 900, -0.17, 0.02, 0);
    expect(Math.abs(zero.x)).toBe(0);
    expect(Math.abs(zero.y)).toBe(0);
    expect(viewOffset(1000, 1000, 0.1, 0.1, 3)).toEqual(viewOffset(1000, 1000, 0.1, 0.1, 1));
  });

  it("竖屏横带取景：透视投影后主体不超出横带且至少一个方向贴满，外框中心落在横带中线", () => {
    // 一台斜放的「电脑」：8 个角，近处的角 b 更大（更靠近相机）
    const corners = [-1, 1].flatMap((r) => [-1, 1].flatMap((u) => [-1, 1].map((b) => ({ r: r * 0.66 + b * 0.1, u: u * 0.45 + 0.1, b: b * 0.5 }))));
    for (const [aspect, top, bottom] of [
      [390 / 844, 0.07, 0.79],
      [360 / 780, 0.08, 0.72],
      [768 / 1024, 0.2, 0.6],
    ]) {
      const band = { top, bottom };
      const fill = 0.9;
      const { distance, ox, oy } = fitInBand(corners, 40, aspect, band, fill);
      const t = tanHalf(40);
      const xs = corners.map((p) => p.r / ((distance - p.b) * t * aspect));
      const ys = corners.map((p) => p.u / ((distance - p.b) * t));
      const halfW = (Math.max(...xs) - Math.min(...xs)) / 2;
      const halfH = (Math.max(...ys) - Math.min(...ys)) / 2;
      const bandH = bottom - top;
      expect(halfW).toBeLessThanOrEqual(fill + 1e-6);
      expect(halfH).toBeLessThanOrEqual(bandH * fill + 1e-6);
      expect(Math.max(halfW / fill, halfH / (bandH * fill))).toBeCloseTo(1, 4);
      // setViewOffset(ox·w, oy·h) 之后，外框中心的像素位置（按视口比例）
      const cx = (Math.max(...xs) + Math.min(...xs)) / 2;
      const cy = (Math.max(...ys) + Math.min(...ys)) / 2;
      expect((cx + 1) / 2 - ox).toBeCloseTo(0.5, 6);
      expect((1 - cy) / 2 - oy).toBeCloseTo((top + bottom) / 2, 6);
    }
  });

  it("信纸三折：三片等高，两条折痕对称", () => {
    const f = letterFolds(0.9);
    expect(f.panel * 3).toBeCloseTo(0.9);
    expect(f.upperCrease).toBeCloseTo(-f.lowerCrease);
    expect(f.upperCrease - f.lowerCrease).toBeCloseTo(f.panel);
  });
});

describe("缓动与插值", () => {
  it("缓动端点固定在 0 和 1", () => {
    for (const fn of Object.values(ease)) {
      expect(fn(0)).toBeCloseTo(0, 6);
      expect(fn(1)).toBeCloseTo(1, 6);
    }
    expect(ease.back(0.8)).toBeGreaterThan(1); // 回弹会略微越过终点
  });

  it("span、lerp、clamp01、damp", () => {
    expect(span(0.5, 0, 1)).toBe(0.5);
    expect(span(-1, 0, 1)).toBe(0);
    expect(span(3, 0, 1)).toBe(1);
    expect(span(1, 1, 1)).toBe(1);
    expect(lerp(2, 4, 0.25)).toBe(2.5);
    expect(clamp01(7)).toBe(1);
    const a = damp(0, 1, 5, 1 / 60);
    const b = damp(damp(0, 1, 5, 1 / 120), 1, 5, 1 / 120);
    expect(a).toBeCloseTo(b, 6); // 帧率无关
  });
});

describe("GitHub 天际线（示意数据）", () => {
  it("固定种子：每次生成一致，覆盖 53 周 × 7 天，色阶在 0..4", () => {
    const one = decorativeLevels();
    const two = decorativeLevels();
    expect(one.heights).toEqual(two.heights);
    expect(one.levels.length).toBe(WEEKS * DAYS);
    expect(Math.max(...one.levels)).toBeLessThan(LEVEL_COLORS.length);
    expect(new Set(one.levels).size).toBeGreaterThan(2);
    expect([...one.heights].every((h) => h > 0 && h < 1)).toBe(true);
  });
});

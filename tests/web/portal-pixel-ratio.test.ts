import { describe, expect, it } from "vitest";
import { GOVERNOR_WINDOW, PixelRatioGovernor, frameBudget, initialPixelRatio, lowerPixelRatio, p95InPlace } from "../../app/web/sites/portal/lib/pixelRatio";

/** 喂 n 个同样的帧间隔，返回过程中出现的降档结果 */
function feed(governor: PixelRatioGovernor, intervalMs: number, n: number): number[] {
  const changes: number[] = [];
  for (let i = 0; i < n; i++) {
    const next = governor.sample(intervalMs);
    if (next !== null) changes.push(next);
  }
  return changes;
}

describe("3D 像素比档位", () => {
  it("起步：设备像素比封顶 2，低像素比设备照原样，本会话降过档则不回到高档", () => {
    expect(initialPixelRatio(3)).toBe(2);
    expect(initialPixelRatio(2)).toBe(2);
    expect(initialPixelRatio(1)).toBe(1);
    expect(initialPixelRatio(Number.NaN)).toBe(1);
    expect(initialPixelRatio(2, 1.5)).toBe(1.5);
    expect(initialPixelRatio(1, 1.5)).toBe(1);
    expect(initialPixelRatio(2, null)).toBe(2);
  });

  it("档位只往下走：2、1.5、1.25，之后没有更低的档", () => {
    expect(lowerPixelRatio(2)).toBe(1.5);
    expect(lowerPixelRatio(1.75)).toBe(1.5);
    expect(lowerPixelRatio(1.5)).toBe(1.25);
    expect(lowerPixelRatio(1.25)).toBeNull();
    expect(lowerPixelRatio(1)).toBeNull();
  });

  it("预算：至少 12ms；60Hz 屏按 1.5 倍刷新间隔放宽，不把稳定 60fps 当成超预算", () => {
    expect(frameBudget(1000 / 120)).toBeCloseTo(12.5, 5);
    expect(frameBudget(1000 / 144)).toBe(12);
    expect(frameBudget(1000 / 60)).toBeCloseTo(25, 5);
    expect(frameBudget(Infinity)).toBeCloseTo(25, 5);
    expect(frameBudget(40)).toBeCloseTo(25, 5); // 刷新间隔封顶 16.7ms，卡顿不会把预算越放越宽
  });

  it("p95 原地排序取第 57 个（60 个样本）", () => {
    const samples = new Float32Array(60).map((_, i) => 60 - i);
    expect(p95InPlace(samples)).toBe(57);
    expect(samples[0]).toBe(1);
    expect(p95InPlace(new Float32Array(0))).toBe(0);
  });
});

describe("像素比调速器", () => {
  it("120Hz 屏满帧（8.3ms）从不降档", () => {
    const governor = new PixelRatioGovernor(2);
    expect(feed(governor, 8.3, GOVERNOR_WINDOW * 10)).toEqual([]);
    expect(governor.ratio).toBe(2);
  });

  it("60Hz 屏稳定 60fps（16.7ms）也不降档", () => {
    const governor = new PixelRatioGovernor(2);
    expect(feed(governor, 16.7, GOVERNOR_WINDOW * 10)).toEqual([]);
  });

  it("120Hz 屏掉到 60fps：每满一窗降一档，到 1.25 为止，之后不再变化", () => {
    const governor = new PixelRatioGovernor(2);
    feed(governor, 8.3, 10); // 先见过真实刷新间隔
    expect(feed(governor, 16.7, GOVERNOR_WINDOW - 10)).toEqual([1.5]);
    expect(feed(governor, 16.7, GOVERNOR_WINDOW)).toEqual([1.25]);
    expect(governor.settled).toBe(true);
    expect(feed(governor, 40, GOVERNOR_WINDOW * 5)).toEqual([]);
    expect(governor.ratio).toBe(1.25);
  });

  it("只降不升：降档后帧率恢复也不回到高档", () => {
    const governor = new PixelRatioGovernor(2);
    feed(governor, 8.3, 1);
    feed(governor, 20, GOVERNOR_WINDOW - 1);
    expect(governor.ratio).toBe(1.5);
    expect(feed(governor, 8.3, GOVERNOR_WINDOW * 5)).toEqual([]);
    expect(governor.ratio).toBe(1.5);
  });

  it("偶发慢帧不触发降档：一窗里少于 5% 的慢帧不影响 p95", () => {
    const governor = new PixelRatioGovernor(2);
    for (let i = 0; i < GOVERNOR_WINDOW * 4; i++) expect(governor.sample(i % 30 === 0 ? 30 : 8.3)).toBeNull();
    expect(governor.ratio).toBe(2);
  });

  it("卡顿、切后台（≥100ms）和无效值不计入窗口；预热帧先丢掉", () => {
    const governor = new PixelRatioGovernor(2, { warmupFrames: 5 });
    expect(feed(governor, 500, GOVERNOR_WINDOW * 3)).toEqual([]);
    expect(feed(governor, Number.NaN, GOVERNOR_WINDOW)).toEqual([]);
    expect(feed(governor, -3, GOVERNOR_WINDOW)).toEqual([]);
    // 5 个预热帧 + 59 个样本：还差一个才满窗
    expect(feed(governor, 30, 5 + GOVERNOR_WINDOW - 1)).toEqual([]);
    expect(governor.sample(30)).toBe(1.5);
  });

  it("GPU 从第一帧就跟不上：靠空闲帧探到的刷新间隔识别 120Hz 屏，照样降档", () => {
    const governor = new PixelRatioGovernor(2, { refreshMs: 8.33 });
    expect(feed(governor, 16.7, GOVERNOR_WINDOW)).toEqual([1.5]);
    const unknown = new PixelRatioGovernor(2);
    expect(feed(unknown, 16.7, GOVERNOR_WINDOW)).toEqual([]); // 没见过更快的帧：当作 60Hz 屏，不降
    unknown.noteRefresh(8.33);
    unknown.noteRefresh(1); // 同一帧里的重复回调不算刷新
    expect(unknown.refreshMs).toBeCloseTo(8.33, 5);
    expect(feed(unknown, 16.7, GOVERNOR_WINDOW)).toEqual([1.5]);
  });

  it("起步已是 1 倍的设备不需要调速", () => {
    const governor = new PixelRatioGovernor(1);
    expect(governor.settled).toBe(true);
    expect(feed(governor, 50, GOVERNOR_WINDOW * 3)).toEqual([]);
  });
});

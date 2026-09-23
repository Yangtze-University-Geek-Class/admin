// 3D 渲染像素比的自适应档位（纯逻辑，tests/web/portal-pixel-ratio.test.ts 覆盖）。
//
// 起步 min(devicePixelRatio, 2)：Retina 屏上几何边缘和贴图文字不再被浏览器放大发虚。
// 每攒满 60 个「连续绘制」的帧间隔看一次 p95，超过预算就降一档（2 → 1.5 → 1.25），同一会话里只降不升。
// 用帧间隔而不是 JS 耗时：GPU 忙不过来时浏览器会推迟下一帧，间隔里包含了像素比真正影响的那部分开销。
// 预算 = max(12ms, 1.5 × 刷新间隔)。刷新间隔取见过的最短帧间隔（封顶 16.7ms），除了绘制帧，
// Stage 刚建好时还会用几十个空 rAF 探一次（那时只有加载动画在跑，帧很轻）：
// 120Hz 屏预算 12ms；60Hz 屏约 25ms，稳稳 60fps 的 60Hz 屏不会被误判成超预算而白白降清晰度。
// 超过 100ms 的间隔是卡顿、切后台或循环刚恢复，不计入。

export const PIXEL_RATIO_LADDER = [2, 1.5, 1.25] as const;
export const GOVERNOR_WINDOW = 60;
export const FRAME_BUDGET_MS = 12;
const STALL_MS = 100;
/** 比这更短的间隔不是真实刷新（同一帧里的重复回调），不用来估计刷新率 */
const MIN_PLAUSIBLE_MS = 4;
const SLOWEST_REFRESH_MS = 1000 / 60;

/** 起步像素比：设备像素比封顶 2，再受本会话已经降到的档位限制 */
export function initialPixelRatio(deviceRatio: number, sessionCap?: number | null, maxRatio: number = PIXEL_RATIO_LADDER[0]): number {
  const device = Number.isFinite(deviceRatio) && deviceRatio > 0 ? deviceRatio : 1;
  const cap = typeof sessionCap === "number" && sessionCap > 0 ? sessionCap : Infinity;
  return Math.min(device, maxRatio, cap);
}

/** 下一档像素比；已经在最低档（或更低）时返回 null */
export function lowerPixelRatio(current: number): number | null {
  for (const step of PIXEL_RATIO_LADDER) if (step < current - 1e-6) return step;
  return null;
}

/** 这一窗帧间隔的预算（毫秒） */
export function frameBudget(refreshMs: number, budgetMs: number = FRAME_BUDGET_MS): number {
  const refresh = Number.isFinite(refreshMs) && refreshMs > 0 ? Math.min(refreshMs, SLOWEST_REFRESH_MS) : SLOWEST_REFRESH_MS;
  return Math.max(budgetMs, refresh * 1.5);
}

/** 一窗帧间隔的 p95。samples 会被原地排序（调用方传入自己的缓冲区，不分配新数组）。 */
export function p95InPlace(samples: Float32Array): number {
  if (samples.length === 0) return 0;
  samples.sort();
  return samples[Math.ceil(samples.length * 0.95) - 1];
}

/**
 * 每个渲染循环一个：sample() 喂入相邻两次绘制的间隔（毫秒），需要降档时返回新的像素比，否则返回 null。
 * 窗口是定长 Float32Array，满一窗才排序一次；降档后清空窗口，按新像素比重新测。
 */
export class PixelRatioGovernor {
  ratio: number;
  /** 本会话见过的最短帧间隔，用来估计屏幕刷新间隔 */
  refreshMs = Infinity;
  private readonly samples = new Float32Array(GOVERNOR_WINDOW);
  private readonly budgetMs: number;
  private count = 0;
  private skip: number;

  constructor(initial: number, options: { budgetMs?: number; warmupFrames?: number; refreshMs?: number } = {}) {
    this.ratio = initial;
    this.budgetMs = options.budgetMs ?? FRAME_BUDGET_MS;
    this.skip = options.warmupFrames ?? 0;
    if (options.refreshMs) this.noteRefresh(options.refreshMs);
  }

  /** 记录一次「不一定在绘制」的帧间隔，只用来估计刷新间隔，不进调速窗口 */
  noteRefresh(intervalMs: number) {
    if (intervalMs >= MIN_PLAUSIBLE_MS && intervalMs < this.refreshMs) this.refreshMs = intervalMs;
  }

  /** 已经在最低档：之后的采样都不会再改变结果 */
  get settled(): boolean {
    return lowerPixelRatio(this.ratio) === null;
  }

  sample(intervalMs: number): number | null {
    if (this.settled || !(intervalMs > 0) || intervalMs >= STALL_MS) return null;
    if (this.skip > 0) {
      this.skip--;
      return null;
    }
    this.noteRefresh(intervalMs);
    this.samples[this.count++] = intervalMs;
    if (this.count < this.samples.length) return null;
    this.count = 0;
    if (p95InPlace(this.samples) <= frameBudget(this.refreshMs, this.budgetMs)) return null;
    const next = lowerPixelRatio(this.ratio);
    if (next === null) return null;
    this.ratio = next;
    return next;
  }
}

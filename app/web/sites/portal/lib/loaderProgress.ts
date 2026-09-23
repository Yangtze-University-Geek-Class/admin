// 首次加载动画的进度模型（纯函数，tests/web/portal-loader.test.ts 覆盖）。
//
// 显示的进度 = min(真实就绪比例, 已过时间 / 最短展示时长)，再做一次平滑趋近：
//   · 真实就绪比例来自实际完成的步骤（three 分包下载、场景搭建、环境贴图、着色器编译、第一帧），
//     永远不会跑到真实进度前面；
//   · 最短展示时长保证动画完整走一遍：同一会话第一次 ≈2.1s，之后 0.5s；减少动态效果时直接跳过。

export const LOADER_SESSION_KEY = "yugc:booted";

/** 各步骤完成时对应的真实进度。顺序即首页实际执行顺序。 */
export const LOADER_STEPS = {
  start: 0.04,
  chunk: 0.3,
  env: 0.46,
  scene: 0.62,
  emblem: 0.7,
  compile: 0.9,
  frame: 1,
} as const;

export type LoaderStep = keyof typeof LOADER_STEPS;

export function loaderMinDuration({ reducedMotion, seenThisSession }: { reducedMotion: boolean; seenThisSession: boolean }): number {
  if (reducedMotion) return 0;
  return seenThisSession ? 500 : 2100;
}

/** 这一帧允许显示到的进度：不超过真实进度，也不超过时间进度。 */
export function loaderGoal(target: number, elapsedMs: number, minMs: number): number {
  const real = Math.min(1, Math.max(0, target));
  if (minMs <= 0) return real;
  return Math.min(real, Math.max(0, elapsedMs) / minMs);
}

/** 平滑趋近目标；差距很小时直接贴齐，保证能真正到达 1。 */
export function approach(shown: number, goal: number, factor = 0.12): number {
  if (goal <= shown) return goal;
  const next = shown + (goal - shown) * factor;
  return goal - next < 0.002 ? goal : next;
}

export function loaderFinished(shown: number, target: number): boolean {
  return target >= 1 && shown >= 0.999;
}

/** 三位数百分比文本，例如 007、100。 */
export function percentLabel(shown: number): string {
  return String(Math.round(Math.min(1, Math.max(0, shown)) * 100)).padStart(3, "0");
}

/** 进度过了第 i 片（共 total 片）花瓣的门槛时点亮它。 */
export function petalLit(shown: number, index: number, total = 6): boolean {
  return shown > (index + 1) / (total + 1);
}

// 官网动效用的纯函数：缓动、插值、区间映射。three.js 场景与 DOM 动画共用，不依赖 three。

export const clamp01 = (x: number): number => Math.min(1, Math.max(0, x));
export const lerp = (a: number, b: number, t: number): number => a + (b - a) * t;

/** 把全局进度 p 映射到 [a, b] 区间内的 0..1（区间外夹紧）。 */
export const span = (p: number, a: number, b: number): number => (b === a ? (p >= b ? 1 : 0) : clamp01((p - a) / (b - a)));

/** 帧率无关的指数趋近：lambda 越大越快，dt 单位秒。 */
export const damp = (current: number, target: number, lambda: number, dt: number): number =>
  lerp(current, target, 1 - Math.exp(-lambda * dt));

export const ease = {
  /** 三次缓入缓出：镜头推拉、信封翻盖。 */
  inOut: (t: number): number => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2),
  /** 三次缓出：落位。 */
  out: (t: number): number => 1 - Math.pow(1 - t, 3),
  /** 五次缓出：信纸落到屏幕正中的最后一段，收得更柔。 */
  outQuint: (t: number): number => 1 - Math.pow(1 - t, 5),
  /** 带一点回弹的缓出：火漆、旗子、气泡放大。 */
  back: (t: number): number => {
    const c = 1.6;
    return 1 + (c + 1) * Math.pow(t - 1, 3) + c * Math.pow(t - 1, 2);
  },
  /** 平滑阶梯（smoothstep）。 */
  smooth: (t: number): number => t * t * (3 - 2 * t),
};

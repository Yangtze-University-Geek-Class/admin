// GitHub 天际线与「贡献示意」条共用的装饰数据（纯函数，不依赖 three，tests/web/portal-skyline.test.ts 覆盖）。
// 高度与色阶由固定种子生成：开学季更忙、周末更闲。它们是装饰，不是真实提交数据，界面上必须标「示意」。

export const WEEKS = 53;
export const DAYS = 7;
export const LEVEL_COLORS = ["#ebedf5", "#c9d0f5", "#8f9ce8", "#5566d6", "#3346c8"] as const;

export function decorativeLevels(seed = 20210901): { heights: Float32Array; levels: Uint8Array } {
  let state = seed >>> 0;
  const rand = () => ((state = (Math.imul(state, 1664525) + 1013904223) >>> 0) / 4294967296);
  const count = WEEKS * DAYS;
  const heights = new Float32Array(count);
  const levels = new Uint8Array(count);
  for (let w = 0; w < WEEKS; w++) {
    for (let d = 0; d < DAYS; d++) {
      const i = w * DAYS + d;
      const season = 0.5 + 0.5 * Math.sin((w / WEEKS) * Math.PI * 2 - 1.2);
      const weekday = d > 0 && d < 6 ? 1 : 0.55;
      const r = rand();
      const level = r < 0.22 ? 0 : Math.min(4, Math.floor((r * 3.2 + season * 1.6) * weekday));
      levels[i] = level;
      heights[i] = level === 0 ? 0.02 : 0.08 + level * 0.16 + rand() * 0.08;
    }
  }
  return { heights, levels };
}

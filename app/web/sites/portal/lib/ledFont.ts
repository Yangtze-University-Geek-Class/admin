// 官网 LED 点阵字库与排版（纯函数，无 DOM）。
// 字形是经典 5×7 LED 招牌字；渲染时每个字形像素再细分成 SUB×SUB 颗 LED，
// 所以一个字母占 20×28 颗 LED、笔画 4 颗宽，字母间隔 1 个字形像素（4 颗 LED）。
// 画面效果与规则见 docs/design/DESIGN.md「官网视觉语言」。

export const GLYPH_COLS = 5;
export const GLYPH_ROWS = 7;
export const SUB = 4;

const GLYPHS: Record<string, readonly string[]> = {
  A: [".###.", "#...#", "#...#", "#####", "#...#", "#...#", "#...#"],
  B: ["####.", "#...#", "#...#", "####.", "#...#", "#...#", "####."],
  C: [".###.", "#...#", "#....", "#....", "#....", "#...#", ".###."],
  D: ["####.", "#...#", "#...#", "#...#", "#...#", "#...#", "####."],
  E: ["#####", "#....", "#....", "####.", "#....", "#....", "#####"],
  G: [".###.", "#...#", "#....", "#.###", "#...#", "#...#", ".###."],
  H: ["#...#", "#...#", "#...#", "#####", "#...#", "#...#", "#...#"],
  I: [".###.", "..#..", "..#..", "..#..", "..#..", "..#..", ".###."],
  J: ["..###", "...#.", "...#.", "...#.", "...#.", "#..#.", ".##.."],
  K: ["#...#", "#..#.", "#.#..", "##...", "#.#..", "#..#.", "#...#"],
  L: ["#....", "#....", "#....", "#....", "#....", "#....", "#####"],
  M: ["#...#", "##.##", "#.#.#", "#.#.#", "#...#", "#...#", "#...#"],
  N: ["#...#", "##..#", "#.#.#", "#..##", "#...#", "#...#", "#...#"],
  O: [".###.", "#...#", "#...#", "#...#", "#...#", "#...#", ".###."],
  P: ["####.", "#...#", "#...#", "####.", "#....", "#....", "#...."],
  R: ["####.", "#...#", "#...#", "####.", "#.#..", "#..#.", "#...#"],
  S: [".####", "#....", "#....", ".###.", "....#", "....#", "####."],
  T: ["#####", "..#..", "..#..", "..#..", "..#..", "..#..", "..#.."],
  U: ["#...#", "#...#", "#...#", "#...#", "#...#", "#...#", ".###."],
  W: ["#...#", "#...#", "#...#", "#.#.#", "#.#.#", "##.##", "#...#"],
  Y: ["#...#", "#...#", ".#.#.", "..#..", "..#..", "..#..", "..#.."],
};

export const SUPPORTED_LETTERS = Object.keys(GLYPHS).join("");

/** 一颗点亮的 LED：列、行（LED 坐标），以及它在整块字里的横向位置 0..1（用于扫描式过渡）。 */
export type Led = { col: number; row: number; u: number };

export type WordLayout = { cols: number; rows: number; leds: Led[] };

const LETTER_COLS = GLYPH_COLS * SUB;
const LETTER_ROWS = GLYPH_ROWS * SUB;
const LETTER_GAP = SUB;
const LINE_GAP = SUB * 2;

export function glyph(letter: string): readonly string[] {
  const rows = GLYPHS[letter.toUpperCase()];
  if (!rows) throw new Error(`LED 字库没有字母 ${letter}（可用：${SUPPORTED_LETTERS}）`);
  return rows;
}

/**
 * 把若干行文字排成 LED 坐标。lines 通常是 ["GEEK"]；需要时可以拆成多行。
 * 每行水平居中；返回整块的 LED 列数、行数和全部点亮的 LED。
 */
export function layoutLines(lines: readonly string[]): WordLayout {
  const widths = lines.map((line) => line.length * LETTER_COLS + Math.max(0, line.length - 1) * LETTER_GAP);
  const cols = Math.max(...widths);
  const rows = lines.length * LETTER_ROWS + Math.max(0, lines.length - 1) * LINE_GAP;
  const leds: Led[] = [];

  lines.forEach((line, lineIndex) => {
    const offsetX = Math.floor((cols - widths[lineIndex]) / 2);
    const offsetY = lineIndex * (LETTER_ROWS + LINE_GAP);
    [...line].forEach((letter, letterIndex) => {
      const bitmap = glyph(letter);
      const letterX = offsetX + letterIndex * (LETTER_COLS + LETTER_GAP);
      bitmap.forEach((row, gy) => {
        [...row].forEach((cell, gx) => {
          if (cell !== "#") return;
          for (let sy = 0; sy < SUB; sy += 1) {
            for (let sx = 0; sx < SUB; sx += 1) {
              leds.push({ col: letterX + gx * SUB + sx, row: offsetY + gy * SUB + sy, u: 0 });
            }
          }
        });
      });
    });
  });

  for (const led of leds) led.u = cols > 1 ? led.col / (cols - 1) : 0;
  return { cols, rows, leds };
}

/** 确定性伪随机（mulberry32），同一颗 LED 每次滚动到同一位置都得到同一轨迹。 */
export function seeded(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export const clamp01 = (value: number) => Math.min(1, Math.max(0, value));
export const smoothstep = (edge0: number, edge1: number, value: number) => {
  const t = clamp01((value - edge0) / (edge1 - edge0));
  return t * t * (3 - 2 * t);
};

/**
 * 滚动进度 → 章节序列上的位置。progress ∈ [0,1]，章节数 count：
 * 返回当前章 from、下一章 to 以及二者之间的过渡量 t（每章两端各留 hold 的停顿，停顿期 t 恒为 0 或 1），
 * nearest 是过半后切换的「当前章」，用于文案与进度器。
 */
export function sequenceAt(progress: number, count: number, hold = 0.22): { from: number; to: number; t: number; nearest: number } {
  if (count <= 1) return { from: 0, to: 0, t: 0, nearest: 0 };
  const position = clamp01(progress) * (count - 1);
  const from = Math.min(count - 2, Math.floor(position));
  const t = smoothstep(hold, 1 - hold, position - from);
  return { from, to: from + 1, t, nearest: t < 0.5 ? from : from + 1 };
}

// 官网 LED 点阵画板：把 ledFont 排好的词画到 Canvas 上。
// - 按设备像素取整排布（LED 间距、尺寸都是整数设备像素），任何屏幕上都清晰，不做位图放大；
// - 每个词有自己的位置框（首屏在吉祥物身后，故事章节居中放大），由调用方按画板尺寸给出；
// - 词的外框里有一层「未点亮」的暗 LED，只在词块范围内，不铺满整屏；
// - 词与词之间的过渡由调用方给的进度 t 决定（滚动驱动、可倒放）：
//   旧词从右往左碎成光点向右上飘散，新词的光点从左侧飞回原位；
// - 泛光画在一张低分辨率的辅助 Canvas 上，由 CSS 模糊，主 Canvas 只画清晰的方点。
// 颜色从 Canvas 元素上的 CSS 变量读取（--led-on-top / --led-on-bottom / --led-off / --led-spark），
// 令牌定义在 ../theme.css，本文件不写死业务颜色（下面的值只是读取失败时的兜底）。
import { clamp01, layoutLines, seeded, type WordLayout } from "./ledFont";

/** 词块可占用的最大范围（CSS px，中心点 + 宽高），词会按整数 LED 间距缩放到放得下为止。 */
export type WordBox = { cx: number; cy: number; width: number; height: number };

type Placement = { pitch: number; size: number; left: number; top: number; wall: HTMLCanvasElement };
type Palette = { top: number[]; bottom: number[]; off: string; spark: string };

const GLOW_SCALE = 0.25;

function parseColor(value: string, fallback: number[]): number[] {
  const hex = value.trim().match(/^#([0-9a-f]{6})$/i);
  if (hex) return [0, 2, 4].map((offset) => parseInt(hex[1].slice(offset, offset + 2), 16));
  const rgb = value.match(/(\d+(?:\.\d+)?)[ ,]+(\d+(?:\.\d+)?)[ ,]+(\d+(?:\.\d+)?)/);
  return rgb ? rgb.slice(1, 4).map(Number) : fallback;
}

export class LedBoard {
  private readonly context: CanvasRenderingContext2D;
  private readonly glowContext: CanvasRenderingContext2D | null;
  private layouts: WordLayout[] = [];
  private placements: Placement[] = [];
  private palette: Palette = { top: [221, 228, 255], bottom: [51, 70, 200], off: "rgb(51 70 200 / 12%)", spark: "#f5b35c" };
  private ratio = 1;

  constructor(
    private readonly canvas: HTMLCanvasElement,
    private readonly glow: HTMLCanvasElement | null,
    private readonly boxFor: (index: number, width: number, height: number) => WordBox,
  ) {
    this.context = canvas.getContext("2d")!;
    this.glowContext = glow?.getContext("2d") ?? null;
  }

  setWords(words: readonly string[]) {
    this.layouts = words.map((word) => layoutLines([word.toUpperCase()]));
    this.place();
  }

  /** 读取尺寸与令牌并重新排版。画板尺寸变化后调用。 */
  resize() {
    const rect = this.canvas.getBoundingClientRect();
    this.ratio = Math.min(window.devicePixelRatio || 1, 2);
    this.canvas.width = Math.max(1, Math.round(rect.width * this.ratio));
    this.canvas.height = Math.max(1, Math.round(rect.height * this.ratio));
    if (this.glow) {
      this.glow.width = Math.max(1, Math.round(rect.width * GLOW_SCALE));
      this.glow.height = Math.max(1, Math.round(rect.height * GLOW_SCALE));
    }
    const style = getComputedStyle(this.canvas);
    this.palette = {
      top: parseColor(style.getPropertyValue("--led-on-top"), this.palette.top),
      bottom: parseColor(style.getPropertyValue("--led-on-bottom"), this.palette.bottom),
      off: style.getPropertyValue("--led-off").trim() || this.palette.off,
      spark: style.getPropertyValue("--led-spark").trim() || this.palette.spark,
    };
    this.place();
  }

  private place() {
    const cssWidth = this.canvas.width / this.ratio;
    const cssHeight = this.canvas.height / this.ratio;
    if (!this.layouts.length || cssWidth < 2) return;
    this.placements = this.layouts.map((layout, index) => {
      const box = this.boxFor(index, cssWidth, cssHeight);
      const pitch = Math.max(3, Math.floor(Math.min((box.width * this.ratio) / layout.cols, (box.height * this.ratio) / layout.rows)));
      const size = pitch - Math.max(1, Math.round(pitch * 0.22));
      const left = Math.round(box.cx * this.ratio - (layout.cols * pitch) / 2);
      const top = Math.round(box.cy * this.ratio - (layout.rows * pitch) / 2);
      return { pitch, size, left, top, wall: this.paintWall(layout, pitch, size) };
    });
  }

  /** 词块范围内未点亮的暗 LED，只在排版变化时画一次。 */
  private paintWall(layout: WordLayout, pitch: number, size: number) {
    const wall = document.createElement("canvas");
    wall.width = layout.cols * pitch;
    wall.height = layout.rows * pitch;
    const context = wall.getContext("2d")!;
    context.fillStyle = this.palette.off;
    for (let row = 0; row < layout.rows; row += 1) {
      for (let col = 0; col < layout.cols; col += 1) context.fillRect(col * pitch, row * pitch, size, size);
    }
    return wall;
  }

  /**
   * 画一帧。from/to 是词序号，t ∈ [0,1] 是二者之间的过渡量，intro ∈ [0,1] 是首次点亮的扫描进度。
   * 同样的参数永远画出同样的画面（光点轨迹用确定性随机数），所以向上滚动就是倒放。
   */
  render(from: number, to: number, t: number, intro = 1) {
    if (!this.placements.length) return;
    const { width, height } = this.canvas;
    this.context.clearRect(0, 0, width, height);
    if (this.glow && this.glowContext) this.glowContext.clearRect(0, 0, this.glow.width, this.glow.height);

    if (from === to || t <= 0) {
      this.paintWord(from, 0, "leave", intro);
      return;
    }
    if (t >= 1) {
      this.paintWord(to, 1, "arrive", intro);
      return;
    }
    if (t < 0.6) this.paintWord(from, t, "leave", intro);
    if (t > 0.4) this.paintWord(to, t, "arrive", intro);
  }

  private paintWord(index: number, t: number, mode: "leave" | "arrive", intro: number) {
    const layout = this.layouts[index];
    const placement = this.placements[index];
    if (!layout || !placement) return;
    const { pitch, size, left, top } = placement;
    const context = this.context;
    const glow = this.glowContext;
    const glowScale = this.glow ? this.glow.width / this.canvas.width : 0;
    const [tr, tg, tb] = this.palette.top;
    const [br, bg, bb] = this.palette.bottom;
    const random = seeded(index * 7919 + 17);

    // 暗 LED 底板随词一起出现 / 消失
    const wallAlpha = (mode === "leave" ? 1 - clamp01(t / 0.5) : clamp01((t - 0.5) / 0.5)) * Math.min(1, intro * 1.4);
    if (wallAlpha > 0) {
      context.globalAlpha = wallAlpha;
      context.drawImage(placement.wall, left, top);
    }

    for (const led of layout.leds) {
      const r1 = random();
      const r2 = random();
      const r3 = random();
      const r4 = random();

      // 首次点亮：从左到右扫过去，扫描线附近的点有先后
      const bootAt = led.u * 0.8 + (led.row / layout.rows) * 0.2;
      if (intro < 1 && bootAt > intro * 1.1 - r4 * 0.1) continue;

      const k = mode === "leave" ? clamp01((t - (1 - led.u) * 0.3) / 0.28) : 1 - clamp01((t - 0.42 - led.u * 0.3) / 0.28);
      // k=0 在原位全亮，k=1 完全飞散熄灭；每颗点熄灭的快慢不同，碎裂更自然
      const alpha = 1 - Math.pow(k, 0.6 + r3 * 1.4);
      if (alpha <= 0.02) continue;

      const travel = k * k;
      const direction = mode === "leave" ? 1 : -1;
      const x = left + led.col * pitch + direction * travel * pitch * (6 + 26 * r1);
      const y = top + led.row * pitch + (r2 - 0.5) * k * pitch * 14 - travel * pitch * 8 * r3;
      const shade = led.row / Math.max(1, layout.rows - 1);
      const spark = k > 0.08 && r4 > 0.93;
      const side = Math.max(1, Math.round(size * (1 - k * 0.45)));
      const fill = spark
        ? this.palette.spark
        : `rgb(${Math.round(tr + (br - tr) * shade)} ${Math.round(tg + (bg - tg) * shade)} ${Math.round(tb + (bb - tb) * shade)})`;

      context.globalAlpha = alpha;
      context.fillStyle = fill;
      context.fillRect(Math.round(x), Math.round(y), side, side);

      if (glow) {
        glow.globalAlpha = alpha;
        glow.fillStyle = fill;
        glow.fillRect(x * glowScale, y * glowScale, Math.max(1, pitch * glowScale), Math.max(1, pitch * glowScale));
      }
    }
    context.globalAlpha = 1;
    if (glow) glow.globalAlpha = 1;
  }
}

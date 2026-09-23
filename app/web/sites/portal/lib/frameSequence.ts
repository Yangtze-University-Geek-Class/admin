// 滚动擦洗的透明底帧序列（B 站教程第 3–5 步：图生视频 → 逐帧抠像 → Canvas 按滚动进度绘制）。
// 帧文件命名为 <base>001.<ext> … <base><count>.<ext>，与首屏静帧用同一裁切框导出，所以画出来与静帧像素对齐。
// 绘制方式与 CSS 的 object-fit: contain + object-position: 50% 100% 一致；按 DPR（≤2）取像素。
// 加载顺序：先首帧，再按步长逐级加密（任何时刻都能就近找到已加载的帧）；未加载完成的帧用最近的已加载帧兜底。

export type FrameSource = { base: string; count: number; ext: string };

/** 首帧优先 + 二分加密的加载顺序。 */
export function loadOrder(count: number): number[] {
  const order: number[] = [];
  const seen = new Set<number>();
  for (let step = 2 ** Math.ceil(Math.log2(Math.max(1, count))); step >= 1; step = Math.floor(step / 2)) {
    for (let index = 0; index < count; index += step) {
      if (!seen.has(index)) {
        seen.add(index);
        order.push(index);
      }
    }
    if (step === 1) break;
  }
  return order;
}

export class FrameSequence {
  private readonly context: CanvasRenderingContext2D;
  private readonly images: (HTMLImageElement | null)[];
  private started = false;
  private drawn = -1;
  private wanted = 0;
  private disposed = false;

  constructor(
    private readonly canvas: HTMLCanvasElement,
    private readonly source: FrameSource,
  ) {
    this.context = canvas.getContext("2d")!;
    this.images = Array.from({ length: source.count }, () => null);
  }

  get loaded() {
    return this.images[0] !== null;
  }

  /** 开始加载全部帧（只触发一次）。首次滚动时再调用，没滚动的访客不下载。 */
  load() {
    if (this.started) return;
    this.started = true;
    for (const index of loadOrder(this.source.count)) {
      const image = new Image();
      image.decoding = "async";
      image.src = `${this.source.base}${String(index + 1).padStart(3, "0")}.${this.source.ext}`;
      image.onload = () => {
        if (this.disposed) return;
        this.images[index] = image;
        this.draw(this.wanted, true);
      };
    }
  }

  resize() {
    const rect = this.canvas.getBoundingClientRect();
    const ratio = Math.min(window.devicePixelRatio || 1, 2);
    this.canvas.width = Math.max(1, Math.round(rect.width * ratio));
    this.canvas.height = Math.max(1, Math.round(rect.height * ratio));
    this.draw(this.wanted, true);
  }

  private nearestLoaded(index: number) {
    for (let offset = 0; offset < this.source.count; offset += 1) {
      for (const candidate of [index - offset, index + offset]) {
        if (candidate >= 0 && candidate < this.source.count && this.images[candidate]) return candidate;
      }
    }
    return -1;
  }

  /** 画第 index 帧（0 起）；progress 由调用方换算。返回实际画出的帧序号，-1 表示还没有可用帧。 */
  draw(index: number, force = false) {
    this.wanted = Math.min(this.source.count - 1, Math.max(0, index));
    const actual = this.nearestLoaded(this.wanted);
    if (actual < 0 || (!force && actual === this.drawn)) return actual;
    const image = this.images[actual]!;
    const { width, height } = this.canvas;
    const scale = Math.min(width / image.naturalWidth, height / image.naturalHeight);
    const w = image.naturalWidth * scale;
    const h = image.naturalHeight * scale;
    this.context.clearRect(0, 0, width, height);
    this.context.drawImage(image, (width - w) / 2, height - h, w, h);
    this.drawn = actual;
    return actual;
  }

  dispose() {
    this.disposed = true;
  }
}

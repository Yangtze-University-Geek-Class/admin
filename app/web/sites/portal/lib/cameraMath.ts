// 相机与摆放的纯数学（不依赖 three，tests/web/portal-math.test.ts 覆盖）。
// 角度一律用「竖直视场角（度）」，与 THREE.PerspectiveCamera.fov 一致。

const tanHalf = (fovDeg: number): number => Math.tan((fovDeg * Math.PI) / 360);

/**
 * 让宽 w、高 h 的平面「铺满」视口（cover）所需的相机距离，再乘 overscan（<1 更近）。
 * 书桌推近屏幕时用：屏幕铺满视口后再淡入 DOM 版的系统桌面。
 */
export function coverDistance(fovDeg: number, aspect: number, w: number, h: number, overscan = 1): number {
  const t = tanHalf(fovDeg);
  return Math.min(h / 2 / t, w / 2 / (t * aspect)) * overscan;
}

/** 让平面完整落在视口内（contain）、并占 fill 比例所需的相机距离。 */
export function containDistance(fovDeg: number, aspect: number, w: number, h: number, fill = 1): number {
  const t = tanHalf(fovDeg);
  return Math.max(h / 2 / (t * fill), w / 2 / (t * aspect * fill));
}

/** 世界高度 worldH 的平面在视口（高 viewH 像素）里显示为 pxH 像素高时，离相机的距离。 */
export function distanceForPixelHeight(fovDeg: number, viewH: number, worldH: number, pxH: number): number {
  return (worldH * viewH) / (2 * tanHalf(fovDeg) * pxH);
}

/**
 * 屏幕像素 (px, py) 在相机前方距离 d 处的相机空间坐标（x 向右、y 向上，单位同世界）。
 * 用来把 3D 信纸摆到 DOM 表单所在的位置：两者在最后一帧严丝合缝，再交叉淡入。
 */
export function pixelToCameraPlane(
  px: number,
  py: number,
  viewW: number,
  viewH: number,
  fovDeg: number,
  d: number,
  out: { x: number; y: number } = { x: 0, y: 0 },
): { x: number; y: number } {
  const halfH = d * tanHalf(fovDeg);
  const halfW = halfH * (viewW / viewH);
  out.x = (px / viewW) * 2 * halfW - halfW;
  out.y = halfH - (py / viewH) * 2 * halfH;
  return out;
}

/**
 * 书桌首屏的镜头偏移（PerspectiveCamera.setViewOffset 的 x/y）：
 * 让书桌落在文案右侧；shift 从 1 过渡到 0 时镜头回正，推近屏幕时不歪。
 * 每帧调用时传入 out 复用同一个对象（渲染循环里不分配）。
 */
export function viewOffset(
  width: number,
  height: number,
  ox: number,
  oy: number,
  shift: number,
  out: { x: number; y: number } = { x: 0, y: 0 },
): { x: number; y: number } {
  const s = Math.min(1, Math.max(0, shift));
  out.x = ox * width * s;
  out.y = oy * height * s;
  return out;
}

/**
 * 文案叠在画面上下（而不是左侧）的布局：手机和竖放的平板。CSS 里同一条媒体查询切换页面布局，
 * 3D 场景用它决定按横带取景（fitInBand），两边必须一致，否则文案会压在主体上。
 */
export const STACKED_QUERY = "(max-width: 760px), (max-aspect-ratio: 9/10)";

/**
 * 竖屏时 3D 可用的横带：above 的下沿到 below 的上沿（缺哪个就用视口边缘，再各留 gap 像素）。
 * 不是竖屏布局时返回 null，场景用横屏镜头。
 */
export function measureBand(above: Element | null, below: Element | null, gap = 12): Band | null {
  if (typeof window === "undefined" || !window.matchMedia(STACKED_QUERY).matches) return null;
  const h = window.innerHeight;
  const top = above ? above.getBoundingClientRect().bottom + gap : 0;
  const bottom = below ? below.getBoundingClientRect().top - gap : h;
  return { top: top / h, bottom: bottom / h };
}

/** 视口里的一条横带，按视口高度的比例（0 = 顶，1 = 底） */
export type Band = { top: number; bottom: number };
/** 镜头坐标系里的一个点：r 向右、u 向上、b 指向相机，原点是镜头看向的点 */
export type CamPoint = { r: number; u: number; b: number };

/**
 * 竖屏取景：让主体（若干角点）完整落在横带里，横向不超过 fill、纵向不超过横带高度 × fill，且至少一个方向贴满。
 * 按透视投影二分出相机距离（近处的角在透视下更大，正交估算会裁掉它们），
 * 再给出 setViewOffset 用的比例偏移 ox、oy：投影外框的中心落在视口水平中线与横带中线上。
 */
export function fitInBand(points: readonly CamPoint[], fovDeg: number, aspect: number, band: Band, fill = 0.9): { distance: number; ox: number; oy: number } {
  const t = tanHalf(fovDeg);
  const bandH = Math.min(1, Math.max(0.2, band.bottom - band.top));
  const box = { x0: 0, x1: 0, y0: 0, y1: 0 };
  const measure = (d: number) => {
    box.x0 = box.y0 = Infinity;
    box.x1 = box.y1 = -Infinity;
    for (const p of points) {
      const depth = d - p.b;
      const x = p.r / (depth * t * aspect);
      const y = p.u / (depth * t);
      box.x0 = Math.min(box.x0, x);
      box.x1 = Math.max(box.x1, x);
      box.y0 = Math.min(box.y0, y);
      box.y1 = Math.max(box.y1, y);
    }
    return (box.x1 - box.x0) / 2 <= fill && (box.y1 - box.y0) / 2 <= bandH * fill;
  };
  let lo = Math.max(0, ...points.map((p) => p.b)) + 1e-3;
  let hi = lo + 1;
  for (let i = 0; i < 40 && !measure(hi); i++) hi = lo + (hi - lo) * 2;
  for (let i = 0; i < 48; i++) {
    const mid = (lo + hi) / 2;
    if (measure(mid)) hi = mid;
    else lo = mid;
  }
  measure(hi);
  return { distance: hi, ox: (box.x0 + box.x1) / 4, oy: (1 - (box.y0 + box.y1) / 2) / 2 - (band.top + band.bottom) / 2 };
}

/**
 * 信纸三折：返回上、中、下三片的高度与两条折痕的 y（以信纸中心为原点，向上为正）。
 * 先折下片、再折上片，折完只剩中间一片的高度。
 */
export function letterFolds(height: number): { panel: number; upperCrease: number; lowerCrease: number } {
  const panel = height / 3;
  return { panel, upperCrease: panel / 2, lowerCrease: -panel / 2 };
}

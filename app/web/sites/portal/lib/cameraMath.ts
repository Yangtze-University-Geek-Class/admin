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
 * 信纸三折：返回上、中、下三片的高度与两条折痕的 y（以信纸中心为原点，向上为正）。
 * 先折下片、再折上片，折完只剩中间一片的高度。
 */
export function letterFolds(height: number): { panel: number; upperCrease: number; lowerCrease: number } {
  const panel = height / 3;
  return { panel, upperCrease: panel / 2, lowerCrease: -panel / 2 };
}

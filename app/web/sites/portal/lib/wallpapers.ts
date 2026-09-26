// YUGC OS 的壁纸：清单、选择与下载解码（tests/web/portal-wallpapers.test.ts 覆盖）。
// 两张静态图，由 crosery-ct（mox_image_generate）按所有者给的海报风格生成。
// 图片地址只写在这份清单里：换 CDN（#146）时只改这里。

export type Wallpaper = {
  id: string;
  name: string;
  /** 桌面壁纸（1920×1080 webp） */
  image: string;
  /** 选择面板里的小图（320×180）；换壁纸时大图还没到，先拿它放大模糊顶上 */
  thumb: string;
  /** 画面主色：图片还没到时的底色，避免闪白 */
  tint: string;
};

export const WALLPAPERS: readonly Wallpaper[] = [
  { id: "yugc", name: "极客娘 1", image: "/portal/wallpapers/yugc.webp", thumb: "/portal/wallpapers/yugc-thumb.webp", tint: "#b9d6f7" },
  { id: "geek", name: "极客娘 2", image: "/portal/wallpapers/geek.webp", thumb: "/portal/wallpapers/geek-thumb.webp", tint: "#a9cdf5" },
];

export const DEFAULT_WALLPAPER = WALLPAPERS[0].id;
export const WALLPAPER_KEY = "yugc:wallpaper";

/** 存下来的值不认识（改名、删掉）时回到默认壁纸 */
export function resolveWallpaper(id: string | null | undefined): Wallpaper {
  return WALLPAPERS.find((wallpaper) => wallpaper.id === id) ?? WALLPAPERS[0];
}

export function readWallpaperChoice(): Wallpaper {
  try {
    return resolveWallpaper(localStorage.getItem(WALLPAPER_KEY));
  } catch {
    return WALLPAPERS[0];
  }
}

export function saveWallpaperChoice(id: string) {
  try {
    localStorage.setItem(WALLPAPER_KEY, id);
  } catch {
    /* 隐私模式写不进去：只影响下次打开时是否记得 */
  }
}

// ── 切换动效 ──

/** 屏幕上的一块矩形（getBoundingClientRect 的四个值） */
export type Box = { left: number; top: number; width: number; height: number };

/** 缩略图在面板里的圆角（styles/os.css 的 .pt-picker-box img） */
const THUMB_RADIUS = 9;

/**
 * 新壁纸从点的那张缩略图展开：clip-path 的起点是缩略图在壁纸层里的位置（上右下左的内缩 + 缩略图的圆角），
 * 终点是整个桌面。缩略图不在壁纸层里时内缩是负数，照样成立。
 */
export function revealClipFrom(thumb: Box, layer: Box): string {
  const top = thumb.top - layer.top;
  const left = thumb.left - layer.left;
  const right = layer.left + layer.width - (thumb.left + thumb.width);
  const bottom = layer.top + layer.height - (thumb.top + thumb.height);
  return `inset(${[top, right, bottom, left].map((value) => `${Math.round(value)}px`).join(" ")} round ${THUMB_RADIUS}px)`;
}

// ── 下载与解码 ──
// 开机画面和换壁纸共用同一份：同一地址只下载一次。

const loading = new Map<string, Promise<boolean>>();
const decoded = new Set<string>();

/** 这张图已经下载并解码过：换过去时直接给大图，不用先顶缩略图 */
export function isWallpaperDecoded(url: string): boolean {
  return decoded.has(url);
}

/** 下载并解码一张图，成功为 true。失败（离线、被拦）不记住，下次换过去再试 */
export function loadWallpaperImage(url: string): Promise<boolean> {
  const pending = loading.get(url);
  if (pending) return pending;
  const image = new Image();
  image.decoding = "async";
  image.src = url;
  const result = image.decode().then(
    () => {
      decoded.add(url);
      return true;
    },
    () => {
      loading.delete(url);
      return false;
    },
  );
  loading.set(url, result);
  return result;
}

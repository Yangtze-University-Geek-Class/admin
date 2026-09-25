// YUGC OS 的壁纸清单与选择（纯逻辑，tests/web/portal-wallpapers.test.ts 覆盖）。
// 两张静态图，由 crosery-ct（mox_image_generate）按所有者给的海报风格生成。

export type Wallpaper = {
  id: string;
  name: string;
  /** 桌面壁纸（1920×1080 webp） */
  image: string;
  /** 选择面板里的小图 */
  thumb: string;
  /** 画面主色：图片还没解码完时的底色，避免闪白 */
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

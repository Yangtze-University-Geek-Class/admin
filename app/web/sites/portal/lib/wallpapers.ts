// YUGC OS 的壁纸清单与选择（纯逻辑，tests/web/portal-wallpapers.test.ts 覆盖）。
// 每张壁纸都有一张静态图（视频第一帧：先显示，也是视频的封面和兜底）；有 video 的再叠一段循环播放的视频。
// 视频就是视频服务生成的原片，不做任何剪辑、合成或重新编码。
// 视频只在不要求「减少动态效果」、也没开省流量时播放；播不了就停在静态图上，不黑屏。

export type Wallpaper = {
  id: string;
  name: string;
  /** 静态图（webp，视频的第一帧，视频接上时画面不跳） */
  image: string;
  /** 选择面板里的小图 */
  thumb: string;
  /** 动态壁纸的视频（原片 mp4，循环播放） */
  video?: string;
  /** 画面主色：图片还没解码完时的底色，避免闪白 */
  tint: string;
};

export const WALLPAPERS: readonly Wallpaper[] = [
  {
    id: "yugc",
    name: "极客娘 1",
    image: "/portal/wallpapers/yugc.webp",
    thumb: "/portal/wallpapers/yugc-thumb.webp",
    video: "/portal/wallpapers/yugc.mp4",
    tint: "#b9d6f7",
  },
  {
    id: "geek",
    name: "极客娘 2",
    image: "/portal/wallpapers/geek.webp",
    thumb: "/portal/wallpapers/geek-thumb.webp",
    video: "/portal/wallpapers/geek.mp4",
    tint: "#a9cdf5",
  },
];

export const DEFAULT_WALLPAPER = WALLPAPERS[0].id;
export const WALLPAPER_KEY = "yugc:wallpaper";

/** 存下来的值不认识（改名、删掉）时回到默认壁纸 */
export function resolveWallpaper(id: string | null | undefined): Wallpaper {
  return WALLPAPERS.find((wallpaper) => wallpaper.id === id) ?? WALLPAPERS[0];
}

/** 要不要播视频：有视频、没要求减少动态、没开省流量 */
export function shouldPlayVideo(wallpaper: Wallpaper, env: { reducedMotion: boolean; saveData: boolean }): boolean {
  return Boolean(wallpaper.video) && !env.reducedMotion && !env.saveData;
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

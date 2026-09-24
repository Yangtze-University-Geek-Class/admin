import { existsSync, statSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { DEFAULT_WALLPAPER, WALLPAPERS, resolveWallpaper, shouldPlayVideo } from "../../app/web/sites/portal/lib/wallpapers";

const PUBLIC = new URL("../../app/web/public", import.meta.url).pathname;

describe("桌面壁纸", () => {
  it("每张壁纸的文件都在，静态图与视频体积有上限（首屏以外按需加载，但也不能拖慢切换）", () => {
    for (const wallpaper of WALLPAPERS) {
      for (const file of [wallpaper.image, wallpaper.thumb, ...(wallpaper.video ? [wallpaper.video] : [])]) {
        const path = `${PUBLIC}${file}`;
        expect(existsSync(path), file).toBe(true);
        const limit = file.endsWith(".mp4") ? 8e6 : 300e3;
        expect(statSync(path).size, file).toBeLessThan(limit);
      }
    }
    expect(new Set(WALLPAPERS.map((wallpaper) => wallpaper.id)).size).toBe(WALLPAPERS.length);
  });

  it("两张都是动态壁纸，名字是极客娘 1、极客娘 2，默认用第一张", () => {
    expect(WALLPAPERS.map((wallpaper) => wallpaper.name)).toEqual(["极客娘 1", "极客娘 2"]);
    expect(WALLPAPERS.every((wallpaper) => wallpaper.video)).toBe(true);
    expect(DEFAULT_WALLPAPER).toBe(WALLPAPERS[0].id);
  });

  it("存下来的选择不认识时回到默认", () => {
    expect(resolveWallpaper("geek").id).toBe("geek");
    expect(resolveWallpaper("deleted-one").id).toBe(DEFAULT_WALLPAPER);
    expect(resolveWallpaper(null).id).toBe(DEFAULT_WALLPAPER);
  });

  it("减少动态或省流量时不播视频，只留静态图", () => {
    const moving = WALLPAPERS[0];
    const still = { ...moving, video: undefined };
    expect(shouldPlayVideo(moving, { reducedMotion: false, saveData: false })).toBe(true);
    expect(shouldPlayVideo(moving, { reducedMotion: true, saveData: false })).toBe(false);
    expect(shouldPlayVideo(moving, { reducedMotion: false, saveData: true })).toBe(false);
    expect(shouldPlayVideo(still, { reducedMotion: false, saveData: false })).toBe(false);
  });
});

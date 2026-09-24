import { existsSync, statSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { DEFAULT_WALLPAPER, WALLPAPERS, resolveWallpaper } from "../../app/web/sites/portal/lib/wallpapers";

const PUBLIC = new URL("../../app/web/public", import.meta.url).pathname;

describe("桌面壁纸", () => {
  it("每张壁纸的图都在，体积有上限（开机画面要等它解码完）", () => {
    for (const wallpaper of WALLPAPERS) {
      for (const file of [wallpaper.image, wallpaper.thumb]) {
        const path = `${PUBLIC}${file}`;
        expect(existsSync(path), file).toBe(true);
        expect(statSync(path).size, file).toBeLessThan(300e3);
      }
    }
    expect(new Set(WALLPAPERS.map((wallpaper) => wallpaper.id)).size).toBe(WALLPAPERS.length);
  });

  it("两张静态壁纸，名字是极客娘 1、极客娘 2，默认用第一张", () => {
    expect(WALLPAPERS.map((wallpaper) => wallpaper.name)).toEqual(["极客娘 1", "极客娘 2"]);
    expect(DEFAULT_WALLPAPER).toBe(WALLPAPERS[0].id);
  });

  it("存下来的选择不认识时回到默认", () => {
    expect(resolveWallpaper("geek").id).toBe("geek");
    expect(resolveWallpaper("deleted-one").id).toBe(DEFAULT_WALLPAPER);
    expect(resolveWallpaper(null).id).toBe(DEFAULT_WALLPAPER);
  });
});

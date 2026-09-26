import { existsSync, readFileSync, statSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { DEFAULT_WALLPAPER, WALLPAPERS, canPrefetchWallpapers, resolveWallpaper, revealClipFrom, wallpaperPrefetchList } from "../../app/web/sites/portal/lib/wallpapers";

const PUBLIC = new URL("../../app/web/public", import.meta.url).pathname;
const STYLES = new URL("../../app/web/sites/portal/styles", import.meta.url).pathname;

describe("桌面壁纸", () => {
  it("每张壁纸的图都在，体积有上限（开机画面要等它解码完）", () => {
    for (const wallpaper of WALLPAPERS) {
      for (const file of [wallpaper.image, wallpaper.thumb]) {
        const path = `${PUBLIC}${file}`;
        expect(existsSync(path), file).toBe(true);
        expect(statSync(path).size, file).toBeLessThan(300e3);
      }
      // 缩略图是换壁纸时先顶上的占位，要小到打开面板就已经下好
      expect(statSync(`${PUBLIC}${wallpaper.thumb}`).size, wallpaper.thumb).toBeLessThan(20e3);
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

describe("换壁纸的动效与预取", () => {
  it("展开的起点是缩略图在壁纸层里的位置（上右下左内缩 + 缩略图圆角）", () => {
    const layer = { left: 0, top: 34, width: 1440, height: 866 };
    const thumb = { left: 460.4, top: 390, width: 160, height: 90 };
    expect(revealClipFrom(thumb, layer)).toBe("inset(356px 820px 420px 460px round 9px)");
    // 缩略图不在壁纸层里（例如压在菜单栏上）时内缩是负数，照样从它展开
    expect(revealClipFrom({ left: 10, top: 20, width: 100, height: 50 }, layer)).toBe("inset(-14px 1330px 830px 10px round 9px)");
  });

  it("预取先全部缩略图，再当前这张以外的大图；不重复预取当前大图", () => {
    expect(wallpaperPrefetchList("yugc")).toEqual(["/portal/wallpapers/yugc-thumb.webp", "/portal/wallpapers/geek-thumb.webp", "/portal/wallpapers/geek.webp"]);
    expect(wallpaperPrefetchList("geek")).toEqual(["/portal/wallpapers/yugc-thumb.webp", "/portal/wallpapers/geek-thumb.webp", "/portal/wallpapers/yugc.webp"]);
  });

  it("减少动态效果时全站把动画压成 .01ms，换壁纸的淡入和清晰过来保留原时长（不然旧层卸掉前根本看不到淡入）", () => {
    const strip = (css: string) => css.replace(/\/\*[\s\S]*?\*\//g, "");
    // 被豁免的那条全局规则：一个类 + 通配符
    expect(strip(readFileSync(`${STYLES}/portal.css`, "utf8"))).toMatch(/\.pt-root \*[^{]*\{[^}]*animation-duration: \.01ms !important;[^}]*transition-duration: \.01ms !important;/);
    const reduced = strip(readFileSync(`${STYLES}/os.css`, "utf8"))
      .split("@media (prefers-reduced-motion: reduce)")
      .slice(1)
      .map((part) => part.slice(0, part.indexOf("\n}")))
      .filter((part) => part.includes(".pt-wall"));
    expect(reduced).toHaveLength(1);
    // 两个类，比 .pt-root * 更具体：两边都是 !important 时不看样式表的先后
    expect(reduced[0]).toContain('.pt-wall[data-enter="fade"] { animation-duration: var(--wall-enter) !important; }');
    expect(reduced[0]).toContain(".pt-wall > .pt-wall-full { transition-duration: var(--wall-sharpen) !important; }");
  });

  it("开了省流量或网络是 2G 时不预取；没有网络信息时照常预取", () => {
    expect(canPrefetchWallpapers(undefined)).toBe(true);
    expect(canPrefetchWallpapers({ effectiveType: "4g" })).toBe(true);
    expect(canPrefetchWallpapers({ effectiveType: "3g", saveData: false })).toBe(true);
    expect(canPrefetchWallpapers({ saveData: true, effectiveType: "4g" })).toBe(false);
    expect(canPrefetchWallpapers({ effectiveType: "2g" })).toBe(false);
    expect(canPrefetchWallpapers({ effectiveType: "slow-2g" })).toBe(false);
  });
});

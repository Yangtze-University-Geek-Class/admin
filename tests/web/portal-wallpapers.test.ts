import { createHash } from "node:crypto";
import { existsSync, readFileSync, statSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { DEFAULT_WALLPAPER, WALLPAPERS, resolveWallpaper, shouldPlayLoop } from "../../app/web/sites/portal/lib/wallpapers";
import { problems } from "../../scripts/wallpaper-qa.mjs";
import report from "./fixtures/wallpaper-qa.json";

const PUBLIC = new URL("../../app/web/public", import.meta.url).pathname;

describe("桌面壁纸", () => {
  it("每张壁纸的文件都在，静态图与视频体积有上限（首屏以外按需加载，但也不能拖慢切换）", () => {
    for (const wallpaper of WALLPAPERS) {
      for (const file of [wallpaper.image, wallpaper.thumb, ...(wallpaper.loop ? [wallpaper.loop.webm, wallpaper.loop.mp4] : [])]) {
        const path = `${PUBLIC}${file}`;
        expect(existsSync(path), file).toBe(true);
        const limit = file.endsWith(".mp4") || file.endsWith(".webm") ? 3.6e6 : 300e3;
        expect(statSync(path).size, file).toBeLessThan(limit);
      }
    }
    expect(new Set(WALLPAPERS.map((wallpaper) => wallpaper.id)).size).toBe(WALLPAPERS.length);
  });

  it("每段循环视频都过了逐帧验收，且验收的就是现在这个文件（换视频要重跑 node scripts/wallpaper-qa.mjs）", () => {
    const videos = WALLPAPERS.flatMap((wallpaper) => (wallpaper.loop ? [wallpaper.loop.webm, wallpaper.loop.mp4] : []));
    for (const file of videos) {
      const entry = report.find((item) => `/portal/wallpapers/${item.file}` === file);
      expect(entry, `${file} 没有验收记录`).toBeDefined();
      expect(createHash("sha256").update(readFileSync(`${PUBLIC}${file}`)).digest("hex"), `${file} 换过但没重新验收`).toBe(entry!.sha256);
      expect(problems(entry!), file).toEqual([]);
    }
  });

  it("验收规则拦得住整段变暗、帧率不够、首尾接不上和末尾停住", () => {
    const good = report[0];
    expect(problems(good)).toEqual([]);
    expect(problems({ ...good, lumaDrift: 116.2, blockDrift: 132.9, worstFrame: 50 }).join()).toMatch(/第 50 帧亮度偏离/);
    expect(problems({ ...good, fps: 24 }).join()).toMatch(/帧率 24/);
    expect(problems({ ...good, seam: 7.6, maxStep: 2 }).join()).toMatch(/循环会跳/);
    expect(problems({ ...good, posterDiff: 7.6 }).join()).toMatch(/第一帧与静态图/);
    expect(problems({ ...good, minMotion: 0.08, stillFrame: 192 }).join()).toMatch(/第 192 帧起的 0.25 秒几乎不动/);
  });

  it("至少一张动态壁纸，默认用第一张", () => {
    expect(WALLPAPERS.some((wallpaper) => wallpaper.loop)).toBe(true);
    expect(DEFAULT_WALLPAPER).toBe(WALLPAPERS[0].id);
  });

  it("存下来的选择不认识时回到默认", () => {
    expect(resolveWallpaper("geek").id).toBe("geek");
    expect(resolveWallpaper("deleted-one").id).toBe(DEFAULT_WALLPAPER);
    expect(resolveWallpaper(null).id).toBe(DEFAULT_WALLPAPER);
  });

  it("减少动态或省流量时不播视频，只留静态图", () => {
    const moving = WALLPAPERS.find((wallpaper) => wallpaper.loop)!;
    const still = { ...moving, loop: undefined };
    expect(shouldPlayLoop(moving, { reducedMotion: false, saveData: false })).toBe(true);
    expect(shouldPlayLoop(moving, { reducedMotion: true, saveData: false })).toBe(false);
    expect(shouldPlayLoop(moving, { reducedMotion: false, saveData: true })).toBe(false);
    expect(shouldPlayLoop(still, { reducedMotion: false, saveData: false })).toBe(false);
  });
});

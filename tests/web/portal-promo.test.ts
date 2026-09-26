import { describe, expect, it, vi } from "vitest";
import { OS_APPS } from "../../app/web/sites/portal/lib/osApps";
import {
  PROMO,
  PROMO_BASE,
  PROMO_COOKIE,
  choosePlayback,
  firstSegment,
  hasSeenPromo,
  promoCookie,
  retryableImport,
  startEstimate,
  startLevelIndex,
  startVariant,
} from "../../app/web/sites/portal/lib/promo";

describe("宣传片：只自动播一次的 cookie", () => {
  it("只认 yugc_promo_seen=1 这一个完整的键值", () => {
    expect(hasSeenPromo("")).toBe(false);
    expect(hasSeenPromo("sid=abc; yugc_promo_seen=1")).toBe(true);
    expect(hasSeenPromo("yugc_promo_seen=1")).toBe(true);
    expect(hasSeenPromo("yugc_promo_seen=0")).toBe(false);
    expect(hasSeenPromo("xyugc_promo_seen=1")).toBe(false);
    expect(hasSeenPromo("yugc_promo_seen=10")).toBe(false);
  });

  it("host-only、一年、全站路径、Lax；https 下带 Secure；只有一个 1，不带任何个人信息", () => {
    const secure = promoCookie(true);
    expect(secure).toBe(`${PROMO_COOKIE}=1; Max-Age=31536000; Path=/; SameSite=Lax; Secure`);
    expect(promoCookie(false)).not.toContain("Secure");
    expect(secure).not.toMatch(/domain=/i);
  });
});

describe("宣传片：挑播放方式", () => {
  const none = { mse: false, mseAv1Smooth: false, native: false, nativeAv1: false, touch: false };

  it("有 MediaSource 就用 hls.js；AV1 只在流畅时用，否则 H.264", () => {
    expect(choosePlayback({ ...none, mse: true, mseAv1Smooth: true })).toEqual({ engine: "hls.js", codec: "av1", src: PROMO.masters.av1 });
    expect(choosePlayback({ ...none, mse: true })).toEqual({ engine: "hls.js", codec: "h264", src: PROMO.masters.h264 });
    // 同时能原生播也先走 hls.js
    expect(choosePlayback({ ...none, mse: true, native: true, nativeAv1: true })?.engine).toBe("hls.js");
  });

  it("手机、平板（触屏）一律 H.264：它的梯子最低到 240p，弱网也能播", () => {
    expect(choosePlayback({ ...none, mse: true, mseAv1Smooth: true, touch: true })?.codec).toBe("h264");
    expect(choosePlayback({ ...none, native: true, nativeAv1: true, touch: true })?.codec).toBe("h264");
  });

  it("没有 MediaSource 时退到原生 HLS（老 iOS、微信）；两条路都没有就不播", () => {
    expect(choosePlayback({ ...none, native: true, nativeAv1: true })).toEqual({ engine: "native", codec: "av1", src: PROMO.masters.av1 });
    expect(choosePlayback({ ...none, native: true })).toEqual({ engine: "native", codec: "h264", src: PROMO.masters.h264 });
    expect(choosePlayback(none)).toBeNull();
  });

  it("所有地址都在七牛 CDN 的 yzgc/static/promo/<版本>-<内容哈希>/ 下", () => {
    expect(PROMO_BASE).toMatch(/^https:\/\/cdn\.crosery\.com\/yzgc\/static\/promo\/[a-z0-9-]+-[0-9a-f]{12}\/$/);
    for (const url of [PROMO.masters.av1, PROMO.masters.h264, PROMO.poster]) expect(url.startsWith(PROMO_BASE)).toBe(true);
    expect(PROMO.masters.av1).toMatch(/master-av1\.m3u8$/);
    expect(PROMO.masters.h264).toMatch(/master-h264\.m3u8$/);
  });
});

describe("宣传片：桌面应用", () => {
  it("桌面上有「宣传片」，打开的是全屏面板，不是主入口、没有快捷键", () => {
    const promo = OS_APPS.find((app) => app.id === "promo");
    expect(promo).toMatchObject({ name: "宣传片", icon: "film-line", open: { kind: "panel", panel: "promo" } });
    expect(promo?.key).toBeUndefined();
    expect(promo?.primary).toBeUndefined();
    expect(OS_APPS.find((app) => app.id === "wallpaper")?.open).toEqual({ kind: "panel", panel: "wallpaper" });
    // 三个主入口仍排在最前
    expect(OS_APPS.slice(0, 4).map((app) => app.id)).toEqual(["join", "forum", "github", "promo"]);
  });
});

describe("宣传片：分包加载失败后重来（#110）", () => {
  /** 像浏览器一样：每个地址失败过一次就一直失败（HTML 规范记住失败的模块地址），没失败过的按当时网络决定 */
  function addresses(count: number) {
    const net = { online: false };
    const poisoned = new Set<number>();
    const calls: number[] = [];
    const loads = Array.from({ length: count }, (_, i) => async () => {
      calls.push(i);
      if (poisoned.has(i) || !net.online) {
        poisoned.add(i);
        throw new TypeError(`Failed to fetch dynamically imported module: chunk-${i}.js`);
      }
      return `module-${i}`;
    }) as unknown as [() => Promise<string>, ...(() => Promise<string>)[]];
    return { net, calls, loads };
  }

  it("原地址失败时马上换下一个再试一次；之后每次重来都换一个新地址，网络恢复就用那个", async () => {
    const { net, calls, loads } = addresses(4);
    const get = retryableImport(loads);
    await expect(get()).rejects.toThrow("chunk-1.js");
    expect(calls).toEqual([0, 1]);
    net.online = true;
    await expect(get()).resolves.toBe("module-2");
    expect(calls).toEqual([0, 1, 2]);
  });

  it("原地址早在预取时就失败了、现在网络已好：第一次调用就换到下一个地址拿到模块", async () => {
    const { net, calls, loads } = addresses(4);
    await expect(loads[0]()).rejects.toThrow();
    net.online = true;
    await expect(retryableImport(loads)()).resolves.toBe("module-1");
    expect(calls).toEqual([0, 0, 1]);
  });

  it("原地址一次成功就一直用它，不去碰重试地址", async () => {
    const { net, calls, loads } = addresses(4);
    net.online = true;
    const get = retryableImport(loads);
    await expect(get()).resolves.toBe("module-0");
    await expect(get()).resolves.toBe("module-0");
    expect(calls).toEqual([0, 0]);
  });

  it("地址用完了就停在最后一个：还断着网时一直失败，不越界", async () => {
    const { calls, loads } = addresses(4);
    const get = retryableImport(loads);
    for (let i = 0; i < 5; i += 1) await expect(get()).rejects.toThrow();
    expect(calls).toEqual([0, 1, 2, 3, 3, 3]);
  });
});

describe("宣传片：起播档与预取地址", () => {
  // 与 CDN 上的 master-h264.m3u8 同样的档位与峰值码率（顺序打乱，确认不依赖顺序）
  const master = [
    "#EXTM3U",
    "#EXT-X-VERSION:7",
    '#EXT-X-STREAM-INF:BANDWIDTH=2151112,AVERAGE-BANDWIDTH=1376404,CODECS="avc1.64001f,mp4a.40.2",RESOLUTION=1280x720',
    "h264_720/index.m3u8",
    '#EXT-X-STREAM-INF:BANDWIDTH=343186,AVERAGE-BANDWIDTH=238238,CODECS="avc1.64001e,mp4a.40.2",RESOLUTION=426x240',
    "h264_240/index.m3u8",
    '#EXT-X-STREAM-INF:BANDWIDTH=1227252,AVERAGE-BANDWIDTH=844822,CODECS="avc1.64001e,mp4a.40.2",RESOLUTION=854x480',
    "h264_480/index.m3u8",
    '#EXT-X-STREAM-INF:BANDWIDTH=641540,AVERAGE-BANDWIDTH=450900,CODECS="avc1.64001e,mp4a.40.2",RESOLUTION=640x360',
    "h264_360/index.m3u8",
    '#EXT-X-STREAM-INF:BANDWIDTH=3660452,CODECS="avc1.640029,mp4a.40.2",RESOLUTION=1920x1080',
    "h264_1080/index.m3u8",
  ].join("\n");

  it("起播档：峰值码率不超过估计带宽 × 0.7 的最高一档，一档都不够就用最低的", () => {
    const peaks = [2151112, 343186, 1227252, 641540, 3660452];
    expect(startLevelIndex(peaks, 1_000_000)).toBe(3); // 700k 以内最高是 360p（642k）
    expect(startLevelIndex(peaks, 4_000_000)).toBe(0); // 2.8M 以内最高是 720p
    expect(startLevelIndex(peaks, 100_000)).toBe(1); // 连 240p 都不够：用最低的 240p
    expect(startLevelIndex(peaks, 0)).toBe(1);
    expect(startLevelIndex(peaks, 100_000_000)).toBe(4);
  });

  it("带宽估计：有下行估计用它（手机封顶 1.5Mbps、桌面 4Mbps），省流量按最低，没有就按设备猜", () => {
    expect(startEstimate({ downlinkMbps: 1.2, touch: true })).toBe(1_200_000);
    expect(startEstimate({ downlinkMbps: 10, touch: true })).toBe(1_500_000);
    expect(startEstimate({ downlinkMbps: 10, touch: false })).toBe(4_000_000);
    expect(startEstimate({ downlinkMbps: 0.3, touch: false })).toBe(300_000);
    expect(startEstimate({ downlinkMbps: 10, saveData: true, touch: false })).toBe(0);
    expect(startEstimate({ touch: true })).toBe(1_000_000);
    expect(startEstimate({ touch: false })).toBe(4_000_000);
    expect(startEstimate({ downlinkMbps: 0, touch: true })).toBe(1_000_000);
  });

  it("预取的是播放器起播的同一档，地址相对 master 解析", () => {
    expect(startVariant(master, PROMO.masters.h264, 1_000_000)).toBe(`${PROMO_BASE}h264_360/index.m3u8`);
    expect(startVariant(master, PROMO.masters.h264, 4_000_000)).toBe(`${PROMO_BASE}h264_720/index.m3u8`);
    expect(startVariant(master, PROMO.masters.h264, 0)).toBe(`${PROMO_BASE}h264_240/index.m3u8`);
    expect(startVariant("#EXTM3U\n", PROMO.masters.h264, 1_000_000)).toBeNull();
  });

  it("取初始化段与第一个分片", () => {
    const level = `${PROMO_BASE}av1_720/index.m3u8`;
    const playlist = ["#EXTM3U", "#EXT-X-TARGETDURATION:4", '#EXT-X-MAP:URI="init.mp4"', "#EXTINF:4.000000,", "seg_000.m4s", "#EXTINF:4.000000,", "seg_001.m4s", "#EXT-X-ENDLIST"].join("\n");
    expect(firstSegment(playlist, level)).toEqual({ init: `${PROMO_BASE}av1_720/init.mp4`, segment: `${PROMO_BASE}av1_720/seg_000.m4s` });
    expect(firstSegment("#EXTM3U\n#EXT-X-ENDLIST", level)).toEqual({ init: null, segment: null });
  });
});

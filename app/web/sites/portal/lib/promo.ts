// 宣传片（#77）：地址、「只自动播一次」的 cookie、按浏览器能力挑编码与播放方式（纯逻辑，tests/web/portal-promo.test.ts 覆盖）。
// 片子是 HLS：fMP4 分片 4 秒一段，AV1 两档（720p、1080p）与 H.264 三档（480p、720p、1080p）各一份 master，
// 所有档位关键帧对齐。文件只在七牛 CDN（yzgc/static/promo/<版本>-<内容哈希>/），不进仓库；路径带内容哈希，换片子就换目录。
// CDN 的防盗链只放行本站域名、localhost 与空 Referer：本机开发要用 http://localhost:5173 打开，127.0.0.1 会被拒。

export const PROMO_BASE = "https://cdn.crosery.com/yzgc/static/promo/v5-tone-c70f489a19e9/";

export const PROMO = {
  masters: { av1: `${PROMO_BASE}master-av1.m3u8`, h264: `${PROMO_BASE}master-h264.m3u8` },
  poster: `${PROMO_BASE}poster.jpg`,
  /** 用 1080p 档的编码串判断能不能解 AV1（720p 档的等级更低，能解 1080p 就能解 720p） */
  av1Codec: 'video/mp4; codecs="av01.0.08M.10, mp4a.40.2"',
  h264Codec: 'video/mp4; codecs="avc1.640029, mp4a.40.2"',
  seconds: 105,
} as const;

/** 首次点「加入我们」自动播过一次之后写这个 cookie：host-only（不写 Domain）、只有一个 1，不带任何个人信息。 */
export const PROMO_COOKIE = "yugc_promo_seen";
const ONE_YEAR = 365 * 24 * 60 * 60;

export function hasSeenPromo(cookie: string): boolean {
  return cookie.split(";").some((part) => part.trim() === `${PROMO_COOKIE}=1`);
}

export function promoCookie(secure: boolean): string {
  return `${PROMO_COOKIE}=1; Max-Age=${ONE_YEAR}; Path=/; SameSite=Lax${secure ? "; Secure" : ""}`;
}

export type Codec = "av1" | "h264";
export type Engine = "hls.js" | "native";
export type Playback = { engine: Engine; codec: Codec; src: string };

/** 浏览器能力：mse 是否有 MediaSource（hls.js 能不能用），native 是否原生播 HLS（Safari、iOS、部分安卓）。 */
export type Capabilities = {
  mse: boolean;
  /** MediaSource 能解 AV1，且 mediaCapabilities 说 1080p 播得流畅（软解吃力的老机器走 H.264） */
  mseAv1Smooth: boolean;
  native: boolean;
  /** 原生播放器对 AV1 的 canPlayType 是 "probably" */
  nativeAv1: boolean;
};

/**
 * 先用 hls.js（有 MediaSource 的浏览器，包括桌面 Safari 与 iOS 17.1+ 的 ManagedMediaSource），
 * 再退到原生 HLS（老 iOS、微信内置浏览器）。AV1 只在确定能流畅解码时用，否则一律 H.264。
 * 两条路都走不通返回 null：不播，直接放行到表单。
 */
export function choosePlayback(caps: Capabilities): Playback | null {
  if (caps.mse) {
    const codec: Codec = caps.mseAv1Smooth ? "av1" : "h264";
    return { engine: "hls.js", codec, src: PROMO.masters[codec] };
  }
  if (caps.native) {
    const codec: Codec = caps.nativeAv1 ? "av1" : "h264";
    return { engine: "native", codec, src: PROMO.masters[codec] };
  }
  return null;
}

/** 在浏览器里量出上面的能力。只读，不下载任何东西。 */
export async function detectCapabilities(video: HTMLVideoElement): Promise<Capabilities> {
  const w = window as typeof window & { ManagedMediaSource?: typeof MediaSource };
  const Source = w.ManagedMediaSource ?? w.MediaSource;
  const mse = typeof Source?.isTypeSupported === "function" && Source.isTypeSupported(PROMO.h264Codec);
  let mseAv1Smooth = false;
  if (mse && Source.isTypeSupported(PROMO.av1Codec)) {
    try {
      const info = await navigator.mediaCapabilities?.decodingInfo({
        type: "media-source",
        video: { contentType: 'video/mp4; codecs="av01.0.08M.10"', width: 1920, height: 1080, bitrate: 3_400_000, framerate: 30 },
      });
      mseAv1Smooth = Boolean(info?.supported && info.smooth);
    } catch {
      mseAv1Smooth = false;
    }
  }
  const native = video.canPlayType("application/vnd.apple.mpegurl") !== "";
  const nativeAv1 = native && video.canPlayType(PROMO.av1Codec) === "probably";
  return { mse, mseAv1Smooth, native, nativeAv1 };
}

/** 进度文案：1:05 / 1:45 */
export function clock(seconds: number): string {
  const s = Math.max(0, Math.floor(Number.isFinite(seconds) ? seconds : 0));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}

/**
 * 预热：先和 CDN 握手（preconnect，按 hls.js 的跨域请求带 crossorigin），并让调用方预取播放器分包。
 * 桌面出现、而这个浏览器还没看过宣传片时调用：接下来多半会点「加入我们」，省掉 DNS 与 TLS 的几次往返。
 */
export function preconnectPromo(): void {
  if (typeof document === "undefined" || document.querySelector("link[data-promo-preconnect]")) return;
  const link = document.createElement("link");
  link.rel = "preconnect";
  link.href = new URL(PROMO_BASE).origin;
  link.crossOrigin = "anonymous";
  link.dataset.promoPreconnect = "";
  document.head.append(link);
}

/**
 * master 里码率最低的一档（播放器固定从它起播：startLevel 0），返回它的播放列表地址。
 * hls.js 给档位排序时先比分辨率、再比码率；现在这套档位里码率最低的正好也是分辨率最低的，两者一致。
 * 换片子时如果出现「低分辨率反而码率高」的档位，这里要改成先比 RESOLUTION，否则预取的不是起播那一档。
 */
export function startVariant(master: string, masterUrl: string): string | null {
  const lines = master.split(/\r?\n/);
  let best: { bandwidth: number; uri: string } | null = null;
  lines.forEach((line, index) => {
    const match = /^#EXT-X-STREAM-INF:.*?\bBANDWIDTH=(\d+)/.exec(line);
    const uri = lines[index + 1]?.trim();
    if (!match || !uri || uri.startsWith("#")) return;
    const bandwidth = Number(match[1]);
    if (!best || bandwidth < best.bandwidth) best = { bandwidth, uri };
  });
  return best ? new URL((best as { uri: string }).uri, masterUrl).href : null;
}

/** 一档播放列表里的初始化段与第一个分片 */
export function firstSegment(playlist: string, playlistUrl: string): { init: string | null; segment: string | null } {
  const init = /#EXT-X-MAP:URI="([^"]+)"/.exec(playlist)?.[1];
  const segment = playlist.split(/\r?\n/).map((line) => line.trim()).find((line) => line && !line.startsWith("#"));
  return { init: init ? new URL(init, playlistUrl).href : null, segment: segment ? new URL(segment, playlistUrl).href : null };
}

/**
 * 把起播要用的东西先拉进浏览器缓存：master → 最低一档的播放列表 → 初始化段 + 第一个分片（约 0.5–0.8 MB）。
 * 这些文件路径带内容哈希、CDN 缓存一年且带 CORS，之后 hls.js 的请求直接命中缓存，点「加入我们」后几乎马上出第一帧。
 * 只在桌面上、还没看过宣传片、没开省流量时由 YugcOs 调用；失败无所谓，播放时照常从 CDN 取。
 */
export async function prefetchPromoStart(codec: Codec): Promise<void> {
  const get = async (url: string) => {
    const response = await fetch(url, { mode: "cors", credentials: "omit" });
    if (!response.ok) throw new Error(`${response.status} ${url}`);
    return response;
  };
  const masterUrl = PROMO.masters[codec];
  const level = startVariant(await (await get(masterUrl)).text(), masterUrl);
  if (!level) return;
  const { init, segment } = firstSegment(await (await get(level)).text(), level);
  await Promise.all([init, segment].filter((url): url is string => Boolean(url)).map(async (url) => (await get(url)).arrayBuffer()));
}

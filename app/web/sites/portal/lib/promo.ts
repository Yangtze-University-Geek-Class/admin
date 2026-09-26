// 宣传片（#77）：地址、「只自动播一次」的 cookie、按浏览器能力挑编码与播放方式（纯逻辑，tests/web/portal-promo.test.ts 覆盖）。
// 片子是 HLS：fMP4 分片 4 秒一段，AV1 三档（480p、720p、1080p）与 H.264 五档（240p、360p、480p、720p、1080p）各一份 master，
// 所有档位关键帧对齐。240p、360p 两档音频 64k，给弱网手机（#103）。文件只在七牛 CDN（yzgc/static/promo/<版本>-<内容哈希>/），不进仓库；路径带内容哈希，换片子就换目录。
// CDN 的防盗链只放行本站域名、localhost 与空 Referer：本机开发要用 http://localhost:5173 打开，127.0.0.1 会被拒。

export const PROMO_BASE = "https://cdn.crosery.com/yzgc/static/promo/v5-tone-e1419fc9331a/";

export const PROMO = {
  masters: { av1: `${PROMO_BASE}master-av1.m3u8`, h264: `${PROMO_BASE}master-h264.m3u8` },
  poster: `${PROMO_BASE}poster.jpg`,
  /** 手机用的小封面（640 宽，58KB）：弱网时 1920 宽的封面（171KB）会和第一个分片抢带宽 */
  posterSmall: `${PROMO_BASE}poster-640.jpg`,
  /** 用 1080p 档的编码串判断能不能解 AV1（720p 档的等级更低，能解 1080p 就能解 720p） */
  av1Codec: 'video/mp4; codecs="av01.0.08M.10, mp4a.40.2"',
  h264Codec: 'video/mp4; codecs="avc1.640029, mp4a.40.2"',
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
  /** MediaSource 能解 AV1，且 mediaCapabilities 说 1080p 播得流畅、还是硬解（powerEfficient）；软解吃力的机器走 H.264 */
  mseAv1Smooth: boolean;
  native: boolean;
  /** 原生播放器对 AV1 的 canPlayType 是 "probably" */
  nativeAv1: boolean;
  /** 触屏为主的设备（手机、平板，pointer: coarse）：一律 H.264，它的梯子最低到 240p，弱网也能播 */
  touch: boolean;
};

/**
 * 先用 hls.js（有 MediaSource 的浏览器，包括桌面 Safari 与 iOS 17.1+ 的 ManagedMediaSource），
 * 再退到原生 HLS（老 iOS、微信内置浏览器）。AV1 只在桌面上确定能硬解流畅时用，否则一律 H.264。
 * 两条路都走不通返回 null：不播，直接放行到表单。
 */
export function choosePlayback(caps: Capabilities): Playback | null {
  if (caps.mse) {
    const codec: Codec = caps.mseAv1Smooth && !caps.touch ? "av1" : "h264";
    return { engine: "hls.js", codec, src: PROMO.masters[codec] };
  }
  if (caps.native) {
    const codec: Codec = caps.nativeAv1 && !caps.touch ? "av1" : "h264";
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
      mseAv1Smooth = Boolean(info?.supported && info.smooth && info.powerEfficient);
    } catch {
      mseAv1Smooth = false;
    }
  }
  const native = video.canPlayType("application/vnd.apple.mpegurl") !== "";
  const nativeAv1 = native && video.canPlayType(PROMO.av1Codec) === "probably";
  const touch = typeof window.matchMedia === "function" && window.matchMedia("(pointer: coarse)").matches;
  return { mse, mseAv1Smooth, native, nativeAv1, touch };
}

/**
 * 起播档的带宽估计（bit/s）。有 Network Information（安卓 Chrome、Edge）就用它的下行估计；开了省流量按最低一档；
 * 都没有就按设备猜：触屏 1Mbps（乘 0.7 后落在 360p），桌面 4Mbps（落在 720p）。iOS 没有 Network Information，一律按猜的起播。
 * 下行估计会过时、偏高（DevTools 限速时 Chrome 仍报 10Mbps，实测从 1080p 起播、首帧 30 秒），所以再封顶：
 * 触屏最多 1.5Mbps（起播不超过 360p），桌面最多 4Mbps（不超过 720p）。只决定第一段取哪档，之后由 hls.js 按实测切换。
 */
export function startEstimate(env: { downlinkMbps?: number; saveData?: boolean; touch: boolean }): number {
  if (env.saveData) return 0;
  const cap = env.touch ? 1_500_000 : 4_000_000;
  if (env.downlinkMbps && env.downlinkMbps > 0) return Math.min(cap, Math.round(env.downlinkMbps * 1_000_000));
  return env.touch ? 1_000_000 : 4_000_000;
}

/** 在浏览器里取 startEstimate 的输入 */
export function browserEstimate(touch: boolean): number {
  const connection = (navigator as Navigator & { connection?: { downlink?: number; saveData?: boolean } }).connection;
  return startEstimate({ downlinkMbps: connection?.downlink, saveData: connection?.saveData, touch });
}

/**
 * 分包加载失败后还能重来的 import（#110）。浏览器按 HTML 规范记住加载失败的模块地址（Chrome、Firefox 如此），
 * 同一个地址再 import 不发请求、直接失败（桌面预取时断网失败也会记下），只有换个地址才会重新下载。
 * loads 第一个是原来的 import（Vite 靠它分包、预取），后面是同一模块带 ?retry=n 的写死地址：Vite 把每个都打成文件名不同的分包。
 * 每次调用用当前这个地址；失败了下次换下一个，用完了就一直用最后一个（刷新页面后浏览器才忘掉失败）。
 * 原地址失败时马上换下一个再试一次：它可能早在预取时就失败了，现在网络已经好了。
 * 边界检查不许非字面量 import、CSP 不许 eval，所以只能是有限个写死的地址。
 */
export function retryableImport<T>(loads: readonly [() => Promise<T>, ...(() => Promise<T>)[]]): () => Promise<T> {
  let index = 0;
  const attempt = async () => {
    try {
      return await loads[index]();
    } catch (error) {
      if (index < loads.length - 1) index += 1;
      throw error;
    }
  };
  return () => (index === 0 ? attempt().catch(() => attempt()) : attempt());
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

/** 起播时只用估计带宽的这个比例：估计往往偏高，第一段宁可低一档也不要卡 */
const START_HEADROOM = 0.7;

/**
 * 起播那一档在 bandwidths（各档峰值码率，任意顺序）里的下标：不超过估计带宽 × 0.7 的档位里码率最高的一档，
 * 一档都不够就用码率最低的一档。播放器（hls.js 的 levels）和桌面上的预取（master 里的档位）都用它，两边挑的是同一档。
 */
export function startLevelIndex(bandwidths: number[], estimate: number): number {
  let fit = -1;
  let lowest = -1;
  bandwidths.forEach((bandwidth, index) => {
    if (lowest < 0 || bandwidth < bandwidths[lowest]) lowest = index;
    if (bandwidth <= estimate * START_HEADROOM && (fit < 0 || bandwidth > bandwidths[fit])) fit = index;
  });
  return fit >= 0 ? fit : lowest;
}

/** master 里起播那一档（startLevelIndex）的播放列表地址，相对 master 解析 */
export function startVariant(master: string, masterUrl: string, estimate: number): string | null {
  const lines = master.split(/\r?\n/);
  const variants: { bandwidth: number; uri: string }[] = [];
  lines.forEach((line, index) => {
    const match = /^#EXT-X-STREAM-INF:.*?\bBANDWIDTH=(\d+)/.exec(line);
    const uri = lines[index + 1]?.trim();
    if (match && uri && !uri.startsWith("#")) variants.push({ bandwidth: Number(match[1]), uri });
  });
  if (!variants.length) return null;
  const pick = variants[startLevelIndex(variants.map((variant) => variant.bandwidth), estimate)];
  return new URL(pick.uri, masterUrl).href;
}

/** 一档播放列表里的初始化段与第一个分片 */
export function firstSegment(playlist: string, playlistUrl: string): { init: string | null; segment: string | null } {
  const init = /#EXT-X-MAP:URI="([^"]+)"/.exec(playlist)?.[1];
  const segment = playlist.split(/\r?\n/).map((line) => line.trim()).find((line) => line && !line.startsWith("#"));
  return { init: init ? new URL(init, playlistUrl).href : null, segment: segment ? new URL(segment, playlistUrl).href : null };
}

/**
 * 把起播要用的东西先拉进浏览器缓存：master → 起播那一档（startVariant）的播放列表 → 初始化段 + 第一个分片。
 * 这些文件路径带内容哈希、CDN 缓存一年且带 CORS，之后 hls.js 的请求直接命中缓存，点「加入我们」后几乎马上出第一帧。
 * 只在桌面上、还没看过宣传片、没开省流量时由 YugcOs 调用；失败无所谓，播放时照常从 CDN 取。
 */
export async function prefetchPromoStart(codec: Codec, estimate: number): Promise<void> {
  const get = async (url: string) => {
    const response = await fetch(url, { mode: "cors", credentials: "omit" });
    if (!response.ok) throw new Error(`${response.status} ${url}`);
    return response;
  };
  const masterUrl = PROMO.masters[codec];
  const level = startVariant(await (await get(masterUrl)).text(), masterUrl, estimate);
  if (!level) return;
  const { init, segment } = firstSegment(await (await get(level)).text(), level);
  await Promise.all([init, segment].filter((url): url is string => Boolean(url)).map(async (url) => (await get(url)).arrayBuffer()));
}

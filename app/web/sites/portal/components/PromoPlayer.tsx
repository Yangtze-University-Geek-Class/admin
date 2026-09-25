// 宣传片播放层（#77）：全屏盖在页面上，任何时候都能跳过或关闭。
// gate：第一次点「加入我们」时由 JoinUs 挂出来，播完、跳过都会进信纸；replay：桌面「宣传片」应用重看，关掉回桌面。
// 播放按 lib/promo.ts 的规则挑 hls.js 或原生 HLS、AV1 或 H.264；hls.js 按需加载，不进首屏包。
// 能带声音自动播就带声音；浏览器不让就静音播并亮出「打开声音」；静音也不让播（或者用户要求减少动态效果）就停在封面等点播放。
// 浏览器两种方式都不支持（unsupported）或加载失败（failed）时直接结束（gate 进信纸），宣传片不挡报名；
// unsupported 以后也播不了，算作看过；failed 可能只是网络问题，不记，下次再试。
import { useCallback, useEffect, useRef, useState, type KeyboardEvent } from "react";
import type Hls from "hls.js/light";
import { PROMO, choosePlayback, clock, detectCapabilities, type Playback } from "../lib/promo";
import { useReducedMotion } from "../lib/useReducedMotion";
import Icon from "./Icon";
import "../styles/promo.css";

export type PromoEnd = "ended" | "skipped" | "unsupported" | "failed";

type Props = {
  mode: "gate" | "replay";
  /** 真正开始播放、跳过、播完或浏览器根本播不了时调用一次（gate 用它写「已播过」的 cookie） */
  onSeen?: () => void;
  onClose: (reason: PromoEnd) => void;
};

/** 过了这么久还没出第一帧，就提示可以先跳过 */
const SLOW_MS = 6000;

export default function PromoPlayer({ mode, onSeen, onClose }: Props) {
  const reducedMotion = useReducedMotion();
  const video = useRef<HTMLVideoElement>(null);
  const dialog = useRef<HTMLDivElement>(null);
  const hls = useRef<Hls | null>(null);
  const seen = useRef(false);
  const closed = useRef(false);
  const [playback, setPlayback] = useState<Playback | null>(null);
  const [state, setState] = useState<"loading" | "playing" | "paused" | "waiting-click">("loading");
  const [muted, setMuted] = useState(false);
  const [slow, setSlow] = useState(false);
  const [time, setTime] = useState(0);

  const markSeen = useCallback(() => {
    if (seen.current) return;
    seen.current = true;
    onSeen?.();
  }, [onSeen]);

  const finish = useCallback(
    (reason: PromoEnd) => {
      if (closed.current) return;
      closed.current = true;
      if (reason !== "failed") markSeen();
      video.current?.pause();
      onClose(reason);
    },
    [markSeen, onClose],
  );

  // 挑播放方式并挂上片源
  useEffect(() => {
    const element = video.current;
    if (!element) return;
    let cancelled = false;
    // hls.js 分包与能力探测同时开始：多数浏览器会用 hls.js，串行等会多一次往返
    const hlsModule = import("hls.js/light");
    hlsModule.catch(() => undefined);
    (async () => {
      const choice = choosePlayback(await detectCapabilities(element));
      if (cancelled) return;
      if (!choice) return finish("unsupported");
      setPlayback(choice);
      if (choice.engine === "native") {
        element.src = choice.src;
      } else {
        let HlsJs: typeof import("hls.js/light").default;
        try {
          HlsJs = (await hlsModule).default;
        } catch {
          return finish("failed");
        }
        if (cancelled) return;
        // 不开 worker：fMP4 不需要转封装，也省得给 CSP 加 worker-src blob:
        // 从码率最低的一档起播（与桌面上预取的是同一档），第一段下完再按实测带宽往上切
        const player = new HlsJs({ enableWorker: false, capLevelToPlayerSize: true, maxBufferLength: 20, startLevel: 0 });
        hls.current = player;
        let recovered = false;
        player.on(HlsJs.Events.ERROR, (_event, data) => {
          if (!data.fatal) return;
          if (data.type === HlsJs.ErrorTypes.MEDIA_ERROR && !recovered) {
            recovered = true;
            player.recoverMediaError();
            return;
          }
          finish("failed");
        });
        player.loadSource(choice.src);
        player.attachMedia(element);
      }
      if (reducedMotion) {
        setState("waiting-click");
        return;
      }
      try {
        element.muted = false;
        await element.play();
      } catch (error) {
        if (cancelled || (error as DOMException).name !== "NotAllowedError") return;
        try {
          element.muted = true;
          setMuted(true);
          await element.play();
        } catch {
          if (!cancelled) setState("waiting-click");
        }
      }
    })();
    return () => {
      cancelled = true;
      hls.current?.destroy();
      hls.current = null;
      element.removeAttribute("src");
      element.load();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- 只在挂载时挑一次片源
  }, []);

  useEffect(() => {
    if (state !== "loading") return;
    const timer = window.setTimeout(() => setSlow(true), SLOW_MS);
    return () => window.clearTimeout(timer);
  }, [state]);

  // 打开时把焦点放在「跳过 / 关闭」上
  useEffect(() => {
    dialog.current?.querySelector<HTMLElement>("[data-promo-close]")?.focus({ preventScroll: true });
  }, []);

  const togglePlay = () => {
    const element = video.current;
    if (!element) return;
    if (element.paused) void element.play().catch(() => setState("waiting-click"));
    else element.pause();
  };
  const toggleMute = () => {
    const element = video.current;
    if (!element) return;
    element.muted = !element.muted;
    setMuted(element.muted);
  };

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key === "Escape") {
      event.stopPropagation();
      finish("skipped");
    } else if (event.key === " " && !(event.target as HTMLElement).closest("button")) {
      event.preventDefault();
      togglePlay();
    } else if (event.key.toLowerCase() === "m" && !event.metaKey && !event.ctrlKey) {
      toggleMute();
    } else if (event.key === "Tab") {
      // 焦点留在播放层里
      const items = [...(dialog.current?.querySelectorAll<HTMLElement>("button:not([disabled])") ?? [])];
      if (!items.length) return;
      const index = items.indexOf(document.activeElement as HTMLElement);
      const next = event.shiftKey ? (index <= 0 ? items.length - 1 : index - 1) : index === items.length - 1 ? 0 : index + 1;
      event.preventDefault();
      items[next].focus();
    }
  };

  const duration = video.current?.duration && Number.isFinite(video.current.duration) ? video.current.duration : PROMO.seconds;
  const closeLabel = mode === "gate" ? "跳过" : "关闭";
  return (
    // tabIndex -1：点视频或空白处时焦点落在播放层上而不是 body，Esc、空格、M 照样能用
    <div ref={dialog} className="pt-root pt-promo" role="dialog" aria-modal="true" aria-label="极客班宣传片" tabIndex={-1} onKeyDown={onKeyDown} data-codec={playback?.codec} data-engine={playback?.engine}>
      <video
        ref={video}
        className="pt-promo-video"
        poster={PROMO.poster}
        playsInline
        preload="auto"
        onPlaying={() => {
          setState("playing");
          setSlow(false);
          markSeen();
        }}
        onPause={() => setState((current) => (current === "playing" ? "paused" : current))}
        onTimeUpdate={(event) => setTime(event.currentTarget.currentTime)}
        onEnded={() => finish("ended")}
        onError={() => playback?.engine === "native" && finish("failed")}
        onClick={togglePlay}
      />

      <div className="pt-promo-top">
        <span className="pt-promo-title">极客班宣传片</span>
        <button type="button" className="pt-promo-chip" data-promo-close onClick={() => finish("skipped")}>
          <Icon name={mode === "gate" ? "skip-forward-line" : "close-line"} size={16} />
          {closeLabel}
          <kbd>Esc</kbd>
        </button>
      </div>

      {state === "loading" && (
        <p className="pt-promo-status" role="status">
          <Icon name="loader-4-line" size={18} className="pt-spin" />
          {slow ? `网络有点慢，可以先点「${closeLabel}」` : "正在加载…"}
        </p>
      )}
      {state === "waiting-click" && (
        <button type="button" className="pt-promo-play" onClick={togglePlay}>
          <Icon name="play-fill" size={28} />
          播放宣传片
        </button>
      )}

      <div className="pt-promo-bar">
        <button type="button" className="pt-promo-icon" aria-label={state === "playing" ? "暂停" : "播放"} onClick={togglePlay}>
          <Icon name={state === "playing" ? "pause-fill" : "play-fill"} size={18} />
        </button>
        <div className="pt-promo-track" aria-hidden="true">
          <i style={{ width: `${Math.min(100, (time / duration) * 100)}%` }} />
        </div>
        <span className="pt-promo-time">
          {clock(time)} / {clock(duration)}
        </span>
        {muted ? (
          <button type="button" className="pt-promo-chip is-sound" onClick={toggleMute}>
            <Icon name="volume-mute-line" size={16} />
            打开声音
          </button>
        ) : (
          <button type="button" className="pt-promo-icon" aria-label="静音" onClick={toggleMute}>
            <Icon name="volume-up-line" size={18} />
          </button>
        )}
      </div>
    </div>
  );
}

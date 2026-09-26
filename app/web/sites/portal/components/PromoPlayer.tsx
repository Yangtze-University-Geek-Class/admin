// 宣传片播放层（#77、#103）：全屏盖在页面上，任何时候都能跳过或关闭。
// gate：第一次点「加入我们」时由 JoinUs 挂出来，播完、跳过都会进信纸；replay：桌面「宣传片」应用重看，关掉回桌面。
// 画面按 16:9 放进屏幕，控件叠在画面里（像游戏过场）：「跳过 / 关闭」一直在右上角，静音时「打开声音」一直在左上角，
// 其余控件播放时几秒不动就淡出，动一下鼠标、点一下屏幕或按键就回来；画面外的空白由画面本身的低清模糊色填满。
// 手机竖着拿时整个画面转 90 度横过来铺满（promo.css，由 PromoLazy 跟官网主包加载），横过手机就是正常横屏。
// 播放按 lib/promo.ts 的规则挑 hls.js 或原生 HLS、AV1 或 H.264，从估计带宽撑得住的一档起播；hls.js 按需加载，不进首屏包，
// 分包加载失败过（包括桌面预取时断网）下次换地址重新加载（lib/promo.ts 的 retryableImport，#110）。
// 能带声音自动播就带声音；浏览器不让就静音播并亮出「打开声音」；静音也不让播（或者用户要求减少动态效果）就停在封面等点播放。
// 浏览器两种方式都不支持（unsupported）或加载失败（failed）时直接结束（gate 进信纸），宣传片不挡报名；
// unsupported 以后也播不了，算作看过；failed 可能只是网络问题，不记，下次再试。
import { useCallback, useEffect, useRef, useState, type KeyboardEvent, type PointerEvent } from "react";
import type Hls from "hls.js/light";
import { PROMO, browserEstimate, choosePlayback, clock, detectCapabilities, retryableImport, startLevelIndex, type Playback } from "../lib/promo";
import { useReducedMotion } from "../lib/useReducedMotion";
import Icon from "./Icon";

export type PromoEnd = "ended" | "skipped" | "unsupported" | "failed";

type Props = {
  mode: "gate" | "replay";
  /** 真正开始播放、跳过、播完或浏览器根本播不了时调用一次（gate 用它写「已播过」的 cookie） */
  onSeen?: () => void;
  onClose: (reason: PromoEnd) => void;
};

/** 过了这么久还没出画面（或卡住没恢复），就提示可以先跳过 */
const SLOW_MS = 6000;
/** 播放中这么久没有操作，除「跳过」「打开声音」外的控件淡出 */
const IDLE_MS = 2500;
/** 背景模糊色多久取一次画面：只画 32×18 的小图，开销可以忽略 */
const AMBIENT_MS = 500;

// 换地址的那几个以生产构建为准（Vite 把每个打成文件名不同的分包）
const importHls = retryableImport([
  () => import("hls.js/light"),
  // @ts-expect-error 同一模块，只为换地址
  () => import("hls.js/light?retry=1"),
  // @ts-expect-error 同上
  () => import("hls.js/light?retry=2"),
  // @ts-expect-error 同上
  () => import("hls.js/light?retry=3"),
]);

export default function PromoPlayer({ mode, onSeen, onClose }: Props) {
  const reducedMotion = useReducedMotion();
  const video = useRef<HTMLVideoElement>(null);
  const dialog = useRef<HTMLDivElement>(null);
  const ambient = useRef<HTMLCanvasElement>(null);
  const hls = useRef<Hls | null>(null);
  const seen = useRef(false);
  const closed = useRef(false);
  const idleTimer = useRef<number | undefined>(undefined);
  const touch = useRef(false);
  const [playback, setPlayback] = useState<Playback | null>(null);
  const [state, setState] = useState<"loading" | "playing" | "paused" | "buffering" | "waiting-click">("loading");
  const [muted, setMuted] = useState(false);
  const [slow, setSlow] = useState(false);
  const [idle, setIdle] = useState(false);
  const [time, setTime] = useState(0);
  const [poster] = useState(() => (typeof window !== "undefined" && window.matchMedia?.("(pointer: coarse)").matches ? PROMO.posterSmall : PROMO.poster));
  const hidden = idle && state === "playing";
  const hiddenRef = useRef(hidden);
  hiddenRef.current = hidden;

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

  /** 控件回来，并重新计时淡出 */
  const wake = useCallback(() => {
    setIdle(false);
    window.clearTimeout(idleTimer.current);
    idleTimer.current = window.setTimeout(() => setIdle(true), IDLE_MS);
  }, []);
  useEffect(() => {
    wake();
    return () => window.clearTimeout(idleTimer.current);
  }, [wake]);

  // 挑播放方式并挂上片源
  useEffect(() => {
    const element = video.current;
    if (!element) return;
    let cancelled = false;
    // hls.js 分包与能力探测同时开始：多数浏览器会用 hls.js，串行等会多一次往返
    const hlsModule = importHls();
    hlsModule.catch(() => undefined);
    (async () => {
      const caps = await detectCapabilities(element);
      const choice = choosePlayback(caps);
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
          // 卸载后分包才失败：播放层已经不在了，不再结束一次
          if (!cancelled) finish("failed");
          return;
        }
        if (cancelled) return;
        const estimate = browserEstimate(caps.touch);
        // 不开 worker：fMP4 不需要转封装，也省得给 CSP 加 worker-src blob:
        // 起播档由 startLevelIndex 定（与桌面上预取的是同一档），之后按实测带宽切换；缓冲放到 30 秒，弱网少卡
        const player = new HlsJs({
          enableWorker: false,
          autoStartLoad: false,
          capLevelToPlayerSize: true,
          maxDevicePixelRatio: 2,
          maxBufferLength: 30,
          maxMaxBufferLength: 60,
          abrEwmaDefaultEstimate: Math.max(estimate, 200_000),
        });
        hls.current = player;
        let recovered = false;
        player.on(HlsJs.Events.MANIFEST_PARSED, () => {
          player.startLevel = startLevelIndex(player.levels.map((level) => level.bitrate), estimate);
          player.startLoad(-1);
        });
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
        if (cancelled) return;
        const name = (error as DOMException).name;
        // 片源本身放不了：和加载失败一样直接结束
        if (name === "NotSupportedError") return finish("failed");
        // 其他原因（比如刚开始播就被新的加载打断，AbortError）：停在封面等人点，不一直转圈
        if (name !== "NotAllowedError") return setState("waiting-click");
        try {
          element.muted = true;
          setMuted(true);
          await element.play();
        } catch {
          if (!cancelled) setState("waiting-click");
        }
      }
    })().catch(() => {
      // 起播过程中意外抛错（能力探测、hls.js 初始化等）：按加载失败结束，不留一直转圈的播放层
      if (!cancelled) finish("failed");
    });
    return () => {
      cancelled = true;
      hls.current?.destroy();
      hls.current = null;
      element.removeAttribute("src");
      element.load();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- 只在挂载时挑一次片源
  }, []);

  // 画面外的空白：把当前画面缩成 32×18 画到背景画布上，CSS 再放大模糊。出画面之前先用封面。
  // 跨域的原生 HLS 会让画布「受污染」，但这里只显示、从不读像素，不受影响。
  useEffect(() => {
    const canvas = ambient.current;
    const element = video.current;
    const context = canvas?.getContext("2d");
    if (!canvas || !element || !context) return;
    const draw = (source: CanvasImageSource) => context.drawImage(source, 0, 0, canvas.width, canvas.height);
    const image = new Image();
    image.onload = () => {
      if (element.readyState < 2) draw(image);
    };
    image.src = poster;
    const timer = window.setInterval(() => {
      if (element.readyState >= 2 && !element.paused) draw(element);
    }, AMBIENT_MS);
    return () => window.clearInterval(timer);
  }, [poster]);

  useEffect(() => {
    if (state !== "loading" && state !== "buffering") return;
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

  const onPointerDown = (event: PointerEvent<HTMLDivElement>) => {
    touch.current = event.pointerType === "touch";
    if (!touch.current) wake();
  };
  // 点画面：鼠标点是暂停 / 继续；手指点是显示 / 收起控件（暂停用控件里的按钮），和手机上的视频播放器一样
  const onVideoClick = () => {
    if (!touch.current) return togglePlay();
    if (hiddenRef.current) wake();
    else {
      window.clearTimeout(idleTimer.current);
      setIdle(true);
    }
  };

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    wake();
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
  const waiting = state === "loading" || state === "buffering";
  return (
    // tabIndex -1：点视频或空白处时焦点落在播放层上而不是 body，Esc、空格、M 照样能用
    <div
      ref={dialog}
      className={`pt-root pt-promo${hidden ? " is-idle" : ""}`}
      role="dialog"
      aria-modal="true"
      aria-label="极客班宣传片"
      tabIndex={-1}
      onKeyDown={onKeyDown}
      onPointerDown={onPointerDown}
      onPointerMove={(event) => event.pointerType === "mouse" && wake()}
      // 焦点移到某个按钮上（键盘 Tab）才叫醒控件；点画面时焦点落在播放层自己身上，交给 onVideoClick 处理，
      // 否则手指第一次点画面会先被这里叫醒、紧接着又被 click 收起
      onFocus={(event) => event.target !== event.currentTarget && wake()}
      data-codec={playback?.codec}
      data-engine={playback?.engine}
    >
      <canvas ref={ambient} className="pt-promo-ambient" width={32} height={18} aria-hidden="true" />
      <div className="pt-promo-frame">
        <div className="pt-promo-stage">
          <video
            ref={video}
            className="pt-promo-video"
            poster={poster}
            playsInline
            preload="auto"
            onPlaying={() => {
              setState("playing");
              setSlow(false);
              markSeen();
            }}
            onWaiting={() => setState((current) => (current === "playing" ? "buffering" : current))}
            onPause={() => setState((current) => (current === "playing" || current === "buffering" ? "paused" : current))}
            onTimeUpdate={(event) => setTime(event.currentTarget.currentTime)}
            onEnded={() => finish("ended")}
            onError={() => playback?.engine === "native" && finish("failed")}
            onClick={onVideoClick}
          />

          <button type="button" className="pt-promo-chip pt-promo-close" data-promo-close onClick={() => finish("skipped")}>
            <Icon name={mode === "gate" ? "skip-forward-line" : "close-line"} size={16} />
            {closeLabel}
            <kbd>Esc</kbd>
          </button>
          {muted && (
            <button type="button" className="pt-promo-chip pt-promo-unmute" onClick={toggleMute}>
              <Icon name="volume-mute-line" size={16} />
              打开声音
            </button>
          )}

          {waiting && (
            <p className="pt-promo-status" role="status">
              <Icon name="loader-4-line" size={18} className="pt-spin" />
              {slow ? `网络有点慢，可以先点「${closeLabel}」` : state === "buffering" ? "正在缓冲…" : "正在加载…"}
            </p>
          )}
          {state === "waiting-click" && (
            <button type="button" className="pt-promo-play" onClick={togglePlay}>
              <Icon name="play-fill" size={28} />
              播放宣传片
            </button>
          )}

          <div className="pt-promo-bar">
            <button type="button" className="pt-promo-icon" aria-label={state === "playing" || state === "buffering" ? "暂停" : "播放"} onClick={togglePlay}>
              <Icon name={state === "playing" || state === "buffering" ? "pause-fill" : "play-fill"} size={18} />
            </button>
            <div className="pt-promo-track" aria-hidden="true">
              <i style={{ width: `${Math.min(100, (time / duration) * 100)}%` }} />
            </div>
            <span className="pt-promo-time">
              {clock(time)} / {clock(duration)}
            </span>
            {/* 静音时由左上角一直显示的「打开声音」负责，这里只放「静音」 */}
            {!muted && (
              <button type="button" className="pt-promo-icon" aria-label="静音" onClick={toggleMute}>
                <Icon name="volume-up-line" size={18} />
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

// 桌面壁纸：两层叠放，换壁纸时新的一层在上面淡入，淡入完成后旧的一层才卸掉，全程没有空白帧。
// 每层先显示静态图；有视频且允许动态时，视频开始播放后再淡入到图上面，循环播放。
// 视频播不了（格式不支持、自动播放被拦、省流量）就一直停在静态图上。
import { useEffect, useRef, useState } from "react";
import { shouldPlayVideo, type Wallpaper } from "../../lib/wallpapers";

type Layer = { key: number; wallpaper: Wallpaper };

/** 两层之间交叉淡入的时长（毫秒），与 os.css 的 .pt-wall 过渡一致 */
export const WALLPAPER_FADE_MS = 700;

export default function WallpaperLayer({ wallpaper, active }: { wallpaper: Wallpaper; active: boolean }) {
  const [layers, setLayers] = useState<Layer[]>(() => [{ key: 0, wallpaper }]);
  const counter = useRef(0);

  useEffect(() => {
    setLayers((current) => {
      if (current[current.length - 1]?.wallpaper.id === wallpaper.id) return current;
      counter.current += 1;
      // 最多保留两层：正在淡出的旧层 + 正在淡入的新层
      return [...current.slice(-1), { key: counter.current, wallpaper }];
    });
  }, [wallpaper]);

  const onShown = (key: number) => setLayers((current) => (current.length > 1 && current[current.length - 1].key === key ? current.slice(-1) : current));

  return (
    <div className="pt-walls" aria-hidden="true">
      {layers.map((layer, index) => (
        <WallpaperFace key={layer.key} wallpaper={layer.wallpaper} entering={index > 0} active={active} onShown={() => onShown(layer.key)} />
      ))}
    </div>
  );
}

function WallpaperFace({ wallpaper, entering, active, onShown }: { wallpaper: Wallpaper; entering: boolean; active: boolean; onShown: () => void }) {
  const [shown, setShown] = useState(!entering);
  const [videoReady, setVideoReady] = useState(false);
  const video = useRef<HTMLVideoElement>(null);
  const [allowLoop] = useState(() => {
    const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const saveData = Boolean((navigator as Navigator & { connection?: { saveData?: boolean } }).connection?.saveData);
    return shouldPlayVideo(wallpaper, { reducedMotion, saveData });
  });

  // 新层：图片解码好了再开始淡入，淡入结束通知上层卸掉旧层
  useEffect(() => {
    if (!entering) return;
    let cancelled = false;
    const image = new Image();
    image.src = wallpaper.image;
    image
      .decode()
      .catch(() => undefined)
      .then(() => {
        if (cancelled) return;
        requestAnimationFrame(() => setShown(true));
      });
    return () => {
      cancelled = true;
    };
  }, [entering, wallpaper.image]);

  useEffect(() => {
    if (!entering || !shown) return;
    const timer = window.setTimeout(onShown, 700 + 50);
    return () => window.clearTimeout(timer);
  }, [entering, shown, onShown]);

  // 桌面不在前台（回到书桌、开机画面）时暂停视频，省电
  useEffect(() => {
    const element = video.current;
    if (!element || !allowLoop) return;
    if (active) void element.play().catch(() => undefined);
    else element.pause();
  }, [active, allowLoop, videoReady]);

  return (
    <div className={shown ? "pt-wall is-shown" : "pt-wall"} style={{ backgroundColor: wallpaper.tint, backgroundImage: `url("${wallpaper.image}")` }}>
      {allowLoop && wallpaper.video && (
        <video
          ref={video}
          className={videoReady ? "pt-wall-video is-ready" : "pt-wall-video"}
          poster={wallpaper.image}
          muted
          loop
          playsInline
          autoPlay={active}
          preload="auto"
          disablePictureInPicture
          onPlaying={() => setVideoReady(true)}
        >
          <source src={wallpaper.video} type="video/mp4" />
        </video>
      )}
    </div>
  );
}

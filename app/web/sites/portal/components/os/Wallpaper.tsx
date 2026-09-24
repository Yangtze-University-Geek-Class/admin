// 桌面壁纸：两层叠放，换壁纸时新的一层在上面淡入，淡入完成后旧的一层才卸掉，全程没有空白帧。
import { useEffect, useRef, useState } from "react";
import type { Wallpaper } from "../../lib/wallpapers";

type Layer = { key: number; wallpaper: Wallpaper };

/** 两层之间交叉淡入的时长（毫秒），与 os.css 的 .pt-wall 过渡一致 */
export const WALLPAPER_FADE_MS = 700;

export default function WallpaperLayer({ wallpaper }: { wallpaper: Wallpaper }) {
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
        <WallpaperFace key={layer.key} wallpaper={layer.wallpaper} entering={index > 0} onShown={() => onShown(layer.key)} />
      ))}
    </div>
  );
}

function WallpaperFace({ wallpaper, entering, onShown }: { wallpaper: Wallpaper; entering: boolean; onShown: () => void }) {
  const [shown, setShown] = useState(!entering);

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
    const timer = window.setTimeout(onShown, WALLPAPER_FADE_MS + 50);
    return () => window.clearTimeout(timer);
  }, [entering, shown, onShown]);

  return <div className={shown ? "pt-wall is-shown" : "pt-wall"} style={{ backgroundColor: wallpaper.tint, backgroundImage: `url("${wallpaper.image}")` }} />;
}

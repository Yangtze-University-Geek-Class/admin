// 桌面壁纸：一张壁纸一层，换壁纸时新的一层压在上面（#147）。
// 点下去立刻有反应：新层先用底色 + 放大模糊的缩略图（选择面板里已经加载好）顶上，从点的那张缩略图的位置展开到整个桌面；
// 大图下载解码好后在这一层里淡入，模糊的画面清晰过来。开了「减少动态效果」时不展开，整层直接淡入。
// 新层展开完才卸掉它下面的层，全程没有空白帧。连点几次时每一层只管自己的计时和解码，桌面最后停在最后点的那张。
import { useCallback, useEffect, useRef, useState, type CSSProperties } from "react";
import { isWallpaperDecoded, loadWallpaperImage, revealClipFrom, type Box, type Wallpaper } from "../../lib/wallpapers";
import { useReducedMotion } from "../../lib/useReducedMotion";

/** 从缩略图展开到整个桌面的时长（毫秒） */
export const WALLPAPER_REVEAL_MS = 640;
/** 减少动态效果时整层淡入的时长 */
export const WALLPAPER_FADE_MS = 360;
/** 大图到了以后，从模糊的缩略图过渡到清晰大图的时长 */
export const WALLPAPER_SHARPEN_MS = 480;

type Layer = {
  key: number;
  wallpaper: Wallpaper;
  /** none：开机时的第一层；reveal：从缩略图展开；fade：直接淡入 */
  enter: "none" | "reveal" | "fade";
  /** reveal 的 clip-path 起点 */
  clip?: string;
};

type Props = {
  wallpaper: Wallpaper;
  /** 点的那张缩略图在屏幕上的位置；没有时直接淡入 */
  from?: Box | null;
};

export default function WallpaperLayer({ wallpaper, from }: Props) {
  const reduced = useReducedMotion();
  const box = useRef<HTMLDivElement>(null);
  const counter = useRef(0);
  const [layers, setLayers] = useState<Layer[]>(() => [{ key: 0, wallpaper, enter: "none" }]);
  // 换壁纸的那次渲染里 from 和 wallpaper 一起变；effect 只跟着 wallpaper 走，from 与动效偏好从这里读最新的
  const latest = useRef({ from, reduced });
  latest.current = { from, reduced };

  // 开机时那张记进共用的下载：之后换回来直接给大图，不再顶缩略图。
  // 首页开机画面已经用同一份下载等它解码完（pages/Home.tsx），这里只是命中；没经过开机画面挂上时在这里下载
  const initial = useRef(wallpaper.image);
  useEffect(() => {
    void loadWallpaperImage(initial.current);
  }, []);

  useEffect(() => {
    const { from: thumb, reduced: still } = latest.current;
    const rect = box.current?.getBoundingClientRect();
    const clip = !still && thumb && rect ? revealClipFrom(thumb, rect) : undefined;
    setLayers((current) => {
      if (current[current.length - 1].wallpaper.id === wallpaper.id) return current;
      counter.current += 1;
      return [...current, { key: counter.current, wallpaper, enter: clip ? "reveal" : "fade", clip }];
    });
  }, [wallpaper]);

  // 某一层展开（淡入）完了，它就整片盖住了下面：卸掉它下面的层。上面还有更新的层时不动它们。
  const onEntered = useCallback((key: number) => {
    setLayers((current) => {
      const index = current.findIndex((layer) => layer.key === key);
      return index > 0 ? current.slice(index) : current;
    });
  }, []);

  return (
    <div className="pt-walls" ref={box} aria-hidden="true">
      {layers.map((layer) => (
        <WallpaperFace key={layer.key} layer={layer} onEntered={onEntered} />
      ))}
    </div>
  );
}

function WallpaperFace({ layer, onEntered }: { layer: Layer; onEntered: (key: number) => void }) {
  const { key, wallpaper, enter, clip } = layer;
  // sharp：大图已经解码，可以换上；blurred：模糊的缩略图还在（清晰过来以后卸掉）
  const [sharp, setSharp] = useState(() => enter === "none" || isWallpaperDecoded(wallpaper.image));
  const [blurred, setBlurred] = useState(() => !sharp);

  // 大图下载解码好才换上，之前一直是底色 + 模糊的缩略图；失败（离线）就停在这里，不闪回旧壁纸
  useEffect(() => {
    if (sharp) return;
    let cancelled = false;
    void loadWallpaperImage(wallpaper.image).then((ok) => {
      if (ok && !cancelled) setSharp(true);
    });
    return () => {
      cancelled = true;
    };
  }, [sharp, wallpaper.image]);

  // 清晰过来以后卸掉模糊的缩略图：它在大图下面已经看不见，留着只占合成开销
  useEffect(() => {
    if (!sharp || !blurred) return;
    const timer = window.setTimeout(() => setBlurred(false), WALLPAPER_SHARPEN_MS + 50);
    return () => window.clearTimeout(timer);
  }, [sharp, blurred]);

  useEffect(() => {
    if (enter === "none") return;
    const timer = window.setTimeout(() => onEntered(key), (enter === "reveal" ? WALLPAPER_REVEAL_MS : WALLPAPER_FADE_MS) + 50);
    return () => window.clearTimeout(timer);
  }, [enter, key, onEntered]);

  const style = {
    backgroundColor: wallpaper.tint,
    "--wall-enter": `${enter === "reveal" ? WALLPAPER_REVEAL_MS : WALLPAPER_FADE_MS}ms`,
    "--wall-sharpen": `${WALLPAPER_SHARPEN_MS}ms`,
    ...(clip ? { "--wall-from": clip } : {}),
  } as CSSProperties;

  return (
    <div className="pt-wall" data-wallpaper={wallpaper.id} data-enter={enter} style={style}>
      {blurred && <div className="pt-wall-thumb" style={{ backgroundImage: `url("${wallpaper.thumb}")` }} />}
      <div className={sharp ? "pt-wall-full is-sharp" : "pt-wall-full"} style={sharp ? { backgroundImage: `url("${wallpaper.image}")` } : undefined} />
    </div>
  );
}

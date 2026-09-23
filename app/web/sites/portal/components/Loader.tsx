// 首次进入的加载动画（分层：纸色底板 + 扫描线 → 超大描边字 YUGC 按真实进度灌满 → 校徽花瓣逐片点亮
// → 手写签名 Geek Class → 等宽日志与百分比）。就绪后幕布上下合拢露出书桌。
//
// 进度只来自真实完成的步骤（three 分包、环境贴图、场景、校徽、着色器编译、第一帧），
// 规则在 ../lib/loaderProgress.ts：显示值永远不超过真实进度；同一会话第一次至少约 2.1s，之后 0.5s；
// 减少动态效果时整个加载动画跳过。
import { useEffect, useRef, useState } from "react";
import { LOADER_SESSION_KEY, approach, loaderFinished, loaderGoal, loaderMinDuration, percentLabel, petalLit } from "../lib/loaderProgress";
import Emblem from "./Emblem";

export type LoaderApi = { progress: (value: number, text?: string) => void };

type Props = {
  reducedMotion: boolean;
  /** 父组件拿到 api 后调用 progress 报告真实进度 */
  onApi: (api: LoaderApi) => void;
  /** 幕布完全打开（加载层可以卸载） */
  onDone: () => void;
};

function seenThisSession(): boolean {
  try {
    return sessionStorage.getItem(LOADER_SESSION_KEY) === "1";
  } catch {
    return false;
  }
}

export default function Loader({ reducedMotion, onApi, onDone }: Props) {
  const root = useRef<HTMLDivElement>(null);
  const pct = useRef<HTMLDivElement>(null);
  const [lines, setLines] = useState<string[]>([]);
  const [lit, setLit] = useState(0);
  const [open, setOpen] = useState(false);
  const target = useRef(0);
  const done = useRef(onDone);
  done.current = onDone;

  useEffect(() => {
    onApi({
      progress(value, text) {
        target.current = Math.max(target.current, Math.min(1, value));
        if (text) setLines((current) => [...current.slice(-2), text]);
      },
    });
  }, [onApi]);

  useEffect(() => {
    if (reducedMotion) {
      // 不播动画，但仍要等到真实就绪再撤掉（不会出现半成品画面）
      const wait = window.setInterval(() => {
        if (target.current >= 1) {
          window.clearInterval(wait);
          done.current();
        }
      }, 50);
      return () => window.clearInterval(wait);
    }
    const minMs = loaderMinDuration({ reducedMotion, seenThisSession: seenThisSession() });
    const started = performance.now();
    let shown = 0;
    let litShown = 0;
    let raf = 0;
    let timer = 0;
    const frame = (now: number) => {
      shown = approach(shown, loaderGoal(target.current, now - started, minMs));
      root.current?.style.setProperty("--p", shown.toFixed(3));
      if (pct.current) pct.current.textContent = percentLabel(shown);
      let nextLit = 0;
      for (let i = 0; i < 6; i++) if (petalLit(shown, i)) nextLit = i + 1;
      if (nextLit !== litShown) {
        litShown = nextLit;
        setLit(nextLit);
      }
      if (loaderFinished(shown, target.current)) {
        try {
          sessionStorage.setItem(LOADER_SESSION_KEY, "1");
        } catch {
          /* 隐私模式下 sessionStorage 不可写时忽略 */
        }
        setOpen(true);
        timer = window.setTimeout(() => done.current(), 900);
        return;
      }
      raf = requestAnimationFrame(frame);
    };
    raf = requestAnimationFrame(frame);
    return () => {
      cancelAnimationFrame(raf);
      window.clearTimeout(timer);
    };
  }, [reducedMotion]);

  if (reducedMotion) return null;

  return (
    <div ref={root} className={open ? "pt-loader is-open" : "pt-loader"} role="status" aria-live="polite" aria-label="正在加载">
      <div className="ld-top" aria-hidden="true">
        <span>YUGC://BOOT</span>
        <span>长江大学 · 计算机科学学院</span>
      </div>
      <div className="ld-word" aria-hidden="true">
        <span className="ld-stroke">YUGC</span>
        <span className="ld-fill">YUGC</span>
        <i className="ld-level" />
      </div>
      <div className="ld-emblem">
        <Emblem variant="loader" lit={lit} />
      </div>
      <p className="ld-sign" aria-hidden="true">
        Geek Class
        <small>SUPERCODER · SINCE 2021</small>
      </p>
      <div className="ld-bottom">
        <div className="ld-log">
          {lines.map((line, index) => (
            <div key={`${index}-${line}`} className={index === lines.length - 1 ? "is-now" : undefined}>
              {line}
            </div>
          ))}
        </div>
        <div className="ld-pct" ref={pct} aria-hidden="true">
          000
        </div>
      </div>
    </div>
  );
}

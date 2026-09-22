// 首页滚动舞台：首屏与滚动叙事是同一个 sticky 舞台（B 站教程第 5、6 步：滚动进度驱动画面，主体压在大字前）。
// 图层从后到前：藏青底板 → LED 点阵大字（Canvas）→ 代码窗口与三个按钮 → 吉祥物 NANO → 签名与 HUD。
// 布局全部由 CSS 决定（../theme.css）；脚本只做三件事：
//   1. 读取「词位」占位元素的位置，让 LED 大字排进去（首屏在 NANO 身后，章节里居中放大）；
//   2. 把滚动进度换算成章节过渡量，写入 CSS 变量（--hero、--v0…--vN）并重画 LED；
//   3. 同步帧计数、进度器与页头「投递简历」的吸附状态。
// 不自动播放、不用定时器（首次点亮的扫描除外，且 reduced-motion 下跳过）；向上滚就是倒放。
import { useEffect, useRef, useState } from "react";
import { appConfig, type PortalChapter } from "@shared/config";
import { LedBoard } from "../lib/ledBoard";
import { clamp01, sequenceAt } from "../lib/ledFont";
import PortalLink, { findNavigationItem } from "./PortalLink";

const FRAMES = 120;
const INTRO_MS = 900;
/** 舞台两端的停顿：进入后先停一小段再开始第一次过渡，结束前也停一小段 */
const EDGE = 0.04;

type Props = {
  /** false 时（prefers-reduced-motion）舞台不吸顶、不接管滚动，只显示首屏 */
  scrub: boolean;
  /** 首屏按钮离开视野（投递简历需要吸附到页头）时回调 */
  onDockChange: (docked: boolean) => void;
};

function visibility(index: number, from: number, to: number, t: number) {
  if (index === from) return from === to ? 1 : 1 - t;
  if (index === to) return t;
  return 0;
}

export default function ScrollStage({ scrub, onDockChange }: Props) {
  const { stage, entries } = appConfig.portal;
  const chapters = stage.chapters;
  const hero = chapters[0];
  const section = useRef<HTMLElement>(null);
  const canvas = useRef<HTMLCanvasElement>(null);
  const glow = useRef<HTMLCanvasElement>(null);
  const heroSlot = useRef<HTMLDivElement>(null);
  const storySlot = useRef<HTMLDivElement>(null);
  const frameText = useRef<HTMLSpanElement>(null);
  const dock = useRef<HTMLDivElement>(null);
  const editor = useRef<HTMLDivElement>(null);
  const [chapter, setChapter] = useState(0);
  const dockRef = useRef(onDockChange);
  dockRef.current = onDockChange;

  useEffect(() => {
    const node = section.current;
    const surface = canvas.current;
    if (!node || !surface) return;

    const board = new LedBoard(surface, glow.current, (index) => {
      const slot = (index === 0 ? heroSlot : storySlot).current;
      const base = surface.getBoundingClientRect();
      const rect = slot?.getBoundingClientRect() ?? base;
      return { cx: rect.left - base.left + rect.width / 2, cy: rect.top - base.top + rect.height / 2, width: rect.width, height: rect.height };
    });
    board.setWords(chapters.map((item) => item.word));

    let target = 0;
    let shown = 0;
    let frame = 0;
    let intro = scrub ? 0 : 1;
    let docked = false;
    const introStart = performance.now();

    const paint = () => {
      const progress = clamp01((shown - EDGE) / (1 - EDGE * 2));
      const { from, to, t, nearest } = sequenceAt(progress, chapters.length);
      board.render(from, to, t, intro);
      node.style.setProperty("--hero", (from === 0 ? 1 - t : 0).toFixed(4));
      chapters.forEach((_, index) => node.style.setProperty(`--v${index}`, visibility(index, from, to, t).toFixed(4)));
      if (frameText.current) frameText.current.textContent = String(Math.min(FRAMES, Math.floor(shown * (FRAMES - 1)) + 1)).padStart(3, "0");
      setChapter(nearest);
      const nextDocked = from > 0 || t > 0.35;
      if (nextDocked !== docked) {
        docked = nextDocked;
        dockRef.current(docked);
      }
    };

    const measure = () => {
      if (!scrub) return;
      const rect = node.getBoundingClientRect();
      const travel = rect.height - window.innerHeight;
      target = travel > 0 ? clamp01(-rect.top / travel) : 0;
    };

    const tick = (now: number) => {
      if (intro < 1) intro = clamp01((now - introStart) / INTRO_MS);
      shown += (target - shown) * 0.18;
      if (Math.abs(target - shown) < 0.0004) shown = target;
      paint();
      frame = shown === target && intro >= 1 ? 0 : requestAnimationFrame(tick);
    };

    const wake = () => {
      measure();
      if (!frame) frame = requestAnimationFrame(tick);
    };

    // 机器人要骑在代码窗口右上角；窗口位置随视口变化，量一次写进 CSS 变量
    // 用 offset* 而不是 getBoundingClientRect：前者不受淡出时的 transform 影响
    const pinRobot = () => {
      const box = editor.current;
      const column = box?.offsetParent as HTMLElement | null;
      if (!box || !column) return;
      node.style.setProperty("--win-right", `${column.offsetLeft + box.offsetLeft + box.offsetWidth}px`);
      node.style.setProperty("--win-top", `${column.offsetTop + box.offsetTop}px`);
    };

    const observer = new ResizeObserver(() => {
      board.resize();
      measure();
      paint();
      pinRobot();
    });
    observer.observe(surface);
    board.resize();
    measure();
    shown = target;
    paint();
    pinRobot();
    if (scrub) {
      frame = requestAnimationFrame(tick);
      window.addEventListener("scroll", wake, { passive: true });
      window.addEventListener("resize", wake);
    }
    return () => {
      observer.disconnect();
      window.removeEventListener("scroll", wake);
      window.removeEventListener("resize", wake);
      cancelAnimationFrame(frame);
    };
  }, [chapters, scrub]);

  const heroActive = chapter === 0;

  // 首屏按钮淡出后不可聚焦，避免键盘焦点落到看不见的按钮上（React 18 还不认识 inert 属性，直接写 DOM）
  useEffect(() => {
    dock.current?.toggleAttribute("inert", scrub && !heroActive);
  }, [scrub, heroActive]);

  return (
    <section ref={section} className={`yg-stage${scrub ? " is-scrub" : ""}`} aria-labelledby="stage-title" data-chapter={chapter}>
      <div className="yg-stage-sticky">
        <div className="yg-plate" aria-hidden="true" />
        <div className="yg-word-slot is-hero" ref={heroSlot} aria-hidden="true" />
        <div className="yg-word-slot is-story" ref={storySlot} aria-hidden="true" />
        <canvas className="yg-led-glow" ref={glow} aria-hidden="true" />
        <canvas className="yg-led" ref={canvas} aria-hidden="true" />

        <div className="yg-cast">
          {chapters.map((item, index) => (
            <Pose key={item.word} chapter={item} index={index} eager={index === 0} />
          ))}
          <img className="yg-robot" src={stage.robot} alt="" aria-hidden="true" decoding="async" />
          <p className="yg-signature" aria-hidden="true">
            <strong>{stage.signature}</strong>
            <span>{stage.signatureNote}</span>
          </p>
        </div>

        <div className="yg-hero">
          <div className="yg-window" ref={editor}>
            <div className="yg-window-bar" aria-hidden="true">
              <span className="yg-dots">
                <i />
                <i />
                <i />
              </span>
              <span className="yg-tab is-active">nano.tsx</span>
              <span className="yg-tab">join.md</span>
            </div>
            <div className="yg-window-body">
              <ol className="yg-code" aria-hidden="true">
                {stage.code.map((line) => (
                  <li key={line}>
                    <Code line={line} />
                  </li>
                ))}
                <li />
              </ol>
              <p className="yg-status">
                <i aria-hidden="true" />
                <span className="yg-comment" aria-hidden="true">
                  //{" "}
                </span>
                {stage.status}
              </p>
              <h1 className="yg-title" id="stage-title">
                <span className="yg-title-hash" aria-hidden="true">
                  #
                </span>
                <span>{hero.lead}</span>
                <span className="yg-title-accent">{hero.accent}</span>
              </h1>
              <p className="yg-window-note">
                <span className="yg-comment" aria-hidden="true">
                  //{" "}
                </span>
                {stage.comment}
              </p>
            </div>
          </div>

          <div className="yg-dock" ref={dock}>
            <p className="yg-prompt" aria-hidden="true">
              <span className="yg-prompt-sign">$</span> {stage.prompt}
              <span className="yg-caret" />
            </p>
            <nav className="yg-doors" aria-label="三个入口">
              {entries.items.map((entry, position) => {
                const item = findNavigationItem(entry.navId);
                return (
                  <PortalLink key={entry.navId} item={item} className={`yg-door${position === 0 ? " is-primary" : ""}`}>
                    <span className="yg-door-index" aria-hidden="true">
                      {entry.index}
                    </span>
                    <span className="yg-door-label">{entry.title}</span>
                    <span className="yg-door-arrow" aria-hidden="true">
                      {item.type === "external" ? "↗" : "→"}
                    </span>
                  </PortalLink>
                );
              })}
            </nav>
            <p className="yg-microcopy">
              <span aria-hidden="true">// </span>
              {stage.microcopy}
            </p>
          </div>
        </div>

        {scrub && (
          <ol className="yg-chapters">
            {chapters.slice(1).map((item, offset) => {
              const index = offset + 1;
              const active = chapter === index;
              return (
                <li key={item.word} className="yg-chapter" style={{ ["--v" as string]: `var(--v${index})` }} aria-current={active ? "step" : undefined}>
                  <p className="yg-chapter-label" aria-hidden="true">
                    {String(index + 1).padStart(2, "0")} / {String(chapters.length).padStart(2, "0")} · {item.word}
                  </p>
                  <h2>
                    <span>{item.lead}</span>
                    <span className="yg-title-accent">{item.accent}</span>
                  </h2>
                  <p className="yg-chapter-desc">{item.desc}</p>
                  {item.link && (
                    <PortalLink
                      item={findNavigationItem(item.link)}
                      className={`yg-chapter-link${item.link === "apply" ? " is-primary" : ""}`}
                      tabIndex={active ? undefined : -1}
                    >
                      {item.linkLabel} <span aria-hidden="true">{findNavigationItem(item.link).type === "external" ? "↗" : "→"}</span>
                    </PortalLink>
                  )}
                </li>
              );
            })}
          </ol>
        )}

        <div className="yg-hud" aria-hidden="true">
          <span className="yg-hud-tag">{stage.tag}</span>
          <span className="yg-hud-status">
            <i /> RECRUITING
          </span>
          <span className="yg-hud-scroll">[ scroll ↓ ]</span>
          <span className="yg-hud-frame">
            FRAME <span ref={frameText}>001</span>/{FRAMES}
          </span>
          <span className="yg-hud-side">YANGTZE UNIVERSITY GEEK CLASS</span>
          <span className="yg-pager">
            {chapters.map((item, index) => (
              <i key={item.word} className={index === chapter ? "is-on" : undefined} />
            ))}
            <b>
              {String(chapter + 1).padStart(2, "0")}/{String(chapters.length).padStart(2, "0")}
            </b>
          </span>
        </div>
      </div>
    </section>
  );
}

function Pose({ chapter, index, eager }: { chapter: PortalChapter; index: number; eager: boolean }) {
  const { pose } = chapter;
  return (
    <img
      className={`yg-pose is-${chapter.word.toLowerCase()}`}
      style={{ ["--v" as string]: `var(--v${index})`, aspectRatio: `${pose.width} / ${pose.height}` }}
      src={pose.image}
      srcSet={pose.small ? `${pose.small} 560w, ${pose.image} ${pose.width}w` : undefined}
      sizes={pose.small ? "(max-width: 899px) 42vw, 30vw" : undefined}
      alt={index === 0 ? pose.alt : ""}
      aria-hidden={index === 0 ? undefined : true}
      width={pose.width}
      height={pose.height}
      loading={eager ? "eager" : "lazy"}
      decoding="async"
    />
  );
}

/** 装饰代码行的极简高亮：关键字 / 字符串 / 其余标识符三色，不引入高亮库。 */
function Code({ line }: { line: string }) {
  const parts = line.split(/("[^"]*")/g);
  return (
    <>
      {parts.map((part, index) =>
        part.startsWith('"') ? (
          <span key={index} className="yg-tok-str">
            {part}
          </span>
        ) : (
          part.split(/\b(import|from|const|await|export|return)\b/g).map((piece, inner) =>
            /^(import|from|const|await|export|return)$/.test(piece) ? (
              <span key={`${index}-${inner}`} className="yg-tok-key">
                {piece}
              </span>
            ) : (
              <span key={`${index}-${inner}`}>{piece}</span>
            ),
          )
        ),
      )}
    </>
  );
}

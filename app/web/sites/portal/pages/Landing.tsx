// 官网首页。按用户要求只保留三个入口，并让它们在首屏一眼可见：
//   投递简历 → /apply（本服务的表单页）
//   了解我们 → 论坛（Tuff Forum，独立服务，沿用论坛自己的皮肤）
//   组织情况 → GitHub 组织主页
// 页面节奏：滚动舞台（首屏代码窗口 + 三个按钮 → 滚动驱动的挥手帧序列、LED 大字与 NANO 章节）→ 冰白图纸上的三个入口卡 → 页脚。
// 不再有单独的收尾条：舞台最后一章 JOIN 已经以「投递简历」收尾。
// 文案与素材全部来自 app.config.json > portal；视觉语言见 docs/design/DESIGN.md 与 ../theme.css。
import { useEffect, useRef, useState } from "react";
import { appConfig } from "@shared/config";
import PortalLink, { findNavigationItem } from "../components/PortalLink";
import ScrollStage, { inlineCode } from "../components/ScrollStage";
import SiteFooter from "../components/SiteFooter";
import SiteHeader from "../components/SiteHeader";
import "../theme.css";

const REDUCED_MOTION = "(prefers-reduced-motion: reduce)";

function usePrefersReducedMotion(): boolean {
  const [reduced, setReduced] = useState(() => typeof window !== "undefined" && window.matchMedia(REDUCED_MOTION).matches);
  useEffect(() => {
    const query = window.matchMedia(REDUCED_MOTION);
    const onChange = () => setReduced(query.matches);
    query.addEventListener("change", onChange);
    return () => query.removeEventListener("change", onChange);
  }, []);
  return reduced;
}

/** 滚动进入视口时给 [data-reveal] 加 is-visible；只有观察器就位后才隐藏元素，脚本失败时内容保持可见。 */
function useReveal() {
  const root = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const page = root.current;
    if (!page || !("IntersectionObserver" in window)) return;
    const nodes = page.querySelectorAll<HTMLElement>("[data-reveal]");
    page.classList.add("has-reveal");
    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (!entry.isIntersecting) continue;
          entry.target.classList.add("is-visible");
          observer.unobserve(entry.target);
        }
      },
      { rootMargin: "0px 0px -8% 0px", threshold: 0.12 },
    );
    nodes.forEach((node) => observer.observe(node));
    return () => observer.disconnect();
  }, []);
  return root;
}

export default function Landing() {
  const { stage, entries } = appConfig.portal;
  const reducedMotion = usePrefersReducedMotion();
  const root = useReveal();
  const [docked, setDocked] = useState(false);

  return (
    <div className="yg-page" ref={root} data-docked={docked ? "true" : "false"}>
      <SiteHeader />

      <main>
        <ScrollStage scrub={!reducedMotion} onDockChange={setDocked} />

        {reducedMotion && (
          <section className="yg-static-chapters" aria-label="我们在做什么">
            <ol className="yg-wrap">
              {stage.chapters.slice(1).map((item) => (
                <li key={item.word} className="yg-static-chapter">
                  <div>
                    <p className="yg-static-word" aria-hidden="true">
                      {item.word}
                    </p>
                    <h2 className="yg-chapter-static-title">
                      {inlineCode(item.lead)}
                      {inlineCode(item.accent)}
                    </h2>
                    <p className="yg-chapter-desc">{item.desc}</p>
                    {item.link && (
                      <PortalLink item={findNavigationItem(item.link)} className="yg-chapter-link">
                        {item.linkLabel} <span aria-hidden="true">→</span>
                      </PortalLink>
                    )}
                  </div>
                  <img src={item.pose.image} alt={item.pose.alt} loading="lazy" decoding="async" />
                </li>
              ))}
            </ol>
          </section>
        )}

        <section className="yg-sheet" aria-labelledby="doors-title">
          <div className="yg-wrap">
            <header className="yg-sheet-head" data-reveal>
              <div>
                <p className="yg-kicker">{entries.kicker}</p>
                <h2 id="doors-title">{entries.title}</h2>
              </div>
              <p>{entries.desc}</p>
            </header>

            <div className="yg-cards" data-reveal>
              {entries.items.map((entry, position) => {
                const item = findNavigationItem(entry.navId);
                return (
                  <PortalLink key={entry.navId} item={item} className={`yg-card${position === 0 ? " is-primary" : ""}`}>
                    <span className="yg-card-bar" aria-hidden="true">
                      <span className="yg-dots">
                        <i />
                        <i />
                        <i />
                      </span>
                      {entry.path}
                      <span className="yg-card-index">{entry.index}</span>
                    </span>
                    <span className="yg-card-art">
                      <img src={entry.image} alt={entry.alt} loading="lazy" decoding="async" />
                    </span>
                    <span className="yg-card-body">
                      <strong className="yg-card-title">{entry.title}</strong>
                      <span className="yg-card-hint">{entry.hint}</span>
                      <span className="yg-card-desc">{entry.desc}</span>
                      <span className="yg-card-action">
                        {entry.action}
                        <i aria-hidden="true">{item.type === "external" ? "↗" : "→"}</i>
                      </span>
                    </span>
                  </PortalLink>
                );
              })}
            </div>
          </div>
        </section>
      </main>

      <SiteFooter />
    </div>
  );
}

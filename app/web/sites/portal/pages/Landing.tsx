// 官网首页。按用户要求只保留三个入口：
//   投递简历 → /apply（本服务的表单页）
//   了解我们 → 论坛（Tuff Forum，独立服务，沿用论坛自己的皮肤）
//   组织情况 → GitHub 组织主页
// 页面节奏：主视觉（标题 + 画布卡）→ 三个入口 → 做事方式 → 收尾邀请 → 页脚。
// 文案与配图全部来自 app.config.json > portal；视觉语言见 docs/design/DESIGN.md 与 ../theme.css。
import { useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { appConfig } from "@shared/config";
import { mascotImage } from "@shared/ui/Mascot";
import PortalLink, { findNavigationItem } from "../components/PortalLink";
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

/** 滚动进入视口时给 [data-reveal] 加 is-visible；reduced-motion 下 CSS 直接显示，不依赖这里。 */
function useReveal() {
  const root = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const page = root.current;
    if (!page || !("IntersectionObserver" in window)) return;
    const nodes = page.querySelectorAll<HTMLElement>("[data-reveal]");
    // 只有观察器就位后才隐藏待显现元素，脚本失败时内容保持可见。
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
  const { hero, brand, entries, principles, closing } = appConfig.portal;
  const reducedMotion = usePrefersReducedMotion();
  const root = useReveal();

  return (
    <div className="mimo-page" ref={root}>
      <div className="mimo-bar">
        <div className="mimo-wrap mimo-bar-inner">
          <span>
            {hero.season}
            <span className="mimo-bar-extra"> · 用项目把课堂知识变成能跑起来的东西</span>
          </span>
          <Link to="/apply">投递简历</Link>
        </div>
      </div>

      <SiteHeader />

      <main>
        <section className="mimo-hero" aria-labelledby="hero-title">
          <div className="mimo-wrap mimo-hero-head">
            <p className="mimo-eyebrow">{hero.eyebrow}</p>
            <h1 className="mimo-display" id="hero-title">
              <span>{hero.titleLead}</span>
              <span className="mimo-display-accent">{hero.titleAccent}</span>
            </h1>
            <p className="mimo-lead">{hero.lead}</p>
            <div className="mimo-actions">
              <PortalLink item={findNavigationItem("apply")} className="mimo-btn mimo-btn-primary">
                投递简历 <span className="mimo-btn-arrow" aria-hidden="true">→</span>
              </PortalLink>
              <PortalLink item={findNavigationItem("forum")} className="mimo-btn mimo-btn-outline">
                了解我们 <span className="mimo-btn-arrow" aria-hidden="true">→</span>
              </PortalLink>
              <PortalLink item={findNavigationItem("github")} className="mimo-btn mimo-btn-outline">
                组织情况 <span className="mimo-btn-arrow" aria-hidden="true">↗</span>
              </PortalLink>
            </div>
          </div>

          <div className="mimo-wrap">
            <figure className="mimo-stage">
              <div className="mimo-stage-media" aria-hidden="true">
                {hero.art.video && !reducedMotion ? (
                  <video src={hero.art.video} poster={hero.art.image} autoPlay muted loop playsInline preload="metadata" />
                ) : (
                  <img src={hero.art.image} alt="" />
                )}
              </div>
              <div className="mimo-stage-top">
                <span className="mimo-stage-status">
                  <i aria-hidden="true" />
                  {hero.status}
                </span>
                <span className="mimo-stage-season">{hero.season}</span>
              </div>
              <p className="mimo-stage-mark" aria-hidden="true">
                YUGC
              </p>
              <img
                className="mimo-stage-mascot"
                src={mascotImage(hero.pose)}
                alt={`${brand.title}吉祥物极客娘`}
                width="572"
                height="739"
              />
              <figcaption className="mimo-stage-caption">{hero.caption}</figcaption>
            </figure>
          </div>
        </section>

        <section className="mimo-section" aria-labelledby="entries-title">
          <div className="mimo-wrap">
            <header className="mimo-section-head" data-reveal>
              <p className="mimo-eyebrow">{entries.kicker}</p>
              <h2 id="entries-title">{entries.title}</h2>
              <p>{entries.desc}</p>
            </header>

            <div className="mimo-bento" data-reveal>
              {entries.items.map((entry, position) => (
                <PortalLink
                  key={entry.navId}
                  item={findNavigationItem(entry.navId)}
                  className={`mimo-entry${position === 0 ? " is-featured" : ""}`}
                >
                  <span className="mimo-entry-media">
                    <img src={entry.image} alt={entry.alt} loading="lazy" />
                  </span>
                  <span className="mimo-entry-body">
                    <span className="mimo-entry-index">{entry.index}</span>
                    <strong className="mimo-entry-title">{entry.title}</strong>
                    <span className="mimo-entry-desc">{entry.desc}</span>
                    <span className="mimo-entry-action">
                      {entry.action}
                      <span className="mimo-entry-arrow" aria-hidden="true">
                        {findNavigationItem(entry.navId).type === "external" ? "↗" : "→"}
                      </span>
                    </span>
                  </span>
                </PortalLink>
              ))}
            </div>
          </div>
        </section>

        <section className="mimo-section" aria-labelledby="principles-title">
          <div className="mimo-wrap">
            <figure className="mimo-band" data-reveal>
              <img src={principles.image} alt={principles.alt} loading="lazy" />
            </figure>
            <div className="mimo-principles">
              <header className="mimo-section-head" data-reveal>
                <p className="mimo-eyebrow">{principles.kicker}</p>
                <h2 id="principles-title">{principles.title}</h2>
                <p>{principles.desc}</p>
              </header>
              <ol className="mimo-principle-list">
                {principles.items.map((item, index) => (
                  <li key={item.title} data-reveal>
                    <span className="mimo-principle-index">{String(index + 1).padStart(2, "0")}</span>
                    <h3>{item.title}</h3>
                    <p>{item.desc}</p>
                  </li>
                ))}
              </ol>
            </div>
          </div>
        </section>

        <section className="mimo-section" aria-labelledby="closing-title">
          <div className="mimo-wrap">
            <div className="mimo-closing" data-reveal>
              <div className="mimo-closing-copy">
                <h2 id="closing-title">{closing.title}</h2>
                <p>{closing.desc}</p>
                <PortalLink item={findNavigationItem("apply")} className="mimo-btn mimo-btn-primary">
                  投递简历 <span className="mimo-btn-arrow" aria-hidden="true">→</span>
                </PortalLink>
              </div>
              <img className="mimo-closing-mascot" src={mascotImage("coding")} alt="" width="759" height="768" loading="lazy" />
            </div>
          </div>
        </section>
      </main>

      <SiteFooter />
    </div>
  );
}

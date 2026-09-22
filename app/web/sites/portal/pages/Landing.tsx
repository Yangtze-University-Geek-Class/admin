// 官网首页。按用户要求只保留三个入口：
//   投递简历 → /apply（本服务的表单页）
//   了解我们 → 论坛（Tuff Forum，独立服务，沿用论坛自己的皮肤）
//   组织情况 → GitHub 组织主页
// 视觉语言（MiMo 风格基线）见 docs/design/DESIGN.md 与 ../theme.css。
import { Link } from "react-router-dom";
import { appConfig } from "@shared/config";
import { externalUrl } from "@shared/lib/site";
import { mascotImage } from "@shared/ui/Mascot";
import SiteFooter from "../components/SiteFooter";
import SiteHeader from "../components/SiteHeader";
import "../theme.css";

export default function Landing() {
  const { hero, brand } = appConfig.portal;
  const githubUrl = appConfig.urls.githubOrg;

  return (
    <div className="mimo-page">
      <div className="mimo-bar">
        <div className="mimo-wrap mimo-bar-inner">
          <span>招新进行中 —— 用项目把课堂知识变成能跑起来的东西。</span>
          <Link to="/apply">投递简历</Link>
        </div>
      </div>

      <SiteHeader />

      <main>
        <section className="mimo-wrap mimo-hero">
          <p className="mimo-eyebrow">{hero.eyebrow}</p>
          <h1 className="mimo-display">
            <strong>{hero.titleLead}</strong>
            <strong className="mimo-display-accent">{hero.titleAccent}</strong>
          </h1>
          <p className="mimo-lead">{hero.lead}</p>

          <div className="mimo-actions">
            <Link className="mimo-btn mimo-btn-primary" to="/apply">
              投递简历 <span className="mimo-btn-arrow" aria-hidden="true">→</span>
            </Link>
            <a className="mimo-btn mimo-btn-outline" href={externalUrl("forum", "/")}>
              了解我们 · 进入论坛 <span className="mimo-btn-arrow" aria-hidden="true">→</span>
            </a>
            <a className="mimo-btn mimo-btn-outline" href={githubUrl} target="_blank" rel="noreferrer">
              组织情况 · GitHub <span className="mimo-btn-arrow" aria-hidden="true">↗</span>
            </a>
          </div>

          <figure className="mimo-hero-art">
            <div className="mimo-art">
              <span className="mimo-art-note">{hero.status}</span>
              <div className="mimo-art-inner">
                <img src={mascotImage(hero.pose)} alt={`${brand.title}吉祥物`} width="360" height="540" />
              </div>
              <span className="mimo-art-caption">{hero.caption}</span>
            </div>
            <figcaption className="mimo-figure-caption">
              <h2>{hero.cardTitle}</h2>
              <p>{hero.cardDesc}</p>
            </figcaption>
          </figure>
        </section>
      </main>

      <SiteFooter />
    </div>
  );
}

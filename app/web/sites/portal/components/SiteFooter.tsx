// 官网页脚（冰白图纸）：左侧一块图纸标题栏，右侧少量文字链接，不放营销区块。
import { Link } from "react-router-dom";
import { appConfig } from "@shared/config";
import { externalUrl } from "@shared/lib/site";

export default function SiteFooter() {
  const { brand, stage } = appConfig.portal;

  return (
    <footer className="yg-footer">
      <div className="yg-wrap yg-footer-inner">
        <dl className="yg-titleblock">
          <dt>Sheet</dt>
          <dd>01 — {stage.signature}</dd>
          <dt>Project</dt>
          <dd>{brand.title}</dd>
          <dt>Org</dt>
          <dd>{brand.subtitle}</dd>
        </dl>
        <nav className="yg-footer-links" aria-label="页脚导航">
          <Link to="/apply">投递简历</Link>
          <a href={externalUrl("forum", "/")}>论坛</a>
          <Link to="/docs">文档</Link>
          <a href={externalUrl("admin", "/admin")}>管理后台</a>
          <a href={appConfig.urls.githubOrg} target="_blank" rel="noreferrer">
            GitHub
          </a>
        </nav>
        <p className="yg-footer-meta">
          © {brand.title} · {brand.subtitle}
        </p>
      </div>
    </footer>
  );
}

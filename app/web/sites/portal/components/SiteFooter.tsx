// 官网页脚（MiMo 风格，黑底）。只放少量文字链接，不放营销区块。
import { Link } from "react-router-dom";
import { appConfig } from "@shared/config";
import { externalUrl } from "@shared/lib/site";

export default function SiteFooter() {
  const { brand } = appConfig.portal;
  const year = new Date().getFullYear();

  return (
    <footer className="mimo-footer">
      <div className="mimo-wrap mimo-footer-inner">
        <strong>{brand.title}</strong>
        <nav className="mimo-footer-links" aria-label="页脚导航">
          <Link to="/apply">投递简历</Link>
          <a href={externalUrl("forum", "/")}>论坛</a>
          <Link to="/docs">文档</Link>
          <a href={externalUrl("admin", "/admin")}>管理后台</a>
          <a href={appConfig.urls.githubOrg} target="_blank" rel="noreferrer">
            GitHub
          </a>
        </nav>
        <p className="mimo-footer-meta">
          © {year} {brand.title} · {brand.subtitle}
        </p>
      </div>
    </footer>
  );
}

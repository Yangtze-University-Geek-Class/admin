// Config-driven portal header: brand + docs/forum/admin/GitHub navigation.
// Items and order come from app.config.json > portal.navigation, never hardcoded here.
import { Link } from "react-router-dom";
import { appConfig, type PortalNavigationItem } from "../config";
import { externalUrl } from "../lib/site";

export default function PortalHeader() {
  const { brand, navigation } = appConfig.portal;

  return (
    <header className="portal-nav">
      <div className="portal-container portal-nav-inner">
        <Link to={brand.homePath} className="portal-brand" aria-label="返回主页">
          <span className="portal-brand-mark">
            <img src={brand.logo} alt={brand.logoAlt} />
          </span>
          <span>
            <strong>{brand.title}</strong>
            <small>{brand.subtitle}</small>
          </span>
        </Link>
        <nav className="portal-nav-links" aria-label="主导航">
          {navigation.map((item) => <PortalNavigationLink key={item.id} item={item} />)}
        </nav>
      </div>
    </header>
  );
}

function PortalNavigationLink({ item }: { item: PortalNavigationItem }) {
  const className = item.variant === "primary" ? "portal-nav-primary" : "portal-nav-text";

  if (item.type === "route") {
    return <Link to={item.path ?? "/"} className={className}>{item.label}</Link>;
  }

  if (item.type === "site" && item.site) {
    return <a href={externalUrl(item.site, item.path ?? "/")} className={className}>{item.label}</a>;
  }

  const url = item.urlKey ? appConfig.urls[item.urlKey] : "#";
  return (
    <a
      href={url}
      className={className}
      target={item.newTab ? "_blank" : undefined}
      rel={item.newTab ? "noreferrer" : undefined}
    >
      {item.label}
    </a>
  );
}

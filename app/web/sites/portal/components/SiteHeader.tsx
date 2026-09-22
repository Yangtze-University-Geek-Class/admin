// 官网页头（MiMo 风格）：品牌 + 配置驱动的少量入口。
// 导航项来自 app.config.json > portal.navigation，不在组件里硬编码；
// 样式令牌与组件规则见 app/web/sites/portal/theme.css 与 docs/design/DESIGN.md。
import { Link } from "react-router-dom";
import { appConfig, type PortalNavigationItem } from "@shared/config";
import { externalUrl } from "@shared/lib/site";

export default function SiteHeader() {
  const { brand, navigation } = appConfig.portal;

  return (
    <header className="mimo-header">
      <div className="mimo-wrap mimo-header-inner">
        <Link to={brand.homePath} className="mimo-brand" aria-label={`返回${brand.title}首页`}>
          <span className="mimo-brand-mark">
            <img src={brand.logo} alt="" />
          </span>
          <span>
            <strong>{brand.title}</strong>
            <small>{brand.subtitle}</small>
          </span>
        </Link>
        <nav className="mimo-nav" aria-label="主导航">
          {navigation.map((item) => (
            <HeaderLink key={item.id} item={item} />
          ))}
        </nav>
      </div>
    </header>
  );
}

function HeaderLink({ item }: { item: PortalNavigationItem }) {
  const className = `mimo-nav-link${item.variant === "primary" ? " is-primary" : ""}`;

  if (item.type === "route") {
    return (
      <Link to={item.path ?? "/"} className={className}>
        {item.label}
      </Link>
    );
  }

  if (item.type === "site" && item.site) {
    return (
      <a href={externalUrl(item.site, item.path ?? "/")} className={className}>
        {item.label}
      </a>
    );
  }

  const url = item.urlKey ? appConfig.urls[item.urlKey] : "#";
  return (
    <a href={url} className={className} {...(item.newTab ? { target: "_blank", rel: "noreferrer" } : {})}>
      {item.label}
    </a>
  );
}

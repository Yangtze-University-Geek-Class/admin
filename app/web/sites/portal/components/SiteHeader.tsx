// 官网页头：居中悬浮的玻璃胶囊（fixed），品牌 + 配置驱动的少量入口。
// 导航项来自 app.config.json > portal.navigation，不在组件里硬编码；
// 样式令牌与组件规则见 app/web/sites/portal/theme.css 与 docs/design/DESIGN.md。
import { Link, useLocation } from "react-router-dom";
import { appConfig } from "@shared/config";
import PortalLink from "./PortalLink";

export default function SiteHeader() {
  const { brand, navigation } = appConfig.portal;
  const { pathname } = useLocation();

  return (
    <header className="yg-header">
      <div className="yg-header-inner">
        <Link to={brand.homePath} className="yg-brand" aria-label={`返回${brand.title}首页`}>
          <span className="yg-brand-mark">
            <img src={brand.logo} alt="" />
          </span>
          <span className="yg-brand-text">
            <strong>{brand.title}</strong>
            <small>{brand.subtitle}</small>
          </span>
        </Link>
        <nav className="yg-nav" aria-label="主导航">
          {navigation.map((item) => (
            <PortalLink
              key={item.id}
              item={item}
              className={`yg-nav-link${item.variant === "primary" ? " is-primary" : ""}`}
              aria-current={item.type === "route" && item.path === pathname ? "page" : undefined}
            >
              {item.label}
              {item.type === "external" && <span aria-hidden="true">↗</span>}
            </PortalLink>
          ))}
        </nav>
      </div>
    </header>
  );
}

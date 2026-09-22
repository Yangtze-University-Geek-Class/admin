// 官网导航项 → 链接的唯一解析点。页头和首页入口卡都经过这里，
// 路由 / 跨站 / 外链三种规则只写一次（数据来自 app.config.json > portal.navigation）。
import type { ReactNode } from "react";
import { Link } from "react-router-dom";
import { appConfig, type PortalNavigationItem } from "@shared/config";
import { externalUrl } from "@shared/lib/site";

export function findNavigationItem(id: string): PortalNavigationItem {
  const item = appConfig.portal.navigation.find((entry) => entry.id === id);
  if (!item) throw new Error(`portal.navigation 中没有 id=${id} 的入口`);
  return item;
}

export default function PortalLink({
  item,
  className,
  children,
}: {
  item: PortalNavigationItem;
  className?: string;
  children: ReactNode;
}) {
  if (item.type === "route") {
    return (
      <Link to={item.path ?? "/"} className={className}>
        {children}
      </Link>
    );
  }

  if (item.type === "site" && item.site) {
    return (
      <a href={externalUrl(item.site, item.path ?? "/")} className={className}>
        {children}
      </a>
    );
  }

  const url = item.urlKey ? appConfig.urls[item.urlKey] : "#";
  return (
    <a href={url} className={className} {...(item.newTab ? { target: "_blank", rel: "noreferrer" } : {})}>
      {children}
    </a>
  );
}

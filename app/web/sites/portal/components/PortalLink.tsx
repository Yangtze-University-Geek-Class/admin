// 官网导航项 → 链接的唯一解析点。页头、首页按钮、章节链接和入口卡都经过这里，
// 路由 / 跨站 / 外链三种规则只写一次（数据来自 app.config.json > portal.navigation）。
import type { AnchorHTMLAttributes, ReactNode } from "react";
import { Link } from "react-router-dom";
import { appConfig, type PortalNavigationItem } from "@shared/config";
import { externalUrl } from "@shared/lib/site";

export function findNavigationItem(id: string): PortalNavigationItem {
  const item = appConfig.portal.navigation.find((entry) => entry.id === id);
  if (!item) throw new Error(`portal.navigation 中没有 id=${id} 的入口`);
  return item;
}

type Props = Omit<AnchorHTMLAttributes<HTMLAnchorElement>, "href" | "target" | "rel" | "children"> & {
  item: PortalNavigationItem;
  children: ReactNode;
};

export default function PortalLink({ item, children, ...rest }: Props) {
  if (item.type === "route") {
    return (
      <Link to={item.path ?? "/"} {...rest}>
        {children}
      </Link>
    );
  }

  if (item.type === "site" && item.site) {
    return (
      <a href={externalUrl(item.site, item.path ?? "/")} {...rest}>
        {children}
      </a>
    );
  }

  const url = item.urlKey ? appConfig.urls[item.urlKey] : "#";
  return (
    <a href={url} {...rest} {...(item.newTab ? { target: "_blank", rel: "noreferrer" } : {})}>
      {children}
    </a>
  );
}

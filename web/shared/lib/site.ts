// 站点身份与跨端 URL 的统一入口。
//
// 「当前是哪个端」由 mountSite() 在挂载时声明（见 runtime.ts 的 setCurrentSite），
// 不再靠 hostname 推断；basename 与跨端 URL 的规则都在 runtime.ts。
import { getBasePath, externalSiteUrl } from "./runtime";

export function externalUrl(target: "portal" | "forum" | "admin", path = "/"): string {
  return externalSiteUrl(target, path);
}

/** 论坛站内路径的绝对形式，用于 OAuth 的 return_to —— 必须带上 basename。 */
export function forumPath(path: string): string {
  const base = getBasePath("forum");
  if (path === "" || path === "/") return base || "/";
  const normalized = path.startsWith("/") ? path : `/${path}`;
  return `${base}${normalized}`;
}

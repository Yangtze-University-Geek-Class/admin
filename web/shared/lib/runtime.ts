// 运行时状态：当前是哪个端、数据源是 mock 还是 live、跨端 URL 怎么拼。
//
// 拆分后每个端有独立入口（web/sites/<端>/main.tsx），入口挂载时通过
// setCurrentSite() 声明自己是谁 —— 不再需要靠 hostname 去猜。
import { appConfig, runtimeEnvironment, type AppSiteKind, type DataSource } from "../config";

let currentSite: AppSiteKind | null = null;

/** 由 mountSite() 调用，标记当前渲染的是哪个端。 */
export function setCurrentSite(kind: AppSiteKind): void {
  currentSite = kind;
  document.documentElement.dataset.site = kind;
}

export function getCurrentSite(): AppSiteKind {
  return currentSite ?? runtimeEnvironment().defaultSite;
}

/**
 * 该端在当前浏览器地址下的路由 basename。
 *
 * 三个端的配置 basename 都是空串，例外有二：
 *  · 开发态每个端由 Vite 从 `/sites/<端>/` 提供（见 vite.config.ts 的
 *    devSiteFallback），路由前缀必须跟上，否则站内点击会跳出入口；
 *  · 论坛挂在官网域名的 `/forum` 路径下时（子域尚未启用）。
 */
export function getBasePath(kind: AppSiteKind): string {
  const configured = appConfig.sites[kind].basePath;

  if (import.meta.env.DEV) return `/sites/${kind}`;

  if (typeof window === "undefined" || kind !== "forum") return configured;

  const onPortalHost = window.location.hostname === appConfig.sites.portal.host;
  const underForumPath = window.location.pathname.startsWith("/forum");
  return onPortalHost && underForumPath ? "/forum" : configured;
}

const DEV_DATA_KEY = "yugc:dev-data-source";

export function getDataSource(): DataSource {
  const runtime = runtimeEnvironment();
  if (!runtime.allowDataSourceOverride) return runtime.dataSource;
  const fromQuery = typeof window !== "undefined"
    ? new URLSearchParams(window.location.search).get("__data") as DataSource | null
    : null;
  if (fromQuery === "mock" || fromQuery === "live") return fromQuery;
  try {
    const stored = localStorage.getItem(DEV_DATA_KEY) as DataSource | null;
    if (stored === "mock" || stored === "live") return stored;
  } catch {
    /* localStorage 不可用时忽略，用默认值 */
  }
  return runtime.dataSource;
}

export function setDataSource(source: DataSource): void {
  if (!runtimeEnvironment().allowDataSourceOverride || typeof window === "undefined") return;
  try {
    localStorage.setItem(DEV_DATA_KEY, source);
  } catch {
    /* 忽略 */
  }
  const url = new URL(window.location.href);
  url.searchParams.set("__data", source);
  window.location.assign(url.toString());
}

/** 跳到另一个端。开发态在同一个 Vite server 上按路径切换。 */
export function crossSiteHref(target: AppSiteKind, path = "/"): string {
  if (target === "forum" && import.meta.env.DEV) return `http://127.0.0.1:3456${path.startsWith("/") ? path : "/" + path}`;
  const suffix = path.startsWith("/") ? path : `/${path}`;
  return import.meta.env.DEV ? `/sites/${target}${suffix}` : `${window.location.protocol}//${appConfig.sites[target].host}${suffix}`;
}

/**
 * 跨端跳转的 URL。同端返回站内相对路径；跨端在开发态走 `/sites/<端>/…`，
 * 生产态走绝对域名（论坛在官网域名下时特殊处理为 `/forum` 前缀）。
 */
export function externalSiteUrl(target: AppSiteKind, path = "/"): string {
  if (target === "forum") return crossSiteHref(target, path);
  if (typeof window === "undefined") return path;

  const suffix = path.startsWith("/") ? path : `/${path}`;
  if (getCurrentSite() === target) return path;

  if (import.meta.env.DEV) return `/sites/${target}${suffix}`;

  const proto = window.location.protocol === "http:" ? "http:" : "https:";
  return `${proto}//${appConfig.sites[target].host}${suffix}`;
}

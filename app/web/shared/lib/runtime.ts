// 运行时状态：当前是哪个端、数据源是 mock 还是 live、跨端 URL 怎么拼。
//
// 拆分后每个端有独立入口（app/web/sites/<端>/main.tsx），入口挂载时通过
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
 * 每个环境只有一个域名：portal 与 admin 的 basename 都是空串（admin 路由自带 `/admin`
 * 前缀），论坛是同域名下的 `/forum`。例外只有开发态：每个端由 Vite 从 `/sites/<端>/`
 * 提供（见 vite.config.ts 的 devSiteFallback），路由前缀必须跟上，否则站内点击会跳出入口。
 */
export function getBasePath(kind: AppSiteKind): string {
  if (import.meta.env.DEV) return `/sites/${kind}`;
  return appConfig.sites[kind].basePath;
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

/**
 * 跳到另一个端。生产态三端同一个域名，只拼同源路径（目标端 basePath + 路径），不写域名；
 * 开发态在同一个 Vite server 上按 `/sites/<端>/…` 切换，论坛在独立的 3456 端口。
 */
export function crossSiteHref(target: AppSiteKind, path = "/"): string {
  const suffix = path.startsWith("/") ? path : `/${path}`;
  if (import.meta.env.DEV) return target === "forum" ? `http://127.0.0.1:3456${suffix}` : `/sites/${target}${suffix}`;
  return `${appConfig.sites[target].basePath}${suffix}`;
}

/**
 * 跨端跳转的 URL。同端返回站内相对路径；跨端交给 crossSiteHref：生产态是同源路径
 * （论坛 `/forum/…`、管理端 `/admin/…`），整页跳转后由服务端按路径选入口。
 */
export function externalSiteUrl(target: AppSiteKind, path = "/"): string {
  if (target === "forum") return crossSiteHref(target, path);
  if (typeof window === "undefined") return path;
  if (getCurrentSite() === target) return path;
  return crossSiteHref(target, path);
}

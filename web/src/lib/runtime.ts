import { appConfig, runtimeEnvironment, type AppSiteKind, type DataSource } from "../config";

const SITE_KEY = "yugc:dev-site";
const DATA_KEY = "yugc:dev-data-source";

function readLocal<T extends string>(key: string, allowed: readonly T[]): T | null {
  if (typeof window === "undefined") return null;
  try {
    const value = localStorage.getItem(key) as T | null;
    return value && allowed.includes(value) ? value : null;
  } catch {
    return null;
  }
}

export function getSiteOverride(): AppSiteKind | null {
  const runtime = runtimeEnvironment();
  if (!runtime.allowSiteOverride) return null;
  const fromQuery = typeof window !== "undefined"
    ? new URLSearchParams(window.location.search).get("__site") as AppSiteKind | null
    : null;
  if (fromQuery && ["portal", "forum", "admin"].includes(fromQuery)) return fromQuery;
  return readLocal(SITE_KEY, ["portal", "forum", "admin"] as const);
}

export function setSiteOverride(site: AppSiteKind): void {
  if (!runtimeEnvironment().allowSiteOverride || typeof window === "undefined") return;
  localStorage.setItem(SITE_KEY, site);
  const url = new URL(window.location.href);
  url.searchParams.set("__site", site);
  url.pathname = site === "admin" ? "/admin" : "/";
  window.location.assign(url.toString());
}

export function getDataSource(): DataSource {
  const runtime = runtimeEnvironment();
  if (!runtime.allowDataSourceOverride) return runtime.dataSource;
  const fromQuery = typeof window !== "undefined"
    ? new URLSearchParams(window.location.search).get("__data") as DataSource | null
    : null;
  if (fromQuery === "mock" || fromQuery === "live") return fromQuery;
  return readLocal(DATA_KEY, ["mock", "live"] as const) ?? runtime.dataSource;
}

export function setDataSource(source: DataSource): void {
  if (!runtimeEnvironment().allowDataSourceOverride || typeof window === "undefined") return;
  localStorage.setItem(DATA_KEY, source);
  const url = new URL(window.location.href);
  url.searchParams.set("__data", source);
  window.location.assign(url.toString());
}

export function externalSiteUrl(target: AppSiteKind, path = "/"): string {
  const entry = appConfig.sites[target];
  if (typeof window === "undefined") return path;
  const current = resolveRuntimeSite();
  if (current === target) return path;
  if (runtimeEnvironment().allowSiteOverride && !Object.values(appConfig.sites).some((site) => site.host === window.location.hostname)) {
    const url = new URL(window.location.href);
    url.pathname = target === "admin" ? (path.startsWith("/admin") ? path : "/admin") : path;
    url.searchParams.set("__site", target);
    return `${url.pathname}${url.search}`;
  }
  const proto = window.location.protocol === "http:" ? "http" : "https";
  if (target === "forum" && window.location.hostname === appConfig.sites.portal.host) {
    return path === "/" ? "/forum" : `/forum${path.startsWith("/") ? path : `/${path}`}`;
  }
  return `${proto}://${entry.host}${path.startsWith("/") ? path : `/${path}`}`;
}

export function resolveRuntimeSite(): AppSiteKind {
  if (typeof window === "undefined") return runtimeEnvironment().defaultSite;
  const override = getSiteOverride();
  if (override) return override;
  const host = window.location.hostname;
  if (host === appConfig.sites.portal.host && window.location.pathname.startsWith("/forum")) return "forum";
  const direct = (Object.entries(appConfig.sites) as [AppSiteKind, { host: string }][]).find(([, site]) => site.host === host);
  return direct?.[0] ?? runtimeEnvironment().defaultSite;
}

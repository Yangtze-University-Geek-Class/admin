import { appConfig, type AppSiteKind } from "../config";
import { externalSiteUrl, resolveRuntimeSite } from "./runtime";

export type SiteKind = AppSiteKind;

export type SiteConfig = {
  kind: SiteKind;
  host: string;
  title: string;
  defaultTheme: string;
  allowThemeSwitch: boolean;
  themePalette: string[];
  basePath: string;
};

export function detectSite(): SiteConfig {
  const kind = resolveRuntimeSite();
  const configured = appConfig.sites[kind];
  const portalForumFallback = typeof window !== "undefined"
    && kind === "forum"
    && window.location.hostname === appConfig.sites.portal.host
    && window.location.pathname.startsWith("/forum");
  return {
    kind,
    ...configured,
    host: portalForumFallback ? appConfig.sites.portal.host : configured.host,
    basePath: portalForumFallback ? "/forum" : configured.basePath,
  };
}

export function externalUrl(target: SiteKind, path = "/"): string {
  return externalSiteUrl(target, path);
}

export function forumBasePath(): string {
  return detectSite().basePath;
}

export function forumPath(path: string): string {
  const base = forumBasePath();
  if (path === "" || path === "/") return base || "/";
  const normalized = path.startsWith("/") ? path : `/${path}`;
  return `${base}${normalized}`;
}

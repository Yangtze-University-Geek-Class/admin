// Typed access to app.config.json. Keep the types here in sync when editing the JSON.
import rawConfig from "./app.config.json";

export type AppSiteKind = "portal" | "forum" | "admin";
export type DataSource = "mock" | "live";

type RuntimeEnvironment = {
  defaultSite: AppSiteKind;
  dataSource: DataSource;
  showControlCenter: boolean;
  allowSiteOverride: boolean;
  allowDataSourceOverride: boolean;
};

// 每个环境只有一个域名：站点不带 host，portal/admin 由 URL 路径区分，论坛挂在 basePath（/forum）下。
type SiteEntry = {
  title: string;
  basePath: string;
};

type AppConfig = {
  environment: { development: RuntimeEnvironment; production: RuntimeEnvironment };
  sites: Record<AppSiteKind, SiteEntry>;
  urls: { githubOrg: string };
  features: {
    development: Record<string, boolean>;
    production: Record<string, boolean>;
  };
  portal: {
    /**
     * 官网只从配置读品牌；页面、路由、链接与文案在 app/web/sites/portal 里（规范见 docs/services/web/portal.md）。
     * 跨站链接的唯一解析点是 app/web/sites/portal/lib/links.ts。
     */
    brand: { homePath: string; logo: string; logoAlt: string; title: string; subtitle: string };
  };
};

export const appConfig = rawConfig as AppConfig;

/**
 * PR 预览构建（#245）：构建时设 VITE_PREVIEW_MOCK=1，生产形态的构建改用样板数据、不连任何后端。
 * 只有 pr-preview.yml 会设置；镜像构建与两条部署工作流从不设置（tests/tooling/pr-preview.test.ts 核对），
 * 未设置时这个常量在构建里被替换成 false，样板数据代码照旧从生产产物里删掉。
 */
export const PREVIEW_MOCK: boolean = import.meta.env.VITE_PREVIEW_MOCK === "1";

export function runtimeEnvironment(): RuntimeEnvironment {
  if (PREVIEW_MOCK) return { ...appConfig.environment.production, dataSource: "mock" };
  return import.meta.env.PROD ? appConfig.environment.production : appConfig.environment.development;
}

export function runtimeFeatures(): Record<string, boolean> {
  return import.meta.env.PROD ? appConfig.features.production : appConfig.features.development;
}

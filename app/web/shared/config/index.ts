// Typed access to app.config.json. Keep the types here in sync when editing the JSON.
import rawConfig from "./app.config.json";

export type AppSiteKind = "portal" | "forum" | "admin";
export type DataSource = "mock" | "live";
export type MascotPoseName = "welcome" | "coding" | "ai" | "security" | "question" | "resource" | "intro" | "sleep";

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

type MascotPoseConfig = {
  file: string;
  label: string;
  fit: "contain" | "cover";
  position: string;
  scale: number;
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
  mascot: {
    defaultPose: MascotPoseName;
    width: number;
    height: number;
    poses: Record<MascotPoseName, MascotPoseConfig>;
    dialogs: Record<MascotPoseName, string[]>;
  };
};

export const appConfig = rawConfig as AppConfig;

export function runtimeEnvironment(): RuntimeEnvironment {
  return import.meta.env.PROD ? appConfig.environment.production : appConfig.environment.development;
}

export function runtimeFeatures(): Record<string, boolean> {
  return import.meta.env.PROD ? appConfig.features.production : appConfig.features.development;
}

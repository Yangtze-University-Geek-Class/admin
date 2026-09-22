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

type SiteEntry = {
  host: string;
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

export type PortalNavigationItem = {
  id: string;
  label: string;
  type: "route" | "site" | "external";
  path?: string;
  site?: AppSiteKind;
  urlKey?: "githubOrg";
  newTab?: boolean;
  variant: "text" | "primary";
};

export type PortalEntryItem = {
  navId: string;
  index: string;
  title: string;
  desc: string;
  action: string;
  image: string;
  alt: string;
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
    brand: { homePath: string; logo: string; logoAlt: string; title: string; subtitle: string };
    navigation: PortalNavigationItem[];
    /** 首页主视觉文案与配图。视觉令牌在 app/web/sites/portal/theme.css，规范见 docs/design/DESIGN.md。 */
    hero: {
      eyebrow: string;
      titleLead: string;
      titleAccent: string;
      lead: string;
      status: string;
      season: string;
      pose: MascotPoseName;
      caption: string;
      /** 主视觉画布卡：静态图是必需的兜底（也是 reduced-motion 下唯一显示的内容），视频可选。 */
      art: { image: string; video?: string };
    };
    /** 首页第二屏：三个入口卡片。navId 引用 navigation[].id，跳转规则只在导航里定义一次。 */
    entries: {
      kicker: string;
      title: string;
      desc: string;
      items: PortalEntryItem[];
    };
    /** 首页第三屏：做事方式。 */
    principles: {
      kicker: string;
      title: string;
      desc: string;
      image: string;
      alt: string;
      items: { title: string; desc: string }[];
    };
    closing: { title: string; desc: string };
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

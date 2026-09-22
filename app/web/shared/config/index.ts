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
  /** 首屏按钮下方与入口卡上的一行短提示 */
  hint: string;
  desc: string;
  action: string;
  /** 入口卡「窗口标题栏」里的路径标签，例如 ~/yugc/apply */
  path: string;
  image: string;
  alt: string;
};

/** 滚动舞台里的一张吉祥物立绘（透明底 webp）；width/height 是原图像素，用于占位与 contain 排版。 */
export type PortalPose = { image: string; small?: string; width: number; height: number; alt: string };

/** 滚动舞台的一章：LED 点阵大字 + 两行标题 + 一段说明 + 这一章的 NANO 姿势。第一章就是首屏。 */
export type PortalChapter = {
  word: string;
  lead: string;
  accent: string;
  desc: string;
  pose: PortalPose;
  /** 引用 navigation[].id，章节里的行动链接 */
  link?: string;
  linkLabel?: string;
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
    /**
     * 首页滚动舞台（首屏 + 滚动叙事是同一个 sticky 舞台）：代码窗口、提示符、三个按钮、LED 点阵大字与吉祥物。
     * chapters[0] 是首屏（其标题是页面唯一的 h1），其余章节随滚动进度依次出现。
     * 视觉令牌在 app/web/sites/portal/theme.css，规范见 docs/design/DESIGN.md。
     */
    stage: {
      /** 通用招人口号，不写学期或年份 */
      status: string;
      tag: string;
      prompt: string;
      microcopy: string;
      /** 代码窗口里的装饰代码行（读屏隐藏） */
      code: string[];
      comment: string;
      signature: string;
      signatureNote: string;
      robot: string;
      chapters: PortalChapter[];
    };
    /** 三个入口：首屏按钮与入口卡共用。navId 引用 navigation[].id，跳转规则只在导航里定义一次。 */
    entries: {
      kicker: string;
      title: string;
      desc: string;
      items: PortalEntryItem[];
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

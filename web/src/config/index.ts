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
  defaultTheme: string;
  allowThemeSwitch: boolean;
  themePalette: string[];
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
  urls: { portal: string; forum: string; admin: string; githubOrg: string; localApiOrigin: string };
  features: {
    development: Record<string, boolean>;
    production: Record<string, boolean>;
  };
  portal: {
    palette: {
      bg: string;
      panel: string;
      panelStrong: string;
      line: string;
      accent: string;
      accentSoft: string;
      text: string;
      muted: string;
      warm: string;
    };
    effects: { codeSnippets: string[]; symbolCount: number };
    hero: { eyebrow: string; titleLead: string; titleAccent: string; status: string };
  };
  mascot: {
    defaultPose: MascotPoseName;
    publicWidth: number;
    publicHeight: number;
    communityWidth: number;
    communityHeight: number;
    dialogGap: number;
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

export function isDevelopmentBuild(): boolean {
  return import.meta.env.DEV;
}

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

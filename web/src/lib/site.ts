export type SiteKind = "portal" | "forum" | "admin";

export type SiteConfig = {
  kind: SiteKind;
  host: string;
  title: string;
  defaultTheme: string;
  allowThemeSwitch: boolean;
  themePalette: string[];
};

const HOST_MAP: Record<string, SiteConfig> = {
  "forum.yangtzeu.work": {
    kind: "forum",
    host: "forum.yangtzeu.work",
    title: "YUGC 论坛 · 长江大学极客班",
    defaultTheme: "yzgc-blue",
    allowThemeSwitch: true,
    themePalette: ["yzgc-blue", "github-light", "catppuccin-latte", "github-dark", "tokyo-night"],
  },
  "github.yangtzeu.work": {
    kind: "admin",
    host: "github.yangtzeu.work",
    title: "YUGC Admin · 组织管理",
    defaultTheme: "github-dark",
    allowThemeSwitch: true,
    themePalette: [
      "github-dark", "github-dark-dimmed", "github-light",
      "gruvbox-dark", "gruvbox-light",
      "catppuccin-mocha", "catppuccin-latte",
      "tokyo-night", "one-dark", "solarized-dark",
      "yzgc-blue",
    ],
  },
  "yangtzeu.work": {
    kind: "portal",
    host: "yangtzeu.work",
    title: "长江大学极客班 · YUGC",
    defaultTheme: "yzgc-blue",
    allowThemeSwitch: false,
    themePalette: ["yzgc-blue"],
  },
};

const DEFAULT_CONFIG: SiteConfig = HOST_MAP["yangtzeu.work"];

export function detectSite(): SiteConfig {
  if (typeof window === "undefined") return DEFAULT_CONFIG;
  const host = window.location.hostname;
  const direct = HOST_MAP[host];
  if (direct) return direct;
  const override = new URLSearchParams(window.location.search).get("__site");
  if (override === "forum") return HOST_MAP["forum.yangtzeu.work"];
  if (override === "admin") return HOST_MAP["github.yangtzeu.work"];
  return DEFAULT_CONFIG;
}

export function externalUrl(target: SiteKind, path = "/"): string {
  const entry = Object.values(HOST_MAP).find((s) => s.kind === target);
  if (!entry) return path;
  if (typeof window !== "undefined" && window.location.hostname === entry.host) return path;
  const proto = typeof window !== "undefined" && window.location.protocol === "http:" ? "http" : "https";
  return `${proto}://${entry.host}${path.startsWith("/") ? path : "/" + path}`;
}

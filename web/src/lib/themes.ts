export type Theme = {
  id: string;
  name: string;
  mode: "light";
  vars: Record<string, string>;
};

export const THEMES: Theme[] = [
  {
    id: "yzgc-blue",
    name: "校徽蓝白",
    mode: "light",
    vars: {
      "--ink-50": "18 49 86",
      "--ink-100": "31 66 106",
      "--ink-200": "56 91 131",
      "--ink-300": "89 119 154",
      "--ink-400": "124 151 182",
      "--ink-500": "163 185 210",
      "--ink-600": "200 217 235",
      "--ink-700": "220 232 245",
      "--ink-800": "236 244 252",
      "--ink-900": "246 250 254",
      "--ink-950": "253 254 255",
      "--brand-500": "43 108 190",
      "--brand-600": "31 88 164",
      "--brand-700": "24 69 132",
      "--bg-grad": "radial-gradient(1200px 800px at 18% -10%, rgb(78 145 213 / 0.15), transparent 60%), radial-gradient(900px 600px at 88% 4%, rgb(188 218 247 / 0.32), transparent 68%), linear-gradient(180deg, rgb(249 252 255) 0%, rgb(229 241 254) 100%)"
    }
  }
];

function themeKey(): string {
  if (typeof window === "undefined") return "theme:default";
  return `theme:${window.location.hostname}`;
}

export function applyTheme(id: string) {
  const theme = THEMES.find((item) => item.id === id) ?? THEMES[0];
  const root = document.documentElement;
  for (const [key, value] of Object.entries(theme.vars)) root.style.setProperty(key, value);
  root.dataset.theme = theme.id;
  root.dataset.mode = "light";
  root.classList.remove("dark");
  document.body.style.background = theme.vars["--bg-grad"];
  document.body.style.backgroundAttachment = "fixed";
  try { localStorage.setItem(themeKey(), theme.id); } catch {}
}

export function loadTheme(fallback = "yzgc-blue"): string {
  if (typeof window === "undefined") return fallback;
  const stored = localStorage.getItem(themeKey());
  return THEMES.some((theme) => theme.id === stored) ? stored! : fallback;
}

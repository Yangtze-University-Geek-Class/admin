export type Theme = {
  id: string;
  name: string;
  mode: "light" | "dark";
  vars: Record<string, string>;
};

const dark = (over: Record<string, string>): Record<string, string> => ({
  "--ink-50":  "248 250 252",
  "--ink-100": "241 245 249",
  "--ink-200": "226 232 240",
  "--ink-300": "203 213 225",
  "--ink-400": "148 163 184",
  "--ink-500": "100 116 139",
  "--ink-600": "71 85 105",
  "--ink-700": "51 65 85",
  "--ink-800": "30 41 59",
  "--ink-900": "15 23 42",
  "--ink-950": "2 6 23",
  "--brand-500": "91 141 239",
  "--brand-600": "58 111 224",
  "--brand-700": "44 84 176",
  "--bg-grad": "radial-gradient(1200px 800px at 20% -10%, rgb(91 141 239 / 0.18), transparent 60%), radial-gradient(900px 600px at 90% 10%, rgb(124 58 237 / 0.12), transparent 60%), rgb(2 6 23)",
  ...over,
});

const light = (over: Record<string, string>): Record<string, string> => ({
  "--ink-50":  "15 23 42",
  "--ink-100": "30 41 59",
  "--ink-200": "51 65 85",
  "--ink-300": "71 85 105",
  "--ink-400": "100 116 139",
  "--ink-500": "148 163 184",
  "--ink-600": "203 213 225",
  "--ink-700": "226 232 240",
  "--ink-800": "241 245 249",
  "--ink-900": "248 250 252",
  "--ink-950": "255 255 255",
  "--brand-500": "37 99 235",
  "--brand-600": "29 78 216",
  "--brand-700": "30 64 175",
  "--bg-grad": "radial-gradient(1200px 800px at 20% -10%, rgb(37 99 235 / 0.10), transparent 60%), rgb(255 255 255)",
  ...over,
});

export const THEMES: Theme[] = [
  { id: "github-dark", name: "GitHub Dark", mode: "dark", vars: dark({}) },
  { id: "github-dark-dimmed", name: "GitHub Dimmed", mode: "dark", vars: dark({
    "--ink-950": "13 17 23",
    "--ink-900": "22 27 34",
    "--ink-800": "33 38 45",
    "--ink-700": "48 54 61",
    "--brand-500": "88 166 255",
    "--bg-grad": "radial-gradient(1200px 800px at 20% -10%, rgb(88 166 255 / 0.10), transparent 60%), rgb(13 17 23)",
  }) },
  { id: "github-light", name: "GitHub Light", mode: "light", vars: light({}) },
  { id: "gruvbox-dark", name: "Gruvbox Dark", mode: "dark", vars: dark({
    "--ink-950": "29 32 33",
    "--ink-900": "40 40 40",
    "--ink-800": "60 56 54",
    "--ink-700": "80 73 69",
    "--ink-600": "102 92 84",
    "--ink-500": "146 131 116",
    "--ink-400": "168 153 132",
    "--ink-300": "189 174 147",
    "--ink-200": "213 196 161",
    "--ink-100": "235 219 178",
    "--ink-50":  "251 241 199",
    "--brand-500": "184 187 38",
    "--brand-600": "152 151 26",
    "--bg-grad": "radial-gradient(1200px 800px at 20% -10%, rgb(184 187 38 / 0.12), transparent 60%), rgb(29 32 33)",
  }) },
  { id: "gruvbox-light", name: "Gruvbox Light", mode: "light", vars: light({
    "--ink-950": "251 241 199",
    "--ink-900": "235 219 178",
    "--ink-800": "213 196 161",
    "--ink-50":  "40 40 40",
    "--ink-100": "60 56 54",
    "--ink-200": "80 73 69",
    "--brand-500": "121 116 14",
    "--bg-grad": "rgb(251 241 199)",
  }) },
  { id: "catppuccin-mocha", name: "Catppuccin Mocha", mode: "dark", vars: dark({
    "--ink-950": "17 17 27",
    "--ink-900": "24 24 37",
    "--ink-800": "30 30 46",
    "--ink-700": "49 50 68",
    "--ink-600": "69 71 90",
    "--ink-500": "108 112 134",
    "--ink-400": "147 153 178",
    "--ink-300": "166 173 200",
    "--ink-200": "186 194 222",
    "--ink-100": "205 214 244",
    "--ink-50":  "245 224 220",
    "--brand-500": "203 166 247",
    "--brand-600": "180 145 230",
    "--bg-grad": "radial-gradient(1200px 800px at 20% -10%, rgb(203 166 247 / 0.18), transparent 60%), radial-gradient(900px 600px at 90% 10%, rgb(245 194 231 / 0.12), transparent 60%), rgb(17 17 27)",
  }) },
  { id: "catppuccin-latte", name: "Catppuccin Latte", mode: "light", vars: light({
    "--ink-950": "239 241 245",
    "--ink-900": "230 233 239",
    "--ink-50":  "76 79 105",
    "--ink-100": "92 95 119",
    "--ink-200": "108 111 133",
    "--brand-500": "136 57 239",
    "--bg-grad": "rgb(239 241 245)",
  }) },
  { id: "tokyo-night", name: "Tokyo Night", mode: "dark", vars: dark({
    "--ink-950": "26 27 38",
    "--ink-900": "36 40 59",
    "--ink-800": "52 59 88",
    "--ink-700": "65 72 104",
    "--ink-500": "86 95 137",
    "--ink-300": "169 177 214",
    "--ink-100": "192 202 245",
    "--brand-500": "122 162 247",
    "--brand-600": "94 138 224",
    "--bg-grad": "radial-gradient(1200px 800px at 20% -10%, rgb(122 162 247 / 0.18), transparent 60%), radial-gradient(900px 600px at 90% 10%, rgb(187 154 247 / 0.10), transparent 60%), rgb(26 27 38)",
  }) },
  { id: "one-dark", name: "One Dark Pro", mode: "dark", vars: dark({
    "--ink-950": "30 33 39",
    "--ink-900": "40 44 52",
    "--ink-800": "55 59 70",
    "--ink-700": "76 82 99",
    "--ink-300": "171 178 191",
    "--ink-100": "220 223 228",
    "--brand-500": "97 175 239",
    "--brand-600": "78 146 207",
    "--bg-grad": "radial-gradient(1200px 800px at 20% -10%, rgb(97 175 239 / 0.18), transparent 60%), rgb(40 44 52)",
  }) },
  { id: "solarized-dark", name: "Solarized Dark", mode: "dark", vars: dark({
    "--ink-950": "0 30 38",
    "--ink-900": "0 43 54",
    "--ink-800": "7 54 66",
    "--ink-700": "88 110 117",
    "--ink-500": "101 123 131",
    "--ink-300": "147 161 161",
    "--ink-100": "238 232 213",
    "--brand-500": "38 139 210",
    "--brand-600": "30 117 178",
    "--bg-grad": "radial-gradient(1200px 800px at 20% -10%, rgb(38 139 210 / 0.18), transparent 60%), rgb(0 30 38)",
  }) },
  { id: "yzgc-blue", name: "校徽蓝白 (论坛默认)", mode: "light", vars: light({
    "--ink-50":  "0 33 71",
    "--ink-100": "0 51 102",
    "--ink-200": "30 73 138",
    "--ink-300": "82 109 161",
    "--ink-400": "120 144 184",
    "--ink-500": "163 184 213",
    "--ink-600": "208 220 234",
    "--ink-700": "227 235 246",
    "--ink-800": "240 245 251",
    "--ink-900": "248 251 254",
    "--ink-950": "255 255 255",
    "--brand-500": "0 63 136",
    "--brand-600": "0 50 110",
    "--brand-700": "0 33 80",
    "--bg-grad": "radial-gradient(1200px 800px at 15% -10%, rgb(0 63 136 / 0.10), transparent 60%), radial-gradient(900px 600px at 90% 0%, rgb(56 132 224 / 0.08), transparent 65%), linear-gradient(180deg, #FFFFFF 0%, #F0F5FB 100%)",
  }) },
];

function themeKey(): string {
  if (typeof window === "undefined") return "theme:default";
  return `theme:${window.location.hostname}`;
}

export function applyTheme(id: string) {
  const t = THEMES.find((x) => x.id === id) ?? THEMES[0];
  const root = document.documentElement;
  for (const [k, v] of Object.entries(t.vars)) root.style.setProperty(k, v);
  root.dataset.theme = t.id;
  root.dataset.mode = t.mode;
  root.classList.toggle("dark", t.mode === "dark");
  document.body.style.background = t.vars["--bg-grad"];
  try { localStorage.setItem(themeKey(), t.id); } catch {}
}

export function loadTheme(fallback = "yzgc-blue"): string {
  if (typeof window === "undefined") return fallback;
  return localStorage.getItem(themeKey()) ?? fallback;
}

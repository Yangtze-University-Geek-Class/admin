import { useEffect, useRef, useState } from "react";
import { THEMES, applyTheme, loadTheme } from "../lib/themes";
import { detectSite } from "../lib/site";

type Props = { compact?: boolean; direction?: "down" | "up" };

export default function ThemeSwitcher({ compact = false, direction = "down" }: Props) {
  const site = detectSite();
  const [open, setOpen] = useState(false);
  const [current, setCurrent] = useState(loadTheme(site.defaultTheme));
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const onDoc = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("click", onDoc);
    return () => document.removeEventListener("click", onDoc);
  }, []);

  if (!site.allowThemeSwitch) return null;

  const allowedThemes = THEMES.filter((t) => site.themePalette.includes(t.id));

  const pick = (id: string) => {
    applyTheme(id);
    setCurrent(id);
    setOpen(false);
  };

  const currentTheme = THEMES.find((t) => t.id === current) ?? allowedThemes[0] ?? THEMES[0];

  return (
    <div className="relative" ref={ref}>
      <button
        onClick={() => setOpen(!open)}
        className={`flex items-center gap-2 rounded-lg text-ink-200 hover:bg-ink-800/60 border border-ink-700/60 transition ${
          compact ? "p-2 justify-center" : "px-3 py-1.5 text-sm"
        }`}
        title={`切换主题: ${currentTheme.name}`}
        aria-label="切换主题"
      >
        <span className="w-4 h-4 rounded-full flex-shrink-0 border border-ink-600"
          style={{
            background: `rgb(${currentTheme.vars["--brand-500"]})`,
            boxShadow: `inset 0 0 0 2px rgb(${currentTheme.vars["--ink-950"]})`,
          }} />
        {!compact && <span className="whitespace-nowrap">{currentTheme.name}</span>}
      </button>
      {open && (
        <div className={`absolute card p-2 z-50 max-h-[70vh] overflow-auto min-w-[200px] ${
          direction === "up" ? "bottom-full mb-2 left-0" : "top-full mt-2 right-0"
        }`}>
          {allowedThemes.map((t) => (
            <button
              key={t.id}
              onClick={() => pick(t.id)}
              className={`w-full text-left px-3 py-2 rounded-md text-sm transition flex items-center gap-3 whitespace-nowrap ${
                t.id === current ? "bg-brand-500/15 text-brand-500" : "text-ink-200 hover:bg-ink-800/60"
              }`}
            >
              <span className="w-4 h-4 rounded-full border border-ink-600 flex-shrink-0"
                style={{
                  background: `rgb(${t.vars["--brand-500"]})`,
                  boxShadow: `inset 0 0 0 2px rgb(${t.vars["--ink-950"]})`,
                }} />
              <span className="flex-1">{t.name}</span>
              {t.id === current && <span className="text-xs">●</span>}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

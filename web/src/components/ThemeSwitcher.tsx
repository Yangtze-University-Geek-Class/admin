import { useEffect, useRef, useState } from "react";
import { THEMES, applyTheme, loadTheme } from "../lib/themes";

export default function ThemeSwitcher() {
  const [open, setOpen] = useState(false);
  const [current, setCurrent] = useState(loadTheme());
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const onDoc = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("click", onDoc);
    return () => document.removeEventListener("click", onDoc);
  }, []);

  const pick = (id: string) => {
    applyTheme(id);
    setCurrent(id);
    setOpen(false);
  };

  const currentTheme = THEMES.find((t) => t.id === current) ?? THEMES[0];

  return (
    <div className="relative" ref={ref}>
      <button
        onClick={() => setOpen(!open)}
        className="flex items-center gap-2 px-3 py-1.5 rounded-lg text-sm text-ink-200 hover:bg-ink-800/60 border border-ink-700/60"
        title="切换主题"
      >
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="w-4 h-4">
          <circle cx="12" cy="12" r="4" />
          <path strokeLinecap="round" d="M12 2v2M12 20v2M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41M2 12h2M20 12h2M4.93 19.07l1.41-1.41M17.66 6.34l1.41-1.41" />
        </svg>
        <span className="hidden sm:inline">{currentTheme.name}</span>
      </button>
      {open && (
        <div className="absolute right-0 mt-2 w-56 card p-2 z-50 max-h-[80vh] overflow-auto">
          {THEMES.map((t) => (
            <button
              key={t.id}
              onClick={() => pick(t.id)}
              className={`w-full text-left px-3 py-2 rounded-md text-sm transition flex items-center gap-3 ${
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

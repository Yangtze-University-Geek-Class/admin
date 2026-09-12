import { useEffect, useRef, useState } from "react";

export type SelectOption = { value: string; label: string; hint?: string };

type Props = {
  value: string;
  onChange: (v: string) => void;
  options: SelectOption[];
  placeholder?: string;
  disabled?: boolean;
  className?: string;
  size?: "sm" | "md";
};

export default function Select({ value, onChange, options, placeholder, disabled, className = "", size = "md" }: Props) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const onDoc = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("click", onDoc);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("click", onDoc);
      document.removeEventListener("keydown", onKey);
    };
  }, []);

  const current = options.find((o) => o.value === value);
  const pad = size === "sm" ? "px-2.5 py-1.5 text-sm" : "px-3 py-2";

  return (
    <div className={`relative ${className}`} ref={ref}>
      <button
        type="button"
        onClick={() => !disabled && setOpen(!open)}
        disabled={disabled}
        className={`w-full ${pad} bg-ink-900/60 border border-ink-700/70 rounded-lg text-left text-ink-100 hover:border-ink-600 focus:outline-none focus:border-brand-500/60 focus:ring-2 focus:ring-brand-500/30 transition disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-2`}
        aria-haspopup="listbox"
        aria-expanded={open}
      >
        <span className="flex-1 truncate">
          {current ? current.label : <span className="text-ink-500">{placeholder ?? "选择…"}</span>}
        </span>
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className={`w-4 h-4 text-ink-400 flex-shrink-0 transition-transform ${open ? "rotate-180" : ""}`}
          strokeLinecap="round" strokeLinejoin="round">
          <path d="m6 9 6 6 6-6" />
        </svg>
      </button>
      {open && (
        <div
          className="absolute left-0 right-0 z-50 mt-1.5 card p-1 max-h-72 overflow-auto animate-[popIn_120ms_ease-out]"
          role="listbox"
        >
          {options.map((o) => {
            const active = o.value === value;
            return (
              <button
                key={o.value}
                type="button"
                role="option"
                aria-selected={active}
                onClick={() => { onChange(o.value); setOpen(false); }}
                className={`w-full text-left px-3 py-2 rounded-md text-sm transition flex items-center gap-3 ${
                  active ? "bg-brand-500/15 text-brand-500" : "text-ink-200 hover:bg-ink-800/60"
                }`}
              >
                <span className="flex-1 truncate">{o.label}</span>
                {o.hint && <span className="text-xs text-ink-500">{o.hint}</span>}
                {active && <span className="text-xs">●</span>}
              </button>
            );
          })}
          {options.length === 0 && (
            <div className="px-3 py-4 text-center text-ink-500 text-sm">无选项</div>
          )}
        </div>
      )}
    </div>
  );
}

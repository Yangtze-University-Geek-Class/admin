import { useEffect, useState } from "react";

type Props = {
  value: number;
  onChange: (v: number) => void;
  min?: number;
  max?: number;
  step?: number;
  disabled?: boolean;
  className?: string;
};

export default function NumberInput({ value, onChange, min, max, step = 1, disabled, className = "" }: Props) {
  const [draft, setDraft] = useState(String(value));
  useEffect(() => { setDraft(Number.isFinite(value) ? String(value) : ""); }, [value]);
  const clamp = (n: number) => {
    if (Number.isNaN(n)) return min ?? 0;
    if (min !== undefined && n < min) return min;
    if (max !== undefined && n > max) return max;
    return n;
  };
  const dec = () => onChange(clamp(value - step));
  const inc = () => onChange(clamp(value + step));

  return (
    <div className={`flex items-stretch w-full bg-ink-900/60 border border-ink-700/70 rounded-lg overflow-hidden focus-within:border-brand-500/60 focus-within:ring-2 focus-within:ring-brand-500/30 transition ${className}`}>
      <button type="button" onClick={dec} disabled={disabled || (min !== undefined && value <= min)}
        className="px-3 text-ink-300 hover:bg-ink-800/60 disabled:opacity-30 transition border-r border-ink-700/70"
        aria-label="减少">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" className="w-3.5 h-3.5" strokeLinecap="round"><path d="M5 12h14" /></svg>
      </button>
      <input type="number" aria-label="数值" value={draft}
        onChange={(e) => { setDraft(e.target.value); const next = Number(e.target.value); if (e.target.value && Number.isFinite(next) && clamp(next) === next) onChange(next); }}
        onBlur={() => { const next = draft.trim() ? Number(draft) : NaN; if (Number.isFinite(next)) { const normalized = clamp(next); setDraft(String(normalized)); onChange(normalized); } else setDraft(String(value)); }}
        min={min} max={max} step={step} disabled={disabled}
        className="flex-1 min-w-0 bg-transparent text-ink-100 text-center px-2 py-2 outline-none [-moz-appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none" />
      <button type="button" onClick={inc} disabled={disabled || (max !== undefined && value >= max)}
        className="px-3 text-ink-300 hover:bg-ink-800/60 disabled:opacity-30 transition border-l border-ink-700/70"
        aria-label="增加">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" className="w-3.5 h-3.5" strokeLinecap="round"><path d="M12 5v14M5 12h14" /></svg>
      </button>
    </div>
  );
}

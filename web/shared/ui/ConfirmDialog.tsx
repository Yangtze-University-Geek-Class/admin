import { createContext, useCallback, useContext, useEffect, useState } from "react";
import { createPortal } from "react-dom";

type Variant = "default" | "danger";
type ConfirmOptions = {
  title: string;
  body?: string;
  confirmText?: string;
  cancelText?: string;
  variant?: Variant;
};

type Pending = ConfirmOptions & { resolve: (v: boolean) => void };

const Ctx = createContext<(opts: ConfirmOptions) => Promise<boolean>>(async () => false);

export function useConfirm() {
  return useContext(Ctx);
}

export function ConfirmProvider({ children }: { children: React.ReactNode }) {
  const [pending, setPending] = useState<Pending | null>(null);

  const confirm = useCallback((opts: ConfirmOptions) =>
    new Promise<boolean>((resolve) => setPending({ ...opts, resolve })), []);

  const close = (v: boolean) => {
    pending?.resolve(v);
    setPending(null);
  };

  useEffect(() => {
    if (!pending) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") close(false);
      if (e.key === "Enter") close(true);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [pending]);

  return (
    <Ctx.Provider value={confirm}>
      {children}
      {pending && createPortal(
        <div className="fixed inset-0 z-[200] flex items-center justify-center p-4" role="dialog" aria-modal="true">
          <div
            className="absolute inset-0 bg-ink-950/70 backdrop-blur-sm animate-[fadeIn_120ms_ease-out]"
            onClick={() => close(false)}
          />
          <div className="relative card w-full max-w-md p-6 animate-[popIn_140ms_ease-out]">
            <div className="flex items-start gap-4">
              <div className={`w-10 h-10 rounded-xl flex items-center justify-center flex-shrink-0 ${
                pending.variant === "danger" ? "bg-rose-500/15 text-rose-400" : "bg-brand-500/15 text-brand-500"
              }`}>
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="w-5 h-5" strokeLinecap="round" strokeLinejoin="round">
                  {pending.variant === "danger"
                    ? <><path d="M10.29 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0Z" /><path d="M12 9v4M12 17h.01" /></>
                    : <><circle cx="12" cy="12" r="10" /><path d="M12 16v-4M12 8h.01" /></>}
                </svg>
              </div>
              <div className="flex-1 min-w-0">
                <h3 className="text-lg font-semibold text-ink-100">{pending.title}</h3>
                {pending.body && <p className="text-ink-400 text-sm mt-2 leading-relaxed">{pending.body}</p>}
              </div>
            </div>
            <div className="flex justify-end gap-2 mt-6">
              <button className="btn-ghost" onClick={() => close(false)}>
                {pending.cancelText ?? "取消"}
              </button>
              <button
                className={pending.variant === "danger" ? "btn-danger" : "btn-primary"}
                onClick={() => close(true)}
                autoFocus
              >
                {pending.confirmText ?? "确定"}
              </button>
            </div>
          </div>
        </div>,
        document.body
      )}
    </Ctx.Provider>
  );
}

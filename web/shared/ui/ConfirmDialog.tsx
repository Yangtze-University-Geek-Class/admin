import { createContext, useCallback, useContext, useEffect, useRef, useState } from "react";
import Modal from "./Modal";

type ConfirmOptions = { title: string; body?: string; confirmText?: string; cancelText?: string; variant?: "default" | "danger" };
type Pending = ConfirmOptions & { id: number; resolve: (value: boolean) => void };
const Context = createContext<((options: ConfirmOptions) => Promise<boolean>) | null>(null);
export function useConfirm() {
  const confirm = useContext(Context);
  if (!confirm) throw new Error("useConfirm requires ConfirmProvider");
  return confirm;
}
export function ConfirmProvider({ children }: { children: React.ReactNode }) {
  const queue = useRef<Pending[]>([]);
  const counter = useRef(0);
  const [pending, setPending] = useState<Pending | null>(null);
  const cancelRef = useRef<HTMLButtonElement>(null);
  const confirm = useCallback((options: ConfirmOptions) => new Promise<boolean>(resolve => {
    const entry = { ...options, id: ++counter.current, resolve };
    queue.current.push(entry);
    if (queue.current.length === 1) setPending(entry);
  }), []);
  const close = (id: number, value: boolean) => {
    if (queue.current[0]?.id !== id) return;
    queue.current.shift()!.resolve(value);
    setPending(queue.current[0] ?? null);
  };
  useEffect(() => () => { for (const item of queue.current.splice(0)) item.resolve(false); }, []);
  return <Context.Provider value={confirm}>
    {children}
    {pending && <Modal key={pending.id} title={pending.title} description={pending.body} role={pending.variant === "danger" ? "alertdialog" : "dialog"}
      initialFocusRef={cancelRef} onClose={() => close(pending.id, false)}>
      <div className="flex justify-end gap-3">
        <button ref={cancelRef} type="button" className="btn-ghost" onClick={() => close(pending.id, false)}>{pending.cancelText ?? "取消"}</button>
        <button type="button" className={pending.variant === "danger" ? "btn-danger" : "btn-primary"} onClick={() => close(pending.id, true)}>{pending.confirmText ?? "确定"}</button>
      </div>
    </Modal>}
  </Context.Provider>;
}

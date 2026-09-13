import { useEffect, useId, useRef, type ReactNode, type RefObject } from "react";
import { createPortal } from "react-dom";

type Props = {
  title: string;
  description?: string;
  children: ReactNode;
  onClose: () => void;
  role?: "dialog" | "alertdialog";
  initialFocusRef?: RefObject<HTMLElement | null>;
  dismissible?: boolean;
  className?: string;
};

/** Native modal top layer provides inert background and focus containment. */
export default function Modal({ title, description, children, onClose, role = "dialog", initialFocusRef, dismissible = true, className = "" }: Props) {
  const ref = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  const descriptionId = useId();
  useEffect(() => {
    const dialog = ref.current;
    if (!dialog) return;
    const previous = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    dialog.showModal();
    initialFocusRef?.current?.focus();
    return () => { dialog.close(); if (previous?.isConnected) previous.focus(); };
  }, []);
  return createPortal(
    <dialog ref={ref} className={`app-modal card p-6 ${className}`} role={role} aria-modal="true" aria-labelledby={titleId} aria-describedby={description ? descriptionId : undefined}
      tabIndex={-1}
      onKeyDown={event => {
        if (event.key !== "Tab" || event.nativeEvent.isComposing) return;
        const dialog = event.currentTarget;
        const controls = Array.from(dialog.querySelectorAll<HTMLElement>("button, [href], input, select, textarea, [tabindex]"))
          .filter(element => element.tabIndex >= 0 && !element.matches(":disabled") && !element.closest("[hidden], [inert]") && element.getClientRects().length > 0);
        const first = controls[0];
        const last = controls[controls.length - 1];
        if (!first) { event.preventDefault(); dialog.focus(); return; }
        if (event.shiftKey && (document.activeElement === first || document.activeElement === dialog)) {
          event.preventDefault(); last.focus();
        } else if (!event.shiftKey && (document.activeElement === last || document.activeElement === dialog)) {
          event.preventDefault(); first.focus();
        }
      }}
      onCancel={event => { event.preventDefault(); if (dismissible) onClose(); }}
      onClick={event => {
        if (!dismissible || role === "alertdialog" || event.target !== event.currentTarget) return;
        const bounds = event.currentTarget.getBoundingClientRect();
        if (event.clientX < bounds.left || event.clientX > bounds.right || event.clientY < bounds.top || event.clientY > bounds.bottom) onClose();
      }}>
      <header className="flex items-start justify-between gap-4 mb-4">
        <h2 id={titleId} className="text-lg font-semibold text-ink-100">{title}</h2>
        {role !== "alertdialog" && <button type="button" className="btn-ghost min-h-11 min-w-11" disabled={!dismissible} onClick={onClose} aria-label="关闭对话框">关闭</button>}
      </header>
      {description && <p id={descriptionId} className="text-sm text-ink-300 mb-4">{description}</p>}
      {children}
    </dialog>, document.body,
  );
}

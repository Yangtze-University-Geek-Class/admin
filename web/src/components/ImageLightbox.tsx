import { useEffect, useState } from "react";

type Ctx = { open: (src: string, alt?: string) => void };
let ctx: Ctx | null = null;

export function openLightbox(src: string, alt?: string) {
  ctx?.open(src, alt);
}

export default function ImageLightbox() {
  const [state, setState] = useState<{ src: string; alt?: string } | null>(null);
  useEffect(() => {
    ctx = { open: (src, alt) => setState({ src, alt }) };
    return () => { if (ctx?.open) ctx = null; };
  }, []);
  useEffect(() => {
    if (!state) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") setState(null); };
    document.addEventListener("keydown", onKey);
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = "";
    };
  }, [state]);
  if (!state) return null;
  return (
    <div
      role="dialog"
      onClick={() => setState(null)}
      style={{ position: "fixed", inset: 0, zIndex: 9999, background: "rgba(0,0,0,0.85)", display: "flex", alignItems: "center", justifyContent: "center", cursor: "zoom-out", backdropFilter: "blur(8px)" }}
    >
      <img
        src={state.src}
        alt={state.alt ?? ""}
        onClick={(e) => e.stopPropagation()}
        style={{ maxWidth: "94vw", maxHeight: "92vh", objectFit: "contain", boxShadow: "0 24px 64px rgba(0,0,0,0.6)", borderRadius: 8, cursor: "default" }}
      />
      <button
        onClick={() => setState(null)}
        aria-label="关闭"
        style={{ position: "fixed", top: 20, right: 24, background: "rgba(255,255,255,0.1)", color: "#fff", border: 0, padding: "8px 16px", borderRadius: 8, fontSize: 14, cursor: "pointer", backdropFilter: "blur(8px)" }}
      >关闭 (Esc)</button>
    </div>
  );
}

export function useProseInteractions(rootRef: React.RefObject<HTMLElement | null>, deps: any[] = []) {
  useEffect(() => {
    const root = rootRef.current;
    if (!root) return;

    const onClickImg = (e: Event) => {
      const target = e.target as HTMLElement;
      if (target.tagName === "IMG") {
        e.preventDefault();
        const img = target as HTMLImageElement;
        openLightbox(img.src, img.alt);
      }
    };
    const onClickCopy = async (e: Event) => {
      const t = e.target as HTMLElement;
      if (!t.classList.contains("code-block-copy")) return;
      const block = t.closest(".code-block");
      const code = block?.querySelector("code")?.textContent ?? "";
      try {
        await navigator.clipboard.writeText(code);
        const orig = t.textContent;
        t.textContent = "已复制";
        t.classList.add("copied");
        setTimeout(() => { t.textContent = orig; t.classList.remove("copied"); }, 1400);
      } catch {
        t.textContent = "复制失败";
        setTimeout(() => { t.textContent = "复制"; }, 1400);
      }
    };

    root.addEventListener("click", onClickImg);
    root.addEventListener("click", onClickCopy);
    root.querySelectorAll("img").forEach((img) => { (img as HTMLElement).style.cursor = "zoom-in"; img.setAttribute("loading", "lazy"); });

    return () => {
      root.removeEventListener("click", onClickImg);
      root.removeEventListener("click", onClickCopy);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);
}

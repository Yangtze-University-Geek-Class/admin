import Modal from "./Modal";
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
  if (!state) return null;
  return <Modal title={state.alt || "图片预览"} className="app-lightbox" onClose={() => setState(null)}>
    <img src={state.src} alt={state.alt ?? ""} className="max-w-full max-h-[75dvh] object-contain mx-auto" />
  </Modal>;
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

    const onImageKey = (event: KeyboardEvent) => {
      if ((event.key === "Enter" || event.key === " ") && (event.target as HTMLElement).tagName === "IMG") onClickImg(event);
    };
    root.addEventListener("keydown", onImageKey);
    root.addEventListener("click", onClickImg);
    root.addEventListener("click", onClickCopy);
    root.querySelectorAll("img").forEach((img) => { (img as HTMLElement).style.cursor = "zoom-in"; img.setAttribute("loading", "lazy"); img.tabIndex = 0; img.setAttribute("role", "button"); img.setAttribute("aria-label", img.alt ? `查看图片：${img.alt}` : "查看大图"); });

    return () => {
      root.removeEventListener("keydown", onImageKey);
      root.removeEventListener("click", onClickImg);
      root.removeEventListener("click", onClickCopy);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);
}

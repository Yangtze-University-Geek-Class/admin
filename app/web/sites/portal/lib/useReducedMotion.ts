// 官网页面共用的两个小 hook：减少动态效果偏好、按条件给元素设置 inert（React 18 没有 inert 属性）。
import { useEffect, useRef, useState, type RefObject } from "react";

const QUERY = "(prefers-reduced-motion: reduce)";

export function useReducedMotion(): boolean {
  const [reduced, setReduced] = useState(() => typeof window !== "undefined" && window.matchMedia(QUERY).matches);
  useEffect(() => {
    const query = window.matchMedia(QUERY);
    const onChange = () => setReduced(query.matches);
    query.addEventListener("change", onChange);
    return () => query.removeEventListener("change", onChange);
  }, []);
  return reduced;
}

/** 看不见的层不可聚焦、不可点击：隐藏时设置 inert */
export function useInert<T extends HTMLElement>(inert: boolean): RefObject<T> {
  const ref = useRef<T>(null);
  useEffect(() => {
    if (ref.current) ref.current.inert = inert;
  }, [inert]);
  return ref;
}

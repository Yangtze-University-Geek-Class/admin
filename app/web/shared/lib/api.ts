// Unified fetch wrapper. Dispatches to mock-api.ts in dev/mock mode, otherwise
// performs a same-origin fetch against the backend (Vite proxy in dev).
import { getDataSource } from "./runtime";
import { requestJson } from "./http";
export { ApiError } from "./http";

export async function api<T = unknown>(path: string, init?: RequestInit): Promise<T> {
  if (import.meta.env.DEV && getDataSource() === "mock") {
    const { mockApi } = await import("./mock-api");
    return mockApi<T>(path, init);
  }
  return requestJson<T>(path, init);
}

export const fmtDate = (iso: string | number | null | undefined) => {
  if (!iso) return "—";
  const d = typeof iso === "number" ? new Date(iso) : new Date(iso);
  return d.toLocaleString("zh-CN", { hour12: false });
};

export const fmtRelative = (iso: string | number | null | undefined) => {
  if (!iso) return "—";
  const d = typeof iso === "number" ? new Date(iso) : new Date(iso);
  const diff = Date.now() - d.getTime();
  const s = Math.round(diff / 1000);
  if (s < 60) return `${s} 秒前`;
  const m = Math.round(s / 60);
  if (m < 60) return `${m} 分钟前`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h} 小时前`;
  const day = Math.round(h / 24);
  if (day < 30) return `${day} 天前`;
  return d.toLocaleDateString("zh-CN");
};

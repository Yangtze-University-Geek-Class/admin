// Unified fetch wrapper. Dispatches to mock-api.ts in dev/mock mode, otherwise
// performs a same-origin fetch against the backend (Vite proxy in dev).
import { getDataSource } from "./runtime";
import { mockApi } from "./mock-api";

export async function api<T = any>(path: string, init?: RequestInit): Promise<T> {
  if (getDataSource() === "mock") return mockApi<T>(path, init);

  // 只在有 body 时设 Content-Type: application/json. fastify 默认开启了
  // application/json content-type-parser 严格校验, 空 body + 该 header 会 400
  // FST_ERR_CTP_EMPTY_JSON_BODY (尤其 DELETE / GET 这种没 body 的请求)
  const userHeaders = (init?.headers ?? {}) as Record<string, string>;
  const baseHeaders: Record<string, string> = init?.body
    ? { "Content-Type": "application/json" }
    : {};
  const res = await fetch(path, {
    credentials: "same-origin",
    ...init,
    headers: { ...baseHeaders, ...userHeaders },
  });
  if (!res.ok) {
    const text = await res.text();
    try {
      const body = JSON.parse(text);
      throw new Error(body.error ?? body.message ?? `HTTP ${res.status}`);
    } catch {
      throw new Error(`HTTP ${res.status}: ${text.slice(0, 200)}`);
    }
  }
  if (res.headers.get("content-type")?.includes("application/json")) {
    return res.json();
  }
  return undefined as T;
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

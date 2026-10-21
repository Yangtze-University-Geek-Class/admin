// 运行环境：数据源（仅开发态可切换）与跨服务链接。
// 生产构建里 import.meta.env.DEV 为 false，数据源恒为 live，不读 URL 或本地存储。

export type DataSource = "mock" | "live";

const DATA_KEY = "yugc:console-data-source";

/** 开发态默认真实数据（本机预览走真实 GitHub 登录）；`?__data=mock` 切到样板数据并记在本标签页（自动化测试用）。生产恒为 live。 */
/** PR 预览构建（#245）：构建时设 VITE_PREVIEW_MOCK=1 才为 true，只有 pr-preview.yml 会设；未设置时构建里恒为 false，样板数据代码照旧被删掉。 */
export const PREVIEW_MOCK: boolean = import.meta.env.VITE_PREVIEW_MOCK === "1";

export function dataSource(): DataSource {
  if (PREVIEW_MOCK) return "mock";
  if (!import.meta.env.DEV) return "live";
  if (typeof window === "undefined") return "live";
  const fromQuery = new URLSearchParams(window.location.search).get("__data");
  if (fromQuery === "mock" || fromQuery === "live") {
    try { sessionStorage.setItem(DATA_KEY, fromQuery); } catch { /* 存储不可用时只用本次的查询参数 */ }
    return fromQuery;
  }
  try {
    const stored = sessionStorage.getItem(DATA_KEY);
    if (stored === "mock" || stored === "live") return stored;
  } catch { /* 忽略 */ }
  return "live";
}

export const isMock = () => dataSource() === "mock";

/**
 * 官网与论坛的地址。生产同域：官网在 `/`，论坛在 `/forum/`（见 docs/services/web/README.md）。
 * 开发态控制台单独跑在 5186，官网是 5173 的 /sites/portal/，论坛是 3456。
 */
export function siteUrl(target: "portal" | "forum", path = "/"): string {
  const suffix = path.startsWith("/") ? path : `/${path}`;
  if (import.meta.env.DEV) return target === "forum" ? `http://127.0.0.1:3456${suffix}` : `http://127.0.0.1:5173/sites/portal${suffix}`;
  return target === "forum" ? `/forum${suffix}` : suffix;
}

/**
 * 极客班统一登录页（#262）：`returnTo` 可以是本站完整地址或路径，统一转成同源路径交给 `/signin?return_to=`；
 * 不再直接拼 `/auth/github`，登录方式由登录页按 `GET /auth/providers` 列出。
 */
export function signInHref(returnTo: string): string {
  let path = "/console";
  try {
    const url = new URL(returnTo, window.location.origin);
    if (url.origin === window.location.origin) path = `${url.pathname}${url.search}${url.hash}`;
  } catch { /* 解析不了就回控制台首页 */ }
  return `/signin?return_to=${encodeURIComponent(path)}`;
}

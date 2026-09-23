// 运行环境：数据源（仅开发态可切换）与跨服务链接。
// 生产构建里 import.meta.env.DEV 为 false，数据源恒为 live，不读 URL 或本地存储。

export type DataSource = "mock" | "live";

const DATA_KEY = "yugc:console-data-source";

/** 开发态默认样板数据；`?__data=live|mock` 切换并记在本标签页。生产恒为 live。 */
export function dataSource(): DataSource {
  if (!import.meta.env.DEV) return "live";
  if (typeof window === "undefined") return "mock";
  const fromQuery = new URLSearchParams(window.location.search).get("__data");
  if (fromQuery === "mock" || fromQuery === "live") {
    try { sessionStorage.setItem(DATA_KEY, fromQuery); } catch { /* 存储不可用时只用本次的查询参数 */ }
    return fromQuery;
  }
  try {
    const stored = sessionStorage.getItem(DATA_KEY);
    if (stored === "mock" || stored === "live") return stored;
  } catch { /* 忽略 */ }
  return "mock";
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

/** GitHub 登录入口：登录后回到 `returnTo`（服务端只接受本站地址）。 */
export function signInHref(returnTo: string): string {
  return `/auth/github?return_to=${encodeURIComponent(returnTo)}`;
}

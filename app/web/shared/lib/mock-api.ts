import { ApiError } from "./http";
// Development-only local fixtures. api() routes to this module when the data
// source is "mock" so the portal can be browsed without a backend.
// Never used in production builds (production forces "live").
// 控制台的样板数据在 app/console/src/mock（控制台是独立的 Vue 包）。

const now = Date.now();
const demoOrg = "Yangtze-University-Geek-Class";

function route(path: string): unknown {
  const url = new URL(path, "http://mock.local");
  const pathname = url.pathname;

  if (pathname === "/api/docs") return { items: [{ id: "usage", label: "使用指南", lang: "zh" }, { id: "usage-en", label: "Usage", lang: "en" }] };
  if (pathname.startsWith("/api/docs/")) return { id: pathname.split("/").pop(), label: "使用指南", lang: pathname.endsWith("-en") ? "en" : "zh", file: "docs/ops/USAGE.md", content: "# 开发预览\n\n当前使用本地 mock 数据。" };
  if (pathname === "/api/feedback/categories") return { categories: ["建议", "Bug", "新功能", "其他"], pow_difficulty: 1 };
  if (pathname === "/api/public/config") return { turnstile_site_key: null, pow_difficulty: 1 };
  if (pathname === "/api/feedback/public") return { items: [] };
  if (pathname.startsWith("/api/join/")) return { valid: true, org: demoOrg, note: "开发预览邀请", expires_at: now + 864e5, remaining_uses: 23, pow_difficulty: 1 };

  throw new ApiError(404, "mock_route_missing", `开发预览未实现此接口：${pathname}`);
}

export async function mockApi<T>(path: string, init?: RequestInit): Promise<T> {
  if ((init?.method ?? "GET").toUpperCase() !== "GET") throw new ApiError(501, "mock_read_only", "开发预览为只读，操作验证请使用隔离测试或本地真实数据源");
  await new Promise((resolve) => setTimeout(resolve, 90));
  return structuredClone(route(path)) as T;
}

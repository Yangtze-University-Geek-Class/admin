import { ApiError } from "./http";
// Development-only local fixtures. api() routes to this module when the data
// source is "mock" so the portal can be browsed without a backend.
// Never used in production builds (production forces "live").
// 控制台的样板数据在 app/console/src/mock（控制台是独立的 Vue 包）。

const now = Date.now();
const HOUR = 3600_000;
const DAY = 24 * HOUR;
const beijingDayEnd = (at: number) => Math.floor((at + 8 * HOUR) / DAY) * DAY + DAY - 8 * HOUR - 1;

/** 比赛样板只写起止时间：状态由界面按同一套口径（`statusAt`）现算，这里不写死。 */
const demoCompetitions = () => [
  { id: "c1001", name: "极客班算法挑战赛", kind: "internal", start_at: now + 6 * DAY, end_at: now + 6 * DAY + 6 * HOUR, signup_deadline: beijingDayEnd(now + 4 * DAY), url: null, description: "班内选拔，前五名代表学院参加校赛。" },
  { id: "c1002", name: "蓝桥杯省赛", kind: "external", start_at: now + 20 * DAY, end_at: now + 20 * DAY + 4 * HOUR, signup_deadline: beijingDayEnd(now + 12 * DAY), url: "https://dasai.lanqiao.cn/", description: "以学校为单位报名，官网自行注册后统一组织。" },
  { id: "c1003", name: "上一期内测赛", kind: "internal", start_at: now - 9 * DAY, end_at: now - 8 * DAY, signup_deadline: null, url: null, description: "热身用的小比赛，不计成绩。" },
];
const demoOrg = "Yangtze-University-Geek-Class";

function route(path: string): unknown {
  const url = new URL(path, "http://mock.local");
  const pathname = url.pathname;

  if (pathname === "/api/docs") return { items: [{ id: "usage", label: "使用指南", lang: "zh" }, { id: "usage-en", label: "Usage", lang: "en" }] };
  if (pathname.startsWith("/api/docs/")) return { id: pathname.split("/").pop(), label: "使用指南", lang: pathname.endsWith("-en") ? "en" : "zh", file: "docs/ops/USAGE.md", content: "# 开发预览\n\n当前使用本地 mock 数据。" };
  if (pathname === "/api/feedback/categories") return { categories: ["建议", "Bug", "新功能", "其他"], pow_difficulty: 1, org: demoOrg };
  if (pathname === "/api/public/config") return { turnstile_site_key: null, pow_difficulty: 1 };
  if (pathname === "/api/feedback/public") return { items: [] };
  if (pathname === "/api/public/competitions") return { competitions: demoCompetitions() };
  if (pathname.startsWith("/api/join/")) return { valid: true, org: demoOrg, note: "开发预览邀请", expires_at: now + 864e5, remaining_uses: 23, pow_difficulty: 1 };

  throw new ApiError(404, "mock_route_missing", `开发预览未实现此接口：${pathname}`);
}

export async function mockApi<T>(path: string, init?: RequestInit): Promise<T> {
  if ((init?.method ?? "GET").toUpperCase() !== "GET") throw new ApiError(501, "mock_read_only", "开发预览为只读，操作验证请使用隔离测试或本地真实数据源");
  await new Promise((resolve) => setTimeout(resolve, 90));
  return structuredClone(route(path)) as T;
}

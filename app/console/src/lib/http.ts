// 控制台的 HTTP 层：同源 fetch + 与 app/web/shared/lib/http.ts 相同的错误形状。
// 控制台不能导入 app/web 的实现（见 scripts/check-boundaries.mjs），所以这里按同一契约另写一份。
import { dataSource } from "./runtime";

export class ApiError extends Error {
  constructor(
    public status: number,
    public code: string,
    message: string,
    public requestId?: string,
    public payload?: Record<string, unknown>,
  ) {
    super(message);
    this.name = "ApiError";
  }
}

export async function requestJson<T>(path: string, init?: RequestInit): Promise<T> {
  const headers = new Headers(init?.headers);
  if (typeof init?.body === "string" && !headers.has("Content-Type")) headers.set("Content-Type", "application/json");
  const response = await fetch(path, { credentials: "same-origin", ...init, headers });
  if (response.status === 204) return undefined as T;
  const isJson = response.headers.get("content-type")?.includes("application/json");
  let payload: unknown;
  try { payload = isJson ? await response.json() : await response.text(); }
  catch { throw new ApiError(response.status, "invalid_response", "服务器返回的内容无法解析"); }
  if (!response.ok) {
    const data = payload && typeof payload === "object" ? payload as Record<string, unknown> : {};
    const code = typeof data.error === "string" ? data.error : "request_failed";
    const message = typeof data.message === "string" ? data.message : typeof data.error === "string" ? data.error : `请求失败（HTTP ${response.status}）`;
    throw new ApiError(response.status, code, message, typeof data.request_id === "string" ? data.request_id : undefined, data);
  }
  return payload as T;
}

/** 所有接口调用的入口。开发态选了样板数据时走本地 mock；生产构建里这段分支连同 mock 模块一起被删掉。 */
export async function api<T = unknown>(path: string, init?: RequestInit): Promise<T> {
  if (import.meta.env.DEV && dataSource() === "mock") {
    const { mockApi } = await import("../mock");
    return mockApi<T>(path, init);
  }
  return requestJson<T>(path, init);
}

export const jsonBody = (body: unknown): RequestInit => ({ body: JSON.stringify(body) });

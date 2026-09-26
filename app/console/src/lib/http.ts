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

/**
 * 登录态失效（任何接口返回 401）时要做的事。由 session.ts 注册：清掉本地身份，ConsoleRoot 看到 401 就带着当前地址跳 /signin。
 * 这里只留一个钩子，http 层不依赖会话状态（#133）。
 */
let signedOutHandler: ((error: ApiError) => void) | null = null;
export function onSignedOut(handler: ((error: ApiError) => void) | null): void {
  signedOutHandler = handler;
}

/** 所有接口调用的入口。开发态选了样板数据时走本地 mock；生产构建里这段分支连同 mock 模块一起被删掉。 */
export async function api<T = unknown>(path: string, init?: RequestInit): Promise<T> {
  try {
    if (import.meta.env.DEV && dataSource() === "mock") {
      const { mockApi } = await import("../mock");
      return await mockApi<T>(path, init);
    }
    return await requestJson<T>(path, init);
  } catch (error) {
    // 用到一半会话过期：之后每个请求都是 401，只给「重试」会一直失败，统一当作已退出。
    // 退出登录的请求自己会清身份并跳转，不重复处理。
    if (error instanceof ApiError && error.status === 401 && path !== "/auth/signout") signedOutHandler?.(error);
    throw error;
  }
}

export const jsonBody = (body: unknown): RequestInit => ({ body: JSON.stringify(body) });

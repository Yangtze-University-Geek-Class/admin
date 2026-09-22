export class ApiError extends Error {
  constructor(public status: number, public code: string, message: string, public requestId?: string) {
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
  catch { throw new ApiError(response.status, "invalid_response", "服务器响应无法解析"); }
  if (!response.ok) {
    const data = payload && typeof payload === "object" ? payload as Record<string, unknown> : {};
    const code = typeof data.error === "string" ? data.error : "request_failed";
    const message = typeof data.message === "string" ? data.message : typeof data.error === "string" ? data.error : `请求失败（HTTP ${response.status}）`;
    throw new ApiError(response.status, code, message, typeof data.request_id === "string" ? data.request_id : undefined);
  }
  return payload as T;
}

// 开发预览的接口入口：只读，写请求一律 501 mock_read_only，不伪造写成功（与 docs/architecture/API.md 的约定一致）；
// 只有改称号的请求会先按服务端规则核对，不合法的照服务端返回 403/400。
import { ApiError } from "../lib/http";
import { checkConsoleWrite, routeConsole } from "./console";
import { routeGithub } from "./github";

export async function mockApi<T>(path: string, init?: RequestInit): Promise<T> {
  await new Promise(resolve => setTimeout(resolve, 120));
  const url = new URL(path, "http://mock.local");
  if (url.pathname === "/auth/signout") return { ok: true } as T;
  const method = (init?.method ?? "GET").toUpperCase();
  if (method !== "GET") {
    if (url.pathname.startsWith("/api/console/")) checkConsoleWrite(url, method, parseBody(init?.body));
    throw new ApiError(501, "mock_read_only", "开发预览是只读的", undefined, { error: "mock_read_only" });
  }
  const result = url.pathname.startsWith("/api/console/") ? routeConsole(url) : routeGithub(url);
  if (result === undefined) throw new ApiError(404, "mock_route_missing", `开发预览没有这个接口：${url.pathname}`);
  return structuredClone(result) as T;
}

function parseBody(body: RequestInit["body"]): unknown {
  if (typeof body !== "string") return undefined;
  try { return JSON.parse(body); } catch { return undefined; }
}

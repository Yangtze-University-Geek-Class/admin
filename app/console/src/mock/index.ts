// 开发预览的接口入口：只读，写请求一律 501 mock_read_only，不伪造写成功（与 docs/architecture/API.md 的约定一致）；
// 只有改称号的请求会先按服务端规则核对，不合法的照服务端返回 403/400。
import { ApiError } from "../lib/http";
import { checkConsoleWrite, mockPersona, routeConsole } from "./console";
import { routeGithub } from "./github";

export async function mockApi<T>(path: string, init?: RequestInit): Promise<T> {
  await new Promise(resolve => setTimeout(resolve, 120));
  const url = new URL(path, "http://mock.local");
  if (url.pathname === "/auth/signout") return { ok: true } as T;
  // 与服务端 GET /auth/providers 同形（app/server/src/routes/identity/providers.ts）：登录页按它渲染登录方式
  if (url.pathname === "/auth/providers") {
    return { providers: [{ id: "github", name: "GitHub", kind: "redirect", start: "/auth/github", can_register: true }] } as T;
  }
  // 与服务端 GET /auth/me 同形（只取设备授权页用到的字段）：未登录样板回 signed_in: false，不是 401
  if (url.pathname === "/auth/me") {
    const persona = mockPersona();
    return (persona ? { signed_in: true, login: persona.login, avatar_url: null, account_id: `mock-${persona.login}` } : { signed_in: false }) as T;
  }
  const method = (init?.method ?? "GET").toUpperCase();
  // 与服务端 GET /api/identity/device 同形（app/server/src/routes/identity/device.ts）：设备授权确认页的样板，
  // 任何完整的用户码都当作十分钟内有效的待确认授权；允许/拒绝是写请求，仍按只读回 501。
  if (method === "GET" && url.pathname === "/api/identity/device") {
    const userCode = (url.searchParams.get("user_code") ?? "").toUpperCase();
    if (!/^[A-Z]{4}-[A-Z]{4}$/.test(userCode)) throw new ApiError(404, "device_code_not_found", "没有这个用户码", undefined, { error: "device_code_not_found" });
    return { user_code: userCode, client_id: "geek-cli", client_name: "极客班命令行", scope: "openid profile", status: "pending", expires_at: Date.now() + 10 * 60 * 1000 } as T;
  }
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

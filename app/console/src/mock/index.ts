// 开发预览的接口入口：只读，写请求一律 501 mock_read_only，不伪造写成功（与 docs/architecture/API.md 的约定一致）；
// 控制台的写请求先按服务端规则核对权限、step-up 和几种业务错误（mock/console.ts 的 checkConsoleWrite），不合法的照服务端返回 401/403/400/409。
import { ApiError } from "../lib/http";
import { checkConsoleWrite, mockAccount, mockPersona, routeConsole, routeLetterPreview, routeMailPreview } from "./console";

export async function mockApi<T>(path: string, init?: RequestInit): Promise<T> {
  await new Promise(resolve => setTimeout(resolve, 120));
  const url = new URL(path, "http://mock.local");
  if (url.pathname === "/auth/signout") return { ok: true } as T;
  // 与服务端 GET /auth/providers 同形（app/server/src/routes/identity/providers.ts）：登录页按它渲染登录方式
  if (url.pathname === "/auth/providers") {
    return {
      providers: [
        { id: "github", name: "GitHub", kind: "redirect", start: "/auth/github", can_register: true },
        { id: "google", name: "Google", kind: "redirect", start: "/auth/google", can_register: true },
        { id: "email", name: "邮箱", kind: "email_code", start: "/auth/email/start", can_register: true, password: "/auth/email/password" },
      ],
    } as T;
  }
  // 与服务端 GET /auth/me 同形（只取设备授权页用到的字段）：未登录样板回 signed_in: false，不是 401
  if (url.pathname === "/auth/me") {
    const persona = mockPersona();
    return (persona
      ? { signed_in: true, login: persona.username, avatar_url: null, account_id: `mock-${persona.username}`, email_required: persona.email_required, profile_required: persona.profile_required }
      : { signed_in: false }) as T;
  }
  const method = (init?.method ?? "GET").toUpperCase();
  // 与服务端 GET /api/identity/device 同形（app/server/src/routes/identity/device.ts）：设备授权确认页的样板，
  // 任何完整的用户码都当作十分钟内有效的待确认授权；允许/拒绝是写请求，仍按只读回 501。
  if (method === "GET" && url.pathname === "/api/identity/device") {
    const userCode = (url.searchParams.get("user_code") ?? "").toUpperCase();
    if (!/^[A-Z]{4}-[A-Z]{4}$/.test(userCode)) throw new ApiError(404, "device_code_not_found", "没有这个用户码", undefined, { error: "device_code_not_found" });
    return { user_code: userCode, client_id: "geek-cli", client_name: "极客班命令行", scope: "openid profile", status: "pending", expires_at: Date.now() + 10 * 60 * 1000 } as T;
  }
  // 与服务端 GET /oidc/interaction/:uid/details 同形（app/server/src/routes/oidc/index.ts）：对外授权同意页的样板，
  // 任何格式正确的交互编号都当作 GitLab 十分钟内有效的登录请求；允许/拒绝是写请求，仍按只读回 501。
  // 还没有登录邮箱、还没填姓名和年级的样板照服务端回 403 email_required（#273）、profile_required（#280）。
  const interaction = method === "GET" ? /^\/oidc\/interaction\/([A-Za-z0-9_-]{10,64})\/details$/.exec(url.pathname) : null;
  if (interaction) {
    const persona = mockPersona();
    if (!persona) throw new ApiError(401, "not_signed_in", "请先登录", undefined, { error: "not_signed_in" });
    if (persona.email_required) throw new ApiError(403, "email_required", "先绑定邮箱，再用极客班账号登录这个应用", undefined, { error: "email_required" });
    if (persona.profile_required) throw new ApiError(403, "profile_required", "先填好姓名和年级，再用极客班账号登录这个应用", undefined, { error: "profile_required" });
    return {
      client: { id: "gitlab", name: "GitLab", host: "example.test" }, scopes: ["openid", "profile", "email"],
      account: { login: persona.username, name: persona.display_name, picture: null }, expires_at: Date.now() + 10 * 60 * 1000,
    } as T;
  }
  // 与服务端 GET /api/identity/me 同形（app/server/src/routes/identity/account.ts）：账号页的样板；绑定或删除邮箱、设密码是写请求，按只读回 501
  if (method === "GET" && url.pathname === "/api/identity/me") {
    const persona = mockPersona();
    if (!persona) throw new ApiError(401, "not_signed_in", "请先登录", undefined, { error: "not_signed_in" });
    return mockAccount(persona) as T;
  }
  // 招聘邮件的预览（#285）：POST 但不是写操作，不发信、不改任何记录，开发预览里照样渲染
  if (method === "POST" && url.pathname === "/api/console/mail-templates/preview") return structuredClone(routeMailPreview(parseBody(init?.body))) as T;
  const letterPreview = method === "POST" ? /^\/api\/console\/applications\/([0-9a-f-]{36})\/letter-preview$/.exec(url.pathname) : null;
  if (letterPreview) return structuredClone(routeLetterPreview(letterPreview[1], parseBody(init?.body))) as T;
  if (method !== "GET") {
    if (url.pathname.startsWith("/api/console/")) checkConsoleWrite(url, method, parseBody(init?.body));
    throw new ApiError(501, "mock_read_only", "开发预览是只读的", undefined, { error: "mock_read_only" });
  }
  const result = routeConsole(url);
  if (result === undefined) throw new ApiError(404, "mock_route_missing", `开发预览没有这个接口：${url.pathname}`);
  return structuredClone(result) as T;
}

function parseBody(body: RequestInit["body"]): unknown {
  if (typeof body !== "string") return undefined;
  try { return JSON.parse(body); } catch { return undefined; }
}

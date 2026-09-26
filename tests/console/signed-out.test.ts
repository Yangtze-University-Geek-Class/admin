// 控制台用到一半登录失效（#133）：任何接口拿到 401 都要当成「已退出」，清掉本地身份，
// 让 ConsoleRoot 按首次加载那条路跳 /signin?return_to=；403、5xx、网络错误不算退出。
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ApiError, api } from "../../app/console/src/lib/http";
import { clearSession, loadMe, useSession } from "../../app/console/src/lib/session";

const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
const ME = { login: "xu", avatar_url: null, org: "Org", titles: [], title: "admin", capabilities: ["feedback.read"], blocked: [], github_role: "admin" };

/** 先让 /api/console/me 登录成功，之后的请求按 `next` 返回 */
function server(next: () => Response) {
  vi.stubGlobal("fetch", vi.fn(async (path: string) => (String(path).endsWith("/api/console/me") ? json(200, ME) : next())));
}

beforeEach(() => clearSession());
afterEach(() => {
  vi.unstubAllGlobals();
  clearSession();
});

describe("接口拿到 401 时登录态失效", () => {
  it("清掉当前身份，把 401 交给 meError：ConsoleRoot 据此跳 /signin", async () => {
    server(() => json(401, { error: "not_signed_in", message: "请先登录" }));
    await loadMe();
    const { me, meError } = useSession();
    expect(me.value?.login).toBe("xu");

    await expect(api("/api/console/feedback")).rejects.toMatchObject({ status: 401 });
    expect(me.value).toBeNull();
    expect(meError.value).toBeInstanceOf(ApiError);
    expect((meError.value as ApiError).status).toBe(401);
  });

  it("写请求拿到 401 同样算退出", async () => {
    server(() => json(401, { error: "not_signed_in" }));
    await loadMe();
    await expect(api("/api/console/feedback/1", { method: "PATCH", body: "{}" })).rejects.toMatchObject({ status: 401 });
    expect(useSession().me.value).toBeNull();
  });

  it("403、500 与网络错误不算退出：身份保留，页面照常显示错误和重试", async () => {
    for (const make of [() => json(403, { error: "missing_capability" }), () => json(500, { error: "internal_error" })]) {
      server(make);
      await loadMe(true);
      await expect(api("/api/console/feedback")).rejects.toBeInstanceOf(ApiError);
      expect(useSession().me.value?.login).toBe("xu");
      expect(useSession().meError.value).toBeNull();
    }
    server(() => { throw new TypeError("Failed to fetch"); });
    await loadMe(true);
    await expect(api("/api/console/feedback")).rejects.toBeInstanceOf(TypeError);
    expect(useSession().me.value?.login).toBe("xu");
  });

  it("退出登录的请求本身拿到 401 不重复处理（退出流程自己会清身份并跳转）", async () => {
    server(() => json(401, { error: "not_signed_in" }));
    await loadMe();
    await expect(api("/auth/signout", { method: "POST" })).rejects.toMatchObject({ status: 401 });
    expect(useSession().meError.value).toBeNull();
  });
});

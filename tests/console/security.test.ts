import { afterEach, describe, expect, it, vi } from "vitest";
import { mockApi } from "../../app/console/src/mock";
import { routeConsole } from "../../app/console/src/mock/console";

const as = (persona: string) => vi.stubGlobal("window", { location: { search: `?__persona=${persona}` } });

afterEach(() => vi.unstubAllGlobals());

describe("开发预览的安全防护接口", () => {
  it("站长能读取策略和白名单样板", () => {
    as("owner");
    expect(routeConsole(new URL("http://mock.local/api/console/security/policy"))).toMatchObject({
      strict_mode: false,
      strict_threshold: 20,
      strict_window_seconds: 15,
      version: 0,
      shield_enabled: false,
      allowlist_count: 0,
    });
    expect(routeConsole(new URL("http://mock.local/api/console/security/allowlist"))).toEqual({ items: [] });
  });

  it("安全写接口先核对 step-up，合法请求仍保持只读", async () => {
    as("owner_stale");
    await expect(mockApi("/api/console/security/policy", {
      method: "PUT",
      body: JSON.stringify({ strict_mode: true, strict_threshold: 20, strict_window_seconds: 15, version: 0 }),
    })).rejects.toMatchObject({ status: 403, code: "step_up_required" });

    as("owner");
    await expect(mockApi("/api/console/security/policy", {
      method: "PUT",
      body: JSON.stringify({ strict_mode: true, strict_threshold: 20, strict_window_seconds: 15, version: 0 }),
    })).rejects.toMatchObject({ status: 501, code: "mock_read_only" });
    await expect(mockApi("/api/console/security/allowlist", {
      method: "POST",
      body: JSON.stringify({ cidr: "203.0.113.8/32", note: "维护出口", version: 0 }),
    })).rejects.toMatchObject({ status: 501, code: "mock_read_only" });
    await expect(mockApi("/api/console/security/allowlist/1", {
      method: "DELETE",
      body: JSON.stringify({ confirm: true, version: 0 }),
    })).rejects.toMatchObject({ status: 501, code: "mock_read_only" });
  });
});

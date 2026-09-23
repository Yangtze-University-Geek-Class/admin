import { afterEach, describe, expect, it, vi } from "vitest";
import { ApiError, requestJson } from "../../app/console/src/lib/http";
import { describeError, errorTrace } from "../../app/console/src/lib/errors";

afterEach(() => vi.unstubAllGlobals());

const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

describe("requestJson", () => {
  it("sends same-origin credentials and a JSON content type for string bodies", async () => {
    const fetch = vi.fn().mockResolvedValue(json(200, { ok: true }));
    vi.stubGlobal("fetch", fetch);
    await expect(requestJson("/api/x", { method: "POST", body: "{}" })).resolves.toEqual({ ok: true });
    const init = fetch.mock.calls[0][1] as RequestInit;
    expect(init.credentials).toBe("same-origin");
    expect((init.headers as Headers).get("Content-Type")).toBe("application/json");
  });

  it("keeps the server's error shape: status, code, message, request id and payload", async () => {
    const body = { error: "missing_capability", capability: "audit.read", any_of: ["audit.read"], message: "需要「查看审计日志」权限", request_id: "req-1" };
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(json(403, body)));
    await expect(requestJson("/api/console/audit")).rejects.toMatchObject({
      name: "ApiError", status: 403, code: "missing_capability", message: "需要「查看审计日志」权限", requestId: "req-1", payload: body,
    });
  });

  it("falls back to a readable message when the body is not JSON", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response("Bad Gateway", { status: 502 })));
    await expect(requestJson("/api/x")).rejects.toMatchObject({ status: 502, code: "request_failed", message: "请求失败（HTTP 502）" });
  });

  it("returns undefined for 204", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(null, { status: 204 })));
    await expect(requestJson("/api/x", { method: "DELETE" })).resolves.toBeUndefined();
  });
});

describe("describeError", () => {
  const labels: Record<string, string> = { "audit.read": "查看审计日志", "github.invites.manage": "管理邀请" };
  const labelOf = (id: string) => labels[id] ?? id;

  it("names the missing capability", () => {
    const error = new ApiError(403, "missing_capability", "x", undefined, { capability: "audit.read" });
    const view = describeError(error, labelOf);
    expect(view.kind).toBe("forbidden");
    expect(view.title).toBe("没有「查看审计日志」权限");
    expect(view.detail).toContain("班长");
  });

  it("says when the GitHub organisation role is what blocks the capability", () => {
    const error = new ApiError(403, "missing_capability", "x", undefined, { capability: "github.invites.manage", reason: "github_admin_required" });
    const view = describeError(error, labelOf);
    expect(view.reason).toBe("github_admin_required");
    expect(view.detail).toContain("GitHub 组织管理员");
  });

  it("maps sign-out, not found, read-only preview, rate limit and server errors", () => {
    expect(describeError(new ApiError(401, "not_signed_in", "x")).kind).toBe("signed_out");
    expect(describeError(new ApiError(404, "not_found", "x")).kind).toBe("not_found");
    expect(describeError(new ApiError(501, "mock_read_only", "x")).kind).toBe("read_only");
    expect(describeError(new ApiError(429, "rate_limited", "x")).kind).toBe("rate_limited");
    expect(describeError(new ApiError(500, "internal_error", "x")).kind).toBe("server");
  });

  it("keeps a validation message from the server", () => {
    expect(describeError(new ApiError(400, "department_required", "请选择部门")).detail).toBe("请选择部门");
  });

  it("treats anything that is not an ApiError as a network failure", () => {
    expect(describeError(new TypeError("Failed to fetch"))).toMatchObject({ kind: "network", status: null });
  });

  it("prints a one-line trace with status, code, capability and request id", () => {
    const view = describeError(new ApiError(403, "missing_capability", "x", "req-9", { capability: "audit.read" }), labelOf);
    expect(errorTrace(view)).toBe("HTTP 403 · missing_capability · audit.read · request req-9");
  });
});

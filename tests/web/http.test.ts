// @vitest-environment jsdom
import { afterEach, expect, it, vi } from "vitest";
import { ApiError, requestJson } from "../../web/shared/lib/http";
import { mockApi } from "../../web/shared/lib/mock-api";

afterEach(() => vi.unstubAllGlobals());
it("preserves a structured user error instead of catching its own exception", async () => {
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(JSON.stringify({ error: "invalid_category", message: "分类无效", request_id: "test-1" }), { status: 400, headers: { "content-type": "application/json" } })));
  await expect(requestJson("/test")).rejects.toMatchObject({ name: "ApiError", status: 400, code: "invalid_category", message: "分类无效", requestId: "test-1" });
});
it("does not force JSON onto FormData and preserves Headers instances", async () => {
  const fetch = vi.fn().mockResolvedValue(new Response(null, { status: 204 }));
  vi.stubGlobal("fetch", fetch);
  await expect(requestJson("/test", { method: "POST", body: new FormData(), headers: new Headers({ "X-Test": "yes" }) })).resolves.toBeUndefined();
  const headers = fetch.mock.calls[0][1].headers as Headers;
  expect(headers.get("X-Test")).toBe("yes");
  expect(headers.has("Content-Type")).toBe(false);
});
it("documents mock response shape and rejects unknown reads or every write", async () => {
  const data = await mockApi<{ items: { id: string; label: string; lang: string }[] }>("/api/docs");
  expect(data.items).toEqual(expect.arrayContaining([expect.objectContaining({ label: "使用指南", lang: "zh" })]));
  await expect(mockApi("/api/not-implemented")).rejects.toBeInstanceOf(ApiError);
  await expect(mockApi("/api/forum/upload", { method: "POST", body: new FormData() })).rejects.toMatchObject({ status: 501, code: "mock_read_only" });
});

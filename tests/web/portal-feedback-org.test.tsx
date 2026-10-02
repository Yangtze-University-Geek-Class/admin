// @vitest-environment jsdom
// 意见箱只发本部署的组织（#129）：组织框只读展示服务端下发的组织名（接口没给时用站点配置里的），提交体里的 org 就是它。
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";

// 外壳用 react-router 的 Link，而 tests/ 解析不到 react-router-dom（只有 app/web 装了）；与本用例无关，换成直接渲染内容。
vi.mock("../../app/web/sites/portal/components/PageShell", () => ({
  default: ({ children }: { children: ReactNode }) => children,
  WindowCard: ({ children }: { children: ReactNode }) => children,
}));

import Feedback from "../../app/web/sites/portal/pages/Feedback";

const ORG = "Yangtze-University-Geek-Class";
let posted: { org?: string; content?: string; pow?: unknown } | null = null;
/** `GET /api/feedback/categories` 下发的 org；undefined 表示接口不带这个字段（旧服务端），页面用站点配置顶上。 */
let servedOrg: string | undefined;
let publicQueries: string[] = [];

const json = (body: unknown) => new Response(JSON.stringify(body), { status: 200, headers: { "content-type": "application/json" } });

// 开发态默认走只读样板数据；切到真实数据源，让页面真的去请求接口（请求由 fetch 桩接住）。
beforeEach(() => {
  localStorage.setItem("yugc:dev-data-source", "live");
  posted = null;
  servedOrg = undefined;
  publicQueries = [];
  vi.stubGlobal("fetch", vi.fn((url: string, init?: RequestInit) => {
    if (url.startsWith("/api/feedback/categories")) return Promise.resolve(json({ categories: ["建议", "Bug"], pow_difficulty: 0, ...(servedOrg && { org: servedOrg }) }));
    if (url === "/api/public/config") return Promise.resolve(json({ turnstile_site_key: null, pow_difficulty: 0 }));
    if (url.startsWith("/api/feedback/public")) {
      publicQueries.push(new URL(url, "http://portal.test").searchParams.get("org") ?? "");
      return Promise.resolve(json({ items: [] }));
    }
    if (url === "/api/feedback" && init?.method === "POST") {
      posted = JSON.parse(String(init.body)) as { org?: string; content?: string; pow?: unknown };
      return Promise.resolve(json({ ok: true, id: 1, message: "意见已收到" }));
    }
    return Promise.resolve(new Response("not found", { status: 404 }));
  }));
});
afterEach(() => {
  localStorage.clear();
  vi.unstubAllGlobals();
});

const orgField = () => screen.getByLabelText("发往的 GitHub 组织") as HTMLInputElement;

it("组织框只读展示本站组织", async () => {
  render(<Feedback />);
  await waitFor(() => expect(orgField().value).toBe(ORG));
  expect(orgField().readOnly).toBe(true);
});

it("提交体里的组织是本站组织，页面没有可改的入口", async () => {
  render(<Feedback />);
  // 表单里只有组织框指向本站组织；联系方式等其它输入框都不影响它。
  expect(screen.getAllByRole("textbox")).toHaveLength(3);
  expect(orgField().value).toBe(ORG);

  fireEvent.change(screen.getByLabelText("想说什么"), { target: { value: "这是一条测试意见" } });
  fireEvent.click(screen.getByRole("button", { name: /提交意见/ }));

  await waitFor(() => expect(posted?.org).toBe(ORG));
  expect(posted?.content).toBe("这是一条测试意见");
  expect(posted?.pow).toMatchObject({ nonce: expect.any(String) });
});

it("服务端下发的组织名与站点配置不同时，页面照服务端的展示、读列表和提交", async () => {
  servedOrg = "Some-Other-Org";
  render(<Feedback />);
  await waitFor(() => expect(orgField().value).toBe("Some-Other-Org"));
  await waitFor(() => expect(publicQueries.at(-1)).toBe("Some-Other-Org"));
  expect(screen.getByText("Some-Other-Org 还没有公开的意见。")).toBeTruthy();

  fireEvent.change(screen.getByLabelText("想说什么"), { target: { value: "这是一条测试意见" } });
  fireEvent.click(screen.getByRole("button", { name: /提交意见/ }));
  await waitFor(() => expect(posted?.org).toBe("Some-Other-Org"));
});

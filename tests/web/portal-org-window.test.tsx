// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import { OrgChart } from "../../app/web/sites/portal/components/os/Windows";
import { ORG_DEFAULTS, ORG_URL } from "../../app/web/sites/portal/lib/org";

// 开发态默认走只读样板数据；这里切到真实数据源，让窗口真的去请求 /api/public/org（请求由 fetch 桩接住）。
beforeEach(() => localStorage.setItem("yugc:dev-data-source", "live"));
afterEach(() => {
  localStorage.clear();
  vi.unstubAllGlobals();
});

const json = (body: unknown) => new Response(JSON.stringify(body), { status: 200, headers: { "content-type": "application/json" } });

it("数据到之前显示默认值，到了之后显示提督改过的名字和部门", async () => {
  const payload = structuredClone(ORG_DEFAULTS);
  payload.titles.find((item) => item.id === "captain")!.label = "大副";
  payload.departments = [{ id: "design", name: "设计部", tag: "DESIGN", icon: "idea", tone: "rose", description: "负责视觉和海报" }];
  let resolve: (response: Response) => void = () => {};
  const fetchMock = vi.fn(() => new Promise<Response>((done) => (resolve = done)));
  vi.stubGlobal("fetch", fetchMock);

  render(<OrgChart />);
  expect(screen.getByText("舰长")).toBeTruthy();
  expect(screen.getByText("招新部")).toBeTruthy();
  expect(fetchMock).toHaveBeenCalledWith(ORG_URL, expect.objectContaining({ signal: expect.any(AbortSignal) }));

  resolve(json(payload));
  await waitFor(() => expect(screen.getByText("大副")).toBeTruthy());
  expect(screen.queryByText("舰长")).toBeNull();
  expect(screen.getByText("设计部")).toBeTruthy();
  expect(screen.queryByText("招新部")).toBeNull();
  expect(screen.getByText("负责视觉和海报")).toBeTruthy();
});

it("读不到时继续显示默认值，不出错误提示", async () => {
  const fetchMock = vi.fn(() => Promise.resolve(new Response("down", { status: 502 })));
  vi.stubGlobal("fetch", fetchMock);
  render(<OrgChart />);
  await waitFor(() => expect(fetchMock).toHaveBeenCalled());
  await new Promise((done) => setTimeout(done, 0));
  for (const text of ["提督", "舰长", "招新部", "项目部", "舰员", "领航员", "乘客"]) expect(screen.getByText(text)).toBeTruthy();
});

it("窗口关掉就取消请求", () => {
  let signal: AbortSignal | undefined;
  vi.stubGlobal("fetch", vi.fn((_url: string, init?: RequestInit) => {
    signal = init?.signal ?? undefined;
    return new Promise<Response>(() => {});
  }));
  const view = render(<OrgChart />);
  expect(signal?.aborted).toBe(false);
  view.unmount();
  expect(signal?.aborted).toBe(true);
});

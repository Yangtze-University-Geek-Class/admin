// @vitest-environment jsdom
// 桌面窗口正文的分包加载失败（断网、发版后旧页面找不到新文件名）只让这个窗口说明，桌面不跟着卸掉变成白屏。
import { cleanup, render, screen } from "@testing-library/react";
import { Suspense, lazy } from "react";
import { afterEach, expect, it, vi } from "vitest";
import WindowLoadFailed from "../../app/web/sites/portal/components/os/WindowLoadFailed";

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

it("keeps the desktop mounted and says what to do when the window chunk fails", async () => {
  // React 会把渲染期抛出的错误打到控制台，这里只看界面结果
  vi.spyOn(console, "error").mockImplementation(() => undefined);
  const Broken = lazy(() => Promise.reject(new TypeError("Failed to fetch dynamically imported module")));
  render(
    <>
      <p>桌面还在</p>
      <WindowLoadFailed>
        <Suspense fallback={<p>正在打开信纸…</p>}>
          <Broken />
        </Suspense>
      </WindowLoadFailed>
    </>,
  );
  expect(await screen.findByText("信纸没能打开。")).toBeTruthy();
  expect(screen.getByText("桌面还在")).toBeTruthy();
  expect(screen.getByRole("button", { name: "刷新页面" })).toBeTruthy();
});

it("renders the window body when the chunk loads", () => {
  render(
    <WindowLoadFailed>
      <p>信纸正文</p>
    </WindowLoadFailed>,
  );
  expect(screen.getByText("信纸正文")).toBeTruthy();
  expect(screen.queryByText("信纸没能打开。")).toBeNull();
});

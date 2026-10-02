// @vitest-environment jsdom
// #122：直接打开 /join-us（没有 cookie、没有预取）时整页先被 inert，播放层分包在弱网下要几秒才到。
// 以前 Suspense 的 fallback 是 null，这段空白期点不动、没有加载提示、也没有跳过入口。
// 现在 fallback 是与播放层同一套的加载遮罩：有「正在加载…」，右上角「跳过」一直可用（Esc 同样能关），
// 跳过与播放层同一语义：写「已看过」的 cookie 并让页面恢复可交互。
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
// react-router-dom 只装在 app/web 下，测试文件从仓库根解析不到：按页面实际用的那一份导入，路由器上下文要和页面同一个实例
import { MemoryRouter } from "../../app/web/node_modules/react-router-dom/dist/index.mjs";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { PROMO_COOKIE } from "../../app/web/sites/portal/lib/promo";

// 播放层分包永远不 resolve：Suspense 就停在 fallback 上（真实弱网里下载分包的那几秒）
vi.mock("../../app/web/sites/portal/components/PromoPlayer", () => Promise.withResolvers().promise);

import JoinUs from "../../app/web/sites/portal/pages/JoinUs";

beforeEach(() => {
  // jsdom 没有 matchMedia（useReducedMotion 与 useInert 依赖它）
  vi.stubGlobal("matchMedia", (query: string) => ({ matches: false, media: query, addEventListener() {}, removeEventListener() {} }));
  // 页面挂载会拉 /api/public/config：给一个永远不 resolve 的桩，测试不需要它
  vi.stubGlobal("fetch", vi.fn(() => Promise.withResolvers().promise));
  // 每个用例从「没看过」开始
  document.cookie = `${PROMO_COOKIE}=; Max-Age=0; Path=/`;
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

const page = () => document.querySelector<HTMLElement>(".pt-join");

describe("宣传片加载占位（#122）", () => {
  it("分包没到时显示加载遮罩，跳过可点，会写 cookie 并解除 inert", async () => {
    render(<MemoryRouter><JoinUs /></MemoryRouter>);

    // 没有 cookie：整页先 inert，等宣传片
    expect(page()?.inert).toBe(true);

    // 分包没到，占位顶上：全屏遮罩、加载提示与可点的「跳过」都在
    expect(await screen.findByRole("dialog", { name: "极客班宣传片" })).toBeTruthy();
    expect(screen.getByText("正在加载…")).toBeTruthy();
    const skip = screen.getByRole("button", { name: /跳过/ });
    expect(skip.hasAttribute("disabled")).toBe(false);

    fireEvent.click(skip);

    // 与播放层跳过同一语义：写「已看过」的 cookie，页面恢复可交互，遮罩收起来
    expect(document.cookie).toContain(`${PROMO_COOKIE}=1`);
    expect(page()?.inert).toBe(false);
    expect(screen.queryByRole("dialog", { name: "极客班宣传片" })).toBeNull();
  });

  it("Esc 同样能跳过", async () => {
    render(<MemoryRouter><JoinUs /></MemoryRouter>);
    const dialog = await screen.findByRole("dialog", { name: "极客班宣传片" });

    fireEvent.keyDown(dialog, { key: "Escape" });

    expect(document.cookie).toContain(`${PROMO_COOKIE}=1`);
    expect(page()?.inert).toBe(false);
  });
});

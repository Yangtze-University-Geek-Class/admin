// @vitest-environment jsdom
// #122：直接打开 /join-us（没有 cookie、没有预取）时整页先被 inert，播放层分包在弱网下要几秒才到。
// 以前 Suspense 的 fallback 是 null，这段空白期点不动、没有加载提示、也没有跳过入口。
// 现在 fallback 是与播放层同一套的加载遮罩：有「正在加载…」，右上角「跳过」一直可用（Esc 同样能关），
// 跳过与播放层同一语义：写「已看过」的 cookie 并让页面恢复可交互。
// 分包到了以后换成真正的播放层：接着遮罩的淡入走，不从透明重来（否则会透出下面的浅色页面，闪一下）。
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type * as PromoLib from "../../app/web/sites/portal/lib/promo";
import { PROMO_COOKIE } from "../../app/web/sites/portal/lib/promo";

// 播放层分包由用例决定什么时候到：不放行就停在 Suspense 的 fallback 上（真实弱网里下载分包的那几秒）。
// 放行后给真正的播放层；loads 记分包被下载了几次。
const chunk = vi.hoisted(() => ({ loads: 0, arrive: () => {} }));
vi.mock("../../app/web/sites/portal/components/PromoPlayer", async (importOriginal) => {
  chunk.loads += 1;
  await new Promise<void>((resolve) => (chunk.arrive = resolve));
  return importOriginal();
});
// 真正的播放层挂上以后停在「正在加载」：能力探测不返回，不去碰 hls.js 和片源
vi.mock("../../app/web/sites/portal/lib/promo", async (importOriginal) => ({
  ...(await importOriginal<typeof PromoLib>()),
  detectCapabilities: () => new Promise(() => {}),
}));

let JoinUs: typeof import("../../app/web/sites/portal/pages/JoinUs").default;
// react-router-dom 只装在 app/web 下，测试文件从仓库根解析不到：按页面实际用的那一份导入，路由器上下文要和页面同一个实例
let MemoryRouter: typeof import("../../app/web/node_modules/react-router-dom/dist/index.mjs").MemoryRouter;

beforeEach(async () => {
  // 每条用例一份新的模块：PromoLazy 记着上一次加载的播放层，分包也要重新「下载」
  vi.resetModules();
  chunk.loads = 0;
  // jsdom 没有 matchMedia（useReducedMotion 与 useInert 依赖它）
  vi.stubGlobal("matchMedia", (query: string) => ({ matches: false, media: query, addEventListener() {}, removeEventListener() {} }));
  // 页面挂载会拉 /api/public/config：给一个永远不 resolve 的桩，测试不需要它
  vi.stubGlobal("fetch", vi.fn(() => new Promise(() => {})));
  // 播放层的背景画布与视频：jsdom 没有实现
  vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue(null);
  vi.spyOn(HTMLMediaElement.prototype, "load").mockImplementation(() => {});
  vi.spyOn(HTMLMediaElement.prototype, "pause").mockImplementation(() => {});
  // 每个用例从「没看过」开始
  document.cookie = `${PROMO_COOKIE}=; Max-Age=0; Path=/`;
  ({ default: JoinUs } = await import("../../app/web/sites/portal/pages/JoinUs"));
  ({ MemoryRouter } = await import("../../app/web/node_modules/react-router-dom/dist/index.mjs"));
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

const page = () => document.querySelector<HTMLElement>(".pt-join");
const open = () => render(<MemoryRouter><JoinUs /></MemoryRouter>);

describe("宣传片加载占位（#122）", () => {
  it("分包没到时显示加载遮罩，跳过可点，会写 cookie 并解除 inert", async () => {
    open();

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
    open();
    const dialog = await screen.findByRole("dialog", { name: "极客班宣传片" });

    fireEvent.keyDown(dialog, { key: "Escape" });

    expect(document.cookie).toContain(`${PROMO_COOKIE}=1`);
    expect(page()?.inert).toBe(false);
  });

  it("遮罩里 Tab 留在「跳过」上，Esc 不再冒泡到页面（和播放层一致）", async () => {
    const escapes = vi.fn();
    const onWindowKey = (event: KeyboardEvent) => event.key === "Escape" && escapes();
    window.addEventListener("keydown", onWindowKey);
    try {
      open();
      const skip = await screen.findByRole("button", { name: /跳过/ });
      expect(document.activeElement).toBe(skip);

      // fireEvent 返回 false 表示默认行为被取消：焦点不会跑出遮罩
      expect(fireEvent.keyDown(skip, { key: "Tab" })).toBe(false);
      expect(fireEvent.keyDown(skip, { key: "Tab", shiftKey: true })).toBe(false);
      expect(document.activeElement).toBe(skip);

      fireEvent.keyDown(skip, { key: "Escape" });
      expect(document.cookie).toContain(`${PROMO_COOKIE}=1`);
      expect(escapes).not.toHaveBeenCalled();
    } finally {
      window.removeEventListener("keydown", onWindowKey);
    }
  });

  it("replay 用这层遮罩时：按钮叫「关闭」，图标和播放层一样", async () => {
    const { LazyPromoPlayer } = await import("../../app/web/sites/portal/components/PromoLazy");
    const { ICONS } = await import("../../app/web/sites/portal/lib/icons");
    render(<LazyPromoPlayer mode="replay" placeholder onClose={() => {}} />);

    const close = await screen.findByRole("button", { name: /关闭/ });
    expect(close.querySelector("path")?.getAttribute("d")).toBe(ICONS["close-line"][0]);
  });

  it("减少动态效果：不显示遮罩、不下载播放层分包，按 blocked 算看过，直接进信纸", async () => {
    vi.stubGlobal("matchMedia", (query: string) => ({
      matches: query === "(prefers-reduced-motion: reduce)",
      media: query,
      addEventListener() {},
      removeEventListener() {},
    }));
    open();

    // 和播放层原来的 blocked 一样：写「已看过」的 cookie，页面一开始就能操作
    await waitFor(() => expect(document.cookie).toContain(`${PROMO_COOKIE}=1`));
    expect(page()?.inert).toBe(false);
    expect(screen.queryByRole("dialog", { name: "极客班宣传片" })).toBeNull();
    expect(screen.queryByText("正在加载…")).toBeNull();
    expect(chunk.loads).toBe(0);
  });

  it("分包到了换成播放层：接着遮罩的淡入走，不从透明重来", async () => {
    open();
    const cover = await screen.findByRole("dialog", { name: "极客班宣传片" });
    expect(chunk.loads).toBe(1);
    // 遮罩已经盖了 300ms，比进场淡入（promo.css 的 pt-promo-in，.25s）长：遮罩早就不透明了
    await new Promise((resolve) => setTimeout(resolve, 300));

    await act(async () => chunk.arrive());

    const player = await waitFor(() => {
      const root = document.querySelector<HTMLElement>(".pt-root.pt-promo");
      expect(root?.querySelector("video")).toBeTruthy();
      return root!;
    });
    // 播放层是新挂上的节点，会重播一遍进场淡入；负的 animation-delay 让它从遮罩已经淡到的地方接着走（这里是已经走完、直接不透明）
    expect(player).not.toBe(cover);
    const delay = /^-(\d+)ms$/.exec(player.style.animationDelay);
    expect(delay, `animation-delay: "${player.style.animationDelay}"`).not.toBeNull();
    expect(Number(delay![1])).toBeGreaterThanOrEqual(300);
    // 播放层接手了：还是 gate，页面仍 inert，焦点在播放层的「跳过」上
    expect(page()?.inert).toBe(true);
    expect(document.activeElement?.closest(".pt-promo")).toBe(player);
  });
});

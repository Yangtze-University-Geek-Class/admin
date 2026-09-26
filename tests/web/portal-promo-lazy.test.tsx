// @vitest-environment jsdom
// 宣传片分包加载失败（断网、发版后旧页面找不到新文件名）：播放层分包失败时不能让整个官网卸载，当作「播放失败」直接结束；
// 失败只算这一次打开，下次打开重新加载（#110）。hls.js 分包同理。
// 浏览器按 HTML 规范记住加载失败的模块地址，同一个地址以后都直接失败，所以重来要换地址。这里照这个样子模拟：
// 原地址一旦失败就一直失败；写死的重试地址（?retry=n，生产构建里是文件名不同的分包）换成按当时网络决定成败的桩。
import { act, cleanup, render, screen, waitFor } from "@testing-library/react";
import { Suspense, type ComponentType } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type * as PromoLazy from "../../app/web/sites/portal/components/PromoLazy";
import type * as PromoLib from "../../app/web/sites/portal/lib/promo";

const LIB = "../../app/web/sites/portal/lib/promo";
const PLAYER = "../../app/web/sites/portal/components/PromoPlayer";
const HLS = "../../app/web/node_modules/hls.js/dist/hls.light.mjs";

/** down：网络断着；poisoned：原地址失败过（浏览器记住了）；retried：用到的重试地址编号 */
const net = { down: true, poisoned: false, retried: [] as number[] };

/** 原地址：失败过一次就一直失败 */
function original<T>(module: () => T): T {
  if (net.down || net.poisoned) {
    net.poisoned = true;
    throw new Error("chunk load failed");
  }
  return module();
}

/**
 * 用真的 retryableImport，只把第 2 个起的写死地址换成桩：第 n 个地址按当时的网络决定成败，失败过也一直失败。
 * 调用方必须恰好给出原地址加 3 个重试地址。
 */
function browserImports(retryModule: () => unknown, overrides: Partial<typeof PromoLib> = {}) {
  vi.doMock(LIB, async () => {
    const actual = await vi.importActual<typeof PromoLib>(LIB);
    return {
      ...actual,
      ...overrides,
      retryableImport: <T,>(loads: readonly [() => Promise<T>, ...(() => Promise<T>)[]]) => {
        expect(loads).toHaveLength(4);
        const failed = new Set<number>();
        const [first, ...rest] = loads;
        const stubs = rest.map((_, i) => async () => {
          const n = i + 1;
          net.retried.push(n);
          if (net.down || failed.has(n)) {
            failed.add(n);
            throw new TypeError(`Failed to fetch dynamically imported module: chunk.js?retry=${n}`);
          }
          return retryModule() as T;
        });
        return actual.retryableImport([first, ...stubs]);
      },
    };
  });
}

beforeEach(() => {
  net.down = true;
  net.poisoned = false;
  net.retried = [];
  // 每条用例一份新的模块（模块里记着上一次加载的结果），所以只能在这里注册桩、动态加载
  vi.resetModules();
});
afterEach(() => {
  cleanup();
  vi.doUnmock(LIB);
  vi.doUnmock(PLAYER);
  vi.doUnmock(HLS);
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("播放层分包", () => {
  const Stub = () => <div role="dialog" aria-label="极客班宣传片" />;
  let LazyPromoPlayer: typeof PromoLazy.LazyPromoPlayer;
  beforeEach(async () => {
    vi.doMock(PLAYER, () => original(() => ({ default: Stub })));
    browserImports(() => ({ default: Stub }));
    ({ LazyPromoPlayer } = await import("../../app/web/sites/portal/components/PromoLazy"));
  });

  function open(onClose: (reason: string) => void) {
    return (
      <Suspense fallback={null}>
        <LazyPromoPlayer mode="gate" onClose={(reason) => onClose(reason)} />
      </Suspense>
    );
  }

  it("分包加载失败时调用 onClose(\"failed\")，不抛到外面；父组件重渲染换了新的 onClose 也只调一次", async () => {
    const onClose = vi.fn();
    const view = render(open(onClose));
    await waitFor(() => expect(onClose).toHaveBeenCalledWith("failed"));
    view.rerender(open(onClose));
    await act(async () => {});
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("失败只算这一次：还断着网时再打开同样按失败结束一次；网络恢复后再打开，换地址重新加载并正常播放", async () => {
    const first = vi.fn();
    render(open(first));
    await waitFor(() => expect(first).toHaveBeenCalledWith("failed"));
    cleanup();

    const second = vi.fn();
    render(open(second));
    await waitFor(() => expect(second).toHaveBeenCalledWith("failed"));
    expect(second).toHaveBeenCalledTimes(1);
    cleanup();

    net.down = false;
    const third = vi.fn();
    render(open(third));
    expect(await screen.findByRole("dialog", { name: "极客班宣传片" })).toBeTruthy();
    expect(third).not.toHaveBeenCalled();
    // 原地址失败后马上换第 1 个重试地址试一次，之后每次打开换一个新地址
    expect(net.retried).toEqual([1, 2, 3]);
  });

  it("桌面预取时断网、后来网络恢复：第一次打开就换地址加载，直接能播", async () => {
    net.poisoned = true;
    net.down = false;
    const onClose = vi.fn();
    render(open(onClose));
    expect(await screen.findByRole("dialog", { name: "极客班宣传片" })).toBeTruthy();
    expect(onClose).not.toHaveBeenCalled();
    expect(net.retried).toEqual([1]);
  });
});

describe("hls.js 分包", () => {
  class FakeHls {
    static Events = { MANIFEST_PARSED: "manifestParsed", ERROR: "error" };
    static ErrorTypes = { MEDIA_ERROR: "mediaError" };
    static created = 0;
    levels = [{ bitrate: 641540 }];
    startLevel = -1;
    constructor() {
      FakeHls.created += 1;
    }
    on() {}
    loadSource() {}
    attachMedia() {}
    startLoad() {}
    recoverMediaError() {}
    destroy() {}
  }
  let PromoPlayer: ComponentType<{ mode: "gate" | "replay"; onClose: (reason: string) => void }>;
  beforeEach(async () => {
    FakeHls.created = 0;
    vi.doMock(HLS, () => original(() => ({ default: FakeHls })));
    // 只用 hls.js 这条路
    browserImports(() => ({ default: FakeHls }), {
      detectCapabilities: async () => ({ mse: true, mseAv1Smooth: false, native: false, nativeAv1: false, touch: false }),
    });
    vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue(null);
    vi.stubGlobal("matchMedia", (query: string) => ({ matches: false, media: query, addEventListener() {}, removeEventListener() {} }));
    vi.spyOn(HTMLMediaElement.prototype, "play").mockImplementation(async () => {});
    vi.spyOn(HTMLMediaElement.prototype, "pause").mockImplementation(() => {});
    vi.spyOn(HTMLMediaElement.prototype, "load").mockImplementation(() => {});
    ({ default: PromoPlayer } = await import("../../app/web/sites/portal/components/PromoPlayer"));
  });

  it("失败只算这一次：网络恢复后再打开，换地址重新加载 hls.js 并开始播放", async () => {
    const first = vi.fn();
    render(<PromoPlayer mode="gate" onClose={first} />);
    await waitFor(() => expect(first).toHaveBeenCalledWith("failed"));
    cleanup();

    net.down = false;
    const second = vi.fn();
    render(<PromoPlayer mode="gate" onClose={second} />);
    await waitFor(() => expect(FakeHls.created).toBe(1));
    expect(second).not.toHaveBeenCalled();
    expect(net.retried.at(-1)).toBe(2);
  });
});

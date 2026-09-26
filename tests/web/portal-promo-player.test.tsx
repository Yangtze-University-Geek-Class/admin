// @vitest-environment jsdom
// 宣传片播放层的交互：画面上只有「跳过 / 关闭」（#142）、Esc、点画面不暂停、只记一次「看过」、
// 浏览器不让自动播时的退路（gate 直接结束，replay 停在封面点画面播）、减少动态效果、播不了时直接放行。
// jsdom 没有 MediaSource、视频解码与 canvas：能力探测用桩，video.play/pause/load 用桩，canvas 的 2D 上下文返回 null（不画背景），
// hls.js 换成记录调用的假对象，片源只核对地址。
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { Capabilities } from "../../app/web/sites/portal/lib/promo";

const caps = vi.hoisted(() => ({ current: { mse: false, mseAv1Smooth: false, native: true, nativeAv1: false, touch: false } as Capabilities }));
const fakeHls = vi.hoisted(() => {
  type Handler = (...args: unknown[]) => void;
  class FakeHls {
    static Events = { MANIFEST_PARSED: "manifestParsed", ERROR: "error" };
    static ErrorTypes = { MEDIA_ERROR: "mediaError" };
    static last: FakeHls | null = null;
    handlers = new Map<string, Handler>();
    levels = [3660452, 343186, 1227252, 641540, 2151112].map((bitrate) => ({ bitrate }));
    startLevel = -1;
    started: number | null = null;
    /** startLoad 被调用那一刻的 startLevel：起播档必须在开始加载之前设好 */
    levelAtStart: number | null = null;
    source = "";
    constructor(public config: Record<string, unknown>) {
      FakeHls.last = this;
    }
    on(event: string, handler: Handler) {
      this.handlers.set(event, handler);
    }
    loadSource(url: string) {
      this.source = url;
    }
    attachMedia() {}
    startLoad(position: number) {
      this.started = position;
      this.levelAtStart = this.startLevel;
    }
    recoverMediaError() {}
    destroy() {}
  }
  return FakeHls;
});
// hls.js 只装在 app/web 下，从测试文件解析不到 "hls.js/light"：按播放层实际加载的文件路径换掉它
vi.mock("../../app/web/node_modules/hls.js/dist/hls.light.mjs", () => ({ default: fakeHls }));
vi.mock("../../app/web/sites/portal/lib/promo", async (original) => ({
  ...(await original<typeof import("../../app/web/sites/portal/lib/promo")>()),
  detectCapabilities: vi.fn(async () => caps.current),
}));

import PromoPlayer from "../../app/web/sites/portal/components/PromoPlayer";
import { PROMO, detectCapabilities } from "../../app/web/sites/portal/lib/promo";

let play: ReturnType<typeof vi.fn>;
beforeEach(() => {
  caps.current = { mse: false, mseAv1Smooth: false, native: true, nativeAv1: false, touch: false };
  fakeHls.last = null;
  vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue(null);
  vi.stubGlobal("matchMedia", (query: string) => ({ matches: false, media: query, addEventListener() {}, removeEventListener() {} }));
  play = vi.fn(async () => {});
  vi.spyOn(HTMLMediaElement.prototype, "play").mockImplementation(play as () => Promise<void>);
  vi.spyOn(HTMLMediaElement.prototype, "pause").mockImplementation(() => {});
  vi.spyOn(HTMLMediaElement.prototype, "load").mockImplementation(() => {});
});
afterEach(() => {
  // 先卸载（卸载时会调 video.load()），再还原桩
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

const video = () => document.querySelector("video") as HTMLVideoElement;
/** jsdom 的指针事件不带 pointerType：自己造一个带上它的事件 */
function pointer(target: Element, type: "pointerdown" | "pointermove", pointerType: "mouse" | "touch") {
  const event = new MouseEvent(type, { bubbles: true });
  Object.defineProperty(event, "pointerType", { value: pointerType });
  act(() => {
    target.dispatchEvent(event);
  });
}
/** 让桩出来的 video.paused 跟着真实浏览器走：play() 之后是 false，pause 事件之后是 true */
function trackPaused() {
  let paused = true;
  Object.defineProperty(video(), "paused", { configurable: true, get: () => paused });
  return (value: boolean) => (paused = value);
}
/** 画面上只有一个按钮「跳过 / 关闭 Esc」：没有播放 / 暂停、进度、时间、音量、「打开声音」「播放宣传片」 */
function expectOnlyClose(label: "跳过" | "关闭") {
  const dialog = screen.getByRole("dialog", { name: "极客班宣传片" });
  const buttons = within(dialog).getAllByRole("button");
  expect(buttons.map((button) => button.textContent)).toEqual([`${label}Esc`]);
  expect(within(dialog).queryAllByRole("slider")).toEqual([]);
  expect(within(dialog).queryAllByRole("progressbar")).toEqual([]);
  expect(dialog.textContent).not.toMatch(/\d:\d\d|打开声音|播放宣传片|静音|暂停/);
}

it("gate：原生 HLS 播 H.264 片源，带声音自动播；点「跳过」结束，只记一次看过", async () => {
  const onClose = vi.fn();
  const onSeen = vi.fn();
  render(<PromoPlayer mode="gate" onSeen={onSeen} onClose={onClose} />);
  const dialog = screen.getByRole("dialog", { name: "极客班宣传片" });
  await waitFor(() => expect(video().getAttribute("src")).toBe(PROMO.masters.h264));
  expect(dialog.dataset.engine).toBe("native");
  expect(play).toHaveBeenCalled();
  expect(video().muted).toBe(false);
  expectOnlyClose("跳过");
  // 真正开始播放时记一次
  fireEvent.playing(video());
  expect(onSeen).toHaveBeenCalledTimes(1);
  expectOnlyClose("跳过");
  fireEvent.click(screen.getByRole("button", { name: /跳过/ }));
  expect(onClose).toHaveBeenCalledWith("skipped");
  expect(onSeen).toHaveBeenCalledTimes(1);
});

it("Esc 等于跳过；replay 模式的按钮叫「关闭」，画面上也只有它", async () => {
  const onClose = vi.fn();
  render(<PromoPlayer mode="replay" onClose={onClose} />);
  await waitFor(() => expect(video().getAttribute("src")).toBeTruthy());
  fireEvent.playing(video());
  expectOnlyClose("关闭");
  fireEvent.keyDown(screen.getByRole("dialog"), { key: "Escape" });
  expect(onClose).toHaveBeenCalledWith("skipped");
});

it("gate 里 Esc 也能跳过；打开时焦点在「跳过」上，Tab 留在它身上", async () => {
  const onClose = vi.fn();
  render(<PromoPlayer mode="gate" onClose={onClose} />);
  const skip = screen.getByRole("button", { name: /跳过/ });
  expect(document.activeElement).toBe(skip);
  const dialog = screen.getByRole("dialog");
  // 点过画面以后焦点在播放层自己身上，Tab 回到「跳过」
  act(() => dialog.focus());
  fireEvent.keyDown(dialog, { key: "Tab" });
  expect(document.activeElement).toBe(skip);
  fireEvent.keyDown(skip, { key: "Tab", shiftKey: true });
  expect(document.activeElement).toBe(skip);
  fireEvent.keyDown(dialog, { key: "Escape" });
  expect(onClose).toHaveBeenCalledWith("skipped");
  expect(onClose).toHaveBeenCalledTimes(1);
});

it("播完也算看过", async () => {
  const onClose = vi.fn();
  const onSeen = vi.fn();
  render(<PromoPlayer mode="gate" onSeen={onSeen} onClose={onClose} />);
  await waitFor(() => expect(video().getAttribute("src")).toBeTruthy());
  fireEvent.ended(video());
  expect(onClose).toHaveBeenCalledWith("ended");
  expect(onSeen).toHaveBeenCalledTimes(1);
});

it("不让带声音自动播：静音播，画面上仍只有「跳过」；点画面打开声音，不暂停", async () => {
  play.mockRejectedValueOnce(new DOMException("blocked", "NotAllowedError"));
  const pause = vi.spyOn(HTMLMediaElement.prototype, "pause");
  render(<PromoPlayer mode="gate" onClose={vi.fn()} />);
  await waitFor(() => expect(play).toHaveBeenCalledTimes(2));
  expect(video().muted).toBe(true);
  fireEvent.playing(video());
  expectOnlyClose("跳过");
  fireEvent.click(video());
  expect(video().muted).toBe(false);
  expect(pause).not.toHaveBeenCalled();
  expect(play).toHaveBeenCalledTimes(2);
});

it("gate 静音也不让播：直接结束（blocked），算看过，不停在封面等人点", async () => {
  play.mockRejectedValue(new DOMException("blocked", "NotAllowedError"));
  const onClose = vi.fn();
  const onSeen = vi.fn();
  render(<PromoPlayer mode="gate" onSeen={onSeen} onClose={onClose} />);
  await waitFor(() => expect(onClose).toHaveBeenCalledWith("blocked"));
  expect(onClose).toHaveBeenCalledTimes(1);
  expect(onSeen).toHaveBeenCalledTimes(1);
  expect(play).toHaveBeenCalledTimes(2);
});

it("replay 静音也不让播：停在封面，只有「关闭」和「点画面播放」的提示；点画面带声音播", async () => {
  play.mockRejectedValueOnce(new DOMException("blocked", "NotAllowedError")).mockRejectedValueOnce(new DOMException("blocked", "NotAllowedError"));
  const onClose = vi.fn();
  render(<PromoPlayer mode="replay" onClose={onClose} />);
  await waitFor(() => expect(screen.getByRole("status").textContent).toBe("点画面播放"));
  expectOnlyClose("关闭");
  expect(onClose).not.toHaveBeenCalled();
  const setPaused = trackPaused();
  fireEvent.click(video());
  expect(play).toHaveBeenCalledTimes(3);
  expect(video().muted).toBe(false);
  setPaused(false);
  fireEvent.playing(video());
  expect(screen.queryByRole("status")).toBeNull();
});

it("gate 里 play() 被打断（AbortError 等）：按加载失败结束一次，不停在封面、不记看过", async () => {
  play.mockRejectedValueOnce(new DOMException("interrupted", "AbortError"));
  const onClose = vi.fn();
  const onSeen = vi.fn();
  render(<PromoPlayer mode="gate" onSeen={onSeen} onClose={onClose} />);
  await waitFor(() => expect(onClose).toHaveBeenCalledWith("failed"));
  expect(onClose).toHaveBeenCalledTimes(1);
  expect(onSeen).not.toHaveBeenCalled();
  // 被打断不是「不让带声音」：不再静音重试
  expect(play).toHaveBeenCalledTimes(1);
});

it("gate 遇到减少动态效果：不自动播，什么都不加载就结束（blocked），算看过，不画播放层", async () => {
  vi.stubGlobal("matchMedia", (query: string) => ({ matches: query === "(prefers-reduced-motion: reduce)", media: query, addEventListener() {}, removeEventListener() {} }));
  const onClose = vi.fn();
  const onSeen = vi.fn();
  render(<PromoPlayer mode="gate" onSeen={onSeen} onClose={onClose} />);
  expect(onClose).toHaveBeenCalledWith("blocked");
  expect(onClose).toHaveBeenCalledTimes(1);
  expect(onSeen).toHaveBeenCalledTimes(1);
  expect(screen.queryByRole("dialog")).toBeNull();
  expect(document.querySelector("video")).toBeNull();
  await act(async () => {});
  expect(detectCapabilities).not.toHaveBeenCalled();
  expect(play).not.toHaveBeenCalled();
});

it("replay 遇到减少动态效果照常播：是自己点开的", async () => {
  vi.stubGlobal("matchMedia", (query: string) => ({ matches: query === "(prefers-reduced-motion: reduce)", media: query, addEventListener() {}, removeEventListener() {} }));
  const onClose = vi.fn();
  render(<PromoPlayer mode="replay" onClose={onClose} />);
  await waitFor(() => expect(play).toHaveBeenCalledTimes(1));
  expect(video().muted).toBe(false);
  expect(onClose).not.toHaveBeenCalled();
  expectOnlyClose("关闭");
});

it("片源放不了（play() 报 NotSupportedError）：按加载失败结束一次，不记看过", async () => {
  play.mockRejectedValue(new DOMException("no source", "NotSupportedError"));
  const onClose = vi.fn();
  const onSeen = vi.fn();
  render(<PromoPlayer mode="gate" onSeen={onSeen} onClose={onClose} />);
  await waitFor(() => expect(onClose).toHaveBeenCalledWith("failed"));
  expect(onClose).toHaveBeenCalledTimes(1);
  expect(onSeen).not.toHaveBeenCalled();
});

it("起播时意外抛错（能力探测失败）：按加载失败结束一次", async () => {
  vi.mocked(detectCapabilities).mockRejectedValueOnce(new Error("probe crashed"));
  const onClose = vi.fn();
  const onSeen = vi.fn();
  render(<PromoPlayer mode="gate" onSeen={onSeen} onClose={onClose} />);
  await waitFor(() => expect(onClose).toHaveBeenCalledWith("failed"));
  expect(onClose).toHaveBeenCalledTimes(1);
  expect(onSeen).not.toHaveBeenCalled();
});

it("播放层卸载以后能力探测才出错：不再结束一次（不调 onClose）", async () => {
  let crash!: (error: Error) => void;
  // 项目 lib 是 ES2022，没有 Promise.withResolvers
  vi.mocked(detectCapabilities).mockReturnValueOnce(new Promise<Capabilities>((_, reject) => (crash = reject)));
  const onClose = vi.fn();
  const view = render(<PromoPlayer mode="gate" onClose={onClose} />);
  view.unmount();
  await act(async () => {
    crash(new Error("probe crashed"));
  });
  expect(onClose).not.toHaveBeenCalled();
});

it("两种播放方式都没有：直接结束，算看过（以后也播不了）", async () => {
  caps.current = { mse: false, mseAv1Smooth: false, native: false, nativeAv1: false, touch: false };
  const onClose = vi.fn();
  const onSeen = vi.fn();
  render(<PromoPlayer mode="gate" onSeen={onSeen} onClose={onClose} />);
  await waitFor(() => expect(onClose).toHaveBeenCalledWith("unsupported"));
  expect(onSeen).toHaveBeenCalledTimes(1);
});

it("原生播放加载失败：结束但不记看过，下次再试", async () => {
  const onClose = vi.fn();
  const onSeen = vi.fn();
  render(<PromoPlayer mode="gate" onSeen={onSeen} onClose={onClose} />);
  await waitFor(() => expect(video().getAttribute("src")).toBeTruthy());
  await act(async () => {
    fireEvent.error(video());
  });
  expect(onClose).toHaveBeenCalledWith("failed");
  expect(onSeen).not.toHaveBeenCalled();
});

it("hls.js：先解析档位再按估计带宽定起播档，缓冲 30 秒，不开 worker", async () => {
  caps.current = { mse: true, mseAv1Smooth: false, native: false, nativeAv1: false, touch: true };
  render(<PromoPlayer mode="gate" onClose={vi.fn()} />);
  await waitFor(() => expect(fakeHls.last?.source).toBe(PROMO.masters.h264));
  const player = fakeHls.last!;
  expect(player.config).toMatchObject({ enableWorker: false, autoStartLoad: false, maxBufferLength: 30, capLevelToPlayerSize: true });
  expect(player.started).toBeNull();
  // 手机没有网络信息时按 1Mbps 估计：700k 以内最高的是 360p（642k），在假档位里是下标 3
  act(() => player.handlers.get("manifestParsed")!());
  expect(player.startLevel).toBe(3);
  expect(player.started).toBe(-1);
  expect(player.levelAtStart).toBe(3);
});

it("播放中几秒不动鼠标，指针隐藏；「跳过」一直在；动一下鼠标就回来", async () => {
  vi.useFakeTimers({ shouldAdvanceTime: true });
  try {
    render(<PromoPlayer mode="gate" onClose={vi.fn()} />);
    const dialog = screen.getByRole("dialog");
    await waitFor(() => expect(video().getAttribute("src")).toBeTruthy());
    fireEvent.playing(video());
    act(() => vi.advanceTimersByTime(2600));
    expect(dialog.classList.contains("is-idle")).toBe(true);
    expectOnlyClose("跳过");
    pointer(dialog, "pointermove", "mouse");
    expect(dialog.classList.contains("is-idle")).toBe(false);
    // 叫醒后重新计时，再不动又会淡出
    act(() => vi.advanceTimersByTime(2600));
    expect(dialog.classList.contains("is-idle")).toBe(true);
    // 手指划过不算
    pointer(dialog, "pointermove", "touch");
    expect(dialog.classList.contains("is-idle")).toBe(true);
    // 停下时不隐藏
    pointer(dialog, "pointermove", "mouse");
    fireEvent.pause(video());
    act(() => vi.advanceTimersByTime(5000));
    expect(dialog.classList.contains("is-idle")).toBe(false);
  } finally {
    vi.useRealTimers();
  }
});

it("点画面从不暂停（鼠标、手指都一样），空格和 M 也不暂停、不静音", async () => {
  const pause = vi.spyOn(HTMLMediaElement.prototype, "pause");
  render(<PromoPlayer mode="gate" onClose={vi.fn()} />);
  const dialog = screen.getByRole("dialog");
  await waitFor(() => expect(video().getAttribute("src")).toBeTruthy());
  const setPaused = trackPaused();
  setPaused(false);
  fireEvent.playing(video());
  for (const kind of ["mouse", "touch"] as const) {
    pointer(video(), "pointerdown", kind);
    act(() => dialog.focus());
    fireEvent.click(video());
  }
  fireEvent.keyDown(dialog, { key: " " });
  fireEvent.keyDown(dialog, { key: "m" });
  expect(pause).not.toHaveBeenCalled();
  expect(video().muted).toBe(false);
  expect(play).toHaveBeenCalledTimes(1);
  expect(screen.queryByRole("status")).toBeNull();
  expectOnlyClose("跳过");
});

it("被系统停下（手机切到后台等）：提示「点画面播放」，点画面接着播；播完那一下的 pause 不算停下", async () => {
  const onClose = vi.fn();
  render(<PromoPlayer mode="gate" onClose={onClose} />);
  await waitFor(() => expect(video().getAttribute("src")).toBeTruthy());
  const setPaused = trackPaused();
  setPaused(false);
  fireEvent.playing(video());
  setPaused(true);
  fireEvent.pause(video());
  expect(screen.getByRole("status").textContent).toBe("点画面播放");
  expectOnlyClose("跳过");
  fireEvent.click(video());
  expect(play).toHaveBeenCalledTimes(2);
  setPaused(false);
  fireEvent.playing(video());
  expect(screen.queryByRole("status")).toBeNull();
  // 播完：浏览器先发 pause（此时 ended 已是 true）再发 ended
  Object.defineProperty(video(), "ended", { configurable: true, get: () => true });
  setPaused(true);
  fireEvent.pause(video());
  expect(screen.queryByRole("status")).toBeNull();
  fireEvent.ended(video());
  expect(onClose).toHaveBeenCalledWith("ended");
});

it("播放中卡住：显示「正在缓冲…」，恢复后消失", async () => {
  render(<PromoPlayer mode="gate" onClose={vi.fn()} />);
  await waitFor(() => expect(video().getAttribute("src")).toBeTruthy());
  fireEvent.playing(video());
  expect(screen.queryByRole("status")).toBeNull();
  fireEvent.waiting(video());
  expect(screen.getByRole("status").textContent).toContain("正在缓冲");
  fireEvent.playing(video());
  expect(screen.queryByRole("status")).toBeNull();
});

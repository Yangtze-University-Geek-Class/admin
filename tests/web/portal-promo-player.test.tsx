// @vitest-environment jsdom
// 宣传片播放层的交互：跳过 / 关闭、Esc、只记一次「看过」、浏览器不让自动播时的两级退路、播不了时直接放行。
// jsdom 没有 MediaSource、视频解码与 canvas：能力探测用桩，video.play/pause/load 用桩，canvas 的 2D 上下文返回 null（不画背景），
// hls.js 换成记录调用的假对象，片源只核对地址。
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
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
import { PROMO } from "../../app/web/sites/portal/lib/promo";

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

it("gate：原生 HLS 播 H.264 片源，带声音自动播；点「跳过」结束，只记一次看过", async () => {
  const onClose = vi.fn();
  const onSeen = vi.fn();
  render(<PromoPlayer mode="gate" onSeen={onSeen} onClose={onClose} />);
  const dialog = screen.getByRole("dialog", { name: "极客班宣传片" });
  await waitFor(() => expect(video().getAttribute("src")).toBe(PROMO.masters.h264));
  expect(dialog.dataset.engine).toBe("native");
  expect(play).toHaveBeenCalled();
  expect(video().muted).toBe(false);
  // 真正开始播放时记一次
  fireEvent.playing(video());
  expect(onSeen).toHaveBeenCalledTimes(1);
  fireEvent.click(screen.getByRole("button", { name: /跳过/ }));
  expect(onClose).toHaveBeenCalledWith("skipped");
  expect(onSeen).toHaveBeenCalledTimes(1);
});

it("Esc 等于跳过；replay 模式的按钮叫「关闭」", async () => {
  const onClose = vi.fn();
  render(<PromoPlayer mode="replay" onClose={onClose} />);
  expect(screen.getByRole("button", { name: /关闭/ })).toBeTruthy();
  expect(screen.queryByRole("button", { name: /跳过/ })).toBeNull();
  fireEvent.keyDown(screen.getByRole("dialog"), { key: "Escape" });
  expect(onClose).toHaveBeenCalledWith("skipped");
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

it("不让带声音自动播：静音播并亮出「打开声音」；点了之后恢复声音", async () => {
  play.mockRejectedValueOnce(new DOMException("blocked", "NotAllowedError"));
  render(<PromoPlayer mode="gate" onClose={vi.fn()} />);
  const unmute = await screen.findByRole("button", { name: "打开声音" });
  expect(video().muted).toBe(true);
  expect(play).toHaveBeenCalledTimes(2);
  fireEvent.click(unmute);
  expect(video().muted).toBe(false);
  expect(screen.getByRole("button", { name: "静音" })).toBeTruthy();
});

it("静音也不让播：停在封面，等点「播放宣传片」", async () => {
  play.mockRejectedValue(new DOMException("blocked", "NotAllowedError"));
  render(<PromoPlayer mode="gate" onClose={vi.fn()} />);
  expect(await screen.findByRole("button", { name: /播放宣传片/ })).toBeTruthy();
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
});

it("播放中几秒不动，底部控件淡出；「跳过」一直在；动一下鼠标就回来", async () => {
  vi.useFakeTimers({ shouldAdvanceTime: true });
  try {
    render(<PromoPlayer mode="gate" onClose={vi.fn()} />);
    const dialog = screen.getByRole("dialog");
    await waitFor(() => expect(video().getAttribute("src")).toBeTruthy());
    fireEvent.playing(video());
    act(() => vi.advanceTimersByTime(2600));
    expect(dialog.classList.contains("is-idle")).toBe(true);
    expect(screen.getByRole("button", { name: /跳过/ })).toBeTruthy();
    pointer(dialog, "pointermove", "mouse");
    expect(dialog.classList.contains("is-idle")).toBe(false);
  } finally {
    vi.useRealTimers();
  }
});

it("手指点画面只显示 / 收起控件，不暂停；鼠标点画面是暂停", async () => {
  const pause = vi.spyOn(HTMLMediaElement.prototype, "pause");
  render(<PromoPlayer mode="gate" onClose={vi.fn()} />);
  const dialog = screen.getByRole("dialog");
  await waitFor(() => expect(video().getAttribute("src")).toBeTruthy());
  fireEvent.playing(video());
  Object.defineProperty(video(), "paused", { configurable: true, get: () => false });
  pointer(video(), "pointerdown", "touch");
  fireEvent.click(video());
  expect(dialog.classList.contains("is-idle")).toBe(true);
  expect(pause).not.toHaveBeenCalled();
  pointer(video(), "pointerdown", "touch");
  fireEvent.click(video());
  expect(dialog.classList.contains("is-idle")).toBe(false);
  pointer(video(), "pointerdown", "mouse");
  fireEvent.click(video());
  expect(pause).toHaveBeenCalledTimes(1);
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

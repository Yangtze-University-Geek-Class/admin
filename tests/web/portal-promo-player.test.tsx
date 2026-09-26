// @vitest-environment jsdom
// 宣传片播放层的交互：跳过 / 关闭、Esc、只记一次「看过」、浏览器不让自动播时的两级退路、播不了时直接放行。
// jsdom 没有 MediaSource 与视频解码：能力探测用桩，video.play/pause/load 用桩，片源只核对地址。
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { Capabilities } from "../../app/web/sites/portal/lib/promo";

const caps = vi.hoisted(() => ({ current: { mse: false, mseAv1Smooth: false, native: true, nativeAv1: false } as Capabilities }));
vi.mock("../../app/web/sites/portal/lib/promo", async (original) => ({
  ...(await original<typeof import("../../app/web/sites/portal/lib/promo")>()),
  detectCapabilities: vi.fn(async () => caps.current),
}));

import PromoPlayer from "../../app/web/sites/portal/components/PromoPlayer";
import { PROMO } from "../../app/web/sites/portal/lib/promo";

let play: ReturnType<typeof vi.fn>;
beforeEach(() => {
  caps.current = { mse: false, mseAv1Smooth: false, native: true, nativeAv1: false };
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
  caps.current = { mse: false, mseAv1Smooth: false, native: false, nativeAv1: false };
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

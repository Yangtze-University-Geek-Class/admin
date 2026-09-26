// @vitest-environment jsdom
// 论坛 3D 页（#109）：从论坛按后退回来、浏览器从往返缓存恢复页面（pageshow.persisted）时，场景要整体复位，
// 不能只撤遮罩（转场停在最后一帧：镜头推近、气泡放大、拖动和点击都不响应）。three.js 场景换成记录调用的假对象。
import { cleanup, render, waitFor } from "@testing-library/react";
import { afterEach, beforeAll, expect, it, vi } from "vitest";

const fake = vi.hoisted(() => ({ reset: vi.fn(), dispose: vi.fn(), created: 0 }));
// 顶栏用 react-router 的 Link，与本用例无关，换成空组件
vi.mock("../../app/web/sites/portal/components/SceneBar", () => ({ default: () => null }));
vi.mock("../../app/web/sites/portal/three/forum", () => ({
  createForumScene: async () => {
    fake.created += 1;
    return { stage: {}, focusBoard: vi.fn(), open: vi.fn(), goHome: vi.fn(), reset: fake.reset, dispose: fake.dispose };
  },
}));

import Forum3D from "../../app/web/sites/portal/pages/Forum3D";

const pageshow = (persisted: boolean) => {
  const event = new Event("pageshow") as PageTransitionEvent;
  Object.defineProperty(event, "persisted", { value: persisted });
  window.dispatchEvent(event);
};

beforeAll(() => {
  // jsdom 没有 matchMedia
  window.matchMedia = (query: string) =>
    ({ matches: false, media: query, addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {}, onchange: null, dispatchEvent: () => false }) as MediaQueryList;
});

afterEach(() => {
  cleanup();
  fake.reset.mockClear();
  fake.created = 0;
});

it("从往返缓存恢复时复位场景并撤掉遮罩", async () => {
  const { container } = render(<Forum3D />);
  await waitFor(() => expect(fake.created).toBe(1));
  const wipe = container.querySelector<HTMLElement>(".pt-wipe")!;
  wipe.style.opacity = "1";
  pageshow(true);
  expect(fake.reset).toHaveBeenCalledTimes(1);
  expect(wipe.style.opacity).toBe("0");
});

it("普通的 pageshow（首次加载）不复位", async () => {
  render(<Forum3D />);
  await waitFor(() => expect(fake.created).toBe(1));
  pageshow(false);
  expect(fake.reset).not.toHaveBeenCalled();
});

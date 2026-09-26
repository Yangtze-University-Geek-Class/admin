// @vitest-environment jsdom
// 换壁纸（#147）：点下去立刻换上占位（底色 + 模糊缩略图）并开始展开，大图解码好后才换上；连点停在最后一张、不闪回；
// 减少动态效果只淡入；桌面空闲后预取其余壁纸，省流量 / 2G 时不预取。
// 图片下载解码用假的 Image 控制：每个地址的 decode() 由用例决定什么时候成功或失败。
import { act, cleanup, render } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type * as WallpaperModule from "../../app/web/sites/portal/components/os/Wallpaper";
import type * as WallpaperLib from "../../app/web/sites/portal/lib/wallpapers";

type Deferred = { resolve: () => void; reject: () => void };

/** 每个地址的 decode() 挂起，由用例 finish(url) / fail(url) 决定结果；created 记下创建顺序与优先级 */
const images = { pending: new Map<string, Deferred>(), created: [] as Array<{ src: string; fetchPriority: string }> };

class FakeImage {
  decoding = "auto";
  fetchPriority = "auto";
  private url = "";
  set src(value: string) {
    this.url = value;
    images.created.push({ src: value, fetchPriority: this.fetchPriority });
  }
  get src() {
    return this.url;
  }
  decode() {
    return new Promise<void>((resolve, reject) => images.pending.set(this.url, { resolve, reject: () => reject(new Error("decode failed")) }));
  }
}

async function finish(url: string) {
  await act(async () => images.pending.get(url)?.resolve());
}
async function fail(url: string) {
  await act(async () => images.pending.get(url)?.reject());
}
async function wait(ms: number) {
  await act(async () => {
    vi.advanceTimersByTime(ms);
  });
}

let reducedMotion = false;
let lib: typeof WallpaperLib;
let WallpaperLayer: typeof WallpaperModule.default;
let REVEAL: number;
let FADE: number;
let SHARPEN: number;

beforeEach(async () => {
  images.pending.clear();
  images.created = [];
  reducedMotion = false;
  vi.useFakeTimers();
  vi.stubGlobal("Image", FakeImage);
  vi.stubGlobal("matchMedia", (query: string) => ({ matches: reducedMotion && query.includes("reduce"), media: query, addEventListener() {}, removeEventListener() {} }));
  // 下载解码的缓存在模块里：每条用例一份新的
  vi.resetModules();
  lib = await import("../../app/web/sites/portal/lib/wallpapers");
  const component = await import("../../app/web/sites/portal/components/os/Wallpaper");
  WallpaperLayer = component.default;
  ({ WALLPAPER_REVEAL_MS: REVEAL, WALLPAPER_FADE_MS: FADE, WALLPAPER_SHARPEN_MS: SHARPEN } = component);
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.unstubAllGlobals();
  Reflect.deleteProperty(navigator, "connection");
});

const byId = (id: string) => lib.WALLPAPERS.find((wallpaper) => wallpaper.id === id)!;
/** 点的缩略图在屏幕上的位置 */
const THUMB = { left: 460, top: 390, width: 160, height: 90 };

function layers(container: HTMLElement) {
  return [...container.querySelectorAll<HTMLElement>(".pt-wall")].map((wall) => ({
    id: wall.dataset.wallpaper,
    enter: wall.dataset.enter,
    from: wall.style.getPropertyValue("--wall-from"),
    tint: wall.style.backgroundColor,
    thumb: wall.querySelector<HTMLElement>(".pt-wall-thumb")?.style.backgroundImage ?? null,
    full: wall.querySelector<HTMLElement>(".pt-wall-full.is-sharp")?.style.backgroundImage ?? null,
  }));
}
const top = (container: HTMLElement) => layers(container).at(-1)!;

describe("换壁纸", () => {
  it("点下去立刻换上占位：底色 + 模糊缩略图，从缩略图展开；大图解码好之前不出现大图，解码好后换上", async () => {
    const yugc = byId("yugc");
    const geek = byId("geek");
    const view = render(<WallpaperLayer wallpaper={yugc} />);
    expect(layers(view.container)).toEqual([expect.objectContaining({ id: "yugc", enter: "none", full: `url("${yugc.image}")` })]);

    view.rerender(<WallpaperLayer wallpaper={geek} from={THUMB} />);
    // 同一次渲染里新层就在最上面：不等下载
    expect(layers(view.container).map((layer) => layer.id)).toEqual(["yugc", "geek"]);
    expect(top(view.container)).toMatchObject({ enter: "reveal", thumb: `url("${geek.thumb}")`, full: null });
    expect(top(view.container).from).toMatch(/^inset\(.+ round 9px\)$/);
    expect(top(view.container).tint).not.toBe("");
    expect(view.container.innerHTML).not.toContain(geek.image);
    expect(images.created.map((image) => image.src)).toContain(geek.image);

    // 展开完：旧壁纸卸掉，占位还在（大图没到）；桌面上始终有一层整片盖着
    await wait(REVEAL + 60);
    expect(layers(view.container)).toEqual([expect.objectContaining({ id: "geek", thumb: `url("${geek.thumb}")`, full: null })]);

    await finish(geek.image);
    expect(top(view.container).full).toBe(`url("${geek.image}")`);
    // 清晰过来以后卸掉模糊的缩略图
    await wait(SHARPEN + 60);
    expect(layers(view.container)).toEqual([expect.objectContaining({ id: "geek", thumb: null, full: `url("${geek.image}")` })]);
  });

  it("连点几次：停在最后点的那张，先点的那几层晚到的计时和解码都不会把它换掉", async () => {
    const yugc = byId("yugc");
    const geek = byId("geek");
    const view = render(<WallpaperLayer wallpaper={yugc} />);
    // 最后点的是 yugc，和第一下点的 geek 不同：先点的层先展开完时，不能把桌面带回 geek
    const sequence = [geek, yugc, geek, yugc];
    for (const next of sequence) {
      view.rerender(<WallpaperLayer wallpaper={next} from={THUMB} />);
      expect(top(view.container).id).toBe(next.id);
      await wait(90);
    }
    // 还没有哪一层展开完：一层都没卸（卸早了，没盖住的地方会露出桌面底色）
    expect(layers(view.container).map((layer) => layer.id)).toEqual(["yugc", "geek", "yugc", "geek", "yugc"]);
    // 先点的 geek 的大图后到、它的计时先到：每一步最上面都还是最后点的 yugc
    await finish(geek.image);
    expect(top(view.container).id).toBe("yugc");
    for (let elapsed = 0; elapsed < REVEAL + 200; elapsed += 40) {
      await wait(40);
      expect(top(view.container).id).toBe("yugc");
    }
    await finish(yugc.image);
    expect(layers(view.container)).toEqual([expect.objectContaining({ id: "yugc", full: `url("${yugc.image}")` })]);
  });

  it("中间那层先展开完只卸它下面的层，上面还在展开的新层不动", async () => {
    const yugc = byId("yugc");
    const geek = byId("geek");
    const view = render(<WallpaperLayer wallpaper={yugc} />);
    view.rerender(<WallpaperLayer wallpaper={geek} from={THUMB} />);
    await wait(REVEAL - 200);
    view.rerender(<WallpaperLayer wallpaper={yugc} from={THUMB} />);
    await wait(260);
    // geek 展开完了：开机那层卸掉；最后点的 yugc 还在展开
    expect(layers(view.container).map((layer) => [layer.id, layer.enter])).toEqual([
      ["geek", "reveal"],
      ["yugc", "reveal"],
    ]);
    await wait(REVEAL);
    expect(layers(view.container).map((layer) => layer.id)).toEqual(["yugc"]);
  });

  it("换回已经下好的壁纸（开机那张、换过的）：直接给大图，不顶缩略图", async () => {
    const yugc = byId("yugc");
    const geek = byId("geek");
    const view = render(<WallpaperLayer wallpaper={yugc} />);
    await finish(yugc.image);
    view.rerender(<WallpaperLayer wallpaper={geek} from={THUMB} />);
    await finish(geek.image);
    await wait(REVEAL + SHARPEN + 100);
    view.rerender(<WallpaperLayer wallpaper={yugc} from={THUMB} />);
    expect(top(view.container)).toMatchObject({ id: "yugc", enter: "reveal", thumb: null, full: `url("${yugc.image}")` });
    // 开机那张只下载一次：换回来用的是缓存
    expect(images.created.filter((image) => image.src === yugc.image)).toHaveLength(1);
  });

  it("大图下载失败：停在底色 + 模糊缩略图，不闪回旧壁纸；下次换过去再下载", async () => {
    const yugc = byId("yugc");
    const geek = byId("geek");
    const view = render(<WallpaperLayer wallpaper={yugc} />);
    view.rerender(<WallpaperLayer wallpaper={geek} from={THUMB} />);
    await fail(geek.image);
    await wait(REVEAL + SHARPEN + 100);
    expect(layers(view.container)).toEqual([expect.objectContaining({ id: "geek", thumb: `url("${geek.thumb}")`, full: null })]);
    view.rerender(<WallpaperLayer wallpaper={yugc} from={THUMB} />);
    view.rerender(<WallpaperLayer wallpaper={geek} from={THUMB} />);
    expect(images.created.filter((image) => image.src === geek.image)).toHaveLength(2);
  });

  it("减少动态效果：不展开，整层淡入，淡入完就卸掉旧壁纸", async () => {
    reducedMotion = true;
    const yugc = byId("yugc");
    const geek = byId("geek");
    const view = render(<WallpaperLayer wallpaper={yugc} />);
    view.rerender(<WallpaperLayer wallpaper={geek} from={THUMB} />);
    expect(top(view.container)).toMatchObject({ id: "geek", enter: "fade", from: "", thumb: `url("${geek.thumb}")` });
    expect(FADE).toBeLessThan(REVEAL);
    await wait(FADE + 60);
    expect(layers(view.container).map((layer) => layer.id)).toEqual(["geek"]);
  });
});

describe("空闲预取", () => {
  function idleQueue() {
    const queue: Array<() => void> = [];
    vi.stubGlobal("requestIdleCallback", (run: () => void) => queue.push(run));
    vi.stubGlobal("cancelIdleCallback", () => undefined);
    return queue;
  }

  it("桌面空闲时才开始，按顺序一张一张低优先级下载：先缩略图，再当前以外的大图", async () => {
    const queue = idleQueue();
    lib.prefetchWallpapersWhenIdle("yugc");
    expect(images.created).toEqual([]);
    queue.shift()!();
    const expected = lib.wallpaperPrefetchList("yugc");
    for (const url of expected) {
      expect(images.created.at(-1)).toEqual({ src: url, fetchPriority: "low" });
      await finish(url);
    }
    expect(images.created.map((image) => image.src)).toEqual(expected);
    expect(lib.isWallpaperDecoded(byId("geek").image)).toBe(true);
  });

  it("预取到一半时换过去：接着等这一次下载，不重新下；下完就清晰过来", async () => {
    const queue = idleQueue();
    const geek = byId("geek");
    const view = render(<WallpaperLayer wallpaper={byId("yugc")} />);
    lib.prefetchWallpapersWhenIdle("yugc");
    queue.shift()!();
    for (const url of [byId("yugc").thumb, geek.thumb]) await finish(url);
    expect(images.created.at(-1)).toEqual({ src: geek.image, fetchPriority: "low" });
    view.rerender(<WallpaperLayer wallpaper={geek} from={THUMB} />);
    expect(top(view.container)).toMatchObject({ id: "geek", full: null });
    await finish(geek.image);
    expect(top(view.container).full).toBe(`url("${geek.image}")`);
    expect(images.created.filter((image) => image.src === geek.image)).toHaveLength(1);
  });

  it("预取到一半就取消（退回书桌）：后面的不再下载", async () => {
    const queue = idleQueue();
    const cancel = lib.prefetchWallpapersWhenIdle("yugc");
    queue.shift()!();
    cancel();
    await finish(images.created[0].src);
    expect(images.created).toHaveLength(1);
  });

  it("开了省流量或网络是 2G：不排空闲任务，一张都不下", () => {
    for (const connection of [{ saveData: true }, { effectiveType: "2g" }, { effectiveType: "slow-2g" }]) {
      const queue = idleQueue();
      Object.defineProperty(navigator, "connection", { value: connection, configurable: true });
      lib.prefetchWallpapersWhenIdle("yugc");
      expect(queue).toHaveLength(0);
      vi.advanceTimersByTime(10_000);
    }
    expect(images.created).toEqual([]);
  });

  it("没有 requestIdleCallback（Safari）：等一会儿再开始", () => {
    vi.stubGlobal("requestIdleCallback", undefined);
    lib.prefetchWallpapersWhenIdle("geek");
    expect(images.created).toEqual([]);
    vi.advanceTimersByTime(1600);
    expect(images.created.map((image) => image.src)).toEqual([byId("yugc").thumb]);
  });
});

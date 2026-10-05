// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { AppLink } from "../../app/web/sites/portal/lib/osApps";
import { PHONE_QUERY } from "../../app/web/sites/portal/lib/useMediaQuery";

const followed = vi.hoisted(() => ({ calls: [] as AppLink[] }));
vi.mock("../../app/web/sites/portal/lib/osApps", async (original) => ({
  ...(await original<typeof import("../../app/web/sites/portal/lib/osApps")>()),
  followAppLink: (link: AppLink) => followed.calls.push(link),
}));
vi.mock("../../app/web/sites/portal/components/os/Wallpaper", () => ({
  default: ({ wallpaper }: { wallpaper: { image: string } }) => <div data-testid="wallpaper" data-image={wallpaper.image} />,
}));
vi.mock("../../app/web/sites/portal/components/PromoLazy", () => ({ LazyPromoPlayer: () => null }));
vi.mock("../../app/web/sites/portal/lib/wallpapers", async (original) => ({
  ...(await original<typeof import("../../app/web/sites/portal/lib/wallpapers")>()),
  prefetchWallpapersWhenIdle: () => () => undefined,
}));
import YugcOs from "../../app/web/sites/portal/components/os/YugcOs";

let phone = true;
const changes = new Set<() => void>();
beforeEach(() => {
  phone = true;
  changes.clear();
  followed.calls = [];
  document.cookie = "yugc_promo_seen=1; Path=/";
  HTMLDialogElement.prototype.showModal = function () { this.setAttribute("open", ""); };
  HTMLDialogElement.prototype.close = function () { this.removeAttribute("open"); };
  Element.prototype.scrollTo ??= () => undefined;
  vi.stubGlobal("matchMedia", (query: string) => ({
    get matches() { return query === "(orientation: portrait)" || query === PHONE_QUERY && phone; },
    media: query,
    addEventListener: (_: string, fn: () => void) => { if (query === PHONE_QUERY) changes.add(fn); },
    removeEventListener: (_: string, fn: () => void) => { changes.delete(fn); },
  }));
  vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ signed_in: false }), { status: 200, headers: { "content-type": "application/json" } })));
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  sessionStorage.clear();
  localStorage.clear();
});
const icons = () => within(screen.getByRole("list", { name: "主屏幕上的应用" }));
const dock = () => within(screen.getByRole("navigation", { name: "Dock" }));
function mount() {
  const onBack = vi.fn();
  return { ...render(<MemoryRouter><YugcOs active onBack={onBack} /></MemoryRouter>), onBack };
}

it("手机有状态栏、应用和四项 Dock，没有电脑菜单和默认大便签；指引按需打开，书桌仍可到达", async () => {
  const { container, onBack } = mount();
  await screen.findByRole("link", { name: /用 GitHub 登录/ });
  expect(container.querySelector(".pt-phone-status")).not.toBeNull();
  expect(container.querySelector(".pt-phone-tools")).toBeNull();
  for (const name of ["前往", "窗口", "帮助"]) expect(screen.queryByRole("button", { name })).toBeNull();
  expect(container.querySelector(".pt-note")).toBeNull();
  expect(dock().getAllByRole("button")).toHaveLength(4);
  fireEvent.click(screen.getByRole("button", { name: /新来的看这里/ }));
  expect(screen.getByRole("dialog", { name: "新来的看这里" })).not.toBeNull();
  expect(screen.getByText("点一下主屏幕上的图标就能打开应用。")).not.toBeNull();
  fireEvent.click(screen.getByRole("button", { name: "关闭对话框" }));
  const settings = screen.getByRole("button", { name: "YUGC OS 系统设置", exact: true });
  expect(settings.textContent).toBe("YUGC OS");
  fireEvent.click(settings);
  fireEvent.click(screen.getByRole("button", { name: "回到书桌", exact: true }));
  expect(onBack).toHaveBeenCalledOnce();
});

it.each([null, false, true])("手机控制台沿用 console_link=%s，图标、搜索、终端都一致", async (consoleLink) => {
  vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify(
    consoleLink === null ? { signed_in: false } : { signed_in: true, login: "test-member", user_id: 1, console_link: consoleLink },
  ), { status: 200, headers: { "content-type": "application/json" } })));
  mount();
  if (consoleLink === null) await screen.findByRole("link", { name: /用 GitHub 登录/ });
  else await screen.findByRole("button", { name: "账号：test-member" });
  expect(icons().queryByRole("button", { name: "控制台" }) !== null).toBe(consoleLink === true);
  fireEvent.click(screen.getByRole("button", { name: "搜索", exact: true }));
  fireEvent.change(screen.getByRole("combobox"), { target: { value: "控制台" } });
  expect(screen.queryByRole("option", { name: /控制台/ }) !== null).toBe(consoleLink === true);
  fireEvent.click(screen.getByRole("button", { name: "关闭对话框" }));
  fireEvent.click(icons().getByRole("button", { name: "终端" }));
  const input = screen.getByRole("textbox", { name: "终端输入" });
  fireEvent.change(input, { target: { value: "ls" } });
  fireEvent.keyDown(input, { key: "Enter" });
  expect(screen.queryByText("console", { selector: ".pt-term-key" }) !== null).toBe(consoleLink === true);
});

it("手机单击直达，双击事件不重复打开；论坛当前页，GitHub 新标签", () => {
  const { container } = mount();
  fireEvent.click(icons().getByRole("button", { name: "论坛" }));
  fireEvent.click(icons().getByRole("button", { name: /GitHub 组织/ }));
  fireEvent.doubleClick(icons().getByRole("button", { name: /GitHub 组织/ }));
  expect(followed.calls.map((link) => link.newTab)).toEqual([false, true]);
  expect(followed.calls[0].href).toBe("http://127.0.0.1:3456/");
  expect(container.querySelector(".pt-flight")).toBeNull();
});

it("指引与壁纸弹层隔离背景数字键和搜索快捷键", () => {
  mount();
  for (const trigger of [() => screen.getByRole("button", { name: /新来的看这里/ }), () => icons().getByRole("button", { name: "壁纸" }), () => screen.getByRole("button", { name: "YUGC OS 系统设置", exact: true })]) {
    fireEvent.click(trigger());
    const dialog = screen.getByRole("dialog");
    const button = within(dialog).getAllByRole("button")[0];
    fireEvent.keyDown(button, { key: "2" });
    fireEvent.keyDown(button, { key: "3" });
    fireEvent.keyDown(button, { key: "k", ctrlKey: true });
    expect(followed.calls).toEqual([]);
    expect(screen.getAllByRole("dialog")).toHaveLength(1);
    expect(screen.getByRole("dialog")).toBe(dialog);
    fireEvent.click(within(dialog).getByRole("button", { name: "关闭对话框" }));
  }
});

it("返回主屏幕保留终端输入和输出，切电脑模式不重挂应用，关闭应用才清空", async () => {
  mount();
  fireEvent.click(icons().getByRole("button", { name: "终端" }));
  const input = screen.getByRole("textbox", { name: "终端输入" });
  fireEvent.change(input, { target: { value: "help" } });
  fireEvent.keyDown(input, { key: "Enter" });
  fireEvent.change(input, { target: { value: "unfinished" } });
  fireEvent.click(dock().getByRole("button", { name: "返回主屏幕" }));
  expect(screen.queryByRole("dialog")).toBeNull();
  fireEvent.click(icons().getByRole("button", { name: "终端" }));
  expect(screen.getByRole("textbox", { name: "终端输入" })).toBe(input);
  expect((input as HTMLInputElement).value).toBe("unfinished");
  await waitFor(() => expect(document.activeElement).toBe(input));
  act(() => { phone = false; changes.forEach((fn) => fn()); });
  expect(screen.getByRole("textbox", { name: "终端输入" })).toBe(input);
  expect(screen.getByRole("button", { name: "前往" })).not.toBeNull();
  act(() => { phone = true; changes.forEach((fn) => fn()); });
  expect((screen.getByRole("textbox", { name: "终端输入" }) as HTMLInputElement).value).toBe("unfinished");
  fireEvent.click(screen.getByRole("button", { name: "关闭应用" }));
  fireEvent.click(icons().getByRole("button", { name: "终端" }));
  expect((screen.getByRole("textbox", { name: "终端输入" }) as HTMLInputElement).value).toBe("");
});

it("手机一次只显示前台面板，关闭回主屏幕；搜索可打开应用，壁纸支持方向键选择", () => {
  mount();
  fireEvent.click(icons().getByRole("button", { name: "终端" }));
  fireEvent.keyDown(window, { key: "k", ctrlKey: true });
  fireEvent.change(screen.getByRole("combobox"), { target: { value: "关于" } });
  fireEvent.keyDown(screen.getByRole("combobox"), { key: "Enter" });
  expect(screen.getAllByRole("dialog")).toHaveLength(1);
  expect(screen.getByRole("dialog", { name: "关于极客班" })).not.toBeNull();
  fireEvent.click(screen.getByRole("button", { name: "关闭应用" }));
  expect(screen.queryByRole("dialog")).toBeNull();
  fireEvent.click(icons().getByRole("button", { name: "壁纸" }));
  const choices = screen.getAllByRole("radio");
  expect(choices[0].getAttribute("aria-checked")).toBe("true");
  fireEvent.keyDown(choices[0], { key: "ArrowRight" });
  expect(choices[1].getAttribute("aria-checked")).toBe("true");
  expect(document.activeElement).toBe(choices[1]);
});

it("手机壁纸和选择预览使用独立竖图，切电脑时同一选择切回横图", () => {
  mount();
  expect(screen.getByTestId("wallpaper").dataset.image).toContain("yugc-phone.webp");
  fireEvent.click(icons().getByRole("button", { name: "壁纸" }));
  const choices = screen.getAllByRole("radio");
  expect(choices[0].querySelector("img")?.getAttribute("src")).toContain("yugc-phone-thumb.webp");
  fireEvent.click(choices[1]);
  expect(screen.getByTestId("wallpaper").dataset.image).toContain("geek-phone.webp");
  fireEvent.click(screen.getByRole("button", { name: "关闭对话框" }));
  act(() => { phone = false; changes.forEach((fn) => fn()); });
  expect(screen.getByTestId("wallpaper").dataset.image).toContain("/geek.webp");
  expect(localStorage.getItem("yugc:wallpaper")).toBe("geek");
});

it("主屏空白处下滑搜索，横滑、多指、取消和应用内手势不触发", () => {
  const { container } = mount();
  const main = container.querySelector<HTMLElement>(".pt-dt")!;
  const swipe = (target: HTMLElement, dx = 0, fingers = 1) => {
    fireEvent.touchStart(target, { touches: Array.from({ length: fingers }, () => ({ clientX: 100, clientY: 120 })) });
    fireEvent.touchEnd(target, { touches: [], changedTouches: [{ clientX: 100 + dx, clientY: 220 }] });
  };
  swipe(main, 100);
  swipe(main, 0, 2);
  fireEvent.touchStart(main, { touches: [{ clientX: 100, clientY: 120 }] });
  fireEvent.touchCancel(main);
  fireEvent.touchEnd(main, { touches: [], changedTouches: [{ clientX: 100, clientY: 220 }] });
  expect(screen.queryByRole("combobox")).toBeNull();
  swipe(main);
  expect(screen.getByRole("combobox")).not.toBeNull();
  fireEvent.click(screen.getByRole("button", { name: "关闭对话框" }));
  expect(document.activeElement).toBe(screen.getByRole("button", { name: "搜索", exact: true }));
  main.scrollTop = 60;
  swipe(main);
  expect(screen.queryByRole("combobox")).toBeNull();
  main.scrollTop = 0;
  fireEvent.click(icons().getByRole("button", { name: "终端" }));
  swipe(screen.getByRole("textbox", { name: "终端输入" }));
  expect(screen.queryByRole("combobox")).toBeNull();
  expect(screen.queryByRole("button", { name: "搜索", exact: true })).toBeNull();
});

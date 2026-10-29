// @vitest-environment jsdom
import { readFileSync } from "node:fs";
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { AppLink } from "../../app/web/sites/portal/lib/osApps";
import { links } from "../../app/web/sites/portal/lib/links";
import { PHONE_QUERY } from "../../app/web/sites/portal/lib/useMediaQuery";

const followed = vi.hoisted(() => ({ calls: [] as AppLink[] }));
vi.mock("../../app/web/sites/portal/lib/osApps", async (original) => ({
  ...(await original<typeof import("../../app/web/sites/portal/lib/osApps")>()),
  followAppLink: (link: AppLink) => followed.calls.push(link),
}));
vi.mock("../../app/web/sites/portal/components/os/Wallpaper", () => ({
  default: ({ wallpaper }: { wallpaper: { id: string; image?: string } }) => <div data-testid="wallpaper" data-id={wallpaper.id} data-image={wallpaper.image} />,
}));
// jsdom 没有 canvas：壁纸面板里「晴空」的缩略图换成空元素
vi.mock("../../app/web/sites/portal/components/os/SkyWallpaper", () => ({ SkyThumb: () => <canvas /> }));
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
  const onReplayBoot = vi.fn();
  return { ...render(<MemoryRouter><YugcOs onReplayBoot={onReplayBoot} /></MemoryRouter>), onReplayBoot };
}

it("手机有状态栏、应用和四项 Dock，没有电脑菜单和默认大便签；指引按需打开，设置里能重播开机动画", async () => {
  const { container, onReplayBoot } = mount();
  // 访客右上角和电脑菜单栏一样只有头像（SPEC §4.3），点开是「登录极客班」窗口（#280 起和其他应用一样从底部升起）：登录、注册和一句说明，不直接跳走
  const entry = await screen.findByRole("button", { name: "登录或注册" });
  expect(entry.textContent).toBe("");
  fireEvent.click(entry);
  const card = screen.getByRole("dialog", { name: "登录极客班" });
  expect(card.className).toContain("pt-win");
  expect(within(card).getByRole("link", { name: "登录" }).getAttribute("href")).toBe(`/signin?return_to=${encodeURIComponent("/")}`);
  expect(within(card).getByRole("link", { name: "注册" })).toBeTruthy();
  expect(within(card).getByText("注册不需要邀请码，有邀请码可以直接成为成员")).toBeTruthy();
  fireEvent.click(within(card).getByRole("button", { name: "关闭应用" }));
  expect(screen.queryByRole("dialog", { name: "登录极客班" })).toBeNull();
  expect(screen.queryByText(/GitHub 登录/)).toBeNull();
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
  fireEvent.click(screen.getByRole("button", { name: "重播开机动画", exact: true }));
  expect(onReplayBoot).toHaveBeenCalledOnce();
  expect(screen.queryByRole("dialog", { name: "系统设置" })).toBeNull();
});

it.each([null, false, true])("手机控制台沿用 console_link=%s，图标、搜索、终端都一致", async (consoleLink) => {
  vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify(
    consoleLink === null ? { signed_in: false } : { signed_in: true, login: "test-member", user_id: 1, console_link: consoleLink },
  ), { status: 200, headers: { "content-type": "application/json" } })));
  mount();
  if (consoleLink === null) await screen.findByRole("button", { name: "登录或注册" });
  else await screen.findByRole("button", { name: "账号：test-member" });
  expect(icons().queryByRole("button", { name: "控制台" }) !== null).toBe(consoleLink === true);
  fireEvent.click(screen.getByRole("button", { name: "搜索", exact: true }));
  fireEvent.change(screen.getByRole("combobox"), { target: { value: "控制台" } });
  expect(screen.queryByRole("option", { name: /控制台/ }) !== null).toBe(consoleLink === true);
  fireEvent.click(screen.getByRole("button", { name: "关闭对话框" }));
  fireEvent.click(icons().getByRole("button", { name: "终端" }));
  const input = await screen.findByRole("textbox", { name: "终端输入" });
  fireEvent.change(input, { target: { value: "ls ~/Desktop" } });
  fireEvent.keyDown(input, { key: "Enter" });
  const listed = document.querySelector(".pt-term-out")?.textContent ?? "";
  expect(listed).toContain("forum.app");
  expect(listed.includes("console.app")).toBe(consoleLink === true);
});

it("手机单击直达，双击事件不重复打开；论坛和代码仓库都在当前页直达，不开窗口（#311）", () => {
  mount();
  fireEvent.click(icons().getByRole("button", { name: "论坛" }));
  expect(followed.calls).toEqual([{ href: "http://127.0.0.1:3456/", newTab: false }]);
  fireEvent.click(icons().getByRole("button", { name: "代码仓库" }));
  fireEvent.doubleClick(icons().getByRole("button", { name: "代码仓库" }));
  expect(followed.calls).toEqual([
    { href: "http://127.0.0.1:3456/", newTab: false },
    { href: links.gitlab(), newTab: false },
  ]);
  expect(screen.queryAllByRole("dialog")).toHaveLength(0);
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
  const input = await screen.findByRole("textbox", { name: "终端输入" });
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
  expect((await screen.findByRole("textbox", { name: "终端输入" }) as HTMLInputElement).value).toBe("");
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

it("默认「晴空」；手机上图片壁纸和选择预览使用独立竖图，切电脑时同一选择切回横图", () => {
  mount();
  expect(screen.getByTestId("wallpaper").dataset.id).toBe("sky");
  fireEvent.click(icons().getByRole("button", { name: "壁纸" }));
  const choices = screen.getAllByRole("radio");
  expect(choices.map((choice) => choice.textContent)).toEqual(["晴空", "极客娘 1", "极客娘 2"]);
  // 竖屏面板（is-tall）里三张缩略图一样是竖图：「晴空」的画布和图片走同一条比例规则（styles/os.css）
  expect(screen.getByRole("dialog", { name: "更换壁纸" }).classList.contains("is-tall")).toBe(true);
  expect(choices[0].querySelector("canvas")).not.toBeNull();
  expect(choices[1].querySelector("img")?.getAttribute("src")).toContain("yugc-phone-thumb.webp");
  fireEvent.click(choices[2]);
  expect(screen.getByTestId("wallpaper").dataset.image).toContain("geek-phone.webp");
  fireEvent.click(screen.getByRole("button", { name: "关闭对话框" }));
  act(() => { phone = false; changes.forEach((fn) => fn()); });
  expect(screen.getByTestId("wallpaper").dataset.image).toContain("/geek.webp");
  expect(localStorage.getItem("yugc:wallpaper")).toBe("geek");
});

it("主屏空白处下滑搜索，横滑、多指、取消和应用内手势不触发", async () => {
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
  swipe(await screen.findByRole("textbox", { name: "终端输入" }));
  expect(screen.queryByRole("combobox")).toBeNull();
  expect(screen.queryByRole("button", { name: "搜索", exact: true })).toBeNull();
});

it("手机窗口呈 iOS Page Sheet 范式：渲染拖拽条、遮罩背景，点击遮罩或下滑可关闭窗口", async () => {
  const { container } = mount();
  fireEvent.click(icons().getByRole("button", { name: "关于极客班" }));
  expect(screen.getByRole("dialog", { name: "关于极客班" })).not.toBeNull();
  expect(container.querySelector(".pt-win-grabber")).not.toBeNull();
  const backdrop = container.querySelector<HTMLElement>(".pt-win-backdrop");
  expect(backdrop).not.toBeNull();

  // 点击遮罩关闭窗口
  fireEvent.click(backdrop!);
  expect(screen.queryByRole("dialog")).toBeNull();

  // 重新打开窗口，测试下滑手势关闭
  fireEvent.click(icons().getByRole("button", { name: "关于极客班" }));
  expect(screen.getByRole("dialog", { name: "关于极客班" })).not.toBeNull();
  const grabberWrap = container.querySelector<HTMLElement>(".pt-win-grabber-wrap")!;
  expect(grabberWrap).not.toBeNull();

  // 下滑小于阈值不关闭
  fireEvent.touchStart(grabberWrap, { touches: [{ clientY: 100 }] });
  fireEvent.touchMove(grabberWrap, { touches: [{ clientY: 130 }] });
  fireEvent.touchEnd(grabberWrap);
  expect(screen.getByRole("dialog", { name: "关于极客班" })).not.toBeNull();

  // 下滑超过阈值触发关闭
  fireEvent.touchStart(grabberWrap, { touches: [{ clientY: 100 }] });
  fireEvent.touchMove(grabberWrap, { touches: [{ clientY: 200 }] });
  fireEvent.touchEnd(grabberWrap);
  await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
});

it("电脑模式下窗口不渲染手机拖拽条与遮罩背景，保留 macOS 窗口控制", () => {
  const { container } = mount();
  act(() => { phone = false; changes.forEach((fn) => fn()); });
  const desktopIcons = within(screen.getByRole("list", { name: "桌面上的应用" }));
  fireEvent.doubleClick(desktopIcons.getByRole("button", { name: "关于极客班" }));
  expect(screen.getByRole("dialog", { name: "关于极客班" })).not.toBeNull();
  expect(container.querySelector(".pt-win-grabber")).toBeNull();
  expect(container.querySelector(".pt-win-backdrop")).toBeNull();
  expect(container.querySelector(".pt-win-lights")).not.toBeNull();
  fireEvent.click(within(screen.getByRole("dialog", { name: "关于极客班" })).getByRole("button", { name: "关闭" }));
  expect(screen.queryByRole("dialog")).toBeNull();
});

it("壁纸面板的缩略图：每张同一个比例，竖屏是手机屏幕的竖图，手机上一行排开，不再有只管图片、不管画布的比例规则", () => {
  const css = readFileSync(`${process.cwd()}/app/web/sites/portal/styles/os.css`, "utf8").replace(/\/\*[\s\S]*?\*\//g, "");
  expect(css).toMatch(/\.pt-picker-box img, \.pt-picker-box canvas \{[^}]*aspect-ratio: 16 \/ 9;/);
  expect(css).toMatch(/\.pt-picker-modal\.is-tall \.pt-picker-box img, \.pt-picker-modal\.is-tall \.pt-picker-box canvas \{ aspect-ratio: 9 \/ 19\.5; \}/);
  expect(css).toMatch(/\.pt-os-modal\.is-phone \.pt-picker-box ul \{ grid-template-columns: repeat\(auto-fit, minmax\(88px, 1fr\)\);/);
  expect(css).not.toMatch(/\.pt-picker-box img \{[^}]*aspect-ratio: auto/);
});

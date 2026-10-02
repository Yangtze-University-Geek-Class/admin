// @vitest-environment jsdom
// 桌面入口一跳直达（#185）：论坛、GitHub 组织的每个入口（桌面图标、Dock、2/3 键、菜单栏「前往」、⌘K、便签两条、终端）
// 都当场打开 osApps 给的地址，不经过 /forum-3d、/github 场景页；「加入我们」照旧飞图标再进 /join-us。
// jsdom 改不了 window.location.assign，所以把 osApps 的 followAppLink 换成记录调用的假函数，地址仍由真的 appLink 算。
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
// react-router-dom 只装在 app/web 里，vitest.config.ts 给它设了别名，和桌面用的是同一份
import { MemoryRouter, Route, Routes, useLocation } from "react-router-dom";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { AppLink } from "../../app/web/sites/portal/lib/osApps";

const followed = vi.hoisted(() => ({ calls: [] as AppLink[] }));
vi.mock("../../app/web/sites/portal/lib/osApps", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../app/web/sites/portal/lib/osApps")>();
  return { ...actual, followAppLink: (link: AppLink) => followed.calls.push(link) };
});
// 壁纸图层、宣传片播放层与本用例无关，换成空组件；壁纸不预取
vi.mock("../../app/web/sites/portal/components/os/Wallpaper", () => ({ default: () => null }));
vi.mock("../../app/web/sites/portal/components/PromoLazy", () => ({ LazyPromoPlayer: () => null }));
vi.mock("../../app/web/sites/portal/lib/wallpapers", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../app/web/sites/portal/lib/wallpapers")>()),
  prefetchWallpapersWhenIdle: () => () => undefined,
}));

import YugcOs from "../../app/web/sites/portal/components/os/YugcOs";
import { RESUME_DESKTOP, links, wantsDesktop } from "../../app/web/sites/portal/lib/links";

const FORUM = { href: links.forumHome(), newTab: false };
const GITHUB = { href: "https://github.com/Yangtze-University-Geek-Class", newTab: true };

let reducedMotion = false;

beforeEach(() => {
  followed.calls = [];
  reducedMotion = false;
  // 已经看过宣传片：桌面不去预取播放器分包
  document.cookie = "yugc_promo_seen=1; Path=/";
  vi.stubGlobal("matchMedia", (query: string) => ({ matches: reducedMotion && query.includes("reduce"), media: query, addEventListener() {}, removeEventListener() {} }));
  vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ signed_in: false }), { status: 200, headers: { "content-type": "application/json" } })));
});
afterEach(() => {
  // 先卸掉桌面再撤桩：/auth/me 的回答晚到时还会再渲染一次，要用到 matchMedia
  cleanup();
  vi.unstubAllGlobals();
  sessionStorage.clear();
});

function Where() {
  const location = useLocation();
  return (
    <>
      <output data-testid="where">{location.pathname}</output>
      <output data-testid="state">{JSON.stringify(location.state ?? null)}</output>
    </>
  );
}

function renderDesktop() {
  const view = render(
    <MemoryRouter initialEntries={["/"]}>
      <Routes>
        <Route path="/" element={<YugcOs active onBack={() => undefined} />} />
        <Route path="*" element={null} />
      </Routes>
      <Where />
    </MemoryRouter>,
  );
  const where = () => screen.getByTestId("where").textContent;
  const state = () => JSON.parse(screen.getByTestId("state").textContent ?? "null") as unknown;
  return { ...view, where, state };
}

const dock = () => within(screen.getByRole("navigation", { name: "Dock" }));

it("Dock、桌面图标、便签：论坛当前标签页直达论坛首页，GitHub 组织新标签页打开，点下去当场打开、路由不动", () => {
  const { container, where } = renderDesktop();
  fireEvent.click(dock().getByRole("button", { name: "论坛" }));
  expect(followed.calls).toEqual([FORUM]);
  fireEvent.click(dock().getByRole("button", { name: "GitHub 组织（新标签页打开）" }));
  expect(followed.calls).toEqual([FORUM, GITHUB]);

  // 桌面图标：鼠标单击只选中，双击打开
  const icon = (id: string) => container.querySelector<HTMLElement>(`.pt-icons [data-cta="${id}"]`)!;
  fireEvent.click(icon("forum"));
  expect(followed.calls).toHaveLength(2);
  fireEvent.doubleClick(icon("forum"));
  fireEvent.doubleClick(icon("github"));
  expect(followed.calls.slice(2)).toEqual([FORUM, GITHUB]);

  fireEvent.click(screen.getByRole("button", { name: /去「论坛」看看/ }));
  fireEvent.click(screen.getByRole("button", { name: /去「GitHub 组织」/ }));
  expect(followed.calls.slice(4)).toEqual([FORUM, GITHUB]);

  // 没有图标飞行，也没有进场景页
  expect(container.querySelector(".pt-flight")).toBeNull();
  expect(where()).toBe("/");
});

it("2、3 键与菜单栏「前往」同样直达", () => {
  const { where } = renderDesktop();
  fireEvent.keyDown(document.body, { key: "2" });
  fireEvent.keyDown(document.body, { key: "3" });
  expect(followed.calls).toEqual([FORUM, GITHUB]);

  fireEvent.click(screen.getByRole("button", { name: "前往" }));
  fireEvent.click(screen.getByRole("menuitem", { name: "论坛 2" }));
  fireEvent.click(screen.getByRole("button", { name: "前往" }));
  fireEvent.click(screen.getByRole("menuitem", { name: /^GitHub 组织\s*（新标签页打开）\s*3$/ }));
  expect(followed.calls.slice(2)).toEqual([FORUM, GITHUB]);
  expect(where()).toBe("/");
});

it("⌘K 启动器：搜「论坛」「首页」「github」回车直达；不再有重复的「进入论坛首页」命令", () => {
  const { where } = renderDesktop();
  const search = (text: string) => {
    fireEvent.click(screen.getByRole("button", { name: /搜索/ }));
    const input = screen.getByRole("combobox");
    fireEvent.change(input, { target: { value: text } });
    return input;
  };
  let input = search("论坛");
  expect(screen.queryByText("进入论坛首页")).toBeNull();
  fireEvent.keyDown(input, { key: "Enter" });
  input = search("首页");
  fireEvent.keyDown(input, { key: "Enter" });
  input = search("github");
  fireEvent.keyDown(input, { key: "Enter" });
  expect(followed.calls).toEqual([FORUM, FORUM, GITHUB]);
  expect(where()).toBe("/");
});

it("终端 open forum / open github 同样直达", async () => {
  // jsdom 没有 scrollTo（终端每多一行滚到底）
  Element.prototype.scrollTo ??= () => undefined;
  const { where } = renderDesktop();
  fireEvent.click(dock().getByRole("button", { name: "终端" }));
  const input = screen.getByRole("textbox", { name: "终端输入" });
  for (const command of ["open forum", "open github"]) {
    fireEvent.change(input, { target: { value: command } });
    fireEvent.keyDown(input, { key: "Enter" });
  }
  await waitFor(() => expect(followed.calls).toEqual([FORUM, GITHUB]));
  expect(where()).toBe("/");
});

it("「加入我们」不变：图标飞行后进 /join-us；减少动态效果时直接进", async () => {
  vi.useFakeTimers();
  try {
    const first = renderDesktop();
    fireEvent.click(dock().getByRole("button", { name: "加入我们" }));
    expect(first.container.querySelector(".pt-flight")).not.toBeNull();
    expect(first.where()).toBe("/");
    await act(async () => {
      vi.advanceTimersByTime(520);
    });
    expect(first.where()).toBe("/join-us");
    first.unmount();

    reducedMotion = true;
    const second = renderDesktop();
    fireEvent.click(dock().getByRole("button", { name: "加入我们" }));
    expect(second.where()).toBe("/join-us");
    expect(followed.calls).toEqual([]);
  } finally {
    vi.useRealTimers();
  }
});

it("按住不放的自动重复不算再按一次：按住 3、在图标或 Dock、便签按钮上按住回车，GitHub 组织只开一个新标签页（审查 F1）", () => {
  const { container } = renderDesktop();
  fireEvent.keyDown(document.body, { key: "3" });
  for (let i = 0; i < 4; i += 1) fireEvent.keyDown(document.body, { key: "3", repeat: true });
  expect(followed.calls).toEqual([GITHUB]);

  // 桌面图标自己处理回车：只有按下去的那一次打开
  const icon = container.querySelector<HTMLElement>('.pt-icons [data-cta="github"]')!;
  fireEvent.keyDown(icon, { key: "Enter" });
  fireEvent.keyDown(icon, { key: "Enter", repeat: true });
  fireEvent.keyDown(icon, { key: "Enter", repeat: true });
  expect(followed.calls).toEqual([GITHUB, GITHUB]);

  // Dock、便签、菜单上的按钮由浏览器把回车变成点击：按下去的那一次照常（不拦默认动作），
  // 自动重复的回车拦掉默认动作，浏览器就不会再补一次点击（fireEvent 返回 false 表示默认动作被拦）
  for (const button of [dock().getByRole("button", { name: /GitHub 组织/ }), screen.getByRole("button", { name: /去「GitHub 组织」/ })]) {
    expect(fireEvent.keyDown(button, { key: "Enter" })).toBe(true);
    expect(fireEvent.keyDown(button, { key: "Enter", repeat: true })).toBe(false);
  }
  expect(followed.calls).toHaveLength(2);
});

it("当前标签页去论坛前，在这条历史记录上记下「回来直接进桌面」；GitHub 组织开新标签页不记；从往返缓存恢复时清掉（审查 S1）", () => {
  const { state, where } = renderDesktop();
  fireEvent.click(dock().getByRole("button", { name: /GitHub 组织/ }));
  expect(state()).toBeNull();
  fireEvent.click(dock().getByRole("button", { name: "论坛" }));
  expect(followed.calls).toEqual([GITHUB, FORUM]);
  expect(state()).toEqual(RESUME_DESKTOP);
  expect(where()).toBe("/");

  // 浏览器没用往返缓存时，后退会重新加载首页，Home 用 wantsDesktop 读到这个 state 就直接进桌面（状态机的 resume 见 portal-desk.test.ts）；
  // 用了往返缓存时桌面原样还在，把 state 清掉，之后刷新照常从书桌开始
  expect(wantsDesktop(state())).toBe(true);
  act(() => {
    window.dispatchEvent(new PageTransitionEvent("pageshow", { persisted: false }));
  });
  expect(state()).toEqual(RESUME_DESKTOP);
  act(() => {
    window.dispatchEvent(new PageTransitionEvent("pageshow", { persisted: true }));
  });
  expect(state()).toBeNull();
});

it("「论坛最新」窗口：写明的「3D 版块」进 /forum-3d 场景页，「进入论坛首页」直达论坛首页（审查 S3）", async () => {
  const snapshot = { summary: { capturedAt: "2026-10-01", topics: 3, posts: 9, users: 2, categories: [] }, latest: [] };
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string) => new Response(JSON.stringify(String(url).includes("forum-latest") ? snapshot : { signed_in: false }), { status: 200, headers: { "content-type": "application/json" } })),
  );
  const { where } = renderDesktop();
  fireEvent.click(screen.getByRole("button", { name: /搜索/ }));
  const input = screen.getByRole("combobox");
  fireEvent.change(input, { target: { value: "论坛最新" } });
  fireEvent.keyDown(input, { key: "Enter" });
  const scene = await screen.findByRole("link", { name: /3D 版块/ });
  expect(screen.getByRole("link", { name: /进入论坛首页/ }).getAttribute("href")).toBe(links.forumHome());
  fireEvent.click(scene);
  expect(where()).toBe("/forum-3d");
  expect(followed.calls).toEqual([]);
});

it("会在新标签页打开的 GitHub 组织，给读屏补一句「新标签页打开」，界面上不显示；论坛不加（审查 S4）", () => {
  renderDesktop();
  dock().getByRole("button", { name: "GitHub 组织（新标签页打开）" });
  dock().getByRole("button", { name: "论坛" });
  const icons = within(screen.getByRole("list", { name: "桌面上的应用" }));
  icons.getByRole("button", { name: /^GitHub 组织\s*（新标签页打开）$/ });
  icons.getByRole("button", { name: "论坛" });
  screen.getByRole("button", { name: /^3\s*去「GitHub 组织」看我们的代码.*（新标签页打开）$/ });

  fireEvent.click(screen.getByRole("button", { name: "前往" }));
  screen.getByRole("menuitem", { name: /^GitHub 组织\s*（新标签页打开）\s*3$/ });
  screen.getByRole("menuitem", { name: /^论坛\s*2$/ });
  fireEvent.keyDown(document.body, { key: "Escape" });

  fireEvent.click(screen.getByRole("button", { name: /搜索/ }));
  fireEvent.change(screen.getByRole("combobox"), { target: { value: "github" } });
  screen.getByRole("option", { name: /^GitHub 组织\s*（新标签页打开）/ });

  // 补的这句只给读屏：Dock 写在 aria-label 里，其余放在视觉上隐藏的 .pt-sr 里（这时开着的是桌面图标、便签、启动器结果三处）
  const notes = [...document.querySelectorAll(".pt-sr")].filter((node) => node.textContent?.includes("新标签页"));
  expect(notes).toHaveLength(3);
  for (const node of notes) expect(node.textContent).toBe("（新标签页打开）");
});

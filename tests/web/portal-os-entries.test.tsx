// @vitest-environment jsdom
// 桌面入口一跳直达（#185）：论坛的每个入口（桌面图标、Dock、2 键、菜单栏「前往」、⌘K、便签、终端）都当场打开 osApps 给的地址，
// 不经过 /forum-3d 场景页；「代码仓库」（#275）的同一批入口在桌面上开窗口，不离开官网；GitHub 组织应用已经删掉；
// 「加入我们」（#279）也在桌面上开窗口，旧地址 /join-us、/apply 跳到 /?open=join。
// jsdom 改不了 window.location.assign，所以把 osApps 的 followAppLink 换成记录调用的假函数，地址仍由真的 appLink 算。
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
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

// 旧地址跳转的用例只看 App 的路由表，首页换成显示当前地址的桩，不播开机动画
vi.mock("../../app/web/sites/portal/pages/Home", async () => {
  const { useLocation: useWhere } = await import("react-router-dom");
  return { default: () => <output data-testid="home-at">{`${useWhere().pathname}${useWhere().search}`}</output> };
});

import App from "../../app/web/sites/portal/App";
import YugcOs from "../../app/web/sites/portal/components/os/YugcOs";
import { links } from "../../app/web/sites/portal/lib/links";

const FORUM = { href: links.forumHome(), newTab: false };
const REPOS = { href: links.gitlab(), newTab: false };

let reducedMotion = false;

beforeEach(() => {
  followed.calls = [];
  reducedMotion = false;
  // 已经看过宣传片：桌面不去预取播放器分包
  document.cookie = "yugc_promo_seen=1; Path=/";
  HTMLDialogElement.prototype.showModal = function () { this.setAttribute("open", ""); };
  HTMLDialogElement.prototype.close = function () { this.removeAttribute("open"); };
  vi.stubGlobal("matchMedia", (query: string) => ({ matches: reducedMotion && query.includes("reduce"), media: query, addEventListener() {}, removeEventListener() {} }));
  vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ signed_in: false }), { status: 200, headers: { "content-type": "application/json" } })));
});
afterEach(() => {
  // 先卸掉桌面再撤桩：/auth/me 的回答晚到时还会再渲染一次，要用到 matchMedia
  cleanup();
  vi.unstubAllGlobals();
  sessionStorage.clear();
  // 点过便签的步骤就记下「看过」（lib/startNote.ts），不清掉的话后面的用例里便签不再出现
  localStorage.clear();
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
        <Route path="/" element={<YugcOs />} />
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

/** 意见箱窗口要读的几个接口：分类和发往的组织、公开意见、站点配置 */
function stubFeedbackApi() {
  localStorage.setItem("yugc:dev-data-source", "live");
  vi.stubGlobal("fetch", vi.fn(async (url: string) => {
    const body = url.startsWith("/api/feedback/categories") ? { categories: ["建议", "Bug"], pow_difficulty: 0, org: "geek" }
      : url.startsWith("/api/feedback/public") ? { items: [] }
        : url === "/api/public/config" ? { turnstile_site_key: null, pow_difficulty: 0 }
          : { signed_in: false };
    return new Response(JSON.stringify(body), { status: 200, headers: { "content-type": "application/json" } });
  }));
}

it("Dock、桌面图标、便签：论坛当前标签页直达论坛首页，点下去当场打开、路由不动；GitHub 组织应用没有了", () => {
  const { container, where } = renderDesktop();
  fireEvent.click(dock().getByRole("button", { name: "论坛" }));
  expect(followed.calls).toEqual([FORUM]);

  // 桌面图标：鼠标单击只选中，双击打开
  const icon = (id: string) => container.querySelector<HTMLElement>(`.pt-icons [data-cta="${id}"]`);
  fireEvent.click(icon("forum")!);
  expect(followed.calls).toHaveLength(1);
  fireEvent.doubleClick(icon("forum")!);
  expect(followed.calls).toEqual([FORUM, FORUM]);

  fireEvent.click(screen.getByRole("button", { name: /去「论坛」看看/ }));
  expect(followed.calls).toEqual([FORUM, FORUM, FORUM]);

  expect(icon("github")).toBeNull();
  expect(dock().queryByRole("button", { name: /GitHub/ })).toBeNull();
  expect(screen.queryByRole("button", { name: /去「GitHub 组织」/ })).toBeNull();
  // 没有进场景页
  expect(container.querySelector(".pt-scene")).toBeNull();
  expect(where()).toBe("/");
});

it("意见箱在桌面上开窗口（#275）：Dock、桌面图标、⌘K 都打开同一个窗口，路由不动", async () => {
  stubFeedbackApi();
  const { container, where } = renderDesktop();
  const boxes = () => screen.queryAllByRole("dialog", { name: "意见箱" });
  const entries: Array<[string, () => void]> = [
    ["Dock", () => fireEvent.click(dock().getByRole("button", { name: "意见箱" }))],
    ["桌面图标", () => fireEvent.doubleClick(container.querySelector<HTMLElement>('.pt-icons [data-cta="feedback"]')!)],
    ["⌘K", () => {
      fireEvent.click(screen.getByRole("button", { name: /搜索/ }));
      const input = screen.getByRole("combobox");
      fireEvent.change(input, { target: { value: "意见" } });
      fireEvent.keyDown(input, { key: "Enter" });
    }],
  ];
  for (const [name, open] of entries) {
    open();
    expect(boxes(), name).toHaveLength(1);
    const win = within(boxes()[0]);
    expect(await win.findByLabelText("想说什么"), name).toBeTruthy();
    expect(await win.findByRole("radio", { name: "Bug" }), name).toBeTruthy();
    expect((win.getByLabelText("发往的组织") as HTMLInputElement).value, name).toBe("geek");
    expect(where(), name).toBe("/");
    fireEvent.click(win.getByRole("button", { name: "关闭" }));
    expect(boxes(), name).toHaveLength(0);
  }
});

it("旧地址 /feedback、/feedback/:org 不再有单独的页面，跳到 /?open=feedback（#275）", () => {
  for (const path of ["/feedback", "/feedback/geek"]) {
    const view = render(
      <MemoryRouter initialEntries={[path]}>
        <App />
      </MemoryRouter>,
    );
    expect(screen.getByTestId("home-at").textContent, path).toBe("/?open=feedback");
    expect(document.querySelector(".pt-feedback"), path).toBeNull();
    view.unmount();
  }
});

it("/?open=feedback 进桌面就打开意见箱窗口，打开后把参数从地址里去掉，别的参数留着；不是窗口的应用不打开", async () => {
  stubFeedbackApi();
  function Search() {
    return <output data-testid="search">{useLocation().search}</output>;
  }
  const view = render(
    <MemoryRouter initialEntries={["/?open=feedback&__data=live"]}>
      <Routes>
        <Route path="/" element={<YugcOs />} />
      </Routes>
      <Search />
    </MemoryRouter>,
  );
  expect(screen.getAllByRole("dialog", { name: "意见箱" })).toHaveLength(1);
  expect(await screen.findByLabelText("想说什么")).toBeTruthy();
  await waitFor(() => expect(screen.getByTestId("search").textContent).toBe("?__data=live"));
  view.unmount();

  render(
    <MemoryRouter initialEntries={["/?open=forum"]}>
      <Routes>
        <Route path="/" element={<YugcOs />} />
      </Routes>
      <Search />
    </MemoryRouter>,
  );
  await waitFor(() => expect(screen.getByTestId("search").textContent).toBe(""));
  expect(screen.queryAllByRole("dialog")).toHaveLength(0);
});

it("代码仓库整页直达（#311）：Dock、桌面图标、3 键、菜单栏「前往」、便签、⌘K、终端都当场打开同一个地址，不开窗口", async () => {
  // jsdom 没有 scrollTo（终端每多一行滚到底）
  Element.prototype.scrollTo ??= () => undefined;
  const { container, where } = renderDesktop();
  const entries: Array<[string, () => void]> = [
    ["Dock", () => fireEvent.click(dock().getByRole("button", { name: "代码仓库" }))],
    ["桌面图标", () => fireEvent.doubleClick(container.querySelector<HTMLElement>('.pt-icons [data-cta="gitlab"]')!)],
    ["3 键", () => fireEvent.keyDown(document.body, { key: "3" })],
    ["菜单栏", () => {
      fireEvent.click(screen.getByRole("button", { name: "前往" }));
      fireEvent.click(screen.getByRole("menuitem", { name: /^代码仓库\s*3$/ }));
    }],
    ["便签", () => fireEvent.click(screen.getByRole("button", { name: /去「代码仓库」/ }))],
    ["⌘K", () => {
      fireEvent.click(screen.getByRole("button", { name: /搜索/ }));
      const input = screen.getByRole("combobox");
      fireEvent.change(input, { target: { value: "代码" } });
      fireEvent.keyDown(input, { key: "Enter" });
    }],
  ];
  for (const [name, open] of entries) {
    const before = followed.calls.length;
    open();
    expect(followed.calls.slice(before), name).toEqual([REPOS]);
  }
  expect(screen.queryAllByRole("dialog", { name: "代码仓库" })).toHaveLength(0);

  fireEvent.click(dock().getByRole("button", { name: "终端" }));
  const input = await screen.findByRole("textbox", { name: "终端输入" });
  fireEvent.change(input, { target: { value: "open gitlab" } });
  fireEvent.keyDown(input, { key: "Enter" });
  await waitFor(() => expect(followed.calls).toHaveLength(entries.length + 1));
  expect(followed.calls.at(-1)).toEqual(REPOS);
  expect(where()).toBe("/");
});

it("2 键与菜单栏「前往」的论坛同样直达", () => {
  const { where } = renderDesktop();
  fireEvent.keyDown(document.body, { key: "2" });
  fireEvent.click(screen.getByRole("button", { name: "前往" }));
  fireEvent.click(screen.getByRole("menuitem", { name: "论坛 2" }));
  expect(followed.calls).toEqual([FORUM, FORUM]);
  expect(screen.queryByRole("menuitem", { name: /GitHub/ })).toBeNull();
  expect(where()).toBe("/");
});

it("⌘K 启动器：搜「论坛」「首页」回车直达；不再有重复的「进入论坛首页」命令，也搜不到 GitHub 组织", () => {
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
  expect(followed.calls).toEqual([FORUM, FORUM]);
  input = search("github");
  expect(screen.queryByRole("option", { name: /GitHub/ })).toBeNull();
  fireEvent.keyDown(input, { key: "Enter" });
  expect(followed.calls).toEqual([FORUM, FORUM]);
  expect(where()).toBe("/");
});

it("终端 open forum 同样直达；open github 报没有这个应用", async () => {
  Element.prototype.scrollTo ??= () => undefined;
  const { where } = renderDesktop();
  fireEvent.click(dock().getByRole("button", { name: "终端" }));
  const input = await screen.findByRole("textbox", { name: "终端输入" });
  for (const command of ["open github", "open forum"]) {
    fireEvent.change(input, { target: { value: command } });
    fireEvent.keyDown(input, { key: "Enter" });
  }
  expect(screen.getByText(/open: 没有叫 github 的应用/)).toBeTruthy();
  await waitFor(() => expect(followed.calls).toEqual([FORUM]));
  expect(where()).toBe("/");
});

it("「加入我们」在桌面上开窗口（#279）：Dock、1 键都打开同一个窗口，路由不动；没登录时信纸上是「先注册再投递」", async () => {
  stubFeedbackApi();
  const { where } = renderDesktop();
  const boxes = () => screen.queryAllByRole("dialog", { name: "加入我们" });
  fireEvent.click(dock().getByRole("button", { name: "加入我们" }));
  expect(boxes()).toHaveLength(1);
  const win = within(boxes()[0]);
  expect(await win.findByRole("heading", { name: "先注册再投递" })).toBeTruthy();
  expect(win.getByRole("link", { name: /注册/ }).getAttribute("href")).toBe("/signin?return_to=%2F%3Fopen%3Djoin&tab=register");
  expect(where()).toBe("/");
  fireEvent.click(win.getByRole("button", { name: "关闭" }));
  expect(boxes()).toHaveLength(0);

  fireEvent.keyDown(document.body, { key: "1" });
  expect(boxes()).toHaveLength(1);
  expect(where()).toBe("/");
  expect(followed.calls).toEqual([]);
});

it("旧地址 /join-us、/apply 不再有单独的页面，跳到 /?open=join（#279）", () => {
  for (const path of ["/join-us", "/apply"]) {
    const view = render(
      <MemoryRouter initialEntries={[path]}>
        <App />
      </MemoryRouter>,
    );
    expect(screen.getByTestId("home-at").textContent, path).toBe("/?open=join");
    expect(document.querySelector(".pt-scene"), path).toBeNull();
    view.unmount();
  }
});

it("按住不放的自动重复不算再按一次：按住 2、在图标或 Dock、便签按钮上按住回车，论坛只跳一次（审查 F1）", () => {
  const { container } = renderDesktop();
  fireEvent.keyDown(document.body, { key: "2" });
  for (let i = 0; i < 4; i += 1) fireEvent.keyDown(document.body, { key: "2", repeat: true });
  expect(followed.calls).toEqual([FORUM]);

  // 桌面图标自己处理回车：只有按下去的那一次打开
  const icon = container.querySelector<HTMLElement>('.pt-icons [data-cta="forum"]')!;
  fireEvent.keyDown(icon, { key: "Enter" });
  fireEvent.keyDown(icon, { key: "Enter", repeat: true });
  fireEvent.keyDown(icon, { key: "Enter", repeat: true });
  expect(followed.calls).toEqual([FORUM, FORUM]);

  // Dock、便签、菜单上的按钮由浏览器把回车变成点击：按下去的那一次照常（不拦默认动作），
  // 自动重复的回车拦掉默认动作，浏览器就不会再补一次点击（fireEvent 返回 false 表示默认动作被拦）
  for (const button of [dock().getByRole("button", { name: "论坛" }), screen.getByRole("button", { name: /去「论坛」/ })]) {
    expect(fireEvent.keyDown(button, { key: "Enter" })).toBe(true);
    expect(fireEvent.keyDown(button, { key: "Enter", repeat: true })).toBe(false);
  }
  expect(followed.calls).toHaveLength(2);
});

it("当前标签页去论坛直接跳走，不在历史记录上记 state：桌面是首页的默认状态，回来按 yugc:boot-day 决定播不播开机动画（#275）", () => {
  const { state, where } = renderDesktop();
  fireEvent.click(dock().getByRole("button", { name: "论坛" }));
  expect(followed.calls).toEqual([FORUM]);
  expect(state()).toBeNull();
  expect(where()).toBe("/");
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

it("桌面上的入口都留在本页或当前标签页，不补「新标签页打开」；代码仓库也在当前标签页直达（#311）", () => {
  renderDesktop();
  dock().getByRole("button", { name: "代码仓库" });
  dock().getByRole("button", { name: "论坛" });
  const icons = within(screen.getByRole("list", { name: "桌面上的应用" }));
  icons.getByRole("button", { name: "代码仓库" });
  icons.getByRole("button", { name: "论坛" });
  screen.getByRole("button", { name: /^3\s*去「代码仓库」看我们的代码/ });
  fireEvent.click(screen.getByRole("button", { name: "前往" }));
  screen.getByRole("menuitem", { name: /^代码仓库\s*3$/ });
  screen.getByRole("menuitem", { name: /^论坛\s*2$/ });
  fireEvent.keyDown(document.body, { key: "Escape" });
  expect([...document.querySelectorAll(".pt-sr")].filter((node) => node.textContent?.includes("新标签页"))).toHaveLength(0);

  fireEvent.click(dock().getByRole("button", { name: "代码仓库" }));
  expect(followed.calls).toEqual([REPOS]);
  expect(screen.queryAllByRole("dialog", { name: "代码仓库" })).toHaveLength(0);
});

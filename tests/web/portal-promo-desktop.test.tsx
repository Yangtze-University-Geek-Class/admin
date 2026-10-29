// @vitest-environment jsdom
// 宣传片窗口在桌面里的表现（#284）：它是 YUGC OS 的一个普通窗口，开、关、最小化、恢复、层叠、手机上的底部面板都走桌面已有的窗口管理。
// 播放器本身（画面、自动播、静音重试、收起暂停）见 portal-promo-player.test.tsx，分包加载见 portal-promo-lazy / portal-promo-gate，
// 纯逻辑（要不要自动弹、窗口多大放哪、收起时对视频做什么）见 portal-promo-window.test.ts。
// 这里把播放器换成会记挂载、卸载次数和收到的 active 的桩，核对桌面对它做了什么：
// 关闭 = 卸载（真播放器卸载时停止播放并释放片源）；最小化 = 不卸载，只是 active 变 false，恢复时还是同一个播放器（接着原来的进度播）。
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { PROMO_COOKIE, hasSeenPromo } from "../../app/web/sites/portal/lib/promo";
import { PHONE_QUERY } from "../../app/web/sites/portal/lib/useMediaQuery";

type PlayerProps = { active?: boolean; onSeen?: () => void; onEnd: (reason: "ended" | "blocked" | "unsupported" | "failed") => void };
const player = vi.hoisted(() => ({ mounted: 0, unmounted: 0, props: null as unknown as PlayerProps }));
vi.mock("../../app/web/sites/portal/components/PromoLazy", async () => {
  const { useEffect } = await import("react");
  return {
    LazyPromoPlayer: (props: PlayerProps) => {
      player.props = props;
      useEffect(() => {
        player.mounted += 1;
        return () => {
          player.unmounted += 1;
        };
      }, []);
      return <div data-testid="promo-player" data-active={String(props.active ?? true)} />;
    },
  };
});
vi.mock("../../app/web/sites/portal/components/os/Wallpaper", () => ({ default: () => null }));
vi.mock("../../app/web/sites/portal/lib/wallpapers", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../app/web/sites/portal/lib/wallpapers")>()),
  prefetchWallpapersWhenIdle: () => () => undefined,
}));

import YugcOs from "../../app/web/sites/portal/components/os/YugcOs";

const env = { phone: false, reduced: false };
const json = (body: unknown) => new Response(JSON.stringify(body), { status: 200, headers: { "content-type": "application/json" } });
const signedIn = { signed_in: true, login: "newbie", account_id: "acc_1", level: "registered", permissions: ["apply.submit"], quota: { apply_left_today: 3, apply_daily_limit: 3 } };

beforeEach(() => {
  env.phone = false;
  env.reduced = false;
  player.mounted = 0;
  player.unmounted = 0;
  player.props = null as unknown as PlayerProps;
  document.cookie = `${PROMO_COOKIE}=; Max-Age=0; Path=/`;
  HTMLDialogElement.prototype.showModal = function () { this.setAttribute("open", ""); };
  HTMLDialogElement.prototype.close = function () { this.removeAttribute("open"); };
  Element.prototype.scrollTo ??= () => undefined;
  // 没看过宣传片时桌面空闲后会预取播放器分包：这里不需要
  vi.stubGlobal("requestIdleCallback", () => 0);
  vi.stubGlobal("matchMedia", (query: string) => ({
    get matches() {
      if (query === PHONE_QUERY || query === "(orientation: portrait)") return env.phone;
      return query === "(prefers-reduced-motion: reduce)" && env.reduced;
    },
    media: query,
    addEventListener() {},
    removeEventListener() {},
  }));
  vi.stubGlobal("fetch", vi.fn(async (url: string) => json(url === "/api/public/config" ? { turnstile_site_key: null, pow_difficulty: 1, apply_open: true } : url === "/auth/me" ? signedIn : { signed_in: false })));
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  sessionStorage.clear();
  localStorage.clear();
  document.cookie = `${PROMO_COOKIE}=; Max-Age=0; Path=/`;
});

const dock = () => within(screen.getByRole("navigation", { name: "Dock" }));
const promoWindow = () => screen.queryByRole("dialog", { name: "宣传片" });
/** 收起的窗口带着 hidden，读屏和 Testing Library 的角色查询都看不见它，也算不出名字：按属性找 */
const promoSection = () => document.querySelector<HTMLElement>('section[role="dialog"][aria-label="宣传片"]');
const seen = () => hasSeenPromo(document.cookie);
const control = (name: string) => within(screen.getByRole("dialog", { name: "宣传片" })).getByRole("button", { name });
const playerActive = () => screen.getByTestId("promo-player").getAttribute("data-active");

function mount(entry = "/") {
  return render(
    <MemoryRouter initialEntries={[entry]}>
      <Routes>
        <Route path="/" element={<YugcOs />} />
      </Routes>
    </MemoryRouter>,
  );
}
/** 播放器那边发生的事：真播放器在开始播放、播完时调这两个回调 */
function playerSays(run: (props: PlayerProps) => void) {
  act(() => run(player.props));
}
/** 「加入我们」窗口里的页面是按需加载的，等它挂上（宣传片窗口是页面挂上以后弹的） */
const joinPage = () => waitFor(() => expect(document.querySelector(".pt-joinbox")).not.toBeNull());

describe("宣传片是桌面里的一个窗口", () => {
  it("从 Dock 打开：标题「宣传片」，里面是播放器；再点一次只是带到最前面，不开第二个窗口、不重新挂播放器", () => {
    mount();
    expect(promoWindow()).toBeNull();
    fireEvent.click(dock().getByRole("button", { name: "宣传片" }));

    const win = screen.getByRole("dialog", { name: "宣传片" });
    expect(win.className).toContain("pt-win");
    expect(within(win).getByTestId("promo-player").getAttribute("data-active")).toBe("true");
    expect(player.mounted).toBe(1);

    fireEvent.click(dock().getByRole("button", { name: "宣传片" }));
    expect(screen.getAllByRole("dialog", { name: "宣传片" })).toHaveLength(1);
    expect(player.mounted).toBe(1);
    expect(player.unmounted).toBe(0);
  });

  it("关闭：窗口和里面的播放器一起卸掉（真播放器卸载时停止播放、释放片源），下次打开是新的播放器", () => {
    mount();
    fireEvent.click(dock().getByRole("button", { name: "宣传片" }));
    fireEvent.click(control("关闭"));

    expect(promoWindow()).toBeNull();
    expect(screen.queryByTestId("promo-player")).toBeNull();
    expect(player.unmounted).toBe(1);

    fireEvent.click(dock().getByRole("button", { name: "宣传片" }));
    expect(promoWindow()).not.toBeNull();
    expect(player.mounted).toBe(2);
  });

  it("最小化再恢复：收起时播放器还在（不卸载）但 active 为 false；Dock 里再点一下露出来，还是同一个播放器，active 回到 true", () => {
    mount();
    fireEvent.click(dock().getByRole("button", { name: "宣传片" }));
    expect(playerActive()).toBe("true");

    fireEvent.click(control("最小化"));
    expect(promoWindow()).toBeNull();
    expect(promoSection()?.hasAttribute("hidden")).toBe(true);
    expect(playerActive()).toBe("false");
    expect(player.unmounted).toBe(0);

    fireEvent.click(dock().getByRole("button", { name: "宣传片" }));
    expect(promoWindow()).not.toBeNull();
    expect(playerActive()).toBe("true");
    expect(player.mounted).toBe(1);
    expect(player.unmounted).toBe(0);
  });

  it("电脑上窗口并排，被别的窗口盖住不算收起：播放器照常 active", () => {
    mount();
    fireEvent.click(dock().getByRole("button", { name: "宣传片" }));
    fireEvent.click(dock().getByRole("button", { name: "关于极客班" }));
    expect(screen.getByRole("dialog", { name: "关于极客班" })).toBeTruthy();
    expect(playerActive()).toBe("true");
  });

  it("Esc 关掉最前面的窗口：宣传片在最前面时就是它", () => {
    mount();
    fireEvent.click(dock().getByRole("button", { name: "宣传片" }));
    fireEvent.keyDown(document.body, { key: "Escape" });
    expect(promoWindow()).toBeNull();
    expect(player.unmounted).toBe(1);
  });

  it("地址 ?open=promo 直接打开宣传片窗口；自己打开的不算自动弹出，关掉不写看过", async () => {
    mount("/?open=promo");
    expect(await screen.findByRole("dialog", { name: "宣传片" })).toBeTruthy();
    playerSays((props) => props.onSeen?.());
    fireEvent.click(control("关闭"));
    expect(seen()).toBe(false);
  });

  it("矮屏幕：窗口变窄、往上提，标题栏加 16:9 画面整个落在 Dock 上沿以上", () => {
    vi.stubGlobal("innerHeight", 600);
    mount();
    fireEvent.click(dock().getByRole("button", { name: "宣传片" }));
    const win = screen.getByRole("dialog", { name: "宣传片" });
    const width = parseFloat(win.style.width);
    const top = parseFloat(win.style.top);
    expect(width).toBeLessThan(860);
    expect(top).toBeGreaterThanOrEqual(44);
    expect(top + 44 + Math.round((width * 9) / 16)).toBeLessThanOrEqual(600 - 120);
  });
});

describe("第一次打开「加入我们」时自动弹出一次（#77、#122 的条件不变）", () => {
  it("没看过：弹出宣传片窗口，在最前面；信纸不用等它，窗口没有遮住整个页面", async () => {
    mount();
    fireEvent.click(dock().getByRole("button", { name: "加入我们" }));
    const promo = await screen.findByRole("dialog", { name: "宣传片" });

    expect(promo.className).toContain("is-front");
    const join = screen.getByRole("dialog", { name: "加入我们" });
    expect(join.hasAttribute("hidden")).toBe(false);
    expect(join.inert).toBe(false);
    expect(await within(join).findByRole("textbox", { name: "姓名" })).toBeTruthy();
    expect(player.mounted).toBe(1);
  });

  it("看过了：不弹；开了减少动态效果：不弹也不挂播放器，按看过算", async () => {
    document.cookie = `${PROMO_COOKIE}=1; Path=/`;
    const first = mount();
    fireEvent.click(dock().getByRole("button", { name: "加入我们" }));
    await joinPage();
    await act(async () => {});
    expect(promoWindow()).toBeNull();
    expect(player.mounted).toBe(0);
    first.unmount();

    document.cookie = `${PROMO_COOKIE}=; Max-Age=0; Path=/`;
    env.reduced = true;
    mount();
    fireEvent.click(dock().getByRole("button", { name: "加入我们" }));
    await waitFor(() => expect(seen()).toBe(true));
    expect(promoWindow()).toBeNull();
    expect(player.mounted).toBe(0);
  });

  it("开始播放才写看过：自动弹的那次 onSeen 写 cookie；自己点开重看的不写，也不影响之后「加入我们」是否自动弹", async () => {
    mount();
    fireEvent.click(dock().getByRole("button", { name: "宣传片" }));
    playerSays((props) => props.onSeen?.());
    expect(seen()).toBe(false);
    fireEvent.click(control("关闭"));
    expect(seen()).toBe(false);

    fireEvent.click(dock().getByRole("button", { name: "加入我们" }));
    expect(await screen.findByRole("dialog", { name: "宣传片" })).toBeTruthy();
    expect(seen()).toBe(false);
    playerSays((props) => props.onSeen?.());
    expect(seen()).toBe(true);
  });

  it("自动弹的那次，没等开始播放就自己关掉（加载慢时）也算看过", async () => {
    mount();
    fireEvent.click(dock().getByRole("button", { name: "加入我们" }));
    await screen.findByRole("dialog", { name: "宣传片" });
    expect(seen()).toBe(false);
    fireEvent.click(control("关闭"));
    expect(promoWindow()).toBeNull();
    expect(seen()).toBe(true);
  });

  it("加载失败（failed）的那次不算看过：窗口留着，关掉不写 cookie；下次打开「加入我们」再弹", async () => {
    mount();
    fireEvent.click(dock().getByRole("button", { name: "加入我们" }));
    await screen.findByRole("dialog", { name: "宣传片" });
    playerSays((props) => props.onEnd("failed"));
    expect(promoWindow()).not.toBeNull();
    fireEvent.click(control("关闭"));
    expect(promoWindow()).toBeNull();
    expect(seen()).toBe(false);

    fireEvent.click(within(screen.getByRole("dialog", { name: "加入我们" })).getByRole("button", { name: "关闭" }));
    expect(screen.queryByRole("dialog", { name: "加入我们" })).toBeNull();
    fireEvent.click(dock().getByRole("button", { name: "加入我们" }));
    expect(await screen.findByRole("dialog", { name: "宣传片" })).toBeTruthy();
  });

  it("播完（ended）窗口自己关；放不了、静音也不让播时窗口留着，画面上有说明或提示", async () => {
    mount();
    fireEvent.click(dock().getByRole("button", { name: "加入我们" }));
    await screen.findByRole("dialog", { name: "宣传片" });

    playerSays((props) => props.onEnd("blocked"));
    playerSays((props) => props.onEnd("unsupported"));
    expect(promoWindow()).not.toBeNull();

    playerSays((props) => {
      props.onSeen?.();
      props.onEnd("ended");
    });
    expect(promoWindow()).toBeNull();
    expect(player.unmounted).toBe(1);
    expect(seen()).toBe(true);
  });

  it("宣传片窗口已经是自己点开的：进「加入我们」只带到最前面，不改它是怎么开的，关掉不写看过", async () => {
    mount();
    fireEvent.click(dock().getByRole("button", { name: "宣传片" }));
    fireEvent.click(dock().getByRole("button", { name: "加入我们" }));
    await joinPage();
    await act(async () => {});
    expect(screen.getAllByRole("dialog", { name: "宣传片" })).toHaveLength(1);
    expect(player.mounted).toBe(1);
    fireEvent.click(control("关闭"));
    expect(seen()).toBe(false);
  });

  it("菜单栏「窗口 → 关闭全部」把自动弹出的宣传片一起关掉，同样算看过", async () => {
    mount();
    fireEvent.click(dock().getByRole("button", { name: "加入我们" }));
    await screen.findByRole("dialog", { name: "宣传片" });
    fireEvent.click(screen.getByRole("button", { name: "窗口" }));
    fireEvent.click(screen.getByRole("menuitem", { name: "关闭全部" }));
    expect(promoWindow()).toBeNull();
    expect(screen.queryByRole("dialog", { name: "加入我们" })).toBeNull();
    expect(seen()).toBe(true);
  });
});

describe("手机上", () => {
  const icons = () => within(screen.getByRole("list", { name: "主屏幕上的应用" }));
  const homeButton = () => dock().getByRole("button", { name: "返回主屏幕" });

  beforeEach(() => {
    env.phone = true;
  });

  it("宣传片是底部升起的面板；自动弹出盖在「加入我们」上面，关掉后露出下面的「加入我们」，不一起回主屏幕", async () => {
    mount();
    fireEvent.click(icons().getByRole("button", { name: "加入我们" }));
    const sheet = await screen.findByRole("dialog", { name: "宣传片" });
    expect(sheet.className).toContain("pt-win");
    // 面板盖在最上面，下面的「加入我们」藏起来（手机上一次只露一个窗口）
    expect(screen.queryByRole("dialog", { name: "加入我们" })).toBeNull();
    expect(playerActive()).toBe("true");

    fireEvent.click(within(sheet).getByRole("button", { name: "关闭应用" }));
    expect(promoWindow()).toBeNull();
    expect(screen.getByRole("dialog", { name: "加入我们" })).toBeTruthy();
    expect(player.unmounted).toBe(1);
    expect(seen()).toBe(true);
  });

  it("从主屏幕单独打开宣传片：返回主屏幕不卸载，播放器 active 为 false，再点图标露出来接着播；关掉回主屏幕", () => {
    mount();
    fireEvent.click(icons().getByRole("button", { name: "宣传片" }));
    expect(playerActive()).toBe("true");

    fireEvent.click(within(screen.getByRole("dialog", { name: "宣传片" })).getByRole("button", { name: "返回主屏幕" }));
    expect(promoWindow()).toBeNull();
    expect(playerActive()).toBe("false");
    expect(player.unmounted).toBe(0);

    fireEvent.click(icons().getByRole("button", { name: "宣传片" }));
    expect(promoWindow()).not.toBeNull();
    expect(playerActive()).toBe("true");
    expect(player.mounted).toBe(1);

    fireEvent.click(within(screen.getByRole("dialog", { name: "宣传片" })).getByRole("button", { name: "关闭应用" }));
    expect(promoWindow()).toBeNull();
    expect(screen.queryByRole("dialog", { name: "加入我们" })).toBeNull();
    expect(player.unmounted).toBe(1);
  });

  it("宣传片被别的窗口盖住时 active 为 false（手机上一次只露一个窗口）；回主屏幕再点它的图标，露出来变回 true", () => {
    document.cookie = `${PROMO_COOKIE}=1; Path=/`;
    mount();
    fireEvent.click(icons().getByRole("button", { name: "宣传片" }));
    // #311 之后 Dock 上能开窗口的只剩「加入我们」（论坛、代码仓库都当场跳走）；看过宣传片（cookie）时打开它不会再自动弹宣传片
    fireEvent.click(dock().getByRole("button", { name: "加入我们" }));
    expect(screen.getByRole("dialog", { name: "加入我们" })).toBeTruthy();
    expect(promoWindow()).toBeNull();
    expect(playerActive()).toBe("false");
    expect(player.unmounted).toBe(0);

    fireEvent.click(homeButton());
    fireEvent.click(icons().getByRole("button", { name: "宣传片" }));
    expect(promoWindow()).not.toBeNull();
    expect(playerActive()).toBe("true");
    expect(player.mounted).toBe(1);
  });
});

// 比赛窗口（#265）：桌面 1440×900 左边列表右边详情、筛选与搜索、键盘换比赛并 Tab 到官网链接；
// 手机 390×844 列表点进详情再返回、操作条贴在屏幕底部、触控目标不小于 44px、没有横向滚动。
// 数据是开发预览的比赛样板（app/web/shared/lib/mock-api.ts 的 demoCompetitions：五种状态、内部外部、有无官网），
// 截图存到各用例的输出目录，PR 里的改后截图就是这几张。
import { expect, test, type Locator, type Page } from "@playwright/test";
import { SLOW } from "../../playwright.config";

test.beforeEach(async ({ page, context }) => {
  await context.addCookies([{ name: "yugc_promo_seen", value: "1", url: "http://127.0.0.1:5179" }]);
  await page.route("**/*", route => {
    const url = new URL(route.request().url());
    if (url.hostname !== "127.0.0.1" && url.protocol !== "data:") return route.abort();
    if (url.pathname === "/auth/me") return route.fulfill({ json: { signed_in: false } });
    if (url.pathname.startsWith("/api/") || url.pathname.startsWith("/auth/")) return route.fulfill({ status: 503, json: { error: "unexpected_live_request_in_test" } });
    return route.continue();
  });
  // 不进 3D 书桌：没有 WebGL 时官网直接进 YUGC OS 桌面
  await page.addInitScript(() => {
    const original = HTMLCanvasElement.prototype.getContext;
    Object.defineProperty(HTMLCanvasElement.prototype, "getContext", { value: function (this: HTMLCanvasElement, type: string, ...args: unknown[]) {
      return type.startsWith("webgl") ? null : Reflect.apply(original, this, [type, ...args]);
    } });
  });
});

async function home(page: Page) {
  await page.goto("/sites/portal/");
  await expect(page.locator(".pt-home")).toHaveAttribute("data-state", "desktop", { timeout: 20_000 * SLOW });
  await expect(page.locator(".pt-os-shell")).toBeVisible();
}

/** 页面和窗口里几个滚动区都没有横向滚动。 */
async function noSideScroll(page: Page) {
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  const wide = await page.locator(".pt-cx, .pt-cx-bar, .pt-cx-list, .pt-cx-scroll, .pt-cx-act").evaluateAll(nodes =>
    nodes.filter(node => node.scrollWidth > node.clientWidth + 1).map(node => node.className));
  expect(wide).toEqual([]);
}

/** 触控目标不小于 44px。boundingBox 的坐标经 float32 换算，CI 上正好 44px 的筛选胶囊量出过 43.99998，所以留 0.01px 浮点误差。 */
async function atLeast44(controls: Locator) {
  for (const control of await controls.all()) {
    const box = (await control.boundingBox())!;
    expect(Math.min(box.width, box.height), await control.evaluate(node => node.outerHTML.slice(0, 80))).toBeGreaterThanOrEqual(44 - 0.01);
  }
}

test.describe("比赛窗口 #265", () => {
  test.setTimeout(60_000 * SLOW);

  test("桌面 1440×900：左边列表右边详情，筛选、搜索、键盘换比赛并 Tab 到官网链接", async ({ page }, testInfo) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await home(page);
    await page.locator('.pt-icons [data-cta="competitions"]').dblclick();
    const win = page.getByRole("dialog", { name: "比赛" });
    const list = win.getByRole("list", { name: "比赛列表" });
    const cards = list.getByRole("button");
    const heading = win.getByRole("heading", { level: 3 });
    await expect(cards).toHaveCount(7);
    await expect.poll(async () => (await win.boundingBox())?.width).toBe(1100);
    // 两栏并排：详情在列表右边
    const listBox = (await list.boundingBox())!;
    const detailBox = (await win.locator(".pt-cx-detail").boundingBox())!;
    expect(detailBox.x).toBeGreaterThanOrEqual(listBox.x + listBox.width - 1);
    expect(detailBox.width).toBeGreaterThan(listBox.width);
    // 数据到了焦点进窗口的搜索框；默认选中第一场，读屏能听到名称和状态
    await expect(win.getByRole("searchbox", { name: "搜索比赛" })).toBeFocused();
    await expect(cards.first()).toHaveAttribute("aria-current", "true");
    await expect(cards.first()).toHaveAccessibleName(/极客班 CTF 新生赛\s*，\s*进行中\s*，\s*内部/);
    await expect(heading).toHaveText("极客班 CTF 新生赛");
    await expect(win.getByRole("button", { name: /^全部/ })).toHaveAttribute("aria-pressed", "true");
    await expect(win.getByRole("button", { name: /^全部/ })).toContainText("7");
    await expect(win.getByRole("button", { name: /^可报名/ })).toContainText("3");
    await noSideScroll(page);
    await page.screenshot({ path: testInfo.outputPath("desktop-1440.png"), animations: "disabled" });

    await win.getByRole("button", { name: /^可报名/ }).click();
    await expect(cards).toHaveCount(3);
    await win.getByRole("button", { name: "外部", exact: true }).click();
    await expect(cards).toHaveCount(1);
    await expect(heading).toHaveText("CCPC 2026 哈尔滨站");
    // 桌面主按钮在 Hero 里；官网链接也收在 Hero 的标签里
    const go = win.locator(".pt-cx-hero .pt-btn");
    await expect(go).toHaveText(/去官网报名/);
    await expect(go).toHaveAttribute("href", "https://ccpc.io/");
    await expect(win.locator("a.pt-cx-hero-tag")).toHaveCount(1);
    await expect(go).toHaveAttribute("target", "_blank");
    await expect(go).toHaveAttribute("rel", "noopener noreferrer");
    await page.screenshot({ path: testInfo.outputPath("desktop-1440-ccpc.png"), animations: "disabled" });
    await win.getByRole("button", { name: /^全部/ }).click();
    await expect(cards).toHaveCount(7);

    const search = win.getByRole("searchbox", { name: "搜索比赛" });
    await search.fill("没有这场比赛");
    await expect(win.getByText("没有符合条件的比赛")).toBeVisible();
    await win.getByRole("button", { name: "清除筛选" }).click();
    await expect(cards).toHaveCount(7);
    await expect(search).toHaveValue("");

    // 键盘：Tab 进列表只停在选中那张，方向键换比赛，再 Tab 到详情里的官网链接和操作条按钮
    await cards.first().focus();
    for (let n = 0; n < 4; n++) await page.keyboard.press("ArrowDown");
    await expect(cards.nth(4)).toBeFocused();
    await expect(cards.nth(4)).toHaveAttribute("aria-current", "true");
    await expect(heading).toHaveText("CCPC 2026 哈尔滨站");
    await page.keyboard.press("Tab");
    await expect(win.getByRole("link", { name: /ccpc\.io/ })).toBeFocused();
    await page.keyboard.press("Tab");
    await expect(go).toBeFocused();
    await page.keyboard.press("Shift+Tab");
    await page.keyboard.press("Shift+Tab");
    await expect(cards.nth(4)).toBeFocused();
    await page.keyboard.press("End");
    await expect(heading).toHaveText("春季编程挑战赛");
    await expect(win.getByText("组织者还没有写介绍。")).toBeVisible();
    await expect(win.getByRole("link")).toHaveCount(0);
  });

  test.describe("手机", () => {
    test.use({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });

    test("390×844：列表点进详情再返回，操作条贴底，触控目标不小于 44px，没有横向滚动", async ({ page }, testInfo) => {
      await home(page);
      await page.locator('.pt-icons [data-cta="competitions"]').tap();
      const win = page.getByRole("dialog", { name: "比赛" });
      const list = win.getByRole("list", { name: "比赛列表" });
      await expect(list.getByRole("button")).toHaveCount(7);
      // 搜索框不在打开时抢焦点（会弹出键盘）
      await expect(win.getByRole("searchbox", { name: "搜索比赛" })).not.toBeFocused();
      await expect(win.getByRole("button", { name: "返回主屏幕" })).toBeVisible();
      await atLeast44(win.locator(".pt-cx-chip, .pt-cx-search, .pt-cx-card, .pt-phone-back, .pt-phone-close"));
      await noSideScroll(page);
      await page.screenshot({ path: testInfo.outputPath("phone-390-list.png"), animations: "disabled" });

      await list.getByRole("button", { name: /CCPC 2026 哈尔滨站/ }).tap();
      const heading = win.getByRole("heading", { level: 3 });
      await expect(heading).toHaveText("CCPC 2026 哈尔滨站");
      await expect(heading).toBeFocused();
      await expect(list).toHaveCount(0);
      const back = win.getByRole("button", { name: "返回比赛列表" });
      await expect(back).toHaveText("比赛列表");
      // 手机上主按钮在底部操作条里（拇指够得着），Hero 里只放官网链接
      const go = win.locator(".pt-cx-act .pt-btn");
      await expect(go).toHaveText(/去官网报名/);
      await expect(win.locator(".pt-cx-hero .pt-btn")).toHaveCount(0);
      await expect(win.locator("a.pt-cx-hero-tag")).toHaveCount(1);
      await atLeast44(win.locator(".pt-cx-act .pt-btn, .pt-phone-back"));
      // 手机上窗口是停在 Dock 上方的整页卡片（卡片下面是手机 Dock）：操作条贴在卡片底部
      const sheet = (await win.boundingBox())!;
      const goBox = (await go.boundingBox())!;
      expect(sheet.y + sheet.height).toBeLessThanOrEqual(844);
      expect(goBox.y + goBox.height).toBeLessThanOrEqual(sheet.y + sheet.height);
      expect(goBox.y + goBox.height).toBeGreaterThan(sheet.y + sheet.height - 32);
      await noSideScroll(page);
      await page.screenshot({ path: testInfo.outputPath("phone-390-detail.png"), animations: "disabled" });
      // 详情滚到底，操作条不跟着动
      await win.locator(".pt-cx-scroll").evaluate(node => { node.scrollTop = node.scrollHeight; });
      await expect.poll(async () => (await win.locator(".pt-cx-scroll").evaluate(node => node.scrollTop))).toBeGreaterThan(0);
      expect((await go.boundingBox())!.y).toBeCloseTo(goBox.y, 0);

      await back.tap();
      await expect(list.getByRole("button", { name: /CCPC 2026 哈尔滨站/ })).toBeFocused();
      await expect(win.getByRole("button", { name: "返回主屏幕" })).toBeVisible();
      await expect(win.getByRole("heading", { level: 3 })).toHaveCount(0);
    });
  });
});

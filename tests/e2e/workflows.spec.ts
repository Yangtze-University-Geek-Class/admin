import { expect, test, type Page } from "@playwright/test";
import { CONSOLE_ORIGIN } from "../../playwright.config";

test.beforeEach(async ({ page }) => {
  // No browser test may contact an external service or a business API.
  await page.route("**/*", route => {
    const url = new URL(route.request().url());
    if (url.hostname !== "127.0.0.1" && url.protocol !== "data:") return route.abort();
    if (url.pathname.startsWith("/api/") || url.pathname.startsWith("/auth/")) return route.fulfill({ status: 503, contentType: "application/json", body: JSON.stringify({ error: "unexpected_live_request_in_test" }) });
    return route.continue();
  });
});

/** 控制台开发预览：样板数据（只读、全部虚构）+ 指定身份。 */
async function openConsole(page: Page, path: string, persona = "captain") {
  const url = new URL(path, CONSOLE_ORIGIN);
  url.searchParams.set("__data", "mock");
  url.searchParams.set("__persona", persona);
  await page.goto(url.toString());
}

test("public docs have usable labels/language switching; no 控制台 link for a visitor", async ({ page }) => {
  const me = page.waitForResponse(response => new URL(response.url()).pathname === "/auth/me");
  await page.goto("/sites/portal/docs");
  await me;
  await expect(page.getByRole("link", { name: "使用指南", exact: true })).toBeVisible();
  // 开发态右上角固定的「DEV CONTROL」浮层盖住了这个按钮（官网既有问题，与控制台无关），用键盘触发同一个按钮。
  const english = page.getByRole("button", { name: "English", exact: true });
  await english.focus();
  await page.keyboard.press("Enter");
  await expect(page).toHaveURL(/\/docs\/usage-en/);
  await expect(page.getByRole("contentinfo").getByRole("link", { name: "论坛", exact: true })).toBeVisible();
  await expect(page.getByRole("link", { name: "控制台", exact: true })).toHaveCount(0);
});

test("the page footer links 控制台 only when /auth/me says console_link", async ({ page }) => {
  for (const consoleLink of [false, true]) {
    await page.route("**/auth/me", route => route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ signed_in: true, login: "ada", user_id: 1, avatar_url: null, console_link: consoleLink }) }));
    const me = page.waitForResponse(response => new URL(response.url()).pathname === "/auth/me");
    await page.goto("/sites/portal/docs");
    await me;
    const link = page.getByRole("contentinfo").getByRole("link", { name: "控制台", exact: true });
    if (consoleLink) await expect(link).toHaveAttribute("href", "/sites/admin/console");
    else await expect(link).toHaveCount(0);
    await page.unroute("**/auth/me");
  }
});

test("portal forum entry targets the adopted Nuxt module, not the retired React page", async ({ page }) => {
  await page.goto("/sites/portal/docs");
  const navigationLink = page.getByRole("navigation", { name: "主导航" }).getByRole("link", { name: "论坛", exact: true });
  const footerLink = page.getByRole("contentinfo").getByRole("link", { name: "论坛", exact: true });
  await expect(navigationLink).toHaveAttribute("href", "http://127.0.0.1:3456/");
  await expect(footerLink).toHaveAttribute("href", "http://127.0.0.1:3456/");
});

test("legacy /apply redirects to the join-us letter", async ({ page }) => {
  await page.goto("/sites/portal/apply");
  await expect(page).toHaveURL(/\/sites\/portal\/join-us$/);
  await expect(page.getByRole("heading", { level: 1, name: "加入我们" })).toBeVisible();
  // 信纸在信封打开后才对辅助技术可见（此前 aria-hidden），给 3D 入场动画留足时间。
  await expect(page.getByRole("heading", { name: "致 长江大学极客班：" })).toBeVisible({ timeout: 15_000 });
});

const PROMO_CDN = "https://cdn.crosery.com/yzgc/static/promo/**";

test("first visit to join-us never gets stuck behind the promo: whatever the player does, the letter opens", async ({ page }) => {
  // beforeEach 已经拦掉所有外部请求：能播就加载失败，播不了就直接放行，两种都必须进到信纸。
  await page.goto("/sites/portal/join-us");
  await expect(page.getByRole("heading", { name: "致 长江大学极客班：" })).toBeVisible({ timeout: 15_000 });
  await expect(page.getByRole("dialog", { name: "极客班宣传片" })).toHaveCount(0);
});

test("the promo can be skipped on the first visit and does not autoplay again", async ({ page, context }) => {
  await page.goto("/sites/portal/docs");
  const canPlay = await page.evaluate(() => typeof MediaSource !== "undefined" && MediaSource.isTypeSupported('video/mp4; codecs="avc1.640029, mp4a.40.2"'));
  test.skip(!canPlay, "这个 Chromium 没有 H.264/AAC：播放层走「播不了就放行」，由上一条用例覆盖");
  // CDN 挂起不应答：播放层停在加载中，等人点「跳过」
  await page.route(PROMO_CDN, () => {});
  await page.goto("/sites/portal/join-us");
  const promo = page.getByRole("dialog", { name: "极客班宣传片" });
  await expect(promo).toBeVisible();
  await expect(page.getByRole("button", { name: /跳过/ })).toBeFocused();
  await page.getByRole("button", { name: /跳过/ }).click();
  await expect(promo).toHaveCount(0);
  await expect(page.getByRole("heading", { name: "致 长江大学极客班：" })).toBeVisible({ timeout: 15_000 });
  expect((await context.cookies()).find((cookie) => cookie.name === "yugc_promo_seen")?.value).toBe("1");
  await page.reload();
  await expect(page.getByRole("heading", { name: "致 长江大学极客班：" })).toBeVisible({ timeout: 15_000 });
  await expect(promo).toHaveCount(0);
});

test("clicking the video keeps keyboard control: Esc still skips the promo", async ({ page }) => {
  await page.goto("/sites/portal/docs");
  const canPlay = await page.evaluate(() => typeof MediaSource !== "undefined" && MediaSource.isTypeSupported('video/mp4; codecs="avc1.640029, mp4a.40.2"'));
  test.skip(!canPlay, "这个 Chromium 没有 H.264/AAC：播放层走「播不了就放行」");
  await page.route(PROMO_CDN, () => {});
  await page.goto("/sites/portal/join-us");
  const promo = page.getByRole("dialog", { name: "极客班宣传片" });
  await expect(promo).toBeVisible();
  await page.locator(".pt-promo-video").click();
  await expect(promo).toBeFocused();
  await page.keyboard.press("Escape");
  await expect(promo).toHaveCount(0);
  await expect(page.getByRole("heading", { name: "致 长江大学极客班：" })).toBeVisible({ timeout: 15_000 });
});

test.describe("promo on a phone", () => {
  test.use({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });

  test("held upright, the promo turns sideways to fill the screen and 跳过 still works", async ({ page }) => {
    await page.goto("/sites/portal/docs");
    const canPlay = await page.evaluate(() => typeof MediaSource !== "undefined" && MediaSource.isTypeSupported('video/mp4; codecs="avc1.640029, mp4a.40.2"'));
    test.skip(!canPlay, "这个 Chromium 没有 H.264/AAC：播放层走「播不了就放行」");
    await page.route(PROMO_CDN, () => {});
    await page.goto("/sites/portal/join-us");
    const promo = page.getByRole("dialog", { name: "极客班宣传片" });
    await expect(promo).toBeVisible();
    const frame = await page.locator(".pt-promo-frame").evaluate((element) => ({ transform: getComputedStyle(element).transform, box: element.getBoundingClientRect().toJSON() }));
    // rotate(90deg) 的矩阵是 matrix(0, 1, -1, 0, …)；转过来以后画面框占满竖着的屏幕
    expect(frame.transform).toMatch(/^matrix\(0, 1, -1, 0,/);
    expect(Math.round(frame.box.width)).toBe(390);
    expect(Math.round(frame.box.height)).toBe(844);
    expect(await page.locator(".pt-promo").getAttribute("data-codec")).toBe("h264");
    await page.getByRole("button", { name: /跳过/ }).tap();
    await expect(promo).toHaveCount(0);
  });
});

test("console navigation follows the persona's capabilities", async ({ page }) => {
  const nav = page.getByRole("navigation", { name: "控制台导航" });
  await openConsole(page, "/console", "captain");
  await expect(nav.getByRole("button", { name: "审计日志" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "概览", level: 1 })).toBeVisible();

  await openConsole(page, "/console", "member");
  await expect(nav.getByRole("button", { name: "概览" })).toBeVisible();
  await expect(nav.getByRole("button", { name: "投递管理" })).toHaveCount(0);
  await expect(nav.getByRole("button", { name: "成员与权限" })).toHaveCount(0);

  await openConsole(page, "/console", "recruitment");
  await expect(nav.getByRole("button", { name: /邀请链接（需要 GitHub 组织管理员身份）/ })).toBeDisabled();

  await openConsole(page, "/console", "guest");
  await expect(page.getByRole("heading", { name: "你还不能使用控制台" })).toBeVisible();
  await expect(nav).toHaveCount(0);
});

test("console pages explain a missing capability instead of rendering data", async ({ page }) => {
  await openConsole(page, "/console/audit", "crew");
  await expect(page.getByText("你没有「查看审计日志」权限")).toBeVisible();
  await expect(page.getByText("403 missing_capability · audit.read")).toBeVisible();
});

test("signed-out visitors land on the GitHub sign-in page with a return path", async ({ page }) => {
  await openConsole(page, "/console/people", "signed_out");
  await expect(page).toHaveURL(/\/signin\?return_to=/);
  await expect(page.getByRole("button", { name: "用 GitHub 登录" })).toBeVisible();
});

test("people are grouped by department like a contacts list, with lead and superior, and no in-page search", async ({ page }) => {
  await openConsole(page, "/console/people");
  await expect(page.getByRole("heading", { name: "成员与权限", level: 1 })).toBeVisible();
  const groups = page.getByRole("navigation", { name: "按部门查看" });
  for (const name of ["全部成员", "招新部", "技术部", "社区部", "项目部", "没有部门"]) await expect(groups.getByRole("button", { name: new RegExp(`^${name}`) })).toBeVisible();
  await expect(page.getByRole("searchbox")).toHaveCount(0);
  await groups.getByRole("button", { name: /^招新部/ }).click();
  await expect(page).toHaveURL(/group=recruitment/);
  const head = page.locator(".group-head");
  await expect(head.getByRole("heading", { name: "招新部" })).toBeVisible();
  await expect(head.getByText("上级")).toBeVisible();
  await expect(head.getByText("@li-xiaoman")).toBeVisible();
  const logins = await page.locator("tbody tr .user-cell__login").allTextContents();
  expect(logins).toEqual(["@li-xiaoman", "@fang-lin", "@he-miao"]);
});

test("no native select or checkbox is visible; permission bundles use Tuffex checkboxes", async ({ page }) => {
  await openConsole(page, "/console/people?view=departments");
  await page.getByRole("button", { name: "编辑权限包" }).first().click();
  const dialog = page.getByRole("dialog");
  await expect(dialog.getByRole("checkbox").first()).toBeVisible();
  const native = await page.evaluate(() => [...document.querySelectorAll("select, input[type=checkbox]")].filter(el => {
    const r = el.getBoundingClientRect(); const s = getComputedStyle(el);
    return r.width > 1 && r.height > 1 && s.visibility !== "hidden" && s.display !== "none" && s.opacity !== "0";
  }).length);
  expect(native).toBe(0);
});

test("destructive confirmation starts on Cancel and cancelling sends nothing", async ({ page }) => {
  await openConsole(page, "/console/people");
  await page.getByRole("button", { name: "撤销" }).first().click();
  const dialog = page.getByRole("dialog");
  await expect(dialog.getByRole("button", { name: "取消" })).toBeFocused();
  await page.keyboard.press("Escape");
  await expect(dialog).toHaveCount(0);
  await expect(page.getByText("开发预览是只读的")).toHaveCount(0);
});

test("mobile console keeps navigation in a drawer and has no page-level horizontal overflow", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await openConsole(page, "/console/people");
  await expect(page.getByRole("heading", { name: "成员与权限", level: 1 })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);
  await page.getByRole("button", { name: "打开导航" }).click();
  const nav = page.getByRole("navigation", { name: "控制台导航" }).last();
  await nav.getByRole("button", { name: "投递管理" }).click();
  await expect(page).toHaveURL(/\/console\/applications/);
  await expect(page.getByRole("heading", { name: "投递管理", level: 1 })).toBeVisible();
});

test("forum 3D page resets its scene when restored from the back/forward cache (#109)", async ({ page }) => {
  // 论坛（开发态 3456）回 204：导航被取消，页面停在转场最后一帧——和从论坛后退、浏览器从往返缓存恢复时看到的一样
  await page.route("http://127.0.0.1:3456/**", route => route.fulfill({ status: 204 }));
  await page.goto("/sites/portal/forum-3d");
  const board = page.locator(".pt-boards a").first();
  // 场景建好后悬停才会高亮（is-hot 由场景回调设置），以此确认点击会走转场而不是直接跳转
  await expect(async () => {
    await page.mouse.move(0, 0);
    await board.hover();
    await expect(board).toHaveClass(/is-hot/, { timeout: 500 });
  }).toPass({ timeout: 30_000 });
  const pose = () =>
    page.evaluate(() => {
      const stage = (window as unknown as { __yugcStage?: { basePos: { x: number; y: number; z: number }; baseOffset: { x: number; y: number } } }).__yugcStage!;
      return { x: stage.basePos.x, y: stage.basePos.y, z: stage.basePos.z, ox: stage.baseOffset.x, oy: stage.baseOffset.y };
    });
  const wipeOpacity = () => page.locator(".pt-wipe").evaluate(el => Number(getComputedStyle(el).opacity));
  const start = await pose();
  await board.click();
  await expect.poll(wipeOpacity, { timeout: 15_000 }).toBeGreaterThan(0.95);
  const pushed = await pose();
  expect(Math.hypot(pushed.x - start.x, pushed.y - start.y, pushed.z - start.z)).toBeGreaterThan(1);

  await page.evaluate(() => window.dispatchEvent(new PageTransitionEvent("pageshow", { persisted: true })));
  await expect(page.locator(".pt-wipe")).toHaveCSS("opacity", "0");
  const back = await pose();
  for (const key of ["x", "y", "z", "ox", "oy"] as const) expect(back[key]).toBeCloseTo(start[key], 5);
  // 复位后场景又能响应：再点一个版块会重新推近
  await page.locator(".pt-boards a").nth(1).click();
  await expect.poll(wipeOpacity, { timeout: 15_000 }).toBeGreaterThan(0.95);
});

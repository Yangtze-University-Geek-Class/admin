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

test("public docs have usable labels/language switching and a console link", async ({ page }) => {
  await page.goto("/sites/portal/docs");
  await expect(page.getByRole("link", { name: "使用指南", exact: true })).toBeVisible();
  // 开发态右上角固定的「DEV CONTROL」浮层盖住了这个按钮（官网既有问题，与控制台无关），用键盘触发同一个按钮。
  const english = page.getByRole("button", { name: "English", exact: true });
  await english.focus();
  await page.keyboard.press("Enter");
  await expect(page).toHaveURL(/\/docs\/usage-en/);
  await expect(page.getByRole("link", { name: "控制台", exact: true })).toHaveAttribute("href", "/sites/admin/console");
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

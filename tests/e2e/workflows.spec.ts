import { expect, test } from "@playwright/test";

const org = "Yangtze-University-Geek-Class";
test.beforeEach(async ({ page }) => {
  // No browser test may contact an external service or a business API.
  await page.route("**/*", route => {
    const url = new URL(route.request().url());
    if (url.hostname !== "127.0.0.1" && url.protocol !== "data:") return route.abort();
    if (url.pathname.startsWith("/api/") || url.pathname.startsWith("/auth/")) return route.fulfill({ status: 503, contentType: "application/json", body: JSON.stringify({ error: "unexpected_live_request_in_test" }) });
    return route.continue();
  });
});

test("public docs have usable labels/language switching and an actual cross-site admin link", async ({ page }) => {
  await page.goto("/sites/portal/docs");
  await expect(page.getByRole("link", { name: "使用指南", exact: true })).toBeVisible();
  await page.getByRole("button", { name: "English", exact: true }).click();
  await expect(page).toHaveURL(/\/docs\/usage-en/);
  await expect(page.getByRole("link", { name: "管理后台", exact: true })).toHaveAttribute("href", "/sites/admin/admin");
});

test("destructive confirmation defaults to Cancel, contains focus, and returns it on dismissal", async ({ page }) => {
  await page.goto(`/sites/admin/admin/${org}/repos/admin/settings`);
  const trigger = page.getByRole("button", { name: "删除仓库", exact: true });
  await trigger.click();
  const dialog = page.getByRole("alertdialog");
  await expect(dialog).toBeVisible();
  await expect(dialog.getByRole("button", { name: "取消", exact: true })).toBeFocused();
  await page.keyboard.press("Tab");
  await expect(dialog.getByRole("button", { name: "我已了解，删除", exact: true })).toBeFocused();
  await page.keyboard.press("Tab");
  // Some browsers briefly focus the dialog host before wrapping; focus must not enter the background.
  expect(await page.evaluate(() => document.activeElement?.closest("dialog") !== null)).toBe(true);
  await page.keyboard.press("Escape");
  await expect(dialog).toHaveCount(0);
  await expect(trigger).toBeFocused();
  await trigger.click();
  await page.keyboard.press("Enter");
  await expect(dialog).toHaveCount(0);
  await expect(page.getByText("开发预览为只读", { exact: false })).toHaveCount(0);
});

test("mobile administration retains organization switching, navigation and logout", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(`/sites/admin/admin/${org}`);
  const navigation = page.getByRole("navigation", { name: "移动端管理导航" });
  await expect(navigation).toBeVisible();
  await expect(page.getByRole("combobox", { name: "组织切换" })).toBeVisible();
  await navigation.getByRole("link", { name: "仓库", exact: true }).click();
  await expect(page).toHaveURL(/\/repos$/);
  await expect(page.getByRole("button", { name: "退出登录", exact: true })).toBeVisible();
});

test("portal forum entry targets the adopted Nuxt module, not the retired React page", async ({ page }) => {
  await page.goto("/sites/portal/");
  const navigationLink = page.getByRole("navigation", { name: "主导航" }).getByRole("link", { name: "论坛", exact: true });
  const footerLink = page.getByRole("contentinfo").getByRole("link", { name: "论坛", exact: true });
  await expect(navigationLink).toHaveAttribute("href", "http://127.0.0.1:3456/");
  await expect(footerLink).toHaveAttribute("href", "http://127.0.0.1:3456/");
});

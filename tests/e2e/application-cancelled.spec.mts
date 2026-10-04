import { expect, test } from "@playwright/test";
import { fileURLToPath } from "node:url";
import { buildApp } from "../../app/server/src/app.js";
import { createConfig } from "../../app/server/src/config.js";
import type { ServiceOverrides } from "../../app/server/src/services";
import { CONSOLE_ORIGIN } from "../../playwright.config";

let context: { app: Awaited<ReturnType<typeof buildApp>>; close: () => Promise<void> };
let applicationId: string;
let headers: { cookie: string };
let providerCalls: number;

test.beforeEach(async ({ page }) => {
  providerCalls = 0;
  const octokitFactory = (() => ({
    request: async (route: string) => {
      if (route !== "GET /orgs/{org}/memberships/{username}") throw new Error(`Unexpected GitHub call ${route}`);
      return { data: { state: "active", role: "admin" } };
    },
  })) as unknown as ServiceOverrides["octokitFactory"];
  const config = {
    ...createConfig({
      NODE_ENV: "test", PUBLIC_ORIGIN: CONSOLE_ORIGIN, DB_PATH: ":memory:",
      SESSION_SECRET: "isolated-cancelled-test-secret-at-least-32",
      ENCRYPTION_KEY: Buffer.alloc(32, 1).toString("base64"),
      OAUTH_CLIENT_ID: "test-client", OAUTH_CLIENT_SECRET: "test-only-placeholder", POW_DIFFICULTY: "0",
      MAIL_RECIPIENTS: "all", MAIL_RESEND_API_KEY: "test-only-placeholder", MAIL_RESEND_FROM: "recruitment@example.test",
    }),
    forumContentDir: fileURLToPath(new URL("../server/fixtures/forum-content", import.meta.url)),
  };
  const app = await buildApp({
    config, staticRoot: false, overrides: {
      httpRequest: (() => { throw new Error("Unexpected external HTTP call"); }) as ServiceOverrides["httpRequest"],
      octokitFactory,
      mailFetch: async () => {
        providerCalls++;
        return new Response(JSON.stringify({ id: `fixture-mail-${providerCalls}` }), { status: 200 });
      },
    },
  });
  await app.ready();
  context = { app, close: () => app.close() };
  headers = { cookie: `sid=${context.app.services.auth.createSession("alice", 101, null, "test-only-token")}` };
  const apply = await context.app.inject({
    method: "POST", url: "/api/portal/apply",
    payload: { name: "取消测试", className: "计科2401", email: "cancelled@example.test", strengths: "熟悉 TypeScript，做过课程设计，愿意参与社区维护。", pow: { timestamp: Date.now(), nonce: "x" } },
  });
  expect(apply.statusCode).toBe(201);
  applicationId = apply.json().id;
  await context.app.services.mail.drain();
  expect(providerCalls).toBe(1);
  // 浏览器的业务请求交给真实 Fastify 路由和内存库，不复制处理器，不访问本机业务实例。
  await page.route("**/*", async route => {
    const request = route.request();
    const url = new URL(request.url());
    if (url.hostname !== "127.0.0.1" && url.protocol !== "data:") return route.abort();
    if (url.pathname.startsWith("/api/") || url.pathname.startsWith("/auth/")) {
      const response = await context.app.inject({
        method: request.method() as "GET" | "PATCH",
        url: `${url.pathname}${url.search}`,
        headers: { ...headers, origin: CONSOLE_ORIGIN, ...(request.postData() ? { "content-type": "application/json" } : {}) },
        ...(request.postData() ? { payload: request.postData()! } : {}),
      });
      return route.fulfill({ status: response.statusCode, contentType: String(response.headers["content-type"]), body: response.body });
    }
    return route.continue();
  });
});

test.afterEach(async () => { if (context) await context.close(); });

for (const viewport of [{ width: 1440, height: 900 }, { width: 390, height: 844 }]) {
  test(`cancellation saves and survives refresh without email at ${viewport.width}px`, async ({ page }, testInfo) => {
    await page.setViewportSize(viewport);
    await page.goto(`${CONSOLE_ORIGIN}/console/applications/${applicationId}?__data=live`);
    await expect(page.getByRole("heading", { level: 1, name: "取消测试" })).toBeVisible();
    await page.screenshot({ path: testInfo.outputPath("before.png"), fullPage: true, animations: "disabled" });
    await expect(page.locator(".tx-steps")).toHaveCount(1);
    const select = page.getByRole("combobox", { name: "状态" });
    await select.focus();
    await page.keyboard.press("Enter");
    const cancelled = page.getByRole("option", { name: "已取消", exact: true });
    await expect(page.getByRole("option")).toHaveCount(5);
    await expect(cancelled).toBeInViewport({ ratio: 1 });
    await expect(page.getByRole("option", { name: "已收到", exact: true })).toHaveAttribute("aria-selected", "true");
    const panel = await page.getByRole("listbox").boundingBox();
    expect(panel).not.toBeNull();
    expect(panel!.x).toBeGreaterThanOrEqual(0);
    expect(panel!.x + panel!.width).toBeLessThanOrEqual(viewport.width);
    await page.screenshot({ path: testInfo.outputPath("options.png"), fullPage: true, animations: "disabled" });
    // 打开时无活动项，第一次方向键停在首项，第五次到取消。
    for (let i = 0; i < 5; i++) await page.keyboard.press("ArrowDown");
    await expect(select).toHaveAttribute("aria-activedescendant", await cancelled.getAttribute("id") ?? "");
    await page.screenshot({ path: testInfo.outputPath("active.png"), fullPage: true, animations: "disabled" });
    await page.keyboard.press("Enter");
    await expect(select).toHaveValue("已取消");
    await expect(select).toBeFocused();
    await expect(page.getByText("这份投递将标为已取消，不发邮件。简历和审核记录会保留。")).toBeVisible();
    await expect(page.getByRole("checkbox", { name: "给投递人发邮件" })).toHaveCount(0);
    await expect(page.getByRole("button", { name: "保存并发邮件", exact: true })).toHaveCount(0);
    await page.locator(".review-form textarea").fill("投递人撤回这份简历");
    await page.getByRole("button", { name: "保存", exact: true }).focus();
    await page.keyboard.press("Enter");
    await expect(page.getByText("这份投递已取消。简历和审核记录已保留。")).toBeVisible();
    await expect(page.getByText("投递已取消，没有发送邮件。")).toBeVisible();
    await page.reload();
    await expect(select).toHaveValue("已取消");
    await select.focus();
    await page.keyboard.press("Enter");
    await expect(cancelled).toBeInViewport({ ratio: 1 });
    await expect(cancelled).toHaveAttribute("aria-selected", "true");
    await page.screenshot({ path: testInfo.outputPath("selected.png"), fullPage: true, animations: "disabled" });
    await page.keyboard.press("Escape");
    await expect(select).toHaveAttribute("aria-expanded", "false");
    await expect(page.getByRole("listbox")).toBeHidden();
    await expect(select).toBeFocused();
    await expect(page.getByText("@alice 改为「已取消」")).toBeVisible();
    await expect(page.getByText("邮件：没有发", { exact: true })).toBeVisible();
    await expect(page.locator(".tx-steps")).toHaveCount(0);
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(viewport.width);
    await page.screenshot({ path: testInfo.outputPath("after.png"), fullPage: true, animations: "disabled" });
    await context.app.services.mail.drain();
    expect(providerCalls).toBe(1);
    expect(context.app.services.storage.db.prepare("SELECT COUNT(*) AS n FROM mail_outbox").get()).toEqual({ n: 1 });
    await page.goto(`${CONSOLE_ORIGIN}/console/applications?__data=live`);
    const filter = page.getByRole("button", { name: /^已取消/ });
    await expect(filter).toContainText("1");
    await filter.click();
    await expect(page).toHaveURL(/status=cancelled/);
    await expect(page.locator("tbody tr")).toHaveCount(1);
    await expect(page.locator("tbody")).toContainText("取消测试");
    await expect(page.locator("a[download]")).toHaveAttribute("href", "/api/console/applications/export.csv?status=cancelled");
  });
}

test("a stale cancellation is rejected and the latest state and draft are retained", async ({ page }) => {
  await page.goto(`${CONSOLE_ORIGIN}/console/applications/${applicationId}?__data=live`);
  await expect(page.getByRole("heading", { level: 1, name: "取消测试" })).toBeVisible();
  await page.getByRole("combobox", { name: "状态" }).click();
  await page.getByRole("option", { name: "已取消", exact: true }).click();
  await page.locator(".review-form textarea").fill("保留这条取消说明");
  const newer = await context.app.inject({
    method: "PATCH", url: `/api/console/applications/${applicationId}`, headers,
    payload: { status: "accepted", expected_status: "received", expected_review_id: 0, notify: false },
  });
  expect(newer.statusCode).toBe(200);
  await page.getByRole("button", { name: "保存", exact: true }).click();
  await expect(page.getByText("这份投递刚被别人处理过，现在是「已录取」，看过最新的记录再改")).toBeVisible();
  await expect(page.getByRole("combobox", { name: "状态" })).toHaveValue("已录取");
  await expect(page.locator(".review-form textarea")).toHaveValue("保留这条取消说明");
  expect(context.app.services.storage.db.prepare("SELECT status FROM applications WHERE id = ?").get(applicationId)).toEqual({ status: "accepted" });
  expect(context.app.services.storage.db.prepare("SELECT COUNT(*) AS n FROM application_reviews").get()).toEqual({ n: 1 });
  expect(providerCalls).toBe(1);
});

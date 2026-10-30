import { readFileSync } from 'node:fs'
// 源站从环境文件读（三份相同），不在测试里写死。
const CDN_ORIGIN = /^STATIC_CDN_ORIGIN=(.+)$/m.exec(readFileSync(new URL('../../deploy/env/.env.production', import.meta.url), 'utf8'))?.[1]?.trim() ?? ''
import { expect, test } from "@playwright/test";
import { fileURLToPath } from "node:url";
import { buildApp } from "../../app/server/src/app.js";
import { createConfig } from "../../app/server/src/config.js";
import type { ServiceOverrides } from "../../app/server/src/services";
import { CONSOLE_ORIGIN } from "../../playwright.config";

let context: { app: Awaited<ReturnType<typeof buildApp>>; close: () => Promise<void> };
let competition: Record<string, unknown> & { id: string };
let headers: { cookie: string };
let writes: number;

test.beforeEach(async ({ page }) => {
  const octokitFactory = (() => ({
    request: async (route: string) => {
      if (route !== "GET /orgs/{org}/memberships/{username}") throw new Error(`Unexpected GitHub call ${route}`);
      return { data: { state: "active", role: "admin" } };
    },
  })) as unknown as ServiceOverrides["octokitFactory"];
  const deny = () => { throw new Error("Unexpected external request"); };
  const app = await buildApp({
    config: {
      ...createConfig({
        NODE_ENV: "test", PUBLIC_ORIGIN: CONSOLE_ORIGIN, STATIC_CDN_ORIGIN: CDN_ORIGIN, DB_PATH: ":memory:",
        SESSION_SECRET: "isolated-competition-test-secret-at-least-32",
        ENCRYPTION_KEY: Buffer.alloc(32, 1).toString("base64"),
        OAUTH_CLIENT_ID: "test-client", OAUTH_CLIENT_SECRET: "test-only-placeholder", POW_DIFFICULTY: "0",
      }),
      forumContentDir: fileURLToPath(new URL("../server/fixtures/forum-content", import.meta.url)),
    },
    staticRoot: false,
    overrides: { octokitFactory, httpRequest: deny, mailFetch: deny },
  });
  await app.ready();
  context = { app, close: () => app.close() };
  // 走真实的 GitHub 登录事务签会话（#262）：建出 alice 的极客班账号，会话带 account_id
  const signin = context.app.services.identity.signInWithGithub({ github: { id: 101, login: "alice", avatarUrl: null }, accessToken: "test-only-token" });
  if (!signin.ok) throw new Error(`test sign-in refused: ${signin.reason}`);
  headers = { cookie: `sid=${signin.sid}` };
  const now = Date.now();
  const created = await context.app.inject({
    method: "POST", url: "/api/console/competitions", headers,
    payload: {
      name: "精确赛程验收", kind: "internal",
      start_at: now + 86_400_000, end_at: now + 90_000_000,
      signup_deadline: null, url: "https://example.test/contest", description: "原始说明",
    },
  });
  expect(created.statusCode).toBe(201);
  competition = created.json().competition;
  writes = 0;
  await page.route("**/*", async route => {
    const request = route.request();
    const url = new URL(request.url());
    if (url.hostname !== "127.0.0.1" && url.protocol !== "data:") return route.abort();
    if (!url.pathname.startsWith("/api/") && !url.pathname.startsWith("/auth/")) return route.continue();
    if (request.method() === "PATCH") writes++;
    const response = await context.app.inject({
      method: request.method() as "GET" | "POST" | "PATCH" | "DELETE",
      url: `${url.pathname}${url.search}`,
      headers: { ...headers, origin: CONSOLE_ORIGIN, ...(request.postData() ? { "content-type": "application/json" } : {}) },
      ...(request.postData() ? { payload: request.postData()! } : {}),
    });
    return route.fulfill({ status: response.statusCode, contentType: String(response.headers["content-type"]), body: response.body });
  });
});

test.afterEach(async () => { if (context) await context.close(); });

for (const viewport of [{ width: 1440, height: 900 }, { width: 390, height: 844 }]) {
  test(`competition editing preserves time and controls public visibility at ${viewport.width}px`, async ({ page }, testInfo) => {
    await page.setViewportSize(viewport);
    await page.goto(`${CONSOLE_ORIGIN}/console/competitions?__data=live`);
    const row = page.getByRole("row").filter({ hasText: "精确赛程验收" });
    await expect(row).toContainText("未开始");
    for (const button of [...await row.getByRole("button").all(), page.getByRole("button", { name: "新建比赛", exact: true })]) {
      await expect.poll(async () => (await button.boundingBox())?.height ?? 0).toBeGreaterThanOrEqual(44);
    }
    await row.getByRole("button", { name: "编辑", exact: true }).click();
    const dialog = page.getByRole("dialog", { name: "编辑比赛", exact: true });
    for (const control of await dialog.locator("button, input").all()) {
      await expect.poll(async () => (await control.boundingBox())?.height ?? 0).toBeGreaterThanOrEqual(44);
    }
    await dialog.getByPlaceholder("https://", { exact: true }).fill("https://?");
    await dialog.getByRole("button", { name: "保存", exact: true }).click();
    await expect(dialog.getByText("请填写有效的 https:// 官方链接。", { exact: true })).toBeVisible();
    expect(writes).toBe(0);
    await page.screenshot({ path: testInfo.outputPath("invalid-url.png"), animations: "disabled" });

    await dialog.getByPlaceholder("https://", { exact: true }).fill("https://example.test/contest");
    await dialog.getByPlaceholder("一两句说清这是什么比赛、谁能参加。").fill("修改说明，不修改赛程");
    await dialog.getByRole("button", { name: "保存", exact: true }).click();
    await expect(dialog).toBeHidden();
    // #239 的种子比赛（oss-challenge-2026-1）也在公开列表里：这里只核对本用例造的那场。
    const publicList = async () => ((await context.app.inject({ url: "/api/public/competitions" })).json().competitions as { id: string }[])
      .filter(item => item.id !== "oss-challenge-2026-1");
    expect(await publicList()).toEqual([expect.objectContaining({
      id: competition.id, start_at: competition.start_at, end_at: competition.end_at,
      signup_deadline: null, description: "修改说明，不修改赛程", status: "upcoming",
    })]);
    await page.reload();
    await expect(row).toContainText("未开始");
    await row.getByRole("button", { name: "下线", exact: true }).click();
    await expect(row).toContainText("已下线");
    expect(await publicList()).toEqual([]);
    await row.getByRole("button", { name: "上线", exact: true }).click();
    await expect(row.getByRole("button", { name: "下线", exact: true })).toBeVisible();
    expect(await publicList()).toHaveLength(1);
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(viewport.width);
    await page.screenshot({ path: testInfo.outputPath("restored.png"), animations: "disabled" });
  });
}

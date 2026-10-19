import { test, expect } from "@playwright/test";
import { pathToFileURL } from "node:url";
import { resolve } from "node:path";

const map = pathToFileURL(resolve("docs/architecture/catalog/map.html")).href;

test("工程地图可搜索业务流程并沿关联查看真实数据结构", async ({ page }) => {
  await page.goto(map);
  await expect(page.locator("#ttl")).toHaveText("geek_main · 项目地图");
  await page.locator("#q").fill("取消投递");
  await page.locator("#q").press("Enter");
  await expect(page.locator("#ii")).toContainText("flow:application.cancel");
  await expect(page.locator("#ii")).toContainText("mail_outbox");
  await page.locator('#ii [data-goto="table:applications"]').first().click();
  await expect(page.locator("#ii")).toContainText("class_name");
  await expect(page.locator("#errbar")).toBeHidden();
});

test("窄屏保留目录、节点详情和返回操作", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(map);
  await page.locator("#bNav").click();
  await page.locator('.pg[data-page="domain-mail"]').click();
  await expect(page.locator("#empty")).toBeHidden();
  await page.locator("#q").fill("applications.review");
  await page.locator("#q").press("Enter");
  await expect(page.locator("#insp")).toBeVisible();
  await page.locator('#ii [data-act="close"]').click();
  await expect(page.locator("#insp")).toBeHidden();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
});

test("PR 报告高亮关联节点，摘要或节点不匹配时清空并拒绝", async ({ page }) => {
  await page.goto(map);
  const fingerprint = await page.locator("#graph-data").textContent().then(text => JSON.parse(text!).meta.fingerprint);
  const report = { issue: 257, ok: true, catalogFingerprint: fingerprint, affectedNodeIds: ["flow:application.cancel"] };
  const upload = (value: unknown) => page.locator("#impactFile").setInputFiles({
    name: "architecture-impact.json", mimeType: "application/json", buffer: Buffer.from(JSON.stringify(value)),
  });
  await upload(report);
  await expect(page.locator("#bImpact")).toHaveText("PR #257 · 报告通过");
  await expect(page.locator('.node.impact-hit[data-id="flow:application.cancel"]')).toBeVisible();
  await upload({ ...report, catalogFingerprint: "stale" });
  await expect(page.locator("#errbar")).toContainText("源码摘要不一致");
  await expect(page.locator(".impact-hit")).toHaveCount(0);
  await upload({ ...report, affectedNodeIds: ["route:GET /missing"] });
  await expect(page.locator("#errbar")).toContainText("未知节点");
  await upload(report);
  await expect(page.locator("#errbar")).toBeHidden();
  await page.locator("#bImpactClear").click();
  await expect(page.locator(".impact-hit")).toHaveCount(0);
});

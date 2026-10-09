import { expect, test, type Page } from "@playwright/test";
import type { Stage } from "../../app/web/sites/portal/three/stage";

test.beforeEach(async ({ page, context }) => {
  await context.addCookies([{ name: "yugc_promo_seen", value: "1", url: "http://127.0.0.1:5179" }]);
  await page.route("**/*", route => {
    const url = new URL(route.request().url());
    if (url.hostname !== "127.0.0.1" && url.protocol !== "data:") return route.abort();
    if (url.pathname === "/auth/me") return route.fulfill({ json: { signed_in: false } });
    if (url.pathname.startsWith("/api/") || url.pathname.startsWith("/auth/")) return route.fulfill({ status: 503, json: { error: "unexpected_live_request_in_test" } });
    return route.continue();
  });
});

async function idle(page: Page) {
  await page.goto("/sites/portal/");
  await expect(page.locator(".pt-home")).toHaveAttribute("data-state", "idle", { timeout: 20_000 });
  await expect(page.locator(".pt-loader")).toHaveCount(0, { timeout: 20_000 });
}
async function home(page: Page) {
  await expect(page.locator(".pt-home")).toHaveAttribute("data-state", "desktop", { timeout: 20_000 });
  await expect(page.locator(".pt-os-shell")).toBeVisible();
  await expect(page.locator(".pt-boot")).toHaveCSS("opacity", "0");
  await expect(page.locator(".pt-os")).toHaveCSS("opacity", "1");
}
async function stableWallpaper(page: Page, image: RegExp) {
  const full = page.locator(".pt-wall").last().locator(".pt-wall-full.is-sharp");
  await expect(full).toHaveCSS("background-image", image);
  await expect(page.locator(".pt-wall")).toHaveCount(1);
  await expect(full).toHaveCSS("opacity", "1");
}
async function noOverflow(page: Page) {
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
}

test.describe("手机主屏幕 #206", () => {
  test.setTimeout(60_000);
  test.use({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });

  test("手机屏幕与开机交接遮罩的四角是实际几何圆角，不是矩形贴图", async ({ page }) => {
    await idle(page);
    const outlines = await page.evaluate(() => {
      const stage = (window as unknown as { __yugcStage: Stage }).__yugcStage;
      const phone = stage.scene.getObjectByName("desk-phone")!;
      const screen = stage.scene.getObjectByName("phone-screen")!;
      const veil = phone.children.find(object => object.renderOrder === 2)!;
      return [screen, veil].map(object => {
        const mesh = object as typeof object & {
          geometry: {
            computeBoundingBox(): void;
            boundingBox: { min: { x: number; y: number }; max: { x: number; y: number } };
            attributes: { position: { count: number; getX(i: number): number; getY(i: number): number } };
          };
        };
        mesh.geometry.computeBoundingBox();
        const { min, max } = mesh.geometry.boundingBox;
        const vertices = mesh.geometry.attributes.position;
        const cut = (max.x - min.x) * 0.035;
        const occupied = [false, false, false, false];
        for (let i = 0; i < vertices.count; i++) {
          const x = vertices.getX(i);
          const y = vertices.getY(i);
          if (x < min.x + cut && y < min.y + cut) occupied[0] = true;
          if (x > max.x - cut && y < min.y + cut) occupied[1] = true;
          if (x < min.x + cut && y > max.y - cut) occupied[2] = true;
          if (x > max.x - cut && y > max.y - cut) occupied[3] = true;
        }
        return occupied;
      });
    });
    expect(outlines).toEqual([[false, false, false, false], [false, false, false, false]]);
    await page.screenshot({ path: "/tmp/geek-206-iphone-model-390.png" });
  });

  for (const size of [{ width: 360, height: 780 }, { width: 390, height: 844 }, { width: 430, height: 932 }]) {
    test(`${size.width}×${size.height} 手机完整取景，实际触点、主屏幕、面板、搜索和壁纸可用`, async ({ page, context }) => {
      await page.setViewportSize(size);
      await idle(page);
      await expect(page.getByRole("button", { name: "打开手机" })).toBeVisible();
      const projected = await page.evaluate(() => {
        const stage = (window as unknown as { __yugcStage: Stage }).__yugcStage;
        const phone = stage.scene.getObjectByName("desk-phone")!;
        const screen = stage.scene.getObjectByName("phone-screen")!;
        const corners: { x: number; y: number }[] = [];
        phone.traverse(object => {
          const mesh = object as typeof object & {
            geometry?: {
              computeBoundingBox(): void;
              boundingBox: { min: { x: number; y: number; z: number }; max: { x: number; y: number; z: number } };
            };
          };
          if (!mesh.geometry || !mesh.visible) return;
          mesh.geometry.computeBoundingBox();
          const { min, max } = mesh.geometry.boundingBox;
          for (const x of [min.x, max.x]) for (const y of [min.y, max.y]) for (const z of [min.z, max.z]) {
            const point = mesh.localToWorld(mesh.position.clone().set(x, y, z)).project(stage.camera);
            corners.push({ x: (point.x + 1) * innerWidth / 2, y: (1 - point.y) * innerHeight / 2 });
          }
        });
        const point = screen.getWorldPosition(screen.position.clone()).project(stage.camera);
        return { visible: phone.visible, laptop: stage.scene.getObjectByName("desk-laptop")!.visible, corners, click: { x: (point.x + 1) * innerWidth / 2, y: (1 - point.y) * innerHeight / 2 }, band: [document.querySelector(".pt-hud-top")!.getBoundingClientRect().bottom, document.querySelector(".pt-hud-copy")!.getBoundingClientRect().top] };
      });
      expect(projected.visible).toBe(true);
      expect(projected.laptop).toBe(false);
      for (const point of projected.corners) {
        expect(point.x).toBeGreaterThanOrEqual(0);
        expect(point.x).toBeLessThanOrEqual(size.width);
        expect(point.y).toBeGreaterThanOrEqual(projected.band[0]);
        expect(point.y).toBeLessThanOrEqual(projected.band[1]);
      }
      await page.touchscreen.tap(projected.click.x, projected.click.y);
      await home(page);
      await expect(page.getByRole("list", { name: "主屏幕上的应用" })).toBeVisible();
      await expect(page.locator(".pt-mb, .pt-note")).toHaveCount(0);
      await expect(page.locator(".pt-phone-tools")).toHaveCount(0);
      const targets = await page.locator(".pt-os-shell button, .pt-os-shell a").evaluateAll(nodes => nodes.filter(node => node.getClientRects().length).map(node => ({ name: node.textContent, width: node.getBoundingClientRect().width, height: node.getBoundingClientRect().height })));
      for (const target of targets) { expect(target.width, target.name ?? "").toBeGreaterThanOrEqual(44); expect(target.height, target.name ?? "").toBeGreaterThanOrEqual(44); }
      const dock = page.getByRole("navigation", { name: "Dock" });
      await expect(dock.getByRole("button")).toHaveCount(4);
      const input = page.getByRole("textbox", { name: "终端输入" });
      await page.locator('.pt-icons [data-cta="terminal"]').tap();
      await input.fill("help");
      await input.press("Enter");
      await input.fill("keep206");
      await dock.getByRole("button", { name: "返回主屏幕" }).tap();
      await expect(page.locator(".pt-win")).toBeHidden();
      await page.locator('.pt-icons [data-cta="terminal"]').tap();
      await expect(input).toHaveValue("keep206");
      await expect(input).toBeFocused();
      await page.setViewportSize({ width: size.height, height: size.width });
      await expect(page.locator(".pt-os-shell")).toHaveClass(/is-phone/);
      await expect(input).toHaveValue("keep206");
      await noOverflow(page);
      await page.setViewportSize(size);
      await expect(input).toHaveValue("keep206");
      await page.getByRole("button", { name: "关闭应用" }).tap();
      const search = page.getByRole("button", { name: "搜索", exact: true });
      await search.tap();
      await page.getByRole("combobox").fill("关于");
      await page.getByRole("combobox").press("Enter");
      await expect(page.getByRole("dialog", { name: "关于极客班" })).toBeVisible();
      await page.getByRole("button", { name: "关闭应用" }).tap();
      await page.locator('.pt-icons [data-cta="org"]').tap();
      await noOverflow(page);
      await page.getByRole("button", { name: "关闭应用" }).tap();
      await page.locator('.pt-icons [data-cta="wallpaper"]').tap();
      const picker = page.getByRole("dialog", { name: "更换壁纸" });
      await picker.getByRole("radio").last().tap();
      await expect(picker.getByRole("radio").last()).toHaveAttribute("aria-checked", "true");
      await page.keyboard.press("Tab");
      expect(await page.evaluate(() => document.activeElement?.closest("dialog") !== null)).toBe(true);
      await page.keyboard.press("2");
      await page.keyboard.press("3");
      await page.keyboard.press("Control+k");
      await expect(picker).toBeVisible();
      await expect(page.getByRole("dialog")).toHaveCount(1);
      expect(context.pages()).toHaveLength(1);
      await page.keyboard.press("Escape");
      await expect(picker).toHaveCount(0);
      await expect(page.locator('.pt-icons [data-cta="wallpaper"]')).toBeFocused();
      await page.getByRole("button", { name: "新来的看这里" }).tap();
      await page.keyboard.press("2");
      await page.keyboard.press("3");
      await page.keyboard.press("Control+k");
      await expect(page.getByRole("dialog", { name: "新来的看这里" })).toBeVisible();
      await expect(page.getByRole("dialog")).toHaveCount(1);
      expect(context.pages()).toHaveLength(1);
      await page.keyboard.press("Escape");
      await noOverflow(page);
      await page.getByRole("button", { name: "YUGC OS 系统设置", exact: true }).tap();
      const settings = page.getByRole("dialog", { name: "系统设置" });
      await page.keyboard.press("3");
      await page.keyboard.press("Control+k");
      await expect(settings).toBeVisible();
      expect(context.pages()).toHaveLength(1);
      await settings.getByRole("button", { name: "回到书桌", exact: true }).tap();
      await expect(page.locator(".pt-home")).toHaveAttribute("data-state", "idle", { timeout: 15_000 });
      await page.getByRole("button", { name: "打开手机" }).tap();
      await home(page);
    });
  }

  test("独立竖屏壁纸、下滑搜索、旋转与同选择重新开机贯通", async ({ page, context }) => {
    const requested: string[] = [];
    page.on("request", request => { if (request.resourceType() === "image" && /wallpapers\/.*\.webp/.test(request.url())) requested.push(request.url()); });
    await idle(page);
    await page.getByRole("button", { name: "跳过动画" }).tap();
    await home(page);
    await stableWallpaper(page, /yugc-phone\.webp/);
    expect(requested.length).toBeGreaterThan(0);
    expect(requested.every(url => url.includes("-phone"))).toBe(true);
    await page.screenshot({ path: "/tmp/geek-206-phone-yugc-home.png" });
    const cdp = await context.newCDPSession(page);
    expect(await page.evaluate(() => document.elementFromPoint(150, 470)?.closest(".pt-dt") !== null)).toBe(true);
    await cdp.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [{ x: 150, y: 470 }] });
    await cdp.send("Input.dispatchTouchEvent", { type: "touchMove", touchPoints: [{ x: 150, y: 500 }] });
    await cdp.send("Input.dispatchTouchEvent", { type: "touchMove", touchPoints: [{ x: 150, y: 560 }] });
    await cdp.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
    await expect(page.getByRole("combobox")).toBeFocused();
    await page.keyboard.press("Escape");
    await expect(page.getByRole("button", { name: "搜索", exact: true })).toBeFocused();
    await page.locator('.pt-icons [data-cta="wallpaper"]').tap();
    const picker = page.getByRole("dialog", { name: "更换壁纸" });
    for (const image of await picker.locator("img").all()) {
      const dimensions = await image.evaluate((node: HTMLImageElement) => ({ width: node.naturalWidth, height: node.naturalHeight }));
      expect(dimensions).toEqual({ width: 180, height: 390 });
    }
    await page.screenshot({ path: "/tmp/geek-206-phone-portrait-picker.png" });
    await picker.getByRole("radio").last().tap();
    await page.keyboard.press("Escape");
    await stableWallpaper(page, /geek-phone\.webp/);
    await page.screenshot({ path: "/tmp/geek-206-phone-geek-home.png" });
    const dimensions = await page.evaluate(async () => {
      const element = document.querySelector<HTMLElement>(".pt-wall:last-child .pt-wall-full")!;
      const image = new Image();
      image.src = getComputedStyle(element).backgroundImage.slice(5, -2);
      await image.decode();
      return { width: image.naturalWidth, height: image.naturalHeight };
    });
    expect(dimensions).toEqual({ width: 900, height: 1950 });
    await page.setViewportSize({ width: 844, height: 390 });
    await stableWallpaper(page, /\/geek\.webp/);
    await page.setViewportSize({ width: 390, height: 844 });
    await stableWallpaper(page, /geek-phone\.webp/);
    await page.getByRole("button", { name: "YUGC OS 系统设置", exact: true }).tap();
    await page.screenshot({ path: "/tmp/geek-206-phone-settings.png" });
    await page.getByRole("button", { name: "回到书桌", exact: true }).tap();
    await expect(page.locator(".pt-home")).toHaveAttribute("data-state", "idle", { timeout: 15_000 });
    await page.getByRole("button", { name: "跳过动画" }).tap();
    await home(page);
    await stableWallpaper(page, /geek-phone\.webp/);
    expect(await page.evaluate(() => localStorage.getItem("yugc:wallpaper"))).toBe("geek");
    await cdp.detach();
  });

  test("手机跳过开机后的首帧系统不透明，不闪出底下的书桌", async ({ page }) => {
    await idle(page);
    await page.evaluate(() => {
      const element = document.querySelector<HTMLElement>(".pt-home")!;
      const observer = new MutationObserver(() => {
        if (element.dataset.state !== "desktop") return;
        observer.disconnect();
        requestAnimationFrame(() => { element.dataset.firstDesktopOpacity = getComputedStyle(document.querySelector(".pt-os")!).opacity; });
      });
      observer.observe(element, { attributes: true, attributeFilter: ["data-state"] });
    });
    await page.getByRole("button", { name: "跳过动画" }).tap();
    await home(page);
    await expect(page.locator(".pt-home")).toHaveAttribute("data-first-desktop-opacity", "1");
  });

  test("竖图解码前跳过开机保持等待，不用已完成的横图缓存放行", async ({ page }) => {
    let release: () => void = () => undefined;
    const hold = new Promise<void>(resolve => { release = resolve; });
    await page.route("**/yugc-phone.webp", async route => { await hold; await route.continue(); });
    await idle(page);
    await page.getByRole("button", { name: "跳过动画" }).tap();
    await expect(page.getByRole("button", { name: "正在打开…" })).toBeDisabled();
    await expect(page.locator(".pt-home")).toHaveAttribute("data-state", "idle");
    release();
    await home(page);
    await expect(page.locator(".pt-wall-full.is-sharp")).toHaveCSS("background-image", /yugc-phone\.webp/);
  });

  test("减少动态效果与无 WebGL 回退，跳过动画仍能进入手机主屏幕", async ({ page }) => {
    await page.emulateMedia({ reducedMotion: "reduce" });
    await idle(page);
    await page.getByRole("button", { name: "跳过动画" }).tap();
    await home(page);
    await page.addInitScript(() => {
      const original = HTMLCanvasElement.prototype.getContext;
      Object.defineProperty(HTMLCanvasElement.prototype, "getContext", { value: function (this: HTMLCanvasElement, type: string, ...args: unknown[]) {
        return type.startsWith("webgl") ? null : Reflect.apply(original, this, [type, ...args]);
      } });
    });
    await page.reload();
    await home(page);
    await expect(page.getByRole("list", { name: "主屏幕上的应用" })).toBeVisible();
  });

  test("手机模型下载失败时直接进入主屏幕，释放未完成的 3D 场景", async ({ page }) => {
    await page.route("**/iphone_15_pro_max.glb", route => route.abort());
    await page.goto("/sites/portal/");
    await home(page);
    await expect(page.locator(".pt-loader")).toHaveCount(0, { timeout: 20_000 });
    await expect(page.getByRole("list", { name: "主屏幕上的应用" })).toBeVisible();
    expect(await page.evaluate(() => (window as unknown as { __yugcStage?: Stage }).__yugcStage === undefined)).toBe(true);
    await noOverflow(page);
  });

  test("非零与不对称安全区：面板按钮、内容、Dock 和弹层均在安全范围内", async ({ page, context }) => {
    const cdp = await context.newCDPSession(page);
    for (const size of [
      { width: 844, height: 390, insets: { top: 0, left: 44, right: 44, bottom: 21 } },
      { width: 390, height: 844, insets: { top: 47, left: 44, right: 0, bottom: 34 } },
      { width: 390, height: 844, insets: { top: 47, left: 0, right: 44, bottom: 34 } },
    ]) {
      await page.setViewportSize({ width: size.width, height: size.height });
      await cdp.send("Emulation.setSafeAreaInsetsOverride", { insets: size.insets });
      await idle(page);
      await page.getByRole("button", { name: "跳过动画" }).tap();
      await home(page);
      await expect(page.locator(".pt-phone-status")).toHaveCSS("padding-left", `${Math.max(18, size.insets.left)}px`);
      await page.locator('.pt-icons [data-cta="terminal"]').tap();
      await expect(page.locator(".pt-win")).toHaveCSS("transform", "none");
      const safeBounds = await page.locator(".pt-phone-back, .pt-phone-close, .pt-term, .pt-dock").evaluateAll(nodes => nodes.map(node => {
        const rect = node.getBoundingClientRect();
        return { left: rect.left, right: rect.right, top: rect.top, bottom: rect.bottom };
      }));
      for (const rect of safeBounds) {
        expect(rect.left).toBeGreaterThanOrEqual(size.insets.left);
        expect(rect.right).toBeLessThanOrEqual(size.width - size.insets.right);
        expect(rect.top).toBeGreaterThanOrEqual(size.insets.top);
        expect(rect.bottom).toBeLessThanOrEqual(size.height - size.insets.bottom);
      }
      await page.getByRole("button", { name: "关闭应用" }).tap();
      await page.locator('.pt-icons [data-cta="wallpaper"]').tap();
      const picker = await page.getByRole("dialog", { name: "更换壁纸" }).boundingBox();
      expect(picker!.x).toBeGreaterThanOrEqual(size.insets.left);
      expect(picker!.x + picker!.width).toBeLessThanOrEqual(size.width - size.insets.right);
      expect(picker!.y).toBeGreaterThanOrEqual(size.insets.top);
      expect(picker!.y + picker!.height).toBeLessThanOrEqual(size.height - size.insets.bottom);
      await noOverflow(page);
      await page.keyboard.press("Escape");
    }
    await cdp.detach();
  });

  for (const consoleLink of [null, false, true]) {
    test(`账号 console_link=${consoleLink}、直达链接沿用原契约`, async ({ page, context }) => {
      await page.route("**/auth/me", route => route.fulfill({ json: consoleLink === null ? { signed_in: false } : { signed_in: true, login: "test-member", user_id: 1, console_link: consoleLink } }));
      await idle(page);
      await page.getByRole("button", { name: "跳过动画" }).tap();
      await home(page);
      if (consoleLink === null) await expect(page.getByRole("link", { name: /用 GitHub 登录/ })).toHaveAttribute("href", /\/auth\/github\?return_to=/);
      else await expect(page.getByRole("button", { name: "账号：test-member" })).toBeVisible();
      if (consoleLink !== null) {
        await page.setViewportSize({ width: 844, height: 390 });
        const cdp = await context.newCDPSession(page);
        await cdp.send("Emulation.setSafeAreaInsetsOverride", { insets: { top: 0, left: 44, right: 44, bottom: 21 } });
        await page.getByRole("button", { name: "账号：test-member" }).tap();
        const menu = await page.getByRole("menu").boundingBox();
        expect(menu!.x).toBeGreaterThanOrEqual(44);
        expect(menu!.x + menu!.width).toBeLessThanOrEqual(800);
        await page.keyboard.press("Escape");
        await cdp.send("Emulation.setSafeAreaInsetsOverride", { insets: { top: 0, left: 0, right: 0, bottom: 0 } });
        await cdp.detach();
        await page.setViewportSize({ width: 390, height: 844 });
      }
      await expect(page.locator('.pt-icons [data-cta="console"]')).toHaveCount(consoleLink === true ? 1 : 0);
      await page.getByRole("button", { name: "搜索", exact: true }).tap();
      await page.getByRole("combobox").fill("控制台");
      await expect(page.getByRole("option", { name: /控制台/ })).toHaveCount(consoleLink === true ? 1 : 0);
      await page.keyboard.press("Escape");
      const popup = context.waitForEvent("page");
      await page.locator('.pt-icons [data-cta="github"]').tap();
      const github = await popup;
      await github.waitForURL("https://github.com/Yangtze-University-Geek-Class");
      await github.close();
      await page.route("http://127.0.0.1:3456/**", route => route.fulfill({ contentType: "text/html", body: "<title>forum fixture</title>" }));
      await page.locator('.pt-icons [data-cta="forum"]').tap();
      await expect(page).toHaveURL("http://127.0.0.1:3456/");
      await page.goBack();
      await home(page);
    });
  }
});

test("1440×900 保留笔记本与电脑桌面，双击图标、窗口、菜单和 Dock", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await idle(page);
  await expect(page.getByRole("button", { name: "打开电脑" })).toBeVisible();
  expect(await page.evaluate(() => {
    const stage = (window as unknown as { __yugcStage: Stage }).__yugcStage;
    return stage.scene.getObjectByName("desk-laptop")!.visible && !stage.scene.getObjectByName("desk-phone")!.visible;
  })).toBe(true);
  await page.screenshot({ path: "/tmp/geek-206-iphone-desktop-unchanged.png" });
  await page.getByRole("button", { name: "跳过动画" }).click();
  await home(page);
  await expect(page.getByRole("button", { name: "前往" })).toBeVisible();
  await expect(page.locator(".pt-note")).toBeVisible();
  await stableWallpaper(page, /\/yugc\.webp/);
  await page.screenshot({ path: "/tmp/geek-206-phone-desktop-home.png" });
  await page.locator('.pt-icons [data-cta="terminal"]').click();
  await expect(page.getByRole("textbox", { name: "终端输入" })).toHaveCount(0);
  await page.locator('.pt-icons [data-cta="terminal"]').dblclick();
  await expect(page.getByRole("textbox", { name: "终端输入" })).toBeVisible();
  await expect(page.getByRole("button", { name: "放大", exact: true })).toBeVisible();
  await page.locator('.pt-dock [aria-label="壁纸"]').click();
  const picker = page.getByRole("dialog", { name: "更换壁纸" });
  await expect(picker).toHaveCSS("width", "560px");
  await expect(picker.locator(".pt-picker-box > header")).toBeVisible();
  await page.keyboard.press("Escape");
  await page.getByRole("button", { name: /搜索/ }).click();
  const launcher = page.getByRole("dialog", { name: "启动器" });
  await expect(launcher).toHaveCSS("width", "640px");
  await expect(launcher.locator(":scope > header")).toBeHidden();
  expect((await launcher.boundingBox())!.y).toBeCloseTo(126, 0);
  await page.keyboard.press("Escape");
  await noOverflow(page);
});

test.describe("圆润 PC 电脑 #213", () => {
  test.setTimeout(60_000);

  for (const viewport of [{ width: 1280, height: 800 }, { width: 1440, height: 900 }, { width: 1920, height: 1080 }]) {
    test(`${viewport.width}×${viewport.height} 实际屏幕可悬停开机、退回、Enter 再开机，离开首页释放 WebGL`, async ({ page }) => {
      await page.setViewportSize(viewport);
      await idle(page);
      const point = await page.evaluate(() => {
        // Stage 在 DEV 构造时注册该实例，Window 的标准类型不包含这个测试入口。
        const holder = window as unknown as { __yugcStage: Stage };
        const stage = holder.__yugcStage;
        const screen = stage.scene.getObjectByName("laptop-screen")!;
        const world = screen.getWorldPosition(screen.position.clone());
        const projected = stage.project(world, { x: 0, y: 0 });
        const rect = stage.canvas.getBoundingClientRect();
        return { x: projected.x + rect.left, y: projected.y + rect.top };
      });
      expect(point.x).toBeGreaterThan(0);
      expect(point.x).toBeLessThan(viewport.width);
      expect(point.y).toBeGreaterThan(0);
      expect(point.y).toBeLessThan(viewport.height);
      await page.mouse.move(point.x, point.y);
      await expect(page.locator(".pt-desk-tip")).toHaveText("打开电脑");
      await page.mouse.click(point.x, point.y);
      await home(page);
      await page.getByRole("button", { name: "回到书桌", exact: true }).click();
      await expect(page.locator(".pt-home")).toHaveAttribute("data-state", "idle", { timeout: 20_000 });
      await page.evaluate(() => {
        const active = document.activeElement;
        if (active instanceof HTMLElement) active.blur();
      });
      await page.keyboard.press("Enter");
      await home(page);
      await noOverflow(page);
      await page.evaluate(() => {
        // SPA 导航后保留同一实例引用，核对 GPU 上下文确实释放。
        const holder = window as unknown as { __yugcStage: Stage; __priorStage: Stage };
        holder.__priorStage = holder.__yugcStage;
      });
      await page.getByRole("button", { name: "帮助", exact: true }).click();
      await page.getByRole("menuitem", { name: "文档", exact: true }).click();
      await expect(page).toHaveURL(/\/sites\/portal\/docs$/);
      await expect.poll(() => page.evaluate(() => {
        // 该引用由本用例在导航前保存，不读取外部数据。
        const holder = window as unknown as { __priorStage: Stage };
        return holder.__priorStage.renderer.getContext().isContextLost();
      })).toBe(true);
    });
  }

  test("PC 减少动态效果与无 WebGL 路径仍可进入电脑桌面", async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.emulateMedia({ reducedMotion: "reduce" });
    await idle(page);
    await page.getByRole("button", { name: "打开电脑" }).click();
    await home(page);
    await page.addInitScript(() => {
      const original = HTMLCanvasElement.prototype.getContext;
      Object.defineProperty(HTMLCanvasElement.prototype, "getContext", { value: function (this: HTMLCanvasElement, type: string, ...args: unknown[]) {
        return type.startsWith("webgl") ? null : Reflect.apply(original, this, [type, ...args]);
      } });
    });
    await page.reload();
    await home(page);
    await expect(page.getByRole("list", { name: "桌面上的应用" })).toBeVisible();
    await noOverflow(page);
  });
});

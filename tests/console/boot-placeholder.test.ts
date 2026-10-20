// 控制台首次打开的加载提示（#263）：入口页一到就画「正在加载控制台」，样子与 ConsoleRoot 的「正在确认登录状态」一致，
// 挂载后由选择器藏起；构建时把样式表挪到 <body> 末尾，否则浏览器要等样式表下完才开始画。
// 真实浏览器里的显示与交接见 tests/e2e/workflows.spec.ts。
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import type { Plugin } from "vite";
import { describe, expect, it } from "vitest";
import consoleConfig, { moveStylesheetsToBodyEnd } from "../../app/console/vite.config";

const repoRoot = fileURLToPath(new URL("../..", import.meta.url));
const read = (path: string) => readFileSync(join(repoRoot, path), "utf8");
const html = read("app/console/index.html");
const theme = read("app/console/src/styles/theme.css");
const consoleRoot = read("app/console/src/pages/ConsoleRoot.vue");

const head = html.slice(0, html.indexOf("</head>"));
const body = html.slice(html.indexOf("<body>"));
const css = /<style>([\s\S]*?)<\/style>/.exec(head)?.[1] ?? "";
const blockAfter = (source: string, start: string) => {
  const at = source.indexOf(start);
  if (at < 0) return "";
  let depth = 0;
  for (let i = source.indexOf("{", at); i < source.length; i++) {
    if (source[i] === "{") depth++;
    if (source[i] === "}" && --depth === 0) return source.slice(source.indexOf("{", at) + 1, i);
  }
  return "";
};
const declarations = (block: string) => new Map(
  [...block.matchAll(/([a-z-]+)\s*:\s*([^;{}]+);/g)].map(([, property, value]) => [property, value.trim().replace(/\s+/g, " ")]),
);
const rule = (selector: string) => declarations(blockAfter(css, `${selector} {`));
const token = (name: string) => new RegExp(`${name}:\\s*([^;]+);`).exec(theme)?.[1].trim();

describe("console boot placeholder in index.html", () => {
  it("sits right after an empty #app, before the module script, and says what is loading", () => {
    expect(body).toContain('<div id="app"></div>');
    const app = body.indexOf('<div id="app"></div>');
    const boot = body.indexOf('<div class="console-boot" role="status">');
    expect(boot).toBeGreaterThan(app);
    expect(body.indexOf('<script type="module"')).toBeGreaterThan(boot);
    expect(body).toContain("<span>正在加载控制台</span>");
    expect(body).toContain('<span class="console-boot__spinner" aria-hidden="true">');
    expect(body).toContain('<span class="console-boot__slow">网络较慢，长时间没有反应可以刷新页面</span>');
  });

  it("hides itself once Vue has rendered anything into #app", () => {
    expect(rule("#app:not(:empty) ~ .console-boot").get("display")).toBe("none");
  });

  it("looks like ConsoleRoot's 正在确认登录状态, with the theme's colours and type", () => {
    const boot = rule(".console-noscript");
    const rootState = declarations(blockAfter(consoleRoot, ".root-state {"));
    expect(rootState.size).toBeGreaterThan(0);
    for (const [property, value] of rootState) expect(boot.get(property), property).toBe(value);
    expect(consoleRoot).toContain('<TxSpinner :size="24" label="正在确认登录状态" />');
    expect(rule(".console-boot__spinner").get("width")).toBe("24px");
    expect(rule(".console-boot__spinner").get("height")).toBe("24px");
    expect(rule("html").get("background")).toBe(token("--tx-bg-color-page"));
    // TxSpinner 与 .muted 都取 --tx-text-color-secondary
    expect(boot.get("color")).toBe(token("--tx-text-color-secondary"));
    expect(boot.get("font-family")).toBe(token("--tx-font-family"));
    expect(boot.get("font-size")).toBe(token("--tx-font-size-base"));
  });

  it("adds the slow-network hint after 10 s without moving the spinner, and still does so with reduced motion", () => {
    const slow = rule(".console-boot__slow");
    expect(slow.get("position")).toBe("absolute");
    expect(slow.get("visibility")).toBe("hidden");
    expect(slow.get("animation")).toBe("console-boot-slow 0s linear 10s forwards");
    expect(declarations(blockAfter(css, "@keyframes console-boot-slow")).get("visibility")).toBe("visible");
    const reduced = blockAfter(css, "@media (prefers-reduced-motion: reduce)");
    expect(declarations(blockAfter(reduced, ".console-boot__spinner {")).get("animation")).toBe("none");
    expect(declarations(blockAfter(reduced, ".console-boot__ball {")).get("animation")).toBe("none");
    expect(reduced).not.toContain("console-boot__slow");
  });

  it("uses no inline script (the CSP forbids it) and explains itself without JavaScript", () => {
    for (const [tag] of html.matchAll(/<script\b[^>]*>/g)) expect(tag).toMatch(/\ssrc=/);
    expect(head).toContain("<noscript><style>.console-boot { display: none; }</style></noscript>");
    expect(body).toContain('<noscript><p class="console-noscript">控制台需要开启 JavaScript 才能使用。</p></noscript>');
  });
});

describe("moveStylesheetsToBodyEnd", () => {
  const built = [
    "<!doctype html>",
    '<html lang="zh-CN">',
    "  <head>",
    '    <meta charset="UTF-8" />',
    '    <link rel="icon" type="image/png" sizes="32x32" href="/console-assets/favicon-32-a1.png" />',
    "    <title>极客班控制台</title>",
    "    <style>.console-boot { display: grid; }</style>",
    '    <script type="module" crossorigin src="https://cdn.crosery.com/yzgc/static/site/console-assets/index-b2.js"></script>',
    '    <link rel="modulepreload" crossorigin href="https://cdn.crosery.com/yzgc/static/site/console-assets/vendor-c3.js">',
    '    <link rel="stylesheet" crossorigin href="https://cdn.crosery.com/yzgc/static/site/console-assets/index-d4.css">',
    "    <link rel=stylesheet href=/console-assets/extra-e5.css>",
    "  </head>",
    "  <body>",
    '    <div id="app"></div>',
    '    <div class="console-boot" role="status"><span>正在加载控制台</span></div>',
    "  </body>",
    "</html>",
    "",
  ].join("\n");

  it("moves every stylesheet, in order, to the end of <body> and leaves the other head tags alone", () => {
    const out = moveStylesheetsToBodyEnd(built);
    const outHead = out.slice(0, out.indexOf("</head>"));
    expect(outHead).not.toMatch(/rel="?stylesheet/);
    for (const kept of ['rel="icon"', "<style>.console-boot", '<script type="module"', 'rel="modulepreload"']) expect(outHead).toContain(kept);
    expect(out).toContain([
      '    <div class="console-boot" role="status"><span>正在加载控制台</span></div>',
      '    <link rel="stylesheet" crossorigin href="https://cdn.crosery.com/yzgc/static/site/console-assets/index-d4.css">',
      "    <link rel=stylesheet href=/console-assets/extra-e5.css>",
      "  </body>",
      "</html>",
    ].join("\n"));
    const strip = (text: string) => text.split("\n").filter(line => !/rel="?stylesheet/.test(line)).join("\n");
    expect(strip(out)).toBe(strip(built));
  });

  it("returns the page unchanged when there is nothing to move", () => {
    const plain = built.split("\n").filter(line => !/rel="?stylesheet/.test(line)).join("\n");
    expect(moveStylesheetsToBodyEnd(plain)).toBe(plain);
    expect(moveStylesheetsToBodyEnd("<p>no document shell</p>")).toBe("<p>no document shell</p>");
  });

  it("runs on the built entry page after Vite has injected its tags", () => {
    const plugins = [consoleConfig.plugins ?? []].flat(Infinity) as Plugin[];
    const plugin = plugins.find(item => item?.name === "yzgc-console-boot-stylesheets");
    expect(plugin?.apply).toBe("build");
    const hook = plugin?.transformIndexHtml as { order?: string; handler?: unknown } | undefined;
    expect(hook?.order).toBe("post");
    expect(hook?.handler).toBe(moveStylesheetsToBodyEnd);
  });
});

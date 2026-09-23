#!/usr/bin/env node
import { readdirSync, readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

/**
 * Tuffex 组件自己渲染的图标类（`<i class="i-carbon-…">`）。
 *
 * UnoCSS 默认不扫描 node_modules，这些类名不会被提取，宿主必须显式 safelist。
 * 在加载配置时扫描已安装包的 dist，名单随安装版本走，不手抄快照。
 * 做法与 app/forum/scripts/tuffex-icon-classes.mjs 相同；控制台只装 carbon 图标集，
 * 所以只收 i-carbon-*（i-ri-* 只出现在本控制台不用的 Markdown 编辑器与按钮组里）。
 */

const ICON_CLASS = /\bi-carbon-[a-z0-9-]+/g;

/** 已安装包的 dist/es（`./*` 通配导出会遮住 package.json，所以从入口文件反推）。 */
function resolveDistRoot() {
  const require = createRequire(import.meta.url);
  try {
    return join(dirname(require.resolve("@talex-touch/tuffex")), "..", "es");
  } catch {
    return null;
  }
}

function* walkJs(dir) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) yield* walkJs(full);
    else if (entry.isFile() && entry.name.endsWith(".js")) yield full;
  }
}

/** @returns {string[]} 去重、排序后的 tuffex dist 图标类。 */
export function tuffexIconClasses() {
  const root = resolveDistRoot();
  if (!root) throw new Error("[tuffex-icon-classes] @talex-touch/tuffex 未安装，无法生成图标 safelist");
  const found = new Set();
  for (const file of walkJs(root)) {
    for (const match of readFileSync(file, "utf8").matchAll(ICON_CLASS)) found.add(match[0]);
  }
  return [...found].sort();
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const classes = tuffexIconClasses();
  for (const cls of classes) console.log(cls);
  console.error(`${classes.length} icon classes`);
}
